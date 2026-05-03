// ais-cache: persistent AISStream relay with HTTP/SSE API.
//
//   - Maintains ONE WebSocket to wss://stream.aisstream.io/v0/stream
//   - Auto-reconnects with exponential backoff
//   - Persists every position fix in-memory + optional Upstash REST mirror
//   - Exposes:
//       GET  /healthz
//       GET  /api/v1/snapshot?mmsi=NNN
//       GET  /api/v1/snapshots?mmsi=A,B,C
//       GET  /api/v1/bbox?lat1=..&lon1=..&lat2=..&lon2=..
//       GET  /api/v1/stream?mmsi=A,B  (SSE)
//       GET  /api/v1/stats
//
// Auth: optional bearer token via HTTP_AUTH_TOKEN env var.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// ---------- types ----------

type Snapshot struct {
	MMSI      string  `json:"mmsi"`
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Sog       float64 `json:"sog"`
	Cog       float64 `json:"cog"`
	Heading   int     `json:"heading"`
	NavStatus int     `json:"navStatus"`
	Name      string  `json:"name,omitempty"`
	Type      int     `json:"type,omitempty"`
	Dest      string  `json:"destination,omitempty"`
	TS        int64   `json:"ts"` // ms epoch
}

type aisMessage struct {
	MessageType string                 `json:"MessageType"`
	MetaData    map[string]any         `json:"MetaData"`
	Message     map[string]any         `json:"Message"`
	Error       string                 `json:"error,omitempty"`
}

// ---------- config ----------

type Config struct {
	APIKey         string
	BBoxes         [][][]float64
	MMSIFilter     []string
	HTTPAuth       string
	UpstashURL     string
	UpstashTok     string
	Port           string
	SnapshotTTL    time.Duration
	TrackMaxPoints int
	TrackMaxAgeDay int
	TrackMinSepSec int
	TrackMinSepM   float64
	MarinaLat      float64
	MarinaLon      float64
}

func loadConfig() (*Config, error) {
	c := &Config{
		APIKey:         os.Getenv("AISSTREAM_API_KEY"),
		HTTPAuth:       os.Getenv("HTTP_AUTH_TOKEN"),
		UpstashURL:     strings.TrimRight(os.Getenv("UPSTASH_REDIS_REST_URL"), "/"),
		UpstashTok:     os.Getenv("UPSTASH_REDIS_REST_TOKEN"),
		Port:           os.Getenv("PORT"),
		SnapshotTTL:    time.Hour,
		TrackMaxPoints: envInt("TRACK_MAX_POINTS", 5000),
		TrackMaxAgeDay: envInt("TRACK_MAX_AGE_DAYS", 60),
		TrackMinSepSec: envInt("TRACK_MIN_SEP_SECONDS", 30),
		TrackMinSepM:   envFloat("TRACK_MIN_SEP_METERS", 25),
		MarinaLat:      envFloat("MARINA_LAT", 59.574),
		MarinaLon:      envFloat("MARINA_LON", 25.7428),
	}
	if c.APIKey == "" {
		return nil, errors.New("AISSTREAM_API_KEY is required")
	}
	if c.Port == "" {
		c.Port = "8080"
	}
	if v := os.Getenv("SNAPSHOT_TTL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.SnapshotTTL = time.Duration(n) * time.Second
		}
	}
	// BBoxes JSON, default = Gulf of Finland + Estonia.
	bbRaw := os.Getenv("AIS_BBOXES")
	if bbRaw == "" {
		bbRaw = `[[[60.5,22.0],[57.5,30.5]]]`
	}
	if err := json.Unmarshal([]byte(bbRaw), &c.BBoxes); err != nil {
		return nil, fmt.Errorf("AIS_BBOXES invalid JSON: %w", err)
	}
	if v := os.Getenv("AIS_MMSI_FILTER"); v != "" {
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" {
				c.MMSIFilter = append(c.MMSIFilter, p)
			}
		}
	}
	return c, nil
}

// ---------- store ----------

type Store struct {
	mu        sync.RWMutex
	snaps     map[string]Snapshot
	subs      map[chan Snapshot]map[string]struct{} // subscriber -> watched MMSIs (empty = all)
	subsMu    sync.RWMutex
	ttl       time.Duration
	msgCount  atomic.Uint64
	lastMsgAt atomic.Int64
}

func NewStore(ttl time.Duration) *Store {
	return &Store{
		snaps: make(map[string]Snapshot),
		subs:  make(map[chan Snapshot]map[string]struct{}),
		ttl:   ttl,
	}
}

func (s *Store) Put(snap Snapshot) {
	s.mu.Lock()
	prev, ok := s.snaps[snap.MMSI]
	if ok {
		// preserve enrichments not present in the new fix
		if snap.Name == "" {
			snap.Name = prev.Name
		}
		if snap.Dest == "" {
			snap.Dest = prev.Dest
		}
		if snap.Type == 0 {
			snap.Type = prev.Type
		}
	}
	s.snaps[snap.MMSI] = snap
	s.mu.Unlock()
	s.fanout(snap)
}

func (s *Store) PatchStatic(mmsi string, name, dest string, typ int) {
	if mmsi == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.snaps[mmsi]
	if !ok {
		cur = Snapshot{MMSI: mmsi, TS: time.Now().UnixMilli()}
	}
	if name != "" {
		cur.Name = name
	}
	if dest != "" {
		cur.Dest = dest
	}
	if typ != 0 {
		cur.Type = typ
	}
	s.snaps[mmsi] = cur
}

func (s *Store) Get(mmsi string) (Snapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.snaps[mmsi]
	if !ok {
		return Snapshot{}, false
	}
	if s.ttl > 0 && time.Since(time.UnixMilli(v.TS)) > s.ttl {
		return Snapshot{}, false
	}
	return v, true
}

func (s *Store) GetMany(mmsis []string) []Snapshot {
	out := make([]Snapshot, 0, len(mmsis))
	for _, m := range mmsis {
		if v, ok := s.Get(m); ok {
			out = append(out, v)
		}
	}
	return out
}

func (s *Store) InBBox(lat1, lon1, lat2, lon2 float64) []Snapshot {
	minLat, maxLat := math.Min(lat1, lat2), math.Max(lat1, lat2)
	minLon, maxLon := math.Min(lon1, lon2), math.Max(lon1, lon2)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Snapshot, 0, 32)
	cutoff := time.Now().Add(-s.ttl).UnixMilli()
	for _, v := range s.snaps {
		if v.TS < cutoff {
			continue
		}
		if v.Lat >= minLat && v.Lat <= maxLat && v.Lon >= minLon && v.Lon <= maxLon {
			out = append(out, v)
		}
	}
	return out
}

func (s *Store) Sweep() {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-s.ttl).UnixMilli()
	for k, v := range s.snaps {
		if v.TS < cutoff {
			delete(s.snaps, k)
		}
	}
}

func (s *Store) Stats() map[string]any {
	s.mu.RLock()
	n := len(s.snaps)
	s.mu.RUnlock()
	last := s.lastMsgAt.Load()
	ageMs := int64(0)
	if last > 0 {
		ageMs = time.Now().UnixMilli() - last
	}
	return map[string]any{
		"vessels_tracked":  n,
		"messages_total":   s.msgCount.Load(),
		"last_msg_age_ms":  ageMs,
		"ttl_seconds":      int(s.ttl.Seconds()),
	}
}

// pub/sub
func (s *Store) Subscribe(mmsis []string) chan Snapshot {
	ch := make(chan Snapshot, 32)
	set := make(map[string]struct{}, len(mmsis))
	for _, m := range mmsis {
		set[m] = struct{}{}
	}
	s.subsMu.Lock()
	s.subs[ch] = set
	s.subsMu.Unlock()
	return ch
}

func (s *Store) Unsubscribe(ch chan Snapshot) {
	s.subsMu.Lock()
	delete(s.subs, ch)
	s.subsMu.Unlock()
	close(ch)
}

func (s *Store) fanout(snap Snapshot) {
	s.subsMu.RLock()
	defer s.subsMu.RUnlock()
	for ch, watch := range s.subs {
		if len(watch) > 0 {
			if _, ok := watch[snap.MMSI]; !ok {
				continue
			}
		}
		select {
		case ch <- snap:
		default: // drop if subscriber is slow
		}
	}
}

// ---------- AISStream client ----------

type subscribeMsg struct {
	APIKey             string        `json:"APIKey"`
	BoundingBoxes      [][][]float64 `json:"BoundingBoxes"`
	FiltersShipMMSI    []string      `json:"FiltersShipMMSI,omitempty"`
	FilterMessageTypes []string      `json:"FilterMessageTypes,omitempty"`
}

func runAISClient(ctx context.Context, cfg *Config, store *Store, tracks *TrackStore, mirror *Upstash) {
	backoff := time.Second
	maxBackoff := 60 * time.Second
	for ctx.Err() == nil {
		if err := connectOnce(ctx, cfg, store, tracks, mirror); err != nil {
			log.Printf("ais ws disconnected: %v (reconnect in %s)", err, backoff)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func connectOnce(parent context.Context, cfg *Config, store *Store, tracks *TrackStore, mirror *Upstash) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	dialCtx, dialCancel := context.WithTimeout(ctx, 15*time.Second)
	defer dialCancel()
	conn, _, err := websocket.Dial(dialCtx, "wss://stream.aisstream.io/v0/stream", nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	conn.SetReadLimit(1 << 20)
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	sub := subscribeMsg{
		APIKey:        cfg.APIKey,
		BoundingBoxes: cfg.BBoxes,
		FilterMessageTypes: []string{
			"PositionReport",
			"StandardClassBPositionReport",
			"ExtendedClassBPositionReport",
			"ShipStaticData",
			"StaticDataReport",
		},
	}
	if len(cfg.MMSIFilter) > 0 {
		sub.FiltersShipMMSI = cfg.MMSIFilter
	}
	if err := wsjson.Write(ctx, conn, sub); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	log.Printf("ais ws subscribed: bboxes=%d mmsi_filter=%d", len(cfg.BBoxes), len(cfg.MMSIFilter))

	// Heartbeat: if no message for 90s, force reconnect.
	heartbeat := time.AfterFunc(90*time.Second, func() {
		log.Printf("ais ws heartbeat timeout — closing")
		conn.Close(websocket.StatusGoingAway, "heartbeat")
	})
	defer heartbeat.Stop()

	for {
		var raw json.RawMessage
		if err := wsjson.Read(ctx, conn, &raw); err != nil {
			return fmt.Errorf("read: %w", err)
		}
		heartbeat.Reset(90 * time.Second)
		store.msgCount.Add(1)
		store.lastMsgAt.Store(time.Now().UnixMilli())

		var msg aisMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.Error != "" {
			log.Printf("ais ws error message: %s", msg.Error)
			continue
		}
		handleMessage(ctx, cfg, &msg, store, tracks, mirror)
	}
}

func handleMessage(ctx context.Context, cfg *Config, m *aisMessage, store *Store, tracks *TrackStore, mirror *Upstash) {
	mmsi := mmsiFromMeta(m.MetaData)
	if mmsi == "" {
		return
	}
	switch m.MessageType {
	case "PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport":
		body := firstObject(m.Message)
		if body == nil {
			return
		}
		snap := Snapshot{
			MMSI:      mmsi,
			Lat:       fnum(body, "Latitude"),
			Lon:       fnum(body, "Longitude"),
			Sog:       fnum(body, "Sog"),
			Cog:       fnum(body, "Cog"),
			Heading:   inum(body, "TrueHeading"),
			NavStatus: inum(body, "NavigationalStatus"),
			Name:      strFromMeta(m.MetaData, "ShipName"),
			TS:        time.Now().UnixMilli(),
		}
		if math.IsNaN(snap.Lat) || math.IsNaN(snap.Lon) || (snap.Lat == 0 && snap.Lon == 0) {
			return
		}
		store.Put(snap)
		tp := TrackPoint{Lat: snap.Lat, Lon: snap.Lon, Sog: snap.Sog, Cog: snap.Cog, TS: snap.TS}
		if tracks.Append(snap.MMSI, tp) && mirror != nil {
			go mirror.AppendTrack(ctx, snap.MMSI, tp, cfg.TrackMaxPoints, cfg.TrackMaxAgeDay)
		}
		if mirror != nil {
			go mirror.PutSnapshot(ctx, snap)
		}
	case "ShipStaticData", "StaticDataReport":
		body := firstObject(m.Message)
		if body == nil {
			return
		}
		name := snum(body, "Name")
		dest := snum(body, "Destination")
		typ := inum(body, "Type")
		store.PatchStatic(mmsi, name, dest, typ)
	}
}

// ---------- Upstash REST mirror ----------

type Upstash struct {
	URL   string
	Token string
	HTTP  *http.Client
}

func NewUpstash(url, token string) *Upstash {
	if url == "" || token == "" {
		return nil
	}
	return &Upstash{URL: url, Token: token, HTTP: &http.Client{Timeout: 5 * time.Second}}
}

func (u *Upstash) PutSnapshot(ctx context.Context, snap Snapshot) {
	body, err := json.Marshal(snap)
	if err != nil {
		return
	}
	// SET key value EX ttl
	cmd := []any{"SET", "ais:snap:" + snap.MMSI, string(body), "EX", 3600}
	payload, _ := json.Marshal(cmd)
	req, _ := http.NewRequestWithContext(ctx, "POST", u.URL, strings.NewReader(string(payload)))
	req.Header.Set("Authorization", "Bearer "+u.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := u.HTTP.Do(req)
	if err != nil {
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// ---------- HTTP API ----------

func newServer(cfg *Config, store *Store, tracks *TrackStore) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "ok")
	})

	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if cfg.HTTPAuth != "" {
				got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
				if got != cfg.HTTPAuth {
					http.Error(w, "unauthorized", 401)
					return
				}
			}
			w.Header().Set("Access-Control-Allow-Origin", "*")
			h(w, r)
		}
	}

	mux.HandleFunc("/api/v1/snapshot", auth(func(w http.ResponseWriter, r *http.Request) {
		mmsi := r.URL.Query().Get("mmsi")
		if mmsi == "" {
			http.Error(w, "mmsi required", 400)
			return
		}
		v, ok := store.Get(mmsi)
		if !ok {
			writeJSON(w, map[string]any{"mmsi": mmsi, "found": false}, 200)
			return
		}
		writeJSON(w, v, 200)
	}))

	mux.HandleFunc("/api/v1/snapshots", auth(func(w http.ResponseWriter, r *http.Request) {
		raw := r.URL.Query().Get("mmsi")
		if raw == "" {
			http.Error(w, "mmsi required (comma-separated)", 400)
			return
		}
		ids := strings.Split(raw, ",")
		writeJSON(w, store.GetMany(ids), 200)
	}))

	mux.HandleFunc("/api/v1/bbox", auth(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		lat1, _ := strconv.ParseFloat(q.Get("lat1"), 64)
		lon1, _ := strconv.ParseFloat(q.Get("lon1"), 64)
		lat2, _ := strconv.ParseFloat(q.Get("lat2"), 64)
		lon2, _ := strconv.ParseFloat(q.Get("lon2"), 64)
		writeJSON(w, store.InBBox(lat1, lon1, lat2, lon2), 200)
	}))

	mux.HandleFunc("/api/v1/stream", auth(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		raw := r.URL.Query().Get("mmsi")
		var ids []string
		if raw != "" {
			ids = strings.Split(raw, ",")
		}
		ch := store.Subscribe(ids)
		defer store.Unsubscribe(ch)
		fmt.Fprintf(w, ": connected\n\n")
		flusher.Flush()
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ping.C:
				fmt.Fprintf(w, ": ping\n\n")
				flusher.Flush()
			case s := <-ch:
				b, _ := json.Marshal(s)
				fmt.Fprintf(w, "data: %s\n\n", b)
				flusher.Flush()
			}
		}
	}))

	mux.HandleFunc("/api/v1/stats", auth(func(w http.ResponseWriter, r *http.Request) {
		st := store.Stats()
		st["track_points_total"] = tracks.Total()
		st["track_max_points_per_mmsi"] = cfg.TrackMaxPoints
		st["track_max_age_days"] = cfg.TrackMaxAgeDay
		st["marina"] = map[string]float64{"lat": cfg.MarinaLat, "lon": cfg.MarinaLon}
		writeJSON(w, st, 200)
	}))

	mux.HandleFunc("/api/v1/track", auth(func(w http.ResponseWriter, r *http.Request) {
		mmsi := r.URL.Query().Get("mmsi")
		if mmsi == "" {
			http.Error(w, "mmsi required", 400)
			return
		}
		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		pts := tracks.Get(mmsi, since, limit)
		writeJSON(w, map[string]any{
			"mmsi":   mmsi,
			"count":  len(pts),
			"points": pts,
		}, 200)
	}))

	mux.HandleFunc("/api/v1/trips", auth(func(w http.ResponseWriter, r *http.Request) {
		mmsi := r.URL.Query().Get("mmsi")
		if mmsi == "" {
			http.Error(w, "mmsi required", 400)
			return
		}
		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		pts := tracks.Get(mmsi, since, 0)
		trips := DetectTrips(pts, cfg.MarinaLat, cfg.MarinaLon)
		writeJSON(w, map[string]any{
			"mmsi":   mmsi,
			"marina": map[string]float64{"lat": cfg.MarinaLat, "lon": cfg.MarinaLon},
			"count":  len(trips),
			"trips":  trips,
		}, 200)
	}))

	mux.HandleFunc("/api/v1/summary", auth(func(w http.ResponseWriter, r *http.Request) {
		mmsi := r.URL.Query().Get("mmsi")
		if mmsi == "" {
			http.Error(w, "mmsi required", 400)
			return
		}
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		var since int64
		if days > 0 {
			since = time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
		}
		pts := tracks.Get(mmsi, since, 0)
		summ := DailySummaries(pts, cfg.MarinaLat, cfg.MarinaLon)
		writeJSON(w, map[string]any{
			"mmsi":  mmsi,
			"days":  len(summ),
			"daily": summ,
		}, 200)
	}))

	return mux
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func mmsiFromMeta(meta map[string]any) string {
	if meta == nil {
		return ""
	}
	if v, ok := meta["MMSI"]; ok {
		switch t := v.(type) {
		case float64:
			return strconv.FormatInt(int64(t), 10)
		case string:
			return t
		}
	}
	return ""
}

func strFromMeta(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	if v, ok := meta[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func firstObject(m map[string]any) map[string]any {
	for _, v := range m {
		if obj, ok := v.(map[string]any); ok {
			return obj
		}
	}
	return nil
}

func fnum(m map[string]any, k string) float64 {
	if v, ok := m[k].(float64); ok {
		return v
	}
	return math.NaN()
}

func inum(m map[string]any, k string) int {
	if v, ok := m[k].(float64); ok {
		return int(v)
	}
	return 0
}

func snum(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return strings.TrimSpace(strings.TrimRight(v, "@ "))
	}
	return ""
}

// ---------- main ----------

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	store := NewStore(cfg.SnapshotTTL)
	tracks := NewTrackStore(
		cfg.TrackMaxPoints,
		time.Duration(cfg.TrackMaxAgeDay)*24*time.Hour,
		time.Duration(cfg.TrackMinSepSec)*time.Second,
		cfg.TrackMinSepM,
	)
	mirror := NewUpstash(cfg.UpstashURL, cfg.UpstashTok)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Restore tracks from Upstash on startup so the service survives restarts.
	if mirror != nil {
		loadCtx, loadCancel := context.WithTimeout(ctx, 30*time.Second)
		keys, points := mirror.LoadAllTracks(loadCtx, tracks)
		loadCancel()
		log.Printf("upstash restore: %d mmsis, %d points loaded", keys, points)
	}

	go runAISClient(ctx, cfg, store, tracks, mirror)

	// periodic sweep
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				store.Sweep()
			}
		}
	}()

	log.Printf("ais-cache listening on :%s", cfg.Port)
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newServer(cfg, store, tracks),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("http: %v", err)
	}
}
