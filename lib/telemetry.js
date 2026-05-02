// Deterministic pseudo-telemetry derived from boat id, refreshed every minute.
// Replace with real sensor data when available.

function hash(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function rng(seed) {
  let s = hash(seed) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s % 1_000_000) / 1_000_000;
  };
}

export function makeTelemetry(boat, now = Date.now()) {
  // Bucket per minute so values feel "live" but stable for the tick
  const minute = Math.floor(now / 60000);
  const r = rng(`${boat.id}-${minute}`);
  const drift = rng(`${boat.id}-day-${Math.floor(now / 86400000)}`);

  // Hara Bay approximate centre
  const lat = 59.5740 + (drift() - 0.5) * 0.0006;
  const lon = 25.7430 + (drift() - 0.5) * 0.0010;

  const battery_v = +(12.4 + drift() * 0.6 + r() * 0.1).toFixed(2);
  const battery_pct = Math.round(((battery_v - 11.8) / (13.0 - 11.8)) * 100);
  const bilge_cm = +(r() * 6).toFixed(1);
  const bilge_pump_24h = Math.floor(drift() * 5);
  const interior_c = +(8 + drift() * 14 + r() * 0.5).toFixed(1);
  const cabin_humidity = Math.round(55 + drift() * 25);
  const shore_power = drift() > 0.25;
  const heel_deg = +((r() - 0.5) * 4).toFixed(1);
  const last_seen_ago = Math.floor(r() * 240); // seconds

  return {
    boat_id: boat.id,
    boat_name: boat.name,
    timestamp: now,
    last_seen_ago,
    position: { lat: +lat.toFixed(5), lon: +lon.toFixed(5) },
    battery: { voltage: battery_v, percent: Math.max(0, Math.min(100, battery_pct)) },
    bilge: { water_cm: bilge_cm, pump_cycles_24h: bilge_pump_24h },
    cabin: { temperature_c: interior_c, humidity_pct: cabin_humidity },
    shore_power,
    heel_deg,
  };
}
