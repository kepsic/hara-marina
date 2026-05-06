/**
 * GET   /api/marinas/[slug]/members          — list members
 * POST  /api/marinas/[slug]/members          — invite by email
 *   body: { email, role }     role ∈ admin|harbor_master|owner
 *
 * No verification email is sent today — invitee just needs to sign in
 * with that email via the magic-link flow and they'll have access.
 */
import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { getSupabase } from "../../../../lib/supabase";
import { getMarinaIfAdmin } from "../../../../lib/marinaMembers";

const ROLES = new Set(["admin", "harbor_master", "owner"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const slug = String(req.query.slug || "").toLowerCase();

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "sign-in required" });

  const marina = await getMarinaIfAdmin(slug, session.email);
  if (!marina) return res.status(404).json({ error: "not found" });

  const sb = getSupabase();

  if (req.method === "GET") {
    const { data } = await sb
      .from("marina_members")
      .select("email, role")
      .eq("marina_id", marina.id)
      .order("role")
      .order("email");
    return res.json({ members: data || [] });
  }

  if (req.method === "POST") {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "harbor_master");
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "invalid email" });
    if (!ROLES.has(role)) return res.status(400).json({ error: "invalid role" });

    // Idempotent — ignore conflicts on (marina_id, email, role).
    const { error } = await sb
      .from("marina_members")
      .upsert(
        { marina_id: marina.id, email, role },
        { onConflict: "marina_id,email,role", ignoreDuplicates: true }
      );
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).end();
}
