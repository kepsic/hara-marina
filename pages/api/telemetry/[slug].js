import { makeTelemetry } from "../../../lib/telemetry";
import {
  verifySession,
  SESSION_COOKIE_NAME,
  verifyBoatShareSession,
  BOAT_SHARE_COOKIE_NAME,
} from "../../../lib/auth";
import { canViewBoat } from "../../../lib/owners";
import { getTelemetry } from "../../../lib/telemetryStore";

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
      const last_seen_ago = Math.max(0, Math.floor((Date.now() - (live.ts || Date.now())) / 1000));
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
        ...(dewpoint_c != null ? { dewpoint_c } : {}),
        timestamp: live.ts,
        last_seen_ago,
        source: "live",
      });
    }
  } catch (e) {
    console.error("telemetry read failed:", e);
  }

  // 2. Fallback: synthesised demo telemetry (so the UI is never empty before
  //    the boat's MQTT client is online).
  let boats = null;
  try {
    const r = await fetch(
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/data?key=hara-boats`
    );
    const j = await r.json();
    boats = j.value ? JSON.parse(j.value) : null;
  } catch {}

  if (!boats) {
    const { INITIAL_BOATS } = await import("../../../lib/constants");
    boats = INITIAL_BOATS;
  }

  const boat = boats.find((b) => norm(b.name) === cleanSlug);
  if (!boat) return res.status(404).json({ error: "boat not found" });

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ ...makeTelemetry(boat), source: "demo" });
}
