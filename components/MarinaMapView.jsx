import { useEffect, useState } from "react";
import { divIcon } from "leaflet";
import { MapContainer, TileLayer, Marker, Tooltip, useMapEvents } from "react-leaflet";
import BoatWindRose from "./BoatWindRose";
import WindCanvas from "./WindCanvas";

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
  dockHeadingDeg: { A: 270, B: 270, C: 270 },
  boatHeadingOverrides: {},
};

function keyFor(boat) {
  return `${boat.section}-${boat.id}`;
}

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

function shiftedPoint(point, dLat, dLon) {
  return [point[0] + dLat, point[1] + dLon];
}

function shiftLayout(layout, target, dLat, dLon) {
  const next = cloneLayout(layout);
  const shiftArray = (arr) => arr.map((p) => shiftedPoint(p, dLat, dLon));

  if (target === "center") next.center = shiftedPoint(next.center, dLat, dLon);
  if (target === "piers") next.pierLines = next.pierLines.map((line) => shiftArray(line));
  if (target === "berths-all") {
    for (const k of ["A", "B", "C"]) next.berthPositions[k] = shiftArray(next.berthPositions[k]);
  }
  if (target === "berths-A") next.berthPositions.A = shiftArray(next.berthPositions.A);
  if (target === "berths-B") next.berthPositions.B = shiftArray(next.berthPositions.B);
  if (target === "berths-C") next.berthPositions.C = shiftArray(next.berthPositions.C);
  if (target === "fuel") next.fuelDock = shiftedPoint(next.fuelDock, dLat, dLon);

  return next;
}

function rotatePoint([lat, lon], [aLat, aLon], deg) {
  const t = (deg * Math.PI) / 180;
  const dLat = lat - aLat;
  const dLon = lon - aLon;
  const rLat = dLat * Math.cos(t) - dLon * Math.sin(t);
  const rLon = dLat * Math.sin(t) + dLon * Math.cos(t);
  return [aLat + rLat, aLon + rLon];
}

function rotateBerthRows(layout, deg) {
  const next = cloneLayout(layout);
  const pts = [
    ...(next.berthPositions?.A || []),
    ...(next.berthPositions?.B || []),
    ...(next.berthPositions?.C || []),
  ];
  if (!pts.length) return next;

  const anchor = pts[0]; // shore-end anchor by current convention
  for (const k of ["A", "B", "C"]) {
    next.berthPositions[k] = (next.berthPositions[k] || []).map((p) => rotatePoint(p, anchor, deg));
  }
  return next;
}

function orderedBerthSlots(layout) {
  const out = [];
  for (const sectionId of ["A", "B", "C"]) {
    for (const pos of layout.berthPositions?.[sectionId] || []) {
      out.push({ sectionId, pos });
    }
  }
  return out;
}

function boatHeadingDeg(layout, boat, sectionId) {
  const override = layout?.boatHeadingOverrides?.[String(boat?.id || "")];
  if (Number.isFinite(override)) return override;
  const byDock = layout?.dockHeadingDeg?.[sectionId];
  if (Number.isFinite(byDock)) return byDock;
  return 270;
}

function updateHeading(layout, target, deltaDeg, boatId) {
  const next = cloneLayout(layout);
  next.dockHeadingDeg = { A: 270, B: 270, C: 270, ...(next.dockHeadingDeg || {}) };
  next.boatHeadingOverrides = { ...(next.boatHeadingOverrides || {}) };

  const add = (value) => {
    const nextDeg = (((Number(value) || 0) + deltaDeg) % 360 + 360) % 360;
    return nextDeg;
  };

  if (target === "dock-all") {
    for (const dockId of ["A", "B", "C"]) next.dockHeadingDeg[dockId] = add(next.dockHeadingDeg[dockId]);
  }
  if (target === "dock-A") next.dockHeadingDeg.A = add(next.dockHeadingDeg.A);
  if (target === "dock-B") next.dockHeadingDeg.B = add(next.dockHeadingDeg.B);
  if (target === "dock-C") next.dockHeadingDeg.C = add(next.dockHeadingDeg.C);
  if (target === "boat" && boatId != null) {
    const key = String(boatId);
    const base = Number.isFinite(next.boatHeadingOverrides[key])
      ? next.boatHeadingOverrides[key]
      : 270;
    next.boatHeadingOverrides[key] = add(base);
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
  const [zoom, setZoom] = useState(17);

  useEffect(() => {
    setDraft(layout || DEFAULT_LAYOUT);
  }, [layout]);

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
  const assignedBoats = active.reverseBoatOrder ? [...boats].reverse() : boats;

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
        maxZoom={20}
        style={{ height: "100%", width: "100%", position: "relative", zIndex: 0 }}
        scrollWheelZoom
      >
        <MapZoomTracker onZoomChange={setZoom} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {berthSlots.map((slot, idx) => {
          const boat = assignedBoats[idx];
          if (!boat) return null;
          const isSelected = boat.id === selectedId;
          const inQueue = queuedBoatIds.has(boat.id);
          return (
            <Marker
              key={keyFor(boat)}
              position={slot.pos}
              icon={boatMarkerIcon(boat.color, isSelected, boatHeadingDeg(active, boat, slot.sectionId), zoom)}
              eventHandlers={{ click: () => onBoatSelect(boat.id) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div style={{ fontSize: 11, fontWeight: "bold", letterSpacing: 0.5 }}>
                  {boat.name}
                </div>
                <div style={{ fontSize: 10, opacity: 0.85 }}>
                  Dock {slot.sectionId}
                  {inQueue ? " · in crane queue" : ""}
                </div>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      <WindCanvas
        dir={windDirDeg}
        speed={windMs}
        gust={hasBoatWind ? null : weather?.windspeedmax}
        orientation="map"
        zIndex={300}
      />

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
            width: 260,
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
              {editMode ? "Editing" : "Adjust"}
            </button>
          </div>

          {editMode && (
            <>
              <div style={{ fontSize: 10, marginBottom: 6 }}>Target</div>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                style={{ width: "100%", marginBottom: 8, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
              >
                <option value="center">Map center</option>
                <option value="berths-all">All berths</option>
                <option value="berths-A">Berths A</option>
                <option value="berths-B">Berths B</option>
                <option value="berths-C">Berths C</option>
              </select>

              <div style={{ fontSize: 10, marginBottom: 6 }}>Boat order</div>
              <button
                onClick={() => setDraft((l) => ({ ...l, reverseBoatOrder: !l.reverseBoatOrder }))}
                style={{
                  width: "100%",
                  marginBottom: 10,
                  background: active.reverseBoatOrder ? "rgba(240,192,64,0.2)" : "rgba(255,255,255,0.06)",
                  color: active.reverseBoatOrder ? "#f0c040" : "#dcecf5",
                  border: "1px solid #36566b",
                  borderRadius: 4,
                  cursor: "pointer",
                  padding: "6px 8px",
                }}
              >
                {active.reverseBoatOrder ? "Reversed (shore-first flipped)" : "Normal"}
              </button>

              <div style={{ fontSize: 10, marginBottom: 6 }}>Boat orientation</div>
              <select
                value={headingTarget}
                onChange={(e) => setHeadingTarget(e.target.value)}
                style={{ width: "100%", marginBottom: 8, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
              >
                <option value="dock-all">All docks</option>
                <option value="dock-A">Dock A</option>
                <option value="dock-B">Dock B</option>
                <option value="dock-C">Dock C</option>
                <option value="boat">Individual boat</option>
              </select>

              {headingTarget === "boat" && (
                <select
                  value={headingBoatId ?? ""}
                  onChange={(e) => setHeadingBoatId(Number(e.target.value))}
                  style={{ width: "100%", marginBottom: 8, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                >
                  {boats.map((boat) => (
                    <option key={boat.id} value={boat.id}>{boat.name}</option>
                  ))}
                </select>
              )}

              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="90"
                  value={headingStepDeg}
                  onChange={(e) => setHeadingStepDeg(Math.max(1, Math.min(90, Number(e.target.value) || 5)))}
                  style={{ flex: 1, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                />
                <button
                  onClick={() => setDraft((l) => updateHeading(l, headingTarget, -headingStepDeg, headingBoatId))}
                  style={{ cursor: "pointer" }}
                >
                  -deg
                </button>
                <button
                  onClick={() => setDraft((l) => updateHeading(l, headingTarget, headingStepDeg, headingBoatId))}
                  style={{ cursor: "pointer" }}
                >
                  +deg
                </button>
              </div>

              <div style={{ fontSize: 10, marginBottom: 6 }}>Berth row angle</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="45"
                  value={rotDeg}
                  onChange={(e) => setRotDeg(Math.max(0.5, Math.min(45, Number(e.target.value) || 2)))}
                  style={{ flex: 1, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
                />
                <button onClick={() => setDraft((l) => rotateBerthRows(l, -rotDeg))} style={{ cursor: "pointer" }}>-deg</button>
                <button onClick={() => setDraft((l) => rotateBerthRows(l, rotDeg))} style={{ cursor: "pointer" }}>+deg</button>
              </div>

              <div style={{ fontSize: 10, marginBottom: 6 }}>Step</div>
              <select
                value={String(stepDeg)}
                onChange={(e) => setStepDeg(Number(e.target.value))}
                style={{ width: "100%", marginBottom: 10, background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 4 }}
              >
                <option value="0.00002">Small (~2 m)</option>
                <option value="0.00005">Medium (~5 m)</option>
                <option value="0.0001">Large (~11 m)</option>
              </select>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                <div />
                <button onClick={() => setDraft((l) => shiftLayout(l, target, stepDeg, 0))} style={{ cursor: "pointer" }}>N</button>
                <div />
                <button onClick={() => setDraft((l) => shiftLayout(l, target, 0, -stepDeg))} style={{ cursor: "pointer" }}>W</button>
                <button onClick={() => setDraft(layout || DEFAULT_LAYOUT)} style={{ cursor: "pointer" }}>Reset</button>
                <button onClick={() => setDraft((l) => shiftLayout(l, target, 0, stepDeg))} style={{ cursor: "pointer" }}>E</button>
                <div />
                <button onClick={() => setDraft((l) => shiftLayout(l, target, -stepDeg, 0))} style={{ cursor: "pointer" }}>S</button>
                <div />
              </div>

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
                  padding: "7px 8px",
                  cursor: "pointer",
                  fontSize: 11,
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
