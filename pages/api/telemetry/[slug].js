import {
  verifySession,
  SESSION_COOKIE_NAME,
  verifyBoatShareSession,
  BOAT_SHARE_COOKIE_NAME,
} from "../../../lib/auth";
import { canViewBoat } from "../../../lib/owners";
import { getTelemetry } from "../../../lib/telemetryStore";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const RELAY_STATE_KEY = (slug) => `relay_state:${slug}`;

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: "slug required" });
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const cleanSlug = norm(slug);

  // Auth: owner/admin session OR valid shared PIN session for this slug.
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = await verifySession(token);
  const share = await verifyBoatShareSession(req.cookies?.[BOAT_SHARE_COOKIE_NAME]);
  const hasOwnerAccess = !!session?.email && canViewBoat(session.email, cleanSlug);
  const hasShareAccess = share?.slug === cleanSlug;
  if (!hasOwnerAccess && !hasShareAccess) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "auth required" });
  }

  // 1. Live telemetry from Upstash (pushed by EMQX ingest webhook).
  try {
    const live = await getTelemetry(cleanSlug);
    if (live) {
      let cachedRelays = {};
      try {
        const raw = await redis.get(RELAY_STATE_KEY(cleanSlug));
        cachedRelays = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      } catch {}

      const mergedRelays = {
        ...(cachedRelays || {}),
        ...((live?.relays?.bank1 && typeof live.relays.bank1 === "object") ? live.relays.bank1 : {}),
      };

      const relays = Object.keys(mergedRelays).length
        ? { bank1: mergedRelays }
        : live.relays;

      const last_seen_ago = Math.max(0, Math.floor((Date.now() - (live.ts || Date.now())) / 1000));
      // Reject stale cached data — Redis TTL is 7 days but stale emulator/bridge
      // data should never be shown as current. Require data fresher than 1 hour.
      const STALE_THRESHOLD_SECONDS = 3600;
      if (last_seen_ago > STALE_THRESHOLD_SECONDS) {
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(404).json({ error: "no recent telemetry", last_seen_ago });
      }
      // Compute dew point from Magnus formula if sensor doesn't provide it
      let dewpoint_c = live.dewpoint_c;
      if (dewpoint_c == null) {
        const T = live.cabin?.temperature_c;
        const RH = live.cabin?.humidity_pct;
        if (T != null && RH != null && RH > 0) {
          const a = 17.625, b = 243.04;
          const gamma = (a * T) / (b + T) + Math.log(RH / 100);
          dewpoint_c = +((b * gamma) / (a - gamma)).toFixed(1);
        }
      }
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json({
        boat_name: slug,
        ...live,
        ...(relays ? { relays } : {}),
        ...(dewpoint_c != null ? { dewpoint_c } : {}),
        timestamp: live.ts,
        last_seen_ago,
        source: "live",
      });
    }
  } catch (e) {
    console.error("telemetry read failed:", e);
  }

  // No live telemetry available.
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(404).json({ error: "no telemetry" });
}
