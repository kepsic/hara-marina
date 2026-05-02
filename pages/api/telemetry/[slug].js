import { makeTelemetry } from "../../../lib/telemetry";

export default async function handler(req, res) {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: "slug required" });

  // Pull current boats list from KV (falls back to constants)
  let boats = null;
  try {
    const r = await fetch(
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/data?key=hara-boats`
    );
    const j = await r.json();
    boats = j.value ? JSON.parse(j.value) : null;
  } catch {}

  if (!boats) {
    const { INITIAL_BOATS } = await import("../../../lib/constants");
    boats = INITIAL_BOATS;
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const boat = boats.find((b) => norm(b.name) === norm(slug));
  if (!boat) return res.status(404).json({ error: "boat not found" });

  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return res.status(200).json(makeTelemetry(boat));
}
