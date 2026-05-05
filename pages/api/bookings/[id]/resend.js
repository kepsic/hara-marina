import { verifySession, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import { isHarborMaster } from "../../../../lib/owners";
import { getBooking, updateBooking } from "../../../../lib/bookings";
import { sendBookingReceived } from "../../../../lib/email";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const session = await verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  if (!session?.email || !isHarborMaster(session.email)) {
    return res.status(403).json({ error: "harbor master role required" });
  }
  const { id } = req.query;
  const booking = await getBooking(String(id));
  if (!booking) return res.status(404).json({ error: "not found" });

  let notification = null;
  try {
    notification = await sendBookingReceived(booking);
  } catch (err) {
    notification = { error: String(err?.message || err) };
  }
  const stored = await updateBooking(booking.id, {
    notifications: {
      ...(booking.notifications || {}),
      received: { ...notification, at: new Date().toISOString(), resentBy: session.email },
    },
  });
  const ok = !!notification?.guest?.ok;
  return res.status(ok ? 200 : 502).json({ booking: stored, notification });
}
