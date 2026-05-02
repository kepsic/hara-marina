import { verifyMagicToken, signSession, sessionCookieHeader } from "../../../lib/auth";

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    return res.status(400).send("Missing token");
  }
  const payload = await verifyMagicToken(token);
  if (!payload) {
    return res.status(401).send("This sign-in link is invalid or has expired. Request a new one at /login");
  }
  try {
    const session = await signSession(payload.email);
    res.setHeader("Set-Cookie", sessionCookieHeader(session));
    const next = typeof payload.next === "string" && payload.next.startsWith("/") ? payload.next : "/";
    res.writeHead(302, { Location: next });
    res.end();
  } catch (e) {
    console.error("auth/verify error:", e);
    res.status(500).send("Server error");
  }
}
