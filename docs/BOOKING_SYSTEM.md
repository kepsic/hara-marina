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
  ]
}
```

Set via `lib/pricing.js#setPricingConfig` (no admin UI yet — use a one-off
script or `redis-cli SET hara:pricing:v1 '<json>'`).

If unset, all bookings quote at `defaultNightCents = 4000` (40 EUR/night).

## Stripe (ready, not active)

Endpoints scaffolded but return `501 Not Implemented` until both of these envs
are set:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_ENABLED=true
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Files:

- `pages/api/bookings/[id]/payment-intent.js` — create the PI
- `pages/api/stripe/webhook.js` — receive webhook events

The full Stripe code is committed inline as comments — uncomment when ready.

## Data

| Redis key             | Shape                                  |
|-----------------------|----------------------------------------|
| `hara:bookings:v1`    | array of booking objects (see `lib/bookings.js`) |
| `hara:pricing:v1`     | object (see above)                     |

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
