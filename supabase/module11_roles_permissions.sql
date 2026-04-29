alter table public.tenant_members
drop constraint if exists tenant_members_role_check;

alter table public.tenant_members
add constraint tenant_members_role_check
check (role in ('owner', 'admin', 'staff'));

create or replace function public.is_tenant_owner(check_tenant_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = check_tenant_id
      and tm.user_id = check_user_id
      and tm.role = 'owner'
  );
$$;

create or replace function public.has_tenant_role(
  check_tenant_id uuid,
  check_user_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = check_tenant_id
      and tm.user_id = check_user_id
      and tm.role = any(allowed_roles)
  );
$$;

grant execute on function public.is_tenant_owner(uuid, uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, uuid, text[]) to authenticated;
grant update, delete on public.tenant_members to authenticated;

drop policy if exists "Tenant owners can update tenant memberships" on public.tenant_members;
create policy "Tenant owners can update tenant memberships"
on public.tenant_members
for update
to authenticated
using (public.is_tenant_owner(tenant_id, auth.uid()))
with check (public.is_tenant_owner(tenant_id, auth.uid()));

drop policy if exists "Tenant owners can delete tenant memberships" on public.tenant_members;
create policy "Tenant owners can delete tenant memberships"
on public.tenant_members
for delete
to authenticated
using (
  public.is_tenant_owner(tenant_id, auth.uid())
  and user_id <> auth.uid()
);

drop policy if exists "Tenant owners can invite members manually" on public.tenant_members;
create policy "Tenant owners can invite members manually"
on public.tenant_members
for insert
to authenticated
with check (
  public.is_tenant_owner(tenant_id, auth.uid())
  and role in ('admin', 'staff')
);
