-- Module 62: Feature Access & Module Toggle System
-- Review before execution. Do not execute automatically.

begin;

create table if not exists public.tenant_feature_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null,
  status text not null default 'enabled',
  source text not null default 'manual',
  configured_by uuid references auth.users(id) on delete set null,
  configured_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key),
  constraint tenant_feature_settings_feature_key_check check (
    feature_key in (
      'dashboard',
      'students',
      'courses',
      'attendance',
      'assignments',
      'finance',
      'reports',
      'documents',
      'document_uploads',
      'messages',
      'crm',
      'marketing',
      'automations',
      'workflows',
      'approvals',
      'team_operations',
      'audit_compliance',
      'backup_recovery',
      'website_builder',
      'certificates',
      'payment_gateway',
      'live_classes',
      'notifications',
      'mobile_pwa'
    )
  ),
  constraint tenant_feature_settings_status_check check (
    status in ('enabled', 'disabled', 'locked_by_plan', 'coming_soon')
  ),
  constraint tenant_feature_settings_source_check check (
    source in ('manual', 'plan', 'system')
  ),
  constraint tenant_feature_settings_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table if not exists public.tenant_feature_activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text,
  source text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tenant_feature_activity_logs_feature_key_check check (
    feature_key in (
      'dashboard',
      'students',
      'courses',
      'attendance',
      'assignments',
      'finance',
      'reports',
      'documents',
      'document_uploads',
      'messages',
      'crm',
      'marketing',
      'automations',
      'workflows',
      'approvals',
      'team_operations',
      'audit_compliance',
      'backup_recovery',
      'website_builder',
      'certificates',
      'payment_gateway',
      'live_classes',
      'notifications',
      'mobile_pwa'
    )
  ),
  constraint tenant_feature_activity_logs_action_check check (
    action in (
      'tenant_feature_updated',
      'tenant_feature_bulk_updated',
      'tenant_feature_plan_locked',
      'tenant_feature_system_initialized'
    )
  ),
  constraint tenant_feature_activity_logs_status_check check (
    old_status is null or old_status in ('enabled', 'disabled', 'locked_by_plan', 'coming_soon')
  ),
  constraint tenant_feature_activity_logs_new_status_check check (
    new_status is null or new_status in ('enabled', 'disabled', 'locked_by_plan', 'coming_soon')
  ),
  constraint tenant_feature_activity_logs_source_check check (
    source is null or source in ('manual', 'plan', 'system')
  ),
  constraint tenant_feature_activity_logs_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create index if not exists tenant_feature_settings_tenant_idx
  on public.tenant_feature_settings (tenant_id);

create index if not exists tenant_feature_settings_feature_idx
  on public.tenant_feature_settings (feature_key, status);

create index if not exists tenant_feature_activity_logs_tenant_idx
  on public.tenant_feature_activity_logs (tenant_id, created_at desc);

create index if not exists tenant_feature_activity_logs_feature_idx
  on public.tenant_feature_activity_logs (tenant_id, feature_key, created_at desc);

drop trigger if exists set_tenant_feature_settings_updated_at on public.tenant_feature_settings;
create trigger set_tenant_feature_settings_updated_at
  before update on public.tenant_feature_settings
  for each row execute function public.set_updated_at();

alter table public.tenant_feature_settings enable row level security;
alter table public.tenant_feature_activity_logs enable row level security;

revoke all on public.tenant_feature_settings from anon;
revoke all on public.tenant_feature_activity_logs from anon;
revoke insert, update, delete on public.tenant_feature_settings from authenticated;
revoke insert, update, delete on public.tenant_feature_activity_logs from authenticated;
grant select on public.tenant_feature_settings to authenticated;
grant select on public.tenant_feature_activity_logs to authenticated;

drop policy if exists "tenant feature settings owner admin select" on public.tenant_feature_settings;
create policy "tenant feature settings owner admin select"
  on public.tenant_feature_settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = tenant_feature_settings.tenant_id
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
    or public.is_platform_admin()
  );

drop policy if exists "tenant feature activity owner admin select" on public.tenant_feature_activity_logs;
create policy "tenant feature activity owner admin select"
  on public.tenant_feature_activity_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = tenant_feature_activity_logs.tenant_id
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
    or public.is_platform_admin()
  );

create or replace function public.feature_access_allowed_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'dashboard',
    'students',
    'courses',
    'attendance',
    'assignments',
    'finance',
    'reports',
    'documents',
    'document_uploads',
    'messages',
    'crm',
    'marketing',
    'automations',
    'workflows',
    'approvals',
    'team_operations',
    'audit_compliance',
    'backup_recovery',
    'website_builder',
    'certificates',
    'payment_gateway',
    'live_classes',
    'notifications',
    'mobile_pwa'
  ]::text[];
$$;

create or replace function public.feature_access_statuses()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['enabled', 'disabled', 'locked_by_plan', 'coming_soon']::text[];
$$;

create or replace function public.feature_access_core_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['dashboard', 'students', 'courses']::text[];
$$;

create or replace function public.feature_access_default_status(p_feature_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := lower(trim(coalesce(p_feature_key, '')));
begin
  if v_key = any (public.feature_access_core_keys()) then
    return 'enabled';
  end if;

  if v_key in ('document_uploads', 'payment_gateway', 'live_classes') then
    return 'coming_soon';
  end if;

  if v_key = any (public.feature_access_allowed_keys()) then
    return 'enabled';
  end if;

  raise exception 'Invalid feature key.' using errcode = '22023';
end;
$$;

create or replace function public.feature_access_current_role(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_tenant_id is null or auth.uid() is null then
    return null;
  end if;

  select tm.role
  into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = auth.uid()
  limit 1;

  return v_role;
end;
$$;

create or replace function public.feature_access_is_owner_admin(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.feature_access_current_role(p_tenant_id);
  return coalesce(v_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.feature_access_is_team_member(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.feature_access_current_role(p_tenant_id);
  return coalesce(v_role in ('owner', 'admin', 'staff', 'trainer'), false);
end;
$$;

create or replace function public.feature_access_platform_can_manage()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return false;
  end if;

  v_role := public.platform_current_role();
  return coalesce(v_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.feature_access_assert_can_manage(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;

  if public.feature_access_is_owner_admin(p_tenant_id) then
    return;
  end if;

  if public.feature_access_platform_can_manage() then
    return;
  end if;

  raise exception 'Feature settings can be managed only by tenant owners/admins.' using errcode = '42501';
end;
$$;

create or replace function public.feature_access_normalize_feature_key(p_feature_key text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text := lower(trim(coalesce(p_feature_key, '')));
begin
  if v_key = '' or not (v_key = any (public.feature_access_allowed_keys())) then
    raise exception 'Invalid feature key.' using errcode = '22023';
  end if;

  return v_key;
end;
$$;

create or replace function public.feature_access_normalize_status(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_status = '' or not (v_status = any (public.feature_access_statuses())) then
    raise exception 'Invalid feature status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.feature_access_effective_rows(p_tenant_id uuid)
returns table (
  feature_key text,
  status text,
  source text,
  configured_by uuid,
  configured_at timestamptz,
  metadata_json jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    key_name as feature_key,
    coalesce(tfs.status, public.feature_access_default_status(key_name)) as status,
    coalesce(tfs.source, 'system') as source,
    tfs.configured_by,
    tfs.configured_at,
    coalesce(tfs.metadata_json, '{}'::jsonb) as metadata_json,
    tfs.updated_at
  from unnest(public.feature_access_allowed_keys()) as key_name
  left join public.tenant_feature_settings tfs
    on tfs.tenant_id = p_tenant_id
   and tfs.feature_key = key_name;
$$;

create or replace function public.feature_access_write_activity(
  p_tenant_id uuid,
  p_feature_key text,
  p_action text,
  p_old_status text,
  p_new_status text,
  p_source text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_actor uuid := auth.uid();
begin
  if jsonb_typeof(v_metadata) <> 'object' or char_length(v_metadata::text) > 3000 then
    raise exception 'Feature activity metadata is invalid.' using errcode = '22023';
  end if;

  insert into public.tenant_feature_activity_logs (
    tenant_id,
    feature_key,
    action,
    actor_id,
    old_status,
    new_status,
    source,
    metadata_json
  )
  values (
    p_tenant_id,
    p_feature_key,
    p_action,
    v_actor,
    p_old_status,
    p_new_status,
    p_source,
    v_metadata
  );

  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    entity_name,
    description,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    v_actor,
    p_action,
    'tenant_feature_settings',
    p_tenant_id,
    'Feature Access',
    'Tenant feature access setting changed.',
    'info',
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'feature_key', p_feature_key,
      'old_status', p_old_status,
      'new_status', p_new_status,
      'source', p_source
    ) || v_metadata
  );
end;
$$;

create or replace function public.get_tenant_feature_access(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_tenant_id is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;

  v_role := public.feature_access_current_role(p_tenant_id);

  if not coalesce(v_role in ('owner', 'admin', 'staff', 'trainer'), false)
     and not public.is_platform_admin() then
    raise exception 'Feature access is not available for this user.' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'tenant_id', p_tenant_id,
      'role', v_role,
      'can_manage', coalesce(v_role in ('owner', 'admin'), false) or public.feature_access_platform_can_manage(),
      'features', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'feature_key', fer.feature_key,
            'status', fer.status,
            'source', fer.source,
            'configured_at', fer.configured_at,
            'updated_at', fer.updated_at
          )
          order by fer.feature_key
        ),
        '[]'::jsonb
      )
    )
    from public.feature_access_effective_rows(p_tenant_id) fer
  );
end;
$$;

create or replace function public.get_effective_feature_access(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_tenant_feature_access(p_tenant_id);
$$;

create or replace function public.get_portal_feature_access(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_student boolean := false;
  v_has_team boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;

  v_has_team := public.feature_access_is_team_member(p_tenant_id);

  select exists (
    select 1
    from public.student_portal_accounts spa
    where spa.tenant_id = p_tenant_id
      and spa.user_id = auth.uid()
      and spa.status = 'active'
  )
  into v_has_student;

  if not coalesce(v_has_student, false)
     and not coalesce(v_has_team, false)
     and not public.is_platform_admin() then
    raise exception 'Portal feature access is not available for this user.' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'tenant_id', p_tenant_id,
      'features', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'feature_key', fer.feature_key,
            'status', fer.status,
            'source', fer.source
          )
          order by fer.feature_key
        ),
        '[]'::jsonb
      )
    )
    from public.feature_access_effective_rows(p_tenant_id) fer
    where fer.feature_key in (
      'courses',
      'attendance',
      'assignments',
      'finance',
      'documents',
      'messages',
      'certificates',
      'notifications',
      'mobile_pwa'
    )
  );
end;
$$;

create or replace function public.update_tenant_feature_access(
  p_tenant_id uuid,
  p_feature_key text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_key text;
  v_status text;
  v_old_status text;
  v_source text := 'manual';
  v_is_platform_manager boolean;
begin
  perform public.feature_access_assert_can_manage(p_tenant_id);

  v_feature_key := public.feature_access_normalize_feature_key(p_feature_key);
  v_status := public.feature_access_normalize_status(p_status);
  v_is_platform_manager := public.feature_access_platform_can_manage();

  if v_feature_key = any (public.feature_access_core_keys()) and v_status <> 'enabled' then
    raise exception 'Core workspace features cannot be disabled.' using errcode = '22023';
  end if;

  if v_status = 'locked_by_plan' and not v_is_platform_manager then
    raise exception 'Only platform owners/admins can lock features by plan.' using errcode = '42501';
  end if;

  if v_status = 'locked_by_plan' then
    v_source := 'plan';
  elsif v_status = 'coming_soon' then
    v_source := 'system';
  end if;

  select coalesce(tfs.status, public.feature_access_default_status(v_feature_key))
  into v_old_status
  from (select 1) anchor
  left join public.tenant_feature_settings tfs
    on tfs.tenant_id = p_tenant_id
   and tfs.feature_key = v_feature_key;

  insert into public.tenant_feature_settings (
    tenant_id,
    feature_key,
    status,
    source,
    configured_by,
    configured_at,
    metadata_json
  )
  values (
    p_tenant_id,
    v_feature_key,
    v_status,
    v_source,
    auth.uid(),
    now(),
    '{}'::jsonb
  )
  on conflict (tenant_id, feature_key) do update
  set status = excluded.status,
      source = excluded.source,
      configured_by = excluded.configured_by,
      configured_at = excluded.configured_at,
      updated_at = now();

  perform public.feature_access_write_activity(
    p_tenant_id,
    v_feature_key,
    'tenant_feature_updated',
    v_old_status,
    v_status,
    v_source,
    jsonb_build_object('bulk', false)
  );

  return public.get_tenant_feature_access(p_tenant_id);
end;
$$;

create or replace function public.bulk_update_tenant_feature_access(
  p_tenant_id uuid,
  p_features jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_feature_key text;
  v_status text;
  v_old_status text;
  v_source text;
  v_is_platform_manager boolean;
begin
  perform public.feature_access_assert_can_manage(p_tenant_id);

  if p_features is null
     or jsonb_typeof(p_features) <> 'object'
     or char_length(p_features::text) > 5000 then
    raise exception 'Feature update payload is invalid.' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_object_keys(p_features)) > 100 then
    raise exception 'Feature update payload is too large.' using errcode = '22023';
  end if;

  v_is_platform_manager := public.feature_access_platform_can_manage();

  for v_entry in
    select key, value
    from jsonb_each_text(p_features)
  loop
    v_feature_key := public.feature_access_normalize_feature_key(v_entry.key);
    v_status := public.feature_access_normalize_status(v_entry.value);
    v_source := 'manual';

    if v_feature_key = any (public.feature_access_core_keys()) and v_status <> 'enabled' then
      raise exception 'Core workspace features cannot be disabled.' using errcode = '22023';
    end if;

    if v_status = 'locked_by_plan' and not v_is_platform_manager then
      raise exception 'Only platform owners/admins can lock features by plan.' using errcode = '42501';
    end if;

    if v_status = 'locked_by_plan' then
      v_source := 'plan';
    elsif v_status = 'coming_soon' then
      v_source := 'system';
    end if;

    select coalesce(tfs.status, public.feature_access_default_status(v_feature_key))
    into v_old_status
    from (select 1) anchor
    left join public.tenant_feature_settings tfs
      on tfs.tenant_id = p_tenant_id
     and tfs.feature_key = v_feature_key;

    insert into public.tenant_feature_settings (
      tenant_id,
      feature_key,
      status,
      source,
      configured_by,
      configured_at,
      metadata_json
    )
    values (
      p_tenant_id,
      v_feature_key,
      v_status,
      v_source,
      auth.uid(),
      now(),
      '{}'::jsonb
    )
    on conflict (tenant_id, feature_key) do update
    set status = excluded.status,
        source = excluded.source,
        configured_by = excluded.configured_by,
        configured_at = excluded.configured_at,
        updated_at = now();

    perform public.feature_access_write_activity(
      p_tenant_id,
      v_feature_key,
      'tenant_feature_bulk_updated',
      v_old_status,
      v_status,
      v_source,
      jsonb_build_object('bulk', true)
    );
  end loop;

  return public.get_tenant_feature_access(p_tenant_id);
end;
$$;

revoke all on function public.feature_access_allowed_keys() from public, anon, authenticated;
revoke all on function public.feature_access_statuses() from public, anon, authenticated;
revoke all on function public.feature_access_core_keys() from public, anon, authenticated;
revoke all on function public.feature_access_default_status(text) from public, anon, authenticated;
revoke all on function public.feature_access_current_role(uuid) from public, anon, authenticated;
revoke all on function public.feature_access_is_owner_admin(uuid) from public, anon, authenticated;
revoke all on function public.feature_access_is_team_member(uuid) from public, anon, authenticated;
revoke all on function public.feature_access_platform_can_manage() from public, anon, authenticated;
revoke all on function public.feature_access_assert_can_manage(uuid) from public, anon, authenticated;
revoke all on function public.feature_access_normalize_feature_key(text) from public, anon, authenticated;
revoke all on function public.feature_access_normalize_status(text) from public, anon, authenticated;
revoke all on function public.feature_access_effective_rows(uuid) from public, anon, authenticated;
revoke all on function public.feature_access_write_activity(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.get_tenant_feature_access(uuid) to authenticated;
grant execute on function public.get_effective_feature_access(uuid) to authenticated;
grant execute on function public.get_portal_feature_access(uuid) to authenticated;
grant execute on function public.update_tenant_feature_access(uuid, text, text) to authenticated;
grant execute on function public.bulk_update_tenant_feature_access(uuid, jsonb) to authenticated;

commit;
