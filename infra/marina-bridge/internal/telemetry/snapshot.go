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
	PitchDeg         *float64
	WaterDepthM      *float64
	WaterTempC       *float64
	AirTempC         *float64
	DewpointC        *float64
	PressureMbar    *float64
	BoatSpeedKn     *float64
	LogTotalNm      *float64
	AcVoltageV      *float64
	AcCurrentA      *float64
	AcPowerW        *float64
	AcEnergyKwhTotal *float64
	RelayBank1Relay1 *bool
	RelayBank1Relay2 *bool
	RelayBank1Relay3 *bool
	RelayBank1Relay4 *bool

	// Wind (apparent: relative to bow; true: bearing/relative).
	WindApparentSpeedKn *float64 // 0 .. inf
	WindApparentAngleDeg *float64 // -180..180, +stbd / -port
	WindTrueSpeedKn      *float64
	WindTrueAngleDeg     *float64 // -180..180, relative to bow
	WindTrueDirDeg       *float64 // 0..360, true compass bearing

	// Heading & course over ground (true degrees, 0..360).
	HeadingDeg *float64
	CogDeg     *float64
	SogKn      *float64

	Lat *float64
	Lon *float64

	LastUpdated time.Time
}

// Setters used by sources. nil-safe in that they coalesce by simple overwrite.

func (s *Snapshot) SetBatteryVoltage(v float64)       { s.set(func() { s.BatteryVoltage = &v }) }
func (s *Snapshot) SetBatteryPercent(v float64)       { s.set(func() { s.BatteryPercent = &v }) }
func (s *Snapshot) SetShorePower(v bool)              { s.set(func() { s.ShorePower = &v }) }
func (s *Snapshot) SetBilgeWaterCm(v float64)         { s.set(func() { s.BilgeWaterCm = &v }) }
func (s *Snapshot) SetBilgePump24h(v float64)         { s.set(func() { s.BilgePump24h = &v }) }
func (s *Snapshot) SetCabinTempC(v float64)           { s.set(func() { s.CabinTempC = &v }) }
func (s *Snapshot) SetCabinHumidityPct(v float64)     { s.set(func() { s.CabinHumidityPct = &v }) }
func (s *Snapshot) SetHeelDeg(v float64)              { s.set(func() { s.HeelDeg = &v }) }
func (s *Snapshot) SetPitchDeg(v float64)             { s.set(func() { s.PitchDeg = &v }) }
func (s *Snapshot) SetWaterDepthM(v float64)          { s.set(func() { s.WaterDepthM = &v }) }
func (s *Snapshot) SetWaterTempC(v float64)           { s.set(func() { s.WaterTempC = &v }) }
func (s *Snapshot) SetAirTempC(v float64)             { s.set(func() { s.AirTempC = &v }) }
func (s *Snapshot) SetDewpointC(v float64)            { s.set(func() { s.DewpointC = &v }) }
func (s *Snapshot) SetPressureMbar(v float64)         { s.set(func() { s.PressureMbar = &v }) }
func (s *Snapshot) SetBoatSpeedKn(v float64)          { s.set(func() { s.BoatSpeedKn = &v }) }
func (s *Snapshot) SetLogTotalNm(v float64)           { s.set(func() { s.LogTotalNm = &v }) }
func (s *Snapshot) SetAcVoltageV(v float64)           { s.set(func() { s.AcVoltageV = &v }) }
func (s *Snapshot) SetAcCurrentA(v float64)           { s.set(func() { s.AcCurrentA = &v }) }
func (s *Snapshot) SetAcPowerW(v float64)             { s.set(func() { s.AcPowerW = &v }) }
func (s *Snapshot) SetAcEnergyKwhTotal(v float64)     { s.set(func() { s.AcEnergyKwhTotal = &v }) }
func (s *Snapshot) SetRelayBank1(idx int, on bool) {
	s.set(func() {
		switch idx {
		case 1:
			s.RelayBank1Relay1 = &on
		case 2:
			s.RelayBank1Relay2 = &on
		case 3:
			s.RelayBank1Relay3 = &on
		case 4:
			s.RelayBank1Relay4 = &on
		}
	})
}
func (s *Snapshot) SetWindApparent(speedKn, angleDeg float64) {
	s.set(func() { s.WindApparentSpeedKn = &speedKn; s.WindApparentAngleDeg = &angleDeg })
}
func (s *Snapshot) SetWindTrueRelative(speedKn, angleDeg float64) {
	s.set(func() { s.WindTrueSpeedKn = &speedKn; s.WindTrueAngleDeg = &angleDeg })
}
func (s *Snapshot) SetWindTrueDirection(dirDeg float64) {
	s.set(func() { s.WindTrueDirDeg = &dirDeg })
}
func (s *Snapshot) SetHeadingDeg(v float64) { s.set(func() { s.HeadingDeg = &v }) }
func (s *Snapshot) SetCogDeg(v float64)     { s.set(func() { s.CogDeg = &v }) }
func (s *Snapshot) SetSogKn(v float64)      { s.set(func() { s.SogKn = &v }) }
func (s *Snapshot) SetPosition(lat, lon float64) { s.set(func() { s.Lat = &lat; s.Lon = &lon }) }

func (s *Snapshot) set(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn()
	s.LastUpdated = time.Now()
}

func (s *Snapshot) GetCabinHumidityPct() (float64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.CabinHumidityPct == nil {
		return 0, false
	}
	return *s.CabinHumidityPct, true
}

func (s *Snapshot) GetRelayBank1(idx int) (bool, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var p *bool
	switch idx {
	case 1:
		p = s.RelayBank1Relay1
	case 2:
		p = s.RelayBank1Relay2
	case 3:
		p = s.RelayBank1Relay3
	case 4:
		p = s.RelayBank1Relay4
	}
	if p == nil {
		return false, false
	}
	return *p, true
}

// GetNumericField returns selected telemetry fields by scenario key.
func (s *Snapshot) GetNumericField(field string) (float64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var p *float64
	switch field {
	case "cabin.humidity_pct":
		p = s.CabinHumidityPct
	case "cabin.temperature_c":
		p = s.CabinTempC
	case "dewpoint_c":
		p = s.DewpointC
	case "battery.voltage":
		p = s.BatteryVoltage
	case "battery.percent":
		p = s.BatteryPercent
	case "water_depth_m":
		p = s.WaterDepthM
	case "water_temp_c":
		p = s.WaterTempC
	case "bilge.water_cm":
		p = s.BilgeWaterCm
	case "ac.power_w":
		p = s.AcPowerW
	case "ac.voltage_v":
		p = s.AcVoltageV
	default:
		return 0, false
	}
	if p == nil {
		return 0, false
	}
	return *p, true
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
	if s.PitchDeg != nil {
		out["pitch_deg"] = *s.PitchDeg
	}
	if s.WaterDepthM != nil {
		out["water_depth_m"] = *s.WaterDepthM
	}
	if s.WaterTempC != nil {
		out["water_temp_c"] = *s.WaterTempC
	}
	if s.AirTempC != nil {
		out["air_temp_c"] = *s.AirTempC
	}
	if s.DewpointC != nil {
		out["dewpoint_c"] = *s.DewpointC
	}
	if s.PressureMbar != nil {
		out["pressure_mbar"] = *s.PressureMbar
	}
	if s.BoatSpeedKn != nil {
		out["boat_speed_kn"] = *s.BoatSpeedKn
	}
	if s.LogTotalNm != nil {
		out["log_total_nm"] = *s.LogTotalNm
	}
	if s.AcVoltageV != nil || s.AcCurrentA != nil || s.AcPowerW != nil || s.AcEnergyKwhTotal != nil {
		ac := map[string]any{}
		if s.AcVoltageV != nil {
			ac["voltage_v"] = *s.AcVoltageV
		}
		if s.AcCurrentA != nil {
			ac["current_a"] = *s.AcCurrentA
		}
		if s.AcPowerW != nil {
			ac["power_w"] = *s.AcPowerW
		}
		if s.AcEnergyKwhTotal != nil {
			ac["energy_kwh_total"] = *s.AcEnergyKwhTotal
		}
		out["ac"] = ac
	}
	if s.RelayBank1Relay1 != nil || s.RelayBank1Relay2 != nil || s.RelayBank1Relay3 != nil || s.RelayBank1Relay4 != nil {
		bank1 := map[string]any{}
		if s.RelayBank1Relay1 != nil {
			bank1["relay1"] = *s.RelayBank1Relay1
		}
		if s.RelayBank1Relay2 != nil {
			bank1["relay2"] = *s.RelayBank1Relay2
		}
		if s.RelayBank1Relay3 != nil {
			bank1["relay3"] = *s.RelayBank1Relay3
		}
		if s.RelayBank1Relay4 != nil {
			bank1["relay4"] = *s.RelayBank1Relay4
		}
		out["relays"] = map[string]any{"bank1": bank1}
	}
	if s.WindApparentSpeedKn != nil || s.WindApparentAngleDeg != nil ||
		s.WindTrueSpeedKn != nil || s.WindTrueAngleDeg != nil || s.WindTrueDirDeg != nil {
		w := map[string]any{}
		if s.WindApparentSpeedKn != nil || s.WindApparentAngleDeg != nil {
			a := map[string]any{}
			if s.WindApparentSpeedKn != nil {
				a["speed_kn"] = *s.WindApparentSpeedKn
			}
			if s.WindApparentAngleDeg != nil {
				a["angle_deg"] = *s.WindApparentAngleDeg
			}
			w["apparent"] = a
		}
		if s.WindTrueSpeedKn != nil || s.WindTrueAngleDeg != nil || s.WindTrueDirDeg != nil {
			t := map[string]any{}
			if s.WindTrueSpeedKn != nil {
				t["speed_kn"] = *s.WindTrueSpeedKn
			}
			if s.WindTrueAngleDeg != nil {
				t["angle_deg"] = *s.WindTrueAngleDeg
			}
			if s.WindTrueDirDeg != nil {
				t["direction_deg"] = *s.WindTrueDirDeg
			}
			w["true"] = t
		}
		out["wind"] = w
	}
	if s.HeadingDeg != nil {
		out["heading_deg"] = *s.HeadingDeg
	}
	if s.CogDeg != nil {
		out["cog_deg"] = *s.CogDeg
	}
	if s.SogKn != nil {
		out["sog_kn"] = *s.SogKn
	}
	if s.Lat != nil && s.Lon != nil {
		out["position"] = map[string]any{"lat": *s.Lat, "lon": *s.Lon}
	}
	return out
}
