import { makeTelemetry } from "../../../lib/telemetry";
import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { canViewBoat } from "../../../lib/owners";

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: "slug required" });

  // Auth: must have a valid session cookie AND own (or admin) this boat.
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = await verifySession(token);
  if (!session?.email || !canViewBoat(session.email, slug)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "auth required" });
  }

  // Pull current boats list from KV (falls back to constants)
  let boats = null;
  try {
    const r = await fetch(
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/data?key=hara-boats`
    );
    const j = await r.json();
    boats = j.value ? JSON.parse(j.value) : null;
  } catch {}

  if (!boats) {
    const { INITIAL_BOATS } = await import("../../../lib/constants");
    boats = INITIAL_BOATS;
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const boat = boats.find((b) => norm(b.name) === norm(slug));
  if (!boat) return res.status(404).json({ error: "boat not found" });

  // Telemetry is per-user data — do not cache on shared CDNs.
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(makeTelemetry(boat));
}
