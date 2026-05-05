import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { isHarborMaster } from "../../../lib/owners";
import { getPricingConfig, setPricingConfig } from "../../../lib/pricing";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    // Harbor masters only — exposes platform-fee structure which is internal SaaS plumbing.
    const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!session?.email || !isHarborMaster(session.email)) {
      return res.status(403).json({ error: "harbor master role required" });
    }
    const cfg = await getPricingConfig();
    return res.status(200).json({ pricing: cfg });
  }

  if (req.method === "PUT") {
    const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!session?.email || !isHarborMaster(session.email)) {
      return res.status(403).json({ error: "harbor master role required" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Sanitise — store only known fields, coerce numerics, clamp ranges.
    const current = await getPricingConfig();
    const next = {
      currency: typeof body.currency === "string" && body.currency.length === 3
        ? body.currency.toUpperCase()
        : current.currency,
      defaultNightCents: clampInt(body.defaultNightCents, 0, 1_000_000, current.defaultNightCents),
      perDockOverrides: sanitiseOverrides(body.perDockOverrides, current.perDockOverrides),
      perBerthOverrides: sanitiseOverrides(body.perBerthOverrides, current.perBerthOverrides),
      seasonal: sanitiseSeasonal(body.seasonal, current.seasonal),
      platformFeePercent: clampNum(body.platformFeePercent, 0, 100, current.platformFeePercent),
      platformFeeFixedCents: clampInt(body.platformFeeFixedCents, 0, 100_000, current.platformFeeFixedCents),
    };
    await setPricingConfig(next);
    return res.status(200).json({ pricing: next });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).end();
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitiseOverrides(input, fallback) {
  if (!input || typeof input !== "object") return fallback;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof k !== "string" || !k) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) out[k] = Math.round(n);
  }
  return out;
}

function sanitiseSeasonal(input, fallback) {
  if (!Array.isArray(input)) return fallback;
  const out = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const from = typeof r.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.from) ? r.from : null;
    const to = typeof r.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.to) ? r.to : null;
    const m = Number(r.multiplier);
    if (!from || !to || !Number.isFinite(m) || m <= 0 || m > 10) continue;
    out.push({ from, to, multiplier: m });
  }
  return out;
}
