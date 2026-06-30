-- Module 69.4: Assignments and submissions secure write RPCs.
-- This migration is additive. It intentionally does not revoke existing direct
-- table grants; those revokes must wait until replacement flows are proven
-- in production.

begin;

create or replace function public.m69_4_current_role(p_tenant_id uuid)
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

create or replace function public.m69_4_normalize_text(
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

  if v_value is not null and (position('<' in v_value) > 0 or position('>' in v_value) > 0) then
    raise exception '% contains unsupported characters.', p_label using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_4_validate_assignment_status(p_status text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'draft')));
begin
  if v_status not in ('draft', 'published', 'closed') then
    raise exception 'Invalid assignment status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_4_validate_submission_status(p_status text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'submitted')));
begin
  if v_status not in ('pending', 'submitted', 'reviewed', 'late') then
    raise exception 'Invalid assignment submission status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_4_validate_attachment_urls(p_urls jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_urls jsonb := coalesce(p_urls, '[]'::jsonb);
  v_item jsonb;
  v_value text;
  v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_urls) <> 'array' then
    raise exception 'Attachment URLs must be an array.' using errcode = '22023';
  end if;

  if jsonb_array_length(v_urls) > 10 then
    raise exception 'Too many attachment URLs.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_urls)
  loop
    if jsonb_typeof(v_item) <> 'string' then
      raise exception 'Attachment URLs must be strings.' using errcode = '22023';
    end if;

    v_value := nullif(trim(v_item #>> '{}'), '');

    if v_value is null then
      continue;
    end if;

    if char_length(v_value) > 1000 then
      raise exception 'Attachment URL is too long.' using errcode = '22023';
    end if;

    if v_value !~* '^https?://' then
      raise exception 'Attachment URL must be a valid http or https URL.' using errcode = '22023';
    end if;

    if position('<' in v_value) > 0 or position('>' in v_value) > 0 then
      raise exception 'Attachment URL contains unsupported characters.' using errcode = '22023';
    end if;

    v_result := v_result || to_jsonb(v_value);
  end loop;

  return v_result;
end;
$$;

create or replace function public.m69_4_validate_score(
  p_score numeric,
  p_max_score numeric default null
)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if p_score is not null and p_score < 0 then
    raise exception 'Score must be a positive number.' using errcode = '22023';
  end if;

  if p_max_score is not null and p_score is not null and p_score > p_max_score then
    raise exception 'Score cannot be greater than max score.' using errcode = '22023';
  end if;

  return p_score;
end;
$$;

create or replace function public.m69_4_assert_course_in_tenant(
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
  from public.courses c
  where c.tenant_id = p_tenant_id
    and c.id = p_course_id;

  if not found then
    raise exception 'Course not found in this workspace.' using errcode = '22023';
  end if;

  return v_course;
end;
$$;

create or replace function public.m69_4_assert_cohort_in_tenant(
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
  from public.cohorts c
  where c.tenant_id = p_tenant_id
    and c.id = p_cohort_id;

  if not found then
    raise exception 'Cohort not found in this workspace.' using errcode = '22023';
  end if;

  return v_cohort;
end;
$$;

create or replace function public.m69_4_assert_course_cohort_consistency(
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

create or replace function public.m69_4_assert_assignment_in_tenant(
  p_tenant_id uuid,
  p_assignment_id uuid
)
returns public.assignments
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments%rowtype;
begin
  select *
  into v_assignment
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id;

  if not found then
    raise exception 'Assignment not found in this workspace.' using errcode = '22023';
  end if;

  return v_assignment;
end;
$$;

create or replace function public.m69_4_trainer_can_manage_scope(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_assignment_trainer_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_assignment_trainer_user_id = p_trainer_user_id
    or (
      p_course_id is not null
      and exists (
        select 1
        from public.trainer_course_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.trainer_user_id = p_trainer_user_id
          and tca.course_id = p_course_id
      )
    )
    or (
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

create or replace function public.m69_4_delegated_permission_id(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_permission_keys text[],
  p_course_id uuid,
  p_cohort_id uuid,
  p_student_id uuid default null,
  p_assignment_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.find_active_delegated_permission_for_action(
    p_tenant_id,
    p_actor_id,
    p_permission_keys,
    p_course_id,
    p_cohort_id,
    p_student_id,
    null,
    p_assignment_id
  )
$$;

create or replace function public.m69_4_assert_manage_assignment(
  p_tenant_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_assignment_id uuid default null,
  p_assignment_trainer_user_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_delegated_permission_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_role := public.m69_4_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role in ('owner', 'admin') then
    return v_role;
  end if;

  if v_role = 'trainer'
     and public.m69_4_trainer_can_manage_scope(
       p_tenant_id,
       auth.uid(),
       p_course_id,
       p_cohort_id,
       p_assignment_trainer_user_id
     ) then
    return v_role;
  end if;

  v_delegated_permission_id := public.m69_4_delegated_permission_id(
    p_tenant_id,
    auth.uid(),
    array['manage_assignments'],
    p_course_id,
    p_cohort_id,
    null,
    p_assignment_id
  );

  if v_delegated_permission_id is not null then
    return 'delegated';
  end if;

  raise exception 'You do not have permission to manage assignments.' using errcode = '42501';
end;
$$;

create or replace function public.m69_4_assert_review_assignment(
  p_tenant_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_student_id uuid,
  p_assignment_id uuid,
  p_assignment_trainer_user_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_delegated_permission_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_role := public.m69_4_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role in ('owner', 'admin') then
    return v_role;
  end if;

  if v_role = 'trainer'
     and public.m69_4_trainer_can_manage_scope(
       p_tenant_id,
       auth.uid(),
       p_course_id,
       p_cohort_id,
       p_assignment_trainer_user_id
     ) then
    return v_role;
  end if;

  v_delegated_permission_id := public.m69_4_delegated_permission_id(
    p_tenant_id,
    auth.uid(),
    array['manage_assignments', 'review_assignments'],
    p_course_id,
    p_cohort_id,
    p_student_id,
    p_assignment_id
  );

  if v_delegated_permission_id is not null then
    return 'delegated';
  end if;

  raise exception 'You do not have permission to review submissions.' using errcode = '42501';
end;
$$;

create or replace function public.m69_4_assert_student_in_tenant(
  p_tenant_id uuid,
  p_student_id uuid
)
returns public.students
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  select *
  into v_student
  from public.students s
  where s.tenant_id = p_tenant_id
    and s.id = p_student_id;

  if not found then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  return v_student;
end;
$$;

create or replace function public.m69_4_assert_student_in_assignment_roster(
  p_tenant_id uuid,
  p_assignment public.assignments,
  p_student_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.m69_4_assert_student_in_tenant(p_tenant_id, p_student_id);

  if not public.assignment_student_in_roster(p_tenant_id, p_assignment.id, p_student_id) then
    raise exception 'Submissions can only be managed for students in this assignment roster.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.m69_4_submission_status_for_due_date(p_due_at timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_due_at is not null and p_due_at < now() then 'late'
    else 'submitted'
  end
$$;

create or replace function public.m69_4_write_audit(
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
  if to_regclass('public.audit_logs') is null then
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

create or replace function public.create_assignment_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_trainer_user_id uuid,
  p_title text,
  p_description text,
  p_instructions text,
  p_attachment_urls_json jsonb default '[]'::jsonb,
  p_max_score numeric default null,
  p_due_at timestamptz default null
)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments%rowtype;
  v_role text;
  v_title text;
  v_trainer_user_id uuid;
begin
  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this assignment.' using errcode = '22023';
  end if;

  perform public.m69_4_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_4_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_4_assert_course_cohort_consistency(p_tenant_id, p_course_id, p_cohort_id);

  v_role := public.m69_4_assert_manage_assignment(p_tenant_id, p_course_id, p_cohort_id);
  v_title := public.m69_4_normalize_text(p_title, 'Assignment title', true, 180);
  v_trainer_user_id := case when v_role = 'trainer' then auth.uid() else p_trainer_user_id end;

  insert into public.assignments (
    tenant_id,
    course_id,
    cohort_id,
    trainer_user_id,
    title,
    description,
    instructions,
    attachment_urls_json,
    max_score,
    due_at,
    status,
    created_by
  )
  values (
    p_tenant_id,
    p_course_id,
    p_cohort_id,
    v_trainer_user_id,
    v_title,
    public.m69_4_normalize_text(p_description, 'Description', false, 2000),
    public.m69_4_normalize_text(p_instructions, 'Instructions', false, 4000),
    public.m69_4_validate_attachment_urls(p_attachment_urls_json),
    public.m69_4_validate_score(p_max_score, null),
    p_due_at,
    'draft',
    auth.uid()
  )
  returning * into v_assignment;

  perform public.m69_4_write_audit(
    p_tenant_id,
    'assignment_created',
    'assignment',
    v_assignment.id,
    'Assignment',
    'Created assignment',
    'info',
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'courseId', v_assignment.course_id,
      'cohortId', v_assignment.cohort_id,
      'status', v_assignment.status,
      'dueDatePresent', v_assignment.due_at is not null,
      'maxScorePresent', v_assignment.max_score is not null
    )
  );

  return v_assignment;
end;
$$;

create or replace function public.update_assignment_secure(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_trainer_user_id uuid,
  p_title text,
  p_description text,
  p_instructions text,
  p_attachment_urls_json jsonb default '[]'::jsonb,
  p_max_score numeric default null,
  p_due_at timestamptz default null
)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.assignments%rowtype;
  v_assignment public.assignments%rowtype;
  v_role text;
  v_title text;
  v_trainer_user_id uuid;
begin
  v_existing := public.m69_4_assert_assignment_in_tenant(p_tenant_id, p_assignment_id);

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this assignment.' using errcode = '22023';
  end if;

  perform public.m69_4_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_4_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_4_assert_course_cohort_consistency(p_tenant_id, p_course_id, p_cohort_id);

  v_role := public.m69_4_assert_manage_assignment(
    p_tenant_id,
    coalesce(v_existing.course_id, p_course_id),
    coalesce(v_existing.cohort_id, p_cohort_id),
    p_assignment_id,
    v_existing.trainer_user_id
  );
  perform public.m69_4_assert_manage_assignment(p_tenant_id, p_course_id, p_cohort_id, p_assignment_id, v_existing.trainer_user_id);

  v_title := public.m69_4_normalize_text(p_title, 'Assignment title', true, 180);
  v_trainer_user_id := case when v_role = 'trainer' then auth.uid() else p_trainer_user_id end;

  update public.assignments a
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = v_trainer_user_id,
    title = v_title,
    description = public.m69_4_normalize_text(p_description, 'Description', false, 2000),
    instructions = public.m69_4_normalize_text(p_instructions, 'Instructions', false, 4000),
    attachment_urls_json = public.m69_4_validate_attachment_urls(p_attachment_urls_json),
    max_score = public.m69_4_validate_score(p_max_score, null),
    due_at = p_due_at
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
  returning * into v_assignment;

  perform public.m69_4_write_audit(
    p_tenant_id,
    'assignment_updated',
    'assignment',
    v_assignment.id,
    'Assignment',
    'Updated assignment',
    'info',
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'courseId', v_assignment.course_id,
      'cohortId', v_assignment.cohort_id,
      'status', v_assignment.status,
      'dueDatePresent', v_assignment.due_at is not null,
      'maxScorePresent', v_assignment.max_score is not null
    )
  );

  return v_assignment;
end;
$$;

create or replace function public.update_assignment_status_secure(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_status text
)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.assignments%rowtype;
  v_assignment public.assignments%rowtype;
  v_status text;
begin
  v_existing := public.m69_4_assert_assignment_in_tenant(p_tenant_id, p_assignment_id);
  perform public.m69_4_assert_manage_assignment(
    p_tenant_id,
    v_existing.course_id,
    v_existing.cohort_id,
    p_assignment_id,
    v_existing.trainer_user_id
  );

  v_status := public.m69_4_validate_assignment_status(p_status);

  if v_status = 'draft' then
    raise exception 'Assignment status can only be changed to published or closed here.' using errcode = '22023';
  end if;

  update public.assignments a
  set status = v_status
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
  returning * into v_assignment;

  perform public.m69_4_write_audit(
    p_tenant_id,
    case when v_assignment.status = 'closed' then 'assignment_closed' else 'assignment_published' end,
    'assignment',
    v_assignment.id,
    'Assignment',
    case when v_assignment.status = 'closed' then 'Closed assignment' else 'Published assignment' end,
    case when v_assignment.status = 'closed' then 'warning' else 'info' end,
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'courseId', v_assignment.course_id,
      'cohortId', v_assignment.cohort_id,
      'status', v_assignment.status,
      'dueDatePresent', v_assignment.due_at is not null
    )
  );

  return v_assignment;
end;
$$;

create or replace function public.submit_assignment_secure(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_submission_text text default null,
  p_attachment_urls_json jsonb default '[]'::jsonb
)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments%rowtype;
  v_role text;
  v_submission public.assignment_submissions%rowtype;
  v_status text;
  v_student_portal_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_assignment := public.m69_4_assert_assignment_in_tenant(p_tenant_id, p_assignment_id);
  perform public.m69_4_assert_student_in_assignment_roster(p_tenant_id, v_assignment, p_student_id);

  v_role := public.m69_4_current_role(p_tenant_id);
  v_student_portal_allowed := public.has_active_student_portal_account(p_tenant_id, p_student_id, auth.uid());

  if v_role in ('owner', 'admin') then
    null;
  elsif v_student_portal_allowed then
    if v_assignment.status <> 'published' then
      raise exception 'Assignment is not open for student submissions.' using errcode = '42501';
    end if;
  else
    raise exception 'You do not have permission to submit this assignment.' using errcode = '42501';
  end if;

  v_status := public.m69_4_submission_status_for_due_date(v_assignment.due_at);

  insert into public.assignment_submissions (
    tenant_id,
    assignment_id,
    student_id,
    submitted_by,
    submission_text,
    attachment_urls_json,
    status,
    submitted_at
  )
  values (
    p_tenant_id,
    p_assignment_id,
    p_student_id,
    auth.uid(),
    public.m69_4_normalize_text(p_submission_text, 'Submission text', false, 6000),
    public.m69_4_validate_attachment_urls(p_attachment_urls_json),
    v_status,
    now()
  )
  on conflict (assignment_id, student_id)
  do update set
    submitted_by = excluded.submitted_by,
    submission_text = excluded.submission_text,
    attachment_urls_json = excluded.attachment_urls_json,
    status = excluded.status,
    submitted_at = excluded.submitted_at,
    score = null,
    feedback = null,
    reviewed_at = null,
    reviewed_by = null
  returning * into v_submission;

  perform public.m69_4_write_audit(
    p_tenant_id,
    'assignment_submitted',
    'assignment_submission',
    v_submission.id,
    'Assignment submission',
    'Recorded assignment submission',
    'info',
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'studentId', v_submission.student_id,
      'status', v_submission.status,
      'submittedByStudentPortal', v_student_portal_allowed
    )
  );

  return v_submission;
end;
$$;

create or replace function public.review_assignment_submission_secure(
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
  v_assignment public.assignments%rowtype;
  v_submission public.assignment_submissions%rowtype;
  v_score numeric;
begin
  v_assignment := public.m69_4_assert_assignment_in_tenant(p_tenant_id, p_assignment_id);
  perform public.m69_4_assert_student_in_assignment_roster(p_tenant_id, v_assignment, p_student_id);
  perform public.m69_4_assert_review_assignment(
    p_tenant_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    p_student_id,
    p_assignment_id,
    v_assignment.trainer_user_id
  );

  v_score := public.m69_4_validate_score(p_score, v_assignment.max_score);

  update public.assignment_submissions s
  set
    feedback = public.m69_4_normalize_text(p_feedback, 'Feedback', false, 4000),
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    score = v_score,
    status = 'reviewed'
  where s.tenant_id = p_tenant_id
    and s.assignment_id = p_assignment_id
    and s.student_id = p_student_id
  returning * into v_submission;

  if not found then
    raise exception 'Submission not found for this student.' using errcode = '22023';
  end if;

  perform public.m69_4_write_audit(
    p_tenant_id,
    'assignment_reviewed',
    'assignment_submission',
    v_submission.id,
    'Assignment submission',
    'Reviewed assignment submission',
    'info',
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'studentId', v_submission.student_id,
      'status', v_submission.status,
      'scorePresent', v_submission.score is not null
    )
  );

  return v_submission;
end;
$$;

revoke execute on function public.m69_4_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_normalize_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.m69_4_validate_assignment_status(text) from public, anon, authenticated;
revoke execute on function public.m69_4_validate_submission_status(text) from public, anon, authenticated;
revoke execute on function public.m69_4_validate_attachment_urls(jsonb) from public, anon, authenticated;
revoke execute on function public.m69_4_validate_score(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_course_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_cohort_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_course_cohort_consistency(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_assignment_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_trainer_can_manage_scope(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_delegated_permission_id(uuid, uuid, text[], uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_manage_assignment(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_review_assignment(uuid, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_student_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_assert_student_in_assignment_roster(uuid, public.assignments, uuid) from public, anon, authenticated;
revoke execute on function public.m69_4_submission_status_for_due_date(timestamptz) from public, anon, authenticated;
revoke execute on function public.m69_4_write_audit(uuid, text, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.create_assignment_secure(uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz) from public, anon;
revoke execute on function public.update_assignment_secure(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz) from public, anon;
revoke execute on function public.update_assignment_status_secure(uuid, uuid, text) from public, anon;
revoke execute on function public.submit_assignment_secure(uuid, uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.review_assignment_submission_secure(uuid, uuid, uuid, numeric, text) from public, anon;

grant execute on function public.create_assignment_secure(uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz) to authenticated;
grant execute on function public.update_assignment_secure(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz) to authenticated;
grant execute on function public.update_assignment_status_secure(uuid, uuid, text) to authenticated;
grant execute on function public.submit_assignment_secure(uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.review_assignment_submission_secure(uuid, uuid, uuid, numeric, text) to authenticated;

comment on function public.create_assignment_secure(uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz)
is 'Module 69.4 secure assignment create RPC. Direct table grants are intentionally preserved until a later confidence/revoke module.';
comment on function public.submit_assignment_secure(uuid, uuid, uuid, text, jsonb)
is 'Module 69.4 secure assignment submission RPC. Allows owner/admin-managed submissions and active linked student portal self-submissions only after server-side authorization.';

commit;
