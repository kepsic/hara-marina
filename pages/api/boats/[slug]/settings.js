import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { canViewBoat, norm } from "../../../../lib/owners";
import { getBoatSettings, saveBoatSettings } from "../../../../lib/boatSettings";

export default async function handler(req, res) {
  const slug = norm(String(req.query.slug || ""));
  if (!slug) return res.status(400).json({ error: "slug required" });

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email || !canViewBoat(session.email, slug)) {
    return res.status(401).json({ error: "owner sign-in required" });
  }

  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const settings = await getBoatSettings(slug);
    return res.status(200).json({ settings });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    try {
      const settings = await saveBoatSettings(slug, body);
      return res.status(200).json({ settings });
    } catch (e) {
      console.error("[settings] save failed:", e?.message || e);
      return res.status(500).json({ error: "save failed" });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: "method not allowed" });
}
