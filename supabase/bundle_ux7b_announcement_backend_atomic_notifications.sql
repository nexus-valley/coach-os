/*
PRE-APPLY READ-ONLY VERIFICATION

Run this single query in Supabase SQL Editor before applying the executable
body. Mandatory baseline table absence is an immediate SQL failure and must be
treated as production drift.

with required_functions(identity) as (
  values
    ('public.get_student_announcements()'),
    ('public.get_team_announcements(uuid)'),
    ('public.create_academy_announcement(uuid,text,text,timestamptz)'),
    ('public.update_academy_announcement(uuid,text,text,timestamptz)'),
    ('public.publish_academy_announcement(uuid)'),
    ('public.archive_academy_announcement(uuid)'),
    ('public.m69_6_validate_notification_type(text)'),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    ('public.has_any_active_student_portal_account(uuid,uuid)'),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'),
    ('public.feature_access_effective_rows(uuid)'),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_cohort(uuid,uuid,uuid)'),
    ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
    ('public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
    ('public.m69_4_write_audit(uuid,text,text,uuid,text,text,text,jsonb)')
), function_state as (
  select
    identity,
    pg_catalog.to_regprocedure(identity) is not null as installed,
    case when pg_catalog.to_regprocedure(identity) is null then null else
      pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure(identity)::oid)
    end as result_type,
    case when pg_catalog.to_regprocedure(identity) is null then null else
      pg_catalog.pg_get_userbyid(p.proowner)
    end as owner,
    case when pg_catalog.to_regprocedure(identity) is null then null else p.prosecdef end
      as security_definer,
    case when pg_catalog.to_regprocedure(identity) is null then null else p.proconfig end
      as proconfig
  from required_functions rf
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(rf.identity)
), announcement_state as (
  select jsonb_build_object(
    'rows', count(*),
    'unsupported_status', count(*) filter (
      where status not in ('draft', 'published', 'archived')
    ),
    'unsupported_audience', count(*) filter (
      where audience_type not in ('all_students', 'tenant', 'program', 'cohort')
    ),
    'published_missing_published_at', count(*) filter (
      where status = 'published' and published_at is null
    ),
    'draft_with_published_at', count(*) filter (
      where status = 'draft' and published_at is not null
    ),
    'archived_missing_archived_at', count(*) filter (
      where status = 'archived' and archived_at is null
    ),
    'invalid_expiry', count(*) filter (
      where expires_at is not null and published_at is not null
        and expires_at <= published_at
    ),
    'blank_content', count(*) filter (
      where btrim(coalesce(title, '')) = '' or btrim(coalesce(body, '')) = ''
    )
  ) as value
  from public.academy_announcements
), announcement_table as (
  select jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(c.relowner),
    'rls_enabled', c.relrowsecurity,
    'force_rls', c.relforcerowsecurity,
    'course_id_column', exists (
      select 1 from information_schema.columns col
      where col.table_schema = 'public' and col.table_name = 'academy_announcements'
        and col.column_name = 'course_id'
    ),
    'cohort_id_column', exists (
      select 1 from information_schema.columns col
      where col.table_schema = 'public' and col.table_name = 'academy_announcements'
        and col.column_name = 'cohort_id'
    ),
    'browser_write_grants', (
      select count(*)
      from pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
      where (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
        and upper(acl.privilege_type) in (
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
        )
    ),
    'policy_count', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename = 'academy_announcements'
    )
  ) as value
  from pg_catalog.pg_class c
  where c.oid = 'public.academy_announcements'::regclass
), notification_state as (
  select jsonb_build_object(
    'rows', count(*),
    'announcement_notice_rows', count(*) filter (
      where type = 'announcement_notice' or entity_type = 'announcement'
    ),
    'duplicate_event_key_groups', (
      select count(*) from (
        select tenant_id, user_id, event_key
        from public.notifications
        where event_key is not null
        group by tenant_id, user_id, event_key
        having count(*) > 1
      ) duplicates
    ),
    'event_key_column', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'notifications'
        and c.column_name = 'event_key' and c.data_type = 'text'
    ),
    'event_key_unique_index', exists (
      select 1 from pg_catalog.pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'notifications'
        and i.indexname = 'notifications_tenant_user_event_key_uidx'
        and lower(i.indexdef) like '%unique%tenant_id, user_id, event_key%'
        and lower(i.indexdef) like '%where (event_key is not null)%'
    ),
    'type_check_supports_announcement', exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid = 'public.notifications'::regclass
        and con.contype = 'c'
        and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%announcement_notice%'
    )
  ) as value
  from public.notifications
), integrity_state as (
  select jsonb_build_object(
    'unsupported_enrollment_status', (
      select count(*) from public.enrollments e
      where e.status not in ('active', 'completed', 'paused', 'cancelled')
    ),
    'duplicate_enrollment_groups', (
      select count(*) from (
        select tenant_id, student_id, course_id
        from public.enrollments
        group by tenant_id, student_id, course_id
        having count(*) > 1
      ) duplicates
    ),
    'completed_at_drift', (
      select count(*) from public.enrollments e
      where (e.status = 'completed' and e.completed_at is null)
         or (e.status <> 'completed' and e.completed_at is not null)
    ),
    'enrollment_tenant_mismatch', (
      select count(*)
      from public.enrollments e
      left join public.students s on s.id = e.student_id
      left join public.courses c on c.id = e.course_id
      where s.id is null or c.id is null
         or s.tenant_id <> e.tenant_id or c.tenant_id <> e.tenant_id
    ),
    'cohort_course_tenant_mismatch', (
      select count(*)
      from public.cohorts co
      left join public.courses c on c.id = co.course_id
      where c.id is null or c.tenant_id <> co.tenant_id
    ),
    'cohort_member_tenant_mismatch', (
      select count(*)
      from public.cohort_members cm
      left join public.cohorts co on co.id = cm.cohort_id
      left join public.students s on s.id = cm.student_id
      where co.id is null or s.id is null
         or co.tenant_id <> cm.tenant_id or s.tenant_id <> cm.tenant_id
    )
  ) as value
), delegation_state as (
  select jsonb_build_object(
    'active_manage_messages', count(*),
    'null_or_unsupported_scope', count(*) filter (
      where scope_type is null
         or scope_type not in ('workspace', 'course', 'cohort')
    )
  ) as value
  from public.delegated_permissions
  where permission_key = 'manage_messages'
    and status = 'active'
    and starts_at <= now()
    and (expires_at is null or expires_at > now())
), internal_schema as (
  select jsonb_build_object(
    'installed', pg_catalog.to_regnamespace('coachfort_internal') is not null,
    'api_exposed', coalesce(
      'coachfort_internal' = any(pg_catalog.regexp_split_to_array(
        replace(pg_catalog.current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) setting
      cross join lateral pg_catalog.regexp_split_to_table(
        split_part(setting, '=', 2), ','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and rs.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) as value
), canonical_groups as (
  select jsonb_build_object(
    'community', (
      select count(*) from (values
        ('public.get_student_community_posts()'),
        ('public.get_student_community_comments(uuid)'),
        ('public.create_student_community_comment(uuid,text)'),
        ('public.get_team_community_posts(uuid)'),
        ('public.get_team_community_comments(uuid)'),
        ('public.create_team_community_post(uuid,text,text,text)'),
        ('public.update_team_community_post(uuid,text,text,text)'),
        ('public.publish_community_post(uuid)'),
        ('public.archive_community_post(uuid)'),
        ('public.hide_community_post(uuid)'),
        ('public.create_team_community_comment(uuid,text)'),
        ('public.hide_community_comment(uuid)')
      ) expected(identity)
      where pg_catalog.to_regprocedure(identity) is not null
    ),
    'academy_chat', (
      select count(*) from (values
        ('public.get_team_chat_threads(uuid)'),
        ('public.get_team_chat_thread(uuid)'),
        ('public.get_student_chat_threads()'),
        ('public.get_student_chat_thread(uuid)'),
        ('public.add_default_team_chat_participants(uuid,uuid,uuid,uuid)'),
        ('public.create_student_direct_chat(uuid,uuid,text,text)'),
        ('public.create_student_support_thread(text,text)'),
        ('public.send_team_chat_message(uuid,text)'),
        ('public.send_student_chat_message(uuid,text)'),
        ('public.close_chat_thread(uuid)'),
        ('public.mark_chat_thread_read(uuid)')
      ) expected(identity)
      where pg_catalog.to_regprocedure(identity) is not null
    )
  ) as value
)
select jsonb_build_object(
  'announcement_table', (select value from announcement_table),
  'announcement_data', (select value from announcement_state),
  'notification_contract', (select value from notification_state),
  'required_functions', coalesce((
    select jsonb_agg(to_jsonb(function_state) order by identity) from function_state
  ), '[]'::jsonb),
  'integrity', (select value from integrity_state),
  'delegation', (select value from delegation_state),
  'internal_schema', (select value from internal_schema),
  'canonical_groups', (select value from canonical_groups)
) as ux7b_pre_apply;
*/

begin;

lock table public.academy_announcements in share row exclusive mode;
lock table public.notifications in share row exclusive mode;

do $$
declare
  v_missing text;
  v_internal_exposed boolean;
begin
  select string_agg(required.identity, ', ' order by required.identity)
  into v_missing
  from (values
    ('public.get_student_announcements()'),
    ('public.get_team_announcements(uuid)'),
    ('public.create_academy_announcement(uuid,text,text,timestamptz)'),
    ('public.update_academy_announcement(uuid,text,text,timestamptz)'),
    ('public.publish_academy_announcement(uuid)'),
    ('public.archive_academy_announcement(uuid)'),
    ('public.m69_6_validate_notification_type(text)'),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    ('public.has_any_active_student_portal_account(uuid,uuid)'),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'),
    ('public.feature_access_effective_rows(uuid)'),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)'),
    ('public.ux4b_trainer_can_manage_cohort(uuid,uuid,uuid)'),
    ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
    ('public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
    ('public.m69_4_write_audit(uuid,text,text,uuid,text,text,text,jsonb)')
  ) required(identity)
  where pg_catalog.to_regprocedure(required.identity) is null;

  if v_missing is not null then
    raise exception 'UX-7B prerequisite function drift: %.', v_missing using errcode = '55000';
  end if;

  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'academy_announcements'
      and c.column_name in ('course_id', 'cohort_id')
  ) then
    raise exception 'UX-7B prerequisite failed: scope columns already exist.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.academy_announcements aa
    where aa.status not in ('draft', 'published', 'archived')
       or aa.audience_type <> 'all_students'
       or (aa.status = 'published' and aa.published_at is null)
       or (aa.status = 'draft' and aa.published_at is not null)
       or (aa.status = 'archived' and aa.archived_at is null)
       or (aa.expires_at is not null and aa.published_at is not null
           and aa.expires_at <= aa.published_at)
       or btrim(coalesce(aa.title, '')) = ''
       or btrim(coalesce(aa.body, '')) = ''
  ) then
    raise exception 'UX-7B prerequisite failed: announcement data drift.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.notifications n
    where n.type = 'announcement_notice' or n.entity_type = 'announcement'
  ) then
    raise exception 'UX-7B prerequisite failed: announcement notifications already exist.' using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'notifications'
      and c.column_name = 'event_key' and c.data_type = 'text'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'notifications'
      and i.indexname = 'notifications_tenant_user_event_key_uidx'
      and lower(i.indexdef) like '%unique%tenant_id, user_id, event_key%'
      and lower(i.indexdef) like '%where (event_key is not null)%'
  ) then
    raise exception 'UX-7B prerequisite failed: notification event-key contract drift.' using errcode = '55000';
  end if;

  if exists (
    select 1 from (
      select tenant_id, user_id, event_key
      from public.notifications
      where event_key is not null
      group by tenant_id, user_id, event_key
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'UX-7B prerequisite failed: duplicate notification event keys.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.delegated_permissions dp
    where dp.permission_key = 'manage_messages'
      and dp.status = 'active'
      and dp.starts_at <= now()
      and (dp.expires_at is null or dp.expires_at > now())
      and (dp.scope_type is null or dp.scope_type not in ('workspace', 'course', 'cohort'))
  ) then
    raise exception 'UX-7B prerequisite failed: active manage_messages scope drift.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.enrollments e
    where e.status not in ('active', 'completed', 'paused', 'cancelled')
       or (e.status = 'completed' and e.completed_at is null)
       or (e.status <> 'completed' and e.completed_at is not null)
  ) or exists (
    select 1 from (
      select tenant_id, student_id, course_id
      from public.enrollments
      group by tenant_id, student_id, course_id
      having count(*) > 1
    ) duplicates
  ) or exists (
    select 1
    from public.enrollments e
    left join public.students s on s.id = e.student_id
    left join public.courses c on c.id = e.course_id
    where s.id is null or c.id is null
       or s.tenant_id <> e.tenant_id or c.tenant_id <> e.tenant_id
  ) then
    raise exception 'UX-7B prerequisite failed: enrollment integrity drift.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.cohorts co
    left join public.courses c on c.id = co.course_id
    where c.id is null or c.tenant_id <> co.tenant_id
  ) or exists (
    select 1
    from public.cohort_members cm
    left join public.cohorts co on co.id = cm.cohort_id
    left join public.students s on s.id = cm.student_id
    where co.id is null or s.id is null
       or co.tenant_id <> cm.tenant_id or s.tenant_id <> cm.tenant_id
  ) or exists (
    select 1 from (
      select tenant_id, cohort_id, student_id
      from public.cohort_members
      group by tenant_id, cohort_id, student_id
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'UX-7B prerequisite failed: cohort integrity drift.' using errcode = '55000';
  end if;

  select coalesce(
    'coachfort_internal' = any(pg_catalog.regexp_split_to_array(
      replace(pg_catalog.current_setting('pgrst.db_schemas', true), ' ', ''), ','
    )), false
  ) or exists (
    select 1
    from pg_catalog.pg_db_role_setting rs
    join pg_catalog.pg_roles r on r.oid = rs.setrole
    cross join lateral unnest(rs.setconfig) setting
    cross join lateral pg_catalog.regexp_split_to_table(
      split_part(setting, '=', 2), ','
    ) exposed(schema_name)
    where r.rolname = 'authenticator'
      and rs.setdatabase in (
        0,
        (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
      )
      and setting like 'pgrst.db_schemas=%'
      and btrim(exposed.schema_name) = 'coachfort_internal'
  ) into v_internal_exposed;

  if v_internal_exposed then
    raise exception 'UX-7B prerequisite failed: internal schema is API exposed.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid = 'public.academy_announcements'::regclass
      and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
      and upper(acl.privilege_type) in (
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
      )
  ) then
    raise exception 'UX-7B prerequisite failed: browser announcement write grant.' using errcode = '55000';
  end if;
end;
$$;

alter table public.academy_announcements
  add column course_id uuid,
  add column cohort_id uuid;

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_reminder',
    'attendance_alert',
    'payment_reminder',
    'invoice_notice',
    'invitation_notice',
    'system_notice',
    'subscription_notice',
    'assignment_notice',
    'live_session_notice',
    'communication_notice',
    'announcement_notice'
  ));

create or replace function public.m69_6_validate_notification_type(p_type text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_type is null or p_type not in (
    'attendance_alert',
    'announcement_notice',
    'assignment_notice',
    'communication_notice',
    'invitation_notice',
    'invoice_notice',
    'live_session_notice',
    'payment_reminder',
    'session_reminder',
    'subscription_notice',
    'system_notice'
  ) then
    raise exception 'Select a valid notification type.' using errcode = '22023';
  end if;

  return p_type;
end;
$$;

create or replace function coachfort_internal.log_announcement_delegation(
  p_tenant_id uuid,
  p_announcement_id uuid,
  p_action text,
  p_permission_id uuid,
  p_scope_type text,
  p_scope_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_permission_id is not null then
    perform public.log_delegated_permission_used(
      p_tenant_id,
      auth.uid(),
      p_permission_id,
      p_action,
      'academy_announcement',
      p_announcement_id,
      p_scope_type,
      p_scope_id
    );
  end if;
end;
$$;

create or replace function coachfort_internal.create_announcement(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz,
  p_audience_type text,
  p_course_id uuid,
  p_cohort_id uuid,
  p_legacy_staff_compat boolean
)
returns public.academy_announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_announcement public.academy_announcements%rowtype;
  v_auth record;
  v_scope record;
  v_title text := public.m75b_validate_text(p_title, 'Announcement title', true, 180);
  v_body text := public.m75b_validate_text(p_body, 'Announcement body', true, 6000);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Announcement expiry must be in the future.' using errcode = '22023';
  end if;

  select * into v_scope
  from coachfort_internal.normalize_announcement_scope(
    p_tenant_id, p_audience_type, p_course_id, p_cohort_id
  );

  select * into v_auth
  from coachfort_internal.announcement_authorization_context(
    p_tenant_id,
    v_scope.audience_type,
    v_scope.course_id,
    v_scope.cohort_id,
    p_legacy_staff_compat
  );

  if not found then
    raise exception 'You do not have permission to create this announcement.' using errcode = '42501';
  end if;

  insert into public.academy_announcements (
    tenant_id, title, body, status, audience_type, course_id, cohort_id,
    expires_at, created_by
  ) values (
    p_tenant_id, v_title, v_body, 'draft', v_scope.audience_type,
    v_scope.course_id, v_scope.cohort_id, p_expires_at, auth.uid()
  ) returning * into v_announcement;

  perform public.m69_4_write_audit(
    p_tenant_id,
    'announcement_created',
    'academy_announcement',
    v_announcement.id,
    null,
    'Created an announcement draft.',
    'info',
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_announcement.status,
      'audience_type', v_announcement.audience_type,
      'course_id', v_announcement.course_id,
      'cohort_id', v_announcement.cohort_id
    ))
  );
  perform coachfort_internal.log_announcement_delegation(
    p_tenant_id, v_announcement.id, 'announcement_created',
    v_auth.delegated_permission_id, v_auth.delegated_scope_type, v_auth.delegated_scope_id
  );
  return v_announcement;
end;
$$;

create or replace function coachfort_internal.update_announcement(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz,
  p_audience_type text,
  p_course_id uuid,
  p_cohort_id uuid,
  p_legacy_staff_compat boolean
)
returns public.academy_announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.academy_announcements%rowtype;
  v_announcement public.academy_announcements%rowtype;
  v_auth record;
  v_scope record;
  v_title text := public.m75b_validate_text(p_title, 'Announcement title', true, 180);
  v_body text := public.m75b_validate_text(p_body, 'Announcement body', true, 6000);
  v_changed_fields text[] := array[]::text[];
begin
  if auth.uid() is null or p_announcement_id is null then
    raise exception 'Authentication and announcement are required.' using errcode = '42501';
  end if;

  select aa.* into v_existing
  from public.academy_announcements aa
  where aa.id = p_announcement_id
  for update;

  if not found then
    raise exception 'Announcement not found.' using errcode = '22023';
  end if;
  if v_existing.status = 'archived' then
    raise exception 'Archived announcements cannot be edited.' using errcode = '22023';
  end if;
  if p_legacy_staff_compat and v_existing.audience_type <> 'tenant' then
    raise exception 'This announcement requires the current announcement editor.' using errcode = '42501';
  end if;

  if v_existing.status = 'published' then
    if p_audience_type is null and p_course_id is null and p_cohort_id is null then
      select * into v_scope
      from coachfort_internal.normalize_announcement_scope(
        v_existing.tenant_id,
        v_existing.audience_type,
        v_existing.course_id,
        v_existing.cohort_id
      );
    else
      select * into v_scope
      from coachfort_internal.normalize_announcement_scope(
        v_existing.tenant_id,
        coalesce(p_audience_type, v_existing.audience_type),
        p_course_id,
        p_cohort_id
      );
      if v_scope.audience_type is distinct from v_existing.audience_type
         or v_scope.course_id is distinct from v_existing.course_id
         or v_scope.cohort_id is distinct from v_existing.cohort_id then
        raise exception 'Published announcement audience cannot be changed.' using errcode = '22023';
      end if;
    end if;
  else
    select * into v_scope
    from coachfort_internal.normalize_announcement_scope(
      v_existing.tenant_id,
      coalesce(p_audience_type, v_existing.audience_type),
      case when p_audience_type is null and p_course_id is null
        then v_existing.course_id else p_course_id end,
      case when p_audience_type is null and p_cohort_id is null
        then v_existing.cohort_id else p_cohort_id end
    );
  end if;

  if p_expires_at is not null
     and (p_expires_at <= now()
       or (v_existing.published_at is not null and p_expires_at <= v_existing.published_at)) then
    raise exception 'Announcement expiry must be in the future and after publication.' using errcode = '22023';
  end if;

  select * into v_auth
  from coachfort_internal.announcement_authorization_context(
    v_existing.tenant_id, v_scope.audience_type, v_scope.course_id, v_scope.cohort_id,
    p_legacy_staff_compat
  );
  if not found then
    raise exception 'You do not have permission to update this announcement.' using errcode = '42501';
  end if;

  if v_title is distinct from v_existing.title then v_changed_fields := array_append(v_changed_fields, 'title'); end if;
  if v_body is distinct from v_existing.body then v_changed_fields := array_append(v_changed_fields, 'body'); end if;
  if p_expires_at is distinct from v_existing.expires_at then v_changed_fields := array_append(v_changed_fields, 'expires_at'); end if;
  if v_scope.audience_type is distinct from v_existing.audience_type
     or v_scope.course_id is distinct from v_existing.course_id
     or v_scope.cohort_id is distinct from v_existing.cohort_id then
    v_changed_fields := array_append(v_changed_fields, 'audience');
  end if;

  update public.academy_announcements aa
  set title = v_title,
      body = v_body,
      expires_at = p_expires_at,
      audience_type = v_scope.audience_type,
      course_id = v_scope.course_id,
      cohort_id = v_scope.cohort_id
  where aa.id = v_existing.id
  returning * into v_announcement;

  perform public.m69_4_write_audit(
    v_existing.tenant_id,
    'announcement_updated',
    'academy_announcement',
    v_existing.id,
    null,
    'Updated an announcement.',
    'info',
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_announcement.status,
      'audience_type', v_announcement.audience_type,
      'course_id', v_announcement.course_id,
      'cohort_id', v_announcement.cohort_id,
      'changed_fields', to_jsonb(v_changed_fields)
    ))
  );
  perform coachfort_internal.log_announcement_delegation(
    v_existing.tenant_id, v_existing.id, 'announcement_updated',
    v_auth.delegated_permission_id, v_auth.delegated_scope_type, v_auth.delegated_scope_id
  );
  return v_announcement;
end;
$$;

create or replace function coachfort_internal.publish_announcement(
  p_announcement_id uuid,
  p_legacy_staff_compat boolean
)
returns public.academy_announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.academy_announcements%rowtype;
  v_announcement public.academy_announcements%rowtype;
  v_auth record;
  v_recipient_count integer := 0;
  v_notifications_enabled boolean := false;
begin
  if auth.uid() is null or p_announcement_id is null then
    raise exception 'Authentication and announcement are required.' using errcode = '42501';
  end if;

  select aa.* into v_existing
  from public.academy_announcements aa
  where aa.id = p_announcement_id
  for update;

  if not found then raise exception 'Announcement not found.' using errcode = '22023'; end if;
  if v_existing.status = 'published' then
    raise exception 'Announcement is already published.' using errcode = '22023';
  elsif v_existing.status = 'archived' then
    raise exception 'Archived announcements cannot be published.' using errcode = '22023';
  elsif v_existing.status <> 'draft' then
    raise exception 'Announcement lifecycle state is invalid.' using errcode = '22023';
  end if;
  if p_legacy_staff_compat and v_existing.audience_type <> 'tenant' then
    raise exception 'This announcement requires the current announcement editor.' using errcode = '42501';
  end if;
  if v_existing.expires_at is not null and v_existing.expires_at <= now() then
    raise exception 'Announcement expiry must be in the future.' using errcode = '22023';
  end if;

  select * into v_auth
  from coachfort_internal.announcement_authorization_context(
    v_existing.tenant_id, v_existing.audience_type, v_existing.course_id,
    v_existing.cohort_id, p_legacy_staff_compat
  );
  if not found then
    raise exception 'You do not have permission to publish this announcement.' using errcode = '42501';
  end if;

  update public.academy_announcements aa
  set status = 'published', published_at = now(), archived_at = null
  where aa.id = v_existing.id
  returning * into v_announcement;

  select exists (
    select 1 from public.feature_access_effective_rows(v_existing.tenant_id) feature
    where feature.feature_key = 'notifications' and feature.status = 'enabled'
  ) into v_notifications_enabled;

  if v_notifications_enabled then
    with eligible_recipients as (
      select distinct spa.user_id
      from public.students s
      join public.student_portal_accounts spa
        on spa.tenant_id = s.tenant_id and spa.student_id = s.id
      where s.tenant_id = v_announcement.tenant_id
        and coachfort_internal.student_portal_access_allowed_for_user(
          s.tenant_id, s.id, spa.user_id, null, 'portal'
        )
        and (
          v_announcement.audience_type = 'tenant'
          or (
            v_announcement.audience_type in ('program', 'cohort')
            and coachfort_internal.student_portal_access_allowed_for_user(
              s.tenant_id, s.id, spa.user_id, v_announcement.course_id, 'course_participate'
            )
            and (
              v_announcement.audience_type = 'program'
              or exists (
                select 1 from public.cohort_members cm
                where cm.tenant_id = s.tenant_id
                  and cm.cohort_id = v_announcement.cohort_id
                  and cm.student_id = s.id
              )
            )
          )
        )
    )
    insert into public.notifications (
      tenant_id, user_id, type, title, message, entity_type, entity_id,
      severity, status, action_url, metadata_json, event_key
    )
    select
      v_announcement.tenant_id,
      recipient.user_id,
      'announcement_notice',
      v_announcement.title,
      left(regexp_replace(v_announcement.body, E'[\\n\\r\\t ]+', ' ', 'g'), 240),
      'announcement',
      v_announcement.id,
      'info',
      'unread',
      '/portal/announcements?announcement=' || v_announcement.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'audience_type', v_announcement.audience_type,
        'course_id', v_announcement.course_id,
        'cohort_id', v_announcement.cohort_id
      )),
      'announcement:' || v_announcement.id::text || ':published'
    from eligible_recipients recipient
    on conflict (tenant_id, user_id, event_key)
    where event_key is not null
    do nothing;
    get diagnostics v_recipient_count = row_count;
  end if;

  perform public.m69_4_write_audit(
    v_announcement.tenant_id,
    'announcement_published',
    'academy_announcement',
    v_announcement.id,
    null,
    'Published an announcement.',
    'info',
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_announcement.status,
      'audience_type', v_announcement.audience_type,
      'course_id', v_announcement.course_id,
      'cohort_id', v_announcement.cohort_id,
      'in_app_recipient_count', v_recipient_count
    ))
  );
  perform coachfort_internal.log_announcement_delegation(
    v_announcement.tenant_id, v_announcement.id, 'announcement_published',
    v_auth.delegated_permission_id, v_auth.delegated_scope_type, v_auth.delegated_scope_id
  );
  return v_announcement;
end;
$$;

create or replace function coachfort_internal.archive_announcement(
  p_announcement_id uuid,
  p_legacy_staff_compat boolean
)
returns public.academy_announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.academy_announcements%rowtype;
  v_announcement public.academy_announcements%rowtype;
  v_auth record;
begin
  if auth.uid() is null or p_announcement_id is null then
    raise exception 'Authentication and announcement are required.' using errcode = '42501';
  end if;
  select aa.* into v_existing from public.academy_announcements aa
  where aa.id = p_announcement_id for update;
  if not found then raise exception 'Announcement not found.' using errcode = '22023'; end if;
  if v_existing.status = 'archived' then
    raise exception 'Announcement is already archived.' using errcode = '22023';
  end if;
  if (not p_legacy_staff_compat and v_existing.status <> 'published')
     or (p_legacy_staff_compat and v_existing.status not in ('draft', 'published')) then
    raise exception 'Only published announcements can be archived.' using errcode = '22023';
  end if;
  if p_legacy_staff_compat and v_existing.audience_type <> 'tenant' then
    raise exception 'This announcement requires the current announcement editor.' using errcode = '42501';
  end if;

  select * into v_auth
  from coachfort_internal.announcement_authorization_context(
    v_existing.tenant_id, v_existing.audience_type, v_existing.course_id,
    v_existing.cohort_id, p_legacy_staff_compat
  );
  if not found then
    raise exception 'You do not have permission to archive this announcement.' using errcode = '42501';
  end if;

  update public.academy_announcements aa
  set status = 'archived', archived_at = now()
  where aa.id = v_existing.id returning * into v_announcement;

  perform public.m69_4_write_audit(
    v_announcement.tenant_id, 'announcement_archived', 'academy_announcement',
    v_announcement.id, null, 'Archived an announcement.', 'info',
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_announcement.status,
      'audience_type', v_announcement.audience_type,
      'course_id', v_announcement.course_id,
      'cohort_id', v_announcement.cohort_id
    ))
  );
  perform coachfort_internal.log_announcement_delegation(
    v_announcement.tenant_id, v_announcement.id, 'announcement_archived',
    v_auth.delegated_permission_id, v_auth.delegated_scope_type, v_auth.delegated_scope_id
  );
  return v_announcement;
end;
$$;

create or replace function coachfort_internal.delete_draft_announcement(
  p_announcement_id uuid
)
returns public.academy_announcements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.academy_announcements%rowtype;
  v_auth record;
begin
  if auth.uid() is null or p_announcement_id is null then
    raise exception 'Authentication and announcement are required.' using errcode = '42501';
  end if;
  select aa.* into v_existing from public.academy_announcements aa
  where aa.id = p_announcement_id for update;
  if not found then raise exception 'Announcement not found.' using errcode = '22023'; end if;
  if v_existing.status <> 'draft' then
    raise exception 'Only draft announcements can be deleted.' using errcode = '22023';
  end if;

  select * into v_auth
  from coachfort_internal.announcement_authorization_context(
    v_existing.tenant_id, v_existing.audience_type, v_existing.course_id,
    v_existing.cohort_id, false
  );
  if not found then
    raise exception 'You do not have permission to delete this announcement.' using errcode = '42501';
  end if;

  delete from public.academy_announcements aa where aa.id = v_existing.id;
  perform public.m69_4_write_audit(
    v_existing.tenant_id, 'announcement_draft_deleted', 'academy_announcement',
    v_existing.id, null, 'Deleted an announcement draft.', 'info',
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_existing.status,
      'audience_type', v_existing.audience_type,
      'course_id', v_existing.course_id,
      'cohort_id', v_existing.cohort_id
    ))
  );
  perform coachfort_internal.log_announcement_delegation(
    v_existing.tenant_id, v_existing.id, 'announcement_draft_deleted',
    v_auth.delegated_permission_id, v_auth.delegated_scope_type, v_auth.delegated_scope_id
  );
  return v_existing;
end;
$$;

alter table public.academy_announcements
  add constraint academy_announcements_course_id_fkey
    foreign key (course_id) references public.courses(id) on delete restrict,
  add constraint academy_announcements_cohort_id_fkey
    foreign key (cohort_id) references public.cohorts(id) on delete restrict;

alter table public.academy_announcements
  drop constraint academy_announcements_audience_type_check;

update public.academy_announcements
set audience_type = 'tenant'
where audience_type = 'all_students';

alter table public.academy_announcements
  alter column audience_type set default 'tenant',
  add constraint academy_announcements_audience_type_check
    check (audience_type in ('tenant', 'program', 'cohort')),
  add constraint academy_announcements_scope_shape_check
    check (
      (audience_type = 'tenant' and course_id is null and cohort_id is null)
      or (audience_type = 'program' and course_id is not null and cohort_id is null)
      or (audience_type = 'cohort' and course_id is not null and cohort_id is not null)
    ),
  add constraint academy_announcements_published_expiry_check
    check (expires_at is null or published_at is null or expires_at > published_at);

create index academy_announcements_student_feed_idx
  on public.academy_announcements (
    tenant_id, audience_type, course_id, cohort_id, published_at desc, id desc
  )
  where status = 'published';

create index academy_announcements_team_feed_idx
  on public.academy_announcements (tenant_id, updated_at desc, id desc);

create index notifications_announcement_aggregate_idx
  on public.notifications (tenant_id, entity_type, entity_id, status)
  where entity_type = 'announcement';

create or replace function coachfort_internal.normalize_announcement_scope(
  p_tenant_id uuid,
  p_audience_type text,
  p_course_id uuid,
  p_cohort_id uuid
)
returns table (
  audience_type text,
  course_id uuid,
  cohort_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_audience text := lower(btrim(coalesce(p_audience_type, '')));
  v_cohort public.cohorts%rowtype;
begin
  if p_tenant_id is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  if v_audience not in ('tenant', 'program', 'cohort') then
    raise exception 'Select a valid announcement audience.' using errcode = '22023';
  end if;

  if v_audience = 'tenant' then
    if p_course_id is not null or p_cohort_id is not null then
      raise exception 'Workspace announcements cannot target a Program or Cohort.' using errcode = '22023';
    end if;
    return query select 'tenant'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_audience = 'program' then
    if p_course_id is null or p_cohort_id is not null or not exists (
      select 1 from public.courses c
      where c.id = p_course_id and c.tenant_id = p_tenant_id
    ) then
      raise exception 'Program announcement scope is invalid.' using errcode = '22023';
    end if;
    return query select 'program'::text, p_course_id, null::uuid;
    return;
  end if;

  if p_cohort_id is null then
    raise exception 'Cohort announcement scope is invalid.' using errcode = '22023';
  end if;

  select co.* into v_cohort
  from public.cohorts co
  where co.id = p_cohort_id and co.tenant_id = p_tenant_id;

  if not found
     or (p_course_id is not null and p_course_id is distinct from v_cohort.course_id) then
    raise exception 'Cohort announcement scope is invalid.' using errcode = '22023';
  end if;

  return query select 'cohort'::text, v_cohort.course_id, v_cohort.id;
end;
$$;

create or replace function coachfort_internal.enforce_announcement_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope record;
begin
  select * into v_scope
  from coachfort_internal.normalize_announcement_scope(
    new.tenant_id, new.audience_type, new.course_id, new.cohort_id
  );
  new.audience_type := v_scope.audience_type;
  new.course_id := v_scope.course_id;
  new.cohort_id := v_scope.cohort_id;
  return new;
end;
$$;

create trigger enforce_academy_announcement_scope
before insert or update of tenant_id, audience_type, course_id, cohort_id
on public.academy_announcements
for each row execute function coachfort_internal.enforce_announcement_scope();

create or replace function coachfort_internal.announcement_authorization_context(
  p_tenant_id uuid,
  p_audience_type text,
  p_course_id uuid,
  p_cohort_id uuid,
  p_legacy_staff_compat boolean default false
)
returns table (
  actor_role text,
  delegated_permission_id uuid,
  delegated_scope_type text,
  delegated_scope_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_permission_id uuid;
  v_permission public.delegated_permissions%rowtype;
  v_role text;
begin
  if v_actor is null or p_tenant_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.feature_access_effective_rows(p_tenant_id) feature
    where feature.feature_key = 'messages' and feature.status = 'enabled'
  ) then
    return;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = v_actor
  limit 1;

  if v_role in ('owner', 'admin') then
    return query select v_role, null::uuid, null::text, null::uuid;
    return;
  end if;

  if p_legacy_staff_compat then
    if v_role = 'staff' and p_audience_type = 'tenant'
       and p_course_id is null and p_cohort_id is null then
      return query select v_role, null::uuid, null::text, null::uuid;
    end if;
    return;
  end if;

  if v_role not in ('staff', 'trainer') or p_audience_type = 'tenant' then
    if v_role = 'staff' and p_audience_type = 'tenant' then
      v_permission_id := public.find_active_delegated_permission_for_action(
        p_tenant_id, v_actor, array['manage_messages'],
        null, null, null, null, null
      );
    else
      return;
    end if;
  else
    v_permission_id := public.find_active_delegated_permission_for_action(
      p_tenant_id, v_actor, array['manage_messages'],
      p_course_id, p_cohort_id, null, null, null
    );
  end if;

  if v_permission_id is null then
    return;
  end if;

  select dp.* into v_permission
  from public.delegated_permissions dp
  where dp.id = v_permission_id
    and dp.tenant_id = p_tenant_id
    and dp.user_id = v_actor
    and dp.permission_key = 'manage_messages'
    and dp.status = 'active'
    and dp.starts_at <= now()
    and (dp.expires_at is null or dp.expires_at > now());

  if not found or v_permission.scope_type is null then
    return;
  end if;

  if p_audience_type = 'tenant' then
    if v_role <> 'staff' or v_permission.scope_type <> 'workspace' then return; end if;
  elsif p_audience_type = 'program' then
    if not (
      v_permission.scope_type = 'workspace'
      or (v_permission.scope_type = 'course' and v_permission.scope_id = p_course_id)
    ) then return; end if;
  elsif p_audience_type = 'cohort' then
    if not (
      v_permission.scope_type = 'workspace'
      or (v_permission.scope_type = 'course' and v_permission.scope_id = p_course_id)
      or (v_permission.scope_type = 'cohort' and v_permission.scope_id = p_cohort_id)
    ) then return; end if;
  else
    return;
  end if;

  if v_role = 'trainer' then
    if p_audience_type = 'program' and not public.ux4b_trainer_can_manage_course(
      p_tenant_id, v_actor, p_course_id
    ) then return; end if;
    if p_audience_type = 'cohort' and not public.ux4b_trainer_can_manage_cohort(
      p_tenant_id, v_actor, p_cohort_id
    ) then return; end if;
  end if;

  return query select
    v_role, v_permission.id, v_permission.scope_type, v_permission.scope_id;
end;
$$;

create or replace function coachfort_internal.student_can_read_announcement(
  p_announcement_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_announcement public.academy_announcements%rowtype;
begin
  if p_announcement_id is null
     or p_user_id is null
     or p_user_id is distinct from auth.uid() then
    return false;
  end if;

  select aa.* into v_announcement
  from public.academy_announcements aa
  where aa.id = p_announcement_id
    and aa.status = 'published'
    and aa.published_at is not null
    and aa.published_at <= now()
    and (aa.expires_at is null or aa.expires_at > now());

  if not found or not exists (
    select 1 from public.feature_access_effective_rows(v_announcement.tenant_id) feature
    where feature.feature_key = 'messages' and feature.status = 'enabled'
  ) then return false; end if;

  return exists (
    select 1
    from public.students s
    join public.student_portal_accounts spa
      on spa.tenant_id = s.tenant_id and spa.student_id = s.id
    where s.tenant_id = v_announcement.tenant_id
      and spa.user_id = p_user_id
      and coachfort_internal.student_portal_access_allowed_for_user(
        s.tenant_id, s.id, spa.user_id, null, 'portal'
      )
      and (
        v_announcement.audience_type = 'tenant'
        or (
          v_announcement.audience_type in ('program', 'cohort')
          and exists (
            select 1
            from public.enrollments e
            join public.courses c
              on c.tenant_id = e.tenant_id and c.id = e.course_id
            where e.tenant_id = s.tenant_id
              and e.student_id = s.id
              and e.course_id = v_announcement.course_id
              and coachfort_internal.student_portal_access_allowed_for_user(
                s.tenant_id, s.id, spa.user_id, e.course_id, 'course_read'
              )
              and (
                (e.status = 'active' and c.status = 'published')
                or (
                  e.status = 'completed'
                  and e.completed_at is not null
                  and c.status in ('published', 'archived')
                  and v_announcement.published_at <= e.completed_at
                )
              )
          )
          and (
            v_announcement.audience_type = 'program'
            or exists (
              select 1 from public.cohort_members cm
              where cm.tenant_id = s.tenant_id
                and cm.cohort_id = v_announcement.cohort_id
                and cm.student_id = s.id
            )
          )
        )
      )
  );
end;
$$;

create or replace function public.get_student_announcements_v2(
  p_limit integer default 25,
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  title text,
  body text,
  audience_type text,
  course_id uuid,
  course_title text,
  cohort_id uuid,
  cohort_name text,
  published_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz,
  notification_id uuid,
  attention_state text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using errcode = '22023';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_id is null) then
    raise exception 'Announcement cursor is invalid.' using errcode = '22023';
  end if;

  return query
  select
    aa.id,
    aa.title,
    aa.body,
    aa.audience_type,
    aa.course_id,
    c.title,
    aa.cohort_id,
    co.name,
    aa.published_at,
    aa.expires_at,
    aa.updated_at,
    notice.id,
    case
      when notice.id is null then null
      when notice.status = 'read' or notice.read_at is not null then 'read'
      when notice.status = 'unread' then 'unread'
      else null
    end
  from public.academy_announcements aa
  left join public.courses c
    on c.id = aa.course_id and c.tenant_id = aa.tenant_id
  left join public.cohorts co
    on co.id = aa.cohort_id and co.tenant_id = aa.tenant_id
  left join lateral (
    select n.id, n.status, n.read_at
    from public.notifications n
    where n.tenant_id = aa.tenant_id
      and n.user_id = auth.uid()
      and n.entity_type = 'announcement'
      and n.entity_id = aa.id
      and n.event_key = 'announcement:' || aa.id::text || ':published'
    order by n.created_at desc, n.id desc
    limit 1
  ) notice on true
  where coachfort_internal.student_can_read_announcement(aa.id, auth.uid())
    and (
      p_cursor_published_at is null
      or (aa.published_at, aa.id) < (p_cursor_published_at, p_cursor_id)
    )
  order by aa.published_at desc, aa.id desc
  limit p_limit;
end;
$$;

create or replace function public.get_student_announcement_v2(
  p_announcement_id uuid
)
returns table (
  id uuid,
  title text,
  body text,
  audience_type text,
  course_id uuid,
  course_title text,
  cohort_id uuid,
  cohort_name text,
  published_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz,
  notification_id uuid,
  attention_state text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    aa.id,
    aa.title,
    aa.body,
    aa.audience_type,
    aa.course_id,
    c.title,
    aa.cohort_id,
    co.name,
    aa.published_at,
    aa.expires_at,
    aa.updated_at,
    notice.id,
    case
      when notice.id is null then null
      when notice.status = 'read' or notice.read_at is not null then 'read'
      when notice.status = 'unread' then 'unread'
      else null
    end
  from public.academy_announcements aa
  left join public.courses c
    on c.id = aa.course_id and c.tenant_id = aa.tenant_id
  left join public.cohorts co
    on co.id = aa.cohort_id and co.tenant_id = aa.tenant_id
  left join lateral (
    select n.id, n.status, n.read_at
    from public.notifications n
    where n.tenant_id = aa.tenant_id
      and n.user_id = auth.uid()
      and n.entity_type = 'announcement'
      and n.entity_id = aa.id
      and n.event_key = 'announcement:' || aa.id::text || ':published'
    order by n.created_at desc, n.id desc
    limit 1
  ) notice on true
  where aa.id = p_announcement_id
    and coachfort_internal.student_can_read_announcement(aa.id, auth.uid())
$$;

create or replace function public.get_team_announcements_v2(
  p_tenant_id uuid,
  p_status text default null,
  p_audience_type text default null,
  p_limit integer default 25,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  title text,
  body_preview text,
  status text,
  audience_type text,
  course_id uuid,
  course_title text,
  cohort_id uuid,
  cohort_name text,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  in_app_recipient_count bigint,
  read_count bigint,
  unread_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_tenant_id is null then
    raise exception 'Authentication and workspace are required.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using errcode = '22023';
  end if;
  if (p_cursor_updated_at is null) <> (p_cursor_id is null) then
    raise exception 'Announcement cursor is invalid.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('draft', 'published', 'archived') then
    raise exception 'Announcement status filter is invalid.' using errcode = '22023';
  end if;
  if p_audience_type is not null and p_audience_type not in ('tenant', 'program', 'cohort') then
    raise exception 'Announcement audience filter is invalid.' using errcode = '22023';
  end if;

  return query
  select
    aa.id,
    aa.title,
    left(regexp_replace(aa.body, E'[\\n\\r\\t ]+', ' ', 'g'), 240),
    aa.status,
    aa.audience_type,
    aa.course_id,
    c.title,
    aa.cohort_id,
    co.name,
    aa.published_at,
    aa.expires_at,
    aa.created_at,
    aa.updated_at,
    aa.archived_at,
    coalesce(notice.recipient_count, 0),
    coalesce(notice.read_count, 0),
    coalesce(notice.unread_count, 0)
  from public.academy_announcements aa
  left join public.courses c
    on c.id = aa.course_id and c.tenant_id = aa.tenant_id
  left join public.cohorts co
    on co.id = aa.cohort_id and co.tenant_id = aa.tenant_id
  left join lateral (
    select
      count(*)::bigint as recipient_count,
      count(*) filter (where n.status = 'read' or n.read_at is not null)::bigint as read_count,
      count(*) filter (where n.status = 'unread' and n.read_at is null)::bigint as unread_count
    from public.notifications n
    where n.tenant_id = aa.tenant_id
      and n.entity_type = 'announcement'
      and n.entity_id = aa.id
      and n.event_key = 'announcement:' || aa.id::text || ':published'
  ) notice on true
  where aa.tenant_id = p_tenant_id
    and (p_status is null or aa.status = p_status)
    and (p_audience_type is null or aa.audience_type = p_audience_type)
    and exists (
      select 1 from coachfort_internal.announcement_authorization_context(
        aa.tenant_id, aa.audience_type, aa.course_id, aa.cohort_id, false
      )
    )
    and (
      p_cursor_updated_at is null
      or (aa.updated_at, aa.id) < (p_cursor_updated_at, p_cursor_id)
    )
  order by aa.updated_at desc, aa.id desc
  limit p_limit;
end;
$$;

create or replace function public.get_team_announcement_v2(
  p_tenant_id uuid,
  p_announcement_id uuid
)
returns table (
  id uuid,
  title text,
  body text,
  status text,
  audience_type text,
  course_id uuid,
  course_title text,
  cohort_id uuid,
  cohort_name text,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  in_app_recipient_count bigint,
  read_count bigint,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    aa.id,
    aa.title,
    aa.body,
    aa.status,
    aa.audience_type,
    aa.course_id,
    c.title,
    aa.cohort_id,
    co.name,
    aa.published_at,
    aa.expires_at,
    aa.created_at,
    aa.updated_at,
    aa.archived_at,
    coalesce(notice.recipient_count, 0),
    coalesce(notice.read_count, 0),
    coalesce(notice.unread_count, 0)
  from public.academy_announcements aa
  left join public.courses c
    on c.id = aa.course_id and c.tenant_id = aa.tenant_id
  left join public.cohorts co
    on co.id = aa.cohort_id and co.tenant_id = aa.tenant_id
  left join lateral (
    select
      count(*)::bigint as recipient_count,
      count(*) filter (where n.status = 'read' or n.read_at is not null)::bigint as read_count,
      count(*) filter (where n.status = 'unread' and n.read_at is null)::bigint as unread_count
    from public.notifications n
    where n.tenant_id = aa.tenant_id
      and n.entity_type = 'announcement'
      and n.entity_id = aa.id
      and n.event_key = 'announcement:' || aa.id::text || ':published'
  ) notice on true
  where aa.tenant_id = p_tenant_id
    and aa.id = p_announcement_id
    and exists (
      select 1 from coachfort_internal.announcement_authorization_context(
        aa.tenant_id, aa.audience_type, aa.course_id, aa.cohort_id, false
      )
    )
$$;

create or replace function public.create_academy_announcement_v2(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz default null,
  p_audience_type text default 'tenant',
  p_course_id uuid default null,
  p_cohort_id uuid default null
)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.create_announcement(
    p_tenant_id, p_title, p_body, p_expires_at, p_audience_type,
    p_course_id, p_cohort_id, false
  )
$$;

create or replace function public.update_academy_announcement_v2(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz default null,
  p_audience_type text default null,
  p_course_id uuid default null,
  p_cohort_id uuid default null
)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.update_announcement(
    p_announcement_id, p_title, p_body, p_expires_at, p_audience_type,
    p_course_id, p_cohort_id, false
  )
$$;

create or replace function public.publish_academy_announcement_v2(p_announcement_id uuid)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.publish_announcement(p_announcement_id, false)
$$;

create or replace function public.archive_academy_announcement_v2(p_announcement_id uuid)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.archive_announcement(p_announcement_id, false)
$$;

create or replace function public.delete_draft_academy_announcement_v2(p_announcement_id uuid)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.delete_draft_announcement(p_announcement_id)
$$;

-- Legacy cutover compatibility: these unbounded identities remain tenant-only.
create or replace function public.get_student_announcements()
returns table (
  id uuid,
  tenant_id uuid,
  title text,
  body text,
  status text,
  audience_type text,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    aa.id, aa.tenant_id, aa.title, aa.body, aa.status, aa.audience_type,
    aa.published_at, aa.expires_at, aa.created_at, aa.updated_at, aa.archived_at
  from public.academy_announcements aa
  where coachfort_internal.student_can_read_announcement(aa.id, auth.uid())
  order by aa.published_at desc, aa.id desc
$$;

create or replace function public.get_team_announcements(p_tenant_id uuid)
returns setof public.academy_announcements
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select aa.*
  from public.academy_announcements aa
  where aa.tenant_id = p_tenant_id
    and aa.audience_type = 'tenant'
    and exists (
      select 1 from coachfort_internal.announcement_authorization_context(
        aa.tenant_id, aa.audience_type, null, null, true
      )
    )
  order by
    case aa.status when 'published' then 1 when 'draft' then 2 else 3 end,
    coalesce(aa.published_at, aa.created_at) desc,
    aa.id desc
$$;

create or replace function public.create_academy_announcement(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz default null
)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.create_announcement(
    p_tenant_id, p_title, p_body, p_expires_at, 'tenant', null, null, true
  )
$$;

create or replace function public.update_academy_announcement(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz default null
)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.update_announcement(
    p_announcement_id, p_title, p_body, p_expires_at, null, null, null, true
  )
$$;

create or replace function public.publish_academy_announcement(p_announcement_id uuid)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.publish_announcement(p_announcement_id, true)
$$;

create or replace function public.archive_academy_announcement(p_announcement_id uuid)
returns public.academy_announcements
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.archive_announcement(p_announcement_id, true)
$$;

alter function coachfort_internal.normalize_announcement_scope(uuid, text, uuid, uuid) owner to postgres;
alter function coachfort_internal.enforce_announcement_scope() owner to postgres;
alter function coachfort_internal.announcement_authorization_context(uuid, text, uuid, uuid, boolean) owner to postgres;
alter function coachfort_internal.student_can_read_announcement(uuid, uuid) owner to postgres;
alter function coachfort_internal.log_announcement_delegation(uuid, uuid, text, uuid, text, uuid) owner to postgres;
alter function coachfort_internal.create_announcement(uuid, text, text, timestamptz, text, uuid, uuid, boolean) owner to postgres;
alter function coachfort_internal.update_announcement(uuid, text, text, timestamptz, text, uuid, uuid, boolean) owner to postgres;
alter function coachfort_internal.publish_announcement(uuid, boolean) owner to postgres;
alter function coachfort_internal.archive_announcement(uuid, boolean) owner to postgres;
alter function coachfort_internal.delete_draft_announcement(uuid) owner to postgres;

revoke all on function coachfort_internal.normalize_announcement_scope(uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_announcement_scope()
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.announcement_authorization_context(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.student_can_read_announcement(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.log_announcement_delegation(uuid, uuid, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.create_announcement(uuid, text, text, timestamptz, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.update_announcement(uuid, text, text, timestamptz, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.publish_announcement(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.archive_announcement(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.delete_draft_announcement(uuid)
  from public, anon, authenticated, service_role;

alter function public.m69_6_validate_notification_type(text) owner to postgres;
revoke all on function public.m69_6_validate_notification_type(text)
  from public, anon, authenticated, service_role;

alter function public.get_student_announcements_v2(integer, timestamptz, uuid) owner to postgres;
alter function public.get_student_announcement_v2(uuid) owner to postgres;
alter function public.get_team_announcements_v2(uuid, text, text, integer, timestamptz, uuid) owner to postgres;
alter function public.get_team_announcement_v2(uuid, uuid) owner to postgres;
alter function public.create_academy_announcement_v2(uuid, text, text, timestamptz, text, uuid, uuid) owner to postgres;
alter function public.update_academy_announcement_v2(uuid, text, text, timestamptz, text, uuid, uuid) owner to postgres;
alter function public.publish_academy_announcement_v2(uuid) owner to postgres;
alter function public.archive_academy_announcement_v2(uuid) owner to postgres;
alter function public.delete_draft_academy_announcement_v2(uuid) owner to postgres;

alter function public.get_student_announcements() owner to postgres;
alter function public.get_team_announcements(uuid) owner to postgres;
alter function public.create_academy_announcement(uuid, text, text, timestamptz) owner to postgres;
alter function public.update_academy_announcement(uuid, text, text, timestamptz) owner to postgres;
alter function public.publish_academy_announcement(uuid) owner to postgres;
alter function public.archive_academy_announcement(uuid) owner to postgres;

revoke all on function public.get_student_announcements_v2(integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_student_announcement_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_team_announcements_v2(uuid, text, text, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_team_announcement_v2(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_academy_announcement_v2(uuid, text, text, timestamptz, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_academy_announcement_v2(uuid, text, text, timestamptz, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_academy_announcement_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.archive_academy_announcement_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_draft_academy_announcement_v2(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.get_student_announcements() from public, anon, authenticated, service_role;
revoke all on function public.get_team_announcements(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_academy_announcement(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.update_academy_announcement(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_academy_announcement(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.archive_academy_announcement(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_student_announcements_v2(integer, timestamptz, uuid) to authenticated;
grant execute on function public.get_student_announcement_v2(uuid) to authenticated;
grant execute on function public.get_team_announcements_v2(uuid, text, text, integer, timestamptz, uuid) to authenticated;
grant execute on function public.get_team_announcement_v2(uuid, uuid) to authenticated;
grant execute on function public.create_academy_announcement_v2(uuid, text, text, timestamptz, text, uuid, uuid) to authenticated;
grant execute on function public.update_academy_announcement_v2(uuid, text, text, timestamptz, text, uuid, uuid) to authenticated;
grant execute on function public.publish_academy_announcement_v2(uuid) to authenticated;
grant execute on function public.archive_academy_announcement_v2(uuid) to authenticated;
grant execute on function public.delete_draft_academy_announcement_v2(uuid) to authenticated;

grant execute on function public.get_student_announcements() to authenticated;
grant execute on function public.get_team_announcements(uuid) to authenticated;
grant execute on function public.create_academy_announcement(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.update_academy_announcement(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.publish_academy_announcement(uuid) to authenticated;
grant execute on function public.archive_academy_announcement(uuid) to authenticated;

revoke all on table public.academy_announcements from public, anon, authenticated;
alter table public.academy_announcements enable row level security;

do $$
declare
  v_missing text;
  v_postgres_safe boolean;
begin
  select r.rolsuper or r.rolbypassrls into v_postgres_safe
  from pg_catalog.pg_roles r where r.rolname = 'postgres';
  if not coalesce(v_postgres_safe, false) then
    raise exception 'UX-7B helper owner cannot safely bypass RLS.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.academy_announcements'::regclass),
      ('public.students'::regclass),
      ('public.student_portal_accounts'::regclass),
      ('public.enrollments'::regclass),
      ('public.courses'::regclass),
      ('public.cohorts'::regclass),
      ('public.cohort_members'::regclass),
      ('public.tenant_members'::regclass),
      ('public.trainer_course_assignments'::regclass),
      ('public.trainer_cohort_assignments'::regclass),
      ('public.delegated_permissions'::regclass)
    ) protected(table_oid)
    join pg_catalog.pg_class c on c.oid = protected.table_oid
    where c.relforcerowsecurity
  ) then
    raise exception 'UX-7B prerequisite failed: FORCE RLS blocks private helper evaluation.' using errcode = '55000';
  end if;

  select string_agg(expected.identity, ', ' order by expected.identity) into v_missing
  from (values
    ('public.get_student_announcements_v2(integer,timestamp with time zone,uuid)'),
    ('public.get_student_announcement_v2(uuid)'),
    ('public.get_team_announcements_v2(uuid,text,text,integer,timestamp with time zone,uuid)'),
    ('public.get_team_announcement_v2(uuid,uuid)'),
    ('public.create_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.update_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.publish_academy_announcement_v2(uuid)'),
    ('public.archive_academy_announcement_v2(uuid)'),
    ('public.delete_draft_academy_announcement_v2(uuid)')
  ) expected(identity)
  where pg_catalog.to_regprocedure(expected.identity) is null;
  if v_missing is not null then
    raise exception 'UX-7B canonical RPC installation failed: %.', v_missing using errcode = '55000';
  end if;

  if exists (
    select 1 from public.academy_announcements aa
    where aa.audience_type not in ('tenant', 'program', 'cohort')
       or (aa.audience_type = 'tenant' and (aa.course_id is not null or aa.cohort_id is not null))
       or (aa.audience_type = 'program' and (aa.course_id is null or aa.cohort_id is not null))
       or (aa.audience_type = 'cohort' and (aa.course_id is null or aa.cohort_id is null))
  ) then
    raise exception 'UX-7B canonical announcement scope installation failed.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.notifications n
    where n.type = 'announcement_notice' or n.entity_type = 'announcement'
  ) then
    raise exception 'UX-7B migration unexpectedly generated announcement notifications.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid = 'public.academy_announcements'::regclass
      and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
      and upper(acl.privilege_type) in (
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
      )
  ) then
    raise exception 'UX-7B browser announcement write hardening failed.' using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this single query after applying. It returns one compact JSON result and
does not access announcement content or Student identity data.

with expected_public(identity) as (
  values
    ('public.get_student_announcements_v2(integer,timestamp with time zone,uuid)'),
    ('public.get_student_announcement_v2(uuid)'),
    ('public.get_team_announcements_v2(uuid,text,text,integer,timestamp with time zone,uuid)'),
    ('public.get_team_announcement_v2(uuid,uuid)'),
    ('public.create_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.update_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.publish_academy_announcement_v2(uuid)'),
    ('public.archive_academy_announcement_v2(uuid)'),
    ('public.delete_draft_academy_announcement_v2(uuid)'),
    ('public.get_student_announcements()'),
    ('public.get_team_announcements(uuid)'),
    ('public.create_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.update_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.publish_academy_announcement(uuid)'),
    ('public.archive_academy_announcement(uuid)')
), expected_private(identity) as (
  values
    ('coachfort_internal.normalize_announcement_scope(uuid,text,uuid,uuid)'),
    ('coachfort_internal.enforce_announcement_scope()'),
    ('coachfort_internal.announcement_authorization_context(uuid,text,uuid,uuid,boolean)'),
    ('coachfort_internal.student_can_read_announcement(uuid,uuid)'),
    ('coachfort_internal.log_announcement_delegation(uuid,uuid,text,uuid,text,uuid)'),
    ('coachfort_internal.create_announcement(uuid,text,text,timestamp with time zone,text,uuid,uuid,boolean)'),
    ('coachfort_internal.update_announcement(uuid,text,text,timestamp with time zone,text,uuid,uuid,boolean)'),
    ('coachfort_internal.publish_announcement(uuid,boolean)'),
    ('coachfort_internal.archive_announcement(uuid,boolean)'),
    ('coachfort_internal.delete_draft_announcement(uuid)'),
    ('public.m69_6_validate_notification_type(text)')
), public_contract as (
  select
    ep.identity,
    p.oid is not null as installed,
    coalesce(pg_catalog.pg_get_userbyid(p.proowner) = 'postgres', false) as postgres_owned,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(p.proconfig @> array['search_path=public, pg_temp'], false) as safe_search_path,
    coalesce(pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_execute,
    coalesce(pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_execute,
    coalesce(pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'), false) as service_execute,
    lower(regexp_replace(coalesce(pg_catalog.pg_get_functiondef(p.oid), ''), E'\\s+', ' ', 'g')) as source
  from expected_public ep
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(ep.identity)
), private_contract as (
  select
    ep.identity,
    p.oid is not null as installed,
    coalesce(pg_catalog.pg_get_userbyid(p.proowner) = 'postgres', false) as postgres_owned,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(p.proconfig @> array['search_path=public, pg_temp'], false) as safe_search_path,
    coalesce(pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_execute,
    coalesce(pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_execute,
    coalesce(pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'), false) as service_execute,
    lower(regexp_replace(coalesce(pg_catalog.pg_get_functiondef(p.oid), ''), E'\\s+', ' ', 'g')) as source
  from expected_private ep
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(ep.identity)
), schema_contract as (
  select jsonb_build_object(
    'rls_enabled', c.relrowsecurity,
    'force_rls', c.relforcerowsecurity,
    'scope_columns', (
      select count(*) = 2 from information_schema.columns col
      where col.table_schema = 'public' and col.table_name = 'academy_announcements'
        and col.column_name in ('course_id', 'cohort_id')
    ),
    'scope_foreign_keys', (
      select count(*) = 2 from pg_catalog.pg_constraint con
      where con.conrelid = c.oid
        and con.conname in (
          'academy_announcements_course_id_fkey',
          'academy_announcements_cohort_id_fkey'
        )
        and con.confdeltype = 'r'
    ),
    'scope_checks', (
      select count(*) = 2 from pg_catalog.pg_constraint con
      where con.conrelid = c.oid
        and con.conname in (
          'academy_announcements_audience_type_check',
          'academy_announcements_scope_shape_check'
        )
    ),
    'browser_write_grants', (
      select count(*)
      from pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
      where (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
        and upper(acl.privilege_type) in (
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
        )
    ),
    'indexes', (
      select count(*) = 3 from pg_catalog.pg_indexes i
      where i.schemaname = 'public' and i.indexname in (
        'academy_announcements_student_feed_idx',
        'academy_announcements_team_feed_idx',
        'notifications_announcement_aggregate_idx'
      )
    )
  ) as value
  from pg_catalog.pg_class c where c.oid = 'public.academy_announcements'::regclass
), helper_safety as (
  select jsonb_build_object(
    'postgres_bypass_safe', coalesce((
      select r.rolsuper or r.rolbypassrls from pg_catalog.pg_roles r
      where r.rolname = 'postgres'
    ), false),
    'force_rls_tables', (
      select count(*)
      from (values
        ('public.academy_announcements'::regclass),
        ('public.students'::regclass),
        ('public.student_portal_accounts'::regclass),
        ('public.enrollments'::regclass),
        ('public.courses'::regclass),
        ('public.cohorts'::regclass),
        ('public.cohort_members'::regclass),
        ('public.tenant_members'::regclass),
        ('public.trainer_course_assignments'::regclass),
        ('public.trainer_cohort_assignments'::regclass),
        ('public.delegated_permissions'::regclass)
      ) protected(table_oid)
      join pg_catalog.pg_class c on c.oid = protected.table_oid
      where c.relforcerowsecurity
    ),
    'internal_schema_api_exposed', coalesce(
      'coachfort_internal' = any(pg_catalog.regexp_split_to_array(
        replace(pg_catalog.current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) setting
      cross join lateral pg_catalog.regexp_split_to_table(
        split_part(setting, '=', 2), ','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and rs.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) as value
), source_contract as (
  select jsonb_build_object(
    'student_auth_bound', exists (
      select 1 from private_contract where identity like '%student_can_read_announcement%'
        and source like '%p_user_id is distinct from auth.uid()%'
        and source like '%student_portal_access_allowed_for_user%'
    ),
    'completed_cutoff', exists (
      select 1 from private_contract where identity like '%student_can_read_announcement%'
        and source like '%e.status = ''active''%'
        and source like '%completed_at is not null%'
        and source like '%published_at <= e.completed_at%'
        and source not like '%e.status = ''paused''%'
        and source not like '%e.status = ''cancelled''%'
    ),
    'trainer_exact_scope', exists (
      select 1 from private_contract where identity like '%announcement_authorization_context%'
        and source like '%p_audience_type = ''tenant''%'
        and source like '%ux4b_trainer_can_manage_course%'
        and source like '%ux4b_trainer_can_manage_cohort%'
        and source like '%find_active_delegated_permission_for_action%'
    ),
    'bounded_reads', (
      select count(*) = 2 from public_contract
      where identity like '%announcements_v2%'
        and source like '%p_limit > 50%'
        and source like '%cursor%is invalid%'
        and source like '%order by%id desc%'
    ),
    'atomic_publish', exists (
      select 1 from private_contract where identity like '%publish_announcement%'
        and source like '%for update%'
        and source like '%status = ''published''%'
        and source like '%feature.feature_key = ''notifications''%'
        and source like '%insert into public.notifications%select%'
        and source like '%select distinct spa.user_id%'
        and source like '%announcement:%:published%'
        and source like '%/portal/announcements?announcement=%'
        and source like '%on conflict (tenant_id, user_id, event_key)%'
    ),
    'audit_and_delegation', exists (
      select 1 from private_contract where identity like '%publish_announcement%'
        and source like '%announcement_published%'
        and source like '%log_announcement_delegation%'
    ),
    'published_edit_no_notification', exists (
      select 1 from private_contract where identity like '%update_announcement%'
        and source like '%published announcement audience cannot be changed%'
        and source not like '%insert into public.notifications%'
    )
  ) as value
), notification_contract as (
  select jsonb_build_object(
    'type_check', exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid = 'public.notifications'::regclass
        and con.conname = 'notifications_type_check'
        and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%announcement_notice%'
    ),
    'validator', lower(pg_catalog.pg_get_functiondef(
      'public.m69_6_validate_notification_type(text)'::regprocedure
    )) like '%announcement_notice%',
    'event_unique_index', exists (
      select 1 from pg_catalog.pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'notifications'
        and i.indexname = 'notifications_tenant_user_event_key_uidx'
        and lower(i.indexdef) like '%unique%tenant_id, user_id, event_key%'
        and lower(i.indexdef) like '%where (event_key is not null)%'
    ),
    'retroactive_rows', (
      select count(*) from public.notifications n
      where n.type = 'announcement_notice' or n.entity_type = 'announcement'
    )
  ) as value
), baseline_groups as (
  select jsonb_build_object(
    'community', (
      select count(*) from (values
        ('public.get_student_community_posts()'), ('public.get_student_community_comments(uuid)'),
        ('public.create_student_community_comment(uuid,text)'), ('public.get_team_community_posts(uuid)'),
        ('public.get_team_community_comments(uuid)'), ('public.create_team_community_post(uuid,text,text,text)'),
        ('public.update_team_community_post(uuid,text,text,text)'), ('public.publish_community_post(uuid)'),
        ('public.archive_community_post(uuid)'), ('public.hide_community_post(uuid)'),
        ('public.create_team_community_comment(uuid,text)'), ('public.hide_community_comment(uuid)')
      ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null
    ),
    'academy_chat', (
      select count(*) from (values
        ('public.get_team_chat_threads(uuid)'), ('public.get_team_chat_thread(uuid)'),
        ('public.get_student_chat_threads()'), ('public.get_student_chat_thread(uuid)'),
        ('public.add_default_team_chat_participants(uuid,uuid,uuid,uuid)'),
        ('public.create_student_direct_chat(uuid,uuid,text,text)'),
        ('public.create_student_support_thread(text,text)'), ('public.send_team_chat_message(uuid,text)'),
        ('public.send_student_chat_message(uuid,text)'), ('public.close_chat_thread(uuid)'),
        ('public.mark_chat_thread_read(uuid)')
      ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null
    )
  ) as value
), gates as (
  select
    (select bool_and(installed and postgres_owned and security_definer and safe_search_path
      and authenticated_execute and not anon_execute and not service_execute) from public_contract)
    and (select bool_and(installed and postgres_owned and security_definer and safe_search_path
      and not anon_execute and not authenticated_execute and not service_execute) from private_contract)
    and ((select value->>'rls_enabled' from schema_contract)::boolean)
    and not ((select value->>'force_rls' from schema_contract)::boolean)
    and ((select value->>'scope_columns' from schema_contract)::boolean)
    and ((select value->>'scope_foreign_keys' from schema_contract)::boolean)
    and ((select value->>'scope_checks' from schema_contract)::boolean)
    and (select (value->>'browser_write_grants')::integer = 0 from schema_contract)
    and ((select value->>'indexes' from schema_contract)::boolean)
    and (select bool_and(value::text not like '%false%') from source_contract)
    and ((select value->>'type_check' from notification_contract)::boolean)
    and ((select value->>'validator' from notification_contract)::boolean)
    and ((select value->>'event_unique_index' from notification_contract)::boolean)
    and (select (value->>'retroactive_rows')::integer = 0 from notification_contract)
    and ((select value->>'postgres_bypass_safe' from helper_safety)::boolean)
    and (select (value->>'force_rls_tables')::integer = 0 from helper_safety)
    and not ((select value->>'internal_schema_api_exposed' from helper_safety)::boolean)
    and (select (value->>'community')::integer = 12
      and (value->>'academy_chat')::integer = 11 from baseline_groups) as security_gate
)
select jsonb_build_object(
  'security_gate', (select security_gate from gates),
  'schema', (select value from schema_contract),
  'source_contract', (select value from source_contract),
  'notifications', (select value from notification_contract),
  'helper_safety', (select value from helper_safety),
  'public_functions', (select jsonb_agg(to_jsonb(public_contract) - 'source' order by identity) from public_contract),
  'private_functions', (select jsonb_agg(to_jsonb(private_contract) - 'source' order by identity) from private_contract),
  'legacy_publish_return', pg_catalog.pg_get_function_result(
    'public.publish_academy_announcement(uuid)'::regprocedure
  ),
  'baseline_groups', (select value from baseline_groups)
) as ux7b_post_apply;
*/
