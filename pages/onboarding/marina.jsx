/**
 * Marina onboarding wizard (T11) — 7 steps.
 *
 *   1. Basics       → POST /api/marinas/register (creates the row)
 *   2. Plan         → PATCH /api/marinas/[slug] { plan }
 *   3. Stripe       → POST /api/stripe/connect/onboard (or skip)
 *   4. Dock layout  → POST /api/marinas/[slug]/dock-sections
 *   5. Team         → POST /api/marinas/[slug]/members
 *   6. Branding     → PATCH /api/marinas/[slug] { tagline, brand_color, website }
 *   7. Publish      → PATCH /api/marinas/[slug] { publish: true }
 *
 * Resumable: ?slug=foo loads the marina + jumps to onboarding_step.
 * Each step calls the API on Continue and persists onboarding_step so
 * the marina admin can leave and come back.
 */

import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { INCENTIVES } from "../../lib/incentives";

const STEPS = [
  { n: 1, title: "Basics" },
  { n: 2, title: "Plan" },
  { n: 3, title: "Payments" },
  { n: 4, title: "Dock layout" },
  { n: 5, title: "Team" },
  { n: 6, title: "Branding" },
  { n: 7, title: "Publish" },
];

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

export default function MarinaOnboardingWizard() {
  const router = useRouter();
  const slugParam = (router.query.slug || "").toString().toLowerCase();

  const [me, setMe] = useState(null);
  const [marina, setMarina] = useState(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Step 1 form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [country, setCountry] = useState("EE");
  const [referralCode, setReferralCode] = useState("");

  // Step 2
  const [plan, setPlan] = useState("free");

  // Step 4
  const [sections, setSections] = useState([
    { label: "A", berthCount: 10 },
    { label: "B", berthCount: 10 },
  ]);

  // Step 5
  const [members, setMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("harbor_master");

  // Step 6
  const [tagline, setTagline] = useState("");
  const [brandColor, setBrandColor] = useState("#1e6fa8");
  const [website, setWebsite] = useState("");

  // Auth gate
  useEffect(() => {
    fetch("/api/onboarding/me").then(async (r) => {
      if (r.status === 401) {
        const next = encodeURIComponent(slugParam ? `/onboarding/marina?slug=${slugParam}` : "/onboarding/marina");
        window.location.href = `/login?next=${next}`;
        return;
      }
      setMe(await r.json());
    });
  }, [slugParam]);

  // Resume mode: ?slug=foo
  useEffect(() => {
    if (!slugParam || !me) return;
    (async () => {
      const r = await fetch(`/api/marinas/${slugParam}`);
      if (!r.ok) {
        // Not found / not an admin — fall back to step 1.
        return;
      }
      const j = await r.json();
      setMarina(j.marina);
      setName(j.marina.name);
      setSlug(j.marina.slug);
      setLat(String(j.marina.lat || ""));
      setLon(String(j.marina.lon || ""));
      setCountry(j.marina.country || "EE");
      setPlan(j.marina.plan || "free");
      setTagline(j.marina.tagline || "");
      setBrandColor(j.marina.brand_color || "#1e6fa8");
      setWebsite(j.marina.website || "");
      setStep(Math.min(7, Math.max(1, Number(j.marina.onboarding_step) || 1)));

      // Pre-load dock sections + members.
      const [docks, mem] = await Promise.all([
        fetch(`/api/marinas/${slugParam}/dock-sections`).then((r) => r.ok ? r.json() : null),
        fetch(`/api/marinas/${slugParam}/members`).then((r) => r.ok ? r.json() : null),
      ]);
      if (docks?.sections?.length) setSections(docks.sections.map((s) => ({ label: s.label, berthCount: s.berthCount })));
      if (mem?.members) setMembers(mem.members);
    })();
  }, [slugParam, me]);

  function onName(v) {
    setName(v);
    if (!slugTouched && !marina) setSlug(norm(v));
  }

  async function patch(body) {
    const r = await fetch(`/api/marinas/${marina.slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    setMarina(j.marina);
    return j.marina;
  }

  async function advance(nextStep) {
    if (!marina) return;
    try {
      await patch({ onboarding_step: nextStep });
    } catch (e) {
      console.warn("step bump failed:", e?.message || e);
    }
    setStep(nextStep);
    setErr(null);
  }

  async function submitStep1(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/marinas/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, slug, lat: Number(lat), lon: Number(lon), country,
          referralCode: referralCode || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMarina(j.marina);
      // Continue without page reload — marina is now created.
      router.replace(`/onboarding/marina?slug=${j.marina.slug}`, undefined, { shallow: true });
      setStep(2);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitStep2() {
    setBusy(true); setErr(null);
    try {
      await patch({ plan });
      await advance(3);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function submitStep3(skip = false) {
    setBusy(true); setErr(null);
    try {
      if (!skip) {
        const r = await fetch("/api/stripe/connect/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marinaSlug: marina.slug,
            returnUrl:  `${window.location.origin}/onboarding/marina?slug=${marina.slug}`,
            refreshUrl: `${window.location.origin}/onboarding/marina?slug=${marina.slug}`,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || j.hint || `HTTP ${r.status}`);
        if (j.url) {
          window.location.href = j.url;
          return;
        }
      }
      await advance(4);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function submitStep4() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/marinas/${marina.slug}/dock-sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await advance(5);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function inviteMember() {
    if (!inviteEmail) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/marinas/${marina.slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMembers((cur) => [...cur, { email: inviteEmail, role: inviteRole }]);
      setInviteEmail("");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function submitStep6() {
    setBusy(true); setErr(null);
    try {
      await patch({ tagline, brand_color: brandColor, website });
      await advance(7);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true); setErr(null);
    try {
      await patch({ publish: true });
      window.location.href = `https://${marina.slug}.mervare.app`;
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  if (!me) return <Page><Card><p style={{ color: "#a8c4d4" }}>Loading…</p></Card></Page>;

  return (
    <Page>
      <Card>
        <Stepper current={step} marina={marina} setStep={setStep} />

        {step === 1 && (
          <form onSubmit={submitStep1}>
            <H>Where is your marina?</H>
            <Sub>The basics. Everything else is editable later.</Sub>

            <Field label="Marina name">
              <input required value={name} onChange={(e) => onName(e.target.value)} placeholder="Pirita Sadam" style={input} />
            </Field>
            <Field label="Subdomain">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input required value={slug} onChange={(e) => { setSlug(norm(e.target.value)); setSlugTouched(true); }} placeholder="pirita" style={{ ...input, flex: "0 1 220px" }} />
                <span style={{ color: "#7eabc8", fontSize: 13 }}>.mervare.app</span>
              </div>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 10 }}>
              <Field label="Latitude"><input required type="number" step="0.0001" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="59.5881" style={input} /></Field>
              <Field label="Longitude"><input required type="number" step="0.0001" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="25.6124" style={input} /></Field>
              <Field label="Country"><input required maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} style={input} /></Field>
            </div>
            <p style={{ fontSize: 11, color: "#5a8aaa", marginTop: 4, marginBottom: 14 }}>
              Tip: right-click your dock on <a href="https://www.openstreetmap.org" target="_blank" rel="noreferrer" style={{ color: "#7eabc8" }}>OpenStreetMap</a> to copy lat/lon.
            </p>
            <Field label="Referral code (optional)">
              <input value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase())} placeholder="e.g. HARA42" style={input} />
            </Field>
            {err && <Err>{err}</Err>}
            <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Creating…" : "Create marina →"}
            </button>
          </form>
        )}

        {step === 2 && marina && (
          <div>
            <H>Pick a plan</H>
            <Sub>You can change this anytime. Founding slots are limited to {INCENTIVES.FOUNDING_MARINA_SLOTS_PER_COUNTRY} per country.</Sub>
            {["free", "marina", "founding"].map((p) => (
              <PlanRow key={p} plan={p} selected={plan === p} onSelect={() => setPlan(p)} />
            ))}
            {err && <Err>{err}</Err>}
            <Nav>
              <button onClick={() => setStep(1)} style={btnGhost}>← Back</button>
              <button onClick={submitStep2} disabled={busy} style={btnPrimary}>Continue →</button>
            </Nav>
          </div>
        )}

        {step === 3 && marina && (
          <div>
            <H>Take payments with Stripe</H>
            <Sub>Stripe Connect routes berth-booking payouts straight to your bank account. Optional — you can wire this up later from Settings.</Sub>
            {err && <Err>{err}</Err>}
            <Nav>
              <button onClick={() => setStep(2)} style={btnGhost}>← Back</button>
              <button onClick={() => submitStep3(true)} disabled={busy} style={btnGhost}>Skip for now</button>
              <button onClick={() => submitStep3(false)} disabled={busy} style={btnPrimary}>
                {busy ? "Opening Stripe…" : "Connect Stripe →"}
              </button>
            </Nav>
          </div>
        )}

        {step === 4 && marina && (
          <div>
            <H>Sketch your docks</H>
            <Sub>One row per pier or pontoon. We'll create numbered berths automatically — you can fine-tune later in the layout editor.</Sub>
            {sections.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 120px 32px", gap: 8, marginBottom: 8 }}>
                <input value={s.label} onChange={(e) => {
                  const v = e.target.value.toUpperCase().slice(0, 8);
                  setSections((arr) => arr.map((x, j) => j === i ? { ...x, label: v } : x));
                }} placeholder="A" style={input} />
                <input type="number" min="0" max="200" value={s.berthCount} onChange={(e) => {
                  const n = Math.max(0, Math.min(200, Number(e.target.value) || 0));
                  setSections((arr) => arr.map((x, j) => j === i ? { ...x, berthCount: n } : x));
                }} style={input} />
                <button onClick={() => setSections((arr) => arr.filter((_, j) => j !== i))} style={{ ...btnGhost, padding: "0 8px" }}>×</button>
              </div>
            ))}
            <button onClick={() => setSections((arr) => [...arr, { label: "", berthCount: 10 }])} style={btnGhost}>+ Add row</button>
            {err && <Err>{err}</Err>}
            <Nav>
              <button onClick={() => setStep(3)} style={btnGhost}>← Back</button>
              <button onClick={submitStep4} disabled={busy} style={btnPrimary}>Continue →</button>
            </Nav>
          </div>
        )}

        {step === 5 && marina && (
          <div>
            <H>Invite your team</H>
            <Sub>Harbor masters and admins can manage berths, bookings, and boats. Invitees just need to sign in with the email below.</Sub>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px" }}>
              {members.map((m) => (
                <li key={`${m.email}/${m.role}`} style={{ padding: "6px 0", borderBottom: "1px solid rgba(126,171,200,0.15)", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{m.email}</span>
                  <span style={{ color: "#7eabc8" }}>{m.role}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 110px", gap: 8 }}>
              <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="captain@example.com" style={input} />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={input}>
                <option value="harbor_master">harbor_master</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
              <button onClick={inviteMember} disabled={busy || !inviteEmail} style={btnPrimary}>Invite</button>
            </div>
            {err && <Err>{err}</Err>}
            <Nav>
              <button onClick={() => setStep(4)} style={btnGhost}>← Back</button>
              <button onClick={() => advance(6)} disabled={busy} style={btnPrimary}>Continue →</button>
            </Nav>
          </div>
        )}

        {step === 6 && marina && (
          <div>
            <H>Make it yours</H>
            <Sub>Optional. Show up nicely on the map and on your marina dashboard.</Sub>
            <Field label="Tagline">
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="The friendliest dock on the Baltic" style={input} maxLength={120} />
            </Field>
            <Field label="Website">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://yourmarina.com" style={input} />
            </Field>
            <Field label="Brand color">
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} style={{ width: 50, height: 38, border: "none", background: "none", cursor: "pointer" }} />
                <input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} pattern="^#[0-9a-fA-F]{6}$" style={{ ...input, maxWidth: 120 }} />
              </div>
            </Field>
            {err && <Err>{err}</Err>}
            <Nav>
              <button onClick={() => setStep(5)} style={btnGhost}>← Back</button>
              <button onClick={submitStep6} disabled={busy} style={btnPrimary}>Continue →</button>
            </Nav>
          </div>
        )}

        {step === 7 && marina && (
          <div>
            <H>Ready to publish</H>
            <Sub>Publishing makes <b>{marina.name}</b> appear on the public marina map at mervare.app. You can unpublish from Settings anytime.</Sub>
            <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(126,171,200,0.18)", borderRadius: 8, padding: 14, marginBottom: 14, fontSize: 13, color: "#c9d4dd" }}>
              <div><b>{marina.name}</b> · <code>{marina.slug}.mervare.app</code></div>
              <div style={{ marginTop: 4 }}>Plan: {marina.plan} · {marina.country} · {sections.length} dock {sections.length === 1 ? "row" : "rows"}</div>
              {members.length > 0 && <div style={{ marginTop: 4 }}>Team: {members.length} member{members.length === 1 ? "" : "s"}</div>}
            </div>
            {err && <Err>{err}</Err>}
            <Nav>
              <button onClick={() => setStep(6)} style={btnGhost}>← Back</button>
              <button onClick={publish} disabled={busy} style={btnPrimary}>
                {busy ? "Publishing…" : "Publish marina ⚓"}
              </button>
            </Nav>
          </div>
        )}
      </Card>
    </Page>
  );
}

/* ───────── small UI helpers ───────── */

function Stepper({ current, marina, setStep }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
      {STEPS.map((s) => {
        const done = s.n < current;
        const active = s.n === current;
        const clickable = marina && s.n <= current;
        return (
          <div
            key={s.n}
            onClick={clickable ? () => setStep(s.n) : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              cursor: clickable ? "pointer" : "default",
              opacity: clickable ? 1 : 0.55,
            }}
          >
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: done ? "#2a9a4a" : active ? "#f0c040" : "rgba(126,171,200,0.2)",
              color: done || active ? "#091820" : "#7eabc8",
              fontSize: 11, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{done ? "✓" : s.n}</div>
            <span style={{ fontSize: 12, color: active ? "#f0c040" : "#7eabc8" }}>{s.title}</span>
          </div>
        );
      })}
    </div>
  );
}

function PlanRow({ plan, selected, onSelect }) {
  const meta = {
    free:     { title: "Free",     price: "€0",      desc: `Map listing + booking inquiries. ${INCENTIVES.PLATFORM_FEE_STANDARD_PCT}% platform fee on bookings.` },
    marina:   { title: "Marina",   price: "€49 / mo", desc: `Online booking, telemetry, shore power, owner portals. ${INCENTIVES.PLATFORM_FEE_STANDARD_PCT}% platform fee.` },
    founding: { title: "Founding", price: `€${Math.round(49 * (1 - INCENTIVES.FOUNDING_MARINA_DISCOUNT_PCT / 100))} / mo`, desc: `${INCENTIVES.FOUNDING_MARINA_DISCOUNT_PCT}% off Marina plan for life · ${INCENTIVES.PLATFORM_FEE_FOUNDING_PCT}% platform fee. First ${INCENTIVES.FOUNDING_MARINA_SLOTS_PER_COUNTRY} per country.` },
  }[plan];
  return (
    <div onClick={onSelect} style={{
      cursor: "pointer", padding: 14, borderRadius: 8, marginBottom: 8,
      border: selected ? "1px solid #f0c040" : "1px solid rgba(126,171,200,0.2)",
      background: selected ? "rgba(240,192,64,0.08)" : "rgba(0,0,0,0.15)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <b>{meta.title}</b>
        <span style={{ color: "#f0c040" }}>{meta.price}</span>
      </div>
      <div style={{ fontSize: 12, color: "#a8c4d4" }}>{meta.desc}</div>
    </div>
  );
}

function Page({ children }) {
  return (
    <>
      <Head><title>Set up your marina · MerVare</title></Head>
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg,#091820 0%,#0d2438 100%)",
        color: "#e8f4f8",
        fontFamily: "Inter, system-ui, sans-serif",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 20px",
      }}>
        {children}
      </div>
    </>
  );
}

function Card({ children }) {
  return (
    <div style={{
      maxWidth: 620, width: "100%",
      background: "rgba(13,36,56,0.7)",
      border: "1px solid rgba(126,171,200,0.2)",
      borderRadius: 12, padding: 28,
      boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
    }}>{children}</div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "#7eabc8", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  );
}

function H({ children }) { return <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{children}</h1>; }
function Sub({ children }) { return <p style={{ color: "#a8c4d4", marginTop: 0, marginBottom: 22, fontSize: 14 }}>{children}</p>; }
function Err({ children }) { return <div style={{ color: "#ff8a7a", fontSize: 13, margin: "10px 0" }}>{children}</div>; }
function Nav({ children }) { return <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, gap: 10 }}>{children}</div>; }

const input = {
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(126,171,200,0.25)",
  color: "#e8f4f8",
  borderRadius: 6,
  padding: "9px 10px",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const btnPrimary = {
  background: "#f0c040",
  color: "#091820",
  border: "none",
  borderRadius: 6,
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 1.5,
  cursor: "pointer",
  fontFamily: "inherit",
};
const btnGhost = {
  ...btnPrimary,
  background: "transparent",
  color: "#7eabc8",
  border: "1px solid rgba(126,171,200,0.3)",
  fontWeight: 400,
  letterSpacing: 0.5,
};
