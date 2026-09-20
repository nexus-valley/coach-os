-- Bundle VIDEO-2C0: secure native-video playback authorization authority.
--
-- This bundle creates only the trusted database authorization boundary needed by
-- a future server playback route. It does not mint playback tokens, contact a
-- provider, change video rows, or expose protected video tables to browser roles.

-- ---------------------------------------------------------------------------
-- PRE-APPLY READ-ONLY VERIFICATION
-- ---------------------------------------------------------------------------

with
expected_columns(table_name, column_name) as (
  values
    ('courses', 'id'),
    ('courses', 'tenant_id'),
    ('courses', 'status'),
    ('lessons', 'id'),
    ('lessons', 'tenant_id'),
    ('lessons', 'course_id'),
    ('tenant_members', 'tenant_id'),
    ('tenant_members', 'user_id'),
    ('tenant_members', 'role'),
    ('trainer_course_assignments', 'tenant_id'),
    ('trainer_course_assignments', 'trainer_user_id'),
    ('trainer_course_assignments', 'course_id'),
    ('students', 'id'),
    ('students', 'tenant_id'),
    ('students', 'status'),
    ('students', 'portal_enabled'),
    ('student_portal_accounts', 'tenant_id'),
    ('student_portal_accounts', 'student_id'),
    ('student_portal_accounts', 'user_id'),
    ('student_portal_accounts', 'status'),
    ('enrollments', 'tenant_id'),
    ('enrollments', 'student_id'),
    ('enrollments', 'course_id'),
    ('enrollments', 'status'),
    ('video_asset_attachments', 'tenant_id'),
    ('video_asset_attachments', 'video_asset_id'),
    ('video_asset_attachments', 'lesson_id'),
    ('video_assets', 'id'),
    ('video_assets', 'tenant_id'),
    ('video_assets', 'provider'),
    ('video_assets', 'provider_asset_id'),
    ('video_assets', 'status'),
    ('video_assets', 'duration_seconds'),
    ('video_assets', 'provider_deleted_at')
),
column_state as (
  select
    count(*) = (select count(*) from expected_columns) required_columns_present,
    coalesce(jsonb_agg(jsonb_build_object(
      'table', expected.table_name,
      'column', expected.column_name,
      'installed', column_def.column_name is not null
    ) order by expected.table_name, expected.column_name), '[]'::jsonb) inventory
  from expected_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
),
expected_helpers(identity, expected_source_md5, expected_search_path,
                 authenticated_execute) as (
  values
    ('coachfort_internal.tenant_operational_access_allowed(uuid)',
      '402306364425f9def3123c8961834681', 'search_path=public, pg_temp', true),
    ('coachfort_internal.operational_current_team_role(uuid,uuid)',
      '7f31929d1939c1f23c1f9fafa334c78c', 'search_path=public, pg_temp', false),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)',
      '8b31631eb6fb665efdd1854a027d9d2f', 'search_path=public, pg_temp', false),
    ('coachfort_internal.assert_effective_operational_feature(uuid,text)',
      'd3a35f18230c4c9062bf5bb502c0f027', 'search_path=public, pg_temp', false),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)',
      '2315893019e05e68bd8fcdfd16f26c5f', 'search_path=public', false)
),
helper_state as (
  select
    count(procedure.oid) = (select count(*) from expected_helpers) helpers_present,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and coalesce(procedure.proconfig, array[]::text[])
        @> array[expected.expected_search_path]
      and md5(regexp_replace(
        procedure.prosrc, '[[:space:]]+', '', 'g'
      )) = expected.expected_source_md5
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ) = expected.authenticated_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false) exact_helper_contract,
    coalesce(jsonb_agg(jsonb_build_object(
      'identity', expected.identity,
      'installed', procedure.oid is not null,
      'owner', pg_get_userbyid(procedure.proowner),
      'security_definer', procedure.prosecdef,
      'volatility', procedure.provolatile,
      'config', procedure.proconfig,
      'acl', procedure.proacl,
      'normalized_prosrc_md5', case when procedure.oid is null then null else
        md5(regexp_replace(procedure.prosrc, '[[:space:]]+', '', 'g')) end,
      'expected_normalized_prosrc_md5', expected.expected_source_md5
    ) order by expected.identity), '[]'::jsonb) fingerprints
  from expected_helpers expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
attachment_contract as (
  select
    count(*) filter (
      where constraint_row.conname = 'video_asset_attachments_asset_fk'
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = to_regclass('public.video_assets')
        and constraint_row.confdeltype = 'r'
    ) = 1 tenant_asset_fk,
    count(*) filter (
      where constraint_row.conname = 'video_asset_attachments_lesson_fk'
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = to_regclass('public.lessons')
        and constraint_row.confdeltype = 'c'
    ) = 1 tenant_lesson_fk,
    count(*) filter (
      where constraint_row.conname = 'video_asset_attachments_lesson_key'
        and constraint_row.contype = 'u'
    ) = 1 one_attachment_per_lesson
  from pg_constraint constraint_row
  where constraint_row.conrelid = to_regclass('public.video_asset_attachments')
),
asset_contract as (
  select
    count(*) filter (
      where constraint_row.conname = 'video_assets_status_check'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%upload_pending%processing%ready%failed%delete_pending%deleted%'
    ) = 1 exact_status_domain,
    count(*) filter (
      where constraint_row.conname = 'video_assets_provider_check'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%cloudflare_stream%mux%'
    ) = 1 provider_domain,
    count(*) filter (
      where constraint_row.conname = 'video_assets_ready_identity_check'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%status <> ''ready''%provider_asset_id is not null%duration_seconds is not null%'
    ) = 1 ready_identity_required,
    count(*) filter (
      where constraint_row.conname = 'video_assets_provider_asset_id_check'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%provider_asset_idisnull%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%char_length(provider_asset_id)>=1%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%char_length(provider_asset_id)<=255%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%provider_asset_id!~''[[:space:][:cntrl:]]''%'
    ) = 1 provider_identity_bounded,
    count(*) filter (
      where constraint_row.conname = 'video_assets_duration_check'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%duration_secondsisnull%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%duration_seconds>=1%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%duration_seconds<=7200%'
    ) = 1 duration_bounded
  from pg_constraint constraint_row
  where constraint_row.conrelid = to_regclass('public.video_assets')
),
protected_relation_state as (
  select
    count(relation.oid) = 3 protected_tables_present,
    coalesce(bool_and(relation.relrowsecurity), false) rls_enabled,
    coalesce(bool_and(pg_get_userbyid(relation.relowner) = 'postgres'), false)
      postgres_owned
  from (values
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events')
  ) expected(identity)
  left join pg_class relation on relation.oid = to_regclass(expected.identity)
),
protected_acl as (
  select
    not exists (
      select 1
      from (values
        ('public.video_assets'),
        ('public.video_asset_attachments'),
        ('public.video_provider_events')
      ) protected(identity)
      cross join (values ('anon'),('authenticated'),('service_role')) actor(role_name)
      cross join (values
        ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
        ('TRUNCATE'),('REFERENCES'),('TRIGGER')
      ) privilege(privilege_name)
      where has_table_privilege(
        actor.role_name, protected.identity, privilege.privilege_name
      )
    ) effective_role_access_absent,
    not exists (
      select 1
      from (values
        ('public.video_assets'),
        ('public.video_asset_attachments'),
        ('public.video_provider_events')
      ) protected(identity)
      join pg_class relation on relation.oid = to_regclass(protected.identity)
      cross join lateral aclexplode(coalesce(
        relation.relacl, acldefault('r', relation.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in (
          'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
        )
    ) public_access_absent
),
target_state as (
  select
    to_regprocedure(
      'public.authorize_native_video_playback_server(uuid,uuid,uuid)'
    ) is null exact_target_absent,
    not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'authorize_native_video_playback_server'
    ) no_target_overload
),
entitlement_state as (
  select
    'native_video' = any(public.subscription_entitlements_feature_keys())
      native_video_registered
),
protected_data as (
  select jsonb_build_object(
    'video_assets', (select count(*) from public.video_assets),
    'video_asset_attachments', (select count(*) from public.video_asset_attachments),
    'video_provider_events', (select count(*) from public.video_provider_events),
    'video_assets_fingerprint', (select md5(coalesce(
      jsonb_agg(to_jsonb(asset) order by asset.id)::text, '[]'
    )) from public.video_assets asset),
    'attachment_fingerprint', (select md5(coalesce(
      jsonb_agg(to_jsonb(attachment) order by attachment.id)::text, '[]'
    )) from public.video_asset_attachments attachment),
    'provider_event_fingerprint', (select md5(coalesce(
      jsonb_agg(to_jsonb(event_row) order by event_row.id)::text, '[]'
    )) from public.video_provider_events event_row)
  ) inventory
)
select
  column_state.inventory required_columns,
  helper_state.fingerprints authority_helper_fingerprints,
  protected_data.inventory protected_video_data,
  column_state.required_columns_present,
  helper_state.helpers_present,
  helper_state.exact_helper_contract,
  attachment_contract.tenant_asset_fk,
  attachment_contract.tenant_lesson_fk,
  attachment_contract.one_attachment_per_lesson,
  asset_contract.exact_status_domain,
  asset_contract.provider_domain,
  asset_contract.ready_identity_required,
  asset_contract.provider_identity_bounded,
  asset_contract.duration_bounded,
  protected_relation_state.protected_tables_present,
  protected_relation_state.rls_enabled,
  protected_relation_state.postgres_owned,
  protected_acl.effective_role_access_absent,
  protected_acl.public_access_absent,
  entitlement_state.native_video_registered,
  target_state.exact_target_absent,
  target_state.no_target_overload,
  column_state.required_columns_present
    and helper_state.helpers_present
    and helper_state.exact_helper_contract
    and attachment_contract.tenant_asset_fk
    and attachment_contract.tenant_lesson_fk
    and attachment_contract.one_attachment_per_lesson
    and asset_contract.exact_status_domain
    and asset_contract.provider_domain
    and asset_contract.ready_identity_required
    and asset_contract.provider_identity_bounded
    and asset_contract.duration_bounded
    and protected_relation_state.protected_tables_present
    and protected_relation_state.rls_enabled
    and protected_relation_state.postgres_owned
    and protected_acl.effective_role_access_absent
    and protected_acl.public_access_absent
    and entitlement_state.native_video_registered
    and target_state.exact_target_absent
    and target_state.no_target_overload
    as ready_for_apply
from column_state
cross join helper_state
cross join attachment_contract
cross join asset_contract
cross join protected_relation_state
cross join protected_acl
cross join entitlement_state
cross join target_state
cross join protected_data;

-- ---------------------------------------------------------------------------
-- APPLY (TRANSACTIONAL; DO NOT RUN AS PART OF REVIEW)
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_required_column_count integer;
  v_installed_column_count integer;
  v_helper_count integer;
  v_helper_contract boolean;
begin
  if to_regprocedure(
       'public.authorize_native_video_playback_server(uuid,uuid,uuid)'
     ) is not null
     or exists (
       select 1
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname = 'authorize_native_video_playback_server'
     ) then
    raise exception 'VIDEO-2C0 target authority already exists.'
      using errcode = '55000';
  end if;

  with expected(table_name, column_name) as (
    values
      ('courses','id'),('courses','tenant_id'),('courses','status'),
      ('lessons','id'),('lessons','tenant_id'),('lessons','course_id'),
      ('tenant_members','tenant_id'),('tenant_members','user_id'),
      ('tenant_members','role'),
      ('trainer_course_assignments','tenant_id'),
      ('trainer_course_assignments','trainer_user_id'),
      ('trainer_course_assignments','course_id'),
      ('students','id'),('students','tenant_id'),('students','status'),
      ('students','portal_enabled'),
      ('student_portal_accounts','tenant_id'),
      ('student_portal_accounts','student_id'),
      ('student_portal_accounts','user_id'),
      ('student_portal_accounts','status'),
      ('enrollments','tenant_id'),('enrollments','student_id'),
      ('enrollments','course_id'),('enrollments','status'),
      ('video_asset_attachments','tenant_id'),
      ('video_asset_attachments','video_asset_id'),
      ('video_asset_attachments','lesson_id'),
      ('video_assets','id'),('video_assets','tenant_id'),
      ('video_assets','provider'),('video_assets','provider_asset_id'),
      ('video_assets','status'),('video_assets','duration_seconds'),
      ('video_assets','provider_deleted_at')
  )
  select count(*), count(column_def.column_name)
  into v_required_column_count, v_installed_column_count
  from expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name;

  if v_required_column_count <> v_installed_column_count then
    raise exception 'VIDEO-2C0 required relation baseline is incomplete.'
      using errcode = '55000';
  end if;

  with expected(identity, expected_source_md5, expected_search_path,
                authenticated_execute) as (
    values
      ('coachfort_internal.tenant_operational_access_allowed(uuid)',
        '402306364425f9def3123c8961834681', 'search_path=public, pg_temp', true),
      ('coachfort_internal.operational_current_team_role(uuid,uuid)',
        '7f31929d1939c1f23c1f9fafa334c78c', 'search_path=public, pg_temp', false),
      ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)',
        '8b31631eb6fb665efdd1854a027d9d2f', 'search_path=public, pg_temp', false),
      ('coachfort_internal.assert_effective_operational_feature(uuid,text)',
        'd3a35f18230c4c9062bf5bb502c0f027', 'search_path=public, pg_temp', false),
      ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)',
        '2315893019e05e68bd8fcdfd16f26c5f', 'search_path=public', false)
  )
  select
    count(procedure.oid),
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and coalesce(procedure.proconfig, array[]::text[])
        @> array[expected.expected_search_path]
      and md5(regexp_replace(
        procedure.prosrc, '[[:space:]]+', '', 'g'
      )) = expected.expected_source_md5
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ) = expected.authenticated_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    ), false)
  into v_helper_count, v_helper_contract
  from expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if v_helper_count <> 5 or not v_helper_contract then
    raise exception 'VIDEO-2C0 reviewed authority helper baseline has drifted.'
      using errcode = '55000';
  end if;

  if not 'native_video' = any(public.subscription_entitlements_feature_keys()) then
    raise exception 'VIDEO-2C0 native-video entitlement is unavailable.'
      using errcode = '55000';
  end if;

  if (
    select count(relation.oid) <> 3
      or not coalesce(bool_and(relation.relrowsecurity), false)
      or not coalesce(bool_and(
        pg_get_userbyid(relation.relowner) = 'postgres'
      ), false)
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    left join pg_class relation on relation.oid = to_regclass(protected.identity)
  ) then
    raise exception 'VIDEO-2C0 protected video relation baseline has drifted.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid =
         to_regclass('public.video_asset_attachments')
         and constraint_row.conname = 'video_asset_attachments_asset_fk'
         and constraint_row.contype = 'f'
         and constraint_row.confrelid = to_regclass('public.video_assets')
         and constraint_row.confdeltype = 'r'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid =
         to_regclass('public.video_asset_attachments')
         and constraint_row.conname = 'video_asset_attachments_lesson_fk'
         and constraint_row.contype = 'f'
         and constraint_row.confrelid = to_regclass('public.lessons')
         and constraint_row.confdeltype = 'c'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid =
         to_regclass('public.video_asset_attachments')
         and constraint_row.conname = 'video_asset_attachments_lesson_key'
         and constraint_row.contype = 'u'
     ) then
    raise exception 'VIDEO-2C0 attachment authority baseline has drifted.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid = to_regclass('public.video_assets')
         and constraint_row.conname = 'video_assets_status_check'
         and lower(pg_get_constraintdef(constraint_row.oid)) like
           '%upload_pending%processing%ready%failed%delete_pending%deleted%'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid = to_regclass('public.video_assets')
         and constraint_row.conname = 'video_assets_provider_check'
         and lower(pg_get_constraintdef(constraint_row.oid)) like
           '%cloudflare_stream%mux%'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid = to_regclass('public.video_assets')
         and constraint_row.conname = 'video_assets_ready_identity_check'
         and lower(pg_get_constraintdef(constraint_row.oid)) like
           '%status <> ''ready''%provider_asset_id is not null%duration_seconds is not null%'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid = to_regclass('public.video_assets')
         and constraint_row.conname = 'video_assets_provider_asset_id_check'
         and regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]]+', '', 'g'
         ) like '%provider_asset_idisnull%'
         and regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]]+', '', 'g'
         ) like '%char_length(provider_asset_id)>=1%'
         and regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]]+', '', 'g'
         ) like '%char_length(provider_asset_id)<=255%'
         and regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]]+', '', 'g'
         ) like '%provider_asset_id!~''[[:space:][:cntrl:]]''%'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid = to_regclass('public.video_assets')
         and constraint_row.conname = 'video_assets_duration_check'
         and regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]]+', '', 'g'
         ) like '%duration_secondsisnull%'
         and regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]]+', '', 'g'
         ) like '%duration_seconds>=1%'
         and regexp_replace(
           lower(pg_get_constraintdef(constraint_row.oid)),
           '[[:space:]]+', '', 'g'
         ) like '%duration_seconds<=7200%'
     ) then
    raise exception 'VIDEO-2C0 playable asset baseline has drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    cross join (values ('anon'),('authenticated'),('service_role')) actor(role_name)
    cross join (values
      ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
      ('TRUNCATE'),('REFERENCES'),('TRIGGER')
    ) privilege(privilege_name)
    where has_table_privilege(
      actor.role_name, protected.identity, privilege.privilege_name
    )
  ) or exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    join pg_class relation on relation.oid = to_regclass(protected.identity)
    cross join lateral aclexplode(coalesce(
      relation.relacl, acldefault('r', relation.relowner)
    )) acl
    where acl.grantee = 0
      and acl.privilege_type in (
        'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
      )
  ) then
    raise exception 'VIDEO-2C0 protected video table ACL baseline has drifted.'
      using errcode = '55000';
  end if;
end;
$$;

create temporary table video2c0_apply_baseline on commit drop as
select
  (select count(*) from public.video_assets) video_asset_count,
  (select md5(coalesce(
    jsonb_agg(to_jsonb(asset) order by asset.id)::text, '[]'
  )) from public.video_assets asset) video_asset_fingerprint,
  (select count(*) from public.video_asset_attachments) attachment_count,
  (select md5(coalesce(
    jsonb_agg(to_jsonb(attachment) order by attachment.id)::text, '[]'
  )) from public.video_asset_attachments attachment) attachment_fingerprint,
  (select count(*) from public.video_provider_events) provider_event_count,
  (select md5(coalesce(
    jsonb_agg(to_jsonb(event_row) order by event_row.id)::text, '[]'
  )) from public.video_provider_events event_row) provider_event_fingerprint,
  (
    select jsonb_agg(jsonb_build_object(
      'identity', expected.identity,
      'owner', pg_get_userbyid(procedure.proowner),
      'acl', procedure.proacl,
      'security_definer', procedure.prosecdef,
      'volatility', procedure.provolatile,
      'config', procedure.proconfig,
      'normalized_prosrc_md5', md5(regexp_replace(
        procedure.prosrc, '[[:space:]]+', '', 'g'
      ))
    ) order by expected.identity)
    from (values
      ('coachfort_internal.tenant_operational_access_allowed(uuid)'),
      ('coachfort_internal.operational_current_team_role(uuid,uuid)'),
      ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'),
      ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
      ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)')
    ) expected(identity)
    join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  ) helper_contract,
  (
    select jsonb_agg(jsonb_build_object(
      'identity', protected.identity,
      'owner', pg_get_userbyid(relation.relowner),
      'rls', relation.relrowsecurity,
      'force_rls', relation.relforcerowsecurity,
      'acl', relation.relacl
    ) order by protected.identity)
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    join pg_class relation on relation.oid = to_regclass(protected.identity)
  ) protected_relation_contract;

create function public.authorize_native_video_playback_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lesson_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_course_id uuid;
  v_team_role text;
  v_student_id uuid;
  v_viewer_authorized boolean := false;
  v_attachment public.video_asset_attachments%rowtype;
  v_asset public.video_assets%rowtype;
begin
  if p_tenant_id is null or p_lesson_id is null then
    raise exception 'Native video playback input is invalid.'
      using errcode = '22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'Native video playback actor is required.'
      using errcode = '28000';
  end if;

  if not coachfort_internal.tenant_operational_access_allowed(p_tenant_id) then
    raise exception 'Native video playback lifecycle is unavailable.'
      using errcode = '42501';
  end if;

  begin
    perform coachfort_internal.assert_effective_operational_feature(
      p_tenant_id, 'native_video'
    );
  exception when sqlstate '42501' then
    raise exception 'Native video playback feature is unavailable.'
      using errcode = '42501';
  end;

  select lesson.course_id
  into v_course_id
  from public.lessons lesson
  join public.courses course
    on course.id = lesson.course_id
   and course.tenant_id = lesson.tenant_id
  where lesson.id = p_lesson_id
    and lesson.tenant_id = p_tenant_id;

  if not found then
    raise exception 'Native video lesson is unavailable.'
      using errcode = 'P0002';
  end if;

  v_team_role := coachfort_internal.operational_current_team_role(
    p_tenant_id, p_actor_user_id
  );

  if v_team_role in ('owner','admin','staff') then
    v_viewer_authorized := true;
  elsif v_team_role = 'trainer' then
    v_viewer_authorized := public.ux4b_trainer_can_manage_course(
      p_tenant_id, p_actor_user_id, v_course_id
    );
  else
    select account.student_id
    into v_student_id
    from public.student_portal_accounts account
    where account.tenant_id = p_tenant_id
      and account.user_id = p_actor_user_id
    limit 1;

    if found then
      v_viewer_authorized :=
        coachfort_internal.student_portal_access_allowed_for_user(
          p_tenant_id,
          v_student_id,
          p_actor_user_id,
          v_course_id,
          'course_read'
        );
    end if;
  end if;

  if not coalesce(v_viewer_authorized, false) then
    raise exception 'Native video viewer is not authorized.'
      using errcode = '42501';
  end if;

  select attachment.*
  into v_attachment
  from public.video_asset_attachments attachment
  where attachment.tenant_id = p_tenant_id
    and attachment.lesson_id = p_lesson_id;

  if not found then
    raise exception 'Native video attachment is unavailable.'
      using errcode = 'P0002';
  end if;

  select asset.*
  into v_asset
  from public.video_assets asset
  where asset.tenant_id = p_tenant_id
    and asset.id = v_attachment.video_asset_id;

  if not found
     or v_asset.status <> 'ready'
     or v_asset.provider_deleted_at is not null then
    raise exception 'Native video asset is not playable.'
      using errcode = '55000';
  end if;

  if v_asset.provider <> 'cloudflare_stream'
     or v_asset.provider_asset_id is null
     or char_length(v_asset.provider_asset_id) not between 1 and 255
     or v_asset.provider_asset_id ~ '[[:space:][:cntrl:]]'
     or v_asset.duration_seconds is null
     or v_asset.duration_seconds not between 1 and 7200 then
    raise exception 'Native video provider authority is malformed.'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'lesson_id', p_lesson_id,
    'video_asset_id', v_asset.id,
    'provider', v_asset.provider,
    'provider_asset_id', v_asset.provider_asset_id,
    'duration_seconds', v_asset.duration_seconds
  );
end;
$$;

alter function public.authorize_native_video_playback_server(uuid,uuid,uuid)
  owner to postgres;

revoke all on function
  public.authorize_native_video_playback_server(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.authorize_native_video_playback_server(uuid,uuid,uuid)
  to service_role;

do $$
declare
  v_function_oid oid := to_regprocedure(
    'public.authorize_native_video_playback_server(uuid,uuid,uuid)'
  );
  v_source text;
  v_current_helper_contract jsonb;
  v_current_relation_contract jsonb;
  v_baseline video2c0_apply_baseline%rowtype;
begin
  select * into strict v_baseline from video2c0_apply_baseline;

  select lower(regexp_replace(
    pg_get_functiondef(v_function_oid), '[[:space:]]+', ' ', 'g'
  )) into v_source;

  if v_function_oid is null
     or pg_get_userbyid((select proowner from pg_proc where oid = v_function_oid))
       <> 'postgres'
     or not (select prosecdef from pg_proc where oid = v_function_oid)
     or (select provolatile from pg_proc where oid = v_function_oid) <> 's'
     or not coalesce(
       (select proconfig from pg_proc where oid = v_function_oid),
       array[]::text[]
     ) @> array['search_path=public, pg_temp']
     or not has_function_privilege('service_role', v_function_oid, 'EXECUTE')
     or has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = v_function_oid
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'VIDEO-2C0 playback authority security contract failed.'
      using errcode = '55000';
  end if;

  if v_source not like '%tenant_operational_access_allowed(p_tenant_id)%'
     or v_source not like '%assert_effective_operational_feature%native_video%'
     or v_source not like '%operational_current_team_role%'
     or v_source not like '%ux4b_trainer_can_manage_course%'
     or v_source not like '%student_portal_access_allowed_for_user%course_read%'
     or v_source not like '%video_asset_attachments%'
     or v_source not like '%status <> ''ready''%'
     or v_source not like '%provider <> ''cloudflare_stream''%'
     or v_source not like '%provider_deleted_at is not null%'
     or v_source not like '%duration_seconds not between 1 and 7200%'
     or v_source like '%is_platform_admin%'
     or v_source like '%resolve_native_video_capacity%'
     or v_source like '%insert into%'
     or v_source like '%update public.%'
     or v_source like '%delete from%' then
    raise exception 'VIDEO-2C0 playback source contract failed.'
      using errcode = '55000';
  end if;

  if position('tenant_operational_access_allowed' in v_source) >=
       position('assert_effective_operational_feature' in v_source)
     or position('assert_effective_operational_feature' in v_source) >=
       position('from public.lessons' in v_source)
     or position('from public.lessons' in v_source) >=
       position('operational_current_team_role' in v_source)
     or position('operational_current_team_role' in v_source) >=
       position('from public.video_asset_attachments' in v_source)
     or position('from public.video_asset_attachments' in v_source) >=
       position('from public.video_assets' in v_source) then
    raise exception 'VIDEO-2C0 authority ordering contract failed.'
      using errcode = '55000';
  end if;

  select jsonb_agg(jsonb_build_object(
    'identity', expected.identity,
    'owner', pg_get_userbyid(procedure.proowner),
    'acl', procedure.proacl,
    'security_definer', procedure.prosecdef,
    'volatility', procedure.provolatile,
    'config', procedure.proconfig,
    'normalized_prosrc_md5', md5(regexp_replace(
      procedure.prosrc, '[[:space:]]+', '', 'g'
    ))
  ) order by expected.identity)
  into v_current_helper_contract
  from (values
    ('coachfort_internal.tenant_operational_access_allowed(uuid)'),
    ('coachfort_internal.operational_current_team_role(uuid,uuid)'),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)'),
    ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity);

  select jsonb_agg(jsonb_build_object(
    'identity', protected.identity,
    'owner', pg_get_userbyid(relation.relowner),
    'rls', relation.relrowsecurity,
    'force_rls', relation.relforcerowsecurity,
    'acl', relation.relacl
  ) order by protected.identity)
  into v_current_relation_contract
  from (values
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events')
  ) protected(identity)
  join pg_class relation on relation.oid = to_regclass(protected.identity);

  if v_current_helper_contract is distinct from v_baseline.helper_contract
     or v_current_relation_contract is distinct from
       v_baseline.protected_relation_contract
     or (select count(*) from public.video_assets)
       <> v_baseline.video_asset_count
     or (select md5(coalesce(
       jsonb_agg(to_jsonb(asset) order by asset.id)::text, '[]'
     )) from public.video_assets asset)
       is distinct from v_baseline.video_asset_fingerprint
     or (select count(*) from public.video_asset_attachments)
       <> v_baseline.attachment_count
     or (select md5(coalesce(
       jsonb_agg(to_jsonb(attachment) order by attachment.id)::text, '[]'
     )) from public.video_asset_attachments attachment)
       is distinct from v_baseline.attachment_fingerprint
     or (select count(*) from public.video_provider_events)
       <> v_baseline.provider_event_count
     or (select md5(coalesce(
       jsonb_agg(to_jsonb(event_row) order by event_row.id)::text, '[]'
     )) from public.video_provider_events event_row)
       is distinct from v_baseline.provider_event_fingerprint then
    raise exception 'VIDEO-2C0 changed protected authority or video data.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY READ-ONLY VERIFICATION
-- ---------------------------------------------------------------------------

with
target_identity(identity) as (
  values ('public.authorize_native_video_playback_server(uuid,uuid,uuid)')
),
target_function as (
  select procedure.*
  from target_identity expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
target_source as (
  select coalesce(lower(regexp_replace(
    pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
  )), '') source
  from target_function procedure
),
function_contract as (
  select
    count(procedure.oid) = 1 exact_signature,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false)
      postgres_owned,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(procedure.provolatile = 's'), false) stable,
    coalesce(bool_and(coalesce(procedure.proconfig, array[]::text[])
      @> array['search_path=public, pg_temp']), false) fixed_search_path,
    coalesce(bool_and(has_function_privilege(
      'service_role', procedure.oid, 'EXECUTE'
    )), false) service_role_execute,
    coalesce(bool_and(not has_function_privilege(
      'anon', procedure.oid, 'EXECUTE'
    )), false) anon_denied,
    coalesce(bool_and(not has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    )), false) authenticated_denied,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_denied
  from target_function procedure
),
source_contract as (
  select
    source like '%tenant_operational_access_allowed(p_tenant_id)%'
      lifecycle_required,
    source like '%assert_effective_operational_feature%native_video%'
      native_video_required,
    source like '%operational_current_team_role%'
      canonical_team_role,
    source like '%v_team_role in (''owner'',''admin'',''staff'')%'
      broad_program_read_roles_preserved,
    source like '%v_team_role = ''trainer''%ux4b_trainer_can_manage_course%'
      trainer_assignment_required,
    source like '%student_portal_access_allowed_for_user%course_read%'
      canonical_student_course_read,
    source not like '%is_platform_admin%'
      no_platform_owner_bypass,
    source like '%join public.courses%course.tenant_id = lesson.tenant_id%'
      lesson_course_tenant_bound,
    source like '%from public.video_asset_attachments%'
      attachment_required,
    source like '%status <> ''ready''%'
      ready_required,
    source like '%provider <> ''cloudflare_stream''%'
      cloudflare_required,
    source like '%provider_asset_id is null%between 1 and 255%space%cntrl%'
      provider_identity_validated,
    source like '%provider_deleted_at is not null%'
      provider_deletion_denied,
    source like '%duration_seconds is null%duration_seconds not between 1 and 7200%'
      duration_validated,
    source not like '%resolve_native_video_capacity%'
      capacity_not_playback_authority,
    source not like '%insert into%'
      and source not like '%update public.%'
      and source not like '%delete from%'
      read_only,
    source like '%native video playback input is invalid%errcode = ''22023''%'
      invalid_input_error,
    source like '%native video playback actor is required%errcode = ''28000''%'
      actor_error,
    source like '%native video playback lifecycle is unavailable%errcode = ''42501''%'
      lifecycle_error,
    source like '%native video playback feature is unavailable%errcode = ''42501''%'
      feature_error,
    source like '%native video lesson is unavailable%errcode = ''p0002''%'
      lesson_error,
    source like '%native video viewer is not authorized%errcode = ''42501''%'
      viewer_error,
    source like '%native video attachment is unavailable%errcode = ''p0002''%'
      attachment_error,
    source like '%native video asset is not playable%errcode = ''55000''%'
      asset_error,
    source like '%native video provider authority is malformed%errcode = ''55000''%'
      provider_error,
    position('tenant_operational_access_allowed' in source) <
      position('assert_effective_operational_feature' in source)
      and position('assert_effective_operational_feature' in source) <
        position('from public.lessons' in source)
      and position('from public.lessons' in source) <
        position('operational_current_team_role' in source)
      and position('operational_current_team_role' in source) <
        position('from public.video_asset_attachments' in source)
      and position('from public.video_asset_attachments' in source) <
        position('from public.video_assets' in source)
      authority_order,
    source like '%jsonb_build_object%lesson_id%video_asset_id%provider%provider_asset_id%duration_seconds%'
      minimum_return_contract,
    source not like '%api_token%'
      and source not like '%signing%'
      and source not like '%upload_url%'
      and source not like '%quota%'
      and source not like '%subscription_%'
      and source not like '%student_id'',%'
      no_sensitive_return
  from target_source
),
expected_helpers(identity, expected_source_md5, expected_search_path,
                 authenticated_execute) as (
  values
    ('coachfort_internal.tenant_operational_access_allowed(uuid)',
      '402306364425f9def3123c8961834681', 'search_path=public, pg_temp', true),
    ('coachfort_internal.operational_current_team_role(uuid,uuid)',
      '7f31929d1939c1f23c1f9fafa334c78c', 'search_path=public, pg_temp', false),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)',
      '8b31631eb6fb665efdd1854a027d9d2f', 'search_path=public, pg_temp', false),
    ('coachfort_internal.assert_effective_operational_feature(uuid,text)',
      'd3a35f18230c4c9062bf5bb502c0f027', 'search_path=public, pg_temp', false),
    ('public.ux4b_trainer_can_manage_course(uuid,uuid,uuid)',
      '2315893019e05e68bd8fcdfd16f26c5f', 'search_path=public', false)
),
helper_contract as (
  select
    count(procedure.oid) = 5 helpers_present,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and coalesce(procedure.proconfig, array[]::text[])
        @> array[expected.expected_search_path]
      and md5(regexp_replace(
        procedure.prosrc, '[[:space:]]+', '', 'g'
      )) = expected.expected_source_md5
      and has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ) = expected.authenticated_execute
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    ), false) exact_helper_contract,
    jsonb_agg(jsonb_build_object(
      'identity', expected.identity,
      'normalized_prosrc_md5', md5(regexp_replace(
        procedure.prosrc, '[[:space:]]+', '', 'g'
      )),
      'expected_normalized_prosrc_md5', expected.expected_source_md5
    ) order by expected.identity) fingerprints
  from expected_helpers expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
protected_acl as (
  select not exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    cross join (values ('anon'),('authenticated'),('service_role')) actor(role_name)
    cross join (values
      ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
      ('TRUNCATE'),('REFERENCES'),('TRIGGER')
    ) privilege(privilege_name)
    where has_table_privilege(
      actor.role_name, protected.identity, privilege.privilege_name
    )
  ) no_direct_role_access,
  not exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    join pg_class relation on relation.oid = to_regclass(protected.identity)
    cross join lateral aclexplode(coalesce(
      relation.relacl, acldefault('r', relation.relowner)
    )) acl
    where acl.grantee = 0
      and acl.privilege_type in (
        'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
      )
  ) no_public_access
),
protected_relation_contract as (
  select
    count(relation.oid) = 3 protected_tables_present,
    coalesce(bool_and(relation.relrowsecurity), false) rls_enabled,
    coalesce(bool_and(pg_get_userbyid(relation.relowner) = 'postgres'), false)
      postgres_owned
  from (values
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events')
  ) protected(identity)
  left join pg_class relation on relation.oid = to_regclass(protected.identity)
),
storage_contract as (
  select
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
        and constraint_row.conname = 'video_asset_attachments_asset_fk'
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = to_regclass('public.video_assets')
        and constraint_row.confdeltype = 'r'
    ) tenant_asset_fk,
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
        and constraint_row.conname = 'video_asset_attachments_lesson_fk'
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = to_regclass('public.lessons')
        and constraint_row.confdeltype = 'c'
    ) tenant_lesson_fk,
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
        and constraint_row.conname = 'video_asset_attachments_lesson_key'
        and constraint_row.contype = 'u'
    ) one_attachment_per_lesson,
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid = to_regclass('public.video_assets')
        and constraint_row.conname = 'video_assets_status_check'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%upload_pending%processing%ready%failed%delete_pending%deleted%'
    ) exact_status_domain,
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid = to_regclass('public.video_assets')
        and constraint_row.conname = 'video_assets_provider_check'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%cloudflare_stream%mux%'
    ) provider_domain,
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid = to_regclass('public.video_assets')
        and constraint_row.conname = 'video_assets_ready_identity_check'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%status <> ''ready''%provider_asset_id is not null%duration_seconds is not null%'
    ) ready_identity_required,
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid = to_regclass('public.video_assets')
        and constraint_row.conname = 'video_assets_provider_asset_id_check'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%provider_asset_idisnull%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%char_length(provider_asset_id)>=1%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%char_length(provider_asset_id)<=255%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%provider_asset_id!~''[[:space:][:cntrl:]]''%'
    ) provider_identity_bounded,
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid = to_regclass('public.video_assets')
        and constraint_row.conname = 'video_assets_duration_check'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%duration_secondsisnull%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%duration_seconds>=1%'
        and regexp_replace(
          lower(pg_get_constraintdef(constraint_row.oid)),
          '[[:space:]]+', '', 'g'
        ) like '%duration_seconds<=7200%'
    ) duration_bounded
),
overload_contract as (
  select count(*) = 1 exact_public_identity_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'authorize_native_video_playback_server'
),
protected_data as (
  select jsonb_build_object(
    'video_assets', (select count(*) from public.video_assets),
    'video_asset_attachments', (select count(*) from public.video_asset_attachments),
    'video_provider_events', (select count(*) from public.video_provider_events),
    'video_assets_fingerprint', (select md5(coalesce(
      jsonb_agg(to_jsonb(asset) order by asset.id)::text, '[]'
    )) from public.video_assets asset),
    'attachment_fingerprint', (select md5(coalesce(
      jsonb_agg(to_jsonb(attachment) order by attachment.id)::text, '[]'
    )) from public.video_asset_attachments attachment),
    'provider_event_fingerprint', (select md5(coalesce(
      jsonb_agg(to_jsonb(event_row) order by event_row.id)::text, '[]'
    )) from public.video_provider_events event_row)
  ) inventory
)
select
  helper_contract.fingerprints authority_helper_fingerprints,
  protected_data.inventory protected_video_data,
  function_contract.*,
  source_contract.*,
  helper_contract.helpers_present,
  helper_contract.exact_helper_contract,
  protected_acl.no_direct_role_access,
  protected_acl.no_public_access,
  protected_relation_contract.*,
  storage_contract.*,
  overload_contract.exact_public_identity_count,
  function_contract.exact_signature
    and function_contract.postgres_owned
    and function_contract.security_definer
    and function_contract.stable
    and function_contract.fixed_search_path
    and function_contract.service_role_execute
    and function_contract.anon_denied
    and function_contract.authenticated_denied
    and function_contract.public_denied
    and source_contract.lifecycle_required
    and source_contract.native_video_required
    and source_contract.canonical_team_role
    and source_contract.broad_program_read_roles_preserved
    and source_contract.trainer_assignment_required
    and source_contract.canonical_student_course_read
    and source_contract.no_platform_owner_bypass
    and source_contract.lesson_course_tenant_bound
    and source_contract.attachment_required
    and source_contract.ready_required
    and source_contract.cloudflare_required
    and source_contract.provider_identity_validated
    and source_contract.provider_deletion_denied
    and source_contract.duration_validated
    and source_contract.capacity_not_playback_authority
    and source_contract.read_only
    and source_contract.invalid_input_error
    and source_contract.actor_error
    and source_contract.lifecycle_error
    and source_contract.feature_error
    and source_contract.lesson_error
    and source_contract.viewer_error
    and source_contract.attachment_error
    and source_contract.asset_error
    and source_contract.provider_error
    and source_contract.authority_order
    and source_contract.minimum_return_contract
    and source_contract.no_sensitive_return
    and helper_contract.helpers_present
    and helper_contract.exact_helper_contract
    and protected_acl.no_direct_role_access
    and protected_acl.no_public_access
    and protected_relation_contract.protected_tables_present
    and protected_relation_contract.rls_enabled
    and protected_relation_contract.postgres_owned
    and storage_contract.tenant_asset_fk
    and storage_contract.tenant_lesson_fk
    and storage_contract.one_attachment_per_lesson
    and storage_contract.exact_status_domain
    and storage_contract.provider_domain
    and storage_contract.ready_identity_required
    and storage_contract.provider_identity_bounded
    and storage_contract.duration_bounded
    and overload_contract.exact_public_identity_count
    as security_gate
from function_contract
cross join source_contract
cross join helper_contract
cross join protected_acl
cross join protected_relation_contract
cross join storage_contract
cross join overload_contract
cross join protected_data;
