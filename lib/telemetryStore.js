import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = (slug) => `telemetry:${slug}`;
const HISTORY_KEY = (slug) => `telemetry:${slug}:history`;
const ENERGY_KEY = (slug) => `telemetry:${slug}:energy_rollup`;
const TTL_SECONDS = 60 * 60 * 2; // 2 hours — stale data older than the API threshold isn't useful
const HISTORY_MAX = 240;              // last ~4h at 1/min

function periodKeys(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return {
    day: `${y}-${m}-${day}`,
    month: `${y}-${m}`,
    year: String(y),
  };
}

async function updateEnergyRollups(slug, ts, totalKwh) {
  if (!Number.isFinite(totalKwh)) return;
  const keys = periodKeys(ts);
  const existing = await redis.hgetall(ENERGY_KEY(slug));
  const current = existing || {};
  const patch = {
    total_kwh: String(totalKwh),
    total_ts: String(ts),
  };
  if (current.day_key !== keys.day) {
    patch.day_key = keys.day;
    patch.day_start_kwh = String(totalKwh);
  }
  if (current.month_key !== keys.month) {
    patch.month_key = keys.month;
    patch.month_start_kwh = String(totalKwh);
  }
  if (current.year_key !== keys.year) {
    patch.year_key = keys.year;
    patch.year_start_kwh = String(totalKwh);
  }
  await Promise.all([
    redis.hset(ENERGY_KEY(slug), patch),
    redis.expire(ENERGY_KEY(slug), TTL_SECONDS),
  ]);
}

async function applyEnergyRollups(slug, record) {
  if (!record?.ac || !Number.isFinite(Number(record.ac.energy_kwh_total))) return record;
  const total = Number(record.ac.energy_kwh_total);
  const rollup = (await redis.hgetall(ENERGY_KEY(slug))) || {};
  const d0 = Number(rollup.day_start_kwh);
  const m0 = Number(rollup.month_start_kwh);
  const y0 = Number(rollup.year_start_kwh);
  const safeDelta = (base) => (Number.isFinite(base) ? Math.max(0, total - base) : 0);
  return {
    ...record,
    ac: {
      ...record.ac,
      energy_kwh_day: safeDelta(d0),
      energy_kwh_month: safeDelta(m0),
      energy_kwh_year: safeDelta(y0),
    },
  };
}

export async function putTelemetry(slug, payload) {
  const record = { ...payload, slug, ts: payload.ts || Date.now() };
  const totalKwh = Number(record?.ac?.energy_kwh_total);
  if (Number.isFinite(totalKwh)) {
    await updateEnergyRollups(slug, record.ts, totalKwh);
  }
  const json = JSON.stringify(record);
  await Promise.all([
    redis.set(KEY(slug), json, { ex: TTL_SECONDS }),
    redis.lpush(HISTORY_KEY(slug), json),
    redis.ltrim(HISTORY_KEY(slug), 0, HISTORY_MAX - 1),
    redis.expire(HISTORY_KEY(slug), TTL_SECONDS),
  ]);
  return record;
}

export async function getTelemetry(slug) {
  const v = await redis.get(KEY(slug));
  if (!v) return null;
  // Upstash auto-deserialises JSON-strings here (returns object). Handle both.
  const rec = typeof v === "string" ? JSON.parse(v) : v;
  return await applyEnergyRollups(slug, rec);
}

export async function getTelemetryHistory(slug, limit = 60) {
  const arr = await redis.lrange(HISTORY_KEY(slug), 0, limit - 1);
  return (arr || []).map((x) => (typeof x === "string" ? JSON.parse(x) : x));
}
