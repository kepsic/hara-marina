import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { boatsForEmail, isAdmin, isSuperAdmin } from "../../../lib/owners";

export default async function handler(req, res) {
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "sign in required" });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    email: session.email,
    is_admin: isAdmin(session.email),
    is_super_admin: isSuperAdmin(session.email),
    slugs: boatsForEmail(session.email),
  });
}
