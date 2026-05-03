//go:build !linux

package emtrak

import (
	"fmt"
	"io"
	"runtime"
)

// openSerial is only implemented on Linux; on other platforms it is a stub
// so darwin/windows dev builds still compile.
func openSerial(path string, baud int) (io.ReadCloser, error) {
	return nil, fmt.Errorf("emtrak serial transport not supported on %s", runtime.GOOS)
}
