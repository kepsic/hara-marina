/**
 * Marina membership helpers.
 *
 * These complement lib/owners.js (which works off the env-based
 * MARINA_SUPERADMINS / HARBORMASTERS lists for Hara) by reading the
 * Supabase `marina_members` table for new tenant marinas.
 *
 * A user is "marina admin" if they have role='admin' or
 * role='harbor_master' in marina_members for the given marina.
 */
import { getSupabase } from "./supabase";

/**
 * Resolve a marina by slug + check that the email is an admin of it.
 * Returns the marina row on success, null if not found or not allowed.
 */
export async function getMarinaIfAdmin(slug, email) {
  if (!slug || !email) return null;
  const sb = getSupabase();
  if (!sb) return null;

  const { data: marina } = await sb
    .from("marinas")
    .select("*")
    .eq("slug", String(slug).toLowerCase())
    .maybeSingle();
  if (!marina) return null;

  const { data: member } = await sb
    .from("marina_members")
    .select("role")
    .eq("marina_id", marina.id)
    .eq("email", String(email).toLowerCase())
    .in("role", ["admin", "harbor_master"])
    .maybeSingle();
  if (!member) return null;

  return marina;
}
