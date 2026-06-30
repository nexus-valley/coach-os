-- Module 69.3: Sessions and attendance secure write RPCs.
-- This migration is additive. It intentionally does not revoke existing direct
-- table grants; those revokes must wait until replacement flows are proven
-- in production.

begin;

create or replace function public.m69_3_current_role(p_tenant_id uuid)
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

create or replace function public.m69_3_assert_manage_attendance(p_tenant_id uuid)
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

  v_role := public.m69_3_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin', 'trainer') then
    raise exception 'You do not have permission to manage sessions or attendance.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m69_3_normalize_text(
  p_value text,
  p_label text,
  p_required boolean,
  p_max_length integer
)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_required and v_value is null then
    raise exception '% is required.', p_label using errcode = '22023';
  end if;

  if v_value is not null and char_length(v_value) > p_max_length then
    raise exception '% is too long.', p_label using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_3_validate_session_status(p_status text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'scheduled')));
begin
  if v_status not in ('scheduled', 'completed', 'canceled') then
    raise exception 'Invalid session status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_3_validate_attendance_status(p_status text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_status not in ('present', 'absent', 'late', 'excused') then
    raise exception 'Invalid attendance status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_3_validate_delivery_mode(p_delivery_mode text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_delivery_mode text := lower(trim(coalesce(p_delivery_mode, 'offline')));
begin
  if v_delivery_mode not in ('online', 'offline', 'hybrid') then
    raise exception 'Invalid session delivery mode.' using errcode = '22023';
  end if;

  return v_delivery_mode;
end;
$$;

create or replace function public.m69_3_validate_meeting_provider(p_meeting_provider text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_provider text := nullif(trim(coalesce(p_meeting_provider, '')), '');
begin
  if v_provider is not null
     and v_provider not in ('zoom', 'google_meet', 'microsoft_teams', 'custom') then
    raise exception 'Invalid meeting provider.' using errcode = '22023';
  end if;

  return v_provider;
end;
$$;

create or replace function public.m69_3_validate_url(p_value text, p_label text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v_value is null then
    return null;
  end if;

  if char_length(v_value) > 1000 then
    raise exception '% is too long.', p_label using errcode = '22023';
  end if;

  if v_value !~* '^https?://' then
    raise exception '% must be a valid http or https URL.', p_label using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_3_assert_course_in_tenant(
  p_tenant_id uuid,
  p_course_id uuid
)
returns public.courses
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
begin
  if p_course_id is null then
    return null;
  end if;

  select *
  into v_course
  from public.courses as c
  where c.tenant_id = p_tenant_id
    and c.id = p_course_id;

  if not found then
    raise exception 'Course not found in this workspace.' using errcode = '22023';
  end if;

  return v_course;
end;
$$;

create or replace function public.m69_3_assert_cohort_in_tenant(
  p_tenant_id uuid,
  p_cohort_id uuid
)
returns public.cohorts
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cohort public.cohorts%rowtype;
begin
  if p_cohort_id is null then
    return null;
  end if;

  select *
  into v_cohort
  from public.cohorts as c
  where c.tenant_id = p_tenant_id
    and c.id = p_cohort_id;

  if not found then
    raise exception 'Cohort not found in this workspace.' using errcode = '22023';
  end if;

  return v_cohort;
end;
$$;

create or replace function public.m69_3_assert_course_cohort_consistency(
  p_tenant_id uuid,
  p_course_id uuid,
  p_cohort_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_course_id is null or p_cohort_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.cohorts c
    where c.tenant_id = p_tenant_id
      and c.id = p_cohort_id
      and c.course_id = p_course_id
  ) then
    raise exception 'Cohort does not belong to the selected course.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.m69_3_assert_session_in_tenant(
  p_tenant_id uuid,
  p_session_id uuid
)
returns public.sessions
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
begin
  select *
  into v_session
  from public.sessions as s
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id;

  if not found then
    raise exception 'Session not found in this workspace.' using errcode = '22023';
  end if;

  return v_session;
end;
$$;

create or replace function public.m69_3_trainer_can_manage_scope(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_course_id uuid,
  p_cohort_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      p_course_id is not null
      and exists (
        select 1
        from public.trainer_course_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.trainer_user_id = p_trainer_user_id
          and tca.course_id = p_course_id
      )
    )
    or
    (
      p_cohort_id is not null
      and exists (
        select 1
        from public.trainer_cohort_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.trainer_user_id = p_trainer_user_id
          and tca.cohort_id = p_cohort_id
      )
    ),
    false
  )
$$;

create or replace function public.m69_3_assert_can_manage_scope(
  p_tenant_id uuid,
  p_role text,
  p_course_id uuid,
  p_cohort_id uuid,
  p_trainer_user_id uuid,
  p_require_trainer_self boolean default true
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_role in ('owner', 'admin') then
    return;
  end if;

  if p_role = 'trainer' then
    if p_require_trainer_self and p_trainer_user_id is not null and p_trainer_user_id <> auth.uid() then
      raise exception 'Trainers can only manage their own assigned sessions.' using errcode = '42501';
    end if;

    if public.m69_3_trainer_can_manage_scope(p_tenant_id, auth.uid(), p_course_id, p_cohort_id) then
      return;
    end if;
  end if;

  raise exception 'You do not have permission to manage this session scope.' using errcode = '42501';
end;
$$;

create or replace function public.m69_3_assert_student_in_session_roster(
  p_tenant_id uuid,
  p_session public.sessions,
  p_student_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.students st
    where st.tenant_id = p_tenant_id
      and st.id = p_student_id
  ) then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  if p_session.cohort_id is not null then
    if exists (
      select 1
      from public.cohort_members cm
      where cm.tenant_id = p_tenant_id
        and cm.cohort_id = p_session.cohort_id
        and cm.student_id = p_student_id
    ) then
      return;
    end if;
  elsif p_session.course_id is not null then
    if exists (
      select 1
      from public.enrollments e
      where e.tenant_id = p_tenant_id
        and e.course_id = p_session.course_id
        and e.student_id = p_student_id
    ) then
      return;
    end if;
  end if;

  raise exception 'Attendance can only be marked for students in this session roster.' using errcode = '42501';
end;
$$;

create or replace function public.m69_3_parse_attendance_student_id(p_value text)
returns uuid
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v_value is null
     or v_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Invalid student id in attendance payload.' using errcode = '22023';
  end if;

  return v_value::uuid;
end;
$$;

create or replace function public.m69_3_write_audit(
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
exception
  when undefined_table then
    null;
end;
$$;

create or replace function public.create_session_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_trainer_user_id uuid,
  p_title text,
  p_description text,
  p_delivery_mode text,
  p_meeting_provider text,
  p_meeting_url text,
  p_meeting_id text,
  p_meeting_passcode text,
  p_meeting_notes text,
  p_timezone text,
  p_join_available_from timestamptz,
  p_recording_url text,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_session public.sessions%rowtype;
  v_title text;
  v_delivery_mode text;
  v_meeting_provider text;
  v_trainer_user_id uuid;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this session.' using errcode = '22023';
  end if;

  perform public.m69_3_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_3_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_3_assert_course_cohort_consistency(p_tenant_id, p_course_id, p_cohort_id);

  v_trainer_user_id := case when v_role = 'trainer' then auth.uid() else p_trainer_user_id end;
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    p_course_id,
    p_cohort_id,
    v_trainer_user_id,
    true
  );

  v_title := public.m69_3_normalize_text(p_title, 'Session title', true, 180);
  v_delivery_mode := public.m69_3_validate_delivery_mode(p_delivery_mode);
  v_meeting_provider := public.m69_3_validate_meeting_provider(p_meeting_provider);

  if p_scheduled_start_at is null then
    raise exception 'Scheduled start time is required.' using errcode = '22023';
  end if;

  if p_scheduled_end_at is not null and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'Session end time cannot be before start time.' using errcode = '22023';
  end if;

  insert into public.sessions (
    tenant_id,
    course_id,
    cohort_id,
    trainer_user_id,
    title,
    description,
    delivery_mode,
    meeting_provider,
    meeting_url,
    meeting_id,
    meeting_passcode,
    meeting_notes,
    timezone,
    join_available_from,
    recording_url,
    scheduled_start_at,
    scheduled_end_at,
    created_by
  )
  values (
    p_tenant_id,
    p_course_id,
    p_cohort_id,
    v_trainer_user_id,
    v_title,
    public.m69_3_normalize_text(p_description, 'Description', false, 2000),
    v_delivery_mode,
    v_meeting_provider,
    public.m69_3_validate_url(p_meeting_url, 'Meeting URL'),
    public.m69_3_normalize_text(p_meeting_id, 'Meeting ID', false, 200),
    public.m69_3_normalize_text(p_meeting_passcode, 'Meeting passcode', false, 200),
    public.m69_3_normalize_text(p_meeting_notes, 'Meeting notes', false, 2000),
    coalesce(public.m69_3_normalize_text(p_timezone, 'Timezone', false, 100), 'Asia/Kolkata'),
    p_join_available_from,
    public.m69_3_validate_url(p_recording_url, 'Recording URL'),
    p_scheduled_start_at,
    p_scheduled_end_at,
    auth.uid()
  )
  returning * into v_session;

  perform public.m69_3_write_audit(
    p_tenant_id,
    case when v_session.delivery_mode = 'offline' then 'session_created' else 'live_session_scheduled' end,
    'session',
    v_session.id,
    'Session',
    'Created class session',
    'info',
    jsonb_build_object(
      'sessionId', v_session.id,
      'courseId', v_session.course_id,
      'cohortId', v_session.cohort_id,
      'deliveryMode', v_session.delivery_mode,
      'meetingProvider', v_session.meeting_provider,
      'trainerUserId', v_session.trainer_user_id,
      'scheduledStartAt', v_session.scheduled_start_at
    )
  );

  return v_session;
end;
$$;

create or replace function public.update_session_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_trainer_user_id uuid,
  p_title text,
  p_description text,
  p_delivery_mode text,
  p_meeting_provider text,
  p_meeting_url text,
  p_meeting_id text,
  p_meeting_passcode text,
  p_meeting_notes text,
  p_timezone text,
  p_join_available_from timestamptz,
  p_recording_url text,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_existing public.sessions%rowtype;
  v_session public.sessions%rowtype;
  v_title text;
  v_delivery_mode text;
  v_meeting_provider text;
  v_trainer_user_id uuid;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);
  v_existing := public.m69_3_assert_session_in_tenant(p_tenant_id, p_session_id);

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this session.' using errcode = '22023';
  end if;

  perform public.m69_3_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_3_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_3_assert_course_cohort_consistency(p_tenant_id, p_course_id, p_cohort_id);
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    v_existing.course_id,
    v_existing.cohort_id,
    v_existing.trainer_user_id,
    false
  );

  v_trainer_user_id := case when v_role = 'trainer' then auth.uid() else p_trainer_user_id end;
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    p_course_id,
    p_cohort_id,
    v_trainer_user_id,
    true
  );

  v_title := public.m69_3_normalize_text(p_title, 'Session title', true, 180);
  v_delivery_mode := public.m69_3_validate_delivery_mode(p_delivery_mode);
  v_meeting_provider := public.m69_3_validate_meeting_provider(p_meeting_provider);

  if p_scheduled_start_at is null then
    raise exception 'Scheduled start time is required.' using errcode = '22023';
  end if;

  if p_scheduled_end_at is not null and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'Session end time cannot be before start time.' using errcode = '22023';
  end if;

  update public.sessions as s
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = v_trainer_user_id,
    title = v_title,
    description = public.m69_3_normalize_text(p_description, 'Description', false, 2000),
    delivery_mode = v_delivery_mode,
    meeting_provider = v_meeting_provider,
    meeting_url = public.m69_3_validate_url(p_meeting_url, 'Meeting URL'),
    meeting_id = public.m69_3_normalize_text(p_meeting_id, 'Meeting ID', false, 200),
    meeting_passcode = public.m69_3_normalize_text(p_meeting_passcode, 'Meeting passcode', false, 200),
    meeting_notes = public.m69_3_normalize_text(p_meeting_notes, 'Meeting notes', false, 2000),
    timezone = coalesce(public.m69_3_normalize_text(p_timezone, 'Timezone', false, 100), 'Asia/Kolkata'),
    join_available_from = p_join_available_from,
    recording_url = public.m69_3_validate_url(p_recording_url, 'Recording URL'),
    scheduled_start_at = p_scheduled_start_at,
    scheduled_end_at = p_scheduled_end_at
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
  returning * into v_session;

  perform public.m69_3_write_audit(
    p_tenant_id,
    case when v_session.delivery_mode = 'offline' then 'session_updated' else 'live_session_updated' end,
    'session',
    v_session.id,
    'Session',
    'Updated class session',
    'info',
    jsonb_build_object(
      'sessionId', v_session.id,
      'courseId', v_session.course_id,
      'cohortId', v_session.cohort_id,
      'deliveryMode', v_session.delivery_mode,
      'meetingProvider', v_session.meeting_provider,
      'status', v_session.status,
      'scheduledStartAt', v_session.scheduled_start_at
    )
  );

  return v_session;
end;
$$;

create or replace function public.update_session_status_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_status text
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_existing public.sessions%rowtype;
  v_session public.sessions%rowtype;
  v_status text;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);
  v_existing := public.m69_3_assert_session_in_tenant(p_tenant_id, p_session_id);
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    v_existing.course_id,
    v_existing.cohort_id,
    v_existing.trainer_user_id,
    false
  );

  v_status := public.m69_3_validate_session_status(p_status);

  if v_status not in ('completed', 'canceled') then
    raise exception 'Session status action must be completed or canceled.' using errcode = '22023';
  end if;

  update public.sessions as s
  set status = v_status
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
  returning * into v_session;

  perform public.m69_3_write_audit(
    p_tenant_id,
    case when v_status = 'canceled' then 'session_canceled' else 'session_completed' end,
    'session',
    v_session.id,
    'Session',
    'Updated class session status',
    case when v_status = 'canceled' then 'warning' else 'info' end,
    jsonb_build_object(
      'sessionId', v_session.id,
      'courseId', v_session.course_id,
      'cohortId', v_session.cohort_id,
      'deliveryMode', v_session.delivery_mode,
      'meetingProvider', v_session.meeting_provider,
      'status', v_session.status
    )
  );

  return v_session;
end;
$$;

create or replace function public.update_session_meeting_details_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_delivery_mode text,
  p_meeting_provider text,
  p_meeting_url text,
  p_meeting_id text,
  p_meeting_passcode text,
  p_meeting_notes text,
  p_timezone text,
  p_join_available_from timestamptz,
  p_recording_url text
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_existing public.sessions%rowtype;
  v_session public.sessions%rowtype;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);
  v_existing := public.m69_3_assert_session_in_tenant(p_tenant_id, p_session_id);
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    v_existing.course_id,
    v_existing.cohort_id,
    v_existing.trainer_user_id,
    false
  );

  update public.sessions as s
  set
    delivery_mode = public.m69_3_validate_delivery_mode(p_delivery_mode),
    meeting_provider = public.m69_3_validate_meeting_provider(p_meeting_provider),
    meeting_url = public.m69_3_validate_url(p_meeting_url, 'Meeting URL'),
    meeting_id = public.m69_3_normalize_text(p_meeting_id, 'Meeting ID', false, 200),
    meeting_passcode = public.m69_3_normalize_text(p_meeting_passcode, 'Meeting passcode', false, 200),
    meeting_notes = public.m69_3_normalize_text(p_meeting_notes, 'Meeting notes', false, 2000),
    timezone = coalesce(public.m69_3_normalize_text(p_timezone, 'Timezone', false, 100), 'Asia/Kolkata'),
    join_available_from = p_join_available_from,
    recording_url = public.m69_3_validate_url(p_recording_url, 'Recording URL')
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
  returning * into v_session;

  perform public.m69_3_write_audit(
    p_tenant_id,
    'meeting_details_updated',
    'session',
    v_session.id,
    'Session',
    'Updated class meeting details',
    'info',
    jsonb_build_object(
      'sessionId', v_session.id,
      'deliveryMode', v_session.delivery_mode,
      'meetingProvider', v_session.meeting_provider,
      'scheduledStartAt', v_session.scheduled_start_at
    )
  );

  return v_session;
end;
$$;

create or replace function public.mark_attendance_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_student_id uuid,
  p_status text,
  p_remarks text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_session public.sessions%rowtype;
  v_status text;
  v_record public.attendance_records%rowtype;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);
  v_session := public.m69_3_assert_session_in_tenant(p_tenant_id, p_session_id);
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    v_session.course_id,
    v_session.cohort_id,
    v_session.trainer_user_id,
    false
  );
  perform public.m69_3_assert_student_in_session_roster(p_tenant_id, v_session, p_student_id);

  v_status := public.m69_3_validate_attendance_status(p_status);

  insert into public.attendance_records (
    tenant_id,
    session_id,
    student_id,
    status,
    remarks,
    marked_by,
    marked_at
  )
  values (
    p_tenant_id,
    p_session_id,
    p_student_id,
    v_status,
    public.m69_3_normalize_text(p_remarks, 'Remarks', false, 1000),
    auth.uid(),
    now()
  )
  on conflict (session_id, student_id)
  do update set
    status = excluded.status,
    remarks = excluded.remarks,
    marked_by = excluded.marked_by,
    marked_at = excluded.marked_at
  returning * into v_record;

  perform public.m69_3_write_audit(
    p_tenant_id,
    'attendance_marked',
    'attendance_record',
    v_record.id,
    'Attendance record',
    'Marked student attendance',
    'info',
    jsonb_build_object(
      'attendanceRecordId', v_record.id,
      'sessionId', v_record.session_id,
      'studentId', v_record.student_id,
      'status', v_record.status
    )
  );

  return v_record;
end;
$$;

create or replace function public.bulk_mark_attendance_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_records jsonb
)
returns setof public.attendance_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_session public.sessions%rowtype;
  v_record jsonb;
  v_inserted public.attendance_records%rowtype;
  v_student_id uuid;
  v_status text;
  v_remarks text;
  v_count integer := 0;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);
  v_session := public.m69_3_assert_session_in_tenant(p_tenant_id, p_session_id);
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    v_session.course_id,
    v_session.cohort_id,
    v_session.trainer_user_id,
    false
  );

  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'No attendance records selected.' using errcode = '22023';
  end if;

  if char_length(p_records::text) > 20000 or jsonb_array_length(p_records) > 300 then
    raise exception 'Attendance payload is too large.' using errcode = '22023';
  end if;

  create temp table if not exists pg_temp.m69_3_marked_attendance_records (
    id uuid,
    tenant_id uuid,
    session_id uuid,
    student_id uuid,
    status text,
    remarks text,
    marked_by uuid,
    marked_at timestamptz,
    created_at timestamptz
  ) on commit drop;

  truncate table pg_temp.m69_3_marked_attendance_records;

  for v_record in select value from jsonb_array_elements(p_records)
  loop
    if jsonb_typeof(v_record) <> 'object' then
      raise exception 'Invalid attendance record payload.' using errcode = '22023';
    end if;

    v_student_id := public.m69_3_parse_attendance_student_id(v_record ->> 'studentId');
    v_status := public.m69_3_validate_attendance_status(v_record ->> 'status');
    v_remarks := public.m69_3_normalize_text(v_record ->> 'remarks', 'Remarks', false, 1000);

    perform public.m69_3_assert_student_in_session_roster(p_tenant_id, v_session, v_student_id);

    insert into public.attendance_records (
      tenant_id,
      session_id,
      student_id,
      status,
      remarks,
      marked_by,
      marked_at
    )
    values (
      p_tenant_id,
      p_session_id,
      v_student_id,
      v_status,
      v_remarks,
      auth.uid(),
      now()
    )
    on conflict (session_id, student_id)
    do update set
      status = excluded.status,
      remarks = excluded.remarks,
      marked_by = excluded.marked_by,
      marked_at = excluded.marked_at
    returning * into v_inserted;

    insert into pg_temp.m69_3_marked_attendance_records
    values (
      v_inserted.id,
      v_inserted.tenant_id,
      v_inserted.session_id,
      v_inserted.student_id,
      v_inserted.status,
      v_inserted.remarks,
      v_inserted.marked_by,
      v_inserted.marked_at,
      v_inserted.created_at
    );

    v_count := v_count + 1;
  end loop;

  perform public.m69_3_write_audit(
    p_tenant_id,
    'attendance_bulk_marked',
    'attendance_record',
    p_session_id,
    'Attendance records',
    'Bulk marked attendance',
    'info',
    jsonb_build_object(
      'sessionId', p_session_id,
      'count', v_count
    )
  );

  return query
  select *
  from pg_temp.m69_3_marked_attendance_records;
end;
$$;

revoke execute on function public.m69_3_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_assert_manage_attendance(uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_normalize_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.m69_3_validate_session_status(text) from public, anon, authenticated;
revoke execute on function public.m69_3_validate_attendance_status(text) from public, anon, authenticated;
revoke execute on function public.m69_3_validate_delivery_mode(text) from public, anon, authenticated;
revoke execute on function public.m69_3_validate_meeting_provider(text) from public, anon, authenticated;
revoke execute on function public.m69_3_validate_url(text, text) from public, anon, authenticated;
revoke execute on function public.m69_3_assert_course_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_assert_cohort_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_assert_course_cohort_consistency(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_assert_session_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_trainer_can_manage_scope(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_assert_can_manage_scope(uuid, text, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.m69_3_assert_student_in_session_roster(uuid, public.sessions, uuid) from public, anon, authenticated;
revoke execute on function public.m69_3_parse_attendance_student_id(text) from public, anon, authenticated;
revoke execute on function public.m69_3_write_audit(uuid, text, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.create_session_secure(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz, timestamptz) from public, anon;
revoke execute on function public.update_session_secure(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz, timestamptz) from public, anon;
revoke execute on function public.update_session_status_secure(uuid, uuid, text) from public, anon;
revoke execute on function public.update_session_meeting_details_secure(uuid, uuid, text, text, text, text, text, text, text, timestamptz, text) from public, anon;
revoke execute on function public.mark_attendance_secure(uuid, uuid, uuid, text, text) from public, anon;
revoke execute on function public.bulk_mark_attendance_secure(uuid, uuid, jsonb) from public, anon;

grant execute on function public.create_session_secure(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.update_session_secure(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.update_session_status_secure(uuid, uuid, text) to authenticated;
grant execute on function public.update_session_meeting_details_secure(uuid, uuid, text, text, text, text, text, text, text, timestamptz, text) to authenticated;
grant execute on function public.mark_attendance_secure(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.bulk_mark_attendance_secure(uuid, uuid, jsonb) to authenticated;

commit;
