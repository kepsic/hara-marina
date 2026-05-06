/**
 * Generate a personal referral code for the authenticated user.
 *   POST /api/referrals/generate
 *   { rewardType: 'subscription_discount' | 'cash_payout' | 'booking_credit',
 *     rewardValue: number, label?: string }
 * Returns { code, shareUrl }.
 */
import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { generateReferralCode } from "../../../lib/referrals";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "session required" });

  const { rewardType, rewardValue, ownerType = "boat_owner" } = req.body || {};
  if (!rewardType || !Number.isFinite(Number(rewardValue))) {
    return res.status(400).json({ error: "rewardType + rewardValue required" });
  }

  try {
    const rc = await generateReferralCode({
      ownerType,
      ownerId: null,
      ownerEmail: session.email,
      rewardType,
      rewardValue: Number(rewardValue),
    });
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://mervare.app";
    return res.json({ code: rc.code, shareUrl: `${base}/?ref=${rc.code}` });
  } catch (e) {
    console.error("[referrals/generate] failed:", e?.message || e);
    return res.status(500).json({ error: "generate failed" });
  }
}
