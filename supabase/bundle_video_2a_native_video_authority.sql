-- Bundle VIDEO-2A: Native video authority and storage quota foundation
--
-- Review before execution. Do not execute automatically.
-- Cloudflare Stream is the launch provider and Mux is a schema-level fallback.
-- This migration performs no provider calls and stores no provider secrets.
--
-- Commercial boundary: Premium remains Contact Sales in the current repository.
-- PLAN-FINAL, not VIDEO-2A, owns any future fixed-price/self-service change.

-- ============================================================================
-- PRE-APPLY READ-ONLY VERIFICATION
-- ============================================================================
with required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.tenant_members'),
    ('public.subscription_plans'),
    ('public.subscription_plan_prices'),
    ('public.subscription_plan_usage_limits'),
    ('public.subscription_plan_feature_entitlements'),
    ('public.tenant_subscription_assignments'),
    ('public.tenant_subscription_overrides'),
    ('public.tenant_payment_orders'),
    ('public.tenant_payment_attempts'),
    ('public.payment_transactions'),
    ('public.invoices'),
    ('public.platform_billing_receipts'),
    ('public.platform_billing_document_fulfillments'),
    ('public.finance_invoices'),
    ('public.finance_payments'),
    ('public.finance_receipts'),
    ('public.courses'),
    ('public.course_sections'),
    ('public.lessons')
), relation_state as (
  select
    count(*) expected_count,
    count(*) filter (where to_regclass(identity) is not null) installed_count,
    coalesce(jsonb_agg(identity order by identity)
      filter (where to_regclass(identity) is null), '[]'::jsonb) missing
  from required_relations
), required_columns(table_name, column_name, data_type) as (
  values
    ('subscription_plans', 'id', 'uuid'),
    ('subscription_plans', 'code', 'text'),
    ('subscription_plans', 'status', 'text'),
    ('subscription_plan_usage_limits', 'plan_id', 'uuid'),
    ('subscription_plan_usage_limits', 'resource_key', 'text'),
    ('subscription_plan_usage_limits', 'limit_value', 'integer'),
    ('subscription_plan_usage_limits', 'limit_type', 'text'),
    ('subscription_plan_usage_limits', 'enforcement_mode', 'text'),
    ('subscription_plan_feature_entitlements', 'plan_id', 'uuid'),
    ('subscription_plan_feature_entitlements', 'feature_key', 'text'),
    ('subscription_plan_feature_entitlements', 'entitlement_status', 'text'),
    ('tenant_subscription_overrides', 'tenant_id', 'uuid'),
    ('tenant_subscription_overrides', 'override_type', 'text'),
    ('tenant_subscription_overrides', 'resource_key', 'text'),
    ('tenant_subscription_overrides', 'feature_key', 'text'),
    ('tenant_subscription_overrides', 'override_value_json', 'jsonb'),
    ('lessons', 'id', 'uuid'),
    ('lessons', 'tenant_id', 'uuid'),
    ('lessons', 'video_url', 'text')
), column_state as (
  select
    count(*) expected_count,
    count(column_def.column_name) installed_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'table', expected.table_name,
      'column', expected.column_name,
      'expected_type', expected.data_type,
      'actual_type', column_def.data_type
    ) order by expected.table_name, expected.column_name)
      filter (where column_def.column_name is null
        or column_def.data_type <> expected.data_type), '[]'::jsonb) mismatches
  from required_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
), required_constraints(table_name, constraint_name) as (
  values
    ('subscription_plan_usage_limits',
      'subscription_plan_usage_limits_resource_key_check'),
    ('subscription_plan_usage_limits',
      'subscription_plan_usage_limits_limit_type_check'),
    ('subscription_plan_feature_entitlements',
      'subscription_plan_feature_entitlements_feature_key_check'),
    ('tenant_subscription_overrides',
      'tenant_subscription_overrides_resource_key_check'),
    ('tenant_subscription_overrides',
      'tenant_subscription_overrides_feature_key_check')
), constraint_state as (
  select
    count(*) expected_count,
    count(constraint_row.oid) installed_count,
    coalesce(jsonb_agg(expected.constraint_name order by expected.constraint_name)
      filter (where constraint_row.oid is null), '[]'::jsonb) missing
  from required_constraints expected
  left join pg_class relation
    on relation.oid = to_regclass('public.' || expected.table_name)
  left join pg_constraint constraint_row
    on constraint_row.conrelid = relation.oid
   and constraint_row.conname = expected.constraint_name
), canonical_constraint_literals as (
  select
    constraint_row.conname,
    array_agg(literal_match[1] order by literal_match[1] collate "C") literals
  from pg_constraint constraint_row
  cross join lateral regexp_matches(
    pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
    '''([^'']+)''',
    'g'
  ) literal_match
  where constraint_row.conname in (
    'subscription_plan_usage_limits_resource_key_check',
    'subscription_plan_usage_limits_limit_type_check',
    'subscription_plan_feature_entitlements_feature_key_check',
    'tenant_subscription_overrides_resource_key_check',
    'tenant_subscription_overrides_feature_key_check'
  )
  group by constraint_row.conname
), canonical_entitlement_contract as (
  select
    (select literals from canonical_constraint_literals where conname =
      'subscription_plan_usage_limits_resource_key_check') = array[
        'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
        'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
        'students','team_members'
      ]::text[] plan_resource_keys_exact,
    (select literals from canonical_constraint_literals where conname =
      'tenant_subscription_overrides_resource_key_check') = array[
        'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
        'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
        'students','team_members'
      ]::text[] override_resource_keys_exact,
    (select literals from canonical_constraint_literals where conname =
      'subscription_plan_usage_limits_limit_type_check') = array[
        'boolean','count','monthly_count','storage_mb'
      ]::text[] limit_types_exact,
    (select literals from canonical_constraint_literals where conname =
      'subscription_plan_feature_entitlements_feature_key_check') = array[
        'ai_assistant','api_integrations','approvals','assignments','attendance',
        'audit_compliance','automations','backup_recovery','certificates',
        'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
        'documents','finance','live_classes','marketing','messages','mobile_pwa',
        'notifications','payment_gateway','reports','students','team_operations',
        'website_builder','workflows'
      ]::text[] plan_feature_keys_exact,
    (select literals from canonical_constraint_literals where conname =
      'tenant_subscription_overrides_feature_key_check') = array[
        'ai_assistant','api_integrations','approvals','assignments','attendance',
        'audit_compliance','automations','backup_recovery','certificates',
        'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
        'documents','finance','live_classes','marketing','messages','mobile_pwa',
        'notifications','payment_gateway','reports','students','team_operations',
        'website_builder','workflows'
      ]::text[] override_feature_keys_exact,
    public.subscription_entitlements_resource_keys() = array[
      'students','courses','cohorts','batches','admins','staff_trainers',
      'team_members','storage_mb','document_uploads','messages_monthly',
      'automation_runs_monthly','ai_requests_monthly'
    ]::text[] resource_helper_exact,
    public.subscription_entitlements_feature_keys() = array[
      'dashboard','students','courses','attendance','assignments','finance',
      'reports','documents','document_uploads','messages','crm','marketing',
      'automations','workflows','approvals','team_operations','audit_compliance',
      'backup_recovery','website_builder','certificates','payment_gateway',
      'live_classes','notifications','mobile_pwa','ai_assistant',
      'custom_branding','api_integrations','community_hub'
    ]::text[] feature_helper_exact
), entitlement_helper_security as (
  select
    count(*) = 2 function_count,
    bool_and(pg_get_userbyid(procedure.proowner) = 'postgres') postgres_owned,
    bool_and(not procedure.prosecdef) security_invoker,
    bool_and(procedure.provolatile = 'i') immutable,
    bool_and(coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=public'])
      fixed_search_path,
    bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE')) anon_denied,
    bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      authenticated_denied,
    bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      service_denied,
    bool_and(not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) public_denied
  from (values
    ('public.subscription_entitlements_resource_keys()'),
    ('public.subscription_entitlements_feature_keys()')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
), required_functions(identity) as (
  values
    ('public.set_updated_at()'),
    ('public.m69_2_assert_manage_courses(uuid)'),
    ('public.m69_2_assert_section_in_course(uuid,uuid,uuid)'),
    ('public.m69_2_assert_lesson_in_section(uuid,uuid,uuid,uuid)'),
    ('public.m69_2_normalize_text(text,text,boolean,integer)'),
    ('public.m69_2_validate_lesson_type(text)'),
    ('public.m69_2_write_audit(uuid,text,text,uuid,text,text,text,jsonb)'),
    ('public.create_lesson_secure(uuid,uuid,uuid,text,text,text,text,text,integer,boolean)'),
    ('public.update_lesson_secure(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)'),
    ('public.subscription_entitlements_resource_keys()'),
    ('public.subscription_entitlements_feature_keys()'),
    ('public.subscription_entitlements_normalize_resource_key(text)'),
    ('public.subscription_entitlements_normalize_feature_key(text)'),
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'),
    ('coachfort_internal.tenant_operational_access_allowed(uuid)'),
    ('coachfort_internal.assert_tenant_operational_access(uuid)'),
    ('coachfort_internal.resolve_effective_feature_access_authority(uuid,text)'),
    ('coachfort_internal.assert_effective_operational_feature(uuid,text)')
), function_state as (
  select
    count(*) expected_count,
    count(to_regprocedure(identity)) installed_count,
    coalesce(jsonb_agg(identity order by identity)
      filter (where to_regprocedure(identity) is null), '[]'::jsonb) missing
  from required_functions
), lesson_rpc_state as (
  select
    count(*) filter (where procedure.proname = 'create_lesson_secure') create_count,
    count(*) filter (where procedure.proname = 'update_lesson_secure') update_count,
    bool_and(pg_get_userbyid(procedure.proowner) = 'postgres') postgres_owned,
    bool_and(procedure.prosecdef) security_definer,
    bool_and(coalesce(procedure.proconfig, '{}'::text[]) = array['search_path=public']) fixed_search_path,
    bool_and(has_function_privilege('authenticated', procedure.oid, 'EXECUTE')) authenticated_execute,
    bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE')) anon_denied,
    bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      service_denied,
    bool_and(not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) public_denied,
    jsonb_object_agg(
      procedure.oid::regprocedure::text,
      jsonb_build_object(
        'definition_md5', md5(pg_get_functiondef(procedure.oid)),
        'owner', pg_get_userbyid(procedure.proowner),
        'acl', coalesce(procedure.proacl::text, ''),
        'security_definer', procedure.prosecdef,
        'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
      ) order by procedure.oid::regprocedure::text
    ) fingerprints
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.oid in (
      to_regprocedure('public.create_lesson_secure(uuid,uuid,uuid,text,text,text,text,text,integer,boolean)'),
      to_regprocedure('public.update_lesson_secure(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)')
    )
), plan_state as (
  select
    count(*) filter (where code in ('starter','growth','premium')) expected_plan_count,
    count(distinct code) filter (where code in ('starter','growth','premium')) distinct_plan_count,
    count(*) filter (where code in ('starter','growth','premium')
      and status in ('draft','active')) valid_plan_count,
    count(*) filter (where code in ('starter','growth','premium'))
      - count(distinct code) filter (where code in ('starter','growth','premium'))
      duplicate_code_count
  from public.subscription_plans
), current_video_contract as (
  select
    (select count(*) from public.subscription_plan_feature_entitlements
      where feature_key = 'native_video') native_video_rows,
    (select count(*) from public.subscription_plan_usage_limits
      where resource_key = 'video_storage_minutes') video_limit_rows,
    (select count(*) from public.tenant_subscription_overrides
      where resource_key = 'video_storage_minutes'
         or feature_key = 'native_video') video_override_rows
), partial_installation as (
  select
    count(*) filter (where to_regclass(identity) is not null) table_count,
    count(*) filter (where to_regprocedure(function_identity) is not null)
      function_count
  from (values
    ('public.video_assets', null::text),
    ('public.video_asset_attachments', null),
    ('public.video_provider_events', null),
    ('public.video_capacity_pack_catalog', null),
    ('public.tenant_video_capacity_pack_assignments', null),
    (null, 'coachfort_internal.native_video_capacity_authority_lock(uuid)'),
    (null, 'coachfort_internal.enforce_native_video_override_authority_lock()'),
    (null, 'coachfort_internal.enforce_video_capacity_pack_authority_lock()'),
    (null, 'coachfort_internal.enforce_video_capacity_pack_catalog_identity()'),
    (null, 'coachfort_internal.enforce_video_asset_authority()'),
    (null, 'coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    (null, 'coachfort_internal.resolve_native_video_capacity(uuid)'),
    (null, 'coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
    (null, 'coachfort_internal.validate_external_video_url(text)'),
    (null, 'coachfort_internal.enforce_lesson_external_video_authority()'),
    (null, 'public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    (null, 'public.bind_native_video_provider_identity_server(uuid,text,text)'),
    (null, 'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    (null, 'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    (null, 'public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    (null, 'public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
    (null, 'public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    (null, 'public.confirm_native_video_provider_deletion_server(uuid,text)'),
    (null, 'public.get_native_video_capacity_server(uuid,uuid)')
  ) expected(identity, function_identity)
), protected_data as (
  select
    (select count(*) from public.tenants) tenant_rows,
    (select count(*) from public.tenant_subscription_assignments) assignment_rows,
    (select count(*) from public.subscription_plan_prices) plan_price_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(price_row)::text, '|' order by price_row.id), ''))
      from public.subscription_plan_prices price_row) plan_price_fingerprint,
    (select count(*) from public.subscription_plan_feature_entitlements)
      plan_feature_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(feature_row)::text, '|' order by feature_row.id), ''))
      from public.subscription_plan_feature_entitlements feature_row)
      plan_feature_fingerprint,
    (select count(*) from public.subscription_plan_usage_limits) plan_limit_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(limit_row)::text, '|' order by limit_row.id), ''))
      from public.subscription_plan_usage_limits limit_row) plan_limit_fingerprint,
    (select count(*) from public.tenant_subscription_overrides) override_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(override_row)::text, '|' order by override_row.id), ''))
      from public.tenant_subscription_overrides override_row) override_fingerprint,
    (select count(*) from public.courses) course_rows,
    (select count(*) from public.course_sections) section_rows,
    (select count(*) from public.lessons) lesson_rows,
    (select count(*) from public.lessons where video_url is not null) video_url_rows,
    (select md5(coalesce(string_agg(
      lesson.id::text || ':' || coalesce(lesson.video_url, '<NULL>'),
      '|' order by lesson.id), '')) from public.lessons lesson) video_url_fingerprint,
    (select count(*) from public.tenant_payment_orders) payment_order_rows,
    (select count(*) from public.tenant_payment_attempts) payment_attempt_rows,
    (select count(*) from public.payment_transactions) payment_transaction_rows,
    (select count(*) from public.invoices) invoice_rows,
    (select count(*) from public.platform_billing_receipts) platform_receipt_rows,
    (select count(*) from public.platform_billing_document_fulfillments)
      platform_fulfillment_rows,
    (select count(*) from public.finance_invoices) finance_invoice_rows,
    (select count(*) from public.finance_payments) finance_payment_rows,
    (select count(*) from public.finance_receipts) finance_receipt_rows
), browser_commercial_writes as (
  select count(*) violation_count
  from information_schema.table_privileges grant_row
  where grant_row.table_schema = 'public'
    and grant_row.table_name in (
      'subscription_plan_usage_limits',
      'subscription_plan_feature_entitlements',
      'tenant_subscription_overrides'
    )
    and grant_row.grantee in ('PUBLIC','anon','authenticated')
    and grant_row.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
), gate as (
  select
      relation_state.expected_count = relation_state.installed_count
      and column_state.expected_count = column_state.installed_count
      and constraint_state.expected_count = constraint_state.installed_count
      and canonical_entitlement_contract.plan_resource_keys_exact
      and canonical_entitlement_contract.override_resource_keys_exact
      and canonical_entitlement_contract.limit_types_exact
      and canonical_entitlement_contract.plan_feature_keys_exact
      and canonical_entitlement_contract.override_feature_keys_exact
      and canonical_entitlement_contract.resource_helper_exact
      and canonical_entitlement_contract.feature_helper_exact
      and entitlement_helper_security.function_count
      and entitlement_helper_security.postgres_owned
      and entitlement_helper_security.security_invoker
      and entitlement_helper_security.immutable
      and entitlement_helper_security.fixed_search_path
      and entitlement_helper_security.anon_denied
      and entitlement_helper_security.authenticated_denied
      and entitlement_helper_security.service_denied
      and entitlement_helper_security.public_denied
      and function_state.expected_count = function_state.installed_count
      and to_regnamespace('coachfort_internal') is not null
      and lesson_rpc_state.create_count = 1
      and lesson_rpc_state.update_count = 1
      and lesson_rpc_state.postgres_owned
      and lesson_rpc_state.security_definer
      and lesson_rpc_state.fixed_search_path
      and lesson_rpc_state.authenticated_execute
      and lesson_rpc_state.anon_denied
      and lesson_rpc_state.service_denied
      and lesson_rpc_state.public_denied
      and plan_state.expected_plan_count = 3
      and plan_state.distinct_plan_count = 3
      and plan_state.valid_plan_count = 3
      and plan_state.duplicate_code_count = 0
      and current_video_contract.native_video_rows = 0
      and current_video_contract.video_limit_rows = 0
      and current_video_contract.video_override_rows = 0
      and partial_installation.table_count = 0
      and partial_installation.function_count = 0
      and browser_commercial_writes.violation_count = 0
      as ready_for_apply
  from relation_state, column_state, constraint_state, canonical_entitlement_contract,
    entitlement_helper_security, function_state, lesson_rpc_state,
    plan_state, current_video_contract, partial_installation,
    protected_data, browser_commercial_writes
)
select
  gate.ready_for_apply,
  to_jsonb(relation_state) relation_state,
  to_jsonb(column_state) column_state,
  to_jsonb(constraint_state) constraint_state,
  to_jsonb(canonical_entitlement_contract) canonical_entitlement_contract,
  to_jsonb(entitlement_helper_security) entitlement_helper_security,
  to_jsonb(function_state) function_state,
  to_jsonb(lesson_rpc_state) lesson_rpc_state,
  to_jsonb(plan_state) plan_state,
  to_jsonb(current_video_contract) current_video_contract,
  to_jsonb(partial_installation) partial_installation,
  to_jsonb(protected_data) protected_data,
  to_jsonb(browser_commercial_writes) browser_commercial_writes
from gate, relation_state, column_state, constraint_state, canonical_entitlement_contract,
  entitlement_helper_security, function_state, lesson_rpc_state,
  plan_state, current_video_contract, partial_installation,
  protected_data, browser_commercial_writes;

-- ============================================================================
-- APPLY (TRANSACTIONAL; execute only after PRE review)
-- ============================================================================
begin;

do $$
declare
  v_plan_count integer;
  v_conflict_count integer;
  v_partial_count integer;
begin
  select count(*) into v_plan_count
  from public.subscription_plans
  where code in ('starter','growth','premium')
    and status in ('draft','active');

  if v_plan_count <> 3
     or (select count(distinct code) from public.subscription_plans
          where code in ('starter','growth','premium')) <> 3 then
    raise exception 'VIDEO-2A prerequisite failed: canonical plan identity drift.'
      using errcode = '55000';
  end if;

  select
    (select count(*) from public.subscription_plan_feature_entitlements
      where feature_key = 'native_video')
    + (select count(*) from public.subscription_plan_usage_limits
      where resource_key = 'video_storage_minutes')
    + (select count(*) from public.tenant_subscription_overrides
      where feature_key = 'native_video'
         or resource_key = 'video_storage_minutes')
  into v_conflict_count;

  if v_conflict_count <> 0 then
    raise exception 'VIDEO-2A prerequisite failed: video catalog authority already exists.'
      using errcode = '55000';
  end if;

  select count(*) into v_partial_count
  from (values
    ('public.video_assets'),
    ('public.video_asset_attachments'),
    ('public.video_provider_events'),
    ('public.video_capacity_pack_catalog'),
    ('public.tenant_video_capacity_pack_assignments')
  ) expected(identity)
  where to_regclass(expected.identity) is not null;

  if v_partial_count <> 0 then
    raise exception 'VIDEO-2A prerequisite failed: partial table installation detected.'
      using errcode = '55000';
  end if;

  select count(*) into v_partial_count
  from (values
    ('coachfort_internal.native_video_capacity_authority_lock(uuid)'),
    ('coachfort_internal.enforce_native_video_override_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_catalog_identity()'),
    ('coachfort_internal.enforce_video_asset_authority()'),
    ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    ('coachfort_internal.resolve_native_video_capacity(uuid)'),
    ('coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
    ('coachfort_internal.validate_external_video_url(text)'),
    ('coachfort_internal.enforce_lesson_external_video_authority()'),
    ('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    ('public.bind_native_video_provider_identity_server(uuid,text,text)'),
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
    ('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    ('public.confirm_native_video_provider_deletion_server(uuid,text)'),
    ('public.get_native_video_capacity_server(uuid,uuid)')
  ) expected(identity)
  where to_regprocedure(expected.identity) is not null;

  if v_partial_count <> 0 then
    raise exception 'VIDEO-2A prerequisite failed: partial function installation detected.'
      using errcode = '55000';
  end if;

  if to_regprocedure('public.create_lesson_secure(uuid,uuid,uuid,text,text,text,text,text,integer,boolean)') is null
     or to_regprocedure('public.update_lesson_secure(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)') is null
     or to_regprocedure('coachfort_internal.assert_effective_operational_feature(uuid,text)') is null then
    raise exception 'VIDEO-2A prerequisite failed: required authority function drift.'
      using errcode = '55000';
  end if;

  if not (
    select count(*) = 2
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(not procedure.prosecdef)
      and bool_and(procedure.provolatile = 'i')
      and bool_and(coalesce(procedure.proconfig, '{}'::text[])
        = array['search_path=public'])
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ))
    from (values
      ('public.subscription_entitlements_resource_keys()'),
      ('public.subscription_entitlements_feature_keys()')
    ) expected(identity)
    join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  ) then
    raise exception 'VIDEO-2A prerequisite failed: entitlement helper security drift.'
      using errcode = '55000';
  end if;

  if not (
    select count(*) = 2
      and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
      and bool_and(procedure.prosecdef)
      and bool_and(coalesce(procedure.proconfig, '{}'::text[])
        = array['search_path=public'])
      and bool_and(has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ))
    from (values
      ('public.create_lesson_secure(uuid,uuid,uuid,text,text,text,text,text,integer,boolean)'),
      ('public.update_lesson_secure(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)')
    ) expected(identity)
    join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  ) then
    raise exception 'VIDEO-2A prerequisite failed: lesson RPC security drift.'
      using errcode = '55000';
  end if;

  if public.subscription_entitlements_resource_keys() is distinct from array[
       'students','courses','cohorts','batches','admins','staff_trainers',
       'team_members','storage_mb','document_uploads','messages_monthly',
       'automation_runs_monthly','ai_requests_monthly'
     ]::text[]
     or public.subscription_entitlements_feature_keys() is distinct from array[
       'dashboard','students','courses','attendance','assignments','finance',
       'reports','documents','document_uploads','messages','crm','marketing',
       'automations','workflows','approvals','team_operations','audit_compliance',
       'backup_recovery','website_builder','certificates','payment_gateway',
       'live_classes','notifications','mobile_pwa','ai_assistant',
       'custom_branding','api_integrations','community_hub'
     ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'subscription_plan_usage_limits_resource_key_check')
        is distinct from array[
          'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
          'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
          'students','team_members'
        ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'tenant_subscription_overrides_resource_key_check')
        is distinct from array[
          'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
          'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
          'students','team_members'
        ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'subscription_plan_usage_limits_limit_type_check')
        is distinct from array['boolean','count','monthly_count','storage_mb']::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'subscription_plan_feature_entitlements_feature_key_check')
        is distinct from array[
          'ai_assistant','api_integrations','approvals','assignments','attendance',
          'audit_compliance','automations','backup_recovery','certificates',
          'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
          'documents','finance','live_classes','marketing','messages','mobile_pwa',
          'notifications','payment_gateway','reports','students','team_operations',
          'website_builder','workflows'
        ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'tenant_subscription_overrides_feature_key_check')
        is distinct from array[
          'ai_assistant','api_integrations','approvals','assignments','attendance',
          'audit_compliance','automations','backup_recovery','certificates',
          'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
          'documents','finance','live_classes','marketing','messages','mobile_pwa',
          'notifications','payment_gateway','reports','students','team_operations',
          'website_builder','workflows'
        ]::text[] then
    raise exception 'VIDEO-2A prerequisite failed: canonical entitlement contract drift.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'subscription_plan_usage_limits',
        'subscription_plan_feature_entitlements',
        'tenant_subscription_overrides'
      )
      and grant_row.grantee in ('PUBLIC','anon','authenticated')
      and grant_row.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ) then
    raise exception 'VIDEO-2A prerequisite failed: commercial table browser write drift.'
      using errcode = '55000';
  end if;
end;
$$;

create temporary table video2a_apply_baseline (
  tenant_rows bigint not null,
  assignment_rows bigint not null,
  plan_price_rows bigint not null,
  plan_price_fingerprint text not null,
  plan_feature_rows bigint not null,
  plan_feature_fingerprint text not null,
  plan_limit_rows bigint not null,
  plan_limit_fingerprint text not null,
  override_rows bigint not null,
  override_fingerprint text not null,
  plan_commercial_fingerprint text not null,
  course_rows bigint not null,
  section_rows bigint not null,
  lesson_rows bigint not null,
  video_url_rows bigint not null,
  video_url_fingerprint text not null,
  payment_order_rows bigint not null,
  payment_attempt_rows bigint not null,
  payment_transaction_rows bigint not null,
  invoice_rows bigint not null,
  platform_receipt_rows bigint not null,
  platform_fulfillment_rows bigint not null,
  finance_invoice_rows bigint not null,
  finance_payment_rows bigint not null,
  finance_receipt_rows bigint not null,
  lesson_rpc_contract jsonb not null,
  entitlement_helper_security_contract jsonb not null,
  lifecycle_definition text not null,
  feature_definition text not null,
  feature_assertion_definition text not null
) on commit drop;

insert into video2a_apply_baseline
select
  (select count(*) from public.tenants),
  (select count(*) from public.tenant_subscription_assignments),
  (select count(*) from public.subscription_plan_prices),
  (select md5(coalesce(string_agg(
    to_jsonb(price_row)::text, '|' order by price_row.id), ''))
    from public.subscription_plan_prices price_row),
  (select count(*) from public.subscription_plan_feature_entitlements),
  (select md5(coalesce(string_agg(
    to_jsonb(feature_row)::text, '|' order by feature_row.id), ''))
    from public.subscription_plan_feature_entitlements feature_row),
  (select count(*) from public.subscription_plan_usage_limits),
  (select md5(coalesce(string_agg(
    to_jsonb(limit_row)::text, '|' order by limit_row.id), ''))
    from public.subscription_plan_usage_limits limit_row),
  (select count(*) from public.tenant_subscription_overrides),
  (select md5(coalesce(string_agg(
    to_jsonb(override_row)::text, '|' order by override_row.id), ''))
    from public.tenant_subscription_overrides override_row),
  (select md5(coalesce(string_agg(
    plan.id::text || ':' || plan.code || ':' || plan.status || ':'
      || plan.is_public::text || ':' || plan.trial_days::text || ':'
      || plan.metadata_json::text,
    '|' order by plan.id), '')) from public.subscription_plans plan),
  (select count(*) from public.courses),
  (select count(*) from public.course_sections),
  (select count(*) from public.lessons),
  (select count(*) from public.lessons where video_url is not null),
  (select md5(coalesce(string_agg(
    lesson.id::text || ':' || coalesce(lesson.video_url, '<NULL>'),
    '|' order by lesson.id), '')) from public.lessons lesson),
  (select count(*) from public.tenant_payment_orders),
  (select count(*) from public.tenant_payment_attempts),
  (select count(*) from public.payment_transactions),
  (select count(*) from public.invoices),
  (select count(*) from public.platform_billing_receipts),
  (select count(*) from public.platform_billing_document_fulfillments),
  (select count(*) from public.finance_invoices),
  (select count(*) from public.finance_payments),
  (select count(*) from public.finance_receipts),
  (select jsonb_object_agg(
     procedure.oid::regprocedure::text,
     jsonb_build_object(
       'definition', pg_get_functiondef(procedure.oid),
       'owner', pg_get_userbyid(procedure.proowner),
       'acl', coalesce(procedure.proacl::text, ''),
       'security_definer', procedure.prosecdef,
       'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
     ) order by procedure.oid::regprocedure::text
   ) from pg_proc procedure where procedure.oid in (
     to_regprocedure('public.create_lesson_secure(uuid,uuid,uuid,text,text,text,text,text,integer,boolean)'),
     to_regprocedure('public.update_lesson_secure(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)')
   )),
  (select jsonb_object_agg(
     procedure.oid::regprocedure::text,
     jsonb_build_object(
       'owner', pg_get_userbyid(procedure.proowner),
       'acl', coalesce(procedure.proacl::text, ''),
       'security_definer', procedure.prosecdef,
       'volatility', procedure.provolatile,
       'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
     ) order by procedure.oid::regprocedure::text
   ) from pg_proc procedure where procedure.oid in (
     to_regprocedure('public.subscription_entitlements_resource_keys()'),
     to_regprocedure('public.subscription_entitlements_feature_keys()')
   )),
  pg_get_functiondef(to_regprocedure(
    'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)')),
  pg_get_functiondef(to_regprocedure(
    'coachfort_internal.resolve_effective_feature_access_authority(uuid,text)')),
  pg_get_functiondef(to_regprocedure(
    'coachfort_internal.assert_effective_operational_feature(uuid,text)'));

alter table public.subscription_plan_usage_limits
  drop constraint subscription_plan_usage_limits_resource_key_check,
  drop constraint subscription_plan_usage_limits_limit_type_check;

alter table public.subscription_plan_usage_limits
  add constraint subscription_plan_usage_limits_resource_key_check check (
    resource_key in (
      'students','courses','cohorts','batches','admins','staff_trainers',
      'team_members','storage_mb','document_uploads','messages_monthly',
      'automation_runs_monthly','ai_requests_monthly','video_storage_minutes'
    )
  ),
  add constraint subscription_plan_usage_limits_limit_type_check check (
    limit_type in ('count','storage_mb','monthly_count','boolean','duration_minutes')
  );

alter table public.subscription_plan_feature_entitlements
  drop constraint subscription_plan_feature_entitlements_feature_key_check;

alter table public.subscription_plan_feature_entitlements
  add constraint subscription_plan_feature_entitlements_feature_key_check check (
    feature_key in (
      'dashboard','students','courses','attendance','assignments','finance',
      'reports','documents','document_uploads','messages','crm','marketing',
      'automations','workflows','approvals','team_operations','audit_compliance',
      'backup_recovery','website_builder','certificates','payment_gateway',
      'live_classes','notifications','mobile_pwa','ai_assistant',
      'custom_branding','api_integrations','community_hub','native_video'
    )
  );

alter table public.tenant_subscription_overrides
  drop constraint tenant_subscription_overrides_resource_key_check,
  drop constraint tenant_subscription_overrides_feature_key_check;

alter table public.tenant_subscription_overrides
  add constraint tenant_subscription_overrides_resource_key_check check (
    resource_key is null or resource_key in (
      'students','courses','cohorts','batches','admins','staff_trainers',
      'team_members','storage_mb','document_uploads','messages_monthly',
      'automation_runs_monthly','ai_requests_monthly','video_storage_minutes'
    )
  ),
  add constraint tenant_subscription_overrides_feature_key_check check (
    feature_key is null or feature_key in (
      'dashboard','students','courses','attendance','assignments','finance',
      'reports','documents','document_uploads','messages','crm','marketing',
      'automations','workflows','approvals','team_operations','audit_compliance',
      'backup_recovery','website_builder','certificates','payment_gateway',
      'live_classes','notifications','mobile_pwa','ai_assistant',
      'custom_branding','api_integrations','community_hub','native_video'
    )
  );

create or replace function public.subscription_entitlements_resource_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'students','courses','cohorts','batches','admins','staff_trainers',
    'team_members','storage_mb','document_uploads','messages_monthly',
    'automation_runs_monthly','ai_requests_monthly','video_storage_minutes'
  ]::text[];
$$;

create or replace function public.subscription_entitlements_feature_keys()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'dashboard','students','courses','attendance','assignments','finance',
    'reports','documents','document_uploads','messages','crm','marketing',
    'automations','workflows','approvals','team_operations','audit_compliance',
    'backup_recovery','website_builder','certificates','payment_gateway',
    'live_classes','notifications','mobile_pwa','ai_assistant',
    'custom_branding','api_integrations','community_hub','native_video'
  ]::text[];
$$;

insert into public.subscription_plan_feature_entitlements (
  plan_id, feature_key, entitlement_status, requires_platform_approval,
  included_quota, metadata_json
)
select
  plan.id, 'native_video', 'included', false, null,
  jsonb_build_object('installed_by', 'VIDEO-2A')
from public.subscription_plans plan
where plan.code in ('starter','growth','premium');

insert into public.subscription_plan_usage_limits (
  plan_id, resource_key, limit_value, limit_type, enforcement_mode,
  warning_threshold_percent, allow_platform_override, metadata_json
)
select
  plan.id,
  'video_storage_minutes',
  case plan.code when 'starter' then 600 when 'growth' then 3000 else 9000 end,
  'duration_minutes',
  'hard',
  70,
  true,
  jsonb_build_object(
    'installed_by', 'VIDEO-2A',
    'reset_period', 'none',
    'customer_unit', 'video_hours'
  )
from public.subscription_plans plan
where plan.code in ('starter','growth','premium');

create table public.video_capacity_pack_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  capacity_minutes integer not null,
  status text not null default 'inactive',
  is_public boolean not null default false,
  is_purchasable boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_capacity_pack_catalog_code_check check (
    code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
  ),
  constraint video_capacity_pack_catalog_capacity_check check (
    capacity_minutes > 0 and capacity_minutes <= 1000000
  ),
  constraint video_capacity_pack_catalog_status_check check (
    status in ('inactive','active','archived')
  ),
  constraint video_capacity_pack_catalog_public_purchase_check check (
    not is_purchasable or (is_public and status = 'active')
  ),
  constraint video_capacity_pack_catalog_metadata_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table public.tenant_video_capacity_pack_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pack_id uuid not null references public.video_capacity_pack_catalog(id)
    on delete restrict,
  quantity integer not null,
  status text not null default 'active',
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  billing_cycle text not null,
  source text not null,
  source_reference text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_video_capacity_pack_quantity_check check (
    quantity between 1 and 1000
  ),
  constraint tenant_video_capacity_pack_status_check check (
    status in ('active','cancelled','expired')
  ),
  constraint tenant_video_capacity_pack_period_check check (
    valid_until is null or valid_until > valid_from
  ),
  constraint tenant_video_capacity_pack_billing_cycle_check check (
    billing_cycle in ('monthly','yearly','custom')
  ),
  constraint tenant_video_capacity_pack_source_check check (
    source in ('platform_manual','billing','migration')
  ),
  constraint tenant_video_capacity_pack_source_reference_check check (
    source_reference is null or (
      char_length(source_reference) between 1 and 255
      and source_reference !~ '[[:cntrl:]]'
    )
  ),
  constraint tenant_video_capacity_pack_evidence_check check (
    jsonb_typeof(evidence_json) = 'object'
    and char_length(evidence_json::text) <= 3000
  )
);

create unique index tenant_video_capacity_pack_source_unique_idx
on public.tenant_video_capacity_pack_assignments (tenant_id, source, source_reference)
where source_reference is not null;

create index tenant_video_capacity_pack_active_idx
on public.tenant_video_capacity_pack_assignments (tenant_id, valid_from, valid_until)
where status = 'active';

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'cloudflare_stream',
  provider_asset_id text,
  provider_upload_id text,
  status text not null default 'upload_pending',
  duration_seconds bigint,
  reserved_seconds bigint not null,
  reservation_expires_at timestamptz,
  original_filename text not null,
  declared_mime_type text not null,
  declared_size_bytes bigint not null,
  request_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  ready_at timestamptz,
  failed_at timestamptz,
  delete_requested_at timestamptz,
  provider_deleted_at timestamptz,
  last_provider_observed_at timestamptz,
  safe_failure_code text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_assets_tenant_id_id_key unique (tenant_id, id),
  constraint video_assets_request_key unique (tenant_id, request_id),
  constraint video_assets_provider_check check (
    provider in ('cloudflare_stream','mux')
  ),
  constraint video_assets_status_check check (
    status in (
      'upload_pending','processing','ready','failed','delete_pending','deleted'
    )
  ),
  constraint video_assets_duration_check check (
    duration_seconds is null or duration_seconds between 1 and 7200
  ),
  constraint video_assets_reservation_check check (
    reserved_seconds between 0 and 7200
  ),
  constraint video_assets_pending_reservation_check check (
    status not in ('upload_pending','processing')
    or reserved_seconds > 0
  ),
  constraint video_assets_provider_state_check check (
    (status <> 'processing' or provider_asset_id is not null)
    and (status <> 'failed' or provider_asset_id is null)
  ),
  constraint video_assets_ready_identity_check check (
    status <> 'ready'
    or (provider_asset_id is not null and duration_seconds is not null)
  ),
  constraint video_assets_delete_pending_identity_check check (
    status <> 'delete_pending' or (
      provider_asset_id is not null
      and delete_requested_at is not null
      and (duration_seconds is not null or reserved_seconds > 0)
    )
  ),
  constraint video_assets_deleted_state_check check (
    status <> 'deleted'
    or (provider_deleted_at is not null and reserved_seconds = 0)
  ),
  constraint video_assets_filename_check check (
    char_length(original_filename) between 1 and 255
    and original_filename !~ '[\\/[:cntrl:]]'
  ),
  constraint video_assets_mime_check check (
    declared_mime_type in (
      'video/mp4','video/quicktime','video/webm','video/x-matroska',
      'video/x-msvideo','video/mpeg'
    )
  ),
  constraint video_assets_size_check check (
    declared_size_bytes between 1 and 10737418240
  ),
  constraint video_assets_provider_asset_id_check check (
    provider_asset_id is null or (
      char_length(provider_asset_id) between 1 and 255
      and provider_asset_id !~ '[[:space:][:cntrl:]]'
    )
  ),
  constraint video_assets_provider_upload_id_check check (
    provider_upload_id is null or (
      char_length(provider_upload_id) between 1 and 255
      and provider_upload_id !~ '[[:space:][:cntrl:]]'
    )
  ),
  constraint video_assets_failure_code_check check (
    safe_failure_code is null or safe_failure_code ~ '^[a-z0-9_]{1,80}$'
  ),
  constraint video_assets_metadata_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create unique index video_assets_provider_identity_unique_idx
on public.video_assets (provider, provider_asset_id)
where provider_asset_id is not null;

create index video_assets_capacity_idx
on public.video_assets (tenant_id, status, reservation_expires_at);

create table public.video_asset_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  video_asset_id uuid not null,
  lesson_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint video_asset_attachments_lesson_key unique (lesson_id),
  constraint video_asset_attachments_asset_fk foreign key (tenant_id, video_asset_id)
    references public.video_assets(tenant_id, id) on delete restrict
);

create unique index lessons_tenant_id_id_video2a_idx
on public.lessons (tenant_id, id);

alter table public.video_asset_attachments
  add constraint video_asset_attachments_lesson_fk
  foreign key (tenant_id, lesson_id)
  references public.lessons(tenant_id, id) on delete cascade;

create index video_asset_attachments_asset_idx
on public.video_asset_attachments (tenant_id, video_asset_id);

create table public.video_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  tenant_id uuid,
  video_asset_id uuid,
  provider_asset_id text,
  event_type text not null,
  event_time timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received',
  safe_payload_hash text,
  safe_evidence_json jsonb not null default '{}'::jsonb,
  constraint video_provider_events_identity_key unique (provider, event_key),
  constraint video_provider_events_provider_check check (
    provider in ('cloudflare_stream','mux')
  ),
  constraint video_provider_events_event_key_check check (
    char_length(event_key) between 1 and 255
    and event_key !~ '[[:cntrl:]]'
  ),
  constraint video_provider_events_provider_asset_id_check check (
    provider_asset_id is null or (
      char_length(provider_asset_id) between 1 and 255
      and provider_asset_id !~ '[[:space:][:cntrl:]]'
    )
  ),
  constraint video_provider_events_match_pair_check check (
    (tenant_id is null and video_asset_id is null)
    or (tenant_id is not null and video_asset_id is not null)
  ),
  constraint video_provider_events_asset_fk
    foreign key (tenant_id, video_asset_id)
    references public.video_assets(tenant_id, id) on delete set null,
  constraint video_provider_events_type_check check (
    event_type ~ '^[a-z0-9_.-]{1,100}$'
  ),
  constraint video_provider_events_status_check check (
    processing_status in ('received','processed','duplicate','ignored','failed')
  ),
  constraint video_provider_events_hash_check check (
    safe_payload_hash is null or safe_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint video_provider_events_evidence_check check (
    jsonb_typeof(safe_evidence_json) = 'object'
    and char_length(safe_evidence_json::text) <= 3000
  )
);

create index video_provider_events_asset_idx
on public.video_provider_events (video_asset_id, received_at desc);

alter table public.video_capacity_pack_catalog enable row level security;
alter table public.tenant_video_capacity_pack_assignments enable row level security;
alter table public.video_assets enable row level security;
alter table public.video_asset_attachments enable row level security;
alter table public.video_provider_events enable row level security;

alter table public.video_capacity_pack_catalog owner to postgres;
alter table public.tenant_video_capacity_pack_assignments owner to postgres;
alter table public.video_assets owner to postgres;
alter table public.video_asset_attachments owner to postgres;
alter table public.video_provider_events owner to postgres;

revoke all privileges on table
  public.video_capacity_pack_catalog,
  public.tenant_video_capacity_pack_assignments,
  public.video_assets,
  public.video_asset_attachments,
  public.video_provider_events
from public, anon, authenticated, service_role;

create function coachfort_internal.enforce_video_capacity_pack_catalog_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.code = 'video_capacity_25h' then
      raise exception 'Canonical video capacity pack cannot be deleted.'
        using errcode = '55000';
    end if;
    return old;
  end if;

  if (new.code, new.capacity_minutes)
     is distinct from (old.code, old.capacity_minutes) then
    raise exception 'Video capacity pack identity and capacity are immutable.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger enforce_video_capacity_pack_catalog_identity
before update or delete on public.video_capacity_pack_catalog
for each row execute function
  coachfort_internal.enforce_video_capacity_pack_catalog_identity();

create trigger set_video_capacity_pack_catalog_updated_at
before update on public.video_capacity_pack_catalog
for each row execute function public.set_updated_at();

create trigger set_tenant_video_capacity_pack_assignments_updated_at
before update on public.tenant_video_capacity_pack_assignments
for each row execute function public.set_updated_at();

create trigger set_video_assets_updated_at
before update on public.video_assets
for each row execute function public.set_updated_at();

insert into public.video_capacity_pack_catalog (
  code, name, capacity_minutes, status, is_public, is_purchasable, metadata_json
) values (
  'video_capacity_25h', 'Video Capacity Pack', 1500,
  'inactive', false, false,
  '{"installed_by":"VIDEO-2A","price_assigned":false}'::jsonb
);

create function coachfort_internal.native_video_capacity_authority_lock(
  p_tenant_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'native_video_capacity:' || p_tenant_id::text,
    8422
  ));
end;
$$;

create function coachfort_internal.enforce_native_video_override_authority_lock()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_tenant uuid;
  v_new_tenant uuid;
begin
  if tg_op <> 'INSERT'
     and old.override_type in ('limit_raise','limit_lower')
     and old.resource_key = 'video_storage_minutes' then
    v_old_tenant := old.tenant_id;
  end if;

  if tg_op <> 'DELETE'
     and new.override_type in ('limit_raise','limit_lower')
     and new.resource_key = 'video_storage_minutes' then
    v_new_tenant := new.tenant_id;
  end if;

  if v_old_tenant is not null and v_new_tenant is not null
     and v_old_tenant is distinct from v_new_tenant then
    if v_old_tenant::text < v_new_tenant::text then
      perform coachfort_internal.native_video_capacity_authority_lock(v_old_tenant);
      perform coachfort_internal.native_video_capacity_authority_lock(v_new_tenant);
    else
      perform coachfort_internal.native_video_capacity_authority_lock(v_new_tenant);
      perform coachfort_internal.native_video_capacity_authority_lock(v_old_tenant);
    end if;
  elsif v_new_tenant is not null then
    perform coachfort_internal.native_video_capacity_authority_lock(v_new_tenant);
  elsif v_old_tenant is not null then
    perform coachfort_internal.native_video_capacity_authority_lock(v_old_tenant);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger native_video_capacity_override_authority_lock
before insert or update or delete on public.tenant_subscription_overrides
for each row execute function
  coachfort_internal.enforce_native_video_override_authority_lock();

create function coachfort_internal.enforce_video_capacity_pack_authority_lock()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_tenant uuid;
  v_new_tenant uuid;
begin
  if tg_op <> 'INSERT' then v_old_tenant := old.tenant_id; end if;
  if tg_op <> 'DELETE' then v_new_tenant := new.tenant_id; end if;

  if v_old_tenant is not null and v_new_tenant is not null
     and v_old_tenant is distinct from v_new_tenant then
    if v_old_tenant::text < v_new_tenant::text then
      perform coachfort_internal.native_video_capacity_authority_lock(v_old_tenant);
      perform coachfort_internal.native_video_capacity_authority_lock(v_new_tenant);
    else
      perform coachfort_internal.native_video_capacity_authority_lock(v_new_tenant);
      perform coachfort_internal.native_video_capacity_authority_lock(v_old_tenant);
    end if;
  elsif v_new_tenant is not null then
    perform coachfort_internal.native_video_capacity_authority_lock(v_new_tenant);
  elsif v_old_tenant is not null then
    perform coachfort_internal.native_video_capacity_authority_lock(v_old_tenant);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger native_video_capacity_pack_authority_lock
before insert or update or delete
on public.tenant_video_capacity_pack_assignments
for each row execute function
  coachfort_internal.enforce_video_capacity_pack_authority_lock();

create function coachfort_internal.enforce_video_asset_authority()
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
    (old.status = 'upload_pending' and new.status in ('processing','failed'))
    or (old.status = 'processing' and new.status in ('ready','delete_pending'))
    or (old.status = 'ready' and new.status = 'delete_pending')
    or (old.status = 'delete_pending' and new.status = 'deleted')
  ) then
    raise exception 'Invalid native video status transition.' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger enforce_video_asset_authority
before update on public.video_assets
for each row execute function coachfort_internal.enforce_video_asset_authority();

create function coachfort_internal.assert_native_video_owner_admin(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null or p_actor_user_id is null or not exists (
    select 1
    from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.role in ('owner','admin')
  ) then
    raise exception 'Native video access denied.' using errcode = '42501';
  end if;
end;
$$;

create function coachfort_internal.resolve_native_video_capacity(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_base integer;
  v_limit_type text;
  v_enforcement text;
  v_add_on bigint := 0;
  v_override_text text;
  v_override bigint;
begin
  select assignment.plan_id into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id and assignment.is_current
  order by assignment.created_at desc
  limit 1
  for share;

  if v_plan_id is null then
    raise exception 'Native video capacity authority is unavailable.'
      using errcode = '42501';
  end if;

  select plan_limit.limit_value, plan_limit.limit_type,
    plan_limit.enforcement_mode
  into v_base, v_limit_type, v_enforcement
  from public.subscription_plan_usage_limits plan_limit
  where plan_limit.plan_id = v_plan_id
    and plan_limit.resource_key = 'video_storage_minutes'
  for share;

  if not found or v_base is null or v_base < 0
     or v_limit_type <> 'duration_minutes' or v_enforcement <> 'hard' then
    raise exception 'Native video capacity authority is unavailable.'
      using errcode = '42501';
  end if;

  select coalesce(sum(pack.capacity_minutes::bigint * assignment.quantity), 0)
  into v_add_on
  from public.tenant_video_capacity_pack_assignments assignment
  join public.video_capacity_pack_catalog pack on pack.id = assignment.pack_id
  where assignment.tenant_id = p_tenant_id
    and assignment.status = 'active'
    and assignment.valid_from <= now()
    and (assignment.valid_until is null or assignment.valid_until > now());

  select override_row.override_value_json ->> 'limit_value'
  into v_override_text
  from public.tenant_subscription_overrides override_row
  where override_row.tenant_id = p_tenant_id
    and override_row.resource_key = 'video_storage_minutes'
    and override_row.override_type in ('limit_raise','limit_lower')
    and (override_row.expires_at is null or override_row.expires_at > now())
  order by override_row.created_at desc, override_row.id desc
  limit 1;

  if found then
    if coalesce(v_override_text, '') !~ '^[0-9]{1,10}$'
       or v_override_text::numeric > 2147483647 then
      raise exception 'Native video capacity override is invalid.'
        using errcode = '42501';
    end if;
    v_override := v_override_text::bigint;
  end if;

  return jsonb_build_object(
    'base_capacity_minutes', v_base,
    'add_on_capacity_minutes', v_add_on,
    'override_capacity_minutes', v_override,
    'effective_capacity_minutes', coalesce(v_override, v_base::bigint + v_add_on)
  );
end;
$$;

create function coachfort_internal.resolve_native_video_usage(
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
      where (asset.status = 'upload_pending'
          and asset.reservation_expires_at > now())
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

create function coachfort_internal.validate_external_video_url(p_value text)
returns text
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text := nullif(btrim(coalesce(p_value, '')), '');
  v_authority text;
  v_host text;
begin
  if v_url is null then return null; end if;
  if char_length(v_url) > 1000 or v_url ~ '[[:space:][:cntrl:]]'
     or lower(v_url) !~ '^https://' then
    raise exception 'Video URL must be a valid HTTPS YouTube or Vimeo URL.'
      using errcode = '22023';
  end if;

  v_authority := regexp_replace(substring(v_url from 9), '[/?#].*$', '');
  if v_authority = '' or position('@' in v_authority) > 0 then
    raise exception 'Video URL must be a valid HTTPS YouTube or Vimeo URL.'
      using errcode = '22023';
  end if;
  v_host := lower(v_authority);

  if v_host not in (
    'youtube.com','www.youtube.com','youtu.be',
    'vimeo.com','www.vimeo.com','player.vimeo.com'
  ) then
    raise exception 'Video URL must use YouTube or Vimeo.' using errcode = '22023';
  end if;

  return v_url;
end;
$$;

create function coachfort_internal.enforce_lesson_external_video_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.video_url is not distinct from old.video_url then
    return new;
  end if;

  new.video_url := coachfort_internal.validate_external_video_url(new.video_url);

  if new.video_url is not null and exists (
    select 1
    from public.video_asset_attachments attachment
    where attachment.tenant_id = new.tenant_id
      and attachment.lesson_id = new.id
  ) then
    raise exception 'Detach the native video before adding an external video.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger enforce_lesson_external_video_authority
before insert or update of video_url on public.lessons
for each row execute function
  coachfort_internal.enforce_lesson_external_video_authority();

create function public.reserve_native_video_upload_server(
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_mime text := lower(btrim(coalesce(p_declared_mime_type, '')));
  v_filename text := btrim(coalesce(p_safe_filename, ''));
  v_existing public.video_assets%rowtype;
  v_capacity jsonb;
  v_usage jsonb;
  v_effective_seconds bigint;
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

  insert into public.video_assets (
    tenant_id, provider, status, reserved_seconds, reservation_expires_at,
    original_filename, declared_mime_type, declared_size_bytes,
    request_id, created_by
  ) values (
    p_tenant_id, 'cloudflare_stream', 'upload_pending',
    p_expected_duration_seconds, now() + interval '90 minutes',
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
$$;

create function public.bind_native_video_provider_identity_server(
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

  if v_asset.status = 'processing'
     and v_asset.provider_asset_id = v_provider_asset_id
     and v_asset.provider_upload_id is not distinct from v_provider_upload_id then
    return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status);
  end if;
  if v_asset.status <> 'upload_pending'
     or v_asset.reservation_expires_at <= now() then
    raise exception 'Native video is not awaiting provider identity.' using errcode = '55000';
  end if;

  update public.video_assets
  set provider_asset_id = v_provider_asset_id,
      provider_upload_id = v_provider_upload_id,
      status = 'processing'
  where id = v_asset.id
  returning * into v_asset;

  return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status);
end;
$$;

create function public.record_native_video_provider_event_server(
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
     or jsonb_typeof(coalesce(p_safe_evidence_json, '{}'::jsonb)) <> 'object'
     or char_length(coalesce(p_safe_evidence_json, '{}'::jsonb)::text) > 3000 then
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
    p_safe_payload_hash, coalesce(p_safe_evidence_json, '{}'::jsonb)
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
        p_safe_payload_hash, coalesce(p_safe_evidence_json, '{}'::jsonb)) then
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

create function public.finalize_native_video_asset_processing_server(
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
  if not found then
    raise exception 'Native video asset not found.' using errcode = '02000';
  end if;

  if v_asset.provider not in ('cloudflare_stream','mux')
     or v_outcome not in ('ready','failed')
     or char_length(v_event_key) not between 1 and 255
     or v_event_key ~ '[[:cntrl:]]'
     or char_length(v_provider_asset_id) not between 1 and 255
     or v_provider_asset_id ~ '[[:space:][:cntrl:]]'
     or p_event_time is null
     or p_event_time > now() + interval '10 minutes'
     or (p_safe_payload_hash is not null
       and p_safe_payload_hash !~ '^[0-9a-f]{64}$')
     or jsonb_typeof(v_evidence) <> 'object'
     or char_length(v_evidence::text) > 3000
     or (v_outcome = 'failed' and p_provider_duration_seconds is not null) then
    raise exception 'Native video finalization input is invalid.'
      using errcode = '22023';
  end if;

  v_duration_valid := p_provider_duration_seconds between 1 and 7200;

  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;

  if v_asset.provider_asset_id is distinct from v_provider_asset_id then
    raise exception 'Native video provider identity does not match the asset.'
      using errcode = '22023';
  end if;

  insert into public.video_provider_events (
    provider, event_key, tenant_id, video_asset_id, provider_asset_id,
    event_type, event_time, processing_status, safe_payload_hash,
    safe_evidence_json
  ) values (
    v_asset.provider, v_event_key, v_asset.tenant_id, v_asset.id,
    v_provider_asset_id, 'asset.' || v_outcome, p_event_time,
    'received', p_safe_payload_hash, v_evidence
  )
  on conflict (provider, event_key) do nothing
  returning * into v_event;

  if not found then
    select * into v_event from public.video_provider_events event_row
    where event_row.provider = v_asset.provider
      and event_row.event_key = v_event_key;
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

  -- VIDEO-2B must pass a trusted current provider observation obtained after
  -- webhook verification and provider-state retrieval. Older observations are
  -- retained as evidence but cannot regress a newer accepted observation.
  if v_asset.last_provider_observed_at is not null
     and p_event_time < v_asset.last_provider_observed_at then
    update public.video_provider_events set
      processing_status = 'ignored', processed_at = now()
    where id = v_event.id;
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status,
      'failure_code', v_asset.safe_failure_code, 'replayed', false,
      'stale_observation', true
    );
  end if;

  if v_asset.status <> 'processing' then
    update public.video_provider_events set
      processing_status = 'ignored', processed_at = now()
    where id = v_event.id;
    return jsonb_build_object(
      'asset_id', v_asset.id, 'status', v_asset.status,
      'failure_code', v_asset.safe_failure_code, 'replayed', false
    );
  end if;

  if v_outcome = 'failed' then
    update public.video_assets set
      status = 'delete_pending',
      reservation_expires_at = null, failed_at = now(),
      delete_requested_at = now(),
      safe_failure_code = 'provider_processing_failed',
      last_provider_observed_at = p_event_time
    where id = v_asset.id returning * into v_asset;
  elsif v_outcome = 'ready' then
    if not coalesce(v_duration_valid, false) then
      v_failure := 'provider_duration_invalid';
    elsif p_provider_duration_seconds > v_asset.reserved_seconds then
      v_failure := 'provider_duration_exceeds_reservation';
    else
      v_capacity := coachfort_internal.resolve_native_video_capacity(v_asset.tenant_id);
      v_usage := coachfort_internal.resolve_native_video_usage(
        v_asset.tenant_id, v_asset.id
      );
      if (v_usage->>'stored_seconds')::bigint
           + (v_usage->>'reserved_seconds')::bigint
           + p_provider_duration_seconds
         > (v_capacity->>'effective_capacity_minutes')::bigint * 60 then
        v_failure := 'provider_duration_exceeds_capacity';
      end if;
    end if;

    if v_failure is not null then
      update public.video_assets set
        status = 'delete_pending',
        duration_seconds = case
          when v_duration_valid
          then p_provider_duration_seconds else null end,
        reserved_seconds = case
          when v_duration_valid then 0 else reserved_seconds end,
        reservation_expires_at = null,
        failed_at = now(), delete_requested_at = now(),
        safe_failure_code = v_failure,
        last_provider_observed_at = p_event_time
      where id = v_asset.id returning * into v_asset;
    else
      update public.video_assets set
        status = 'ready', duration_seconds = p_provider_duration_seconds,
        reserved_seconds = 0, reservation_expires_at = null,
        ready_at = now(), safe_failure_code = null,
        last_provider_observed_at = p_event_time
      where id = v_asset.id returning * into v_asset;
    end if;
  end if;

  update public.video_provider_events set
    processing_status = 'processed', processed_at = now()
  where id = v_event.id;

  return jsonb_build_object(
    'asset_id', v_asset.id, 'status', v_asset.status,
    'failure_code', v_asset.safe_failure_code, 'replayed', false
  );
end;
$$;

create function public.attach_native_video_to_lesson_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lesson_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lesson public.lessons%rowtype;
  v_asset public.video_assets%rowtype;
  v_attachment public.video_asset_attachments%rowtype;
begin
  perform coachfort_internal.assert_native_video_owner_admin(
    p_tenant_id, p_actor_user_id
  );
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);
  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'native_video'
  );

  select * into v_lesson from public.lessons
  where id = p_lesson_id and tenant_id = p_tenant_id for update;
  select * into v_asset from public.video_assets
  where id = p_asset_id and tenant_id = p_tenant_id for share;

  if v_lesson.id is null or v_asset.id is null or v_asset.status <> 'ready' then
    raise exception 'Native video attachment target is unavailable.'
      using errcode = '22023';
  end if;
  if v_lesson.video_url is not null then
    raise exception 'Remove the external video before attaching native video.'
      using errcode = '22023';
  end if;

  insert into public.video_asset_attachments (
    tenant_id, video_asset_id, lesson_id, created_by
  ) values (p_tenant_id, p_asset_id, p_lesson_id, p_actor_user_id)
  on conflict (lesson_id) do update set
    video_asset_id = excluded.video_asset_id,
    tenant_id = excluded.tenant_id,
    created_by = excluded.created_by,
    created_at = now()
  returning * into v_attachment;

  return jsonb_build_object(
    'attachment_id', v_attachment.id,
    'lesson_id', v_attachment.lesson_id,
    'video_asset_id', v_attachment.video_asset_id
  );
end;
$$;

create function public.detach_native_video_from_lesson_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lesson_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  perform coachfort_internal.assert_native_video_owner_admin(
    p_tenant_id, p_actor_user_id
  );
  delete from public.video_asset_attachments attachment
  where attachment.tenant_id = p_tenant_id
    and attachment.lesson_id = p_lesson_id;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('detached', v_deleted = 1);
end;
$$;

create function public.request_native_video_deletion_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
begin
  perform coachfort_internal.assert_native_video_owner_admin(
    p_tenant_id, p_actor_user_id
  );
  perform coachfort_internal.native_video_capacity_authority_lock(p_tenant_id);
  select * into v_asset from public.video_assets
  where id = p_asset_id and tenant_id = p_tenant_id for update;

  if not found then
    raise exception 'Native video asset not found.' using errcode = '02000';
  end if;
  if exists (select 1 from public.video_asset_attachments attachment
      where attachment.tenant_id = p_tenant_id
        and attachment.video_asset_id = p_asset_id) then
    raise exception 'Detach this video from lessons before deleting it.'
      using errcode = '22023';
  end if;
  if v_asset.status = 'delete_pending' then
    return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status);
  end if;
  if v_asset.status <> 'ready'
     or v_asset.provider_asset_id is null then
    raise exception 'Native video cannot be deleted in its current state.'
      using errcode = '22023';
  end if;

  update public.video_assets set
    status = 'delete_pending', delete_requested_at = now()
  where id = v_asset.id returning * into v_asset;

  return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status);
end;
$$;

create function public.confirm_native_video_provider_deletion_server(
  p_asset_id uuid,
  p_provider_asset_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.video_assets%rowtype;
begin
  select * into v_asset from public.video_assets where id = p_asset_id;
  if not found then
    raise exception 'Native video asset not found.' using errcode = '02000';
  end if;
  perform coachfort_internal.native_video_capacity_authority_lock(v_asset.tenant_id);
  select * into v_asset from public.video_assets where id = p_asset_id for update;

  if v_asset.status = 'deleted'
     and v_asset.provider_asset_id = btrim(p_provider_asset_id) then
    return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status);
  end if;
  if v_asset.status <> 'delete_pending'
     or v_asset.provider_asset_id is distinct from btrim(p_provider_asset_id)
     or exists (select 1 from public.video_asset_attachments attachment
       where attachment.video_asset_id = v_asset.id) then
    raise exception 'Native video provider deletion cannot be confirmed.'
      using errcode = '55000';
  end if;

  update public.video_assets set
    status = 'deleted', provider_deleted_at = now(),
    reserved_seconds = 0, reservation_expires_at = null
  where id = v_asset.id returning * into v_asset;

  return jsonb_build_object('asset_id', v_asset.id, 'status', v_asset.status);
end;
$$;

create function public.get_native_video_capacity_server(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_capacity jsonb;
  v_usage jsonb;
  v_feature jsonb;
  v_feature_status text;
  v_effective bigint;
  v_stored_seconds bigint;
  v_reserved_seconds bigint;
  v_percent numeric;
  v_state text;
begin
  perform coachfort_internal.assert_native_video_owner_admin(
    p_tenant_id, p_actor_user_id
  );
  v_capacity := coachfort_internal.resolve_native_video_capacity(p_tenant_id);
  v_usage := coachfort_internal.resolve_native_video_usage(p_tenant_id, null);
  v_feature := coachfort_internal.resolve_effective_feature_access_authority(
    p_tenant_id, 'native_video'
  );
  select feature->>'effective_status' into v_feature_status
  from jsonb_array_elements(coalesce(v_feature->'features','[]'::jsonb)) feature
  where feature->>'feature_key' = 'native_video';

  v_effective := (v_capacity->>'effective_capacity_minutes')::bigint;
  v_stored_seconds := (v_usage->>'stored_seconds')::bigint;
  v_reserved_seconds := (v_usage->>'reserved_seconds')::bigint;
  v_percent := case when v_effective <= 0 then 100
    else least(100, round((v_stored_seconds::numeric / 60) * 100 / v_effective, 2)) end;
  v_state := case when v_percent >= 100 then 'full'
    when v_percent >= 95 then 'critical'
    when v_percent >= 85 then 'warning'
    when v_percent >= 70 then 'notice'
    else 'normal' end;

  return v_capacity || jsonb_build_object(
    'feature_enabled', coalesce(v_feature_status, 'locked') = 'included',
    'stored_minutes', ceil(v_stored_seconds::numeric / 60)::bigint,
    'reserved_minutes', ceil(v_reserved_seconds::numeric / 60)::bigint,
    'available_for_new_upload_minutes', greatest(
      0, v_effective - ceil((v_stored_seconds + v_reserved_seconds)::numeric / 60)::bigint
    ),
    'percent_used', v_percent,
    'capacity_state', v_state
  );
end;
$$;

alter function coachfort_internal.native_video_capacity_authority_lock(uuid)
  owner to postgres;
alter function coachfort_internal.enforce_native_video_override_authority_lock()
  owner to postgres;
alter function coachfort_internal.enforce_video_capacity_pack_authority_lock()
  owner to postgres;
alter function coachfort_internal.enforce_video_capacity_pack_catalog_identity()
  owner to postgres;
alter function coachfort_internal.enforce_video_asset_authority()
  owner to postgres;
alter function coachfort_internal.assert_native_video_owner_admin(uuid,uuid)
  owner to postgres;
alter function coachfort_internal.resolve_native_video_capacity(uuid)
  owner to postgres;
alter function coachfort_internal.resolve_native_video_usage(uuid,uuid)
  owner to postgres;
alter function coachfort_internal.validate_external_video_url(text)
  owner to postgres;
alter function coachfort_internal.enforce_lesson_external_video_authority()
  owner to postgres;

revoke all on function coachfort_internal.native_video_capacity_authority_lock(uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_native_video_override_authority_lock()
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_video_capacity_pack_authority_lock()
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_video_capacity_pack_catalog_identity()
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_video_asset_authority()
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.assert_native_video_owner_admin(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.resolve_native_video_capacity(uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.resolve_native_video_usage(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.validate_external_video_url(text)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_lesson_external_video_authority()
  from public, anon, authenticated, service_role;

alter function public.reserve_native_video_upload_server(
  uuid,uuid,bigint,bigint,text,text,uuid) owner to postgres;
alter function public.bind_native_video_provider_identity_server(uuid,text,text)
  owner to postgres;
alter function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb) owner to postgres;
alter function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb) owner to postgres;
alter function public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)
  owner to postgres;
alter function public.detach_native_video_from_lesson_server(uuid,uuid,uuid)
  owner to postgres;
alter function public.request_native_video_deletion_server(uuid,uuid,uuid)
  owner to postgres;
alter function public.confirm_native_video_provider_deletion_server(uuid,text)
  owner to postgres;
alter function public.get_native_video_capacity_server(uuid,uuid)
  owner to postgres;
revoke all on function public.reserve_native_video_upload_server(
  uuid,uuid,bigint,bigint,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.bind_native_video_provider_identity_server(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.detach_native_video_from_lesson_server(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.request_native_video_deletion_server(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_native_video_provider_deletion_server(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_native_video_capacity_server(uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.reserve_native_video_upload_server(
  uuid,uuid,bigint,bigint,text,text,uuid) to service_role;
grant execute on function public.bind_native_video_provider_identity_server(uuid,text,text)
  to service_role;
grant execute on function public.record_native_video_provider_event_server(
  text,text,text,timestamptz,text,text,jsonb) to service_role;
grant execute on function public.finalize_native_video_asset_processing_server(
  uuid,text,bigint,text,text,timestamptz,text,jsonb) to service_role;
grant execute on function public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.detach_native_video_from_lesson_server(uuid,uuid,uuid)
  to service_role;
grant execute on function public.request_native_video_deletion_server(uuid,uuid,uuid)
  to service_role;
grant execute on function public.confirm_native_video_provider_deletion_server(uuid,text)
  to service_role;
grant execute on function public.get_native_video_capacity_server(uuid,uuid)
  to service_role;

do $$
declare
  v_baseline video2a_apply_baseline%rowtype;
begin
  select * into v_baseline from video2a_apply_baseline;

  if (select count(*) from public.tenants) <> v_baseline.tenant_rows
     or (select count(*) from public.tenant_subscription_assignments)
       <> v_baseline.assignment_rows
     or (select count(*) from public.subscription_plan_prices)
       <> v_baseline.plan_price_rows
     or (select md5(coalesce(string_agg(
       to_jsonb(price_row)::text, '|' order by price_row.id), ''))
       from public.subscription_plan_prices price_row)
       <> v_baseline.plan_price_fingerprint
     or (select count(*) from public.subscription_plan_feature_entitlements)
       <> v_baseline.plan_feature_rows + 3
     or (select md5(coalesce(string_agg(
       to_jsonb(feature_row)::text, '|' order by feature_row.id), ''))
       from public.subscription_plan_feature_entitlements feature_row
       where feature_row.feature_key <> 'native_video')
       <> v_baseline.plan_feature_fingerprint
     or (select count(*) from public.subscription_plan_usage_limits)
       <> v_baseline.plan_limit_rows + 3
     or (select md5(coalesce(string_agg(
       to_jsonb(limit_row)::text, '|' order by limit_row.id), ''))
       from public.subscription_plan_usage_limits limit_row
       where limit_row.resource_key <> 'video_storage_minutes')
       <> v_baseline.plan_limit_fingerprint
     or (select count(*) from public.tenant_subscription_overrides)
       <> v_baseline.override_rows
     or (select md5(coalesce(string_agg(
       to_jsonb(override_row)::text, '|' order by override_row.id), ''))
       from public.tenant_subscription_overrides override_row)
       <> v_baseline.override_fingerprint
     or (select md5(coalesce(string_agg(
       plan.id::text || ':' || plan.code || ':' || plan.status || ':'
         || plan.is_public::text || ':' || plan.trial_days::text || ':'
         || plan.metadata_json::text,
       '|' order by plan.id), '')) from public.subscription_plans plan)
       <> v_baseline.plan_commercial_fingerprint
     or (select count(*) from public.courses) <> v_baseline.course_rows
     or (select count(*) from public.course_sections) <> v_baseline.section_rows
     or (select count(*) from public.lessons) <> v_baseline.lesson_rows
     or (select count(*) from public.lessons where video_url is not null)
       <> v_baseline.video_url_rows
     or (select md5(coalesce(string_agg(
       lesson.id::text || ':' || coalesce(lesson.video_url, '<NULL>'),
       '|' order by lesson.id), '')) from public.lessons lesson)
       <> v_baseline.video_url_fingerprint
     or (select count(*) from public.tenant_payment_orders)
       <> v_baseline.payment_order_rows
     or (select count(*) from public.tenant_payment_attempts)
       <> v_baseline.payment_attempt_rows
     or (select count(*) from public.payment_transactions)
       <> v_baseline.payment_transaction_rows
     or (select count(*) from public.invoices) <> v_baseline.invoice_rows
     or (select count(*) from public.platform_billing_receipts)
       <> v_baseline.platform_receipt_rows
     or (select count(*) from public.platform_billing_document_fulfillments)
       <> v_baseline.platform_fulfillment_rows
     or (select count(*) from public.finance_invoices)
       <> v_baseline.finance_invoice_rows
     or (select count(*) from public.finance_payments)
       <> v_baseline.finance_payment_rows
     or (select count(*) from public.finance_receipts)
       <> v_baseline.finance_receipt_rows then
    raise exception 'VIDEO-2A changed protected business data.' using errcode = '55000';
  end if;

  if (select jsonb_object_agg(
        procedure.oid::regprocedure::text,
        jsonb_build_object(
          'definition', pg_get_functiondef(procedure.oid),
          'owner', pg_get_userbyid(procedure.proowner),
          'acl', coalesce(procedure.proacl::text, ''),
          'security_definer', procedure.prosecdef,
          'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
        ) order by procedure.oid::regprocedure::text
      ) from pg_proc procedure where procedure.oid in (
        to_regprocedure('public.create_lesson_secure(uuid,uuid,uuid,text,text,text,text,text,integer,boolean)'),
        to_regprocedure('public.update_lesson_secure(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)')
      )) is distinct from v_baseline.lesson_rpc_contract then
    raise exception 'VIDEO-2A changed existing lesson RPC authority.'
      using errcode = '55000';
  end if;

  if (select jsonb_object_agg(
        procedure.oid::regprocedure::text,
        jsonb_build_object(
          'owner', pg_get_userbyid(procedure.proowner),
          'acl', coalesce(procedure.proacl::text, ''),
          'security_definer', procedure.prosecdef,
          'volatility', procedure.provolatile,
          'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb)
        ) order by procedure.oid::regprocedure::text
      ) from pg_proc procedure where procedure.oid in (
        to_regprocedure('public.subscription_entitlements_resource_keys()'),
        to_regprocedure('public.subscription_entitlements_feature_keys()')
      )) is distinct from v_baseline.entitlement_helper_security_contract then
    raise exception 'VIDEO-2A changed entitlement helper security authority.'
      using errcode = '55000';
  end if;

  if public.subscription_entitlements_resource_keys() is distinct from array[
       'students','courses','cohorts','batches','admins','staff_trainers',
       'team_members','storage_mb','document_uploads','messages_monthly',
       'automation_runs_monthly','ai_requests_monthly','video_storage_minutes'
     ]::text[]
     or public.subscription_entitlements_feature_keys() is distinct from array[
       'dashboard','students','courses','attendance','assignments','finance',
       'reports','documents','document_uploads','messages','crm','marketing',
       'automations','workflows','approvals','team_operations','audit_compliance',
       'backup_recovery','website_builder','certificates','payment_gateway',
       'live_classes','notifications','mobile_pwa','ai_assistant',
       'custom_branding','api_integrations','community_hub','native_video'
     ]::text[] then
    raise exception 'VIDEO-2A entitlement helper extension is not exact.'
      using errcode = '55000';
  end if;

  if (select array_agg(literal_match[1] order by literal_match[1] collate "C")
      from pg_constraint constraint_row
      cross join lateral regexp_matches(
        pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
        '''([^'']+)''', 'g'
      ) literal_match
      where constraint_row.conname =
        'subscription_plan_usage_limits_resource_key_check')
       is distinct from array[
         'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
         'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
         'students','team_members','video_storage_minutes'
       ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'tenant_subscription_overrides_resource_key_check')
       is distinct from array[
         'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
         'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
         'students','team_members','video_storage_minutes'
       ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'subscription_plan_usage_limits_limit_type_check')
       is distinct from array[
         'boolean','count','duration_minutes','monthly_count','storage_mb'
       ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'subscription_plan_feature_entitlements_feature_key_check')
       is distinct from array[
         'ai_assistant','api_integrations','approvals','assignments','attendance',
         'audit_compliance','automations','backup_recovery','certificates',
         'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
         'documents','finance','live_classes','marketing','messages','mobile_pwa',
         'native_video','notifications','payment_gateway','reports','students',
         'team_operations','website_builder','workflows'
       ]::text[]
     or (select array_agg(literal_match[1] order by literal_match[1] collate "C")
         from pg_constraint constraint_row
         cross join lateral regexp_matches(
           pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
           '''([^'']+)''', 'g'
         ) literal_match
         where constraint_row.conname =
           'tenant_subscription_overrides_feature_key_check')
       is distinct from array[
         'ai_assistant','api_integrations','approvals','assignments','attendance',
         'audit_compliance','automations','backup_recovery','certificates',
         'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
         'documents','finance','live_classes','marketing','messages','mobile_pwa',
         'native_video','notifications','payment_gateway','reports','students',
         'team_operations','website_builder','workflows'
       ]::text[] then
    raise exception 'VIDEO-2A entitlement constraint extension is not exact.'
      using errcode = '55000';
  end if;

  if pg_get_functiondef(to_regprocedure(
       'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'))
       <> v_baseline.lifecycle_definition
     or pg_get_functiondef(to_regprocedure(
       'coachfort_internal.resolve_effective_feature_access_authority(uuid,text)'))
       <> v_baseline.feature_definition
     or pg_get_functiondef(to_regprocedure(
       'coachfort_internal.assert_effective_operational_feature(uuid,text)'))
       <> v_baseline.feature_assertion_definition then
    raise exception 'VIDEO-2A changed protected lifecycle or feature authority.'
      using errcode = '55000';
  end if;

  if (select count(*) from public.video_assets) <> 0
     or (select count(*) from public.video_asset_attachments) <> 0
     or (select count(*) from public.video_provider_events) <> 0
     or (select count(*) from public.tenant_video_capacity_pack_assignments) <> 0 then
    raise exception 'VIDEO-2A fabricated tenant video data.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events'),
      ('public.video_capacity_pack_catalog'),
      ('public.tenant_video_capacity_pack_assignments')
    ) protected(identity)
    cross join (values ('anon'),('authenticated'),('service_role')) actor(role_name)
    cross join (values
      ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')
    ) dangerous(privilege_name)
    where has_table_privilege(
      actor.role_name, protected.identity, dangerous.privilege_name
    )
  ) or exists (
    select 1
    from (values
      ('public.video_assets'),
      ('public.video_asset_attachments'),
      ('public.video_provider_events'),
      ('public.video_capacity_pack_catalog'),
      ('public.tenant_video_capacity_pack_assignments')
    ) protected(identity)
    join pg_class relation on relation.oid = to_regclass(protected.identity)
    cross join lateral aclexplode(coalesce(
      relation.relacl, acldefault('r', relation.relowner)
    )) acl
    where acl.grantee = 0
      and acl.privilege_type in (
        'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
      )
  ) then
    raise exception 'VIDEO-2A video table direct mutation ACL is unsafe.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid = to_regclass('public.video_assets')
         and constraint_row.conname = 'video_assets_provider_state_check'
         and lower(pg_get_constraintdef(constraint_row.oid)) like
           '%status <> ''processing''%provider_asset_id is not null%'
         and lower(pg_get_constraintdef(constraint_row.oid)) like
           '%status <> ''failed''%provider_asset_id is null%'
     )
     or lower(pg_get_functiondef(to_regprocedure(
       'coachfort_internal.enforce_video_asset_authority()'))) like
       '%old.status = ''processing'' and new.status in (''ready'',''failed'',''delete_pending'')%'
     or lower(pg_get_functiondef(to_regprocedure(
       'coachfort_internal.enforce_video_asset_authority()'))) not like
       '%old.status = ''processing'' and new.status in (''ready'',''delete_pending'')%'
     or lower(pg_get_functiondef(to_regprocedure(
       'coachfort_internal.enforce_lesson_external_video_authority()'))) not like
       '%new.video_url is not distinct from old.video_url%'
     or position(
       'new.video_url is not distinct from old.video_url'
       in lower(pg_get_functiondef(to_regprocedure(
         'coachfort_internal.enforce_lesson_external_video_authority()')))
     ) >= position(
       'validate_external_video_url'
       in lower(pg_get_functiondef(to_regprocedure(
         'coachfort_internal.enforce_lesson_external_video_authority()')))
     ) then
    raise exception 'VIDEO-2A asset or lesson transition authority is incomplete.'
      using errcode = '55000';
  end if;

  if (select count(*)
      from (values
        ('starter', 600),
        ('growth', 3000),
        ('premium', 9000)
      ) expected(plan_code, limit_value)
      join public.subscription_plans plan on plan.code = expected.plan_code
      join public.subscription_plan_feature_entitlements feature
        on feature.plan_id = plan.id
       and feature.feature_key = 'native_video'
       and feature.entitlement_status = 'included'
       and not feature.requires_platform_approval
       and feature.included_quota is null
       and feature.metadata_json = '{"installed_by":"VIDEO-2A"}'::jsonb
      join public.subscription_plan_usage_limits plan_limit
        on plan_limit.plan_id = plan.id
       and plan_limit.resource_key = 'video_storage_minutes'
       and plan_limit.limit_value = expected.limit_value
       and plan_limit.limit_type = 'duration_minutes'
       and plan_limit.enforcement_mode = 'hard'
       and plan_limit.warning_threshold_percent = 70
       and plan_limit.allow_platform_override
       and plan_limit.metadata_json = jsonb_build_object(
         'installed_by', 'VIDEO-2A',
         'reset_period', 'none',
         'customer_unit', 'video_hours'
       )) <> 3
     or (select count(*) from public.video_capacity_pack_catalog
         where code = 'video_capacity_25h'
           and name = 'Video Capacity Pack'
           and capacity_minutes = 1500
           and status = 'inactive'
           and not is_public
           and not is_purchasable
           and metadata_json = jsonb_build_object(
             'installed_by', 'VIDEO-2A', 'price_assigned', false
           )) <> 1 then
    raise exception 'VIDEO-2A catalog installation is incomplete.' using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;

-- ============================================================================
-- POST-APPLY READ-ONLY VERIFICATION
-- ============================================================================
with plan_video_contract as (
  select
    count(*) filter (where plan.code = 'starter'
      and feature.entitlement_status = 'included'
      and not feature.requires_platform_approval
      and feature.included_quota is null
      and feature.metadata_json = '{"installed_by":"VIDEO-2A"}'::jsonb) = 1
      starter_feature,
    count(*) filter (where plan.code = 'growth'
      and feature.entitlement_status = 'included'
      and not feature.requires_platform_approval
      and feature.included_quota is null
      and feature.metadata_json = '{"installed_by":"VIDEO-2A"}'::jsonb) = 1
      growth_feature,
    count(*) filter (where plan.code = 'premium'
      and feature.entitlement_status = 'included'
      and not feature.requires_platform_approval
      and feature.included_quota is null
      and feature.metadata_json = '{"installed_by":"VIDEO-2A"}'::jsonb) = 1
      premium_feature,
    count(*) filter (where plan.code = 'starter' and plan_limit.limit_value = 600
      and plan_limit.limit_type = 'duration_minutes'
      and plan_limit.enforcement_mode = 'hard'
      and plan_limit.warning_threshold_percent = 70
      and plan_limit.allow_platform_override
      and plan_limit.metadata_json = jsonb_build_object(
        'installed_by', 'VIDEO-2A', 'reset_period', 'none',
        'customer_unit', 'video_hours')) = 1 starter_limit,
    count(*) filter (where plan.code = 'growth' and plan_limit.limit_value = 3000
      and plan_limit.limit_type = 'duration_minutes'
      and plan_limit.enforcement_mode = 'hard'
      and plan_limit.warning_threshold_percent = 70
      and plan_limit.allow_platform_override
      and plan_limit.metadata_json = jsonb_build_object(
        'installed_by', 'VIDEO-2A', 'reset_period', 'none',
        'customer_unit', 'video_hours')) = 1 growth_limit,
    count(*) filter (where plan.code = 'premium' and plan_limit.limit_value = 9000
      and plan_limit.limit_type = 'duration_minutes'
      and plan_limit.enforcement_mode = 'hard'
      and plan_limit.warning_threshold_percent = 70
      and plan_limit.allow_platform_override
      and plan_limit.metadata_json = jsonb_build_object(
        'installed_by', 'VIDEO-2A', 'reset_period', 'none',
        'customer_unit', 'video_hours')) = 1 premium_limit,
    count(*) filter (where plan_limit.limit_type = 'duration_minutes'
      and plan_limit.enforcement_mode = 'hard'
      and plan_limit.metadata_json ->> 'reset_period' = 'none'
      and plan_limit.metadata_json ->> 'customer_unit' = 'video_hours') = 3
      video_storage_non_resetting
  from public.subscription_plans plan
  left join public.subscription_plan_feature_entitlements feature
    on feature.plan_id = plan.id and feature.feature_key = 'native_video'
  left join public.subscription_plan_usage_limits plan_limit
    on plan_limit.plan_id = plan.id
   and plan_limit.resource_key = 'video_storage_minutes'
  where plan.code in ('starter','growth','premium')
), schema_contract as (
  select
    (select count(*) = 5 from (values
      ('public.video_assets'),('public.video_asset_attachments'),
      ('public.video_provider_events'),('public.video_capacity_pack_catalog'),
      ('public.tenant_video_capacity_pack_assignments')
    ) expected(identity) where to_regclass(identity) is not null) tables_ready,
    (select count(*) = 1 from public.video_capacity_pack_catalog
      where code = 'video_capacity_25h'
        and name = 'Video Capacity Pack'
        and capacity_minutes = 1500
        and status = 'inactive' and not is_public and not is_purchasable
        and metadata_json = jsonb_build_object(
          'installed_by', 'VIDEO-2A', 'price_assigned', false
        )
        and not (metadata_json ? 'price_minor')
        and not exists (
          select 1 from information_schema.columns column_def
          where column_def.table_schema = 'public'
            and column_def.table_name = 'video_capacity_pack_catalog'
            and column_def.column_name like '%price%'
        )) pack_ready,
    (select count(*) = 0 from public.tenant_video_capacity_pack_assignments)
      no_pack_assignments,
    (select count(*) = 0 from public.video_assets) no_assets,
    (select count(*) = 0 from public.video_provider_events) no_provider_events,
    exists (
      select 1
      from information_schema.columns column_def
      where column_def.table_schema = 'public'
        and column_def.table_name = 'video_assets'
        and column_def.column_name = 'last_provider_observed_at'
        and column_def.data_type = 'timestamp with time zone'
    ) provider_observation_column
), function_contract as (
  select
    count(*) = 18 installed,
    (select count(*) = 19
     from pg_proc inventory_procedure
     join pg_namespace inventory_namespace
       on inventory_namespace.oid = inventory_procedure.pronamespace
     where (inventory_namespace.nspname = 'coachfort_internal'
       and inventory_procedure.proname in (
         'native_video_capacity_authority_lock',
         'enforce_native_video_override_authority_lock',
         'enforce_video_capacity_pack_authority_lock',
         'enforce_video_capacity_pack_catalog_identity',
         'enforce_video_asset_authority',
         'assert_native_video_owner_admin',
         'resolve_native_video_capacity',
         'resolve_native_video_usage',
         'validate_external_video_url',
         'enforce_lesson_external_video_authority'
       )) or (inventory_namespace.nspname = 'public'
       and inventory_procedure.proname in (
         'reserve_native_video_upload_server',
         'bind_native_video_provider_identity_server',
         'record_native_video_provider_event_server',
         'finalize_native_video_asset_processing_server',
         'attach_native_video_to_lesson_server',
         'detach_native_video_from_lesson_server',
         'request_native_video_deletion_server',
         'confirm_native_video_provider_deletion_server',
         'get_native_video_capacity_server'
       ))) exact_inventory,
    bool_and(pg_get_userbyid(procedure.proowner) = 'postgres') postgres_owned,
    bool_and(procedure.prosecdef) security_definer,
    bool_and(coalesce(procedure.proconfig, '{}'::text[])
      @> array['search_path=public, pg_temp']) fixed_search_path
  from (values
    ('coachfort_internal.native_video_capacity_authority_lock(uuid)'),
    ('coachfort_internal.enforce_native_video_override_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_catalog_identity()'),
    ('coachfort_internal.enforce_video_asset_authority()'),
    ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    ('coachfort_internal.resolve_native_video_capacity(uuid)'),
    ('coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
    ('coachfort_internal.validate_external_video_url(text)'),
    ('coachfort_internal.enforce_lesson_external_video_authority()'),
    ('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    ('public.bind_native_video_provider_identity_server(uuid,text,text)'),
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
    ('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    ('public.confirm_native_video_provider_deletion_server(uuid,text)')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
), safe_read_contract as (
  select
    procedure.oid is not null installed,
    pg_get_userbyid(procedure.proowner) = 'postgres' postgres_owned,
    procedure.prosecdef security_definer,
    coalesce(procedure.proconfig, '{}'::text[])
      @> array['search_path=public, pg_temp'] fixed_search_path,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE') service_execute,
    not has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_denied,
    not has_function_privilege('authenticated', procedure.oid, 'EXECUTE') authenticated_denied,
    not exists (
      select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) public_denied
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'public.get_native_video_capacity_server(uuid,uuid)')
), source_contract as (
  select
    reserve_source like '%assert_tenant_operational_access(p_tenant_id)%'
      and reserve_source like '%assert_effective_operational_feature%native_video%'
      reservation_lifecycle_feature,
    reserve_source like '%p_expected_duration_seconds not between 1 and 7200%'
      single_upload_limit_7200_seconds,
    reserve_source like '%10737418240%' file_limit_10gb,
    reserve_source like '%native_video_capacity_authority_lock%'
      and position('native_video_capacity_authority_lock' in reserve_source)
        < position('resolve_native_video_usage' in reserve_source)
      reservation_concurrency_safe,
    reserve_source like '%interval ''90 minutes''%' reservation_expiry_contract,
    usage_source like '%status in (''ready'',''delete_pending'')%'
      and usage_source like '%provider_deleted_at is null%'
      ready_usage_authority_correct,
    usage_source like '%status = ''processing''%'
      and usage_source like '%status = ''delete_pending''%duration_seconds is null%'
      processing_reservation_authority_correct,
    finalize_source like '%provider_duration_exceeds_reservation%'
      and finalize_source like '%provider_duration_exceeds_capacity%'
      and finalize_source like '%status = ''delete_pending''%'
      and finalize_source like '%when v_duration_valid then 0 else reserved_seconds%'
      provider_duration_fail_closed,
    capacity_source like '%v_override%v_base::bigint + v_add_on%'
      and capacity_source not like '%pack.status = ''active''%'
      platform_override_precedence_preserved,
    lesson_trigger_source like '%validate_external_video_url%'
      external_video_new_write_https_safe,
    lesson_trigger_source like '%tg_op = ''update''%'
      and lesson_trigger_source like
        '%new.video_url is not distinct from old.video_url%'
      and position('new.video_url is not distinct from old.video_url'
        in lesson_trigger_source)
        < position('validate_external_video_url' in lesson_trigger_source)
      historical_unchanged_external_url_preserved,
    lesson_trigger_source like '%video_asset_attachments%'
      external_native_exclusive,
    asset_trigger_source not like
      '%old.status = ''processing'' and new.status in (''ready'',''failed'',''delete_pending'')%'
      and asset_trigger_source like
        '%old.status = ''processing'' and new.status in (''ready'',''delete_pending'')%'
      provider_backed_failed_transition_closed,
    finalize_source like '%last_provider_observed_at%'
      and finalize_source like '%p_event_time < v_asset.last_provider_observed_at%'
      and finalize_source like '%processing_status = ''ignored''%'
      stale_observation_safe,
    finalize_source like '%native video finalization input is invalid%'
      and finalize_source like '%native video provider identity does not match the asset%'
      and finalize_source like '%insert into public.video_provider_events%'
      and position('native video finalization input is invalid' in finalize_source)
      < position('insert into public.video_provider_events' in finalize_source)
      and position('native video provider identity does not match the asset' in finalize_source)
      < position('insert into public.video_provider_events' in finalize_source)
      invalid_finalize_rejected_before_evidence,
    record_source like '%p_event_time is null%'
      and record_source like '%char_length(v_provider_asset_id) not between 1 and 255%'
      and record_source like '%p_safe_payload_hash !~ ''^[0-9a-f]{64}$''%'
      and finalize_source like '%char_length(v_provider_asset_id) not between 1 and 255%'
      and finalize_source like '%jsonb_typeof(v_evidence) <> ''object''%'
      provider_inputs_validated,
    pack_identity_source like '%new.code, new.capacity_minutes%'
      and pack_identity_source like '%canonical video capacity pack cannot be deleted%'
      pack_identity_immutable,
    delete_source like '%video_asset_attachments%'
      and delete_source like '%delete_pending%'
      reference_safe_delete,
    confirm_source like '%status = ''deleted''%'
      and confirm_source like '%provider_deleted_at = now()%'
      deleted_releases_usage
  from (
    select
      lower(pg_get_functiondef(to_regprocedure(
        'public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'))) reserve_source,
      lower(pg_get_functiondef(to_regprocedure(
        'coachfort_internal.resolve_native_video_usage(uuid,uuid)'))) usage_source,
      lower(pg_get_functiondef(to_regprocedure(
        'coachfort_internal.resolve_native_video_capacity(uuid)'))) capacity_source,
      lower(pg_get_functiondef(to_regprocedure(
        'public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'))) finalize_source,
      lower(pg_get_functiondef(to_regprocedure(
        'public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'))) record_source,
      lower(pg_get_functiondef(to_regprocedure(
        'coachfort_internal.enforce_lesson_external_video_authority()'))) lesson_trigger_source,
      lower(pg_get_functiondef(to_regprocedure(
        'coachfort_internal.enforce_video_asset_authority()'))) asset_trigger_source,
      lower(pg_get_functiondef(to_regprocedure(
        'coachfort_internal.enforce_video_capacity_pack_catalog_identity()'))) pack_identity_source,
      lower(pg_get_functiondef(to_regprocedure(
        'public.request_native_video_deletion_server(uuid,uuid,uuid)'))) delete_source,
      lower(pg_get_functiondef(to_regprocedure(
        'public.confirm_native_video_provider_deletion_server(uuid,text)'))) confirm_source
  ) sources
), lesson_rpc_preservation as (
  select
    count(*) = 2 function_count,
    bool_and(pg_get_userbyid(procedure.proowner) = 'postgres') postgres_owned,
    bool_and(procedure.prosecdef) security_definer,
    bool_and(coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=public'])
      original_search_path,
    bool_and(has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      authenticated_execute,
    bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE')) anon_denied,
    bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      service_denied,
    bool_and(not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) public_denied,
    bool_and(lower(pg_get_functiondef(procedure.oid)) like '%m69_2_normalize_text%'
      and lower(pg_get_functiondef(procedure.oid)) not like '%native_video%'
      and lower(pg_get_functiondef(procedure.oid)) not like
        '%validate_external_video_url%') original_source_preserved,
    jsonb_object_agg(
      procedure.oid::regprocedure::text,
      md5(pg_get_functiondef(procedure.oid))
      order by procedure.oid::regprocedure::text
    ) definition_fingerprints
  from (values
    ('public.create_lesson_secure(uuid,uuid,uuid,text,text,text,text,text,integer,boolean)'),
    ('public.update_lesson_secure(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
), extended_constraint_literals as (
  select
    constraint_row.conname,
    array_agg(literal_match[1] order by literal_match[1] collate "C") literals
  from pg_constraint constraint_row
  cross join lateral regexp_matches(
    pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
    '''([^'']+)''', 'g'
  ) literal_match
  where constraint_row.conname in (
    'subscription_plan_usage_limits_resource_key_check',
    'subscription_plan_usage_limits_limit_type_check',
    'subscription_plan_feature_entitlements_feature_key_check',
    'tenant_subscription_overrides_resource_key_check',
    'tenant_subscription_overrides_feature_key_check'
  )
  group by constraint_row.conname
), entitlement_extension_contract as (
  select
    (select literals from extended_constraint_literals where conname =
      'subscription_plan_usage_limits_resource_key_check') = array[
        'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
        'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
        'students','team_members','video_storage_minutes'
      ]::text[] plan_resource_exact,
    (select literals from extended_constraint_literals where conname =
      'tenant_subscription_overrides_resource_key_check') = array[
        'admins','ai_requests_monthly','automation_runs_monthly','batches','cohorts',
        'courses','document_uploads','messages_monthly','staff_trainers','storage_mb',
        'students','team_members','video_storage_minutes'
      ]::text[] override_resource_exact,
    (select literals from extended_constraint_literals where conname =
      'subscription_plan_usage_limits_limit_type_check') = array[
        'boolean','count','duration_minutes','monthly_count','storage_mb'
      ]::text[] limit_type_exact,
    (select literals from extended_constraint_literals where conname =
      'subscription_plan_feature_entitlements_feature_key_check') = array[
        'ai_assistant','api_integrations','approvals','assignments','attendance',
        'audit_compliance','automations','backup_recovery','certificates',
        'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
        'documents','finance','live_classes','marketing','messages','mobile_pwa',
        'native_video','notifications','payment_gateway','reports','students',
        'team_operations','website_builder','workflows'
      ]::text[] plan_feature_exact,
    (select literals from extended_constraint_literals where conname =
      'tenant_subscription_overrides_feature_key_check') = array[
        'ai_assistant','api_integrations','approvals','assignments','attendance',
        'audit_compliance','automations','backup_recovery','certificates',
        'community_hub','courses','crm','custom_branding','dashboard','document_uploads',
        'documents','finance','live_classes','marketing','messages','mobile_pwa',
        'native_video','notifications','payment_gateway','reports','students',
        'team_operations','website_builder','workflows'
      ]::text[] override_feature_exact,
    public.subscription_entitlements_resource_keys() = array[
      'students','courses','cohorts','batches','admins','staff_trainers',
      'team_members','storage_mb','document_uploads','messages_monthly',
      'automation_runs_monthly','ai_requests_monthly','video_storage_minutes'
    ]::text[] resource_helper_exact,
    public.subscription_entitlements_feature_keys() = array[
      'dashboard','students','courses','attendance','assignments','finance',
      'reports','documents','document_uploads','messages','crm','marketing',
      'automations','workflows','approvals','team_operations','audit_compliance',
      'backup_recovery','website_builder','certificates','payment_gateway',
      'live_classes','notifications','mobile_pwa','ai_assistant',
      'custom_branding','api_integrations','community_hub','native_video'
    ]::text[] feature_helper_exact,
    (select count(*) = 2
       and bool_and(pg_get_userbyid(procedure.proowner) = 'postgres')
       and bool_and(not procedure.prosecdef)
       and bool_and(procedure.provolatile = 'i')
       and bool_and(coalesce(procedure.proconfig, '{}'::text[])
         @> array['search_path=public'])
       and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
       and bool_and(not has_function_privilege(
         'authenticated', procedure.oid, 'EXECUTE'))
       and bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
       and bool_and(not exists (
         select 1
         from aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
       ))
     from (values
       ('public.subscription_entitlements_resource_keys()'),
       ('public.subscription_entitlements_feature_keys()')
     ) expected(identity)
     join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
    ) helper_security_preserved
), attachment_contract as (
  select
    count(*) filter (where constraint_row.conname =
      'video_asset_attachments_asset_fk') = 1 asset_tenant_fk,
    count(*) filter (where constraint_row.conname =
      'video_asset_attachments_lesson_fk') = 1 lesson_tenant_fk,
    count(*) filter (where constraint_row.conname =
      'video_asset_attachments_lesson_key') = 1 one_native_video_per_lesson
  from pg_constraint constraint_row
  where constraint_row.conrelid = to_regclass('public.video_asset_attachments')
), event_contract as (
  select
    count(*) filter (where constraint_row.conname =
      'video_provider_events_identity_key') = 1 replay_safe,
    count(*) filter (where constraint_row.conname =
      'video_provider_events_evidence_check') = 1 bounded_evidence,
    count(*) filter (where constraint_row.conname =
      'video_provider_events_provider_asset_id_check') = 1 bounded_provider_identity,
    count(*) filter (where constraint_row.conname =
      'video_provider_events_match_pair_check') = 1 matched_pair_required,
    count(*) filter (where constraint_row.conname =
      'video_provider_events_asset_fk'
      and constraint_row.confrelid = to_regclass('public.video_assets')
      and constraint_row.confdeltype = 'n') = 1 tenant_asset_fk
  from pg_constraint constraint_row
  where constraint_row.conrelid = to_regclass('public.video_provider_events')
), asset_contract as (
  select
    count(*) filter (where constraint_row.conname =
      'video_assets_status_check'
      and lower(pg_get_constraintdef(constraint_row.oid)) like
        '%upload_pending%processing%ready%failed%delete_pending%deleted%') = 1
      status_contract,
    count(*) filter (where constraint_row.conname =
      'video_assets_ready_identity_check'
      and lower(pg_get_constraintdef(constraint_row.oid)) like
        '%status <> ''ready''%provider_asset_id is not null%duration_seconds is not null%') = 1
      provider_identity_contract,
    count(*) filter (where constraint_row.conname =
      'video_assets_provider_state_check'
      and lower(pg_get_constraintdef(constraint_row.oid)) like
        '%status <> ''processing''%provider_asset_id is not null%'
      and lower(pg_get_constraintdef(constraint_row.oid)) like
        '%status <> ''failed''%provider_asset_id is null%') = 1
      provider_backed_failed_state_impossible,
    count(*) filter (where constraint_row.conname =
      'video_assets_request_key') = 1 reservation_idempotency_contract,
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = to_regclass('public.video_assets')
        and trigger_row.tgname = 'enforce_video_asset_authority'
        and trigger_row.tgfoid = to_regprocedure(
          'coachfort_internal.enforce_video_asset_authority()')
        and not trigger_row.tgisinternal
    ) transition_trigger_bound,
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = to_regclass('public.lessons')
        and trigger_row.tgname = 'enforce_lesson_external_video_authority'
        and trigger_row.tgfoid = to_regprocedure(
          'coachfort_internal.enforce_lesson_external_video_authority()')
        and not trigger_row.tgisinternal
    ) external_url_trigger_bound,
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = to_regclass('public.video_capacity_pack_catalog')
        and trigger_row.tgname = 'enforce_video_capacity_pack_catalog_identity'
        and trigger_row.tgfoid = to_regprocedure(
          'coachfort_internal.enforce_video_capacity_pack_catalog_identity()')
        and not trigger_row.tgisinternal
    ) pack_identity_trigger_bound
  from pg_constraint constraint_row
  where constraint_row.conrelid = to_regclass('public.video_assets')
), key_contract as (
  select
    'native_video' = any(public.subscription_entitlements_feature_keys())
      feature_key_registered,
    'video_storage_minutes' = any(public.subscription_entitlements_resource_keys())
      resource_key_registered
), private_acl as (
  select
    count(*) = 10 function_count,
    bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      anon_denied,
    bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      authenticated_denied,
    bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      service_denied,
    bool_and(not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) public_denied
  from (values
    ('coachfort_internal.native_video_capacity_authority_lock(uuid)'),
    ('coachfort_internal.enforce_native_video_override_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_catalog_identity()'),
    ('coachfort_internal.enforce_video_asset_authority()'),
    ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    ('coachfort_internal.resolve_native_video_capacity(uuid)'),
    ('coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
    ('coachfort_internal.validate_external_video_url(text)'),
    ('coachfort_internal.enforce_lesson_external_video_authority()')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
), provider_runtime_contract as (
  select
    count(*) = 19 function_count,
    bool_and(lower(pg_get_functiondef(procedure.oid)) not like '%api.cloudflare.com%'
      and lower(pg_get_functiondef(procedure.oid)) not like '%net.http%'
      and lower(pg_get_functiondef(procedure.oid)) not like '%http_post%'
      and lower(pg_get_functiondef(procedure.oid)) not like '%cloudflare_api_token%'
      and lower(pg_get_functiondef(procedure.oid)) not like '%playback_signing_key%')
      no_provider_runtime_or_secrets
  from (values
    ('coachfort_internal.native_video_capacity_authority_lock(uuid)'),
    ('coachfort_internal.enforce_native_video_override_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_authority_lock()'),
    ('coachfort_internal.enforce_video_capacity_pack_catalog_identity()'),
    ('coachfort_internal.enforce_video_asset_authority()'),
    ('coachfort_internal.assert_native_video_owner_admin(uuid,uuid)'),
    ('coachfort_internal.resolve_native_video_capacity(uuid)'),
    ('coachfort_internal.resolve_native_video_usage(uuid,uuid)'),
    ('coachfort_internal.validate_external_video_url(text)'),
    ('coachfort_internal.enforce_lesson_external_video_authority()'),
    ('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    ('public.bind_native_video_provider_identity_server(uuid,text,text)'),
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
    ('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    ('public.confirm_native_video_provider_deletion_server(uuid,text)'),
    ('public.get_native_video_capacity_server(uuid,uuid)')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
), browser_acl as (
  select
    not exists (
      select 1
      from (values
        ('public.video_assets'),
        ('public.video_asset_attachments'),
        ('public.video_provider_events'),
        ('public.video_capacity_pack_catalog'),
        ('public.tenant_video_capacity_pack_assignments')
      ) protected(identity)
      cross join (values ('anon'),('authenticated'),('service_role')) actor(role_name)
      cross join (values
        ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')
      ) dangerous(privilege_name)
      where has_table_privilege(
        actor.role_name, protected.identity, dangerous.privilege_name
      )
    ) effective_role_writes_absent,
    not exists (
      select 1
      from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name in (
          'video_assets','video_asset_attachments','video_provider_events',
          'video_capacity_pack_catalog','tenant_video_capacity_pack_assignments'
        )
        and privilege.grantee in ('PUBLIC','anon','authenticated','service_role')
        and privilege.privilege_type in (
          'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
        )
    ) explicit_role_writes_absent,
    not exists (
      select 1
      from (values
        ('public.video_assets'),
        ('public.video_asset_attachments'),
        ('public.video_provider_events'),
        ('public.video_capacity_pack_catalog'),
        ('public.tenant_video_capacity_pack_assignments')
      ) protected(identity)
      join pg_class relation on relation.oid = to_regclass(protected.identity)
      cross join lateral aclexplode(coalesce(
        relation.relacl, acldefault('r', relation.relowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type in (
          'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
        )
    ) public_writes_absent
), server_acl as (
  select
    count(*) = 9 function_count,
    bool_and(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
      service_execute,
    bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      anon_denied,
    bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      authenticated_denied,
    bool_and(not exists (
      select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )) public_denied
  from (values
    ('public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)'),
    ('public.bind_native_video_provider_identity_server(uuid,text,text)'),
    ('public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)'),
    ('public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)'),
    ('public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)'),
    ('public.detach_native_video_from_lesson_server(uuid,uuid,uuid)'),
    ('public.request_native_video_deletion_server(uuid,uuid,uuid)'),
    ('public.confirm_native_video_provider_deletion_server(uuid,text)'),
    ('public.get_native_video_capacity_server(uuid,uuid)')
  ) expected(identity)
  join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
), data_contract as (
  select
    (select count(*) = 0 from public.video_assets) no_video_assets_created,
    (select count(*) = 0 from public.video_asset_attachments) no_attachments_created,
    (select count(*) = 0 from public.video_provider_events) no_events_created,
    (select count(*) = 0 from public.tenant_video_capacity_pack_assignments)
      no_tenant_packs_created
), protected_counts as (
  select
    (select count(*) from public.tenants) tenant_rows,
    (select count(*) from public.tenant_subscription_assignments) assignment_rows,
    (select count(*) from public.subscription_plan_prices) plan_price_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(price_row)::text, '|' order by price_row.id), ''))
      from public.subscription_plan_prices price_row) plan_price_fingerprint,
    (select count(*) from public.subscription_plan_feature_entitlements)
      plan_feature_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(feature_row)::text, '|' order by feature_row.id), ''))
      from public.subscription_plan_feature_entitlements feature_row)
      plan_feature_fingerprint,
    (select count(*) from public.subscription_plan_usage_limits) plan_limit_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(limit_row)::text, '|' order by limit_row.id), ''))
      from public.subscription_plan_usage_limits limit_row) plan_limit_fingerprint,
    (select count(*) from public.tenant_subscription_overrides) override_rows,
    (select md5(coalesce(string_agg(
      to_jsonb(override_row)::text, '|' order by override_row.id), ''))
      from public.tenant_subscription_overrides override_row) override_fingerprint,
    (select md5(coalesce(string_agg(
      plan.id::text || ':' || plan.code || ':' || plan.status || ':'
        || plan.is_public::text || ':' || plan.trial_days::text || ':'
        || plan.metadata_json::text,
      '|' order by plan.id), '')) from public.subscription_plans plan)
      plan_commercial_fingerprint,
    (select count(*) from public.courses) course_rows,
    (select count(*) from public.course_sections) section_rows,
    (select count(*) from public.lessons) lesson_rows,
    (select count(*) from public.lessons where video_url is not null) video_url_rows,
    (select md5(coalesce(string_agg(
      lesson.id::text || ':' || coalesce(lesson.video_url, '<NULL>'),
      '|' order by lesson.id), '')) from public.lessons lesson)
      video_url_fingerprint,
    (select count(*) from public.tenant_payment_orders) payment_order_rows,
    (select count(*) from public.tenant_payment_attempts) payment_attempt_rows,
    (select count(*) from public.payment_transactions) payment_transaction_rows,
    (select count(*) from public.invoices) invoice_rows,
    (select count(*) from public.platform_billing_receipts) platform_receipt_rows,
    (select count(*) from public.platform_billing_document_fulfillments)
      platform_fulfillment_rows,
    (select count(*) from public.finance_invoices) finance_invoice_rows,
    (select count(*) from public.finance_payments) finance_payment_rows,
    (select count(*) from public.finance_receipts) finance_receipt_rows
), gate as (
  select
    plan_video_contract.starter_feature
      and plan_video_contract.growth_feature
      and plan_video_contract.premium_feature
      and plan_video_contract.starter_limit
      and plan_video_contract.growth_limit
      and plan_video_contract.premium_limit
      and plan_video_contract.video_storage_non_resetting
      and schema_contract.tables_ready and schema_contract.pack_ready
      and schema_contract.no_pack_assignments and schema_contract.no_assets
      and schema_contract.no_provider_events
      and schema_contract.provider_observation_column
      and function_contract.installed and function_contract.exact_inventory
      and function_contract.postgres_owned
      and function_contract.security_definer and function_contract.fixed_search_path
      and safe_read_contract.installed and safe_read_contract.postgres_owned
      and safe_read_contract.security_definer and safe_read_contract.fixed_search_path
      and safe_read_contract.service_execute and safe_read_contract.anon_denied
      and safe_read_contract.authenticated_denied and safe_read_contract.public_denied
      and source_contract.reservation_lifecycle_feature
      and source_contract.single_upload_limit_7200_seconds
      and source_contract.file_limit_10gb
      and source_contract.reservation_concurrency_safe
      and source_contract.reservation_expiry_contract
      and source_contract.ready_usage_authority_correct
      and source_contract.processing_reservation_authority_correct
      and source_contract.provider_duration_fail_closed
      and source_contract.stale_observation_safe
      and source_contract.invalid_finalize_rejected_before_evidence
      and source_contract.provider_inputs_validated
      and source_contract.pack_identity_immutable
      and source_contract.platform_override_precedence_preserved
      and source_contract.external_video_new_write_https_safe
      and source_contract.historical_unchanged_external_url_preserved
      and source_contract.external_native_exclusive
      and source_contract.provider_backed_failed_transition_closed
      and source_contract.reference_safe_delete
      and source_contract.deleted_releases_usage
      and attachment_contract.asset_tenant_fk
      and attachment_contract.lesson_tenant_fk
      and attachment_contract.one_native_video_per_lesson
      and event_contract.replay_safe and event_contract.bounded_evidence
      and event_contract.bounded_provider_identity
      and event_contract.matched_pair_required
      and event_contract.tenant_asset_fk
      and asset_contract.status_contract
      and asset_contract.provider_identity_contract
      and asset_contract.provider_backed_failed_state_impossible
      and asset_contract.reservation_idempotency_contract
      and asset_contract.transition_trigger_bound
      and asset_contract.external_url_trigger_bound
      and asset_contract.pack_identity_trigger_bound
      and key_contract.feature_key_registered
      and key_contract.resource_key_registered
      and lesson_rpc_preservation.function_count
      and lesson_rpc_preservation.postgres_owned
      and lesson_rpc_preservation.security_definer
      and lesson_rpc_preservation.original_search_path
      and lesson_rpc_preservation.authenticated_execute
      and lesson_rpc_preservation.anon_denied
      and lesson_rpc_preservation.service_denied
      and lesson_rpc_preservation.public_denied
      and lesson_rpc_preservation.original_source_preserved
      and entitlement_extension_contract.plan_resource_exact
      and entitlement_extension_contract.override_resource_exact
      and entitlement_extension_contract.limit_type_exact
      and entitlement_extension_contract.plan_feature_exact
      and entitlement_extension_contract.override_feature_exact
      and entitlement_extension_contract.resource_helper_exact
      and entitlement_extension_contract.feature_helper_exact
      and entitlement_extension_contract.helper_security_preserved
      and private_acl.function_count and private_acl.anon_denied
      and private_acl.authenticated_denied and private_acl.service_denied
      and private_acl.public_denied
      and provider_runtime_contract.function_count
      and provider_runtime_contract.no_provider_runtime_or_secrets
      and browser_acl.effective_role_writes_absent
      and browser_acl.explicit_role_writes_absent
      and browser_acl.public_writes_absent
      and server_acl.function_count and server_acl.service_execute
      and server_acl.anon_denied and server_acl.authenticated_denied
      and server_acl.public_denied
      and data_contract.no_video_assets_created
      and data_contract.no_attachments_created
      and data_contract.no_events_created
      and data_contract.no_tenant_packs_created
      as security_gate
  from plan_video_contract, schema_contract, function_contract,
    safe_read_contract, source_contract, lesson_rpc_preservation,
    entitlement_extension_contract, attachment_contract, event_contract,
    asset_contract, key_contract, private_acl, provider_runtime_contract,
    browser_acl, server_acl, data_contract
)
select
  gate.security_gate,
  plan_video_contract.starter_feature
    and plan_video_contract.growth_feature
    and plan_video_contract.premium_feature native_video_feature_ready,
  plan_video_contract.starter_limit starter_video_limit_600,
  plan_video_contract.growth_limit growth_video_limit_3000,
  plan_video_contract.premium_limit premium_video_limit_9000,
  plan_video_contract.video_storage_non_resetting video_storage_resource_non_monthly,
  plan_video_contract.video_storage_non_resetting video_storage_non_resetting,
  schema_contract.tables_ready video_asset_schema_ready,
  asset_contract.status_contract video_asset_status_contract,
  asset_contract.provider_identity_contract video_asset_provider_identity_contract,
  asset_contract.provider_backed_failed_state_impossible
    and source_contract.provider_backed_failed_transition_closed
    provider_backed_failed_state_impossible,
  source_contract.reservation_lifecycle_feature reservation_authority_ready,
  source_contract.reservation_concurrency_safe reservation_concurrency_safe,
  source_contract.reservation_expiry_contract reservation_expiry_contract,
  source_contract.ready_usage_authority_correct,
  source_contract.processing_reservation_authority_correct,
  source_contract.reference_safe_delete delete_pending_still_counts,
  source_contract.deleted_releases_usage,
  source_contract.single_upload_limit_7200_seconds,
  source_contract.file_limit_10gb,
  schema_contract.pack_ready capacity_pack_definition_ready,
  schema_contract.pack_ready capacity_pack_minutes_1500,
  schema_contract.pack_ready capacity_pack_price_not_assigned,
  source_contract.platform_override_precedence_preserved,
  safe_read_contract.installed safe_capacity_rpc_ready,
  safe_read_contract.service_execute and safe_read_contract.anon_denied
    and safe_read_contract.authenticated_denied and safe_read_contract.public_denied
    safe_capacity_rpc_server_only,
  event_contract.replay_safe provider_event_replay_safe,
  event_contract.bounded_evidence provider_event_evidence_ready,
  event_contract.bounded_provider_identity provider_event_identity_bounded,
  event_contract.matched_pair_required and event_contract.tenant_asset_fk
    provider_event_tenant_asset_consistent,
  browser_acl.effective_role_writes_absent
    and browser_acl.explicit_role_writes_absent
    and browser_acl.public_writes_absent browser_video_table_writes_absent,
  lesson_rpc_preservation.original_source_preserved
    and lesson_rpc_preservation.authenticated_execute
    and lesson_rpc_preservation.anon_denied
    and lesson_rpc_preservation.service_denied
    and lesson_rpc_preservation.public_denied lesson_rpc_authority_preserved,
  lesson_rpc_preservation.definition_fingerprints lesson_rpc_fingerprints,
  entitlement_extension_contract.plan_resource_exact
    and entitlement_extension_contract.override_resource_exact
    and entitlement_extension_contract.limit_type_exact
    and entitlement_extension_contract.plan_feature_exact
    and entitlement_extension_contract.override_feature_exact
    and entitlement_extension_contract.resource_helper_exact
    and entitlement_extension_contract.feature_helper_exact
    entitlement_contract_extended_exactly,
  source_contract.stale_observation_safe,
  source_contract.invalid_finalize_rejected_before_evidence,
  source_contract.provider_inputs_validated,
  source_contract.pack_identity_immutable,
  source_contract.external_video_new_write_https_safe,
  source_contract.historical_unchanged_external_url_preserved,
  function_contract.installed and function_contract.exact_inventory
    and safe_read_contract.installed
    apply_clean_install_guard_complete,
  data_contract.no_video_assets_created
    and data_contract.no_attachments_created historical_video_urls_preserved,
  provider_runtime_contract.no_provider_runtime_or_secrets
    no_cloudflare_secret_or_runtime_authority_in_sql,
  data_contract.no_video_assets_created
    and data_contract.no_attachments_created
    and data_contract.no_events_created
    and data_contract.no_tenant_packs_created protected_rows_unchanged,
  to_jsonb(protected_counts) protected_counts
from gate, plan_video_contract, schema_contract, function_contract, source_contract,
  safe_read_contract, lesson_rpc_preservation, entitlement_extension_contract,
  event_contract, asset_contract, provider_runtime_contract,
  browser_acl, data_contract, protected_counts;
