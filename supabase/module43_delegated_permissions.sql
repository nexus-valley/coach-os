-- Module 43: Delegated permissions and exception management
-- Additive only. Run after the core tenant/member RBAC modules.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.delegated_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null check (
    permission_key in (
      'view_payments',
      'manage_payments',
      'view_reports',
      'manage_sessions',
      'edit_attendance',
      'edit_attendance_after_lock',
      'manage_assignments',
      'review_assignments',
      'issue_certificates',
      'manage_students',
      'manage_courses',
      'manage_cohorts',
      'manage_messages',
      'manage_notifications',
      'manage_automations_readonly'
    )
  ),
  scope_type text check (
    scope_type is null
    or scope_type in (
      'workspace',
      'course',
      'cohort',
      'student',
      'session',
      'assignment'
    )
  ),
  scope_id uuid,
  status text not null default 'active' check (
    status in ('pending', 'active', 'expired', 'revoked')
  ),
  reason text,
  granted_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delegated_permissions_scope_id_required check (
    (
      scope_type is null
      and scope_id is null
    )
    or (
      scope_type = 'workspace'
      and scope_id is null
    )
    or (
      scope_type in ('course', 'cohort', 'student', 'session', 'assignment')
      and scope_id is not null
    )
  ),
  constraint delegated_permissions_expiry_after_start check (
    expires_at is null or expires_at > starts_at
  )
);

create index if not exists delegated_permissions_tenant_id_idx
on public.delegated_permissions (tenant_id);

create index if not exists delegated_permissions_tenant_user_idx
on public.delegated_permissions (tenant_id, user_id);

create index if not exists delegated_permissions_tenant_permission_idx
on public.delegated_permissions (tenant_id, permission_key);

create index if not exists delegated_permissions_tenant_status_idx
on public.delegated_permissions (tenant_id, status);

create index if not exists delegated_permissions_tenant_expires_at_idx
on public.delegated_permissions (tenant_id, expires_at);

create index if not exists delegated_permissions_scope_idx
on public.delegated_permissions (tenant_id, scope_type, scope_id);

create index if not exists delegated_permissions_active_lookup_idx
on public.delegated_permissions (
  tenant_id,
  user_id,
  permission_key,
  status,
  starts_at,
  expires_at
);

drop trigger if exists set_delegated_permissions_updated_at
on public.delegated_permissions;
create trigger set_delegated_permissions_updated_at
before update on public.delegated_permissions
for each row execute function public.set_updated_at();

alter table public.delegated_permissions enable row level security;

grant select, insert, update, delete on public.delegated_permissions to authenticated;

create or replace function public.delegated_permission_scope_is_valid(
  check_tenant_id uuid,
  check_scope_type text,
  check_scope_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.is_tenant_member(check_tenant_id, auth.uid()) then
    return false;
  end if;

  if check_scope_type is null then
    return check_scope_id is null;
  end if;

  if check_scope_type = 'workspace' then
    return check_scope_id is null;
  end if;

  if check_scope_id is null then
    return false;
  end if;

  if check_scope_type not in (
    'course',
    'cohort',
    'student',
    'session',
    'assignment'
  ) then
    return false;
  end if;

  if check_scope_type = 'course' then
    return exists (
      select 1
      from public.courses c
      where c.id = check_scope_id
        and c.tenant_id = check_tenant_id
    );
  end if;

  if check_scope_type = 'cohort' then
    return exists (
      select 1
      from public.cohorts c
      where c.id = check_scope_id
        and c.tenant_id = check_tenant_id
    );
  end if;

  if check_scope_type = 'student' then
    return exists (
      select 1
      from public.students s
      where s.id = check_scope_id
        and s.tenant_id = check_tenant_id
    );
  end if;

  if check_scope_type = 'session' then
    return exists (
      select 1
      from public.sessions s
      where s.id = check_scope_id
        and s.tenant_id = check_tenant_id
    );
  end if;

  if check_scope_type = 'assignment' then
    return exists (
      select 1
      from public.assignments a
      where a.id = check_scope_id
        and a.tenant_id = check_tenant_id
    );
  end if;

  return false;
end;
$$;

revoke execute on function public.delegated_permission_scope_is_valid(uuid, text, uuid) from public;
grant execute on function public.delegated_permission_scope_is_valid(uuid, text, uuid) to authenticated;

drop policy if exists "Owner and admin can read delegated permissions"
on public.delegated_permissions;
create policy "Owner and admin can read delegated permissions"
on public.delegated_permissions
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Users can read own active delegated permissions"
on public.delegated_permissions;
create policy "Users can read own active delegated permissions"
on public.delegated_permissions
for select
to authenticated
using (
  user_id = auth.uid()
  and status = 'active'
  and starts_at <= now()
  and (expires_at is null or expires_at > now())
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Owner can create active delegated permissions"
on public.delegated_permissions;
create policy "Owner can create active delegated permissions"
on public.delegated_permissions
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner'])
  and granted_by = auth.uid()
  and status in ('active', 'pending')
  and (expires_at is null or expires_at > now())
  and public.delegated_permission_scope_is_valid(tenant_id, scope_type, scope_id)
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = delegated_permissions.tenant_id
      and tm.user_id = delegated_permissions.user_id
  )
);

drop policy if exists "Admin can request pending delegated permissions"
on public.delegated_permissions;
create policy "Admin can request pending delegated permissions"
on public.delegated_permissions
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['admin'])
  and granted_by = auth.uid()
  and status = 'pending'
  and (expires_at is null or expires_at > now())
  and public.delegated_permission_scope_is_valid(tenant_id, scope_type, scope_id)
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = delegated_permissions.tenant_id
      and tm.user_id = delegated_permissions.user_id
      and tm.role <> 'owner'
  )
);

drop policy if exists "Owner can update delegated permissions"
on public.delegated_permissions;
create policy "Owner can update delegated permissions"
on public.delegated_permissions
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner'])
  and (
    status in ('revoked', 'expired')
    or (
      (expires_at is null or expires_at > now())
      and public.delegated_permission_scope_is_valid(tenant_id, scope_type, scope_id)
    )
  )
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = delegated_permissions.tenant_id
      and tm.user_id = delegated_permissions.user_id
  )
);

drop policy if exists "Admin can update own pending delegated permissions"
on public.delegated_permissions;
create policy "Admin can update own pending delegated permissions"
on public.delegated_permissions
for update
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['admin'])
  and granted_by = auth.uid()
  and status = 'pending'
)
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['admin'])
  and granted_by = auth.uid()
  and status in ('pending', 'revoked')
  and (
    status = 'revoked'
    or (
      (expires_at is null or expires_at > now())
      and public.delegated_permission_scope_is_valid(tenant_id, scope_type, scope_id)
    )
  )
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = delegated_permissions.tenant_id
      and tm.user_id = delegated_permissions.user_id
      and tm.role <> 'owner'
  )
);

drop policy if exists "Owner and admin can delete tracked demo delegated permissions"
on public.delegated_permissions;
create policy "Owner and admin can delete tracked demo delegated permissions"
on public.delegated_permissions
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = delegated_permissions.tenant_id
      and dsr.entity_type = 'delegated_permissions'
      and dsr.entity_id = delegated_permissions.id
  )
);
