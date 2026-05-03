package emtrak

import (
	"context"
	"sync"
	"testing"
)

// Mirror of aisingest.AisFix locally for the test capture without importing
// the full pusher (we'd need a real http server otherwise).
type capturedFix struct {
	mmsi    string
	lat     float64
	lon     float64
	source  string
	heading int
}

// captureProcess is a parallel processLine that pushes into a channel rather
// than the HTTP pusher. This lets us exercise decode logic deterministically.
func TestDecodeClassBPositionMsgType18(t *testing.T) {
	// Known-good AIVDM type 18 sample from gpsd test corpus (Coyote Point, SF Bay):
	//   MMSI 367430530, lat 37.785035, lon -122.267320
	line := "!AIVDM,1,1,,A,B5NJ;PP005l4ot5Isbl03wsUkP06,0*76"

	asm := newAssembler()
	names := newNameCache()

	// Parse the sentence directly without invoking the network/pusher path.
	// We can't easily intercept aisingest.Pusher.Push from here, so reach
	// into the lower-level helpers.
	body := line[:len(line)-3] // strip *76 checksum
	parts := splitCSV(body)
	if len(parts) < 7 {
		t.Fatalf("expected 7 csv parts, got %d", len(parts))
	}
	full, fill, ok := asm.feed(parts[3], 1, 1, parts[5], 0)
	if !ok {
		t.Fatalf("assembler failed on single-frag sentence")
	}
	_ = fill
	bits := decodePayload(full, 0)
	if mt := readUint(bits, 0, 6); mt != 18 {
		t.Fatalf("expected msg type 18, got %d", mt)
	}
	mmsi := uint32(readUint(bits, 8, 30))
	if mmsi != 367430530 {
		t.Errorf("mmsi: got %d want 367430530", mmsi)
	}
	lat := float64(readInt(bits, 85, 27)) / 600000.0
	lon := float64(readInt(bits, 57, 28)) / 600000.0
	if !approxEq(lat, 37.785035, 0.001) {
		t.Errorf("lat: got %.6f want ≈37.785035", lat)
	}
	if !approxEq(lon, -122.267320, 0.001) {
		t.Errorf("lon: got %.6f want ≈-122.267320", lon)
	}
	_ = names
	_ = context.Background
	_ = sync.Once{}
}

func splitCSV(s string) []string {
	out := make([]string, 0, 8)
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}

func approxEq(a, b, tol float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d <= tol
}

func TestDecodePayloadKnownBits(t *testing.T) {
	// Char '0' (ASCII 48) → 0; char 'w' (ASCII 119) → 119-56=63 → 0b111111
	bits := decodePayload("0w", 0)
	want := []byte{0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1}
	if len(bits) != len(want) {
		t.Fatalf("len: got %d want %d", len(bits), len(want))
	}
	for i := range want {
		if bits[i] != want[i] {
			t.Errorf("bit[%d]: got %d want %d", i, bits[i], want[i])
		}
	}
}
