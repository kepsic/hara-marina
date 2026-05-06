/**
 * GET /api/marinas
 *   Public list of active marinas for the B2C discovery map.
 *   Cached for 60s on the edge.
 */

import { getSupabase } from "../../../lib/supabase";

const FALLBACK = [
  {
    slug: "hara",
    name: process.env.MARINA_NAME || "Hara Sadam",
    lat: Number(process.env.HARA_MARINA_LAT || 59.5881254),
    lon: Number(process.env.HARA_MARINA_LON || 25.6124356),
    country: "EE",
    berth_count: null,
    available_berths: null,
  },
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");

  const sb = getSupabase();
  if (!sb) return res.json({ marinas: FALLBACK });

  try {
    const { data, error } = await sb
      .from("marinas")
      .select("slug, name, lat, lon, country, plan")
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) {
      console.error("[/api/marinas] supabase error:", error.message);
      return res.json({ marinas: FALLBACK });
    }
    if (!data || data.length === 0) return res.json({ marinas: FALLBACK });
    return res.json({
      marinas: data.map((m) => ({
        slug: m.slug,
        name: m.name,
        lat: m.lat,
        lon: m.lon,
        country: m.country,
        plan: m.plan,
        berth_count: null,
        available_berths: null,
      })),
    });
  } catch (e) {
    console.error("[/api/marinas] threw:", e?.message || e);
    return res.json({ marinas: FALLBACK });
  }
}
