import {
  verifySession,
  SESSION_COOKIE_NAME,
} from "../../../lib/auth";
import { canViewBoat, isAdmin, norm } from "../../../lib/owners";
import { getActiveShareMeta, hasOwnerPin, setOwnerPin, validatePinFormat } from "../../../lib/boatAccess";

export default async function handler(req, res) {
  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  const email = session?.email;
  if (!email || !canViewBoat(email, slug)) {
    return res.status(401).json({ error: "auth required" });
  }

  if (req.method === "GET") {
    const [ownerPinSet, activeShare] = await Promise.all([
      hasOwnerPin(slug),
      getActiveShareMeta(slug),
    ]);
    return res.status(200).json({ ownerPinSet, activeShare });
  }

  if (req.method === "POST") {
    const pin = String(req.body?.ownerPin || "").trim();
    if (!validatePinFormat(pin)) {
      return res.status(400).json({ error: "PIN must be 4-10 digits" });
    }
    try {
      await setOwnerPin(slug, pin);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || "failed" });
    }
  }

  if (req.method === "DELETE") {
    if (!isAdmin(email)) return res.status(403).json({ error: "admin only" });
    return res.status(405).json({ error: "not implemented" });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
