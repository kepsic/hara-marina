// Cerbo GX emulator: speaks Venus OS MQTT for boat MOI.
//
// Pretends to be a Cerbo on the boat's LAN, but published to a remote
// EMQX broker via TCP. The marina-bridge running anywhere subscribes
// to the same broker and sees this traffic exactly as it would on a
// real boat.
//
// Realism choices:
//   * Only publishes while a recent R/<id>/keepalive arrived (matches
//     real Cerbo behavior — they go silent without one).
//   * All payloads are {"value": ...} JSON, no other fields.
//   * Battery & temperature drift slowly between sane bounds rather
//     than being random per tick.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type config struct {
	broker          string
	username        string
	password        string
	vrmID           string
	publishPeriod   time.Duration
	keepaliveGrace  time.Duration
	publishWithout  bool // emit even if no keepalive seen (for local debug)
	baseLat, baseLon float64

	// YDWG-02 emulator (synthetic NMEA 2000 over TCP).
	ydwgEnabled bool
	ydwgAddr    string
	ydwgMMSI    uint32
	ydwgName    string
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envDuration(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func envBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func loadConfig() config {
	cfg := config{
		broker:         envOr("MQTT_BROKER", ""),
		username:       envOr("MQTT_USERNAME", ""),
		password:       envOr("MQTT_PASSWORD", ""),
		vrmID:          envOr("VRM_ID", "c0deba5eb0a7"),
		publishPeriod:  envDuration("PUBLISH_PERIOD", 5*time.Second),
		keepaliveGrace: envDuration("KEEPALIVE_GRACE", 60*time.Second),
		publishWithout: envBool("PUBLISH_WITHOUT_KEEPALIVE", false),
		baseLat:        59.5916,
		baseLon:        25.6608,
		ydwgEnabled:    envBool("YDWG_SIM_ENABLED", false),
		ydwgAddr:       envOr("YDWG_SIM_ADDR", ":1457"),
		ydwgMMSI:       parseUint32Env(envOr("YDWG_SIM_MMSI", ""), 276013320),
		ydwgName:       envOr("YDWG_SIM_NAME", "MOI"),
	}
	flag.StringVar(&cfg.broker, "broker", cfg.broker, "MQTT broker URL (tcp://host:1883)")
	flag.StringVar(&cfg.username, "user", cfg.username, "MQTT username")
	flag.StringVar(&cfg.password, "pass", cfg.password, "MQTT password")
	flag.StringVar(&cfg.vrmID, "vrm", cfg.vrmID, "VRM portal id to advertise")
	flag.DurationVar(&cfg.publishPeriod, "period", cfg.publishPeriod, "publish interval")
	flag.DurationVar(&cfg.keepaliveGrace, "grace", cfg.keepaliveGrace, "max age of last keepalive before going silent")
	flag.BoolVar(&cfg.publishWithout, "always", cfg.publishWithout, "publish even without a keepalive (debug)")
	flag.Parse()
	if cfg.broker == "" {
		log.Fatal("MQTT_BROKER (or -broker) is required")
	}
	return cfg
}

func main() {
	cfg := loadConfig()
	log.Printf("[cerbo-emu] starting; broker=%s vrm=%s period=%s",
		cfg.broker, cfg.vrmID, cfg.publishPeriod)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// last-keepalive UnixNano; 0 = never seen
	var lastKA atomic.Int64

	opts := mqtt.NewClientOptions().
		AddBroker(cfg.broker).
		SetClientID(fmt.Sprintf("cerbo-emu-%s-%d", cfg.vrmID, time.Now().UnixNano())).
		SetUsername(cfg.username).
		SetPassword(cfg.password).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetCleanSession(true).
		SetKeepAlive(30 * time.Second).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			log.Printf("[cerbo-emu] connection lost: %v", err)
		}).
		SetOnConnectHandler(func(c mqtt.Client) {
			log.Printf("[cerbo-emu] connected")
			topic := fmt.Sprintf("R/%s/keepalive", cfg.vrmID)
			c.Subscribe(topic, 0, func(_ mqtt.Client, _ mqtt.Message) {
				lastKA.Store(time.Now().UnixNano())
			})
			// Also accept the wildcard form some bridges use during discovery.
			c.Subscribe("R/+/keepalive", 0, func(_ mqtt.Client, _ mqtt.Message) {
				lastKA.Store(time.Now().UnixNano())
			})
		})

	client := mqtt.NewClient(opts)
	if t := client.Connect(); t.WaitTimeout(20*time.Second) && t.Error() != nil {
		log.Fatalf("[cerbo-emu] connect failed: %v", t.Error())
	}
	defer client.Disconnect(500)

	// Drift state.
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	state := newState(rng, cfg.baseLat, cfg.baseLon)

	// Optional YDWG-02 emulator: serves synthetic N2K (incl. AIS) over TCP
	// so marina-bridge can decode self-AIS frames in test environments.
	if cfg.ydwgEnabled {
		sim := newYdwgSim(cfg.ydwgAddr, cfg.ydwgMMSI, cfg.ydwgName, func() (float64, float64) {
			return state.lat, state.lon
		})
		go sim.run(ctx)
	}

	ticker := time.NewTicker(cfg.publishPeriod)
	defer ticker.Stop()

	prefix := "N/" + cfg.vrmID + "/"
	emit := func(path string, value any) {
		body, _ := json.Marshal(map[string]any{"value": value})
		client.Publish(prefix+path, 0, false, body)
	}

	publishedOnce := false
	for {
		select {
		case <-ctx.Done():
			log.Printf("[cerbo-emu] shutting down")
			return
		case now := <-ticker.C:
			ka := lastKA.Load()
			alive := cfg.publishWithout ||
				(ka > 0 && now.Sub(time.Unix(0, ka)) <= cfg.keepaliveGrace)
			if !alive {
				if publishedOnce {
					log.Printf("[cerbo-emu] no recent keepalive; going silent")
					publishedOnce = false
				}
				continue
			}
			if !publishedOnce {
				log.Printf("[cerbo-emu] keepalive seen, publishing on %s*", prefix)
				publishedOnce = true
			}
			state.tick(now)
			emit("system/0/Dc/Battery/Voltage", round(state.batteryV, 2))
			emit("system/0/Dc/Battery/Soc", int(math.Round(state.batterySoc)))
			source := 240 // disconnected
			if state.shorePower {
				source = 1
			}
			emit("system/0/Ac/ActiveIn/Source", source)
			emit("system/0/Position/Latitude", round(state.lat, 6))
			emit("system/0/Position/Longitude", round(state.lon, 6))
			emit("temperature/0/Temperature", round(state.cabinTempC, 1))
			emit("temperature/0/Humidity", int(math.Round(state.cabinHumidity)))
		}
	}
}

func round(f float64, places int) float64 {
	p := math.Pow10(places)
	return math.Round(f*p) / p
}

// driftState produces slow, plausible drift instead of pure randomness.
type driftState struct {
	rng           *rand.Rand
	batteryV      float64
	batterySoc    float64
	shorePower    bool
	shoreCounter  int
	lat, lon      float64
	cabinTempC    float64
	cabinHumidity float64
}

func newState(r *rand.Rand, lat, lon float64) *driftState {
	return &driftState{
		rng:           r,
		batteryV:      12.8,
		batterySoc:    78,
		shorePower:    true,
		lat:           lat,
		lon:           lon,
		cabinTempC:    14,
		cabinHumidity: 65,
	}
}

func (s *driftState) tick(now time.Time) {
	jitter := func(scale float64) float64 { return (s.rng.Float64()*2 - 1) * scale }
	// Battery: when on shore power, slowly charge; otherwise slowly drain.
	if s.shorePower {
		s.batterySoc = clamp(s.batterySoc+0.05+jitter(0.02), 35, 100)
		s.batteryV = clamp(13.4+jitter(0.05), 13.0, 13.7)
	} else {
		s.batterySoc = clamp(s.batterySoc-0.04+jitter(0.02), 35, 100)
		s.batteryV = clamp(12.4+jitter(0.05), 12.0, 12.8)
	}
	// Flip shore power every ~10 minutes for variety.
	s.shoreCounter++
	if s.shoreCounter > 120 {
		s.shorePower = !s.shorePower
		s.shoreCounter = 0
	}
	// Tiny GPS drift (boat moving slightly on lines).
	s.lat += jitter(0.00002)
	s.lon += jitter(0.00003)
	// Cabin temp follows local time-of-day with jitter.
	hour := float64(now.Hour()) + float64(now.Minute())/60
	target := 13 + 6*math.Sin((hour-6)*math.Pi/12) // 7..19 °C
	s.cabinTempC += (target - s.cabinTempC) * 0.05
	s.cabinHumidity = clamp(65+jitter(2), 50, 85)
}

func clamp(v, lo, hi float64) float64 {
	switch {
	case v < lo:
		return lo
	case v > hi:
		return hi
	}
	return v
}
