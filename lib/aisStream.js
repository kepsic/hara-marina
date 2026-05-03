// Short-lived AISStream WebSocket query, cached in Upstash.
// AISStream forbids browser CORS — keep API key server-side only.
//
// Env:
//   AISSTREAM_API_KEY   - required to enable AIS lookups
//
// Usage:
//   const snap = await getAisSnapshot(mmsi);
//   // -> { mmsi, lat, lon, sog, cog, heading, name, navStatus, ts } or null

import WebSocket from "ws";
import { Redis } from "@upstash/redis";
import { MARINA_BBOX } from "./marina";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CACHE_TTL_S       = 60;   // cap AISStream calls to ~1/min/MMSI
const NEGATIVE_TTL_S    = 30;   // when no message arrives
const COLLECT_WINDOW_MS = 6000; // listen window per call (subscribe deadline is 3s)
const KEY = (mmsi) => `ais:snap:${mmsi}`;

function once(mmsi) {
  return new Promise((resolve) => {
    const url = "wss://stream.aisstream.io/v0/stream";
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return resolve(null);
    }
    let latest = null;
    let staticName = null;
    const done = (val) => {
      try { ws.close(); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => done(latest), COLLECT_WINDOW_MS);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        APIKey: process.env.AISSTREAM_API_KEY,
        BoundingBoxes: MARINA_BBOX,
        FiltersShipMMSI: [String(mmsi)],
        FilterMessageTypes: [
          "PositionReport",
          "StandardClassBPositionReport",
          "ShipStaticData",
          "StaticDataReport",
        ],
      }));
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.error) return;
      const meta = msg.MetaData || {};
      const body = msg.Message || {};
      if (msg.MessageType === "PositionReport" || msg.MessageType === "StandardClassBPositionReport") {
        const pr = body.PositionReport || body.StandardClassBPositionReport || {};
        latest = {
          mmsi: String(meta.MMSI || mmsi),
          lat:  Number(pr.Latitude  ?? meta.latitude),
          lon:  Number(pr.Longitude ?? meta.longitude),
          sog:  Number(pr.Sog ?? 0),
          cog:  Number(pr.Cog ?? 0),
          heading:   Number(pr.TrueHeading ?? 511),
          navStatus: Number(pr.NavigationalStatus ?? -1),
          name: (meta.ShipName || staticName || "").trim() || null,
          ts: Date.now(),
        };
        // Got a fresh fix — short-circuit early.
        clearTimeout(timer);
        done(latest);
      } else if (msg.MessageType === "ShipStaticData" || msg.MessageType === "StaticDataReport") {
        const sd = body.ShipStaticData || body.StaticDataReport || {};
        staticName = (sd.Name || meta.ShipName || "").trim() || staticName;
        if (latest && !latest.name) latest.name = staticName;
      }
    });

    ws.on("error", () => done(latest));
    ws.on("close", () => { clearTimeout(timer); resolve(latest); });
  });
}

export async function getAisSnapshot(mmsi) {
  if (!mmsi) return null;
  if (!process.env.AISSTREAM_API_KEY) return null;
  const k = KEY(mmsi);
  try {
    const cached = await redis.get(k);
    if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached;
  } catch {}

  const snap = await once(mmsi);
  try {
    if (snap) {
      await redis.set(k, JSON.stringify(snap), { ex: CACHE_TTL_S });
    } else {
      await redis.set(k, JSON.stringify({ empty: true, ts: Date.now() }), { ex: NEGATIVE_TTL_S });
    }
  } catch {}
  return snap;
}
