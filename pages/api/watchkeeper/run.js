import { runWatchkeeperSweep } from "../../../lib/alerts";

function authorized(req) {
  const expected = process.env.WATCHKEEPER_CRON_TOKEN;
  if (!expected) return false;
  const header = req.headers.authorization || req.headers["x-watchkeeper-token"] || "";
  const got = String(header).replace(/^Bearer\s+/i, "").trim();
  return got.length > 0 && got === expected;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: "invalid or missing watchkeeper token" });
  }

  try {
    const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : undefined;
    const out = await runWatchkeeperSweep({ slugs, nowTs: Date.now() });
    return res.status(200).json(out);
  } catch (e) {
    console.error("[watchkeeper] cron run failed:", e?.message || e);
    return res.status(500).json({ error: "watchkeeper run failed" });
  }
}
