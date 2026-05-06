/**
 * Centralised Redis key naming for the multi-tenant MerVare deployment.
 *
 * All marina-scoped keys are prefixed with the marina slug. The legacy
 * Hara deployment used a hard-coded `hara:*` prefix; that exact prefix
 * is preserved when slug = 'hara'.
 *
 * SECURITY: every slug is validated before being baked into a Redis
 * key. A request that smuggled `hara:stripe-connect:v1` as a slug
 * would otherwise let an attacker read or overwrite cross-tenant data;
 * the regex blocks that at the key boundary.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const HARA_LEGACY_PREFIX = "hara";

function safe(slug) {
  if (slug == null || slug === "") return HARA_LEGACY_PREFIX;
  const norm = String(slug).trim().toLowerCase();
  if (!norm) return HARA_LEGACY_PREFIX;
  if (!SLUG_RE.test(norm)) {
    throw new Error(`Invalid marina slug for Redis key: ${JSON.stringify(slug)}`);
  }
  return norm;
}

export const keys = {
  bookings: (slug) => `${safe(slug)}:bookings:v1`,
  pricing: (slug) => `${safe(slug)}:pricing:v1`,
  marinaLayout: (slug) => `${safe(slug)}:marina-layout:v1`,
  boatSettings: (boatSlug) => `boat-settings:${boatSlug}`,
  // Stripe Connect map is global — one row per marina inside a single hash.
  stripeConnect: () => "hara:stripe-connect:v1",
  // Stripe webhook event dedup (24h TTL applied at write site).
  stripeEvent: (eventId) => `stripe:event:${eventId}`,
};
