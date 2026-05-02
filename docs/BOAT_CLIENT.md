# Boat MQTT Client (Raspberry Pi)

A reference design and complete starter implementation for the on-boat
telemetry client. Tested target: **Raspberry Pi Zero 2 W** or **Pi 4** running
Raspberry Pi OS (Bookworm), Python 3.11+.

This document is written for an AI coding agent. Where it says "the agent
should…" you should treat that as a task to perform when porting this client
to a specific boat.

---

## 1. What the client does

1. Reads a small set of sensors over I²C / 1-Wire / GPIO.
2. Buffers readings locally (SQLite) so nothing is lost if the link drops.
3. Publishes a JSON message every `INTERVAL` seconds to
   `marina/<slug>/telemetry` over MQTT/TLS.
4. Maintains an LWT-backed `marina/<slug>/status` retained topic.
5. Subscribes to `marina/<slug>/cmd` for downlink commands (placeholder today).

Power discipline: the Pi sleeps the radio, not the CPU. Expect ~0.5 W average
on Pi Zero 2 W with WiFi; budget 12 mA at 12 V from the house battery.

---

## 2. Sensor mapping

The marina endpoint accepts the fields below. Map your hardware accordingly —
all are optional, send only what is actually wired.

| Field                       | Typical sensor                            | Bus          |
|-----------------------------|-------------------------------------------|--------------|
| `battery.voltage`           | INA219 / INA226 / divider on ADS1115      | I²C          |
| `battery.percent`           | derived from voltage curve                | (computed)   |
| `shore_power`               | opto-isolator on shore-power AC line      | GPIO (input) |
| `bilge.water_cm`            | ultrasonic JSN-SR04T or capacitive probe  | GPIO / ADC   |
| `bilge.pump_cycles_24h`     | counter on pump current (CT clamp)        | I²C / GPIO   |
| `cabin.temperature_c`       | DS18B20                                   | 1-Wire       |
| `cabin.humidity_pct`        | BME280 / SHT41                            | I²C          |
| `heel_deg`                  | MPU-6050 / BNO055 (Y-axis tilt)           | I²C          |
| `position.lat / .lon`       | u-blox NEO-6M / -7M / -8M                 | UART         |

Where a sensor is missing, **omit the field** rather than sending zero.

---

## 3. Provisioning checklist (per boat)

The agent setting up a new boat should:

1. **Pick the slug.** Must equal the boat's URL slug
   (e.g. `kalevi-poeg`). Confirm it appears in `lib/constants.js` under
   `INITIAL_BOATS`.
2. **Create the MQTT user** in EMQX dashboard:
   `username = boat-<slug>`, `password = $(openssl rand -hex 16)`.
3. **Add ACL rules** for that user (publish to `marina/<slug>/#`, subscribe to
   `marina/<slug>/cmd`). See `EMQX_SETUP.md §3.2`.
4. **Tell the marina owner** to add this boat → owner-email mapping to
   `MARINA_OWNERS_JSON` (Vercel env var).
5. **Flash the Pi** with Raspberry Pi OS Lite, enable I²C, 1-Wire, UART via
   `raspi-config`. Set hostname `boat-<slug>`.
6. **Drop in `/etc/hara-boat/config.toml`** (template in §6).
7. **Install the systemd unit** (template in §7) and `systemctl enable --now
   hara-boat.service`.
8. **Confirm** in EMQX dashboard → Clients that the client is connected, then
   in the marina UI that the `/<slug>` page shows `source: "live"`.

---

## 4. Dependencies

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip i2c-tools

python3 -m venv /opt/hara-boat/venv
source /opt/hara-boat/venv/bin/activate
pip install \
  paho-mqtt==2.* \
  smbus2 \
  pyserial \
  adafruit-circuitpython-bme280 \
  adafruit-circuitpython-ina219 \
  w1thermsensor \
  pynmea2 \
  toml
```

Skip the sensor libraries you don't need.

---

## 5. Reference client (`/opt/hara-boat/boat.py`)

This is a minimal, production-shaped skeleton. The agent should fill in the
`read_sensors()` function for the real hardware, leaving the publish loop,
buffering, and TLS handling alone.

```python
#!/usr/bin/env python3
"""Hara Marina boat telemetry client."""
import json
import logging
import signal
import sqlite3
import ssl
import sys
import time
from contextlib import closing
from pathlib import Path

import paho.mqtt.client as mqtt
import toml

CONFIG_PATH = Path("/etc/hara-boat/config.toml")
BUFFER_PATH = Path("/var/lib/hara-boat/buffer.db")
log = logging.getLogger("hara-boat")


# ── Sensors ────────────────────────────────────────────────────────────────────
def read_sensors(cfg) -> dict:
    """Return a dict matching the marina telemetry schema.
    Stub values shown — replace with real sensor reads."""
    out = {}
    # Example: battery via INA219
    # from adafruit_ina219 import INA219
    # ina = INA219(board.I2C())
    # out["battery"] = {"voltage": round(ina.bus_voltage, 2),
    #                   "percent": volts_to_percent(ina.bus_voltage)}
    out["battery"] = {"voltage": 12.7, "percent": 82}
    out["shore_power"] = True
    out["bilge"] = {"water_cm": 0.5, "pump_cycles_24h": 0}
    out["cabin"] = {"temperature_c": 16.0, "humidity_pct": 65}
    out["heel_deg"] = 0.0
    out["position"] = {"lat": cfg["boat"].get("default_lat", 59.5740),
                       "lon": cfg["boat"].get("default_lon", 25.7430)}
    return out


def volts_to_percent(v: float) -> int:
    """Crude lead-acid SOC estimate. Replace with chemistry-correct curve."""
    pct = (v - 11.8) / (12.9 - 11.8) * 100
    return max(0, min(100, int(pct)))


# ── Local buffer (survives broker outages) ────────────────────────────────────
def buffer_init():
    BUFFER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(BUFFER_PATH)) as db:
        db.execute("CREATE TABLE IF NOT EXISTS pending "
                   "(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, payload TEXT)")
        db.commit()


def buffer_push(payload: dict):
    with closing(sqlite3.connect(BUFFER_PATH)) as db:
        db.execute("INSERT INTO pending(ts, payload) VALUES (?, ?)",
                   (payload["ts"], json.dumps(payload)))
        db.commit()


def buffer_drain(client, topic):
    with closing(sqlite3.connect(BUFFER_PATH)) as db:
        rows = db.execute("SELECT id, payload FROM pending ORDER BY id LIMIT 50").fetchall()
        for row_id, payload in rows:
            res = client.publish(topic, payload, qos=1, retain=True)
            res.wait_for_publish(timeout=10)
            if res.rc == mqtt.MQTT_ERR_SUCCESS:
                db.execute("DELETE FROM pending WHERE id = ?", (row_id,))
                db.commit()
            else:
                log.warning("re-publish failed (rc=%s); will retry next cycle", res.rc)
                return


# ── MQTT lifecycle ────────────────────────────────────────────────────────────
def on_connect(client, cfg, _flags, rc, _props=None):
    if rc != 0:
        log.error("MQTT connect failed: rc=%s", rc); return
    slug = cfg["boat"]["slug"]
    client.publish(f"marina/{slug}/status", "online", qos=1, retain=True)
    client.subscribe(f"marina/{slug}/cmd", qos=1)
    log.info("connected as %s", cfg["mqtt"]["username"])


def on_message(_client, _cfg, msg):
    log.info("downlink %s: %s", msg.topic, msg.payload[:200])
    # TODO: handle commands (reboot, set_interval, ping, etc.)


def make_client(cfg) -> mqtt.Client:
    slug = cfg["boat"]["slug"]
    client = mqtt.Client(
        client_id=f"boat-{slug}",
        clean_session=False,
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        userdata=cfg,
    )
    client.username_pw_set(cfg["mqtt"]["username"], cfg["mqtt"]["password"])
    client.will_set(f"marina/{slug}/status", "offline", qos=1, retain=True)
    client.tls_set(cert_reqs=ssl.CERT_REQUIRED)  # uses system CA bundle
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=5, max_delay=300)
    return client


# ── Main loop ────────────────────────────────────────────────────────────────
def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = toml.load(CONFIG_PATH)
    buffer_init()

    interval = int(cfg["boat"].get("interval_seconds", 60))
    slug = cfg["boat"]["slug"]
    topic = f"marina/{slug}/telemetry"

    client = make_client(cfg)
    client.connect_async(cfg["mqtt"]["host"], int(cfg["mqtt"].get("port", 8883)), keepalive=60)
    client.loop_start()

    stop = False
    def shutdown(*_):
        nonlocal stop
        log.info("shutdown signal"); stop = True
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        while not stop:
            payload = read_sensors(cfg)
            payload["ts"] = int(time.time() * 1000)
            body = json.dumps(payload, separators=(",", ":"))
            res = client.publish(topic, body, qos=1, retain=True)
            try:
                res.wait_for_publish(timeout=10)
                if res.rc != mqtt.MQTT_ERR_SUCCESS:
                    raise RuntimeError(f"publish rc={res.rc}")
                buffer_drain(client, topic)
            except Exception as e:
                log.warning("publish failed (%s) — buffering", e)
                buffer_push(payload)
            for _ in range(interval):
                if stop: break
                time.sleep(1)
    finally:
        client.publish(f"marina/{slug}/status", "offline", qos=1, retain=True)
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    sys.exit(main())
```

---

## 6. Config template (`/etc/hara-boat/config.toml`)

Mode `0600`, owner `root` — it contains the MQTT password.

```toml
[boat]
slug = "moi"               # MUST match the URL slug at hara-marina.vercel.app/<slug>
interval_seconds = 60      # 60s on shore power; 300s on battery
default_lat = 59.5740
default_lon = 25.7430

[mqtt]
host     = "mqtt.your-emqx-host.example"
port     = 8883            # TLS
username = "boat-moi"
password = "REPLACE_ME"    # provisioned in EMQX dashboard
```

The agent should generate the password with `openssl rand -hex 16` and never
commit it to git.

---

## 7. systemd unit (`/etc/systemd/system/hara-boat.service`)

```ini
[Unit]
Description=Hara Marina boat telemetry client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/hara-boat/venv/bin/python /opt/hara-boat/boat.py
Restart=always
RestartSec=10
User=hara
Group=hara
StateDirectory=hara-boat
ConfigurationDirectory=hara-boat
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/hara-boat

[Install]
WantedBy=multi-user.target
```

Create the user: `sudo useradd -r -s /usr/sbin/nologin hara`.
Add to `i2c`, `gpio`, `dialout` groups if hardware access is needed.

---

## 8. Verifying end-to-end

On the Pi:

```bash
sudo systemctl status hara-boat
journalctl -u hara-boat -f
```

In the EMQX dashboard:

- **Clients** → `boat-<slug>` should be listed with non-zero "Recv" / "Sent" bytes.
- **Topics** → `marina/<slug>/telemetry` shows the latest retained payload.

In the marina UI:

- Sign in as the boat's owner email at `https://hara-marina.vercel.app/login`.
- Open `https://hara-marina.vercel.app/<slug>`.
- The "Telemetry" section should show `● live` and the same numbers the Pi
  printed to its journal — `source: "live"` in the underlying API response.

If the page still shows demo data: check (a) ingest token matches, (b) EMQX
rule action is enabled, (c) `journalctl -u hara-boat` shows successful
publishes, (d) Vercel function logs (`vercel logs --prod`) show the POST
arriving with a 200 response.

---

## 9. Quick alternative: HTTP-only client (no broker)

For a single one-off boat, EMQX can be skipped entirely — the boat's Pi can
POST straight to the ingest endpoint with the bearer token. This gives up
QoS / LWT / downlink commands but is operationally trivial:

```python
import json, time, urllib.request
req = urllib.request.Request(
    "https://hara-marina.vercel.app/api/ingest/telemetry",
    method="POST",
    headers={"Content-Type": "application/json",
             "Authorization": "Bearer YOUR_INGEST_TOKEN"},
    data=json.dumps({"slug": "moi", "ts": int(time.time()*1000),
                     "battery": {"voltage": 12.7, "percent": 82}}).encode(),
)
urllib.request.urlopen(req, timeout=10).read()
```

The full MQTT path is preferred at scale because EMQX absorbs reconnect logic,
buffers offline messages broker-side, and gives a single observability point
across the fleet. Use HTTP-only as a stopgap or for development.
