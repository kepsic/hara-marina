// emtrak-forwarder is a tiny single-purpose daemon that connects to an em-trak
// B-class AIS transponder's WiFi NMEA 0183 TCP server, decodes AIVDO/AIVDM
// sentences, and POSTs each fix to the central ais-cache HTTP API.
//
// No MQTT, no Cerbo, no broker dependencies — everything it needs is HTTP +
// one TCP socket. Designed to drop onto:
//
//   - A Cerbo GX (opkg + SetupHelper) — armhf or arm64 depending on model
//   - A Raspberry Pi joined to the em-trak WiFi
//   - A laptop/desktop on the same LAN (for testing)
//
// All configuration is via environment variables. See README.md.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/kepsic/hara-marina/marina-bridge/internal/aisingest"
	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
	"github.com/kepsic/hara-marina/marina-bridge/internal/sources/emtrak"
)

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
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

func main() {
	addr := flag.String("emtrak", envOr("EMTRAK_ADDRESS", "192.168.1.1:39150"), "em-trak WiFi NMEA TCP host:port")
	url := flag.String("ingest-url", envOr("AIS_INGEST_URL", ""), "ais-cache base URL (https://...)")
	token := flag.String("ingest-token", envOr("AIS_INGEST_TOKEN", ""), "ais-cache bearer token")
	mmsi := flag.String("mmsi", envOr("AIS_INGEST_MMSI", ""), "fallback MMSI for own-vessel fixes")
	name := flag.String("name", envOr("AIS_INGEST_NAME", ""), "friendly name forwarded to cache")
	flag.Parse()

	if *url == "" {
		log.Fatal("AIS_INGEST_URL (or -ingest-url) is required")
	}
	if *addr == "" {
		log.Fatal("EMTRAK_ADDRESS (or -emtrak) is required")
	}

	pusher := aisingest.NewPusher(config.AisIngestConfig{
		Enabled: true,
		URL:     *url,
		Token:   *token,
		MMSI:    *mmsi,
		Name:    *name,
	})
	if pusher == nil {
		log.Fatal("aisingest.NewPusher returned nil — check AIS_INGEST_URL and AIS_INGEST_MMSI")
	}

	emCfg := config.EmtrakConfig{
		Enabled: envBool("EMTRAK_ENABLED", true),
		Address: *addr,
	}

	log.Printf("[emtrak-fwd] starting; emtrak=%s ingest=%s mmsi=%s name=%s",
		emCfg.Address, *url, *mmsi, *name)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := emtrak.Run(ctx, emCfg, pusher); err != nil {
		log.Printf("[emtrak-fwd] exited: %v", err)
		time.Sleep(2 * time.Second)
		os.Exit(1)
	}
}
