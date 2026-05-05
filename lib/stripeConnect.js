/**
 * Stripe Connect — marina account registry.
 *
 * Maps a marina slug → its connected Stripe account id (`acct_...`). We store
 * this in Redis (rather than env) because new marinas may onboard at runtime
 * via Stripe Express/Standard onboarding without redeploying.
 *
 * Key:   hara:stripe-connect:v1
 * Shape: { default: "acct_xxx", "vaiana": "acct_yyy", ... }
 *
 * The "default" entry is used for single-marina deployments and as a fallback
 * for bookings created without a marina slug.
 */

import { Redis } from "./redis.js";

const KEY = "hara:stripe-connect:v1";
const redis = new Redis();

export async function getConnectAccountForMarina(marinaSlug) {
  const map = (await redis.get(KEY)) || {};
  if (marinaSlug && typeof map[marinaSlug] === "string") return map[marinaSlug];
  if (typeof map.default === "string") return map.default;
  return null;
}

export async function setConnectAccountForMarina(marinaSlug, accountId) {
  const map = (await redis.get(KEY)) || {};
  if (marinaSlug) map[marinaSlug] = accountId;
  else map.default = accountId;
  await redis.set(KEY, map);
  return map;
}

export async function listConnectAccounts() {
  return (await redis.get(KEY)) || {};
}
