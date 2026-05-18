create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  category text,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists tenants_owner_user_id_idx on public.tenants (owner_user_id);
create index if not exists tenants_slug_idx on public.tenants (slug);
create index if not exists tenant_members_tenant_id_idx on public.tenant_members (tenant_id);
create index if not exists tenant_members_user_id_idx on public.tenant_members (user_id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_tenants_updated_at on public.tenants;
create trigger set_tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    avatar_url = excluded.avatar_url,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.is_tenant_member(check_tenant_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select check_user_id = auth.uid()
    and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = check_tenant_id
      and tm.user_id = check_user_id
  );
$$;

create or replace function public.user_owns_tenant(check_tenant_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select check_user_id = auth.uid()
    and exists (
    select 1
    from public.tenants t
    where t.id = check_tenant_id
      and t.owner_user_id = check_user_id
  );
$$;

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

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.tenants to authenticated;
grant select, insert on public.tenant_members to authenticated;

revoke execute on function public.is_tenant_member(uuid, uuid) from public;
revoke execute on function public.user_owns_tenant(uuid, uuid) from public;
revoke execute on function public.create_workspace_with_owner(text, text, text) from public;
grant execute on function public.is_tenant_member(uuid, uuid) to authenticated;
grant execute on function public.user_owns_tenant(uuid, uuid) to authenticated;
grant execute on function public.create_workspace_with_owner(text, text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Tenant members can read their tenants" on public.tenants;
create policy "Tenant members can read their tenants"
on public.tenants
for select
to authenticated
using (
  owner_user_id = auth.uid()
  or public.is_tenant_member(id, auth.uid())
);

drop policy if exists "Authenticated users can create tenants" on public.tenants;
create policy "Authenticated users can create tenants"
on public.tenants
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists "Tenant owners can update their tenants" on public.tenants;
create policy "Tenant owners can update their tenants"
on public.tenants
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Tenant members can read tenant memberships" on public.tenant_members;
create policy "Tenant members can read tenant memberships"
on public.tenant_members
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Users can read their own tenant memberships" on public.tenant_members;
create policy "Users can read their own tenant memberships"
on public.tenant_members
for select
to authenticated
using (user_id = auth.uid());

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
