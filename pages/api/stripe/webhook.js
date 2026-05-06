/**
 * Stripe webhook. Verifies signature when STRIPE_WEBHOOK_SECRET is set,
 * otherwise logs and acks. Updates booking + power-token status on relevant events.
 */

import Stripe from "stripe";
import { updateBooking } from "../../../lib/bookings";
import { Redis } from "../../../lib/redis";
import { keys } from "../../../lib/redis-keys";
import { getSupabase } from "../../../lib/supabase";

const redis = new Redis();

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body to verify the signature.
};

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whSecret) {
    console.log("[stripe-webhook] not configured (missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET)");
    return res.status(200).json({ received: true, note: "stub" });
  }

  const stripe = new Stripe(secret);
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: Stripe retries webhooks aggressively (>24h on failure).
  // Drop duplicates so we don't double-confirm bookings or double-activate
  // power tokens. Redis SETNX keeps the check atomic across replicas.
  const dedupKey = keys.stripeEvent(event.id);
  try {
    const seen = await redis.get(dedupKey);
    if (seen) {
      return res.status(200).json({ received: true, deduplicated: true });
    }
    await redis.set(dedupKey, "1", { ex: 86400 });
  } catch (e) {
    console.error("[stripe-webhook] dedup failed (continuing):", e?.message || e);
  }

  // NOTE: Stripe Connect requires TWO webhook endpoints in the dashboard
  // pointing at this same URL: a regular Account endpoint (booking +
  // subscription events) and a Connect endpoint (account.updated etc.).
  try {
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const bookingId = intent.metadata?.bookingId;
      if (bookingId) {
        await updateBooking(bookingId, { paymentStatus: "paid", status: "confirmed" });
      }
      const powerTokenId = intent.metadata?.powerTokenId;
      if (powerTokenId) {
        const { activatePowerToken } = await import("../../../lib/power");
        await activatePowerToken(powerTokenId, intent.id).catch((e) =>
          console.error("[stripe-webhook] power token activate failed:", e?.message || e)
        );
      }
    }
    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      const bookingId = intent.metadata?.bookingId;
      if (bookingId) {
        await updateBooking(bookingId, { paymentStatus: "failed" }).catch(() => null);
      }
    }
    if (event.type === "charge.refunded") {
      const ch = event.data.object;
      const bookingId = ch.metadata?.bookingId;
      if (bookingId) await updateBooking(bookingId, { paymentStatus: "refunded" });
    }
    if (event.type === "account.updated") {
      const acct = event.data.object;
      console.log("[stripe-webhook] account.updated", acct.id, "charges:", acct.charges_enabled, "payouts:", acct.payouts_enabled);
    }
    // MerVare SaaS subscription lifecycle (marina pays MerVare).
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const sb = getSupabase();
      if (sb && sub.customer) {
        await sb.from("marinas")
          .update({ stripe_subscription_id: sub.id, plan: sub.status === "active" ? "marina" : "free" })
          .eq("stripe_customer_id", sub.customer)
          .then(() => null, (e) => console.error("[stripe-webhook] sub upsert:", e?.message || e));
      }
    }
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const sb = getSupabase();
      if (sb && sub.customer) {
        // Downgrade to free plan when subscription cancels.
        await sb.from("marinas")
          .update({ plan: "free", stripe_subscription_id: null })
          .eq("stripe_customer_id", sub.customer)
          .then(() => null, () => null);
      }
    }
    if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      console.log("[stripe-webhook]", event.type, "invoice:", inv.id, "customer:", inv.customer);
    }
  } catch (e) {
    console.error("[stripe-webhook] handler failed:", e?.message || e);
    return res.status(500).json({ error: "handler failed" });
  }

  return res.status(200).json({ received: true });
}
