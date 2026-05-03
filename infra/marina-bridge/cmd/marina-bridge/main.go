package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
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
	log.Printf("[bridge] slug=%s interval=%s", cfg.Slug, cfg.PublishInterval)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	snap := &telemetry.Snapshot{}

	type relayCmd struct {
		Type  string `json:"type"`
		Bank  int    `json:"bank"`
		Relay int    `json:"relay"`
		State bool   `json:"state"`
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
		log.Printf("[bridge] AIS ingest enabled → %s mmsi=%s", cfg.AisIngest.URL, cfg.AisIngest.MMSI)
	}

	// --- start sources ---
	if cfg.Sources.Cerbo.Enabled {
		go func() {
			if err := cerbo.Run(ctx, cfg.Sources.Cerbo, snap); err != nil {
				log.Printf("[cerbo] exited: %v", err)
			}
		}()
	}
	if cfg.Sources.Ydwg.Enabled {
		go func() {
			if err := ydwg.Run(ctx, cfg.Sources.Ydwg, snap, aisPusher); err != nil {
				log.Printf("[ydwg] exited: %v", err)
			}
		}()
	}
	if cfg.Sources.N0183.Enabled {
		go func() {
			if err := n0183.Run(ctx, cfg.Sources.N0183, snap); err != nil {
				log.Printf("[n0183] exited: %v", err)
			}
		}()
	}
	if cfg.Sources.Emtrak.Enabled {
		go func() {
			if err := emtrak.Run(ctx, cfg.Sources.Emtrak, aisPusher); err != nil {
				log.Printf("[emtrak] exited: %v", err)
			}
		}()
	}

	if !*dryRun {
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
					log.Printf("[cmd] invalid json on %s: %v", topic, err)
					return
				}
				switch kind.Type {
				case "relay_set":
					var cmd relayCmd
					if err := json.Unmarshal(payload, &cmd); err != nil {
						log.Printf("[cmd] relay_set decode failed: %v", err)
						return
					}
					if cmd.Bank != 1 || cmd.Relay < 1 || cmd.Relay > 4 {
						log.Printf("[cmd] unsupported relay bank=%d relay=%d", cmd.Bank, cmd.Relay)
						return
					}
					if !cfg.Sources.Cerbo.Enabled {
						log.Printf("[cmd] cerbo source disabled; relay command ignored")
						return
					}
					if err := cerbo.WriteRelay(context.Background(), cfg.Sources.Cerbo, cmd.Relay, cmd.State); err != nil {
						log.Printf("[cmd] relay write failed relay=%d state=%t: %v", cmd.Relay, cmd.State, err)
						return
					}
					snap.SetRelayBank1(cmd.Relay, cmd.State)
					ruleMu.Lock()
					if rule.relay == cmd.Relay {
						rule.desired = &cmd.State
					}
					ruleMu.Unlock()
					log.Printf("[cmd] relay set bank=%d relay=%d state=%t", cmd.Bank, cmd.Relay, cmd.State)
				case "humidity_rule_set":
					var cmd humidityRuleCmd
					if err := json.Unmarshal(payload, &cmd); err != nil {
						log.Printf("[cmd] humidity_rule_set decode failed: %v", err)
						return
					}
					if cmd.Bank != 1 || cmd.Relay < 1 || cmd.Relay > 4 || cmd.OffBelow >= cmd.OnAbove {
						log.Printf("[cmd] invalid humidity rule bank=%d relay=%d off=%.1f on=%.1f", cmd.Bank, cmd.Relay, cmd.OffBelow, cmd.OnAbove)
						return
					}
					ruleMu.Lock()
					rule.enabled = cmd.Enabled
					rule.relay = cmd.Relay
					rule.onAbove = cmd.OnAbove
					rule.offBelow = cmd.OffBelow
					rule.desired = nil
					ruleMu.Unlock()
					log.Printf("[cmd] humidity rule enabled=%t relay=%d on>%.1f off<%.1f", cmd.Enabled, cmd.Relay, cmd.OnAbove, cmd.OffBelow)
				case "scenarios_set":
					var cmd scenariosCmd
					if err := json.Unmarshal(payload, &cmd); err != nil {
						log.Printf("[cmd] scenarios_set decode failed: %v", err)
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
					log.Printf("[cmd] scenarios updated: %d", len(runtime))
				default:
					log.Printf("[cmd] ignored command type=%s", kind.Type)
				}
			},
		)
		if err != nil {
			log.Printf("[cmd] subscriber disabled: %v", err)
		} else {
			defer sub.Close()
			log.Printf("[cmd] listener active on %s", cmdTopic)
		}
	}

	// --- publisher loop ---
	var pub *marina.Publisher
	if !*dryRun {
		clientID := fmt.Sprintf("marina-bridge-%s-%d", cfg.Slug, time.Now().UnixNano())
		p, err := marina.NewPublisher(cfg.Marina.Broker, cfg.Marina.Username, cfg.Marina.Password, cfg.Marina.Topic, clientID)
		if err != nil {
			log.Fatalf("[marina] %v", err)
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
		if ruleCopy.enabled && cfg.Sources.Cerbo.Enabled {
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
					if err := cerbo.WriteRelay(context.Background(), cfg.Sources.Cerbo, ruleCopy.relay, desired); err != nil {
						log.Printf("[auto] humidity relay write failed relay=%d desired=%t humidity=%.1f: %v", ruleCopy.relay, desired, h, err)
					} else {
						snap.SetRelayBank1(ruleCopy.relay, desired)
						ruleMu.Lock()
						rule.desired = &desired
						ruleMu.Unlock()
						log.Printf("[auto] humidity=%.1f%% relay%d=%t (on>%.1f off<%.1f)", h, ruleCopy.relay, desired, ruleCopy.onAbove, ruleCopy.offBelow)
					}
				}
			}
		}

		if cfg.Sources.Cerbo.Enabled && len(scenariosCopy) > 0 {
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
				if err := cerbo.WriteRelay(context.Background(), cfg.Sources.Cerbo, relay, desired); err != nil {
					log.Printf("[auto-scenario] relay write failed relay=%d desired=%t: %v", relay, desired, err)
					continue
				}
				snap.SetRelayBank1(relay, desired)
				log.Printf("[auto-scenario] relay%d=%t", relay, desired)
			}

			ruleMu.Lock()
			scenarios = scenariosCopy
			ruleMu.Unlock()
		}

		doc := snap.MarshalIngest(cfg.Slug)
		if len(doc) <= 2 {
			log.Printf("[bridge] no telemetry yet, skipping publish")
			return
		}
		if *dryRun {
			fmt.Printf("%v\n", doc)
			return
		}
		if err := pub.Publish(ctx, doc); err != nil {
			log.Printf("[bridge] publish: %v", err)
			return
		}
		log.Printf("[bridge] published %d fields", len(doc)-2)
	}

	// kick once after a short warmup so sources can populate
	time.AfterFunc(5*time.Second, publish)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[bridge] shutting down")
			return
		case <-tick.C:
			publish()
		}
	}
}
