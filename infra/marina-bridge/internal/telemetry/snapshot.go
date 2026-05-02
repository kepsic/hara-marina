package telemetry

import (
	"sync"
	"time"
)

// Snapshot is the in-memory state each source updates concurrently.
// Encoder reads the snapshot and emits the JSON the marina ingest endpoint
// expects (see /pages/api/ingest/telemetry.js).
type Snapshot struct {
	mu sync.RWMutex

	BatteryVoltage   *float64
	BatteryPercent   *float64
	ShorePower       *bool
	BilgeWaterCm     *float64
	BilgePump24h     *float64
	CabinTempC       *float64
	CabinHumidityPct *float64
	HeelDeg          *float64
	Lat              *float64
	Lon              *float64

	LastUpdated time.Time
}

// Setters used by sources. nil-safe in that they coalesce by simple overwrite.

func (s *Snapshot) SetBatteryVoltage(v float64)   { s.set(func() { s.BatteryVoltage = &v }) }
func (s *Snapshot) SetBatteryPercent(v float64)   { s.set(func() { s.BatteryPercent = &v }) }
func (s *Snapshot) SetShorePower(v bool)          { s.set(func() { s.ShorePower = &v }) }
func (s *Snapshot) SetBilgeWaterCm(v float64)     { s.set(func() { s.BilgeWaterCm = &v }) }
func (s *Snapshot) SetBilgePump24h(v float64)     { s.set(func() { s.BilgePump24h = &v }) }
func (s *Snapshot) SetCabinTempC(v float64)       { s.set(func() { s.CabinTempC = &v }) }
func (s *Snapshot) SetCabinHumidityPct(v float64) { s.set(func() { s.CabinHumidityPct = &v }) }
func (s *Snapshot) SetHeelDeg(v float64)          { s.set(func() { s.HeelDeg = &v }) }
func (s *Snapshot) SetPosition(lat, lon float64)  { s.set(func() { s.Lat = &lat; s.Lon = &lon }) }

func (s *Snapshot) set(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn()
	s.LastUpdated = time.Now()
}

// MarshalIngest returns the JSON-able map matching the marina schema.
func (s *Snapshot) MarshalIngest(slug string) map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]any{
		"slug": slug,
		"ts":   time.Now().UnixMilli(),
	}
	if s.BatteryVoltage != nil || s.BatteryPercent != nil {
		b := map[string]any{}
		if s.BatteryVoltage != nil {
			b["voltage"] = *s.BatteryVoltage
		}
		if s.BatteryPercent != nil {
			b["percent"] = *s.BatteryPercent
		}
		out["battery"] = b
	}
	if s.ShorePower != nil {
		out["shore_power"] = *s.ShorePower
	}
	if s.BilgeWaterCm != nil || s.BilgePump24h != nil {
		b := map[string]any{}
		if s.BilgeWaterCm != nil {
			b["water_cm"] = *s.BilgeWaterCm
		}
		if s.BilgePump24h != nil {
			b["pump_cycles_24h"] = *s.BilgePump24h
		}
		out["bilge"] = b
	}
	if s.CabinTempC != nil || s.CabinHumidityPct != nil {
		c := map[string]any{}
		if s.CabinTempC != nil {
			c["temperature_c"] = *s.CabinTempC
		}
		if s.CabinHumidityPct != nil {
			c["humidity_pct"] = *s.CabinHumidityPct
		}
		out["cabin"] = c
	}
	if s.HeelDeg != nil {
		out["heel_deg"] = *s.HeelDeg
	}
	if s.Lat != nil && s.Lon != nil {
		out["position"] = map[string]any{"lat": *s.Lat, "lon": *s.Lon}
	}
	return out
}
