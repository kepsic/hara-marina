// Package emtrak reads NMEA 0183 over TCP from an em-trak B-class AIS
// transponder's built-in WiFi access point and decodes AIVDO/AIVDM
// sentences into AIS fixes that get forwarded to the central ais-cache.
//
// em-trak B924 / B954 default WiFi:
//   - SSID:  "em-trak-XXXX"
//   - IP:    192.168.1.1
//   - Port:  39150 (NMEA 0183 over TCP, ASCII, LF-terminated)
//
// Sentences seen on the wire:
//   $GPRMC, $GPGGA, $GPGLL          — own vessel GPS (transponder's own GNSS)
//   !AIVDO, AIVDO                    — own vessel AIS reports (Class B SOTDMA)
//   !AIVDM, AIVDM                    — other vessels heard over the air
//
// We decode AIS message types:
//   1, 2, 3   Class A Position Report
//   5         Class A Static & Voyage Data
//   18        Class B Position Report
//   19        Class B Extended Position Report
//   24A       Class B Static Data, Part A (name)
//
// The AIVDM/AIVDO encoding is the standard 6-bit ASCII payload described in
// ITU-R M.1371-5 Annex 8 § 3.3.7. Multi-part sentences are reassembled by
// (sequence_id) keying.
package emtrak

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kepsic/hara-marina/marina-bridge/internal/aisingest"
	"github.com/kepsic/hara-marina/marina-bridge/internal/config"
)

// Default USB CDC-ACM device paths the auto-discoverer probes, in order.
// em-trak transponders enumerate as ttyACM*; older USB-serial bridges as ttyUSB*.
var defaultSerialProbes = []string{
	"/dev/ttyACM0",
	"/dev/ttyACM1",
	"/dev/ttyUSB0",
	"/dev/ttyUSB1",
}

// Run picks a transport based on cfg.Mode and forwards every decoded AIS fix
// (own-vessel AIVDO and any AIVDM heard from other vessels) to the supplied
// pusher. Reconnects every 5s on failure. Returns nil when ctx is cancelled.
//
// Mode "auto" probes USB serial paths first, then falls back to TCP. The
// chosen transport is re-evaluated on every reconnect, so unplugging USB
// transparently switches over to WiFi (and vice-versa).
func Run(ctx context.Context, cfg config.EmtrakConfig, pusher *aisingest.Pusher) error {
	if !cfg.Enabled {
		return nil
	}
	if pusher == nil {
		slog.Warn("AIS ingest pusher is nil, fixes will be dropped", "source", "emtrak")
	}
	mode := cfg.Mode
	if mode == "" {
		mode = "auto"
	}
	baud := cfg.SerialBaud
	if baud == 0 {
		baud = 38400
	}
	for {
		if ctx.Err() != nil {
			return nil
		}
		var err error
		switch mode {
		case "tcp":
			err = runOnce(ctx, cfg.Address, pusher)
		case "serial":
			err = runSerial(ctx, cfg.SerialDevice, baud, pusher)
		default: // auto
			err = runAuto(ctx, cfg, baud, pusher)
		}
		if err != nil {
			slog.Error("emtrak disconnected, reconnecting", "source", "emtrak", "err", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(5 * time.Second):
		}
	}
}

// runAuto probes serial paths in order; first one that opens wins. If none
// open, falls back to TCP. Each call returns when the chosen transport
// disconnects, so the outer loop will probe again on the next iteration.
func runAuto(ctx context.Context, cfg config.EmtrakConfig, baud int, pusher *aisingest.Pusher) error {
	probes := defaultSerialProbes
	if cfg.SerialDevice != "" {
		probes = []string{cfg.SerialDevice}
	}
	for _, dev := range probes {
		rc, err := openSerial(dev, baud)
		if err != nil {
			continue
		}
		slog.Info("connected via serial", "source", "emtrak", "device", dev, "baud", baud)
		go func() { <-ctx.Done(); rc.Close() }()
		err = runReader(ctx, rc, pusher)
		rc.Close()
		if err != nil {
			return fmt.Errorf("serial %s: %w", dev, err)
		}
		return nil
	}
	if cfg.Address == "" {
		return fmt.Errorf("no serial device found and no TCP address configured")
	}
	return runOnce(ctx, cfg.Address, pusher)
}

// runSerial opens an explicit serial device (or auto-discovers if path empty).
func runSerial(ctx context.Context, device string, baud int, pusher *aisingest.Pusher) error {
	probes := []string{device}
	if device == "" {
		probes = defaultSerialProbes
	}
	var lastErr error
	for _, dev := range probes {
		rc, err := openSerial(dev, baud)
		if err != nil {
			lastErr = err
			continue
		}
		slog.Info("connected via serial", "source", "emtrak", "device", dev, "baud", baud)
		go func() { <-ctx.Done(); rc.Close() }()
		err = runReader(ctx, rc, pusher)
		rc.Close()
		if err != nil {
			return fmt.Errorf("serial %s: %w", dev, err)
		}
		return nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no serial device opened")
	}
	return lastErr
}

func runOnce(ctx context.Context, addr string, pusher *aisingest.Pusher) error {
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial %s: %w", addr, err)
	}
	defer conn.Close()
	slog.Info("connected via TCP", "source", "emtrak", "addr", addr)

	go func() { <-ctx.Done(); conn.Close() }()

	return runReader(ctx, conn, pusher)
}

// runReader consumes NMEA 0183 lines from any io.Reader and pushes decoded
// AIS fixes to the supplied pusher. Used by both the TCP and serial backends.
func runReader(ctx context.Context, r io.Reader, pusher *aisingest.Pusher) error {
	asm := newAssembler()
	names := newNameCache()

	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 1024), 64*1024)
	for sc.Scan() {
		processLine(ctx, sc.Text(), asm, names, pusher)
	}
	return sc.Err()
}

func processLine(ctx context.Context, line string, asm *assembler, names *nameCache, pusher *aisingest.Pusher) {
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	// Both !AIVDM and !AIVDO use the same payload format. Some firmwares omit '!'.
	if !strings.HasPrefix(line, "!AIVDM") && !strings.HasPrefix(line, "!AIVDO") &&
		!strings.HasPrefix(line, "AIVDM") && !strings.HasPrefix(line, "AIVDO") {
		return // ignore $GPRMC/$GPGGA/etc. — own GPS already comes via Cerbo
	}
	if !strings.HasPrefix(line, "!") {
		line = "!" + line
	}
	// Strip checksum: "...,*5C"
	body := line
	if i := strings.LastIndex(body, "*"); i >= 0 {
		body = body[:i]
	}
	parts := strings.Split(body, ",")
	if len(parts) < 7 {
		return
	}
	// parts[0]=!AIVDM/!AIVDO  1=fragCount  2=fragIdx  3=seqID  4=channel  5=payload  6=fillBits
	fragCount, err := strconv.Atoi(parts[1])
	if err != nil {
		return
	}
	fragIdx, err := strconv.Atoi(parts[2])
	if err != nil {
		return
	}
	payload := parts[5]
	fillBits, err := strconv.Atoi(parts[6])
	if err != nil {
		return
	}
	own := strings.HasPrefix(parts[0], "!AIVDO")

	full, fill, ok := asm.feed(parts[3], fragIdx, fragCount, payload, fillBits)
	if !ok {
		return
	}
	bits := decodePayload(full, fill)
	if len(bits) < 38 {
		return
	}
	msgType := readUint(bits, 0, 6)
	switch msgType {
	case 1, 2, 3:
		decodeClassAPosition(ctx, bits, own, names, pusher)
	case 5:
		decodeClassAStatic(bits, names)
	case 18:
		decodeClassBPosition(ctx, bits, own, names, pusher)
	case 19:
		decodeClassBExtended(ctx, bits, own, names, pusher)
	case 24:
		decodeClassBStatic(bits, names)
	}
}

// ---------- multipart assembler ----------

type assembler struct {
	mu      sync.Mutex
	pending map[string]*partial // key = seqID (or "" for unsequenced single-frag)
}

type partial struct {
	frags    []string
	fillBits int
	count    int
	updated  time.Time
}

func newAssembler() *assembler {
	return &assembler{pending: make(map[string]*partial)}
}

func (a *assembler) feed(seqID string, idx, count int, payload string, fill int) (string, int, bool) {
	if count == 1 {
		return payload, fill, true
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.gc()
	p, ok := a.pending[seqID]
	if !ok {
		p = &partial{frags: make([]string, count), count: count}
		a.pending[seqID] = p
	}
	if idx < 1 || idx > count {
		return "", 0, false
	}
	p.frags[idx-1] = payload
	p.updated = time.Now()
	if idx == count {
		p.fillBits = fill
	}
	for _, f := range p.frags {
		if f == "" {
			return "", 0, false
		}
	}
	delete(a.pending, seqID)
	return strings.Join(p.frags, ""), p.fillBits, true
}

func (a *assembler) gc() {
	cutoff := time.Now().Add(-30 * time.Second)
	for k, p := range a.pending {
		if p.updated.Before(cutoff) {
			delete(a.pending, k)
		}
	}
}

// ---------- name cache ----------

type nameCache struct {
	mu sync.RWMutex
	m  map[uint32]string
}

func newNameCache() *nameCache { return &nameCache{m: make(map[uint32]string)} }

func (c *nameCache) set(mmsi uint32, name string) {
	c.mu.Lock()
	c.m[mmsi] = name
	c.mu.Unlock()
}

func (c *nameCache) get(mmsi uint32) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.m[mmsi]
}

// ---------- 6-bit payload decoding ----------

// decodePayload converts an AIVDM ASCII payload into a binary string.
// Each char encodes 6 bits per ITU-R M.1371-5 Annex 8 § 3.3.7. Trailing
// fillBits are stripped from the end of the bitstream.
func decodePayload(s string, fillBits int) []byte {
	out := make([]byte, 0, len(s)*6)
	for i := 0; i < len(s); i++ {
		c := int(s[i]) - 48
		if c > 40 {
			c -= 8
		}
		if c < 0 || c > 63 {
			return nil
		}
		for b := 5; b >= 0; b-- {
			out = append(out, byte((c>>b)&1))
		}
	}
	if fillBits > 0 && fillBits <= len(out) {
		out = out[:len(out)-fillBits]
	}
	return out
}

func readUint(b []byte, off, n int) uint64 {
	if off+n > len(b) {
		n = len(b) - off
		if n <= 0 {
			return 0
		}
	}
	var v uint64
	for i := 0; i < n; i++ {
		v = (v << 1) | uint64(b[off+i])
	}
	return v
}

func readInt(b []byte, off, n int) int64 {
	v := readUint(b, off, n)
	// sign-extend
	if v&(1<<(n-1)) != 0 {
		v |= ^uint64(0) << n
	}
	return int64(v)
}

// AIS 6-bit ASCII string decoder (§ 3.3.7). Trailing '@' and spaces are stripped.
func readString(b []byte, off, n int) string {
	chars := n / 6
	out := make([]byte, 0, chars)
	for i := 0; i < chars; i++ {
		c := byte(readUint(b, off+i*6, 6))
		if c < 32 {
			c += 64
		}
		out = append(out, c)
	}
	end := len(out)
	for end > 0 {
		switch out[end-1] {
		case '@', ' ', 0:
			end--
			continue
		}
		break
	}
	return string(out[:end])
}

// ---------- AIS message decoders ----------

func decodeClassAPosition(ctx context.Context, b []byte, own bool, names *nameCache, p *aisingest.Pusher) {
	if len(b) < 149 {
		return
	}
	mmsi := uint32(readUint(b, 8, 30))
	sog := float64(readUint(b, 50, 10)) * 0.1 // knots
	lon := float64(readInt(b, 61, 28)) / 600000.0
	lat := float64(readInt(b, 89, 27)) / 600000.0
	cog := float64(readUint(b, 116, 12)) * 0.1
	hdg := readUint(b, 128, 9)
	emit(ctx, p, mmsi, lat, lon, sog, cog, int(hdg), names, own)
}

func decodeClassAStatic(b []byte, names *nameCache) {
	if len(b) < 232 {
		return
	}
	mmsi := uint32(readUint(b, 8, 30))
	name := readString(b, 112, 120)
	if name != "" {
		names.set(mmsi, name)
	}
}

func decodeClassBPosition(ctx context.Context, b []byte, own bool, names *nameCache, p *aisingest.Pusher) {
	if len(b) < 168 {
		return
	}
	mmsi := uint32(readUint(b, 8, 30))
	sog := float64(readUint(b, 46, 10)) * 0.1
	lon := float64(readInt(b, 57, 28)) / 600000.0
	lat := float64(readInt(b, 85, 27)) / 600000.0
	cog := float64(readUint(b, 112, 12)) * 0.1
	hdg := readUint(b, 124, 9)
	emit(ctx, p, mmsi, lat, lon, sog, cog, int(hdg), names, own)
}

func decodeClassBExtended(ctx context.Context, b []byte, own bool, names *nameCache, p *aisingest.Pusher) {
	if len(b) < 312 {
		return
	}
	mmsi := uint32(readUint(b, 8, 30))
	sog := float64(readUint(b, 46, 10)) * 0.1
	lon := float64(readInt(b, 57, 28)) / 600000.0
	lat := float64(readInt(b, 85, 27)) / 600000.0
	cog := float64(readUint(b, 112, 12)) * 0.1
	hdg := readUint(b, 124, 9)
	name := readString(b, 143, 120)
	if name != "" {
		names.set(mmsi, name)
	}
	emit(ctx, p, mmsi, lat, lon, sog, cog, int(hdg), names, own)
}

func decodeClassBStatic(b []byte, names *nameCache) {
	if len(b) < 40 {
		return
	}
	mmsi := uint32(readUint(b, 8, 30))
	partNo := readUint(b, 38, 2)
	if partNo == 0 && len(b) >= 160 {
		// Part A — vessel name
		name := readString(b, 40, 120)
		if name != "" {
			names.set(mmsi, name)
		}
	}
}

func emit(ctx context.Context, p *aisingest.Pusher, mmsi uint32, lat, lon, sog, cog float64, hdg int, names *nameCache, own bool) {
	if p == nil || mmsi == 0 {
		return
	}
	// Lat/lon "not available" sentinels per AIS spec
	if lat == 91.0 || lon == 181.0 {
		return
	}
	fix := aisingest.AisFix{
		MMSI: strconv.FormatUint(uint64(mmsi), 10),
		Lat:  lat,
		Lon:  lon,
		Sog:  sog,
		Cog:  cog,
		Name: names.get(mmsi),
	}
	if hdg != 511 { // 511 = "not available"
		fix.Heading = hdg
	}
	if own {
		fix.Source = "emtrak-self"
	} else {
		fix.Source = "emtrak-rx"
	}
	p.Push(ctx, fix)
}
