-- Module 69.2: Courses, sections, lessons, and cohorts secure write RPCs.
-- This migration is additive. It intentionally does not revoke existing direct
-- table grants; those revokes must wait until the replacement flows are proven
-- in production.

begin;

create or replace function public.m69_2_current_role(p_tenant_id uuid)
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

create or replace function public.m69_2_assert_manage_courses(p_tenant_id uuid)
returns void
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

  v_role := public.m69_2_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'You do not have permission to manage courses.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.m69_2_assert_delete_records(p_tenant_id uuid)
returns void
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

  v_role := public.m69_2_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'You do not have permission to delete records.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.m69_2_normalize_text(
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

create or replace function public.m69_2_create_course_slug(p_title text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  v_slug := lower(trim(coalesce(p_title, '')));
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
  v_slug := left(v_slug, 64);

  if v_slug is null or v_slug = '' then
    return 'course';
  end if;

  return v_slug;
end;
$$;

create or replace function public.m69_2_validate_course_status(p_status text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'draft')));
begin
  if v_status not in ('draft', 'published', 'archived') then
    raise exception 'Invalid course status.' using errcode = '22023';
  end if;

  return v_status;
end;
$$;

create or replace function public.m69_2_validate_lesson_type(p_lesson_type text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_lesson_type text := lower(trim(coalesce(p_lesson_type, 'text')));
begin
  if v_lesson_type not in ('text', 'video', 'pdf', 'quiz', 'assignment') then
    raise exception 'Invalid lesson type.' using errcode = '22023';
  end if;

  return v_lesson_type;
end;
$$;

create or replace function public.m69_2_assert_course_in_tenant(
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

create or replace function public.m69_2_assert_section_in_course(
  p_tenant_id uuid,
  p_course_id uuid,
  p_section_id uuid
)
returns public.course_sections
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_section public.course_sections%rowtype;
begin
  select *
  into v_section
  from public.course_sections as cs
  where cs.tenant_id = p_tenant_id
    and cs.course_id = p_course_id
    and cs.id = p_section_id;

  if not found then
    raise exception 'Course section not found in this workspace.' using errcode = '22023';
  end if;

  return v_section;
end;
$$;

create or replace function public.m69_2_assert_lesson_in_section(
  p_tenant_id uuid,
  p_course_id uuid,
  p_section_id uuid,
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
  select *
  into v_lesson
  from public.lessons as l
  where l.tenant_id = p_tenant_id
    and l.course_id = p_course_id
    and l.section_id = p_section_id
    and l.id = p_lesson_id;

  if not found then
    raise exception 'Lesson not found in this workspace.' using errcode = '22023';
  end if;

  return v_lesson;
end;
$$;

create or replace function public.m69_2_assert_cohort_in_tenant(
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

create or replace function public.m69_2_write_audit(
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

create or replace function public.create_course_section_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_title text,
  p_sort_order integer default 0
)
returns table (
  id uuid,
  course_id uuid,
  tenant_id uuid,
  title text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_section public.course_sections%rowtype;
begin
  perform public.m69_2_assert_manage_courses(p_tenant_id);
  perform public.m69_2_assert_course_in_tenant(p_tenant_id, p_course_id);

  v_title := public.m69_2_normalize_text(p_title, 'Section title', true, 160);

  insert into public.course_sections (
    tenant_id,
    course_id,
    title,
    sort_order
  )
  values (
    p_tenant_id,
    p_course_id,
    v_title,
    greatest(coalesce(p_sort_order, 0), 0)
  )
  returning * into v_section;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'course_section_created',
    'course_section',
    v_section.id,
    'Course section',
    'Added course section',
    'info',
    jsonb_build_object(
      'courseId', v_section.course_id,
      'sectionId', v_section.id,
      'sortOrder', v_section.sort_order
    )
  );

  return query
  select
    v_section.id,
    v_section.course_id,
    v_section.tenant_id,
    v_section.title,
    v_section.sort_order,
    v_section.created_at,
    v_section.updated_at;
end;
$$;

create or replace function public.update_course_section_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_section_id uuid,
  p_title text
)
returns table (
  id uuid,
  course_id uuid,
  tenant_id uuid,
  title text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_section public.course_sections%rowtype;
begin
  perform public.m69_2_assert_manage_courses(p_tenant_id);
  perform public.m69_2_assert_section_in_course(p_tenant_id, p_course_id, p_section_id);

  v_title := public.m69_2_normalize_text(p_title, 'Section title', true, 160);

  update public.course_sections as cs
  set title = v_title
  where cs.tenant_id = p_tenant_id
    and cs.course_id = p_course_id
    and cs.id = p_section_id
  returning * into v_section;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'course_section_updated',
    'course_section',
    v_section.id,
    'Course section',
    'Updated course section',
    'info',
    jsonb_build_object(
      'courseId', v_section.course_id,
      'sectionId', v_section.id,
      'sortOrder', v_section.sort_order
    )
  );

  return query
  select
    v_section.id,
    v_section.course_id,
    v_section.tenant_id,
    v_section.title,
    v_section.sort_order,
    v_section.created_at,
    v_section.updated_at;
end;
$$;

create or replace function public.delete_course_section_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_section_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_section public.course_sections%rowtype;
begin
  perform public.m69_2_assert_delete_records(p_tenant_id);
  v_section := public.m69_2_assert_section_in_course(p_tenant_id, p_course_id, p_section_id);

  delete from public.course_sections as cs
  where cs.tenant_id = p_tenant_id
    and cs.course_id = p_course_id
    and cs.id = p_section_id;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'course_section_deleted',
    'course_section',
    v_section.id,
    'Course section',
    'Deleted course section',
    'warning',
    jsonb_build_object(
      'courseId', v_section.course_id,
      'sectionId', v_section.id,
      'sortOrder', v_section.sort_order
    )
  );
end;
$$;

create or replace function public.create_lesson_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_section_id uuid,
  p_title text,
  p_lesson_type text default 'text',
  p_content text default null,
  p_video_url text default null,
  p_resource_url text default null,
  p_sort_order integer default 0,
  p_is_preview boolean default false
)
returns table (
  id uuid,
  section_id uuid,
  course_id uuid,
  tenant_id uuid,
  title text,
  lesson_type text,
  content text,
  video_url text,
  resource_url text,
  sort_order integer,
  is_preview boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_lesson_type text;
  v_content text;
  v_video_url text;
  v_resource_url text;
  v_lesson public.lessons%rowtype;
begin
  perform public.m69_2_assert_manage_courses(p_tenant_id);
  perform public.m69_2_assert_section_in_course(p_tenant_id, p_course_id, p_section_id);

  v_title := public.m69_2_normalize_text(p_title, 'Lesson title', true, 180);
  v_lesson_type := public.m69_2_validate_lesson_type(p_lesson_type);
  v_content := public.m69_2_normalize_text(p_content, 'Lesson content', false, 20000);
  v_video_url := public.m69_2_normalize_text(p_video_url, 'Video URL', false, 1000);
  v_resource_url := public.m69_2_normalize_text(p_resource_url, 'Resource URL', false, 1000);

  insert into public.lessons (
    tenant_id,
    course_id,
    section_id,
    title,
    lesson_type,
    content,
    video_url,
    resource_url,
    sort_order,
    is_preview
  )
  values (
    p_tenant_id,
    p_course_id,
    p_section_id,
    v_title,
    v_lesson_type,
    v_content,
    v_video_url,
    v_resource_url,
    greatest(coalesce(p_sort_order, 0), 0),
    coalesce(p_is_preview, false)
  )
  returning * into v_lesson;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'lesson_created',
    'lesson',
    v_lesson.id,
    'Lesson',
    'Added course lesson',
    'info',
    jsonb_build_object(
      'courseId', v_lesson.course_id,
      'sectionId', v_lesson.section_id,
      'lessonId', v_lesson.id,
      'lessonType', v_lesson.lesson_type,
      'sortOrder', v_lesson.sort_order,
      'isPreview', v_lesson.is_preview
    )
  );

  return query
  select
    v_lesson.id,
    v_lesson.section_id,
    v_lesson.course_id,
    v_lesson.tenant_id,
    v_lesson.title,
    v_lesson.lesson_type,
    v_lesson.content,
    v_lesson.video_url,
    v_lesson.resource_url,
    v_lesson.sort_order,
    v_lesson.is_preview,
    v_lesson.created_at,
    v_lesson.updated_at;
end;
$$;

create or replace function public.update_lesson_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_section_id uuid,
  p_lesson_id uuid,
  p_title text,
  p_lesson_type text default 'text',
  p_content text default null,
  p_video_url text default null,
  p_resource_url text default null,
  p_is_preview boolean default false
)
returns table (
  id uuid,
  section_id uuid,
  course_id uuid,
  tenant_id uuid,
  title text,
  lesson_type text,
  content text,
  video_url text,
  resource_url text,
  sort_order integer,
  is_preview boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_lesson_type text;
  v_content text;
  v_video_url text;
  v_resource_url text;
  v_lesson public.lessons%rowtype;
begin
  perform public.m69_2_assert_manage_courses(p_tenant_id);
  perform public.m69_2_assert_lesson_in_section(p_tenant_id, p_course_id, p_section_id, p_lesson_id);

  v_title := public.m69_2_normalize_text(p_title, 'Lesson title', true, 180);
  v_lesson_type := public.m69_2_validate_lesson_type(p_lesson_type);
  v_content := public.m69_2_normalize_text(p_content, 'Lesson content', false, 20000);
  v_video_url := public.m69_2_normalize_text(p_video_url, 'Video URL', false, 1000);
  v_resource_url := public.m69_2_normalize_text(p_resource_url, 'Resource URL', false, 1000);

  update public.lessons as l
  set
    title = v_title,
    lesson_type = v_lesson_type,
    content = v_content,
    video_url = v_video_url,
    resource_url = v_resource_url,
    is_preview = coalesce(p_is_preview, false)
  where l.tenant_id = p_tenant_id
    and l.course_id = p_course_id
    and l.section_id = p_section_id
    and l.id = p_lesson_id
  returning * into v_lesson;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'lesson_updated',
    'lesson',
    v_lesson.id,
    'Lesson',
    'Updated course lesson',
    'info',
    jsonb_build_object(
      'courseId', v_lesson.course_id,
      'sectionId', v_lesson.section_id,
      'lessonId', v_lesson.id,
      'lessonType', v_lesson.lesson_type,
      'sortOrder', v_lesson.sort_order,
      'isPreview', v_lesson.is_preview
    )
  );

  return query
  select
    v_lesson.id,
    v_lesson.section_id,
    v_lesson.course_id,
    v_lesson.tenant_id,
    v_lesson.title,
    v_lesson.lesson_type,
    v_lesson.content,
    v_lesson.video_url,
    v_lesson.resource_url,
    v_lesson.sort_order,
    v_lesson.is_preview,
    v_lesson.created_at,
    v_lesson.updated_at;
end;
$$;

create or replace function public.delete_lesson_secure(
  p_tenant_id uuid,
  p_course_id uuid,
  p_section_id uuid,
  p_lesson_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.lessons%rowtype;
begin
  perform public.m69_2_assert_delete_records(p_tenant_id);
  v_lesson := public.m69_2_assert_lesson_in_section(p_tenant_id, p_course_id, p_section_id, p_lesson_id);

  delete from public.lessons as l
  where l.tenant_id = p_tenant_id
    and l.course_id = p_course_id
    and l.section_id = p_section_id
    and l.id = p_lesson_id;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'lesson_deleted',
    'lesson',
    v_lesson.id,
    'Lesson',
    'Deleted course lesson',
    'warning',
    jsonb_build_object(
      'courseId', v_lesson.course_id,
      'sectionId', v_lesson.section_id,
      'lessonId', v_lesson.id,
      'lessonType', v_lesson.lesson_type,
      'sortOrder', v_lesson.sort_order,
      'isPreview', v_lesson.is_preview
    )
  );
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

create or replace function public.update_cohort_secure(
  p_tenant_id uuid,
  p_cohort_id uuid,
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
  perform public.m69_2_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_2_assert_course_in_tenant(p_tenant_id, p_course_id);

  v_name := public.m69_2_normalize_text(p_name, 'Cohort name', true, 160);
  v_description := public.m69_2_normalize_text(p_description, 'Description', false, 2000);

  if p_start_date is not null and p_end_date is not null and p_start_date > p_end_date then
    raise exception 'Start date must be before end date.' using errcode = '22023';
  end if;

  update public.cohorts as c
  set
    course_id = p_course_id,
    name = v_name,
    description = v_description,
    start_date = p_start_date,
    end_date = p_end_date
  where c.tenant_id = p_tenant_id
    and c.id = p_cohort_id
  returning * into v_cohort;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'cohort_updated',
    'cohort',
    v_cohort.id,
    'Cohort',
    'Updated cohort',
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

create or replace function public.delete_cohort_secure(
  p_tenant_id uuid,
  p_cohort_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cohort public.cohorts%rowtype;
  v_student_count integer := 0;
begin
  perform public.m69_2_assert_delete_records(p_tenant_id);
  v_cohort := public.m69_2_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);

  select count(*)::integer
  into v_student_count
  from public.cohort_members as cm
  where cm.tenant_id = p_tenant_id
    and cm.cohort_id = p_cohort_id;

  delete from public.cohorts as c
  where c.tenant_id = p_tenant_id
    and c.id = p_cohort_id;

  perform public.m69_2_write_audit(
    p_tenant_id,
    'cohort_deleted',
    'cohort',
    v_cohort.id,
    'Cohort',
    'Deleted cohort',
    'warning',
    jsonb_build_object(
      'cohortId', v_cohort.id,
      'courseId', v_cohort.course_id,
      'studentCount', v_student_count
    )
  );
end;
$$;

revoke execute on function public.m69_2_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_2_assert_manage_courses(uuid) from public, anon, authenticated;
revoke execute on function public.m69_2_assert_delete_records(uuid) from public, anon, authenticated;
revoke execute on function public.m69_2_normalize_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.m69_2_create_course_slug(text) from public, anon, authenticated;
revoke execute on function public.m69_2_validate_course_status(text) from public, anon, authenticated;
revoke execute on function public.m69_2_validate_lesson_type(text) from public, anon, authenticated;
revoke execute on function public.m69_2_assert_course_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_2_assert_section_in_course(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_2_assert_lesson_in_section(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_2_assert_cohort_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_2_write_audit(uuid, text, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.create_course_secure(uuid, text, text, text) from public, anon;
revoke execute on function public.create_course_section_secure(uuid, uuid, text, integer) from public, anon;
revoke execute on function public.update_course_section_secure(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.delete_course_section_secure(uuid, uuid, uuid) from public, anon;
revoke execute on function public.create_lesson_secure(uuid, uuid, uuid, text, text, text, text, text, integer, boolean) from public, anon;
revoke execute on function public.update_lesson_secure(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.delete_lesson_secure(uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function public.create_cohort_secure(uuid, uuid, text, text, date, date) from public, anon;
revoke execute on function public.update_cohort_secure(uuid, uuid, uuid, text, text, date, date) from public, anon;
revoke execute on function public.delete_cohort_secure(uuid, uuid) from public, anon;

grant execute on function public.create_course_secure(uuid, text, text, text) to authenticated;
grant execute on function public.create_course_section_secure(uuid, uuid, text, integer) to authenticated;
grant execute on function public.update_course_section_secure(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.delete_course_section_secure(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_lesson_secure(uuid, uuid, uuid, text, text, text, text, text, integer, boolean) to authenticated;
grant execute on function public.update_lesson_secure(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_lesson_secure(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_cohort_secure(uuid, uuid, text, text, date, date) to authenticated;
grant execute on function public.update_cohort_secure(uuid, uuid, uuid, text, text, date, date) to authenticated;
grant execute on function public.delete_cohort_secure(uuid, uuid) to authenticated;

commit;
