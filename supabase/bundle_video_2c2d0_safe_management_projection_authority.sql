-- Bundle VIDEO-2C2D0: Owner/Admin native-video safe management projection.
--
-- This migration installs one service-only, read-only projection. It does not
-- change protected table ACLs/RLS, lifecycle, feature, quota, provider, upload,
-- attachment, playback, or deletion authority.

begin;

do $$
declare
  v_helper oid := to_regprocedure(
    'coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'
  );
  v_required_columns integer;
  v_installed_columns integer;
  v_precedent_count integer;
begin
  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'get_native_video_management_projection_server'
  ) then
    raise exception 'VIDEO-2C2D0 target function already exists.'
      using errcode = '55000';
  end if;

  select count(*), count(column_def.column_name)
  into v_required_columns, v_installed_columns
  from (values
    ('video_assets','id','uuid'),
    ('video_assets','tenant_id','uuid'),
    ('video_assets','status','text'),
    ('video_assets','duration_seconds','int8'),
    ('video_assets','reserved_seconds','int8'),
    ('video_assets','original_filename','text'),
    ('video_assets','delete_requested_at','timestamptz'),
    ('video_assets','safe_failure_code','text'),
    ('video_assets','created_at','timestamptz'),
    ('video_assets','updated_at','timestamptz'),
    ('video_asset_attachments','tenant_id','uuid'),
    ('video_asset_attachments','video_asset_id','uuid'),
    ('video_asset_attachments','lesson_id','uuid'),
    ('lessons','id','uuid'),
    ('lessons','tenant_id','uuid'),
    ('lessons','section_id','uuid'),
    ('lessons','course_id','uuid'),
    ('lessons','title','text'),
    ('lessons','sort_order','int4'),
    ('course_sections','id','uuid'),
    ('course_sections','tenant_id','uuid'),
    ('course_sections','course_id','uuid'),
    ('course_sections','sort_order','int4'),
    ('courses','id','uuid'),
    ('courses','tenant_id','uuid'),
    ('courses','title','text')
  ) expected(table_name, column_name, udt_name)
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
   and column_def.udt_name = expected.udt_name;

  if v_installed_columns <> v_required_columns then
    raise exception 'VIDEO-2C2D0 required projection columns have drifted.'
      using errcode = '55000';
  end if;

  if v_helper is null
     or pg_get_userbyid((select proowner from pg_proc where oid = v_helper))
       <> 'postgres'
     or not (select prosecdef from pg_proc where oid = v_helper)
     or (select provolatile from pg_proc where oid = v_helper) <> 's'
     or (select proconfig from pg_proc where oid = v_helper)
       <> array['search_path=public, pg_temp']
     or md5(regexp_replace(
       (select prosrc from pg_proc where oid = v_helper),
       '[[:space:]]+', '', 'g'
     )) <> '013b807c7f5e4d4e97fbb5609b2f5750'
     or has_function_privilege('anon', v_helper, 'EXECUTE')
     or has_function_privilege('authenticated', v_helper, 'EXECUTE')
     or has_function_privilege('service_role', v_helper, 'EXECUTE')
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = v_helper
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'VIDEO-2C2D0 Owner/Admin helper authority has drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments')
    ) protected(identity)
    left join pg_class relation on relation.oid = to_regclass(protected.identity)
    where relation.oid is null
       or not relation.relrowsecurity
       or pg_get_userbyid(relation.relowner) <> 'postgres'
  ) or exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments')
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
      ('public.video_asset_attachments')
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
    raise exception 'VIDEO-2C2D0 protected video relation authority has drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
      and constraint_row.conname = 'video_asset_attachments_asset_fk'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = to_regclass('public.video_assets')
  ) or not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid =
        to_regclass('public.video_asset_attachments')
      and constraint_row.conname = 'video_asset_attachments_lesson_fk'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = to_regclass('public.lessons')
  ) then
    raise exception 'VIDEO-2C2D0 attachment relationship authority has drifted.'
      using errcode = '55000';
  end if;

  select count(*) into v_precedent_count
  from (values
    ('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    ('public.get_native_video_capacity_server(uuid,uuid)'),
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
    ('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    ('public.authorize_native_video_playback_server(uuid,uuid,uuid)')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  where pg_get_userbyid(procedure.proowner) = 'postgres'
    and procedure.prosecdef
    and procedure.proconfig = array['search_path=public, pg_temp']
    and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    );

  if v_precedent_count <> 6 then
    raise exception 'VIDEO-2C2D0 native-video server authority has drifted.'
      using errcode = '55000';
  end if;
end;
$$;

create function public.get_native_video_management_projection_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_asset_id uuid,
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_asset_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_exact boolean := p_asset_id is not null;
  v_limit integer;
  v_result jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Native video management projection input is invalid.'
      using errcode = '22023';
  end if;

  perform coachfort_internal.assert_native_video_owner_admin(
    p_tenant_id, p_actor_user_id
  );

  if (p_cursor_created_at is null) <> (p_cursor_asset_id is null) then
    raise exception 'Native video management cursor is invalid.'
      using errcode = '22023';
  end if;

  if v_exact then
    if p_limit is distinct from 1
       or p_cursor_created_at is not null
       or p_cursor_asset_id is not null then
      raise exception 'Native video exact projection input is invalid.'
        using errcode = '22023';
    end if;
    v_limit := 1;
  else
    if p_limit is null or p_limit < 1 then
      raise exception 'Native video list projection limit is invalid.'
        using errcode = '22023';
    end if;
    v_limit := least(p_limit, 100);
  end if;

  with candidate_assets as (
    select
      asset.id,
      asset.original_filename,
      asset.status,
      asset.duration_seconds,
      asset.reserved_seconds,
      asset.created_at,
      asset.updated_at,
      asset.delete_requested_at,
      asset.safe_failure_code
    from public.video_assets asset
    where asset.tenant_id = p_tenant_id
      and (
        (v_exact and asset.id = p_asset_id)
        or (
          not v_exact
          and (
            p_cursor_created_at is null
            or asset.created_at < p_cursor_created_at
            or (
              asset.created_at = p_cursor_created_at
              and asset.id < p_cursor_asset_id
            )
          )
        )
      )
    order by asset.created_at desc, asset.id desc
    limit case when v_exact then 1 else v_limit + 1 end
  ), returned_assets as (
    select candidate.*
    from candidate_assets candidate
    order by candidate.created_at desc, candidate.id desc
    limit v_limit
  ), projected_assets as (
    select
      asset.id,
      asset.created_at,
      jsonb_build_object(
        'asset_id', asset.id,
        'original_filename', asset.original_filename,
        'status', asset.status,
        'duration_seconds', asset.duration_seconds,
        'reserved_seconds', asset.reserved_seconds,
        'created_at', asset.created_at,
        'updated_at', asset.updated_at,
        'delete_requested_at', asset.delete_requested_at,
        'safe_failure_code', asset.safe_failure_code,
        'attachments', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'course_id', course.id,
              'course_title', course.title,
              'lesson_id', lesson.id,
              'lesson_title', lesson.title
            )
            order by
              course.id,
              section.sort_order,
              section.id,
              lesson.sort_order,
              lesson.id
          )
          from public.video_asset_attachments attachment
          join public.lessons lesson
            on lesson.id = attachment.lesson_id
           and lesson.tenant_id = attachment.tenant_id
          join public.course_sections section
            on section.id = lesson.section_id
           and section.tenant_id = lesson.tenant_id
           and section.course_id = lesson.course_id
          join public.courses course
            on course.id = lesson.course_id
           and course.id = section.course_id
           and course.tenant_id = lesson.tenant_id
           and course.tenant_id = section.tenant_id
          where attachment.tenant_id = p_tenant_id
            and attachment.video_asset_id = asset.id
        ), '[]'::jsonb)
      ) item
    from returned_assets asset
  ), page_state as (
    select count(*) > v_limit as has_more
    from candidate_assets
  ), last_returned as (
    select asset.id, asset.created_at
    from returned_assets asset
    order by asset.created_at asc, asset.id asc
    limit 1
  )
  select jsonb_build_object(
    'mode', case when v_exact then 'exact' else 'list' end,
    'items', coalesce((
      select jsonb_agg(
        projected.item order by projected.created_at desc, projected.id desc
      )
      from projected_assets projected
    ), '[]'::jsonb),
    'next_cursor', case
      when not v_exact and (select has_more from page_state) then (
        select jsonb_build_object(
          'created_at', last_item.created_at,
          'asset_id', last_item.id
        )
        from last_returned last_item
      )
      else null
    end
  ) into v_result;

  return v_result;
end;
$$;

alter function public.get_native_video_management_projection_server(
  uuid,uuid,uuid,integer,timestamptz,uuid
) owner to postgres;

revoke all on function public.get_native_video_management_projection_server(
  uuid,uuid,uuid,integer,timestamptz,uuid
) from public, anon, authenticated, service_role;

grant execute on function public.get_native_video_management_projection_server(
  uuid,uuid,uuid,integer,timestamptz,uuid
) to service_role;

do $$
declare
  v_function oid := to_regprocedure(
    'public.get_native_video_management_projection_server(uuid,uuid,uuid,integer,timestamptz,uuid)'
  );
  v_source text;
begin
  if v_function is null
     or (
       select count(*)
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname = 'get_native_video_management_projection_server'
     ) <> 1
     or pg_get_userbyid((select proowner from pg_proc where oid = v_function))
       <> 'postgres'
     or not (select prosecdef from pg_proc where oid = v_function)
     or (select provolatile from pg_proc where oid = v_function) <> 's'
     or (select proconfig from pg_proc where oid = v_function)
       <> array['search_path=public, pg_temp']
     or (select pg_get_function_result(v_function)) <> 'jsonb'
     or (select proargnames from pg_proc where oid = v_function)
       <> array[
         'p_tenant_id','p_actor_user_id','p_asset_id','p_limit',
         'p_cursor_created_at','p_cursor_asset_id'
       ]
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
    raise exception 'VIDEO-2C2D0 function security verification failed.'
      using errcode = '55000';
  end if;

  select lower(pg_get_functiondef(v_function)) into v_source;
  if v_source not like '%assert_native_video_owner_admin%'
     or v_source not like '%asset.tenant_id = p_tenant_id%'
     or v_source not like '%attachment.tenant_id = p_tenant_id%'
     or v_source not like '%asset.created_at < p_cursor_created_at%'
     or v_source not like '%asset.id < p_cursor_asset_id%'
     or v_source not like '%least(p_limit, 100)%'
     or v_source like '%assert_tenant_operational_access%'
     or v_source like '%assert_effective_operational_feature%'
     or v_source like '%video_provider_events%'
     or v_source like '%video_upload_sessions%'
     or v_source ~ '\m(insert|update|delete|merge|truncate)\M' then
    raise exception 'VIDEO-2C2D0 function source verification failed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments')
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
      ('public.video_asset_attachments')
    ) protected(identity)
    join pg_class relation on relation.oid = to_regclass(protected.identity)
    cross join lateral aclexplode(coalesce(
      relation.relacl, acldefault('r', relation.relowner)
    )) acl
    where acl.grantee = 0
      and acl.privilege_type in (
        'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
      )
  ) or exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments')
    ) protected(identity)
    left join pg_class relation on relation.oid = to_regclass(protected.identity)
    where relation.oid is null
       or not relation.relrowsecurity
       or pg_get_userbyid(relation.relowner) <> 'postgres'
  ) then
    raise exception 'VIDEO-2C2D0 changed protected table authority.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
