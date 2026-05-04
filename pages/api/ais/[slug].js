import {
  verifySession,
  SESSION_COOKIE_NAME,
  verifyBoatShareSession,
  BOAT_SHARE_COOKIE_NAME,
} from "../../../lib/auth";
import { canViewBoat } from "../../../lib/owners";
import { fetchSnapshot, isConfigured as cacheConfigured } from "../../../lib/aisCacheClient";
import { classifyMarinaState, MARINA } from "../../../lib/marina";
import { Redis } from "../../../lib/redis.js";

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const redis = new Redis();

function normalizeShipId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? s : null;
}

function safeMarineTrafficUrl(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  return /^https:\/\/www\.marinetraffic\.com\//i.test(s) ? s : null;
}

function buildMarineTrafficUrl({ mmsi, shipId, explicitUrl }) {
  if (explicitUrl) return explicitUrl;
  if (shipId) return `https://www.marinetraffic.com/en/ais/details/ships/shipid:${shipId}`;
  if (mmsi) return `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`;
  return null;
}

async function lookupBoatAisMeta(slug) {
  try {
    const v = await redis.get("hara-boats");
    const list = !v ? null : (typeof v === "string" ? JSON.parse(v) : v);
    if (!Array.isArray(list)) return { mmsi: null, shipId: null, explicitMarineTrafficUrl: null };
    const b = list.find((x) => norm(x.name) === slug);
    const mmsi = b?.mmsi ? String(b.mmsi).trim() : null;
    const shipId = normalizeShipId(
      b?.shipid ?? b?.shipId ?? b?.marineTrafficShipId ?? b?.marinetraffic_shipid
    );
    const explicitMarineTrafficUrl = safeMarineTrafficUrl(
      b?.marineTrafficUrl ?? b?.marinetrafficUrl ?? b?.marinetraffic_url ?? b?.mtUrl ?? b?.mt_url
    );
    return { mmsi, shipId, explicitMarineTrafficUrl };
  } catch {
    return { mmsi: null, shipId: null, explicitMarineTrafficUrl: null };
  }
}

export default async function handler(req, res) {
  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = await verifySession(token);
  const share = await verifyBoatShareSession(req.cookies?.[BOAT_SHARE_COOKIE_NAME]);
  const hasOwnerAccess = !!session?.email && canViewBoat(session.email, slug);
  const hasShareAccess = share?.slug === slug;
  if (!hasOwnerAccess && !hasShareAccess) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "auth required" });
  }
  res.setHeader("Cache-Control", "private, no-store");

  if (!cacheConfigured()) {
    return res.status(200).json({ configured: false, reason: "AIS_CACHE_URL not set" });
  }

  const boatMeta = await lookupBoatAisMeta(slug);
  const mmsi = boatMeta.mmsi;
  const shipId = boatMeta.shipId;
  const explicitMarineTrafficUrl = boatMeta.explicitMarineTrafficUrl;
  const marineTrafficUrl = buildMarineTrafficUrl({ mmsi, shipId, explicitUrl: explicitMarineTrafficUrl });
  if (!mmsi) {
    return res.status(200).json({ configured: false, reason: "boat has no mmsi" });
  }

  const snap = await fetchSnapshot(mmsi);
  if (!snap || !Number.isFinite(snap.lat)) {
    return res.status(200).json({
      configured: true,
      mmsi,
      shipId,
      marineTrafficUrl,
      marina: MARINA,
      state: "no_signal",
      label: "No AIS signal yet",
      lastSeenMs: null,
    });
  }

  const cls = classifyMarinaState({ lat: snap.lat, lon: snap.lon, sog: snap.sog });
  return res.status(200).json({
    configured: true,
    mmsi,
    shipId,
    marineTrafficUrl,
    marina: MARINA,
    name: snap.name,
    lat: snap.lat,
    lon: snap.lon,
    sog: snap.sog,
    cog: snap.cog,
    heading: snap.heading,
    navStatus: snap.navStatus,
    destination: snap.destination,
    ts: snap.ts,
    lastSeenMs: Date.now() - snap.ts,
    ...cls,
  });
}
