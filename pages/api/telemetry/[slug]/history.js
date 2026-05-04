import {
  verifySession,
  SESSION_COOKIE_NAME,
  verifyBoatShareSession,
  BOAT_SHARE_COOKIE_NAME,
} from "../../../../lib/auth";
import { canViewBoat, norm } from "../../../../lib/owners";
import { readTelemetryHistory } from "../../../../lib/supabase";

const MAX_HOURS = 24 * 90; // 90 days, matches retention plan

export default async function handler(req, res) {
  const { slug: rawSlug } = req.query;
  if (!rawSlug) return res.status(400).json({ error: "slug required" });
  const slug = norm(rawSlug);

  // Same auth gate as /api/telemetry/[slug]: owner OR active share PIN session.
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  const share = await verifyBoatShareSession(req.cookies?.[BOAT_SHARE_COOKIE_NAME]);
  const ok =
    (session?.email && canViewBoat(session.email, slug)) ||
    share?.slug === slug;
  if (!ok) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "auth required" });
  }

  const hours = Math.min(
    Math.max(parseInt(req.query.hours, 10) || 24, 1),
    MAX_HOURS,
  );
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 2000, 1),
    5000,
  );
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;

  try {
    const rows = await readTelemetryHistory(slug, { sinceMs, limit });
    res.setHeader("Cache-Control", "private, max-age=30");
    return res.status(200).json({ slug, hours, count: rows.length, rows });
  } catch (e) {
    console.error("history read failed:", e);
    return res.status(500).json({ error: "history read failed" });
  }
}
