import { clearBoatShareCookieHeader, clearSessionCookieHeader } from "../../../lib/auth";

export default async function handler(req, res) {
  res.setHeader("Set-Cookie", [clearSessionCookieHeader(), clearBoatShareCookieHeader()]);
  if (req.method === "GET") {
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }
  res.status(200).json({ ok: true });
}
