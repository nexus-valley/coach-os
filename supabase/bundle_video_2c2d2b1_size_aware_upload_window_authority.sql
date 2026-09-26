-- Bundle VIDEO-2C2D2-B1: size-aware initial native-video upload window authority.
-- This migration changes only fresh reservation expiry calculation. It does not
-- renew existing capabilities, backfill rows, or alter provider/session schema.

begin;

create temp table video2c2d2b1_expected_dependencies (
  identity text primary key
) on commit drop;

insert into video2c2d2b1_expected_dependencies (identity) values
  ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
  ('coachfort_internal.assert_tenant_operational_access(uuid)'),
  ('coachfort_internal.assert_effective_operational_feature(uuid,text)'),
  ('coachfort_internal.native_video_capacity_authority_lock(uuid)'),
  ('coachfort_internal.resolve_native_video_capacity(uuid)'),
  ('coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
  ('public.claim_native_video_upload_provisioning_server(uuid)'),
  ('public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'),
  ('public.expire_unbound_native_video_upload_server(uuid,uuid,integer)'),
  ('public.claim_native_video_reconciliation_batch_server(integer,integer)');

do $video2c2d2b1_prerequisite$
declare
  v_identity constant text :=
    'public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)';
  v_oid oid := to_regprocedure(v_identity);
  v_source text;
  v_role_source text;
begin
  if (select count(*) from video2c2d2b1_expected_dependencies) <> 10
     or exists (
       select 1
       from video2c2d2b1_expected_dependencies expected
       where to_regprocedure(expected.identity) is null
     ) then
    raise exception 'VIDEO-2C2D2-B1 prerequisite dependency authority drifted.'
      using errcode = '55000';
  end if;

  if v_oid is null then
    raise exception 'VIDEO-2C2D2-B1 prerequisite reservation authority is absent.'
      using errcode = '55000';
  end if;

  select lower(procedure.prosrc) into v_source
  from pg_proc procedure
  where procedure.oid = v_oid;

  select lower(procedure.prosrc) into v_role_source
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'
  );

  if (select count(*)
      from pg_proc procedure
      join pg_namespace namespace_def
        on namespace_def.oid = procedure.pronamespace
      where namespace_def.nspname = 'public'
        and procedure.proname = 'reserve_native_video_upload_server') <> 1
     or not exists (
       select 1
       from pg_proc procedure
       where procedure.oid = v_oid
         and pg_get_userbyid(procedure.proowner) = 'postgres'
         and procedure.prokind = 'f'
         and procedure.prorettype = 'jsonb'::regtype
         and procedure.prosecdef
         and procedure.provolatile = 'v'
         and procedure.proconfig is not distinct from
           array['search_path=public, pg_temp']
     )
     or not has_function_privilege('service_role', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or exists (
       select 1
       from aclexplode(coalesce(
         (select procedure.proacl from pg_proc procedure where procedure.oid = v_oid),
         acldefault('f', (select procedure.proowner
           from pg_proc procedure where procedure.oid = v_oid))
       )) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee = 0
     )
     or exists (
       select 1
       from aclexplode(coalesce(
         (select procedure.proacl from pg_proc procedure where procedure.oid = v_oid),
         acldefault('f', (select procedure.proowner
           from pg_proc procedure where procedure.oid = v_oid))
       )) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee <> (select procedure.proowner
           from pg_proc procedure where procedure.oid = v_oid)
         and acl.grantee <> 'service_role'::regrole::oid
     ) then
    raise exception 'VIDEO-2C2D2-B1 prerequisite function security drifted.'
      using errcode = '55000';
  end if;

  if v_source not like '%assert_native_video_owner_admin(%'
     or v_source not like '%assert_tenant_operational_access(p_tenant_id)%'
     or v_source not like
       '%assert_effective_operational_feature(%p_tenant_id, ''native_video''%'
     or v_source not like
       '%p_expected_duration_seconds not between 1 and 7200%'
     or v_source not like
       '%p_declared_size_bytes not between 1 and 10737418240%'
     or v_source not like
       '%''video/mp4'',''video/quicktime'',''video/webm'',''video/x-matroska''%'
     or v_source not like '%''video/x-msvideo'',''video/mpeg''%'
     or v_source not like '%native_video_capacity_authority_lock(p_tenant_id)%'
     or position('native_video_capacity_authority_lock(p_tenant_id)' in v_source)
        >= position('select * into v_existing' in v_source)
     or v_source not like
       '%asset.tenant_id = p_tenant_id and asset.request_id = p_request_id%'
     or v_source not like '%for update%'
     or v_source not like
       '%request id was reused with different inputs%23505%'
     or v_source not like
       '%''reservation_expires_at'', v_existing.reservation_expires_at%'
     or v_source not like '%''replayed'', true%'
     or position('if found then' in v_source)
        >= position('v_capacity :=' in v_source)
     or v_source not like '%resolve_native_video_capacity(p_tenant_id)%'
     or v_source not like '%resolve_native_video_usage(p_tenant_id, null)%'
     or v_source not like '%native video storage capacity is full%'
     or v_source not like '%now() + interval ''90 minutes''%'
     or v_source like '%v_transfer_seconds%'
     or v_source like '%v_window_seconds%'
     or v_source not like
       '%''reservation_expires_at'', v_asset.reservation_expires_at%'
     or v_source not like '%''replayed'', false%' then
    raise exception 'VIDEO-2C2D2-B1 prerequisite reservation semantics drifted.'
      using errcode = '55000';
  end if;

  if v_role_source is null
     or v_role_source not like '%member.tenant_id = p_tenant_id%'
     or v_role_source not like '%member.user_id = p_actor_user_id%'
     or v_role_source not like '%member.role in (''owner'',''admin'')%'
     or v_role_source like '%platform_admin%' then
    raise exception 'VIDEO-2C2D2-B1 prerequisite role authority drifted.'
      using errcode = '55000';
  end if;

  if to_regclass('public.video_assets') is null
     or to_regclass('public.video_asset_attachments') is null
     or to_regclass('public.video_provider_events') is null
     or to_regclass('coachfort_internal.video_upload_sessions') is null
     or exists (
       select 1
       from information_schema.table_privileges privilege
       where (privilege.table_schema, privilege.table_name) in (
         ('public', 'video_assets'),
         ('public', 'video_asset_attachments'),
         ('public', 'video_provider_events'),
         ('coachfort_internal', 'video_upload_sessions')
       )
         and privilege.grantee in (
           'PUBLIC', 'anon', 'authenticated', 'service_role'
         )
     ) then
    raise exception 'VIDEO-2C2D2-B1 protected video storage authority drifted.'
      using errcode = '55000';
  end if;
end;
$video2c2d2b1_prerequisite$;

create temp table video2c2d2b1_apply_baseline on commit drop as
select
  (select count(*) from public.video_assets) asset_rows,
  (select md5(coalesce(string_agg(
    md5(to_jsonb(asset)::text), '|' order by asset.id::text
  ), '')) from public.video_assets asset) asset_fingerprint,
  (select count(*) from public.video_asset_attachments) attachment_rows,
  (select md5(coalesce(string_agg(
    md5(to_jsonb(attachment)::text), '|' order by attachment.id::text
  ), '')) from public.video_asset_attachments attachment)
    attachment_fingerprint,
  (select count(*) from public.video_provider_events) provider_event_rows,
  (select md5(coalesce(string_agg(
    md5(to_jsonb(event_row)::text), '|' order by event_row.id::text
  ), '')) from public.video_provider_events event_row)
    provider_event_fingerprint,
  (select count(*) from coachfort_internal.video_upload_sessions) session_rows,
  (select md5(coalesce(string_agg(
    md5(to_jsonb(session_row)::text), '|'
      order by session_row.video_asset_id::text
  ), '')) from coachfort_internal.video_upload_sessions session_row)
    session_fingerprint,
  (
    select count(*)::integer
    from video2c2d2b1_expected_dependencies expected
    join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.identity)
  ) adjacent_function_count,
  (
    select jsonb_agg(expected.identity order by expected.identity)
    from video2c2d2b1_expected_dependencies expected
    join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.identity)
  ) adjacent_function_identities,
  (
    select jsonb_object_agg(
      expected.identity,
      jsonb_build_object(
        'resolved_identity', procedure.oid::regprocedure::text,
        'definition', pg_get_functiondef(procedure.oid),
        'owner', pg_get_userbyid(procedure.proowner),
        'acl', coalesce(procedure.proacl::text, ''),
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile,
        'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
      ) order by expected.identity
    )
    from video2c2d2b1_expected_dependencies expected
    join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.identity)
  ) adjacent_function_contract;

create or replace function public.reserve_native_video_upload_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_expected_duration_seconds bigint,
  p_declared_size_bytes bigint,
  p_declared_mime_type text,
  p_safe_filename text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_mime text := lower(btrim(coalesce(p_declared_mime_type, '')));
  v_filename text := btrim(coalesce(p_safe_filename, ''));
  v_existing public.video_assets%rowtype;
  v_capacity jsonb;
  v_usage jsonb;
  v_effective_seconds bigint;
  v_transfer_seconds bigint;
  v_window_seconds bigint;
  v_authority_now timestamptz;
  v_reservation_expires_at timestamptz;
  v_asset public.video_assets%rowtype;
begin
  perform coachfort_internal.assert_native_video_owner_admin(
    p_tenant_id, p_actor_user_id
  );
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'native_video'
  );

  if p_request_id is null
     or p_expected_duration_seconds is null
     or p_expected_duration_seconds not between 1 and 7200
     or p_declared_size_bytes is null
     or p_declared_size_bytes not between 1 and 10737418240
     or v_mime not in (
       'video/mp4','video/quicktime','video/webm','video/x-matroska',
       'video/x-msvideo','video/mpeg'
     )
     or char_length(v_filename) not between 1 and 255
     or v_filename ~ '[\\/[:cntrl:]]' then
    raise exception 'Native video upload request is invalid.' using errcode = '22023';
  end if;

  perform coachfort_internal.native_video_capacity_authority_lock(p_tenant_id);

  select * into v_existing
  from public.video_assets asset
  where asset.tenant_id = p_tenant_id and asset.request_id = p_request_id
  for update;

  if found then
    if (v_existing.created_by, v_existing.reserved_seconds,
        v_existing.declared_size_bytes, v_existing.declared_mime_type,
        v_existing.original_filename)
       is distinct from
       (p_actor_user_id, p_expected_duration_seconds,
        p_declared_size_bytes, v_mime, v_filename) then
      raise exception 'Native video request id was reused with different inputs.'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'asset_id', v_existing.id,
      'status', v_existing.status,
      'reserved_seconds', v_existing.reserved_seconds,
      'reservation_expires_at', v_existing.reservation_expires_at,
      'replayed', true
    );
  end if;

  v_capacity := coachfort_internal.resolve_native_video_capacity(p_tenant_id);
  v_usage := coachfort_internal.resolve_native_video_usage(p_tenant_id, null);
  v_effective_seconds := (v_capacity->>'effective_capacity_minutes')::bigint * 60;

  if (v_usage->>'stored_seconds')::bigint
       + (v_usage->>'reserved_seconds')::bigint
       + p_expected_duration_seconds > v_effective_seconds then
    raise exception 'Native video storage capacity is full.' using errcode = 'P0001';
  end if;

  v_transfer_seconds := ceil(
    (p_declared_size_bytes::numeric * 8::numeric) / 1000000::numeric
  )::bigint;
  v_window_seconds := least(
    86400::bigint,
    greatest(7200::bigint, v_transfer_seconds + 7200::bigint)
  );
  v_authority_now := now();
  v_reservation_expires_at := v_authority_now
    + make_interval(secs => v_window_seconds::double precision);

  insert into public.video_assets (
    tenant_id, provider, status, reserved_seconds, reservation_expires_at,
    original_filename, declared_mime_type, declared_size_bytes,
    request_id, created_by
  ) values (
    p_tenant_id, 'cloudflare_stream', 'upload_pending',
    p_expected_duration_seconds, v_reservation_expires_at,
    v_filename, v_mime, p_declared_size_bytes, p_request_id, p_actor_user_id
  ) returning * into v_asset;

  return jsonb_build_object(
    'asset_id', v_asset.id,
    'status', v_asset.status,
    'reserved_seconds', v_asset.reserved_seconds,
    'reservation_expires_at', v_asset.reservation_expires_at,
    'replayed', false
  );
end;
$function$;

alter function public.reserve_native_video_upload_server(
  uuid,uuid,bigint,bigint,text,text,uuid
) owner to postgres;

revoke all on function public.reserve_native_video_upload_server(
  uuid,uuid,bigint,bigint,text,text,uuid
) from public, anon, authenticated, service_role;

grant execute on function public.reserve_native_video_upload_server(
  uuid,uuid,bigint,bigint,text,text,uuid
) to service_role;

do $video2c2d2b1_self_verify$
declare
  v_identity constant text :=
    'public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)';
  v_oid oid := to_regprocedure(v_identity);
  v_source text;
  v_baseline video2c2d2b1_apply_baseline%rowtype;
  v_adjacent jsonb;
  v_adjacent_count integer;
  v_adjacent_identities jsonb;
  v_actual_window bigint;
  v_boundary record;
begin
  select * into v_baseline from video2c2d2b1_apply_baseline;
  select lower(procedure.prosrc) into v_source
  from pg_proc procedure
  where procedure.oid = v_oid;

  if v_oid is null
     or (select count(*)
       from pg_proc procedure
       join pg_namespace namespace_def
         on namespace_def.oid = procedure.pronamespace
       where namespace_def.nspname = 'public'
         and procedure.proname = 'reserve_native_video_upload_server') <> 1
     or not exists (
       select 1
       from pg_proc procedure
       where procedure.oid = v_oid
         and pg_get_userbyid(procedure.proowner) = 'postgres'
         and procedure.prokind = 'f'
         and procedure.prorettype = 'jsonb'::regtype
         and procedure.prosecdef
         and procedure.provolatile = 'v'
         and procedure.proconfig is not distinct from
           array['search_path=public, pg_temp']
     )
     or not has_function_privilege('service_role', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or exists (
       select 1
       from aclexplode(coalesce(
         (select procedure.proacl from pg_proc procedure where procedure.oid = v_oid),
         acldefault('f', (select procedure.proowner
           from pg_proc procedure where procedure.oid = v_oid))
       )) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee = 0
     )
     or exists (
       select 1
       from aclexplode(coalesce(
         (select procedure.proacl from pg_proc procedure where procedure.oid = v_oid),
         acldefault('f', (select procedure.proowner
           from pg_proc procedure where procedure.oid = v_oid))
       )) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee <> (select procedure.proowner
           from pg_proc procedure where procedure.oid = v_oid)
         and acl.grantee <> 'service_role'::regrole::oid
     ) then
    raise exception 'VIDEO-2C2D2-B1 replacement function security failed.'
      using errcode = '55000';
  end if;

  if v_source not like '%assert_native_video_owner_admin(%'
     or v_source not like '%assert_tenant_operational_access(p_tenant_id)%'
     or v_source not like
       '%assert_effective_operational_feature(%p_tenant_id, ''native_video''%'
     or v_source not like
       '%p_expected_duration_seconds not between 1 and 7200%'
     or v_source not like
       '%p_declared_size_bytes not between 1 and 10737418240%'
     or v_source not like '%native_video_capacity_authority_lock(p_tenant_id)%'
     or position('native_video_capacity_authority_lock(p_tenant_id)' in v_source)
        >= position('select * into v_existing' in v_source)
     or v_source not like
       '%request id was reused with different inputs%23505%'
     or v_source not like
       '%''reservation_expires_at'', v_existing.reservation_expires_at%'
     or position('if found then' in v_source)
        >= position('v_transfer_seconds := ceil' in v_source)
     or v_source not like
       '%p_declared_size_bytes::numeric * 8::numeric%1000000::numeric%'
     or v_source not like
       '%least(%86400::bigint%greatest(7200::bigint, v_transfer_seconds + 7200::bigint)%'
     or v_source not like '%v_authority_now := now()%'
     or v_source not like
       '%make_interval(secs => v_window_seconds::double precision)%'
     or v_source not like
       '%p_expected_duration_seconds, v_reservation_expires_at%'
     or v_source like '%interval ''90 minutes''%'
     or v_source like '%update public.video_assets%'
     or v_source not like
       '%''reservation_expires_at'', v_asset.reservation_expires_at%'
     or v_source not like '%''replayed'', false%' then
    raise exception 'VIDEO-2C2D2-B1 replacement function semantics failed.'
      using errcode = '55000';
  end if;

  for v_boundary in
    select * from (values
      (1::bigint, 7201::bigint),
      (1048576::bigint, 7209::bigint),
      (1073741824::bigint, 15790::bigint),
      (2147483648::bigint, 24380::bigint),
      (5368709120::bigint, 50150::bigint),
      (10737418240::bigint, 86400::bigint)
    ) boundary(declared_size_bytes, expected_window_seconds)
  loop
    v_actual_window := least(
      86400::bigint,
      greatest(
        7200::bigint,
        ceil(
          (v_boundary.declared_size_bytes::numeric * 8::numeric)
          / 1000000::numeric
        )::bigint + 7200::bigint
      )
    );
    if v_actual_window is distinct from v_boundary.expected_window_seconds
       or v_actual_window < 7200
       or v_actual_window > 86400 then
      raise exception 'VIDEO-2C2D2-B1 formula boundary verification failed.'
        using errcode = '55000';
    end if;
  end loop;

  if (select count(*) from public.video_assets)
       is distinct from v_baseline.asset_rows
     or (select md5(coalesce(string_agg(
       md5(to_jsonb(asset)::text), '|' order by asset.id::text
     ), '')) from public.video_assets asset)
       is distinct from v_baseline.asset_fingerprint
     or (select count(*) from public.video_asset_attachments)
       is distinct from v_baseline.attachment_rows
     or (select md5(coalesce(string_agg(
       md5(to_jsonb(attachment)::text), '|' order by attachment.id::text
     ), '')) from public.video_asset_attachments attachment)
       is distinct from v_baseline.attachment_fingerprint
     or (select count(*) from public.video_provider_events)
       is distinct from v_baseline.provider_event_rows
     or (select md5(coalesce(string_agg(
       md5(to_jsonb(event_row)::text), '|' order by event_row.id::text
     ), '')) from public.video_provider_events event_row)
       is distinct from v_baseline.provider_event_fingerprint
     or (select count(*) from coachfort_internal.video_upload_sessions)
       is distinct from v_baseline.session_rows
     or (select md5(coalesce(string_agg(
       md5(to_jsonb(session_row)::text), '|'
         order by session_row.video_asset_id::text
     ), '')) from coachfort_internal.video_upload_sessions session_row)
       is distinct from v_baseline.session_fingerprint then
    raise exception 'VIDEO-2C2D2-B1 changed protected video business data.'
      using errcode = '55000';
  end if;

  select
    count(*)::integer,
    jsonb_agg(expected.identity order by expected.identity),
    jsonb_object_agg(
      expected.identity,
      jsonb_build_object(
        'resolved_identity', procedure.oid::regprocedure::text,
        'definition', pg_get_functiondef(procedure.oid),
        'owner', pg_get_userbyid(procedure.proowner),
        'acl', coalesce(procedure.proacl::text, ''),
        'security_definer', procedure.prosecdef,
        'volatility', procedure.provolatile,
        'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
      ) order by expected.identity
    )
  into v_adjacent_count, v_adjacent_identities, v_adjacent
  from video2c2d2b1_expected_dependencies expected
  join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity);

  if (select count(*) from video2c2d2b1_expected_dependencies) <> 10
     or v_adjacent_count <> 10
     or v_adjacent_count is distinct from v_baseline.adjacent_function_count
     or v_adjacent_identities is distinct from
       v_baseline.adjacent_function_identities
     or v_adjacent is distinct from v_baseline.adjacent_function_contract then
    raise exception 'VIDEO-2C2D2-B1 changed adjacent video authority.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where (privilege.table_schema, privilege.table_name) in (
      ('public', 'video_assets'),
      ('public', 'video_asset_attachments'),
      ('public', 'video_provider_events'),
      ('coachfort_internal', 'video_upload_sessions')
    )
      and privilege.grantee in (
        'PUBLIC', 'anon', 'authenticated', 'service_role'
      )
  ) then
    raise exception 'VIDEO-2C2D2-B1 changed protected table ACLs.'
      using errcode = '55000';
  end if;
end;
$video2c2d2b1_self_verify$;

commit;
