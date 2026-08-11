-- Bundle UX-4C1: assignment-scoped Trainer directory reads.
--
-- Team SELECT policies previously used is_tenant_member, which gave Trainers
-- tenant-wide reads of students, enrollments, courses, cohorts, and cohort
-- memberships. This migration separates Owner/Admin/Staff reads from Trainer
-- reads and keeps the linked Student Portal policies installed by UX-4B/4B1.

-- PRE-APPLY (read-only): run separately before applying this migration.
/*
with relevant_tables(table_name) as (
  values
    ('students'), ('enrollments'), ('courses'), ('cohorts'),
    ('cohort_members'), ('trainer_course_assignments'),
    ('trainer_cohort_assignments'), ('tenant_members'),
    ('student_portal_accounts')
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
    and p.tablename in (select table_name from relevant_tables)
), table_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'owner', table_owner.rolname,
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'postgres_bypass_safe',
      helper_owner.rolsuper
      or helper_owner.rolbypassrls
      or (c.relowner = helper_owner.oid and not c.relforcerowsecurity)
  ) order by c.relname), '[]'::jsonb) as value
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_roles table_owner on table_owner.oid = c.relowner
  cross join pg_catalog.pg_roles helper_owner
  where n.nspname = 'public'
    and c.relname in (select table_name from relevant_tables)
    and helper_owner.rolname = 'postgres'
), grant_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', tp.table_name,
    'grantee', tp.grantee,
    'privilege', tp.privilege_type
  ) order by tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb) as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in (select table_name from relevant_tables)
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), index_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', i.tablename,
    'index', i.indexname,
    'definition', i.indexdef
  ) order by i.tablename, i.indexname), '[]'::jsonb) as value
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public'
    and i.tablename in (
      'enrollments', 'cohort_members',
      'trainer_course_assignments', 'trainer_cohort_assignments'
    )
), internal_schema_state as (
  select jsonb_build_object(
    'exists', n.oid is not null,
    'postgrest_setting', current_setting('pgrst.db_schemas', true),
    'api_exposed', coalesce(
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
    ),
    'authenticated_usage', n.oid is not null and
      pg_catalog.has_schema_privilege('authenticated', n.oid, 'USAGE'),
    'authenticated_functions', coalesce((
      select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
      from pg_catalog.pg_proc p
      where p.pronamespace = n.oid
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ), '[]'::jsonb)
  ) as value
  from (select to_regnamespace('coachfort_internal') as oid) existing
  left join pg_catalog.pg_namespace n on n.oid = existing.oid
), risk_state as (
  select jsonb_build_object(
    'tenant_member_select_policies', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename in ('students','enrollments','courses','cohorts','cohort_members')
        and p.cmd = 'SELECT'
        and coalesce(p.qual, '') like '%is_tenant_member%'
    ),
    'browser_dangerous_grants', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in (select table_name from relevant_tables)
        and tp.grantee in ('PUBLIC','anon','authenticated')
        and tp.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
    ),
    'service_role_dangerous_grants', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in (select table_name from relevant_tables)
        and tp.grantee = 'service_role'
        and tp.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
    ),
    'browser_write_grants', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in (select table_name from relevant_tables)
        and tp.grantee in ('anon','authenticated')
        and tp.privilege_type in ('INSERT','UPDATE','DELETE')
    ),
    'reciprocal_policy_edges', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and (
          (p.tablename = 'students' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])enrollments([^a-z_]|$)')
          or (p.tablename = 'enrollments' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])students([^a-z_]|$)')
          or (p.tablename = 'cohorts' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])cohort_members([^a-z_]|$)')
          or (p.tablename = 'cohort_members' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])cohorts([^a-z_]|$)')
        )
    )
  ) as value
)
select jsonb_build_object(
  'policies', (select value from policy_state),
  'tables', (select value from table_state),
  'direct_grants', (select value from grant_state),
  'indexes', (select value from index_state),
  'internal_schema', (select value from internal_schema_state),
  'risk', (select value from risk_state),
  'helper_before', to_regprocedure(
    'coachfort_internal.trainer_can_access_student_relationship(uuid,uuid,uuid,uuid)'
  ),
  'ux4b_helper', to_regprocedure(
    'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'
  ),
  'ux4b1_helper', to_regprocedure(
    'coachfort_internal.student_can_access_cohort(uuid,uuid,uuid,uuid,text)'
  )
) as preflight_result;
*/

begin;

-- These privileges are schema/maintenance capabilities, not application DML.
-- Existing browser reads retain SELECT and remain governed by RLS; secure RPC
-- and service-role CRUD behavior is unaffected.
revoke truncate, trigger, references, maintain on table
  public.tenant_members,
  public.trainer_course_assignments,
  public.trainer_cohort_assignments
from public, anon, authenticated, service_role;

create schema if not exists coachfort_internal authorization postgres;

do $$
begin
  if to_regprocedure('public.has_tenant_role(uuid,uuid,text[])') is null
     or to_regprocedure('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)') is null
     or to_regprocedure('public.ux4b_trainer_can_manage_student(uuid,uuid,uuid)') is null
     or to_regprocedure(
       'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.student_can_access_cohort(uuid,uuid,uuid,uuid,text)'
     ) is null then
    raise exception
      'UX-4C1 cannot install: required UX-4B/UX-4B1 authorization helpers are missing.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on schema coachfort_internal from public, anon, authenticated, service_role;
grant usage on schema coachfort_internal to authenticated;

create or replace function coachfort_internal.trainer_can_access_student_relationship(
  p_tenant_id uuid,
  p_user_id uuid,
  p_student_id uuid,
  p_course_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null
     or p_user_id is null
     or p_student_id is null
     or auth.uid() is null
     or p_user_id is distinct from auth.uid()
     or not exists (
       select 1
       from public.tenant_members tm
       where tm.tenant_id = p_tenant_id
         and tm.user_id = p_user_id
         and tm.role = 'trainer'
     )
     or not exists (
       select 1
       from public.students s
       where s.tenant_id = p_tenant_id
         and s.id = p_student_id
     ) then
    return false;
  end if;

  if p_course_id is null then
    return public.ux4b_trainer_can_manage_student(
      p_tenant_id, p_user_id, p_student_id
    );
  end if;

  if not exists (
    select 1
    from public.enrollments e
    where e.tenant_id = p_tenant_id
      and e.student_id = p_student_id
      and e.course_id = p_course_id
  ) then
    return false;
  end if;

  return public.ux4b_trainer_can_manage_course(
    p_tenant_id, p_user_id, p_course_id
  ) or exists (
    select 1
    from public.cohort_members cm
    join public.cohorts c
      on c.tenant_id = cm.tenant_id
     and c.id = cm.cohort_id
     and c.course_id = p_course_id
    join public.trainer_cohort_assignments tca
      on tca.tenant_id = cm.tenant_id
     and tca.cohort_id = cm.cohort_id
     and tca.trainer_user_id = p_user_id
    where cm.tenant_id = p_tenant_id
      and cm.student_id = p_student_id
  );
end;
$$;

alter function coachfort_internal.trainer_can_access_student_relationship(
  uuid, uuid, uuid, uuid
) owner to postgres;

-- The helper reads protected relationship tables directly. Abort instead of
-- installing recursive policies if its owner cannot bypass RLS on any of them.
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
    and c.relname in (
      'tenant_members', 'students', 'enrollments', 'cohorts',
      'cohort_members', 'trainer_course_assignments',
      'trainer_cohort_assignments'
    )
    and helper_owner.rolname = 'postgres'
    and not (
      helper_owner.rolsuper
      or helper_owner.rolbypassrls
      or (c.relowner = helper_owner.oid and not c.relforcerowsecurity)
    );

  if coalesce(cardinality(v_unsafe_tables), 0) > 0 then
    raise exception
      'UX-4C1 cannot install: helper owner cannot bypass RLS for %.',
      array_to_string(v_unsafe_tables, ', ')
      using errcode = '42501';
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
    raise exception
      'UX-4C1 cannot install: internal helper schema is API-exposed.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function coachfort_internal.trainer_can_access_student_relationship(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

-- Required only for authenticated RLS policy evaluation. The internal schema
-- is not PostgREST-exposed and the helper is bound to auth.uid().
grant execute on function coachfort_internal.trainer_can_access_student_relationship(
  uuid, uuid, uuid, uuid
) to authenticated;

alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.courses enable row level security;
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;

drop policy if exists "Tenant members can read students" on public.students;
drop policy if exists "Owner admin staff can read students" on public.students;
drop policy if exists "Assigned trainers can read scoped students" on public.students;

create policy "Owner admin staff can read students"
on public.students
for select
to authenticated
using (
  (select public.has_tenant_role(
    students.tenant_id, auth.uid(), array['owner','admin','staff']
  ))
);

create policy "Assigned trainers can read scoped students"
on public.students
for select
to authenticated
using (
  (select coachfort_internal.trainer_can_access_student_relationship(
    students.tenant_id, auth.uid(), students.id, null::uuid
  ))
);

drop policy if exists "Tenant members can read enrollments" on public.enrollments;
drop policy if exists "Owner admin staff can read enrollments" on public.enrollments;
drop policy if exists "Assigned trainers can read scoped enrollments" on public.enrollments;

create policy "Owner admin staff can read enrollments"
on public.enrollments
for select
to authenticated
using (
  (select public.has_tenant_role(
    enrollments.tenant_id, auth.uid(), array['owner','admin','staff']
  ))
);

create policy "Assigned trainers can read scoped enrollments"
on public.enrollments
for select
to authenticated
using (
  (select coachfort_internal.trainer_can_access_student_relationship(
    enrollments.tenant_id,
    auth.uid(),
    enrollments.student_id,
    enrollments.course_id
  ))
);

drop policy if exists "Tenant members can read courses" on public.courses;
drop policy if exists "Owner admin staff can read courses" on public.courses;
drop policy if exists "Assigned trainers can read scoped courses" on public.courses;

create policy "Owner admin staff can read courses"
on public.courses
for select
to authenticated
using (
  (select public.has_tenant_role(
    courses.tenant_id, auth.uid(), array['owner','admin','staff']
  ))
);

create policy "Assigned trainers can read scoped courses"
on public.courses
for select
to authenticated
using (
  (select public.has_tenant_role(
    courses.tenant_id, auth.uid(), array['trainer']
  ))
  and (
    exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = courses.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = courses.id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      join public.cohorts c
        on c.tenant_id = tca.tenant_id
       and c.id = tca.cohort_id
      where tca.tenant_id = courses.tenant_id
        and tca.trainer_user_id = auth.uid()
        and c.course_id = courses.id
    )
  )
);

drop policy if exists "Tenant members can read cohorts" on public.cohorts;
drop policy if exists "Owner admin staff can read cohorts" on public.cohorts;
drop policy if exists "Assigned trainers can read scoped cohorts" on public.cohorts;

create policy "Owner admin staff can read cohorts"
on public.cohorts
for select
to authenticated
using (
  (select public.has_tenant_role(
    cohorts.tenant_id, auth.uid(), array['owner','admin','staff']
  ))
);

create policy "Assigned trainers can read scoped cohorts"
on public.cohorts
for select
to authenticated
using (
  (select public.has_tenant_role(
    cohorts.tenant_id, auth.uid(), array['trainer']
  ))
  and exists (
    select 1
    from public.trainer_cohort_assignments tca
    where tca.tenant_id = cohorts.tenant_id
      and tca.trainer_user_id = auth.uid()
      and tca.cohort_id = cohorts.id
  )
);

drop policy if exists "Tenant members can read cohort memberships" on public.cohort_members;
drop policy if exists "Owner admin staff can read cohort memberships" on public.cohort_members;
drop policy if exists "Assigned trainers can read scoped cohort memberships" on public.cohort_members;

create policy "Owner admin staff can read cohort memberships"
on public.cohort_members
for select
to authenticated
using (
  (select public.has_tenant_role(
    cohort_members.tenant_id, auth.uid(), array['owner','admin','staff']
  ))
);

create policy "Assigned trainers can read scoped cohort memberships"
on public.cohort_members
for select
to authenticated
using (
  (select public.has_tenant_role(
    cohort_members.tenant_id, auth.uid(), array['trainer']
  ))
  and exists (
    select 1
    from public.trainer_cohort_assignments tca
    where tca.tenant_id = cohort_members.tenant_id
      and tca.trainer_user_id = auth.uid()
      and tca.cohort_id = cohort_members.cohort_id
  )
);

commit;

-- POST-APPLY (read-only): returns one compact verification result.
with relevant_tables(table_name) as (
  values
    ('students'), ('enrollments'), ('courses'), ('cohorts'),
    ('cohort_members'), ('trainer_course_assignments'),
    ('trainer_cohort_assignments'), ('tenant_members'),
    ('student_portal_accounts')
), helper as (
  select
    p.oid,
    p.proowner,
    owner_role.rolname as owner_name,
    owner_role.rolsuper as owner_superuser,
    owner_role.rolbypassrls as owner_bypassrls,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    p.oid::regprocedure::text as identity
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner
  where p.oid = to_regprocedure(
    'coachfort_internal.trainer_can_access_student_relationship(uuid,uuid,uuid,uuid)'
  )
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
    and p.tablename in (select table_name from relevant_tables)
), rls_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'owner', table_owner.rolname,
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
    and c.relname in (select table_name from relevant_tables)
), function_acl as (
  select jsonb_build_object(
    'PUBLIC', pg_catalog.has_function_privilege('PUBLIC', h.oid, 'EXECUTE'),
    'anon', pg_catalog.has_function_privilege('anon', h.oid, 'EXECUTE'),
    'authenticated', pg_catalog.has_function_privilege('authenticated', h.oid, 'EXECUTE'),
    'service_role', pg_catalog.has_function_privilege('service_role', h.oid, 'EXECUTE')
  ) as value
  from helper h
), internal_schema_state as (
  select jsonb_build_object(
    'api_exposed', coalesce(
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
        and setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ),
    'authenticated_usage', pg_catalog.has_schema_privilege(
      'authenticated', 'coachfort_internal', 'USAGE'
    ),
    'authenticated_functions', coalesce((
      select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
      from pg_catalog.pg_proc p
      where p.pronamespace = to_regnamespace('coachfort_internal')
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ), '[]'::jsonb)
  ) as value
), policy_integrity as (
  select jsonb_build_object(
    'old_broad_policies', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename in ('students','enrollments','courses','cohorts','cohort_members')
        and p.cmd = 'SELECT'
        and coalesce(p.qual, '') like '%is_tenant_member%'
    ),
    'owner_admin_staff_policies', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.policyname like 'Owner admin staff can read %'
        and p.tablename in ('students','enrollments','courses','cohorts','cohort_members')
    ),
    'trainer_scoped_policies', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.policyname like 'Assigned trainers can read scoped %'
        and p.tablename in ('students','enrollments','courses','cohorts','cohort_members')
    ),
    'linked_student_policies', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.policyname in (
          'Linked students can read own student record',
          'Linked students can read own enrollments',
          'Linked students can read enrolled courses',
          'Linked students can read own cohorts',
          'Linked students can read own cohort memberships'
        )
    ),
    'reciprocal_policy_edges', (
      select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and (
          (p.tablename = 'students' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])enrollments([^a-z_]|$)')
          or (p.tablename = 'enrollments' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])students([^a-z_]|$)')
          or (p.tablename = 'cohorts' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])cohort_members([^a-z_]|$)')
          or (p.tablename = 'cohort_members' and lower(coalesce(p.qual,'')) ~ '(^|[^a-z_])cohorts([^a-z_]|$)')
        )
    )
  ) as value
), grant_integrity as (
  select jsonb_build_object(
    'browser_dangerous_grants', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in (select table_name from relevant_tables)
        and tp.grantee in ('PUBLIC','anon','authenticated')
        and tp.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
    ),
    'service_role_dangerous_grants', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in (select table_name from relevant_tables)
        and tp.grantee = 'service_role'
        and tp.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
    ),
    'browser_write_grants', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in (select table_name from relevant_tables)
        and tp.grantee in ('anon','authenticated')
        and tp.privilege_type in ('INSERT','UPDATE','DELETE')
    ),
    'browser_security_gate_passed',
      not exists (
        select 1 from information_schema.table_privileges tp
        where tp.table_schema = 'public'
          and tp.table_name in (select table_name from relevant_tables)
          and tp.grantee in ('PUBLIC','anon','authenticated')
          and tp.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
      )
      and not exists (
        select 1 from information_schema.table_privileges tp
        where tp.table_schema = 'public'
          and tp.table_name in (select table_name from relevant_tables)
          and tp.grantee in ('anon','authenticated')
          and tp.privilege_type in ('INSERT','UPDATE','DELETE')
      )
  ) as value
), index_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', i.tablename,
    'index', i.indexname,
    'definition', i.indexdef
  ) order by i.tablename, i.indexname), '[]'::jsonb) as value
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public'
    and i.tablename in (
      'enrollments', 'cohort_members',
      'trainer_course_assignments', 'trainer_cohort_assignments'
    )
)
select jsonb_build_object(
  'helper', (select jsonb_build_object(
    'identity', h.identity,
    'owner', h.owner_name,
    'owner_superuser', h.owner_superuser,
    'owner_bypassrls', h.owner_bypassrls,
    'security_definer', h.prosecdef,
    'stable', h.provolatile = 's',
    'search_path', h.proconfig,
    'acl', (select value from function_acl)
  ) from helper h),
  'internal_schema', (select value from internal_schema_state),
  'rls', (select value from rls_state),
  'policies', (select value from policy_state),
  'policy_integrity', (select value from policy_integrity),
  'grant_integrity', (select value from grant_integrity),
  'indexes', (select value from index_state),
  'ux4b_helper_installed', to_regprocedure(
    'public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'
  ) is not null,
  'ux4b1_helper_installed', to_regprocedure(
    'coachfort_internal.student_can_access_cohort(uuid,uuid,uuid,uuid,text)'
  ) is not null
) as verification_result;
