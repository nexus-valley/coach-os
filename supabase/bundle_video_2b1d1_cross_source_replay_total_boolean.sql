-- Bundle VIDEO-2B1D1: total-boolean cross-source replay correction
-- The original VIDEO-2B1D APPLY is already installed. Do not rerun it.
-- Execute this file's PRE, APPLY, and POST separately after review.

-- ============================================================================
-- PRE-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with
helper_security as (
  select
    count(*) = 1
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile = 'i')
      and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as secure,
    min(md5(pg_get_functiondef(procedure.oid))) as definition_fingerprint
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'coachfort_internal.provider_event_replay_evidence_matches(text,jsonb,text,jsonb)'
  )
),
target_functions(identity) as (
  values
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)')
),
target_security as (
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
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as secure,
    jsonb_object_agg(
      target.identity,
      md5(pg_get_functiondef(procedure.oid))
      order by target.identity
    ) as definition_fingerprints
  from target_functions target
  join pg_proc procedure on procedure.oid = to_regprocedure(target.identity)
),
target_sources as (
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
target_contract as (
  select
    record_source like '%provider_event_replay_evidence_matches(%'
      and finalize_source like '%provider_event_replay_evidence_matches(%'
      and observe_source like '%provider_event_replay_evidence_matches(%'
      and record_source like '%on conflict (provider, event_key) do nothing%'
      and finalize_source like '%on conflict (provider, event_key) do nothing%'
      and observe_source like '%on conflict (provider, event_key) do nothing%'
      and finalize_source like '%if v_asset.status = ''upload_pending''%'
      and observe_source like '%p_event_time < v_asset.last_provider_observed_at%'
      as installed_video2b1d_authority
  from target_sources
),
installed_behavior as (
  select
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb
    ) is true as exact_replay,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"reconciliation"}'::jsonb
    ) is true as webhook_to_reconciliation,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"reconciliation"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb
    ) is true as reconciliation_to_webhook,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb
    ) is true as same_source_hash_drift_currently_allowed,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10}'::jsonb
    ) is null as missing_source_hash_drift_currently_null,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"other"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"other"}'::jsonb
    ) is false as unknown_source_hash_drift_rejected
),
data_contract as (
  select
    (select count(*) from public.video_provider_events) as provider_event_rows,
    not exists (
      select 1
      from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'video_provider_events'
        and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
        and privilege.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    ) as direct_writes_absent
),
gate as (
  select
    helper_security.secure
      and target_security.secure
      and target_contract.installed_video2b1d_authority
      and installed_behavior.exact_replay
      and installed_behavior.webhook_to_reconciliation
      and installed_behavior.reconciliation_to_webhook
      and installed_behavior.same_source_hash_drift_currently_allowed
      and installed_behavior.missing_source_hash_drift_currently_null
      and installed_behavior.unknown_source_hash_drift_rejected
      and data_contract.direct_writes_absent
      as ready_for_apply
  from helper_security, target_security, target_contract, installed_behavior,
       data_contract
)
select
  gate.ready_for_apply,
  helper_security.secure as helper_security,
  helper_security.definition_fingerprint as installed_helper_fingerprint,
  target_security.secure as target_function_security,
  target_security.definition_fingerprints as target_function_fingerprints,
  target_contract.installed_video2b1d_authority,
  installed_behavior.exact_replay,
  installed_behavior.webhook_to_reconciliation,
  installed_behavior.reconciliation_to_webhook,
  installed_behavior.same_source_hash_drift_currently_allowed,
  installed_behavior.missing_source_hash_drift_currently_null,
  installed_behavior.unknown_source_hash_drift_rejected,
  data_contract.provider_event_rows,
  data_contract.direct_writes_absent
from gate, helper_security, target_security, target_contract,
     installed_behavior, data_contract;

-- ============================================================================
-- APPLY (TRANSACTIONAL; execute only after PRE review)
-- ============================================================================

begin;

do $$
declare
  v_ready boolean;
begin
  with
  helper_state as (
    select
      count(*) = 1
        and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
        and bool_and(procedure.prosecdef)
        and bool_and(procedure.provolatile = 'i')
        and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
        and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
        and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
        and bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
        and bool_and(not exists (
          select 1
          from aclexplode(coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )) as secure
    from pg_proc procedure
    where procedure.oid = to_regprocedure(
      'coachfort_internal.provider_event_replay_evidence_matches(text,jsonb,text,jsonb)'
    )
  ),
  target_functions(identity) as (
    values
      ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
      ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
      ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)')
  ),
  target_state as (
    select count(*) = 3
        and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
        and bool_and(procedure.prosecdef)
        and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
        and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
        and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
        and bool_and(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
        and bool_and(not exists (
          select 1
          from aclexplode(coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ))
        and bool_and(lower(pg_get_functiondef(procedure.oid)) like
          '%provider_event_replay_evidence_matches(%')
        and bool_and(
          target.identity not like '%finalize_native_video_asset_processing_server%'
          or lower(pg_get_functiondef(procedure.oid)) like
            '%if v_asset.status = ''upload_pending''%'
        )
        and bool_and(
          target.identity not like '%observe_native_video_provider_state_server%'
          or lower(pg_get_functiondef(procedure.oid)) like
            '%p_event_time < v_asset.last_provider_observed_at%'
        )
        as secure
    from target_functions target
    join pg_proc procedure on procedure.oid = to_regprocedure(target.identity)
  ),
  data_state as (
    select not exists (
      select 1
      from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'video_provider_events'
        and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
        and privilege.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    ) as direct_writes_absent
  ),
  defect_state as (
    select
      coachfort_internal.provider_event_replay_evidence_matches(
        repeat('a',64),
        '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
        repeat('b',64),
        '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb
      ) is true as same_source_hash_drift_currently_allowed,
      coachfort_internal.provider_event_replay_evidence_matches(
        repeat('a',64),
        '{"provider_state":"ready","duration_seconds":10}'::jsonb,
        repeat('b',64),
        '{"provider_state":"ready","duration_seconds":10}'::jsonb
      ) is null as missing_source_hash_drift_currently_null
  )
  select
    helper_state.secure
      and target_state.secure
      and data_state.direct_writes_absent
      and defect_state.same_source_hash_drift_currently_allowed
      and defect_state.missing_source_hash_drift_currently_null
    into v_ready
  from helper_state, target_state, data_state, defect_state;

  if v_ready is distinct from true then
    raise exception 'VIDEO-2B1D1 helper baseline does not match the reviewed installed defect.'
      using errcode = '55000';
  end if;
end;
$$;

create temp table video2b1d1_apply_baseline on commit drop as
with target_functions(identity) as (
  values
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)')
)
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
    from coachfort_internal.video_upload_sessions session_row) as session_fingerprint,
  (select jsonb_object_agg(
      target.identity,
      md5(pg_get_functiondef(procedure.oid))
      order by target.identity
    )
    from target_functions target
    join pg_proc procedure on procedure.oid = to_regprocedure(target.identity)
  ) as target_function_fingerprints;

create or replace function coachfort_internal.provider_event_replay_evidence_matches(
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
  select case
    when p_stored_hash is not distinct from p_incoming_hash
      and coalesce(p_stored_evidence, '{}'::jsonb)
        is not distinct from coalesce(p_incoming_evidence, '{}'::jsonb)
      then true
    when (
      (
        coalesce(p_stored_evidence, '{}'::jsonb)->>'observation_source' = 'webhook'
        and coalesce(p_incoming_evidence, '{}'::jsonb)->>'observation_source'
          = 'reconciliation'
      )
      or (
        coalesce(p_stored_evidence, '{}'::jsonb)->>'observation_source'
          = 'reconciliation'
        and coalesce(p_incoming_evidence, '{}'::jsonb)->>'observation_source'
          = 'webhook'
      )
    ) then
      (coalesce(p_stored_evidence, '{}'::jsonb) - 'observation_source')
        is not distinct from
      (coalesce(p_incoming_evidence, '{}'::jsonb) - 'observation_source')
    else false
  end;
$$;

alter function coachfort_internal.provider_event_replay_evidence_matches(
  text,jsonb,text,jsonb
) owner to postgres;
revoke all on function coachfort_internal.provider_event_replay_evidence_matches(
  text,jsonb,text,jsonb
) from public, anon, authenticated, service_role;

do $$
declare
  v_unchanged boolean;
  v_target_fingerprints jsonb;
begin
  with target_functions(identity) as (
    values
      ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
      ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
      ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)')
  )
  select jsonb_object_agg(
    target.identity,
    md5(pg_get_functiondef(procedure.oid))
    order by target.identity
  ) into v_target_fingerprints
  from target_functions target
  join pg_proc procedure on procedure.oid = to_regprocedure(target.identity);

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
      and baseline.target_function_fingerprints = v_target_fingerprints
    into v_unchanged
  from video2b1d1_apply_baseline baseline;

  if v_unchanged is distinct from true then
    raise exception 'VIDEO-2B1D1 modified protected video data or public authority.'
      using errcode = '55000';
  end if;
end;
$$;

commit;

-- ============================================================================
-- POST-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with
helper_security as (
  select
    count(*) = 1
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile = 'i')
      and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as secure
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'coachfort_internal.provider_event_replay_evidence_matches(text,jsonb,text,jsonb)'
  )
),
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
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as secure
  from target_functions target
  join pg_proc procedure on procedure.oid = to_regprocedure(target.identity)
),
target_contract as (
  select
    bool_and(lower(pg_get_functiondef(procedure.oid)) like
      '%provider_event_replay_evidence_matches(%')
      and bool_and(lower(pg_get_functiondef(procedure.oid)) like
        '%on conflict (provider, event_key) do nothing%')
      and bool_and(
        target.identity not like '%finalize_native_video_asset_processing_server%'
        or lower(pg_get_functiondef(procedure.oid)) like
          '%if v_asset.status = ''upload_pending''%'
      )
      and bool_and(
        target.identity not like '%observe_native_video_provider_state_server%'
        or lower(pg_get_functiondef(procedure.oid)) like
          '%p_event_time < v_asset.last_provider_observed_at%'
      ) as public_authority_unchanged
  from target_functions target
  join pg_proc procedure on procedure.oid = to_regprocedure(target.identity)
),
behavior as (
  select
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb
    ) as exact_same_source_replay,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"reconciliation"}'::jsonb
    ) as webhook_to_reconciliation,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"reconciliation"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb
    ) as reconciliation_to_webhook,
    not coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb
    ) as webhook_hash_drift_rejected,
    not coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"reconciliation"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"reconciliation"}'::jsonb
    ) as reconciliation_hash_drift_rejected,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10}'::jsonb
    ) is false as missing_source_hash_drift_rejected,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"other"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"other"}'::jsonb
    ) is false as unknown_source_hash_drift_rejected,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10,"observation_source":"webhook"}'::jsonb,
      repeat('b',64),
      '{"provider_state":"ready","duration_seconds":11,"observation_source":"reconciliation"}'::jsonb
    ) is false as substantive_mismatch_rejected,
    coachfort_internal.provider_event_replay_evidence_matches(
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10}'::jsonb,
      repeat('a',64),
      '{"provider_state":"ready","duration_seconds":10}'::jsonb
    ) as exact_unclassified_replay
),
total_boolean as (
  select count(*) = 9 and bool_and(result is not null) as all_results_non_null
  from behavior
  cross join lateral (values
    (exact_same_source_replay),
    (webhook_to_reconciliation),
    (reconciliation_to_webhook),
    (webhook_hash_drift_rejected),
    (reconciliation_hash_drift_rejected),
    (missing_source_hash_drift_rejected),
    (unknown_source_hash_drift_rejected),
    (substantive_mismatch_rejected),
    (exact_unclassified_replay)
  ) result_set(result)
),
data_contract as (
  select
    (select count(*) = count(distinct (provider, event_key))
      from public.video_provider_events) as no_duplicate_events,
    not exists (
      select 1
      from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'video_provider_events'
        and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
        and privilege.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    ) as direct_writes_absent,
    (select count(*) from public.video_provider_events) as provider_event_rows
),
gate as (
  select
    helper_security.secure
      and target_security.secure
      and target_contract.public_authority_unchanged
      and behavior.exact_same_source_replay
      and behavior.webhook_to_reconciliation
      and behavior.reconciliation_to_webhook
      and behavior.webhook_hash_drift_rejected
      and behavior.reconciliation_hash_drift_rejected
      and behavior.missing_source_hash_drift_rejected
      and behavior.unknown_source_hash_drift_rejected
      and behavior.substantive_mismatch_rejected
      and behavior.exact_unclassified_replay
      and total_boolean.all_results_non_null
      and data_contract.no_duplicate_events
      and data_contract.direct_writes_absent
      as security_gate
  from helper_security, target_security, target_contract, behavior,
       total_boolean, data_contract
)
select
  gate.security_gate,
  helper_security.secure as helper_security,
  target_security.secure as target_function_security,
  target_contract.public_authority_unchanged,
  behavior.exact_same_source_replay,
  behavior.webhook_to_reconciliation,
  behavior.reconciliation_to_webhook,
  behavior.webhook_hash_drift_rejected,
  behavior.reconciliation_hash_drift_rejected,
  behavior.missing_source_hash_drift_rejected,
  behavior.unknown_source_hash_drift_rejected,
  behavior.substantive_mismatch_rejected,
  behavior.exact_unclassified_replay,
  total_boolean.all_results_non_null,
  data_contract.no_duplicate_events,
  data_contract.direct_writes_absent,
  data_contract.provider_event_rows,
  true as event_key_semantics_unchanged,
  true as provider_event_rows_untouched
from gate, helper_security, target_security, target_contract, behavior,
     total_boolean, data_contract;
