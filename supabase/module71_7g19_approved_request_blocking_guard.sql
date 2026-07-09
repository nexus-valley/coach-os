-- Module 71.7G19 - Approved Request Blocking Guard
-- Purpose:
-- - Prevent duplicate same-plan upgrade requests when an earlier request is
--   approved but the tenant has not yet been assigned to that plan.
-- - Preserve request-only behavior: no assignment, payment, checkout, gateway,
--   Module 62, FeatureGate, public catalog, request option, or legacy billing
--   mutation is introduced here.

do $$
begin
  if exists (
    select 1
    from public.tenant_plan_upgrade_requests tpur
    where tpur.requested_plan_id is not null
      and tpur.status in ('open', 'in_review', 'approved')
    group by tpur.tenant_id, tpur.requested_plan_id
    having count(*) > 1
  ) then
    raise exception 'Cannot add approved-request blocking guard while duplicate blocking upgrade requests exist.'
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists tenant_plan_upgrade_requests_blocking_plan_unique_idx
on public.tenant_plan_upgrade_requests (tenant_id, requested_plan_id)
where status in ('open', 'in_review', 'approved')
  and requested_plan_id is not null;

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
  v_current_plan_code text;
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
  v_current_plan_code := nullif(v_entitlement_state #>> '{assignment,plan_code}', '');

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
          'has_open_request', plan_page.has_open_request,
          'has_blocking_request', plan_page.has_blocking_request,
          'blocking_request_status', plan_page.blocking_request_status,
          'latest_request_status', plan_page.latest_request_status,
          'latest_request_id', plan_page.latest_request_id,
          'latest_review_note', plan_page.latest_review_note,
          'latest_reviewed_at', plan_page.latest_reviewed_at
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
          spro.request_description,
          exists (
            select 1
            from public.tenant_plan_upgrade_requests tpur
            where tpur.tenant_id = p_tenant_id
              and tpur.requested_plan_id = sp.id
              and tpur.status in ('open', 'in_review')
          ) as has_open_request,
          blocking_request.id is not null as has_blocking_request,
          blocking_request.status as blocking_request_status,
          latest_request.status as latest_request_status,
          latest_request.id as latest_request_id,
          latest_request.review_note as latest_review_note,
          latest_request.reviewed_at as latest_reviewed_at
        from public.subscription_plan_request_options spro
        join public.subscription_plans sp on sp.id = spro.plan_id
        left join lateral (
          select
            tpur.id,
            tpur.status,
            tpur.review_note,
            tpur.reviewed_at
          from public.tenant_plan_upgrade_requests tpur
          where tpur.tenant_id = p_tenant_id
            and tpur.requested_plan_id = sp.id
          order by tpur.updated_at desc, tpur.created_at desc, tpur.id
          limit 1
        ) latest_request on true
        left join lateral (
          select
            tpur.id,
            tpur.status
          from public.tenant_plan_upgrade_requests tpur
          where tpur.tenant_id = p_tenant_id
            and tpur.requested_plan_id = sp.id
            and (
              tpur.status in ('open', 'in_review')
              or (
                tpur.status = 'approved'
                and v_current_plan_code is distinct from sp.code
              )
            )
          order by
            case tpur.status
              when 'open' then 1
              when 'in_review' then 2
              when 'approved' then 3
              else 4
            end,
            tpur.updated_at desc,
            tpur.created_at desc,
            tpur.id
          limit 1
        ) blocking_request on true
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
  v_current_plan_code text;
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

  select sp.code
  into v_current_plan_code
  from public.tenant_subscription_assignments tsa
  join public.subscription_plans sp on sp.id = tsa.plan_id
  where tsa.tenant_id = p_tenant_id
    and tsa.is_current
  limit 1;

  if v_current_plan_code = v_requested_plan_code then
    raise exception 'Tenant is already assigned to this plan.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenant_plan_upgrade_requests tpur
    where tpur.tenant_id = p_tenant_id
      and tpur.requested_plan_id = v_plan_id
      and tpur.status in ('open', 'in_review')
  ) then
    raise exception 'An upgrade request for this plan is already open or in review.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenant_plan_upgrade_requests tpur
    where tpur.tenant_id = p_tenant_id
      and tpur.requested_plan_id = v_plan_id
      and tpur.status = 'approved'
      and v_current_plan_code is distinct from v_requested_plan_code
  ) then
    raise exception 'An approved upgrade request for this plan is waiting for platform follow-up.' using errcode = '22023';
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
      'request_option_required', true,
      'approved_repeat_guard_enabled', true
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

revoke all on function public.get_tenant_requestable_plan_catalog(uuid)
from public, anon, authenticated;
revoke all on function public.request_plan_upgrade(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.get_tenant_requestable_plan_catalog(uuid)
to authenticated;
grant execute on function public.request_plan_upgrade(uuid, text, text)
to authenticated;

-- Verification SQL for after approved execution only:
--
-- 1. Existing regression request should be approved before smoke.
-- select id, requested_plan_code, status
-- from public.tenant_plan_upgrade_requests
-- where id = '09d7ac7d-5fc7-432f-b362-88811ded6c25'::uuid;
--
-- 2. Regression tenant canonical assignment should remain starter.
-- select tsa.tenant_id, sp.code as plan_code, tsa.status, tsa.payment_status, tsa.currency, tsa.billing_cycle
-- from public.tenant_subscription_assignments tsa
-- join public.subscription_plans sp on sp.id = tsa.plan_id
-- where tsa.tenant_id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
--   and tsa.is_current;
--
-- 3. No duplicate blocking request rows should exist.
-- select tenant_id, requested_plan_id, count(*) as blocking_count
-- from public.tenant_plan_upgrade_requests
-- where requested_plan_id is not null
--   and status in ('open', 'in_review', 'approved')
-- group by tenant_id, requested_plan_id
-- having count(*) > 1;
--
-- 4. Blocking unique index should exist.
-- select indexname
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'tenant_plan_upgrade_requests'
--   and indexname = 'tenant_plan_upgrade_requests_blocking_plan_unique_idx';
--
-- 5. Tenant owner RPC smoke should show Growth blocked by approved request.
-- -- Execute through authenticated anon session, not direct SQL:
-- -- select public.get_tenant_requestable_plan_catalog('29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid);
-- -- Expected Growth fields:
-- -- has_open_request=false
-- -- has_blocking_request=true
-- -- blocking_request_status='approved'
-- -- latest_request_status='approved'
-- -- latest_request_id='09d7ac7d-5fc7-432f-b362-88811ded6c25'
--
-- 6. Tenant owner request_plan_upgrade smoke should reject Growth repeat.
-- -- Execute through authenticated anon session, not direct SQL:
-- -- public.request_plan_upgrade('29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid, 'growth', 'repeat guard smoke')
-- -- Expected: 22023, "An approved upgrade request for this plan is waiting for platform follow-up."
--
-- 7. No assignment/payment/gateway/public catalog change expected.
-- select code, status, is_public
-- from public.subscription_plans
-- where code in ('starter', 'growth', 'premium')
-- order by tier_rank;
