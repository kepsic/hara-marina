// Public per-boat telemetry summary for landing-page badges.
// No auth required — only non-sensitive status fields are exposed
// (battery level, shore power, bilge alert, online status).
//
// Response: {
//   badges: {
//     [slug]: {
//       online: boolean,          // seen within 10 min
//       battery_pct: number|null,
//       shore_power: boolean|null,
//       bilge_cm: number|null,
//       wind_dir_deg: number|null, // true wind direction (bearing FROM, 0-360)
//       wind_speed_kn: number|null,
//     }
//   },
//   ts: number,
// }

import { getTelemetry } from "../../lib/telemetryStore";

const BOAT_SLUGS = [
  "devocean",
  "lindre",
  "helmsman",
  "taevasina",
  "o2",
  "albertina",
  "vaiana",
  "amante",
  "julia",
  "cibelle",
  "cirrus",
  "moi",
];

const ONLINE_THRESHOLD_MS = 10 * 60 * 1000;  // 10 minutes
const STALE_THRESHOLD_MS  = 60 * 60 * 1000;  // 1 hour — don't show stale data at all

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  const now = Date.now();
  const badges = {};

  await Promise.allSettled(
    BOAT_SLUGS.map(async (slug) => {
      try {
        const t = await getTelemetry(slug);
        if (!t) return;
        const age = now - (t.ts || 0);
        if (age > STALE_THRESHOLD_MS) return; // don't surface ancient data

        badges[slug] = {
          online:        age < ONLINE_THRESHOLD_MS,
          battery_pct:   typeof t.battery?.percent === "number"      ? t.battery.percent            : null,
          shore_power:   typeof t.shore_power === "boolean"          ? t.shore_power                : null,
          bilge_cm:      typeof t.bilge?.water_cm === "number"       ? t.bilge.water_cm             : null,
          wind_dir_deg:  typeof t.wind?.true?.direction_deg === "number" ? t.wind.true.direction_deg : null,
          wind_speed_kn: typeof t.wind?.true?.speed_kn === "number"  ? t.wind.true.speed_kn         : null,
        };
      } catch {
        // Skip individual failures silently.
      }
    })
  );

  return res.status(200).json({ badges, ts: now });
}
