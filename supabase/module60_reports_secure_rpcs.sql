-- Module 60 - Reports Stabilization & Secure Report RPCs
-- Additive migration only. Do not weaken existing RLS or grant direct table access.

create or replace function public.reports_current_role(p_tenant_id uuid)
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
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  limit 1
$$;

create or replace function public.reports_is_owner_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.reports_current_role(p_tenant_id) in ('owner', 'admin'), false)
$$;

create or replace function public.reports_start_date(p_date_range text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
begin
  case coalesce(p_date_range, 'last_30_days')
    when 'last_7_days' then
      return now() - interval '7 days';
    when 'last_30_days' then
      return now() - interval '30 days';
    when 'this_month' then
      return date_trunc('month', now());
    when 'all_time' then
      return null;
    else
      raise exception 'Invalid date_range.' using errcode = '22023';
  end case;
end;
$$;

create or replace function public.reports_validate_filters(
  p_tenant_id uuid,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  normalized jsonb := '{}'::jsonb;
  date_range text;
  course_id uuid;
  cohort_id uuid;
  trainer_user_id uuid;
  status_value text;
  uuid_pattern text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  actor_role := public.reports_current_role(p_tenant_id);
  if actor_role is null then
    raise exception 'Reports access denied.' using errcode = '42501';
  end if;

  if p_filters is null then
    p_filters := '{}'::jsonb;
  end if;

  if jsonb_typeof(p_filters) <> 'object' then
    raise exception 'Report filters must be a JSON object.' using errcode = '22023';
  end if;

  if char_length(p_filters::text) > 5000 then
    raise exception 'Report filters payload is too large.' using errcode = '22023';
  end if;

  date_range := coalesce(nullif(p_filters->>'date_range', ''), 'last_30_days');
  perform public.reports_start_date(date_range);

  if p_filters ? 'course_id' and nullif(p_filters->>'course_id', '') is not null then
    if not ((p_filters->>'course_id') ~ uuid_pattern) then
      raise exception 'Invalid course_id filter.' using errcode = '22023';
    end if;

    course_id := (p_filters->>'course_id')::uuid;

    if not exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.tenant_id = p_tenant_id
    ) then
      raise exception 'Course filter is outside this tenant.' using errcode = '42501';
    end if;

    if actor_role = 'trainer' and not exists (
      select 1 from public.trainer_course_assignments tca
      where tca.tenant_id = p_tenant_id
        and tca.course_id = course_id
        and tca.trainer_user_id = auth.uid()
    ) then
      raise exception 'Trainer cannot filter reports by an unassigned course.' using errcode = '42501';
    end if;
  end if;

  if p_filters ? 'cohort_id' and nullif(p_filters->>'cohort_id', '') is not null then
    if not ((p_filters->>'cohort_id') ~ uuid_pattern) then
      raise exception 'Invalid cohort_id filter.' using errcode = '22023';
    end if;

    cohort_id := (p_filters->>'cohort_id')::uuid;

    if not exists (
      select 1 from public.cohorts c
      where c.id = cohort_id
        and c.tenant_id = p_tenant_id
    ) then
      raise exception 'Cohort filter is outside this tenant.' using errcode = '42501';
    end if;

    if actor_role = 'trainer' and not exists (
      select 1 from public.trainer_cohort_assignments tca
      where tca.tenant_id = p_tenant_id
        and tca.cohort_id = cohort_id
        and tca.trainer_user_id = auth.uid()
    ) then
      raise exception 'Trainer cannot filter reports by an unassigned cohort.' using errcode = '42501';
    end if;
  end if;

  if p_filters ? 'trainer_user_id' and nullif(p_filters->>'trainer_user_id', '') is not null then
    if not ((p_filters->>'trainer_user_id') ~ uuid_pattern) then
      raise exception 'Invalid trainer_user_id filter.' using errcode = '22023';
    end if;

    trainer_user_id := (p_filters->>'trainer_user_id')::uuid;

    if not exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = p_tenant_id
        and tm.user_id = trainer_user_id
        and tm.role = 'trainer'
    ) then
      raise exception 'Trainer filter is outside this tenant.' using errcode = '42501';
    end if;

    if actor_role = 'trainer' and trainer_user_id <> auth.uid() then
      raise exception 'Trainer cannot filter reports by another trainer.' using errcode = '42501';
    end if;
  end if;

  status_value := nullif(left(coalesce(p_filters->>'status', ''), 80), '');

  normalized := jsonb_build_object(
    'date_range', date_range,
    'range_start', public.reports_start_date(date_range),
    'course_id', course_id,
    'cohort_id', cohort_id,
    'trainer_user_id', trainer_user_id,
    'status', status_value,
    'role', actor_role
  );

  return normalized;
end;
$$;

create or replace function public.reports_can_access_course(
  p_tenant_id uuid,
  p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_course_id is null then false
    when public.reports_current_role(p_tenant_id) in ('owner', 'admin', 'staff') then
      exists (
        select 1 from public.courses c
        where c.id = p_course_id and c.tenant_id = p_tenant_id
      )
    when public.reports_current_role(p_tenant_id) = 'trainer' then
      exists (
        select 1 from public.trainer_course_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.course_id = p_course_id
          and tca.trainer_user_id = auth.uid()
      )
    else false
  end
$$;

create or replace function public.reports_can_access_cohort(
  p_tenant_id uuid,
  p_cohort_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_cohort_id is null then false
    when public.reports_current_role(p_tenant_id) in ('owner', 'admin', 'staff') then
      exists (
        select 1 from public.cohorts c
        where c.id = p_cohort_id and c.tenant_id = p_tenant_id
      )
    when public.reports_current_role(p_tenant_id) = 'trainer' then
      exists (
        select 1 from public.trainer_cohort_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.cohort_id = p_cohort_id
          and tca.trainer_user_id = auth.uid()
      )
    else false
  end
$$;

create or replace function public.reports_write_audit(
  p_tenant_id uuid,
  p_action text,
  p_report_key text,
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
    'report',
    null,
    'Reports Center',
    'Reports center event recorded.',
    'info',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('report_key', p_report_key)
  );
end;
$$;

create or replace function public.get_reports_filter_options(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role text;
  course_options jsonb := '[]'::jsonb;
  cohort_options jsonb := '[]'::jsonb;
  trainer_options jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  actor_role := public.reports_current_role(p_tenant_id);
  if actor_role is null then
    raise exception 'Reports access denied.' using errcode = '42501';
  end if;

  if actor_role = 'trainer' then
    select coalesce(
      jsonb_agg(jsonb_build_object('id', c.id, 'label', c.title) order by c.title),
      '[]'::jsonb
    )
    into course_options
    from public.courses c
    where c.tenant_id = p_tenant_id
      and exists (
        select 1 from public.trainer_course_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.course_id = c.id
          and tca.trainer_user_id = auth.uid()
      );

    select coalesce(
      jsonb_agg(jsonb_build_object('id', c.id, 'label', c.name) order by c.name),
      '[]'::jsonb
    )
    into cohort_options
    from public.cohorts c
    where c.tenant_id = p_tenant_id
      and exists (
        select 1 from public.trainer_cohort_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.cohort_id = c.id
          and tca.trainer_user_id = auth.uid()
      );

    trainer_options := jsonb_build_array(
      jsonb_build_object('id', auth.uid(), 'label', 'My trainer scope')
    );
  else
    select coalesce(
      jsonb_agg(jsonb_build_object('id', c.id, 'label', c.title) order by c.title),
      '[]'::jsonb
    )
    into course_options
    from public.courses c
    where c.tenant_id = p_tenant_id;

    select coalesce(
      jsonb_agg(jsonb_build_object('id', c.id, 'label', c.name) order by c.name),
      '[]'::jsonb
    )
    into cohort_options
    from public.cohorts c
    where c.tenant_id = p_tenant_id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tm.user_id,
          'label', coalesce(p.full_name, p.email, tm.user_id::text)
        )
        order by coalesce(p.full_name, p.email, tm.user_id::text)
      ),
      '[]'::jsonb
    )
    into trainer_options
    from public.tenant_members tm
    left join public.profiles p on p.id = tm.user_id
    where tm.tenant_id = p_tenant_id
      and tm.role = 'trainer';
  end if;

  return jsonb_build_object(
    'role', actor_role,
    'scope_label', case
      when actor_role = 'trainer' then 'Trainer scoped'
      when actor_role = 'staff' then 'Operational workspace scope'
      else 'Full workspace scope'
    end,
    'can_export', actor_role in ('owner', 'admin', 'staff'),
    'can_view_financials', actor_role in ('owner', 'admin'),
    'courses', course_options,
    'cohorts', cohort_options,
    'trainers', trainer_options,
    'statuses', jsonb_build_array(
      jsonb_build_object('id', 'active', 'label', 'Active'),
      jsonb_build_object('id', 'published', 'label', 'Published'),
      jsonb_build_object('id', 'scheduled', 'label', 'Scheduled'),
      jsonb_build_object('id', 'completed', 'label', 'Completed'),
      jsonb_build_object('id', 'pending', 'label', 'Pending')
    )
  );
end;
$$;

create or replace function public.get_reports_center_data(
  p_tenant_id uuid,
  p_report_key text default 'overview',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized jsonb;
  actor_role text;
  report_key text := lower(coalesce(nullif(p_report_key, ''), 'overview'));
  range_start timestamptz;
  course_filter uuid;
  cohort_filter uuid;
  trainer_filter uuid;
  status_filter text;
  can_view_financials boolean;
  rows_json jsonb := '[]'::jsonb;
  metrics_json jsonb := '[]'::jsonb;
  title_text text;
  description_text text;
  headers_json jsonb;
  student_count integer := 0;
  active_student_count integer := 0;
  course_count integer := 0;
  active_course_count integer := 0;
  session_count integer := 0;
  attendance_count integer := 0;
  assignment_count integer := 0;
  submission_count integer := 0;
  notification_count integer := 0;
  thread_count integer := 0;
  finance_invoiced numeric := 0;
  finance_collected numeric := 0;
  finance_outstanding numeric := 0;
  trainer_count integer := 0;
begin
  if report_key not in (
    'overview', 'students', 'attendance', 'assignments',
    'courses', 'payments', 'trainers', 'communication'
  ) then
    raise exception 'Invalid report_key.' using errcode = '22023';
  end if;

  normalized := public.reports_validate_filters(p_tenant_id, p_filters);
  actor_role := normalized->>'role';
  range_start := nullif(normalized->>'range_start', '')::timestamptz;
  course_filter := nullif(normalized->>'course_id', '')::uuid;
  cohort_filter := nullif(normalized->>'cohort_id', '')::uuid;
  trainer_filter := nullif(normalized->>'trainer_user_id', '')::uuid;
  status_filter := nullif(normalized->>'status', '');
  can_view_financials := actor_role in ('owner', 'admin');

  drop table if exists pg_temp.reports_scope_students;
  drop table if exists pg_temp.reports_scope_courses;
  drop table if exists pg_temp.reports_scope_cohorts;

  create temporary table reports_scope_students(student_id uuid primary key) on commit drop;
  create temporary table reports_scope_courses(course_id uuid primary key) on commit drop;
  create temporary table reports_scope_cohorts(cohort_id uuid primary key) on commit drop;

  if actor_role = 'trainer' then
    insert into reports_scope_courses(course_id)
    select distinct tca.course_id
    from public.trainer_course_assignments tca
    where tca.tenant_id = p_tenant_id
      and tca.trainer_user_id = auth.uid();

    insert into reports_scope_cohorts(cohort_id)
    select distinct tca.cohort_id
    from public.trainer_cohort_assignments tca
    where tca.tenant_id = p_tenant_id
      and tca.trainer_user_id = auth.uid();

    insert into reports_scope_students(student_id)
    select distinct e.student_id
    from public.enrollments e
    where e.tenant_id = p_tenant_id
      and e.course_id in (select course_id from reports_scope_courses)
    on conflict do nothing;

    insert into reports_scope_students(student_id)
    select distinct cm.student_id
    from public.cohort_members cm
    where cm.tenant_id = p_tenant_id
      and cm.cohort_id in (select cohort_id from reports_scope_cohorts)
    on conflict do nothing;
  else
    insert into reports_scope_courses(course_id)
    select c.id from public.courses c where c.tenant_id = p_tenant_id;

    insert into reports_scope_cohorts(cohort_id)
    select c.id from public.cohorts c where c.tenant_id = p_tenant_id;

    insert into reports_scope_students(student_id)
    select s.id from public.students s where s.tenant_id = p_tenant_id;
  end if;

  delete from reports_scope_courses
  where course_filter is not null and course_id <> course_filter;

  delete from reports_scope_cohorts
  where cohort_filter is not null and cohort_id <> cohort_filter;

  delete from reports_scope_students rss
  where course_filter is not null
    and not exists (
      select 1
      from public.enrollments e
      where e.tenant_id = p_tenant_id
        and e.student_id = rss.student_id
        and e.course_id = course_filter
    );

  delete from reports_scope_students rss
  where cohort_filter is not null
    and not exists (
      select 1
      from public.cohort_members cm
      where cm.tenant_id = p_tenant_id
        and cm.student_id = rss.student_id
        and cm.cohort_id = cohort_filter
    );

  delete from reports_scope_students rss
  where trainer_filter is not null
    and not (
      exists (
        select 1
        from public.enrollments e
        join public.trainer_course_assignments tca
          on tca.tenant_id = e.tenant_id
         and tca.course_id = e.course_id
         and tca.trainer_user_id = trainer_filter
        where e.tenant_id = p_tenant_id
          and e.student_id = rss.student_id
      )
      or exists (
        select 1
        from public.cohort_members cm
        join public.trainer_cohort_assignments tcoa
          on tcoa.tenant_id = cm.tenant_id
         and tcoa.cohort_id = cm.cohort_id
         and tcoa.trainer_user_id = trainer_filter
        where cm.tenant_id = p_tenant_id
          and cm.student_id = rss.student_id
      )
    );

  select count(*)::integer into student_count
  from public.students s
  where s.tenant_id = p_tenant_id
    and s.id in (select student_id from reports_scope_students)
    and (range_start is null or s.created_at >= range_start)
    and (status_filter is null or s.status = status_filter);

  select count(*)::integer into active_student_count
  from public.students s
  where s.tenant_id = p_tenant_id
    and s.id in (select student_id from reports_scope_students)
    and s.status = 'active';

  select count(*)::integer into course_count
  from public.courses c
  where c.tenant_id = p_tenant_id
    and c.id in (select course_id from reports_scope_courses)
    and (status_filter is null or c.status = status_filter);

  select count(*)::integer into active_course_count
  from public.courses c
  where c.tenant_id = p_tenant_id
    and c.id in (select course_id from reports_scope_courses)
    and c.status in ('published', 'active');

  select count(*)::integer into session_count
  from public.sessions s
  where s.tenant_id = p_tenant_id
    and (range_start is null or s.scheduled_start_at >= range_start)
    and (course_filter is null or s.course_id = course_filter)
    and (cohort_filter is null or s.cohort_id = cohort_filter)
    and (trainer_filter is null or s.trainer_user_id = trainer_filter)
    and (status_filter is null or s.status = status_filter)
    and (
      actor_role <> 'trainer'
      or s.trainer_user_id = auth.uid()
      or s.course_id in (select course_id from reports_scope_courses)
      or s.cohort_id in (select cohort_id from reports_scope_cohorts)
    );

  select count(*)::integer into attendance_count
  from public.attendance_records ar
  join public.sessions s on s.id = ar.session_id and s.tenant_id = ar.tenant_id
  where ar.tenant_id = p_tenant_id
    and ar.student_id in (select student_id from reports_scope_students)
    and (range_start is null or coalesce(ar.marked_at, s.scheduled_start_at) >= range_start)
    and (course_filter is null or s.course_id = course_filter)
    and (cohort_filter is null or s.cohort_id = cohort_filter)
    and (trainer_filter is null or s.trainer_user_id = trainer_filter)
    and (status_filter is null or ar.status = status_filter);

  select count(*)::integer into assignment_count
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and (range_start is null or a.created_at >= range_start)
    and (course_filter is null or a.course_id = course_filter)
    and (cohort_filter is null or a.cohort_id = cohort_filter)
    and (trainer_filter is null or a.trainer_user_id = trainer_filter)
    and (status_filter is null or a.status = status_filter)
    and (
      actor_role <> 'trainer'
      or a.trainer_user_id = auth.uid()
      or a.course_id in (select course_id from reports_scope_courses)
      or a.cohort_id in (select cohort_id from reports_scope_cohorts)
    );

  select count(*)::integer into submission_count
  from public.assignment_submissions sub
  join public.assignments a on a.id = sub.assignment_id and a.tenant_id = p_tenant_id
  where sub.student_id in (select student_id from reports_scope_students)
    and (range_start is null or sub.created_at >= range_start)
    and (course_filter is null or a.course_id = course_filter)
    and (cohort_filter is null or a.cohort_id = cohort_filter)
    and (status_filter is null or sub.status = status_filter);

  if can_view_financials then
    select
      coalesce(sum(fi.total_amount), 0),
      coalesce(sum(fi.paid_amount), 0),
      coalesce(sum(fi.balance_amount), 0)
    into finance_invoiced, finance_collected, finance_outstanding
    from public.finance_invoices fi
    where fi.tenant_id = p_tenant_id
      and fi.student_id in (select student_id from reports_scope_students)
      and (range_start is null or fi.created_at >= range_start)
      and (course_filter is null or fi.course_id = course_filter)
      and (status_filter is null or fi.status = status_filter);
  end if;

  select count(*)::integer into trainer_count
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.role = 'trainer'
    and (trainer_filter is null or tm.user_id = trainer_filter);

  select count(*)::integer into notification_count
  from public.notifications n
  where n.tenant_id = p_tenant_id
    and (range_start is null or n.created_at >= range_start)
    and (status_filter is null or n.status = status_filter);

  select count(*)::integer into thread_count
  from public.conversation_threads ct
  where ct.tenant_id = p_tenant_id
    and (range_start is null or ct.created_at >= range_start)
    and ct.status <> 'archived'
    and (
      actor_role <> 'trainer'
      or ct.course_id in (select course_id from reports_scope_courses)
      or ct.cohort_id in (select cohort_id from reports_scope_cohorts)
      or ct.student_id in (select student_id from reports_scope_students)
    );

  if report_key = 'overview' then
    title_text := 'Executive overview';
    description_text := 'Cross-functional health snapshot for the selected report filters.';
    headers_json := jsonb_build_array('Area', 'Signal', 'Value');
    metrics_json := jsonb_build_array(
      jsonb_build_object('label', 'Students', 'value', student_count::text, 'helper', 'Visible students in scope', 'tone', 'blue'),
      jsonb_build_object('label', 'Active', 'value', active_student_count::text, 'helper', 'Students marked active', 'tone', 'emerald'),
      jsonb_build_object('label', 'Courses', 'value', course_count::text, 'helper', 'Visible courses in scope', 'tone', 'cyan'),
      jsonb_build_object('label', 'Sessions', 'value', session_count::text, 'helper', 'Sessions in selected range', 'tone', 'orange'),
      jsonb_build_object('label', 'Revenue', 'value', case when can_view_financials then finance_collected::text else 'Restricted' end, 'helper', 'Collected from finance invoices', 'tone', case when can_view_financials then 'emerald' else 'slate' end)
    );
    rows_json := jsonb_build_array(
      jsonb_build_object('id', 'students', 'cells', jsonb_build_array('Students', 'Active', active_student_count::text)),
      jsonb_build_object('id', 'courses', 'cells', jsonb_build_array('Courses', 'Active', active_course_count::text)),
      jsonb_build_object('id', 'sessions', 'cells', jsonb_build_array('Sessions', 'Visible', session_count::text)),
      jsonb_build_object('id', 'communication', 'cells', jsonb_build_array('Communication', 'Active threads', thread_count::text))
    );
  elsif report_key = 'students' then
    title_text := 'Student report';
    description_text := 'Student status, attendance risk, assignment backlog, and safe operational signals.';
    headers_json := jsonb_build_array('Student', 'Status', 'Attendance records', 'Pending assignments', 'Payment status');
    metrics_json := jsonb_build_array(
      jsonb_build_object('label', 'Total students', 'value', student_count::text, 'helper', 'Visible students in scope', 'tone', 'blue'),
      jsonb_build_object('label', 'Active', 'value', active_student_count::text, 'helper', 'Students marked active', 'tone', 'emerald'),
      jsonb_build_object('label', 'Attendance records', 'value', attendance_count::text, 'helper', 'Records in selected range', 'tone', 'cyan'),
      jsonb_build_object('label', 'Submissions', 'value', submission_count::text, 'helper', 'Assignment submissions in selected range', 'tone', 'orange')
    );
    select coalesce(jsonb_agg(row_json order by student_name), '[]'::jsonb)
    into rows_json
    from (
      select jsonb_build_object(
        'id', s.id,
        'cells', jsonb_build_array(
          s.full_name,
          initcap(replace(s.status, '_', ' ')),
          count(ar.id)::text,
          count(sub.id) filter (where sub.status in ('pending', 'submitted', 'late'))::text,
          case when can_view_financials then coalesce(sum(fi.balance_amount), 0)::text else 'Restricted' end
        )
      ) as row_json,
      s.full_name as student_name
      from public.students s
      left join public.attendance_records ar on ar.tenant_id = p_tenant_id and ar.student_id = s.id and (range_start is null or ar.marked_at >= range_start)
      left join public.assignment_submissions sub on sub.student_id = s.id and (range_start is null or sub.created_at >= range_start)
      left join public.finance_invoices fi on can_view_financials and fi.tenant_id = p_tenant_id and fi.student_id = s.id
      where s.tenant_id = p_tenant_id
        and s.id in (select student_id from reports_scope_students)
        and (status_filter is null or s.status = status_filter)
      group by s.id, s.full_name, s.status
      order by s.full_name
      limit 12
    ) rows;
  elsif report_key = 'attendance' then
    title_text := 'Attendance report';
    description_text := 'Presence, absence, late volume, and student-wise attendance signals.';
    headers_json := jsonb_build_array('Status', 'Records', 'Scope', 'Notes');
    metrics_json := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', initcap(replace(status, '_', ' ')),
        'value', total::text,
        'helper', 'Attendance records',
        'tone', case status when 'present' then 'emerald' when 'absent' then 'rose' when 'late' then 'orange' else 'slate' end
      ) order by status), '[]'::jsonb)
      from (
        select ar.status, count(*)::integer as total
        from public.attendance_records ar
        join public.sessions s on s.id = ar.session_id and s.tenant_id = ar.tenant_id
        where ar.tenant_id = p_tenant_id
          and ar.student_id in (select student_id from reports_scope_students)
          and (range_start is null or coalesce(ar.marked_at, s.scheduled_start_at) >= range_start)
          and (course_filter is null or s.course_id = course_filter)
          and (cohort_filter is null or s.cohort_id = cohort_filter)
          and (status_filter is null or ar.status = status_filter)
        group by ar.status
      ) grouped
    );
    rows_json := metrics_json;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', status,
      'cells', jsonb_build_array(initcap(replace(status, '_', ' ')), total::text, 'Selected range', 'Aggregated only')
    ) order by status), '[]'::jsonb)
    into rows_json
    from (
      select ar.status, count(*)::integer as total
      from public.attendance_records ar
      join public.sessions s on s.id = ar.session_id and s.tenant_id = ar.tenant_id
      where ar.tenant_id = p_tenant_id
        and ar.student_id in (select student_id from reports_scope_students)
        and (range_start is null or coalesce(ar.marked_at, s.scheduled_start_at) >= range_start)
        and (course_filter is null or s.course_id = course_filter)
        and (cohort_filter is null or s.cohort_id = cohort_filter)
        and (status_filter is null or ar.status = status_filter)
      group by ar.status
    ) grouped;
  elsif report_key = 'assignments' then
    title_text := 'Assignment report';
    description_text := 'Assignment throughput, review backlog, and score averages.';
    headers_json := jsonb_build_array('Assignment', 'Status', 'Due', 'Submissions', 'Reviewed');
    metrics_json := jsonb_build_array(
      jsonb_build_object('label', 'Assignments', 'value', assignment_count::text, 'helper', 'Assignments in selected scope', 'tone', 'blue'),
      jsonb_build_object('label', 'Submissions', 'value', submission_count::text, 'helper', 'Submissions in selected range', 'tone', 'cyan')
    );
    select coalesce(jsonb_agg(row_json order by sort_value desc), '[]'::jsonb)
    into rows_json
    from (
      select jsonb_build_object(
        'id', a.id,
        'cells', jsonb_build_array(
          a.title,
          initcap(replace(a.status, '_', ' ')),
          coalesce(to_char(a.due_at, 'YYYY-MM-DD'), 'Not set'),
          count(sub.id)::text,
          count(sub.id) filter (where sub.status = 'reviewed')::text
        )
      ) as row_json,
      a.created_at as sort_value
      from public.assignments a
      left join public.assignment_submissions sub on sub.assignment_id = a.id
      where a.tenant_id = p_tenant_id
        and (range_start is null or a.created_at >= range_start)
        and (course_filter is null or a.course_id = course_filter)
        and (cohort_filter is null or a.cohort_id = cohort_filter)
        and (trainer_filter is null or a.trainer_user_id = trainer_filter)
        and (status_filter is null or a.status = status_filter)
        and (
          actor_role <> 'trainer'
          or a.trainer_user_id = auth.uid()
          or a.course_id in (select course_id from reports_scope_courses)
          or a.cohort_id in (select cohort_id from reports_scope_cohorts)
        )
      group by a.id, a.title, a.status, a.due_at, a.created_at
      order by a.created_at desc
      limit 12
    ) rows;
  elsif report_key = 'courses' then
    title_text := 'Course and cohort report';
    description_text := 'Course, cohort, enrollment, and session operations.';
    headers_json := jsonb_build_array('Course', 'Status', 'Enrollments', 'Sessions', 'Cohorts');
    metrics_json := jsonb_build_array(
      jsonb_build_object('label', 'Courses', 'value', course_count::text, 'helper', 'Visible courses', 'tone', 'blue'),
      jsonb_build_object('label', 'Active courses', 'value', active_course_count::text, 'helper', 'Published or active courses', 'tone', 'emerald'),
      jsonb_build_object('label', 'Sessions', 'value', session_count::text, 'helper', 'Visible sessions', 'tone', 'cyan')
    );
    select coalesce(jsonb_agg(row_json order by sort_label), '[]'::jsonb)
    into rows_json
    from (
      select jsonb_build_object(
        'id', c.id,
        'cells', jsonb_build_array(
          c.title,
          initcap(replace(c.status, '_', ' ')),
          count(distinct e.id)::text,
          count(distinct s.id)::text,
          count(distinct ch.id)::text
        )
      ) as row_json,
      c.title as sort_label
      from public.courses c
      left join public.enrollments e on e.tenant_id = p_tenant_id and e.course_id = c.id
      left join public.sessions s on s.tenant_id = p_tenant_id and s.course_id = c.id
      left join public.cohorts ch on ch.tenant_id = p_tenant_id and ch.course_id = c.id
      where c.tenant_id = p_tenant_id
        and c.id in (select course_id from reports_scope_courses)
        and (status_filter is null or c.status = status_filter)
      group by c.id, c.title, c.status
      order by c.title
      limit 12
    ) rows;
  elsif report_key = 'payments' then
    title_text := 'Payment report';
    description_text := case when can_view_financials then 'Finance Center invoice and payment summary.' else 'Payment analytics are hidden for this role.' end;
    headers_json := jsonb_build_array('Scope', 'Status', 'Amount', 'Currency', 'Notes');
    if can_view_financials then
      metrics_json := jsonb_build_array(
        jsonb_build_object('label', 'Total invoiced', 'value', finance_invoiced::text, 'helper', 'finance_invoices.total_amount', 'tone', 'blue'),
        jsonb_build_object('label', 'Collected', 'value', finance_collected::text, 'helper', 'finance_invoices.paid_amount', 'tone', 'emerald'),
        jsonb_build_object('label', 'Outstanding', 'value', finance_outstanding::text, 'helper', 'finance_invoices.balance_amount', 'tone', 'orange')
      );
      select coalesce(jsonb_agg(row_json order by sort_value desc), '[]'::jsonb)
      into rows_json
      from (
        select jsonb_build_object(
          'id', fi.id,
          'cells', jsonb_build_array(
            fi.invoice_number,
            initcap(replace(fi.status, '_', ' ')),
            fi.total_amount::text,
            fi.currency,
            'Finance invoice'
          )
        ) as row_json,
        fi.created_at as sort_value
        from public.finance_invoices fi
        where fi.tenant_id = p_tenant_id
          and fi.student_id in (select student_id from reports_scope_students)
          and (range_start is null or fi.created_at >= range_start)
          and (course_filter is null or fi.course_id = course_filter)
          and (status_filter is null or fi.status = status_filter)
        order by fi.created_at desc
        limit 12
      ) rows;
    else
      metrics_json := jsonb_build_array(
        jsonb_build_object('label', 'Financial access', 'value', 'Restricted', 'helper', 'Finance reports are owner/admin only', 'tone', 'slate')
      );
      rows_json := jsonb_build_array(
        jsonb_build_object('id', 'restricted', 'cells', jsonb_build_array('Payments', 'Restricted', 'N/A', 'N/A', 'Owner/admin only'))
      );
    end if;
  elsif report_key = 'trainers' then
    title_text := 'Trainer report';
    description_text := 'Trainer workload across assignments, cohorts, and sessions. HR notes are excluded.';
    headers_json := jsonb_build_array('Trainer', 'Courses', 'Cohorts', 'Sessions', 'Student load');
    metrics_json := jsonb_build_array(
      jsonb_build_object('label', 'Trainers', 'value', trainer_count::text, 'helper', 'Trainer users in workspace', 'tone', 'blue'),
      jsonb_build_object('label', 'Sessions', 'value', session_count::text, 'helper', 'Visible trainer sessions', 'tone', 'cyan')
    );
    select coalesce(jsonb_agg(row_json order by sort_label), '[]'::jsonb)
    into rows_json
    from (
      select jsonb_build_object(
        'id', tm.user_id,
        'cells', jsonb_build_array(
          coalesce(p.full_name, p.email, tm.user_id::text),
          count(distinct tca.course_id)::text,
          count(distinct tcoa.cohort_id)::text,
          count(distinct s.id)::text,
          (count(distinct e.student_id) + count(distinct cm.student_id))::text
        )
      ) as row_json,
      coalesce(p.full_name, p.email, tm.user_id::text) as sort_label
      from public.tenant_members tm
      left join public.profiles p on p.id = tm.user_id
      left join public.trainer_course_assignments tca on tca.tenant_id = p_tenant_id and tca.trainer_user_id = tm.user_id
      left join public.trainer_cohort_assignments tcoa on tcoa.tenant_id = p_tenant_id and tcoa.trainer_user_id = tm.user_id
      left join public.sessions s on s.tenant_id = p_tenant_id and s.trainer_user_id = tm.user_id and (range_start is null or s.scheduled_start_at >= range_start)
      left join public.enrollments e on e.tenant_id = p_tenant_id and e.course_id = tca.course_id
      left join public.cohort_members cm on cm.tenant_id = p_tenant_id and cm.cohort_id = tcoa.cohort_id
      where tm.tenant_id = p_tenant_id
        and tm.role = 'trainer'
        and (trainer_filter is null or tm.user_id = trainer_filter)
        and (actor_role <> 'trainer' or tm.user_id = auth.uid())
      group by tm.user_id, p.full_name, p.email
      order by coalesce(p.full_name, p.email, tm.user_id::text)
      limit 12
    ) rows;
  else
    title_text := 'Communication report';
    description_text := 'Notifications, communication logs, and chat activity aggregates. Message bodies are excluded.';
    headers_json := jsonb_build_array('Area', 'Count', 'Scope', 'Notes');
    metrics_json := jsonb_build_array(
      jsonb_build_object('label', 'Notifications', 'value', notification_count::text, 'helper', 'Notifications in selected range', 'tone', 'cyan'),
      jsonb_build_object('label', 'Threads', 'value', thread_count::text, 'helper', 'Visible conversation threads', 'tone', 'emerald')
    );
    rows_json := jsonb_build_array(
      jsonb_build_object('id', 'notifications', 'cells', jsonb_build_array('Notifications', notification_count::text, 'Selected range', 'No message body returned')),
      jsonb_build_object('id', 'threads', 'cells', jsonb_build_array('Conversation threads', thread_count::text, 'Visible scope', 'No message body returned'))
    );
  end if;

  return jsonb_build_object(
    'key', report_key,
    'title', title_text,
    'description', description_text,
    'headers', headers_json,
    'metrics', coalesce(metrics_json, '[]'::jsonb),
    'rows', coalesce(rows_json, '[]'::jsonb)
  );
end;
$$;

create or replace function public.record_report_export_event(
  p_tenant_id uuid,
  p_report_key text,
  p_filters jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized jsonb;
  report_key text := lower(coalesce(nullif(p_report_key, ''), 'overview'));
  actor_role text;
  row_count integer := 0;
begin
  if report_key not in (
    'overview', 'students', 'attendance', 'assignments',
    'courses', 'payments', 'trainers', 'communication'
  ) then
    raise exception 'Invalid report_key.' using errcode = '22023';
  end if;

  normalized := public.reports_validate_filters(p_tenant_id, p_filters);
  actor_role := normalized->>'role';

  if actor_role not in ('owner', 'admin', 'staff') then
    raise exception 'Report export is not allowed for this role.' using errcode = '42501';
  end if;

  if p_filters is null then
    p_filters := '{}'::jsonb;
  end if;

  if p_filters ? 'row_count' and (p_filters->>'row_count') ~ '^[0-9]+$' then
    row_count := least((p_filters->>'row_count')::integer, 100000);
  end if;

  perform public.reports_write_audit(
    p_tenant_id,
    'report_exported',
    report_key,
    jsonb_build_object(
      'date_range', normalized->>'date_range',
      'course_filter_present', (normalized->>'course_id') is not null,
      'cohort_filter_present', (normalized->>'cohort_id') is not null,
      'status_filter_present', (normalized->>'status') is not null,
      'trainer_filter_present', (normalized->>'trainer_user_id') is not null,
      'row_count', row_count
    )
  );
end;
$$;

revoke all on function public.reports_current_role(uuid) from public, authenticated;
revoke all on function public.reports_is_owner_admin(uuid) from public, authenticated;
revoke all on function public.reports_start_date(text) from public, authenticated;
revoke all on function public.reports_validate_filters(uuid, jsonb) from public, authenticated;
revoke all on function public.reports_can_access_course(uuid, uuid) from public, authenticated;
revoke all on function public.reports_can_access_cohort(uuid, uuid) from public, authenticated;
revoke all on function public.reports_write_audit(uuid, text, text, jsonb) from public, authenticated;

revoke all on function public.get_reports_filter_options(uuid) from public;
revoke all on function public.get_reports_center_data(uuid, text, jsonb) from public;
revoke all on function public.record_report_export_event(uuid, text, jsonb) from public;

grant execute on function public.get_reports_filter_options(uuid) to authenticated;
grant execute on function public.get_reports_center_data(uuid, text, jsonb) to authenticated;
grant execute on function public.record_report_export_event(uuid, text, jsonb) to authenticated;
