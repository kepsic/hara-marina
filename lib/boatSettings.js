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
  "share_intro",        // string  optional message included in share text
  "relay_labels",       // object  { "1": "Heater", "2": "Lights", ... }
];

function sanitize(input) {
  const out = {};
  for (const k of ALLOWED) {
    if (input[k] === undefined) continue;
    const v = input[k];
    if (k === "no_battery") out[k] = !!v;
    else if (["depth_alarm_min_m", "heel_alarm_deg", "bilge_alarm_cm", "low_battery_v"].includes(k)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
      else if (v === null || v === "") out[k] = null;
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
    share_intro: s.share_intro || "",
    relay_labels: (s.relay_labels && typeof s.relay_labels === "object") ? s.relay_labels : {},
  };
}

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
