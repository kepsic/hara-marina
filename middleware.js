import { NextResponse } from "next/server";

/**
 * Subdomain routing for the multi-tenant MerVare platform.
 *
 * Behaviour:
 *   - hara.mervare.app      → x-marina-slug=hara  (per-marina dashboard)
 *   - mervare.app           → no header, root B2C discovery map
 *   - localhost / Vercel preview → optional ?marina=slug query for local dev,
 *     otherwise no header (root mode).
 *   - hara-marina.mereveer.ee / hara-marina.vercel.app → DEFAULT_MARINA_SLUG
 *     env, so the legacy single-tenant deploy keeps working unchanged.
 *
 * The slug is injected as a request header so getServerSideProps can read
 * it via req.headers["x-marina-slug"].
 */

// Hosts that should NOT be treated as marina subdomains. Anything else under
// mervare.app (or any custom mervare-* domain) is a marina slug.
const ROOT_HOSTNAMES = new Set([
  "mervare.app",
  "www.mervare.app",
  "mervare.io",
  "www.mervare.io",
]);

// Marketing-site hosts: the root path "/" is rewritten to /marketing so
// mervare.io shows the landing page instead of the discovery map. The
// product surface (discovery map, signup wizard, marina dashboards) lives
// under mervare.app.
const MARKETING_HOSTNAMES = new Set([
  "mervare.io",
  "www.mervare.io",
]);

const LEGACY_HOSTNAMES = new Set([
  "hara-marina.mereveer.ee",
  "hara-marina.vercel.app",
]);

function extractSlug(host) {
  if (!host) return null;
  const lower = host.toLowerCase().split(":")[0];

  // Legacy single-tenant deployments → fall through to DEFAULT_MARINA_SLUG.
  if (LEGACY_HOSTNAMES.has(lower)) return null;

  // Root product / marketing domains → no slug, render discovery view.
  if (ROOT_HOSTNAMES.has(lower)) return null;

  // Local dev / Vercel preview → no slug from host. dev can still pass
  // ?marina=hara for testing.
  if (lower === "localhost" || lower.endsWith(".vercel.app") || lower.endsWith(".local")) {
    return null;
  }

  // mervare.app subdomain pattern: <slug>.mervare.app
  if (lower.endsWith(".mervare.app")) {
    return lower.slice(0, -".mervare.app".length) || null;
  }

  // Any other custom domain: take the leftmost label as the marina slug,
  // unless the apex itself is registered (single-marina custom domain — left
  // for a future reverse lookup table).
  const parts = lower.split(".");
  if (parts.length >= 3) return parts[0] || null;
  return null;
}

// Whitelist for marina slugs. Prevents Redis/MQTT key injection by ensuring
// the slug can only ever contain lowercase alphanumerics + hyphens.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function middleware(req) {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];

  // Marketing landing on mervare.io: rewrite "/" → "/marketing" so the
  // discovery map (mervare.app behaviour) doesn't leak onto the .io apex.
  // Everything else (e.g. /onboard, /login, /api/*) stays as-is.
  if (MARKETING_HOSTNAMES.has(host) && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/marketing";
    return NextResponse.rewrite(url);
  }

  const slug = extractSlug(host);
  if (!slug) return NextResponse.next();

  // Invalid subdomain → hard 404 instead of leaking it into the app.
  if (!SLUG_RE.test(slug)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const headers = new Headers(req.headers);
  headers.set("x-marina-slug", slug);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/stripe/webhook|_next/static|_next/image|favicon.ico).*)"],
};
