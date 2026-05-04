# Connecting 3rd-party MQTT clients to the marina EMQX broker

This guide is for boat owners and integrators who want to connect a **3rd-party
MQTT client** to the Hara Marina EMQX broker — for example:

- **MQTT Explorer** / **MQTTX** — desktop tools for browsing topics
- **mosquitto_pub / mosquitto_sub** — CLI tools for scripting & smoke tests
- **Basalte bOS Configurator** — home-automation integration (subscribe to
  telemetry, publish relay commands)
- **Node-RED**, **Home Assistant**, **openHAB**, **ioBroker** — generic MQTT
  bridges in your boat's onboard automation
- A custom app on a phone or laptop

The broker the marina runs is **EMQX 5**. Any client that speaks **MQTT 3.1.1
or MQTT 5** will work.

> Internal context for ops engineers: how the broker is *deployed* and how
> rules forward telemetry to Vercel lives in [infra/emqx/README.md](infra/emqx/README.md)
> and [docs/EMQX_SETUP.md](docs/EMQX_SETUP.md). This document is the
> client-side / owner-facing companion.

---

## 1. What you need from the marina admin

Before you can connect, the marina admin (you, if it's your broker) must
provide four things:

| Item                | Example                                           |
|---------------------|---------------------------------------------------|
| Broker host         | `tcp.eu-west.railway.app`                         |
| Broker TCP port     | `26512` (Railway assigns a random port per service) |
| Username            | `boat-vaiana` (or a dedicated viewer like `bos-vaiana`) |
| Password            | 16+ char random string                            |

Today the broker is reachable on **MQTT/TCP (port 1883 inside the container,
exposed via Railway's TCP proxy on a per-service port)**. There is no TLS yet
on the public endpoint — treat the password accordingly and rotate it if you
share it. WebSocket (port 8083) is also available for browser-based clients.

If you don't yet have credentials, ask the marina admin to create a user for
you. The convention is:

- `boat-<slug>` — full publish + subscribe on `marina/<slug>/#` (used by the
  boat itself)
- `bos-<slug>` or `viewer-<slug>` — **subscribe only** to
  `marina/<slug>/telemetry` and (optionally) publish on
  `marina/<slug>/cmd/relay/+` if the integration needs to toggle relays

Asking for a separate username per integration makes it easy to revoke access
without taking the boat offline.

---

## 2. Topic map (what you can subscribe to / publish to)

All topics for a boat live under `marina/<slug>/...` where `<slug>` is the URL
slug of the boat (e.g. `vaiana`, `kalevi-poeg`, `moi`).

| Direction        | Topic                                  | QoS | Retained | Payload                                                |
|------------------|-----------------------------------------|-----|----------|--------------------------------------------------------|
| boat → broker    | `marina/<slug>/telemetry`              | 1   | yes      | JSON snapshot of latest sensors (battery, position, wind, depth, …) |
| boat → broker    | `marina/<slug>/status`                 | 1   | yes      | `online` / `offline` (LWT)                             |
| boat → broker    | `marina/<slug>/event`                  | 1   | no       | One-shot events (alarm, arrival, leak)                 |
| broker → boat    | `marina/<slug>/cmd/relay/<n>`          | 1   | no       | `"on"` / `"off"` / `{"state":"on","ttl_s":60}`         |
| boat → broker    | `marina/<slug>/relay/<n>/state`        | 1   | yes      | `"on"` / `"off"` (echo of actual relay state)          |

The full payload schema for `…/telemetry` is documented in
[docs/EMQX_SETUP.md](docs/EMQX_SETUP.md#1-topic--payload-contract).

> **ACL note.** Even if your client *subscribes* to `#` or `marina/#`, the
> broker will silently drop topics outside what your username is allowed to
> see. Don't rely on the absence of messages as proof a topic is empty —
> double-check your ACL with the admin.

---

## 3. Generic MQTT client setup

Use these settings in any MQTT client. Field names vary slightly between
tools; the values do not.

| Setting              | Value                                                |
|----------------------|------------------------------------------------------|
| Protocol             | `mqtt://` (plain TCP) — **not** `mqtts://` yet      |
| Host                 | as provided (e.g. `tcp.eu-west.railway.app`)        |
| Port                 | as provided (e.g. `26512`)                          |
| Client ID            | anything unique, e.g. `bos-vaiana-livingroom`       |
| Username             | as provided                                          |
| Password             | as provided                                          |
| Clean session        | `true` (unless you specifically want offline queue) |
| Keepalive            | `60` seconds                                         |
| MQTT version         | `3.1.1` or `5` (broker supports both)               |
| TLS / SSL            | **off** (no TLS on the public endpoint today)       |

### 3.1 MQTT Explorer / MQTTX (desktop GUI)

1. **+ Connection / + New Connection**
2. Fill in the table above.
3. Connect → expand the `marina/` tree on the left.
4. Click `marina/<slug>/telemetry` to see the latest retained JSON payload.
5. To send a command (if your user has publish rights), use the **Publish**
   panel:
   - Topic: `marina/vaiana/cmd/relay/1`
   - Payload: `on`
   - QoS: 1, Retain: **off**

### 3.2 mosquitto CLI

```bash
# Watch all telemetry for one boat
mosquitto_sub \
  -h tcp.eu-west.railway.app -p 26512 \
  -u bos-vaiana -P '<password>' \
  -t 'marina/vaiana/telemetry' -v

# Toggle relay 1 on
mosquitto_pub \
  -h tcp.eu-west.railway.app -p 26512 \
  -u bos-vaiana -P '<password>' \
  -t marina/vaiana/cmd/relay/1 -q 1 \
  -m 'on'
```

### 3.3 WebSocket clients (browser apps)

If your client only speaks MQTT-over-WebSocket, ask the admin for the
WebSocket URL — typically `ws://<railway-http-host>:8083/mqtt`. Same
username/password applies.

---

## 4. Basalte bOS Configurator

bOS supports MQTT as a generic transport in its **Generic MQTT** integration.
The broker side requires no special configuration — use the credentials and
topics from §1 and §2.

### 4.1 Add the broker

In bOS Configurator → **Integrations → MQTT → Add broker**:

| Field            | Value                                       |
|------------------|---------------------------------------------|
| Name             | `Hara Marina`                               |
| Host             | `tcp.eu-west.railway.app`                   |
| Port             | `26512`                                      |
| Use TLS          | off                                         |
| Username         | `bos-vaiana`                                |
| Password         | as provided                                 |
| Client ID        | `bos-vaiana-<roomname>` (must be unique)    |
| Keepalive        | `60`                                        |

Save → **Test connection**. You should see a green status. If it stays red,
check ports and password with the admin (the broker does not return
descriptive errors for failed auth — by design).

### 4.2 Map a relay button

To wire a button to **Vaiana's relay 1**:

1. Add a **Generic MQTT switch** entity.
2. **State topic:** `marina/vaiana/relay/1/state` — payload `on` / `off`.
3. **Command topic:** `marina/vaiana/cmd/relay/1` — payload `on` / `off`.
4. **QoS:** 1, **Retain on publish:** off.
5. Save and rebuild your bOS project.

The state topic is **retained**, so on bOS startup the switch will reflect
the actual current relay state without you having to toggle it first.

### 4.3 Show telemetry on a tile

Add a **Generic MQTT sensor** entity per value you want to display:

| Tile               | State topic                       | JSON path                |
|--------------------|------------------------------------|--------------------------|
| Battery voltage    | `marina/vaiana/telemetry`         | `$.battery.voltage`      |
| Battery percent    | `marina/vaiana/telemetry`         | `$.battery.percent`      |
| Cabin temperature  | `marina/vaiana/telemetry`         | `$.cabin.temperature_c`  |
| Wind speed         | `marina/vaiana/telemetry`         | `$.wind.tws_kn`          |
| Position (lat,lon) | `marina/vaiana/telemetry`         | `$.position.lat` / `.lon`|

Use bOS's built-in JSON-path / template extractor to pull each field. The
broker publishes the **whole telemetry object** under one retained topic, so
all sensor tiles share the same subscription — bOS handles fan-out client-side.

---

## 5. Smoke test (any client)

Quickest way to confirm a 3rd-party client is correctly connected:

1. Subscribe to `marina/<your-slug>/telemetry`.
2. You should *immediately* receive one retained message with the latest
   snapshot (assuming the boat is publishing).
3. If nothing arrives within 5 s and the boat is online, your ACL probably
   doesn't include that topic — contact the admin.

For the publish path:

1. Subscribe (in a second window) to `marina/<your-slug>/relay/1/state`.
2. Publish `on` to `marina/<your-slug>/cmd/relay/1`.
3. Within a second or two you should see the state topic flip to `on` (this
   only works if a marina-bridge is actually running on the boat — otherwise
   the command is broadcast but never echoed back).

---

## 6. Operational rules

- **One client ID per integration.** Two clients with the same client ID
  will repeatedly kick each other off the broker.
- **Use QoS 1 for commands**, QoS 0 is fine for live UI displays of telemetry.
- **Don't subscribe to `#` in production.** Even with ACLs, doing so on a
  busy broker is wasteful. Subscribe only to the topics you actually use.
- **Don't publish retained messages on command topics.** If a retained `on`
  is left on `…/cmd/relay/1`, every fresh marina-bridge restart will turn
  the relay on again — almost never what you want. Retain is correct on
  *state* and *telemetry* topics, never on *cmd* topics.
- **Rotate passwords** when an integration is decommissioned. The admin can
  do this in the EMQX dashboard under **Access Control → Users**.

---

## 7. Troubleshooting

| Symptom                                       | Likely cause                                                |
|-----------------------------------------------|-------------------------------------------------------------|
| Connect succeeds, no messages on subscribe    | ACL doesn't include that topic for your username            |
| Connect immediately drops                     | Wrong username/password, or duplicate client ID             |
| `Connection refused`                          | Wrong host/port, or Railway TCP proxy port changed          |
| Publish accepted but boat doesn't react       | Boat-side `marina-bridge` is not running or not subscribed  |
| Messages stop arriving after ~10 minutes idle | Keepalive too high — set to 60 s                            |
| `Not authorized` on publish to `…/telemetry`  | Correct — only `boat-<slug>` may publish telemetry          |

For deeper debugging, the marina admin can open the EMQX dashboard → **Clients**
and see your live session, last activity, and which topics you're subscribed
to.

---

## 8. Security reminder

The current public endpoint is **plaintext MQTT/TCP**. That is acceptable for
non-sensitive telemetry while we run on a free TCP proxy, but:

- **Do not reuse marina passwords** for any other system.
- **Do not subscribe to other boats' topics** even if your ACL allows it
  (it shouldn't — tell the admin if it does).
- The roadmap is to move to **MQTT-over-TLS (port 8883)** once a custom
  domain is attached to the broker. When that happens, every client in this
  guide will need its `Use TLS` toggle flipped on and the port changed to
  `8883`. The credentials and topics will not change.
