package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
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
