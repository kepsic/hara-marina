// Package aisingest forwards AIS fixes decoded from the boat's NMEA 2000 bus
// to the central ais-cache HTTP service. This bypasses AISStream's spotty
// shore-receiver coverage — the boat itself becomes the authoritative
// source for her own position.
package aisingest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
)

// AisFix is one AIS position update emitted by the YDWG decoder.
type AisFix struct {
	MMSI    string  `json:"mmsi"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Sog     float64 `json:"sog"`
	Cog     float64 `json:"cog"`
	Heading int     `json:"heading"`
	Name    string  `json:"name,omitempty"`
	Source  string  `json:"source"`
	TS      int64   `json:"ts"`
}

// Pusher is the HTTP forwarder. NewPusher returns nil when the feature is
// disabled — callers should treat nil as "drop the fix silently".
type Pusher struct {
	url      string
	token    string
	mmsi     string
	name     string
	http     *http.Client
	throttle time.Duration

	mu       sync.Mutex
	lastSent time.Time
}

func NewPusher(cfg config.AisIngestConfig) *Pusher {
	if !cfg.Enabled || cfg.URL == "" || cfg.MMSI == "" {
		return nil
	}
	return &Pusher{
		url:      strings.TrimRight(cfg.URL, "/") + "/api/v1/ingest",
		token:    cfg.Token,
		mmsi:     cfg.MMSI,
		name:     cfg.Name,
		http:     &http.Client{Timeout: 5 * time.Second},
		throttle: 5 * time.Second,
	}
}

// Push sends one fix. Throttled to one POST per `throttle` interval to
// avoid hammering the cache when N2K updates arrive at 1–2 Hz.
func (p *Pusher) Push(ctx context.Context, fix AisFix) {
	if p == nil {
		return
	}
	p.mu.Lock()
	if time.Since(p.lastSent) < p.throttle {
		p.mu.Unlock()
		return
	}
	p.lastSent = time.Now()
	p.mu.Unlock()

	if fix.MMSI == "" {
		fix.MMSI = p.mmsi
	}
	if fix.Name == "" {
		fix.Name = p.name
	}
	if fix.Source == "" {
		fix.Source = "marina-bridge"
	}
	if fix.TS == 0 {
		fix.TS = time.Now().UnixMilli()
	}

	body, err := json.Marshal(fix)
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if p.token != "" {
		req.Header.Set("Authorization", "Bearer "+p.token)
	}
	resp, err := p.http.Do(req)
	if err != nil {
		slog.Error("AIS ingest post failed", "source", "aisingest", "err", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		slog.Warn("AIS ingest bad status", "source", "aisingest", "status", resp.StatusCode)
		return
	}
	slog.Debug("AIS fix forwarded", "source", "aisingest", "mmsi", fix.MMSI, "lat", fix.Lat, "lon", fix.Lon, "sog", fix.Sog)
	_ = fmt.Sprintf
}
