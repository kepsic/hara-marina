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
	"log/slog"
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

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func main() {
	mode := flag.String("mode", envOr("EMTRAK_MODE", "auto"), "transport: auto|serial|tcp")
	addr := flag.String("emtrak", envOr("EMTRAK_ADDRESS", "192.168.1.1:39150"), "em-trak WiFi NMEA TCP host:port (used for tcp/auto)")
	serialDev := flag.String("serial-device", envOr("EMTRAK_SERIAL_DEVICE", ""), "explicit serial device path (empty = autodiscover /dev/ttyACM*)")
	serialBaud := flag.Int("serial-baud", envInt("EMTRAK_SERIAL_BAUD", 38400), "serial baud rate")
	url := flag.String("ingest-url", envOr("AIS_INGEST_URL", ""), "ais-cache base URL (https://...)")
	token := flag.String("ingest-token", envOr("AIS_INGEST_TOKEN", ""), "ais-cache bearer token")
	mmsi := flag.String("mmsi", envOr("AIS_INGEST_MMSI", ""), "fallback MMSI for own-vessel fixes")
	name := flag.String("name", envOr("AIS_INGEST_NAME", ""), "friendly name forwarded to cache")
	flag.Parse()

	if *url == "" {
		slog.Error("AIS_INGEST_URL is required", "source", "emtrak-fwd")
		os.Exit(1)
	}
	switch *mode {
	case "auto", "serial", "tcp":
	default:
		slog.Error("invalid mode", "source", "emtrak-fwd", "mode", *mode)
		os.Exit(1)
	}
	if *mode == "tcp" && *addr == "" {
		slog.Error("-emtrak / EMTRAK_ADDRESS required in tcp mode", "source", "emtrak-fwd")
		os.Exit(1)
	}

	pusher := aisingest.NewPusher(config.AisIngestConfig{
		Enabled: true,
		URL:     *url,
		Token:   *token,
		MMSI:    *mmsi,
		Name:    *name,
	})
	if pusher == nil {
		slog.Error("aisingest.NewPusher returned nil", "source", "emtrak-fwd")
		os.Exit(1)
	}

	emCfg := config.EmtrakConfig{
		Enabled:      envBool("EMTRAK_ENABLED", true),
		Mode:         *mode,
		Address:      *addr,
		SerialDevice: *serialDev,
		SerialBaud:   *serialBaud,
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})))

	slog.Info("starting", "source", "emtrak-fwd", "mode", emCfg.Mode, "tcp", emCfg.Address, "serial", emCfg.SerialDevice, "baud", emCfg.SerialBaud, "ingest", *url, "mmsi", *mmsi, "name", *name)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := emtrak.Run(ctx, emCfg, pusher); err != nil {
		slog.Error("emtrak run exited with error", "source", "emtrak-fwd", "err", err)
		time.Sleep(2 * time.Second)
		os.Exit(1)
	}
}
