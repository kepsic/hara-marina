import { Redis } from "../../lib/redis";
import { verifySession, SESSION_COOKIE_NAME } from "../../lib/auth";
import { isSuperAdmin } from "../../lib/owners";

const redis = new Redis();
const KEY = "hara:marina-layout:v1";

const DEFAULT_LAYOUT = {
  center: [59.5881254, 25.6124356],
  pierLines: [
    [
      [59.5892754, 25.6119856],
      [59.5878754, 25.6119856],
    ],
    [
      [59.5885054, 25.6116856],
      [59.5885054, 25.6129156],
    ],
    [
      [59.5878754, 25.6119856],
      [59.5886454, 25.6132856],
    ],
  ],
  berthPositions: {
    A: [
      [59.5882254, 25.6123156],
      [59.5881654, 25.6124356],
      [59.5881054, 25.6125556],
    ],
    B: [
      [59.5880454, 25.6126756],
      [59.5879854, 25.6127956],
      [59.5879254, 25.6129156],
      [59.5878654, 25.6130356],
    ],
    C: [
      [59.5878054, 25.6131556],
      [59.5877454, 25.6132756],
      [59.5876854, 25.6133956],
      [59.5876254, 25.6135156],
      [59.5875654, 25.6136356],
    ],
  },
  fuelDock: [59.5884654, 25.6129156],
  reverseBoatOrder: false,
};

function isLatLon(pt) {
  return Array.isArray(pt)
    && pt.length === 2
    && Number.isFinite(Number(pt[0]))
    && Number.isFinite(Number(pt[1]));
}

function clampPt(pt) {
  return [Number(pt[0]), Number(pt[1])];
}

function cleanLine(line) {
  if (!Array.isArray(line)) return null;
  const out = line.filter(isLatLon).map(clampPt);
  return out.length >= 2 ? out : null;
}

function cleanBerths(raw, fallback) {
  const out = { A: [], B: [], C: [] };
  for (const k of ["A", "B", "C"]) {
    const arr = Array.isArray(raw?.[k]) ? raw[k] : fallback[k];
    out[k] = arr.filter(isLatLon).map(clampPt);
  }
  return out;
}

function sanitizeLayout(raw) {
  const src = raw && typeof raw === "object" ? raw : {};

  const center = isLatLon(src.center) ? clampPt(src.center) : DEFAULT_LAYOUT.center;

  const pierLines = Array.isArray(src.pierLines)
    ? src.pierLines.map(cleanLine).filter(Boolean)
    : DEFAULT_LAYOUT.pierLines;

  const berthPositions = cleanBerths(src.berthPositions, DEFAULT_LAYOUT.berthPositions);
  const fuelDock = isLatLon(src.fuelDock) ? clampPt(src.fuelDock) : DEFAULT_LAYOUT.fuelDock;
  const reverseBoatOrder = !!src.reverseBoatOrder;

  if (pierLines.length === 0) {
    return DEFAULT_LAYOUT;
  }

  return {
    center,
    pierLines,
    berthPositions,
    fuelDock,
    reverseBoatOrder,
  };
}

async function getStoredLayout() {
  const v = await redis.get(KEY);
  if (!v) return DEFAULT_LAYOUT;
  if (typeof v === "object") return sanitizeLayout(v);
  try {
    return sanitizeLayout(JSON.parse(v));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const layout = await getStoredLayout();
    return res.status(200).json({ layout });
  }

  if (req.method === "POST") {
    const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!session?.email || !isSuperAdmin(session.email)) {
      return res.status(401).json({ error: "super-admin required" });
    }

    const layout = sanitizeLayout(req.body?.layout);
    await redis.set(KEY, layout);
    return res.status(200).json({ ok: true, layout });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
