begin;

-- Module 69.9: Automation rule write consolidation.
-- This migration adds RPC-backed owner/admin write paths for automation
-- definitions. Existing direct table grants are intentionally not revoked here;
-- that can happen only after production confidence in the replacement paths.

create or replace function public.m69_9_current_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.m69_9_assert_automation_manager(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  v_role := public.m69_9_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can manage automation rules.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m69_9_safe_text(
  p_value text,
  p_field_name text,
  p_required boolean default false,
  p_max_length integer default 500
)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_required and v_value is null then
    raise exception '% is required.', p_field_name using errcode = '22023';
  end if;

  if v_value is not null and char_length(v_value) > p_max_length then
    raise exception '% is too long.', p_field_name using errcode = '22023';
  end if;

  if v_value is not null and v_value ~ '[<>]' then
    raise exception '% contains unsupported characters.', p_field_name using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_9_validate_trigger_type(p_trigger_type text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := lower(trim(coalesce(p_trigger_type, '')));
begin
  if v_value not in (
    'student_created',
    'payment_received',
    'payment_created',
    'assignment_overdue',
    'attendance_low',
    'session_scheduled',
    'trial_expiring',
    'certificate_issued',
    'enrollment_created',
    'course_completed'
  ) then
    raise exception 'Invalid automation trigger type.' using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_9_validate_action_type(p_action_type text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := lower(trim(coalesce(p_action_type, '')));
begin
  if v_value not in (
    'create_notification',
    'create_reminder',
    'send_email_placeholder',
    'send_whatsapp_placeholder',
    'add_internal_note',
    'generate_task_placeholder'
  ) then
    raise exception 'Invalid automation action type.' using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_9_validate_condition_type(p_condition_type text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := lower(trim(coalesce(p_condition_type, '')));
begin
  if v_value not in (
    'equals',
    'not_equals',
    'greater_than',
    'less_than',
    'contains',
    'date_before',
    'date_after'
  ) then
    raise exception 'Invalid automation condition type.' using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_9_validate_status(p_status text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := lower(trim(coalesce(p_status, 'draft')));
begin
  if v_value not in ('active', 'inactive', 'draft') then
    raise exception 'Invalid automation status.' using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_9_validate_execution_mode(p_execution_mode text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := lower(trim(coalesce(p_execution_mode, 'instant')));
begin
  if v_value not in ('instant', 'scheduled') then
    raise exception 'Invalid automation execution mode.' using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_9_sanitize_json_object(
  p_value jsonb,
  p_field_name text,
  p_max_size integer default 2500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value jsonb := coalesce(p_value, '{}'::jsonb);
  v_key text;
  v_blocked_pattern text :=
    '"(authorization|cookie|password|token|otp|code|service_role|servicerole|api_key|apikey|secret|signedurl|signed_url|storage_path|storagepath|storage_bucket|storagebucket|webhook_secret|webhooksecret)"[[:space:]]*:';
  v_blocked_keys text[] := array[
    'authorization',
    'cookie',
    'password',
    'token',
    'otp',
    'code',
    'service_role',
    'serviceRole',
    'api_key',
    'apiKey',
    'secret',
    'signedUrl',
    'signed_url',
    'storage_path',
    'storagePath',
    'storage_bucket',
    'storageBucket',
    'webhook_secret',
    'webhookSecret'
  ];
begin
  if jsonb_typeof(v_value) <> 'object' then
    raise exception '% must be a JSON object.', p_field_name using errcode = '22023';
  end if;

  foreach v_key in array v_blocked_keys loop
    v_value := v_value - v_key;
  end loop;

  if char_length(v_value::text) > p_max_size then
    raise exception '% is too large.', p_field_name using errcode = '22023';
  end if;

  if lower(v_value::text) ~ v_blocked_pattern then
    raise exception '% contains unsupported sensitive fields.', p_field_name using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_9_assert_rule_in_tenant(
  p_tenant_id uuid,
  p_rule_id uuid
)
returns public.automation_rules
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule public.automation_rules%rowtype;
begin
  select *
  into v_rule
  from public.automation_rules ar
  where ar.tenant_id = p_tenant_id
    and ar.id = p_rule_id;

  if not found then
    raise exception 'Automation rule was not found in this workspace.' using errcode = '22023';
  end if;

  return v_rule;
end;
$$;

create or replace function public.m69_9_write_audit(
  p_tenant_id uuid,
  p_action text,
  p_rule_id uuid,
  p_status text,
  p_trigger_type text default null,
  p_action_count integer default null,
  p_condition_count integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    entity_name,
    description,
    metadata,
    severity
  )
  values (
    p_tenant_id,
    auth.uid(),
    p_action,
    'automation',
    p_rule_id,
    'Automation rule',
    'Automation rule changed.',
    jsonb_strip_nulls(jsonb_build_object(
      'actionCount', p_action_count,
      'conditionCount', p_condition_count,
      'ruleId', p_rule_id,
      'status', p_status,
      'triggerType', p_trigger_type
    )),
    case when p_action = 'automation_deleted' then 'warning' else 'info' end
  );
end;
$$;

create or replace function public.m69_9_replace_rule_rows(
  p_tenant_id uuid,
  p_rule_id uuid,
  p_actions jsonb,
  p_conditions jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action jsonb;
  v_condition jsonb;
  v_index integer := 0;
  v_action_type text;
  v_condition_type text;
  v_operator text;
begin
  if p_actions is null or jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) < 1 then
    raise exception 'At least one automation action is required.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_actions) > 10 then
    raise exception 'Too many automation actions.' using errcode = '22023';
  end if;

  if p_conditions is not null and jsonb_typeof(p_conditions) <> 'array' then
    raise exception 'Automation conditions must be an array.' using errcode = '22023';
  end if;

  if coalesce(jsonb_array_length(coalesce(p_conditions, '[]'::jsonb)), 0) > 10 then
    raise exception 'Too many automation conditions.' using errcode = '22023';
  end if;

  delete from public.automation_rule_conditions arc
  where arc.tenant_id = p_tenant_id
    and arc.rule_id = p_rule_id;

  delete from public.automation_rule_actions ara
  where ara.tenant_id = p_tenant_id
    and ara.rule_id = p_rule_id;

  v_index := 0;
  for v_condition in
    select value from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb))
  loop
    if jsonb_typeof(v_condition) <> 'object' then
      raise exception 'Automation condition is invalid.' using errcode = '22023';
    end if;

    v_condition_type := public.m69_9_validate_condition_type(v_condition ->> 'condition_type');
    v_operator := public.m69_9_safe_text(
      coalesce(v_condition ->> 'operator', v_condition_type),
      'Condition operator',
      true,
      80
    );

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
      p_rule_id,
      v_condition_type,
      v_operator,
      public.m69_9_sanitize_json_object(coalesce(v_condition -> 'value_json', '{}'::jsonb), 'Condition payload', 1500),
      v_index
    );

    v_index := v_index + 1;
  end loop;

  v_index := 0;
  for v_action in
    select value from jsonb_array_elements(p_actions)
  loop
    if jsonb_typeof(v_action) <> 'object' then
      raise exception 'Automation action is invalid.' using errcode = '22023';
    end if;

    v_action_type := public.m69_9_validate_action_type(v_action ->> 'action_type');

    insert into public.automation_rule_actions (
      tenant_id,
      rule_id,
      action_type,
      config_json,
      sort_order
    )
    values (
      p_tenant_id,
      p_rule_id,
      v_action_type,
      public.m69_9_sanitize_json_object(coalesce(v_action -> 'config_json', '{}'::jsonb), 'Action payload', 2500),
      v_index
    );

    v_index := v_index + 1;
  end loop;
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

  v_name := public.m69_9_safe_text(p_name, 'Automation name', true, 160);
  v_description := public.m69_9_safe_text(p_description, 'Automation description', false, 1000);
  v_trigger_type := public.m69_9_validate_trigger_type(p_trigger_type);
  v_status := public.m69_9_validate_status(p_status);
  v_execution_mode := public.m69_9_validate_execution_mode(p_execution_mode);

  if p_actions is null or jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) < 1 then
    raise exception 'At least one automation action is required.' using errcode = '22023';
  end if;

  v_first_action := p_actions -> 0;
  v_first_action_type := public.m69_9_validate_action_type(v_first_action ->> 'action_type');
  v_first_config := public.m69_9_sanitize_json_object(coalesce(v_first_action -> 'config_json', '{}'::jsonb), 'Action payload', 2500);

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

  perform public.m69_9_replace_rule_rows(p_tenant_id, v_rule.id, p_actions, coalesce(p_conditions, '[]'::jsonb));

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

  v_name := public.m69_9_safe_text(p_name, 'Automation name', true, 160);
  v_description := public.m69_9_safe_text(p_description, 'Automation description', false, 1000);
  v_trigger_type := public.m69_9_validate_trigger_type(p_trigger_type);
  v_status := public.m69_9_validate_status(p_status);
  v_execution_mode := public.m69_9_validate_execution_mode(p_execution_mode);

  if p_actions is null or jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) < 1 then
    raise exception 'At least one automation action is required.' using errcode = '22023';
  end if;

  v_first_action := p_actions -> 0;
  v_first_action_type := public.m69_9_validate_action_type(v_first_action ->> 'action_type');
  v_first_config := public.m69_9_sanitize_json_object(coalesce(v_first_action -> 'config_json', '{}'::jsonb), 'Action payload', 2500);

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
    metadata_json = jsonb_build_object('engine', 'workflow_v1', 'source', 'secure_rpc')
  where ar.tenant_id = p_tenant_id
    and ar.id = v_existing.id
  returning * into v_rule;

  perform public.m69_9_replace_rule_rows(p_tenant_id, v_rule.id, p_actions, coalesce(p_conditions, '[]'::jsonb));

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
  v_status text := case when coalesce(p_enabled, false) then 'active' else 'inactive' end;
begin
  perform public.m69_9_assert_automation_manager(p_tenant_id);
  v_existing := public.m69_9_assert_rule_in_tenant(p_tenant_id, p_rule_id);

  update public.automation_rules ar
  set
    is_active = coalesce(p_enabled, false),
    status = v_status
  where ar.tenant_id = p_tenant_id
    and ar.id = v_existing.id
  returning * into v_rule;

  perform public.m69_9_write_audit(
    p_tenant_id,
    case when v_status = 'active' then 'automation_enabled' else 'automation_disabled' end,
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
    public.m69_9_safe_text(coalesce(p_operator, v_condition_type), 'Condition operator', true, 80),
    public.m69_9_sanitize_json_object(p_value_json, 'Condition payload', 1500),
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
  v_condition_type := public.m69_9_validate_condition_type(p_condition_type);

  update public.automation_rule_conditions arc
  set
    condition_type = v_condition_type,
    operator = public.m69_9_safe_text(coalesce(p_operator, v_condition_type), 'Condition operator', true, 80),
    value_json = public.m69_9_sanitize_json_object(p_value_json, 'Condition payload', 1500),
    sort_order = greatest(coalesce(p_sort_order, 0), 0)
  where arc.tenant_id = p_tenant_id
    and arc.id = p_condition_id
  returning * into v_condition;

  if not found then
    raise exception 'Automation condition was not found in this workspace.' using errcode = '22023';
  end if;

  perform public.m69_9_assert_rule_in_tenant(p_tenant_id, v_condition.rule_id);
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
    raise exception 'Automation condition was not found in this workspace.' using errcode = '22023';
  end if;

  perform public.m69_9_assert_rule_in_tenant(p_tenant_id, v_condition.rule_id);

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
    public.m69_9_sanitize_json_object(p_config_json, 'Action payload', 2500),
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

  update public.automation_rule_actions ara
  set
    action_type = public.m69_9_validate_action_type(p_action_type),
    config_json = public.m69_9_sanitize_json_object(p_config_json, 'Action payload', 2500),
    sort_order = greatest(coalesce(p_sort_order, 0), 0)
  where ara.tenant_id = p_tenant_id
    and ara.id = p_action_id
  returning * into v_action;

  if not found then
    raise exception 'Automation action was not found in this workspace.' using errcode = '22023';
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
    raise exception 'Automation action was not found in this workspace.' using errcode = '22023';
  end if;

  perform public.m69_9_assert_rule_in_tenant(p_tenant_id, v_action.rule_id);

  delete from public.automation_rule_actions ara
  where ara.tenant_id = p_tenant_id
    and ara.id = v_action.id;

  return v_action.id;
end;
$$;

revoke execute on function public.m69_9_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_9_assert_automation_manager(uuid) from public, anon, authenticated;
revoke execute on function public.m69_9_safe_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.m69_9_validate_trigger_type(text) from public, anon, authenticated;
revoke execute on function public.m69_9_validate_action_type(text) from public, anon, authenticated;
revoke execute on function public.m69_9_validate_condition_type(text) from public, anon, authenticated;
revoke execute on function public.m69_9_validate_status(text) from public, anon, authenticated;
revoke execute on function public.m69_9_validate_execution_mode(text) from public, anon, authenticated;
revoke execute on function public.m69_9_sanitize_json_object(jsonb, text, integer) from public, anon, authenticated;
revoke execute on function public.m69_9_assert_rule_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_9_write_audit(uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.m69_9_replace_rule_rows(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

revoke execute on function public.create_automation_rule_secure(uuid, text, text, text, text, text, jsonb, jsonb) from public, anon;
revoke execute on function public.update_automation_rule_secure(uuid, uuid, text, text, text, text, text, jsonb, jsonb) from public, anon;
revoke execute on function public.set_automation_rule_enabled_secure(uuid, uuid, boolean) from public, anon;
revoke execute on function public.delete_automation_rule_secure(uuid, uuid) from public, anon;
revoke execute on function public.create_automation_condition_secure(uuid, uuid, text, text, jsonb, integer) from public, anon;
revoke execute on function public.update_automation_condition_secure(uuid, uuid, text, text, jsonb, integer) from public, anon;
revoke execute on function public.delete_automation_condition_secure(uuid, uuid) from public, anon;
revoke execute on function public.create_automation_action_secure(uuid, uuid, text, jsonb, integer) from public, anon;
revoke execute on function public.update_automation_action_secure(uuid, uuid, text, jsonb, integer) from public, anon;
revoke execute on function public.delete_automation_action_secure(uuid, uuid) from public, anon;

grant execute on function public.create_automation_rule_secure(uuid, text, text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.update_automation_rule_secure(uuid, uuid, text, text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.set_automation_rule_enabled_secure(uuid, uuid, boolean) to authenticated;
grant execute on function public.delete_automation_rule_secure(uuid, uuid) to authenticated;
grant execute on function public.create_automation_condition_secure(uuid, uuid, text, text, jsonb, integer) to authenticated;
grant execute on function public.update_automation_condition_secure(uuid, uuid, text, text, jsonb, integer) to authenticated;
grant execute on function public.delete_automation_condition_secure(uuid, uuid) to authenticated;
grant execute on function public.create_automation_action_secure(uuid, uuid, text, jsonb, integer) to authenticated;
grant execute on function public.update_automation_action_secure(uuid, uuid, text, jsonb, integer) to authenticated;
grant execute on function public.delete_automation_action_secure(uuid, uuid) to authenticated;

-- Keep the Module 42.3 execution boundary intact.
revoke execute on function public.run_automation_trigger_unvalidated(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.run_automation_trigger(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.run_automation_trigger(uuid, text, text, uuid, jsonb) to authenticated;

-- Cleanup for the single Module 69.9 backend-smoke run-forgery probe.
-- This is intentionally constrained to the generated smoke workspace slug and
-- marker metadata so it cannot match real production automation runs.
delete from public.automation_run_logs arl
using public.automation_runs ar, public.tenants t
where arl.run_id = ar.id
  and ar.tenant_id = t.id
  and t.slug = 'm69-9-smoke-1782971389915-17359ebf'
  and ar.metadata_json ->> 'smoke' = 'm69_9_smoke_1782971389915_17359ebf';

delete from public.automation_runs ar
using public.tenants t
where ar.tenant_id = t.id
  and t.slug = 'm69-9-smoke-1782971389915-17359ebf'
  and ar.metadata_json ->> 'smoke' = 'm69_9_smoke_1782971389915_17359ebf';

-- Ordinary authenticated clients must not be able to forge automation runner
-- state. Automation run/log writes remain available only through trusted
-- SECURITY DEFINER trigger execution or server-side service-role code.
revoke insert, update, delete on table public.automation_runs from anon, authenticated;
revoke insert, update, delete on table public.automation_run_logs from anon, authenticated;

commit;
