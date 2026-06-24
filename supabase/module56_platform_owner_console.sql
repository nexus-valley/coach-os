-- Module 56: CoachFort Platform Owner Console
-- Platform-owner administration for Nexus Valley / CoachFort.
-- Review before execution. This does not grant platform access to tenant roles.
-- This migration assumes public.set_updated_at() already exists from prior modules.

create table if not exists public.platform_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'support', 'finance')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(metadata_json) = 'object'),
  check (length(metadata_json::text) <= 3000)
);

create table if not exists public.platform_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  monthly_price numeric(12,2) not null default 0 check (monthly_price >= 0),
  yearly_price numeric(12,2) not null default 0 check (yearly_price >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  max_students integer check (max_students is null or max_students >= 0),
  max_courses integer check (max_courses is null or max_courses >= 0),
  max_team_members integer check (max_team_members is null or max_team_members >= 0),
  max_storage_mb integer check (max_storage_mb is null or max_storage_mb >= 0),
  ai_monthly_limit integer check (ai_monthly_limit is null or ai_monthly_limit >= 0),
  marketing_monthly_limit integer check (marketing_monthly_limit is null or marketing_monthly_limit >= 0),
  features_json jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  check (length(name) <= 180),
  check (description is null or length(description) <= 1000),
  check (description is null or (position('<' in description) = 0 and position('>' in description) = 0)),
  check (jsonb_typeof(features_json) = 'object'),
  check (length(features_json::text) <= 5000)
);

create table if not exists public.platform_tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  plan_id uuid references public.platform_subscription_plans(id) on delete set null,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly', 'custom')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  payment_status text not null default 'not_required' check (payment_status in ('not_required', 'unpaid', 'paid', 'overdue', 'waived')),
  notes text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_started_at is null or trial_ends_at is null or trial_started_at <= trial_ends_at),
  check (current_period_start is null or current_period_end is null or current_period_start <= current_period_end),
  check (notes is null or length(notes) <= 1500),
  check (notes is null or (position('<' in notes) = 0 and position('>' in notes) = 0)),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (length(metadata_json::text) <= 3000)
);

create table if not exists public.platform_tenant_usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  snapshot_date date not null default current_date,
  students_count integer not null default 0 check (students_count >= 0),
  courses_count integer not null default 0 check (courses_count >= 0),
  team_members_count integer not null default 0 check (team_members_count >= 0),
  ai_requests_count integer not null default 0 check (ai_requests_count >= 0),
  marketing_campaigns_count integer not null default 0 check (marketing_campaigns_count >= 0),
  storage_mb numeric(12,2) not null default 0 check (storage_mb >= 0),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, snapshot_date),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (length(metadata_json::text) <= 3000)
);

create table if not exists public.platform_support_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  note_type text not null default 'general' check (note_type in ('general', 'billing', 'technical', 'onboarding', 'risk', 'follow_up')),
  note text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'archived')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(note) between 1 and 2000),
  check (position('<' in note) = 0 and position('>' in note) = 0),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (length(metadata_json::text) <= 3000)
);

create table if not exists public.platform_activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(action) between 1 and 120),
  check (entity_type is null or length(entity_type) <= 120),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (length(metadata_json::text) <= 3000)
);

create index if not exists platform_admin_users_role_status_idx
on public.platform_admin_users (role, status);

create index if not exists platform_tenant_subscriptions_status_idx
on public.platform_tenant_subscriptions (status, payment_status);

create index if not exists platform_tenant_subscriptions_tenant_idx
on public.platform_tenant_subscriptions (tenant_id);

create index if not exists platform_usage_snapshots_tenant_date_idx
on public.platform_tenant_usage_snapshots (tenant_id, snapshot_date desc);

create index if not exists platform_support_notes_tenant_created_idx
on public.platform_support_notes (tenant_id, created_at desc);

create index if not exists platform_activity_logs_created_idx
on public.platform_activity_logs (created_at desc);

create index if not exists platform_activity_logs_tenant_created_idx
on public.platform_activity_logs (tenant_id, created_at desc);

drop trigger if exists set_platform_admin_users_updated_at on public.platform_admin_users;
create trigger set_platform_admin_users_updated_at
before update on public.platform_admin_users
for each row execute function public.set_updated_at();

drop trigger if exists set_platform_subscription_plans_updated_at on public.platform_subscription_plans;
create trigger set_platform_subscription_plans_updated_at
before update on public.platform_subscription_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_platform_tenant_subscriptions_updated_at on public.platform_tenant_subscriptions;
create trigger set_platform_tenant_subscriptions_updated_at
before update on public.platform_tenant_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists set_platform_support_notes_updated_at on public.platform_support_notes;
create trigger set_platform_support_notes_updated_at
before update on public.platform_support_notes
for each row execute function public.set_updated_at();

create or replace function public.platform_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pau.role
  from public.platform_admin_users pau
  where pau.user_id = auth.uid()
    and pau.status = 'active'
  limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(public.platform_current_role() is not null, false);
end;
$$;

create or replace function public.platform_can_manage_admins()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(public.platform_current_role() = 'owner', false);
end;
$$;

create or replace function public.platform_can_manage_billing()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(public.platform_current_role() in ('owner', 'admin', 'finance'), false);
end;
$$;

create or replace function public.platform_can_manage_support()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(public.platform_current_role() in ('owner', 'admin', 'support'), false);
end;
$$;

create or replace function public.platform_can_view_tenant(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(
    public.is_platform_admin()
    and p_tenant_id is not null
    and exists (select 1 from public.tenants t where t.id = p_tenant_id),
    false
  );
end;
$$;

create or replace function public.platform_normalize_text(
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
  normalized text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_required and normalized is null then
    raise exception '% is required.', p_field using errcode = '22023';
  end if;

  if normalized is not null and length(normalized) > p_max_length then
    raise exception '% is too long.', p_field using errcode = '22023';
  end if;

  if normalized is not null and (position('<' in normalized) > 0 or position('>' in normalized) > 0) then
    raise exception '% cannot contain HTML-like characters.', p_field using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.platform_validate_json_object(
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
  normalized jsonb := coalesce(p_value, '{}'::jsonb);
begin
  if jsonb_typeof(normalized) <> 'object' then
    raise exception '% must be a JSON object.', p_field using errcode = '22023';
  end if;

  if length(normalized::text) > p_max_length then
    raise exception '% is too large.', p_field using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.platform_log_activity(
  p_tenant_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.platform_activity_logs (
    actor_id,
    tenant_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  )
  values (
    auth.uid(),
    p_tenant_id,
    public.platform_normalize_text(p_action, 'action', true, 120),
    public.platform_normalize_text(p_entity_type, 'entity_type', false, 120),
    p_entity_id,
    public.platform_validate_json_object(p_metadata_json, 'metadata_json', 3000)
  )
  returning id into new_id;

  return new_id;
end;
$$;

alter table public.platform_admin_users enable row level security;
alter table public.platform_subscription_plans enable row level security;
alter table public.platform_tenant_subscriptions enable row level security;
alter table public.platform_tenant_usage_snapshots enable row level security;
alter table public.platform_support_notes enable row level security;
alter table public.platform_activity_logs enable row level security;

revoke all on public.platform_admin_users from anon;
revoke all on public.platform_subscription_plans from anon;
revoke all on public.platform_tenant_subscriptions from anon;
revoke all on public.platform_tenant_usage_snapshots from anon;
revoke all on public.platform_support_notes from anon;
revoke all on public.platform_activity_logs from anon;

revoke insert, update, delete on public.platform_admin_users from authenticated;
revoke insert, update, delete on public.platform_subscription_plans from authenticated;
revoke insert, update, delete on public.platform_tenant_subscriptions from authenticated;
revoke insert, update, delete on public.platform_tenant_usage_snapshots from authenticated;
revoke insert, update, delete on public.platform_support_notes from authenticated;
revoke insert, update, delete on public.platform_activity_logs from authenticated;

grant select on public.platform_admin_users to authenticated;
grant select on public.platform_subscription_plans to authenticated;
grant select on public.platform_tenant_subscriptions to authenticated;
grant select on public.platform_tenant_usage_snapshots to authenticated;
grant select on public.platform_support_notes to authenticated;
grant select on public.platform_activity_logs to authenticated;

drop policy if exists "Platform admins can read platform admins" on public.platform_admin_users;
create policy "Platform admins can read platform admins"
on public.platform_admin_users
for select
to authenticated
using (public.platform_can_manage_admins());

drop policy if exists "Platform admins can read plans" on public.platform_subscription_plans;
create policy "Platform admins can read plans"
on public.platform_subscription_plans
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "Platform admins can read tenant subscriptions" on public.platform_tenant_subscriptions;
create policy "Platform admins can read tenant subscriptions"
on public.platform_tenant_subscriptions
for select
to authenticated
using (public.platform_can_manage_billing());

drop policy if exists "Platform admins can read usage snapshots" on public.platform_tenant_usage_snapshots;
create policy "Platform admins can read usage snapshots"
on public.platform_tenant_usage_snapshots
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "Platform admins can read support notes" on public.platform_support_notes;
create policy "Platform admins can read support notes"
on public.platform_support_notes
for select
to authenticated
using (public.platform_can_manage_support());

drop policy if exists "Platform admins can read activity logs" on public.platform_activity_logs;
create policy "Platform admins can read activity logs"
on public.platform_activity_logs
for select
to authenticated
using (public.is_platform_admin());

create or replace function public.get_platform_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'tenant_count', (select count(*) from public.tenants),
    'active_tenants', (select count(*) from public.platform_tenant_subscriptions where status = 'active'),
    'trial_tenants', (select count(*) from public.platform_tenant_subscriptions where status = 'trial'),
    'suspended_tenants', (select count(*) from public.platform_tenant_subscriptions where status = 'suspended'),
    'total_students', (select count(*) from public.students),
    'total_courses', (select count(*) from public.courses),
    'active_subscriptions', (select count(*) from public.platform_tenant_subscriptions where status in ('trial', 'active')),
    'overdue_subscriptions', (select count(*) from public.platform_tenant_subscriptions where status = 'past_due' or payment_status = 'overdue'),
    'recent_tenants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'slug', t.slug,
          'created_at', t.created_at
        )
        order by t.created_at desc
      )
      from (
        select id, name, slug, created_at
        from public.tenants
        order by created_at desc
        limit 5
      ) t
    ), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'tenant_id', l.tenant_id,
          'action', l.action,
          'entity_type', l.entity_type,
          'entity_id', l.entity_id,
          'metadata_json', l.metadata_json,
          'created_at', l.created_at
        )
        order by l.created_at desc
      )
      from (
        select *
        from public.platform_activity_logs
        order by created_at desc
        limit 10
      ) l
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.get_platform_tenants()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access is required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_payload order by created_at desc), '[]'::jsonb)
  into result
  from (
    select
      t.created_at,
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'slug', t.slug,
        'category', t.category,
        'created_at', t.created_at,
        'students_count', (select count(*) from public.students s where s.tenant_id = t.id),
        'courses_count', (select count(*) from public.courses c where c.tenant_id = t.id),
        'team_members_count', (select count(*) from public.tenant_members tm where tm.tenant_id = t.id),
        'last_activity_at', (select max(al.created_at) from public.audit_logs al where al.tenant_id = t.id),
        'subscription', jsonb_build_object(
          'status', pts.status,
          'payment_status', pts.payment_status,
          'billing_cycle', pts.billing_cycle,
          'amount', pts.amount,
          'currency', pts.currency,
          'trial_ends_at', pts.trial_ends_at,
          'current_period_end', pts.current_period_end,
          'plan_name', psp.name,
          'plan_code', psp.code
        )
      ) as row_payload
    from public.tenants t
    left join public.platform_tenant_subscriptions pts on pts.tenant_id = t.id
    left join public.platform_subscription_plans psp on psp.id = pts.plan_id
  ) rows;

  return result;
end;
$$;

create or replace function public.get_platform_tenant_detail(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.platform_can_view_tenant(p_tenant_id) then
    raise exception 'Platform tenant access is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'slug', t.slug,
      'category', t.category,
      'created_at', t.created_at,
      'subscription_status', t.subscription_status
    ),
    'subscription', jsonb_build_object(
      'id', pts.id,
      'plan_id', pts.plan_id,
      'plan_name', psp.name,
      'plan_code', psp.code,
      'status', pts.status,
      'billing_cycle', pts.billing_cycle,
      'trial_started_at', pts.trial_started_at,
      'trial_ends_at', pts.trial_ends_at,
      'current_period_start', pts.current_period_start,
      'current_period_end', pts.current_period_end,
      'amount', pts.amount,
      'currency', pts.currency,
      'payment_status', pts.payment_status,
      'notes_present', pts.notes is not null
    ),
    'counts', jsonb_build_object(
      'students_count', (select count(*) from public.students s where s.tenant_id = t.id),
      'courses_count', (select count(*) from public.courses c where c.tenant_id = t.id),
      'team_members_count', (select count(*) from public.tenant_members tm where tm.tenant_id = t.id),
      'owner_admin_count', (select count(*) from public.tenant_members tm where tm.tenant_id = t.id and tm.role in ('owner', 'admin'))
    ),
    'latest_usage_snapshot', (
      select to_jsonb(us)
      from public.platform_tenant_usage_snapshots us
      where us.tenant_id = t.id
      order by us.snapshot_date desc
      limit 1
    ),
    'support_notes',
      case
        when public.platform_can_manage_support() then coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', sn.id,
              'note_type', sn.note_type,
              'note', sn.note,
              'status', sn.status,
              'created_by', sn.created_by,
              'created_at', sn.created_at,
              'updated_at', sn.updated_at
            )
            order by sn.created_at desc
          )
          from (
            select *
            from public.platform_support_notes
            where tenant_id = t.id
            order by created_at desc
            limit 10
          ) sn
        ), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'support_note_counts', jsonb_build_object(
      'open', (select count(*) from public.platform_support_notes sn where sn.tenant_id = t.id and sn.status = 'open'),
      'in_progress', (select count(*) from public.platform_support_notes sn where sn.tenant_id = t.id and sn.status = 'in_progress'),
      'resolved', (select count(*) from public.platform_support_notes sn where sn.tenant_id = t.id and sn.status = 'resolved'),
      'archived', (select count(*) from public.platform_support_notes sn where sn.tenant_id = t.id and sn.status = 'archived')
    ),
    'activity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'action', l.action,
          'entity_type', l.entity_type,
          'entity_id', l.entity_id,
          'metadata_json', l.metadata_json,
          'created_at', l.created_at
        )
        order by l.created_at desc
      )
      from (
        select *
        from public.platform_activity_logs
        where tenant_id = t.id
        order by created_at desc
        limit 20
      ) l
    ), '[]'::jsonb)
  )
  into result
  from public.tenants t
  left join public.platform_tenant_subscriptions pts on pts.tenant_id = t.id
  left join public.platform_subscription_plans psp on psp.id = pts.plan_id
  where t.id = p_tenant_id;

  if result is null then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  return result;
end;
$$;

create or replace function public.upsert_platform_subscription_plan(
  p_code text,
  p_name text,
  p_description text default null,
  p_monthly_price numeric default 0,
  p_yearly_price numeric default 0,
  p_currency text default 'INR',
  p_max_students integer default null,
  p_max_courses integer default null,
  p_max_team_members integer default null,
  p_max_storage_mb integer default null,
  p_ai_monthly_limit integer default null,
  p_marketing_monthly_limit integer default null,
  p_features_json jsonb default '{}'::jsonb,
  p_status text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := lower(trim(coalesce(p_code, '')));
  normalized_name text := public.platform_normalize_text(p_name, 'name', true, 180);
  normalized_description text := public.platform_normalize_text(p_description, 'description', false, 1000);
  normalized_currency text := upper(trim(coalesce(p_currency, 'INR')));
  normalized_status text := lower(trim(coalesce(p_status, 'active')));
  normalized_features jsonb := public.platform_validate_json_object(p_features_json, 'features_json', 5000);
  existing_id uuid;
  saved_id uuid;
begin
  if public.platform_current_role() not in ('owner', 'admin') then
    raise exception 'Only platform owner/admin can manage platform plans.' using errcode = '42501';
  end if;

  if normalized_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception 'Plan code must be lowercase slug-safe text.' using errcode = '22023';
  end if;

  if normalized_currency <> 'INR' then
    raise exception 'Only INR currency is supported for platform plans.' using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'inactive', 'archived') then
    raise exception 'Invalid plan status.' using errcode = '22023';
  end if;

  if coalesce(p_monthly_price, 0) < 0 or coalesce(p_yearly_price, 0) < 0 then
    raise exception 'Plan prices cannot be negative.' using errcode = '22023';
  end if;

  if coalesce(p_max_students, 0) < 0
    or coalesce(p_max_courses, 0) < 0
    or coalesce(p_max_team_members, 0) < 0
    or coalesce(p_max_storage_mb, 0) < 0
    or coalesce(p_ai_monthly_limit, 0) < 0
    or coalesce(p_marketing_monthly_limit, 0) < 0 then
    raise exception 'Plan limits cannot be negative.' using errcode = '22023';
  end if;

  select id into existing_id
  from public.platform_subscription_plans
  where code = normalized_code;

  insert into public.platform_subscription_plans (
    code,
    name,
    description,
    monthly_price,
    yearly_price,
    currency,
    max_students,
    max_courses,
    max_team_members,
    max_storage_mb,
    ai_monthly_limit,
    marketing_monthly_limit,
    features_json,
    status
  )
  values (
    normalized_code,
    normalized_name,
    normalized_description,
    coalesce(p_monthly_price, 0),
    coalesce(p_yearly_price, 0),
    normalized_currency,
    p_max_students,
    p_max_courses,
    p_max_team_members,
    p_max_storage_mb,
    p_ai_monthly_limit,
    p_marketing_monthly_limit,
    normalized_features,
    normalized_status
  )
  on conflict (code) do update
  set
    name = excluded.name,
    description = excluded.description,
    monthly_price = excluded.monthly_price,
    yearly_price = excluded.yearly_price,
    currency = excluded.currency,
    max_students = excluded.max_students,
    max_courses = excluded.max_courses,
    max_team_members = excluded.max_team_members,
    max_storage_mb = excluded.max_storage_mb,
    ai_monthly_limit = excluded.ai_monthly_limit,
    marketing_monthly_limit = excluded.marketing_monthly_limit,
    features_json = excluded.features_json,
    status = excluded.status,
    updated_at = now()
  returning id into saved_id;

  perform public.platform_log_activity(
    null,
    case
      when existing_id is null then 'platform_plan_created'
      when normalized_status = 'archived' then 'platform_plan_archived'
      else 'platform_plan_updated'
    end,
    'platform_subscription_plan',
    saved_id,
    jsonb_build_object('plan_code', normalized_code, 'status', normalized_status)
  );

  return saved_id;
end;
$$;

create or replace function public.update_tenant_subscription(
  p_tenant_id uuid,
  p_plan_id uuid default null,
  p_status text default 'trial',
  p_billing_cycle text default 'monthly',
  p_trial_started_at timestamptz default null,
  p_trial_ends_at timestamptz default null,
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_amount numeric default 0,
  p_currency text default 'INR',
  p_payment_status text default 'not_required',
  p_notes text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(trim(coalesce(p_status, 'trial')));
  normalized_billing_cycle text := lower(trim(coalesce(p_billing_cycle, 'monthly')));
  normalized_currency text := upper(trim(coalesce(p_currency, 'INR')));
  normalized_payment_status text := lower(trim(coalesce(p_payment_status, 'not_required')));
  normalized_notes text := public.platform_normalize_text(p_notes, 'notes', false, 1500);
  normalized_metadata jsonb := public.platform_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  old_subscription public.platform_tenant_subscriptions%rowtype;
  saved_id uuid;
begin
  if not public.platform_can_manage_billing() then
    raise exception 'Platform billing access is required.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  if p_plan_id is not null and not exists (select 1 from public.platform_subscription_plans where id = p_plan_id) then
    raise exception 'Platform plan not found.' using errcode = '22023';
  end if;

  if normalized_status not in ('trial', 'active', 'past_due', 'suspended', 'cancelled') then
    raise exception 'Invalid subscription status.' using errcode = '22023';
  end if;

  if normalized_billing_cycle not in ('monthly', 'yearly', 'custom') then
    raise exception 'Invalid billing cycle.' using errcode = '22023';
  end if;

  if normalized_currency <> 'INR' then
    raise exception 'Only INR currency is supported.' using errcode = '22023';
  end if;

  if normalized_payment_status not in ('not_required', 'unpaid', 'paid', 'overdue', 'waived') then
    raise exception 'Invalid payment status.' using errcode = '22023';
  end if;

  if coalesce(p_amount, 0) < 0 then
    raise exception 'Subscription amount cannot be negative.' using errcode = '22023';
  end if;

  if p_trial_started_at is not null and p_trial_ends_at is not null and p_trial_started_at > p_trial_ends_at then
    raise exception 'Trial start cannot be after trial end.' using errcode = '22023';
  end if;

  if p_current_period_start is not null and p_current_period_end is not null and p_current_period_start > p_current_period_end then
    raise exception 'Current period start cannot be after current period end.' using errcode = '22023';
  end if;

  select * into old_subscription
  from public.platform_tenant_subscriptions
  where tenant_id = p_tenant_id;

  insert into public.platform_tenant_subscriptions (
    tenant_id,
    plan_id,
    status,
    billing_cycle,
    trial_started_at,
    trial_ends_at,
    current_period_start,
    current_period_end,
    amount,
    currency,
    payment_status,
    notes,
    metadata_json
  )
  values (
    p_tenant_id,
    p_plan_id,
    normalized_status,
    normalized_billing_cycle,
    p_trial_started_at,
    p_trial_ends_at,
    p_current_period_start,
    p_current_period_end,
    coalesce(p_amount, 0),
    normalized_currency,
    normalized_payment_status,
    normalized_notes,
    normalized_metadata
  )
  on conflict (tenant_id) do update
  set
    plan_id = excluded.plan_id,
    status = excluded.status,
    billing_cycle = excluded.billing_cycle,
    trial_started_at = excluded.trial_started_at,
    trial_ends_at = excluded.trial_ends_at,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    amount = excluded.amount,
    currency = excluded.currency,
    payment_status = excluded.payment_status,
    notes = excluded.notes,
    metadata_json = excluded.metadata_json,
    updated_at = now()
  returning id into saved_id;

  perform public.platform_log_activity(
    p_tenant_id,
    case
      when old_subscription.id is null then 'tenant_subscription_created'
      when old_subscription.status is distinct from normalized_status then 'tenant_subscription_status_changed'
      when old_subscription.payment_status is distinct from normalized_payment_status then 'tenant_subscription_payment_status_changed'
      else 'tenant_subscription_updated'
    end,
    'platform_tenant_subscription',
    saved_id,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'plan_id', p_plan_id,
      'subscription_status', normalized_status,
      'payment_status', normalized_payment_status,
      'amount', coalesce(p_amount, 0),
      'currency', normalized_currency,
      'notes_present', normalized_notes is not null
    )
  );

  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    auth.uid(),
    'tenant_subscription_updated',
    'platform_tenant_subscription',
    saved_id,
    'Platform subscription settings were updated.',
    case when normalized_status in ('past_due', 'suspended', 'cancelled') then 'warning' else 'info' end,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'plan_id', p_plan_id,
      'subscription_status', normalized_status,
      'payment_status', normalized_payment_status,
      'amount', coalesce(p_amount, 0),
      'currency', normalized_currency,
      'notes_present', normalized_notes is not null
    )
  );

  return saved_id;
end;
$$;

create or replace function public.record_platform_support_note(
  p_tenant_id uuid,
  p_note_type text default 'general',
  p_note text default null,
  p_status text default 'open',
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_type text := lower(trim(coalesce(p_note_type, 'general')));
  normalized_note text := public.platform_normalize_text(p_note, 'note', true, 2000);
  normalized_status text := lower(trim(coalesce(p_status, 'open')));
  normalized_metadata jsonb := public.platform_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  saved_id uuid;
begin
  if not public.platform_can_manage_support() then
    raise exception 'Platform support access is required.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  if normalized_type not in ('general', 'billing', 'technical', 'onboarding', 'risk', 'follow_up') then
    raise exception 'Invalid support note type.' using errcode = '22023';
  end if;

  if normalized_status not in ('open', 'in_progress', 'resolved', 'archived') then
    raise exception 'Invalid support note status.' using errcode = '22023';
  end if;

  insert into public.platform_support_notes (
    tenant_id,
    created_by,
    note_type,
    note,
    status,
    metadata_json
  )
  values (
    p_tenant_id,
    auth.uid(),
    normalized_type,
    normalized_note,
    normalized_status,
    normalized_metadata
  )
  returning id into saved_id;

  perform public.platform_log_activity(
    p_tenant_id,
    'platform_support_note_created',
    'platform_support_note',
    saved_id,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'note_type', normalized_type,
      'status', normalized_status,
      'note_present', true
    )
  );

  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    auth.uid(),
    'platform_support_note_created',
    'platform_support_note',
    saved_id,
    'A platform support note was created.',
    case when normalized_type = 'risk' then 'warning' else 'info' end,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'note_type', normalized_type,
      'status', normalized_status,
      'note_present', true
    )
  );

  return saved_id;
end;
$$;

create or replace function public.update_platform_support_note(
  p_note_id uuid,
  p_note text default null,
  p_status text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  note_row public.platform_support_notes%rowtype;
  normalized_note text;
  normalized_status text;
  normalized_metadata jsonb := public.platform_validate_json_object(p_metadata_json, 'metadata_json', 3000);
begin
  if not public.platform_can_manage_support() then
    raise exception 'Platform support access is required.' using errcode = '42501';
  end if;

  select * into note_row
  from public.platform_support_notes
  where id = p_note_id;

  if note_row.id is null then
    raise exception 'Support note not found.' using errcode = '22023';
  end if;

  normalized_note := coalesce(
    public.platform_normalize_text(p_note, 'note', false, 2000),
    note_row.note
  );
  normalized_status := coalesce(nullif(lower(trim(coalesce(p_status, ''))), ''), note_row.status);

  if normalized_status not in ('open', 'in_progress', 'resolved', 'archived') then
    raise exception 'Invalid support note status.' using errcode = '22023';
  end if;

  update public.platform_support_notes
  set
    note = normalized_note,
    status = normalized_status,
    metadata_json = normalized_metadata,
    updated_at = now()
  where id = note_row.id;

  perform public.platform_log_activity(
    note_row.tenant_id,
    'platform_support_note_updated',
    'platform_support_note',
    note_row.id,
    jsonb_build_object(
      'tenant_id', note_row.tenant_id,
      'old_status', note_row.status,
      'new_status', normalized_status,
      'note_present', true
    )
  );

  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description,
    severity,
    metadata
  )
  values (
    note_row.tenant_id,
    auth.uid(),
    'platform_support_note_updated',
    'platform_support_note',
    note_row.id,
    'A platform support note was updated.',
    case when normalized_status = 'archived' then 'warning' else 'info' end,
    jsonb_build_object(
      'tenant_id', note_row.tenant_id,
      'old_status', note_row.status,
      'new_status', normalized_status,
      'note_present', true
    )
  );

  return note_row.id;
end;
$$;

create or replace function public.capture_platform_usage_snapshot(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  students_total integer;
  courses_total integer;
  team_total integer;
  ai_total integer;
  marketing_total integer;
  saved_id uuid;
begin
  if public.platform_current_role() not in ('owner', 'admin') then
    raise exception 'Only platform owner/admin can capture usage snapshots.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  select count(*) into students_total from public.students where tenant_id = p_tenant_id;
  select count(*) into courses_total from public.courses where tenant_id = p_tenant_id;
  select count(*) into team_total from public.tenant_members where tenant_id = p_tenant_id;
  select count(*) into ai_total from public.ai_request_logs where tenant_id = p_tenant_id and created_at >= date_trunc('month', now());
  select count(*) into marketing_total from public.marketing_campaigns where tenant_id = p_tenant_id;

  insert into public.platform_tenant_usage_snapshots (
    tenant_id,
    snapshot_date,
    students_count,
    courses_count,
    team_members_count,
    ai_requests_count,
    marketing_campaigns_count,
    storage_mb,
    metadata_json
  )
  values (
    p_tenant_id,
    current_date,
    students_total,
    courses_total,
    team_total,
    ai_total,
    marketing_total,
    0,
    jsonb_build_object('storage_calculation', 'not_available')
  )
  on conflict (tenant_id, snapshot_date) do update
  set
    students_count = excluded.students_count,
    courses_count = excluded.courses_count,
    team_members_count = excluded.team_members_count,
    ai_requests_count = excluded.ai_requests_count,
    marketing_campaigns_count = excluded.marketing_campaigns_count,
    storage_mb = excluded.storage_mb,
    metadata_json = excluded.metadata_json
  returning id into saved_id;

  perform public.platform_log_activity(
    p_tenant_id,
    'platform_usage_snapshot_captured',
    'platform_tenant_usage_snapshot',
    saved_id,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'students_count', students_total,
      'courses_count', courses_total,
      'team_members_count', team_total,
      'ai_requests_count', ai_total,
      'marketing_campaigns_count', marketing_total,
      'storage_mb', 0
    )
  );

  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    auth.uid(),
    'platform_usage_snapshot_captured',
    'platform_tenant_usage_snapshot',
    saved_id,
    'A platform usage snapshot was captured.',
    'info',
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'students_count', students_total,
      'courses_count', courses_total,
      'team_members_count', team_total,
      'ai_requests_count', ai_total,
      'marketing_campaigns_count', marketing_total,
      'storage_mb', 0
    )
  );

  return saved_id;
end;
$$;

create or replace function public.manage_platform_admin_user(
  p_user_id uuid,
  p_role text,
  p_status text default 'active',
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_role text := lower(trim(coalesce(p_role, '')));
  normalized_status text := lower(trim(coalesce(p_status, 'active')));
  normalized_metadata jsonb := public.platform_validate_json_object(p_metadata_json, 'metadata_json', 3000);
  target_existing_role text;
  target_existing_status text;
  other_active_owner_count integer := 0;
begin
  if not public.platform_can_manage_admins() then
    raise exception 'Only platform owner can manage platform admins.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'User id is required.' using errcode = '22023';
  end if;

  if normalized_role not in ('owner', 'admin', 'support', 'finance') then
    raise exception 'Invalid platform role.' using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'suspended') then
    raise exception 'Invalid platform admin status.' using errcode = '22023';
  end if;

  select role, status
  into target_existing_role, target_existing_status
  from public.platform_admin_users
  where user_id = p_user_id;

  if target_existing_role = 'owner'
    and target_existing_status = 'active'
    and (normalized_role <> 'owner' or normalized_status <> 'active') then
    select count(*)
    into other_active_owner_count
    from public.platform_admin_users
    where role = 'owner'
      and status = 'active'
      and user_id <> p_user_id;

    if other_active_owner_count = 0 then
      raise exception 'Cannot remove or suspend the last active platform owner.' using errcode = '42501';
    end if;
  end if;

  insert into public.platform_admin_users (
    user_id,
    role,
    status,
    created_by,
    metadata_json
  )
  values (
    p_user_id,
    normalized_role,
    normalized_status,
    auth.uid(),
    normalized_metadata
  )
  on conflict (user_id) do update
  set
    role = excluded.role,
    status = excluded.status,
    metadata_json = excluded.metadata_json,
    updated_at = now();

  perform public.platform_log_activity(
    null,
    case when normalized_status = 'suspended' then 'platform_admin_suspended' else 'platform_admin_added' end,
    'platform_admin_user',
    p_user_id,
    jsonb_build_object('role', normalized_role, 'status', normalized_status)
  );

  return p_user_id;
end;
$$;

revoke execute on function public.platform_current_role() from public;
revoke execute on function public.is_platform_admin() from public;
revoke execute on function public.platform_can_manage_admins() from public;
revoke execute on function public.platform_can_manage_billing() from public;
revoke execute on function public.platform_can_manage_support() from public;
revoke execute on function public.platform_can_view_tenant(uuid) from public;
revoke execute on function public.platform_normalize_text(text, text, boolean, integer) from public;
revoke execute on function public.platform_validate_json_object(jsonb, text, integer) from public;
revoke execute on function public.platform_log_activity(uuid, text, text, uuid, jsonb) from public;

grant execute on function public.platform_current_role() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.platform_can_manage_admins() to authenticated;
grant execute on function public.platform_can_manage_billing() to authenticated;
grant execute on function public.platform_can_manage_support() to authenticated;
grant execute on function public.platform_can_view_tenant(uuid) to authenticated;

revoke execute on function public.platform_normalize_text(text, text, boolean, integer) from authenticated;
revoke execute on function public.platform_validate_json_object(jsonb, text, integer) from authenticated;
revoke execute on function public.platform_log_activity(uuid, text, text, uuid, jsonb) from authenticated;

revoke execute on function public.get_platform_dashboard() from public;
revoke execute on function public.get_platform_tenants() from public;
revoke execute on function public.get_platform_tenant_detail(uuid) from public;
revoke execute on function public.upsert_platform_subscription_plan(text, text, text, numeric, numeric, text, integer, integer, integer, integer, integer, integer, jsonb, text) from public;
revoke execute on function public.update_tenant_subscription(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz, numeric, text, text, text, jsonb) from public;
revoke execute on function public.record_platform_support_note(uuid, text, text, text, jsonb) from public;
revoke execute on function public.update_platform_support_note(uuid, text, text, jsonb) from public;
revoke execute on function public.capture_platform_usage_snapshot(uuid) from public;
revoke execute on function public.manage_platform_admin_user(uuid, text, text, jsonb) from public;

grant execute on function public.get_platform_dashboard() to authenticated;
grant execute on function public.get_platform_tenants() to authenticated;
grant execute on function public.get_platform_tenant_detail(uuid) to authenticated;
grant execute on function public.upsert_platform_subscription_plan(text, text, text, numeric, numeric, text, integer, integer, integer, integer, integer, integer, jsonb, text) to authenticated;
grant execute on function public.update_tenant_subscription(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz, numeric, text, text, text, jsonb) to authenticated;
grant execute on function public.record_platform_support_note(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.update_platform_support_note(uuid, text, text, jsonb) to authenticated;
grant execute on function public.capture_platform_usage_snapshot(uuid) to authenticated;
grant execute on function public.manage_platform_admin_user(uuid, text, text, jsonb) to authenticated;
