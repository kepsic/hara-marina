import { quoteStay } from "../../../lib/pricing";

/**
 * Public price quote endpoint used by the booking wizard for live price
 * estimates as the user picks dates. Doesn't reserve anything.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const { berth, dock, arrival, departure, loa } = req.query;
  if (!berth || !dock || !arrival || !departure) {
    return res.status(400).json({ error: "berth, dock, arrival, departure required" });
  }
  try {
    const loaM = loa != null && loa !== "" ? Number(loa) : undefined;
    const quote = await quoteStay({ berthId: berth, dockId: dock, arrival, departure, loaM });
    return res.status(200).json(quote);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
