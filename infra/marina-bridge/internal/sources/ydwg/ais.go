// AIS PGN decoders + NMEA 2000 fast-packet reassembly for the YDWG source.
//
// The em-trak B924 (and any Class B AIS transponder on the boat's N2K bus)
// emits these PGNs on a multi-frame "fast-packet" protocol:
//
//   129039 — AIS Class B Position Report (the one we care about most)
//   129809 — AIS Class B "CS" Static Data, Part A (vessel name)
//   129810 — AIS Class B "CS" Static Data, Part B (type, callsign)
//   129038 — AIS Class A Position Report (other vessels nearby)
//
// Fast-packet wire format (per N2K standard):
//
//   First frame:  [seq:3][cnt:5=0]  [total_len:8] [data...]   (6 data bytes)
//   Subsequent:   [seq:3][cnt:5+]                  [data...]   (7 data bytes)
//
// Reassembly is keyed by (sourceAddr, PGN). A new "first frame" with the same
// key replaces any in-progress buffer (the previous send was incomplete).

package ydwg

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/kepsic/hara-marina/marina-bridge/internal/aisingest"
)

// AisCallback is invoked whenever a complete AIS position frame is decoded.
type AisCallback func(aisingest.AisFix)

// AisNameCache stores the most recent vessel name seen per MMSI so that
// position frames (which don't carry the name) can be enriched.
type aisNameCache struct {
	mu    sync.RWMutex
	names map[string]string
}

func newAisNameCache() *aisNameCache {
	return &aisNameCache{names: make(map[string]string)}
}

func (c *aisNameCache) set(mmsi, name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.names[mmsi] = name
}

func (c *aisNameCache) get(mmsi string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.names[mmsi]
}

// fastPacketReassembler buffers multi-frame PGNs.
type fastPacketReassembler struct {
	mu      sync.Mutex
	buffers map[uint64]*fpBuffer // key = sourceAddr<<24 | pgn
}

type fpBuffer struct {
	seq        uint8
	totalLen   int
	data       []byte
	expectNext uint8
	updated    time.Time
}

func newFastPacketReassembler() *fastPacketReassembler {
	r := &fastPacketReassembler{buffers: make(map[uint64]*fpBuffer)}
	go r.gcLoop(context.Background())
	return r
}

// feed accepts one CAN frame. Returns the fully assembled payload + true when
// a multi-frame PGN has just been completed; otherwise (nil, false).
func (r *fastPacketReassembler) feed(srcAddr uint8, pgn uint32, data []byte) ([]byte, bool) {
	if len(data) < 1 {
		return nil, false
	}
	key := uint64(srcAddr)<<24 | uint64(pgn)
	seq := (data[0] >> 5) & 0x07
	cnt := data[0] & 0x1F

	r.mu.Lock()
	defer r.mu.Unlock()

	if cnt == 0 {
		// first frame
		if len(data) < 2 {
			return nil, false
		}
		total := int(data[1])
		buf := &fpBuffer{
			seq:        seq,
			totalLen:   total,
			data:       make([]byte, 0, total),
			expectNext: 1,
			updated:    time.Now(),
		}
		// first frame carries 6 payload bytes
		payload := data[2:]
		if len(payload) > 6 {
			payload = payload[:6]
		}
		if len(payload) > total {
			payload = payload[:total]
		}
		buf.data = append(buf.data, payload...)
		if len(buf.data) >= total {
			delete(r.buffers, key)
			return buf.data[:total], true
		}
		r.buffers[key] = buf
		return nil, false
	}

	buf, ok := r.buffers[key]
	if !ok || buf.seq != seq || buf.expectNext != cnt {
		// dropped frame or out-of-order — discard the in-progress buffer
		delete(r.buffers, key)
		return nil, false
	}
	payload := data[1:]
	remaining := buf.totalLen - len(buf.data)
	if len(payload) > remaining {
		payload = payload[:remaining]
	}
	buf.data = append(buf.data, payload...)
	buf.expectNext++
	buf.updated = time.Now()
	if len(buf.data) >= buf.totalLen {
		delete(r.buffers, key)
		return buf.data[:buf.totalLen], true
	}
	return nil, false
}

func (r *fastPacketReassembler) gcLoop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cutoff := time.Now().Add(-5 * time.Second)
			r.mu.Lock()
			for k, b := range r.buffers {
				if b.updated.Before(cutoff) {
					delete(r.buffers, k)
				}
			}
			r.mu.Unlock()
		}
	}
}

// ---------- PGN decoders ----------

const (
	radToDegAis = 57.29577951308232
	mpsToKnots  = 1.9438444924406
)

// decodeAisPositionReport decodes PGN 129038 (Class A), 129039 (Class B),
// or 129040 (Class B Extended). The position fields (MMSI, lat/lon, COG, SOG,
// optional true heading) share the same byte offsets across all three.
//
// Byte-aligned fields we use (canboat reference):
//
//	bytes 1-4   uint32 LE  MMSI
//	bytes 5-8   int32  LE  longitude (1e-7 deg)
//	bytes 9-12  int32  LE  latitude  (1e-7 deg)
//	bytes 14-15 uint16 LE  COG       (1e-4 rad, 0xFFFF = N/A)
//	bytes 16-17 uint16 LE  SOG       (0.01 m/s, 0xFFFF = N/A)
//	bytes 21-22 uint16 LE  TrueHdg   (1e-4 rad, 0xFFFF = N/A)
func decodeAisPositionReport(pgn uint32, p []byte, names *aisNameCache) (aisingest.AisFix, bool) {
	_ = pgn // reserved for future per-PGN tweaks (e.g. 129040 carries name inline)
	return decodePGN129039(p, names)
}

func decodePGN129039(p []byte, names *aisNameCache) (aisingest.AisFix, bool) {
	if len(p) < 18 {
		return aisingest.AisFix{}, false
	}
	mmsi := uint32(p[1]) | uint32(p[2])<<8 | uint32(p[3])<<16 | uint32(p[4])<<24
	if mmsi == 0 || mmsi == 0xFFFFFFFF {
		return aisingest.AisFix{}, false
	}
	lonRaw := int32(uint32(p[5]) | uint32(p[6])<<8 | uint32(p[7])<<16 | uint32(p[8])<<24)
	latRaw := int32(uint32(p[9]) | uint32(p[10])<<8 | uint32(p[11])<<16 | uint32(p[12])<<24)
	if latRaw == 0x7FFFFFFF || lonRaw == 0x7FFFFFFF {
		return aisingest.AisFix{}, false
	}
	cogRaw := uint16(p[14]) | uint16(p[15])<<8
	sogRaw := uint16(p[16]) | uint16(p[17])<<8

	fix := aisingest.AisFix{
		MMSI: u32ToMMSI(mmsi),
		Lat:  float64(latRaw) * 1e-7,
		Lon:  float64(lonRaw) * 1e-7,
	}
	if cogRaw != 0xFFFF {
		fix.Cog = float64(cogRaw) * 1e-4 * radToDegAis
	}
	if sogRaw != 0xFFFF {
		fix.Sog = float64(sogRaw) * 0.01 * mpsToKnots
	}
	if len(p) >= 23 {
		hdgRaw := uint16(p[21]) | uint16(p[22])<<8
		if hdgRaw != 0xFFFF {
			fix.Heading = int(float64(hdgRaw) * 1e-4 * radToDegAis)
		}
	}
	if names != nil {
		fix.Name = names.get(fix.MMSI)
	}
	return fix, true
}

// PGN 129809 — Class B Static Data, Part A.
//
//	bytes 1-4   uint32 LE  MMSI
//	bytes 5-19  ASCII (15 bytes) Name (right-padded with @ or spaces)
func decodePGN129809(p []byte, names *aisNameCache) (string, string, bool) {
	if len(p) < 20 {
		return "", "", false
	}
	mmsi := uint32(p[1]) | uint32(p[2])<<8 | uint32(p[3])<<16 | uint32(p[4])<<24
	if mmsi == 0 || mmsi == 0xFFFFFFFF {
		return "", "", false
	}
	raw := p[5:20]
	name := trimAisString(raw)
	id := u32ToMMSI(mmsi)
	if name != "" && names != nil {
		names.set(id, name)
	}
	return id, name, true
}

func u32ToMMSI(v uint32) string {
	const digits = "0123456789"
	if v == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for v > 0 {
		buf = append([]byte{digits[v%10]}, buf...)
		v /= 10
	}
	return string(buf)
}

func trimAisString(b []byte) string {
	// Strip trailing '@', spaces, and NULs (em-trak right-pads with '@').
	end := len(b)
	for end > 0 {
		c := b[end-1]
		if c == '@' || c == ' ' || c == 0x00 {
			end--
			continue
		}
		break
	}
	if end == 0 {
		return ""
	}
	out := make([]byte, 0, end)
	for _, c := range b[:end] {
		if c == 0 {
			continue
		}
		out = append(out, c)
	}
	return string(out)
}

// seenStaticMMSI suppresses repeated decoded-static-info logs per (pgn, mmsi).
var seenStaticMMSI sync.Map

func logOncePerMMSI(pgn uint32, mmsi string, fn func()) {
	key := fmt.Sprintf("%d:%s", pgn, mmsi)
	if _, loaded := seenStaticMMSI.LoadOrStore(key, struct{}{}); !loaded {
		fn()
	}
}

// PGN 129041 — AIS Aids to Navigation (AtoN) Report.
//
//	bytes 1-4   uint32 LE  MMSI
//	bytes 5-8   int32  LE  longitude (1e-7 deg)
//	bytes 9-12  int32  LE  latitude  (1e-7 deg)
//	byte  20    AtoN type (high nibble) | flags (low nibble)
//
// We don't push AtoNs into the vessel cache (they are buoys/marks, not ships)
// — only log decoded info once per MMSI so they stop showing up as
// "unhandled fast-packet PGN".
func decodePGN129041(p []byte) {
	if len(p) < 13 {
		return
	}
	mmsi := uint32(p[1]) | uint32(p[2])<<8 | uint32(p[3])<<16 | uint32(p[4])<<24
	if mmsi == 0 || mmsi == 0xFFFFFFFF {
		return
	}
	lonRaw := int32(uint32(p[5]) | uint32(p[6])<<8 | uint32(p[7])<<16 | uint32(p[8])<<24)
	latRaw := int32(uint32(p[9]) | uint32(p[10])<<8 | uint32(p[11])<<16 | uint32(p[12])<<24)
	id := u32ToMMSI(mmsi)
	logOncePerMMSI(129041, id, func() {
		slog.Debug("AIS AtoN report", "source", "ydwg", "pgn", 129041, "mmsi", id,
			"lat", float64(latRaw)*1e-7, "lon", float64(lonRaw)*1e-7)
	})
}

// PGN 129793 — AIS UTC and Date Report (typically from base stations).
//
//	bytes 1-4   uint32 LE  MMSI (base station)
//	bytes 5-8   int32  LE  longitude (1e-7 deg)
//	bytes 9-12  int32  LE  latitude  (1e-7 deg)
//
// Logged once per MMSI; not pushed to vessel cache (base stations aren't ships).
func decodePGN129793(p []byte) {
	if len(p) < 13 {
		return
	}
	mmsi := uint32(p[1]) | uint32(p[2])<<8 | uint32(p[3])<<16 | uint32(p[4])<<24
	if mmsi == 0 || mmsi == 0xFFFFFFFF {
		return
	}
	lonRaw := int32(uint32(p[5]) | uint32(p[6])<<8 | uint32(p[7])<<16 | uint32(p[8])<<24)
	latRaw := int32(uint32(p[9]) | uint32(p[10])<<8 | uint32(p[11])<<16 | uint32(p[12])<<24)
	id := u32ToMMSI(mmsi)
	logOncePerMMSI(129793, id, func() {
		slog.Debug("AIS UTC/date report", "source", "ydwg", "pgn", 129793, "mmsi", id,
			"lat", float64(latRaw)*1e-7, "lon", float64(lonRaw)*1e-7)
	})
}

// PGN 129794 — AIS Class A Static and Voyage Related Data.
//
//	bytes 1-4    uint32 LE  MMSI
//	bytes 5-8    uint32 LE  IMO
//	bytes 9-15   ASCII (7)  Callsign
//	bytes 16-35  ASCII (20) Name
//	byte  36     Ship type
//
// Caches the vessel name so subsequent 129038 fixes can be enriched.
func decodePGN129794(p []byte, names *aisNameCache) {
	if len(p) < 36 {
		return
	}
	mmsi := uint32(p[1]) | uint32(p[2])<<8 | uint32(p[3])<<16 | uint32(p[4])<<24
	if mmsi == 0 || mmsi == 0xFFFFFFFF {
		return
	}
	id := u32ToMMSI(mmsi)
	name := trimAisString(p[16:36])
	if name != "" && names != nil {
		names.set(id, name)
	}
	logOncePerMMSI(129794, id, func() {
		slog.Debug("AIS Class A static", "source", "ydwg", "pgn", 129794, "mmsi", id, "name", name)
	})
}

// PGN 129810 — AIS Class B "CS" Static Data, Part B.
//
//	bytes 1-4    uint32 LE  MMSI
//	byte  5      Ship type
//	bytes 6-12   ASCII (7)  Vendor ID
//	bytes 13-19  ASCII (7)  Callsign
//	bytes 20-21  uint16 LE  Length (0.1 m)
//	bytes 22-23  uint16 LE  Beam   (0.1 m)
//
// There's no "name" field on Part B; if we have no name yet from Part A
// (PGN 129809), fall back to the callsign as a friendlier identifier than MMSI.
func decodePGN129810(p []byte, names *aisNameCache) {
	if len(p) < 24 {
		return
	}
	mmsi := uint32(p[1]) | uint32(p[2])<<8 | uint32(p[3])<<16 | uint32(p[4])<<24
	if mmsi == 0 || mmsi == 0xFFFFFFFF {
		return
	}
	id := u32ToMMSI(mmsi)
	shipType := p[5]
	callsign := trimAisString(p[13:20])
	lengthRaw := uint16(p[20]) | uint16(p[21])<<8
	beamRaw := uint16(p[22]) | uint16(p[23])<<8
	if names != nil && names.get(id) == "" && callsign != "" {
		names.set(id, callsign)
	}
	logOncePerMMSI(129810, id, func() {
		var lengthM, beamM float64
		if lengthRaw != 0xFFFF {
			lengthM = float64(lengthRaw) * 0.1
		}
		if beamRaw != 0xFFFF {
			beamM = float64(beamRaw) * 0.1
		}
		slog.Debug("AIS Class B static (Part B)", "source", "ydwg", "pgn", 129810,
			"mmsi", id, "callsign", callsign, "ship_type", shipType,
			"length_m", lengthM, "beam_m", beamM)
	})
}
