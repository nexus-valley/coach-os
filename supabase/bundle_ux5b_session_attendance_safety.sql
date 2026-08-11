-- Bundle UX-5B: canonical session and attendance safety contract.
--
-- This additive migration changes future authorization and mutation behavior.
-- It does not rewrite sessions, attendance, students, or enrollment history.

-- PRE-APPLY (read-only): run separately before applying this migration.
/*
with policy_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', p.tablename, 'policy', p.policyname, 'command', p.cmd,
    'roles', p.roles, 'using', p.qual, 'check', p.with_check
  ) order by p.tablename, p.policyname), '[]'::jsonb) value
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sessions', 'attendance_records')
), table_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname, 'owner', owner_role.rolname,
    'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity,
    'postgres_bypass_safe', helper_owner.rolsuper
      or helper_owner.rolbypassrls
      or (c.relowner = helper_owner.oid and not c.relforcerowsecurity)
  ) order by c.relname), '[]'::jsonb) value
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = c.relowner
  cross join pg_catalog.pg_roles helper_owner
  where n.nspname = 'public'
    and c.relname in (
      'sessions','attendance_records','students','enrollments','cohorts',
      'cohort_members','tenant_members','trainer_course_assignments',
      'trainer_cohort_assignments','student_portal_accounts'
    )
    and helper_owner.rolname = 'postgres'
), expected_functions(expected_identity) as (
  values
    ('public.update_session_status_secure(uuid,uuid,text)'),
    ('public.update_delegated_session_status(uuid,uuid,text)'),
    ('public.mark_attendance_secure(uuid,uuid,uuid,text,text)'),
    ('public.bulk_mark_attendance_secure(uuid,uuid,jsonb)'),
    ('public.mark_delegated_attendance(uuid,uuid,uuid,text,text)'),
    ('public.get_reports_center_data(uuid,text,jsonb)'),
    ('public.get_student_portal_sessions(uuid)'),
    ('public.get_student_portal_attendance(uuid)'),
    ('public.get_mobile_student_home()'),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    ('public.m69_3_assert_manage_attendance(uuid)'),
    ('public.m69_3_assert_can_manage_scope(uuid,text,uuid,uuid,uuid,boolean)'),
    ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
    ('public.is_tenant_member(uuid,uuid)'),
    ('public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
    ('public.m69_3_validate_session_status(text)'),
    ('public.m69_3_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'),
    ('public.mobile_tenant_branding_json(tenants)'),
    ('public.reports_validate_filters(uuid,jsonb)')
), resolved_functions as (
  select ef.expected_identity, to_regprocedure(ef.expected_identity) function_oid
  from expected_functions ef
), function_acl as (
  select rf.function_oid,
    coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false)
      public_execute,
    coalesce(bool_or(grantee_role.rolname = 'anon'
      and a.privilege_type = 'EXECUTE'), false) anon_execute,
    coalesce(bool_or(grantee_role.rolname = 'authenticated'
      and a.privilege_type = 'EXECUTE'), false) authenticated_execute,
    coalesce(bool_or(grantee_role.rolname = 'service_role'
      and a.privilege_type = 'EXECUTE'), false) service_role_execute
  from resolved_functions rf
  join pg_catalog.pg_proc p on p.oid = rf.function_oid
  cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
  ) a
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = a.grantee
  group by rf.function_oid
), function_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'expected_identity', rf.expected_identity,
    'exists', p.oid is not null,
    'installed_identity', case when p.oid is null then null else format(
      '%I.%I(%s)', function_schema.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) end,
    'owner', owner_role.rolname,
    'security_definer', p.prosecdef,
    'volatility', p.provolatile,
    'search_path', p.proconfig,
    'acl', p.proacl,
    'public_execute', coalesce(fa.public_execute, false),
    'anon_execute', coalesce(fa.anon_execute, false),
    'authenticated_execute', coalesce(fa.authenticated_execute, false),
    'service_role_execute', coalesce(fa.service_role_execute, false)
  ) order by rf.expected_identity), '[]'::jsonb) value
  from resolved_functions rf
  left join pg_catalog.pg_proc p on p.oid = rf.function_oid
  left join pg_catalog.pg_namespace function_schema
    on function_schema.oid = p.pronamespace
  left join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
  left join function_acl fa on fa.function_oid = p.oid
), grant_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', tp.table_name, 'grantee', tp.grantee,
    'privilege', tp.privilege_type
  ) order by tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb) value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('sessions','attendance_records')
    and tp.grantee in ('PUBLIC','anon','authenticated','service_role')
), session_counts as (
  select coalesce(jsonb_object_agg(status, total), '{}'::jsonb) value
  from (select status, count(*) total from public.sessions group by status) q
), policy_dependency_state as (
  select
    count(*) filter (
      where p.tablename = 'attendance_records'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%sessions%'
    ) attendance_policies_referencing_sessions,
    count(*) filter (
      where p.tablename = 'sessions'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%attendance_records%'
    ) session_policies_referencing_attendance
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sessions','attendance_records')
), risk_state as (
  select jsonb_build_object(
    'student_direct_session_policy', exists (
      select 1 from pg_catalog.pg_policies where schemaname = 'public'
        and tablename = 'sessions'
        and policyname = 'Linked students can read own sessions'
    ),
    'student_direct_attendance_policy', exists (
      select 1 from pg_catalog.pg_policies where schemaname = 'public'
        and tablename = 'attendance_records'
        and policyname = 'Linked students can read own attendance records'
    ),
    'trainer_stale_owner_policy', exists (
      select 1 from pg_catalog.pg_policies where schemaname = 'public'
        and tablename in ('sessions','attendance_records') and cmd = 'SELECT'
        and lower(coalesce(qual,'')) like '%trainer_user_id = auth.uid()%'
    ),
    'attendance_on_canceled_sessions', (
      select count(*) from public.attendance_records ar
      join public.sessions s on s.tenant_id = ar.tenant_id and s.id = ar.session_id
      where s.status = 'canceled'
    ),
    'attendance_currently_ineligible_for_new_row', (
      select count(*) from public.attendance_records ar
      join public.sessions ses on ses.tenant_id = ar.tenant_id and ses.id = ar.session_id
      join public.students st on st.tenant_id = ar.tenant_id and st.id = ar.student_id
      left join public.cohorts coh on coh.tenant_id = ses.tenant_id and coh.id = ses.cohort_id
      where st.status <> 'active'
         or not exists (
           select 1 from public.enrollments e
           where e.tenant_id = ar.tenant_id and e.student_id = ar.student_id
             and e.course_id = case when ses.cohort_id is not null
               then coh.course_id else ses.course_id end
             and e.status = 'active'
         )
         or (ses.cohort_id is not null and not exists (
           select 1 from public.cohort_members cm
           where cm.tenant_id = ar.tenant_id and cm.cohort_id = ses.cohort_id
             and cm.student_id = ar.student_id
         ))
    ),
    'browser_write_grants', (
      select count(*) from information_schema.table_privileges
      where table_schema = 'public'
        and table_name in ('sessions','attendance_records')
        and grantee in ('PUBLIC','anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE')
    ),
    'attendance_policies_referencing_sessions', (
      select attendance_policies_referencing_sessions
      from policy_dependency_state
    ),
    'session_policies_referencing_attendance', (
      select session_policies_referencing_attendance
      from policy_dependency_state
    ),
    'actual_sessions_attendance_reciprocal_cycle', (
      select attendance_policies_referencing_sessions > 0
        and session_policies_referencing_attendance > 0
      from policy_dependency_state
    ),
    'internal_schema_api_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1 from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(setting,'=',2),','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) value
)
select jsonb_build_object(
  'policies', (select value from policy_state),
  'tables', (select value from table_state),
  'functions', (select value from function_state),
  'direct_grants', (select value from grant_state),
  'session_status_counts', (select value from session_counts),
  'risk', (select value from risk_state)
) as preflight_result;
*/

begin;

do $$
begin
  if to_regprocedure('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.get_student_portal_sessions(uuid)') is null
     or to_regprocedure('public.get_student_portal_attendance(uuid)') is null
     or to_regprocedure('public.m69_3_assert_manage_attendance(uuid)') is null
     or to_regprocedure(
       'public.m69_3_assert_can_manage_scope(uuid,text,uuid,uuid,uuid,boolean)'
     ) is null then
    raise exception
      'UX-5B cannot install: required portal or session authorization helpers are missing.'
      using errcode = '42501';
  end if;
end;
$$;

create schema if not exists coachfort_internal authorization postgres;
revoke all on schema coachfort_internal
from public, anon, authenticated, service_role;
grant usage on schema coachfort_internal to authenticated;

create or replace function coachfort_internal.trainer_can_access_session(
  p_tenant_id uuid,
  p_user_id uuid,
  p_session_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_cohort_course_id uuid;
  v_effective_course_id uuid;
begin
  if p_tenant_id is null or p_user_id is null or p_session_id is null
     or auth.uid() is null or p_user_id is distinct from auth.uid()
     or not exists (
       select 1 from public.tenant_members tm
       where tm.tenant_id = p_tenant_id and tm.user_id = p_user_id
         and tm.role = 'trainer'
     ) then
    return false;
  end if;

  select s.* into v_session
  from public.sessions s
  where s.tenant_id = p_tenant_id and s.id = p_session_id;

  if not found then
    return false;
  end if;

  if v_session.cohort_id is not null then
    select c.course_id into v_cohort_course_id
    from public.cohorts c
    where c.tenant_id = p_tenant_id
      and c.id = v_session.cohort_id;
  end if;

  v_effective_course_id := coalesce(
    v_session.course_id, v_cohort_course_id
  );

  return exists (
    select 1 from public.trainer_course_assignments tca
    where tca.tenant_id = p_tenant_id and tca.trainer_user_id = p_user_id
      and tca.course_id = v_effective_course_id
  ) or exists (
    select 1 from public.trainer_cohort_assignments tca
    where tca.tenant_id = p_tenant_id and tca.trainer_user_id = p_user_id
      and tca.cohort_id = v_session.cohort_id
  );
end;
$$;

alter function coachfort_internal.trainer_can_access_session(uuid,uuid,uuid)
owner to postgres;

do $$
declare
  v_unsafe_tables text[];
begin
  select array_agg(c.relname order by c.relname) into v_unsafe_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join pg_catalog.pg_roles helper_owner
  where n.nspname = 'public'
    and c.relname in (
      'tenant_members','sessions','cohorts','trainer_course_assignments',
      'trainer_cohort_assignments'
    )
    and helper_owner.rolname = 'postgres'
    and not (
      helper_owner.rolsuper or helper_owner.rolbypassrls
      or (c.relowner = helper_owner.oid and not c.relforcerowsecurity)
    );

  if coalesce(cardinality(v_unsafe_tables),0) > 0 then
    raise exception 'UX-5B cannot install: helper owner cannot bypass RLS for %.',
      array_to_string(v_unsafe_tables, ', ') using errcode = '42501';
  end if;

  if coalesce(
    'coachfort_internal' = any(regexp_split_to_array(
      replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
    )), false
  ) or exists (
    select 1 from pg_catalog.pg_db_role_setting rs
    join pg_catalog.pg_roles r on r.oid = rs.setrole
    cross join lateral unnest(rs.setconfig) settings(setting)
    cross join lateral regexp_split_to_table(split_part(setting,'=',2),',') exposed(schema_name)
    where r.rolname = 'authenticator' and setting like 'pgrst.db_schemas=%'
      and btrim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'UX-5B cannot install: internal helper schema is API-exposed.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function coachfort_internal.trainer_can_access_session(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function coachfort_internal.trainer_can_access_session(uuid,uuid,uuid)
to authenticated;

alter table public.sessions enable row level security;
alter table public.attendance_records enable row level security;

drop policy if exists "Linked students can read own sessions" on public.sessions;
drop policy if exists "Trainer can read assigned sessions" on public.sessions;
create policy "Trainer can read assigned sessions"
on public.sessions for select to authenticated
using ((select coachfort_internal.trainer_can_access_session(
  sessions.tenant_id, auth.uid(), sessions.id
)));

drop policy if exists "Linked students can read own attendance records"
on public.attendance_records;
drop policy if exists "Trainer can read assigned attendance records"
on public.attendance_records;
create policy "Trainer can read assigned attendance records"
on public.attendance_records for select to authenticated
using ((select coachfort_internal.trainer_can_access_session(
  attendance_records.tenant_id, auth.uid(), attendance_records.session_id
)));

create or replace function public.update_session_status_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_status text
)
returns public.sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_existing public.sessions%rowtype;
  v_session public.sessions%rowtype;
  v_status text;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);
  select s.* into v_existing
  from public.sessions s
  where s.tenant_id = p_tenant_id and s.id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found in this workspace.' using errcode = '22023';
  end if;

  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    v_existing.course_id,
    v_existing.cohort_id,
    v_existing.trainer_user_id,
    false
  );

  v_status := public.m69_3_validate_session_status(p_status);

  if v_status not in ('completed', 'canceled') then
    raise exception 'Session status action must be completed or canceled.' using errcode = '22023';
  end if;

  if v_existing.status <> 'scheduled' then
    raise exception 'Only scheduled sessions can be completed or canceled.'
      using errcode = '22023';
  end if;

  update public.sessions as s
  set status = v_status
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
  returning * into v_session;

  perform public.m69_3_write_audit(
    p_tenant_id,
    case when v_status = 'canceled' then 'session_canceled' else 'session_completed' end,
    'session',
    v_session.id,
    'Session',
    'Updated class session status',
    case when v_status = 'canceled' then 'warning' else 'info' end,
    jsonb_build_object(
      'sessionId', v_session.id,
      'courseId', v_session.course_id,
      'cohortId', v_session.cohort_id,
      'deliveryMode', v_session.delivery_mode,
      'meetingProvider', v_session.meeting_provider,
      'status', v_session.status
    )
  );

  return v_session;
end;
$$;
alter function public.update_session_status_secure(uuid,uuid,text) owner to postgres;
revoke all on function public.update_session_status_secure(uuid,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.update_session_status_secure(uuid,uuid,text)
to authenticated;

create or replace function public.update_delegated_session_status(
  p_tenant_id uuid,
  p_session_id uuid,
  p_status text
)
returns public.sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  session_row public.sessions%rowtype;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to update sessions.';
  end if;

  if p_status not in ('completed', 'canceled') then
    raise exception 'Unsupported session status.';
  end if;

  select *
  into session_row
  from public.sessions
  where id = p_session_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Session not found in this workspace.' using errcode = '22023';
  end if;

  if session_row.status <> 'scheduled' then
    raise exception 'Only scheduled sessions can be completed or canceled.'
      using errcode = '22023';
  end if;

  matched_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['manage_sessions'],
    session_row.course_id,
    session_row.cohort_id,
    null,
    session_row.id,
    null
  );

  if matched_permission_id is null then
    raise exception 'You do not have delegated permission to update this session.';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

  update public.sessions
  set status = p_status
  where id = p_session_id
    and tenant_id = p_tenant_id
  returning * into session_row;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    case when p_status = 'completed'
      then 'session_completed'
      else 'session_canceled'
    end,
    'session',
    session_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return session_row;
end;
$$;

alter function public.update_delegated_session_status(uuid,uuid,text) owner to postgres;
revoke all on function public.update_delegated_session_status(uuid,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.update_delegated_session_status(uuid,uuid,text)
to authenticated;


create or replace function public.m69_3_assert_student_in_session_roster(
  p_tenant_id uuid,
  p_session public.sessions,
  p_student_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_course_id uuid;
begin
  if p_tenant_id is null or p_student_id is null or p_session.id is null
     or p_session.tenant_id is distinct from p_tenant_id then
    raise exception 'Invalid attendance scope.' using errcode = '22023';
  end if;

  if p_session.status = 'canceled' then
    raise exception 'Attendance cannot be changed for a canceled session.'
      using errcode = '22023';
  end if;

  if p_session.status not in ('scheduled','completed') then
    raise exception 'Attendance cannot be changed for this session status.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.students st
    where st.tenant_id = p_tenant_id and st.id = p_student_id
  ) then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  -- Existing rows remain correctable after later enrollment/status changes.
  if exists (
    select 1 from public.attendance_records ar
    where ar.tenant_id = p_tenant_id and ar.session_id = p_session.id
      and ar.student_id = p_student_id
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.students st
    where st.tenant_id = p_tenant_id and st.id = p_student_id
      and st.status = 'active'
  ) then
    raise exception 'New attendance requires an active student.'
      using errcode = '42501';
  end if;

  if p_session.cohort_id is not null then
    select c.course_id into v_course_id
    from public.cohorts c
    where c.tenant_id = p_tenant_id and c.id = p_session.cohort_id;

    if not found or v_course_id is null
       or (p_session.course_id is not null
         and p_session.course_id is distinct from v_course_id)
       or not exists (
         select 1 from public.cohort_members cm
         where cm.tenant_id = p_tenant_id
           and cm.cohort_id = p_session.cohort_id
           and cm.student_id = p_student_id
       ) then
      raise exception 'New attendance requires membership in this session cohort.'
        using errcode = '42501';
    end if;
  else
    v_course_id := p_session.course_id;
  end if;

  if v_course_id is null or not exists (
    select 1 from public.enrollments e
    where e.tenant_id = p_tenant_id and e.course_id = v_course_id
      and e.student_id = p_student_id and e.status = 'active'
  ) then
    raise exception 'New attendance requires an active matching enrollment.'
      using errcode = '42501';
  end if;
end;
$$;

alter function public.m69_3_assert_student_in_session_roster(
  uuid,public.sessions,uuid
) owner to postgres;
revoke all on function public.m69_3_assert_student_in_session_roster(
  uuid,public.sessions,uuid
) from public, anon, authenticated, service_role;

create or replace function public.mark_delegated_attendance(
  p_tenant_id uuid,
  p_session_id uuid,
  p_student_id uuid,
  p_status text,
  p_remarks text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  session_row public.sessions%rowtype;
  attendance_row public.attendance_records%rowtype;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to mark attendance.';
  end if;

  if p_status not in ('present', 'absent', 'late', 'excused') then
    raise exception 'Unsupported attendance status.';
  end if;

  select *
  into session_row
  from public.sessions
  where id = p_session_id
    and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Session not found in this workspace.';
  end if;

  perform public.m69_3_assert_student_in_session_roster(
    p_tenant_id, session_row, p_student_id
  );

  matched_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['edit_attendance', 'edit_attendance_after_lock'],
    session_row.course_id,
    session_row.cohort_id,
    p_student_id,
    session_row.id,
    null
  );

  if matched_permission_id is null then
    raise exception 'You do not have delegated permission to mark this attendance.';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

  insert into public.attendance_records (
    tenant_id,
    session_id,
    student_id,
    status,
    remarks,
    marked_by,
    marked_at
  )
  values (
    p_tenant_id,
    p_session_id,
    p_student_id,
    p_status,
    nullif(trim(coalesce(p_remarks, '')), ''),
    actor_id,
    now()
  )
  on conflict (session_id, student_id)
  do update set
    status = excluded.status,
    remarks = excluded.remarks,
    marked_by = excluded.marked_by,
    marked_at = excluded.marked_at
  returning * into attendance_row;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    'mark_attendance',
    'attendance_record',
    attendance_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return attendance_row;
end;
$$;

alter function public.mark_delegated_attendance(uuid,uuid,uuid,text,text)
owner to postgres;
revoke all on function public.mark_delegated_attendance(uuid,uuid,uuid,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.mark_delegated_attendance(uuid,uuid,uuid,text,text)
to authenticated;

create or replace function public.get_mobile_student_home()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
          'meeting_url', case
            when s.status = 'scheduled' and s.meeting_url is not null
             and (s.join_available_from is null or now() >= s.join_available_from)
            then s.meeting_url else null
          end,
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

alter function public.get_mobile_student_home() owner to postgres;
revoke all on function public.get_mobile_student_home()
from public, anon, authenticated, service_role;
grant execute on function public.get_mobile_student_home() to authenticated;

create or replace function public.get_reports_center_data(
  p_tenant_id uuid,
  p_report_key text default 'overview',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  drop table if exists pg_temp.reports_scope_sessions;

  create temporary table reports_scope_students(student_id uuid primary key) on commit drop;
  create temporary table reports_scope_courses(course_id uuid primary key) on commit drop;
  create temporary table reports_scope_cohorts(cohort_id uuid primary key) on commit drop;
  create temporary table reports_scope_sessions(session_id uuid primary key) on commit drop;

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

    insert into reports_scope_sessions(session_id)
    select s.id from public.sessions s
    where s.tenant_id = p_tenant_id
      and coachfort_internal.trainer_can_access_session(
        p_tenant_id, auth.uid(), s.id
      );
  else
    insert into reports_scope_courses(course_id)
    select c.id from public.courses c where c.tenant_id = p_tenant_id;

    insert into reports_scope_cohorts(cohort_id)
    select c.id from public.cohorts c where c.tenant_id = p_tenant_id;

    insert into reports_scope_students(student_id)
    select s.id from public.students s where s.tenant_id = p_tenant_id;

    insert into reports_scope_sessions(session_id)
    select s.id from public.sessions s where s.tenant_id = p_tenant_id;
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
    and s.id in (select session_id from reports_scope_sessions);

  select count(*)::integer into attendance_count
  from public.attendance_records ar
  join public.sessions s on s.id = ar.session_id and s.tenant_id = ar.tenant_id
  where ar.tenant_id = p_tenant_id
    and ar.session_id in (select session_id from reports_scope_sessions)
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
      left join public.attendance_records ar on ar.tenant_id = p_tenant_id and ar.student_id = s.id and ar.session_id in (select session_id from reports_scope_sessions) and (range_start is null or ar.marked_at >= range_start)
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
          and ar.session_id in (select session_id from reports_scope_sessions)
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
        and ar.session_id in (select session_id from reports_scope_sessions)
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
      left join public.sessions s on s.tenant_id = p_tenant_id and s.course_id = c.id and s.id in (select session_id from reports_scope_sessions)
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
      left join public.sessions s on s.tenant_id = p_tenant_id and s.trainer_user_id = tm.user_id and s.id in (select session_id from reports_scope_sessions) and (range_start is null or s.scheduled_start_at >= range_start)
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

alter function public.get_reports_center_data(uuid,text,jsonb) owner to postgres;
revoke all on function public.get_reports_center_data(uuid,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.get_reports_center_data(uuid,text,jsonb)
to authenticated;

commit;

-- POST-APPLY (read-only): run separately after applying this migration.
/*
with expected_functions(expected_identity) as (
  values
    ('coachfort_internal.trainer_can_access_session(uuid,uuid,uuid)'),
    ('public.update_session_status_secure(uuid,uuid,text)'),
    ('public.update_delegated_session_status(uuid,uuid,text)'),
    ('public.m69_3_assert_student_in_session_roster(uuid,sessions,uuid)'),
    ('public.mark_attendance_secure(uuid,uuid,uuid,text,text)'),
    ('public.bulk_mark_attendance_secure(uuid,uuid,jsonb)'),
    ('public.mark_delegated_attendance(uuid,uuid,uuid,text,text)'),
    ('public.get_reports_center_data(uuid,text,jsonb)'),
    ('public.get_student_portal_sessions(uuid)'),
    ('public.get_student_portal_attendance(uuid)'),
    ('public.get_mobile_student_home()'),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)')
), resolved_functions as (
  select ef.expected_identity, to_regprocedure(ef.expected_identity) function_oid
  from expected_functions ef
), function_acl as (
  select rf.function_oid,
    coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false)
      public_execute,
    coalesce(bool_or(grantee_role.rolname = 'anon'
      and a.privilege_type = 'EXECUTE'), false) anon_execute,
    coalesce(bool_or(grantee_role.rolname = 'authenticated'
      and a.privilege_type = 'EXECUTE'), false) authenticated_execute,
    coalesce(bool_or(grantee_role.rolname = 'service_role'
      and a.privilege_type = 'EXECUTE'), false) service_role_execute
  from resolved_functions rf
  join pg_catalog.pg_proc p on p.oid = rf.function_oid
  cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
  ) a
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = a.grantee
  group by rf.function_oid
), function_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'expected_identity', rf.expected_identity,
    'exists', p.oid is not null,
    'installed_identity', case when p.oid is null then null else format(
      '%I.%I(%s)', function_schema.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) end,
    'owner', owner_role.rolname,
    'security_definer', p.prosecdef,
    'volatility', p.provolatile,
    'search_path', p.proconfig,
    'acl', p.proacl,
    'public_execute', coalesce(fa.public_execute, false),
    'anon_execute', coalesce(fa.anon_execute, false),
    'authenticated_execute', coalesce(fa.authenticated_execute, false),
    'service_role_execute', coalesce(fa.service_role_execute, false)
  ) order by rf.expected_identity), '[]'::jsonb) value
  from resolved_functions rf
  left join pg_catalog.pg_proc p on p.oid = rf.function_oid
  left join pg_catalog.pg_namespace function_schema
    on function_schema.oid = p.pronamespace
  left join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
  left join function_acl fa on fa.function_oid = p.oid
), policy_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table',tablename,'policy',policyname,'command',cmd,'roles',roles,'using',qual
  ) order by tablename,policyname), '[]'::jsonb) value
  from pg_catalog.pg_policies where schemaname = 'public'
    and tablename in ('sessions','attendance_records')
), table_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table',c.relname,'rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity
  ) order by c.relname), '[]'::jsonb) value
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('sessions','attendance_records')
), policy_dependency_state as (
  select
    count(*) filter (
      where p.tablename = 'attendance_records'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%sessions%'
    ) attendance_policies_referencing_sessions,
    count(*) filter (
      where p.tablename = 'sessions'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%attendance_records%'
    ) session_policies_referencing_attendance
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sessions','attendance_records')
), source_checks as (
  select jsonb_build_object(
    'status_terminal', coalesce(position(
      'Only scheduled sessions can be completed or canceled.' in
      pg_get_functiondef(to_regprocedure(
        'public.update_session_status_secure(uuid,uuid,text)'
      ))
    ) > 0, false),
    'delegated_status_terminal', coalesce(position(
      'Only scheduled sessions can be completed or canceled.' in
      pg_get_functiondef(to_regprocedure(
        'public.update_delegated_session_status(uuid,uuid,text)'
      ))
    ) > 0, false),
    'attendance_active_student', coalesce(position(
      'New attendance requires an active student.' in
      pg_get_functiondef(to_regprocedure(
        'public.m69_3_assert_student_in_session_roster(uuid,sessions,uuid)'
      ))
    ) > 0, false),
    'attendance_active_enrollment', coalesce(position(
      'New attendance requires an active matching enrollment.' in
      pg_get_functiondef(to_regprocedure(
        'public.m69_3_assert_student_in_session_roster(uuid,sessions,uuid)'
      ))
    ) > 0, false),
    'attendance_canceled_denied', coalesce(position(
      'Attendance cannot be changed for a canceled session.' in
      pg_get_functiondef(to_regprocedure(
        'public.m69_3_assert_student_in_session_roster(uuid,sessions,uuid)'
      ))
    ) > 0, false),
    'report_session_scope', coalesce(position(
      'reports_scope_sessions' in pg_get_functiondef(to_regprocedure(
        'public.get_reports_center_data(uuid,text,jsonb)'
      ))
    ) > 0, false),
    'mobile_join_window_mask', coalesce(position(
      'join_available_from' in pg_get_functiondef(to_regprocedure(
        'public.get_mobile_student_home()'
      ))
    ) > 0, false),
    'portal_sessions_rpc', to_regprocedure('public.get_student_portal_sessions(uuid)') is not null,
    'portal_attendance_rpc', to_regprocedure('public.get_student_portal_attendance(uuid)') is not null,
    'canonical_access_helper', to_regprocedure(
      'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'
    ) is not null
  ) value
), risk_state as (
  select jsonb_build_object(
    'student_direct_session_policies', (
      select count(*) from pg_catalog.pg_policies where schemaname='public'
        and tablename='sessions' and policyname='Linked students can read own sessions'
    ),
    'student_direct_attendance_policies', (
      select count(*) from pg_catalog.pg_policies where schemaname='public'
        and tablename='attendance_records'
        and policyname='Linked students can read own attendance records'
    ),
    'trainer_session_helper_policy', exists (
      select 1 from pg_catalog.pg_policies where schemaname='public'
        and tablename='sessions' and policyname='Trainer can read assigned sessions'
        and lower(coalesce(qual,'')) like '%trainer_can_access_session%'
        and lower(coalesce(qual,'')) not like '%trainer_user_id = auth.uid()%'
    ),
    'trainer_attendance_helper_policy', exists (
      select 1 from pg_catalog.pg_policies where schemaname='public'
        and tablename='attendance_records'
        and policyname='Trainer can read assigned attendance records'
        and lower(coalesce(qual,'')) like '%trainer_can_access_session%'
    ),
    'trainer_stale_owner_policy', exists (
      select 1 from pg_catalog.pg_policies where schemaname='public'
        and tablename in ('sessions','attendance_records') and cmd='SELECT'
        and lower(coalesce(qual,'')) like '%trainer_user_id = auth.uid()%'
    ),
    'browser_write_grants', (
      select count(*) from information_schema.table_privileges
      where table_schema='public' and table_name in ('sessions','attendance_records')
        and grantee in ('PUBLIC','anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE')
    ),
    'attendance_policies_referencing_sessions', (
      select attendance_policies_referencing_sessions
      from policy_dependency_state
    ),
    'session_policies_referencing_attendance', (
      select session_policies_referencing_attendance
      from policy_dependency_state
    ),
    'actual_sessions_attendance_reciprocal_cycle', (
      select attendance_policies_referencing_sessions > 0
        and session_policies_referencing_attendance > 0
      from policy_dependency_state
    ),
    'internal_schema_api_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas',true),' ',''),','
      )), false
    ) or exists (
      select 1 from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(setting,'=',2),','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) value
)
select jsonb_build_object(
  'functions',(select value from function_state),
  'policies',(select value from policy_state),
  'tables',(select value from table_state),
  'source_checks',(select value from source_checks),
  'risk',(select value from risk_state)
) as verification_result;
*/
