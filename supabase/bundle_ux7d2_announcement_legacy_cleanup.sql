/*
PRE-APPLY READ-ONLY VERIFICATION

Run this single query in Supabase SQL Editor before applying the executable
transaction. It reads catalog and aggregate security metadata only.

with legacy_identities(identity) as (
  values
    ('public.get_student_announcements()'),
    ('public.get_team_announcements(uuid)'),
    ('public.create_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.update_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.publish_academy_announcement(uuid)'),
    ('public.archive_academy_announcement(uuid)')
), v2_identities(identity) as (
  values
    ('public.get_student_announcements_v2(integer,timestamp with time zone,uuid)'),
    ('public.get_student_announcement_v2(uuid)'),
    ('public.get_team_announcements_v2(uuid,text,text,integer,timestamp with time zone,uuid)'),
    ('public.get_team_announcement_v2(uuid,uuid)'),
    ('public.create_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.update_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.publish_academy_announcement_v2(uuid)'),
    ('public.archive_academy_announcement_v2(uuid)'),
    ('public.delete_draft_academy_announcement_v2(uuid)')
), legacy_state as (
  select
    li.identity,
    p.oid is not null as installed,
    case when p.oid is null then null else pg_catalog.pg_get_userbyid(p.proowner) end as owner,
    coalesce(pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
      as authenticated_execute,
    coalesce(pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), false)
      as anon_execute,
    coalesce(pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'), false)
      as service_execute,
    coalesce((
      select count(*)
      from pg_catalog.pg_depend d
      where d.refobjid = p.oid
        and d.deptype in ('a', 'n')
    ), 0) as dependent_objects
  from legacy_identities li
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(li.identity)
), v2_state as (
  select
    vi.identity,
    p.oid is not null as installed,
    coalesce(pg_catalog.pg_get_userbyid(p.proowner) = 'postgres', false) as postgres_owned,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(p.proconfig @> array['search_path=public, pg_temp'], false) as safe_search_path,
    coalesce(pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
      as authenticated_execute,
    coalesce(pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), false)
      as anon_execute,
    coalesce(pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'), false)
      as service_execute,
    coalesce(not exists (
      select 1
      from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where acl.grantee = 0 and upper(acl.privilege_type) = 'EXECUTE'
    ), false) as public_execute_revoked
  from v2_identities vi
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(vi.identity)
), private_authorization as (
  select jsonb_build_object(
    'installed', p.oid is not null,
    'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'security_definer', p.prosecdef,
    'search_path', p.proconfig,
    'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
    'service_execute', pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'),
    'legacy_staff_branch_present', lower(pg_catalog.pg_get_functiondef(p.oid))
      like '%if p_legacy_staff_compat then%v_role = ''staff''%'
  ) as value
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure(
    'coachfort_internal.announcement_authorization_context(uuid,text,uuid,uuid,boolean)'
  )
), browser_table_grants as (
  select jsonb_build_object(
    'academy_announcements_writes', count(*) filter (
      where c.oid = 'public.academy_announcements'::regclass
    ),
    'notifications_writes', count(*) filter (
      where c.oid = 'public.notifications'::regclass
    )
  ) as value
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) acl
  where c.oid in ('public.academy_announcements'::regclass, 'public.notifications'::regclass)
    and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
    and upper(acl.privilege_type) in (
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
    )
), notification_contract as (
  select jsonb_build_object(
    'announcement_notice_supported', exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid = 'public.notifications'::regclass
        and con.conname = 'notifications_type_check'
        and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%announcement_notice%'
    ),
    'event_key_unique', exists (
      select 1 from pg_catalog.pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'notifications'
        and i.indexname = 'notifications_tenant_user_event_key_uidx'
        and lower(i.indexdef) like '%unique%tenant_id, user_id, event_key%'
    ),
    'duplicate_announcement_event_keys', (
      select count(*) from (
        select tenant_id, user_id, event_key
        from public.notifications
        where entity_type = 'announcement' and event_key is not null
        group by tenant_id, user_id, event_key
        having count(*) > 1
      ) duplicate_keys
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
)
select jsonb_build_object(
  'legacy_functions', (select jsonb_agg(to_jsonb(legacy_state) order by identity) from legacy_state),
  'v2_functions', (select jsonb_agg(to_jsonb(v2_state) order by identity) from v2_state),
  'private_authorization', (select value from private_authorization),
  'browser_table_grants', (select value from browser_table_grants),
  'notification_contract', (select value from notification_contract),
  'baseline_groups', (select value from baseline_groups)
) as ux7d2_pre_apply;
*/

begin;

do $$
declare
  v_missing text;
  v_unexpected_v2_acl text;
  v_authorization_source text;
begin
  select string_agg(expected.identity, ', ' order by expected.identity)
  into v_missing
  from (values
    ('public.get_student_announcements()'),
    ('public.get_team_announcements(uuid)'),
    ('public.create_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.update_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.publish_academy_announcement(uuid)'),
    ('public.archive_academy_announcement(uuid)')
  ) expected(identity)
  where pg_catalog.to_regprocedure(expected.identity) is null;

  if v_missing is not null then
    raise exception 'UX-7D2 prerequisite failed: legacy RPC drift: %.', v_missing
      using errcode = '55000';
  end if;

  select string_agg(expected.identity, ', ' order by expected.identity)
  into v_missing
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
    raise exception 'UX-7D2 prerequisite failed: canonical V2 RPC drift: %.', v_missing
      using errcode = '55000';
  end if;

  select string_agg(expected.identity, ', ' order by expected.identity)
  into v_unexpected_v2_acl
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
  join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected.identity)
  where not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
       where acl.grantee = 0 and upper(acl.privilege_type) = 'EXECUTE'
     );

  if v_unexpected_v2_acl is not null then
    raise exception 'UX-7D2 prerequisite failed: canonical V2 RPC ACL drift: %.', v_unexpected_v2_acl
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(
      'coachfort_internal.announcement_authorization_context(uuid,text,uuid,uuid,boolean)'
    )
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 's'
      and p.proconfig @> array['search_path=public, pg_temp']
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where acl.grantee = 0 and upper(acl.privilege_type) = 'EXECUTE'
      )
  ) then
    raise exception 'UX-7D2 prerequisite failed: private authorization helper drift.'
      using errcode = '55000';
  end if;

  select lower(pg_catalog.pg_get_functiondef(
    'coachfort_internal.announcement_authorization_context(uuid,text,uuid,uuid,boolean)'::regprocedure
  )) into v_authorization_source;

  if v_authorization_source not like '%if p_legacy_staff_compat then%'
     or v_authorization_source not like '%v_role = ''staff'' and p_audience_type = ''tenant''%' then
    raise exception 'UX-7D2 prerequisite failed: reviewed legacy Staff branch drift.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid in ('public.academy_announcements'::regclass, 'public.notifications'::regclass)
      and not c.relrowsecurity
  ) then
    raise exception 'UX-7D2 prerequisite failed: protected-table RLS drift.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid in ('public.academy_announcements'::regclass, 'public.notifications'::regclass)
      and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
      and upper(acl.privilege_type) in (
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
      )
  ) then
    raise exception 'UX-7D2 prerequisite failed: browser table-write grant drift.'
      using errcode = '55000';
  end if;

  if (select count(*) from (values
    ('public.get_student_community_posts()'), ('public.get_student_community_comments(uuid)'),
    ('public.create_student_community_comment(uuid,text)'), ('public.get_team_community_posts(uuid)'),
    ('public.get_team_community_comments(uuid)'), ('public.create_team_community_post(uuid,text,text,text)'),
    ('public.update_team_community_post(uuid,text,text,text)'), ('public.publish_community_post(uuid)'),
    ('public.archive_community_post(uuid)'), ('public.hide_community_post(uuid)'),
    ('public.create_team_community_comment(uuid,text)'), ('public.hide_community_comment(uuid)')
  ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null) <> 12 then
    raise exception 'UX-7D2 prerequisite failed: Community contract drift.' using errcode = '55000';
  end if;

  if (select count(*) from (values
    ('public.get_team_chat_threads(uuid)'), ('public.get_team_chat_thread(uuid)'),
    ('public.get_student_chat_threads()'), ('public.get_student_chat_thread(uuid)'),
    ('public.add_default_team_chat_participants(uuid,uuid,uuid,uuid)'),
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'), ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)'), ('public.close_chat_thread(uuid)'),
    ('public.mark_chat_thread_read(uuid)')
  ) expected(identity) where pg_catalog.to_regprocedure(identity) is not null) <> 11 then
    raise exception 'UX-7D2 prerequisite failed: Academy Chat contract drift.' using errcode = '55000';
  end if;
end;
$$;

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

  -- The cutover-only Staff path is permanently fail-closed.
  if p_legacy_staff_compat then
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

alter function coachfort_internal.announcement_authorization_context(uuid, text, uuid, uuid, boolean)
  owner to postgres;
revoke all on function coachfort_internal.announcement_authorization_context(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

revoke all on function public.get_student_announcements()
  from public, anon, authenticated, service_role;
revoke all on function public.get_team_announcements(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_academy_announcement(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.update_academy_announcement(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_academy_announcement(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.archive_academy_announcement(uuid)
  from public, anon, authenticated, service_role;

drop function public.get_student_announcements();
drop function public.get_team_announcements(uuid);
drop function public.create_academy_announcement(uuid, text, text, timestamptz);
drop function public.update_academy_announcement(uuid, text, text, timestamptz);
drop function public.publish_academy_announcement(uuid);
drop function public.archive_academy_announcement(uuid);

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this single query after applying. It returns one compact JSON result and
does not expose announcement content or Student identity data.

with legacy_identities(identity) as (
  values
    ('public.get_student_announcements()'),
    ('public.get_team_announcements(uuid)'),
    ('public.create_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.update_academy_announcement(uuid,text,text,timestamp with time zone)'),
    ('public.publish_academy_announcement(uuid)'),
    ('public.archive_academy_announcement(uuid)')
), v2_identities(identity) as (
  values
    ('public.get_student_announcements_v2(integer,timestamp with time zone,uuid)'),
    ('public.get_student_announcement_v2(uuid)'),
    ('public.get_team_announcements_v2(uuid,text,text,integer,timestamp with time zone,uuid)'),
    ('public.get_team_announcement_v2(uuid,uuid)'),
    ('public.create_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.update_academy_announcement_v2(uuid,text,text,timestamp with time zone,text,uuid,uuid)'),
    ('public.publish_academy_announcement_v2(uuid)'),
    ('public.archive_academy_announcement_v2(uuid)'),
    ('public.delete_draft_academy_announcement_v2(uuid)')
), v2_contract as (
  select
    vi.identity,
    p.oid is not null as installed,
    coalesce(pg_catalog.pg_get_userbyid(p.proowner) = 'postgres', false) as postgres_owned,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(p.proconfig @> array['search_path=public, pg_temp'], false) as safe_search_path,
    coalesce(pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
      as authenticated_execute,
    coalesce(pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), false)
      as anon_execute,
    coalesce(pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'), false)
      as service_execute,
    coalesce(not exists (
      select 1
      from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where acl.grantee = 0 and upper(acl.privilege_type) = 'EXECUTE'
    ), false) as public_execute_revoked,
    lower(regexp_replace(coalesce(pg_catalog.pg_get_functiondef(p.oid), ''), E'\\s+', ' ', 'g'))
      as source
  from v2_identities vi
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(vi.identity)
), legacy_contract as (
  select
    li.identity,
    pg_catalog.to_regprocedure(li.identity) is not null as installed
  from legacy_identities li
), private_contract as (
  select
    p.oid is not null as installed,
    coalesce(pg_catalog.pg_get_userbyid(p.proowner) = 'postgres', false) as postgres_owned,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(p.provolatile = 's', false) as stable,
    coalesce(p.proconfig @> array['search_path=public, pg_temp'], false) as safe_search_path,
    coalesce(pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
      as authenticated_execute,
    coalesce(pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), false)
      as anon_execute,
    coalesce(pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'), false)
      as service_execute,
    coalesce(not exists (
      select 1
      from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where acl.grantee = 0 and upper(acl.privilege_type) = 'EXECUTE'
    ), false) as public_execute_revoked,
    lower(regexp_replace(coalesce(pg_catalog.pg_get_functiondef(p.oid), ''), E'\\s+', ' ', 'g'))
      as source
  from (values (
    pg_catalog.to_regprocedure(
      'coachfort_internal.announcement_authorization_context(uuid,text,uuid,uuid,boolean)'
    )
  )) expected(oid)
  left join pg_catalog.pg_proc p on p.oid = expected.oid
), table_contract as (
  select jsonb_build_object(
    'academy_announcements_rls', bool_and(c.relrowsecurity) filter (
      where c.oid = 'public.academy_announcements'::regclass
    ),
    'notifications_rls', bool_and(c.relrowsecurity) filter (
      where c.oid = 'public.notifications'::regclass
    ),
    'academy_announcements_browser_writes', count(*) filter (
      where c.oid = 'public.academy_announcements'::regclass
        and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
        and upper(acl.privilege_type) in (
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
        )
    ),
    'notifications_browser_writes', count(*) filter (
      where c.oid = 'public.notifications'::regclass
        and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
        and upper(acl.privilege_type) in (
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
        )
    )
  ) as value
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) acl
  where c.oid in ('public.academy_announcements'::regclass, 'public.notifications'::regclass)
), source_contract as (
  select jsonb_build_object(
    'student_v2_bounded', exists (
      select 1 from v2_contract
      where identity like '%get_student_announcements_v2%'
        and source like '%p_limit > 50%'
        and source like '%student_can_read_announcement%'
    ),
    'student_v2_detail_authoritative', exists (
      select 1 from v2_contract
      where identity like '%get_student_announcement_v2%'
        and source like '%student_can_read_announcement%'
    ),
    'coach_v2_bounded', exists (
      select 1 from v2_contract
      where identity like '%get_team_announcements_v2%'
        and source like '%p_limit > 50%'
        and source like '%announcement_authorization_context%false%'
    ),
    'coach_v2_detail_authoritative', exists (
      select 1 from v2_contract
      where identity like '%get_team_announcement_v2%'
        and source like '%announcement_authorization_context%false%'
    ),
    'legacy_staff_fail_closed', exists (
      select 1 from private_contract
      where source like '%if p_legacy_staff_compat then return;%'
        and regexp_count(
          source,
          'v_role = ''staff'' and p_audience_type = ''tenant'''
        ) = 1
    ),
    'delegation_model_retained', exists (
      select 1 from private_contract
      where source like '%find_active_delegated_permission_for_action%'
        and source like '%manage_messages%'
        and source like '%ux4b_trainer_can_manage_course%'
        and source like '%ux4b_trainer_can_manage_cohort%'
    )
  ) as value
), notification_contract as (
  select jsonb_build_object(
    'announcement_notice_supported', exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid = 'public.notifications'::regclass
        and con.conname = 'notifications_type_check'
        and lower(pg_catalog.pg_get_constraintdef(con.oid, true)) like '%announcement_notice%'
    ),
    'event_key_unique', exists (
      select 1 from pg_catalog.pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'notifications'
        and i.indexname = 'notifications_tenant_user_event_key_uidx'
        and lower(i.indexdef) like '%unique%tenant_id, user_id, event_key%'
    ),
    'atomic_publish_intact', lower(pg_catalog.pg_get_functiondef(
      'coachfort_internal.publish_announcement(uuid,boolean)'::regprocedure
    )) like '%insert into public.notifications%on conflict (tenant_id, user_id, event_key)%',
    'duplicate_announcement_event_keys', (
      select count(*) from (
        select tenant_id, user_id, event_key
        from public.notifications
        where entity_type = 'announcement' and event_key is not null
        group by tenant_id, user_id, event_key
        having count(*) > 1
      ) duplicate_keys
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
    (select count(*) = 9 and bool_and(
      installed and postgres_owned and security_definer and safe_search_path
      and authenticated_execute and not anon_execute and not service_execute
      and public_execute_revoked
    ) from v2_contract)
    and (select count(*) = 6 and bool_and(not installed) from legacy_contract)
    and (select installed and postgres_owned and security_definer and stable
      and safe_search_path and not authenticated_execute and not anon_execute
      and not service_execute and public_execute_revoked from private_contract)
    and (select bool_and(value::text not like '%false%') from source_contract)
    and (select (value->>'academy_announcements_rls')::boolean
      and (value->>'notifications_rls')::boolean
      and (value->>'academy_announcements_browser_writes')::integer = 0
      and (value->>'notifications_browser_writes')::integer = 0 from table_contract)
    and (select (value->>'announcement_notice_supported')::boolean
      and (value->>'event_key_unique')::boolean
      and (value->>'atomic_publish_intact')::boolean
      and (value->>'duplicate_announcement_event_keys')::integer = 0 from notification_contract)
    and (select (value->>'community')::integer = 12
      and (value->>'academy_chat')::integer = 11 from baseline_groups)
      as security_gate
)
select jsonb_build_object(
  'security_gate', (select security_gate from gates),
  'legacy_functions', (select jsonb_agg(to_jsonb(legacy_contract) order by identity) from legacy_contract),
  'v2_functions', (select jsonb_agg(to_jsonb(v2_contract) - 'source' order by identity) from v2_contract),
  'private_authorization', (select to_jsonb(private_contract) - 'source' from private_contract),
  'source_contract', (select value from source_contract),
  'table_contract', (select value from table_contract),
  'notification_contract', (select value from notification_contract),
  'baseline_groups', (select value from baseline_groups)
) as ux7d2_post_apply;
*/
