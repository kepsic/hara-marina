/**
 * Referrals & affiliate program.
 *
 * Codes are uppercase alphanumerics ([A-Z0-9]{3,20}). Self-referral is
 * rejected. Founding-marina slots are capped per country. Sailing
 * passport stamps are unique per (email, marina) so the same booking
 * can't be claimed twice.
 *
 * Stripe payouts to affiliate Connect accounts are NOT executed here —
 * we only mark the events as paid. The actual stripe.transfers.create
 * call is wired into pages/api/affiliates/payout.js so the cron route
 * is the single place that touches the Stripe account-balance.
 */

import { getSupabase } from "./supabase.js";
import { INCENTIVES } from "./incentives.js";

const CODE_RE = /^[A-Z0-9]{3,20}$/;

function isValidCode(code) {
  return typeof code === "string" && CODE_RE.test(code);
}

export async function generateReferralCode({
  ownerType,
  ownerId,
  ownerEmail,
  rewardType,
  rewardValue,
  rewardDurationMonths = 1,
  maxUses = null,
  expiresAt = null,
}) {
  const sb = getSupabase();
  if (!sb) throw new Error("supabase not configured");

  const base = String(ownerEmail || "").split("@")[0]
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "MERV";
  // Try a few suffixes if a collision occurs.
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "X");
    const code = `${base}${suffix}`.slice(0, 20);
    const { data, error } = await sb.from("referral_codes").insert({
      code,
      owner_type: ownerType,
      owner_id: ownerId,
      owner_email: String(ownerEmail).toLowerCase(),
      reward_type: rewardType,
      reward_value: rewardValue,
      reward_duration_months: rewardDurationMonths,
      max_uses: maxUses,
      expires_at: expiresAt,
      active: true,
    }).select().single();
    if (!error) return data;
    // 23505 = unique_violation; retry with new suffix.
    if (error.code !== "23505") throw error;
  }
  throw new Error("could not generate unique referral code after 5 attempts");
}

export async function applyReferralCode(code, refereeEmail, ctx = {}) {
  if (!isValidCode(code)) return { valid: false, reason: "invalid_format" };
  const sb = getSupabase();
  if (!sb) return { valid: false, reason: "no_db" };

  const { data: rc } = await sb.from("referral_codes")
    .select("*").eq("code", code.toUpperCase()).eq("active", true).maybeSingle();
  if (!rc) return { valid: false, reason: "not_found" };
  if (rc.expires_at && new Date(rc.expires_at) < new Date()) return { valid: false, reason: "expired" };
  if (rc.max_uses != null && rc.uses_count >= rc.max_uses) return { valid: false, reason: "exhausted" };
  // Self-referral guard: code owner can't redeem their own code.
  if (rc.owner_email && rc.owner_email.toLowerCase() === String(refereeEmail).toLowerCase()) {
    return { valid: false, reason: "self_referral" };
  }

  await sb.from("referral_events").insert({
    code_id: rc.id,
    event_type: ctx.eventType || "marina_signup",
    referee_email: refereeEmail,
    referee_marina_id: ctx.marinaId || null,
    gmv_cents: ctx.gmvCents || 0,
    reward_cents: computeReferralReward(rc, ctx),
  });
  await sb.from("referral_codes")
    .update({ uses_count: rc.uses_count + 1 })
    .eq("id", rc.id);

  return { valid: true, code: rc };
}

function computeReferralReward(rc, ctx) {
  if (rc.reward_type === "cash_payout") {
    return Math.round((ctx.gmvCents || 0) * (rc.reward_value || 0) / 100);
  }
  return 0;
}

export async function claimFoundingMarina(marinaId, country) {
  const sb = getSupabase();
  if (!sb) return { granted: false, reason: "no_db" };
  const { count } = await sb.from("marinas")
    .select("id", { count: "exact", head: true })
    .eq("country", country)
    .eq("founding_marina", true);
  if ((count || 0) >= INCENTIVES.FOUNDING_MARINA_SLOTS_PER_COUNTRY) {
    return { granted: false, reason: "founding_slots_full" };
  }
  const number = (count || 0) + 1;
  await sb.from("marinas").update({
    founding_marina: true,
    founding_marina_number: number,
    plan: "marina",
  }).eq("id", marinaId);
  return { granted: true, number };
}

export async function stampPassport(email, marinaId, bookingId) {
  const sb = getSupabase();
  if (!sb || !email || !marinaId) return { stamped: false };
  const { error } = await sb.from("passport_stamps").upsert(
    { email, marina_id: marinaId, booking_id: bookingId, stamped_at: new Date().toISOString() },
    { onConflict: "email,marina_id", ignoreDuplicates: true },
  );
  if (error) return { stamped: false };
  const { count } = await sb.from("passport_stamps")
    .select("id", { count: "exact", head: true }).eq("email", email);
  const total = count || 0;
  return {
    stamped: true,
    totalStamps: total,
    milestone: total > 0 && total % INCENTIVES.PASSPORT_MILESTONE_INTERVAL === 0 ? total : null,
  };
}

/**
 * Group pending payouts by code-owner email and mark them paid. The
 * actual stripe.transfers.create call lives in the cron API route so
 * this library can be unit-tested without Stripe.
 *
 * Returns the planned payout batches; the caller is responsible for
 * issuing transfers and writing back stripe_transfer_id.
 */
export async function planPendingPayouts() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: pending } = await sb.from("referral_events")
    .select("id, reward_cents, referral_codes(owner_email, owner_id, owner_type)")
    .is("paid_out_at", null)
    .gt("reward_cents", 0);

  const grouped = new Map();
  for (const ev of pending || []) {
    const email = ev.referral_codes?.owner_email;
    if (!email) continue;
    const cur = grouped.get(email) || { total: 0, events: [], email };
    cur.total += ev.reward_cents;
    cur.events.push(ev.id);
    grouped.set(email, cur);
  }

  const eligible = [];
  for (const batch of grouped.values()) {
    if (batch.total < INCENTIVES.PAYOUT_MINIMUM_CENTS) continue;
    const { data: aff } = await sb.from("affiliates")
      .select("stripe_account_id").eq("email", batch.email).maybeSingle();
    if (!aff?.stripe_account_id) continue;
    eligible.push({ ...batch, stripeAccountId: aff.stripe_account_id });
  }
  return eligible;
}

export async function markPayoutComplete(eventIds, transferId) {
  const sb = getSupabase();
  if (!sb || !eventIds?.length) return;
  await sb.from("referral_events")
    .update({ paid_out_at: new Date().toISOString(), stripe_transfer_id: transferId })
    .in("id", eventIds);
}
