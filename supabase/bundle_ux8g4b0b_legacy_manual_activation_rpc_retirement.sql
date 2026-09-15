-- Bundle UX-8G4B0B: retire the legacy browser-callable manual activation RPC.
-- PRE/APPLY/POST are intentionally kept in one review artifact.
-- Do not execute without separate production approval.

-- ============================================================================
-- PRE-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with identities as (
  select
    to_regprocedure(
      'public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)'
    ) legacy_rpc,
    to_regprocedure(
      'public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)'
    ) canonical_rpc,
    to_regprocedure(
      'coachfort_internal.enforce_manual_subscription_activation_audit_immutability()'
    ) evidence_trigger
), required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.tenant_subscription_assignments'),
    ('public.manual_subscription_activation_audits'),
    ('public.platform_tenant_subscriptions'),
    ('public.subscriptions'),
    ('public.tenant_payment_orders'),
    ('public.tenant_payment_attempts'),
    ('public.razorpay_webhook_events'),
    ('public.tenant_plan_activation_events'),
    ('public.tenant_subscription_change_intents'),
    ('public.invoices'),
    ('public.platform_billing_receipts')
), relation_state as (
  select count(*) expected_count, count(to_regclass(identity)) installed_count
  from required_relations
), required_evidence_columns(column_name) as (
  values
    ('id'), ('tenant_id'), ('assignment_id'), ('platform_subscription_id'),
    ('idempotency_key'), ('request_id'), ('request_fingerprint'),
    ('payment_reference'), ('payment_reference_normalized'), ('customer_email'),
    ('plan_id'), ('price_id'), ('plan_code'), ('legacy_plan'),
    ('billing_cycle'), ('amount_minor'), ('currency'), ('subscription_start'),
    ('subscription_end'), ('payment_method'), ('payment_verified_at'),
    ('payment_evidence_kind'), ('founder_approval'), ('support_tier'),
    ('operator_note'), ('activation_status'), ('request_payload_json'),
    ('result_json'), ('metadata_json'), ('created_by'), ('created_at')
), evidence_schema_state as (
  select
    to_regclass('public.manual_subscription_activation_audits') is not null
      evidence_table_present,
    count(*) expected_column_count,
    count(column_def.column_name) installed_column_count
  from required_evidence_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = 'manual_subscription_activation_audits'
   and column_def.column_name = expected.column_name
), legacy_contract as (
  select
    count(procedure.oid) = 1 exact_identity,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false)
      owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(
      procedure.proconfig = array['search_path=public']
    ), false) fixed_search_path,
    coalesce(bool_and(
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    ), false) authenticated_execute,
    coalesce(bool_and(
      not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    ), false) anon_execute_absent,
    coalesce(bool_and(
      not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ), false) service_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent
  from identities
  left join pg_proc procedure on procedure.oid = identities.legacy_rpc
), canonical_contract as (
  select
    count(procedure.oid) = 1 exact_identity,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false)
      owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(
      procedure.proconfig = array['search_path=public, pg_temp']
    ), false) fixed_search_path,
    coalesce(bool_and(
      has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ), false) service_execute,
    coalesce(bool_and(
      not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    ), false) authenticated_execute_absent,
    coalesce(bool_and(
      not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    ), false) anon_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent,
    coalesce(max(pg_get_functiondef(procedure.oid)), '') source
  from identities
  left join pg_proc procedure on procedure.oid = identities.canonical_rpc
), canonical_source_contract as (
  select
    normalized_source like '%from public.platform_admin_users platform_actor%'
      actor_revalidation,
    normalized_source like '%platform_actor.role in (''owner'',''admin'')%'
      actor_role_revalidation,
    normalized_source like '%from public.subscription_plans plan%'
      canonical_plan,
    normalized_source like '%from public.subscription_plan_prices price%'
      canonical_price,
    normalized_source not like '%149900%'
      and normalized_source not like '%599900%' no_hardcoded_price,
    normalized_source not like '%v_plan_code in (''starter'',''growth'')%'
      no_hardcoded_plan_mapping,
    normalized_source like '%v_period_start + interval ''1 month''%'
      and normalized_source like '%v_period_start + interval ''1 year''%'
      database_period_derivation,
    normalized_source like '%v_period_end + interval ''7 days''%'
      exact_grace_derivation,
    normalized_source like '%request_fingerprint%'
      and normalized_source like '%extensions.digest%'
      and normalized_source like '%idempotent'', true%' durable_idempotency,
    normalized_source like '%pg_advisory_xact_lock%'
      and normalized_source like '%for update%' concurrency_safe,
    normalized_source like '%manual_operator_verified%'
      and normalized_source like '%provider_evidence'', false%'
      manual_evidence_distinct,
    normalized_source not like '%insert into public.tenant_payment_orders%'
      and normalized_source not like
        '%insert into public.tenant_payment_attempts%'
      and normalized_source not like
        '%insert into public.razorpay_webhook_events%'
      and normalized_source not like
        '%insert into public.tenant_plan_activation_events%'
      and normalized_source not like '%insert into public.invoices%'
      and normalized_source not like
        '%insert into public.platform_billing_receipts%'
      no_provider_or_document_fabrication,
    normalized_source not like '%insert into public.subscriptions%'
      and normalized_source not like '%update public.tenants%'
      obsolete_legacy_writes_absent,
    normalized_source like
        '%insert into public.platform_tenant_subscriptions%'
      and normalized_source like '%projection_source%'
      required_platform_projection,
    normalized_source like
        '%select count(*) into v_platform_plan_count%'
      and normalized_source like '%if v_platform_plan_count <> 1%'
      and normalized_source like '%order by platform_plan.id%'
      and normalized_source like '%limit 1%'
      and normalized_source like '%for share%'
      deterministic_platform_projection,
    normalized_source like '%v_has_commercial_assignment_history%'
      and normalized_source like '%assignment.status <> ''trial''%'
      and normalized_source like
        '%assignment.payment_status <> ''not_required''%'
      and normalized_source like
        '%canonical renewal or plan-change authority is required%'
      and normalized_source not like
        '%v_current.status in (''cancelled'',''suspended'',''expired'')%'
      and normalized_source not like
        '%v_lifecycle->>''reason'' = ''grace_period_elapsed''%'
      paid_renewal_shadow_absent,
    normalized_source like '%v_current.status <> ''trial''%'
      and normalized_source like
        '%v_current.payment_status <> ''not_required''%'
      and normalized_source like '%v_current.trial_started_at is null%'
      and normalized_source like '%v_current.trial_ends_at is null%'
      and normalized_source like
        '%v_current.current_period_start is not null%'
      and normalized_source like
        '%v_current.current_period_end is not null%'
      and normalized_source like
        '%v_current.grace_period_ends_at is not null%'
      and normalized_source like
        '%(''within_trial_period'',''trial_period_elapsed'')%'
      trial_conversion_only
  from (
    select lower(source) normalized_source from canonical_contract
  ) normalized_contract
), evidence_trigger_contract as (
  select
    count(trigger_def.oid) = 1 exact_trigger,
    coalesce(bool_and(
      trigger_def.tgfoid = identities.evidence_trigger
    ), false) correct_binding
  from identities
  left join pg_trigger trigger_def
    on trigger_def.tgrelid =
        to_regclass('public.manual_subscription_activation_audits')
   and trigger_def.tgname =
       'enforce_manual_subscription_activation_audit_immutability'
   and not trigger_def.tgisinternal
), evidence_trigger_function_contract as (
  select
    count(procedure.oid) = 1 exact_function,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false)
      owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(
      procedure.proconfig = array['search_path=public, pg_temp']
    ), false) fixed_search_path,
    coalesce(bool_and(
      not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ), false) service_execute_absent,
    coalesce(bool_and(
      not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    ), false) authenticated_execute_absent,
    coalesce(bool_and(
      not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    ), false) anon_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent
  from identities
  left join pg_proc procedure on procedure.oid = identities.evidence_trigger
), expected_replacement_constraints(
  constraint_name,
  expected_columns,
  expected_expression,
  expected_root,
  expected_and_nodes
) as (
  values
    (
      'manual_subscription_activation_audits_plan_code_format_check',
      array['plan_code']::text[],
      'plan_code~''^[a-z0-9][a-z0-9_-]{0,63}$''::text', 'operator', 0
    ),
    (
      'manual_subscription_activation_audits_legacy_plan_format_check',
      array['legacy_plan']::text[],
      'legacy_planISNULLORlegacy_plan~''^[a-z0-9][a-z0-9_-]{0,63}$''::text',
      'or', 0
    ),
    (
      'manual_subscription_activation_audits_currency_format_check',
      array['currency']::text[],
      'currency~''^[A-Z]{3}$''::text', 'operator', 0
    ),
    (
      'manual_subscription_activation_audits_request_fingerprint_check',
      array['request_fingerprint']::text[],
      'request_fingerprintISNULLORrequest_fingerprint~''^[0-9a-f]{64}$''::text',
      'or', 0
    ),
    (
      'manual_subscription_activation_audits_evidence_kind_check',
      array['payment_evidence_kind']::text[],
      'payment_evidence_kindISNULLORpayment_evidence_kind=''manual_operator_verified''::text',
      'or', 0
    ),
    (
      'manual_subscription_activation_audits_canonical_request_check',
      array[
        'activation_status','assignment_id','idempotency_key','legacy_plan',
        'payment_evidence_kind','plan_id','platform_subscription_id','price_id',
        'request_fingerprint','request_id'
      ]::text[],
      'request_idISNULLANDrequest_fingerprintISNULLANDplan_idISNULLANDprice_idISNULLANDpayment_evidence_kindISNULLORrequest_idISNOTNULLANDrequest_fingerprintISNOTNULLANDplan_idISNOTNULLANDprice_idISNOTNULLANDpayment_evidence_kind=''manual_operator_verified''::textANDidempotency_key=request_id::textANDassignment_idISNOTNULLANDplatform_subscription_idISNOTNULLANDactivation_status=''activated''::textANDlegacy_planISNULL',
      'or', 2
    )
), replacement_constraint_catalog as (
  select
    expected.*,
    constraint_def.oid,
    constraint_def.contype,
    constraint_def.convalidated,
    constraint_def.conislocal,
    constraint_def.coninhcount,
    constraint_def.connoinherit,
    regexp_replace(
      pg_get_expr(constraint_def.conbin, constraint_def.conrelid, true),
      '[()[:space:]]+', '', 'g'
    ) compact_expression,
    case
      when constraint_def.conbin::text like '{BOOLEXPR :boolop or %' then 'or'
      when constraint_def.conbin::text like '{OPEXPR %' then 'operator'
      else 'other'
    end expression_root,
    (
      length(constraint_def.conbin::text)
      - length(replace(constraint_def.conbin::text, ':boolop and', ''))
    ) / length(':boolop and') and_node_count,
    array(
      select attribute.attname::text
      from unnest(constraint_def.conkey) key_column(attnum)
      join pg_attribute attribute
        on attribute.attrelid = constraint_def.conrelid
       and attribute.attnum = key_column.attnum
       and not attribute.attisdropped
      order by attribute.attname::text
    ) actual_columns
  from expected_replacement_constraints expected
  left join pg_constraint constraint_def
    on constraint_def.conrelid =
        to_regclass('public.manual_subscription_activation_audits')
   and constraint_def.conname = expected.constraint_name
), replacement_constraint_contract as (
  select
    count(*) = 6 expected_constraint_count,
    count(oid) = 6 installed_constraint_count,
    coalesce(bool_and(
      contype = 'c'
      and convalidated
      and conislocal
      and coninhcount = 0
      and not connoinherit
      and actual_columns = expected_columns
      and compact_expression = expected_expression
      and expression_root = expected_root
      and and_node_count = expected_and_nodes
    ), false) exact_contract
  from replacement_constraint_catalog
), request_index_contract as (
  select
    count(index_def.indexrelid) = 1 exact_index_count,
    coalesce(bool_and(
      index_def.indrelid =
        to_regclass('public.manual_subscription_activation_audits')
      and index_relation.relname =
        'manual_subscription_activation_audits_request_id_uidx'
      and index_def.indisunique
      and index_def.indisvalid
      and index_def.indisready
      and index_def.indislive
      and index_def.indnkeyatts = 1
      and index_def.indnatts = 1
      and index_def.indexprs is null
      and request_column.attnum is not null
      and index_def.indkey[0] = request_column.attnum
      and index_def.indpred is not null
      and regexp_replace(
        pg_get_expr(index_def.indpred, index_def.indrelid, true),
        '[()[:space:]]+', '', 'g'
      ) = 'request_idISNOTNULL'
    ), false) exact_contract
  from pg_class index_relation
  left join pg_index index_def on index_def.indexrelid = index_relation.oid
  left join pg_attribute request_column
    on request_column.attrelid =
        to_regclass('public.manual_subscription_activation_audits')
   and request_column.attname = 'request_id'
   and request_column.attnum > 0
   and not request_column.attisdropped
  where index_relation.oid = to_regclass(
    'public.manual_subscription_activation_audits_request_id_uidx'
  )
), evidence_relation_contract as (
  select
    count(*) filter (where column_name in (
      'request_id','request_fingerprint','plan_id','price_id',
      'payment_evidence_kind'
    )) = 5 canonical_columns,
    count(*) filter (
      where column_name = 'legacy_plan' and is_nullable = 'YES'
    ) = 1 legacy_plan_nullable,
    coalesce((select relrowsecurity from pg_class
      where oid = to_regclass(
        'public.manual_subscription_activation_audits'
      )), false) rls_enabled,
    not exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid =
          to_regclass('public.manual_subscription_activation_audits')
        and constraint_def.conname in (
          'manual_subscription_activation_audits_plan_code_check',
          'manual_subscription_activation_audits_legacy_plan_check',
          'manual_subscription_activation_audits_currency_check'
        )
    ) legacy_constraints_absent,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid =
          to_regclass('public.manual_subscription_activation_audits')
        and constraint_def.conname =
          'manual_subscription_activation_audits_idempotency_key_unique'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) =
          'UNIQUE (idempotency_key)'
    ) idempotency_key_unique,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid =
          to_regclass('public.manual_subscription_activation_audits')
        and constraint_def.conname =
          'manual_subscription_activation_audits_payment_reference_unique'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) =
          'UNIQUE (payment_reference_normalized)'
    ) payment_reference_normalized_unique
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_subscription_activation_audits'
), manual_rpc_inventory as (
  select
    count(*) total_count,
    count(*) filter (where procedure.oid = identities.legacy_rpc) legacy_count,
    count(*) filter (where procedure.oid = identities.canonical_rpc)
      canonical_count,
    coalesce(jsonb_agg(
      procedure.oid::regprocedure::text
      order by procedure.oid::regprocedure::text
    ), '[]'::jsonb) identities
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join identities
  where namespace.nspname = 'public'
    and procedure.proname like 'activate_tenant_subscription_manual%'
), incoming_dependencies as (
  select
    dependency.classid,
    dependency.objid,
    dependency.objsubid,
    dependency.deptype,
    pg_describe_object(
      dependency.classid, dependency.objid, dependency.objsubid
    ) dependent_object
  from pg_depend dependency
  cross join identities
  where dependency.refclassid = 'pg_proc'::regclass
    and dependency.refobjid = identities.legacy_rpc
), function_source_references as (
  select procedure.oid::regprocedure::text identity
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join identities
  where procedure.oid <> identities.legacy_rpc
    and lower(procedure.prosrc) ~
      '(^|[^a-z0-9_])activate_tenant_subscription_manual[[:space:]]*[(]'
), direct_binding_state as (
  select
    (select count(*) from incoming_dependencies) incoming_dependency_count,
    (select count(*) from function_source_references) source_reference_count,
    (select count(*) from pg_trigger trigger_def cross join identities
      where trigger_def.tgfoid = identities.legacy_rpc) trigger_binding_count,
    coalesce((select jsonb_agg(jsonb_build_object(
      'object', dependent_object,
      'dependency_type', deptype
    ) order by dependent_object) from incoming_dependencies), '[]'::jsonb)
      dependency_inventory,
    coalesce((select jsonb_agg(identity order by identity)
      from function_source_references), '[]'::jsonb) source_reference_inventory
), ddl_event_trigger_inventory as (
  select
    count(*) enabled_relevant_event_trigger_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'name', event_trigger.evtname,
      'event', event_trigger.evtevent,
      'enabled', event_trigger.evtenabled,
      'function', event_trigger.evtfoid::regprocedure::text,
      'tags', event_trigger.evttags
    ) order by event_trigger.evtname), '[]'::jsonb) inventory
  from pg_event_trigger event_trigger
  where event_trigger.evtenabled <> 'D'
    and event_trigger.evtevent in ('sql_drop','ddl_command_end')
), platform_projection_acl_state as (
  select
    exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'platform_tenant_subscriptions'
        and privilege.grantee = 'authenticated'
        and privilege.privilege_type = 'SELECT'
        and privilege.is_grantable = 'NO'
    ) authenticated_select_present,
    not exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'platform_tenant_subscriptions'
        and privilege.grantee = 'authenticated'
        and privilege.privilege_type in (
          'REFERENCES','TRIGGER','TRUNCATE','INSERT','UPDATE','DELETE','MAINTAIN'
        )
    ) authenticated_unsafe_absent,
    not exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'platform_tenant_subscriptions'
        and privilege.grantee in ('PUBLIC','anon')
        and privilege.privilege_type in (
          'REFERENCES','TRIGGER','TRUNCATE','INSERT','UPDATE','DELETE','MAINTAIN'
        )
    ) public_anon_unsafe_absent
), browser_write_state as (
  select count(*) browser_dangerous_grants
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in (
      'manual_subscription_activation_audits',
      'tenant_subscription_assignments',
      'subscription_plan_prices',
      'platform_tenant_subscriptions'
    )
    and privilege.grantee in ('PUBLIC','anon','authenticated')
    and privilege.privilege_type in (
      'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
    )
), protected_counts as (
  select
    (select count(*) from public.tenants) tenants,
    (select count(*) from public.tenant_subscription_assignments)
      tenant_subscription_assignments,
    (select count(*) from public.manual_subscription_activation_audits)
      manual_subscription_activation_audits,
    (select count(*) from public.platform_tenant_subscriptions)
      platform_tenant_subscriptions,
    (select count(*) from public.subscriptions) subscriptions,
    (select count(*) from public.tenant_payment_orders) tenant_payment_orders,
    (select count(*) from public.tenant_payment_attempts)
      tenant_payment_attempts,
    (select count(*) from public.razorpay_webhook_events)
      razorpay_webhook_events,
    (select count(*) from public.tenant_plan_activation_events)
      tenant_plan_activation_events,
    (select count(*) from public.tenant_subscription_change_intents)
      tenant_subscription_change_intents,
    (select count(*) from public.invoices) invoices,
    (select count(*) from public.platform_billing_receipts)
      platform_billing_receipts
), gates as (
  select
    relation_state.expected_count = relation_state.installed_count
      relations_ready,
    evidence_schema_state.evidence_table_present
      and evidence_schema_state.expected_column_count =
          evidence_schema_state.installed_column_count evidence_schema_ready,
    legacy_contract.exact_identity
      and legacy_contract.owner_is_postgres
      and legacy_contract.security_definer
      and legacy_contract.fixed_search_path
      and legacy_contract.authenticated_execute
      and legacy_contract.anon_execute_absent
      and legacy_contract.service_execute_absent
      and legacy_contract.public_execute_absent legacy_rollout_contract,
    canonical_contract.exact_identity
      and canonical_contract.owner_is_postgres
      and canonical_contract.security_definer
      and canonical_contract.fixed_search_path
      and canonical_contract.service_execute
      and canonical_contract.authenticated_execute_absent
      and canonical_contract.anon_execute_absent
      and canonical_contract.public_execute_absent canonical_server_contract,
    canonical_source_contract.actor_revalidation
      and canonical_source_contract.actor_role_revalidation
      and canonical_source_contract.canonical_plan
      and canonical_source_contract.canonical_price
      and canonical_source_contract.no_hardcoded_price
      and canonical_source_contract.no_hardcoded_plan_mapping
      and canonical_source_contract.database_period_derivation
      and canonical_source_contract.exact_grace_derivation
      and canonical_source_contract.durable_idempotency
      and canonical_source_contract.concurrency_safe
      and canonical_source_contract.manual_evidence_distinct
      and canonical_source_contract.no_provider_or_document_fabrication
      and canonical_source_contract.obsolete_legacy_writes_absent
      and canonical_source_contract.required_platform_projection
      and canonical_source_contract.deterministic_platform_projection
      and canonical_source_contract.paid_renewal_shadow_absent
      and canonical_source_contract.trial_conversion_only
      canonical_authority_behavior_intact,
    evidence_trigger_contract.exact_trigger
      and evidence_trigger_contract.correct_binding
      and evidence_trigger_function_contract.exact_function
      and evidence_trigger_function_contract.owner_is_postgres
      and evidence_trigger_function_contract.security_definer
      and evidence_trigger_function_contract.fixed_search_path
      and evidence_trigger_function_contract.service_execute_absent
      and evidence_trigger_function_contract.authenticated_execute_absent
      and evidence_trigger_function_contract.anon_execute_absent
      and evidence_trigger_function_contract.public_execute_absent
      and replacement_constraint_contract.expected_constraint_count
      and replacement_constraint_contract.installed_constraint_count
      and replacement_constraint_contract.exact_contract
      and request_index_contract.exact_index_count
      and request_index_contract.exact_contract
      and evidence_relation_contract.canonical_columns
      and evidence_relation_contract.legacy_plan_nullable
      and evidence_relation_contract.rls_enabled
      and evidence_relation_contract.legacy_constraints_absent
      and evidence_relation_contract.idempotency_key_unique
      and evidence_relation_contract.payment_reference_normalized_unique
      canonical_evidence_authority_intact,
    manual_rpc_inventory.total_count = 2
      and manual_rpc_inventory.legacy_count = 1
      and manual_rpc_inventory.canonical_count = 1 exact_rollout_inventory,
    direct_binding_state.incoming_dependency_count = 0
      and direct_binding_state.source_reference_count = 0
      and direct_binding_state.trigger_binding_count = 0 dependency_free,
    browser_write_state.browser_dangerous_grants = 0 browser_writes_absent,
    platform_projection_acl_state.authenticated_select_present
      and platform_projection_acl_state.authenticated_unsafe_absent
      and platform_projection_acl_state.public_anon_unsafe_absent
      platform_projection_acl_safe
  from relation_state
  cross join evidence_schema_state
  cross join legacy_contract
  cross join canonical_contract
  cross join canonical_source_contract
  cross join evidence_trigger_contract
  cross join evidence_trigger_function_contract
  cross join replacement_constraint_contract
  cross join request_index_contract
  cross join evidence_relation_contract
  cross join manual_rpc_inventory
  cross join direct_binding_state
  cross join browser_write_state
  cross join platform_projection_acl_state
)
select
  1::integer verification_row_count,
  gates.*,
  manual_rpc_inventory.identities manual_rpc_inventory,
  direct_binding_state.incoming_dependency_count,
  direct_binding_state.source_reference_count,
  direct_binding_state.trigger_binding_count,
  direct_binding_state.dependency_inventory,
  direct_binding_state.source_reference_inventory,
  ddl_event_trigger_inventory.enabled_relevant_event_trigger_count,
  ddl_event_trigger_inventory.inventory ddl_event_trigger_inventory,
  canonical_source_contract.*,
  replacement_constraint_contract.*,
  request_index_contract.*,
  protected_counts.*,
  gates.relations_ready
    and gates.evidence_schema_ready
    and gates.legacy_rollout_contract
    and gates.canonical_server_contract
    and gates.canonical_authority_behavior_intact
    and gates.canonical_evidence_authority_intact
    and gates.exact_rollout_inventory
    and gates.dependency_free
    and gates.browser_writes_absent
    and gates.platform_projection_acl_safe ready_for_apply
from gates
cross join manual_rpc_inventory
cross join direct_binding_state
cross join ddl_event_trigger_inventory
cross join canonical_source_contract
cross join replacement_constraint_contract
cross join request_index_contract
cross join protected_counts;

-- ============================================================================
-- APPLY (TRANSACTIONAL; DO NOT EXECUTE WITHOUT APPROVAL)
-- ============================================================================

begin;

do $$
declare
  v_legacy regprocedure := to_regprocedure(
    'public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)'
  );
  v_canonical regprocedure := to_regprocedure(
    'public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)'
  );
  v_evidence_trigger regprocedure := to_regprocedure(
    'coachfort_internal.enforce_manual_subscription_activation_audit_immutability()'
  );
  v_source text;
begin
  if v_legacy is null or v_canonical is null then
    raise exception 'UX-8G4B0B expected rollout RPC inventory is incomplete.'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'activate_tenant_subscription_manual%'
  ) <> 2 then
    raise exception 'UX-8G4B0B found an unexpected manual activation RPC.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_proc procedure
    where procedure.oid = v_legacy
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proconfig = array['search_path=public']
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'UX-8G4B0B legacy rollout metadata drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_proc procedure
    where procedure.oid = v_canonical
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proconfig = array['search_path=public, pg_temp']
      and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'UX-8G4B0B canonical authority metadata drifted.'
      using errcode = '55000';
  end if;

  select lower(pg_get_functiondef(v_canonical)) into v_source;

  if not (
    v_source like '%from public.platform_admin_users platform_actor%'
    and v_source like '%platform_actor.role in (''owner'',''admin'')%'
    and v_source like '%from public.subscription_plans plan%'
    and v_source like '%from public.subscription_plan_prices price%'
    and v_source not like '%149900%'
    and v_source not like '%599900%'
    and v_source not like '%v_plan_code in (''starter'',''growth'')%'
    and v_source like '%v_period_start + interval ''1 month''%'
    and v_source like '%v_period_start + interval ''1 year''%'
    and v_source like '%v_period_end + interval ''7 days''%'
    and v_source like '%request_fingerprint%'
    and v_source like '%extensions.digest%'
    and v_source like '%idempotent'', true%'
    and v_source like '%pg_advisory_xact_lock%'
    and v_source like '%for update%'
    and v_source like '%manual_operator_verified%'
    and v_source like '%provider_evidence'', false%'
    and v_source not like '%insert into public.tenant_payment_orders%'
    and v_source not like '%insert into public.tenant_payment_attempts%'
    and v_source not like '%insert into public.razorpay_webhook_events%'
    and v_source not like '%insert into public.tenant_plan_activation_events%'
    and v_source not like '%insert into public.invoices%'
    and v_source not like '%insert into public.platform_billing_receipts%'
    and v_source not like '%insert into public.subscriptions%'
    and v_source not like '%update public.tenants%'
    and v_source like '%insert into public.platform_tenant_subscriptions%'
    and v_source like '%projection_source%'
    and v_source like '%select count(*) into v_platform_plan_count%'
    and v_source like '%if v_platform_plan_count <> 1%'
    and v_source like '%order by platform_plan.id%'
    and v_source like '%limit 1%'
    and v_source like '%for share%'
    and v_source like '%v_has_commercial_assignment_history%'
    and v_source like '%assignment.status <> ''trial''%'
    and v_source like '%assignment.payment_status <> ''not_required''%'
    and v_source like
      '%canonical renewal or plan-change authority is required%'
    and v_source not like
      '%v_current.status in (''cancelled'',''suspended'',''expired'')%'
    and v_source not like
      '%v_lifecycle->>''reason'' = ''grace_period_elapsed''%'
    and v_source like '%v_current.status <> ''trial''%'
    and v_source like '%v_current.payment_status <> ''not_required''%'
    and v_source like '%v_current.trial_started_at is null%'
    and v_source like '%v_current.trial_ends_at is null%'
    and v_source like '%v_current.current_period_start is not null%'
    and v_source like '%v_current.current_period_end is not null%'
    and v_source like '%v_current.grace_period_ends_at is not null%'
    and v_source like '%(''within_trial_period'',''trial_period_elapsed'')%'
  ) then
    raise exception 'UX-8G4B0B canonical authority behavior drifted.'
      using errcode = '55000';
  end if;

  if v_evidence_trigger is null or not exists (
    select 1 from pg_proc procedure
    where procedure.oid = v_evidence_trigger
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proconfig = array['search_path=public, pg_temp']
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
  ) or not exists (
    select 1 from pg_trigger trigger_def
    where trigger_def.tgrelid =
        'public.manual_subscription_activation_audits'::regclass
      and trigger_def.tgname =
        'enforce_manual_subscription_activation_audit_immutability'
      and trigger_def.tgfoid = v_evidence_trigger
      and not trigger_def.tgisinternal
  ) then
    raise exception 'UX-8G4B0B immutable evidence authority drifted.'
      using errcode = '55000';
  end if;

  if not (
    with expected(
      constraint_name, expected_columns, expected_expression,
      expected_root, expected_and_nodes
    ) as (
      values
        ('manual_subscription_activation_audits_plan_code_format_check',
          array['plan_code']::text[],
          'plan_code~''^[a-z0-9][a-z0-9_-]{0,63}$''::text', 'operator', 0),
        ('manual_subscription_activation_audits_legacy_plan_format_check',
          array['legacy_plan']::text[],
          'legacy_planISNULLORlegacy_plan~''^[a-z0-9][a-z0-9_-]{0,63}$''::text',
          'or', 0),
        ('manual_subscription_activation_audits_currency_format_check',
          array['currency']::text[], 'currency~''^[A-Z]{3}$''::text',
          'operator', 0),
        ('manual_subscription_activation_audits_request_fingerprint_check',
          array['request_fingerprint']::text[],
          'request_fingerprintISNULLORrequest_fingerprint~''^[0-9a-f]{64}$''::text',
          'or', 0),
        ('manual_subscription_activation_audits_evidence_kind_check',
          array['payment_evidence_kind']::text[],
          'payment_evidence_kindISNULLORpayment_evidence_kind=''manual_operator_verified''::text',
          'or', 0),
        ('manual_subscription_activation_audits_canonical_request_check',
          array[
            'activation_status','assignment_id','idempotency_key','legacy_plan',
            'payment_evidence_kind','plan_id','platform_subscription_id',
            'price_id','request_fingerprint','request_id'
          ]::text[],
          'request_idISNULLANDrequest_fingerprintISNULLANDplan_idISNULLANDprice_idISNULLANDpayment_evidence_kindISNULLORrequest_idISNOTNULLANDrequest_fingerprintISNOTNULLANDplan_idISNOTNULLANDprice_idISNOTNULLANDpayment_evidence_kind=''manual_operator_verified''::textANDidempotency_key=request_id::textANDassignment_idISNOTNULLANDplatform_subscription_idISNOTNULLANDactivation_status=''activated''::textANDlegacy_planISNULL',
          'or', 2)
    ), actual as (
      select
        expected.*,
        constraint_def.oid,
        constraint_def.contype,
        constraint_def.convalidated,
        constraint_def.conislocal,
        constraint_def.coninhcount,
        constraint_def.connoinherit,
        regexp_replace(pg_get_expr(
          constraint_def.conbin, constraint_def.conrelid, true
        ), '[()[:space:]]+', '', 'g') compact_expression,
        case
          when constraint_def.conbin::text like
            '{BOOLEXPR :boolop or %' then 'or'
          when constraint_def.conbin::text like '{OPEXPR %' then 'operator'
          else 'other'
        end expression_root,
        (
          length(constraint_def.conbin::text)
          - length(replace(constraint_def.conbin::text, ':boolop and', ''))
        ) / length(':boolop and') and_node_count,
        array(
          select attribute.attname::text
          from unnest(constraint_def.conkey) key_column(attnum)
          join pg_attribute attribute
            on attribute.attrelid = constraint_def.conrelid
           and attribute.attnum = key_column.attnum
           and not attribute.attisdropped
          order by attribute.attname::text
        ) actual_columns
      from expected
      left join pg_constraint constraint_def
        on constraint_def.conrelid =
            'public.manual_subscription_activation_audits'::regclass
       and constraint_def.conname = expected.constraint_name
    )
    select count(*) = 6
      and count(oid) = 6
      and coalesce(bool_and(
        contype = 'c'
        and convalidated
        and conislocal
        and coninhcount = 0
        and not connoinherit
        and actual_columns = expected_columns
        and compact_expression = expected_expression
        and expression_root = expected_root
        and and_node_count = expected_and_nodes
      ), false)
    from actual
  ) then
    raise exception 'UX-8G4B0B evidence CHECK authority drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_index index_def
    join pg_class index_relation on index_relation.oid = index_def.indexrelid
    join pg_attribute request_column
      on request_column.attrelid = index_def.indrelid
     and request_column.attname = 'request_id'
     and request_column.attnum > 0
     and not request_column.attisdropped
    where index_relation.oid = to_regclass(
        'public.manual_subscription_activation_audits_request_id_uidx'
      )
      and index_def.indrelid =
        'public.manual_subscription_activation_audits'::regclass
      and index_def.indisunique
      and index_def.indisvalid
      and index_def.indisready
      and index_def.indislive
      and index_def.indnkeyatts = 1
      and index_def.indnatts = 1
      and index_def.indexprs is null
      and index_def.indkey[0] = request_column.attnum
      and index_def.indpred is not null
      and regexp_replace(pg_get_expr(
        index_def.indpred, index_def.indrelid, true
      ), '[()[:space:]]+', '', 'g') = 'request_idISNOTNULL'
  ) then
    raise exception 'UX-8G4B0B request identity index drifted.'
      using errcode = '55000';
  end if;

  if not coalesce((
    select relation.relrowsecurity
    from pg_class relation
    where relation.oid =
      'public.manual_subscription_activation_audits'::regclass
  ), false) or (
    select count(*)
    from information_schema.columns column_def
    where column_def.table_schema = 'public'
      and column_def.table_name = 'manual_subscription_activation_audits'
      and column_def.column_name in (
        'request_id','request_fingerprint','plan_id','price_id',
        'payment_evidence_kind'
      )
  ) <> 5 or not exists (
    select 1 from information_schema.columns column_def
    where column_def.table_schema = 'public'
      and column_def.table_name = 'manual_subscription_activation_audits'
      and column_def.column_name = 'legacy_plan'
      and column_def.is_nullable = 'YES'
  ) or exists (
    select 1 from pg_constraint constraint_def
    where constraint_def.conrelid =
        'public.manual_subscription_activation_audits'::regclass
      and constraint_def.conname in (
        'manual_subscription_activation_audits_plan_code_check',
        'manual_subscription_activation_audits_legacy_plan_check',
        'manual_subscription_activation_audits_currency_check'
      )
  ) or not exists (
    select 1 from pg_constraint constraint_def
    where constraint_def.conrelid =
        'public.manual_subscription_activation_audits'::regclass
      and constraint_def.conname =
        'manual_subscription_activation_audits_idempotency_key_unique'
      and constraint_def.contype = 'u'
      and pg_get_constraintdef(constraint_def.oid) =
        'UNIQUE (idempotency_key)'
  ) or not exists (
    select 1 from pg_constraint constraint_def
    where constraint_def.conrelid =
        'public.manual_subscription_activation_audits'::regclass
      and constraint_def.conname =
        'manual_subscription_activation_audits_payment_reference_unique'
      and constraint_def.contype = 'u'
      and pg_get_constraintdef(constraint_def.oid) =
        'UNIQUE (payment_reference_normalized)'
  ) then
    raise exception 'UX-8G4B0B evidence relation authority drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_depend dependency
    where dependency.refclassid = 'pg_proc'::regclass
      and dependency.refobjid = v_legacy
  ) or exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.oid <> v_legacy
      and lower(procedure.prosrc) ~
        '(^|[^a-z0-9_])activate_tenant_subscription_manual[[:space:]]*[(]'
  ) or exists (
    select 1 from pg_trigger trigger_def where trigger_def.tgfoid = v_legacy
  ) then
    raise exception 'UX-8G4B0B legacy authority has a live dependency.'
      using errcode = '2BP01';
  end if;

  if exists (
    select 1 from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'manual_subscription_activation_audits',
        'tenant_subscription_assignments',
        'subscription_plan_prices',
        'platform_tenant_subscriptions'
      )
      and privilege.grantee in ('PUBLIC','anon','authenticated')
      and privilege.privilege_type in (
        'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
      )
  ) or not exists (
    select 1 from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'platform_tenant_subscriptions'
      and privilege.grantee = 'authenticated'
      and privilege.privilege_type = 'SELECT'
      and privilege.is_grantable = 'NO'
  ) then
    raise exception 'UX-8G4B0B browser or projection ACL drifted.'
      using errcode = '55000';
  end if;
end
$$;

create temporary table ux8g4b0b_canonical_baseline
on commit drop
as
select jsonb_build_object(
  'identity', procedure.oid::regprocedure::text,
  'owner', pg_get_userbyid(procedure.proowner),
  'acl', coalesce(procedure.proacl::text, ''),
  'security_definer', procedure.prosecdef,
  'volatility', procedure.provolatile,
  'strict', procedure.proisstrict,
  'parallel', procedure.proparallel,
  'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb),
  'definition', pg_get_functiondef(procedure.oid)
) contract
from pg_proc procedure
where procedure.oid = to_regprocedure(
  'public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)'
);

create temporary table ux8g4b0b_evidence_baseline
on commit drop
as
select jsonb_build_object(
  'relation', (
    select jsonb_build_object(
      'rls', relation.relrowsecurity,
      'force_rls', relation.relforcerowsecurity,
      'acl', coalesce(relation.relacl::text, '')
    )
    from pg_class relation
    where relation.oid =
      'public.manual_subscription_activation_audits'::regclass
  ),
  'trigger', (
    select jsonb_agg(jsonb_build_object(
      'name', trigger_def.tgname,
      'function', trigger_def.tgfoid::regprocedure::text,
      'definition', pg_get_triggerdef(trigger_def.oid)
    ) order by trigger_def.tgname)
    from pg_trigger trigger_def
    where trigger_def.tgrelid =
        'public.manual_subscription_activation_audits'::regclass
      and not trigger_def.tgisinternal
  ),
  'constraints', (
    select jsonb_agg(jsonb_build_object(
      'name', constraint_def.conname,
      'definition', pg_get_constraintdef(constraint_def.oid)
    ) order by constraint_def.conname)
    from pg_constraint constraint_def
    where constraint_def.conrelid =
      'public.manual_subscription_activation_audits'::regclass
  ),
  'indexes', (
    select jsonb_agg(jsonb_build_object(
      'name', index_relation.relname,
      'definition', pg_get_indexdef(index_def.indexrelid),
      'valid', index_def.indisvalid,
      'ready', index_def.indisready,
      'live', index_def.indislive
    ) order by index_relation.relname)
    from pg_index index_def
    join pg_class index_relation on index_relation.oid = index_def.indexrelid
    where index_def.indrelid =
      'public.manual_subscription_activation_audits'::regclass
  ),
  'guarded_acl', (
    select jsonb_agg(to_jsonb(privilege) order by privilege.table_name,
      privilege.grantee, privilege.privilege_type)
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'manual_subscription_activation_audits',
        'tenant_subscription_assignments',
        'subscription_plan_prices',
        'platform_tenant_subscriptions'
      )
      and privilege.grantee in ('PUBLIC','anon','authenticated')
  )
) contract;

create temporary table ux8g4b0b_protected_baseline
on commit drop
as
select jsonb_build_object(
  'tenants', (select count(*) from public.tenants),
  'tenant_subscription_assignments',
    (select count(*) from public.tenant_subscription_assignments),
  'manual_subscription_activation_audits',
    (select count(*) from public.manual_subscription_activation_audits),
  'platform_tenant_subscriptions',
    (select count(*) from public.platform_tenant_subscriptions),
  'subscriptions', (select count(*) from public.subscriptions),
  'tenant_payment_orders', (select count(*) from public.tenant_payment_orders),
  'tenant_payment_attempts',
    (select count(*) from public.tenant_payment_attempts),
  'razorpay_webhook_events',
    (select count(*) from public.razorpay_webhook_events),
  'tenant_plan_activation_events',
    (select count(*) from public.tenant_plan_activation_events),
  'tenant_subscription_change_intents',
    (select count(*) from public.tenant_subscription_change_intents),
  'invoices', (select count(*) from public.invoices),
  'platform_billing_receipts',
    (select count(*) from public.platform_billing_receipts)
) contract;

drop function public.activate_tenant_subscription_manual(
  uuid,text,text,text,bigint,text,
  timestamptz,timestamptz,text,text,timestamptz,
  text,text,timestamptz,text,text,boolean
) restrict;

do $$
declare
  v_canonical regprocedure := to_regprocedure(
    'public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)'
  );
  v_canonical_contract jsonb;
  v_evidence_contract jsonb;
  v_protected_contract jsonb;
begin
  if to_regprocedure(
    'public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)'
  ) is not null or v_canonical is null then
    raise exception 'UX-8G4B0B final RPC inventory is not exact.'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'activate_tenant_subscription_manual%'
  ) <> 1 then
    raise exception 'UX-8G4B0B alternate manual activation authority remains.'
      using errcode = '55000';
  end if;

  select jsonb_build_object(
    'identity', procedure.oid::regprocedure::text,
    'owner', pg_get_userbyid(procedure.proowner),
    'acl', coalesce(procedure.proacl::text, ''),
    'security_definer', procedure.prosecdef,
    'volatility', procedure.provolatile,
    'strict', procedure.proisstrict,
    'parallel', procedure.proparallel,
    'config', coalesce(to_jsonb(procedure.proconfig), '[]'::jsonb),
    'definition', pg_get_functiondef(procedure.oid)
  ) into v_canonical_contract
  from pg_proc procedure
  where procedure.oid = v_canonical;

  if not exists (
    select 1 from ux8g4b0b_canonical_baseline baseline
    where baseline.contract = v_canonical_contract
  ) then
    raise exception 'UX-8G4B0B changed the canonical manual authority.'
      using errcode = '55000';
  end if;

  select jsonb_build_object(
    'relation', (
      select jsonb_build_object(
        'rls', relation.relrowsecurity,
        'force_rls', relation.relforcerowsecurity,
        'acl', coalesce(relation.relacl::text, '')
      )
      from pg_class relation
      where relation.oid =
        'public.manual_subscription_activation_audits'::regclass
    ),
    'trigger', (
      select jsonb_agg(jsonb_build_object(
        'name', trigger_def.tgname,
        'function', trigger_def.tgfoid::regprocedure::text,
        'definition', pg_get_triggerdef(trigger_def.oid)
      ) order by trigger_def.tgname)
      from pg_trigger trigger_def
      where trigger_def.tgrelid =
          'public.manual_subscription_activation_audits'::regclass
        and not trigger_def.tgisinternal
    ),
    'constraints', (
      select jsonb_agg(jsonb_build_object(
        'name', constraint_def.conname,
        'definition', pg_get_constraintdef(constraint_def.oid)
      ) order by constraint_def.conname)
      from pg_constraint constraint_def
      where constraint_def.conrelid =
        'public.manual_subscription_activation_audits'::regclass
    ),
    'indexes', (
      select jsonb_agg(jsonb_build_object(
        'name', index_relation.relname,
        'definition', pg_get_indexdef(index_def.indexrelid),
        'valid', index_def.indisvalid,
        'ready', index_def.indisready,
        'live', index_def.indislive
      ) order by index_relation.relname)
      from pg_index index_def
      join pg_class index_relation on index_relation.oid = index_def.indexrelid
      where index_def.indrelid =
        'public.manual_subscription_activation_audits'::regclass
    ),
    'guarded_acl', (
      select jsonb_agg(to_jsonb(privilege) order by privilege.table_name,
        privilege.grantee, privilege.privilege_type)
      from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name in (
          'manual_subscription_activation_audits',
          'tenant_subscription_assignments',
          'subscription_plan_prices',
          'platform_tenant_subscriptions'
        )
        and privilege.grantee in ('PUBLIC','anon','authenticated')
    )
  ) into v_evidence_contract;

  if not exists (
    select 1 from ux8g4b0b_evidence_baseline baseline
    where baseline.contract = v_evidence_contract
  ) then
    raise exception 'UX-8G4B0B changed canonical evidence authority.'
      using errcode = '55000';
  end if;

  select jsonb_build_object(
    'tenants', (select count(*) from public.tenants),
    'tenant_subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'manual_subscription_activation_audits',
      (select count(*) from public.manual_subscription_activation_audits),
    'platform_tenant_subscriptions',
      (select count(*) from public.platform_tenant_subscriptions),
    'subscriptions', (select count(*) from public.subscriptions),
    'tenant_payment_orders', (select count(*) from public.tenant_payment_orders),
    'tenant_payment_attempts',
      (select count(*) from public.tenant_payment_attempts),
    'razorpay_webhook_events',
      (select count(*) from public.razorpay_webhook_events),
    'tenant_plan_activation_events',
      (select count(*) from public.tenant_plan_activation_events),
    'tenant_subscription_change_intents',
      (select count(*) from public.tenant_subscription_change_intents),
    'invoices', (select count(*) from public.invoices),
    'platform_billing_receipts',
      (select count(*) from public.platform_billing_receipts)
  ) into v_protected_contract;

  if not exists (
    select 1 from ux8g4b0b_protected_baseline baseline
    where baseline.contract = v_protected_contract
  ) then
    raise exception 'UX-8G4B0B changed protected business or financial rows.'
      using errcode = '55000';
  end if;

  if not has_function_privilege('service_role', v_canonical, 'EXECUTE')
     or has_function_privilege('authenticated', v_canonical, 'EXECUTE')
     or has_function_privilege('anon', v_canonical, 'EXECUTE')
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = v_canonical
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'UX-8G4B0B canonical authority ACL drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'platform_tenant_subscriptions'
      and privilege.grantee = 'authenticated'
      and privilege.privilege_type = 'SELECT'
      and privilege.is_grantable = 'NO'
  ) or exists (
    select 1 from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in (
        'manual_subscription_activation_audits',
        'tenant_subscription_assignments',
        'subscription_plan_prices',
        'platform_tenant_subscriptions'
      )
      and privilege.grantee in ('PUBLIC','anon','authenticated')
      and privilege.privilege_type in (
        'REFERENCES','TRIGGER','TRUNCATE','INSERT','UPDATE','DELETE','MAINTAIN'
      )
  ) then
    raise exception 'UX-8G4B0B browser or platform projection ACL drifted.'
      using errcode = '55000';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- POST-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with identities as (
  select
    to_regprocedure(
      'public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)'
    ) legacy_rpc,
    to_regprocedure(
      'public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)'
    ) canonical_rpc,
    to_regprocedure(
      'coachfort_internal.enforce_manual_subscription_activation_audit_immutability()'
    ) evidence_trigger
), manual_rpc_inventory as (
  select
    count(*) total_count,
    count(*) filter (where procedure.oid = identities.canonical_rpc)
      canonical_count,
    coalesce(jsonb_agg(
      procedure.oid::regprocedure::text
      order by procedure.oid::regprocedure::text
    ), '[]'::jsonb) identities
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join identities
  where namespace.nspname = 'public'
    and procedure.proname like 'activate_tenant_subscription_manual%'
), canonical_contract as (
  select
    count(procedure.oid) = 1 exact_identity,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false)
      owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(
      procedure.proconfig = array['search_path=public, pg_temp']
    ), false) fixed_search_path,
    coalesce(bool_and(
      has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ), false) service_execute,
    coalesce(bool_and(
      not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    ), false) authenticated_execute_absent,
    coalesce(bool_and(
      not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    ), false) anon_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent,
    coalesce(max(pg_get_functiondef(procedure.oid)), '') source
  from identities
  left join pg_proc procedure on procedure.oid = identities.canonical_rpc
), canonical_source_contract as (
  select
    normalized_source like '%from public.platform_admin_users platform_actor%'
      actor_revalidation,
    normalized_source like '%platform_actor.role in (''owner'',''admin'')%'
      actor_role_revalidation,
    normalized_source like '%from public.subscription_plans plan%'
      canonical_plan,
    normalized_source like '%from public.subscription_plan_prices price%'
      canonical_price,
    normalized_source not like '%149900%'
      and normalized_source not like '%599900%' no_hardcoded_price,
    normalized_source not like '%v_plan_code in (''starter'',''growth'')%'
      no_hardcoded_plan_mapping,
    normalized_source like '%v_period_start + interval ''1 month''%'
      and normalized_source like '%v_period_start + interval ''1 year''%'
      database_period_derivation,
    normalized_source like '%v_period_end + interval ''7 days''%'
      exact_grace_derivation,
    normalized_source like '%request_fingerprint%'
      and normalized_source like '%extensions.digest%'
      and normalized_source like '%idempotent'', true%' durable_idempotency,
    normalized_source like '%pg_advisory_xact_lock%'
      and normalized_source like '%for update%' concurrency_safe,
    normalized_source like '%manual_operator_verified%'
      and normalized_source like '%provider_evidence'', false%'
      manual_evidence_distinct,
    normalized_source not like '%insert into public.tenant_payment_orders%'
      and normalized_source not like
        '%insert into public.tenant_payment_attempts%'
      and normalized_source not like
        '%insert into public.razorpay_webhook_events%'
      and normalized_source not like
        '%insert into public.tenant_plan_activation_events%'
      and normalized_source not like '%insert into public.invoices%'
      and normalized_source not like
        '%insert into public.platform_billing_receipts%'
      no_provider_or_document_fabrication,
    normalized_source not like '%insert into public.subscriptions%'
      and normalized_source not like '%update public.tenants%'
      obsolete_legacy_writes_absent,
    normalized_source like
        '%insert into public.platform_tenant_subscriptions%'
      and normalized_source like '%projection_source%'
      required_platform_projection,
    normalized_source like
        '%select count(*) into v_platform_plan_count%'
      and normalized_source like '%if v_platform_plan_count <> 1%'
      and normalized_source like '%order by platform_plan.id%'
      and normalized_source like '%limit 1%'
      and normalized_source like '%for share%'
      deterministic_platform_projection,
    normalized_source like '%v_has_commercial_assignment_history%'
      and normalized_source like '%assignment.status <> ''trial''%'
      and normalized_source like
        '%assignment.payment_status <> ''not_required''%'
      and normalized_source like
        '%canonical renewal or plan-change authority is required%'
      and normalized_source not like
        '%v_current.status in (''cancelled'',''suspended'',''expired'')%'
      and normalized_source not like
        '%v_lifecycle->>''reason'' = ''grace_period_elapsed''%'
      paid_renewal_shadow_absent,
    normalized_source like '%v_current.status <> ''trial''%'
      and normalized_source like
        '%v_current.payment_status <> ''not_required''%'
      and normalized_source like '%v_current.trial_started_at is null%'
      and normalized_source like '%v_current.trial_ends_at is null%'
      and normalized_source like
        '%v_current.current_period_start is not null%'
      and normalized_source like
        '%v_current.current_period_end is not null%'
      and normalized_source like
        '%v_current.grace_period_ends_at is not null%'
      and normalized_source like
        '%(''within_trial_period'',''trial_period_elapsed'')%'
      trial_conversion_only
  from (
    select lower(source) normalized_source from canonical_contract
  ) normalized_contract
), evidence_trigger_contract as (
  select
    count(trigger_def.oid) = 1 exact_trigger,
    coalesce(bool_and(
      trigger_def.tgfoid = identities.evidence_trigger
    ), false) correct_binding
  from identities
  left join pg_trigger trigger_def
    on trigger_def.tgrelid =
        to_regclass('public.manual_subscription_activation_audits')
   and trigger_def.tgname =
       'enforce_manual_subscription_activation_audit_immutability'
   and not trigger_def.tgisinternal
), evidence_trigger_function_contract as (
  select
    count(procedure.oid) = 1 exact_function,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false)
      owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(
      procedure.proconfig = array['search_path=public, pg_temp']
    ), false) fixed_search_path,
    coalesce(bool_and(
      not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ), false) service_execute_absent,
    coalesce(bool_and(
      not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    ), false) authenticated_execute_absent,
    coalesce(bool_and(
      not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    ), false) anon_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent
  from identities
  left join pg_proc procedure on procedure.oid = identities.evidence_trigger
), expected_replacement_constraints(
  constraint_name,
  expected_columns,
  expected_expression,
  expected_root,
  expected_and_nodes
) as (
  values
    ('manual_subscription_activation_audits_plan_code_format_check',
      array['plan_code']::text[],
      'plan_code~''^[a-z0-9][a-z0-9_-]{0,63}$''::text', 'operator', 0),
    ('manual_subscription_activation_audits_legacy_plan_format_check',
      array['legacy_plan']::text[],
      'legacy_planISNULLORlegacy_plan~''^[a-z0-9][a-z0-9_-]{0,63}$''::text',
      'or', 0),
    ('manual_subscription_activation_audits_currency_format_check',
      array['currency']::text[], 'currency~''^[A-Z]{3}$''::text',
      'operator', 0),
    ('manual_subscription_activation_audits_request_fingerprint_check',
      array['request_fingerprint']::text[],
      'request_fingerprintISNULLORrequest_fingerprint~''^[0-9a-f]{64}$''::text',
      'or', 0),
    ('manual_subscription_activation_audits_evidence_kind_check',
      array['payment_evidence_kind']::text[],
      'payment_evidence_kindISNULLORpayment_evidence_kind=''manual_operator_verified''::text',
      'or', 0),
    ('manual_subscription_activation_audits_canonical_request_check',
      array[
        'activation_status','assignment_id','idempotency_key','legacy_plan',
        'payment_evidence_kind','plan_id','platform_subscription_id','price_id',
        'request_fingerprint','request_id'
      ]::text[],
      'request_idISNULLANDrequest_fingerprintISNULLANDplan_idISNULLANDprice_idISNULLANDpayment_evidence_kindISNULLORrequest_idISNOTNULLANDrequest_fingerprintISNOTNULLANDplan_idISNOTNULLANDprice_idISNOTNULLANDpayment_evidence_kind=''manual_operator_verified''::textANDidempotency_key=request_id::textANDassignment_idISNOTNULLANDplatform_subscription_idISNOTNULLANDactivation_status=''activated''::textANDlegacy_planISNULL',
      'or', 2)
), replacement_constraint_catalog as (
  select
    expected.*,
    constraint_def.oid,
    constraint_def.contype,
    constraint_def.convalidated,
    constraint_def.conislocal,
    constraint_def.coninhcount,
    constraint_def.connoinherit,
    regexp_replace(pg_get_expr(
      constraint_def.conbin, constraint_def.conrelid, true
    ), '[()[:space:]]+', '', 'g') compact_expression,
    case
      when constraint_def.conbin::text like '{BOOLEXPR :boolop or %' then 'or'
      when constraint_def.conbin::text like '{OPEXPR %' then 'operator'
      else 'other'
    end expression_root,
    (
      length(constraint_def.conbin::text)
      - length(replace(constraint_def.conbin::text, ':boolop and', ''))
    ) / length(':boolop and') and_node_count,
    array(
      select attribute.attname::text
      from unnest(constraint_def.conkey) key_column(attnum)
      join pg_attribute attribute
        on attribute.attrelid = constraint_def.conrelid
       and attribute.attnum = key_column.attnum
       and not attribute.attisdropped
      order by attribute.attname::text
    ) actual_columns
  from expected_replacement_constraints expected
  left join pg_constraint constraint_def
    on constraint_def.conrelid =
        to_regclass('public.manual_subscription_activation_audits')
   and constraint_def.conname = expected.constraint_name
), replacement_constraint_contract as (
  select
    count(*) = 6 expected_constraint_count,
    count(oid) = 6 installed_constraint_count,
    coalesce(bool_and(
      contype = 'c'
      and convalidated
      and conislocal
      and coninhcount = 0
      and not connoinherit
      and actual_columns = expected_columns
      and compact_expression = expected_expression
      and expression_root = expected_root
      and and_node_count = expected_and_nodes
    ), false) exact_contract
  from replacement_constraint_catalog
), request_index_contract as (
  select
    count(index_def.indexrelid) = 1 exact_index_count,
    coalesce(bool_and(
      index_def.indrelid =
        to_regclass('public.manual_subscription_activation_audits')
      and index_relation.relname =
        'manual_subscription_activation_audits_request_id_uidx'
      and index_def.indisunique
      and index_def.indisvalid
      and index_def.indisready
      and index_def.indislive
      and index_def.indnkeyatts = 1
      and index_def.indnatts = 1
      and index_def.indexprs is null
      and request_column.attnum is not null
      and index_def.indkey[0] = request_column.attnum
      and index_def.indpred is not null
      and regexp_replace(pg_get_expr(
        index_def.indpred, index_def.indrelid, true
      ), '[()[:space:]]+', '', 'g') = 'request_idISNOTNULL'
    ), false) exact_contract
  from pg_class index_relation
  left join pg_index index_def on index_def.indexrelid = index_relation.oid
  left join pg_attribute request_column
    on request_column.attrelid =
        to_regclass('public.manual_subscription_activation_audits')
   and request_column.attname = 'request_id'
   and request_column.attnum > 0
   and not request_column.attisdropped
  where index_relation.oid = to_regclass(
    'public.manual_subscription_activation_audits_request_id_uidx'
  )
), evidence_relation_contract as (
  select
    count(*) filter (where column_name in (
      'request_id','request_fingerprint','plan_id','price_id',
      'payment_evidence_kind'
    )) = 5 canonical_columns,
    count(*) filter (
      where column_name = 'legacy_plan' and is_nullable = 'YES'
    ) = 1 legacy_plan_nullable,
    coalesce((select relrowsecurity from pg_class
      where oid = to_regclass(
        'public.manual_subscription_activation_audits'
      )), false) rls_enabled,
    not exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid =
          to_regclass('public.manual_subscription_activation_audits')
        and constraint_def.conname in (
          'manual_subscription_activation_audits_plan_code_check',
          'manual_subscription_activation_audits_legacy_plan_check',
          'manual_subscription_activation_audits_currency_check'
        )
    ) legacy_constraints_absent,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid =
          to_regclass('public.manual_subscription_activation_audits')
        and constraint_def.conname =
          'manual_subscription_activation_audits_idempotency_key_unique'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) =
          'UNIQUE (idempotency_key)'
    ) idempotency_key_unique,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid =
          to_regclass('public.manual_subscription_activation_audits')
        and constraint_def.conname =
          'manual_subscription_activation_audits_payment_reference_unique'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) =
          'UNIQUE (payment_reference_normalized)'
    ) payment_reference_normalized_unique
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_subscription_activation_audits'
), alternate_source_references as (
  select procedure.oid::regprocedure::text identity
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where lower(procedure.prosrc) ~
    '(^|[^a-z0-9_])activate_tenant_subscription_manual[[:space:]]*[(]'
), required_evidence_columns(column_name) as (
  values
    ('id'), ('tenant_id'), ('assignment_id'), ('platform_subscription_id'),
    ('idempotency_key'), ('request_id'), ('request_fingerprint'),
    ('payment_reference'), ('payment_reference_normalized'), ('customer_email'),
    ('plan_id'), ('price_id'), ('plan_code'), ('legacy_plan'),
    ('billing_cycle'), ('amount_minor'), ('currency'), ('subscription_start'),
    ('subscription_end'), ('payment_method'), ('payment_verified_at'),
    ('payment_evidence_kind'), ('founder_approval'), ('support_tier'),
    ('operator_note'), ('activation_status'), ('request_payload_json'),
    ('result_json'), ('metadata_json'), ('created_by'), ('created_at')
), historical_evidence_state as (
  select
    to_regclass('public.manual_subscription_activation_audits') is not null
      evidence_table_present,
    count(*) expected_column_count,
    count(column_def.column_name) installed_column_count
  from required_evidence_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = 'manual_subscription_activation_audits'
   and column_def.column_name = expected.column_name
), browser_write_state as (
  select count(*) browser_dangerous_grants
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name in (
      'manual_subscription_activation_audits',
      'tenant_subscription_assignments',
      'subscription_plan_prices',
      'platform_tenant_subscriptions'
    )
    and privilege.grantee in ('PUBLIC','anon','authenticated')
    and privilege.privilege_type in (
      'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
    )
), platform_projection_acl_state as (
  select
    exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'platform_tenant_subscriptions'
        and privilege.grantee = 'authenticated'
        and privilege.privilege_type = 'SELECT'
        and privilege.is_grantable = 'NO'
    ) authenticated_select_present,
    not exists (
      select 1 from information_schema.table_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'platform_tenant_subscriptions'
        and privilege.grantee in ('PUBLIC','anon','authenticated')
        and privilege.privilege_type in (
          'REFERENCES','TRIGGER','TRUNCATE','INSERT','UPDATE','DELETE','MAINTAIN'
        )
    ) browser_unsafe_absent
), protected_counts as (
  select
    (select count(*) from public.tenants) tenants,
    (select count(*) from public.tenant_subscription_assignments)
      tenant_subscription_assignments,
    (select count(*) from public.manual_subscription_activation_audits)
      manual_subscription_activation_audits,
    (select count(*) from public.platform_tenant_subscriptions)
      platform_tenant_subscriptions,
    (select count(*) from public.subscriptions) subscriptions,
    (select count(*) from public.tenant_payment_orders) tenant_payment_orders,
    (select count(*) from public.tenant_payment_attempts)
      tenant_payment_attempts,
    (select count(*) from public.razorpay_webhook_events)
      razorpay_webhook_events,
    (select count(*) from public.tenant_plan_activation_events)
      tenant_plan_activation_events,
    (select count(*) from public.tenant_subscription_change_intents)
      tenant_subscription_change_intents,
    (select count(*) from public.invoices) invoices,
    (select count(*) from public.platform_billing_receipts)
      platform_billing_receipts
), gates as (
  select
    identities.legacy_rpc is null legacy_manual_rpc_absent,
    canonical_contract.exact_identity new_manual_rpc_present,
    canonical_contract.exact_identity
      and canonical_contract.owner_is_postgres
      and canonical_contract.security_definer
      and canonical_contract.fixed_search_path new_manual_rpc_security,
    canonical_contract.service_execute
      and canonical_contract.authenticated_execute_absent
      and canonical_contract.anon_execute_absent
      and canonical_contract.public_execute_absent new_manual_rpc_server_only_acl,
    canonical_source_contract.actor_revalidation
      and canonical_source_contract.actor_role_revalidation
      and canonical_source_contract.canonical_plan
      and canonical_source_contract.canonical_price
      and canonical_source_contract.no_hardcoded_price
      and canonical_source_contract.no_hardcoded_plan_mapping
      and canonical_source_contract.database_period_derivation
      and canonical_source_contract.exact_grace_derivation
      and canonical_source_contract.durable_idempotency
      and canonical_source_contract.concurrency_safe
      and canonical_source_contract.manual_evidence_distinct
      and canonical_source_contract.no_provider_or_document_fabrication
      and canonical_source_contract.obsolete_legacy_writes_absent
      and canonical_source_contract.required_platform_projection
      and canonical_source_contract.deterministic_platform_projection
      and canonical_source_contract.paid_renewal_shadow_absent
      and canonical_source_contract.trial_conversion_only
      canonical_authority_behavior_intact,
    evidence_trigger_contract.exact_trigger
      and evidence_trigger_contract.correct_binding
      and evidence_trigger_function_contract.exact_function
      and evidence_trigger_function_contract.owner_is_postgres
      and evidence_trigger_function_contract.security_definer
      and evidence_trigger_function_contract.fixed_search_path
      and evidence_trigger_function_contract.service_execute_absent
      and evidence_trigger_function_contract.authenticated_execute_absent
      and evidence_trigger_function_contract.anon_execute_absent
      and evidence_trigger_function_contract.public_execute_absent
      and replacement_constraint_contract.expected_constraint_count
      and replacement_constraint_contract.installed_constraint_count
      and replacement_constraint_contract.exact_contract
      and request_index_contract.exact_index_count
      and request_index_contract.exact_contract
      and evidence_relation_contract.canonical_columns
      and evidence_relation_contract.legacy_plan_nullable
      and evidence_relation_contract.rls_enabled
      and evidence_relation_contract.legacy_constraints_absent
      and evidence_relation_contract.idempotency_key_unique
      and evidence_relation_contract.payment_reference_normalized_unique
      canonical_evidence_authority_intact,
    manual_rpc_inventory.total_count = 1
      and manual_rpc_inventory.canonical_count = 1
      and not exists (select 1 from alternate_source_references)
      no_alternate_manual_activation_authority,
    browser_write_state.browser_dangerous_grants = 0 browser_writes_absent,
    platform_projection_acl_state.authenticated_select_present
      and platform_projection_acl_state.browser_unsafe_absent
      platform_projection_acl_safe,
    historical_evidence_state.evidence_table_present
      and historical_evidence_state.expected_column_count =
          historical_evidence_state.installed_column_count
      historical_evidence_preserved
  from identities
  cross join canonical_contract
  cross join canonical_source_contract
  cross join evidence_trigger_contract
  cross join evidence_trigger_function_contract
  cross join replacement_constraint_contract
  cross join request_index_contract
  cross join evidence_relation_contract
  cross join manual_rpc_inventory
  cross join browser_write_state
  cross join platform_projection_acl_state
  cross join historical_evidence_state
)
select
  1::integer verification_row_count,
  gates.*,
  manual_rpc_inventory.identities manual_rpc_inventory,
  canonical_source_contract.*,
  replacement_constraint_contract.*,
  request_index_contract.*,
  historical_evidence_state.expected_column_count evidence_expected_columns,
  historical_evidence_state.installed_column_count evidence_installed_columns,
  protected_counts.*,
  gates.legacy_manual_rpc_absent
    and gates.new_manual_rpc_present
    and gates.new_manual_rpc_security
    and gates.new_manual_rpc_server_only_acl
    and gates.canonical_authority_behavior_intact
    and gates.canonical_evidence_authority_intact
    and gates.no_alternate_manual_activation_authority
    and gates.browser_writes_absent
    and gates.platform_projection_acl_safe
    and gates.historical_evidence_preserved security_gate
from gates
cross join manual_rpc_inventory
cross join canonical_source_contract
cross join replacement_constraint_contract
cross join request_index_contract
cross join historical_evidence_state
cross join protected_counts;
