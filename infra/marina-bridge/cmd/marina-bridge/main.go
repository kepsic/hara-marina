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

	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
	"github.com/kepsic/hara-marina/marina-bridge/internal/marina"
	"github.com/kepsic/hara-marina/marina-bridge/internal/sources/cerbo"
	"github.com/kepsic/hara-marina/marina-bridge/internal/sources/ydwg"
	"github.com/kepsic/hara-marina/marina-bridge/internal/telemetry"
)

func main() {
	cfgPath := flag.String("config", "config.yaml", "path to config file")
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
			if err := ydwg.Run(ctx, cfg.Sources.Ydwg, snap); err != nil {
				log.Printf("[ydwg] exited: %v", err)
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
