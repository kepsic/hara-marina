/**
 * Owner-editable per-boat settings.
 * Stored in Redis under hash `boat-settings:<slug>`.
 *
 * Fields are merged on top of the static INITIAL_BOATS entry server-side
 * via applyBoatSettings() so they affect both SSR and client.
 */

import { Redis } from "./redis";

const KEY = (slug) => `boat-settings:${slug}`;

const ALLOWED = [
  "displayName",        // string  override of boat.name (visual only)
  "ownerName",          // string  visible owner name on hero
  "color",              // string  hex like #1a5a3a
  "notes",              // string  free text shown in About panel
  "no_battery",         // bool    hides battery widgets
  "depth_alarm_min_m",  // number  warn under N metres
  "heel_alarm_deg",     // number  warn over N degrees
  "bilge_alarm_cm",     // number  warn over N cm
  "low_battery_v",      // number  warn under N volts
  "watchkeeper_enabled",     // bool    master switch for watchkeeper
  "notify_email_enabled",    // bool    email channel enabled
  "notify_telegram_enabled", // bool    telegram channel enabled
  "offline_after_min",       // number  offline threshold in minutes
  "quiet_hours_enabled",     // bool    suppress trigger notifications during quiet hours
  "quiet_hours_start",       // string  HH:MM local start
  "quiet_hours_end",         // string  HH:MM local end
  "quiet_hours_tz",          // string  IANA timezone
  "watchkeeper_recipients",  // array   additional email recipients
  "telegram_chat_id",        // string  telegram chat id
  "share_intro",        // string  optional message included in share text
  "relay_labels",       // object  { "1": "Heater", "2": "Lights", ... }
  "mmsi",               // string  9-digit AIS MMSI for the boat's transponder
  "model",              // string  vessel model, e.g. "Beneteau First 35"
  "length_m",           // number  hull length in metres
  "beam_m",             // number  beam in metres
  "draft_m",            // number  draft in metres
  "engine",             // string  engine description, e.g. "Volvo D2-40"
  "equipment",          // array   of equipment tags from EQUIPMENT_OPTIONS
];

export const EQUIPMENT_OPTIONS = [
  "VHF Radio", "GPS", "Autopilot", "Radar", "AIS",
  "Depth Sounder", "Chart Plotter", "Life Raft", "EPIRB",
  "Windlass", "Bimini", "Sprayhood", "Generator", "Solar Panels",
];
const EQUIPMENT_SET = new Set(EQUIPMENT_OPTIONS);

const MAX_RECIPIENTS = 6;

function cleanHHMM(v) {
  const s = String(v || "").trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s) ? s : null;
}

function cleanEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s || s.length > 200) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

function sanitize(input) {
  const out = {};
  for (const k of ALLOWED) {
    if (input[k] === undefined) continue;
    const v = input[k];
    if (["no_battery", "watchkeeper_enabled", "notify_email_enabled", "notify_telegram_enabled", "quiet_hours_enabled"].includes(k)) out[k] = !!v;
    else if (["depth_alarm_min_m", "heel_alarm_deg", "bilge_alarm_cm", "low_battery_v"].includes(k)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
      else if (v === null || v === "") out[k] = null;
    } else if (k === "offline_after_min") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 1) out[k] = Math.min(Math.round(n), 7 * 24 * 60);
      else if (v === null || v === "") out[k] = null;
    } else if (k === "quiet_hours_start" || k === "quiet_hours_end") {
      const hhmm = cleanHHMM(v);
      if (hhmm) out[k] = hhmm;
      else if (v === null || v === "") out[k] = null;
    } else if (k === "quiet_hours_tz") {
      const tz = String(v || "").trim();
      if (tz && tz.length <= 64) out[k] = tz;
      else if (v === null || v === "") out[k] = null;
    } else if (k === "watchkeeper_recipients") {
      const arr = Array.isArray(v) ? v : String(v || "").split(/[\n,;\s]+/);
      const dedup = [];
      for (const x of arr) {
        const e = cleanEmail(x);
        if (!e || dedup.includes(e)) continue;
        dedup.push(e);
        if (dedup.length >= MAX_RECIPIENTS) break;
      }
      out[k] = dedup;
    } else if (k === "telegram_chat_id") {
      const id = String(v || "").trim().slice(0, 80);
      out[k] = id || null;
    } else if (k === "relay_labels" && v && typeof v === "object") {
      const labels = {};
      for (const [rk, rv] of Object.entries(v)) {
        const n = Number(rk);
        if (!Number.isInteger(n) || n < 1 || n > 8) continue;
        if (typeof rv === "string") {
          const trimmed = rv.trim().slice(0, 40);
          if (trimmed) labels[String(n)] = trimmed;
        }
      }
      out[k] = labels;
    } else if (k === "mmsi") {
      // Accept digits only. Empty or invalid clears the field.
      const digits = String(v ?? "").replace(/\D/g, "");
      if (digits.length === 0) out[k] = null;
      else if (digits.length >= 7 && digits.length <= 9) out[k] = digits;
    } else if (["length_m", "beam_m", "draft_m"].includes(k)) {
      if (v === null || v === "") { out[k] = null; }
      else {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n < 200) out[k] = Math.round(n * 100) / 100;
      }
    } else if (k === "equipment") {
      const arr = Array.isArray(v) ? v : [];
      const dedup = [];
      for (const item of arr) {
        const s = String(item || "").trim();
        if (EQUIPMENT_SET.has(s) && !dedup.includes(s)) dedup.push(s);
      }
      out[k] = dedup;
    } else if (typeof v === "string") {
      out[k] = v.slice(0, 1000);
    }
  }
  return out;
}

export async function getBoatSettings(slug) {
  if (!slug) return {};
  try {
    const r = new Redis();
    const v = await r.get(KEY(slug));
    return v && typeof v === "object" ? v : {};
  } catch (e) {
    console.error("[boatSettings] get failed:", e?.message || e);
    return {};
  }
}

export async function saveBoatSettings(slug, patch) {
  const clean = sanitize(patch || {});
  const cur = await getBoatSettings(slug);
  const next = { ...cur, ...clean };
  const r = new Redis();
  await r.set(KEY(slug), next);
  return next;
}

/** Overlay settings onto a static boat record, returning a new object. */
export function applyBoatSettings(boat, settings) {
  if (!boat) return boat;
  const s = settings || {};
  return {
    ...boat,
    name:    s.displayName || boat.name,
    owner:   s.ownerName ?? boat.owner,
    color:   s.color || boat.color,
    notes:   s.notes ?? boat.notes,
    no_battery: typeof s.no_battery === "boolean" ? s.no_battery : !!boat.no_battery,
    alarms: {
      depth_min_m:   isNum(s.depth_alarm_min_m) ? s.depth_alarm_min_m : null,
      heel_deg:      isNum(s.heel_alarm_deg)    ? s.heel_alarm_deg    : null,
      bilge_cm:      isNum(s.bilge_alarm_cm)    ? s.bilge_alarm_cm    : null,
      low_battery_v: isNum(s.low_battery_v)     ? s.low_battery_v     : null,
    },
    watchkeeper: {
      enabled: typeof s.watchkeeper_enabled === "boolean" ? s.watchkeeper_enabled : true,
      notify_email_enabled: typeof s.notify_email_enabled === "boolean" ? s.notify_email_enabled : true,
      notify_telegram_enabled: typeof s.notify_telegram_enabled === "boolean" ? s.notify_telegram_enabled : false,
      offline_after_min: isNum(s.offline_after_min) ? s.offline_after_min : null,
      quiet_hours_enabled: typeof s.quiet_hours_enabled === "boolean" ? s.quiet_hours_enabled : false,
      quiet_hours_start: s.quiet_hours_start || "22:00",
      quiet_hours_end: s.quiet_hours_end || "07:00",
      quiet_hours_tz: s.quiet_hours_tz || "Europe/Tallinn",
      watchkeeper_recipients: Array.isArray(s.watchkeeper_recipients) ? s.watchkeeper_recipients : [],
      telegram_chat_id: s.telegram_chat_id || null,
    },
    share_intro: s.share_intro || "",
    relay_labels: (s.relay_labels && typeof s.relay_labels === "object") ? s.relay_labels : {},
    mmsi: s.mmsi || boat.mmsi || null,
    model:  s.model ?? boat.model ?? "",
    length: isNum(s.length_m) ? s.length_m : (boat.length ?? ""),
    beam:   isNum(s.beam_m)   ? s.beam_m   : (boat.beam   ?? ""),
    draft:  isNum(s.draft_m)  ? s.draft_m  : (boat.draft  ?? ""),
    engine: s.engine ?? boat.engine ?? "",
    equipment: Array.isArray(s.equipment) ? s.equipment : (boat.equipment || []),
  };
}

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
