/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query before applying the executable migration. It inspects metadata
only and does not call review RPCs or read assignment/submission content.

with
review_functions as (
  select
    p.oid,
    n.nspname as schema_name,
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_arguments(p.oid) as arguments,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.pronargdefaults as default_argument_count,
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
    pg_catalog.pg_get_functiondef(p.oid) as definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'review_assignment_submission_secure',
      'review_delegated_assignment_submission'
    )
),
column_state as (
  select
    c.data_type,
    c.column_default,
    c.is_nullable,
    c.udt_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'assignment_submissions'
    and c.column_name = 'updated_at'
),
trigger_state as (
  select
    t.tgenabled,
    pg_catalog.pg_get_triggerdef(t.oid, true) as definition,
    pn.nspname || '.' || p.proname as function_name,
    pg_catalog.pg_get_functiondef(p.oid) as function_definition
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where n.nspname = 'public'
    and c.relname = 'assignment_submissions'
    and t.tgname = 'set_assignment_submissions_updated_at'
    and not t.tgisinternal
),
dependent_objects as (
  select
    rf.schema_name || '.' || rf.proname || '(' || rf.identity_arguments || ')' as function_identity,
    count(d.objid)::bigint as dependent_object_count
  from review_functions rf
  left join pg_catalog.pg_depend d
    on d.refobjid = rf.oid
   and d.deptype not in ('e', 'i')
  where rf.oid in (
    pg_catalog.to_regprocedure(
      'public.review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)'
    )::oid,
    pg_catalog.to_regprocedure(
      'public.review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)'
    )::oid
  )
  group by rf.schema_name, rf.proname, rf.identity_arguments
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
browser_write_grants as (
  select count(*)::bigint as grant_count
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('assignments', 'assignment_submissions')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
    and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
),
browser_dangerous_grants as (
  select count(*)::bigint as grant_count
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('assignments', 'assignment_submissions')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
    and tp.privilege_type in (
      'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
    )
),
required_helpers(identity) as (
  values
    ('public.m69_4_assert_assignment_in_tenant(uuid,uuid)'),
    ('public.m69_4_assert_student_in_tenant(uuid,uuid)'),
    ('public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_validate_score(numeric,numeric)'),
    ('public.m69_4_normalize_text(text,text,boolean,integer)'),
    ('public.m69_4_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'),
    ('public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'),
    ('public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)')
),
helper_state as (
  select
    identity,
    pg_catalog.to_regprocedure(identity) is not null as installed
  from required_helpers
)
select jsonb_build_object(
  'column', coalesce((select to_jsonb(column_state) from column_state), '{}'::jsonb),
  'trigger', coalesce((select to_jsonb(trigger_state) from trigger_state), '{}'::jsonb),
  'review_functions', coalesce((
    select jsonb_agg(to_jsonb(review_functions) order by proname, identity_arguments)
    from review_functions
  ), '[]'::jsonb),
  'dependent_objects', coalesce((
    select jsonb_agg(to_jsonb(dependent_objects) order by function_identity)
    from dependent_objects
  ), '[]'::jsonb),
  'table_security', coalesce((
    select jsonb_agg(to_jsonb(table_security) order by table_name)
    from table_security
  ), '[]'::jsonb),
  'browser_write_grants', (select grant_count from browser_write_grants),
  'browser_dangerous_grants', (select grant_count from browser_dangerous_grants),
  'required_helpers', coalesce((
    select jsonb_agg(to_jsonb(helper_state) order by identity)
    from helper_state
  ), '[]'::jsonb)
);
*/

begin;

do $$
declare
  v_new_delegated regprocedure := pg_catalog.to_regprocedure(
    'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'
  );
  v_new_normal regprocedure := pg_catalog.to_regprocedure(
    'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'
  );
  v_old_delegated regprocedure := pg_catalog.to_regprocedure(
    'public.review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)'
  );
  v_old_normal regprocedure := pg_catalog.to_regprocedure(
    'public.review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)'
  );
  v_unexpected_overloads integer;
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'assignment_submissions'
      and c.column_name = 'updated_at'
      and c.data_type = 'timestamp with time zone'
      and c.is_nullable = 'NO'
      and lower(coalesce(c.column_default, '')) in ('now()', 'current_timestamp')
  ) then
    raise exception 'UX-6D1 prerequisite failed: assignment submission revision column is incompatible.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'public'
      and c.relname = 'assignment_submissions'
      and t.tgname = 'set_assignment_submissions_updated_at'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and pn.nspname = 'public'
      and p.proname = 'set_updated_at'
      and lower(pg_catalog.pg_get_triggerdef(t.oid, true)) like '%before update%'
      and lower(pg_catalog.pg_get_functiondef(p.oid)) like '%new.updated_at = now()%'
  ) then
    raise exception 'UX-6D1 prerequisite failed: assignment submission revision trigger is incompatible.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('assignments', 'assignment_submissions')
      and c.relrowsecurity
    group by n.nspname
    having count(*) = 2
  ) then
    raise exception 'UX-6D1 prerequisite failed: assignment RLS is not enabled.';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name in ('assignments', 'assignment_submissions')
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
      and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'UX-6D1 prerequisite failed: direct browser assignment writes are enabled.';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name in ('assignments', 'assignment_submissions')
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
      and tp.privilege_type in (
        'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
      )
  ) then
    raise exception 'UX-6D1 prerequisite failed: dangerous browser assignment grants are enabled.';
  end if;

  if pg_catalog.to_regprocedure(
       'public.m69_4_assert_assignment_in_tenant(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.m69_4_assert_student_in_tenant(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.m69_4_assert_review_assignment(uuid,uuid,uuid,uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.m69_4_validate_score(numeric,numeric)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.m69_4_normalize_text(text,text,boolean,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.m69_4_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)'
     ) is null then
    raise exception 'UX-6D1 prerequisite failed: required assignment authorization helpers are missing.';
  end if;

  select count(*)
  into v_unexpected_overloads
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'review_assignment_submission_secure',
      'review_delegated_assignment_submission'
    )
    and p.oid not in (
      coalesce(v_old_normal::oid, 0::oid),
      coalesce(v_old_delegated::oid, 0::oid),
      coalesce(v_new_normal::oid, 0::oid),
      coalesce(v_new_delegated::oid, 0::oid)
    );

  if v_unexpected_overloads <> 0 then
    raise exception 'UX-6D1 prerequisite failed: unexpected review RPC overloads exist.';
  end if;

  if (v_old_normal is null) <> (v_old_delegated is null)
     or (v_new_normal is null) <> (v_new_delegated is null) then
    raise exception 'UX-6D1 prerequisite failed: review RPC identities are in a mixed state.';
  end if;

  if v_old_normal is null and v_new_normal is null then
    raise exception 'UX-6D1 prerequisite failed: no recognized review RPC contract is installed.';
  end if;

  if v_old_normal is not null then
    if exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid in (v_old_normal::oid, v_old_delegated::oid)
        and (
          pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
          or not p.prosecdef
          or p.pronargdefaults <> 2
          or not coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']
        )
    ) then
      raise exception 'UX-6D1 prerequisite failed: existing review RPC metadata is incompatible.';
    end if;

    if not pg_catalog.has_function_privilege(
         'authenticated', v_old_normal, 'EXECUTE'
       )
       or not pg_catalog.has_function_privilege(
         'authenticated', v_old_delegated, 'EXECUTE'
       )
       or pg_catalog.has_function_privilege('anon', v_old_normal, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_old_delegated, 'EXECUTE') then
      raise exception 'UX-6D1 prerequisite failed: existing review RPC ACL is incompatible.';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_depend d
      where d.refobjid in (v_old_normal::oid, v_old_delegated::oid)
        and d.deptype not in ('e', 'i')
    ) then
      raise exception 'UX-6D1 prerequisite failed: old review RPCs have dependent database objects.';
    end if;
  end if;
end;
$$;

-- Lock order is assignment first, submission second. This matches
-- submit_assignment_secure and avoids an assignment/submission lock inversion.
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
  v_score numeric;
  v_submission public.assignment_submissions%rowtype;
begin
  if p_expected_submission_updated_at is null then
    raise exception 'Expected submission revision is required.' using errcode = '22023';
  end if;

  v_assignment := public.m69_4_assert_assignment_in_tenant(
    p_tenant_id, p_assignment_id
  );
  perform public.m69_4_assert_student_in_tenant(p_tenant_id, p_student_id);
  perform public.m69_4_assert_review_assignment(
    p_tenant_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    p_student_id,
    p_assignment_id,
    v_assignment.trainer_user_id
  );

  select *
  into v_assignment
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

  select *
  into v_submission
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

  update public.assignment_submissions s
  set
    feedback = public.m69_4_normalize_text(
      p_feedback, 'Feedback', false, 4000
    ),
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
  v_matched_permission_id uuid;
  v_matched_scope_id uuid;
  v_matched_scope_type text;
  v_score numeric;
  v_submission public.assignment_submissions%rowtype;
begin
  if p_expected_submission_updated_at is null then
    raise exception 'Expected submission revision is required.' using errcode = '22023';
  end if;

  if v_actor_id is null
     or not public.is_tenant_member(p_tenant_id, v_actor_id) then
    raise exception 'You do not have permission to review submissions.'
      using errcode = '42501';
  end if;

  v_assignment := public.m69_4_assert_assignment_in_tenant(
    p_tenant_id, p_assignment_id
  );
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
    raise exception 'You do not have delegated permission to review this submission.'
      using errcode = '42501';
  end if;

  select *
  into v_assignment
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

  select *
  into v_submission
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

  select dp.scope_type, dp.scope_id
  into v_matched_scope_type, v_matched_scope_id
  from public.delegated_permissions dp
  where dp.id = v_matched_permission_id;

  update public.assignment_submissions s
  set
    feedback = public.m69_4_normalize_text(
      p_feedback, 'Feedback', false, 4000
    ),
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

  return v_submission;
end;
$$;

alter function public.review_assignment_submission_secure(
  uuid, uuid, uuid, timestamptz, numeric, text
) owner to postgres;
alter function public.review_delegated_assignment_submission(
  uuid, uuid, uuid, timestamptz, numeric, text
) owner to postgres;

revoke all on function public.review_assignment_submission_secure(
  uuid, uuid, uuid, timestamptz, numeric, text
) from public, anon, service_role;
revoke all on function public.review_delegated_assignment_submission(
  uuid, uuid, uuid, timestamptz, numeric, text
) from public, anon, service_role;
grant execute on function public.review_assignment_submission_secure(
  uuid, uuid, uuid, timestamptz, numeric, text
) to authenticated;
grant execute on function public.review_delegated_assignment_submission(
  uuid, uuid, uuid, timestamptz, numeric, text
) to authenticated;

do $$
begin
  if pg_catalog.to_regprocedure(
       'public.review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)'
     ) is not null then
    revoke all on function public.review_assignment_submission_secure(
      uuid, uuid, uuid, numeric, text
    ) from public, anon, authenticated, service_role;
  end if;

  if pg_catalog.to_regprocedure(
       'public.review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)'
     ) is not null then
    revoke all on function public.review_delegated_assignment_submission(
      uuid, uuid, uuid, numeric, text
    ) from public, anon, authenticated, service_role;
  end if;
end;
$$;

drop function if exists public.review_assignment_submission_secure(
  uuid, uuid, uuid, numeric, text
);
drop function if exists public.review_delegated_assignment_submission(
  uuid, uuid, uuid, numeric, text
);

comment on function public.review_assignment_submission_secure(
  uuid, uuid, uuid, timestamptz, numeric, text
) is 'UX-6D1 assignment review RPC requiring the exact loaded submission revision.';
comment on function public.review_delegated_assignment_submission(
  uuid, uuid, uuid, timestamptz, numeric, text
) is 'UX-6D1 delegated assignment review RPC requiring the exact loaded submission revision.';

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this query after applying the executable migration. It inspects metadata
and normalized function definitions without invoking review RPCs.

with
expected_functions(identity, function_name) as (
  values
    (
      'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)',
      'review_assignment_submission_secure'
    ),
    (
      'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)',
      'review_delegated_assignment_submission'
    )
),
function_state as (
  select
    ef.identity,
    ef.function_name,
    p.oid,
    p.oid is not null as installed,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.pronargdefaults as default_argument_count,
    pg_catalog.pg_get_function_arguments(p.oid) as arguments,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
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
    ), '[]'::jsonb) as acl
  from expected_functions ef
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(ef.identity)
),
function_signals as (
  select
    identity,
    installed,
    owner,
    security_definer,
    default_argument_count,
    arguments,
    identity_arguments,
    configuration,
    acl,
    definition like '%p_expected_submission_updated_at timestamp with time zone%'
      as required_revision_argument,
    definition like '%if p_expected_submission_updated_at is null then%'
      as explicit_null_rejection,
    definition like '%from public.assignments a%for update;%from public.assignment_submissions s%for update;%'
      as assignment_then_submission_lock_order,
    position(
      'v_submission.updated_at is distinct from p_expected_submission_updated_at'
      in definition
    ) > position('from public.assignment_submissions s' in definition)
      as comparison_after_submission_lookup,
    position(
      'v_submission.updated_at is distinct from p_expected_submission_updated_at'
      in definition
    ) < position('update public.assignment_submissions s' in definition)
      as comparison_before_review_update,
    case
      when function_name = 'review_assignment_submission_secure' then
        position(
          'v_submission.updated_at is distinct from p_expected_submission_updated_at'
          in definition
        ) < position('perform public.m69_4_write_audit' in definition)
      else
        position(
          'v_submission.updated_at is distinct from p_expected_submission_updated_at'
          in definition
        ) < position('perform public.log_delegated_permission_used' in definition)
    end as comparison_before_success_side_effect,
    definition like '%using errcode = ''p0001'', detail = ''assignment_submission_stale''%'
      as deterministic_stale_contract,
    definition like '%status not in (''published'', ''closed'')%'
      as lifecycle_preserved,
    definition like '%m69_4_assert_student_in_tenant%'
      as student_tenant_check_preserved,
    case
      when function_name = 'review_assignment_submission_secure' then
        definition like '%m69_4_assert_review_assignment%'
      else
        definition like '%find_active_delegated_permission_for_action%'
        and definition like '%array[''review_assignments'']%'
    end as authorization_preserved,
    definition like '%m69_4_validate_score%'
      as score_validation_preserved,
    definition like '%reviewed_at = now()%'
      and definition like '%reviewed_by =%'
      and definition like '%status = ''reviewed''%'
      as review_update_preserved
  from function_state
),
overload_state as (
  select
    count(*) filter (
      where p.oid in (
        pg_catalog.to_regprocedure(
          'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'
        )::oid,
        pg_catalog.to_regprocedure(
          'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'
        )::oid
      )
    )::bigint as safe_overload_count,
    count(*) filter (
      where p.oid in (
        pg_catalog.to_regprocedure(
          'public.review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)'
        )::oid,
        pg_catalog.to_regprocedure(
          'public.review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)'
        )::oid
      )
    )::bigint as old_unsafe_overload_count,
    count(*)::bigint as total_review_overload_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'review_assignment_submission_secure',
      'review_delegated_assignment_submission'
    )
),
direct_acl_state as (
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
  ) acl_rows
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
    tablename,
    policyname,
    cmd,
    roles
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in ('assignments', 'assignment_submissions')
),
browser_write_grants as (
  select count(*)::bigint as grant_count
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('assignments', 'assignment_submissions')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
    and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
),
browser_dangerous_grants as (
  select count(*)::bigint as grant_count
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in ('assignments', 'assignment_submissions')
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
    and tp.privilege_type in (
      'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
    )
),
verification as (
  select
    (select bool_and(
      installed
      and owner = 'postgres'
      and security_definer
      and default_argument_count = 2
      and configuration @> array['search_path=public, pg_temp']
      and required_revision_argument
      and explicit_null_rejection
      and assignment_then_submission_lock_order
      and comparison_after_submission_lookup
      and comparison_before_review_update
      and comparison_before_success_side_effect
      and deterministic_stale_contract
      and lifecycle_preserved
      and student_tenant_check_preserved
      and authorization_preserved
      and score_validation_preserved
      and review_update_preserved
    ) from function_signals) as function_contract_ok,
    (select safe_overload_count = 2
      and old_unsafe_overload_count = 0
      and total_review_overload_count = 2
      from overload_state) as overload_contract_ok,
    (select authenticated_execute_grants = 2
      and unintended_execute_grants = 0
      from direct_acl_state) as acl_contract_ok,
    (select count(*) = 2 and bool_and(rls_enabled)
      from table_security) as rls_contract_ok,
    (select grant_count = 0 from browser_write_grants) as browser_write_contract_ok,
    (select grant_count = 0 from browser_dangerous_grants)
      as browser_dangerous_contract_ok
)
select jsonb_build_object(
  'functions', coalesce((
    select jsonb_agg(to_jsonb(function_signals) order by identity)
    from function_signals
  ), '[]'::jsonb),
  'overloads', (select to_jsonb(overload_state) from overload_state),
  'direct_acl', (select to_jsonb(direct_acl_state) from direct_acl_state),
  'table_security', coalesce((
    select jsonb_agg(to_jsonb(table_security) order by table_name)
    from table_security
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(to_jsonb(policy_state) order by tablename, policyname)
    from policy_state
  ), '[]'::jsonb),
  'browser_write_grants', (select grant_count from browser_write_grants),
  'browser_dangerous_grants', (select grant_count from browser_dangerous_grants),
  'security_gate', (
    select function_contract_ok
      and overload_contract_ok
      and acl_contract_ok
      and rls_contract_ok
      and browser_write_contract_ok
      and browser_dangerous_contract_ok
    from verification
  )
);
*/
