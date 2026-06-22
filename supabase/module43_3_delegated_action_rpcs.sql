-- Module 43.3: Secure delegated action RPCs
-- Run after Module 43 delegated permissions and the attendance/assignment/session modules.

create or replace function public.find_active_delegated_permission_for_action(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_permission_keys text[],
  p_course_id uuid default null,
  p_cohort_id uuid default null,
  p_student_id uuid default null,
  p_session_id uuid default null,
  p_assignment_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  matched_permission_id uuid;
begin
  if p_actor_id is null
     or not public.is_tenant_member(p_tenant_id, p_actor_id) then
    return null;
  end if;

  select dp.id
  into matched_permission_id
  from public.delegated_permissions dp
  where dp.tenant_id = p_tenant_id
    and dp.user_id = p_actor_id
    and dp.permission_key = any (p_permission_keys)
    and dp.status = 'active'
    and dp.starts_at <= now()
    and (dp.expires_at is null or dp.expires_at > now())
    and (
      dp.scope_type is null
      or dp.scope_type = 'workspace'
      or (dp.scope_type = 'course' and dp.scope_id = p_course_id)
      or (dp.scope_type = 'cohort' and dp.scope_id = p_cohort_id)
      or (dp.scope_type = 'student' and dp.scope_id = p_student_id)
      or (dp.scope_type = 'session' and dp.scope_id = p_session_id)
      or (dp.scope_type = 'assignment' and dp.scope_id = p_assignment_id)
    )
  order by
    case dp.scope_type
      when 'session' then 1
      when 'assignment' then 1
      when 'student' then 2
      when 'cohort' then 3
      when 'course' then 4
      when 'workspace' then 5
      else 6
    end,
    dp.created_at desc
  limit 1;

  return matched_permission_id;
end;
$$;

revoke execute on function public.find_active_delegated_permission_for_action(
  uuid,
  uuid,
  text[],
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) from public;
revoke execute on function public.find_active_delegated_permission_for_action(
  uuid,
  uuid,
  text[],
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) from authenticated;

create or replace function public.log_delegated_permission_used(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_permission_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_scope_type text,
  p_scope_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  permission_row public.delegated_permissions%rowtype;
begin
  if p_actor_id is null
     or not public.is_tenant_member(p_tenant_id, p_actor_id) then
    return;
  end if;

  select *
  into permission_row
  from public.delegated_permissions
  where id = p_permission_id
    and tenant_id = p_tenant_id
    and user_id = p_actor_id
    and status = 'active'
    and starts_at <= now()
    and (expires_at is null or expires_at > now());

  if not found then
    return;
  end if;

  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    entity_name,
    description,
    metadata,
    severity
  )
  values (
    p_tenant_id,
    p_actor_id,
    'delegated_permission_used',
    'delegated_permission',
    p_permission_id,
    permission_row.permission_key,
    'Used a delegated permission exception.',
    jsonb_build_object(
      'action', p_action,
      'entity_type', p_entity_type,
      'entity_id', p_entity_id,
      'permission_key', permission_row.permission_key,
      'scope_type', coalesce(p_scope_type, permission_row.scope_type),
      'scope_id', coalesce(p_scope_id, permission_row.scope_id),
      'user_id', p_actor_id
    ),
    'info'
  );
end;
$$;

revoke execute on function public.log_delegated_permission_used(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid
) from public;
revoke execute on function public.log_delegated_permission_used(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid
) from authenticated;

create or replace function public.mark_delegated_attendance(
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
  actor_id uuid := auth.uid();
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  session_row public.sessions%rowtype;
  attendance_row public.attendance_records%rowtype;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to mark attendance.';
  end if;

  if p_status not in ('present', 'absent', 'late', 'excused') then
    raise exception 'Unsupported attendance status.';
  end if;

  select *
  into session_row
  from public.sessions
  where id = p_session_id
    and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Session not found in this workspace.';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.tenant_id = p_tenant_id
  ) then
    raise exception 'Student not found in this workspace.';
  end if;

  if session_row.cohort_id is not null then
    if not exists (
      select 1
      from public.cohort_members cm
      where cm.tenant_id = p_tenant_id
        and cm.cohort_id = session_row.cohort_id
        and cm.student_id = p_student_id
    ) then
      raise exception 'Attendance can only be marked for students in this session roster.';
    end if;
  elsif session_row.course_id is not null then
    if not exists (
      select 1
      from public.enrollments e
      where e.tenant_id = p_tenant_id
        and e.course_id = session_row.course_id
        and e.student_id = p_student_id
    ) then
      raise exception 'Attendance can only be marked for students in this session roster.';
    end if;
  else
    raise exception 'Session roster is not configured.';
  end if;

  matched_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['edit_attendance', 'edit_attendance_after_lock'],
    session_row.course_id,
    session_row.cohort_id,
    p_student_id,
    session_row.id,
    null
  );

  if matched_permission_id is null then
    raise exception 'You do not have delegated permission to mark this attendance.';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

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
    p_status,
    nullif(trim(coalesce(p_remarks, '')), ''),
    actor_id,
    now()
  )
  on conflict (session_id, student_id)
  do update set
    status = excluded.status,
    remarks = excluded.remarks,
    marked_by = excluded.marked_by,
    marked_at = excluded.marked_at
  returning * into attendance_row;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    'mark_attendance',
    'attendance_record',
    attendance_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return attendance_row;
end;
$$;

revoke execute on function public.mark_delegated_attendance(
  uuid,
  uuid,
  uuid,
  text,
  text
) from public;
grant execute on function public.mark_delegated_attendance(
  uuid,
  uuid,
  uuid,
  text,
  text
) to authenticated;

create or replace function public.review_delegated_assignment_submission(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_score numeric default null,
  p_feedback text default null
)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  assignment_row public.assignments%rowtype;
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  submission_row public.assignment_submissions%rowtype;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to review submissions.';
  end if;

  select *
  into assignment_row
  from public.assignments
  where id = p_assignment_id
    and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Assignment not found in this workspace.';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.tenant_id = p_tenant_id
  ) then
    raise exception 'Student not found in this workspace.';
  end if;

  if not public.assignment_student_in_roster(
    p_tenant_id,
    p_assignment_id,
    p_student_id
  ) then
    raise exception 'Submissions can only be reviewed for students in this assignment roster.';
  end if;

  if p_score is not null and p_score < 0 then
    raise exception 'Score must be a positive number.';
  end if;

  if p_score is not null
     and assignment_row.max_score is not null
     and p_score > assignment_row.max_score then
    raise exception 'Score cannot be greater than max score.';
  end if;

  matched_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['review_assignments'],
    assignment_row.course_id,
    assignment_row.cohort_id,
    p_student_id,
    null,
    assignment_row.id
  );

  if matched_permission_id is null then
    raise exception 'You do not have delegated permission to review this submission.';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

  update public.assignment_submissions
  set
    feedback = nullif(trim(coalesce(p_feedback, '')), ''),
    reviewed_at = now(),
    reviewed_by = actor_id,
    score = p_score,
    status = 'reviewed'
  where tenant_id = p_tenant_id
    and assignment_id = p_assignment_id
    and student_id = p_student_id
  returning * into submission_row;

  if not found then
    raise exception 'Submission not found for this student.';
  end if;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    'review_assignment_submission',
    'assignment_submission',
    submission_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return submission_row;
end;
$$;

revoke execute on function public.review_delegated_assignment_submission(
  uuid,
  uuid,
  uuid,
  numeric,
  text
) from public;
grant execute on function public.review_delegated_assignment_submission(
  uuid,
  uuid,
  uuid,
  numeric,
  text
) to authenticated;

create or replace function public.create_delegated_session(
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
  actor_id uuid := auth.uid();
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  session_row public.sessions%rowtype;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to create sessions.';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Session title is required.';
  end if;

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this session.';
  end if;

  if p_delivery_mode not in ('online', 'offline', 'hybrid') then
    raise exception 'Unsupported delivery mode.';
  end if;

  if p_meeting_provider is not null
     and p_meeting_provider not in (
       'zoom',
       'google_meet',
       'microsoft_teams',
       'custom'
     ) then
    raise exception 'Unsupported meeting provider.';
  end if;

  if p_meeting_url is not null
     and p_meeting_url !~* '^https?://' then
    raise exception 'Meeting URL must be a valid http or https URL.';
  end if;

  if p_recording_url is not null
     and p_recording_url !~* '^https?://' then
    raise exception 'Recording URL must be a valid http or https URL.';
  end if;

  if p_scheduled_start_at is null then
    raise exception 'Scheduled start time is required.';
  end if;

  if p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'Session end time cannot be before start time.';
  end if;

  if p_course_id is not null
     and not exists (
       select 1 from public.courses c
       where c.id = p_course_id and c.tenant_id = p_tenant_id
     ) then
    raise exception 'Course not found in this workspace.';
  end if;

  if p_cohort_id is not null
     and not exists (
       select 1 from public.cohorts c
       where c.id = p_cohort_id and c.tenant_id = p_tenant_id
     ) then
    raise exception 'Cohort not found in this workspace.';
  end if;

  if p_course_id is not null
     and p_cohort_id is not null
     and not exists (
       select 1 from public.cohorts c
       where c.id = p_cohort_id
         and c.tenant_id = p_tenant_id
         and c.course_id = p_course_id
     ) then
    raise exception 'Selected cohort does not belong to the selected course.';
  end if;

  if p_trainer_user_id is not null
     and not public.is_tenant_member(p_tenant_id, p_trainer_user_id) then
    raise exception 'Trainer user is not a member of this workspace.';
  end if;

  matched_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['manage_sessions'],
    p_course_id,
    p_cohort_id,
    null,
    null,
    null
  );

  if matched_permission_id is null then
    raise exception 'You do not have delegated permission to create this session.';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

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
    status,
    created_by
  )
  values (
    p_tenant_id,
    p_course_id,
    p_cohort_id,
    p_trainer_user_id,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    p_delivery_mode,
    p_meeting_provider,
    nullif(trim(coalesce(p_meeting_url, '')), ''),
    nullif(trim(coalesce(p_meeting_id, '')), ''),
    nullif(trim(coalesce(p_meeting_passcode, '')), ''),
    nullif(trim(coalesce(p_meeting_notes, '')), ''),
    coalesce(nullif(trim(coalesce(p_timezone, '')), ''), 'Asia/Kolkata'),
    p_join_available_from,
    nullif(trim(coalesce(p_recording_url, '')), ''),
    p_scheduled_start_at,
    p_scheduled_end_at,
    'scheduled',
    actor_id
  )
  returning * into session_row;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    'create_session',
    'session',
    session_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return session_row;
end;
$$;

revoke execute on function public.create_delegated_session(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) from public;
grant execute on function public.create_delegated_session(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) to authenticated;

create or replace function public.update_delegated_session(
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
  actor_id uuid := auth.uid();
  existing_session public.sessions%rowtype;
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  session_row public.sessions%rowtype;
  target_permission_id uuid;
  target_scope_changed boolean;
  workspace_permission_id uuid;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to update sessions.';
  end if;

  select *
  into existing_session
  from public.sessions
  where id = p_session_id
    and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Session not found in this workspace.';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Session title is required.';
  end if;

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this session.';
  end if;

  if p_delivery_mode not in ('online', 'offline', 'hybrid') then
    raise exception 'Unsupported delivery mode.';
  end if;

  if p_meeting_provider is not null
     and p_meeting_provider not in (
       'zoom',
       'google_meet',
       'microsoft_teams',
       'custom'
     ) then
    raise exception 'Unsupported meeting provider.';
  end if;

  if p_meeting_url is not null
     and p_meeting_url !~* '^https?://' then
    raise exception 'Meeting URL must be a valid http or https URL.';
  end if;

  if p_recording_url is not null
     and p_recording_url !~* '^https?://' then
    raise exception 'Recording URL must be a valid http or https URL.';
  end if;

  if p_scheduled_start_at is null then
    raise exception 'Scheduled start time is required.';
  end if;

  if p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'Session end time cannot be before start time.';
  end if;

  if p_course_id is not null
     and not exists (
       select 1 from public.courses c
       where c.id = p_course_id and c.tenant_id = p_tenant_id
     ) then
    raise exception 'Course not found in this workspace.';
  end if;

  if p_cohort_id is not null
     and not exists (
       select 1 from public.cohorts c
       where c.id = p_cohort_id and c.tenant_id = p_tenant_id
     ) then
    raise exception 'Cohort not found in this workspace.';
  end if;

  if p_course_id is not null
     and p_cohort_id is not null
     and not exists (
       select 1 from public.cohorts c
       where c.id = p_cohort_id
         and c.tenant_id = p_tenant_id
         and c.course_id = p_course_id
     ) then
    raise exception 'Selected cohort does not belong to the selected course.';
  end if;

  if p_trainer_user_id is not null
     and not public.is_tenant_member(p_tenant_id, p_trainer_user_id) then
    raise exception 'Trainer user is not a member of this workspace.';
  end if;

  target_scope_changed :=
    p_course_id is distinct from existing_session.course_id
    or p_cohort_id is distinct from existing_session.cohort_id;

  workspace_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['manage_sessions'],
    null,
    null,
    null,
    null,
    null
  );

  if workspace_permission_id is not null then
    matched_permission_id := workspace_permission_id;
  else
    matched_permission_id := public.find_active_delegated_permission_for_action(
      p_tenant_id,
      actor_id,
      array['manage_sessions'],
      existing_session.course_id,
      existing_session.cohort_id,
      null,
      existing_session.id,
      null
    );

    if matched_permission_id is null then
      raise exception 'You do not have delegated permission to update this session.';
    end if;
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

  if matched_scope_type = 'session'
     and target_scope_changed then
    raise exception 'Session-scoped permission cannot move a session to another scope.';
  end if;

  if workspace_permission_id is null and target_scope_changed then
    -- Intentionally do not pass p_session_id here. A session-scoped grant can
    -- edit the existing session, but it must not authorize moving that session
    -- into a different course or cohort.
    target_permission_id := public.find_active_delegated_permission_for_action(
      p_tenant_id,
      actor_id,
      array['manage_sessions'],
      p_course_id,
      p_cohort_id,
      null,
      null,
      null
    );

    if target_permission_id is null then
      raise exception 'You do not have delegated permission for the target session scope.';
    end if;
  end if;

  update public.sessions
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = p_trainer_user_id,
    title = trim(p_title),
    description = nullif(trim(coalesce(p_description, '')), ''),
    delivery_mode = p_delivery_mode,
    meeting_provider = p_meeting_provider,
    meeting_url = nullif(trim(coalesce(p_meeting_url, '')), ''),
    meeting_id = nullif(trim(coalesce(p_meeting_id, '')), ''),
    meeting_passcode = nullif(trim(coalesce(p_meeting_passcode, '')), ''),
    meeting_notes = nullif(trim(coalesce(p_meeting_notes, '')), ''),
    timezone = coalesce(nullif(trim(coalesce(p_timezone, '')), ''), 'Asia/Kolkata'),
    join_available_from = p_join_available_from,
    recording_url = nullif(trim(coalesce(p_recording_url, '')), ''),
    scheduled_start_at = p_scheduled_start_at,
    scheduled_end_at = p_scheduled_end_at
  where id = p_session_id
    and tenant_id = p_tenant_id
  returning * into session_row;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    'update_session',
    'session',
    session_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return session_row;
end;
$$;

revoke execute on function public.update_delegated_session(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) from public;
grant execute on function public.update_delegated_session(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz
) to authenticated;

create or replace function public.update_delegated_session_status(
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
  actor_id uuid := auth.uid();
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  session_row public.sessions%rowtype;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to update sessions.';
  end if;

  if p_status not in ('completed', 'canceled') then
    raise exception 'Unsupported session status.';
  end if;

  select *
  into session_row
  from public.sessions
  where id = p_session_id
    and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Session not found in this workspace.';
  end if;

  matched_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['manage_sessions'],
    session_row.course_id,
    session_row.cohort_id,
    null,
    session_row.id,
    null
  );

  if matched_permission_id is null then
    raise exception 'You do not have delegated permission to update this session.';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

  update public.sessions
  set status = p_status
  where id = p_session_id
    and tenant_id = p_tenant_id
  returning * into session_row;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    case when p_status = 'completed'
      then 'session_completed'
      else 'session_canceled'
    end,
    'session',
    session_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return session_row;
end;
$$;

revoke execute on function public.update_delegated_session_status(
  uuid,
  uuid,
  text
) from public;
grant execute on function public.update_delegated_session_status(
  uuid,
  uuid,
  text
) to authenticated;
