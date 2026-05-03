// Vercel cron entry: refresh AIS snapshots for every boat that has an mmsi.
// Schedule is configured in vercel.json.

import { listKnownMmsis, collectAndStore } from "../../../lib/aisStream";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // Vercel cron requests carry a known header; also allow manual run with bearer.
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  if (!isVercelCron && cronSecret && auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const boats = await listKnownMmsis();
  const mmsis = boats.map((b) => b.mmsi);
  if (mmsis.length === 0) {
    return res.status(200).json({ ok: true, boats: 0, persisted: [] });
  }

  const persisted = await collectAndStore(mmsis);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    boats: boats.length,
    requested: mmsis,
    persisted,
  });
}
