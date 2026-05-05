// Owner & admin registry sourced from env vars.
//   MARINA_OWNERS_JSON='{"moi":"andres@example.com","julia":"someone@example.com"}'
//   MARINA_ADMINS='admin1@x.com,admin2@y.com'
//   MARINA_SUPERADMINS='kepsic@gmail.com'   ← SaaS owner; receives all boat alerts + full access
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

function loadSuperAdmins() {
  return (process.env.MARINA_SUPERADMINS || "")
    .split(",").map(normEmail).filter(Boolean);
}

function loadHarborMasters() {
  // Harbor masters manage guest-berth bookings. Super-admins inherit the role.
  // Default to kepsic@gmail.com when env is unset so the SaaS owner always has
  // access in fresh deployments.
  const raw = process.env.MARINA_HARBORMASTERS;
  if (raw === undefined || raw === null || raw === "") {
    return ["kepsic@gmail.com"];
  }
  return raw.split(",").map(normEmail).filter(Boolean);
}

/** Returns all super-admin emails (SaaS owners). */
export function getSuperAdmins() {
  return loadSuperAdmins();
}

/** Returns true if `email` is a super-admin (SaaS owner). */
export function isSuperAdmin(email) {
  return loadSuperAdmins().includes(normEmail(email));
}

/** Returns true if `email` is an admin or super-admin. */
export function isAdmin(email) {
  const e = normEmail(email);
  return loadAdmins().includes(e) || loadSuperAdmins().includes(e);
}

/** Returns true if `email` can manage guest-berth bookings (harbor master or super-admin). */
export function isHarborMaster(email) {
  const e = normEmail(email);
  if (!e) return false;
  if (loadSuperAdmins().includes(e)) return true;
  return loadHarborMasters().includes(e);
}

/** Returns the list of harbor master emails (for outbound notifications). */
export function getHarborMasters() {
  const set = new Set([...loadHarborMasters(), ...loadSuperAdmins()]);
  return Array.from(set);
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

/** Returns owner email for a slug, or null if not configured. */
export function getOwnerEmail(slug) {
  const owners = loadOwners();
  const email = owners[norm(slug)];
  return email || null;
}

/** Returns all slugs listed in MARINA_OWNERS_JSON. */
export function getAllOwnerSlugs() {
  return Object.keys(loadOwners());
}

/** True if `email` exists in the registry (owner or admin). */
export function isKnownEmail(email) {
  const e = normEmail(email);
  if (!e) return false;
  if (isAdmin(e)) return true;
  return Object.values(loadOwners()).includes(e);
}
