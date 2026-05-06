/**
 * Stripe Checkout Session for a guest-berth booking.
 *
 * POST /api/bookings/:id/checkout
 *   → { url } – the Stripe-hosted Checkout URL the guest should be sent to.
 *
 * Public endpoint: the booking id is opaque (random hex) and acts as a
 * bearer token. We only expose what's already in the booking record.
 *
 * Two modes:
 *   - Connect destination charge   (marina has an `acct_…` registered via
 *     lib/stripeConnect.js): money is collected on the platform, an
 *     `application_fee_amount` is retained by the SaaS owner, and the rest
 *     is transferred to the marina's connected account.
 *   - Direct charge to platform     (no connected account): the platform IS
 *     the marina. Used by the single-tenant Hara deployment until/unless
 *     Connect onboarding is completed.
 *
 * Status flow:
 *   booking.paymentStatus = "unpaid"   → on session create unchanged
 *   booking.paymentStatus = "paid"     ← set by webhook on payment_intent.succeeded
 *   booking.status        = "confirmed" ← set by webhook on payment_intent.succeeded
 *
 * Required env:
 *   STRIPE_SECRET_KEY    – platform key (sk_live_… or sk_test_…)
 * Optional env:
 *   NEXT_PUBLIC_BASE_URL – overrides the auto-detected return URL host.
 */

import Stripe from "stripe";
import { getBooking, updateBooking } from "../../../../lib/bookings";
import { getPricingConfig, computePlatformFee } from "../../../../lib/pricing";
import { getConnectAccountForMarina } from "../../../../lib/stripeConnect";
import { siteUrlFromReq } from "../../../../lib/siteUrl";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({
      error: "Stripe not configured",
      hint: "Set STRIPE_SECRET_KEY in the environment.",
    });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "booking id required" });

  const booking = await getBooking(id);
  if (!booking) return res.status(404).json({ error: "booking not found" });
  if (!Number.isFinite(booking.priceCents) || booking.priceCents <= 0) {
    return res.status(400).json({ error: "booking has no price" });
  }
  if (booking.paymentStatus === "paid") {
    return res.status(409).json({ error: "booking already paid" });
  }
  if (booking.status === "cancelled") {
    return res.status(409).json({ error: "booking is cancelled" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const cfg = await getPricingConfig(booking.marinaSlug);
  const platformFeeCents = computePlatformFee(booking.priceCents, cfg);
  const stripeAccount = await getConnectAccountForMarina(booking.marinaSlug);
  const currency = (booking.currency || cfg.currency || "EUR").toLowerCase();

  const base = siteUrlFromReq(req);
  // Send the guest back to the marina page with a query flag the dock-map UI
  // can read to render a thank-you / try-again banner. We don't have a
  // dedicated success page yet — this keeps the round-trip on a real URL.
  const slugPath = booking.marinaSlug ? `/${encodeURIComponent(booking.marinaSlug)}` : "/";
  const successUrl = `${base}${slugPath}?booking=${encodeURIComponent(id)}&paid=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${base}${slugPath}?booking=${encodeURIComponent(id)}&paid=0`;

  const description = [
    booking.dockName,
    booking.berthLabel,
    booking.arrival && booking.departure ? `${booking.arrival} → ${booking.departure}` : null,
  ].filter(Boolean).join(" · ") || "Guest berth";

  const lineItem = {
    price_data: {
      currency,
      product_data: {
        name: `Guest berth · ${booking.boatName || booking.guestName || "booking"}`,
        description,
      },
      unit_amount: booking.priceCents,
    },
    quantity: 1,
  };

  const metadata = {
    bookingId: booking.id,
    berthId: booking.berthId || "",
    marinaSlug: booking.marinaSlug || "",
  };

  // Build payment_intent_data so the metadata + Connect routing flow through
  // to the resulting PaymentIntent (which is what the webhook listens on).
  const paymentIntentData = {
    metadata,
    receipt_email: booking.email,
  };
  if (stripeAccount) {
    paymentIntentData.application_fee_amount = platformFeeCents;
    paymentIntentData.transfer_data = { destination: stripeAccount };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [lineItem],
      customer_email: booking.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata, // also on the session for checkout.session.completed handler
      payment_intent_data: paymentIntentData,
    });
  } catch (e) {
    console.error("[checkout] create session failed:", e?.message || e);
    return res.status(502).json({ error: e?.message || "Stripe error" });
  }

  await updateBooking(id, {
    stripeCheckoutSessionId: session.id,
    stripeAccountId: stripeAccount || null,
    platformFeeCents,
  }).catch((e) => console.error("[checkout] updateBooking failed:", e?.message || e));

  return res.status(200).json({ url: session.url, sessionId: session.id });
}
