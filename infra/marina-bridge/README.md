# marina-bridge

Tiny Go agent that runs on the boat, reads telemetry from one or more onboard
sources, normalises it, and publishes a single JSON document to the
[Hara Marina](https://hara-marina.vercel.app) MQTT broker every N seconds.

Currently supported sources:

| Source | Hardware | Transport | Notes |
| --- | --- | --- | --- |
| `cerbo` | Victron Cerbo GX (Venus OS) | MQTT (port 1883 on the Cerbo) | Battery, shore-power, tank, temp, GPS via `N/<vrm_id>/...` topics |
| `ydwg`  | Yacht Devices NMEA2000 Wi-Fi Router YDWG-02 / YDEN-02 | RAW NMEA2000 over TCP (port 1457) | Battery (PGN 127508), GPS (129025/129029), heel (127257), water depth (128267), temp (130312) |

When **both** are enabled, the Cerbo feed wins on conflicts.

## Build

```bash
go build -o marina-bridge ./cmd/marina-bridge
```

Cross-compile for a Pi:

```bash
GOOS=linux GOARCH=arm64 go build -o marina-bridge-linux-arm64 ./cmd/marina-bridge
```

## Run

```bash
./marina-bridge -config config.yaml
```

Generate `config.yaml` from the marina onboarding wizard
(`https://hara-marina.vercel.app/onboard`).

## Install as a systemd service

```bash
sudo cp marina-bridge /usr/local/bin/
sudo cp config.yaml   /etc/marina-bridge.yaml
sudo cp systemd/marina-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now marina-bridge
```

## Config schema

```yaml
slug: "moi"                 # boat slug — must match the marina UI URL
publish_interval: 30s

marina:
  broker:   "tcp://tcp.railway.app:NNNNN"
  username: "boat-moi"
  password: "<from wizard>"
  topic:    "marina/moi/telemetry"

sources:
  cerbo:
    enabled: true
    broker:  "tcp://venus.local:1883"
    vrm_id:  "abc1234567"     # Cerbo → Settings → General → VRM portal ID
  ydwg:
    enabled: true
    address: "192.168.4.1:1457"
```
