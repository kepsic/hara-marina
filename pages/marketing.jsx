import Head from "next/head";
import Link from "next/link";
import { INCENTIVES } from "../lib/incentives";
import { getSuperAdmins } from "../lib/owners";

export async function getServerSideProps() {
  // Static-ish landing — no per-request data needed today. Kept as SSR so
  // we can later inject open-spots-per-country counts without changing the
  // rendering path.
  //
  // Superadmin email is sourced from MARINA_SUPERADMINS so every CTA on the
  // page has a working human-contact fallback ("talk to a founder") if a
  // visitor can't or won't self-serve through /onboarding/marina.
  const supers = getSuperAdmins();
  const contactEmail = supers[0] || "hello@mervare.io";
  return {
    props: {
      foundingPct: INCENTIVES.PLATFORM_FEE_FOUNDING_PCT,
      standardPct: INCENTIVES.PLATFORM_FEE_STANDARD_PCT,
      slots: INCENTIVES.FOUNDING_MARINA_SLOTS_PER_COUNTRY,
      discount: INCENTIVES.FOUNDING_MARINA_DISCOUNT_PCT,
      contactEmail,
    },
  };
}

export default function MarketingPage({ foundingPct, standardPct, slots, discount, contactEmail }) {
  const mailto = `mailto:${contactEmail}?subject=${encodeURIComponent("MerVare — marina enquiry")}`;
  return (
    <>
      <Head>
        <title>MerVare — the operating system for small marinas</title>
        <meta
          name="description"
          content="Berth booking, live telemetry, owner portals, and shore-power billing — built with marinas, not for landlords. Founding marinas get 50% off for life."
        />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="MerVare" />
        <meta property="og:title" content="MerVare — the operating system for small marinas" />
        <meta property="og:description" content="Berth booking, live telemetry, shore-power billing." />
        <meta property="og:image" content="/api/og?title=MerVare&subtitle=The%20operating%20system%20for%20small%20marinas&badge=MerVare" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="MerVare — the operating system for small marinas" />
        <meta name="twitter:description" content="Berth booking, live telemetry, shore-power billing." />
        <meta name="twitter:image" content="/api/og?title=MerVare&subtitle=The%20operating%20system%20for%20small%20marinas&badge=MerVare" />
        <meta name="theme-color" content="#0b1d2c" />
      </Head>

      <main className="page">
        {/* ───── nav ───── */}
        <header className="nav">
          <div className="brand">
            <span className="logo" aria-hidden>⚓</span>
            <span className="brand-name">MerVare</span>
          </div>
          <nav className="nav-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#founding">Founding marinas</a>
            <Link href="/onboarding/marina">Sign up</Link>
            <Link href="/login" className="cta-link">Sign in</Link>
          </nav>
        </header>

        {/* ───── hero ───── */}
        <section className="hero">
          <h1>The operating system for small marinas.</h1>
          <p className="lede">
            Berth booking, live telemetry, owner portals, and shore-power billing —
            in one place. Built with the marinas that actually run docks, not for
            landlords who don't.
          </p>
          <div className="hero-cta">
            <Link href="/onboarding/marina" className="btn-primary">
              List your marina
            </Link>
            <a href="https://mervare.app" className="btn-secondary">
              Browse marinas →
            </a>
          </div>
          <p className="hero-meta">
            Trusted by Hara Sadam · 12 vessels · live telemetry since 2024
          </p>
        </section>

        {/* ───── features ───── */}
        <section id="features" className="features">
          <h2>Everything a small marina needs, nothing more.</h2>
          <div className="feature-grid">
            <Feature
              icon="🛟"
              title="Berth booking"
              text="Stripe Connect payouts go straight to your account. No invoicing, no chasing."
            />
            <Feature
              icon="📡"
              title="Live boat telemetry"
              text="NMEA-2000 → MQTT bridge. Battery, bilge, position, weather — visible to owners and watchkeepers."
            />
            <Feature
              icon="🔌"
              title="Shore-power billing"
              text="Per-berth relays with token-based access. Pay-as-you-go or pre-paid bundles."
            />
            <Feature
              icon="👥"
              title="Owner portals"
              text="Each boat owner gets their own page with safety status, history, and settings."
            />
            <Feature
              icon="🚨"
              title="Watchkeeper alerts"
              text="Low battery, mooring drift, high bilge level — pushed to the right phone, not a dashboard nobody opens."
            />
            <Feature
              icon="🌊"
              title="Marina conditions"
              text="Wind, wave, weather — sourced from your own anemometer if you have one, public APIs if you don't."
            />
          </div>
        </section>

        {/* ───── founding marina ───── */}
        <section id="founding" className="founding">
          <div className="founding-card">
            <span className="badge">Founding marina · {slots} slots per country</span>
            <h2>{discount}% off for life. {foundingPct}% platform fee instead of {standardPct}%.</h2>
            <p>
              The first {slots} marinas in each country pay half what everyone else
              pays — for as long as their listing is active. Plus a reduced
              {" "}{foundingPct}% platform fee on bookings (vs the standard {standardPct}%),
              matching the rate Mooringo charges its first-season operators.
            </p>
            <p>
              No exclusivity. No multi-year contract. Cancel anytime — but you'll
              never get the founding rate again.
            </p>
            <Link href="/onboarding/marina" className="btn-primary">
              Claim a founding slot
            </Link>
            <p className="founding-contact">
              Prefer to talk first?{" "}
              <a href={mailto}>Email a founder →</a>
            </p>
          </div>
        </section>

        {/* ───── pricing ───── */}
        <section id="pricing" className="pricing">
          <h2>Simple pricing.</h2>
          <div className="price-grid">
            <PriceCard
              tier="Free"
              price="€0"
              tagline="Map listing only"
              features={[
                "Public profile on mervare.app",
                "Contact form for moorage requests",
                "Standard {standardPct}% platform fee on any bookings",
              ].map((f) => f.replace("{standardPct}", standardPct))}
              cta="Get listed"
              href="/onboarding/marina"
            />
            <PriceCard
              tier="Marina"
              price="€49 / mo"
              tagline="Full operations"
              features={[
                "Online berth booking + Stripe Connect payouts",
                "Up to 200 boats with telemetry",
                "Shore-power tokens & relay control",
                "Owner portals with safety alerts",
                `${standardPct}% platform fee on bookings`,
              ]}
              cta="Start trial"
              href="/onboarding/marina"
              highlight
            />
            <PriceCard
              tier="Founding"
              price={`€${Math.round(49 * (1 - discount / 100))} / mo`}
              tagline={`First ${slots} per country, locked for life`}
              features={[
                `${discount}% off the Marina plan, forever`,
                `Reduced ${foundingPct}% platform fee on bookings`,
                "Direct line to the engineering team",
                "Vote on roadmap priorities",
              ]}
              cta="Claim a slot"
              href="/onboarding/marina"
            />
          </div>
        </section>

        {/* ───── for sailors ───── */}
        <section className="sailors">
          <h2>Sailing in?</h2>
          <p>
            Find marinas, book berths, and collect cruising-passport stamps —
            every {INCENTIVES.PASSPORT_MILESTONE_INTERVAL} confirmed nights earns a
            €{(INCENTIVES.PASSPORT_MILESTONE_CREDIT_CENTS / 100).toFixed(0)} credit
            toward your next stay.
          </p>
          <a href="https://mervare.app" className="btn-secondary">
            Open the marina map →
          </a>
        </section>

        {/* ───── footer ───── */}
        <footer className="foot">
          <div>© {new Date().getFullYear()} MerVare · Estonia</div>
          <div className="foot-links">
            <a href="https://mervare.app">mervare.app</a>
            <Link href="/onboarding/marina">Sign up</Link>
            <Link href="/login">Sign in</Link>
            <a href={mailto}>Contact</a>
          </div>
        </footer>
      </main>

      <style jsx>{`
        .page {
          background: linear-gradient(180deg, #0b1d2c 0%, #0e2434 60%, #0b1d2c 100%);
          color: #e6edf3;
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 32px;
          max-width: 1180px;
          margin: 0 auto;
        }
        .brand { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 700; }
        .logo { font-size: 24px; }
        .brand-name { letter-spacing: 0.5px; }
        .nav-links { display: flex; align-items: center; gap: 22px; font-size: 14px; }
        .nav-links a { color: #c9d4dd; text-decoration: none; }
        .nav-links a:hover { color: #fff; }
        .cta-link {
          background: #1e6fa8;
          padding: 8px 14px;
          border-radius: 6px;
          color: #fff !important;
        }
        .hero {
          max-width: 880px;
          margin: 0 auto;
          padding: 80px 32px 60px;
          text-align: center;
        }
        .hero h1 {
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1.08;
          margin: 0 0 20px;
          letter-spacing: -0.5px;
        }
        .lede { font-size: 18px; line-height: 1.6; color: #c9d4dd; margin: 0 auto 32px; max-width: 640px; }
        .hero-cta { display: flex; gap: 14px; justify-content: center; margin-bottom: 16px; flex-wrap: wrap; }
        .btn-primary {
          background: #1e6fa8;
          color: #fff;
          padding: 14px 26px;
          border-radius: 8px;
          font-weight: 600;
          text-decoration: none;
          display: inline-block;
        }
        .btn-primary:hover { background: #2585c4; }
        .btn-secondary {
          background: transparent;
          color: #e6edf3;
          padding: 14px 26px;
          border-radius: 8px;
          border: 1px solid #36506a;
          font-weight: 600;
          text-decoration: none;
          display: inline-block;
        }
        .btn-secondary:hover { border-color: #6a8aa8; }
        .hero-meta { font-size: 13px; color: #8aa0b4; margin: 12px 0 0; }
        section { padding: 60px 32px; }
        .features { max-width: 1180px; margin: 0 auto; }
        .features h2, .pricing h2, .sailors h2, .founding h2 {
          font-size: 30px;
          margin: 0 0 36px;
          text-align: center;
        }
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 20px;
        }
        .founding {
          max-width: 1180px;
          margin: 0 auto;
        }
        .founding-card {
          background: linear-gradient(135deg, #1e3a5a 0%, #1e6fa8 100%);
          border-radius: 16px;
          padding: 48px 40px;
          text-align: center;
          border: 1px solid #2585c4;
        }
        .founding-card h2 { text-align: center; margin: 0 0 16px; font-size: 26px; }
        .founding-card p { font-size: 15px; line-height: 1.6; color: #d8e3ec; max-width: 640px; margin: 0 auto 14px; }
        .founding-contact { font-size: 13px; color: #c8dceb; margin-top: 14px; }
        .founding-contact a { color: #fff; text-decoration: underline; }
        .badge {
          display: inline-block;
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 14px;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }
        .pricing { max-width: 1180px; margin: 0 auto; }
        .price-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 20px;
        }
        .sailors {
          max-width: 720px;
          margin: 0 auto;
          text-align: center;
        }
        .sailors p {
          font-size: 17px;
          line-height: 1.6;
          color: #c9d4dd;
          margin: 0 0 24px;
        }
        .foot {
          max-width: 1180px;
          margin: 0 auto;
          padding: 32px;
          display: flex;
          justify-content: space-between;
          color: #8aa0b4;
          font-size: 13px;
          border-top: 1px solid #1c3245;
        }
        .foot-links { display: flex; gap: 18px; }
        .foot-links a { color: #8aa0b4; text-decoration: none; }
        .foot-links a:hover { color: #fff; }
        @media (max-width: 640px) {
          .nav { flex-wrap: wrap; gap: 12px; padding: 14px 20px; }
          .nav-links { gap: 14px; font-size: 13px; }
          .hero { padding: 50px 20px 40px; }
          section { padding: 40px 20px; }
          .founding-card { padding: 32px 22px; }
          .foot { flex-direction: column; gap: 10px; text-align: center; }
        }
      `}</style>
    </>
  );
}

function Feature({ icon, title, text }) {
  return (
    <div className="card">
      <div className="ico" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      <style jsx>{`
        .card {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid #1c3245;
          border-radius: 12px;
          padding: 24px;
        }
        .ico { font-size: 28px; margin-bottom: 10px; }
        h3 { margin: 0 0 8px; font-size: 18px; color: #fff; }
        p { margin: 0; font-size: 14px; line-height: 1.5; color: #b6c5d2; }
      `}</style>
    </div>
  );
}

function PriceCard({ tier, price, tagline, features, cta, href, highlight = false }) {
  return (
    <div className={`pcard ${highlight ? "highlight" : ""}`}>
      <div className="tier">{tier}</div>
      <div className="price">{price}</div>
      <div className="tagline">{tagline}</div>
      <ul>{features.map((f) => <li key={f}>{f}</li>)}</ul>
      <Link href={href} className="cta">{cta}</Link>
      <style jsx>{`
        .pcard {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid #1c3245;
          border-radius: 14px;
          padding: 28px 24px;
          display: flex;
          flex-direction: column;
        }
        .pcard.highlight {
          border-color: #2585c4;
          background: rgba(30, 111, 168, 0.12);
          transform: translateY(-4px);
        }
        .tier { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: #8aa0b4; }
        .price { font-size: 32px; font-weight: 700; margin: 6px 0 4px; color: #fff; }
        .tagline { font-size: 13px; color: #b6c5d2; margin-bottom: 18px; }
        ul { list-style: none; padding: 0; margin: 0 0 22px; flex: 1; }
        li { font-size: 14px; color: #d8e3ec; padding: 6px 0 6px 22px; position: relative; line-height: 1.45; }
        li::before {
          content: "✓";
          color: #2585c4;
          position: absolute;
          left: 0;
          top: 6px;
          font-weight: 700;
        }
        .cta {
          background: #1e6fa8;
          color: #fff;
          padding: 12px 18px;
          border-radius: 8px;
          font-weight: 600;
          text-align: center;
          text-decoration: none;
        }
        .cta:hover { background: #2585c4; }
      `}</style>
    </div>
  );
}
