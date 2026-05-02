import { isKnownEmail } from "../../../lib/owners";
import { signMagicToken, sendMagicLink } from "../../../lib/auth";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { email, next } = req.body || {};
  const safeNext = typeof next === "string" && next.startsWith("/") ? next : "/";

  // Always return the same response so we don't leak which emails are registered.
  const generic = { ok: true, message: "If that email is registered, a sign-in link has been sent." };

  if (!email || typeof email !== "string") return res.status(400).json({ error: "email required" });

  if (!isKnownEmail(email)) {
    // Pretend to send.
    return res.status(200).json(generic);
  }

  try {
    const token = await signMagicToken(email, safeNext);
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const link = `${proto}://${host}/api/auth/verify?token=${encodeURIComponent(token)}`;
    const result = await sendMagicLink({ email, link });
    if (!result.ok) return res.status(502).json({ error: "Could not send email" });
    return res.status(200).json(generic);
  } catch (e) {
    console.error("auth/request error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
