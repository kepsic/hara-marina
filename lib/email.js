/**
 * Outbound email for booking events. Wraps the Resend HTTP API.
 *
 * Env:
 *   RESEND_API_KEY        — same key already used for magic-link emails
 *   BOOKING_FROM_EMAIL    — defaults to RESEND_FROM (the magic-link sender),
 *                            then to "Hara Marina <bookings@resend.dev>"
 *   BOOKING_BCC           — optional comma-separated addresses for BCC
 *
 * Falls back to console-log delivery when RESEND_API_KEY is unset, matching
 * lib/auth.js#sendMagicLink so dev/CI never blocks on missing credentials.
 */

import { getHarborMasters } from "./owners.js";
import { formatPrice } from "./pricing.js";

function fromAddress() {
  return (
    process.env.BOOKING_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    "Hara Marina <bookings@resend.dev>"
  );
}

function bccList() {
  const raw = process.env.BOOKING_BCC || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function send({ to, cc, bcc, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[booking-email] No RESEND_API_KEY. Would send to ${to}: ${subject}`);
    return { ok: true, transport: "console" };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress(),
      to: Array.isArray(to) ? to : [to],
      cc: cc?.length ? cc : undefined,
      bcc: bcc?.length ? bcc : undefined,
      subject,
      html,
      text,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("[booking-email] Resend failed:", r.status, txt);
    return { ok: false, transport: "resend", error: txt };
  }
  return { ok: true, transport: "resend" };
}

function summaryRows(b) {
  const price = formatPrice(b.priceCents, b.currency);
  return `
    <tr><td><b>Boat</b></td><td>${escapeHtml(b.boatName || "-")}</td></tr>
    <tr><td><b>Berth</b></td><td>${escapeHtml(b.dockId)} · ${escapeHtml(b.berthId)}</td></tr>
    <tr><td><b>Arrival</b></td><td>${escapeHtml(b.arrival)}</td></tr>
    <tr><td><b>Departure</b></td><td>${escapeHtml(b.departure)}</td></tr>
    <tr><td><b>Nights</b></td><td>${b.nights}</td></tr>
    <tr><td><b>Price</b></td><td>${escapeHtml(price)}</td></tr>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** Sent immediately after a guest creates a pending booking. */
export async function sendBookingReceived(booking) {
  const guestHtml = `
    <p>Hello ${escapeHtml(booking.guestName)},</p>
    <p>We received your booking request — it's now pending confirmation by the harbor master. You will receive a follow-up email once it's approved.</p>
    <table cellpadding="6" style="border-collapse:collapse;">${summaryRows(booking)}</table>
    <p>If you need to make changes, just reply to this email.</p>
    <p>— Hara Marina</p>
  `;
  await send({
    to: booking.email,
    bcc: bccList(),
    subject: `⚓ Booking received · ${booking.arrival} → ${booking.departure}`,
    html: guestHtml,
    text: `Booking received for ${booking.boatName || ""} ${booking.arrival} → ${booking.departure}. Pending harbor master confirmation.`,
  });

  const harborMasters = getHarborMasters();
  if (harborMasters.length) {
    const adminHtml = `
      <p>New guest-berth booking request:</p>
      <table cellpadding="6" style="border-collapse:collapse;">
        ${summaryRows(booking)}
        <tr><td><b>Guest</b></td><td>${escapeHtml(booking.guestName)} &lt;${escapeHtml(booking.email)}&gt;</td></tr>
        <tr><td><b>Phone</b></td><td>${escapeHtml(booking.phone || "-")}</td></tr>
        <tr><td><b>Notes</b></td><td>${escapeHtml(booking.notes || "-")}</td></tr>
      </table>
    `;
    await send({
      to: harborMasters,
      subject: `[harbor master] Booking request · ${booking.arrival} · berth ${booking.berthId}`,
      html: adminHtml,
    });
  }
}

/** Sent after the harbor master approves a booking. */
export async function sendBookingConfirmed(booking) {
  const html = `
    <p>Hello ${escapeHtml(booking.guestName)},</p>
    <p>Your guest-berth booking is <b>confirmed</b>. The harbor master is expecting you on ${escapeHtml(booking.arrival)}.</p>
    <table cellpadding="6" style="border-collapse:collapse;">${summaryRows(booking)}</table>
    <p>Safe sailing,<br/>Hara Marina</p>
  `;
  await send({
    to: booking.email,
    bcc: bccList(),
    subject: `✅ Booking confirmed · ${booking.arrival} → ${booking.departure}`,
    html,
    text: `Booking confirmed for ${booking.arrival} → ${booking.departure}.`,
  });
}

/** Sent after a booking is cancelled (by guest or harbor master). */
export async function sendBookingCancelled(booking) {
  const html = `
    <p>Hello ${escapeHtml(booking.guestName)},</p>
    <p>Your booking has been <b>cancelled</b>.</p>
    <table cellpadding="6" style="border-collapse:collapse;">${summaryRows(booking)}</table>
    ${booking.cancelledReason ? `<p>Reason: ${escapeHtml(booking.cancelledReason)}</p>` : ""}
    <p>— Hara Marina</p>
  `;
  await send({
    to: booking.email,
    bcc: bccList(),
    subject: `❌ Booking cancelled · ${booking.arrival} → ${booking.departure}`,
    html,
    text: `Booking cancelled for ${booking.arrival} → ${booking.departure}.`,
  });
}
