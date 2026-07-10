-- Module 71.7P6C: Student/Course/Cohort Secure RPC Canonical Limit Enforcement
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Patch create_student_secure, create_course_secure, and create_cohort_secure
--   so canonical live-count entity limits are enforced inside the same secure
--   SQL mutation transaction as each insert.
-- - Do not patch team invitation, invitation acceptance, role-change, payment,
--   checkout, subscription assignment, public catalog, request option, Module 62,
--   FeatureGate, or legacy Module 56 behavior in this module.
--
-- Dependency:
-- - public.assert_tenant_entity_usage_limit(uuid, text, integer, boolean)
--   from Module 71.7P6B must already exist.

begin;

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

  perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'students', 1, false);

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

create or replace function public.create_course_secure(
  p_tenant_id uuid,
  p_title text,
  p_description text default null,
  p_status text default 'draft'
)
returns table (
  id uuid,
  tenant_id uuid,
  title text,
  slug text,
  description text,
  status text,
  thumbnail_url text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_description text;
  v_status text;
  v_course public.courses%rowtype;
begin
  perform public.m69_2_assert_manage_courses(p_tenant_id);

  v_title := public.m69_2_normalize_text(p_title, 'Course title', true, 160);
  v_description := public.m69_2_normalize_text(p_description, 'Description', false, 2000);
  v_status := public.m69_2_validate_course_status(p_status);

  if v_status = 'archived' then
    raise exception 'New courses cannot be created as archived.' using errcode = '22023';
  end if;

  perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'courses', 1, false);

  insert into public.courses (
    tenant_id,
    title,
    slug,
    description,
    status,
    created_by
  )
  values (
    p_tenant_id,
    v_title,
    public.m69_2_create_course_slug(v_title),
    v_description,
    v_status,
    auth.uid()
  )
  returning * into v_course;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'course_created',
    'course',
    v_course.id,
    'Course',
    'Created new course',
    'info',
    jsonb_build_object(
      'courseId', v_course.id,
      'status', v_course.status
    )
  );

  return query
  select
    v_course.id,
    v_course.tenant_id,
    v_course.title,
    v_course.slug,
    v_course.description,
    v_course.status,
    v_course.thumbnail_url,
    v_course.created_by,
    v_course.created_at,
    v_course.updated_at;
end;
$$;

create or replace function public.create_cohort_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_name text,
  p_description text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  id uuid,
  tenant_id uuid,
  course_id uuid,
  name text,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_description text;
  v_cohort public.cohorts%rowtype;
begin
  perform public.m69_2_assert_manage_courses(p_tenant_id);
  perform public.m69_2_assert_course_in_tenant(p_tenant_id, p_course_id);

  v_name := public.m69_2_normalize_text(p_name, 'Cohort name', true, 160);
  v_description := public.m69_2_normalize_text(p_description, 'Description', false, 2000);

  if p_start_date is not null and p_end_date is not null and p_start_date > p_end_date then
    raise exception 'Start date must be before end date.' using errcode = '22023';
  end if;

  perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'cohorts', 1, false);

  insert into public.cohorts (
    tenant_id,
    course_id,
    name,
    description,
    start_date,
    end_date
  )
  values (
    p_tenant_id,
    p_course_id,
    v_name,
    v_description,
    p_start_date,
    p_end_date
  )
  returning * into v_cohort;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'cohort_created',
    'cohort',
    v_cohort.id,
    'Cohort',
    'Created cohort',
    'info',
    jsonb_build_object(
      'cohortId', v_cohort.id,
      'courseId', v_cohort.course_id,
      'startDatePresent', v_cohort.start_date is not null,
      'endDatePresent', v_cohort.end_date is not null
    )
  );

  return query
  select
    v_cohort.id,
    v_cohort.tenant_id,
    v_cohort.course_id,
    v_cohort.name,
    v_cohort.description,
    v_cohort.start_date,
    v_cohort.end_date,
    v_cohort.created_at;
end;
$$;

revoke execute on function public.create_student_secure(uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.create_course_secure(uuid, text, text, text) from public, anon;
revoke execute on function public.create_cohort_secure(uuid, uuid, text, text, date, date) from public, anon;

grant execute on function public.create_student_secure(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.create_course_secure(uuid, text, text, text) to authenticated;
grant execute on function public.create_cohort_secure(uuid, uuid, text, text, date, date) to authenticated;

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Confirm patched RPCs exist:
-- select routine_name
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name in (
--     'create_student_secure',
--     'create_course_secure',
--     'create_cohort_secure'
--   )
-- order by routine_name;
--
-- 2. Confirm execute grants remain authenticated-only for patched RPCs:
-- select grantee, routine_name, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name in (
--     'create_student_secure',
--     'create_course_secure',
--     'create_cohort_secure'
--   )
-- order by routine_name, grantee;
--
-- 3. Confirm direct writes remain revoked for app entity tables:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('students', 'courses', 'cohorts')
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
--   'students',
--   1,
--   false
-- );
--
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'courses',
--   1,
--   false
-- );
--
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'cohorts',
--   1,
--   false
-- );
--
-- 6. High-delta rejection smoke without mutation:
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'students',
--   1000000,
--   false
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
-- - Create one clearly named regression student through create_student_secure,
--   then clean it up only if the approved cleanup path is confirmed.
-- - Create one clearly named regression course/cohort only if course/cohort
--   cleanup paths are confirmed.
-- - Do not perform mutation smoke as part of this SQL proposal module.
--
-- Rollback SQL for later review only:
-- Re-apply the original create_student_secure, create_course_secure, and
-- create_cohort_secure definitions from Module 69 if rollback is required.
