// Thin wrapper around the EMQX 5 dashboard REST API. Used by onboarding
// to mint per-boat MQTT credentials and ACL entries.
//
// Required env vars on the Next.js deployment:
//   EMQX_DASHBOARD_URL       (e.g. https://hara-marina-emqx-production.up.railway.app)
//   EMQX_DASHBOARD_USERNAME  (default: admin)
//   EMQX_DASHBOARD_PASSWORD  (the dashboard admin password)

const TOKEN_TTL_MS = 4 * 60 * 1000; // dashboard JWT lasts 60min; refresh well before
let cached = { token: null, exp: 0 };

function baseUrl() {
  const u = process.env.EMQX_DASHBOARD_URL;
  if (!u) throw new Error("EMQX_DASHBOARD_URL not set");
  return u.replace(/\/+$/, "");
}

async function login() {
  const username = process.env.EMQX_DASHBOARD_USERNAME || "admin";
  const password = process.env.EMQX_DASHBOARD_PASSWORD;
  if (!password) throw new Error("EMQX_DASHBOARD_PASSWORD not set");
  const r = await fetch(`${baseUrl()}/api/v5/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error(`emqx login failed: ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error("emqx login: no token");
  cached = { token: j.token, exp: Date.now() + TOKEN_TTL_MS };
  return j.token;
}

async function token() {
  if (cached.token && cached.exp > Date.now()) return cached.token;
  return await login();
}

async function api(path, init = {}) {
  const t = await token();
  const r = await fetch(`${baseUrl()}/api/v5${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${t}`,
      ...(init.headers || {}),
    },
  });
  return r;
}

/** Publish a command payload to an MQTT topic via EMQX dashboard API. */
export async function publishCommand(topic, payload, { qos = 1, retain = false } = {}) {
  const r = await api(`/publish`, {
    method: "POST",
    body: JSON.stringify({
      topic,
      payload: JSON.stringify(payload),
      qos,
      retain,
      payload_encoding: "plain",
    }),
  });
  if (!r.ok && r.status !== 204) {
    const txt = await r.text().catch(() => "");
    throw new Error(`publishCommand failed: ${r.status} ${txt}`);
  }
  return true;
}

/** Create or update an MQTT user in the built-in DB. */
export async function upsertMqttUser(username, password) {
  // Try create
  const r = await api(`/authentication/password_based:built_in_database/users`, {
    method: "POST",
    body: JSON.stringify({ user_id: username, password }),
  });
  if (r.ok) return { created: true };
  // Update
  const r2 = await api(
    `/authentication/password_based:built_in_database/users/${encodeURIComponent(username)}`,
    { method: "PUT", body: JSON.stringify({ password }) }
  );
  if (r2.ok) return { created: false };
  const txt = await r2.text().catch(() => "");
  throw new Error(`upsertMqttUser failed: ${r2.status} ${txt}`);
}

/** Replace ACL rules for a single user (publish own topic, subscribe own cmd, deny rest). */
/**
 * Authorize an MQTT user to publish/subscribe under their boat's
 * marina-namespaced topic prefix only.
 *
 * Topic convention (multi-tenant safe):
 *   marina/<marinaSlug>/<boatSlug>/#       — publish (telemetry, ais, …)
 *   marina/<marinaSlug>/<boatSlug>/cmd/#   — subscribe (commands)
 *
 * `marinaSlug` defaults to 'hara' so existing single-tenant Hara boats
 * keep their established `marina/hara/<boat>/#` permissions without any
 * re-provisioning.
 */
export async function setBoatAcl(username, slug, marinaSlug = "hara") {
  // Backward compat: Hara provisioned boats with topics `marina/<slug>/#`
  // (no marina segment). Keep granting those topics to hara-namespaced
  // boats so existing fleets aren't disconnected. New marinas use the
  // explicit `marina/<marinaSlug>/<slug>/#` form which scopes ACLs per
  // tenant and prevents two marinas with the same boat name from sharing
  // a channel.
  const isLegacyHara = marinaSlug === "hara";
  const rules = isLegacyHara
    ? [
        { topic: `marina/${marinaSlug}/${slug}/#`,     permission: "allow", action: "publish"   },
        { topic: `marina/${marinaSlug}/${slug}/cmd/#`, permission: "allow", action: "subscribe" },
        { topic: `marina/${slug}/#`,                   permission: "allow", action: "publish"   },
        { topic: `marina/${slug}/cmd/#`,               permission: "allow", action: "subscribe" },
        { topic: "#",                                  permission: "deny",  action: "all"       },
      ]
    : [
        { topic: `marina/${marinaSlug}/${slug}/#`,     permission: "allow", action: "publish"   },
        { topic: `marina/${marinaSlug}/${slug}/cmd/#`, permission: "allow", action: "subscribe" },
        { topic: "#",                                  permission: "deny",  action: "all"       },
      ];
  const body = [{ username, rules }];
  // The `users` endpoint accepts an array; sending the same username overwrites.
  const r = await api(`/authorization/sources/built_in_database/rules/users`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 204) {
    const txt = await r.text().catch(() => "");
    throw new Error(`setBoatAcl failed: ${r.status} ${txt}`);
  }
  return true;
}
