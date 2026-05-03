// YDWG-02 emulator: serves YDWG RAW frames over TCP so marina-bridge can
// decode synthetic NMEA 2000 traffic — including AIS PGNs from a virtual
// em-trak B924 — without any real hardware on the bus.
//
// Wire format (one frame per line, LF-terminated):
//
//	hh:mm:ss.mmm R XXXXXXXX BB BB BB BB BB BB BB BB
//
// We emit:
//   - PGN 129025 (Position, Rapid Update) every 2s
//   - PGN 129039 (AIS Class B Position Report, fast-packet) every 10s
//   - PGN 129809 (AIS Class B Static, Part A — Name, fast-packet) every 60s
//
// All AIS frames advertise the boat's own MMSI/name (from env), giving us a
// loopback "self-AIS" path identical to a real Class B transponder.

package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ydwgSim struct {
	addr string
	mmsi uint32
	name string

	mu      sync.Mutex
	clients map[net.Conn]struct{}

	// shared state with the cerbo emitter
	getPos func() (float64, float64)

	fpSeq atomic.Uint32 // monotonic fast-packet sequence counter
}

func newYdwgSim(addr string, mmsi uint32, name string, getPos func() (float64, float64)) *ydwgSim {
	return &ydwgSim{
		addr:    addr,
		mmsi:    mmsi,
		name:    name,
		clients: make(map[net.Conn]struct{}),
		getPos:  getPos,
	}
}

func (s *ydwgSim) run(ctx context.Context) {
	lc := net.ListenConfig{}
	ln, err := lc.Listen(ctx, "tcp", s.addr)
	if err != nil {
		log.Printf("[ydwg-sim] listen %s: %v", s.addr, err)
		return
	}
	defer ln.Close()
	log.Printf("[ydwg-sim] listening on %s; mmsi=%d name=%q", s.addr, s.mmsi, s.name)

	go s.broadcastLoop(ctx)

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[ydwg-sim] accept: %v", err)
			continue
		}
		log.Printf("[ydwg-sim] client connected: %s", conn.RemoteAddr())
		s.mu.Lock()
		s.clients[conn] = struct{}{}
		s.mu.Unlock()
		go s.handleClient(ctx, conn)
	}
}

func (s *ydwgSim) handleClient(ctx context.Context, conn net.Conn) {
	defer func() {
		s.mu.Lock()
		delete(s.clients, conn)
		s.mu.Unlock()
		conn.Close()
		log.Printf("[ydwg-sim] client disconnected: %s", conn.RemoteAddr())
	}()
	// Drain anything the client sends (YDWG accepts commands; we ignore them).
	buf := make([]byte, 256)
	for {
		if ctx.Err() != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		_, err := conn.Read(buf)
		if err != nil {
			return
		}
	}
}

func (s *ydwgSim) write(line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.clients {
		c.SetWriteDeadline(time.Now().Add(2 * time.Second))
		if _, err := c.Write([]byte(line + "\r\n")); err != nil {
			c.Close()
			delete(s.clients, c)
		}
	}
}

func (s *ydwgSim) broadcastLoop(ctx context.Context) {
	posTick := time.NewTicker(2 * time.Second)
	aisTick := time.NewTicker(10 * time.Second)
	staticTick := time.NewTicker(60 * time.Second)
	defer posTick.Stop()
	defer aisTick.Stop()
	defer staticTick.Stop()

	// Emit one of each immediately so a freshly-connected bridge sees data fast.
	s.emitPGN129025()
	s.emitPGN129809()
	s.emitPGN129039()

	for {
		select {
		case <-ctx.Done():
			return
		case <-posTick.C:
			s.emitPGN129025()
		case <-aisTick.C:
			s.emitPGN129039()
		case <-staticTick.C:
			s.emitPGN129809()
		}
	}
}

// ---------- PGN encoders ----------

// emitPGN129025: Position, Rapid Update. Single-frame, 8 bytes.
//
//	bytes 0-3 lat int32 LE 1e-7 deg
//	bytes 4-7 lon int32 LE 1e-7 deg
func (s *ydwgSim) emitPGN129025() {
	lat, lon := s.getPos()
	d := make([]byte, 8)
	putI32LE(d[0:4], int32(math.Round(lat*1e7)))
	putI32LE(d[4:8], int32(math.Round(lon*1e7)))
	s.write(formatRaw(canIDFor(0x1F801, 35, 2), d)) // PGN 129025
}

// emitPGN129039: AIS Class B Position Report. Fast-packet, 26 bytes payload.
// Field layout (canboat — only the bytes our decoder reads matter):
//
//	byte 0       msgType(0x12) | repeat(0)
//	bytes 1-4    MMSI (uint32 LE)
//	bytes 5-8    longitude (int32 LE, 1e-7 deg)
//	bytes 9-12   latitude  (int32 LE, 1e-7 deg)
//	byte 13      packed bits (accuracy/RAIM/timestamp) — 0xFC
//	bytes 14-15  COG (uint16 LE, 1e-4 rad)
//	bytes 16-17  SOG (uint16 LE, 0.01 m/s)
//	bytes 18-20  comm state + transceiver — 0
//	bytes 21-22  true heading (uint16 LE, 1e-4 rad, 0xFFFF = N/A)
//	bytes 23-25  reserved/sequence — 0xFF padding
func (s *ydwgSim) emitPGN129039() {
	lat, lon := s.getPos()
	payload := make([]byte, 26)
	payload[0] = 0x12
	putU32LE(payload[1:5], s.mmsi)
	putI32LE(payload[5:9], int32(math.Round(lon*1e7)))
	putI32LE(payload[9:13], int32(math.Round(lat*1e7)))
	payload[13] = 0xFC
	// COG = 0 rad (raw 0); SOG = 0.5 m/s (raw 50)
	putU16LE(payload[14:16], 0)
	putU16LE(payload[16:18], 50)
	putU16LE(payload[21:23], 0xFFFF)
	for i := 23; i < 26; i++ {
		payload[i] = 0xFF
	}
	s.emitFastPacket(0x1F803, 35, 4, payload) // PGN 129039
}

// emitPGN129809: AIS Class B Static Data, Part A. Fast-packet, 20 bytes payload.
//
//	byte 0      msgType(0x18) | repeat(0)
//	bytes 1-4   MMSI (uint32 LE)
//	bytes 5-19  Name (15 ASCII, '@'-padded)
func (s *ydwgSim) emitPGN129809() {
	payload := make([]byte, 20)
	payload[0] = 0x18
	putU32LE(payload[1:5], s.mmsi)
	name := s.name
	if len(name) > 15 {
		name = name[:15]
	}
	copy(payload[5:20], []byte(name))
	for i := 5 + len(name); i < 20; i++ {
		payload[i] = '@'
	}
	s.emitFastPacket(0x1F211, 35, 6, payload) // PGN 129809
}

// emitFastPacket splits payload into N2K fast-packet frames and writes each
// as one YDWG RAW line.
func (s *ydwgSim) emitFastPacket(pgn uint32, srcAddr uint8, priority uint8, payload []byte) {
	seq := uint8(s.fpSeq.Add(1) & 0x07)
	canID := canIDFor(pgn, srcAddr, priority)
	total := len(payload)

	// Frame 0: 6 payload bytes
	frame := make([]byte, 8)
	frame[0] = (seq << 5) | 0
	frame[1] = byte(total)
	copy(frame[2:8], payload[:min(6, total)])
	for i := 2 + min(6, total); i < 8; i++ {
		frame[i] = 0xFF
	}
	s.write(formatRaw(canID, frame))

	// Subsequent frames: 7 payload bytes each
	off := 6
	idx := uint8(1)
	for off < total {
		f := make([]byte, 8)
		f[0] = (seq << 5) | idx
		take := total - off
		if take > 7 {
			take = 7
		}
		copy(f[1:1+take], payload[off:off+take])
		for i := 1 + take; i < 8; i++ {
			f[i] = 0xFF
		}
		s.write(formatRaw(canID, f))
		off += take
		idx++
	}
}

// ---------- helpers ----------

// canIDFor builds a 29-bit J1939/N2K identifier.
//
//	[priority:3][reserved:1][DP:1][PF:8][PS:8][SA:8]
//
// For PF >= 240 (PDU2): PS is the group-extension byte of PGN.
// For PF <  240 (PDU1): PS is destination address; PGN's low byte = 0.
func canIDFor(pgn uint32, srcAddr, priority uint8) uint32 {
	dp := uint8((pgn >> 16) & 0x01)
	pf := uint8(pgn >> 8)
	var ps uint8
	if pf >= 240 {
		ps = uint8(pgn & 0xFF)
	}
	return uint32(priority&0x07)<<26 |
		uint32(dp&0x01)<<24 |
		uint32(pf)<<16 |
		uint32(ps)<<8 |
		uint32(srcAddr)
}

// formatRaw renders one YDWG RAW line:  hh:mm:ss.mmm R XXXXXXXX BB BB ...
func formatRaw(canID uint32, data []byte) string {
	now := time.Now().UTC()
	hexBytes := make([]string, len(data))
	for i, b := range data {
		hexBytes[i] = fmt.Sprintf("%02X", b)
	}
	return fmt.Sprintf("%02d:%02d:%02d.%03d R %08X %s",
		now.Hour(), now.Minute(), now.Second(), now.Nanosecond()/1_000_000,
		canID, strings.Join(hexBytes, " "))
}

func putU16LE(b []byte, v uint16) {
	b[0] = byte(v)
	b[1] = byte(v >> 8)
}
func putU32LE(b []byte, v uint32) {
	b[0] = byte(v)
	b[1] = byte(v >> 8)
	b[2] = byte(v >> 16)
	b[3] = byte(v >> 24)
}
func putI32LE(b []byte, v int32) { putU32LE(b, uint32(v)) }

func parseUint32Env(s string, def uint32) uint32 {
	if s == "" {
		return def
	}
	v, err := strconv.ParseUint(s, 10, 32)
	if err != nil {
		return def
	}
	return uint32(v)
}
