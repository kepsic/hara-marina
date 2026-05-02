// Owner & admin registry sourced from env vars.
//   MARINA_OWNERS_JSON='{"moi":"andres@example.com","julia":"someone@example.com"}'
//   MARINA_ADMINS='admin1@x.com,admin2@y.com'
// Slugs match those used by /[slug] (boat name lowercased, non-alnum → "-").

export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const normEmail = (e) => String(e || "").trim().toLowerCase();

function loadOwners() {
  try {
    const raw = process.env.MARINA_OWNERS_JSON || "{}";
    const obj = JSON.parse(raw);
    const map = {};
    for (const [slug, email] of Object.entries(obj)) {
      map[norm(slug)] = normEmail(email);
    }
    return map;
  } catch {
    return {};
  }
}

function loadAdmins() {
  return (process.env.MARINA_ADMINS || "")
    .split(",").map(normEmail).filter(Boolean);
}

/** Returns true if `email` is an admin. */
export function isAdmin(email) {
  return loadAdmins().includes(normEmail(email));
}

/** Returns the slugs of boats owned by this email. Admins return all known slugs. */
export function boatsForEmail(email) {
  const owners = loadOwners();
  const e = normEmail(email);
  if (!e) return [];
  const owned = Object.entries(owners)
    .filter(([, owner]) => owner === e)
    .map(([slug]) => slug);
  if (isAdmin(e)) return Array.from(new Set([...owned, ...Object.keys(owners)]));
  return owned;
}

/** True if `email` is allowed to view a given boat slug. */
export function canViewBoat(email, slug) {
  if (!email) return false;
  if (isAdmin(email)) return true;
  const owners = loadOwners();
  return owners[norm(slug)] === normEmail(email);
}

/** True if `email` exists in the registry (owner or admin). */
export function isKnownEmail(email) {
  const e = normEmail(email);
  if (!e) return false;
  if (isAdmin(e)) return true;
  return Object.values(loadOwners()).includes(e);
}
