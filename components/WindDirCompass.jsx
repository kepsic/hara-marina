import React from "react";

function vec(deg) {
  const r = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function cardinalLabel(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/**
 * Fixed N-up compass showing where the wind is blowing FROM.
 * Used for weather stations / non-vessel wind direction display.
 *
 * props: dirDeg (meteorological "from" direction, 0 = from N), size, label
 */
export default function WindDirCompass({ dirDeg, size = 200, label = "Wind dir" }) {
  const has = isNum(dirDeg);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;

  const ticks = [];
  for (let d = 0; d < 360; d += 10) {
    const major = d % 30 === 0;
    const [tx, ty] = vec(d);
    const r1 = r;
    const r2 = r - (major ? 10 : 5);
    ticks.push(
      <line key={`t${d}`}
        x1={cx + tx * r1} y1={cy + ty * r1}
        x2={cx + tx * r2} y2={cy + ty * r2}
        stroke={major ? "#7eabc8" : "#395c75"}
        strokeWidth={major ? 1.5 : 1} />
    );
  }

  const cardinals = [
    { deg: 0, label: "N", color: "#e08040" },
    { deg: 90, label: "E", color: "#9ec8e0" },
    { deg: 180, label: "S", color: "#9ec8e0" },
    { deg: 270, label: "W", color: "#9ec8e0" },
  ];

  // Arrow points TOWARD where the wind is going (opposite of `from` direction).
  // Standard meteorology: dirDeg = "from" direction. Arrow body sits at the rim
  // on the FROM side and points toward center / opposite cardinal.
  let arrow = null;
  if (has) {
    const fromDeg = ((dirDeg % 360) + 360) % 360;
    const [fx, fy] = vec(fromDeg);             // outer end (from rim)
    const [tx, ty] = vec(fromDeg + 180);       // inner direction (toward)
    const tipR = r - 14;
    const tailR = r - 28;
    const tipX = cx + tx * tipR;
    const tipY = cy + ty * tipR;
    const tailX = cx + fx * (r - 18);
    const tailY = cy + fy * (r - 18);
    // arrow head perpendicular
    const perp = [-ty, tx];
    const headW = 8;
    const baseX = cx + tx * (tipR - 14);
    const baseY = cy + ty * (tipR - 14);
    arrow = (
      <g>
        <line x1={tailX} y1={tailY} x2={baseX} y2={baseY}
              stroke="#f0c040" strokeWidth={3} strokeLinecap="round" />
        <polygon
          points={`${tipX},${tipY} ${baseX + perp[0]*headW},${baseY + perp[1]*headW} ${baseX - perp[0]*headW},${baseY - perp[1]*headW}`}
          fill="#f0c040" />
      </g>
    );
  }

  const dirText = has ? `${Math.round(((dirDeg % 360) + 360) % 360)}°` : "—";
  const cardText = has ? cardinalLabel(dirDeg) : "";

  return (
    <div style={{
      flex: "0 0 auto",
      background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
      border: "1px solid rgba(126,171,200,0.18)",
      borderRadius: 8,
      padding: "12px 14px",
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase" }}>
        {label}
      </div>
      <svg width="100%" height="auto" viewBox={`0 0 ${size} ${size}`}
           style={{ display: "block", maxWidth: size, width: "100%", height: "auto" }}>
        <circle cx={cx} cy={cy} r={r}
                fill="rgba(8,22,36,0.55)"
                stroke="rgba(126,171,200,0.25)" strokeWidth={1} />
        {ticks}
        {cardinals.map(({ deg, label: lab, color }) => {
          const [tx, ty] = vec(deg);
          const lr = r - 22;
          return (
            <text key={lab}
                  x={cx + tx * lr} y={cy + ty * lr + 4}
                  fontSize={12} fontFamily="monospace"
                  fill={color} fontWeight={deg === 0 ? 700 : 500}
                  textAnchor="middle">{lab}</text>
          );
        })}
        {arrow}
        <circle cx={cx} cy={cy} r={4} fill="#e8f4f8" />
      </svg>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: "serif", fontSize: 22, fontWeight: 700, color: "#e8f4f8" }}>{dirText}</span>
        {cardText && <span style={{ fontSize: 11, color: "#9ec8e0", fontFamily: "monospace" }}>{cardText}</span>}
      </div>
      <div style={{ fontSize: 9, letterSpacing: 1, color: "#5a8aaa", textTransform: "uppercase" }}>
        from
      </div>
    </div>
  );
}
