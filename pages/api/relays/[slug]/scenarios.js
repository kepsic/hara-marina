import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { canViewBoat } from "../../../../lib/owners";
import { publishCommand } from "../../../../lib/emqxAdmin";
import { Redis } from "../../../../lib/redis.js";

const redis = new Redis();

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const SCENARIOS_KEY = (slug) => `relay_scenarios:${slug}`;

// Allowed telemetry fields that a scenario can monitor
const ALLOWED_FIELDS = [
  "cabin.humidity_pct",
  "cabin.temperature_c",
  "dewpoint_c",
  "battery.voltage",
  "battery.percent",
  "water_depth_m",
  "water_temp_c",
  "bilge.water_cm",
  "ac.power_w",
  "ac.voltage_v",
];

function validateScenario(s) {
  if (!s || typeof s !== "object") return "invalid scenario";
  if (!s.name || typeof s.name !== "string" || s.name.length > 60) return "name required (max 60 chars)";
  if (!ALLOWED_FIELDS.includes(s.field)) return `field must be one of: ${ALLOWED_FIELDS.join(", ")}`;
  if (!["gt", "lt", "gte", "lte"].includes(s.condition)) return "condition must be gt|lt|gte|lte";
  if (!Number.isFinite(s.threshold)) return "threshold must be a number";
  if (!Number.isFinite(s.hysteresis) || s.hysteresis < 0) return "hysteresis must be >= 0";
  const relay = Number(s.relay);
  if (!Number.isInteger(relay) || relay < 1 || relay > 4) return "relay must be 1..4";
  if (typeof s.action !== "boolean") return "action must be true (ON) or false (OFF)";
  return null;
}

export default async function handler(req, res) {
  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email || !canViewBoat(session.email, slug)) {
    return res.status(403).json({ error: "owner access required" });
  }

  if (req.method === "GET") {
    try {
      const raw = await redis.get(SCENARIOS_KEY(slug));
      const scenarios = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
      return res.status(200).json({ scenarios });
    } catch (e) {
      return res.status(500).json({ error: "store error" });
    }
  }

  if (req.method === "PUT") {
    // Replace all scenarios
    const { scenarios } = req.body || {};
    if (!Array.isArray(scenarios)) return res.status(400).json({ error: "scenarios array required" });
    if (scenarios.length > 20) return res.status(400).json({ error: "max 20 scenarios" });

    for (const s of scenarios) {
      const err = validateScenario(s);
      if (err) return res.status(400).json({ error: err });
    }

    // Assign stable IDs if missing
    const now = Date.now();
    const withIds = scenarios.map((s, i) => ({ ...s, id: s.id || `${now}_${i}` }));

    try {
      await redis.set(SCENARIOS_KEY(slug), JSON.stringify(withIds), { ex: 60 * 60 * 24 * 365 });

      // Publish current scenarios to bridge so it can act on them immediately
      await publishCommand(`marina/${slug}/cmd/scenarios`, {
        type: "scenarios_set",
        scenarios: withIds,
        ts: now,
      }, { qos: 1, retain: true });

      return res.status(200).json({ ok: true, scenarios: withIds });
    } catch (e) {
      console.error("scenarios save failed:", e);
      return res.status(500).json({ error: "store error" });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: "GET or PUT only" });
}
