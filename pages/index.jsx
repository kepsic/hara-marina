import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import dynamic from "next/dynamic";
import WindCanvas from "../components/WindCanvas";
import BoatWindRose from "../components/BoatWindRose";

const MarinaMapView = dynamic(() => import("../components/MarinaMapView"), { ssr: false });

const DOCK_SECTIONS = [
  { id: "A", boats: [1, 2, 3] },
  { id: "B", boats: [4, 5, 6, 7] },
  { id: "C", boats: [8, 9, 10, 11, 12] },
];

const INITIAL_BOATS = [
  { id:1,  name:"DEVOCEAN",  section:"A", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#1e6fa8" },
  { id:2,  name:"LINDRE",    section:"A", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#1a7a4a" },
  { id:3,  name:"HELMSMAN",  section:"A", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#8b3a3a" },
  { id:4,  name:"TAEVASINA", section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#5a3e8a" },
  { id:5,  name:"O₂",        section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#2a7a8a" },
  { id:6,  name:"ALBERTINA", section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#8a6a10" },
  { id:7,  name:"VAIANA",    section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#1a5a3a" },
  { id:8,  name:"AMANTE",    section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#8a2a5a" },
  { id:9,  name:"JULIA",     section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#2a4a8a" },
  { id:10, name:"CIBELLE",   section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#4a7a1a" },
  { id:11, name:"CIRRUS",    section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#7a3a1a" },
  { id:12, name:"MOI",       section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#2a6a6a" },
];

const EQUIP = ["VHF Radio","GPS","Autopilot","Radar","AIS","Depth Sounder","Chart Plotter","Life Raft","EPIRB","Windlass","Bimini","Sprayhood","Generator","Solar Panels"];
const CRANE_START = 10 * 60;
const SLOT_MIN = 45;

function fmtTime(baseMin, offset) {
  const t = baseMin + offset;
  return `${String(Math.floor(t/60)%24).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;
}
function slotTime(i) {
  return { start: fmtTime(CRANE_START, i*SLOT_MIN), end: fmtTime(CRANE_START, (i+1)*SLOT_MIN) };
}

// ── Storage helpers ────────────────────────────────────────────────────────────
async function storageGet(key) {
  try {
    const r = await fetch(`/api/data?key=${key}`);
    const j = await r.json();
    return j.value ? JSON.parse(j.value) : null;
  } catch { return null; }
}
async function storageSet(key, value) {
  try {
    await fetch(`/api/data?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(value) }),
    });
  } catch {}
}

// ── SVG helpers ────────────────────────────────────────────────────────────────
function BoatShape({ color, isSelected, isSwapSrc, isOver, small }) {
  const w = small ? 52 : 80, h = small ? 21 : 32;
  const stroke = isSwapSrc ? "#00e5ff" : (isOver||isSelected) ? "#f0c040" : "rgba(255,255,255,0.3)";
  const sw = stroke === "rgba(255,255,255,0.3)" ? 1 : 2.5;
  return (
    <svg width={w} height={h} viewBox="0 0 80 32" fill="none">
      {/* Map convention: bow points South (left on screen), stern North (right). */}
      <g transform="translate(80,0) scale(-1,1)">
        <path d="M6 16 C6 16 18 4 50 4 L74 10 L76 16 L74 22 L50 28 C18 28 6 16 6 16Z"
          fill={color} stroke={stroke} strokeWidth={sw}
          style={{ filter: isSwapSrc?"drop-shadow(0 0 7px #00e5ff99)":isOver?"drop-shadow(0 0 7px #f0c04088)":"drop-shadow(0 1px 3px rgba(0,0,0,0.5))" }}/>
        <path d="M12 16 L70 16" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,3"/>
        <line x1="38" y1="7" x2="38" y2="25" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5"/>
        <ellipse cx="58" cy="16" rx="9" ry="5.5" fill="rgba(0,0,0,0.28)"/>
      </g>
    </svg>
  );
}

function WaterLines() {
  return (
    <svg style={{ position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",opacity:0.09 }}>
      {[...Array(22)].map((_,i) => (
        <path key={i} d={`M0 ${18+i*28} Q100 ${8+i*28} 200 ${18+i*28} Q300 ${28+i*28} 400 ${18+i*28} Q500 ${8+i*28} 600 ${18+i*28}`}
          fill="none" stroke="#7ec8e3" strokeWidth="1.2"/>
      ))}
    </svg>
  );
}

// ── Field (hoisted so its component identity is stable; otherwise inputs lose focus on every keystroke) ─
function Field({label, fieldKey, placeholder, editMode, draft, setDraft}) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:3}}>{label}</div>
      {editMode
        ? <input value={draft[fieldKey]||""} onChange={e=>setDraft(d=>({...d,[fieldKey]:e.target.value}))} placeholder={placeholder}
            style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(126,171,200,0.25)",
              color:"#e8f4f8",padding:"5px 8px",borderRadius:4,fontSize:12,boxSizing:"border-box",outline:"none",fontFamily:"inherit"}}/>
        : <div style={{fontSize:13,color:draft?.[fieldKey]?"#e8f4f8":"#3a5a6a",minHeight:20}}>
            {draft?.[fieldKey]||<em style={{opacity:0.35}}>—</em>}
          </div>
      }
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function HaraMarina() {
  const [boats,      setBoats]      = useState(INITIAL_BOATS);
  const [queue,      setQueue]      = useState([]);
  const [view,       setView]       = useState("marina");
  const [selectedId, setSelectedId] = useState(null);
  const [editMode,   setEditMode]   = useState(false);
  const [draft,      setDraft]      = useState(null);
  const [swapSrcId,  setSwapSrcId]  = useState(null);
  const [dragId,     setDragId]     = useState(null);
  const [dragOver,   setDragOver]   = useState(null);
  const [synced,     setSynced]     = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [addType,    setAddType]    = useState("in");
  const [qDragIdx,   setQDragIdx]   = useState(null);
  const [qDragOver,  setQDragOver]  = useState(null);
  const [weather,    setWeather]    = useState(null);
  const [marinaConditions, setMarinaConditions] = useState(null); // live wind/sea-temp from marina boats
  const [boatBadges, setBoatBadges] = useState({}); // { [slug]: { online, battery_pct, shore_power, bilge_cm } }
  const [weatherShown, setWeatherShown] = useState(true);
  const [weatherPos, setWeatherPos]   = useState({ x: null, y: null }); // null = use default top/right
  const weatherDragRef = useRef(null);
  const [panelTab, setPanelTab] = useState("details"); // 'details' | 'telemetry'
  const [telemetry, setTelemetry] = useState(null);
  const [authed, setAuthed] = useState(null); // null=unknown, false=anon, true=signed-in
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [marinaLayout, setMarinaLayout] = useState(null);

  // Probe auth state once on mount so we can gate interactive actions.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding/me", { credentials: "same-origin" })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setAuthed(false);
          setIsSuperAdmin(false);
          return;
        }
        const j = await r.json().catch(() => ({}));
        setAuthed(true);
        setIsSuperAdmin(!!j.is_super_admin);
      })
      .catch(() => { if (!cancelled) setAuthed(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadLayout() {
      try {
        const r = await fetch("/api/marina-layout");
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setMarinaLayout(j.layout || null);
      } catch {}
    }
    loadLayout();
    return () => { cancelled = true; };
  }, []);

  async function saveMarinaLayout(nextLayout) {
    try {
      const r = await fetch("/api/marina-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ layout: nextLayout }),
      });
      if (!r.ok) return false;
      const j = await r.json();
      setMarinaLayout(j.layout || nextLayout);
      return true;
    } catch {
      return false;
    }
  }

  // ── Load from KV on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const b = await storageGet("hara-boats");
      if (b) setBoats(b);
      const q = await storageGet("hara-queue");
      if (q) setQueue(q);
      setSynced(true);
    })();
  }, []);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(async () => {
      const b = await storageGet("hara-boats");
      if (b) setBoats(b);
      const q = await storageGet("hara-queue");
      if (q) setQueue(q);
    }, 30000);
    return () => clearInterval(t);
  }, []);

  // Live weather from Loksa station (~10 km east of Hara, same bay)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/weather");
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && !j.error) setWeather(j);
      } catch {}
    }
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Marina conditions: wind & sea temp aggregated from moored boats (fresher, more local).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/marina-conditions");
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setMarinaConditions(j);
      } catch {}
    }
    load();
    const t = setInterval(load, 60 * 1000); // every minute
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Per-boat telemetry badges (public — no auth needed).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/boat-badges");
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j.badges) setBoatBadges(j.badges);
      } catch {}
    }
    load();
    const t = setInterval(load, 60 * 1000); // every minute
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const boatSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function updateBoats(fn) {
    setBoats(prev => { const n = fn(prev); storageSet("hara-boats", n); return n; });
  }
  function updateQueue(fn) {
    setQueue(prev => { const n = fn(prev); storageSet("hara-queue", n); return n; });
  }

  const getBoat = id => boats.find(b => b.id === id) || null;
  const selectedBoat = getBoat(selectedId);

  // Telemetry fetch when telemetry tab is open
  useEffect(() => {
    if (!selectedId || panelTab !== "telemetry" || !selectedBoat) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/telemetry/${boatSlug(selectedBoat.name)}`);
        if (r.status === 401) {
          if (!cancelled) setTelemetry({ authRequired: true });
          return;
        }
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && !j.error) setTelemetry(j);
      } catch {}
    }
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, panelTab, selectedBoat?.name]);

  // ── Panel ──────────────────────────────────────────────────────────────────────
  function openPanel(id) {
    const b = getBoat(id); if (!b) return;
    setSelectedId(id); setDraft({...b, equipment:[...b.equipment]}); setEditMode(false);
    setPanelTab("details");
    setTelemetry(null);
  }
  function closePanel() { setSelectedId(null); setEditMode(false); setDraft(null); }
  function saveEdit() {
    if (!draft) return;
    updateBoats(prev => prev.map(b => b.id===selectedId ? {...draft} : b));
    setEditMode(false);
  }
  function cancelEdit() {
    if (!selectedBoat) return;
    setDraft({...selectedBoat, equipment:[...selectedBoat.equipment]}); setEditMode(false);
  }
  function toggleEquip(item) {
    setDraft(d => ({...d, equipment: d.equipment.includes(item) ? d.equipment.filter(e=>e!==item) : [...d.equipment, item]}));
  }

  // ── Swap ───────────────────────────────────────────────────────────────────────
  function swapBoats(idA, idB) {
    if (!idA||!idB||idA===idB) return;
    updateBoats(prev => {
      const next=[...prev];
      const si=next.findIndex(b=>b.id===idA), ti=next.findIndex(b=>b.id===idB);
      const tmp=next[si].section;
      next[si]={...next[si],section:next[ti].section};
      next[ti]={...next[ti],section:tmp};
      [next[si],next[ti]]=[next[ti],next[si]];
      return next;
    });
  }
  function handleBoatTap(id) {
    if (authed === false) { window.location.href = "/login?next=/"; return; }
    if (swapSrcId!==null) { swapBoats(swapSrcId,id); setSwapSrcId(null); }
    else openPanel(id);
  }
  function onDragStart(e,id) {
    if (authed === false) { e.preventDefault(); window.location.href = "/login?next=/"; return; }
    setDragId(id); e.dataTransfer.effectAllowed="move";
  }
  function onDragOver(e,id)  { e.preventDefault(); if(id!==dragId) setDragOver(id); }
  function onDrop(e,tid)     { e.preventDefault(); swapBoats(dragId,tid); setDragId(null); setDragOver(null); }
  function onDragEnd()       { setDragId(null); setDragOver(null); }

  // ── Queue ──────────────────────────────────────────────────────────────────────
  function addToQueue(boatId, type) {
    updateQueue(prev => [...prev, {id:Date.now(), boatId, type, status:"waiting", note:""}]);
    setShowPicker(false);
  }
  function removeFromQueue(qid) { updateQueue(prev => prev.filter(e=>e.id!==qid)); }
  function setStatus(qid, status) { updateQueue(prev => prev.map(e=>e.id===qid?{...e,status}:e)); }
  function setNote(qid, note)     { updateQueue(prev => prev.map(e=>e.id===qid?{...e,note}:e)); }
  function moveQueue(idx,dir) {
    updateQueue(prev => {
      const next=[...prev], ni=idx+dir;
      if(ni<0||ni>=next.length) return prev;
      [next[idx],next[ni]]=[next[ni],next[idx]];
      return next;
    });
  }
  function onQDragStart(e,idx) { setQDragIdx(idx); e.dataTransfer.effectAllowed="move"; }
  function onQDragOver(e,idx)  { e.preventDefault(); if(idx!==qDragIdx) setQDragOver(idx); }
  function onQDrop(e,idx) {
    e.preventDefault();
    if(qDragIdx===null||qDragIdx===idx){setQDragIdx(null);setQDragOver(null);return;}
    updateQueue(prev=>{const next=[...prev];const[item]=next.splice(qDragIdx,1);next.splice(idx,0,item);return next;});
    setQDragIdx(null); setQDragOver(null);
  }
  function onQDragEnd() { setQDragIdx(null); setQDragOver(null); }

  const queuedBoatIds = new Set(queue.map(e=>e.boatId));
  const availableBoats = boats.filter(b=>!queuedBoatIds.has(b.id));
  const statusColor = {waiting:"#7eabc8",active:"#f0c040",done:"#2a9a4a"};
  const statusLabel = {waiting:"Waiting",active:"🏗 Active",done:"✓ Done"};
  const statusNext  = {waiting:"active",active:"done",done:"waiting"};

  const weatherBoxStyle = {
    position:"absolute",
    ...(weatherPos.x !== null
      ? { left: weatherPos.x, top: weatherPos.y }
      : { top: 20, right: 90 }),
    width:230,
    background:"linear-gradient(180deg, rgba(13,36,56,0.55), rgba(9,28,44,0.55))",
    border:"1px solid rgba(126,171,200,0.18)",
    borderRadius:8,
    boxShadow:"0 4px 18px rgba(0,0,0,0.4), inset 0 0 30px rgba(30,80,120,0.1)",
    backdropFilter:"blur(8px)",
    WebkitBackdropFilter:"blur(8px)",
    zIndex:5,
    fontFamily:"'Georgia','Times New Roman',serif",
  };

  // ── Boat row ───────────────────────────────────────────────────────────────────
  function BoatRow({boatId}) {
    const boat=getBoat(boatId); if(!boat) return null;
    const isSel=selectedId===boatId, isSrc=swapSrcId===boatId;
    const isTgt=swapSrcId!==null&&swapSrcId!==boatId;
    const isDrag=dragId===boatId, isOver=dragOver===boatId;
    const inQ=queuedBoatIds.has(boatId);
    // Wind-driven rocking. Boats lie horizontal on screen (long axis E-W),
    // so a wind from N or S hits the beam and produces max roll; a wind
    // from E or W is along the keel and rocks nothing. Beam component on
    // screen = sin(downwind bearing) using the same N=left mapping as the
    // rose. Per-boat duration jitter avoids unison.
    // Prefer marina-boat wind (more local) for rocking animation.
    const wd = marinaConditions?.wind?.direction_deg ?? weather?.winddirection;
    const ws = marinaConditions?.wind?.speed_ms      ?? weather?.windspeed;
    let rollDeg = 0, rockDur = 2.6;
    if (typeof wd === "number" && typeof ws === "number" && ws > 0) {
      const toDeg = (wd + 180) % 360;
      const beam = Math.sin(toDeg * Math.PI / 180); // -1..1
      rollDeg = Math.max(-5, Math.min(5, ws * 0.55 * beam));
      rockDur = 2.2 + ((boatId * 37) % 110) / 100; // deterministic 2.2-3.3s
    }
    // ── Telemetry overlays (drawn on the boat shape) ──────────────────────────
    const slug = boatSlug(boat.name);
    const bdata = boatBadges[slug] || null;
    return (
      <div draggable
        onDragStart={e=>onDragStart(e,boatId)} onDragOver={e=>onDragOver(e,boatId)}
        onDrop={e=>onDrop(e,boatId)} onDragEnd={onDragEnd}
        onClick={()=>handleBoatTap(boatId)}
        style={{display:"flex",alignItems:"center",padding:"6px 4px",borderRadius:4,
          cursor:swapSrcId?(isSrc?"not-allowed":"copy"):"pointer",
          opacity:isDrag?0.3:1,
          background:isOver?"rgba(240,192,64,0.1)":isSrc?"rgba(0,229,255,0.07)":isSel?"rgba(240,192,64,0.04)":"transparent",
          outline:isOver?"2px dashed rgba(240,192,64,0.6)":isSrc?"1px solid rgba(0,229,255,0.4)":"none",
          outlineOffset:2,transition:"background 0.15s,opacity 0.15s",userSelect:"none",
          animation:isSrc?"pulse 1.2s infinite":"none"}}>
        <div style={{fontSize:14,color:"rgba(200,160,80,0.3)",marginRight:8,flexShrink:0,cursor:"grab"}}>⠿</div>
        <div style={{fontSize:11,fontWeight:"bold",letterSpacing:1.2,
          color:isSrc?"#00e5ff":isSel?"#f0c040":"#c8e0f0",textTransform:"uppercase",flexShrink:0,minWidth:90}}>
          {boat.name}
          {inQ&&<span style={{marginLeft:6,fontSize:8,color:"#f0a020"}}>🏗</span>}
          {isSrc&&<div style={{fontSize:8,color:"#00e5ff",fontWeight:"normal",marginTop:1}}>tap destination →</div>}
        </div>
        {/* Mooring buoy out in the water */}
        <div style={{flexShrink:0,marginLeft:10,display:"flex",alignItems:"center",justifyContent:"center"}}
          title="Mooring buoy">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="5"
              fill="radial-gradient(#f0c040,#8a6a10)"
              style={{fill:"#c8a050"}}
              stroke="#5a4010" strokeWidth="1"/>
            <circle cx="5.5" cy="5.5" r="1.5" fill="rgba(255,240,200,0.7)"/>
          </svg>
        </div>
        {/* Mooring ropes — stretch from buoy to boat (near dock) */}
        <div style={{flex:1,minWidth:24,height:24,opacity:0.55}}>
          <svg width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none" style={{display:"block"}}>
            <line x1="0" y1="12" x2="100" y2="6"  stroke="#c8a050" strokeWidth="1" strokeDasharray="4,3" vectorEffect="non-scaling-stroke"/>
            <line x1="0" y1="12" x2="100" y2="18" stroke="#c8a050" strokeWidth="1" strokeDasharray="4,3" vectorEffect="non-scaling-stroke"/>
          </svg>
        </div>
        {/* Boat shape + telemetry overlays */}
        <div className="boat-rock" style={{"--roll":`${rollDeg.toFixed(2)}deg`,"--rockDur":`${rockDur.toFixed(2)}s`,position:"relative"}}>
          <BoatShape color={boat.color} isSelected={isSel} isSwapSrc={isSrc} isOver={isOver||isTgt}/>

          {bdata && (() => {
            const battPct   = bdata.battery_pct;
            const shore     = bdata.shore_power;
            const bilgeCm   = bdata.bilge_cm;
            const online    = bdata.online;
            const battCol   = battPct == null ? null : battPct < 20 ? "#e05040" : battPct < 50 ? "#f0a030" : "#2a9a4a";
            const bilgeAlert= bilgeCm != null && bilgeCm > 2;
            const bilgeCol  = bilgeCm > 5 ? "#e05040" : "#f0a030";
            return (
              <>
                {/* Online dot — top-left of boat hull */}
                {online != null && (
                  <div title={online ? "Live telemetry" : "Signal lost"}
                    style={{position:"absolute",top:1,left:2,width:5,height:5,borderRadius:"50%",
                      background:online ? "#2a9a4a" : "#3a3a4a",
                      boxShadow:online ? "0 0 5px #2a9a4a" : undefined,
                      pointerEvents:"none"}}/>
                )}
                {/* Shore power ⚡ — top-right */}
                {shore === true && (
                  <div title="Shore power connected"
                    style={{position:"absolute",top:-1,right:1,fontSize:8,lineHeight:1,
                      pointerEvents:"none",filter:"drop-shadow(0 0 2px #f0c04088)"}}>⚡</div>
                )}
                {/* Bilge alert 💧 — below shore power */}
                {bilgeAlert && (
                  <div title={`Bilge ${bilgeCm.toFixed(1)} cm`}
                    style={{position:"absolute",top:shore===true?10:0,right:1,fontSize:8,lineHeight:1,
                      color:bilgeCol,pointerEvents:"none"}}>💧</div>
                )}
                {/* Battery pill — bottom-left of boat hull */}
                {battPct != null && (
                  <div title={`Battery ${Math.round(battPct)}%`}
                    style={{position:"absolute",bottom:0,left:2,
                      fontSize:6,fontWeight:"bold",color:battCol,lineHeight:1,
                      background:"rgba(0,0,0,0.55)",borderRadius:2,
                      padding:"1px 3px",letterSpacing:0.3,
                      border:`1px solid ${battCol}55`,pointerEvents:"none"}}>
                    {Math.round(battPct)}%
                  </div>
                )}
              </>
            );
          })()}

          {/* Wind arrow — exact same coordinate mapping as WindRose:
               N=left(−x), E=top(−y), arrow points DOWNwind. */}
          {bdata?.wind_dir_deg != null && (() => {
            const dir = bdata.wind_dir_deg;
            const speed = bdata.wind_speed_kn;
            const msx = (deg) => -Math.cos(deg * Math.PI / 180);
            const msy = (deg) => -Math.sin(deg * Math.PI / 180);
            const downwind = (dir + 180) % 360;
            const S = 12;
            const tipX  = S + msx(downwind) * (S - 3);
            const tipY  = S + msy(downwind) * (S - 3);
            const tailX = S - msx(downwind) * (S - 5);
            const tailY = S - msy(downwind) * (S - 5);
            const col = typeof speed === "number" && speed > 15 ? "#e05040"
                      : typeof speed === "number" && speed > 8  ? "#f0a030"
                      : "#7ec8e3";
            return (
              <svg width={S*2} height={S*2} viewBox={`0 0 ${S*2} ${S*2}`}
                style={{position:"absolute",bottom:-S+2,right:-S+2,pointerEvents:"none",opacity:0.92}}
                title={`Wind ${Math.round(dir)}° · ${speed != null ? speed.toFixed(1)+" kn" : ""}`}>
                <defs>
                  <marker id={`wa-${boatId}`} markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill={col}/>
                  </marker>
                </defs>
                <circle cx={S} cy={S} r={S-1} fill="rgba(8,24,40,0.55)" stroke={col} strokeWidth="0.8"/>
                <line x1={tailX} y1={tailY} x2={tipX} y2={tipY}
                  stroke={col} strokeWidth="1.8" strokeLinecap="round" markerEnd={`url(#wa-${boatId})`}/>
              </svg>
            );
          })()}
        </div>
      </div>
    );
  }

  function DockBlock({section}) {
    const sb=boats.filter(b=>section.boats.includes(b.id)).sort((a,b)=>section.boats.indexOf(a.id)-section.boats.indexOf(b.id));
    return (
      <div style={{display:"flex",alignItems:"stretch",marginBottom:18}}>
        <div style={{display:"flex",flexDirection:"column",justifyContent:"space-evenly",flex:1,padding:"8px 0"}}>
          {sb.map(b=><BoatRow key={b.id} boatId={b.id}/>)}
        </div>
        <div style={{width:52,flexShrink:0,background:"linear-gradient(135deg,#4a3a20,#5a4828,#4a3a20)",
          border:"2px solid #8a6a30",borderRadius:4,
          boxShadow:"inset 0 0 12px rgba(0,0,0,0.5),2px 2px 8px rgba(0,0,0,0.5)",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"space-evenly",
          padding:"8px 4px",position:"relative"}}>
          <div style={{fontSize:9,letterSpacing:3,color:"rgba(200,160,80,0.7)",textTransform:"uppercase",writingMode:"vertical-rl"}}>Dock {section.id}</div>
          {sb.map((_,i)=>(
            <div key={i} style={{width:10,height:10,borderRadius:"50%",background:"radial-gradient(circle,#c8a050 30%,#7a5820 100%)",
              border:"1px solid rgba(200,160,80,0.5)",boxShadow:"0 1px 3px rgba(0,0,0,0.5)"}}/>
          ))}
          <div style={{position:"absolute",right:-18,top:0,bottom:0,width:18,
            background:"linear-gradient(to right,rgba(90,72,40,0.8),rgba(60,48,28,0.4))",
            borderTop:"1px solid rgba(138,106,48,0.3)",borderBottom:"1px solid rgba(138,106,48,0.3)"}}/>
        </div>
      </div>
    );
  }

  // ── Telemetry tab (in-side-panel) ─────────────────────────────────────────────
  function TelemetryTab({ telemetry, boat }) {
    if (telemetry?.authRequired) {
      const slug = boatSlug(boat.name);
      return (
        <div style={{textAlign:"center",padding:"22px 12px"}}>
          <div style={{fontSize:24,marginBottom:8}}>🔒</div>
          <div style={{fontSize:11,color:"#9ec8e0",marginBottom:14,lineHeight:1.5}}>
            Live telemetry is available to the boat owner only.
          </div>
          <Link href={`/login?next=/${slug}`}
            style={{
              display:"inline-block",padding:"7px 14px",fontSize:11,letterSpacing:2,
              background:"#f0c040",color:"#091820",borderRadius:4,
              textDecoration:"none",fontWeight:"bold",
            }}>
            SIGN IN
          </Link>
        </div>
      );
    }
    if (!telemetry) {
      return <div style={{fontSize:11,color:"#5a8aaa",textAlign:"center",padding:"20px 0"}}>◌ loading telemetry…</div>;
    }
    const t = telemetry;
    const tile = (label, value, unit, color = "#e8f4f8") => {
      const blank = value === null || value === undefined || value === "";
      if (blank) return null;
      return (
        <div style={{
          flex:"1 1 calc(50% - 6px)",minWidth:0,
          background:"rgba(255,255,255,0.03)",border:"1px solid rgba(126,171,200,0.1)",
          borderRadius:5,padding:"7px 9px",
        }}>
          <div style={{fontSize:8,letterSpacing:1.5,color:"#7eabc8",textTransform:"uppercase",marginBottom:2}}>{label}</div>
          <div style={{fontSize:14,fontWeight:"bold",color}}>
            {value}
            {unit && <span style={{fontSize:9,color:"#5a8aaa",marginLeft:3,fontWeight:"normal"}}>{unit}</span>}
          </div>
        </div>
      );
    };
    const lastSeen = t.last_seen_ago < 60
      ? `${t.last_seen_ago}s ago`
      : `${Math.round(t.last_seen_ago/60)} min ago`;
    // Defensive accessors — live MQTT payloads from the bridge are often
    // partial (the boat only publishes what Cerbo / NMEA2000 actually
    // exposes). Never assume any nested field exists.
    const num = (v, d = 1) => (typeof v === "number" && !isNaN(v) ? v.toFixed(d) : null);
    const battV = num(t.battery?.voltage, 2);
    const battPct = typeof t.battery?.percent === "number" ? t.battery.percent : null;
    const shore = typeof t.shore_power === "boolean" ? (t.shore_power ? "On" : "Off") : null;
    const bilgeCm = num(t.bilge?.water_cm, 1);
    const bilgeCyc = typeof t.bilge?.pump_cycles_24h === "number" ? t.bilge.pump_cycles_24h : null;
    const cabinT = num(t.cabin?.temperature_c, 1);
    const cabinH = typeof t.cabin?.humidity_pct === "number" ? t.cabin.humidity_pct : null;
    const heel = num(t.heel_deg, 1);
    const lat = typeof t.position?.lat === "number" ? t.position.lat : null;
    const lon = typeof t.position?.lon === "number" ? t.position.lon : null;
    const wind = t.wind || {};
    const windTrueDir = typeof wind?.true?.direction_deg === "number" ? wind.true.direction_deg : null;
    const windTrueKn = typeof wind?.true?.speed_kn === "number" ? wind.true.speed_kn : null;
    const windAppAngle = typeof wind?.apparent?.angle_deg === "number" ? wind.apparent.angle_deg : null;
    const windAppKn = typeof wind?.apparent?.speed_kn === "number" ? wind.apparent.speed_kn : null;
    const headingDeg = typeof t.heading_deg === "number" ? t.heading_deg : null;
    const cogDeg = typeof t.cog_deg === "number" ? t.cog_deg : null;
    const hasWindTelemetry = windTrueDir !== null || windAppAngle !== null;
    const hasPosition = lat !== null && lon !== null;
    const hasAnyTiles = [battV, battPct, shore, bilgeCm, bilgeCyc, cabinT, cabinH, heel]
      .some((v) => v !== null && v !== undefined && v !== "");
    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:9,color:t.last_seen_ago<120?"#2a9a4a":"#a08040",letterSpacing:1}}>
            ● live · {lastSeen}
          </div>
          <Link href={`/${boatSlug(boat.name)}`} target="_blank" rel="noreferrer"
            style={{fontSize:9,color:"#6ab0e8",letterSpacing:1,textDecoration:"none"}}>
            full page ↗
          </Link>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {tile("Battery", battV, "V", battV !== null && parseFloat(battV) < 12.0 ? "#e08040" : "#2a9a4a")}
          {tile("Charge", battPct, "%", battPct !== null && battPct < 30 ? "#e08040" : "#9ec8e0")}
          {tile("Shore power", shore, "", shore === "On" ? "#2a9a4a" : "#a08040")}
          {tile("Bilge water", bilgeCm, "cm", bilgeCm !== null && parseFloat(bilgeCm) > 4 ? "#e08040" : "#6ab0e8")}
          {tile("Pump 24h", bilgeCyc, "cyc")}
          {tile("Cabin temp", cabinT, "°C", "#f0c040")}
          {tile("Humidity", cabinH, "%")}
          {tile("Heel", heel, "°", heel !== null && Math.abs(parseFloat(heel)) > 3 ? "#e08040" : "#9ec8e0")}
        </div>
        {hasWindTelemetry && (
          <div style={{
            marginTop:10,padding:"8px 10px",background:"rgba(255,255,255,0.03)",
            border:"1px solid rgba(126,171,200,0.1)",borderRadius:5,
            display:"flex",justifyContent:"center",
          }}>
            <BoatWindRose
              size={220}
              trueDirDeg={windTrueDir}
              trueSpeedKn={windTrueKn}
              apparentAngle={windAppAngle}
              apparentSpeedKn={windAppKn}
              headingDeg={headingDeg}
              cogDeg={cogDeg}
            />
          </div>
        )}
        {!hasAnyTiles && !hasPosition && (
          <div style={{marginTop:8,fontSize:11,color:"#5a8aaa"}}>
            No telemetry fields available yet.
          </div>
        )}
        {hasPosition && (
          <div style={{marginTop:10,padding:"8px 10px",background:"rgba(255,255,255,0.03)",
            border:"1px solid rgba(126,171,200,0.1)",borderRadius:5}}>
            <div style={{fontSize:8,letterSpacing:1.5,color:"#7eabc8",textTransform:"uppercase",marginBottom:3}}>Position</div>
            <div style={{fontFamily:"monospace",fontSize:11,color:"#e8f4f8"}}>
              {lat.toFixed(5)}°N, {lon.toFixed(5)}°E
            </div>
            <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`}
               target="_blank" rel="noreferrer"
               style={{fontSize:9,color:"#6ab0e8",letterSpacing:1,textDecoration:"none"}}>
              Open in map ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  // ── Weather (Loksa station) ────────────────────────────────────────────────────
  function compass(deg) {
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(((deg % 360) / 22.5)) % 16];
  }
  function beaufort(ms) {
    const table = [[0.3,0],[1.5,1],[3.3,2],[5.5,3],[7.9,4],[10.7,5],[13.8,6],[17.1,7],[20.7,8],[24.4,9],[28.4,10],[32.6,11]];
    for (const [lim, b] of table) if (ms < lim) return b;
    return 12;
  }
  function WindRose({ dir, speed, gust }) {
    // dir = degrees the wind is coming FROM (meteorological convention).
    // The rose is rotated to MATCH the marina map: docks are on the right
    // (south) side, open water on the left (north). So the rose's N sits at
    // the LEFT of the dial, S at the RIGHT, E at the TOP, W at the BOTTOM.
    // The arrow points DOWNWIND (where wind is going) so you can read
    // directly which side of the boat the wind is hitting.
    // Example: south wind (180°, blowing from docks → open water) → arrow
    // points LEFT, away from the docks.
    const size = 150, c = size / 2, r = c - 12;
    const cardinals = [["N",0],["E",90],["S",180],["W",270]];
    const ticks = Array.from({ length: 16 }, (_, i) => i * 22.5);
    const hasDir = typeof dir === "number" && !isNaN(dir);
    // Bearing → screen vector with N at left (-x), E at top (-y).
    const sx = (deg) => -Math.cos(deg * Math.PI / 180);
    const sy = (deg) => -Math.sin(deg * Math.PI / 180);
    const downwind = hasDir ? (dir + 180) % 360 : 0;
    const tipX  = c + sx(downwind) * (r - 8);
    const tipY  = c + sy(downwind) * (r - 8);
    const tailX = c - sx(downwind) * (r - 18);
    const tailY = c - sy(downwind) * (r - 18);
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:"block"}}>
        {/* outer ring */}
        <circle cx={c} cy={c} r={r} fill="rgba(8,28,44,0.55)" stroke="rgba(126,171,200,0.35)" strokeWidth="1"/>
        <circle cx={c} cy={c} r={r-10} fill="none" stroke="rgba(126,171,200,0.12)" strokeWidth="1"/>
        {/* tick marks */}
        {ticks.map((a, i) => {
          const major = i % 4 === 0;
          const len = major ? 7 : 3;
          const x1 = c + sx(a) * r;
          const y1 = c + sy(a) * r;
          const x2 = c + sx(a) * (r - len);
          const y2 = c + sy(a) * (r - len);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={major ? "#c8a050" : "rgba(126,171,200,0.4)"} strokeWidth={major ? 1.5 : 1}/>;
        })}
        {/* cross-hairs */}
        <line x1={c} y1={6} x2={c} y2={size-6} stroke="rgba(126,171,200,0.08)" strokeWidth="0.8"/>
        <line x1={6} y1={c} x2={size-6} y2={c} stroke="rgba(126,171,200,0.08)" strokeWidth="0.8"/>
        {/* arrow — only if direction known */}
        {hasDir && (
          <g>
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#f0c040"/>
              </marker>
            </defs>
            <line x1={tailX} y1={tailY} x2={tipX} y2={tipY}
              stroke="#f0c040" strokeWidth="3" strokeLinecap="round" markerEnd="url(#arrowhead)"
              style={{filter:"drop-shadow(0 0 4px rgba(240,192,64,0.6))"}}/>
          </g>
        )}
        {/* cardinal labels */}
        {cardinals.map(([lbl, a]) => {
          const x = c + sx(a) * (r + 7);
          const y = c + sy(a) * (r + 7) + 3;
          return (
            <text key={lbl} x={x} y={y} textAnchor="middle"
              fontSize="10" fontWeight="bold" letterSpacing="1"
              fill={lbl === "N" ? "#f0c040" : "#c8e0f0"}
              fontFamily="Georgia, serif">{lbl}</text>
          );
        })}
        {/* center wind speed */}
        <text x={c} y={c-2} textAnchor="middle" fontSize="20" fontWeight="bold" fill="#e8f4f8" fontFamily="Georgia, serif">
          {typeof speed === "number" ? speed.toFixed(1) : "—"}
        </text>
        <text x={c} y={c+12} textAnchor="middle" fontSize="8" letterSpacing="2" fill="#7eabc8">M/S</text>
        {typeof gust === "number" && gust > 0 && (
          <text x={c} y={c+24} textAnchor="middle" fontSize="8" fill="rgba(240,192,64,0.7)">gust {gust.toFixed(1)}</text>
        )}
      </svg>
    );
  }

  function WeatherPanel() {
    if (!weatherShown) return null;

    function startDrag(e) {
      // Only left button; ignore clicks on the close button
      if (e.button !== 0) return;
      const isTouch = e.type === "touchstart";
      const point = isTouch ? e.touches[0] : e;
      const node = weatherDragRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const parent = node.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const offX = point.clientX - rect.left;
      const offY = point.clientY - rect.top;
      e.preventDefault();
      function move(ev) {
        const p = ev.touches ? ev.touches[0] : ev;
        const x = p.clientX - parent.left - offX;
        const y = p.clientY - parent.top - offY;
        setWeatherPos({ x, y });
      }
      function up() {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", up);
      }
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      window.addEventListener("touchmove", move, { passive:false });
      window.addEventListener("touchend", up);
    }

    if (!weather) {
      return (
        <div ref={weatherDragRef} style={{...weatherBoxStyle, fontSize:10, color:"#5a8aaa", textAlign:"center", padding:"10px 14px", cursor:"grab"}}
          onMouseDown={startDrag} onTouchStart={startDrag}>
          ◌ loading Loksa station…
        </div>
      );
    }
    const w = weather;
    // Prefer live marina-boat readings (in-bay, fresher) for wind and sea temp.
    const mc = marinaConditions;
    const hasBoatWind = mc?.wind?.direction_deg != null && mc?.wind?.sample_count > 0;
    const hasBoatSeaTemp = mc?.water_temp_c != null;
    const dir   = hasBoatWind ? mc.wind.direction_deg : w.winddirection;
    const speed = hasBoatWind ? mc.wind.speed_ms      : w.windspeed;
    const gust  = hasBoatWind ? null                  : w.windspeedmax; // boats don't report gust yet
    const bf = typeof speed === "number" ? beaufort(speed) : null;
    const stat = (label, value, unit, color = "#e8f4f8", source = null) => {
      const has = value !== null && value !== undefined && value !== "";
      const borrowed = has && source && (source.distance_km > 0 || source.marina);
      return (
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",
          padding:"4px 0",borderBottom:"1px solid rgba(126,171,200,0.06)"}}>
          <span style={{fontSize:9,letterSpacing:1.5,color:"#7eabc8",textTransform:"uppercase"}}>{label}</span>
          <span style={{fontSize:12,fontWeight:"bold",color,textAlign:"right"}}>
            {has ? value : <em style={{color:"#3a5a6a"}}>—</em>}
            {has && unit &&
              <span style={{fontSize:9,color:"#5a8aaa",marginLeft:3,fontWeight:"normal"}}>{unit}</span>}
            {borrowed &&
              <div style={{fontSize:8,color: source.marina ? "#2a9a4a" : "#5a8aaa",fontWeight:"normal",letterSpacing:0.5,marginTop:1}}>
                {source.marina ? `⛵ ${source.name}` : `${source.name} · ${source.distance_km} km`}
              </div>}
          </span>
        </div>
      );
    };
    const src = (k) => (w.sources && w.sources[k]) || null;
    const updated = new Date(w.timestamp).toLocaleTimeString("et-EE", {hour:"2-digit", minute:"2-digit"});
    return (
      <div ref={weatherDragRef} style={weatherBoxStyle}>
        <div onMouseDown={startDrag} onTouchStart={startDrag}
          style={{padding:"10px 14px 8px",borderBottom:"1px solid rgba(126,171,200,0.1)",cursor:"grab",userSelect:"none",position:"relative"}}>
          <div style={{fontSize:8,letterSpacing:3,color:"#7eabc8",textTransform:"uppercase"}}>⚓ Loksa Station · ~10 km E</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:2,paddingRight:18}}>
            <div style={{fontSize:14,fontWeight:"bold",color:"#e8f4f8",letterSpacing:2}}>WEATHER</div>
            <div style={{fontSize:9,color:"#5a8aaa"}}>● {updated}</div>
          </div>
          {hasBoatWind && (
            <div style={{fontSize:8,color:"#2a9a4a",letterSpacing:1,marginTop:2}}>
              ⛵ wind from {mc.wind.sample_count} marina boat{mc.wind.sample_count !== 1 ? "s" : ""}
            </div>
          )}
          <button onMouseDown={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()}
            onClick={()=>setWeatherShown(false)}
            title="Close"
            style={{position:"absolute",top:6,right:8,background:"none",border:"none",
              color:"#7eabc8",cursor:"pointer",fontSize:16,lineHeight:1,padding:"2px 6px"}}>×</button>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"12px 8px 4px"}}>
          <WindRose dir={dir} speed={speed} gust={gust}/>
        </div>
        <div style={{padding:"0 14px 6px",textAlign:"center"}}>
          <div style={{fontSize:11,color:"#f0c040",letterSpacing:1.5,fontWeight:"bold"}}>
            {typeof dir === "number" ? `${compass(dir)} · ${Math.round(dir)}°` : "—"}
          </div>
          {bf !== null && (
            <div style={{fontSize:9,color:"#7eabc8",marginTop:1}}>Beaufort {bf}</div>
          )}
        </div>
        <div style={{padding:"6px 14px 12px"}}>
          {stat("Air temp", w.airtemperature, "°C", "#f0c040", src("airtemperature"))}
          {hasBoatSeaTemp
            ? stat("Sea temp", mc.water_temp_c?.toFixed(1), "°C", "#6ab0e8",
                { name: `${mc.sample_count?.sea_temp ?? 1} boat${(mc.sample_count?.sea_temp ?? 1) !== 1 ? "s" : ""}`, marina: true })
            : stat("Sea temp", w.watertemperature, "°C", "#6ab0e8", src("watertemperature"))}
          {/* Estonian stations report sea level relative to EH2000 datum;
              the legacy `waterlevel` (BK77) field is usually empty. */}
          {stat(
            "Sea level",
            w.waterlevel_eh2000 ?? w.waterlevel,
            "cm EH2000",
            "#6ab0e8",
            src("waterlevel_eh2000") || src("waterlevel"),
          )}
          {stat("Pressure", w.airpressure, "hPa", "#e8f4f8", src("airpressure"))}
          {stat("Humidity", w.relativehumidity, "%", "#e8f4f8", src("relativehumidity"))}
          {stat("Precip.", w.precipitations, "mm", "#6ab0e8", src("precipitations"))}
          {stat("Visibility", w.visibility, "km", "#e8f4f8", src("visibility"))}
          {w.phenomenon && (
            <div style={{marginTop:6,fontSize:10,color:"#c8e0f0",fontStyle:"italic",textAlign:"center"}}>
              {w.phenomenon}
              {src("phenomenon") && src("phenomenon").distance_km > 0 && (
                <span style={{fontSize:8,color:"#5a8aaa",fontStyle:"normal",marginLeft:6}}>
                  {src("phenomenon").name} · {src("phenomenon").distance_km} km
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function WeatherReopen() {
    if (weatherShown) return null;
    return (
      <button onClick={()=>setWeatherShown(true)} title="Show weather"
        style={{position:"absolute",top:20,right:36,zIndex:5,
          background:"rgba(13,36,56,0.6)",border:"1px solid rgba(126,171,200,0.25)",
          borderRadius:6,padding:"6px 10px",cursor:"pointer",
          color:"#c8e0f0",fontSize:11,letterSpacing:1.5,fontFamily:"inherit",
          backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)"}}>
        ⚓ Weather
      </button>
    );
  }

  // ── Crane view ─────────────────────────────────────────────────────────────────
  function CraneView() {
    const done=queue.filter(e=>e.status==="done").length, total=queue.length;
    return (
      <div style={{flex:1,overflow:"auto",padding:"20px 16px",background:"linear-gradient(160deg,#0a1e2e 0%,#071520 100%)"}}>
        {/* Summary card */}
        <div style={{background:"linear-gradient(135deg,#1a2e1a,#0e1e0e)",border:"1px solid rgba(42,154,74,0.3)",
          borderRadius:8,padding:"14px 16px",marginBottom:20}}>
          <div style={{fontSize:9,letterSpacing:4,color:"#2a9a4a",textTransform:"uppercase",marginBottom:6}}>🏗 Crane Day · {new Date().toLocaleDateString("et-EE")}</div>
          <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
            {[["START","10:00"],["SLOT","45 min"],["BOATS",total],["DONE",`${done}/${total}`],
              total>0?["EST. FINISH",slotTime(total).start]:null].filter(Boolean).map(([l,v],i)=>(
              <div key={i}>
                <div style={{fontSize:9,color:"#5a8aaa",letterSpacing:1}}>{l}</div>
                <div style={{fontSize:20,color:l==="DONE"?"#2a9a4a":l==="BOATS"?"#f0c040":"#e8f4f8",fontWeight:"bold"}}>{v}</div>
              </div>
            ))}
          </div>
          {total>0&&(
            <div style={{marginTop:12,height:4,background:"rgba(255,255,255,0.08)",borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${(done/total)*100}%`,background:"linear-gradient(to right,#1a7a4a,#2a9a4a)",borderRadius:2,transition:"width 0.4s"}}/>
            </div>
          )}
        </div>

        {/* Queue entries */}
        {queue.length===0&&(
          <div style={{textAlign:"center",padding:"40px 20px",color:"#3a5a6a"}}>
            <div style={{fontSize:32,marginBottom:8}}>🏗</div>
            <div style={{fontSize:13,letterSpacing:1}}>Queue is empty</div>
            <div style={{fontSize:10,marginTop:4,opacity:0.6}}>Add boats using the button below</div>
          </div>
        )}

        {queue.map((entry,idx)=>{
          const boat=getBoat(entry.boatId); if(!boat) return null;
          const {start,end}=slotTime(idx);
          const isQDrag=qDragIdx===idx, isQOver=qDragOver===idx, isDone=entry.status==="done";
          return (
            <div key={entry.id} draggable
              onDragStart={e=>onQDragStart(e,idx)} onDragOver={e=>onQDragOver(e,idx)}
              onDrop={e=>onQDrop(e,idx)} onDragEnd={onQDragEnd}
              style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"10px 12px",
                borderRadius:6,userSelect:"none",
                opacity:isQDrag?0.3:isDone?0.55:1,
                background:isQOver?"rgba(240,192,64,0.08)":isDone?"rgba(42,154,74,0.06)":entry.status==="active"?"rgba(240,192,64,0.06)":"rgba(255,255,255,0.03)",
                border:isQOver?"1px dashed rgba(240,192,64,0.5)":entry.status==="active"?"1px solid rgba(240,192,64,0.2)":isDone?"1px solid rgba(42,154,74,0.2)":"1px solid rgba(255,255,255,0.06)",
                transition:"all 0.15s"}}>
              <div style={{fontSize:16,color:"rgba(200,160,80,0.25)",cursor:"grab",flexShrink:0}}>⠿</div>
              <div style={{flexShrink:0,textAlign:"center",width:52}}>
                <div style={{fontSize:14,fontWeight:"bold",color:isDone?"#2a9a4a":entry.status==="active"?"#f0c040":"#e8f4f8",fontFamily:"monospace"}}>{start}</div>
                <div style={{fontSize:9,color:"rgba(126,171,200,0.4)"}}>–{end}</div>
                <div style={{fontSize:9,color:"rgba(126,171,200,0.35)",letterSpacing:1,marginTop:2}}>#{idx+1}</div>
              </div>
              <div style={{flexShrink:0}}><BoatShape color={boat.color} small/></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <div style={{fontSize:12,fontWeight:"bold",color:"#e8f4f8",letterSpacing:1,textTransform:"uppercase"}}>{boat.name}</div>
                  <div style={{fontSize:9,padding:"1px 6px",borderRadius:2,fontWeight:"bold",letterSpacing:1,
                    background:entry.type==="in"?"rgba(30,111,168,0.25)":"rgba(138,42,90,0.25)",
                    color:entry.type==="in"?"#6ab0e8":"#e080b0",
                    border:`1px solid ${entry.type==="in"?"rgba(30,111,168,0.4)":"rgba(138,42,90,0.4)"}`}}>
                    {entry.type==="in"?"⬇ HAUL IN":"⬆ HAUL OUT"}
                  </div>
                </div>
                {boat.owner&&<div style={{fontSize:10,color:"#5a8aaa",marginTop:2}}>{boat.owner}</div>}
                <input value={entry.note} onChange={e=>setNote(entry.id,e.target.value)} placeholder="Add note…"
                  style={{marginTop:4,width:"100%",background:"transparent",border:"none",
                    borderBottom:"1px solid rgba(126,171,200,0.12)",color:"#7eabc8",
                    fontSize:10,outline:"none",fontFamily:"inherit",padding:"2px 0",boxSizing:"border-box"}}/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,alignItems:"flex-end"}}>
                <button onClick={()=>setStatus(entry.id,statusNext[entry.status])} style={{
                  padding:"3px 8px",borderRadius:3,cursor:"pointer",fontSize:9,fontWeight:"bold",letterSpacing:1,
                  background:"transparent",border:`1px solid ${statusColor[entry.status]}`,
                  color:statusColor[entry.status],fontFamily:"inherit",whiteSpace:"nowrap"}}>
                  {statusLabel[entry.status]}
                </button>
                <div style={{display:"flex",gap:3}}>
                  <button onClick={()=>moveQueue(idx,-1)} disabled={idx===0}
                    style={{width:22,height:22,borderRadius:3,border:"1px solid rgba(126,171,200,0.2)",
                      background:"rgba(255,255,255,0.04)",color:idx===0?"#2a4a5a":"#7eabc8",
                      cursor:idx===0?"default":"pointer",fontSize:10}}>↑</button>
                  <button onClick={()=>moveQueue(idx,1)} disabled={idx===queue.length-1}
                    style={{width:22,height:22,borderRadius:3,border:"1px solid rgba(126,171,200,0.2)",
                      background:"rgba(255,255,255,0.04)",color:idx===queue.length-1?"#2a4a5a":"#7eabc8",
                      cursor:idx===queue.length-1?"default":"pointer",fontSize:10}}>↓</button>
                </div>
                <button onClick={()=>removeFromQueue(entry.id)} style={{
                  width:22,height:22,borderRadius:3,border:"1px solid rgba(138,42,42,0.3)",
                  background:"rgba(138,42,42,0.08)",color:"#a05050",cursor:"pointer",fontSize:11}}>×</button>
              </div>
            </div>
          );
        })}

        {/* Add picker */}
        {showPicker&&(
          <div style={{marginBottom:16,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(126,171,200,0.15)",borderRadius:6,padding:"12px 14px"}}>
            <div style={{fontSize:9,letterSpacing:3,color:"#7eabc8",textTransform:"uppercase",marginBottom:10}}>Select boat & operation</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {["in","out"].map(t=>(
                <button key={t} onClick={()=>setAddType(t)} style={{
                  flex:1,padding:"7px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:"bold",
                  background:addType===t?(t==="in"?"rgba(30,111,168,0.3)":"rgba(138,42,90,0.3)"):"rgba(255,255,255,0.04)",
                  color:addType===t?(t==="in"?"#6ab0e8":"#e080b0"):"#5a8aaa",
                  border:addType===t?`1px solid ${t==="in"?"rgba(30,111,168,0.5)":"rgba(138,42,90,0.5)"}`:"1px solid rgba(126,171,200,0.15)",
                  fontFamily:"inherit"}}>
                  {t==="in"?"⬇ Haul In":"⬆ Haul Out"}
                </button>
              ))}
            </div>
            {availableBoats.length===0
              ? <div style={{fontSize:11,color:"#3a5a6a",textAlign:"center",padding:"10px 0"}}>All boats are in the queue</div>
              : availableBoats.map(boat=>(
                  <div key={boat.id} onClick={()=>addToQueue(boat.id,addType)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:4,
                      cursor:"pointer",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(126,171,200,0.1)",marginBottom:6}}>
                    <BoatShape color={boat.color} small/>
                    <div>
                      <div style={{fontSize:12,fontWeight:"bold",color:"#e8f4f8",letterSpacing:1,textTransform:"uppercase"}}>{boat.name}</div>
                      {boat.owner&&<div style={{fontSize:9,color:"#5a8aaa"}}>{boat.owner}</div>}
                    </div>
                  </div>
                ))
            }
            <button onClick={()=>setShowPicker(false)} style={{marginTop:8,width:"100%",padding:"6px",
              background:"transparent",border:"1px solid rgba(126,171,200,0.15)",borderRadius:4,
              color:"#5a8aaa",cursor:"pointer",fontSize:10,fontFamily:"inherit"}}>Cancel</button>
          </div>
        )}
        {!showPicker&&(
          <button onClick={()=>setShowPicker(true)} style={{
            width:"100%",padding:"11px",borderRadius:6,cursor:"pointer",
            background:"rgba(240,192,64,0.08)",border:"1px dashed rgba(240,192,64,0.35)",
            color:"#f0c040",fontSize:12,letterSpacing:2,fontFamily:"inherit",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <span style={{fontSize:16}}>+</span> ADD BOAT TO QUEUE
          </button>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────────
  const activeInQueue=queue.filter(e=>e.status==="active").length;

  return (
    <>
      <Head>
        <title>Hara Marina</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="theme-color" content="#091820"/>
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex"/>
        <meta name="googlebot" content="noindex, nofollow"/>
      </Head>

      <div style={{height:"100vh",background:"#091820",fontFamily:"'Georgia','Times New Roman',serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Header */}
        <div style={{padding:"12px 20px",background:"linear-gradient(135deg,#0c2235,#112a3f)",
          borderBottom:"1px solid rgba(126,171,200,0.13)",
          display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:10,gap:10}}>
          <div>
            <div style={{fontSize:8,letterSpacing:5,color:"#7eabc8",textTransform:"uppercase",marginBottom:1}}>⚓ Sadam · Harbour</div>
            <div style={{fontSize:22,fontWeight:"bold",color:"#e8f4f8",letterSpacing:4}}>HARA</div>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",gap:4,background:"rgba(0,0,0,0.3)",borderRadius:6,padding:3}}>
            {[
              {id:"marina",label:"⚓ Marina"},
              {id:"map",label:"🗺 Map"},
              ...(authed ? [{id:"crane",label:"🏗 Crane"}] : []),
            ].map(tab=>(
              <button key={tab.id} onClick={()=>setView(tab.id)} style={{
                padding:"6px 14px",borderRadius:4,cursor:"pointer",fontSize:10,letterSpacing:1,
                fontFamily:"inherit",fontWeight:view===tab.id?"bold":"normal",
                background:view===tab.id?"rgba(126,171,200,0.2)":"transparent",
                border:view===tab.id?"1px solid rgba(126,171,200,0.3)":"1px solid transparent",
                color:view===tab.id?"#e8f4f8":"#5a8aaa",position:"relative"}}>
                {tab.label}
                {tab.id==="crane"&&queue.length>0&&(
                  <span style={{position:"absolute",top:-4,right:-4,width:16,height:16,borderRadius:"50%",
                    background:activeInQueue>0?"#f0c040":"#2a9a4a",color:"#000",
                    fontSize:8,fontWeight:"bold",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {queue.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div style={{textAlign:"right",display:"flex",alignItems:"center",gap:14}}>
            {authed === false && (
              <Link href="/login?next=/" style={{
                fontSize:10,letterSpacing:2,color:"#091820",background:"#f0c040",
                padding:"6px 12px",borderRadius:4,textDecoration:"none",fontWeight:"bold"}}>
                SIGN IN
              </Link>
            )}
            <div>
              <div style={{fontSize:9,color:"#5a8aaa",letterSpacing:1}}>BERTHS</div>
              <div style={{fontSize:20,color:"#f0c040",fontWeight:"bold"}}>{boats.length}</div>
              <div style={{fontSize:8,color:synced?"#2a9a4a":"#7eabc8",letterSpacing:1,marginTop:1}}>
                {synced?"● live":"◌ loading…"}
              </div>
            </div>
          </div>
        </div>

        <div style={{display:"flex",flex:1,overflow:"hidden"}}>

          {/* Marina view */}
          {view==="marina"&&(
            <>
              <div style={{flex:1,overflow:"auto",position:"relative",
                background:"radial-gradient(ellipse at 20% 50%,#0d3050 0%,#071520 100%)",
                padding:"28px 0 28px 20px"}}>
                <WaterLines/>
                <WindCanvas dir={weather?.winddirection} speed={weather?.windspeed} gust={weather?.windspeedmax}/>
                <WeatherPanel/>
                <WeatherReopen/>
                <div style={{position:"absolute",right:0,top:0,bottom:0,width:20,
                  background:"linear-gradient(to left,#3a2c18,#2a2010,transparent)",
                  borderLeft:"2px solid #6a5028",zIndex:3}}/>
                {swapSrcId&&(
                  <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",
                    background:"rgba(0,229,255,0.12)",border:"1px solid rgba(0,229,255,0.35)",
                    borderRadius:4,padding:"5px 12px",fontSize:10,color:"#00e5ff",zIndex:10,
                    display:"flex",gap:8,alignItems:"center",animation:"pulse 1.2s infinite"}}>
                    ⇄ Tap destination boat
                    <button onClick={()=>setSwapSrcId(null)} style={{background:"none",border:"none",color:"#7eabc8",cursor:"pointer",fontSize:13}}>✕</button>
                  </div>
                )}
                <div style={{position:"relative",zIndex:2,paddingRight:20}}>
                  {DOCK_SECTIONS.map(s=><DockBlock key={s.id} section={s}/>)}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",marginTop:8}}>
                    <div style={{fontSize:9,color:"rgba(240,192,64,0.35)",fontStyle:"italic",marginRight:8}}>no berths</div>
                    <div style={{width:52,minHeight:60,background:"linear-gradient(135deg,#3a2800,#4a3600,#3a2800)",
                      border:"2px solid #f0c040",borderRadius:4,
                      boxShadow:"0 0 14px rgba(240,192,64,0.18),inset 0 0 10px rgba(0,0,0,0.5)",
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                      gap:4,position:"relative",padding:"10px 4px"}}>
                      <div style={{fontSize:14}}>⛽</div>
                      <div style={{fontSize:7,letterSpacing:2,color:"#f0c040",textTransform:"uppercase",writingMode:"vertical-rl",fontWeight:"bold"}}>TANKLA</div>
                      <div style={{position:"absolute",right:-18,top:0,bottom:0,width:18,
                        background:"linear-gradient(to right,rgba(90,72,40,0.8),rgba(60,48,28,0.4))",
                        borderTop:"1px solid rgba(138,106,48,0.3)",borderBottom:"1px solid rgba(138,106,48,0.3)"}}/>
                    </div>
                  </div>
                </div>
              </div>

              {/* Detail panel */}
              <div style={{width:selectedId?300:0,minWidth:selectedId?300:0,overflow:"hidden",
                transition:"all 0.3s ease",background:"linear-gradient(180deg,#0d2438,#091c2c)",
                borderLeft:"1px solid rgba(126,171,200,0.1)",display:"flex",flexDirection:"column"}}>
                {selectedId&&draft&&(
                  <>
                    <div style={{padding:"14px 16px 10px",borderBottom:"1px solid rgba(126,171,200,0.08)",
                      background:`linear-gradient(135deg,${draft.color}1a 0%,transparent 100%)`,position:"relative"}}>
                      <button onClick={closePanel} style={{position:"absolute",top:10,right:12,background:"none",
                        border:"none",color:"#5a8aaa",cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
                      <div style={{fontSize:9,letterSpacing:3,color:"#7eabc8",textTransform:"uppercase",marginBottom:3}}>Dock {draft.section}</div>
                      {editMode
                        ? <input value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value.toUpperCase()}))}
                            style={{fontSize:18,fontWeight:"bold",letterSpacing:2,background:"rgba(255,255,255,0.07)",
                              border:"1px solid rgba(126,171,200,0.3)",color:"#e8f4f8",padding:"4px 8px",
                              borderRadius:4,outline:"none",fontFamily:"inherit",width:"80%"}}/>
                        : <div style={{fontSize:19,fontWeight:"bold",color:"#e8f4f8",letterSpacing:2}}>{draft.name}</div>
                      }
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:5}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:draft.color,border:"2px solid rgba(255,255,255,0.2)"}}/>
                        {editMode&&<input type="color" value={draft.color} onChange={e=>setDraft(d=>({...d,color:e.target.value}))}
                          style={{width:26,height:18,border:"none",cursor:"pointer",background:"none"}}/>}
                      </div>
                    </div>
                    <div style={{display:"flex",borderBottom:"1px solid rgba(126,171,200,0.08)"}}>
                      {[{id:"details",label:"📋 Details"},{id:"telemetry",label:"🛰 Telemetry"}].map(t=>(
                        <button key={t.id} onClick={()=>setPanelTab(t.id)} style={{
                          flex:1,padding:"8px 4px",cursor:"pointer",fontSize:10,letterSpacing:1.5,
                          background:panelTab===t.id?"rgba(126,171,200,0.08)":"transparent",
                          border:"none",borderBottom:panelTab===t.id?"2px solid #f0c040":"2px solid transparent",
                          color:panelTab===t.id?"#e8f4f8":"#5a8aaa",fontFamily:"inherit"}}>
                          {t.label}
                        </button>
                      ))}
                      <Link href={`/${boatSlug(draft.name)}`} target="_blank" rel="noreferrer"
                        style={{padding:"8px 10px",fontSize:10,letterSpacing:1.5,
                          color:"#7eabc8",textDecoration:"none",borderBottom:"2px solid transparent"}}
                        title="Open full boat page">↗</Link>
                    </div>
                    <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
                      {panelTab === "details" && <>
                      <Field label="Owner / Omanik" fieldKey="owner" placeholder="Firstname Lastname" editMode={editMode} draft={draft} setDraft={setDraft}/>
                      <Field label="Vessel Model" fieldKey="model" placeholder="e.g. Beneteau First 35" editMode={editMode} draft={draft} setDraft={setDraft}/>
                      <div style={{display:"flex",gap:8}}>
                        <div style={{flex:1}}><Field label="Length m" fieldKey="length" placeholder="10.5" editMode={editMode} draft={draft} setDraft={setDraft}/></div>
                        <div style={{flex:1}}><Field label="Beam m" fieldKey="beam" placeholder="3.4" editMode={editMode} draft={draft} setDraft={setDraft}/></div>
                        <div style={{flex:1}}><Field label="Draft m" fieldKey="draft" placeholder="1.8" editMode={editMode} draft={draft} setDraft={setDraft}/></div>
                      </div>
                      <Field label="Engine" fieldKey="engine" placeholder="Volvo D2-40" editMode={editMode} draft={draft} setDraft={setDraft}/>
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>Equipment</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {editMode
                            ? EQUIP.map(item=>(
                                <button key={item} onClick={()=>toggleEquip(item)} style={{
                                  padding:"3px 7px",fontSize:9,borderRadius:3,cursor:"pointer",
                                  background:draft.equipment.includes(item)?draft.color:"rgba(255,255,255,0.04)",
                                  color:draft.equipment.includes(item)?"#fff":"#7eabc8",
                                  border:`1px solid ${draft.equipment.includes(item)?draft.color:"rgba(126,171,200,0.18)"}`}}>{item}</button>
                              ))
                            : draft.equipment.length>0
                              ? draft.equipment.map(item=>(
                                  <span key={item} style={{padding:"3px 7px",fontSize:9,borderRadius:3,
                                    background:`${draft.color}28`,color:"#b8d8e8",border:`1px solid ${draft.color}40`}}>{item}</span>
                                ))
                              : <em style={{fontSize:11,color:"#3a5a6a"}}>No equipment logged</em>
                          }
                        </div>
                      </div>
                      <Field label="Notes / Märkused" fieldKey="notes" placeholder="Free text..." editMode={editMode} draft={draft} setDraft={setDraft}/>
                      {!queuedBoatIds.has(selectedId)?(
                        <div style={{marginTop:4,paddingTop:10,borderTop:"1px solid rgba(126,171,200,0.08)"}}>
                          <div style={{fontSize:9,letterSpacing:2,color:"#7eabc8",textTransform:"uppercase",marginBottom:6}}>Add to Crane Queue</div>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>{addToQueue(selectedId,"in");setView("crane");closePanel();}} style={{
                              flex:1,padding:"7px",borderRadius:4,cursor:"pointer",fontSize:10,
                              background:"rgba(30,111,168,0.15)",border:"1px solid rgba(30,111,168,0.35)",
                              color:"#6ab0e8",fontFamily:"inherit"}}>⬇ Haul In</button>
                            <button onClick={()=>{addToQueue(selectedId,"out");setView("crane");closePanel();}} style={{
                              flex:1,padding:"7px",borderRadius:4,cursor:"pointer",fontSize:10,
                              background:"rgba(138,42,90,0.15)",border:"1px solid rgba(138,42,90,0.35)",
                              color:"#e080b0",fontFamily:"inherit"}}>⬆ Haul Out</button>
                          </div>
                        </div>
                      ):(
                        <div style={{marginTop:4,paddingTop:10,borderTop:"1px solid rgba(126,171,200,0.08)"}}>
                          <div style={{fontSize:10,color:"#f0a020",letterSpacing:1}}>🏗 In queue — slot #{queue.findIndex(e=>e.boatId===selectedId)+1}</div>
                        </div>
                      )}
                      </>}
                      {panelTab === "telemetry" && (
                        <TelemetryTab telemetry={telemetry} boat={selectedBoat}/>
                      )}
                    </div>
                    <div style={{padding:"10px 16px",borderTop:"1px solid rgba(126,171,200,0.08)",display:"flex",gap:8}}>
                      {!editMode?(
                        <>
                          <button onClick={()=>setEditMode(true)} style={{flex:2,padding:"8px",borderRadius:4,cursor:"pointer",
                            background:"rgba(126,171,200,0.09)",border:"1px solid rgba(126,171,200,0.2)",
                            color:"#9ec8e0",fontSize:11,letterSpacing:1,fontFamily:"inherit"}}>✏️ Edit</button>
                          <button onClick={()=>{setSwapSrcId(selectedId);closePanel();}} style={{
                            flex:1,padding:"8px",borderRadius:4,cursor:"pointer",
                            background:"rgba(0,229,255,0.08)",border:"1px solid rgba(0,229,255,0.3)",
                            color:"#00e5ff",fontSize:11,letterSpacing:1,fontFamily:"inherit"}}>⇄ Swap</button>
                        </>
                      ):(
                        <>
                          <button onClick={saveEdit} style={{flex:2,padding:"8px",borderRadius:4,cursor:"pointer",
                            background:draft.color,border:"none",color:"#fff",fontSize:11,fontFamily:"inherit",fontWeight:"bold"}}>✓ Save</button>
                          <button onClick={cancelEdit} style={{flex:1,padding:"8px",borderRadius:4,cursor:"pointer",
                            background:"rgba(255,255,255,0.04)",border:"1px solid rgba(126,171,200,0.18)",
                            color:"#7eabc8",fontSize:11,fontFamily:"inherit"}}>Cancel</button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {view==="map"&&(
            <MarinaMapView
              boats={boats}
              selectedId={selectedId}
              queuedBoatIds={queuedBoatIds}
              onBoatSelect={handleBoatTap}
              layout={marinaLayout}
              isSuperAdmin={isSuperAdmin}
              onSaveLayout={saveMarinaLayout}
            />
          )}

          {view==="crane"&&authed&&<CraneView/>}
        </div>
      </div>
    </>
  );
}
