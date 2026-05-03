// HTTP client for the ais-cache Railway service.
//
// Env:
//   AIS_CACHE_URL    e.g. https://ais-cache.up.railway.app
//   AIS_CACHE_TOKEN  bearer token (optional but recommended)
//
// Falls back to `null` cleanly when the service is not configured so the
// owner page renders the "no signal" branch instead of erroring.

const BASE = (process.env.AIS_CACHE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.AIS_CACHE_TOKEN || "";

function authHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

export function isConfigured() {
  return Boolean(BASE);
}

export async function fetchSnapshot(mmsi) {
  if (!BASE || !mmsi) return null;
  try {
    const r = await fetch(`${BASE}/api/v1/snapshot?mmsi=${encodeURIComponent(mmsi)}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.found === false) return null;
    return j;
  } catch {
    return null;
  }
}

export async function fetchBBox(lat1, lon1, lat2, lon2) {
  if (!BASE) return [];
  try {
    const url = `${BASE}/api/v1/bbox?lat1=${lat1}&lon1=${lon1}&lat2=${lat2}&lon2=${lon2}`;
    const r = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}
