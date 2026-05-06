/**
 * Stripe webhook. Verifies signature when STRIPE_WEBHOOK_SECRET is set,
 * otherwise logs and acks. Updates booking + power-token status on relevant events.
 */

import Stripe from "stripe";
import { updateBooking } from "../../../lib/bookings";

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
    if (event.type === "charge.refunded") {
      const ch = event.data.object;
      const bookingId = ch.metadata?.bookingId;
      if (bookingId) await updateBooking(bookingId, { paymentStatus: "refunded" });
    }
    if (event.type === "account.updated") {
      const acct = event.data.object;
      console.log("[stripe-webhook] account.updated", acct.id, "charges:", acct.charges_enabled, "payouts:", acct.payouts_enabled);
    }
  } catch (e) {
    console.error("[stripe-webhook] handler failed:", e?.message || e);
    return res.status(500).json({ error: "handler failed" });
  }

  return res.status(200).json({ received: true });
}
