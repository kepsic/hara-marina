package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var osGetenv = os.Getenv

// ---------- types ----------

type TrackPoint struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
	Sog float64 `json:"sog"`
	Cog float64 `json:"cog"`
	TS  int64   `json:"ts"`
}

// ---------- in-memory store ----------

type TrackStore struct {
	mu        sync.RWMutex
	tracks    map[string][]TrackPoint
	maxPoints int
	maxAge    time.Duration
	minSepM   float64
	minSepDur time.Duration
}

func NewTrackStore(maxPoints int, maxAge, minSepDur time.Duration, minSepM float64) *TrackStore {
	return &TrackStore{
		tracks:    make(map[string][]TrackPoint),
		maxPoints: maxPoints,
		maxAge:    maxAge,
		minSepDur: minSepDur,
		minSepM:   minSepM,
	}
}

// Append returns true when the point is materially new (kept).
func (t *TrackStore) Append(mmsi string, p TrackPoint) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	pts := t.tracks[mmsi]
	if n := len(pts); n > 0 {
		last := pts[n-1]
		dt := time.Duration(p.TS-last.TS) * time.Millisecond
		if dt < t.minSepDur && haversineMeters(last.Lat, last.Lon, p.Lat, p.Lon) < t.minSepM {
			return false
		}
	}
	pts = append(pts, p)
	if t.maxAge > 0 {
		cutoff := time.Now().Add(-t.maxAge).UnixMilli()
		i := 0
		for i < len(pts) && pts[i].TS < cutoff {
			i++
		}
		if i > 0 {
			pts = pts[i:]
		}
	}
	if t.maxPoints > 0 && len(pts) > t.maxPoints {
		pts = pts[len(pts)-t.maxPoints:]
	}
	t.tracks[mmsi] = pts
	return true
}

// Replace bulk-loads a track (used on startup from Upstash).
func (t *TrackStore) Replace(mmsi string, pts []TrackPoint) {
	if len(pts) == 0 {
		return
	}
	sort.Slice(pts, func(i, j int) bool { return pts[i].TS < pts[j].TS })
	t.mu.Lock()
	t.tracks[mmsi] = pts
	t.mu.Unlock()
}

func (t *TrackStore) Get(mmsi string, sinceMs int64, limit int) []TrackPoint {
	t.mu.RLock()
	defer t.mu.RUnlock()
	pts := t.tracks[mmsi]
	if sinceMs > 0 {
		i := sort.Search(len(pts), func(i int) bool { return pts[i].TS >= sinceMs })
		pts = pts[i:]
	}
	if limit > 0 && len(pts) > limit {
		pts = pts[len(pts)-limit:]
	}
	out := make([]TrackPoint, len(pts))
	copy(out, pts)
	return out
}

func (t *TrackStore) Counts() map[string]int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	out := make(map[string]int, len(t.tracks))
	for k, v := range t.tracks {
		out[k] = len(v)
	}
	return out
}

func (t *TrackStore) Total() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	n := 0
	for _, v := range t.tracks {
		n += len(v)
	}
	return n
}

// ---------- Upstash mirror for tracks ----------

func trackKey(mmsi string) string { return "ais:track:" + mmsi }

// AppendTrack: LPUSH new point + LTRIM to maxPoints + EXPIRE in one pipeline call.
func (u *Upstash) AppendTrack(ctx context.Context, mmsi string, p TrackPoint, maxPoints, ttlDays int) {
	if u == nil {
		return
	}
	body, err := json.Marshal(p)
	if err != nil {
		return
	}
	cmds := [][]any{
		{"LPUSH", trackKey(mmsi), string(body)},
		{"LTRIM", trackKey(mmsi), 0, maxPoints - 1},
	}
	if ttlDays > 0 {
		cmds = append(cmds, []any{"EXPIRE", trackKey(mmsi), ttlDays * 86400})
	}
	payload, _ := json.Marshal(cmds)
	req, _ := http.NewRequestWithContext(ctx, "POST", u.URL+"/pipeline", strings.NewReader(string(payload)))
	req.Header.Set("Authorization", "Bearer "+u.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := u.HTTP.Do(req)
	if err != nil {
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// LoadAllTracks: SCAN ais:track:* keys and LRANGE each into TrackStore.
func (u *Upstash) LoadAllTracks(ctx context.Context, ts *TrackStore) (int, int) {
	if u == nil {
		return 0, 0
	}
	mmsis, err := u.scanKeys(ctx, "ais:track:*")
	if err != nil {
		log.Printf("upstash scan failed: %v", err)
		return 0, 0
	}
	loadedKeys, loadedPoints := 0, 0
	for _, key := range mmsis {
		mmsi := strings.TrimPrefix(key, "ais:track:")
		pts, err := u.lrangeTrack(ctx, key)
		if err != nil || len(pts) == 0 {
			continue
		}
		ts.Replace(mmsi, pts)
		loadedKeys++
		loadedPoints += len(pts)
	}
	return loadedKeys, loadedPoints
}

func (u *Upstash) scanKeys(ctx context.Context, pattern string) ([]string, error) {
	cursor := "0"
	var out []string
	for {
		cmd := []any{"SCAN", cursor, "MATCH", pattern, "COUNT", 500}
		payload, _ := json.Marshal(cmd)
		req, _ := http.NewRequestWithContext(ctx, "POST", u.URL, strings.NewReader(string(payload)))
		req.Header.Set("Authorization", "Bearer "+u.Token)
		req.Header.Set("Content-Type", "application/json")
		resp, err := u.HTTP.Do(req)
		if err != nil {
			return out, err
		}
		var env struct {
			Result []json.RawMessage `json:"result"`
		}
		err = json.NewDecoder(resp.Body).Decode(&env)
		resp.Body.Close()
		if err != nil || len(env.Result) < 2 {
			return out, err
		}
		_ = json.Unmarshal(env.Result[0], &cursor)
		var batch []string
		_ = json.Unmarshal(env.Result[1], &batch)
		out = append(out, batch...)
		if cursor == "0" || cursor == "" {
			break
		}
	}
	return out, nil
}

func (u *Upstash) lrangeTrack(ctx context.Context, key string) ([]TrackPoint, error) {
	cmd := []any{"LRANGE", key, 0, -1}
	payload, _ := json.Marshal(cmd)
	req, _ := http.NewRequestWithContext(ctx, "POST", u.URL, strings.NewReader(string(payload)))
	req.Header.Set("Authorization", "Bearer "+u.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := u.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var env struct {
		Result []string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, err
	}
	out := make([]TrackPoint, 0, len(env.Result))
	for _, s := range env.Result {
		var p TrackPoint
		if err := json.Unmarshal([]byte(s), &p); err == nil && p.TS > 0 {
			out = append(out, p)
		}
	}
	// LPUSH stores newest-first; sort ascending for our store.
	sort.Slice(out, func(i, j int) bool { return out[i].TS < out[j].TS })
	return out, nil
}

// ---------- helpers ----------

// haversineMeters returns the great-circle distance between two points in metres.
func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := rad(lat2 - lat1)
	dLon := rad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * R * math.Asin(math.Min(1, math.Sqrt(a)))
}

// envInt returns env var as int or default.
func envInt(key string, def int) int {
	if v := strings.TrimSpace(osGetenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v := strings.TrimSpace(osGetenv(key)); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			return n
		}
	}
	return def
}
