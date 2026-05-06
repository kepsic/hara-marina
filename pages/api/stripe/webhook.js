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
/**
 * Stripe webhook stub. Verifies signature when STRIPE_WEBHOOK_SECRET is set,
 * otherwise just logs. No booking mutations until payments are enabled.
 *
 * To wire up:
 *   1) npm i stripe
 *   2) export STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_ENABLED=true
 *   3) uncomment the body below
 */

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body to verify the signature.
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  // ---- Real implementation (kept inert until the env vars are set) ----
  // import Stripe from "stripe";
  // import { updateBooking } from "../../../lib/bookings";
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  // const sig = req.headers["stripe-signature"];
  // const chunks = [];
  // for await (const c of req) chunks.push(c);
  // const raw = Buffer.concat(chunks);
  // let event;
  // try {
  //   event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  // } catch (err) {
  //   return res.status(400).send(`Webhook Error: ${err.message}`);
  // }
  // // Platform-level events
  // if (event.type === "payment_intent.succeeded") {
  //   const intent = event.data.object;
  //   const bookingId = intent.metadata?.bookingId;
  //   if (bookingId) {
  //     await updateBooking(bookingId, { paymentStatus: "paid", status: "confirmed" });
  //   }
  // }
  // if (event.type === "charge.refunded") {
  //   const ch = event.data.object;
  //   const bookingId = ch.metadata?.bookingId;
  //   if (bookingId) await updateBooking(bookingId, { paymentStatus: "refunded" });
  // }
  //
  // // Connect-account events (configure a SECOND webhook endpoint of type
  // // "Connect" in the Stripe dashboard pointing at this same URL — Stripe will
  // // include `account` on the event so you can correlate it back to a marina):
  // if (event.type === "account.updated") {
  //   const acct = event.data.object;   // acct.id, acct.charges_enabled, acct.payouts_enabled
  //   // optional: refresh your hara:stripe-connect:v1 cache or notify the marina
  // }

  console.log("[stripe-webhook] stub received an event (not enabled)");
  return res.status(200).json({ received: true, note: "stub" });
}
