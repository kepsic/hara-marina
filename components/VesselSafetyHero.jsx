import { useEffect, useState, useCallback } from "react";

/**
 * VesselSafetyHero — single-glance safety summary card shown on top of the
 * boat dashboard. Visible to both owner and PIN viewers (read-only for the
 * latter).
 *
 * Inputs (all optional, sourced from existing dashboard state):
 *   slug         - boat slug
 *   isOwnerView  - whether to render owner action buttons
 *   tel          - latest telemetry record
 *   ais          - marina-state classification { state, label, distanceM }
 *   alerts       - watchkeeper snapshot { active: [...] }
 */

const STATUS_COLORS = {
  ok:       { bg: "rgba(42,154,74,0.10)", border: "rgba(42,154,74,0.45)", text: "#7ed8a0", label: "All clear" },
  watch:    { bg: "rgba(240,192,64,0.10)", border: "rgba(240,192,64,0.45)", text: "#f0c040", label: "Watch" },
  alarm:    { bg: "rgba(224,128,64,0.14)", border: "rgba(224,128,64,0.55)", text: "#ff9060", label: "Alarm" },
  overdue:  { bg: "rgba(224,80,80,0.18)",  border: "rgba(224,80,80,0.65)",  text: "#ff7878", label: "Overdue" },
  unknown:  { bg: "rgba(126,171,200,0.08)", border: "rgba(126,171,200,0.30)", text: "#9ec8e0", label: "Unknown" },
};

function fmtTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "-";
  return new Date(n).toLocaleString();
}

function fmtRelMin(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h}h ${r}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtDeltaMin(ms) {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 60) return `${sign}${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${sign}${h}h ${r}m`;
}

function fmtCoord(v) {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(5);
}

function pickPosition(tel) {
  const lat = Number(tel?.position?.lat);
  const lon = Number(tel?.position?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function pickLastTelemetryTs(tel) {
  const t = Number(tel?.ts);
  return Number.isFinite(t) ? t : null;
}

function deriveStatus({ tel, ais, alerts, passage, nowTs }) {
  const lastTs = pickLastTelemetryTs(tel);
  const ageMs = lastTs ? nowTs - lastTs : null;
  const activeAlerts = Array.isArray(alerts?.active) ? alerts.active : [];

  if (passage?.status === "active") {
    const eta = Number(passage.eta_ts);
    if (Number.isFinite(eta) && nowTs > eta) {
      return { tone: "overdue", primary: "Passage overdue", detail: `ETA was ${fmtTs(eta)} (${fmtDeltaMin(eta - nowTs)})` };
    }
  }

  if (activeAlerts.length > 0) {
    const labels = activeAlerts.map((a) => a.label || a.rule).filter(Boolean).join(", ");
    return { tone: "alarm", primary: "Active alarm", detail: labels || "see watchkeeper" };
  }

  if (ageMs !== null && ageMs > 60 * 60 * 1000 && ais?.state !== "underway" && ais?.state !== "away") {
    return { tone: "watch", primary: "Signal lost", detail: `last contact ${fmtRelMin(ageMs)}` };
  }

  if (passage?.status === "active") {
    const eta = Number(passage.eta_ts);
    const dest = passage?.destination?.name || "destination";
    const etaTxt = Number.isFinite(eta) ? `ETA ${new Date(eta).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : "ETA -";
    return { tone: "watch", primary: `On passage → ${dest}`, detail: etaTxt };
  }

  if (ais?.state === "moored") return { tone: "ok", primary: "Moored at Hara Sadam", detail: ais.label || "" };
  if (ais?.state === "anchored_nearby") return { tone: "ok", primary: "Anchored near marina", detail: ais.label || "" };
  if (ais?.state === "underway") return { tone: "watch", primary: "Underway", detail: ais.label || "" };
  if (ais?.state === "away") return { tone: "watch", primary: "Away from marina", detail: ais.label || "" };

  // Fresh telemetry but no GPS classification (e.g. position not reported,
  // AIS endpoint silent). The boat is online — that itself is the safety
  // signal — so do not show a scary "Status unknown" red-ish banner.
  if (ageMs !== null && ageMs <= 60 * 60 * 1000) {
    return { tone: "ok", primary: "Online", detail: "telemetry live, no GPS fix" };
  }

  return { tone: "unknown", primary: "Status unknown", detail: lastTs ? `last contact ${fmtRelMin(ageMs)}` : "no telemetry yet" };
}

export default function VesselSafetyHero({ slug, isOwnerView, tel, ais, alerts }) {
  const [passage, setPassage] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nowTs, setNowTs] = useState(Date.now());
  const [planOpen, setPlanOpen] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const r = await fetch(`/api/passages/${encodeURIComponent(slug)}`);
      if (!r.ok) return;
      const j = await r.json();
      setPassage(j.active || null);
      setHistory(Array.isArray(j.history) ? j.history : []);
    } catch {
      // network blip; leave previous state.
    }
  }, [slug]);

  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await load(); })();
    const t = setInterval(load, 30_000);
    const c = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => { alive = false; clearInterval(t); clearInterval(c); };
  }, [load]);

  const pos = pickPosition(tel);
  const lastTs = pickLastTelemetryTs(tel);
  const status = deriveStatus({ tel, ais, alerts, passage, nowTs });
  const tone = STATUS_COLORS[status.tone] || STATUS_COLORS.unknown;

  async function ownerAction(path, body) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/passages/${encodeURIComponent(slug)}${path}`, {
        method: body === null ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: body === null ? undefined : JSON.stringify(body || {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j?.error || "request failed");
      } else {
        setPassage(j.passage?.status === "active" ? j.passage : null);
        await load();
      }
    } catch (e) {
      setErr(e?.message || "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "8px 20px 0", maxWidth: 980, margin: "0 auto" }}>
      <div style={{
        background: `linear-gradient(180deg, ${tone.bg}, rgba(9,28,44,0.55))`,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        padding: "14px 16px",
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12, justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#7eabc8", textTransform: "uppercase" }}>Vessel safety</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: tone.text, marginTop: 4, lineHeight: 1.1 }}>
              {status.primary}
            </div>
            {status.detail && (
              <div style={{ fontSize: 12, color: "#c8e0f0", marginTop: 4 }}>{status.detail}</div>
            )}
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "#9ec8e0" }}>
            <div>last contact</div>
            <div style={{ color: "#e8f4f8", fontSize: 13, marginTop: 2 }}>
              {lastTs ? fmtRelMin(nowTs - lastTs) : "never"}
            </div>
            {lastTs && <div style={{ fontSize: 10, color: "#7eabc8", marginTop: 2 }}>{fmtTs(lastTs)}</div>}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, fontSize: 11, color: "#c8e0f0" }}>
          {pos ? (
            <span>
              <span style={{ color: "#7eabc8" }}>position </span>
              <a
                href={`https://www.google.com/maps?q=${pos.lat},${pos.lon}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: "#9ec8e0", textDecoration: "underline" }}
              >
                {fmtCoord(pos.lat)}, {fmtCoord(pos.lon)}
              </a>
            </span>
          ) : (
            <span style={{ color: "#7eabc8" }}>position unknown</span>
          )}
          {Number.isFinite(Number(tel?.sog_kn)) && (
            <span><span style={{ color: "#7eabc8" }}>SOG </span>{Number(tel.sog_kn).toFixed(1)} kn</span>
          )}
          {Number.isFinite(Number(tel?.cog_deg)) && (
            <span><span style={{ color: "#7eabc8" }}>COG </span>{Math.round(Number(tel.cog_deg))}°</span>
          )}
          {Number.isFinite(Number(tel?.water_depth_m)) && (
            <span><span style={{ color: "#7eabc8" }}>depth </span>{Number(tel.water_depth_m).toFixed(1)} m</span>
          )}
        </div>

        {passage?.status === "active" && (
          <div style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "rgba(13,36,56,0.55)",
            border: "1px solid rgba(126,171,200,0.16)",
            borderRadius: 7,
            fontSize: 12,
            color: "#c8e0f0",
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
          }}>
            <span>
              <span style={{ color: "#7eabc8" }}>passage to </span>
              <strong>{passage.destination?.name || "—"}</strong>
            </span>
            {Number.isFinite(Number(passage?.destination?.lat)) && Number.isFinite(Number(passage?.destination?.lon)) && (
              <a
                href={`https://www.google.com/maps?q=${passage.destination.lat},${passage.destination.lon}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: "#9ec8e0", textDecoration: "underline" }}
              >
                {fmtCoord(Number(passage.destination.lat))}, {fmtCoord(Number(passage.destination.lon))}
              </a>
            )}
            <span>
              <span style={{ color: "#7eabc8" }}>ETA </span>{fmtTs(passage.eta_ts)}
            </span>
            <span>
              <span style={{ color: "#7eabc8" }}>departed </span>{fmtTs(passage.departed_ts)}
            </span>
            {passage.notes && <span style={{ width: "100%", color: "#9ec8e0", fontStyle: "italic" }}>{passage.notes}</span>}
          </div>
        )}

        {isOwnerView && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!passage && (
              <OwnerBtn onClick={() => setPlanOpen(true)} disabled={busy}>Start passage</OwnerBtn>
            )}
            {passage?.status === "active" && (
              <>
                <OwnerBtn onClick={() => ownerAction("/safe", {})} disabled={busy} primary>Mark safe</OwnerBtn>
                <OwnerBtn onClick={() => ownerAction("/extend", { addMinutes: 60 })} disabled={busy}>+1h ETA</OwnerBtn>
                <OwnerBtn onClick={() => ownerAction("", null)} disabled={busy}>Cancel passage</OwnerBtn>
              </>
            )}
          </div>
        )}

        {err && <div style={{ marginTop: 8, fontSize: 11, color: "#ff8080" }}>{err}</div>}

        {history.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 10, color: "#7eabc8", letterSpacing: 1, textTransform: "uppercase" }}>
              recent passages
            </summary>
            <div style={{ marginTop: 6, fontSize: 11, color: "#9ec8e0", display: "grid", gap: 4 }}>
              {history.map((h, i) => (
                <div key={i}>
                  <span style={{ color: h.status === "completed" ? "#7ed8a0" : "#9ec8e0" }}>
                    {h.status}
                  </span>
                  {" · "}
                  {h.destination?.name || "—"}
                  {" · "}
                  ETA {fmtTs(h.eta_ts)}
                  {h.ended_ts && ` · ended ${fmtTs(h.ended_ts)}`}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {planOpen && (
        <PassagePlanModal
          slug={slug}
          onClose={() => setPlanOpen(false)}
          onCreated={async () => { setPlanOpen(false); await load(); }}
        />
      )}
    </div>
  );
}

function OwnerBtn({ children, onClick, disabled, primary }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 14px",
        background: primary ? "rgba(42,154,74,0.20)" : "rgba(126,171,200,0.10)",
        border: `1px solid ${primary ? "rgba(42,154,74,0.55)" : "rgba(126,171,200,0.30)"}`,
        color: primary ? "#7ed8a0" : "#c8e0f0",
        borderRadius: 6,
        fontFamily: "inherit",
        fontSize: 11,
        letterSpacing: 1,
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function PassagePlanModal({ slug, onClose, onCreated }) {
  const [destName, setDestName] = useState("");
  const [destLat, setDestLat] = useState("");
  const [destLon, setDestLon] = useState("");
  // Default ETA = now + 4h, formatted for datetime-local input.
  const [etaLocal, setEtaLocal] = useState(() => {
    const t = new Date(Date.now() + 4 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const eta_ts = new Date(etaLocal).getTime();
      if (!Number.isFinite(eta_ts)) throw new Error("invalid ETA");
      const lat = destLat === "" ? null : Number(destLat);
      const lon = destLon === "" ? null : Number(destLon);
      const r = await fetch(`/api/passages/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: { name: destName.trim(), lat, lon },
          eta_ts,
          notes: notes.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "failed to start passage");
      await onCreated();
    } catch (e2) {
      setErr(e2?.message || "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 20,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: "#0c2235",
          border: "1px solid rgba(126,171,200,0.30)",
          borderRadius: 10,
          padding: 20,
          width: "100%",
          maxWidth: 460,
          color: "#e8f4f8",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Start passage</div>
        <Field label="Destination name">
          <input
            value={destName}
            onChange={(e) => setDestName(e.target.value)}
            placeholder="e.g. Helsinki, Suomenlinna"
            style={inputStyle}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Latitude (optional)">
            <input value={destLat} onChange={(e) => setDestLat(e.target.value)} placeholder="60.1234" style={inputStyle} />
          </Field>
          <Field label="Longitude (optional)">
            <input value={destLon} onChange={(e) => setDestLon(e.target.value)} placeholder="24.9876" style={inputStyle} />
          </Field>
        </div>
        <Field label="ETA (local time)">
          <input type="datetime-local" value={etaLocal} onChange={(e) => setEtaLocal(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Notes (optional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </Field>
        {err && <div style={{ color: "#ff8080", fontSize: 12, marginTop: 6 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <OwnerBtn onClick={onClose} disabled={busy}>Cancel</OwnerBtn>
          <OwnerBtn onClick={submit} disabled={busy} primary>{busy ? "Starting…" : "Start passage"}</OwnerBtn>
        </div>
      </form>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(9,28,44,0.55)",
  border: "1px solid rgba(126,171,200,0.30)",
  borderRadius: 6,
  color: "#e8f4f8",
  fontFamily: "inherit",
  fontSize: 13,
  marginTop: 4,
};

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 10, fontSize: 11, color: "#7eabc8", letterSpacing: 1, textTransform: "uppercase" }}>
      {label}
      {children}
    </label>
  );
}
