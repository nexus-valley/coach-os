begin;

-- Module 69.5: Team, invitations, trainer assignments, and delegated permission write RPCs.
-- Existing direct table grants are intentionally left in place. They can be
-- considered for revocation only after these RPC-backed flows have production confidence.

create or replace function public.m69_5_current_role(p_tenant_id uuid)
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

create or replace function public.m69_5_assert_member_role(
  p_tenant_id uuid,
  p_allowed_roles text[],
  p_message text default 'Workspace membership is required.'
)
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

  v_role := public.m69_5_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if not (v_role = any(p_allowed_roles)) then
    raise exception '%', coalesce(p_message, 'You do not have permission to perform this action.') using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m69_5_validate_member_role(p_role text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_role is null or p_role not in ('admin', 'staff', 'trainer') then
    raise exception 'Select a valid team role.' using errcode = '22023';
  end if;

  return p_role;
end;
$$;

create or replace function public.m69_5_validate_invitation_role(p_role text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_role is null or p_role not in ('admin', 'staff', 'trainer') then
    raise exception 'Select a valid invitation role.' using errcode = '22023';
  end if;

  return p_role;
end;
$$;

create or replace function public.m69_5_validate_email(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email = '' then
    raise exception 'Invite email is required.' using errcode = '22023';
  end if;

  if char_length(v_email) > 254
     or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  return v_email;
end;
$$;

create or replace function public.m69_5_create_invite_token()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

create or replace function public.m69_5_assert_tenant_member(
  p_tenant_id uuid,
  p_user_id uuid
)
returns public.tenant_members
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.tenant_members%rowtype;
begin
  if p_user_id is null then
    raise exception 'Team member is required.' using errcode = '22023';
  end if;

  select *
  into v_member
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = p_user_id;

  if not found then
    raise exception 'Team member not found in this workspace.' using errcode = '22023';
  end if;

  return v_member;
end;
$$;

create or replace function public.m69_5_assert_tenant_member_by_id(
  p_tenant_id uuid,
  p_member_id uuid
)
returns public.tenant_members
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.tenant_members%rowtype;
begin
  if p_member_id is null then
    raise exception 'Team member is required.' using errcode = '22023';
  end if;

  select *
  into v_member
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.id = p_member_id;

  if not found then
    raise exception 'Team member not found in this workspace.' using errcode = '22023';
  end if;

  return v_member;
end;
$$;

create or replace function public.m69_5_assert_active_trainer(
  p_tenant_id uuid,
  p_trainer_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.tenant_members%rowtype;
begin
  v_member := public.m69_5_assert_tenant_member(p_tenant_id, p_trainer_user_id);

  if v_member.role <> 'trainer' then
    raise exception 'Assignments can only be created for trainer users.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.m69_5_assert_course_in_tenant(
  p_tenant_id uuid,
  p_course_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_course_id is null or not exists (
    select 1 from public.courses c where c.tenant_id = p_tenant_id and c.id = p_course_id
  ) then
    raise exception 'Course not found in this workspace.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.m69_5_assert_cohort_in_tenant(
  p_tenant_id uuid,
  p_cohort_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_cohort_id is null or not exists (
    select 1 from public.cohorts c where c.tenant_id = p_tenant_id and c.id = p_cohort_id
  ) then
    raise exception 'Cohort not found in this workspace.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.m69_5_validate_delegated_permission_key(p_permission_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_permission_key is null or p_permission_key not in (
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
  ) then
    raise exception 'Unsupported delegated permission.' using errcode = '22023';
  end if;

  return p_permission_key;
end;
$$;

create or replace function public.m69_5_validate_scope(
  p_tenant_id uuid,
  p_scope_type text,
  p_scope_id uuid
)
returns table(scope_type text, scope_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope_type text := coalesce(nullif(trim(coalesce(p_scope_type, '')), ''), 'workspace');
  v_scope_id uuid := p_scope_id;
begin
  if v_scope_type not in ('workspace', 'course', 'cohort', 'student', 'session', 'assignment') then
    raise exception 'Unsupported delegated permission scope.' using errcode = '22023';
  end if;

  if v_scope_type = 'workspace' then
    return query select 'workspace'::text, null::uuid;
    return;
  end if;

  if v_scope_id is null then
    raise exception 'Scoped permissions require a scope id.' using errcode = '22023';
  end if;

  if v_scope_type = 'course' and not exists (
    select 1 from public.courses c where c.tenant_id = p_tenant_id and c.id = v_scope_id
  ) then
    raise exception 'Course not found in this workspace.' using errcode = '22023';
  elsif v_scope_type = 'cohort' and not exists (
    select 1 from public.cohorts c where c.tenant_id = p_tenant_id and c.id = v_scope_id
  ) then
    raise exception 'Cohort not found in this workspace.' using errcode = '22023';
  elsif v_scope_type = 'student' and not exists (
    select 1 from public.students s where s.tenant_id = p_tenant_id and s.id = v_scope_id
  ) then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  elsif v_scope_type = 'session' and not exists (
    select 1 from public.sessions s where s.tenant_id = p_tenant_id and s.id = v_scope_id
  ) then
    raise exception 'Session not found in this workspace.' using errcode = '22023';
  elsif v_scope_type = 'assignment' and not exists (
    select 1 from public.assignments a where a.tenant_id = p_tenant_id and a.id = v_scope_id
  ) then
    raise exception 'Assignment not found in this workspace.' using errcode = '22023';
  end if;

  return query select v_scope_type, v_scope_id;
end;
$$;

create or replace function public.m69_5_write_audit(
  p_tenant_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_name text,
  p_description text,
  p_severity text default 'info',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
    auth.uid(),
    p_action,
    p_entity_type,
    p_entity_id,
    p_entity_name,
    p_description,
    coalesce(p_severity, 'info'),
    coalesce(p_metadata, '{}'::jsonb)
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

create or replace function public.remove_tenant_member_secure(
  p_tenant_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.tenant_members%rowtype;
begin
  perform public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner'],
    'Only workspace owners can remove team members.'
  );
  v_member := public.m69_5_assert_tenant_member_by_id(p_tenant_id, p_member_id);

  if v_member.user_id = auth.uid() then
    raise exception 'You cannot remove yourself from the workspace.' using errcode = '42501';
  end if;

  if v_member.role = 'owner' then
    raise exception 'Workspace owners cannot be removed from this flow.' using errcode = '42501';
  end if;

  delete from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.id = p_member_id;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'team_member_removed',
    'team_member',
    v_member.id,
    'Team member',
    'Removed team member from workspace',
    'critical',
    jsonb_build_object('role', v_member.role, 'userId', v_member.user_id)
  );
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

create or replace function public.cancel_team_invitation_secure(
  p_invitation_id uuid
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
  v_invitation public.team_invitations%rowtype;
begin
  select *
  into v_invitation
  from public.team_invitations ti
  where ti.id = p_invitation_id;

  if not found then
    raise exception 'Invitation not found.' using errcode = '22023';
  end if;

  perform public.m69_5_assert_member_role(
    v_invitation.tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can revoke invitations.'
  );

  if v_invitation.status <> 'pending' or v_invitation.expires_at <= now() then
    raise exception 'Only pending invitations can be revoked.' using errcode = '22023';
  end if;

  update public.team_invitations ti
  set status = 'revoked',
      revoked_at = now()
  where ti.tenant_id = v_invitation.tenant_id
    and ti.id = v_invitation.id
    and ti.status = 'pending'
  returning * into v_invitation;

  perform public.m69_5_write_audit(
    v_invitation.tenant_id,
    'invitation_revoked',
    'team_invitation',
    v_invitation.id,
    'Team invitation',
    'Revoked team invitation',
    'warning',
    jsonb_build_object('role', v_invitation.role, 'emailDomain', split_part(lower(v_invitation.email), '@', 2))
  );

  return query
  select v_invitation.id, v_invitation.tenant_id, v_invitation.email, v_invitation.role,
    v_invitation.token, v_invitation.status, v_invitation.invited_by, v_invitation.accepted_by,
    v_invitation.expires_at, v_invitation.accepted_at, v_invitation.revoked_at,
    v_invitation.created_at, v_invitation.updated_at;
end;
$$;

create or replace function public.resend_team_invitation_secure(
  p_invitation_id uuid
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
  v_invitation public.team_invitations%rowtype;
begin
  select *
  into v_invitation
  from public.team_invitations ti
  where ti.id = p_invitation_id;

  if not found then
    raise exception 'Invitation not found.' using errcode = '22023';
  end if;

  perform public.m69_5_assert_member_role(
    v_invitation.tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can resend invitations.'
  );

  if v_invitation.status in ('accepted', 'revoked') then
    raise exception 'Accepted or revoked invitations cannot be resent.' using errcode = '22023';
  end if;

  update public.team_invitations ti
  set status = 'pending',
      token = public.m69_5_create_invite_token(),
      expires_at = now() + interval '7 days',
      revoked_at = null
  where ti.tenant_id = v_invitation.tenant_id
    and ti.id = v_invitation.id
  returning * into v_invitation;

  perform public.m69_5_write_audit(
    v_invitation.tenant_id,
    'invitation_resent',
    'team_invitation',
    v_invitation.id,
    'Team invitation',
    'Refreshed team invitation',
    'info',
    jsonb_build_object('role', v_invitation.role, 'emailDomain', split_part(lower(v_invitation.email), '@', 2), 'expiresAt', v_invitation.expires_at)
  );

  return query
  select v_invitation.id, v_invitation.tenant_id, v_invitation.email, v_invitation.role,
    v_invitation.token, v_invitation.status, v_invitation.invited_by, v_invitation.accepted_by,
    v_invitation.expires_at, v_invitation.accepted_at, v_invitation.revoked_at,
    v_invitation.created_at, v_invitation.updated_at;
end;
$$;

create or replace function public.assign_trainer_to_course_secure(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_course_id uuid
)
returns table (
  id uuid,
  tenant_id uuid,
  trainer_user_id uuid,
  course_id uuid,
  assigned_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.trainer_course_assignments%rowtype;
begin
  perform public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can assign trainers.'
  );
  perform public.m69_5_assert_active_trainer(p_tenant_id, p_trainer_user_id);
  perform public.m69_5_assert_course_in_tenant(p_tenant_id, p_course_id);

  if exists (
    select 1
    from public.trainer_course_assignments tca
    where tca.tenant_id = p_tenant_id
      and tca.trainer_user_id = p_trainer_user_id
      and tca.course_id = p_course_id
  ) then
    raise exception 'Trainer is already assigned to this course.' using errcode = '23505';
  end if;

  insert into public.trainer_course_assignments (
    tenant_id,
    trainer_user_id,
    course_id,
    assigned_by
  )
  values (
    p_tenant_id,
    p_trainer_user_id,
    p_course_id,
    auth.uid()
  )
  returning * into v_assignment;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'trainer_assigned_course',
    'trainer_assignment',
    v_assignment.id,
    'Trainer assignment',
    'Assigned trainer to course',
    'info',
    jsonb_build_object('courseId', v_assignment.course_id, 'trainerUserId', v_assignment.trainer_user_id)
  );

  return query select v_assignment.id, v_assignment.tenant_id, v_assignment.trainer_user_id,
    v_assignment.course_id, v_assignment.assigned_by, v_assignment.created_at;
end;
$$;

create or replace function public.remove_trainer_from_course_secure(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_course_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.trainer_course_assignments%rowtype;
begin
  perform public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can remove trainer assignments.'
  );
  perform public.m69_5_assert_active_trainer(p_tenant_id, p_trainer_user_id);
  perform public.m69_5_assert_course_in_tenant(p_tenant_id, p_course_id);

  select *
  into v_assignment
  from public.trainer_course_assignments tca
  where tca.tenant_id = p_tenant_id
    and tca.trainer_user_id = p_trainer_user_id
    and tca.course_id = p_course_id;

  delete from public.trainer_course_assignments tca
  where tca.tenant_id = p_tenant_id
    and tca.trainer_user_id = p_trainer_user_id
    and tca.course_id = p_course_id;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'trainer_removed_course',
    'trainer_assignment',
    case when found then v_assignment.id else null end,
    'Trainer assignment',
    'Removed trainer from course',
    'info',
    jsonb_build_object('courseId', p_course_id, 'trainerUserId', p_trainer_user_id)
  );
end;
$$;

create or replace function public.assign_trainer_to_cohort_secure(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_cohort_id uuid
)
returns table (
  id uuid,
  tenant_id uuid,
  trainer_user_id uuid,
  cohort_id uuid,
  assigned_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.trainer_cohort_assignments%rowtype;
begin
  perform public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can assign trainers.'
  );
  perform public.m69_5_assert_active_trainer(p_tenant_id, p_trainer_user_id);
  perform public.m69_5_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);

  if exists (
    select 1
    from public.trainer_cohort_assignments tca
    where tca.tenant_id = p_tenant_id
      and tca.trainer_user_id = p_trainer_user_id
      and tca.cohort_id = p_cohort_id
  ) then
    raise exception 'Trainer is already assigned to this cohort.' using errcode = '23505';
  end if;

  insert into public.trainer_cohort_assignments (
    tenant_id,
    trainer_user_id,
    cohort_id,
    assigned_by
  )
  values (
    p_tenant_id,
    p_trainer_user_id,
    p_cohort_id,
    auth.uid()
  )
  returning * into v_assignment;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'trainer_assigned_cohort',
    'trainer_assignment',
    v_assignment.id,
    'Trainer assignment',
    'Assigned trainer to cohort',
    'info',
    jsonb_build_object('cohortId', v_assignment.cohort_id, 'trainerUserId', v_assignment.trainer_user_id)
  );

  return query select v_assignment.id, v_assignment.tenant_id, v_assignment.trainer_user_id,
    v_assignment.cohort_id, v_assignment.assigned_by, v_assignment.created_at;
end;
$$;

create or replace function public.remove_trainer_from_cohort_secure(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_cohort_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.trainer_cohort_assignments%rowtype;
begin
  perform public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can remove trainer assignments.'
  );
  perform public.m69_5_assert_active_trainer(p_tenant_id, p_trainer_user_id);
  perform public.m69_5_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);

  select *
  into v_assignment
  from public.trainer_cohort_assignments tca
  where tca.tenant_id = p_tenant_id
    and tca.trainer_user_id = p_trainer_user_id
    and tca.cohort_id = p_cohort_id;

  delete from public.trainer_cohort_assignments tca
  where tca.tenant_id = p_tenant_id
    and tca.trainer_user_id = p_trainer_user_id
    and tca.cohort_id = p_cohort_id;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'trainer_removed_cohort',
    'trainer_assignment',
    case when found then v_assignment.id else null end,
    'Trainer assignment',
    'Removed trainer from cohort',
    'info',
    jsonb_build_object('cohortId', p_cohort_id, 'trainerUserId', p_trainer_user_id)
  );
end;
$$;

create or replace function public.grant_delegated_permission_secure(
  p_tenant_id uuid,
  p_user_id uuid,
  p_permission_key text,
  p_scope_type text default 'workspace',
  p_scope_id uuid default null,
  p_reason text default null,
  p_starts_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.delegated_permissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_permission_key text;
  v_scope record;
  v_starts_at timestamptz := coalesce(p_starts_at, now());
  v_permission public.delegated_permissions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_actor_role := public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can manage delegated permissions.'
  );
  perform public.m69_5_assert_tenant_member(p_tenant_id, p_user_id);
  v_permission_key := public.m69_5_validate_delegated_permission_key(p_permission_key);
  select * into v_scope from public.m69_5_validate_scope(p_tenant_id, p_scope_type, p_scope_id);

  if jsonb_typeof(v_metadata) <> 'object' or char_length(v_metadata::text) > 3000 then
    raise exception 'Delegated permission metadata is invalid.' using errcode = '22023';
  end if;

  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Delegated permission reason is too long.' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Permission expiry must be in the future.' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= v_starts_at then
    raise exception 'Permission expiry must be after the start date.' using errcode = '22023';
  end if;

  insert into public.delegated_permissions (
    tenant_id,
    user_id,
    permission_key,
    scope_type,
    scope_id,
    status,
    reason,
    granted_by,
    approved_by,
    starts_at,
    expires_at,
    metadata_json
  )
  values (
    p_tenant_id,
    p_user_id,
    v_permission_key,
    v_scope.scope_type,
    v_scope.scope_id,
    case when v_actor_role = 'owner' then 'active' else 'pending' end,
    v_reason,
    auth.uid(),
    case when v_actor_role = 'owner' then auth.uid() else null end,
    v_starts_at,
    p_expires_at,
    v_metadata
  )
  returning * into v_permission;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'delegated_permission_created',
    'delegated_permission',
    v_permission.id,
    'Delegated permission',
    case when v_permission.status = 'pending'
      then 'Requested delegated permission pending owner approval'
      else 'Granted delegated permission'
    end,
    case when v_permission.status = 'active' then 'warning' else 'info' end,
    jsonb_build_object(
      'permissionKey', v_permission.permission_key,
      'scopeType', v_permission.scope_type,
      'scopeId', v_permission.scope_id,
      'status', v_permission.status,
      'targetUserId', v_permission.user_id
    )
  );

  if v_permission.status = 'active' then
    perform public.m69_5_write_audit(
      p_tenant_id,
      'delegated_permission_activated',
      'delegated_permission',
      v_permission.id,
      'Delegated permission',
      'Activated delegated permission',
      'warning',
      jsonb_build_object(
        'permissionKey', v_permission.permission_key,
        'status', v_permission.status,
        'targetUserId', v_permission.user_id
      )
    );
  end if;

  return v_permission;
end;
$$;

create or replace function public.revoke_delegated_permission_secure(
  p_tenant_id uuid,
  p_permission_id uuid
)
returns public.delegated_permissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_permission public.delegated_permissions%rowtype;
begin
  v_actor_role := public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can revoke delegated permissions.'
  );

  select *
  into v_permission
  from public.delegated_permissions dp
  where dp.tenant_id = p_tenant_id
    and dp.id = p_permission_id;

  if not found then
    raise exception 'Delegated permission was not found.' using errcode = '22023';
  end if;

  if v_actor_role = 'admin'
     and (v_permission.status <> 'pending' or v_permission.granted_by <> auth.uid()) then
    raise exception 'Admins can only withdraw their own pending delegated permission requests.' using errcode = '42501';
  end if;

  update public.delegated_permissions dp
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = auth.uid()
  where dp.tenant_id = p_tenant_id
    and dp.id = p_permission_id
  returning * into v_permission;

  perform public.m69_5_write_audit(
    p_tenant_id,
    'delegated_permission_revoked',
    'delegated_permission',
    v_permission.id,
    'Delegated permission',
    'Revoked delegated permission',
    'critical',
    jsonb_build_object(
      'permissionKey', v_permission.permission_key,
      'scopeType', v_permission.scope_type,
      'scopeId', v_permission.scope_id,
      'status', v_permission.status,
      'targetUserId', v_permission.user_id
    )
  );

  return v_permission;
end;
$$;

create or replace function public.expire_delegated_permissions_secure(
  p_tenant_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  perform public.m69_5_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'Only owners and admins can expire delegated permissions.'
  );

  update public.delegated_permissions dp
  set status = 'expired'
  where dp.status = 'active'
    and dp.expires_at is not null
    and dp.expires_at <= now()
    and dp.tenant_id = p_tenant_id;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.m69_5_write_audit(
      p_tenant_id,
      'delegated_permission_expired',
      'delegated_permission',
      null,
      'Delegated permission',
      'Marked expired delegated permissions inactive',
      'warning',
      jsonb_build_object('expiredCount', v_count)
    );
  end if;

  return v_count;
end;
$$;

revoke execute on function public.m69_5_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_5_assert_member_role(uuid, text[], text) from public, anon, authenticated;
revoke execute on function public.m69_5_validate_member_role(text) from public, anon, authenticated;
revoke execute on function public.m69_5_validate_invitation_role(text) from public, anon, authenticated;
revoke execute on function public.m69_5_validate_email(text) from public, anon, authenticated;
revoke execute on function public.m69_5_create_invite_token() from public, anon, authenticated;
revoke execute on function public.m69_5_assert_tenant_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_5_assert_tenant_member_by_id(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_5_assert_active_trainer(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_5_assert_course_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_5_assert_cohort_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_5_validate_delegated_permission_key(text) from public, anon, authenticated;
revoke execute on function public.m69_5_validate_scope(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.m69_5_write_audit(uuid, text, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.update_tenant_member_role_secure(uuid, uuid, text) from public, anon;
revoke execute on function public.remove_tenant_member_secure(uuid, uuid) from public, anon;
revoke execute on function public.create_team_invitation_secure(uuid, text, text) from public, anon;
revoke execute on function public.cancel_team_invitation_secure(uuid) from public, anon;
revoke execute on function public.resend_team_invitation_secure(uuid) from public, anon;
revoke execute on function public.assign_trainer_to_course_secure(uuid, uuid, uuid) from public, anon;
revoke execute on function public.remove_trainer_from_course_secure(uuid, uuid, uuid) from public, anon;
revoke execute on function public.assign_trainer_to_cohort_secure(uuid, uuid, uuid) from public, anon;
revoke execute on function public.remove_trainer_from_cohort_secure(uuid, uuid, uuid) from public, anon;
revoke execute on function public.grant_delegated_permission_secure(uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, jsonb) from public, anon;
revoke execute on function public.revoke_delegated_permission_secure(uuid, uuid) from public, anon;
revoke execute on function public.expire_delegated_permissions_secure(uuid) from public, anon;

grant execute on function public.update_tenant_member_role_secure(uuid, uuid, text) to authenticated;
grant execute on function public.remove_tenant_member_secure(uuid, uuid) to authenticated;
grant execute on function public.create_team_invitation_secure(uuid, text, text) to authenticated;
grant execute on function public.cancel_team_invitation_secure(uuid) to authenticated;
grant execute on function public.resend_team_invitation_secure(uuid) to authenticated;
grant execute on function public.assign_trainer_to_course_secure(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_trainer_from_course_secure(uuid, uuid, uuid) to authenticated;
grant execute on function public.assign_trainer_to_cohort_secure(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_trainer_from_cohort_secure(uuid, uuid, uuid) to authenticated;
grant execute on function public.grant_delegated_permission_secure(uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, jsonb) to authenticated;
grant execute on function public.revoke_delegated_permission_secure(uuid, uuid) to authenticated;
grant execute on function public.expire_delegated_permissions_secure(uuid) to authenticated;

commit;
