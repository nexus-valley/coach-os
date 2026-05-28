-- Module 40: Billing, subscription, and plan management foundation
-- Additive only. Run after Module 29 plan enforcement and Module 30 billing foundation.

alter table public.subscriptions
add column if not exists provider text,
add column if not exists provider_subscription_id text,
add column if not exists cancel_at_period_end boolean not null default false,
add column if not exists current_period_start timestamptz,
add column if not exists current_period_end timestamptz,
add column if not exists trial_ends_at timestamptz,
add column if not exists metadata_json jsonb not null default '{}'::jsonb;

alter table public.tenants
add column if not exists billing_status text,
add column if not exists billing_email text,
add column if not exists billing_gst_number text,
add column if not exists billing_address_json jsonb not null default '{}'::jsonb,
add column if not exists feature_flags_json jsonb not null default '{}'::jsonb;

update public.subscriptions
set
  cancel_at_period_end = coalesce(cancel_at_period_end, false),
  metadata_json = coalesce(metadata_json, '{}'::jsonb)
where cancel_at_period_end is null
   or metadata_json is null;

update public.tenants
set
  billing_address_json = coalesce(billing_address_json, '{}'::jsonb),
  feature_flags_json = coalesce(feature_flags_json, '{}'::jsonb)
where billing_address_json is null
   or feature_flags_json is null;

create index if not exists subscriptions_provider_subscription_idx
on public.subscriptions (provider, provider_subscription_id)
where provider_subscription_id is not null;

create index if not exists subscriptions_tenant_current_period_end_idx
on public.subscriptions (tenant_id, current_period_end);

