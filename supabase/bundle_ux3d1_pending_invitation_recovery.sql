-- Bundle UX-3D1: Recover interrupted pending student portal invitations.
-- Additive follow-up to Bundle UX-3D. Review before execution.
--
-- Raw invitation tokens remain server-memory only. This migration adds an
-- explicit token_ready response contract and permits a locked pending row to
-- receive a fresh digest only after it has been unchanged for two minutes.

begin;

-- ---------------------------------------------------------------------------
-- 1. Coach-facing summary: stale pending invitations are retryable
-- ---------------------------------------------------------------------------

create or replace function public.get_student_portal_invitation_status(
  p_tenant_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_invitation public.student_portal_invitations%rowtype;
  v_status text;
  v_can_resend boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    v_actor,
    array['owner', 'admin']
  ) then
    raise exception
      'Only workspace owners and admins can view student invitation status.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.students as s
    where s.id = p_student_id
      and s.tenant_id = p_tenant_id
  ) then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.student_portal_accounts as spa
    where spa.tenant_id = p_tenant_id
      and spa.student_id = p_student_id
      and spa.status = 'active'
  ) then
    return jsonb_build_object(
      'status', 'access_active',
      'sent_at', null,
      'expires_at', null,
      'accepted_at', null,
      'attempt_count', 0,
      'can_resend', false
    );
  end if;

  select i.*
  into v_invitation
  from public.student_portal_invitations as i
  where i.tenant_id = p_tenant_id
    and i.student_id = p_student_id
  order by i.created_at desc, i.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'invitation_not_sent',
      'sent_at', null,
      'expires_at', null,
      'accepted_at', null,
      'attempt_count', 0,
      'can_resend', true
    );
  end if;

  if v_invitation.status in ('pending', 'sent', 'failed')
     and v_invitation.expires_at <= now() then
    v_status := 'invitation_expired';
    v_can_resend := true;
  elsif v_invitation.status = 'pending'
        and v_invitation.updated_at <= now() - interval '2 minutes' then
    v_status := 'needs_attention';
    v_can_resend := true;
  elsif v_invitation.status = 'pending' then
    v_status := 'invitation_pending';
  elsif v_invitation.status = 'sent' then
    v_status := 'invitation_sent';
  elsif v_invitation.status = 'accepted' then
    v_status := 'needs_attention';
  elsif v_invitation.status = 'expired' then
    v_status := 'invitation_expired';
    v_can_resend := true;
  else
    v_status := 'needs_attention';
    v_can_resend := v_invitation.status in ('failed', 'revoked');
  end if;

  return jsonb_build_object(
    'status', v_status,
    'sent_at', v_invitation.sent_at,
    'expires_at', v_invitation.expires_at,
    'accepted_at', v_invitation.accepted_at,
    'attempt_count', v_invitation.attempt_count,
    'can_resend', v_can_resend
  );
end;
$$;

revoke execute on function public.get_student_portal_invitation_status(
  uuid, uuid
) from public, anon, service_role;

grant execute on function public.get_student_portal_invitation_status(
  uuid, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Service-only prepare: explicit token ownership and stale recovery
-- ---------------------------------------------------------------------------

create or replace function public.prepare_student_portal_invitation_secure(
  p_tenant_id uuid,
  p_student_id uuid,
  p_invited_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_enrollment_request_id uuid default null,
  p_enrollment_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
  v_request public.public_site_leads%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_portal_account public.student_portal_accounts%rowtype;
  v_invitation public.student_portal_invitations%rowtype;
  v_email text;
  v_token_hash text;
  v_enrollment_id uuid := p_enrollment_id;
  v_reused boolean := false;
  v_action text := 'created';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server authorization required.' using errcode = '42501';
  end if;

  if p_tenant_id is null or p_student_id is null then
    raise exception 'Workspace and student are required.' using errcode = '22023';
  end if;

  v_email := lower(nullif(btrim(coalesce(p_invited_email, '')), ''));
  v_token_hash := lower(nullif(btrim(coalesce(p_token_hash, '')), ''));

  if v_email is null
     or char_length(v_email) > 254
     or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid student email is required.' using errcode = '22023';
  end if;

  if v_token_hash is null or v_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invitation token digest is invalid.' using errcode = '22023';
  end if;

  if p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '30 days' then
    raise exception 'Invitation expiry must be within the next 30 days.'
      using errcode = '22023';
  end if;

  select s.*
  into v_student
  from public.students as s
  where s.id = p_student_id
    and s.tenant_id = p_tenant_id
  for share;

  if not found then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  if v_student.status <> 'active' then
    raise exception 'Student must be active before portal access is invited.'
      using errcode = '22023';
  end if;

  if not v_student.portal_enabled then
    raise exception 'Student portal access is disabled for this student.'
      using errcode = '22023';
  end if;

  if lower(nullif(btrim(v_student.email), '')) is distinct from v_email then
    raise exception 'Invitation email must match the active student email.'
      using errcode = '22023';
  end if;

  if p_enrollment_request_id is not null then
    select l.*
    into v_request
    from public.public_site_leads as l
    where l.id = p_enrollment_request_id
      and l.tenant_id = p_tenant_id
      and l.enrollment_request_status = 'enrolled'
      and l.converted_student_id = p_student_id
    for share;

    if not found then
      raise exception 'Enrolled request not found for this student.'
        using errcode = '22023';
    end if;

    if p_enrollment_id is not null
       and v_request.converted_enrollment_id is distinct from p_enrollment_id then
      raise exception 'Enrollment does not match the enrollment request.'
        using errcode = '22023';
    end if;

    v_enrollment_id := coalesce(
      p_enrollment_id,
      v_request.converted_enrollment_id
    );

    if v_enrollment_id is null then
      raise exception 'Enrollment request access needs support review.'
        using errcode = '22023';
    end if;
  end if;

  if v_enrollment_id is not null then
    select e.*
    into v_enrollment
    from public.enrollments as e
    where e.id = v_enrollment_id
      and e.tenant_id = p_tenant_id
      and e.student_id = p_student_id
      and e.status in ('active', 'completed')
    for share;

    if not found then
      raise exception 'Active enrollment not found for this student.'
        using errcode = '22023';
    end if;

    if p_enrollment_request_id is not null
       and v_enrollment.course_id is distinct from v_request.interested_course_id then
      raise exception 'Enrollment does not match the requested program.'
        using errcode = '22023';
    end if;
  end if;

  select spa.*
  into v_portal_account
  from public.student_portal_accounts as spa
  where spa.tenant_id = p_tenant_id
    and spa.student_id = p_student_id
  for share;

  if found and v_portal_account.status = 'active' then
    return jsonb_build_object(
      'invitation_id', null,
      'status', 'accepted',
      'expires_at', null,
      'reused', true,
      'token_ready', false,
      'access_status', 'access_active'
    );
  end if;

  if found and v_portal_account.status = 'revoked' then
    return jsonb_build_object(
      'invitation_id', null,
      'status', 'needs_attention',
      'expires_at', null,
      'reused', true,
      'token_ready', false,
      'access_status', 'needs_attention'
    );
  end if;

  select i.*
  into v_invitation
  from public.student_portal_invitations as i
  where i.tenant_id = p_tenant_id
    and i.student_id = p_student_id
    and i.status = 'accepted'
  order by i.accepted_at desc nulls last, i.created_at desc, i.id desc
  limit 1
  for share;

  if found then
    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', 'accepted',
      'expires_at', v_invitation.expires_at,
      'reused', true,
      'token_ready', false,
      'access_status', 'needs_attention'
    );
  end if;

  update public.student_portal_invitations as i
  set
    status = 'expired',
    last_error_code = null
  where i.tenant_id = p_tenant_id
    and i.student_id = p_student_id
    and i.invited_email = v_email
    and i.status in ('pending', 'sent')
    and i.expires_at <= now();

  select i.*
  into v_invitation
  from public.student_portal_invitations as i
  where i.tenant_id = p_tenant_id
    and i.student_id = p_student_id
    and i.invited_email = v_email
    and i.status in ('pending', 'sent')
    and i.expires_at > now()
  order by i.created_at desc, i.id desc
  limit 1
  for update;

  if found then
    if v_invitation.status = 'pending'
       and v_invitation.updated_at <= now() - interval '2 minutes' then
      update public.student_portal_invitations as i
      set
        enrollment_request_id = coalesce(
          p_enrollment_request_id,
          i.enrollment_request_id
        ),
        enrollment_id = coalesce(v_enrollment_id, i.enrollment_id),
        token_hash = v_token_hash,
        status = 'pending',
        expires_at = p_expires_at,
        sent_at = null,
        accepted_at = null,
        revoked_at = null,
        failed_at = null,
        last_error_code = null
      where i.id = v_invitation.id
      returning i.* into v_invitation;

      v_reused := true;
      v_action := 'recovered';
    else
      return jsonb_build_object(
        'invitation_id', v_invitation.id,
        'status', v_invitation.status,
        'expires_at', v_invitation.expires_at,
        'reused', true,
        'token_ready', false,
        'access_status', case
          when v_invitation.status = 'sent' then 'invitation_sent'
          else 'invitation_pending'
        end
      );
    end if;
  else
    select i.*
    into v_invitation
    from public.student_portal_invitations as i
    where i.tenant_id = p_tenant_id
      and i.student_id = p_student_id
      and i.invited_email = v_email
      and i.status = 'failed'
      and i.expires_at > now()
    order by i.failed_at desc nulls last, i.created_at desc, i.id desc
    limit 1
    for update;

    if found then
      update public.student_portal_invitations as i
      set
        enrollment_request_id = coalesce(
          p_enrollment_request_id,
          i.enrollment_request_id
        ),
        enrollment_id = coalesce(v_enrollment_id, i.enrollment_id),
        token_hash = v_token_hash,
        status = 'pending',
        expires_at = p_expires_at,
        sent_at = null,
        accepted_at = null,
        revoked_at = null,
        failed_at = null,
        last_error_code = null
      where i.id = v_invitation.id
      returning i.* into v_invitation;

      v_reused := true;
      v_action := 'retried';
    else
      insert into public.student_portal_invitations (
        tenant_id,
        student_id,
        enrollment_request_id,
        enrollment_id,
        invited_email,
        token_hash,
        status,
        expires_at,
        created_by
      )
      values (
        p_tenant_id,
        p_student_id,
        p_enrollment_request_id,
        v_enrollment_id,
        v_email,
        v_token_hash,
        'pending',
        p_expires_at,
        null
      )
      returning * into v_invitation;
    end if;
  end if;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'student_portal_invitation_prepared',
    'student_portal_invitation',
    v_invitation.id,
    'Student portal invitation',
    'Prepared student portal invitation delivery.',
    'info',
    jsonb_build_object(
      'invitationId', v_invitation.id,
      'requestId', p_enrollment_request_id,
      'studentId', p_student_id,
      'enrollmentId', v_enrollment_id,
      'invitationAction', v_action,
      'invitationStatus', v_invitation.status
    )
  );

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'status', v_invitation.status,
    'expires_at', v_invitation.expires_at,
    'reused', v_reused,
    'token_ready', true,
    'access_status', 'invitation_pending'
  );
end;
$$;

revoke execute on function public.prepare_student_portal_invitation_secure(
  uuid, uuid, text, text, timestamptz, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.prepare_student_portal_invitation_secure(
  uuid, uuid, text, text, timestamptz, uuid, uuid
) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- 3. Read-only post-apply verification
-- ---------------------------------------------------------------------------

select
  p.oid::regprocedure::text as identity,
  p.prosecdef as security_definer,
  p.proconfig as configured_settings,
  exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        p.proacl,
        pg_catalog.acldefault('f', p.proowner)
      )
    ) as acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  pg_get_functiondef(p.oid) like '%token_ready%' as token_ready_contract_present,
  pg_get_functiondef(p.oid) like '%interval ''2 minutes''%' as stale_window_present
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_student_portal_invitation_status',
    'prepare_student_portal_invitation_secure'
  )
order by p.proname;

select
  count(*) filter (
    where status = 'pending'
      and expires_at > now()
      and updated_at > now() - interval '2 minutes'
  ) as recent_pending_count,
  count(*) filter (
    where status = 'pending'
      and expires_at > now()
      and updated_at <= now() - interval '2 minutes'
  ) as recoverable_pending_count
from public.student_portal_invitations;

select
  c.relrowsecurity as rls_enabled,
  (
    select count(*)
    from pg_catalog.aclexplode(
      coalesce(
        c.relacl,
        pg_catalog.acldefault('r', c.relowner)
      )
    ) as acl
    where acl.privilege_type in (
      'TRUNCATE',
      'TRIGGER',
      'REFERENCES',
      'MAINTAIN'
    )
      and (
        acl.grantee = 0
        or exists (
          select 1
          from pg_catalog.pg_roles as r
          where r.oid = acl.grantee
            and r.rolname in ('anon', 'authenticated', 'service_role')
        )
      )
  ) as dangerous_grant_count,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete,
  has_table_privilege('service_role', c.oid, 'SELECT') as service_select,
  has_table_privilege('service_role', c.oid, 'INSERT') as service_insert,
  has_table_privilege('service_role', c.oid, 'UPDATE') as service_update,
  has_table_privilege('service_role', c.oid, 'DELETE') as service_delete_access
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'student_portal_invitations';

-- Rollback guidance:
-- Reapply the previously reviewed UX-3D function definitions only if a
-- production incident requires reverting this behavior. Do not restore
-- browser table access, store raw tokens, or remove invitation history.
