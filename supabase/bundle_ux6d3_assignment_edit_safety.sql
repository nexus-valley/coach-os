/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query before applying the executable migration. It reports metadata and
aggregate trainer-target classifications only. It does not invoke RPCs or return
assignment, user, or team-member content.

with
expected_functions(identity, function_name) as (
  values
    (
      'public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)',
      'create_assignment_secure'
    ),
    (
      'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)',
      'update_assignment_secure'
    )
),
function_state as (
  select
    ef.identity,
    ef.function_name,
    p.oid,
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    l.lanname as language,
    p.prosecdef as security_definer,
    p.pronargdefaults as default_argument_count,
    pg_catalog.pg_get_function_arguments(p.oid) as arguments,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee', case
            when acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl.grantee)
          end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        order by
          case
            when acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl.grantee)
          end,
          acl.privilege_type
      )
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
    ), '[]'::jsonb) as acl,
    lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
      '[[:space:]]+',
      ' ',
      'g'
    )) as normalized_definition
  from expected_functions ef
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(ef.identity)
  left join pg_catalog.pg_language l on l.oid = p.prolang
),
overload_state as (
  select
    p.proname as function_name,
    count(*)::bigint as overload_count,
    jsonb_agg(
      pg_catalog.pg_get_function_identity_arguments(p.oid)
      order by pg_catalog.pg_get_function_identity_arguments(p.oid)
    ) as identities
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_assignment_secure', 'update_assignment_secure')
  group by p.proname
),
dependency_state as (
  select
    ef.identity,
    count(d.objid)::bigint as dependent_object_count
  from expected_functions ef
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(ef.identity)
  left join pg_catalog.pg_depend d
    on d.refobjid = p.oid
   and d.deptype not in ('e', 'i')
  group by ef.identity
),
trainer_column as (
  select
    a.attname as column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
    not a.attnotnull as nullable
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.assignments'::regclass
    and a.attname = 'trainer_user_id'
    and a.attnum > 0
    and not a.attisdropped
),
trainer_fk as (
  select
    con.conname,
    pg_catalog.pg_get_constraintdef(con.oid, true) as definition,
    case con.confdeltype
      when 'n' then 'SET NULL'
      when 'a' then 'NO ACTION'
      when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'
      when 'd' then 'SET DEFAULT'
      else con.confdeltype::text
    end as on_delete
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_attribute a
    on a.attrelid = con.conrelid
   and a.attnum = any(con.conkey)
  where con.conrelid = 'public.assignments'::regclass
    and con.contype = 'f'
    and a.attname = 'trainer_user_id'
),
trainer_indexes as (
  select indexname, indexdef
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename = 'assignments'
    and indexdef ilike '%trainer_user_id%'
),
membership_columns as (
  select
    jsonb_agg(
      jsonb_build_object(
        'column_name', c.column_name,
        'data_type', c.data_type,
        'nullable', c.is_nullable
      ) order by c.ordinal_position
    ) as columns,
    bool_or(c.column_name = 'status') as has_status_column
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'tenant_members'
),
membership_roles as (
  select coalesce(
    jsonb_object_agg(role, row_count order by role),
    '{}'::jsonb
  ) as counts
  from (
    select tm.role, count(*)::bigint as row_count
    from public.tenant_members tm
    group by tm.role
  ) role_counts
),
helper_state as (
  select
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    l.lanname as language,
    p.prosecdef as security_definer,
    p.provolatile = 's' as stable,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
      '[[:space:]]+',
      ' ',
      'g'
    )) as normalized_definition,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee', case
            when acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl.grantee)
          end,
          'privilege', acl.privilege_type
        ) order by
          case
            when acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl.grantee)
          end,
          acl.privilege_type
      )
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
    ), '[]'::jsonb) as acl
  from (values (
    pg_catalog.to_regprocedure(
      'public.m69_5_assert_active_trainer(uuid,uuid)'
    )::oid
  )) expected(oid)
  left join pg_catalog.pg_proc p on p.oid = expected.oid
  left join pg_catalog.pg_language l on l.oid = p.prolang
),
required_helpers(identity) as (
  values
    ('public.m69_4_current_role(uuid)'),
    ('public.m69_4_assert_course_in_tenant(uuid,uuid)'),
    ('public.m69_4_assert_cohort_in_tenant(uuid,uuid)'),
    ('public.m69_4_assert_course_cohort_consistency(uuid,uuid,uuid)'),
    ('public.m69_4_assert_manage_assignment(uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_normalize_text(text,text,boolean,integer)'),
    ('public.m69_4_validate_attachment_urls(jsonb)'),
    ('public.m69_4_validate_score(numeric,numeric)'),
    ('public.m69_4_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'),
    ('public.m69_5_assert_active_trainer(uuid,uuid)')
),
required_helper_state as (
  select identity, pg_catalog.to_regprocedure(identity) is not null as installed
  from required_helpers
),
table_security as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    pg_catalog.pg_get_userbyid(c.relowner) as owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('assignments', 'assignment_submissions')
),
direct_grants as (
  select grantee, table_name, privilege_type, is_grantable
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('assignments', 'assignment_submissions')
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
browser_write_grants as (
  select count(*)::bigint as grant_count
  from direct_grants
  where grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
),
browser_dangerous_grants as (
  select count(*)::bigint as grant_count
  from direct_grants
  where grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
),
trainer_target_classification as (
  select jsonb_build_object(
    'assignment_count', count(*)::bigint,
    'trainer_target_null', count(*) filter (
      where a.trainer_user_id is null
    )::bigint,
    'valid_same_tenant_trainer', count(*) filter (
      where a.trainer_user_id is not null
        and exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role = 'trainer'
        )
    )::bigint,
    'same_tenant_wrong_role', count(*) filter (
      where a.trainer_user_id is not null
        and exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role <> 'trainer'
        )
    )::bigint,
    'no_same_tenant_membership', count(*) filter (
      where a.trainer_user_id is not null
        and not exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
        )
    )::bigint,
    'trainer_membership_other_tenant_only', count(*) filter (
      where a.trainer_user_id is not null
        and not exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
        )
        and exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id <> a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role = 'trainer'
        )
    )::bigint,
    'no_membership_anywhere', count(*) filter (
      where a.trainer_user_id is not null
        and not exists (
          select 1
          from public.tenant_members tm
          where tm.user_id = a.trainer_user_id
        )
    )::bigint,
    'affected_assignment_count', count(*) filter (
      where a.trainer_user_id is not null
        and not exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role = 'trainer'
        )
    )::bigint,
    'affected_tenant_count', count(distinct a.tenant_id) filter (
      where a.trainer_user_id is not null
        and not exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role = 'trainer'
        )
    )::bigint
  ) as value
  from public.assignments a
)
select jsonb_build_object(
  'functions', coalesce((
    select jsonb_agg(to_jsonb(function_state) order by function_name)
    from function_state
  ), '[]'::jsonb),
  'overloads', coalesce((
    select jsonb_agg(to_jsonb(overload_state) order by function_name)
    from overload_state
  ), '[]'::jsonb),
  'dependencies', coalesce((
    select jsonb_agg(to_jsonb(dependency_state) order by identity)
    from dependency_state
  ), '[]'::jsonb),
  'trainer_column', coalesce((select to_jsonb(trainer_column) from trainer_column), '{}'::jsonb),
  'trainer_fk', coalesce((select jsonb_agg(to_jsonb(trainer_fk)) from trainer_fk), '[]'::jsonb),
  'trainer_indexes', coalesce((select jsonb_agg(to_jsonb(trainer_indexes)) from trainer_indexes), '[]'::jsonb),
  'membership_schema', coalesce((select to_jsonb(membership_columns) from membership_columns), '{}'::jsonb),
  'membership_role_counts', (select counts from membership_roles),
  'trainer_helper', coalesce((select to_jsonb(helper_state) from helper_state), '{}'::jsonb),
  'required_helpers', coalesce((
    select jsonb_agg(to_jsonb(required_helper_state) order by identity)
    from required_helper_state
  ), '[]'::jsonb),
  'table_security', coalesce((
    select jsonb_agg(to_jsonb(table_security) order by table_name)
    from table_security
  ), '[]'::jsonb),
  'direct_grants', coalesce((
    select jsonb_agg(to_jsonb(direct_grants) order by table_name, grantee, privilege_type)
    from direct_grants
  ), '[]'::jsonb),
  'browser_write_grants', (select grant_count from browser_write_grants),
  'browser_dangerous_grants', (select grant_count from browser_dangerous_grants),
  'trainer_target_classification', (select value from trainer_target_classification)
) as ux6d3_preflight;
*/

begin;

do $$
declare
  v_create regprocedure := pg_catalog.to_regprocedure(
    'public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
  );
  v_update regprocedure := pg_catalog.to_regprocedure(
    'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
  );
  v_trainer_helper regprocedure := pg_catalog.to_regprocedure(
    'public.m69_5_assert_active_trainer(uuid,uuid)'
  );
  v_create_source text;
  v_update_source text;
  v_unexpected_overloads integer;
begin
  if v_create is null or v_update is null or v_trainer_helper is null then
    raise exception 'UX-6D3 prerequisite function is missing.' using errcode = '55000';
  end if;

  select count(*)
  into v_unexpected_overloads
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_assignment_secure', 'update_assignment_secure')
    and p.oid not in (v_create::oid, v_update::oid);

  if v_unexpected_overloads <> 0 then
    raise exception 'UX-6D3 found unexpected assignment create/update overloads.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid in (v_create::oid, v_update::oid)
      and (
        pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
        or l.lanname <> 'plpgsql'
        or not p.prosecdef
        or p.pronargdefaults <> 3
        or p.prorettype <> 'public.assignments'::regtype
        or not (
          coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']
          or coalesce(p.proconfig, array[]::text[])
            @> array['search_path=public, pg_temp']
        )
      )
  ) then
    raise exception 'UX-6D3 assignment RPC metadata is not recognized.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = v_trainer_helper::oid
      and (
        pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
        or l.lanname <> 'plpgsql'
        or not p.prosecdef
        or p.provolatile <> 's'
        or not coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']
      )
  ) then
    raise exception 'UX-6D3 trainer helper metadata is not recognized.' using errcode = '55000';
  end if;

  if not pg_catalog.has_function_privilege(
      'authenticated', v_create::oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'authenticated', v_update::oid, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', v_create::oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_update::oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_create::oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_update::oid, 'EXECUTE')
    or exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid in (v_create::oid, v_update::oid, v_trainer_helper::oid)
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', v_trainer_helper::oid, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', v_trainer_helper::oid, 'EXECUTE')
    or pg_catalog.has_function_privilege(
      'service_role', v_trainer_helper::oid, 'EXECUTE'
    ) then
    raise exception 'UX-6D3 function ACL prerequisite failed.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'assignments'
      and c.column_name = 'trainer_user_id'
      and c.udt_name = 'uuid'
      and c.is_nullable = 'YES'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_attribute a
      on a.attrelid = con.conrelid
     and a.attnum = any(con.conkey)
    where con.conrelid = 'public.assignments'::regclass
      and con.contype = 'f'
      and a.attname = 'trainer_user_id'
      and con.confrelid = 'auth.users'::regclass
      and con.confdeltype = 'n'
  ) or not exists (
    select 1
    from pg_catalog.pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'assignments'
      and i.indexdef ilike '%trainer_user_id%'
  ) then
    raise exception 'UX-6D3 trainer column contract is not recognized.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'tenant_members'
      and c.column_name = 'tenant_id'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'tenant_members'
      and c.column_name = 'user_id'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'tenant_members'
      and c.column_name = 'role'
  ) or exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'tenant_members'
      and c.column_name = 'status'
  ) then
    raise exception 'UX-6D3 tenant membership contract is not recognized.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid in (
      'public.assignments'::regclass,
      'public.assignment_submissions'::regclass
    )
      and (not c.relrowsecurity or c.relforcerowsecurity)
  ) then
    raise exception 'UX-6D3 assignment table RLS prerequisite failed.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name in ('assignments', 'assignment_submissions')
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
      and tp.privilege_type in (
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
      )
  ) then
    raise exception 'UX-6D3 browser table grant prerequisite failed.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.m69_4_current_role(uuid)'),
      ('public.m69_4_assert_course_in_tenant(uuid,uuid)'),
      ('public.m69_4_assert_cohort_in_tenant(uuid,uuid)'),
      ('public.m69_4_assert_course_cohort_consistency(uuid,uuid,uuid)'),
      ('public.m69_4_assert_manage_assignment(uuid,uuid,uuid,uuid,uuid)'),
      ('public.m69_4_normalize_text(text,text,boolean,integer)'),
      ('public.m69_4_validate_attachment_urls(jsonb)'),
      ('public.m69_4_validate_score(numeric,numeric)'),
      ('public.m69_4_write_audit(uuid,text,text,uuid,text,text,text,jsonb)')
    ) required(identity)
    where pg_catalog.to_regprocedure(required.identity) is null
  ) then
    raise exception 'UX-6D3 required assignment helper is missing.' using errcode = '55000';
  end if;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(v_create::oid),
    '[[:space:]]+',
    ' ',
    'g'
  )) into v_create_source;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(v_update::oid),
    '[[:space:]]+',
    ' ',
    'g'
  )) into v_update_source;

  if v_create_source not like '%m69_4_assert_manage_assignment%'
     or v_create_source not like '%insert into public.assignments%'
     or v_create_source not like '%m69_4_write_audit%'
     or v_create_source not like '%''assignment_created''%'
     or v_update_source not like '%from public.assignments a%for update;%'
     or v_update_source not like '%m69_4_assert_manage_assignment%'
     or v_update_source not like '%from public.assignment_submissions s%'
     or v_update_source not like '%m69_4_write_audit%'
     or v_update_source not like '%''assignment_updated''%'
     or v_update_source not like '%closed assignments cannot be edited%'
     or v_update_source not like '%due date and max score cannot be changed after the first submission%'
  then
    raise exception 'UX-6D3 existing assignment RPC body is not recognized.' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.create_assignment_secure(
  p_tenant_id uuid,
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
  v_assignment public.assignments%rowtype;
  v_actor_role text;
  v_title text;
  v_trainer_user_id uuid;
begin
  if p_course_id is null and p_cohort_id is null then
    raise exception 'Select a course or cohort for this assignment.' using errcode = '22023';
  end if;

  perform public.m69_4_assert_course_in_tenant(p_tenant_id, p_course_id);
  perform public.m69_4_assert_cohort_in_tenant(p_tenant_id, p_cohort_id);
  perform public.m69_4_assert_course_cohort_consistency(
    p_tenant_id, p_course_id, p_cohort_id
  );
  perform public.m69_4_assert_manage_assignment(
    p_tenant_id, p_course_id, p_cohort_id
  );

  v_actor_role := public.m69_4_current_role(p_tenant_id);
  v_title := public.m69_4_normalize_text(
    p_title, 'Assignment title', true, 180
  );

  if v_actor_role in ('owner', 'admin') then
    v_trainer_user_id := p_trainer_user_id;

    if v_trainer_user_id is not null then
      begin
        perform public.m69_5_assert_active_trainer(
          p_tenant_id, v_trainer_user_id
        );
      exception
        when sqlstate '22023' then
          raise exception 'Selected trainer is not available in this workspace.'
            using errcode = '22023';
      end;
    end if;
  elsif v_actor_role = 'trainer' then
    if p_trainer_user_id is not null
       and p_trainer_user_id is distinct from auth.uid() then
      raise exception 'You do not have permission to select that assignment trainer.'
        using errcode = '42501';
    end if;

    begin
      perform public.m69_5_assert_active_trainer(p_tenant_id, auth.uid());
    exception
      when sqlstate '22023' then
        raise exception 'Selected trainer is not available in this workspace.'
          using errcode = '22023';
    end;

    v_trainer_user_id := auth.uid();
  else
    if p_trainer_user_id is not null then
      raise exception 'You do not have permission to select that assignment trainer.'
        using errcode = '42501';
    end if;

    v_trainer_user_id := null;
  end if;

  insert into public.assignments (
    tenant_id,
    course_id,
    cohort_id,
    trainer_user_id,
    title,
    description,
    instructions,
    attachment_urls_json,
    max_score,
    due_at,
    status,
    created_by
  )
  values (
    p_tenant_id,
    p_course_id,
    p_cohort_id,
    v_trainer_user_id,
    v_title,
    public.m69_4_normalize_text(p_description, 'Description', false, 2000),
    public.m69_4_normalize_text(p_instructions, 'Instructions', false, 4000),
    public.m69_4_validate_attachment_urls(p_attachment_urls_json),
    public.m69_4_validate_score(p_max_score, null),
    p_due_at,
    'draft',
    auth.uid()
  )
  returning * into v_assignment;

  perform public.m69_4_write_audit(
    p_tenant_id,
    'assignment_created',
    'assignment',
    v_assignment.id,
    'Assignment',
    'Created assignment',
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
  perform public.m69_4_assert_course_cohort_consistency(
    p_tenant_id, p_course_id, p_cohort_id
  );

  v_title := public.m69_4_normalize_text(
    p_title, 'Assignment title', true, 180
  );
  v_trainer_user_id := v_existing.trainer_user_id;
  v_trainer_changed := p_trainer_user_id is distinct from v_existing.trainer_user_id;
  v_relationship_changed :=
    p_course_id is distinct from v_existing.course_id
    or p_cohort_id is distinct from v_existing.cohort_id;

  if v_existing.status = 'draft' then
    if v_relationship_changed then
      perform public.m69_4_assert_manage_assignment(
        p_tenant_id,
        p_course_id,
        p_cohort_id,
        null,
        null
      );
    end if;

    if v_trainer_changed then
      if v_actor_role not in ('owner', 'admin') then
        raise exception 'You do not have permission to change the assignment trainer.'
          using errcode = '42501';
      end if;

      if p_trainer_user_id is not null then
        begin
          perform public.m69_5_assert_active_trainer(
            p_tenant_id, p_trainer_user_id
          );
        exception
          when sqlstate '22023' then
            raise exception 'Selected trainer is not available in this workspace.'
              using errcode = '22023';
        end;
      end if;

      v_trainer_user_id := p_trainer_user_id;
    end if;
  elsif v_existing.status = 'published' then
    if v_relationship_changed or v_trainer_changed then
      raise exception 'Program, cohort, and trainer cannot be changed after publication.'
        using errcode = '22023';
    end if;

    select exists (
      select 1
      from public.assignment_submissions s
      where s.tenant_id = p_tenant_id
        and s.assignment_id = p_assignment_id
    )
    into v_has_submission;

    if v_has_submission
       and (
         p_due_at is distinct from v_existing.due_at
         or p_max_score is distinct from v_existing.max_score
       ) then
      raise exception 'Due date and max score cannot be changed after the first submission.'
        using errcode = '22023';
    end if;
  else
    raise exception 'Assignment lifecycle state is not supported.' using errcode = '22023';
  end if;

  update public.assignments a
  set
    course_id = p_course_id,
    cohort_id = p_cohort_id,
    trainer_user_id = v_trainer_user_id,
    title = v_title,
    description = public.m69_4_normalize_text(
      p_description, 'Description', false, 2000
    ),
    instructions = public.m69_4_normalize_text(
      p_instructions, 'Instructions', false, 4000
    ),
    attachment_urls_json = public.m69_4_validate_attachment_urls(
      p_attachment_urls_json
    ),
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

  return v_assignment;
end;
$$;

revoke execute on function public.create_assignment_secure(
  uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) from public, anon, service_role;
revoke execute on function public.update_assignment_secure(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) from public, anon, service_role;

grant execute on function public.create_assignment_secure(
  uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) to authenticated;
grant execute on function public.update_assignment_secure(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) to authenticated;

do $$
declare
  v_create regprocedure := pg_catalog.to_regprocedure(
    'public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
  );
  v_update regprocedure := pg_catalog.to_regprocedure(
    'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
  );
  v_create_source text;
  v_update_source text;
begin
  if v_create is null or v_update is null then
    raise exception 'UX-6D3 installed RPC identity verification failed.' using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_assignment_secure', 'update_assignment_secure')
  ) <> 2 then
    raise exception 'UX-6D3 installed RPC overload verification failed.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid in (v_create::oid, v_update::oid)
      and (
        pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
        or l.lanname <> 'plpgsql'
        or not p.prosecdef
        or p.pronargdefaults <> 3
        or p.prorettype <> 'public.assignments'::regtype
        or not coalesce(p.proconfig, array[]::text[])
          @> array['search_path=public, pg_temp']
      )
  ) then
    raise exception 'UX-6D3 installed RPC metadata verification failed.' using errcode = '55000';
  end if;

  if not pg_catalog.has_function_privilege(
      'authenticated', v_create::oid, 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'authenticated', v_update::oid, 'EXECUTE'
    )
    or pg_catalog.has_function_privilege('anon', v_create::oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_update::oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_create::oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_update::oid, 'EXECUTE')
    or exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid in (v_create::oid, v_update::oid)
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
    raise exception 'UX-6D3 installed RPC ACL verification failed.' using errcode = '55000';
  end if;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(v_create::oid),
    '[[:space:]]+',
    ' ',
    'g'
  )) into v_create_source;

  select lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(v_update::oid),
    '[[:space:]]+',
    ' ',
    'g'
  )) into v_update_source;

  if v_create_source not like '%v_actor_role in (''owner'', ''admin'')%'
     or v_create_source not like '%m69_5_assert_active_trainer%'
     or v_create_source not like '%p_trainer_user_id is distinct from auth.uid()%'
     or v_create_source not like '%v_trainer_user_id := auth.uid()%'
     or v_create_source not like '%v_trainer_user_id := null%'
     or v_update_source not like '%v_trainer_user_id := v_existing.trainer_user_id%'
     or v_update_source not like '%p_trainer_user_id is distinct from v_existing.trainer_user_id%'
     or v_update_source like '%when v_actor_role = ''trainer'' then auth.uid()%'
     or v_update_source like '%when v_role = ''trainer'' then auth.uid()%'
     or v_update_source not like '%v_actor_role not in (''owner'', ''admin'')%'
     or v_update_source not like '%m69_5_assert_active_trainer%'
     or v_update_source not like '%p_course_id%p_cohort_id%null, null%'
     or v_update_source not like '%from public.assignments a%for update;%'
     or v_update_source not like '%from public.assignment_submissions s%'
     or v_update_source not like '%closed assignments cannot be edited%'
     or position('insert into public.assignments' in v_create_source) <= 0
     or position('m69_4_write_audit' in v_create_source)
        <= position('insert into public.assignments' in v_create_source)
     or position('m69_4_write_audit' in v_update_source)
        <= position('update public.assignments a' in v_update_source)
  then
    raise exception 'UX-6D3 installed RPC contract verification failed.' using errcode = '55000';
  end if;
end;
$$;

comment on function public.create_assignment_secure(
  uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) is 'UX-6D3 secure assignment create RPC with canonical trainer-target validation.';
comment on function public.update_assignment_secure(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric, timestamptz
) is 'UX-6D3 secure assignment update RPC preserving trainer ownership unless an Owner/Admin performs an authorized Draft retarget.';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this query after applying the executable migration. It inspects metadata,
normalized function definitions, table security, and aggregate trainer-target
classification without invoking an assignment mutation RPC.

with
expected_functions(identity, function_name) as (
  values
    (
      'public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)',
      'create_assignment_secure'
    ),
    (
      'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)',
      'update_assignment_secure'
    )
),
function_state as (
  select
    ef.identity,
    ef.function_name,
    p.oid,
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    l.lanname as language,
    p.prosecdef as security_definer,
    p.pronargdefaults as default_argument_count,
    pg_catalog.pg_get_function_arguments(p.oid) as arguments,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
      '[[:space:]]+',
      ' ',
      'g'
    )) as definition,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee', case
            when acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl.grantee)
          end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) order by
          case
            when acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(acl.grantee)
          end,
          acl.privilege_type
      )
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
    ), '[]'::jsonb) as acl
  from expected_functions ef
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(ef.identity)
  left join pg_catalog.pg_language l on l.oid = p.prolang
),
function_signals as (
  select
    function_name,
    installed,
    owner = 'postgres' as owner_postgres,
    language = 'plpgsql' as plpgsql,
    security_definer,
    default_argument_count = 3 as defaults_preserved,
    result_type in ('assignments', 'public.assignments') as return_type_preserved,
    configuration @> array['search_path=public, pg_temp'] as search_path_safe,
    case when function_name = 'create_assignment_secure' then
      definition like '%m69_4_assert_manage_assignment%'
      and definition like '%v_actor_role in (''owner'', ''admin'')%'
      and definition like '%m69_5_assert_active_trainer%'
      and definition like '%p_trainer_user_id is distinct from auth.uid()%'
      and definition like '%v_trainer_user_id := auth.uid()%'
      and definition like '%v_trainer_user_id := null%'
      and definition like '%you do not have permission to select that assignment trainer%'
    else true end as create_trainer_contract,
    case when function_name = 'update_assignment_secure' then
      definition like '%from public.assignments a%for update;%'
      and definition like '%v_trainer_user_id := v_existing.trainer_user_id%'
      and definition like '%p_trainer_user_id is distinct from v_existing.trainer_user_id%'
      and definition like '%v_actor_role not in (''owner'', ''admin'')%'
      and definition like '%you do not have permission to change the assignment trainer%'
      and definition not like '%when v_actor_role = ''trainer'' then auth.uid()%'
      and definition not like '%when v_role = ''trainer'' then auth.uid()%'
    else true end as update_trainer_contract,
    case when function_name = 'update_assignment_secure' then
      definition like '%v_relationship_changed%'
      and definition like '%p_course_id%p_cohort_id%null, null%'
      and definition like '%program, cohort, and trainer cannot be changed after publication%'
    else true end as relationship_scope_contract,
    case when function_name = 'update_assignment_secure' then
      definition like '%from public.assignment_submissions s%'
      and definition like '%s.tenant_id = p_tenant_id%'
      and definition like '%s.assignment_id = p_assignment_id%'
      and definition like '%p_due_at is distinct from v_existing.due_at%'
      and definition like '%p_max_score is distinct from v_existing.max_score%'
    else true end as submission_cutoff_preserved,
    case when function_name = 'update_assignment_secure' then
      definition like '%closed assignments cannot be edited%'
    else true end as closed_denial_preserved,
    position('m69_4_write_audit' in definition) >
      case
        when function_name = 'create_assignment_secure'
          then position('insert into public.assignments' in definition)
        else position('update public.assignments a' in definition)
      end as success_audit_after_mutation
  from function_state
),
overload_state as (
  select
    count(*) filter (
      where p.oid in (
        pg_catalog.to_regprocedure(
          'public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
        )::oid,
        pg_catalog.to_regprocedure(
          'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
        )::oid
      )
    )::bigint as expected_identity_count,
    count(*)::bigint as total_overload_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_assignment_secure', 'update_assignment_secure')
),
helper_state as (
  select
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile = 's' as stable,
    coalesce(p.proconfig, array[]::text[]) @> array['search_path=public'] as search_path_safe,
    not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where acl.privilege_type = 'EXECUTE'
        and (
          acl.grantee = 0
          or pg_catalog.pg_get_userbyid(acl.grantee) in (
            'anon', 'authenticated', 'service_role'
          )
        )
    ) as browser_private,
    lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
      '[[:space:]]+',
      ' ',
      'g'
    )) like '%m69_5_assert_tenant_member%'
      and lower(pg_catalog.regexp_replace(
        coalesce(pg_catalog.pg_get_functiondef(member_helper.oid), ''),
        '[[:space:]]+',
        ' ',
        'g'
      )) like '%from public.tenant_members tm%'
      and lower(pg_catalog.pg_get_functiondef(p.oid)) like '%role <> ''trainer''%'
      as canonical_membership_contract
  from (values (
    pg_catalog.to_regprocedure(
      'public.m69_5_assert_active_trainer(uuid,uuid)'
    )::oid
  )) expected(oid)
  left join pg_catalog.pg_proc p on p.oid = expected.oid
  left join pg_catalog.pg_proc member_helper
    on member_helper.oid = pg_catalog.to_regprocedure(
      'public.m69_5_assert_tenant_member(uuid,uuid)'
    )
),
rpc_acl as (
  select
    count(*) filter (
      where grantee = 'authenticated' and privilege = 'EXECUTE'
    )::bigint as authenticated_execute_grants,
    count(*) filter (
      where grantee in ('PUBLIC', 'anon', 'service_role')
        and privilege = 'EXECUTE'
    )::bigint as unintended_execute_grants
  from (
    select
      case
        when acl.grantee = 0 then 'PUBLIC'
        else pg_catalog.pg_get_userbyid(acl.grantee)
      end as grantee,
      acl.privilege_type as privilege
    from function_state fs
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        (select p.proacl from pg_catalog.pg_proc p where p.oid = fs.oid),
        pg_catalog.acldefault(
          'f',
          (select p.proowner from pg_catalog.pg_proc p where p.oid = fs.oid)
        )
      )
    ) acl
  ) grants
),
table_security as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    pg_catalog.pg_get_userbyid(c.relowner) as owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('assignments', 'assignment_submissions')
),
policy_state as (
  select
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in ('assignments', 'assignment_submissions')
),
direct_grants as (
  select grantee, table_name, privilege_type, is_grantable
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('assignments', 'assignment_submissions')
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
browser_write_grants as (
  select count(*)::bigint as grant_count
  from direct_grants
  where grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
),
browser_dangerous_grants as (
  select count(*)::bigint as grant_count
  from direct_grants
  where grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
),
trainer_target_classification as (
  select jsonb_build_object(
    'trainer_target_null', count(*) filter (
      where a.trainer_user_id is null
    )::bigint,
    'valid_same_tenant_trainer', count(*) filter (
      where a.trainer_user_id is not null
        and exists (
          select 1 from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role = 'trainer'
        )
    )::bigint,
    'invalid_historical_target_count', count(*) filter (
      where a.trainer_user_id is not null
        and not exists (
          select 1 from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role = 'trainer'
        )
    )::bigint,
    'affected_tenant_count', count(distinct a.tenant_id) filter (
      where a.trainer_user_id is not null
        and not exists (
          select 1 from public.tenant_members tm
          where tm.tenant_id = a.tenant_id
            and tm.user_id = a.trainer_user_id
            and tm.role = 'trainer'
        )
    )::bigint
  ) as value
  from public.assignments a
)
select jsonb_build_object(
  'functions', coalesce((
    select jsonb_agg(to_jsonb(function_state) order by function_name)
    from function_state
  ), '[]'::jsonb),
  'function_signals', coalesce((
    select jsonb_agg(to_jsonb(function_signals) order by function_name)
    from function_signals
  ), '[]'::jsonb),
  'overloads', (select to_jsonb(overload_state) from overload_state),
  'trainer_helper', coalesce((select to_jsonb(helper_state) from helper_state), '{}'::jsonb),
  'rpc_acl', (select to_jsonb(rpc_acl) from rpc_acl),
  'table_security', coalesce((
    select jsonb_agg(to_jsonb(table_security) order by table_name)
    from table_security
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(to_jsonb(policy_state) order by tablename, policyname)
    from policy_state
  ), '[]'::jsonb),
  'direct_grants', coalesce((
    select jsonb_agg(to_jsonb(direct_grants) order by table_name, grantee, privilege_type)
    from direct_grants
  ), '[]'::jsonb),
  'browser_write_grants', (select grant_count from browser_write_grants),
  'browser_dangerous_grants', (select grant_count from browser_dangerous_grants),
  'trainer_target_classification', (select value from trainer_target_classification),
  'security_gate',
    (select bool_and(
      installed
      and owner_postgres
      and plpgsql
      and security_definer
      and defaults_preserved
      and return_type_preserved
      and search_path_safe
      and create_trainer_contract
      and update_trainer_contract
      and relationship_scope_contract
      and submission_cutoff_preserved
      and closed_denial_preserved
      and success_audit_after_mutation
    ) from function_signals)
    and (select expected_identity_count = 2 and total_overload_count = 2 from overload_state)
    and (select installed and owner = 'postgres' and security_definer and stable
      and search_path_safe and browser_private and canonical_membership_contract
      from helper_state)
    and (select authenticated_execute_grants = 2 and unintended_execute_grants = 0 from rpc_acl)
    and (select bool_and(rls_enabled and not force_rls) from table_security)
    and (select grant_count = 0 from browser_write_grants)
    and (select grant_count = 0 from browser_dangerous_grants)
) as ux6d3_verification;
*/
