-- REGRESSION-R3B: noncommercial exclusion and commercial mutation boundary.
--
-- Review-only. Do not execute until the separately reviewed PRE is approved.
-- This migration does not issue or revoke a grant and does not change product
-- entitlement, usage, lifecycle, renewal, invoice, receipt, or provider logic.

-- ---------------------------------------------------------------------------
-- PRE-APPLY READ-ONLY VERIFICATION
-- ---------------------------------------------------------------------------

with
expected_targets(identity, expected_sha256, expected_search_path,
                 authenticated_execute, service_execute) as (
  values
    (
      'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
      '24937832f4955b1f93856aa774befc3163177597a043b9231d560879ca6fc0c7',
      'search_path=public', true, false
    ),
    (
      'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
      '856a57613ac1a7e4fc245ac1b8fa5e8cf8fc431a5d19f93ce250115a10d95f99',
      'search_path=public', true, false
    ),
    (
      'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
      '082779ec79038f6eaabbaac5738171b04924f160d3134a3bc559a664e2d4d0c7',
      'search_path=public, pg_temp', false, true
    )
),
target_state as (
  select
    count(procedure.oid) = (select count(*) from expected_targets)
      as exact_target_identities,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig @> array[expected.expected_search_path]::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ) = expected.authenticated_execute
      and has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) = expected.service_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false) as exact_target_baseline
  from expected_targets expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
expected_r2(identity, expected_sha256, expected_volatility,
            service_execute) as (
  values
    (
      'coachfort_internal.tenant_noncommercial_access_authority(uuid,uuid,uuid)',
      'd92e3b03aa7e216564b99c493cc048b0f4318833d885f0523ee027604a5a2543',
      's', false
    ),
    (
      'coachfort_internal.enforce_noncommercial_payment_order_boundary()',
      '20300988e6b8b7be9a5ad37972cc1ebad8b7ec1c34bd9c578f2b9a0e25c122ac',
      'v', false
    ),
    (
      'public.grant_tenant_noncommercial_access_server(uuid,uuid,text,text,uuid)',
      '414d791d20a6474a14bcbcc9dc2ea308ebc923b79c93d0634a634f925d71fa3d',
      'v', true
    ),
    (
      'public.revoke_tenant_noncommercial_access_server(uuid,uuid,uuid,text,uuid)',
      '3621bea92d3294711cd3c04f1cd3316e07ac468cd944d916ab95e17bf240b9ac',
      'v', true
    )
),
r2_function_state as (
  select
    count(procedure.oid) = (select count(*) from expected_r2)
      as exact_r2_identities,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = expected.expected_volatility::"char"
      and procedure.proconfig @>
        array['search_path=public, pg_temp']::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) = expected.service_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false) as exact_r2_function_baseline
  from expected_r2 expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
r2_relation_state as (
  select
    to_regclass(
      'coachfort_internal.tenant_noncommercial_access_grants'
    ) is not null as grants_present,
    to_regclass(
      'coachfort_internal.tenant_noncommercial_access_events'
    ) is not null as events_present,
    to_regclass(
      'coachfort_internal.tenant_fixture_classifications'
    ) is not null as fixture_classification_present,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tenant_subscription_assignments'
        and column_name = 'noncommercial_grant_id'
        and data_type = 'uuid'
    ) as assignment_grant_column_present,
    exists (
      select 1
      from pg_constraint constraint_definition
      where constraint_definition.conrelid =
          'public.tenant_subscription_assignments'::regclass
        and constraint_definition.conname =
          'tenant_subscription_assignments_noncommercial_contract_check'
        and constraint_definition.convalidated
        and lower(pg_get_constraintdef(constraint_definition.oid))
          like '%status = ''noncommercial''%'
        and lower(pg_get_constraintdef(constraint_definition.oid))
          like '%source = ''platform_noncommercial''%'
        and lower(pg_get_constraintdef(constraint_definition.oid))
          like '%noncommercial_grant_id is not null%'
    ) as assignment_contract_present,
    exists (
      select 1
      from pg_trigger trigger_definition
      where trigger_definition.tgrelid =
          'public.tenant_payment_orders'::regclass
        and trigger_definition.tgname =
          'enforce_noncommercial_payment_order_boundary'
        and not trigger_definition.tgisinternal
        and trigger_definition.tgenabled = 'O'
        and trigger_definition.tgfoid = to_regprocedure(
          'coachfort_internal.enforce_noncommercial_payment_order_boundary()'
        )
    ) as payment_boundary_trigger_present
),
install_state as (
  select
    to_regprocedure(
      'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)'
    ) is null
    and not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'coachfort_internal'
        and procedure.proname =
          'tenant_has_noncommercial_regression_evidence'
    ) as clean_install_state,
    (
      select count(*) = 0
      from coachfort_internal.tenant_noncommercial_access_grants
    ) as no_grants_issued
)
select
  target_state.*,
  r2_function_state.*,
  r2_relation_state.*,
  install_state.*,
  target_state.exact_target_identities
    and target_state.exact_target_baseline
    and r2_function_state.exact_r2_identities
    and r2_function_state.exact_r2_function_baseline
    and r2_relation_state.grants_present
    and r2_relation_state.events_present
    and r2_relation_state.fixture_classification_present
    and r2_relation_state.assignment_grant_column_present
    and r2_relation_state.assignment_contract_present
    and r2_relation_state.payment_boundary_trigger_present
    and install_state.clean_install_state
    and install_state.no_grants_issued as ready_for_apply
from target_state
cross join r2_function_state
cross join r2_relation_state
cross join install_state;

-- ---------------------------------------------------------------------------
-- APPLY (TRANSACTIONAL; DO NOT RUN AS PART OF REVIEW)
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_targets_ready boolean;
  v_r2_functions_ready boolean;
begin
  if to_regnamespace('coachfort_internal') is null
     or to_regclass('public.tenants') is null
     or to_regclass('public.subscription_plans') is null
     or to_regclass('public.tenant_subscription_assignments') is null
     or to_regclass('public.platform_tenant_subscriptions') is null
     or to_regclass('public.tenant_payment_orders') is null
     or to_regclass(
       'coachfort_internal.tenant_noncommercial_access_grants'
     ) is null
     or to_regclass(
       'coachfort_internal.tenant_noncommercial_access_events'
     ) is null
     or to_regclass(
       'coachfort_internal.tenant_fixture_classifications'
     ) is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'REGRESSION-R3B prerequisites are unavailable.'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)'
     ) is not null
     or exists (
       select 1
       from pg_proc procedure
       join pg_namespace namespace
         on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'coachfort_internal'
         and procedure.proname =
           'tenant_has_noncommercial_regression_evidence'
     ) then
    raise exception 'REGRESSION-R3B is already or partially installed.'
      using errcode = '55000';
  end if;

  with expected(identity, expected_sha256, expected_search_path,
                authenticated_execute, service_execute) as (
    values
      (
        'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
        '24937832f4955b1f93856aa774befc3163177597a043b9231d560879ca6fc0c7',
        'search_path=public', true, false
      ),
      (
        'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
        '856a57613ac1a7e4fc245ac1b8fa5e8cf8fc431a5d19f93ce250115a10d95f99',
        'search_path=public', true, false
      ),
      (
        'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
        '082779ec79038f6eaabbaac5738171b04924f160d3134a3bc559a664e2d4d0c7',
        'search_path=public, pg_temp', false, true
      )
  )
  select count(procedure.oid) = (select count(*) from expected)
    and coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig @> array[expected.expected_search_path]::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ) = expected.authenticated_execute
      and has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) = expected.service_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false)
  into v_targets_ready
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if not coalesce(v_targets_ready, false) then
    raise exception 'REGRESSION-R3B target function baseline has drifted.'
      using errcode = '55000';
  end if;

  with expected(identity, expected_sha256, expected_volatility,
                service_execute) as (
    values
      (
        'coachfort_internal.tenant_noncommercial_access_authority(uuid,uuid,uuid)',
        'd92e3b03aa7e216564b99c493cc048b0f4318833d885f0523ee027604a5a2543',
        's', false
      ),
      (
        'coachfort_internal.enforce_noncommercial_payment_order_boundary()',
        '20300988e6b8b7be9a5ad37972cc1ebad8b7ec1c34bd9c578f2b9a0e25c122ac',
        'v', false
      ),
      (
        'public.grant_tenant_noncommercial_access_server(uuid,uuid,text,text,uuid)',
        '414d791d20a6474a14bcbcc9dc2ea308ebc923b79c93d0634a634f925d71fa3d',
        'v', true
      ),
      (
        'public.revoke_tenant_noncommercial_access_server(uuid,uuid,uuid,text,uuid)',
        '3621bea92d3294711cd3c04f1cd3316e07ac468cd944d916ab95e17bf240b9ac',
        'v', true
      )
  )
  select count(procedure.oid) = (select count(*) from expected)
    and coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = expected.expected_volatility::"char"
      and procedure.proconfig @>
        array['search_path=public, pg_temp']::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) = expected.service_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false)
  into v_r2_functions_ready
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if not coalesce(v_r2_functions_ready, false)
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'tenant_subscription_assignments'
         and column_name = 'noncommercial_grant_id'
         and data_type = 'uuid'
     )
     or not exists (
       select 1
       from pg_constraint constraint_definition
       where constraint_definition.conrelid =
           'public.tenant_subscription_assignments'::regclass
         and constraint_definition.conname =
           'tenant_subscription_assignments_noncommercial_contract_check'
         and constraint_definition.convalidated
         and lower(pg_get_constraintdef(constraint_definition.oid))
           like '%status = ''noncommercial''%'
         and lower(pg_get_constraintdef(constraint_definition.oid))
           like '%source = ''platform_noncommercial''%'
         and lower(pg_get_constraintdef(constraint_definition.oid))
           like '%noncommercial_grant_id is not null%'
     )
     or not exists (
       select 1
       from pg_trigger trigger_definition
       where trigger_definition.tgrelid =
           'public.tenant_payment_orders'::regclass
         and trigger_definition.tgname =
           'enforce_noncommercial_payment_order_boundary'
         and not trigger_definition.tgisinternal
         and trigger_definition.tgenabled = 'O'
         and trigger_definition.tgfoid = to_regprocedure(
           'coachfort_internal.enforce_noncommercial_payment_order_boundary()'
         )
     ) then
    raise exception 'REGRESSION-R3B R2 authority baseline has drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from coachfort_internal.tenant_noncommercial_access_grants
  ) then
    raise exception 'REGRESSION-R3B must be installed before the first grant.'
      using errcode = '55000';
  end if;
end;
$$;

create temporary table regression_r3b_protected_baseline
on commit drop
as
select
  (select count(*) from public.tenants) as tenants,
  (select count(*) from public.tenant_subscription_assignments) as assignments,
  (select count(*) from public.platform_tenant_subscriptions) as projections,
  (select count(*) from public.tenant_payment_orders) as payment_orders,
  (select count(*) from coachfort_internal.tenant_noncommercial_access_grants)
    as grants,
  (select count(*) from coachfort_internal.tenant_noncommercial_access_events)
    as grant_events,
  (select count(*) from coachfort_internal.tenant_fixture_classifications)
    as fixture_classifications;

create function coachfort_internal.tenant_has_noncommercial_regression_evidence(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_tenant_id is null then true
    else
      exists (
        select 1
        from public.tenant_subscription_assignments assignment
        where assignment.tenant_id = p_tenant_id
          and assignment.is_current
          and (
            assignment.status = 'noncommercial'
            or assignment.source = 'platform_noncommercial'
            or assignment.noncommercial_grant_id is not null
          )
      )
      or exists (
        select 1
        from coachfort_internal.tenant_noncommercial_access_grants grant_row
        where grant_row.tenant_id = p_tenant_id
      )
      or exists (
        select 1
        from coachfort_internal.tenant_fixture_classifications classification
        where classification.tenant_id = p_tenant_id
          and classification.fixture_type = 'regression'
      )
  end;
$$;

alter function
  coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)
  owner to postgres;
revoke all on function
  coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)
  from public, anon, authenticated, service_role;

comment on function
  coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid) is
  'Fail-closed commercial-mutation exclusion. True for any current noncommercial marker, any durable grant including revoked evidence, any regression fixture classification, or null tenant input. Query failures raise.';

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
  v_current public.tenant_subscription_assignments%rowtype;
  v_id uuid;
begin
  perform public.subscription_entitlements_assert_platform_manager();

  perform tenant.id
  from public.tenants tenant
  where tenant.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  select plan.id into v_plan_id
  from public.subscription_plans plan
  where plan.code = v_plan_code
    and plan.status <> 'archived'
  for share;

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

  select * into v_current
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  limit 1
  for update;

  if coachfort_internal.tenant_has_noncommercial_regression_evidence(
       p_tenant_id
     ) then
    raise exception 'Noncommercial regression authority blocks generic subscription mutation.'
      using errcode = '42501';
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

  perform tenant.id
  from public.tenants tenant
  where tenant.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  if coachfort_internal.tenant_has_noncommercial_regression_evidence(
       p_tenant_id
     ) then
    raise exception 'Noncommercial regression authority blocks generic subscription mutation.'
      using errcode = '42501';
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

create or replace function public.create_platform_payment_order_authority_server(
  p_tenant_id uuid,
  p_created_by uuid,
  p_plan_id uuid,
  p_price_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_price public.subscription_plan_prices%rowtype;
  v_current public.tenant_subscription_assignments%rowtype;
  v_readiness jsonb;
  v_tax_calculation_status text;
  v_tax_amount_minor bigint;
  v_total_amount_minor bigint;
  v_order_id uuid := gen_random_uuid();
  v_provider_receipt text;
  v_billing_snapshot jsonb;
  v_issuer_snapshot jsonb;
  v_plan_snapshot jsonb;
  v_order_metadata jsonb;
begin
  if p_tenant_id is null or p_created_by is null or p_plan_id is null or p_price_id is null then
    raise exception 'Tenant, creator, plan, and price are required for checkout.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id and member.user_id = p_created_by
      and member.role in ('owner','admin')
  ) then
    raise exception 'Only tenant owners and admins can create payment orders.' using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  select * into v_price
  from public.subscription_plan_prices
  where id = p_price_id and plan_id = p_plan_id;

  if v_plan.id is null or v_price.id is null then
    raise exception 'Canonical checkout plan or price is unavailable.' using errcode = '22023';
  end if;

  if v_plan.code not in ('starter','growth')
     or v_plan.status <> 'draft' or v_plan.is_public
     or v_price.status <> 'draft'
     or v_price.currency <> 'INR'
     or v_price.billing_cycle not in ('monthly','yearly')
     or v_price.region_code <> 'GLOBAL'
     or coalesce(v_price.metadata_json->>'pricing_finalized', 'false') <> 'true'
     or coalesce(v_price.metadata_json->>'pricing_finalized_module', '') <> '71.7R0B'
     or coalesce(v_price.metadata_json->>'checkout_enabled', 'true') <> 'false' then
    raise exception 'Canonical price is not eligible for Razorpay test checkout.' using errcode = '22023';
  end if;

  v_readiness := coachfort_internal.assert_platform_billing_readiness(
    p_tenant_id,
    v_price.currency,
    now()
  );
  v_billing_snapshot := v_readiness#>'{customer,snapshot}';
  v_issuer_snapshot := v_readiness#>'{issuer,snapshot}';

  perform pg_advisory_xact_lock(hashtextextended(
    'ux8f1_checkout:' || p_tenant_id::text || ':' || p_plan_id::text || ':' || v_price.billing_cycle,
    81
  ));

  select * into v_current
  from public.tenant_subscription_assignments
  where tenant_id = p_tenant_id and is_current
  for share;

  if v_current.status = 'noncommercial'
     or v_current.source = 'platform_noncommercial'
     or v_current.noncommercial_grant_id is not null then
    raise exception 'Noncommercial regression authority is not eligible for payment checkout.'
      using errcode = '42501';
  end if;

  -- A distinct statement after assignment serialization gets a fresh READ
  -- COMMITTED snapshot after any lock wait. The unchanged R2 BEFORE INSERT
  -- trigger remains the final authority for a race that begins after this read.
  if coachfort_internal.tenant_has_noncommercial_regression_evidence(
       p_tenant_id
     ) then
    raise exception 'Noncommercial regression authority is not eligible for payment checkout.'
      using errcode = '42501';
  end if;

  if v_current.id is not null
     and v_current.plan_id = p_plan_id
     and v_current.billing_cycle = v_price.billing_cycle
     and v_current.status = 'active'
     and v_current.payment_status = 'paid' then
    raise exception 'This plan and billing cycle are already active. Renewal checkout is not available yet.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenant_payment_orders existing_order
    where existing_order.tenant_id = p_tenant_id
      and existing_order.plan_id = p_plan_id
      and existing_order.billing_cycle = v_price.billing_cycle
      and existing_order.internal_status not in ('failed','cancelled','expired','activated')
  ) then
    raise exception 'A checkout for this plan and billing cycle is already in progress.' using errcode = '22023';
  end if;

  v_tax_calculation_status := case
    when v_price.tax_behavior = 'not_applicable' then 'not_applicable'
    else 'not_calculated'
  end;
  v_tax_amount_minor := case when v_tax_calculation_status = 'not_applicable' then 0 else null end;
  v_total_amount_minor := v_price.amount_minor + v_price.setup_fee_amount_minor + coalesce(v_tax_amount_minor, 0);

  v_plan_snapshot := jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_code', v_plan.code,
    'plan_name', v_plan.name,
    'price_id', v_price.id,
    'billing_cycle', v_price.billing_cycle,
    'currency', v_price.currency,
    'region_code', v_price.region_code,
    'amount_minor', v_price.amount_minor,
    'unit_amount_minor', v_price.amount_minor,
    'setup_fee_amount_minor', v_price.setup_fee_amount_minor,
    'tax_amount_minor', v_tax_amount_minor,
    'tax_behavior', v_price.tax_behavior,
    'tax_calculation_status', v_tax_calculation_status,
    'total_amount_minor', v_total_amount_minor
  );
  v_order_metadata := jsonb_build_object(
    'activation_enabled', false,
    'browser_success_not_activation', true,
    'module', 'UX-8F1',
    'price_metadata_snapshot', coalesce(v_price.metadata_json, '{}'::jsonb),
    'public_launch_pending', true,
    'test_tenant_allowlisted', true
  );
  v_provider_receipt := 'cf_' || left(replace(v_order_id::text, '-', ''), 28);

  insert into public.tenant_payment_orders (
    id, tenant_id, created_by, plan_id, price_id, plan_code, billing_cycle,
    currency, amount_minor, setup_fee_amount_minor, tax_amount_minor,
    tax_calculation_status, total_amount_minor, provider, provider_mode,
    provider_receipt, internal_status, idempotency_key,
    checkout_enabled_source, metadata_json, billing_snapshot,
    issuer_snapshot, plan_snapshot, expires_at
  ) values (
    v_order_id, p_tenant_id, p_created_by, v_plan.id, v_price.id, v_plan.code,
    v_price.billing_cycle, v_price.currency, v_price.amount_minor,
    v_price.setup_fee_amount_minor, v_tax_amount_minor,
    v_tax_calculation_status, v_total_amount_minor, 'razorpay', 'test',
    v_provider_receipt, 'created', 'ux8f1:' || gen_random_uuid()::text,
    'regression_test_gate', v_order_metadata, v_billing_snapshot,
    v_issuer_snapshot, v_plan_snapshot, now() + interval '30 minutes'
  );

  return jsonb_build_object(
    'billing_snapshot', v_billing_snapshot,
    'issuer_snapshot', v_issuer_snapshot,
    'order_id', v_order_id,
    'order_metadata', v_order_metadata,
    'plan_snapshot', v_plan_snapshot,
    'provider_receipt', v_provider_receipt,
    'tax_amount_minor', v_tax_amount_minor,
    'tax_calculation_status', v_tax_calculation_status,
    'total_amount_minor', v_total_amount_minor
  );
end;
$$;

alter function public.set_tenant_subscription_plan(
  uuid,text,text,text,text,text,timestamptz,jsonb
) owner to postgres;
revoke all on function public.set_tenant_subscription_plan(
  uuid,text,text,text,text,text,timestamptz,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.set_tenant_subscription_plan(
  uuid,text,text,text,text,text,timestamptz,jsonb
) to authenticated;

alter function public.update_tenant_subscription(
  uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,
  numeric,text,text,text,jsonb
) owner to postgres;
revoke all on function public.update_tenant_subscription(
  uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,
  numeric,text,text,text,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.update_tenant_subscription(
  uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,
  numeric,text,text,text,jsonb
) to authenticated;

alter function public.create_platform_payment_order_authority_server(
  uuid,uuid,uuid,uuid
) owner to postgres;
revoke all on function public.create_platform_payment_order_authority_server(
  uuid,uuid,uuid,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_platform_payment_order_authority_server(
  uuid,uuid,uuid,uuid
) to service_role;

do $$
declare
  v_installed_contract boolean;
  v_baseline regression_r3b_protected_baseline%rowtype;
begin
  with expected(identity, expected_sha256, expected_search_path,
                authenticated_execute, service_execute) as (
    values
      (
        'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)',
        '3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed', 'search_path=public, pg_temp', false, false
      ),
      (
        'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
        'd8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5', 'search_path=public', true, false
      ),
      (
        'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
        'a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc', 'search_path=public', true, false
      ),
      (
        'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
        '6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11', 'search_path=public, pg_temp', false, true
      )
  )
  select count(procedure.oid) = (select count(*) from expected)
    and coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = case
        when expected.identity like 'coachfort_internal.%' then 's'::"char"
        else 'v'::"char"
      end
      and procedure.proconfig @> array[expected.expected_search_path]::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ) = expected.authenticated_execute
      and has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) = expected.service_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false)
  into v_installed_contract
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if not coalesce(v_installed_contract, false) then
    raise exception 'REGRESSION-R3B installed function contract is invalid.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_definition
    where trigger_definition.tgrelid =
        'public.tenant_payment_orders'::regclass
      and trigger_definition.tgname =
        'enforce_noncommercial_payment_order_boundary'
      and not trigger_definition.tgisinternal
      and trigger_definition.tgenabled = 'O'
      and trigger_definition.tgfoid = to_regprocedure(
        'coachfort_internal.enforce_noncommercial_payment_order_boundary()'
      )
  ) or (
    select encode(extensions.digest(convert_to(regexp_replace(
      btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
    ), 'UTF8'), 'sha256'), 'hex')
    from pg_proc procedure
    where procedure.oid = to_regprocedure(
      'coachfort_internal.enforce_noncommercial_payment_order_boundary()'
    )
  ) is distinct from
    '20300988e6b8b7be9a5ad37972cc1ebad8b7ec1c34bd9c578f2b9a0e25c122ac' then
    raise exception 'REGRESSION-R3B changed the R2 payment boundary.'
      using errcode = '55000';
  end if;

  select * into v_baseline from regression_r3b_protected_baseline;

  if v_baseline.tenants <> (select count(*) from public.tenants)
     or v_baseline.assignments <>
       (select count(*) from public.tenant_subscription_assignments)
     or v_baseline.projections <>
       (select count(*) from public.platform_tenant_subscriptions)
     or v_baseline.payment_orders <>
       (select count(*) from public.tenant_payment_orders)
     or v_baseline.grants <>
       (select count(*) from coachfort_internal.tenant_noncommercial_access_grants)
     or v_baseline.grant_events <>
       (select count(*) from coachfort_internal.tenant_noncommercial_access_events)
     or v_baseline.fixture_classifications <>
       (select count(*) from coachfort_internal.tenant_fixture_classifications) then
    raise exception 'REGRESSION-R3B changed protected business data.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY READ-ONLY VERIFICATION
-- ---------------------------------------------------------------------------

with
expected(identity, expected_sha256, expected_search_path,
         expected_volatility, authenticated_execute, service_execute) as (
  values
    (
      'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)',
      '3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed', 'search_path=public, pg_temp', 's', false, false
    ),
    (
      'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
      'd8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5', 'search_path=public', 'v', true, false
    ),
    (
      'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
      'a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc', 'search_path=public', 'v', true, false
    ),
    (
      'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
      '6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11', 'search_path=public, pg_temp', 'v', false, true
    )
),
function_state as (
  select
    count(procedure.oid) = (select count(*) from expected)
      as exact_function_identities,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = expected.expected_volatility::"char"
      and procedure.proconfig @> array[expected.expected_search_path]::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ) = expected.authenticated_execute
      and has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ) = expected.service_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false) as exact_function_contract
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
source_state as (
  select
    count(*) filter (
      where procedure.proname =
          'tenant_has_noncommercial_regression_evidence'
        and source like '%when p_tenant_id is null then true%'
        and source like '%assignment.status = ''noncommercial''%'
        and source like '%assignment.source = ''platform_noncommercial''%'
        and source like '%assignment.noncommercial_grant_id is not null%'
        and source like '%tenant_noncommercial_access_grants%'
        and source like '%classification.fixture_type = ''regression''%'
    ) = 1 as helper_fail_closed,
    count(*) filter (
      where procedure.proname = 'set_tenant_subscription_plan'
        and position('from public.tenants tenant' in source)
          < position('from public.subscription_plans plan' in source)
        and position('from public.subscription_plans plan' in source)
          < position('from public.tenant_subscription_assignments assignment' in source)
        and position('for update' in source)
          < position('tenant_has_noncommercial_regression_evidence' in source)
        and position('tenant_has_noncommercial_regression_evidence' in source)
          < position('update public.tenant_subscription_assignments' in source)
    ) = 1 as setter_lock_and_guard_order,
    count(*) filter (
      where procedure.proname = 'update_tenant_subscription'
        and position('from public.tenants tenant' in source)
          < position('tenant_has_noncommercial_regression_evidence' in source)
        and position('tenant_has_noncommercial_regression_evidence' in source)
          < position('insert into public.platform_tenant_subscriptions' in source)
    ) = 1 as projection_lock_and_guard_order,
    count(*) filter (
      where procedure.proname =
          'create_platform_payment_order_authority_server'
        and source not like '%from public.tenants tenant%for update%'
        and position('for share' in source)
          < position('tenant_has_noncommercial_regression_evidence' in source)
        and position('tenant_has_noncommercial_regression_evidence' in source)
          < position('insert into public.tenant_payment_orders' in source)
    ) = 1 as checkout_early_guard_without_tenant_lock
  from (
    select
      procedure.proname,
      regexp_replace(lower(procedure.prosrc), '[[:space:]]+', ' ', 'g') source
    from pg_proc procedure
    where procedure.oid in (
      to_regprocedure(
        'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)'
      ),
      to_regprocedure(
        'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)'
      ),
      to_regprocedure(
        'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)'
      ),
      to_regprocedure(
        'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'
      )
    )
  ) procedure
),
payment_boundary_state as (
  select
    exists (
      select 1
      from pg_trigger trigger_definition
      where trigger_definition.tgrelid =
          'public.tenant_payment_orders'::regclass
        and trigger_definition.tgname =
          'enforce_noncommercial_payment_order_boundary'
        and not trigger_definition.tgisinternal
        and trigger_definition.tgenabled = 'O'
        and trigger_definition.tgfoid = to_regprocedure(
          'coachfort_internal.enforce_noncommercial_payment_order_boundary()'
        )
    )
    and (
      select encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex')
      from pg_proc procedure
      where procedure.oid = to_regprocedure(
        'coachfort_internal.enforce_noncommercial_payment_order_boundary()'
      )
    ) = '20300988e6b8b7be9a5ad37972cc1ebad8b7ec1c34bd9c578f2b9a0e25c122ac'
      as r2_payment_trigger_preserved
),
grant_state as (
  select count(*) = 0 as no_grants_issued
  from coachfort_internal.tenant_noncommercial_access_grants
)
select
  function_state.*,
  source_state.*,
  payment_boundary_state.*,
  grant_state.*,
  function_state.exact_function_identities
    and function_state.exact_function_contract
    and source_state.helper_fail_closed
    and source_state.setter_lock_and_guard_order
    and source_state.projection_lock_and_guard_order
    and source_state.checkout_early_guard_without_tenant_lock
    and payment_boundary_state.r2_payment_trigger_preserved
    and grant_state.no_grants_issued as security_gate
from function_state
cross join source_state
cross join payment_boundary_state
cross join grant_state;
