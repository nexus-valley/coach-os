-- Module 28: Team invitation system
-- Run after Module 26 roles/permissions.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'staff', 'trainer')),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_invitations_tenant_id_idx on public.team_invitations (tenant_id);
create index if not exists team_invitations_email_idx on public.team_invitations (email);
create index if not exists team_invitations_token_idx on public.team_invitations (token);
create index if not exists team_invitations_status_idx on public.team_invitations (status);
create index if not exists team_invitations_expires_at_idx on public.team_invitations (expires_at);

create unique index if not exists team_invitations_pending_email_unique_idx
on public.team_invitations (tenant_id, lower(email))
where status = 'pending';

drop trigger if exists set_team_invitations_updated_at on public.team_invitations;
create trigger set_team_invitations_updated_at
before update on public.team_invitations
for each row execute function public.set_updated_at();

alter table public.team_invitations enable row level security;

grant select, insert, update on public.team_invitations to authenticated;

drop policy if exists "Owner and admin can read team invitations" on public.team_invitations;
create policy "Owner and admin can read team invitations"
on public.team_invitations
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can create team invitations" on public.team_invitations;
create policy "Owner and admin can create team invitations"
on public.team_invitations
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and role in ('admin', 'staff', 'trainer')
  and status = 'pending'
  and invited_by = auth.uid()
);

drop policy if exists "Owner and admin can update team invitations" on public.team_invitations;
create policy "Owner and admin can update team invitations"
on public.team_invitations
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and role in ('admin', 'staff', 'trainer')
);

drop policy if exists "Invited user can read pending own team invitation" on public.team_invitations;
create policy "Invited user can read pending own team invitation"
on public.team_invitations
for select
to authenticated
using (
  status = 'pending'
  and expires_at > now()
  and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create or replace function public.get_team_invitation_by_token(invite_token text)
returns table (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or requesting_email = '' then
    return;
  end if;

  return query
  select
    ti.id,
    ti.tenant_id,
    t.name as tenant_name,
    ti.email,
    ti.role,
    case
      when ti.status = 'pending' and ti.expires_at <= now() then 'expired'
      else ti.status
    end as status,
    ti.expires_at,
    ti.accepted_at,
    ti.revoked_at,
    ti.created_at
  from public.team_invitations ti
  join public.tenants t on t.id = ti.tenant_id
  where ti.token = invite_token
    and lower(ti.email) = requesting_email
  limit 1;
end;
$$;

create or replace function public.accept_team_invitation(invite_token text)
returns table (
  tenant_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  requesting_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  invitation public.team_invitations%rowtype;
begin
  if requesting_user is null or requesting_email = '' then
    raise exception 'You must be logged in to accept this invitation.'
      using errcode = '28000';
  end if;

  select *
  into invitation
  from public.team_invitations
  where token = invite_token
  for update;

  if not found or lower(invitation.email) <> requesting_email then
    raise exception 'This invitation is not available for the signed-in email.'
      using errcode = '42501';
  end if;

  if invitation.status = 'accepted' then
    raise exception 'This invitation has already been accepted.'
      using errcode = '22023';
  end if;

  if invitation.status = 'revoked' then
    raise exception 'This invitation has been revoked.'
      using errcode = '22023';
  end if;

  if invitation.status = 'expired' or invitation.expires_at <= now() then
    update public.team_invitations
    set status = 'expired'
    where id = invitation.id
      and status = 'pending';

    raise exception 'This invitation has expired.'
      using errcode = '22023';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (invitation.tenant_id, requesting_user, invitation.role)
  on conflict (tenant_id, user_id) do update
  set role = case
    when public.tenant_members.role = 'owner' then public.tenant_members.role
    else excluded.role
  end;

  update public.team_invitations
  set
    accepted_at = now(),
    accepted_by = requesting_user,
    status = 'accepted'
  where id = invitation.id;

  return query select invitation.tenant_id, invitation.role;
end;
$$;

revoke execute on function public.get_team_invitation_by_token(text) from public;
revoke execute on function public.accept_team_invitation(text) from public;
grant execute on function public.get_team_invitation_by_token(text) to authenticated;
grant execute on function public.accept_team_invitation(text) to authenticated;
