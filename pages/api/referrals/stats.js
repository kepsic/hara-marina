/**
 * Personal referral stats for the authenticated user.
 *   GET /api/referrals/stats
 * Returns { codes: [...], pendingRewardCents, paidOutCents }.
 */
import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { getSupabase } from "../../../lib/supabase";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "session required" });
  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "supabase not configured" });

  const ownerEmail = session.email.toLowerCase();
  const { data: codes } = await sb.from("referral_codes")
    .select("id, code, reward_type, reward_value, uses_count, max_uses, active, expires_at, created_at")
    .eq("owner_email", ownerEmail);

  let pending = 0, paidOut = 0;
  if (codes?.length) {
    const ids = codes.map((c) => c.id);
    const { data: events } = await sb.from("referral_events")
      .select("reward_cents, paid_out_at")
      .in("code_id", ids);
    for (const e of events || []) {
      if (e.paid_out_at) paidOut += e.reward_cents || 0;
      else pending += e.reward_cents || 0;
    }
  }

  return res.json({ codes: codes || [], pendingRewardCents: pending, paidOutCents: paidOut });
}
