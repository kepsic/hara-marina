/**
 * Passage plan storage.
 *
 * One active passage per boat (slug) at a time, kept in Redis as JSON at
 * `passage:{slug}`. Completed/cancelled passages are kept in a short history
 * list `passage-history:{slug}` (last 20) for the viewer panel.
 *
 * No SMS/email automation here yet — this module is read by the safety hero
 * card and writeable by the boat owner only. Watchers with a share PIN see
 * the same data via GET.
 */

import { Redis } from "./redis";
import { norm } from "./owners";

const redis = new Redis();

const KEY = (slug) => `passage:${norm(slug)}`;
const HISTORY_KEY = (slug) => `passage-history:${norm(slug)}`;
const HISTORY_MAX = 20;

const STATUSES = new Set(["active", "completed", "cancelled"]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampLat(v) {
  const n = num(v);
  if (n === null) return null;
  if (n < -90 || n > 90) return null;
  return n;
}

function clampLon(v) {
  const n = num(v);
  if (n === null) return null;
  if (n < -180 || n > 180) return null;
  return n;
}

function cleanString(v, max = 200) {
  const s = String(v || "").trim();
  return s ? s.slice(0, max) : "";
}

export function sanitizePassageInput(input) {
  const src = input && typeof input === "object" ? input : {};
  const destName = cleanString(src?.destination?.name, 120);
  const lat = clampLat(src?.destination?.lat);
  const lon = clampLon(src?.destination?.lon);
  const eta = num(src?.eta_ts);
  const departed = num(src?.departed_ts);
  const notes = cleanString(src?.notes, 500);

  const errors = [];
  if (!destName && (lat === null || lon === null)) {
    errors.push("destination requires a name and/or lat+lon");
  }
  if ((lat === null) !== (lon === null)) {
    errors.push("destination lat and lon must both be provided");
  }
  if (!eta) errors.push("eta_ts (ms) required");

  return {
    errors,
    value: {
      destination: { name: destName, lat, lon },
      eta_ts: eta,
      departed_ts: departed || Date.now(),
      notes,
    },
  };
}

export async function getActivePassage(slug) {
  const cleanSlug = norm(slug || "");
  if (!cleanSlug) return null;
  const raw = await redis.get(KEY(cleanSlug));
  if (!raw) return null;
  const obj = typeof raw === "string" ? safeParse(raw) : raw;
  if (!obj || obj.status !== "active") return null;
  return obj;
}

function safeParse(v) {
  try { return JSON.parse(v); } catch { return null; }
}

async function pushHistory(slug, passage) {
  if (!passage) return;
  await redis.lpush(HISTORY_KEY(slug), JSON.stringify(passage));
  await redis.ltrim(HISTORY_KEY(slug), 0, HISTORY_MAX - 1);
}

export async function startPassage(slug, ownerEmail, input) {
  const cleanSlug = norm(slug || "");
  if (!cleanSlug) return { ok: false, error: "slug required" };

  const { errors, value } = sanitizePassageInput(input);
  if (errors.length > 0) return { ok: false, error: errors.join("; ") };

  // If a previous passage was active and the owner is starting a new one,
  // archive the previous as cancelled rather than overwriting silently.
  const existing = await getActivePassage(cleanSlug);
  if (existing) {
    await pushHistory(cleanSlug, {
      ...existing,
      status: "cancelled",
      ended_ts: Date.now(),
      ended_reason: "superseded",
    });
  }

  const passage = {
    status: "active",
    destination: value.destination,
    departed_ts: value.departed_ts,
    eta_ts: value.eta_ts,
    notes: value.notes,
    started_by: String(ownerEmail || "").toLowerCase(),
    created_ts: Date.now(),
    updated_ts: Date.now(),
  };

  await redis.set(KEY(cleanSlug), JSON.stringify(passage));
  return { ok: true, passage };
}

export async function markSafe(slug, ownerEmail) {
  const cleanSlug = norm(slug || "");
  if (!cleanSlug) return { ok: false, error: "slug required" };

  const existing = await getActivePassage(cleanSlug);
  if (!existing) return { ok: false, error: "no active passage" };

  const completed = {
    ...existing,
    status: "completed",
    ended_ts: Date.now(),
    ended_by: String(ownerEmail || "").toLowerCase(),
    updated_ts: Date.now(),
  };
  await pushHistory(cleanSlug, completed);
  await redis.del(KEY(cleanSlug));
  return { ok: true, passage: completed };
}

export async function extendEta(slug, ownerEmail, addMinutes) {
  const cleanSlug = norm(slug || "");
  if (!cleanSlug) return { ok: false, error: "slug required" };
  const mins = Math.round(Number(addMinutes) || 0);
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) {
    return { ok: false, error: "addMinutes must be 1..1440" };
  }

  const existing = await getActivePassage(cleanSlug);
  if (!existing) return { ok: false, error: "no active passage" };

  const next = {
    ...existing,
    eta_ts: Number(existing.eta_ts) + mins * 60_000,
    updated_ts: Date.now(),
    last_extended_by: String(ownerEmail || "").toLowerCase(),
    last_extended_minutes: mins,
  };
  await redis.set(KEY(cleanSlug), JSON.stringify(next));
  return { ok: true, passage: next };
}

export async function cancelPassage(slug, ownerEmail, reason = "cancelled") {
  const cleanSlug = norm(slug || "");
  if (!cleanSlug) return { ok: false, error: "slug required" };

  const existing = await getActivePassage(cleanSlug);
  if (!existing) return { ok: false, error: "no active passage" };

  const cancelled = {
    ...existing,
    status: "cancelled",
    ended_ts: Date.now(),
    ended_by: String(ownerEmail || "").toLowerCase(),
    ended_reason: cleanString(reason, 200) || "cancelled",
    updated_ts: Date.now(),
  };
  await pushHistory(cleanSlug, cancelled);
  await redis.del(KEY(cleanSlug));
  return { ok: true, passage: cancelled };
}

export async function getPassageHistory(slug, limit = 5) {
  const cleanSlug = norm(slug || "");
  if (!cleanSlug) return [];
  const cap = Math.max(1, Math.min(Number(limit) || 5, HISTORY_MAX));
  const arr = await redis.lrange(HISTORY_KEY(cleanSlug), 0, cap - 1);
  return (arr || []).map((x) => (typeof x === "string" ? safeParse(x) : x)).filter(Boolean);
}

export { STATUSES as PASSAGE_STATUSES };
