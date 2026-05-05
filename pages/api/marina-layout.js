import { Redis } from "../../lib/redis";
import { verifySession, SESSION_COOKIE_NAME } from "../../lib/auth";
import { isSuperAdmin } from "../../lib/owners";

const redis = new Redis();
const KEY = "hara:marina-layout:v1";

const DEFAULT_BERTH_POINTS = {
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
};

function createDefaultDocks() {
  return ["A", "B", "C"].map((id) => ({
    id,
    name: id,
    berthMode: "single",
    enabled: true,
    headingDeg: 270,
  }));
}

function createDefaultBerths() {
  return Object.entries(DEFAULT_BERTH_POINTS).flatMap(([dockId, points]) => (
    points.map((pos, index) => ({
      id: `${dockId}-${index + 1}`,
      dockId,
      label: `${dockId}${index + 1}`,
      side: "primary",
      enabled: true,
      pos,
      headingDeg: null,
    }))
  ));
}

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
  docks: createDefaultDocks(),
  berths: createDefaultBerths(),
  fuelDock: [59.5884654, 25.6129156],
  reverseBoatOrder: false,
  boatOrder: null,
  boatHeadingOverrides: {},
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function normText(value, fallback, max = 32) {
  const text = String(value ?? "").trim().slice(0, max);
  return text || fallback;
}

function normId(value, fallback) {
  const text = String(value ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  return text || fallback;
}

function normalizeDeg(value, fallback = 270) {
  const deg = Number(value);
  if (!Number.isFinite(deg)) return fallback;
  return (((deg % 360) + 360) % 360);
}

function cleanBoatHeadingOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    const numKey = Number(key);
    const deg = Number(value);
    if (!Number.isFinite(numKey) || !Number.isFinite(deg)) continue;
    out[String(numKey)] = normalizeDeg(deg);
  }
  return out;
}

function cleanBoatOrder(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length ? out : null;
}

function cleanDocks(raw, fallback) {
  const source = Array.isArray(raw) && raw.length ? raw : fallback;
  const seen = new Set();
  const out = [];
  for (const entry of source) {
    const id = normId(entry?.id, `dock-${out.length + 1}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: normText(entry?.name, id, 24),
      berthMode: entry?.berthMode === "double" ? "double" : "single",
      enabled: entry?.enabled !== false,
      bookable: entry?.bookable === true,
      headingDeg: normalizeDeg(entry?.headingDeg, 270),
      defaultMaxLengthM: Number.isFinite(Number(entry?.defaultMaxLengthM)) && Number(entry?.defaultMaxLengthM) > 0 ? Math.round(Number(entry?.defaultMaxLengthM) * 100) / 100 : null,
      defaultMaxBeamM: Number.isFinite(Number(entry?.defaultMaxBeamM)) && Number(entry?.defaultMaxBeamM) > 0 ? Math.round(Number(entry?.defaultMaxBeamM) * 100) / 100 : null,
      defaultMaxDraftM: Number.isFinite(Number(entry?.defaultMaxDraftM)) && Number(entry?.defaultMaxDraftM) > 0 ? Math.round(Number(entry?.defaultMaxDraftM) * 100) / 100 : null,
      sideOffsetM: Number.isFinite(Number(entry?.sideOffsetM)) && Number(entry?.sideOffsetM) > 0 ? Math.round(Number(entry?.sideOffsetM) * 100) / 100 : null,
    });
  }
  return out.length ? out : clone(fallback);
}

function cleanBerths(raw, fallback, dockIds) {
  const source = Array.isArray(raw) && raw.length ? raw : fallback;
  const seen = new Set();
  const out = [];
  for (const entry of source) {
    const dockId = normId(entry?.dockId, "");
    if (!dockIds.has(dockId)) continue;
    const id = normId(entry?.id, `${dockId}-${out.length + 1}`);
    if (seen.has(id)) continue;
    if (!isLatLon(entry?.pos)) continue;
    seen.add(id);
    const headingDeg = entry?.headingDeg === null || entry?.headingDeg === "" || entry?.headingDeg === undefined
      ? null
      : normalizeDeg(entry?.headingDeg, 270);
    const numOrNull = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
    };
    out.push({
      id,
      dockId,
      label: normText(entry?.label, id, 24),
      side: entry?.side === "secondary" ? "secondary" : "primary",
      enabled: entry?.enabled !== false,
      pos: clampPt(entry.pos),
      headingDeg,
      maxLengthM: numOrNull(entry?.maxLengthM),
      maxBeamM: numOrNull(entry?.maxBeamM),
      maxDraftM: numOrNull(entry?.maxDraftM),
      occupied: entry?.occupied === true,
      guestLabel: typeof entry?.guestLabel === "string" ? entry.guestLabel.trim().slice(0, 32) : "",
    });
  }
  return out.length ? out : clone(fallback);
}

function legacyToDynamic(src) {
  const defaults = clone(DEFAULT_LAYOUT);
  const berthPositions = src?.berthPositions && typeof src.berthPositions === "object"
    ? src.berthPositions
    : DEFAULT_BERTH_POINTS;
  const dockHeadingDeg = src?.dockHeadingDeg && typeof src.dockHeadingDeg === "object"
    ? src.dockHeadingDeg
    : {};
  const dockIds = Object.keys(berthPositions).filter((dockId) => Array.isArray(berthPositions[dockId]) && berthPositions[dockId].length);
  const docks = dockIds.length ? dockIds : ["A", "B", "C"];
  defaults.docks = docks.map((id) => ({
    id,
    name: id,
    berthMode: "single",
    enabled: true,
    headingDeg: normalizeDeg(dockHeadingDeg?.[id], 270),
  }));
  defaults.berths = defaults.docks.flatMap((dock) => (
    (Array.isArray(berthPositions[dock.id]) && berthPositions[dock.id].length ? berthPositions[dock.id] : DEFAULT_BERTH_POINTS[dock.id] || [])
      .filter(isLatLon)
      .map((pos, index) => ({
        id: `${dock.id}-${index + 1}`,
        dockId: dock.id,
        label: `${dock.id}${index + 1}`,
        side: "primary",
        enabled: true,
        pos: clampPt(pos),
        headingDeg: null,
      }))
  ));
  return defaults;
}

function sanitizeLayout(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = src.docks || src.berths ? clone(DEFAULT_LAYOUT) : legacyToDynamic(src);

  const center = isLatLon(src.center) ? clampPt(src.center) : base.center;

  const pierLines = Array.isArray(src.pierLines)
    ? src.pierLines.map(cleanLine).filter(Boolean)
    : base.pierLines;

  const docks = cleanDocks(src.docks, base.docks);
  const dockIds = new Set(docks.map((dock) => dock.id));
  const berths = cleanBerths(src.berths, base.berths, dockIds);
  const fuelDock = isLatLon(src.fuelDock) ? clampPt(src.fuelDock) : base.fuelDock;
  const reverseBoatOrder = !!src.reverseBoatOrder;
  const boatOrder = cleanBoatOrder(src.boatOrder);
  const boatHeadingOverrides = cleanBoatHeadingOverrides(src.boatHeadingOverrides);

  if (pierLines.length === 0) {
    return clone(DEFAULT_LAYOUT);
  }

  return {
    center,
    pierLines,
    docks,
    berths,
    fuelDock,
    reverseBoatOrder,
    boatOrder,
    boatHeadingOverrides,
  };
}

async function getStoredLayout() {
  const value = await redis.get(KEY);
  if (!value) return clone(DEFAULT_LAYOUT);
  if (typeof value === "object") return sanitizeLayout(value);
  try {
    return sanitizeLayout(JSON.parse(value));
  } catch {
    return clone(DEFAULT_LAYOUT);
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