/**
 * Centralised Redis key naming for the multi-tenant MerVare deployment.
 *
 * All marina-scoped keys are prefixed with the marina slug. The legacy
 * Hara deployment used a hard-coded `hara:*` prefix; that exact prefix is
 * preserved when slug = 'hara' so no data migration is required to flip
 * Hara onto the new helpers.
 */

const HARA_LEGACY_PREFIX = "hara";

function prefix(slug) {
  if (!slug) return HARA_LEGACY_PREFIX;
  const norm = String(slug).trim().toLowerCase();
  if (!norm) return HARA_LEGACY_PREFIX;
  return norm;
}

export const keys = {
  bookings: (slug) => `${prefix(slug)}:bookings:v1`,
  pricing: (slug) => `${prefix(slug)}:pricing:v1`,
  marinaLayout: (slug) => `${prefix(slug)}:marina-layout:v1`,
  // Already namespaced by boat slug; keep as-is, but expose for completeness.
  boatSettings: (boatSlug) => `boat-settings:${boatSlug}`,
  // Stripe Connect map is global — one row per marina inside a single hash.
  stripeConnect: () => "hara:stripe-connect:v1",
};
