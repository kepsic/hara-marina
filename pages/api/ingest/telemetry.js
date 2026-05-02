import { putTelemetry } from "../../../lib/telemetryStore";
import { norm } from "../../../lib/owners";

// Accepts telemetry pushed by EMQX rule-engine webhook (or any HTTP client).
//
// Auth:    Authorization: Bearer <MARINA_INGEST_TOKEN>
//   or:    x-marina-ingest-token: <MARINA_INGEST_TOKEN>
//
// Body shape (all numeric fields optional — server stores what's provided):
// {
//   "slug": "moi",                 // required (boat slug = name lowercased, non-alnum -> "-")
//   "ts": 1714600000000,           // optional (ms since epoch). Defaults to server now.
//   "battery": { "voltage": 12.74, "percent": 82 },
//   "shore_power": true,
//   "bilge": { "water_cm": 1.2, "pump_cycles_24h": 0 },
//   "cabin": { "temperature_c": 14.5, "humidity_pct": 68 },
//   "heel_deg": 0.3,
//   "position": { "lat": 59.5742, "lon": 25.7431 }
// }

function authorized(req) {
  const expected = process.env.MARINA_INGEST_TOKEN;
  if (!expected) return false;
  const header =
    req.headers["authorization"] ||
    req.headers["x-marina-ingest-token"] ||
    "";
  const got = String(header).replace(/^Bearer\s+/i, "").trim();
  return got && got === expected;
}

function num(v) {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function clean(payload) {
  const out = { slug: norm(payload.slug) };
  if (num(payload.ts) !== undefined) out.ts = num(payload.ts);
  if (payload.battery) {
    out.battery = {
      voltage: num(payload.battery.voltage) ?? 0,
      percent: num(payload.battery.percent) ?? 0,
    };
  }
  if (payload.bilge) {
    out.bilge = {
      water_cm: num(payload.bilge.water_cm) ?? 0,
      pump_cycles_24h: num(payload.bilge.pump_cycles_24h) ?? 0,
    };
  }
  if (payload.cabin) {
    out.cabin = {
      temperature_c: num(payload.cabin.temperature_c) ?? 0,
      humidity_pct: num(payload.cabin.humidity_pct) ?? 0,
    };
  }
  if (payload.position) {
    out.position = {
      lat: num(payload.position.lat) ?? 0,
      lon: num(payload.position.lon) ?? 0,
    };
  }
  if (payload.shore_power !== undefined) out.shore_power = !!payload.shore_power;
  if (num(payload.heel_deg) !== undefined) out.heel_deg = num(payload.heel_deg);
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: "invalid or missing ingest token" });
  }

  let body = req.body;
  // EMQX webhooks sometimes send raw JSON strings depending on configuration.
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {
      return res.status(400).json({ error: "invalid JSON body" });
    }
  }

  // EMQX rule may wrap message as { topic, payload }. Unwrap if so.
  if (body && body.payload && typeof body.payload === "object" && !body.slug) {
    body = { ...body.payload, ...(body.topic ? { _topic: body.topic } : {}) };
  } else if (body && typeof body.payload === "string") {
    try {
      const inner = JSON.parse(body.payload);
      body = { ...inner, ...(body.topic ? { _topic: body.topic } : {}) };
    } catch {}
  }

  // Allow extracting slug from MQTT topic "marina/<slug>/telemetry" if not in payload.
  if (body && !body.slug && body._topic) {
    const parts = String(body._topic).split("/");
    if (parts[0] === "marina" && parts.length >= 2) body.slug = parts[1];
  }

  if (!body || !body.slug) {
    return res.status(400).json({ error: "slug required (in payload or topic)" });
  }

  try {
    const record = clean(body);
    if (!record.slug) return res.status(400).json({ error: "invalid slug" });
    const stored = await putTelemetry(record.slug, record);
    return res.status(200).json({ ok: true, slug: stored.slug, ts: stored.ts });
  } catch (e) {
    console.error("ingest error:", e);
    return res.status(500).json({ error: "store failed" });
  }
}
