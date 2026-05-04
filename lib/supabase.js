/**
 * Server-side Supabase client (service role).
 *
 * Used for writing telemetry history rows and reading them back from API
 * routes. The publishable key is *not* used here on purpose — RLS is enabled
 * on telemetry_history and there are no policies granting anon access.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

const COLUMNS = {
  battery_v:           (t) => t?.battery?.voltage,
  battery_pct:         (t) => t?.battery?.percent,
  shore_power:         (t) => t?.shore_power,
  ac_voltage_v:        (t) => t?.ac?.voltage_v,
  ac_current_a:        (t) => t?.ac?.current_a,
  ac_power_w:          (t) => t?.ac?.power_w,
  ac_kwh_total:        (t) => t?.ac?.energy_kwh_total,
  cabin_temp_c:        (t) => t?.cabin?.temperature_c,
  cabin_humid:         (t) => t?.cabin?.humidity_pct,
  dewpoint_c:          (t) => t?.dewpoint_c,
  water_temp_c:        (t) => t?.water_temp_c,
  air_temp_c:          (t) => t?.air_temp_c,
  pressure_mbar:       (t) => t?.pressure_mbar,
  bilge_water_cm:      (t) => t?.bilge?.water_cm,
  bilge_pump_24h:      (t) => t?.bilge?.pump_cycles_24h,
  heel_deg:            (t) => t?.heel_deg,
  pitch_deg:           (t) => t?.pitch_deg,
  boat_speed_kn:       (t) => t?.boat_speed_kn,
  sog_kn:              (t) => t?.sog_kn,
  cog_deg:             (t) => t?.cog_deg,
  heading_deg:         (t) => t?.heading_deg,
  log_total_nm:        (t) => t?.log_total_nm,
  water_depth_m:       (t) => t?.water_depth_m,
  wind_app_speed_kn:   (t) => t?.wind?.apparent?.speed_kn,
  wind_app_angle_deg:  (t) => t?.wind?.apparent?.angle_deg,
  wind_true_speed_kn:  (t) => t?.wind?.true?.speed_kn,
  wind_true_angle_deg: (t) => t?.wind?.true?.angle_deg,
  wind_true_dir_deg:   (t) => t?.wind?.true?.direction_deg,
  lat:                 (t) => t?.position?.lat,
  lon:                 (t) => t?.position?.lon,
};

function flatten(record) {
  const row = {
    slug: record.slug,
    ts: new Date(record.ts || Date.now()).toISOString(),
  };
  for (const [col, pick] of Object.entries(COLUMNS)) {
    const v = pick(record);
    if (v === undefined || v === null) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    row[col] = v;
  }
  return row;
}

/**
 * Append a single telemetry snapshot to history. Best-effort: errors are
 * swallowed so a Supabase outage never breaks live ingest.
 */
export async function appendTelemetryHistory(record) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const row = flatten(record);
    const { error } = await sb.from("telemetry_history").insert(row);
    if (error) console.error("[supabase] history insert failed:", error.message);
  } catch (e) {
    console.error("[supabase] history insert threw:", e?.message || e);
  }
}

/**
 * Read history for a slug. Returns rows in chronological order.
 *
 * @param {string} slug
 * @param {object} [opts]
 * @param {number} [opts.sinceMs] epoch-ms lower bound (default: 24h ago)
 * @param {number} [opts.limit]   max rows (default: 2000)
 */
export async function readTelemetryHistory(slug, opts = {}) {
  const sb = getSupabase();
  if (!sb) return [];
  const sinceMs = opts.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
  const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 5000);
  const { data, error } = await sb
    .from("telemetry_history")
    .select("*")
    .eq("slug", slug)
    .gte("ts", new Date(sinceMs).toISOString())
    .order("ts", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[supabase] history read failed:", error.message);
    return [];
  }
  return data || [];
}
