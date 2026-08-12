/*
PRE-APPLY READ-ONLY VERIFICATION

with required_functions(name, identity) as (
  values
    ('canonical_role', 'public.reports_current_role(uuid)'),
    ('canonical_trainer_session_scope', 'coachfort_internal.trainer_can_access_session(uuid,uuid,uuid)'),
    ('reports_center', 'public.get_reports_center_data(uuid,text,jsonb)'),
    ('reports_filters', 'public.get_reports_filter_options(uuid)')
), resolved_functions as (
  select rf.name, rf.identity, to_regprocedure(rf.identity) as function_oid
  from required_functions rf
), function_acl as (
  select
    p.oid,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'grantee', case when a.grantee = 0 then 'PUBLIC' else grantee.rolname end,
        'privilege', a.privilege_type
      ) order by a.grantee, a.privilege_type
    ), '[]'::jsonb) as acl
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) a
  left join pg_catalog.pg_roles grantee on grantee.oid = a.grantee
  where p.oid in (select function_oid from resolved_functions where function_oid is not null)
  group by p.oid
), function_state as (
  select
    rf.name,
    rf.identity,
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile,
    p.proconfig as settings,
    coalesce(fa.acl, '[]'::jsonb) as acl
  from resolved_functions rf
  left join pg_catalog.pg_proc p on p.oid = rf.function_oid
  left join function_acl fa on fa.oid = p.oid
), table_state as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    pg_catalog.pg_get_userbyid(c.relowner) as owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('sessions', 'attendance_records')
), policy_state as (
  select
    p.tablename,
    p.policyname,
    p.cmd,
    p.roles,
    p.qual,
    p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sessions', 'attendance_records', 'cohorts', 'cohort_members')
), policy_signals as (
  select jsonb_build_object(
    'student_direct_session_policies', count(*) filter (
      where tablename = 'sessions'
        and (policyname = 'Linked students can read own sessions'
          or lower(coalesce(qual, '')) like '%student_portal_accounts%')
    ),
    'student_direct_attendance_policies', count(*) filter (
      where tablename = 'attendance_records'
        and (policyname = 'Linked students can read own attendance records'
          or lower(coalesce(qual, '')) like '%student_portal_accounts%')
    ),
    'trainer_session_helper_present', count(*) filter (
      where tablename = 'sessions' and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_can_access_session%'
    ),
    'trainer_session_stale_owner_shortcut', count(*) filter (
      where tablename = 'sessions' and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_user_id = auth.uid()%'
    ),
    'trainer_attendance_helper_present', count(*) filter (
      where tablename = 'attendance_records' and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_can_access_session%'
    ),
    'trainer_attendance_stale_owner_shortcut', count(*) filter (
      where tablename = 'attendance_records' and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_user_id = auth.uid()%'
    ),
    'attendance_policies_referencing_sessions', count(*) filter (
      where tablename = 'attendance_records'
        and lower(concat_ws(' ', qual, with_check)) like '%sessions%'
    ),
    'session_policies_referencing_attendance', count(*) filter (
      where tablename = 'sessions'
        and lower(concat_ws(' ', qual, with_check)) like '%attendance_records%'
    ),
    'actual_sessions_attendance_reciprocal_cycle',
      count(*) filter (
        where tablename = 'attendance_records'
          and lower(concat_ws(' ', qual, with_check)) like '%sessions%'
      ) > 0
      and count(*) filter (
        where tablename = 'sessions'
          and lower(concat_ws(' ', qual, with_check)) like '%attendance_records%'
      ) > 0,
    'cohorts_policies_referencing_cohort_members', count(*) filter (
      where tablename = 'cohorts'
        and lower(concat_ws(' ', qual, with_check)) like '%cohort_members%'
    ),
    'cohort_members_policies_referencing_cohorts', count(*) filter (
      where tablename = 'cohort_members'
        and lower(concat_ws(' ', qual, with_check)) like '%cohorts%'
    ),
    'actual_cohort_reciprocal_cycle',
      count(*) filter (
        where tablename = 'cohorts'
          and lower(concat_ws(' ', qual, with_check)) like '%cohort_members%'
      ) > 0
      and count(*) filter (
        where tablename = 'cohort_members'
          and lower(concat_ws(' ', qual, with_check)) like '%cohorts%'
      ) > 0
  ) as value
  from policy_state
), browser_writes as (
  select count(*) as value
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('sessions', 'attendance_records')
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
), internal_schema_state as (
  select jsonb_build_object(
    'pgrst_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(split_part(setting, '=', 2), ',') exposed(schema_name)
      where r.rolname = 'authenticator'
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ),
    'authenticated_usage', has_schema_privilege('authenticated', 'coachfort_internal', 'USAGE')
  ) as value
), relevant_indexes as (
  select coalesce(jsonb_agg(
    jsonb_build_object('name', indexname, 'definition', indexdef)
    order by tablename, indexname
  ), '[]'::jsonb) as value
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename in (
      'sessions', 'attendance_records',
      'trainer_course_assignments', 'trainer_cohort_assignments'
    )
)
select jsonb_build_object(
  'target_before', to_regprocedure('public.get_dashboard_session_attendance_summary(uuid)'),
  'dependencies', (select jsonb_agg(to_jsonb(fs) order by fs.name) from function_state fs),
  'tables', (select jsonb_agg(to_jsonb(ts) order by ts.table_name) from table_state ts),
  'policies', (select jsonb_agg(to_jsonb(ps) order by ps.tablename, ps.policyname) from policy_state ps),
  'policy_signals', (select value from policy_signals),
  'browser_write_grants', (select value from browser_writes),
  'internal_schema', (select value from internal_schema_state),
  'relevant_indexes', (select value from relevant_indexes)
) as preflight_result;
*/

begin;

do $$
declare
  v_missing text;
begin
  select string_agg(required.identity, ', ' order by required.identity)
  into v_missing
  from (values
    ('public.reports_current_role(uuid)'),
    ('coachfort_internal.trainer_can_access_session(uuid,uuid,uuid)')
  ) required(identity)
  where to_regprocedure(required.identity) is null;

  if v_missing is not null then
    raise exception 'UX-5E cannot install; missing required functions: %', v_missing
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('sessions', 'attendance_records')
      and (not c.relrowsecurity or c.relforcerowsecurity)
  ) then
    raise exception 'UX-5E cannot install; session/attendance RLS prerequisites are unsafe.'
      using errcode = '42501';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in ('sessions', 'attendance_records')
  ) <> 2 then
    raise exception 'UX-5E cannot install; required session/attendance tables are missing.'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.get_dashboard_session_attendance_summary(
  p_tenant_id uuid
)
returns table (
  attendance_percent integer,
  total_marked_attendance bigint,
  low_attendance_alerts bigint,
  upcoming_online_count bigint,
  upcoming_hybrid_count bigint,
  upcoming_offline_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
begin
  if p_tenant_id is null or auth.uid() is null then
    raise exception 'Dashboard attendance summary access denied.' using errcode = '42501';
  end if;

  v_actor_role := public.reports_current_role(p_tenant_id);

  if v_actor_role is null
     or v_actor_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'Dashboard attendance summary access denied.' using errcode = '42501';
  end if;

  return query
  with authorized_sessions as materialized (
    select
      s.id,
      s.delivery_mode,
      s.scheduled_start_at,
      s.status
    from public.sessions s
    where s.tenant_id = p_tenant_id
      and (
        v_actor_role in ('owner', 'admin', 'staff')
        or (
          v_actor_role = 'trainer'
          and coachfort_internal.trainer_can_access_session(
            p_tenant_id,
            auth.uid(),
            s.id
          )
        )
      )
  ), attendance_summary as (
    select
      count(*)::bigint as total_marked,
      count(*) filter (where ar.status in ('present', 'late'))::bigint as attended,
      count(*) filter (where ar.status = 'absent')::bigint as absent
    from public.attendance_records ar
    join authorized_sessions scoped_session
      on scoped_session.id = ar.session_id
    where ar.tenant_id = p_tenant_id
  ), upcoming_summary as (
    select
      count(*) filter (where scoped_session.delivery_mode = 'online')::bigint
        as online_count,
      count(*) filter (where scoped_session.delivery_mode = 'hybrid')::bigint
        as hybrid_count,
      count(*) filter (where scoped_session.delivery_mode = 'offline')::bigint
        as offline_count
    from authorized_sessions scoped_session
    where scoped_session.status = 'scheduled'
      and scoped_session.scheduled_start_at >= now()
  )
  select
    case
      when attendance.total_marked = 0 then null
      else round((attendance.attended::numeric / attendance.total_marked) * 100)::integer
    end as attendance_percent,
    attendance.total_marked as total_marked_attendance,
    attendance.absent as low_attendance_alerts,
    upcoming.online_count as upcoming_online_count,
    upcoming.hybrid_count as upcoming_hybrid_count,
    upcoming.offline_count as upcoming_offline_count
  from attendance_summary attendance
  cross join upcoming_summary upcoming;
end;
$$;

alter function public.get_dashboard_session_attendance_summary(uuid)
owner to postgres;

revoke all on function public.get_dashboard_session_attendance_summary(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_session_attendance_summary(uuid)
to authenticated;

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with target as (
  select to_regprocedure('public.get_dashboard_session_attendance_summary(uuid)') as function_oid
), function_acl as (
  select
    coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) as public_execute,
    coalesce(bool_or(grantee.rolname = 'anon' and a.privilege_type = 'EXECUTE'), false) as anon_execute,
    coalesce(bool_or(grantee.rolname = 'authenticated' and a.privilege_type = 'EXECUTE'), false) as authenticated_execute,
    coalesce(bool_or(grantee.rolname = 'service_role' and a.privilege_type = 'EXECUTE'), false) as service_role_execute,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'grantee', case when a.grantee = 0 then 'PUBLIC' else grantee.rolname end,
        'privilege', a.privilege_type
      ) order by a.grantee, a.privilege_type
    ), '[]'::jsonb) as acl
  from target t
  join pg_catalog.pg_proc p on p.oid = t.function_oid
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) a
  left join pg_catalog.pg_roles grantee on grantee.oid = a.grantee
), function_state as (
  select
    p.oid is not null as installed,
    p.oid::regprocedure::text as identity,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile = 's' as stable,
    p.proconfig as settings,
    p.proconfig = array['search_path=public, pg_temp']::text[] as expected_search_path,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    pg_catalog.pg_get_functiondef(p.oid) as definition,
    lower(pg_catalog.pg_get_functiondef(p.oid)) as normalized_definition,
    fa.public_execute,
    fa.anon_execute,
    fa.authenticated_execute,
    fa.service_role_execute,
    fa.acl
  from target t
  left join pg_catalog.pg_proc p on p.oid = t.function_oid
  cross join function_acl fa
), table_state as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    pg_catalog.pg_get_userbyid(c.relowner) as owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('sessions', 'attendance_records')
), policy_state as (
  select
    p.tablename,
    p.policyname,
    p.cmd,
    p.qual,
    p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sessions', 'attendance_records', 'cohorts', 'cohort_members')
), regression_signals as (
  select jsonb_build_object(
    'student_direct_session_policies', count(*) filter (
      where tablename = 'sessions'
        and (policyname = 'Linked students can read own sessions'
          or lower(coalesce(qual, '')) like '%student_portal_accounts%')
    ),
    'student_direct_attendance_policies', count(*) filter (
      where tablename = 'attendance_records'
        and (policyname = 'Linked students can read own attendance records'
          or lower(coalesce(qual, '')) like '%student_portal_accounts%')
    ),
    'trainer_session_helper_present', count(*) filter (
      where tablename = 'sessions' and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_can_access_session%'
    ),
    'trainer_attendance_helper_present', count(*) filter (
      where tablename = 'attendance_records' and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_can_access_session%'
    ),
    'trainer_stale_owner_shortcuts', count(*) filter (
      where tablename in ('sessions', 'attendance_records') and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_user_id = auth.uid()%'
    ),
    'attendance_policies_referencing_sessions', count(*) filter (
      where tablename = 'attendance_records'
        and lower(concat_ws(' ', qual, with_check)) like '%sessions%'
    ),
    'session_policies_referencing_attendance', count(*) filter (
      where tablename = 'sessions'
        and lower(concat_ws(' ', qual, with_check)) like '%attendance_records%'
    ),
    'actual_sessions_attendance_reciprocal_cycle',
      count(*) filter (
        where tablename = 'attendance_records'
          and lower(concat_ws(' ', qual, with_check)) like '%sessions%'
      ) > 0
      and count(*) filter (
        where tablename = 'sessions'
          and lower(concat_ws(' ', qual, with_check)) like '%attendance_records%'
      ) > 0,
    'actual_cohort_reciprocal_cycle',
      count(*) filter (
        where tablename = 'cohorts'
          and lower(concat_ws(' ', qual, with_check)) like '%cohort_members%'
      ) > 0
      and count(*) filter (
        where tablename = 'cohort_members'
          and lower(concat_ws(' ', qual, with_check)) like '%cohorts%'
      ) > 0
  ) as value
  from policy_state
), browser_writes as (
  select count(*) as value
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('sessions', 'attendance_records')
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
), contract as (
  select jsonb_build_object(
    'role_validation', normalized_definition like '%reports_current_role%'
      and normalized_definition like '%owner%admin%staff%trainer%',
    'student_and_non_member_denied', normalized_definition like '%access denied%'
      and normalized_definition like '%v_actor_role is null%'
      and normalized_definition like '%not in (''owner'', ''admin'', ''staff'', ''trainer'')%',
    'tenant_predicate', normalized_definition like '%s.tenant_id = p_tenant_id%'
      and normalized_definition like '%ar.tenant_id = p_tenant_id%',
    'canonical_trainer_scope', normalized_definition like '%coachfort_internal.trainer_can_access_session%'
      and normalized_definition like '%auth.uid()%s.id%',
    'authorized_session_scope_first', normalized_definition like '%with authorized_sessions as materialized%',
    'attendance_joined_to_authorized_sessions', normalized_definition like '%join authorized_sessions scoped_session%'
      and normalized_definition like '%scoped_session.id = ar.session_id%',
    'scheduled_future_only', normalized_definition like '%scoped_session.status = ''scheduled''%'
      and normalized_definition like '%scoped_session.scheduled_start_at >= now()%',
    'exact_delivery_modes', normalized_definition like '%delivery_mode = ''online''%'
      and normalized_definition like '%delivery_mode = ''hybrid''%'
      and normalized_definition like '%delivery_mode = ''offline''%',
    'six_aggregate_fields_only', result_type =
      'TABLE(attendance_percent integer, total_marked_attendance bigint, low_attendance_alerts bigint, upcoming_online_count bigint, upcoming_hybrid_count bigint, upcoming_offline_count bigint)',
    'raw_identifiers_absent', result_type !~* '(session_id|student_id|course_id|cohort_id|meeting)'
  ) as value
  from function_state
)
select jsonb_build_object(
  'function', (
    select jsonb_build_object(
      'installed', installed,
      'identity', identity,
      'owner', owner,
      'security_definer', security_definer,
      'stable', stable,
      'settings', settings,
      'expected_search_path', expected_search_path,
      'result_type', result_type,
      'public_execute', public_execute,
      'anon_execute', anon_execute,
      'authenticated_execute', authenticated_execute,
      'service_role_execute', service_role_execute,
      'acl', acl
    ) from function_state
  ),
  'contract', (select value from contract),
  'tables', (select jsonb_agg(to_jsonb(ts) order by ts.table_name) from table_state ts),
  'regression', (select value from regression_signals),
  'browser_write_grants', (select value from browser_writes),
  'canonical_dependencies', jsonb_build_object(
    'reports_current_role', to_regprocedure('public.reports_current_role(uuid)') is not null,
    'trainer_can_access_session', to_regprocedure('coachfort_internal.trainer_can_access_session(uuid,uuid,uuid)') is not null
  )
) as verification_result;
*/
