#!/usr/bin/env node
/**
 * Idempotent seed of Hara Sadam into Supabase.
 *
 *   node scripts/seed-hara.mjs
 *
 * Reads marina coordinates / role memberships from .env.local. Safe to
 * re-run — every insert uses on-conflict upsert. The script is the
 * single source of truth for what data the legacy Hara deploy lives on
 * inside the multi-tenant DB; lib/constants.js is the seed origin.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

config({ path: ".env.local" });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE in .env.local");
  process.exit(1);
}
const sb = createClient(url, key);

const toSlug = (name) => name.toLowerCase()
  .replace(/[₂²]/g, "2")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

// 1. Marina ----------------------------------------------------------------
const { data: marina, error: mErr } = await sb.from("marinas").upsert({
  slug: "hara",
  name: process.env.MARINA_NAME || "Hara Sadam",
  lat: Number(process.env.HARA_MARINA_LAT || 59.5881254),
  lon: Number(process.env.HARA_MARINA_LON || 25.6124356),
  country: "EE",
  timezone: "Europe/Tallinn",
  plan: "port",
  active: true,
  status: "active",
  contact_email: process.env.MARINA_CONTACT_EMAIL || "info@harasadam.ee",
  website: "https://harasadam.ee",
  onboarding_completed_at: new Date().toISOString(),
}, { onConflict: "slug" }).select().single();
if (mErr) { console.error(mErr); process.exit(1); }
console.log("Marina:", marina.id);

// 2. Dock sections ---------------------------------------------------------
const sections = [
  { label: "A", sort_order: 0 },
  { label: "B", sort_order: 1 },
  { label: "C", sort_order: 2 },
];
const { error: sErr } = await sb.from("dock_sections")
  .upsert(sections.map((s) => ({ ...s, marina_id: marina.id })),
    { onConflict: "marina_id,label" });
if (sErr) { console.error(sErr); process.exit(1); }
console.log("Sections seeded: 3");

// 3. Boats — read from constants.js ---------------------------------------
const constantsPath = path.resolve(__dirname, "../lib/constants.js");
const src = readFileSync(constantsPath, "utf8");
const m = src.match(/INITIAL_BOATS\s*=\s*\[([\s\S]*?)\];/);
if (!m) { console.error("Could not extract INITIAL_BOATS from constants.js"); process.exit(1); }

// Cheap parse: turn each line into a record.
const BOATS = [];
for (const line of m[1].split("\n")) {
  const nameM = line.match(/name:\s*"([^"]+)"/);
  const sectM = line.match(/section:\s*"([^"]+)"/);
  const colM  = line.match(/color:\s*"([^"]+)"/);
  const noBat = /no_battery\s*:\s*true/.test(line);
  if (nameM && sectM) {
    BOATS.push({ name: nameM[1], section: sectM[1], color: colM?.[1] || null, no_battery: noBat });
  }
}

const { data: boats, error: bErr } = await sb.from("boats").upsert(
  BOATS.map((b) => ({
    marina_id: marina.id,
    slug: toSlug(b.name),
    name: b.name,
    section: b.section,
    color: b.color,
    no_battery: b.no_battery || false,
    active: true,
    status: "active",
    onboarding_status: "bridge_connected",
    mqtt_username: `boat-hara-${toSlug(b.name)}`,
  })),
  { onConflict: "marina_id,slug" },
).select();
if (bErr) { console.error(bErr); process.exit(1); }
console.log("Boats seeded:", boats.length);

// 4. Marina members from env ----------------------------------------------
const split = (v) => (v || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const supers = split(process.env.MARINA_SUPERADMINS);
const harbor = split(process.env.MARINA_HARBORMASTERS);
const admins = split(process.env.MARINA_ADMINS);
const members = [
  ...supers.map((email) => ({ email, role: "admin", marina_id: marina.id })),
  ...harbor.map((email) => ({ email, role: "harbor_master", marina_id: marina.id })),
  ...admins.map((email) => ({ email, role: "admin", marina_id: marina.id })),
];
const seen = new Set();
const unique = members.filter((m) => {
  const k = m.email + ":" + m.role;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
if (unique.length) {
  const { error: memErr } = await sb.from("marina_members")
    .upsert(unique, { onConflict: "marina_id,email,role" });
  if (memErr) { console.error(memErr); process.exit(1); }
  console.log("Members seeded:", unique.length);
} else {
  console.log("No members in env — skipping (set MARINA_SUPERADMINS / MARINA_HARBORMASTERS / MARINA_ADMINS to populate).");
}

console.log("✅ Hara Marina seeded successfully");
