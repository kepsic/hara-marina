/**
 * POST /api/passages/[slug]/safe — owner marks current active passage as safely
 * arrived. Archives to history with status="completed".
 */
import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { canViewBoat, norm } from "../../../../lib/owners";
import { markSafe } from "../../../../lib/passages";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  const email = session?.email;
  if (!email || !canViewBoat(email, slug)) {
    return res.status(401).json({ error: "owner auth required" });
  }

  const r = await markSafe(slug, email);
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.status(200).json(r);
}
