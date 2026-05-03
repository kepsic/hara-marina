import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { canViewBoat } from "../../../lib/owners";
import { getCachedSnapshot } from "../../../lib/aisStream";
import { classifyMarinaState, MARINA } from "../../../lib/marina";
import { Redis } from "@upstash/redis";

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function lookupMmsi(slug) {
  try {
    const v = await redis.get("hara-boats");
    const list = !v ? null : (typeof v === "string" ? JSON.parse(v) : v);
    if (!Array.isArray(list)) return null;
    const b = list.find((x) => norm(x.name) === slug);
    return b?.mmsi ? String(b.mmsi).trim() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = await verifySession(token);
  if (!session?.email || !canViewBoat(session.email, slug)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "auth required" });
  }
  res.setHeader("Cache-Control", "private, no-store");

  if (!process.env.AISSTREAM_API_KEY) {
    return res.status(200).json({ configured: false, reason: "AISSTREAM_API_KEY not set" });
  }

  const mmsi = await lookupMmsi(slug);
  if (!mmsi) {
    return res.status(200).json({ configured: false, reason: "boat has no mmsi" });
  }

  const snap = await getCachedSnapshot(mmsi);
  if (!snap || !Number.isFinite(snap.lat)) {
    return res.status(200).json({
      configured: true,
      mmsi,
      marina: MARINA,
      state: "no_signal",
      label: "No AIS signal yet",
      lastSeenMs: null,
    });
  }

  const cls = classifyMarinaState(snap);
  return res.status(200).json({
    configured: true,
    mmsi,
    marina: MARINA,
    name: snap.name,
    lat: snap.lat,
    lon: snap.lon,
    sog: snap.sog,
    cog: snap.cog,
    heading: snap.heading,
    navStatus: snap.navStatus,
    ts: snap.ts,
    lastSeenMs: Date.now() - snap.ts,
    ...cls,
  });
}
