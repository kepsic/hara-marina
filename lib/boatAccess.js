import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";
import { norm } from "./owners";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false,
});

const KEY = (slug) => `boat-access:${norm(slug)}`;

function getSalt() {
  return process.env.MARINA_AUTH_SECRET || "hara-marina-pin-fallback";
}

function hashPin(slug, pin) {
  return createHash("sha256")
    .update(`${getSalt()}|${norm(slug)}|${String(pin).trim()}`)
    .digest("hex");
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function parse(raw) {
  if (!raw) return {};
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

async function readAccess(slug) {
  const raw = await redis.get(KEY(slug));
  return parse(raw);
}

async function writeAccess(slug, obj) {
  await redis.set(KEY(slug), JSON.stringify(obj));
}

export function validatePinFormat(pin) {
  return /^\d{4,10}$/.test(String(pin || "").trim());
}

export async function hasOwnerPin(slug) {
  const st = await readAccess(slug);
  return !!st.ownerPinHash;
}

export async function setOwnerPin(slug, pin) {
  const clean = String(pin || "").trim();
  if (!validatePinFormat(clean)) {
    throw new Error("PIN must be 4-10 digits");
  }
  const st = await readAccess(slug);
  st.ownerPinHash = hashPin(slug, clean);
  st.ownerPinUpdatedAt = Date.now();
  await writeAccess(slug, st);
}

export async function verifyOwnerPin(slug, pin) {
  const st = await readAccess(slug);
  if (!st.ownerPinHash) return false;
  return safeEqualHex(st.ownerPinHash, hashPin(slug, pin));
}

function generateNumericPin(length = 6) {
  const n = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += String(n[i] % 10);
  return out;
}

export async function createTemporaryShare({ slug, ownerEmail, ttlMinutes = 60 }) {
  const mins = Math.max(5, Math.min(24 * 60, Number(ttlMinutes) || 60));
  const now = Date.now();
  const pin = generateNumericPin(6);
  const share = {
    id: randomBytes(8).toString("hex"),
    pinHash: hashPin(slug, pin),
    createdAtMs: now,
    createdBy: String(ownerEmail || "").toLowerCase(),
    expiresAtMs: now + mins * 60 * 1000,
  };
  const st = await readAccess(slug);
  st.activeShare = share;
  await writeAccess(slug, st);
  return { ...share, pin };
}

export async function getActiveShareMeta(slug) {
  const st = await readAccess(slug);
  const sh = st.activeShare;
  if (!sh) return null;
  if (Date.now() >= Number(sh.expiresAtMs || 0)) return null;
  return {
    id: sh.id,
    createdAtMs: sh.createdAtMs,
    createdBy: sh.createdBy,
    expiresAtMs: sh.expiresAtMs,
  };
}

export async function isShareIdActive(slug, shareId) {
  const st = await readAccess(slug);
  const sh = st.activeShare;
  if (!sh || !shareId) return false;
  if (String(sh.id) !== String(shareId)) return false;
  return Date.now() < Number(sh.expiresAtMs || 0);
}

export async function verifyTemporarySharePin(slug, shareId, pin) {
  const st = await readAccess(slug);
  const sh = st.activeShare;
  if (!sh || !shareId || String(sh.id) !== String(shareId)) return null;
  if (Date.now() >= Number(sh.expiresAtMs || 0)) return null;
  if (!safeEqualHex(sh.pinHash, hashPin(slug, pin))) return null;
  return { id: sh.id, expiresAtMs: Number(sh.expiresAtMs) };
}
