-- Bundle UX-8G4A2A: Immediate Server Feature Entitlement Closure
-- Review before execution. Do not run until approved.
--
-- Scope:
-- - Reuse UX-8G1B lifecycle-aware effective feature authority.
-- - Enforce Automations on positive rule/configuration/execution operations.
-- - Preserve Automation read, disable, and delete behavior.
-- - Enforce Messages on the four active Chat write identities.
-- - Do not add monthly meters, change plan catalog data, or mutate business rows.

/*
PRE-APPLY READ-ONLY VERIFICATION

with expected_functions(identity) as (
  values
    ('public.create_automation_rule_secure(uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.update_automation_rule_secure(uuid,uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.set_automation_rule_enabled_secure(uuid,uuid,boolean)'),
    ('public.delete_automation_rule_secure(uuid,uuid)'),
    ('public.create_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.update_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.delete_automation_condition_secure(uuid,uuid)'),
    ('public.create_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.update_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.delete_automation_action_secure(uuid,uuid)'),
    ('public.run_automation_trigger(uuid,text,text,uuid,jsonb)'),
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'),
    ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)')
), function_state as (
  select
    count(*) filter (where to_regprocedure(identity) is not null) installed_count,
    count(*) filter (
      where to_regprocedure(identity) is not null
        and has_function_privilege(
          'authenticated', to_regprocedure(identity), 'EXECUTE'
        )
    ) authenticated_execute_count,
    count(*) filter (
      where to_regprocedure(identity) is not null
        and has_function_privilege('anon', to_regprocedure(identity), 'EXECUTE')
    ) anon_execute_count,
    count(*) filter (
      where to_regprocedure(identity) is not null
        and has_function_privilege(
          'service_role', to_regprocedure(identity), 'EXECUTE'
        )
    ) service_role_execute_count,
    count(*) filter (
      where to_regprocedure(identity) is not null
        and exists (
          select 1
          from aclexplode(coalesce(
            (select p.proacl from pg_proc p
             where p.oid = to_regprocedure(identity)),
            acldefault('f', (select p.proowner from pg_proc p
             where p.oid = to_regprocedure(identity)))
          )) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
    ) public_execute_count
  from expected_functions
), resolver_state as (
  select
    p.oid is not null installed,
    coalesce(r.rolname = 'postgres', false) postgres_owned,
    coalesce(p.prosecdef, false) security_definer,
    coalesce(p.provolatile = 's', false) stable,
    coalesce(
      p.proconfig && array['search_path=public', 'search_path=public, pg_temp'],
      false
    ) fixed_search_path,
    coalesce(
      lower(pg_get_functiondef(p.oid)) like
        '%tenant_operational_access_allowed(p_tenant_id)%',
      false
    ) lifecycle_bound
  from (values (
    to_regprocedure(
      'coachfort_internal.resolve_effective_feature_access_authority(uuid,text)'
    )
  )) expected(oid)
  left join pg_proc p on p.oid = expected.oid
  left join pg_roles r on r.oid = p.proowner
), lifecycle_state as (
  select
    p.oid is not null installed,
    coalesce(r.rolname = 'postgres', false) postgres_owned,
    coalesce(p.prosecdef, false) security_definer,
    coalesce(p.provolatile = 's', false) stable
  from (values (
    to_regprocedure(
      'coachfort_internal.assert_tenant_operational_access(uuid)'
    )
  )) expected(oid)
  left join pg_proc p on p.oid = expected.oid
  left join pg_roles r on r.oid = p.proowner
), partial_installation as (
  select
    to_regprocedure(
      'coachfort_internal.assert_effective_operational_feature(uuid,text)'
    ) is not null helper_exists,
    count(*) filter (
      where to_regprocedure(identity) is not null
        and lower(pg_get_functiondef(to_regprocedure(identity))) like
          '%assert_effective_operational_feature%'
    ) patched_function_count
  from expected_functions
), browser_writes as (
  select count(*) write_grant_count
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in (
      'automation_rules',
      'automation_rule_conditions',
      'automation_rule_actions',
      'automation_runs',
      'automation_run_logs',
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
    and privilege.grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), protected_rows as (
  select jsonb_build_object(
    'automation_rules', (select count(*) from public.automation_rules),
    'automation_conditions',
      (select count(*) from public.automation_rule_conditions),
    'automation_actions',
      (select count(*) from public.automation_rule_actions),
    'automation_runs', (select count(*) from public.automation_runs),
    'automation_run_logs', (select count(*) from public.automation_run_logs),
    'conversation_threads', (select count(*) from public.conversation_threads),
    'conversation_participants',
      (select count(*) from public.conversation_participants),
    'conversation_messages', (select count(*) from public.conversation_messages),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments)
  ) counts
)
select
  jsonb_build_object(
    'function_state', to_jsonb(function_state),
    'resolver_state', to_jsonb(resolver_state),
    'lifecycle_state', to_jsonb(lifecycle_state),
    'partial_installation', to_jsonb(partial_installation),
    'browser_write_grants', browser_writes.write_grant_count,
    'protected_rows', protected_rows.counts
  ) verification,
  function_state.installed_count = 15
    and function_state.authenticated_execute_count = 15
    and function_state.anon_execute_count = 0
    and function_state.service_role_execute_count = 0
    and function_state.public_execute_count = 0
    and resolver_state.installed
    and resolver_state.postgres_owned
    and resolver_state.security_definer
    and resolver_state.stable
    and resolver_state.fixed_search_path
    and resolver_state.lifecycle_bound
    and lifecycle_state.installed
    and lifecycle_state.postgres_owned
    and lifecycle_state.security_definer
    and lifecycle_state.stable
    and not partial_installation.helper_exists
    and partial_installation.patched_function_count = 0
    and browser_writes.write_grant_count = 0
    as ready_for_apply
from function_state
cross join resolver_state
cross join lifecycle_state
cross join partial_installation
cross join browser_writes
cross join protected_rows;
*/

begin;

do $$
declare
  v_expected_function_count integer;
begin
  if to_regprocedure(
       'coachfort_internal.resolve_effective_feature_access_authority(uuid,text)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.assert_tenant_operational_access(uuid)'
     ) is null then
    raise exception 'UX-8G1B lifecycle and feature authority is required.'
      using errcode = '55000';
  end if;

  select count(*)
  into v_expected_function_count
  from (values
    ('public.create_automation_rule_secure(uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.update_automation_rule_secure(uuid,uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.set_automation_rule_enabled_secure(uuid,uuid,boolean)'),
    ('public.delete_automation_rule_secure(uuid,uuid)'),
    ('public.create_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.update_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.delete_automation_condition_secure(uuid,uuid)'),
    ('public.create_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.update_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.delete_automation_action_secure(uuid,uuid)'),
    ('public.run_automation_trigger(uuid,text,text,uuid,jsonb)'),
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'),
    ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)')
  ) expected(identity)
  where to_regprocedure(expected.identity) is not null;

  if v_expected_function_count <> 15 then
    raise exception 'Required Automation or Chat RPC identity has drifted.'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'coachfort_internal.assert_effective_operational_feature(uuid,text)'
     ) is not null then
    raise exception 'UX-8G4A2A appears partially installed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'automation_rules',
        'automation_rule_conditions',
        'automation_rule_actions',
        'automation_runs',
        'automation_run_logs',
        'conversation_threads',
        'conversation_participants',
        'conversation_messages'
      )
      and privilege.grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Browser write authority has drifted.'
      using errcode = '55000';
  end if;
end;
$$;

create function coachfort_internal.assert_effective_operational_feature(
  p_tenant_id uuid,
  p_feature_key text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_authority jsonb;
  v_effective_status text;
begin
  if p_tenant_id is null or nullif(trim(coalesce(p_feature_key, '')), '') is null then
    raise exception 'Workspace feature access is unavailable.'
      using errcode = '42501';
  end if;

  -- Lifecycle must deny before feature settings, plan state, or overrides.
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);

  v_authority :=
    coachfort_internal.resolve_effective_feature_access_authority(
      p_tenant_id,
      p_feature_key
    );

  select feature ->> 'effective_status'
  into v_effective_status
  from jsonb_array_elements(coalesce(v_authority -> 'features', '[]'::jsonb)) feature
  where feature ->> 'feature_key' = lower(trim(p_feature_key))
  limit 1;

  if coalesce(v_effective_status, 'locked') <> 'included' then
    raise exception 'This feature is not available for this workspace.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_automation_rule_secure(
  p_tenant_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_status text,
  p_execution_mode text,
  p_actions jsonb,
  p_conditions jsonb default '[]'::jsonb
)
returns public.automation_rules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_description text;
  v_trigger_type text;
  v_status text;
  v_execution_mode text;
  v_first_action jsonb;
  v_first_action_type text;
  v_first_config jsonb;
  v_rule public.automation_rules%rowtype;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );

  v_name := public.m69_9_safe_text(p_name, 'Automation name', true, 160);
  v_description := public.m69_9_safe_text(
    p_description, 'Automation description', false, 1000
  );
  v_trigger_type := public.m69_9_validate_trigger_type(p_trigger_type);
  v_status := public.m69_9_validate_status(p_status);
  v_execution_mode := public.m69_9_validate_execution_mode(p_execution_mode);

  if p_actions is null
     or jsonb_typeof(p_actions) <> 'array'
     or jsonb_array_length(p_actions) < 1 then
    raise exception 'At least one automation action is required.'
      using errcode = '22023';
  end if;

  v_first_action := p_actions -> 0;
  v_first_action_type := public.m69_9_validate_action_type(
    v_first_action ->> 'action_type'
  );
  v_first_config := public.m69_9_sanitize_json_object(
    coalesce(v_first_action -> 'config_json', '{}'::jsonb),
    'Action payload',
    2500
  );

  insert into public.automation_rules (
    tenant_id,
    name,
    description,
    trigger_type,
    action_type,
    is_active,
    status,
    execution_mode,
    config,
    created_by,
    metadata_json
  )
  values (
    p_tenant_id,
    v_name,
    v_description,
    v_trigger_type,
    v_first_action_type,
    v_status = 'active',
    v_status,
    v_execution_mode,
    v_first_config,
    auth.uid(),
    jsonb_build_object('engine', 'workflow_v1', 'source', 'secure_rpc')
  )
  returning * into v_rule;

  perform public.m69_9_replace_rule_rows(
    p_tenant_id,
    v_rule.id,
    p_actions,
    coalesce(p_conditions, '[]'::jsonb)
  );

  perform public.m69_9_write_audit(
    p_tenant_id,
    'automation_created',
    v_rule.id,
    v_rule.status,
    v_rule.trigger_type,
    jsonb_array_length(p_actions),
    jsonb_array_length(coalesce(p_conditions, '[]'::jsonb))
  );

  return v_rule;
end;
$$;

create or replace function public.update_automation_rule_secure(
  p_tenant_id uuid,
  p_rule_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_status text,
  p_execution_mode text,
  p_actions jsonb,
  p_conditions jsonb default '[]'::jsonb
)
returns public.automation_rules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.automation_rules%rowtype;
  v_name text;
  v_description text;
  v_trigger_type text;
  v_status text;
  v_execution_mode text;
  v_first_action jsonb;
  v_first_action_type text;
  v_first_config jsonb;
  v_rule public.automation_rules%rowtype;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  v_existing := public.m69_9_assert_rule_in_tenant(p_tenant_id, p_rule_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );

  v_name := public.m69_9_safe_text(p_name, 'Automation name', true, 160);
  v_description := public.m69_9_safe_text(
    p_description, 'Automation description', false, 1000
  );
  v_trigger_type := public.m69_9_validate_trigger_type(p_trigger_type);
  v_status := public.m69_9_validate_status(p_status);
  v_execution_mode := public.m69_9_validate_execution_mode(p_execution_mode);

  if p_actions is null
     or jsonb_typeof(p_actions) <> 'array'
     or jsonb_array_length(p_actions) < 1 then
    raise exception 'At least one automation action is required.'
      using errcode = '22023';
  end if;

  v_first_action := p_actions -> 0;
  v_first_action_type := public.m69_9_validate_action_type(
    v_first_action ->> 'action_type'
  );
  v_first_config := public.m69_9_sanitize_json_object(
    coalesce(v_first_action -> 'config_json', '{}'::jsonb),
    'Action payload',
    2500
  );

  update public.automation_rules ar
  set
    name = v_name,
    description = v_description,
    trigger_type = v_trigger_type,
    action_type = v_first_action_type,
    is_active = v_status = 'active',
    status = v_status,
    execution_mode = v_execution_mode,
    config = v_first_config,
    metadata_json = jsonb_build_object(
      'engine', 'workflow_v1', 'source', 'secure_rpc'
    )
  where ar.tenant_id = p_tenant_id
    and ar.id = v_existing.id
  returning * into v_rule;

  perform public.m69_9_replace_rule_rows(
    p_tenant_id,
    v_rule.id,
    p_actions,
    coalesce(p_conditions, '[]'::jsonb)
  );

  perform public.m69_9_write_audit(
    p_tenant_id,
    'automation_updated',
    v_rule.id,
    v_rule.status,
    v_rule.trigger_type,
    jsonb_array_length(p_actions),
    jsonb_array_length(coalesce(p_conditions, '[]'::jsonb))
  );

  return v_rule;
end;
$$;

create or replace function public.set_automation_rule_enabled_secure(
  p_tenant_id uuid,
  p_rule_id uuid,
  p_enabled boolean
)
returns public.automation_rules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.automation_rules%rowtype;
  v_rule public.automation_rules%rowtype;
  v_status text := case
    when coalesce(p_enabled, false) then 'active'
    else 'inactive'
  end;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  v_existing := public.m69_9_assert_rule_in_tenant(p_tenant_id, p_rule_id);

  if coalesce(p_enabled, false) then
    perform coachfort_internal.assert_effective_operational_feature(
      p_tenant_id, 'automations'
    );
  end if;

  update public.automation_rules ar
  set
    is_active = coalesce(p_enabled, false),
    status = v_status
  where ar.tenant_id = p_tenant_id
    and ar.id = v_existing.id
  returning * into v_rule;

  perform public.m69_9_write_audit(
    p_tenant_id,
    case
      when v_status = 'active' then 'automation_enabled'
      else 'automation_disabled'
    end,
    v_rule.id,
    v_rule.status,
    v_rule.trigger_type
  );

  return v_rule;
end;
$$;

create or replace function public.delete_automation_rule_secure(
  p_tenant_id uuid,
  p_rule_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.automation_rules%rowtype;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  v_existing := public.m69_9_assert_rule_in_tenant(p_tenant_id, p_rule_id);

  delete from public.automation_rule_conditions arc
  where arc.tenant_id = p_tenant_id
    and arc.rule_id = v_existing.id;

  delete from public.automation_rule_actions ara
  where ara.tenant_id = p_tenant_id
    and ara.rule_id = v_existing.id;

  delete from public.automation_rules ar
  where ar.tenant_id = p_tenant_id
    and ar.id = v_existing.id;

  perform public.m69_9_write_audit(
    p_tenant_id,
    'automation_deleted',
    v_existing.id,
    v_existing.status,
    v_existing.trigger_type
  );

  return v_existing.id;
end;
$$;

create or replace function public.create_automation_condition_secure(
  p_tenant_id uuid,
  p_rule_id uuid,
  p_condition_type text,
  p_operator text default null,
  p_value_json jsonb default '{}'::jsonb,
  p_sort_order integer default 0
)
returns public.automation_rule_conditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.automation_rules%rowtype;
  v_condition public.automation_rule_conditions%rowtype;
  v_condition_type text;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  v_rule := public.m69_9_assert_rule_in_tenant(p_tenant_id, p_rule_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );
  v_condition_type := public.m69_9_validate_condition_type(p_condition_type);

  insert into public.automation_rule_conditions (
    tenant_id,
    rule_id,
    condition_type,
    operator,
    value_json,
    sort_order
  )
  values (
    p_tenant_id,
    v_rule.id,
    v_condition_type,
    public.m69_9_safe_text(
      coalesce(p_operator, v_condition_type),
      'Condition operator',
      true,
      80
    ),
    public.m69_9_sanitize_json_object(
      p_value_json, 'Condition payload', 1500
    ),
    greatest(coalesce(p_sort_order, 0), 0)
  )
  returning * into v_condition;

  return v_condition;
end;
$$;

create or replace function public.update_automation_condition_secure(
  p_tenant_id uuid,
  p_condition_id uuid,
  p_condition_type text,
  p_operator text default null,
  p_value_json jsonb default '{}'::jsonb,
  p_sort_order integer default 0
)
returns public.automation_rule_conditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_condition public.automation_rule_conditions%rowtype;
  v_condition_type text;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );
  v_condition_type := public.m69_9_validate_condition_type(p_condition_type);

  update public.automation_rule_conditions arc
  set
    condition_type = v_condition_type,
    operator = public.m69_9_safe_text(
      coalesce(p_operator, v_condition_type),
      'Condition operator',
      true,
      80
    ),
    value_json = public.m69_9_sanitize_json_object(
      p_value_json, 'Condition payload', 1500
    ),
    sort_order = greatest(coalesce(p_sort_order, 0), 0)
  where arc.tenant_id = p_tenant_id
    and arc.id = p_condition_id
  returning * into v_condition;

  if not found then
    raise exception 'Automation condition was not found in this workspace.'
      using errcode = '22023';
  end if;

  perform public.m69_9_assert_rule_in_tenant(
    p_tenant_id, v_condition.rule_id
  );
  return v_condition;
end;
$$;

create or replace function public.delete_automation_condition_secure(
  p_tenant_id uuid,
  p_condition_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_condition public.automation_rule_conditions%rowtype;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);

  select *
  into v_condition
  from public.automation_rule_conditions arc
  where arc.tenant_id = p_tenant_id
    and arc.id = p_condition_id;

  if not found then
    raise exception 'Automation condition was not found in this workspace.'
      using errcode = '22023';
  end if;

  perform public.m69_9_assert_rule_in_tenant(
    p_tenant_id, v_condition.rule_id
  );
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );

  delete from public.automation_rule_conditions arc
  where arc.tenant_id = p_tenant_id
    and arc.id = v_condition.id;

  return v_condition.id;
end;
$$;

create or replace function public.create_automation_action_secure(
  p_tenant_id uuid,
  p_rule_id uuid,
  p_action_type text,
  p_config_json jsonb default '{}'::jsonb,
  p_sort_order integer default 0
)
returns public.automation_rule_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.automation_rules%rowtype;
  v_action public.automation_rule_actions%rowtype;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  v_rule := public.m69_9_assert_rule_in_tenant(p_tenant_id, p_rule_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );

  insert into public.automation_rule_actions (
    tenant_id,
    rule_id,
    action_type,
    config_json,
    sort_order
  )
  values (
    p_tenant_id,
    v_rule.id,
    public.m69_9_validate_action_type(p_action_type),
    public.m69_9_sanitize_json_object(
      p_config_json, 'Action payload', 2500
    ),
    greatest(coalesce(p_sort_order, 0), 0)
  )
  returning * into v_action;

  return v_action;
end;
$$;

create or replace function public.update_automation_action_secure(
  p_tenant_id uuid,
  p_action_id uuid,
  p_action_type text,
  p_config_json jsonb default '{}'::jsonb,
  p_sort_order integer default 0
)
returns public.automation_rule_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.automation_rule_actions%rowtype;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );

  update public.automation_rule_actions ara
  set
    action_type = public.m69_9_validate_action_type(p_action_type),
    config_json = public.m69_9_sanitize_json_object(
      p_config_json, 'Action payload', 2500
    ),
    sort_order = greatest(coalesce(p_sort_order, 0), 0)
  where ara.tenant_id = p_tenant_id
    and ara.id = p_action_id
  returning * into v_action;

  if not found then
    raise exception 'Automation action was not found in this workspace.'
      using errcode = '22023';
  end if;

  perform public.m69_9_assert_rule_in_tenant(p_tenant_id, v_action.rule_id);
  return v_action;
end;
$$;

create or replace function public.delete_automation_action_secure(
  p_tenant_id uuid,
  p_action_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.automation_rule_actions%rowtype;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);

  select *
  into v_action
  from public.automation_rule_actions ara
  where ara.tenant_id = p_tenant_id
    and ara.id = p_action_id;

  if not found then
    raise exception 'Automation action was not found in this workspace.'
      using errcode = '22023';
  end if;

  perform public.m69_9_assert_rule_in_tenant(p_tenant_id, v_action.rule_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'automations'
  );

  delete from public.automation_rule_actions ara
  where ara.tenant_id = p_tenant_id
    and ara.id = v_action.id;

  return v_action.id;
end;
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
declare
  v_tenant_id alias for $1;
  v_trigger_type alias for $2;
  v_entity_type alias for $3;
  v_entity_id alias for $4;
  v_metadata_json alias for $5;
  v_trigger_valid boolean := false;
begin
  executed_count := 0;
  skipped_count := 0;
  failed_count := 0;

  -- Keep lifecycle and feature denial outside legacy failure normalization.
  perform coachfort_internal.assert_tenant_operational_access(v_tenant_id);

  begin
    v_trigger_valid := public.is_valid_automation_trigger(
      v_tenant_id,
      v_trigger_type,
      v_entity_type,
      v_entity_id,
      coalesce(v_metadata_json, '{}'::jsonb)
    );
  exception when others then
    return next;
    return;
  end;

  if not coalesce(v_trigger_valid, false) then
    return next;
    return;
  end if;

  perform coachfort_internal.assert_effective_operational_feature(
    v_tenant_id, 'automations'
  );

  begin
    return query
    select *
    from public.run_automation_trigger_unvalidated(
      v_tenant_id,
      v_trigger_type,
      v_entity_type,
      v_entity_id,
      coalesce(v_metadata_json, '{}'::jsonb)
    );
  exception when others then
    executed_count := 0;
    skipped_count := 0;
    failed_count := 0;
    return next;
  end;
end;
$$;

create or replace function public.create_student_direct_chat(
  p_tenant_id uuid,
  p_student_id uuid,
  p_title text,
  p_initial_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_title text;
  normalized_message text;
  thread_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  normalized_title := public.chat_validate_plain_text(
    p_title, 'Title', true, 180
  );
  normalized_message := public.chat_validate_plain_text(
    p_initial_message, 'Message', true, 4000
  );

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.tenant_id = p_tenant_id
      and s.status = 'active'
  ) then
    raise exception 'Active student was not found in this tenant.'
      using errcode = '22023';
  end if;

  if not coalesce(
    public.chat_team_can_start_student_thread(p_tenant_id, p_student_id),
    false
  ) then
    raise exception 'You do not have permission to start a chat with this student.'
      using errcode = '42501';
  end if;

  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'messages'
  );

  insert into public.conversation_threads (
    tenant_id,
    thread_type,
    title,
    student_id,
    created_by,
    status,
    replies_enabled
  )
  values (
    p_tenant_id,
    'student_direct',
    normalized_title,
    p_student_id,
    actor_id,
    'active',
    true
  )
  returning id into thread_id;

  perform public.add_default_team_chat_participants(
    p_tenant_id, thread_id, actor_id, p_student_id
  );

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_user_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    p_tenant_id,
    thread_id,
    actor_id,
    normalized_message,
    'text',
    'sent',
    '{}'::jsonb
  );

  update public.conversation_threads
  set updated_at = now()
  where id = thread_id;

  perform public.chat_insert_audit(
    p_tenant_id,
    actor_id,
    'chat_thread_created',
    thread_id,
    p_student_id,
    'team'
  );
  perform public.chat_insert_audit(
    p_tenant_id,
    actor_id,
    'chat_message_sent',
    thread_id,
    p_student_id,
    'team'
  );

  return thread_id;
end;
$$;

create or replace function public.create_student_support_thread(
  p_title text,
  p_initial_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  normalized_title text;
  normalized_message text;
  thread_id uuid;
begin
  select *
  into ctx
  from public.chat_student_context()
  limit 1;

  if ctx.student_id is null then
    raise exception 'Active student portal account required.'
      using errcode = '42501';
  end if;

  perform coachfort_internal.assert_effective_operational_feature(
    ctx.tenant_id, 'messages'
  );

  normalized_title := public.chat_validate_plain_text(
    p_title, 'Title', true, 180
  );
  normalized_message := public.chat_validate_plain_text(
    p_initial_message, 'Message', true, 4000
  );

  insert into public.conversation_threads (
    tenant_id,
    thread_type,
    title,
    student_id,
    status,
    replies_enabled
  )
  values (
    ctx.tenant_id,
    'student_support',
    normalized_title,
    ctx.student_id,
    'active',
    true
  )
  returning id into thread_id;

  perform public.add_default_team_chat_participants(
    ctx.tenant_id, thread_id, null, ctx.student_id
  );

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_student_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    ctx.tenant_id,
    thread_id,
    ctx.student_id,
    normalized_message,
    'text',
    'sent',
    '{}'::jsonb
  );

  update public.conversation_threads
  set updated_at = now()
  where id = thread_id;

  perform public.chat_insert_audit(
    ctx.tenant_id,
    null,
    'student_support_thread_created',
    thread_id,
    ctx.student_id,
    'student'
  );

  return thread_id;
end;
$$;

create or replace function public.send_team_chat_message(
  p_thread_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  thread_row public.conversation_threads%rowtype;
  normalized_body text;
  message_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not coalesce(public.chat_team_can_access_thread(p_thread_id), false) then
    raise exception 'Chat thread access denied.' using errcode = '42501';
  end if;

  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id;

  perform coachfort_internal.assert_effective_operational_feature(
    thread_row.tenant_id, 'messages'
  );

  if thread_row.status <> 'active' then
    raise exception 'This chat thread is closed.' using errcode = '22023';
  end if;

  normalized_body := public.chat_validate_plain_text(
    p_body, 'Message', true, 4000
  );

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_user_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    thread_row.tenant_id,
    thread_row.id,
    actor_id,
    normalized_body,
    case
      when thread_row.thread_type in (
        'course_announcement', 'cohort_announcement'
      ) then 'announcement'
      else 'text'
    end,
    'sent',
    '{}'::jsonb
  )
  returning id into message_id;

  update public.conversation_threads
  set updated_at = now()
  where id = thread_row.id;

  insert into public.conversation_participants (
    tenant_id, thread_id, user_id, role, last_read_at
  )
  values (
    thread_row.tenant_id,
    thread_row.id,
    actor_id,
    public.chat_current_team_role(thread_row.tenant_id),
    now()
  )
  on conflict do nothing;

  perform public.chat_insert_audit(
    thread_row.tenant_id,
    actor_id,
    'chat_message_sent',
    thread_row.id,
    thread_row.student_id,
    'team'
  );

  return message_id;
end;
$$;

create or replace function public.send_student_chat_message(
  p_thread_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  thread_row public.conversation_threads%rowtype;
  normalized_body text;
  message_id uuid;
begin
  select *
  into ctx
  from public.chat_student_context()
  limit 1;

  if ctx.student_id is null then
    raise exception 'Active student portal account required.'
      using errcode = '42501';
  end if;

  if not coalesce(
    public.chat_student_can_access_thread(p_thread_id), false
  ) then
    raise exception 'Student chat thread access denied.'
      using errcode = '42501';
  end if;

  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id
    and tenant_id = ctx.tenant_id;

  perform coachfort_internal.assert_effective_operational_feature(
    thread_row.tenant_id, 'messages'
  );

  if thread_row.status <> 'active' then
    raise exception 'This chat thread is closed.' using errcode = '22023';
  end if;

  if not coalesce(thread_row.replies_enabled, false) then
    raise exception 'Replies are disabled for this thread.'
      using errcode = '42501';
  end if;

  if thread_row.thread_type not in ('student_direct', 'student_support') then
    raise exception 'Students cannot reply to announcement threads.'
      using errcode = '42501';
  end if;

  normalized_body := public.chat_validate_plain_text(
    p_body, 'Message', true, 4000
  );

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_student_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    thread_row.tenant_id,
    thread_row.id,
    ctx.student_id,
    normalized_body,
    'text',
    'sent',
    '{}'::jsonb
  )
  returning id into message_id;

  update public.conversation_threads
  set updated_at = now()
  where id = thread_row.id;

  insert into public.conversation_participants (
    tenant_id, thread_id, student_id, role, last_read_at
  )
  values (
    thread_row.tenant_id,
    thread_row.id,
    ctx.student_id,
    'student',
    now()
  )
  on conflict do nothing;

  perform public.chat_insert_audit(
    thread_row.tenant_id,
    null,
    'chat_message_sent',
    thread_row.id,
    ctx.student_id,
    'student'
  );

  return message_id;
end;
$$;

alter function coachfort_internal.assert_effective_operational_feature(uuid,text)
  owner to postgres;
alter function public.create_automation_rule_secure(
  uuid,text,text,text,text,text,jsonb,jsonb
) owner to postgres;
alter function public.update_automation_rule_secure(
  uuid,uuid,text,text,text,text,text,jsonb,jsonb
) owner to postgres;
alter function public.set_automation_rule_enabled_secure(uuid,uuid,boolean)
  owner to postgres;
alter function public.delete_automation_rule_secure(uuid,uuid)
  owner to postgres;
alter function public.create_automation_condition_secure(
  uuid,uuid,text,text,jsonb,integer
) owner to postgres;
alter function public.update_automation_condition_secure(
  uuid,uuid,text,text,jsonb,integer
) owner to postgres;
alter function public.delete_automation_condition_secure(uuid,uuid)
  owner to postgres;
alter function public.create_automation_action_secure(
  uuid,uuid,text,jsonb,integer
) owner to postgres;
alter function public.update_automation_action_secure(
  uuid,uuid,text,jsonb,integer
) owner to postgres;
alter function public.delete_automation_action_secure(uuid,uuid)
  owner to postgres;
alter function public.run_automation_trigger(uuid,text,text,uuid,jsonb)
  owner to postgres;
alter function public.create_student_direct_chat(uuid,uuid,text,text)
  owner to postgres;
alter function public.create_student_support_thread(text,text)
  owner to postgres;
alter function public.send_team_chat_message(uuid,text)
  owner to postgres;
alter function public.send_student_chat_message(uuid,text)
  owner to postgres;

revoke all on function
  coachfort_internal.assert_effective_operational_feature(uuid,text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_automation_rule_secure(
  uuid,text,text,text,text,text,jsonb,jsonb
) from public, anon, service_role;
revoke all on function public.update_automation_rule_secure(
  uuid,uuid,text,text,text,text,text,jsonb,jsonb
) from public, anon, service_role;
revoke all on function public.set_automation_rule_enabled_secure(
  uuid,uuid,boolean
) from public, anon, service_role;
revoke all on function public.delete_automation_rule_secure(uuid,uuid)
  from public, anon, service_role;
revoke all on function public.create_automation_condition_secure(
  uuid,uuid,text,text,jsonb,integer
) from public, anon, service_role;
revoke all on function public.update_automation_condition_secure(
  uuid,uuid,text,text,jsonb,integer
) from public, anon, service_role;
revoke all on function public.delete_automation_condition_secure(uuid,uuid)
  from public, anon, service_role;
revoke all on function public.create_automation_action_secure(
  uuid,uuid,text,jsonb,integer
) from public, anon, service_role;
revoke all on function public.update_automation_action_secure(
  uuid,uuid,text,jsonb,integer
) from public, anon, service_role;
revoke all on function public.delete_automation_action_secure(uuid,uuid)
  from public, anon, service_role;
revoke all on function public.run_automation_trigger(
  uuid,text,text,uuid,jsonb
) from public, anon, service_role;
revoke all on function public.create_student_direct_chat(uuid,uuid,text,text)
  from public, anon, service_role;
revoke all on function public.create_student_support_thread(text,text)
  from public, anon, service_role;
revoke all on function public.send_team_chat_message(uuid,text)
  from public, anon, service_role;
revoke all on function public.send_student_chat_message(uuid,text)
  from public, anon, service_role;

grant execute on function public.create_automation_rule_secure(
  uuid,text,text,text,text,text,jsonb,jsonb
) to authenticated;
grant execute on function public.update_automation_rule_secure(
  uuid,uuid,text,text,text,text,text,jsonb,jsonb
) to authenticated;
grant execute on function public.set_automation_rule_enabled_secure(
  uuid,uuid,boolean
) to authenticated;
grant execute on function public.delete_automation_rule_secure(uuid,uuid)
  to authenticated;
grant execute on function public.create_automation_condition_secure(
  uuid,uuid,text,text,jsonb,integer
) to authenticated;
grant execute on function public.update_automation_condition_secure(
  uuid,uuid,text,text,jsonb,integer
) to authenticated;
grant execute on function public.delete_automation_condition_secure(uuid,uuid)
  to authenticated;
grant execute on function public.create_automation_action_secure(
  uuid,uuid,text,jsonb,integer
) to authenticated;
grant execute on function public.update_automation_action_secure(
  uuid,uuid,text,jsonb,integer
) to authenticated;
grant execute on function public.delete_automation_action_secure(uuid,uuid)
  to authenticated;
grant execute on function public.run_automation_trigger(
  uuid,text,text,uuid,jsonb
) to authenticated;
grant execute on function public.create_student_direct_chat(uuid,uuid,text,text)
  to authenticated;
grant execute on function public.create_student_support_thread(text,text)
  to authenticated;
grant execute on function public.send_team_chat_message(uuid,text)
  to authenticated;
grant execute on function public.send_student_chat_message(uuid,text)
  to authenticated;

do $$
declare
  v_helper_source text;
  v_enable_source text;
  v_delete_source text;
  v_run_source text;
  v_source text;
  v_identity text;
begin
  select lower(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g'))
  into v_helper_source
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.oid = to_regprocedure(
      'coachfort_internal.assert_effective_operational_feature(uuid,text)'
    )
    and r.rolname = 'postgres'
    and p.prosecdef
    and p.provolatile = 's'
    and coalesce(p.proconfig, array[]::text[])
      && array['search_path=public', 'search_path=public, pg_temp'];

  if v_helper_source is null
     or v_helper_source not like '%assert_tenant_operational_access(p_tenant_id)%'
     or v_helper_source not like '%resolve_effective_feature_access_authority%'
     or v_helper_source not like '%effective_status%included%'
     or position('assert_tenant_operational_access' in v_helper_source) >=
        position('resolve_effective_feature_access_authority' in v_helper_source)
     or has_function_privilege(
       'authenticated',
       to_regprocedure(
         'coachfort_internal.assert_effective_operational_feature(uuid,text)'
       ),
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       to_regprocedure(
         'coachfort_internal.assert_effective_operational_feature(uuid,text)'
       ),
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       to_regprocedure(
         'coachfort_internal.assert_effective_operational_feature(uuid,text)'
       ),
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(
         p.proacl,
         acldefault('f', p.proowner)
       )) acl
       where p.oid = to_regprocedure(
           'coachfort_internal.assert_effective_operational_feature(uuid,text)'
         )
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Feature assertion helper postcondition failed.'
      using errcode = '55000';
  end if;

  foreach v_identity in array array[
    'public.create_automation_rule_secure(uuid,text,text,text,text,text,jsonb,jsonb)',
    'public.update_automation_rule_secure(uuid,uuid,text,text,text,text,text,jsonb,jsonb)',
    'public.create_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)',
    'public.update_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)',
    'public.delete_automation_condition_secure(uuid,uuid)',
    'public.create_automation_action_secure(uuid,uuid,text,jsonb,integer)',
    'public.update_automation_action_secure(uuid,uuid,text,jsonb,integer)',
    'public.delete_automation_action_secure(uuid,uuid)',
    'public.create_student_direct_chat(uuid,uuid,text,text)',
    'public.create_student_support_thread(text,text)',
    'public.send_team_chat_message(uuid,text)',
    'public.send_student_chat_message(uuid,text)'
  ] loop
    v_source := lower(regexp_replace(
      pg_get_functiondef(to_regprocedure(v_identity)),
      '[[:space:]]+',
      ' ',
      'g'
    ));

    if v_source not like '%assert_effective_operational_feature%'
       or position('assert_effective_operational_feature' in v_source) >=
          least(
            coalesce(nullif(position('insert into' in v_source), 0), 2147483647),
            coalesce(nullif(position('update public.' in v_source), 0), 2147483647),
            coalesce(nullif(position('delete from' in v_source), 0), 2147483647)
          ) then
      raise exception 'Feature assertion missing before mutation in %.', v_identity
        using errcode = '55000';
    end if;
  end loop;

  v_enable_source := lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.set_automation_rule_enabled_secure(uuid,uuid,boolean)'
  )), '[[:space:]]+', ' ', 'g'));
  v_delete_source := lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.delete_automation_rule_secure(uuid,uuid)'
  )), '[[:space:]]+', ' ', 'g'));
  v_run_source := lower(regexp_replace(pg_get_functiondef(to_regprocedure(
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
  )), '[[:space:]]+', ' ', 'g'));

  if v_enable_source not like
       '%if coalesce(p_enabled, false) then%assert_effective_operational_feature%'
     or v_delete_source like '%assert_effective_operational_feature%'
     or v_run_source not like '%assert_effective_operational_feature%automations%'
     or v_run_source not like '%run_automation_trigger_unvalidated%'
     or position('assert_tenant_operational_access' in v_run_source) >=
        position('assert_effective_operational_feature' in v_run_source)
     or v_run_source like '%automation_runs_monthly%' then
    raise exception 'Automation exception or execution contract failed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.create_automation_rule_secure(uuid,text,text,text,text,text,jsonb,jsonb)'),
      ('public.update_automation_rule_secure(uuid,uuid,text,text,text,text,text,jsonb,jsonb)'),
      ('public.set_automation_rule_enabled_secure(uuid,uuid,boolean)'),
      ('public.delete_automation_rule_secure(uuid,uuid)'),
      ('public.create_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
      ('public.update_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
      ('public.delete_automation_condition_secure(uuid,uuid)'),
      ('public.create_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
      ('public.update_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
      ('public.delete_automation_action_secure(uuid,uuid)'),
      ('public.run_automation_trigger(uuid,text,text,uuid,jsonb)'),
      ('public.create_student_direct_chat(uuid,uuid,text,text)'),
      ('public.create_student_support_thread(text,text)'),
      ('public.send_team_chat_message(uuid,text)'),
      ('public.send_student_chat_message(uuid,text)')
    ) expected(identity)
    join pg_proc p on p.oid = to_regprocedure(expected.identity)
    join pg_roles owner_role on owner_role.oid = p.proowner
      where owner_role.rolname <> 'postgres'
        or not p.prosecdef
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'Protected RPC ownership or ACL postcondition failed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'automation_rules', 'automation_rule_conditions',
        'automation_rule_actions', 'automation_runs', 'automation_run_logs',
        'conversation_threads', 'conversation_participants',
        'conversation_messages'
      )
      and privilege.grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Browser table-write postcondition failed.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with positive_functions(identity) as (
  values
    ('public.create_automation_rule_secure(uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.update_automation_rule_secure(uuid,uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.set_automation_rule_enabled_secure(uuid,uuid,boolean)'),
    ('public.create_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.update_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.delete_automation_condition_secure(uuid,uuid)'),
    ('public.create_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.update_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.delete_automation_action_secure(uuid,uuid)'),
    ('public.run_automation_trigger(uuid,text,text,uuid,jsonb)'),
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'),
    ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)')
), function_sources as (
  select
    identity,
    lower(regexp_replace(
      pg_get_functiondef(to_regprocedure(identity)),
      '[[:space:]]+',
      ' ',
      'g'
    )) source
  from positive_functions
), feature_gate as (
  select
    count(*) = 14 protected_function_count,
    bool_and(source like '%assert_effective_operational_feature%')
      all_positive_paths_gated,
    bool_and(source not like '%automation_runs_monthly%')
      no_monthly_rule_authority
  from function_sources
), helper_contract as (
  select
    p.oid is not null installed,
    coalesce(owner_role.rolname = 'postgres', false) postgres_owned,
    coalesce(p.prosecdef, false) security_definer,
    coalesce(p.provolatile = 's', false) stable,
    coalesce(
      p.proconfig && array['search_path=public', 'search_path=public, pg_temp'],
      false
    ) fixed_search_path,
    coalesce(
      position(
        'assert_tenant_operational_access' in
        lower(pg_get_functiondef(p.oid))
      ) < position(
        'resolve_effective_feature_access_authority' in
        lower(pg_get_functiondef(p.oid))
      ),
      false
    ) lifecycle_before_feature,
    coalesce(
      lower(pg_get_functiondef(p.oid)) like '%effective_status%included%',
      false
    ) included_only,
    coalesce(not has_function_privilege(
      'authenticated', p.oid, 'EXECUTE'
    ), false) authenticated_execute_denied,
    coalesce(not has_function_privilege('anon', p.oid, 'EXECUTE'), false)
      anon_execute_denied,
    coalesce(not has_function_privilege(
      'service_role', p.oid, 'EXECUTE'
    ), false) service_role_execute_denied,
    coalesce(not exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ), false) public_execute_denied
  from (values (to_regprocedure(
    'coachfort_internal.assert_effective_operational_feature(uuid,text)'
  ))) expected(oid)
  left join pg_proc p on p.oid = expected.oid
  left join pg_roles owner_role on owner_role.oid = p.proowner
), automation_exceptions as (
  select
    enable_source like
      '%if coalesce(p_enabled, false) then%assert_effective_operational_feature%'
      enable_requires_feature,
    position('assert_effective_operational_feature' in enable_source) <
      position('update public.automation_rules' in enable_source)
      enable_gate_before_update,
    delete_source not like '%assert_effective_operational_feature%'
      delete_allowed_without_feature,
    delete_source like '%m69_9_assert_automation_manager%'
      delete_role_authority_preserved,
    run_source like '%run_automation_trigger_unvalidated%'
      runner_preserved,
    position('assert_tenant_operational_access' in run_source) <
      position('assert_effective_operational_feature' in run_source)
      run_lifecycle_before_feature
  from (
    select
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'public.set_automation_rule_enabled_secure(uuid,uuid,boolean)'
      )), '[[:space:]]+', ' ', 'g')) enable_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'public.delete_automation_rule_secure(uuid,uuid)'
      )), '[[:space:]]+', ' ', 'g')) delete_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
      )), '[[:space:]]+', ' ', 'g')) run_source
  ) sources
), chat_contract as (
  select
    bool_and(source like '%assert_effective_operational_feature%messages%')
      all_chat_writes_gated,
    bool_and(position('assert_effective_operational_feature' in source) <
      least(
        coalesce(nullif(position('insert into' in source), 0), 2147483647),
        coalesce(nullif(position('update public.' in source), 0), 2147483647)
      )) feature_before_chat_mutation,
    bool_and(source like '%chat_%') chat_authority_preserved
  from function_sources
  where identity in (
    'public.create_student_direct_chat(uuid,uuid,text,text)',
    'public.create_student_support_thread(text,text)',
    'public.send_team_chat_message(uuid,text)',
    'public.send_student_chat_message(uuid,text)'
  )
), protected_rpc_acl as (
  select
    count(*) = 15 expected_count,
    bool_and(owner_role.rolname = 'postgres') postgres_owned,
    bool_and(p.prosecdef) security_definer,
    bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      authenticated_execute,
    bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
      anon_execute_denied,
    bool_and(not has_function_privilege('service_role', p.oid, 'EXECUTE'))
      service_role_execute_denied,
    bool_and(not exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) public_execute_denied
  from (values
    ('public.create_automation_rule_secure(uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.update_automation_rule_secure(uuid,uuid,text,text,text,text,text,jsonb,jsonb)'),
    ('public.set_automation_rule_enabled_secure(uuid,uuid,boolean)'),
    ('public.delete_automation_rule_secure(uuid,uuid)'),
    ('public.create_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.update_automation_condition_secure(uuid,uuid,text,text,jsonb,integer)'),
    ('public.delete_automation_condition_secure(uuid,uuid)'),
    ('public.create_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.update_automation_action_secure(uuid,uuid,text,jsonb,integer)'),
    ('public.delete_automation_action_secure(uuid,uuid)'),
    ('public.run_automation_trigger(uuid,text,text,uuid,jsonb)'),
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'),
    ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)')
  ) expected(identity)
  join pg_proc p on p.oid = to_regprocedure(expected.identity)
  join pg_roles owner_role on owner_role.oid = p.proowner
), browser_writes as (
  select count(*) = 0 no_browser_writes
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in (
      'automation_rules', 'automation_rule_conditions',
      'automation_rule_actions', 'automation_runs', 'automation_run_logs',
      'conversation_threads', 'conversation_participants',
      'conversation_messages'
    )
    and privilege.grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), protected_rows as (
  select jsonb_build_object(
    'automation_rules', (select count(*) from public.automation_rules),
    'automation_conditions',
      (select count(*) from public.automation_rule_conditions),
    'automation_actions',
      (select count(*) from public.automation_rule_actions),
    'automation_runs', (select count(*) from public.automation_runs),
    'automation_run_logs', (select count(*) from public.automation_run_logs),
    'conversation_threads', (select count(*) from public.conversation_threads),
    'conversation_participants',
      (select count(*) from public.conversation_participants),
    'conversation_messages', (select count(*) from public.conversation_messages),
    'subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments)
  ) counts
)
select
  jsonb_build_object(
    'feature_gate', to_jsonb(feature_gate),
    'helper_contract', to_jsonb(helper_contract),
    'automation_exceptions', to_jsonb(automation_exceptions),
    'chat_contract', to_jsonb(chat_contract),
    'protected_rpc_acl', to_jsonb(protected_rpc_acl),
    'browser_writes', to_jsonb(browser_writes),
    'protected_rows', protected_rows.counts
  ) verification,
  feature_gate.protected_function_count
    and feature_gate.all_positive_paths_gated
    and feature_gate.no_monthly_rule_authority
    and helper_contract.installed
    and helper_contract.postgres_owned
    and helper_contract.security_definer
    and helper_contract.stable
    and helper_contract.fixed_search_path
    and helper_contract.lifecycle_before_feature
    and helper_contract.included_only
    and helper_contract.authenticated_execute_denied
    and helper_contract.anon_execute_denied
    and helper_contract.service_role_execute_denied
    and helper_contract.public_execute_denied
    and automation_exceptions.enable_requires_feature
    and automation_exceptions.enable_gate_before_update
    and automation_exceptions.delete_allowed_without_feature
    and automation_exceptions.delete_role_authority_preserved
    and automation_exceptions.runner_preserved
    and automation_exceptions.run_lifecycle_before_feature
    and chat_contract.all_chat_writes_gated
    and chat_contract.feature_before_chat_mutation
    and chat_contract.chat_authority_preserved
    and protected_rpc_acl.expected_count
    and protected_rpc_acl.postgres_owned
    and protected_rpc_acl.security_definer
    and protected_rpc_acl.authenticated_execute
    and protected_rpc_acl.anon_execute_denied
    and protected_rpc_acl.service_role_execute_denied
    and protected_rpc_acl.public_execute_denied
    and browser_writes.no_browser_writes
    as security_gate
from feature_gate
cross join helper_contract
cross join automation_exceptions
cross join chat_contract
cross join protected_rpc_acl
cross join browser_writes
cross join protected_rows;
*/
