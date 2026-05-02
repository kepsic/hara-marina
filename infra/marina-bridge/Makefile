.PHONY: build build-pi build-mac build-all clean test tidy

BIN := marina-bridge
PKG := ./cmd/marina-bridge
LDFLAGS := -s -w

build:
	go build -ldflags "$(LDFLAGS)" -o $(BIN) $(PKG)

# Raspberry Pi 4 / Cerbo GX (aarch64)
build-pi:
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(BIN)-linux-arm64 $(PKG)

# Older Pi / Venus OS Maxi (armhf)
build-armv7:
	GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "$(LDFLAGS)" -o $(BIN)-linux-armv7 $(PKG)

build-mac:
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(BIN)-darwin-arm64 $(PKG)

build-x86:
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BIN)-linux-amd64 $(PKG)

build-all: build-pi build-armv7 build-mac build-x86

tidy:
	go mod tidy

test:
	go test ./...

clean:
	rm -f $(BIN) $(BIN)-*
