// Public aggregated marina conditions derived from boat telemetry.
// Returns wind and sea temperature observed by boats moored in Hara Bay.
// No auth required — individual boat identities are not exposed.
//
// Response: {
//   wind: { direction_deg, speed_kn, gust_kn, sample_count, source } | null,
//   water_temp_c: number | null,
//   ts: number,     // ms since epoch of newest sample used
// }

import { getTelemetry } from "../../lib/telemetryStore";

// All known boat slugs derived from INITIAL_BOATS in lib/constants.js.
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

// Maximum age of telemetry to include in the aggregate.
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Circular (vector) mean of wind directions.
// Each sample is weighted by its wind speed so that calmer readings
// don't drag the direction.
function circularMeanDir(samples) {
  // samples: [{ dir_deg, weight }]
  let sx = 0, sy = 0;
  for (const { dir_deg, weight } of samples) {
    const r = dir_deg * (Math.PI / 180);
    sx += Math.cos(r) * weight;
    sy += Math.sin(r) * weight;
  }
  if (sx === 0 && sy === 0) return null;
  const deg = Math.atan2(sy, sx) * (180 / Math.PI);
  return (deg + 360) % 360;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  const now = Date.now();
  const windSamples = [];   // { dir_deg, speed_kn, weight }
  const seaTemps   = [];   // number
  let newestTs = 0;

  await Promise.allSettled(
    BOAT_SLUGS.map(async (slug) => {
      try {
        const t = await getTelemetry(slug);
        if (!t) return;
        const age = now - (t.ts || 0);
        if (age > MAX_AGE_MS) return;

        if (t.ts > newestTs) newestTs = t.ts;

        // Wind: prefer wind.true.direction_deg; fall back to wind.apparent (converted via heading is too complex without heading, skip).
        const dir = t.wind?.true?.direction_deg;
        const spd = t.wind?.true?.speed_kn;
        if (typeof dir === "number" && !isNaN(dir)) {
          windSamples.push({
            dir_deg: dir,
            speed_kn: typeof spd === "number" ? spd : 0,
            weight: typeof spd === "number" ? Math.max(0.1, spd) : 0.1,
          });
        }

        // Sea temperature.
        if (typeof t.water_temp_c === "number" && !isNaN(t.water_temp_c)) {
          seaTemps.push(t.water_temp_c);
        }
      } catch {
        // Ignore individual boat failures.
      }
    })
  );

  const wind = windSamples.length > 0 ? (() => {
    const dir_deg = circularMeanDir(windSamples.map(s => ({ dir_deg: s.dir_deg, weight: s.weight })));
    const speed_kn = windSamples.reduce((s, x) => s + x.speed_kn, 0) / windSamples.length;
    return {
      direction_deg: dir_deg !== null ? +dir_deg.toFixed(1) : null,
      speed_ms: +(speed_kn * 0.5144).toFixed(1),   // knots → m/s
      speed_kn: +speed_kn.toFixed(1),
      sample_count: windSamples.length,
      source: "marina-boats",
    };
  })() : null;

  const water_temp_c = seaTemps.length > 0
    ? +(seaTemps.reduce((s, v) => s + v, 0) / seaTemps.length).toFixed(1)
    : null;

  return res.status(200).json({
    wind,
    water_temp_c,
    sample_count: { wind: windSamples.length, sea_temp: seaTemps.length },
    ts: newestTs || now,
  });
}
