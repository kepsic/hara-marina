/**
 * Guest berth bookings.
 *
 * Storage: single Redis JSON blob at `hara:bookings:v1` containing an array
 * of booking records. The dataset is small (one marina, dozens-to-hundreds
 * of bookings/year) so the simplicity of a single-blob CRUD beats the overhead
 * of secondary indices. Availability checks scan the array in-memory.
 *
 * Booking record shape:
 *   {
 *     id: "bk_<random>",
 *     marinaSlug: "vaiana",        // future-proofs multi-marina; today single value
 *     berthId, dockId,             // location
 *     guestName, email, phone,     // contact
 *     boatName, loaM, beamM, draftM,
 *     arrival: "YYYY-MM-DD",       // inclusive
 *     departure: "YYYY-MM-DD",     // exclusive (i.e. checkout day)
 *     nights: number,
 *     priceCents, currency,
 *     status: "pending" | "confirmed" | "checked-in" | "checked-out" | "cancelled",
 *     paymentStatus: "unpaid" | "authorized" | "paid" | "refunded",
 *     stripePaymentIntent: string|null,
 *     notes: string,
 *     createdAt: ISO,
 *     confirmedAt: ISO|null,
 *     cancelledAt: ISO|null,
 *     cancelledReason: string|null,
 *   }
 */

import crypto from "node:crypto";
import { Redis } from "./redis.js";
import { quoteStay } from "./pricing.js";

const BOOKINGS_KEY = "hara:bookings:v1";
const LAYOUT_KEY = "hara:marina-layout:v1";

/** Look up human-friendly labels for a (dockId, berthId) pair from the saved layout. */
async function lookupLabels(dockId, berthId) {
  try {
    const layout = await redis.get(LAYOUT_KEY);
    if (!layout || typeof layout !== "object") return { berthLabel: null, dockName: null };
    const dock = (layout.docks || []).find((d) => d.id === dockId);
    const berth = (layout.berths || []).find((b) => b.id === berthId);
    return {
      berthLabel: berth?.label || null,
      dockName: dock?.name || null,
    };
  } catch {
    return { berthLabel: null, dockName: null };
  }
}

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "checked-in"]);

const redis = new Redis();

function randomId() {
  return `bk_${crypto.randomBytes(8).toString("hex")}`;
}

function normDate(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? s : null;
}

function nightsBetween(arrival, departure) {
  const a = new Date(`${arrival}T12:00:00Z`);
  const d = new Date(`${departure}T12:00:00Z`);
  return Math.max(0, Math.round((d - a) / 86400000));
}

export async function listBookings({ marinaSlug, berthId, status, fromIso, toIso } = {}) {
  const raw = await redis.get(BOOKINGS_KEY);
  let arr = Array.isArray(raw) ? raw : [];
  if (marinaSlug) arr = arr.filter((b) => !b.marinaSlug || b.marinaSlug === marinaSlug);
  if (berthId) arr = arr.filter((b) => b.berthId === berthId);
  if (status) arr = arr.filter((b) => b.status === status);
  if (fromIso) arr = arr.filter((b) => b.departure > fromIso);
  if (toIso) arr = arr.filter((b) => b.arrival < toIso);
  return arr.sort((a, b) => (a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 : 0));
}

export async function getBooking(id) {
  const raw = await redis.get(BOOKINGS_KEY);
  const arr = Array.isArray(raw) ? raw : [];
  return arr.find((b) => b.id === id) || null;
}

export async function isBerthAvailable({ berthId, arrival, departure, ignoreId } = {}) {
  if (!berthId || !arrival || !departure) return false;
  const all = await listBookings({ berthId });
  for (const b of all) {
    if (ignoreId && b.id === ignoreId) continue;
    if (!ACTIVE_STATUSES.has(b.status)) continue;
    // Overlap: ranges [arrival, departure) intersect [b.arrival, b.departure)
    if (b.arrival < departure && b.departure > arrival) return false;
  }
  return true;
}

/** Validate boat dimensions against the berth's max-* limits (read from layout slot). */
export function validateBoatFit({ loaM, beamM, draftM }, berthLimits) {
  const errors = [];
  if (Number.isFinite(berthLimits?.maxLengthM) && Number.isFinite(loaM) && loaM > berthLimits.maxLengthM) {
    errors.push(`Boat LOA ${loaM} m exceeds berth limit ${berthLimits.maxLengthM} m`);
  }
  if (Number.isFinite(berthLimits?.maxBeamM) && Number.isFinite(beamM) && beamM > berthLimits.maxBeamM) {
    errors.push(`Boat beam ${beamM} m exceeds berth limit ${berthLimits.maxBeamM} m`);
  }
  if (Number.isFinite(berthLimits?.maxDraftM) && Number.isFinite(draftM) && draftM > berthLimits.maxDraftM) {
    errors.push(`Boat draft ${draftM} m exceeds berth limit ${berthLimits.maxDraftM} m`);
  }
  return errors;
}

export async function createBooking(input) {
  const arrival = normDate(input.arrival);
  const departure = normDate(input.departure);
  if (!arrival || !departure || arrival >= departure) {
    const err = new Error("Invalid arrival/departure dates");
    err.code = "BAD_DATES";
    throw err;
  }
  if (!input.berthId || !input.dockId) {
    const err = new Error("berthId and dockId required");
    err.code = "BAD_BERTH";
    throw err;
  }
  if (!input.guestName || !input.email) {
    const err = new Error("guestName and email required");
    err.code = "BAD_CONTACT";
    throw err;
  }
  if (!(await isBerthAvailable({ berthId: input.berthId, arrival, departure }))) {
    const err = new Error("Berth not available for the selected dates");
    err.code = "UNAVAILABLE";
    throw err;
  }
  const quote = await quoteStay({
    berthId: input.berthId,
    dockId: input.dockId,
    arrival,
    departure,
  });
  const now = new Date().toISOString();
  const labels = await lookupLabels(input.dockId, input.berthId);
  const booking = {
    id: randomId(),
    marinaSlug: input.marinaSlug || null,
    berthId: input.berthId,
    berthLabel: labels.berthLabel || input.berthLabel || null,
    dockId: input.dockId,
    dockName: labels.dockName || input.dockName || null,
    guestName: String(input.guestName).slice(0, 120),
    email: String(input.email).trim().toLowerCase().slice(0, 200),
    phone: input.phone ? String(input.phone).slice(0, 40) : "",
    boatName: input.boatName ? String(input.boatName).slice(0, 80) : "",
    loaM: Number.isFinite(Number(input.loaM)) ? Number(input.loaM) : null,
    beamM: Number.isFinite(Number(input.beamM)) ? Number(input.beamM) : null,
    draftM: Number.isFinite(Number(input.draftM)) ? Number(input.draftM) : null,
    arrival,
    departure,
    nights: nightsBetween(arrival, departure),
    priceCents: quote.totalCents,
    currency: quote.currency,
    status: "pending",
    paymentStatus: "unpaid",
    stripePaymentIntent: null,
    notes: input.notes ? String(input.notes).slice(0, 1000) : "",
    createdAt: now,
    confirmedAt: null,
    cancelledAt: null,
    cancelledReason: null,
  };
  const all = (await redis.get(BOOKINGS_KEY)) || [];
  all.push(booking);
  await redis.set(BOOKINGS_KEY, all);
  return booking;
}

export async function updateBooking(id, patch) {
  const all = (await redis.get(BOOKINGS_KEY)) || [];
  const idx = all.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const prev = all[idx];
  const next = { ...prev, ...patch };
  // status transitions auto-stamp dates
  if (patch.status === "confirmed" && !prev.confirmedAt) next.confirmedAt = new Date().toISOString();
  if (patch.status === "cancelled" && !prev.cancelledAt) next.cancelledAt = new Date().toISOString();
  all[idx] = next;
  await redis.set(BOOKINGS_KEY, all);
  return next;
}

export async function cancelBooking(id, reason) {
  return updateBooking(id, { status: "cancelled", cancelledReason: reason || "" });
}
