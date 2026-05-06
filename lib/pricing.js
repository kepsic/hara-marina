/**
 * Guest-berth pricing.
 *
 * Resolves a nightly rate (in minor currency units, e.g. cents/sents) for a
 * given berth at a given date. Reads from a flat Redis blob `hara:pricing:v1`.
 *
 * Schema:
 *   {
 *     currency: "EUR",
 *     // Length-of-overall (LOA) tiers — picked when boat dimensions are
 *     // known. The last tier may use maxLoaM:null meaning "and above".
 *     // Mirrors harasadam.ee published pricing (≤10 m €30, 10–12 m €40,
 *     // 12+ m €50). Empty array disables tier pricing.
 *     loaTiers: [
 *       { maxLoaM: 10, nightCents: 3000 },
 *       { maxLoaM: 12, nightCents: 4000 },
 *       { maxLoaM: null, nightCents: 5000 },
 *     ],
 *     defaultNightCents: 4000,            // fallback when LOA unknown / no tier matches
 *     perDockOverrides: { GUEST: 5000 },  // dock-level override (wins over tiers)
 *     perBerthOverrides: { "GUEST-1": 6000 }, // berth-level override (wins over dock)
 *     seasonal: [
 *       { from: "2026-06-01", to: "2026-08-31", multiplier: 1.5 }, // high season
 *     ],
 *     // Informational extras shown in the welcome email — not part of the
 *     // nightly stay quote (different products with different state machines):
 *     shortStayCents: 1500,   // up to 5 h
 *     slipCents: 1000,        // single slip use
 *     // Stripe Connect platform fee (deducted from each booking, paid to the
 *     // SaaS owner; the rest goes to the marina's connected account):
 *     platformFeePercent: 5,         // 5% of total
 *     platformFeeFixedCents: 50,     // + €0.50 flat per booking (covers Stripe per-tx)
 *   }
 *
 * Anything missing falls back to a sensible default so the system always
 * returns a price (the wizard always shows an estimate).
 */

import { Redis } from "./redis.js";
import { keys } from "./redis-keys.js";

const DEFAULT_SLUG = process.env.DEFAULT_MARINA_SLUG || "hara";
const pricingKey = (slug) => keys.pricing(slug || DEFAULT_SLUG);

const DEFAULTS = {
  currency: "EUR",
  loaTiers: [
    { maxLoaM: 10, nightCents: 3000 },
    { maxLoaM: 12, nightCents: 4000 },
    { maxLoaM: null, nightCents: 5000 },
  ],
  defaultNightCents: 4000,
  perDockOverrides: {},
  perBerthOverrides: {},
  seasonal: [],
  shortStayCents: 1500,
  slipCents: 1000,
  // Defaults sized to roughly cover Vercel + Resend + Redis + Stripe fees on a
  // small marina volume. Edit hara:pricing:v1 to tune per deployment.
  platformFeePercent: 5,
  platformFeeFixedCents: 50,
};

const redis = new Redis();

export async function getPricingConfig(marinaSlug) {
  const raw = await redis.get(pricingKey(marinaSlug));
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  return {
    currency: typeof raw.currency === "string" ? raw.currency : DEFAULTS.currency,
    loaTiers: Array.isArray(raw.loaTiers) ? raw.loaTiers : DEFAULTS.loaTiers,
    defaultNightCents: Number.isFinite(raw.defaultNightCents) ? raw.defaultNightCents : DEFAULTS.defaultNightCents,
    perDockOverrides: raw.perDockOverrides && typeof raw.perDockOverrides === "object" ? raw.perDockOverrides : {},
    perBerthOverrides: raw.perBerthOverrides && typeof raw.perBerthOverrides === "object" ? raw.perBerthOverrides : {},
    seasonal: Array.isArray(raw.seasonal) ? raw.seasonal : [],
    shortStayCents: Number.isFinite(raw.shortStayCents) ? raw.shortStayCents : DEFAULTS.shortStayCents,
    slipCents: Number.isFinite(raw.slipCents) ? raw.slipCents : DEFAULTS.slipCents,
    platformFeePercent: Number.isFinite(raw.platformFeePercent) ? raw.platformFeePercent : DEFAULTS.platformFeePercent,
    platformFeeFixedCents: Number.isFinite(raw.platformFeeFixedCents) ? raw.platformFeeFixedCents : DEFAULTS.platformFeeFixedCents,
  };
}

export async function setPricingConfig(next, marinaSlug) {
  await redis.set(pricingKey(marinaSlug), next);
  return next;
}

function tierFor(loaM, cfg) {
  const tiers = Array.isArray(cfg.loaTiers) ? cfg.loaTiers : [];
  if (!tiers.length || !Number.isFinite(loaM)) return null;
  // Tiers are interpreted as ascending maxLoaM; null means "and above".
  // Find first tier whose maxLoaM is >= loaM (or null).
  const sorted = [...tiers].sort((a, b) => {
    const am = a.maxLoaM == null ? Infinity : Number(a.maxLoaM);
    const bm = b.maxLoaM == null ? Infinity : Number(b.maxLoaM);
    return am - bm;
  });
  for (const t of sorted) {
    const m = t.maxLoaM == null ? Infinity : Number(t.maxLoaM);
    if (loaM <= m) return Number(t.nightCents);
  }
  return null;
}

function nightlyRateFor(berthId, dockId, loaM, cfg) {
  if (berthId && cfg.perBerthOverrides[berthId] != null) return Number(cfg.perBerthOverrides[berthId]);
  if (dockId && cfg.perDockOverrides[dockId] != null) return Number(cfg.perDockOverrides[dockId]);
  const tier = tierFor(Number(loaM), cfg);
  if (tier != null) return tier;
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
export async function quoteStay({ berthId, dockId, arrival, departure, loaM, marinaSlug }) {
  const cfg = await getPricingConfig(marinaSlug);
  const base = nightlyRateFor(berthId, dockId, loaM, cfg);
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
  return {
    totalCents,
    currency: cfg.currency,
    nights: breakdown.length,
    breakdown,
    nightlyCents: base,
    loaM: Number.isFinite(Number(loaM)) ? Number(loaM) : null,
  };
}

/**
 * Compute the SaaS platform fee (Stripe `application_fee_amount`) for a given
 * booking total. Used by the payment-intent endpoint and any preview UI.
 * Returns whole cents, never negative, never exceeds the booking total.
 */
export function computePlatformFee(totalCents, cfg) {
  if (!Number.isFinite(totalCents) || totalCents <= 0) return 0;
  const pct = Number.isFinite(cfg?.platformFeePercent) ? cfg.platformFeePercent : DEFAULTS.platformFeePercent;
  const fixed = Number.isFinite(cfg?.platformFeeFixedCents) ? cfg.platformFeeFixedCents : DEFAULTS.platformFeeFixedCents;
  const fee = Math.round(totalCents * (pct / 100)) + fixed;
  return Math.max(0, Math.min(totalCents, fee));
}

export function formatPrice(cents, currency = "EUR") {
  if (!Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat("en-EU", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
