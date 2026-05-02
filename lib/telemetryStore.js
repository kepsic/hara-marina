import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = (slug) => `telemetry:${slug}`;
const HISTORY_KEY = (slug) => `telemetry:${slug}:history`;
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const HISTORY_MAX = 240;              // last ~4h at 1/min

export async function putTelemetry(slug, payload) {
  const record = { ...payload, slug, ts: payload.ts || Date.now() };
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
  return typeof v === "string" ? JSON.parse(v) : v;
}

export async function getTelemetryHistory(slug, limit = 60) {
  const arr = await redis.lrange(HISTORY_KEY(slug), 0, limit - 1);
  return (arr || []).map((x) => (typeof x === "string" ? JSON.parse(x) : x));
}
