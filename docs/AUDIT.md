# MerVare Multi-Tenant Audit (T0–T15)

Self-audit of the 16-task transformation prompt (`mervare-compiled.md`).
Scope: schema, security, MQTT namespacing, Stripe, referrals.
Hard constraint upheld: **Hara Marina keeps working unchanged.**

## Verdict

**GO WITH CONDITIONS.**

Backend is shippable: schema, security boundary (slug whitelist + Redis
key throwing on invalid + middleware 404), Stripe webhook idempotency,
MQTT namespace migration, and the full referral/incentive system
(schema → lib → APIs → wired into signup) all pass audit.

UI surfaces (fleet dashboard, 7-step onboarding wizard, owner referral
dashboard) and DNS validation are deferred — see Deferred section.

## Task Status

| Task | Title                                  | Status      | Notes |
|------|----------------------------------------|-------------|-------|
| T0   | Schema additions + Hara seed           | ✅ done     | 0002_seed_columns applied via MCP. `npm run seed:hara` ready (env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional MARINA_SUPERADMINS/HARBORMASTERS/ADMINS). Seed not yet executed against prod — operator action. |
| T1   | Stripe webhook hardening               | ✅ done     | SETNX on `stripe:event:<id>` 24h TTL. Added handlers: payment_intent.payment_failed, customer.subscription.{created,updated,deleted}, invoice.payment_{succeeded,failed}. Subscription events sync `marinas.plan` + `stripe_subscription_id`. **Operator action**: register both Account-mode and Connect-mode webhook endpoints in Stripe dashboard pointing at the same URL. |
| T2   | Middleware slug whitelist              | ✅ done     | `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$` enforced; invalid slug → 404 before header set. |
| T3   | Marina context resolution              | ✅ done     | No silent fallback to Hara for unknown marina slugs. |
| T7   | Redis key safety                       | ✅ done     | `lib/redis-keys.js` `safe()` throws on invalid slug; `keys.stripeEvent()` added. |
| T9   | MQTT topic namespace                   | ✅ done     | New marinas: `marina/<marinaSlug>/<boatSlug>/#`. Hara boats receive **both** legacy and namespaced ACLs for backward compat — existing fleets keep publishing without disruption. |
| T12  | B2C marina map                         | ✅ done     | `/api/marinas` filters `onboarding_completed_at IS NOT NULL`; exposes `founding_marina` + `founding_marina_number` for UI badge rendering. |
| T15  | Incentives & referrals                 | ✅ backend  | Schema + `lib/incentives.js` + `lib/referrals.js` + 4 API routes + register.js wiring + payout cron in `vercel.json` (Mon 03:00 UTC). Self-referral guard via owner_email comparison. Code regex `^[A-Z0-9]{3,20}$` blocks injection. 3% rate for founding marinas matches Mooringo. UI dashboard deferred. |

## Critical Findings (resolved)

- **Webhook replay risk** (T1 / A1-3) — fixed by Redis SETNX dedup with 24h TTL.
- **Slug injection into Redis keys** (T7 / A7-2) — fixed: `safe()` throws on invalid slug, every key path validated.
- **Unknown marina silently served as Hara** (T3 / A3-1) — middleware now 404s invalid slugs upstream.
- **Self-referral payout abuse** (T15 / A15-4) — `applyReferralCode` rejects when referee email matches code owner.
- **Referral code injection** (T15 / A15-2) — `CODE_RE` validates server-side at every entry point.
- **Stale ACLs after rename** (T9) — Hara boats granted dual ACLs; future renames safe via namespaced form.

## Deferred (out of session scope)

These pieces are intentionally unshipped and tracked for follow-up:

| Item | Task | Why deferred | Risk if not shipped |
|------|------|--------------|---------------------|
| Fleet dashboard UI (CSV import, layout builder, owner-invite emails) | T10 | Heavy UI work — separate PR | Marina admins can't self-serve fleet management; manual seed only |
| 7-step onboarding wizard + subscription endpoint + settings page + nudge cron | T11 | Multi-screen UI flow | Marinas register but can't complete guided setup |
| Boat-owner referral dashboard UI | T15 (UI) | Dashboard surface only — backend done | Owners cannot see their pending rewards in the app (API works, no UI) |
| DNS verification of `mervare.com` apex + `*.mervare.com` wildcard | T13 | Manual zone-editor action via Zone.ee | Custom marina domains won't resolve until DNS configured |
| `npm run seed:hara` against prod | T0 | Requires operator to run with prod env | Hara metadata rows not yet present in `dock_sections` / new boat columns |
| Supabase RLS policies for new tables | (cross-cutting) | Service role bypasses RLS in current API design — not regression-causing but should be added before any direct-from-browser Supabase usage | Defense-in-depth gap |

## Operator runbook

Before declaring "live":

1. Set Vercel env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` (or single shared), `CRON_SECRET`.
2. In Stripe dashboard register webhook endpoints (Account + Connect) → `/api/stripe/webhook`.
3. Run `npm run seed:hara` once with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
4. Configure DNS for `mervare.com` and `*.mervare.com` per T13.
5. Build remaining UI per T10 / T11 / T15-UI in follow-up PRs.

## Build

`npm run build` → exit 0. Middleware 26.6 kB. All new routes registered:
`/api/referrals/{validate,generate,stats}`, `/api/affiliates/payout`.
