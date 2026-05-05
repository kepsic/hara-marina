# Booking system

Guest-berth bookings with email notifications and Stripe-ready payment scaffolding.

## Roles

A new **harbor master** role manages bookings. They can:

- view all bookings on the calendar
- confirm / check-in / check-out / cancel
- mark as paid

Configure via env (comma-separated emails, case-insensitive):

```
MARINA_HARBORMASTERS=alice@example.com,bob@example.com
```

If `MARINA_HARBORMASTERS` is unset, the system defaults to `kepsic@gmail.com`.
Superadmins (`MARINA_SUPERADMINS`) implicitly inherit harbor-master rights.

## Email

Notifications are sent via [Resend](https://resend.com) when these envs are set:

```
RESEND_API_KEY=re_...
BOOKING_FROM_EMAIL="Vaiana harbor <bookings@yourdomain.tld>"
BOOKING_BCC=archive@yourdomain.tld          # optional
```

When `RESEND_API_KEY` is unset the helpers fall back to `console.log` so dev
environments work without paid services.

Triggers:

| Event                           | To                                 |
|---------------------------------|------------------------------------|
| Booking created (`pending`)     | guest + all harbor masters         |
| Status → `confirmed`            | guest                              |
| Status → `cancelled`            | guest                              |

## Pricing

Stored as a single Redis blob at `hara:pricing:v1`:

```json
{
  "currency": "EUR",
  "defaultNightCents": 4000,
  "perDockOverrides": { "guest-a": 5000 },
  "perBerthOverrides": { "ga-3": 6500 },
  "seasonal": [
    { "from": "2025-06-15", "to": "2025-08-31", "multiplier": 1.5 }
  ],
  "platformFeePercent": 5,
  "platformFeeFixedCents": 50
}
```

`platformFeePercent` + `platformFeeFixedCents` define the SaaS commission
(see Stripe Connect section below).

Set via `lib/pricing.js#setPricingConfig` (no admin UI yet — use a one-off
script or `redis-cli SET hara:pricing:v1 '<json>'`).

If unset, all bookings quote at `defaultNightCents = 4000` (40 EUR/night)
with a 5% + €0.50 platform fee.

## Stripe Connect (ready, not active)

The marina is the merchant of record. The SaaS owner (this platform) takes a
small `application_fee_amount` per booking — sized by `platformFeePercent` +
`platformFeeFixedCents` in the pricing config — to cover infrastructure
(Vercel, Resend, Redis, Stripe per-tx).

Money flow per booking:

```
guest card  ──charge──►  Stripe
                           ├── application_fee_amount  ──►  platform (you)
                           └── remainder              ──►  marina's connected account
```

### Setup

1. Create a Stripe **platform** account (your own); enable Connect (Express).
2. Set platform envs on Vercel:
   ```
   STRIPE_SECRET_KEY=sk_live_...               # platform key
   STRIPE_WEBHOOK_SECRET=whsec_...
   NEXT_PUBLIC_STRIPE_ENABLED=true
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
   NEXT_PUBLIC_BASE_URL=https://your.app
   ```
3. `npm i stripe` and uncomment the inline blocks in:
   - `pages/api/stripe/connect/onboard.js`
   - `pages/api/bookings/[id]/payment-intent.js`
   - `pages/api/stripe/webhook.js`
4. Configure **two** webhook endpoints in Stripe pointing at
   `/api/stripe/webhook`: one of type **Account** and one of type **Connect**.
5. Onboard each marina — POST to `/api/stripe/connect/onboard` (harbor master
   only) → returns Stripe-hosted onboarding URL → marina fills it in →
   resulting `acct_...` is saved to `hara:stripe-connect:v1`.

### Files

| File                                            | Role                              |
|-------------------------------------------------|-----------------------------------|
| `lib/stripeConnect.js`                          | marina slug → `acct_...` registry |
| `pages/api/stripe/connect/onboard.js`           | start/check Express onboarding    |
| `pages/api/bookings/[id]/payment-intent.js`     | destination charge with fee split |
| `pages/api/stripe/webhook.js`                   | platform + Connect events         |

### Preview

Even before Stripe is wired, `POST /api/bookings/[id]/payment-intent` returns
`501` with a `preview` block showing the would-be split:

```json
{ "preview": { "totalCents": 4000, "platformFeeCents": 250, "marinaPayoutCents": 3750, "currency": "EUR" } }
```

## Data

| Redis key                  | Shape                                  |
|----------------------------|----------------------------------------|
| `hara:bookings:v1`         | array of booking objects (see `lib/bookings.js`) |
| `hara:pricing:v1`          | object (see above)                     |
| `hara:stripe-connect:v1`   | `{ default?: "acct_...", "<slug>": "acct_..." }` |

## URLs

| Path                       | Audience       |
|----------------------------|----------------|
| `/`                        | public — click a green guest berth → wizard |
| `/bookings`                | harbor master only — month calendar |

## Booking lifecycle

```
pending  ─(harbormaster confirm)→  confirmed
                                       ├─(check-in)→  checked-in  ─(check-out)→ checked-out
                                       └─(cancel)──→  cancelled
pending  ─(cancel)─────────────────→  cancelled
```

Payment status is independent: `unpaid → authorized → paid` (or `refunded`).
