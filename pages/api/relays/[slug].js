import {
  verifySession,
  SESSION_COOKIE_NAME,
  verifyBoatShareSession,
  BOAT_SHARE_COOKIE_NAME,
} from "../../../lib/auth";
import { canViewBoat } from "../../../lib/owners";
import { getTelemetry } from "../../../lib/telemetryStore";
import { publishCommand } from "../../../lib/emqxAdmin";
import { Redis } from "../../../lib/redis.js";

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const redis = new Redis();
const RELAY_STATE_KEY = (slug) => `relay_state:${slug}`;

function ownerAuthorized(req, slug) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  return verifySession(token).then((session) => !!session?.email && canViewBoat(session.email, slug));
}

export default async function handler(req, res) {
  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const hasOwnerAccess = await ownerAuthorized(req, slug);
  const share = await verifyBoatShareSession(req.cookies?.[BOAT_SHARE_COOKIE_NAME]);
  if (!hasOwnerAccess && share?.slug !== slug) {
    return res.status(401).json({ error: "auth required" });
  }

  if (req.method === "GET") {
    const t = await getTelemetry(slug);
    const live = t?.relays?.bank1 || {};
    let stored = {};
    try {
      const raw = await redis.get(RELAY_STATE_KEY(slug));
      stored = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    } catch {}
    return res.status(200).json({ relays: { ...stored, ...live } });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "GET, POST only" });
  }

  if (!hasOwnerAccess) {
    return res.status(403).json({ error: "owner access required" });
  }

  const relay = Number(req.body?.relay);
  const state = req.body?.state;
  if (!Number.isInteger(relay) || relay < 1 || relay > 4 || typeof state !== "boolean") {
    return res.status(400).json({ error: "relay must be 1..4 and state boolean" });
  }

  const cmd = {
    type: "relay_set",
    bank: 1,
    relay,
    state,
    ts: Date.now(),
  };

  try {
    await publishCommand(`marina/${slug}/cmd/relay`, cmd, { qos: 1, retain: false });
    try {
      const raw = await redis.get(RELAY_STATE_KEY(slug));
      const current = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      current[`relay${relay}`] = state;
      await redis.set(RELAY_STATE_KEY(slug), JSON.stringify(current), { ex: 60 * 60 * 24 * 30 });
    } catch {}
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("relay publish failed:", e);
    return res.status(500).json({ error: "publish failed" });
  }
}
