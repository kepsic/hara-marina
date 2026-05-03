# em-trak AIS forwarder

Tiny single-purpose daemon. Reads NMEA 0183 from an em-trak B-class
transponder's WiFi (default `192.168.1.1:39150`), decodes AIVDO/AIVDM,
and POSTs each fix to the central [`ais-cache`](../ais-cache) HTTP API.

No MQTT, no Cerbo dependencies. Drops onto:

- A **Raspberry Pi** (Zero 2W, 3, 4, 5) joined to the em-trak WiFi
- A **Cerbo GX** (MK1 armv7, MK2 arm64) via opkg/SetupHelper
- Any **Linux host** on the same LAN (for testing)

## Quick install (any Linux box on the boat)

```sh
curl -fsSL https://raw.githubusercontent.com/kepsic/hara-marina/main/infra/marina-bridge/cmd/emtrak-forwarder/install.sh | \
  AIS_INGEST_TOKEN=<bearer> \
  AIS_INGEST_MMSI=276013320 \
  AIS_INGEST_NAME=MOI \
  sh
```

The script auto-detects architecture, fetches the matching binary from
the latest GitHub release, writes `/etc/emtrak-forwarder.env`, and
installs a systemd service. Use `INIT_SYSTEM=runit` on a Cerbo GX.

## Build from source

```sh
cd infra/marina-bridge/cmd/emtrak-forwarder
make build-pi-arm64    # Cerbo GX MK2, Pi 4/5
make build-pi-armv7    # Cerbo GX MK1, Pi Zero 2W (32-bit)
make build-x86         # generic Linux server
make build-mac         # local macOS testing
```

Then `scp emtrak-forwarder-linux-arm64 root@cerbo:/usr/local/bin/`.

## Configuration

All via environment variables (or the corresponding flags):

| Variable | Default | Purpose |
|---|---|---|
| `EMTRAK_ADDRESS` | `192.168.1.1:39150` | em-trak WiFi NMEA TCP endpoint |
| `AIS_INGEST_URL` | _(required)_ | ais-cache base URL |
| `AIS_INGEST_TOKEN` | _(required)_ | bearer token |
| `AIS_INGEST_MMSI` | _(required)_ | own-vessel MMSI fallback |
| `AIS_INGEST_NAME` | _(empty)_ | friendly name forwarded to cache |

## What gets forwarded

Two source labels are written to the cache:

- `emtrak-self` — the boat's own AIVDO reports (Class B SOTDMA)
- `emtrak-rx`   — every other vessel within ~5 nm that the em-trak hears

So MOI's forwarder also acts as a Hara-area AIS receiver — populating
the cache for any nearby vessel, not just herself.

## Verify it's working

On the host:

```sh
journalctl -u emtrak-forwarder -f          # systemd
svstat /service/emtrak-forwarder           # runit (Cerbo)
```

From anywhere:

```sh
curl -H "Authorization: Bearer $TOKEN" \
  https://ais-cache-production.up.railway.app/api/v1/snapshot?mmsi=276013320
# -> {"mmsi":"276013320", "lat":..., "source":"emtrak-self", ...}
```
