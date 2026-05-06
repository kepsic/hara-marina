/**
 * Resolve the current marina from a request.
 *
 * Priority:
 *   1. x-marina-slug header (set by middleware.js based on Host)
 *   2. ?marina=slug query (local dev / preview)
 *   3. DEFAULT_MARINA_SLUG env (legacy single-tenant deploys)
 *   4. null (root B2C discovery view)
 *
 * When a slug is resolved, looks up the marinas table in Supabase. If the
 * row is missing OR Supabase is not configured, returns a synthetic record
 * built from MARINA_* env vars so Hara Sadam keeps working without any
 * data migration.
 */

import { getSupabase } from "./supabase";

const HARA_FALLBACK = {
  slug: "hara",
  name: process.env.MARINA_NAME || "Hara Sadam",
  lat: Number(process.env.HARA_MARINA_LAT || 59.5881254),
  lon: Number(process.env.HARA_MARINA_LON || 25.6124356),
  bbox: process.env.HARA_MARINA_BBOX || null,
  country: "EE",
  timezone: "Europe/Tallinn",
  stripe_account_id: null,
  plan: "free",
  active: true,
  legacy: true,
};

export function resolveMarinaSlug(req) {
  const headerSlug = req?.headers?.["x-marina-slug"];
  if (headerSlug && typeof headerSlug === "string") return headerSlug.toLowerCase();

  const qSlug = req?.query?.marina;
  if (qSlug && typeof qSlug === "string") return qSlug.toLowerCase();

  const envSlug = process.env.DEFAULT_MARINA_SLUG;
  if (envSlug) return envSlug.toLowerCase();

  return null;
}

/**
 * @returns {Promise<object|null>} marina record, or null when running in
 *   root-domain discovery mode and no DEFAULT_MARINA_SLUG is set.
 */
export async function getMarinaContext(req) {
  const slug = resolveMarinaSlug(req);
  if (!slug) return null;

  const sb = getSupabase();
  if (sb) {
    try {
      const { data } = await sb
        .from("marinas")
        .select("*")
        .eq("slug", slug)
        .eq("active", true)
        .maybeSingle();
      if (data) return data;
    } catch (e) {
      console.error("[marinaContext] supabase lookup failed:", e?.message || e);
    }
  }

  // Backward-compat fallback for the single-tenant Hara deploy.
  if (slug === "hara") return { ...HARA_FALLBACK };

  return null;
}

/** Pure helper that doesn't touch the DB — useful for client-side rendering. */
export function fallbackMarinaForSlug(slug) {
  if (slug === "hara") return { ...HARA_FALLBACK };
  return null;
}
