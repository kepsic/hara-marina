package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"strings"
	"syscall"
	"time"

	"github.com/kepsic/hara-marina/marina-bridge/internal/aisingest"
	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
	"github.com/kepsic/hara-marina/marina-bridge/internal/marina"
	"github.com/kepsic/hara-marina/marina-bridge/internal/sources/cerbo"
	"github.com/kepsic/hara-marina/marina-bridge/internal/sources/emtrak"
	"github.com/kepsic/hara-marina/marina-bridge/internal/sources/n0183"
	"github.com/kepsic/hara-marina/marina-bridge/internal/sources/ydwg"
	"github.com/kepsic/hara-marina/marina-bridge/internal/telemetry"
)

func main() {
	cfgPath := flag.String("config", "", "path to config file (optional; env vars take precedence)")
	dryRun := flag.Bool("dry-run", false, "print payload to stdout instead of publishing")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(2)
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})))

	slog.Info("bridge started", "source", "bridge", "slug", cfg.Slug, "interval", cfg.PublishInterval.String())

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	snap := &telemetry.Snapshot{}

	type relayCmd struct {
		Type  string `json:"type"`
		Bank  int    `json:"bank"`
		Relay int    `json:"relay"`
		State bool   `json:"state"`
	}
	type pedestalRelayCmd struct {
		Type    string `json:"type"`
		BerthID string `json:"berth_id"`
		Channel int    `json:"channel"`
		State   bool   `json:"state"`
		TokenID string `json:"token_id"`
	}
	type humidityRuleCmd struct {
		Type     string  `json:"type"`
		Enabled  bool    `json:"enabled"`
		Bank     int     `json:"bank"`
		Relay    int     `json:"relay"`
		OnAbove  float64 `json:"on_above"`
		OffBelow float64 `json:"off_below"`
	}
	type humidityRuleState struct {
		enabled  bool
		relay    int
		onAbove  float64
		offBelow float64
		desired  *bool
	}
	type scenarioDef struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		Enabled    bool    `json:"enabled"`
		Field      string  `json:"field"`
		Condition  string  `json:"condition"`
		Threshold  float64 `json:"threshold"`
		Hysteresis float64 `json:"hysteresis"`
		Relay      int     `json:"relay"`
		Action     bool    `json:"action"`
	}
	type scenariosCmd struct {
		Type      string        `json:"type"`
		Scenarios []scenarioDef `json:"scenarios"`
	}
	type scenarioRuntime struct {
		Def    scenarioDef
		Active *bool
	}
	var (
		ruleMu    sync.Mutex
		rule      = humidityRuleState{enabled: false, relay: 1, onAbove: 80, offBelow: 75}
		scenarios []scenarioRuntime
	)
	relayBackendAvailable := cfg.Sources.Cerbo.Enabled || cfg.Sources.Ydwg.Enabled
	// relayBank is the N2K bank instance (1-252) used for YDCC-04 command validation.
	// Cerbo relays are always bank 1 on the Cerbo side; for YDWG it follows the config.
	relayBank := 1
	if cfg.Sources.Ydwg.Enabled && cfg.Sources.Ydwg.RelayBank > 0 {
		relayBank = cfg.Sources.Ydwg.RelayBank
	}
	writeRelay := func(relay int, state bool) error {
		if cfg.Sources.Cerbo.Enabled {
			return cerbo.WriteRelay(context.Background(), cfg.Sources.Cerbo, relay, state)
		}
		if cfg.Sources.Ydwg.Enabled {
			return ydwg.WriteRelay(context.Background(), cfg.Sources.Ydwg, relay, state)
		}
		return fmt.Errorf("no relay backend enabled")
	}

	isConditionTrue := func(cond string, v, th float64) bool {
		switch cond {
		case "gt":
			return v > th
		case "gte":
			return v >= th
		case "lt":
			return v < th
		case "lte":
			return v <= th
		default:
			return false
		}
	}

	clearConditionTrue := func(cond string, v, th, h float64) bool {
		switch cond {
		case "gt":
			return v < th-h
		case "gte":
			return v <= th-h
		case "lt":
			return v > th+h
		case "lte":
			return v >= th+h
		default:
			return true
		}
	}

	// AIS pusher: forwards decoded N2K AIS fixes (em-trak / Class B) from the
	// boat's own bus to the central ais-cache. Returns nil when disabled.
	aisPusher := aisingest.NewPusher(cfg.AisIngest)
	if aisPusher != nil {
		slog.Info("AIS ingest enabled", "source", "bridge", "url", cfg.AisIngest.URL, "mmsi", cfg.AisIngest.MMSI)
	}

	// --- start sources ---
	if cfg.Sources.Cerbo.Enabled {
		go func() {
			if err := cerbo.Run(ctx, cfg.Sources.Cerbo, snap); err != nil {
				slog.Error("source exited", "source", "cerbo", "err", err)
			}
		}()
	}
	if cfg.Sources.Ydwg.Enabled {
		go func() {
			if err := ydwg.Run(ctx, cfg.Sources.Ydwg, snap, aisPusher); err != nil {
				slog.Error("source exited", "source", "ydwg", "err", err)
			}
		}()
	}
	if cfg.Sources.N0183.Enabled {
		go func() {
			if err := n0183.Run(ctx, cfg.Sources.N0183, snap); err != nil {
				slog.Error("source exited", "source", "n0183", "err", err)
			}
		}()
	}
	if cfg.Sources.Emtrak.Enabled {
		go func() {
			if err := emtrak.Run(ctx, cfg.Sources.Emtrak, aisPusher); err != nil {
				slog.Error("source exited", "source", "emtrak", "err", err)
			}
		}()
	}

	if !*dryRun {
		// Boat-level commands: marina/<slug>/cmd/#
		// Pedestal commands also flow through the same /cmd/ subtree so this
		// one subscription covers both deployment topologies (boat-side bridge
		// or marina-pedestal bridge with cfg.Slug = marina slug).
		cmdTopic := strings.TrimSuffix(cfg.Marina.Topic, "/telemetry") + "/cmd/#"
		sub, err := marina.NewCommandSubscriber(
			cfg.Marina.Broker,
			cfg.Marina.Username,
			cfg.Marina.Password,
			cmdTopic,
			fmt.Sprintf("marina-cmd-%s-%d", cfg.Slug, time.Now().UnixNano()),
			func(topic string, payload []byte) {
				var kind struct{ Type string `json:"type"` }
				if err := json.Unmarshal(payload, &kind); err != nil {
					slog.Error("invalid json", "source", "cmd", "topic", topic, "err", err)
					return
				}
				switch kind.Type {
				case "relay_set":
					var cmd relayCmd
					if err := json.Unmarshal(payload, &cmd); err != nil {
						slog.Error("relay_set decode failed", "source", "cmd", "err", err)
						return
					}
					if cmd.Bank != relayBank || cmd.Relay < 1 || cmd.Relay > 4 {
						slog.Warn("relay command rejected", "source", "cmd", "bank", cmd.Bank, "relay", cmd.Relay, "configured_bank", relayBank)
						return
					}
					if !relayBackendAvailable {
						slog.Warn("no relay backend enabled", "source", "cmd")
						return
					}
					slog.Info("relay set received", "source", "cmd", "bank", cmd.Bank, "relay", cmd.Relay, "state", cmd.State)
					if err := writeRelay(cmd.Relay, cmd.State); err != nil {
						slog.Error("relay write failed", "source", "cmd", "relay", cmd.Relay, "state", cmd.State, "err", err)
						return
					}
					snap.SetRelayBank1(cmd.Relay, cmd.State)
					ruleMu.Lock()
					if rule.relay == cmd.Relay {
						rule.desired = &cmd.State
					}
					ruleMu.Unlock()
					slog.Info("relay set ok", "source", "cmd", "bank", cmd.Bank, "relay", cmd.Relay, "state", cmd.State)
				case "pedestal_relay_set":
					var cmd pedestalRelayCmd
					if err := json.Unmarshal(payload, &cmd); err != nil {
						slog.Error("pedestal_relay_set decode failed", "source", "cmd", "err", err)
						return
					}
					if cmd.Channel < 1 || cmd.Channel > 4 {
						slog.Warn("pedestal command rejected: bad channel", "source", "cmd", "channel", cmd.Channel)
						return
					}
					if !relayBackendAvailable {
						slog.Warn("no relay backend enabled (pedestal)", "source", "cmd")
						return
					}
					slog.Info("pedestal relay set received", "source", "cmd", "berth", cmd.BerthID, "channel", cmd.Channel, "state", cmd.State, "token", cmd.TokenID)
					if err := writeRelay(cmd.Channel, cmd.State); err != nil {
						slog.Error("pedestal relay write failed", "source", "cmd", "channel", cmd.Channel, "state", cmd.State, "err", err)
						return
					}
					snap.SetRelayBank1(cmd.Channel, cmd.State)
					slog.Info("pedestal relay set ok", "source", "cmd", "berth", cmd.BerthID, "channel", cmd.Channel, "state", cmd.State)
				case "humidity_rule_set":
					var cmd humidityRuleCmd
					if err := json.Unmarshal(payload, &cmd); err != nil {
						slog.Error("humidity_rule_set decode failed", "source", "cmd", "err", err)
						return
					}
					if cmd.Bank != relayBank || cmd.Relay < 1 || cmd.Relay > 4 || cmd.OffBelow >= cmd.OnAbove {
						slog.Warn("invalid humidity rule", "source", "cmd", "bank", cmd.Bank, "relay", cmd.Relay, "off_below", cmd.OffBelow, "on_above", cmd.OnAbove, "configured_bank", relayBank)
						return
					}
					ruleMu.Lock()
					rule.enabled = cmd.Enabled
					rule.relay = cmd.Relay
					rule.onAbove = cmd.OnAbove
					rule.offBelow = cmd.OffBelow
					rule.desired = nil
					ruleMu.Unlock()
					slog.Info("humidity rule set", "source", "cmd", "enabled", cmd.Enabled, "relay", cmd.Relay, "on_above", cmd.OnAbove, "off_below", cmd.OffBelow)
				case "scenarios_set":
					var cmd scenariosCmd
					if err := json.Unmarshal(payload, &cmd); err != nil {
						slog.Error("scenarios_set decode failed", "source", "cmd", "err", err)
						return
					}
					runtime := make([]scenarioRuntime, 0, len(cmd.Scenarios))
					for _, s := range cmd.Scenarios {
						if s.Relay < 1 || s.Relay > 4 {
							continue
						}
						if s.Hysteresis < 0 {
							s.Hysteresis = 0
						}
						runtime = append(runtime, scenarioRuntime{Def: s})
					}
					ruleMu.Lock()
					scenarios = runtime
					ruleMu.Unlock()
					slog.Info("scenarios updated", "source", "cmd", "count", len(runtime))
				default:
					slog.Debug("unknown command type", "source", "cmd", "type", kind.Type)
				}
			},
		)
		if err != nil {
			slog.Error("cmd subscriber disabled", "source", "cmd", "err", err)
		} else {
			defer sub.Close()
			slog.Info("cmd listener active", "source", "cmd", "topic", cmdTopic)
		}
	}

	// --- publisher loop ---
	var pub *marina.Publisher
	if !*dryRun {
		clientID := fmt.Sprintf("marina-bridge-%s-%d", cfg.Slug, time.Now().UnixNano())
		p, err := marina.NewPublisher(cfg.Marina.Broker, cfg.Marina.Username, cfg.Marina.Password, cfg.Marina.Topic, clientID)
		if err != nil {
			slog.Error("publisher init failed", "source", "marina", "err", err)
			os.Exit(1)
		}
		defer p.Close()
		pub = p
	}

	tick := time.NewTicker(cfg.PublishInterval)
	defer tick.Stop()

	publish := func() {
		ruleMu.Lock()
		ruleCopy := rule
		scenariosCopy := make([]scenarioRuntime, len(scenarios))
		copy(scenariosCopy, scenarios)
		ruleMu.Unlock()
		if ruleCopy.enabled && relayBackendAvailable {
			if h, ok := snap.GetCabinHumidityPct(); ok {
				current, hasCurrent := snap.GetRelayBank1(ruleCopy.relay)
				desired := current
				if !hasCurrent {
					desired = false
				}
				if h > ruleCopy.onAbove {
					desired = true
				} else if h < ruleCopy.offBelow {
					desired = false
				}
				shouldWrite := true
				if ruleCopy.desired != nil {
					shouldWrite = *ruleCopy.desired != desired
				}
				if shouldWrite {
					if err := writeRelay(ruleCopy.relay, desired); err != nil {
						slog.Error("humidity relay write failed", "source", "auto", "relay", ruleCopy.relay, "desired", desired, "humidity", h, "err", err)
					} else {
						snap.SetRelayBank1(ruleCopy.relay, desired)
						ruleMu.Lock()
						rule.desired = &desired
						ruleMu.Unlock()
						slog.Info("humidity relay triggered", "source", "auto", "humidity", h, "relay", ruleCopy.relay, "state", desired, "on_above", ruleCopy.onAbove, "off_below", ruleCopy.offBelow)
					}
				}
			}
		}

		if relayBackendAvailable && len(scenariosCopy) > 0 {
			desiredByRelay := map[int]bool{}
			for i := range scenariosCopy {
				sr := &scenariosCopy[i]
				if !sr.Def.Enabled {
					continue
				}
				v, ok := snap.GetNumericField(sr.Def.Field)
				if !ok {
					continue
				}

				active := false
				if sr.Active == nil {
					active = isConditionTrue(sr.Def.Condition, v, sr.Def.Threshold)
				} else {
					active = *sr.Active
					if !active && isConditionTrue(sr.Def.Condition, v, sr.Def.Threshold) {
						active = true
					} else if active && clearConditionTrue(sr.Def.Condition, v, sr.Def.Threshold, sr.Def.Hysteresis) {
						active = false
					}
				}
				sr.Active = &active
				target := sr.Def.Action
				if !active {
					target = !sr.Def.Action
				}
				desiredByRelay[sr.Def.Relay] = target
			}

			for relay, desired := range desiredByRelay {
				current, hasCurrent := snap.GetRelayBank1(relay)
				if hasCurrent && current == desired {
					continue
				}
				if err := writeRelay(relay, desired); err != nil {
					slog.Error("scenario relay write failed", "source", "auto-scenario", "relay", relay, "desired", desired, "err", err)
					continue
				}
				snap.SetRelayBank1(relay, desired)
				slog.Info("scenario relay triggered", "source", "auto-scenario", "relay", relay, "state", desired)
			}

			ruleMu.Lock()
			scenarios = scenariosCopy
			ruleMu.Unlock()
		}

		doc := snap.MarshalIngest(cfg.Slug)
		if len(doc) <= 2 {
			slog.Debug("no telemetry yet, skipping publish", "source", "bridge")
			return
		}
		if *dryRun {
			fmt.Printf("%v\n", doc)
			return
		}
		if err := pub.Publish(ctx, doc); err != nil {
			slog.Error("publish failed", "source", "bridge", "err", err)
			return
		}
		keys := make([]string, 0, len(doc)-2)
		for k := range doc {
			if k != "slug" && k != "ts" {
				keys = append(keys, k)
			}
		}
		slog.Debug("published", "source", "bridge", "keys", keys)
	}

	// kick once after a short warmup so sources can populate
	time.AfterFunc(5*time.Second, publish)

	for {
		select {
		case <-ctx.Done():
			slog.Info("shutting down", "source", "bridge")
			return
		case <-tick.C:
			publish()
		}
	}
}
