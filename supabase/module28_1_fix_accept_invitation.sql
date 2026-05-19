-- Module 28.1: Fix team invitation acceptance RPC return shape
-- Run after supabase/module28_team_invitations.sql.

drop function if exists public.accept_team_invitation(text);

create or replace function public.accept_team_invitation(invite_token text)
returns table (
  accepted_tenant_id uuid,
  accepted_role text
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
  where id = invitation.id
    and status = 'pending';

  return query
  select
    invitation.tenant_id as accepted_tenant_id,
    invitation.role as accepted_role;
end;
$$;

revoke execute on function public.accept_team_invitation(text) from public;
grant execute on function public.accept_team_invitation(text) to authenticated;
