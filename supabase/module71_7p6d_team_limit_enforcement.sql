-- Module 71.7P6D: Team Invitation / Role Canonical Limit Enforcement
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Patch team invitation, invitation acceptance, and member role-change secure
--   RPCs so canonical live-count team limits are enforced inside the same SQL
--   transaction as the invitation/member mutation.
-- - Enforce team_members, admins, and staff_trainers limits through the P6B
--   helper.
-- - Do not change payment, checkout, subscription assignment, public catalog,
--   request option, Module 62, FeatureGate, or legacy Module 56 behavior.
--
-- Dependency:
-- - public.assert_tenant_entity_usage_limit(uuid, text, integer, boolean)
--   from Module 71.7P6B must already exist.

begin;

create or replace function public.m71_7p6d_assert_entity_usage_limit_internal(
  p_tenant_id uuid,
  p_resource_key text,
  p_requested_delta integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource_key text := lower(trim(coalesce(p_resource_key, '')));
  v_requested_delta integer := coalesce(p_requested_delta, 1);
  v_plan_id uuid;
  v_limit record;
  v_override record;
  v_effective_limit integer;
  v_current_count integer := 0;
  v_projected_count integer;
  v_remaining_after integer;
  v_warning boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if v_requested_delta < 0 then
    raise exception 'Requested delta cannot be negative.' using errcode = '22023';
  end if;

  if v_resource_key not in ('team_members', 'admins', 'staff_trainers') then
    raise exception 'Invalid team entity resource key.' using errcode = '22023';
  end if;

  -- Same lock key strategy as P6B, but this internal helper intentionally does
  -- not call subscription_entitlements_can_read_tenant because a valid invitee
  -- may not be a tenant member until this acceptance transaction completes.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'entity_usage_limit:' || p_tenant_id::text || ':' || v_resource_key,
      7176
    )
  );

  select tsa.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments tsa
  where tsa.tenant_id = p_tenant_id
    and tsa.is_current
  order by tsa.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'A canonical subscription assignment is required before team limits can be enforced.'
      using errcode = '22023';
  end if;

  select *
  into v_limit
  from public.subscription_plan_usage_limits spl
  where spl.plan_id = v_plan_id
    and spl.resource_key = v_resource_key;

  if not found then
    raise exception 'Canonical team limit is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  select *
  into v_override
  from public.tenant_subscription_overrides tso
  where tso.tenant_id = p_tenant_id
    and tso.resource_key = v_resource_key
    and tso.override_type in ('limit_raise', 'limit_lower')
    and (tso.expires_at is null or tso.expires_at > now())
  order by tso.created_at desc
  limit 1;

  v_effective_limit := v_limit.limit_value;

  if found and (v_override.override_value_json ? 'limit_value') then
    v_effective_limit := nullif(v_override.override_value_json->>'limit_value', '')::integer;
  end if;

  if v_effective_limit is null then
    raise exception 'Unlimited team limits are not supported for this enforcement helper yet.'
      using errcode = '22023';
  end if;

  if v_effective_limit < 0 then
    raise exception 'Canonical team limit is invalid.'
      using errcode = '22023';
  end if;

  select case v_resource_key
    when 'admins' then count(*) filter (where tm.role = 'admin')::integer
    when 'staff_trainers' then count(*) filter (where tm.role in ('staff', 'trainer'))::integer
    when 'team_members' then count(*)::integer
    else 0
  end
  into v_current_count
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id;

  v_current_count := coalesce(v_current_count, 0);
  v_projected_count := v_current_count + v_requested_delta;
  v_remaining_after := greatest(v_effective_limit - v_projected_count, 0);

  if v_limit.enforcement_mode = 'hard' and v_projected_count > v_effective_limit then
    raise exception 'Canonical team usage limit exceeded for %. Current %, requested %, limit %.',
      v_resource_key,
      v_current_count,
      v_requested_delta,
      v_effective_limit
      using errcode = '22023';
  end if;

  v_warning :=
    v_effective_limit > 0
    and v_projected_count >= ceil(v_effective_limit * (coalesce(v_limit.warning_threshold_percent, 80)::numeric / 100));

  return jsonb_build_object(
    'allowed', true,
    'tenant_id', p_tenant_id,
    'resource_key', v_resource_key,
    'current_count', v_current_count,
    'requested_delta', v_requested_delta,
    'projected_count', v_projected_count,
    'limit_value', v_effective_limit,
    'base_limit_value', v_limit.limit_value,
    'remaining_after', v_remaining_after,
    'warning', v_warning,
    'enforcement_mode', v_limit.enforcement_mode,
    'warning_threshold_percent', v_limit.warning_threshold_percent,
    'include_pending_invitations', false,
    'source', 'canonical_team_acceptance_entity_usage_limit'
  );
end;
$$;

create or replace function public.update_tenant_member_role_secure(
  p_tenant_id uuid,
  p_member_id uuid,
  p_role text
)
returns table (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_member public.tenant_members%rowtype;
  v_role text;
begin
  v_actor_role := public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner'],
    'Only workspace owners can change team member roles.'
  );
  v_member := public.m69_5_assert_tenant_member_by_id(p_tenant_id, p_member_id);
  v_role := public.m69_5_validate_member_role(p_role);

  if v_member.role = 'owner' then
    raise exception 'Owner role cannot be changed from this flow.' using errcode = '42501';
  end if;

  if v_member.role <> 'admin' and v_role = 'admin' then
    perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'admins', 1, false);
  end if;

  if v_member.role not in ('staff', 'trainer') and v_role in ('staff', 'trainer') then
    perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'staff_trainers', 1, false);
  end if;

  update public.tenant_members tm
  set role = v_role
  where tm.tenant_id = p_tenant_id
    and tm.id = p_member_id
  returning * into v_member;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'role_changed',
    'team_member',
    v_member.id,
    'Team member',
    'Changed team member role',
    'warning',
    jsonb_build_object('role', v_member.role, 'userId', v_member.user_id)
  );

  return query select v_member.id, v_member.tenant_id, v_member.user_id, v_member.role, v_member.created_at;
end;
$$;

create or replace function public.create_team_invitation_secure(
  p_tenant_id uuid,
  p_email text,
  p_role text
)
returns table (
  id uuid,
  tenant_id uuid,
  email text,
  role text,
  token text,
  status text,
  invited_by uuid,
  accepted_by uuid,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_email text;
  v_invitation public.team_invitations%rowtype;
begin
  perform public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can invite team members.'
  );
  v_role := public.m69_5_validate_invitation_role(p_role);
  v_email := public.m69_5_validate_email(p_email);

  select *
  into v_invitation
  from public.team_invitations ti
  where ti.tenant_id = p_tenant_id
    and lower(ti.email) = v_email
    and ti.status = 'pending'
  order by ti.created_at desc
  limit 1;

  if found then
    return query
    select v_invitation.id, v_invitation.tenant_id, v_invitation.email, v_invitation.role,
      v_invitation.token, v_invitation.status, v_invitation.invited_by, v_invitation.accepted_by,
      v_invitation.expires_at, v_invitation.accepted_at, v_invitation.revoked_at,
      v_invitation.created_at, v_invitation.updated_at;
    return;
  end if;

  perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'team_members', 1, true);

  if v_role = 'admin' then
    perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'admins', 1, true);
  elsif v_role in ('staff', 'trainer') then
    perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'staff_trainers', 1, true);
  end if;

  insert into public.team_invitations (
    tenant_id,
    email,
    role,
    token,
    status,
    invited_by,
    expires_at
  )
  values (
    p_tenant_id,
    v_email,
    v_role,
    public.m69_5_create_invite_token(),
    'pending',
    auth.uid(),
    now() + interval '7 days'
  )
  returning * into v_invitation;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'invitation_created',
    'team_invitation',
    v_invitation.id,
    'Team invitation',
    'Created team invitation',
    'info',
    jsonb_build_object('role', v_invitation.role, 'emailDomain', split_part(v_email, '@', 2), 'expiresAt', v_invitation.expires_at)
  );

  return query
  select v_invitation.id, v_invitation.tenant_id, v_invitation.email, v_invitation.role,
    v_invitation.token, v_invitation.status, v_invitation.invited_by, v_invitation.accepted_by,
    v_invitation.expires_at, v_invitation.accepted_at, v_invitation.revoked_at,
    v_invitation.created_at, v_invitation.updated_at;
end;
$$;

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
  existing_member public.tenant_members%rowtype;
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

  select *
  into existing_member
  from public.tenant_members tm
  where tm.tenant_id = invitation.tenant_id
    and tm.user_id = requesting_user
  for update;

  if existing_member.id is null then
    perform public.m71_7p6d_assert_entity_usage_limit_internal(invitation.tenant_id, 'team_members', 1);

    if invitation.role = 'admin' then
      perform public.m71_7p6d_assert_entity_usage_limit_internal(invitation.tenant_id, 'admins', 1);
    elsif invitation.role in ('staff', 'trainer') then
      perform public.m71_7p6d_assert_entity_usage_limit_internal(invitation.tenant_id, 'staff_trainers', 1);
    end if;
  elsif existing_member.role <> 'owner' then
    if existing_member.role <> 'admin' and invitation.role = 'admin' then
      perform public.m71_7p6d_assert_entity_usage_limit_internal(invitation.tenant_id, 'admins', 1);
    end if;

    if existing_member.role not in ('staff', 'trainer') and invitation.role in ('staff', 'trainer') then
      perform public.m71_7p6d_assert_entity_usage_limit_internal(invitation.tenant_id, 'staff_trainers', 1);
    end if;
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

revoke all on function public.m71_7p6d_assert_entity_usage_limit_internal(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.update_tenant_member_role_secure(uuid, uuid, text) from public, anon;
revoke execute on function public.create_team_invitation_secure(uuid, text, text) from public, anon;
revoke execute on function public.accept_team_invitation(text) from public, anon;

grant execute on function public.update_tenant_member_role_secure(uuid, uuid, text) to authenticated;
grant execute on function public.create_team_invitation_secure(uuid, text, text) to authenticated;
grant execute on function public.accept_team_invitation(text) to authenticated;

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Confirm patched RPCs exist:
-- select routine_name
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name in (
--     'm71_7p6d_assert_entity_usage_limit_internal',
--     'update_tenant_member_role_secure',
--     'create_team_invitation_secure',
--     'accept_team_invitation'
--   )
-- order by routine_name;
--
-- 2. Confirm execute grants remain authenticated-only for patched RPCs:
-- select grantee, routine_name, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name in (
--     'update_tenant_member_role_secure',
--     'create_team_invitation_secure',
--     'accept_team_invitation',
--     'm71_7p6d_assert_entity_usage_limit_internal'
--   )
-- order by routine_name, grantee;
--
-- 3. Confirm direct writes remain revoked for team tables:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('team_invitations', 'tenant_members')
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
--   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
-- order by table_name, grantee, privilege_type;
--
-- 4. Regression tenant live counts before any mutation smoke:
-- select public.get_tenant_entity_usage_counts(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 5. Helper assertion smoke without mutation:
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'team_members',
--   1,
--   true
-- );
--
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'admins',
--   1,
--   true
-- );
--
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'staff_trainers',
--   1,
--   true
-- );
--
-- 6. High-delta rejection smoke without mutation:
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'team_members',
--   1000000,
--   true
-- );
--
-- 7. Confirm public/payment/assignment state remains unchanged:
-- select public.get_public_plan_catalog('INR');
--
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- Controlled mutation smoke plan for later explicit approval only:
-- - Create one clearly named regression invitation through
--   create_team_invitation_secure only if invitation cleanup is approved.
-- - Cancel/revoke that invitation only through the approved secure cleanup path.
-- - Do not accept invitations unless a disposable account and full cleanup path
--   are explicitly approved.
-- - Do not perform mutation smoke as part of this SQL proposal module.
--
-- Rollback SQL for later review only:
-- Re-apply the original update_tenant_member_role_secure and
-- create_team_invitation_secure definitions from Module 69.5, and the original
-- accept_team_invitation definition from Module 28, if rollback is required.
