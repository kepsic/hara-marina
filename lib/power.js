/**
 * Pedestal shore-power management.
 *
 * Stores per-berth pedestal config + power-token state in Supabase
 * (tables pedestal_berths and power_tokens). Hardware control is sent
 * over MQTT to the marina-bridge via publishPowerCommand().
 */

import { getSupabase } from "./supabase";

export async function getPedestalState(marinaSlug, berthId) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: marina } = await sb.from("marinas").select("id").eq("slug", marinaSlug).maybeSingle();
  if (!marina?.id) return null;
  const { data: pedestal } = await sb
    .from("pedestal_berths")
    .select("*")
    .eq("marina_id", marina.id)
    .eq("berth_id", berthId)
    .maybeSingle();
  if (!pedestal) return { exists: false, marinaId: marina.id, berthId };
  const { data: activeToken } = await sb
    .from("power_tokens")
    .select("*")
    .eq("marina_id", marina.id)
    .eq("berth_id", berthId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    exists: true,
    marinaId: marina.id,
    berthId,
    relayChannel: pedestal.relay_channel,
    meterType: pedestal.meter_type,
    kwhTotal: Number(pedestal.kwh_total) || 0,
    powerEnabled: !!pedestal.power_enabled,
    lastReadingAt: pedestal.last_reading_at,
    activeToken: activeToken
      ? {
          id: activeToken.id,
          email: activeToken.email,
          kwhPurchased: Number(activeToken.kwh_purchased) || 0,
          kwhUsed: Number(activeToken.kwh_used) || 0,
          expiresAt: activeToken.expires_at,
        }
      : null,
  };
}

export async function setPowerEnabled(marinaSlug, berthId, enabled, tokenId = null) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data: marina } = await sb.from("marinas").select("id").eq("slug", marinaSlug).maybeSingle();
  if (!marina?.id) throw new Error("unknown marina");
  const { error } = await sb
    .from("pedestal_berths")
    .update({ power_enabled: !!enabled })
    .eq("marina_id", marina.id)
    .eq("berth_id", berthId);
  if (error) throw new Error(error.message);
  await publishPowerCommand({ marinaSlug, berthId, action: enabled ? "enable" : "disable", tokenId });
}

export async function createPendingPowerToken({ marinaSlug, berthId, email, kwhAmount, expiresAt = null }) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data: marina } = await sb.from("marinas").select("id").eq("slug", marinaSlug).maybeSingle();
  if (!marina?.id) throw new Error("unknown marina");
  const { data, error } = await sb
    .from("power_tokens")
    .insert({
      marina_id: marina.id,
      berth_id: berthId,
      email: String(email).trim().toLowerCase(),
      kwh_purchased: Number(kwhAmount),
      status: "pending",
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function activatePowerToken(tokenId, stripePaymentIntent = null) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data: token, error } = await sb
    .from("power_tokens")
    .update({
      status: "active",
      stripe_payment_intent: stripePaymentIntent,
    })
    .eq("id", tokenId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (!token) throw new Error("token not found");

  const { data: marina } = await sb.from("marinas").select("slug").eq("id", token.marina_id).maybeSingle();
  if (marina?.slug) {
    try {
      await setPowerEnabled(marina.slug, token.berth_id, true, token.id);
    } catch (e) {
      console.error("[power] setPowerEnabled after activate failed:", e?.message || e);
    }
  }
  return token;
}

/**
 * Publish a relay command to the marina-bridge over MQTT.
 *
 * Topic: marina/<slug>/pedestal/cmd
 * Payload: { type: "pedestal_relay_set", berth_id, channel, state, token_id }
 *
 * The marina-bridge in infra/marina-bridge subscribes to this topic and
 * drives the relay (YDCC-04 or similar). When EMQX_HTTP_API is unset, this
 * is a no-op so dev/local environments don't need an MQTT broker.
 */
export async function publishPowerCommand({ marinaSlug, berthId, action, tokenId }) {
  const apiUrl = process.env.EMQX_HTTP_API;
  if (!apiUrl) {
    console.log(`[power-cmd] (no broker) ${marinaSlug}/${berthId} → ${action}`);
    return;
  }
  const sb = getSupabase();
  let channel = null;
  if (sb) {
    const { data: marina } = await sb.from("marinas").select("id").eq("slug", marinaSlug).maybeSingle();
    if (marina?.id) {
      const { data: pedestal } = await sb
        .from("pedestal_berths")
        .select("relay_channel")
        .eq("marina_id", marina.id)
        .eq("berth_id", berthId)
        .maybeSingle();
      channel = pedestal?.relay_channel ?? null;
    }
  }
  const payload = {
    type: "pedestal_relay_set",
    berth_id: berthId,
    channel,
    state: action === "enable",
    token_id: tokenId,
  };
  const topic = `marina/${marinaSlug}/cmd/pedestal`;
  try {
    const auth = Buffer
      .from(`${process.env.EMQX_API_KEY || ""}:${process.env.EMQX_API_SECRET || ""}`)
      .toString("base64");
    const r = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v5/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        topic,
        payload: JSON.stringify(payload),
        qos: 1,
        retain: false,
      }),
    });
    if (!r.ok) {
      console.error("[power-cmd] EMQX publish failed:", r.status, await r.text());
    }
  } catch (e) {
    console.error("[power-cmd] EMQX publish threw:", e?.message || e);
  }
}
