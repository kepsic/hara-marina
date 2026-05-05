import { useEffect, useMemo, useState } from "react";

/**
 * Public booking wizard for guest berths.
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   slot: { berthId, dockId, dockName, label, maxLengthM, maxBeamM, maxDraftM }
 *   marinaSlug: string | null
 *   onCreated: (booking) => void   // fires after a successful POST
 */
export default function BookingWizardModal({ open, onClose, slot, marinaSlug, onCreated }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const [step, setStep] = useState(1);
  const [arrival, setArrival] = useState(today);
  const [departure, setDeparture] = useState(tomorrow);
  const [boatName, setBoatName] = useState("");
  const [loaM, setLoaM] = useState("");
  const [beamM, setBeamM] = useState("");
  const [draftM, setDraftM] = useState("");
  const [guestName, setGuestName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [quote, setQuote] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedBooking, setSubmittedBooking] = useState(null);
  const [blocked, setBlocked] = useState([]); // [{from, to, status}] active bookings on this berth

  // Reset wizard state when re-opened on a new berth.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setError("");
    setSubmittedBooking(null);
  }, [open, slot?.berthId]);

  // Load blocked date ranges for this berth so the picker can warn about conflicts.
  useEffect(() => {
    if (!open || !slot?.berthId) { setBlocked([]); return; }
    let cancelled = false;
    fetch(`/api/bookings/availability?berth=${encodeURIComponent(slot.berthId)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setBlocked(Array.isArray(j?.blocked) ? j.blocked : []); })
      .catch(() => { if (!cancelled) setBlocked([]); });
    return () => { cancelled = true; };
  }, [open, slot?.berthId]);

  // Detect overlap between [arrival, departure) and any blocked range.
  const conflict = useMemo(() => {
    if (!arrival || !departure) return null;
    return blocked.find((b) => b.from < departure && b.to > arrival) || null;
  }, [blocked, arrival, departure]);

  // Live price quote whenever dates change.
  useEffect(() => {
    if (!open || !slot?.berthId) return;
    if (!arrival || !departure || arrival >= departure) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ berth: slot.berthId, dock: slot.dockId, arrival, departure });
    fetch(`/api/bookings/quote?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setQuote(j); })
      .catch(() => { if (!cancelled) setQuote(null); });
    return () => { cancelled = true; };
  }, [open, slot?.berthId, slot?.dockId, arrival, departure]);

  if (!open || !slot) return null;

  const fitErrors = [];
  if (Number.isFinite(slot.maxLengthM) && Number(loaM) > slot.maxLengthM) fitErrors.push(`LOA exceeds berth limit ${slot.maxLengthM} m`);
  if (Number.isFinite(slot.maxBeamM) && Number(beamM) > slot.maxBeamM) fitErrors.push(`Beam exceeds berth limit ${slot.maxBeamM} m`);
  if (Number.isFinite(slot.maxDraftM) && Number(draftM) > slot.maxDraftM) fitErrors.push(`Draft exceeds berth limit ${slot.maxDraftM} m`);

  const canStep2 = arrival && departure && arrival < departure && !conflict;
  const canStep3 = boatName.trim() && loaM && beamM && draftM && fitErrors.length === 0;
  const canStep4 = guestName.trim() && /.+@.+\..+/.test(email);

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marinaSlug, berthId: slot.berthId, dockId: slot.dockId,
          arrival, departure,
          boatName, loaM: Number(loaM), beamM: Number(beamM), draftM: Number(draftM),
          guestName, email: email.trim().toLowerCase(), phone, notes,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Booking failed");
      setSubmittedBooking(j.booking);
      onCreated?.(j.booking);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const lim = (v) => Number.isFinite(v) ? `${v} m` : "no limit";
  const inputStyle = { background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 6, padding: "8px 10px", width: "100%", fontSize: 14 };
  const btnPrimary = { background: "#1f6fa8", color: "#fff", border: "none", borderRadius: 6, padding: "10px 16px", cursor: "pointer", fontSize: 14 };
  const btnSecondary = { background: "transparent", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 6, padding: "10px 16px", cursor: "pointer", fontSize: 14 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0c1d2c", color: "#dcecf5", borderRadius: 10, maxWidth: 520, width: "100%", padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Book guest berth · {slot.dockName} {slot.label}</h2>
          <button onClick={onClose} style={{ background: "transparent", color: "#7eabc8", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {submittedBooking ? (
          <div>
            <div style={{ background: "rgba(80,200,120,0.15)", border: "1px solid rgba(80,200,120,0.4)", padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <b>Booking received.</b> Confirmation sent to {submittedBooking.email}. The harbor master will approve it shortly.
            </div>
            <div style={{ fontSize: 13, color: "#7eabc8" }}>
              Reference: <code>{submittedBooking.id}</code>
            </div>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button onClick={onClose} style={btnPrimary}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 16, fontSize: 11, color: "#7eabc8" }}>
              {["Dates", "Boat", "Contact", "Review"].map((label, i) => (
                <div key={label} style={{ flex: 1, padding: "6px 8px", borderRadius: 4, background: step === i + 1 ? "#1f6fa8" : "rgba(255,255,255,0.05)", color: step === i + 1 ? "#fff" : "#7eabc8", textAlign: "center" }}>
                  {i + 1}. {label}
                </div>
              ))}
            </div>

            {step === 1 && (
              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>Arrival</span>
                  <input type="date" min={today} value={arrival} onChange={(e) => setArrival(e.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>Departure</span>
                  <input type="date" min={arrival || today} value={departure} onChange={(e) => setDeparture(e.target.value)} style={inputStyle} />
                </label>
                {quote && quote.nights > 0 && !conflict && (
                  <div style={{ background: "rgba(31,111,168,0.15)", border: "1px solid rgba(31,111,168,0.4)", padding: 10, borderRadius: 8, fontSize: 13 }}>
                    {quote.nights} night{quote.nights === 1 ? "" : "s"} · estimated <b>{(quote.totalCents / 100).toFixed(2)} {quote.currency}</b>
                  </div>
                )}
                {conflict && (
                  <div style={{ background: "rgba(224,128,64,0.18)", border: "1px solid rgba(224,128,64,0.5)", padding: 10, borderRadius: 8, fontSize: 13 }}>
                    ⚠ This berth is already <b>{conflict.status}</b> from <b>{conflict.from}</b> to <b>{conflict.to}</b>. Pick different dates.
                  </div>
                )}
                {blocked.length > 0 && !conflict && (
                  <div style={{ fontSize: 11, color: "#7eabc8" }}>
                    Already booked: {blocked.map((b) => `${b.from}→${b.to}`).join(", ")}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontSize: 12, color: "#7eabc8" }}>
                  Berth limits — LOA {lim(slot.maxLengthM)} · Beam {lim(slot.maxBeamM)} · Draft {lim(slot.maxDraftM)}
                </div>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>Boat name</span>
                  <input value={boatName} onChange={(e) => setBoatName(e.target.value)} style={inputStyle} placeholder="e.g. Vaiana" />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#7eabc8" }}>LOA (m)</span>
                    <input type="number" min="0" step="0.1" value={loaM} onChange={(e) => setLoaM(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#7eabc8" }}>Beam (m)</span>
                    <input type="number" min="0" step="0.1" value={beamM} onChange={(e) => setBeamM(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#7eabc8" }}>Draft (m)</span>
                    <input type="number" min="0" step="0.1" value={draftM} onChange={(e) => setDraftM(e.target.value)} style={inputStyle} />
                  </label>
                </div>
                {fitErrors.length > 0 && (
                  <div style={{ background: "rgba(224,128,64,0.15)", border: "1px solid rgba(224,128,64,0.4)", padding: 10, borderRadius: 8, fontSize: 13 }}>
                    {fitErrors.map((e) => <div key={e}>⚠ {e}</div>)}
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>Your name</span>
                  <input value={guestName} onChange={(e) => setGuestName(e.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>Phone (optional)</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#7eabc8" }}>Notes (optional)</span>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={inputStyle} placeholder="ETA, special requests, etc." />
                </label>
              </div>
            )}

            {step === 4 && (
              <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                <div><b>Berth:</b> {slot.dockName} · {slot.label}</div>
                <div><b>Stay:</b> {arrival} → {departure} ({quote?.nights ?? 0} nights)</div>
                <div><b>Boat:</b> {boatName} ({loaM}×{beamM}×{draftM} m)</div>
                <div><b>Guest:</b> {guestName} &lt;{email}&gt;{phone ? ` · ${phone}` : ""}</div>
                {notes && <div><b>Notes:</b> {notes}</div>}
                <div style={{ background: "rgba(31,111,168,0.15)", border: "1px solid rgba(31,111,168,0.4)", padding: 10, borderRadius: 8 }}>
                  Total: <b>{quote ? `${(quote.totalCents / 100).toFixed(2)} ${quote.currency}` : "—"}</b>{" "}
                  <span style={{ color: "#7eabc8", fontSize: 11 }}>(payment collected on arrival)</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                  I understand this is a request — the harbor master will confirm by email.
                </label>
                {error && <div style={{ color: "#e8b090" }}>{error}</div>}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, gap: 8 }}>
              <button onClick={() => (step === 1 ? onClose() : setStep(step - 1))} style={btnSecondary}>
                {step === 1 ? "Cancel" : "Back"}
              </button>
              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={(step === 1 && !canStep2) || (step === 2 && !canStep3) || (step === 3 && !canStep4)}
                  style={{ ...btnPrimary, opacity: ((step === 1 && !canStep2) || (step === 2 && !canStep3) || (step === 3 && !canStep4)) ? 0.5 : 1 }}
                >
                  Next
                </button>
              ) : (
                <button onClick={submit} disabled={!accepted || submitting} style={{ ...btnPrimary, opacity: (!accepted || submitting) ? 0.5 : 1 }}>
                  {submitting ? "Submitting…" : "Request booking"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
