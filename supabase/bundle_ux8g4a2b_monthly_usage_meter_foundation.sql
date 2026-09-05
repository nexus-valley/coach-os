-- Bundle UX-8G4A2B: general monthly usage meter foundation.
--
-- This migration adds private UTC-calendar-month consumption authority for the
-- three launch meters. It does not connect any business mutation to the meter.

/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query separately in Supabase SQL Editor. It reads catalog metadata and
aggregate counts only. It does not create usage, alter subscriptions, or mutate
the plan catalog.

with required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.subscription_plans'),
    ('public.tenant_subscription_assignments'),
    ('public.subscription_plan_usage_limits'),
    ('public.tenant_subscription_overrides'),
    ('public.tenant_usage_snapshots'),
    ('public.tenant_usage_events')
), relation_state as (
  select
    count(*) filter (where to_regclass(identity) is not null) installed_count,
    count(*) expected_count
  from required_relations
), required_functions(identity) as (
  values
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'),
    ('coachfort_internal.assert_tenant_operational_access(uuid)'),
    ('public.approve_tenant_feature_override(uuid,text,text,text,jsonb,text,timestamptz,jsonb)')
), function_state as (
  select
    count(*) filter (where to_regprocedure(identity) is not null) installed_count,
    count(*) expected_count
  from required_functions
), required_columns(table_name, column_name) as (
  values
    ('tenant_subscription_assignments', 'tenant_id'),
    ('tenant_subscription_assignments', 'plan_id'),
    ('tenant_subscription_assignments', 'is_current'),
    ('tenant_subscription_assignments', 'created_at'),
    ('subscription_plan_usage_limits', 'plan_id'),
    ('subscription_plan_usage_limits', 'id'),
    ('subscription_plan_usage_limits', 'resource_key'),
    ('subscription_plan_usage_limits', 'limit_value'),
    ('subscription_plan_usage_limits', 'limit_type'),
    ('subscription_plan_usage_limits', 'enforcement_mode'),
    ('tenant_subscription_overrides', 'tenant_id'),
    ('tenant_subscription_overrides', 'id'),
    ('tenant_subscription_overrides', 'resource_key'),
    ('tenant_subscription_overrides', 'override_type'),
    ('tenant_subscription_overrides', 'override_value_json'),
    ('tenant_subscription_overrides', 'expires_at'),
    ('tenant_subscription_overrides', 'created_at')
), column_state as (
  select
    count(*) filter (where columns.column_name is not null) installed_count,
    count(*) expected_count
  from required_columns expected
  left join information_schema.columns columns
    on columns.table_schema = 'public'
   and columns.table_name = expected.table_name
   and columns.column_name = expected.column_name
), current_assignment_index as (
  select exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'tenant_subscription_assignments'
      and indexname = 'tenant_subscription_assignments_current_unique_idx'
      and lower(indexdef) like '%unique%'
      and lower(indexdef) like '%(tenant_id)%'
      and lower(indexdef) like '%where is_current%'
  ) installed
), current_limit_violations as (
  select count(*) violation_count
  from public.tenant_subscription_assignments assignment
  cross join (values
    ('messages_monthly'),
    ('automation_runs_monthly'),
    ('ai_requests_monthly')
  ) resource(resource_key)
  left join public.subscription_plan_usage_limits plan_limit
    on plan_limit.plan_id = assignment.plan_id
   and plan_limit.resource_key = resource.resource_key
  where assignment.is_current
    and (
      plan_limit.id is null
      or plan_limit.limit_value is null
      or plan_limit.limit_value < 0
      or plan_limit.limit_type <> 'monthly_count'
      or plan_limit.enforcement_mode <> 'hard'
    )
), active_override_violations as (
  select count(*) violation_count
  from public.tenant_subscription_overrides override_row
  where override_row.resource_key in (
      'messages_monthly',
      'automation_runs_monthly',
      'ai_requests_monthly'
    )
    and override_row.override_type in ('limit_raise', 'limit_lower')
    and (override_row.expires_at is null or override_row.expires_at > now())
    and (
      not (override_row.override_value_json ? 'limit_value')
      or coalesce(override_row.override_value_json->>'limit_value', '')
        !~ '^[0-9]{1,10}$'
      or case
        when coalesce(override_row.override_value_json->>'limit_value', '')
          ~ '^[0-9]{1,10}$'
        then (override_row.override_value_json->>'limit_value')::bigint
             > 2147483647
        else false
      end
    )
), override_writer_state as (
  select
    procedure.oid is not null installed,
    coalesce(pg_get_userbyid(procedure.proowner) = 'postgres', false)
      postgres_owned,
    coalesce(procedure.prosecdef, false) security_definer,
    case when procedure.oid is null then false else
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    end authenticated_execute,
    case when procedure.oid is null then false else not
      has_function_privilege('anon', procedure.oid, 'EXECUTE')
    end anon_execute_denied,
    case when procedure.oid is null then false else not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) end public_execute_denied,
    coalesce(lower(pg_get_functiondef(procedure.oid)) like
      '%subscription_entitlements_assert_platform_owner_admin%', false)
      platform_authorized,
    coalesce(lower(pg_get_functiondef(procedure.oid)) like
      '%insert into public.tenant_subscription_overrides%', false)
      inserts_override
  from (select to_regprocedure(
    'public.approve_tenant_feature_override(uuid,text,text,text,jsonb,text,timestamptz,jsonb)'
  ) oid) expected
  left join pg_catalog.pg_proc procedure on procedure.oid = expected.oid
), partial_installation as (
  select
    (select count(*)
      from (values
        ('coachfort_internal.monthly_usage_counters'),
        ('coachfort_internal.monthly_usage_consumption_events')
      ) expected(identity)
      where to_regclass(identity) is not null) table_count,
    (select count(*)
      from (values
        ('coachfort_internal.utc_calendar_month(timestamptz)'),
        ('coachfort_internal.monthly_usage_authority_lock(uuid,text)'),
        ('coachfort_internal.enforce_monthly_usage_override_authority_lock()'),
        ('coachfort_internal.resolve_monthly_usage_limit(uuid,text)'),
        ('coachfort_internal.enforce_monthly_usage_event_immutability()'),
        ('coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'),
        ('coachfort_internal.monthly_usage_state(uuid,timestamptz)'),
        ('coachfort_internal.monthly_usage_reconciliation(uuid)')
      ) expected(identity)
      where to_regprocedure(identity) is not null) function_count,
    (select count(*)
      from pg_catalog.pg_trigger
      where not tgisinternal
        and tgname in (
          'monthly_usage_override_authority_lock',
          'monthly_usage_consumption_events_immutable'
        )) trigger_count
), internal_schema_state as (
  select
    namespace.oid is not null installed,
    pg_get_userbyid(namespace.nspowner) = 'postgres' postgres_owned,
    coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting settings
      join pg_catalog.pg_roles role on role.oid = settings.setrole
      cross join lateral unnest(settings.setconfig) config(value)
      cross join lateral regexp_split_to_table(
        split_part(config.value, '=', 2), ','
      ) exposed(schema_name)
      where role.rolname = 'authenticator'
        and config.value like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ) api_exposed
  from (select to_regnamespace('coachfort_internal') oid) existing
  left join pg_catalog.pg_namespace namespace on namespace.oid = existing.oid
), existing_usage_acl as (
  select count(*) browser_write_grants
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in ('tenant_usage_snapshots', 'tenant_usage_events')
    and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
), commercial_authority_tables(identity) as (
  values
    ('public.tenant_subscription_assignments'),
    ('public.subscription_plan_usage_limits'),
    ('public.tenant_subscription_overrides')
), commercial_authority_acl as (
  select
    (select count(*)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'anon', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) anon_mutation_table_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'authenticated', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) authenticated_mutation_table_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      join pg_catalog.pg_class class
        on class.oid = to_regclass(commercial_table.identity)
      cross join lateral aclexplode(coalesce(
        class.relacl,
        acldefault('r', class.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
      public_direct_mutation_grant_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      cross join (values ('anon'), ('authenticated')) browser_role(role_name)
      where has_table_privilege(
        browser_role.role_name,
        commercial_table.identity,
        'INSERT,UPDATE,DELETE'
      ))
    +
    (select count(*)
      from commercial_authority_tables commercial_table
      join pg_catalog.pg_class class
        on class.oid = to_regclass(commercial_table.identity)
      cross join lateral aclexplode(coalesce(
        class.relacl,
        acldefault('r', class.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
      browser_mutation_authority_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'service_role', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) service_role_mutation_table_count,
    (select coalesce(jsonb_agg(commercial_table.identity order by identity), '[]'::jsonb)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'service_role', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) service_role_mutation_tables
), data_counts as (
  select
    (select count(*) from public.tenant_usage_snapshots) legacy_snapshot_rows,
    (select count(*) from public.tenant_usage_events) legacy_usage_event_rows,
    (select count(*) from public.tenant_subscription_assignments)
      subscription_assignment_rows,
    (select count(*) from public.tenant_subscription_assignments where is_current)
      current_subscription_assignment_rows,
    (select count(*) from public.subscription_plan_usage_limits)
      plan_limit_rows,
    (select count(*) from public.tenant_subscription_overrides)
      subscription_override_rows
)
select jsonb_pretty(jsonb_build_object(
  'ready_for_apply',
    (select installed_count = expected_count from relation_state)
    and (select installed_count = expected_count from function_state)
    and (select installed_count = expected_count from column_state)
    and (select installed from current_assignment_index)
    and (select violation_count = 0 from current_limit_violations)
    and (select violation_count = 0 from active_override_violations)
    and (select installed and postgres_owned and security_definer
      and authenticated_execute and anon_execute_denied
      and public_execute_denied and platform_authorized and inserts_override
      from override_writer_state)
    and (select table_count = 0 and function_count = 0 and trigger_count = 0
      from partial_installation)
    and (select installed and postgres_owned and not api_exposed
      from internal_schema_state)
    and (select browser_write_grants = 0 from existing_usage_acl)
    and (select anon_mutation_table_count = 0
      and authenticated_mutation_table_count = 0
      and public_direct_mutation_grant_count = 0
      and browser_mutation_authority_count = 0
      from commercial_authority_acl)
    and exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'postgres' and (rolsuper or rolbypassrls)
    ),
  'relations', (select to_jsonb(relation_state) from relation_state),
  'functions', (select to_jsonb(function_state) from function_state),
  'columns', (select to_jsonb(column_state) from column_state),
  'current_assignment_index', (select installed from current_assignment_index),
  'current_limit_violations',
    (select violation_count from current_limit_violations),
  'active_override_violations',
    (select violation_count from active_override_violations),
  'override_writer', (select to_jsonb(override_writer_state)
    from override_writer_state),
  'partial_installation',
    (select to_jsonb(partial_installation) from partial_installation),
  'internal_schema',
    (select to_jsonb(internal_schema_state) from internal_schema_state),
  'existing_usage_browser_write_grants',
    (select browser_write_grants from existing_usage_acl),
  'commercial_authority_acl',
    (select to_jsonb(commercial_authority_acl)
      from commercial_authority_acl),
  'data_counts', (select to_jsonb(data_counts) from data_counts)
));
*/

begin;

do $$
declare
  v_missing_columns integer;
  v_current_limit_violations integer;
  v_active_override_violations integer;
  v_override_writer regprocedure;
begin
  if to_regnamespace('coachfort_internal') is null
     or not exists (
       select 1 from pg_catalog.pg_namespace namespace
       where namespace.oid = to_regnamespace('coachfort_internal')
         and pg_get_userbyid(namespace.nspowner) = 'postgres'
     ) then
    raise exception 'UX-8G4A2B requires the postgres-owned internal schema.'
      using errcode = '55000';
  end if;

  if coalesce(
    'coachfort_internal' = any(regexp_split_to_array(
      replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
    )), false
  ) or exists (
    select 1
    from pg_catalog.pg_db_role_setting settings
    join pg_catalog.pg_roles role on role.oid = settings.setrole
    cross join lateral unnest(settings.setconfig) config(value)
    cross join lateral regexp_split_to_table(
      split_part(config.value, '=', 2), ','
    ) exposed(schema_name)
    where role.rolname = 'authenticator'
      and config.value like 'pgrst.db_schemas=%'
      and btrim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'coachfort_internal must not be exposed through PostgREST.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'postgres' and (rolsuper or rolbypassrls)
  ) then
    raise exception 'postgres cannot safely own the monthly meter authority.'
      using errcode = '55000';
  end if;

  if to_regclass('public.tenants') is null
     or to_regclass('public.subscription_plans') is null
     or to_regclass('public.tenant_subscription_assignments') is null
     or to_regclass('public.subscription_plan_usage_limits') is null
     or to_regclass('public.tenant_subscription_overrides') is null
     or to_regclass('public.tenant_usage_snapshots') is null
     or to_regclass('public.tenant_usage_events') is null
     or to_regprocedure(
       'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.assert_tenant_operational_access(uuid)'
     ) is null
     or to_regprocedure(
       'public.approve_tenant_feature_override(uuid,text,text,text,jsonb,text,timestamptz,jsonb)'
     ) is null then
    raise exception 'UX-8G4A2B prerequisites are missing.' using errcode = '55000';
  end if;

  v_override_writer := to_regprocedure(
    'public.approve_tenant_feature_override(uuid,text,text,text,jsonb,text,timestamptz,jsonb)'
  );
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = v_override_writer
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
      and lower(pg_get_functiondef(procedure.oid)) like
        '%subscription_entitlements_assert_platform_owner_admin%'
      and lower(pg_get_functiondef(procedure.oid)) like
        '%insert into public.tenant_subscription_overrides%'
  ) then
    raise exception 'Canonical subscription override writer has drifted.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_missing_columns
  from (values
    ('tenant_subscription_assignments', 'tenant_id'),
    ('tenant_subscription_assignments', 'plan_id'),
    ('tenant_subscription_assignments', 'is_current'),
    ('tenant_subscription_assignments', 'created_at'),
    ('subscription_plan_usage_limits', 'plan_id'),
    ('subscription_plan_usage_limits', 'id'),
    ('subscription_plan_usage_limits', 'resource_key'),
    ('subscription_plan_usage_limits', 'limit_value'),
    ('subscription_plan_usage_limits', 'limit_type'),
    ('subscription_plan_usage_limits', 'enforcement_mode'),
    ('tenant_subscription_overrides', 'tenant_id'),
    ('tenant_subscription_overrides', 'id'),
    ('tenant_subscription_overrides', 'resource_key'),
    ('tenant_subscription_overrides', 'override_type'),
    ('tenant_subscription_overrides', 'override_value_json'),
    ('tenant_subscription_overrides', 'expires_at'),
    ('tenant_subscription_overrides', 'created_at')
  ) expected(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns columns
    where columns.table_schema = 'public'
      and columns.table_name = expected.table_name
      and columns.column_name = expected.column_name
  );

  if v_missing_columns <> 0 then
    raise exception 'UX-8G4A2B prerequisite columns have drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'tenant_subscription_assignments'
      and indexname = 'tenant_subscription_assignments_current_unique_idx'
      and lower(indexdef) like '%unique%'
      and lower(indexdef) like '%(tenant_id)%'
      and lower(indexdef) like '%where is_current%'
  ) then
    raise exception 'Canonical current-assignment uniqueness is missing.'
      using errcode = '55000';
  end if;

  if to_regclass('coachfort_internal.monthly_usage_counters') is not null
     or to_regclass(
       'coachfort_internal.monthly_usage_consumption_events'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.utc_calendar_month(timestamptz)'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.monthly_usage_authority_lock(uuid,text)'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.enforce_monthly_usage_override_authority_lock()'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.resolve_monthly_usage_limit(uuid,text)'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.enforce_monthly_usage_event_immutability()'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.monthly_usage_state(uuid,timestamptz)'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.monthly_usage_reconciliation(uuid)'
     ) is not null
     or exists (
       select 1 from pg_catalog.pg_trigger
       where not tgisinternal
         and tgname in (
           'monthly_usage_override_authority_lock',
           'monthly_usage_consumption_events_immutable'
         )
     ) then
    raise exception 'UX-8G4A2B appears partially installed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'tenant_usage_snapshots', 'tenant_usage_events'
      )
      and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    raise exception 'Existing usage-table browser ACL has drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.tenant_subscription_assignments'),
      ('public.subscription_plan_usage_limits'),
      ('public.tenant_subscription_overrides')
    ) commercial_table(identity)
    cross join (values ('anon'), ('authenticated')) browser_role(role_name)
    where has_table_privilege(
      browser_role.role_name,
      commercial_table.identity,
      'INSERT,UPDATE,DELETE'
    )
  ) or exists (
    select 1
    from (values
      ('public.tenant_subscription_assignments'),
      ('public.subscription_plan_usage_limits'),
      ('public.tenant_subscription_overrides')
    ) commercial_table(identity)
    join pg_catalog.pg_class class
      on class.oid = to_regclass(commercial_table.identity)
    cross join lateral aclexplode(coalesce(
      class.relacl,
      acldefault('r', class.relowner)
    )) acl
    where acl.grantee = 0
      and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Commercial subscription authority has browser mutation access.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_current_limit_violations
  from public.tenant_subscription_assignments assignment
  cross join (values
    ('messages_monthly'),
    ('automation_runs_monthly'),
    ('ai_requests_monthly')
  ) resource(resource_key)
  left join public.subscription_plan_usage_limits plan_limit
    on plan_limit.plan_id = assignment.plan_id
   and plan_limit.resource_key = resource.resource_key
  where assignment.is_current
    and (
      plan_limit.id is null
      or plan_limit.limit_value is null
      or plan_limit.limit_value < 0
      or plan_limit.limit_type <> 'monthly_count'
      or plan_limit.enforcement_mode <> 'hard'
    );

  if v_current_limit_violations <> 0 then
    raise exception 'Current assignments lack exact hard monthly limits.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_active_override_violations
  from public.tenant_subscription_overrides override_row
  where override_row.resource_key in (
      'messages_monthly',
      'automation_runs_monthly',
      'ai_requests_monthly'
    )
    and override_row.override_type in ('limit_raise', 'limit_lower')
    and (override_row.expires_at is null or override_row.expires_at > now())
    and (
      not (override_row.override_value_json ? 'limit_value')
      or coalesce(override_row.override_value_json->>'limit_value', '')
        !~ '^[0-9]{1,10}$'
      or case
        when coalesce(override_row.override_value_json->>'limit_value', '')
          ~ '^[0-9]{1,10}$'
        then (override_row.override_value_json->>'limit_value')::bigint
             > 2147483647
        else false
      end
    );

  if v_active_override_violations <> 0 then
    raise exception 'Active monthly usage overrides are malformed.'
      using errcode = '55000';
  end if;
end;
$$;

create table coachfort_internal.monthly_usage_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  consumed bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_usage_counters_pkey
    primary key (tenant_id, resource_key, period_start),
  constraint monthly_usage_counters_resource_check check (
    resource_key in (
      'messages_monthly',
      'automation_runs_monthly',
      'ai_requests_monthly'
    )
  ),
  constraint monthly_usage_counters_period_check check (
    period_start = (
      date_trunc('month', period_start at time zone 'UTC') at time zone 'UTC'
    )
    and period_end = (
      (date_trunc('month', period_start at time zone 'UTC') + interval '1 month')
      at time zone 'UTC'
    )
    and period_end > period_start
  ),
  constraint monthly_usage_counters_consumed_check check (consumed >= 0),
  constraint monthly_usage_counters_timestamp_check check (
    updated_at >= created_at
  )
);

create table coachfort_internal.monthly_usage_consumption_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  event_key text not null,
  amount integer not null,
  created_at timestamptz not null default now(),
  constraint monthly_usage_consumption_events_resource_check check (
    resource_key in (
      'messages_monthly',
      'automation_runs_monthly',
      'ai_requests_monthly'
    )
  ),
  constraint monthly_usage_consumption_events_period_check check (
    period_start = (
      date_trunc('month', period_start at time zone 'UTC') at time zone 'UTC'
    )
    and period_end = (
      (date_trunc('month', period_start at time zone 'UTC') + interval '1 month')
      at time zone 'UTC'
    )
    and period_end > period_start
  ),
  constraint monthly_usage_consumption_events_event_key_check check (
    event_key = btrim(event_key)
    and event_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
  ),
  constraint monthly_usage_consumption_events_amount_check check (
    amount between 1 and 1000000
  ),
  constraint monthly_usage_consumption_events_idempotency_unique
    unique (tenant_id, resource_key, period_start, event_key)
);

create index monthly_usage_consumption_events_period_idx
on coachfort_internal.monthly_usage_consumption_events (
  tenant_id, period_start, resource_key
);

alter table coachfort_internal.monthly_usage_counters enable row level security;
alter table coachfort_internal.monthly_usage_consumption_events
  enable row level security;

alter table coachfort_internal.monthly_usage_counters owner to postgres;
alter table coachfort_internal.monthly_usage_consumption_events owner to postgres;

revoke all privileges on table
  coachfort_internal.monthly_usage_counters,
  coachfort_internal.monthly_usage_consumption_events
from public, anon, authenticated, service_role;

create function coachfort_internal.utc_calendar_month(
  p_at timestamptz
)
returns table(period_start timestamptz, period_end timestamptz)
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select
    date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC',
    (
      date_trunc('month', p_at at time zone 'UTC') + interval '1 month'
    ) at time zone 'UTC';
$$;

create function coachfort_internal.monthly_usage_authority_lock(
  p_tenant_id uuid,
  p_resource_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource_key text := lower(btrim(coalesce(p_resource_key, '')));
begin
  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if v_resource_key not in (
    'messages_monthly',
    'automation_runs_monthly',
    'ai_requests_monthly'
  ) then
    raise exception 'Unsupported monthly usage resource.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'monthly_usage_authority:'
      || p_tenant_id::text || ':'
      || v_resource_key,
    8422
  ));
end;
$$;

create function coachfort_internal.enforce_monthly_usage_override_authority_lock()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_tenant_id uuid;
  v_old_resource_key text;
  v_old_lock_key text;
  v_new_tenant_id uuid;
  v_new_resource_key text;
  v_new_lock_key text;
begin
  if tg_op <> 'INSERT' then
    if old.override_type in ('limit_raise', 'limit_lower')
       and old.resource_key in (
         'messages_monthly',
         'automation_runs_monthly',
         'ai_requests_monthly'
       ) then
      v_old_tenant_id := old.tenant_id;
      v_old_resource_key := old.resource_key;
      v_old_lock_key := old.tenant_id::text || ':' || old.resource_key;
    end if;
  end if;

  if tg_op <> 'DELETE' then
    if new.override_type in ('limit_raise', 'limit_lower')
       and new.resource_key in (
         'messages_monthly',
         'automation_runs_monthly',
         'ai_requests_monthly'
       ) then
      v_new_tenant_id := new.tenant_id;
      v_new_resource_key := new.resource_key;
      v_new_lock_key := new.tenant_id::text || ':' || new.resource_key;
    end if;
  end if;

  -- Updates that move authority between resources take both locks in one
  -- lexical order. INSERT and DELETE take their one applicable authority lock.
  if v_old_lock_key is not null
     and v_new_lock_key is not null
     and v_old_lock_key <> v_new_lock_key then
    if v_old_lock_key < v_new_lock_key then
      perform coachfort_internal.monthly_usage_authority_lock(
        v_old_tenant_id, v_old_resource_key
      );
      perform coachfort_internal.monthly_usage_authority_lock(
        v_new_tenant_id, v_new_resource_key
      );
    else
      perform coachfort_internal.monthly_usage_authority_lock(
        v_new_tenant_id, v_new_resource_key
      );
      perform coachfort_internal.monthly_usage_authority_lock(
        v_old_tenant_id, v_old_resource_key
      );
    end if;
  elsif v_new_lock_key is not null then
    perform coachfort_internal.monthly_usage_authority_lock(
      v_new_tenant_id, v_new_resource_key
    );
  elsif v_old_lock_key is not null then
    perform coachfort_internal.monthly_usage_authority_lock(
      v_old_tenant_id, v_old_resource_key
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger monthly_usage_override_authority_lock
before insert or update or delete
on public.tenant_subscription_overrides
for each row execute function
  coachfort_internal.enforce_monthly_usage_override_authority_lock();

create function coachfort_internal.resolve_monthly_usage_limit(
  p_tenant_id uuid,
  p_resource_key text
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource_key text := lower(btrim(coalesce(p_resource_key, '')));
  v_plan_id uuid;
  v_base_limit integer;
  v_limit_type text;
  v_enforcement_mode text;
  v_override_value text;
  v_override_found boolean := false;
  v_effective_limit bigint;
begin
  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if v_resource_key not in (
    'messages_monthly',
    'automation_runs_monthly',
    'ai_requests_monthly'
  ) then
    raise exception 'Unsupported monthly usage resource.' using errcode = '22023';
  end if;

  -- Lifecycle is authoritative before assignment, limit, or override lookup.
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);

  select assignment.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  order by assignment.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'Current subscription authority is unavailable.'
      using errcode = '42501';
  end if;

  select
    plan_limit.limit_value,
    plan_limit.limit_type,
    plan_limit.enforcement_mode
  into v_base_limit, v_limit_type, v_enforcement_mode
  from public.subscription_plan_usage_limits plan_limit
  where plan_limit.plan_id = v_plan_id
    and plan_limit.resource_key = v_resource_key;

  if not found
     or v_base_limit is null
     or v_base_limit < 0
     or v_limit_type <> 'monthly_count'
     or v_enforcement_mode <> 'hard' then
    raise exception 'Monthly usage limit authority is unavailable.'
      using errcode = '42501';
  end if;

  select override_row.override_value_json->>'limit_value'
  into v_override_value
  from public.tenant_subscription_overrides override_row
  where override_row.tenant_id = p_tenant_id
    and override_row.resource_key = v_resource_key
    and override_row.override_type in ('limit_raise', 'limit_lower')
    and (override_row.expires_at is null or override_row.expires_at > now())
  order by override_row.created_at desc, override_row.id desc
  limit 1;
  v_override_found := found;

  if v_override_found then
    if coalesce(v_override_value, '') !~ '^[0-9]{1,10}$' then
      raise exception 'Monthly usage override authority is invalid.'
        using errcode = '42501';
    end if;
    if v_override_value::bigint > 2147483647 then
      raise exception 'Monthly usage override authority is invalid.'
        using errcode = '42501';
    end if;
    v_effective_limit := v_override_value::bigint;
  else
    v_effective_limit := v_base_limit::bigint;
  end if;

  if v_effective_limit is null or v_effective_limit < 0 then
    raise exception 'Monthly usage limit authority is unavailable.'
      using errcode = '42501';
  end if;

  return v_effective_limit;
end;
$$;

create function coachfort_internal.enforce_monthly_usage_event_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- CoachFort has no product hard-delete RPC, but the retained Module-70
  -- cleanup scripts delete tenant fixtures and this FK intentionally cascades.
  -- Permit only a nested FK cascade after the parent tenant is already gone.
  if tg_op = 'DELETE'
     and pg_trigger_depth() > 1
     and not exists (
       select 1 from public.tenants tenant where tenant.id = old.tenant_id
     ) then
    return old;
  end if;

  raise exception 'Monthly usage consumption evidence is immutable.'
    using errcode = '55000';
end;
$$;

create trigger monthly_usage_consumption_events_immutable
before update or delete
on coachfort_internal.monthly_usage_consumption_events
for each row execute function
  coachfort_internal.enforce_monthly_usage_event_immutability();

create function coachfort_internal.consume_monthly_usage(
  p_tenant_id uuid,
  p_resource_key text,
  p_event_key text,
  p_amount integer default 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource_key text := lower(btrim(coalesce(p_resource_key, '')));
  v_event_key text := btrim(coalesce(p_event_key, ''));
  v_now timestamptz := statement_timestamp();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_plan_id uuid;
  v_limit bigint;
  v_usage_before bigint := 0;
  v_usage_after bigint;
  v_existing_amount integer;
begin
  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if v_resource_key not in (
    'messages_monthly',
    'automation_runs_monthly',
    'ai_requests_monthly'
  ) then
    raise exception 'Unsupported monthly usage resource.' using errcode = '22023';
  end if;

  if v_event_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'A valid monthly usage event key is required.'
      using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'Monthly usage amount must be between 1 and 1000000.'
      using errcode = '22023';
  end if;

  select period.period_start, period.period_end
  into v_period_start, v_period_end
  from coachfort_internal.utc_calendar_month(v_now) period;

  -- Shared lock order for every consumer:
  -- tenant/resource authority, then tenant/resource/UTC-month consumption.
  perform coachfort_internal.monthly_usage_authority_lock(
    p_tenant_id,
    v_resource_key
  );

  -- Serialize all consumers at the exact tenant/resource/UTC-month boundary.
  perform pg_advisory_xact_lock(hashtextextended(
    'monthly_usage:'
      || p_tenant_id::text || ':'
      || v_resource_key || ':'
      || extract(epoch from v_period_start)::bigint::text,
    8422
  ));

  -- Lifecycle remains authoritative before assignment or quota resolution.
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);

  -- Give current assignment and plan-limit changes a deterministic order with
  -- consumption before the post-wait authority resolution.
  select assignment.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  order by assignment.created_at desc
  limit 1
  for share;

  perform 1
  from public.subscription_plan_usage_limits plan_limit
  where plan_limit.plan_id = v_plan_id
    and plan_limit.resource_key = v_resource_key
  for share;

  -- Re-resolve after waiting/locking so committed authority changes apply now.
  v_limit := coachfort_internal.resolve_monthly_usage_limit(
    p_tenant_id,
    v_resource_key
  );

  select event.amount
  into v_existing_amount
  from coachfort_internal.monthly_usage_consumption_events event
  where event.tenant_id = p_tenant_id
    and event.resource_key = v_resource_key
    and event.period_start = v_period_start
    and event.event_key = v_event_key;

  if found then
    if v_existing_amount is distinct from p_amount then
      raise exception 'Monthly usage event key conflicts with prior consumption.'
        using errcode = '22023';
    end if;

    select counter.consumed
    into v_usage_after
    from coachfort_internal.monthly_usage_counters counter
    where counter.tenant_id = p_tenant_id
      and counter.resource_key = v_resource_key
      and counter.period_start = v_period_start;

    if not found then
      raise exception 'Monthly usage counter integrity check failed.'
        using errcode = '55000';
    end if;

    return jsonb_build_object(
      'consumed', 0,
      'replayed', true,
      'usage_after', v_usage_after,
      'limit', v_limit,
      'period_start', v_period_start,
      'period_end', v_period_end
    );
  end if;

  select counter.consumed
  into v_usage_before
  from coachfort_internal.monthly_usage_counters counter
  where counter.tenant_id = p_tenant_id
    and counter.resource_key = v_resource_key
    and counter.period_start = v_period_start;
  v_usage_before := coalesce(v_usage_before, 0);

  if v_usage_before >= v_limit
     or p_amount::bigint > v_limit - v_usage_before then
    raise exception 'Monthly usage limit reached.' using errcode = '22023';
  end if;

  insert into coachfort_internal.monthly_usage_counters as counter (
    tenant_id,
    resource_key,
    period_start,
    period_end,
    consumed,
    created_at,
    updated_at
  ) values (
    p_tenant_id,
    v_resource_key,
    v_period_start,
    v_period_end,
    p_amount,
    v_now,
    v_now
  )
  on conflict (tenant_id, resource_key, period_start) do update
  set consumed = counter.consumed + excluded.consumed,
      period_end = excluded.period_end,
      updated_at = excluded.updated_at
  returning consumed into v_usage_after;

  insert into coachfort_internal.monthly_usage_consumption_events (
    tenant_id,
    resource_key,
    period_start,
    period_end,
    event_key,
    amount,
    created_at
  ) values (
    p_tenant_id,
    v_resource_key,
    v_period_start,
    v_period_end,
    v_event_key,
    p_amount,
    v_now
  );

  return jsonb_build_object(
    'consumed', p_amount,
    'replayed', false,
    'usage_after', v_usage_after,
    'limit', v_limit,
    'period_start', v_period_start,
    'period_end', v_period_end
  );
end;
$$;

create function coachfort_internal.monthly_usage_state(
  p_tenant_id uuid,
  p_at timestamptz default statement_timestamp()
)
returns table(
  resource_key text,
  consumed bigint,
  limit_value bigint,
  remaining bigint,
  period_start timestamptz,
  period_end timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with period as (
    select * from coachfort_internal.utc_calendar_month(p_at)
  ), resources(resource_key) as (
    values
      ('messages_monthly'::text),
      ('automation_runs_monthly'::text),
      ('ai_requests_monthly'::text)
  )
  select
    resources.resource_key,
    coalesce(counter.consumed, 0)::bigint consumed,
    authority.limit_value,
    greatest(
      authority.limit_value - coalesce(counter.consumed, 0),
      0
    )::bigint remaining,
    period.period_start,
    period.period_end
  from resources
  cross join period
  cross join lateral (
    select coachfort_internal.resolve_monthly_usage_limit(
      p_tenant_id,
      resources.resource_key
    ) limit_value
  ) authority
  left join coachfort_internal.monthly_usage_counters counter
    on counter.tenant_id = p_tenant_id
   and counter.resource_key = resources.resource_key
   and counter.period_start = period.period_start
  order by resources.resource_key;
$$;

create function coachfort_internal.monthly_usage_reconciliation(
  p_tenant_id uuid default null
)
returns table(
  tenant_id uuid,
  resource_key text,
  period_start timestamptz,
  counter_consumed bigint,
  event_consumed bigint,
  event_count bigint,
  matches boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with event_totals as (
    select
      event.tenant_id,
      event.resource_key,
      event.period_start,
      sum(event.amount)::bigint event_consumed,
      count(*)::bigint event_count
    from coachfort_internal.monthly_usage_consumption_events event
    where p_tenant_id is null or event.tenant_id = p_tenant_id
    group by event.tenant_id, event.resource_key, event.period_start
  ), counter_totals as (
    select
      counter.tenant_id,
      counter.resource_key,
      counter.period_start,
      counter.consumed
    from coachfort_internal.monthly_usage_counters counter
    where p_tenant_id is null or counter.tenant_id = p_tenant_id
  )
  select
    coalesce(counter.tenant_id, event.tenant_id),
    coalesce(counter.resource_key, event.resource_key),
    coalesce(counter.period_start, event.period_start),
    coalesce(counter.consumed, 0)::bigint,
    coalesce(event.event_consumed, 0)::bigint,
    coalesce(event.event_count, 0)::bigint,
    coalesce(counter.consumed, 0) = coalesce(event.event_consumed, 0)
  from counter_totals counter
  full join event_totals event
    on event.tenant_id = counter.tenant_id
   and event.resource_key = counter.resource_key
   and event.period_start = counter.period_start
  order by 1, 3, 2;
$$;

alter function coachfort_internal.utc_calendar_month(timestamptz)
  owner to postgres;
alter function coachfort_internal.monthly_usage_authority_lock(uuid,text)
  owner to postgres;
alter function
  coachfort_internal.enforce_monthly_usage_override_authority_lock()
  owner to postgres;
alter function coachfort_internal.resolve_monthly_usage_limit(uuid,text)
  owner to postgres;
alter function coachfort_internal.enforce_monthly_usage_event_immutability()
  owner to postgres;
alter function coachfort_internal.consume_monthly_usage(uuid,text,text,integer)
  owner to postgres;
alter function coachfort_internal.monthly_usage_state(uuid,timestamptz)
  owner to postgres;
alter function coachfort_internal.monthly_usage_reconciliation(uuid)
  owner to postgres;

revoke all on function coachfort_internal.utc_calendar_month(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.monthly_usage_authority_lock(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.enforce_monthly_usage_override_authority_lock()
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.resolve_monthly_usage_limit(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.enforce_monthly_usage_event_immutability()
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.consume_monthly_usage(uuid,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.monthly_usage_state(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.monthly_usage_reconciliation(uuid)
  from public, anon, authenticated, service_role;

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this query separately in Supabase SQL Editor after APPLY. It reads only
catalog metadata and aggregate counts.

with expected_tables(identity) as (
  values
    ('coachfort_internal.monthly_usage_counters'),
    ('coachfort_internal.monthly_usage_consumption_events')
), table_state as (
  select
    count(*) filter (
      where class.oid is not null
        and pg_get_userbyid(class.relowner) = 'postgres'
        and class.relrowsecurity
        and not class.relforcerowsecurity
    ) secure_count,
    count(*) expected_count
  from expected_tables expected
  left join pg_catalog.pg_class class on class.oid = to_regclass(expected.identity)
), expected_functions(identity, security_definer, volatility) as (
  values
    ('coachfort_internal.utc_calendar_month(timestamptz)', false, 'i'),
    ('coachfort_internal.monthly_usage_authority_lock(uuid,text)', true, 'v'),
    ('coachfort_internal.enforce_monthly_usage_override_authority_lock()', true, 'v'),
    ('coachfort_internal.resolve_monthly_usage_limit(uuid,text)', true, 's'),
    ('coachfort_internal.enforce_monthly_usage_event_immutability()', true, 'v'),
    ('coachfort_internal.consume_monthly_usage(uuid,text,text,integer)', true, 'v'),
    ('coachfort_internal.monthly_usage_state(uuid,timestamptz)', true, 's'),
    ('coachfort_internal.monthly_usage_reconciliation(uuid)', true, 's')
), function_state as (
  select
    count(*) filter (
      where procedure.oid is not null
        and pg_get_userbyid(procedure.proowner) = 'postgres'
        and procedure.prosecdef = expected.security_definer
        and procedure.provolatile = expected.volatility
        and coalesce(array_to_string(procedure.proconfig, ','), '')
          like '%search_path=public, pg_temp%'
    ) secure_count,
    count(*) expected_count
  from expected_functions expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), function_acl as (
  select
    count(*) filter (
      where has_function_privilege('anon', identity, 'EXECUTE')
    ) anon_execute,
    count(*) filter (
      where has_function_privilege('authenticated', identity, 'EXECUTE')
    ) authenticated_execute,
    count(*) filter (
      where has_function_privilege('service_role', identity, 'EXECUTE')
    ) service_role_execute,
    count(*) filter (where exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral aclexplode(
        coalesce(procedure.proacl, acldefault('f', procedure.proowner))
      ) acl
      where procedure.oid = to_regprocedure(identity)
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )) public_execute
  from expected_functions
), override_writer_state as (
  select
    procedure.oid is not null installed,
    coalesce(pg_get_userbyid(procedure.proowner) = 'postgres', false)
      postgres_owned,
    coalesce(procedure.prosecdef, false) security_definer,
    case when procedure.oid is null then false else
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    end authenticated_execute,
    case when procedure.oid is null then false else not
      has_function_privilege('anon', procedure.oid, 'EXECUTE')
    end anon_execute_denied,
    case when procedure.oid is null then false else not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) end public_execute_denied,
    coalesce(lower(pg_get_functiondef(procedure.oid)) like
      '%subscription_entitlements_assert_platform_owner_admin%', false)
      platform_authorized,
    coalesce(lower(pg_get_functiondef(procedure.oid)) like
      '%insert into public.tenant_subscription_overrides%', false)
      inserts_override
  from (select to_regprocedure(
    'public.approve_tenant_feature_override(uuid,text,text,text,jsonb,text,timestamptz,jsonb)'
  ) oid) expected
  left join pg_catalog.pg_proc procedure on procedure.oid = expected.oid
), table_acl as (
  select
    (select count(*)
      from information_schema.table_privileges privilege
      where privilege.table_schema = 'coachfort_internal'
        and privilege.table_name in (
          'monthly_usage_counters',
          'monthly_usage_consumption_events'
        )
        and privilege.grantee in (
          'PUBLIC', 'anon', 'authenticated', 'service_role'
        )) direct_grants,
    (select count(*)
      from expected_tables expected
      cross join (values
        ('anon'), ('authenticated'), ('service_role')
      ) role(role_name)
      where has_table_privilege(
        role.role_name,
        expected.identity,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )) effective_privileges
), commercial_authority_tables(identity) as (
  values
    ('public.tenant_subscription_assignments'),
    ('public.subscription_plan_usage_limits'),
    ('public.tenant_subscription_overrides')
), commercial_authority_acl as (
  select
    (select count(*)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'anon', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) anon_mutation_table_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'authenticated', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) authenticated_mutation_table_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      join pg_catalog.pg_class class
        on class.oid = to_regclass(commercial_table.identity)
      cross join lateral aclexplode(coalesce(
        class.relacl,
        acldefault('r', class.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
      public_direct_mutation_grant_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      cross join (values ('anon'), ('authenticated')) browser_role(role_name)
      where has_table_privilege(
        browser_role.role_name,
        commercial_table.identity,
        'INSERT,UPDATE,DELETE'
      ))
    +
    (select count(*)
      from commercial_authority_tables commercial_table
      join pg_catalog.pg_class class
        on class.oid = to_regclass(commercial_table.identity)
      cross join lateral aclexplode(coalesce(
        class.relacl,
        acldefault('r', class.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
      browser_mutation_authority_count,
    (select count(*)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'service_role', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) service_role_mutation_table_count,
    (select coalesce(jsonb_agg(commercial_table.identity order by identity), '[]'::jsonb)
      from commercial_authority_tables commercial_table
      where has_table_privilege(
        'service_role', commercial_table.identity, 'INSERT,UPDATE,DELETE'
      )) service_role_mutation_tables
), constraint_state as (
  select count(*) installed_count
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conname in (
    'monthly_usage_counters_pkey',
    'monthly_usage_counters_resource_check',
    'monthly_usage_counters_period_check',
    'monthly_usage_counters_consumed_check',
    'monthly_usage_counters_timestamp_check',
    'monthly_usage_consumption_events_resource_check',
    'monthly_usage_consumption_events_period_check',
    'monthly_usage_consumption_events_event_key_check',
    'monthly_usage_consumption_events_amount_check',
    'monthly_usage_consumption_events_idempotency_unique'
  )
), trigger_state as (
  select
    exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where not trigger_row.tgisinternal
      and trigger_row.tgname = 'monthly_usage_consumption_events_immutable'
      and trigger_row.tgrelid = to_regclass(
        'coachfort_internal.monthly_usage_consumption_events'
      )
      and trigger_row.tgfoid = to_regprocedure(
        'coachfort_internal.enforce_monthly_usage_event_immutability()'
      )
      and (trigger_row.tgtype & 1) = 1
      and (trigger_row.tgtype & 2) = 2
      and (trigger_row.tgtype & 8) = 8
      and (trigger_row.tgtype & 16) = 16
    ) immutable_event_trigger,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      where not trigger_row.tgisinternal
        and trigger_row.tgname = 'monthly_usage_override_authority_lock'
        and trigger_row.tgrelid = to_regclass(
          'public.tenant_subscription_overrides'
        )
        and trigger_row.tgfoid = to_regprocedure(
          'coachfort_internal.enforce_monthly_usage_override_authority_lock()'
        )
        and (trigger_row.tgtype & 1) = 1
        and (trigger_row.tgtype & 2) = 2
        and (trigger_row.tgtype & 4) = 4
        and (trigger_row.tgtype & 8) = 8
        and (trigger_row.tgtype & 16) = 16
    ) override_authority_trigger
), source_state as (
  select
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.utc_calendar_month(timestamptz)'
    )), '[[:space:]]+', ' ', 'g')) period_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.monthly_usage_authority_lock(uuid,text)'
    )), '[[:space:]]+', ' ', 'g')) authority_lock_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_monthly_usage_override_authority_lock()'
    )), '[[:space:]]+', ' ', 'g')) override_lock_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.resolve_monthly_usage_limit(uuid,text)'
    )), '[[:space:]]+', ' ', 'g')) limit_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    )), '[[:space:]]+', ' ', 'g')) consume_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_monthly_usage_event_immutability()'
    )), '[[:space:]]+', ' ', 'g')) immutability_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.monthly_usage_state(uuid,timestamptz)'
    )), '[[:space:]]+', ' ', 'g')) state_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.monthly_usage_reconciliation(uuid)'
    )), '[[:space:]]+', ' ', 'g')) reconciliation_source
), contract_state as (
  select
    period_source like '%at time zone ''utc''%'
      and period_source like '%interval ''1 month''%' utc_period_contract,
    authority_lock_source like '%monthly_usage_authority:%'
      and authority_lock_source like '%pg_advisory_xact_lock%'
      and authority_lock_source like '%p_tenant_id::text%'
      and authority_lock_source like '%v_resource_key%'
      and override_lock_source like '%monthly_usage_authority_lock(%'
      and override_lock_source like '%v_old_lock_key < v_new_lock_key%'
      and override_lock_source like '%limit_raise%'
      and override_lock_source like '%limit_lower%'
      override_authority_lock_contract,
    limit_source like '%assert_tenant_operational_access(p_tenant_id)%'
      and limit_source like '%assignment.is_current%'
      and limit_source like '%subscription_plan_usage_limits%'
      and limit_source like '%tenant_subscription_overrides%'
      and limit_source like '%monthly_count%'
      and limit_source like '%hard%'
      and position('assert_tenant_operational_access' in limit_source)
        < position('tenant_subscription_assignments' in limit_source)
      and position('tenant_subscription_assignments' in limit_source)
        < position('subscription_plan_usage_limits' in limit_source)
      canonical_limit_contract,
    consume_source like '%pg_advisory_xact_lock%'
      and consume_source like '%hashtextextended%'
      and consume_source like '%extract(epoch from v_period_start)::bigint::text%'
      and consume_source like '%for share%'
      and consume_source like '%monthly_usage_consumption_events%'
      and consume_source like '%monthly_usage_counters%'
      and consume_source like '%on conflict (tenant_id, resource_key, period_start)%'
      and consume_source like '%v_usage_before >= v_limit%'
      and consume_source like '%v_limit - v_usage_before%'
      and position('monthly_usage_authority_lock(' in consume_source)
        < position('pg_advisory_xact_lock' in consume_source)
      and position('pg_advisory_xact_lock' in consume_source)
        < position('assert_tenant_operational_access' in consume_source)
      and position('assert_tenant_operational_access' in consume_source)
        < position('for share' in consume_source)
      and position('for share' in consume_source)
        < position('resolve_monthly_usage_limit' in consume_source)
      and position('resolve_monthly_usage_limit' in consume_source)
        < position('select event.amount' in consume_source)
      serialization_and_quota_contract,
    consume_source like '%v_existing_amount is distinct from p_amount%'
      and consume_source like '%''replayed'', true%'
      and consume_source like '%''consumed'', 0%'
      idempotent_replay_contract,
    state_source like '%resolve_monthly_usage_limit%'
      and state_source like '%greatest(%'
      and reconciliation_source like '%full join%'
      and reconciliation_source like '%sum(event.amount)%'
      read_and_reconciliation_contract,
    immutability_source like '%pg_trigger_depth() > 1%'
      and immutability_source like '%not exists (%'
      and immutability_source like '%from public.tenants%'
      and immutability_source like '%return old%'
      tenant_delete_cascade_contract
  from source_state
), period_samples as (
  select
    sep_start.period_start = '2026-09-01 00:00:00+00'::timestamptz
      and sep_start.period_end = '2026-10-01 00:00:00+00'::timestamptz
      and sep_end.period_start = '2026-09-01 00:00:00+00'::timestamptz
      and sep_end.period_end = '2026-10-01 00:00:00+00'::timestamptz
      and oct_start.period_start = '2026-10-01 00:00:00+00'::timestamptz
      and oct_start.period_end = '2026-11-01 00:00:00+00'::timestamptz
      and offset_sample.period_start = '2026-10-01 00:00:00+00'::timestamptz
      and offset_sample.period_end = '2026-11-01 00:00:00+00'::timestamptz
      passed
  from coachfort_internal.utc_calendar_month(
    '2026-09-01 00:00:00+00'::timestamptz
  ) sep_start
  cross join coachfort_internal.utc_calendar_month(
    '2026-09-30 23:59:59.999999+00'::timestamptz
  ) sep_end
  cross join coachfort_internal.utc_calendar_month(
    '2026-10-01 00:00:00+00'::timestamptz
  ) oct_start
  cross join coachfort_internal.utc_calendar_month(
    '2026-09-30 23:30:00-07'::timestamptz
  ) offset_sample
), internal_schema_state as (
  select
    namespace.oid is not null installed,
    pg_get_userbyid(namespace.nspowner) = 'postgres' postgres_owned,
    coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting settings
      join pg_catalog.pg_roles role on role.oid = settings.setrole
      cross join lateral unnest(settings.setconfig) config(value)
      cross join lateral regexp_split_to_table(
        split_part(config.value, '=', 2), ','
      ) exposed(schema_name)
      where role.rolname = 'authenticator'
        and config.value like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ) api_exposed
  from (select to_regnamespace('coachfort_internal') oid) existing
  left join pg_catalog.pg_namespace namespace on namespace.oid = existing.oid
), data_counts as (
  select
    (select count(*) from coachfort_internal.monthly_usage_counters)
      monthly_counter_rows,
    (select count(*) from coachfort_internal.monthly_usage_consumption_events)
      monthly_consumption_event_rows,
    (select count(*) from public.tenant_usage_snapshots) legacy_snapshot_rows,
    (select count(*) from public.tenant_usage_events) legacy_usage_event_rows,
    (select count(*) from public.tenant_subscription_assignments)
      subscription_assignment_rows,
    (select count(*) from public.tenant_subscription_assignments where is_current)
      current_subscription_assignment_rows,
    (select count(*) from public.subscription_plan_usage_limits)
      plan_limit_rows,
    (select count(*) from public.tenant_subscription_overrides)
      subscription_override_rows
), gate as (
  select
    (select secure_count = expected_count from table_state)
    and (select secure_count = expected_count from function_state)
    and (select anon_execute = 0 and authenticated_execute = 0
      and service_role_execute = 0 and public_execute = 0 from function_acl)
    and (select installed and postgres_owned and security_definer
      and authenticated_execute and anon_execute_denied
      and public_execute_denied and platform_authorized and inserts_override
      from override_writer_state)
    and (select direct_grants = 0 and effective_privileges = 0 from table_acl)
    and (select anon_mutation_table_count = 0
      and authenticated_mutation_table_count = 0
      and public_direct_mutation_grant_count = 0
      and browser_mutation_authority_count = 0
      from commercial_authority_acl)
    and (select installed_count = 10 from constraint_state)
    and (select immutable_event_trigger and override_authority_trigger
      from trigger_state)
    and (select utc_period_contract and override_authority_lock_contract
      and canonical_limit_contract
      and serialization_and_quota_contract and idempotent_replay_contract
      and read_and_reconciliation_contract and tenant_delete_cascade_contract
      from contract_state)
    and (select passed from period_samples)
    and (select installed and postgres_owned and not api_exposed
      from internal_schema_state)
    and (select monthly_counter_rows = 0
      and monthly_consumption_event_rows = 0 from data_counts)
    passed
)
select jsonb_pretty(jsonb_build_object(
  'security_gate', (select passed from gate),
  'tables', (select to_jsonb(table_state) from table_state),
  'functions', (select to_jsonb(function_state) from function_state),
  'function_acl', (select to_jsonb(function_acl) from function_acl),
  'override_writer', (select to_jsonb(override_writer_state)
    from override_writer_state),
  'table_acl', (select to_jsonb(table_acl) from table_acl),
  'commercial_authority_acl',
    (select to_jsonb(commercial_authority_acl)
      from commercial_authority_acl),
  'constraint_count', (select installed_count from constraint_state),
  'triggers', (select to_jsonb(trigger_state) from trigger_state),
  'contracts', (select to_jsonb(contract_state) from contract_state),
  'period_samples', (select passed from period_samples),
  'internal_schema',
    (select to_jsonb(internal_schema_state) from internal_schema_state),
  'data_counts', (select to_jsonb(data_counts) from data_counts)
));
*/
