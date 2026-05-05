import { useEffect, useMemo, useRef, useState } from "react";
import BoatWindRose from "./BoatWindRose";
import WindRoseHistory from "./WindRoseHistory";
import { scenarioColumn } from "../lib/scenarioFields";

/**
 * Interactive telemetry history charts with range + metric-group filters.
 * Uses the same /api/telemetry/<slug>/history endpoint as the strip.
 */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const RANGES = [
  { key: "1h",  label: "1h",  hours: 1   },
  { key: "6h",  label: "6h",  hours: 6   },
  { key: "24h", label: "24h", hours: 24  },
  { key: "7d",  label: "7d",  hours: 168 },
  { key: "30d", label: "30d", hours: 720 },
];

const GROUPS = [
  {
    key: "power",
    label: "Power",
    metrics: [
      { key: "battery_v",    label: "Battery",        unit: "V",   color: "#2a9a4a", digits: 2 },
      { key: "battery_pct",  label: "Battery charge", unit: "%",   color: "#9ec8e0", digits: 0 },
      { key: "ac_power_w",   label: "AC power",       unit: "W",   color: "#f0c040", digits: 0 },
      { key: "ac_voltage_v", label: "AC voltage",     unit: "V",   color: "#f0c040", digits: 1 },
      { key: "ac_current_a", label: "AC current",     unit: "A",   color: "#f0c040", digits: 2 },
      { key: "ac_kwh_total", label: "kWh total",      unit: "kWh", color: "#f0c040", digits: 2 },
    ],
  },
  {
    key: "climate",
    label: "Climate",
    metrics: [
      { key: "cabin_temp_c", label: "Cabin temp",     unit: "°C",   color: "#f0a040", digits: 1 },
      { key: "cabin_humid",  label: "Cabin humidity", unit: "%",    color: "#9ec8e0", digits: 0 },
      { key: "dewpoint_c",   label: "Dew point",      unit: "°C",   color: "#9ec8e0", digits: 1 },
      { key: "air_temp_c",   label: "Air temp",       unit: "°C",   color: "#9ec8e0", digits: 1 },
      { key: "water_temp_c", label: "Sea temp",       unit: "°C",   color: "#6ab0e8", digits: 1 },
      { key: "pressure_mbar",label: "Pressure",       unit: "mbar", color: "#9ec8e0", digits: 0 },
    ],
  },
  {
    key: "bilge",
    label: "Bilge",
    metrics: [
      { key: "bilge_water_cm", label: "Water level",      unit: "cm", color: "#6ab0e8", digits: 1 },
      { key: "bilge_pump_24h", label: "Pump cycles 24h",  unit: "",   color: "#e08040", digits: 0 },
    ],
  },
  {
    key: "wind",
    label: "Wind",
    metrics: [
      { key: "wind_true_speed_kn",  label: "True wind speed",     unit: "kn",  color: "#9ec8e0", digits: 1 },
      { key: "wind_true_dir_deg",   label: "True wind direction", unit: "°",   color: "#9ec8e0", digits: 0 },
      { key: "wind_app_speed_kn",   label: "App. wind speed",     unit: "kn",  color: "#7eabc8", digits: 1 },
      { key: "wind_app_angle_deg",  label: "App. wind angle",     unit: "°",   color: "#7eabc8", digits: 0 },
    ],
  },
  {
    key: "motion",
    label: "Motion",
    metrics: [
      { key: "heel_deg",     label: "Heel",     unit: "°",  color: "#9ec8e0", digits: 1 },
      { key: "pitch_deg",    label: "Pitch",    unit: "°",  color: "#9ec8e0", digits: 1 },
      { key: "heading_deg",  label: "Heading",  unit: "°",  color: "#9ec8e0", digits: 0 },
      { key: "boat_speed_kn",label: "Boat speed",unit:"kn", color: "#9ec8e0", digits: 1 },
      { key: "sog_kn",       label: "SOG",      unit: "kn", color: "#9ec8e0", digits: 1 },
      { key: "water_depth_m",label: "Depth",    unit: "m",  color: "#6ab0e8", digits: 1 },
    ],
  },
];

function fmtAxisTime(ts, spanMs) {
  const d = new Date(ts);
  if (spanMs <= 6 * 3600 * 1000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (spanMs <= 48 * 3600 * 1000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function niceTicks(min, max, count = 4) {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const range = max - min;
  const step0 = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

function Chart({ rows, metric, hoverTs, setHoverTs, scenarios = [] }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 140 });

  // Track container width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setSize((s) => (s.w === cr.width ? s : { w: Math.max(120, cr.width), h: s.h }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Filter & range.
  const pts = useMemo(() => rows
    .map((r) => ({ ts: new Date(r.ts).getTime(), v: r[metric.key] }))
    .filter((p) => isNum(p.v) && isNum(p.ts)), [rows, metric.key]);

  // Scenarios that bind to this metric — drawn as threshold + shaded
  // regions where the rule's condition was satisfied.
  const matchingScenarios = useMemo(
    () => (scenarios || []).filter((s) => s && s.enabled !== false && scenarioColumn(s.field) === metric.key),
    [scenarios, metric.key],
  );

  const stats = useMemo(() => {
    if (!pts.length) return null;
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (const p of pts) { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; sum += p.v; }
    return { min: mn, max: mx, avg: sum / pts.length, last: pts[pts.length - 1].v, lastTs: pts[pts.length - 1].ts };
  }, [pts]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = size.w;
    const h = size.h;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (pts.length < 2) {
      ctx.fillStyle = "rgba(126,171,200,0.5)";
      ctx.font = "11px sans-serif";
      ctx.fillText(pts.length === 0 ? "no data in range" : "only one sample", 8, h / 2);
      return;
    }

    const padL = 44, padR = 10, padT = 8, padB = 22;
    const t0 = pts[0].ts;
    const t1 = pts[pts.length - 1].ts;
    const tSpan = Math.max(t1 - t0, 1);
    let vMin = Infinity, vMax = -Infinity;
    for (const p of pts) { if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v; }
    // Expand range so scenario thresholds are always visible.
    for (const s of matchingScenarios) {
      const t = Number(s.threshold);
      if (Number.isFinite(t)) {
        if (t < vMin) vMin = t;
        if (t > vMax) vMax = t;
      }
    }
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vPad = (vMax - vMin) * 0.08;
    vMin -= vPad; vMax += vPad;
    const vSpan = vMax - vMin;

    const x = (t) => padL + ((t - t0) / tSpan) * (w - padL - padR);
    const y = (v) => padT + (1 - (v - vMin) / vSpan) * (h - padT - padB);

    // Y grid + labels.
    const yTicks = niceTicks(vMin, vMax, 4);
    ctx.strokeStyle = "rgba(126,171,200,0.10)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#5a8aaa";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of yTicks) {
      const yy = y(t);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
      ctx.fillText(metric.digits != null ? t.toFixed(metric.digits) : String(t), padL - 4, yy);
    }

    // X axis ticks.
    const xTickCount = Math.max(2, Math.min(6, Math.floor((w - padL - padR) / 90)));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= xTickCount; i++) {
      const tt = t0 + (tSpan * i) / xTickCount;
      const xx = x(tt);
      ctx.fillText(fmtAxisTime(tt, tSpan), xx, h - padB + 4);
    }

    // Area fill.
    ctx.beginPath();
    ctx.moveTo(x(pts[0].ts), h - padB);
    for (const p of pts) ctx.lineTo(x(p.ts), y(p.v));
    ctx.lineTo(x(pts[pts.length - 1].ts), h - padB);
    ctx.closePath();
    ctx.fillStyle = (metric.color || "#9ec8e0") + "22";
    ctx.fill();

    // Line.
    ctx.beginPath();
    ctx.moveTo(x(pts[0].ts), y(pts[0].v));
    for (const p of pts) ctx.lineTo(x(p.ts), y(p.v));
    ctx.strokeStyle = metric.color || "#9ec8e0";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Scenario threshold lines + active-region shading.
    // For each scenario bound to this metric, draw a dashed horizontal line
    // at the threshold and shade the time intervals during which the rule's
    // condition was satisfied. Hysteresis isn't simulated here — we just
    // highlight raw threshold crossings, which is what the user is reasoning
    // about when designing rules.
    if (matchingScenarios.length) {
      const scenColor = "#ffd166";
      ctx.font = "10px sans-serif";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      for (const s of matchingScenarios) {
        const thr = Number(s.threshold);
        if (!Number.isFinite(thr)) continue;
        const cond = s.condition === "lt" ? "lt" : "gt";

        // Shade matching intervals.
        ctx.fillStyle = "rgba(255,209,102,0.10)";
        let inRun = false;
        let runStartX = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const matched = cond === "gt" ? p.v > thr : p.v < thr;
          const px = x(p.ts);
          if (matched && !inRun) { inRun = true; runStartX = px; }
          else if (!matched && inRun) {
            ctx.fillRect(runStartX, padT, Math.max(1, px - runStartX), h - padT - padB);
            inRun = false;
          }
        }
        if (inRun) {
          const lastX = x(pts[pts.length - 1].ts);
          ctx.fillRect(runStartX, padT, Math.max(1, lastX - runStartX), h - padT - padB);
        }

        // Threshold line.
        const yy = y(thr);
        ctx.strokeStyle = scenColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, yy);
        ctx.lineTo(w - padR, yy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label, clamped to visible band.
        const labelText = `${s.name || "scenario"} · ${cond === "gt" ? ">" : "<"} ${thr}${metric.unit ? " " + metric.unit : ""}`;
        const labelY = Math.max(padT + 10, Math.min(h - padB - 2, yy - 2));
        ctx.fillStyle = scenColor;
        ctx.fillText(labelText, padL + 4, labelY);
      }
    }

    // Hover crosshair + dot.
    if (isNum(hoverTs) && hoverTs >= t0 && hoverTs <= t1) {
      // Find nearest point.
      let near = pts[0], best = Infinity;
      for (const p of pts) {
        const d = Math.abs(p.ts - hoverTs);
        if (d < best) { best = d; near = p; }
      }
      const hx = x(near.ts);
      const hy = y(near.v);
      ctx.strokeStyle = "rgba(158,200,224,0.4)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, padT);
      ctx.lineTo(hx, h - padB);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = metric.color || "#9ec8e0";
      ctx.beginPath();
      ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(9,28,44,0.9)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }, [pts, size, metric, hoverTs, matchingScenarios]);

  // Hover handler — translate mouse x to ts in shared scale.
  const onMove = (e) => {
    if (!pts.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const padL = 44, padR = 10;
    const inner = rect.width - padL - padR;
    const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts;
    const ts = t0 + ((mx - padL) / inner) * (t1 - t0);
    setHoverTs(ts);
  };
  const onLeave = () => setHoverTs(null);

  // Hover sample lookup for stats.
  const hoverPt = useMemo(() => {
    if (!isNum(hoverTs) || !pts.length) return null;
    let near = pts[0], best = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.ts - hoverTs);
      if (d < best) { best = d; near = p; }
    }
    return near;
  }, [hoverTs, pts]);

  const fmt = (v) => v == null ? "—" : Number(v).toFixed(metric.digits ?? 1);
  const showVal = hoverPt ? hoverPt.v : stats?.last;
  const showTs  = hoverPt ? hoverPt.ts : stats?.lastTs;

  return (
    <div ref={wrapRef} style={{
      background: "linear-gradient(180deg, rgba(13,36,56,0.65), rgba(9,28,44,0.65))",
      border: "1px solid rgba(126,171,200,0.18)",
      borderRadius: 8, padding: "10px 12px",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "baseline", marginBottom: 6, gap: 12, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 10, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase" }}>
          {metric.label}
        </span>
        <span style={{ fontSize: 16, color: metric.color || "#e8f4f8", fontFamily: "Georgia, serif" }}>
          {fmt(showVal)}
          <span style={{ fontSize: 10, color: "#5a8aaa", marginLeft: 4 }}>{metric.unit || ""}</span>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ width: "100%", height: 140, display: "block", cursor: "crosshair" }}
      />
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 6, fontSize: 10, color: "#5a8aaa", flexWrap: "wrap", gap: 8,
      }}>
        {stats ? (
          <>
            <span>min <span style={{color:"#9ec8e0"}}>{fmt(stats.min)}</span></span>
            <span>avg <span style={{color:"#9ec8e0"}}>{fmt(stats.avg)}</span></span>
            <span>max <span style={{color:"#9ec8e0"}}>{fmt(stats.max)}</span></span>
            <span>{showTs ? new Date(showTs).toLocaleString() : ""}</span>
          </>
        ) : <span>no samples</span>}
      </div>
    </div>
  );
}

function Chip({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "rgba(158,200,224,0.18)" : "rgba(13,36,56,0.6)",
        border: `1px solid ${active ? "rgba(158,200,224,0.5)" : "rgba(126,171,200,0.18)"}`,
        color: active ? "#e8f4f8" : "#9ec8e0",
        borderRadius: 999, padding: "4px 12px", fontSize: 11, letterSpacing: 1,
        textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
      }}
    >{children}</button>
  );
}

function avgAngleDeg(degs) {
  if (!degs.length) return null;
  let sx = 0, sy = 0;
  for (const d of degs) {
    const r = (d * Math.PI) / 180;
    sx += Math.cos(r); sy += Math.sin(r);
  }
  const a = (Math.atan2(sy, sx) * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
}

function WindHistoryRose({ rows, loading, err, rangeLabel }) {
  const { latest, agg } = useMemo(() => {
    if (!rows.length) return { latest: null, agg: null };
    // Find the most-recent row that has any wind field, plus aggregates over window.
    let latest = null;
    const trueDirs = []; const trueSpeeds = []; const appAngs = []; const appSpeeds = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (
        latest === null &&
        (isNum(r.wind_true_dir_deg) || isNum(r.wind_true_speed_kn) || isNum(r.wind_app_angle_deg) || isNum(r.wind_app_speed_kn) || isNum(r.heading_deg) || isNum(r.cog_deg))
      ) latest = r;
    }
    for (const r of rows) {
      if (isNum(r.wind_true_dir_deg))    trueDirs.push(r.wind_true_dir_deg);
      if (isNum(r.wind_true_speed_kn))   trueSpeeds.push(r.wind_true_speed_kn);
      if (isNum(r.wind_app_angle_deg))   appAngs.push(r.wind_app_angle_deg);
      if (isNum(r.wind_app_speed_kn))    appSpeeds.push(r.wind_app_speed_kn);
    }
    const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const agg = {
      avgTrueDir:   avgAngleDeg(trueDirs),
      avgTrueSpeed: avg(trueSpeeds),
      maxTrueSpeed: trueSpeeds.length ? Math.max(...trueSpeeds) : null,
      avgAppAngle:  appAngs.length ? avg(appAngs) : null,
      avgAppSpeed:  avg(appSpeeds),
      maxAppSpeed:  appSpeeds.length ? Math.max(...appSpeeds) : null,
      samples:      Math.max(trueDirs.length, trueSpeeds.length, appAngs.length, appSpeeds.length),
    };
    return { latest, agg };
  }, [rows]);

  if (loading) return <div style={{ fontSize: 12, color: "#5a8aaa", padding: "24px 12px", textAlign: "center" }}>loading…</div>;
  if (err)     return <div style={{ fontSize: 12, color: "#e08040", padding: "24px 12px", textAlign: "center" }}>error: {err}</div>;
  if (!latest) {
    return (
      <div style={{
        fontSize: 12, color: "#5a8aaa", padding: "24px 12px",
        border: "1px dashed rgba(126,171,200,0.18)", borderRadius: 8, textAlign: "center",
      }}>
        no <b style={{ color: "#9ec8e0" }}>wind</b> data in the last {rangeLabel} — try another range
      </div>
    );
  }

  const stat = (label, val, unit) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 14, color: "#e8f4f8" }}>
        {val == null ? "—" : `${val}${unit ? " " + unit : ""}`}
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{
        display: "grid", gridTemplateColumns: "auto 1fr", gap: 18, alignItems: "center",
        background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
        border: "1px solid rgba(126,171,200,0.18)",
        borderRadius: 8, padding: "14px 18px",
      }}>
        <BoatWindRose
          size={240}
          trueDirDeg={isNum(latest.wind_true_dir_deg) ? latest.wind_true_dir_deg : null}
          trueSpeedKn={isNum(latest.wind_true_speed_kn) ? latest.wind_true_speed_kn : null}
          apparentAngle={isNum(latest.wind_app_angle_deg) ? latest.wind_app_angle_deg : null}
          apparentSpeedKn={isNum(latest.wind_app_speed_kn) ? latest.wind_app_speed_kn : null}
          headingDeg={isNum(latest.heading_deg) ? latest.heading_deg : null}
          cogDeg={isNum(latest.cog_deg) ? latest.cog_deg : null}
        />
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 14,
        }}>
          {stat("Last sample", new Date(latest.ts).toLocaleString())}
          {stat("Avg true dir", agg.avgTrueDir != null ? `${Math.round(agg.avgTrueDir)}°` : null)}
          {stat("Avg true speed", agg.avgTrueSpeed != null ? agg.avgTrueSpeed.toFixed(1) : null, "kn")}
          {stat("Max true gust", agg.maxTrueSpeed != null ? agg.maxTrueSpeed.toFixed(1) : null, "kn")}
          {stat("Avg app speed", agg.avgAppSpeed != null ? agg.avgAppSpeed.toFixed(1) : null, "kn")}
          {stat("Max app gust", agg.maxAppSpeed != null ? agg.maxAppSpeed.toFixed(1) : null, "kn")}
          {stat("Samples", agg.samples)}
        </div>
      </div>
      <WindRoseHistory rows={rows} size={360} title={`Wind rose · last ${rangeLabel}`} />
    </div>
  );
}

export default function TelemetryHistoryChart({ slug, defaultRange = "24h", defaultGroup = "power", scenarios = [] }) {
  const [rangeKey, setRangeKey] = useState(defaultRange);
  const [groupKey, setGroupKey] = useState(defaultGroup);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [hoverTs, setHoverTs] = useState(null);

  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[2];
  const group = GROUPS.find((g) => g.key === groupKey) || GROUPS[0];

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    fetch(`/api/telemetry/${slug}/history?hours=${range.hours}&limit=5000`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) { setErr(j?.error || "load failed"); setRows([]); }
        else { setRows(Array.isArray(j.rows) ? j.rows : []); }
      })
      .catch(() => { if (alive) setErr("network error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug, range.hours]);

  const present = useMemo(
    () => group.metrics.filter((m) => rows.some((r) => isNum(r[m.key]))),
    [group, rows],
  );

  // Which groups have ANY data in the current window — used to hide empty chips.
  const groupsWithData = useMemo(() => {
    const set = new Set();
    for (const g of GROUPS) {
      if (g.metrics.some((m) => rows.some((r) => isNum(r[m.key])))) set.add(g.key);
    }
    return set;
  }, [rows]);

  // If selected group has no data but others do, switch to the first non-empty one.
  useEffect(() => {
    if (loading || err) return;
    if (groupsWithData.size === 0) return;
    if (!groupsWithData.has(groupKey)) {
      const next = GROUPS.find((g) => groupsWithData.has(g.key));
      if (next) setGroupKey(next.key);
    }
  }, [groupsWithData, groupKey, loading, err]);

  const dataSpan = useMemo(() => {
    if (!rows.length) return null;
    const ts = rows.map((r) => new Date(r.ts).getTime()).filter(isNum);
    if (!ts.length) return null;
    const first = Math.min(...ts);
    const last = Math.max(...ts);
    const spanMs = last - first;
    let spanLabel;
    if (spanMs < 60_000) spanLabel = `${Math.round(spanMs / 1000)}s`;
    else if (spanMs < 3_600_000) spanLabel = `${Math.round(spanMs / 60_000)}m`;
    else if (spanMs < 86_400_000) spanLabel = `${(spanMs / 3_600_000).toFixed(1)}h`;
    else spanLabel = `${(spanMs / 86_400_000).toFixed(1)}d`;
    return { first, last, spanLabel };
  }, [rows]);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {RANGES.map((r) => (
          <Chip key={r.key} active={r.key === rangeKey} onClick={() => setRangeKey(r.key)}>
            {r.label}
          </Chip>
        ))}
        <span style={{ width: 12 }} />
        {/* Only render group chips once data has loaded — otherwise we flash
            chips (e.g. Power, Bilge) that this boat doesn't actually have,
            then they vanish a moment later when rows arrive. */}
        {!loading && !err && GROUPS.filter((g) => groupsWithData.has(g.key)).map((g) => (
          <Chip key={g.key} active={g.key === groupKey} onClick={() => setGroupKey(g.key)}>
            {g.label}
          </Chip>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#5a8aaa", alignSelf: "center", textAlign: "right" }}>
          {loading
            ? "loading…"
            : err
              ? `error: ${err}`
              : rows.length === 0
                ? `no data in last ${range.label}`
                : dataSpan
                  ? `${rows.length} samples spanning ${dataSpan.spanLabel} (window ${range.label})`
                  : `${rows.length} samples · last ${range.label}`}
        </span>
      </div>

      {!loading && !err && present.length === 0 && groupKey !== "wind" && groupsWithData.has(groupKey) && (
        <div style={{
          fontSize: 12, color: "#5a8aaa", padding: "24px 12px",
          border: "1px dashed rgba(126,171,200,0.18)", borderRadius: 8, textAlign: "center",
        }}>
          no <b style={{ color: "#9ec8e0" }}>{group.label.toLowerCase()}</b> data in the last {range.label} — try another range or group
        </div>
      )}

      {groupKey === "wind" ? (
        <WindHistoryRose rows={rows} loading={loading} err={err} rangeLabel={range.label} />
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 12,
        }}>
          {present.map((m) => (
            <Chart key={m.key} rows={rows} metric={m} hoverTs={hoverTs} setHoverTs={setHoverTs} scenarios={scenarios} />
          ))}
        </div>
      )}
    </div>
  );
}
