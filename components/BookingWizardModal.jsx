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
 *
 * Structure:
 *   - small pure helpers + style tokens at top
 *   - one custom hook per remote concern (availability, quote)
 *   - one stateless step component per wizard page
 *   - the default-exported `BookingWizardModal` only orchestrates state
 *     and delegates rendering to the step components, so each step's JSX
 *     is short and reviewable on its own.
 *
 * Pricing UX:
 *   - Dates step: shows a "from / to per night, depending on length"
 *     range built from the public loaTiers in the quote response, NOT a
 *     concrete total — until we know the boat length, any single number
 *     would just be the platform's defaultNightCents fallback and would
 *     mislead the guest.
 *   - Boat step: live total once a positive LOA is entered.
 *   - Review step: total + nightly rate + per-night breakdown when
 *     seasonal multipliers actually produce different nightly amounts.
 */

// ---------- styling tokens (kept inline so the modal can be used without
// importing the global stylesheet from anywhere that doesn't already have it)

const STYLE = {
  overlay:   { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal:     { background: "#0c1d2c", color: "#dcecf5", borderRadius: 10, maxWidth: 520, width: "100%", padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto" },
  input:     { background: "#102537", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 6, padding: "8px 10px", width: "100%", fontSize: 14 },
  primary:   { background: "#1f6fa8", color: "#fff", border: "none", borderRadius: 6, padding: "10px 16px", cursor: "pointer", fontSize: 14 },
  secondary: { background: "transparent", color: "#dcecf5", border: "1px solid #36566b", borderRadius: 6, padding: "10px 16px", cursor: "pointer", fontSize: 14 },
  panelInfo: { background: "rgba(31,111,168,0.15)", border: "1px solid rgba(31,111,168,0.4)", padding: 10, borderRadius: 8, fontSize: 13 },
  panelWarn: { background: "rgba(224,128,64,0.18)", border: "1px solid rgba(224,128,64,0.5)", padding: 10, borderRadius: 8, fontSize: 13 },
  panelOk:   { background: "rgba(80,200,120,0.15)", border: "1px solid rgba(80,200,120,0.4)", padding: 12, borderRadius: 8, marginBottom: 12 },
  label:     { display: "grid", gap: 4 },
  labelText: { fontSize: 12, color: "#7eabc8" },
  hint:      { fontSize: 11, color: "#7eabc8" },
};

// ---------- helpers

const todayIso = () => new Date().toISOString().slice(0, 10);
const tomorrowIso = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

function fmtPrice(cents, currency) {
  if (!Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat("en-EU", { style: "currency", currency: currency || "EUR" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || "EUR"}`;
  }
}

const lim = (v) => (Number.isFinite(v) ? `${v} m` : "no limit");

/**
 * Build a "€X / night" or "€X–€Y / night, depending on length" hint from
 * the public LOA tier ladder. Returns null when there are no tiers (the
 * marina is on a flat rate and we have nothing useful to show pre-LOA).
 */
function buildTierHint(loaTiers, currency) {
  if (!Array.isArray(loaTiers) || loaTiers.length === 0) return null;
  const cents = loaTiers.map((t) => Number(t.nightCents)).filter(Number.isFinite);
  if (!cents.length) return null;
  const min = Math.min(...cents);
  const max = Math.max(...cents);
  if (min === max) return `${fmtPrice(min, currency)} / night`;
  return `${fmtPrice(min, currency)}–${fmtPrice(max, currency)} / night, depending on length`;
}

// ---------- hooks

/** Active blocked date ranges for a berth. */
function useBerthAvailability(open, berthId) {
  const [blocked, setBlocked] = useState([]);
  useEffect(() => {
    if (!open || !berthId) { setBlocked([]); return undefined; }
    let cancelled = false;
    fetch(`/api/bookings/availability?berth=${encodeURIComponent(berthId)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setBlocked(Array.isArray(j?.blocked) ? j.blocked : []); })
      .catch(() => { if (!cancelled) setBlocked([]); });
    return () => { cancelled = true; };
  }, [open, berthId]);
  return blocked;
}

/** Live price quote that re-runs as dates / LOA change. */
function useQuote(open, slot, arrival, departure, loaM) {
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    if (!open || !slot?.berthId) return undefined;
    if (!arrival || !departure || arrival >= departure) { setQuote(null); return undefined; }
    let cancelled = false;
    const params = new URLSearchParams({ berth: slot.berthId, dock: slot.dockId, arrival, departure });
    if (loaM && Number(loaM) > 0) params.set("loa", String(loaM));
    fetch(`/api/bookings/quote?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setQuote(j); })
      .catch(() => { if (!cancelled) setQuote(null); });
    return () => { cancelled = true; };
  }, [open, slot?.berthId, slot?.dockId, arrival, departure, loaM]);
  return quote;
}

// ---------- step components

function Stepper({ step }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16, fontSize: 11 }}>
      {["Dates", "Boat", "Contact", "Review"].map((label, i) => {
        const active = step === i + 1;
        return (
          <div
            key={label}
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: 4,
              background: active ? "#1f6fa8" : "rgba(255,255,255,0.05)",
              color: active ? "#fff" : "#7eabc8",
              textAlign: "center",
            }}
          >
            {i + 1}. {label}
          </div>
        );
      })}
    </div>
  );
}

function DatesStep({ today, arrival, setArrival, departure, setDeparture, conflict, blocked, quote, tierHint }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={STYLE.label}>
        <span style={STYLE.labelText}>Arrival</span>
        <input type="date" min={today} value={arrival} onChange={(e) => setArrival(e.target.value)} style={STYLE.input} />
      </label>
      <label style={STYLE.label}>
        <span style={STYLE.labelText}>Departure</span>
        <input type="date" min={arrival || today} value={departure} onChange={(e) => setDeparture(e.target.value)} style={STYLE.input} />
      </label>

      {/* Show a real total only once we know the LOA — otherwise show the
          public tier range so the guest gets a realistic ballpark without
          us quoting a fallback rate that ignores boat length. */}
      {quote?.nights > 0 && quote?.hasLoa && !conflict && (
        <div style={STYLE.panelInfo}>
          {quote.nights} night{quote.nights === 1 ? "" : "s"} · estimated <b>{fmtPrice(quote.totalCents, quote.currency)}</b>
        </div>
      )}
      {quote?.nights > 0 && !quote?.hasLoa && !conflict && tierHint && (
        <div style={STYLE.panelInfo}>
          {quote.nights} night{quote.nights === 1 ? "" : "s"} · from <b>{tierHint}</b>
          <div style={{ ...STYLE.hint, marginTop: 4 }}>Final price calculated on the next step once you enter the boat length.</div>
        </div>
      )}

      {conflict && (
        <div style={STYLE.panelWarn}>
          ⚠ This berth is already <b>{conflict.status}</b> from <b>{conflict.from}</b> to <b>{conflict.to}</b>. Pick different dates.
        </div>
      )}
      {blocked.length > 0 && !conflict && (
        <div style={STYLE.hint}>
          Already booked: {blocked.map((b) => `${b.from}→${b.to}`).join(", ")}
        </div>
      )}
    </div>
  );
}

function BoatStep({ slot, boatName, setBoatName, loaM, setLoaM, beamM, setBeamM, draftM, setDraftM, fitErrors, quote }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={STYLE.labelText}>
        Berth limits — LOA {lim(slot.maxLengthM)} · Beam {lim(slot.maxBeamM)} · Draft {lim(slot.maxDraftM)}
      </div>
      <label style={STYLE.label}>
        <span style={STYLE.labelText}>Boat name</span>
        <input value={boatName} onChange={(e) => setBoatName(e.target.value)} style={STYLE.input} placeholder="e.g. Vaiana" />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <label style={STYLE.label}>
          <span style={STYLE.labelText}>LOA (m)</span>
          <input type="number" min="0" step="0.1" value={loaM} onChange={(e) => setLoaM(e.target.value)} style={STYLE.input} />
        </label>
        <label style={STYLE.label}>
          <span style={STYLE.labelText}>Beam (m)</span>
          <input type="number" min="0" step="0.1" value={beamM} onChange={(e) => setBeamM(e.target.value)} style={STYLE.input} />
        </label>
        <label style={STYLE.label}>
          <span style={STYLE.labelText}>Draft (m)</span>
          <input type="number" min="0" step="0.1" value={draftM} onChange={(e) => setDraftM(e.target.value)} style={STYLE.input} />
        </label>
      </div>

      {fitErrors.length > 0 && (
        <div style={{ ...STYLE.panelWarn, background: "rgba(224,128,64,0.15)", borderColor: "rgba(224,128,64,0.4)" }}>
          {fitErrors.map((e) => <div key={e}>⚠ {e}</div>)}
        </div>
      )}

      {/* Once a valid LOA is in, surface the tier-adjusted nightly rate
          and total so the per-meter pricing is obvious before Review. */}
      {quote?.nights > 0 && quote?.hasLoa && fitErrors.length === 0 && (
        <div style={STYLE.panelInfo}>
          {quote.nights} night{quote.nights === 1 ? "" : "s"} × <b>{fmtPrice(quote.nightlyCents, quote.currency)}</b>
          {" "}= <b>{fmtPrice(quote.totalCents, quote.currency)}</b>
          {Number(loaM) > 0 && <span style={STYLE.hint}> · for {loaM} m LOA</span>}
        </div>
      )}
    </div>
  );
}

function ContactStep({ guestName, setGuestName, email, setEmail, phone, setPhone, notes, setNotes }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={STYLE.label}>
        <span style={STYLE.labelText}>Your name</span>
        <input value={guestName} onChange={(e) => setGuestName(e.target.value)} style={STYLE.input} />
      </label>
      <label style={STYLE.label}>
        <span style={STYLE.labelText}>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={STYLE.input} />
      </label>
      <label style={STYLE.label}>
        <span style={STYLE.labelText}>Phone (optional)</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} style={STYLE.input} />
      </label>
      <label style={STYLE.label}>
        <span style={STYLE.labelText}>Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={STYLE.input} placeholder="ETA, special requests, etc." />
      </label>
    </div>
  );
}

function ReviewStep({ slot, arrival, departure, boatName, loaM, beamM, draftM, guestName, email, phone, notes, quote, accepted, setAccepted, error }) {
  // Show the per-night breakdown only when seasonal multipliers actually
  // produce different nightly amounts — for a flat-rate stay it would
  // duplicate the total and add visual noise.
  const breakdown = Array.isArray(quote?.breakdown) ? quote.breakdown : [];
  const showBreakdown = breakdown.length > 1 && new Set(breakdown.map((b) => b.cents)).size > 1;

  return (
    <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
      <div><b>Berth:</b> {slot.dockName} · {slot.label}</div>
      <div><b>Stay:</b> {arrival} → {departure} ({quote?.nights ?? 0} nights)</div>
      <div><b>Boat:</b> {boatName} ({loaM}×{beamM}×{draftM} m)</div>
      <div><b>Guest:</b> {guestName} &lt;{email}&gt;{phone ? ` · ${phone}` : ""}</div>
      {notes && <div><b>Notes:</b> {notes}</div>}

      <div style={STYLE.panelInfo}>
        Total: <b>{quote ? fmtPrice(quote.totalCents, quote.currency) : "—"}</b>{" "}
        {quote?.nightlyCents != null && (
          <span style={STYLE.hint}>({fmtPrice(quote.nightlyCents, quote.currency)} / night, electricity included)</span>
        )}
        {showBreakdown && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#7eabc8", fontSize: 11 }}>
            {breakdown.map((b) => (
              <li key={b.date}>{b.date} — {fmtPrice(b.cents, quote.currency)}</li>
            ))}
          </ul>
        )}
        <div style={{ ...STYLE.hint, marginTop: 6 }}>
          You'll be redirected to Stripe to pay securely. Card payment confirms the berth instantly.
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        I agree to the marina's terms and authorise the card payment.
      </label>
      {error && <div style={{ color: "#e8b090" }}>{error}</div>}
    </div>
  );
}

function SuccessCard({ booking, onClose }) {
  return (
    <div>
      <div style={STYLE.panelOk}>
        <b>Booking request received.</b> A receipt was sent to <b>{booking.email}</b>.
        Stripe checkout was unavailable, so the harbor master will email you payment instructions and confirm the berth manually.
      </div>
      <div style={{ fontSize: 13, color: "#7eabc8" }}>
        Reference: <code>{booking.id}</code>
      </div>
      <div style={{ marginTop: 16, textAlign: "right" }}>
        <button onClick={onClose} style={STYLE.primary}>Done</button>
      </div>
    </div>
  );
}

// ---------- main orchestrator

export default function BookingWizardModal({ open, onClose, slot, marinaSlug, onCreated }) {
  const today = useMemo(todayIso, []);
  const tomorrow = useMemo(tomorrowIso, []);

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedBooking, setSubmittedBooking] = useState(null);

  // Reset wizard whenever it's reopened on a different berth.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setError("");
    setSubmittedBooking(null);
  }, [open, slot?.berthId]);

  const blocked = useBerthAvailability(open, slot?.berthId);
  const quote = useQuote(open, slot, arrival, departure, loaM);

  const conflict = useMemo(() => {
    if (!arrival || !departure) return null;
    return blocked.find((b) => b.from < departure && b.to > arrival) || null;
  }, [blocked, arrival, departure]);

  const tierHint = useMemo(
    () => buildTierHint(quote?.loaTiers, quote?.currency),
    [quote?.loaTiers, quote?.currency]
  );

  const fitErrors = useMemo(() => {
    if (!slot) return [];
    const errs = [];
    if (Number.isFinite(slot.maxLengthM) && Number(loaM) > slot.maxLengthM) errs.push(`LOA exceeds berth limit ${slot.maxLengthM} m`);
    if (Number.isFinite(slot.maxBeamM)   && Number(beamM) > slot.maxBeamM)   errs.push(`Beam exceeds berth limit ${slot.maxBeamM} m`);
    if (Number.isFinite(slot.maxDraftM)  && Number(draftM) > slot.maxDraftM) errs.push(`Draft exceeds berth limit ${slot.maxDraftM} m`);
    return errs;
  }, [slot, loaM, beamM, draftM]);

  const canStep2 = arrival && departure && arrival < departure && !conflict;
  const canStep3 = boatName.trim() && loaM && beamM && draftM && fitErrors.length === 0;
  const canStep4 = guestName.trim() && /.+@.+\..+/.test(email);
  const canAdvance = (step === 1 && canStep2) || (step === 2 && canStep3) || (step === 3 && canStep4);

  if (!open || !slot) return null;

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
      onCreated?.(j.booking);

      // Try to send the guest straight to Stripe Checkout. If Stripe isn't
      // configured (501) or the call fails for any other reason, fall back
      // to the SuccessCard so the booking record is never lost.
      try {
        const c = await fetch(`/api/bookings/${encodeURIComponent(j.booking.id)}/checkout`, { method: "POST" });
        if (c.ok) {
          const cj = await c.json();
          if (cj?.url) {
            window.location.assign(cj.url);
            return;
          }
        }
      } catch (e) {
        console.warn("[booking] checkout redirect failed, falling back:", e);
      }

      setSubmittedBooking(j.booking);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose} style={STYLE.overlay}>
      <div onClick={(e) => e.stopPropagation()} style={STYLE.modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Book guest berth · {slot.dockName} {slot.label}</h2>
          <button onClick={onClose} style={{ background: "transparent", color: "#7eabc8", border: "none", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {submittedBooking ? (
          <SuccessCard booking={submittedBooking} onClose={onClose} />
        ) : (
          <>
            <Stepper step={step} />

            {step === 1 && (
              <DatesStep
                today={today}
                arrival={arrival} setArrival={setArrival}
                departure={departure} setDeparture={setDeparture}
                conflict={conflict} blocked={blocked}
                quote={quote} tierHint={tierHint}
              />
            )}
            {step === 2 && (
              <BoatStep
                slot={slot}
                boatName={boatName} setBoatName={setBoatName}
                loaM={loaM} setLoaM={setLoaM}
                beamM={beamM} setBeamM={setBeamM}
                draftM={draftM} setDraftM={setDraftM}
                fitErrors={fitErrors} quote={quote}
              />
            )}
            {step === 3 && (
              <ContactStep
                guestName={guestName} setGuestName={setGuestName}
                email={email} setEmail={setEmail}
                phone={phone} setPhone={setPhone}
                notes={notes} setNotes={setNotes}
              />
            )}
            {step === 4 && (
              <ReviewStep
                slot={slot}
                arrival={arrival} departure={departure}
                boatName={boatName} loaM={loaM} beamM={beamM} draftM={draftM}
                guestName={guestName} email={email} phone={phone} notes={notes}
                quote={quote}
                accepted={accepted} setAccepted={setAccepted}
                error={error}
              />
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, gap: 8 }}>
              <button onClick={() => (step === 1 ? onClose() : setStep(step - 1))} style={STYLE.secondary}>
                {step === 1 ? "Cancel" : "Back"}
              </button>
              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canAdvance}
                  style={{ ...STYLE.primary, opacity: canAdvance ? 1 : 0.5 }}
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!accepted || submitting}
                  style={{ ...STYLE.primary, opacity: !accepted || submitting ? 0.5 : 1 }}
                >
                  {submitting ? "Redirecting to Stripe…" : "Pay & confirm"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
