/**
 * One-shot migration: Upstash → Railway Redis
 *
 * Copies all persistent keys. Skips bare telemetry snapshots
 * (telemetry:{slug} without suffix) since they're ephemeral.
 *
 * Run after Upstash daily limit resets (midnight UTC):
 *   node scripts/migrate-redis.mjs
 *
 * Requires env:
 *   UPSTASH_REDIS_URL  - rediss://default:<token>@allowing-filly-111671.upstash.io:6379
 *   REDIS_URL          - railway redis url (already in .env.local)
 */

import IORedis from "ioredis";
import { config } from "dotenv";

config({ path: ".env.local" });

const UPSTASH_URL =
  process.env.UPSTASH_REDIS_URL ||
  `rediss://default:gQAAAAAAAbQ3AAIgcDI0NTkxZmE1MzUwZjc0NjQ0YmQyY2Q0ZWVlNDhjYjQyOQ@allowing-filly-111671.upstash.io:6379`;

const RAILWAY_URL = process.env.REDIS_URL;

if (!RAILWAY_URL) {
  console.error("REDIS_URL not set");
  process.exit(1);
}

// Keys matching this exact pattern are ephemeral snapshots — skip them.
// We DO keep: telemetry:*:history, telemetry:*:energy_rollup
function isEphemeral(key) {
  return /^telemetry:[^:]+$/.test(key);
}

const src = new IORedis(UPSTASH_URL, { tls: {}, lazyConnect: true, maxRetriesPerRequest: 1 });
const dst = new IORedis(RAILWAY_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

await src.connect();
await dst.connect();
console.log("Connected to both instances.");

// Scan all keys
let cursor = "0";
const keys = [];
do {
  const [next, batch] = await src.scan(cursor, "COUNT", 100);
  cursor = next;
  keys.push(...batch);
} while (cursor !== "0");

console.log(`Found ${keys.length} keys in Upstash.`);

let copied = 0, skipped = 0, errors = 0;

for (const key of keys) {
  if (isEphemeral(key)) {
    skipped++;
    continue;
  }

  try {
    const type = await src.type(key);
    const ttl = await src.ttl(key);          // -1 = no TTL, -2 = expired
    const ex = ttl > 0 ? ttl : undefined;

    if (type === "string") {
      const val = await src.get(key);
      if (ex) await dst.set(key, val, "EX", ex);
      else     await dst.set(key, val);

    } else if (type === "list") {
      const items = await src.lrange(key, 0, -1);
      const pipeline = dst.pipeline();
      pipeline.del(key);
      for (const item of items) pipeline.rpush(key, item);
      if (ex) pipeline.expire(key, ex);
      await pipeline.exec();

    } else if (type === "hash") {
      const hash = await src.hgetall(key);
      await dst.hset(key, hash);
      if (ex) await dst.expire(key, ex);

    } else if (type === "set") {
      const members = await src.smembers(key);
      await dst.sadd(key, ...members);
      if (ex) await dst.expire(key, ex);
    } else {
      console.warn(`  skip ${key} (unsupported type: ${type})`);
      skipped++;
      continue;
    }

    console.log(`  ✓ ${type.padEnd(6)} ${key}${ex ? ` (TTL ${ex}s)` : ""}`);
    copied++;
  } catch (err) {
    console.error(`  ✗ ${key}: ${err.message}`);
    errors++;
  }
}

await src.quit();
await dst.quit();

console.log(`\nDone. Copied: ${copied}  Skipped: ${skipped}  Errors: ${errors}`);
