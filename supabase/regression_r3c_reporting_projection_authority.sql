-- REGRESSION-R3C: commercial reporting and legacy projection read authority.
--
-- Review-only. Do not execute until PRE and the complete migration are approved.
-- This migration changes only Platform reporting reads. It does not mutate
-- projection rows, grants, assignments, product entitlements, or billing data.

-- ---------------------------------------------------------------------------
-- PRE-APPLY READ-ONLY VERIFICATION
-- ---------------------------------------------------------------------------

with
expected_readers(identity, expected_sha256) as (
  values
    (
      'public.get_platform_dashboard()',
      '0cf0ac80b08c6731c9f7c901ef30e95b09da1aa762cb4c0a7dc1de91738349c3'
    ),
    (
      'public.get_platform_tenants()',
      '01b03feb41d320b728ef8c78e74f1a157b4f38c2bb5b43802ade7bef8284df90'
    ),
    (
      'public.get_platform_tenant_detail(uuid)',
      '736cffab0418a368a4fe3b4764cb6a22475f49008c203bd8221c7585c650c4e4'
    )
),
reader_state as (
  select
    count(procedure.oid) = (select count(*) from expected_readers)
      as exact_reader_identities,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig = array['search_path=public']::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and acl.grantee <> (
            select role_definition.oid
            from pg_roles role_definition
            where role_definition.rolname = 'authenticated'
          )
      )
    ), false) as exact_reader_baseline
  from expected_readers expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
expected_r3b(identity, expected_sha256, expected_volatility,
             authenticated_execute, service_execute) as (
  values
    (
      'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)',
      '3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed',
      's', false, false
    ),
    (
      'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
      'd8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5',
      'v', true, false
    ),
    (
      'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
      'a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc',
      'v', true, false
    ),
    (
      'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
      '6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11',
      'v', false, true
    )
),
r3b_state as (
  select
    count(procedure.oid) = (select count(*) from expected_r3b)
      as exact_r3b_identities,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = expected.expected_volatility::"char"
      and procedure.proconfig = array[
        case
          when expected.identity like 'coachfort_internal.%'
            or expected.identity like '%payment_order_authority_server%'
          then 'search_path=public, pg_temp'
          else 'search_path=public'
        end
      ]::text[]
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
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and not (
            expected.authenticated_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'authenticated'
            )
          )
          and not (
            expected.service_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'service_role'
            )
          )
      )
    ), false) as exact_r3b_contract
  from expected_r3b expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
relation_state as (
  select
    to_regclass('public.tenants') is not null as tenants_present,
    to_regclass('public.students') is not null as students_present,
    to_regclass('public.courses') is not null as courses_present,
    to_regclass('public.tenant_members') is not null as members_present,
    to_regclass('public.audit_logs') is not null as audit_logs_present,
    to_regclass('public.platform_tenant_subscriptions') is not null
      as legacy_projection_present,
    to_regclass('public.platform_subscription_plans') is not null
      as legacy_plans_present,
    to_regclass('public.platform_activity_logs') is not null
      as activity_present,
    to_regclass('public.platform_tenant_usage_snapshots') is not null
      as usage_snapshots_present,
    to_regclass('public.platform_support_notes') is not null
      as support_notes_present,
    to_regclass('public.tenant_subscription_assignments') is not null
      as assignments_present,
    to_regclass(
      'coachfort_internal.tenant_noncommercial_access_grants'
    ) is not null as grants_present,
    to_regclass(
      'coachfort_internal.tenant_noncommercial_access_events'
    ) is not null as grant_events_present,
    to_regclass(
      'coachfort_internal.tenant_fixture_classifications'
    ) is not null as classifications_present
),
first_grant_state as (
  select
    (select count(*) = 0
     from coachfort_internal.tenant_noncommercial_access_grants)
      as no_grants_issued,
    (select count(*) = 0
     from coachfort_internal.tenant_noncommercial_access_events)
      as no_grant_events,
    (select count(*) = 0
     from public.tenant_subscription_assignments assignment
     where assignment.status = 'noncommercial'
        or assignment.source = 'platform_noncommercial'
        or assignment.noncommercial_grant_id is not null)
      as no_noncommercial_assignment_markers
)
select
  reader_state.*,
  r3b_state.*,
  relation_state.*,
  first_grant_state.*,
  reader_state.exact_reader_identities
    and reader_state.exact_reader_baseline
    and r3b_state.exact_r3b_identities
    and r3b_state.exact_r3b_contract
    and relation_state.tenants_present
    and relation_state.students_present
    and relation_state.courses_present
    and relation_state.members_present
    and relation_state.audit_logs_present
    and relation_state.legacy_projection_present
    and relation_state.legacy_plans_present
    and relation_state.activity_present
    and relation_state.usage_snapshots_present
    and relation_state.support_notes_present
    and relation_state.assignments_present
    and relation_state.grants_present
    and relation_state.grant_events_present
    and relation_state.classifications_present
    and first_grant_state.no_grants_issued
    and first_grant_state.no_grant_events
    and first_grant_state.no_noncommercial_assignment_markers
      as ready_for_apply
from reader_state
cross join r3b_state
cross join relation_state
cross join first_grant_state;

-- ---------------------------------------------------------------------------
-- APPLY (TRANSACTIONAL; DO NOT RUN AS PART OF REVIEW)
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_readers_ready boolean;
  v_r3b_ready boolean;
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regclass('public.tenants') is null
     or to_regclass('public.students') is null
     or to_regclass('public.courses') is null
     or to_regclass('public.tenant_members') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.platform_tenant_subscriptions') is null
     or to_regclass('public.platform_subscription_plans') is null
     or to_regclass('public.platform_activity_logs') is null
     or to_regclass('public.platform_tenant_usage_snapshots') is null
     or to_regclass('public.platform_support_notes') is null
     or to_regclass('public.tenant_subscription_assignments') is null
     or to_regclass(
       'coachfort_internal.tenant_noncommercial_access_grants'
     ) is null
     or to_regclass(
       'coachfort_internal.tenant_noncommercial_access_events'
     ) is null
     or to_regclass(
       'coachfort_internal.tenant_fixture_classifications'
     ) is null then
    raise exception 'REGRESSION-R3C prerequisites are unavailable.'
      using errcode = '55000';
  end if;

  with expected(identity, expected_sha256) as (
    values
      (
        'public.get_platform_dashboard()',
        '0cf0ac80b08c6731c9f7c901ef30e95b09da1aa762cb4c0a7dc1de91738349c3'
      ),
      (
        'public.get_platform_tenants()',
        '01b03feb41d320b728ef8c78e74f1a157b4f38c2bb5b43802ade7bef8284df90'
      ),
      (
        'public.get_platform_tenant_detail(uuid)',
        '736cffab0418a368a4fe3b4764cb6a22475f49008c203bd8221c7585c650c4e4'
      )
  )
  select count(procedure.oid) = (select count(*) from expected)
    and coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig = array['search_path=public']::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and acl.grantee <> (
            select role_definition.oid
            from pg_roles role_definition
            where role_definition.rolname = 'authenticated'
          )
      )
    ), false)
  into v_readers_ready
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if not coalesce(v_readers_ready, false) then
    raise exception 'REGRESSION-R3C reader baseline has drifted.'
      using errcode = '55000';
  end if;

  with expected(identity, expected_sha256, expected_volatility,
                authenticated_execute, service_execute) as (
    values
      (
        'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)',
        '3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed',
        's', false, false
      ),
      (
        'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
        'd8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5',
        'v', true, false
      ),
      (
        'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
        'a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc',
        'v', true, false
      ),
      (
        'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
        '6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11',
        'v', false, true
      )
  )
  select count(procedure.oid) = (select count(*) from expected)
    and coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = expected.expected_volatility::"char"
      and procedure.proconfig = array[
        case
          when expected.identity like 'coachfort_internal.%'
            or expected.identity like '%payment_order_authority_server%'
          then 'search_path=public, pg_temp'
          else 'search_path=public'
        end
      ]::text[]
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
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and not (
            expected.authenticated_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'authenticated'
            )
          )
          and not (
            expected.service_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'service_role'
            )
          )
      )
    ), false)
  into v_r3b_ready
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if not coalesce(v_r3b_ready, false) then
    raise exception 'REGRESSION-R3C R3B authority baseline has drifted.'
      using errcode = '55000';
  end if;

  if exists (
       select 1
       from coachfort_internal.tenant_noncommercial_access_grants
     )
     or exists (
       select 1
       from coachfort_internal.tenant_noncommercial_access_events
     )
     or exists (
       select 1
       from public.tenant_subscription_assignments assignment
       where assignment.status = 'noncommercial'
          or assignment.source = 'platform_noncommercial'
          or assignment.noncommercial_grant_id is not null
     ) then
    raise exception 'REGRESSION-R3C must be installed before the first grant.'
      using errcode = '55000';
  end if;
end;
$$;

create temporary table regression_r3c_protected_baseline
on commit drop
as
select
  (select count(*) from public.tenants) as tenants,
  (select count(*) from public.students) as students,
  (select count(*) from public.courses) as courses,
  (select count(*) from public.tenant_members) as tenant_members,
  (select count(*) from public.platform_tenant_subscriptions)
    as legacy_projections,
  (select count(*) from public.platform_subscription_plans) as legacy_plans,
  (select count(*) from public.tenant_subscription_assignments) as assignments,
  (select count(*)
   from coachfort_internal.tenant_noncommercial_access_grants) as grants,
  (select count(*)
   from coachfort_internal.tenant_noncommercial_access_events) as grant_events,
  (select count(*)
   from coachfort_internal.tenant_fixture_classifications)
    as fixture_classifications;

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

  with commercial_subscriptions as (
    select projection.*
    from public.platform_tenant_subscriptions projection
    where not coachfort_internal.tenant_has_noncommercial_regression_evidence(
      projection.tenant_id
    )
  )
  select jsonb_build_object(
    'tenant_count', (select count(*) from public.tenants),
    'active_tenants', (select count(*) from commercial_subscriptions where status = 'active'),
    'trial_tenants', (select count(*) from commercial_subscriptions where status = 'trial'),
    'suspended_tenants', (select count(*) from commercial_subscriptions where status = 'suspended'),
    'total_students', (select count(*) from public.students),
    'total_courses', (select count(*) from public.courses),
    'active_subscriptions', (select count(*) from commercial_subscriptions where status in ('trial', 'active')),
    'overdue_subscriptions', (select count(*) from commercial_subscriptions where status = 'past_due' or payment_status = 'overdue'),
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
          'commercial_reporting_excluded', reporting.commercial_reporting_excluded,
          'commercial_reporting_exclusion', case
            when reporting.commercial_reporting_excluded
              then 'noncommercial_regression'
            else null
          end,
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
    cross join lateral (
      select coachfort_internal.tenant_has_noncommercial_regression_evidence(
        t.id
      )
          as commercial_reporting_excluded
    ) reporting
    left join public.platform_tenant_subscriptions pts
      on pts.tenant_id = t.id
     and not reporting.commercial_reporting_excluded
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
      'subscription_status', case
        when reporting.commercial_reporting_excluded then null
        else t.subscription_status
      end
    ),
    'subscription', jsonb_build_object(
      'commercial_reporting_excluded', reporting.commercial_reporting_excluded,
      'commercial_reporting_exclusion', case
        when reporting.commercial_reporting_excluded
          then 'noncommercial_regression'
        else null
      end,
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
  cross join lateral (
    select coachfort_internal.tenant_has_noncommercial_regression_evidence(
      t.id
    )
        as commercial_reporting_excluded
  ) reporting
  left join public.platform_tenant_subscriptions pts
    on pts.tenant_id = t.id
   and not reporting.commercial_reporting_excluded
  left join public.platform_subscription_plans psp on psp.id = pts.plan_id
  where t.id = p_tenant_id;

  if result is null then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  return result;
end;
$$;

alter function public.get_platform_dashboard() owner to postgres;
revoke all on function public.get_platform_dashboard()
  from public, anon, authenticated, service_role;
grant execute on function public.get_platform_dashboard() to authenticated;

alter function public.get_platform_tenants() owner to postgres;
revoke all on function public.get_platform_tenants()
  from public, anon, authenticated, service_role;
grant execute on function public.get_platform_tenants() to authenticated;

alter function public.get_platform_tenant_detail(uuid) owner to postgres;
revoke all on function public.get_platform_tenant_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_platform_tenant_detail(uuid)
  to authenticated;

do $$
declare
  v_readers_ready boolean;
  v_r3b_unchanged boolean;
  v_baseline regression_r3c_protected_baseline%rowtype;
begin
  with expected(identity, expected_sha256) as (
    values
      ('public.get_platform_dashboard()', '3c565dad47bb518cbe0ada11f9d352aa7ce49571a2680249f6c44a3f1012ea74'),
      ('public.get_platform_tenants()', 'aeee712368e4c923f496f461d34ac1ad39b1c8c362cfb36fa44c8857920c3b84'),
      ('public.get_platform_tenant_detail(uuid)', 'd99412b6b30966b744a1df4cdba515a8b8fe184f56739c5f6be400b7f632eddf')
  )
  select count(procedure.oid) = (select count(*) from expected)
    and coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig = array['search_path=public']::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and acl.grantee <> (
            select role_definition.oid
            from pg_roles role_definition
            where role_definition.rolname = 'authenticated'
          )
      )
    ), false)
  into v_readers_ready
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if not coalesce(v_readers_ready, false) then
    raise exception 'REGRESSION-R3C installed reader contract is invalid.'
      using errcode = '55000';
  end if;

  with expected(identity, expected_sha256, expected_volatility,
                authenticated_execute, service_execute) as (
    values
      (
        'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)',
        '3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed',
        's', false, false
      ),
      (
        'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
        'd8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5',
        'v', true, false
      ),
      (
        'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
        'a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc',
        'v', true, false
      ),
      (
        'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
        '6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11',
        'v', false, true
      )
  )
  select count(procedure.oid) = (select count(*) from expected)
    and coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = expected.expected_volatility::"char"
      and procedure.proconfig = array[
        case
          when expected.identity like 'coachfort_internal.%'
            or expected.identity like '%payment_order_authority_server%'
          then 'search_path=public, pg_temp'
          else 'search_path=public'
        end
      ]::text[]
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
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and not (
            expected.authenticated_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'authenticated'
            )
          )
          and not (
            expected.service_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'service_role'
            )
          )
      )
    ), false)
  into v_r3b_unchanged
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if not coalesce(v_r3b_unchanged, false) then
    raise exception 'REGRESSION-R3C changed R3B authority.'
      using errcode = '55000';
  end if;

  select * into v_baseline from regression_r3c_protected_baseline;

  if v_baseline.tenants <> (select count(*) from public.tenants)
     or v_baseline.students <> (select count(*) from public.students)
     or v_baseline.courses <> (select count(*) from public.courses)
     or v_baseline.tenant_members <>
       (select count(*) from public.tenant_members)
     or v_baseline.legacy_projections <>
       (select count(*) from public.platform_tenant_subscriptions)
     or v_baseline.legacy_plans <>
       (select count(*) from public.platform_subscription_plans)
     or v_baseline.assignments <>
       (select count(*) from public.tenant_subscription_assignments)
     or v_baseline.grants <>
       (select count(*)
        from coachfort_internal.tenant_noncommercial_access_grants)
     or v_baseline.grant_events <>
       (select count(*)
        from coachfort_internal.tenant_noncommercial_access_events)
     or v_baseline.fixture_classifications <>
       (select count(*)
        from coachfort_internal.tenant_fixture_classifications) then
    raise exception 'REGRESSION-R3C changed protected business data.'
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
expected_readers(identity, expected_sha256) as (
  values
    ('public.get_platform_dashboard()', '3c565dad47bb518cbe0ada11f9d352aa7ce49571a2680249f6c44a3f1012ea74'),
    ('public.get_platform_tenants()', 'aeee712368e4c923f496f461d34ac1ad39b1c8c362cfb36fa44c8857920c3b84'),
    ('public.get_platform_tenant_detail(uuid)', 'd99412b6b30966b744a1df4cdba515a8b8fe184f56739c5f6be400b7f632eddf')
),
reader_state as (
  select
    count(procedure.oid) = (select count(*) from expected_readers)
      as exact_reader_identities,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig = array['search_path=public']::text[]
      and encode(extensions.digest(convert_to(regexp_replace(
        btrim(procedure.prosrc), '[[:space:]]+', ' ', 'g'
      ), 'UTF8'), 'sha256'), 'hex') = expected.expected_sha256
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and acl.grantee <> (
            select role_definition.oid
            from pg_roles role_definition
            where role_definition.rolname = 'authenticated'
          )
      )
    ), false) as exact_reader_contract
  from expected_readers expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
source_state as (
  select
    count(*) filter (
      where procedure.proname = 'get_platform_dashboard'
        and source like '%with commercial_subscriptions as (%'
        and source like '%tenant_has_noncommercial_regression_evidence(projection.tenant_id)%'
        and source like '%''tenant_count'', (select count(*) from public.tenants)%'
        and source like '%''active_tenants'', (select count(*) from commercial_subscriptions where status = ''active'')%'
        and source like '%''trial_tenants'', (select count(*) from commercial_subscriptions where status = ''trial'')%'
        and source like '%''suspended_tenants'', (select count(*) from commercial_subscriptions where status = ''suspended'')%'
        and source like '%''active_subscriptions'', (select count(*) from commercial_subscriptions where status in (''trial'', ''active''))%'
        and source like '%''overdue_subscriptions'', (select count(*) from commercial_subscriptions where status = ''past_due'' or payment_status = ''overdue'')%'
    ) = 1 as dashboard_commercial_exclusion,
    count(*) filter (
      where procedure.proname = 'get_platform_tenants'
        and source like '%''commercial_reporting_excluded'', reporting.commercial_reporting_excluded%'
        and source like '%then ''noncommercial_regression''%'
        and source like '%tenant_has_noncommercial_regression_evidence(t.id)%'
        and source like '%left join public.platform_tenant_subscriptions pts on pts.tenant_id = t.id and not reporting.commercial_reporting_excluded%'
    ) = 1 as tenant_list_truthful_projection,
    count(*) filter (
      where procedure.proname = 'get_platform_tenant_detail'
        and source like '%''commercial_reporting_excluded'', reporting.commercial_reporting_excluded%'
        and source like '%then ''noncommercial_regression''%'
        and source like '%tenant_has_noncommercial_regression_evidence(t.id)%'
        and source like '%left join public.platform_tenant_subscriptions pts on pts.tenant_id = t.id and not reporting.commercial_reporting_excluded%'
    ) = 1 as tenant_detail_truthful_projection,
    count(*) filter (
      where source like '%insert into public.platform_tenant_subscriptions%'
         or source like '%update public.platform_tenant_subscriptions%'
         or source like '%delete from public.platform_tenant_subscriptions%'
         or source like '%update public.tenant_subscription_assignments%'
         or source like '%insert into public.tenant_subscription_assignments%'
    ) = 0 as readers_are_nonmutating
  from (
    select
      procedure.proname,
      regexp_replace(lower(procedure.prosrc), '[[:space:]]+', ' ', 'g') source
    from pg_proc procedure
    where procedure.oid in (
      to_regprocedure('public.get_platform_dashboard()'),
      to_regprocedure('public.get_platform_tenants()'),
      to_regprocedure('public.get_platform_tenant_detail(uuid)')
    )
  ) procedure
),
expected_r3b(identity, expected_sha256, expected_volatility,
             authenticated_execute, service_execute) as (
  values
    (
      'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)',
      '3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed',
      's', false, false
    ),
    (
      'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',
      'd8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5',
      'v', true, false
    ),
    (
      'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',
      'a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc',
      'v', true, false
    ),
    (
      'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
      '6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11',
      'v', false, true
    )
),
r3b_state as (
  select
    count(procedure.oid) = (select count(*) from expected_r3b)
      as exact_r3b_identities,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = expected.expected_volatility::"char"
      and procedure.proconfig = array[
        case
          when expected.identity like 'coachfort_internal.%'
            or expected.identity like '%payment_order_authority_server%'
          then 'search_path=public, pg_temp'
          else 'search_path=public'
        end
      ]::text[]
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
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and not (
            expected.authenticated_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'authenticated'
            )
          )
          and not (
            expected.service_execute
            and acl.grantee = (
              select role_definition.oid
              from pg_roles role_definition
              where role_definition.rolname = 'service_role'
            )
          )
      )
    ), false) as r3b_unchanged
  from expected_r3b expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
first_grant_state as (
  select
    (select count(*) = 0
     from coachfort_internal.tenant_noncommercial_access_grants)
      as no_grants_issued,
    (select count(*) = 0
     from coachfort_internal.tenant_noncommercial_access_events)
      as no_grant_events,
    (select count(*) = 0
     from public.tenant_subscription_assignments assignment
     where assignment.status = 'noncommercial'
        or assignment.source = 'platform_noncommercial'
        or assignment.noncommercial_grant_id is not null)
      as no_noncommercial_assignment_markers
)
select
  reader_state.*,
  source_state.*,
  r3b_state.*,
  first_grant_state.*,
  reader_state.exact_reader_identities
    and reader_state.exact_reader_contract
    and source_state.dashboard_commercial_exclusion
    and source_state.tenant_list_truthful_projection
    and source_state.tenant_detail_truthful_projection
    and source_state.readers_are_nonmutating
    and r3b_state.exact_r3b_identities
    and r3b_state.r3b_unchanged
    and first_grant_state.no_grants_issued
    and first_grant_state.no_grant_events
    and first_grant_state.no_noncommercial_assignment_markers
      as security_gate
from reader_state
cross join source_state
cross join r3b_state
cross join first_grant_state;
