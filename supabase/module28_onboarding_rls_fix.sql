-- Module 28: Onboarding workspace creation hardening
-- Run after Module 26/27 if new-user onboarding fails during tenant creation.

create or replace function public.create_workspace_with_owner(
  workspace_name text,
  workspace_slug text,
  workspace_category text
)
returns table (
  id uuid,
  name text,
  slug text,
  category text,
  owner_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  normalized_name text := nullif(trim(workspace_name), '');
  normalized_slug text := nullif(trim(workspace_slug), '');
  candidate_slug text;
  created_tenant public.tenants%rowtype;
  suffix text;
  attempt integer := 0;
begin
  if requesting_user is null then
    raise exception 'You must be logged in to create a workspace.'
      using errcode = '28000';
  end if;

  if normalized_name is null then
    raise exception 'Workspace name is required.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user::text, 0));

  select t.*
  into created_tenant
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = requesting_user
  order by tm.created_at asc
  limit 1;

  if found then
    return query
    select
      created_tenant.id,
      created_tenant.name,
      created_tenant.slug,
      created_tenant.category,
      created_tenant.owner_user_id;
    return;
  end if;

  candidate_slug := coalesce(normalized_slug, 'workspace');

  loop
    begin
      insert into public.tenants (name, slug, category, owner_user_id)
      values (normalized_name, candidate_slug, workspace_category, requesting_user)
      returning * into created_tenant;

      insert into public.tenant_members (tenant_id, user_id, role)
      values (created_tenant.id, requesting_user, 'owner')
      on conflict (tenant_id, user_id) do update
      set role = 'owner';

      return query
      select
        created_tenant.id,
        created_tenant.name,
        created_tenant.slug,
        created_tenant.category,
        created_tenant.owner_user_id;
      return;
    exception
      when unique_violation then
        attempt := attempt + 1;

        if attempt > 5 then
          raise;
        end if;

        suffix := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
        candidate_slug := left(coalesce(normalized_slug, 'workspace'), 42) || '-' || suffix;
    end;
  end loop;
end;
$$;

revoke execute on function public.create_workspace_with_owner(text, text, text) from public;
grant execute on function public.create_workspace_with_owner(text, text, text) to authenticated;

grant select, insert, update on public.tenants to authenticated;
grant select, insert on public.tenant_members to authenticated;

drop policy if exists "Authenticated users can create tenants" on public.tenants;
create policy "Authenticated users can create tenants"
on public.tenants
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists "Users can create their owner membership during onboarding" on public.tenant_members;
create policy "Users can create their owner membership during onboarding"
on public.tenant_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'owner'
  and public.user_owns_tenant(tenant_id, auth.uid())
);
