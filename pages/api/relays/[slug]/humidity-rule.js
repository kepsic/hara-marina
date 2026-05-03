import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { canViewBoat } from "../../../../lib/owners";
import { publishCommand } from "../../../../lib/emqxAdmin";

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  const slug = norm(req.query.slug || "");
  if (!slug) return res.status(400).json({ error: "slug required" });

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email || !canViewBoat(session.email, slug)) {
    return res.status(403).json({ error: "owner access required" });
  }

  const relay = Number(req.body?.relay);
  const onAbove = Number(req.body?.onAbove);
  const offBelow = Number(req.body?.offBelow);
  const enabled = Boolean(req.body?.enabled);

  if (!Number.isInteger(relay) || relay < 1 || relay > 4) {
    return res.status(400).json({ error: "relay must be 1..4" });
  }
  if (!Number.isFinite(onAbove) || !Number.isFinite(offBelow) || offBelow >= onAbove) {
    return res.status(400).json({ error: "invalid thresholds (offBelow must be < onAbove)" });
  }

  const cmd = {
    type: "humidity_rule_set",
    enabled,
    bank: 1,
    relay,
    on_above: onAbove,
    off_below: offBelow,
    ts: Date.now(),
  };

  try {
    await publishCommand(`marina/${slug}/cmd/humidity`, cmd, { qos: 1, retain: true });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("humidity rule publish failed:", e);
    return res.status(500).json({ error: "publish failed" });
  }
}
