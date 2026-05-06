/**
 * GET   /api/marinas/[slug]/dock-sections   — list sections + berth counts
 * POST  /api/marinas/[slug]/dock-sections   — bulk replace dock layout
 *   body: { sections: [{ label: "A", berthCount: 12 }, ...] }
 *
 * Used by the marina-onboarding wizard (step 4: dock layout) and later by
 * the in-app layout editor. Bulk-replace semantics keep the wizard simple:
 * the entire list is overwritten on save.
 */
import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { getSupabase } from "../../../../lib/supabase";
import { getMarinaIfAdmin } from "../../../../lib/marinaMembers";

const LABEL_RE = /^[A-Za-z0-9-]{1,8}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const slug = String(req.query.slug || "").toLowerCase();

  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email) return res.status(401).json({ error: "sign-in required" });

  const marina = await getMarinaIfAdmin(slug, session.email);
  if (!marina) return res.status(404).json({ error: "not found" });

  const sb = getSupabase();

  if (req.method === "GET") {
    const { data: sections } = await sb
      .from("dock_sections")
      .select("id, label, sort_order")
      .eq("marina_id", marina.id)
      .order("sort_order");
    const ids = (sections || []).map((s) => s.id);
    let counts = {};
    if (ids.length) {
      const { data: berths } = await sb
        .from("berths")
        .select("section_id")
        .in("section_id", ids);
      counts = (berths || []).reduce((acc, b) => {
        acc[b.section_id] = (acc[b.section_id] || 0) + 1;
        return acc;
      }, {});
    }
    return res.json({
      sections: (sections || []).map((s) => ({
        id: s.id,
        label: s.label,
        berthCount: counts[s.id] || 0,
      })),
    });
  }

  if (req.method === "POST") {
    const incoming = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const cleaned = [];
    for (const s of incoming) {
      const label = String(s?.label || "").trim().toUpperCase();
      const berthCount = Math.max(0, Math.min(200, Number(s?.berthCount) || 0));
      if (!LABEL_RE.test(label)) continue;
      if (cleaned.some((x) => x.label === label)) continue;
      cleaned.push({ label, berthCount });
    }
    if (!cleaned.length) {
      return res.status(400).json({ error: "no valid sections" });
    }

    // Wipe & replace. Berths cascade-delete via section FK.
    await sb.from("dock_sections").delete().eq("marina_id", marina.id);

    const sectionsRows = cleaned.map((s, i) => ({
      marina_id: marina.id,
      label: s.label,
      sort_order: i,
    }));
    const { data: inserted, error } = await sb
      .from("dock_sections")
      .insert(sectionsRows)
      .select("id, label");
    if (error) return res.status(500).json({ error: error.message });

    // Build the berth rows.
    const berthRows = [];
    for (const sec of inserted) {
      const targetCount = cleaned.find((c) => c.label === sec.label)?.berthCount || 0;
      for (let i = 1; i <= targetCount; i++) {
        berthRows.push({
          marina_id: marina.id,
          section_id: sec.id,
          berth_label: `${sec.label}${i}`,
          sort_order: i,
        });
      }
    }
    if (berthRows.length) {
      const { error: berthErr } = await sb.from("berths").insert(berthRows);
      if (berthErr) return res.status(500).json({ error: berthErr.message });
    }

    return res.json({ ok: true, sections: cleaned.length, berths: berthRows.length });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).end();
}
