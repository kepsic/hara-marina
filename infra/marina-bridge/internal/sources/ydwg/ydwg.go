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
//	127257 Attitude                        (heel)
//	128267 Water Depth                     (depth)
//	129025 Position, Rapid Update          (lat, lon)
//	130311 Environmental Parameters        (temperature, humidity)
package ydwg

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

func Run(ctx context.Context, cfg config.YdwgConfig, snap *telemetry.Snapshot) error {
	for {
		if ctx.Err() != nil {
			return nil
		}
		if err := runOnce(ctx, cfg.Address, snap); err != nil {
			log.Printf("[ydwg] %v — reconnecting in 5s", err)
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
	log.Printf("[ydwg] connected to %s", addr)

	go func() { <-ctx.Done(); conn.Close() }()

	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 1024), 64*1024)
	for sc.Scan() {
		parseLine(sc.Text(), snap)
	}
	return sc.Err()
}

// parseLine parses one RAW frame. Lines that don't match are silently dropped.
func parseLine(line string, snap *telemetry.Snapshot) {
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
	if len(data) < 4 {
		return
	}

	switch pgn {
	case 127508:
		handleBattery(data, snap)
	case 127257:
		handleAttitude(data, snap)
	case 128267:
		handleWaterDepth(data, snap)
	case 129025:
		handlePosition(data, snap)
	case 130311:
		handleEnv(data, snap)
	}
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

// PGN 127257: Attitude — yaw/pitch/roll in 0.0001 rad (int16 LE)
func handleAttitude(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 7 {
		return
	}
	roll := int16(uint16(d[5]) | uint16(d[6])<<8)
	if roll == 0x7FFF {
		return
	}
	const radToDeg = 57.29577951308232
	snap.SetHeelDeg(float64(roll) * 0.0001 * radToDeg)
}

// PGN 128267: Water Depth — depth in 0.01 m (uint32 LE) at offset 1
func handleWaterDepth(d []byte, snap *telemetry.Snapshot) {
	if len(d) < 5 {
		return
	}
	raw := uint32(d[1]) | uint32(d[2])<<8 | uint32(d[3])<<16 | uint32(d[4])<<24
	if raw == 0xFFFFFFFF {
		return
	}
	// We don't have a "water depth" field on the marina schema yet — fold it
	// into bilge.water_cm if no other source provides it. (Placeholder.)
	_ = raw
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
