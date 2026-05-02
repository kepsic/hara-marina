import { randomBytes } from "crypto";
import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { boatsForEmail, isAdmin, norm } from "../../../lib/owners";
import { upsertMqttUser, setBoatAcl } from "../../../lib/emqxAdmin";

// POST /api/onboarding/provision  { slug }
//
// Auth: signed-in session.
// - Owner can only provision a boat they own.
// - Admin can provision any slug.
//
// Returns the credentials and broker coordinates the boat client needs.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "sign in required" });

  const email = session.email;
  const slug = norm(req.body?.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  if (!isAdmin(email) && !boatsForEmail(email).includes(slug)) {
    return res.status(403).json({ error: "you do not own this boat" });
  }

  const username = `boat-${slug}`;
  const password = randomBytes(16).toString("hex");

  try {
    await upsertMqttUser(username, password);
    await setBoatAcl(username, slug);
  } catch (e) {
    console.error("provision failed:", e);
    return res.status(502).json({ error: "broker provisioning failed", detail: String(e.message || e) });
  }

  const broker_host = process.env.MARINA_MQTT_HOST || "tcp.railway.app";
  const broker_port = Number(process.env.MARINA_MQTT_PORT || 1883);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    slug,
    username,
    password,
    broker: {
      host: broker_host,
      port: broker_port,
      tls: false,
    },
    topic: `marina/${slug}/telemetry`,
    docs_url: "/docs/onboarding",
  });
}
