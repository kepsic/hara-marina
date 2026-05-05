/**
 * Stripe Connect — destination-charge PaymentIntent for a booking.
 *
 * The marina is the merchant (connected account, set up via Stripe Express
 * or Standard onboarding). The SaaS owner (this platform) takes a small
 * `application_fee_amount` on each booking to cover infra (Vercel, Resend,
 * Redis, Stripe per-tx, etc.) — sized via pricing config
 * (platformFeePercent + platformFeeFixedCents).
 *
 * Returns 501 today. Flip the switch by:
 *   1. `npm i stripe`
 *   2. set STRIPE_SECRET_KEY (platform key — sk_live_... from your own account)
 *   3. set NEXT_PUBLIC_STRIPE_ENABLED=true (and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
 *   4. onboard each marina via Stripe Connect → store the `acct_...` id with
 *      lib/stripeConnect.js#setConnectAccountForMarina(slug, acctId)
 *   5. uncomment the block below.
 *
 * Once enabled, the wizard will call this endpoint after a booking is created
 * and use the returned client_secret with @stripe/stripe-js on the client.
 */

import { getBooking, updateBooking } from "../../../../lib/bookings";
import { getPricingConfig, computePlatformFee } from "../../../../lib/pricing";
import { getConnectAccountForMarina } from "../../../../lib/stripeConnect";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "booking id required" });

  const booking = await getBooking(id);
  if (!booking) return res.status(404).json({ error: "booking not found" });

  const stripeEnabled =
    process.env.STRIPE_SECRET_KEY &&
    process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";

  if (!stripeEnabled) {
    // Compute the would-be split so the harbor master can preview it even
    // before Stripe is wired.
    const cfg = await getPricingConfig();
    const platformFeeCents = computePlatformFee(booking.priceCents, cfg);
    return res.status(501).json({
      error: "Stripe Connect not yet enabled",
      hint: "Set STRIPE_SECRET_KEY + NEXT_PUBLIC_STRIPE_ENABLED=true and onboard the marina via Stripe Connect.",
      preview: {
        totalCents: booking.priceCents,
        platformFeeCents,
        marinaPayoutCents: booking.priceCents - platformFeeCents,
        currency: booking.currency,
      },
    });
  }

  const stripeAccount = await getConnectAccountForMarina(booking.marinaSlug);
  if (!stripeAccount) {
    return res.status(409).json({
      error: "Marina has not completed Stripe Connect onboarding",
      hint: "Use lib/stripeConnect.js#setConnectAccountForMarina(slug, 'acct_...').",
    });
  }

  // ---- Real implementation (kept inert until you uncomment) ----
  // import Stripe from "stripe";  // also: npm i stripe
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  // const cfg = await getPricingConfig();
  // const platformFeeCents = computePlatformFee(booking.priceCents, cfg);
  // const intent = await stripe.paymentIntents.create({
  //   amount: booking.priceCents,
  //   currency: booking.currency.toLowerCase(),
  //   application_fee_amount: platformFeeCents,
  //   transfer_data: { destination: stripeAccount },   // destination charge
  //   // alternative: on_behalf_of: stripeAccount,     // for full Connect "settlement merchant" semantics
  //   metadata: {
  //     bookingId: booking.id,
  //     berthId: booking.berthId,
  //     marinaSlug: booking.marinaSlug || "",
  //   },
  //   receipt_email: booking.email,
  // });
  // await updateBooking(id, {
  //   stripePaymentIntent: intent.id,
  //   stripeAccountId: stripeAccount,
  //   platformFeeCents,
  //   paymentStatus: "authorized",
  // });
  // return res.status(200).json({
  //   clientSecret: intent.client_secret,
  //   stripeAccount,                   // client must initialise Stripe.js with this
  //   platformFeeCents,
  // });

  return res.status(501).json({
    error: "Stripe code is committed but not yet uncommented",
  });
}
