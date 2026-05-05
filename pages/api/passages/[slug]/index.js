/**
 * Passage CRUD endpoint.
 *
 * GET    — owner OR active boat-share viewer; returns active passage + history
 * POST   — owner only; create/replace active passage  { destination, eta_ts, notes }
 * DELETE — owner only; cancel active passage          { reason? }
 */
import {
  verifySession,
  verifyBoatShareSession,
  SESSION_COOKIE_NAME,
  BOAT_SHARE_COOKIE_NAME,
} from "../../../../lib/auth";
import { canViewBoat, norm } from "../../../../lib/owners";
import { isShareIdActive } from "../../../../lib/boatAccess";
import {
  getActivePassage,
  getPassageHistory,
  startPassage,
  cancelPassage,
} from "../../../../lib/passages";

async function resolveAuth(req, slug) {
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (session?.email && canViewBoat(session.email, slug)) {
    return { kind: "owner", email: session.email };
  }
  const share = await verifyBoatShareSession(req.cookies?.[BOAT_SHARE_COOKIE_NAME]);
  if (share && norm(share.slug) === slug) {
    if (share.shareId) {
      const ok = await isShareIdActive(slug, share.shareId);
      if (!ok) return { kind: "none" };
    }
    return { kind: "viewer" };
  }
  return { kind: "none" };
}

export default async function handler(req, res) {
  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const auth = await resolveAuth(req, slug);
  if (auth.kind === "none") return res.status(401).json({ error: "auth required" });

  if (req.method === "GET") {
    const [active, history] = await Promise.all([
      getActivePassage(slug),
      getPassageHistory(slug, 5),
    ]);
    return res.status(200).json({ active, history });
  }

  if (auth.kind !== "owner") {
    return res.status(403).json({ error: "owner only" });
  }

  if (req.method === "POST") {
    const r = await startPassage(slug, auth.email, req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    return res.status(200).json(r);
  }

  if (req.method === "DELETE") {
    const r = await cancelPassage(slug, auth.email, req.body?.reason || "cancelled");
    if (!r.ok) return res.status(400).json({ error: r.error });
    return res.status(200).json(r);
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "method not allowed" });
}
