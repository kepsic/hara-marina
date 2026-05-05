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

import { getHarborMasters, getSuperAdmins } from "./owners.js";
import { formatPrice } from "./pricing.js";
import { signBookingActionToken } from "./auth.js";

/**
 * A booking is treated as a TEST booking when any of:
 *   - the guest email matches a configured super-admin (e.g. kepsic@gmail.com)
 *   - notes contain a `[test]` / `(test)` / leading `test:` marker
 *   - guest email domain is example.com / test.local / mailinator.com
 * Test bookings never notify the real harbor master — admin emails are
 * redirected to super-admins only so we don't bother Tarvi while we're
 * smoke-testing the flow in production.
 */
export function isTestBooking(b) {
  if (!b) return false;
  const email = String(b.email || "").trim().toLowerCase();
  const supers = new Set(getSuperAdmins().map((e) => e.toLowerCase()));
  if (email && supers.has(email)) return true;
  const notes = String(b.notes || "").toLowerCase();
  if (/\[test\]|\(test\)|^\s*test\s*[:\-]/.test(notes)) return true;
  if (/@(example\.com|test\.local|mailinator\.com)$/.test(email)) return true;
  return false;
}

/** Recipient list for booking-admin notifications, with test-mode redirect. */
function adminRecipientsFor(booking) {
  if (isTestBooking(booking)) {
    const supers = getSuperAdmins();
    return supers.length ? supers : ["kepsic@gmail.com"];
  }
  return getHarborMasters();
}

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
    <tr><td><b>Price</b></td><td>${escapeHtml(price)} <span style="color:#888;font-size:12px;">(electricity included)</span></td></tr>
  `;
}

// Marina-wide facts pulled from harasadam.ee. Overridable via env so a future
// second marina can ship the same email module without code changes.
const MARINA = {
  name: process.env.MARINA_NAME || "Hara Marina",
  operator: process.env.MARINA_OPERATOR || "Hara Sadam MTÜ",
  harborMasterName: process.env.MARINA_HARBORMASTER_NAME || "Tarvi Velström",
  harborMasterPhone: process.env.MARINA_HARBORMASTER_PHONE || "+372 5690 0433",
  generalPhone: process.env.MARINA_GENERAL_PHONE || "+372 5860 8855",
  publicEmail: process.env.MARINA_PUBLIC_EMAIL || "info@harasadam.ee",
  address: process.env.MARINA_ADDRESS || "Hara sadam, Hara village, Kuusalu parish, 74810 Harju county, Estonia",
  websiteUrl: process.env.MARINA_WEBSITE_URL || "https://harasadam.ee/en/hara-port/",
  bankAccount: process.env.MARINA_BANK_ACCOUNT || "Hara Sadam OÜ · EE144204278619984808",
  saunaWindow: process.env.MARINA_SAUNA_WINDOW || "18:00–21:00 (book in advance)",
  restaurantName: process.env.MARINA_RESTAURANT_NAME || "Nāga Pizza",
  restaurantHours: process.env.MARINA_RESTAURANT_HOURS || "Sat 12:00–20:00, Sun 12:00–18:00 (kitchen closes 30 min before)",
  restaurantPhone: process.env.MARINA_RESTAURANT_PHONE || "+372 5637 1650",
  restaurantEmail: process.env.MARINA_RESTAURANT_EMAIL || "restoran@harasadam.ee",
  restaurantUrl: process.env.MARINA_RESTAURANT_URL || "https://harasadam.ee/en/naga-pizza/",
};

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
    <p>Thanks for choosing <b>${escapeHtml(MARINA.name)}</b>. We've received your booking request and the harbor master will review it shortly — usually within a few hours during the day.</p>
    <p>You'll get another email from us once it's <b>confirmed</b>, including arrival instructions.</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #d8e1e8;border-radius:6px;margin:8px 0;">${summaryRows(booking)}</table>
    <p>If anything's wrong with the request — wrong dates, wrong boat — just reply to this email and we'll fix it.</p>
    <p>Fair winds,<br/><b>${escapeHtml(MARINA.name)}</b><br/><a href="${escapeHtml(MARINA.websiteUrl)}">${escapeHtml(MARINA.websiteUrl)}</a></p>
    <p style="color:#888;font-size:12px;">Booking reference: ${booking.id}</p>
  `;
  const guestRes = await send({
    to: booking.email,
    bcc: bccList(),
    subject: `Booking request received · ${booking.arrival} → ${booking.departure}`,
    html: guestHtml,
    text: `Hi ${booking.guestName},\n\nThanks for choosing ${MARINA.name}. We received your booking request for ${booking.arrival} → ${booking.departure} (${booking.nights} night${booking.nights === 1 ? "" : "s"}). The harbor master will review and confirm shortly.\n\nReference: ${booking.id}\n\n— ${MARINA.name}\n${MARINA.websiteUrl}`,
  });

  // ----- Harbor-master "action required" email ----------------------------
  let adminRes = null;
  const testMode = isTestBooking(booking);
  const harborMasters = adminRecipientsFor(booking);
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
      subject: `${testMode ? "[TEST] " : ""}Action required: booking request · ${booking.arrival} · ${booking.berthLabel || booking.berthId}`,
      html: adminHtml,
      text: `New booking request from ${booking.guestName} <${booking.email}> for ${booking.berthLabel || booking.berthId}, ${booking.arrival} → ${booking.departure}.\n\nApprove: ${approveUrl}\nDecline: ${rejectUrl}\n\nDashboard: ${dashboardUrl}`,
    });
  }
  return { guest: guestRes, admin: adminRes, harborMasters, testMode };
}

/** Sent after the harbor master approves a booking — warm welcome email. */
export async function sendBookingConfirmed(booking) {
  // Surface short-stay / slip extras from the live pricing config so they
  // stay in sync with the dashboard (no copy duplication in code).
  let extrasLine = "SUP, kayak and rowboat hire from the port — ask the harbor master.";
  try {
    const { getPricingConfig, formatPrice: fp } = await import("./pricing.js");
    const cfg = await getPricingConfig();
    const bits = [];
    if (Number.isFinite(cfg.shortStayCents) && cfg.shortStayCents > 0) bits.push(`short stay (≤5 h) ${fp(cfg.shortStayCents, cfg.currency)}`);
    if (Number.isFinite(cfg.slipCents) && cfg.slipCents > 0) bits.push(`slip use ${fp(cfg.slipCents, cfg.currency)}/vessel`);
    if (bits.length) extrasLine = `Other on-site rates: ${bits.join(" · ")}. SUP, kayak and rowboat hire from the port — ask the harbor master.`;
  } catch { /* best-effort, never block the welcome email on a config read */ }
  const html = `
    <p>Hi ${escapeHtml(booking.guestName)},</p>
    <p>Good news — your berth at <b>${escapeHtml(MARINA.name)}</b> is <b>confirmed</b>! We're looking forward to having you on ${escapeHtml(booking.arrival)}.</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #d8e1e8;border-radius:6px;margin:8px 0;">${summaryRows(booking)}</table>

    <h3 style="margin-top:18px;">When you arrive</h3>
    <ul>
      <li>Call the harbor master <b>${escapeHtml(MARINA.harborMasterName)}</b> a few minutes before you reach the harbour: <a href="tel:${escapeHtml(MARINA.harborMasterPhone.replace(/\s/g, ""))}">${escapeHtml(MARINA.harborMasterPhone)}</a> (general port number <a href="tel:${escapeHtml(MARINA.generalPhone.replace(/\s/g, ""))}">${escapeHtml(MARINA.generalPhone)}</a>).</li>
      <li>Your berth: <b>${escapeHtml(booking.berthLabel || booking.berthId)}</b> on dock <b>${escapeHtml(booking.dockName || booking.dockId)}</b>.</li>
      <li>Power and water are on the pedestal — electricity is included in the berth fee.</li>
      <li>Address: ${escapeHtml(MARINA.address)}.</li>
    </ul>

    <h3 style="margin-top:18px;">While you're here</h3>
    <ul>
      <li><b>Facilities:</b> showers, laundry room, accessible WC, rest room, meeting room — all in the harbour building. Free Wi-Fi covers the whole port area.</li>
      <li><b>Sauna:</b> available to port guests, ${escapeHtml(MARINA.saunaWindow)}.</li>
      <li><b><a href="${escapeHtml(MARINA.restaurantUrl)}">${escapeHtml(MARINA.restaurantName)}</a></b> (wood-fired pizza with a sea view) and the harbour shop are on site — ${escapeHtml(MARINA.restaurantHours)}. To pre-order or arrange catering: <a href="tel:${escapeHtml(MARINA.restaurantPhone.replace(/\s/g, ""))}">${escapeHtml(MARINA.restaurantPhone)}</a> · <a href="mailto:${escapeHtml(MARINA.restaurantEmail)}">${escapeHtml(MARINA.restaurantEmail)}</a>.</li>
      <li><b>Activities:</b> ${escapeHtml(extrasLine)}</li>
    </ul>

    <h3 style="margin-top:18px;">Payment</h3>
    <p>You can pay at the harbour shop on arrival. If the shop happens to be closed, bank transfer to <b>${escapeHtml(MARINA.bankAccount)}</b> is fine — please put the booking reference <code>${escapeHtml(booking.id)}</code> in the payment description.</p>

    <p>If your plans change, just reply to this email — the earlier we know, the easier it is to free up the berth for someone else.</p>
    <p>Safe sailing,<br/><b>${escapeHtml(MARINA.harborMasterName)}</b><br/>Harbor Master, ${escapeHtml(MARINA.name)}<br/><a href="${escapeHtml(MARINA.websiteUrl)}">${escapeHtml(MARINA.websiteUrl)}</a></p>
    <p style="color:#888;font-size:12px;">Booking reference: ${booking.id}</p>
  `;
  const replyTo = adminRecipientsFor(booking)[0];
  return await send({
    to: booking.email,
    bcc: bccList(),
    replyTo,
    subject: `${isTestBooking(booking) ? "[TEST] " : ""}Confirmed · Welcome to ${MARINA.name} · ${booking.arrival}`,
    html,
    text: `Hi ${booking.guestName},\n\nYour berth at ${MARINA.name} is confirmed for ${booking.arrival} → ${booking.departure}.\nBerth ${booking.berthLabel || booking.berthId} (dock ${booking.dockName || booking.dockId}). Electricity included.\n\nOn arrival, call the harbor master ${MARINA.harborMasterName} on ${MARINA.harborMasterPhone} (or general port number ${MARINA.generalPhone}).\n\nAddress: ${MARINA.address}\n\nFacilities: showers, laundry, free Wi-Fi, sauna ${MARINA.saunaWindow}.\n${MARINA.restaurantName}: ${MARINA.restaurantHours} — ${MARINA.restaurantPhone} / ${MARINA.restaurantEmail} (${MARINA.restaurantUrl}).\n\nPayment: at the harbour shop on arrival, or by bank transfer to ${MARINA.bankAccount} (use ref ${booking.id}).\n\nReference: ${booking.id}\n\n— ${MARINA.name}\n${MARINA.websiteUrl}`,
  });
}

/** Sent after a booking is cancelled (by guest or harbor master) — polite regrets. */
export async function sendBookingCancelled(booking) {
  const reasonLine = booking.cancelledReason
    ? `<p>Reason given: <i>${escapeHtml(booking.cancelledReason)}</i></p>`
    : "";
  const html = `
    <p>Hi ${escapeHtml(booking.guestName)},</p>
    <p>Unfortunately we're unable to take your booking for the dates below. We're sorry for the disappointment — this is usually because the berth turned out to be unsuitable for your boat, the harbour is full on those dates, or the slot was already promised to a long-stay guest.</p>
    <table cellpadding="6" style="border-collapse:collapse;border:1px solid #d8e1e8;border-radius:6px;margin:8px 0;">${summaryRows(booking)}</table>
    ${reasonLine}
    <p>If you'd like to try different dates or another berth, please reply to this email or get in touch directly:</p>
    <ul>
      <li>Harbor Master <b>${escapeHtml(MARINA.harborMasterName)}</b> — <a href="tel:${escapeHtml(MARINA.harborMasterPhone.replace(/\s/g, ""))}">${escapeHtml(MARINA.harborMasterPhone)}</a></li>
      <li>General port: <a href="tel:${escapeHtml(MARINA.generalPhone.replace(/\s/g, ""))}">${escapeHtml(MARINA.generalPhone)}</a></li>
      <li>Email: <a href="mailto:${escapeHtml(MARINA.publicEmail)}">${escapeHtml(MARINA.publicEmail)}</a></li>
    </ul>
    <p>Fair winds,<br/><b>${escapeHtml(MARINA.name)}</b><br/><a href="${escapeHtml(MARINA.websiteUrl)}">${escapeHtml(MARINA.websiteUrl)}</a></p>
    <p style="color:#888;font-size:12px;">Booking reference: ${booking.id}</p>
  `;
  return await send({
    to: booking.email,
    bcc: bccList(),
    replyTo: adminRecipientsFor(booking)[0],
    subject: `${isTestBooking(booking) ? "[TEST] " : ""}Booking declined · ${booking.arrival} → ${booking.departure}`,
    html,
    text: `Hi ${booking.guestName},\n\nUnfortunately we cannot accept your booking request for ${booking.arrival} → ${booking.departure}.${booking.cancelledReason ? `\n\nReason: ${booking.cancelledReason}` : ""}\n\nIf you'd like to try different dates, reply to this email or contact ${MARINA.harborMasterName} on ${MARINA.harborMasterPhone}, or email ${MARINA.publicEmail}.\n\n— ${MARINA.name}\n${MARINA.websiteUrl}`,
  });
}
