/**
 * Stripe payment intent stub.
 *
 * Returns 501 today. The full implementation lives in commented form below
 * so flipping the switch is a one-line uncomment + adding STRIPE_SECRET_KEY.
 *
 * When enabled, the wizard will call this endpoint after a booking is created
 * and use the returned client_secret with @stripe/stripe-js on the client.
 */

import { getBooking } from "../../../../lib/bookings";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "booking id required" });

  if (process.env.STRIPE_SECRET_KEY !== undefined && process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true") {
    // ---- Real implementation (kept inert until the env vars are set) ----
    // import Stripe from "stripe";  // also: npm i stripe
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // const booking = await getBooking(id);
    // if (!booking) return res.status(404).json({ error: "not found" });
    // const intent = await stripe.paymentIntents.create({
    //   amount: booking.priceCents,
    //   currency: booking.currency.toLowerCase(),
    //   metadata: { bookingId: booking.id, berthId: booking.berthId },
    // });
    // await updateBooking(id, { stripePaymentIntent: intent.id, paymentStatus: "authorized" });
    // return res.status(200).json({ clientSecret: intent.client_secret });
  }

  // Acknowledge the booking exists but signal payments are not yet wired.
  const booking = await getBooking(id);
  if (!booking) return res.status(404).json({ error: "booking not found" });
  return res.status(501).json({
    error: "Stripe payments not yet enabled",
    hint: "Set STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_ENABLED=true to enable.",
  });
}
