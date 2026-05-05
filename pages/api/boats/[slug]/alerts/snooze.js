import { verifySession, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import { canViewBoat, norm } from "../../../../../lib/owners";
import { snoozeAlert } from "../../../../../lib/alerts";

export default async function handler(req, res) {
  const slug = norm(String(req.query.slug || ""));
  if (!slug) return res.status(400).json({ error: "slug required" });

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email || !canViewBoat(session.email, slug)) {
    return res.status(401).json({ error: "owner sign-in required" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const rule = String(req.body?.rule || "").trim();
  const minutes = Number(req.body?.minutes);
  if (!rule) return res.status(400).json({ error: "rule required" });

  try {
    const out = await snoozeAlert(slug, rule, Number.isFinite(minutes) ? minutes : 60);
    if (!out.ok) return res.status(400).json({ error: out.error || "snooze failed" });
    return res.status(200).json(out);
  } catch (e) {
    console.error("[watchkeeper] snooze failed:", e?.message || e);
    return res.status(500).json({ error: "snooze failed" });
  }
}
