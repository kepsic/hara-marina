-- T15: incentives, referrals & affiliate program.
create table if not exists referral_codes (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  owner_type text not null,
  owner_id uuid,
  owner_email text not null,
  reward_type text not null,
  reward_value int not null,
  reward_duration_months int default 1,
  max_uses int,
  uses_count int default 0,
  active boolean default true,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists referral_events (
  id uuid primary key default uuid_generate_v4(),
  code_id uuid references referral_codes(id),
  event_type text not null,
  referee_email text,
  referee_marina_id uuid references marinas(id),
  gmv_cents int default 0,
  reward_cents int default 0,
  stripe_transfer_id text,
  paid_out_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists affiliates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text unique not null,
  type text not null,
  stripe_account_id text,
  referral_code_id uuid references referral_codes(id),
  commission_pct int default 10,
  active boolean default true,
  created_at timestamptz default now()
);

alter table marinas add column if not exists founding_marina boolean default false;
alter table marinas add column if not exists founding_marina_number int;
alter table marinas add column if not exists referral_code text;

alter table boats add column if not exists founding_host boolean default false;
alter table boats add column if not exists founding_host_number int;

create table if not exists passport_stamps (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  marina_id uuid references marinas(id) on delete cascade,
  stamped_at timestamptz default now(),
  booking_id text,
  unique (email, marina_id)
);

create index if not exists referral_codes_code_idx on referral_codes(code);
create index if not exists referral_events_code_created_idx on referral_events(code_id, created_at);
create index if not exists passport_stamps_email_idx on passport_stamps(email);
create index if not exists passport_stamps_marina_idx on passport_stamps(marina_id);

alter table referral_codes  enable row level security;
alter table referral_events enable row level security;
alter table affiliates      enable row level security;
alter table passport_stamps enable row level security;
