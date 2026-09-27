-- Bundle VIDEO-2C2D3-B: exact lesson native-video attachment read authority.
--
-- This bundle creates one service-only, read-only projection used by the lesson
-- editor. It does not change attachment mutation, lifecycle, feature, course,
-- playback, provider, upload, quota, deletion, table ACL, or RLS authority.

-- ---------------------------------------------------------------------------
-- PRE-APPLY READ-ONLY VERIFICATION
-- ---------------------------------------------------------------------------

with
expected_columns(table_name, column_name, udt_name) as (
  values
    ('lessons', 'id', 'uuid'),
    ('lessons', 'tenant_id', 'uuid'),
    ('video_asset_attachments', 'id', 'uuid'),
    ('video_asset_attachments', 'tenant_id', 'uuid'),
    ('video_asset_attachments', 'video_asset_id', 'uuid'),
    ('video_asset_attachments', 'lesson_id', 'uuid'),
    ('video_asset_attachments', 'created_at', 'timestamptz'),
    ('video_assets', 'id', 'uuid'),
    ('video_assets', 'tenant_id', 'uuid'),
    ('video_assets', 'original_filename', 'text'),
    ('video_assets', 'status', 'text'),
    ('video_assets', 'duration_seconds', 'int8')
),
column_state as (
  select
    count(*) = count(column_def.column_name) required_columns_present,
    coalesce(jsonb_agg(jsonb_build_object(
      'table', expected.table_name,
      'column', expected.column_name,
      'type', expected.udt_name,
      'installed', column_def.column_name is not null
    ) order by expected.table_name, expected.column_name), '[]'::jsonb)
      inventory
  from expected_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
   and column_def.udt_name = expected.udt_name
),
target_state as (
  select
    to_regprocedure(
      'public.get_native_video_lesson_attachment_server(uuid,uuid,uuid)'
    ) is null exact_target_absent,
    not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace_def
        on namespace_def.oid = procedure.pronamespace
      where namespace_def.nspname = 'public'
        and procedure.proname =
          'get_native_video_lesson_attachment_server'
    ) no_target_overload
),
relationship_state as (
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
  where constraint_row.conrelid =
    to_regclass('public.video_asset_attachments')
),
dependency_state as (
  select
    count(procedure.oid) = 7 dependencies_present,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proconfig is not null
      and (
        procedure.proconfig @> array['search_path=public, pg_temp']
        or procedure.proconfig @> array['search_path=public']
      )
    ), false) dependency_security
  from (values
    ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    ('coachfort_internal.assert_tenant_operational_access(uuid)'),
    ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
    ('coachfort_internal.validate_external_video_url(text)'),
    ('coachfort_internal.enforce_lesson_external_video_authority()'),
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)')
  ) expected(identity)
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
mutation_security as (
  select
    count(procedure.oid) = 2 exact_functions_present,
    coalesce(bool_and(
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 'v'
      and procedure.proconfig = array['search_path=public, pg_temp']
      and procedure.prorettype = 'jsonb'::regtype
      and has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ), false) service_only
  from (values
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)')
  ) expected(identity)
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
),
mutation_source as (
  select
    lower(pg_get_functiondef(to_regprocedure(
      'public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'
    ))) attach_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'
    ))) detach_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_lesson_external_video_authority()'
    ))) external_trigger_source
),
mutation_contract as (
  select
    attach_source like '%assert_native_video_owner_admin%'
      and attach_source like '%assert_tenant_operational_access%'
      and attach_source like '%assert_effective_operational_feature%'
      and attach_source like '%''native_video''%'
      and attach_source like
        '%id = p_lesson_id and tenant_id = p_tenant_id for update%'
      and attach_source like
        '%id = p_asset_id and tenant_id = p_tenant_id for share%'
      and attach_source like '%v_asset.status <> ''ready''%'
      and attach_source like '%v_lesson.video_url is not null%'
      and attach_source like '%on conflict (lesson_id) do update%'
      attach_authority_preserved,
    detach_source like '%assert_native_video_owner_admin%'
      and detach_source like '%delete from public.video_asset_attachments%'
      and detach_source like '%attachment.tenant_id = p_tenant_id%'
      and detach_source like '%attachment.lesson_id = p_lesson_id%'
      and detach_source not like '%assert_tenant_operational_access%'
      and detach_source not like '%assert_effective_operational_feature%'
      detach_authority_preserved,
    external_trigger_source like '%validate_external_video_url%'
      and external_trigger_source like '%video_asset_attachments%'
      and external_trigger_source like
        '%detach the native video before adding an external video%'
      external_native_exclusion_preserved
  from mutation_source
),
protected_relation_state as (
  select
    count(relation.oid) = 3 protected_tables_present,
    coalesce(bool_and(relation.relrowsecurity), false) rls_enabled,
    coalesce(bool_and(
      pg_get_userbyid(relation.relowner) = 'postgres'
    ), false) postgres_owned
  from (values
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events')
  ) expected(identity)
  left join pg_class relation
    on relation.oid = to_regclass(expected.identity)
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
      cross join (values
        ('anon'),('authenticated'),('service_role')
      ) actor(role_name)
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
      join pg_class relation
        on relation.oid = to_regclass(protected.identity)
      cross join lateral aclexplode(coalesce(
        relation.relacl, acldefault('r', relation.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in (
          'SELECT','INSERT','UPDATE','DELETE',
          'TRUNCATE','REFERENCES','TRIGGER'
        )
    ) public_access_absent
),
protected_data as (
  select jsonb_build_object(
    'video_assets', (select count(*) from public.video_assets),
    'video_asset_attachments',
      (select count(*) from public.video_asset_attachments),
    'video_provider_events',
      (select count(*) from public.video_provider_events),
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
  protected_data.inventory protected_video_data,
  column_state.required_columns_present,
  target_state.exact_target_absent,
  target_state.no_target_overload,
  relationship_state.tenant_asset_fk,
  relationship_state.tenant_lesson_fk,
  relationship_state.one_attachment_per_lesson,
  dependency_state.dependencies_present,
  dependency_state.dependency_security,
  mutation_security.exact_functions_present,
  mutation_security.service_only mutation_service_only,
  mutation_contract.attach_authority_preserved,
  mutation_contract.detach_authority_preserved,
  mutation_contract.external_native_exclusion_preserved,
  protected_relation_state.protected_tables_present,
  protected_relation_state.rls_enabled,
  protected_relation_state.postgres_owned,
  protected_acl.effective_role_access_absent,
  protected_acl.public_access_absent,
  column_state.required_columns_present
    and target_state.exact_target_absent
    and target_state.no_target_overload
    and relationship_state.tenant_asset_fk
    and relationship_state.tenant_lesson_fk
    and relationship_state.one_attachment_per_lesson
    and dependency_state.dependencies_present
    and dependency_state.dependency_security
    and mutation_security.exact_functions_present
    and mutation_security.service_only
    and mutation_contract.attach_authority_preserved
    and mutation_contract.detach_authority_preserved
    and mutation_contract.external_native_exclusion_preserved
    and protected_relation_state.protected_tables_present
    and protected_relation_state.rls_enabled
    and protected_relation_state.postgres_owned
    and protected_acl.effective_role_access_absent
    and protected_acl.public_access_absent
    as ready_for_apply
from column_state
cross join target_state
cross join relationship_state
cross join dependency_state
cross join mutation_security
cross join mutation_contract
cross join protected_relation_state
cross join protected_acl
cross join protected_data;

-- ---------------------------------------------------------------------------
-- APPLY (TRANSACTIONAL; DO NOT RUN AS PART OF REVIEW)
-- ---------------------------------------------------------------------------

begin;

do $video2c2d3b_prerequisite$
declare
  v_attach oid := to_regprocedure(
    'public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'
  );
  v_detach oid := to_regprocedure(
    'public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'
  );
  v_attach_source text;
  v_detach_source text;
  v_external_source text;
  v_required_columns integer;
  v_installed_columns integer;
begin
  if to_regprocedure(
       'public.get_native_video_lesson_attachment_server(uuid,uuid,uuid)'
     ) is not null
     or exists (
       select 1
       from pg_proc procedure
       join pg_namespace namespace_def
         on namespace_def.oid = procedure.pronamespace
       where namespace_def.nspname = 'public'
         and procedure.proname =
           'get_native_video_lesson_attachment_server'
     ) then
    raise exception 'VIDEO-2C2D3-B target authority already exists.'
      using errcode = '55000';
  end if;

  select count(*), count(column_def.column_name)
  into v_required_columns, v_installed_columns
  from (values
    ('lessons', 'id', 'uuid'),
    ('lessons', 'tenant_id', 'uuid'),
    ('video_asset_attachments', 'id', 'uuid'),
    ('video_asset_attachments', 'tenant_id', 'uuid'),
    ('video_asset_attachments', 'video_asset_id', 'uuid'),
    ('video_asset_attachments', 'lesson_id', 'uuid'),
    ('video_asset_attachments', 'created_at', 'timestamptz'),
    ('video_assets', 'id', 'uuid'),
    ('video_assets', 'tenant_id', 'uuid'),
    ('video_assets', 'original_filename', 'text'),
    ('video_assets', 'status', 'text'),
    ('video_assets', 'duration_seconds', 'int8')
  ) expected(table_name, column_name, udt_name)
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
   and column_def.udt_name = expected.udt_name;

  if v_installed_columns <> v_required_columns then
    raise exception 'VIDEO-2C2D3-B required columns have drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
      ('coachfort_internal.assert_tenant_operational_access(uuid)'),
      ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
      ('coachfort_internal.validate_external_video_url(text)'),
      ('coachfort_internal.enforce_lesson_external_video_authority()'),
      ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
      ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)')
    ) expected(identity)
    left join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.identity)
    where procedure.oid is null
       or pg_get_userbyid(procedure.proowner) <> 'postgres'
       or not procedure.prosecdef
       or procedure.proconfig is null
       or not (
         procedure.proconfig @> array['search_path=public, pg_temp']
         or procedure.proconfig @> array['search_path=public']
       )
  ) then
    raise exception 'VIDEO-2C2D3-B dependency authority has drifted.'
      using errcode = '55000';
  end if;

  if v_attach is null or v_detach is null
     or exists (
       select 1
       from pg_proc procedure
       where procedure.oid in (v_attach, v_detach)
         and (
           pg_get_userbyid(procedure.proowner) <> 'postgres'
           or not procedure.prosecdef
           or procedure.provolatile <> 'v'
           or procedure.proconfig
             is distinct from array['search_path=public, pg_temp']
           or procedure.prorettype <> 'jsonb'::regtype
         )
     )
     or not has_function_privilege('service_role', v_attach, 'EXECUTE')
     or not has_function_privilege('service_role', v_detach, 'EXECUTE')
     or has_function_privilege('anon', v_attach, 'EXECUTE')
     or has_function_privilege('anon', v_detach, 'EXECUTE')
     or has_function_privilege('authenticated', v_attach, 'EXECUTE')
     or has_function_privilege('authenticated', v_detach, 'EXECUTE')
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid in (v_attach, v_detach)
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'VIDEO-2C2D3-B mutation RPC security has drifted.'
      using errcode = '55000';
  end if;

  select lower(pg_get_functiondef(v_attach)) into v_attach_source;
  select lower(pg_get_functiondef(v_detach)) into v_detach_source;
  select lower(pg_get_functiondef(to_regprocedure(
    'coachfort_internal.enforce_lesson_external_video_authority()'
  ))) into v_external_source;

  if v_attach_source not like '%assert_native_video_owner_admin%'
     or v_attach_source not like '%assert_tenant_operational_access%'
     or v_attach_source not like '%assert_effective_operational_feature%'
     or v_attach_source not like '%v_asset.status <> ''ready''%'
     or v_attach_source not like '%v_lesson.video_url is not null%'
     or v_attach_source not like '%on conflict (lesson_id) do update%'
     or v_detach_source not like '%assert_native_video_owner_admin%'
     or v_detach_source not like '%delete from public.video_asset_attachments%'
     or v_detach_source like '%assert_tenant_operational_access%'
     or v_detach_source like '%assert_effective_operational_feature%'
     or v_external_source not like '%validate_external_video_url%'
     or v_external_source not like '%video_asset_attachments%'
     or v_external_source not like
       '%detach the native video before adding an external video%' then
    raise exception 'VIDEO-2C2D3-B mutation contract has drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
      and constraint_row.conname = 'video_asset_attachments_asset_fk'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = to_regclass('public.video_assets')
      and constraint_row.confdeltype = 'r'
  ) or not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
      and constraint_row.conname = 'video_asset_attachments_lesson_fk'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = to_regclass('public.lessons')
      and constraint_row.confdeltype = 'c'
  ) or not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
      and constraint_row.conname = 'video_asset_attachments_lesson_key'
      and constraint_row.contype = 'u'
  ) then
    raise exception 'VIDEO-2C2D3-B attachment relationships have drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    left join pg_class relation
      on relation.oid = to_regclass(protected.identity)
    where relation.oid is null
       or not relation.relrowsecurity
       or pg_get_userbyid(relation.relowner) <> 'postgres'
  ) or exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    cross join (values
      ('anon'),('authenticated'),('service_role')
    ) actor(role_name)
    cross join (values
      ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
      ('TRUNCATE'),('REFERENCES'),('TRIGGER')
    ) privilege(privilege_name)
    where has_table_privilege(
      actor.role_name, protected.identity, privilege.privilege_name
    )
  ) then
    raise exception 'VIDEO-2C2D3-B protected table authority has drifted.'
      using errcode = '55000';
  end if;
end;
$video2c2d3b_prerequisite$;

create temporary table video2c2d3b_apply_baseline on commit drop as
select
  (select count(*) from public.video_assets) asset_rows,
  (select md5(coalesce(
    jsonb_agg(to_jsonb(asset) order by asset.id)::text, '[]'
  )) from public.video_assets asset) asset_fingerprint,
  (select count(*) from public.video_asset_attachments) attachment_rows,
  (select md5(coalesce(
    jsonb_agg(to_jsonb(attachment) order by attachment.id)::text, '[]'
  )) from public.video_asset_attachments attachment) attachment_fingerprint,
  (select count(*) from public.video_provider_events) provider_event_rows,
  (select md5(coalesce(
    jsonb_agg(to_jsonb(event_row) order by event_row.id)::text, '[]'
  )) from public.video_provider_events event_row) provider_event_fingerprint,
  (
    select jsonb_object_agg(
      expected.identity,
      jsonb_build_object(
        'identity', procedure.oid::regprocedure::text,
        'definition', pg_get_functiondef(procedure.oid),
        'owner', pg_get_userbyid(procedure.proowner),
        'acl', coalesce(procedure.proacl::text, ''),
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile,
        'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
      ) order by expected.identity
    )
    from (values
      ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
      ('coachfort_internal.assert_tenant_operational_access(uuid)'),
      ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
      ('coachfort_internal.validate_external_video_url(text)'),
      ('coachfort_internal.enforce_lesson_external_video_authority()'),
      ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
      ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)')
    ) expected(identity)
    join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.identity)
  ) adjacent_function_contract,
  (
    select jsonb_object_agg(
      protected.identity,
      jsonb_build_object(
        'owner', pg_get_userbyid(relation.relowner),
        'rls', relation.relrowsecurity,
        'force_rls', relation.relforcerowsecurity,
        'acl', coalesce(relation.relacl::text, '')
      ) order by protected.identity
    )
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events')
    ) protected(identity)
    join pg_class relation
      on relation.oid = to_regclass(protected.identity)
  ) protected_relation_contract,
  (
    select pg_get_triggerdef(trigger_row.oid)
    from pg_trigger trigger_row
    where trigger_row.tgrelid = to_regclass('public.lessons')
      and trigger_row.tgname = 'enforce_lesson_external_video_authority'
      and not trigger_row.tgisinternal
  ) external_video_trigger_contract;

create function public.get_native_video_lesson_attachment_server(
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
  v_lesson_id uuid;
  v_attachment_asset_id uuid;
  v_attached_at timestamptz;
  v_asset_id uuid;
  v_filename text;
  v_status text;
  v_duration_seconds bigint;
begin
  if p_tenant_id is null
     or p_actor_user_id is null
     or p_lesson_id is null then
    raise exception 'Native video lesson attachment input is invalid.'
      using errcode = '22023';
  end if;

  perform coachfort_internal.assert_native_video_owner_admin(
    p_tenant_id, p_actor_user_id
  );

  select lesson.id
  into v_lesson_id
  from public.lessons lesson
  where lesson.tenant_id = p_tenant_id
    and lesson.id = p_lesson_id;

  if not found then
    raise exception 'Native video lesson is unavailable.'
      using errcode = '02000';
  end if;

  select attachment.video_asset_id, attachment.created_at
  into v_attachment_asset_id, v_attached_at
  from public.video_asset_attachments attachment
  where attachment.tenant_id = p_tenant_id
    and attachment.lesson_id = v_lesson_id;

  if not found then
    return jsonb_build_object(
      'lesson_id', v_lesson_id,
      'attachment', null
    );
  end if;

  select
    asset.id,
    asset.original_filename,
    asset.status,
    asset.duration_seconds
  into v_asset_id, v_filename, v_status, v_duration_seconds
  from public.video_assets asset
  where asset.tenant_id = p_tenant_id
    and asset.id = v_attachment_asset_id;

  if not found then
    raise exception 'Native video attachment authority is inconsistent.'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'lesson_id', v_lesson_id,
    'attachment', jsonb_build_object(
      'asset_id', v_asset_id,
      'filename', v_filename,
      'status', v_status,
      'duration_seconds', v_duration_seconds,
      'attached_at', v_attached_at
    )
  );
end;
$$;

alter function public.get_native_video_lesson_attachment_server(uuid,uuid,uuid)
  owner to postgres;

revoke all on function
  public.get_native_video_lesson_attachment_server(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.get_native_video_lesson_attachment_server(uuid,uuid,uuid)
  to service_role;

do $video2c2d3b_self_verify$
declare
  v_baseline video2c2d3b_apply_baseline%rowtype;
  v_function oid := to_regprocedure(
    'public.get_native_video_lesson_attachment_server(uuid,uuid,uuid)'
  );
  v_source text;
  v_adjacent jsonb;
  v_relations jsonb;
  v_trigger text;
begin
  select * into v_baseline from video2c2d3b_apply_baseline;

  if v_function is null
     or (
       select count(*)
       from pg_proc procedure
       join pg_namespace namespace_def
         on namespace_def.oid = procedure.pronamespace
       where namespace_def.nspname = 'public'
         and procedure.proname =
           'get_native_video_lesson_attachment_server'
     ) <> 1
     or pg_get_userbyid((select proowner from pg_proc where oid = v_function))
       <> 'postgres'
     or not (select prosecdef from pg_proc where oid = v_function)
     or (select provolatile from pg_proc where oid = v_function) <> 's'
     or (select proconfig from pg_proc where oid = v_function)
       <> array['search_path=public, pg_temp']
     or (select pg_get_function_result(v_function)) <> 'jsonb'
     or (select proargnames from pg_proc where oid = v_function)
       <> array['p_tenant_id','p_actor_user_id','p_lesson_id']
     or not has_function_privilege('service_role', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('authenticated', v_function, 'EXECUTE')
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = v_function
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'VIDEO-2C2D3-B target function security failed.'
      using errcode = '55000';
  end if;

  select lower(pg_get_functiondef(v_function)) into v_source;

  if v_source not like '%assert_native_video_owner_admin%'
     or v_source not like '%lesson.tenant_id = p_tenant_id%'
     or v_source not like '%lesson.id = p_lesson_id%'
     or v_source not like '%attachment.tenant_id = p_tenant_id%'
     or v_source not like '%attachment.lesson_id = v_lesson_id%'
     or v_source not like '%asset.tenant_id = p_tenant_id%'
     or v_source not like '%asset.id = v_attachment_asset_id%'
     or v_source not like '%''attachment'', null%'
     or v_source not like '%''asset_id'', v_asset_id%'
     or v_source not like '%''filename'', v_filename%'
     or v_source not like '%''status'', v_status%'
     or v_source not like '%''duration_seconds'', v_duration_seconds%'
     or v_source not like '%''attached_at'', v_attached_at%'
     or v_source like '%select attachment.*%'
     or v_source like '%select asset.*%'
     or v_source like '%rowtype%'
     or v_source like '%assert_tenant_operational_access%'
     or v_source like '%assert_effective_operational_feature%'
     or v_source like '%provider_asset_id%'
     or v_source like '%provider_upload_id%'
     or v_source like '%request_id%'
     or v_source like '%metadata_json%'
     or v_source like '%safe_failure_code%'
     or v_source like '%video_provider_events%'
     or v_source like '%video_upload_sessions%'
     or v_source ~ '\m(insert|update|delete|merge|truncate)\M' then
    raise exception 'VIDEO-2C2D3-B target function contract failed.'
      using errcode = '55000';
  end if;

  if (select count(*) from public.video_assets)
       is distinct from v_baseline.asset_rows
     or (select md5(coalesce(
       jsonb_agg(to_jsonb(asset) order by asset.id)::text, '[]'
     )) from public.video_assets asset)
       is distinct from v_baseline.asset_fingerprint
     or (select count(*) from public.video_asset_attachments)
       is distinct from v_baseline.attachment_rows
     or (select md5(coalesce(
       jsonb_agg(to_jsonb(attachment) order by attachment.id)::text, '[]'
     )) from public.video_asset_attachments attachment)
       is distinct from v_baseline.attachment_fingerprint
     or (select count(*) from public.video_provider_events)
       is distinct from v_baseline.provider_event_rows
     or (select md5(coalesce(
       jsonb_agg(to_jsonb(event_row) order by event_row.id)::text, '[]'
     )) from public.video_provider_events event_row)
       is distinct from v_baseline.provider_event_fingerprint then
    raise exception 'VIDEO-2C2D3-B changed protected video data.'
      using errcode = '55000';
  end if;

  select jsonb_object_agg(
    expected.identity,
    jsonb_build_object(
      'identity', procedure.oid::regprocedure::text,
      'definition', pg_get_functiondef(procedure.oid),
      'owner', pg_get_userbyid(procedure.proowner),
      'acl', coalesce(procedure.proacl::text, ''),
      'security_definer', procedure.prosecdef,
      'volatility', procedure.provolatile,
      'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
    ) order by expected.identity
  ) into v_adjacent
  from (values
    ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    ('coachfort_internal.assert_tenant_operational_access(uuid)'),
    ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
    ('coachfort_internal.validate_external_video_url(text)'),
    ('coachfort_internal.enforce_lesson_external_video_authority()'),
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)')
  ) expected(identity)
  join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if v_adjacent is distinct from v_baseline.adjacent_function_contract then
    raise exception 'VIDEO-2C2D3-B changed adjacent function authority.'
      using errcode = '55000';
  end if;

  select jsonb_object_agg(
    protected.identity,
    jsonb_build_object(
      'owner', pg_get_userbyid(relation.relowner),
      'rls', relation.relrowsecurity,
      'force_rls', relation.relforcerowsecurity,
      'acl', coalesce(relation.relacl::text, '')
    ) order by protected.identity
  ) into v_relations
  from (values
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events')
  ) protected(identity)
  join pg_class relation
    on relation.oid = to_regclass(protected.identity);

  if v_relations is distinct from v_baseline.protected_relation_contract then
    raise exception 'VIDEO-2C2D3-B changed protected relation authority.'
      using errcode = '55000';
  end if;

  select pg_get_triggerdef(trigger_row.oid)
  into v_trigger
  from pg_trigger trigger_row
  where trigger_row.tgrelid = to_regclass('public.lessons')
    and trigger_row.tgname = 'enforce_lesson_external_video_authority'
    and not trigger_row.tgisinternal;

  if v_trigger is distinct from v_baseline.external_video_trigger_contract then
    raise exception 'VIDEO-2C2D3-B changed external-video trigger authority.'
      using errcode = '55000';
  end if;
end;
$video2c2d3b_self_verify$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- POST-APPLY READ-ONLY VERIFICATION
-- ---------------------------------------------------------------------------

with
target as (
  select procedure.*
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'public.get_native_video_lesson_attachment_server(uuid,uuid,uuid)'
  )
),
identity_contract as (
  select
    (select count(*) from target) = 1 exact_signature,
    (
      select count(*) = 1
      from pg_proc procedure
      join pg_namespace namespace_def
        on namespace_def.oid = procedure.pronamespace
      where namespace_def.nspname = 'public'
        and procedure.proname =
          'get_native_video_lesson_attachment_server'
    ) exact_public_identity_count,
    coalesce((select
      pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=public, pg_temp']
      and procedure.prorettype = 'jsonb'::regtype
      and procedure.proargnames =
        array['p_tenant_id','p_actor_user_id','p_lesson_id']
      from target procedure
    ), false) function_security
),
acl_contract as (
  select coalesce((select
    has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and acl.grantee <> 'service_role'::regrole::oid
      )
    from target procedure
  ), false) service_only_execute
),
source_contract as (
  select coalesce((select
    source like '%assert_native_video_owner_admin%'
      and source like '%lesson.tenant_id = p_tenant_id%'
      and source like '%lesson.id = p_lesson_id%'
      and source like '%attachment.tenant_id = p_tenant_id%'
      and source like '%attachment.lesson_id = v_lesson_id%'
      and source like '%asset.tenant_id = p_tenant_id%'
      and source like '%asset.id = v_attachment_asset_id%'
      and source like '%''attachment'', null%'
      and source like '%''asset_id'', v_asset_id%'
      and source like '%''filename'', v_filename%'
      and source like '%''status'', v_status%'
      and source like '%''duration_seconds'', v_duration_seconds%'
      and source like '%''attached_at'', v_attached_at%'
      and source not like '%select attachment.*%'
      and source not like '%select asset.*%'
      and source not like '%rowtype%'
      and source not like '%assert_tenant_operational_access%'
      and source not like '%assert_effective_operational_feature%'
      and source not like '%provider_asset_id%'
      and source not like '%provider_upload_id%'
      and source not like '%request_id%'
      and source not like '%reservation_expires_at%'
      and source not like '%metadata_json%'
      and source not like '%safe_failure_code%'
      and source not like '%video_provider_events%'
      and source not like '%video_upload_sessions%'
      and source !~ '\m(insert|update|delete|merge|truncate)\M'
    from (
      select lower(pg_get_functiondef(procedure.oid)) source
      from target procedure
    ) definition
  ), false) exact_read_contract
),
relationship_state as (
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
  where constraint_row.conrelid =
    to_regclass('public.video_asset_attachments')
),
mutation_source as (
  select
    lower(pg_get_functiondef(to_regprocedure(
      'public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'
    ))) attach_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'
    ))) detach_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_lesson_external_video_authority()'
    ))) external_trigger_source
),
mutation_contract as (
  select
    attach_source like '%assert_native_video_owner_admin%'
      and attach_source like '%assert_tenant_operational_access%'
      and attach_source like '%assert_effective_operational_feature%'
      and attach_source like '%v_asset.status <> ''ready''%'
      and attach_source like '%v_lesson.video_url is not null%'
      and attach_source like '%on conflict (lesson_id) do update%'
      attach_authority_preserved,
    detach_source like '%assert_native_video_owner_admin%'
      and detach_source like '%delete from public.video_asset_attachments%'
      and detach_source not like '%assert_tenant_operational_access%'
      and detach_source not like '%assert_effective_operational_feature%'
      detach_authority_preserved,
    external_trigger_source like '%validate_external_video_url%'
      and external_trigger_source like '%video_asset_attachments%'
      external_native_exclusion_preserved
  from mutation_source
),
protected_relation_state as (
  select
    count(relation.oid) = 3 protected_tables_present,
    coalesce(bool_and(relation.relrowsecurity), false) rls_enabled,
    coalesce(bool_and(
      pg_get_userbyid(relation.relowner) = 'postgres'
    ), false) postgres_owned
  from (values
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events')
  ) expected(identity)
  left join pg_class relation
    on relation.oid = to_regclass(expected.identity)
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
      cross join (values
        ('anon'),('authenticated'),('service_role')
      ) actor(role_name)
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
      join pg_class relation
        on relation.oid = to_regclass(protected.identity)
      cross join lateral aclexplode(coalesce(
        relation.relacl, acldefault('r', relation.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in (
          'SELECT','INSERT','UPDATE','DELETE',
          'TRUNCATE','REFERENCES','TRIGGER'
        )
    ) public_access_absent
),
protected_data as (
  select jsonb_build_object(
    'video_assets', (select count(*) from public.video_assets),
    'video_asset_attachments',
      (select count(*) from public.video_asset_attachments),
    'video_provider_events',
      (select count(*) from public.video_provider_events),
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
  protected_data.inventory protected_video_data,
  identity_contract.exact_signature,
  identity_contract.exact_public_identity_count,
  identity_contract.function_security,
  acl_contract.service_only_execute,
  source_contract.exact_read_contract,
  relationship_state.tenant_asset_fk,
  relationship_state.tenant_lesson_fk,
  relationship_state.one_attachment_per_lesson,
  mutation_contract.attach_authority_preserved,
  mutation_contract.detach_authority_preserved,
  mutation_contract.external_native_exclusion_preserved,
  protected_relation_state.protected_tables_present,
  protected_relation_state.rls_enabled,
  protected_relation_state.postgres_owned,
  protected_acl.effective_role_access_absent,
  protected_acl.public_access_absent,
  identity_contract.exact_signature
    and identity_contract.exact_public_identity_count
    and identity_contract.function_security
    and acl_contract.service_only_execute
    and source_contract.exact_read_contract
    and relationship_state.tenant_asset_fk
    and relationship_state.tenant_lesson_fk
    and relationship_state.one_attachment_per_lesson
    and mutation_contract.attach_authority_preserved
    and mutation_contract.detach_authority_preserved
    and mutation_contract.external_native_exclusion_preserved
    and protected_relation_state.protected_tables_present
    and protected_relation_state.rls_enabled
    and protected_relation_state.postgres_owned
    and protected_acl.effective_role_access_absent
    and protected_acl.public_access_absent
    as security_gate,
  identity_contract.exact_signature
    and identity_contract.exact_public_identity_count
    and identity_contract.function_security
    and acl_contract.service_only_execute
    and source_contract.exact_read_contract
    and mutation_contract.attach_authority_preserved
    and mutation_contract.detach_authority_preserved
    and protected_acl.effective_role_access_absent
    and protected_acl.public_access_absent
    as post_verified
from identity_contract
cross join acl_contract
cross join source_contract
cross join relationship_state
cross join mutation_contract
cross join protected_relation_state
cross join protected_acl
cross join protected_data;
