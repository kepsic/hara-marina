import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { canViewBoat, norm } from "../../../../lib/owners";
import { getAlertSnapshot } from "../../../../lib/alerts";

export default async function handler(req, res) {
  const slug = norm(String(req.query.slug || ""));
  if (!slug) return res.status(400).json({ error: "slug required" });

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email || !canViewBoat(session.email, slug)) {
    return res.status(401).json({ error: "owner sign-in required" });
  }

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
