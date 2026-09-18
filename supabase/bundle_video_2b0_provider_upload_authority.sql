-- Bundle VIDEO-2B0: Provider Upload Provisioning + Pending-Upload Authority
-- SQL only. Run PRE, APPLY, and POST separately after review.
-- Cloudflare HTTP calls, credentials, webhooks, and scheduling are intentionally absent.

-- ============================================================================
-- PRE-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with
required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.tenant_subscription_assignments'),
    ('public.subscription_plans'),
    ('public.subscription_plan_prices'),
    ('public.subscription_plan_feature_entitlements'),
    ('public.subscription_plan_usage_limits'),
    ('public.tenant_subscription_overrides'),
    ('public.video_capacity_pack_catalog'),
    ('public.tenant_video_capacity_pack_assignments'),
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events'),
    ('public.courses'),
    ('public.course_sections'),
    ('public.lessons'),
    ('public.tenant_payment_orders'),
    ('public.tenant_payment_attempts'),
    ('public.payment_transactions'),
    ('public.invoices'),
    ('public.platform_billing_receipts'),
    ('public.platform_billing_document_fulfillments'),
    ('public.finance_invoices'),
    ('public.finance_payments'),
    ('public.finance_receipts')
),
relation_state as (
  select
    count(*) as expected_count,
    count(to_regclass(identity)) as installed_count
  from required_relations
),
required_functions(identity) as (
  values
    ('coachfort_internal.native_video_capacity_authority_lock(uuid)'),
    ('coachfort_internal.enforce_video_asset_authority()'),
    ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    ('coachfort_internal.resolve_native_video_capacity(uuid)'),
    ('coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
    ('coachfort_internal.enforce_lesson_external_video_authority()'),
    ('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    ('public.bind_native_video_provider_identity_server(uuid,text,text)'),
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    ('public.confirm_native_video_provider_deletion_server(uuid,text)'),
    ('public.get_native_video_capacity_server(uuid,uuid)')
),
function_state as (
  select
    count(*) as expected_count,
    count(to_regprocedure(identity)) as installed_count
  from required_functions
),
video2a_sources as (
  select
    lower(pg_get_functiondef(to_regprocedure(
      'public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'
    ))) as reserve_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.bind_native_video_provider_identity_server(uuid,text,text)'
    ))) as bind_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
    ))) as finalize_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_video_asset_authority()'
    ))) as transition_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.resolve_native_video_usage(uuid,uuid)'
    ))) as usage_source
),
video2a_exact_modified_function_baseline as (
  select
    count(*) = 5
      and bool_and(
        md5(pg_get_functiondef(procedure.oid)) = expected.source_hash
      )
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile::text = expected.volatility)
      and bool_and(procedure.proconfig = array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(
        has_function_privilege('service_role', procedure.oid, 'EXECUTE')
          = expected.service_role_execute
      )
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and not (
            expected.service_role_execute
            and acl.grantee = 'service_role'::regrole::oid
          )
      )) as exact_baseline_verified
  from (values
    ('public.bind_native_video_provider_identity_server(uuid,text,text)',
      'b110dbce83558fd332d2b2e1d279c662', 'v'::text, true),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)',
      '9c459be735aff01f5729aa9c96cb0ebd', 'v'::text, true),
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)',
      '008dfebf42284ed76843815b9e1159ba', 'v'::text, true),
    ('coachfort_internal.enforce_video_asset_authority()',
      'd6bbacd21af7880ade06a10c943b6050', 'v'::text, false),
    ('coachfort_internal.resolve_native_video_usage(uuid,uuid)',
      '4dc4adff45b6c8fa8612f6fca0a686d1', 's'::text, false)
  ) expected(
    identity, source_hash, volatility, service_role_execute
  )
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
),
video2a_contract as (
  select
    reserve_source like '%interval ''90 minutes''%' as reservation_is_90_minutes,
    reserve_source like '%p_expected_duration_seconds not between 1 and 7200%'
      as duration_is_bounded,
    reserve_source like '%p_declared_size_bytes not between 1 and 10737418240%'
      as size_is_bounded,
    bind_source like '%status = ''processing''%'
      and bind_source like '%status <> ''upload_pending''%'
      as known_bind_semantics,
    finalize_source like '%v_asset.status <> ''processing''%'
      and finalize_source like '%provider_duration_exceeds_reservation%'
      and finalize_source like '%provider_duration_exceeds_capacity%'
      as known_finalize_semantics,
    transition_source like
      '%old.status = ''upload_pending'' and new.status in (''processing'',''failed'')%'
      and transition_source not like
      '%old.status = ''upload_pending'' and new.status in (''processing'',''failed'',''delete_pending'')%'
      as known_transition_semantics,
    usage_source like '%asset.reservation_expires_at > now()%'
      and usage_source not like '%or asset.provider_asset_id is not null%'
      as known_pending_usage_semantics
  from video2a_sources
),
plan_contract as (
  select
    count(*) filter (
      where plan.code in ('starter','growth','premium')
        and feature.feature_key = 'native_video'
        and feature.entitlement_status = 'included'
    ) = 3 as native_video_entitlements_exact,
    count(*) filter (
      where plan.code = 'starter' and usage.limit_value = 600
    ) = 1
      and count(*) filter (
        where plan.code = 'growth' and usage.limit_value = 3000
      ) = 1
      and count(*) filter (
        where plan.code = 'premium' and usage.limit_value = 9000
      ) = 1
      and count(*) filter (
        where plan.code in ('starter','growth','premium')
          and usage.limit_type = 'duration_minutes'
          and usage.enforcement_mode = 'hard'
      ) = 3 as video_limits_exact
  from public.subscription_plans plan
  left join public.subscription_plan_feature_entitlements feature
    on feature.plan_id = plan.id and feature.feature_key = 'native_video'
  left join public.subscription_plan_usage_limits usage
    on usage.plan_id = plan.id and usage.resource_key = 'video_storage_minutes'
),
constraint_contract as (
  select
    count(*) filter (where constraint_name = 'video_assets_request_key') = 1
      and count(*) filter (where constraint_name = 'video_assets_provider_state_check') = 1
      and count(*) filter (where constraint_name = 'video_assets_ready_identity_check') = 1
      and count(*) filter (where constraint_name = 'video_assets_delete_pending_identity_check') = 1
      and count(*) filter (where constraint_name = 'video_provider_events_identity_key') = 1
      as video_constraints_present
  from information_schema.table_constraints
  where table_schema = 'public'
    and table_name in ('video_assets','video_provider_events')
),
direct_acl as (
  select
    count(*) filter (
      where grantee in ('PUBLIC','anon','authenticated','service_role')
        and privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
    ) = 0 as explicit_video_grants_absent
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in (
      'video_assets','video_asset_attachments','video_provider_events',
      'video_capacity_pack_catalog','tenant_video_capacity_pack_assignments'
    )
),
new_objects as (
  select
    to_regclass('coachfort_internal.video_upload_sessions') is null
      and to_regprocedure('coachfort_internal.enforce_video_upload_session_authority()') is null
      and to_regprocedure('coachfort_internal.video_provider_event_evidence_is_safe(jsonb)') is null
      and not exists (
        select 1 from pg_constraint
        where conrelid = 'public.video_provider_events'::regclass
          and conname = 'video_provider_events_safe_evidence_capability_check'
      )
      and to_regprocedure('public.claim_native_video_upload_provisioning_server(uuid)') is null
      and to_regprocedure('public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)') is null
      and to_regprocedure('public.mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)') is null
      and to_regprocedure('public.fail_unbound_native_video_upload_server(uuid,uuid,text)') is null
      and to_regprocedure('public.expire_unbound_native_video_upload_server(uuid,uuid,integer)') is null
      and to_regprocedure('public.recover_native_video_provider_identity_server(uuid,uuid,text,integer)') is null
      and to_regprocedure('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)') is null
      and to_regprocedure('public.claim_native_video_reconciliation_batch_server(integer,integer)') is null
      and to_regprocedure('public.release_native_video_reconciliation_claim_server(uuid,uuid,text)') is null
      as clean_install
),
data_state as (
  select
    (select count(*) from public.video_assets) as video_assets,
    (select count(*) from public.video_asset_attachments) as attachments,
    (select count(*) from public.video_provider_events) as provider_events,
    (select count(*) from public.tenant_video_capacity_pack_assignments) as pack_assignments
),
gate as (
  select
    relation_state.expected_count = relation_state.installed_count
      and function_state.expected_count = function_state.installed_count
      and video2a_exact_modified_function_baseline.exact_baseline_verified
      and video2a_contract.reservation_is_90_minutes
      and video2a_contract.duration_is_bounded
      and video2a_contract.size_is_bounded
      and video2a_contract.known_bind_semantics
      and video2a_contract.known_finalize_semantics
      and video2a_contract.known_transition_semantics
      and video2a_contract.known_pending_usage_semantics
      and plan_contract.native_video_entitlements_exact
      and plan_contract.video_limits_exact
      and constraint_contract.video_constraints_present
      and direct_acl.explicit_video_grants_absent
      and new_objects.clean_install
      and data_state.video_assets = 0
      and data_state.attachments = 0
      and data_state.provider_events = 0
      and data_state.pack_assignments = 0
      as ready_for_apply
  from relation_state, function_state, video2a_exact_modified_function_baseline,
       video2a_contract, plan_contract,
       constraint_contract, direct_acl, new_objects, data_state
)
select
  gate.ready_for_apply,
  relation_state.expected_count as required_relation_count,
  relation_state.installed_count as installed_relation_count,
  function_state.expected_count as required_function_count,
  function_state.installed_count as installed_function_count,
  video2a_exact_modified_function_baseline.exact_baseline_verified
    as video2a_exact_modified_function_baseline_verified,
  video2a_contract.*,
  plan_contract.*,
  constraint_contract.*,
  direct_acl.*,
  new_objects.clean_install,
  data_state.*
from gate, relation_state, function_state, video2a_exact_modified_function_baseline,
     video2a_contract, plan_contract,
     constraint_contract, direct_acl, new_objects, data_state;

-- ============================================================================
-- APPLY (TRANSACTIONAL; execute only after PRE review)
-- ============================================================================

begin;

do $$
declare
  v_ready boolean;
begin
  select
    to_regclass('public.video_assets') is not null
    and to_regclass('public.video_provider_events') is not null
    and to_regclass('coachfort_internal.video_upload_sessions') is null
    and to_regprocedure('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)') is not null
    and to_regprocedure('public.bind_native_video_provider_identity_server(uuid,text,text)') is not null
    and to_regprocedure('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)') is not null
    and not exists (
      select 1
      from (values
        ('public.bind_native_video_provider_identity_server(uuid,text,text)',
          'b110dbce83558fd332d2b2e1d279c662', 'v'::text, true),
        ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)',
          '9c459be735aff01f5729aa9c96cb0ebd', 'v'::text, true),
        ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)',
          '008dfebf42284ed76843815b9e1159ba', 'v'::text, true),
        ('coachfort_internal.enforce_video_asset_authority()',
          'd6bbacd21af7880ade06a10c943b6050', 'v'::text, false),
        ('coachfort_internal.resolve_native_video_usage(uuid,uuid)',
          '4dc4adff45b6c8fa8612f6fca0a686d1', 's'::text, false)
      ) expected(
        identity, source_hash, volatility, service_role_execute
      )
      left join pg_proc procedure
        on procedure.oid = to_regprocedure(expected.identity)
      where procedure.oid is null
        or md5(pg_get_functiondef(procedure.oid)) <> expected.source_hash
        or pg_get_userbyid(procedure.proowner) <> 'postgres'
        or not procedure.prosecdef
        or procedure.provolatile::text <> expected.volatility
        or procedure.proconfig is distinct from array['search_path=public, pg_temp']
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or has_function_privilege('service_role', procedure.oid, 'EXECUTE')
          is distinct from expected.service_role_execute
        or exists (
          select 1
          from aclexplode(coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
        or exists (
          select 1
          from aclexplode(coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )) acl
          where acl.privilege_type = 'EXECUTE'
            and acl.grantee <> procedure.proowner
            and not (
              expected.service_role_execute
              and acl.grantee = 'service_role'::regrole::oid
            )
        )
    )
    and lower(pg_get_functiondef(to_regprocedure(
      'public.bind_native_video_provider_identity_server(uuid,text,text)'
    ))) like '%status = ''processing''%'
    and lower(pg_get_functiondef(to_regprocedure(
      'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
    ))) like '%v_asset.status <> ''processing''%'
    and lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.resolve_native_video_usage(uuid,uuid)'
    ))) not like '%or asset.provider_asset_id is not null%'
    and (select count(*)
      from public.subscription_plan_feature_entitlements feature
      join public.subscription_plans plan on plan.id = feature.plan_id
      where plan.code in ('starter','growth','premium')
        and feature.feature_key = 'native_video'
        and feature.entitlement_status = 'included') = 3
    and (select count(*)
      from public.subscription_plan_usage_limits usage
      join public.subscription_plans plan on plan.id = usage.plan_id
      where plan.code in ('starter','growth','premium')
        and usage.resource_key = 'video_storage_minutes'
        and usage.limit_type = 'duration_minutes'
        and usage.enforcement_mode = 'hard') = 3
    and (select count(*) from information_schema.table_constraints
      where table_schema = 'public'
        and table_name in ('video_assets','video_provider_events')
        and constraint_name in (
          'video_assets_request_key','video_assets_provider_state_check',
          'video_assets_ready_identity_check',
          'video_assets_delete_pending_identity_check',
          'video_provider_events_identity_key'
        )) = 5
    and not exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name in (
          'video_assets','video_asset_attachments','video_provider_events',
          'video_capacity_pack_catalog','tenant_video_capacity_pack_assignments'
        )
        and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
    )
    and (select count(*) from (values
      ('public.claim_native_video_upload_provisioning_server(uuid)'),
      ('public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'),
      ('public.mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)'),
      ('public.fail_unbound_native_video_upload_server(uuid,uuid,text)'),
      ('public.expire_unbound_native_video_upload_server(uuid,uuid,integer)'),
      ('public.recover_native_video_provider_identity_server(uuid,uuid,text,integer)'),
      ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'),
      ('public.claim_native_video_reconciliation_batch_server(integer,integer)'),
      ('public.release_native_video_reconciliation_claim_server(uuid,uuid,text)')
    ) expected(identity) where to_regprocedure(identity) is not null) = 0
    and to_regprocedure('coachfort_internal.enforce_video_upload_session_authority()') is null
    and to_regprocedure('coachfort_internal.video_provider_event_evidence_is_safe(jsonb)') is null
    and not exists (
      select 1 from pg_constraint
      where conrelid = 'public.video_provider_events'::regclass
        and conname = 'video_provider_events_safe_evidence_capability_check'
    )
    and (select count(*) from public.video_assets) = 0
    and (select count(*) from public.video_asset_attachments) = 0
    and (select count(*) from public.video_provider_events) = 0
    and (select count(*) from public.tenant_video_capacity_pack_assignments) = 0
  into v_ready;

  if not coalesce(v_ready, false) then
    raise exception 'VIDEO-2B0 APPLY prerequisites drifted.' using errcode = '55000';
  end if;
end;
$$;

create temporary table video2b0_apply_baseline (
  tenant_rows bigint not null,
  assignment_rows bigint not null,
  plan_rows bigint not null,
  plan_fingerprint text not null,
  feature_rows bigint not null,
  feature_fingerprint text not null,
  limit_rows bigint not null,
  limit_fingerprint text not null,
  lesson_rows bigint not null,
  lesson_fingerprint text not null,
  payment_order_rows bigint not null,
  payment_attempt_rows bigint not null,
  invoice_rows bigint not null,
  receipt_rows bigint not null,
  finance_invoice_rows bigint not null,
  finance_payment_rows bigint not null,
  finance_receipt_rows bigint not null,
  protected_function_contract jsonb not null
) on commit drop;

insert into video2b0_apply_baseline
select
  (select count(*) from public.tenants),
  (select count(*) from public.tenant_subscription_assignments),
  (select count(*) from public.subscription_plans),
  (select md5(coalesce(string_agg(to_jsonb(plan)::text, '|' order by plan.id), ''))
     from public.subscription_plans plan),
  (select count(*) from public.subscription_plan_feature_entitlements),
  (select md5(coalesce(string_agg(to_jsonb(feature)::text, '|' order by feature.id), ''))
     from public.subscription_plan_feature_entitlements feature),
  (select count(*) from public.subscription_plan_usage_limits),
  (select md5(coalesce(string_agg(to_jsonb(limit_row)::text, '|' order by limit_row.id), ''))
     from public.subscription_plan_usage_limits limit_row),
  (select count(*) from public.lessons),
  (select md5(coalesce(string_agg(to_jsonb(lesson)::text, '|' order by lesson.id), ''))
     from public.lessons lesson),
  (select count(*) from public.tenant_payment_orders),
  (select count(*) from public.tenant_payment_attempts),
  (select count(*) from public.invoices),
  (select count(*) from public.platform_billing_receipts),
  (select count(*) from public.finance_invoices),
  (select count(*) from public.finance_payments),
  (select count(*) from public.finance_receipts),
  (
    select jsonb_object_agg(
      procedure.oid::regprocedure::text,
      jsonb_build_object(
        'definition', pg_get_functiondef(procedure.oid),
        'owner', pg_get_userbyid(procedure.proowner),
        'acl', coalesce(procedure.proacl::text, ''),
        'security_definer', procedure.prosecdef,
        'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
      ) order by procedure.oid::regprocedure::text
    )
    from pg_proc procedure
    where procedure.oid in (
      to_regprocedure('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
      to_regprocedure('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
      to_regprocedure('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
      to_regprocedure('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
      to_regprocedure('public.confirm_native_video_provider_deletion_server(uuid,text)'),
      to_regprocedure('public.get_native_video_capacity_server(uuid,uuid)'),
      to_regprocedure('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
      to_regprocedure('coachfort_internal.resolve_native_video_capacity(uuid)'),
      to_regprocedure('coachfort_internal.enforce_lesson_external_video_authority()')
    )
  );

create temporary table video2b0_protected_business_baseline (
  relation_name text primary key,
  row_count bigint not null,
  row_fingerprint text not null
) on commit drop;

do $$
declare
  v_relation text;
  v_count bigint;
  v_fingerprint text;
begin
  foreach v_relation in array array[
    'public.tenants',
    'public.tenant_subscription_assignments',
    'public.subscription_plans',
    'public.subscription_plan_prices',
    'public.subscription_plan_feature_entitlements',
    'public.subscription_plan_usage_limits',
    'public.tenant_subscription_overrides',
    'public.courses',
    'public.course_sections',
    'public.lessons',
    'public.tenant_payment_orders',
    'public.tenant_payment_attempts',
    'public.payment_transactions',
    'public.invoices',
    'public.platform_billing_receipts',
    'public.platform_billing_document_fulfillments',
    'public.finance_invoices',
    'public.finance_payments',
    'public.finance_receipts',
    'public.video_capacity_pack_catalog',
    'public.tenant_video_capacity_pack_assignments',
    'public.video_assets',
    'public.video_asset_attachments',
    'public.video_provider_events'
  ] loop
    execute format(
      'select count(*), md5(coalesce(string_agg(to_jsonb(row_data)::text, ''|'' order by to_jsonb(row_data)::text), '''')) from %s row_data',
      v_relation
    ) into v_count, v_fingerprint;
    insert into video2b0_protected_business_baseline
      (relation_name, row_count, row_fingerprint)
    values (v_relation, v_count, v_fingerprint);
  end loop;
end;
$$;

create function coachfort_internal.video_provider_event_evidence_is_safe(
  p_evidence jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_value jsonb;
  v_normalized_key text;
begin
  if p_evidence is null then
    return false;
  end if;

  if jsonb_typeof(p_evidence) = 'object' then
    for v_key, v_value in select key, value from jsonb_each(p_evidence) loop
      v_normalized_key := regexp_replace(lower(v_key), '[^a-z0-9]', '', 'g');
      if v_normalized_key in (
        'url', 'uri', 'upload', 'uploadurl', 'uploadlocation', 'tusurl',
        'tusendpoint', 'endpoint', 'location', 'headers', 'authorization',
        'apitoken', 'accesstoken', 'token', 'secret', 'credential', 'password',
        'signature', 'webhooksecret', 'webhooksignature'
      ) then
        return false;
      end if;
      if not coachfort_internal.video_provider_event_evidence_is_safe(v_value) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_evidence) = 'array' then
    for v_value in select value from jsonb_array_elements(p_evidence) loop
      if not coachfort_internal.video_provider_event_evidence_is_safe(v_value) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_evidence) = 'string'
        and trim(both '"' from p_evidence::text) ~* '^https?://' then
    return false;
  end if;

  return true;
end;
$$;

alter function coachfort_internal.video_provider_event_evidence_is_safe(jsonb)
  owner to postgres;
revoke all on function coachfort_internal.video_provider_event_evidence_is_safe(jsonb)
  from public, anon, authenticated, service_role;

alter table public.video_provider_events
  add constraint video_provider_events_safe_evidence_capability_check
  check (coachfort_internal.video_provider_event_evidence_is_safe(safe_evidence_json));

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
    if (v_event.event_type, v_event.provider_asset_id, v_event.event_time,
        v_event.safe_payload_hash, v_event.safe_evidence_json)
       is distinct from
       (v_event_type, v_provider_asset_id, p_event_time,
        p_safe_payload_hash, v_evidence) then
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

create table coachfort_internal.video_upload_sessions (
  video_asset_id uuid primary key,
  tenant_id uuid not null,
  provider text not null default 'cloudflare_stream',
  state text not null,
  provider_creation_attempted boolean not null default false,
  claim_token uuid,
  claim_started_at timestamptz,
  claim_expires_at timestamptz,
  provider_asset_id text,
  provider_upload_expires_at timestamptz,
  upload_url text,
  provisioned_at timestamptz,
  last_provider_state text,
  last_reconciled_at timestamptz,
  reconciliation_claim_token uuid,
  reconciliation_claimed_at timestamptz,
  reconciliation_claim_expires_at timestamptz,
  safe_failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_upload_sessions_asset_fk
    foreign key (tenant_id, video_asset_id)
    references public.video_assets(tenant_id, id) on delete cascade,
  constraint video_upload_sessions_provider_check
    check (provider = 'cloudflare_stream'),
  constraint video_upload_sessions_state_check
    check (state in ('provisioning','provisioned','reconcile_required','closed')),
  constraint video_upload_sessions_claim_pair_check check (
    (claim_token is null and claim_started_at is null and claim_expires_at is null)
    or (claim_token is not null and claim_started_at is not null
      and claim_expires_at is not null and claim_expires_at > claim_started_at)
  ),
  constraint video_upload_sessions_reconciliation_claim_pair_check check (
    (reconciliation_claim_token is null and reconciliation_claimed_at is null
      and reconciliation_claim_expires_at is null)
    or (reconciliation_claim_token is not null
      and reconciliation_claimed_at is not null
      and reconciliation_claim_expires_at is not null
      and reconciliation_claim_expires_at > reconciliation_claimed_at)
  ),
  constraint video_upload_sessions_provider_asset_id_check check (
    provider_asset_id is null or (
      char_length(provider_asset_id) between 1 and 255
      and provider_asset_id !~ '[[:space:][:cntrl:]]'
    )
  ),
  constraint video_upload_sessions_upload_url_check check (
    upload_url is null or (
      char_length(upload_url) between 1 and 2048
      and upload_url ~ '^https://'
      and upload_url !~ '[[:space:][:cntrl:]]'
    )
  ),
  constraint video_upload_sessions_provider_expiry_check check (
    provider_upload_expires_at is null or provisioned_at is not null
  ),
  constraint video_upload_sessions_provider_attempt_check check (
    provider_asset_id is null or provider_creation_attempted
  ),
  constraint video_upload_sessions_provisioning_state_check check (
    state <> 'provisioning' or (
      claim_token is not null and provider_asset_id is null
      and provider_upload_expires_at is null and upload_url is null
      and provisioned_at is null
    )
  ),
  constraint video_upload_sessions_provisioned_state_check check (
    state <> 'provisioned' or (
      claim_token is null and provider_asset_id is not null
      and provider_upload_expires_at is not null and upload_url is not null
      and provisioned_at is not null
    )
  ),
  constraint video_upload_sessions_reconcile_state_check check (
    state <> 'reconcile_required' or claim_token is null
  ),
  constraint video_upload_sessions_closed_state_check check (
    state <> 'closed' or (claim_token is null and upload_url is null)
  ),
  constraint video_upload_sessions_non_provisioned_url_check check (
    state = 'provisioned' or upload_url is null
  ),
  constraint video_upload_sessions_provider_state_check check (
    last_provider_state is null or last_provider_state in (
      'pendingupload','downloading','queued','inprogress','ready','error','live-inprogress'
    )
  ),
  constraint video_upload_sessions_failure_code_check check (
    safe_failure_code is null or safe_failure_code ~ '^[a-z0-9_]{1,80}$'
  )
);

create unique index video_upload_sessions_provider_identity_unique_idx
on coachfort_internal.video_upload_sessions (provider, provider_asset_id)
where provider_asset_id is not null;

create index video_upload_sessions_reconciliation_idx
on coachfort_internal.video_upload_sessions (
  state, reconciliation_claim_expires_at, updated_at
);

alter table coachfort_internal.video_upload_sessions enable row level security;
alter table coachfort_internal.video_upload_sessions owner to postgres;
revoke all privileges on table coachfort_internal.video_upload_sessions
  from public, anon, authenticated, service_role;

create function coachfort_internal.enforce_video_upload_session_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
begin
  select * into v_asset
  from public.video_assets asset
  where asset.id = new.video_asset_id;
  if not found
     or v_asset.tenant_id is distinct from new.tenant_id
     or v_asset.provider is distinct from new.provider then
    raise exception 'Video upload session asset authority is invalid.'
      using errcode = '55000';
  end if;
  if new.state = 'provisioned' and (
       v_asset.reservation_expires_at is null
       or new.provider_upload_expires_at is null
       or new.provider_upload_expires_at > v_asset.reservation_expires_at
     ) then
    raise exception 'Provider upload capability exceeds reservation authority.'
      using errcode = '55000';
  end if;
  if v_asset.provider_asset_id is not null
     and new.provider_asset_id is distinct from v_asset.provider_asset_id then
    raise exception 'Video upload session provider identity conflicts with the asset.'
      using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if (new.video_asset_id, new.tenant_id, new.provider, new.created_at)
       is distinct from
       (old.video_asset_id, old.tenant_id, old.provider, old.created_at) then
      raise exception 'Video upload session identity cannot be changed.'
        using errcode = '55000';
    end if;
    if old.provider_asset_id is not null
       and new.provider_asset_id is distinct from old.provider_asset_id then
      raise exception 'Video upload provider identity cannot be changed.'
        using errcode = '55000';
    end if;
    if old.upload_url is not null and new.upload_url is not null
       and new.upload_url is distinct from old.upload_url then
      raise exception 'Video upload capability cannot be replaced.'
        using errcode = '55000';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger enforce_video_upload_session_authority
before insert or update on coachfort_internal.video_upload_sessions
for each row execute function
  coachfort_internal.enforce_video_upload_session_authority();

create or replace function coachfort_internal.enforce_video_asset_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.id, new.tenant_id, new.provider, new.request_id, new.created_by,
      new.original_filename, new.declared_mime_type, new.declared_size_bytes)
     is distinct from
     (old.id, old.tenant_id, old.provider, old.request_id, old.created_by,
      old.original_filename, old.declared_mime_type, old.declared_size_bytes) then
    raise exception 'Native video immutable authority cannot be changed.'
      using errcode = '55000';
  end if;

  if old.provider_asset_id is not null
     and new.provider_asset_id is distinct from old.provider_asset_id then
    raise exception 'Native video provider identity cannot be changed.'
      using errcode = '55000';
  end if;
  if old.provider_upload_id is not null
     and new.provider_upload_id is distinct from old.provider_upload_id then
    raise exception 'Native video upload identity cannot be changed.'
      using errcode = '55000';
  end if;
  if old.status = 'deleted' then
    raise exception 'Deleted native video is terminal.' using errcode = '55000';
  end if;

  if new.status <> old.status and not (
    (old.status = 'upload_pending'
      and new.status in ('processing','failed','delete_pending'))
    or (old.status = 'processing' and new.status in ('ready','delete_pending'))
    or (old.status = 'ready' and new.status = 'delete_pending')
    or (old.status = 'delete_pending' and new.status = 'deleted')
  ) then
    raise exception 'Invalid native video status transition.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function coachfort_internal.resolve_native_video_usage(
  p_tenant_id uuid,
  p_exclude_asset_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'stored_seconds', coalesce(sum(asset.duration_seconds) filter (
      where asset.status in ('ready','delete_pending')
        and asset.provider_deleted_at is null
    ), 0),
    'reserved_seconds', coalesce(sum(asset.reserved_seconds) filter (
      where (asset.status = 'upload_pending' and (
          asset.reservation_expires_at > now()
          or asset.provider_asset_id is not null
        ))
        or asset.status = 'processing'
        or (asset.status = 'delete_pending'
          and asset.duration_seconds is null
          and asset.provider_deleted_at is null)
    ), 0)
  )
  from public.video_assets asset
  where asset.tenant_id = p_tenant_id
    and (p_exclude_asset_id is null or asset.id <> p_exclude_asset_id);
$$;

create or replace function public.bind_native_video_provider_identity_server(
  p_asset_id uuid,
  p_provider_asset_id text,
  p_provider_upload_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_provider_asset_id text := btrim(coalesce(p_provider_asset_id, ''));
  v_provider_upload_id text := nullif(btrim(coalesce(p_provider_upload_id, '')), '');
begin
  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found or v_provider_asset_id = ''
     or v_provider_asset_id ~ '[[:space:][:cntrl:]]'
     or char_length(v_provider_asset_id) > 255
     or (v_provider_upload_id is not null and (
       v_provider_upload_id ~ '[[:space:][:cntrl:]]'
       or char_length(v_provider_upload_id) > 255)) then
    raise exception 'Native video provider identity is invalid.' using errcode = '22023';
  end if;

  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;

  if v_asset.status = 'upload_pending'
     and v_asset.provider_asset_id = v_provider_asset_id
     and v_asset.provider_upload_id is not distinct from v_provider_upload_id then
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status, 'replayed', true
    );
  end if;
  if v_asset.status <> 'upload_pending' or v_asset.provider_asset_id is not null then
    raise exception 'Native video is not awaiting provider identity.' using errcode = '55000';
  end if;
  if not exists (
    select 1 from coachfort_internal.video_upload_sessions session
    where session.video_asset_id = v_asset.id
      and session.provider = v_asset.provider
      and session.provider_asset_id = v_provider_asset_id
      and session.state in ('provisioned','reconcile_required')
  ) then
    raise exception 'Native video provider session authority is unavailable.'
      using errcode = '55000';
  end if;

  update public.video_assets
  set provider_asset_id = v_provider_asset_id,
      provider_upload_id = v_provider_upload_id
  where id = v_asset.id
  returning * into v_asset;

  return jsonb_build_object(
    'asset_id', v_asset.id, 'status', v_asset.status, 'replayed', false
  );
end;
$$;

create function public.claim_native_video_upload_provisioning_server(
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
  v_claim_token uuid := gen_random_uuid();
begin
  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then
    raise exception 'Native video asset not found.' using errcode = '02000';
  end if;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;

  if v_asset.status <> 'upload_pending'
     or v_asset.reservation_expires_at is null
     or v_asset.reservation_expires_at <= now() then
    raise exception 'Native video reservation is not available for provisioning.'
      using errcode = '55000';
  end if;

  select * into v_session
  from coachfort_internal.video_upload_sessions session
  where session.video_asset_id = v_asset.id
  for update;

  if not found then
    if v_asset.provider_asset_id is not null then
      insert into coachfort_internal.video_upload_sessions (
        video_asset_id, tenant_id, provider, state, provider_asset_id,
        provider_creation_attempted, safe_failure_code
      ) values (
        v_asset.id, v_asset.tenant_id, v_asset.provider,
        'reconcile_required', v_asset.provider_asset_id,
        true, 'provider_reconciliation_required'
      ) returning * into v_session;
      return jsonb_build_object(
        'action', 'reconcile_required', 'asset_id', v_asset.id,
        'creator_correlation', v_asset.id::text
      );
    end if;
    insert into coachfort_internal.video_upload_sessions (
      video_asset_id, tenant_id, provider, state,
      provider_creation_attempted,
      claim_token, claim_started_at, claim_expires_at
    ) values (
      v_asset.id, v_asset.tenant_id, v_asset.provider, 'provisioning',
      true,
      v_claim_token, now(), now() + interval '3 minutes'
    ) returning * into v_session;

    return jsonb_build_object(
      'action', 'create_provider_upload',
      'claim_token', v_session.claim_token,
      'asset_id', v_asset.id,
      'reserved_seconds', v_asset.reserved_seconds,
      'reservation_expires_at', v_asset.reservation_expires_at,
      'creator_correlation', v_asset.id::text,
      'replayed', false
    );
  end if;

  if v_session.state = 'provisioned'
     and v_session.upload_url is not null
     and v_session.provider_upload_expires_at > now()
     and v_asset.provider_asset_id = v_session.provider_asset_id then
    return jsonb_build_object(
      'action', 'replay_existing',
      'asset_id', v_asset.id,
      'upload_url', v_session.upload_url,
      'provider_upload_expires_at', v_session.provider_upload_expires_at,
      'reserved_seconds', v_asset.reserved_seconds,
      'replayed', true
    );
  end if;

  if v_session.state = 'provisioned' then
    update coachfort_internal.video_upload_sessions set
      state = 'reconcile_required', upload_url = null,
      safe_failure_code = 'provider_upload_capability_expired'
    where video_asset_id = v_asset.id
    returning * into v_session;
  elsif v_session.state = 'provisioning'
        and v_session.claim_expires_at <= now() then
    update coachfort_internal.video_upload_sessions set
      state = 'reconcile_required',
      claim_token = null, claim_started_at = null, claim_expires_at = null,
      safe_failure_code = 'provider_creation_outcome_unknown'
    where video_asset_id = v_asset.id
    returning * into v_session;
  end if;

  if v_session.state = 'provisioning' then
    return jsonb_build_object(
      'action', 'wait', 'asset_id', v_asset.id,
      'claim_expires_at', v_session.claim_expires_at
    );
  elsif v_session.state = 'reconcile_required' then
    return jsonb_build_object(
      'action', 'reconcile_required', 'asset_id', v_asset.id,
      'creator_correlation', v_asset.id::text
    );
  end if;

  return jsonb_build_object('action', 'closed', 'asset_id', v_asset.id);
end;
$$;

create function public.complete_native_video_upload_provisioning_server(
  p_asset_id uuid,
  p_claim_token uuid,
  p_provider_asset_id text,
  p_upload_url text,
  p_provider_upload_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
  v_provider_asset_id text := btrim(coalesce(p_provider_asset_id, ''));
  v_upload_url text := btrim(coalesce(p_upload_url, ''));
  v_bind jsonb;
begin
  if p_claim_token is null
     or char_length(v_provider_asset_id) not between 1 and 255
     or v_provider_asset_id ~ '[[:space:][:cntrl:]]'
     or char_length(v_upload_url) not between 1 and 2048
     or v_upload_url !~ '^https://'
     or v_upload_url ~ '[[:space:][:cntrl:]]'
     or p_provider_upload_expires_at is null
     or p_provider_upload_expires_at <= now() then
    raise exception 'Native video provider provisioning result is invalid.'
      using errcode = '22023';
  end if;

  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then
    raise exception 'Native video asset not found.' using errcode = '02000';
  end if;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;
  select * into v_session from coachfort_internal.video_upload_sessions
  where video_asset_id = p_asset_id for update;

  if not found then
    raise exception 'Native video provider session authority is unavailable.'
      using errcode = '55000';
  end if;

  if v_session.state = 'provisioned'
     and v_session.provider_asset_id = v_provider_asset_id
     and v_session.upload_url = v_upload_url
     and v_session.provider_upload_expires_at = p_provider_upload_expires_at
     and v_asset.provider_asset_id = v_provider_asset_id then
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status,
      'upload_url', v_session.upload_url,
      'provider_upload_expires_at', v_session.provider_upload_expires_at,
      'reserved_seconds', v_asset.reserved_seconds, 'replayed', true
    );
  end if;

  if v_asset.status <> 'upload_pending'
     or v_asset.provider <> 'cloudflare_stream'
     or v_asset.provider_asset_id is not null
     or v_asset.reservation_expires_at is null
     or p_provider_upload_expires_at > v_asset.reservation_expires_at
     or v_session.state <> 'provisioning'
     or v_session.claim_token is distinct from p_claim_token
     or v_session.claim_expires_at <= now()
     or v_session.provider_asset_id is not null then
    raise exception 'Native video provider provisioning cannot be completed.'
      using errcode = '55000';
  end if;

  update coachfort_internal.video_upload_sessions set
    state = 'provisioned',
    claim_token = null, claim_started_at = null, claim_expires_at = null,
    provider_asset_id = v_provider_asset_id,
    provider_upload_expires_at = p_provider_upload_expires_at,
    upload_url = v_upload_url, provisioned_at = now(), safe_failure_code = null
  where video_asset_id = v_asset.id;

  v_bind := public.bind_native_video_provider_identity_server(
    v_asset.id, v_provider_asset_id, null
  );

  return jsonb_build_object(
    'asset_id', v_asset.id, 'status', v_bind->>'status',
    'upload_url', v_upload_url,
    'provider_upload_expires_at', p_provider_upload_expires_at,
    'reserved_seconds', v_asset.reserved_seconds, 'replayed', false
  );
end;
$$;

create function public.mark_native_video_upload_provisioning_ambiguous_server(
  p_asset_id uuid,
  p_claim_token uuid,
  p_safe_failure_code text default 'provider_creation_outcome_unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
  v_code text := lower(btrim(coalesce(p_safe_failure_code, '')));
begin
  if p_claim_token is null or v_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'Native video reconciliation input is invalid.' using errcode = '22023';
  end if;
  select * into v_asset from public.video_assets where id = p_asset_id for update;
  select * into v_session from coachfort_internal.video_upload_sessions
  where video_asset_id = p_asset_id for update;
  if not found or v_asset.status <> 'upload_pending'
     or v_asset.provider_asset_id is not null
     or v_session.state <> 'provisioning'
     or v_session.claim_token is distinct from p_claim_token then
    raise exception 'Native video provisioning outcome cannot be marked ambiguous.'
      using errcode = '55000';
  end if;
  update coachfort_internal.video_upload_sessions set
    state = 'reconcile_required',
    claim_token = null, claim_started_at = null, claim_expires_at = null,
    safe_failure_code = v_code
  where video_asset_id = p_asset_id;
  return jsonb_build_object(
    'asset_id', p_asset_id, 'action', 'reconcile_required'
  );
end;
$$;

create function public.fail_unbound_native_video_upload_server(
  p_asset_id uuid,
  p_claim_token uuid,
  p_safe_failure_code text default 'provider_creation_failed'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
  v_code text := lower(btrim(coalesce(p_safe_failure_code, '')));
begin
  if p_claim_token is null or v_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'Native video failure input is invalid.' using errcode = '22023';
  end if;
  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then raise exception 'Native video asset not found.' using errcode = '02000'; end if;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;
  select * into v_session from coachfort_internal.video_upload_sessions
  where video_asset_id = p_asset_id for update;

  if v_asset.status = 'failed' and v_asset.provider_asset_id is null then
    return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status, 'replayed', true);
  end if;
  if v_asset.status <> 'upload_pending' or v_asset.provider_asset_id is not null
     or not found or v_session.state <> 'provisioning'
     or v_session.claim_token is distinct from p_claim_token then
    raise exception 'Bound native video capacity cannot be released as pre-provider failure.'
      using errcode = '55000';
  end if;

  update public.video_assets set
    status = 'failed', reserved_seconds = 0, reservation_expires_at = null,
    failed_at = now(), safe_failure_code = v_code
  where id = v_asset.id returning * into v_asset;
  update coachfort_internal.video_upload_sessions set
    state = 'closed', claim_token = null, claim_started_at = null,
    claim_expires_at = null, upload_url = null, safe_failure_code = v_code
  where video_asset_id = v_asset.id;
  return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status, 'replayed', false);
end;
$$;

create function public.expire_unbound_native_video_upload_server(
  p_asset_id uuid,
  p_reconciliation_claim_token uuid,
  p_provider_match_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
begin
  if p_reconciliation_claim_token is null or p_provider_match_count is null
     or p_provider_match_count < 0 then
    raise exception 'Native video expiry reconciliation input is invalid.'
      using errcode = '22023';
  end if;
  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then raise exception 'Native video asset not found.' using errcode = '02000'; end if;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;
  select * into v_session from coachfort_internal.video_upload_sessions
  where video_asset_id = p_asset_id for update;
  if v_asset.status = 'failed' and v_asset.provider_asset_id is null then
    return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status, 'replayed', true);
  end if;
  if v_asset.status <> 'upload_pending' or v_asset.provider_asset_id is not null
     or v_asset.reservation_expires_at is null
     or v_asset.reservation_expires_at > now()
     or not found
     or v_session.state <> 'reconcile_required'
     or v_session.reconciliation_claim_token is distinct from p_reconciliation_claim_token
     or v_session.reconciliation_claim_expires_at <= now()
     or (v_session.provider_creation_attempted and p_provider_match_count <> 0) then
    raise exception 'Native video reservation is not eligible for unbound expiry.'
      using errcode = '55000';
  end if;
  update public.video_assets set
    status = 'failed', reserved_seconds = 0, reservation_expires_at = null,
    failed_at = now(), safe_failure_code = 'upload_reservation_expired'
  where id = v_asset.id returning * into v_asset;
  update coachfort_internal.video_upload_sessions set
    state = 'closed', claim_token = null, claim_started_at = null,
    claim_expires_at = null, upload_url = null,
    safe_failure_code = 'upload_reservation_expired'
  where video_asset_id = v_asset.id;
  return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status, 'replayed', false);
end;
$$;

create function public.recover_native_video_provider_identity_server(
  p_asset_id uuid,
  p_reconciliation_claim_token uuid,
  p_provider_asset_id text,
  p_provider_match_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
  v_session coachfort_internal.video_upload_sessions%rowtype;
  v_provider_asset_id text := btrim(coalesce(p_provider_asset_id, ''));
begin
  if p_reconciliation_claim_token is null
     or p_provider_match_count is distinct from 1
     or char_length(v_provider_asset_id) not between 1 and 255
     or v_provider_asset_id ~ '[[:space:][:cntrl:]]' then
    raise exception 'Native video recovery input is invalid.' using errcode = '22023';
  end if;
  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then
    raise exception 'Native video asset not found.' using errcode = '02000';
  end if;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;
  select * into v_session from coachfort_internal.video_upload_sessions
  where video_asset_id = p_asset_id for update;
  if not found or v_asset.status <> 'upload_pending'
     or v_asset.provider_asset_id is not null
     or v_session.state <> 'reconcile_required'
     or v_session.reconciliation_claim_token is distinct from p_reconciliation_claim_token
     or v_session.reconciliation_claim_expires_at <= now()
     or v_session.provider_asset_id is not null then
    raise exception 'Native video provider identity cannot be recovered.' using errcode = '55000';
  end if;
  update coachfort_internal.video_upload_sessions set
    provider_asset_id = v_provider_asset_id,
    safe_failure_code = 'provider_identity_recovered'
  where video_asset_id = p_asset_id;
  perform public.bind_native_video_provider_identity_server(
    p_asset_id, v_provider_asset_id, null
  );
  return jsonb_build_object(
    'asset_id', p_asset_id, 'provider_asset_id', v_provider_asset_id,
    'status', 'upload_pending', 'replayed', false
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
        v_event.event_time, v_event.safe_payload_hash, v_event.safe_evidence_json)
       is distinct from
       (v_asset.id, v_provider_asset_id, 'asset.' || v_outcome,
        p_event_time, p_safe_payload_hash, v_evidence) then
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

create function public.observe_native_video_provider_state_server(
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
        v_event.event_time, v_event.safe_payload_hash, v_event.safe_evidence_json)
       is distinct from
       (v_asset.id, v_provider_asset_id, 'asset.' || v_state,
        p_event_time, p_safe_payload_hash, v_evidence) then
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

create function public.claim_native_video_reconciliation_batch_server(
  p_limit integer default 50,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim_token uuid := gen_random_uuid();
  v_items jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50
     or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Native video reconciliation claim is invalid.' using errcode = '22023';
  end if;

  with missing_assets as (
    select asset.*
    from public.video_assets asset
    where not exists (
        select 1 from coachfort_internal.video_upload_sessions session
        where session.video_asset_id = asset.id
      )
      and (
        (asset.status = 'upload_pending' and asset.reservation_expires_at <= now())
        or asset.status in ('processing','delete_pending')
      )
    order by asset.created_at, asset.id
    limit p_limit
    for update of asset skip locked
  )
  insert into coachfort_internal.video_upload_sessions (
    video_asset_id, tenant_id, provider, state, provider_asset_id,
    provider_creation_attempted, safe_failure_code
  )
  select asset.id, asset.tenant_id, asset.provider, 'reconcile_required',
    asset.provider_asset_id,
    asset.provider_asset_id is not null,
    case when asset.provider_asset_id is null
      then 'upload_reservation_expired' else 'provider_reconciliation_required' end
  from missing_assets asset
  on conflict (video_asset_id) do nothing;

  with candidates as (
    select session.video_asset_id
    from coachfort_internal.video_upload_sessions session
    join public.video_assets asset on asset.id = session.video_asset_id
    where (session.reconciliation_claim_expires_at is null
        or session.reconciliation_claim_expires_at <= now())
      and (
        session.state = 'reconcile_required'
        or (session.state = 'provisioning' and session.claim_expires_at <= now())
        or (session.state = 'provisioned'
          and session.provider_upload_expires_at <= now())
        or (asset.status = 'upload_pending' and asset.provider_asset_id is not null)
        or (asset.status = 'upload_pending' and asset.reservation_expires_at <= now())
        or (asset.status = 'processing' and (
          asset.last_provider_observed_at is null
          or asset.last_provider_observed_at <= now() - interval '10 minutes'
        ))
        or asset.status = 'delete_pending'
      )
    order by session.updated_at, session.video_asset_id
    limit p_limit
    for update of session skip locked
  ), claimed as (
    update coachfort_internal.video_upload_sessions session set
      state = case
        when session.state = 'provisioning' and session.claim_expires_at <= now()
          then 'reconcile_required'
        when session.state = 'provisioned'
          and session.provider_upload_expires_at <= now()
          then 'reconcile_required'
        else session.state
      end,
      claim_token = case
        when session.state = 'provisioning' and session.claim_expires_at <= now()
          then null else session.claim_token end,
      claim_started_at = case
        when session.state = 'provisioning' and session.claim_expires_at <= now()
          then null else session.claim_started_at end,
      claim_expires_at = case
        when session.state = 'provisioning' and session.claim_expires_at <= now()
          then null else session.claim_expires_at end,
      upload_url = case
        when session.state = 'provisioned'
          and session.provider_upload_expires_at <= now()
          then null else session.upload_url end,
      safe_failure_code = case
        when session.state = 'provisioning' and session.claim_expires_at <= now()
          then coalesce(session.safe_failure_code, 'provider_creation_outcome_unknown')
        when session.state = 'provisioned'
          and session.provider_upload_expires_at <= now()
          then coalesce(session.safe_failure_code, 'provider_upload_capability_expired')
        else session.safe_failure_code
      end,
      reconciliation_claim_token = v_claim_token,
      reconciliation_claimed_at = now(),
      reconciliation_claim_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where session.video_asset_id = candidates.video_asset_id
    returning session.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'asset_id', asset.id,
    'provider', asset.provider,
    'provider_asset_id', asset.provider_asset_id,
    'asset_status', asset.status,
    'reservation_expires_at', asset.reservation_expires_at,
    'provider_upload_expires_at', claimed.provider_upload_expires_at,
    'reconcile_action', case
      when asset.status = 'delete_pending' then 'delete_provider'
      when asset.status = 'upload_pending' and asset.provider_asset_id is null
        and asset.reservation_expires_at <= now()
        then 'resolve_unbound_reservation'
      when claimed.state = 'reconcile_required' and asset.provider_asset_id is null
        then 'recover_ambiguous_provider'
      else 'get_provider_state'
    end,
    'claim_token', claimed.reconciliation_claim_token
  ) order by claimed.updated_at, claimed.video_asset_id), '[]'::jsonb)
  into v_items
  from claimed
  join public.video_assets asset on asset.id = claimed.video_asset_id;

  return jsonb_build_object(
    'claim_token', v_claim_token,
    'lease_expires_at', now() + make_interval(secs => p_lease_seconds),
    'claimed', jsonb_array_length(v_items),
    'items', v_items
  );
end;
$$;

create function public.release_native_video_reconciliation_claim_server(
  p_asset_id uuid,
  p_claim_token uuid,
  p_safe_failure_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := nullif(lower(btrim(coalesce(p_safe_failure_code, ''))), '');
begin
  if p_claim_token is null
     or (v_code is not null and v_code !~ '^[a-z0-9_]{1,80}$') then
    raise exception 'Native video reconciliation release is invalid.' using errcode = '22023';
  end if;
  update coachfort_internal.video_upload_sessions set
    reconciliation_claim_token = null, reconciliation_claimed_at = null,
    reconciliation_claim_expires_at = null, last_reconciled_at = now(),
    safe_failure_code = coalesce(v_code, safe_failure_code)
  where video_asset_id = p_asset_id
    and reconciliation_claim_token = p_claim_token;
  if not found then
    raise exception 'Native video reconciliation claim is unavailable.' using errcode = '55000';
  end if;
  return jsonb_build_object('asset_id', p_asset_id, 'released', true);
end;
$$;

alter function coachfort_internal.enforce_video_upload_session_authority()
  owner to postgres;
revoke all on function coachfort_internal.enforce_video_upload_session_authority()
  from public, anon, authenticated, service_role;

alter function coachfort_internal.enforce_video_asset_authority() owner to postgres;
revoke all on function coachfort_internal.enforce_video_asset_authority()
  from public, anon, authenticated, service_role;
alter function coachfort_internal.resolve_native_video_usage(uuid,uuid)
  owner to postgres;
revoke all on function coachfort_internal.resolve_native_video_usage(uuid,uuid)
  from public, anon, authenticated, service_role;

alter function public.bind_native_video_provider_identity_server(uuid,text,text)
  owner to postgres;
alter function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb) owner to postgres;
alter function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb) owner to postgres;

do $$
declare
  v_identity regprocedure;
begin
  foreach v_identity in array array[
    'public.claim_native_video_upload_provisioning_server(uuid)'::regprocedure,
    'public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'::regprocedure,
    'public.mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)'::regprocedure,
    'public.fail_unbound_native_video_upload_server(uuid,uuid,text)'::regprocedure,
    'public.expire_unbound_native_video_upload_server(uuid,uuid,integer)'::regprocedure,
    'public.recover_native_video_provider_identity_server(uuid,uuid,text,integer)'::regprocedure,
    'public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'::regprocedure,
    'public.claim_native_video_reconciliation_batch_server(integer,integer)'::regprocedure,
    'public.release_native_video_reconciliation_claim_server(uuid,uuid,text)'::regprocedure
  ] loop
    execute format('alter function %s owner to postgres', v_identity);
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_identity
    );
    execute format('grant execute on function %s to service_role', v_identity);
  end loop;
end;
$$;

revoke all on function public.bind_native_video_provider_identity_server(uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_native_video_provider_identity_server(uuid,text,text)
  to service_role;
revoke all on function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb) to service_role;
revoke all on function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb) to service_role;

do $$
declare
  v_baseline video2b0_apply_baseline%rowtype;
  v_protected jsonb;
  v_new_function_count integer;
  v_relation text;
  v_count bigint;
  v_fingerprint text;
  v_expected video2b0_protected_business_baseline%rowtype;
begin
  select * into v_baseline from video2b0_apply_baseline;
  for v_expected in select * from video2b0_protected_business_baseline loop
    v_relation := v_expected.relation_name;
    execute format(
      'select count(*), md5(coalesce(string_agg(to_jsonb(row_data)::text, ''|'' order by to_jsonb(row_data)::text), '''')) from %s row_data',
      v_relation
    ) into v_count, v_fingerprint;
    if v_count is distinct from v_expected.row_count
       or v_fingerprint is distinct from v_expected.row_fingerprint then
      raise exception 'VIDEO-2B0 changed protected business relation %.', v_relation
        using errcode = '55000';
    end if;
  end loop;
  select jsonb_object_agg(
    procedure.oid::regprocedure::text,
    jsonb_build_object(
      'definition', pg_get_functiondef(procedure.oid),
      'owner', pg_get_userbyid(procedure.proowner),
      'acl', coalesce(procedure.proacl::text, ''),
      'security_definer', procedure.prosecdef,
      'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
    ) order by procedure.oid::regprocedure::text
  ) into v_protected
  from pg_proc procedure
  where procedure.oid in (
    to_regprocedure('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    to_regprocedure('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
    to_regprocedure('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    to_regprocedure('public.confirm_native_video_provider_deletion_server(uuid,text)'),
    to_regprocedure('public.get_native_video_capacity_server(uuid,uuid)'),
    to_regprocedure('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    to_regprocedure('coachfort_internal.resolve_native_video_capacity(uuid)'),
    to_regprocedure('coachfort_internal.enforce_lesson_external_video_authority()')
  );

  select count(*) into v_new_function_count
  from (values
    ('public.claim_native_video_upload_provisioning_server(uuid)'),
    ('public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'),
    ('public.mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)'),
    ('public.fail_unbound_native_video_upload_server(uuid,uuid,text)'),
    ('public.expire_unbound_native_video_upload_server(uuid,uuid,integer)'),
    ('public.recover_native_video_provider_identity_server(uuid,uuid,text,integer)'),
    ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'),
    ('public.claim_native_video_reconciliation_batch_server(integer,integer)'),
    ('public.release_native_video_reconciliation_claim_server(uuid,uuid,text)')
  ) expected(identity)
  where to_regprocedure(identity) is not null;

  if v_new_function_count <> 9
     or to_regclass('coachfort_internal.video_upload_sessions') is null
     or to_regprocedure(
       'coachfort_internal.enforce_video_upload_session_authority()'
     ) is null
     or to_regprocedure(
       'coachfort_internal.video_provider_event_evidence_is_safe(jsonb)'
     ) is null
     or (select count(*) from pg_trigger trigger_def
       where trigger_def.tgrelid =
         'coachfort_internal.video_upload_sessions'::regclass
         and trigger_def.tgname = 'enforce_video_upload_session_authority'
         and trigger_def.tgfoid = to_regprocedure(
           'coachfort_internal.enforce_video_upload_session_authority()'
         )) <> 1
     or (select count(*) from pg_constraint constraint_def
       where constraint_def.conrelid = 'public.video_provider_events'::regclass
         and constraint_def.conname =
           'video_provider_events_safe_evidence_capability_check') <> 1 then
    raise exception 'VIDEO-2B0 pre-commit object installation contract failed.'
      using errcode = '55000';
  end if;

  if (select count(*) from coachfort_internal.video_upload_sessions) <> 0
     or (select count(*) from public.video_assets) <> 0
     or (select count(*) from public.video_asset_attachments) <> 0
     or (select count(*) from public.video_provider_events) <> 0
     or (select count(*)
       from public.tenant_video_capacity_pack_assignments) <> 0 then
    raise exception 'VIDEO-2B0 pre-commit zero fabricated data contract failed.'
      using errcode = '55000';
  end if;

  if (select count(*) from public.tenants) is distinct from v_baseline.tenant_rows
     or (select count(*) from public.tenant_subscription_assignments)
       is distinct from v_baseline.assignment_rows
     or (select count(*) from public.subscription_plans)
       is distinct from v_baseline.plan_rows
     or (select md5(coalesce(
       string_agg(to_jsonb(plan)::text, '|' order by plan.id), ''
     )) from public.subscription_plans plan)
       is distinct from v_baseline.plan_fingerprint
     or (select count(*) from public.subscription_plan_feature_entitlements)
       is distinct from v_baseline.feature_rows
     or (select md5(coalesce(
       string_agg(to_jsonb(feature)::text, '|' order by feature.id), ''
     )) from public.subscription_plan_feature_entitlements feature)
       is distinct from v_baseline.feature_fingerprint
     or (select count(*) from public.subscription_plan_usage_limits)
       is distinct from v_baseline.limit_rows
     or (select md5(coalesce(
       string_agg(to_jsonb(limit_row)::text, '|' order by limit_row.id), ''
     )) from public.subscription_plan_usage_limits limit_row)
       is distinct from v_baseline.limit_fingerprint
     or (select count(*) from public.lessons)
       is distinct from v_baseline.lesson_rows
     or (select md5(coalesce(
       string_agg(to_jsonb(lesson)::text, '|' order by lesson.id), ''
     )) from public.lessons lesson)
       is distinct from v_baseline.lesson_fingerprint
     or (select count(*) from public.tenant_payment_orders)
       is distinct from v_baseline.payment_order_rows
     or (select count(*) from public.tenant_payment_attempts)
       is distinct from v_baseline.payment_attempt_rows
     or (select count(*) from public.invoices)
       is distinct from v_baseline.invoice_rows
     or (select count(*) from public.platform_billing_receipts)
       is distinct from v_baseline.receipt_rows
     or (select count(*) from public.finance_invoices)
       is distinct from v_baseline.finance_invoice_rows
     or (select count(*) from public.finance_payments)
       is distinct from v_baseline.finance_payment_rows
     or (select count(*) from public.finance_receipts)
       is distinct from v_baseline.finance_receipt_rows then
    raise exception 'VIDEO-2B0 protected business-data fingerprint changed.'
      using errcode = '55000';
  end if;

  if v_protected is distinct from v_baseline.protected_function_contract then
    raise exception 'VIDEO-2B0 protected unaffected-function fingerprint changed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.bind_native_video_provider_identity_server(uuid,text,text)',
        'v'::text, true),
      ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)',
        'v'::text, true),
      ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)',
        'v'::text, true),
      ('coachfort_internal.enforce_video_asset_authority()',
        'v'::text, false),
      ('coachfort_internal.resolve_native_video_usage(uuid,uuid)',
        's'::text, false)
    ) expected(identity, volatility, service_role_execute)
    left join pg_proc procedure
      on procedure.oid = to_regprocedure(expected.identity)
    where procedure.oid is null
      or pg_get_userbyid(procedure.proowner) <> 'postgres'
      or not procedure.prosecdef
      or procedure.provolatile::text <> expected.volatility
      or procedure.proconfig is distinct from
        array['search_path=public, pg_temp']
      or has_function_privilege('anon', procedure.oid, 'EXECUTE')
      or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      or has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        is distinct from expected.service_role_execute
      or exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
      or exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and not (
            expected.service_role_execute
            and acl.grantee = 'service_role'::regrole::oid
          )
      )
  ) or (select count(*)
    from pg_proc candidate
    join pg_namespace namespace_def on namespace_def.oid = candidate.pronamespace
    where (namespace_def.nspname, candidate.proname) in (
      ('public', 'bind_native_video_provider_identity_server'),
      ('public', 'finalize_native_video_asset_processing_server'),
      ('public', 'record_native_video_provider_event_server'),
      ('coachfort_internal', 'enforce_video_asset_authority'),
      ('coachfort_internal', 'resolve_native_video_usage')
    )) <> 5 then
    raise exception 'VIDEO-2B0 pre-commit modified-function security contract failed.'
      using errcode = '55000';
  end if;

  if lower(pg_get_functiondef(to_regprocedure(
       'public.bind_native_video_provider_identity_server(uuid,text,text)'
     ))) like '%status = ''processing''%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.bind_native_video_provider_identity_server(uuid,text,text)'
     ))) not like '%provider session authority is unavailable%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
     ))) not like '%if v_asset.status = ''upload_pending''%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
     ))) not like '%video_provider_event_evidence_is_safe(v_evidence)%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'
     ))) not like '%video_provider_event_evidence_is_safe(v_evidence)%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'
     ))) not like '%on conflict (provider, event_key) do nothing%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'
     ))) not like '%provider event key was reused with conflicting evidence%'
     or lower(pg_get_functiondef(to_regprocedure(
       'coachfort_internal.enforce_video_asset_authority()'
     ))) not like '%''processing'',''failed'',''delete_pending''%'
     or lower(pg_get_functiondef(to_regprocedure(
       'coachfort_internal.resolve_native_video_usage(uuid,uuid)'
     ))) not like '%or asset.provider_asset_id is not null%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'
     ))) not like
       '%p_provider_upload_expires_at > v_asset.reservation_expires_at%' then
    raise exception 'VIDEO-2B0 pre-commit modified-function semantic contract failed.'
      using errcode = '55000';
  end if;

  if (select class.relowner = 'postgres'::regrole
       and class.relrowsecurity
       from pg_class class
       where class.oid = 'coachfort_internal.video_upload_sessions'::regclass)
       is distinct from true
     or exists (
    select 1 from information_schema.table_privileges privilege
    where privilege.table_schema = 'coachfort_internal'
      and privilege.table_name = 'video_upload_sessions'
      and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
  ) then
    raise exception 'VIDEO-2B0 pre-commit private session ACL contract failed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from information_schema.columns column_def
    where column_def.table_schema = 'public'
      and column_def.table_name in ('video_assets','video_provider_events')
      and column_def.column_name = 'upload_url'
  ) or not coachfort_internal.video_provider_event_evidence_is_safe(
    '{"state":"queued","duration_seconds":120}'::jsonb
  ) or coachfort_internal.video_provider_event_evidence_is_safe(
    '{"nested":{"upload_url":"https://upload.invalid/capability"}}'::jsonb
  ) then
    raise exception 'VIDEO-2B0 pre-commit upload capability privacy contract failed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_proc procedure
    where procedure.pronamespace in ('public'::regnamespace, 'coachfort_internal'::regnamespace)
      and lower(pg_get_functiondef(procedure.oid)) ~
        'cloudflare_(stream_api_token|account_id|stream_webhook_secret)'
  ) then
    raise exception 'VIDEO-2B0 pre-commit provider-secret absence contract failed.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;

-- ============================================================================
-- POST-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with
sources as (
  select
    lower(pg_get_functiondef(to_regprocedure(
      'public.bind_native_video_provider_identity_server(uuid,text,text)'
    ))) as bind_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.claim_native_video_upload_provisioning_server(uuid)'
    ))) as claim_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'
    ))) as complete_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)'
    ))) as ambiguous_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.fail_unbound_native_video_upload_server(uuid,uuid,text)'
    ))) as fail_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.expire_unbound_native_video_upload_server(uuid,uuid,integer)'
    ))) as expire_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.recover_native_video_provider_identity_server(uuid,uuid,text,integer)'
    ))) as recover_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'
    ))) as observe_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'
    ))) as finalize_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'
    ))) as record_source,
    lower(pg_get_functiondef(to_regprocedure(
      'public.claim_native_video_reconciliation_batch_server(integer,integer)'
    ))) as reconciliation_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.video_provider_event_evidence_is_safe(jsonb)'
    ))) as evidence_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.resolve_native_video_usage(uuid,uuid)'
    ))) as usage_source,
    lower(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_video_asset_authority()'
    ))) as transition_source
),
function_security as (
  select
    count(*) = 9 as exact_function_count,
    bool_and(pg_get_userbyid(procedure.proowner) = 'postgres') as postgres_owned,
    bool_and(procedure.prosecdef) as security_definer,
    bool_and(procedure.proconfig @> array['search_path=public, pg_temp']) as fixed_search_path,
    bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as server_only_acl
  from pg_proc procedure
  where procedure.oid in (
    to_regprocedure('public.claim_native_video_upload_provisioning_server(uuid)'),
    to_regprocedure('public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'),
    to_regprocedure('public.mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)'),
    to_regprocedure('public.fail_unbound_native_video_upload_server(uuid,uuid,text)'),
    to_regprocedure('public.expire_unbound_native_video_upload_server(uuid,uuid,integer)'),
    to_regprocedure('public.recover_native_video_provider_identity_server(uuid,uuid,text,integer)'),
    to_regprocedure('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'),
    to_regprocedure('public.claim_native_video_reconciliation_batch_server(integer,integer)'),
    to_regprocedure('public.release_native_video_reconciliation_claim_server(uuid,uuid,text)')
  )
),
corrected_public_security as (
  select
    count(*) = 3
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.proconfig @> array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as corrected_public_authority_secure
  from pg_proc procedure
  where procedure.oid in (
    to_regprocedure('public.bind_native_video_provider_identity_server(uuid,text,text)'),
    to_regprocedure('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    to_regprocedure('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)')
  )
),
corrected_internal_security as (
  select
    count(*) = 4
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.proconfig @> array['search_path=public, pg_temp'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )) as corrected_internal_authority_secure
  from pg_proc procedure
  where procedure.oid in (
    to_regprocedure('coachfort_internal.enforce_video_asset_authority()'),
    to_regprocedure('coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
    to_regprocedure('coachfort_internal.enforce_video_upload_session_authority()'),
    to_regprocedure('coachfort_internal.video_provider_event_evidence_is_safe(jsonb)')
  )
),
install_contract as (
  select
    to_regclass('coachfort_internal.video_upload_sessions') is not null
      and to_regprocedure(
        'coachfort_internal.enforce_video_upload_session_authority()'
      ) is not null
      and to_regprocedure(
        'coachfort_internal.video_provider_event_evidence_is_safe(jsonb)'
      ) is not null
      and (select count(*) from pg_trigger trigger_def
        where trigger_def.tgrelid =
          'coachfort_internal.video_upload_sessions'::regclass
          and trigger_def.tgname = 'enforce_video_upload_session_authority'
          and trigger_def.tgfoid = to_regprocedure(
            'coachfort_internal.enforce_video_upload_session_authority()'
          )) = 1
      and (select count(*) from (values
        ('public.claim_native_video_upload_provisioning_server(uuid)'),
        ('public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)'),
        ('public.mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)'),
        ('public.fail_unbound_native_video_upload_server(uuid,uuid,text)'),
        ('public.expire_unbound_native_video_upload_server(uuid,uuid,integer)'),
        ('public.recover_native_video_provider_identity_server(uuid,uuid,text,integer)'),
        ('public.observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)'),
        ('public.claim_native_video_reconciliation_batch_server(integer,integer)'),
        ('public.release_native_video_reconciliation_claim_server(uuid,uuid,text)')
      ) expected(identity)
      where to_regprocedure(expected.identity) is not null) = 9
      and to_regprocedure(
        'public.request_expired_native_video_provider_cleanup_server(uuid,text)'
      ) is null
      as complete_partial_install_guard
),
video2b0_modified_function_contract as (
  select
    count(*) = 5
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile::text = expected.volatility)
      and bool_and(
        procedure.proconfig = array['search_path=public, pg_temp']
      )
      and bool_and(not has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      ))
      and bool_and(not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ))
      and bool_and(
        has_function_privilege('service_role', procedure.oid, 'EXECUTE')
          = expected.service_role_execute
      )
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> procedure.proowner
          and not (
            expected.service_role_execute
            and acl.grantee = 'service_role'::regrole::oid
          )
      ))
      and (select count(*)
        from pg_proc candidate
        join pg_namespace namespace_def
          on namespace_def.oid = candidate.pronamespace
        where (namespace_def.nspname, candidate.proname) in (
          ('public', 'bind_native_video_provider_identity_server'),
          ('public', 'finalize_native_video_asset_processing_server'),
          ('public', 'record_native_video_provider_event_server'),
          ('coachfort_internal', 'enforce_video_asset_authority'),
          ('coachfort_internal', 'resolve_native_video_usage')
        )) = 5
      and bool_and(
        sources.bind_source not like '%status = ''processing''%'
        and sources.bind_source like '%provider session authority is unavailable%'
        and sources.finalize_source like '%if v_asset.status = ''upload_pending''%'
        and sources.finalize_source like
          '%video_provider_event_evidence_is_safe(v_evidence)%'
        and sources.record_source like
          '%video_provider_event_evidence_is_safe(v_evidence)%'
        and sources.record_source like
          '%on conflict (provider, event_key) do nothing%'
        and sources.record_source like
          '%provider event key was reused with conflicting evidence%'
        and sources.transition_source like
          '%''processing'',''failed'',''delete_pending''%'
        and sources.usage_source like '%or asset.provider_asset_id is not null%'
      )
      as video2b0_modified_function_contract_verified
  from (values
    ('public.bind_native_video_provider_identity_server(uuid,text,text)',
      'v'::text, true),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)',
      'v'::text, true),
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)',
      'v'::text, true),
    ('coachfort_internal.enforce_video_asset_authority()',
      'v'::text, false),
    ('coachfort_internal.resolve_native_video_usage(uuid,uuid)',
      's'::text, false)
  ) expected(identity, volatility, service_role_execute)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  cross join sources
),
session_contract as (
  select
    to_regclass('coachfort_internal.video_upload_sessions') is not null
      and (select count(*) from pg_constraint
        where conrelid = 'coachfort_internal.video_upload_sessions'::regclass
          and conname = 'video_upload_sessions_pkey') = 1
      as one_session_per_asset,
    (select relowner = 'postgres'::regrole
       and relrowsecurity
       from pg_class where oid = 'coachfort_internal.video_upload_sessions'::regclass)
      as upload_session_private,
    (select relowner = 'postgres'::regrole
       and relrowsecurity
       from pg_class where oid = 'coachfort_internal.video_upload_sessions'::regclass)
      and not exists (
        select 1 from information_schema.table_privileges privilege
        where privilege.table_schema = 'coachfort_internal'
          and privilege.table_name = 'video_upload_sessions'
          and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
      ) as upload_url_private,
    not exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'coachfort_internal'
        and privilege.table_name = 'video_upload_sessions'
        and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
    ) as service_direct_private_table_reads_absent,
    not exists (
      select 1 from information_schema.columns column_def
      where column_def.table_schema = 'public'
        and column_def.table_name in ('video_assets','video_provider_events')
        and column_def.column_name = 'upload_url'
    ) as no_public_upload_url_column,
    (select count(*) = 1
      from pg_constraint constraint_def
      where constraint_def.conrelid = 'public.video_provider_events'::regclass
        and constraint_def.conname =
          'video_provider_events_safe_evidence_capability_check'
        and pg_get_constraintdef(constraint_def.oid) like
          '%video_provider_event_evidence_is_safe(safe_evidence_json)%')
      and sources.evidence_source like '%regexp_replace(lower(v_key)%'
      and sources.evidence_source like '%''uploadurl''%'
      and sources.evidence_source like '%''location''%'
      and sources.evidence_source like '%''authorization''%'
      and sources.evidence_source like '%''apitoken''%'
      and sources.evidence_source like '%''accesstoken''%'
      and sources.evidence_source like '%''token''%'
      and sources.evidence_source like '%''secret''%'
      and sources.evidence_source like '%''webhooksecret''%'
      and sources.evidence_source like '%''webhooksignature''%'
      and sources.evidence_source like
        '%video_provider_event_evidence_is_safe(v_value)%'
      and sources.record_source like
        '%video_provider_event_evidence_is_safe(v_evidence)%'
      and sources.finalize_source like
        '%video_provider_event_evidence_is_safe(v_evidence)%'
      and sources.observe_source like
        '%video_provider_event_evidence_is_safe(v_evidence)%'
      and coachfort_internal.video_provider_event_evidence_is_safe(
        '{"state":"queued","duration_seconds":120}'::jsonb
      )
      and not coachfort_internal.video_provider_event_evidence_is_safe(
        '{"nested":{"upload_url":"https://upload.invalid/capability"}}'::jsonb
      )
      and not coachfort_internal.video_provider_event_evidence_is_safe(
        '{"nested":[{"Webhook-Signature":"sensitive"}]}'::jsonb
      )
      as provider_event_evidence_rejects_upload_capability,
    (select count(*) from coachfort_internal.video_upload_sessions) = 0
      as zero_upload_sessions_fabricated
  from sources
),
behavior_contract as (
  select
    bind_source not like '%status = ''processing''%'
      and bind_source like '%status = ''upload_pending''%'
      as provider_bind_keeps_upload_pending,
    bind_source like '%provider identity cannot be changed%'
      or bind_source like '%provider_asset_id is not null%'
      as provider_identity_immutable,
    claim_source like '%for update%'
      and claim_source like '%''action'', ''create_provider_upload''%'
      and claim_source like '%''action'', ''wait''%'
      and claim_source like '%''action'', ''replay_existing''%'
      and claim_source like '%''action'', ''reconcile_required''%'
      as provision_claim_concurrency_safe,
    claim_source like '%if not found then%'
      and claim_source like '%v_asset.provider_asset_id is not null%'
      and claim_source like '%provider_reconciliation_required%'
      as active_claim_prevents_duplicate_create,
    claim_source like '%interval ''3 minutes''%'
      as provision_claim_finite_lease,
    claim_source like '%claim_expires_at <= now()%'
      and claim_source like '%provider_creation_outcome_unknown%'
      as ambiguous_claim_requires_reconcile,
    complete_source like '%p_provider_upload_expires_at > v_asset.reservation_expires_at%'
      as provider_expiry_not_after_reservation,
    complete_source like '%upload_url%'
      and complete_source like '%video_upload_sessions%'
      as upload_url_service_only,
    fail_source like '%provider_asset_id is not null%'
      and fail_source like '%reserved_seconds = 0%'
      and fail_source like '%status = ''failed''%'
      as definite_unbound_failure_releases_capacity,
    expire_source like '%reservation_expires_at > now()%'
      and expire_source like '%reserved_seconds = 0%'
      as expired_unbound_reservation_releases_capacity,
    observe_source like '%v_state = ''pendingupload''%'
      and observe_source like '%v_asset.status = ''upload_pending''%'
      and observe_source like '%v_session.state <> ''provisioned''%'
      and observe_source like '%update public.video_assets set last_provider_observed_at%'
      as pendingupload_observation_keeps_valid_upload_pending,
    observe_source like '%v_asset.reservation_expires_at <= now()%'
      and observe_source like '%v_session.provider_upload_expires_at <= now()%'
      and observe_source like '%status = ''delete_pending''%'
      and observe_source like '%provider_upload_expired%'
      and observe_source not like '%interval ''15 minutes''%'
      as expired_pendingupload_observation_goes_delete_pending,
    recover_source like '%safe_failure_code = ''provider_identity_recovered''%'
      and recover_source not like '%reconciliation_claim_token = null%'
      and observe_source like '%v_session.upload_url is null%'
      and observe_source like '%provider_upload_capability_unavailable%'
      and observe_source like '%status = ''delete_pending''%'
      as recovered_pendingupload_without_capability_goes_delete_pending,
    observe_source like '%v_state in (''downloading'',''queued'',''inprogress'')%'
      and observe_source like
        '%status = ''processing'', last_provider_observed_at = p_event_time%'
      as processing_observation_advances_processing,
    observe_source like '%elsif v_asset.status <> ''deleted'' then%'
      and observe_source like
        '%update public.video_assets set last_provider_observed_at = p_event_time%'
      and observe_source like '%v_observation_accepted := true%'
      as accepted_nonterminal_observation_advances_watermark,
    observe_source like
        '%elsif v_state = ''live-inprogress'' and v_asset.status <> ''deleted'' then%'
      and observe_source like
        '%update public.video_assets set last_provider_observed_at = p_event_time%'
      as live_inprogress_advances_watermark_without_lifecycle_regression,
    observe_source like
        '%when v_observation_accepted then ''processed'' else ''ignored''%'
      as accepted_current_observation_is_processed,
    finalize_source like '%if v_asset.status = ''upload_pending''%'
      and finalize_source like '%set status = ''processing''%'
      and finalize_source like '%status = ''ready''%'
      as provider_bound_upload_pending_ready_supported,
    finalize_source like '%if v_outcome = ''failed''%'
      and finalize_source like '%status = ''delete_pending''%'
      as provider_bound_upload_pending_error_supported,
    observe_source like '%p_event_time < v_asset.last_provider_observed_at%'
      and observe_source like '%''stale_observation'', true%'
      and position(
        'p_event_time < v_asset.last_provider_observed_at' in observe_source
      ) < position(
        'if v_state in (''downloading'',''queued'',''inprogress'') then'
        in observe_source
      )
      as stale_observation_blocked,
    usage_source like '%or asset.provider_asset_id is not null%'
      as provider_bound_pending_retains_capacity,
    finalize_source like '%if v_outcome = ''failed''%'
      and finalize_source like '%status = ''delete_pending''%'
      as provider_failure_goes_delete_pending,
    claim_source like '%''creator_correlation'', v_asset.id::text%'
      and claim_source not like '%tenant_name%'
      and claim_source not like '%email%'
      as creator_correlation_asset_uuid_only,
    reconciliation_source like '%limit p_limit%'
      and reconciliation_source like '%p_limit not between 1 and 50%'
      as reconciliation_claim_bounded,
    reconciliation_source like '%for update of session skip locked%'
      as reconciliation_claim_skip_locked_or_equivalent,
    reconciliation_source like '%p_lease_seconds not between 30 and 900%'
      as reconciliation_claim_finite_lease
  from sources
),
video2a_preservation as (
  select
    (select count(*) from public.subscription_plan_feature_entitlements feature
      join public.subscription_plans plan on plan.id = feature.plan_id
      where plan.code in ('starter','growth','premium')
        and feature.feature_key = 'native_video'
        and feature.entitlement_status = 'included') = 3
      and (select count(*) from public.subscription_plan_usage_limits usage
        join public.subscription_plans plan on plan.id = usage.plan_id
        where plan.code in ('starter','growth','premium')
          and usage.resource_key = 'video_storage_minutes'
          and usage.limit_type = 'duration_minutes'
          and usage.enforcement_mode = 'hard') = 3
      and (select count(*) from public.video_capacity_pack_catalog
        where code = 'video_capacity_25h' and capacity_minutes = 1500
          and status = 'inactive' and not is_public and not is_purchasable) = 1
      as video2a_contract_preserved,
    lower(pg_get_functiondef(to_regprocedure(
      'public.confirm_native_video_provider_deletion_server(uuid,text)'
    ))) like '%reserved_seconds = 0%'
      as provider_deletion_required_for_release
),
privacy_contract as (
  select
    not exists (
      select 1 from pg_proc procedure
      where procedure.pronamespace in ('public'::regnamespace, 'coachfort_internal'::regnamespace)
        and lower(pg_get_functiondef(procedure.oid)) ~
          'cloudflare_(stream_api_token|account_id|stream_webhook_secret)'
    ) as no_provider_secret_in_sql,
    not exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema in ('public','coachfort_internal')
        and privilege.table_name in (
          'video_assets','video_asset_attachments','video_provider_events',
          'video_upload_sessions'
        )
        and privilege.grantee in ('PUBLIC','anon','authenticated')
        and privilege.privilege_type in ('INSERT','UPDATE','DELETE')
    ) as browser_direct_writes_absent
),
data_contract as (
  select
    (select count(*) from public.video_assets) = 0
      and (select count(*) from public.video_asset_attachments) = 0
      and (select count(*) from public.video_provider_events) = 0
      and (select count(*) from public.tenant_video_capacity_pack_assignments) = 0
      as zero_video_rows_fabricated,
    (select count(*) from coachfort_internal.video_upload_sessions) = 0
      as zero_upload_sessions_fabricated,
    (select count(*) from public.video_assets) = 0
      and (select count(*) from public.video_asset_attachments) = 0
      and (select count(*) from public.video_provider_events) = 0
      and (select count(*) from coachfort_internal.video_upload_sessions) = 0
      as zero_video_business_rows_unchanged
),
gate as (
  select
    function_security.exact_function_count
      and function_security.postgres_owned
      and function_security.security_definer
      and function_security.fixed_search_path
      and function_security.server_only_acl
      and corrected_public_security.corrected_public_authority_secure
      and corrected_internal_security.corrected_internal_authority_secure
      and install_contract.complete_partial_install_guard
      and video2b0_modified_function_contract.video2b0_modified_function_contract_verified
      and session_contract.one_session_per_asset
      and session_contract.upload_session_private
      and session_contract.upload_url_private
      and session_contract.service_direct_private_table_reads_absent
      and session_contract.no_public_upload_url_column
      and session_contract.provider_event_evidence_rejects_upload_capability
      and session_contract.zero_upload_sessions_fabricated
      and behavior_contract.provider_bind_keeps_upload_pending
      and behavior_contract.provider_identity_immutable
      and behavior_contract.provision_claim_concurrency_safe
      and behavior_contract.active_claim_prevents_duplicate_create
      and behavior_contract.provision_claim_finite_lease
      and behavior_contract.ambiguous_claim_requires_reconcile
      and behavior_contract.provider_expiry_not_after_reservation
      and behavior_contract.upload_url_service_only
      and behavior_contract.definite_unbound_failure_releases_capacity
      and behavior_contract.expired_unbound_reservation_releases_capacity
      and behavior_contract.pendingupload_observation_keeps_valid_upload_pending
      and behavior_contract.expired_pendingupload_observation_goes_delete_pending
      and behavior_contract.recovered_pendingupload_without_capability_goes_delete_pending
      and behavior_contract.processing_observation_advances_processing
      and behavior_contract.accepted_nonterminal_observation_advances_watermark
      and behavior_contract.live_inprogress_advances_watermark_without_lifecycle_regression
      and behavior_contract.accepted_current_observation_is_processed
      and behavior_contract.provider_bound_upload_pending_ready_supported
      and behavior_contract.provider_bound_upload_pending_error_supported
      and behavior_contract.stale_observation_blocked
      and behavior_contract.provider_bound_pending_retains_capacity
      and behavior_contract.provider_failure_goes_delete_pending
      and behavior_contract.creator_correlation_asset_uuid_only
      and behavior_contract.reconciliation_claim_bounded
      and behavior_contract.reconciliation_claim_skip_locked_or_equivalent
      and behavior_contract.reconciliation_claim_finite_lease
      and video2a_preservation.video2a_contract_preserved
      and video2a_preservation.provider_deletion_required_for_release
      and privacy_contract.no_provider_secret_in_sql
      and privacy_contract.browser_direct_writes_absent
      and data_contract.zero_video_rows_fabricated
      and data_contract.zero_upload_sessions_fabricated
      and data_contract.zero_video_business_rows_unchanged
      as security_gate
  from function_security, corrected_public_security, corrected_internal_security,
       install_contract, video2b0_modified_function_contract, session_contract,
       behavior_contract,
       video2a_preservation, privacy_contract, data_contract
)
select
  gate.security_gate,
  function_security.*,
  corrected_public_security.*,
  corrected_internal_security.*,
  install_contract.*,
  video2b0_modified_function_contract.*,
  session_contract.*,
  behavior_contract.*,
  video2a_preservation.*,
  privacy_contract.*,
  data_contract.*
from gate, function_security, corrected_public_security, corrected_internal_security,
     install_contract, video2b0_modified_function_contract, session_contract,
     behavior_contract,
     video2a_preservation, privacy_contract, data_contract;
