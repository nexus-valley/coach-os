-- Bundle UX-8G4A2D1: Automation Monthly Meter Integration
-- Review before execution. Do not run until approved.
--
-- Deployment order:
-- 1. Apply this SQL bridge while the five-argument client remains deployed.
-- 2. Deploy the request-aware application caller.
-- 3. Verify PostgREST discovery and production behavior.
-- 4. Retire the five-argument bridge in UX-8G4A2D2.

/*
PRE-APPLY READ-ONLY VERIFICATION

with expected_columns(table_name, column_name) as (
  values
    ('automation_rules', 'id'),
    ('automation_rules', 'tenant_id'),
    ('automation_rules', 'trigger_type'),
    ('automation_rules', 'status'),
    ('automation_rules', 'created_at'),
    ('automation_rule_conditions', 'id'),
    ('automation_rule_conditions', 'tenant_id'),
    ('automation_rule_conditions', 'rule_id'),
    ('automation_rule_conditions', 'condition_type'),
    ('automation_rule_conditions', 'value_json'),
    ('automation_rule_conditions', 'sort_order'),
    ('automation_rule_actions', 'id'),
    ('automation_rule_actions', 'tenant_id'),
    ('automation_rule_actions', 'rule_id'),
    ('automation_rule_actions', 'action_type'),
    ('automation_rule_actions', 'config_json'),
    ('automation_rule_actions', 'sort_order'),
    ('automation_runs', 'id'),
    ('automation_runs', 'tenant_id'),
    ('automation_runs', 'rule_id'),
    ('automation_runs', 'trigger_source'),
    ('automation_runs', 'entity_type'),
    ('automation_runs', 'entity_id'),
    ('automation_runs', 'status'),
    ('automation_runs', 'started_at'),
    ('automation_runs', 'completed_at'),
    ('automation_runs', 'error_message'),
    ('automation_runs', 'created_by'),
    ('automation_runs', 'metadata_json'),
    ('automation_run_logs', 'id'),
    ('automation_run_logs', 'tenant_id'),
    ('automation_run_logs', 'run_id'),
    ('automation_run_logs', 'log_level'),
    ('automation_run_logs', 'message'),
    ('automation_run_logs', 'metadata_json'),
    ('automation_run_logs', 'created_at')
), column_state as (
  select count(*) expected_count, count(column_def.column_name) installed_count
  from expected_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
), function_state as (
  select
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
    ) old_runner,
    to_regprocedure(
      'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
    ) unvalidated_runner,
    to_regprocedure(
      'public.is_valid_automation_trigger(uuid,text,text,uuid,jsonb)'
    ) trigger_validator,
    to_regprocedure(
      'public.delete_automation_rule_secure(uuid,uuid)'
    ) delete_rule,
    to_regprocedure(
      'coachfort_internal.assert_tenant_operational_access(uuid)'
    ) lifecycle_assertion,
    to_regprocedure(
      'coachfort_internal.assert_effective_operational_feature(uuid,text)'
    ) feature_assertion,
    to_regprocedure(
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    ) monthly_consumer,
    to_regprocedure('extensions.digest(bytea,text)') pgcrypto_digest
), source_state as (
  select
    lower(regexp_replace(
      pg_get_functiondef(function_state.old_runner), '[[:space:]]+', ' ', 'g'
    )) old_source,
    lower(regexp_replace(
      pg_get_functiondef(function_state.unvalidated_runner),
      '[[:space:]]+', ' ', 'g'
    )) unvalidated_source,
    lower(regexp_replace(
      pg_get_functiondef(function_state.monthly_consumer),
      '[[:space:]]+', ' ', 'g'
    )) meter_source,
    lower(regexp_replace(
      pg_get_functiondef(function_state.delete_rule),
      '[[:space:]]+', ' ', 'g'
    )) delete_source
  from function_state
), rpc_inventory as (
  select
    count(*) filter (
      where procedure.oid = to_regprocedure(
        'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
      )
    ) old_identity_count,
    count(*) filter (
      where procedure.oid = to_regprocedure(
        'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
      )
    ) request_identity_count,
    count(*) total_identity_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'run_automation_trigger'
), acl_state as (
  select
    has_function_privilege(
      'authenticated', function_state.old_runner, 'EXECUTE'
    ) old_authenticated,
    has_function_privilege('anon', function_state.old_runner, 'EXECUTE') old_anon,
    has_function_privilege(
      'service_role', function_state.old_runner, 'EXECUTE'
    ) old_service,
    exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = function_state.old_runner
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) old_public,
    has_function_privilege(
      'authenticated', function_state.unvalidated_runner, 'EXECUTE'
    ) unvalidated_authenticated,
    has_function_privilege(
      'anon', function_state.unvalidated_runner, 'EXECUTE'
    ) unvalidated_anon,
    has_function_privilege(
      'service_role', function_state.unvalidated_runner, 'EXECUTE'
    ) unvalidated_service,
    exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = function_state.unvalidated_runner
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) unvalidated_public,
    has_function_privilege(
      'authenticated', function_state.monthly_consumer, 'EXECUTE'
    ) meter_authenticated,
    has_function_privilege(
      'anon', function_state.monthly_consumer, 'EXECUTE'
    ) meter_anon,
    has_function_privilege(
      'service_role', function_state.monthly_consumer, 'EXECUTE'
    ) meter_service,
    exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = function_state.monthly_consumer
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) meter_public
  from function_state
), browser_writes as (
  select count(*) write_grants
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in (
      'automation_rules', 'automation_rule_conditions',
      'automation_rule_actions', 'automation_runs', 'automation_run_logs'
    )
    and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), delete_contract as (
  select
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.automation_rule_conditions'::regclass
        and constraint_row.conname =
          'automation_rule_conditions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) condition_rule_cascade,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_rule_actions'::regclass
        and constraint_row.conname = 'automation_rule_actions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) action_rule_cascade,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname = 'automation_runs_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'n'
    ) run_rule_set_null,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_run_logs'::regclass
        and constraint_row.conname = 'automation_run_logs_run_id_fkey'
        and constraint_row.confrelid = 'public.automation_runs'::regclass
        and constraint_row.confdeltype = 'c'
    ) run_log_cascade,
    source_state.delete_source like '%delete from public.automation_rules%'
      and source_state.delete_source not like
        '%delete from public.automation_runs%'
      and source_state.delete_source not like
        '%delete from public.automation_run_logs%'
      delete_preserves_history
  from source_state
), service_writes as (
  select jsonb_agg(jsonb_build_object(
    'table', privilege.table_name,
    'privilege', privilege.privilege_type,
    'grantable', privilege.is_grantable
  ) order by privilege.table_name, privilege.privilege_type) grants
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in (
      'automation_rules', 'automation_rule_conditions',
      'automation_rule_actions', 'automation_runs', 'automation_run_logs'
    )
    and privilege.grantee = 'service_role'
    and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), partial_installation as (
  select
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
    ) is not null request_runner_exists,
    to_regprocedure(
      'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
    ) is not null metered_runner_exists,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'automation_runs'
       and column_name in (
         'execution_id', 'execution_fingerprint', 'rule_id_snapshot'
       )
    ) execution_columns_exist,
    to_regclass(
      'public.automation_runs_tenant_rule_execution_unique_idx'
    ) is not null execution_index_exists,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname =
          'automation_runs_execution_identity_pair_check'
    ) execution_constraint_exists,
    exists (
      select 1
      from pg_trigger trigger
      where trigger.tgrelid = 'public.automation_runs'::regclass
        and trigger.tgname =
          'automation_runs_execution_identity_immutable'
        and not trigger.tgisinternal
    ) execution_trigger_exists
), protected_rows as (
  select jsonb_build_object(
    'automation_rules', (select count(*) from public.automation_rules),
    'automation_conditions',
      (select count(*) from public.automation_rule_conditions),
    'automation_actions',
      (select count(*) from public.automation_rule_actions),
    'automation_runs', (select count(*) from public.automation_runs),
    'automation_run_logs', (select count(*) from public.automation_run_logs),
    'monthly_usage_counters',
      (select count(*) from coachfort_internal.monthly_usage_counters),
    'monthly_usage_events',
      (select count(*) from coachfort_internal.monthly_usage_consumption_events),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits)
  ) counts
)
select
  jsonb_build_object(
    'columns', to_jsonb(column_state),
    'functions', to_jsonb(function_state),
    'rpc_inventory', to_jsonb(rpc_inventory),
    'acl', to_jsonb(acl_state),
    'browser_write_grants', browser_writes.write_grants,
    'delete_contract', to_jsonb(delete_contract),
    'service_role_write_inventory', coalesce(service_writes.grants, '[]'::jsonb),
    'partial_installation', to_jsonb(partial_installation),
    'protected_rows', protected_rows.counts
  ) verification,
  column_state.installed_count = column_state.expected_count
    and function_state.old_runner is not null
    and function_state.unvalidated_runner is not null
    and function_state.trigger_validator is not null
    and function_state.delete_rule is not null
    and function_state.lifecycle_assertion is not null
    and function_state.feature_assertion is not null
    and function_state.monthly_consumer is not null
    and function_state.pgcrypto_digest is not null
    and source_state.old_source like
      '%assert_tenant_operational_access%assert_effective_operational_feature%run_automation_trigger_unvalidated%'
    and source_state.unvalidated_source like '%for v_rule in%'
    and source_state.unvalidated_source like '%insert into public.automation_runs%'
    and source_state.meter_source like '%automation_runs_monthly%'
    and delete_contract.condition_rule_cascade
    and delete_contract.action_rule_cascade
    and delete_contract.run_rule_set_null
    and delete_contract.run_log_cascade
    and delete_contract.delete_preserves_history
    and rpc_inventory.old_identity_count = 1
    and rpc_inventory.request_identity_count = 0
    and rpc_inventory.total_identity_count = 1
    and acl_state.old_authenticated
    and not acl_state.old_anon
    and not acl_state.old_service
    and not acl_state.old_public
    and not acl_state.unvalidated_authenticated
    and not acl_state.unvalidated_anon
    and not acl_state.unvalidated_service
    and not acl_state.unvalidated_public
    and not acl_state.meter_authenticated
    and not acl_state.meter_anon
    and not acl_state.meter_service
    and not acl_state.meter_public
    and browser_writes.write_grants = 0
    and not partial_installation.request_runner_exists
    and not partial_installation.metered_runner_exists
    and not partial_installation.execution_columns_exist
    and not partial_installation.execution_index_exists
    and not partial_installation.execution_constraint_exists
    and not partial_installation.execution_trigger_exists
    as ready_for_apply
from column_state
cross join function_state
cross join source_state
cross join rpc_inventory
cross join acl_state
cross join browser_writes
cross join delete_contract
cross join service_writes
cross join partial_installation
cross join protected_rows;
*/

begin;

do $$
declare
  v_old_source text;
  v_unvalidated_source text;
  v_delete_source text;
begin
  if to_regprocedure(
       'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.is_valid_automation_trigger(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.delete_automation_rule_secure(uuid,uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.assert_tenant_operational_access(uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.assert_effective_operational_feature(uuid,text)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
     ) is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'UX-8G4A2A/A2B Automation prerequisites are unavailable.'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
     ) is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'automation_runs'
         and column_name in (
           'execution_id', 'execution_fingerprint', 'rule_id_snapshot'
         )
     )
     or to_regclass(
       'public.automation_runs_tenant_rule_execution_unique_idx'
     ) is not null
     or exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_runs'::regclass
         and constraint_row.conname =
           'automation_runs_execution_identity_pair_check'
     )
     or exists (
       select 1
       from pg_trigger trigger
       where trigger.tgrelid = 'public.automation_runs'::regclass
         and trigger.tgname =
           'automation_runs_execution_identity_immutable'
         and not trigger.tgisinternal
     ) then
    raise exception 'UX-8G4A2D1 appears partially installed.'
      using errcode = '55000';
  end if;

  select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
  )), '[[:space:]]+', ' ', 'g')) into v_old_source;
  select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
  )), '[[:space:]]+', ' ', 'g')) into v_unvalidated_source;
  select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.delete_automation_rule_secure(uuid,uuid)'
  )), '[[:space:]]+', ' ', 'g')) into v_delete_source;

  if v_old_source not like
       '%assert_tenant_operational_access%assert_effective_operational_feature%run_automation_trigger_unvalidated%'
     or v_unvalidated_source not like '%for v_rule in%'
     or v_unvalidated_source not like '%insert into public.automation_runs%'
     or v_delete_source not like '%delete from public.automation_rules%'
     or v_delete_source like '%delete from public.automation_runs%'
     or v_delete_source like '%delete from public.automation_run_logs%'
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid =
           'public.automation_rule_conditions'::regclass
         and constraint_row.conname =
           'automation_rule_conditions_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'c'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_rule_actions'::regclass
         and constraint_row.conname = 'automation_rule_actions_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'c'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_runs'::regclass
         and constraint_row.conname = 'automation_runs_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'n'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_run_logs'::regclass
         and constraint_row.conname = 'automation_run_logs_run_id_fkey'
         and constraint_row.confrelid = 'public.automation_runs'::regclass
         and constraint_row.confdeltype = 'c'
     ) then
    raise exception 'Installed Automation execution authority has drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'automation_rules', 'automation_rule_conditions',
        'automation_rule_actions', 'automation_runs', 'automation_run_logs'
      )
      and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Automation browser write authority has drifted.'
      using errcode = '55000';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = to_regprocedure(
         'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
       )
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Private Automation execution authority is exposed.'
      using errcode = '55000';
  end if;
end;
$$;

create temp table ux8g4a2d1_apply_baseline on commit drop as
select
  (select count(*) from public.automation_rules) automation_rules,
  (select count(*) from public.automation_rule_conditions) automation_conditions,
  (select count(*) from public.automation_rule_actions) automation_actions,
  (select count(*) from public.automation_runs) automation_runs,
  (select count(*) from public.automation_run_logs) automation_run_logs,
  (select count(*) from coachfort_internal.monthly_usage_counters)
    monthly_usage_counters,
  (select count(*) from coachfort_internal.monthly_usage_consumption_events)
    monthly_usage_events,
  (select count(*) from public.tenant_subscription_assignments)
    subscription_assignments,
  (select count(*) from public.subscription_plan_usage_limits) plan_usage_limits;

alter table public.automation_runs
  add column execution_id uuid,
  add column execution_fingerprint text,
  add column rule_id_snapshot uuid;

alter table public.automation_runs
  add constraint automation_runs_execution_identity_pair_check check (
    (
      execution_id is null
      and execution_fingerprint is null
      and rule_id_snapshot is null
    )
    or (
      execution_id is not null
      and execution_fingerprint is not null
      and rule_id_snapshot is not null
      and execution_fingerprint ~ '^[0-9a-f]{64}$'
    )
  );

create unique index automation_runs_tenant_rule_execution_unique_idx
on public.automation_runs (tenant_id, rule_id_snapshot, execution_id)
where execution_id is not null;

create function coachfort_internal.enforce_automation_run_execution_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if (new.execution_id is null) is distinct from
       (new.execution_fingerprint is null)
       or (new.execution_id is null) is distinct from
          (new.rule_id_snapshot is null) then
      raise exception 'Automation execution identity must be complete.'
        using errcode = '22023';
    end if;

    if new.execution_id is not null
       and (
         new.rule_id is null
         or new.rule_id is distinct from new.rule_id_snapshot
       ) then
      raise exception 'Automation rule snapshot must match the live rule.'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.execution_id is distinct from old.execution_id
     or new.execution_fingerprint is distinct from old.execution_fingerprint
     or new.tenant_id is distinct from old.tenant_id
     or new.rule_id_snapshot is distinct from old.rule_id_snapshot then
    raise exception 'Automation execution identity is immutable.'
      using errcode = '55000';
  end if;

  if new.rule_id is distinct from old.rule_id then
    if old.rule_id is null
       or new.rule_id is not null
       or exists (
         select 1
         from public.automation_rules rule
         where rule.id = old.rule_id
       ) then
      raise exception 'Automation run rule attachment is immutable.'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

create trigger automation_runs_execution_identity_immutable
before insert or update
on public.automation_runs
for each row execute function
  coachfort_internal.enforce_automation_run_execution_identity();

create function coachfort_internal.run_automation_trigger_metered(
  p_tenant_id uuid,
  p_trigger_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata_json jsonb,
  p_execution_id uuid
)
returns table (
  executed_count integer,
  skipped_count integer,
  failed_count integer,
  quota_denied_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_rule record;
  v_action record;
  v_condition record;
  v_existing public.automation_runs%rowtype;
  v_run_id uuid;
  v_context jsonb;
  v_actual jsonb;
  v_expected jsonb;
  v_key text;
  v_condition_passed boolean;
  v_conditions_passed boolean;
  v_fingerprint text;
  v_action_title text;
  v_action_message text;
  v_due_at timestamptz;
  v_target_user uuid;
  v_inserted integer;
begin
  executed_count := 0;
  skipped_count := 0;
  failed_count := 0;
  quota_denied_count := 0;

  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_execution_id is null then
    raise exception 'Automation execution id is required.' using errcode = '22023';
  end if;
  if not public.is_tenant_member(p_tenant_id, v_actor) then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  v_context := jsonb_build_object(
    'entityId', p_entity_id,
    'entityType', p_entity_type,
    'metadata', coalesce(p_metadata_json, '{}'::jsonb),
    'triggerSource', p_trigger_type
  );

  for v_rule in
    select *
    from public.automation_rules rule
    where rule.tenant_id = p_tenant_id
      and rule.trigger_type = p_trigger_type
      and rule.status = 'active'
    order by rule.created_at asc, rule.id asc
  loop
    v_fingerprint := encode(extensions.digest(convert_to(
      jsonb_build_object(
        'actorId', v_actor,
        'entityId', p_entity_id,
        'entityType', p_entity_type,
        'metadata', coalesce(p_metadata_json, '{}'::jsonb),
        'ruleId', v_rule.id,
        'tenantId', p_tenant_id,
        'triggerType', p_trigger_type
      )::text,
      'UTF8'
    ), 'sha256'), 'hex');

    perform pg_advisory_xact_lock(hashtextextended(
      'automation_execution:' || p_tenant_id::text || ':'
        || v_rule.id::text || ':' || p_execution_id::text,
      8424
    ));

    select *
    into v_existing
    from public.automation_runs run
    where run.tenant_id = p_tenant_id
      and run.rule_id_snapshot = v_rule.id
      and run.execution_id = p_execution_id;

    if found then
      if v_existing.execution_fingerprint is distinct from v_fingerprint then
        raise exception 'Automation execution id conflicts with prior execution.'
          using errcode = '22023';
      end if;

      if v_existing.status = 'success' then
        executed_count := executed_count + 1;
      elsif v_existing.status = 'failed' then
        failed_count := failed_count + 1;
      else
        skipped_count := skipped_count + 1;
      end if;
      continue;
    end if;

    -- Preserve the existing debounce for distinct logical executions.
    if p_entity_id is not null and p_entity_type is not null and exists (
      select 1
      from public.automation_runs run
      where run.tenant_id = p_tenant_id
        and run.rule_id = v_rule.id
        and run.trigger_source = p_trigger_type
        and run.entity_type = p_entity_type
        and run.entity_id = p_entity_id
        and run.status in ('queued', 'success', 'failed')
        and run.started_at >= statement_timestamp() - interval '5 minutes'
    ) then
      insert into public.automation_runs (
        tenant_id, rule_id, trigger_source, entity_type, entity_id, status,
        completed_at, created_by, metadata_json, execution_id,
        execution_fingerprint, rule_id_snapshot
      ) values (
        p_tenant_id, v_rule.id, p_trigger_type, p_entity_type, p_entity_id,
        'skipped', statement_timestamp(), v_actor,
        coalesce(p_metadata_json, '{}'::jsonb), p_execution_id, v_fingerprint,
        v_rule.id
      ) returning id into v_run_id;

      insert into public.automation_run_logs (
        tenant_id, run_id, log_level, message, metadata_json
      ) values (
        p_tenant_id, v_run_id, 'warning',
        'Duplicate automation trigger skipped within the debounce window.',
        jsonb_build_object('debounceWindowMinutes', 5)
      );
      skipped_count := skipped_count + 1;
      continue;
    end if;

    begin
      v_conditions_passed := true;
      for v_condition in
        select *
        from public.automation_rule_conditions condition
        where condition.tenant_id = p_tenant_id
          and condition.rule_id = v_rule.id
        order by condition.sort_order asc, condition.id asc
      loop
        v_actual := v_context;
        foreach v_key in array string_to_array(
          coalesce(v_condition.value_json ->> 'field', 'entityType'), '.'
        ) loop
          if v_actual is null then
            exit;
          end if;
          v_actual := v_actual -> v_key;
        end loop;

        v_expected := v_condition.value_json -> 'value';
        v_condition_passed := case v_condition.condition_type
          when 'not_equals' then v_actual is distinct from v_expected
          when 'greater_than' then
            coalesce((v_actual #>> '{}')::numeric, 0) >
            coalesce((v_expected #>> '{}')::numeric, 0)
          when 'less_than' then
            coalesce((v_actual #>> '{}')::numeric, 0) <
            coalesce((v_expected #>> '{}')::numeric, 0)
          when 'contains' then
            lower(coalesce(v_actual #>> '{}', '')) like
            '%' || lower(coalesce(v_expected #>> '{}', '')) || '%'
          when 'date_before' then
            (v_actual #>> '{}')::timestamptz <
            (v_expected #>> '{}')::timestamptz
          when 'date_after' then
            (v_actual #>> '{}')::timestamptz >
            (v_expected #>> '{}')::timestamptz
          else v_actual = v_expected
        end;

        if not coalesce(v_condition_passed, false) then
          v_conditions_passed := false;
          exit;
        end if;
      end loop;
    exception when others then
      failed_count := failed_count + 1;
      continue;
    end;

    if not v_conditions_passed then
      insert into public.automation_runs (
        tenant_id, rule_id, trigger_source, entity_type, entity_id, status,
        completed_at, created_by, metadata_json, execution_id,
        execution_fingerprint, rule_id_snapshot
      ) values (
        p_tenant_id, v_rule.id, p_trigger_type, p_entity_type, p_entity_id,
        'skipped', statement_timestamp(), v_actor,
        coalesce(p_metadata_json, '{}'::jsonb), p_execution_id, v_fingerprint,
        v_rule.id
      ) returning id into v_run_id;

      insert into public.automation_run_logs (
        tenant_id, run_id, log_level, message, metadata_json
      ) values (
        p_tenant_id, v_run_id, 'warning',
        'Automation conditions did not match.', '{}'::jsonb
      );
      skipped_count := skipped_count + 1;
      continue;
    end if;

    begin
      perform coachfort_internal.consume_monthly_usage(
        p_tenant_id,
        'automation_runs_monthly',
        'automation:' || p_execution_id::text || ':' || v_rule.id::text,
        1
      );
    exception when sqlstate '22023' then
      if sqlerrm = 'Monthly usage limit reached.' then
        skipped_count := skipped_count + 1;
        quota_denied_count := quota_denied_count + 1;
        continue;
      end if;
      raise;
    end;

    insert into public.automation_runs (
      tenant_id, rule_id, trigger_source, entity_type, entity_id, status,
      created_by, metadata_json, execution_id, execution_fingerprint,
      rule_id_snapshot
    ) values (
      p_tenant_id, v_rule.id, p_trigger_type, p_entity_type, p_entity_id,
      'queued', v_actor, coalesce(p_metadata_json, '{}'::jsonb),
      p_execution_id, v_fingerprint, v_rule.id
    ) returning id into v_run_id;

    begin
      for v_action in
        select *
        from public.automation_rule_actions action
        where action.tenant_id = p_tenant_id
          and action.rule_id = v_rule.id
        order by action.sort_order asc, action.id asc
      loop
        v_action_title := coalesce(
          v_action.config_json ->> 'title', v_rule.name || ' automation'
        );
        v_action_message := coalesce(
          v_action.config_json ->> 'message',
          'Automation placeholder executed inside CoachFort.'
        );

        if v_action.action_type = 'create_notification' then
          v_inserted := 0;
          v_target_user := case
            when coalesce(v_action.config_json ->> 'user_id', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (v_action.config_json ->> 'user_id')::uuid
            else null
          end;

          if v_target_user is not null and exists (
            select 1 from public.tenant_members member
            where member.tenant_id = p_tenant_id
              and member.user_id = v_target_user
          ) then
            insert into public.notifications (
              tenant_id, user_id, type, title, message, entity_type,
              entity_id, severity, status, action_url, metadata_json
            ) values (
              p_tenant_id, v_target_user, 'system_notice', v_action_title,
              v_action_message, coalesce(p_entity_type, 'automation'),
              p_entity_id, 'info', 'unread', '/app/automations',
              jsonb_build_object(
                'automationActionId', v_action.id,
                'automationRuleId', v_rule.id,
                'triggerType', p_trigger_type
              )
            );
            v_inserted := 1;
          else
            insert into public.notifications (
              tenant_id, user_id, type, title, message, entity_type,
              entity_id, severity, status, action_url, metadata_json
            )
            select
              p_tenant_id, member.user_id, 'system_notice', v_action_title,
              v_action_message, coalesce(p_entity_type, 'automation'),
              p_entity_id, 'info', 'unread', '/app/automations',
              jsonb_build_object(
                'automationActionId', v_action.id,
                'automationRuleId', v_rule.id,
                'triggerType', p_trigger_type
              )
            from public.tenant_members member
            where member.tenant_id = p_tenant_id
              and member.role in ('owner', 'admin');
            get diagnostics v_inserted = row_count;
          end if;

          insert into public.automation_run_logs (
            tenant_id, run_id, log_level, message, metadata_json
          ) values (
            p_tenant_id, v_run_id, 'info',
            case when v_inserted > 0 then 'Notification created.'
              else 'Notification output skipped because no target user was available.'
            end,
            jsonb_build_object(
              'actionId', v_action.id, 'actionType', v_action.action_type
            )
          );
        elsif v_action.action_type = 'create_reminder' then
          v_due_at := statement_timestamp() + (
            greatest(0, coalesce(
              (v_action.config_json ->> 'due_offset_days')::integer, 1
            )) || ' days'
          )::interval;

          insert into public.reminders (
            tenant_id, title, description, reminder_type, due_at, status
          ) values (
            p_tenant_id, v_action_title, v_action_message, 'general',
            v_due_at, 'pending'
          );

          insert into public.automation_run_logs (
            tenant_id, run_id, log_level, message, metadata_json
          ) values (
            p_tenant_id, v_run_id, 'info', 'Reminder created.',
            jsonb_build_object(
              'actionId', v_action.id, 'actionType', v_action.action_type
            )
          );
        elsif v_action.action_type in (
          'send_email_placeholder', 'send_whatsapp_placeholder'
        ) then
          insert into public.communication_logs (
            tenant_id, user_id, channel, type, status, target, subject,
            message, metadata_json
          ) values (
            p_tenant_id, v_actor,
            case when v_action.action_type = 'send_email_placeholder'
              then 'email' else 'whatsapp' end,
            'automation_placeholder', 'queued',
            v_action.config_json ->> 'target', v_action_title,
            v_action_message,
            jsonb_build_object(
              'automationActionId', v_action.id,
              'automationRuleId', v_rule.id,
              'entityId', p_entity_id,
              'entityType', p_entity_type,
              'triggerSource', p_trigger_type
            )
          );

          insert into public.automation_run_logs (
            tenant_id, run_id, log_level, message, metadata_json
          ) values (
            p_tenant_id, v_run_id, 'info',
            case when v_action.action_type = 'send_email_placeholder'
              then 'Email placeholder queued.'
              else 'WhatsApp placeholder queued.' end,
            jsonb_build_object(
              'actionId', v_action.id, 'actionType', v_action.action_type
            )
          );
        else
          insert into public.automation_run_logs (
            tenant_id, run_id, log_level, message, metadata_json
          ) values (
            p_tenant_id, v_run_id, 'info',
            case v_action.action_type
              when 'add_internal_note' then 'Internal note placeholder recorded.'
              when 'generate_task_placeholder' then
                'Task generation placeholder recorded.'
              else 'Automation action placeholder recorded.'
            end,
            jsonb_build_object(
              'actionId', v_action.id, 'actionType', v_action.action_type
            )
          );
        end if;
      end loop;

      update public.automation_runs run
      set status = 'success', completed_at = statement_timestamp()
      where run.id = v_run_id;

      insert into public.automation_run_logs (
        tenant_id, run_id, log_level, message, metadata_json
      ) values (
        p_tenant_id, v_run_id, 'info', 'Automation executed successfully.',
        jsonb_build_object('triggerType', p_trigger_type)
      );
      executed_count := executed_count + 1;
    exception when others then
      update public.automation_runs run
      set
        status = 'failed',
        completed_at = statement_timestamp(),
        error_message = left(sqlerrm, 500)
      where run.id = v_run_id;

      insert into public.automation_run_logs (
        tenant_id, run_id, log_level, message, metadata_json
      ) values (
        p_tenant_id, v_run_id, 'error', left(sqlerrm, 500),
        jsonb_build_object('sqlstate', sqlstate)
      );
      failed_count := failed_count + 1;
    end;
  end loop;

  return next;
end;
$$;

-- Metered compatibility bridge for the currently deployed five-argument app.
create or replace function public.run_automation_trigger_unvalidated(
  tenant_id uuid,
  trigger_type text,
  entity_type text,
  entity_id uuid default null,
  metadata_json jsonb default '{}'::jsonb
)
returns table (
  executed_count integer,
  skipped_count integer,
  failed_count integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    result.executed_count,
    result.skipped_count,
    result.failed_count
  from coachfort_internal.run_automation_trigger_metered(
    tenant_id,
    trigger_type,
    entity_type,
    entity_id,
    coalesce(metadata_json, '{}'::jsonb),
    gen_random_uuid()
  ) result
$$;

create or replace function public.run_automation_trigger(
  tenant_id uuid,
  trigger_type text,
  entity_type text,
  entity_id uuid default null,
  metadata_json jsonb default '{}'::jsonb
)
returns table (
  executed_count integer,
  skipped_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  executed_count := 0;
  skipped_count := 0;
  failed_count := 0;

  perform coachfort_internal.assert_tenant_operational_access(tenant_id);
  if not public.is_valid_automation_trigger(
    tenant_id,
    trigger_type,
    entity_type,
    entity_id,
    coalesce(metadata_json, '{}'::jsonb)
  ) then
    return next;
    return;
  end if;
  perform coachfort_internal.assert_effective_operational_feature(
    tenant_id,
    'automations'
  );

  begin
    return query
    select *
    from public.run_automation_trigger_unvalidated(
      tenant_id,
      trigger_type,
      entity_type,
      entity_id,
      coalesce(metadata_json, '{}'::jsonb)
    );
  exception when others then
    executed_count := 0;
    skipped_count := 0;
    failed_count := 0;
    return next;
  end;
end;
$$;

create function public.run_automation_trigger(
  tenant_id uuid,
  trigger_type text,
  entity_type text,
  entity_id uuid,
  metadata_json jsonb,
  p_execution_id uuid
)
returns table (
  executed_count integer,
  skipped_count integer,
  failed_count integer,
  quota_denied_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  executed_count := 0;
  skipped_count := 0;
  failed_count := 0;
  quota_denied_count := 0;

  if p_execution_id is null then
    raise exception 'Automation execution id is required.' using errcode = '22023';
  end if;

  perform coachfort_internal.assert_tenant_operational_access(tenant_id);
  if not public.is_valid_automation_trigger(
    tenant_id,
    trigger_type,
    entity_type,
    entity_id,
    coalesce(metadata_json, '{}'::jsonb)
  ) then
    return next;
    return;
  end if;
  perform coachfort_internal.assert_effective_operational_feature(
    tenant_id,
    'automations'
  );

  return query
  select *
  from coachfort_internal.run_automation_trigger_metered(
    tenant_id,
    trigger_type,
    entity_type,
    entity_id,
    coalesce(metadata_json, '{}'::jsonb),
    p_execution_id
  );
end;
$$;

alter function coachfort_internal.enforce_automation_run_execution_identity()
  owner to postgres;
alter function coachfort_internal.run_automation_trigger_metered(
  uuid,text,text,uuid,jsonb,uuid
) owner to postgres;
alter function public.run_automation_trigger_unvalidated(
  uuid,text,text,uuid,jsonb
) owner to postgres;
alter function public.run_automation_trigger(uuid,text,text,uuid,jsonb)
  owner to postgres;
alter function public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)
  owner to postgres;

revoke all on function
  coachfort_internal.enforce_automation_run_execution_identity()
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.run_automation_trigger_metered(
    uuid,text,text,uuid,jsonb,uuid
  ) from public, anon, authenticated, service_role;
revoke all on function public.run_automation_trigger_unvalidated(
  uuid,text,text,uuid,jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.run_automation_trigger(
  uuid,text,text,uuid,jsonb
) from public, anon, service_role;
revoke all on function public.run_automation_trigger(
  uuid,text,text,uuid,jsonb,uuid
) from public, anon, service_role;

grant execute on function public.run_automation_trigger(
  uuid,text,text,uuid,jsonb
) to authenticated;
grant execute on function public.run_automation_trigger(
  uuid,text,text,uuid,jsonb,uuid
) to authenticated;

do $$
declare
  v_old_source text;
  v_new_source text;
  v_internal_source text;
  v_identity_source text;
begin
  select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
  )), '[[:space:]]+', ' ', 'g')) into v_old_source;
  select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
  )), '[[:space:]]+', ' ', 'g')) into v_new_source;
  select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
  )), '[[:space:]]+', ' ', 'g')) into v_internal_source;
  select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'coachfort_internal.enforce_automation_run_execution_identity()'
  )), '[[:space:]]+', ' ', 'g')) into v_identity_source;

  if v_old_source not like
       '%assert_tenant_operational_access%assert_effective_operational_feature%run_automation_trigger_unvalidated%'
     or v_new_source not like
       '%assert_tenant_operational_access%assert_effective_operational_feature%run_automation_trigger_metered%'
     or position('assert_tenant_operational_access' in v_new_source) >=
        position('assert_effective_operational_feature' in v_new_source)
     or position('assert_effective_operational_feature' in v_new_source) >=
        position('run_automation_trigger_metered' in v_new_source)
     or position('execution_id = p_execution_id' in v_internal_source) >=
        position('consume_monthly_usage' in v_internal_source)
     or position('consume_monthly_usage' in v_internal_source) >=
        position('''queued'', v_actor' in v_internal_source)
     or v_internal_source not like '%automation_runs_monthly%'
     or v_internal_source not like '%order by rule.created_at asc, rule.id asc%'
     or v_internal_source not like
        '%quota_denied_count := quota_denied_count + 1%'
     or v_internal_source not like '%automation:%p_execution_id%v_rule.id%'
     or v_internal_source not like '%run.rule_id_snapshot = v_rule.id%'
     or v_identity_source not like
        '%new.rule_id_snapshot is distinct from old.rule_id_snapshot%'
     or v_identity_source not like
        '%old.rule_id is null%new.rule_id is not null%exists%automation_rules%old.rule_id%'
     or v_identity_source not like
        '%new.rule_id is distinct from new.rule_id_snapshot%' then
    raise exception 'Automation lifecycle, idempotency, meter, or fan-out ordering failed.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.automation_runs'::regclass
      and constraint_row.conname =
        'automation_runs_execution_identity_pair_check'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and replace(regexp_replace(
        lower(pg_get_constraintdef(constraint_row.oid)),
        '[[:space:]()]', '', 'g'
      ), '::text', '') =
        'checkexecution_idisnullandexecution_fingerprintisnulland'
        || 'rule_id_snapshotisnullor'
        || 'execution_idisnotnullandexecution_fingerprintisnotnulland'
        || 'rule_id_snapshotisnotnulland'
        || 'execution_fingerprint~''^[0-9a-f]{64}$'''
  ) then
    raise exception 'Automation execution identity pair constraint is invalid.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_class on index_class.oid = index_row.indexrelid
    where index_row.indrelid = 'public.automation_runs'::regclass
      and index_class.relname =
        'automation_runs_tenant_rule_execution_unique_idx'
      and index_row.indisunique
      and lower(pg_get_indexdef(index_row.indexrelid)) like
        '%(tenant_id, rule_id_snapshot, execution_id)%'
      and regexp_replace(lower(pg_get_expr(
        index_row.indpred, index_row.indrelid
      )), '[[:space:]()]', '', 'g') = 'execution_idisnotnull'
  ) then
    raise exception 'Automation execution identity index is invalid.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_constraint constraint_row
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = any(constraint_row.conkey)
    where constraint_row.conrelid = 'public.automation_runs'::regclass
      and constraint_row.contype = 'f'
      and attribute.attname = 'rule_id_snapshot'
  ) then
    raise exception 'Automation rule snapshot must not be a foreign key.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid =
           'public.automation_rule_conditions'::regclass
         and constraint_row.conname =
           'automation_rule_conditions_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'c'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_rule_actions'::regclass
         and constraint_row.conname = 'automation_rule_actions_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'c'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_runs'::regclass
         and constraint_row.conname = 'automation_runs_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'n'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_run_logs'::regclass
         and constraint_row.conname = 'automation_run_logs_run_id_fkey'
         and constraint_row.confrelid = 'public.automation_runs'::regclass
         and constraint_row.confdeltype = 'c'
     ) then
    raise exception 'Automation delete/history FK authority has drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'automation_rules', 'automation_rule_conditions',
        'automation_rule_actions', 'automation_runs', 'automation_run_logs'
      )
      and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Automation browser table writes were reopened.'
      using errcode = '55000';
  end if;

  if has_function_privilege(
       'authenticated',
       'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'coachfort_internal.enforce_automation_run_execution_identity()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'coachfort_internal.enforce_automation_run_execution_identity()',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'coachfort_internal.enforce_automation_run_execution_identity()',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = to_regprocedure(
         'coachfort_internal.enforce_automation_run_execution_identity()'
       )
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Private Automation meter authority is exposed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from ux8g4a2d1_apply_baseline baseline
    where baseline.automation_rules <>
          (select count(*) from public.automation_rules)
       or baseline.automation_conditions <>
          (select count(*) from public.automation_rule_conditions)
       or baseline.automation_actions <>
          (select count(*) from public.automation_rule_actions)
       or baseline.automation_runs <>
          (select count(*) from public.automation_runs)
       or baseline.automation_run_logs <>
          (select count(*) from public.automation_run_logs)
       or baseline.monthly_usage_counters <>
          (select count(*) from coachfort_internal.monthly_usage_counters)
       or baseline.monthly_usage_events <>
          (select count(*) from coachfort_internal.monthly_usage_consumption_events)
       or baseline.subscription_assignments <>
          (select count(*) from public.tenant_subscription_assignments)
       or baseline.plan_usage_limits <>
          (select count(*) from public.subscription_plan_usage_limits)
  ) then
    raise exception 'UX-8G4A2D1 changed protected business or meter rows.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with identities as (
  select
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
    ) old_runner,
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
    ) request_runner,
    to_regprocedure(
      'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
    ) legacy_bridge,
    to_regprocedure(
      'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
    ) metered_runner,
    to_regprocedure(
      'coachfort_internal.enforce_automation_run_execution_identity()'
    ) identity_trigger,
    to_regprocedure(
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    ) monthly_consumer,
    to_regprocedure(
      'public.delete_automation_rule_secure(uuid,uuid)'
    ) delete_rule
), sources as (
  select
    lower(regexp_replace(
      pg_get_functiondef(identities.old_runner), '[[:space:]]+', ' ', 'g'
    )) old_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.request_runner), '[[:space:]]+', ' ', 'g'
    )) request_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.legacy_bridge), '[[:space:]]+', ' ', 'g'
    )) bridge_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.metered_runner), '[[:space:]]+', ' ', 'g'
    )) metered_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.identity_trigger),
      '[[:space:]]+', ' ', 'g'
    )) identity_trigger_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.delete_rule), '[[:space:]]+', ' ', 'g'
    )) delete_source
  from identities
), rpc_state as (
  select
    count(*) total_overloads,
    count(*) filter (where procedure.oid = identities.old_runner) old_overloads,
    count(*) filter (
      where procedure.oid = identities.request_runner
    ) request_overloads,
    count(*) filter (
      where has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    ) authenticated_execute,
    count(*) filter (
      where has_function_privilege('anon', procedure.oid, 'EXECUTE')
    ) anon_execute,
    count(*) filter (
      where has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ) service_execute,
    count(*) filter (
      where exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    ) public_execute
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join identities
  where namespace.nspname = 'public'
    and procedure.proname = 'run_automation_trigger'
), schema_state as (
  select
    (
      select count(*)
      from information_schema.columns column_def
      where column_def.table_schema = 'public'
        and column_def.table_name = 'automation_runs'
        and column_def.column_name in (
          'execution_id', 'execution_fingerprint', 'rule_id_snapshot'
        )
    ) execution_columns,
    exists (
      select 1
      from information_schema.columns column_def
      where column_def.table_schema = 'public'
        and column_def.table_name = 'automation_runs'
        and column_def.column_name = 'rule_id_snapshot'
        and column_def.is_nullable = 'YES'
    ) snapshot_nullable,
    not exists (
      select 1
      from pg_constraint constraint_row
      join pg_attribute attribute
        on attribute.attrelid = constraint_row.conrelid
       and attribute.attnum = any(constraint_row.conkey)
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.contype = 'f'
        and attribute.attname = 'rule_id_snapshot'
    ) snapshot_not_foreign_key,
    exists (
      select 1
      from pg_index index_row
      join pg_class index_class on index_class.oid = index_row.indexrelid
      where index_row.indrelid = 'public.automation_runs'::regclass
        and index_class.relname =
          'automation_runs_tenant_rule_execution_unique_idx'
        and index_row.indisunique
        and lower(pg_get_indexdef(index_row.indexrelid)) like
          '%(tenant_id, rule_id_snapshot, execution_id)%'
        and regexp_replace(lower(pg_get_expr(
          index_row.indpred, index_row.indrelid
        )), '[[:space:]()]', '', 'g') = 'execution_idisnotnull'
    ) exact_unique_index,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname =
          'automation_runs_execution_identity_pair_check'
        and constraint_row.contype = 'c'
        and constraint_row.convalidated
        and replace(regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]()]', '', 'g'
        ), '::text', '') =
          'checkexecution_idisnullandexecution_fingerprintisnulland'
          || 'rule_id_snapshotisnullor'
          || 'execution_idisnotnullandexecution_fingerprintisnotnulland'
          || 'rule_id_snapshotisnotnulland'
          || 'execution_fingerprint~''^[0-9a-f]{64}$'''
    ) exact_identity_pair_constraint,
    exists (
      select 1
      from pg_trigger trigger
      where trigger.tgrelid = 'public.automation_runs'::regclass
        and trigger.tgname = 'automation_runs_execution_identity_immutable'
        and not trigger.tgisinternal
        and trigger.tgfoid = identities.identity_trigger
        and lower(pg_get_triggerdef(trigger.oid)) like
          '%before insert or update%'
    ) identity_trigger_bound
  from identities
), delete_contract as (
  select
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.automation_rule_conditions'::regclass
        and constraint_row.conname =
          'automation_rule_conditions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) condition_rule_cascade,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_rule_actions'::regclass
        and constraint_row.conname = 'automation_rule_actions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) action_rule_cascade,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname = 'automation_runs_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'n'
    ) run_rule_set_null,
    exists (
      select 1
      from pg_constraint constraint_row
      join pg_trigger trigger
        on trigger.tgconstraint = constraint_row.oid
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname = 'automation_runs_rule_id_fkey'
        and trigger.tgrelid = 'public.automation_rules'::regclass
        and lower(pg_get_triggerdef(trigger.oid)) like
          '%after delete%ri_fkey_setnull_del%'
    ) fk_detach_after_parent_delete,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_run_logs'::regclass
        and constraint_row.conname = 'automation_run_logs_run_id_fkey'
        and constraint_row.confrelid = 'public.automation_runs'::regclass
        and constraint_row.confdeltype = 'c'
    ) run_log_cascade,
    sources.delete_source like '%delete from public.automation_rules%'
      and sources.delete_source not like '%delete from public.automation_runs%'
      and sources.delete_source not like
        '%delete from public.automation_run_logs%'
      delete_preserves_history,
    sources.identity_trigger_source like
      '%new.rule_id_snapshot is distinct from old.rule_id_snapshot%'
      and sources.identity_trigger_source like
        '%old.rule_id is null%new.rule_id is not null%exists%automation_rules%old.rule_id%'
      and sources.identity_trigger_source like
        '%new.rule_id is distinct from new.rule_id_snapshot%'
      detach_guarded_by_parent_absence
  from sources
), browser_writes as (
  select count(*) write_grants
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in (
      'automation_rules', 'automation_rule_conditions',
      'automation_rule_actions', 'automation_runs', 'automation_run_logs'
    )
    and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), private_acl as (
  select
    not has_function_privilege(
      'anon', identities.identity_trigger, 'EXECUTE'
    ) and not exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = identities.identity_trigger
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) and
    not has_function_privilege(
      'authenticated', identities.identity_trigger, 'EXECUTE'
    ) and not has_function_privilege(
      'service_role', identities.identity_trigger, 'EXECUTE'
    ) identity_trigger_private,
    not has_function_privilege(
      'anon', identities.metered_runner, 'EXECUTE'
    ) and not exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = identities.metered_runner
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) and
    not has_function_privilege(
      'authenticated', identities.metered_runner, 'EXECUTE'
    ) and not has_function_privilege(
      'service_role', identities.metered_runner, 'EXECUTE'
    ) metered_runner_private,
    not has_function_privilege(
      'anon', identities.legacy_bridge, 'EXECUTE'
    ) and not exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = identities.legacy_bridge
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) and
    not has_function_privilege(
      'authenticated', identities.legacy_bridge, 'EXECUTE'
    ) and not has_function_privilege(
      'service_role', identities.legacy_bridge, 'EXECUTE'
    ) legacy_bridge_private,
    not has_function_privilege(
      'anon', identities.monthly_consumer, 'EXECUTE'
    ) and not exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = identities.monthly_consumer
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) and
    not has_function_privilege(
      'authenticated', identities.monthly_consumer, 'EXECUTE'
    ) and not has_function_privilege(
      'service_role', identities.monthly_consumer, 'EXECUTE'
    ) monthly_consumer_private
  from identities
), authority_state as (
  select
    count(*) installed_count,
    bool_and(owner_role.rolname = 'postgres') postgres_owned,
    bool_and(procedure.prosecdef) security_definer,
    bool_and(
      procedure.proconfig @> array['search_path=public, pg_temp']
    ) fixed_search_path
  from (values
    ('coachfort_internal.enforce_automation_run_execution_identity()'),
    ('coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'),
    ('public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'),
    ('public.run_automation_trigger(uuid,text,text,uuid,jsonb)'),
    ('public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  join pg_roles owner_role on owner_role.oid = procedure.proowner
), protected_rows as (
  select jsonb_build_object(
    'automation_rules', (select count(*) from public.automation_rules),
    'automation_conditions',
      (select count(*) from public.automation_rule_conditions),
    'automation_actions',
      (select count(*) from public.automation_rule_actions),
    'automation_runs', (select count(*) from public.automation_runs),
    'automation_run_logs', (select count(*) from public.automation_run_logs),
    'monthly_usage_counters',
      (select count(*) from coachfort_internal.monthly_usage_counters),
    'monthly_usage_events',
      (select count(*) from coachfort_internal.monthly_usage_consumption_events),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits)
  ) counts
)
select
  jsonb_build_object(
    'rpc', to_jsonb(rpc_state),
    'schema', to_jsonb(schema_state),
    'delete_contract', to_jsonb(delete_contract),
    'browser_write_grants', browser_writes.write_grants,
    'private_acl', to_jsonb(private_acl),
    'authority', to_jsonb(authority_state),
    'protected_rows', protected_rows.counts,
    'rollout_bridge_pending', true
  ) verification,
  identities.old_runner is not null
    and identities.request_runner is not null
    and identities.legacy_bridge is not null
    and identities.metered_runner is not null
    and identities.identity_trigger is not null
    and identities.monthly_consumer is not null
    and identities.delete_rule is not null
    and rpc_state.total_overloads = 2
    and rpc_state.old_overloads = 1
    and rpc_state.request_overloads = 1
    and rpc_state.authenticated_execute = 2
    and rpc_state.anon_execute = 0
    and rpc_state.service_execute = 0
    and rpc_state.public_execute = 0
    and schema_state.execution_columns = 3
    and schema_state.snapshot_nullable
    and schema_state.snapshot_not_foreign_key
    and schema_state.exact_unique_index
    and schema_state.exact_identity_pair_constraint
    and schema_state.identity_trigger_bound
    and delete_contract.condition_rule_cascade
    and delete_contract.action_rule_cascade
    and delete_contract.run_rule_set_null
    and delete_contract.fk_detach_after_parent_delete
    and delete_contract.run_log_cascade
    and delete_contract.delete_preserves_history
    and delete_contract.detach_guarded_by_parent_absence
    and sources.old_source like
      '%assert_tenant_operational_access%assert_effective_operational_feature%run_automation_trigger_unvalidated%'
    and sources.request_source like
      '%assert_tenant_operational_access%assert_effective_operational_feature%run_automation_trigger_metered%'
    and sources.bridge_source like '%run_automation_trigger_metered%gen_random_uuid%'
    and position('execution_id = p_execution_id' in sources.metered_source) <
        position('consume_monthly_usage' in sources.metered_source)
    and position('consume_monthly_usage' in sources.metered_source) <
        position('''queued'', v_actor' in sources.metered_source)
    and sources.metered_source like '%automation_runs_monthly%'
    and sources.metered_source like '%order by rule.created_at asc, rule.id asc%'
    and sources.metered_source like
      '%quota_denied_count := quota_denied_count + 1%'
    and sources.metered_source not like '%ai_requests_monthly%'
    and sources.metered_source not like '%messages_monthly%'
    and browser_writes.write_grants = 0
    and private_acl.identity_trigger_private
    and private_acl.metered_runner_private
    and private_acl.legacy_bridge_private
    and private_acl.monthly_consumer_private
    and authority_state.installed_count = 5
    and authority_state.postgres_owned
    and authority_state.security_definer
    and authority_state.fixed_search_path
    as security_gate
from identities
cross join sources
cross join rpc_state
cross join schema_state
cross join delete_contract
cross join browser_writes
cross join private_acl
cross join authority_state
cross join protected_rows;
*/
