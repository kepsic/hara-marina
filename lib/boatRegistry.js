/**
 * Per-marina boat registry.
 *
 * For Hara Marina (the single-tenant deploy that predates the marinas
 * table) this falls back to the static INITIAL_BOATS list in
 * lib/constants.js so nothing breaks when the DB tables don't exist or are
 * empty.
 *
 * For any other marina slug, reads boats joined to its marinas row.
 */

import { getSupabase } from "./supabase";
import { INITIAL_BOATS } from "./constants";

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function legacyHaraBoats() {
  return INITIAL_BOATS.map((b) => ({
    ...b,
    slug: norm(b.name),
    marinaSlug: "hara",
  }));
}

async function dbBoatsFor(marinaSlug) {
  const sb = getSupabase();
  if (!sb || !marinaSlug) return null;
  try {
    const { data: marina } = await sb
      .from("marinas")
      .select("id")
      .eq("slug", marinaSlug)
      .maybeSingle();
    if (!marina?.id) return null;
    const { data, error } = await sb
      .from("boats")
      .select("*")
      .eq("marina_id", marina.id)
      .eq("active", true)
      .order("section", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error("[boatRegistry] db read failed:", error.message);
      return null;
    }
    if (!data || data.length === 0) return null;
    return data.map((row, idx) => ({
      id: row.id || idx + 1,
      name: row.name,
      slug: row.slug || norm(row.name),
      section: row.section || "",
      owner: row.owner_email || "",
      model: row.model || "",
      length: row.length_m ?? "",
      beam: row.beam_m ?? "",
      draft: row.draft_m ?? "",
      engine: row.engine || "",
      equipment: Array.isArray(row.equipment) ? row.equipment : [],
      notes: row.notes || "",
      color: row.color || "#1e6fa8",
      no_battery: !!row.no_battery,
      marinaSlug,
    }));
  } catch (e) {
    console.error("[boatRegistry] threw:", e?.message || e);
    return null;
  }
}

/** Get the full boat list for a marina. Always returns an array. */
export async function getBoatsForMarina(marinaSlug) {
  const fromDb = await dbBoatsFor(marinaSlug);
  if (fromDb) return fromDb;
  if (!marinaSlug || marinaSlug === "hara") return legacyHaraBoats();
  return [];
}

/** Look up a single boat by slug within a marina. */
export async function getBoatBySlug(marinaSlug, boatSlug) {
  const want = norm(boatSlug);
  const fromDb = await dbBoatsFor(marinaSlug);
  if (fromDb) {
    const hit = fromDb.find((b) => b.slug === want);
    if (hit) return hit;
  }
  if (!marinaSlug || marinaSlug === "hara") {
    return legacyHaraBoats().find((b) => b.slug === want) || null;
  }
  return null;
}
