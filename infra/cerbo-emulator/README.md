# Cerbo GX Emulator (boat: MOI)

Tiny Go service that pretends to be a Victron Cerbo GX publishing Venus OS
MQTT messages for the boat **MOI**. Used to drive end-to-end testing of the
Hara Marina pipeline (EMQX → ingest webhook → Upstash → UI) without
needing a real boat installation.

It speaks the same protocol as a real Cerbo:

- Publishes JSON `{"value": ...}` on topic `N/<VRM_ID>/<service>/<inst>/<path>`
- Only publishes while it has received a recent keepalive on
  `R/<VRM_ID>/keepalive` (real Cerbos go silent without one).
- Slowly drifts realistic battery / SoC / temperature / GPS values so the
  UI looks alive.

The marina-bridge that runs on a real boat connects to the **same EMQX** broker
and consumes these messages exactly as it would on a Cerbo on the boat's LAN.

## Topics published

| Topic                                            | Type   | Notes                            |
| ------------------------------------------------ | ------ | -------------------------------- |
| `N/<id>/system/0/Dc/Battery/Voltage`             | float  | 12.0 – 13.6 V drift              |
| `N/<id>/system/0/Dc/Battery/Soc`                 | int    | 35 – 100 %, slowly cycling       |
| `N/<id>/system/0/Ac/ActiveIn/Source`             | int    | flips between 1 (shore) and 240  |
| `N/<id>/system/0/Position/Latitude`              | float  | 59.5916 ± tiny drift             |
| `N/<id>/system/0/Position/Longitude`             | float  | 25.6608 ± tiny drift             |
| `N/<id>/temperature/0/Temperature`               | float  | cabin °C, follows time-of-day    |
| `N/<id>/temperature/0/Humidity`                  | int    | %                                |

## Configuration (env vars)

| Var               | Default                                | Purpose                          |
| ----------------- | -------------------------------------- | -------------------------------- |
| `MQTT_BROKER`     | required                               | `tcp://host:1883` of EMQX        |
| `MQTT_USERNAME`   | required                               | EMQX username for boat MOI       |
| `MQTT_PASSWORD`   | required                               | EMQX password for boat MOI       |
| `VRM_ID`          | `c0deba5eb0a7`                         | fake VRM portal id for MOI       |
| `PUBLISH_PERIOD`  | `5s`                                   | how often metrics are emitted    |
| `KEEPALIVE_GRACE` | `60s`                                  | publish only if keepalive ≤ this |

## Local run

```sh
cd infra/cerbo-emulator
go run . \
  -broker tcp://localhost:1883 \
  -user moi -pass somepass
```

## Railway deploy

This folder contains a `railway.toml` + `Dockerfile`. Add it as a second
service in the same Railway project as EMQX, set the env vars above, and
it will start publishing within ~10s.
