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

// PGN 129039 — Class B Position Report.
//
// Byte-aligned fields we use (canboat reference):
//
//	bytes 1-4   uint32 LE  MMSI
//	bytes 5-8   int32  LE  longitude (1e-7 deg)
//	bytes 9-12  int32  LE  latitude  (1e-7 deg)
//	bytes 14-15 uint16 LE  COG       (1e-4 rad, 0xFFFF = N/A)
//	bytes 16-17 uint16 LE  SOG       (0.01 m/s, 0xFFFF = N/A)
//	bytes 21-22 uint16 LE  TrueHdg   (1e-4 rad, 0xFFFF = N/A)
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
