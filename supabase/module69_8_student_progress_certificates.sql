-- Module 69.8: Student portal progress and certificate hardening.
-- This migration is additive. Existing direct table grants are intentionally
-- left in place until the RPC-backed flows have production confidence.

begin;

create or replace function public.m69_8_current_role(p_tenant_id uuid)
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

create or replace function public.m69_8_assert_member_role(
  p_tenant_id uuid,
  p_allowed_roles text[],
  p_message text default 'You do not have permission to perform this action.'
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

  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  v_role := public.m69_8_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if not (v_role = any(p_allowed_roles)) then
    raise exception '%', coalesce(p_message, 'You do not have permission to perform this action.') using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m69_8_validate_progress_status(p_status text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'not_started')));
begin
  if v_status not in ('not_started', 'in_progress', 'completed') then
    raise exception 'Invalid lesson progress status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_8_assert_student_in_tenant(
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
  if p_student_id is null then
    raise exception 'Student is required.' using errcode = '22023';
  end if;

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

create or replace function public.m69_8_assert_course_in_tenant(
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
    raise exception 'Course is required.' using errcode = '22023';
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

create or replace function public.m69_8_assert_lesson_in_course(
  p_tenant_id uuid,
  p_course_id uuid,
  p_lesson_id uuid
)
returns public.lessons
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lesson public.lessons%rowtype;
begin
  if p_lesson_id is null then
    raise exception 'Lesson is required.' using errcode = '22023';
  end if;

  select *
  into v_lesson
  from public.lessons l
  where l.tenant_id = p_tenant_id
    and l.course_id = p_course_id
    and l.id = p_lesson_id;

  if not found then
    raise exception 'Lesson not found in this course.' using errcode = '22023';
  end if;

  return v_lesson;
end;
$$;

create or replace function public.m69_8_assert_student_enrolled(
  p_tenant_id uuid,
  p_student_id uuid,
  p_course_id uuid
)
returns public.enrollments
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
begin
  select *
  into v_enrollment
  from public.enrollments e
  where e.tenant_id = p_tenant_id
    and e.student_id = p_student_id
    and e.course_id = p_course_id
    and e.status in ('active', 'paused', 'completed');

  if not found then
    raise exception 'Student is not enrolled in this course.' using errcode = '22023';
  end if;

  return v_enrollment;
end;
$$;

create or replace function public.m69_8_trainer_can_manage_course(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_course_id is not null
    and exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = p_tenant_id
        and tca.trainer_user_id = p_trainer_user_id
        and tca.course_id = p_course_id
    ),
    false
  )
$$;

create or replace function public.m69_8_delegated_permission_id(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_permission_keys text[],
  p_course_id uuid,
  p_student_id uuid default null
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
    null,
    p_student_id,
    null,
    null
  )
$$;

create or replace function public.m69_8_assert_can_view_certificate(
  p_tenant_id uuid,
  p_role text,
  p_course_id uuid,
  p_student_id uuid
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

  if p_role = 'trainer'
     and public.m69_8_trainer_can_manage_course(p_tenant_id, auth.uid(), p_course_id) then
    return;
  end if;

  if public.m69_8_delegated_permission_id(
    p_tenant_id,
    auth.uid(),
    array['issue_certificates'],
    p_course_id,
    p_student_id
  ) is not null then
    return;
  end if;

  raise exception 'You do not have permission to view this certificate.' using errcode = '42501';
end;
$$;

create or replace function public.m69_8_assert_can_manage_progress(
  p_tenant_id uuid,
  p_role text,
  p_course_id uuid,
  p_student_id uuid
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

  if p_role = 'trainer'
     and public.m69_8_trainer_can_manage_course(p_tenant_id, auth.uid(), p_course_id) then
    return;
  end if;

  if public.m69_8_delegated_permission_id(
    p_tenant_id,
    auth.uid(),
    array['manage_students', 'manage_courses'],
    p_course_id,
    p_student_id
  ) is not null then
    return;
  end if;

  raise exception 'You do not have permission to manage this student progress.' using errcode = '42501';
end;
$$;

create or replace function public.m69_8_write_audit(
  p_tenant_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_name text,
  p_description text,
  p_severity text,
  p_metadata jsonb
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
    metadata,
    severity
  )
  values (
    p_tenant_id,
    auth.uid(),
    p_action,
    p_entity_type,
    p_entity_id,
    p_entity_name,
    p_description,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_severity, 'info')
  );
end;
$$;

create or replace function public.recalculate_student_course_progress_secure(
  p_tenant_id uuid,
  p_student_id uuid,
  p_course_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_total_lessons integer;
  v_completed_lessons integer;
  v_is_completed boolean;
  v_progress_percentage integer;
  v_enrollment public.enrollments%rowtype;
begin
  v_role := public.m69_8_assert_member_role(
    p_tenant_id,
    array['owner', 'admin', 'staff', 'trainer'],
    'You do not have permission to update student progress.'
  );

  perform public.m69_8_assert_student_in_tenant(p_tenant_id, p_student_id);
  perform public.m69_8_assert_course_in_tenant(p_tenant_id, p_course_id);
  v_enrollment := public.m69_8_assert_student_enrolled(p_tenant_id, p_student_id, p_course_id);
  perform public.m69_8_assert_can_manage_progress(p_tenant_id, v_role, p_course_id, p_student_id);

  select count(*)
  into v_total_lessons
  from public.lessons l
  where l.tenant_id = p_tenant_id
    and l.course_id = p_course_id;

  select count(*)
  into v_completed_lessons
  from public.lesson_progress lp
  where lp.tenant_id = p_tenant_id
    and lp.student_id = p_student_id
    and lp.course_id = p_course_id
    and lp.status = 'completed';

  v_is_completed := v_total_lessons > 0 and v_completed_lessons >= v_total_lessons;
  v_progress_percentage := case
    when v_total_lessons <= 0 then 0
    else round((v_completed_lessons::numeric / v_total_lessons::numeric) * 100)::integer
  end;

  if v_is_completed and v_enrollment.status <> 'completed' then
    update public.enrollments e
    set
      status = 'completed',
      completed_at = now()
    where e.tenant_id = p_tenant_id
      and e.id = v_enrollment.id;

    perform public.m69_8_write_audit(
      p_tenant_id,
      'course_completion_recorded',
      'enrollment',
      v_enrollment.id,
      'Course enrollment',
      'Recorded course completion from lesson progress.',
      'info',
      jsonb_build_object(
        'courseId', p_course_id,
        'studentId', p_student_id,
        'status', 'completed'
      )
    );
  end if;

  return jsonb_build_object(
    'completed_lessons', v_completed_lessons,
    'is_completed', v_is_completed,
    'progress_percentage', v_progress_percentage,
    'total_lessons', v_total_lessons
  );
end;
$$;

create or replace function public.mark_lesson_progress_secure(
  p_tenant_id uuid,
  p_student_id uuid,
  p_course_id uuid,
  p_lesson_id uuid,
  p_status text
)
returns table (
  id uuid,
  tenant_id uuid,
  student_id uuid,
  course_id uuid,
  lesson_id uuid,
  status text,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_existing public.lesson_progress%rowtype;
  v_progress public.lesson_progress%rowtype;
begin
  v_role := public.m69_8_assert_member_role(
    p_tenant_id,
    array['owner', 'admin', 'staff', 'trainer'],
    'You do not have permission to update lesson progress.'
  );

  perform public.m69_8_assert_student_in_tenant(p_tenant_id, p_student_id);
  perform public.m69_8_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_8_assert_lesson_in_course(p_tenant_id, p_course_id, p_lesson_id);
  perform public.m69_8_assert_student_enrolled(p_tenant_id, p_student_id, p_course_id);
  perform public.m69_8_assert_can_manage_progress(p_tenant_id, v_role, p_course_id, p_student_id);

  v_status := public.m69_8_validate_progress_status(p_status);

  select *
  into v_existing
  from public.lesson_progress lp
  where lp.tenant_id = p_tenant_id
    and lp.student_id = p_student_id
    and lp.course_id = p_course_id
    and lp.lesson_id = p_lesson_id;

  if found then
    update public.lesson_progress lp
    set
      status = v_status,
      completed_at = case when v_status = 'completed' then coalesce(lp.completed_at, now()) else null end
    where lp.id = v_existing.id
    returning * into v_progress;
  else
    insert into public.lesson_progress (
      tenant_id,
      student_id,
      course_id,
      lesson_id,
      status,
      completed_at
    )
    values (
      p_tenant_id,
      p_student_id,
      p_course_id,
      p_lesson_id,
      v_status,
      case when v_status = 'completed' then now() else null end
    )
    returning * into v_progress;
  end if;

  perform public.recalculate_student_course_progress_secure(p_tenant_id, p_student_id, p_course_id);

  perform public.m69_8_write_audit(
    p_tenant_id,
    'lesson_progress_updated',
    'lesson_progress',
    v_progress.id,
    'Lesson progress',
    'Updated lesson progress.',
    'info',
    jsonb_build_object(
      'courseId', p_course_id,
      'lessonId', p_lesson_id,
      'studentId', p_student_id,
      'status', v_status
    )
  );

  return query
  select
    v_progress.id,
    v_progress.tenant_id,
    v_progress.student_id,
    v_progress.course_id,
    v_progress.lesson_id,
    v_progress.status,
    v_progress.completed_at,
    v_progress.created_at,
    v_progress.updated_at;
exception
  when unique_violation then
    raise exception 'Lesson progress already exists for this student.' using errcode = '23505';
end;
$$;

create or replace function public.get_certificate_data_secure(
  p_tenant_id uuid,
  p_enrollment_id uuid
)
returns table (
  certificate_number text,
  completion_date timestamptz,
  course_title text,
  enrollment_id uuid,
  student_name text,
  tenant_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_enrollment public.enrollments%rowtype;
  v_student public.students%rowtype;
  v_course public.courses%rowtype;
  v_sequence integer;
begin
  v_role := public.m69_8_assert_member_role(
    p_tenant_id,
    array['owner', 'admin', 'staff', 'trainer'],
    'Workspace membership is required.'
  );

  if p_enrollment_id is null then
    raise exception 'Enrollment is required.' using errcode = '22023';
  end if;

  select *
  into v_enrollment
  from public.enrollments e
  where e.tenant_id = p_tenant_id
    and e.id = p_enrollment_id;

  if not found then
    return;
  end if;

  if v_enrollment.status <> 'completed' or v_enrollment.completed_at is null then
    raise exception 'Certificate is available after course completion.' using errcode = '22023';
  end if;

  v_student := public.m69_8_assert_student_in_tenant(p_tenant_id, v_enrollment.student_id);
  v_course := public.m69_8_assert_course_in_tenant(p_tenant_id, v_enrollment.course_id);

  perform public.m69_8_assert_can_view_certificate(
    p_tenant_id,
    v_role,
    v_enrollment.course_id,
    v_enrollment.student_id
  );

  select count(*) + 1
  into v_sequence
  from public.enrollments e
  where e.tenant_id = p_tenant_id
    and e.status = 'completed'
    and e.completed_at is not null
    and (
      e.completed_at < v_enrollment.completed_at
      or (
        e.completed_at = v_enrollment.completed_at
        and e.created_at <= v_enrollment.created_at
        and e.id <> v_enrollment.id
      )
    );

  return query
  select
    (
      'CERT-' ||
      extract(year from v_enrollment.completed_at)::integer::text ||
      '-' ||
      lpad(greatest(v_sequence, 1)::text, 4, '0')
    )::text,
    v_enrollment.completed_at,
    v_course.title,
    v_enrollment.id,
    v_student.full_name,
    p_tenant_id;
end;
$$;

revoke execute on function public.m69_8_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_assert_member_role(uuid, text[], text) from public, anon, authenticated;
revoke execute on function public.m69_8_validate_progress_status(text) from public, anon, authenticated;
revoke execute on function public.m69_8_assert_student_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_assert_course_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_assert_lesson_in_course(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_assert_student_enrolled(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_trainer_can_manage_course(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_delegated_permission_id(uuid, uuid, text[], uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_assert_can_view_certificate(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_assert_can_manage_progress(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_8_write_audit(uuid, text, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.mark_lesson_progress_secure(uuid, uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.recalculate_student_course_progress_secure(uuid, uuid, uuid) from public, anon;
revoke execute on function public.get_certificate_data_secure(uuid, uuid) from public, anon;

grant execute on function public.mark_lesson_progress_secure(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.recalculate_student_course_progress_secure(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_certificate_data_secure(uuid, uuid) to authenticated;

commit;
