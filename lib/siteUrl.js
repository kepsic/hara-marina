// Resolve the public absolute base URL for use in og:image / canonical links.
// Order: explicit MARINA_PUBLIC_URL > NEXT_PUBLIC_SITE_URL > NEXT_PUBLIC_BASE_URL >
// VERCEL_URL (auto-injected on Vercel) > the request's own host.
//
// `req` is optional but recommended in getServerSideProps so preview / branch
// deploys produce correct absolute URLs even without env vars.
export function siteUrlFromReq(req) {
  const env =
    process.env.MARINA_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL;
  if (env) return stripTrailing(env);

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  if (req) {
    const proto =
      (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() ||
      "https";
    const host =
      (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
    if (host) return `${proto}://${host}`;
  }

  return "https://hara.mervare.app";
}

function stripTrailing(u) {
  return u.replace(/\/+$/, "");
}

// Build an absolute URL to the dynamic OG image endpoint.
// Pass in plain strings; this helper handles encoding so callers don't
// double-encode anything.
export function ogImageUrl(base, { title, subtitle, badge } = {}) {
  const root = stripTrailing(base || "https://hara.mervare.app");
  const qs = new URLSearchParams();
  if (title) qs.set("title", title);
  if (subtitle) qs.set("subtitle", subtitle);
  if (badge) qs.set("badge", badge);
  return `${root}/api/og?${qs.toString()}`;
}
