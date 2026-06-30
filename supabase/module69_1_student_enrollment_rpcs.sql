-- Module 69.1: Students, enrollments, and cohort membership secure write RPCs.
-- This migration is additive. It intentionally does not revoke existing direct
-- table grants; those revokes must wait until the replacement flows are proven
-- in production.

begin;

create or replace function public.m69_1_current_role(p_tenant_id uuid)
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
  limit 1;
$$;

create or replace function public.m69_1_assert_manage_students(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  v_role := public.m69_1_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'You do not have permission to manage students.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m69_1_assert_delete_records(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  v_role := public.m69_1_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'You do not have permission to delete records.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m69_1_normalize_text(
  p_value text,
  p_label text,
  p_required boolean default false,
  p_max_length integer default 240
)
returns text
language plpgsql
immutable
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

create or replace function public.m69_1_validate_student_status(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'active')));
begin
  if v_status not in ('active', 'inactive', 'lead', 'blocked') then
    raise exception 'Invalid student status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_1_validate_enrollment_status(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'active')));
begin
  if v_status not in ('active', 'completed', 'paused', 'cancelled') then
    raise exception 'Invalid enrollment status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_1_assert_student_in_tenant(
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
  from public.students as s
  where s.tenant_id = p_tenant_id
    and s.id = p_student_id;

  if not found then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  return v_student;
end;
$$;

create or replace function public.m69_1_assert_course_in_tenant(
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
    select 1
    from public.courses c
    where c.tenant_id = p_tenant_id
      and c.id = p_course_id
  ) then
    raise exception 'Course not found in this workspace.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.m69_1_assert_cohort_in_tenant(
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

create or replace function public.m69_1_write_audit(
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
  when undefined_table or undefined_column then
    return;
end;
$$;

create or replace function public.create_student_secure(
  p_tenant_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_source text default null,
  p_status text default 'active',
  p_notes text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  full_name text,
  email text,
  phone text,
  status text,
  source text,
  notes text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_full_name text;
  v_email text;
  v_phone text;
  v_source text;
  v_status text;
  v_notes text;
  v_student public.students%rowtype;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);

  v_full_name := public.m69_1_normalize_text(p_full_name, 'Full name', true, 160);
  v_email := public.m69_1_normalize_text(p_email, 'Email', false, 254);
  v_phone := public.m69_1_normalize_text(p_phone, 'Phone', false, 40);
  v_source := public.m69_1_normalize_text(p_source, 'Source', false, 80);
  v_notes := public.m69_1_normalize_text(p_notes, 'Notes', false, 2000);
  v_status := public.m69_1_validate_student_status(p_status);

  insert into public.students (
    tenant_id,
    full_name,
    email,
    phone,
    status,
    source,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_full_name,
    v_email,
    v_phone,
    v_status,
    v_source,
    v_notes,
    v_actor
  )
  returning * into v_student;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'student_created',
    'student',
    v_student.id,
    'Student profile',
    'Created new student profile',
    'info',
    jsonb_build_object(
      'studentId', v_student.id,
      'status', v_student.status
    )
  );

  return query
  select
    v_student.id,
    v_student.tenant_id,
    v_student.full_name,
    v_student.email,
    v_student.phone,
    v_student.status,
    v_student.source,
    v_student.notes,
    v_student.created_by,
    v_student.created_at,
    v_student.updated_at;
end;
$$;

create or replace function public.update_student_secure(
  p_tenant_id uuid,
  p_student_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_source text default null,
  p_status text default 'active',
  p_notes text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  full_name text,
  email text,
  phone text,
  status text,
  source text,
  notes text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_email text;
  v_phone text;
  v_source text;
  v_status text;
  v_notes text;
  v_student public.students%rowtype;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);
  perform public.m69_1_assert_student_in_tenant(p_tenant_id, p_student_id);

  v_full_name := public.m69_1_normalize_text(p_full_name, 'Full name', true, 160);
  v_email := public.m69_1_normalize_text(p_email, 'Email', false, 254);
  v_phone := public.m69_1_normalize_text(p_phone, 'Phone', false, 40);
  v_source := public.m69_1_normalize_text(p_source, 'Source', false, 80);
  v_notes := public.m69_1_normalize_text(p_notes, 'Notes', false, 2000);
  v_status := public.m69_1_validate_student_status(p_status);

  update public.students as s
  set
    full_name = v_full_name,
    email = v_email,
    phone = v_phone,
    source = v_source,
    status = v_status,
    notes = v_notes
  where s.tenant_id = p_tenant_id
    and s.id = p_student_id
  returning * into v_student;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'student_updated',
    'student',
    v_student.id,
    'Student profile',
    'Updated student profile',
    'info',
    jsonb_build_object(
      'studentId', v_student.id,
      'status', v_student.status
    )
  );

  return query
  select
    v_student.id,
    v_student.tenant_id,
    v_student.full_name,
    v_student.email,
    v_student.phone,
    v_student.status,
    v_student.source,
    v_student.notes,
    v_student.created_by,
    v_student.created_at,
    v_student.updated_at;
end;
$$;

create or replace function public.delete_student_secure(
  p_tenant_id uuid,
  p_student_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  perform public.m69_1_assert_delete_records(p_tenant_id);
  v_student := public.m69_1_assert_student_in_tenant(p_tenant_id, p_student_id);

  delete from public.students as s
  where s.tenant_id = p_tenant_id
    and s.id = p_student_id;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'student_deleted',
    'student',
    v_student.id,
    'Student profile',
    'Deleted student profile',
    'critical',
    jsonb_build_object(
      'studentId', v_student.id,
      'status', v_student.status
    )
  );
end;
$$;

create or replace function public.create_enrollment_secure(
  p_tenant_id uuid,
  p_student_id uuid,
  p_course_id uuid,
  p_status text default 'active'
)
returns table (
  id uuid,
  tenant_id uuid,
  student_id uuid,
  course_id uuid,
  status text,
  enrolled_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_enrollment public.enrollments%rowtype;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);
  perform public.m69_1_assert_student_in_tenant(p_tenant_id, p_student_id);
  perform public.m69_1_assert_course_in_tenant(p_tenant_id, p_course_id);

  v_status := public.m69_1_validate_enrollment_status(p_status);

  insert into public.enrollments (
    tenant_id,
    student_id,
    course_id,
    status,
    completed_at,
    created_by
  )
  values (
    p_tenant_id,
    p_student_id,
    p_course_id,
    v_status,
    case when v_status = 'completed' then now() else null end,
    v_actor
  )
  returning * into v_enrollment;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'enrollment_created',
    'enrollment',
    v_enrollment.id,
    'Course enrollment',
    'Added student enrollment',
    'info',
    jsonb_build_object(
      'courseId', v_enrollment.course_id,
      'studentId', v_enrollment.student_id,
      'status', v_enrollment.status
    )
  );

  return query
  select
    v_enrollment.id,
    v_enrollment.tenant_id,
    v_enrollment.student_id,
    v_enrollment.course_id,
    v_enrollment.status,
    v_enrollment.enrolled_at,
    v_enrollment.completed_at,
    v_enrollment.created_by,
    v_enrollment.created_at,
    v_enrollment.updated_at;
exception
  when unique_violation then
    raise exception 'This student is already enrolled in that course.' using errcode = '23505';
end;
$$;

create or replace function public.update_enrollment_status_secure(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_status text
)
returns table (
  id uuid,
  tenant_id uuid,
  student_id uuid,
  course_id uuid,
  status text,
  enrolled_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_enrollment public.enrollments%rowtype;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);

  select *
  into v_enrollment
  from public.enrollments as e
  where e.tenant_id = p_tenant_id
    and e.id = p_enrollment_id;

  if not found then
    raise exception 'Enrollment not found in this workspace.' using errcode = '22023';
  end if;

  v_status := public.m69_1_validate_enrollment_status(p_status);
  perform public.m69_1_assert_student_in_tenant(p_tenant_id, v_enrollment.student_id);
  perform public.m69_1_assert_course_in_tenant(p_tenant_id, v_enrollment.course_id);

  update public.enrollments as e
  set
    status = v_status,
    completed_at = case when v_status = 'completed' then now() else null end
  where e.tenant_id = p_tenant_id
    and e.id = p_enrollment_id
  returning * into v_enrollment;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'enrollment_updated',
    'enrollment',
    v_enrollment.id,
    'Course enrollment',
    'Updated enrollment status',
    'info',
    jsonb_build_object(
      'courseId', v_enrollment.course_id,
      'studentId', v_enrollment.student_id,
      'status', v_enrollment.status
    )
  );

  return query
  select
    v_enrollment.id,
    v_enrollment.tenant_id,
    v_enrollment.student_id,
    v_enrollment.course_id,
    v_enrollment.status,
    v_enrollment.enrolled_at,
    v_enrollment.completed_at,
    v_enrollment.created_by,
    v_enrollment.created_at,
    v_enrollment.updated_at;
end;
$$;

create or replace function public.remove_enrollment_secure(
  p_tenant_id uuid,
  p_enrollment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
begin
  perform public.m69_1_assert_delete_records(p_tenant_id);

  select *
  into v_enrollment
  from public.enrollments as e
  where e.tenant_id = p_tenant_id
    and e.id = p_enrollment_id;

  if not found then
    raise exception 'Enrollment not found in this workspace.' using errcode = '22023';
  end if;

  delete from public.enrollments as e
  where e.tenant_id = p_tenant_id
    and e.id = p_enrollment_id;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'enrollment_deleted',
    'enrollment',
    v_enrollment.id,
    'Course enrollment',
    'Removed course enrollment',
    'warning',
    jsonb_build_object(
      'courseId', v_enrollment.course_id,
      'studentId', v_enrollment.student_id,
      'status', v_enrollment.status
    )
  );
end;
$$;

create or replace function public.add_cohort_member_secure(
  p_tenant_id uuid,
  p_cohort_id uuid,
  p_student_id uuid
)
returns table (
  id uuid,
  tenant_id uuid,
  cohort_id uuid,
  student_id uuid,
  enrolled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.cohort_members%rowtype;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);
  perform public.m69_1_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_1_assert_student_in_tenant(p_tenant_id, p_student_id);

  insert into public.cohort_members (
    tenant_id,
    cohort_id,
    student_id
  )
  values (
    p_tenant_id,
    p_cohort_id,
    p_student_id
  )
  returning * into v_member;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'cohort_member_added',
    'cohort_member',
    v_member.id,
    'Cohort membership',
    'Added student to cohort',
    'info',
    jsonb_build_object(
      'cohortId', v_member.cohort_id,
      'studentId', v_member.student_id
    )
  );

  return query
  select
    v_member.id,
    v_member.tenant_id,
    v_member.cohort_id,
    v_member.student_id,
    v_member.enrolled_at;
exception
  when unique_violation then
    raise exception 'This student is already in that cohort.' using errcode = '23505';
end;
$$;

create or replace function public.remove_cohort_member_secure(
  p_tenant_id uuid,
  p_cohort_id uuid,
  p_student_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.cohort_members%rowtype;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);
  perform public.m69_1_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_1_assert_student_in_tenant(p_tenant_id, p_student_id);

  select *
  into v_member
  from public.cohort_members as cm
  where cm.tenant_id = p_tenant_id
    and cm.cohort_id = p_cohort_id
    and cm.student_id = p_student_id;

  delete from public.cohort_members as cm
  where cm.tenant_id = p_tenant_id
    and cm.cohort_id = p_cohort_id
    and cm.student_id = p_student_id;

  if found then
    perform public.m69_1_write_audit(
      p_tenant_id,
      'cohort_member_removed',
      'cohort_member',
      v_member.id,
      'Cohort membership',
      'Removed student from cohort',
      'warning',
      jsonb_build_object(
        'cohortId', p_cohort_id,
        'studentId', p_student_id
      )
    );
  end if;
end;
$$;

revoke execute on function public.m69_1_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_1_assert_manage_students(uuid) from public, anon, authenticated;
revoke execute on function public.m69_1_assert_delete_records(uuid) from public, anon, authenticated;
revoke execute on function public.m69_1_normalize_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.m69_1_validate_student_status(text) from public, anon, authenticated;
revoke execute on function public.m69_1_validate_enrollment_status(text) from public, anon, authenticated;
revoke execute on function public.m69_1_assert_student_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_1_assert_course_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_1_assert_cohort_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_1_write_audit(uuid, text, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.create_student_secure(uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.update_student_secure(uuid, uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.delete_student_secure(uuid, uuid) from public, anon;
revoke execute on function public.create_enrollment_secure(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.update_enrollment_status_secure(uuid, uuid, text) from public, anon;
revoke execute on function public.remove_enrollment_secure(uuid, uuid) from public, anon;
revoke execute on function public.add_cohort_member_secure(uuid, uuid, uuid) from public, anon;
revoke execute on function public.remove_cohort_member_secure(uuid, uuid, uuid) from public, anon;

grant execute on function public.create_student_secure(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_student_secure(uuid, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.delete_student_secure(uuid, uuid) to authenticated;
grant execute on function public.create_enrollment_secure(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.update_enrollment_status_secure(uuid, uuid, text) to authenticated;
grant execute on function public.remove_enrollment_secure(uuid, uuid) to authenticated;
grant execute on function public.add_cohort_member_secure(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_cohort_member_secure(uuid, uuid, uuid) to authenticated;

commit;
