import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { INITIAL_BOATS } from "../lib/constants";
import {
  verifySession,
  SESSION_COOKIE_NAME,
  verifyBoatShareSession,
  BOAT_SHARE_COOKIE_NAME,
} from "../lib/auth";
import { canViewBoat } from "../lib/owners";
import BoatPhotos from "../components/BoatPhotos";
import BoatWindRose from "../components/BoatWindRose";
import HeadingClock from "../components/HeadingClock";
import WindDirCompass from "../components/WindDirCompass";
import GaugeDial from "../components/GaugeDial";
import WaterDepthBar from "../components/WaterDepthBar";
import SettingsModal from "../components/SettingsModal";
import ShareModal from "../components/ShareModal";
import TelemetryHistoryChart from "../components/TelemetryHistoryChart";

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmt = (v, d = 1) => (isNum(v) ? v.toFixed(d) : null);
const knToMs = (kn) => kn * 0.514444;

export async function getServerSideProps({ req, params, query }) {
  const slug = params.slug;
  const baseBoat = INITIAL_BOATS.find((b) => norm(b.name) === slug);
  if (!baseBoat) return { notFound: true };

  // Overlay any owner-saved settings (display name, owner, color, alarms…).
  const { getBoatSettings, applyBoatSettings } = await import("../lib/boatSettings");
  const settings = await getBoatSettings(slug);
  const boat = applyBoatSettings(baseBoat, settings);

  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = await verifySession(token);
  const email = session?.email;

  if (email && canViewBoat(email, slug)) {
    return { props: { initialBoat: boat, viewerEmail: email, accessKind: "owner", lockType: null, shareId: null } };
  }

  const shareSession = await verifyBoatShareSession(req.cookies?.[BOAT_SHARE_COOKIE_NAME]);
  if (shareSession?.slug === slug) {
    return { props: { initialBoat: boat, viewerEmail: null, accessKind: "shared", lockType: null, shareId: null } };
  }

  const { hasOwnerPin, isShareIdActive } = await import("../lib/boatAccess");
  const shareId = typeof query.share === "string" ? query.share : null;
  if (shareId && await isShareIdActive(slug, shareId)) {
    return {
      props: {
        initialBoat: boat,
        viewerEmail: null,
        accessKind: "pin-locked",
        lockType: "temporary",
        shareId,
      },
    };
  }

  if (await hasOwnerPin(slug)) {
    return {
      props: {
        initialBoat: boat,
        viewerEmail: null,
        accessKind: "pin-locked",
        lockType: "owner",
        shareId: null,
      },
    };
  }

  return {
    redirect: {
      destination: `/login?next=${encodeURIComponent(`/${slug}`)}`,
      permanent: false,
    },
  };
}

function Stat({ label, value, unit, color = "#e8f4f8", big }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{
      background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
      border:"1px solid rgba(126,171,200,0.18)",
      borderRadius:8, padding:"12px 14px", flex:"1 1 140px", minWidth:140,
    }}>
      <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:4}}>{label}</div>
      <div style={{fontSize:big?26:18,fontWeight:"bold",color,fontFamily:"Georgia, serif"}}>
        {value}
        {unit && <span style={{fontSize:11,color:"#5a8aaa",marginLeft:4,fontWeight:"normal"}}>{unit}</span>}
      </div>
    </div>
  );
}

export default function BoatPage({ initialBoat, viewerEmail, accessKind = "owner", lockType = null, shareId = null }) {
  const [boat, setBoat] = useState(initialBoat);
  const slug = norm(initialBoat.name);
  const [tel, setTel] = useState(null);
  const [weather, setWeather] = useState(null);
  const [ais, setAis] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  // Restore tab from URL hash (#tab=telemetry) on mount; persist on change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.location.hash.match(/tab=([a-z]+)/i);
    const allowed = ["overview", "telemetry", "relay"];
    if (m && allowed.includes(m[1])) setActiveTab(m[1]);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = `#tab=${activeTab}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
    }
  }, [activeTab]);
  const [pinInput, setPinInput] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinErr, setPinErr] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [ownerPinBusy, setOwnerPinBusy] = useState(false);
  const [ownerPinMsg, setOwnerPinMsg] = useState("");
  const [accessInfo, setAccessInfo] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [shareData, setShareData] = useState(null);
  const [shareTtlMin, setShareTtlMin] = useState(120);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [relayBusy, setRelayBusy] = useState(0);
  const [relayPending, setRelayPending] = useState({}); // { [n]: expectedState } while awaiting confirm
  const [relayMsg, setRelayMsg] = useState("");
  const [ruleEnabled, setRuleEnabled] = useState(false);
  const [ruleRelay, setRuleRelay] = useState(1);
  const [ruleOnAbove, setRuleOnAbove] = useState(80);
  const [ruleOffBelow, setRuleOffBelow] = useState(75);
  const [ruleBusy, setRuleBusy] = useState(false);
  const [ruleMsg, setRuleMsg] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [scenariosBusy, setScenariosBusy] = useState(false);
  const [scenariosMsg, setScenariosMsg] = useState("");
  const [editingScenario, setEditingScenario] = useState(null); // null = not editing

  // Pull live boat overrides (in case it was edited via the marina UI)
  useEffect(() => {
    if (accessKind === "pin-locked") return;
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

  // Telemetry refresh.
  useEffect(() => {
    if (accessKind === "pin-locked") return;
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/telemetry/${slug}`);
        const j = await r.json();
        if (alive) setTel(r.ok && !j.error ? j : null);
      } catch {}
    }
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [slug]);

  // AIS / marina state (Moored | Anchored nearby | Underway | Away)
  useEffect(() => {
    if (accessKind === "pin-locked") return;
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/ais/${slug}`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setAis(j);
      } catch {}
    }
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [slug]);

  // Loksa weather
  useEffect(() => {
    if (accessKind === "pin-locked") return;
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

  useEffect(() => {
    if (accessKind !== "owner") return;
    let alive = true;
    async function loadAccess() {
      try {
        const r = await fetch(`/api/boat-access/${slug}`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setAccessInfo(j);
      } catch {}
    }
    loadAccess();
    return () => { alive = false; };
  }, [accessKind, slug]);

  useEffect(() => {
    if (accessKind !== "owner") return;
    let alive = true;
    async function loadScenarios() {
      try {
        const r = await fetch(`/api/relays/${slug}/scenarios`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive && Array.isArray(j.scenarios)) setScenarios(j.scenarios);
      } catch {}
    }
    loadScenarios();
    return () => { alive = false; };
  }, [accessKind, slug]);

  async function saveScenarios(updated) {
    setScenariosBusy(true);
    setScenariosMsg("");
    try {
      const r = await fetch(`/api/relays/${slug}/scenarios`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarios: updated }),
      });
      const j = await r.json();
      if (!r.ok) {
        setScenariosMsg(j.error || "save failed");
      } else {
        setScenarios(j.scenarios);
        setScenariosMsg("Scenarios saved and sent to bridge");
        setEditingScenario(null);
      }
    } catch {
      setScenariosMsg("network error");
    } finally {
      setScenariosBusy(false);
    }
  }

  const lastSeen = tel?.last_seen_ago < 60
    ? `${tel.last_seen_ago}s ago`
    : tel?.last_seen_ago != null ? `${Math.round(tel.last_seen_ago / 60)} min ago` : null;
  const fresh = (tel?.last_seen_ago ?? Infinity) < 120;
  const isOwnerView = accessKind === "owner";
  const hasBilgeWater = isNum(tel?.bilge?.water_cm);
  const hasBilgePump = isNum(tel?.bilge?.pump_cycles_24h);
  const posLat = isNum(tel?.position?.lat) ? tel.position.lat : (isNum(ais?.lat) ? ais.lat : null);
  const posLon = isNum(tel?.position?.lon) ? tel.position.lon : (isNum(ais?.lon) ? ais.lon : null);
  const posSource = isNum(tel?.position?.lat) && isNum(tel?.position?.lon) ? "Onboard GPS" : (isNum(ais?.lat) && isNum(ais?.lon) ? "AIS fallback" : null);
  const seaTempC = isNum(tel?.water_temp_c) ? tel.water_temp_c : null;
  const relays = tel?.relays?.bank1 || {};

  async function setRelay(relay, state) {
    setRelayBusy(relay);
    setRelayPending((p) => ({ ...p, [relay]: state }));
    setRelayMsg("");
    try {
      const r = await fetch(`/api/relays/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relay, state }),
      });
      const j = await r.json();
      if (!r.ok) {
        setRelayMsg(j.error || "relay command failed");
        setRelayPending((p) => { const n = { ...p }; delete n[relay]; return n; });
      } else {
        setRelayMsg(`Relay ${relay} → ${state ? "ON" : "OFF"} (confirming…)`);
        setTel((prev) => ({
          ...(prev || {}),
          relays: {
            ...(prev?.relays || {}),
            bank1: {
              ...(prev?.relays?.bank1 || {}),
              [`relay${relay}`]: state,
            },
          },
        }));
        // Re-poll telemetry quickly so the next PGN 127501 status from the
        // YDCC-04 confirms (or corrects) the optimistic state, instead of
        // waiting for the 30s background poll.
        const confirm = async () => {
          try {
            const tr = await fetch(`/api/telemetry/${slug}`);
            const tj = await tr.json();
            if (tr.ok && !tj.error) {
              setTel(tj);
              const live = tj?.relays?.bank1?.[`relay${relay}`];
              if (typeof live === "boolean" && live === state) {
                setRelayMsg(`Relay ${relay} confirmed ${live ? "ON" : "OFF"}`);
                setRelayPending((p) => { const n = { ...p }; delete n[relay]; return n; });
                return true;
              }
              if (typeof live === "boolean" && live !== state) {
                setRelayMsg(`Relay ${relay} reported ${live ? "ON" : "OFF"}`);
              }
            }
          } catch {}
          return false;
        };
        setTimeout(async () => {
          if (await confirm()) return;
          setTimeout(async () => {
            if (await confirm()) return;
            // give up waiting; clear pending so UI reflects whatever the bus reports
            setRelayPending((p) => { const n = { ...p }; delete n[relay]; return n; });
          }, 2500);
        }, 1500);
      }
    } catch {
      setRelayMsg("network error");
      setRelayPending((p) => { const n = { ...p }; delete n[relay]; return n; });
    } finally {
      setRelayBusy(0);
    }
  }

  async function saveHumidityRule() {
    setRuleBusy(true);
    setRuleMsg("");
    try {
      const r = await fetch(`/api/relays/${slug}/humidity-rule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: ruleEnabled,
          relay: ruleRelay,
          onAbove: Number(ruleOnAbove),
          offBelow: Number(ruleOffBelow),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setRuleMsg(j.error || "rule save failed");
      } else {
        setRuleMsg("Humidity rule sent to boat bridge");
      }
    } catch {
      setRuleMsg("network error");
    } finally {
      setRuleBusy(false);
    }
  }

  async function submitPin(e) {
    e.preventDefault();
    setPinBusy(true);
    setPinErr("");
    try {
      const r = await fetch("/api/boat-access/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, pin: pinInput, shareId }),
      });
      const j = await r.json();
      if (!r.ok) {
        setPinErr(j.error || "invalid PIN");
      } else {
        window.location.href = `/${slug}`;
      }
    } catch {
      setPinErr("network error");
    } finally {
      setPinBusy(false);
    }
  }

  async function saveOwnerPin(e) {
    e.preventDefault();
    setOwnerPinBusy(true);
    setOwnerPinMsg("");
    try {
      const r = await fetch(`/api/boat-access/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerPin }),
      });
      const j = await r.json();
      if (!r.ok) {
        setOwnerPinMsg(j.error || "could not save");
      } else {
        setOwnerPin("");
        setOwnerPinMsg("PIN saved");
        setAccessInfo((prev) => ({ ...(prev || {}), ownerPinSet: true }));
      }
    } catch {
      setOwnerPinMsg("network error");
    } finally {
      setOwnerPinBusy(false);
    }
  }

  async function createShare() {
    setShareBusy(true);
    setShareMsg("");
    try {
      const r = await fetch(`/api/boat-access/${slug}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlMinutes: shareTtlMin }),
      });
      const j = await r.json();
      if (!r.ok) {
        setShareMsg(j.error || "could not create share");
      } else {
        setShareData(j);
        setShareMsg("Temporary share created");
        setAccessInfo((prev) => ({
          ...(prev || {}),
          activeShare: {
            id: j.shareId,
            expiresAtMs: j.expiresAtMs,
            createdAtMs: Date.now(),
          },
        }));
      }
    } catch {
      setShareMsg("network error");
    } finally {
      setShareBusy(false);
    }
  }

  if (accessKind === "pin-locked") {
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
          display:"flex",alignItems:"center",justifyContent:"center",padding:20,
        }}>
          <div style={{
            width:"100%",maxWidth:420,
            background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
            border:"1px solid rgba(126,171,200,0.18)",borderRadius:10,padding:"28px 24px",
          }}>
            <div style={{fontSize:9,letterSpacing:4,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>
              {lockType === "temporary" ? "Temporary Share PIN" : "Boat PIN"}
            </div>
            <h1 style={{margin:"0 0 14px",fontSize:24,letterSpacing:2}}>{boat.name}</h1>
            <p style={{marginTop:0,fontSize:12,color:"#9ec8e0",lineHeight:1.6}}>
              {lockType === "temporary"
                ? "This shared link is protected. Enter the temporary PIN provided by the owner."
                : "This boat page is PIN-protected. Enter the boat PIN to continue."}
            </p>
            <form onSubmit={submitPin}>
              <input
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="PIN"
                inputMode="numeric"
                autoFocus
                style={{
                  width:"100%",boxSizing:"border-box",padding:"10px 12px",fontSize:18,letterSpacing:4,
                  background:"rgba(255,255,255,0.06)",border:"1px solid rgba(126,171,200,0.25)",
                  color:"#e8f4f8",borderRadius:6,outline:"none",fontFamily:"inherit",textAlign:"center",
                }}
              />
              <button type="submit" disabled={pinBusy || pinInput.length < 4}
                style={{
                  marginTop:12,width:"100%",padding:"10px",cursor:"pointer",
                  background:pinBusy?"rgba(126,171,200,0.15)":"#f0c040",
                  color:pinBusy?"#7eabc8":"#091820",
                  border:"none",borderRadius:6,fontSize:13,letterSpacing:2,fontWeight:"bold",fontFamily:"inherit",
                }}>
                {pinBusy ? "Checking…" : "Unlock boat page"}
              </button>
              {pinErr && <div style={{marginTop:10,fontSize:11,color:"#e08080"}}>{pinErr}</div>}
            </form>
            <div style={{marginTop:18,fontSize:10,color:"#5a8aaa",textAlign:"center"}}>
              <a href="/login" style={{color:"#7eabc8",textDecoration:"none"}}>Owner sign in</a>
            </div>
          </div>
        </div>
      </>
    );
  }

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
            {isOwnerView && (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <IconBtn title="Share boat" onClick={() => setShareOpen(true)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5"  r="3"/>
                    <circle cx="6"  cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <line x1="8.6"  y1="13.5" x2="15.4" y2="17.5"/>
                    <line x1="15.4" y1="6.5"  x2="8.6"  y2="10.5"/>
                  </svg>
                </IconBtn>
                <IconBtn title="Boat settings" onClick={() => setSettingsOpen(true)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.16.68.4.93.71.25.31.43.68.51 1.08.08.39.07.81-.02 1.21z"/>
                  </svg>
                </IconBtn>
              </div>
            )}
            {(viewerEmail || accessKind === "shared") && (
              <div style={{fontSize:9,color:"#5a8aaa",letterSpacing:1}}>
                {viewerEmail || "shared guest"} ·{" "}
                <a href="/api/auth/logout" style={{color:"#7eabc8",textDecoration:"none"}}>
                  {viewerEmail ? "sign out" : "leave share"}
                </a>
              </div>
            )}
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:8,letterSpacing:3,color:"#7eabc8",textTransform:"uppercase"}}>Dock {boat.section}</div>
              {tel && (
                <div style={{fontSize:9,color:fresh?"#2a9a4a":"#a08040",letterSpacing:1,marginTop:1}}>
                  {fresh?"● live":"◌ stale"} · {lastSeen}
                </div>
              )}

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

        {/* Tab bar */}
        <div style={{
          maxWidth:980, margin:"0 auto", padding:"0 20px",
          display:"flex", gap:0, borderBottom:"1px solid rgba(126,171,200,0.15)",
        }}>
          {[
            { key:"overview", label:"Overview" },
            { key:"telemetry", label:"Telemetry" },
            ...(isOwnerView ? [{ key:"relay", label:"⚡ Relay & Scenarios" }] : []),
          ].map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                padding:"10px 18px", cursor:"pointer", border:"none",
                background:"transparent", fontFamily:"inherit",
                fontSize:11, letterSpacing:2, textTransform:"uppercase",
                color: activeTab === tab.key ? "#f0c040" : "#7eabc8",
                borderBottom: activeTab === tab.key ? "2px solid #f0c040" : "2px solid transparent",
                marginBottom:-1,
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ---- Overview tab ---- */}
        {activeTab === "overview" && (<>

        {/* Quick live stats on overview */}
        {((!boat.no_battery && isNum(tel?.battery?.voltage)) || isNum(seaTempC) || isNum(tel?.dewpoint_c) || isNum(tel?.cabin?.humidity_pct) || isNum(tel?.cabin?.temperature_c)) && (
          <Section title="📊 Live Snapshot">
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",
              gap:12,
            }}>
              {!boat.no_battery && isNum(tel?.battery?.voltage) && (
                <GaugeDial
                  label="Battery" value={tel.battery.voltage} unit="V"
                  min={11} max={14.5} digits={2}
                  color={tel.battery.voltage < 12.0 ? "#e08040" : "#2a9a4a"}
                  bands={[
                    { from:11,    to:12.0, color:"#e08040" },
                    { from:12.4,  to:13.6, color:"#2a9a4a" },
                  ]}
                />
              )}
              {!boat.no_battery && isNum(tel?.battery?.percent) && (
                <GaugeDial
                  label="Charge" value={tel.battery.percent} unit="%"
                  min={0} max={100} digits={0}
                  color={tel.battery.percent < 30 ? "#e08040" : "#9ec8e0"}
                  bands={[
                    { from:0,  to:30,  color:"#e08040" },
                    { from:60, to:100, color:"#2a9a4a" },
                  ]}
                />
              )}
              {isNum(tel?.cabin?.temperature_c) && (
                <GaugeDial
                  label="Cabin temp" value={tel.cabin.temperature_c} unit="°C"
                  min={-10} max={40} digits={1} color="#f0c040"
                  bands={[
                    { from:-10, to:5,  color:"#6ab0e8" },
                    { from:18,  to:26, color:"#2a9a4a" },
                    { from:30,  to:40, color:"#e08040" },
                  ]}
                />
              )}
              {isNum(tel?.cabin?.humidity_pct) && (
                <GaugeDial
                  label="Humidity" value={tel.cabin.humidity_pct} unit="%"
                  min={0} max={100} digits={0} color="#9ec8e0"
                  bands={[
                    { from:40, to:60,  color:"#2a9a4a" },
                    { from:75, to:100, color:"#e08040" },
                  ]}
                />
              )}
              {isNum(tel?.dewpoint_c) && (
                <GaugeDial
                  label="Dew point" value={tel.dewpoint_c} unit="°C"
                  min={-10} max={30} digits={1} color="#9ec8e0"
                />
              )}
              {isNum(seaTempC) && (
                <GaugeDial
                  label="Sea temp" value={seaTempC} unit="°C"
                  min={0} max={30} digits={1} color="#6ab0e8"
                  bands={[
                    { from:0,  to:10, color:"#6ab0e8" },
                    { from:18, to:25, color:"#2a9a4a" },
                  ]}
                />
              )}
            </div>
          </Section>
        )}

        {/* Wind — from boat sensors when available, falls back to weather station */}
        <BoatWindSection tel={tel} ais={ais} weather={weather} />

        {/* AIS / Marina state */}
        <Section title="📡 AIS · Marina Status">
          <AisStatus ais={ais} />
        </Section>

        {/* Weather (Loksa) */}
        <Section title="🌬 Local Conditions · Loksa Station">
          {weather ? (
            <div style={{display:"flex",flexWrap:"wrap",gap:18,alignItems:"flex-start"}}>
              {isNum(weather.winddirection) && (
                <div style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                }}>
                  <WindDirCompass dirDeg={weather.winddirection} size={200} label="Wind direction" />
                </div>
              )}
              <div style={{
                flex:"1 1 320px",
                display:"grid",
                gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",
                gap:12,
              }}>
                {isNum(weather.windspeed) && (
                  <GaugeDial
                    label="Wind" value={weather.windspeed} unit="m/s"
                    min={0} max={25} digits={1} color="#f0c040"
                    bands={[
                      { from:0,  to:3,  color:"#2a9a4a" },
                      { from:12, to:18, color:"#f0c040" },
                      { from:18, to:25, color:"#e08040" },
                    ]}
                  />
                )}
                {isNum(weather.windspeedmax) && (
                  <GaugeDial
                    label="Gust" value={weather.windspeedmax} unit="m/s"
                    min={0} max={30} digits={1} color="#9ec8e0"
                    bands={[
                      { from:15, to:22, color:"#f0c040" },
                      { from:22, to:30, color:"#e08040" },
                    ]}
                  />
                )}
                {isNum(weather.airtemperature) && (
                  <GaugeDial
                    label="Air temp" value={weather.airtemperature} unit="°C"
                    min={-10} max={35} digits={1} color="#f0c040"
                    bands={[
                      { from:-10, to:0,  color:"#6ab0e8" },
                      { from:18,  to:26, color:"#2a9a4a" },
                      { from:30,  to:35, color:"#e08040" },
                    ]}
                  />
                )}
                {isNum(weather.watertemperature) && (
                  <GaugeDial
                    label="Sea temp" value={weather.watertemperature} unit="°C"
                    min={0} max={30} digits={1} color="#6ab0e8"
                    bands={[
                      { from:0,  to:10, color:"#6ab0e8" },
                      { from:18, to:25, color:"#2a9a4a" },
                    ]}
                  />
                )}
                {isNum(weather.waterlevel ?? weather.waterlevel_eh2000) && (
                  <GaugeDial
                    label="Sea level" value={weather.waterlevel ?? weather.waterlevel_eh2000} unit="cm"
                    min={-80} max={120} digits={0} color="#6ab0e8"
                    bands={[
                      { from:-80, to:-40, color:"#e08040" },
                      { from:-10, to:10,  color:"#2a9a4a" },
                      { from:60,  to:120, color:"#e08040" },
                    ]}
                  />
                )}
                {isNum(weather.airpressure) && (
                  <GaugeDial
                    label="Pressure" value={weather.airpressure} unit="hPa"
                    min={970} max={1040} digits={1} color="#9ec8e0"
                    bands={[
                      { from:970,  to:1000, color:"#e08040" },
                      { from:1010, to:1025, color:"#2a9a4a" },
                    ]}
                  />
                )}
                {isNum(weather.relativehumidity) && (
                  <GaugeDial
                    label="Humidity" value={weather.relativehumidity} unit="%"
                    min={0} max={100} digits={0} color="#9ec8e0"
                    bands={[
                      { from:40, to:60,  color:"#2a9a4a" },
                      { from:85, to:100, color:"#6ab0e8" },
                    ]}
                  />
                )}
              </div>
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

        {/* Photos */}
        <Section title="📷 Photos">
          <BoatPhotos slug={slug} color={boat.color} />
        </Section>
        </>)}

        {/* ---- Telemetry tab ---- */}
        {activeTab === "telemetry" && (<>
        <Section title="📈 History">
          <TelemetryHistoryChart slug={slug} defaultRange="24h" defaultGroup="power" />
        </Section>



        <Section title="🛰 Telemetry">
          {(!boat.no_battery && (isNum(tel?.battery?.voltage) || isNum(tel?.battery?.percent))) || typeof tel?.shore_power === "boolean" ? (
            <TelemetryGroup title="Electrical">
              {!boat.no_battery && isNum(tel?.battery?.voltage) && (
                <Stat label="Battery" value={fmt(tel.battery.voltage, 2)} unit="V"
                  color={tel.battery.voltage < 12.0 ? "#e08040" : "#2a9a4a"} big/>
              )}
              {!boat.no_battery && isNum(tel?.battery?.percent) && (
                <Stat label="Battery charge" value={Math.round(tel.battery.percent)} unit="%"
                  color={tel.battery.percent < 30 ? "#e08040" : "#9ec8e0"}/>
              )}
              {typeof tel?.shore_power === "boolean" && (
                <Stat label="Shore power" value={tel.shore_power ? "Connected" : "Disconnected"} unit=""
                  color={tel.shore_power ? "#2a9a4a" : "#a08040"}/>
              )}
            </TelemetryGroup>
          ) : null}

          {(isNum(tel?.ac?.voltage_v) || isNum(tel?.ac?.current_a) || isNum(tel?.ac?.power_w) || isNum(tel?.ac?.energy_kwh_total) || isNum(tel?.ac?.energy_kwh_day) || isNum(tel?.ac?.energy_kwh_month) || isNum(tel?.ac?.energy_kwh_year)) && (
            <TelemetryGroup title="AC & Energy" style={{marginTop:12}}>
              {isNum(tel?.ac?.voltage_v) && (
                <Stat label="AC voltage" value={fmt(tel.ac.voltage_v, 1)} unit="V" color="#f0c040"/>
              )}
              {isNum(tel?.ac?.current_a) && (
                <Stat label="AC current" value={fmt(tel.ac.current_a, 1)} unit="A" color="#f0c040"/>
              )}
              {isNum(tel?.ac?.power_w) && (
                <Stat label="AC power" value={Math.round(tel.ac.power_w)} unit="W" color="#f0c040"/>
              )}
              {isNum(tel?.ac?.energy_kwh_total) && (
                <Stat label="kWh total" value={fmt(tel.ac.energy_kwh_total, 2)} unit="kWh" color="#f0c040"/>
              )}
              {isNum(tel?.ac?.energy_kwh_day) && (
                <Stat label="kWh day" value={fmt(tel.ac.energy_kwh_day, 2)} unit="kWh"/>
              )}
              {isNum(tel?.ac?.energy_kwh_month) && (
                <Stat label="kWh month" value={fmt(tel.ac.energy_kwh_month, 2)} unit="kWh"/>
              )}
              {isNum(tel?.ac?.energy_kwh_year) && (
                <Stat label="kWh year" value={fmt(tel.ac.energy_kwh_year, 2)} unit="kWh"/>
              )}
            </TelemetryGroup>
          )}

          {(isNum(tel?.cabin?.temperature_c) || isNum(tel?.cabin?.humidity_pct) || isNum(tel?.dewpoint_c) || isNum(seaTempC)) && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:8}}>Climate</div>
              <div style={{
                display:"grid",
                gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",
                gap:12,
              }}>
                {isNum(tel?.cabin?.temperature_c) && (
                  <GaugeDial
                    label="Cabin temp" value={tel.cabin.temperature_c} unit="°C"
                    min={-10} max={40} digits={1} color="#f0c040"
                    bands={[
                      { from:-10, to:5,   color:"#6ab0e8" },
                      { from:18,  to:26,  color:"#2a9a4a" },
                      { from:30,  to:40,  color:"#e08040" },
                    ]}
                  />
                )}
                {isNum(tel?.cabin?.humidity_pct) && (
                  <GaugeDial
                    label="Cabin humidity" value={tel.cabin.humidity_pct} unit="%"
                    min={0} max={100} digits={0} color="#9ec8e0"
                    bands={[
                      { from:40, to:60, color:"#2a9a4a" },
                      { from:75, to:100, color:"#e08040" },
                    ]}
                  />
                )}
                {isNum(tel?.dewpoint_c) && (
                  <GaugeDial
                    label="Dew point" value={tel.dewpoint_c} unit="°C"
                    min={-10} max={30} digits={1} color="#9ec8e0"
                  />
                )}
                {isNum(seaTempC) && (
                  <GaugeDial
                    label="Sea temp" value={seaTempC} unit="°C"
                    min={0} max={30} digits={1} color="#6ab0e8"
                    bands={[
                      { from:0,  to:10, color:"#6ab0e8" },
                      { from:18, to:25, color:"#2a9a4a" },
                    ]}
                  />
                )}
              </div>
            </div>
          )}

          {(isNum(tel?.heel_deg) || isNum(tel?.pitch_deg) || isNum(tel?.boat_speed_kn) || isNum(tel?.sog_kn) || isNum(ais?.sog) || isNum(tel?.heading_deg) || isNum(ais?.heading) || isNum(tel?.log_total_nm)) && (<>
            {(isNum(tel?.heading_deg) || isNum(ais?.heading) || isNum(tel?.cog_deg) || isNum(ais?.cog)) && (
              <div style={{marginTop:12,display:"flex",justifyContent:"flex-start"}}>
                <HeadingClock
                  headingDeg={isNum(tel?.heading_deg) ? tel.heading_deg : (isNum(ais?.heading) ? ais.heading : null)}
                  cogDeg={isNum(tel?.cog_deg) ? tel.cog_deg : (isNum(ais?.cog) ? ais.cog : null)}
                />
              </div>
            )}
            <div style={{marginTop:12}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:8}}>Motion &amp; Navigation</div>
              <div style={{
                display:"grid",
                gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",
                gap:12,
              }}>
                {isNum(tel?.heel_deg) && (
                  <GaugeDial
                    label="Heel" value={tel.heel_deg} unit="°"
                    min={-30} max={30} digits={1}
                    color={Math.abs(tel.heel_deg) > 3 ? "#e08040" : "#9ec8e0"}
                    bands={[
                      { from:-30, to:-15, color:"#e08040" },
                      { from:-3,  to:3,   color:"#2a9a4a" },
                      { from:15,  to:30,  color:"#e08040" },
                    ]}
                  />
                )}
                {isNum(tel?.pitch_deg) && (
                  <GaugeDial
                    label="Trim" value={tel.pitch_deg} unit="°"
                    min={-15} max={15} digits={1} color="#9ec8e0"
                    bands={[{ from:-3, to:3, color:"#2a9a4a" }]}
                  />
                )}
                {isNum(tel?.boat_speed_kn) && (
                  <GaugeDial
                    label="Boat speed" value={tel.boat_speed_kn} unit="kn"
                    min={0} max={12} digits={1} color="#9ec8e0"
                  />
                )}
                {(isNum(tel?.sog_kn) || isNum(ais?.sog)) && (
                  <GaugeDial
                    label="SOG" value={isNum(tel?.sog_kn) ? tel.sog_kn : ais.sog} unit="kn"
                    min={0} max={12} digits={1} color="#9ec8e0"
                  />
                )}
                {isNum(tel?.log_total_nm) && (
                  <div style={{
                    background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
                    border:"1px solid rgba(126,171,200,0.18)",
                    borderRadius:8, padding:"14px 16px",
                    display:"flex", flexDirection:"column", justifyContent:"center",
                  }}>
                    <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>Log (MFD)</div>
                    <div style={{fontFamily:"serif",fontSize:32,fontWeight:"bold",color:"#e8f4f8"}}>
                      {fmt(tel.log_total_nm, 1)} <span style={{fontSize:12,fontFamily:"monospace",color:"#7eabc8"}}>NM</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>)}

          {(isNum(tel?.water_depth_m) || hasBilgeWater || hasBilgePump) && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:8}}>Water &amp; Bilge</div>
              <div style={{
                display:"grid",
                gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",
                gap:12,
              }}>
                {isNum(tel?.water_depth_m) && (
                  <div style={{gridColumn:"1 / -1"}}>
                    <WaterDepthBar slug={slug} value={tel.water_depth_m} hours={24} />
                  </div>
                )}
                {hasBilgeWater && (
                  <GaugeDial
                    label="Bilge water" value={tel.bilge.water_cm} unit="cm"
                    min={0} max={20} digits={1}
                    color={tel.bilge.water_cm > 4 ? "#e08040" : "#6ab0e8"}
                    bands={[
                      { from:0, to:2,  color:"#2a9a4a" },
                      { from:4, to:20, color:"#e08040" },
                    ]}
                  />
                )}
                {hasBilgePump && (
                  <GaugeDial
                    label="Bilge pump 24h" value={tel.bilge.pump_cycles_24h} unit="cycles"
                    min={0} max={50} digits={0} color="#9ec8e0"
                    bands={[{ from:10, to:50, color:"#e08040" }]}
                  />
                )}
              </div>
            </div>
          )}

          {(isNum(posLat) && isNum(posLon)) && (
            <div style={{marginTop:12,display:"flex",flexWrap:"wrap",gap:12}}>
              <div style={{
                flex:"1 1 240px",background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
                border:"1px solid rgba(126,171,200,0.18)",borderRadius:8,padding:"12px 14px",
              }}>
                <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>Position</div>
                <div style={{fontFamily:"monospace",fontSize:13,color:"#e8f4f8"}}>
                  {posLat.toFixed(5)}° N, {posLon.toFixed(5)}° E
                </div>
                <a href={`https://www.openstreetmap.org/?mlat=${posLat}&mlon=${posLon}#map=17/${posLat}/${posLon}`}
                   target="_blank" rel="noreferrer"
                   style={{fontSize:10,color:"#6ab0e8",letterSpacing:1,textDecoration:"none",marginTop:6,display:"inline-block"}}>
                  Open in map ↗
                </a>
                {posSource && <div style={{fontSize:10,color:"#5a8aaa",marginTop:6}}>{posSource}</div>}
              </div>
            </div>
          )}
        </Section>
        </>)}

        {/* ---- Relay & Scenarios tab ---- */}
        {activeTab === "relay" && isOwnerView && (<>
        <Section title="⚡ Relay & Scenarios">
          {/* Manual relay toggles */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:8}}>Manual Control · Bank 1</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-start"}}>
              {[1,2,3,4].map((n) => {
                const key = `relay${n}`;
                const pendingState = relayPending[n];
                const isPending = typeof pendingState === "boolean";
                const known = relays[key] === true || relays[key] === false || isPending;
                const on = isPending ? pendingState : relays[key] === true;
                const label = boat?.relay_labels?.[String(n)];
                const stateText = isPending
                  ? <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                      <Spinner /> {pendingState ? "turning ON…" : "turning OFF…"}
                    </span>
                  : (known ? (on ? "● ON" : "○ OFF") : "◌ N/A");
                const mainText = label || `R${n}`;
                return (
                  <div key={n} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,minWidth:110}}>
                    <button disabled={relayBusy === n || isPending} onClick={() => setRelay(n, !on)}
                      style={{
                        padding:"10px 16px",cursor: isPending ? "wait" : "pointer",borderRadius:6,border:"1px solid rgba(126,171,200,0.3)",
                        background:on?"rgba(42,154,74,0.35)":(known?"rgba(255,255,255,0.06)":"rgba(120,120,120,0.12)"),
                        color:on?"#9eddb0":(known?"#9ec8e0":"#7f95a5"),fontSize:13,letterSpacing:1,
                        boxShadow: on ? "0 0 8px rgba(42,154,74,0.3)" : "none",
                        width:"100%",
                        display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                        opacity: isPending ? 0.85 : 1,
                      }}
                      title={label ? `R${n} · ${label}` : `R${n}`}>
                      <span style={{fontSize:13,fontWeight:600,letterSpacing:0.5}}>{mainText}</span>
                      <span style={{fontSize:11,letterSpacing:1,opacity:0.85}}>{stateText}</span>
                    </button>
                    {label && (
                      <div style={{fontSize:9,color:"#5a8aaa",letterSpacing:1,textTransform:"uppercase"}}
                           title={`channel R${n}`}>
                        R{n}
                      </div>
                    )}
                  </div>
                );
              })}
              {relayMsg && <span style={{fontSize:11,color:"#9eddb0",marginLeft:6,alignSelf:"center"}}>{relayMsg}</span>}
            </div>
          </div>

          {/* Scenarios list */}
          <div style={{marginTop:8}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase"}}>
                Automation Scenarios ({scenarios.length}/20)
              </div>
              <button
                onClick={() => setEditingScenario({ name:"", field:"cabin.humidity_pct", condition:"gt", threshold:80, hysteresis:5, relay:1, action:true, enabled:true })}
                style={{
                  padding:"6px 12px",cursor:"pointer",background:"#f0c040",color:"#091820",
                  border:"none",borderRadius:5,fontSize:11,letterSpacing:1,fontWeight:"bold",
                }}>
                + New Scenario
              </button>
            </div>

            {scenarios.length === 0 && !editingScenario && (
              <div style={{
                background:"linear-gradient(180deg, rgba(13,36,56,0.4), rgba(9,28,44,0.4))",
                border:"1px dashed rgba(126,171,200,0.2)",borderRadius:8,padding:"24px",
                textAlign:"center",color:"#5a8aaa",fontSize:12,
              }}>
                No automation scenarios yet. Click <strong style={{color:"#f0c040"}}>+ New Scenario</strong> to create one.
                <div style={{marginTop:8,fontSize:10,lineHeight:1.6}}>
                  Scenarios let you automatically turn relays ON or OFF based on any live telemetry value.
                  For example: turn on a dehumidifier when cabin humidity exceeds 80%.
                </div>
              </div>
            )}

            {scenarios.map((s, idx) => (
              <div key={s.id || idx} style={{
                background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
                border:`1px solid ${s.enabled ? "rgba(126,171,200,0.25)" : "rgba(126,171,200,0.1)"}`,
                borderRadius:8,padding:"12px 14px",marginBottom:8,
                display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",
                opacity:s.enabled ? 1 : 0.6,
              }}>
                <div style={{flex:"1 1 200px"}}>
                  <div style={{fontSize:12,fontWeight:"bold",color:"#e8f4f8"}}>{s.name}</div>
                  <div style={{fontSize:10,color:"#7eabc8",marginTop:3,fontFamily:"monospace"}}>
                    IF {s.field} {s.condition} {s.threshold} (±{s.hysteresis}) → R{s.relay}{boat?.relay_labels?.[String(s.relay)] ? ` (${boat.relay_labels[String(s.relay)]})` : ""} {s.action ? "ON" : "OFF"}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{
                    fontSize:9,letterSpacing:1,padding:"2px 7px",borderRadius:3,
                    background:s.enabled?"rgba(42,154,74,0.25)":"rgba(90,90,90,0.3)",
                    color:s.enabled?"#9eddb0":"#7eabc8",border:"1px solid currentColor",
                  }}>{s.enabled ? "ACTIVE" : "DISABLED"}</span>
                  <button onClick={() => setEditingScenario({ ...s, _editIdx: idx })}
                    style={{padding:"5px 10px",cursor:"pointer",background:"rgba(255,255,255,0.06)",
                      color:"#9ec8e0",border:"1px solid rgba(126,171,200,0.2)",borderRadius:5,fontSize:11}}>
                    Edit
                  </button>
                  <button onClick={() => { const upd = scenarios.filter((_,i)=>i!==idx); saveScenarios(upd); }}
                    style={{padding:"5px 10px",cursor:"pointer",background:"rgba(200,80,80,0.15)",
                      color:"#e08080",border:"1px solid rgba(200,80,80,0.3)",borderRadius:5,fontSize:11}}>
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {/* Scenario editor */}
            {editingScenario && (
              <ScenarioEditor
                value={editingScenario}
                onChange={setEditingScenario}
                relayLabels={boat?.relay_labels || {}}
                onSave={(s) => {
                  let upd;
                  if (s._editIdx !== undefined) {
                    upd = scenarios.map((x, i) => i === s._editIdx ? { ...s, _editIdx: undefined } : x);
                  } else {
                    upd = [...scenarios, s];
                  }
                  saveScenarios(upd);
                }}
                onCancel={() => setEditingScenario(null)}
                busy={scenariosBusy}
              />
            )}

            {scenariosMsg && (
              <div style={{marginTop:8,fontSize:11,color: scenariosMsg.includes("failed") || scenariosMsg.includes("error") ? "#e08080" : "#9eddb0"}}>
                {scenariosMsg}
              </div>
            )}
          </div>
        </Section>
        </>)}

        <div style={{padding:"24px 20px 40px",textAlign:"center",fontSize:9,color:"#3a5a6a",letterSpacing:2}}>
          ⚓ HARA · SADAM
        </div>
      </div>

      {isOwnerView && (
        <>
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            slug={slug}
            initialBoat={boat}
            ownerPin={ownerPin}
            setOwnerPin={setOwnerPin}
            ownerPinBusy={ownerPinBusy}
            ownerPinMsg={ownerPinMsg}
            saveOwnerPin={saveOwnerPin}
            accessInfo={accessInfo}
            onSettingsSaved={(s) => {
              // Hot-apply visual settings to the page without reload.
              setBoat((prev) => ({
                ...prev,
                name:  s.displayName || prev.name,
                owner: s.ownerName ?? prev.owner,
                color: s.color || prev.color,
                notes: s.notes ?? prev.notes,
                no_battery: typeof s.no_battery === "boolean" ? s.no_battery : prev.no_battery,
                relay_labels: s.relay_labels && typeof s.relay_labels === "object" ? s.relay_labels : (prev.relay_labels || {}),
              }));
            }}
          />
          <ShareModal
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            slug={slug}
            boatName={boat.name}
            shareTtlMin={shareTtlMin}
            setShareTtlMin={setShareTtlMin}
            shareBusy={shareBusy}
            shareMsg={shareMsg}
            shareData={shareData}
            accessInfo={accessInfo}
            createShare={createShare}
          />
        </>
      )}
    </>
  );
}

function ScenarioEditor({ value, onChange, onSave, onCancel, busy, relayLabels = {} }) {
  const FIELDS = [
    { value:"cabin.humidity_pct", label:"Cabin humidity (%)" },
    { value:"cabin.temperature_c", label:"Cabin temperature (°C)" },
    { value:"dewpoint_c", label:"Dew point (°C)" },
    { value:"battery.voltage", label:"Battery voltage (V)" },
    { value:"battery.percent", label:"Battery charge (%)" },
    { value:"water_depth_m", label:"Water depth (m)" },
    { value:"water_temp_c", label:"Water temperature (°C)" },
    { value:"bilge.water_cm", label:"Bilge water (cm)" },
    { value:"ac.power_w", label:"AC power (W)" },
    { value:"ac.voltage_v", label:"AC voltage (V)" },
  ];
  const sel = {
    padding:"5px 8px",background:"rgba(255,255,255,0.06)",color:"#e8f4f8",
    border:"1px solid rgba(126,171,200,0.3)",borderRadius:5,fontFamily:"inherit",fontSize:12,
  };
  const inp = { ...sel, width:80 };
  const row = { display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:10 };

  function set(k, v) { onChange({ ...value, [k]: v }); }

  return (
    <div style={{
      background:"linear-gradient(180deg, rgba(13,36,56,0.8), rgba(9,28,44,0.8))",
      border:"1px solid rgba(240,192,64,0.3)",borderRadius:8,padding:"16px 18px",marginTop:10,
    }}>
      <div style={{fontSize:9,letterSpacing:2,color:"#f0c040",textTransform:"uppercase",marginBottom:12}}>
        {value._editIdx !== undefined ? "Edit Scenario" : "New Scenario"}
      </div>

      <div style={row}>
        <label style={{fontSize:11,color:"#7eabc8",minWidth:60}}>Name</label>
        <input value={value.name} onChange={(e)=>set("name",e.target.value)}
          placeholder="e.g. Dehumidifier control"
          style={{...inp, width:220}}
        />
      </div>

      <div style={row}>
        <label style={{fontSize:11,color:"#7eabc8",minWidth:60}}>Monitor</label>
        <select value={value.field} onChange={(e)=>set("field",e.target.value)} style={sel}>
          {FIELDS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      <div style={row}>
        <label style={{fontSize:11,color:"#7eabc8",minWidth:60}}>Condition</label>
        <select value={value.condition} onChange={(e)=>set("condition",e.target.value)} style={{...sel,width:120}}>
          <option value="gt">&gt; greater than</option>
          <option value="gte">≥ at least</option>
          <option value="lt">&lt; less than</option>
          <option value="lte">≤ at most</option>
        </select>
        <input type="number" value={value.threshold} onChange={(e)=>set("threshold",Number(e.target.value))} style={inp} />
        <label style={{fontSize:11,color:"#7eabc8"}}>± hysteresis</label>
        <input type="number" value={value.hysteresis} min="0" onChange={(e)=>set("hysteresis",Number(e.target.value))} style={{...inp,width:64}} />
      </div>

      <div style={row}>
        <label style={{fontSize:11,color:"#7eabc8",minWidth:60}}>Then</label>
        <label style={{fontSize:11,color:"#9ec8e0"}}>Relay</label>
        <select value={value.relay} onChange={(e)=>set("relay",Number(e.target.value))} style={{...sel,width:160}}>
          {[1,2,3,4].map((n) => (
            <option key={n} value={n}>
              R{n}{relayLabels[String(n)] ? ` · ${relayLabels[String(n)]}` : ""}
            </option>
          ))}
        </select>
        <select value={String(value.action)} onChange={(e)=>set("action",e.target.value==="true")} style={{...sel,width:80}}>
          <option value="true">turn ON</option>
          <option value="false">turn OFF</option>
        </select>
      </div>

      <div style={row}>
        <label style={{fontSize:11,color:"#7eabc8",minWidth:60}}>Status</label>
        <label style={{fontSize:11,color:"#9ec8e0",display:"flex",alignItems:"center",gap:6}}>
          <input type="checkbox" checked={value.enabled} onChange={(e)=>set("enabled",e.target.checked)} />
          Enabled
        </label>
      </div>

      <div style={{fontSize:10,color:"#5a8aaa",marginBottom:12,lineHeight:1.5,fontStyle:"italic"}}>
        Preview: IF {value.field} {value.condition} {value.threshold} (hysteresis ±{value.hysteresis}) → Relay {value.relay} {value.action ? "ON" : "OFF"}
      </div>

      <div style={{display:"flex",gap:8}}>
        <button disabled={busy || !value.name.trim()} onClick={()=>onSave(value)}
          style={{padding:"8px 14px",cursor:"pointer",
            background:busy?"rgba(126,171,200,0.15)":"#f0c040",
            color:busy?"#7eabc8":"#091820",border:"none",borderRadius:5,fontSize:12,fontWeight:"bold"}}>
          {busy ? "Saving…" : "Save Scenario"}
        </button>
        <button onClick={onCancel}
          style={{padding:"8px 14px",cursor:"pointer",background:"transparent",
            color:"#7eabc8",border:"1px solid rgba(126,171,200,0.3)",borderRadius:5,fontSize:12}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Spinner({ size = 12, color = "#9ec8e0" }) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: size, height: size,
      border: `2px solid ${color}55`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "harasp 0.8s linear infinite",
    }}>
      <style>{`@keyframes harasp { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function IconBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      style={{
        background:"rgba(126,171,200,0.08)", border:"1px solid rgba(126,171,200,0.2)",
        color:"#9ec8e0", borderRadius:8, padding:"6px 8px", cursor:"pointer",
        display:"inline-flex", alignItems:"center", justifyContent:"center",
      }}>
      {children}
    </button>
  );
}

function Section({ title, children, badge }) {
  return (
    <div style={{maxWidth:980,margin:"0 auto",padding:"10px 20px 0"}}>
      <div style={{fontSize:10,letterSpacing:3,color:"#7eabc8",textTransform:"uppercase",
        margin:"18px 0 10px",borderBottom:"1px solid rgba(126,171,200,0.12)",paddingBottom:6,
        display:"flex",alignItems:"center",gap:10}}>
        <span>{title}</span>
        {badge && (
          <span style={{fontSize:8,letterSpacing:2,color:"#e08040",
            border:"1px solid #e0804055",borderRadius:3,padding:"1px 5px"}}
            title="Source data is simulated, not from sensors."
          >{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function TelemetryGroup({ title, children, style }) {
  return (
    <div style={style}>
      <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:8}}>{title}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:12}}>{children}</div>
    </div>
  );
}

function BoatWindSection({ tel, ais, weather }) {
  const wind = tel?.wind || {};
  const trueDir = isNum(wind?.true?.direction_deg) ? wind.true.direction_deg : null;
  const trueKn  = isNum(wind?.true?.speed_kn) ? wind.true.speed_kn : null;
  const twaAng  = isNum(wind?.true?.angle_deg) ? wind.true.angle_deg : null;
  const appAng  = isNum(wind?.apparent?.angle_deg) ? wind.apparent.angle_deg : null;
  const appKn   = isNum(wind?.apparent?.speed_kn) ? wind.apparent.speed_kn : null;
  const heading = isNum(tel?.heading_deg) ? tel.heading_deg
                  : (isNum(ais?.heading) ? ais.heading : null);
  const cog     = isNum(tel?.cog_deg) ? tel.cog_deg
                  : (isNum(ais?.cog) ? ais.cog : null);
  const sog     = isNum(tel?.sog_kn) ? tel.sog_kn
                  : (isNum(ais?.sog) ? ais.sog : (isNum(tel?.boat_speed_kn) ? tel.boat_speed_kn : null));

  const moving = isNum(sog) && sog >= 0.8;
  const mode = moving && twaAng !== null ? "TWA" : "AWA";
  const modeAng = mode === "TWA" ? twaAng : appAng;
  const modeKn = mode === "TWA" ? (trueKn ?? appKn) : appKn;

  const hasBoatWind = modeAng !== null || trueDir !== null;
  const usingFallback = !hasBoatWind;
  // Fall back to Loksa weather station if boat sensor isn't reporting.
  const fallbackTrueDir = isNum(weather?.winddirection) ? weather.winddirection : null;
  const fallbackTrueKn  = isNum(weather?.windspeed) ? weather.windspeed / 0.514444 : null;

  const showTrueDir = trueDir ?? (usingFallback ? fallbackTrueDir : null);
  const showTrueKn  = trueKn  ?? (usingFallback ? fallbackTrueKn  : null);

  const sourceLabel = hasBoatWind
    ? "Boat sensor (NMEA2000 push)"
    : (fallbackTrueDir !== null ? "Loksa weather station" : "No data");

  return (
    <Section
      title="🌬 Wind"
      badge={usingFallback && fallbackTrueDir !== null ? "WEATHER STATION" : null}
    >
      <div style={{display:"flex",flexWrap:"wrap",gap:18,alignItems:"flex-start"}}>
        <div style={{
          background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
          border:"1px solid rgba(126,171,200,0.18)",borderRadius:8,padding:"14px",
        }}>
          <BoatWindRose
            trueDirDeg={usingFallback ? showTrueDir : null}
            trueSpeedKn={usingFallback ? showTrueKn : null}
            apparentAngle={modeAng}
            apparentSpeedKn={modeKn}
            headingDeg={null}
            cogDeg={null}
            centerModeLabel={`M/S ${mode}`}
            relativeModeLabel={mode}
            size={240}
          />
          <div style={{fontSize:9,letterSpacing:1,color:"#5a8aaa",marginTop:8,textAlign:"center"}}>
            {sourceLabel}
          </div>
        </div>
        {(isNum(heading) || isNum(cog) || hasBoatWind) && (
          <div style={{
            background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
            border:"1px solid rgba(126,171,200,0.18)",borderRadius:8,padding:"14px",
            display:"flex", flexDirection:"column", alignItems:"center", gap:6,
          }}>
            <HeadingClock headingDeg={heading} cogDeg={cog} size={220} />
            <div style={{fontSize:9,letterSpacing:1,color:"#5a8aaa",marginTop:4,textAlign:"center"}}>
              Boat heading {isNum(cog) ? "· COG (dashed)" : ""}
            </div>
          </div>
        )}
        <div style={{flex:"1 1 240px",display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:12,alignContent:"flex-start"}}>
          {isNum(modeKn) && (
            <GaugeDial
              label={`${mode} speed`} value={knToMs(modeKn)} unit="m/s"
              min={0} max={25} digits={1} color="#6ad4e8"
              bands={[
                { from:0,  to:3,  color:"#2a9a4a" },
                { from:12, to:18, color:"#f0c040" },
                { from:18, to:25, color:"#e08040" },
              ]}
            />
          )}
          {isNum(showTrueKn) && (
            <GaugeDial
              label="True wind speed" value={knToMs(showTrueKn)} unit="m/s"
              min={0} max={25} digits={1} color="#f0c040"
              bands={[
                { from:0,  to:3,  color:"#2a9a4a" },
                { from:12, to:18, color:"#f0c040" },
                { from:18, to:25, color:"#e08040" },
              ]}
            />
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <Stat label={mode}
              value={isNum(modeAng) ? `${modeAng > 0 ? "▶" : "◀"} ${Math.round(Math.abs(modeAng))}°` : null}
              unit="" color="#6ad4e8"/>
            <Stat label="True wind dir"
              value={isNum(showTrueDir) ? `${Math.round(showTrueDir)}°` : null}
              unit="" color="#f0c040"/>
          </div>
        </div>
      </div>
      <div style={{fontSize:10,color:"#5a8aaa",marginTop:10,lineHeight:1.5}}>
        Wind rose is shown relative to boat bow (bow up). At low speed we show AWA;
        when moving we switch to TWA if available.
      </div>
    </Section>
  );
}

const AIS_STATE_STYLE = {
  moored:           { color: "#2a9a4a", icon: "⚓", text: "Moored at Hara Sadam" },
  anchored_nearby:  { color: "#6ab0e8", icon: "⚓", text: "Anchored near Hara" },
  underway:         { color: "#f0c040", icon: "▶",  text: "Underway" },
  away:             { color: "#a08040", icon: "◌",  text: "Away from marina" },
  no_signal:        { color: "#5a8aaa", icon: "◌",  text: "No AIS signal" },
  unknown:          { color: "#5a8aaa", icon: "?",  text: "Unknown" },
};

function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1852).toFixed(1)} NM`;
}
function fmtAge(ms) {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

function AisStatus({ ais }) {
  if (!ais) {
    return <div style={{fontSize:11,color:"#5a8aaa"}}>◌ querying AIS…</div>;
  }
  if (ais.configured === false) {
    return (
      <div style={{fontSize:11,color:"#5a8aaa",lineHeight:1.6}}>
        AIS lookup not configured for this boat
        {ais.reason ? <span style={{color:"#3a5a6a"}}> · {ais.reason}</span> : null}
        <div style={{marginTop:4,fontSize:10,color:"#3a5a6a"}}>
          Add an <code>mmsi</code> field to the boat record (and set <code>AISSTREAM_API_KEY</code>) to enable.
        </div>
      </div>
    );
  }
  const sty = AIS_STATE_STYLE[ais.state] || AIS_STATE_STYLE.unknown;
  const mtUrl = ais.marineTrafficUrl
    || (ais.shipId ? `https://www.marinetraffic.com/en/ais/details/ships/shipid:${ais.shipId}` : null)
    || (ais.mmsi ? `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${ais.mmsi}` : null);
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
      <div style={{
        flex:"1 1 260px",background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
        border:`1px solid ${sty.color}55`,borderRadius:8,padding:"14px 16px",
      }}>
        <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>State</div>
        <div style={{fontSize:22,fontWeight:"bold",color:sty.color,fontFamily:"Georgia, serif"}}>
          {sty.icon} {sty.text}
        </div>
        <div style={{fontSize:11,color:"#9ec8e0",marginTop:6}}>
          {ais.distanceM != null && <>Distance to Hara: <strong>{fmtDist(ais.distanceM)}</strong></>}
          {ais.lastSeenMs != null && <> · last fix {fmtAge(ais.lastSeenMs)}</>}
        </div>
        {ais.state === "no_signal" && (
          <div style={{fontSize:10,color:"#5a8aaa",marginTop:8,lineHeight:1.5}}>
            AISStream relies on volunteer terrestrial receivers and has limited
            coverage at Hara. The boat may still be broadcasting — see authoritative
            position on MarineTraffic below.
          </div>
        )}
        {mtUrl && (
          <a href={mtUrl} target="_blank" rel="noreferrer"
             style={{fontSize:10,color:"#6ab0e8",letterSpacing:1,textDecoration:"none",marginTop:8,display:"inline-block"}}>
            View on MarineTraffic ↗
          </a>
        )}
      </div>

      <div style={{
        flex:"1 1 200px",background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
        border:"1px solid rgba(126,171,200,0.18)",borderRadius:8,padding:"12px 14px",
      }}>
        <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>Speed / Course</div>
        <div style={{fontFamily:"monospace",fontSize:13,color:"#e8f4f8",lineHeight:1.7}}>
          SOG {Number.isFinite(ais.sog) ? ais.sog.toFixed(1) : "—"} kn<br/>
          COG {Number.isFinite(ais.cog) ? Math.round(ais.cog) + "°" : "—"}
          {Number.isFinite(ais.heading) && ais.heading !== 511 && <> · HDG {Math.round(ais.heading)}°</>}
        </div>
      </div>

      {Number.isFinite(ais.lat) && Number.isFinite(ais.lon) && (
        <div style={{
          flex:"1 1 240px",background:"linear-gradient(180deg, rgba(13,36,56,0.6), rgba(9,28,44,0.6))",
          border:"1px solid rgba(126,171,200,0.18)",borderRadius:8,padding:"12px 14px",
        }}>
          <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>AIS Position</div>
          <div style={{fontFamily:"monospace",fontSize:13,color:"#e8f4f8"}}>
            {ais.lat.toFixed(5)}° N, {ais.lon.toFixed(5)}° E
          </div>
          <a href={`https://www.openstreetmap.org/?mlat=${ais.lat}&mlon=${ais.lon}#map=14/${ais.lat}/${ais.lon}`}
             target="_blank" rel="noreferrer"
             style={{fontSize:10,color:"#6ab0e8",letterSpacing:1,textDecoration:"none",marginTop:6,display:"inline-block"}}>
            Open in map ↗
          </a>
          <div style={{fontSize:10,color:"#3a5a6a",marginTop:6}}>
            MMSI {ais.mmsi}{ais.name ? ` · ${ais.name}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

