-- T0/T10/T11 schema additions: align with seed expectations and onboarding.
alter table marinas add column if not exists timezone text default 'Europe/Tallinn';
alter table marinas add column if not exists plan text default 'free';
alter table marinas add column if not exists active boolean default true;
alter table marinas add column if not exists onboarding_step int default 1;
alter table marinas add column if not exists onboarding_completed_at timestamptz;
alter table marinas add column if not exists stripe_customer_id text;
alter table marinas add column if not exists stripe_subscription_id text;

update marinas set active = (status = 'active') where active is null;

alter table boats add column if not exists section text;
alter table boats add column if not exists color text;
alter table boats add column if not exists no_battery boolean default false;
alter table boats add column if not exists active boolean default true;
alter table boats add column if not exists onboarding_status text default 'pending';
alter table boats add column if not exists mqtt_username text;

update boats set active = (status = 'active') where active is null;

create table if not exists dock_sections (
  id uuid primary key default uuid_generate_v4(),
  marina_id uuid references marinas(id) on delete cascade,
  label text not null,
  sort_order int default 0,
  created_at timestamptz default now(),
  unique (marina_id, label)
);

create table if not exists berths (
  id uuid primary key default uuid_generate_v4(),
  marina_id uuid references marinas(id) on delete cascade,
  section_id uuid references dock_sections(id) on delete cascade,
  berth_label text not null,
  loa_max_m double precision,
  beam_max_m double precision,
  depth_m double precision,
  has_power boolean default false,
  has_water boolean default false,
  sort_order int default 0
);

create table if not exists marina_events (
  id uuid primary key default uuid_generate_v4(),
  marina_id uuid references marinas(id) on delete cascade,
  event text not null,
  actor_email text,
  meta jsonb,
  created_at timestamptz default now()
);

alter table dock_sections enable row level security;
alter table berths enable row level security;
alter table marina_events enable row level security;
