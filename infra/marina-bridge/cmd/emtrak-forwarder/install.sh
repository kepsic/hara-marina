#!/bin/sh
# install-emtrak-forwarder.sh — install the em-trak AIS forwarder on a Cerbo
# GX, Raspberry Pi, or any other Linux host on the boat's LAN.
#
# Usage (interactive):
#   curl -fsSL https://raw.githubusercontent.com/kepsic/hara-marina/main/infra/emtrak-forwarder/install.sh | sh
#
# Or, supply env vars non-interactively:
#   AIS_INGEST_TOKEN=... AIS_INGEST_MMSI=276013320 AIS_INGEST_NAME=MOI \
#       sh install.sh
#
# The script:
#   1. Detects the CPU architecture (armv7 / arm64 / amd64).
#   2. Downloads the matching emtrak-forwarder binary from the latest GitHub
#      release into /usr/local/bin.
#   3. Writes /etc/emtrak-forwarder.env with the supplied (or prompted) creds.
#   4. Installs and enables the systemd service.
#
# On a Cerbo GX without systemd, set INIT_SYSTEM=runit (uses /service).

set -eu

REPO="kepsic/hara-marina"
BIN="emtrak-forwarder"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
ENV_FILE="${ENV_FILE:-/etc/emtrak-forwarder.env}"
INIT_SYSTEM="${INIT_SYSTEM:-systemd}"

log()  { printf '[install] %s\n' "$*"; }
fail() { printf '[install] ERROR: %s\n' "$*" >&2; exit 1; }

# ---------- 1. detect arch ----------
arch=$(uname -m 2>/dev/null || echo unknown)
case "$arch" in
	armv7l|armv6l) suffix="linux-armv7" ;;
	aarch64|arm64) suffix="linux-arm64" ;;
	x86_64|amd64)  suffix="linux-amd64" ;;
	*) fail "unsupported architecture: $arch" ;;
esac
log "detected arch: $arch -> $suffix"

# ---------- 2. download binary ----------
have_curl=$(command -v curl || true)
have_wget=$(command -v wget || true)
[ -n "$have_curl" ] || [ -n "$have_wget" ] || fail "need curl or wget"

# Resolve "latest" release download URL.
api_url="https://api.github.com/repos/$REPO/releases/latest"
if [ -n "$have_curl" ]; then
	asset_url=$(curl -fsSL "$api_url" | grep browser_download_url | grep "$BIN-$suffix" | head -1 | cut -d'"' -f4)
else
	asset_url=$(wget -qO- "$api_url" | grep browser_download_url | grep "$BIN-$suffix" | head -1 | cut -d'"' -f4)
fi
[ -n "$asset_url" ] || fail "no $BIN-$suffix asset found in latest release of $REPO"
log "downloading $asset_url"

tmp=$(mktemp)
if [ -n "$have_curl" ]; then
	curl -fsSL "$asset_url" -o "$tmp"
else
	wget -qO "$tmp" "$asset_url"
fi
chmod +x "$tmp"
mkdir -p "$INSTALL_DIR"
mv "$tmp" "$INSTALL_DIR/$BIN"
log "installed $INSTALL_DIR/$BIN"

# ---------- 3. write env file ----------
prompt() {
	# prompt VAR_NAME "Question: " "default"
	v=$(eval echo \"\${$1:-}\")
	if [ -z "$v" ]; then
		printf '%s' "$2"
		read -r v
		[ -n "$v" ] || v="$3"
	fi
	eval "$1=\$v"
}

EMTRAK_ADDRESS="${EMTRAK_ADDRESS:-192.168.1.1:39150}"
AIS_INGEST_URL="${AIS_INGEST_URL:-https://ais-cache-production.up.railway.app}"
prompt AIS_INGEST_TOKEN "ais-cache bearer token: " ""
prompt AIS_INGEST_MMSI  "this boat's MMSI: "      ""
prompt AIS_INGEST_NAME  "this boat's name: "      ""

[ -n "$AIS_INGEST_TOKEN" ] || fail "AIS_INGEST_TOKEN is required"
[ -n "$AIS_INGEST_MMSI" ]  || fail "AIS_INGEST_MMSI is required"

umask 077
cat > "$ENV_FILE" <<EOF
EMTRAK_ADDRESS=$EMTRAK_ADDRESS
AIS_INGEST_URL=$AIS_INGEST_URL
AIS_INGEST_TOKEN=$AIS_INGEST_TOKEN
AIS_INGEST_MMSI=$AIS_INGEST_MMSI
AIS_INGEST_NAME=$AIS_INGEST_NAME
EOF
log "wrote $ENV_FILE"

# ---------- 4. install service ----------
case "$INIT_SYSTEM" in
systemd)
	command -v systemctl >/dev/null 2>&1 || fail "systemd not detected; rerun with INIT_SYSTEM=runit (Cerbo) or INIT_SYSTEM=none"
	cat > /etc/systemd/system/emtrak-forwarder.service <<UNIT
[Unit]
Description=em-trak AIS forwarder
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_DIR/$BIN
Restart=always
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
	systemctl daemon-reload
	systemctl enable --now emtrak-forwarder.service
	log "systemd service started; tail with: journalctl -u emtrak-forwarder -f"
	;;
runit)
	# Cerbo GX uses runit-style /service directories.
	svcdir="/service/emtrak-forwarder"
	mkdir -p "$svcdir"
	cat > "$svcdir/run" <<RUN
#!/bin/sh
exec 2>&1
. $ENV_FILE
export EMTRAK_ADDRESS AIS_INGEST_URL AIS_INGEST_TOKEN AIS_INGEST_MMSI AIS_INGEST_NAME
exec $INSTALL_DIR/$BIN
RUN
	chmod +x "$svcdir/run"
	log "runit service installed at $svcdir; svstat $svcdir to inspect"
	;;
none)
	log "skipping init system; run manually: $INSTALL_DIR/$BIN (env from $ENV_FILE)"
	;;
*)
	fail "unknown INIT_SYSTEM: $INIT_SYSTEM (use systemd, runit, or none)"
	;;
esac

log "done."
