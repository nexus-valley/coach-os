-- Bundle UX-8G4A2D2: retire the Automation RPC without caller execution IDs.
-- Review before execution. This file has not been executed by Codex.

/* PRE-APPLY READ-ONLY VERIFICATION
with identities as (
  select
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
    ) legacy_runner,
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
    ) request_runner,
    to_regprocedure(
      'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
    ) unvalidated_runner,
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
      'public.is_valid_automation_trigger(uuid,text,text,uuid,jsonb)'
    ) trigger_validator,
    to_regprocedure(
      'coachfort_internal.assert_tenant_operational_access(uuid)'
    ) lifecycle_assertion,
    to_regprocedure(
      'coachfort_internal.assert_effective_operational_feature(uuid,text)'
    ) feature_assertion,
    to_regprocedure(
      'public.delete_automation_rule_secure(uuid,uuid)'
    ) delete_rule
), sources as (
  select
    lower(regexp_replace(
      pg_get_functiondef(identities.legacy_runner),
      '[[:space:]]+', ' ', 'g'
    )) legacy_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.request_runner),
      '[[:space:]]+', ' ', 'g'
    )) request_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.unvalidated_runner),
      '[[:space:]]+', ' ', 'g'
    )) unvalidated_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.metered_runner),
      '[[:space:]]+', ' ', 'g'
    )) metered_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.identity_trigger),
      '[[:space:]]+', ' ', 'g'
    )) identity_trigger_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.monthly_consumer),
      '[[:space:]]+', ' ', 'g'
    )) monthly_consumer_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.delete_rule),
      '[[:space:]]+', ' ', 'g'
    )) delete_source
  from identities
), rpc_inventory as (
  select
    count(*) total_overloads,
    count(*) filter (
      where procedure.oid = identities.legacy_runner
    ) legacy_overloads,
    count(*) filter (
      where procedure.oid = identities.request_runner
    ) request_overloads,
    coalesce(jsonb_agg(
      procedure.oid::regprocedure::text
      order by procedure.oid::regprocedure::text
    ), '[]'::jsonb) identities
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  cross join identities
  where namespace.nspname = 'public'
    and procedure.proname = 'run_automation_trigger'
), rpc_acl as (
  select
    expected.kind,
    procedure.oid,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_execute,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      service_execute,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) public_execute
  from (values
    (
      'legacy',
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
    ),
    (
      'request',
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
    )
  ) expected(kind, identity)
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), private_functions as (
  select
    expected.kind,
    expected.identity,
    procedure.oid,
    procedure.prosecdef,
    procedure.provolatile,
    pg_get_userbyid(procedure.proowner) owner_name,
    procedure.proconfig @> array['search_path=public, pg_temp']
      fixed_search_path,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_execute,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      service_execute,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) public_execute
  from (values
    (
      'unvalidated',
      'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
    ),
    (
      'metered',
      'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
    ),
    (
      'identity_trigger',
      'coachfort_internal.enforce_automation_run_execution_identity()'
    ),
    (
      'monthly_consumer',
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    )
  ) expected(kind, identity)
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), schema_state as (
  select
    (
      select count(*)
      from information_schema.columns column_def
      where column_def.table_schema = 'public'
        and column_def.table_name = 'automation_runs'
        and (
          (column_def.column_name = 'execution_id'
            and column_def.data_type = 'uuid')
          or (column_def.column_name = 'execution_fingerprint'
            and column_def.data_type = 'text')
          or (column_def.column_name = 'rule_id_snapshot'
            and column_def.data_type = 'uuid')
        )
    ) execution_columns,
    exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
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
    ) exact_identity_constraint,
    exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class
        on index_class.oid = index_row.indexrelid
      where index_row.indrelid = 'public.automation_runs'::regclass
        and index_class.relname =
          'automation_runs_tenant_rule_execution_unique_idx'
        and index_row.indisunique
        and lower(pg_get_indexdef(index_row.indexrelid)) like
          '%(tenant_id, rule_id_snapshot, execution_id)%'
        and regexp_replace(lower(pg_get_expr(
          index_row.indpred, index_row.indrelid
        )), '[[:space:]()]', '', 'g') = 'execution_idisnotnull'
    ) exact_execution_index,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger
      where trigger.tgrelid = 'public.automation_runs'::regclass
        and trigger.tgname =
          'automation_runs_execution_identity_immutable'
        and trigger.tgfoid = identities.identity_trigger
        and lower(pg_get_triggerdef(trigger.oid)) like
          '%before insert or update%'
        and not trigger.tgisinternal
    ) identity_trigger_bound,
    not exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = constraint_row.conrelid
       and attribute.attnum = any(constraint_row.conkey)
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.contype = 'f'
        and attribute.attname = 'rule_id_snapshot'
    ) snapshot_not_foreign_key
  from identities
), delete_contract as (
  select
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.automation_rule_conditions'::regclass
        and constraint_row.conname =
          'automation_rule_conditions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) condition_rule_cascade,
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.automation_rule_actions'::regclass
        and constraint_row.conname = 'automation_rule_actions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) action_rule_cascade,
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname = 'automation_runs_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'n'
    ) run_rule_set_null,
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
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
      detach_guarded
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
), alternate_public_wrappers as (
  select procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  cross join identities
  where namespace.nspname = 'public'
    and procedure.oid not in (
      identities.legacy_runner,
      identities.request_runner,
      identities.unvalidated_runner
    )
    and lower(procedure.prosrc) like '%run_automation_trigger(%'
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
    'monthly_usage_consumption_events',
      (select count(*)
       from coachfort_internal.monthly_usage_consumption_events),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits)
  ) counts
), contracts as (
  select
    identities.legacy_runner is not null
      and identities.request_runner is not null
      and rpc_inventory.total_overloads = 2
      and rpc_inventory.legacy_overloads = 1
      and rpc_inventory.request_overloads = 1
      exact_bridge_inventory,
    sources.legacy_source like
      '%assert_tenant_operational_access%is_valid_automation_trigger%assert_effective_operational_feature%run_automation_trigger_unvalidated%'
      and coalesce((
        select procedure.prosecdef
          and pg_get_userbyid(procedure.proowner) = 'postgres'
          and procedure.proconfig @> array['search_path=public, pg_temp']
        from pg_catalog.pg_proc procedure
        where procedure.oid = identities.legacy_runner
      ), false)
      legacy_metered_bridge_contract,
    identities.request_runner is not null
      and coalesce((
        select procedure.prosecdef
          and procedure.pronargdefaults = 0
          and 'p_execution_id' = any(procedure.proargnames)
          and pg_get_userbyid(procedure.proowner) = 'postgres'
          and procedure.proconfig @> array['search_path=public, pg_temp']
        from pg_catalog.pg_proc procedure
        where procedure.oid = identities.request_runner
      ), false)
      and sources.request_source like '%p_execution_id is null%'
      and sources.request_source like
        '%assert_tenant_operational_access%is_valid_automation_trigger%assert_effective_operational_feature%run_automation_trigger_metered%'
      and sources.request_source not like '%gen_random_uuid()%'
      and position('assert_tenant_operational_access' in sources.request_source)
        < position('is_valid_automation_trigger' in sources.request_source)
       and position('is_valid_automation_trigger' in sources.request_source)
         < position(
           'assert_effective_operational_feature' in sources.request_source
         )
       and position(
         'assert_effective_operational_feature' in sources.request_source
       ) < position('run_automation_trigger_metered' in sources.request_source)
      request_aware_runner_contract,
    sources.unvalidated_source like '%run_automation_trigger_metered%'
      and sources.unvalidated_source like '%gen_random_uuid()%'
      unvalidated_bridge_contract,
    sources.metered_source like '%execution_id = p_execution_id%'
      and sources.metered_source like '%automation_runs_monthly%'
      and sources.metered_source like
        '%order by rule.created_at asc, rule.id asc%'
      and position('execution_id = p_execution_id' in sources.metered_source)
        < position('consume_monthly_usage' in sources.metered_source)
      metered_runner_contract,
    sources.monthly_consumer_source like '%resolve_monthly_usage_limit%'
      and sources.monthly_consumer_source like '%monthly_usage_counters%'
      and sources.monthly_consumer_source like
        '%monthly_usage_consumption_events%'
      monthly_meter_contract,
    schema_state.execution_columns = 3
      and schema_state.exact_identity_constraint
      and schema_state.exact_execution_index
      and schema_state.identity_trigger_bound
      and schema_state.snapshot_not_foreign_key
      execution_identity_contract,
    delete_contract.condition_rule_cascade
      and delete_contract.action_rule_cascade
      and delete_contract.run_rule_set_null
      and delete_contract.run_log_cascade
      and delete_contract.delete_preserves_history
      and delete_contract.detach_guarded
      delete_history_contract,
    (
      select count(*) = 2 and bool_and(
        authenticated_execute
        and not anon_execute
        and not service_execute
        and not public_execute
      )
      from rpc_acl
    ) exact_bridge_acl,
    (
      select count(*) = 4 and bool_and(
        oid is not null
        and prosecdef
        and owner_name = 'postgres'
        and fixed_search_path
        and not authenticated_execute
        and not anon_execute
        and not service_execute
        and not public_execute
      )
      from private_functions
    ) private_authority_contract,
    browser_writes.write_grants = 0 browser_write_contract,
    not exists (select 1 from alternate_public_wrappers)
      no_alternate_public_wrapper,
    not (
      rpc_inventory.total_overloads = 2
      and rpc_inventory.legacy_overloads = 1
      and rpc_inventory.request_overloads = 1
    ) partial_a2d2_installation
  from identities
  cross join sources
  cross join rpc_inventory
  cross join schema_state
  cross join delete_contract
  cross join browser_writes
)
select
  contracts.*,
  rpc_inventory.identities current_rpc_inventory,
  protected_rows.counts protected_counts,
  (
    contracts.exact_bridge_inventory
    and contracts.legacy_metered_bridge_contract
    and contracts.request_aware_runner_contract
    and contracts.unvalidated_bridge_contract
    and contracts.metered_runner_contract
    and contracts.monthly_meter_contract
    and contracts.execution_identity_contract
    and contracts.delete_history_contract
    and contracts.exact_bridge_acl
    and contracts.private_authority_contract
    and contracts.browser_write_contract
    and contracts.no_alternate_public_wrapper
    and not contracts.partial_a2d2_installation
    and identities.trigger_validator is not null
    and identities.lifecycle_assertion is not null
    and identities.feature_assertion is not null
    and identities.delete_rule is not null
  ) ready_for_apply
from contracts
cross join identities
cross join rpc_inventory
cross join protected_rows;
*/

begin;

do $$
declare
  v_identity text;
  v_oid regprocedure;
  v_source text;
  v_metered_source text;
  v_monthly_source text;
  v_identity_source text;
  v_delete_source text;
  v_private_identities constant text[] := array[
    'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)',
    'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)',
    'coachfort_internal.enforce_automation_run_execution_identity()',
    'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
  ];
begin
  if to_regprocedure(
       'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
     ) is null
     or to_regprocedure(
       'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.enforce_automation_run_execution_identity()'
     ) is null
     or to_regprocedure(
       'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
     ) is null
     or to_regprocedure(
       'public.is_valid_automation_trigger(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.assert_tenant_operational_access(uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.assert_effective_operational_feature(uuid,text)'
     ) is null
     or to_regprocedure(
       'public.delete_automation_rule_secure(uuid,uuid)'
     ) is null then
    raise exception 'The complete UX-8G4A2D1 authority is required.'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'run_automation_trigger'
  ) <> 2 then
    raise exception 'The exact two-overload A2D1 bridge is required.'
      using errcode = '55000';
  end if;

  foreach v_identity in array array[
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb)',
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
  ] loop
    v_oid := to_regprocedure(v_identity);
    if not has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('service_role', v_oid, 'EXECUTE')
       or exists (
         select 1
         from pg_catalog.pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) acl
         where procedure.oid = v_oid
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       ) then
      raise exception 'Automation RPC ACL drifted: %', v_identity
        using errcode = '55000';
    end if;
  end loop;

  foreach v_identity in array v_private_identities loop
    v_oid := to_regprocedure(v_identity);
    if v_oid is null
       or not coalesce((
         select procedure.prosecdef
           and pg_get_userbyid(procedure.proowner) = 'postgres'
           and procedure.proconfig @> array['search_path=public, pg_temp']
         from pg_catalog.pg_proc procedure
         where procedure.oid = v_oid
       ), false)
       or has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('service_role', v_oid, 'EXECUTE')
       or exists (
         select 1
         from pg_catalog.pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) acl
         where procedure.oid = v_oid
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       ) then
      raise exception 'Private Automation authority drifted: %', v_identity
        using errcode = '55000';
    end if;
  end loop;

  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_source;
  if not coalesce((
       select procedure.prosecdef
         and procedure.pronargdefaults = 0
         and 'p_execution_id' = any(procedure.proargnames)
         and pg_get_userbyid(procedure.proowner) = 'postgres'
         and procedure.proconfig @> array['search_path=public, pg_temp']
       from pg_catalog.pg_proc procedure
       where procedure.oid = to_regprocedure(
         'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
       )
     ), false)
     or v_source not like '%p_execution_id is null%'
     or v_source like '%gen_random_uuid()%'
     or position('assert_tenant_operational_access' in v_source) = 0
     or position('is_valid_automation_trigger' in v_source) <=
        position('assert_tenant_operational_access' in v_source)
     or position('assert_effective_operational_feature' in v_source) <=
        position('is_valid_automation_trigger' in v_source)
     or position('run_automation_trigger_metered' in v_source) <=
        position('assert_effective_operational_feature' in v_source) then
    raise exception 'Request-aware Automation RPC body drifted.'
      using errcode = '55000';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_source;
  if v_source not like '%run_automation_trigger_metered%'
     or v_source not like '%gen_random_uuid()%' then
    raise exception 'The metered A2D1 compatibility adapter drifted.'
      using errcode = '55000';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_metered_source;
  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_monthly_source;
  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_automation_run_execution_identity()'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_identity_source;
  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'public.delete_automation_rule_secure(uuid,uuid)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_delete_source;

  if v_metered_source not like '%execution_id = p_execution_id%'
     or v_metered_source not like '%automation_runs_monthly%'
     or v_metered_source not like
       '%order by rule.created_at asc, rule.id asc%'
     or position('execution_id = p_execution_id' in v_metered_source) >=
        position('consume_monthly_usage' in v_metered_source)
     or v_monthly_source not like '%resolve_monthly_usage_limit%'
     or v_monthly_source not like '%monthly_usage_counters%'
     or v_monthly_source not like '%monthly_usage_consumption_events%'
     or v_identity_source not like
       '%new.rule_id_snapshot is distinct from old.rule_id_snapshot%'
     or v_identity_source not like
       '%old.rule_id is null%new.rule_id is not null%exists%automation_rules%old.rule_id%'
     or v_identity_source not like
       '%new.rule_id is distinct from new.rule_id_snapshot%'
     or v_delete_source not like '%delete from public.automation_rules%'
     or v_delete_source like '%delete from public.automation_runs%'
     or v_delete_source like '%delete from public.automation_run_logs%' then
    raise exception 'A2D1 metering or delete-history authority drifted.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'automation_runs'
         and column_name = 'execution_id'
         and data_type = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'automation_runs'
         and column_name = 'execution_fingerprint'
         and data_type = 'text'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'automation_runs'
         and column_name = 'rule_id_snapshot'
         and data_type = 'uuid'
     )
     or to_regclass(
       'public.automation_runs_tenant_rule_execution_unique_idx'
     ) is null
     or not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
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
     )
     or not exists (
       select 1
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class index_class
         on index_class.oid = index_row.indexrelid
       where index_row.indrelid = 'public.automation_runs'::regclass
         and index_class.relname =
           'automation_runs_tenant_rule_execution_unique_idx'
         and index_row.indisunique
         and lower(pg_get_indexdef(index_row.indexrelid)) like
           '%(tenant_id, rule_id_snapshot, execution_id)%'
         and regexp_replace(lower(pg_get_expr(
           index_row.indpred, index_row.indrelid
         )), '[[:space:]()]', '', 'g') = 'execution_idisnotnull'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger trigger
       where trigger.tgrelid = 'public.automation_runs'::regclass
         and trigger.tgname =
           'automation_runs_execution_identity_immutable'
         and trigger.tgfoid = to_regprocedure(
           'coachfort_internal.enforce_automation_run_execution_identity()'
         )
         and lower(pg_get_triggerdef(trigger.oid)) like
           '%before insert or update%'
         and not trigger.tgisinternal
     ) then
    raise exception 'A2D1 execution identity schema drifted.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
           'public.automation_rule_conditions'::regclass
         and constraint_row.conname =
           'automation_rule_conditions_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'c'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
           'public.automation_rule_actions'::regclass
         and constraint_row.conname = 'automation_rule_actions_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'c'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_runs'::regclass
         and constraint_row.conname = 'automation_runs_rule_id_fkey'
         and constraint_row.confrelid = 'public.automation_rules'::regclass
         and constraint_row.confdeltype = 'n'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_trigger trigger
         on trigger.tgconstraint = constraint_row.oid
       where constraint_row.conrelid = 'public.automation_runs'::regclass
         and constraint_row.conname = 'automation_runs_rule_id_fkey'
         and trigger.tgrelid = 'public.automation_rules'::regclass
         and lower(pg_get_triggerdef(trigger.oid)) like
           '%after delete%ri_fkey_setnull_del%'
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = 'public.automation_run_logs'::regclass
         and constraint_row.conname = 'automation_run_logs_run_id_fkey'
         and constraint_row.confrelid = 'public.automation_runs'::regclass
         and constraint_row.confdeltype = 'c'
     ) then
    raise exception 'Automation rule-delete/history FK authority drifted.'
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
    raise exception 'Browser Automation write authority drifted.'
      using errcode = '55000';
  end if;
end
$$;

create temp table ux8g4a2d2_apply_baseline on commit drop as
with protected_functions(identity) as (
  values
    ('public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'),
    ('public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'),
    ('coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'),
    ('coachfort_internal.enforce_automation_run_execution_identity()'),
    ('coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'),
    ('public.is_valid_automation_trigger(uuid,text,text,uuid,jsonb)'),
    ('coachfort_internal.assert_tenant_operational_access(uuid)'),
    ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
    ('public.delete_automation_rule_secure(uuid,uuid)')
), function_contract as (
  select jsonb_agg(jsonb_build_object(
    'identity', expected.identity,
    'owner', pg_get_userbyid(procedure.proowner),
    'acl', coalesce(procedure.proacl::text, ''),
    'security_definer', procedure.prosecdef,
    'volatility', procedure.provolatile,
    'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb),
    'definition', pg_get_functiondef(procedure.oid)
  ) order by expected.identity) contract
  from protected_functions expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), schema_contract as (
  select jsonb_build_object(
    'relations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'identity', class.oid::regclass::text,
        'rls', class.relrowsecurity,
        'force_rls', class.relforcerowsecurity,
        'acl', coalesce(class.relacl::text, '')
      ) order by class.oid::regclass::text)
      from pg_catalog.pg_class class
      where class.oid in (
        'public.automation_rules'::regclass,
        'public.automation_rule_conditions'::regclass,
        'public.automation_rule_actions'::regclass,
        'public.automation_runs'::regclass,
        'public.automation_run_logs'::regclass,
        'coachfort_internal.monthly_usage_counters'::regclass,
        'coachfort_internal.monthly_usage_consumption_events'::regclass
      )
    ), '[]'::jsonb),
    'constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', constraint_row.conrelid::regclass::text,
        'name', constraint_row.conname,
        'definition', pg_get_constraintdef(constraint_row.oid)
      ) order by constraint_row.conrelid::regclass::text,
          constraint_row.conname)
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid in (
        'public.automation_rule_conditions'::regclass,
        'public.automation_rule_actions'::regclass,
        'public.automation_runs'::regclass,
        'public.automation_run_logs'::regclass
      )
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', index_class.relname,
        'definition', pg_get_indexdef(index_row.indexrelid)
      ) order by index_class.relname)
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class
        on index_class.oid = index_row.indexrelid
      where index_row.indrelid = 'public.automation_runs'::regclass
    ), '[]'::jsonb),
    'triggers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', trigger.tgname,
        'definition', pg_get_triggerdef(trigger.oid)
      ) order by trigger.tgname)
      from pg_catalog.pg_trigger trigger
      where trigger.tgrelid = 'public.automation_runs'::regclass
        and not trigger.tgisinternal
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(to_jsonb(policy) order by policy.tablename,
        policy.policyname)
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename in (
          'automation_rules', 'automation_rule_conditions',
          'automation_rule_actions', 'automation_runs', 'automation_run_logs'
        )
    ), '[]'::jsonb)
  ) contract
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
    'monthly_usage_consumption_events',
      (select count(*)
       from coachfort_internal.monthly_usage_consumption_events),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits)
  ) counts
)
select
  function_contract.contract function_contract,
  schema_contract.contract schema_contract,
  protected_rows.counts protected_rows
from function_contract
cross join schema_contract
cross join protected_rows;

drop function public.run_automation_trigger(uuid,text,text,uuid,jsonb);

do $$
declare
  v_function_contract jsonb;
  v_schema_contract jsonb;
  v_protected_rows jsonb;
  v_request_runner regprocedure := to_regprocedure(
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
  );
begin
  if to_regprocedure(
       'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
     ) is not null
     or v_request_runner is null
     or (
       select count(*)
       from pg_catalog.pg_proc procedure
       join pg_catalog.pg_namespace namespace
         on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname = 'run_automation_trigger'
     ) <> 1 then
    raise exception 'Final Automation RPC inventory is not exact.'
      using errcode = '55000';
  end if;

  if not has_function_privilege(
       'authenticated', v_request_runner, 'EXECUTE'
     )
     or has_function_privilege('anon', v_request_runner, 'EXECUTE')
     or has_function_privilege('service_role', v_request_runner, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = v_request_runner
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Final request-aware Automation ACL drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.oid not in (
        v_request_runner,
        to_regprocedure(
          'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
        )
      )
      and lower(procedure.prosrc) like '%run_automation_trigger(%'
  ) then
    raise exception 'An alternate public Automation wrapper remains.'
      using errcode = '55000';
  end if;

  with protected_functions(identity) as (
    values
      ('public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'),
      ('public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'),
      ('coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'),
      ('coachfort_internal.enforce_automation_run_execution_identity()'),
      ('coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'),
      ('public.is_valid_automation_trigger(uuid,text,text,uuid,jsonb)'),
      ('coachfort_internal.assert_tenant_operational_access(uuid)'),
      ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
      ('public.delete_automation_rule_secure(uuid,uuid)')
  )
  select jsonb_agg(jsonb_build_object(
    'identity', expected.identity,
    'owner', pg_get_userbyid(procedure.proowner),
    'acl', coalesce(procedure.proacl::text, ''),
    'security_definer', procedure.prosecdef,
    'volatility', procedure.provolatile,
    'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb),
    'definition', pg_get_functiondef(procedure.oid)
  ) order by expected.identity)
  into v_function_contract
  from protected_functions expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  with schema_contract as (
    select jsonb_build_object(
      'relations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'identity', class.oid::regclass::text,
          'rls', class.relrowsecurity,
          'force_rls', class.relforcerowsecurity,
          'acl', coalesce(class.relacl::text, '')
        ) order by class.oid::regclass::text)
        from pg_catalog.pg_class class
        where class.oid in (
          'public.automation_rules'::regclass,
          'public.automation_rule_conditions'::regclass,
          'public.automation_rule_actions'::regclass,
          'public.automation_runs'::regclass,
          'public.automation_run_logs'::regclass,
          'coachfort_internal.monthly_usage_counters'::regclass,
          'coachfort_internal.monthly_usage_consumption_events'::regclass
        )
      ), '[]'::jsonb),
      'constraints', coalesce((
        select jsonb_agg(jsonb_build_object(
          'table', constraint_row.conrelid::regclass::text,
          'name', constraint_row.conname,
          'definition', pg_get_constraintdef(constraint_row.oid)
        ) order by constraint_row.conrelid::regclass::text,
            constraint_row.conname)
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid in (
          'public.automation_rule_conditions'::regclass,
          'public.automation_rule_actions'::regclass,
          'public.automation_runs'::regclass,
          'public.automation_run_logs'::regclass
        )
      ), '[]'::jsonb),
      'indexes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', index_class.relname,
          'definition', pg_get_indexdef(index_row.indexrelid)
        ) order by index_class.relname)
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_class
          on index_class.oid = index_row.indexrelid
        where index_row.indrelid = 'public.automation_runs'::regclass
      ), '[]'::jsonb),
      'triggers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', trigger.tgname,
          'definition', pg_get_triggerdef(trigger.oid)
        ) order by trigger.tgname)
        from pg_catalog.pg_trigger trigger
        where trigger.tgrelid = 'public.automation_runs'::regclass
          and not trigger.tgisinternal
      ), '[]'::jsonb),
      'policies', coalesce((
        select jsonb_agg(to_jsonb(policy) order by policy.tablename,
          policy.policyname)
        from pg_catalog.pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename in (
            'automation_rules', 'automation_rule_conditions',
            'automation_rule_actions', 'automation_runs',
            'automation_run_logs'
          )
      ), '[]'::jsonb)
    ) contract
  )
  select contract into v_schema_contract from schema_contract;

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
    'monthly_usage_consumption_events',
      (select count(*)
       from coachfort_internal.monthly_usage_consumption_events),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits)
  ) into v_protected_rows;

  if exists (
    select 1
    from ux8g4a2d2_apply_baseline baseline
    where baseline.function_contract is distinct from v_function_contract
       or baseline.schema_contract is distinct from v_schema_contract
       or baseline.protected_rows is distinct from v_protected_rows
  ) then
    raise exception 'A2D2 changed protected data or adjacent authorities.'
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
    raise exception 'Browser Automation writes changed during A2D2.'
      using errcode = '55000';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;

/* POST-APPLY READ-ONLY VERIFICATION
with identities as (
  select
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
    ) legacy_runner,
    to_regprocedure(
      'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
    ) request_runner,
    to_regprocedure(
      'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
    ) unvalidated_runner,
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
      pg_get_functiondef(identities.request_runner),
      '[[:space:]]+', ' ', 'g'
    )) request_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.unvalidated_runner),
      '[[:space:]]+', ' ', 'g'
    )) unvalidated_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.metered_runner),
      '[[:space:]]+', ' ', 'g'
    )) metered_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.identity_trigger),
      '[[:space:]]+', ' ', 'g'
    )) identity_trigger_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.monthly_consumer),
      '[[:space:]]+', ' ', 'g'
    )) monthly_consumer_source,
    lower(regexp_replace(
      pg_get_functiondef(identities.delete_rule),
      '[[:space:]]+', ' ', 'g'
    )) delete_source
  from identities
), rpc_inventory as (
  select
    count(*) total_overloads,
    count(*) filter (
      where procedure.oid = identities.request_runner
    ) request_overloads,
    coalesce(jsonb_agg(
      procedure.oid::regprocedure::text
      order by procedure.oid::regprocedure::text
    ), '[]'::jsonb) identities
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  cross join identities
  where namespace.nspname = 'public'
    and procedure.proname = 'run_automation_trigger'
), rpc_acl as (
  select
    has_function_privilege(
      'authenticated', identities.request_runner, 'EXECUTE'
    ) authenticated_execute,
    has_function_privilege('anon', identities.request_runner, 'EXECUTE')
      anon_execute,
    has_function_privilege(
      'service_role', identities.request_runner, 'EXECUTE'
    ) service_execute,
    exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = identities.request_runner
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) public_execute
  from identities
), private_functions as (
  select
    expected.kind,
    expected.identity,
    procedure.oid,
    procedure.prosecdef,
    pg_get_userbyid(procedure.proowner) owner_name,
    procedure.proconfig @> array['search_path=public, pg_temp']
      fixed_search_path,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_execute,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      service_execute,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) public_execute
  from (values
    (
      'unvalidated',
      'public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)'
    ),
    (
      'metered',
      'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
    ),
    (
      'identity_trigger',
      'coachfort_internal.enforce_automation_run_execution_identity()'
    ),
    (
      'monthly_consumer',
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    )
  ) expected(kind, identity)
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), schema_state as (
  select
    (
      select count(*)
      from information_schema.columns column_def
      where column_def.table_schema = 'public'
        and column_def.table_name = 'automation_runs'
        and (
          (column_def.column_name = 'execution_id'
            and column_def.data_type = 'uuid')
          or (column_def.column_name = 'execution_fingerprint'
            and column_def.data_type = 'text')
          or (column_def.column_name = 'rule_id_snapshot'
            and column_def.data_type = 'uuid')
        )
    ) execution_columns,
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
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
    ) exact_identity_constraint,
    exists (
      select 1 from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class
        on index_class.oid = index_row.indexrelid
      where index_row.indrelid = 'public.automation_runs'::regclass
        and index_class.relname =
          'automation_runs_tenant_rule_execution_unique_idx'
        and index_row.indisunique
        and lower(pg_get_indexdef(index_row.indexrelid)) like
          '%(tenant_id, rule_id_snapshot, execution_id)%'
        and regexp_replace(lower(pg_get_expr(
          index_row.indpred, index_row.indrelid
        )), '[[:space:]()]', '', 'g') = 'execution_idisnotnull'
    ) exact_execution_index,
    exists (
      select 1 from pg_catalog.pg_trigger trigger
      where trigger.tgrelid = 'public.automation_runs'::regclass
        and trigger.tgname =
          'automation_runs_execution_identity_immutable'
        and trigger.tgfoid = identities.identity_trigger
        and lower(pg_get_triggerdef(trigger.oid)) like
          '%before insert or update%'
        and not trigger.tgisinternal
    ) identity_trigger_bound,
    not exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = constraint_row.conrelid
       and attribute.attnum = any(constraint_row.conkey)
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.contype = 'f'
        and attribute.attname = 'rule_id_snapshot'
    ) snapshot_not_foreign_key
  from identities
), delete_contract as (
  select
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.automation_rule_conditions'::regclass
        and constraint_row.conname =
          'automation_rule_conditions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) condition_rule_cascade,
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.automation_rule_actions'::regclass
        and constraint_row.conname = 'automation_rule_actions_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'c'
    ) action_rule_cascade,
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname = 'automation_runs_rule_id_fkey'
        and constraint_row.confrelid = 'public.automation_rules'::regclass
        and constraint_row.confdeltype = 'n'
    ) run_rule_set_null,
    exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_trigger trigger
        on trigger.tgconstraint = constraint_row.oid
      where constraint_row.conrelid = 'public.automation_runs'::regclass
        and constraint_row.conname = 'automation_runs_rule_id_fkey'
        and trigger.tgrelid = 'public.automation_rules'::regclass
        and lower(pg_get_triggerdef(trigger.oid)) like
          '%after delete%ri_fkey_setnull_del%'
    ) fk_detach_after_parent_delete,
    exists (
      select 1 from pg_catalog.pg_constraint constraint_row
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
      detach_guarded
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
), alternate_public_wrappers as (
  select procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  cross join identities
  where namespace.nspname = 'public'
    and procedure.oid not in (
      identities.request_runner,
      identities.unvalidated_runner
    )
    and lower(procedure.prosrc) like '%run_automation_trigger(%'
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
    'monthly_usage_consumption_events',
      (select count(*)
       from coachfort_internal.monthly_usage_consumption_events),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits)
  ) counts
), contracts as (
  select
    identities.legacy_runner is null
      and identities.request_runner is not null
      and rpc_inventory.total_overloads = 1
      and rpc_inventory.request_overloads = 1
      exact_final_rpc_inventory,
    coalesce((
      select procedure.prosecdef
        and procedure.pronargdefaults = 0
        and 'p_execution_id' = any(procedure.proargnames)
        and pg_get_userbyid(procedure.proowner) = 'postgres'
        and procedure.proconfig @> array['search_path=public, pg_temp']
      from pg_catalog.pg_proc procedure
      where procedure.oid = identities.request_runner
    ), false)
      and sources.request_source like '%p_execution_id is null%'
      and sources.request_source like
        '%assert_tenant_operational_access%is_valid_automation_trigger%assert_effective_operational_feature%run_automation_trigger_metered%'
      and sources.request_source not like '%gen_random_uuid()%'
      and position('assert_tenant_operational_access' in sources.request_source)
        < position('is_valid_automation_trigger' in sources.request_source)
       and position('is_valid_automation_trigger' in sources.request_source)
         < position(
           'assert_effective_operational_feature' in sources.request_source
         )
       and position(
         'assert_effective_operational_feature' in sources.request_source
       ) < position('run_automation_trigger_metered' in sources.request_source)
      request_aware_runner_contract,
    rpc_acl.authenticated_execute
      and not rpc_acl.anon_execute
      and not rpc_acl.service_execute
      and not rpc_acl.public_execute
      exact_rpc_acl,
    (
      select count(*) = 4 and bool_and(
        oid is not null
        and prosecdef
        and owner_name = 'postgres'
        and fixed_search_path
        and not authenticated_execute
        and not anon_execute
        and not service_execute
        and not public_execute
      )
      from private_functions
    ) private_authority_contract,
    sources.unvalidated_source like '%run_automation_trigger_metered%'
      and sources.unvalidated_source like '%gen_random_uuid()%'
      unvalidated_internal_adapter_contract,
    sources.metered_source like '%execution_id = p_execution_id%'
      and sources.metered_source like '%automation_runs_monthly%'
      and sources.metered_source like
        '%order by rule.created_at asc, rule.id asc%'
      and position('execution_id = p_execution_id' in sources.metered_source)
        < position('consume_monthly_usage' in sources.metered_source)
      metered_runner_contract,
    sources.monthly_consumer_source like '%resolve_monthly_usage_limit%'
      and sources.monthly_consumer_source like '%monthly_usage_counters%'
      and sources.monthly_consumer_source like
        '%monthly_usage_consumption_events%'
      monthly_meter_contract,
    schema_state.execution_columns = 3
      and schema_state.exact_identity_constraint
      and schema_state.exact_execution_index
      and schema_state.identity_trigger_bound
      and schema_state.snapshot_not_foreign_key
      execution_identity_contract,
    delete_contract.condition_rule_cascade
      and delete_contract.action_rule_cascade
      and delete_contract.run_rule_set_null
      and delete_contract.fk_detach_after_parent_delete
      and delete_contract.run_log_cascade
      and delete_contract.delete_preserves_history
      and delete_contract.detach_guarded
      delete_history_contract,
    browser_writes.write_grants = 0 browser_write_contract,
    not exists (select 1 from alternate_public_wrappers)
      no_alternate_public_wrapper
  from identities
  cross join sources
  cross join rpc_inventory
  cross join rpc_acl
  cross join schema_state
  cross join delete_contract
  cross join browser_writes
)
select
  contracts.*,
  rpc_inventory.identities final_rpc_inventory,
  protected_rows.counts protected_counts,
  (
    contracts.exact_final_rpc_inventory
    and contracts.request_aware_runner_contract
    and contracts.exact_rpc_acl
    and contracts.private_authority_contract
    and contracts.unvalidated_internal_adapter_contract
    and contracts.metered_runner_contract
    and contracts.monthly_meter_contract
    and contracts.execution_identity_contract
    and contracts.delete_history_contract
    and contracts.browser_write_contract
    and contracts.no_alternate_public_wrapper
  ) security_gate
from contracts
cross join rpc_inventory
cross join protected_rows;
*/
