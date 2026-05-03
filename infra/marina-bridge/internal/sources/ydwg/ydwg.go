// Package ydwg parses Yacht Devices RAW NMEA2000 frames over TCP.
//
// YDWG-02 / YDEN-02 RAW format (one frame per line):
//
//	hh:mm:ss.mmm R XXXXXXXX BB BB BB BB BB BB BB BB
//
// Where XXXXXXXX is the 29-bit CAN identifier and the bytes are the data.
//
// We only handle a handful of single-frame PGNs that map to the marina
// telemetry schema. Multi-packet reassembly (PGN 60928 fast-packet) is left
// for a future iteration.
//
// Supported PGNs:
//
//	127508 DC Battery Status              (voltage)
	//	127501 Binary Switch Bank Status      (relay/switch states)
//	127250 Vessel Heading                  (heading)
//	127257 Attitude                        (heel, pitch)
//	128259 Speed, Water Referenced         (boat speed)
//	128267 Water Depth                     (depth)
//	128275 Distance Log                    (total log)
//	129025 Position, Rapid Update          (lat, lon)
//	129026 COG/SOG, Rapid Update           (course/speed over ground)
//	130306 Wind Data                        (apparent/true wind)
//	130310 Environmental Parameters         (water/air temp, pressure)
//	130311 Environmental Parameters        (temperature, humidity)
//	130312 Temperature                      (sea/air/cabin temperature)
//	130313 Humidity                         (inside/outside humidity)
//	130314 Actual Pressure                  (barometric pressure)
package ydwg

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"math"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kepsic/hara-marina/marina-bridge/internal/aisingest"
	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
	"github.com/kepsic/hara-marina/marina-bridge/internal/telemetry"
)

var seenUnhandledPGN sync.Map

var (
	txConnMu sync.RWMutex
	txConn   net.Conn
)

func setTxConn(c net.Conn) {
	txConnMu.Lock()
	defer txConnMu.Unlock()
	txConn = c
}

func clearTxConn(c net.Conn) {
	txConnMu.Lock()
	defer txConnMu.Unlock()
	if txConn == c {
		txConn = nil
	}
}

func getTxConn() net.Conn {
	txConnMu.RLock()
	defer txConnMu.RUnlock()
	return txConn
}

func canIDForPGN(pgn uint32, src uint8, priority uint8) uint32 {
	pf := uint8((pgn >> 8) & 0xFF)
	ps := uint8(pgn & 0xFF)
	dp := uint8((pgn >> 16) & 0x01)
	if pf < 240 {
		ps = 0xFF // global destination for PDU1
	}
	return uint32(priority&0x7)<<26 | uint32(dp)<<24 | uint32(pf)<<16 | uint32(ps)<<8 | uint32(src)
}

func writeRawFrame(ctx context.Context, canID uint32, data []byte) error {
	conn := getTxConn()
	if conn == nil {
		return fmt.Errorf("ydwg tx connection unavailable")
	}
	if len(data) == 0 || len(data) > 8 {
		return fmt.Errorf("invalid CAN payload length %d", len(data))
	}

	ts := time.Now().Format("15:04:05.000")
	parts := make([]string, 0, len(data))
	for _, b := range data {
		parts = append(parts, fmt.Sprintf("%02X", b))
	}
	line := fmt.Sprintf("%s T %08X %s\n", ts, canID, strings.Join(parts, " "))

	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetWriteDeadline(dl)
	} else {
		_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	}
	_, err := conn.Write([]byte(line))
	_ = conn.SetWriteDeadline(time.Time{})
	if err != nil {
		return fmt.Errorf("ydwg write: %w", err)
	}
	return nil
}

// WriteRelay sends a best-effort N2K Binary Switch Bank Control command
// (PGN 127502) through the active YDWG RAW TCP connection.
func WriteRelay(ctx context.Context, cfg config.YdwgConfig, relayIndex int, on bool) error {
	if !cfg.Enabled {
		return fmt.Errorf("ydwg source disabled")
	}
	if relayIndex < 1 || relayIndex > 4 {
		return fmt.Errorf("relay index must be 1..4")
	}

	stateByte := byte(0xFF) // default: leave channels unchanged/unavailable
	shift := uint((relayIndex - 1) * 2)
	state := byte(0)
	if on {
		state = 1
	}
	stateByte = (stateByte & ^(byte(0x03) << shift)) | (state << shift)

	payload := []byte{0x01, stateByte, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}
	canID := canIDForPGN(127502, 0xFA, 3)
	if err := writeRawFrame(ctx, canID, payload); err != nil {
		return err
	}
	log.Printf("[ydwg] relay control sent pgn=127502 relay=%d state=%t", relayIndex, on)
	return nil
}

// Run reads RAW frames from a YDWG-02 / YDEN-02 / YDNR-02 gateway over TCP.
// Two modes:
//
//	client (default): bridge dials cfg.Address.
//	server:           bridge LISTENS on cfg.Listen and accepts the gateway's
//	                  outbound connection ("Enable the outgoing connection"
//	                  on YDNR with Server #2 in TCP/RAW mode).
//
// The optional pusher (may be nil) receives decoded AIS Class B position fixes
// from any transponder on the boat's N2K bus (e.g. em-trak B924).
func Run(ctx context.Context, cfg config.YdwgConfig, snap *telemetry.Snapshot, pusher *aisingest.Pusher) error {
	mode := cfg.Mode
	if mode == "" {
		mode = "client"
	}
	if mode == "server" {
		return runServer(ctx, cfg.Listen, snap, pusher)
	}
	for {
		if ctx.Err() != nil {
			return nil
		}
		if err := runClient(ctx, cfg.Address, snap, pusher); err != nil {
			log.Printf("[ydwg] %v — reconnecting in 5s", err)
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(5 * time.Second):
			}
		}
	}
}

func runClient(ctx context.Context, addr string, snap *telemetry.Snapshot, pusher *aisingest.Pusher) error {
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	setTxConn(conn)
	defer clearTxConn(conn)
	log.Printf("[ydwg] connected to %s", addr)

	go func() { <-ctx.Done(); conn.Close() }()

	return readFrames(ctx, conn, snap, pusher)
}

// runServer listens on listen and serves YDNR's outbound connections one at a
// time. YDNR opens a single TCP connection and streams RAW frames; if it drops
// we accept the next one. Old connections are torn down so we never have two
// streams interleaving.
func runServer(ctx context.Context, listen string, snap *telemetry.Snapshot, pusher *aisingest.Pusher) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", listen)
	if err != nil {
		return fmt.Errorf("listen %s: %w", listen, err)
	}
	defer ln.Close()
	log.Printf("[ydwg] listening on %s for incoming gateway", listen)

	go func() { <-ctx.Done(); ln.Close() }()

	var (
		curConn net.Conn
		curMu   sync.Mutex
	)
	swapConn := func(next net.Conn) {
		curMu.Lock()
		prev := curConn
		curConn = next
		curMu.Unlock()
		setTxConn(next)
		if prev != nil {
			clearTxConn(prev)
			_ = prev.Close()
		}
	}

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			log.Printf("[ydwg] accept: %v", err)
			time.Sleep(time.Second)
			continue
		}
		log.Printf("[ydwg] gateway connected from %s", conn.RemoteAddr())
		swapConn(conn)
		go func(c net.Conn) {
			defer c.Close()
			if err := readFrames(ctx, c, snap, pusher); err != nil {
				log.Printf("[ydwg] %s closed: %v", c.RemoteAddr(), err)
			} else {
				log.Printf("[ydwg] %s closed", c.RemoteAddr())
			}
		}(conn)
	}
}

// readFrames consumes RAW lines from conn until EOF or context cancellation.
func readFrames(ctx context.Context, conn net.Conn, snap *telemetry.Snapshot, pusher *aisingest.Pusher) error {
	reasm := newFastPacketReassembler()
	names := newAisNameCache()

	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 1024), 64*1024)
	for sc.Scan() {
		parseLine(ctx, sc.Text(), snap, reasm, names, pusher)
	}
	clearTxConn(conn)
	return sc.Err()
}

// fastPacketPGNs is the set of PGNs that arrive over multi-frame transport.
var fastPacketPGNs = map[uint32]bool{
	128275: true, // Distance Log
	129038: true, // AIS Class A Position
	129039: true, // AIS Class B Position
	129040: true, // AIS Class B Extended Position
	129793: true, // AIS UTC and Date Report
	129794: true, // AIS Class A Static
	129809: true, // AIS Class B Static, Part A (Name)
	129810: true, // AIS Class B Static, Part B (Type, Callsign)
}

// parseLine parses one RAW frame. Lines that don't match are silently dropped.
func parseLine(ctx context.Context, line string, snap *telemetry.Snapshot, reasm *fastPacketReassembler, names *aisNameCache, pusher *aisingest.Pusher) {
	parts := strings.Fields(strings.TrimSpace(line))
	if len(parts) < 4 {
		return
	}
	// parts[0] = timestamp, parts[1] = R/T, parts[2] = canID, parts[3..] = bytes
	canIDHex := parts[2]
	if len(canIDHex) > 8 {
		return
	}
	canID, err := strconv.ParseUint(canIDHex, 16, 32)
	if err != nil {
		return
	}
	pgn := pgnFromCanID(uint32(canID))
	srcAddr := uint8(canID & 0xFF)

	data := make([]byte, 0, 8)
	for _, h := range parts[3:] {
		if len(h) != 2 {
			continue
		}
		b, err := strconv.ParseUint(h, 16, 8)
		if err != nil {
			return
		}
		data = append(data, byte(b))
	}
	if len(data) < 1 {
		return
	}

	// Fast-packet PGNs (AIS et al.) need multi-frame reassembly.
	if fastPacketPGNs[pgn] {
		payload, complete := reasm.feed(srcAddr, pgn, data)
		if !complete {
			return
		}
		dispatchFastPacket(ctx, pgn, payload, names, pusher, snap)
		return
	}

	if len(data) < 4 {
		return
	}

	switch pgn {
	case 60928, 126993:
		// Address Claim / Heartbeat: protocol-level messages, not telemetry.
		return
	case 126996, 126720, 65284:
		// Product information / proprietary transport, not mapped to telemetry fields.
		return
	case 127508:
		handleBattery(data, snap)
	case 127501:
		handleBinarySwitchBankStatus(data, snap)
	case 127250:
		handleHeading(data, snap)
	case 127257:
		handleAttitude(data, snap)
	case 128259:
		handleBoatSpeed(data, snap)
	case 128267:
		handleWaterDepth(data, snap)
	case 129025:
		handlePosition(data, snap)
	case 129026:
		handleCogSog(data, snap)
	case 130306:
		handleWind(data, snap)
	case 130310:
		handleEnv130310(data, snap)
	case 130311:
		handleEnv(data, snap)
	case 130312:
		handleTemp130312(data, snap)
	case 130313:
		handleHumidity130313(data, snap)
	case 130314:
		handlePressure130314(data, snap)
	case 130316:
		handleTemp130316(data)
		return
	default:
		if _, loaded := seenUnhandledPGN.LoadOrStore(fmt.Sprintf("single:%d", pgn), struct{}{}); !loaded {
			log.Printf("[ydwg] unhandled single-frame PGN=%d len=%d data=% X", pgn, len(data), data)
		}
	}
}

// PGN 130316: Temperature, Extended Range.
// Many buses emit only unavailable values here. Log one-time only when payload
// appears to carry real data so we can implement an exact decoder from samples.
func handleTemp130316(d []byte) {
	if len(d) < 8 {
		return
	}
	hasReal := false
	for _, b := range d[3:8] {
		if b != 0xFF {
			hasReal = true
			break
		}
	}
	if !hasReal {
		return
	}
	if _, loaded := seenUnhandledPGN.LoadOrStore("known:130316", struct{}{}); !loaded {
		log.Printf("[ydwg] PGN 130316 carries data; decoder not implemented yet payload=% X", d)
	}
}

// dispatchFastPacket routes a fully reassembled multi-frame payload.
func dispatchFastPacket(ctx context.Context, pgn uint32, payload []byte, names *aisNameCache, pusher *aisingest.Pusher, snap *telemetry.Snapshot) {
	switch pgn {
	case 128275:
		handleDistanceLog(payload, snap)
	case 129039, 129038:
		fix, ok := decodePGN129039(payload, names)
		if !ok || pusher == nil {
			return
		}
		pusher.Push(ctx, fix)
	case 129809:
		decodePGN129809(payload, names)
	default:
		if _, loaded := seenUnhandledPGN.LoadOrStore(fmt.Sprintf("fast:%d", pgn), struct{}{}); !loaded {
			log.Printf("[ydwg] unhandled fast-packet PGN=%d len=%d payload=% X", pgn, len(payload), payload)
		}
	}
}

const mpsToKn = 1.9438444924406
const radToDeg = 57.29577951308232
func handleHeading(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 3 {
		return
	}
	raw := uint16(d[1]) | uint16(d[2])<<8
	if raw == 0xFFFF {
		return
	}
	deg := math.Mod(float64(raw)*0.0001*radToDeg+360, 360)
	snap.SetHeadingDeg(deg)
}

// 29-bit CAN ID → PGN. Per ISO 11783-3.
func pgnFromCanID(canID uint32) uint32 {
	pf := uint8(canID >> 16)
	ps := uint8(canID >> 8)
	dp := uint8((canID >> 24) & 0x01)
	if pf < 240 {
		return uint32(dp)<<16 | uint32(pf)<<8
	}
	return uint32(dp)<<16 | uint32(pf)<<8 | uint32(ps)
}

// --- PGN decoders ---

// PGN 127508: DC Detailed Status — battery voltage in 0.01 V units (uint16 LE)
func handleBattery(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 4 {
		return
	}
	// d[0] = instance, d[1..2] = voltage
	raw := uint16(d[1]) | uint16(d[2])<<8
	if raw == 0xFFFF {
		return
	}
	snap.SetBatteryVoltage(float64(raw) * 0.01)
}

// PGN 127501: Binary Switch Bank Status.
// d[0]=instance, d[1]=bank, d[2..] packed 2-bit states per channel:
// 0=Off, 1=On, 2=Error, 3=Unavailable.
func handleBinarySwitchBankStatus(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 2 {
		return
	}
	// Yacht Devices stream puts packed 2-bit channel states starting at d[1].
	// Sample seen: 01 00 FF FF ... => first channels are OFF.
	for ch := 1; ch <= 4; ch++ {
		bit := (ch - 1) * 2
		idx := 1 + (bit / 8)
		if idx >= len(d) {
			break
		}
		shift := uint(bit % 8)
		state := (d[idx] >> shift) & 0x03
		switch state {
		case 0:
			snap.SetRelayBank1(ch, false)
		case 1:
			snap.SetRelayBank1(ch, true)
		}
	}
}

// PGN 127257: Attitude — yaw/pitch/roll in 0.0001 rad (int16 LE)
func handleAttitude(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 7 {
		return
	}
	pitch := int16(uint16(d[3]) | uint16(d[4])<<8)
	roll := int16(uint16(d[5]) | uint16(d[6])<<8)
	if pitch != 0x7FFF {
		snap.SetPitchDeg(float64(pitch) * 0.0001 * radToDeg)
	}
	if roll != 0x7FFF {
		snap.SetHeelDeg(float64(roll) * 0.0001 * radToDeg)
	}
}
func handleCogSog(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 6 {
		return
	}
	cogRaw := uint16(d[2]) | uint16(d[3])<<8
	if cogRaw != 0xFFFF {
		deg := math.Mod(float64(cogRaw)*0.0001*radToDeg+360, 360)
		snap.SetCogDeg(deg)
	}
	sogRaw := uint16(d[4]) | uint16(d[5])<<8
	if sogRaw != 0xFFFF {
		mps := float64(sogRaw) * 0.01
		snap.SetSogKn(mps * mpsToKn)
	}
}

func signedAngleDeg(deg float64) float64 {
	for deg > 180 {
		deg -= 360
	}
	for deg <= -180 {
		deg += 360
	}
	return deg
}

// PGN 130306: Wind Data.
// d[1..2] = speed (0.01 m/s), d[3..4] = angle (1e-4 rad), d[5] = reference.
// Reference: 0=true (north), 2=apparent (relative), 3=true (water, relative).
func handleWind(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 6 {
		return
	}
	sRaw := uint16(d[1]) | uint16(d[2])<<8
	aRaw := uint16(d[3]) | uint16(d[4])<<8
	if sRaw == 0xFFFF || aRaw == 0xFFFF {
		return
	}
	speedKn := float64(sRaw) * 0.01 * mpsToKn
	deg := math.Mod(float64(aRaw)*0.0001*radToDeg+360, 360)
	ref := d[5] & 0x07
	switch ref {
	case 0:
		snap.SetWindTrueDirection(deg)
	case 2:
		snap.SetWindApparent(speedKn, signedAngleDeg(deg))
	case 3:
		snap.SetWindTrueRelative(speedKn, signedAngleDeg(deg))
	}
}

// PGN 130310: Environmental Parameters.
// d[1] = temperature source, d[2..3] = temperature (0.01 K), d[6..7] = pressure (100 Pa)
func handleEnv130310(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 4 {
		return
	}
	source := d[1] & 0x3F
	tRaw := uint16(d[2]) | uint16(d[3])<<8
	if tRaw != 0xFFFF {
		tC := float64(tRaw)*0.01 - 273.15
		switch source {
		case 0:
			snap.SetWaterTempC(tC)
		case 1, 2:
			snap.SetAirTempC(tC)
		case 4:
			snap.SetCabinTempC(tC)
		}
	}
	if len(d) >= 8 {
		pRaw := uint16(d[6]) | uint16(d[7])<<8
		if pRaw != 0xFFFF {
			// 100 Pa units -> mbar/hPa
			snap.SetPressureMbar(float64(pRaw))
		}
	}
}

// PGN 130312: Temperature.
// d[0]=SID, d[1]=instance, d[2]=source, d[3..4]=actual temp (0.01 K, uint16 LE)
func handleTemp130312(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 5 {
		return
	}
	source := d[2] & 0x3F
	tRaw := uint16(d[3]) | uint16(d[4])<<8
	if tRaw == 0xFFFF {
		return
	}
	tC := float64(tRaw)*0.01 - 273.15
	switch source {
	case 0:
		snap.SetWaterTempC(tC)
	case 1, 2:
		snap.SetAirTempC(tC)
	case 4:
		snap.SetCabinTempC(tC)
	case 9:
		snap.SetDewpointC(tC)
	}
}

// PGN 130313: Humidity.
// d[0]=SID, d[1]=instance, d[2]=source, d[3..4]=actual humidity (0.004 %, uint16 LE)
func handleHumidity130313(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 5 {
		return
	}
	source := d[2] & 0x3F
	raw := uint16(d[3]) | uint16(d[4])<<8
	if raw == 0xFFFF {
		return
	}
	rh := float64(raw) * 0.004
	if rh < 0 || rh > 100 {
		return
	}
	// For now map source 0/1 (inside/cabin on common instruments) to cabin humidity.
	if source == 0 || source == 1 {
		snap.SetCabinHumidityPct(rh)
	}
}

// PGN 130314: Actual Pressure.
// d[0]=SID, d[1]=instance, d[2]=source, d[3..6]=actual pressure (Pa, uint32 LE)
func handlePressure130314(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 7 {
		return
	}
	raw := uint32(d[3]) | uint32(d[4])<<8 | uint32(d[5])<<16 | uint32(d[6])<<24
	if raw == 0xFFFFFFFF || raw == 0x7FFFFFFF {
		return
	}
	// Pa -> hPa/mbar
	snap.SetPressureMbar(float64(raw) * 0.01)
}

// PGN 128267: Water Depth — depth in 0.01 m (uint32 LE) at offset 1.
// d[5..6] is the int16 transducer offset (signed, 0.001 m); ignored here.
func handleWaterDepth(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 5 {
		return
	}
	raw := uint32(d[1]) | uint32(d[2])<<8 | uint32(d[3])<<16 | uint32(d[4])<<24
	if raw == 0xFFFFFFFF {
		return
	}
	snap.SetWaterDepthM(float64(raw) * 0.01)
}

// PGN 128259: Speed, Water Referenced.
// d[0] = SID, d[1..2] = speed water-referenced (0.01 m/s, uint16 LE)
func handleBoatSpeed(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 3 {
		return
	}
	raw := uint16(d[1]) | uint16(d[2])<<8
	if raw == 0xFFFF {
		return
	}
	mps := float64(raw) * 0.01
	snap.SetBoatSpeedKn(mps * mpsToKn)
}

// PGN 128275: Distance Log (fast-packet payload).
// Two payload layouts are observed from YD gateways:
//   compact (len ~11): total log at p[6..9] (metres)
//   extended (len >=15): total log at p[11..14] (metres)
// Legacy decoders used p[7..10], which produces inflated values.
func handleDistanceLog(p []byte, snap *telemetry.Snapshot) {
	if len(p) < 10 {
		return
	}
	idx := 6
	if len(p) >= 15 {
		idx = 11
	} else if len(p) >= 11 {
		// Backward-compat fallback for older senders if compact decode is invalid.
		rawCompact := uint32(p[6]) | uint32(p[7])<<8 | uint32(p[8])<<16 | uint32(p[9])<<24
		nmCompact := float64(rawCompact) / 1852.0
		if nmCompact <= 0 || nmCompact > 50000 {
			idx = 7
		}
	}
	raw := uint32(p[idx]) | uint32(p[idx+1])<<8 | uint32(p[idx+2])<<16 | uint32(p[idx+3])<<24
	if raw == 0xFFFFFFFF {
		return
	}
	nm := float64(raw) / 1852.0
	snap.SetLogTotalNm(nm)
}

// PGN 129025: Position, Rapid Update — lat/lon as int32 LE in 1e-7 deg
func handlePosition(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 8 {
		return
	}
	lat := int32(uint32(d[0]) | uint32(d[1])<<8 | uint32(d[2])<<16 | uint32(d[3])<<24)
	lon := int32(uint32(d[4]) | uint32(d[5])<<8 | uint32(d[6])<<16 | uint32(d[7])<<24)
	if lat == 0x7FFFFFFF || lon == 0x7FFFFFFF {
		return
	}
	snap.SetPosition(float64(lat)*1e-7, float64(lon)*1e-7)
}

// PGN 130311: Environmental Parameters
//   d[0] = SID, d[1] = TempSrc<<6|HumSrc<<4, d[2..3] = temp (0.01 K, uint16 LE),
//   d[4..5] = humidity (0.004 %, int16 LE)
func handleEnv(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 6 {
		return
	}
	tempRaw := uint16(d[2]) | uint16(d[3])<<8
	if tempRaw != 0xFFFF {
		snap.SetCabinTempC(float64(tempRaw)*0.01 - 273.15)
	}
	humRaw := int16(uint16(d[4]) | uint16(d[5])<<8)
	if humRaw != 0x7FFF {
		snap.SetCabinHumidityPct(float64(humRaw) * 0.004)
	}
}
