import React from "react";

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function fmt(v, d = 1) {
  if (!isNum(v)) return "—";
  return v.toFixed(d);
}

/**
 * Visual heel + trim indicator.
 *
 * Two stylised cross-sections of the boat against a horizon:
 *   - Left: stern view — hull rocks port/starboard with heel angle.
 *   - Right: side view — hull pitches bow-up/bow-down with trim angle.
 *
 * The boat stays upright on screen and the *horizon* tilts the opposite way,
 * which is how a sailor experiences it (and how a bubble-level reads).
 *
 * heelDeg: + = starboard down (heeled to starboard), - = port down.
 * trimDeg: + = bow up,        - = bow down.
 */
export default function BoatAttitude({ heelDeg, trimDeg }) {
  const hasHeel = isNum(heelDeg);
  const hasTrim = isNum(trimDeg);

  return (
    <div style={{
      background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
      border: "1px solid rgba(126,171,200,0.18)",
      borderRadius: 8,
      padding: "14px 16px",
      width: "100%",
      boxSizing: "border-box",
    }}>
      <div style={{
        fontSize: 9, letterSpacing: 2, color: "#7eabc8",
        textTransform: "uppercase", marginBottom: 10,
      }}>
        Heel &amp; Trim
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 12,
      }}>
        <AttitudePanel
          kind="heel"
          deg={hasHeel ? heelDeg : 0}
          hasValue={hasHeel}
          warnAbove={15}
          alertAbove={25}
          leftLabel="PORT"
          rightLabel="STBD"
          title="HEEL"
        />
        <AttitudePanel
          kind="trim"
          deg={hasTrim ? trimDeg : 0}
          hasValue={hasTrim}
          warnAbove={5}
          alertAbove={10}
          leftLabel="STERN"
          rightLabel="BOW"
          title="TRIM"
        />
      </div>
    </div>
  );
}

// Logical SVG canvas — actual on-screen size is driven by CSS so the
// component scales smoothly between phone and desktop layouts.
const VB_W = 220;
const VB_H = 200;

function AttitudePanel({ kind, deg, hasValue, warnAbove, alertAbove, leftLabel, rightLabel, title }) {
  const width = VB_W;
  const height = VB_H;
  const cx = width / 2;
  const cy = height / 2 + 8;
  const horizonR = Math.min(width, height) * 0.55;

  // Tilt the *horizon* opposite to the boat's tilt, so the boat appears upright.
  // SVG rotate() is clockwise-positive, so to make the horizon's right side
  // *rise* we need a negative angle.
  // Heel: + heel = stbd low → in boat frame horizon's right (stbd) rises → -deg.
  // Trim: + trim = bow up   → in boat frame horizon's right (bow) drops  → +deg.
  const horizonRot = kind === "heel" ? -deg : deg;
  const absDeg = Math.abs(deg);
  const color =
    !hasValue ? "#5a8aaa" :
    absDeg >= alertAbove ? "#e08040" :
    absDeg >= warnAbove  ? "#d4a84a" :
                           "#9ec8e0";

  return (
    <div style={{
      background: "rgba(6,20,32,0.45)",
      border: "1px solid rgba(126,171,200,0.12)",
      borderRadius: 6,
      padding: "10px 8px 8px",
      display: "flex", flexDirection: "column", alignItems: "center",
    }}>
      <div style={{
        fontSize: 9, letterSpacing: 2, color: "#7eabc8",
        textTransform: "uppercase", marginBottom: 4, alignSelf: "flex-start", paddingLeft: 4,
      }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`}
           preserveAspectRatio="xMidYMid meet"
           style={{display:"block", width:"100%", height:"auto", maxWidth:280}}>
        <defs>
          <clipPath id={`clip-${kind}`}>
            <circle cx={cx} cy={cy} r={horizonR} />
          </clipPath>
          <linearGradient id={`sky-${kind}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor="#0d2a44" />
            <stop offset="100%" stopColor="#15425f" />
          </linearGradient>
          <linearGradient id={`sea-${kind}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor="#0a3a5a" />
            <stop offset="100%" stopColor="#04141f" />
          </linearGradient>
        </defs>

        {/* Horizon disk (sky + sea) — rotates around centre to express tilt */}
        <g clipPath={`url(#clip-${kind})`}>
          <g transform={`rotate(${horizonRot} ${cx} ${cy})`}>
            <rect x={cx - horizonR * 2} y={cy - horizonR * 2}
                  width={horizonR * 4} height={horizonR * 2}
                  fill={`url(#sky-${kind})`} />
            <rect x={cx - horizonR * 2} y={cy}
                  width={horizonR * 4} height={horizonR * 2}
                  fill={`url(#sea-${kind})`} />
            {/* Horizon line */}
            <line x1={cx - horizonR * 2} y1={cy}
                  x2={cx + horizonR * 2} y2={cy}
                  stroke="#7eabc8" strokeWidth="1" opacity="0.7" />
            {/* Subtle pitch ladder (every 5°) */}
            {[-20,-15,-10,-5,5,10,15,20].map(p => {
              const y = cy + (p / 30) * horizonR;
              const w = (p % 10 === 0) ? horizonR * 0.35 : horizonR * 0.18;
              return (
                <line key={p} x1={cx - w} y1={y} x2={cx + w} y2={y}
                      stroke="#7eabc8" strokeWidth="0.8" opacity="0.35" />
              );
            })}
          </g>
        </g>

        {/* Outer ring */}
        <circle cx={cx} cy={cy} r={horizonR}
                fill="none" stroke="rgba(126,171,200,0.35)" strokeWidth="1.5" />

        {/* Tick marks every 10° around the ring */}
        {Array.from({length: 36}).map((_, i) => {
          const a = (i * 10 - 90) * Math.PI / 180;
          const r1 = horizonR;
          const r2 = horizonR + (i % 3 === 0 ? 6 : 3);
          return (
            <line key={i}
                  x1={cx + Math.cos(a) * r1} y1={cy + Math.sin(a) * r1}
                  x2={cx + Math.cos(a) * r2} y2={cy + Math.sin(a) * r2}
                  stroke="#395c75" strokeWidth={i % 9 === 0 ? 1.5 : 0.8} />
          );
        })}

        {/* Boat silhouette — fixed, upright. Drawn in centre. */}
        <g transform={`translate(${cx} ${cy})`}>
          {kind === "heel" ? <SternHull color={color} r={horizonR} />
                           : <SideHull  color={color} r={horizonR} />}
        </g>

        {/* Top centre tick (zero reference) */}
        <polygon
          points={`${cx},${cy - horizonR - 8} ${cx - 4},${cy - horizonR - 1} ${cx + 4},${cy - horizonR - 1}`}
          fill="#e8f4f8" />
      </svg>

      {/* Numeric readout + side labels */}
      <div style={{
        marginTop: 6, display: "flex", alignItems: "center",
        justifyContent: "space-between", width: "100%",
        padding: "0 6px",
      }}>
        <span style={{fontSize:9,letterSpacing:1.5,color:"#5a8aaa"}}>{leftLabel}</span>
        <span style={{
          fontFamily: "serif", fontSize: 22, fontWeight: "bold", color,
          fontVariantNumeric: "tabular-nums",
        }}>
          {hasValue ? `${deg > 0 ? "+" : ""}${fmt(deg, 1)}°` : "—"}
        </span>
        <span style={{fontSize:9,letterSpacing:1.5,color:"#5a8aaa"}}>{rightLabel}</span>
      </div>
    </div>
  );
}

/** Stern view: keel down, deck across the top. */
function SternHull({ color, r }) {
  const w = r * 0.95;
  const h = r * 0.55;
  // Hull cross-section: deck line (top), curved bottom into keel.
  const d = [
    `M ${-w} ${-h * 0.15}`,                 // port deck edge
    `L ${ w} ${-h * 0.15}`,                 // stbd deck edge
    `Q ${ w * 0.85} ${ h * 0.55} ${ 0} ${h * 0.55}`,  // stbd → bottom
    `Q ${-w * 0.85} ${ h * 0.55} ${-w} ${-h * 0.15}`, // port side back up
    "Z",
  ].join(" ");
  return (
    <g>
      <path d={d} fill="rgba(232,244,248,0.18)" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {/* Mast */}
      <line x1="0" y1={-h * 0.15} x2="0" y2={-r * 0.95} stroke={color} strokeWidth="1.5" />
      <circle cx="0" cy={-r * 0.95} r="2" fill={color} />
      {/* Keel fin */}
      <rect x="-3" y={h * 0.55} width="6" height={h * 0.35} fill={color} opacity="0.85" />
      {/* Bulb */}
      <ellipse cx="0" cy={h * 0.55 + h * 0.4} rx="10" ry="4" fill={color} />
      {/* Centreline */}
      <line x1="0" y1={-h * 0.15} x2="0" y2={h * 0.55} stroke={color} strokeWidth="0.6" opacity="0.5" strokeDasharray="2 3" />
    </g>
  );
}

/** Side view: bow to the right, transom on the left. */
function SideHull({ color, r }) {
  const w = r * 1.05;
  const h = r * 0.42;
  // Sheer line (top) gentle curve; bow rises slightly. Transom flat on left.
  const d = [
    `M ${-w} ${-h * 0.25}`,                          // transom top
    `Q ${ 0} ${-h * 0.55} ${ w} ${-h * 0.05}`,       // sheer to bow tip
    `L ${ w * 0.92} ${ h * 0.15}`,                   // bow waterline
    `Q ${ 0} ${ h * 0.85} ${-w * 0.95} ${ h * 0.25}`,// hull bottom
    `L ${-w} ${-h * 0.25}`,                          // back up the transom
    "Z",
  ].join(" ");
  return (
    <g>
      <path d={d} fill="rgba(232,244,248,0.18)" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {/* Mast (slightly aft of midships) */}
      <line x1={-w * 0.05} y1={-h * 0.42} x2={-w * 0.05} y2={-r * 0.95} stroke={color} strokeWidth="1.5" />
      <circle cx={-w * 0.05} cy={-r * 0.95} r="2" fill={color} />
      {/* Forestay */}
      <line x1={-w * 0.05} y1={-r * 0.95} x2={w * 0.95} y2={-h * 0.05}
            stroke={color} strokeWidth="0.8" opacity="0.6" />
      {/* Backstay */}
      <line x1={-w * 0.05} y1={-r * 0.95} x2={-w * 0.98} y2={-h * 0.22}
            stroke={color} strokeWidth="0.8" opacity="0.6" />
      {/* Keel */}
      <path d={`M ${-w * 0.25} ${h * 0.7} L ${ w * 0.15} ${h * 0.72}
                L ${ w * 0.05} ${h * 1.05} L ${-w * 0.18} ${h * 1.05} Z`}
            fill={color} opacity="0.85" />
      {/* Rudder */}
      <path d={`M ${-w * 0.78} ${h * 0.55} L ${-w * 0.65} ${h * 0.55}
                L ${-w * 0.7} ${h * 0.95} L ${-w * 0.82} ${h * 0.95} Z`}
            fill={color} opacity="0.8" />
    </g>
  );
}
