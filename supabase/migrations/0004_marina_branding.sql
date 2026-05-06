-- T11 marina branding fields used by the onboarding wizard.
alter table marinas add column if not exists brand_color text default '#1e6fa8';
alter table marinas add column if not exists tagline text;
alter table marinas add column if not exists logo_url text;
