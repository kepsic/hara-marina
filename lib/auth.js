import { SignJWT, jwtVerify } from "jose";

const SESSION_COOKIE = "marina_session";
const SESSION_TTL_DAYS = 30;
const MAGIC_TTL_MIN = 15;
const BOAT_SHARE_COOKIE = "marina_boat_share";

function getSecret() {
  const s = process.env.MARINA_AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("MARINA_AUTH_SECRET must be set (>=16 chars). Generate with: openssl rand -hex 32");
  }
  return new TextEncoder().encode(s);
}

export async function signMagicToken(email, next = "/") {
  return await new SignJWT({ email, next, kind: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_TTL_MIN}m`)
    .sign(getSecret());
}

export async function verifyMagicToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.kind !== "magic" || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function signSession(email) {
  return await new SignJWT({ email, kind: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(getSecret());
}

export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.kind !== "session" || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token) {
  const maxAge = SESSION_TTL_DAYS * 24 * 3600;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const BOAT_SHARE_COOKIE_NAME = BOAT_SHARE_COOKIE;

export async function signBoatShareSession({ slug, shareId, source, expiresAtMs }) {
  const expSec = Math.floor(Number(expiresAtMs || Date.now() + 12 * 3600 * 1000) / 1000);
  return await new SignJWT({ slug, shareId, source, kind: "boat_share" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expSec)
    .sign(getSecret());
}

export async function verifyBoatShareSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.kind !== "boat_share" || !payload.slug) return null;
    return payload;
  } catch {
    return null;
  }
}

export function boatShareCookieHeader(token, expiresAtMs) {
  const maxAge = Math.max(1, Math.floor((Number(expiresAtMs) - Date.now()) / 1000));
  return `${BOAT_SHARE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearBoatShareCookieHeader() {
  return `${BOAT_SHARE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

const SETUP_TTL_MIN = 30;

/** One-shot setup token used by the boat install script to fetch its config. */
export async function signSetupToken({ email, slug, source }) {
  return await new SignJWT({ email, slug, source, kind: "setup" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SETUP_TTL_MIN}m`)
    .sign(getSecret());
}

export async function verifySetupToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.kind !== "setup" || !payload.email || !payload.slug) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Send the magic link via Resend if configured; otherwise log it server-side. */
export async function sendMagicLink({ email, link }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Hara Marina <onboarding@resend.dev>";
  if (!apiKey) {
    console.log(`[magic-link] No RESEND_API_KEY. Link for ${email}:\n${link}`);
    return { ok: true, transport: "console" };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "⚓ Hara Marina sign-in link",
      html: `<p>Click to sign in to Hara Marina:</p>
             <p><a href="${link}">${link}</a></p>
             <p>This link expires in ${MAGIC_TTL_MIN} minutes.</p>`,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("[magic-link] Resend failed:", r.status, txt);
    return { ok: false, transport: "resend", error: txt };
  }
  return { ok: true, transport: "resend" };
}
