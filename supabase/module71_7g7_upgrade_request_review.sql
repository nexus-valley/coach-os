-- Module 71.7G7: Upgrade Request Review Visibility RPCs
--
-- Review before execution. Do not execute automatically.
--
-- Scope:
-- - Adds read-only RPCs for platform owner/admin review visibility.
-- - Adds read-only RPC for tenant owner/admin request history.
-- - Does not assign or change subscription plans.
-- - Does not force payment, create checkout, create invoices, or activate gateway features.
-- - Does not change Module 62 tenant_feature_settings behavior.
--
-- Security posture:
-- - tenant_plan_upgrade_requests direct table access remains revoked.
-- - Platform review list is platform owner/admin only in this first draft.
-- - Tenant request history is tenant owner/admin only for their own tenant.
-- - Staff/trainer/student cannot read or mutate upgrade request state.

begin;

revoke all privileges on table public.tenant_plan_upgrade_requests
from public, anon, authenticated;

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
          public.get_tenant_entitlement_state(tpur.tenant_id) as entitlement_state
        from public.tenant_plan_upgrade_requests tpur
        join public.tenants tenants on tenants.id = tpur.tenant_id
        left join public.subscription_plans requested_plan on requested_plan.id = tpur.requested_plan_id
        left join auth.users requested_user on requested_user.id = tpur.requested_by
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
          tpur.updated_at
        from public.tenant_plan_upgrade_requests tpur
        left join public.subscription_plans requested_plan on requested_plan.id = tpur.requested_plan_id
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

revoke all on function public.get_platform_upgrade_requests(text, uuid, integer, integer)
from public, anon, authenticated;
revoke all on function public.get_tenant_upgrade_requests(uuid, text, integer)
from public, anon, authenticated;

grant execute on function public.get_platform_upgrade_requests(text, uuid, integer, integer)
to authenticated;
grant execute on function public.get_tenant_upgrade_requests(uuid, text, integer)
to authenticated;

commit;

-- Verification SQL for later review/execution by a human.
-- Do not execute from Codex.
/*
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_platform_upgrade_requests',
    'get_tenant_upgrade_requests'
  )
order by routine_name;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'tenant_plan_upgrade_requests'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by grantee, privilege_type;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'get_platform_upgrade_requests',
    'get_tenant_upgrade_requests'
  )
order by routine_name, grantee, privilege_type;

-- Expected after execution:
-- - table grant query returns zero rows.
-- - both RPCs exist.
-- - EXECUTE is granted to authenticated only; function body enforces role.
-- - Platform owner/admin can call get_platform_upgrade_requests().
-- - Tenant owner/admin can call get_tenant_upgrade_requests(own_tenant_id).
-- - Staff/trainer are denied by get_tenant_upgrade_requests.
-- - Tenant owner/admin are denied by get_platform_upgrade_requests.
-- - Neither RPC mutates plan assignment, payments, checkout, gateway, or Module 62.
*/
