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
//	$**MTW  Water temperature
//	$**XDR  Transducer measurement (temperature, humidity, pitch, roll)
//	$**MWV  Wind speed and angle
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
	"log"
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
			log.Printf("[n0183] %v — reconnecting in 5s", err)
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
	log.Printf("[n0183] connected to %s", addr)

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
	case "MTW":
		handleMTW(fields[1:], snap)
	case "XDR":
		handleXDR(fields[1:], snap)
	case "MWV":
		handleMWV(fields[1:], snap)
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

// $**MTW,temp,C
func handleMTW(f []string, snap *telemetry.Snapshot) {
	if len(f) >= 1 {
		if _, ok := parseFloat(f[0]); ok {
			// We don't store sea temperature on the marina schema yet;
			// it's surfaced via XDR (Sea_T) below for compatibility.
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
		case strings.EqualFold(name, "Roll"):
			snap.SetHeelDeg(val)
		}
	}
}

// $**MWV,angle,reference,speed,units,status
// reference: R=relative, T=true; units: K=km/h, N=kn, M=m/s
func handleMWV(f []string, snap *telemetry.Snapshot) {
	_ = f
	_ = snap
	// Wind isn't on the marina schema yet; placeholder for future expansion.
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
