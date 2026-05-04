import { useMemo } from "react";

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

// 16 compass sectors of 22.5° each, centered on N, NNE, NE...
const SECTORS = 16;
const SECTOR_DEG = 360 / SECTORS;

// Speed bins (knots). Tunable.
const SPEED_BINS = [
  { label: "< 6 kn",   max: 6,   color: "#6ab0e8" },
  { label: "6–14 kn",  max: 14,  color: "#2a9a4a" },
  { label: "14–24 kn", max: 24,  color: "#f0c040" },
  { label: "> 24 kn",  max: Infinity, color: "#e08040" },
];

// Compass-degree → screen vector (N=top, E=right).
function vec(deg) {
  const r = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

// SVG arc + radial wedge from center for one sector.
function wedgePath(cx, cy, r0, r1, a1Deg, a2Deg) {
  const [x1o, y1o] = vec(a1Deg); const [x2o, y2o] = vec(a2Deg);
  const [x1i, y1i] = vec(a1Deg); const [x2i, y2i] = vec(a2Deg);
  const ox1 = cx + x1o * r1, oy1 = cy + y1o * r1;
  const ox2 = cx + x2o * r1, oy2 = cy + y2o * r1;
  const ix1 = cx + x1i * r0, iy1 = cy + y1i * r0;
  const ix2 = cx + x2i * r0, iy2 = cy + y2i * r0;
  // small arc — sweep flag 1 because going clockwise
  return [
    `M ${ix1} ${iy1}`,
    `L ${ox1} ${oy1}`,
    `A ${r1} ${r1} 0 0 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${r0} ${r0} 0 0 0 ${ix1} ${iy1}`,
    `Z`,
  ].join(" ");
}

/**
 * Frequency wind rose.
 *
 * props:
 *   rows           array of {ts, wind_true_dir_deg, wind_true_speed_kn, ...}
 *   size           px (square)
 *   title          optional title
 *
 * Wedges are sized by the % of samples blowing FROM each direction
 * (meteorological convention — same as BoatWindRose). Each wedge is
 * vertically stacked by speed bin.
 */
export default function WindRoseHistory({ rows, size = 360, title }) {
  const stats = useMemo(() => {
    const sectorBins = Array.from({ length: SECTORS }, () =>
      SPEED_BINS.map(() => 0)
    );
    let total = 0; let calm = 0;
    for (const r of rows || []) {
      const dir = r.wind_true_dir_deg;
      const spd = r.wind_true_speed_kn;
      if (!isNum(dir) || !isNum(spd)) continue;
      total++;
      if (spd < 0.5) { calm++; continue; }
      const sector = Math.floor((((dir % 360) + 360) % 360 + SECTOR_DEG / 2) / SECTOR_DEG) % SECTORS;
      const bin = SPEED_BINS.findIndex((b) => spd < b.max);
      sectorBins[sector][bin >= 0 ? bin : SPEED_BINS.length - 1]++;
    }
    // Convert to fractions (of total non-calm); compute peak fraction for scaling.
    const fractions = sectorBins.map((bins) => bins.map((c) => total ? c / total : 0));
    const sectorTotals = fractions.map((bs) => bs.reduce((a, b) => a + b, 0));
    const peak = Math.max(0.0001, ...sectorTotals);
    return { fractions, sectorTotals, total, calm, peak };
  }, [rows]);

  const cx = size / 2;
  const cy = size / 2;
  const rMax = size / 2 - 32;
  const rMin = 8;

  // Choose nice ring percentages
  const peakPct = stats.peak * 100;
  const ringStep = peakPct > 30 ? 10 : peakPct > 15 ? 5 : peakPct > 6 ? 2 : 1;
  const rings = [];
  for (let p = ringStep; p <= peakPct + 0.001; p += ringStep) rings.push(p);

  const cardinals = [
    { label: "N",  deg: 0   },
    { label: "NE", deg: 45  },
    { label: "E",  deg: 90  },
    { label: "SE", deg: 135 },
    { label: "S",  deg: 180 },
    { label: "SW", deg: 225 },
    { label: "W",  deg: 270 },
    { label: "NW", deg: 315 },
  ];

  return (
    <div style={{
      background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
      border: "1px solid rgba(126,171,200,0.18)",
      borderRadius: 8, padding: "14px 16px",
      display: "flex", flexDirection: "column", alignItems: "center",
    }}>
      {title && (
        <div style={{
          alignSelf: "flex-start", fontSize: 9, letterSpacing: 2,
          color: "#7eabc8", textTransform: "uppercase", marginBottom: 4,
        }}>{title}</div>
      )}

      <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size }}>
        {/* radial guide rings + percent labels */}
        {rings.map((p) => {
          const rr = rMin + ((rMax - rMin) * p) / peakPct;
          return (
            <g key={p}>
              <circle cx={cx} cy={cy} r={rr} fill="none"
                      stroke="rgba(126,171,200,0.15)" strokeWidth={1} strokeDasharray="2 4" />
              <text x={cx + 4} y={cy - rr - 2} fontSize={9}
                    fontFamily="monospace" fill="#5a8aaa">{p}%</text>
            </g>
          );
        })}

        {/* cardinal cross + labels */}
        {cardinals.map(({ label, deg }) => {
          const [x, y] = vec(deg);
          const lx = cx + x * (rMax + 18);
          const ly = cy + y * (rMax + 18) + 4;
          return (
            <g key={label}>
              {(deg % 90 === 0) && (
                <line x1={cx} y1={cy} x2={cx + x * rMax} y2={cy + y * rMax}
                      stroke="rgba(126,171,200,0.25)" strokeWidth={1} />
              )}
              <text x={lx} y={ly} fontSize={11} fontFamily="monospace"
                    fill={deg === 0 ? "#e08040" : "#9ec8e0"}
                    fontWeight={deg === 0 ? 700 : 500}
                    textAnchor="middle">{label}</text>
            </g>
          );
        })}

        {/* wedges per sector, stacked by speed bin */}
        {stats.fractions.map((bins, sector) => {
          const center = sector * SECTOR_DEG;          // sector center in compass deg
          const a1 = center - SECTOR_DEG / 2 + 1;       // small gap
          const a2 = center + SECTOR_DEG / 2 - 1;
          let inner = rMin;
          return bins.map((frac, bi) => {
            if (frac <= 0) return null;
            const ringR = (frac / stats.peak) * (rMax - rMin);
            const outer = inner + ringR;
            const path = wedgePath(cx, cy, inner, outer, a1, a2);
            const node = (
              <path key={`${sector}-${bi}`} d={path} fill={SPEED_BINS[bi].color}
                    fillOpacity={0.85} stroke="rgba(8,22,36,0.7)" strokeWidth={0.8} />
            );
            inner = outer;
            return node;
          });
        })}

        {/* center hub */}
        <circle cx={cx} cy={cy} r={rMin - 1} fill="rgba(13,36,56,0.85)"
                stroke="rgba(126,171,200,0.4)" strokeWidth={1} />
        <text x={cx} y={cy + 3} fontSize={9} textAnchor="middle"
              fontFamily="monospace" fill="#7eabc8">
          {stats.total ? `${stats.total}` : "—"}
        </text>
      </svg>

      <div style={{
        marginTop: 8, display: "flex", flexWrap: "wrap", gap: 12,
        justifyContent: "center", fontSize: 10, color: "#9ec8e0",
        fontFamily: "monospace", letterSpacing: 0.5,
      }}>
        {SPEED_BINS.map((b) => (
          <span key={b.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{
              display: "inline-block", width: 12, height: 12, borderRadius: 3,
              background: b.color, border: "1px solid rgba(8,22,36,0.5)",
            }} />
            {b.label}
          </span>
        ))}
        {stats.total > 0 && (
          <span style={{ color: "#5a8aaa" }}>
            calm {stats.total ? Math.round((stats.calm / stats.total) * 100) : 0}%
            · {stats.total} samples
          </span>
        )}
      </div>
    </div>
  );
}
