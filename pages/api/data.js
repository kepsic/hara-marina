import { Redis } from "../../lib/redis.js";

const redis = new Redis();

export default async function handler(req, res) {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: "key required" });

  if (req.method === "GET") {
    try {
      const value = await redis.get(key);
      return res.status(200).json({ value: value ?? null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { value } = req.body;
      await redis.set(key, value);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
