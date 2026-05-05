// Maps the dotted scenario "field" (as stored in /api/relays/<slug>/scenarios
// and used by marina-bridge) to the flat snake_case column name used by the
// `telemetry_history` table and the chart's metric.key. Keep in sync with
// COLUMNS in lib/supabase.js and FIELDS in pages/[slug].jsx ScenarioEditor.

export const SCENARIO_FIELD_TO_COLUMN = {
  "cabin.humidity_pct":   "cabin_humid",
  "cabin.temperature_c":  "cabin_temp_c",
  "dewpoint_c":           "dewpoint_c",
  "battery.voltage":      "battery_v",
  "battery.percent":      "battery_pct",
  "water_depth_m":        "water_depth_m",
  "water_temp_c":         "water_temp_c",
  "bilge.water_cm":       "bilge_water_cm",
  "ac.power_w":           "ac_power_w",
  "ac.voltage_v":         "ac_voltage_v",
};

export function scenarioColumn(field) {
  return SCENARIO_FIELD_TO_COLUMN[field] || null;
}
