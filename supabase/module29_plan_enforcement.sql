-- Module 29: Workspace plan enforcement and usage tracking
-- Additive only. Run after Module 20 subscription foundation.

alter table public.tenants
add column if not exists trial_started_at timestamptz default now(),
add column if not exists trial_ends_at timestamptz default (now() + interval '14 days'),
add column if not exists is_trial_active boolean not null default true,
add column if not exists plan_limits_json jsonb not null default '{}'::jsonb,
add column if not exists usage_snapshot_json jsonb not null default '{}'::jsonb;

update public.tenants
set
  trial_started_at = coalesce(trial_started_at, now()),
  trial_ends_at = coalesce(trial_ends_at, now() + interval '14 days'),
  is_trial_active = coalesce(is_trial_active, true),
  plan_limits_json = coalesce(plan_limits_json, '{}'::jsonb),
  usage_snapshot_json = coalesce(usage_snapshot_json, '{}'::jsonb)
where trial_started_at is null
   or trial_ends_at is null
   or is_trial_active is null
   or plan_limits_json is null
   or usage_snapshot_json is null;
