# Hara Marina — Boat Owner Onboarding

Welcome aboard. This document explains how to connect your boat's onboard
electronics to your private marina dashboard.

The pipeline:

```
Boat sensors  ─┐
Cerbo GX      ─┼──►  marina-bridge (on the boat)  ──MQTT──►  EMQX  ──HTTP──►  marina UI
YDWG-02       ─┘                                     (Railway)        (Vercel)
```

You only manage the **boat** end. Everything from EMQX onwards is run by the
marina.

---

## TL;DR

1. Visit **https://hara-marina.mereveer.ee/onboard** and sign in.
2. Pick your boat and the hardware you have on board.
3. Click **Generate credentials**. **Save the password** that appears — it is
   shown once.
4. Download the generated `config.yaml`.
5. Copy `config.yaml` and the `marina-bridge` binary onto a Raspberry Pi (or
   any Linux box) on the boat's network.
6. Install as a systemd service (one command, see step-by-step below).
7. Refresh your boat page — telemetry is live.

---

## Step 1 — Run the wizard

Sign in at **https://hara-marina.mereveer.ee/login** with the email the marina
admin registered for your boat. Then go to **/onboard**.

The wizard:

* Lets you pick which boat to onboard (admins can target any slug).
* Lets you choose the hardware source.
* Mints a unique MQTT username and password just for that boat.
* Locks the username's permissions to `marina/<your-slug>/#` only.
* Generates the bridge `config.yaml` with everything pre-filled.

**The password is shown exactly once.** If you lose it, re-run the wizard —
this rotates the credential and breaks any boat client still using the old one.

---

## Step 2 — Pick your hardware

| Option | What it reads from | Best for |
| --- | --- | --- |
| **Victron Cerbo GX** | The Cerbo's onboard MQTT broker | Boats with a Victron-based DC system (most production boats since 2018) |
| **Yacht Devices NMEA2000 Wi-Fi** | YDWG-02 / YDEN-02 RAW NMEA2000 over TCP | Boats with an NMEA2000 backbone but no Victron |
| **Both** | Merges both feeds; Cerbo wins on conflicts | The full picture |
| **Custom (HTTP only)** | You write your own pusher | Existing scripts; embedded MCUs |

### Cerbo GX prerequisites

On the Cerbo:

1. **Settings → Services → MQTT on LAN (SSL): off** (we use the plain LAN broker).
2. **Settings → Services → MQTT on LAN (Plain): on**.
3. **Settings → General → VRM portal ID** — write down the 12-character ID, you'll
   need it.

### YDWG-02 prerequisites

On the YDWG-02 web UI (`http://192.168.4.1`):

1. **Settings → Server → Protocol: RAW**.
2. **Settings → Server → Port: 1457** (default).
3. Make sure your bridge host can reach the Wi-Fi network the YDWG broadcasts
   (or the LAN it's joined).

---

## Step 3 — Install the bridge

The bridge is a single static Go binary (~9 MB). It runs on:

* Raspberry Pi 3 / 4 / 5 (`arm64` or `armv7`)
* Cerbo GX itself (it's an arm64 Linux box) — `marina-bridge-linux-arm64`
* Any x86_64 Linux box (`amd64`)
* macOS for testing (`darwin-arm64`)

### Quick install (Raspberry Pi 4, 64-bit)

```bash
# 1. Download the binary
curl -fsSL https://github.com/kepsic/hara-marina/releases/latest/download/marina-bridge-linux-arm64 \
  -o marina-bridge
chmod +x marina-bridge

# 2. Save the config from the wizard
cp ~/Downloads/marina-bridge.<your-slug>.yaml config.yaml

# 3. Smoke test — should connect and start emitting "[bridge] published N fields"
./marina-bridge -config config.yaml
```

### Run as a systemd service

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin marina

sudo install -m 0755 marina-bridge /usr/local/bin/
sudo install -m 0640 -o marina -g marina config.yaml /etc/marina-bridge.yaml

sudo curl -fsSL \
  https://raw.githubusercontent.com/kepsic/hara-marina/main/infra/marina-bridge/systemd/marina-bridge.service \
  -o /etc/systemd/system/marina-bridge.service

sudo systemctl daemon-reload
sudo systemctl enable --now marina-bridge
sudo journalctl -u marina-bridge -f
```

### Build from source

```bash
git clone https://github.com/kepsic/hara-marina.git
cd hara-marina/infra/marina-bridge
make build-pi          # cross-compile for Raspberry Pi (arm64)
# or
make build             # native build for the host
```

---

## Step 4 — Verify

Open **https://hara-marina.mereveer.ee/&lt;your-slug&gt;**. Within 30 s you
should see the readings from your boat. If the page header shows **DEMO** the
bridge isn't connecting — see troubleshooting below.

---

## Troubleshooting

### "auth required"
You aren't signed in or aren't the registered owner of this boat. Sign in at
`/login` with the email the marina admin registered for you.

### "no telemetry yet, skipping publish"
The bridge is running but no source has produced data yet. For Cerbo, make
sure the `vrm_id` is correct and that MQTT-on-LAN is enabled. For YDWG-02,
make sure the Pi is on the same network as the gateway.

### Bridge connects but nothing reaches the marina
Check the EMQX dashboard at the URL the marina admin gave you. Look at
**Diagnose → Log Trace** for traffic from `boat-<your-slug>`. Most common
issue is an outdated password (re-run the wizard).

### Page still shows DEMO data
Confirm the topic in `config.yaml` matches `marina/<slug>/telemetry` exactly,
and that the `slug` in the YAML matches the URL slug.

### Cerbo: no GPS
The Cerbo only publishes `Position/Latitude` if it has a GPS dongle plugged
in. Without one the bridge will send everything else but no position.

### YDWG-02: nothing decoded
We currently parse single-frame PGNs only (battery 127508, position 129025,
attitude 127257, env 130311). Multi-packet PGNs like 127506 (DC detailed
status) are silently ignored — open an issue if you want a specific PGN added.

---

## Custom HTTP ingest (no bridge)

If you'd rather push telemetry yourself, POST JSON to:

```
POST https://hara-marina.mereveer.ee/api/ingest/telemetry
Authorization: Bearer <MARINA_INGEST_TOKEN>
Content-Type: application/json

{
  "slug": "moi",
  "battery": { "voltage": 12.7, "percent": 85 },
  "shore_power": true,
  "position": { "lat": 59.5742, "lon": 25.7431 }
}
```

Ask the marina admin for `MARINA_INGEST_TOKEN`. This is a shared secret across
all boats, so prefer the per-boat MQTT credentials whenever possible.

---

## Field reference

| Field | Type | Notes |
| --- | --- | --- |
| `slug` | string | required; boat slug |
| `ts` | int64 ms | optional; defaults to server now |
| `battery.voltage` | float | volts |
| `battery.percent` | float | 0–100 |
| `shore_power` | bool | true = on shore |
| `bilge.water_cm` | float | centimetres of water |
| `bilge.pump_cycles_24h` | float | count |
| `cabin.temperature_c` | float | °C |
| `cabin.humidity_pct` | float | 0–100 |
| `heel_deg` | float | degrees, signed |
| `position.lat` | float | decimal degrees |
| `position.lon` | float | decimal degrees |

All numeric fields are optional; the server stores whatever you send.

---

## Privacy

Boat data is visible only to the registered owner of that boat and to marina
admins. Authentication is by signed magic link to the registered email
(JWT-backed session cookie, 30-day TTL). No third parties have access.
