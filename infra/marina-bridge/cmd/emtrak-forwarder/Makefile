.PHONY: build build-pi-armv7 build-pi-arm64 build-cerbo-mk1 build-cerbo-mk2 build-mac build-x86 build-all clean tidy

BIN     := emtrak-forwarder
PKG     := ./cmd/emtrak-forwarder
LDFLAGS := -s -w

# All targets are run from the marina-bridge module root via `cd ../..`.
MODROOT := $(abspath ../..)

build:
	cd $(MODROOT) && CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o cmd/emtrak-forwarder/$(BIN) $(PKG)

# Cerbo GX MK1 (i.MX6, armhf) and Pi 3/Zero 2W with 32-bit OS
build-cerbo-mk1: build-pi-armv7
build-pi-armv7:
	cd $(MODROOT) && CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 \
		go build -ldflags "$(LDFLAGS)" -o cmd/emtrak-forwarder/$(BIN)-linux-armv7 $(PKG)

# Cerbo GX MK2 (i.MX8, arm64) and Pi 4/5
build-cerbo-mk2: build-pi-arm64
build-pi-arm64:
	cd $(MODROOT) && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
		go build -ldflags "$(LDFLAGS)" -o cmd/emtrak-forwarder/$(BIN)-linux-arm64 $(PKG)

build-mac:
	cd $(MODROOT) && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
		go build -ldflags "$(LDFLAGS)" -o cmd/emtrak-forwarder/$(BIN)-darwin-arm64 $(PKG)

build-x86:
	cd $(MODROOT) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
		go build -ldflags "$(LDFLAGS)" -o cmd/emtrak-forwarder/$(BIN)-linux-amd64 $(PKG)

build-all: build-pi-armv7 build-pi-arm64 build-mac build-x86

tidy:
	cd $(MODROOT) && go mod tidy

clean:
	rm -f $(BIN) $(BIN)-*
