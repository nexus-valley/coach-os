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

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.tenants to authenticated;
grant select, insert on public.tenant_members to authenticated;

revoke execute on function public.is_tenant_member(uuid, uuid) from public;
revoke execute on function public.user_owns_tenant(uuid, uuid) from public;
grant execute on function public.is_tenant_member(uuid, uuid) to authenticated;
grant execute on function public.user_owns_tenant(uuid, uuid) to authenticated;

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
