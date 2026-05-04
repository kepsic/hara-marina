import { useEffect, useMemo, useState } from "react";

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Horizontal gradient bar showing where the current water depth sits within
 * the last-24h min/max envelope. Shallow (low) end is amber/red, deep end blue.
 *
 * props:
 *   slug        boat slug — used to fetch /api/telemetry/<slug>/history
 *   value       current reading in metres (number or null)
 *   hours       lookback window (default 24)
 */
export default function WaterDepthBar({ slug, value, hours = 24 }) {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true); setErr("");
    fetch(`/api/telemetry/${slug}/history?hours=${hours}&limit=5000`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) { setErr(j?.error || "load failed"); return; }
        const rows = Array.isArray(j.rows) ? j.rows : [];
        setSeries(rows.map((r) => r.water_depth_m).filter(isNum));
      })
      .catch(() => { if (alive) setErr("network error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug, hours]);

  const stats = useMemo(() => {
    if (!series.length) return null;
    let min = series[0], max = series[0], sum = 0;
    for (const v of series) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    return { min, max, avg: sum / series.length, n: series.length };
  }, [series]);

  const has = isNum(value);

  // Compute display range. If min==max (flat tide), pad by ±0.2 m for visibility.
  let lo = stats?.min ?? (has ? value - 1 : 0);
  let hi = stats?.max ?? (has ? value + 1 : 1);
  if (hi - lo < 0.4) { const mid = (hi + lo) / 2; lo = mid - 0.2; hi = mid + 0.2; }
  // Always include the current value in the rendered range.
  if (has) { lo = Math.min(lo, value); hi = Math.max(hi, value); }

  const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const valuePct = has ? pct(value) : null;
  const minPct = stats ? pct(stats.min) : null;
  const maxPct = stats ? pct(stats.max) : null;
  const avgPct = stats ? pct(stats.avg) : null;

  return (
    <div style={{
      background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
      border: "1px solid rgba(126,171,200,0.18)",
      borderRadius: 8,
      padding: "12px 16px 14px",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10,
      }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase" }}>
          Water depth · last {hours}h
        </div>
        <div style={{ fontFamily: "serif", fontSize: 28, fontWeight: "bold", color: "#e8f4f8" }}>
          {has ? value.toFixed(1) : "—"}
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "#7eabc8", marginLeft: 4 }}>m</span>
        </div>
      </div>

      <div style={{ position: "relative", height: 22 }}>
        {/* gradient bar: shallow → deep */}
        <div style={{
          position: "absolute", left: 0, right: 0, top: 8, height: 8, borderRadius: 4,
          background: "linear-gradient(90deg, #e08040 0%, #f0c040 18%, #6ab0e8 50%, #2a6fa8 100%)",
          opacity: 0.85,
        }} />
        {/* min/max range overlay (highlighted segment) */}
        {stats && (
          <div style={{
            position: "absolute", top: 6, height: 12,
            left: `${minPct}%`, width: `${Math.max(0.5, maxPct - minPct)}%`,
            border: "1px solid rgba(232,244,248,0.35)",
            borderRadius: 4,
            pointerEvents: "none",
          }} />
        )}
        {/* avg marker */}
        {avgPct != null && (
          <div title={`avg ${stats.avg.toFixed(2)} m`} style={{
            position: "absolute", top: 4, height: 16, width: 1,
            left: `calc(${avgPct}% - 0.5px)`,
            background: "rgba(232,244,248,0.55)",
          }} />
        )}
        {/* current value pointer */}
        {valuePct != null && (
          <div style={{
            position: "absolute", top: -2, height: 26, width: 2,
            left: `calc(${valuePct}% - 1px)`,
            background: "#f0c040",
            boxShadow: "0 0 6px rgba(240,192,64,0.6)",
            borderRadius: 1,
          }} />
        )}
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 6, fontFamily: "monospace", fontSize: 10, color: "#7eabc8",
      }}>
        <span>{stats ? `${stats.min.toFixed(1)} m min` : `${lo.toFixed(1)} m`}</span>
        <span style={{ color: "#5a8aaa" }}>
          {loading ? "loading…" : err ? `error: ${err}` : stats ? `${stats.n} samples · avg ${stats.avg.toFixed(1)} m` : "no history"}
        </span>
        <span>{stats ? `${stats.max.toFixed(1)} m max` : `${hi.toFixed(1)} m`}</span>
      </div>
    </div>
  );
}
