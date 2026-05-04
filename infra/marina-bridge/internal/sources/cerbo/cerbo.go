// Package cerbo subscribes to a local Victron Cerbo GX MQTT broker and
// updates the snapshot with battery / shore-power / GPS / temp readings.
//
// Topic layout (Venus OS): N/<vrm_id>/<service>/<instance>/<path>
// All payloads are JSON: {"value": 12.74}
//
// Common topics used:
//   N/<id>/system/0/Dc/Battery/Voltage
//   N/<id>/system/0/Dc/Battery/Soc
//   N/<id>/system/0/Ac/ActiveIn/Source       (1=grid/shore, 2=generator, 240=disconnected)
//   N/<id>/system/0/Position/Latitude        (only on Cerbos with GPS dongle)
//   N/<id>/system/0/Position/Longitude
//   N/<id>/temperature/+/Temperature
//   N/<id>/temperature/+/Humidity
//
// The Cerbo only publishes after it sees a "keepalive" — we send an empty
// message to R/<id>/system/0/Serial every 30s to keep the broker streaming.
package cerbo

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
	"github.com/kepsic/hara-marina/marina-bridge/internal/telemetry"
)

var (
	resolvedVRMMu sync.RWMutex
	resolvedVRMID string
)

func setResolvedVRMID(v string) {
	resolvedVRMMu.Lock()
	defer resolvedVRMMu.Unlock()
	resolvedVRMID = v
}

func getResolvedVRMID() string {
	resolvedVRMMu.RLock()
	defer resolvedVRMMu.RUnlock()
	return resolvedVRMID
}

type valueMsg struct {
	Value any `json:"value"`
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

// Run blocks until ctx is cancelled. On disconnect Paho auto-reconnects.
//
// If cfg.VrmID is "" or "auto", the bridge subscribes to N/+/# and pins
// itself to the first VRM ID it sees. This removes the need for the boat
// owner to look up their portal ID.
func Run(ctx context.Context, cfg config.CerboConfig, snap *telemetry.Snapshot) error {
	auto := cfg.VrmID == "" || strings.EqualFold(cfg.VrmID, "auto")

	var (
		mu       sync.RWMutex
		resolved string // set once auto-discovery succeeds
		once     sync.Once
	)
	getPrefix := func() (string, bool) {
		mu.RLock()
		defer mu.RUnlock()
		if resolved == "" {
			return "", false
		}
		return "N/" + resolved + "/", true
	}

	opts := mqtt.NewClientOptions().
		AddBroker(cfg.Broker).
		SetClientID(fmt.Sprintf("marina-bridge-cerbo-%d", time.Now().UnixNano())).
		SetUsername(cfg.Username).
		SetPassword(cfg.Password).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetCleanSession(true).
		SetKeepAlive(30 * time.Second).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			slog.Warn("connection lost", "source", "cerbo", "err", err)
		})

	opts.SetOnConnectHandler(func(c mqtt.Client) {
		slog.Info("connected", "source", "cerbo", "broker", cfg.Broker)
		filter := "N/+/#"
		if !auto {
			mu.Lock()
			resolved = cfg.VrmID
			mu.Unlock()
			setResolvedVRMID(cfg.VrmID)
			filter = "N/" + cfg.VrmID + "/#"
		}
		c.Subscribe(filter, 0, func(client mqtt.Client, m mqtt.Message) {
			if auto {
				parts := strings.SplitN(m.Topic(), "/", 3)
				if len(parts) >= 3 && parts[1] != "" {
					once.Do(func() {
						mu.Lock()
						resolved = parts[1]
						mu.Unlock()
						setResolvedVRMID(parts[1])
						slog.Info("auto-detected VRM portal id", "source", "cerbo", "vrm_id", parts[1])
						go keepalive(ctx, client, parts[1])
					})
				}
			}
			if p, ok := getPrefix(); ok {
				handle(m.Topic(), m.Payload(), p, snap)
			}
		})
	})

	client := mqtt.NewClient(opts)
	if t := client.Connect(); t.WaitTimeout(20*time.Second) && t.Error() != nil {
		return fmt.Errorf("cerbo connect: %w", t.Error())
	}
	defer client.Disconnect(500)

	if !auto {
		go keepalive(ctx, client, cfg.VrmID)
	} else {
		// Many Cerbos won't publish at all without a keepalive. Send a
		// broadcast wildcard request so we get one message back, learn the
		// VRM id, then the per-id keepalive takes over.
		go func() {
			t := time.NewTicker(5 * time.Second)
			defer t.Stop()
			for {
				if _, ok := getPrefix(); ok {
					return
				}
				client.Publish("R/+/keepalive", 0, false, "")
				select {
				case <-ctx.Done():
					return
				case <-t.C:
				}
			}
		}()
	}

	<-ctx.Done()
	return nil
}

func keepalive(ctx context.Context, c mqtt.Client, vrmID string) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	topic := fmt.Sprintf("R/%s/keepalive", vrmID)
	// kick once immediately
	c.Publish(topic, 0, false, "")
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.Publish(topic, 0, false, "")
		}
	}
}

func handle(topic string, payload []byte, prefix string, snap *telemetry.Snapshot) {
	if !strings.HasPrefix(topic, prefix) {
		return
	}
	var m valueMsg
	if err := json.Unmarshal(payload, &m); err != nil {
		return
	}
	rel := strings.TrimPrefix(topic, prefix)

	switch {
	case rel == "system/0/Dc/Battery/Voltage":
		if v, ok := toFloat(m.Value); ok {
			snap.SetBatteryVoltage(v)
		}
	case rel == "system/0/Dc/Battery/Soc":
		if v, ok := toFloat(m.Value); ok {
			snap.SetBatteryPercent(v)
		}
	case rel == "system/0/Ac/ActiveIn/Source":
		// 1 = grid/shore, 2 = generator, 240 = disconnected
		if v, ok := toFloat(m.Value); ok {
			snap.SetShorePower(v == 1)
		}
	case rel == "system/0/Position/Latitude":
		// Latitude arrives independently from Longitude, so we cache one and
		// only publish the position when both have been seen at least once.
		if v, ok := toFloat(m.Value); ok {
			cachedLat = &v
			tryPublishPosition(snap)
		}
	case rel == "system/0/Position/Longitude":
		if v, ok := toFloat(m.Value); ok {
			cachedLon = &v
			tryPublishPosition(snap)
		}
	case strings.HasPrefix(rel, "temperature/") && strings.HasSuffix(rel, "/Temperature"):
		if v, ok := toFloat(m.Value); ok {
			snap.SetCabinTempC(v)
		}
	case strings.HasPrefix(rel, "temperature/") && strings.HasSuffix(rel, "/Humidity"):
		if v, ok := toFloat(m.Value); ok {
			snap.SetCabinHumidityPct(v)
		}
	case strings.HasPrefix(rel, "temperature/") && strings.HasSuffix(rel, "/DewPoint"):
		if v, ok := toFloat(m.Value); ok {
			snap.SetDewpointC(v)
		}
	case strings.HasPrefix(rel, "tank/") && strings.HasSuffix(rel, "/Level"):
		// If owners label a tank "Bilge" Venus reports 0–100 %; we map that
		// loosely to centimetres for now (1% ≈ 1 cm).
		if v, ok := toFloat(m.Value); ok {
			snap.SetBilgeWaterCm(v)
		}
	case strings.HasPrefix(rel, "system/0/Ac/") && strings.Contains(rel, "/L1/") && strings.HasSuffix(rel, "/Voltage"):
		if v, ok := toFloat(m.Value); ok {
			snap.SetAcVoltageV(v)
		}
	case strings.HasPrefix(rel, "system/0/Ac/") && strings.Contains(rel, "/L1/") && strings.HasSuffix(rel, "/Current"):
		if v, ok := toFloat(m.Value); ok {
			snap.SetAcCurrentA(v)
		}
	case strings.HasPrefix(rel, "system/0/Ac/") && strings.Contains(rel, "/L1/") && strings.HasSuffix(rel, "/Power"):
		if v, ok := toFloat(m.Value); ok {
			snap.SetAcPowerW(v)
		}
	case strings.HasPrefix(rel, "system/0/Ac/") && strings.Contains(rel, "/L1/") && strings.Contains(rel, "/Energy/") && strings.HasSuffix(rel, "/Forward"):
		if v, ok := toFloat(m.Value); ok {
			snap.SetAcEnergyKwhTotal(v)
		}
	case strings.HasPrefix(rel, "relay/") && strings.HasSuffix(rel, "/State"):
		parts := strings.Split(rel, "/")
		if len(parts) == 3 {
			idx, err := strconv.Atoi(parts[1])
			if err == nil && idx >= 0 && idx <= 3 {
				if v, ok := toFloat(m.Value); ok {
					snap.SetRelayBank1(idx+1, v >= 0.5)
				}
			}
		}
	}
}

// WriteRelay publishes a relay state command to Cerbo GX.
// Relay index is 1..4 for bank1 relays.
func WriteRelay(ctx context.Context, cfg config.CerboConfig, relayIndex int, on bool) error {
	if relayIndex < 1 || relayIndex > 4 {
		return fmt.Errorf("relay index must be 1..4")
	}
	if cfg.Broker == "" {
		return fmt.Errorf("cerbo broker is empty")
	}
	vrmID := cfg.VrmID
	if vrmID == "" || strings.EqualFold(vrmID, "auto") {
		vrmID = getResolvedVRMID()
		if vrmID == "" {
			return fmt.Errorf("relay control unavailable until Cerbo VRM ID is discovered")
		}
	}

	opts := mqtt.NewClientOptions().
		AddBroker(cfg.Broker).
		SetClientID(fmt.Sprintf("marina-bridge-cerbo-write-%d", time.Now().UnixNano())).
		SetUsername(cfg.Username).
		SetPassword(cfg.Password).
		SetAutoReconnect(false).
		SetCleanSession(true)

	client := mqtt.NewClient(opts)
	if t := client.Connect(); t.WaitTimeout(10*time.Second) && t.Error() != nil {
		return fmt.Errorf("cerbo relay connect: %w", t.Error())
	}
	defer client.Disconnect(200)

	val := 0
	if on {
		val = 1
	}
	body, _ := json.Marshal(map[string]any{"value": val})

	idx := relayIndex - 1
	topics := []string{
		fmt.Sprintf("W/%s/relay/%d/State", vrmID, idx),
		fmt.Sprintf("W/%s/system/0/Relay/%d/State", vrmID, idx),
	}

	for _, topic := range topics {
		tok := client.Publish(topic, 1, false, body)
		select {
		case <-tok.Done():
			if tok.Error() != nil {
				return fmt.Errorf("cerbo relay publish %s: %w", topic, tok.Error())
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	return nil
}

// Position arrives in two messages — coalesce.
var cachedLat, cachedLon *float64

func tryPublishPosition(snap *telemetry.Snapshot) {
	if cachedLat != nil && cachedLon != nil {
		snap.SetPosition(*cachedLat, *cachedLon)
	}
}
