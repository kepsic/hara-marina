import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

export default function MarinaSignup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [country, setCountry] = useState("EE");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [created, setCreated] = useState(null);

  function onName(v) {
    setName(v);
    if (!slugTouched) setSlug(norm(v));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/marinas/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, lat: Number(lat), lon: Number(lon), country }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (r.status === 401) {
          router.push(`/login?next=${encodeURIComponent("/marina-signup")}`);
          return;
        }
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setCreated(j.marina);
    } catch (e) {
      setErr(e.message || "failed");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const dashUrl = `https://${created.slug}.mervare.app`;
    return (
      <Page>
        <Card>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>⚓ {created.name} is live</h1>
          <p style={{ color: "#a8c4d4", marginBottom: 18 }}>
            Your marina is registered. Bookmark your dashboard URL — this is where guests will see your berth map.
          </p>
          <a href={dashUrl} style={btnPrimary}>
            Open {created.slug}.mervare.app →
          </a>
          <div style={{ marginTop: 24, fontSize: 13, color: "#7eabc8" }}>
            <p style={{ marginBottom: 8 }}><b>Next steps</b></p>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li>Add docks &amp; berths in the marina layout editor</li>
              <li>Connect Stripe to take berth payments</li>
              <li>Invite harbor masters via the Settings panel</li>
            </ul>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <Card>
        <h1 style={{ fontSize: 24, margin: "0 0 6px" }}>Register your marina</h1>
        <p style={{ color: "#a8c4d4", marginTop: 0, marginBottom: 22, fontSize: 14 }}>
          MerVare gives every marina its own subdomain, B2C berth booking, shore-power billing
          and Stripe payouts. The free plan covers up to 20 berths.
        </p>
        <form onSubmit={onSubmit}>
          <Field label="Marina name">
            <input
              required
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="e.g. Pirita Sadam"
              style={input}
            />
          </Field>
          <Field label="Subdomain slug">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                required
                value={slug}
                onChange={(e) => { setSlug(norm(e.target.value)); setSlugTouched(true); }}
                placeholder="pirita"
                style={{ ...input, flex: "0 1 200px" }}
              />
              <span style={{ color: "#7eabc8", fontSize: 13 }}>.mervare.app</span>
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 10 }}>
            <Field label="Latitude">
              <input
                required type="number" step="0.0001" inputMode="decimal"
                value={lat} onChange={(e) => setLat(e.target.value)}
                placeholder="59.5881" style={input}
              />
            </Field>
            <Field label="Longitude">
              <input
                required type="number" step="0.0001" inputMode="decimal"
                value={lon} onChange={(e) => setLon(e.target.value)}
                placeholder="25.6124" style={input}
              />
            </Field>
            <Field label="Country">
              <input
                required maxLength={2} value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                style={input}
              />
            </Field>
          </div>
          <p style={{ fontSize: 11, color: "#5a8aaa", marginTop: 4 }}>
            Tip: open <a href="https://www.openstreetmap.org" target="_blank" rel="noreferrer" style={{ color: "#7eabc8" }}>openstreetmap.org</a>,
            right-click your dock and copy the lat/lon.
          </p>

          {err && (
            <div style={{ marginTop: 14, color: "#ff8a7a", fontSize: 13 }}>{err}</div>
          )}

          <button type="submit" disabled={busy} style={{ ...btnPrimary, marginTop: 20, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Creating…" : "Create marina"}
          </button>

          <p style={{ marginTop: 18, fontSize: 12, color: "#7eabc8" }}>
            By signing up you agree to MerVare&apos;s terms. Already have a marina?{" "}
            <Link href="/login" style={{ color: "#9bd1f0" }}>Sign in</Link>.
          </p>
        </form>
      </Card>
    </Page>
  );
}

function Page({ children }) {
  return (
    <>
      <Head><title>Register your marina · MerVare</title></Head>
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg,#091820 0%,#0d2438 100%)",
        color: "#e8f4f8",
        fontFamily: "Inter, system-ui, sans-serif",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}>
        {children}
      </div>
    </>
  );
}

function Card({ children }) {
  return (
    <div style={{
      maxWidth: 560, width: "100%",
      background: "rgba(13,36,56,0.65)",
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

const input = {
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(126,171,200,0.25)",
  color: "#e8f4f8",
  padding: "9px 11px",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
  outline: "none",
};

const btnPrimary = {
  display: "inline-block",
  background: "#1e6fa8",
  color: "#fff",
  border: "none",
  padding: "11px 22px",
  borderRadius: 6,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "none",
};
