import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lightweight sparkline strip — fetches /api/telemetry/<slug>/history
 * once and renders one tiny <canvas> per metric. No chart library, no SSR.
 *
 * Props:
 *   slug    boat slug (string)
 *   hours   default 24
 *   metrics array of { key, label, unit, color, fmt? }
 *           where key is a column name in telemetry_history rows.
 */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function Sparkline({ rows, metricKey, color }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pts = rows
      .map((r) => ({ ts: new Date(r.ts).getTime(), v: r[metricKey] }))
      .filter((p) => isNum(p.v) && isNum(p.ts));
    if (pts.length < 2) {
      ctx.fillStyle = "rgba(126,171,200,0.4)";
      ctx.font = "10px sans-serif";
      ctx.fillText("no data", 4, h / 2 + 3);
      return;
    }
    const t0 = pts[0].ts;
    const t1 = pts[pts.length - 1].ts;
    const tSpan = Math.max(t1 - t0, 1);
    let vMin = Infinity, vMax = -Infinity;
    for (const p of pts) {
      if (p.v < vMin) vMin = p.v;
      if (p.v > vMax) vMax = p.v;
    }
    const vSpan = Math.max(vMax - vMin, 1e-6);
    const pad = 3;
    const x = (t) => pad + ((t - t0) / tSpan) * (w - pad * 2);
    const y = (v) => h - pad - ((v - vMin) / vSpan) * (h - pad * 2);

    // Fill under the line.
    ctx.beginPath();
    ctx.moveTo(x(pts[0].ts), h - pad);
    for (const p of pts) ctx.lineTo(x(p.ts), y(p.v));
    ctx.lineTo(x(pts[pts.length - 1].ts), h - pad);
    ctx.closePath();
    ctx.fillStyle = color + "22";
    ctx.fill();

    // Line.
    ctx.beginPath();
    ctx.moveTo(x(pts[0].ts), y(pts[0].v));
    for (const p of pts) ctx.lineTo(x(p.ts), y(p.v));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [rows, metricKey, color]);
  return <canvas ref={canvasRef} style={{ width: "100%", height: 36, display: "block" }} />;
}

export default function TelemetryHistoryStrip({ slug, hours = 24, metrics }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/telemetry/${slug}/history?hours=${hours}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) { setErr(j?.error || "load failed"); setRows([]); }
        else { setRows(Array.isArray(j.rows) ? j.rows : []); }
      })
      .catch(() => { if (alive) setErr("network error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug, hours]);

  const present = useMemo(
    () => metrics.filter((m) => rows.some((r) => isNum(r[m.key]))),
    [metrics, rows],
  );

  if (loading) {
    return <div style={{ fontSize: 11, color: "#5a8aaa", padding: "8px 4px" }}>loading history…</div>;
  }
  if (err) {
    return <div style={{ fontSize: 11, color: "#a08040", padding: "8px 4px" }}>history: {err}</div>;
  }
  if (!present.length) {
    return <div style={{ fontSize: 11, color: "#5a8aaa", padding: "8px 4px" }}>no history yet — collecting…</div>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
      {present.map((m) => {
        const last = [...rows].reverse().find((r) => isNum(r[m.key]));
        const lastVal = last ? last[m.key] : null;
        const display = lastVal == null
          ? "—"
          : m.fmt
            ? m.fmt(lastVal)
            : Number(lastVal).toFixed(1);
        return (
          <div key={m.key} style={{
            flex: "1 1 220px", minWidth: 200,
            background: "linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
            border: "1px solid rgba(126,171,200,0.18)",
            borderRadius: 8, padding: "10px 12px",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "baseline", marginBottom: 4,
            }}>
              <span style={{ fontSize: 9, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase" }}>
                {m.label}
              </span>
              <span style={{ fontSize: 13, color: m.color || "#e8f4f8", fontFamily: "Georgia, serif" }}>
                {display}<span style={{ fontSize: 10, color: "#5a8aaa", marginLeft: 3 }}>{m.unit || ""}</span>
              </span>
            </div>
            <Sparkline rows={rows} metricKey={m.key} color={m.color || "#9ec8e0"} />
            <div style={{ fontSize: 9, color: "#5a8aaa", marginTop: 2, textAlign: "right" }}>
              last {hours}h
            </div>
          </div>
        );
      })}
    </div>
  );
}
