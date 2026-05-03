import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { canViewBoat, norm } from "../../../../lib/owners";
import { createTemporaryShare } from "../../../../lib/boatAccess";

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
    return res.status(401).json({ error: "auth required" });
  }

  const ttlMinutes = Number(req.body?.ttlMinutes || 60);
  const sh = await createTemporaryShare({ slug, ownerEmail: email, ttlMinutes });
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const shareUrl = `${proto}://${host}/${encodeURIComponent(slug)}?share=${encodeURIComponent(sh.id)}`;

  return res.status(200).json({
    ok: true,
    shareId: sh.id,
    shareUrl,
    pin: sh.pin,
    expiresAtMs: sh.expiresAtMs,
    ttlMinutes,
  });
}
