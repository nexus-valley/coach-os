begin;

-- Module 70.3A: Backup export log hardening.
-- Existing direct backup_export_logs table grants are intentionally left in
-- place for this module. Direct grants should be considered for revocation
-- only after this RPC-backed path has backend and production smoke confidence.

create or replace function public.m70_3a_current_role(p_tenant_id uuid)
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

create or replace function public.m70_3a_assert_backup_export_role(p_tenant_id uuid)
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

  v_role := public.m70_3a_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'Backup export logging is available to owners and admins only.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m70_3a_validate_export_type(p_export_type text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_export_type is null or p_export_type not in (
    'students',
    'courses',
    'cohorts',
    'enrollments',
    'sessions',
    'attendance',
    'assignments',
    'payments',
    'certificates'
  ) then
    raise exception 'Select a valid backup export type.' using errcode = '22023';
  end if;

  return p_export_type;
end;
$$;

create or replace function public.m70_3a_validate_export_status(p_status text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('started', 'completed', 'failed') then
    raise exception 'Select a valid backup export status.' using errcode = '22023';
  end if;

  return p_status;
end;
$$;

create or replace function public.m70_3a_sanitize_metadata(p_metadata jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_key text;
  v_blocked_keys text[] := array[
    'authorization',
    'cookie',
    'password',
    'token',
    'otp',
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
    'webhookSecret',
    'stack',
    'stackTrace',
    'error',
    'message',
    'notes',
    'description',
    'email',
    'phone',
    'full_name',
    'fullName'
  ];
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Metadata must be an object.' using errcode = '22023';
  end if;

  if pg_column_size(v_metadata) > 4096 then
    raise exception 'Metadata is too large.' using errcode = '22023';
  end if;

  foreach v_key in array v_blocked_keys loop
    v_metadata := v_metadata - v_key;
  end loop;

  if lower(v_metadata::text) ~ '(authorization|cookie|password|token|otp|service[_-]?role|api[_-]?key|secret|signed[_-]?url|storage[_-]?path|storage[_-]?bucket|webhook[_-]?secret)' then
    raise exception 'Backup export metadata contains unsupported sensitive fields.' using errcode = '22023';
  end if;

  if pg_column_size(v_metadata) > 2048 then
    raise exception 'Metadata is too large.' using errcode = '22023';
  end if;

  return v_metadata;
end;
$$;

create or replace function public.record_backup_export_log_secure(
  p_tenant_id uuid,
  p_export_type text,
  p_status text,
  p_row_count integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.backup_export_logs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_log public.backup_export_logs%rowtype;
  v_export_type text := public.m70_3a_validate_export_type(p_export_type);
  v_status text := public.m70_3a_validate_export_status(p_status);
begin
  perform public.m70_3a_assert_backup_export_role(p_tenant_id);

  if p_row_count is not null and p_row_count < 0 then
    raise exception 'Row count must be zero or greater.' using errcode = '22023';
  end if;

  insert into public.backup_export_logs (
    completed_at,
    export_type,
    metadata_json,
    requested_by,
    row_count,
    status,
    tenant_id
  )
  values (
    case when v_status in ('completed', 'failed') then now() else null end,
    v_export_type,
    public.m70_3a_sanitize_metadata(p_metadata),
    auth.uid(),
    p_row_count,
    v_status,
    p_tenant_id
  )
  returning * into v_log;

  return v_log;
end;
$$;

revoke execute on function public.m70_3a_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m70_3a_assert_backup_export_role(uuid) from public, anon, authenticated;
revoke execute on function public.m70_3a_validate_export_type(text) from public, anon, authenticated;
revoke execute on function public.m70_3a_validate_export_status(text) from public, anon, authenticated;
revoke execute on function public.m70_3a_sanitize_metadata(jsonb) from public, anon, authenticated;

revoke execute on function public.record_backup_export_log_secure(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function public.record_backup_export_log_secure(uuid, text, text, integer, jsonb) to authenticated;

commit;
