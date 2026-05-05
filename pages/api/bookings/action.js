/**
 * One-click harbor-master endpoint hit from the booking-received email.
 *
 *   GET /api/bookings/action?token=<jwt>&reason=<optional reject text>
 *
 * The JWT is signed with kind=booking_action and binds {bookingId, action}, so
 * forging a different action against the same booking is not possible. After
 * applying the state transition we send the appropriate guest email
 * (welcome / regrets) and render a small HTML confirmation page so the harbor
 * master sees a clear result in their browser.
 */

import { verifyBookingActionToken } from "../../../lib/auth";
import { getBooking, updateBooking } from "../../../lib/bookings";
import { sendBookingConfirmed, sendBookingCancelled } from "../../../lib/email";

function page({ title, body, color = "#0c1d2c" }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#081723;color:#dcecf5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
      .card{background:${color};border-radius:8px;padding:32px;max-width:520px;box-shadow:0 8px 30px rgba(0,0,0,0.4);}
      h1{margin:0 0 12px;font-size:22px;}
      p{line-height:1.5;color:#9fc2da;}
      a{color:#7eabc8;}
    </style></head>
    <body><div class="card">${body}</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const token = String(req.query.token || "");
  const payload = await verifyBookingActionToken(token);
  if (!payload) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page({
      title: "Link expired",
      color: "#3a1a1a",
      body: `<h1>Link expired or invalid</h1>
        <p>This action link is no longer valid. Open the bookings dashboard to manage this booking manually.</p>
        <p><a href="/bookings">Open bookings dashboard →</a></p>`,
    }));
  }

  const booking = await getBooking(payload.bookingId);
  if (!booking) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page({
      title: "Booking not found",
      color: "#3a1a1a",
      body: `<h1>Booking not found</h1><p>It may have been deleted.</p>
        <p><a href="/bookings">Open bookings dashboard →</a></p>`,
    }));
  }

  // If the booking is already in a terminal state, treat the click as idempotent
  // rather than blowing up — the harbor master may have clicked twice.
  if (payload.action === "approve" && booking.status === "confirmed") {
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page({
      title: "Already confirmed",
      body: `<h1>✅ Already confirmed</h1>
        <p>${booking.guestName} · ${booking.berthLabel || booking.berthId} · ${booking.arrival} → ${booking.departure}</p>
        <p><a href="/bookings">Open bookings dashboard →</a></p>`,
    }));
  }
  if (payload.action === "reject" && booking.status === "cancelled") {
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page({
      title: "Already cancelled",
      body: `<h1>❌ Already cancelled</h1>
        <p>${booking.guestName} · ${booking.berthLabel || booking.berthId} · ${booking.arrival} → ${booking.departure}</p>
        <p><a href="/bookings">Open bookings dashboard →</a></p>`,
    }));
  }
  if (booking.status !== "pending") {
    res.status(409).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page({
      title: "Status conflict",
      color: "#3a2a1a",
      body: `<h1>⚠ Cannot ${payload.action}</h1>
        <p>This booking is currently <b>${booking.status}</b>. Use the dashboard to change it.</p>
        <p><a href="/bookings">Open bookings dashboard →</a></p>`,
    }));
  }

  if (payload.action === "approve") {
    const updated = await updateBooking(booking.id, { status: "confirmed" });
    let mail = null;
    try { mail = await sendBookingConfirmed(updated); }
    catch (err) { mail = { ok: false, error: String(err?.message || err) }; }
    await updateBooking(booking.id, {
      notifications: {
        ...(updated.notifications || {}),
        confirmed: { ...mail, at: new Date().toISOString() },
      },
    });
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page({
      title: "Booking confirmed",
      color: "#0e2a1c",
      body: `<h1>✅ Booking confirmed</h1>
        <p>A welcome email was sent to <b>${booking.guestName}</b> &lt;${booking.email}&gt;.</p>
        <p>${booking.berthLabel || booking.berthId} · ${booking.arrival} → ${booking.departure}</p>
        <p><a href="/bookings">Open bookings dashboard →</a></p>`,
    }));
  }

  if (payload.action === "reject") {
    const reason = String(req.query.reason || "").slice(0, 500);
    const updated = await updateBooking(booking.id, {
      status: "cancelled",
      cancelledReason: reason || "Booking declined by harbor master",
    });
    let mail = null;
    try { mail = await sendBookingCancelled(updated); }
    catch (err) { mail = { ok: false, error: String(err?.message || err) }; }
    await updateBooking(booking.id, {
      notifications: {
        ...(updated.notifications || {}),
        cancelled: { ...mail, at: new Date().toISOString() },
      },
    });
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(page({
      title: "Booking declined",
      color: "#2a1a1a",
      body: `<h1>❌ Booking declined</h1>
        <p>A polite cancellation email was sent to <b>${booking.guestName}</b> &lt;${booking.email}&gt;.</p>
        <p>${booking.berthLabel || booking.berthId} · ${booking.arrival} → ${booking.departure}</p>
        <p><a href="/bookings">Open bookings dashboard →</a></p>`,
    }));
  }

  res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(page({ title: "Unknown action", body: `<h1>Unknown action</h1>` }));
}
