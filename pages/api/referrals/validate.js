/**
 * Public referral-code preview for the marina signup wizard.
 *   GET /api/referrals/validate?code=RAIVO20
 * Returns reward type, value, and the owner's display name (no email).
 */
import { getSupabase } from "../../../lib/supabase";

const CODE_RE = /^[A-Z0-9]{3,20}$/;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const code = String(req.query.code || "").toUpperCase();
  if (!CODE_RE.test(code)) return res.status(200).json({ valid: false, reason: "invalid_format" });

  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "supabase not configured" });

  const { data: rc } = await sb.from("referral_codes")
    .select("code, reward_type, reward_value, reward_duration_months, max_uses, uses_count, expires_at, owner_email, active")
    .eq("code", code).eq("active", true).maybeSingle();
  if (!rc) return res.json({ valid: false, reason: "not_found" });
  if (rc.expires_at && new Date(rc.expires_at) < new Date()) return res.json({ valid: false, reason: "expired" });
  if (rc.max_uses != null && rc.uses_count >= rc.max_uses) return res.json({ valid: false, reason: "exhausted" });

  // Owner display: first name from email local-part. Don't echo full email.
  const localPart = String(rc.owner_email || "").split("@")[0] || "MerVare friend";
  const ownerName = localPart.charAt(0).toUpperCase() + localPart.slice(1);

  return res.json({
    valid: true,
    code: rc.code,
    rewardType: rc.reward_type,
    rewardValue: rc.reward_value,
    rewardDurationMonths: rc.reward_duration_months,
    ownerName,
  });
}
