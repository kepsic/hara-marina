/**
 * POST /api/power/token/create
 *   body: { marinaSlug, berthId, kwhAmount, email }
 *
 * Creates a pending power_tokens row + a Stripe PaymentIntent. Once
 * the payment_intent.succeeded webhook fires, lib/power#activatePowerToken
 * flips the token to active and enables the relay via MQTT.
 *
 * No auth required — guests can purchase shore power against any
 * berth that has a pedestal configured.
 */

import { createPendingPowerToken } from "../../../../lib/power";

const PRICE_CENTS_PER_KWH = Number(process.env.POWER_PRICE_CENTS_PER_KWH || 35);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  res.setHeader("Cache-Control", "no-store");

  const { marinaSlug, berthId, kwhAmount, email } = req.body || {};
  const kwh = Number(kwhAmount);
  if (!marinaSlug || !berthId || !email) {
    return res.status(400).json({ error: "marinaSlug, berthId, email required" });
  }
  if (!Number.isFinite(kwh) || kwh <= 0 || kwh > 200) {
    return res.status(400).json({ error: "kwhAmount must be 0 < kwh <= 200" });
  }

  let token;
  try {
    token = await createPendingPowerToken({
      marinaSlug,
      berthId,
      email,
      kwhAmount: kwh,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "create token failed" });
  }

  const totalCents = Math.round(kwh * PRICE_CENTS_PER_KWH);

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(200).json({
      token,
      totalCents,
      currency: "EUR",
      clientSecret: null,
      hint: "STRIPE_SECRET_KEY unset — token created in pending state.",
    });
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const intent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "eur",
      receipt_email: email,
      description: `Shore power ${kwh} kWh · ${marinaSlug} · ${berthId}`,
      metadata: {
        powerTokenId: token.id,
        marinaSlug,
        berthId,
      },
    });
    return res.json({
      token,
      totalCents,
      currency: "EUR",
      clientSecret: intent.client_secret,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "stripe failed" });
  }
}
