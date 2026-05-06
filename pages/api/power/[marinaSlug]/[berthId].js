/**
 * GET  /api/power/[marinaSlug]/[berthId]
 *   → current power state, active token if any
 *
 * POST /api/power/[marinaSlug]/[berthId]
 *   body: { action: "enable" | "disable" }
 *   harbor_master / admin only — manual override.
 */

import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { isHarborMasterAsync } from "../../../../lib/owners";
import { getPedestalState, setPowerEnabled } from "../../../../lib/power";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { marinaSlug, berthId } = req.query;
  if (!marinaSlug || !berthId) return res.status(400).json({ error: "marinaSlug + berthId required" });

  if (req.method === "GET") {
    const state = await getPedestalState(marinaSlug, berthId);
    return res.json({ state });
  }

  if (req.method === "POST") {
    const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!session?.email || !(await isHarborMasterAsync(session.email, marinaSlug))) {
      return res.status(403).json({ error: "harbor master role required" });
    }
    const { action } = req.body || {};
    if (action !== "enable" && action !== "disable") {
      return res.status(400).json({ error: "action must be 'enable' or 'disable'" });
    }
    try {
      await setPowerEnabled(marinaSlug, berthId, action === "enable");
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "failed" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).end();
}
