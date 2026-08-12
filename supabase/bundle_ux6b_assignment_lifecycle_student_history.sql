/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query before applying the executable migration. It returns aggregate
metadata and counts only. It does not return assignment, submission, student,
attachment, or feedback content.

with
expected_functions(identity) as (
  values
    ('public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    ('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    ('public.update_assignment_status_secure(uuid,uuid,text)'),
    ('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'),
    ('public.review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)'),
    ('public.review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)'),
    ('public.m69_4_assert_manage_assignment(uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_trainer_can_manage_scope(uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_delegated_permission_id(uuid,uuid,text[],uuid,uuid,uuid,uuid)'),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)')
),
function_state as (
  select
    ef.identity,
    p.oid is not null as installed,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    l.lanname as language,
    p.provolatile as volatility,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    coalesce(pg_get_functiondef(p.oid), '') as definition,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        order by case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
          acl.privilege_type
      )
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    ), '[]'::jsonb) as acl
  from expected_functions ef
  left join pg_proc p on p.oid = to_regprocedure(ef.identity)
  left join pg_language l on l.oid = p.prolang
),
table_state as (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    pg_get_userbyid(c.relowner) as owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('assignments', 'assignment_submissions')
),
status_constraint as (
  select
    con.conname,
    pg_get_constraintdef(con.oid, true) as definition
  from pg_constraint con
  where con.conrelid = 'public.assignments'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid, true) ilike '%status%'
),
policy_state as (
  select
    schemaname,
    tablename,
    policyname,
    cmd,
    roles,
    coalesce(qual, '') as using_expression,
    coalesce(with_check, '') as check_expression
  from pg_policies
  where schemaname = 'public'
    and tablename in ('assignments', 'assignment_submissions')
),
assignment_status_basis(status) as (
  values ('draft'), ('published'), ('closed')
),
assignment_status_counts as (
  select b.status, count(a.id)::bigint as row_count
  from assignment_status_basis b
  left join public.assignments a on a.status = b.status
  group by b.status
),
submission_counts_by_assignment_status as (
  select b.status, count(s.id)::bigint as row_count
  from assignment_status_basis b
  left join public.assignments a on a.status = b.status
  left join public.assignment_submissions s on s.assignment_id = a.id
  group by b.status
),
reviewed_counts_by_assignment_status as (
  select b.status, count(s.id) filter (where s.reviewed_at is not null)::bigint as row_count
  from assignment_status_basis b
  left join public.assignments a on a.status = b.status
  left join public.assignment_submissions s on s.assignment_id = a.id
  group by b.status
),
compatibility_counts as (
  select jsonb_build_object(
    'closed_assignments_with_submissions', count(distinct a.id) filter (
      where a.status = 'closed' and s.id is not null
    ),
    'closed_assignments_with_reviewed_submissions', count(distinct a.id) filter (
      where a.status = 'closed' and s.reviewed_at is not null
    ),
    'published_assignments_with_submissions', count(distinct a.id) filter (
      where a.status = 'published' and s.id is not null
    ),
    'draft_assignments_with_submissions', count(distinct a.id) filter (
      where a.status = 'draft' and s.id is not null
    )
  ) as value
  from public.assignments a
  left join public.assignment_submissions s on s.assignment_id = a.id
),
direct_grants as (
  select grantee, table_name, privilege_type, is_grantable
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('assignments', 'assignment_submissions')
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
browser_write_grants as (
  select count(*)::bigint as row_count
  from direct_grants
  where grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
),
relevant_indexes as (
  select tablename, indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename in ('assignments', 'assignment_submissions')
),
policy_cycle_signals as (
  select jsonb_build_object(
    'assignments_policy_references_submissions', count(*) filter (
      where tablename = 'assignments'
        and lower(using_expression) like '%assignment_submissions%'
    ),
    'submissions_policy_references_assignments', count(*) filter (
      where tablename = 'assignment_submissions'
        and lower(using_expression) like '%from assignments%'
    ),
    'reciprocal_assignment_submission_cycle',
      count(*) filter (
        where tablename = 'assignments'
          and lower(using_expression) like '%assignment_submissions%'
      ) > 0
      and count(*) filter (
        where tablename = 'assignment_submissions'
          and lower(using_expression) like '%from assignments%'
      ) > 0
  ) as value
  from policy_state
),
source_signals as (
  select jsonb_object_agg(
    fs.identity,
    jsonb_build_object(
      'checks_current_assignment_status', lower(fs.definition) like '%v_existing.status%',
      'row_lock', lower(fs.definition) like '%for update%',
      'allows_target_published', lower(fs.definition) like '%published%',
      'allows_target_closed', lower(fs.definition) like '%closed%',
      'checks_any_submission', lower(fs.definition) like '%assignment_submissions%',
      'requires_published_submission', lower(fs.definition) like '%status <> ''published''%',
      'review_lifecycle_guard', lower(fs.definition) like '%status not in (''published'', ''closed'')%'
    )
  ) as value
  from function_state fs
),
historical_transition_evidence as (
  select jsonb_build_object(
    'draft_to_closed', 'not reliably derivable from current audit metadata',
    'closed_to_published', 'not reliably derivable from current audit metadata',
    'reason', 'audit events record resulting status but do not provide an authoritative source-status transition pair'
  ) as value
)
select jsonb_build_object(
  'functions', (select jsonb_agg(to_jsonb(fs) - 'definition' order by fs.identity) from function_state fs),
  'function_source_signals', (select value from source_signals),
  'assignment_status_constraint', (select coalesce(jsonb_agg(to_jsonb(sc)), '[]'::jsonb) from status_constraint sc),
  'table_security', (select jsonb_agg(to_jsonb(ts) order by ts.table_name) from table_state ts),
  'student_policies', (
    select coalesce(jsonb_agg(to_jsonb(ps) order by ps.tablename, ps.policyname), '[]'::jsonb)
    from policy_state ps
    where lower(ps.policyname) like '%student%'
       or lower(ps.using_expression) like '%student_portal%'
  ),
  'trainer_and_delegation_policy_signals', (
    select coalesce(jsonb_agg(to_jsonb(ps) order by ps.tablename, ps.policyname), '[]'::jsonb)
    from policy_state ps
    where lower(ps.policyname) like '%trainer%'
       or lower(ps.using_expression) like '%trainer_%assignment%'
       or lower(ps.using_expression) like '%delegated%'
  ),
  'assignment_status_counts', (
    select jsonb_object_agg(status, row_count order by status) from assignment_status_counts
  ),
  'submission_counts_by_assignment_status', (
    select jsonb_object_agg(status, row_count order by status) from submission_counts_by_assignment_status
  ),
  'reviewed_submission_counts_by_assignment_status', (
    select jsonb_object_agg(status, row_count order by status) from reviewed_counts_by_assignment_status
  ),
  'compatibility_counts', (select value from compatibility_counts),
  'historical_transition_evidence', (select value from historical_transition_evidence),
  'direct_grants', (select coalesce(jsonb_agg(to_jsonb(dg) order by dg.table_name, dg.grantee, dg.privilege_type), '[]'::jsonb) from direct_grants dg),
  'browser_write_grants', (select row_count from browser_write_grants),
  'relevant_indexes', (select coalesce(jsonb_agg(to_jsonb(ri) order by ri.tablename, ri.indexname), '[]'::jsonb) from relevant_indexes ri),
  'policy_cycle_signals', (select value from policy_cycle_signals)
) as preflight_result;
*/

begin;

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
  v_has_submission boolean;
begin
  select *
  into v_existing
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found in this workspace.' using errcode = '22023';
  end if;

  v_role := public.m69_4_assert_manage_assignment(
    p_tenant_id,
    v_existing.course_id,
    v_existing.cohort_id,
    p_assignment_id,
    v_existing.trainer_user_id
  );

  if v_existing.status = 'closed' then
    raise exception 'Closed assignments cannot be edited.' using errcode = '22023';
  end if;

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this assignment.' using errcode = '22023';
  end if;

  perform public.m69_4_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_4_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_4_assert_course_cohort_consistency(
    p_tenant_id, p_course_id, p_cohort_id
  );

  v_title := public.m69_4_normalize_text(
    p_title, 'Assignment title', true, 180
  );
  v_trainer_user_id := case
    when v_role = 'trainer' then auth.uid()
    else p_trainer_user_id
  end;

  if v_existing.status = 'draft' then
    perform public.m69_4_assert_manage_assignment(
      p_tenant_id,
      p_course_id,
      p_cohort_id,
      p_assignment_id,
      null
    );
  elsif v_existing.status = 'published' then
    if p_course_id is distinct from v_existing.course_id
       or p_cohort_id is distinct from v_existing.cohort_id
       or v_trainer_user_id is distinct from v_existing.trainer_user_id then
      raise exception 'Program, cohort, and trainer cannot be changed after publication.'
        using errcode = '22023';
    end if;

    select exists (
      select 1
      from public.assignment_submissions s
      where s.tenant_id = p_tenant_id
        and s.assignment_id = p_assignment_id
    )
    into v_has_submission;

    if v_has_submission
       and (
         p_due_at is distinct from v_existing.due_at
         or p_max_score is distinct from v_existing.max_score
       ) then
      raise exception 'Due date and max score cannot be changed after the first submission.'
        using errcode = '22023';
    end if;
  else
    raise exception 'Assignment lifecycle state is not supported.' using errcode = '22023';
  end if;

  update public.assignments a
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = v_trainer_user_id,
    title = v_title,
    description = public.m69_4_normalize_text(
      p_description, 'Description', false, 2000
    ),
    instructions = public.m69_4_normalize_text(
      p_instructions, 'Instructions', false, 4000
    ),
    attachment_urls_json = public.m69_4_validate_attachment_urls(
      p_attachment_urls_json
    ),
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
  v_status := public.m69_4_validate_assignment_status(p_status);

  select *
  into v_existing
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found in this workspace.' using errcode = '22023';
  end if;

  perform public.m69_4_assert_manage_assignment(
    p_tenant_id,
    v_existing.course_id,
    v_existing.cohort_id,
    p_assignment_id,
    v_existing.trainer_user_id
  );

  if (v_existing.status = 'published' and v_status = 'published')
     or (v_existing.status = 'closed' and v_status = 'closed') then
    return v_existing;
  end if;

  if not (
    (v_existing.status = 'draft' and v_status = 'published')
    or (v_existing.status = 'published' and v_status = 'closed')
  ) then
    raise exception 'Assignment status transition is not allowed.'
      using errcode = '22023';
  end if;

  update public.assignments a
  set status = v_status
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
    and a.status = v_existing.status
  returning * into v_assignment;

  if not found then
    raise exception 'Assignment status transition could not be completed.'
      using errcode = '22023';
  end if;

  perform public.m69_4_write_audit(
    p_tenant_id,
    case
      when v_assignment.status = 'closed' then 'assignment_closed'
      else 'assignment_published'
    end,
    'assignment',
    v_assignment.id,
    'Assignment',
    case
      when v_assignment.status = 'closed' then 'Closed assignment'
      else 'Published assignment'
    end,
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
  v_access_course_id uuid;
  v_assignment public.assignments%rowtype;
  v_role text;
  v_submission public.assignment_submissions%rowtype;
  v_status text;
  v_student_portal_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into v_assignment
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found in this workspace.' using errcode = '22023';
  end if;

  perform public.m69_4_assert_student_in_assignment_roster(
    p_tenant_id, v_assignment, p_student_id
  );

  v_access_course_id := v_assignment.course_id;

  if v_access_course_id is null and v_assignment.cohort_id is not null then
    select c.course_id
    into v_access_course_id
    from public.cohorts c
    where c.tenant_id = p_tenant_id
      and c.id = v_assignment.cohort_id;
  end if;

  v_role := public.m69_4_current_role(p_tenant_id);
  v_student_portal_allowed := public.student_portal_access_allowed(
    p_tenant_id,
    p_student_id,
    auth.uid(),
    v_access_course_id,
    'course_participate'
  );

  if v_assignment.status <> 'published' then
    raise exception 'Assignment is not open for submissions.' using errcode = '22023';
  end if;

  if v_role not in ('owner', 'admin') and not v_student_portal_allowed then
    raise exception 'You do not have permission to submit this assignment.'
      using errcode = '42501';
  end if;

  v_status := public.m69_4_submission_status_for_due_date(v_assignment.due_at);

  if v_role in ('owner', 'admin') then
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
      public.m69_4_normalize_text(
        p_submission_text, 'Submission text', false, 6000
      ),
      public.m69_4_validate_attachment_urls(p_attachment_urls_json),
      v_status,
      now()
    )
    on conflict (assignment_id, student_id) do nothing
    returning * into v_submission;

    if not found then
      raise exception 'An existing submission cannot be replaced by an administrator.'
        using errcode = '22023';
    end if;
  else
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
      public.m69_4_normalize_text(
        p_submission_text, 'Submission text', false, 6000
      ),
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
  end if;

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
  v_assignment := public.m69_4_assert_assignment_in_tenant(
    p_tenant_id, p_assignment_id
  );
  perform public.m69_4_assert_student_in_tenant(p_tenant_id, p_student_id);
  perform public.m69_4_assert_review_assignment(
    p_tenant_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    p_student_id,
    p_assignment_id,
    v_assignment.trainer_user_id
  );

  if v_assignment.status not in ('published', 'closed') then
    raise exception 'Assignment is not available for review.' using errcode = '22023';
  end if;

  v_score := public.m69_4_validate_score(p_score, v_assignment.max_score);

  update public.assignment_submissions s
  set
    feedback = public.m69_4_normalize_text(
      p_feedback, 'Feedback', false, 4000
    ),
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
  v_actor_id uuid := auth.uid();
  v_assignment public.assignments%rowtype;
  v_matched_permission_id uuid;
  v_matched_scope_id uuid;
  v_matched_scope_type text;
  v_score numeric;
  v_submission public.assignment_submissions%rowtype;
begin
  if v_actor_id is null
     or not public.is_tenant_member(p_tenant_id, v_actor_id) then
    raise exception 'You do not have permission to review submissions.'
      using errcode = '42501';
  end if;

  v_assignment := public.m69_4_assert_assignment_in_tenant(
    p_tenant_id, p_assignment_id
  );
  perform public.m69_4_assert_student_in_tenant(p_tenant_id, p_student_id);

  v_matched_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    v_actor_id,
    array['review_assignments'],
    v_assignment.course_id,
    v_assignment.cohort_id,
    p_student_id,
    null,
    v_assignment.id
  );

  if v_matched_permission_id is null then
    raise exception 'You do not have delegated permission to review this submission.'
      using errcode = '42501';
  end if;

  if v_assignment.status not in ('published', 'closed') then
    raise exception 'Assignment is not available for review.' using errcode = '22023';
  end if;

  v_score := public.m69_4_validate_score(p_score, v_assignment.max_score);

  select dp.scope_type, dp.scope_id
  into v_matched_scope_type, v_matched_scope_id
  from public.delegated_permissions dp
  where dp.id = v_matched_permission_id;

  update public.assignment_submissions s
  set
    feedback = public.m69_4_normalize_text(
      p_feedback, 'Feedback', false, 4000
    ),
    reviewed_at = now(),
    reviewed_by = v_actor_id,
    score = v_score,
    status = 'reviewed'
  where s.tenant_id = p_tenant_id
    and s.assignment_id = p_assignment_id
    and s.student_id = p_student_id
  returning * into v_submission;

  if not found then
    raise exception 'Submission not found for this student.' using errcode = '22023';
  end if;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    v_actor_id,
    v_matched_permission_id,
    'review_assignment_submission',
    'assignment_submission',
    v_submission.id,
    v_matched_scope_type,
    v_matched_scope_id
  );

  return v_submission;
end;
$$;

drop policy if exists "Linked students can read assigned assignments"
on public.assignments;
create policy "Linked students can read assigned assignments"
on public.assignments
for select
to authenticated
using (
  status in ('published', 'closed')
  and exists (
    select 1
    from public.student_portal_accounts spa
    left join public.cohort_members cm
      on cm.tenant_id = spa.tenant_id
     and cm.student_id = spa.student_id
     and cm.cohort_id = assignments.cohort_id
    left join public.cohorts coh
      on coh.tenant_id = assignments.tenant_id
     and coh.id = assignments.cohort_id
    where spa.tenant_id = assignments.tenant_id
      and spa.user_id = auth.uid()
      and (assignments.cohort_id is null or cm.id is not null)
      and public.student_portal_access_allowed(
        spa.tenant_id,
        spa.student_id,
        auth.uid(),
        coalesce(assignments.course_id, coh.course_id),
        'course_read'
      )
  )
);

drop policy if exists "Linked students can read own assignment submissions"
on public.assignment_submissions;
create policy "Linked students can read own assignment submissions"
on public.assignment_submissions
for select
to authenticated
using (
  exists (
    select 1
    from public.assignments a
    left join public.cohorts coh
      on coh.tenant_id = a.tenant_id
     and coh.id = a.cohort_id
    left join public.cohort_members cm
      on cm.tenant_id = a.tenant_id
     and cm.cohort_id = a.cohort_id
     and cm.student_id = assignment_submissions.student_id
    where a.tenant_id = assignment_submissions.tenant_id
      and a.id = assignment_submissions.assignment_id
      and a.status in ('published', 'closed')
      and (a.cohort_id is null or cm.id is not null)
      and public.student_portal_access_allowed(
        assignment_submissions.tenant_id,
        assignment_submissions.student_id,
        auth.uid(),
        coalesce(a.course_id, coh.course_id),
        'course_read'
      )
  )
);

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this query after applying the executable migration. It inspects installed
metadata and function/policy definitions without invoking mutating RPCs.

with
expected_functions(identity) as (
  values
    ('public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    ('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    ('public.update_assignment_status_secure(uuid,uuid,text)'),
    ('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'),
    ('public.review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)'),
    ('public.review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)'),
    ('public.m69_4_assert_manage_assignment(uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_trainer_can_manage_scope(uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_delegated_permission_id(uuid,uuid,text[],uuid,uuid,uuid,uuid)'),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)')
),
function_state as (
  select
    ef.identity,
    p.oid is not null as installed,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    l.lanname as language,
    p.provolatile as volatility,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    lower(regexp_replace(coalesce(pg_get_functiondef(p.oid), ''), '[[:space:]]+', ' ', 'g')) as definition,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        order by case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
          acl.privilege_type
      )
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    ), '[]'::jsonb) as acl
  from expected_functions ef
  left join pg_proc p on p.oid = to_regprocedure(ef.identity)
  left join pg_language l on l.oid = p.prolang
),
function_sources as (
  select
    max(definition) filter (where identity = 'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)') as update_source,
    max(definition) filter (where identity = 'public.update_assignment_status_secure(uuid,uuid,text)') as status_source,
    max(definition) filter (where identity = 'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)') as submit_source,
    max(definition) filter (where identity = 'public.review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)') as review_source,
    max(definition) filter (where identity = 'public.review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)') as delegated_review_source
  from function_state
),
lifecycle_signals as (
  select jsonb_build_object(
    'row_lock', status_source like '%for update%',
    'draft_to_published_allowed', status_source like '%v_existing.status = ''draft'' and v_status = ''published''%',
    'published_to_closed_allowed', status_source like '%v_existing.status = ''published'' and v_status = ''closed''%',
    'draft_to_closed_denied', status_source like '%assignment status transition is not allowed%',
    'published_to_draft_denied', status_source like '%assignment status transition is not allowed%',
    'closed_to_published_denied', status_source like '%assignment status transition is not allowed%',
    'closed_to_draft_denied', status_source like '%assignment status transition is not allowed%',
    'published_repeat_idempotent', status_source like '%v_existing.status = ''published'' and v_status = ''published''%',
    'closed_repeat_idempotent', status_source like '%v_existing.status = ''closed'' and v_status = ''closed''%',
    'idempotent_returns_before_audit', position('return v_existing' in status_source) < position('m69_4_write_audit' in status_source),
    'controlled_transition_error', status_source like '%using errcode = ''22023''%'
  ) as value
  from function_sources
),
edit_signals as (
  select jsonb_build_object(
    'row_lock', update_source like '%for update%',
    'draft_broad_edit', update_source like '%v_existing.status = ''draft''%',
    'published_content_edit', update_source like '%title = v_title%'
      and update_source like '%description = public.m69_4_normalize_text%'
      and update_source like '%instructions = public.m69_4_normalize_text%'
      and update_source like '%attachment_urls_json = public.m69_4_validate_attachment_urls%',
    'course_frozen', update_source like '%p_course_id is distinct from v_existing.course_id%',
    'cohort_frozen', update_source like '%p_cohort_id is distinct from v_existing.cohort_id%',
    'trainer_frozen', update_source like '%v_trainer_user_id is distinct from v_existing.trainer_user_id%',
    'any_submission_cutoff', update_source like '%from public.assignment_submissions%'
      and update_source like '%v_has_submission%',
    'due_date_cutoff', update_source like '%p_due_at is distinct from v_existing.due_at%',
    'max_score_cutoff', update_source like '%p_max_score is distinct from v_existing.max_score%',
    'closed_edit_denied', update_source like '%closed assignments cannot be edited.%',
    'controlled_edit_errors', update_source like '%using errcode = ''22023''%'
  ) as value
  from function_sources
),
submission_signals as (
  select jsonb_build_object(
    'assignment_row_lock', submit_source like '%for update%',
    'draft_submission_denied', submit_source like '%v_assignment.status <> ''published''%',
    'closed_submission_denied', submit_source like '%v_assignment.status <> ''published''%',
    'published_submission_required', submit_source like '%v_assignment.status <> ''published''%',
    'canonical_participation_required', submit_source like '%student_portal_access_allowed%'
      and submit_source like '%course_participate%',
    'late_calculated_server_side', submit_source like '%m69_4_submission_status_for_due_date%',
    'student_resubmission_upsert', submit_source like '%on conflict (assignment_id, student_id) do update%',
    'review_reset_atomic', submit_source like '%score = null%'
      and submit_source like '%feedback = null%'
      and submit_source like '%reviewed_at = null%'
      and submit_source like '%reviewed_by = null%',
    'admin_missing_row_only', submit_source like '%on conflict (assignment_id, student_id) do nothing%'
      and submit_source like '%existing submission cannot be replaced by an administrator.%'
  ) as value
  from function_sources
),
review_signals as (
  select jsonb_build_object(
    'published_review_allowed', review_source like '%status not in (''published'', ''closed'')%',
    'closed_review_allowed', review_source like '%status not in (''published'', ''closed'')%',
    'draft_review_denied', review_source like '%assignment is not available for review.%',
    'trainer_scope_preserved', review_source like '%m69_4_assert_review_assignment%',
    'delegated_scope_preserved', delegated_review_source like '%find_active_delegated_permission_for_action%'
      and delegated_review_source like '%review_assignments%'
      and delegated_review_source like '%log_delegated_permission_used%',
    'nonexistent_submission_denied', review_source like '%submission not found for this student.%'
      and delegated_review_source like '%submission not found for this student.%'
  ) as value
  from function_sources
),
table_state as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    pg_get_userbyid(c.relowner) as owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('assignments', 'assignment_submissions')
),
policy_state as (
  select
    tablename,
    policyname,
    cmd,
    roles,
    lower(regexp_replace(coalesce(qual, ''), '[[:space:]]+', ' ', 'g')) as using_expression,
    lower(regexp_replace(coalesce(with_check, ''), '[[:space:]]+', ' ', 'g')) as check_expression
  from pg_policies
  where schemaname = 'public'
    and tablename in ('assignments', 'assignment_submissions')
),
student_read_signals as (
  select jsonb_build_object(
    'assignment_student_policy_count', count(*) filter (
      where tablename = 'assignments'
        and policyname = 'Linked students can read assigned assignments'
    ),
    'submission_student_policy_count', count(*) filter (
      where tablename = 'assignment_submissions'
        and policyname = 'Linked students can read own assignment submissions'
    ),
    'draft_assignment_denied', bool_and(using_expression not like '%status = ''draft''%') filter (
      where tablename = 'assignments'
        and policyname = 'Linked students can read assigned assignments'
    ),
    'published_assignment_allowed', bool_and(using_expression like '%published%') filter (
      where tablename = 'assignments'
        and policyname = 'Linked students can read assigned assignments'
    ),
    'closed_assignment_allowed', bool_and(using_expression like '%closed%') filter (
      where tablename = 'assignments'
        and policyname = 'Linked students can read assigned assignments'
    ),
    'assignment_canonical_course_read', bool_and(using_expression like '%student_portal_access_allowed%course_read%') filter (
      where tablename = 'assignments'
        and policyname = 'Linked students can read assigned assignments'
    ),
    'own_submission_only', bool_and(using_expression like '%assignment_submissions.student_id%') filter (
      where tablename = 'assignment_submissions'
        and policyname = 'Linked students can read own assignment submissions'
    ),
    'submission_published_closed_only', bool_and(
      using_expression like '%a.status%published%closed%'
    ) filter (
      where tablename = 'assignment_submissions'
        and policyname = 'Linked students can read own assignment submissions'
    ),
    'submission_canonical_course_read', bool_and(using_expression like '%student_portal_access_allowed%course_read%') filter (
      where tablename = 'assignment_submissions'
        and policyname = 'Linked students can read own assignment submissions'
    )
  ) as value
  from policy_state
),
scope_policy_signals as (
  select jsonb_build_object(
    'owner_admin_staff_assignment_policy', count(*) filter (
      where tablename = 'assignments'
        and policyname = 'Owner admin staff can read assignments'
    ),
    'trainer_assignment_policy', count(*) filter (
      where tablename = 'assignments'
        and policyname = 'Trainer can read assigned assignments'
    ),
    'owner_admin_staff_submission_policy', count(*) filter (
      where tablename = 'assignment_submissions'
        and policyname = 'Owner admin staff can read assignment submissions'
    ),
    'trainer_submission_policy', count(*) filter (
      where tablename = 'assignment_submissions'
        and policyname = 'Trainer can read scoped assignment submissions'
    )
  ) as value
  from policy_state
),
policy_cycle_signals as (
  select jsonb_build_object(
    'assignments_policy_references_submissions', count(*) filter (
      where tablename = 'assignments'
        and using_expression like '%assignment_submissions%'
    ),
    'submissions_policy_references_assignments', count(*) filter (
      where tablename = 'assignment_submissions'
        and using_expression like '%from assignments%'
    ),
    'reciprocal_assignment_submission_cycle',
      count(*) filter (
        where tablename = 'assignments'
          and using_expression like '%assignment_submissions%'
      ) > 0
      and count(*) filter (
        where tablename = 'assignment_submissions'
          and using_expression like '%from assignments%'
      ) > 0
  ) as value
  from policy_state
),
direct_grants as (
  select grantee, table_name, privilege_type, is_grantable
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('assignments', 'assignment_submissions')
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
browser_write_grants as (
  select count(*)::bigint as row_count
  from direct_grants
  where grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
),
status_constraint as (
  select pg_get_constraintdef(con.oid, true) as definition
  from pg_constraint con
  where con.conrelid = 'public.assignments'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid, true) ilike '%status%'
)
select jsonb_build_object(
  'functions', (select jsonb_agg(to_jsonb(fs) - 'definition' order by fs.identity) from function_state fs),
  'lifecycle', (select value from lifecycle_signals),
  'edit_matrix', (select value from edit_signals),
  'submission_contract', (select value from submission_signals),
  'review_contract', (select value from review_signals),
  'student_reads', (select value from student_read_signals),
  'scope_policies', (select value from scope_policy_signals),
  'table_security', (select jsonb_agg(to_jsonb(ts) order by ts.table_name) from table_state ts),
  'assignment_status_constraint', (select coalesce(jsonb_agg(to_jsonb(sc)), '[]'::jsonb) from status_constraint sc),
  'direct_grants', (select coalesce(jsonb_agg(to_jsonb(dg) order by dg.table_name, dg.grantee, dg.privilege_type), '[]'::jsonb) from direct_grants dg),
  'browser_write_grants', (select row_count from browser_write_grants),
  'policy_cycle_signals', (select value from policy_cycle_signals),
  'security_gate',
    (select row_count = 0 from browser_write_grants)
    and (select bool_and(rls_enabled and not force_rls) from table_state)
    and not coalesce((select (value ->> 'reciprocal_assignment_submission_cycle')::boolean from policy_cycle_signals), true)
) as verification_result;
*/
