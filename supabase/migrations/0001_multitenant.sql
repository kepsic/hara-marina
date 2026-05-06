-- MerVare multi-tenant schema (0001).
--
-- Adds the relational backbone the new code expects:
--   marinas             — one row per tenant (slug = subdomain on mervare.app)
--   marina_members      — many-to-many: which emails have which role at which marina
--   boats               — boats owned by a marina (replaces hard-coded INITIAL_BOATS)
--   pedestal_berths     — physical shore-power channels (1-4 per pedestal)
--   power_tokens        — paid pedestal sessions with a Stripe payment intent
--
-- Hara Marina seed: a single row in `marinas` so the existing slug
-- resolution in lib/marinaContext.js can fall back to a real DB row
-- once new code is live. Everything else (bookings, pricing, layout)
-- still lives in Redis under hara:* keys.
--
-- RLS: enabled on every table; the service role used by the Next.js
-- API bypasses it. Anon access is read-only on `marinas` (for the B2C
-- discovery map) and otherwise forbidden.

create extension if not exists "uuid-ossp";

create table if not exists marinas (
  id            uuid primary key default uuid_generate_v4(),
  slug          text unique not null,
  name          text not null,
  country       text,
  lat           double precision,
  lon           double precision,
  status        text not null default 'active',  -- active|suspended|trial
  stripe_account_id text,
  contact_email text,
  website       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists marinas_status_idx on marinas (status);

create table if not exists marina_members (
  marina_id   uuid not null references marinas(id) on delete cascade,
  email       text not null,
  role        text not null,                    -- admin|harbor_master|owner|viewer
  invited_by  text,
  created_at  timestamptz not null default now(),
  primary key (marina_id, email, role)
);

create index if not exists marina_members_email_idx on marina_members (email);

create table if not exists boats (
  id          uuid primary key default uuid_generate_v4(),
  marina_id   uuid not null references marinas(id) on delete cascade,
  slug        text not null,
  name        text not null,
  loa_m       numeric(5,2),
  beam_m      numeric(5,2),
  draft_m     numeric(5,2),
  mmsi        bigint,
  owner_email text,
  status      text not null default 'active',   -- active|archived
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (marina_id, slug)
);

create index if not exists boats_marina_idx on boats (marina_id);
create index if not exists boats_owner_email_idx on boats (owner_email);

create table if not exists pedestal_berths (
  id           uuid primary key default uuid_generate_v4(),
  marina_id    uuid not null references marinas(id) on delete cascade,
  berth_id     text not null,                   -- matches marina-layout berth.id
  pedestal_id  text not null,                   -- physical pedestal label
  channel      smallint not null check (channel between 1 and 4),
  amperage     smallint not null default 16,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (marina_id, berth_id)
);

create index if not exists pedestal_berths_marina_idx on pedestal_berths (marina_id);

create table if not exists power_tokens (
  id                  uuid primary key default uuid_generate_v4(),
  marina_id           uuid not null references marinas(id) on delete cascade,
  berth_id            text not null,
  email               text not null,
  amount_cents        integer not null,
  stripe_payment_intent text,
  status              text not null default 'pending', -- pending|paid|active|expired|refunded
  expires_at          timestamptz,
  activated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists power_tokens_marina_idx on power_tokens (marina_id);
create index if not exists power_tokens_email_idx on power_tokens (email);
create index if not exists power_tokens_status_idx on power_tokens (status);

-- Auto-update updated_at -----------------------------------------------------

create or replace function tg_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists marinas_set_updated_at on marinas;
create trigger marinas_set_updated_at before update on marinas
  for each row execute function tg_set_updated_at();

drop trigger if exists boats_set_updated_at on boats;
create trigger boats_set_updated_at before update on boats
  for each row execute function tg_set_updated_at();

drop trigger if exists power_tokens_set_updated_at on power_tokens;
create trigger power_tokens_set_updated_at before update on power_tokens
  for each row execute function tg_set_updated_at();

-- Row Level Security ---------------------------------------------------------
-- The Next.js API uses the service role key, which bypasses RLS. These
-- policies exist so accidental anon usage of the public anon key cannot
-- read or mutate tenant data.

alter table marinas        enable row level security;
alter table marina_members enable row level security;
alter table boats          enable row level security;
alter table pedestal_berths enable row level security;
alter table power_tokens   enable row level security;

-- Public can read active marinas (B2C discovery map)
drop policy if exists marinas_public_read on marinas;
create policy marinas_public_read on marinas
  for select using (status = 'active');

-- Everything else: deny by default. Service role bypasses RLS.

-- Seed Hara Marina row (idempotent) -----------------------------------------

insert into marinas (slug, name, country, lat, lon, contact_email, website)
values ('hara', 'Hara Marina', 'EE', 59.5881, 25.6124, 'info@harasadam.ee', 'https://harasadam.ee')
on conflict (slug) do nothing;
