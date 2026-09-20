-- Bundle VIDEO-2B1D: cross-source provider observation idempotency
-- Execute PRE, APPLY, and POST separately. This file has not been executed.

-- ============================================================================
-- PRE-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with
target_functions(identity) as (
  values
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)')
),
function_state as (
  select
    count(*) = 3
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile = 'v')
      and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as target_function_security,
    jsonb_object_agg(
      target.identity,
      md5(pg_get_functiondef(procedure.oid))
      order by target.identity
    ) as target_function_fingerprints
  from target_functions target
  join pg_proc procedure on procedure.oid = to_regprocedure(target.identity)
),
source_state as (
  select
    lower(pg_get_functiondef(to_regprocedure(
      'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'
    ))) as record_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
    ))) as finalize_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'
    ))) as observe_source
),
baseline_contract as (
  select
    record_source like '%v_event.safe_payload_hash, v_event.safe_evidence_json)%'
      and record_source like '%p_safe_payload_hash, v_evidence) then%'
      and finalize_source like '%v_event.safe_payload_hash, v_event.safe_evidence_json)%'
      and finalize_source like '%p_event_time, p_safe_payload_hash, v_evidence) then%'
      and observe_source like '%v_event.safe_payload_hash, v_event.safe_evidence_json)%'
      and observe_source like '%p_event_time, p_safe_payload_hash, v_evidence) then%'
      and record_source like '%on conflict (provider, event_key) do nothing%'
      and finalize_source like '%on conflict (provider, event_key) do nothing%'
      and observe_source like '%on conflict (provider, event_key) do nothing%'
      and finalize_source like '%if v_asset.status = ''upload_pending''%'
      and observe_source like '%p_event_time < v_asset.last_provider_observed_at%'
      and record_source not like '%provider_event_replay_evidence_matches%'
      and finalize_source not like '%provider_event_replay_evidence_matches%'
      and observe_source not like '%provider_event_replay_evidence_matches%'
      as expected_video2b0_baseline
  from source_state
),
relation_state as (
  select
    to_regclass('public.video_provider_events') is not null
      and to_regclass('public.video_assets') is not null
      and to_regclass('coachfort_internal.video_upload_sessions') is not null
      and (select class.relrowsecurity
        from pg_class class
        where class.oid = to_regclass('public.video_provider_events'))
      and (select count(*) = 1
        from pg_constraint constraint_def
        where constraint_def.conrelid = to_regclass('public.video_provider_events')
          and constraint_def.conname = 'video_provider_events_identity_key'
          and constraint_def.contype = 'u')
      as provider_event_authority_ready
),
direct_acl as (
  select not exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'video_provider_events'
      and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
      and privilege.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ) as direct_writes_absent
),
event_inventory as (
  select
    count(*) as provider_event_rows,
    count(*) filter (where safe_evidence_json ? 'observation_source')
      as rows_with_observation_source,
    count(*) filter (
      where safe_evidence_json ? 'observation_source'
        and safe_evidence_json->>'observation_source' not in ('webhook','reconciliation')
    ) as rows_with_other_observation_source,
    count(*) filter (where safe_payload_hash is not null) as rows_with_safe_payload_hash
  from public.video_provider_events
),
gate as (
  select
    function_state.target_function_security
      and baseline_contract.expected_video2b0_baseline
      and relation_state.provider_event_authority_ready
      and direct_acl.direct_writes_absent
      and to_regprocedure(
        'coachfort_internal.provider_event_replay_evidence_matches(text,jsonb,text,jsonb)'
      ) is null
      as ready_for_apply
  from function_state, baseline_contract, relation_state, direct_acl
)
select
  gate.ready_for_apply,
  function_state.target_function_security,
  function_state.target_function_fingerprints,
  baseline_contract.expected_video2b0_baseline,
  relation_state.provider_event_authority_ready,
  direct_acl.direct_writes_absent,
  event_inventory.provider_event_rows,
  event_inventory.rows_with_observation_source,
  event_inventory.rows_with_other_observation_source,
  event_inventory.rows_with_safe_payload_hash,
  true as existing_provider_events_are_not_rewritten
from gate, function_state, baseline_contract, relation_state, direct_acl,
     event_inventory;

-- ============================================================================
-- APPLY (TRANSACTIONAL; execute only after PRE review)
-- ============================================================================

begin;

do $$
declare
  v_ready boolean;
begin
  with source_state as (
    select
      lower(pg_get_functiondef(to_regprocedure(
        'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'
      ))) as record_source,
      lower(pg_get_functiondef(to_regprocedure(
        'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
      ))) as finalize_source,
      lower(pg_get_functiondef(to_regprocedure(
        'public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'
      ))) as observe_source
  )
  select
    to_regprocedure(
      'coachfort_internal.provider_event_replay_evidence_matches(text,jsonb,text,jsonb)'
    ) is null
      and to_regclass('public.video_provider_events') is not null
      and to_regclass('coachfort_internal.video_upload_sessions') is not null
      and record_source like '%v_event.safe_payload_hash, v_event.safe_evidence_json)%'
      and record_source like '%p_safe_payload_hash, v_evidence) then%'
      and finalize_source like '%v_event.safe_payload_hash, v_event.safe_evidence_json)%'
      and finalize_source like '%p_event_time, p_safe_payload_hash, v_evidence) then%'
      and observe_source like '%v_event.safe_payload_hash, v_event.safe_evidence_json)%'
      and observe_source like '%p_event_time, p_safe_payload_hash, v_evidence) then%'
      and finalize_source like '%if v_asset.status = ''upload_pending''%'
      and observe_source like '%p_event_time < v_asset.last_provider_observed_at%'
      and not exists (
        select 1
        from information_schema.table_privileges privilege
        where privilege.table_schema = 'public'
          and privilege.table_name = 'video_provider_events'
          and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
          and privilege.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
      )
    into v_ready
  from source_state;

  if v_ready is distinct from true then
    raise exception 'VIDEO-2B1D prerequisite authority does not match the reviewed baseline.'
      using errcode = '55000';
  end if;
end;
$$;

create temp table video2b1d_apply_baseline on commit drop as
select
  (select count(*) from public.video_assets) as video_asset_count,
  (select md5(coalesce(string_agg(to_jsonb(asset)::text, '|' order by asset.id), ''))
    from public.video_assets asset) as video_asset_fingerprint,
  (select count(*) from public.video_provider_events) as provider_event_count,
  (select md5(coalesce(string_agg(to_jsonb(event_row)::text, '|' order by event_row.id), ''))
    from public.video_provider_events event_row) as provider_event_fingerprint,
  (select count(*) from coachfort_internal.video_upload_sessions) as session_count,
  (select md5(coalesce(string_agg(to_jsonb(session_row)::text, '|'
    order by session_row.video_asset_id), ''))
    from coachfort_internal.video_upload_sessions session_row) as session_fingerprint;

create function coachfort_internal.provider_event_replay_evidence_matches(
  p_stored_hash text,
  p_stored_evidence jsonb,
  p_incoming_hash text,
  p_incoming_evidence jsonb
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select
    (
      p_stored_hash is not distinct from p_incoming_hash
      and coalesce(p_stored_evidence, '{}'::jsonb)
        is not distinct from coalesce(p_incoming_evidence, '{}'::jsonb)
    )
    or (
      coalesce(p_stored_evidence, '{}'::jsonb)->>'observation_source'
        in ('webhook','reconciliation')
      and coalesce(p_incoming_evidence, '{}'::jsonb)->>'observation_source'
        in ('webhook','reconciliation')
      and (coalesce(p_stored_evidence, '{}'::jsonb) - 'observation_source')
        is not distinct from
        (coalesce(p_incoming_evidence, '{}'::jsonb) - 'observation_source')
    );
$$;

alter function coachfort_internal.provider_event_replay_evidence_matches(
  text,jsonb,text,jsonb
) owner to postgres;
revoke all on function coachfort_internal.provider_event_replay_evidence_matches(
  text,jsonb,text,jsonb
) from public, anon, authenticated, service_role;

create or replace function public.record_native_video_provider_event_server(
  p_provider text,
  p_event_key text,
  p_event_type text,
  p_event_time timestamptz,
  p_provider_asset_id text,
  p_safe_payload_hash text default null,
  p_safe_evidence_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_event_key text := btrim(coalesce(p_event_key, ''));
  v_event_type text := lower(btrim(coalesce(p_event_type, '')));
  v_provider_asset_id text := nullif(btrim(coalesce(p_provider_asset_id, '')), '');
  v_evidence jsonb := coalesce(p_safe_evidence_json, '{}'::jsonb);
  v_asset public.video_assets%rowtype;
  v_event public.video_provider_events%rowtype;
  v_inserted boolean;
begin
  if v_provider not in ('cloudflare_stream','mux')
     or char_length(v_event_key) not between 1 and 255
     or v_event_key ~ '[[:cntrl:]]'
     or v_event_type !~ '^[a-z0-9_.-]{1,100}$'
     or p_event_time is null
     or p_event_time > now() + interval '10 minutes'
     or (v_provider_asset_id is not null and (
       char_length(v_provider_asset_id) not between 1 and 255
       or v_provider_asset_id ~ '[[:space:][:cntrl:]]'
     ))
     or (p_safe_payload_hash is not null
       and p_safe_payload_hash !~ '^[0-9a-f]{64}$')
     or jsonb_typeof(v_evidence) <> 'object'
     or char_length(v_evidence::text) > 3000
     or not coachfort_internal.video_provider_event_evidence_is_safe(v_evidence) then
    raise exception 'Native video provider event is invalid.' using errcode = '22023';
  end if;

  if v_provider_asset_id is not null then
    select * into v_asset
    from public.video_assets asset
    where asset.provider = v_provider
      and asset.provider_asset_id = v_provider_asset_id;
  end if;

  insert into public.video_provider_events (
    provider, event_key, tenant_id, video_asset_id, provider_asset_id,
    event_type, event_time, processing_status, safe_payload_hash,
    safe_evidence_json
  ) values (
    v_provider, v_event_key, v_asset.tenant_id, v_asset.id,
    v_provider_asset_id, v_event_type, p_event_time, 'received',
    p_safe_payload_hash, v_evidence
  )
  on conflict (provider, event_key) do nothing
  returning * into v_event;
  v_inserted := found;

  if not v_inserted then
    select * into v_event from public.video_provider_events event_row
    where event_row.provider = v_provider and event_row.event_key = v_event_key;
    if (v_event.event_type, v_event.provider_asset_id, v_event.event_time)
       is distinct from
       (v_event_type, v_provider_asset_id, p_event_time)
       or not coachfort_internal.provider_event_replay_evidence_matches(
         v_event.safe_payload_hash, v_event.safe_evidence_json,
         p_safe_payload_hash, v_evidence
       ) then
      raise exception 'Provider event key was reused with conflicting evidence.'
        using errcode = '23505';
    end if;
  end if;

  return jsonb_build_object(
    'event_id', v_event.id,
    'matched', v_event.video_asset_id is not null,
    'duplicate', not v_inserted
  );
end;
$$;

create or replace function public.finalize_native_video_asset_processing_server(
  p_asset_id uuid,
  p_provider_asset_id text,
  p_provider_duration_seconds bigint,
  p_outcome text,
  p_event_key text,
  p_event_time timestamptz,
  p_safe_payload_hash text default null,
  p_safe_evidence_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
  v_event public.video_provider_events%rowtype;
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_event_key text := btrim(coalesce(p_event_key, ''));
  v_provider_asset_id text := btrim(coalesce(p_provider_asset_id, ''));
  v_evidence jsonb := coalesce(p_safe_evidence_json, '{}'::jsonb);
  v_capacity jsonb;
  v_usage jsonb;
  v_failure text;
  v_duration_valid boolean;
begin
  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then raise exception 'Native video asset not found.' using errcode = '02000'; end if;
  if v_asset.provider not in ('cloudflare_stream','mux')
     or v_outcome not in ('ready','failed')
     or char_length(v_event_key) not between 1 and 255 or v_event_key ~ '[[:cntrl:]]'
     or char_length(v_provider_asset_id) not between 1 and 255
     or v_provider_asset_id ~ '[[:space:][:cntrl:]]'
     or p_event_time is null or p_event_time > now() + interval '10 minutes'
     or (p_safe_payload_hash is not null and p_safe_payload_hash !~ '^[0-9a-f]{64}$')
     or jsonb_typeof(v_evidence) <> 'object' or char_length(v_evidence::text) > 3000
     or not coachfort_internal.video_provider_event_evidence_is_safe(v_evidence)
     or (v_outcome = 'failed' and p_provider_duration_seconds is not null) then
    raise exception 'Native video finalization input is invalid.' using errcode = '22023';
  end if;
  v_duration_valid := p_provider_duration_seconds between 1 and 7200;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;
  if v_asset.provider_asset_id is distinct from v_provider_asset_id then
    raise exception 'Native video provider identity does not match the asset.' using errcode = '22023';
  end if;
  select * into v_session
  from coachfort_internal.video_upload_sessions session
  where session.video_asset_id = v_asset.id
  for update;
  if not found
     or v_session.provider_asset_id is distinct from v_provider_asset_id then
    raise exception 'Native video provider session authority is unavailable.'
      using errcode = '55000';
  end if;

  insert into public.video_provider_events (
    provider, event_key, tenant_id, video_asset_id, provider_asset_id,
    event_type, event_time, processing_status, safe_payload_hash, safe_evidence_json
  ) values (
    v_asset.provider, v_event_key, v_asset.tenant_id, v_asset.id,
    v_provider_asset_id, 'asset.' || v_outcome, p_event_time,
    'received', p_safe_payload_hash, v_evidence
  ) on conflict (provider, event_key) do nothing returning * into v_event;

  if not found then
    select * into v_event from public.video_provider_events event_row
    where event_row.provider = v_asset.provider and event_row.event_key = v_event_key;
    if (v_event.video_asset_id, v_event.provider_asset_id, v_event.event_type,
        v_event.event_time)
       is distinct from
       (v_asset.id, v_provider_asset_id, 'asset.' || v_outcome, p_event_time)
       or not coachfort_internal.provider_event_replay_evidence_matches(
         v_event.safe_payload_hash, v_event.safe_evidence_json,
         p_safe_payload_hash, v_evidence
       ) then
      raise exception 'Provider event key was reused with conflicting evidence.'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status,
      'failure_code', v_asset.safe_failure_code, 'replayed', true
    );
  end if;

  if v_asset.last_provider_observed_at is not null
     and p_event_time < v_asset.last_provider_observed_at then
    update public.video_provider_events set processing_status = 'ignored', processed_at = now()
    where id = v_event.id;
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status,
      'failure_code', v_asset.safe_failure_code, 'replayed', false,
      'stale_observation', true
    );
  end if;

  if v_asset.status = 'upload_pending' then
    update public.video_assets set status = 'processing'
    where id = v_asset.id returning * into v_asset;
  end if;
  if v_asset.status <> 'processing' then
    update public.video_provider_events set processing_status = 'ignored', processed_at = now()
    where id = v_event.id;
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status,
      'failure_code', v_asset.safe_failure_code, 'replayed', false
    );
  end if;

  if v_outcome = 'failed' then
    update public.video_assets set
      status = 'delete_pending', reservation_expires_at = null, failed_at = now(),
      delete_requested_at = now(), safe_failure_code = 'provider_processing_failed',
      last_provider_observed_at = p_event_time
    where id = v_asset.id returning * into v_asset;
  else
    if not coalesce(v_duration_valid, false) then
      v_failure := 'provider_duration_invalid';
    elsif p_provider_duration_seconds > v_asset.reserved_seconds then
      v_failure := 'provider_duration_exceeds_reservation';
    else
      v_capacity := coachfort_internal.resolve_native_video_capacity(v_asset.tenant_id);
      v_usage := coachfort_internal.resolve_native_video_usage(v_asset.tenant_id, v_asset.id);
      if (v_usage->>'stored_seconds')::bigint
           + (v_usage->>'reserved_seconds')::bigint + p_provider_duration_seconds
         > (v_capacity->>'effective_capacity_minutes')::bigint * 60 then
        v_failure := 'provider_duration_exceeds_capacity';
      end if;
    end if;
    if v_failure is not null then
      update public.video_assets set
        status = 'delete_pending',
        duration_seconds = case when v_duration_valid then p_provider_duration_seconds else null end,
        reserved_seconds = case when v_duration_valid then 0 else reserved_seconds end,
        reservation_expires_at = null, failed_at = now(), delete_requested_at = now(),
        safe_failure_code = v_failure, last_provider_observed_at = p_event_time
      where id = v_asset.id returning * into v_asset;
    else
      update public.video_assets set
        status = 'ready', duration_seconds = p_provider_duration_seconds,
        reserved_seconds = 0, reservation_expires_at = null, ready_at = now(),
        safe_failure_code = null, last_provider_observed_at = p_event_time
      where id = v_asset.id returning * into v_asset;
    end if;
  end if;

  update public.video_provider_events set processing_status = 'processed', processed_at = now()
  where id = v_event.id;
  update coachfort_internal.video_upload_sessions set
    state = 'closed', upload_url = null,
    claim_token = null, claim_started_at = null, claim_expires_at = null,
    reconciliation_claim_token = null, reconciliation_claimed_at = null,
    reconciliation_claim_expires_at = null,
    last_provider_state = case when v_outcome = 'ready' then 'ready' else 'error' end,
    last_reconciled_at = now(), safe_failure_code = v_asset.safe_failure_code
  where video_asset_id = v_asset.id;
  return jsonb_build_object(
    'asset_id', v_asset.id, 'status', v_asset.status,
    'failure_code', v_asset.safe_failure_code, 'replayed', false
  );
end;
$$;

create or replace function public.observe_native_video_provider_state_server(
  p_asset_id uuid,
  p_provider_asset_id text,
  p_provider_state text,
  p_provider_duration_seconds bigint,
  p_event_key text,
  p_event_time timestamptz,
  p_safe_payload_hash text default null,
  p_safe_evidence_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
  v_event public.video_provider_events%rowtype;
  v_state text := lower(btrim(coalesce(p_provider_state, '')));
  v_provider_asset_id text := btrim(coalesce(p_provider_asset_id, ''));
  v_event_key text := btrim(coalesce(p_event_key, ''));
  v_evidence jsonb := coalesce(p_safe_evidence_json, '{}'::jsonb);
  v_observation_accepted boolean := false;
begin
  if v_state not in ('pendingupload','downloading','queued','inprogress','ready','error','live-inprogress')
     or char_length(v_provider_asset_id) not between 1 and 255
     or v_provider_asset_id ~ '[[:space:][:cntrl:]]'
     or char_length(v_event_key) not between 1 and 255 or v_event_key ~ '[[:cntrl:]]'
     or p_event_time is null or p_event_time > now() + interval '10 minutes'
     or (p_safe_payload_hash is not null and p_safe_payload_hash !~ '^[0-9a-f]{64}$')
     or jsonb_typeof(v_evidence) <> 'object' or char_length(v_evidence::text) > 3000
     or not coachfort_internal.video_provider_event_evidence_is_safe(v_evidence) then
    raise exception 'Native video provider observation is invalid.' using errcode = '22023';
  end if;
  if v_state = 'ready' then
    return public.finalize_native_video_asset_processing_server(
      p_asset_id, v_provider_asset_id, p_provider_duration_seconds, 'ready',
      v_event_key, p_event_time, p_safe_payload_hash, v_evidence
    );
  elsif v_state = 'error' then
    return public.finalize_native_video_asset_processing_server(
      p_asset_id, v_provider_asset_id, null, 'failed',
      v_event_key, p_event_time, p_safe_payload_hash, v_evidence
    );
  end if;

  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then raise exception 'Native video asset not found.' using errcode = '02000'; end if;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;
  if v_asset.provider_asset_id is distinct from v_provider_asset_id then
    raise exception 'Native video provider identity does not match the asset.' using errcode = '22023';
  end if;
  select * into v_session
  from coachfort_internal.video_upload_sessions session
  where session.video_asset_id = v_asset.id
  for update;
  if not found
     or v_session.provider_asset_id is distinct from v_provider_asset_id then
    raise exception 'Native video provider session authority is unavailable.'
      using errcode = '55000';
  end if;

  insert into public.video_provider_events (
    provider, event_key, tenant_id, video_asset_id, provider_asset_id,
    event_type, event_time, processing_status, safe_payload_hash, safe_evidence_json
  ) values (
    v_asset.provider, v_event_key, v_asset.tenant_id, v_asset.id,
    v_provider_asset_id, 'asset.' || v_state, p_event_time,
    'received', p_safe_payload_hash, v_evidence
  ) on conflict (provider, event_key) do nothing returning * into v_event;
  if not found then
    select * into v_event from public.video_provider_events event_row
    where event_row.provider = v_asset.provider and event_row.event_key = v_event_key;
    if (v_event.video_asset_id, v_event.provider_asset_id, v_event.event_type,
        v_event.event_time)
       is distinct from
       (v_asset.id, v_provider_asset_id, 'asset.' || v_state, p_event_time)
       or not coachfort_internal.provider_event_replay_evidence_matches(
         v_event.safe_payload_hash, v_event.safe_evidence_json,
         p_safe_payload_hash, v_evidence
       ) then
      raise exception 'Provider event key was reused with conflicting evidence.'
        using errcode = '23505';
    end if;
    return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status, 'replayed', true);
  end if;
  if v_asset.last_provider_observed_at is not null
     and p_event_time < v_asset.last_provider_observed_at then
    update public.video_provider_events set processing_status = 'ignored', processed_at = now()
    where id = v_event.id;
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status,
      'stale_observation', true, 'replayed', false
    );
  end if;

  if v_state in ('downloading','queued','inprogress') then
    if v_asset.status = 'upload_pending' then
      update public.video_assets set
        status = 'processing', last_provider_observed_at = p_event_time
      where id = v_asset.id returning * into v_asset;
      v_observation_accepted := true;
    elsif v_asset.status <> 'deleted' then
      update public.video_assets set last_provider_observed_at = p_event_time
      where id = v_asset.id returning * into v_asset;
      v_observation_accepted := true;
    end if;
  elsif v_state = 'pendingupload' then
    if v_asset.status = 'upload_pending' then
      if v_asset.reservation_expires_at is null
         or v_asset.reservation_expires_at <= now()
         or (v_session.provider_upload_expires_at is not null
           and v_session.provider_upload_expires_at <= now()) then
        update public.video_assets set
          status = 'delete_pending', reservation_expires_at = null,
          delete_requested_at = now(), failed_at = now(),
          safe_failure_code = 'provider_upload_expired',
          last_provider_observed_at = p_event_time
        where id = v_asset.id returning * into v_asset;
      elsif v_session.state <> 'provisioned'
            or v_session.upload_url is null
            or v_session.provider_upload_expires_at is null then
        update public.video_assets set
          status = 'delete_pending', reservation_expires_at = null,
          delete_requested_at = now(), failed_at = now(),
          safe_failure_code = 'provider_upload_capability_unavailable',
          last_provider_observed_at = p_event_time
        where id = v_asset.id returning * into v_asset;
      else
        update public.video_assets set last_provider_observed_at = p_event_time
        where id = v_asset.id returning * into v_asset;
      end if;
      v_observation_accepted := true;
    elsif v_asset.status <> 'deleted' then
      update public.video_assets set last_provider_observed_at = p_event_time
      where id = v_asset.id returning * into v_asset;
      v_observation_accepted := true;
    end if;
  elsif v_state = 'live-inprogress' and v_asset.status <> 'deleted' then
    update public.video_assets set last_provider_observed_at = p_event_time
    where id = v_asset.id returning * into v_asset;
    v_observation_accepted := true;
  end if;

  update public.video_provider_events set
    processing_status = case
      when v_observation_accepted then 'processed' else 'ignored'
    end,
    processed_at = now()
  where id = v_event.id;

  if v_observation_accepted then
    update coachfort_internal.video_upload_sessions set
      state = case
        when v_asset.status in ('processing','delete_pending') then 'closed'
        else state
      end,
      upload_url = case
        when v_asset.status in ('processing','delete_pending') then null
        else upload_url
      end,
      claim_token = case
        when v_asset.status in ('processing','delete_pending') then null
        else claim_token
      end,
      claim_started_at = case
        when v_asset.status in ('processing','delete_pending') then null
        else claim_started_at
      end,
      claim_expires_at = case
        when v_asset.status in ('processing','delete_pending') then null
        else claim_expires_at
      end,
      last_provider_state = v_state, last_reconciled_at = now(),
      reconciliation_claim_token = null, reconciliation_claimed_at = null,
      reconciliation_claim_expires_at = null,
      safe_failure_code = coalesce(v_asset.safe_failure_code, safe_failure_code)
    where video_asset_id = v_asset.id;
  end if;
  return jsonb_build_object(
    'asset_id', v_asset.id, 'status', v_asset.status,
    'provider_state', v_state,
    'provider_deletion_required', v_asset.status = 'delete_pending',
    'failure_code', v_asset.safe_failure_code,
    'replayed', false
  );
end;
$$;

alter function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb
) owner to postgres;
alter function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb
) owner to postgres;
alter function public.observe_native_video_provider_state_server(
  uuid,text,text,bigint,text,timestamptz,text,jsonb
) owner to postgres;

revoke all on function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb
) from public, anon, authenticated;
revoke all on function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb
) from public, anon, authenticated;
revoke all on function public.observe_native_video_provider_state_server(
  uuid,text,text,bigint,text,timestamptz,text,jsonb
) from public, anon, authenticated;
grant execute on function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb
) to service_role;
grant execute on function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb
) to service_role;
grant execute on function public.observe_native_video_provider_state_server(
  uuid,text,text,bigint,text,timestamptz,text,jsonb
) to service_role;

do $$
declare
  v_unchanged boolean;
begin
  select
    baseline.video_asset_count = (select count(*) from public.video_assets)
      and baseline.video_asset_fingerprint = (
        select md5(coalesce(string_agg(to_jsonb(asset)::text, '|' order by asset.id), ''))
        from public.video_assets asset
      )
      and baseline.provider_event_count = (select count(*) from public.video_provider_events)
      and baseline.provider_event_fingerprint = (
        select md5(coalesce(string_agg(to_jsonb(event_row)::text, '|' order by event_row.id), ''))
        from public.video_provider_events event_row
      )
      and baseline.session_count = (select count(*) from coachfort_internal.video_upload_sessions)
      and baseline.session_fingerprint = (
        select md5(coalesce(string_agg(to_jsonb(session_row)::text, '|'
          order by session_row.video_asset_id), ''))
        from coachfort_internal.video_upload_sessions session_row
      )
    into v_unchanged
  from video2b1d_apply_baseline baseline;

  if v_unchanged is distinct from true then
    raise exception 'VIDEO-2B1D modified protected video data.' using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;

-- ============================================================================
-- POST-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with
target_functions(identity) as (
  values
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)')
),
target_security as (
  select count(*) = 3
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile = 'v')
      and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1 from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as secure
  from target_functions target
  join pg_proc procedure on procedure.oid = to_regprocedure(target.identity)
),
helper_security as (
  select count(*) = 1
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile = 'i')
      and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1 from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as secure
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'coachfort_internal.provider_event_replay_evidence_matches(text,jsonb,text,jsonb)'
  )
),
sources as (
  select
    lower(pg_get_functiondef(to_regprocedure(
      'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'
    ))) as record_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
    ))) as finalize_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'
    ))) as observe_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.provider_event_replay_evidence_matches(text,jsonb,text,jsonb)'
    ))) as helper_source
),
source_contract as (
  select
    record_source like '%provider_event_replay_evidence_matches(%'
      and finalize_source like '%provider_event_replay_evidence_matches(%'
      and observe_source like '%provider_event_replay_evidence_matches(%'
      and record_source like '%on conflict (provider, event_key) do nothing%'
      and finalize_source like '%on conflict (provider, event_key) do nothing%'
      and observe_source like '%on conflict (provider, event_key) do nothing%'
      and finalize_source like '%if v_asset.status = ''upload_pending''%'
      and observe_source like '%p_event_time < v_asset.last_provider_observed_at%'
      and helper_source like '%- ''observation_source''%'
      and helper_source like '%in (''webhook'', ''reconciliation'')%'
      as implementation_ready
  from sources
),
behavior_contract as (
  select
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}',
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'
    ) as exact_replay,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}',
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"reconciliation"}'
    ) as cross_source_replay,
    not coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}',
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":11,"observation_source":"reconciliation"}'
    ) as substantive_mismatch_rejected,
    not coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64), '{"provider_state":"ready"}',
      repeat('b',64), '{"provider_state":"ready"}'
    ) as unclassified_hash_mismatch_rejected
),
data_contract as (
  select
    (select count(*) = count(distinct (provider, event_key))
      from public.video_provider_events) as no_duplicate_events,
    not exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'video_provider_events'
        and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
        and privilege.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    ) as direct_writes_absent,
    (select count(*) from public.video_provider_events) as provider_event_rows
),
gate as (
  select
    target_security.secure
      and helper_security.secure
      and source_contract.implementation_ready
      and behavior_contract.exact_replay
      and behavior_contract.cross_source_replay
      and behavior_contract.substantive_mismatch_rejected
      and behavior_contract.unclassified_hash_mismatch_rejected
      and data_contract.no_duplicate_events
      and data_contract.direct_writes_absent
      as security_gate
  from target_security, helper_security, source_contract, behavior_contract,
       data_contract
)
select
  gate.security_gate,
  target_security.secure as target_function_security,
  helper_security.secure as helper_security,
  source_contract.implementation_ready,
  behavior_contract.exact_replay,
  behavior_contract.cross_source_replay,
  behavior_contract.substantive_mismatch_rejected,
  behavior_contract.unclassified_hash_mismatch_rejected,
  data_contract.no_duplicate_events,
  data_contract.direct_writes_absent,
  data_contract.provider_event_rows,
  true as event_key_remains_source_independent,
  true as existing_event_evidence_not_rewritten
from gate, target_security, helper_security, source_contract, behavior_contract,
     data_contract;
