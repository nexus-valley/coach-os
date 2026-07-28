-- Module 78: Secure draft-to-published program transition.
-- Proposal only. Review before execution.

begin;

create or replace function public.publish_course_secure(p_course_id uuid)
returns table (
  course_id uuid,
  tenant_id uuid,
  title text,
  slug text,
  status text,
  updated_at timestamptz,
  publication_result text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
  v_publication_result text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_course_id is null then
    raise exception 'Program id is required.' using errcode = '22023';
  end if;

  select c.*
  into v_course
  from public.courses as c
  where c.id = p_course_id
  for update;

  if not found then
    raise exception 'Program not found.' using errcode = '22023';
  end if;

  perform public.m69_2_assert_manage_courses(v_course.tenant_id);

  if v_course.status = 'archived' then
    raise exception 'Archived programs cannot be published.' using errcode = '22023';
  end if;

  if v_course.status = 'published' then
    v_publication_result := 'already_published';
  elsif v_course.status = 'draft' then
    update public.courses as c
    set status = 'published'
    where c.id = v_course.id
      and c.tenant_id = v_course.tenant_id
      and c.status = 'draft'
    returning c.* into v_course;

    if not found then
      raise exception 'Program could not be published.' using errcode = '22023';
    end if;

    v_publication_result := 'published';

    perform public.m69_2_write_audit(
      v_course.tenant_id,
      'course_published',
      'course',
      v_course.id,
      'Course',
      'Published course',
      'info',
      jsonb_build_object(
        'courseId', v_course.id,
        'status', v_course.status
      )
    );
  else
    raise exception 'Only draft programs can be published.' using errcode = '22023';
  end if;

  return query
  select
    v_course.id,
    v_course.tenant_id,
    v_course.title,
    v_course.slug,
    v_course.status,
    v_course.updated_at,
    v_publication_result;
end;
$$;

revoke execute on function public.publish_course_secure(uuid) from public, anon;
grant execute on function public.publish_course_secure(uuid) to authenticated;

commit;
