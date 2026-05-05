import { verifySession, SESSION_COOKIE_NAME } from "../../../lib/auth";
import { isHarborMaster } from "../../../lib/owners";
import { listBookings, createBooking } from "../../../lib/bookings";
import { sendBookingReceived } from "../../../lib/email";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    // Listing bookings is harbor-master only — guests don't get a registry view.
    const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!session?.email || !isHarborMaster(session.email)) {
      return res.status(403).json({ error: "harbor master role required" });
    }
    const { slug, berth, status, from, to } = req.query;
    const items = await listBookings({
      marinaSlug: slug || undefined,
      berthId: berth || undefined,
      status: status || undefined,
      fromIso: from || undefined,
      toIso: to || undefined,
    });
    return res.status(200).json({ items });
  }

  if (req.method === "POST") {
    // Public endpoint — anyone can request a guest berth.
    const body = req.body && typeof req.body === "object" ? req.body : {};
    try {
      const booking = await createBooking(body);
      // Fire-and-don't-block so a transient email outage never blocks the booking
      // from landing in the harbor master's queue.
      sendBookingReceived(booking).catch((err) => {
        console.error("[bookings] sendBookingReceived failed:", err);
      });
      return res.status(201).json({ booking });
    } catch (err) {
      const code = err?.code === "UNAVAILABLE" ? 409
        : err?.code?.startsWith("BAD_") ? 400
        : 500;
      return res.status(code).json({ error: err.message, code: err.code || "ERROR" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).end();
}
