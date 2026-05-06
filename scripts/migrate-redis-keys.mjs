#!/usr/bin/env node
/**
 * Redis key migration helper for the multi-tenant transition.
 *
 * Background
 * ----------
 * In single-tenant Hara Marina, three top-level Redis blobs were used:
 *   hara:bookings:v1
 *   hara:pricing:v1
 *   hara:marina-layout:v1
 *
 * In MerVare multi-tenant, keys are namespaced by marina slug via
 * lib/redis-keys.js. The helper preserves the legacy `hara:*` prefix when
 * slug === "hara" (or the configured DEFAULT_MARINA_SLUG), so the existing
 * Hara Marina deployment continues to read/write the same keys with no
 * data migration required.
 *
 * What this script does
 * ---------------------
 * For Hara: nothing. The existing keys are already in the right place.
 *
 * For a new marina (e.g. slug="alpha"):
 *   - This script is a no-op too: new marinas start with empty data and
 *     write to alpha:bookings:v1 / alpha:pricing:v1 / alpha:marina-layout:v1
 *     on first use.
 *
 * If you ever need to clone Hara's data into a new tenant for testing:
 *   COPY_FROM=hara COPY_TO=demo node scripts/migrate-redis-keys.mjs
 */

import { Redis } from "../lib/redis.js";
import { keys } from "../lib/redis-keys.js";

const from = process.env.COPY_FROM;
const to = process.env.COPY_TO;

const redis = new Redis();

async function main() {
  if (!from || !to) {
    console.log("No-op: set COPY_FROM and COPY_TO to clone a marina's blobs.");
    console.log("Example: COPY_FROM=hara COPY_TO=demo node scripts/migrate-redis-keys.mjs");
    return;
  }
  if (from === to) {
    console.error("COPY_FROM and COPY_TO must differ");
    process.exit(1);
  }

  const pairs = [
    ["bookings", keys.bookings(from), keys.bookings(to)],
    ["pricing", keys.pricing(from), keys.pricing(to)],
    ["marina-layout", keys.marinaLayout(from), keys.marinaLayout(to)],
  ];

  for (const [label, src, dst] of pairs) {
    const value = await redis.get(src);
    if (value === null || value === undefined) {
      console.log(`${label}: source ${src} empty, skipping`);
      continue;
    }
    await redis.set(dst, value);
    console.log(`${label}: copied ${src} → ${dst}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
