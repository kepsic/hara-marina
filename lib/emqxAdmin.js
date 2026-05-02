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
export async function setBoatAcl(username, slug) {
  const body = [{
    username,
    rules: [
      { topic: `marina/${slug}/#`,     permission: "allow", action: "publish"   },
      { topic: `marina/${slug}/cmd/#`, permission: "allow", action: "subscribe" },
      { topic: "#",                    permission: "deny",  action: "all"       },
    ],
  }];
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
