// Package n0183 reads NMEA 0183 sentences from a TCP server and updates the
// shared telemetry Snapshot.
//
// This source targets the Yacht Devices YDNR-02's NMEA 0183 TCP server
// (Server #1, default port 1456). The same code works for any device that
// emits standard NMEA 0183 sentences over a line-oriented TCP socket.
//
// Sentences decoded:
//
//	$**DPT  Depth of water below transducer
//	$**DBT  Depth below transducer (alt encoding)
//	$**DBS  Depth below surface
//	$**MTW  Water temperature
//	$**MDA  Meteorological composite (pressure, air temp, dewpoint, wind)
//	$**MWD  Wind direction (true compass bearing)
//	$**MWV  Wind speed and angle (apparent or true, relative to bow)
//	$**VWR  Apparent wind, relative to bow (with L/R indicator)
//	$**VWT  True wind, relative to bow (with L/R indicator)
//	$**VHW  Water speed and heading
//	$**VLW  Distance through water (total + trip)
//	$**XDR  Transducer measurement (temperature, humidity, pitch, roll)
//	$**RMC  Recommended Minimum (lat/lon, fallback)
//	$**GLL  Geographic position (lat/lon, alt)
//
// Talker prefix (the two chars after `$`) is ignored; YDNR emits "YD".
//
// Sentences are LF-terminated (the YDNR uses CRLF; we trim both).
package n0183

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"math"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
	"github.com/kepsic/hara-marina/marina-bridge/internal/telemetry"
)

// Run dials cfg.Address and feeds every parseable sentence into snap.
// Reconnects every 5 s on failure. Returns nil when ctx is cancelled.
func Run(ctx context.Context, cfg config.N0183Config, snap *telemetry.Snapshot) error {
	for {
		if ctx.Err() != nil {
			return nil
		}
		if err := runOnce(ctx, cfg.Address, snap); err != nil {
			slog.Error("n0183 disconnected, reconnecting", "source", "n0183", "err", err)
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(5 * time.Second):
			}
		}
	}
}

func runOnce(ctx context.Context, addr string, snap *telemetry.Snapshot) error {
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	slog.Info("connected", "source", "n0183", "addr", addr)

	go func() { <-ctx.Done(); conn.Close() }()

	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 1024), 64*1024)
	for sc.Scan() {
		parseSentence(sc.Text(), snap)
	}
	return sc.Err()
}

// parseSentence handles one line. Invalid / unknown sentences are dropped.
func parseSentence(raw string, snap *telemetry.Snapshot) {
	line := strings.TrimSpace(raw)
	if len(line) < 7 || line[0] != '$' {
		return
	}
	// Strip checksum suffix "*HH" if present.
	if i := strings.LastIndexByte(line, '*'); i > 0 {
		line = line[:i]
	}
	fields := strings.Split(line[1:], ",")
	if len(fields) < 2 {
		return
	}
	tag := fields[0]
	if len(tag) < 5 {
		return
	}
	switch tag[2:] {
	case "DPT":
		handleDPT(fields[1:], snap)
	case "DBT":
		handleDBT(fields[1:], snap)
	case "DBS":
		handleDBS(fields[1:], snap)
	case "MTW":
		handleMTW(fields[1:], snap)
	case "MDA":
		handleMDA(fields[1:], snap)
	case "MWD":
		handleMWD(fields[1:], snap)
	case "MWV":
		handleMWV(fields[1:], snap)
	case "VWR":
		handleVWR(fields[1:], snap)
	case "VWT":
		handleVWT(fields[1:], snap)
	case "VHW":
		handleVHW(fields[1:], snap)
	case "VLW":
		handleVLW(fields[1:], snap)
	case "XDR":
		handleXDR(fields[1:], snap)
	case "HDT":
		handleHDT(fields[1:], snap)
	case "HDG":
		handleHDG(fields[1:], snap)
	case "RMC":
		handleRMC(fields[1:], snap)
	case "GLL":
		handleGLL(fields[1:], snap)
	}
}

// $**DPT,depth_m,offset_m[,max_range_m]
func handleDPT(f []string, snap *telemetry.Snapshot) {
	if len(f) < 1 {
		return
	}
	if v, ok := parseFloat(f[0]); ok {
		snap.SetWaterDepthM(v)
	}
}

// $**DBT,feet,f,meters,M,fathoms,F
func handleDBT(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 4 {
		if v, ok := parseFloat(f[2]); ok {
			snap.SetWaterDepthM(v)
		}
	}
}

// $**DBS,feet,f,meters,M,fathoms,F  (depth below surface; same shape as DBT)
func handleDBS(f []string, snap *telemetry.Snapshot) {
	// We don't currently distinguish "below surface" from "below transducer";
	// DPT/DBT already populate water_depth_m. Ignore to avoid clobber.
	_ = f
	_ = snap
}

// $**MTW,temp,C — sea water temperature.
func handleMTW(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 1 {
		if v, ok := parseFloat(f[0]); ok {
			snap.SetWaterTempC(v)
		}
	}
}

// $**MDA,baroIn,I,baroBar,B,airT,C,waterT,C,relHum,absHum,dewT,C,windDirT,T,windDirM,M,windKn,N,windM,M
//
// Most fields are routinely empty on YDNR; we extract what's present.
func handleMDA(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 4 {
		if v, ok := parseFloat(f[2]); ok {
			// pressure in bar -> mbar
			snap.SetPressureMbar(v * 1000)
		}
	}
	if len(f) >= 6 {
		if v, ok := parseFloat(f[4]); ok {
			snap.SetAirTempC(v)
		}
	}
	if len(f) >= 8 {
		if v, ok := parseFloat(f[6]); ok {
			snap.SetWaterTempC(v)
		}
	}
	if len(f) >= 12 {
		if v, ok := parseFloat(f[10]); ok {
			snap.SetDewpointC(v)
		}
	}
	// Wind dir/speed in MDA also surface via MWD; skip here to avoid double-write.
}

// $**MWD,dirT,T,dirM,M,speedKn,N,speedMs,M — true wind direction (compass).
func handleMWD(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 1 {
		if v, ok := parseFloat(f[0]); ok {
			snap.SetWindTrueDirection(v)
		}
	}
}

// $**XDR,Type,Value,Unit,TransducerName[,Type,Value,Unit,Name...]
//
// YDNR examples:
//
//	$YDXDR,C,6.2,C,Sea_T,H,59.5,P,ENV_INSIDE_H,C,15.6,C,ENV_INSIDE_T*2A
//	$YDXDR,A,0.25,D,Pitch,A,0.50,D,Roll*2A
func handleXDR(f []string, snap *telemetry.Snapshot) {
	for i := 0; i+3 < len(f); i += 4 {
		val, ok := parseFloat(f[i+1])
		if !ok {
			continue
		}
		name := f[i+3]
		switch {
		case strings.EqualFold(name, "ENV_INSIDE_T"):
			snap.SetCabinTempC(val)
		case strings.EqualFold(name, "ENV_INSIDE_H"):
			snap.SetCabinHumidityPct(val)
		case strings.EqualFold(name, "Sea_T"):
			snap.SetWaterTempC(val)
		case strings.EqualFold(name, "Roll"):
			snap.SetHeelDeg(val)
		case strings.EqualFold(name, "Pitch"):
			snap.SetPitchDeg(val)
		}
	}
}

// $**MWV,angle,reference,speed,units,status
//
// reference: R=relative-to-bow (apparent), T=true-relative-to-bow
// units: K=km/h, N=kn, M=m/s
//
// Angle is 0..360 measured clockwise from bow. We normalise to -180..180
// (positive=starboard / negative=port) for symmetry with VWR/VWT.
func handleMWV(f []string, snap *telemetry.Snapshot) {
	if len(f) < 5 || f[4] != "A" {
		return
	}
	angle, ok := parseFloat(f[0])
	if !ok {
		return
	}
	speed, ok := parseFloat(f[2])
	if !ok {
		return
	}
	speedKn := convertSpeedToKn(speed, f[3])
	signed := angle
	if signed > 180 {
		signed -= 360
	}
	switch f[1] {
	case "R":
		snap.SetWindApparent(speedKn, signed)
	case "T":
		snap.SetWindTrueRelative(speedKn, signed)
	}
}

// $**VWR,angle,L|R,kn,N,m/s,M,kmh,K — apparent wind, relative to bow.
func handleVWR(f []string, snap *telemetry.Snapshot) {
	if len(f) < 4 {
		return
	}
	angle, ok := parseFloat(f[0])
	if !ok {
		return
	}
	if f[1] == "L" {
		angle = -angle
	}
	if v, ok := parseFloat(f[2]); ok {
		snap.SetWindApparent(v, angle)
	}
}

// $**VWT,angle,L|R,kn,N,m/s,M,kmh,K — true wind, relative to bow.
func handleVWT(f []string, snap *telemetry.Snapshot) {
	if len(f) < 4 {
		return
	}
	angle, ok := parseFloat(f[0])
	if !ok {
		return
	}
	if f[1] == "L" {
		angle = -angle
	}
	if v, ok := parseFloat(f[2]); ok {
		snap.SetWindTrueRelative(v, angle)
	}
}

// $**VHW,headingT,T,headingM,M,speedKn,N,speedKmh,K — water speed.
func handleVHW(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 1 {
		if v, ok := parseFloat(f[0]); ok {
			snap.SetHeadingDeg(v)
		}
	}
	if len(f) >= 5 {
		if v, ok := parseFloat(f[4]); ok {
			snap.SetBoatSpeedKn(v)
		}
	}
}

// $**HDT,heading,T — true heading.
func handleHDT(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 1 {
		if v, ok := parseFloat(f[0]); ok {
			snap.SetHeadingDeg(v)
		}
	}
}

// $**HDG,headingMag,deviation,E|W,variation,E|W — magnetic heading + variation.
func handleHDG(f []string, snap *telemetry.Snapshot) {
	if len(f) < 1 {
		return
	}
	mag, ok := parseFloat(f[0])
	if !ok {
		return
	}
	trueHdg := mag
	if len(f) >= 5 {
		if v, ok := parseFloat(f[3]); ok {
			if f[4] == "W" {
				trueHdg = mag - v
			} else {
				trueHdg = mag + v
			}
		}
	}
	trueHdg = math.Mod(trueHdg+360, 360)
	snap.SetHeadingDeg(trueHdg)
}

// $**VLW,totalNm,N,tripNm,N — distance through water.
func handleVLW(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 1 {
		if v, ok := parseFloat(f[0]); ok {
			snap.SetLogTotalNm(v)
		}
	}
}

// convertSpeedToKn handles the unit suffix from MWV (K|N|M).
func convertSpeedToKn(v float64, unit string) float64 {
	switch unit {
	case "N":
		return v
	case "K":
		return v / 1.852 // km/h -> kn
	case "M":
		return v * 1.943844 // m/s -> kn
	}
	return v
}

// $**RMC,utc,status,lat,N/S,lon,E/W,sog,cog,date,...
func handleRMC(f []string, snap *telemetry.Snapshot) {
	if len(f) < 6 || f[1] != "A" {
		return
	}
	lat, ok1 := parseLatLon(f[2], f[3])
	lon, ok2 := parseLatLon(f[4], f[5])
	if ok1 && ok2 {
		snap.SetPosition(lat, lon)
	}
	if len(f) >= 7 {
		if v, ok := parseFloat(f[6]); ok {
			snap.SetSogKn(v)
		}
	}
	if len(f) >= 8 {
		if v, ok := parseFloat(f[7]); ok {
			snap.SetCogDeg(v)
		}
	}
}

// $**GLL,lat,N/S,lon,E/W,utc,status
func handleGLL(f []string, snap *telemetry.Snapshot) {
	if len(f) < 6 || f[5] != "A" {
		return
	}
	lat, ok1 := parseLatLon(f[0], f[1])
	lon, ok2 := parseLatLon(f[2], f[3])
	if ok1 && ok2 {
		snap.SetPosition(lat, lon)
	}
}

// NMEA lat/lon: "DDMM.MMMM" + hemisphere ("N"/"S"/"E"/"W").
func parseLatLon(raw, hemi string) (float64, bool) {
	if raw == "" || hemi == "" {
		return 0, false
	}
	dot := strings.IndexByte(raw, '.')
	if dot < 3 {
		return 0, false
	}
	degLen := dot - 2
	deg, err := strconv.ParseFloat(raw[:degLen], 64)
	if err != nil {
		return 0, false
	}
	min, err := strconv.ParseFloat(raw[degLen:], 64)
	if err != nil {
		return 0, false
	}
	v := deg + min/60.0
	switch hemi {
	case "S", "W":
		v = -v
	}
	return v, true
}

func parseFloat(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
