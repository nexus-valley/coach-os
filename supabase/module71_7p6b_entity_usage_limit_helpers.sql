-- Module 71.7P6B: Canonical Entity Usage Count + SQL Enforcement Helpers
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Add live, tenant-scoped entity usage count visibility.
-- - Add a hard canonical entity limit assertion helper for future secure RPC
--   integration.
-- - Do not mutate students, courses, cohorts, team members, invitations,
--   subscription assignments, request options, public plan visibility,
--   checkout, or payment gateway state.
--
-- Design notes:
-- - This module intentionally does not patch create_student_secure,
--   create_course_secure, create_cohort_secure, create_team_invitation_secure,
--   accept_team_invitation, or update_tenant_member_role_secure yet.
-- - Counts are live table counts, not tenant_usage_snapshots.
-- - "batches" is currently aliased to cohorts because the app uses Cohorts as
--   batch management. If a separate batch entity is introduced later, update
--   this helper before enforcing that resource independently.

begin;

create or replace function public.get_tenant_entity_usage_counts(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_students_count integer := 0;
  v_courses_count integer := 0;
  v_cohorts_count integer := 0;
  v_admins_count integer := 0;
  v_staff_trainers_count integer := 0;
  v_team_members_count integer := 0;
  v_pending_team_invitations_count integer := 0;
  v_pending_admin_invitations_count integer := 0;
  v_pending_staff_trainer_invitations_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Entity usage access denied.' using errcode = '42501';
  end if;

  select count(*)::integer
  into v_students_count
  from public.students s
  where s.tenant_id = p_tenant_id;

  select count(*)::integer
  into v_courses_count
  from public.courses c
  where c.tenant_id = p_tenant_id;

  select count(*)::integer
  into v_cohorts_count
  from public.cohorts c
  where c.tenant_id = p_tenant_id;

  select
    count(*) filter (where tm.role = 'admin')::integer,
    count(*) filter (where tm.role in ('staff', 'trainer'))::integer,
    count(*)::integer
  into
    v_admins_count,
    v_staff_trainers_count,
    v_team_members_count
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id;

  select
    count(*)::integer,
    count(*) filter (where ti.role = 'admin')::integer,
    count(*) filter (where ti.role in ('staff', 'trainer'))::integer
  into
    v_pending_team_invitations_count,
    v_pending_admin_invitations_count,
    v_pending_staff_trainer_invitations_count
  from public.team_invitations ti
  where ti.tenant_id = p_tenant_id
    and ti.status = 'pending'
    and ti.expires_at > now();

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'students_count', coalesce(v_students_count, 0),
    'courses_count', coalesce(v_courses_count, 0),
    'cohorts_count', coalesce(v_cohorts_count, 0),
    'batches_count', coalesce(v_cohorts_count, 0),
    'admins_count', coalesce(v_admins_count, 0),
    'staff_trainers_count', coalesce(v_staff_trainers_count, 0),
    'team_members_count', coalesce(v_team_members_count, 0),
    'pending_team_invitations_count', coalesce(v_pending_team_invitations_count, 0),
    'pending_admin_invitations_count', coalesce(v_pending_admin_invitations_count, 0),
    'pending_staff_trainer_invitations_count', coalesce(v_pending_staff_trainer_invitations_count, 0),
    'batches_count_source', 'cohorts',
    'source', 'canonical_live_entity_usage_counts'
  );
end;
$$;

create or replace function public.assert_tenant_entity_usage_limit(
  p_tenant_id uuid,
  p_resource_key text,
  p_requested_delta integer default 1,
  p_include_pending_invitations boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource_key text := lower(trim(coalesce(p_resource_key, '')));
  v_requested_delta integer := coalesce(p_requested_delta, 1);
  v_counts jsonb;
  v_plan_id uuid;
  v_limit record;
  v_override record;
  v_effective_limit integer;
  v_current_count integer := 0;
  v_pending_count integer := 0;
  v_projected_count integer;
  v_remaining_after integer;
  v_warning boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if v_requested_delta < 0 then
    raise exception 'Requested delta cannot be negative.' using errcode = '22023';
  end if;

  if v_resource_key not in (
    'students',
    'courses',
    'cohorts',
    'batches',
    'admins',
    'staff_trainers',
    'team_members'
  ) then
    raise exception 'Invalid entity resource key.' using errcode = '22023';
  end if;

  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Entity usage limit access denied.' using errcode = '42501';
  end if;

  -- Protect concurrent checks when this helper is called inside future secure
  -- mutation RPCs. This does not protect callers that check outside the
  -- mutation transaction.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'entity_usage_limit:' || p_tenant_id::text || ':' || v_resource_key,
      7176
    )
  );

  select tsa.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments tsa
  where tsa.tenant_id = p_tenant_id
    and tsa.is_current
  order by tsa.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'A canonical subscription assignment is required before entity limits can be enforced.'
      using errcode = '22023';
  end if;

  select *
  into v_limit
  from public.subscription_plan_usage_limits spl
  where spl.plan_id = v_plan_id
    and spl.resource_key = v_resource_key;

  if not found then
    raise exception 'Canonical entity limit is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  select *
  into v_override
  from public.tenant_subscription_overrides tso
  where tso.tenant_id = p_tenant_id
    and tso.resource_key = v_resource_key
    and tso.override_type in ('limit_raise', 'limit_lower')
    and (tso.expires_at is null or tso.expires_at > now())
  order by tso.created_at desc
  limit 1;

  v_effective_limit := v_limit.limit_value;

  if found and (v_override.override_value_json ? 'limit_value') then
    v_effective_limit := nullif(v_override.override_value_json->>'limit_value', '')::integer;
  end if;

  if v_effective_limit is null then
    raise exception 'Unlimited entity limits are not supported for this enforcement helper yet.'
      using errcode = '22023';
  end if;

  if v_effective_limit < 0 then
    raise exception 'Canonical entity limit is invalid.'
      using errcode = '22023';
  end if;

  v_counts := public.get_tenant_entity_usage_counts(p_tenant_id);

  v_current_count := case v_resource_key
    when 'students' then coalesce((v_counts->>'students_count')::integer, 0)
    when 'courses' then coalesce((v_counts->>'courses_count')::integer, 0)
    when 'cohorts' then coalesce((v_counts->>'cohorts_count')::integer, 0)
    when 'batches' then coalesce((v_counts->>'batches_count')::integer, 0)
    when 'admins' then coalesce((v_counts->>'admins_count')::integer, 0)
    when 'staff_trainers' then coalesce((v_counts->>'staff_trainers_count')::integer, 0)
    when 'team_members' then coalesce((v_counts->>'team_members_count')::integer, 0)
    else 0
  end;

  if coalesce(p_include_pending_invitations, false) then
    v_pending_count := case v_resource_key
      when 'admins' then coalesce((v_counts->>'pending_admin_invitations_count')::integer, 0)
      when 'staff_trainers' then coalesce((v_counts->>'pending_staff_trainer_invitations_count')::integer, 0)
      when 'team_members' then coalesce((v_counts->>'pending_team_invitations_count')::integer, 0)
      else 0
    end;
  end if;

  v_current_count := v_current_count + v_pending_count;
  v_projected_count := v_current_count + v_requested_delta;
  v_remaining_after := greatest(v_effective_limit - v_projected_count, 0);

  if v_limit.enforcement_mode = 'hard' and v_projected_count > v_effective_limit then
    raise exception 'Canonical entity usage limit exceeded for %. Current %, requested %, limit %.',
      v_resource_key,
      v_current_count,
      v_requested_delta,
      v_effective_limit
      using errcode = '22023';
  end if;

  v_warning :=
    v_effective_limit > 0
    and v_projected_count >= ceil(v_effective_limit * (coalesce(v_limit.warning_threshold_percent, 80)::numeric / 100));

  return jsonb_build_object(
    'allowed', true,
    'tenant_id', p_tenant_id,
    'resource_key', v_resource_key,
    'current_count', v_current_count,
    'pending_count_included', v_pending_count,
    'requested_delta', v_requested_delta,
    'projected_count', v_projected_count,
    'limit_value', v_effective_limit,
    'base_limit_value', v_limit.limit_value,
    'remaining_after', v_remaining_after,
    'warning', v_warning,
    'enforcement_mode', v_limit.enforcement_mode,
    'warning_threshold_percent', v_limit.warning_threshold_percent,
    'include_pending_invitations', coalesce(p_include_pending_invitations, false),
    'batches_count_source', case when v_resource_key = 'batches' then 'cohorts' else null end,
    'source', 'canonical_live_entity_usage_limit'
  );
end;
$$;

revoke all on function public.get_tenant_entity_usage_counts(uuid) from public, anon, authenticated;
revoke all on function public.assert_tenant_entity_usage_limit(uuid, text, integer, boolean) from public, anon, authenticated;

grant execute on function public.get_tenant_entity_usage_counts(uuid) to authenticated;
grant execute on function public.assert_tenant_entity_usage_limit(uuid, text, integer, boolean) to authenticated;

commit;

-- Future integration guidance for P6C/P6D review only:
--
-- create_student_secure:
--   perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'students', 1, false);
--
-- create_course_secure:
--   perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'courses', 1, false);
--
-- create_cohort_secure:
--   perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'cohorts', 1, false);
--   Product decision still needed before also enforcing 'batches', because
--   batches currently aliases cohorts.
--
-- create_team_invitation_secure:
--   perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'team_members', 1, true);
--   if v_role = 'admin' then
--     perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'admins', 1, true);
--   elsif v_role in ('staff', 'trainer') then
--     perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'staff_trainers', 1, true);
--   end if;
--
-- accept_team_invitation:
--   Re-check team_members plus the accepted role resource because acceptance can
--   create a tenant_member or upgrade an existing non-owner member.
--
-- update_tenant_member_role_secure:
--   Check only when a role transition increases a constrained count, for
--   example non-admin -> admin or non-staff/trainer -> staff/trainer.

-- Verification SQL for later review/execution only:
--
-- 1. Confirm RPCs exist:
-- select routine_name
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name in (
--     'get_tenant_entity_usage_counts',
--     'assert_tenant_entity_usage_limit'
--   )
-- order by routine_name;
--
-- 2. Confirm execute grants are authenticated-only for the new RPCs:
-- select grantee, routine_name, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name in (
--     'get_tenant_entity_usage_counts',
--     'assert_tenant_entity_usage_limit'
--   )
-- order by routine_name, grantee;
--
-- 3. Confirm direct table writes remain revoked for app entity tables:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in (
--     'students',
--     'courses',
--     'cohorts',
--     'cohort_members',
--     'team_invitations',
--     'tenant_members'
--   )
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
--   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
-- order by table_name, grantee, privilege_type;
--
-- 4. Regression tenant live count shape:
-- select public.get_tenant_entity_usage_counts(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 5. Small allowed assertion smoke, if current usage is below limit:
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'students',
--   1,
--   false
-- );
--
-- 6. Artificial high delta rejection smoke:
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'students',
--   1000000,
--   false
-- );
--
-- 7. Pending invitation-aware team member check:
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'team_members',
--   1,
--   true
-- );
--
-- 8. Confirm public catalog remains empty:
-- select public.get_public_plan_catalog();
--
-- 9. Confirm regression assignment unchanged:
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- 10. Confirm Growth request remains approved/blocked:
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- Rollback SQL for later review only:
-- begin;
-- revoke all on function public.assert_tenant_entity_usage_limit(uuid, text, integer, boolean) from public, anon, authenticated;
-- revoke all on function public.get_tenant_entity_usage_counts(uuid) from public, anon, authenticated;
-- drop function if exists public.assert_tenant_entity_usage_limit(uuid, text, integer, boolean);
-- drop function if exists public.get_tenant_entity_usage_counts(uuid);
-- commit;
