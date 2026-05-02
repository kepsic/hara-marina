import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { INITIAL_BOATS } from "../lib/constants";
import { makeTelemetry } from "../lib/telemetry";
import { verifySession, SESSION_COOKIE_NAME } from "../lib/auth";
import { canViewBoat } from "../lib/owners";

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function getServerSideProps({ req, params }) {
  const slug = params.slug;
  const boat = INITIAL_BOATS.find((b) => norm(b.name) === slug);
  if (!boat) return { notFound: true };

  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = await verifySession(token);
  const email = session?.email;

  if (!email || !canViewBoat(email, slug)) {
    return {
      redirect: {
        destination: `/login?next=${encodeURIComponent(`/${slug}`)}`,
        permanent: false,
      },
    };
  }

  return { props: { initialBoat: boat, viewerEmail: email } };
}

function Stat({ label, value, unit, color = "#e8f4f8", big }) {
  const isBlank = value === null || value === undefined || value === "";
  return (
    <div style={{
      background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
      border:"1px solid rgba(126,171,200,0.18)",
      borderRadius:8, padding:"12px 14px", flex:"1 1 140px", minWidth:140,
    }}>
      <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:4}}>{label}</div>
      <div style={{fontSize:big?26:18,fontWeight:"bold",color,fontFamily:"Georgia, serif"}}>
        {isBlank ? <em style={{color:"#3a5a6a"}}>—</em> : value}
        {!isBlank && unit && <span style={{fontSize:11,color:"#5a8aaa",marginLeft:4,fontWeight:"normal"}}>{unit}</span>}
      </div>
    </div>
  );
}

export default function BoatPage({ initialBoat }) {
  const [boat, setBoat] = useState(initialBoat);
  const slug = norm(initialBoat.name);
  const [tel, setTel] = useState(() => makeTelemetry(initialBoat));
  const [weather, setWeather] = useState(null);

  // Pull live boat overrides (in case it was edited via the marina UI)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/data?key=hara-boats`);
        const j = await r.json();
        if (!alive) return;
        const list = j.value ? JSON.parse(j.value) : null;
        if (list) {
          const live = list.find((b) => norm(b.name) === slug);
          if (live) setBoat(live);
        }
      } catch {}
    }
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [slug]);

  // Telemetry refresh
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/telemetry/${slug}`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive && !j.error) setTel(j);
      } catch {}
    }
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [slug]);

  // Loksa weather
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/weather");
        if (!r.ok) return;
        const j = await r.json();
        if (alive && !j.error) setWeather(j);
      } catch {}
    }
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const lastSeen = tel.last_seen_ago < 60
    ? `${tel.last_seen_ago}s ago`
    : `${Math.round(tel.last_seen_ago / 60)} min ago`;
  const fresh = tel.last_seen_ago < 120;

  return (
    <>
      <Head>
        <title>{boat.name} · Hara Marina</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="theme-color" content="#091820"/>
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex"/>
        <meta name="googlebot" content="noindex, nofollow"/>
      </Head>

      <div style={{
        minHeight:"100vh",
        background:"radial-gradient(ellipse at 30% 20%,#0d3050 0%,#071520 70%)",
        fontFamily:"'Georgia','Times New Roman',serif", color:"#e8f4f8",
      }}>
        {/* Header */}
        <div style={{padding:"14px 20px",background:"linear-gradient(135deg,#0c2235,#112a3f)",
          borderBottom:"1px solid rgba(126,171,200,0.13)",
          display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <Link href="/" style={{textDecoration:"none",color:"#7eabc8",fontSize:11,letterSpacing:2}}>
            ← HARA MARINA
          </Link>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            {viewerEmail && (
              <div style={{fontSize:9,color:"#5a8aaa",letterSpacing:1}}>
                {viewerEmail} ·{" "}
                <a href="/api/auth/logout" style={{color:"#7eabc8",textDecoration:"none"}}>sign out</a>
              </div>
            )}
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:8,letterSpacing:3,color:"#7eabc8",textTransform:"uppercase"}}>Dock {boat.section}</div>
              <div style={{fontSize:9,color:fresh?"#2a9a4a":"#a08040",letterSpacing:1,marginTop:1}}>
                {fresh?"● live":"◌ stale"} · {lastSeen}
              </div>
            </div>
          </div>
        </div>

        {/* Boat hero */}
        <div style={{padding:"28px 20px 16px",maxWidth:980,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap"}}>
            <svg width="120" height="48" viewBox="0 0 80 32">
              <path d="M6 16 C6 16 18 4 50 4 L74 10 L76 16 L74 22 L50 28 C18 28 6 16 6 16Z"
                fill={boat.color} stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
              <line x1="38" y1="7" x2="38" y2="25" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5"/>
              <ellipse cx="58" cy="16" rx="9" ry="5.5" fill="rgba(0,0,0,0.28)"/>
            </svg>
            <div>
              <div style={{fontSize:9,letterSpacing:4,color:"#7eabc8",textTransform:"uppercase"}}>Vessel</div>
              <div style={{fontSize:36,fontWeight:"bold",letterSpacing:5}}>{boat.name}</div>
              {boat.owner && <div style={{fontSize:13,color:"#9ec8e0",marginTop:4}}>{boat.owner}</div>}
            </div>
          </div>
        </div>

        {/* Telemetry section */}
        <Section title="🛰 Telemetry">
          <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
            <Stat label="Battery" value={tel.battery.voltage.toFixed(2)} unit="V"
              color={tel.battery.voltage < 12.0 ? "#e08040" : "#2a9a4a"} big/>
            <Stat label="Battery charge" value={tel.battery.percent} unit="%"
              color={tel.battery.percent < 30 ? "#e08040" : "#9ec8e0"}/>
            <Stat label="Shore power" value={tel.shore_power ? "Connected" : "Disconnected"} unit=""
              color={tel.shore_power ? "#2a9a4a" : "#a08040"}/>
            <Stat label="Bilge water" value={tel.bilge.water_cm.toFixed(1)} unit="cm"
              color={tel.bilge.water_cm > 4 ? "#e08040" : "#6ab0e8"}/>
            <Stat label="Bilge pump 24h" value={tel.bilge.pump_cycles_24h} unit="cycles"/>
            <Stat label="Cabin temp" value={tel.cabin.temperature_c.toFixed(1)} unit="°C" color="#f0c040"/>
            <Stat label="Cabin humidity" value={tel.cabin.humidity_pct} unit="%"/>
            <Stat label="Heel" value={tel.heel_deg.toFixed(1)} unit="°"
              color={Math.abs(tel.heel_deg) > 3 ? "#e08040" : "#9ec8e0"}/>
          </div>

          <div style={{marginTop:14,display:"flex",flexWrap:"wrap",gap:12}}>
            <div style={{
              flex:"1 1 240px",background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
              border:"1px solid rgba(126,171,200,0.18)",borderRadius:8,padding:"12px 14px",
            }}>
              <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>Position</div>
              <div style={{fontFamily:"monospace",fontSize:13,color:"#e8f4f8"}}>
                {tel.position.lat.toFixed(5)}° N, {tel.position.lon.toFixed(5)}° E
              </div>
              <a href={`https://www.openstreetmap.org/?mlat=${tel.position.lat}&mlon=${tel.position.lon}#map=17/${tel.position.lat}/${tel.position.lon}`}
                 target="_blank" rel="noreferrer"
                 style={{fontSize:10,color:"#6ab0e8",letterSpacing:1,textDecoration:"none",marginTop:6,display:"inline-block"}}>
                Open in map ↗
              </a>
            </div>
          </div>
        </Section>

        {/* Weather (Loksa) */}
        <Section title="🌬 Local Conditions · Loksa Station">
          {weather ? (
            <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
              <Stat label="Wind" value={typeof weather.windspeed === "number" ? weather.windspeed.toFixed(1) : "—"} unit="m/s" color="#f0c040" big/>
              <Stat label="Gust" value={typeof weather.windspeedmax === "number" ? weather.windspeedmax.toFixed(1) : "—"} unit="m/s"/>
              <Stat label="Wind dir" value={typeof weather.winddirection === "number" ? `${Math.round(weather.winddirection)}°` : "—"} unit=""/>
              <Stat label="Air temp" value={weather.airtemperature} unit="°C" color="#f0c040"/>
              <Stat label="Sea temp" value={weather.watertemperature} unit="°C" color="#6ab0e8"/>
              <Stat label="Sea level" value={weather.waterlevel ?? weather.waterlevel_eh2000} unit="cm" color="#6ab0e8"/>
              <Stat label="Pressure" value={weather.airpressure} unit="hPa"/>
              <Stat label="Humidity" value={weather.relativehumidity} unit="%"/>
            </div>
          ) : (
            <div style={{fontSize:11,color:"#5a8aaa"}}>◌ loading…</div>
          )}
        </Section>

        {/* Spec section */}
        <Section title="📋 Vessel">
          <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
            <Stat label="Model" value={boat.model}/>
            <Stat label="Length" value={boat.length} unit="m"/>
            <Stat label="Beam" value={boat.beam} unit="m"/>
            <Stat label="Draft" value={boat.draft} unit="m"/>
            <Stat label="Engine" value={boat.engine}/>
          </div>
          {boat.equipment?.length > 0 && (
            <div style={{marginTop:14}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>Equipment</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {boat.equipment.map((e) => (
                  <span key={e} style={{
                    padding:"4px 9px",fontSize:10,borderRadius:3,
                    background:`${boat.color}28`,color:"#b8d8e8",border:`1px solid ${boat.color}40`,
                  }}>{e}</span>
                ))}
              </div>
            </div>
          )}
          {boat.notes && (
            <div style={{marginTop:14,fontSize:12,color:"#c8e0f0",fontStyle:"italic",
              borderLeft:`3px solid ${boat.color}`,padding:"4px 12px",background:"rgba(255,255,255,0.02)"}}>
              {boat.notes}
            </div>
          )}
        </Section>

        <div style={{padding:"24px 20px 40px",textAlign:"center",fontSize:9,color:"#3a5a6a",letterSpacing:2}}>
          ⚓ HARA · SADAM
        </div>
      </div>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div style={{maxWidth:980,margin:"0 auto",padding:"10px 20px 0"}}>
      <div style={{fontSize:10,letterSpacing:3,color:"#7eabc8",textTransform:"uppercase",
        margin:"18px 0 10px",borderBottom:"1px solid rgba(126,171,200,0.12)",paddingBottom:6}}>
        {title}
      </div>
      {children}
    </div>
  );
}
