/**
 * GET    /api/marinas/[slug]              — fetch onboarding state (admin only)
 * PATCH  /api/marinas/[slug]              — partial update of allowed fields
 *
 * Used by the marina-onboarding wizard to read/write progress without
 * giving the client a full Supabase write key.
 */
import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { getSupabase } from "../../../../lib/supabase";
import { getMarinaIfAdmin } from "../../../../lib/marinaMembers";

const ALLOWED_FIELDS = new Set([
  "name", "tagline", "brand_color", "logo_url", "website",
  "contact_email", "plan", "onboarding_step", "lat", "lon", "country",
]);

const PLANS = new Set(["free", "marina", "founding"]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const slug = String(req.query.slug || "").toLowerCase();

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "sign-in required" });

  const marina = await getMarinaIfAdmin(slug, session.email);
  if (!marina) return res.status(404).json({ error: "not found" });

  if (req.method === "GET") {
    return res.json({ marina });
  }

  if (req.method === "PATCH") {
    const body = req.body || {};
    const patch = {};
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_FIELDS.has(k)) continue;
      if (k === "plan" && !PLANS.has(v)) continue;
      if (k === "brand_color" && v && !HEX_RE.test(v)) continue;
      if (k === "onboarding_step") {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 7) continue;
        patch[k] = n;
        continue;
      }
      if (k === "lat" || k === "lon") {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        patch[k] = n;
        continue;
      }
      if (typeof v === "string") patch[k] = v.slice(0, 240);
      else patch[k] = v;
    }

    if (body.publish === true) {
      patch.onboarding_completed_at = new Date().toISOString();
      patch.onboarding_step = 7;
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "no allowed fields in body" });
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from("marinas")
      .update(patch)
      .eq("id", marina.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ marina: data });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).end();
}
