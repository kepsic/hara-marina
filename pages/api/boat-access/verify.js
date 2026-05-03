import {
  signBoatShareSession,
  boatShareCookieHeader,
} from "../../../lib/auth";
import {
  norm,
} from "../../../lib/owners";
import {
  verifyOwnerPin,
  verifyTemporarySharePin,
} from "../../../lib/boatAccess";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  const slug = norm(req.body?.slug || "");
  const pin = String(req.body?.pin || "").trim();
  const shareId = req.body?.shareId ? String(req.body.shareId) : null;
  if (!slug || !pin) return res.status(400).json({ error: "slug and pin required" });

  let expiresAtMs = Date.now() + 12 * 3600 * 1000;
  let source = "owner_pin";
  let matched = false;

  if (shareId) {
    const sh = await verifyTemporarySharePin(slug, shareId, pin);
    if (!sh) return res.status(401).json({ error: "invalid or expired temporary PIN" });
    expiresAtMs = sh.expiresAtMs;
    source = "temporary_share";
    matched = true;
  } else {
    matched = await verifyOwnerPin(slug, pin);
    if (!matched) return res.status(401).json({ error: "invalid PIN" });
  }

  const token = await signBoatShareSession({ slug, shareId, source, expiresAtMs });
  res.setHeader("Set-Cookie", boatShareCookieHeader(token, expiresAtMs));
  return res.status(200).json({ ok: true, source, expiresAtMs });
}
