-- Bundle UX-4B1: remove cohort/cohort-member RLS recursion.
--
-- The UX-4B student SELECT policies formed this cycle:
--   cohorts -> cohort_members -> cohorts
-- Both policies now call one auth-bound SECURITY DEFINER helper. The helper
-- performs the authoritative cohort, membership, student, and course lookup as
-- its owner, then delegates status semantics to student_portal_access_allowed.
-- It lives outside the exposed public API schema. Authenticated EXECUTE is
-- required because PostgreSQL evaluates policy function calls as the caller.

-- PRE-APPLY (read-only): run separately before applying this migration.
/*
with policy_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', p.tablename,
    'policy', p.policyname,
    'command', p.cmd,
    'roles', p.roles,
    'using', p.qual
  ) order by p.tablename, p.policyname), '[]'::jsonb) as value
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('cohorts', 'cohort_members')
), table_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'owner', owner_role.rolname,
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'postgres_helper_owner_bypass_safe',
      postgres_role.rolsuper
      or postgres_role.rolbypassrls
      or (c.relowner = postgres_role.oid and not c.relforcerowsecurity)
  ) order by c.relname), '[]'::jsonb) as value
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = c.relowner
  cross join pg_catalog.pg_roles postgres_role
  where n.nspname = 'public'
    and c.relname in ('cohorts', 'cohort_members')
    and postgres_role.rolname = 'postgres'
), table_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', tp.table_name,
    'grantee', tp.grantee,
    'privilege', tp.privilege_type
  ) order by tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb) as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('cohorts', 'cohort_members')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), dangerous_grants as (
  select count(*)::integer as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('cohorts', 'cohort_members')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and tp.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
), browser_write_grants as (
  select count(*)::integer as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('cohorts', 'cohort_members')
    and tp.grantee in ('anon', 'authenticated')
    and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), internal_schema_state as (
  select jsonb_build_object(
    'exists', n.oid is not null,
    'owner', owner_role.rolname,
    'postgrest_db_schemas_setting', current_setting('pgrst.db_schemas', true),
    'authenticator_role_db_schemas_setting', (
      select split_part(setting, '=', 2)
      from pg_catalog.pg_db_role_setting role_setting
      join pg_catalog.pg_roles authenticator
        on authenticator.oid = role_setting.setrole
      cross join lateral unnest(role_setting.setconfig) as settings(setting)
      where authenticator.rolname = 'authenticator'
        and role_setting.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
      order by (role_setting.setdatabase <> 0) desc
      limit 1
    ),
    'listed_in_authenticator_role_setting', exists (
      select 1
      from pg_catalog.pg_db_role_setting role_setting
      join pg_catalog.pg_roles authenticator
        on authenticator.oid = role_setting.setrole
      cross join lateral unnest(role_setting.setconfig) as settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(setting, '=', 2), ','
      ) as exposed(schema_name)
      where authenticator.rolname = 'authenticator'
        and role_setting.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ),
    'listed_in_visible_postgrest_setting', coalesce(
      'coachfort_internal' = any (
        regexp_split_to_array(
          replace(current_setting('pgrst.db_schemas', true), ' ', ''),
          ','
        )
      ),
      false
    ),
    'role_schema_privileges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', r.rolname,
        'usage', pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE'),
        'create', pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')
      ) order by r.rolname)
      from pg_catalog.pg_roles r
      where r.rolname in ('anon', 'authenticated', 'service_role')
        and n.oid is not null
    ), '[]'::jsonb),
    'authenticated_executable_functions', coalesce((
      select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
      from pg_catalog.pg_proc p
      where p.pronamespace = n.oid
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ), '[]'::jsonb)
  ) as value
  from (select to_regnamespace('coachfort_internal') as oid) existing
  left join pg_catalog.pg_namespace n on n.oid = existing.oid
  left join pg_catalog.pg_roles owner_role on owner_role.oid = n.nspowner
), recursion_state as (
  select jsonb_build_object(
    'cohorts_policy_directly_reads_cohort_members', exists (
      select 1 from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'cohorts'
        and p.policyname = 'Linked students can read own cohorts'
        and lower(coalesce(p.qual, '')) ~ '(^|[^a-z_])cohort_members([^a-z_]|$)'
    ),
    'cohort_members_policy_directly_reads_cohorts', exists (
      select 1 from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'cohort_members'
        and p.policyname = 'Linked students can read own cohort memberships'
        and lower(coalesce(p.qual, '')) ~ '(^|[^a-z_])cohorts([^a-z_]|$)'
    )
  ) as value
)
select jsonb_build_object(
  'policies', (select value from policy_state),
  'tables', (select value from table_state),
  'direct_grants', (select value from table_grants),
  'dangerous_grants', (select value from dangerous_grants),
  'browser_write_grants', (select value from browser_write_grants),
  'internal_schema', (select value from internal_schema_state),
  'recursive_policy_edges', (select value from recursion_state),
  'internal_helper_before', to_regprocedure(
    'coachfort_internal.student_can_access_cohort(uuid,uuid,uuid,uuid,text)'
  ),
  'cohort_rows', (select count(*) from public.cohorts),
  'cohort_member_rows', (select count(*) from public.cohort_members)
) as preflight_result;
*/

begin;

create schema if not exists coachfort_internal authorization postgres;

revoke all on schema coachfort_internal from public, anon, authenticated, service_role;
grant usage on schema coachfort_internal to authenticated;

create or replace function coachfort_internal.student_can_access_cohort(
  p_tenant_id uuid,
  p_user_id uuid,
  p_cohort_id uuid,
  p_student_id uuid,
  p_access_mode text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := lower(trim(p_access_mode));
begin
  if p_tenant_id is null
     or p_user_id is null
     or auth.uid() is null
     or p_user_id is distinct from auth.uid()
     or p_cohort_id is null
     or p_access_mode is null
     or v_mode not in ('course_read', 'course_participate') then
    return false;
  end if;

  return exists (
    select 1
    from public.cohorts c
    join public.cohort_members cm
      on cm.tenant_id = c.tenant_id
     and cm.cohort_id = c.id
    join public.student_portal_accounts spa
      on spa.tenant_id = cm.tenant_id
     and spa.student_id = cm.student_id
     and spa.user_id = p_user_id
    where c.tenant_id = p_tenant_id
      and c.id = p_cohort_id
      and (p_student_id is null or cm.student_id = p_student_id)
      and public.student_portal_access_allowed(
        c.tenant_id,
        cm.student_id,
        p_user_id,
        c.course_id,
        v_mode
      )
  );
end;
$$;

alter function coachfort_internal.student_can_access_cohort(
  uuid, uuid, uuid, uuid, text
) owner to postgres;

-- SECURITY DEFINER only breaks the policy cycle when its owner bypasses RLS.
-- Fail the transaction if FORCE RLS or unexpected ownership/role attributes
-- would cause the helper's direct cohort reads to re-enter these policies.
do $$
declare
  v_unsafe_tables text[];
begin
  select array_agg(c.relname order by c.relname)
    into v_unsafe_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join pg_catalog.pg_roles helper_owner
  where n.nspname = 'public'
    and c.relname in ('cohorts', 'cohort_members')
    and helper_owner.rolname = 'postgres'
    and not (
      helper_owner.rolsuper
      or helper_owner.rolbypassrls
      or (c.relowner = helper_owner.oid and not c.relforcerowsecurity)
    );

  if coalesce(cardinality(v_unsafe_tables), 0) > 0 then
    raise exception
      'UX-4B1 cannot install: helper owner cannot bypass RLS for %.',
      array_to_string(v_unsafe_tables, ', ')
      using errcode = '42501';
  end if;

  if coalesce(
       'coachfort_internal' = any (
         regexp_split_to_array(
           replace(current_setting('pgrst.db_schemas', true), ' ', ''),
           ','
         )
       ),
       false
     )
     or exists (
       select 1
       from pg_catalog.pg_db_role_setting role_setting
       join pg_catalog.pg_roles authenticator
         on authenticator.oid = role_setting.setrole
       cross join lateral unnest(role_setting.setconfig) as settings(setting)
       cross join lateral regexp_split_to_table(
         split_part(setting, '=', 2), ','
       ) as exposed(schema_name)
       where authenticator.rolname = 'authenticator'
         and role_setting.setdatabase in (
           0,
           (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
         )
         and setting like 'pgrst.db_schemas=%'
         and btrim(exposed.schema_name) = 'coachfort_internal'
     ) then
    raise exception
      'UX-4B1 cannot install: internal helper schema is API-exposed.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function coachfort_internal.student_can_access_cohort(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

-- Required solely so authenticated SELECT policies can invoke the helper. The
-- function is not in the exposed public API schema and remains auth.uid-bound.
grant execute on function coachfort_internal.student_can_access_cohort(
  uuid, uuid, uuid, uuid, text
) to authenticated;

alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;

drop policy if exists "Linked students can read own cohort memberships"
on public.cohort_members;
create policy "Linked students can read own cohort memberships"
on public.cohort_members
for select
to authenticated
using (
  (select coachfort_internal.student_can_access_cohort(
    cohort_members.tenant_id,
    auth.uid(),
    cohort_members.cohort_id,
    cohort_members.student_id,
    'course_read'
  ))
);

drop policy if exists "Linked students can read own cohorts"
on public.cohorts;
create policy "Linked students can read own cohorts"
on public.cohorts
for select
to authenticated
using (
  (select coachfort_internal.student_can_access_cohort(
    cohorts.tenant_id,
    auth.uid(),
    cohorts.id,
    null::uuid,
    'course_read'
  ))
);

commit;

-- POST-APPLY (read-only): returns one compact verification result.
with helper as (
  select
    p.oid,
    p.proowner,
    owner_role.rolname as owner_name,
    owner_role.rolsuper as owner_superuser,
    owner_role.rolbypassrls as owner_bypassrls,
    n.nspname as schema_name,
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    p.proacl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
  where n.nspname = 'coachfort_internal'
    and p.proname = 'student_can_access_cohort'
    and p.oid = to_regprocedure(
      'coachfort_internal.student_can_access_cohort(uuid,uuid,uuid,uuid,text)'
    )
), helper_acl as (
  select
    case when acl.grantee = 0 then 'PUBLIC' else role_name.rolname end as grantee,
    acl.privilege_type
  from helper h
  cross join lateral pg_catalog.aclexplode(
    coalesce(h.proacl, pg_catalog.acldefault('f', h.proowner))
  ) acl
  left join pg_catalog.pg_roles role_name on role_name.oid = acl.grantee
), internal_schema_state as (
  select jsonb_build_object(
    'owner', owner_role.rolname,
    'postgrest_db_schemas_setting', current_setting('pgrst.db_schemas', true),
    'authenticator_role_db_schemas_setting', (
      select split_part(setting, '=', 2)
      from pg_catalog.pg_db_role_setting role_setting
      join pg_catalog.pg_roles authenticator
        on authenticator.oid = role_setting.setrole
      cross join lateral unnest(role_setting.setconfig) as settings(setting)
      where authenticator.rolname = 'authenticator'
        and role_setting.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
      order by (role_setting.setdatabase <> 0) desc
      limit 1
    ),
    'listed_in_authenticator_role_setting', exists (
      select 1
      from pg_catalog.pg_db_role_setting role_setting
      join pg_catalog.pg_roles authenticator
        on authenticator.oid = role_setting.setrole
      cross join lateral unnest(role_setting.setconfig) as settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(setting, '=', 2), ','
      ) as exposed(schema_name)
      where authenticator.rolname = 'authenticator'
        and role_setting.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d where d.datname = current_database())
        )
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ),
    'listed_in_visible_postgrest_setting', coalesce(
      'coachfort_internal' = any (
        regexp_split_to_array(
          replace(current_setting('pgrst.db_schemas', true), ' ', ''),
          ','
        )
      ),
      false
    ),
    'role_schema_privileges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', r.rolname,
        'usage', pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE'),
        'create', pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')
      ) order by r.rolname)
      from pg_catalog.pg_roles r
      where r.rolname in ('anon', 'authenticated', 'service_role')
    ), '[]'::jsonb),
    'authenticated_executable_functions', coalesce((
      select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
      from pg_catalog.pg_proc p
      where p.pronamespace = n.oid
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ), '[]'::jsonb)
  ) as value
  from pg_catalog.pg_namespace n
  join pg_catalog.pg_roles owner_role on owner_role.oid = n.nspowner
  where n.nspname = 'coachfort_internal'
), policy_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', p.tablename,
    'policy', p.policyname,
    'command', p.cmd,
    'roles', p.roles,
    'using', p.qual
  ) order by p.tablename, p.policyname), '[]'::jsonb) as value
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('cohorts', 'cohort_members')
), policy_integrity as (
  select jsonb_build_object(
    'student_policies_using_internal_helper', count(*) filter (
      where p.policyname in (
        'Linked students can read own cohorts',
        'Linked students can read own cohort memberships'
      )
      and lower(coalesce(p.qual, '')) like '%coachfort_internal.student_can_access_cohort%'
    ),
    'direct_reciprocal_policy_edges', count(*) filter (
      where (p.tablename = 'cohorts'
        and p.policyname = 'Linked students can read own cohorts'
        and lower(coalesce(p.qual, '')) ~ '(^|[^a-z_])cohort_members([^a-z_]|$)')
      or (p.tablename = 'cohort_members'
        and p.policyname = 'Linked students can read own cohort memberships'
        and lower(coalesce(p.qual, '')) ~ '(^|[^a-z_])cohorts([^a-z_]|$)')
    ),
    'team_read_policies_present', count(*) filter (
      where (p.tablename = 'cohorts' and p.policyname = 'Tenant members can read cohorts')
         or (p.tablename = 'cohort_members' and p.policyname = 'Tenant members can read cohort memberships')
    )
  ) as value
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('cohorts', 'cohort_members')
), rls_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'table_owner', table_owner.rolname,
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'helper_owner_bypass_safe',
      helper_owner.rolsuper
      or helper_owner.rolbypassrls
      or (c.relowner = helper_owner.oid and not c.relforcerowsecurity)
  ) order by c.relname), '[]'::jsonb) as value
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_roles table_owner on table_owner.oid = c.relowner
  cross join helper h
  join pg_catalog.pg_roles helper_owner on helper_owner.oid = h.proowner
  where n.nspname = 'public'
    and c.relname in ('cohorts', 'cohort_members')
), direct_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', tp.table_name,
    'grantee', tp.grantee,
    'privilege', tp.privilege_type
  ) order by tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb) as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('cohorts', 'cohort_members')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), grant_integrity as (
  select jsonb_build_object(
    'dangerous_grants', count(*) filter (
      where tp.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
    ),
    'anon_or_authenticated_direct_writes', count(*) filter (
      where tp.grantee in ('anon', 'authenticated')
        and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    )
  ) as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('cohorts', 'cohort_members')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), integrity as (
  select jsonb_build_object(
    'unsupported_student_statuses', (
      select count(*) from public.students s
      where s.status not in ('active', 'inactive', 'lead', 'blocked')
    ),
    'unsupported_enrollment_statuses', (
      select count(*) from public.enrollments e
      where e.status not in ('active', 'completed', 'paused', 'cancelled')
    ),
    'unsupported_portal_account_statuses', (
      select count(*) from public.student_portal_accounts spa
      where spa.status not in ('active', 'pending', 'revoked')
    ),
    'duplicate_enrollment_groups', (
      select count(*) from (
        select e.tenant_id, e.student_id, e.course_id
        from public.enrollments e
        group by e.tenant_id, e.student_id, e.course_id
        having count(*) > 1
      ) duplicates
    ),
    'active_portal_non_active_student', (
      select count(*)
      from public.student_portal_accounts spa
      join public.students s
        on s.tenant_id = spa.tenant_id and s.id = spa.student_id
      where spa.status = 'active' and s.status <> 'active'
    ),
    'active_portal_disabled_student', (
      select count(*)
      from public.student_portal_accounts spa
      join public.students s
        on s.tenant_id = spa.tenant_id and s.id = spa.student_id
      where spa.status = 'active' and s.portal_enabled = false
    )
  ) as value
)
select jsonb_build_object(
  'helper', jsonb_build_object(
    'installed', exists (select 1 from helper),
    'schema', (select schema_name from helper),
    'owner', (select owner_name from helper),
    'owner_superuser', (select owner_superuser from helper),
    'owner_bypassrls', (select owner_bypassrls from helper),
    'identity_arguments', (select identity_arguments from helper),
    'security_definer', (select prosecdef from helper),
    'stable', (select provolatile = 's' from helper),
    'search_path', (select proconfig from helper),
    'public_execute', exists (
      select 1 from helper_acl where grantee = 'PUBLIC' and privilege_type = 'EXECUTE'
    ),
    'anon_execute', exists (
      select 1 from helper_acl where grantee = 'anon' and privilege_type = 'EXECUTE'
    ),
    'authenticated_execute_required_for_rls', exists (
      select 1 from helper_acl where grantee = 'authenticated' and privilege_type = 'EXECUTE'
    ),
    'service_role_execute', exists (
      select 1 from helper_acl where grantee = 'service_role' and privilege_type = 'EXECUTE'
    ),
    'authenticated_schema_usage_required_for_rls',
      pg_catalog.has_schema_privilege('authenticated', 'coachfort_internal', 'USAGE')
  ),
  'internal_schema', (select value from internal_schema_state),
  'canonical_helper_installed', to_regprocedure(
    'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'
  ) is not null,
  'policies', (select value from policy_state),
  'policy_integrity', (select value from policy_integrity),
  'rls', (select value from rls_state),
  'direct_grants', (select value from direct_grants),
  'grant_integrity', (select value from grant_integrity),
  'data_integrity', (select value from integrity)
) as verification_result;

-- MIGRATION HISTORY PROVENANCE (read-only): run separately. This project keeps
-- reviewed SQL as flat supabase/*.sql files, so a manual SQL Editor apply can
-- install the definitions without adding a CLI migration-history row. Supabase
-- CLI records remote migrations in supabase_migrations.schema_migrations.
-- This query returns only non-sensitive ledger metadata and match indicators.
/*
with migration_history as (
  select to_jsonb(history_row) as row_data
  from supabase_migrations.schema_migrations history_row
), ux4b1_matches as (
  select row_data
  from migration_history
  where lower(coalesce(row_data ->> 'name', '')) like
      '%bundle_ux4b1_remove_cohort_rls_recursion%'
    or lower(coalesce(row_data ->> 'statements', '')) like
      '%coachfort_internal.student_can_access_cohort%'
    or lower(row_data::text) like
      '%bundle_ux4b1_remove_cohort_rls_recursion.sql%'
)
select jsonb_build_object(
  'history_relation', to_regclass(
    'supabase_migrations.schema_migrations'
  )::text,
  'history_columns', (
    select coalesce(jsonb_agg(column_name order by ordinal_position), '[]'::jsonb)
    from information_schema.columns
    where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations'
  ),
  'ux4b1_recorded', exists (select 1 from ux4b1_matches),
  'matching_rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'version', row_data ->> 'version',
      'name', row_data ->> 'name',
      'filename_match', lower(row_data::text) like
        '%bundle_ux4b1_remove_cohort_rls_recursion%',
      'helper_definition_match', lower(coalesce(row_data ->> 'statements', ''))
        like '%coachfort_internal.student_can_access_cohort%'
    )), '[]'::jsonb)
    from ux4b1_matches
  )
) as migration_history_result;
*/
