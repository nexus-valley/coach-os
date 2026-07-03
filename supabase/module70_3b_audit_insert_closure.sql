begin;

-- Module 70.3B: Audit Insert Closure.
-- Closes the remaining assistant direct insert path into audit_logs by adding
-- a narrow SECURITY DEFINER RPC. audit_logs table grants are intentionally not
-- revoked in this module; direct grants can be reviewed in a later revoke wave
-- after backend and production smoke confidence.

create or replace function public.m70_3b_current_role(p_tenant_id uuid)
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
  limit 1
$$;

create or replace function public.m70_3b_assert_team_member(p_tenant_id uuid)
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
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  v_role := public.m70_3b_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'Team assistant audit is available to workspace members only.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m70_3b_validate_assistant_provider(p_provider text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_provider text := lower(nullif(trim(coalesce(p_provider, '')), ''));
begin
  if v_provider is null then
    return 'mock';
  end if;

  if v_provider not in ('mock') then
    raise exception 'Assistant provider is not supported for audit logging.' using errcode = '22023';
  end if;

  return v_provider;
end;
$$;

create or replace function public.m70_3b_validate_assistant_status(p_status text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
begin
  if v_status is null or v_status not in ('success', 'failed', 'blocked') then
    raise exception 'Assistant audit status is not supported.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m70_3b_message_length_bucket(p_message_length integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_message_length is null or p_message_length < 0 or p_message_length > 2000 then
    raise exception 'Assistant message length is invalid.' using errcode = '22023';
  end if;

  if p_message_length = 0 then
    return 'empty';
  elsif p_message_length <= 250 then
    return 'short';
  elsif p_message_length <= 1000 then
    return 'medium';
  end if;

  return 'long';
end;
$$;

create or replace function public.record_ai_assistant_audit_secure(
  p_tenant_id uuid,
  p_scope text,
  p_status text,
  p_provider text,
  p_message_length integer
)
returns public.audit_logs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_log public.audit_logs%rowtype;
  v_role text;
  v_status text := public.m70_3b_validate_assistant_status(p_status);
  v_provider text := public.m70_3b_validate_assistant_provider(p_provider);
  v_length_bucket text := public.m70_3b_message_length_bucket(p_message_length);
begin
  if p_scope is null or p_scope <> 'team' then
    raise exception 'Assistant audit scope is not supported.' using errcode = '22023';
  end if;

  v_role := public.m70_3b_assert_team_member(p_tenant_id);

  insert into public.audit_logs (
    action,
    description,
    entity_id,
    entity_name,
    entity_type,
    metadata,
    severity,
    tenant_id,
    user_email,
    user_id,
    user_name
  )
  values (
    'ai_assistant_used',
    'AI assistant request processed.',
    null,
    null,
    'assistant',
    jsonb_build_object(
      'eventType', 'ai_assistant_used',
      'messageLengthBucket', v_length_bucket,
      'provider', v_provider,
      'role', v_role,
      'scope', 'team',
      'status', v_status
    ),
    'info',
    p_tenant_id,
    null,
    auth.uid(),
    'Workspace user'
  )
  returning * into v_log;

  return v_log;
end;
$$;

revoke execute on function public.m70_3b_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m70_3b_assert_team_member(uuid) from public, anon, authenticated;
revoke execute on function public.m70_3b_validate_assistant_provider(text) from public, anon, authenticated;
revoke execute on function public.m70_3b_validate_assistant_status(text) from public, anon, authenticated;
revoke execute on function public.m70_3b_message_length_bucket(integer) from public, anon, authenticated;

revoke execute on function public.record_ai_assistant_audit_secure(uuid, text, text, text, integer) from public, anon;
grant execute on function public.record_ai_assistant_audit_secure(uuid, text, text, text, integer) to authenticated;

commit;
