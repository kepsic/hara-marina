/**
 * Cron-driven affiliate payout.
 *   GET /api/affiliates/payout
 * Authenticated via Vercel cron secret (CRON_SECRET) or super-admin session.
 *
 * Wrapped in idempotency: each batch of referral_events is paid in a
 * single Stripe transfer keyed on stripe-idempotency-key derived from
 * the event ids, so re-running a cron won't double-pay.
 */
import Stripe from "stripe";
import { createHash } from "crypto";
import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { isSuperAdmin } from "../../../lib/owners";
import { planPendingPayouts, markPayoutComplete } from "../../../lib/referrals";

export default async function handler(req, res) {
  // Auth: cron secret OR super-admin session.
  const cronAuth = req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;
  let isSA = false;
  if (!cronAuth) {
    const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    isSA = !!(session?.email && isSuperAdmin(session.email));
  }
  if (!cronAuth && !isSA) return res.status(401).json({ error: "unauthorized" });

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return res.status(503).json({ error: "stripe not configured" });
  const stripe = new Stripe(secret);

  const batches = await planPendingPayouts();
  const results = [];
  for (const batch of batches) {
    const idempotencyKey = "mervare-payout-" +
      createHash("sha256").update(batch.events.sort().join(",")).digest("hex").slice(0, 32);
    try {
      const transfer = await stripe.transfers.create({
        amount: batch.total,
        currency: "eur",
        destination: batch.stripeAccountId,
        description: `MerVare affiliate payout — ${batch.events.length} events`,
      }, { idempotencyKey });
      await markPayoutComplete(batch.events, transfer.id);
      results.push({ email: batch.email, total: batch.total, transferId: transfer.id });
    } catch (e) {
      console.error("[affiliate-payout] transfer failed for", batch.email, e?.message || e);
      results.push({ email: batch.email, error: e?.message || "transfer failed" });
    }
  }
  return res.json({ ok: true, payouts: results });
}
