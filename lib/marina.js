// Hara Sadam marina geo + AIS state classification.
//
// Coordinates are env-overridable so the same code works for sister marinas.
//   HARA_MARINA_LAT, HARA_MARINA_LON   - dock center
//   HARA_MARINA_BBOX                   - "minLat,minLon,maxLat,maxLon" (AIS subscribe bbox)

export const MARINA = {
  lat: Number(process.env.HARA_MARINA_LAT || 59.5881254),
  lon: Number(process.env.HARA_MARINA_LON || 25.6124356),
  name: "Hara Sadam",
};

// Wide-enough Baltic bbox so the boat is captured whether moored or cruising.
// AISStream requires a bbox; MMSI filter only narrows within it.
function parseBbox() {
  const raw = process.env.HARA_MARINA_BBOX;
  if (raw) {
    const p = raw.split(",").map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) {
      return [[p[2], p[1]], [p[0], p[3]]]; // [[maxLat,minLon],[minLat,maxLon]]
    }
  }
  // Default: Gulf of Finland + Estonian coast + N. Baltic.
  return [[60.5, 22.0], [57.5, 30.5]];
}
export const MARINA_BBOX = parseBbox();

// Thresholds (metres / knots).
export const MOORED_RADIUS_M    = Number(process.env.HARA_MOORED_RADIUS_M    || 200);
export const ANCHORED_RADIUS_M  = Number(process.env.HARA_ANCHORED_RADIUS_M  || 1500);
export const UNDERWAY_SOG_KN    = Number(process.env.HARA_UNDERWAY_SOG_KN    || 0.5);

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Classify a vessel position relative to Hara Sadam.
 *   pos: { lat, lon, sog }  (sog in knots)
 * Returns: { state, label, distanceM }
 *   state: "moored" | "anchored_nearby" | "underway" | "away"
 */
export function classifyMarinaState(pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) {
    return { state: "unknown", label: "Unknown", distanceM: null };
  }
  const distanceM = haversineMeters(MARINA.lat, MARINA.lon, pos.lat, pos.lon);
  const sog = Number.isFinite(pos.sog) ? pos.sog : 0;
  const stationary = sog < UNDERWAY_SOG_KN;

  if (stationary && distanceM <= MOORED_RADIUS_M) {
    return { state: "moored", label: "Moored at Hara Sadam", distanceM };
  }
  if (stationary && distanceM <= ANCHORED_RADIUS_M) {
    return { state: "anchored_nearby", label: "Anchored near Hara", distanceM };
  }
  if (!stationary) {
    return { state: "underway", label: "Underway", distanceM };
  }
  return { state: "away", label: "Away from marina", distanceM };
}
