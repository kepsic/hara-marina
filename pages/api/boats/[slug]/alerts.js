import { verifySession, SESSION_COOKIE_NAME, verifyBoatShareSession, BOAT_SHARE_COOKIE_NAME } from "../../../../lib/auth";
import { canViewBoat, norm } from "../../../../lib/owners";
import { isShareIdActive } from "../../../../lib/boatAccess";
import { getAlertSnapshot } from "../../../../lib/alerts";

export default async function handler(req, res) {
  const slug = norm(String(req.query.slug || ""));
  if (!slug) return res.status(400).json({ error: "slug required" });

  // Owner sign-in OR active boat-share session may read alerts (read-only).
  // Read-only access is needed by the VesselSafetyHero card shown to viewers
  // who hold a temporary PIN. Mutations live on /ack and /snooze and remain
  // owner-only.
  let authorized = false;
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (session?.email && canViewBoat(session.email, slug)) {
    authorized = true;
  } else {
    const share = await verifyBoatShareSession(req.cookies?.[BOAT_SHARE_COOKIE_NAME]);
    if (share && norm(share.slug) === slug) {
      if (!share.shareId || (await isShareIdActive(slug, share.shareId))) {
        authorized = true;
      }
    }
  }
  if (!authorized) return res.status(401).json({ error: "auth required" });

  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const snapshot = await getAlertSnapshot(slug, limit);
    return res.status(200).json({
      slug,
      active: snapshot.active || [],
      history: snapshot.history || [],
      meta: snapshot.meta || {},
    });
  } catch (e) {
    console.error("[alerts] read failed:", e?.message || e);
    return res.status(500).json({ error: "read failed" });
  }
}
