// AISStream collector + cache.
//
// Architecture:
//   - getCachedSnapshot(mmsi)   : fast Upstash read (used by /api/ais/[slug]).
//   - collectAndStore(mmsis[])  : opens ONE WebSocket, listens for COLLECT_WINDOW_MS,
//                                 writes every position fix back to Upstash with a
//                                 long TTL so the UI can show last-known state
//                                 between Class-B broadcast intervals (~3 min).
//   - listKnownMmsis()          : pulls all configured MMSI values from hara-boats.
//
// The collector is invoked by /api/cron/ais on a Vercel cron schedule.

import WebSocket from "ws";
import { Redis } from "@upstash/redis";
import { MARINA_BBOX } from "./marina";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SNAP_TTL_S        = 60 * 60;   // keep last-known fix for 1 h
const COLLECT_WINDOW_MS = 50_000;    // listen window per cron tick (Class B stationary report ~3 min)
const KEY = (mmsi) => `ais:snap:${mmsi}`;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Read every boat's mmsi from the hara-boats Upstash record. */
export async function listKnownMmsis() {
  try {
    const v = await redis.get("hara-boats");
    const list = !v ? null : (typeof v === "string" ? JSON.parse(v) : v);
    if (!Array.isArray(list)) return [];
    return list
      .filter((b) => b && b.mmsi)
      .map((b) => ({ slug: norm(b.name), mmsi: String(b.mmsi).trim() }));
  } catch {
    return [];
  }
}

export async function getCachedSnapshot(mmsi) {
  if (!mmsi) return null;
  try {
    const v = await redis.get(KEY(mmsi));
    if (!v) return null;
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}

async function storeSnapshot(snap) {
  try {
    await redis.set(KEY(snap.mmsi), JSON.stringify(snap), { ex: SNAP_TTL_S });
  } catch {}
}

/**
 * Open one AISStream websocket, subscribe to up to 50 MMSIs, listen for
 * COLLECT_WINDOW_MS, persist every position fix to Upstash.
 * Returns the list of MMSIs that produced a fix during this window.
 */
export async function collectAndStore(mmsis) {
  if (!process.env.AISSTREAM_API_KEY) return [];
  const wanted = Array.from(new Set(mmsis.map(String))).slice(0, 50);
  if (wanted.length === 0) return [];

  const seen = new Map(); // mmsi -> snapshot

  await new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    } catch {
      return resolve();
    }
    const finish = () => { try { ws.close(); } catch {} resolve(); };
    const timer = setTimeout(finish, COLLECT_WINDOW_MS);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        APIKey: process.env.AISSTREAM_API_KEY,
        BoundingBoxes: MARINA_BBOX,
        FiltersShipMMSI: wanted,
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
      const mmsi = String(meta.MMSI || "");
      if (!mmsi) return;

      if (msg.MessageType === "PositionReport" || msg.MessageType === "StandardClassBPositionReport") {
        const pr = body.PositionReport || body.StandardClassBPositionReport || {};
        const prev = seen.get(mmsi) || {};
        const snap = {
          mmsi,
          lat:  Number(pr.Latitude  ?? meta.latitude),
          lon:  Number(pr.Longitude ?? meta.longitude),
          sog:  Number(pr.Sog ?? 0),
          cog:  Number(pr.Cog ?? 0),
          heading:   Number(pr.TrueHeading ?? 511),
          navStatus: Number(pr.NavigationalStatus ?? -1),
          name: (meta.ShipName || prev.name || "").trim() || null,
          ts: Date.now(),
        };
        seen.set(mmsi, snap);
      } else if (msg.MessageType === "ShipStaticData" || msg.MessageType === "StaticDataReport") {
        const sd = body.ShipStaticData || body.StaticDataReport || {};
        const name = (sd.Name || meta.ShipName || "").trim();
        if (name) {
          const prev = seen.get(mmsi) || { mmsi };
          prev.name = name;
          seen.set(mmsi, prev);
        }
      }
    });

    ws.on("error", finish);
    ws.on("close", () => { clearTimeout(timer); resolve(); });
  });

  const persisted = [];
  for (const [mmsi, snap] of seen) {
    if (Number.isFinite(snap.lat) && Number.isFinite(snap.lon)) {
      await storeSnapshot(snap);
      persisted.push(mmsi);
    }
  }
  return persisted;
}
