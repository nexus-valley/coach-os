/*
PRE-APPLY READ-ONLY VERIFICATION

with expected_functions(identity, kind) as (
  values
    ('public.update_session_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone)', 'full_update'),
    ('public.update_delegated_session(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone)', 'full_update'),
    ('public.update_session_meeting_details_secure(uuid,uuid,text,text,text,text,text,text,text,timestamp with time zone,text)', 'meeting_correction'),
    ('public.get_student_portal_sessions(uuid)', 'portal')
), resolved_functions as (
  select ef.identity, ef.kind, to_regprocedure(ef.identity) as function_oid
  from expected_functions ef
), function_acl as (
  select
    rf.function_oid,
    coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) as public_execute,
    coalesce(bool_or(grantee_role.rolname = 'anon' and a.privilege_type = 'EXECUTE'), false) as anon_execute,
    coalesce(bool_or(grantee_role.rolname = 'authenticated' and a.privilege_type = 'EXECUTE'), false) as authenticated_execute,
    coalesce(bool_or(grantee_role.rolname = 'service_role' and a.privilege_type = 'EXECUTE'), false) as service_role_execute,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'grantee', case when a.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
        'privilege', a.privilege_type
      ) order by a.grantee, a.privilege_type
    ), '[]'::jsonb) as acl
  from resolved_functions rf
  join pg_catalog.pg_proc p on p.oid = rf.function_oid
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = a.grantee
  group by rf.function_oid
),
function_state as (
  select
    rf.identity,
    rf.kind,
    p.oid is not null as installed,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile,
    p.proconfig as settings,
    coalesce(fa.public_execute, false) as public_execute,
    coalesce(fa.anon_execute, false) as anon_execute,
    coalesce(fa.authenticated_execute, false) as authenticated_execute,
    coalesce(fa.service_role_execute, false) as service_role_execute,
    coalesce(fa.acl, '[]'::jsonb) as acl,
    case when p.oid is null then null else pg_get_functiondef(p.oid) end as definition
  from resolved_functions rf
  left join pg_catalog.pg_proc p on p.oid = rf.function_oid
  left join function_acl fa on fa.function_oid = rf.function_oid
),
status_counts as (
  select coalesce(jsonb_object_agg(s.status, s.row_count), '{}'::jsonb) as value
  from (
    select status, count(*) as row_count
    from public.sessions
    group by status
    order by status
  ) s
),
direct_grants as (
  select coalesce(jsonb_agg(
    jsonb_build_object('grantee', grantee, 'privilege', privilege_type)
    order by grantee, privilege_type
  ), '[]'::jsonb) as value
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'sessions'
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
browser_writes as (
  select count(*) as value
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'sessions'
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
),
required_dependencies(name, identity) as (
  values
    ('manage_attendance_assertion', 'public.m69_3_assert_manage_attendance(uuid)'),
    ('scope_assertion', 'public.m69_3_assert_can_manage_scope(uuid,text,uuid,uuid,uuid,boolean)'),
    ('normalize_text', 'public.m69_3_normalize_text(text,text,boolean,integer)'),
    ('validate_delivery_mode', 'public.m69_3_validate_delivery_mode(text)'),
    ('validate_meeting_provider', 'public.m69_3_validate_meeting_provider(text)'),
    ('validate_url', 'public.m69_3_validate_url(text,text)'),
    ('course_tenant_assertion', 'public.m69_3_assert_course_in_tenant(uuid,uuid)'),
    ('cohort_tenant_assertion', 'public.m69_3_assert_cohort_in_tenant(uuid,uuid)'),
    ('course_cohort_consistency', 'public.m69_3_assert_course_cohort_consistency(uuid,uuid,uuid)'),
    ('audit_writer', 'public.m69_3_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'),
    ('tenant_membership', 'public.is_tenant_member(uuid,uuid)'),
    ('delegated_permission_lookup', 'public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
    ('delegated_audit_writer', 'public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
    ('canonical_portal_access', 'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)')
), dependencies as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', rd.name,
      'identity', rd.identity,
      'installed', to_regprocedure(rd.identity) is not null
    ) order by rd.name
  ), '[]'::jsonb) as value
  from required_dependencies rd
)
select jsonb_build_object(
  'functions', (select jsonb_agg(to_jsonb(fs) - 'definition' order by fs.identity) from function_state fs),
  'source_signals', (
    select jsonb_object_agg(
      identity,
      jsonb_build_object(
        'row_lock', case when kind in ('full_update', 'meeting_correction') then coalesce(definition ~* 'for\s+update', false) else null end,
        'scheduled_edit_guard', case when kind = 'full_update' then coalesce(
          definition ~* 'status\s*<>\s*''scheduled'''
          and position('Only scheduled sessions can be edited or rescheduled.' in definition) > 0,
          false
        ) else null end,
        'canceled_denied', case when kind = 'meeting_correction' then coalesce(
          position('Canceled session meeting details cannot be edited.' in definition) > 0,
          false
        ) else null end,
        'completed_recording_only', case when kind = 'meeting_correction' then coalesce(
          position('Completed sessions allow recording URL correction only.' in definition) > 0
          and definition ~* 'set\s+recording_url\s*=',
          false
        ) else null end,
        'canceled_supported', case when kind = 'portal' then coalesce(
          definition ~* 'status\s+in\s*\(''scheduled'',\s*''completed'',\s*''canceled''\)',
          false
        ) else null end
      )
    ) from function_state
  ),
  'session_status_counts', (select value from status_counts),
  'sessions_rls_enabled', (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'sessions'
  ),
  'sessions_direct_grants', (select value from direct_grants),
  'browser_write_grants', (select value from browser_writes),
  'dependencies', (select value from dependencies)
) as preflight_result;
*/

begin;

do $$
declare
  v_missing text;
begin
  select string_agg(required.identity, ', ' order by required.identity)
  into v_missing
  from (
    values
      ('public.update_session_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone)'),
      ('public.update_delegated_session(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone)'),
      ('public.update_session_meeting_details_secure(uuid,uuid,text,text,text,text,text,text,text,timestamp with time zone,text)'),
      ('public.get_student_portal_sessions(uuid)'),
      ('public.m69_3_assert_manage_attendance(uuid)'),
      ('public.m69_3_assert_can_manage_scope(uuid,text,uuid,uuid,uuid,boolean)'),
      ('public.m69_3_normalize_text(text,text,boolean,integer)'),
      ('public.m69_3_validate_delivery_mode(text)'),
      ('public.m69_3_validate_meeting_provider(text)'),
      ('public.m69_3_validate_url(text,text)'),
      ('public.m69_3_assert_course_in_tenant(uuid,uuid)'),
      ('public.m69_3_assert_cohort_in_tenant(uuid,uuid)'),
      ('public.m69_3_assert_course_cohort_consistency(uuid,uuid,uuid)'),
      ('public.m69_3_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'),
      ('public.is_tenant_member(uuid,uuid)'),
      ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
      ('public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
      ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)')
  ) as required(identity)
  where to_regprocedure(required.identity) is null;

  if v_missing is not null then
    raise exception 'UX-5C required function(s) missing: %', v_missing;
  end if;

  if to_regclass('public.sessions') is null then
    raise exception 'UX-5C requires public.sessions.';
  end if;
end;
$$;

create or replace function public.update_session_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_trainer_user_id uuid,
  p_title text,
  p_description text,
  p_delivery_mode text,
  p_meeting_provider text,
  p_meeting_url text,
  p_meeting_id text,
  p_meeting_passcode text,
  p_meeting_notes text,
  p_timezone text,
  p_join_available_from timestamptz,
  p_recording_url text,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz
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
  v_title text;
  v_delivery_mode text;
  v_meeting_provider text;
  v_trainer_user_id uuid;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);

  select s.*
  into v_existing
  from public.sessions s
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
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

  if v_existing.status <> 'scheduled' then
    raise exception 'Only scheduled sessions can be edited or rescheduled.'
      using errcode = '22023';
  end if;

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this session.' using errcode = '22023';
  end if;

  perform public.m69_3_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_3_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_3_assert_course_cohort_consistency(
    p_tenant_id,
    p_course_id,
    p_cohort_id
  );

  v_trainer_user_id := case
    when v_role = 'trainer' then auth.uid()
    else p_trainer_user_id
  end;
  perform public.m69_3_assert_can_manage_scope(
    p_tenant_id,
    v_role,
    p_course_id,
    p_cohort_id,
    v_trainer_user_id,
    true
  );

  v_title := public.m69_3_normalize_text(p_title, 'Session title', true, 180);
  v_delivery_mode := public.m69_3_validate_delivery_mode(p_delivery_mode);
  v_meeting_provider := public.m69_3_validate_meeting_provider(p_meeting_provider);

  if p_scheduled_start_at is null then
    raise exception 'Scheduled start time is required.' using errcode = '22023';
  end if;

  if p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'Session end time cannot be before start time.' using errcode = '22023';
  end if;

  update public.sessions as s
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = v_trainer_user_id,
    title = v_title,
    description = public.m69_3_normalize_text(p_description, 'Description', false, 2000),
    delivery_mode = v_delivery_mode,
    meeting_provider = v_meeting_provider,
    meeting_url = public.m69_3_validate_url(p_meeting_url, 'Meeting URL'),
    meeting_id = public.m69_3_normalize_text(p_meeting_id, 'Meeting ID', false, 200),
    meeting_passcode = public.m69_3_normalize_text(p_meeting_passcode, 'Meeting passcode', false, 200),
    meeting_notes = public.m69_3_normalize_text(p_meeting_notes, 'Meeting notes', false, 2000),
    timezone = coalesce(
      public.m69_3_normalize_text(p_timezone, 'Timezone', false, 100),
      'Asia/Kolkata'
    ),
    join_available_from = p_join_available_from,
    recording_url = public.m69_3_validate_url(p_recording_url, 'Recording URL'),
    scheduled_start_at = p_scheduled_start_at,
    scheduled_end_at = p_scheduled_end_at
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
    and s.status = 'scheduled'
  returning * into v_session;

  if not found then
    raise exception 'Only scheduled sessions can be edited or rescheduled.'
      using errcode = '22023';
  end if;

  perform public.m69_3_write_audit(
    p_tenant_id,
    case
      when v_session.delivery_mode = 'offline' then 'session_updated'
      else 'live_session_updated'
    end,
    'session',
    v_session.id,
    'Session',
    'Updated class session',
    'info',
    jsonb_build_object(
      'sessionId', v_session.id,
      'courseId', v_session.course_id,
      'cohortId', v_session.cohort_id,
      'deliveryMode', v_session.delivery_mode,
      'meetingProvider', v_session.meeting_provider,
      'status', v_session.status,
      'scheduledStartAt', v_session.scheduled_start_at
    )
  );

  return v_session;
end;
$$;

create or replace function public.update_delegated_session(
  p_tenant_id uuid,
  p_session_id uuid,
  p_course_id uuid,
  p_cohort_id uuid,
  p_trainer_user_id uuid,
  p_title text,
  p_description text,
  p_delivery_mode text,
  p_meeting_provider text,
  p_meeting_url text,
  p_meeting_id text,
  p_meeting_passcode text,
  p_meeting_notes text,
  p_timezone text,
  p_join_available_from timestamptz,
  p_recording_url text,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz
)
returns public.sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  existing_session public.sessions%rowtype;
  matched_permission_id uuid;
  matched_scope_id uuid;
  matched_scope_type text;
  session_row public.sessions%rowtype;
  target_permission_id uuid;
  target_scope_changed boolean;
  workspace_permission_id uuid;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to update sessions.';
  end if;

  select s.*
  into existing_session
  from public.sessions s
  where s.id = p_session_id
    and s.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Session not found in this workspace.' using errcode = '22023';
  end if;

  target_scope_changed :=
    p_course_id is distinct from existing_session.course_id
    or p_cohort_id is distinct from existing_session.cohort_id;

  workspace_permission_id := public.find_active_delegated_permission_for_action(
    p_tenant_id,
    actor_id,
    array['manage_sessions'],
    null,
    null,
    null,
    null,
    null
  );

  if workspace_permission_id is not null then
    matched_permission_id := workspace_permission_id;
  else
    matched_permission_id := public.find_active_delegated_permission_for_action(
      p_tenant_id,
      actor_id,
      array['manage_sessions'],
      existing_session.course_id,
      existing_session.cohort_id,
      null,
      existing_session.id,
      null
    );

    if matched_permission_id is null then
      raise exception 'You do not have delegated permission to update this session.';
    end if;
  end if;

  if existing_session.status <> 'scheduled' then
    raise exception 'Only scheduled sessions can be edited or rescheduled.'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Session title is required.';
  end if;

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this session.';
  end if;

  if p_delivery_mode not in ('online', 'offline', 'hybrid') then
    raise exception 'Unsupported delivery mode.';
  end if;

  if p_meeting_provider is not null
     and p_meeting_provider not in (
       'zoom',
       'google_meet',
       'microsoft_teams',
       'custom'
     ) then
    raise exception 'Unsupported meeting provider.';
  end if;

  if p_meeting_url is not null
     and p_meeting_url !~* '^https?://' then
    raise exception 'Meeting URL must be a valid http or https URL.';
  end if;

  if p_recording_url is not null
     and p_recording_url !~* '^https?://' then
    raise exception 'Recording URL must be a valid http or https URL.';
  end if;

  if p_scheduled_start_at is null then
    raise exception 'Scheduled start time is required.';
  end if;

  if p_scheduled_end_at is not null
     and p_scheduled_end_at < p_scheduled_start_at then
    raise exception 'Session end time cannot be before start time.';
  end if;

  if p_course_id is not null
     and not exists (
       select 1
       from public.courses c
       where c.id = p_course_id
         and c.tenant_id = p_tenant_id
     ) then
    raise exception 'Course not found in this workspace.';
  end if;

  if p_cohort_id is not null
     and not exists (
       select 1
       from public.cohorts c
       where c.id = p_cohort_id
         and c.tenant_id = p_tenant_id
     ) then
    raise exception 'Cohort not found in this workspace.';
  end if;

  if p_course_id is not null
     and p_cohort_id is not null
     and not exists (
       select 1
       from public.cohorts c
       where c.id = p_cohort_id
         and c.tenant_id = p_tenant_id
         and c.course_id = p_course_id
     ) then
    raise exception 'Selected cohort does not belong to the selected course.';
  end if;

  if p_trainer_user_id is not null
     and not public.is_tenant_member(p_tenant_id, p_trainer_user_id) then
    raise exception 'Trainer user is not a member of this workspace.';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

  if matched_scope_type = 'session'
     and target_scope_changed then
    raise exception 'Session-scoped permission cannot move a session to another scope.';
  end if;

  if workspace_permission_id is null and target_scope_changed then
    target_permission_id := public.find_active_delegated_permission_for_action(
      p_tenant_id,
      actor_id,
      array['manage_sessions'],
      p_course_id,
      p_cohort_id,
      null,
      null,
      null
    );

    if target_permission_id is null then
      raise exception 'You do not have delegated permission for the target session scope.';
    end if;
  end if;

  update public.sessions as s
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = p_trainer_user_id,
    title = trim(p_title),
    description = nullif(trim(coalesce(p_description, '')), ''),
    delivery_mode = p_delivery_mode,
    meeting_provider = p_meeting_provider,
    meeting_url = nullif(trim(coalesce(p_meeting_url, '')), ''),
    meeting_id = nullif(trim(coalesce(p_meeting_id, '')), ''),
    meeting_passcode = nullif(trim(coalesce(p_meeting_passcode, '')), ''),
    meeting_notes = nullif(trim(coalesce(p_meeting_notes, '')), ''),
    timezone = coalesce(nullif(trim(coalesce(p_timezone, '')), ''), 'Asia/Kolkata'),
    join_available_from = p_join_available_from,
    recording_url = nullif(trim(coalesce(p_recording_url, '')), ''),
    scheduled_start_at = p_scheduled_start_at,
    scheduled_end_at = p_scheduled_end_at
  where s.id = p_session_id
    and s.tenant_id = p_tenant_id
    and s.status = 'scheduled'
  returning * into session_row;

  if not found then
    raise exception 'Only scheduled sessions can be edited or rescheduled.'
      using errcode = '22023';
  end if;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    'update_session',
    'session',
    session_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return session_row;
end;
$$;

create or replace function public.update_session_meeting_details_secure(
  p_tenant_id uuid,
  p_session_id uuid,
  p_delivery_mode text,
  p_meeting_provider text,
  p_meeting_url text,
  p_meeting_id text,
  p_meeting_passcode text,
  p_meeting_notes text,
  p_timezone text,
  p_join_available_from timestamptz,
  p_recording_url text
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
  v_delivery_mode text;
  v_meeting_provider text;
  v_meeting_url text;
  v_meeting_id text;
  v_meeting_passcode text;
  v_meeting_notes text;
  v_timezone text;
  v_recording_url text;
begin
  v_role := public.m69_3_assert_manage_attendance(p_tenant_id);

  select s.*
  into v_existing
  from public.sessions s
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
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

  if v_existing.status = 'canceled' then
    raise exception 'Canceled session meeting details cannot be edited.'
      using errcode = '22023';
  end if;

  if v_existing.status not in ('scheduled', 'completed') then
    raise exception 'This session does not support meeting-detail correction.'
      using errcode = '22023';
  end if;

  v_delivery_mode := public.m69_3_validate_delivery_mode(p_delivery_mode);
  if v_delivery_mode is distinct from v_existing.delivery_mode then
    raise exception 'Delivery mode changes require a full scheduled-session edit.'
      using errcode = '22023';
  end if;

  v_meeting_provider := public.m69_3_validate_meeting_provider(p_meeting_provider);
  v_meeting_url := public.m69_3_validate_url(p_meeting_url, 'Meeting URL');
  v_meeting_id := public.m69_3_normalize_text(
    p_meeting_id,
    'Meeting ID',
    false,
    200
  );
  v_meeting_passcode := public.m69_3_normalize_text(
    p_meeting_passcode,
    'Meeting passcode',
    false,
    200
  );
  v_meeting_notes := public.m69_3_normalize_text(
    p_meeting_notes,
    'Meeting notes',
    false,
    2000
  );
  v_timezone := coalesce(
    public.m69_3_normalize_text(p_timezone, 'Timezone', false, 100),
    'Asia/Kolkata'
  );
  v_recording_url := public.m69_3_validate_url(p_recording_url, 'Recording URL');

  if v_existing.status = 'completed' then
    if v_meeting_provider is distinct from v_existing.meeting_provider
       or v_meeting_url is distinct from v_existing.meeting_url
       or v_meeting_id is distinct from v_existing.meeting_id
       or v_meeting_passcode is distinct from v_existing.meeting_passcode
       or v_meeting_notes is distinct from v_existing.meeting_notes
       or v_timezone is distinct from v_existing.timezone
       or p_join_available_from is distinct from v_existing.join_available_from then
      raise exception 'Completed sessions allow recording URL correction only.'
        using errcode = '22023';
    end if;

    update public.sessions as s
    set recording_url = v_recording_url
    where s.tenant_id = p_tenant_id
      and s.id = p_session_id
      and s.status = 'completed'
    returning * into v_session;
  else
    update public.sessions as s
    set
      meeting_provider = v_meeting_provider,
      meeting_url = v_meeting_url,
      meeting_id = v_meeting_id,
      meeting_passcode = v_meeting_passcode,
      meeting_notes = v_meeting_notes,
      timezone = v_timezone,
      join_available_from = p_join_available_from,
      recording_url = v_recording_url
    where s.tenant_id = p_tenant_id
      and s.id = p_session_id
      and s.status = 'scheduled'
    returning * into v_session;
  end if;

  if not found then
    raise exception 'Session lifecycle changed before the correction was saved.'
      using errcode = '22023';
  end if;

  perform public.m69_3_write_audit(
    p_tenant_id,
    'meeting_details_updated',
    'session',
    v_session.id,
    'Session',
    case
      when v_session.status = 'completed'
        then 'Updated completed session recording details'
      else 'Updated class meeting details'
    end,
    'info',
    jsonb_build_object(
      'sessionId', v_session.id,
      'deliveryMode', v_session.delivery_mode,
      'meetingProvider', v_session.meeting_provider,
      'scheduledStartAt', v_session.scheduled_start_at,
      'status', v_session.status
    )
  );

  return v_session;
end;
$$;

create or replace function public.update_delegated_session_meeting_details(
  p_tenant_id uuid,
  p_session_id uuid,
  p_delivery_mode text,
  p_meeting_provider text,
  p_meeting_url text,
  p_meeting_id text,
  p_meeting_passcode text,
  p_meeting_notes text,
  p_timezone text,
  p_join_available_from timestamptz,
  p_recording_url text
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
  v_delivery_mode text;
  v_meeting_provider text;
  v_meeting_url text;
  v_meeting_id text;
  v_meeting_passcode text;
  v_meeting_notes text;
  v_timezone text;
  v_recording_url text;
begin
  if actor_id is null
     or not public.is_tenant_member(p_tenant_id, actor_id) then
    raise exception 'You do not have permission to update sessions.';
  end if;

  select s.*
  into session_row
  from public.sessions s
  where s.tenant_id = p_tenant_id
    and s.id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found in this workspace.' using errcode = '22023';
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

  if session_row.status = 'canceled' then
    raise exception 'Canceled session meeting details cannot be edited.'
      using errcode = '22023';
  end if;

  if session_row.status not in ('scheduled', 'completed') then
    raise exception 'This session does not support meeting-detail correction.'
      using errcode = '22023';
  end if;

  v_delivery_mode := public.m69_3_validate_delivery_mode(p_delivery_mode);
  if v_delivery_mode is distinct from session_row.delivery_mode then
    raise exception 'Delivery mode changes require a full scheduled-session edit.'
      using errcode = '22023';
  end if;

  v_meeting_provider := public.m69_3_validate_meeting_provider(p_meeting_provider);
  v_meeting_url := public.m69_3_validate_url(p_meeting_url, 'Meeting URL');
  v_meeting_id := public.m69_3_normalize_text(
    p_meeting_id,
    'Meeting ID',
    false,
    200
  );
  v_meeting_passcode := public.m69_3_normalize_text(
    p_meeting_passcode,
    'Meeting passcode',
    false,
    200
  );
  v_meeting_notes := public.m69_3_normalize_text(
    p_meeting_notes,
    'Meeting notes',
    false,
    2000
  );
  v_timezone := coalesce(
    public.m69_3_normalize_text(p_timezone, 'Timezone', false, 100),
    'Asia/Kolkata'
  );
  v_recording_url := public.m69_3_validate_url(p_recording_url, 'Recording URL');

  if session_row.status = 'completed' then
    if v_meeting_provider is distinct from session_row.meeting_provider
       or v_meeting_url is distinct from session_row.meeting_url
       or v_meeting_id is distinct from session_row.meeting_id
       or v_meeting_passcode is distinct from session_row.meeting_passcode
       or v_meeting_notes is distinct from session_row.meeting_notes
       or v_timezone is distinct from session_row.timezone
       or p_join_available_from is distinct from session_row.join_available_from then
      raise exception 'Completed sessions allow recording URL correction only.'
        using errcode = '22023';
    end if;

    update public.sessions as s
    set recording_url = v_recording_url
    where s.tenant_id = p_tenant_id
      and s.id = p_session_id
      and s.status = 'completed'
    returning * into session_row;
  else
    update public.sessions as s
    set
      meeting_provider = v_meeting_provider,
      meeting_url = v_meeting_url,
      meeting_id = v_meeting_id,
      meeting_passcode = v_meeting_passcode,
      meeting_notes = v_meeting_notes,
      timezone = v_timezone,
      join_available_from = p_join_available_from,
      recording_url = v_recording_url
    where s.tenant_id = p_tenant_id
      and s.id = p_session_id
      and s.status = 'scheduled'
    returning * into session_row;
  end if;

  if not found then
    raise exception 'Session lifecycle changed before the correction was saved.'
      using errcode = '22023';
  end if;

  select scope_type, scope_id
  into matched_scope_type, matched_scope_id
  from public.delegated_permissions
  where id = matched_permission_id;

  perform public.log_delegated_permission_used(
    p_tenant_id,
    actor_id,
    matched_permission_id,
    case
      when session_row.status = 'completed'
        then 'update_session_recording'
      else 'update_session_meeting_details'
    end,
    'session',
    session_row.id,
    matched_scope_type,
    matched_scope_id
  );

  return session_row;
end;
$$;

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
set search_path = public, pg_temp
as $$
  with ctx as (
    select spa.tenant_id, spa.student_id
    from public.student_portal_accounts spa
    where spa.tenant_id = p_tenant_id
      and spa.user_id = auth.uid()
      and public.student_portal_access_allowed(
        spa.tenant_id,
        spa.student_id,
        auth.uid(),
        null,
        'portal'
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
      and s.status in ('scheduled', 'completed', 'canceled')
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
    end as meeting_url,
    vs.join_available_from,
    case
      when vs.status = 'completed'
       and vs.can_read
       and vs.recording_url is not null
      then vs.recording_url
      else null
    end as recording_url,
    vs.timezone,
    vs.scheduled_start_at,
    vs.scheduled_end_at,
    vs.status
  from visible_sessions vs
  where (vs.status = 'scheduled' and vs.can_participate)
     or (vs.status in ('completed', 'canceled') and vs.can_read)
  order by vs.scheduled_start_at asc;
$$;

alter function public.update_session_secure(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,
  timestamptz,text,timestamptz,timestamptz
) owner to postgres;
alter function public.update_delegated_session(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,
  timestamptz,text,timestamptz,timestamptz
) owner to postgres;
alter function public.update_session_meeting_details_secure(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz,text
) owner to postgres;
alter function public.update_delegated_session_meeting_details(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz,text
) owner to postgres;
alter function public.get_student_portal_sessions(uuid) owner to postgres;

revoke all on function public.update_session_secure(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,
  timestamptz,text,timestamptz,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.update_delegated_session(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,
  timestamptz,text,timestamptz,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.update_session_meeting_details_secure(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz,text
) from public, anon, authenticated, service_role;
revoke all on function public.update_delegated_session_meeting_details(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz,text
) from public, anon, authenticated, service_role;
revoke all on function public.get_student_portal_sessions(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.update_session_secure(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,
  timestamptz,text,timestamptz,timestamptz
) to authenticated;
grant execute on function public.update_delegated_session(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,
  timestamptz,text,timestamptz,timestamptz
) to authenticated;
grant execute on function public.update_session_meeting_details_secure(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz,text
) to authenticated;
grant execute on function public.update_delegated_session_meeting_details(
  uuid,uuid,text,text,text,text,text,text,text,timestamptz,text
) to authenticated;
grant execute on function public.get_student_portal_sessions(uuid)
to authenticated;

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with expected_functions(identity, kind) as (
  values
    ('public.update_session_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone)', 'full_update'),
    ('public.update_delegated_session(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone)', 'full_update'),
    ('public.update_session_meeting_details_secure(uuid,uuid,text,text,text,text,text,text,text,timestamp with time zone,text)', 'meeting_correction'),
    ('public.update_delegated_session_meeting_details(uuid,uuid,text,text,text,text,text,text,text,timestamp with time zone,text)', 'meeting_correction'),
    ('public.get_student_portal_sessions(uuid)', 'portal')
), resolved_functions as (
  select ef.identity, ef.kind, to_regprocedure(ef.identity) as function_oid
  from expected_functions ef
), function_acl as (
  select
    rf.function_oid,
    coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) as public_execute,
    coalesce(bool_or(grantee_role.rolname = 'anon' and a.privilege_type = 'EXECUTE'), false) as anon_execute,
    coalesce(bool_or(grantee_role.rolname = 'authenticated' and a.privilege_type = 'EXECUTE'), false) as authenticated_execute,
    coalesce(bool_or(grantee_role.rolname = 'service_role' and a.privilege_type = 'EXECUTE'), false) as service_role_execute,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'grantee', case when a.grantee = 0 then 'PUBLIC' else grantee_role.rolname end,
        'privilege', a.privilege_type
      ) order by a.grantee, a.privilege_type
    ), '[]'::jsonb) as acl
  from resolved_functions rf
  join pg_catalog.pg_proc p on p.oid = rf.function_oid
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = a.grantee
  group by rf.function_oid
), function_state as (
  select
    rf.identity,
    rf.kind,
    p.oid is not null as installed,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile,
    p.proconfig as settings,
    p.proconfig = array['search_path=public, pg_temp']::text[] as expected_search_path,
    case when p.oid is null then null else pg_get_function_result(p.oid) end as result_type,
    case when p.oid is null then null else pg_get_functiondef(p.oid) end as definition,
    case when p.oid is null then null else regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', ' ', 'g') end as normalized_definition,
    coalesce(fa.public_execute, false) as public_execute,
    coalesce(fa.anon_execute, false) as anon_execute,
    coalesce(fa.authenticated_execute, false) as authenticated_execute,
    coalesce(fa.service_role_execute, false) as service_role_execute,
    coalesce(fa.acl, '[]'::jsonb) as acl
  from resolved_functions rf
  left join pg_catalog.pg_proc p on p.oid = rf.function_oid
  left join function_acl fa on fa.function_oid = rf.function_oid
), direct_grants as (
  select coalesce(jsonb_agg(
    jsonb_build_object('grantee', grantee, 'privilege', privilege_type)
    order by grantee, privilege_type
  ), '[]'::jsonb) as value
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'sessions'
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), browser_writes as (
  select count(*) as value
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'sessions'
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
), policy_state as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'table', tablename,
      'policy', policyname,
      'command', cmd,
      'roles', roles,
      'using', qual,
      'with_check', with_check
    ) order by tablename, policyname
  ), '[]'::jsonb) as value
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in ('sessions', 'attendance_records', 'cohorts', 'cohort_members')
), policy_dependency_state as (
  select
    count(*) filter (
      where p.tablename = 'cohorts'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%cohort_members%'
    ) as cohorts_policies_referencing_cohort_members,
    count(*) filter (
      where p.tablename = 'cohort_members'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%cohorts%'
    ) as cohort_members_policies_referencing_cohorts,
    count(*) filter (
      where p.tablename = 'attendance_records'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%sessions%'
    ) as attendance_policies_referencing_sessions,
    count(*) filter (
      where p.tablename = 'sessions'
        and lower(concat_ws(' ', p.qual, p.with_check)) like '%attendance_records%'
    ) as session_policies_referencing_attendance
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sessions', 'attendance_records', 'cohorts', 'cohort_members')
), trainer_policy_state as (
  select jsonb_build_object(
    'trainer_session_policy_exists', exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'sessions'
        and policyname = 'Trainer can read assigned sessions'
        and cmd = 'SELECT'
    ),
    'trainer_session_uses_helper', exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'sessions'
        and policyname = 'Trainer can read assigned sessions'
        and lower(coalesce(qual, '')) like '%trainer_can_access_session%'
    ),
    'trainer_session_stale_owner_branch', exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'sessions'
        and policyname = 'Trainer can read assigned sessions'
        and lower(coalesce(qual, '')) like '%trainer_user_id = auth.uid()%'
    ),
    'trainer_attendance_policy_exists', exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'attendance_records'
        and policyname = 'Trainer can read assigned attendance records'
        and cmd = 'SELECT'
    ),
    'trainer_attendance_uses_helper', exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'attendance_records'
        and policyname = 'Trainer can read assigned attendance records'
        and lower(coalesce(qual, '')) like '%trainer_can_access_session%'
    ),
    'trainer_attendance_stale_owner_branch', exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'attendance_records'
        and policyname = 'Trainer can read assigned attendance records'
        and lower(coalesce(qual, '')) like '%trainer_user_id = auth.uid()%'
    ),
    'trainer_stale_owner_select_policies', (
      select count(*) from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename in ('sessions', 'attendance_records')
        and cmd = 'SELECT'
        and lower(coalesce(qual, '')) like '%trainer_user_id = auth.uid()%'
    )
  ) as value
), student_direct_session_policies as (
  select count(*) as value
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'sessions'
    and (
      p.policyname = 'Linked students can read own sessions'
      or coalesce(p.qual, '') ~* 'student_portal_accounts'
    )
)
select jsonb_build_object(
  'functions', (
    select jsonb_agg(
      jsonb_build_object(
        'identity', identity,
        'installed', installed,
        'owner', owner,
        'postgres_owner', owner = 'postgres',
        'security_definer', security_definer,
        'stable', case when kind = 'portal' then provolatile = 's' else null end,
        'settings', settings,
        'expected_search_path', expected_search_path,
        'result_type', result_type,
        'public_execute', public_execute,
        'anon_execute', anon_execute,
        'authenticated_execute', authenticated_execute,
        'service_role_execute', service_role_execute,
        'acl', acl,
        'row_lock', case when kind in ('full_update', 'meeting_correction') then coalesce(normalized_definition like '%for update%', false) else null end,
        'scheduled_edit_guard', case when kind = 'full_update' then coalesce(
          normalized_definition like '%status <> ''scheduled''%'
          and position('Only scheduled sessions can be edited or rescheduled.' in definition) > 0,
          false
        ) else null end,
        'scheduled_update_predicate', case when kind = 'full_update' then coalesce(
          normalized_definition like '%and s.status = ''scheduled'' returning%',
          false
        ) else null end,
        'safe_scheduled_edit_message', case when kind = 'full_update' then coalesce(
          position('Only scheduled sessions can be edited or rescheduled.' in definition) > 0,
          false
        ) else null end,
        'canceled_correction_denied', case when kind = 'meeting_correction' then coalesce(
          normalized_definition like '%status = ''canceled''%'
          and position('Canceled session meeting details cannot be edited.' in definition) > 0,
          false
        ) else null end,
        'scheduled_completed_only', case when kind = 'meeting_correction' then coalesce(
          normalized_definition like '%status not in (''scheduled'', ''completed'')%',
          false
        ) else null end,
        'delivery_mode_immutable', case when kind = 'meeting_correction' then coalesce(
          normalized_definition like '%delivery_mode is distinct from%delivery_mode%'
          and position('Delivery mode changes require a full scheduled-session edit.' in definition) > 0,
          false
        ) else null end,
        'completed_recording_only_guard', case when kind = 'meeting_correction' then coalesce(
          position('Completed sessions allow recording URL correction only.' in definition) > 0,
          false
        ) else null end,
        'completed_update_recording_only', case when kind = 'meeting_correction' then coalesce(
          normalized_definition like '%update public.sessions as s set recording_url = v_recording_url where s.tenant_id = p_tenant_id and s.id = p_session_id and s.status = ''completed'' returning%',
          false
        ) else null end,
        'scheduled_correction_allowed_fields', case when kind = 'meeting_correction' then coalesce(
          normalized_definition like '%meeting_provider = v_meeting_provider%'
          and normalized_definition like '%meeting_url = v_meeting_url%'
          and normalized_definition like '%meeting_id = v_meeting_id%'
          and normalized_definition like '%meeting_passcode = v_meeting_passcode%'
          and normalized_definition like '%meeting_notes = v_meeting_notes%'
          and normalized_definition like '%timezone = v_timezone%'
          and normalized_definition like '%join_available_from = p_join_available_from%'
          and normalized_definition like '%recording_url = v_recording_url%'
          and normalized_definition like '%and s.status = ''scheduled'' returning%',
          false
        ) else null end,
        'scheduled_correction_restricted_fields_absent', case when kind = 'meeting_correction' then coalesce(
          definition !~* E'(^|\\n)[[:space:]]*(course_id|cohort_id|trainer_user_id|scheduled_start_at|scheduled_end_at|delivery_mode|status)[[:space:]]*=',
          false
        ) else null end,
        'portal_return_shape_unchanged', case when kind = 'portal' then coalesce(
          regexp_replace(lower(result_type), '\s+', ' ', 'g') = lower('TABLE(tenant_id uuid, id uuid, course_id uuid, cohort_id uuid, course_title text, cohort_name text, title text, delivery_mode text, meeting_provider text, meeting_url text, join_available_from timestamp with time zone, recording_url text, timezone text, scheduled_start_at timestamp with time zone, scheduled_end_at timestamp with time zone, status text)'),
          false
        ) else null end,
        'scheduled_supported', case when kind = 'portal' then coalesce(normalized_definition like '%s.status in (''scheduled'', ''completed'', ''canceled'')%', false) else null end,
        'completed_supported', case when kind = 'portal' then coalesce(normalized_definition like '%s.status in (''scheduled'', ''completed'', ''canceled'')%', false) else null end,
        'canceled_supported', case when kind = 'portal' then coalesce(normalized_definition like '%s.status in (''scheduled'', ''completed'', ''canceled'')%', false) else null end,
        'canonical_access_retained', case when kind = 'portal' then coalesce(normalized_definition like '%student_portal_access_allowed(%', false) else null end,
        'exact_cohort_membership_retained', case when kind = 'portal' then coalesce(
          normalized_definition like '%from public.cohort_members cm%'
          and normalized_definition like '%cm.tenant_id = ctx.tenant_id%'
          and normalized_definition like '%cm.student_id = ctx.student_id%'
          and normalized_definition like '%cm.cohort_id = s.cohort_id%',
          false
        ) else null end,
        'scheduled_uses_participate', case when kind = 'portal' then coalesce(normalized_definition like '%vs.status = ''scheduled'' and vs.can_participate%', false) else null end,
        'completed_uses_read', case when kind = 'portal' then coalesce(normalized_definition like '%vs.status in (''completed'', ''canceled'') and vs.can_read%', false) else null end,
        'canceled_uses_read', case when kind = 'portal' then coalesce(normalized_definition like '%vs.status in (''completed'', ''canceled'') and vs.can_read%', false) else null end,
        'meeting_url_scheduled_only', case when kind = 'portal' then coalesce(
          normalized_definition like '%when vs.status = ''scheduled'' and vs.can_participate and vs.meeting_url is not null%'
          and normalized_definition like '%vs.join_available_from is null or now() >= vs.join_available_from%'
          and normalized_definition like '%then vs.meeting_url else null end as meeting_url%',
          false
        ) else null end,
        'recording_url_completed_only', case when kind = 'portal' then coalesce(
          normalized_definition like '%when vs.status = ''completed'' and vs.can_read and vs.recording_url is not null then vs.recording_url else null end as recording_url%',
          false
        ) else null end,
        'canceled_meeting_url_masked', case when kind = 'portal' then coalesce(
          normalized_definition like '%s.status in (''scheduled'', ''completed'', ''canceled'')%'
          and normalized_definition like '%when vs.status = ''scheduled''%then vs.meeting_url else null end as meeting_url%',
          false
        ) else null end,
        'canceled_recording_url_masked', case when kind = 'portal' then coalesce(
          normalized_definition like '%s.status in (''scheduled'', ''completed'', ''canceled'')%'
          and normalized_definition like '%when vs.status = ''completed''%then vs.recording_url else null end as recording_url%',
          false
        ) else null end,
        'meeting_secrets_absent', case when kind = 'portal' then coalesce(
          definition !~* '\mmeeting_id\M|\mmeeting_passcode\M',
          false
        ) else null end
      ) order by identity
    )
    from function_state
  ),
  'sessions_rls_enabled', (
    select c.relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'sessions'
  ),
  'sessions_direct_grants', (select value from direct_grants),
  'browser_write_grants', (select value from browser_writes),
  'student_direct_session_policies', (select value from student_direct_session_policies),
  'trainer_policy_state', (select value from trainer_policy_state),
  'cohorts_policies_referencing_cohort_members', (
    select cohorts_policies_referencing_cohort_members from policy_dependency_state
  ),
  'cohort_members_policies_referencing_cohorts', (
    select cohort_members_policies_referencing_cohorts from policy_dependency_state
  ),
  'actual_cohort_reciprocal_cycle', (
    select cohorts_policies_referencing_cohort_members > 0
      and cohort_members_policies_referencing_cohorts > 0
    from policy_dependency_state
  ),
  'attendance_policies_referencing_sessions', (
    select attendance_policies_referencing_sessions from policy_dependency_state
  ),
  'session_policies_referencing_attendance', (
    select session_policies_referencing_attendance from policy_dependency_state
  ),
  'actual_sessions_attendance_reciprocal_cycle', (
    select attendance_policies_referencing_sessions > 0
      and session_policies_referencing_attendance > 0
    from policy_dependency_state
  ),
  'canonical_ux5b_helper_installed', to_regprocedure('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)') is not null,
  'canonical_ux5b1_helper_installed', to_regprocedure('coachfort_internal.student_can_access_cohort(uuid,uuid,uuid,uuid,text)') is not null,
  'policies', (select value from policy_state)
) as verification_result;
*/
