export const DOCK_SECTIONS = [
  { id: "A", boats: [1, 2, 3] },
  { id: "B", boats: [4, 5, 6, 7] },
  { id: "C", boats: [8, 9, 10, 11, 12] },
];

export const INITIAL_BOATS = [
  { id:1,  name:"DEVOCEAN",  section:"A", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#1e6fa8" },
  { id:2,  name:"LINDRE",    section:"A", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#1a7a4a" },
  { id:3,  name:"HELMSMAN",  section:"A", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#8b3a3a" },
  { id:4,  name:"TAEVASINA", section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#5a3e8a" },
  { id:5,  name:"O₂",        section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#2a7a8a" },
  { id:6,  name:"ALBERTINA", section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#8a6a10" },
  { id:7,  name:"VAIANA",    section:"B", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#1a5a3a", no_battery:true },
  { id:8,  name:"AMANTE",    section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#8a2a5a" },
  { id:9,  name:"JULIA",     section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#2a4a8a" },
  { id:10, name:"CIBELLE",   section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#4a7a1a" },
  { id:11, name:"CIRRUS",    section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#7a3a1a" },
  { id:12, name:"MOI",       section:"C", owner:"", model:"", length:"", beam:"", draft:"", engine:"", equipment:[], notes:"", color:"#2a6a6a" },
];

export const EQUIP = [
  "VHF Radio", "GPS", "Autopilot", "Radar", "AIS", "Depth Sounder",
  "Chart Plotter", "Life Raft", "EPIRB", "Windlass", "Bimini", "Sprayhood",
  "Generator", "Solar Panels",
];

export const CRANE_START = 10 * 60;
export const SLOT_MIN = 45;
