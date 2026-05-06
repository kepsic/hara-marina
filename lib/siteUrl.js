// Resolve the public absolute base URL for use in og:image / canonical links.
//
// Order:
//   1. The inbound request's own host (so each marina subdomain — hara.mervare.app,
//      mervare.app, branch previews — gets a correct self-referential OG image
//      with no env-var coupling).
//   2. MARINA_PUBLIC_URL > NEXT_PUBLIC_SITE_URL > NEXT_PUBLIC_BASE_URL.
//   3. VERCEL_URL (auto-injected on Vercel).
//   4. Hard fallback to https://hara.mervare.app.
//
// We *defensively* sanitize whatever we resolve, because in the past stray
// newline characters in env vars (`MARINA_PUBLIC_URL=https://foo.app\n`) and
// stale legacy hostnames (`hara-marina.mereveer.ee`) leaked into og:image meta
// tags and broke every share preview — scrapers got URLs with an embedded
// newline, or a host that no longer resolves.

const LEGACY_HOSTS = new Set([
  "hara-marina.mereveer.ee",
  "hara-marina.vercel.app",
]);

function sanitize(raw) {
  if (!raw) return "";
  // Strip ALL whitespace anywhere in the string — env vars frequently end up
  // with trailing newlines, and a newline inside a meta-tag attribute breaks
  // every social scraper.
  const s = String(raw).replace(/\s+/g, "").replace(/\/+$/, "");
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (LEGACY_HOSTS.has(u.hostname)) return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

export function siteUrlFromReq(req) {
  // 1. self-referential URL from the inbound request — most accurate.
  if (req?.headers) {
    const proto =
      (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() ||
      "https";
    const host =
      (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
    const fromReq = sanitize(`${proto}://${host}`);
    if (fromReq) return fromReq;
  }

  // 2. explicit env vars.
  const fromEnv =
    sanitize(process.env.MARINA_PUBLIC_URL) ||
    sanitize(process.env.NEXT_PUBLIC_SITE_URL) ||
    sanitize(process.env.NEXT_PUBLIC_BASE_URL);
  if (fromEnv) return fromEnv;

  // 3. Vercel deployment URL.
  if (process.env.VERCEL_URL) {
    const fromVercel = sanitize(`https://${process.env.VERCEL_URL}`);
    if (fromVercel) return fromVercel;
  }

  // 4. last-ditch fallback so og:image is never empty.
  return "https://hara.mervare.app";
}

// Build an absolute URL to the dynamic OG image endpoint.
// Pass in plain strings; this helper handles encoding so callers don't
// double-encode anything.
export function ogImageUrl(base, { title, subtitle, badge, hero } = {}) {
  const root = sanitize(base) || "https://hara.mervare.app";
  const qs = new URLSearchParams();
  if (title) qs.set("title", title);
  if (subtitle) qs.set("subtitle", subtitle);
  if (badge) qs.set("badge", badge);
  // Only forward an http(s) hero URL — anything else would just bloat the
  // query string and be rejected by /api/og anyway.
  if (hero && /^https?:\/\//i.test(String(hero))) qs.set("hero", String(hero));
  return `${root}/api/og?${qs.toString()}`;
}
