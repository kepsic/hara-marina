/**
 * Public availability endpoint.
 *
 * Returns which date ranges are blocked for a given berth (or for all berths
 * when no berth is specified). Exposes ONLY arrival/departure/status — never
 * guest details, contact info, or prices. Safe to call without auth, since
 * the same information is implied by the green/blue silhouettes on the map.
 *
 * GET /api/bookings/availability                       → { blocked: { berthId: [{from,to,status}, ...] } }
 * GET /api/bookings/availability?berth=GA-3            → { blocked: [{from,to,status}, ...] }
 * GET /api/bookings/availability?berth=GA-3&from=...&to=...
 */

import { listBookings } from "../../../lib/bookings";

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "checked-in"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const { berth, from, to } = req.query;
  const all = await listBookings({
    berthId: berth || undefined,
    fromIso: from || undefined,
    toIso: to || undefined,
  });
  const active = all.filter((b) => ACTIVE_STATUSES.has(b.status));

  if (berth) {
    return res.status(200).json({
      berth,
      blocked: active.map((b) => ({ from: b.arrival, to: b.departure, status: b.status })),
    });
  }

  const grouped = {};
  for (const b of active) {
    if (!grouped[b.berthId]) grouped[b.berthId] = [];
    grouped[b.berthId].push({ from: b.arrival, to: b.departure, status: b.status });
  }
  return res.status(200).json({ blocked: grouped });
}
