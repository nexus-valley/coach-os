-- Module 71.7F2: Multi-Currency Subscription Plan Catalog & Entitlement Foundation
--
-- Review before execution. Do not execute automatically.
--
-- Scope:
-- - Adds canonical subscription plan, pricing, usage-limit, feature-entitlement,
--   tenant assignment, override, usage snapshot/event, and upgrade request tables.
-- - Adds SECURITY DEFINER RPCs for catalog reads, platform-managed plan setup,
--   tenant entitlement reads, manual tenant assignment, usage assertion, usage
--   snapshots, upgrade requests, and platform-approved overrides.
-- - Does not force payment during onboarding.
-- - Does not connect checkout/payment gateway automation.
-- - Does not alter Module 62 tenant_feature_settings behavior.
-- - Does not backfill or assign any real tenant to a plan.
--
-- Security posture:
-- - RLS is enabled on every new table.
-- - Direct table reads/writes are not exposed to anon/authenticated.
-- - Browser/client mutations go through SECURITY DEFINER RPCs only.
-- - Platform catalog/assignment mutations are platform owner/admin only.
-- - Tenant owner/admin can read own entitlement state and request upgrades.
-- - Staff/trainer/student cannot mutate subscription/entitlement state in Phase 1.
-- - Metadata is bounded JSON object data and must not contain secrets, OTPs,
--   raw tokens, signed URLs, private storage paths, credentials, authorization
--   headers, or cookies.

begin;

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  tier_rank integer not null,
  description text,
  status text not null default 'draft',
  is_public boolean not null default false,
  trial_days integer not null default 14,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_code_key unique (code),
  constraint subscription_plans_code_check check (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint subscription_plans_name_check check (
    char_length(name) between 1 and 180
    and position('<' in name) = 0
    and position('>' in name) = 0
  ),
  constraint subscription_plans_tier_rank_check check (tier_rank > 0 and tier_rank <= 100),
  constraint subscription_plans_description_check check (
    description is null or (
      char_length(description) <= 1000
      and position('<' in description) = 0
      and position('>' in description) = 0
    )
  ),
  constraint subscription_plans_status_check check (status in ('draft', 'active', 'archived')),
  constraint subscription_plans_trial_days_check check (trial_days >= 0 and trial_days <= 365),
  constraint subscription_plans_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table if not exists public.subscription_plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans(id) on delete cascade,
  currency text not null,
  billing_cycle text not null,
  amount_minor bigint not null default 0,
  setup_fee_amount_minor bigint not null default 0,
  tax_behavior text not null default 'exclusive',
  region_code text not null default 'GLOBAL',
  status text not null default 'draft',
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plan_prices_currency_check check (currency in ('INR', 'USD', 'EUR')),
  constraint subscription_plan_prices_billing_cycle_check check (billing_cycle in ('monthly', 'yearly', 'custom')),
  constraint subscription_plan_prices_amount_check check (amount_minor >= 0 and setup_fee_amount_minor >= 0),
  constraint subscription_plan_prices_tax_behavior_check check (tax_behavior in ('exclusive', 'inclusive', 'not_applicable')),
  constraint subscription_plan_prices_region_check check (
    region_code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'
  ),
  constraint subscription_plan_prices_status_check check (status in ('draft', 'active', 'archived')),
  constraint subscription_plan_prices_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create unique index if not exists subscription_plan_prices_active_unique_idx
on public.subscription_plan_prices (plan_id, currency, billing_cycle, region_code)
where status = 'active';

create unique index if not exists subscription_plan_prices_status_unique_idx
on public.subscription_plan_prices (plan_id, currency, billing_cycle, region_code, status);

create table if not exists public.subscription_plan_usage_limits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans(id) on delete cascade,
  resource_key text not null,
  limit_value integer,
  limit_type text not null,
  enforcement_mode text not null default 'warn',
  warning_threshold_percent integer not null default 80,
  allow_platform_override boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plan_usage_limits_unique unique (plan_id, resource_key),
  constraint subscription_plan_usage_limits_resource_key_check check (
    resource_key in (
      'students',
      'courses',
      'cohorts',
      'batches',
      'admins',
      'staff_trainers',
      'team_members',
      'storage_mb',
      'document_uploads',
      'messages_monthly',
      'automation_runs_monthly',
      'ai_requests_monthly'
    )
  ),
  constraint subscription_plan_usage_limits_limit_value_check check (
    limit_value is null or limit_value >= 0
  ),
  constraint subscription_plan_usage_limits_limit_type_check check (
    limit_type in ('count', 'storage_mb', 'monthly_count', 'boolean')
  ),
  constraint subscription_plan_usage_limits_enforcement_mode_check check (
    enforcement_mode in ('none', 'warn', 'hard')
  ),
  constraint subscription_plan_usage_limits_warning_threshold_check check (
    warning_threshold_percent between 1 and 100
  ),
  constraint subscription_plan_usage_limits_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table if not exists public.subscription_plan_feature_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans(id) on delete cascade,
  feature_key text not null,
  entitlement_status text not null default 'locked',
  requires_platform_approval boolean not null default false,
  included_quota integer,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plan_feature_entitlements_unique unique (plan_id, feature_key),
  constraint subscription_plan_feature_entitlements_feature_key_check check (
    feature_key in (
      'dashboard',
      'students',
      'courses',
      'attendance',
      'assignments',
      'finance',
      'reports',
      'documents',
      'document_uploads',
      'messages',
      'crm',
      'marketing',
      'automations',
      'workflows',
      'approvals',
      'team_operations',
      'audit_compliance',
      'backup_recovery',
      'website_builder',
      'certificates',
      'payment_gateway',
      'live_classes',
      'notifications',
      'mobile_pwa',
      'ai_assistant',
      'custom_branding',
      'api_integrations',
      'community_hub'
    )
  ),
  constraint subscription_plan_feature_entitlements_status_check check (
    entitlement_status in (
      'included',
      'locked',
      'coming_soon',
      'addon',
      'platform_approval_required'
    )
  ),
  constraint subscription_plan_feature_entitlements_quota_check check (
    included_quota is null or included_quota >= 0
  ),
  constraint subscription_plan_feature_entitlements_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table if not exists public.tenant_subscription_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'trial',
  billing_cycle text not null default 'monthly',
  currency text not null default 'INR',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_period_ends_at timestamptz,
  payment_status text not null default 'not_required',
  source text not null default 'platform_manual',
  is_current boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_subscription_assignments_status_check check (
    status in ('trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled', 'expired')
  ),
  constraint tenant_subscription_assignments_billing_cycle_check check (
    billing_cycle in ('monthly', 'yearly', 'custom')
  ),
  constraint tenant_subscription_assignments_currency_check check (
    currency in ('INR', 'USD', 'EUR')
  ),
  constraint tenant_subscription_assignments_payment_status_check check (
    payment_status in ('not_required', 'unpaid', 'paid', 'overdue', 'waived')
  ),
  constraint tenant_subscription_assignments_source_check check (
    source in ('platform_manual', 'migration', 'checkout', 'system')
  ),
  constraint tenant_subscription_assignments_trial_check check (
    trial_started_at is null or trial_ends_at is null or trial_started_at <= trial_ends_at
  ),
  constraint tenant_subscription_assignments_period_check check (
    current_period_start is null or current_period_end is null or current_period_start <= current_period_end
  ),
  constraint tenant_subscription_assignments_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create unique index if not exists tenant_subscription_assignments_current_unique_idx
on public.tenant_subscription_assignments (tenant_id)
where is_current;

create table if not exists public.tenant_subscription_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  override_type text not null,
  resource_key text,
  feature_key text,
  override_value_json jsonb not null default '{}'::jsonb,
  reason text not null,
  expires_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_subscription_overrides_type_check check (
    override_type in (
      'feature_unlock',
      'feature_lock',
      'limit_raise',
      'limit_lower',
      'grace_extension',
      'price_exception'
    )
  ),
  constraint tenant_subscription_overrides_resource_key_check check (
    resource_key is null or resource_key in (
      'students',
      'courses',
      'cohorts',
      'batches',
      'admins',
      'staff_trainers',
      'team_members',
      'storage_mb',
      'document_uploads',
      'messages_monthly',
      'automation_runs_monthly',
      'ai_requests_monthly'
    )
  ),
  constraint tenant_subscription_overrides_feature_key_check check (
    feature_key is null or feature_key in (
      'dashboard',
      'students',
      'courses',
      'attendance',
      'assignments',
      'finance',
      'reports',
      'documents',
      'document_uploads',
      'messages',
      'crm',
      'marketing',
      'automations',
      'workflows',
      'approvals',
      'team_operations',
      'audit_compliance',
      'backup_recovery',
      'website_builder',
      'certificates',
      'payment_gateway',
      'live_classes',
      'notifications',
      'mobile_pwa',
      'ai_assistant',
      'custom_branding',
      'api_integrations',
      'community_hub'
    )
  ),
  constraint tenant_subscription_overrides_reason_check check (
    char_length(reason) between 1 and 1200
    and position('<' in reason) = 0
    and position('>' in reason) = 0
  ),
  constraint tenant_subscription_overrides_value_object_check check (
    jsonb_typeof(override_value_json) = 'object'
    and char_length(override_value_json::text) <= 2000
  ),
  constraint tenant_subscription_overrides_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  ),
  constraint tenant_subscription_overrides_target_check check (
    (
      override_type in ('limit_raise', 'limit_lower')
      and resource_key is not null
      and feature_key is null
    )
    or (
      override_type in ('feature_unlock', 'feature_lock')
      and feature_key is not null
      and resource_key is null
    )
    or (
      override_type in ('grace_extension', 'price_exception')
      and resource_key is null
      and feature_key is null
    )
  )
);

create table if not exists public.tenant_usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  snapshot_date date not null default current_date,
  students integer not null default 0,
  courses integer not null default 0,
  cohorts integer not null default 0,
  batches integer not null default 0,
  admins integer not null default 0,
  staff_trainers integer not null default 0,
  team_members integer not null default 0,
  storage_mb integer not null default 0,
  document_uploads integer not null default 0,
  messages_monthly integer not null default 0,
  automation_runs_monthly integer not null default 0,
  ai_requests_monthly integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tenant_usage_snapshots_unique unique (tenant_id, snapshot_date),
  constraint tenant_usage_snapshots_non_negative_check check (
    students >= 0
    and courses >= 0
    and cohorts >= 0
    and batches >= 0
    and admins >= 0
    and staff_trainers >= 0
    and team_members >= 0
    and storage_mb >= 0
    and document_uploads >= 0
    and messages_monthly >= 0
    and automation_runs_monthly >= 0
    and ai_requests_monthly >= 0
  ),
  constraint tenant_usage_snapshots_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table if not exists public.tenant_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_key text not null,
  event_type text not null,
  delta integer not null default 0,
  source text not null default 'system',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tenant_usage_events_resource_key_check check (
    resource_key in (
      'students',
      'courses',
      'cohorts',
      'batches',
      'admins',
      'staff_trainers',
      'team_members',
      'storage_mb',
      'document_uploads',
      'messages_monthly',
      'automation_runs_monthly',
      'ai_requests_monthly'
    )
  ),
  constraint tenant_usage_events_event_type_check check (
    event_type in ('snapshot', 'increment', 'decrement', 'manual_adjustment', 'limit_check')
  ),
  constraint tenant_usage_events_source_check check (
    source in ('system', 'platform', 'rpc', 'import', 'manual')
  ),
  constraint tenant_usage_events_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table if not exists public.tenant_plan_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_plan_id uuid references public.subscription_plans(id) on delete set null,
  requested_plan_code text not null,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'open',
  reason text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_plan_upgrade_requests_plan_code_check check (
    requested_plan_code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
  ),
  constraint tenant_plan_upgrade_requests_status_check check (
    status in ('open', 'in_review', 'approved', 'rejected', 'cancelled')
  ),
  constraint tenant_plan_upgrade_requests_reason_check check (
    reason is null or (
      char_length(reason) <= 1200
      and position('<' in reason) = 0
      and position('>' in reason) = 0
    )
  ),
  constraint tenant_plan_upgrade_requests_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create index if not exists subscription_plans_status_rank_idx
on public.subscription_plans (status, is_public, tier_rank);

create index if not exists subscription_plan_prices_plan_idx
on public.subscription_plan_prices (plan_id, currency, billing_cycle, status);

create index if not exists subscription_plan_usage_limits_plan_idx
on public.subscription_plan_usage_limits (plan_id, resource_key);

create index if not exists subscription_plan_feature_entitlements_plan_idx
on public.subscription_plan_feature_entitlements (plan_id, feature_key);

create index if not exists tenant_subscription_assignments_tenant_idx
on public.tenant_subscription_assignments (tenant_id, is_current);

create index if not exists tenant_subscription_assignments_status_idx
on public.tenant_subscription_assignments (status, payment_status);

create index if not exists tenant_subscription_overrides_tenant_idx
on public.tenant_subscription_overrides (tenant_id, override_type, expires_at);

create index if not exists tenant_usage_snapshots_tenant_date_idx
on public.tenant_usage_snapshots (tenant_id, snapshot_date desc);

create index if not exists tenant_usage_events_tenant_created_idx
on public.tenant_usage_events (tenant_id, created_at desc);

create index if not exists tenant_plan_upgrade_requests_tenant_status_idx
on public.tenant_plan_upgrade_requests (tenant_id, status, created_at desc);

drop trigger if exists set_subscription_plans_updated_at on public.subscription_plans;
create trigger set_subscription_plans_updated_at
before update on public.subscription_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_subscription_plan_prices_updated_at on public.subscription_plan_prices;
create trigger set_subscription_plan_prices_updated_at
before update on public.subscription_plan_prices
for each row execute function public.set_updated_at();

drop trigger if exists set_subscription_plan_usage_limits_updated_at on public.subscription_plan_usage_limits;
create trigger set_subscription_plan_usage_limits_updated_at
before update on public.subscription_plan_usage_limits
for each row execute function public.set_updated_at();

drop trigger if exists set_subscription_plan_feature_entitlements_updated_at on public.subscription_plan_feature_entitlements;
create trigger set_subscription_plan_feature_entitlements_updated_at
before update on public.subscription_plan_feature_entitlements
for each row execute function public.set_updated_at();

drop trigger if exists set_tenant_subscription_assignments_updated_at on public.tenant_subscription_assignments;
create trigger set_tenant_subscription_assignments_updated_at
before update on public.tenant_subscription_assignments
for each row execute function public.set_updated_at();

drop trigger if exists set_tenant_subscription_overrides_updated_at on public.tenant_subscription_overrides;
create trigger set_tenant_subscription_overrides_updated_at
before update on public.tenant_subscription_overrides
for each row execute function public.set_updated_at();

drop trigger if exists set_tenant_plan_upgrade_requests_updated_at on public.tenant_plan_upgrade_requests;
create trigger set_tenant_plan_upgrade_requests_updated_at
before update on public.tenant_plan_upgrade_requests
for each row execute function public.set_updated_at();

alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_prices enable row level security;
alter table public.subscription_plan_usage_limits enable row level security;
alter table public.subscription_plan_feature_entitlements enable row level security;
alter table public.tenant_subscription_assignments enable row level security;
alter table public.tenant_subscription_overrides enable row level security;
alter table public.tenant_usage_snapshots enable row level security;
alter table public.tenant_usage_events enable row level security;
alter table public.tenant_plan_upgrade_requests enable row level security;

revoke all on public.subscription_plans from anon;
revoke all on public.subscription_plan_prices from anon;
revoke all on public.subscription_plan_usage_limits from anon;
revoke all on public.subscription_plan_feature_entitlements from anon;
revoke all on public.tenant_subscription_assignments from anon;
revoke all on public.tenant_subscription_overrides from anon;
revoke all on public.tenant_usage_snapshots from anon;
revoke all on public.tenant_usage_events from anon;
revoke all on public.tenant_plan_upgrade_requests from anon;

revoke all privileges on table public.subscription_plans from public, anon, authenticated;
revoke all privileges on table public.subscription_plan_prices from public, anon, authenticated;
revoke all privileges on table public.subscription_plan_usage_limits from public, anon, authenticated;
revoke all privileges on table public.subscription_plan_feature_entitlements from public, anon, authenticated;
revoke all privileges on table public.tenant_subscription_assignments from public, anon, authenticated;
revoke all privileges on table public.tenant_subscription_overrides from public, anon, authenticated;
revoke all privileges on table public.tenant_usage_snapshots from public, anon, authenticated;
revoke all privileges on table public.tenant_usage_events from public, anon, authenticated;
revoke all privileges on table public.tenant_plan_upgrade_requests from public, anon, authenticated;

create or replace function public.subscription_entitlements_currencies()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['INR', 'USD', 'EUR']::text[];
$$;

create or replace function public.subscription_entitlements_billing_cycles()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['monthly', 'yearly', 'custom']::text[];
$$;

create or replace function public.subscription_entitlements_resource_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'students',
    'courses',
    'cohorts',
    'batches',
    'admins',
    'staff_trainers',
    'team_members',
    'storage_mb',
    'document_uploads',
    'messages_monthly',
    'automation_runs_monthly',
    'ai_requests_monthly'
  ]::text[];
$$;

create or replace function public.subscription_entitlements_feature_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'dashboard',
    'students',
    'courses',
    'attendance',
    'assignments',
    'finance',
    'reports',
    'documents',
    'document_uploads',
    'messages',
    'crm',
    'marketing',
    'automations',
    'workflows',
    'approvals',
    'team_operations',
    'audit_compliance',
    'backup_recovery',
    'website_builder',
    'certificates',
    'payment_gateway',
    'live_classes',
    'notifications',
    'mobile_pwa',
    'ai_assistant',
    'custom_branding',
    'api_integrations',
    'community_hub'
  ]::text[];
$$;

create or replace function public.subscription_entitlements_global_locked_features()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['payment_gateway', 'live_classes']::text[];
$$;

create or replace function public.subscription_entitlements_validate_json_object(
  p_value jsonb,
  p_field text,
  p_max_length integer
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value jsonb := coalesce(p_value, '{}'::jsonb);
  v_text text;
begin
  if jsonb_typeof(v_value) <> 'object' then
    raise exception '% must be a JSON object.', p_field using errcode = '22023';
  end if;

  if char_length(v_value::text) > p_max_length then
    raise exception '% is too large.', p_field using errcode = '22023';
  end if;

  v_text := lower(v_value::text);
  if v_text like '%secret%'
     or v_text like '%token%'
     or v_text like '%otp%'
     or v_text like '%cookie%'
     or v_text like '%authorization%'
     or v_text like '%password%'
     or v_text like '%credential%'
     or v_text like '%signed_url%'
     or v_text like '%storage_path%'
     or v_text like '%private_path%' then
    raise exception '% cannot contain secrets, tokens, credentials, signed URLs, or private storage paths.', p_field
      using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.subscription_entitlements_normalize_text(
  p_value text,
  p_field text,
  p_required boolean,
  p_max_length integer
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_required and v_value is null then
    raise exception '% is required.', p_field using errcode = '22023';
  end if;

  if v_value is not null and char_length(v_value) > p_max_length then
    raise exception '% is too long.', p_field using errcode = '22023';
  end if;

  if v_value is not null and (position('<' in v_value) > 0 or position('>' in v_value) > 0) then
    raise exception '% cannot contain HTML-like characters.', p_field using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.subscription_entitlements_current_role(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_tenant_id is null or auth.uid() is null then
    return null;
  end if;

  select tm.role
  into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = auth.uid()
  limit 1;

  return v_role;
end;
$$;

create or replace function public.subscription_entitlements_can_read_tenant(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_tenant_id is null or auth.uid() is null then
    return false;
  end if;

  if public.platform_current_role() in ('owner', 'admin') then
    return exists (select 1 from public.tenants t where t.id = p_tenant_id);
  end if;

  v_role := public.subscription_entitlements_current_role(p_tenant_id);
  return coalesce(v_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.subscription_entitlements_assert_platform_manager()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if coalesce(public.platform_current_role(), '') not in ('owner', 'admin') then
    raise exception 'Platform owner/admin access is required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.subscription_entitlements_assert_platform_owner_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if coalesce(public.platform_current_role(), '') not in ('owner', 'admin') then
    raise exception 'Platform owner/admin access is required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.subscription_entitlements_normalize_currency(p_currency text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_currency text := upper(trim(coalesce(p_currency, '')));
begin
  if v_currency = '' or not (v_currency = any (public.subscription_entitlements_currencies())) then
    raise exception 'Invalid currency.' using errcode = '22023';
  end if;

  return v_currency;
end;
$$;

create or replace function public.subscription_entitlements_normalize_plan_code(p_plan_code text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_code text := lower(trim(coalesce(p_plan_code, '')));
begin
  if v_code = '' or v_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'Plan code must be lowercase slug-safe text.' using errcode = '22023';
  end if;

  return v_code;
end;
$$;

create or replace function public.subscription_entitlements_normalize_resource_key(p_resource_key text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text := lower(trim(coalesce(p_resource_key, '')));
begin
  if v_key = '' or not (v_key = any (public.subscription_entitlements_resource_keys())) then
    raise exception 'Invalid resource key.' using errcode = '22023';
  end if;

  return v_key;
end;
$$;

create or replace function public.subscription_entitlements_normalize_feature_key(p_feature_key text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text := lower(trim(coalesce(p_feature_key, '')));
begin
  if v_key = '' or not (v_key = any (public.subscription_entitlements_feature_keys())) then
    raise exception 'Invalid feature key.' using errcode = '22023';
  end if;

  return v_key;
end;
$$;

create or replace function public.subscription_entitlements_latest_usage(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'snapshot_date', tus.snapshot_date,
        'students', tus.students,
        'courses', tus.courses,
        'cohorts', tus.cohorts,
        'batches', tus.batches,
        'admins', tus.admins,
        'staff_trainers', tus.staff_trainers,
        'team_members', tus.team_members,
        'storage_mb', tus.storage_mb,
        'document_uploads', tus.document_uploads,
        'messages_monthly', tus.messages_monthly,
        'automation_runs_monthly', tus.automation_runs_monthly,
        'ai_requests_monthly', tus.ai_requests_monthly
      )
      from public.tenant_usage_snapshots tus
      where tus.tenant_id = p_tenant_id
      order by tus.snapshot_date desc, tus.created_at desc
      limit 1
    ),
    '{}'::jsonb
  );
$$;

create or replace function public.subscription_entitlements_current_assignment(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'assignment_id', tsa.id,
        'tenant_id', tsa.tenant_id,
        'plan_id', tsa.plan_id,
        'plan_code', sp.code,
        'plan_name', sp.name,
        'tier_rank', sp.tier_rank,
        'status', tsa.status,
        'billing_cycle', tsa.billing_cycle,
        'currency', tsa.currency,
        'trial_started_at', tsa.trial_started_at,
        'trial_ends_at', tsa.trial_ends_at,
        'current_period_start', tsa.current_period_start,
        'current_period_end', tsa.current_period_end,
        'grace_period_ends_at', tsa.grace_period_ends_at,
        'payment_status', tsa.payment_status,
        'source', tsa.source
      )
      from public.tenant_subscription_assignments tsa
      join public.subscription_plans sp on sp.id = tsa.plan_id
      where tsa.tenant_id = p_tenant_id
        and tsa.is_current
      order by tsa.created_at desc
      limit 1
    ),
    '{}'::jsonb
  );
$$;

create or replace function public.subscription_entitlements_active_overrides(p_tenant_id uuid)
returns table (
  override_type text,
  resource_key text,
  feature_key text,
  override_value_json jsonb,
  reason text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    tso.override_type,
    tso.resource_key,
    tso.feature_key,
    tso.override_value_json,
    tso.reason,
    tso.expires_at
  from public.tenant_subscription_overrides tso
  where tso.tenant_id = p_tenant_id
    and (tso.expires_at is null or tso.expires_at > now());
$$;

create or replace function public.get_public_plan_catalog(p_currency text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text := null;
begin
  if p_currency is not null and nullif(trim(p_currency), '') is not null then
    v_currency := public.subscription_entitlements_normalize_currency(p_currency);
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'code', sp.code,
          'name', sp.name,
          'tier_rank', sp.tier_rank,
          'description', sp.description,
          'trial_days', sp.trial_days,
          'prices', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'currency', spp.currency,
                  'billing_cycle', spp.billing_cycle,
                  'amount_minor', spp.amount_minor,
                  'setup_fee_amount_minor', spp.setup_fee_amount_minor,
                  'tax_behavior', spp.tax_behavior,
                  'region_code', spp.region_code
                )
                order by spp.currency, spp.billing_cycle, spp.region_code
              )
              from public.subscription_plan_prices spp
              where spp.plan_id = sp.id
                and spp.status = 'active'
                and (v_currency is null or spp.currency = v_currency)
            ),
            '[]'::jsonb
          ),
          'usage_limits', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'resource_key', spl.resource_key,
                  'limit_value', spl.limit_value,
                  'limit_type', spl.limit_type,
                  'enforcement_mode', spl.enforcement_mode,
                  'warning_threshold_percent', spl.warning_threshold_percent
                )
                order by spl.resource_key
              )
              from public.subscription_plan_usage_limits spl
              where spl.plan_id = sp.id
            ),
            '[]'::jsonb
          ),
          'features', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'feature_key', spf.feature_key,
                  'entitlement_status', spf.entitlement_status,
                  'requires_platform_approval', spf.requires_platform_approval,
                  'included_quota', spf.included_quota
                )
                order by spf.feature_key
              )
              from public.subscription_plan_feature_entitlements spf
              where spf.plan_id = sp.id
            ),
            '[]'::jsonb
          )
        )
        order by sp.tier_rank, sp.code
      )
      from public.subscription_plans sp
      where sp.status = 'active'
        and sp.is_public
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.get_platform_plan_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.subscription_entitlements_assert_platform_manager();

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', sp.id,
          'code', sp.code,
          'name', sp.name,
          'tier_rank', sp.tier_rank,
          'description', sp.description,
          'status', sp.status,
          'is_public', sp.is_public,
          'trial_days', sp.trial_days,
          'metadata_json', sp.metadata_json,
          'created_at', sp.created_at,
          'updated_at', sp.updated_at,
          'prices', coalesce(
            (
              select jsonb_agg(to_jsonb(spp) order by spp.currency, spp.billing_cycle, spp.region_code)
              from public.subscription_plan_prices spp
              where spp.plan_id = sp.id
            ),
            '[]'::jsonb
          ),
          'usage_limits', coalesce(
            (
              select jsonb_agg(to_jsonb(spl) order by spl.resource_key)
              from public.subscription_plan_usage_limits spl
              where spl.plan_id = sp.id
            ),
            '[]'::jsonb
          ),
          'feature_entitlements', coalesce(
            (
              select jsonb_agg(to_jsonb(spf) order by spf.feature_key)
              from public.subscription_plan_feature_entitlements spf
              where spf.plan_id = sp.id
            ),
            '[]'::jsonb
          )
        )
        order by sp.tier_rank, sp.code
      )
      from public.subscription_plans sp
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.resolve_effective_feature_access(
  p_tenant_id uuid,
  p_feature_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_feature_key text := null;
  v_assignment jsonb;
  v_status text;
  v_payment_status text;
  v_plan_id uuid;
  v_result jsonb;
begin
  if p_feature_key is not null and nullif(trim(p_feature_key), '') is not null then
    v_feature_key := public.subscription_entitlements_normalize_feature_key(p_feature_key);
  end if;

  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Subscription entitlement access denied.' using errcode = '42501';
  end if;

  select tsa.status, tsa.payment_status, tsa.plan_id
  into v_status, v_payment_status, v_plan_id
  from public.tenant_subscription_assignments tsa
  where tsa.tenant_id = p_tenant_id
    and tsa.is_current
  order by tsa.created_at desc
  limit 1;

  v_assignment := public.subscription_entitlements_current_assignment(p_tenant_id);

  with feature_keys as (
    select unnest(public.subscription_entitlements_feature_keys()) as feature_key
  ),
  resolved as (
    select
      fk.feature_key,
      coalesce(spf.entitlement_status, 'locked') as plan_status,
      coalesce(spf.requires_platform_approval, false) as requires_platform_approval,
      spf.included_quota,
      tfs.status as module62_status,
      tfs.source as module62_source,
      feature_override.override_type as feature_override_type,
      feature_override.override_value_json as feature_override_value_json,
      case
        when fk.feature_key = any (public.subscription_entitlements_global_locked_features()) then 'coming_soon'
        when feature_override.override_type = 'feature_lock' then 'locked'
        when feature_override.override_type = 'feature_unlock' then 'included'
        when coalesce(
          tfs.status,
          case
            when fk.feature_key = any (public.feature_access_allowed_keys())
              then public.feature_access_default_status(fk.feature_key)
          end
        ) = 'coming_soon' then 'coming_soon'
        when coalesce(
          tfs.status,
          case
            when fk.feature_key = any (public.feature_access_allowed_keys())
              then public.feature_access_default_status(fk.feature_key)
          end
        ) in ('disabled', 'locked_by_plan') then 'locked'
        when coalesce(spf.entitlement_status, 'locked') = 'coming_soon' then 'coming_soon'
        when coalesce(spf.entitlement_status, 'locked') = 'platform_approval_required'
             and feature_override.override_type is distinct from 'feature_unlock' then 'locked'
        when coalesce(spf.entitlement_status, 'locked') = 'addon'
             and feature_override.override_type is distinct from 'feature_unlock' then 'locked'
        when coalesce(v_status, 'trial') in ('suspended', 'cancelled', 'expired') then 'locked'
        when coalesce(v_status, 'trial') = 'past_due'
             and fk.feature_key not in ('dashboard', 'students', 'courses', 'finance') then 'locked'
        else coalesce(spf.entitlement_status, 'locked')
      end as effective_status,
      case
        when fk.feature_key = any (public.subscription_entitlements_global_locked_features()) then 'global_coming_soon'
        when feature_override.override_type = 'feature_lock' then 'platform_feature_lock'
        when feature_override.override_type = 'feature_unlock' then 'platform_feature_unlock'
        when coalesce(
          tfs.status,
          case
            when fk.feature_key = any (public.feature_access_allowed_keys())
              then public.feature_access_default_status(fk.feature_key)
          end
        ) in ('coming_soon', 'disabled', 'locked_by_plan') then 'module62_status'
        when coalesce(spf.entitlement_status, 'locked') in ('coming_soon', 'addon', 'platform_approval_required') then coalesce(spf.entitlement_status, 'locked')
        when coalesce(v_status, 'trial') in ('suspended', 'cancelled', 'expired', 'past_due') then 'subscription_state'
        else 'plan'
      end as reason
    from feature_keys fk
    left join public.subscription_plan_feature_entitlements spf
      on spf.plan_id = v_plan_id
     and spf.feature_key = fk.feature_key
    left join public.tenant_feature_settings tfs
      on tfs.tenant_id = p_tenant_id
     and tfs.feature_key = fk.feature_key
    left join lateral (
      select tso.override_type, tso.override_value_json
      from public.tenant_subscription_overrides tso
      where tso.tenant_id = p_tenant_id
        and tso.feature_key = fk.feature_key
        and tso.override_type in ('feature_unlock', 'feature_lock')
        and (tso.expires_at is null or tso.expires_at > now())
      order by tso.created_at desc
      limit 1
    ) feature_override on true
    where v_feature_key is null or fk.feature_key = v_feature_key
  )
  select jsonb_build_object(
    'tenant_id', p_tenant_id,
    'assignment', v_assignment,
    'features', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'feature_key', resolved.feature_key,
          'effective_status', resolved.effective_status,
          'reason', resolved.reason,
          'plan_status', resolved.plan_status,
          'requires_platform_approval', resolved.requires_platform_approval,
          'included_quota', resolved.included_quota,
          'module62_status', resolved.module62_status,
          'module62_source', resolved.module62_source,
          'override_type', resolved.feature_override_type
        )
        order by resolved.feature_key
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from resolved;

  return coalesce(v_result, jsonb_build_object('tenant_id', p_tenant_id, 'assignment', v_assignment, 'features', '[]'::jsonb));
end;
$$;

create or replace function public.get_tenant_entitlement_state(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assignment jsonb;
  v_plan_id uuid;
  v_usage jsonb;
  v_features jsonb;
  v_limits jsonb;
  v_warnings jsonb;
begin
  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Subscription entitlement access denied.' using errcode = '42501';
  end if;

  select tsa.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments tsa
  where tsa.tenant_id = p_tenant_id
    and tsa.is_current
  order by tsa.created_at desc
  limit 1;

  v_assignment := public.subscription_entitlements_current_assignment(p_tenant_id);
  v_usage := public.subscription_entitlements_latest_usage(p_tenant_id);
  v_features := (public.resolve_effective_feature_access(p_tenant_id, null)->'features');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'resource_key', spl.resource_key,
        'limit_value', coalesce(limit_override.override_value_json->>'limit_value', spl.limit_value::text),
        'base_limit_value', spl.limit_value,
        'limit_type', spl.limit_type,
        'enforcement_mode', spl.enforcement_mode,
        'warning_threshold_percent', spl.warning_threshold_percent,
        'allow_platform_override', spl.allow_platform_override,
        'override_type', limit_override.override_type
      )
      order by spl.resource_key
    ),
    '[]'::jsonb
  )
  into v_limits
  from public.subscription_plan_usage_limits spl
  left join lateral (
    select tso.override_type, tso.override_value_json
    from public.tenant_subscription_overrides tso
    where tso.tenant_id = p_tenant_id
      and tso.resource_key = spl.resource_key
      and tso.override_type in ('limit_raise', 'limit_lower')
      and (tso.expires_at is null or tso.expires_at > now())
    order by tso.created_at desc
    limit 1
  ) limit_override on true
  where spl.plan_id = v_plan_id;

  select coalesce(
    jsonb_agg(warning_row.warning order by warning_row.resource_key),
    '[]'::jsonb
  )
  into v_warnings
  from (
    select
      limit_row.resource_key,
      jsonb_build_object(
        'resource_key', limit_row.resource_key,
        'current_usage', limit_row.current_usage,
        'limit_value', limit_row.limit_value,
        'warning_threshold_percent', limit_row.warning_threshold_percent,
        'enforcement_mode', limit_row.enforcement_mode,
        'reason', 'usage_threshold'
      ) as warning
    from (
      select
        (limit_item->>'resource_key') as resource_key,
        nullif(limit_item->>'limit_value', '')::integer as limit_value,
        coalesce((limit_item->>'warning_threshold_percent')::integer, 80) as warning_threshold_percent,
        coalesce(limit_item->>'enforcement_mode', 'warn') as enforcement_mode,
        coalesce((v_usage->>(limit_item->>'resource_key'))::integer, 0) as current_usage
      from jsonb_array_elements(v_limits) as limit_item
    ) limit_row
    where limit_row.limit_value is not null
      and limit_row.limit_value > 0
      and limit_row.current_usage >= ceil(limit_row.limit_value * (limit_row.warning_threshold_percent::numeric / 100))
  ) warning_row;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'assignment', v_assignment,
    'limits', coalesce(v_limits, '[]'::jsonb),
    'features', coalesce(v_features, '[]'::jsonb),
    'latest_usage', coalesce(v_usage, '{}'::jsonb),
    'warnings', coalesce(v_warnings, '[]'::jsonb),
    'payment_forced', false,
    'gateway_required', false
  );
end;
$$;

create or replace function public.upsert_subscription_plan(
  p_code text,
  p_name text,
  p_tier_rank integer,
  p_description text default null,
  p_status text default 'draft',
  p_is_public boolean default false,
  p_trial_days integer default 14,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.subscription_entitlements_normalize_plan_code(p_code);
  v_name text := public.subscription_entitlements_normalize_text(p_name, 'name', true, 180);
  v_description text := public.subscription_entitlements_normalize_text(p_description, 'description', false, 1000);
  v_status text := lower(trim(coalesce(p_status, 'draft')));
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  v_trial_days integer := coalesce(p_trial_days, 14);
  v_existing_id uuid;
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if coalesce(p_tier_rank, 0) <= 0 or coalesce(p_tier_rank, 0) > 100 then
    raise exception 'Plan tier rank must be between 1 and 100.' using errcode = '22023';
  end if;

  if v_status not in ('draft', 'active', 'archived') then
    raise exception 'Invalid plan status.' using errcode = '22023';
  end if;

  if v_trial_days < 0 or v_trial_days > 365 then
    raise exception 'Trial days must be between 0 and 365.' using errcode = '22023';
  end if;

  select id into v_existing_id
  from public.subscription_plans
  where code = v_code;

  insert into public.subscription_plans (
    code,
    name,
    tier_rank,
    description,
    status,
    is_public,
    trial_days,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    v_code,
    v_name,
    p_tier_rank,
    v_description,
    v_status,
    coalesce(p_is_public, false),
    v_trial_days,
    v_metadata,
    auth.uid(),
    auth.uid()
  )
  on conflict (code) do update
  set
    name = excluded.name,
    tier_rank = excluded.tier_rank,
    description = excluded.description,
    status = excluded.status,
    is_public = excluded.is_public,
    trial_days = excluded.trial_days,
    metadata_json = excluded.metadata_json,
    updated_by = auth.uid(),
    updated_at = now()
  returning id into v_id;

  perform public.platform_log_activity(
    null,
    case
      when v_existing_id is null then 'subscription_plan_created'
      when v_status = 'archived' then 'subscription_plan_archived'
      else 'subscription_plan_updated'
    end,
    'subscription_plan',
    v_id,
    jsonb_build_object(
      'plan_code', v_code,
      'status', v_status,
      'is_public', coalesce(p_is_public, false),
      'payment_gateway_called', false
    )
  );

  return v_id;
end;
$$;

create or replace function public.upsert_subscription_plan_price(
  p_plan_code text,
  p_currency text,
  p_billing_cycle text,
  p_amount_minor bigint,
  p_setup_fee_amount_minor bigint default 0,
  p_tax_behavior text default 'exclusive',
  p_region_code text default 'GLOBAL',
  p_status text default 'draft',
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text := public.subscription_entitlements_normalize_plan_code(p_plan_code);
  v_currency text := public.subscription_entitlements_normalize_currency(p_currency);
  v_billing_cycle text := lower(trim(coalesce(p_billing_cycle, '')));
  v_tax_behavior text := lower(trim(coalesce(p_tax_behavior, 'exclusive')));
  v_region_code text := upper(trim(coalesce(nullif(p_region_code, ''), 'GLOBAL')));
  v_status text := lower(trim(coalesce(p_status, 'draft')));
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  v_plan_id uuid;
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if not (v_billing_cycle = any (public.subscription_entitlements_billing_cycles())) then
    raise exception 'Invalid billing cycle.' using errcode = '22023';
  end if;

  if v_tax_behavior not in ('exclusive', 'inclusive', 'not_applicable') then
    raise exception 'Invalid tax behavior.' using errcode = '22023';
  end if;

  if v_region_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' then
    raise exception 'Invalid region code.' using errcode = '22023';
  end if;

  if v_status not in ('draft', 'active', 'archived') then
    raise exception 'Invalid price status.' using errcode = '22023';
  end if;

  if coalesce(p_amount_minor, -1) < 0 or coalesce(p_setup_fee_amount_minor, -1) < 0 then
    raise exception 'Price amounts cannot be negative.' using errcode = '22023';
  end if;

  select id into v_plan_id
  from public.subscription_plans
  where code = v_plan_code;

  if v_plan_id is null then
    raise exception 'Plan not found.' using errcode = '22023';
  end if;

  insert into public.subscription_plan_prices (
    plan_id,
    currency,
    billing_cycle,
    amount_minor,
    setup_fee_amount_minor,
    tax_behavior,
    region_code,
    status,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    v_plan_id,
    v_currency,
    v_billing_cycle,
    coalesce(p_amount_minor, 0),
    coalesce(p_setup_fee_amount_minor, 0),
    v_tax_behavior,
    v_region_code,
    v_status,
    v_metadata,
    auth.uid(),
    auth.uid()
  )
  on conflict (plan_id, currency, billing_cycle, region_code, status)
  do update set
    amount_minor = excluded.amount_minor,
    setup_fee_amount_minor = excluded.setup_fee_amount_minor,
    tax_behavior = excluded.tax_behavior,
    metadata_json = excluded.metadata_json,
    updated_by = auth.uid(),
    updated_at = now()
  returning id into v_id;

  perform public.platform_log_activity(
    null,
    'subscription_plan_price_upserted',
    'subscription_plan_price',
    v_id,
    jsonb_build_object(
      'plan_code', v_plan_code,
      'currency', v_currency,
      'billing_cycle', v_billing_cycle,
      'status', v_status
    )
  );

  return v_id;
end;
$$;

create or replace function public.upsert_plan_usage_limit(
  p_plan_code text,
  p_resource_key text,
  p_limit_value integer,
  p_limit_type text,
  p_enforcement_mode text default 'warn',
  p_warning_threshold_percent integer default 80,
  p_allow_platform_override boolean default true,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text := public.subscription_entitlements_normalize_plan_code(p_plan_code);
  v_resource_key text := public.subscription_entitlements_normalize_resource_key(p_resource_key);
  v_limit_type text := lower(trim(coalesce(p_limit_type, '')));
  v_enforcement_mode text := lower(trim(coalesce(p_enforcement_mode, 'warn')));
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  v_plan_id uuid;
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if v_limit_type not in ('count', 'storage_mb', 'monthly_count', 'boolean') then
    raise exception 'Invalid limit type.' using errcode = '22023';
  end if;

  if v_enforcement_mode not in ('none', 'warn', 'hard') then
    raise exception 'Invalid enforcement mode.' using errcode = '22023';
  end if;

  if p_limit_value is not null and p_limit_value < 0 then
    raise exception 'Limit value cannot be negative.' using errcode = '22023';
  end if;

  if coalesce(p_warning_threshold_percent, 80) < 1 or coalesce(p_warning_threshold_percent, 80) > 100 then
    raise exception 'Warning threshold must be between 1 and 100.' using errcode = '22023';
  end if;

  select id into v_plan_id
  from public.subscription_plans
  where code = v_plan_code;

  if v_plan_id is null then
    raise exception 'Plan not found.' using errcode = '22023';
  end if;

  insert into public.subscription_plan_usage_limits (
    plan_id,
    resource_key,
    limit_value,
    limit_type,
    enforcement_mode,
    warning_threshold_percent,
    allow_platform_override,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    v_plan_id,
    v_resource_key,
    p_limit_value,
    v_limit_type,
    v_enforcement_mode,
    coalesce(p_warning_threshold_percent, 80),
    coalesce(p_allow_platform_override, true),
    v_metadata,
    auth.uid(),
    auth.uid()
  )
  on conflict (plan_id, resource_key) do update
  set
    limit_value = excluded.limit_value,
    limit_type = excluded.limit_type,
    enforcement_mode = excluded.enforcement_mode,
    warning_threshold_percent = excluded.warning_threshold_percent,
    allow_platform_override = excluded.allow_platform_override,
    metadata_json = excluded.metadata_json,
    updated_by = auth.uid(),
    updated_at = now()
  returning id into v_id;

  perform public.platform_log_activity(
    null,
    'subscription_plan_usage_limit_upserted',
    'subscription_plan_usage_limit',
    v_id,
    jsonb_build_object('plan_code', v_plan_code, 'resource_key', v_resource_key)
  );

  return v_id;
end;
$$;

create or replace function public.upsert_plan_feature_entitlement(
  p_plan_code text,
  p_feature_key text,
  p_entitlement_status text,
  p_requires_platform_approval boolean default false,
  p_included_quota integer default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text := public.subscription_entitlements_normalize_plan_code(p_plan_code);
  v_feature_key text := public.subscription_entitlements_normalize_feature_key(p_feature_key);
  v_status text := lower(trim(coalesce(p_entitlement_status, '')));
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  v_plan_id uuid;
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if v_status not in ('included', 'locked', 'coming_soon', 'addon', 'platform_approval_required') then
    raise exception 'Invalid entitlement status.' using errcode = '22023';
  end if;

  if p_included_quota is not null and p_included_quota < 0 then
    raise exception 'Included quota cannot be negative.' using errcode = '22023';
  end if;

  select id into v_plan_id
  from public.subscription_plans
  where code = v_plan_code;

  if v_plan_id is null then
    raise exception 'Plan not found.' using errcode = '22023';
  end if;

  insert into public.subscription_plan_feature_entitlements (
    plan_id,
    feature_key,
    entitlement_status,
    requires_platform_approval,
    included_quota,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    v_plan_id,
    v_feature_key,
    v_status,
    coalesce(p_requires_platform_approval, false),
    p_included_quota,
    v_metadata,
    auth.uid(),
    auth.uid()
  )
  on conflict (plan_id, feature_key) do update
  set
    entitlement_status = excluded.entitlement_status,
    requires_platform_approval = excluded.requires_platform_approval,
    included_quota = excluded.included_quota,
    metadata_json = excluded.metadata_json,
    updated_by = auth.uid(),
    updated_at = now()
  returning id into v_id;

  perform public.platform_log_activity(
    null,
    'subscription_plan_feature_entitlement_upserted',
    'subscription_plan_feature_entitlement',
    v_id,
    jsonb_build_object('plan_code', v_plan_code, 'feature_key', v_feature_key, 'status', v_status)
  );

  return v_id;
end;
$$;

create or replace function public.set_tenant_subscription_plan(
  p_tenant_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_currency text,
  p_status text,
  p_payment_status text,
  p_trial_ends_at timestamptz default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text := public.subscription_entitlements_normalize_plan_code(p_plan_code);
  v_billing_cycle text := lower(trim(coalesce(p_billing_cycle, '')));
  v_currency text := public.subscription_entitlements_normalize_currency(p_currency);
  v_status text := lower(trim(coalesce(p_status, 'trial')));
  v_payment_status text := lower(trim(coalesce(p_payment_status, 'not_required')));
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  v_plan_id uuid;
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_manager();

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  select id into v_plan_id
  from public.subscription_plans
  where code = v_plan_code
    and status <> 'archived';

  if v_plan_id is null then
    raise exception 'Plan not found.' using errcode = '22023';
  end if;

  if not (v_billing_cycle = any (public.subscription_entitlements_billing_cycles())) then
    raise exception 'Invalid billing cycle.' using errcode = '22023';
  end if;

  if v_status not in ('trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled', 'expired') then
    raise exception 'Invalid subscription status.' using errcode = '22023';
  end if;

  if v_payment_status not in ('not_required', 'unpaid', 'paid', 'overdue', 'waived') then
    raise exception 'Invalid payment status.' using errcode = '22023';
  end if;

  update public.tenant_subscription_assignments
  set is_current = false,
      updated_by = auth.uid(),
      updated_at = now()
  where tenant_id = p_tenant_id
    and is_current;

  insert into public.tenant_subscription_assignments (
    tenant_id,
    plan_id,
    status,
    billing_cycle,
    currency,
    trial_started_at,
    trial_ends_at,
    current_period_start,
    payment_status,
    source,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    v_plan_id,
    v_status,
    v_billing_cycle,
    v_currency,
    case when v_status = 'trial' then now() else null end,
    p_trial_ends_at,
    now(),
    v_payment_status,
    'platform_manual',
    v_metadata,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;

  perform public.platform_log_activity(
    p_tenant_id,
    'tenant_subscription_assignment_set',
    'tenant_subscription_assignment',
    v_id,
    jsonb_build_object(
      'plan_code', v_plan_code,
      'status', v_status,
      'payment_status', v_payment_status,
      'currency', v_currency,
      'billing_cycle', v_billing_cycle,
      'payment_gateway_called', false
    )
  );

  return public.get_tenant_entitlement_state(p_tenant_id);
end;
$$;

create or replace function public.record_tenant_usage_snapshot(
  p_tenant_id uuid,
  p_students integer default 0,
  p_courses integer default 0,
  p_cohorts integer default 0,
  p_batches integer default 0,
  p_admins integer default 0,
  p_staff_trainers integer default 0,
  p_team_members integer default 0,
  p_storage_mb integer default 0,
  p_document_uploads integer default 0,
  p_messages_monthly integer default 0,
  p_automation_runs_monthly integer default 0,
  p_ai_requests_monthly integer default 0,
  p_snapshot_date date default current_date,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_manager();

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  if least(
    coalesce(p_students, 0),
    coalesce(p_courses, 0),
    coalesce(p_cohorts, 0),
    coalesce(p_batches, 0),
    coalesce(p_admins, 0),
    coalesce(p_staff_trainers, 0),
    coalesce(p_team_members, 0),
    coalesce(p_storage_mb, 0),
    coalesce(p_document_uploads, 0),
    coalesce(p_messages_monthly, 0),
    coalesce(p_automation_runs_monthly, 0),
    coalesce(p_ai_requests_monthly, 0)
  ) < 0 then
    raise exception 'Usage counts cannot be negative.' using errcode = '22023';
  end if;

  insert into public.tenant_usage_snapshots (
    tenant_id,
    snapshot_date,
    students,
    courses,
    cohorts,
    batches,
    admins,
    staff_trainers,
    team_members,
    storage_mb,
    document_uploads,
    messages_monthly,
    automation_runs_monthly,
    ai_requests_monthly,
    metadata_json
  )
  values (
    p_tenant_id,
    coalesce(p_snapshot_date, current_date),
    coalesce(p_students, 0),
    coalesce(p_courses, 0),
    coalesce(p_cohorts, 0),
    coalesce(p_batches, 0),
    coalesce(p_admins, 0),
    coalesce(p_staff_trainers, 0),
    coalesce(p_team_members, 0),
    coalesce(p_storage_mb, 0),
    coalesce(p_document_uploads, 0),
    coalesce(p_messages_monthly, 0),
    coalesce(p_automation_runs_monthly, 0),
    coalesce(p_ai_requests_monthly, 0),
    v_metadata
  )
  on conflict (tenant_id, snapshot_date) do update
  set
    students = excluded.students,
    courses = excluded.courses,
    cohorts = excluded.cohorts,
    batches = excluded.batches,
    admins = excluded.admins,
    staff_trainers = excluded.staff_trainers,
    team_members = excluded.team_members,
    storage_mb = excluded.storage_mb,
    document_uploads = excluded.document_uploads,
    messages_monthly = excluded.messages_monthly,
    automation_runs_monthly = excluded.automation_runs_monthly,
    ai_requests_monthly = excluded.ai_requests_monthly,
    metadata_json = excluded.metadata_json
  returning id into v_id;

  perform public.platform_log_activity(
    p_tenant_id,
    'tenant_usage_snapshot_recorded',
    'tenant_usage_snapshot',
    v_id,
    jsonb_build_object('snapshot_date', coalesce(p_snapshot_date, current_date))
  );

  return v_id;
end;
$$;

create or replace function public.assert_tenant_usage_limit(
  p_tenant_id uuid,
  p_resource_key text,
  p_requested_delta integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resource_key text := public.subscription_entitlements_normalize_resource_key(p_resource_key);
  v_requested_delta integer := coalesce(p_requested_delta, 1);
  v_plan_id uuid;
  v_limit record;
  v_override record;
  v_has_limit boolean := false;
  v_has_override boolean := false;
  v_usage jsonb;
  v_current_usage integer := 0;
  v_effective_limit integer;
  v_allowed boolean := true;
  v_warning boolean := false;
  v_reason text := 'allowed';
begin
  if v_requested_delta < 0 then
    raise exception 'Requested delta cannot be negative.' using errcode = '22023';
  end if;

  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Usage limit access denied.' using errcode = '42501';
  end if;

  select plan_id into v_plan_id
  from public.tenant_subscription_assignments
  where tenant_id = p_tenant_id
    and is_current
  order by created_at desc
  limit 1;

  if v_plan_id is null then
    return jsonb_build_object(
      'allowed', true,
      'resource_key', v_resource_key,
      'current_usage', 0,
      'requested_delta', v_requested_delta,
      'limit_value', null,
      'warning', false,
      'enforcement_mode', 'none',
      'reason', 'no_assignment'
    );
  end if;

  select *
  into v_limit
  from public.subscription_plan_usage_limits
  where plan_id = v_plan_id
    and resource_key = v_resource_key;
  v_has_limit := found;

  if not v_has_limit then
    return jsonb_build_object(
      'allowed', true,
      'resource_key', v_resource_key,
      'current_usage', 0,
      'requested_delta', v_requested_delta,
      'limit_value', null,
      'warning', false,
      'enforcement_mode', 'none',
      'reason', 'no_limit_configured'
    );
  end if;

  select *
  into v_override
  from public.tenant_subscription_overrides
  where tenant_id = p_tenant_id
    and resource_key = v_resource_key
    and override_type in ('limit_raise', 'limit_lower')
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;
  v_has_override := found;

  v_effective_limit := v_limit.limit_value;
  if v_has_override and (v_override.override_value_json ? 'limit_value') then
    v_effective_limit := nullif(v_override.override_value_json->>'limit_value', '')::integer;
  end if;

  v_usage := public.subscription_entitlements_latest_usage(p_tenant_id);
  v_current_usage := coalesce((v_usage->>v_resource_key)::integer, 0);

  if v_effective_limit is null then
    v_allowed := true;
    v_reason := 'unlimited';
  elsif v_limit.enforcement_mode = 'hard' and (v_current_usage + v_requested_delta) > v_effective_limit then
    v_allowed := false;
    v_reason := 'hard_limit_exceeded';
  elsif v_limit.enforcement_mode in ('warn', 'hard')
        and v_effective_limit > 0
        and (v_current_usage + v_requested_delta) >= ceil(v_effective_limit * (v_limit.warning_threshold_percent::numeric / 100)) then
    v_warning := true;
    v_reason := 'warning_threshold_reached';
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'resource_key', v_resource_key,
    'current_usage', v_current_usage,
    'requested_delta', v_requested_delta,
    'limit_value', v_effective_limit,
    'base_limit_value', v_limit.limit_value,
    'warning', v_warning,
    'enforcement_mode', v_limit.enforcement_mode,
    'warning_threshold_percent', v_limit.warning_threshold_percent,
    'reason', v_reason,
    'override_type', case when v_has_override then v_override.override_type else null end
  );
end;
$$;

create or replace function public.request_plan_upgrade(
  p_tenant_id uuid,
  p_requested_plan_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_plan_code text := public.subscription_entitlements_normalize_plan_code(p_requested_plan_code);
  v_reason text := public.subscription_entitlements_normalize_text(p_reason, 'reason', false, 1200);
  v_role text;
  v_plan_id uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  v_role := public.subscription_entitlements_current_role(p_tenant_id);
  if not coalesce(v_role in ('owner', 'admin'), false) then
    raise exception 'Only tenant owners/admins can request plan upgrades.' using errcode = '42501';
  end if;

  select id into v_plan_id
  from public.subscription_plans
  where code = v_requested_plan_code
    and status = 'active'
    and is_public;

  if v_plan_id is null then
    raise exception 'Requested plan not found.' using errcode = '22023';
  end if;

  insert into public.tenant_plan_upgrade_requests (
    tenant_id,
    requested_plan_id,
    requested_plan_code,
    requested_by,
    status,
    reason,
    metadata_json
  )
  values (
    p_tenant_id,
    v_plan_id,
    v_requested_plan_code,
    auth.uid(),
    'open',
    v_reason,
    '{}'::jsonb
  )
  returning id into v_id;

  perform public.platform_log_activity(
    p_tenant_id,
    'tenant_plan_upgrade_requested',
    'tenant_plan_upgrade_request',
    v_id,
    jsonb_build_object(
      'requested_plan_code', v_requested_plan_code,
      'reason_present', v_reason is not null
    )
  );

  return jsonb_build_object(
    'request_id', v_id,
    'tenant_id', p_tenant_id,
    'requested_plan_code', v_requested_plan_code,
    'status', 'open',
    'entitlement_changed', false,
    'payment_gateway_called', false
  );
end;
$$;

create or replace function public.approve_tenant_feature_override(
  p_tenant_id uuid,
  p_override_type text,
  p_resource_key text default null,
  p_feature_key text default null,
  p_override_value_json jsonb default '{}'::jsonb,
  p_reason text default null,
  p_expires_at timestamptz default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override_type text := lower(trim(coalesce(p_override_type, '')));
  v_resource_key text := null;
  v_feature_key text := null;
  v_override_value jsonb := public.subscription_entitlements_validate_json_object(p_override_value_json, 'override_value_json', 2000);
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  v_reason text := public.subscription_entitlements_normalize_text(p_reason, 'reason', true, 1200);
  v_limit_value_text text;
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  if v_override_type not in ('feature_unlock', 'feature_lock', 'limit_raise', 'limit_lower', 'grace_extension', 'price_exception') then
    raise exception 'Invalid override type.' using errcode = '22023';
  end if;

  if v_override_type in ('limit_raise', 'limit_lower') then
    v_resource_key := public.subscription_entitlements_normalize_resource_key(p_resource_key);
    if not (v_override_value ? 'limit_value') then
      raise exception 'Limit override requires limit_value.' using errcode = '22023';
    end if;

    if jsonb_typeof(v_override_value->'limit_value') not in ('number', 'string') then
      raise exception 'Limit override value must be a non-negative integer.' using errcode = '22023';
    end if;

    v_limit_value_text := v_override_value->>'limit_value';
    if v_limit_value_text !~ '^[0-9]+$' then
      raise exception 'Limit override value must be a non-negative integer.' using errcode = '22023';
    end if;

    if v_limit_value_text::numeric > 2147483647 then
      raise exception 'Limit override value is too large.' using errcode = '22023';
    end if;
  elsif v_override_type in ('feature_unlock', 'feature_lock') then
    v_feature_key := public.subscription_entitlements_normalize_feature_key(p_feature_key);
  end if;

  insert into public.tenant_subscription_overrides (
    tenant_id,
    override_type,
    resource_key,
    feature_key,
    override_value_json,
    reason,
    expires_at,
    approved_by,
    metadata_json
  )
  values (
    p_tenant_id,
    v_override_type,
    v_resource_key,
    v_feature_key,
    v_override_value,
    v_reason,
    p_expires_at,
    auth.uid(),
    v_metadata
  )
  returning id into v_id;

  perform public.platform_log_activity(
    p_tenant_id,
    'tenant_subscription_override_approved',
    'tenant_subscription_override',
    v_id,
    jsonb_build_object(
      'override_type', v_override_type,
      'resource_key', v_resource_key,
      'feature_key', v_feature_key,
      'expires_at', p_expires_at
    )
  );

  return jsonb_build_object(
    'override_id', v_id,
    'tenant_id', p_tenant_id,
    'override_type', v_override_type,
    'resource_key', v_resource_key,
    'feature_key', v_feature_key,
    'expires_at', p_expires_at
  );
end;
$$;

-- Draft-only internal starter catalog. These rows are intentionally draft and
-- not public. Public pricing should be reviewed separately before activation.
insert into public.subscription_plans (
  code,
  name,
  tier_rank,
  description,
  status,
  is_public,
  trial_days,
  metadata_json
)
values
  ('starter', 'Starter', 10, 'Internal draft early-access starter plan.', 'draft', false, 14, '{"seed":"module71_7f2","public_pricing":"not_final"}'::jsonb),
  ('growth', 'Growth', 20, 'Internal draft growth plan.', 'draft', false, 14, '{"seed":"module71_7f2","public_pricing":"not_final"}'::jsonb),
  ('premium', 'Premium', 30, 'Internal draft premium plan.', 'draft', false, 14, '{"seed":"module71_7f2","public_pricing":"not_final"}'::jsonb)
on conflict (code) do nothing;

revoke all on function public.subscription_entitlements_currencies() from public, anon, authenticated;
revoke all on function public.subscription_entitlements_billing_cycles() from public, anon, authenticated;
revoke all on function public.subscription_entitlements_resource_keys() from public, anon, authenticated;
revoke all on function public.subscription_entitlements_feature_keys() from public, anon, authenticated;
revoke all on function public.subscription_entitlements_global_locked_features() from public, anon, authenticated;
revoke all on function public.subscription_entitlements_validate_json_object(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_normalize_text(text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_current_role(uuid) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_can_read_tenant(uuid) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_assert_platform_manager() from public, anon, authenticated;
revoke all on function public.subscription_entitlements_assert_platform_owner_admin() from public, anon, authenticated;
revoke all on function public.subscription_entitlements_normalize_currency(text) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_normalize_plan_code(text) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_normalize_resource_key(text) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_normalize_feature_key(text) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_latest_usage(uuid) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_current_assignment(uuid) from public, anon, authenticated;
revoke all on function public.subscription_entitlements_active_overrides(uuid) from public, anon, authenticated;

revoke all on function public.get_public_plan_catalog(text) from public, anon, authenticated;
revoke all on function public.get_platform_plan_catalog() from public, anon, authenticated;
revoke all on function public.get_tenant_entitlement_state(uuid) from public, anon, authenticated;
revoke all on function public.upsert_subscription_plan(text, text, integer, text, text, boolean, integer, jsonb) from public, anon, authenticated;
revoke all on function public.set_tenant_subscription_plan(uuid, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_subscription_plan_price(text, text, text, bigint, bigint, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_plan_usage_limit(text, text, integer, text, text, integer, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_plan_feature_entitlement(text, text, text, boolean, integer, jsonb) from public, anon, authenticated;
revoke all on function public.record_tenant_usage_snapshot(uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, date, jsonb) from public, anon, authenticated;
revoke all on function public.assert_tenant_usage_limit(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.request_plan_upgrade(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_tenant_feature_override(uuid, text, text, text, jsonb, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.resolve_effective_feature_access(uuid, text) from public, anon, authenticated;

grant execute on function public.get_public_plan_catalog(text) to anon, authenticated;
grant execute on function public.get_platform_plan_catalog() to authenticated;
grant execute on function public.get_tenant_entitlement_state(uuid) to authenticated;
grant execute on function public.upsert_subscription_plan(text, text, integer, text, text, boolean, integer, jsonb) to authenticated;
grant execute on function public.set_tenant_subscription_plan(uuid, text, text, text, text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.upsert_subscription_plan_price(text, text, text, bigint, bigint, text, text, text, jsonb) to authenticated;
grant execute on function public.upsert_plan_usage_limit(text, text, integer, text, text, integer, boolean, jsonb) to authenticated;
grant execute on function public.upsert_plan_feature_entitlement(text, text, text, boolean, integer, jsonb) to authenticated;
grant execute on function public.record_tenant_usage_snapshot(uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, date, jsonb) to authenticated;
grant execute on function public.assert_tenant_usage_limit(uuid, text, integer) to authenticated;
grant execute on function public.request_plan_upgrade(uuid, text, text) to authenticated;
grant execute on function public.approve_tenant_feature_override(uuid, text, text, text, jsonb, text, timestamptz, jsonb) to authenticated;
grant execute on function public.resolve_effective_feature_access(uuid, text) to authenticated;

commit;

-- Verification SQL for later review/execution by a human
-- Do not execute from Codex.
/*
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'subscription_plans',
    'subscription_plan_prices',
    'subscription_plan_usage_limits',
    'subscription_plan_feature_entitlements',
    'tenant_subscription_assignments',
    'tenant_subscription_overrides',
    'tenant_usage_snapshots',
    'tenant_usage_events',
    'tenant_plan_upgrade_requests'
  )
order by table_name;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'subscription_plans',
    'subscription_plan_prices',
    'subscription_plan_usage_limits',
    'subscription_plan_feature_entitlements',
    'tenant_subscription_assignments',
    'tenant_subscription_overrides',
    'tenant_usage_snapshots',
    'tenant_usage_events',
    'tenant_plan_upgrade_requests'
  )
order by c.relname;

-- Expected result: zero rows. PUBLIC, anon, and authenticated should not hold
-- direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES privileges on
-- these canonical entitlement tables; access is RPC-only.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'subscription_plans',
    'subscription_plan_prices',
    'subscription_plan_usage_limits',
    'subscription_plan_feature_entitlements',
    'tenant_subscription_assignments',
    'tenant_subscription_overrides',
    'tenant_usage_snapshots',
    'tenant_usage_events',
    'tenant_plan_upgrade_requests'
  )
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_public_plan_catalog',
    'get_platform_plan_catalog',
    'get_tenant_entitlement_state',
    'upsert_subscription_plan',
    'set_tenant_subscription_plan',
    'upsert_subscription_plan_price',
    'upsert_plan_usage_limit',
    'upsert_plan_feature_entitlement',
    'record_tenant_usage_snapshot',
    'assert_tenant_usage_limit',
    'request_plan_upgrade',
    'approve_tenant_feature_override',
    'resolve_effective_feature_access'
  )
order by routine_name;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in (
  'subscription_plan_prices_currency_check',
  'tenant_subscription_assignments_currency_check'
);

select code, status, is_public
from public.subscription_plans
where code in ('starter', 'growth', 'premium')
order by tier_rank;

select count(*) as tenant_assignment_count
from public.tenant_subscription_assignments;

select count(*) as regression_tenant_assignments
from public.tenant_subscription_assignments
where tenant_id = '29a33701-82ed-4c7f-8042-0a1af8296ce5';
*/

-- Rollback SQL for later review only
-- Do not execute from Codex.
/*
begin;

drop function if exists public.resolve_effective_feature_access(uuid, text);
drop function if exists public.approve_tenant_feature_override(uuid, text, text, text, jsonb, text, timestamptz, jsonb);
drop function if exists public.request_plan_upgrade(uuid, text, text);
drop function if exists public.assert_tenant_usage_limit(uuid, text, integer);
drop function if exists public.record_tenant_usage_snapshot(uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, date, jsonb);
drop function if exists public.upsert_plan_feature_entitlement(text, text, text, boolean, integer, jsonb);
drop function if exists public.upsert_plan_usage_limit(text, text, integer, text, text, integer, boolean, jsonb);
drop function if exists public.upsert_subscription_plan_price(text, text, text, bigint, bigint, text, text, text, jsonb);
drop function if exists public.set_tenant_subscription_plan(uuid, text, text, text, text, text, timestamptz, jsonb);
drop function if exists public.upsert_subscription_plan(text, text, integer, text, text, boolean, integer, jsonb);
drop function if exists public.get_tenant_entitlement_state(uuid);
drop function if exists public.get_platform_plan_catalog();
drop function if exists public.get_public_plan_catalog(text);
drop function if exists public.subscription_entitlements_active_overrides(uuid);
drop function if exists public.subscription_entitlements_current_assignment(uuid);
drop function if exists public.subscription_entitlements_latest_usage(uuid);
drop function if exists public.subscription_entitlements_normalize_feature_key(text);
drop function if exists public.subscription_entitlements_normalize_resource_key(text);
drop function if exists public.subscription_entitlements_normalize_plan_code(text);
drop function if exists public.subscription_entitlements_normalize_currency(text);
drop function if exists public.subscription_entitlements_assert_platform_owner_admin();
drop function if exists public.subscription_entitlements_assert_platform_manager();
drop function if exists public.subscription_entitlements_can_read_tenant(uuid);
drop function if exists public.subscription_entitlements_current_role(uuid);
drop function if exists public.subscription_entitlements_normalize_text(text, text, boolean, integer);
drop function if exists public.subscription_entitlements_validate_json_object(jsonb, text, integer);
drop function if exists public.subscription_entitlements_global_locked_features();
drop function if exists public.subscription_entitlements_feature_keys();
drop function if exists public.subscription_entitlements_resource_keys();
drop function if exists public.subscription_entitlements_billing_cycles();
drop function if exists public.subscription_entitlements_currencies();

drop table if exists public.tenant_plan_upgrade_requests;
drop table if exists public.tenant_usage_events;
drop table if exists public.tenant_usage_snapshots;
drop table if exists public.tenant_subscription_overrides;
drop table if exists public.tenant_subscription_assignments;
drop table if exists public.subscription_plan_feature_entitlements;
drop table if exists public.subscription_plan_usage_limits;
drop table if exists public.subscription_plan_prices;
drop table if exists public.subscription_plans;

commit;
*/
