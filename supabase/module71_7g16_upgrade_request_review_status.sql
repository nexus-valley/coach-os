-- Module 71.7G16: Upgrade Request Review Status RPC
--
-- Review before execution. Do not execute automatically.
--
-- Scope:
-- - Adds review decision fields to tenant_plan_upgrade_requests.
-- - Adds an RPC for platform owner/admin review-status updates.
-- - Updates read RPCs to expose safe review fields.
--
-- Non-goals:
-- - Does not assign or change tenant subscription plans.
-- - Does not force payment, create checkout, create invoices, or activate gateway features.
-- - Does not change public plan visibility or requestable plan options.
-- - Does not change Module 62 tenant_feature_settings, FeatureGate, or legacy Module 56 billing state.

begin;

alter table public.tenant_plan_upgrade_requests
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists decision_metadata_json jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_plan_upgrade_requests_review_note_check'
      and conrelid = 'public.tenant_plan_upgrade_requests'::regclass
  ) then
    alter table public.tenant_plan_upgrade_requests
      add constraint tenant_plan_upgrade_requests_review_note_check check (
        review_note is null or (
          char_length(review_note) <= 1200
          and position('<' in review_note) = 0
          and position('>' in review_note) = 0
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_plan_upgrade_requests_decision_metadata_object_check'
      and conrelid = 'public.tenant_plan_upgrade_requests'::regclass
  ) then
    alter table public.tenant_plan_upgrade_requests
      add constraint tenant_plan_upgrade_requests_decision_metadata_object_check check (
        jsonb_typeof(decision_metadata_json) = 'object'
        and char_length(decision_metadata_json::text) <= 3000
      );
  end if;
end;
$$;

create index if not exists tenant_plan_upgrade_requests_tenant_status_updated_idx
on public.tenant_plan_upgrade_requests (tenant_id, status, updated_at desc);

revoke all privileges on table public.tenant_plan_upgrade_requests
from public, anon, authenticated;

create or replace function public.review_tenant_plan_upgrade_request(
  p_request_id uuid,
  p_status text,
  p_review_note text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_status text := lower(trim(coalesce(p_status, '')));
  v_review_note text := public.subscription_entitlements_normalize_text(
    p_review_note,
    'review_note',
    false,
    1200
  );
  v_metadata jsonb := public.subscription_entitlements_validate_json_object(
    p_metadata_json,
    'metadata_json',
    3000
  );
  v_request record;
  v_reviewed_at timestamptz := now();
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if p_request_id is null then
    raise exception 'Request id is required.' using errcode = '22023';
  end if;

  if v_target_status not in ('in_review', 'approved', 'rejected', 'cancelled') then
    raise exception 'Invalid review status.' using errcode = '22023';
  end if;

  select tpur.*
  into v_request
  from public.tenant_plan_upgrade_requests tpur
  where tpur.id = p_request_id
  for update;

  if not found then
    raise exception 'Upgrade request not found.' using errcode = '22023';
  end if;

  if v_request.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'Terminal upgrade requests cannot be reviewed again.' using errcode = '22023';
  end if;

  if v_request.status = v_target_status then
    raise exception 'Upgrade request already has this status.' using errcode = '22023';
  end if;

  if v_request.status = 'open'
     and v_target_status not in ('in_review', 'approved', 'rejected', 'cancelled') then
    raise exception 'Invalid status transition.' using errcode = '22023';
  end if;

  if v_request.status = 'in_review'
     and v_target_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'Invalid status transition.' using errcode = '22023';
  end if;

  if v_target_status in ('approved', 'rejected', 'cancelled')
     and v_review_note is null then
    raise exception 'review_note is required for terminal review decisions.' using errcode = '22023';
  end if;

  update public.tenant_plan_upgrade_requests as tpur
  set status = v_target_status,
      reviewed_by = auth.uid(),
      reviewed_at = v_reviewed_at,
      review_note = v_review_note,
      decision_metadata_json = v_metadata,
      updated_at = now()
  where tpur.id = p_request_id;

  perform public.platform_log_activity(
    v_request.tenant_id,
    'tenant_plan_upgrade_request_reviewed',
    'tenant_plan_upgrade_request',
    v_request.id,
    jsonb_build_object(
      'previous_status', v_request.status,
      'status', v_target_status,
      'requested_plan_code', v_request.requested_plan_code,
      'review_note_present', v_review_note is not null,
      'decision_metadata_present', v_metadata <> '{}'::jsonb,
      'assignment_changed', false,
      'payment_gateway_called', false
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'tenant_id', v_request.tenant_id,
    'requested_plan_code', v_request.requested_plan_code,
    'previous_status', v_request.status,
    'status', v_target_status,
    'reviewed_by', auth.uid(),
    'reviewed_at', v_reviewed_at,
    'review_note', v_review_note,
    'entitlement_changed', false,
    'payment_gateway_called', false,
    'assignment_changed', false
  );
end;
$$;

create or replace function public.get_platform_upgrade_requests(
  p_status text default null,
  p_tenant_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
begin
  perform public.subscription_entitlements_assert_platform_owner_admin();

  if v_status is not null and v_status not in ('open', 'in_review', 'approved', 'rejected', 'cancelled') then
    raise exception 'Invalid upgrade request status filter.' using errcode = '22023';
  end if;

  if v_limit <= 0 then
    raise exception 'Limit must be positive.' using errcode = '22023';
  end if;

  v_limit := least(v_limit, 100);

  if v_offset < 0 then
    raise exception 'Offset must be non-negative.' using errcode = '22023';
  end if;

  if p_tenant_id is not null and not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'request_id', request_page.id,
          'tenant_id', request_page.tenant_id,
          'tenant_name', request_page.tenant_name,
          'tenant_slug', request_page.tenant_slug,
          'requested_plan_code', request_page.requested_plan_code,
          'requested_plan_name', request_page.requested_plan_name,
          'requested_by', request_page.requested_by,
          'requested_by_email', request_page.requested_by_email,
          'reason', request_page.reason,
          'status', request_page.status,
          'created_at', request_page.created_at,
          'updated_at', request_page.updated_at,
          'reviewed_by', request_page.reviewed_by,
          'reviewed_by_email', request_page.reviewed_by_email,
          'reviewed_at', request_page.reviewed_at,
          'review_note', request_page.review_note,
          'decision_metadata_present', request_page.decision_metadata_json <> '{}'::jsonb,
          'current_assignment', coalesce(request_page.entitlement_state->'assignment', '{}'::jsonb),
          'payment_forced', coalesce((request_page.entitlement_state->>'payment_forced')::boolean, false),
          'gateway_required', coalesce((request_page.entitlement_state->>'gateway_required')::boolean, false),
          'metadata_present', request_page.metadata_json <> '{}'::jsonb
        )
        order by request_page.created_at desc, request_page.id desc
      )
      from (
        select
          tpur.id,
          tpur.tenant_id,
          tenants.name as tenant_name,
          tenants.slug as tenant_slug,
          tpur.requested_plan_code,
          requested_plan.name as requested_plan_name,
          tpur.requested_by,
          requested_user.email as requested_by_email,
          tpur.reason,
          tpur.status,
          tpur.metadata_json,
          tpur.created_at,
          tpur.updated_at,
          tpur.reviewed_by,
          reviewed_user.email as reviewed_by_email,
          tpur.reviewed_at,
          tpur.review_note,
          tpur.decision_metadata_json,
          public.get_tenant_entitlement_state(tpur.tenant_id) as entitlement_state
        from public.tenant_plan_upgrade_requests tpur
        join public.tenants tenants on tenants.id = tpur.tenant_id
        left join public.subscription_plans requested_plan on requested_plan.id = tpur.requested_plan_id
        left join auth.users requested_user on requested_user.id = tpur.requested_by
        left join auth.users reviewed_user on reviewed_user.id = tpur.reviewed_by
        where (v_status is null or tpur.status = v_status)
          and (p_tenant_id is null or tpur.tenant_id = p_tenant_id)
        order by tpur.created_at desc, tpur.id desc
        limit v_limit
        offset v_offset
      ) request_page
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.get_tenant_upgrade_requests(
  p_tenant_id uuid,
  p_status text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
  v_limit integer := coalesce(p_limit, 20);
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  v_role := public.subscription_entitlements_current_role(p_tenant_id);
  if not coalesce(v_role in ('owner', 'admin'), false) then
    raise exception 'Only tenant owners/admins can view plan upgrade requests.' using errcode = '42501';
  end if;

  if v_status is not null and v_status not in ('open', 'in_review', 'approved', 'rejected', 'cancelled') then
    raise exception 'Invalid upgrade request status filter.' using errcode = '22023';
  end if;

  if v_limit <= 0 then
    raise exception 'Limit must be positive.' using errcode = '22023';
  end if;

  v_limit := least(v_limit, 50);

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'request_id', request_page.id,
          'tenant_id', request_page.tenant_id,
          'requested_plan_code', request_page.requested_plan_code,
          'requested_plan_name', request_page.requested_plan_name,
          'reason', request_page.reason,
          'status', request_page.status,
          'created_at', request_page.created_at,
          'updated_at', request_page.updated_at,
          'reviewed_by', request_page.reviewed_by,
          'reviewed_by_email', request_page.reviewed_by_email,
          'reviewed_at', request_page.reviewed_at,
          'review_note', request_page.review_note,
          'decision_metadata_present', request_page.decision_metadata_json <> '{}'::jsonb,
          'entitlement_changed', false,
          'payment_gateway_called', false
        )
        order by request_page.created_at desc, request_page.id desc
      )
      from (
        select
          tpur.id,
          tpur.tenant_id,
          tpur.requested_plan_code,
          requested_plan.name as requested_plan_name,
          tpur.reason,
          tpur.status,
          tpur.created_at,
          tpur.updated_at,
          tpur.reviewed_by,
          reviewed_user.email as reviewed_by_email,
          tpur.reviewed_at,
          tpur.review_note,
          tpur.decision_metadata_json
        from public.tenant_plan_upgrade_requests tpur
        left join public.subscription_plans requested_plan on requested_plan.id = tpur.requested_plan_id
        left join auth.users reviewed_user on reviewed_user.id = tpur.reviewed_by
        where tpur.tenant_id = p_tenant_id
          and (v_status is null or tpur.status = v_status)
        order by tpur.created_at desc, tpur.id desc
        limit v_limit
      ) request_page
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.review_tenant_plan_upgrade_request(uuid, text, text, jsonb)
from public, anon, authenticated;
revoke all on function public.get_platform_upgrade_requests(text, uuid, integer, integer)
from public, anon, authenticated;
revoke all on function public.get_tenant_upgrade_requests(uuid, text, integer)
from public, anon, authenticated;

grant execute on function public.review_tenant_plan_upgrade_request(uuid, text, text, jsonb)
to authenticated;
grant execute on function public.get_platform_upgrade_requests(text, uuid, integer, integer)
to authenticated;
grant execute on function public.get_tenant_upgrade_requests(uuid, text, integer)
to authenticated;

commit;

-- Verification SQL for later review/execution by a human.
-- Do not execute from Codex.
/*
-- 1. Review columns exist.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tenant_plan_upgrade_requests'
  and column_name in (
    'reviewed_by',
    'reviewed_at',
    'review_note',
    'decision_metadata_json'
  )
order by column_name;

-- 2. Review constraints exist.
select conname
from pg_constraint
where conrelid = 'public.tenant_plan_upgrade_requests'::regclass
  and conname in (
    'tenant_plan_upgrade_requests_review_note_check',
    'tenant_plan_upgrade_requests_decision_metadata_object_check'
  )
order by conname;

-- 3. RPCs exist.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'review_tenant_plan_upgrade_request',
    'get_platform_upgrade_requests',
    'get_tenant_upgrade_requests'
  )
order by routine_name;

-- 4. Direct table privileges for PUBLIC/anon/authenticated remain absent.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'tenant_plan_upgrade_requests'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by grantee, privilege_type;

-- 5. EXECUTE grants are authenticated-only; function bodies enforce roles.
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'review_tenant_plan_upgrade_request',
    'get_platform_upgrade_requests',
    'get_tenant_upgrade_requests'
  )
order by routine_name, grantee, privilege_type;

-- 6. Existing regression request should still be open before review smoke.
select id, tenant_id, requested_plan_code, status, reviewed_by, reviewed_at, review_note
from public.tenant_plan_upgrade_requests
where id = '09d7ac7d-5fc7-432f-b362-88811ded6c25'::uuid;

-- 7. Canonical regression assignment should remain unchanged before/after review status changes.
select tsa.tenant_id, sp.code as plan_code, tsa.status, tsa.payment_status,
       tsa.currency, tsa.billing_cycle
from public.tenant_subscription_assignments tsa
join public.subscription_plans sp on sp.id = tsa.plan_id
where tsa.tenant_id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
  and tsa.is_current;

-- 8. Public catalog should remain empty and seed plans should remain draft/private.
select code, status, is_public
from public.subscription_plans
where code in ('starter', 'growth', 'premium')
order by tier_rank, code;

select count(*) as public_catalog_plan_count
from public.subscription_plans
where status = 'active'
  and is_public;

-- Expected:
-- - Direct table grant query returns zero rows.
-- - review_tenant_plan_upgrade_request exists and is executable by authenticated only.
-- - Platform owner/admin can mark open -> in_review.
-- - Tenant owner/admin, staff, trainer, student cannot call review RPC.
-- - Review RPC does not change tenant assignments, payments, checkout, gateway,
--   public catalog visibility, request options, Module 62, FeatureGate, or legacy Module 56.
*/
