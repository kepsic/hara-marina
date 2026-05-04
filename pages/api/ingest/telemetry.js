import { putTelemetry } from "../../../lib/telemetryStore";
import { norm } from "../../../lib/owners";
import { appendTelemetryHistory } from "../../../lib/supabase";

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
    const b = {};
    if (num(payload.battery.voltage) !== undefined) b.voltage = num(payload.battery.voltage);
    if (num(payload.battery.percent) !== undefined) b.percent = num(payload.battery.percent);
    if (Object.keys(b).length) out.battery = b;
  }
  if (payload.bilge) {
    const b = {};
    if (num(payload.bilge.water_cm) !== undefined) b.water_cm = num(payload.bilge.water_cm);
    if (num(payload.bilge.pump_cycles_24h) !== undefined) b.pump_cycles_24h = num(payload.bilge.pump_cycles_24h);
    if (Object.keys(b).length) out.bilge = b;
  }
  if (payload.cabin) {
    const c = {};
    if (num(payload.cabin.temperature_c) !== undefined) c.temperature_c = num(payload.cabin.temperature_c);
    if (num(payload.cabin.humidity_pct) !== undefined) c.humidity_pct = num(payload.cabin.humidity_pct);
    if (Object.keys(c).length) out.cabin = c;
  }
  if (payload.position) {
    const p = {};
    if (num(payload.position.lat) !== undefined) p.lat = num(payload.position.lat);
    if (num(payload.position.lon) !== undefined) p.lon = num(payload.position.lon);
    if (Object.keys(p).length) out.position = p;
  }
  if (payload.shore_power !== undefined) out.shore_power = !!payload.shore_power;
  if (payload.ac && typeof payload.ac === "object") {
    const ac = {};
    if (num(payload.ac.voltage_v) !== undefined) ac.voltage_v = num(payload.ac.voltage_v);
    if (num(payload.ac.current_a) !== undefined) ac.current_a = num(payload.ac.current_a);
    if (num(payload.ac.power_w) !== undefined) ac.power_w = num(payload.ac.power_w);
    if (num(payload.ac.energy_kwh_total) !== undefined) ac.energy_kwh_total = num(payload.ac.energy_kwh_total);
    if (Object.keys(ac).length) out.ac = ac;
  }
  if (payload.relays && typeof payload.relays === "object") {
    const relays = {};
    if (payload.relays.bank1 && typeof payload.relays.bank1 === "object") {
      const b1 = {};
      for (const k of ["relay1", "relay2", "relay3", "relay4"]) {
        if (payload.relays.bank1[k] !== undefined) b1[k] = !!payload.relays.bank1[k];
      }
      if (Object.keys(b1).length) relays.bank1 = b1;
    }
    if (Object.keys(relays).length) out.relays = relays;
  }
  const passthrough = [
    "heel_deg",
    "pitch_deg",
    "water_depth_m",
    "water_temp_c",
    "air_temp_c",
    "dewpoint_c",
    "pressure_mbar",
    "boat_speed_kn",
    "log_total_nm",
    "heading_deg",
    "cog_deg",
    "sog_kn",
  ];
  for (const k of passthrough) {
    if (num(payload[k]) !== undefined) out[k] = num(payload[k]);
  }
  if (payload.wind && typeof payload.wind === "object") {
    const wind = {};
    if (payload.wind.apparent && typeof payload.wind.apparent === "object") {
      const a = {};
      if (num(payload.wind.apparent.speed_kn) !== undefined) a.speed_kn = num(payload.wind.apparent.speed_kn);
      if (num(payload.wind.apparent.angle_deg) !== undefined) a.angle_deg = num(payload.wind.apparent.angle_deg);
      if (Object.keys(a).length) wind.apparent = a;
    }
    if (payload.wind.true && typeof payload.wind.true === "object") {
      const t = {};
      if (num(payload.wind.true.speed_kn) !== undefined) t.speed_kn = num(payload.wind.true.speed_kn);
      if (num(payload.wind.true.angle_deg) !== undefined) t.angle_deg = num(payload.wind.true.angle_deg);
      if (num(payload.wind.true.direction_deg) !== undefined) t.direction_deg = num(payload.wind.true.direction_deg);
      if (Object.keys(t).length) wind.true = t;
    }
    if (Object.keys(wind).length) out.wind = wind;
  }
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

  // Slug is always authoritative from the MQTT topic "marina/<slug>/telemetry".
  // The payload slug is only used as fallback (direct HTTP posts without a topic wrapper).
  if (body && body._topic) {
    const parts = String(body._topic).split("/");
    if (parts[0] === "marina" && parts.length >= 2) body.slug = parts[1];
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
    // Best-effort long-term history (Supabase). Failures must not block the
    // live Redis ingest path.
    appendTelemetryHistory(stored).catch(() => {});
    const stored = await putTelemetry(record.slug, record);
    return res.status(200).json({ ok: true, slug: stored.slug, ts: stored.ts });
  } catch (e) {
    console.error("ingest error:", e);
    return res.status(500).json({ error: "store failed" });
  }
}
