/**
 * Compass-oriented wind rose for the boat detail page.
 *
 * Inputs (any may be missing — the rose degrades gracefully):
 *   trueDirDeg     — true wind compass bearing (FROM), 0..360 (N=0, E=90).
 *                    Source: NMEA0183 MWD / MDA (network), preferred.
 *   trueSpeedKn    — true wind speed in knots (centre readout).
 *   apparentAngle  — apparent wind angle relative to bow, -180..180
 *                    (port = negative, starboard = positive). Source: MWV/VWR.
 *   apparentSpeedKn
 *   headingDeg     — boat heading true (0..360). Source: VHW / HDT / HDG.
 *   cogDeg         — course over ground (true). Source: RMC / AIS.
 *
 * Convention: arrows point FROM where the wind comes (meteorological),
 * i.e. an arrow's tail sits on the source compass bearing and the head
 * points toward the centre. Same as paper charts.
 */

const CARDINALS = [
  ["N",   0],
  ["NE",  45],
  ["E",   90],
  ["SE",  135],
  ["S",   180],
  ["SW",  225],
  ["W",   270],
  ["NW",  315],
];

// Compass deg → screen vector (N=top, E=right).
function vec(deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function knToMs(kn) {
  return kn * 0.514444;
}

export default function BoatWindRose({
  trueDirDeg,
  trueSpeedKn,
  apparentAngle,
  apparentSpeedKn,
  headingDeg,
  cogDeg,
  centerModeLabel,
  relativeModeLabel,
  size = 240,
}) {
  const c = size / 2;
  const r = c - 18;

  const hasHeading = num(headingDeg);
  const hasCog = num(cogDeg);
  // Bow direction for apparent-wind plotting. Prefer true heading; fall back
  // to course over ground for sailboats moving without a heading sensor.
  const bow = hasHeading ? headingDeg : (hasCog ? cogDeg : null);

  const hasTrue = num(trueDirDeg);
  const hasApparent = num(apparentAngle);
  const hasApparentSpeed = num(apparentSpeedKn);
  // Apparent wind bearing = bow + relative angle. If bow is unavailable,
  // render in relative mode with a virtual bow at north so direction remains visible.
  const apparentRef = bow !== null ? bow : 0;
  const apparentIsRelative = bow === null;
  const apparentDir = hasApparent
    ? ((apparentRef + apparentAngle) % 360 + 360) % 360
    : null;
  const centerSpeedKn = num(trueSpeedKn) ? trueSpeedKn : (hasApparentSpeed ? apparentSpeedKn : null);
  const centerMode = centerModeLabel || (num(trueSpeedKn) ? "M/S TRUE" : (hasApparentSpeed ? "M/S APP" : "M/S TRUE"));
  const relLabel = relativeModeLabel || "APP";

  // Body-relative mode: rotate entire rose so boat always points up
  const isBodyRelative = bow !== null;
  const rotationDeg = isBodyRelative ? -bow : 0;

  // Convert wind bearing FROM to an arrow that points TO the centre.
  function arrow(deg, color, width = 3, length = r - 8, tailOffset = 14) {
    // If body-relative, adjust the bearing by rotation
    const bearingDeg = isBodyRelative ? ((deg - rotationDeg) % 360 + 360) % 360 : deg;
    const [vx, vy] = vec(bearingDeg);
    const tipX = c + vx * tailOffset;
    const tipY = c + vy * tailOffset;
    const tailX = c + vx * length;
    const tailY = c + vy * length;
    return (
      <g>
        <line
          x1={tailX} y1={tailY} x2={tipX} y2={tipY}
          stroke={color} strokeWidth={width} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
        />
        {/* arrowhead at the tip */}
        <polygon
          points={(() => {
            const ang = Math.atan2(tipY - tailY, tipX - tailX);
            const ah = 8;
            const aw = 5;
            const bx = tipX - Math.cos(ang) * ah;
            const by = tipY - Math.sin(ang) * ah;
            const lx = bx + Math.cos(ang + Math.PI / 2) * aw;
            const ly = by + Math.sin(ang + Math.PI / 2) * aw;
            const rx = bx + Math.cos(ang - Math.PI / 2) * aw;
            const ry = by + Math.sin(ang - Math.PI / 2) * aw;
            return `${tipX},${tipY} ${lx},${ly} ${rx},${ry}`;
          })()}
          fill={color}
        />
      </g>
    );
  }

  // Bow indicator — small triangle on the rim showing boat heading.
  // In body-relative mode, always at top; in absolute mode, at boat heading.
  function bowMarker() {
    if (bow === null) return null;
    const bowDeg = isBodyRelative ? 0 : bow;  // Always top in body-relative
    const [vx, vy] = vec(bowDeg);
    const tipX = c + vx * (r + 6);
    const tipY = c + vy * (r + 6);
    const baseX = c + vx * (r - 6);
    const baseY = c + vy * (r - 6);
    const px = -vy, py = vx;
    const w = 6;
    const lx = baseX + px * w;
    const ly = baseY + py * w;
    const rx = baseX - px * w;
    const ry = baseY - py * w;
    return (
      <g>
        <polygon
          points={`${tipX},${tipY} ${lx},${ly} ${rx},${ry}`}
          fill="#e8f4f8" stroke="#7eabc8" strokeWidth="0.8"
          style={{ filter: "drop-shadow(0 0 3px rgba(232,244,248,0.45))" }}
        />
      </g>
    );
  }

  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <defs>
        <radialGradient id="windRoseBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(13,42,68,0.85)"/>
          <stop offset="100%" stopColor="rgba(7,18,28,0.95)"/>
        </radialGradient>
      </defs>

      <circle cx={c} cy={c} r={r} fill="url(#windRoseBg)" stroke="rgba(126,171,200,0.4)" strokeWidth="1"/>
      <circle cx={c} cy={c} r={r * 0.66} fill="none" stroke="rgba(126,171,200,0.12)" strokeWidth="1"/>
      <circle cx={c} cy={c} r={r * 0.33} fill="none" stroke="rgba(126,171,200,0.12)" strokeWidth="1"/>

      {/* tick marks every 10° (major every 30°) */}
      {ticks.map((deg, i) => {
        const major = i % 3 === 0;
        const len = major ? 8 : 4;
        const [vx, vy] = vec(deg);
        const x1 = c + vx * r;
        const y1 = c + vy * r;
        const x2 = c + vx * (r - len);
        const y2 = c + vy * (r - len);
        return (
          <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={major ? "rgba(200,160,80,0.85)" : "rgba(126,171,200,0.35)"}
            strokeWidth={major ? 1.4 : 0.9}/>
        );
      })}

      {/* cardinal labels */}
      {CARDINALS.map(([lbl, deg]) => {
        const labelDeg = isBodyRelative ? ((deg - rotationDeg) % 360 + 360) % 360 : deg;
        const [vx, vy] = vec(labelDeg);
        const x = c + vx * (r + 10);
        const y = c + vy * (r + 10) + 3.5;
        return (
          <text key={lbl} x={x} y={y} textAnchor="middle"
            fontSize={lbl.length === 1 ? 11 : 8.5}
            fontWeight="bold" letterSpacing="1"
            fill={isBodyRelative ? "#7eabc8" : (lbl === "N" ? "#f0c040" : "#9ec8e0")}
            fontFamily="Georgia, serif">{lbl}</text>
        );
      })}

      {/* True wind arrow — gold, dominant */}
      {hasTrue && arrow(trueDirDeg, "#f0c040", 3.5)}

      {/* Apparent wind arrow — cyan, thinner */}
      {hasApparent && arrow(apparentDir, "#6ad4e8", 2.2, r - 22, 10)}

      {/* Bow indicator */}
      {bowMarker()}

      {/* Boat shape at center — pointing north */}
      <g>
        {/* Hull */}
        <path d={`M ${c - 8},${c + 6} L ${c},${c - 12} L ${c + 8},${c + 6} Z`}
          fill="rgba(232,244,248,0.85)" stroke="#7eabc8" strokeWidth="1"/>
        {/* Keel line */}
        <line x1={c} y1={c + 6} x2={c} y2={c + 12}
          stroke="#7eabc8" strokeWidth="1" opacity="0.6"/>
      </g>

      {/* Centre readout */}
      <text x={c} y={c - 6} textAnchor="middle"
        fontSize="22" fontWeight="bold" fill="#e8f4f8" fontFamily="Georgia, serif">
        {centerSpeedKn != null ? knToMs(centerSpeedKn).toFixed(1) : "—"}
      </text>
      <text x={c} y={c + 8} textAnchor="middle"
        fontSize="8" letterSpacing="2" fill="#7eabc8">{centerMode}</text>
      {hasApparentSpeed && centerMode === "M/S TRUE" && (
        <text x={c} y={c + 22} textAnchor="middle" fontSize="8"
          fill="rgba(106,212,232,0.85)" letterSpacing="1">
          AWS {knToMs(apparentSpeedKn).toFixed(1)}
        </text>
      )}
      {isBodyRelative && (
        <>
          {hasApparent && (
            <text x={c} y={c + 34} textAnchor="middle" fontSize="7"
              fill="rgba(106,212,232,0.75)" letterSpacing="1">
              AWA {Math.round(apparentAngle)}°
            </text>
          )}
          {hasTrue && (
            <text x={c} y={hasApparent ? c + 44 : c + 34} textAnchor="middle" fontSize="7"
              fill="rgba(240,192,64,0.7)" letterSpacing="1">
              TWA {Math.round(((trueDirDeg - bow) % 360 + 360) % 360)}°
            </text>
          )}
        </>
      )}
      {!isBodyRelative && apparentIsRelative && hasApparent && (
        <text x={c} y={c + 34} textAnchor="middle" fontSize="7"
          fill="rgba(106,212,232,0.75)" letterSpacing="1">
          {relLabel} RELATIVE (BOW UP)
        </text>
      )}
      {!isBodyRelative && hasTrue && (
        <text x={c} y={apparentIsRelative && hasApparent ? c + 44 : c + 34} textAnchor="middle" fontSize="7"
          fill="rgba(240,192,64,0.7)" letterSpacing="1">
          FROM {Math.round(trueDirDeg)}°
        </text>
      )}
    </svg>
  );
}
