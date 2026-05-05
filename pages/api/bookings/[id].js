import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { isHarborMaster } from "../../../lib/owners";
import { getBooking, updateBooking, cancelBooking } from "../../../lib/bookings";
import { sendBookingConfirmed, sendBookingCancelled } from "../../../lib/email";

const ALLOWED_STATUSES = new Set(["pending", "confirmed", "checked-in", "checked-out", "cancelled"]);
const ALLOWED_PAYMENT_STATUSES = new Set(["unpaid", "authorized", "paid", "refunded"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email || !isHarborMaster(session.email)) {
    return res.status(403).json({ error: "harbor master role required" });
  }
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "GET") {
    const booking = await getBooking(id);
    if (!booking) return res.status(404).json({ error: "not found" });
    return res.status(200).json({ booking });
  }

  if (req.method === "PATCH") {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const patch = {};
    if (body.status != null) {
      if (!ALLOWED_STATUSES.has(body.status)) return res.status(400).json({ error: "invalid status" });
      patch.status = body.status;
    }
    if (body.paymentStatus != null) {
      if (!ALLOWED_PAYMENT_STATUSES.has(body.paymentStatus)) return res.status(400).json({ error: "invalid paymentStatus" });
      patch.paymentStatus = body.paymentStatus;
    }
    if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 1000);
    if (typeof body.cancelledReason === "string") patch.cancelledReason = body.cancelledReason.slice(0, 500);
    if (Number.isFinite(Number(body.priceCents))) patch.priceCents = Number(body.priceCents);

    const previous = await getBooking(id);
    if (!previous) return res.status(404).json({ error: "not found" });

    let updated;
    if (patch.status === "cancelled") {
      updated = await cancelBooking(id, patch.cancelledReason);
    } else {
      updated = await updateBooking(id, patch);
    }

    // Fire side-effects only on actual status transitions to avoid spamming.
    if (updated && previous.status !== updated.status) {
      try {
        if (updated.status === "confirmed") {
          const r = await sendBookingConfirmed(updated);
          console.log("[bookings] sendBookingConfirmed", id, r);
        } else if (updated.status === "cancelled") {
          const r = await sendBookingCancelled(updated);
          console.log("[bookings] sendBookingCancelled", id, r);
        }
      } catch (err) {
        console.error("[bookings] status-change email failed:", err);
      }
    }
    return res.status(200).json({ booking: updated });
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).end();
}
