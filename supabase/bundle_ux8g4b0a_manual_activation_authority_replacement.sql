-- Bundle UX-8G4B0A: canonical manual subscription activation replacement.
-- PRE/APPLY/POST are intentionally kept in one review artifact.
-- Do not execute without separate production approval.

-- ============================================================================
-- PRE-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.tenant_members'),
    ('public.platform_admin_users'),
    ('public.subscription_plans'),
    ('public.subscription_plan_prices'),
    ('public.tenant_subscription_assignments'),
    ('public.platform_subscription_plans'),
    ('public.platform_tenant_subscriptions'),
    ('public.manual_subscription_activation_audits'),
    ('public.platform_activity_logs'),
    ('public.audit_logs'),
    ('public.subscriptions'),
    ('public.tenant_payment_orders'),
    ('public.tenant_payment_attempts'),
    ('public.razorpay_webhook_events'),
    ('public.tenant_plan_activation_events'),
    ('public.tenant_subscription_change_intents'),
    ('public.invoices'),
    ('public.platform_billing_receipts')
),
relation_state as (
  select count(*) expected_count,
         count(to_regclass(identity)) installed_count
  from required_relations
),
required_functions(identity) as (
  values
    ('public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)'),
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'),
    ('public.platform_current_role()'),
    ('public.set_updated_at()'),
    ('extensions.digest(bytea,text)')
),
function_state as (
  select count(*) expected_count,
         count(to_regprocedure(identity)) installed_count
  from required_functions
),
required_columns(table_name, column_name, data_type) as (
  values
    ('manual_subscription_activation_audits','id','uuid'),
    ('manual_subscription_activation_audits','tenant_id','uuid'),
    ('manual_subscription_activation_audits','assignment_id','uuid'),
    ('manual_subscription_activation_audits','platform_subscription_id','uuid'),
    ('manual_subscription_activation_audits','idempotency_key','text'),
    ('manual_subscription_activation_audits','payment_reference','text'),
    ('manual_subscription_activation_audits','payment_reference_normalized','text'),
    ('manual_subscription_activation_audits','customer_email','text'),
    ('manual_subscription_activation_audits','plan_code','text'),
    ('manual_subscription_activation_audits','legacy_plan','text'),
    ('manual_subscription_activation_audits','billing_cycle','text'),
    ('manual_subscription_activation_audits','amount_minor','bigint'),
    ('manual_subscription_activation_audits','currency','text'),
    ('manual_subscription_activation_audits','subscription_start','timestamp with time zone'),
    ('manual_subscription_activation_audits','subscription_end','timestamp with time zone'),
    ('manual_subscription_activation_audits','payment_method','text'),
    ('manual_subscription_activation_audits','payment_verified_at','timestamp with time zone'),
    ('manual_subscription_activation_audits','founder_approval','text'),
    ('manual_subscription_activation_audits','support_tier','text'),
    ('manual_subscription_activation_audits','operator_note','text'),
    ('manual_subscription_activation_audits','activation_status','text'),
    ('manual_subscription_activation_audits','request_payload_json','jsonb'),
    ('manual_subscription_activation_audits','result_json','jsonb'),
    ('manual_subscription_activation_audits','metadata_json','jsonb'),
    ('manual_subscription_activation_audits','created_by','uuid'),
    ('manual_subscription_activation_audits','created_at','timestamp with time zone'),
    ('subscription_plans','id','uuid'),
    ('subscription_plans','code','text'),
    ('subscription_plans','status','text'),
    ('subscription_plan_prices','id','uuid'),
    ('subscription_plan_prices','plan_id','uuid'),
    ('subscription_plan_prices','currency','text'),
    ('subscription_plan_prices','billing_cycle','text'),
    ('subscription_plan_prices','amount_minor','bigint'),
    ('subscription_plan_prices','setup_fee_amount_minor','bigint'),
    ('subscription_plan_prices','region_code','text'),
    ('subscription_plan_prices','status','text'),
    ('subscription_plan_prices','metadata_json','jsonb'),
    ('tenant_subscription_assignments','tenant_id','uuid'),
    ('tenant_subscription_assignments','plan_id','uuid'),
    ('tenant_subscription_assignments','status','text'),
    ('tenant_subscription_assignments','billing_cycle','text'),
    ('tenant_subscription_assignments','currency','text'),
    ('tenant_subscription_assignments','trial_started_at','timestamp with time zone'),
    ('tenant_subscription_assignments','trial_ends_at','timestamp with time zone'),
    ('tenant_subscription_assignments','current_period_start','timestamp with time zone'),
    ('tenant_subscription_assignments','current_period_end','timestamp with time zone'),
    ('tenant_subscription_assignments','grace_period_ends_at','timestamp with time zone'),
    ('tenant_subscription_assignments','payment_status','text'),
    ('tenant_subscription_assignments','source','text'),
    ('tenant_subscription_assignments','is_current','boolean')
),
column_state as (
  select count(*) expected_count,
         count(column_def.column_name) installed_count
  from required_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
   and column_def.data_type = expected.data_type
),
new_column_state as (
  select count(*) filter (where column_name in (
    'request_id','request_fingerprint','plan_id','price_id','payment_evidence_kind'
  )) installed_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_subscription_activation_audits'
),
audit_constraint_state as (
  select
    count(*) filter (
      where conname = 'manual_subscription_activation_audits_idempotency_key_unique'
        and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (idempotency_key)'
    ) = 1 idempotency_unique,
    count(*) filter (
      where conname = 'manual_subscription_activation_audits_payment_reference_unique'
        and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (payment_reference_normalized)'
    ) = 1 payment_reference_normalized_unique,
    count(*) filter (
      where conname = 'manual_subscription_activation_audits_plan_code_check'
        and contype = 'c'
        and pg_get_constraintdef(oid) =
            'CHECK ((plan_code = ANY (ARRAY[''starter''::text, ''growth''::text])))'
    ) = 1 legacy_plan_code_check_exact,
    count(*) filter (
      where conname = 'manual_subscription_activation_audits_legacy_plan_check'
        and contype = 'c'
        and pg_get_constraintdef(oid) =
            'CHECK ((legacy_plan = ANY (ARRAY[''starter''::text, ''business''::text])))'
    ) = 1 legacy_mapping_check_exact,
    count(*) filter (
      where conname = 'manual_subscription_activation_audits_currency_check'
        and contype = 'c'
        and pg_get_constraintdef(oid) = 'CHECK ((currency = ''INR''::text))'
    ) = 1 legacy_currency_check_exact
  from pg_constraint
  where conrelid = to_regclass('public.manual_subscription_activation_audits')
),
legacy_column_state as (
  select count(*) = 1
    and bool_and(is_nullable = 'NO') legacy_plan_not_null
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_subscription_activation_audits'
    and column_name = 'legacy_plan'
),
legacy_rpc_contract as (
  select
    count(procedure.oid) = 1 exact_identity,
    coalesce(max(pg_get_userbyid(procedure.proowner)), '') owner_name,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false) owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(procedure.proconfig = array['search_path=public']), false) fixed_search_path,
    coalesce(bool_and(has_function_privilege('authenticated', procedure.oid, 'EXECUTE')), false) authenticated_execute,
    coalesce(bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE')), false) anon_execute_absent,
    coalesce(bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE')), false) service_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent,
    coalesce(bool_and(has_table_privilege(
      procedure.proowner,
      'public.manual_subscription_activation_audits',
      'SELECT'
    )), false) audit_select_available,
    coalesce(bool_and(has_table_privilege(
      procedure.proowner,
      'public.manual_subscription_activation_audits',
      'INSERT'
    )), false) audit_insert_available,
    coalesce(bool_and(has_table_privilege(
      procedure.proowner,
      'public.manual_subscription_activation_audits',
      'UPDATE'
    )), false) audit_row_lock_available,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like
        '%insert into public.manual_subscription_activation_audits%'
    ), false) audit_insert_present,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) not like
        '%update public.manual_subscription_activation_audits%'
    ), false) audit_update_absent,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) not like
        '%delete from public.manual_subscription_activation_audits%'
    ), false) audit_delete_absent,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like
        '%from public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like '%for update%'
    ), false) audit_replay_row_lock_present,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like '%''idempotent'', true%'
    ), false) audit_replay_returns_existing,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like
        '%insert into public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like
        '%from public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like '%for update%'
      and lower(pg_get_functiondef(procedure.oid)) like '%''idempotent'', true%'
      and lower(pg_get_functiondef(procedure.oid)) not like
        '%update public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) not like
        '%delete from public.manual_subscription_activation_audits%'
    ), false) audit_insert_and_replay_compatible
  from (values (
    to_regprocedure('public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)')
  )) identity(oid)
  left join pg_proc procedure on procedure.oid = identity.oid
),
assignment_state as (
  select exists (
    select 1
    from pg_index index_def
    where index_def.indrelid = to_regclass('public.tenant_subscription_assignments')
      and index_def.indisunique
      and pg_get_expr(index_def.indpred, index_def.indrelid) = 'is_current'
  ) one_current_assignment
),
expected_preexisting_acl(table_name, grantee, privilege_type, is_grantable) as (
  values
    ('platform_tenant_subscriptions','authenticated','SELECT','NO'),
    ('platform_tenant_subscriptions','authenticated','REFERENCES','NO'),
    ('platform_tenant_subscriptions','authenticated','TRIGGER','NO'),
    ('platform_tenant_subscriptions','authenticated','TRUNCATE','NO')
),
actual_preexisting_acl as (
  select table_name, grantee, privilege_type, is_grantable
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in (
      'manual_subscription_activation_audits',
      'tenant_subscription_assignments',
      'subscription_plan_prices',
      'platform_tenant_subscriptions'
    )
    and grantee in ('PUBLIC','anon','authenticated')
),
preexisting_acl_state as (
  select
    (select count(*) from actual_preexisting_acl) actual_grant_count,
    (select count(*) from expected_preexisting_acl) expected_grant_count,
    (select count(*) from (
      select * from expected_preexisting_acl
      except
      select * from actual_preexisting_acl
    ) missing) missing_expected_grant_count,
    (select count(*) from (
      select * from actual_preexisting_acl
      except
      select * from expected_preexisting_acl
    ) unexpected) unexpected_grant_count,
    exists (
      select 1 from actual_preexisting_acl
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'SELECT'
        and is_grantable = 'NO'
    ) authenticated_select_present,
    not exists (
      select 1 from actual_preexisting_acl
      where grantee = 'authenticated'
        and privilege_type in ('INSERT','UPDATE','DELETE','MAINTAIN')
    ) authenticated_dml_absent,
    not exists (
      select 1 from actual_preexisting_acl
      where grantee in ('PUBLIC','anon')
        and privilege_type in (
          'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
        )
    ) public_anon_dangerous_absent
),
historical_evidence_compatibility as (
  select
    count(*) filter (
      where plan_code is not null
        and plan_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ) plan_code_format_violation_count,
    count(*) filter (
      where legacy_plan is not null
        and legacy_plan !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ) legacy_plan_format_violation_count,
    count(*) filter (
      where currency is not null and currency !~ '^[A-Z]{3}$'
    ) currency_format_violation_count,
    count(*) filter (
      where payment_reference_normalized is distinct from lower(trim(payment_reference))
    ) payment_reference_normalization_violation_count
  from public.manual_subscription_activation_audits
),
normalized_payment_reference_duplicates as (
  select count(*) duplicate_normalized_reference_count
  from (
    select lower(trim(payment_reference)) normalized_reference
    from public.manual_subscription_activation_audits
    group by lower(trim(payment_reference))
    having count(*) > 1
  ) duplicates
),
commercial_schema_state as (
  select
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.subscription_plans')
        and constraint_def.conname = 'subscription_plans_code_key'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (code)'
    ) subscription_plan_code_unique,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_subscription_plans')
        and constraint_def.conname = 'platform_subscription_plans_code_key'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (code)'
    ) platform_plan_code_unique,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_tenant_subscriptions')
        and constraint_def.conname = 'platform_tenant_subscriptions_tenant_id_key'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (tenant_id)'
    ) platform_tenant_unique
),
canonical_projection_targets as (
  select distinct plan.code, price.currency
  from public.subscription_plans plan
  join public.subscription_plan_prices price on price.plan_id = plan.id
  where plan.status in ('draft','active')
    and price.status in ('draft','active')
    and price.region_code = 'GLOBAL'
    and coalesce((price.metadata_json->>'pricing_finalized')::boolean, false)
    and not coalesce((price.metadata_json->>'placeholder_price')::boolean, true)
    and not coalesce((price.metadata_json->>'contact_sales')::boolean, false)
),
platform_projection_state as (
  select
    count(*) target_count,
    count(*) filter (where matching_count = 0) missing_count,
    count(*) filter (where matching_count > 1) ambiguous_count
  from (
    select target.code, target.currency,
      (select count(*)
       from public.platform_subscription_plans platform_plan
       where platform_plan.code = target.code
         and platform_plan.status = 'active'
         and platform_plan.currency = target.currency) matching_count
    from canonical_projection_targets target
  ) targets
),
historical_manual_assignments as (
  select
    count(*) total_count,
    count(*) filter (where assignment.is_current) current_count,
    count(*) filter (where not assignment.is_current) historical_count,
    count(*) filter (
      where assignment.current_period_start is null
         or assignment.current_period_end is null
         or assignment.current_period_start >= assignment.current_period_end
    ) invalid_period_count,
    count(*) filter (
      where assignment.status in ('active','grace','past_due')
        and assignment.grace_period_ends_at is distinct from
            assignment.current_period_end + interval '7 days'
    ) noncanonical_grace_count,
    count(*) filter (
      where assignment.is_current
        and assignment.status in ('active','grace','past_due')
        and (
          assignment.current_period_start is null
          or assignment.current_period_end is null
          or assignment.current_period_start >= assignment.current_period_end
          or assignment.grace_period_ends_at is distinct from
              assignment.current_period_end + interval '7 days'
        )
    ) malformed_current_count
  from public.tenant_subscription_assignments assignment
  where assignment.source = 'platform_manual'
),
pre as (
  select
    (select expected_count = installed_count from relation_state) relations_ready,
    (select expected_count = installed_count from function_state) functions_ready,
    (select expected_count = installed_count from column_state) columns_ready,
    (select installed_count = 0 from new_column_state) clean_install_state,
    to_regprocedure('public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)') is null new_rpc_absent,
    to_regprocedure('coachfort_internal.enforce_manual_subscription_activation_audit_immutability()') is null new_trigger_helper_absent,
    (select idempotency_unique and payment_reference_normalized_unique
      and legacy_plan_code_check_exact and legacy_mapping_check_exact
      and legacy_currency_check_exact
      from audit_constraint_state) legacy_evidence_shape,
    (select legacy_plan_not_null from legacy_column_state) legacy_plan_not_null,
    (select exact_identity and owner_is_postgres and security_definer
      and fixed_search_path and authenticated_execute and anon_execute_absent
      and service_execute_absent and public_execute_absent
      and audit_select_available and audit_insert_available
      and audit_row_lock_available and audit_insert_and_replay_compatible
      from legacy_rpc_contract) legacy_rpc_rollout_compatible,
    (select one_current_assignment from assignment_state) one_current_assignment,
    (select actual_grant_count = 4
      and expected_grant_count = 4
      and missing_expected_grant_count = 0
      and unexpected_grant_count = 0
      and authenticated_select_present
      and authenticated_dml_absent
      and public_anon_dangerous_absent
      from preexisting_acl_state) expected_preexisting_acl_state,
    coalesce((select relrowsecurity from pg_class
      where oid = to_regclass('public.manual_subscription_activation_audits')), false) evidence_rls_enabled,
    (select subscription_plan_code_unique from commercial_schema_state) subscription_plan_code_unique,
    (select platform_plan_code_unique from commercial_schema_state) platform_plan_code_unique,
    (select platform_tenant_unique from commercial_schema_state) platform_tenant_unique,
    (select target_count > 0 and missing_count = 0 and ambiguous_count = 0
      from platform_projection_state) platform_projection_deterministic
)
select
  pre.*,
  audit_constraint_state.*,
  legacy_column_state.*,
  preexisting_acl_state.*,
  legacy_rpc_contract.*,
  historical_evidence_compatibility.*,
  normalized_payment_reference_duplicates.*,
  platform_projection_state.*,
  historical_manual_assignments.*,
  pre.relations_ready
    and pre.functions_ready
    and pre.columns_ready
    and pre.clean_install_state
    and pre.new_rpc_absent
    and pre.new_trigger_helper_absent
    and pre.legacy_evidence_shape
    and pre.legacy_plan_not_null
    and pre.legacy_rpc_rollout_compatible
    and pre.one_current_assignment
    and pre.expected_preexisting_acl_state
    and pre.evidence_rls_enabled
    and pre.subscription_plan_code_unique
    and pre.platform_plan_code_unique
    and pre.platform_tenant_unique
    and pre.platform_projection_deterministic
    and historical_evidence_compatibility.plan_code_format_violation_count = 0
    and historical_evidence_compatibility.legacy_plan_format_violation_count = 0
    and historical_evidence_compatibility.currency_format_violation_count = 0
    and historical_evidence_compatibility.payment_reference_normalization_violation_count = 0
    and normalized_payment_reference_duplicates.duplicate_normalized_reference_count = 0
      as ready_for_apply
from pre
cross join audit_constraint_state
cross join legacy_column_state
cross join preexisting_acl_state
cross join legacy_rpc_contract
cross join historical_evidence_compatibility
cross join normalized_payment_reference_duplicates
cross join platform_projection_state
cross join historical_manual_assignments;

-- ============================================================================
-- APPLY TRANSACTION
-- ============================================================================

begin;

do $$
declare
  v_required_column_count integer;
  v_new_column_count integer;
begin
  if to_regrole('postgres') is null or to_regrole('service_role') is null then
    raise exception 'UX-8G4B0A required database roles are missing.';
  end if;

  if to_regprocedure('public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)') is null
     or to_regprocedure('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)') is null
     or to_regprocedure('public.platform_current_role()') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'UX-8G4B0A prerequisite authority is missing.';
  end if;

  if to_regprocedure('public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)') is not null
     or to_regprocedure('coachfort_internal.enforce_manual_subscription_activation_audit_immutability()') is not null then
    raise exception 'UX-8G4B0A is already or partially installed.';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = to_regprocedure(
      'public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)'
    )
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proconfig = array['search_path=public']
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
      and has_table_privilege(
        procedure.proowner, 'public.manual_subscription_activation_audits', 'SELECT'
      )
      and has_table_privilege(
        procedure.proowner, 'public.manual_subscription_activation_audits', 'INSERT'
      )
      and has_table_privilege(
        procedure.proowner, 'public.manual_subscription_activation_audits', 'UPDATE'
      )
      and lower(pg_get_functiondef(procedure.oid)) like
        '%insert into public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like
        '%from public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like '%for update%'
      and lower(pg_get_functiondef(procedure.oid)) like '%''idempotent'', true%'
      and lower(pg_get_functiondef(procedure.oid)) not like
        '%update public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) not like
        '%delete from public.manual_subscription_activation_audits%'
  ) then
    raise exception 'UX-8G4B0A legacy RPC rollout contract is incompatible.';
  end if;

  if to_regclass('public.manual_subscription_activation_audits') is null
     or to_regclass('public.tenant_subscription_assignments') is null
     or to_regclass('public.subscription_plans') is null
     or to_regclass('public.subscription_plan_prices') is null
     or to_regclass('public.platform_tenant_subscriptions') is null then
    raise exception 'UX-8G4B0A required relation is missing.';
  end if;

  select count(*) into v_required_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_subscription_activation_audits'
    and column_name in (
      'id','tenant_id','assignment_id','platform_subscription_id',
      'idempotency_key','payment_reference','payment_reference_normalized',
      'customer_email','plan_code','legacy_plan','billing_cycle','amount_minor',
      'currency','subscription_start','subscription_end','payment_method',
      'payment_verified_at','founder_approval','support_tier','operator_note',
      'activation_status','request_payload_json','result_json','metadata_json',
      'created_by','created_at'
    );

  if v_required_column_count <> 26 then
    raise exception 'UX-8G4B0A manual evidence schema drifted.';
  end if;

  select count(*) into v_new_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_subscription_activation_audits'
    and column_name in (
      'request_id','request_fingerprint','plan_id','price_id','payment_evidence_kind'
    );

  if v_new_column_count <> 0 then
    raise exception 'UX-8G4B0A partial evidence installation detected.';
  end if;

  if not exists (
    select 1 from pg_index index_def
    where index_def.indrelid = 'public.tenant_subscription_assignments'::regclass
      and index_def.indisunique
      and pg_get_expr(index_def.indpred, index_def.indrelid) = 'is_current'
  ) then
    raise exception 'UX-8G4B0A one-current-assignment authority is missing.';
  end if;

  if not exists (
    select 1 from pg_constraint constraint_def
    where constraint_def.conrelid =
          'public.manual_subscription_activation_audits'::regclass
      and constraint_def.conname =
          'manual_subscription_activation_audits_idempotency_key_unique'
      and constraint_def.contype = 'u'
      and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (idempotency_key)'
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
    raise exception 'UX-8G4B0A legacy evidence uniqueness authority drifted.';
  end if;

  if not exists (
    select 1 from pg_constraint constraint_def
    where constraint_def.conrelid =
          'public.manual_subscription_activation_audits'::regclass
      and constraint_def.conname =
          'manual_subscription_activation_audits_plan_code_check'
      and constraint_def.contype = 'c'
      and pg_get_constraintdef(constraint_def.oid) =
          'CHECK ((plan_code = ANY (ARRAY[''starter''::text, ''growth''::text])))'
  ) or not exists (
    select 1 from pg_constraint constraint_def
    where constraint_def.conrelid =
          'public.manual_subscription_activation_audits'::regclass
      and constraint_def.conname =
          'manual_subscription_activation_audits_legacy_plan_check'
      and constraint_def.contype = 'c'
      and pg_get_constraintdef(constraint_def.oid) =
          'CHECK ((legacy_plan = ANY (ARRAY[''starter''::text, ''business''::text])))'
  ) or not exists (
    select 1 from pg_constraint constraint_def
    where constraint_def.conrelid =
          'public.manual_subscription_activation_audits'::regclass
      and constraint_def.conname =
          'manual_subscription_activation_audits_currency_check'
      and constraint_def.contype = 'c'
      and pg_get_constraintdef(constraint_def.oid) =
          'CHECK ((currency = ''INR''::text))'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'manual_subscription_activation_audits'
      and column_name = 'legacy_plan'
      and is_nullable = 'NO'
  ) then
    raise exception 'UX-8G4B0A legacy evidence constraint or nullability authority drifted.';
  end if;

  if not exists (
    select 1
    from public.subscription_plans plan
    join public.subscription_plan_prices price on price.plan_id = plan.id
    where plan.status in ('draft','active')
      and price.status in ('draft','active')
      and price.region_code = 'GLOBAL'
      and coalesce((price.metadata_json->>'pricing_finalized')::boolean, false)
      and not coalesce((price.metadata_json->>'placeholder_price')::boolean, true)
      and not coalesce((price.metadata_json->>'contact_sales')::boolean, false)
  ) or exists (
    select 1
    from public.manual_subscription_activation_audits evidence
    where (evidence.plan_code is not null
            and evidence.plan_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
       or (evidence.legacy_plan is not null
            and evidence.legacy_plan !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
       or (evidence.currency is not null and evidence.currency !~ '^[A-Z]{3}$')
       or evidence.payment_reference_normalized is distinct from
          lower(trim(evidence.payment_reference))
  ) or exists (
    select 1
    from public.manual_subscription_activation_audits evidence
    group by lower(trim(evidence.payment_reference))
    having count(*) > 1
  ) then
    raise exception 'UX-8G4B0A historical manual evidence is incompatible.';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_def
    where constraint_def.conrelid = 'public.subscription_plans'::regclass
      and constraint_def.conname = 'subscription_plans_code_key'
      and constraint_def.contype = 'u'
      and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (code)'
  ) or not exists (
    select 1
    from pg_constraint constraint_def
    where constraint_def.conrelid = 'public.platform_subscription_plans'::regclass
      and constraint_def.conname = 'platform_subscription_plans_code_key'
      and constraint_def.contype = 'u'
      and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (code)'
  ) or not exists (
    select 1
    from pg_constraint constraint_def
    where constraint_def.conrelid = 'public.platform_tenant_subscriptions'::regclass
      and constraint_def.conname = 'platform_tenant_subscriptions_tenant_id_key'
      and constraint_def.contype = 'u'
      and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (tenant_id)'
  ) then
    raise exception 'UX-8G4B0A canonical commercial uniqueness authority is missing.';
  end if;

  if exists (
    with canonical_projection_targets as (
      select distinct plan.code, price.currency
      from public.subscription_plans plan
      join public.subscription_plan_prices price on price.plan_id = plan.id
      where plan.status in ('draft','active')
        and price.status in ('draft','active')
        and price.region_code = 'GLOBAL'
        and coalesce((price.metadata_json->>'pricing_finalized')::boolean, false)
        and not coalesce((price.metadata_json->>'placeholder_price')::boolean, true)
        and not coalesce((price.metadata_json->>'contact_sales')::boolean, false)
    )
    select 1
    from canonical_projection_targets target
    where (
      select count(*)
      from public.platform_subscription_plans platform_plan
      where platform_plan.code = target.code
        and platform_plan.status = 'active'
        and platform_plan.currency = target.currency
    ) <> 1
  ) then
    raise exception 'UX-8G4B0A platform plan projection is not deterministic.';
  end if;

  if (
    with expected(table_name, grantee, privilege_type, is_grantable) as (
      values
        ('platform_tenant_subscriptions','authenticated','SELECT','NO'),
        ('platform_tenant_subscriptions','authenticated','REFERENCES','NO'),
        ('platform_tenant_subscriptions','authenticated','TRIGGER','NO'),
        ('platform_tenant_subscriptions','authenticated','TRUNCATE','NO')
    ),
    actual as (
      select table_name, grantee, privilege_type, is_grantable
      from information_schema.table_privileges
      where table_schema = 'public'
        and table_name in (
          'manual_subscription_activation_audits',
          'tenant_subscription_assignments',
          'subscription_plan_prices',
          'platform_tenant_subscriptions'
        )
        and grantee in ('PUBLIC','anon','authenticated')
    )
    select exists (
      select * from expected except select * from actual
    ) or exists (
      select * from actual except select * from expected
    )
  ) then
    raise exception 'UX-8G4B0A diagnosed pre-apply table ACL state drifted.';
  end if;
end;
$$;

create temporary table ux8g4b0a_protected_baseline on commit drop as
select jsonb_build_object(
  'tenants', (select count(*) from public.tenants),
  'assignments', (select count(*) from public.tenant_subscription_assignments),
  'manual_audits', (select count(*) from public.manual_subscription_activation_audits),
  'platform_subscriptions', (select count(*) from public.platform_tenant_subscriptions),
  'legacy_subscriptions', (select count(*) from public.subscriptions),
  'payment_orders', (select count(*) from public.tenant_payment_orders),
  'payment_attempts', (select count(*) from public.tenant_payment_attempts),
  'provider_events', (select count(*) from public.razorpay_webhook_events),
  'activation_events', (select count(*) from public.tenant_plan_activation_events),
  'change_intents', (select count(*) from public.tenant_subscription_change_intents),
  'invoices', (select count(*) from public.invoices),
  'receipts', (select count(*) from public.platform_billing_receipts)
) counts;

do $$
begin
  if (
    with expected(table_name, grantee, privilege_type, is_grantable) as (
      values
        ('platform_tenant_subscriptions','authenticated','SELECT','NO'),
        ('platform_tenant_subscriptions','authenticated','REFERENCES','NO'),
        ('platform_tenant_subscriptions','authenticated','TRIGGER','NO'),
        ('platform_tenant_subscriptions','authenticated','TRUNCATE','NO')
    ),
    actual as (
      select table_name, grantee, privilege_type, is_grantable
      from information_schema.table_privileges
      where table_schema = 'public'
        and table_name in (
          'manual_subscription_activation_audits',
          'tenant_subscription_assignments',
          'subscription_plan_prices',
          'platform_tenant_subscriptions'
        )
        and grantee in ('PUBLIC','anon','authenticated')
    )
    select exists (
      select * from expected except select * from actual
    ) or exists (
      select * from actual except select * from expected
    )
  ) then
    raise exception 'UX-8G4B0A table ACL state changed before narrow revocation.';
  end if;
end;
$$;

revoke references, trigger, truncate
on table public.platform_tenant_subscriptions
from authenticated;

alter table public.manual_subscription_activation_audits
  add column request_id uuid,
  add column request_fingerprint text,
  add column plan_id uuid references public.subscription_plans(id) on delete restrict,
  add column price_id uuid references public.subscription_plan_prices(id) on delete restrict,
  add column payment_evidence_kind text;

alter table public.manual_subscription_activation_audits
  alter column legacy_plan drop not null,
  drop constraint manual_subscription_activation_audits_plan_code_check,
  drop constraint manual_subscription_activation_audits_legacy_plan_check,
  drop constraint manual_subscription_activation_audits_currency_check,
  add constraint manual_subscription_activation_audits_plan_code_format_check
    check (plan_code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  add constraint manual_subscription_activation_audits_legacy_plan_format_check
    check (legacy_plan is null or legacy_plan ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  add constraint manual_subscription_activation_audits_currency_format_check
    check (currency ~ '^[A-Z]{3}$'),
  add constraint manual_subscription_activation_audits_request_fingerprint_check
    check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint manual_subscription_activation_audits_evidence_kind_check
    check (payment_evidence_kind is null or payment_evidence_kind = 'manual_operator_verified'),
  add constraint manual_subscription_activation_audits_canonical_request_check
    check (
      (request_id is null and request_fingerprint is null and plan_id is null
        and price_id is null and payment_evidence_kind is null)
      or
      (request_id is not null and request_fingerprint is not null
        and plan_id is not null and price_id is not null
        and payment_evidence_kind = 'manual_operator_verified'
        and idempotency_key = request_id::text
        and assignment_id is not null
        and platform_subscription_id is not null
        and activation_status = 'activated'
        and legacy_plan is null)
    );

create unique index manual_subscription_activation_audits_request_id_uidx
  on public.manual_subscription_activation_audits(request_id)
  where request_id is not null;

do $$
declare
  v_check_contract boolean;
begin
  with expected(
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
        'plan_code~''^[a-z0-9][a-z0-9_-]{0,63}$''::text',
        'operator',
        0
      ),
      (
        'manual_subscription_activation_audits_legacy_plan_format_check',
        array['legacy_plan']::text[],
        'legacy_planISNULLORlegacy_plan~''^[a-z0-9][a-z0-9_-]{0,63}$''::text',
        'or',
        0
      ),
      (
        'manual_subscription_activation_audits_currency_format_check',
        array['currency']::text[],
        'currency~''^[A-Z]{3}$''::text',
        'operator',
        0
      ),
      (
        'manual_subscription_activation_audits_request_fingerprint_check',
        array['request_fingerprint']::text[],
        'request_fingerprintISNULLORrequest_fingerprint~''^[0-9a-f]{64}$''::text',
        'or',
        0
      ),
      (
        'manual_subscription_activation_audits_evidence_kind_check',
        array['payment_evidence_kind']::text[],
        'payment_evidence_kindISNULLORpayment_evidence_kind=''manual_operator_verified''::text',
        'or',
        0
      ),
      (
        'manual_subscription_activation_audits_canonical_request_check',
        array[
          'activation_status','assignment_id','idempotency_key','legacy_plan',
          'payment_evidence_kind','plan_id','platform_subscription_id','price_id',
          'request_fingerprint','request_id'
        ]::text[],
        'request_idISNULLANDrequest_fingerprintISNULLANDplan_idISNULLANDprice_idISNULLANDpayment_evidence_kindISNULLORrequest_idISNOTNULLANDrequest_fingerprintISNOTNULLANDplan_idISNOTNULLANDprice_idISNOTNULLANDpayment_evidence_kind=''manual_operator_verified''::textANDidempotency_key=request_id::textANDassignment_idISNOTNULLANDplatform_subscription_idISNOTNULLANDactivation_status=''activated''::textANDlegacy_planISNULL',
        'or',
        2
      )
  ), catalog as (
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
        '[()[:space:]]+',
        '',
        'g'
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
    from expected
    left join pg_constraint constraint_def
      on constraint_def.conrelid =
          'public.manual_subscription_activation_audits'::regclass
     and constraint_def.conname = expected.constraint_name
  )
  select
    count(*) = 6
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
  into v_check_contract
  from catalog;

  if not coalesce(v_check_contract, false) then
    raise exception 'UX-8G4B0A replacement CHECK contract failed self-verification.';
  end if;
end;
$$;

do $$
declare
  v_request_index_contract boolean;
begin
  select
    count(index_def.indexrelid) = 1
    and coalesce(bool_and(
      index_def.indrelid = 'public.manual_subscription_activation_audits'::regclass
      and index_relation.relname =
          'manual_subscription_activation_audits_request_id_uidx'
      and index_def.indisunique
      and index_def.indisvalid
      and index_def.indisready
      and index_def.indislive
      and index_def.indnkeyatts = 1
      and index_def.indnatts = 1
      and index_def.indexprs is null
      and index_def.indpred is not null
      and index_def.indkey[0] = request_column.attnum
      and regexp_replace(
        pg_get_expr(index_def.indpred, index_def.indrelid, true),
        '[()[:space:]]+',
        '',
        'g'
      ) = 'request_idISNOTNULL'
    ), false)
  into v_request_index_contract
  from pg_class index_relation
  left join pg_index index_def
    on index_def.indexrelid = index_relation.oid
  left join pg_attribute request_column
    on request_column.attrelid =
        'public.manual_subscription_activation_audits'::regclass
   and request_column.attname = 'request_id'
   and request_column.attnum > 0
   and not request_column.attisdropped
  where index_relation.oid =
        to_regclass('public.manual_subscription_activation_audits_request_id_uidx');

  if not coalesce(v_request_index_contract, false) then
    raise exception 'UX-8G4B0A request_id index contract failed self-verification.';
  end if;
end;
$$;

comment on table public.manual_subscription_activation_audits is
  'Immutable manual/operator-verified subscription activation evidence. Historical pre-UX-8G4B0A rows retain null canonical request fields.';

create function coachfort_internal.enforce_manual_subscription_activation_audit_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Manual subscription activation evidence is immutable.' using errcode = '55000';
end;
$$;

create trigger enforce_manual_subscription_activation_audit_immutability
before update or delete on public.manual_subscription_activation_audits
for each row execute function coachfort_internal.enforce_manual_subscription_activation_audit_immutability();

create function public.activate_tenant_subscription_manual_authority_server(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_tenant_id uuid,
  p_customer_email text,
  p_plan_code text,
  p_billing_cycle text,
  p_amount_minor bigint,
  p_currency text,
  p_payment_method text,
  p_payment_verified_at timestamptz,
  p_payment_reference text,
  p_founder_approval text,
  p_operator_note text default null,
  p_replace_current boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_tenant public.tenants%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_price public.subscription_plan_prices%rowtype;
  v_platform_plan public.platform_subscription_plans%rowtype;
  v_platform_plan_count integer;
  v_current public.tenant_subscription_assignments%rowtype;
  v_has_commercial_assignment_history boolean;
  v_lifecycle jsonb;
  v_existing public.manual_subscription_activation_audits%rowtype;
  v_customer_email text := lower(trim(coalesce(p_customer_email, '')));
  v_plan_code text := lower(trim(coalesce(p_plan_code, '')));
  v_billing_cycle text := lower(trim(coalesce(p_billing_cycle, '')));
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_payment_method text := lower(trim(coalesce(p_payment_method, '')));
  v_payment_reference text := trim(coalesce(p_payment_reference, ''));
  v_payment_reference_normalized text := lower(trim(coalesce(p_payment_reference, '')));
  v_founder_approval text := trim(coalesce(p_founder_approval, ''));
  v_operator_note text := nullif(trim(coalesce(p_operator_note, '')), '');
  v_period_start timestamptz := statement_timestamp();
  v_period_end timestamptz;
  v_assignment_id uuid;
  v_platform_subscription_id uuid;
  v_audit_id uuid := gen_random_uuid();
  v_request_payload jsonb;
  v_request_fingerprint text;
  v_result jsonb;
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.platform_admin_users platform_actor
    where platform_actor.user_id = p_actor_user_id
      and platform_actor.status = 'active'
      and platform_actor.role in ('owner','admin')
  ) then
    raise exception 'Platform manual activation authority is required.' using errcode = '42501';
  end if;

  select platform_actor.role into v_actor_role
  from public.platform_admin_users platform_actor
  where platform_actor.user_id = p_actor_user_id
    and platform_actor.status = 'active'
    and platform_actor.role in ('owner','admin');

  if p_request_id is null or p_tenant_id is null then
    raise exception 'Request and tenant identifiers are required.' using errcode = '22023';
  end if;

  if v_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(v_customer_email) > 320 then
    raise exception 'Customer email is invalid.' using errcode = '22023';
  end if;

  if v_plan_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or v_billing_cycle not in ('monthly','yearly')
     or v_currency !~ '^[A-Z]{3}$'
     or p_amount_minor is null
     or p_amount_minor <= 0 then
    raise exception 'Canonical commercial selection is invalid.' using errcode = '22023';
  end if;

  if char_length(v_payment_method) not between 2 and 80
     or v_payment_method ~ '[<>]'
     or char_length(v_payment_reference) not between 3 and 180
     or v_payment_reference ~ '[<>]'
     or char_length(v_founder_approval) not between 3 and 240
     or v_founder_approval ~ '[<>]'
     or char_length(coalesce(v_operator_note, '')) > 1500
     or coalesce(v_operator_note, '') ~ '[<>]' then
    raise exception 'Manual payment evidence is invalid.' using errcode = '22023';
  end if;

  if p_payment_verified_at is null
     or p_payment_verified_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'Manual payment verification time is invalid.' using errcode = '22023';
  end if;

  v_request_payload := jsonb_build_object(
    'actor_user_id', p_actor_user_id,
    'request_id', p_request_id,
    'tenant_id', p_tenant_id,
    'customer_email', v_customer_email,
    'plan_code', v_plan_code,
    'billing_cycle', v_billing_cycle,
    'amount_minor', p_amount_minor,
    'currency', v_currency,
    'payment_method', v_payment_method,
    'payment_reference_normalized', v_payment_reference_normalized,
    'payment_verified_at', p_payment_verified_at,
    'founder_approval', v_founder_approval,
    'operator_note', v_operator_note,
    'replace_current', coalesce(p_replace_current, false)
  );
  v_request_fingerprint := encode(
    extensions.digest(convert_to(v_request_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  -- Lock order is request identity, payment reference, tenant, catalog rows,
  -- then current assignment. All replacement callers use this one authority.
  perform pg_advisory_xact_lock(hashtextextended(
    'ux8g4b0a_request:' || p_request_id::text, 8401
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'ux8g4b0a_payment_reference:' || v_payment_reference_normalized, 8401
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'ux8g4b0a_tenant:' || p_tenant_id::text, 8401
  ));

  select * into v_existing
  from public.manual_subscription_activation_audits evidence
  where evidence.request_id = p_request_id
     or evidence.idempotency_key = p_request_id::text
  order by evidence.request_id nulls last
  limit 1
  for update;

  if v_existing.id is not null then
    if v_existing.request_id = p_request_id
       and v_existing.request_fingerprint = v_request_fingerprint then
      return v_existing.result_json || jsonb_build_object('idempotent', true);
    end if;
    raise exception 'Manual activation request identity conflicts with existing evidence.' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.manual_subscription_activation_audits evidence
    where evidence.payment_reference_normalized = v_payment_reference_normalized
  ) then
    raise exception 'Manual payment reference has already been used.' using errcode = '23505';
  end if;

  select * into v_tenant
  from public.tenants tenant
  where tenant.id = p_tenant_id
  for update;

  if v_tenant.id is null or v_tenant.owner_user_id is null then
    raise exception 'Tenant activation target is invalid.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_members member
    join auth.users account on account.id = member.user_id
    where member.tenant_id = p_tenant_id
      and member.user_id = v_tenant.owner_user_id
      and member.role = 'owner'
      and lower(trim(account.email)) = v_customer_email
  ) then
    raise exception 'Customer email does not match current workspace owner authority.' using errcode = '22023';
  end if;

  select * into v_plan
  from public.subscription_plans plan
  where plan.code = v_plan_code
    and plan.status in ('draft','active')
  for share;

  if v_plan.id is null then
    raise exception 'Canonical subscription plan is unavailable.' using errcode = '22023';
  end if;

  select * into v_price
  from public.subscription_plan_prices price
  where price.plan_id = v_plan.id
    and price.billing_cycle = v_billing_cycle
    and price.currency = v_currency
    and price.region_code = 'GLOBAL'
    and price.status in ('draft','active')
    and coalesce((price.metadata_json->>'pricing_finalized')::boolean, false)
    and not coalesce((price.metadata_json->>'placeholder_price')::boolean, true)
    and not coalesce((price.metadata_json->>'contact_sales')::boolean, false)
  order by case when price.status = 'active' then 0 else 1 end, price.updated_at desc, price.id
  limit 1
  for share;

  if v_price.id is null
     or v_price.amount_minor <= 0
     or v_price.setup_fee_amount_minor < 0
     or p_amount_minor is distinct from
        v_price.amount_minor + v_price.setup_fee_amount_minor then
    raise exception 'Manual payment does not match canonical plan price.' using errcode = '22023';
  end if;

  select count(*) into v_platform_plan_count
  from public.platform_subscription_plans platform_plan
  where platform_plan.code = v_plan.code
    and platform_plan.status = 'active'
    and platform_plan.currency = v_price.currency;

  if v_platform_plan_count <> 1 then
    raise exception 'Platform subscription projection is unavailable or ambiguous.' using errcode = '22023';
  end if;

  select * into v_platform_plan
  from public.platform_subscription_plans platform_plan
  where platform_plan.code = v_plan.code
    and platform_plan.status = 'active'
    and platform_plan.currency = v_price.currency
  order by platform_plan.id
  limit 1
  for share;

  if v_platform_plan.id is null then
    raise exception 'Platform subscription projection is unavailable.' using errcode = '22023';
  end if;

  select * into v_current
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  limit 1
  for update;

  select exists (
    select 1
    from public.tenant_subscription_assignments assignment
    where assignment.tenant_id = p_tenant_id
      and (
        assignment.status <> 'trial'
        or assignment.payment_status <> 'not_required'
        or assignment.current_period_start is not null
        or assignment.current_period_end is not null
        or assignment.grace_period_ends_at is not null
      )
  ) into v_has_commercial_assignment_history;

  if v_has_commercial_assignment_history then
    raise exception 'Canonical renewal or plan-change authority is required for existing paid subscription history.' using errcode = '55000';
  end if;

  if v_current.id is null and coalesce(p_replace_current, false) then
    raise exception 'Replacement was requested but no current assignment exists.' using errcode = '55000';
  end if;

  if v_current.id is not null then
    if not coalesce(p_replace_current, false) then
      raise exception 'Explicit replacement is required for the current assignment.' using errcode = '55000';
    end if;

    v_lifecycle := coachfort_internal.tenant_subscription_effective_lifecycle(p_tenant_id);

    if v_current.status <> 'trial'
       or v_current.payment_status <> 'not_required'
       or v_current.trial_started_at is null
       or v_current.trial_ends_at is null
       or v_current.trial_started_at >= v_current.trial_ends_at
       or v_current.current_period_start is not null
       or v_current.current_period_end is not null
       or v_current.grace_period_ends_at is not null
       or v_lifecycle->>'reason' not in ('within_trial_period','trial_period_elapsed') then
      raise exception 'Current trial authority is malformed and requires review.' using errcode = '55000';
    end if;
  end if;

  v_period_end := case v_billing_cycle
    when 'monthly' then v_period_start + interval '1 month'
    when 'yearly' then v_period_start + interval '1 year'
    else null
  end;

  if v_period_end is null or v_period_end <= v_period_start then
    raise exception 'Canonical paid period could not be derived.' using errcode = '22023';
  end if;

  if v_current.id is not null then
    update public.tenant_subscription_assignments
    set is_current = false,
        metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
          'superseded_by_manual_request_id', p_request_id,
          'superseded_by_manual_actor_id', p_actor_user_id,
          'superseded_at', v_period_start
        ),
        updated_by = p_actor_user_id,
        updated_at = statement_timestamp()
    where id = v_current.id;
  end if;

  insert into public.tenant_subscription_assignments (
    tenant_id, plan_id, status, billing_cycle, currency,
    trial_started_at, trial_ends_at, current_period_start, current_period_end,
    grace_period_ends_at, payment_status, source, is_current,
    metadata_json, created_by, updated_by
  ) values (
    p_tenant_id, v_plan.id, 'active', v_billing_cycle, v_currency,
    null, null, v_period_start, v_period_end,
    v_period_end + interval '7 days', 'paid', 'platform_manual', true,
    jsonb_build_object(
      'module', 'UX-8G4B0A',
      'activation_kind', 'manual_operator_verified',
      'manual_activation_audit_id', v_audit_id,
      'manual_request_id', p_request_id,
      'price_id', v_price.id,
      'amount_minor', p_amount_minor,
      'setup_fee_amount_minor', v_price.setup_fee_amount_minor,
      'payment_method', v_payment_method,
      'payment_reference_present', true,
      'payment_verified_at', p_payment_verified_at,
      'provider_evidence', false
    ),
    p_actor_user_id, p_actor_user_id
  ) returning id into v_assignment_id;

  insert into public.platform_tenant_subscriptions (
    tenant_id, plan_id, status, billing_cycle,
    trial_started_at, trial_ends_at, current_period_start, current_period_end,
    amount, currency, payment_status, notes, metadata_json
  ) values (
    p_tenant_id, v_platform_plan.id, 'active', v_billing_cycle,
    null, null, v_period_start, v_period_end,
    p_amount_minor::numeric / 100, v_currency, 'paid', null,
    jsonb_build_object(
      'projection_source', 'canonical_manual_activation',
      'canonical_assignment_id', v_assignment_id,
      'canonical_plan_id', v_plan.id,
      'canonical_price_id', v_price.id,
      'manual_activation_audit_id', v_audit_id,
      'manual_request_id', p_request_id
    )
  )
  on conflict (tenant_id) do update
  set plan_id = excluded.plan_id,
      status = excluded.status,
      billing_cycle = excluded.billing_cycle,
      trial_started_at = excluded.trial_started_at,
      trial_ends_at = excluded.trial_ends_at,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      amount = excluded.amount,
      currency = excluded.currency,
      payment_status = excluded.payment_status,
      notes = excluded.notes,
      metadata_json = excluded.metadata_json,
      updated_at = statement_timestamp()
  returning id into v_platform_subscription_id;

  v_result := jsonb_build_object(
    'activated', true,
    'idempotent', false,
    'activation_kind', 'manual_operator_verified',
    'activation_audit_id', v_audit_id,
    'request_id', p_request_id,
    'tenant_id', p_tenant_id,
    'assignment_id', v_assignment_id,
    'plan_id', v_plan.id,
    'price_id', v_price.id,
    'plan_code', v_plan.code,
    'status', 'active',
    'payment_status', 'paid',
    'billing_cycle', v_billing_cycle,
    'currency', v_currency,
    'amount_minor', p_amount_minor,
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'grace_period_ends_at', v_period_end + interval '7 days',
    'provider_evidence', false
  );

  insert into public.manual_subscription_activation_audits (
    id, tenant_id, assignment_id, platform_subscription_id,
    idempotency_key, request_id, request_fingerprint,
    plan_id, price_id, payment_evidence_kind,
    payment_reference, payment_reference_normalized, customer_email,
    plan_code, legacy_plan, billing_cycle, amount_minor, currency,
    subscription_start, subscription_end, payment_method,
    payment_verified_at, founder_approval, operator_note,
    activation_status, request_payload_json, result_json, metadata_json,
    created_by
  ) values (
    v_audit_id, p_tenant_id, v_assignment_id, v_platform_subscription_id,
    p_request_id::text, p_request_id, v_request_fingerprint,
    v_plan.id, v_price.id, 'manual_operator_verified',
    v_payment_reference, v_payment_reference_normalized, v_customer_email,
    v_plan.code, null, v_billing_cycle, p_amount_minor, v_currency,
    v_period_start, v_period_end, v_payment_method,
    p_payment_verified_at, v_founder_approval, v_operator_note,
    'activated', v_request_payload, v_result,
    jsonb_build_object(
      'module', 'UX-8G4B0A',
      'actor_role', v_actor_role,
      'manual_operator_verified', true,
      'provider_evidence', false,
      'razorpay_evidence', false,
      'webhook_evidence', false,
      'billing_document_created', false
    ),
    p_actor_user_id
  );

  insert into public.platform_activity_logs (
    actor_id, tenant_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_actor_user_id, p_tenant_id, 'canonical_manual_subscription_activated',
    'tenant_subscription_assignment', v_assignment_id,
    jsonb_build_object(
      'module', 'UX-8G4B0A',
      'manual_activation_audit_id', v_audit_id,
      'request_id', p_request_id,
      'plan_code', v_plan.code,
      'billing_cycle', v_billing_cycle,
      'amount_minor', p_amount_minor,
      'currency', v_currency,
      'provider_evidence', false
    )
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id,
    entity_name, description, severity, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'canonical_manual_subscription_activated',
    'tenant_subscription_assignment', v_assignment_id, v_plan.code,
    'Manual subscription activated from operator-verified payment evidence.',
    'info',
    jsonb_build_object(
      'module', 'UX-8G4B0A',
      'manual_activation_audit_id', v_audit_id,
      'request_id', p_request_id,
      'provider_evidence', false
    )
  );

  return v_result;
end;
$$;

comment on function public.activate_tenant_subscription_manual_authority_server(
  uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean
) is
  'Server-only Platform Owner/Admin break-glass activation from explicit manual payment evidence. Does not create provider payment or billing-document evidence.';

alter function coachfort_internal.enforce_manual_subscription_activation_audit_immutability() owner to postgres;
alter function public.activate_tenant_subscription_manual_authority_server(
  uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean
) owner to postgres;
alter table public.manual_subscription_activation_audits enable row level security;

revoke all on function coachfort_internal.enforce_manual_subscription_activation_audit_immutability()
  from public, anon, authenticated, service_role;
revoke all on function public.activate_tenant_subscription_manual_authority_server(
  uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean
) from public, anon, authenticated, service_role;
grant execute on function public.activate_tenant_subscription_manual_authority_server(
  uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean
) to service_role;

do $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select counts into v_before from ux8g4b0a_protected_baseline;
  v_after := jsonb_build_object(
    'tenants', (select count(*) from public.tenants),
    'assignments', (select count(*) from public.tenant_subscription_assignments),
    'manual_audits', (select count(*) from public.manual_subscription_activation_audits),
    'platform_subscriptions', (select count(*) from public.platform_tenant_subscriptions),
    'legacy_subscriptions', (select count(*) from public.subscriptions),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'provider_events', (select count(*) from public.razorpay_webhook_events),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'change_intents', (select count(*) from public.tenant_subscription_change_intents),
    'invoices', (select count(*) from public.invoices),
    'receipts', (select count(*) from public.platform_billing_receipts)
  );

  if v_before is distinct from v_after then
    raise exception 'UX-8G4B0A changed protected business or financial rows.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- POST-APPLY READ-ONLY VERIFICATION
-- ============================================================================

with identities as (
  select
    to_regprocedure('public.activate_tenant_subscription_manual_authority_server(uuid,uuid,uuid,text,text,text,bigint,text,text,timestamptz,text,text,text,boolean)') new_rpc,
    to_regprocedure('coachfort_internal.enforce_manual_subscription_activation_audit_immutability()') evidence_trigger,
    to_regprocedure('public.activate_tenant_subscription_manual(uuid,text,text,text,bigint,text,timestamptz,timestamptz,text,text,timestamptz,text,text,timestamptz,text,text,boolean)') legacy_rpc
),
function_contract as (
  select
    count(procedure.oid) = 1 exact_function,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false) owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(
      coalesce(array_to_string(procedure.proconfig, ','), '') like
        '%search_path=public, pg_temp%'
    ), false) fixed_search_path,
    coalesce(max(pg_get_functiondef(procedure.oid)), '') source
  from identities
  left join pg_proc procedure on procedure.oid = identities.new_rpc
),
function_acl as (
  select
    coalesce(has_function_privilege('service_role', identities.new_rpc, 'EXECUTE'), false) service_execute,
    coalesce(has_function_privilege('authenticated', identities.new_rpc, 'EXECUTE'), false) authenticated_execute,
    coalesce(has_function_privilege('anon', identities.new_rpc, 'EXECUTE'), false) anon_execute,
    not exists (
      select 1
      from pg_proc procedure,
      lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where procedure.oid = identities.new_rpc
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) public_execute_absent
  from identities
),
trigger_contract as (
  select
    count(*) = 1 exact_trigger,
    coalesce(bool_and(trigger_def.tgfoid = identities.evidence_trigger), false) correct_binding
  from pg_trigger trigger_def
  cross join identities
  where trigger_def.tgrelid = 'public.manual_subscription_activation_audits'::regclass
    and trigger_def.tgname = 'enforce_manual_subscription_activation_audit_immutability'
    and not trigger_def.tgisinternal
),
trigger_function_contract as (
  select
    count(procedure.oid) = 1 exact_function,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false) owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(
      coalesce(array_to_string(procedure.proconfig, ','), '') like
        '%search_path=public, pg_temp%'
    ), false) fixed_search_path,
    coalesce(bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE')), false) service_execute_absent,
    coalesce(bool_and(not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')), false) authenticated_execute_absent,
    coalesce(bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE')), false) anon_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent
  from identities
  left join pg_proc procedure on procedure.oid = identities.evidence_trigger
),
expected_replacement_constraints(
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
      'plan_code~''^[a-z0-9][a-z0-9_-]{0,63}$''::text',
      'operator',
      0
    ),
    (
      'manual_subscription_activation_audits_legacy_plan_format_check',
      array['legacy_plan']::text[],
      'legacy_planISNULLORlegacy_plan~''^[a-z0-9][a-z0-9_-]{0,63}$''::text',
      'or',
      0
    ),
    (
      'manual_subscription_activation_audits_currency_format_check',
      array['currency']::text[],
      'currency~''^[A-Z]{3}$''::text',
      'operator',
      0
    ),
    (
      'manual_subscription_activation_audits_request_fingerprint_check',
      array['request_fingerprint']::text[],
      'request_fingerprintISNULLORrequest_fingerprint~''^[0-9a-f]{64}$''::text',
      'or',
      0
    ),
    (
      'manual_subscription_activation_audits_evidence_kind_check',
      array['payment_evidence_kind']::text[],
      'payment_evidence_kindISNULLORpayment_evidence_kind=''manual_operator_verified''::text',
      'or',
      0
    ),
    (
      'manual_subscription_activation_audits_canonical_request_check',
      array[
        'activation_status','assignment_id','idempotency_key','legacy_plan',
        'payment_evidence_kind','plan_id','platform_subscription_id','price_id',
        'request_fingerprint','request_id'
      ]::text[],
      'request_idISNULLANDrequest_fingerprintISNULLANDplan_idISNULLANDprice_idISNULLANDpayment_evidence_kindISNULLORrequest_idISNOTNULLANDrequest_fingerprintISNOTNULLANDplan_idISNOTNULLANDprice_idISNOTNULLANDpayment_evidence_kind=''manual_operator_verified''::textANDidempotency_key=request_id::textANDassignment_idISNOTNULLANDplatform_subscription_idISNOTNULLANDactivation_status=''activated''::textANDlegacy_planISNULL',
      'or',
      2
    )
),
replacement_constraint_catalog as (
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
      '[()[:space:]]+',
      '',
      'g'
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
        'public.manual_subscription_activation_audits'::regclass
   and constraint_def.conname = expected.constraint_name
),
replacement_constraint_results as (
  select
    replacement_constraint_catalog.*,
    coalesce(
      contype = 'c'
      and convalidated
      and conislocal
      and coninhcount = 0
      and not connoinherit
      and actual_columns = expected_columns
      and compact_expression = expected_expression
      and expression_root = expected_root
      and and_node_count = expected_and_nodes,
      false
    ) exact_contract
  from replacement_constraint_catalog
),
replacement_constraint_contract as (
  select
    count(*) = 6 expected_constraint_count,
    count(oid) = 6 installed_constraint_count,
    coalesce(bool_and(
      contype = 'c'
      and convalidated
      and conislocal
      and coninhcount = 0
      and not connoinherit
    ), false) exact_catalog_shape,
    coalesce(bool_and(actual_columns = expected_columns), false) exact_column_binding,
    coalesce(bool_and(
      compact_expression = expected_expression
      and expression_root = expected_root
      and and_node_count = expected_and_nodes
    ), false) exact_expression_semantics,
    coalesce(bool_and(exact_contract) filter (
      where constraint_name =
        'manual_subscription_activation_audits_plan_code_format_check'
    ), false) plan_code_check_contract,
    coalesce(bool_and(exact_contract) filter (
      where constraint_name =
        'manual_subscription_activation_audits_legacy_plan_format_check'
    ), false) legacy_plan_check_contract,
    coalesce(bool_and(exact_contract) filter (
      where constraint_name =
        'manual_subscription_activation_audits_currency_format_check'
    ), false) currency_check_contract,
    coalesce(bool_and(exact_contract) filter (
      where constraint_name =
        'manual_subscription_activation_audits_request_fingerprint_check'
    ), false) request_fingerprint_check_contract,
    coalesce(bool_and(exact_contract) filter (
      where constraint_name =
        'manual_subscription_activation_audits_evidence_kind_check'
    ), false) evidence_kind_check_contract,
    coalesce(bool_and(exact_contract) filter (
      where constraint_name =
        'manual_subscription_activation_audits_canonical_request_check'
    ), false) canonical_request_check_contract
  from replacement_constraint_results
),
request_index_contract as (
  select
    count(index_def.indexrelid) = 1 exact_index_count,
    coalesce(bool_and(
      index_def.indrelid = 'public.manual_subscription_activation_audits'::regclass
      and index_relation.relname =
          'manual_subscription_activation_audits_request_id_uidx'
    ), false) exact_table_and_name,
    coalesce(bool_and(
      index_def.indisunique
      and index_def.indisvalid
      and index_def.indisready
      and index_def.indislive
    ), false) unique_valid_ready_live,
    coalesce(bool_and(
      index_def.indnkeyatts = 1
      and index_def.indnatts = 1
      and index_def.indexprs is null
    ), false) one_plain_key_no_include,
    coalesce(bool_and(
      request_column.attnum is not null
      and index_def.indkey[0] = request_column.attnum
    ), false) request_id_is_key,
    coalesce(bool_and(
      index_def.indpred is not null
      and regexp_replace(
        pg_get_expr(index_def.indpred, index_def.indrelid, true),
        '[()[:space:]]+',
        '',
        'g'
      ) = 'request_idISNOTNULL'
    ), false) exact_partial_predicate
  from pg_class index_relation
  left join pg_index index_def
    on index_def.indexrelid = index_relation.oid
  left join pg_attribute request_column
    on request_column.attrelid =
        'public.manual_subscription_activation_audits'::regclass
   and request_column.attname = 'request_id'
   and request_column.attnum > 0
   and not request_column.attisdropped
  where index_relation.oid =
        to_regclass('public.manual_subscription_activation_audits_request_id_uidx')
),
evidence_contract as (
  select
    count(*) filter (where column_name in (
      'request_id','request_fingerprint','plan_id','price_id','payment_evidence_kind'
    )) = 5 canonical_columns,
    count(*) filter (
      where column_name = 'legacy_plan' and is_nullable = 'YES'
    ) = 1 legacy_plan_nullable,
    coalesce((select relrowsecurity from pg_class
      where oid = to_regclass('public.manual_subscription_activation_audits')), false) rls_enabled,
    (select
      exact_index_count
      and exact_table_and_name
      and unique_valid_ready_live
      and one_plain_key_no_include
      and request_id_is_key
      and exact_partial_predicate
      from request_index_contract) request_unique_exact,
    (select
      expected_constraint_count
      and installed_constraint_count
      and exact_catalog_shape
      and exact_column_binding
      and exact_expression_semantics
      from replacement_constraint_contract) replacement_constraints_exact,
    not exists (
      select 1
      from pg_constraint constraint_def
      where constraint_def.conrelid =
            'public.manual_subscription_activation_audits'::regclass
        and constraint_def.conname in (
          'manual_subscription_activation_audits_plan_code_check',
          'manual_subscription_activation_audits_legacy_plan_check',
          'manual_subscription_activation_audits_currency_check'
        )
    ) legacy_constraints_absent,
    exists (
      select 1
      from pg_constraint constraint_def
      where constraint_def.conrelid =
            'public.manual_subscription_activation_audits'::regclass
        and constraint_def.conname =
            'manual_subscription_activation_audits_idempotency_key_unique'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (idempotency_key)'
    ) idempotency_key_unique,
    exists (
      select 1
      from pg_constraint constraint_def
      where constraint_def.conrelid =
            'public.manual_subscription_activation_audits'::regclass
        and constraint_def.conname =
            'manual_subscription_activation_audits_payment_reference_unique'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) =
            'UNIQUE (payment_reference_normalized)'
    ) payment_reference_normalized_unique
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_subscription_activation_audits'
),
browser_write_state as (
  select count(*) browser_write_grants
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in (
      'manual_subscription_activation_audits',
      'tenant_subscription_assignments',
      'subscription_plan_prices',
      'platform_tenant_subscriptions'
    )
    and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type in (
      'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
    )
),
final_platform_acl_state as (
  select
    count(*) filter (
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'SELECT'
        and is_grantable = 'NO'
    ) = 1 authenticated_select_preserved,
    count(*) filter (
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'REFERENCES'
    ) = 0 authenticated_references_absent,
    count(*) filter (
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'TRIGGER'
    ) = 0 authenticated_trigger_absent,
    count(*) filter (
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'TRUNCATE'
    ) = 0 authenticated_truncate_absent,
    count(*) filter (
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'INSERT'
    ) = 0 authenticated_insert_absent,
    count(*) filter (
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'UPDATE'
    ) = 0 authenticated_update_absent,
    count(*) filter (
      where table_name = 'platform_tenant_subscriptions'
        and grantee = 'authenticated'
        and privilege_type = 'DELETE'
    ) = 0 authenticated_delete_absent,
    count(*) filter (
      where grantee in ('PUBLIC','anon')
        and privilege_type in (
          'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
        )
    ) = 0 public_anon_dangerous_absent
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in (
      'manual_subscription_activation_audits',
      'tenant_subscription_assignments',
      'subscription_plan_prices',
      'platform_tenant_subscriptions'
    )
    and grantee in ('PUBLIC','anon','authenticated')
),
legacy_rpc_contract as (
  select
    count(procedure.oid) = 1 exact_identity,
    coalesce(max(pg_get_userbyid(procedure.proowner)), '') owner_name,
    coalesce(bool_and(pg_get_userbyid(procedure.proowner) = 'postgres'), false) owner_is_postgres,
    coalesce(bool_and(procedure.prosecdef), false) security_definer,
    coalesce(bool_and(procedure.proconfig = array['search_path=public']), false) fixed_search_path,
    coalesce(bool_and(has_function_privilege('authenticated', procedure.oid, 'EXECUTE')), false) authenticated_execute,
    coalesce(bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE')), false) anon_execute_absent,
    coalesce(bool_and(not has_function_privilege('service_role', procedure.oid, 'EXECUTE')), false) service_execute_absent,
    coalesce(bool_and(not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )), false) public_execute_absent,
    coalesce(bool_and(has_table_privilege(
      procedure.proowner,
      'public.manual_subscription_activation_audits',
      'SELECT'
    )), false) audit_select_available,
    coalesce(bool_and(has_table_privilege(
      procedure.proowner,
      'public.manual_subscription_activation_audits',
      'INSERT'
    )), false) audit_insert_available,
    coalesce(bool_and(has_table_privilege(
      procedure.proowner,
      'public.manual_subscription_activation_audits',
      'UPDATE'
    )), false) audit_row_lock_available,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like
        '%insert into public.manual_subscription_activation_audits%'
    ), false) audit_insert_present,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) not like
        '%update public.manual_subscription_activation_audits%'
    ), false) audit_update_absent,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) not like
        '%delete from public.manual_subscription_activation_audits%'
    ), false) audit_delete_absent,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like
        '%from public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like '%for update%'
    ), false) audit_replay_row_lock_present,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like '%''idempotent'', true%'
    ), false) audit_replay_returns_existing,
    coalesce(bool_and(
      lower(pg_get_functiondef(procedure.oid)) like
        '%insert into public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like
        '%from public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) like '%for update%'
      and lower(pg_get_functiondef(procedure.oid)) like '%''idempotent'', true%'
      and lower(pg_get_functiondef(procedure.oid)) not like
        '%update public.manual_subscription_activation_audits%'
      and lower(pg_get_functiondef(procedure.oid)) not like
        '%delete from public.manual_subscription_activation_audits%'
    ), false) audit_insert_and_replay_compatible
  from identities
  left join pg_proc procedure on procedure.oid = identities.legacy_rpc
),
historical_evidence_compatibility as (
  select
    count(*) filter (
      where plan_code is not null
        and plan_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ) plan_code_format_violation_count,
    count(*) filter (
      where legacy_plan is not null
        and legacy_plan !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ) legacy_plan_format_violation_count,
    count(*) filter (
      where currency is not null and currency !~ '^[A-Z]{3}$'
    ) currency_format_violation_count,
    count(*) filter (
      where payment_reference_normalized is distinct from lower(trim(payment_reference))
    ) payment_reference_normalization_violation_count
  from public.manual_subscription_activation_audits
),
normalized_payment_reference_duplicates as (
  select count(*) duplicate_normalized_reference_count
  from (
    select lower(trim(payment_reference)) normalized_reference
    from public.manual_subscription_activation_audits
    group by lower(trim(payment_reference))
    having count(*) > 1
  ) duplicates
),
commercial_schema_state as (
  select
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.subscription_plans')
        and constraint_def.conname = 'subscription_plans_code_key'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (code)'
    ) subscription_plan_code_unique,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_subscription_plans')
        and constraint_def.conname = 'platform_subscription_plans_code_key'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (code)'
    ) platform_plan_code_unique,
    exists (
      select 1 from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_tenant_subscriptions')
        and constraint_def.conname = 'platform_tenant_subscriptions_tenant_id_key'
        and constraint_def.contype = 'u'
        and pg_get_constraintdef(constraint_def.oid) = 'UNIQUE (tenant_id)'
    ) platform_tenant_unique
),
canonical_projection_targets as (
  select distinct plan.code, price.currency
  from public.subscription_plans plan
  join public.subscription_plan_prices price on price.plan_id = plan.id
  where plan.status in ('draft','active')
    and price.status in ('draft','active')
    and price.region_code = 'GLOBAL'
    and coalesce((price.metadata_json->>'pricing_finalized')::boolean, false)
    and not coalesce((price.metadata_json->>'placeholder_price')::boolean, true)
    and not coalesce((price.metadata_json->>'contact_sales')::boolean, false)
),
platform_projection_state as (
  select
    count(*) target_count,
    count(*) filter (where matching_count = 0) missing_count,
    count(*) filter (where matching_count > 1) ambiguous_count
  from (
    select target.code, target.currency,
      (select count(*)
       from public.platform_subscription_plans platform_plan
       where platform_plan.code = target.code
         and platform_plan.status = 'active'
         and platform_plan.currency = target.currency) matching_count
    from canonical_projection_targets target
  ) targets
),
source_contract as (
  select
    normalized_source like '%from public.platform_admin_users platform_actor%' actor_revalidation,
    normalized_source like '%platform_actor.role in (''owner'',''admin'')%' actor_role_revalidation,
    normalized_source like '%from public.subscription_plans plan%' canonical_plan,
    normalized_source like '%from public.subscription_plan_prices price%' canonical_price,
    normalized_source not like '%149900%'
      and normalized_source not like '%599900%' no_hardcoded_price,
    normalized_source not like
      '%v_plan_code in (''starter'',''growth'')%' no_hardcoded_plan_mapping,
    normalized_source like '%v_period_start + interval ''1 month''%'
      and normalized_source like
        '%v_period_start + interval ''1 year''%' database_period_derivation,
    normalized_source like
      '%v_period_end + interval ''7 days''%' exact_grace_derivation,
    normalized_source like '%request_fingerprint%'
      and normalized_source like '%extensions.digest%'
      and normalized_source like '%idempotent'', true%' durable_idempotency,
    normalized_source like '%pg_advisory_xact_lock%'
      and normalized_source like '%for update%' concurrency_safe,
    normalized_source like '%manual_operator_verified%'
      and normalized_source like
        '%provider_evidence'', false%' manual_evidence_distinct,
    normalized_source not like '%insert into public.tenant_payment_orders%'
      and normalized_source not like
        '%insert into public.tenant_payment_attempts%'
      and normalized_source not like
        '%insert into public.razorpay_webhook_events%'
      and normalized_source not like
        '%insert into public.tenant_plan_activation_events%'
      and normalized_source not like '%insert into public.invoices%'
      and normalized_source not like
        '%insert into public.platform_billing_receipts%' no_provider_or_document_fabrication,
    normalized_source not like '%insert into public.subscriptions%'
      and normalized_source not like
        '%update public.tenants%' obsolete_legacy_writes_absent,
    normalized_source like
      '%insert into public.platform_tenant_subscriptions%'
      and normalized_source like
        '%projection_source%' required_platform_projection,
    normalized_source like
      '%select count(*) into v_platform_plan_count%'
      and normalized_source like '%if v_platform_plan_count <> 1%'
      and normalized_source like '%order by platform_plan.id%'
      and normalized_source like '%limit 1%'
      and normalized_source like '%for share%' deterministic_platform_projection,
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
    select lower(source) normalized_source
    from function_contract
  ) normalized_function_contract
),
historical_manual_assignments as (
  select
    count(*) total_count,
    count(*) filter (where assignment.is_current) current_count,
    count(*) filter (where not assignment.is_current) historical_count,
    count(*) filter (
      where assignment.status in ('active','grace','past_due')
        and assignment.grace_period_ends_at is distinct from
            assignment.current_period_end + interval '7 days'
    ) noncanonical_grace_count,
    count(*) filter (
      where assignment.is_current
        and assignment.status in ('active','grace','past_due')
        and (
          assignment.current_period_start is null
          or assignment.current_period_end is null
          or assignment.current_period_start >= assignment.current_period_end
          or assignment.grace_period_ends_at is distinct from
              assignment.current_period_end + interval '7 days'
        )
    ) malformed_current_count
  from public.tenant_subscription_assignments assignment
  where assignment.source = 'platform_manual'
),
protected_counts as (
  select
    (select count(*) from public.tenants) tenants,
    (select count(*) from public.tenant_subscription_assignments) assignments,
    (select count(*) from public.manual_subscription_activation_audits) manual_audits,
    (select count(*) from public.platform_tenant_subscriptions) platform_subscriptions,
    (select count(*) from public.subscriptions) legacy_subscriptions,
    (select count(*) from public.tenant_payment_orders) payment_orders,
    (select count(*) from public.tenant_payment_attempts) payment_attempts,
    (select count(*) from public.razorpay_webhook_events) provider_events,
    (select count(*) from public.tenant_plan_activation_events) activation_events,
    (select count(*) from public.tenant_subscription_change_intents) change_intents,
    (select count(*) from public.invoices) invoices,
    (select count(*) from public.platform_billing_receipts) receipts
),
gates as (
  select
    identities.new_rpc is not null new_rpc_present,
    identities.legacy_rpc is not null legacy_manual_rpc_still_present,
    function_contract.exact_function
      and function_contract.owner_is_postgres
      and function_contract.security_definer
      and function_contract.fixed_search_path function_security,
    function_acl.service_execute
      and not function_acl.authenticated_execute
      and not function_acl.anon_execute
      and function_acl.public_execute_absent server_only_acl,
    trigger_contract.exact_trigger
      and trigger_contract.correct_binding immutable_evidence_trigger,
    trigger_function_contract.exact_function
      and trigger_function_contract.owner_is_postgres
      and trigger_function_contract.security_definer
      and trigger_function_contract.fixed_search_path
      and trigger_function_contract.service_execute_absent
      and trigger_function_contract.authenticated_execute_absent
      and trigger_function_contract.anon_execute_absent
      and trigger_function_contract.public_execute_absent immutable_trigger_security,
    evidence_contract.canonical_columns
      and evidence_contract.legacy_plan_nullable
      and evidence_contract.rls_enabled
      and evidence_contract.request_unique_exact
      and evidence_contract.replacement_constraints_exact
      and evidence_contract.legacy_constraints_absent
      and evidence_contract.idempotency_key_unique
      and evidence_contract.payment_reference_normalized_unique evidence_ready,
    browser_write_state.browser_write_grants = 0 browser_writes_absent,
    final_platform_acl_state.authenticated_select_preserved
      and final_platform_acl_state.authenticated_references_absent
      and final_platform_acl_state.authenticated_trigger_absent
      and final_platform_acl_state.authenticated_truncate_absent
      and final_platform_acl_state.authenticated_insert_absent
      and final_platform_acl_state.authenticated_update_absent
      and final_platform_acl_state.authenticated_delete_absent
      and final_platform_acl_state.public_anon_dangerous_absent
        platform_projection_acl_safe,
    legacy_rpc_contract.exact_identity
      and legacy_rpc_contract.owner_is_postgres
      and legacy_rpc_contract.security_definer
      and legacy_rpc_contract.fixed_search_path
      and legacy_rpc_contract.authenticated_execute
      and legacy_rpc_contract.anon_execute_absent
      and legacy_rpc_contract.service_execute_absent
      and legacy_rpc_contract.public_execute_absent
      and legacy_rpc_contract.audit_select_available
      and legacy_rpc_contract.audit_insert_available
      and legacy_rpc_contract.audit_row_lock_available
      and legacy_rpc_contract.audit_insert_and_replay_compatible
        legacy_rpc_rollout_compatible,
    commercial_schema_state.subscription_plan_code_unique subscription_plan_code_unique,
    commercial_schema_state.platform_plan_code_unique platform_plan_code_unique,
    commercial_schema_state.platform_tenant_unique platform_tenant_unique,
    platform_projection_state.target_count > 0
      and platform_projection_state.missing_count = 0
      and platform_projection_state.ambiguous_count = 0
        platform_projection_deterministic,
    historical_evidence_compatibility.plan_code_format_violation_count = 0
      and historical_evidence_compatibility.legacy_plan_format_violation_count = 0
      and historical_evidence_compatibility.currency_format_violation_count = 0
      and historical_evidence_compatibility.payment_reference_normalization_violation_count = 0
      and normalized_payment_reference_duplicates.duplicate_normalized_reference_count = 0
        historical_evidence_compatible,
    source_contract.*
  from identities
  cross join function_contract
  cross join function_acl
  cross join trigger_contract
  cross join trigger_function_contract
  cross join evidence_contract
  cross join browser_write_state
  cross join final_platform_acl_state
  cross join legacy_rpc_contract
  cross join historical_evidence_compatibility
  cross join normalized_payment_reference_duplicates
  cross join commercial_schema_state
  cross join platform_projection_state
  cross join source_contract
)
select
  1::integer verification_row_count,
  gates.*,
  legacy_rpc_contract.owner_name legacy_rpc_owner,
  legacy_rpc_contract.owner_is_postgres legacy_rpc_owner_is_postgres,
  legacy_rpc_contract.security_definer legacy_rpc_security_definer,
  legacy_rpc_contract.fixed_search_path legacy_rpc_fixed_search_path,
  legacy_rpc_contract.authenticated_execute legacy_rpc_authenticated_execute,
  legacy_rpc_contract.anon_execute_absent legacy_rpc_anon_execute_absent,
  legacy_rpc_contract.service_execute_absent legacy_rpc_service_execute_absent,
  legacy_rpc_contract.public_execute_absent legacy_rpc_public_execute_absent,
  legacy_rpc_contract.audit_insert_present legacy_audit_insert_present,
  legacy_rpc_contract.audit_update_absent legacy_audit_update_absent,
  legacy_rpc_contract.audit_delete_absent legacy_audit_delete_absent,
  legacy_rpc_contract.audit_replay_row_lock_present legacy_audit_replay_row_lock_present,
  legacy_rpc_contract.audit_replay_returns_existing legacy_audit_replay_returns_existing,
  legacy_rpc_contract.audit_insert_and_replay_compatible legacy_audit_path_compatible,
  historical_evidence_compatibility.*,
  normalized_payment_reference_duplicates.*,
  replacement_constraint_contract.*,
  request_index_contract.*,
  final_platform_acl_state.*,
  platform_projection_state.*,
  historical_manual_assignments.*,
  protected_counts.*,
  gates.new_rpc_present
    and gates.legacy_manual_rpc_still_present
    and gates.legacy_rpc_rollout_compatible
    and gates.function_security
    and gates.server_only_acl
    and gates.immutable_evidence_trigger
    and gates.immutable_trigger_security
    and gates.evidence_ready
    and gates.browser_writes_absent
    and gates.platform_projection_acl_safe
    and gates.subscription_plan_code_unique
    and gates.platform_plan_code_unique
    and gates.platform_tenant_unique
    and gates.platform_projection_deterministic
    and gates.historical_evidence_compatible
    and gates.actor_revalidation
    and gates.actor_role_revalidation
    and gates.canonical_plan
    and gates.canonical_price
    and gates.no_hardcoded_price
    and gates.no_hardcoded_plan_mapping
    and gates.database_period_derivation
    and gates.exact_grace_derivation
    and gates.durable_idempotency
    and gates.concurrency_safe
    and gates.manual_evidence_distinct
    and gates.no_provider_or_document_fabrication
    and gates.obsolete_legacy_writes_absent
    and gates.required_platform_projection
    and gates.deterministic_platform_projection
    and gates.paid_renewal_shadow_absent
    and gates.trial_conversion_only as new_manual_authority_ready,
  gates.new_rpc_present
    and gates.legacy_manual_rpc_still_present
    and gates.legacy_rpc_rollout_compatible
    and gates.function_security
    and gates.server_only_acl
    and gates.immutable_evidence_trigger
    and gates.immutable_trigger_security
    and gates.evidence_ready
    and gates.browser_writes_absent
    and gates.platform_projection_acl_safe
    and gates.subscription_plan_code_unique
    and gates.platform_plan_code_unique
    and gates.platform_tenant_unique
    and gates.platform_projection_deterministic
    and gates.historical_evidence_compatible
    and gates.actor_revalidation
    and gates.actor_role_revalidation
    and gates.canonical_plan
    and gates.canonical_price
    and gates.no_hardcoded_price
    and gates.no_hardcoded_plan_mapping
    and gates.database_period_derivation
    and gates.exact_grace_derivation
    and gates.durable_idempotency
    and gates.concurrency_safe
    and gates.manual_evidence_distinct
    and gates.no_provider_or_document_fabrication
    and gates.obsolete_legacy_writes_absent
    and gates.required_platform_projection
    and gates.deterministic_platform_projection
    and gates.paid_renewal_shadow_absent
    and gates.trial_conversion_only as security_gate
from gates
cross join legacy_rpc_contract
cross join historical_evidence_compatibility
cross join normalized_payment_reference_duplicates
cross join replacement_constraint_contract
cross join request_index_contract
cross join final_platform_acl_state
cross join platform_projection_state
cross join historical_manual_assignments
cross join protected_counts;
