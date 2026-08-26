-- Bundle UX-6F2: Student submission native attachment backend.
--
-- Activates the submission-purpose rows reserved by UX-6F1. The existing
-- assignment-purpose APIs, storage service RPCs, table shape, indexes, and RLS
-- configuration remain unchanged.

/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query separately before applying the executable migration. It returns
catalog metadata and aggregate counts only; it does not return business content.

with
submit_state as (
  select jsonb_build_object(
    'five_arg_installed', old_submit.oid is not null,
    'six_arg_installed', new_submit.oid is not null,
    'return_type', case when old_submit.oid is null then null
      else pg_catalog.pg_get_function_result(old_submit.oid) end,
    'owner', case when old_submit.oid is null then null
      else pg_catalog.pg_get_userbyid(old_submit.proowner) end,
    'security_definer', coalesce(old_submit.prosecdef, false),
    'configuration', coalesce(old_submit.proconfig, array[]::text[]),
    'argument_defaults', coalesce(old_submit.pronargdefaults, 0),
    'declared_arguments', arguments.definition,
    'text_default', arguments.definition like
      '%p_submission_text text default null,%',
    'legacy_url_default', arguments.definition like
      '%p_attachment_urls_json jsonb default ''[]''::jsonb',
    'authenticated_execute', old_submit.oid is not null and
      pg_catalog.has_function_privilege('authenticated', old_submit.oid, 'EXECUTE'),
    'public_execute', old_submit.oid is not null and
      pg_catalog.has_function_privilege('public', old_submit.oid, 'EXECUTE'),
    'anon_execute', old_submit.oid is not null and
      pg_catalog.has_function_privilege('anon', old_submit.oid, 'EXECUTE'),
    'service_role_execute', old_submit.oid is not null and
      pg_catalog.has_function_privilege('service_role', old_submit.oid, 'EXECUTE'),
    'student_upsert', source.definition like
      '%on conflict (assignment_id, student_id) do update%',
    'late_helper', source.definition like
      '%m69_4_submission_status_for_due_date%',
    'review_reset', source.definition like '%score = null%'
      and source.definition like '%feedback = null%'
      and source.definition like '%reviewed_at = null%'
      and source.definition like '%reviewed_by = null%',
    'admin_insert_only', source.definition like
      '%if v_role in (''owner'', ''admin'') then%'
      and source.definition like
        '%on conflict (assignment_id, student_id) do nothing%',
    'updated_at_trigger', exists (
      select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_proc trigger_function on trigger_function.oid = t.tgfoid
      join pg_catalog.pg_namespace trigger_schema
        on trigger_schema.oid = trigger_function.pronamespace
      where t.tgrelid = 'public.assignment_submissions'::regclass
        and t.tgname = 'set_assignment_submissions_updated_at'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
        and trigger_schema.nspname = 'public'
        and trigger_function.proname = 'set_updated_at'
        and lower(pg_catalog.pg_get_triggerdef(t.oid, true)) like '%before update%'
    )
  ) as value
  from (select pg_catalog.to_regprocedure(
    'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'
  )::oid as oid) old_oid
  left join pg_catalog.pg_proc old_submit on old_submit.oid = old_oid.oid
  cross join lateral (select pg_catalog.to_regprocedure(
    'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])'
  )::oid as oid) new_oid
  left join pg_catalog.pg_proc new_submit on new_submit.oid = new_oid.oid
  cross join lateral (select lower(pg_catalog.regexp_replace(
    coalesce(pg_catalog.pg_get_functiondef(old_submit.oid), ''),
    '[[:space:]]+', ' ', 'g'
  )) as definition) source
  cross join lateral (select replace(lower(pg_catalog.regexp_replace(
    coalesce(pg_catalog.pg_get_function_arguments(old_submit.oid), ''),
    '[[:space:]]+', ' ', 'g'
  )), 'null::text', 'null') as definition) arguments
), attachment_state as (
  select jsonb_build_object(
    'installed', c.oid is not null,
    'owner', case when c.oid is null then null
      else pg_catalog.pg_get_userbyid(c.relowner) end,
    'rls_enabled', coalesce(c.relrowsecurity, false),
    'force_rls', coalesce(c.relforcerowsecurity, false),
    'submission_purpose_rows', (
      select count(*) from public.assignment_attachments aa
      where aa.purpose = 'submission'
    ),
    'constraints', coalesce((
      select jsonb_agg(con.conname order by con.conname)
      from pg_catalog.pg_constraint con
      where con.conrelid = c.oid
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(i.indexname order by i.indexname)
      from pg_catalog.pg_indexes i
      where i.schemaname = 'public'
        and i.tablename = 'assignment_attachments'
    ), '[]'::jsonb)
  ) as value
  from (select pg_catalog.to_regclass(
    'public.assignment_attachments'
  ) as oid) existing
  left join pg_catalog.pg_class c on c.oid = existing.oid
), review_authorization_state as (
  select jsonb_build_object(
    'standard_review_installed', standard_review.oid is not null,
    'standard_uses_review_assert', standard_source.definition like
      '%m69_4_assert_review_assignment%',
    'delegated_review_installed', delegated_review.oid is not null,
    'delegated_uses_permission_finder', delegated_source.definition like
      '%find_active_delegated_permission_for_action%',
    'delegated_review_assignments', delegated_source.definition like
      '%array[''review_assignments'']%',
    'delegated_permission_helper_installed', pg_catalog.to_regprocedure(
      'public.m69_4_delegated_permission_id(uuid,uuid,text[],uuid,uuid,uuid,uuid)'
    ) is not null,
    'delegated_permission_finder_installed', pg_catalog.to_regprocedure(
      'public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'
    ) is not null,
    'shared_assert_installed', review_assert.oid is not null,
    'shared_assert_uses_delegation', review_assert_source.definition like
      '%m69_4_delegated_permission_id%',
    'shared_assert_manage_assignments', review_assert_source.definition like
      '%manage_assignments%',
    'shared_assert_review_assignments', review_assert_source.definition like
      '%review_assignments%'
  ) as value
  from (select pg_catalog.to_regprocedure(
    'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'
  )::oid as oid) standard_review
  cross join lateral (select pg_catalog.to_regprocedure(
    'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'
  )::oid as oid) delegated_review
  cross join lateral (select pg_catalog.to_regprocedure(
    'public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'
  )::oid as oid) review_assert
  cross join lateral (select lower(pg_catalog.regexp_replace(
    coalesce(pg_catalog.pg_get_functiondef(standard_review.oid), ''),
    '[[:space:]]+', ' ', 'g'
  )) as definition) standard_source
  cross join lateral (select lower(pg_catalog.regexp_replace(
    coalesce(pg_catalog.pg_get_functiondef(delegated_review.oid), ''),
    '[[:space:]]+', ' ', 'g'
  )) as definition) delegated_source
  cross join lateral (select lower(pg_catalog.regexp_replace(
    coalesce(pg_catalog.pg_get_functiondef(review_assert.oid), ''),
    '[[:space:]]+', ' ', 'g'
  )) as definition) review_assert_source
), service_rpc_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'identity', expected.identity,
    'installed', p.oid is not null,
    'owner', case when p.oid is null then null
      else pg_catalog.pg_get_userbyid(p.proowner) end,
    'security_definer', coalesce(p.prosecdef, false),
    'configuration', coalesce(p.proconfig, array[]::text[]),
    'public_execute', p.oid is not null and
      pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE'),
    'anon_execute', p.oid is not null and
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', p.oid is not null and
      pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role_execute', p.oid is not null and
      pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) order by expected.identity), '[]'::jsonb) as value
  from (values
    ('public.get_assignment_attachment_storage_reference_server(uuid)'),
    ('public.finalize_assignment_attachment_upload_server(uuid)'),
    ('public.cancel_assignment_attachment_upload_server(uuid)'),
    ('public.finalize_assignment_attachment_removal_server(uuid)')
  ) expected(identity)
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(expected.identity)
), browser_grants as (
  select jsonb_build_object(
    'attachment_direct_grants', count(*) filter (
      where tp.table_name = 'assignment_attachments'
    ),
    'browser_write_grants', count(*) filter (
      where tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'browser_dangerous_grants', count(*) filter (
      where tp.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
    ),
    'details', coalesce(jsonb_agg(jsonb_build_object(
      'table', tp.table_name,
      'grantee', tp.grantee,
      'privilege', tp.privilege_type
    ) order by tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb)
  ) as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in (
      'assignments', 'assignment_submissions', 'assignment_attachments'
    )
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
), internal_schema_state as (
  select jsonb_build_object(
    'installed', n.oid is not null,
    'owner', case when n.oid is null then null
      else pg_catalog.pg_get_userbyid(n.nspowner) end,
    'postgrest_setting', current_setting('pgrst.db_schemas', true),
    'api_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(settings.setting, '=', 2), ','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and rs.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d
           where d.datname = current_database())
        )
        and settings.setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) as value
  from (select pg_catalog.to_regnamespace(
    'coachfort_internal'
  ) as oid) existing
  left join pg_catalog.pg_namespace n on n.oid = existing.oid
)
select jsonb_build_object(
  'submit_contract', (select value from submit_state),
  'attachment_contract', (select value from attachment_state),
  'review_authorization_contract', (select value from review_authorization_state),
  'service_rpc_contract', (select value from service_rpc_state),
  'browser_grants', (select value from browser_grants),
  'internal_schema', (select value from internal_schema_state)
) as ux6f2_preflight;
*/

begin;

do $$
declare
  v_old_submit regprocedure := pg_catalog.to_regprocedure(
    'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'
  );
  v_new_submit regprocedure := pg_catalog.to_regprocedure(
    'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])'
  );
  v_arguments text;
  v_delegated_review_source text;
  v_review_assert regprocedure;
  v_review_assert_source text;
  v_standard_review_source text;
  v_source text;
  v_postgres pg_catalog.pg_roles%rowtype;
  v_service regprocedure;
  v_service_source text;
begin
  if v_old_submit is null or v_new_submit is not null then
    raise exception 'UX-6F2 prerequisite failed: submit RPC identity drift.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_old_submit::oid
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.prorettype = 'public.assignment_submissions'::regtype
      and 'search_path=public' = any(coalesce(p.proconfig, array[]::text[]))
      and p.pronargdefaults = 2
  ) or pg_catalog.has_function_privilege('public', v_old_submit, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_old_submit, 'EXECUTE')
    or not pg_catalog.has_function_privilege(
      'authenticated', v_old_submit, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', v_old_submit, 'EXECUTE'
    ) then
    raise exception 'UX-6F2 prerequisite failed: five-argument submit metadata or ACL drift.'
      using errcode = '55000';
  end if;

  v_arguments := replace(lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_function_arguments(v_old_submit::oid),
    '[[:space:]]+', ' ', 'g'
  )), 'null::text', 'null');
  if v_arguments <> concat(
    'p_tenant_id uuid, p_assignment_id uuid, p_student_id uuid, ',
    'p_submission_text text default null, ',
    'p_attachment_urls_json jsonb default ''[]''::jsonb'
  ) then
    raise exception 'UX-6F2 prerequisite failed: five-argument submit defaults drift.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_depend d
    where d.refobjid = v_old_submit::oid
      and d.deptype not in ('e', 'i')
  ) then
    raise exception 'UX-6F2 prerequisite failed: old submit RPC has dependent database objects.'
      using errcode = '55000';
  end if;

  v_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(v_old_submit::oid),
    '[[:space:]]+', ' ', 'g'
  ));
  if v_source not like '%if v_role in (''owner'', ''admin'') then%'
     or v_source not like
       '%on conflict (assignment_id, student_id) do nothing%'
     or v_source not like
       '%on conflict (assignment_id, student_id) do update%'
     or v_source not like '%m69_4_submission_status_for_due_date%'
     or v_source not like '%score = null%'
     or v_source not like '%feedback = null%'
     or v_source not like '%reviewed_at = null%'
     or v_source not like '%reviewed_by = null%'
     or v_source not like '%m69_4_validate_attachment_urls%' then
    raise exception 'UX-6F2 prerequisite failed: five-argument submit behavior drift.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'assignment_attachments'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not c.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
  ) then
    raise exception 'UX-6F2 prerequisite failed: UX-6F1 attachment table contract.'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.assignment_attachments'::regclass
      and con.conname in (
        'assignment_attachments_purpose_check',
        'assignment_attachments_purpose_relation_check',
        'assignment_attachments_status_check',
        'assignment_attachments_display_file_name_check',
        'assignment_attachments_mime_type_check',
        'assignment_attachments_byte_size_check',
        'assignment_attachments_storage_state_check',
        'assignment_attachments_object_path_check'
      )
  ) <> 8 or (
    select count(*)
    from pg_catalog.pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'assignment_attachments'
      and i.indexname in (
        'assignment_attachments_pkey',
        'assignment_attachments_storage_identity_uidx',
        'assignment_attachments_assignment_list_idx',
        'assignment_attachments_submission_idx',
        'assignment_attachments_student_assignment_idx'
      )
  ) <> 5 then
    raise exception 'UX-6F2 prerequisite failed: UX-6F1 constraints or indexes drift.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name = 'assignment_attachments'
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) or exists (
    select 1
    from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name in ('assignments', 'assignment_submissions')
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
      and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'UX-6F2 prerequisite failed: direct browser write boundary drift.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc trigger_function on trigger_function.oid = t.tgfoid
    join pg_catalog.pg_namespace trigger_schema
      on trigger_schema.oid = trigger_function.pronamespace
    where t.tgrelid = 'public.assignment_submissions'::regclass
      and t.tgname = 'set_assignment_submissions_updated_at'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and trigger_schema.nspname = 'public'
      and trigger_function.proname = 'set_updated_at'
      and lower(pg_catalog.pg_get_triggerdef(t.oid, true)) like '%before update%'
  ) then
    raise exception 'UX-6F2 prerequisite failed: submission updated_at trigger drift.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.assignment_attachments aa
    where aa.purpose = 'submission'
  ) then
    raise exception 'UX-6F2 prerequisite failed: submission-purpose rows must be zero before activation.'
      using errcode = '55000';
  end if;

  if coalesce(
       'coachfort_internal' = any(regexp_split_to_array(
         replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
       )), false
     ) or exists (
       select 1
       from pg_catalog.pg_db_role_setting rs
       join pg_catalog.pg_roles r on r.oid = rs.setrole
       cross join lateral unnest(rs.setconfig) settings(setting)
       cross join lateral regexp_split_to_table(
         split_part(settings.setting, '=', 2), ','
       ) exposed(schema_name)
       where r.rolname = 'authenticator'
         and rs.setdatabase in (
           0,
           (select d.oid from pg_catalog.pg_database d
            where d.datname = current_database())
         )
         and settings.setting like 'pgrst.db_schemas=%'
         and btrim(exposed.schema_name) = 'coachfort_internal'
     ) then
    raise exception 'UX-6F2 prerequisite failed: internal schema is API-exposed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.document_storage_validate_file(text,text,bigint)'),
      ('public.document_storage_sanitize_file_name(text)'),
      ('public.m69_4_assert_student_in_assignment_roster(uuid,public.assignments,uuid)'),
      ('public.m69_4_submission_status_for_due_date(timestamptz)'),
      ('public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'),
      ('public.m69_4_delegated_permission_id(uuid,uuid,text[],uuid,uuid,uuid,uuid)'),
      ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
      ('public.m69_4_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'),
      ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
      ('coachfort_internal.assert_private_storage_quota(uuid,bigint,integer,boolean)'),
      ('public.get_assignment_attachment_storage_reference_server(uuid)'),
      ('public.finalize_assignment_attachment_upload_server(uuid)'),
      ('public.cancel_assignment_attachment_upload_server(uuid)'),
      ('public.finalize_assignment_attachment_removal_server(uuid)'),
      ('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'),
      ('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)')
    ) required(identity)
    where pg_catalog.to_regprocedure(required.identity) is null
  ) then
    raise exception 'UX-6F2 prerequisite failed: required helper/RPC identity is missing.'
      using errcode = '55000';
  end if;

  v_review_assert := pg_catalog.to_regprocedure(
    'public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'
  );
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_review_assert::oid
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 's'
      and 'search_path=public' = any(coalesce(p.proconfig, array[]::text[]))
  ) or pg_catalog.has_function_privilege('public', v_review_assert, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_review_assert, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', v_review_assert, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', v_review_assert, 'EXECUTE'
    ) then
    raise exception 'UX-6F2 prerequisite failed: shared review authorization helper drift.'
      using errcode = '55000';
  end if;

  v_standard_review_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  v_delegated_review_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  v_review_assert_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(v_review_assert::oid),
    '[[:space:]]+', ' ', 'g'
  ));
  if v_standard_review_source not like '%m69_4_assert_review_assignment%'
     or v_delegated_review_source not like
       '%find_active_delegated_permission_for_action%'
     or v_delegated_review_source not like '%array[''review_assignments'']%'
     or v_review_assert_source not like '%m69_4_delegated_permission_id%'
     or v_review_assert_source not like '%manage_assignments%'
     or v_review_assert_source not like '%review_assignments%'
     or v_review_assert_source not like '%m69_4_trainer_can_manage_scope%'
     or v_review_assert_source like '%v_role = ''staff''%' then
    raise exception 'UX-6F2 prerequisite failed: review authorization union drift.'
      using errcode = '55000';
  end if;

  foreach v_service in array array[
    pg_catalog.to_regprocedure('public.get_assignment_attachment_storage_reference_server(uuid)'),
    pg_catalog.to_regprocedure('public.finalize_assignment_attachment_upload_server(uuid)'),
    pg_catalog.to_regprocedure('public.cancel_assignment_attachment_upload_server(uuid)'),
    pg_catalog.to_regprocedure('public.finalize_assignment_attachment_removal_server(uuid)')
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid = v_service::oid
        and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        and p.prosecdef
        and 'search_path=public, pg_temp' = any(
          coalesce(p.proconfig, array[]::text[])
        )
    ) or pg_catalog.has_function_privilege('public', v_service, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_service, 'EXECUTE')
      or pg_catalog.has_function_privilege(
        'authenticated', v_service, 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', v_service, 'EXECUTE'
      ) then
      raise exception 'UX-6F2 prerequisite failed: service RPC metadata/ACL drift.'
        using errcode = '55000';
    end if;
  end loop;

  v_service_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.get_assignment_attachment_storage_reference_server(uuid)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  if v_service_source not like '%assignment_attachment_path_valid(%'
     or v_service_source not like '%v_attachment.purpose%'
     or v_service_source not like '%v_attachment.student_id%'
     or v_service_source not like '%v_attachment.status = ''removed''%' then
    raise exception 'UX-6F2 prerequisite failed: service storage reference is not purpose-aware.'
      using errcode = '55000';
  end if;

  select r.* into v_postgres
  from pg_catalog.pg_roles r
  where r.rolname = 'postgres';

  if not found or not (v_postgres.rolsuper or v_postgres.rolbypassrls) then
    raise exception 'UX-6F2 prerequisite failed: postgres cannot safely own RLS-bypassing helpers.'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function coachfort_internal.student_submission_attachment_context(
  p_assignment_id uuid,
  p_expected_student_id uuid,
  p_mode text
)
returns table (
  tenant_id uuid,
  student_id uuid,
  course_id uuid,
  cohort_id uuid,
  submission_id uuid,
  assignment_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments%rowtype;
  v_course_id uuid;
  v_mode text := lower(trim(coalesce(p_mode, '')));
  v_student_id uuid;
  v_submission_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
     or p_assignment_id is null
     or v_mode not in ('participate', 'read', 'recover') then
    return;
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = p_assignment_id;

  if not found or v_assignment.status not in ('published', 'closed') then
    return;
  end if;

  if v_mode = 'participate' and v_assignment.status <> 'published' then
    return;
  end if;

  select spa.student_id into v_student_id
  from public.student_portal_accounts spa
  join public.students s
    on s.tenant_id = spa.tenant_id
   and s.id = spa.student_id
  where spa.tenant_id = v_assignment.tenant_id
    and spa.user_id = v_user_id
    and spa.status = 'active'
    and s.status = 'active'
    and s.portal_enabled = true;

  if not found
     or (
       p_expected_student_id is not null
       and p_expected_student_id is distinct from v_student_id
     ) then
    return;
  end if;

  v_course_id := v_assignment.course_id;
  if v_course_id is null and v_assignment.cohort_id is not null then
    select c.course_id into v_course_id
    from public.cohorts c
    where c.tenant_id = v_assignment.tenant_id
      and c.id = v_assignment.cohort_id;
  end if;

  if v_course_id is null then
    return;
  end if;

  if v_assignment.cohort_id is not null and not exists (
    select 1
    from public.cohort_members cm
    where cm.tenant_id = v_assignment.tenant_id
      and cm.cohort_id = v_assignment.cohort_id
      and cm.student_id = v_student_id
  ) then
    return;
  end if;

  if v_mode = 'participate' and not public.student_portal_access_allowed(
    v_assignment.tenant_id,
    v_student_id,
    v_user_id,
    v_course_id,
    'course_participate'
  ) then
    return;
  elsif v_mode = 'read' and not public.student_portal_access_allowed(
    v_assignment.tenant_id,
    v_student_id,
    v_user_id,
    v_course_id,
    'course_read'
  ) then
    return;
  elsif v_mode = 'recover' and not public.student_portal_access_allowed(
    v_assignment.tenant_id,
    v_student_id,
    v_user_id,
    null,
    'portal'
  ) then
    return;
  end if;

  select s.id into v_submission_id
  from public.assignment_submissions s
  where s.tenant_id = v_assignment.tenant_id
    and s.assignment_id = v_assignment.id
    and s.student_id = v_student_id;

  return query select
    v_assignment.tenant_id,
    v_student_id,
    v_course_id,
    v_assignment.cohort_id,
    v_submission_id,
    v_assignment.status;
end;
$$;

alter function coachfort_internal.student_submission_attachment_context(
  uuid, uuid, text
) owner to postgres;
revoke all on function coachfort_internal.student_submission_attachment_context(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.prepare_submission_attachment_upload_secure(
  p_assignment_id uuid,
  p_display_file_name text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.assignments%rowtype;
  v_attachment_id uuid := gen_random_uuid();
  v_context record;
  v_mime_type text := lower(trim(coalesce(p_mime_type, '')));
  v_object_path text;
  v_safe_file_name text;
  v_staged_count integer;
begin
  if v_actor is null or p_assignment_id is null then
    raise exception 'Authentication and assignment id are required.'
      using errcode = '42501';
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = p_assignment_id
  for share;

  if not found then
    raise exception 'Assignment not found.' using errcode = '02000';
  end if;

  select context.* into v_context
  from coachfort_internal.student_submission_attachment_context(
    p_assignment_id, null, 'participate'
  ) context;

  if not found
     or v_context.tenant_id is distinct from v_assignment.tenant_id then
    raise exception 'Student submission attachment upload access denied.'
      using errcode = '42501';
  end if;

  perform public.document_storage_validate_file(
    p_display_file_name, v_mime_type, p_byte_size
  );
  v_safe_file_name := public.document_storage_sanitize_file_name(
    p_display_file_name
  );
  v_object_path := concat(
    'tenant/', v_context.tenant_id,
    '/assignments/', p_assignment_id,
    '/submissions/', v_context.student_id,
    '/attachments/', v_attachment_id,
    '/', v_safe_file_name
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'document_upload_quota:' || v_context.tenant_id::text, 7174
    )
  );

  select count(*)::integer into v_staged_count
  from public.assignment_attachments aa
  where aa.tenant_id = v_context.tenant_id
    and aa.assignment_id = p_assignment_id
    and aa.student_id = v_context.student_id
    and aa.purpose = 'submission'
    and aa.submission_id is null
    and aa.status in ('pending_upload', 'uploaded', 'pending_delete');

  if v_staged_count >= 10 then
    raise exception 'A submission can stage no more than 10 native files.'
      using errcode = '22023';
  end if;

  perform coachfort_internal.assert_private_storage_quota(
    v_context.tenant_id, p_byte_size, 0, false
  );

  insert into public.assignment_attachments (
    id, tenant_id, assignment_id, submission_id, student_id, purpose,
    display_file_name, mime_type, byte_size,
    bucket_name, object_path, status, created_by
  ) values (
    v_attachment_id,
    v_context.tenant_id,
    p_assignment_id,
    null,
    v_context.student_id,
    'submission',
    v_safe_file_name,
    v_mime_type,
    p_byte_size,
    'coachfort-documents',
    v_object_path,
    'pending_upload',
    v_actor
  );

  perform public.m69_4_write_audit(
    v_context.tenant_id,
    'submission_attachment_upload_prepared',
    'assignment_attachment',
    v_attachment_id,
    'Submission attachment',
    'Prepared submission attachment upload',
    'info',
    jsonb_build_object(
      'assignmentId', p_assignment_id,
      'fileSizeBytes', p_byte_size,
      'mimeType', v_mime_type
    )
  );

  return jsonb_build_object(
    'id', v_attachment_id,
    'display_file_name', v_safe_file_name,
    'mime_type', v_mime_type,
    'byte_size', p_byte_size,
    'status', 'pending_upload'
  );
end;
$$;

create or replace function public.get_student_submission_attachments_secure(
  p_assignment_id uuid
)
returns table (
  id uuid,
  display_file_name text,
  mime_type text,
  byte_size bigint,
  status text,
  is_associated boolean,
  created_at timestamptz,
  uploaded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_can_read boolean := false;
  v_read_context record;
  v_recover_context record;
begin
  if auth.uid() is null or p_assignment_id is null then
    raise exception 'Authentication and assignment id are required.'
      using errcode = '42501';
  end if;

  select context.* into v_recover_context
  from coachfort_internal.student_submission_attachment_context(
    p_assignment_id, null, 'recover'
  ) context;

  if not found then
    raise exception 'Student submission attachment access denied.'
      using errcode = '42501';
  end if;

  select context.* into v_read_context
  from coachfort_internal.student_submission_attachment_context(
    p_assignment_id, v_recover_context.student_id, 'read'
  ) context;
  v_can_read := found;

  return query
  select
    aa.id,
    aa.display_file_name,
    aa.mime_type,
    aa.byte_size,
    aa.status,
    aa.submission_id is not null,
    aa.created_at,
    aa.uploaded_at
  from public.assignment_attachments aa
  where aa.tenant_id = v_recover_context.tenant_id
    and aa.assignment_id = p_assignment_id
    and aa.student_id = v_recover_context.student_id
    and aa.purpose = 'submission'
    and aa.status <> 'removed'
    and (
      aa.submission_id is null
      or (
        v_can_read
        and aa.status = 'uploaded'
        and aa.submission_id = v_read_context.submission_id
      )
    )
  order by aa.created_at, aa.id
  limit 20;
end;
$$;

drop function public.submit_assignment_secure(uuid, uuid, uuid, text, jsonb);

create function public.submit_assignment_secure(
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_submission_text text default null,
  p_attachment_urls_json jsonb default '[]'::jsonb,
  p_native_attachment_ids uuid[] default '{}'::uuid[]
)
returns public.assignment_submissions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_access_course_id uuid;
  v_actor uuid := auth.uid();
  v_assignment public.assignments%rowtype;
  v_context record;
  v_existing_submission public.assignment_submissions%rowtype;
  v_existing_submission_id uuid;
  v_native_attachment_ids uuid[] := '{}'::uuid[];
  v_role text;
  v_selected_count integer;
  v_submission public.assignment_submissions%rowtype;
  v_status text;
  v_student_portal_allowed boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_native_attachment_ids is not null and exists (
    select 1 from unnest(p_native_attachment_ids) item(id)
    where item.id is null
  ) then
    raise exception 'Native attachment ids cannot contain null values.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct_ids.id order by distinct_ids.id), '{}')
  into v_native_attachment_ids
  from (
    select distinct item.id
    from unnest(coalesce(p_native_attachment_ids, '{}'::uuid[])) item(id)
  ) distinct_ids;

  if cardinality(v_native_attachment_ids) > 10 then
    raise exception 'A submission can contain no more than 10 native files.'
      using errcode = '22023';
  end if;

  select a.* into v_assignment
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
    select c.course_id into v_access_course_id
    from public.cohorts c
    where c.tenant_id = p_tenant_id
      and c.id = v_assignment.cohort_id;
  end if;

  v_role := public.m69_4_current_role(p_tenant_id);

  if v_assignment.status <> 'published' then
    raise exception 'Assignment is not open for submissions.' using errcode = '22023';
  end if;

  v_status := public.m69_4_submission_status_for_due_date(v_assignment.due_at);

  if v_role in ('owner', 'admin') then
    if cardinality(v_native_attachment_ids) <> 0 then
      raise exception 'Administrators cannot submit Student native attachment ids.'
        using errcode = '42501';
    end if;

    insert into public.assignment_submissions (
      tenant_id,
      assignment_id,
      student_id,
      submitted_by,
      submission_text,
      attachment_urls_json,
      status,
      submitted_at
    ) values (
      p_tenant_id,
      p_assignment_id,
      p_student_id,
      v_actor,
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
    select context.* into v_context
    from coachfort_internal.student_submission_attachment_context(
      p_assignment_id, p_student_id, 'participate'
    ) context;

    if not found or v_context.tenant_id is distinct from p_tenant_id then
      raise exception 'You do not have permission to submit this assignment.'
        using errcode = '42501';
    end if;
    v_student_portal_allowed := true;

    select s.* into v_existing_submission
    from public.assignment_submissions s
    where s.tenant_id = p_tenant_id
      and s.assignment_id = p_assignment_id
      and s.student_id = v_context.student_id
    for update;
    if found then
      v_existing_submission_id := v_existing_submission.id;
    end if;

    perform aa.id
    from public.assignment_attachments aa
    where aa.tenant_id = p_tenant_id
      and aa.assignment_id = p_assignment_id
      and aa.student_id = v_context.student_id
      and aa.purpose = 'submission'
      and aa.status <> 'removed'
    order by aa.id
    for update;

    select count(*)::integer into v_selected_count
    from public.assignment_attachments aa
    where aa.id = any(v_native_attachment_ids)
      and aa.tenant_id = p_tenant_id
      and aa.assignment_id = p_assignment_id
      and aa.student_id = v_context.student_id
      and aa.purpose = 'submission'
      and aa.status = 'uploaded'
      and (
        aa.submission_id is null
        or aa.submission_id = v_existing_submission_id
      );

    if v_selected_count <> cardinality(v_native_attachment_ids) then
      raise exception 'One or more native submission attachments are unavailable.'
        using errcode = '42501';
    end if;

    insert into public.assignment_submissions (
      tenant_id,
      assignment_id,
      student_id,
      submitted_by,
      submission_text,
      attachment_urls_json,
      status,
      submitted_at
    ) values (
      p_tenant_id,
      p_assignment_id,
      v_context.student_id,
      v_actor,
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

    update public.assignment_attachments aa
    set
      status = 'pending_delete',
      submission_id = null,
      delete_requested_at = now(),
      delete_requested_by = v_actor
    where aa.tenant_id = p_tenant_id
      and aa.assignment_id = p_assignment_id
      and aa.student_id = v_context.student_id
      and aa.purpose = 'submission'
      and aa.status = 'uploaded'
      and not (aa.id = any(v_native_attachment_ids));

    update public.assignment_attachments aa
    set
      submission_id = v_submission.id,
      delete_requested_at = null,
      delete_requested_by = null
    where aa.id = any(v_native_attachment_ids)
      and aa.tenant_id = p_tenant_id
      and aa.assignment_id = p_assignment_id
      and aa.student_id = v_context.student_id
      and aa.purpose = 'submission'
      and aa.status = 'uploaded';

    if (
      select count(*)
      from public.assignment_attachments aa
      where aa.tenant_id = p_tenant_id
        and aa.assignment_id = p_assignment_id
        and aa.student_id = v_context.student_id
        and aa.purpose = 'submission'
        and aa.submission_id = v_submission.id
        and aa.status = 'uploaded'
    ) <> cardinality(v_native_attachment_ids) or exists (
      select 1
      from public.assignment_attachments aa
      where aa.tenant_id = p_tenant_id
        and aa.assignment_id = p_assignment_id
        and aa.student_id = v_context.student_id
        and aa.purpose = 'submission'
        and aa.submission_id = v_submission.id
        and (
          aa.status <> 'uploaded'
          or not (aa.id = any(v_native_attachment_ids))
        )
    ) then
      raise exception 'Native submission attachment reconciliation failed.'
        using errcode = '55000';
    end if;
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
      'submittedByStudentPortal', v_student_portal_allowed,
      'nativeAttachmentCount', cardinality(v_native_attachment_ids)
    )
  );

  return v_submission;
end;
$$;

create or replace function public.prepare_submission_attachment_removal_secure(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.assignments%rowtype;
  v_assignment_id uuid;
  v_attachment public.assignment_attachments%rowtype;
  v_context record;
  v_student_id uuid;
begin
  if v_actor is null or p_attachment_id is null then
    raise exception 'Authentication and attachment id are required.'
      using errcode = '42501';
  end if;

  select aa.assignment_id, aa.student_id
  into v_assignment_id, v_student_id
  from public.assignment_attachments aa
  where aa.id = p_attachment_id
    and aa.purpose = 'submission';

  if not found or v_student_id is null then
    raise exception 'Submission attachment not found.' using errcode = '02000';
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = v_assignment_id
  for share;

  if not found then
    raise exception 'Submission attachment relationship is invalid.'
      using errcode = '23514';
  end if;

  select context.* into v_context
  from coachfort_internal.student_submission_attachment_context(
    v_assignment_id, v_student_id, 'recover'
  ) context;

  if not found
     or v_context.tenant_id is distinct from v_assignment.tenant_id then
    raise exception 'Submission attachment recovery access denied.'
      using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id
    and aa.tenant_id = v_context.tenant_id
    and aa.assignment_id = v_assignment_id
    and aa.student_id = v_context.student_id
    and aa.purpose = 'submission'
  for update;

  if not found then
    raise exception 'Submission attachment not found.' using errcode = '02000';
  end if;

  if v_attachment.status = 'removed' then
    return jsonb_build_object(
      'id', v_attachment.id,
      'display_file_name', v_attachment.display_file_name,
      'mime_type', v_attachment.mime_type,
      'byte_size', v_attachment.byte_size,
      'status', 'removed',
      'cleanup_mode', 'none'
    );
  end if;

  if v_attachment.status = 'pending_upload' then
    return jsonb_build_object(
      'id', v_attachment.id,
      'display_file_name', v_attachment.display_file_name,
      'mime_type', v_attachment.mime_type,
      'byte_size', v_attachment.byte_size,
      'status', 'pending_upload',
      'cleanup_mode', 'cancel_upload'
    );
  end if;

  if v_attachment.status = 'pending_delete' then
    return jsonb_build_object(
      'id', v_attachment.id,
      'display_file_name', v_attachment.display_file_name,
      'mime_type', v_attachment.mime_type,
      'byte_size', v_attachment.byte_size,
      'status', 'pending_delete',
      'cleanup_mode', 'delete_uploaded'
    );
  end if;

  if v_attachment.status <> 'uploaded' then
    raise exception 'Submission attachment cannot be removed.'
      using errcode = '22023';
  end if;

  if v_attachment.submission_id is not null then
    raise exception 'Associated submission attachments must be changed by resubmitting.'
      using errcode = '22023';
  end if;

  update public.assignment_attachments aa
  set
    status = 'pending_delete',
    delete_requested_at = now(),
    delete_requested_by = v_actor
  where aa.id = v_attachment.id;

  perform public.m69_4_write_audit(
    v_attachment.tenant_id,
    'submission_attachment_removal_prepared',
    'assignment_attachment',
    v_attachment.id,
    'Submission attachment',
    'Prepared submission attachment removal',
    'info',
    jsonb_build_object('assignmentId', v_attachment.assignment_id)
  );

  return jsonb_build_object(
    'id', v_attachment.id,
    'display_file_name', v_attachment.display_file_name,
    'mime_type', v_attachment.mime_type,
    'byte_size', v_attachment.byte_size,
    'status', 'pending_delete',
    'cleanup_mode', 'delete_uploaded'
  );
end;
$$;

create or replace function public.get_submission_attachments_for_review_secure(
  p_assignment_id uuid,
  p_submission_id uuid
)
returns table (
  id uuid,
  display_file_name text,
  mime_type text,
  byte_size bigint,
  status text,
  created_at timestamptz,
  uploaded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments%rowtype;
  v_submission public.assignment_submissions%rowtype;
begin
  if auth.uid() is null
     or p_assignment_id is null
     or p_submission_id is null then
    raise exception 'Authentication, assignment, and submission are required.'
      using errcode = '42501';
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = p_assignment_id;

  if not found or v_assignment.status not in ('published', 'closed') then
    raise exception 'Assignment is unavailable for review.' using errcode = '02000';
  end if;

  select s.* into v_submission
  from public.assignment_submissions s
  where s.id = p_submission_id
    and s.tenant_id = v_assignment.tenant_id
    and s.assignment_id = v_assignment.id;

  if not found then
    raise exception 'Submission is unavailable for review.' using errcode = '02000';
  end if;

  perform public.m69_4_assert_review_assignment(
    v_assignment.tenant_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    v_submission.student_id,
    v_assignment.id,
    v_assignment.trainer_user_id
  );

  return query
  select
    aa.id,
    aa.display_file_name,
    aa.mime_type,
    aa.byte_size,
    aa.status,
    aa.created_at,
    aa.uploaded_at
  from public.assignment_attachments aa
  where aa.tenant_id = v_assignment.tenant_id
    and aa.assignment_id = v_assignment.id
    and aa.student_id = v_submission.student_id
    and aa.submission_id = v_submission.id
    and aa.purpose = 'submission'
    and aa.status = 'uploaded'
  order by aa.created_at, aa.id
  limit 10;
end;
$$;

create or replace function public.authorize_submission_attachment_download_secure(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.assignments%rowtype;
  v_attachment public.assignment_attachments%rowtype;
  v_authorized boolean := false;
  v_context record;
  v_submission public.assignment_submissions%rowtype;
begin
  if v_actor is null or p_attachment_id is null then
    raise exception 'Authentication and attachment id are required.'
      using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id
    and aa.purpose = 'submission'
    and aa.status = 'uploaded';

  if not found then
    raise exception 'Submission attachment is unavailable.' using errcode = '02000';
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = v_attachment.assignment_id
    and a.tenant_id = v_attachment.tenant_id;

  if not found or v_assignment.status not in ('published', 'closed') then
    raise exception 'Submission attachment is unavailable.' using errcode = '02000';
  end if;

  if v_attachment.submission_id is null then
    select context.* into v_context
    from coachfort_internal.student_submission_attachment_context(
      v_attachment.assignment_id, v_attachment.student_id, 'participate'
    ) context;
    v_authorized := found;
  else
    select context.* into v_context
    from coachfort_internal.student_submission_attachment_context(
      v_attachment.assignment_id, v_attachment.student_id, 'read'
    ) context;
    v_authorized := found
      and v_context.submission_id = v_attachment.submission_id;
  end if;

  if not v_authorized and v_attachment.submission_id is not null then
    select s.* into v_submission
    from public.assignment_submissions s
    where s.id = v_attachment.submission_id
      and s.tenant_id = v_attachment.tenant_id
      and s.assignment_id = v_attachment.assignment_id
      and s.student_id = v_attachment.student_id;

    if found then
      begin
        perform public.m69_4_assert_review_assignment(
          v_assignment.tenant_id,
          v_assignment.course_id,
          v_assignment.cohort_id,
          v_submission.student_id,
          v_assignment.id,
          v_assignment.trainer_user_id
        );
        v_authorized := true;
      exception when sqlstate '42501' then
        v_authorized := false;
      end;
    end if;
  end if;

  if not v_authorized then
    raise exception 'Submission attachment access denied.' using errcode = '42501';
  end if;

  perform public.m69_4_write_audit(
    v_attachment.tenant_id,
    'submission_attachment_download_authorized',
    'assignment_attachment',
    v_attachment.id,
    'Submission attachment',
    'Authorized submission attachment download',
    'info',
    jsonb_build_object('assignmentId', v_attachment.assignment_id)
  );

  return jsonb_build_object(
    'id', v_attachment.id,
    'display_file_name', v_attachment.display_file_name,
    'mime_type', v_attachment.mime_type,
    'byte_size', v_attachment.byte_size,
    'status', v_attachment.status
  );
end;
$$;

alter function public.prepare_submission_attachment_upload_secure(
  uuid, text, text, bigint
) owner to postgres;
alter function public.get_student_submission_attachments_secure(uuid)
  owner to postgres;
alter function public.submit_assignment_secure(
  uuid, uuid, uuid, text, jsonb, uuid[]
) owner to postgres;
alter function public.prepare_submission_attachment_removal_secure(uuid)
  owner to postgres;
alter function public.get_submission_attachments_for_review_secure(uuid, uuid)
  owner to postgres;
alter function public.authorize_submission_attachment_download_secure(uuid)
  owner to postgres;

revoke all on function public.prepare_submission_attachment_upload_secure(
  uuid, text, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.get_student_submission_attachments_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_assignment_secure(
  uuid, uuid, uuid, text, jsonb, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.prepare_submission_attachment_removal_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_submission_attachments_for_review_secure(
  uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.authorize_submission_attachment_download_secure(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.prepare_submission_attachment_upload_secure(
  uuid, text, text, bigint
) to authenticated;
grant execute on function public.get_student_submission_attachments_secure(uuid)
  to authenticated;
grant execute on function public.submit_assignment_secure(
  uuid, uuid, uuid, text, jsonb, uuid[]
) to authenticated;
grant execute on function public.prepare_submission_attachment_removal_secure(uuid)
  to authenticated;
grant execute on function public.get_submission_attachments_for_review_secure(
  uuid, uuid
) to authenticated;
grant execute on function public.authorize_submission_attachment_download_secure(uuid)
  to authenticated;

comment on function coachfort_internal.student_submission_attachment_context(
  uuid, uuid, text
) is 'Private auth-bound Student assignment attachment context for participate, read, and recovery modes.';
comment on function public.prepare_submission_attachment_upload_secure(
  uuid, text, text, bigint
) is 'Prepare one native Student submission attachment upload under canonical participation scope.';
comment on function public.get_student_submission_attachments_secure(uuid)
  is 'Return the authenticated Student bounded native attachment workspace.';
comment on function public.submit_assignment_secure(
  uuid, uuid, uuid, text, jsonb, uuid[]
) is 'Canonical submission/resubmission RPC with an atomic complete native attachment set.';
comment on function public.prepare_submission_attachment_removal_secure(uuid)
  is 'Prepare exact-own unassociated Student submission attachment recovery.';
comment on function public.get_submission_attachments_for_review_secure(uuid, uuid)
  is 'Return a bounded reviewer-authorized native submission attachment list.';
comment on function public.authorize_submission_attachment_download_secure(uuid)
  is 'Authorize exact-own Student or scoped reviewer native submission attachment download.';

do $$
declare
  v_admin_branch text;
  v_browser_rpc regprocedure;
  v_context_source text;
  v_arguments text;
  v_delegated_review_source text;
  v_download_source text;
  v_internal regprocedure;
  v_reviewer_source text;
  v_review_assert regprocedure;
  v_review_assert_source text;
  v_source text;
  v_standard_review_source text;
begin
  if pg_catalog.to_regprocedure(
       'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'
     ) is not null then
    raise exception 'UX-6F2 postcondition failed: old submit identity remains.'
      using errcode = '55000';
  end if;

  v_review_assert := pg_catalog.to_regprocedure(
    'public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'
  );
  if v_review_assert is null or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_review_assert::oid
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 's'
      and 'search_path=public' = any(coalesce(p.proconfig, array[]::text[]))
  ) or pg_catalog.has_function_privilege('public', v_review_assert, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_review_assert, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', v_review_assert, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', v_review_assert, 'EXECUTE'
    ) then
    raise exception 'UX-6F2 postcondition failed: shared review authorization helper.'
      using errcode = '55000';
  end if;

  v_standard_review_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  v_delegated_review_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  v_review_assert_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(v_review_assert::oid),
    '[[:space:]]+', ' ', 'g'
  ));
  v_reviewer_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.get_submission_attachments_for_review_secure(uuid,uuid)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  v_download_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.authorize_submission_attachment_download_secure(uuid)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  if v_standard_review_source not like '%m69_4_assert_review_assignment%'
     or v_delegated_review_source not like
       '%find_active_delegated_permission_for_action%'
     or v_delegated_review_source not like '%array[''review_assignments'']%'
     or v_review_assert_source not like '%m69_4_delegated_permission_id%'
     or v_review_assert_source not like '%manage_assignments%'
     or v_review_assert_source not like '%review_assignments%'
     or v_review_assert_source like '%v_role = ''staff''%'
     or v_reviewer_source not like '%m69_4_assert_review_assignment%'
     or v_download_source not like '%m69_4_assert_review_assignment%'
     or v_download_source not like '%exception when sqlstate ''42501''%'
     or v_download_source like '%exception when others%' then
    raise exception 'UX-6F2 postcondition failed: reviewer authorization union.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(
      'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])'
    )::oid
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 'v'
      and p.prorettype = 'public.assignment_submissions'::regtype
      and p.pronargdefaults = 3
      and 'search_path=public, pg_temp' = any(
        coalesce(p.proconfig, array[]::text[])
      )
  ) then
    raise exception 'UX-6F2 postcondition failed: canonical submit metadata/default.'
      using errcode = '55000';
  end if;

  v_arguments := replace(lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_function_arguments(pg_catalog.to_regprocedure(
      'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])'
    )::oid), '[[:space:]]+', ' ', 'g'
  )), 'null::text', 'null');
  if v_arguments <> concat(
    'p_tenant_id uuid, p_assignment_id uuid, p_student_id uuid, ',
    'p_submission_text text default null, ',
    'p_attachment_urls_json jsonb default ''[]''::jsonb, ',
    'p_native_attachment_ids uuid[] default ''{}''::uuid[]'
  ) then
    raise exception 'UX-6F2 postcondition failed: canonical submit defaults drift.'
      using errcode = '55000';
  end if;

  v_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  v_admin_branch := (
    pg_catalog.regexp_match(
      v_source,
      'if v_role in \(''owner'', ''admin''\) then (.*?) else'
    )
  )[1];

  if v_admin_branch is null
     or v_admin_branch not like '%cardinality(v_native_attachment_ids) <> 0%'
     or v_admin_branch not like
       '%on conflict (assignment_id, student_id) do nothing%'
     or v_admin_branch like '%assignment_attachments%'
     or v_admin_branch like '%student_submission_attachment_context%'
     or v_source not like '%p_student_id%student_submission_attachment_context%participate%'
     or v_source not like '%array_agg(distinct_ids.id order by distinct_ids.id)%'
     or v_source not like '%native attachment ids cannot contain null values%'
     or v_source not like '%cardinality(v_native_attachment_ids) > 10%'
     or v_source not like
       '%perform aa.id from public.assignment_attachments aa where aa.tenant_id = p_tenant_id and aa.assignment_id = p_assignment_id and aa.student_id = v_context.student_id and aa.purpose = ''submission'' and aa.status <> ''removed'' order by aa.id for update%'
     or v_source like '%where aa.id = any(v_native_attachment_ids) or%'
     or v_source not like '%order by aa.id for update%'
     or v_source not like '%status = ''pending_delete''%submission_id = null%'
     or v_source not like '%score = null%feedback = null%reviewed_at = null%reviewed_by = null%'
     or v_source not like '%m69_4_submission_status_for_due_date%'
     or v_source not like '%m69_4_validate_attachment_urls%'
     or v_source not like '%return v_submission%' then
    raise exception 'UX-6F2 postcondition failed: atomic submit source contract.'
      using errcode = '55000';
  end if;

  v_context_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'coachfort_internal.student_submission_attachment_context(uuid,uuid,text)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  if v_context_source not like '%auth.uid()%'
     or v_context_source not like '%p_expected_student_id%v_student_id%'
     or v_context_source not like '%spa.status = ''active''%'
     or v_context_source not like '%s.status = ''active''%'
     or v_context_source not like '%s.portal_enabled = true%'
     or v_context_source not like '%from public.cohort_members%'
     or v_context_source not like '%course_participate%'
     or v_context_source not like '%course_read%'
     or v_context_source not like '%''portal''%' then
    raise exception 'UX-6F2 postcondition failed: Student identity/access contract.'
      using errcode = '55000';
  end if;

  foreach v_browser_rpc in array array[
    pg_catalog.to_regprocedure('public.prepare_submission_attachment_upload_secure(uuid,text,text,bigint)'),
    pg_catalog.to_regprocedure('public.get_student_submission_attachments_secure(uuid)'),
    pg_catalog.to_regprocedure('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])'),
    pg_catalog.to_regprocedure('public.prepare_submission_attachment_removal_secure(uuid)'),
    pg_catalog.to_regprocedure('public.get_submission_attachments_for_review_secure(uuid,uuid)'),
    pg_catalog.to_regprocedure('public.authorize_submission_attachment_download_secure(uuid)')
  ] loop
    if v_browser_rpc is null or not exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid = v_browser_rpc::oid
        and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        and p.prosecdef
        and 'search_path=public, pg_temp' = any(
          coalesce(p.proconfig, array[]::text[])
        )
    ) or pg_catalog.has_function_privilege(
      'public', v_browser_rpc, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon', v_browser_rpc, 'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'authenticated', v_browser_rpc, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'service_role', v_browser_rpc, 'EXECUTE'
    ) then
      raise exception 'UX-6F2 postcondition failed: browser RPC ACL contract.'
        using errcode = '55000';
    end if;
  end loop;

  v_internal := pg_catalog.to_regprocedure(
    'coachfort_internal.student_submission_attachment_context(uuid,uuid,text)'
  );
  if v_internal is null or not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_internal::oid
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 's'
      and 'search_path=public, pg_temp' = any(
        coalesce(p.proconfig, array[]::text[])
      )
  ) or pg_catalog.has_function_privilege('public', v_internal, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_internal, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'authenticated', v_internal, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', v_internal, 'EXECUTE'
    ) then
    raise exception 'UX-6F2 postcondition failed: internal helper ACL contract.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name = 'assignment_attachments'
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) or exists (
    select 1
    from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name in ('assignments', 'assignment_submissions')
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
      and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) or exists (
    select 1
    from public.assignment_attachments aa
    where aa.purpose = 'submission'
  ) then
    raise exception 'UX-6F2 postcondition failed: data/direct-write invariant.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'assignment_attachments'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not c.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
  ) or (
    select count(*)
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.assignment_attachments'::regclass
      and con.conname in (
        'assignment_attachments_purpose_check',
        'assignment_attachments_purpose_relation_check',
        'assignment_attachments_status_check',
        'assignment_attachments_display_file_name_check',
        'assignment_attachments_mime_type_check',
        'assignment_attachments_byte_size_check',
        'assignment_attachments_storage_state_check',
        'assignment_attachments_object_path_check'
      )
  ) <> 8 or (
    select count(*)
    from pg_catalog.pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'assignment_attachments'
      and i.indexname in (
        'assignment_attachments_pkey',
        'assignment_attachments_storage_identity_uidx',
        'assignment_attachments_assignment_list_idx',
        'assignment_attachments_submission_idx',
        'assignment_attachments_student_assignment_idx'
      )
  ) <> 5 or exists (
    select 1
    from pg_catalog.pg_policy p
    where p.polrelid = 'public.assignment_attachments'::regclass
  ) then
    raise exception 'UX-6F2 postcondition failed: UX-6F1 table/index/RLS contract.'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
       'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'
     ) is null then
    raise exception 'UX-6F2 postcondition failed: review RPC identity compatibility.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc trigger_function on trigger_function.oid = t.tgfoid
    join pg_catalog.pg_namespace trigger_schema
      on trigger_schema.oid = trigger_function.pronamespace
    where t.tgrelid = 'public.assignment_submissions'::regclass
      and t.tgname = 'set_assignment_submissions_updated_at'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and trigger_schema.nspname = 'public'
      and trigger_function.proname = 'set_updated_at'
      and lower(pg_catalog.pg_get_triggerdef(t.oid, true)) like '%before update%'
  ) then
    raise exception 'UX-6F2 postcondition failed: submission updated_at trigger compatibility.'
      using errcode = '55000';
  end if;

  foreach v_browser_rpc in array array[
    pg_catalog.to_regprocedure('public.get_assignment_attachment_storage_reference_server(uuid)'),
    pg_catalog.to_regprocedure('public.finalize_assignment_attachment_upload_server(uuid)'),
    pg_catalog.to_regprocedure('public.cancel_assignment_attachment_upload_server(uuid)'),
    pg_catalog.to_regprocedure('public.finalize_assignment_attachment_removal_server(uuid)')
  ] loop
    if v_browser_rpc is null
       or pg_catalog.has_function_privilege('public', v_browser_rpc, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_browser_rpc, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated', v_browser_rpc, 'EXECUTE'
       )
       or not pg_catalog.has_function_privilege(
         'service_role', v_browser_rpc, 'EXECUTE'
       ) then
      raise exception 'UX-6F2 postcondition failed: service RPC compatibility.'
        using errcode = '55000';
    end if;
  end loop;

  v_source := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.get_assignment_attachment_storage_reference_server(uuid)'
    )::oid), '[[:space:]]+', ' ', 'g'
  ));
  if v_source not like '%assignment_attachment_path_valid(%'
     or v_source not like '%v_attachment.purpose%'
     or v_source not like '%v_attachment.student_id%'
     or v_source not like '%v_attachment.status = ''removed''%' then
    raise exception 'UX-6F2 postcondition failed: purpose-aware service RPC compatibility.'
      using errcode = '55000';
  end if;

  if coalesce(
       'coachfort_internal' = any(regexp_split_to_array(
         replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
       )), false
     ) or exists (
       select 1
       from pg_catalog.pg_db_role_setting rs
       join pg_catalog.pg_roles r on r.oid = rs.setrole
       cross join lateral unnest(rs.setconfig) settings(setting)
       cross join lateral regexp_split_to_table(
         split_part(settings.setting, '=', 2), ','
       ) exposed(schema_name)
       where r.rolname = 'authenticator'
         and rs.setdatabase in (
           0,
           (select d.oid from pg_catalog.pg_database d
            where d.datname = current_database())
         )
         and settings.setting like 'pgrst.db_schemas=%'
         and btrim(exposed.schema_name) = 'coachfort_internal'
     ) then
    raise exception 'UX-6F2 postcondition failed: internal schema API exposure.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this query after applying the executable migration. `security_gate` is true
only when the installed metadata, ACL, and source contracts all match UX-6F2.

with
function_state as (
  select
    expected.identity,
    expected.kind,
    p.oid,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile as volatility,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    p.pronargdefaults,
    replace(lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_function_arguments(p.oid), ''),
      '[[:space:]]+', ' ', 'g'
    )), 'null::text', 'null') as arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
      '[[:space:]]+', ' ', 'g'
    )) as source,
    pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
  from (values
    ('coachfort_internal.student_submission_attachment_context(uuid,uuid,text)', 'internal'),
    ('public.prepare_submission_attachment_upload_secure(uuid,text,text,bigint)', 'browser'),
    ('public.get_student_submission_attachments_secure(uuid)', 'browser'),
    ('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])', 'browser'),
    ('public.prepare_submission_attachment_removal_secure(uuid)', 'browser'),
    ('public.get_submission_attachments_for_review_secure(uuid,uuid)', 'browser'),
    ('public.authorize_submission_attachment_download_secure(uuid)', 'browser'),
    ('public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)', 'review_helper'),
    ('public.get_assignment_attachment_storage_reference_server(uuid)', 'service'),
    ('public.finalize_assignment_attachment_upload_server(uuid)', 'service'),
    ('public.cancel_assignment_attachment_upload_server(uuid)', 'service'),
    ('public.finalize_assignment_attachment_removal_server(uuid)', 'service')
  ) expected(identity, kind)
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(expected.identity)
), signals as (
  select jsonb_build_object(
    'submit_contract', jsonb_build_object(
      'six_arg_installed', six.oid is not null,
      'old_five_arg_removed', pg_catalog.to_regprocedure(
        'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'
      ) is null,
      'three_trailing_defaults', six.pronargdefaults = 3,
      'text_default_preserved', six.arguments like
        '%p_submission_text text default null,%',
      'legacy_url_default_preserved', six.arguments like
        '%p_attachment_urls_json jsonb default ''[]''::jsonb,%',
      'empty_uuid_default', six.arguments like
        '%p_native_attachment_ids uuid[] default ''{}''::uuid[]',
      'return_type_preserved', six.result_type = 'assignment_submissions',
      'legacy_url_preserved', six.source like '%m69_4_validate_attachment_urls%'
    ),
    'student_identity_contract', jsonb_build_object(
      'auth_bound', context.source like '%auth.uid()%'
        and context.source like '%p_expected_student_id%v_student_id%',
      'active_portal_identity', context.source like '%spa.status = ''active''%'
        and context.source like '%s.status = ''active''%'
        and context.source like '%s.portal_enabled = true%',
      'cohort_exact', context.source like '%from public.cohort_members%'
    ),
    'staging_contract', jsonb_build_object(
      'staged_cap_10', prepare.source like '%v_staged_count >= 10%',
      'pending_delete_counted', prepare.source like
        '%pending_upload%uploaded%pending_delete%',
      'associated_excluded', prepare.source like '%submission_id is null%',
      'shared_quota', prepare.source like '%document_upload_quota:%7174%'
        and prepare.source like '%p_byte_size, 0, false%'
    ),
    'atomic_association_contract', jsonb_build_object(
      'deterministic_lock', six.source like '%order by aa.id for update%',
      'authoritative_lock_scope', six.source like
        '%perform aa.id from public.assignment_attachments aa where aa.tenant_id = p_tenant_id and aa.assignment_id = p_assignment_id and aa.student_id = v_context.student_id and aa.purpose = ''submission'' and aa.status <> ''removed'' order by aa.id for update%'
        and six.source not like
          '%where aa.id = any(v_native_attachment_ids) or%',
      'selected_associated', six.source like '%submission_id = v_submission.id%',
      'omitted_pending_delete', six.source like
        '%status = ''pending_delete''%submission_id = null%',
      'complete_set_check', six.source like
        '%native submission attachment reconciliation failed%'
    ),
    'admin_capture_contract', jsonb_build_object(
      'nonempty_denied', six.source like
        '%administrators cannot submit student native attachment ids%',
      'insert_only', six.source like
        '%on conflict (assignment_id, student_id) do nothing%',
      'no_attachment_reconciliation', admin_branch.source is not null
        and admin_branch.source not like '%assignment_attachments%'
        and admin_branch.source not like
          '%student_submission_attachment_context%'
    ),
    'review_reset_contract', six.source like '%score = null%'
      and six.source like '%feedback = null%'
      and six.source like '%reviewed_at = null%'
      and six.source like '%reviewed_by = null%',
    'optimistic_concurrency_trigger', exists (
      select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_proc trigger_function on trigger_function.oid = t.tgfoid
      join pg_catalog.pg_namespace trigger_schema
        on trigger_schema.oid = trigger_function.pronamespace
      where t.tgrelid = 'public.assignment_submissions'::regclass
        and t.tgname = 'set_assignment_submissions_updated_at'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
        and trigger_schema.nspname = 'public'
        and trigger_function.proname = 'set_updated_at'
        and lower(pg_catalog.pg_get_triggerdef(t.oid, true)) like '%before update%'
    ),
    'late_contract', six.source like '%m69_4_submission_status_for_due_date%',
    'student_recovery_contract', jsonb_build_object(
      'recover_mode', removal.source like '%''recover''%',
      'pending_upload', removal.source like '%''cleanup_mode'', ''cancel_upload''%',
      'pending_delete', removal.source like '%''cleanup_mode'', ''delete_uploaded''%',
      'associated_denied', removal.source like
        '%associated submission attachments must be changed by resubmitting%'
    ),
    'download_contract', jsonb_build_object(
      'staged_participate', download.source like '%''participate''%',
      'associated_read', download.source like '%''read''%',
      'safe_metadata', download.source not like '%''bucket_name''%'
        and download.source not like '%''object_path''%'
    ),
    'reviewer_contract', jsonb_build_object(
      'standard_list_authorization', reviewer.source like
        '%m69_4_assert_review_assignment%',
      'standard_download_authorization', download.source like
        '%m69_4_assert_review_assignment%',
      'delegated_list_authorization', reviewer.source like
        '%m69_4_assert_review_assignment%'
        and review_auth.source like '%m69_4_delegated_permission_id%',
      'delegated_download_authorization', download.source like
        '%m69_4_assert_review_assignment%'
        and review_auth.source like '%m69_4_delegated_permission_id%',
      'delegated_manage_assignments', review_auth.source like
        '%manage_assignments%',
      'delegated_review_assignments', review_auth.source like
        '%review_assignments%',
      'delegated_permission_helper_installed', pg_catalog.to_regprocedure(
        'public.m69_4_delegated_permission_id(uuid,uuid,text[],uuid,uuid,uuid,uuid)'
      ) is not null,
      'delegated_permission_finder_installed', pg_catalog.to_regprocedure(
        'public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'
      ) is not null,
      'delegated_exact_scope', review_auth.source like
        '%p_tenant_id%p_course_id%p_cohort_id%p_student_id%p_assignment_id%',
      'staff_implicit_absent', review_auth.source not like
        '%v_role = ''staff''%',
      'expected_denial_only', download.source like
        '%exception when sqlstate ''42501''%'
        and download.source not like '%exception when others%',
      'published_closed', reviewer.source like
        '%status not in (''published'', ''closed'')%',
      'bound_10', reviewer.source like '%limit 10%',
      'uploaded_associated_only', reviewer.source like
        '%aa.submission_id = v_submission.id%'
        and reviewer.source like '%aa.status = ''uploaded''%'
    ),
    'rpc_acl_contract', not exists (
      select 1 from function_state f
      where (f.kind = 'browser' and (
        f.oid is null or f.owner <> 'postgres' or not f.security_definer
        or f.public_execute or f.anon_execute or not f.authenticated_execute
        or f.service_role_execute
      )) or (f.kind = 'internal' and (
        f.oid is null or f.owner <> 'postgres' or not f.security_definer
        or f.volatility <> 's' or f.public_execute or f.anon_execute
        or f.authenticated_execute or f.service_role_execute
      )) or (f.kind = 'review_helper' and (
        f.oid is null or f.owner <> 'postgres' or not f.security_definer
        or f.volatility <> 's' or f.public_execute or f.anon_execute
        or f.authenticated_execute or f.service_role_execute
        or not ('search_path=public' = any(f.configuration))
      ))
    ),
    'service_rpc_compatibility', not exists (
      select 1 from function_state f
      where f.kind = 'service' and (
        f.oid is null or f.public_execute or f.anon_execute
        or f.authenticated_execute or not f.service_role_execute
      )
    ),
    'ux6f1_compatibility', jsonb_build_object(
      'table_owner_postgres', pg_catalog.pg_get_userbyid(c.relowner) = 'postgres',
      'rls_enabled', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity,
      'required_constraints', (
        select count(*) from pg_catalog.pg_constraint con
        where con.conrelid = c.oid
          and con.conname in (
            'assignment_attachments_purpose_check',
            'assignment_attachments_purpose_relation_check',
            'assignment_attachments_status_check',
            'assignment_attachments_display_file_name_check',
            'assignment_attachments_mime_type_check',
            'assignment_attachments_byte_size_check',
            'assignment_attachments_storage_state_check',
            'assignment_attachments_object_path_check'
          )
      ),
      'required_indexes', (
        select count(*) from pg_catalog.pg_indexes i
        where i.schemaname = 'public'
          and i.tablename = 'assignment_attachments'
          and i.indexname in (
            'assignment_attachments_pkey',
            'assignment_attachments_storage_identity_uidx',
            'assignment_attachments_assignment_list_idx',
            'assignment_attachments_submission_idx',
            'assignment_attachments_student_assignment_idx'
          )
      ),
      'policies', (
        select count(*) from pg_catalog.pg_policy p
        where p.polrelid = c.oid
      ),
      'browser_direct_grants', (
        select count(*) from information_schema.table_privileges tp
        where tp.table_schema = 'public'
          and tp.table_name = 'assignment_attachments'
          and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      ),
      'submission_rows_after_apply', (
        select count(*) from public.assignment_attachments aa
        where aa.purpose = 'submission'
      ),
      'assignment_browser_write_grants', (
        select count(*) from information_schema.table_privileges tp
        where tp.table_schema = 'public'
          and tp.table_name in ('assignments', 'assignment_submissions')
          and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
          and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      ),
      'internal_schema_api_exposed', coalesce(
        'coachfort_internal' = any(regexp_split_to_array(
          replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
        )), false
      ) or exists (
        select 1
        from pg_catalog.pg_db_role_setting rs
        join pg_catalog.pg_roles r on r.oid = rs.setrole
        cross join lateral unnest(rs.setconfig) settings(setting)
        cross join lateral regexp_split_to_table(
          split_part(settings.setting, '=', 2), ','
        ) exposed(schema_name)
        where r.rolname = 'authenticator'
          and rs.setdatabase in (
            0,
            (select d.oid from pg_catalog.pg_database d
             where d.datname = current_database())
          )
          and settings.setting like 'pgrst.db_schemas=%'
          and btrim(exposed.schema_name) = 'coachfort_internal'
      )
    )
  ) as value
  from function_state six
  cross join function_state context
  cross join function_state prepare
  cross join function_state removal
  cross join function_state download
  cross join function_state reviewer
  cross join function_state review_auth
  cross join lateral (
    select (
      pg_catalog.regexp_match(
        six.source,
        'if v_role in \(''owner'', ''admin''\) then (.*?) else'
      )
    )[1] as source
  ) admin_branch
  cross join pg_catalog.pg_class c
  where six.identity = 'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb,uuid[])'
    and context.identity = 'coachfort_internal.student_submission_attachment_context(uuid,uuid,text)'
    and prepare.identity = 'public.prepare_submission_attachment_upload_secure(uuid,text,text,bigint)'
    and removal.identity = 'public.prepare_submission_attachment_removal_secure(uuid)'
    and download.identity = 'public.authorize_submission_attachment_download_secure(uuid)'
    and reviewer.identity = 'public.get_submission_attachments_for_review_secure(uuid,uuid)'
    and review_auth.identity = 'public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'
    and c.oid = 'public.assignment_attachments'::regclass
), gate as (
  select value, (
    value #>> '{submit_contract,six_arg_installed}' = 'true'
    and value #>> '{submit_contract,old_five_arg_removed}' = 'true'
    and value #>> '{submit_contract,three_trailing_defaults}' = 'true'
    and value #>> '{submit_contract,text_default_preserved}' = 'true'
    and value #>> '{submit_contract,legacy_url_default_preserved}' = 'true'
    and value #>> '{submit_contract,empty_uuid_default}' = 'true'
    and value #>> '{submit_contract,return_type_preserved}' = 'true'
    and value #>> '{submit_contract,legacy_url_preserved}' = 'true'
    and value #>> '{student_identity_contract,auth_bound}' = 'true'
    and value #>> '{student_identity_contract,active_portal_identity}' = 'true'
    and value #>> '{student_identity_contract,cohort_exact}' = 'true'
    and value #>> '{staging_contract,staged_cap_10}' = 'true'
    and value #>> '{staging_contract,pending_delete_counted}' = 'true'
    and value #>> '{staging_contract,associated_excluded}' = 'true'
    and value #>> '{staging_contract,shared_quota}' = 'true'
    and value #>> '{atomic_association_contract,deterministic_lock}' = 'true'
    and value #>> '{atomic_association_contract,authoritative_lock_scope}' = 'true'
    and value #>> '{atomic_association_contract,selected_associated}' = 'true'
    and value #>> '{atomic_association_contract,omitted_pending_delete}' = 'true'
    and value #>> '{atomic_association_contract,complete_set_check}' = 'true'
    and value #>> '{admin_capture_contract,nonempty_denied}' = 'true'
    and value #>> '{admin_capture_contract,insert_only}' = 'true'
    and value #>> '{admin_capture_contract,no_attachment_reconciliation}' = 'true'
    and value ->> 'review_reset_contract' = 'true'
    and value ->> 'optimistic_concurrency_trigger' = 'true'
    and value ->> 'late_contract' = 'true'
    and value #>> '{student_recovery_contract,recover_mode}' = 'true'
    and value #>> '{student_recovery_contract,pending_upload}' = 'true'
    and value #>> '{student_recovery_contract,pending_delete}' = 'true'
    and value #>> '{student_recovery_contract,associated_denied}' = 'true'
    and value #>> '{download_contract,staged_participate}' = 'true'
    and value #>> '{download_contract,associated_read}' = 'true'
    and value #>> '{download_contract,safe_metadata}' = 'true'
    and value #>> '{reviewer_contract,standard_list_authorization}' = 'true'
    and value #>> '{reviewer_contract,standard_download_authorization}' = 'true'
    and value #>> '{reviewer_contract,delegated_list_authorization}' = 'true'
    and value #>> '{reviewer_contract,delegated_download_authorization}' = 'true'
    and value #>> '{reviewer_contract,delegated_manage_assignments}' = 'true'
    and value #>> '{reviewer_contract,delegated_review_assignments}' = 'true'
    and value #>> '{reviewer_contract,delegated_permission_helper_installed}' = 'true'
    and value #>> '{reviewer_contract,delegated_permission_finder_installed}' = 'true'
    and value #>> '{reviewer_contract,delegated_exact_scope}' = 'true'
    and value #>> '{reviewer_contract,staff_implicit_absent}' = 'true'
    and value #>> '{reviewer_contract,expected_denial_only}' = 'true'
    and value #>> '{reviewer_contract,published_closed}' = 'true'
    and value #>> '{reviewer_contract,bound_10}' = 'true'
    and value #>> '{reviewer_contract,uploaded_associated_only}' = 'true'
    and value ->> 'rpc_acl_contract' = 'true'
    and value ->> 'service_rpc_compatibility' = 'true'
    and value #>> '{ux6f1_compatibility,table_owner_postgres}' = 'true'
    and value #>> '{ux6f1_compatibility,rls_enabled}' = 'true'
    and value #>> '{ux6f1_compatibility,force_rls}' = 'false'
    and value #>> '{ux6f1_compatibility,required_constraints}' = '8'
    and value #>> '{ux6f1_compatibility,required_indexes}' = '5'
    and value #>> '{ux6f1_compatibility,policies}' = '0'
    and value #>> '{ux6f1_compatibility,browser_direct_grants}' = '0'
    and value #>> '{ux6f1_compatibility,submission_rows_after_apply}' = '0'
    and value #>> '{ux6f1_compatibility,assignment_browser_write_grants}' = '0'
    and value #>> '{ux6f1_compatibility,internal_schema_api_exposed}' = 'false'
  ) as security_gate
  from signals
)
select jsonb_build_object(
  'security_gate', security_gate,
  'contracts', value
) as ux6f2_post_apply
from gate;
*/
