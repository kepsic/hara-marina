/**
 * Guest-berth pricing.
 *
 * Resolves a nightly rate (in minor currency units, e.g. cents/sents) for a
 * given berth at a given date. Reads from a flat Redis blob `hara:pricing:v1`.
 *
 * Schema:
 *   {
 *     currency: "EUR",
 *     defaultNightCents: 4000,            // €40 / night
 *     perDockOverrides: { GUEST: 5000 },  // dock-level override
 *     perBerthOverrides: { "GUEST-1": 6000 }, // berth-level override
 *     seasonal: [
 *       { from: "2026-06-01", to: "2026-08-31", multiplier: 1.5 }, // high season
 *     ],
 *   }
 *
 * Anything missing falls back to a sensible default so the system always
 * returns a price (the wizard always shows an estimate).
 */

import { Redis } from "./redis.js";

const PRICING_KEY = "hara:pricing:v1";

const DEFAULTS = {
  currency: "EUR",
  defaultNightCents: 4000,
  perDockOverrides: {},
  perBerthOverrides: {},
  seasonal: [],
};

const redis = new Redis();

export async function getPricingConfig() {
  const raw = await redis.get(PRICING_KEY);
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  return {
    currency: typeof raw.currency === "string" ? raw.currency : DEFAULTS.currency,
    defaultNightCents: Number.isFinite(raw.defaultNightCents) ? raw.defaultNightCents : DEFAULTS.defaultNightCents,
    perDockOverrides: raw.perDockOverrides && typeof raw.perDockOverrides === "object" ? raw.perDockOverrides : {},
    perBerthOverrides: raw.perBerthOverrides && typeof raw.perBerthOverrides === "object" ? raw.perBerthOverrides : {},
    seasonal: Array.isArray(raw.seasonal) ? raw.seasonal : [],
  };
}

export async function setPricingConfig(next) {
  await redis.set(PRICING_KEY, next);
  return next;
}

function nightlyRateFor(berthId, dockId, cfg) {
  if (berthId && cfg.perBerthOverrides[berthId] != null) return Number(cfg.perBerthOverrides[berthId]);
  if (dockId && cfg.perDockOverrides[dockId] != null) return Number(cfg.perDockOverrides[dockId]);
  return Number(cfg.defaultNightCents);
}

function seasonalMultiplier(dateIso, cfg) {
  for (const rule of cfg.seasonal || []) {
    if (!rule?.from || !rule?.to) continue;
    if (dateIso >= rule.from && dateIso <= rule.to) {
      const m = Number(rule.multiplier);
      if (Number.isFinite(m) && m > 0) return m;
    }
  }
  return 1;
}

/**
 * Compute total price for a stay, accounting for per-night seasonal rules.
 * @param {string} berthId
 * @param {string} dockId
 * @param {string} arrival YYYY-MM-DD
 * @param {string} departure YYYY-MM-DD (exclusive)
 * @returns {Promise<{ totalCents:number, currency:string, nights:number, breakdown:Array<{date:string, cents:number}> }>}
 */
export async function quoteStay({ berthId, dockId, arrival, departure }) {
  const cfg = await getPricingConfig();
  const base = nightlyRateFor(berthId, dockId, cfg);
  const breakdown = [];
  const start = new Date(`${arrival}T12:00:00Z`);
  const end = new Date(`${departure}T12:00:00Z`);
  if (!(start < end)) {
    return { totalCents: 0, currency: cfg.currency, nights: 0, breakdown: [] };
  }
  let totalCents = 0;
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const cents = Math.round(base * seasonalMultiplier(iso, cfg));
    breakdown.push({ date: iso, cents });
    totalCents += cents;
  }
  return { totalCents, currency: cfg.currency, nights: breakdown.length, breakdown };
}

export function formatPrice(cents, currency = "EUR") {
  if (!Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat("en-EU", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
