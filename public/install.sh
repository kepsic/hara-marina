#!/usr/bin/env bash
# Hara Marina — boat onboarding installer.
#
# Run as root. Set MARINA_SETUP to the URL printed by the marina onboarding
# wizard (https://hara-marina.vercel.app/onboard).
#
#   curl -fsSL https://hara-marina.vercel.app/install.sh | \
#     sudo MARINA_SETUP='https://hara-marina.vercel.app/api/onboarding/config?t=...' bash
#
# Optional environment variables:
#   MARINA_VERSION  pinned bridge release tag    (default: latest)
#   MARINA_REPO     GitHub repo for releases     (default: kepsic/hara-marina)
#   MARINA_PREFIX   install prefix               (default: /usr/local)
#   MARINA_USER     system user to run service   (default: marina)
#   MARINA_NO_SVC=1 skip systemd setup
#   MARINA_FORCE=1  reinstall even if up to date
set -euo pipefail

C_RESET="$(printf '\033[0m')"
C_OK="$(printf '\033[1;32m')"
C_WARN="$(printf '\033[1;33m')"
C_ERR="$(printf '\033[1;31m')"
C_DIM="$(printf '\033[2m')"
C_BOLD="$(printf '\033[1m')"

say()  { printf '%s⚓%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_OK"   "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_RESET" "$*"; }
die()  { printf '%s✗%s %s\n' "$C_ERR"  "$C_RESET" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root (try: sudo MARINA_SETUP='...' bash)"
[ -n "${MARINA_SETUP:-}" ] || die "MARINA_SETUP env var not set. Get the install command from https://hara-marina.vercel.app/onboard"

REPO="${MARINA_REPO:-kepsic/hara-marina}"
VERSION="${MARINA_VERSION:-latest}"
PREFIX="${MARINA_PREFIX:-/usr/local}"
SVC_USER="${MARINA_USER:-marina}"

# ---------------------------------------------------------------------------
# 1. detect platform
# ---------------------------------------------------------------------------
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
[ "$OS" = "linux" ] || die "this script supports Linux only (got $OS)"

case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64; ASSET="marina-bridge-linux-arm64" ;;
  armv7l|armhf)  ARCH=armv7; ASSET="marina-bridge-linux-armv7" ;;
  x86_64|amd64)  ARCH=amd64; ASSET="marina-bridge-linux-amd64" ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
ok "platform: linux/${ARCH}"

# ---------------------------------------------------------------------------
# 2. fetch bridge binary
# ---------------------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
fi

say "downloading marina-bridge (${VERSION})"
if ! curl -fsSL --retry 3 --retry-delay 2 -o "$TMP/marina-bridge" "$URL"; then
  warn "release asset not found at $URL"
  warn "falling back to source build (requires Go ≥1.22)"
  command -v go >/dev/null || die "Go toolchain not installed. Install it (apt install golang) or pin MARINA_VERSION."
  git clone --depth 1 "https://github.com/${REPO}.git" "$TMP/src"
  ( cd "$TMP/src/infra/marina-bridge" && go build -ldflags "-s -w" -o "$TMP/marina-bridge" ./cmd/marina-bridge )
fi

install -m 0755 "$TMP/marina-bridge" "$PREFIX/bin/marina-bridge"
ok "installed $PREFIX/bin/marina-bridge"

# ---------------------------------------------------------------------------
# 3. fetch config from marina (this rotates MQTT password server-side)
# ---------------------------------------------------------------------------
say "fetching boat config from marina"
HTTP=$(curl -fsS -w '%{http_code}' -o "$TMP/cfg.yaml" "$MARINA_SETUP" || true)
case "$HTTP" in
  200)
    install -m 0640 "$TMP/cfg.yaml" /etc/marina-bridge.yaml
    if id "$SVC_USER" >/dev/null 2>&1; then
      chown "$SVC_USER":"$SVC_USER" /etc/marina-bridge.yaml || true
    fi
    SLUG=$(awk -F'"' '/^slug:/ {print $2; exit}' /etc/marina-bridge.yaml || true)
    ok "config written to /etc/marina-bridge.yaml (boat: ${SLUG:-?})"
    ;;
  401|403) die "setup token rejected (HTTP $HTTP). Re-run the wizard and grab a fresh command." ;;
  *)       die "could not fetch config (HTTP $HTTP). Check the MARINA_SETUP url." ;;
esac

# ---------------------------------------------------------------------------
# 4. systemd service
# ---------------------------------------------------------------------------
if [ "${MARINA_NO_SVC:-0}" = "1" ]; then
  warn "skipping systemd setup (MARINA_NO_SVC=1)"
elif [ ! -d /run/systemd/system ]; then
  warn "systemd not detected — skipping service setup"
  warn "run manually:  $PREFIX/bin/marina-bridge -config /etc/marina-bridge.yaml"
else
  if ! id "$SVC_USER" >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
    ok "created system user: $SVC_USER"
  fi
  chown "$SVC_USER":"$SVC_USER" /etc/marina-bridge.yaml

  cat > /etc/systemd/system/marina-bridge.service <<EOF
[Unit]
Description=Hara Marina telemetry bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${PREFIX}/bin/marina-bridge -config /etc/marina-bridge.yaml
Restart=always
RestartSec=10
User=${SVC_USER}
Group=${SVC_USER}
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  ok "wrote /etc/systemd/system/marina-bridge.service"

  systemctl daemon-reload
  systemctl enable --now marina-bridge >/dev/null
  ok "service enabled and started"

  # ---------------------------------------------------------------------------
  # 5. show first few log lines so the owner sees something is happening
  # ---------------------------------------------------------------------------
  printf '\n%s── first 8 seconds of logs ──%s\n' "$C_DIM" "$C_RESET"
  ( timeout 8 journalctl -u marina-bridge -f --no-pager -n 0 || true ) | sed 's/^/  /'
fi

cat <<EOF

${C_OK}${C_BOLD}Done.${C_RESET}

  ${C_DIM}# tail logs${C_RESET}
  sudo journalctl -u marina-bridge -f

  ${C_DIM}# restart after editing config${C_RESET}
  sudo systemctl restart marina-bridge

Open https://hara-marina.vercel.app/${SLUG:-} — your boat data should appear within ~30 s.
EOF
