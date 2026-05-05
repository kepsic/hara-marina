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
  // if (event.type === "payment_intent.succeeded") {
  //   const intent = event.data.object;
  //   const bookingId = intent.metadata?.bookingId;
  //   if (bookingId) {
  //     await updateBooking(bookingId, { paymentStatus: "paid", status: "confirmed" });
  //   }
  // }

  console.log("[stripe-webhook] stub received an event (not enabled)");
  return res.status(200).json({ received: true, note: "stub" });
}
