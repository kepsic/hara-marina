# MerVare Deployment

This document covers wiring `mervare.app` (primary brand) and `mervare.io`
(redirect alias) onto the existing Vercel project, plus DNS records for
the Zone.ee–hosted root zones.

The existing `harasadam.ee` deployment is unaffected — Hara Marina
remains the canonical demo tenant and continues to serve from its
existing Vercel domain assignment.

## 1. Domain assignments in Vercel

Add the following domains to the **mervare** Vercel project (settings →
Domains):

| Domain                | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `mervare.app`         | Public B2C discovery map (root)             |
| `*.mervare.app`       | Per-marina subdomains (e.g. `hara`, `alpha`)|
| `mervare.io`          | Brand alias → 308 redirect to `mervare.app` |
| `harasadam.ee`        | Legacy Hara Marina (already attached)       |

Vercel will issue Let's Encrypt certificates automatically for all four,
including the wildcard. No additional configuration is required for the
wildcard — Vercel routes any subdomain through `middleware.js`, which
extracts the slug from the `Host` header and sets the `x-marina-slug`
request header consumed by `lib/marinaContext.js`.

For the `mervare.io` redirect, configure it as a **Redirect** domain
pointing at `mervare.app` (Vercel's "Add Domain" → "Redirect to another
domain" option, 308 permanent).

## 2. DNS records (Zone.ee control panel)

### `mervare.app`

| Type  | Host  | Value                  | TTL  |
| ----- | ----- | ---------------------- | ---- |
| A     | `@`   | `76.76.21.21`          | 300  |
| CNAME | `*`   | `cname.vercel-dns.com` | 300  |
| CNAME | `www` | `cname.vercel-dns.com` | 300  |

### `mervare.io`

| Type  | Host  | Value                  | TTL  |
| ----- | ----- | ---------------------- | ---- |
| A     | `@`   | `76.76.21.21`          | 300  |
| CNAME | `www` | `cname.vercel-dns.com` | 300  |

After saving, verify each domain in Vercel — propagation typically
completes within a few minutes for Zone.ee.

## 3. Onboarding a new marina

Once `*.mervare.app` is wired, no DNS work is required to launch a new
marina. The flow is:

1. Operator visits `https://mervare.app/marina-signup` and submits the
   form (slug, name, location, admin email).
2. `pages/api/marinas/register.js` inserts a row into Supabase
   `marinas`, creates `marina_members` rows for the admin and harbor
   master, and sends a welcome email via Resend.
3. The new tenant is immediately reachable at
   `https://<slug>.mervare.app`. The middleware sets `x-marina-slug`
   and the existing dashboard renders against that tenant's data.

## 4. SEO scoping

`next.config.mjs` sends `X-Robots-Tag: noindex` on **every host except**
`mervare.app` and `mervare.io`. This means:

- Per-marina dashboards (`hara.mervare.app`, etc.) stay private from
  search engines — they contain operator-only data and live boat
  positions.
- The MerVare landing page and `/marina-signup` are crawlable.
- The legacy `harasadam.ee` host continues to be `noindex`, matching
  prior behaviour.

If you ever want a marina to be publicly indexed, add a per-host
override in `next.config.mjs` headers.

## 5. Environment variables (Vercel project)

The following must be set on the **mervare** project in addition to
the existing Hara variables:

| Variable                  | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_BASE_URL`    | `https://mervare.app` (used for Stripe returns)  |
| `DEFAULT_MARINA_SLUG`     | `hara` (preserves legacy Redis keys)             |
| `STRIPE_SECRET_KEY`       | Platform Stripe Connect key                      |
| `STRIPE_WEBHOOK_SECRET`   | From `stripe listen` / dashboard webhook        |
| `STRIPE_DEFAULT_COUNTRY`  | `EE` (Express account default)                   |
| `POWER_PRICE_CENTS_PER_KWH` | `35` (default; per-marina override later)      |
| `SUPABASE_URL`            | Same as Hara                                     |
| `SUPABASE_SERVICE_ROLE`   | Same as Hara                                     |
| `KV_REST_API_URL`         | Same as Hara (single Vercel KV instance)         |
| `KV_REST_API_TOKEN`       | Same as Hara                                     |
| `EMQX_DASHBOARD_URL`      | `https://<broker>:18083` (for power publishes)  |
| `EMQX_DASHBOARD_TOKEN`    | API key for HTTP publish                         |

## 6. Smoke test after DNS propagates

```bash
# B2C landing
curl -I https://mervare.app/                   # 200, indexable
# Per-marina subdomain
curl -I https://hara.mervare.app/              # 200, x-robots-tag: noindex
# Subdomain → slug header sanity
curl -s https://hara.mervare.app/api/marinas | jq '.[0].slug'
# Stripe webhook reachability (replaces hara-only endpoint)
curl -I https://mervare.app/api/stripe/webhook # 405 (method not allowed)
```

If `harasadam.ee` continues to serve the existing Hara dashboard
without changes, the migration is safe.
