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
	"log"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
	"github.com/kepsic/hara-marina/marina-bridge/internal/telemetry"
)

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
func Run(ctx context.Context, cfg config.CerboConfig, snap *telemetry.Snapshot) error {
	prefix := fmt.Sprintf("N/%s/", cfg.VrmID)

	opts := mqtt.NewClientOptions().
		AddBroker(cfg.Broker).
		SetClientID(fmt.Sprintf("marina-bridge-cerbo-%d", time.Now().UnixNano())).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetCleanSession(true).
		SetKeepAlive(30 * time.Second).
		SetOnConnectHandler(func(c mqtt.Client) {
			log.Printf("[cerbo] connected to %s", cfg.Broker)
			c.Subscribe(prefix+"#", 0, func(_ mqtt.Client, m mqtt.Message) {
				handle(m.Topic(), m.Payload(), prefix, snap)
			})
		}).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			log.Printf("[cerbo] connection lost: %v", err)
		})

	client := mqtt.NewClient(opts)
	if t := client.Connect(); t.WaitTimeout(20*time.Second) && t.Error() != nil {
		return fmt.Errorf("cerbo connect: %w", t.Error())
	}
	defer client.Disconnect(500)

	// Keepalive: Venus OS only streams when it sees a request on R/<id>/...
	go keepalive(ctx, client, cfg.VrmID)

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
	case strings.HasPrefix(rel, "tank/") && strings.HasSuffix(rel, "/Level"):
		// If owners label a tank "Bilge" Venus reports 0–100 %; we map that
		// loosely to centimetres for now (1% ≈ 1 cm).
		if v, ok := toFloat(m.Value); ok {
			snap.SetBilgeWaterCm(v)
		}
	}
}

// Position arrives in two messages — coalesce.
var cachedLat, cachedLon *float64

func tryPublishPosition(snap *telemetry.Snapshot) {
	if cachedLat != nil && cachedLon != nil {
		snap.SetPosition(*cachedLat, *cachedLon)
	}
}
