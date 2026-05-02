import { randomBytes } from "crypto";
import { verifySetupToken } from "../../../lib/auth";
import { upsertMqttUser, setBoatAcl } from "../../../lib/emqxAdmin";

// GET /api/onboarding/config?t=<setup_token>
//
// Used by the boat install script. Validates the one-shot setup token, mints
// fresh per-boat MQTT credentials, applies the ACL, and returns a ready-to-run
// marina-bridge config.yaml file.
//
// Returns text/yaml so it can be written straight to /etc/marina-bridge.yaml.
//
// Single use: the same token is accepted multiple times within its 30-min TTL
// (so the user can retry the install), but each call rotates the password.

const ALLOWED = new Set(["cerbo", "ydwg", "both", "custom"]);

function yamlEscape(s) {
  return String(s).replace(/(['"\\])/g, "\\$1");
}

function buildYaml({ slug, username, password, source, broker_host, broker_port, topic }) {
  const useCerbo = source === "cerbo" || source === "both";
  const useYdwg  = source === "ydwg"  || source === "both";
  const lines = [
    `# marina-bridge config for ${slug}`,
    `# generated ${new Date().toISOString()} via /api/onboarding/config`,
    "",
    `slug: "${yamlEscape(slug)}"`,
    `publish_interval: 30s`,
    "",
    "marina:",
    `  broker:   "tcp://${yamlEscape(broker_host)}:${broker_port}"`,
    `  username: "${yamlEscape(username)}"`,
    `  password: "${yamlEscape(password)}"`,
    `  topic:    "${yamlEscape(topic)}"`,
    "",
    "sources:",
  ];
  if (useCerbo) {
    lines.push(
      "  cerbo:",
      "    enabled: true",
      "    # Bridge auto-discovers the local Venus OS broker on first connect.",
      "    broker:  \"tcp://venus.local:1883\"",
      "    # vrm_id: \"auto\" → bridge sniffs the VRM ID from the first message it sees.",
      "    vrm_id:  \"auto\"",
    );
  }
  if (useYdwg) {
    lines.push(
      "  ydwg:",
      "    enabled: true",
      "    # YDWG-02 default in AP mode. Adjust if running on a station.",
      "    address: \"192.168.4.1:1457\"",
    );
  }
  if (!useCerbo && !useYdwg) {
    lines.push("  # custom mode — no native sources enabled. POST telemetry directly to /api/ingest/telemetry.");
  }
  return lines.join("\n") + "\n";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const t = String(req.query.t || "");
  const claims = await verifySetupToken(t);
  if (!claims) return res.status(401).json({ error: "invalid or expired setup token" });

  const slug = claims.slug;
  const source = ALLOWED.has(claims.source) ? claims.source : "cerbo";
  const username = `boat-${slug}`;
  const password = randomBytes(16).toString("hex");

  try {
    await upsertMqttUser(username, password);
    await setBoatAcl(username, slug);
  } catch (e) {
    console.error("[config] provisioning failed:", e);
    return res.status(502).json({ error: "broker provisioning failed" });
  }

  const broker_host = process.env.MARINA_MQTT_HOST || "tcp.railway.app";
  const broker_port = Number(process.env.MARINA_MQTT_PORT || 1883);
  const topic = `marina/${slug}/telemetry`;

  const yaml = buildYaml({ slug, username, password, source, broker_host, broker_port, topic });

  res.setHeader("Content-Type", "text/yaml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `inline; filename="marina-bridge.${slug}.yaml"`);
  return res.status(200).send(yaml);
}
