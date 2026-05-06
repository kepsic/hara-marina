/**
 * Stripe Connect onboarding for a marina.
 *
 * POST  /api/stripe/connect/onboard    body: { marinaSlug?, returnUrl?, refreshUrl? }
 *   → { url }   (Stripe-hosted onboarding link)
 * GET   /api/stripe/connect/onboard?marinaSlug=...
 *   → { accountId, payoutsEnabled, chargesEnabled, detailsSubmitted }
 *
 * Harbor-master only. Returns 501 until STRIPE_SECRET_KEY is set.
 */

import Stripe from "stripe";
import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { isHarborMaster } from "../../../../lib/owners";
import {
  getConnectAccountForMarina,
  setConnectAccountForMarina,
} from "../../../../lib/stripeConnect";
import { siteUrlFromReq } from "../../../../lib/siteUrl";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const token = req.cookies[SESSION_COOKIE_NAME];
  const session = token ? await verifySession(token) : null;
  if (!session?.email || !isHarborMaster(session.email)) {
    return res.status(403).json({ error: "harbor master role required" });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({
      error: "Stripe Connect not yet enabled",
      hint: "Set STRIPE_SECRET_KEY (your platform key) in Vercel env.",
    });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { marinaSlug } = req.method === "GET" ? req.query : req.body || {};

  try {
    if (req.method === "GET") {
      const acct = await getConnectAccountForMarina(marinaSlug);
      if (!acct) return res.status(404).json({ error: "no connected account yet" });
      const a = await stripe.accounts.retrieve(acct);
      return res.json({
        accountId: a.id,
        payoutsEnabled: a.payouts_enabled,
        chargesEnabled: a.charges_enabled,
        detailsSubmitted: a.details_submitted,
      });
    }

    if (req.method === "POST") {
      let acct = await getConnectAccountForMarina(marinaSlug);
      if (!acct) {
        const created = await stripe.accounts.create({
          type: "express",
          country: process.env.STRIPE_DEFAULT_COUNTRY || "EE",
          email: session.email,
          business_type: "company",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { marinaSlug: marinaSlug || "" },
        });
        acct = created.id;
        await setConnectAccountForMarina(marinaSlug, acct);
      }
      const baseUrl = siteUrlFromReq(req);
      const link = await stripe.accountLinks.create({
        account: acct,
        refresh_url: req.body?.refreshUrl || `${baseUrl}/bookings`,
        return_url:  req.body?.returnUrl  || `${baseUrl}/bookings`,
        type: "account_onboarding",
      });
      return res.json({ url: link.url, accountId: acct });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  } catch (err) {
    console.error("[stripe/connect/onboard]", req.method, err?.message, err?.code, err?.type);
    return res.status(500).json({
      error: err?.message || "stripe onboarding failed",
      code: err?.code,
      type: err?.type,
    });
  }
}
