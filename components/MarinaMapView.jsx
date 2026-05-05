import { useEffect, useMemo, useState } from "react";
import { divIcon } from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMapEvents } from "react-leaflet";
import BoatWindRose from "./BoatWindRose";
import WindCanvas from "./WindCanvas";

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

function keyFor(boat) {
  return `boat-${boat.id}`;
}

function boatSlug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

function shiftedPoint(point, dLat, dLon) {
  return [point[0] + dLat, point[1] + dLon];
}

function shiftMeters(point, northMeters, eastMeters) {
  const lat = Number(point?.[0]) || DEFAULT_LAYOUT.center[0];
  const lon = Number(point?.[1]) || DEFAULT_LAYOUT.center[1];
  const dLat = northMeters / 111320;
  const dLon = eastMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

function normalizeDeg(value, fallback = 270) {
  const deg = Number(value);
  if (!Number.isFinite(deg)) return fallback;
  return (((deg % 360) + 360) % 360);
}

function rotatePoint([lat, lon], [aLat, aLon], deg) {
  const t = (deg * Math.PI) / 180;
  const dLat = lat - aLat;
  const dLon = lon - aLon;
  const rLat = dLat * Math.cos(t) - dLon * Math.sin(t);
  const rLon = dLat * Math.sin(t) + dLon * Math.cos(t);
  return [aLat + rLat, aLon + rLon];
}

function getDocks(layout) {
  return Array.isArray(layout?.docks) && layout.docks.length ? layout.docks : createDefaultDocks();
}

function getBerths(layout) {
  return Array.isArray(layout?.berths) && layout.berths.length ? layout.berths : createDefaultBerths();
}

function orderedBerthSlots(layout) {
  const docks = getDocks(layout);
  const berths = getBerths(layout);
  const out = [];
  for (const dock of docks) {
    for (const berth of berths) {
      if (berth.dockId !== dock.id) continue;
      if (dock.enabled === false || berth.enabled === false) continue;
      out.push({
        berthId: berth.id,
        dockId: dock.id,
        dockName: dock.name || dock.id,
        dockBookable: dock.bookable === true,
        label: berth.label || berth.id,
        side: berth.side || "primary",
        pos: berth.pos,
        headingDeg: Number.isFinite(berth.headingDeg) ? berth.headingDeg : dock.headingDeg,
        maxLengthM: Number.isFinite(berth.maxLengthM) ? berth.maxLengthM : (Number.isFinite(dock.defaultMaxLengthM) ? dock.defaultMaxLengthM : null),
        maxBeamM: Number.isFinite(berth.maxBeamM) ? berth.maxBeamM : (Number.isFinite(dock.defaultMaxBeamM) ? dock.defaultMaxBeamM : null),
        maxDraftM: Number.isFinite(berth.maxDraftM) ? berth.maxDraftM : (Number.isFinite(dock.defaultMaxDraftM) ? dock.defaultMaxDraftM : null),
      });
    }
  }
  return out;
}

function orderedBoats(layout, boats) {
  const list = Array.isArray(boats) ? boats : [];
  const explicit = Array.isArray(layout?.boatOrder) ? layout.boatOrder : null;
  if (explicit?.length) {
    const byId = new Map(list.map((boat) => [boat.id, boat]));
    const seen = new Set();
    const out = [];
    for (const id of explicit) {
      const boat = byId.get(id);
      if (!boat || seen.has(id)) continue;
      seen.add(id);
      out.push(boat);
    }
    for (const boat of list) {
      if (seen.has(boat.id)) continue;
      out.push(boat);
    }
    return out;
  }
  return layout?.reverseBoatOrder ? [...list].reverse() : list;
}

function moveBoatOrder(layout, dragBoatId, targetBoatId) {
  if (dragBoatId == null || targetBoatId == null || dragBoatId === targetBoatId) return layout;
  const order = Array.isArray(layout?.boatOrder) ? [...layout.boatOrder] : [];
  const from = order.indexOf(dragBoatId);
  const to = order.indexOf(targetBoatId);
  if (from < 0 || to < 0) return layout;
  const nextOrder = [...order];
  const [item] = nextOrder.splice(from, 1);
  nextOrder.splice(to, 0, item);
  return { ...layout, boatOrder: nextOrder, reverseBoatOrder: false };
}

function assignBoatToBerth(layout, boats, boatId, berthId) {
  if (boatId == null) return layout;
  const slots = orderedBerthSlots(layout);
  const targetIdx = slots.findIndex((slot) => slot.berthId === berthId);
  if (targetIdx < 0) return layout;
  const ordered = orderedBoats(layout, boats);
  const order = ordered.map((b) => b.id);
  const from = order.indexOf(boatId);
  if (from < 0) return layout;
  const [item] = order.splice(from, 1);
  const insertAt = Math.min(targetIdx, order.length);
  order.splice(insertAt, 0, item);
  return { ...layout, boatOrder: order, reverseBoatOrder: false };
}

function boatHeadingDeg(layout, boat, slot) {
  const override = layout?.boatHeadingOverrides?.[String(boat?.id || "")];
  if (Number.isFinite(override)) return override;
  if (Number.isFinite(slot?.headingDeg)) return slot.headingDeg;
  return 270;
}

function applyToBerths(layout, target, transform) {
  const next = cloneLayout(layout);
  next.berths = getBerths(next).map((berth) => {
    const matches = target === "berths-all"
      || (target.startsWith("dock:") && berth.dockId === target.slice(5))
      || (target.startsWith("berth:") && berth.id === target.slice(6));
    if (!matches) return berth;
    return transform(berth);
  });
  return next;
}

function shiftLayout(layout, target, dLat, dLon) {
  const next = cloneLayout(layout);
  if (target === "center") next.center = shiftedPoint(next.center, dLat, dLon);
  if (target === "piers") next.pierLines = next.pierLines.map((line) => line.map((point) => shiftedPoint(point, dLat, dLon)));
  if (target === "fuel") next.fuelDock = shiftedPoint(next.fuelDock, dLat, dLon);
  if (target === "berths-all" || target.startsWith("dock:") || target.startsWith("berth:")) {
    return applyToBerths(next, target, (berth) => ({ ...berth, pos: shiftedPoint(berth.pos, dLat, dLon) }));
  }
  return next;
}

function rotateBerthRows(layout, target, deg) {
  const next = cloneLayout(layout);
  const berths = getBerths(next);
  const selected = berths.filter((berth) => (
    target === "berths-all"
      || (target.startsWith("dock:") && berth.dockId === target.slice(5))
      || (target.startsWith("berth:") && berth.id === target.slice(6))
  ));
  if (!selected.length) return next;
  const anchor = selected[0].pos;
  next.berths = berths.map((berth) => {
    const hit = selected.some((item) => item.id === berth.id);
    if (!hit) return berth;
    return { ...berth, pos: rotatePoint(berth.pos, anchor, deg) };
  });
  return next;
}

function updateHeading(layout, target, deltaDeg, boatId) {
  const next = cloneLayout(layout);
  next.boatHeadingOverrides = { ...(next.boatHeadingOverrides || {}) };
  next.docks = getDocks(next).map((dock) => {
    if (target === "dock-all" || target === `dock:${dock.id}`) {
      return { ...dock, headingDeg: normalizeDeg((dock.headingDeg || 0) + deltaDeg) };
    }
    return dock;
  });

  if (target === "boat" && boatId != null) {
    const key = String(boatId);
    const base = Number.isFinite(next.boatHeadingOverrides[key]) ? next.boatHeadingOverrides[key] : 270;
    next.boatHeadingOverrides[key] = normalizeDeg(base + deltaDeg);
  }
  return next;
}

function boatScaleForZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(0.45, Math.min(1, 0.45 + (zoom - 14) * 0.11));
}

function boatMarkerIcon(color, isSelected, headingDeg, zoom) {
  const stroke = isSelected ? "#f0c040" : "rgba(255,255,255,0.82)";
  const strokeWidth = isSelected ? 2.5 : 1.2;
  const scale = boatScaleForZoom(zoom);
  const width = Math.round(80 * scale);
  const height = Math.round(32 * scale);
  const rotationDeg = (((Number(headingDeg) || 270) - 270) % 360 + 360) % 360;
  const shadow = isSelected
    ? "drop-shadow(0 0 7px rgba(240,192,64,0.75))"
    : "drop-shadow(0 1px 3px rgba(0,0,0,0.45))";

  return divIcon({
    className: "hara-boat-marker",
    html: `
      <div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;pointer-events:none;transform:rotate(${rotationDeg}deg);transform-origin:50% 50%;">
        <svg width="${width}" height="${height}" viewBox="0 0 80 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
          <g transform="translate(80,0) scale(-1,1)">
            <path d="M6 16 C6 16 18 4 50 4 L74 10 L76 16 L74 22 L50 28 C18 28 6 16 6 16Z"
              fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" style="filter:${shadow};" />
            <path d="M12 16 L70 16" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="4,3"/>
            <line x1="38" y1="7" x2="38" y2="25" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>
            <ellipse cx="58" cy="16" rx="9" ry="5.5" fill="rgba(0,0,0,0.28)"/>
          </g>
        </svg>
      </div>
    `,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
  });
}

function MapZoomTracker({ onZoomChange }) {
  useMapEvents({
    zoomend: (event) => onZoomChange(event.target.getZoom()),
  });
  return null;
}

function MapClickTracker({ onMapClick }) {
  useMapEvents({
    click: (event) => onMapClick?.(event.latlng),
  });
  return null;
}

function dockMarkerIcon(label, selected) {
  const border = selected ? "rgba(240,192,64,0.95)" : "rgba(126,171,200,0.78)";
  const bg = selected ? "rgba(240,192,64,0.2)" : "rgba(8,24,40,0.72)";
  const color = selected ? "#f0c040" : "#9ec8e0";
  return divIcon({
    className: "hara-dock-marker",
    html: `<div style="min-width:18px;height:18px;padding:0 5px;display:flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid ${border};background:${bg};color:${color};font-size:10px;font-weight:700;letter-spacing:0.6px;">${label}</div>`,
    iconSize: [28, 18],
    iconAnchor: [14, 9],
  });
}

function guestBerthIcon(state, headingDeg, zoom) {
  // state: 'home-away' | 'guest-occupied' | 'guest-free'
  const scale = boatScaleForZoom(zoom);
  const width = Math.round(72 * scale);
  const height = Math.round(28 * scale);
  const rotationDeg = (((Number(headingDeg) || 270) - 270) % 360 + 360) % 360;
  const styles = {
    "home-away": {
      fill: "rgba(160,180,200,0.45)",
      stroke: "rgba(255,255,255,0.7)",
      dash: "4,3",
      label: "",
      labelColor: "#fff",
      opacity: 1,
    },
    "guest-occupied": {
      fill: "rgba(80,160,210,0.85)",
      stroke: "#dcecf5",
      dash: "",
      label: "G",
      labelColor: "#fff",
      opacity: 1,
    },
    "guest-free": {
      fill: "rgba(120,200,140,0.35)",
      stroke: "rgba(180,235,200,0.95)",
      dash: "",
      label: "✓",
      labelColor: "#dff5e2",
      opacity: 1,
    },
  };
  const s = styles[state] || styles["home-away"];
  const labelSvg = s.label
    ? `<text x="50%" y="58%" text-anchor="middle" font-size="11" font-weight="700" fill="${s.labelColor}" transform="scale(-1,1) translate(-80,0)">${s.label}</text>`
    : "";
  return divIcon({
    className: "hara-guest-marker",
    html: `
      <div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;pointer-events:auto;transform:rotate(${rotationDeg}deg);transform-origin:50% 50%;opacity:${s.opacity};">
        <svg width="${width}" height="${height}" viewBox="0 0 80 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
          <g transform="translate(80,0) scale(-1,1)">
            <path d="M6 16 C6 16 18 4 50 4 L74 10 L76 16 L74 22 L50 28 C18 28 6 16 6 16Z"
              fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.4" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} />
            ${labelSvg}
          </g>
        </svg>
      </div>
    `,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
  });
}

function nextDockId(docks) {
  const used = new Set((docks || []).map((dock) => String(dock.id)));
  for (let i = 0; i < 26; i += 1) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  let idx = 1;
  while (used.has(`D${idx}`)) idx += 1;
  return `D${idx}`;
}

function averagePoint(points) {
  if (!points.length) return DEFAULT_LAYOUT.center;
  const sums = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [sums[0] / points.length, sums[1] / points.length];
}

function vectorBetween(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function inferDockStep(layout, dockId) {
  const berths = getBerths(layout).filter((berth) => berth.dockId === dockId);
  if (berths.length >= 2) return vectorBetween(berths[berths.length - 1].pos, berths[berths.length - 2].pos);
  return [-0.00006, 0.00012];
}

// Unit step (lat,lng delta) of `meters` along a dock's heading axis.
// Dock heading is the boat-bow direction; the dock LINE itself runs perpendicular
// to that (heading - 90°), so we use that bearing to step from berth to berth.
function dockAxisStep(layout, dockId, meters) {
  const dock = getDocks(layout).find((d) => d.id === dockId);
  const headingDeg = Number.isFinite(dock?.headingDeg) ? dock.headingDeg : 270;
  const lineBearing = (((headingDeg - 90) % 360) + 360) % 360;
  const rad = (lineBearing * Math.PI) / 180;
  const center = dockCenter(layout, dockId) || DEFAULT_LAYOUT.center;
  const lat = Number(center?.[0]) || DEFAULT_LAYOUT.center[0];
  const dLat = (meters * Math.cos(rad)) / 111320;
  const dLon = (meters * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [dLat, dLon];
}

// Re-position every berth in `dockId` as a clean column (single-sided) or two
// parallel columns (two-sided), evenly spaced along the dock heading axis.
// Preserves per-berth metadata (label, occupancy, size limits, side), only
// rewrites `pos`. Anchored on the current dock center so the dock stays put.
function arrangeBerthsAlongDock(layout, dockId, { spacingM, sideOffsetM = 4 } = {}) {
  const next = cloneLayout(layout);
  const dock = getDocks(next).find((d) => d.id === dockId);
  if (!dock) return next;
  const spacing = Number.isFinite(spacingM)
    ? spacingM
    : (Number.isFinite(dock.berthSpacingM) ? dock.berthSpacingM : 5);
  const dockBerths = getBerths(next).filter((b) => b.dockId === dockId);
  if (!dockBerths.length) return next;
  const isDouble = dock.berthMode === "double";
  const center = dockCenter(next, dockId);
  const along = dockAxisStep(next, dockId, spacing);
  const alongVec = [along[0], along[1]];
  // Build a unit-direction vector for perpendicular offset (re-uses
  // offsetFromVector with `lineVec` = along-dock). offsetFromVector needs
  // a non-zero vector and returns a perpendicular shift in meters.
  const primarySrc = isDouble ? dockBerths.filter((b) => b.side !== "secondary") : dockBerths;
  const secondarySrc = isDouble ? dockBerths.filter((b) => b.side === "secondary") : [];
  // Number of rows along the dock = max columns count. For mixed counts the
  // shorter side just leaves trailing rows empty on that side.
  const rows = Math.max(primarySrc.length, secondarySrc.length, 1);
  const denom = Math.max(1, rows - 1);
  const startOffset = -(rows - 1) / 2;
  const rowPos = Array.from({ length: rows }, (_, idx) => {
    const k = startOffset + idx;
    return [center[0] + alongVec[0] * k, center[1] + alongVec[1] * k];
  });
  const updates = new Map();
  primarySrc.forEach((berth, idx) => {
    const base = rowPos[idx] || rowPos[rowPos.length - 1];
    const pos = isDouble ? offsetFromVector(base, alongVec, sideOffsetM, -1) : base;
    updates.set(berth.id, pos);
  });
  secondarySrc.forEach((berth, idx) => {
    const base = rowPos[idx] || rowPos[rowPos.length - 1];
    const pos = offsetFromVector(base, alongVec, sideOffsetM, 1);
    updates.set(berth.id, pos);
  });
  next.berths = getBerths(next).map((b) => (
    updates.has(b.id) ? { ...b, pos: updates.get(b.id) } : b
  ));
  return next;
}

function offsetFromVector(point, vector, meters, direction) {
  const len = Math.hypot(vector[0], vector[1]) || 1;
  const normal = [-(vector[1] / len), vector[0] / len];
  const latMeters = normal[0] * meters * direction;
  const lonMeters = normal[1] * meters * direction;
  return shiftMeters(point, latMeters, lonMeters);
}

function addDock(layout) {
  const next = cloneLayout(layout);
  const docks = getDocks(next);
  const berths = getBerths(next);
  const id = nextDockId(docks);
  const lastDock = docks[docks.length - 1];
  const lastDockBerths = berths.filter((berth) => berth.dockId === lastDock?.id);
  const basePoint = lastDockBerths.length
    ? averagePoint(lastDockBerths.map((berth) => berth.pos))
    : next.center;
  const firstPos = shiftMeters(basePoint, -14, 20);
  next.docks = [
    ...docks,
    { id, name: id, berthMode: "single", enabled: true, headingDeg: lastDock?.headingDeg ?? 270 },
  ];
  next.berths = [
    ...berths,
    { id: `${id}-1`, dockId: id, label: `${id}1`, side: "primary", enabled: true, pos: firstPos, headingDeg: null },
  ];
  return next;
}

function addBerth(layout, dockId) {
  const next = cloneLayout(layout);
  const dock = getDocks(next).find((item) => item.id === dockId);
  if (!dock) return next;
  const berths = getBerths(next);
  const dockBerths = berths.filter((berth) => berth.dockId === dockId);
  const mode = dock.berthMode || "single";
  const primary = dockBerths.filter((berth) => berth.side !== "secondary");
  const secondary = dockBerths.filter((berth) => berth.side === "secondary");
  // For two-sided docks alternate sides so columns grow evenly. For one-sided,
  // always primary.
  const side = mode === "double" && secondary.length < primary.length ? "secondary" : "primary";
  const spacing = Number.isFinite(dock.berthSpacingM) ? dock.berthSpacingM : 5;
  const sideOffset = 4;
  const along = dockAxisStep(next, dockId, spacing);
  let pos;
  if (side === "secondary") {
    // Place this secondary opposite the matching primary (same row index).
    const rowIdx = secondary.length;
    const anchor = primary[Math.min(rowIdx, primary.length - 1)]?.pos
      || dockCenter(next, dockId)
      || DEFAULT_LAYOUT.center;
    pos = offsetFromVector(anchor, along, sideOffset, 1);
  } else if (primary.length) {
    // Step along the dock axis from the last primary berth.
    const last = primary[primary.length - 1].pos;
    pos = [last[0] + along[0], last[1] + along[1]];
    if (mode === "double") pos = offsetFromVector(pos, along, sideOffset, -1);
  } else {
    // First berth on the dock — anchor at dock center, offset to its side if double.
    const center = dockCenter(next, dockId) || DEFAULT_LAYOUT.center;
    pos = mode === "double" ? offsetFromVector(center, along, sideOffset, -1) : center;
  }
  const idx = dockBerths.length + 1;
  next.berths = [
    ...berths,
    { id: `${dockId}-${idx}`, dockId, label: `${dock.name || dockId}${idx}`, side, enabled: true, pos, headingDeg: null },
  ];
  return next;
}

function removeDock(layout, dockId) {
  const next = cloneLayout(layout);
  next.docks = getDocks(next).filter((dock) => dock.id !== dockId);
  next.berths = getBerths(next).filter((berth) => berth.dockId !== dockId);
  return next;
}

function removeBerth(layout, berthId) {
  const next = cloneLayout(layout);
  next.berths = getBerths(next).filter((berth) => berth.id !== berthId);
  return next;
}

function updateDockField(layout, dockId, patch) {
  const next = cloneLayout(layout);
  next.docks = getDocks(next).map((dock) => {
    if (dock.id !== dockId) return dock;
    return { ...dock, ...patch };
  });
  if (patch.berthMode === "single") {
    next.berths = getBerths(next).map((berth) => (
      berth.dockId === dockId ? { ...berth, side: "primary" } : berth
    ));
    return arrangeBerthsAlongDock(next, dockId);
  }
  if (patch.berthMode === "double") {
    // Re-distribute existing berths into two columns (primary on one side,
    // secondary on the other) so the visual matches the new mode.
    const dockBerths = getBerths(next).filter((b) => b.dockId === dockId);
    next.berths = getBerths(next).map((berth) => {
      if (berth.dockId !== dockId) return berth;
      const idx = dockBerths.findIndex((b) => b.id === berth.id);
      return { ...berth, side: idx % 2 === 0 ? "primary" : "secondary" };
    });
    return arrangeBerthsAlongDock(next, dockId);
  }
  return next;
}

function updateBerthField(layout, berthId, patch) {
  const next = cloneLayout(layout);
  next.berths = getBerths(next).map((berth) => {
    if (berth.id !== berthId) return berth;
    return { ...berth, ...patch };
  });
  return next;
}

function dockCenter(layout, dockId) {
  const points = getBerths(layout).filter((berth) => berth.dockId === dockId).map((berth) => berth.pos);
  return averagePoint(points);
}

function bearingFromLine(start, end) {
  const lat1 = (start[0] * Math.PI) / 180;
  const lat2 = (end[0] * Math.PI) / 180;
  const dLon = ((end[1] - start[1]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function drawDockFromLine(layout, { start, end, name, berthMode, headingDeg, enabled, berthCount }) {
  const next = cloneLayout(layout);
  const docks = getDocks(next);
  const id = nextDockId(docks);
  const safeName = String(name || id).trim().slice(0, 24) || id;
  const safeMode = berthMode === "double" ? "double" : "single";
  const safeEnabled = enabled !== false;
  const count = Math.max(1, Math.min(24, Number(berthCount) || 4));
  const s = [Number(start?.lat ?? start?.[0]), Number(start?.lng ?? start?.[1])];
  const e = [Number(end?.lat ?? end?.[0]), Number(end?.lng ?? end?.[1])];
  const v = vectorBetween(e, s);
  const isTiny = Math.hypot(v[0], v[1]) < 0.00001;
  const fallbackEnd = shiftedPoint(s, -0.00012, 0.00018);
  const lineEnd = isTiny ? fallbackEnd : e;
  const lineVec = vectorBetween(lineEnd, s);
  const safeHeading = Number.isFinite(Number(headingDeg))
    ? normalizeDeg(headingDeg, 270)
    : normalizeDeg(bearingFromLine(s, lineEnd) + 90, 270);

  const primaryCount = safeMode === "double" ? Math.ceil(count / 2) : count;
  const secondaryCount = safeMode === "double" ? Math.floor(count / 2) : 0;
  const denom = Math.max(1, primaryCount - 1);
  const primary = Array.from({ length: primaryCount }, (_, idx) => {
    const ratio = primaryCount === 1 ? 0 : idx / denom;
    return [s[0] + lineVec[0] * ratio, s[1] + lineVec[1] * ratio];
  });
  const secondary = Array.from({ length: secondaryCount }, (_, idx) => {
    const anchor = primary[Math.min(idx, primary.length - 1)];
    return offsetFromVector(anchor, lineVec, 7, 1);
  });

  next.docks = [
    ...docks,
    { id, name: safeName, berthMode: safeMode, enabled: safeEnabled, headingDeg: safeHeading },
  ];

  const all = [
    ...primary.map((pos, idx) => ({ pos, side: "primary", sort: idx })),
    ...secondary.map((pos, idx) => ({ pos, side: "secondary", sort: idx })),
  ];
  const startIdx = getBerths(next).length + 1;
  const createdBerths = all.map((entry, idx) => ({
    id: `${id}-${idx + 1}`,
    dockId: id,
    label: `${safeName}${idx + 1}`,
    side: entry.side,
    enabled: true,
    pos: entry.pos,
    headingDeg: null,
    sort: startIdx + idx,
  }));
  next.berths = [...getBerths(next), ...createdBerths];
  return { layout: next, dockId: id };
}

export default function MarinaMapView({
  boats,
  selectedId,
  queuedBoatIds,
  onBoatSelect,
  layout,
  isSuperAdmin,
  onSaveLayout,
  weather,
  marinaConditions,
  boatBadges,
}) {
  const [editMode, setEditMode] = useState(false);
  const [target, setTarget] = useState("berths-all");
  const [stepDeg, setStepDeg] = useState(0.00005);
  const [rotDeg, setRotDeg] = useState(2);
  const [headingTarget, setHeadingTarget] = useState("dock-all");
  const [headingStepDeg, setHeadingStepDeg] = useState(5);
  const [headingBoatId, setHeadingBoatId] = useState(null);
  const [draft, setDraft] = useState(layout || DEFAULT_LAYOUT);
  const [saving, setSaving] = useState(false);
  const [windOpen, setWindOpen] = useState(true);
  const [showWindCanvas, setShowWindCanvas] = useState(true);
  const [zoom, setZoom] = useState(17);
  const [orderDragId, setOrderDragId] = useState(null);
  const [orderDragOverId, setOrderDragOverId] = useState(null);
  const [selectedDockId, setSelectedDockId] = useState(null);
  const [drawDockMode, setDrawDockMode] = useState(false);
  const [drawDockStart, setDrawDockStart] = useState(null);
  const [drawDockName, setDrawDockName] = useState("");
  const [drawDockModeSide, setDrawDockModeSide] = useState("single");
  const [drawDockBerthCount, setDrawDockBerthCount] = useState(4);
  const [adminTab, setAdminTab] = useState("docks");
  const [expandedDockId, setExpandedDockId] = useState(null);

  useEffect(() => {
    setDraft(layout || DEFAULT_LAYOUT);
  }, [layout]);

  useEffect(() => {
    setDraft((current) => {
      if (!current || Array.isArray(current.boatOrder)) return current;
      return { ...current, boatOrder: orderedBoats(current, boats).map((boat) => boat.id), reverseBoatOrder: false };
    });
  }, [boats, layout]);

  useEffect(() => {
    if (headingBoatId != null) return;
    if (boats[0]?.id != null) setHeadingBoatId(boats[0].id);
  }, [boats, headingBoatId]);

  const active = draft || DEFAULT_LAYOUT;
  const hasBoatWind = marinaConditions?.wind?.direction_deg != null && marinaConditions?.wind?.sample_count > 0;
  const windDirDeg = hasBoatWind ? marinaConditions.wind.direction_deg : weather?.winddirection;
  const windMs = hasBoatWind ? marinaConditions?.wind?.speed_ms : weather?.windspeed;
  const windKn = typeof windMs === "number" ? windMs * 1.94384 : null;
  const berthSlots = orderedBerthSlots(active);
  const assignedBoats = orderedBoats(active, boats);
  const docks = getDocks(active);
  const berths = getBerths(active);
  const targetOptions = useMemo(() => {
    const opts = [
      { value: "center", label: "Map center" },
      { value: "berths-all", label: "All berths" },
      { value: "piers", label: "All piers" },
      { value: "fuel", label: "Fuel dock" },
    ];
    for (const dock of docks) opts.push({ value: `dock:${dock.id}`, label: `Dock ${dock.name || dock.id}` });
    for (const berth of berths) opts.push({ value: `berth:${berth.id}`, label: `${berth.label || berth.id}` });
    return opts;
  }, [docks, berths]);
  const headingOptions = useMemo(() => {
    const opts = [{ value: "dock-all", label: "All docks" }];
    for (const dock of docks) opts.push({ value: `dock:${dock.id}`, label: `Dock ${dock.name || dock.id}` });
    opts.push({ value: "boat", label: "Individual boat" });
    return opts;
  }, [docks]);

  useEffect(() => {
    if (!docks.length) {
      setSelectedDockId(null);
      return;
    }
    if (selectedDockId && docks.some((dock) => dock.id === selectedDockId)) return;
    setSelectedDockId(docks[0].id);
  }, [docks, selectedDockId]);

  useEffect(() => {
    if (!targetOptions.some((option) => option.value === target)) setTarget("berths-all");
  }, [target, targetOptions]);

  useEffect(() => {
    if (!headingOptions.some((option) => option.value === headingTarget)) setHeadingTarget("dock-all");
  }, [headingOptions, headingTarget]);

  function onOrderDragStart(event, boatId) {
    setOrderDragId(boatId);
    setOrderDragOverId(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(boatId));
  }

  function onOrderDragOver(event, boatId) {
    event.preventDefault();
    if (boatId !== orderDragId) setOrderDragOverId(boatId);
  }

  function onOrderDrop(event, targetBoatId) {
    event.preventDefault();
    if (orderDragId == null || orderDragId === targetBoatId) {
      setOrderDragId(null);
      setOrderDragOverId(null);
      return;
    }
    setDraft((current) => moveBoatOrder(current || active, orderDragId, targetBoatId));
    setOrderDragId(null);
    setOrderDragOverId(null);
  }

  function onOrderDragEnd() {
    setOrderDragId(null);
    setOrderDragOverId(null);
  }

  function selectDock(dockId) {
    setSelectedDockId(dockId);
    setExpandedDockId(dockId);
    setTarget(`dock:${dockId}`);
    setHeadingTarget(`dock:${dockId}`);
  }

  function handleMapClick(latlng) {
    if (!isSuperAdmin || !editMode || !drawDockMode) return;
    if (!drawDockStart) {
      setDrawDockStart([latlng.lat, latlng.lng]);
      return;
    }
    const created = drawDockFromLine(active, {
      start: { lat: drawDockStart[0], lng: drawDockStart[1] },
      end: latlng,
      name: drawDockName,
      berthMode: drawDockModeSide,
      berthCount: drawDockBerthCount,
    });
    setDraft(created.layout);
    selectDock(created.dockId);
    setDrawDockName("");
    setDrawDockStart(null);
    setDrawDockMode(false);
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        position: "relative",
        background: "radial-gradient(ellipse at 20% 30%, #123550 0%, #081723 100%)",
      }}
    >
      <MapContainer
        center={active.center}
        zoom={17}
        minZoom={14}
        maxZoom={19}
        style={{ height: "100%", width: "100%", position: "relative", zIndex: 0 }}
        scrollWheelZoom
      >
        <MapZoomTracker onZoomChange={setZoom} />
        <MapClickTracker onMapClick={handleMapClick} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={19}
          maxZoom={19}
        />

        {berthSlots.map((slot, idx) => {
          const boat = assignedBoats[idx];
          if (boat) return null;
          const berth = berths.find((b) => b.id === slot.berthId);
          const bookable = slot.dockBookable;
          const occupied = bookable ? berth?.occupied === true : false;
          const guestLabel = berth?.guestLabel || "";
          // State drives icon styling:
          //   home-away      = home-fleet berth, boat is away  (solid grey silhouette)
          //   guest-occupied = bookable berth currently taken  (filled blue silhouette + G)
          //   guest-free     = bookable berth free to book     (green-tinted silhouette + ✓)
          const state = !bookable
            ? "home-away"
            : (occupied ? "guest-occupied" : "guest-free");
          const sizeBits = [];
          if (Number.isFinite(slot.maxLengthM)) sizeBits.push(`LOA ≤ ${slot.maxLengthM} m`);
          if (Number.isFinite(slot.maxBeamM)) sizeBits.push(`Beam ≤ ${slot.maxBeamM} m`);
          if (Number.isFinite(slot.maxDraftM)) sizeBits.push(`Draft ≤ ${slot.maxDraftM} m`);
          const titleText = !bookable
            ? "Home berth · boat away"
            : (occupied
              ? (guestLabel ? `Guest · ${guestLabel}` : "Guest berth · occupied")
              : "Guest berth · free to book");
          return (
            <Marker
              key={`empty-${slot.berthId}`}
              position={slot.pos}
              icon={guestBerthIcon(state, slot.headingDeg, zoom)}
              eventHandlers={{
                click: () => {
                  if (!bookable) return;
                  if (!(isSuperAdmin && editMode)) return;
                  setDraft((current) => updateBerthField(current || active, slot.berthId, { occupied: !occupied }));
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div style={{ fontSize: 11, fontWeight: "bold" }}>{titleText}</div>
                <div style={{ fontSize: 10, opacity: 0.85 }}>
                  Dock {slot.dockName} · {slot.label}
                  {slot.side === "secondary" ? " · far side" : ""}
                </div>
                {bookable && sizeBits.length ? (
                  <div style={{ fontSize: 10, marginTop: 3, color: "#2c5d3a", fontWeight: 600 }}>
                    {sizeBits.join(" · ")}
                  </div>
                ) : null}
                {bookable && isSuperAdmin && editMode ? (
                  <div style={{ fontSize: 10, marginTop: 4, color: "#1f6fa8", fontWeight: 600 }}>
                    Click → mark {occupied ? "free" : "occupied"}
                  </div>
                ) : null}
              </Tooltip>
            </Marker>
          );
        })}

        {berthSlots.map((slot, idx) => {
          const boat = assignedBoats[idx];
          if (!boat) return null;
          const isSelected = boat.id === selectedId;
          const inQueue = queuedBoatIds.has(boat.id);
          const slug = boatSlug(boat.name);
          const badge = boatBadges?.[slug] || null;
          return (
            <Marker
              key={`${keyFor(boat)}-${slot.berthId}`}
              position={slot.pos}
              icon={boatMarkerIcon(boat.color, isSelected, boatHeadingDeg(active, boat, slot), zoom)}
              eventHandlers={{
                click: () => {
                  if (isSuperAdmin && editMode) {
                    onBoatSelect(boat.id);
                    return;
                  }
                  onBoatSelect(boat.id);
                  if (typeof window !== "undefined") {
                    window.open(`/${slug}`, "_blank", "noopener,noreferrer");
                  }
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div style={{ fontSize: 11, fontWeight: "bold", letterSpacing: 0.5 }}>
                  {boat.name}
                  {badge?.online ? <span style={{ color: "#5fc37d", marginLeft: 6, fontSize: 9 }}>● live</span> : null}
                </div>
                <div style={{ fontSize: 10, opacity: 0.85 }}>
                  Dock {slot.dockName} · {slot.label}
                  {slot.side === "secondary" ? " · far side" : ""}
                  {inQueue ? " · in crane queue" : ""}
                </div>
                {badge && (
                  <div style={{ fontSize: 10, marginTop: 4, color: "#345268" }}>
                    {badge.battery_pct != null ? `Bat ${Math.round(badge.battery_pct)}%` : null}
                    {badge.shore_power != null ? `${badge.battery_pct != null ? " · " : ""}${badge.shore_power ? "Shore ⚡" : "Off-grid"}` : null}
                    {badge.bilge_cm != null ? ` · Bilge ${badge.bilge_cm} cm` : null}
                    {badge.wind_speed_kn != null ? ` · Wind ${badge.wind_speed_kn.toFixed(1)} kn` : null}
                  </div>
                )}
                <div style={{ fontSize: 10, marginTop: 4, color: "#1f6fa8", fontWeight: 600 }}>
                  Click → open boat portal
                </div>
              </Tooltip>
            </Marker>
          );
        })}

        {docks.map((dock) => {
          const center = dockCenter(active, dock.id);
          return (
            <Marker
              key={`dock-marker-${dock.id}`}
              position={center}
              icon={dockMarkerIcon(dock.name || dock.id, selectedDockId === dock.id)}
              eventHandlers={{ click: () => selectDock(dock.id) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div style={{ fontSize: 11, fontWeight: "bold" }}>Dock {dock.name || dock.id}</div>
                <div style={{ fontSize: 10, opacity: 0.85 }}>
                  {dock.berthMode === "double" ? "Two-sided" : "One-sided"} · {(dock.enabled === false) ? "disabled" : "enabled"}
                </div>
              </Tooltip>
            </Marker>
          );
        })}

        {drawDockMode && drawDockStart && (
          <Marker
            position={drawDockStart}
            icon={dockMarkerIcon("START", true)}
          >
            <Tooltip direction="top" offset={[0, -6]}>Click second point to finish dock line</Tooltip>
          </Marker>
        )}

        {drawDockMode && drawDockStart && (
          <Polyline positions={[drawDockStart, shiftedPoint(drawDockStart, -0.00012, 0.00018)]} pathOptions={{ color: "#f0c040", weight: 2, dashArray: "6,6" }} />
        )}
      </MapContainer>

      {showWindCanvas && (
        <WindCanvas
          dir={windDirDeg}
          speed={windMs}
          gust={hasBoatWind ? null : weather?.windspeedmax}
          orientation="map"
          zIndex={300}
          opacity={0.32}
        />
      )}

      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          zIndex: 500,
          background: "rgba(9, 24, 36, 0.72)",
          border: "1px solid rgba(126,171,200,0.28)",
          borderRadius: 8,
          padding: "8px 10px",
          color: "#c8e0f0",
          fontSize: 11,
          letterSpacing: 0.5,
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        Tap a berth marker to open boat details.
        {berthSlots.length < boats.length ? ` ${boats.length - berthSlots.length} boat${boats.length - berthSlots.length === 1 ? "" : "s"} currently have no berth.` : ""}
        {isSuperAdmin && editMode && drawDockMode ? " Draw mode: click map twice to create dock." : ""}
      </div>

      <div
        style={{
          position: "absolute",
          right: 14,
          top: 14,
          zIndex: 560,
          background: "rgba(9, 24, 36, 0.8)",
          border: "1px solid rgba(126,171,200,0.28)",
          borderRadius: 8,
          color: "#c8e0f0",
          width: windOpen ? 280 : 120,
          transition: "width 0.2s ease",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => setWindOpen((v) => !v)}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            color: "#c8e0f0",
            padding: "8px 10px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            letterSpacing: 1,
          }}
        >
          <span>Wind Rose</span>
          <span>{windOpen ? "▾" : "▸"}</span>
        </button>

        {windOpen && (
          <div style={{ borderTop: "1px solid rgba(126,171,200,0.15)", padding: "8px 10px 10px" }}>
            <button
              onClick={() => setShowWindCanvas((value) => !value)}
              style={{
                width: "100%",
                marginBottom: 10,
                background: showWindCanvas ? "rgba(126,171,200,0.16)" : "rgba(255,255,255,0.05)",
                color: showWindCanvas ? "#dcecf5" : "#7eabc8",
                border: "1px solid rgba(126,171,200,0.28)",
                borderRadius: 5,
                padding: "6px 8px",
                cursor: "pointer",
                fontSize: 10,
                letterSpacing: 0.7,
                textTransform: "uppercase",
              }}
            >
              Windy overlay: {showWindCanvas ? "On" : "Off"}
            </button>

            {typeof windDirDeg === "number" && typeof windKn === "number" ? (
              <>
                <BoatWindRose
                  size={248}
                  trueDirDeg={windDirDeg}
                  trueSpeedKn={windKn}
                  apparentAngle={null}
                  apparentSpeedKn={null}
                  headingDeg={null}
                  cogDeg={null}
                  centerModeLabel="M/S"
                />
                <div style={{ fontSize: 10, color: "#7eabc8", textAlign: "center", marginTop: 4 }}>
                  {hasBoatWind ? "source: marina boats" : "source: weather station"}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#7eabc8", textAlign: "center", padding: "16px 6px" }}>
                no wind data
              </div>
            )}
          </div>
        )}
      </div>

      {isSuperAdmin && (
        <div
          style={{
            position: "absolute",
            right: 14,
            top: windOpen ? 330 : 66,
            zIndex: 550,
            background: "rgba(9, 24, 36, 0.8)",
            border: "1px solid rgba(126,171,200,0.28)",
            borderRadius: 8,
            padding: 10,
            color: "#c8e0f0",
            width: 360,
            maxHeight: "calc(100% - 88px)",
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: "#7eabc8" }}>Super Admin</div>
            <button
              onClick={() => {
                setEditMode((v) => !v);
                setDraft(layout || DEFAULT_LAYOUT);
              }}
              style={{
                background: editMode ? "rgba(240,192,64,0.18)" : "rgba(255,255,255,0.06)",
                color: editMode ? "#f0c040" : "#c8e0f0",
                border: "1px solid rgba(126,171,200,0.28)",
                borderRadius: 5,
                fontSize: 10,
                cursor: "pointer",
                padding: "4px 8px",
              }}
            >
              {editMode ? "⚙ Settings open" : "⚙ Settings"}
            </button>
          </div>

          {editMode && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 12, padding: 3, background: "rgba(0,0,0,0.25)", borderRadius: 6 }}>
                {[
                  { id: "boats", label: "Boats" },
                  { id: "docks", label: "Docks" },
                  { id: "move", label: "Move" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setAdminTab(tab.id)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 4,
                      border: "none",
                      background: adminTab === tab.id ? "rgba(126,171,200,0.22)" : "transparent",
                      color: adminTab === tab.id ? "#dcecf5" : "#7eabc8",
                      padding: "5px 6px",
                      fontSize: 10,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {adminTab === "boats" && (
                <>
                  <div style={{ fontSize: 10, color: "#7eabc8", marginBottom: 8 }}>
                    Pick a berth from the dropdown to assign a boat directly, or drag a row onto another to swap.
                  </div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    {assignedBoats.map((boat, idx) => {
                      const slot = berthSlots[idx];
                      const isDragging = orderDragId === boat.id;
                      const isOver = orderDragOverId === boat.id && orderDragId !== boat.id;
                      return (
                        <div
                          key={boat.id}
                          draggable
                          onDragStart={(event) => onOrderDragStart(event, boat.id)}
                          onDragOver={(event) => onOrderDragOver(event, boat.id)}
                          onDrop={(event) => onOrderDrop(event, boat.id)}
                          onDragEnd={onOrderDragEnd}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "18px 1fr 12px",
                            gap: 6,
                            alignItems: "center",
                            padding: "6px 8px",
                            borderRadius: 6,
                            border: isOver ? "1px solid rgba(240,192,64,0.7)" : "1px solid rgba(126,171,200,0.2)",
                            background: isOver ? "rgba(240,192,64,0.12)" : "rgba(255,255,255,0.04)",
                            opacity: isDragging ? 0.45 : 1,
                            cursor: "grab",
                          }}
                        >
                          <div style={{ color: "#7eabc8", fontSize: 14, lineHeight: 1, textAlign: "center" }}>⋮⋮</div>
                          <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                            <div style={{ fontSize: 11, color: "#dcecf5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {boat.name}
                            </div>
                            <select
                              value={slot ? slot.berthId : ""}
                              onChange={(e) => {
                                const berthId = e.target.value;
                                if (!berthId) return;
                                setDraft((current) => assignBoatToBerth(current || active, boats, boat.id, berthId));
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              style={{
                                background: "#102537",
                                color: "#dcecf5",
                                border: "1px solid #36566b",
                                borderRadius: 4,
                                fontSize: 10,
                                padding: "3px 4px",
                                cursor: "pointer",
                              }}
                            >
                              {!slot && <option value="">Unassigned</option>}
                              {docks.map((dock) => {
                                const dockBerths = berths.filter((b) => b.dockId === dock.id && (b.enabled !== false) && (dock.enabled !== false));
                                if (!dockBerths.length) return null;
                                return (
                                  <optgroup key={dock.id} label={`Dock ${dock.name || dock.id}`}>
                                    {dockBerths.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.label || b.id}{b.side === "secondary" ? " (far)" : ""}
                                      </option>
                                    ))}
                                  </optgroup>
                                );
                              })}
                            </select>
                          </div>
                          <div style={{ width: 10, height: 10, borderRadius: 999, background: boat.color, boxShadow: "0 0 0 1px rgba(255,255,255,0.18)" }} />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {adminTab === "docks" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, marginBottom: 8 }}>
                    <select
                      value={selectedDockId || ""}
                      onChange={(e) => selectDock(e.target.value)}
                      style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                    >
                      {docks.map((dock) => (
                        <option key={dock.id} value={dock.id}>Dock {dock.name || dock.id}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        setDrawDockMode((value) => !value);
                        setDrawDockStart(null);
                      }}
                      style={{
                        cursor: "pointer",
                        borderRadius: 4,
                        border: "1px solid rgba(126,171,200,0.25)",
                        background: drawDockMode ? "rgba(240,192,64,0.2)" : "rgba(255,255,255,0.05)",
                        color: drawDockMode ? "#f0c040" : "#dcecf5",
                        padding: "4px 8px",
                        fontSize: 10,
                      }}
                    >
                      {drawDockMode ? "Cancel" : "Draw"}
                    </button>
                    <button
                      onClick={() => setDraft((current) => addDock(current || active))}
                      style={{ cursor: "pointer", borderRadius: 4, border: "1px solid rgba(126,171,200,0.25)", background: "rgba(255,255,255,0.05)", color: "#dcecf5", padding: "4px 8px", fontSize: 10 }}
                    >
                      + New
                    </button>
                  </div>

                  {drawDockMode && (
                    <div style={{ border: "1px solid rgba(240,192,64,0.4)", background: "rgba(240,192,64,0.08)", borderRadius: 6, padding: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: "#f0c040", marginBottom: 6 }}>
                        {drawDockStart ? "Click second point on map to finish." : "Click start point on map."}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px", gap: 6 }}>
                        <input
                          value={drawDockName}
                          onChange={(e) => setDrawDockName(e.target.value.slice(0, 24))}
                          placeholder="Dock name (optional)"
                          style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                        />
                        <select
                          value={drawDockModeSide}
                          onChange={(e) => setDrawDockModeSide(e.target.value)}
                          style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                        >
                          <option value="single">One-sided</option>
                          <option value="double">Two-sided</option>
                        </select>
                        <input
                          type="number"
                          min="1"
                          max="24"
                          value={drawDockBerthCount}
                          onChange={(e) => setDrawDockBerthCount(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
                          title="Number of berths"
                          style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                        />
                      </div>
                    </div>
                  )}

                  {(() => {
                    const dock = docks.find((d) => d.id === selectedDockId) || docks[0];
                    if (!dock) {
                      return <div style={{ fontSize: 10, color: "#7eabc8" }}>No docks. Use Draw or + New to create one.</div>;
                    }
                    const dockBerths = berths.filter((berth) => berth.dockId === dock.id);
                    const isExpanded = expandedDockId === dock.id;
                    return (
                      <div style={{ border: "1px solid rgba(126,171,200,0.18)", borderRadius: 6, padding: 8, background: "rgba(255,255,255,0.03)", marginBottom: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 6, marginBottom: 6 }}>
                          <input
                            value={dock.name || ""}
                            onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { name: e.target.value.slice(0, 24) || dock.id }))}
                            placeholder="Dock name"
                            style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                          />
                          <select
                            value={dock.berthMode || "single"}
                            onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { berthMode: e.target.value }))}
                            style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                          >
                            <option value="single">One-sided</option>
                            <option value="double">Two-sided</option>
                          </select>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, fontSize: 10, color: "#7eabc8", flexWrap: "wrap" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={dock.enabled !== false}
                              onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { enabled: e.target.checked }))}
                            />
                            Enabled
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, color: dock.bookable ? "#f0c040" : "#7eabc8" }} title="Bookable docks treat berths as guest/transient. Free berths show a dashed silhouette; occupied berths show a solid grey 'G' boat. Home docks are always rendered occupied unless a tracked boat is assigned.">
                            <input
                              type="checkbox"
                              checked={dock.bookable === true}
                              onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { bookable: e.target.checked }))}
                            />
                            Bookable (guest)
                          </label>
                          <span>Heading {Math.round(dock.headingDeg ?? 270)}°</span>
                          <span>{dockBerths.length} berth{dockBerths.length === 1 ? "" : "s"}</span>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "auto 90px auto", gap: 6, alignItems: "center", marginBottom: 8, fontSize: 10, color: "#7eabc8" }} title="Distance (in metres) between adjacent berth centres along the dock. Smaller = boats packed tighter. Typical: 4–6 m for beam-to-dock berths, 12–14 m for stern-to-dock with finger piers.">
                          <span>Berth spacing:</span>
                          <input
                            type="number" min="1" step="0.5"
                            value={Number.isFinite(dock.berthSpacingM) ? dock.berthSpacingM : ""}
                            onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { berthSpacingM: e.target.value === "" ? null : Number(e.target.value) }))}
                            placeholder="5"
                            style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "2px 4px" }}
                          />
                          <span>m (apply with Auto-arrange)</span>
                        </div>

                        {dock.bookable && (
                          <div style={{ display: "grid", gridTemplateColumns: "auto repeat(3, 1fr)", gap: 4, alignItems: "center", marginBottom: 8, fontSize: 10, color: "#7eabc8" }} title="Default size limits inherited by all berths in this dock unless overridden per-berth.">
                            <span>Defaults (m):</span>
                            <input
                              type="number" min="0" step="0.1"
                              value={Number.isFinite(dock.defaultMaxLengthM) ? dock.defaultMaxLengthM : ""}
                              onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { defaultMaxLengthM: e.target.value === "" ? null : Number(e.target.value) }))}
                              placeholder="LOA"
                              style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "2px 4px" }}
                            />
                            <input
                              type="number" min="0" step="0.1"
                              value={Number.isFinite(dock.defaultMaxBeamM) ? dock.defaultMaxBeamM : ""}
                              onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { defaultMaxBeamM: e.target.value === "" ? null : Number(e.target.value) }))}
                              placeholder="Beam"
                              style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "2px 4px" }}
                            />
                            <input
                              type="number" min="0" step="0.1"
                              value={Number.isFinite(dock.defaultMaxDraftM) ? dock.defaultMaxDraftM : ""}
                              onChange={(e) => setDraft((current) => updateDockField(current || active, dock.id, { defaultMaxDraftM: e.target.value === "" ? null : Number(e.target.value) }))}
                              placeholder="Draft"
                              style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "2px 4px" }}
                            />
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <button
                            onClick={() => setExpandedDockId(isExpanded ? null : dock.id)}
                            style={{ background: "transparent", border: "none", color: "#7eabc8", cursor: "pointer", fontSize: 10, padding: 0 }}
                          >
                            {isExpanded ? "▾ Hide berths" : "▸ Show berths"}
                          </button>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => setDraft((current) => arrangeBerthsAlongDock(current || active, dock.id))}
                              title={dock.berthMode === "double" ? "Re-snap berths into two parallel columns along the dock heading" : "Re-snap berths into a single column along the dock heading"}
                              style={{ cursor: "pointer", borderRadius: 4, border: "1px solid rgba(126,171,200,0.25)", background: "rgba(255,255,255,0.05)", color: "#dcecf5", padding: "3px 7px", fontSize: 10 }}
                            >
                              Auto-arrange
                            </button>
                            <button
                              onClick={() => setDraft((current) => addBerth(current || active, dock.id))}
                              style={{ cursor: "pointer", borderRadius: 4, border: "1px solid rgba(126,171,200,0.25)", background: "rgba(255,255,255,0.05)", color: "#dcecf5", padding: "3px 7px", fontSize: 10 }}
                            >
                              + Berth
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div style={{ display: "grid", gap: 6 }}>
                            {dockBerths.map((berth) => (
                              <div key={berth.id} style={{ display: "grid", gap: 3 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px auto", gap: 4, alignItems: "center" }}>
                                  <input
                                    value={berth.label || ""}
                                    onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { label: e.target.value.slice(0, 24) || berth.id }))}
                                    placeholder="Label"
                                    style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "3px 5px" }}
                                  />
                                  <select
                                    value={berth.side || "primary"}
                                    disabled={dock.berthMode !== "double"}
                                    onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { side: e.target.value }))}
                                    style={{ background: "#102537", color: dock.berthMode !== "double" ? "#6a8395" : "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10 }}
                                  >
                                    <option value="primary">Near</option>
                                    <option value="secondary">Far</option>
                                  </select>
                                  <label style={{ fontSize: 10, color: "#7eabc8", display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                                    <input
                                      type="checkbox"
                                      checked={berth.enabled !== false}
                                      onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { enabled: e.target.checked }))}
                                    />
                                    On
                                  </label>
                                  <button
                                    onClick={() => setDraft((current) => removeBerth(current || active, berth.id))}
                                    style={{ cursor: "pointer", borderRadius: 4, border: "1px solid rgba(224,128,64,0.35)", background: "rgba(224,128,64,0.12)", color: "#e8b090", padding: "3px 6px", fontSize: 10 }}
                                    title="Remove berth"
                                  >
                                    ✕
                                  </button>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 4, alignItems: "center", paddingLeft: 4, opacity: dock.bookable ? 1 : 0.4 }}>
                                  <label style={{ fontSize: 10, color: berth.occupied ? "#e8b090" : "#7eabc8", display: "flex", alignItems: "center", gap: 4 }}>
                                    <input
                                      type="checkbox"
                                      checked={berth.occupied === true}
                                      disabled={!dock.bookable}
                                      onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { occupied: e.target.checked }))}
                                    />
                                    Occupied
                                  </label>
                                  <input
                                    value={berth.guestLabel || ""}
                                    onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { guestLabel: e.target.value.slice(0, 32) }))}
                                    placeholder={dock.bookable ? "Guest name / note (optional)" : "(home berth — bookable disabled)"}
                                    disabled={!dock.bookable || berth.occupied !== true}
                                    style={{ background: "#102537", color: dock.bookable && berth.occupied ? "#dcecf5" : "#6a8395", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "3px 5px" }}
                                  />
                                </div>
                                {dock.bookable && (
                                  <div style={{ display: "grid", gridTemplateColumns: "auto repeat(3, 1fr)", gap: 4, alignItems: "center", paddingLeft: 4, fontSize: 10, color: "#7eabc8" }} title="Per-berth size limits override the dock defaults. Leave blank to inherit.">
                                    <span>Limits (m):</span>
                                    <input
                                      type="number" min="0" step="0.1"
                                      value={Number.isFinite(berth.maxLengthM) ? berth.maxLengthM : ""}
                                      onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { maxLengthM: e.target.value === "" ? null : Number(e.target.value) }))}
                                      placeholder={Number.isFinite(dock.defaultMaxLengthM) ? `LOA ${dock.defaultMaxLengthM}` : "LOA"}
                                      style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "2px 4px" }}
                                    />
                                    <input
                                      type="number" min="0" step="0.1"
                                      value={Number.isFinite(berth.maxBeamM) ? berth.maxBeamM : ""}
                                      onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { maxBeamM: e.target.value === "" ? null : Number(e.target.value) }))}
                                      placeholder={Number.isFinite(dock.defaultMaxBeamM) ? `Beam ${dock.defaultMaxBeamM}` : "Beam"}
                                      style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "2px 4px" }}
                                    />
                                    <input
                                      type="number" min="0" step="0.1"
                                      value={Number.isFinite(berth.maxDraftM) ? berth.maxDraftM : ""}
                                      onChange={(e) => setDraft((current) => updateBerthField(current || active, berth.id, { maxDraftM: e.target.value === "" ? null : Number(e.target.value) }))}
                                      placeholder={Number.isFinite(dock.defaultMaxDraftM) ? `Draft ${dock.defaultMaxDraftM}` : "Draft"}
                                      style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4, fontSize: 10, padding: "2px 4px" }}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                          <button
                            onClick={() => {
                              if (typeof window !== "undefined" && !window.confirm(`Remove dock ${dock.name || dock.id} and its ${dockBerths.length} berth(s)?`)) return;
                              setDraft((current) => removeDock(current || active, dock.id));
                            }}
                            style={{ cursor: "pointer", borderRadius: 4, border: "1px solid rgba(224,128,64,0.35)", background: "rgba(224,128,64,0.12)", color: "#e8b090", padding: "4px 8px", fontSize: 10 }}
                          >
                            Remove dock
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {adminTab === "move" && (
                <>
                  <div style={{ fontSize: 10, marginBottom: 6, color: "#7eabc8" }}>What to move</div>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    style={{ width: "100%", marginBottom: 10, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                  >
                    {targetOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>

                  <div style={{ fontSize: 10, marginBottom: 6, color: "#7eabc8" }}>Step size</div>
                  <select
                    value={String(stepDeg)}
                    onChange={(e) => setStepDeg(Number(e.target.value))}
                    style={{ width: "100%", marginBottom: 8, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                  >
                    <option value="0.00002">Small (~2 m)</option>
                    <option value="0.00005">Medium (~5 m)</option>
                    <option value="0.0001">Large (~11 m)</option>
                  </select>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
                    <div />
                    <button onClick={() => setDraft((current) => shiftLayout(current || active, target, stepDeg, 0))} style={{ cursor: "pointer" }}>N</button>
                    <div />
                    <button onClick={() => setDraft((current) => shiftLayout(current || active, target, 0, -stepDeg))} style={{ cursor: "pointer" }}>W</button>
                    <button onClick={() => setDraft(layout || DEFAULT_LAYOUT)} style={{ cursor: "pointer" }}>Reset</button>
                    <button onClick={() => setDraft((current) => shiftLayout(current || active, target, 0, stepDeg))} style={{ cursor: "pointer" }}>E</button>
                    <div />
                    <button onClick={() => setDraft((current) => shiftLayout(current || active, target, -stepDeg, 0))} style={{ cursor: "pointer" }}>S</button>
                    <div />
                  </div>

                  <div style={{ fontSize: 10, marginBottom: 6, color: "#7eabc8" }}>Rotate berth row</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="45"
                      value={rotDeg}
                      onChange={(e) => setRotDeg(Math.max(0.5, Math.min(45, Number(e.target.value) || 2)))}
                      style={{ flex: 1, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                    />
                    <button onClick={() => setDraft((current) => rotateBerthRows(current || active, target, -rotDeg))} style={{ cursor: "pointer" }}>−°</button>
                    <button onClick={() => setDraft((current) => rotateBerthRows(current || active, target, rotDeg))} style={{ cursor: "pointer" }}>+°</button>
                  </div>

                  <div style={{ fontSize: 10, marginBottom: 6, color: "#7eabc8" }}>Boat orientation</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                    <select
                      value={headingTarget}
                      onChange={(e) => setHeadingTarget(e.target.value)}
                      style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                    >
                      {headingOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {headingTarget === "boat" ? (
                      <select
                        value={headingBoatId ?? ""}
                        onChange={(e) => setHeadingBoatId(Number(e.target.value))}
                        style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                      >
                        {boats.map((boat) => (
                          <option key={boat.id} value={boat.id}>{boat.name}</option>
                        ))}
                      </select>
                    ) : (
                      <div />
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="90"
                      value={headingStepDeg}
                      onChange={(e) => setHeadingStepDeg(Math.max(1, Math.min(90, Number(e.target.value) || 5)))}
                      style={{ flex: 1, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                    />
                    <button onClick={() => setDraft((current) => updateHeading(current || active, headingTarget, -headingStepDeg, headingBoatId))} style={{ cursor: "pointer" }}>−°</button>
                    <button onClick={() => setDraft((current) => updateHeading(current || active, headingTarget, headingStepDeg, headingBoatId))} style={{ cursor: "pointer" }}>+°</button>
                  </div>
                </>
              )}

              <button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const ok = await onSaveLayout?.(draft);
                    if (!ok) setDraft(layout || DEFAULT_LAYOUT);
                  } finally {
                    setSaving(false);
                  }
                }}
                style={{
                  width: "100%",
                  background: "rgba(42,154,74,0.22)",
                  border: "1px solid rgba(42,154,74,0.45)",
                  color: "#b8efcc",
                  borderRadius: 5,
                  padding: "8px 8px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.6,
                }}
              >
                {saving ? "Saving..." : "Save layout"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}