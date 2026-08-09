-- Bundle UX-4B: Enrollment access semantics and permission hardening
-- Review before execution. This migration is additive/replacement-function SQL.
--
-- Canonical access contract:
-- - portal identity: active student + portal_enabled + active linked account
-- - course read: portal identity + published course + active/completed enrollment
-- - course participate: portal identity + published course + active enrollment
-- - paused/cancelled enrollments retain coach-side history but grant no learning access
-- - completed enrollments retain historical reads but grant no new learning mutations
-- - student inactive/lead/blocked, portal_enabled=false, or a non-active portal
--   account overrides every enrollment state without deleting enrollment history

-- PRE-APPLY (run separately; read-only; one result cell):
-- with status_counts as (
--   select jsonb_build_object(
--     'students', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
--       from (select status, count(*) n from public.students group by status) q),
--     'enrollments', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
--       from (select status, count(*) n from public.enrollments group by status) q),
--     'portal_accounts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
--       from (select status, count(*) n from public.student_portal_accounts group by status) q)
--   ) value
-- ), integrity as (
--   select jsonb_build_object(
--     'unsupported_student_statuses', (select count(*) from public.students
--       where status not in ('active', 'inactive', 'lead', 'blocked')),
--     'unsupported_enrollment_statuses', (select count(*) from public.enrollments
--       where status not in ('active', 'completed', 'paused', 'cancelled')),
--     'unsupported_portal_statuses', (select count(*) from public.student_portal_accounts
--       where status not in ('active', 'pending', 'revoked')),
--     'duplicate_enrollment_groups', (select count(*) from (
--       select 1 from public.enrollments group by tenant_id, student_id, course_id
--       having count(*) > 1
--     ) d),
--     'completed_without_completed_at', (select count(*) from public.enrollments
--       where status = 'completed' and completed_at is null),
--     'non_completed_with_completed_at', (select count(*) from public.enrollments
--       where status <> 'completed' and completed_at is not null)
--   ) value
-- ), access_conflicts as (
--   select jsonb_build_object(
--     'active_enrollment_non_active_student', (select count(*)
--       from public.enrollments e join public.students s
--         on s.tenant_id = e.tenant_id and s.id = e.student_id
--       where e.status = 'active' and s.status <> 'active'),
--     'active_enrollment_portal_disabled', (select count(*)
--       from public.enrollments e join public.students s
--         on s.tenant_id = e.tenant_id and s.id = e.student_id
--       where e.status = 'active' and s.portal_enabled = false),
--     'active_portal_non_active_student', (select count(*)
--       from public.student_portal_accounts spa join public.students s
--         on s.tenant_id = spa.tenant_id and s.id = spa.student_id
--       where spa.status = 'active' and s.status <> 'active'),
--     'active_portal_disabled_student', (select count(*)
--       from public.student_portal_accounts spa join public.students s
--         on s.tenant_id = spa.tenant_id and s.id = spa.student_id
--       where spa.status = 'active' and s.portal_enabled = false),
--     'paused_with_active_portal_identity', (select count(*)
--       from public.enrollments e join public.students s
--         on s.tenant_id = e.tenant_id and s.id = e.student_id
--       join public.student_portal_accounts spa
--         on spa.tenant_id = s.tenant_id and spa.student_id = s.id
--       where e.status = 'paused' and s.status = 'active'
--         and s.portal_enabled = true and spa.status = 'active'),
--     'cancelled_with_active_portal_identity', (select count(*)
--       from public.enrollments e join public.students s
--         on s.tenant_id = e.tenant_id and s.id = e.student_id
--       join public.student_portal_accounts spa
--         on spa.tenant_id = s.tenant_id and spa.student_id = s.id
--       where e.status = 'cancelled' and s.status = 'active'
--         and s.portal_enabled = true and spa.status = 'active')
--   ) value
-- ), trainer as (
--   select jsonb_build_object(
--     'trainer_members', (select count(*) from public.tenant_members where role = 'trainer'),
--     'course_assignments', (select count(*) from public.trainer_course_assignments),
--     'cohort_assignments', (select count(*) from public.trainer_cohort_assignments),
--     'trainers_without_assignments', (select count(*)
--       from public.tenant_members tm where tm.role = 'trainer'
--         and not exists (select 1 from public.trainer_course_assignments tca
--           where tca.tenant_id = tm.tenant_id and tca.trainer_user_id = tm.user_id)
--         and not exists (select 1 from public.trainer_cohort_assignments tcoa
--           where tcoa.tenant_id = tm.tenant_id and tcoa.trainer_user_id = tm.user_id)),
--     'trainer_student_mutation_audits', (select count(*)
--       from public.audit_logs al join public.tenant_members tm
--         on tm.tenant_id = al.tenant_id and tm.user_id = al.user_id
--       where tm.role = 'trainer' and al.action in (
--         'student_created', 'student_updated', 'enrollment_created',
--         'enrollment_updated', 'cohort_member_added', 'cohort_member_removed'))
--   ) value
-- ), finance as (
--   select jsonb_build_object(
--     'active_view_payments_delegations_by_role', coalesce((select jsonb_object_agg(role, n)
--       from (select tm.role, count(*) n from public.delegated_permissions dp
--         join public.tenant_members tm
--           on tm.tenant_id = dp.tenant_id and tm.user_id = dp.user_id
--         where dp.permission_key = 'view_payments' and dp.status = 'active'
--           and dp.starts_at <= now() and (dp.expires_at is null or dp.expires_at > now())
--         group by tm.role) q), '{}'::jsonb)
--   ) value
-- )
-- select jsonb_pretty(jsonb_build_object(
--   'status_counts', (select value from status_counts),
--   'integrity', (select value from integrity),
--   'access_conflicts', (select value from access_conflicts),
--   'trainer', (select value from trainer),
--   'finance', (select value from finance),
--   'classification', jsonb_build_object(
--     'block_apply', 'unsupported statuses, duplicate enrollment groups, or completed_at integrity issues',
--     'review', 'active portal/student conflicts and trainers without assignments',
--     'safe', 'non-active students or paused/cancelled enrollments are preserved and access is suspended'
--   )
-- )) as ux4b_preflight;

begin;

-- ---------------------------------------------------------------------------
-- 1. Fail-closed schema/status preconditions
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from public.students s
    where s.status not in ('active', 'inactive', 'lead', 'blocked')
  ) then
    raise exception 'UX-4B blocked: unsupported student status values exist.';
  end if;

  if exists (
    select 1 from public.student_portal_accounts spa
    where spa.status not in ('active', 'pending', 'revoked')
  ) then
    raise exception 'UX-4B blocked: unsupported portal-account status values exist.';
  end if;

  if exists (
    select 1 from public.enrollments e
    where e.status not in ('active', 'completed', 'paused', 'cancelled')
  ) then
    raise exception 'UX-4B blocked: unsupported enrollment status values exist.';
  end if;

  if exists (
    select 1
    from public.enrollments e
    group by e.tenant_id, e.student_id, e.course_id
    having count(*) > 1
  ) then
    raise exception 'UX-4B blocked: duplicate enrollment groups require reconciliation.';
  end if;

  if exists (
    select 1 from public.enrollments e
    where (e.status = 'completed' and e.completed_at is null)
       or (e.status <> 'completed' and e.completed_at is not null)
  ) then
    raise exception 'UX-4B blocked: enrollment completion timestamps require reconciliation.';
  end if;
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
  v_enrollment public.enrollments%rowtype;
  v_status text;
  v_student public.students%rowtype;
begin
  perform public.ux4b_assert_student_manager_scope(
    p_tenant_id, p_student_id, p_course_id, null
  );
  v_student := public.m69_1_assert_student_in_tenant(
    p_tenant_id, p_student_id
  );
  perform public.m69_1_assert_course_in_tenant(p_tenant_id, p_course_id);

  v_status := public.m69_1_validate_enrollment_status(p_status);

  if v_status <> 'active' then
    raise exception 'New enrollments must start active.' using errcode = '22023';
  end if;

  if v_student.status <> 'active' then
    raise exception 'Activate the student before creating an enrollment.'
      using errcode = '22023';
  end if;

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
    null,
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
    raise exception 'This student is already enrolled in that course.'
      using errcode = '23505';
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
  v_enrollment public.enrollments%rowtype;
  v_status text;
  v_student public.students%rowtype;
begin
  select *
  into v_enrollment
  from public.enrollments e
  where e.tenant_id = p_tenant_id
    and e.id = p_enrollment_id
  for update;

  if not found then
    raise exception 'Enrollment not found in this workspace.' using errcode = '22023';
  end if;

  perform public.ux4b_assert_student_manager_scope(
    p_tenant_id,
    v_enrollment.student_id,
    v_enrollment.course_id,
    null
  );
  v_student := public.m69_1_assert_student_in_tenant(
    p_tenant_id, v_enrollment.student_id
  );
  perform public.m69_1_assert_course_in_tenant(
    p_tenant_id, v_enrollment.course_id
  );

  v_status := public.m69_1_validate_enrollment_status(p_status);

  if v_status = 'active' and v_student.status <> 'active' then
    raise exception 'Activate the student before activating the enrollment.'
      using errcode = '22023';
  end if;

  if not (
    v_status = v_enrollment.status
    or (
      v_enrollment.status = 'active'
      and v_status in ('completed', 'paused', 'cancelled')
    )
    or (
      v_enrollment.status = 'paused'
      and v_status in ('active', 'cancelled')
    )
    or (
      v_enrollment.status = 'cancelled'
      and v_status = 'active'
    )
  ) then
    raise exception 'This enrollment status transition is not allowed.'
      using errcode = '22023';
  end if;

  update public.enrollments e
  set
    status = v_status,
    completed_at = case
      when v_status = 'completed' then coalesce(e.completed_at, now())
      else null
    end
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
  v_student public.students%rowtype;
begin
  perform public.ux4b_assert_student_manager_scope(
    p_tenant_id, p_student_id, null, p_cohort_id
  );
  perform public.m69_1_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  v_student := public.m69_1_assert_student_in_tenant(
    p_tenant_id, p_student_id
  );

  if v_student.status <> 'active' then
    raise exception 'Activate the student before adding them to a cohort.'
      using errcode = '22023';
  end if;

  insert into public.cohort_members (tenant_id, cohort_id, student_id)
  values (p_tenant_id, p_cohort_id, p_student_id)
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
    raise exception 'This student is already in that cohort.'
      using errcode = '23505';
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
  perform public.ux4b_assert_student_manager_scope(
    p_tenant_id, p_student_id, null, p_cohort_id
  );
  perform public.m69_1_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_1_assert_student_in_tenant(p_tenant_id, p_student_id);

  select *
  into v_member
  from public.cohort_members cm
  where cm.tenant_id = p_tenant_id
    and cm.cohort_id = p_cohort_id
    and cm.student_id = p_student_id
  for update;

  delete from public.cohort_members cm
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

revoke execute on function public.update_student_secure(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, service_role;
revoke execute on function public.create_enrollment_secure(
  uuid, uuid, uuid, text
) from public, anon, service_role;
revoke execute on function public.update_enrollment_status_secure(
  uuid, uuid, text
) from public, anon, service_role;
revoke execute on function public.add_cohort_member_secure(
  uuid, uuid, uuid
) from public, anon, service_role;
revoke execute on function public.remove_cohort_member_secure(
  uuid, uuid, uuid
) from public, anon, service_role;
grant execute on function public.update_student_secure(
  uuid, uuid, text, text, text, text, text, text
) to authenticated;
grant execute on function public.create_enrollment_secure(
  uuid, uuid, uuid, text
) to authenticated;
grant execute on function public.update_enrollment_status_secure(
  uuid, uuid, text
) to authenticated;
grant execute on function public.add_cohort_member_secure(
  uuid, uuid, uuid
) to authenticated;
grant execute on function public.remove_cohort_member_secure(
  uuid, uuid, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Finance/payment-link read authorization
-- ---------------------------------------------------------------------------

create or replace function public.ux4b_can_read_student_finance(
  p_tenant_id uuid,
  p_student_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_tenant_id is null
     or p_student_id is null
     or p_user_id is null
     or p_user_id <> auth.uid() then
    return false;
  end if;

  if public.student_portal_access_allowed(
    p_tenant_id, p_student_id, p_user_id, null, 'portal'
  ) then
    return true;
  end if;

  v_role := public.m69_1_current_role(p_tenant_id);

  if v_role in ('owner', 'admin', 'staff') then
    return true;
  end if;

  return public.find_active_delegated_permission_for_action(
    p_tenant_id,
    p_user_id,
    array['view_payments'],
    null,
    null,
    p_student_id,
    null,
    null
  ) is not null;
end;
$$;

create or replace function public.finance_student_can_access(
  check_tenant_id uuid,
  check_student_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.student_portal_access_allowed(
    check_tenant_id, check_student_id, auth.uid(), null, 'portal'
  );
end;
$$;

revoke execute on function public.ux4b_can_read_student_finance(
  uuid, uuid, uuid
) from public, anon, service_role;
grant execute on function public.ux4b_can_read_student_finance(
  uuid, uuid, uuid
) to authenticated;
revoke execute on function public.finance_student_can_access(uuid, uuid)
from public, anon, service_role;
grant execute on function public.finance_student_can_access(uuid, uuid)
to authenticated;

-- Restrictive policies narrow existing permissive team/student SELECT policies
-- without granting any new table access.
drop policy if exists "UX4B authorized student finance reads" on public.payments;
create policy "UX4B authorized student finance reads"
on public.payments
as restrictive
for select
to authenticated
using (
  public.ux4b_can_read_student_finance(
    tenant_id, student_id, auth.uid()
  )
);

drop policy if exists "UX4B authorized student payment-link reads"
on public.payment_links;
create policy "UX4B authorized student payment-link reads"
on public.payment_links
as restrictive
for select
to authenticated
using (
  public.ux4b_can_read_student_finance(
    tenant_id, student_id, auth.uid()
  )
);

-- Existing direct student/enrollment writes remain revoked. This migration
-- intentionally adds no table grants and no service-role browser pathway.


-- ---------------------------------------------------------------------------
-- 2. One canonical Student Portal access helper
-- ---------------------------------------------------------------------------

create or replace function public.student_portal_access_allowed(
  p_tenant_id uuid,
  p_student_id uuid,
  p_user_id uuid,
  p_course_id uuid default null,
  p_access_mode text default 'portal'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text := lower(trim(coalesce(p_access_mode, 'portal')));
begin
  if p_tenant_id is null
     or p_student_id is null
     or p_user_id is null
     or p_user_id <> auth.uid()
     or v_mode not in ('portal', 'course_read', 'course_participate') then
    return false;
  end if;

  if not exists (
    select 1
    from public.students s
    join public.student_portal_accounts spa
      on spa.tenant_id = s.tenant_id
     and spa.student_id = s.id
    where s.tenant_id = p_tenant_id
      and s.id = p_student_id
      and s.status = 'active'
      and s.portal_enabled = true
      and spa.user_id = p_user_id
      and spa.status = 'active'
  ) then
    return false;
  end if;

  if v_mode = 'portal' then
    return true;
  end if;

  if p_course_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.enrollments e
    join public.courses c
      on c.tenant_id = e.tenant_id
     and c.id = e.course_id
    where e.tenant_id = p_tenant_id
      and e.student_id = p_student_id
      and e.course_id = p_course_id
      and (
        (
          v_mode = 'course_read'
          and (
            (e.status = 'active' and c.status = 'published')
            or (
              e.status = 'completed'
              and c.status in ('published', 'archived')
            )
          )
        )
        or (
          v_mode = 'course_participate'
          and e.status = 'active'
          and c.status = 'published'
        )
      )
  );
end;
$$;

revoke execute on function public.student_portal_access_allowed(
  uuid, uuid, uuid, uuid, text
) from public, anon, service_role;
grant execute on function public.student_portal_access_allowed(
  uuid, uuid, uuid, uuid, text
) to authenticated;

-- Preserve established helper identities while routing them through the
-- canonical identity contract.
create or replace function public.has_active_student_portal_account(
  check_tenant_id uuid,
  check_student_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.student_portal_access_allowed(
    check_tenant_id,
    check_student_id,
    check_user_id,
    null,
    'portal'
  );
$$;

create or replace function public.has_any_active_student_portal_account(
  check_tenant_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.student_portal_accounts spa
    where spa.tenant_id = check_tenant_id
      and spa.user_id = check_user_id
      and public.student_portal_access_allowed(
        spa.tenant_id,
        spa.student_id,
        check_user_id,
        null,
        'portal'
      )
  );
$$;

create or replace function public.student_can_view_course_enrollment_access(
  p_tenant_id uuid,
  p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.student_portal_accounts spa
    where spa.tenant_id = p_tenant_id
      and spa.user_id = auth.uid()
      and public.student_portal_access_allowed(
        spa.tenant_id,
        spa.student_id,
        auth.uid(),
        p_course_id,
        'course_read'
      )
  );
$$;

revoke execute on function public.has_active_student_portal_account(
  uuid, uuid, uuid
) from public, anon, service_role;
revoke execute on function public.has_any_active_student_portal_account(
  uuid, uuid
) from public, anon, service_role;
revoke execute on function public.student_can_view_course_enrollment_access(
  uuid, uuid
) from public, anon, service_role;
grant execute on function public.has_active_student_portal_account(
  uuid, uuid, uuid
) to authenticated;
grant execute on function public.has_any_active_student_portal_account(
  uuid, uuid
) to authenticated;
grant execute on function public.student_can_view_course_enrollment_access(
  uuid, uuid
) to authenticated;

-- Keep active portal feature surfaces on the same identity contract. These
-- helpers remain internal unless an existing RLS policy calls them directly.
create or replace function public.chat_student_context()
returns table (tenant_id uuid, student_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select spa.tenant_id, spa.student_id
  from public.student_portal_accounts spa
  where spa.user_id = auth.uid()
    and public.student_portal_access_allowed(
      spa.tenant_id, spa.student_id, auth.uid(), null, 'portal'
    )
  order by spa.linked_at asc
  limit 1;
$$;

create or replace function public.chat_student_can_access_thread(p_thread_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_thread public.conversation_threads%rowtype;
  v_course_id uuid;
begin
  select * into v_ctx from public.chat_student_context() limit 1;
  if v_ctx.student_id is null then return false; end if;

  select * into v_thread
  from public.conversation_threads
  where id = p_thread_id
    and tenant_id = v_ctx.tenant_id
    and status <> 'archived';
  if not found then return false; end if;

  if v_thread.thread_type in ('student_direct', 'student_support') then
    return v_thread.student_id = v_ctx.student_id;
  end if;

  if v_thread.thread_type = 'course_announcement' then
    return coalesce(public.student_portal_access_allowed(
      v_ctx.tenant_id, v_ctx.student_id, auth.uid(),
      v_thread.course_id, 'course_read'
    ), false);
  end if;

  if v_thread.thread_type = 'cohort_announcement' then
    select c.course_id into v_course_id
    from public.cohorts c
    where c.tenant_id = v_ctx.tenant_id and c.id = v_thread.cohort_id;

    return coalesce(
      v_course_id is not null
      and exists (
        select 1 from public.cohort_members cm
        where cm.tenant_id = v_ctx.tenant_id
          and cm.student_id = v_ctx.student_id
          and cm.cohort_id = v_thread.cohort_id
      )
      and public.student_portal_access_allowed(
        v_ctx.tenant_id, v_ctx.student_id, auth.uid(),
        v_course_id, 'course_read'
      ),
      false
    );
  end if;

  return false;
end;
$$;

create or replace function public.m75b_student_context()
returns table (tenant_id uuid, student_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select spa.tenant_id, spa.student_id
  from public.student_portal_accounts spa
  where spa.user_id = auth.uid()
    and public.student_portal_access_allowed(
      spa.tenant_id, spa.student_id, auth.uid(), null, 'portal'
    )
  order by spa.linked_at asc
  limit 1;
$$;

create or replace function public.m75b_has_active_student_portal_tenant(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_active_student_portal_account(p_tenant_id, auth.uid());
$$;

create or replace function public.m76b_student_context()
returns table (
  tenant_id uuid,
  student_id uuid,
  user_id uuid,
  student_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select spa.tenant_id, spa.student_id, spa.user_id, s.full_name
  from public.student_portal_accounts spa
  join public.students s
    on s.tenant_id = spa.tenant_id and s.id = spa.student_id
  where spa.user_id = auth.uid()
    and public.student_portal_access_allowed(
      spa.tenant_id, spa.student_id, auth.uid(), null, 'portal'
    )
  order by spa.linked_at asc
  limit 1;
$$;

create or replace function public.m76b_has_active_student_portal_tenant(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_active_student_portal_account(p_tenant_id, auth.uid());
$$;

create or replace function public.get_portal_feature_access(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_student boolean;
  v_has_team boolean;
begin
  if p_tenant_id is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;

  v_has_team := public.feature_access_is_team_member(p_tenant_id);
  v_has_student := public.has_any_active_student_portal_account(
    p_tenant_id, auth.uid()
  );

  if not coalesce(v_has_student, false)
     and not coalesce(v_has_team, false)
     and not public.is_platform_admin() then
    raise exception 'Portal feature access is not available for this user.'
      using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'tenant_id', p_tenant_id,
      'features', coalesce(jsonb_agg(jsonb_build_object(
        'feature_key', fer.feature_key,
        'status', fer.status,
        'source', fer.source
      ) order by fer.feature_key), '[]'::jsonb)
    )
    from public.feature_access_effective_rows(p_tenant_id) fer
    where fer.feature_key in (
      'courses', 'attendance', 'assignments', 'finance', 'documents',
      'messages', 'certificates', 'notifications', 'mobile_pwa'
    )
  );
end;
$$;

revoke execute on function public.chat_student_context()
from public, anon, authenticated, service_role;
revoke execute on function public.chat_student_can_access_thread(uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.m75b_student_context()
from public, anon, authenticated, service_role;
revoke execute on function public.m75b_has_active_student_portal_tenant(uuid)
from public, anon, service_role;
grant execute on function public.m75b_has_active_student_portal_tenant(uuid)
to authenticated;
revoke execute on function public.m76b_student_context()
from public, anon, authenticated, service_role;
revoke execute on function public.m76b_has_active_student_portal_tenant(uuid)
from public, anon, service_role;
grant execute on function public.m76b_has_active_student_portal_tenant(uuid)
to authenticated;
revoke execute on function public.get_portal_feature_access(uuid)
from public, anon, service_role;
grant execute on function public.get_portal_feature_access(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Status-aware Student Portal read policies
-- ---------------------------------------------------------------------------

drop policy if exists "Students can read own portal account"
on public.student_portal_accounts;
create policy "Students can read own portal account"
on public.student_portal_accounts
for select
to authenticated
using (
  public.student_portal_access_allowed(
    tenant_id, student_id, auth.uid(), null, 'portal'
  )
);

drop policy if exists "Linked students can read portal tenant" on public.tenants;
create policy "Linked students can read portal tenant"
on public.tenants
for select
to authenticated
using (public.has_any_active_student_portal_account(id, auth.uid()));

drop policy if exists "Linked students can read own student record" on public.students;
create policy "Linked students can read own student record"
on public.students
for select
to authenticated
using (
  public.student_portal_access_allowed(
    tenant_id, id, auth.uid(), null, 'portal'
  )
);

-- Enrollment rows are identity/history records. Course resources below apply
-- the stricter course_read contract.
drop policy if exists "Linked students can read own enrollments" on public.enrollments;
create policy "Linked students can read own enrollments"
on public.enrollments
for select
to authenticated
using (
  public.student_portal_access_allowed(
    tenant_id, student_id, auth.uid(), null, 'portal'
  )
);

drop policy if exists "Linked students can read enrolled courses" on public.courses;
create policy "Linked students can read enrolled courses"
on public.courses
for select
to authenticated
using (
  exists (
    select 1
    from public.student_portal_accounts spa
    where spa.tenant_id = courses.tenant_id
      and spa.user_id = auth.uid()
      and public.student_portal_access_allowed(
        spa.tenant_id, spa.student_id, auth.uid(), courses.id, 'course_read'
      )
  )
);

drop policy if exists "Linked students can read enrolled course sections"
on public.course_sections;
create policy "Linked students can read enrolled course sections"
on public.course_sections
for select
to authenticated
using (
  exists (
    select 1
    from public.student_portal_accounts spa
    where spa.tenant_id = course_sections.tenant_id
      and spa.user_id = auth.uid()
      and public.student_portal_access_allowed(
        spa.tenant_id,
        spa.student_id,
        auth.uid(),
        course_sections.course_id,
        'course_read'
      )
  )
);

drop policy if exists "Linked students can read enrolled lessons" on public.lessons;
create policy "Linked students can read enrolled lessons"
on public.lessons
for select
to authenticated
using (
  exists (
    select 1
    from public.student_portal_accounts spa
    where spa.tenant_id = lessons.tenant_id
      and spa.user_id = auth.uid()
      and public.student_portal_access_allowed(
        spa.tenant_id, spa.student_id, auth.uid(), lessons.course_id, 'course_read'
      )
  )
);

drop policy if exists "Linked students can read own lesson progress"
on public.lesson_progress;
create policy "Linked students can read own lesson progress"
on public.lesson_progress
for select
to authenticated
using (
  public.student_portal_access_allowed(
    tenant_id, student_id, auth.uid(), course_id, 'course_read'
  )
);

drop policy if exists "Linked students can read own cohort memberships"
on public.cohort_members;
create policy "Linked students can read own cohort memberships"
on public.cohort_members
for select
to authenticated
using (
  exists (
    select 1
    from public.cohorts c
    where c.tenant_id = cohort_members.tenant_id
      and c.id = cohort_members.cohort_id
      and public.student_portal_access_allowed(
        cohort_members.tenant_id,
        cohort_members.student_id,
        auth.uid(),
        c.course_id,
        'course_read'
      )
  )
);

drop policy if exists "Linked students can read own cohorts" on public.cohorts;
create policy "Linked students can read own cohorts"
on public.cohorts
for select
to authenticated
using (
  exists (
    select 1
    from public.cohort_members cm
    where cm.tenant_id = cohorts.tenant_id
      and cm.cohort_id = cohorts.id
      and public.student_portal_access_allowed(
        cm.tenant_id, cm.student_id, auth.uid(), cohorts.course_id, 'course_read'
      )
  )
);

drop policy if exists "Linked students can read own sessions" on public.sessions;
create policy "Linked students can read own sessions"
on public.sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.student_portal_accounts spa
    left join public.cohort_members cm
      on cm.tenant_id = spa.tenant_id
     and cm.student_id = spa.student_id
     and cm.cohort_id = sessions.cohort_id
    left join public.cohorts coh
      on coh.tenant_id = sessions.tenant_id
     and coh.id = sessions.cohort_id
    where spa.tenant_id = sessions.tenant_id
      and spa.user_id = auth.uid()
      and (sessions.cohort_id is null or cm.id is not null)
      and public.student_portal_access_allowed(
        spa.tenant_id,
        spa.student_id,
        auth.uid(),
        coalesce(sessions.course_id, coh.course_id),
        case when sessions.status = 'scheduled'
          then 'course_participate' else 'course_read' end
      )
  )
);

drop policy if exists "Linked students can read own attendance records"
on public.attendance_records;
create policy "Linked students can read own attendance records"
on public.attendance_records
for select
to authenticated
using (
  exists (
    select 1
    from public.sessions ses
    left join public.cohorts coh
      on coh.tenant_id = ses.tenant_id
     and coh.id = ses.cohort_id
    where ses.tenant_id = attendance_records.tenant_id
      and ses.id = attendance_records.session_id
      and public.student_portal_access_allowed(
        attendance_records.tenant_id,
        attendance_records.student_id,
        auth.uid(),
        coalesce(ses.course_id, coh.course_id),
        'course_read'
      )
  )
);

drop policy if exists "Linked students can read assigned assignments"
on public.assignments;
create policy "Linked students can read assigned assignments"
on public.assignments
for select
to authenticated
using (
  status = 'published'
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
    where a.tenant_id = assignment_submissions.tenant_id
      and a.id = assignment_submissions.assignment_id
      and public.student_portal_access_allowed(
        assignment_submissions.tenant_id,
        assignment_submissions.student_id,
        auth.uid(),
        coalesce(a.course_id, coh.course_id),
        'course_read'
      )
  )
);

-- ---------------------------------------------------------------------------
-- 4. Status-aware Student Portal RPC/helper enforcement
-- ---------------------------------------------------------------------------

create or replace function public.document_center_student_context()
returns table (
  tenant_id uuid,
  student_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select spa.tenant_id, spa.student_id
  from public.student_portal_accounts spa
  where spa.user_id = auth.uid()
    and public.student_portal_access_allowed(
      spa.tenant_id, spa.student_id, auth.uid(), null, 'portal'
    )
  order by spa.linked_at asc
  limit 1;
$$;

create or replace function public.document_center_student_enrolled_course(
  check_tenant_id uuid,
  check_student_id uuid,
  check_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.student_portal_access_allowed(
    check_tenant_id,
    check_student_id,
    auth.uid(),
    check_course_id,
    'course_read'
  );
$$;

create or replace function public.document_center_student_in_cohort(
  check_tenant_id uuid,
  check_student_id uuid,
  check_cohort_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cohort_members cm
    join public.cohorts c
      on c.tenant_id = cm.tenant_id
     and c.id = cm.cohort_id
    where cm.tenant_id = check_tenant_id
      and cm.student_id = check_student_id
      and cm.cohort_id = check_cohort_id
      and public.student_portal_access_allowed(
        cm.tenant_id,
        cm.student_id,
        auth.uid(),
        c.course_id,
        'course_read'
      )
  );
$$;

create or replace function public.document_center_student_can_access_session(
  check_tenant_id uuid,
  check_student_id uuid,
  check_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    left join public.cohorts c
      on c.tenant_id = s.tenant_id
     and c.id = s.cohort_id
    where s.tenant_id = check_tenant_id
      and s.id = check_session_id
      and (
        s.cohort_id is null
        or public.document_center_student_in_cohort(
          check_tenant_id, check_student_id, s.cohort_id
        )
      )
      and public.student_portal_access_allowed(
        check_tenant_id,
        check_student_id,
        auth.uid(),
        coalesce(s.course_id, c.course_id),
        'course_read'
      )
  );
$$;

-- Student submissions are active participation. Owner/Admin operational
-- submissions retain their existing override.
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

  v_assignment := public.m69_4_assert_assignment_in_tenant(
    p_tenant_id, p_assignment_id
  );
  perform public.m69_4_assert_student_in_assignment_roster(
    p_tenant_id, v_assignment, p_student_id
  );

  select coalesce(v_assignment.course_id, c.course_id)
  into v_access_course_id
  from (select 1) anchor
  left join public.cohorts c
    on c.tenant_id = p_tenant_id
   and c.id = v_assignment.cohort_id;

  v_role := public.m69_4_current_role(p_tenant_id);
  v_student_portal_allowed := public.student_portal_access_allowed(
    p_tenant_id,
    p_student_id,
    auth.uid(),
    v_access_course_id,
    'course_participate'
  );

  if v_role in ('owner', 'admin') then
    null;
  elsif v_student_portal_allowed then
    if v_assignment.status <> 'published' then
      raise exception 'Assignment is not open for student submissions.'
        using errcode = '42501';
    end if;
  else
    raise exception 'You do not have permission to submit this assignment.'
      using errcode = '42501';
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

-- Progress mutation is valid only while the enrollment is active. Certificate
-- reads continue to use completed enrollment data independently.
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
    and e.status = 'active';

  if not found then
    raise exception 'Active enrollment is required to update learning progress.'
      using errcode = '22023';
  end if;

  return v_enrollment;
end;
$$;

revoke execute on function public.document_center_student_context()
from public, anon, authenticated, service_role;
revoke execute on function public.document_center_student_enrolled_course(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.document_center_student_in_cohort(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.document_center_student_can_access_session(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.m69_8_assert_student_enrolled(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.submit_assignment_secure(
  uuid, uuid, uuid, text, jsonb
) from public, anon, service_role;
grant execute on function public.submit_assignment_secure(
  uuid, uuid, uuid, text, jsonb
) to authenticated;

-- These two deployed portal functions predate tracked source. UX-4B records
-- their verified production identities and replaces their bodies with the
-- canonical contract so the source/deployment gap does not persist.
create or replace function public.get_student_portal_sessions(p_tenant_id uuid)
returns table (
  tenant_id uuid,
  id uuid,
  course_id uuid,
  cohort_id uuid,
  course_title text,
  cohort_name text,
  title text,
  delivery_mode text,
  meeting_provider text,
  meeting_url text,
  join_available_from timestamptz,
  recording_url text,
  timezone text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select spa.tenant_id, spa.student_id
    from public.student_portal_accounts spa
    where spa.tenant_id = p_tenant_id
      and spa.user_id = auth.uid()
      and public.student_portal_access_allowed(
        spa.tenant_id, spa.student_id, auth.uid(), null, 'portal'
      )
    order by spa.linked_at asc
    limit 1
  ),
  visible_sessions as (
    select
      s.id,
      s.tenant_id,
      s.course_id,
      s.cohort_id,
      c.title as course_title,
      coh.name as cohort_name,
      coalesce(s.course_id, coh.course_id) as access_course_id,
      s.title,
      s.delivery_mode,
      s.meeting_provider,
      s.meeting_url,
      s.join_available_from,
      s.recording_url,
      s.timezone,
      s.scheduled_start_at,
      s.scheduled_end_at,
      s.status,
      public.student_portal_access_allowed(
        ctx.tenant_id,
        ctx.student_id,
        auth.uid(),
        coalesce(s.course_id, coh.course_id),
        'course_read'
      ) as can_read,
      public.student_portal_access_allowed(
        ctx.tenant_id,
        ctx.student_id,
        auth.uid(),
        coalesce(s.course_id, coh.course_id),
        'course_participate'
      ) as can_participate
    from public.sessions s
    join ctx on ctx.tenant_id = s.tenant_id
    left join public.cohorts coh
      on coh.tenant_id = s.tenant_id
     and coh.id = s.cohort_id
    left join public.courses c
      on c.tenant_id = s.tenant_id
     and c.id = coalesce(s.course_id, coh.course_id)
    where s.tenant_id = p_tenant_id
      and s.status in ('scheduled', 'completed')
      and (
        s.cohort_id is null
        or exists (
          select 1
          from public.cohort_members cm
          where cm.tenant_id = ctx.tenant_id
            and cm.student_id = ctx.student_id
            and cm.cohort_id = s.cohort_id
        )
      )
  )
  select
    vs.tenant_id,
    vs.id,
    vs.course_id,
    vs.cohort_id,
    vs.course_title,
    vs.cohort_name,
    vs.title,
    vs.delivery_mode,
    vs.meeting_provider,
    case
      when vs.status = 'scheduled'
       and vs.can_participate
       and vs.meeting_url is not null
       and (vs.join_available_from is null or now() >= vs.join_available_from)
      then vs.meeting_url
      else null
    end,
    vs.join_available_from,
    case
      when vs.status = 'completed'
       and vs.can_read
       and vs.recording_url is not null
      then vs.recording_url
      else null
    end,
    vs.timezone,
    vs.scheduled_start_at,
    vs.scheduled_end_at,
    vs.status
  from visible_sessions vs
  where (vs.status = 'scheduled' and vs.can_participate)
     or (vs.status = 'completed' and vs.can_read)
  order by vs.scheduled_start_at asc;
$$;

create or replace function public.get_student_portal_attendance(p_tenant_id uuid)
returns table (
  attendance_id uuid,
  tenant_id uuid,
  student_id uuid,
  session_id uuid,
  session_title text,
  session_status text,
  scheduled_start_at timestamptz,
  attendance_status text,
  remarks text,
  marked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_ctx record;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select spa.tenant_id, spa.student_id
  into v_ctx
  from public.student_portal_accounts spa
  where spa.tenant_id = p_tenant_id
    and spa.user_id = v_actor
    and public.student_portal_access_allowed(
      spa.tenant_id, spa.student_id, v_actor, null, 'portal'
    )
  order by spa.linked_at asc
  limit 1;

  if not found then
    raise exception 'Linked student portal account required.'
      using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    ar.tenant_id,
    ar.student_id,
    ar.session_id,
    s.title::text,
    s.status::text,
    s.scheduled_start_at,
    ar.status::text,
    ar.remarks::text,
    ar.marked_at
  from public.attendance_records ar
  join public.sessions s
    on s.tenant_id = ar.tenant_id
   and s.id = ar.session_id
  left join public.cohorts c
    on c.tenant_id = s.tenant_id
   and c.id = s.cohort_id
  where ar.tenant_id = v_ctx.tenant_id
    and ar.student_id = v_ctx.student_id
    and public.student_portal_access_allowed(
      ar.tenant_id,
      ar.student_id,
      v_actor,
      coalesce(s.course_id, c.course_id),
      'course_read'
    )
  order by ar.marked_at desc;
end;
$$;

revoke execute on function public.get_student_portal_sessions(uuid)
from public, anon, service_role;
revoke execute on function public.get_student_portal_attendance(uuid)
from public, anon, service_role;
grant execute on function public.get_student_portal_sessions(uuid)
to authenticated;
grant execute on function public.get_student_portal_attendance(uuid)
to authenticated;

-- Mobile home is an active-participation surface. Cohort membership alone no
-- longer bypasses paused/cancelled enrollment state.
create or replace function public.get_mobile_student_home()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_ctx record;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select spa.tenant_id, spa.student_id, s.full_name, s.email, s.phone, s.status, t
  into v_ctx
  from public.student_portal_accounts spa
  join public.students s
    on s.tenant_id = spa.tenant_id
   and s.id = spa.student_id
  join public.tenants t on t.id = spa.tenant_id
  where spa.user_id = v_actor
    and public.student_portal_access_allowed(
      spa.tenant_id, spa.student_id, v_actor, null, 'portal'
    )
  order by spa.linked_at asc
  limit 1;

  if not found then
    raise exception 'Linked student portal account required.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tenant', public.mobile_tenant_branding_json(v_ctx.t),
    'profile', jsonb_build_object(
      'student_id', v_ctx.student_id,
      'full_name', v_ctx.full_name,
      'email', v_ctx.email,
      'phone', v_ctx.phone,
      'status', v_ctx.status
    ),
    'summary', jsonb_build_object(
      'enrolled_course_count', (
        select count(*)
        from public.enrollments e
        where e.tenant_id = v_ctx.tenant_id
          and e.student_id = v_ctx.student_id
          and e.status = 'active'
      ),
      'upcoming_session_count', (
        select count(*)
        from public.sessions s
        left join public.cohorts c
          on c.tenant_id = s.tenant_id
         and c.id = s.cohort_id
        where s.tenant_id = v_ctx.tenant_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
          and (
            s.cohort_id is null
            or exists (
              select 1
              from public.cohort_members cm
              where cm.tenant_id = v_ctx.tenant_id
                and cm.student_id = v_ctx.student_id
                and cm.cohort_id = s.cohort_id
            )
          )
          and public.student_portal_access_allowed(
            v_ctx.tenant_id,
            v_ctx.student_id,
            v_actor,
            coalesce(s.course_id, c.course_id),
            'course_participate'
          )
      ),
      'pending_assignment_count', (
        select count(*)
        from public.assignments a
        left join public.cohorts c
          on c.tenant_id = a.tenant_id
         and c.id = a.cohort_id
        where a.tenant_id = v_ctx.tenant_id
          and a.status = 'published'
          and (a.due_at is null or a.due_at >= now())
          and (
            a.cohort_id is null
            or exists (
              select 1
              from public.cohort_members cm
              where cm.tenant_id = v_ctx.tenant_id
                and cm.student_id = v_ctx.student_id
                and cm.cohort_id = a.cohort_id
            )
          )
          and public.student_portal_access_allowed(
            v_ctx.tenant_id,
            v_ctx.student_id,
            v_actor,
            coalesce(a.course_id, c.course_id),
            'course_participate'
          )
          and not exists (
            select 1
            from public.assignment_submissions sub
            where sub.tenant_id = v_ctx.tenant_id
              and sub.assignment_id = a.id
              and sub.student_id = v_ctx.student_id
              and sub.status in ('submitted', 'reviewed', 'late')
          )
      ),
      'pending_payment_count', (
        select count(*)
        from public.payment_links pl
        where pl.tenant_id = v_ctx.tenant_id
          and pl.student_id = v_ctx.student_id
          and pl.status in ('created', 'sent')
      ),
      'unread_notification_count', (
        select count(*)
        from public.notifications n
        where n.tenant_id = v_ctx.tenant_id
          and n.user_id = v_actor
          and n.status = 'unread'
      )
    ),
    'upcoming_sessions', coalesce((
      select jsonb_agg(session_item order by session_item ->> 'scheduled_start_at')
      from (
        select jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'scheduled_start_at', s.scheduled_start_at,
          'scheduled_end_at', s.scheduled_end_at,
          'delivery_mode', s.delivery_mode,
          'meeting_provider', s.meeting_provider,
          'meeting_url', s.meeting_url,
          'course_title', course_row.title,
          'cohort_name', cohort_row.name
        ) as session_item
        from public.sessions s
        left join public.cohorts cohort_row
          on cohort_row.tenant_id = s.tenant_id
         and cohort_row.id = s.cohort_id
        left join public.courses course_row
          on course_row.tenant_id = s.tenant_id
         and course_row.id = coalesce(s.course_id, cohort_row.course_id)
        where s.tenant_id = v_ctx.tenant_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
          and (
            s.cohort_id is null
            or exists (
              select 1
              from public.cohort_members cm
              where cm.tenant_id = v_ctx.tenant_id
                and cm.student_id = v_ctx.student_id
                and cm.cohort_id = s.cohort_id
            )
          )
          and public.student_portal_access_allowed(
            v_ctx.tenant_id,
            v_ctx.student_id,
            v_actor,
            coalesce(s.course_id, cohort_row.course_id),
            'course_participate'
          )
        order by s.scheduled_start_at asc
        limit 8
      ) q
    ), '[]'::jsonb),
    'pending_assignments', coalesce((
      select jsonb_agg(assignment_item order by assignment_item ->> 'due_at')
      from (
        select jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'due_at', a.due_at,
          'status', a.status,
          'course_title', course_row.title,
          'cohort_name', cohort_row.name
        ) as assignment_item
        from public.assignments a
        left join public.cohorts cohort_row
          on cohort_row.tenant_id = a.tenant_id
         and cohort_row.id = a.cohort_id
        left join public.courses course_row
          on course_row.tenant_id = a.tenant_id
         and course_row.id = coalesce(a.course_id, cohort_row.course_id)
        where a.tenant_id = v_ctx.tenant_id
          and a.status = 'published'
          and (
            a.cohort_id is null
            or exists (
              select 1
              from public.cohort_members cm
              where cm.tenant_id = v_ctx.tenant_id
                and cm.student_id = v_ctx.student_id
                and cm.cohort_id = a.cohort_id
            )
          )
          and public.student_portal_access_allowed(
            v_ctx.tenant_id,
            v_ctx.student_id,
            v_actor,
            coalesce(a.course_id, cohort_row.course_id),
            'course_participate'
          )
          and not exists (
            select 1
            from public.assignment_submissions sub
            where sub.tenant_id = v_ctx.tenant_id
              and sub.assignment_id = a.id
              and sub.student_id = v_ctx.student_id
              and sub.status in ('submitted', 'reviewed', 'late')
          )
        order by a.due_at asc nulls last
        limit 8
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_mobile_student_home()
from public, anon, service_role;
grant execute on function public.get_mobile_student_home()
to authenticated;

create or replace function public.get_mobile_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_team record;
  v_student record;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select tm.tenant_id, tm.role, t, p.full_name, p.email, p.avatar_url
  into v_team
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  left join public.profiles p on p.id = tm.user_id
  where tm.user_id = v_actor
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  order by tm.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'mode', 'team',
      'user', jsonb_build_object(
        'id', v_actor, 'full_name', v_team.full_name,
        'email', v_team.email, 'avatar_url', v_team.avatar_url
      ),
      'tenant', public.mobile_tenant_branding_json(v_team.t),
      'role', v_team.role,
      'permissions', public.mobile_role_permissions_json(v_team.role),
      'sections', public.mobile_team_sections_json(v_team.role),
      'unread_notifications', (select count(*) from public.notifications n
        where n.tenant_id = v_team.tenant_id and n.user_id = v_actor
          and n.status = 'unread')
    );
  end if;

  select spa.tenant_id, spa.student_id, spa.email portal_email,
    s.full_name student_name, s.email student_email, s.phone student_phone,
    s.status student_status, t, p.full_name, p.email, p.avatar_url
  into v_student
  from public.student_portal_accounts spa
  join public.students s
    on s.tenant_id = spa.tenant_id and s.id = spa.student_id
  join public.tenants t on t.id = spa.tenant_id
  left join public.profiles p on p.id = spa.user_id
  where spa.user_id = v_actor
    and public.student_portal_access_allowed(
      spa.tenant_id, spa.student_id, v_actor, null, 'portal'
    )
  order by spa.linked_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'mode', 'student',
      'user', jsonb_build_object(
        'id', v_actor, 'full_name', v_student.full_name,
        'email', v_student.email, 'avatar_url', v_student.avatar_url
      ),
      'tenant', public.mobile_tenant_branding_json(v_student.t),
      'student', jsonb_build_object(
        'id', v_student.student_id,
        'full_name', v_student.student_name,
        'email', coalesce(v_student.student_email, v_student.portal_email),
        'phone', v_student.student_phone,
        'status', v_student.student_status
      ),
      'sections', jsonb_build_array(
        'home', 'courses', 'sessions', 'assignments',
        'certificates', 'payments', 'notifications', 'profile'
      ),
      'unread_notifications', (select count(*) from public.notifications n
        where n.tenant_id = v_student.tenant_id and n.user_id = v_actor
          and n.status = 'unread')
    );
  end if;

  return jsonb_build_object(
    'mode', 'none', 'user', jsonb_build_object('id', v_actor),
    'sections', '[]'::jsonb, 'unread_notifications', 0
  );
end;
$$;

create or replace function public.get_mobile_notifications(
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_tenant_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select tm.tenant_id into v_tenant_id
  from public.tenant_members tm
  where tm.user_id = v_actor and tm.role in ('owner', 'admin', 'staff', 'trainer')
  order by tm.created_at asc limit 1;

  if v_tenant_id is null then
    select spa.tenant_id into v_tenant_id
    from public.student_portal_accounts spa
    where spa.user_id = v_actor
      and public.student_portal_access_allowed(
        spa.tenant_id, spa.student_id, v_actor, null, 'portal'
      )
    order by spa.linked_at asc limit 1;
  end if;

  if v_tenant_id is null then
    return jsonb_build_object(
      'items', '[]'::jsonb, 'limit', v_limit,
      'offset', v_offset, 'unread_count', 0
    );
  end if;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by item ->> 'created_at' desc)
      from (select jsonb_build_object(
        'id', n.id, 'type', n.type, 'title', n.title,
        'message', n.message, 'severity', n.severity, 'status', n.status,
        'action_url', n.action_url, 'created_at', n.created_at, 'read_at', n.read_at
      ) item from public.notifications n
      where n.tenant_id = v_tenant_id and n.user_id = v_actor
      order by n.created_at desc limit v_limit offset v_offset) q), '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset,
    'unread_count', (select count(*) from public.notifications n
      where n.tenant_id = v_tenant_id and n.user_id = v_actor
        and n.status = 'unread')
  );
end;
$$;

revoke execute on function public.get_mobile_bootstrap()
from public, anon, service_role;
grant execute on function public.get_mobile_bootstrap() to authenticated;
revoke execute on function public.get_mobile_notifications(integer, integer)
from public, anon, service_role;
grant execute on function public.get_mobile_notifications(integer, integer)
to authenticated;

-- The offline manifest is SECURITY DEFINER, so its student branches must not
-- rely on RLS or cohort membership alone.
create or replace function public.get_mobile_offline_manifest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_bootstrap jsonb;
  v_tenant_id uuid;
  v_mode text;
  v_role text;
  v_student_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  v_bootstrap := public.get_mobile_bootstrap();
  v_mode := v_bootstrap ->> 'mode';
  v_role := v_bootstrap ->> 'role';
  v_tenant_id := nullif(v_bootstrap #>> '{tenant,id}', '')::uuid;
  v_student_id := nullif(v_bootstrap #>> '{student,id}', '')::uuid;

  if v_mode = 'student' and not public.student_portal_access_allowed(
    v_tenant_id, v_student_id, v_actor, null, 'portal'
  ) then
    v_mode := 'none';
    v_tenant_id := null;
    v_student_id := null;
  end if;

  return jsonb_build_object(
    'server_time', now(),
    'mode', v_mode,
    'tenant_id', v_tenant_id,
    'sections', case when v_mode = 'none' then '[]'::jsonb
      else coalesce(v_bootstrap -> 'sections', '[]'::jsonb) end,
    'last_updated', case when v_tenant_id is null then '{}'::jsonb else jsonb_build_object(
      'courses', case
        when v_mode = 'student' then (
          select max(c.updated_at)
          from public.courses c
          where c.tenant_id = v_tenant_id
            and public.student_portal_access_allowed(
              v_tenant_id, v_student_id, v_actor, c.id, 'course_read'
            )
        )
        when v_role = 'trainer' then (
          select max(c.updated_at)
          from public.courses c
          join public.trainer_course_assignments tca
            on tca.tenant_id = c.tenant_id and tca.course_id = c.id
          where c.tenant_id = v_tenant_id and tca.trainer_user_id = v_actor
        )
        when v_role in ('owner', 'admin') then (
          select max(c.updated_at) from public.courses c
          where c.tenant_id = v_tenant_id
        )
        else null
      end,
      'sessions', case
        when v_mode = 'student' then (
          select max(s.updated_at)
          from public.sessions s
          left join public.cohorts c
            on c.tenant_id = s.tenant_id and c.id = s.cohort_id
          where s.tenant_id = v_tenant_id
            and (s.cohort_id is null or exists (
              select 1 from public.cohort_members cm
              where cm.tenant_id = v_tenant_id
                and cm.student_id = v_student_id
                and cm.cohort_id = s.cohort_id
            ))
            and public.student_portal_access_allowed(
              v_tenant_id, v_student_id, v_actor,
              coalesce(s.course_id, c.course_id),
              case when s.status = 'scheduled'
                then 'course_participate' else 'course_read' end
            )
        )
        when v_role = 'trainer' then (
          select max(s.updated_at) from public.sessions s
          where s.tenant_id = v_tenant_id and (
            s.trainer_user_id = v_actor
            or exists (select 1 from public.trainer_course_assignments tca
              where tca.tenant_id = v_tenant_id
                and tca.trainer_user_id = v_actor and tca.course_id = s.course_id)
            or exists (select 1 from public.trainer_cohort_assignments tcoa
              where tcoa.tenant_id = v_tenant_id
                and tcoa.trainer_user_id = v_actor and tcoa.cohort_id = s.cohort_id)
          )
        )
        when v_role in ('owner', 'admin', 'staff') then (
          select max(s.updated_at) from public.sessions s
          where s.tenant_id = v_tenant_id
        )
        else null
      end,
      'assignments', case
        when v_mode = 'student' then (
          select max(a.updated_at)
          from public.assignments a
          left join public.cohorts c
            on c.tenant_id = a.tenant_id and c.id = a.cohort_id
          where a.tenant_id = v_tenant_id
            and a.status = 'published'
            and (a.cohort_id is null or exists (
              select 1 from public.cohort_members cm
              where cm.tenant_id = v_tenant_id
                and cm.student_id = v_student_id
                and cm.cohort_id = a.cohort_id
            ))
            and public.student_portal_access_allowed(
              v_tenant_id, v_student_id, v_actor,
              coalesce(a.course_id, c.course_id), 'course_read'
            )
        )
        when v_role = 'trainer' then (
          select max(a.updated_at) from public.assignments a
          where a.tenant_id = v_tenant_id and (
            a.trainer_user_id = v_actor
            or exists (select 1 from public.trainer_course_assignments tca
              where tca.tenant_id = v_tenant_id
                and tca.trainer_user_id = v_actor and tca.course_id = a.course_id)
            or exists (select 1 from public.trainer_cohort_assignments tcoa
              where tcoa.tenant_id = v_tenant_id
                and tcoa.trainer_user_id = v_actor and tcoa.cohort_id = a.cohort_id)
          )
        )
        when v_role in ('owner', 'admin') then (
          select max(a.updated_at) from public.assignments a
          where a.tenant_id = v_tenant_id
        )
        else null
      end,
      'students', case
        when v_mode = 'student' then (
          select max(s.updated_at) from public.students s
          where s.tenant_id = v_tenant_id and s.id = v_student_id
            and public.student_portal_access_allowed(
              v_tenant_id, v_student_id, v_actor, null, 'portal'
            )
        )
        when v_role = 'trainer' then (
          select max(s.updated_at) from public.students s
          where s.tenant_id = v_tenant_id
            and public.ux4b_trainer_can_manage_student(
              v_tenant_id, v_actor, s.id
            )
        )
        when v_role in ('owner', 'admin', 'staff') then (
          select max(s.updated_at) from public.students s
          where s.tenant_id = v_tenant_id
        )
        else null
      end,
      'payments', case
        when v_mode = 'student' then (
          select max(pl.updated_at) from public.payment_links pl
          where pl.tenant_id = v_tenant_id and pl.student_id = v_student_id
            and public.student_portal_access_allowed(
              v_tenant_id, v_student_id, v_actor, null, 'portal'
            )
        )
        when v_role in ('owner', 'admin', 'staff') then (
          select max(pl.updated_at) from public.payment_links pl
          where pl.tenant_id = v_tenant_id
        )
        else null
      end,
      'notifications', (
        select max(n.created_at) from public.notifications n
        where n.tenant_id = v_tenant_id and n.user_id = v_actor
      )
    ) end
  );
end;
$$;

revoke execute on function public.get_mobile_offline_manifest()
from public, anon, service_role;
grant execute on function public.get_mobile_offline_manifest()
to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Trainer assignment-scoped student/enrollment mutations
-- ---------------------------------------------------------------------------

create or replace function public.ux4b_trainer_can_manage_course(
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
  select coalesce(exists (
    select 1
    from public.trainer_course_assignments tca
    where tca.tenant_id = p_tenant_id
      and tca.trainer_user_id = p_trainer_user_id
      and tca.course_id = p_course_id
  ), false);
$$;

create or replace function public.ux4b_trainer_can_manage_cohort(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_cohort_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.trainer_cohort_assignments tca
    where tca.tenant_id = p_tenant_id
      and tca.trainer_user_id = p_trainer_user_id
      and tca.cohort_id = p_cohort_id
  ), false);
$$;

create or replace function public.ux4b_trainer_can_manage_student(
  p_tenant_id uuid,
  p_trainer_user_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.enrollments e
      join public.trainer_course_assignments tca
        on tca.tenant_id = e.tenant_id
       and tca.course_id = e.course_id
      where e.tenant_id = p_tenant_id
        and e.student_id = p_student_id
        and tca.trainer_user_id = p_trainer_user_id
    )
    or exists (
      select 1
      from public.cohort_members cm
      join public.trainer_cohort_assignments tca
        on tca.tenant_id = cm.tenant_id
       and tca.cohort_id = cm.cohort_id
      where cm.tenant_id = p_tenant_id
        and cm.student_id = p_student_id
        and tca.trainer_user_id = p_trainer_user_id
    ),
    false
  );
$$;

create or replace function public.ux4b_assert_student_manager_scope(
  p_tenant_id uuid,
  p_student_id uuid default null,
  p_course_id uuid default null,
  p_cohort_id uuid default null
)
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

  if v_role in ('owner', 'admin', 'staff') then
    return v_role;
  end if;

  if v_role <> 'trainer' then
    raise exception 'You do not have permission to manage students.'
      using errcode = '42501';
  end if;

  if p_student_id is null
     or not public.ux4b_trainer_can_manage_student(
       p_tenant_id, v_actor, p_student_id
     )
     or (
       p_course_id is not null
       and not public.ux4b_trainer_can_manage_course(
         p_tenant_id, v_actor, p_course_id
       )
     )
     or (
       p_cohort_id is not null
       and not public.ux4b_trainer_can_manage_cohort(
         p_tenant_id, v_actor, p_cohort_id
       )
     ) then
    raise exception 'This student is outside your assigned teaching scope.'
      using errcode = '42501';
  end if;

  return v_role;
end;
$$;

-- New student creation has no assignment anchor. Owner/Admin/Staff retain the
-- established behavior; Trainer creation is denied rather than tenant-wide.
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

  if v_role not in ('owner', 'admin', 'staff') then
    raise exception 'You do not have permission to create students.'
      using errcode = '42501';
  end if;

  return v_role;
end;
$$;

revoke execute on function public.ux4b_trainer_can_manage_course(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.ux4b_trainer_can_manage_cohort(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.ux4b_trainer_can_manage_student(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.ux4b_assert_student_manager_scope(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.m69_1_assert_manage_students(uuid)
from public, anon, authenticated, service_role;

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
  v_constraint_name text;
  v_email text;
  v_existing public.students%rowtype;
  v_full_name text;
  v_notes text;
  v_phone text;
  v_role text;
  v_source text;
  v_status text;
  v_student public.students%rowtype;
begin
  v_role := public.ux4b_assert_student_manager_scope(
    p_tenant_id, p_student_id, null, null
  );

  select *
  into v_existing
  from public.students s
  where s.tenant_id = p_tenant_id
    and s.id = p_student_id
  for update;

  if not found then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  v_full_name := public.m69_1_normalize_text(
    p_full_name, 'Full name', true, 160
  );
  v_email := lower(nullif(btrim(public.m69_1_normalize_text(
    p_email, 'Email', false, 254
  )), ''));
  v_phone := public.m69_1_normalize_text(p_phone, 'Phone', false, 40);
  v_source := public.m69_1_normalize_text(p_source, 'Source', false, 80);
  v_notes := public.m69_1_normalize_text(p_notes, 'Notes', false, 2000);
  v_status := public.m69_1_validate_student_status(p_status);

  if v_role = 'trainer' and (
    v_full_name is distinct from btrim(v_existing.full_name)
    or v_email is distinct from lower(nullif(btrim(v_existing.email), ''))
    or v_phone is distinct from nullif(btrim(v_existing.phone), '')
    or v_source is distinct from nullif(btrim(v_existing.source), '')
    or v_status is distinct from v_existing.status
  ) then
    raise exception 'Trainers can update student notes only.'
      using errcode = '42501';
  end if;

  if v_role = 'trainer' then
    v_full_name := v_existing.full_name;
    v_email := v_existing.email;
    v_phone := v_existing.phone;
    v_source := v_existing.source;
    v_status := v_existing.status;
  end if;

  update public.students s
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
    jsonb_build_object('studentId', v_student.id, 'status', v_student.status)
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
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name = 'students_tenant_normalized_email_uidx' then
      raise exception
        'A student with this email already exists in this workspace. Use the existing student.'
        using errcode = '23505', constraint = v_constraint_name;
    end if;

    raise;
end;
$$;

revoke truncate, trigger, references, maintain on table
  public.student_portal_accounts,
  public.tenants,
  public.students,
  public.enrollments,
  public.courses,
  public.course_sections,
  public.lessons,
  public.lesson_progress,
  public.cohort_members,
  public.cohorts,
  public.sessions,
  public.attendance_records,
  public.assignments,
  public.assignment_submissions,
  public.payments,
  public.payment_links
from public, anon, authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- 7. One-cell read-only post-apply verification pack
-- ---------------------------------------------------------------------------

with expected_functions(signature) as (
  values
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    ('public.has_active_student_portal_account(uuid,uuid,uuid)'),
    ('public.has_any_active_student_portal_account(uuid,uuid)'),
    ('public.student_can_view_course_enrollment_access(uuid,uuid)'),
    ('public.chat_student_context()'),
    ('public.chat_student_can_access_thread(uuid)'),
    ('public.m75b_student_context()'),
    ('public.m75b_has_active_student_portal_tenant(uuid)'),
    ('public.m76b_student_context()'),
    ('public.m76b_has_active_student_portal_tenant(uuid)'),
    ('public.get_portal_feature_access(uuid)'),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_cohort(uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_student(uuid,uuid,uuid)'),
    ('public.ux4b_assert_student_manager_scope(uuid,uuid,uuid,uuid)'),
    ('public.update_student_secure(uuid,uuid,text,text,text,text,text,text)'),
    ('public.create_enrollment_secure(uuid,uuid,uuid,text)'),
    ('public.update_enrollment_status_secure(uuid,uuid,text)'),
    ('public.add_cohort_member_secure(uuid,uuid,uuid)'),
    ('public.remove_cohort_member_secure(uuid,uuid,uuid)'),
    ('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'),
    ('public.get_student_portal_sessions(uuid)'),
    ('public.get_student_portal_attendance(uuid)'),
    ('public.get_mobile_student_home()'),
    ('public.get_mobile_bootstrap()'),
    ('public.get_mobile_notifications(integer,integer)'),
    ('public.get_mobile_offline_manifest()'),
    ('public.ux4b_can_read_student_finance(uuid,uuid,uuid)'),
    ('public.finance_student_can_access(uuid,uuid)')
), verified_functions as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'signature', ef.signature,
    'installed', p.oid is not null,
    'security_definer', coalesce(p.prosecdef, false),
    'search_path', coalesce(p.proconfig, array[]::text[]),
    'authenticated_execute', case when p.oid is null then false
      else has_function_privilege('authenticated', p.oid, 'EXECUTE') end,
    'anon_execute', case when p.oid is null then false
      else has_function_privilege('anon', p.oid, 'EXECUTE') end,
    'service_role_execute', case when p.oid is null then false
      else has_function_privilege('service_role', p.oid, 'EXECUTE') end,
    'public_execute', case when p.oid is null then false else exists (
      select 1 from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) end
  ) order by ef.signature), '[]'::jsonb) value
  from expected_functions ef
  left join pg_catalog.pg_proc p on p.oid = to_regprocedure(ef.signature)
), status_counts as (
  select jsonb_build_object(
    'students', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) n from public.students group by status) q),
    'portal_accounts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) n from public.student_portal_accounts group by status) q),
    'enrollments', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) n from public.enrollments group by status) q)
  ) value
), integrity_counts as (
  select jsonb_build_object(
    'unsupported_student_statuses', (select count(*) from public.students
      where status not in ('active', 'inactive', 'lead', 'blocked')),
    'unsupported_enrollment_statuses', (select count(*) from public.enrollments
      where status not in ('active', 'completed', 'paused', 'cancelled')),
    'unsupported_portal_statuses', (select count(*) from public.student_portal_accounts
      where status not in ('active', 'pending', 'revoked')),
    'duplicate_enrollment_groups', (select count(*) from (
      select 1 from public.enrollments group by tenant_id, student_id, course_id
      having count(*) > 1
    ) q),
    'active_enrollment_non_active_student', (select count(*)
      from public.enrollments e join public.students s
        on s.tenant_id = e.tenant_id and s.id = e.student_id
      where e.status = 'active' and s.status <> 'active'),
    'active_enrollment_portal_disabled_student', (select count(*)
      from public.enrollments e join public.students s
        on s.tenant_id = e.tenant_id and s.id = e.student_id
      where e.status = 'active' and s.portal_enabled = false),
    'active_portal_non_active_student', (select count(*)
      from public.student_portal_accounts spa join public.students s
        on s.tenant_id = spa.tenant_id and s.id = spa.student_id
      where spa.status = 'active' and s.status <> 'active'),
    'active_portal_disabled_student', (select count(*)
      from public.student_portal_accounts spa join public.students s
        on s.tenant_id = spa.tenant_id and s.id = spa.student_id
      where spa.status = 'active' and s.portal_enabled = false),
    'paused_with_active_portal_identity', (select count(*)
      from public.enrollments e
      join public.students s
        on s.tenant_id = e.tenant_id and s.id = e.student_id
      join public.student_portal_accounts spa
        on spa.tenant_id = s.tenant_id and spa.student_id = s.id
      where e.status = 'paused'
        and s.status = 'active'
        and s.portal_enabled = true
        and spa.status = 'active'),
    'cancelled_with_active_portal_identity', (select count(*)
      from public.enrollments e
      join public.students s
        on s.tenant_id = e.tenant_id and s.id = e.student_id
      join public.student_portal_accounts spa
        on spa.tenant_id = s.tenant_id and spa.student_id = s.id
      where e.status = 'cancelled'
        and s.status = 'active'
        and s.portal_enabled = true
        and spa.status = 'active'),
    'completed_without_completed_at', (select count(*)
      from public.enrollments e
      where e.status = 'completed' and e.completed_at is null),
    'non_completed_with_completed_at', (select count(*)
      from public.enrollments e
      where e.status <> 'completed' and e.completed_at is not null)
  ) value
), expected_student_policies(tablename, policyname) as (
  values
    ('student_portal_accounts', 'Students can read own portal account'),
    ('tenants', 'Linked students can read portal tenant'),
    ('students', 'Linked students can read own student record'),
    ('enrollments', 'Linked students can read own enrollments'),
    ('courses', 'Linked students can read enrolled courses'),
    ('course_sections', 'Linked students can read enrolled course sections'),
    ('lessons', 'Linked students can read enrolled lessons'),
    ('lesson_progress', 'Linked students can read own lesson progress'),
    ('cohort_members', 'Linked students can read own cohort memberships'),
    ('cohorts', 'Linked students can read own cohorts'),
    ('sessions', 'Linked students can read own sessions'),
    ('attendance_records', 'Linked students can read own attendance records'),
    ('assignments', 'Linked students can read assigned assignments'),
    ('assignment_submissions', 'Linked students can read own assignment submissions')
), touched_tables(tablename) as (
  values
    ('student_portal_accounts'), ('tenants'), ('students'), ('enrollments'),
    ('courses'), ('course_sections'), ('lessons'), ('lesson_progress'),
    ('cohort_members'), ('cohorts'), ('sessions'), ('attendance_records'),
    ('assignments'), ('assignment_submissions'), ('payments'), ('payment_links')
), policy_rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', tablename, 'policy', policyname,
    'permissive', permissive, 'command', cmd,
    'roles', roles, 'using', qual, 'with_check', with_check
  ) order by tablename, policyname), '[]'::jsonb) value
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in (select tablename from touched_tables)
), policy_integrity as (
  select jsonb_build_object(
    'rls_disabled_tables', (select coalesce(jsonb_agg(tt.tablename), '[]'::jsonb)
      from touched_tables tt
      join pg_catalog.pg_class c on c.relname = tt.tablename
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where not c.relrowsecurity),
    'canonical_policy_missing_or_not_status_aware', (select count(*)
      from expected_student_policies ep
      left join pg_catalog.pg_policies p
        on p.schemaname = 'public'
       and p.tablename = ep.tablename
       and p.policyname = ep.policyname
      where p.policyname is null
         or (coalesce(p.qual, '') not like '%student_portal_access_allowed%'
             and coalesce(p.qual, '') not like '%has_any_active_student_portal_account%')),
    'unexpected_student_policy_bypasses', (select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename in (select tablename from touched_tables
          where tablename not in ('payments', 'payment_links'))
        and p.cmd = 'SELECT'
        and p.permissive = 'PERMISSIVE'
        and (p.policyname like 'Linked students can read%'
          or p.policyname like 'Students can read%portal%')
        and (p.tablename, p.policyname) not in (
          select tablename, policyname from expected_student_policies
        )),
    'finance_restrictive_policies', (select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.policyname in (
          'UX4B authorized student finance reads',
          'UX4B authorized student payment-link reads'
        )
        and p.permissive = 'RESTRICTIVE' and p.cmd = 'SELECT')
  ) value
), grant_counts as (
  select jsonb_build_object(
    'dangerous', count(*) filter (where privilege_type in (
      'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
    )),
    'student_enrollment_browser_writes', count(*) filter (
      where table_name in ('students', 'enrollments')
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    )
  ) value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'student_portal_accounts', 'tenants', 'students', 'enrollments',
      'courses', 'course_sections', 'lessons', 'lesson_progress',
      'cohort_members', 'cohorts', 'sessions', 'attendance_records',
      'assignments', 'assignment_submissions', 'payments', 'payment_links'
    )
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
)
select jsonb_pretty(jsonb_build_object(
  'functions', (select value from verified_functions),
  'status_counts', (select value from status_counts),
  'integrity_counts', (select value from integrity_counts),
  'trainer_scope', jsonb_build_object(
    'trainer_members', (select count(*) from public.tenant_members where role = 'trainer'),
    'course_assignments', (select count(*) from public.trainer_course_assignments),
    'cohort_assignments', (select count(*) from public.trainer_cohort_assignments),
    'trainers_without_assignments', (select count(*)
      from public.tenant_members tm
      where tm.role = 'trainer'
        and not exists (select 1 from public.trainer_course_assignments tca
          where tca.tenant_id = tm.tenant_id
            and tca.trainer_user_id = tm.user_id)
        and not exists (select 1 from public.trainer_cohort_assignments tcoa
          where tcoa.tenant_id = tm.tenant_id
            and tcoa.trainer_user_id = tm.user_id)),
    'trainer_student_enrollment_audit_events', (select count(*)
      from public.audit_logs al
      join public.tenant_members tm
        on tm.tenant_id = al.tenant_id and tm.user_id = al.user_id
      where tm.role = 'trainer'
        and al.action in (
          'student_created', 'student_updated',
          'enrollment_created', 'enrollment_updated',
          'cohort_member_added', 'cohort_member_removed'
        )),
    'active_view_payments_delegations', (select count(*)
      from public.delegated_permissions dp
      where dp.permission_key = 'view_payments'
        and dp.status = 'active'
        and dp.starts_at <= now()
        and (dp.expires_at is null or dp.expires_at > now())),
    'trainer_view_payments_delegations', (select count(*)
      from public.delegated_permissions dp
      join public.tenant_members tm
        on tm.tenant_id = dp.tenant_id and tm.user_id = dp.user_id
      where tm.role = 'trainer'
        and dp.permission_key = 'view_payments'
        and dp.status = 'active'
        and dp.starts_at <= now()
        and (dp.expires_at is null or dp.expires_at > now()))
  ),
  'policies', (select value from policy_rows),
  'policy_integrity', (select value from policy_integrity),
  'grants', (select value from grant_counts),
  'access_contract', jsonb_build_object(
    'active', 'course_read_and_participation',
    'completed', 'historical_read_only',
    'paused', 'no_learning_access',
    'cancelled', 'no_learning_access'
  )
)) as verification_result;
