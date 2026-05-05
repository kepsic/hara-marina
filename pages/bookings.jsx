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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
