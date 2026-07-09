-- Module 71.7G12: Requestable Plan Catalog + Duplicate Upgrade Request Guard
--
-- Review before execution. Do not execute automatically.
--
-- Scope:
-- - Adds a tenant-authenticated requestable plan catalog layer.
-- - Allows platform owner/admin to mark existing canonical plans as requestable
--   without making those plans public or exposing them to anon catalog callers.
-- - Updates request_plan_upgrade to use request options instead of is_public.
-- - Prevents duplicate open/in_review requests for the same tenant + plan.
--
-- Non-goals:
-- - Does not make starter/growth/premium active/public.
-- - Does not assign or change tenant subscription plans.
-- - Does not force payment, create checkout, create invoices, or activate gateway features.
-- - Does not change Module 62 tenant_feature_settings behavior.
-- - Does not update legacy Module 56 billing state.

begin;

create table if not exists public.subscription_plan_request_options (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans(id) on delete cascade,
  status text not null default 'draft',
  display_order integer not null default 100,
  tenant_scope text not null default 'all',
  tenant_ids uuid[] not null default '{}'::uuid[],
  request_label text,
  request_description text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plan_request_options_plan_unique unique (plan_id),
  constraint subscription_plan_request_options_status_check check (
    status in ('draft', 'active', 'paused', 'archived')
  ),
  constraint subscription_plan_request_options_display_order_check check (
    display_order between 0 and 10000
  ),
  constraint subscription_plan_request_options_tenant_scope_check check (
    tenant_scope in ('all', 'regression_only', 'specific_tenants')
  ),
  constraint subscription_plan_request_options_tenant_ids_scope_check check (
    (
      tenant_scope = 'specific_tenants'
      and coalesce(array_length(tenant_ids, 1), 0) > 0
    )
    or (
      tenant_scope <> 'specific_tenants'
      and coalesce(array_length(tenant_ids, 1), 0) = 0
    )
  ),
  constraint subscription_plan_request_options_label_check check (
    request_label is null
    or (
      char_length(request_label) <= 120
      and position('<' in request_label) = 0
      and position('>' in request_label) = 0
    )
  ),
  constraint subscription_plan_request_options_description_check check (
    request_description is null
    or (
      char_length(request_description) <= 500
      and position('<' in request_description) = 0
      and position('>' in request_description) = 0
    )
  ),
  constraint subscription_plan_request_options_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create index if not exists subscription_plan_request_options_status_order_idx
on public.subscription_plan_request_options (status, display_order, created_at);

create index if not exists subscription_plan_request_options_tenant_ids_idx
on public.subscription_plan_request_options using gin (tenant_ids);

create unique index if not exists tenant_plan_upgrade_requests_open_plan_unique_idx
on public.tenant_plan_upgrade_requests (tenant_id, requested_plan_id)
where status in ('open', 'in_review') and requested_plan_id is not null;

drop trigger if exists set_subscription_plan_request_options_updated_at
on public.subscription_plan_request_options;
create trigger set_subscription_plan_request_options_updated_at
before update on public.subscription_plan_request_options
for each row execute function public.set_updated_at();

alter table public.subscription_plan_request_options enable row level security;

revoke all privileges on table public.subscription_plan_request_options
from public, anon, authenticated;

create or replace function public.subscription_plan_request_option_matches_tenant(
  p_tenant_id uuid,
  p_tenant_scope text,
  p_tenant_ids uuid[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null then
    return false;
  end if;

  if p_tenant_scope = 'all' then
    return exists (select 1 from public.tenants t where t.id = p_tenant_id);
  end if;

  if p_tenant_scope = 'regression_only' then
    return exists (
      select 1
      from public.tenants t
      where t.id = p_tenant_id
        and t.slug = 'coachfort-regression'
    );
  end if;

  if p_tenant_scope = 'specific_tenants' then
    return p_tenant_id = any (coalesce(p_tenant_ids, '{}'::uuid[]));
  end if;

  return false;
end;
$$;

create or replace function public.get_tenant_requestable_plan_catalog(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_entitlement_state jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  v_role := public.subscription_entitlements_current_role(p_tenant_id);
  if not coalesce(v_role in ('owner', 'admin'), false) then
    raise exception 'Only tenant owners/admins can view requestable plans.' using errcode = '42501';
  end if;

  v_entitlement_state := public.get_tenant_entitlement_state(p_tenant_id);

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'plan_code', plan_page.code,
          'plan_name', plan_page.name,
          'tier_rank', plan_page.tier_rank,
          'trial_days', plan_page.trial_days,
          'display_order', plan_page.display_order,
          'request_label', plan_page.request_label,
          'request_description', plan_page.request_description,
          'current_assignment', coalesce(v_entitlement_state->'assignment', '{}'::jsonb),
          'has_open_request', exists (
            select 1
            from public.tenant_plan_upgrade_requests tpur
            where tpur.tenant_id = p_tenant_id
              and tpur.requested_plan_id = plan_page.plan_id
              and tpur.status in ('open', 'in_review')
          )
        )
        order by plan_page.display_order, plan_page.tier_rank, plan_page.code
      )
      from (
        select
          sp.id as plan_id,
          sp.code,
          sp.name,
          sp.tier_rank,
          sp.trial_days,
          spro.display_order,
          spro.request_label,
          spro.request_description
        from public.subscription_plan_request_options spro
        join public.subscription_plans sp on sp.id = spro.plan_id
        where spro.status = 'active'
          and sp.status <> 'archived'
          and public.subscription_plan_request_option_matches_tenant(
            p_tenant_id,
            spro.tenant_scope,
            spro.tenant_ids
          )
      ) plan_page
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.upsert_subscription_plan_request_option(
  p_plan_code text,
  p_status text default 'draft',
  p_display_order integer default 100,
  p_tenant_scope text default 'all',
  p_tenant_ids uuid[] default '{}'::uuid[],
  p_request_label text default null,
  p_request_description text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text := public.subscription_entitlements_normalize_plan_code(p_plan_code);
  v_status text := lower(trim(coalesce(p_status, '')));
  v_tenant_scope text := lower(trim(coalesce(p_tenant_scope, '')));
  v_tenant_ids uuid[] := coalesce(p_tenant_ids, '{}'::uuid[]);
  v_request_label text := public.subscription_entitlements_normalize_text(
    p_request_label,
    'request_label',
    false,
    120
  );
  v_request_description text := public.subscription_entitlements_normalize_text(
    p_request_description,
    'request_description',
    false,
    500
  );
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(
    p_metadata_json,
    'metadata_json',
    3000
  );
  v_plan_id uuid;
  v_option_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if v_status not in ('draft', 'active', 'paused', 'archived') then
    raise exception 'Invalid request option status.' using errcode = '22023';
  end if;

  if p_display_order is null or p_display_order < 0 or p_display_order > 10000 then
    raise exception 'display_order must be between 0 and 10000.' using errcode = '22023';
  end if;

  if v_tenant_scope not in ('all', 'regression_only', 'specific_tenants') then
    raise exception 'Invalid tenant scope.' using errcode = '22023';
  end if;

  if v_tenant_scope = 'specific_tenants' then
    if coalesce(array_length(v_tenant_ids, 1), 0) = 0 then
      raise exception 'specific_tenants scope requires tenant_ids.' using errcode = '22023';
    end if;

    if exists (
      select 1
      from unnest(v_tenant_ids) as requested_tenant_id
      where not exists (
        select 1
        from public.tenants t
        where t.id = requested_tenant_id
      )
    ) then
      raise exception 'tenant_ids contains an unknown tenant.' using errcode = '22023';
    end if;
  else
    v_tenant_ids := '{}'::uuid[];
  end if;

  select sp.id
  into v_plan_id
  from public.subscription_plans sp
  where sp.code = v_plan_code
    and sp.status <> 'archived';

  if v_plan_id is null then
    raise exception 'Plan not found or archived.' using errcode = '22023';
  end if;

  insert into public.subscription_plan_request_options (
    plan_id,
    status,
    display_order,
    tenant_scope,
    tenant_ids,
    request_label,
    request_description,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    v_plan_id,
    v_status,
    p_display_order,
    v_tenant_scope,
    v_tenant_ids,
    v_request_label,
    v_request_description,
    v_metadata,
    auth.uid(),
    auth.uid()
  )
  on conflict (plan_id) do update
  set status = excluded.status,
      display_order = excluded.display_order,
      tenant_scope = excluded.tenant_scope,
      tenant_ids = excluded.tenant_ids,
      request_label = excluded.request_label,
      request_description = excluded.request_description,
      metadata_json = excluded.metadata_json,
      updated_by = auth.uid(),
      updated_at = now()
  returning id into v_option_id;

  -- TODO: add platform-level activity logging if a null-tenant platform audit helper
  -- is introduced or explicitly confirmed safe for catalog-only changes.

  return v_option_id;
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

  if p_tenant_id is null
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  v_role := public.subscription_entitlements_current_role(p_tenant_id);
  if not coalesce(v_role in ('owner', 'admin'), false) then
    raise exception 'Only tenant owners/admins can request plan upgrades.' using errcode = '42501';
  end if;

  select sp.id
  into v_plan_id
  from public.subscription_plans sp
  join public.subscription_plan_request_options spro on spro.plan_id = sp.id
  where sp.code = v_requested_plan_code
    and sp.status <> 'archived'
    and spro.status = 'active'
    and public.subscription_plan_request_option_matches_tenant(
      p_tenant_id,
      spro.tenant_scope,
      spro.tenant_ids
    )
  limit 1;

  if v_plan_id is null then
    raise exception 'Requested plan is not available for upgrade requests.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenant_plan_upgrade_requests tpur
    where tpur.tenant_id = p_tenant_id
      and tpur.requested_plan_id = v_plan_id
      and tpur.status in ('open', 'in_review')
  ) then
    raise exception 'An open upgrade request for this plan already exists.' using errcode = '22023';
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
      'reason_present', v_reason is not null,
      'request_option_required', true
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

revoke all on function public.subscription_plan_request_option_matches_tenant(uuid, text, uuid[])
from public, anon, authenticated;
revoke all on function public.get_tenant_requestable_plan_catalog(uuid)
from public, anon, authenticated;
revoke all on function public.upsert_subscription_plan_request_option(
  text,
  text,
  integer,
  text,
  uuid[],
  text,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.request_plan_upgrade(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.get_tenant_requestable_plan_catalog(uuid)
to authenticated;
grant execute on function public.upsert_subscription_plan_request_option(
  text,
  text,
  integer,
  text,
  uuid[],
  text,
  text,
  jsonb
) to authenticated;
grant execute on function public.request_plan_upgrade(uuid, text, text)
to authenticated;

commit;

-- Verification SQL for later review/execution by a human.
-- Do not execute from Codex.
/*
-- 1. New table exists and RLS is enabled.
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'subscription_plan_request_options';

-- 2. Direct table privileges for PUBLIC/anon/authenticated remain absent.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'subscription_plan_request_options',
    'tenant_plan_upgrade_requests'
  )
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- 3. New/changed RPCs exist.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_tenant_requestable_plan_catalog',
    'upsert_subscription_plan_request_option',
    'request_plan_upgrade'
  )
order by routine_name;

-- 4. EXECUTE grants are authenticated-only; function bodies enforce roles.
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'get_tenant_requestable_plan_catalog',
    'upsert_subscription_plan_request_option',
    'request_plan_upgrade'
  )
order by routine_name, grantee, privilege_type;

-- 5. Confirm no existing duplicate open/in_review requests would violate the partial index.
select tenant_id, requested_plan_id, count(*) as open_request_count
from public.tenant_plan_upgrade_requests
where status in ('open', 'in_review')
  and requested_plan_id is not null
group by tenant_id, requested_plan_id
having count(*) > 1;

-- 6. Confirm no public plan activation happened as part of this patch.
select code, status, is_public
from public.subscription_plans
where code in ('starter', 'growth', 'premium')
order by tier_rank, code;

-- 7. Confirm no tenant assignments changed as part of this patch.
select count(*) as tenant_assignment_count
from public.tenant_subscription_assignments;

-- 8. Confirm request options are explicit and separate from public catalog visibility.
select sp.code, sp.status as plan_status, sp.is_public, spro.status as request_status,
       spro.tenant_scope, spro.display_order
from public.subscription_plan_request_options spro
join public.subscription_plans sp on sp.id = spro.plan_id
order by spro.display_order, sp.code;

-- Expected:
-- - Direct table grant query returns zero rows.
-- - Public catalog remains empty until separate public activation is approved.
-- - Tenant owner/admin can call get_tenant_requestable_plan_catalog(own tenant).
-- - Staff/trainer/student are denied by get_tenant_requestable_plan_catalog.
-- - request_plan_upgrade rejects plans without an active request option.
-- - request_plan_upgrade rejects duplicate open/in_review requests for the same tenant + plan.
-- - No checkout, payment, gateway, assignment, legacy billing, FeatureGate, or Module 62 behavior changes.
*/
