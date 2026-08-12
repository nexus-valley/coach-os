-- UX-6B demo compatibility cleanup.
--
-- This script removes only submissions attached to draft assignments when both
-- the assignment and submission are tracked in the same demo seed batch. It
-- refuses to run unless the complete production target still matches the
-- reviewed 15 assignment / 90 submission / 60 reviewed fixture population.

begin;

set local lock_timeout = '10s';

lock table public.assignments in share row exclusive mode;
lock table public.assignment_submissions in share row exclusive mode;
lock table public.demo_seed_records in share row exclusive mode;

-- PRE: read-only compatibility evidence. All counts must match the reviewed
-- fixture classification before the guarded deletion below can proceed.
with affected_assignments as (
  select a.id as assignment_id, a.tenant_id
  from public.assignments a
  where a.status = 'draft'
    and exists (
      select 1
      from public.assignment_submissions s
      where s.assignment_id = a.id
        and s.tenant_id = a.tenant_id
    )
),
affected_submissions as (
  select
    s.id as submission_id,
    s.assignment_id,
    aa.tenant_id,
    s.reviewed_at
  from affected_assignments aa
  join public.assignment_submissions s
    on s.assignment_id = aa.assignment_id
   and s.tenant_id = aa.tenant_id
),
assignment_classification as (
  select
    aa.assignment_id,
    aa.tenant_id,
    exists (
      select 1
      from public.demo_seed_records assignment_record
      where assignment_record.tenant_id = aa.tenant_id
        and assignment_record.entity_type = 'assignments'
        and assignment_record.entity_id = aa.assignment_id
    ) as tracked
  from affected_assignments aa
),
submission_classification as (
  select
    affected.submission_id,
    affected.assignment_id,
    affected.tenant_id,
    affected.reviewed_at,
    exists (
      select 1
      from public.demo_seed_records assignment_record
      join public.demo_seed_records submission_record
        on submission_record.tenant_id = assignment_record.tenant_id
       and submission_record.seed_batch_id = assignment_record.seed_batch_id
      where assignment_record.tenant_id = affected.tenant_id
        and assignment_record.entity_type = 'assignments'
        and assignment_record.entity_id = affected.assignment_id
        and submission_record.entity_type = 'assignment_submissions'
        and submission_record.entity_id = affected.submission_id
    ) as tracked_in_assignment_batch
  from affected_submissions affected
)
select jsonb_build_object(
  'draft_assignments',
  (select count(*) from public.assignments where status = 'draft'),
  'affected_assignments',
  (select count(*) from assignment_classification),
  'affected_submissions',
  (select count(*) from submission_classification),
  'affected_reviewed_submissions',
  (
    select count(*)
    from submission_classification
    where reviewed_at is not null
  ),
  'untracked_assignments',
  (select count(*) from assignment_classification where not tracked),
  'untracked_or_mismatched_submissions',
  (
    select count(*)
    from submission_classification
    where not tracked_in_assignment_batch
  ),
  'tenant_mismatch_submission_count',
  (
    select count(*)
    from public.assignments a
    join public.assignment_submissions s
      on s.assignment_id = a.id
    where a.status = 'draft'
      and s.tenant_id is distinct from a.tenant_id
  ),
  'fully_tracked',
  not exists (select 1 from assignment_classification where not tracked)
    and not exists (
      select 1
      from submission_classification
      where not tracked_in_assignment_batch
    )
    and not exists (
      select 1
      from public.assignments a
      join public.assignment_submissions s
        on s.assignment_id = a.id
      where a.status = 'draft'
        and s.tenant_id is distinct from a.tenant_id
    )
) as ux6b_demo_cleanup_pre;

do $$
declare
  v_draft_assignments bigint;
  v_affected_assignments bigint;
  v_affected_submissions bigint;
  v_reviewed_submissions bigint;
  v_untracked_assignments bigint;
  v_untracked_or_mismatched_submissions bigint;
  v_tenant_mismatch_submissions bigint;
  v_deleted_submissions bigint;
  v_deleted_tracking_rows bigint;
  v_post_draft_assignments bigint;
  v_post_draft_submissions bigint;
  v_post_draft_reviewed_submissions bigint;
begin
  with affected_assignments as (
    select a.id as assignment_id, a.tenant_id
    from public.assignments a
    where a.status = 'draft'
      and exists (
        select 1
        from public.assignment_submissions s
        where s.assignment_id = a.id
          and s.tenant_id = a.tenant_id
      )
  ),
  affected_submissions as (
    select
      s.id as submission_id,
      s.assignment_id,
      aa.tenant_id,
      s.reviewed_at
    from affected_assignments aa
    join public.assignment_submissions s
      on s.assignment_id = aa.assignment_id
     and s.tenant_id = aa.tenant_id
  ),
  assignment_classification as (
    select
      aa.assignment_id,
      exists (
        select 1
        from public.demo_seed_records assignment_record
        where assignment_record.tenant_id = aa.tenant_id
          and assignment_record.entity_type = 'assignments'
          and assignment_record.entity_id = aa.assignment_id
      ) as tracked
    from affected_assignments aa
  ),
  submission_classification as (
    select
      affected.submission_id,
      affected.reviewed_at,
      exists (
        select 1
        from public.demo_seed_records assignment_record
        join public.demo_seed_records submission_record
          on submission_record.tenant_id = assignment_record.tenant_id
         and submission_record.seed_batch_id = assignment_record.seed_batch_id
        where assignment_record.tenant_id = affected.tenant_id
          and assignment_record.entity_type = 'assignments'
          and assignment_record.entity_id = affected.assignment_id
          and submission_record.entity_type = 'assignment_submissions'
          and submission_record.entity_id = affected.submission_id
      ) as tracked_in_assignment_batch
    from affected_submissions affected
  )
  select
    (select count(*) from public.assignments where status = 'draft'),
    (select count(*) from assignment_classification),
    (select count(*) from submission_classification),
    (
      select count(*)
      from submission_classification
      where reviewed_at is not null
    ),
    (select count(*) from assignment_classification where not tracked),
    (
      select count(*)
      from submission_classification
      where not tracked_in_assignment_batch
    ),
    (
      select count(*)
      from public.assignments a
      join public.assignment_submissions s
        on s.assignment_id = a.id
      where a.status = 'draft'
        and s.tenant_id is distinct from a.tenant_id
    )
  into
    v_draft_assignments,
    v_affected_assignments,
    v_affected_submissions,
    v_reviewed_submissions,
    v_untracked_assignments,
    v_untracked_or_mismatched_submissions,
    v_tenant_mismatch_submissions;

  if v_draft_assignments <> 15
    or v_affected_assignments <> 15
    or v_affected_submissions <> 90
    or v_reviewed_submissions <> 60
    or v_untracked_assignments <> 0
    or v_untracked_or_mismatched_submissions <> 0
    or v_tenant_mismatch_submissions <> 0
  then
    raise exception
      'UX-6B demo cleanup aborted: production fixture classification changed.';
  end if;

  with targets as (
    select s.id as submission_id, s.tenant_id
    from public.assignments a
    join public.assignment_submissions s
      on s.assignment_id = a.id
     and s.tenant_id = a.tenant_id
    join public.demo_seed_records assignment_record
      on assignment_record.tenant_id = a.tenant_id
     and assignment_record.entity_type = 'assignments'
     and assignment_record.entity_id = a.id
    join public.demo_seed_records submission_record
      on submission_record.tenant_id = s.tenant_id
     and submission_record.entity_type = 'assignment_submissions'
     and submission_record.entity_id = s.id
     and submission_record.seed_batch_id = assignment_record.seed_batch_id
    where a.status = 'draft'
  ),
  deleted_submissions as (
    delete from public.assignment_submissions submission
    using targets target
    where submission.id = target.submission_id
      and submission.tenant_id = target.tenant_id
    returning submission.id, submission.tenant_id
  ),
  deleted_tracking_rows as (
    delete from public.demo_seed_records tracking
    using deleted_submissions deleted
    where tracking.tenant_id = deleted.tenant_id
      and tracking.entity_type = 'assignment_submissions'
      and tracking.entity_id = deleted.id
    returning tracking.id
  )
  select
    (select count(*) from deleted_submissions),
    (select count(*) from deleted_tracking_rows)
  into v_deleted_submissions, v_deleted_tracking_rows;

  if v_deleted_submissions <> 90 or v_deleted_tracking_rows <> 90 then
    raise exception
      'UX-6B demo cleanup aborted: guarded delete count mismatch.';
  end if;

  select
    count(distinct a.id) filter (where a.status = 'draft'),
    count(s.id) filter (where a.status = 'draft'),
    count(s.id) filter (
      where a.status = 'draft'
        and s.reviewed_at is not null
    )
  into
    v_post_draft_assignments,
    v_post_draft_submissions,
    v_post_draft_reviewed_submissions
  from public.assignments a
  left join public.assignment_submissions s
    on s.assignment_id = a.id;

  if v_post_draft_assignments <> 15
    or v_post_draft_submissions <> 0
    or v_post_draft_reviewed_submissions <> 0
  then
    raise exception
      'UX-6B demo cleanup aborted: post-cleanup lifecycle state mismatch.';
  end if;
end $$;

-- POST: all draft assignments remain, but no draft assignment retains a
-- submission or review row.
select jsonb_build_object(
  'draft_assignments',
  count(distinct a.id) filter (where a.status = 'draft'),
  'draft_assignments_with_submissions',
  count(distinct a.id) filter (
    where a.status = 'draft'
      and s.id is not null
  ),
  'draft_submission_rows',
  count(s.id) filter (where a.status = 'draft'),
  'draft_reviewed_submission_rows',
  count(s.id) filter (
    where a.status = 'draft'
      and s.reviewed_at is not null
  ),
  'expected_state',
  count(distinct a.id) filter (where a.status = 'draft') = 15
    and count(s.id) filter (where a.status = 'draft') = 0
    and count(s.id) filter (
      where a.status = 'draft'
        and s.reviewed_at is not null
    ) = 0
) as ux6b_demo_cleanup_post
from public.assignments a
left join public.assignment_submissions s
  on s.assignment_id = a.id;

commit;
