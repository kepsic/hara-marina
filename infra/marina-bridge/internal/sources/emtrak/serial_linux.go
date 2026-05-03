//go:build linux

package emtrak

import (
	"fmt"
	"io"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// baudConst maps a numeric baud rate to the kernel's Bxxxx termios constant.
// em-trak USB CDC-ACM enumerates as a virtual serial port that ignores baud,
// but we set it anyway in case the user is using a real USB-RS422 bridge.
var baudConst = map[int]uint32{
	4800:   unix.B4800,
	9600:   unix.B9600,
	19200:  unix.B19200,
	38400:  unix.B38400,
	57600:  unix.B57600,
	115200: unix.B115200,
}

// openSerial opens a TTY in 8N1 raw mode at the requested baud rate and
// returns it as an io.ReadCloser. Linux-only; other platforms get the stub.
func openSerial(path string, baud int) (io.ReadCloser, error) {
	speed, ok := baudConst[baud]
	if !ok {
		return nil, fmt.Errorf("unsupported baud rate %d", baud)
	}
	f, err := os.OpenFile(path, syscall.O_RDWR|syscall.O_NOCTTY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	// Drop O_NONBLOCK now that the device is open so reads block normally.
	if err := syscall.SetNonblock(int(f.Fd()), false); err != nil {
		f.Close()
		return nil, fmt.Errorf("clear nonblock: %w", err)
	}

	t := unix.Termios{
		Iflag:  unix.IGNPAR,
		Cflag:  unix.CS8 | unix.CREAD | unix.CLOCAL | speed,
		Ispeed: speed,
		Ospeed: speed,
	}
	t.Cc[unix.VMIN] = 1  // block until at least 1 byte
	t.Cc[unix.VTIME] = 0 // no inter-byte timeout

	if err := unix.IoctlSetTermios(int(f.Fd()), unix.TCSETS, &t); err != nil {
		f.Close()
		return nil, fmt.Errorf("set termios on %s: %w", path, err)
	}
	return f, nil
}
