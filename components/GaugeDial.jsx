import React from "react";

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Semi-circular analog gauge ("clock") for a single scalar reading.
 *
 * props:
 *   label         e.g. "Cabin temp"
 *   value         numeric reading (or null/undefined → shows "—")
 *   unit          e.g. "°C"
 *   min, max      scale bounds
 *   digits        decimal places for the big number
 *   color         needle + value color
 *   ticks         number of major tick labels (default 5)
 *   bands         optional [{from, to, color}] painted as colored arc segments
 *                 (e.g. comfort zone shading)
 *   size          width in px (height ≈ size * 0.62)
 */
export default function GaugeDial({
  label,
  value,
  unit = "",
  min = 0,
  max = 100,
  digits = 0,
  color = "#9ec8e0",
  ticks = 5,
  bands = [],
  size = 220,
}) {
  const w = size;
  const h = Math.round(size * 0.62);
  const cx = w / 2;
  const cy = h - 12;
  const r = w / 2 - 14;

  // Map value (in [min,max]) to angle.
  // Sweep from 180° (left) to 360° (right) via the top — i.e. -180..0 in math degrees.
  const angleFor = (v) => {
    const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
    return 180 + t * 180; // 180 → left, 270 → top, 360 → right
  };
  const polar = (deg, rad) => {
    const r0 = (deg * Math.PI) / 180;
    return [cx + Math.cos(r0) * rad, cy + Math.sin(r0) * rad];
  };

  // Arc path between two angles (degrees) at radius `rad`.
  const arcPath = (a1, a2, rad) => {
    const [x1, y1] = polar(a1, rad);
    const [x2, y2] = polar(a2, rad);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    const sweep = a2 > a1 ? 1 : 0;
    return `M ${x1} ${y1} A ${rad} ${rad} 0 ${large} ${sweep} ${x2} ${y2}`;
  };

  const has = isNum(value);
  const clamped = has ? Math.max(min, Math.min(max, value)) : min;
  const needleAngle = angleFor(clamped);
  const [nx, ny] = polar(needleAngle, r - 12);

  // Tick labels (evenly spaced).
  const tickItems = [];
  for (let i = 0; i < ticks; i++) {
    const t = i / (ticks - 1);
    const v = min + t * (max - min);
    const a = 180 + t * 180;
    const [tx1, ty1] = polar(a, r);
    const [tx2, ty2] = polar(a, r - 6);
    const [lx, ly] = polar(a, r - 18);
    tickItems.push(
      <g key={i}>
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="#7eabc8" strokeWidth={1.2} />
        <text
          x={lx}
          y={ly + 3}
          fontSize={9}
          fontFamily="monospace"
          fill="#5a8aaa"
          textAnchor="middle"
        >
          {Number.isInteger(v) ? v : v.toFixed(1)}
        </text>
      </g>,
    );
  }

  // Background band (full track).
  const trackPath = arcPath(180, 360, r);

  // Optional colored bands.
  const bandPaths = bands.map((b, i) => {
    const a1 = angleFor(Math.max(min, b.from));
    const a2 = angleFor(Math.min(max, b.to));
    if (a2 <= a1) return null;
    return (
      <path
        key={i}
        d={arcPath(a1, a2, r)}
        stroke={b.color}
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
        opacity={0.55}
      />
    );
  });

  // Filled progress arc up to the value.
  const progressPath = arcPath(180, needleAngle, r);

  const display = has ? value.toFixed(digits) : "—";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
        border: "1px solid rgba(126,171,200,0.18)",
        borderRadius: 8,
        padding: "10px 14px 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: 2,
          color: "#7eabc8",
          textTransform: "uppercase",
          alignSelf: "flex-start",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: w }}>
        {/* track */}
        <path d={trackPath} stroke="rgba(126,171,200,0.15)" strokeWidth={6} fill="none" strokeLinecap="round" />
        {/* bands */}
        {bandPaths}
        {/* progress */}
        {has && (
          <path
            d={progressPath}
            stroke={color}
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
            opacity={0.85}
          />
        )}
        {/* ticks */}
        {tickItems}
        {/* needle */}
        {has && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={nx}
              y2={ny}
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={4} fill="#e8f4f8" stroke={color} strokeWidth={1.5} />
          </>
        )}
        {/* value text */}
        <text
          x={cx}
          y={cy - 18}
          textAnchor="middle"
          fontSize={Math.round(w * 0.16)}
          fontFamily="serif"
          fontWeight="bold"
          fill="#e8f4f8"
        >
          {display}
        </text>
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize={10}
          fontFamily="monospace"
          fill="#7eabc8"
          letterSpacing={1}
        >
          {unit}
        </text>
      </svg>
    </div>
  );
}
