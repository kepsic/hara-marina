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
import { signBookingActionToken } from "./auth.js";

function publicBase() {
  const raw = process.env.MARINA_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://hara-marina.mereveer.ee";
  return raw.replace(/\/$/, "");
}

async function actionUrl(bookingId, action) {
  const token = await signBookingActionToken({ bookingId, action });
  return `${publicBase()}/api/bookings/action?token=${encodeURIComponent(token)}`;
}

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

async function send({ to, cc, bcc, replyTo, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[booking-email] No RESEND_API_KEY. Would send to ${to}: ${subject}`);
    return { ok: true, transport: "console" };
  }
  const FALLBACK_FROM = "Hara Marina <onboarding@resend.dev>";
  const primaryFrom = fromAddress();

  async function attempt(from) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        cc: cc?.length ? cc : undefined,
        bcc: bcc?.length ? bcc : undefined,
        reply_to: replyTo || undefined,
        subject,
        html,
        text,
      }),
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body, from };
  }

  let result = await attempt(primaryFrom);
  // If the configured from-address fails because the domain isn't verified in
  // Resend, automatically retry with Resend's shared sender so the booking
  // notification still goes out. The harbor master will see the warning in the
  // booking record and can fix the DNS later.
  let fellBack = false;
  if (!result.ok && primaryFrom !== FALLBACK_FROM && /not verified|domain|forbidden/i.test(result.body)) {
    console.warn("[booking-email] from-domain rejected, retrying via onboarding@resend.dev:", result.status, result.body);
    result = await attempt(FALLBACK_FROM);
    fellBack = true;
  }
  if (!result.ok) {
    console.error("[booking-email] Resend failed:", result.status, result.body);
    return { ok: false, transport: "resend", status: result.status, error: result.body, from: result.from };
  }
  return { ok: true, transport: "resend", status: result.status, from: result.from, fellBack };
}

function summaryRows(b) {
  const price = formatPrice(b.priceCents, b.currency);
  return `
    <tr><td><b>Boat</b></td><td>${escapeHtml(b.boatName || "-")}</td></tr>
    <tr><td><b>Berth</b></td><td>${escapeHtml(b.dockName || b.dockId)} · ${escapeHtml(b.berthLabel || b.berthId)}</td></tr>
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

function actionButton({ href, label, color }) {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;font-size:15px;margin:6px 4px;">${escapeHtml(label)}</a>`;
}

/** Sent immediately after a guest creates a pending booking. */
export async function sendBookingReceived(booking) {
  const dashboardUrl = `${publicBase()}/bookings`;

  // ----- Guest "we got your request" email --------------------------------
  const guestHtml = `
    <p>Hi ${escapeHtml(booking.guestName)},</p>
    <p>Thanks for choosing <b>Hara Marina</b>. We've received your booking request and the harbor master will review it shortly — usually within a few hours during the day.</p>
    <p>You'll get another email from us once it's <b>confirmed</b>, including arrival instructions.</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #d8e1e8;border-radius:6px;margin:8px 0;">${summaryRows(booking)}</table>
    <p>If anything's wrong with the request — wrong dates, wrong boat — just reply to this email and we'll fix it.</p>
    <p>Fair winds,<br/><b>Hara Marina</b></p>
    <p style="color:#888;font-size:12px;">Booking reference: ${booking.id}</p>
  `;
  const guestRes = await send({
    to: booking.email,
    bcc: bccList(),
    subject: `Booking request received · ${booking.arrival} → ${booking.departure}`,
    html: guestHtml,
    text: `Hi ${booking.guestName},\n\nThanks for choosing Hara Marina. We received your booking request for ${booking.arrival} → ${booking.departure} (${booking.nights} night${booking.nights === 1 ? "" : "s"}). The harbor master will review and confirm shortly.\n\nReference: ${booking.id}\n\n— Hara Marina`,
  });

  // ----- Harbor-master "action required" email ----------------------------
  let adminRes = null;
  const harborMasters = getHarborMasters();
  if (harborMasters.length) {
    const approveUrl = await actionUrl(booking.id, "approve");
    const rejectUrl = await actionUrl(booking.id, "reject");
    const adminHtml = `
      <p><b>New guest-berth booking request</b> — needs your approval.</p>
      <table cellpadding="6" style="border-collapse:collapse;border:1px solid #d8e1e8;border-radius:6px;margin:8px 0;">
        ${summaryRows(booking)}
        <tr><td><b>Guest</b></td><td>${escapeHtml(booking.guestName)} &lt;<a href="mailto:${escapeHtml(booking.email)}">${escapeHtml(booking.email)}</a>&gt;</td></tr>
        <tr><td><b>Phone</b></td><td>${booking.phone ? `<a href="tel:${escapeHtml(booking.phone)}">${escapeHtml(booking.phone)}</a>` : "-"}</td></tr>
        <tr><td><b>Notes</b></td><td>${escapeHtml(booking.notes || "-")}</td></tr>
      </table>
      <p style="margin-top:18px;">
        ${actionButton({ href: approveUrl, label: "✅ Approve & send welcome", color: "#2e8b57" })}
        ${actionButton({ href: rejectUrl, label: "❌ Decline", color: "#b1442a" })}
      </p>
      <p style="color:#666;font-size:12px;">One click sends the appropriate email to the guest. The links work for 14 days. To manage manually, open the <a href="${dashboardUrl}">bookings dashboard</a>.</p>
    `;
    adminRes = await send({
      to: harborMasters,
      replyTo: booking.email,
      subject: `Action required: booking request · ${booking.arrival} · ${booking.berthLabel || booking.berthId}`,
      html: adminHtml,
      text: `New booking request from ${booking.guestName} <${booking.email}> for ${booking.berthLabel || booking.berthId}, ${booking.arrival} → ${booking.departure}.\n\nApprove: ${approveUrl}\nDecline: ${rejectUrl}\n\nDashboard: ${dashboardUrl}`,
    });
  }
  return { guest: guestRes, admin: adminRes, harborMasters };
}

/** Sent after the harbor master approves a booking — warm welcome email. */
export async function sendBookingConfirmed(booking) {
  const html = `
    <p>Hi ${escapeHtml(booking.guestName)},</p>
    <p>Good news — your berth at <b>Hara Marina</b> is <b>confirmed</b>! We're looking forward to having you on ${escapeHtml(booking.arrival)}.</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #d8e1e8;border-radius:6px;margin:8px 0;">${summaryRows(booking)}</table>
    <h3 style="margin-top:18px;">What to expect on arrival</h3>
    <ul>
      <li>VHF channel <b>9</b> — call <i>"Hara Marina"</i> a few minutes before approach.</li>
      <li>Berth <b>${escapeHtml(booking.berthLabel || booking.berthId)}</b> on dock <b>${escapeHtml(booking.dockName || booking.dockId)}</b>.</li>
      <li>Power and water are on the pedestal; payment can be settled on arrival or via the link we'll send.</li>
    </ul>
    <p>If your plans change, just reply to this email — the earlier we know, the easier it is to free up the berth for someone else.</p>
    <p>Safe sailing,<br/><b>Hara Marina</b></p>
    <p style="color:#888;font-size:12px;">Booking reference: ${booking.id}</p>
  `;
  return await send({
    to: booking.email,
    bcc: bccList(),
    replyTo: getHarborMasters()[0],
    subject: `Confirmed · Welcome to Hara Marina · ${booking.arrival}`,
    html,
    text: `Hi ${booking.guestName},\n\nYour berth at Hara Marina is confirmed for ${booking.arrival} → ${booking.departure}.\nBerth ${booking.berthLabel || booking.berthId} (dock ${booking.dockName || booking.dockId}).\n\nOn arrival: VHF channel 9, ask for "Hara Marina".\n\nReference: ${booking.id}\n\n— Hara Marina`,
  });
}

/** Sent after a booking is cancelled (by guest or harbor master) — polite regrets. */
export async function sendBookingCancelled(booking) {
  const reasonLine = booking.cancelledReason
    ? `<p>Reason given: <i>${escapeHtml(booking.cancelledReason)}</i></p>`
    : "";
  const html = `
    <p>Hi ${escapeHtml(booking.guestName)},</p>
    <p>Unfortunately we're unable to take your booking for the dates below. We're sorry for the disappointment — this is usually because the berth turned out to be unsuitable for your boat or already promised to a long-stay guest.</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #d8e1e8;border-radius:6px;margin:8px 0;">${summaryRows(booking)}</table>
    ${reasonLine}
    <p>If you'd like to try different dates or another berth, please reply to this email — we'll do what we can to accommodate you.</p>
    <p>Fair winds,<br/><b>Hara Marina</b></p>
    <p style="color:#888;font-size:12px;">Booking reference: ${booking.id}</p>
  `;
  return await send({
    to: booking.email,
    bcc: bccList(),
    replyTo: getHarborMasters()[0],
    subject: `Booking declined · ${booking.arrival} → ${booking.departure}`,
    html,
    text: `Hi ${booking.guestName},\n\nUnfortunately we cannot accept your booking request for ${booking.arrival} → ${booking.departure}.${booking.cancelledReason ? `\n\nReason: ${booking.cancelledReason}` : ""}\n\nReply to this email if you'd like to try different dates.\n\n— Hara Marina`,
  });
}
