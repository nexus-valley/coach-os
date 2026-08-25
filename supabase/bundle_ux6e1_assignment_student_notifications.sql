/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query before applying the executable migration. It returns metadata
and aggregate counts only. It does not invoke mutation RPCs or return notification
content, student identity, or portal-account identifiers.

with
notification_columns as (
  select
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'notifications'
),
notification_constraints as (
  select
    con.conname,
    con.contype,
    pg_catalog.pg_get_constraintdef(con.oid, true) as definition
  from pg_catalog.pg_constraint con
  where con.conrelid = pg_catalog.to_regclass('public.notifications')
),
notification_indexes as (
  select i.indexname, i.indexdef
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public'
    and i.tablename = 'notifications'
),
notification_rls as (
  select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
  from pg_catalog.pg_class c
  where c.oid = pg_catalog.to_regclass('public.notifications')
),
notification_policies as (
  select
    p.policyname,
    p.cmd,
    p.permissive,
    p.roles,
    p.qual,
    p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'notifications'
),
notification_grants as (
  select
    case
      when acl.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl.grantee)
    end as grantee,
    upper(acl.privilege_type) as privilege_type
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) acl
  where c.oid = pg_catalog.to_regclass('public.notifications')
    and (
      acl.grantee = 0
      or pg_catalog.pg_get_userbyid(acl.grantee) in (
        'anon', 'authenticated', 'service_role', 'postgres'
      )
    )
),
browser_notification_grant_contract as (
  select jsonb_build_object(
    'authenticated_select', exists (
      select 1 from notification_grants g
      where g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
    ),
    'public_privileges', (
      select count(*) from notification_grants g
      where g.grantee = 'PUBLIC'
    ),
    'anon_select', exists (
      select 1 from notification_grants g
      where g.grantee = 'anon' and g.privilege_type = 'SELECT'
    ),
    'browser_write_grants', (
      select count(*) from notification_grants g
      where g.grantee in ('PUBLIC', 'anon', 'authenticated')
        and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'browser_dangerous_grants', (
      select count(*) from notification_grants g
      where g.grantee in ('PUBLIC', 'anon', 'authenticated')
        and g.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
    ),
    'unexpected_browser_grants', (
      select count(*) from notification_grants g
      where g.grantee = 'PUBLIC'
         or (g.grantee = 'anon' and g.privilege_type not in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))
         or (g.grantee = 'authenticated' and g.privilege_type not in ('SELECT', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))
    ),
    'recognized_baseline',
      exists (
        select 1 from notification_grants g
        where g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
      )
      and not exists (
        select 1 from notification_grants g
        where g.grantee = 'PUBLIC'
           or (g.grantee = 'anon' and g.privilege_type not in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))
           or (g.grantee = 'authenticated' and g.privilege_type not in ('SELECT', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))
      )
  ) as value
),
notification_totals as (
  select
    count(*) as total_notifications,
    count(distinct n.tenant_id) as tenant_count,
    count(*) filter (where n.type = 'assignment_notice') as assignment_notice_count,
    count(*) filter (
      where exists (
        select 1
        from public.student_portal_accounts spa
        where spa.tenant_id = n.tenant_id
          and spa.user_id = n.user_id
      )
    ) as student_recipient_count
  from public.notifications n
),
notification_status_counts as (
  select n.status, count(*) as row_count
  from public.notifications n
  group by n.status
),
notification_type_counts as (
  select n.type, count(*) as row_count
  from public.notifications n
  group by n.type
),
candidate_duplicate_groups as (
  select count(*) as duplicate_group_count
  from (
    select n.tenant_id, n.user_id, n.type, n.entity_type, n.entity_id, n.action_url
    from public.notifications n
    where n.type = 'assignment_notice'
    group by n.tenant_id, n.user_id, n.type, n.entity_type, n.entity_id, n.action_url
    having count(*) > 1
  ) duplicates
),
required_functions(identity) as (
  values
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    ('public.has_any_active_student_portal_account(uuid,uuid)'),
    ('public.feature_access_effective_rows(uuid)'),
    ('public.mark_notification_read_secure(uuid,uuid)'),
    ('public.update_assignment_status_secure(uuid,uuid,text)'),
    ('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    ('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'),
    ('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)')
),
function_metadata as (
  select
    rf.identity,
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    l.lanname as language,
    p.prosecdef as security_definer,
    p.provolatile,
    p.proargdefaults,
    p.proacl,
    p.proconfig,
    case when p.oid is null then null else lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g'
    )) end as normalized_definition
  from required_functions rf
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(rf.identity)
  left join pg_catalog.pg_language l on l.oid = p.prolang
),
review_overloads as (
  select
    n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as identity
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'review_assignment_submission_secure',
      'review_delegated_assignment_submission'
    )
),
revision_columns as (
  select c.table_name, c.data_type, c.udt_name, c.is_nullable
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('assignments', 'assignment_submissions')
    and c.column_name = 'updated_at'
),
revision_triggers as (
  select
    cls.relname as table_name,
    t.tgname,
    t.tgenabled,
    pg_catalog.pg_get_triggerdef(t.oid, true) as definition,
    pn.nspname || '.' || p.proname as trigger_function,
    lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g'
    )) as normalized_function_definition
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class cls on cls.oid = t.tgrelid
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
    where t.tgisinternal = false
      and t.tgname in (
        'set_assignments_updated_at',
        'set_assignment_submissions_updated_at'
      )
      and cls.oid in (
        pg_catalog.to_regclass('public.assignments'),
        pg_catalog.to_regclass('public.assignment_submissions')
    )
),
internal_schema as (
  select jsonb_build_object(
    'installed', to_regnamespace('coachfort_internal') is not null,
    'postgrest_setting', current_setting('pgrst.db_schemas', true),
    'postgrest_role_setting_exposed', exists (
      select 1
      from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) as settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(setting, '=', 2), ','
      ) as exposed(schema_name)
      where r.rolname = 'authenticator'
        and rs.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d
           where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ),
    'public_usage', pg_catalog.has_schema_privilege('public', 'coachfort_internal', 'USAGE'),
    'anon_usage', pg_catalog.has_schema_privilege('anon', 'coachfort_internal', 'USAGE'),
    'authenticated_usage', pg_catalog.has_schema_privilege('authenticated', 'coachfort_internal', 'USAGE'),
    'service_role_usage', pg_catalog.has_schema_privilege('service_role', 'coachfort_internal', 'USAGE')
  ) as value
)
select jsonb_build_object(
  'notifications', jsonb_build_object(
    'columns', (select coalesce(jsonb_agg(to_jsonb(c) order by c.column_name), '[]'::jsonb) from notification_columns c),
    'constraints', (select coalesce(jsonb_agg(to_jsonb(c) order by c.conname), '[]'::jsonb) from notification_constraints c),
    'indexes', (select coalesce(jsonb_agg(to_jsonb(i) order by i.indexname), '[]'::jsonb) from notification_indexes i),
    'rls', (select to_jsonb(r) from notification_rls r),
    'policies', (select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname), '[]'::jsonb) from notification_policies p),
    'direct_grants', (select coalesce(jsonb_agg(to_jsonb(g) order by g.grantee, g.privilege_type), '[]'::jsonb) from notification_grants g),
    'browser_notification_grant_contract', (select value from browser_notification_grant_contract),
    'totals', (select to_jsonb(t) from notification_totals t),
    'status_counts', (select coalesce(jsonb_object_agg(status, row_count order by status), '{}'::jsonb) from notification_status_counts),
    'type_counts', (select coalesce(jsonb_object_agg(type, row_count order by type), '{}'::jsonb) from notification_type_counts),
    'candidate_duplicate_groups', (select duplicate_group_count from candidate_duplicate_groups)
  ),
  'functions', (select coalesce(jsonb_agg(to_jsonb(f) order by f.identity), '[]'::jsonb) from function_metadata f),
  'review_overloads', (select coalesce(jsonb_agg(identity order by identity), '[]'::jsonb) from review_overloads),
  'revision_columns', (select coalesce(jsonb_agg(to_jsonb(c) order by c.table_name), '[]'::jsonb) from revision_columns c),
  'revision_triggers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.table_name, t.tgname), '[]'::jsonb) from revision_triggers t),
  'internal_schema', (select value from internal_schema)
) as preflight_result;
*/

begin;

-- Fail before changing metadata if the installed contract is not the reviewed
-- UX-4B/UX-6B/UX-6D1/UX-6D3 baseline.
do $$
declare
  v_definition text;
  v_function regprocedure;
  v_trigger_count integer;
  v_unsafe_tables text[];
begin
  if pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regclass('public.assignments') is null
     or pg_catalog.to_regclass('public.assignment_submissions') is null
     or pg_catalog.to_regclass('public.students') is null
     or pg_catalog.to_regclass('public.student_portal_accounts') is null
     or pg_catalog.to_regclass('public.enrollments') is null
     or pg_catalog.to_regclass('public.courses') is null
     or pg_catalog.to_regclass('public.cohorts') is null
     or pg_catalog.to_regclass('public.cohort_members') is null then
    raise exception 'UX-6E1 prerequisite failed: required tables are missing.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'notifications'
      and c.column_name = 'event_key'
      and (
        c.data_type <> 'text'
        or c.is_nullable <> 'YES'
        or c.column_default is not null
      )
  ) then
    raise exception 'UX-6E1 prerequisite failed: notifications.event_key is incompatible.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = pg_catalog.to_regclass('public.notifications')
      and con.contype = 'c'
      and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%assignment_notice%'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = pg_catalog.to_regclass('public.notifications')
      and con.contype = 'c'
      and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%unread%'
      and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%''read''%'
      and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%archived%'
  ) then
    raise exception 'UX-6E1 prerequisite failed: notification constraints are not recognized.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = pg_catalog.to_regclass('public.notifications')
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'notifications'
      and p.policyname = 'Linked students can read own notifications'
      and p.cmd = 'SELECT'
      and lower(coalesce(p.qual, '')) like '%user_id = auth.uid()%'
      and lower(coalesce(p.qual, '')) like '%has_any_active_student_portal_account%'
  ) then
    raise exception 'UX-6E1 prerequisite failed: Student notification SELECT policy is not recognized.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) g
    where c.oid = pg_catalog.to_regclass('public.notifications')
      and case
        when g.grantee = 0 then 'PUBLIC'
        else pg_catalog.pg_get_userbyid(g.grantee)
      end = 'authenticated'
      and upper(g.privilege_type) = 'SELECT'
  ) then
    raise exception 'UX-6E1 prerequisite failed: authenticated notification SELECT is missing.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) g
    where c.oid = pg_catalog.to_regclass('public.notifications')
      and (
        g.grantee = 0
        or (
          case
            when g.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(g.grantee)
          end = 'anon'
          and upper(g.privilege_type) not in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
        )
        or (
          case
            when g.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(g.grantee)
          end = 'authenticated'
          and upper(g.privilege_type) not in ('SELECT', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
        )
      )
  ) then
    raise exception 'UX-6E1 prerequisite failed: browser notification grants are not a recognized remediable baseline.' using errcode = '55000';
  end if;

  foreach v_function in array array[
    pg_catalog.to_regprocedure('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    pg_catalog.to_regprocedure('public.has_any_active_student_portal_account(uuid,uuid)'),
    pg_catalog.to_regprocedure('public.feature_access_effective_rows(uuid)'),
    pg_catalog.to_regprocedure('public.mark_notification_read_secure(uuid,uuid)'),
    pg_catalog.to_regprocedure('public.update_assignment_status_secure(uuid,uuid,text)'),
    pg_catalog.to_regprocedure('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    pg_catalog.to_regprocedure('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'),
    pg_catalog.to_regprocedure('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)')
  ] loop
    if v_function is null then
      raise exception 'UX-6E1 prerequisite failed: required function identity is missing.' using errcode = '55000';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_language l on l.oid = p.prolang
      where p.oid = v_function::oid
        and (
          pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
          or l.lanname not in ('sql', 'plpgsql')
          or not p.prosecdef
          or not exists (
            select 1
            from unnest(coalesce(p.proconfig, array[]::text[])) config(setting)
            where config.setting in ('search_path=public', 'search_path=public, pg_temp')
          )
        )
    ) then
      raise exception 'UX-6E1 prerequisite failed: required function metadata is unsafe.' using errcode = '55000';
    end if;

    if pg_catalog.has_function_privilege('public', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
       or (
         v_function <> pg_catalog.to_regprocedure('public.feature_access_effective_rows(uuid)')
         and not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       )
       or (
         v_function = pg_catalog.to_regprocedure('public.feature_access_effective_rows(uuid)')
         and pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       ) then
      raise exception 'UX-6E1 prerequisite failed: required function ACL is not recognized.' using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('review_assignment_submission_secure', 'review_delegated_assignment_submission')
      and pg_catalog.pg_get_function_identity_arguments(p.oid)
        <> 'p_tenant_id uuid, p_assignment_id uuid, p_student_id uuid, p_expected_submission_updated_at timestamp with time zone, p_score numeric, p_feedback text'
  ) then
    raise exception 'UX-6E1 prerequisite failed: unsafe review overload exists.' using errcode = '55000';
  end if;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'
    )::oid), '[[:space:]]+', ' ', 'g'
  )) into v_definition;
  if v_definition not like '%p_user_id <> auth.uid()%'
     or v_definition not like '%s.status = ''active''%'
     or v_definition not like '%s.portal_enabled = true%'
     or v_definition not like '%spa.status = ''active''%'
     or v_definition not like '%course_participate%'
     or v_definition not like '%course_read%' then
    raise exception 'UX-6E1 prerequisite failed: canonical portal helper is not recognized.' using errcode = '55000';
  end if;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.has_any_active_student_portal_account(uuid,uuid)'
    )::oid), '[[:space:]]+', ' ', 'g'
  )) into v_definition;
  if v_definition not like '%from public.student_portal_accounts spa%'
     or v_definition not like '%spa.tenant_id = check_tenant_id%'
     or v_definition not like '%spa.user_id = check_user_id%'
     or v_definition not like '%public.student_portal_access_allowed(%'
     or v_definition not like '%spa.tenant_id%spa.student_id%check_user_id%null%''portal''%' then
    raise exception 'UX-6E1 prerequisite failed: canonical portal account helper chain is not recognized.' using errcode = '55000';
  end if;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
    )::oid), '[[:space:]]+', ' ', 'g'
  )) into v_definition;
  if v_definition not like '%for update;%'
     or v_definition not like '%v_trainer_user_id := v_existing.trainer_user_id%'
     or v_definition not like '%v_actor_role not in (''owner'', ''admin'')%'
     or v_definition not like '%program, cohort, and trainer cannot be changed after publication%'
     or v_definition not like '%due date and max score cannot be changed after the first submission%'
     or v_definition not like '%closed assignments cannot be edited%' then
    raise exception 'UX-6E1 prerequisite failed: UX-6D3 assignment update is not recognized.' using errcode = '55000';
  end if;

  foreach v_function in array array[
    pg_catalog.to_regprocedure('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'),
    pg_catalog.to_regprocedure('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)')
  ] loop
    select lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(v_function::oid), '[[:space:]]+', ' ', 'g'
    )) into v_definition;
    if v_definition not like '%p_expected_submission_updated_at is null%'
       or v_definition not like '%from public.assignments a%for update;%'
       or v_definition not like '%from public.assignment_submissions s%for update;%'
       or v_definition not like '%assignment_submission_stale%' then
      raise exception 'UX-6E1 prerequisite failed: UX-6D1 review contract is not recognized.' using errcode = '55000';
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'assignments'
      and c.column_name = 'updated_at'
      and c.udt_name = 'timestamptz'
      and c.is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'assignment_submissions'
      and c.column_name = 'updated_at'
      and c.udt_name = 'timestamptz'
      and c.is_nullable = 'NO'
  ) then
    raise exception 'UX-6E1 prerequisite failed: revision columns are not authoritative timestamptz values.' using errcode = '55000';
  end if;

  select count(*) into v_trigger_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  where t.tgisinternal = false
    and (
      (c.oid = pg_catalog.to_regclass('public.assignments')
       and t.tgname = 'set_assignments_updated_at')
      or
      (c.oid = pg_catalog.to_regclass('public.assignment_submissions')
       and t.tgname = 'set_assignment_submissions_updated_at')
    )
    and t.tgenabled <> 'D'
    and lower(pg_catalog.pg_get_triggerdef(t.oid, true)) like '%before update%'
    and lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g'
    )) like '%new.updated_at = now()%';
  if v_trigger_count <> 2 then
    raise exception 'UX-6E1 prerequisite failed: assignment revision triggers are not recognized.' using errcode = '55000';
  end if;

  if pg_catalog.to_regnamespace('coachfort_internal') is null then
    raise exception 'UX-6E1 prerequisite failed: internal schema is missing.' using errcode = '55000';
  end if;

  if coalesce(
       'coachfort_internal' = any(regexp_split_to_array(
         replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
       )), false
     ) or exists (
       select 1
       from pg_catalog.pg_db_role_setting rs
       join pg_catalog.pg_roles r on r.oid = rs.setrole
       cross join lateral unnest(rs.setconfig) as settings(setting)
       cross join lateral regexp_split_to_table(
         split_part(setting, '=', 2), ','
       ) as exposed(schema_name)
       where r.rolname = 'authenticator'
         and rs.setdatabase in (
           0,
           (select d.oid from pg_catalog.pg_database d
            where d.datname = current_database())
         )
         and setting like 'pgrst.db_schemas=%'
         and btrim(exposed.schema_name) = 'coachfort_internal'
     ) then
    raise exception 'UX-6E1 prerequisite failed: internal schema is API-exposed.' using errcode = '55000';
  end if;

  select array_agg(c.relname order by c.relname)
  into v_unsafe_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join pg_catalog.pg_roles helper_owner
  where n.nspname = 'public'
    and c.relname in (
      'assignments', 'assignment_submissions', 'cohort_members', 'cohorts',
      'courses', 'enrollments', 'notifications', 'student_portal_accounts',
      'students', 'tenant_feature_settings'
    )
    and helper_owner.rolname = 'postgres'
    and not (
      helper_owner.rolsuper
      or helper_owner.rolbypassrls
      or (c.relowner = helper_owner.oid and not c.relforcerowsecurity)
    );
  if coalesce(cardinality(v_unsafe_tables), 0) > 0 then
    raise exception 'UX-6E1 prerequisite failed: postgres cannot bypass RLS for %.',
      array_to_string(v_unsafe_tables, ', ') using errcode = '42501';
  end if;
end;
$$;

alter table public.notifications
  add column if not exists event_key text;

create unique index if not exists notifications_tenant_user_event_key_uidx
  on public.notifications (tenant_id, user_id, event_key)
  where event_key is not null;

create or replace function coachfort_internal.student_portal_access_allowed_for_user(
  p_tenant_id uuid,
  p_student_id uuid,
  p_user_id uuid,
  p_course_id uuid,
  p_access_mode text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := lower(trim(coalesce(p_access_mode, 'portal')));
begin
  if p_tenant_id is null
     or p_student_id is null
     or p_user_id is null
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
            or (e.status = 'completed' and c.status in ('published', 'archived'))
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

alter function coachfort_internal.student_portal_access_allowed_for_user(
  uuid, uuid, uuid, uuid, text
) owner to postgres;
revoke all on function coachfort_internal.student_portal_access_allowed_for_user(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

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
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    return false;
  end if;

  return coachfort_internal.student_portal_access_allowed_for_user(
    p_tenant_id,
    p_student_id,
    p_user_id,
    p_course_id,
    p_access_mode
  );
end;
$$;

alter function public.student_portal_access_allowed(
  uuid, uuid, uuid, uuid, text
) owner to postgres;
revoke all on function public.student_portal_access_allowed(
  uuid, uuid, uuid, uuid, text
) from public, anon, service_role;
grant execute on function public.student_portal_access_allowed(
  uuid, uuid, uuid, uuid, text
) to authenticated;

create or replace function coachfort_internal.insert_assignment_student_notification_event(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_event_kind text,
  p_event_revision timestamptz,
  p_exact_student_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_access_mode text;
  v_action_url text;
  v_assignment public.assignments%rowtype;
  v_assignment_title text;
  v_course_id uuid;
  v_event_key text;
  v_event_kind text := lower(trim(coalesce(p_event_kind, '')));
  v_inserted integer := 0;
  v_message text;
  v_revision_key text;
  v_submission public.assignment_submissions%rowtype;
  v_title text;
begin
  if not exists (
    select 1
    from public.feature_access_effective_rows(p_tenant_id) feature
    where feature.feature_key = 'notifications'
      and feature.status = 'enabled'
  ) then
    return 0;
  end if;

  if p_tenant_id is null
     or p_assignment_id is null
     or v_event_kind not in ('published', 'due_changed', 'review_available') then
    raise exception 'Unsupported assignment notification event.' using errcode = '22023';
  end if;

  select a.*
  into v_assignment
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id;

  if not found then
    raise exception 'Assignment notification target was not found.' using errcode = '22023';
  end if;

  if v_assignment.cohort_id is not null then
    select c.course_id
    into v_course_id
    from public.cohorts c
    where c.tenant_id = p_tenant_id
      and c.id = v_assignment.cohort_id;

    if not found
       or (v_assignment.course_id is not null and v_assignment.course_id is distinct from v_course_id) then
      raise exception 'Assignment notification relationship is invalid.' using errcode = '22023';
    end if;
  else
    v_course_id := v_assignment.course_id;
  end if;

  if v_course_id is null then
    raise exception 'Assignment notification course is unavailable.' using errcode = '22023';
  end if;

  v_assignment_title := nullif(trim(translate(v_assignment.title, '<>', '')), '');
  v_assignment_title := left(coalesce(v_assignment_title, 'Assignment'), 140);
  v_action_url := '/portal/assignments/' || v_assignment.id::text;

  if v_event_kind = 'published' then
    if v_assignment.status <> 'published'
       or p_event_revision is not null
       or p_exact_student_id is not null then
      raise exception 'Published assignment notification input is invalid.' using errcode = '22023';
    end if;

    v_access_mode := 'course_participate';
    v_event_key := 'assignment:' || v_assignment.id::text || ':published';
    v_title := 'New assignment: ' || v_assignment_title;
    v_message := 'A new assignment is available. Open it to review the details and due date.';
  elsif v_event_kind = 'due_changed' then
    if v_assignment.status <> 'published'
       or p_event_revision is null
       or p_event_revision is distinct from v_assignment.updated_at
       or p_exact_student_id is not null then
      raise exception 'Due-date assignment notification input is invalid.' using errcode = '22023';
    end if;

    v_revision_key := floor(extract(epoch from p_event_revision) * 1000000)::bigint::text;
    v_access_mode := 'course_participate';
    v_event_key := 'assignment:' || v_assignment.id::text || ':due:' || v_revision_key;
    v_title := 'Due date changed: ' || v_assignment_title;
    v_message := 'The due date for this assignment has changed. Open it to view the latest schedule.';
  else
    if v_assignment.status not in ('published', 'closed')
       or p_event_revision is null
       or p_exact_student_id is null then
      raise exception 'Review assignment notification input is invalid.' using errcode = '22023';
    end if;

    select s.*
    into v_submission
    from public.assignment_submissions s
    where s.tenant_id = p_tenant_id
      and s.assignment_id = p_assignment_id
      and s.student_id = p_exact_student_id;

    if not found or p_event_revision is distinct from v_submission.updated_at then
      raise exception 'Review assignment notification revision is invalid.' using errcode = '22023';
    end if;

    v_revision_key := floor(extract(epoch from p_event_revision) * 1000000)::bigint::text;
    v_access_mode := 'course_read';
    v_event_key := 'assignment:' || v_assignment.id::text || ':review:'
      || v_submission.id::text || ':' || v_revision_key;
    v_title := 'Feedback is available for ' || v_assignment_title;
    v_message := 'Your assignment review is ready. Open the assignment to view feedback.';
  end if;

  with eligible_recipients as (
    select distinct spa.user_id
    from public.students s
    join public.student_portal_accounts spa
      on spa.tenant_id = s.tenant_id
     and spa.student_id = s.id
    where s.tenant_id = p_tenant_id
      and (p_exact_student_id is null or s.id = p_exact_student_id)
      and (
        v_assignment.cohort_id is null
        or exists (
          select 1
          from public.cohort_members cm
          where cm.tenant_id = p_tenant_id
            and cm.cohort_id = v_assignment.cohort_id
            and cm.student_id = s.id
        )
      )
      and coachfort_internal.student_portal_access_allowed_for_user(
        p_tenant_id,
        s.id,
        spa.user_id,
        v_course_id,
        v_access_mode
      )
  )
  insert into public.notifications (
    tenant_id,
    user_id,
    type,
    title,
    message,
    entity_type,
    entity_id,
    severity,
    status,
    action_url,
    metadata_json,
    event_key
  )
  select
    p_tenant_id,
    recipient.user_id,
    'assignment_notice',
    v_title,
    v_message,
    'assignment',
    v_assignment.id,
    'info',
    'unread',
    v_action_url,
    '{}'::jsonb,
    v_event_key
  from eligible_recipients recipient
  on conflict (tenant_id, user_id, event_key)
  where event_key is not null
  do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

alter function coachfort_internal.insert_assignment_student_notification_event(
  uuid, uuid, text, timestamptz, uuid
) owner to postgres;
revoke all on function coachfort_internal.insert_assignment_student_notification_event(
  uuid, uuid, text, timestamptz, uuid
) from public, anon, authenticated, service_role;

create or replace function public.update_assignment_status_secure(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_status text
)
returns public.assignments
language plpgsql
security definer
set search_path = public, pg_temp
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
    raise exception 'Assignment status transition is not allowed.' using errcode = '22023';
  end if;

  update public.assignments a
  set status = v_status
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
    and a.status = v_existing.status
  returning * into v_assignment;

  if not found then
    raise exception 'Assignment status transition could not be completed.' using errcode = '22023';
  end if;

  perform public.m69_4_write_audit(
    p_tenant_id,
    case when v_assignment.status = 'closed' then 'assignment_closed' else 'assignment_published' end,
    'assignment',
    v_assignment.id,
    'Assignment',
    case when v_assignment.status = 'closed' then 'Closed assignment' else 'Published assignment' end,
    case when v_assignment.status = 'closed' then 'warning' else 'info' end,
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'courseId', v_assignment.course_id,
      'cohortId', v_assignment.cohort_id,
      'status', v_assignment.status,
      'dueDatePresent', v_assignment.due_at is not null
    )
  );

  if v_existing.status = 'draft' and v_assignment.status = 'published' then
    perform coachfort_internal.insert_assignment_student_notification_event(
      p_tenant_id, v_assignment.id, 'published', null, null
    );
  end if;

  return v_assignment;
end;
$$;

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
set search_path = public, pg_temp
as $$
declare
  v_existing public.assignments%rowtype;
  v_assignment public.assignments%rowtype;
  v_actor_role text;
  v_title text;
  v_trainer_user_id uuid;
  v_trainer_changed boolean;
  v_relationship_changed boolean;
  v_has_submission boolean;
  v_due_changed boolean;
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

  perform public.m69_4_assert_manage_assignment(
    p_tenant_id,
    v_existing.course_id,
    v_existing.cohort_id,
    p_assignment_id,
    v_existing.trainer_user_id
  );
  v_actor_role := public.m69_4_current_role(p_tenant_id);

  if v_existing.status = 'closed' then
    raise exception 'Closed assignments cannot be edited.' using errcode = '22023';
  end if;

  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this assignment.' using errcode = '22023';
  end if;

  perform public.m69_4_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_4_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_4_assert_course_cohort_consistency(p_tenant_id, p_course_id, p_cohort_id);

  v_title := public.m69_4_normalize_text(p_title, 'Assignment title', true, 180);
  v_trainer_user_id := v_existing.trainer_user_id;
  v_trainer_changed := p_trainer_user_id is distinct from v_existing.trainer_user_id;
  v_relationship_changed :=
    p_course_id is distinct from v_existing.course_id
    or p_cohort_id is distinct from v_existing.cohort_id;

  if v_existing.status = 'draft' then
    if v_relationship_changed then
      perform public.m69_4_assert_manage_assignment(
        p_tenant_id, p_course_id, p_cohort_id, null, null
      );
    end if;

    if v_trainer_changed then
      if v_actor_role not in ('owner', 'admin') then
        raise exception 'You do not have permission to change the assignment trainer.' using errcode = '42501';
      end if;

      if p_trainer_user_id is not null then
        begin
          perform public.m69_5_assert_active_trainer(p_tenant_id, p_trainer_user_id);
        exception
          when sqlstate '22023' then
            raise exception 'Selected trainer is not available in this workspace.' using errcode = '22023';
        end;
      end if;

      v_trainer_user_id := p_trainer_user_id;
    end if;
  elsif v_existing.status = 'published' then
    if v_relationship_changed or v_trainer_changed then
      raise exception 'Program, cohort, and trainer cannot be changed after publication.' using errcode = '22023';
    end if;

    select exists (
      select 1
      from public.assignment_submissions s
      where s.tenant_id = p_tenant_id
        and s.assignment_id = p_assignment_id
    ) into v_has_submission;

    if v_has_submission
       and (
         p_due_at is distinct from v_existing.due_at
         or p_max_score is distinct from v_existing.max_score
       ) then
      raise exception 'Due date and max score cannot be changed after the first submission.' using errcode = '22023';
    end if;
  else
    raise exception 'Assignment lifecycle state is not supported.' using errcode = '22023';
  end if;

  v_due_changed :=
    v_existing.status = 'published'
    and p_due_at is distinct from v_existing.due_at;

  update public.assignments a
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = v_trainer_user_id,
    title = v_title,
    description = public.m69_4_normalize_text(p_description, 'Description', false, 2000),
    instructions = public.m69_4_normalize_text(p_instructions, 'Instructions', false, 4000),
    attachment_urls_json = public.m69_4_validate_attachment_urls(p_attachment_urls_json),
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

  if v_due_changed then
    perform coachfort_internal.insert_assignment_student_notification_event(
      p_tenant_id, v_assignment.id, 'due_changed', v_assignment.updated_at, null
    );
  end if;

  return v_assignment;
end;
$$;

create or replace function public.review_assignment_submission_secure(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_expected_submission_updated_at timestamptz,
  p_score numeric default null,
  p_feedback text default null
)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments%rowtype;
  v_feedback text;
  v_material_change boolean;
  v_score numeric;
  v_submission public.assignment_submissions%rowtype;
begin
  if p_expected_submission_updated_at is null then
    raise exception 'Expected submission revision is required.' using errcode = '22023';
  end if;

  v_assignment := public.m69_4_assert_assignment_in_tenant(p_tenant_id, p_assignment_id);
  perform public.m69_4_assert_student_in_tenant(p_tenant_id, p_student_id);
  perform public.m69_4_assert_review_assignment(
    p_tenant_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    p_student_id,
    p_assignment_id,
    v_assignment.trainer_user_id
  );

  select * into v_assignment
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found in this workspace.' using errcode = '22023';
  end if;
  if v_assignment.status not in ('published', 'closed') then
    raise exception 'Assignment is not available for review.' using errcode = '22023';
  end if;

  select * into v_submission
  from public.assignment_submissions s
  where s.tenant_id = p_tenant_id
    and s.assignment_id = p_assignment_id
    and s.student_id = p_student_id
  for update;

  if not found then
    raise exception 'Submission not found for this student.' using errcode = '22023';
  end if;
  if v_submission.updated_at is distinct from p_expected_submission_updated_at then
    raise exception 'Submission changed since it was loaded.'
      using errcode = 'P0001', detail = 'assignment_submission_stale';
  end if;

  v_score := public.m69_4_validate_score(p_score, v_assignment.max_score);
  v_feedback := public.m69_4_normalize_text(p_feedback, 'Feedback', false, 4000);
  v_material_change :=
    v_submission.status is distinct from 'reviewed'
    or v_submission.reviewed_at is null
    or v_score is distinct from v_submission.score
    or v_feedback is distinct from v_submission.feedback;

  update public.assignment_submissions s
  set
    feedback = v_feedback,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    score = v_score,
    status = 'reviewed'
  where s.id = v_submission.id
    and s.tenant_id = p_tenant_id
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

  if v_material_change then
    perform coachfort_internal.insert_assignment_student_notification_event(
      p_tenant_id,
      v_assignment.id,
      'review_available',
      v_submission.updated_at,
      v_submission.student_id
    );
  end if;

  return v_submission;
end;
$$;

create or replace function public.review_delegated_assignment_submission(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_expected_submission_updated_at timestamptz,
  p_score numeric default null,
  p_feedback text default null
)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_assignment public.assignments%rowtype;
  v_feedback text;
  v_material_change boolean;
  v_matched_permission_id uuid;
  v_matched_scope_id uuid;
  v_matched_scope_type text;
  v_score numeric;
  v_submission public.assignment_submissions%rowtype;
begin
  if p_expected_submission_updated_at is null then
    raise exception 'Expected submission revision is required.' using errcode = '22023';
  end if;

  if v_actor_id is null or not public.is_tenant_member(p_tenant_id, v_actor_id) then
    raise exception 'You do not have permission to review submissions.' using errcode = '42501';
  end if;

  v_assignment := public.m69_4_assert_assignment_in_tenant(p_tenant_id, p_assignment_id);
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
    raise exception 'You do not have delegated permission to review this submission.' using errcode = '42501';
  end if;

  select * into v_assignment
  from public.assignments a
  where a.tenant_id = p_tenant_id
    and a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found in this workspace.' using errcode = '22023';
  end if;
  if v_assignment.status not in ('published', 'closed') then
    raise exception 'Assignment is not available for review.' using errcode = '22023';
  end if;

  select * into v_submission
  from public.assignment_submissions s
  where s.tenant_id = p_tenant_id
    and s.assignment_id = p_assignment_id
    and s.student_id = p_student_id
  for update;

  if not found then
    raise exception 'Submission not found for this student.' using errcode = '22023';
  end if;
  if v_submission.updated_at is distinct from p_expected_submission_updated_at then
    raise exception 'Submission changed since it was loaded.'
      using errcode = 'P0001', detail = 'assignment_submission_stale';
  end if;

  v_score := public.m69_4_validate_score(p_score, v_assignment.max_score);
  v_feedback := public.m69_4_normalize_text(p_feedback, 'Feedback', false, 4000);
  v_material_change :=
    v_submission.status is distinct from 'reviewed'
    or v_submission.reviewed_at is null
    or v_score is distinct from v_submission.score
    or v_feedback is distinct from v_submission.feedback;

  select dp.scope_type, dp.scope_id
  into v_matched_scope_type, v_matched_scope_id
  from public.delegated_permissions dp
  where dp.id = v_matched_permission_id;

  update public.assignment_submissions s
  set
    feedback = v_feedback,
    reviewed_at = now(),
    reviewed_by = v_actor_id,
    score = v_score,
    status = 'reviewed'
  where s.id = v_submission.id
    and s.tenant_id = p_tenant_id
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

  if v_material_change then
    perform coachfort_internal.insert_assignment_student_notification_event(
      p_tenant_id,
      v_assignment.id,
      'review_available',
      v_submission.updated_at,
      v_submission.student_id
    );
  end if;

  return v_submission;
end;
$$;

create or replace function public.mark_notification_read_secure(
  p_tenant_id uuid,
  p_notification_id uuid
)
returns public.notifications
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_student_portal_allowed boolean := false;
  v_notification public.notifications%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_role := public.m69_6_current_role(p_tenant_id);
  if v_role is null then
    v_student_portal_allowed := public.has_any_active_student_portal_account(
      p_tenant_id, v_actor
    );
  end if;

  if v_role is null and not v_student_portal_allowed then
    raise exception 'Notification not found or not accessible.' using errcode = '42501';
  end if;

  update public.notifications n
  set
    status = 'read',
    read_at = coalesce(n.read_at, now())
  where n.tenant_id = p_tenant_id
    and n.id = p_notification_id
    and (
      v_role in ('owner', 'admin')
      or (
        n.user_id = v_actor
        and (v_role is not null or v_student_portal_allowed)
      )
    )
  returning * into v_notification;

  if not found then
    raise exception 'Notification not found or not accessible.' using errcode = '42501';
  end if;

  return v_notification;
end;
$$;

alter function public.update_assignment_status_secure(uuid, uuid, text) owner to postgres;
alter function public.update_assignment_secure(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) owner to postgres;
alter function public.review_assignment_submission_secure(
  uuid, uuid, uuid, timestamptz, numeric, text
) owner to postgres;
alter function public.review_delegated_assignment_submission(
  uuid, uuid, uuid, timestamptz, numeric, text
) owner to postgres;
alter function public.mark_notification_read_secure(uuid, uuid) owner to postgres;

revoke all on function public.update_assignment_status_secure(uuid, uuid, text)
  from public, anon, service_role;
revoke all on function public.update_assignment_secure(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) from public, anon, service_role;
revoke all on function public.review_assignment_submission_secure(
  uuid, uuid, uuid, timestamptz, numeric, text
) from public, anon, service_role;
revoke all on function public.review_delegated_assignment_submission(
  uuid, uuid, uuid, timestamptz, numeric, text
) from public, anon, service_role;
revoke all on function public.mark_notification_read_secure(uuid, uuid)
  from public, anon, service_role;

grant execute on function public.update_assignment_status_secure(uuid, uuid, text)
  to authenticated;
grant execute on function public.update_assignment_secure(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) to authenticated;
grant execute on function public.review_assignment_submission_secure(
  uuid, uuid, uuid, timestamptz, numeric, text
) to authenticated;
grant execute on function public.review_delegated_assignment_submission(
  uuid, uuid, uuid, timestamptz, numeric, text
) to authenticated;
grant execute on function public.mark_notification_read_secure(uuid, uuid)
  to authenticated;

revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.notifications
  from public, anon, authenticated;

-- Executable postconditions prevent a partially recognized authorization
-- contract from committing even if the commented POST query is not run.
do $$
declare
  v_definition text;
  v_index_definition text;
  v_private regprocedure;
  v_public regprocedure;
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'notifications'
      and c.column_name = 'event_key'
      and c.data_type = 'text'
      and c.is_nullable = 'YES'
      and c.column_default is null
  ) then
    raise exception 'UX-6E1 postcondition failed: event_key contract is missing.' using errcode = '55000';
  end if;

  select lower(i.indexdef) into v_index_definition
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public'
    and i.tablename = 'notifications'
    and i.indexname = 'notifications_tenant_user_event_key_uidx';
  if v_index_definition is null
     or v_index_definition not like 'create unique index%'
     or v_index_definition not like '%(tenant_id, user_id, event_key)%'
     or v_index_definition not like '%where (event_key is not null)%' then
    raise exception 'UX-6E1 postcondition failed: event-key uniqueness is missing.' using errcode = '55000';
  end if;

  foreach v_private in array array[
    pg_catalog.to_regprocedure('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'),
    pg_catalog.to_regprocedure('coachfort_internal.insert_assignment_student_notification_event(uuid,uuid,text,timestamptz,uuid)')
  ] loop
    if v_private is null
       or pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p where p.oid = v_private::oid)) <> 'postgres'
       or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_private::oid)
       or not coalesce(
         (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_private::oid),
         array[]::text[]
       ) @> array['search_path=public, pg_temp']
       or (
         v_private = pg_catalog.to_regprocedure(
           'coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'
         )
         and (select p.provolatile from pg_catalog.pg_proc p where p.oid = v_private::oid) <> 's'
       )
       or (
         v_private = pg_catalog.to_regprocedure(
           'coachfort_internal.insert_assignment_student_notification_event(uuid,uuid,text,timestamptz,uuid)'
         )
         and (select p.provolatile from pg_catalog.pg_proc p where p.oid = v_private::oid) <> 'v'
       )
       or pg_catalog.has_function_privilege('public', v_private, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_private, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_private, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_private, 'EXECUTE') then
      raise exception 'UX-6E1 postcondition failed: private helper ACL is unsafe.' using errcode = '55000';
    end if;
  end loop;

  foreach v_public in array array[
    pg_catalog.to_regprocedure('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    pg_catalog.to_regprocedure('public.update_assignment_status_secure(uuid,uuid,text)'),
    pg_catalog.to_regprocedure('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    pg_catalog.to_regprocedure('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'),
    pg_catalog.to_regprocedure('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'),
    pg_catalog.to_regprocedure('public.mark_notification_read_secure(uuid,uuid)')
  ] loop
    if v_public is null
       or pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p where p.oid = v_public::oid)) <> 'postgres'
       or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_public::oid)
       or not coalesce(
         (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_public::oid),
         array[]::text[]
       ) @> array['search_path=public, pg_temp']
       or pg_catalog.has_function_privilege('public', v_public, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_public, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', v_public, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_public, 'EXECUTE') then
      raise exception 'UX-6E1 postcondition failed: public function ACL is unsafe.' using errcode = '55000';
    end if;
  end loop;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'
    )::oid), '[[:space:]]+', ' ', 'g'
  )) into v_definition;
  if v_definition not like '%p_user_id is distinct from auth.uid()%'
     or v_definition not like '%coachfort_internal.student_portal_access_allowed_for_user%' then
    raise exception 'UX-6E1 postcondition failed: public portal wrapper is unsafe.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) g
    where c.oid = pg_catalog.to_regclass('public.notifications')
      and (
        g.grantee = 0
        or case
          when g.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(g.grantee)
        end = 'anon'
        or (
          case
            when g.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(g.grantee)
          end = 'authenticated'
          and upper(g.privilege_type) <> 'SELECT'
        )
      )
  ) then
    raise exception 'UX-6E1 postcondition failed: browser notification grants are unsafe.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) g
    where c.oid = pg_catalog.to_regclass('public.notifications')
      and case
        when g.grantee = 0 then 'PUBLIC'
        else pg_catalog.pg_get_userbyid(g.grantee)
      end = 'authenticated'
      and upper(g.privilege_type) = 'SELECT'
  ) then
    raise exception 'UX-6E1 postcondition failed: authenticated notification SELECT is missing.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('review_assignment_submission_secure', 'review_delegated_assignment_submission')
      and pg_catalog.pg_get_function_identity_arguments(p.oid)
        <> 'p_tenant_id uuid, p_assignment_id uuid, p_student_id uuid, p_expected_submission_updated_at timestamp with time zone, p_score numeric, p_feedback text'
  ) then
    raise exception 'UX-6E1 postcondition failed: unsafe review overload exists.' using errcode = '55000';
  end if;
end;
$$;

comment on column public.notifications.event_key is
  'Nullable server-generated idempotency key for atomic notification events.';
comment on function coachfort_internal.student_portal_access_allowed_for_user(
  uuid, uuid, uuid, uuid, text
) is 'Private canonical Student Portal access core for trusted database authorization paths.';
comment on function coachfort_internal.insert_assignment_student_notification_event(
  uuid, uuid, text, timestamptz, uuid
) is 'Private set-based assignment Student notification event writer.';

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this query after applying the executable migration. It verifies installed
metadata and normalized source without invoking mutation RPCs.

with
expected_functions(identity, expected_private, expected_volatility, expected_authenticated_execute) as (
  values
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)', true, 's', false),
    ('coachfort_internal.insert_assignment_student_notification_event(uuid,uuid,text,timestamptz,uuid)', true, 'v', false),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)', false, 's', true),
    ('public.update_assignment_status_secure(uuid,uuid,text)', false, 'v', true),
    ('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)', false, 'v', true),
    ('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)', false, 'v', true),
    ('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)', false, 'v', true),
    ('public.mark_notification_read_secure(uuid,uuid)', false, 'v', true)
),
functions as (
  select
    ef.identity,
    ef.expected_private,
    ef.expected_volatility,
    ef.expected_authenticated_execute,
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile,
    p.proconfig,
    p.proacl,
    case when p.oid is null then null else lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g'
    )) end as normalized_definition,
    case when p.oid is null then null else pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') end as public_execute,
    case when p.oid is null then null else pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') end as anon_execute,
    case when p.oid is null then null else pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') end as authenticated_execute,
    case when p.oid is null then null else pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') end as service_role_execute
  from expected_functions ef
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(ef.identity)
),
schema_contract as (
  select jsonb_build_object(
    'event_key_nullable_text', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'notifications'
        and c.column_name = 'event_key' and c.data_type = 'text' and c.is_nullable = 'YES'
    ),
    'event_key_default_null', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'notifications'
        and c.column_name = 'event_key' and c.column_default is null
    ),
    'unique_partial_index', exists (
      select 1 from pg_catalog.pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'notifications'
        and i.indexname = 'notifications_tenant_user_event_key_uidx'
        and lower(i.indexdef) like 'create unique index%'
        and lower(i.indexdef) like '%(tenant_id, user_id, event_key)%'
        and lower(i.indexdef) like '%where (event_key is not null)%'
    ),
    'historical_null_rows', count(*) filter (where n.event_key is null),
    'event_rows', count(*) filter (where n.event_key is not null)
  ) as value
  from public.notifications n
),
notification_policy as (
  select jsonb_build_object(
    'rls_enabled', c.relrowsecurity,
    'force_rls', c.relforcerowsecurity,
    'linked_student_policy_count', count(p.policyname) filter (
      where p.policyname = 'Linked students can read own notifications'
        and p.cmd = 'SELECT'
        and lower(coalesce(p.qual, '')) like '%has_any_active_student_portal_account%'
    )
  ) as value
  from pg_catalog.pg_class c
  left join pg_catalog.pg_policies p
    on p.schemaname = 'public' and p.tablename = 'notifications'
  where c.oid = pg_catalog.to_regclass('public.notifications')
  group by c.relrowsecurity, c.relforcerowsecurity
),
notification_grants as (
  select
    case
      when acl.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl.grantee)
    end as grantee,
    upper(acl.privilege_type) as privilege_type
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) acl
  where c.oid = pg_catalog.to_regclass('public.notifications')
    and (
      acl.grantee = 0
      or pg_catalog.pg_get_userbyid(acl.grantee) in (
        'anon', 'authenticated', 'service_role', 'postgres'
      )
    )
),
notification_select_contract as (
  select jsonb_build_object(
    'authenticated_select_preserved', exists (
      select 1 from notification_grants g
      where g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
    ),
    'public_privileges_absent', not exists (
      select 1 from notification_grants g
      where g.grantee = 'PUBLIC'
    ),
    'anon_privileges_absent', not exists (
      select 1 from notification_grants g
      where g.grantee = 'anon'
    ),
    'authenticated_select_only',
      exists (
        select 1 from notification_grants g
        where g.grantee = 'authenticated' and g.privilege_type = 'SELECT'
      )
      and not exists (
        select 1 from notification_grants g
        where g.grantee = 'authenticated' and g.privilege_type <> 'SELECT'
      )
  ) as value
),
internal_schema_contract as (
  select jsonb_build_object(
    'installed', pg_catalog.to_regnamespace('coachfort_internal') is not null,
    'current_setting_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ),
    'authenticator_role_setting_exposed', exists (
      select 1
      from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) as settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(setting, '=', 2), ','
      ) as exposed(schema_name)
      where r.rolname = 'authenticator'
        and rs.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d
           where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) as value
),
browser_write_grants as (
  select count(*) as grant_count
  from notification_grants g
  where g.grantee in ('PUBLIC', 'anon', 'authenticated')
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
),
browser_dangerous_grants as (
  select count(*) as grant_count
  from notification_grants g
  where g.grantee in ('PUBLIC', 'anon', 'authenticated')
    and g.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
),
unexpected_browser_grants as (
  select count(*) as grant_count
  from notification_grants g
  where g.grantee = 'PUBLIC'
     or g.grantee = 'anon'
     or (g.grantee = 'authenticated' and g.privilege_type <> 'SELECT')
),
unsafe_review_overloads as (
  select count(*) as overload_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('review_assignment_submission_secure', 'review_delegated_assignment_submission')
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
      <> 'p_tenant_id uuid, p_assignment_id uuid, p_student_id uuid, p_expected_submission_updated_at timestamp with time zone, p_score numeric, p_feedback text'
),
contract_signals as (
  select jsonb_build_object(
    'private_core_canonical', bool_and(normalized_definition like '%s.status = ''active''%'
      and normalized_definition like '%s.portal_enabled = true%'
      and normalized_definition like '%spa.status = ''active''%'
      and normalized_definition like '%e.status = ''completed''%'
      and normalized_definition like '%coalesce(p_access_mode, ''portal'')%'
      and normalized_definition like '%course_participate%') filter (
        where identity like 'coachfort_internal.student_portal_access_allowed_for_user%'
      ),
    'public_wrapper_auth_bound', bool_and(normalized_definition like '%p_user_id is distinct from auth.uid()%'
      and normalized_definition like '%coachfort_internal.student_portal_access_allowed_for_user%') filter (
        where identity like 'public.student_portal_access_allowed%'
      ),
    'helper_set_based', bool_and(normalized_definition like '%insert into public.notifications%select%'
      and normalized_definition like '%on conflict (tenant_id, user_id, event_key) where event_key is not null do nothing%'
      and normalized_definition like '%feature.feature_key = ''notifications''%'
      and normalized_definition like '%feature.status = ''enabled''%'
      and normalized_definition like '%/portal/assignments/%'
      and normalized_definition like '%v_event_kind not in (''published'', ''due_changed'', ''review_available'')%') filter (
        where identity like 'coachfort_internal.insert_assignment_student_notification_event%'
      ),
    'recipient_contract_ok', bool_and(
      normalized_definition like '%coachfort_internal.student_portal_access_allowed_for_user%'
      and normalized_definition like '%v_access_mode := ''course_participate''%'
      and normalized_definition like '%from public.cohort_members cm%'
      and normalized_definition like '%cm.tenant_id = p_tenant_id%'
      and normalized_definition like '%cm.cohort_id = v_assignment.cohort_id%'
      and normalized_definition like '%cm.student_id = s.id%'
      and normalized_definition like '%p_exact_student_id is null or s.id = p_exact_student_id%'
      and normalized_definition like '%from public.assignment_submissions s%'
      and normalized_definition like '%s.student_id = p_exact_student_id%'
      and normalized_definition like '%v_access_mode := ''course_read''%'
    ) filter (
      where identity like 'coachfort_internal.insert_assignment_student_notification_event%'
    ),
    'publish_atomic', bool_and(normalized_definition like '%v_existing.status = ''draft'' and v_assignment.status = ''published''%'
      and normalized_definition like '%''published'', null, null%') filter (
        where identity like 'public.update_assignment_status_secure%'
      ),
    'due_actual_change_only', bool_and(normalized_definition like '%v_existing.status = ''published''%'
      and normalized_definition like '%p_due_at is distinct from v_existing.due_at%'
      and normalized_definition like '%''due_changed'', v_assignment.updated_at, null%') filter (
        where identity like 'public.update_assignment_secure%'
      ),
    'review_material_only', bool_and(normalized_definition like '%v_material_change%'
      and normalized_definition like '%v_score is distinct from v_submission.score%'
      and normalized_definition like '%v_feedback is distinct from v_submission.feedback%'
      and normalized_definition like '%assignment_submission_stale%'
      and normalized_definition like '%''review_available''%v_submission.updated_at%v_submission.student_id%') filter (
        where identity like 'public.review_%assignment_submission%'
      ),
    'student_mark_read_own_only', bool_and(normalized_definition like '%has_any_active_student_portal_account%'
      and normalized_definition like '%n.user_id = v_actor%'
      and normalized_definition like '%status = ''read''%'
      and normalized_definition like '%read_at = coalesce(n.read_at, now())%') filter (
        where identity like 'public.mark_notification_read_secure%'
      )
  ) as value
  from functions
),
security_gate as (
  select
    (select (value ->> 'event_key_nullable_text')::boolean from schema_contract)
    and (select (value ->> 'event_key_default_null')::boolean from schema_contract)
    and (select (value ->> 'unique_partial_index')::boolean from schema_contract)
    and (select (value ->> 'rls_enabled')::boolean from notification_policy)
    and (select (value ->> 'linked_student_policy_count')::integer = 1 from notification_policy)
    and (select (value ->> 'authenticated_select_preserved')::boolean from notification_select_contract)
    and (select (value ->> 'public_privileges_absent')::boolean from notification_select_contract)
    and (select (value ->> 'anon_privileges_absent')::boolean from notification_select_contract)
    and (select (value ->> 'authenticated_select_only')::boolean from notification_select_contract)
    and (select (value ->> 'installed')::boolean from internal_schema_contract)
    and not (select (value ->> 'current_setting_exposed')::boolean from internal_schema_contract)
    and not (select (value ->> 'authenticator_role_setting_exposed')::boolean from internal_schema_contract)
    and (select grant_count = 0 from browser_write_grants)
    and (select grant_count = 0 from browser_dangerous_grants)
    and (select grant_count = 0 from unexpected_browser_grants)
    and (select overload_count = 0 from unsafe_review_overloads)
    and bool_and(
      installed
      and owner = 'postgres'
      and security_definer
      and provolatile = expected_volatility
      and coalesce(proconfig, array[]::text[]) @> array['search_path=public, pg_temp']
    )
    and bool_and(
      not public_execute
      and not anon_execute
      and authenticated_execute = expected_authenticated_execute
      and not service_role_execute
    )
    and (select bool_and(value::text not like '%false%') from contract_signals)
    as passed
  from functions
)
select jsonb_build_object(
  'schema_contract', (select value from schema_contract),
  'notification_policy', (select value from notification_policy),
  'direct_grants', (select coalesce(jsonb_agg(to_jsonb(g) order by g.grantee, g.privilege_type), '[]'::jsonb) from notification_grants g),
  'notification_select_contract', (select value from notification_select_contract),
  'internal_schema_contract', (select value from internal_schema_contract),
  'functions', (select coalesce(jsonb_agg(to_jsonb(f) order by f.identity), '[]'::jsonb) from functions f),
  'contract_signals', (select value from contract_signals),
  'browser_write_grants', (select grant_count from browser_write_grants),
  'browser_dangerous_grants', (select grant_count from browser_dangerous_grants),
  'unexpected_browser_grants', (select grant_count from unexpected_browser_grants),
  'unsafe_review_overloads', (select overload_count from unsafe_review_overloads),
  'security_gate', (select passed from security_gate)
) as verification_result;
*/
