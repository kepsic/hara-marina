# EMQX → Hara Marina Telemetry Ingest

This document is written for an AI coding agent (or human ops engineer) tasked with:

1. Configuring an EMQX broker to receive MQTT telemetry from boats.
2. Forwarding that telemetry to the Hara Marina production webhook.
3. Building the on-boat MQTT client (typically running on a Raspberry Pi).

The marina backend exposes a single HTTP ingest endpoint. EMQX acts as the middle
layer because boats publish over MQTT (small payloads, intermittent connectivity,
QoS, retained messages), but the Vercel serverless backend prefers HTTP.

```
 ┌──────────────┐  MQTT     ┌─────────┐  HTTPS POST    ┌────────────────────┐
 │ Boat (RasPi) │ ───────►  │  EMQX   │ ────────────►  │ /api/ingest/       │
 │  mqtt client │           │  Rule   │                │  telemetry         │
 └──────────────┘           │ Engine  │                │  (Next.js / Vercel)│
                            └─────────┘                └─────────┬──────────┘
                                                                  │
                                                            Upstash Redis
                                                       key: telemetry:<slug>
                                                                  │
                                                      ┌───────────▼──────────┐
                                                      │ /api/telemetry/<slug>│
                                                      │  (owner-only, JWT)   │
                                                      └──────────────────────┘
```

---

## 1. Topic & payload contract

### Topic

```
marina/<slug>/telemetry
```

`<slug>` is the boat name lowercased with non-alphanumeric runs replaced by `-`
(e.g. `Kalevi Poeg` → `kalevi-poeg`). The slug is the same one used in the URL
`https://hara.mervare.app/<slug>`.

Use **QoS 1** and **retain = true** so the latest reading survives reboots.

### Payload (JSON, UTF-8)

All fields are optional except — implicitly — meaningful values to display.
Send what the boat actually has sensors for.

```json
{
  "ts": 1714600000000,
  "battery":     { "voltage": 12.74, "percent": 82 },
  "shore_power": true,
  "bilge":       { "water_cm": 1.2, "pump_cycles_24h": 0 },
  "cabin":       { "temperature_c": 14.5, "humidity_pct": 68 },
  "heel_deg":    0.3,
  "position":    { "lat": 59.5742, "lon": 25.7431 }
}
```

- `ts` is ms-since-epoch. If omitted, the server uses its receive time.
- `slug` does **not** need to be in the payload — EMQX extracts it from the topic.
- Send no faster than every 30 s (typical: every 60–300 s on battery, every 5 s
  while charging on shore power).

### Recommended additional topics (future use)

| Topic                              | Purpose                              |
|------------------------------------|--------------------------------------|
| `marina/<slug>/event`              | One-shot events (alarm, arrival)     |
| `marina/<slug>/status` (retained)  | LWT — `online` / `offline`           |
| `marina/<slug>/cmd`                | Server → boat commands (downlink)    |

Only `…/telemetry` is wired up server-side today.

---

## 2. Server endpoint

```
POST https://hara.mervare.app/api/ingest/telemetry
Content-Type: application/json
Authorization: Bearer ${MARINA_INGEST_TOKEN}
```

(Or use header `x-marina-ingest-token: <token>` — both are accepted.)

The token is a 32-byte hex string set as the `MARINA_INGEST_TOKEN` env var on
Vercel. It is **not** rotated automatically — treat it like a service password.

### Accepted body shapes

The endpoint is forgiving and accepts any of:

1. **Direct payload** (preferred — boat client posts directly, skipping EMQX):
   ```json
   { "slug": "moi", "battery": { "voltage": 12.7, "percent": 82 } }
   ```
2. **EMQX webhook envelope** (default EMQX rule action):
   ```json
   { "topic": "marina/moi/telemetry", "payload": "{\"battery\":{...}}" }
   ```
   The slug is extracted from the topic; the payload string is parsed.
3. **EMQX rule SELECT projection**:
   ```json
   { "topic": "marina/moi/telemetry", "payload": { "battery": {...} } }
   ```

### Responses

- `200 {"ok":true,"slug":"moi","ts":1714600000000}` on success
- `400` — slug missing / invalid JSON
- `401` — token missing/wrong
- `405` — non-POST
- `500` — Redis unavailable

---

## 3. EMQX configuration

The marina runs **EMQX 5.x** (Open Source or Cloud — both work). The exact UI
labels below assume the EMQX 5 Dashboard.

### 3.1 Authentication for boats

Every boat gets its own MQTT username + password. Boat usernames **must** match
their slug, so we can scope ACLs.

**Dashboard → Access Control → Authentication → Add → Password-based → built-in DB**

Then **Access Control → Users**, add one per boat:

| Username       | Password (random 16-byte hex) |
|----------------|-------------------------------|
| `boat-moi`     | `…`                           |
| `boat-kalevi-poeg` | `…`                       |
| …              |                               |

(Prefix `boat-` so it is impossible to confuse with the ingest user below.)

### 3.2 ACLs (so boats can only touch their own topics)

**Dashboard → Access Control → Authorization → Add → built-in DB**, then add
rules. Pseudo-rules:

| Subject                | Action       | Topic                          | Permission |
|------------------------|--------------|--------------------------------|------------|
| `username = boat-moi`  | publish      | `marina/moi/telemetry`         | allow      |
| `username = boat-moi`  | publish      | `marina/moi/event`             | allow      |
| `username = boat-moi`  | publish      | `marina/moi/status`            | allow      |
| `username = boat-moi`  | subscribe    | `marina/moi/cmd`               | allow      |
| `all`                  | publish/subscribe | `#`                       | deny       |

Repeat per boat (this is mechanical — script it). The fall-through deny is
critical: without it, any authenticated boat could read every other boat's data.

### 3.3 Rule Engine — forward telemetry to the marina webhook

**Dashboard → Integration → Rules → Create**

**SQL:**

```sql
SELECT
  topic,
  payload
FROM
  "marina/+/telemetry"
```

**Action: Add → Webhook (HTTP Server)**

- **URL:** `https://hara.mervare.app/api/ingest/telemetry`
- **Method:** `POST`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <MARINA_INGEST_TOKEN>`
- **Body template:**
  ```
  {"topic":"${topic}","payload":${payload}}
  ```
  (Note: no quotes around `${payload}` — EMQX inlines the parsed JSON object.
  The ingest endpoint also accepts a string-quoted payload as a fallback.)
- **Pool size:** 8
- **Connect timeout:** 5 s
- **Request timeout:** 10 s
- **Max retries:** 3
- **Retry interval:** 30 s

EMQX 5 also supports a **buffer** on the webhook so messages aren't lost if
Vercel is briefly unreachable. Enable it with disk buffering, ~100 MB cap.

### 3.4 (Optional) Status / LWT

When boats connect they SHOULD set a Last-Will-and-Testament:

- Topic: `marina/<slug>/status`
- Payload: `offline`
- QoS: 1
- Retain: true

…and immediately after `CONNECT` publish `online` (retained) on the same topic.
This gives the marina a clean way to know which boats are reachable in real
time. (Server-side consumer for this is not yet implemented — add when needed.)

### 3.5 TLS

Always use **MQTT over TLS** (port 8883 by default) on the public internet.
EMQX provides Let's Encrypt integration in the dashboard. Boats verify the
broker certificate; broker verifies username/password. mTLS is also supported
and recommended once you have a CA process — replace the password-based auth
above with a client-cert authenticator.

---

## 4. Failure modes & idempotency

- The ingest endpoint **overwrites** the latest reading per slug. If two
  publishes arrive out of order (rare with QoS 1, possible with retries),
  the one that *arrives last* wins. Include `ts` in the payload if you want
  to add server-side ordering later.
- Telemetry stored in Redis has a **7-day TTL**. A boat that goes silent for
  longer will appear "no data" until it publishes again.
- A small **history ring** (last 240 readings) is kept at
  `telemetry:<slug>:history` for future charting endpoints.
- The `/api/telemetry/<slug>` endpoint falls back to deterministic *demo*
  telemetry when nothing has been ingested yet, marked with `source: "demo"`
  in the response. Live data is marked `source: "live"`.

---

## 5. Smoke test from a workstation

```bash
TOKEN="<MARINA_INGEST_TOKEN>"

curl -sS -X POST https://hara.mervare.app/api/ingest/telemetry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "slug": "moi",
    "battery": { "voltage": 12.81, "percent": 89 },
    "shore_power": true,
    "bilge": { "water_cm": 0.4, "pump_cycles_24h": 0 },
    "cabin": { "temperature_c": 16.2, "humidity_pct": 64 },
    "heel_deg": 0.2,
    "position": { "lat": 59.5740, "lon": 25.7430 }
  }'
# → {"ok":true,"slug":"moi","ts":1714600000000}
```

Then sign in at `/login`, open `/moi`, and confirm the values appear with
`● live` next to the timestamp.

---

## 6. Where things live

| Concern               | File                                  |
|-----------------------|---------------------------------------|
| Ingest endpoint       | `pages/api/ingest/telemetry.js`       |
| Read endpoint (auth'd)| `pages/api/telemetry/[slug].js`       |
| Storage helpers       | `lib/telemetryStore.js`               |
| Demo fallback         | `lib/telemetry.js`                    |
| Owner / admin checks  | `lib/owners.js`                       |
| Required env vars     | `MARINA_INGEST_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
