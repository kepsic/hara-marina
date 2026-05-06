/**
 * POST /api/marinas/register
 *
 * Body:  { name, slug, lat, lon, country, timezone? }
 * Auth:  any signed-in user (their email becomes the first admin +
 *        harbor_master of the new marina).
 *
 * Validates uniqueness of slug, creates the marinas row, links the
 * caller as admin in marina_members, and returns the new record.
 */

import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { getSupabase } from "../../../lib/supabase";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED = new Set([
  "www", "api", "app", "admin", "auth", "login", "logout", "signup",
  "marina", "marinas", "boats", "bookings", "stripe", "power",
  "mervare", "hara-marina",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  res.setHeader("Cache-Control", "no-store");

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "sign-in required" });

  const sb = getSupabase();
  if (!sb) return res.status(503).json({ error: "Supabase not configured" });

  const { name, slug, lat, lon, country, timezone } = req.body || {};

  const cleanName = String(name || "").trim().slice(0, 80);
  const cleanSlug = String(slug || "").trim().toLowerCase().slice(0, 32);
  const latN = Number(lat);
  const lonN = Number(lon);
  const cleanCountry = String(country || "EE").trim().toUpperCase().slice(0, 2);
  const cleanTz = String(timezone || "Europe/Tallinn").trim().slice(0, 64);

  if (!cleanName) return res.status(400).json({ error: "name required" });
  if (!SLUG_RE.test(cleanSlug)) {
    return res.status(400).json({ error: "slug must be 1-32 chars, [a-z0-9-]" });
  }
  if (RESERVED.has(cleanSlug)) {
    return res.status(400).json({ error: "slug is reserved" });
  }
  if (!Number.isFinite(latN) || !Number.isFinite(lonN) || Math.abs(latN) > 90 || Math.abs(lonN) > 180) {
    return res.status(400).json({ error: "lat/lon required and must be valid coordinates" });
  }

  // Uniqueness check
  const { data: existing } = await sb.from("marinas").select("id").eq("slug", cleanSlug).maybeSingle();
  if (existing) return res.status(409).json({ error: "slug already taken" });

  const { data: marina, error } = await sb
    .from("marinas")
    .insert({
      slug: cleanSlug,
      name: cleanName,
      lat: latN,
      lon: lonN,
      country: cleanCountry,
      timezone: cleanTz,
      plan: "free",
      active: true,
    })
    .select()
    .single();
  if (error) {
    console.error("[marinas/register] insert failed:", error.message);
    return res.status(500).json({ error: "insert failed", detail: error.message });
  }

  // First member is the caller, with both admin + harbor_master.
  await sb.from("marina_members").insert([
    { marina_id: marina.id, email: session.email.toLowerCase(), role: "admin" },
    { marina_id: marina.id, email: session.email.toLowerCase(), role: "harbor_master" },
  ]);

  // Best-effort welcome email — don't block on it.
  try {
    if (process.env.RESEND_API_KEY) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://mervare.app";
      const dashUrl = `https://${cleanSlug}.${(baseUrl.replace(/^https?:\/\//, "").replace(/\/.*/, "")) || "mervare.app"}`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || "MerVare <onboarding@resend.dev>",
          to: [session.email],
          subject: `⚓ ${cleanName} is live on MerVare`,
          html: `<p>Hi,</p>
                 <p>Your marina <b>${cleanName}</b> is now registered on MerVare.</p>
                 <p>Dashboard: <a href="${dashUrl}">${dashUrl}</a></p>
                 <p>Next step: connect Stripe to take payments and complete owner onboarding.</p>`,
        }),
      });
    }
  } catch (e) {
    console.warn("[marinas/register] welcome email failed:", e?.message || e);
  }

  return res.status(201).json({
    marina,
    setupUrl: `/onboard?marina=${cleanSlug}`,
  });
}
