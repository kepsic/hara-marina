/**
 * Shared Redis client backed by ioredis (Railway self-hosted Redis).
 *
 * Drop-in replacement for @upstash/redis: exposes the same methods used
 * across the codebase (get, set, hgetall, hset, expire, lpush, lrange,
 * ltrim) with identical JSON-auto-parse semantics.
 *
 * Configure via env:
 *   REDIS_URL  e.g. redis://:password@host:6379  (Railway injects this)
 */

import IORedis from "ioredis";

let _client = null;

function getClient() {
  if (!_client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL env var is required");
    _client = new IORedis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    _client.on("error", (err) => {
      // Surface errors but don't crash — individual commands will reject.
      console.error("[redis] connection error:", err.message);
    });
  }
  return _client;
}

// Attempt JSON.parse; return raw string on failure.
function tryParse(v) {
  if (v === null || v === undefined) return null;
  try { return JSON.parse(v); } catch { return v; }
}

// Upstash auto-serialises objects on set; we do the same.
function serialise(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * Redis client with the same interface as @upstash/redis used in this project.
 */
export class Redis {
  constructor() {
    // No-op constructor — client is a singleton managed above.
    // This matches the `new Redis({ url, token })` call pattern; args ignored.
  }

  get client() { return getClient(); }

  /** GET key → parsed value or null */
  async get(key) {
    const v = await this.client.get(key);
    return tryParse(v);
  }

  /**
   * SET key value [EX seconds]
   * opts: { ex: number }  (seconds TTL, matching Upstash signature)
   */
  async set(key, value, opts) {
    const str = serialise(value);
    if (opts?.ex) {
      return this.client.set(key, str, "EX", opts.ex);
    }
    return this.client.set(key, str);
  }

  /** DEL key */
  async del(key) {
    return this.client.del(key);
  }

  /** EXPIRE key seconds */
  async expire(key, seconds) {
    return this.client.expire(key, seconds);
  }

  /** HGETALL key → object or null */
  async hgetall(key) {
    const v = await this.client.hgetall(key);
    // ioredis returns {} for missing key; return null to match Upstash.
    if (!v || Object.keys(v).length === 0) return null;
    // Values are raw strings — parse each one.
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = tryParse(val);
    return out;
  }

  /**
   * HSET key field value [field value ...]
   * Accepts an object of field→value pairs (matching Upstash signature).
   */
  async hset(key, fields) {
    const args = [];
    for (const [k, v] of Object.entries(fields)) {
      args.push(k, serialise(v));
    }
    return this.client.hset(key, ...args);
  }

  /** LPUSH key value */
  async lpush(key, value) {
    return this.client.lpush(key, serialise(value));
  }

  /** LRANGE key start stop → array of parsed values */
  async lrange(key, start, stop) {
    const arr = await this.client.lrange(key, start, stop);
    return (arr || []).map(tryParse);
  }

  /** LTRIM key start stop */
  async ltrim(key, start, stop) {
    return this.client.ltrim(key, start, stop);
  }
}
