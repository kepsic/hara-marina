import { useEffect, useMemo, useState } from "react";
import Head from "next/head";

const STATUS_COLORS = {
  pending: "#d4a017",
  confirmed: "#3aa86b",
  "checked-in": "#1f6fa8",
  "checked-out": "#5a6b7a",
  cancelled: "#c25c4a",
};

function fmtCents(c, cur) {
  if (!Number.isFinite(c)) return "";
  return `${(c / 100).toFixed(2)} ${cur || "EUR"}`;
}

function isoDays(fromIso, count) {
  const out = [];
  const d = new Date(`${fromIso}T12:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export default function BookingsAdminPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [me, setMe] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(today);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Auth gate
  useEffect(() => {
    fetch("/api/onboarding/me").then((r) => r.json()).then(setMe).catch(() => setMe(null));
  }, []);

  async function refresh() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    const r = await fetch(`/api/bookings?${params.toString()}`);
    const j = await r.json();
    setBookings(j.items || []);
    setLoading(false);
  }
  useEffect(() => {
    if (me?.is_harbor_master) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, statusFilter]);

  const days = useMemo(() => isoDays(from, 30), [from]);
  const berths = useMemo(() => {
    const set = new Map();
    for (const b of bookings) {
      const key = `${b.dockId}:${b.berthId}`;
      if (!set.has(key)) set.set(key, { dockId: b.dockId, berthId: b.berthId, dockName: b.dockName || b.dockId, berthLabel: b.berthLabel || b.berthId });
    }
    return Array.from(set.values()).sort((a, b) =>
      a.dockId.localeCompare(b.dockId) || a.berthId.localeCompare(b.berthId));
  }, [bookings]);

  if (me === null) return <div style={{ padding: 40, color: "#dcecf5" }}>Loading…</div>;
  if (!me?.email) return <div style={{ padding: 40, color: "#e8b090" }}>Sign in required.</div>;
  if (!me?.is_harbor_master) return <div style={{ padding: 40, color: "#e8b090" }}>Harbor master access required.</div>;

  async function patch(id, body) {
    setBusy(true);
    try {
      const r = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok) {
        setSelected(j.booking);
        await refresh();
      } else {
        alert(j.error || "failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "#081723", minHeight: "100vh", color: "#dcecf5", padding: 20, fontFamily: "system-ui" }}>
      <Head><title>Bookings · Harbor master</title></Head>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Guest berth bookings</h1>
        <div style={{ fontSize: 12, color: "#7eabc8" }}>signed in as {me.email}</div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", padding: "6px 8px", borderRadius: 4 }} />
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ background: "#102537", color: "#dcecf5", border: "1px solid #36566b", padding: "6px 8px", borderRadius: 4 }}>
            <option value="">all</option>
            <option value="pending">pending</option>
            <option value="confirmed">confirmed</option>
            <option value="checked-in">checked-in</option>
            <option value="checked-out">checked-out</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>
        <button onClick={refresh} style={{ background: "#1f6fa8", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>Refresh</button>
        <button onClick={() => setShowSettings(true)} style={{ background: "#36566b", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>⚙ Pricing</button>
        <div style={{ fontSize: 11, color: "#7eabc8" }}>{loading ? "Loading…" : `${bookings.length} booking${bookings.length === 1 ? "" : "s"}`}</div>
      </div>

      {berths.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#7eabc8" }}>No bookings yet.</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #1c3346", borderRadius: 6 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "#0c1d2c", padding: "6px 10px", borderBottom: "1px solid #1c3346", textAlign: "left", minWidth: 140 }}>Berth</th>
                {days.map((d) => (
                  <th key={d} style={{ padding: "6px 4px", borderBottom: "1px solid #1c3346", borderLeft: "1px solid #1c3346", color: "#7eabc8", fontWeight: 400, minWidth: 28, textAlign: "center" }}>
                    {d.slice(8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {berths.map((slot) => (
                <tr key={`${slot.dockId}:${slot.berthId}`}>
                  <td style={{ position: "sticky", left: 0, background: "#0c1d2c", padding: "6px 10px", borderBottom: "1px solid #1c3346", whiteSpace: "nowrap" }}>
                    {slot.dockName} · {slot.berthLabel}
                  </td>
                  {days.map((d) => {
                    const hits = bookings.filter((b) => b.berthId === slot.berthId && b.arrival <= d && b.departure > d);
                    const b = hits[0];
                    return (
                      <td key={d} style={{ padding: 0, borderBottom: "1px solid #1c3346", borderLeft: "1px solid #1c3346", height: 26 }}>
                        {b ? (
                          <div
                            onClick={() => setSelected(b)}
                            title={`${b.guestName} · ${b.boatName} · ${b.arrival}→${b.departure}`}
                            style={{ background: STATUS_COLORS[b.status] || "#5a6b7a", height: "100%", cursor: "pointer", opacity: 0.85 }}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#0c1d2c", width: 380, padding: 20, height: "100%", overflowY: "auto", boxShadow: "-10px 0 30px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Booking {selected.id}</h3>
              <button onClick={() => setSelected(null)} style={{ background: "transparent", color: "#7eabc8", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ fontSize: 13, display: "grid", gap: 6 }}>
              <div><b>Status:</b> <span style={{ color: STATUS_COLORS[selected.status] }}>{selected.status}</span></div>
              <div><b>Berth:</b> {selected.dockName || selected.dockId} · {selected.berthLabel || selected.berthId}</div>
              <div><b>Stay:</b> {selected.arrival} → {selected.departure} ({selected.nights} nights)</div>
              <div><b>Guest:</b> {selected.guestName} &lt;{selected.email}&gt;</div>
              {selected.phone && <div><b>Phone:</b> {selected.phone}</div>}
              <div><b>Boat:</b> {selected.boatName} ({selected.loaM}×{selected.beamM}×{selected.draftM} m)</div>
              <div><b>Price:</b> {fmtCents(selected.priceCents, selected.currency)} · payment {selected.paymentStatus}</div>
              {selected.notes && <div><b>Notes:</b> {selected.notes}</div>}
              {(() => {
                const n = selected.notifications?.received;
                if (!n) return <div style={{ color: "#d4a017" }}><b>Email:</b> not sent yet</div>;
                const ok = n.guest?.ok;
                const color = ok ? "#3aa86b" : "#c25c4a";
                const label = ok ? "✓ delivered" : "⚠ failed";
                return (
                  <div style={{ color }}>
                    <b>Email:</b> {label}
                    {n.guest?.from && <span style={{ color: "#7eabc8" }}> · from {n.guest.from}</span>}
                    {n.guest?.fellBack && <span style={{ color: "#d4a017" }}> · fell back to resend.dev</span>}
                    {!ok && n.guest?.error && <div style={{ fontSize: 11, color: "#e8b090", marginTop: 2 }}>{String(n.guest.error).slice(0, 200)}</div>}
                    {n.at && <div style={{ fontSize: 11, color: "#7eabc8" }}>at {n.at}{n.resentBy ? ` · resent by ${n.resentBy}` : ""}</div>}
                  </div>
                );
              })()}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              {selected.status === "pending" && (
                <button disabled={busy} onClick={() => patch(selected.id, { status: "confirmed" })} style={{ background: "#3aa86b", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer" }}>Confirm</button>
              )}
              {selected.status === "confirmed" && (
                <button disabled={busy} onClick={() => patch(selected.id, { status: "checked-in" })} style={{ background: "#1f6fa8", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer" }}>Check in</button>
              )}
              {selected.status === "checked-in" && (
                <button disabled={busy} onClick={() => patch(selected.id, { status: "checked-out" })} style={{ background: "#5a6b7a", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer" }}>Check out</button>
              )}
              {selected.status !== "cancelled" && selected.status !== "checked-out" && (
                <button disabled={busy} onClick={() => {
                  const reason = window.prompt("Reason for cancellation?", "");
                  if (reason !== null) patch(selected.id, { status: "cancelled", cancelledReason: reason });
                }} style={{ background: "#c25c4a", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer" }}>Cancel</button>
              )}
              {selected.paymentStatus !== "paid" && (
                <button disabled={busy} onClick={() => patch(selected.id, { paymentStatus: "paid" })} style={{ background: "#3aa86b", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer" }}>Mark paid</button>
              )}
              <button disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const r = await fetch(`/api/bookings/${selected.id}/resend`, { method: "POST" });
                  const j = await r.json();
                  if (j.booking) setSelected(j.booking);
                  if (!r.ok) alert(j.error || "resend failed");
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }} style={{ background: "#36566b", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer" }}>Resend email</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && <PricingSettingsModal isSuperAdmin={!!me?.is_super_admin} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function PricingSettingsModal({ onClose, isSuperAdmin }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch("/api/bookings/pricing")
      .then((r) => r.json())
      .then((j) => setCfg(j.pricing || null))
      .catch(() => setErr("Failed to load pricing"));
  }, []);

  function update(patch) { setCfg((c) => ({ ...c, ...patch })); }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/bookings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "save failed"); return; }
      setCfg(j.pricing);
      onClose();
    } finally { setBusy(false); }
  }

  function addSeasonal() {
    update({ seasonal: [...(cfg.seasonal || []), { from: "", to: "", multiplier: 1.5 }] });
  }
  function updSeasonal(i, patch) {
    const next = [...(cfg.seasonal || [])];
    next[i] = { ...next[i], ...patch };
    update({ seasonal: next });
  }
  function rmSeasonal(i) {
    const next = (cfg.seasonal || []).filter((_, j) => j !== i);
    update({ seasonal: next });
  }

  function addOverride(kind) {
    const key = window.prompt(kind === "perDockOverrides" ? "Dock ID (e.g. D)" : "Berth ID (e.g. D-9)");
    if (!key) return;
    const cents = Number(window.prompt("Nightly rate in cents (e.g. 5000 for €50)", "5000"));
    if (!Number.isFinite(cents) || cents < 0) return;
    update({ [kind]: { ...(cfg[kind] || {}), [key]: cents } });
  }
  function rmOverride(kind, key) {
    const next = { ...(cfg[kind] || {}) };
    delete next[key];
    update({ [kind]: next });
  }

  const inp = { background: "#102537", color: "#dcecf5", border: "1px solid #36566b", padding: "6px 8px", borderRadius: 4, fontSize: 13 };
  const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#7eabc8" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0c1d2c", borderRadius: 8, padding: 24, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", color: "#dcecf5", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Booking pricing</h2>
          <button onClick={onClose} style={{ background: "transparent", color: "#7eabc8", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {!cfg && !err && <div>Loading…</div>}
        {err && <div style={{ color: "#e8b090", marginBottom: 12 }}>{err}</div>}

        {cfg && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={lbl}>
                Currency (ISO 3-letter)
                <input style={inp} value={cfg.currency} onChange={(e) => update({ currency: e.target.value.toUpperCase() })} maxLength={3} />
              </label>
              <label style={lbl}>
                Default nightly rate (cents)
                <input type="number" style={inp} value={cfg.defaultNightCents} onChange={(e) => update({ defaultNightCents: Number(e.target.value) })} />
                <span style={{ fontSize: 11, color: "#5a7e96" }}>{(cfg.defaultNightCents / 100).toFixed(2)} {cfg.currency} / night</span>
              </label>
            </div>

            <fieldset style={{ border: "1px solid #1c3346", borderRadius: 6, padding: 12 }}>
              <legend style={{ fontSize: 12, color: "#7eabc8", padding: "0 6px" }}>SaaS platform fee {isSuperAdmin ? "" : "(read-only)"}</legend>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={lbl}>
                  Percent
                  <input type="number" step="0.1" disabled={!isSuperAdmin} style={{ ...inp, opacity: isSuperAdmin ? 1 : 0.6 }} value={cfg.platformFeePercent} onChange={(e) => update({ platformFeePercent: Number(e.target.value) })} />
                </label>
                <label style={lbl}>
                  Fixed (cents)
                  <input type="number" disabled={!isSuperAdmin} style={{ ...inp, opacity: isSuperAdmin ? 1 : 0.6 }} value={cfg.platformFeeFixedCents} onChange={(e) => update({ platformFeeFixedCents: Number(e.target.value) })} />
                </label>
              </div>
              <div style={{ fontSize: 11, color: "#5a7e96", marginTop: 6 }}>
                {isSuperAdmin
                  ? `Example €100 booking → platform fee: ${((100 * cfg.platformFeePercent / 100) + cfg.platformFeeFixedCents / 100).toFixed(2)} ${cfg.currency}, marina receives ${(100 - (100 * cfg.platformFeePercent / 100) - cfg.platformFeeFixedCents / 100).toFixed(2)} ${cfg.currency}.`
                  : `Set by the platform owner. On a €100 booking your marina receives ${(100 - (100 * cfg.platformFeePercent / 100) - cfg.platformFeeFixedCents / 100).toFixed(2)} ${cfg.currency} (platform takes ${((100 * cfg.platformFeePercent / 100) + cfg.platformFeeFixedCents / 100).toFixed(2)} ${cfg.currency} to cover Stripe + infra).`}
              </div>
            </fieldset>

            <fieldset style={{ border: "1px solid #1c3346", borderRadius: 6, padding: 12 }}>
              <legend style={{ fontSize: 12, color: "#7eabc8", padding: "0 6px" }}>Length-based nightly tiers (LOA)</legend>
              <div style={{ fontSize: 11, color: "#5a7e96", marginBottom: 6 }}>
                Picked when the guest's boat length is known. Per-berth or per-dock overrides win over tiers; tiers win over the default rate. Last tier with empty "up to" means "and above".
              </div>
              {(cfg.loaTiers || []).length === 0 && <div style={{ fontSize: 12, color: "#5a7e96" }}>No tiers — using default rate for all boats.</div>}
              {(cfg.loaTiers || []).map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>up to</span>
                  <input type="number" step="0.5" min="0" placeholder="∞" style={{ ...inp, width: 80 }}
                    value={t.maxLoaM == null ? "" : t.maxLoaM}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      const next = [...cfg.loaTiers];
                      next[i] = { ...t, maxLoaM: v };
                      update({ loaTiers: next });
                    }} />
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>m →</span>
                  <input type="number" min="0" style={{ ...inp, width: 100 }} value={t.nightCents}
                    onChange={(e) => {
                      const next = [...cfg.loaTiers];
                      next[i] = { ...t, nightCents: Number(e.target.value) };
                      update({ loaTiers: next });
                    }} />
                  <span style={{ fontSize: 11, color: "#5a7e96" }}>cents/night ({(t.nightCents / 100).toFixed(2)} {cfg.currency})</span>
                  <button onClick={() => update({ loaTiers: cfg.loaTiers.filter((_, j) => j !== i) })} style={{ background: "transparent", color: "#c25c4a", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              ))}
              <button onClick={() => update({ loaTiers: [...(cfg.loaTiers || []), { maxLoaM: null, nightCents: cfg.defaultNightCents }] })} style={{ background: "#1f6fa8", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12, marginTop: 4 }}>+ Tier</button>
            </fieldset>

            <fieldset style={{ border: "1px solid #1c3346", borderRadius: 6, padding: 12 }}>
              <legend style={{ fontSize: 12, color: "#7eabc8", padding: "0 6px" }}>Extras (informational, shown in welcome email)</legend>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={lbl}>
                  Short stay (≤5h, cents)
                  <input type="number" style={inp} value={cfg.shortStayCents ?? 0} onChange={(e) => update({ shortStayCents: Number(e.target.value) })} />
                  <span style={{ fontSize: 11, color: "#5a7e96" }}>{((cfg.shortStayCents ?? 0) / 100).toFixed(2)} {cfg.currency}</span>
                </label>
                <label style={lbl}>
                  Slip use (cents/vessel)
                  <input type="number" style={inp} value={cfg.slipCents ?? 0} onChange={(e) => update({ slipCents: Number(e.target.value) })} />
                  <span style={{ fontSize: 11, color: "#5a7e96" }}>{((cfg.slipCents ?? 0) / 100).toFixed(2)} {cfg.currency}</span>
                </label>
              </div>
            </fieldset>

            <fieldset style={{ border: "1px solid #1c3346", borderRadius: 6, padding: 12 }}>
              <legend style={{ fontSize: 12, color: "#7eabc8", padding: "0 6px" }}>Per-dock overrides</legend>
              {Object.entries(cfg.perDockOverrides || {}).length === 0 && <div style={{ fontSize: 12, color: "#5a7e96" }}>None — using default rate.</div>}
              {Object.entries(cfg.perDockOverrides || {}).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <code style={{ flex: 1, fontSize: 13 }}>{k}</code>
                  <input type="number" style={{ ...inp, width: 100 }} value={v} onChange={(e) => update({ perDockOverrides: { ...cfg.perDockOverrides, [k]: Number(e.target.value) } })} />
                  <span style={{ fontSize: 11, color: "#5a7e96" }}>cents/night</span>
                  <button onClick={() => rmOverride("perDockOverrides", k)} style={{ background: "transparent", color: "#c25c4a", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              ))}
              <button onClick={() => addOverride("perDockOverrides")} style={{ background: "#1f6fa8", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12, marginTop: 4 }}>+ Dock override</button>
            </fieldset>

            <fieldset style={{ border: "1px solid #1c3346", borderRadius: 6, padding: 12 }}>
              <legend style={{ fontSize: 12, color: "#7eabc8", padding: "0 6px" }}>Per-berth overrides</legend>
              {Object.entries(cfg.perBerthOverrides || {}).length === 0 && <div style={{ fontSize: 12, color: "#5a7e96" }}>None.</div>}
              {Object.entries(cfg.perBerthOverrides || {}).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <code style={{ flex: 1, fontSize: 13 }}>{k}</code>
                  <input type="number" style={{ ...inp, width: 100 }} value={v} onChange={(e) => update({ perBerthOverrides: { ...cfg.perBerthOverrides, [k]: Number(e.target.value) } })} />
                  <span style={{ fontSize: 11, color: "#5a7e96" }}>cents/night</span>
                  <button onClick={() => rmOverride("perBerthOverrides", k)} style={{ background: "transparent", color: "#c25c4a", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              ))}
              <button onClick={() => addOverride("perBerthOverrides")} style={{ background: "#1f6fa8", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12, marginTop: 4 }}>+ Berth override</button>
            </fieldset>

            <fieldset style={{ border: "1px solid #1c3346", borderRadius: 6, padding: 12 }}>
              <legend style={{ fontSize: 12, color: "#7eabc8", padding: "0 6px" }}>Seasonal multipliers</legend>
              {(cfg.seasonal || []).length === 0 && <div style={{ fontSize: 12, color: "#5a7e96" }}>No seasonal rules — flat rate year-round.</div>}
              {(cfg.seasonal || []).map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <input type="date" style={inp} value={r.from} onChange={(e) => updSeasonal(i, { from: e.target.value })} />
                  <span>→</span>
                  <input type="date" style={inp} value={r.to} onChange={(e) => updSeasonal(i, { to: e.target.value })} />
                  <input type="number" step="0.05" style={{ ...inp, width: 70 }} value={r.multiplier} onChange={(e) => updSeasonal(i, { multiplier: Number(e.target.value) })} />
                  <span style={{ fontSize: 11, color: "#5a7e96" }}>×</span>
                  <button onClick={() => rmSeasonal(i)} style={{ background: "transparent", color: "#c25c4a", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              ))}
              <button onClick={addSeasonal} style={{ background: "#1f6fa8", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12, marginTop: 4 }}>+ Season</button>
            </fieldset>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={onClose} style={{ background: "#36566b", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 4, cursor: "pointer" }}>Cancel</button>
              <button disabled={busy} onClick={save} style={{ background: "#3aa86b", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 4, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
