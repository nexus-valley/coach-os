/*
PRE-APPLY READ-ONLY VERIFICATION

Run this block before APPLY. It inventories the installed Chat policy graph,
captures safe row counts for later comparison, and fails readiness when the
known conversation_threads <-> conversation_participants SELECT cycle is not
present exactly where UX-8G1B1 expects to repair it.

with target_tables(relname) as (
  values
    ('conversation_threads'::text),
    ('conversation_participants'::text),
    ('conversation_messages'::text)
), table_state as (
  select
    target.relname,
    class.oid,
    class.relrowsecurity as rls_enabled,
    class.relforcerowsecurity as force_rls,
    owner_role.rolname as table_owner,
    has_table_privilege('authenticated', class.oid, 'SELECT')
      as authenticated_select
  from target_tables target
  left join pg_catalog.pg_class class
    on class.oid = to_regclass(format('public.%I', target.relname))
  left join pg_catalog.pg_roles owner_role on owner_role.oid = class.relowner
), policy_inventory as (
  select
    policy.tablename,
    policy.policyname,
    policy.permissive,
    policy.roles,
    policy.cmd,
    policy.qual,
    policy.with_check
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
), policy_edges as (
  select distinct
    policy.tablename as source_table,
    referenced.relname as referenced_table
  from policy_inventory policy
  cross join target_tables referenced
  where policy.tablename <> referenced.relname
    and lower(
      coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '')
    ) like '%' || referenced.relname || '%'
), recursion_state as (
  select jsonb_build_object(
    'thread_to_participant', exists (
      select 1 from policy_edges
      where source_table = 'conversation_threads'
        and referenced_table = 'conversation_participants'
    ),
    'participant_to_thread', exists (
      select 1 from policy_edges
      where source_table = 'conversation_participants'
        and referenced_table = 'conversation_threads'
    ),
    'reciprocal_edge_count', (
      select count(*) / 2
      from policy_edges left_edge
      join policy_edges right_edge
        on right_edge.source_table = left_edge.referenced_table
       and right_edge.referenced_table = left_edge.source_table
    )
  ) as value
), expected_policies as (
  select
    count(*) filter (
      where tablename = 'conversation_threads'
        and policyname in (
          'Staff can read operational conversation threads',
          'Trainer can read scoped conversation threads'
        )
        and permissive = 'PERMISSIVE'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
        and lower(coalesce(qual, '')) like '%conversation_participants%'
    ) as recursion_prone_thread_policy_count,
    count(*) filter (
      where tablename = 'conversation_participants'
        and policyname = 'Users can read own conversation participants'
        and permissive = 'PERMISSIVE'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
        and lower(coalesce(qual, '')) like '%conversation_threads%'
    ) as recursion_prone_participant_policy_count,
    count(*) filter (
      where tablename = 'conversation_threads'
        and policyname in (
          'Staff can read operational conversation threads',
          'Trainer can read scoped conversation threads'
        )
    ) as expected_thread_policy_count
  from policy_inventory
), lifecycle_helper as (
  select
    procedure.oid,
    owner_role.rolname as owner_name,
    procedure.prosecdef as security_definer,
    procedure.provolatile = 's' as stable,
    coalesce(procedure.proconfig, array[]::text[])
      @> array['search_path=public, pg_temp'] as fixed_search_path
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_roles owner_role on owner_role.oid = procedure.proowner
  where procedure.oid = to_regprocedure(
    'coachfort_internal.tenant_operational_access_allowed(uuid)'
  )
), chat_domain_helpers(identity) as (
  values
    ('public.chat_current_team_role(uuid)'::text),
    ('public.chat_student_context()'::text),
    ('public.chat_student_can_access_thread(uuid)'::text)
), chat_domain_state as (
  select
    helper.identity,
    procedure.oid is not null as installed,
    procedure.prosecdef as security_definer,
    procedure.provolatile = 's' as stable,
    lower(pg_get_functiondef(procedure.oid)) as source
  from chat_domain_helpers helper
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(helper.identity)
), chat_domain_contract as (
  select
    count(*) = 3 and bool_and(installed and security_definer and stable)
      as helpers_installed,
    bool_and(source like '%operational_current_team_role%') filter (
      where identity = 'public.chat_current_team_role(uuid)'
    ) as team_role_lifecycle_bound,
    bool_and(source like '%auth.uid()%'
      and source like '%tenant_operational_access_allowed%') filter (
      where identity = 'public.chat_student_context()'
    ) as student_context_auth_lifecycle_bound,
    bool_and(source like '%chat_student_context%'
      and source like '%tenant_id = v_ctx.tenant_id%') filter (
      where identity = 'public.chat_student_can_access_thread(uuid)'
    ) as student_thread_tenant_bound
  from chat_domain_state
-- Preserve the exact production Chat ACL baseline without granting or revoking
-- table privileges in this recursion-only migration.
), browser_grants as (
  select
    count(*) filter (
      where grant_state.grantee = 'authenticated'
        and grant_state.privilege_type = 'SELECT'
    ) as authenticated_direct_select_grants,
    count(*) filter (
      where grant_state.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) as dml_write_grants,
    count(*) filter (
      where grant_state.privilege_type = 'MAINTAIN'
    ) as maintain_grant_count,
    count(*) filter (
      where grant_state.grantee in ('anon', 'authenticated')
        and grant_state.privilege_type in (
          'REFERENCES', 'TRIGGER', 'TRUNCATE'
        )
    ) as preexisting_non_dml_grant_count,
    count(*) filter (
      where grant_state.grantee in ('anon', 'authenticated')
        and grant_state.privilege_type in (
          'REFERENCES', 'TRIGGER', 'TRUNCATE'
        )
        and grant_state.is_grantable <> 'NO'
    ) as grantable_non_dml_grant_count,
    count(*) filter (
      where not (
        grant_state.grantee in ('anon', 'authenticated')
        and grant_state.privilege_type in (
          'REFERENCES', 'TRIGGER', 'TRUNCATE'
        )
        and grant_state.is_grantable = 'NO'
      )
    ) as unexpected_browser_grant_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', grant_state.table_name,
          'role', grant_state.grantee,
          'privilege', grant_state.privilege_type,
          'is_grantable', grant_state.is_grantable
        ) order by
          grant_state.table_name,
          grant_state.grantee,
          grant_state.privilege_type
      ) filter (
        where grant_state.grantee in ('anon', 'authenticated')
          and grant_state.privilege_type in (
            'REFERENCES', 'TRIGGER', 'TRUNCATE'
          )
      ),
      '[]'::jsonb
    ) as preexisting_non_dml_grants
  from information_schema.role_table_grants grant_state
  where grant_state.table_schema = 'public'
    and grant_state.table_name in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
    and grant_state.grantee in ('PUBLIC', 'anon', 'authenticated')
), internal_schema_exposure as (
  select
    exists (
      select 1
      from unnest(string_to_array(
        coalesce(current_setting('pgrst.db_schemas', true), ''), ','
      )) exposed(schema_name)
      where trim(exposed.schema_name) = 'coachfort_internal'
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting role_setting
      join pg_catalog.pg_roles authenticator
        on authenticator.oid = role_setting.setrole
      cross join lateral unnest(role_setting.setconfig) setting(value)
      cross join lateral regexp_split_to_table(
        split_part(setting.value, '=', 2), ','
      ) exposed(schema_name)
      where authenticator.rolname = 'authenticator'
        and role_setting.setdatabase in (
          0,
          (select oid from pg_catalog.pg_database
           where datname = current_database())
        )
        and setting.value like 'pgrst.db_schemas=%'
        and trim(exposed.schema_name) = 'coachfort_internal'
    ) as is_exposed,
    has_schema_privilege('authenticated', namespace.oid, 'USAGE')
      as authenticated_usage,
    not exists (
      select 1
      from aclexplode(coalesce(
        namespace.nspacl,
        acldefault('n', namespace.nspowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'USAGE'
    ) as public_usage_revoked,
    not has_schema_privilege('anon', namespace.oid, 'USAGE')
      as anon_usage_revoked,
    not has_schema_privilege('service_role', namespace.oid, 'USAGE')
      as service_role_usage_revoked
  from pg_catalog.pg_namespace namespace
  where namespace.nspname = 'coachfort_internal'
), row_counts as (
  select jsonb_build_object(
    'conversation_threads', (select count(*) from public.conversation_threads),
    'conversation_participants', (
      select count(*) from public.conversation_participants
    ),
    'conversation_messages', (select count(*) from public.conversation_messages),
    'subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
    ),
    'current_subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
      where is_current
    )
  ) as value
), readiness as (
  select
    (select count(*) = 3
       and bool_and(oid is not null)
       and bool_and(rls_enabled)
       and bool_and(not force_rls)
       and bool_and(not authenticated_select)
     from table_state)
    and (select recursion_prone_thread_policy_count = 2
           and recursion_prone_participant_policy_count = 1
           and expected_thread_policy_count = 2
         from expected_policies)
    and (select (value->>'thread_to_participant')::boolean
           and (value->>'participant_to_thread')::boolean
           and (value->>'reciprocal_edge_count')::integer > 0
         from recursion_state)
    and (select count(*) = 1
           and bool_and(owner_name = 'postgres')
           and bool_and(security_definer)
           and bool_and(stable)
           and bool_and(fixed_search_path)
         from lifecycle_helper)
    and (select helpers_installed
           and team_role_lifecycle_bound
           and student_context_auth_lifecycle_bound
           and student_thread_tenant_bound
         from chat_domain_contract)
    and to_regprocedure(
      'coachfort_internal.chat_authenticated_user_is_participant(uuid,uuid)'
    ) is null
    and (select authenticated_direct_select_grants = 0
           and dml_write_grants = 0
           and maintain_grant_count = 0
           and preexisting_non_dml_grant_count = 18
           and grantable_non_dml_grant_count = 0
           and unexpected_browser_grant_count = 0
         from browser_grants)
    and (select not is_exposed
           and authenticated_usage
           and public_usage_revoked
           and anon_usage_revoked
           and service_role_usage_revoked
         from internal_schema_exposure)
      as ready_for_apply
)
select jsonb_build_object(
  'ready_for_apply', (select ready_for_apply from readiness),
  'tables', (
    select jsonb_agg(to_jsonb(table_state) order by relname) from table_state
  ),
  'policies', (
    select jsonb_agg(to_jsonb(policy_inventory) order by tablename, policyname)
    from policy_inventory
  ),
  'policy_edges', (
    select coalesce(
      jsonb_agg(to_jsonb(policy_edges) order by source_table, referenced_table),
      '[]'::jsonb
    ) from policy_edges
  ),
  'recursion', (select value from recursion_state),
  'expected_policy_state', (select to_jsonb(expected_policies) from expected_policies),
  'lifecycle_helper', (select to_jsonb(lifecycle_helper) from lifecycle_helper),
  'chat_domain_contract', (select to_jsonb(chat_domain_contract)
                           from chat_domain_contract),
  'helper_before', to_regprocedure(
    'coachfort_internal.chat_authenticated_user_is_participant(uuid,uuid)'
  ),
  'browser_grants', (select to_jsonb(browser_grants) from browser_grants),
  'internal_schema', (select to_jsonb(internal_schema_exposure)
                      from internal_schema_exposure),
  'safe_row_counts_compare_with_post', (select value from row_counts)
) as ux8g1b1_preflight;
*/

begin;

do $$
declare
  v_policy record;
  v_unsafe_tables text[];
begin
  if to_regnamespace('coachfort_internal') is null then
    raise exception 'UX-8G1B1 requires coachfort_internal.'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'coachfort_internal.tenant_operational_access_allowed(uuid)'
     ) is null then
    raise exception 'UX-8G1B lifecycle authority is not installed.'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'coachfort_internal.chat_authenticated_user_is_participant(uuid,uuid)'
     ) is not null then
    raise exception 'UX-8G1B1 Chat participant helper already exists.'
      using errcode = '42710';
  end if;

  if exists (
    select 1
    from unnest(string_to_array(
      coalesce(current_setting('pgrst.db_schemas', true), ''), ','
    )) exposed(schema_name)
    where trim(exposed.schema_name) = 'coachfort_internal'
  ) or exists (
    select 1
    from pg_catalog.pg_db_role_setting role_setting
    join pg_catalog.pg_roles authenticator
      on authenticator.oid = role_setting.setrole
    cross join lateral unnest(role_setting.setconfig) setting(value)
    cross join lateral regexp_split_to_table(
      split_part(setting.value, '=', 2), ','
    ) exposed(schema_name)
    where authenticator.rolname = 'authenticator'
      and role_setting.setdatabase in (
        0,
        (select oid from pg_catalog.pg_database
         where datname = current_database())
      )
      and setting.value like 'pgrst.db_schemas=%'
      and trim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'coachfort_internal must not be PostgREST-exposed.'
      using errcode = '42501';
  end if;

  if not has_schema_privilege(
    'authenticated', 'coachfort_internal', 'USAGE'
  ) then
    raise exception 'Authenticated RLS cannot use coachfort_internal.'
      using errcode = '42501';
  end if;

  select array_agg(class.relname order by class.relname)
    into v_unsafe_tables
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  cross join pg_catalog.pg_roles helper_owner
  where namespace.nspname = 'public'
    and class.relname in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
    and helper_owner.rolname = 'postgres'
    and (
      not class.relrowsecurity
      or class.relforcerowsecurity
      or not (
        helper_owner.rolsuper
        or helper_owner.rolbypassrls
        or (class.relowner = helper_owner.oid and not class.relforcerowsecurity)
      )
    );

  if coalesce(cardinality(v_unsafe_tables), 0) > 0 then
    raise exception 'UX-8G1B1 unsafe Chat RLS/helper-owner state: %.',
      array_to_string(v_unsafe_tables, ', ')
      using errcode = '42501';
  end if;

  -- The 18 non-grantable REFERENCES/TRIGGER/TRUNCATE grants are an inventoried
  -- baseline. Abort only if that exact baseline or the hardened API boundary drifts.
  if (
    select count(*)
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'conversation_threads',
        'conversation_participants',
        'conversation_messages'
      )
  ) <> 3 then
    raise exception 'UX-8G1B1 requires all three Chat tables.'
      using errcode = '42P01';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'conversation_threads',
        'conversation_participants',
        'conversation_messages'
      )
      and has_table_privilege('authenticated', class.oid, 'SELECT')
  ) then
    raise exception 'UX-8G1B1 must preserve the no-direct-Chat-SELECT baseline.'
      using errcode = '42501';
  end if;

  if (
    select count(*)
    from information_schema.role_table_grants grant_state
    where grant_state.table_schema = 'public'
      and grant_state.table_name in (
        'conversation_threads',
        'conversation_participants',
        'conversation_messages'
      )
      and grant_state.grantee in ('anon', 'authenticated')
      and grant_state.privilege_type in (
        'REFERENCES', 'TRIGGER', 'TRUNCATE'
      )
  ) <> 18 or exists (
    select 1
    from information_schema.role_table_grants grant_state
    where grant_state.table_schema = 'public'
      and grant_state.table_name in (
        'conversation_threads',
        'conversation_participants',
        'conversation_messages'
      )
      and grant_state.grantee in ('PUBLIC', 'anon', 'authenticated')
      and not (
        grant_state.grantee in ('anon', 'authenticated')
        and grant_state.privilege_type in (
          'REFERENCES', 'TRIGGER', 'TRUNCATE'
        )
        and grant_state.is_grantable = 'NO'
      )
  ) then
    raise exception 'UX-8G1B1 Chat browser grant baseline has drifted.'
      using errcode = '42501';
  end if;

  if to_regprocedure('public.chat_current_team_role(uuid)') is null
     or lower(pg_get_functiondef(
       to_regprocedure('public.chat_current_team_role(uuid)')
     )) not like '%operational_current_team_role%'
     or to_regprocedure('public.chat_student_context()') is null
     or lower(pg_get_functiondef(
       to_regprocedure('public.chat_student_context()')
     )) not like '%auth.uid()%'
     or lower(pg_get_functiondef(
       to_regprocedure('public.chat_student_context()')
     )) not like '%tenant_operational_access_allowed%'
     or to_regprocedure('public.chat_student_can_access_thread(uuid)') is null
     or lower(pg_get_functiondef(
       to_regprocedure('public.chat_student_can_access_thread(uuid)')
     )) not like '%chat_student_context%'
     or lower(pg_get_functiondef(
       to_regprocedure('public.chat_student_can_access_thread(uuid)')
     )) not like '%tenant_id = v_ctx.tenant_id%' then
    raise exception 'UX-8G1B Chat domain lifecycle authority has drifted.'
      using errcode = '55000';
  end if;

  for v_policy in
    select *
    from (values
      (
        'Staff can read operational conversation threads'::text,
        '%conversation_participants%'::text
      ),
      (
        'Trainer can read scoped conversation threads'::text,
        '%conversation_participants%'::text
      )
    ) expected(policy_name, required_qual)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'conversation_threads'
        and policy.policyname = v_policy.policy_name
        and policy.permissive = 'PERMISSIVE'
        and policy.cmd = 'SELECT'
        and policy.roles = array['authenticated']::name[]
        and lower(coalesce(policy.qual, '')) like v_policy.required_qual
    ) then
      raise exception 'UX-8G1B1 unexpected thread policy: %.',
        v_policy.policy_name using errcode = '55000';
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'conversation_participants'
      and policy.policyname = 'Users can read own conversation participants'
      and policy.permissive = 'PERMISSIVE'
      and policy.cmd = 'SELECT'
      and policy.roles = array['authenticated']::name[]
      and lower(coalesce(policy.qual, '')) like '%conversation_threads%'
  ) then
    raise exception 'UX-8G1B1 expected reciprocal participant policy is absent.'
      using errcode = '55000';
  end if;

end;
$$;

create function coachfort_internal.chat_authenticated_user_is_participant(
  p_tenant_id uuid,
  p_thread_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
begin
  if p_tenant_id is null
     or p_thread_id is null
     or v_actor_user_id is null then
    return false;
  end if;

  -- Lifecycle denial is authoritative and precedes Chat participation lookup.
  if not coachfort_internal.tenant_operational_access_allowed(p_tenant_id) then
    return false;
  end if;

  return exists (
    select 1
    from public.conversation_participants participant
    where participant.tenant_id = p_tenant_id
      and participant.thread_id = p_thread_id
      and participant.user_id = v_actor_user_id
  );
end;
$$;

alter function coachfort_internal.chat_authenticated_user_is_participant(
  uuid, uuid
) owner to postgres;

revoke all on function
  coachfort_internal.chat_authenticated_user_is_participant(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Required only for authenticated RLS evaluation. coachfort_internal remains
-- outside PostgREST and the helper binds the actor to auth.uid().
grant execute on function
  coachfort_internal.chat_authenticated_user_is_participant(uuid, uuid)
  to authenticated;

alter policy "Staff can read operational conversation threads"
on public.conversation_threads
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['staff'])
  and (
    thread_type in (
      'announcement',
      'course_discussion',
      'cohort_discussion',
      'staff_note'
    )
    or coachfort_internal.chat_authenticated_user_is_participant(
      tenant_id,
      id
    )
  )
);

alter policy "Trainer can read scoped conversation threads"
on public.conversation_threads
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and (
    thread_type = 'announcement'
    or coachfort_internal.chat_authenticated_user_is_participant(
      tenant_id,
      id
    )
    or exists (
      select 1
      from public.trainer_course_assignments assignment
      where assignment.tenant_id = conversation_threads.tenant_id
        and assignment.trainer_user_id = auth.uid()
        and assignment.course_id = conversation_threads.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments assignment
      where assignment.tenant_id = conversation_threads.tenant_id
        and assignment.trainer_user_id = auth.uid()
        and assignment.cohort_id = conversation_threads.cohort_id
    )
    or (
      conversation_threads.student_id is not null
      and (
        exists (
          select 1
          from public.enrollments enrollment
          join public.trainer_course_assignments assignment
            on assignment.tenant_id = enrollment.tenant_id
           and assignment.course_id = enrollment.course_id
          where enrollment.tenant_id = conversation_threads.tenant_id
            and enrollment.student_id = conversation_threads.student_id
            and assignment.trainer_user_id = auth.uid()
        )
        or exists (
          select 1
          from public.cohort_members member
          join public.trainer_cohort_assignments assignment
            on assignment.tenant_id = member.tenant_id
           and assignment.cohort_id = member.cohort_id
          where member.tenant_id = conversation_threads.tenant_id
            and member.student_id = conversation_threads.student_id
            and assignment.trainer_user_id = auth.uid()
        )
      )
    )
  )
);

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Compare safe_row_counts_compare_with_pre with the PRE result. This migration
contains no business-row DML; equal values confirm Chat and subscription rows
were not created or deleted while installing the helper/policy correction.

with target_tables(relname) as (
  values
    ('conversation_threads'::text),
    ('conversation_participants'::text),
    ('conversation_messages'::text)
), table_state as (
  select
    target.relname,
    class.oid,
    class.relrowsecurity as rls_enabled,
    class.relforcerowsecurity as force_rls,
    has_table_privilege('authenticated', class.oid, 'SELECT')
      as authenticated_select
  from target_tables target
  left join pg_catalog.pg_class class
    on class.oid = to_regclass(format('public.%I', target.relname))
), policy_inventory as (
  select
    policy.tablename,
    policy.policyname,
    policy.permissive,
    policy.roles,
    policy.cmd,
    policy.qual,
    policy.with_check
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
), policy_edges as (
  select distinct
    policy.tablename as source_table,
    referenced.relname as referenced_table
  from policy_inventory policy
  cross join target_tables referenced
  where policy.tablename <> referenced.relname
    and lower(
      coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '')
    ) like '%' || referenced.relname || '%'
), reciprocal_edges as (
  select count(*) / 2 as edge_count
  from policy_edges left_edge
  join policy_edges right_edge
    on right_edge.source_table = left_edge.referenced_table
   and right_edge.referenced_table = left_edge.source_table
), helper_state as (
  select
    procedure.oid,
    owner_role.rolname as owner_name,
    procedure.prosecdef as security_definer,
    procedure.provolatile = 's' as stable,
    coalesce(procedure.proconfig, array[]::text[])
      @> array['search_path=public, pg_temp'] as fixed_search_path,
    lower(pg_get_functiondef(procedure.oid)) as source,
    not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute_revoked,
    not has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute_revoked,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      as authenticated_execute,
    not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      as service_role_execute_revoked
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_roles owner_role on owner_role.oid = procedure.proowner
  where procedure.oid = to_regprocedure(
    'coachfort_internal.chat_authenticated_user_is_participant(uuid,uuid)'
  )
), helper_owner_safety as (
  select
    count(*) = 3
    and bool_and(
      helper_owner.rolsuper
      or helper_owner.rolbypassrls
      or (class.relowner = helper_owner.oid and not class.relforcerowsecurity)
    ) as bypass_safe,
    bool_and(class.relrowsecurity) as rls_enabled,
    bool_and(not class.relforcerowsecurity) as force_rls_safe
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  cross join pg_catalog.pg_roles helper_owner
  where namespace.nspname = 'public'
    and class.relname in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
    and helper_owner.rolname = 'postgres'
), thread_policy_state as (
  select
    count(*) = 2 as expected_count,
    bool_and(
      lower(coalesce(qual, '')) like
        '%chat_authenticated_user_is_participant%'
    ) as helper_used,
    bool_and(
      lower(coalesce(qual, '')) not like '%conversation_participants%'
    ) as direct_participant_lookup_absent,
    bool_and(permissive = 'PERMISSIVE') as permissive_preserved,
    bool_and(cmd = 'SELECT') as select_preserved,
    bool_and(roles = array['authenticated']::name[]) as role_preserved
  from policy_inventory
  where tablename = 'conversation_threads'
    and policyname in (
      'Staff can read operational conversation threads',
      'Trainer can read scoped conversation threads'
    )
), role_semantics as (
  select
    count(*) filter (
      where policyname = 'Owner and admin can read conversation threads'
        and lower(coalesce(qual, '')) like '%owner%'
        and lower(coalesce(qual, '')) like '%admin%'
    ) = 1 as owner_admin_preserved,
    count(*) filter (
      where policyname = 'Staff can read operational conversation threads'
        and lower(coalesce(qual, '')) like '%staff%'
        and lower(coalesce(qual, '')) like '%course_discussion%'
        and lower(coalesce(qual, '')) like '%cohort_discussion%'
        and lower(coalesce(qual, '')) like '%staff_note%'
    ) = 1 as staff_preserved,
    count(*) filter (
      where policyname = 'Trainer can read scoped conversation threads'
        and lower(coalesce(qual, '')) like '%trainer_course_assignments%'
        and lower(coalesce(qual, '')) like '%trainer_cohort_assignments%'
        and lower(coalesce(qual, '')) like '%enrollments%'
        and lower(coalesce(qual, '')) like '%cohort_members%'
    ) = 1 as trainer_preserved,
    count(*) filter (
      where tablename = 'conversation_participants'
        and policyname = 'Users can read own conversation participants'
        and lower(coalesce(qual, '')) like '%user_id = auth.uid()%'
        and lower(coalesce(qual, '')) like '%conversation_threads%'
    ) = 1 as participant_policy_preserved,
    count(*) filter (
      where tablename = 'conversation_messages'
        and policyname = 'Users can read scoped conversation messages'
        and lower(coalesce(qual, '')) like '%conversation_threads%'
        and lower(coalesce(qual, '')) like '%conversation_participants%'
    ) = 1 as message_policy_preserved
  from policy_inventory
), chat_domain_helpers(identity) as (
  values
    ('public.chat_current_team_role(uuid)'::text),
    ('public.chat_student_context()'::text),
    ('public.chat_student_can_access_thread(uuid)'::text)
), chat_domain_function_state as (
  select
    helper.identity,
    procedure.oid is not null as installed,
    procedure.prosecdef as security_definer,
    procedure.provolatile = 's' as stable,
    lower(pg_get_functiondef(procedure.oid)) as source
  from chat_domain_helpers helper
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(helper.identity)
), chat_domain_state as (
  select
    count(*) = 3 and bool_and(installed and security_definer and stable)
      as helpers_installed,
    bool_and(source like '%operational_current_team_role%'
      and source like '%auth.uid()%') filter (
      where identity = 'public.chat_current_team_role(uuid)'
    ) as team_role_lifecycle_bound,
    bool_and(source like '%auth.uid()%'
      and source like '%tenant_operational_access_allowed%') filter (
      where identity = 'public.chat_student_context()'
    ) as student_context_auth_and_lifecycle_bound,
    bool_and(source like '%chat_student_context%'
      and source like '%tenant_id = v_ctx.tenant_id%') filter (
      where identity = 'public.chat_student_can_access_thread(uuid)'
    ) as student_thread_tenant_bound
  from chat_domain_function_state
-- Re-inventory the unchanged production Chat ACL baseline after APPLY.
), browser_grants as (
  select
    count(*) filter (
      where grant_state.grantee = 'authenticated'
        and grant_state.privilege_type = 'SELECT'
    ) as authenticated_direct_select_grants,
    count(*) filter (
      where grant_state.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) as dml_write_grants,
    count(*) filter (
      where grant_state.privilege_type = 'MAINTAIN'
    ) as maintain_grant_count,
    count(*) filter (
      where grant_state.grantee in ('anon', 'authenticated')
        and grant_state.privilege_type in (
          'REFERENCES', 'TRIGGER', 'TRUNCATE'
        )
    ) as preexisting_non_dml_grant_count,
    count(*) filter (
      where grant_state.grantee in ('anon', 'authenticated')
        and grant_state.privilege_type in (
          'REFERENCES', 'TRIGGER', 'TRUNCATE'
        )
        and grant_state.is_grantable <> 'NO'
    ) as grantable_non_dml_grant_count,
    count(*) filter (
      where not (
        grant_state.grantee in ('anon', 'authenticated')
        and grant_state.privilege_type in (
          'REFERENCES', 'TRIGGER', 'TRUNCATE'
        )
        and grant_state.is_grantable = 'NO'
      )
    ) as unexpected_browser_grant_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', grant_state.table_name,
          'role', grant_state.grantee,
          'privilege', grant_state.privilege_type,
          'is_grantable', grant_state.is_grantable
        ) order by
          grant_state.table_name,
          grant_state.grantee,
          grant_state.privilege_type
      ) filter (
        where grant_state.grantee in ('anon', 'authenticated')
          and grant_state.privilege_type in (
            'REFERENCES', 'TRIGGER', 'TRUNCATE'
          )
      ),
      '[]'::jsonb
    ) as preexisting_non_dml_grants
  from information_schema.role_table_grants grant_state
  where grant_state.table_schema = 'public'
    and grant_state.table_name in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
    and grant_state.grantee in ('PUBLIC', 'anon', 'authenticated')
), internal_schema_exposure as (
  select
    exists (
      select 1
      from unnest(string_to_array(
        coalesce(current_setting('pgrst.db_schemas', true), ''), ','
      )) exposed(schema_name)
      where trim(exposed.schema_name) = 'coachfort_internal'
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting role_setting
      join pg_catalog.pg_roles authenticator
        on authenticator.oid = role_setting.setrole
      cross join lateral unnest(role_setting.setconfig) setting(value)
      cross join lateral regexp_split_to_table(
        split_part(setting.value, '=', 2), ','
      ) exposed(schema_name)
      where authenticator.rolname = 'authenticator'
        and role_setting.setdatabase in (
          0,
          (select oid from pg_catalog.pg_database
           where datname = current_database())
        )
        and setting.value like 'pgrst.db_schemas=%'
        and trim(exposed.schema_name) = 'coachfort_internal'
    ) as is_exposed,
    has_schema_privilege('authenticated', namespace.oid, 'USAGE')
      as authenticated_usage,
    not exists (
      select 1
      from aclexplode(coalesce(
        namespace.nspacl,
        acldefault('n', namespace.nspowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'USAGE'
    ) as public_usage_revoked,
    not has_schema_privilege('anon', namespace.oid, 'USAGE')
      as anon_usage_revoked,
    not has_schema_privilege('service_role', namespace.oid, 'USAGE')
      as service_role_usage_revoked
  from pg_catalog.pg_namespace namespace
  where namespace.nspname = 'coachfort_internal'
), row_counts as (
  select jsonb_build_object(
    'conversation_threads', (select count(*) from public.conversation_threads),
    'conversation_participants', (
      select count(*) from public.conversation_participants
    ),
    'conversation_messages', (select count(*) from public.conversation_messages),
    'subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
    ),
    'current_subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
      where is_current
    )
  ) as value
), final_state as (
  select
    (select count(*) = 3
       and bool_and(oid is not null)
       and bool_and(rls_enabled)
       and bool_and(not force_rls)
       and bool_and(not authenticated_select)
     from table_state)
    and (select count(*) = 1
       and bool_and(owner_name = 'postgres')
       and bool_and(security_definer)
       and bool_and(stable)
       and bool_and(fixed_search_path)
       and bool_and(public_execute_revoked)
       and bool_and(anon_execute_revoked)
       and bool_and(authenticated_execute)
       and bool_and(service_role_execute_revoked)
       and bool_and(source like '%auth.uid()%')
       and bool_and(source like '%tenant_operational_access_allowed%')
       and bool_and(
         position('tenant_operational_access_allowed' in source)
         < position('from public.conversation_participants' in source)
       )
       and bool_and(source like '%participant.tenant_id = p_tenant_id%')
       and bool_and(source like '%participant.thread_id = p_thread_id%')
       and bool_and(source like '%participant.user_id = v_actor_user_id%')
     from helper_state)
    and (select bypass_safe and rls_enabled and force_rls_safe
         from helper_owner_safety)
    and (select expected_count and helper_used
           and direct_participant_lookup_absent
           and permissive_preserved and select_preserved and role_preserved
         from thread_policy_state)
    and (select edge_count = 0 from reciprocal_edges)
    and not exists (
      select 1 from policy_edges
      where source_table = 'conversation_threads'
        and referenced_table = 'conversation_participants'
    )
    and (select owner_admin_preserved and staff_preserved and trainer_preserved
           and participant_policy_preserved and message_policy_preserved
         from role_semantics)
    and (select helpers_installed
           and team_role_lifecycle_bound
           and student_context_auth_and_lifecycle_bound
           and student_thread_tenant_bound
         from chat_domain_state)
    and (select authenticated_direct_select_grants = 0
           and dml_write_grants = 0
           and maintain_grant_count = 0
           and preexisting_non_dml_grant_count = 18
           and grantable_non_dml_grant_count = 0
           and unexpected_browser_grant_count = 0
         from browser_grants)
    and (select not is_exposed
           and authenticated_usage
           and public_usage_revoked
           and anon_usage_revoked
           and service_role_usage_revoked
         from internal_schema_exposure)
      as security_gate
)
select jsonb_build_object(
  'security_gate', (select security_gate from final_state),
  'tables', (select jsonb_agg(to_jsonb(table_state) order by relname)
             from table_state),
  'helper', (select to_jsonb(helper_state) - 'source' from helper_state),
  'helper_owner_safety', (select to_jsonb(helper_owner_safety) from helper_owner_safety),
  'thread_policy_state', (select to_jsonb(thread_policy_state) from thread_policy_state),
  'role_semantics', (select to_jsonb(role_semantics) from role_semantics),
  'chat_domain_state', (select to_jsonb(chat_domain_state)
                        from chat_domain_state),
  'policy_edges', (
    select coalesce(
      jsonb_agg(to_jsonb(policy_edges) order by source_table, referenced_table),
      '[]'::jsonb
    ) from policy_edges
  ),
  'reciprocal_policy_edges', (select edge_count from reciprocal_edges),
  'browser_grants', (select to_jsonb(browser_grants) from browser_grants),
  'internal_schema', (select to_jsonb(internal_schema_exposure)
                      from internal_schema_exposure),
  'safe_row_counts_compare_with_pre', (select value from row_counts)
) as ux8g1b1_post_apply_verification;
*/
