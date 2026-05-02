import { verifySession, signSetupToken, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { boatsForEmail, isAdmin, norm } from "../../../lib/owners";

const ALLOWED_SOURCES = new Set(["cerbo", "ydwg", "both", "custom"]);

// POST /api/onboarding/setup-token  { slug, source }
//
// Returns a short-lived (30 min) JWT and the public install command the owner
// pastes onto the boat. The boat install script uses the token to fetch its
// config (which triggers per-boat MQTT credential rotation server-side).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "sign in required" });

  const slug = norm(req.body?.slug || "");
  const source = String(req.body?.source || "cerbo");
  if (!slug) return res.status(400).json({ error: "slug required" });
  if (!ALLOWED_SOURCES.has(source)) return res.status(400).json({ error: "invalid source" });

  if (!isAdmin(session.email) && !boatsForEmail(session.email).includes(slug)) {
    return res.status(403).json({ error: "you do not own this boat" });
  }

  const token = await signSetupToken({ email: session.email, slug, source });
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers.host;
  const base  = `${proto}://${host}`;
  const setup_url = `${base}/api/onboarding/config?t=${encodeURIComponent(token)}`;
  const command = `curl -fsSL ${base}/install.sh | sudo MARINA_SETUP='${setup_url}' bash`;

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    slug,
    source,
    expires_in_min: 30,
    setup_url,
    command,
  });
}
