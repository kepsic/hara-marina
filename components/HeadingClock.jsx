import React from "react";

// Convert compass degrees (0=N, 90=E, clockwise) to unit screen vector (x right, y down).
function vec(deg) {
  const r = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function cardinalLabel(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

/**
 * Analog compass dial for heading + (optional) COG.
 * Dial rotates so current heading is up (boat-up convention),
 * matching how MFDs and the existing wind rose present orientation.
 */
export default function HeadingClock({ headingDeg, cogDeg, size = 200 }) {
  const hasHeading = isNum(headingDeg);
  const hasCog = isNum(cogDeg);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;

  // Body-up rotation: subtract heading from every world bearing.
  const rot = hasHeading ? headingDeg : 0;
  const worldToScreen = (deg) => vec(deg - rot);

  // Tick marks every 10°, longer every 30°, with cardinal labels.
  const ticks = [];
  for (let d = 0; d < 360; d += 10) {
    const major = d % 30 === 0;
    const [tx, ty] = worldToScreen(d);
    const r1 = r;
    const r2 = r - (major ? 10 : 5);
    ticks.push(
      <line
        key={`t${d}`}
        x1={cx + tx * r1}
        y1={cy + ty * r1}
        x2={cx + tx * r2}
        y2={cy + ty * r2}
        stroke={major ? "#7eabc8" : "#395c75"}
        strokeWidth={major ? 1.5 : 1}
      />
    );
  }
  const cardinals = [
    { deg: 0, label: "N", color: "#e08040" },
    { deg: 90, label: "E", color: "#9ec8e0" },
    { deg: 180, label: "S", color: "#9ec8e0" },
    { deg: 270, label: "W", color: "#9ec8e0" },
  ];

  // Heading needle points up when boat-up; draw a small arrow up the dial.
  const headingArrow = hasHeading ? (
    <g>
      <line x1={cx} y1={cy} x2={cx} y2={cy - r + 14} stroke="#e08040" strokeWidth={2.5} strokeLinecap="round" />
      <polygon
        points={`${cx},${cy - r + 6} ${cx - 6},${cy - r + 18} ${cx + 6},${cy - r + 18}`}
        fill="#e08040"
      />
    </g>
  ) : null;

  // COG needle in world coords -> screen via worldToScreen
  let cogNeedle = null;
  if (hasCog) {
    const [vx, vy] = worldToScreen(cogDeg);
    cogNeedle = (
      <line
        x1={cx}
        y1={cy}
        x2={cx + vx * (r - 18)}
        y2={cy + vy * (r - 18)}
        stroke="#ffd166"
        strokeWidth={2}
        strokeDasharray="4 4"
        strokeLinecap="round"
      />
    );
  }

  const headingText = hasHeading ? `${Math.round(((headingDeg % 360) + 360) % 360)}°` : "—";
  const headingCard = hasHeading ? cardinalLabel(headingDeg) : "";

  return (
    <div
      style={{
        flex: "0 0 auto",
        background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
        border: "1px solid rgba(126,171,200,0.18)",
        borderRadius: 8,
        padding: "12px 14px",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 9, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase" }}>
        Heading
      </div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="rgba(8,22,36,0.55)" stroke="rgba(126,171,200,0.25)" strokeWidth={1} />
        {ticks}
        {cardinals.map(({ deg, label, color }) => {
          const [tx, ty] = worldToScreen(deg);
          const lr = r - 22;
          return (
            <text
              key={label}
              x={cx + tx * lr}
              y={cy + ty * lr + 4}
              textAnchor="middle"
              fontSize={12}
              fontFamily="monospace"
              fill={color}
              fontWeight={deg === 0 ? 700 : 500}
            >
              {label}
            </text>
          );
        })}
        {/* Boat silhouette pointing up */}
        <polygon
          points={`${cx},${cy - 22} ${cx - 7},${cy + 14} ${cx + 7},${cy + 14}`}
          fill="rgba(126,171,200,0.18)"
          stroke="rgba(158,200,224,0.5)"
          strokeWidth={1}
        />
        {cogNeedle}
        {headingArrow}
        <circle cx={cx} cy={cy} r={3} fill="#e8f4f8" />
      </svg>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div style={{ fontFamily: "monospace", fontSize: 22, color: "#e8f4f8", fontWeight: 600 }}>
          {headingText}
        </div>
        {headingCard && (
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#7eabc8", letterSpacing: 1 }}>
            {headingCard}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#7eabc8", letterSpacing: 1 }}>
        <span style={{ color: "#e08040" }}>● HDG</span>
        {hasCog && <span style={{ color: "#ffd166" }}>┄ COG {Math.round(((cogDeg % 360) + 360) % 360)}°</span>}
      </div>
    </div>
  );
}
