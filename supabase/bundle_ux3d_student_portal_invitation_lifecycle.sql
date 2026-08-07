-- Bundle UX-3D: Student portal invitation and access lifecycle.
-- Proposal only. Review before execution.
--
-- This migration creates no Auth users, sends no email, and stores no raw
-- invitation token. A future authenticated server route must generate a
-- cryptographically random token, pass only its lowercase SHA-256 hex digest
-- to the service-only RPCs, and keep the raw token only long enough to build
-- the invitation URL.

begin;

-- ---------------------------------------------------------------------------
-- 1. Student portal invitation ledger
-- ---------------------------------------------------------------------------

create table if not exists public.student_portal_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  student_id uuid not null,
  enrollment_request_id uuid,
  enrollment_id uuid,
  invited_email text not null,
  token_hash text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  sent_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  attempt_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_portal_invitations_tenant_fkey
    foreign key (tenant_id)
    references public.tenants(id)
    on delete cascade,
  constraint student_portal_invitations_student_fkey
    foreign key (student_id)
    references public.students(id)
    on delete cascade,
  constraint student_portal_invitations_request_fkey
    foreign key (enrollment_request_id)
    references public.public_site_leads(id)
    on delete set null,
  constraint student_portal_invitations_enrollment_fkey
    foreign key (enrollment_id)
    references public.enrollments(id)
    on delete set null,
  constraint student_portal_invitations_created_by_fkey
    foreign key (created_by)
    references auth.users(id)
    on delete set null,
  constraint student_portal_invitations_status_check
    check (
      status in ('pending', 'sent', 'accepted', 'expired', 'revoked', 'failed')
    ),
  constraint student_portal_invitations_email_check
    check (
      invited_email = lower(btrim(invited_email))
      and char_length(invited_email) between 3 and 254
      and invited_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint student_portal_invitations_token_hash_check
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint student_portal_invitations_attempt_count_check
    check (attempt_count >= 0),
  constraint student_portal_invitations_expiry_check
    check (expires_at > created_at),
  constraint student_portal_invitations_error_code_check
    check (
      last_error_code is null
      or last_error_code ~ '^[a-z0-9_:-]{1,80}$'
    ),
  constraint student_portal_invitations_state_timestamps_check
    check (
      (status <> 'sent' or sent_at is not null)
      and (status <> 'accepted' or accepted_at is not null)
      and (status <> 'revoked' or revoked_at is not null)
      and (status <> 'failed' or failed_at is not null)
    )
);

comment on table public.student_portal_invitations is
  'Hashed-token lifecycle records for server-orchestrated student portal invitations. Raw invitation tokens must never be stored.';

drop trigger if exists set_student_portal_invitations_updated_at
on public.student_portal_invitations;

create trigger set_student_portal_invitations_updated_at
before update on public.student_portal_invitations
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Uniqueness and lookup indexes
-- ---------------------------------------------------------------------------

create unique index if not exists student_portal_invitations_token_hash_uidx
on public.student_portal_invitations (token_hash);

create unique index if not exists student_portal_invitations_active_uidx
on public.student_portal_invitations (
  tenant_id,
  student_id,
  invited_email
)
where status in ('pending', 'sent');

create index if not exists student_portal_invitations_tenant_status_created_idx
on public.student_portal_invitations (tenant_id, status, created_at desc);

create index if not exists student_portal_invitations_tenant_student_idx
on public.student_portal_invitations (tenant_id, student_id, created_at desc);

create index if not exists student_portal_invitations_request_idx
on public.student_portal_invitations (enrollment_request_id)
where enrollment_request_id is not null;

-- ---------------------------------------------------------------------------
-- 3. RLS and table grants
-- ---------------------------------------------------------------------------

alter table public.student_portal_invitations enable row level security;

-- No browser policy is created. Coaches use the summary RPC, and students do
-- not read raw invitation rows. Service-side orchestration uses only the
-- explicitly retained table operations below.
revoke all privileges on table public.student_portal_invitations
from public, anon, authenticated, service_role;

grant select, insert, update
on table public.student_portal_invitations
to service_role;

revoke truncate, trigger, references, maintain
on table public.student_portal_invitations
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Owner/Admin invitation summary
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
  elsif v_invitation.status = 'pending' then
    v_status := 'invitation_pending';
  elsif v_invitation.status = 'sent' then
    v_status := 'invitation_sent';
  elsif v_invitation.status = 'accepted' then
    -- An accepted invitation without active access requires repair rather than
    -- another invitation.
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
-- 5. Service-only invitation preparation
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
      'access_status', 'access_active'
    );
  end if;

  if found and v_portal_account.status = 'revoked' then
    return jsonb_build_object(
      'invitation_id', null,
      'status', 'needs_attention',
      'expires_at', null,
      'reused', true,
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
    -- Accepted access is repaired through a separate reviewed workflow. A
    -- replacement invitation must not silently relink or reactivate it.
    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', 'accepted',
      'expires_at', v_invitation.expires_at,
      'reused', true,
      'access_status', 'needs_attention'
    );
  end if;

  -- Expiry is persisted only from a service-side lifecycle operation. The
  -- summary RPC derives the same state without mutating data.
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
    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', v_invitation.status,
      'expires_at', v_invitation.expires_at,
      'reused', true,
      'access_status', case
        when v_invitation.status = 'sent' then 'invitation_sent'
        else 'invitation_pending'
      end
    );
  end if;

  -- A failed, still-valid row is reused with a fresh digest. This permits a
  -- new raw token to be generated without accumulating duplicate rows.
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

-- ---------------------------------------------------------------------------
-- 6. Service-only delivery state
-- ---------------------------------------------------------------------------

create or replace function public.record_student_portal_invitation_delivery_secure(
  p_invitation_id uuid,
  p_delivery_result text,
  p_error_code text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.student_portal_invitations%rowtype;
  v_delivery_result text := lower(btrim(coalesce(p_delivery_result, '')));
  v_error_code text := lower(nullif(btrim(coalesce(p_error_code, '')), ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server authorization required.' using errcode = '42501';
  end if;

  if v_delivery_result not in ('sent', 'failed') then
    raise exception 'Delivery result must be sent or failed.' using errcode = '22023';
  end if;

  if v_error_code is not null
     and v_error_code !~ '^[a-z0-9_:-]{1,80}$' then
    raise exception 'Delivery error code is invalid.' using errcode = '22023';
  end if;

  select i.*
  into v_invitation
  from public.student_portal_invitations as i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'Student portal invitation not found.' using errcode = '22023';
  end if;

  if v_invitation.status in ('pending', 'sent', 'failed')
     and v_invitation.expires_at <= now() then
    update public.student_portal_invitations as i
    set
      status = 'expired',
      last_error_code = null
    where i.id = v_invitation.id
    returning i.* into v_invitation;

    perform public.m69_1_write_audit(
      v_invitation.tenant_id,
      'student_portal_invitation_expired',
      'student_portal_invitation',
      v_invitation.id,
      'Student portal invitation',
      'Marked student portal invitation as expired.',
      'info',
      jsonb_build_object(
        'invitationId', v_invitation.id,
        'studentId', v_invitation.student_id,
        'invitationStatus', 'expired'
      )
    );

    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', 'expired',
      'attempt_count', v_invitation.attempt_count,
      'access_status', 'invitation_expired'
    );
  end if;

  if v_invitation.status in ('accepted', 'expired', 'revoked') then
    raise exception 'This invitation cannot record another delivery attempt.'
      using errcode = '22023';
  end if;

  if v_delivery_result = 'sent' then
    update public.student_portal_invitations as i
    set
      status = 'sent',
      sent_at = now(),
      failed_at = null,
      last_error_code = null,
      attempt_count = i.attempt_count + 1
    where i.id = v_invitation.id
    returning i.* into v_invitation;
  else
    update public.student_portal_invitations as i
    set
      status = 'failed',
      failed_at = now(),
      last_error_code = coalesce(v_error_code, 'delivery_failed'),
      attempt_count = i.attempt_count + 1
    where i.id = v_invitation.id
    returning i.* into v_invitation;
  end if;

  perform public.m69_1_write_audit(
    v_invitation.tenant_id,
    'student_portal_invitation_delivery_recorded',
    'student_portal_invitation',
    v_invitation.id,
    'Student portal invitation',
    'Recorded student portal invitation delivery state.',
    case when v_invitation.status = 'failed' then 'warning' else 'info' end,
    jsonb_build_object(
      'invitationId', v_invitation.id,
      'studentId', v_invitation.student_id,
      'invitationStatus', v_invitation.status,
      'attemptCount', v_invitation.attempt_count,
      'errorCode', v_invitation.last_error_code
    )
  );

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'status', v_invitation.status,
    'sent_at', v_invitation.sent_at,
    'failed_at', v_invitation.failed_at,
    'attempt_count', v_invitation.attempt_count,
    'access_status', case
      when v_invitation.status = 'sent' then 'invitation_sent'
      else 'needs_attention'
    end
  );
end;
$$;

revoke execute on function public.record_student_portal_invitation_delivery_secure(
  uuid, text, text
) from public, anon, authenticated;

grant execute on function public.record_student_portal_invitation_delivery_secure(
  uuid, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Service-only acceptance and portal-account linking
-- ---------------------------------------------------------------------------
-- A future Next.js route must authenticate the browser request with the normal
-- user-scoped Supabase client, hash the submitted raw token with SHA-256, and
-- call this RPC through the server-only service-role client. The RPC receives
-- no raw token and independently verifies the supplied user against auth.users.

create or replace function public.accept_student_portal_invitation_secure(
  p_token_hash text,
  p_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_token_hash text := lower(nullif(btrim(coalesce(p_token_hash, '')), ''));
  v_user_email text;
  v_invitation public.student_portal_invitations%rowtype;
  v_student public.students%rowtype;
  v_request public.public_site_leads%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_portal_account public.student_portal_accounts%rowtype;
  v_other_account public.student_portal_accounts%rowtype;
  v_account_action text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server authorization required.' using errcode = '42501';
  end if;

  if v_token_hash is null or v_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invitation is invalid.' using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'Authenticated student identity is required.'
      using errcode = '22023';
  end if;

  select i.*
  into v_invitation
  from public.student_portal_invitations as i
  where i.token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'Invitation is invalid.' using errcode = '22023';
  end if;

  if v_invitation.status = 'accepted' then
    select spa.*
    into v_portal_account
    from public.student_portal_accounts as spa
    where spa.tenant_id = v_invitation.tenant_id
      and spa.student_id = v_invitation.student_id
      and spa.user_id = p_user_id
      and spa.status = 'active'
    for share;

    if found then
      return jsonb_build_object(
        'invitation_id', v_invitation.id,
        'status', 'accepted',
        'access_status', 'access_active',
        'replayed', true
      );
    end if;

    raise exception 'Accepted invitation access needs support review.'
      using errcode = '22023';
  end if;

  if v_invitation.status in ('pending', 'sent', 'failed')
     and v_invitation.expires_at <= now() then
    update public.student_portal_invitations as i
    set
      status = 'expired',
      last_error_code = null
    where i.id = v_invitation.id
    returning i.* into v_invitation;

    perform public.m69_1_write_audit(
      v_invitation.tenant_id,
      'student_portal_invitation_expired',
      'student_portal_invitation',
      v_invitation.id,
      'Student portal invitation',
      'Marked student portal invitation as expired during access verification.',
      'info',
      jsonb_build_object(
        'invitationId', v_invitation.id,
        'studentId', v_invitation.student_id,
        'invitationStatus', 'expired'
      )
    );

    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', 'expired',
      'access_status', 'invitation_expired',
      'replayed', false
    );
  end if;

  if v_invitation.status = 'expired' then
    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', 'expired',
      'access_status', 'invitation_expired',
      'replayed', false
    );
  end if;

  if v_invitation.status = 'revoked' then
    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'status', 'revoked',
      'access_status', 'needs_attention',
      'replayed', false
    );
  end if;

  select lower(nullif(btrim(u.email), ''))
  into v_user_email
  from auth.users as u
  where u.id = p_user_id;

  if not found or v_user_email is null then
    raise exception 'Authenticated student identity was not found.'
      using errcode = '22023';
  end if;

  if v_user_email is distinct from v_invitation.invited_email then
    raise exception 'Sign in with the email address that received this invitation.'
      using errcode = '42501';
  end if;

  select s.*
  into v_student
  from public.students as s
  where s.id = v_invitation.student_id
    and s.tenant_id = v_invitation.tenant_id
  for share;

  if not found
     or v_student.status <> 'active'
     or not v_student.portal_enabled then
    raise exception 'Student access needs support review.' using errcode = '22023';
  end if;

  if lower(nullif(btrim(v_student.email), '')) is distinct from v_user_email then
    raise exception 'Student email no longer matches this invitation.'
      using errcode = '42501';
  end if;

  if v_invitation.enrollment_request_id is not null then
    select l.*
    into v_request
    from public.public_site_leads as l
    where l.id = v_invitation.enrollment_request_id
      and l.tenant_id = v_invitation.tenant_id
      and l.enrollment_request_status = 'enrolled'
      and l.converted_student_id = v_invitation.student_id
    for share;

    if not found then
      raise exception 'Enrollment request access needs support review.'
        using errcode = '22023';
    end if;

    if v_request.converted_enrollment_id is null
       or v_request.converted_enrollment_id is distinct from v_invitation.enrollment_id then
      raise exception 'Enrollment request access needs support review.'
        using errcode = '22023';
    end if;
  end if;

  if v_invitation.enrollment_id is not null then
    select e.*
    into v_enrollment
    from public.enrollments as e
    where e.id = v_invitation.enrollment_id
      and e.tenant_id = v_invitation.tenant_id
      and e.student_id = v_invitation.student_id
      and e.status in ('active', 'completed')
    for share;

    if not found then
      raise exception 'Enrollment access needs support review.'
        using errcode = '22023';
    end if;

    if v_invitation.enrollment_request_id is not null
       and v_enrollment.course_id is distinct from v_request.interested_course_id then
      raise exception 'Enrollment access needs support review.'
        using errcode = '22023';
    end if;
  end if;

  -- Serialize both uniqueness dimensions before reading or creating the portal
  -- account. The table constraints remain the final database boundary.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_invitation.tenant_id::text
        || ':student-portal-student:'
        || v_invitation.student_id::text,
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_invitation.tenant_id::text
        || ':student-portal-user:'
        || p_user_id::text,
      0
    )
  );

  select spa.*
  into v_portal_account
  from public.student_portal_accounts as spa
  where spa.tenant_id = v_invitation.tenant_id
    and spa.student_id = v_invitation.student_id
  for update;

  if found then
    if v_portal_account.user_id is distinct from p_user_id then
      raise exception 'Student portal access is linked to another identity.'
        using errcode = '42501';
    end if;

    if v_portal_account.status = 'revoked' then
      raise exception 'Revoked student access requires support review.'
        using errcode = '42501';
    end if;

    update public.student_portal_accounts as spa
    set
      email = v_user_email,
      status = 'active',
      linked_by = p_user_id,
      linked_at = case
        when spa.status = 'active' then spa.linked_at
        else now()
      end
    where spa.id = v_portal_account.id
    returning spa.* into v_portal_account;

    v_account_action := 'reused';
  else
    select spa.*
    into v_other_account
    from public.student_portal_accounts as spa
    where spa.tenant_id = v_invitation.tenant_id
      and spa.user_id = p_user_id
    for update;

    if found then
      raise exception 'This identity is linked to another student in this workspace.'
        using errcode = '42501';
    end if;

    insert into public.student_portal_accounts (
      tenant_id,
      student_id,
      user_id,
      email,
      status,
      linked_by,
      linked_at,
      metadata_json
    )
    values (
      v_invitation.tenant_id,
      v_invitation.student_id,
      p_user_id,
      v_user_email,
      'active',
      p_user_id,
      now(),
      jsonb_build_object(
        'source', 'student_portal_invitation',
        'invitation_id', v_invitation.id
      )
    )
    returning * into v_portal_account;

    v_account_action := 'created';
  end if;

  update public.student_portal_invitations as i
  set
    status = 'accepted',
    accepted_at = now(),
    revoked_at = null,
    failed_at = null,
    last_error_code = null
  where i.id = v_invitation.id
  returning i.* into v_invitation;

  update public.student_portal_invitations as i
  set
    status = 'revoked',
    revoked_at = now(),
    last_error_code = null
  where i.tenant_id = v_invitation.tenant_id
    and i.student_id = v_invitation.student_id
    and i.id <> v_invitation.id
    and i.status in ('pending', 'sent');

  perform public.m69_1_write_audit(
    v_invitation.tenant_id,
    'student_portal_invitation_accepted',
    'student_portal_invitation',
    v_invitation.id,
    'Student portal invitation',
    'Accepted student portal invitation and activated access.',
    'info',
    jsonb_build_object(
      'invitationId', v_invitation.id,
      'requestId', v_invitation.enrollment_request_id,
      'studentId', v_invitation.student_id,
      'enrollmentId', v_invitation.enrollment_id,
      'invitationStatus', v_invitation.status,
      'portalAccountAction', v_account_action,
      'accessStatus', 'active'
    )
  );

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'status', v_invitation.status,
    'access_status', 'access_active',
    'replayed', false
  );
end;
$$;

revoke execute on function public.accept_student_portal_invitation_secure(
  text, uuid
) from public, anon, authenticated;

grant execute on function public.accept_student_portal_invitation_secure(
  text, uuid
) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- 8. Expiry, resend, and request-lifecycle behavior
-- ---------------------------------------------------------------------------
-- 1. Summary reads derive expiry without a write. Service lifecycle operations
--    persist pending/sent expiry before preparing or accepting an invitation.
-- 2. Expired invitations receive a new row and token digest.
-- 3. A failed, still-valid invitation row may be reset to pending with a new
--    digest by the preparation RPC. Delivery may also be retried with the same
--    token while the server still holds it in memory.
-- 4. Revoked invitations are never reused. A later reviewed server flow may
--    prepare a new row when no active portal account exists.
-- 5. Accepted access suppresses new invitations. Revoked portal access is not
--    reactivated by invitation preparation or acceptance.
-- 6. Enrollment approval remains enrolled even if preparation or delivery
--    later fails. Coach-facing portal state is derived from invitation/account
--    records rather than duplicated on public_site_leads.

-- ---------------------------------------------------------------------------
-- 9. Read-only post-apply verification
-- These statements return metadata and aggregate configuration only. They do
-- not invoke a business RPC or return invitation/student records.
-- ---------------------------------------------------------------------------

-- Table, columns, and absence of any raw-token column.
select
  c.table_schema,
  c.table_name,
  jsonb_agg(
    jsonb_build_object(
      'column_name', c.column_name,
      'data_type', c.data_type,
      'is_nullable', c.is_nullable,
      'column_default', c.column_default
    )
    order by c.ordinal_position
  ) as columns,
  count(*) filter (
    where c.column_name in ('token', 'raw_token', 'invitation_token')
  ) as raw_token_columns
from information_schema.columns as c
where c.table_schema = 'public'
  and c.table_name = 'student_portal_invitations'
group by c.table_schema, c.table_name;

-- Constraints and indexes, including global digest and active-invite
-- uniqueness.
select conname, contype, pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint
where conrelid = 'public.student_portal_invitations'::regclass
order by conname;

select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename = 'student_portal_invitations'
order by indexname;

-- RLS is enabled and no browser policy exposes invitation rows.
select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'policy_name', p.policyname,
          'roles', p.roles,
          'command', p.cmd
        )
        order by p.policyname
      )
      from pg_catalog.pg_policies as p
      where p.schemaname = 'public'
        and p.tablename = 'student_portal_invitations'
    ),
    '[]'::jsonb
  ) as policies
from pg_catalog.pg_class as c
where c.oid = 'public.student_portal_invitations'::regclass;

-- Dangerous grants must return zero rows.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'student_portal_invitations'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
order by grantee, privilege_type;

-- Browser access must be entirely absent; service_role keeps only the three
-- server-orchestration operations.
select
  has_table_privilege('anon', 'public.student_portal_invitations', 'SELECT')
    as anon_select,
  has_table_privilege('anon', 'public.student_portal_invitations', 'INSERT')
    as anon_insert,
  has_table_privilege('anon', 'public.student_portal_invitations', 'UPDATE')
    as anon_update,
  has_table_privilege('anon', 'public.student_portal_invitations', 'DELETE')
    as anon_delete,
  has_table_privilege('authenticated', 'public.student_portal_invitations', 'SELECT')
    as authenticated_select,
  has_table_privilege('authenticated', 'public.student_portal_invitations', 'INSERT')
    as authenticated_insert,
  has_table_privilege('authenticated', 'public.student_portal_invitations', 'UPDATE')
    as authenticated_update,
  has_table_privilege('authenticated', 'public.student_portal_invitations', 'DELETE')
    as authenticated_delete,
  has_table_privilege('service_role', 'public.student_portal_invitations', 'SELECT')
    as service_role_select,
  has_table_privilege('service_role', 'public.student_portal_invitations', 'INSERT')
    as service_role_insert,
  has_table_privilege('service_role', 'public.student_portal_invitations', 'UPDATE')
    as service_role_update,
  has_table_privilege('service_role', 'public.student_portal_invitations', 'DELETE')
    as service_role_delete;

-- Function identity, SECURITY DEFINER/search_path, and effective execute grants.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer,
  p.proconfig as function_configuration,
  exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) as acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')
    as service_role_can_execute
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_student_portal_invitation_status',
    'prepare_student_portal_invitation_secure',
    'record_student_portal_invitation_delivery_secure',
    'accept_student_portal_invitation_secure'
  )
order by p.proname, identity_arguments;

-- Existing student portal browser writes remain revoked.
select
  has_table_privilege('anon', 'public.student_portal_accounts', 'INSERT')
    as anon_insert,
  has_table_privilege('anon', 'public.student_portal_accounts', 'UPDATE')
    as anon_update,
  has_table_privilege('anon', 'public.student_portal_accounts', 'DELETE')
    as anon_delete,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'INSERT')
    as authenticated_insert,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'UPDATE')
    as authenticated_update,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'DELETE')
    as authenticated_delete;

-- ---------------------------------------------------------------------------
-- 10. Rollback notes (guidance only; review separately before any rollback)
-- ---------------------------------------------------------------------------
-- 1. Do not restore browser table writes or expose invitation rows directly.
-- 2. Revoke function execution before removing a server integration. Keep
--    accepted portal-account rows; do not delete working access as rollback.
-- 3. Do not store raw tokens as a compatibility fallback.
-- 4. Do not weaken the existing tenant/student and tenant/user portal-account
--    uniqueness constraints.
-- 5. Preserve invitation rows containing lifecycle history until a reviewed
--    retention/export plan exists. Do not drop the table after customer use
--    without an explicit backup and migration plan.
