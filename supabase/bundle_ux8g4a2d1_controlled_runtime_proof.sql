-- CoachFort UX-8G4A2D1: controlled Automation monthly-meter runtime proof.
--
-- PREPARATION ARTIFACT ONLY. Do not run as a migration.
-- Execute this complete file in one database session so the session-temporary
-- baseline survives the mandatory ROLLBACK for the final read-only comparison.
-- No prerequisite values need substitution. The proof selects an existing
-- authenticated Owner/Admin actor and an eligible canonical plan read-only.

-- ================================================================
-- READ-ONLY PREFLIGHT AND SESSION-TEMPORARY EVIDENCE TABLES
-- ================================================================

-- This setup transaction commits session-temporary harness state only. It
-- performs no INSERT/UPDATE/DELETE against public or coachfort_internal.
begin;

drop sequence if exists pg_temp.ux8g4a2d1_runtime_passed_seq;
drop sequence if exists pg_temp.ux8g4a2d1_runtime_failed_seq;
drop sequence if exists pg_temp.ux8g4a2d1_runtime_stage_seq;
drop table if exists pg_temp.ux8g4a2d1_runtime_context;
drop table if exists pg_temp.ux8g4a2d1_runtime_baseline;
drop table if exists pg_temp.ux8g4a2d1_expected_triggers;
drop table if exists pg_temp.ux8g4a2d1_actual_triggers;

-- Sequence increments are intentionally non-transactional. Because these
-- temporary sequences are committed before the fixture transaction, assertion
-- counts remain session-local and readable after the fixture ROLLBACK.
create temp sequence ux8g4a2d1_runtime_passed_seq start with 1;
create temp sequence ux8g4a2d1_runtime_failed_seq start with 1;
create temp sequence ux8g4a2d1_runtime_stage_seq start with 1;

create temp table ux8g4a2d1_runtime_context (
  actor_id uuid not null,
  plan_id uuid not null,
  tenant_id uuid primary key,
  assignment_id uuid not null,
  override_id uuid not null,
  success_rule_id uuid not null,
  nonbillable_rule_id uuid not null,
  failure_rule_id uuid not null,
  quota_rule_id uuid not null,
  bridge_rule_id uuid not null,
  alternate_rule_id uuid not null,
  success_condition_id uuid not null,
  success_action_id uuid not null,
  nonbillable_condition_id uuid not null,
  nonbillable_action_id uuid not null,
  failure_action_id uuid not null,
  quota_action_id uuid not null,
  bridge_action_id uuid not null,
  success_execution_id uuid not null,
  nonbillable_execution_id uuid not null,
  failure_execution_id uuid not null,
  quota_success_execution_id uuid not null,
  quota_denied_execution_id uuid not null
) on commit preserve rows;

create temp table ux8g4a2d1_runtime_baseline (
  counts jsonb not null
) on commit preserve rows;

create temp table ux8g4a2d1_expected_triggers (
  table_schema text not null,
  table_name text not null,
  trigger_name text not null,
  function_schema text not null,
  function_name text not null,
  primary key (table_schema, table_name, trigger_name)
) on commit preserve rows;

insert into ux8g4a2d1_expected_triggers values
  ('public', 'tenants', 'set_tenants_updated_at', 'public', 'set_updated_at'),
  ('public', 'tenant_subscription_assignments',
    'set_tenant_subscription_assignments_updated_at', 'public', 'set_updated_at'),
  ('public', 'tenant_subscription_overrides',
    'set_tenant_subscription_overrides_updated_at', 'public', 'set_updated_at'),
  ('public', 'tenant_subscription_overrides',
    'monthly_usage_override_authority_lock', 'coachfort_internal',
    'enforce_monthly_usage_override_authority_lock'),
  ('public', 'automation_rules', 'set_automation_rules_updated_at',
    'public', 'set_updated_at'),
  ('public', 'automation_rules', 'ux8g1b_enforce_operational_lifecycle',
    'coachfort_internal', 'enforce_tenant_operational_mutation'),
  ('public', 'automation_rule_conditions',
    'ux8g1b_enforce_operational_lifecycle', 'coachfort_internal',
    'enforce_tenant_operational_mutation'),
  ('public', 'automation_rule_actions',
    'ux8g1b_enforce_operational_lifecycle', 'coachfort_internal',
    'enforce_tenant_operational_mutation'),
  ('public', 'automation_runs', 'ux8g1b_enforce_operational_lifecycle',
    'coachfort_internal', 'enforce_tenant_operational_mutation'),
  ('public', 'automation_runs',
    'automation_runs_execution_identity_immutable', 'coachfort_internal',
    'enforce_automation_run_execution_identity'),
  ('public', 'automation_run_logs',
    'ux8g1b_enforce_operational_lifecycle', 'coachfort_internal',
    'enforce_tenant_operational_mutation'),
  ('coachfort_internal', 'monthly_usage_consumption_events',
    'monthly_usage_consumption_events_immutable', 'coachfort_internal',
    'enforce_monthly_usage_event_immutability');

create temp table ux8g4a2d1_actual_triggers on commit preserve rows as
select
  table_namespace.nspname::text table_schema,
  table_class.relname::text table_name,
  trigger.tgname::text trigger_name,
  function_namespace.nspname::text function_schema,
  procedure.proname::text function_name,
  trigger.tgenabled,
  pg_get_triggerdef(trigger.oid, true) trigger_definition,
  pg_get_functiondef(procedure.oid) function_definition
from pg_trigger trigger
join pg_class table_class on table_class.oid = trigger.tgrelid
join pg_namespace table_namespace
  on table_namespace.oid = table_class.relnamespace
join pg_proc procedure on procedure.oid = trigger.tgfoid
join pg_namespace function_namespace
  on function_namespace.oid = procedure.pronamespace
where not trigger.tgisinternal
  and (table_namespace.nspname, table_class.relname) in (
    ('public', 'tenants'),
    ('public', 'tenant_members'),
    ('public', 'tenant_subscription_assignments'),
    ('public', 'tenant_subscription_overrides'),
    ('public', 'automation_rules'),
    ('public', 'automation_rule_conditions'),
    ('public', 'automation_rule_actions'),
    ('public', 'automation_runs'),
    ('public', 'automation_run_logs'),
    ('public', 'audit_logs'),
    ('coachfort_internal', 'monthly_usage_counters'),
    ('coachfort_internal', 'monthly_usage_consumption_events')
  );

-- Reviewable trigger inventory. Expected local/transactional trigger count: 12.
select
  table_schema,
  table_name,
  trigger_name,
  tgenabled enabled_state,
  format('%I.%I()', function_schema, function_name) trigger_function,
  trigger_definition
from ux8g4a2d1_actual_triggers
order by table_schema, table_name, trigger_name;

do $$
declare
  v_drift jsonb;
  v_external_risk jsonb;
begin
  if to_regprocedure(
       'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)'
     ) is null
     or to_regprocedure(
       'public.delete_automation_rule_secure(uuid,uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
     ) is null then
    raise exception 'A2D1 runtime prerequisites are not installed.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
       from pg_constraint constraint_def
       where constraint_def.conrelid = 'public.automation_runs'::regclass
         and constraint_def.conname =
           'automation_runs_execution_identity_pair_check'
         and pg_get_constraintdef(constraint_def.oid) ilike
           '%execution_id IS NOT NULL%'
         and pg_get_constraintdef(constraint_def.oid) ilike
           '%execution_fingerprint IS NOT NULL%'
         and pg_get_constraintdef(constraint_def.oid) ilike
           '%rule_id_snapshot IS NOT NULL%'
     )
     or to_regclass(
       'public.automation_runs_tenant_rule_execution_unique_idx'
     ) is null then
    raise exception 'A2D1 execution identity contract is incomplete.'
      using errcode = '55000';
  end if;

  select jsonb_agg(to_jsonb(drift) order by drift.kind, drift.table_schema,
           drift.table_name, drift.trigger_name)
  into v_drift
  from (
    select 'missing_or_changed'::text kind, expected.*
    from ux8g4a2d1_expected_triggers expected
    left join ux8g4a2d1_actual_triggers actual
      on actual.table_schema = expected.table_schema
     and actual.table_name = expected.table_name
     and actual.trigger_name = expected.trigger_name
     and actual.function_schema = expected.function_schema
     and actual.function_name = expected.function_name
     and actual.tgenabled in ('O', 'A')
    where actual.trigger_name is null
    union all
    select
      'unexpected'::text,
      actual.table_schema,
      actual.table_name,
      actual.trigger_name,
      actual.function_schema,
      actual.function_name
    from ux8g4a2d1_actual_triggers actual
    left join ux8g4a2d1_expected_triggers expected
      on expected.table_schema = actual.table_schema
     and expected.table_name = actual.table_name
     and expected.trigger_name = actual.trigger_name
     and expected.function_schema = actual.function_schema
     and expected.function_name = actual.function_name
    where expected.trigger_name is null
  ) drift;

  if v_drift is not null then
    raise exception 'Runtime fixture trigger inventory drift: %', v_drift
      using errcode = '55000';
  end if;

  select jsonb_agg(jsonb_build_object(
    'table', format('%I.%I', table_schema, table_name),
    'trigger', trigger_name,
    'function', format('%I.%I()', function_schema, function_name)
  ))
  into v_external_risk
  from ux8g4a2d1_actual_triggers
  where function_definition ~* (
    '(pg_net|net[.]http|http_(get|post|put|delete)|webhook|resend|'
    || 'transactional_email|email_outbox|provider_dispatch)'
  );

  if v_external_risk is not null then
    raise exception 'Trigger external-side-effect risk requires review: %',
      v_external_risk using errcode = '55000';
  end if;
end;
$$;

insert into ux8g4a2d1_runtime_context
select
  actor.user_id,
  eligible_plan.plan_id,
  '8a2d1000-0000-4000-8000-000000000001'::uuid,
  '8a2d1000-0000-4000-8000-000000000002'::uuid,
  '8a2d1000-0000-4000-8000-000000000003'::uuid,
  '8a2d1000-0000-4000-8000-000000000101'::uuid,
  '8a2d1000-0000-4000-8000-000000000102'::uuid,
  '8a2d1000-0000-4000-8000-000000000103'::uuid,
  '8a2d1000-0000-4000-8000-000000000104'::uuid,
  '8a2d1000-0000-4000-8000-000000000105'::uuid,
  '8a2d1000-0000-4000-8000-000000000106'::uuid,
  '8a2d1000-0000-4000-8000-000000000201'::uuid,
  '8a2d1000-0000-4000-8000-000000000202'::uuid,
  '8a2d1000-0000-4000-8000-000000000203'::uuid,
  '8a2d1000-0000-4000-8000-000000000204'::uuid,
  '8a2d1000-0000-4000-8000-000000000205'::uuid,
  '8a2d1000-0000-4000-8000-000000000206'::uuid,
  '8a2d1000-0000-4000-8000-000000000207'::uuid,
  '8a2d1000-0000-4000-8000-000000000401'::uuid,
  '8a2d1000-0000-4000-8000-000000000402'::uuid,
  '8a2d1000-0000-4000-8000-000000000403'::uuid,
  '8a2d1000-0000-4000-8000-000000000404'::uuid,
  '8a2d1000-0000-4000-8000-000000000405'::uuid
from lateral (
  select member.user_id
  from public.tenant_members member
  join auth.users auth_user on auth_user.id = member.user_id
  where member.role in ('owner', 'admin')
  order by member.created_at, member.user_id
  limit 1
) actor
cross join lateral (
  select plan.id plan_id
  from public.subscription_plans plan
  join public.subscription_plan_feature_entitlements entitlement
    on entitlement.plan_id = plan.id
   and entitlement.feature_key = 'automations'
   and entitlement.entitlement_status = 'included'
   and not coalesce(entitlement.requires_platform_approval, false)
  join public.subscription_plan_usage_limits usage_limit
    on usage_limit.plan_id = plan.id
   and usage_limit.resource_key = 'automation_runs_monthly'
   and usage_limit.limit_type = 'monthly_count'
   and usage_limit.enforcement_mode = 'hard'
   and usage_limit.limit_value > 0
  where plan.status in ('draft', 'active')
  order by plan.tier_rank, plan.id
  limit 1
) eligible_plan;

do $$
declare
  v_context_count integer;
  v_residue_count bigint;
begin
  select count(*) into v_context_count
  from ux8g4a2d1_runtime_context;
  if v_context_count <> 1 then
    raise exception '%',
      'No unique reusable Owner/Admin actor and Automations-enabled plan '
      || 'prerequisite could be resolved.'
      using errcode = '55000';
  end if;

  select
    (select count(*) from public.tenants
      where id = '8a2d1000-0000-4000-8000-000000000001'::uuid
         or slug = 'ux8g4a2d1-runtime-proof')
    + (select count(*) from public.tenant_subscription_assignments
      where id = '8a2d1000-0000-4000-8000-000000000002'::uuid)
    + (select count(*) from public.tenant_subscription_overrides
      where id = '8a2d1000-0000-4000-8000-000000000003'::uuid)
    + (select count(*) from public.automation_rules
      where id::text like '8a2d1000-0000-4000-8000-00000000010%')
    + (select count(*) from public.automation_rule_conditions
      where id::text like '8a2d1000-0000-4000-8000-00000000020%')
    + (select count(*) from public.automation_rule_actions
      where id::text like '8a2d1000-0000-4000-8000-00000000020%')
    + (select count(*) from public.automation_runs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_run_logs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from coachfort_internal.monthly_usage_counters
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*)
      from coachfort_internal.monthly_usage_consumption_events
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
  into v_residue_count;

  if v_residue_count <> 0 then
    raise exception 'Synthetic runtime proof identifiers already exist.'
      using errcode = '55000';
  end if;
end;
$$;

insert into ux8g4a2d1_runtime_baseline (counts)
select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'tenants', (select count(*) from public.tenants),
  'tenant_members', (select count(*) from public.tenant_members),
  'subscription_plans', (select count(*) from public.subscription_plans),
  'plan_feature_entitlements',
    (select count(*) from public.subscription_plan_feature_entitlements),
  'plan_usage_limits',
    (select count(*) from public.subscription_plan_usage_limits),
  'tenant_subscription_assignments',
    (select count(*) from public.tenant_subscription_assignments),
  'tenant_subscription_overrides',
    (select count(*) from public.tenant_subscription_overrides),
  'automation_rules', (select count(*) from public.automation_rules),
  'automation_rule_conditions',
    (select count(*) from public.automation_rule_conditions),
  'automation_rule_actions',
    (select count(*) from public.automation_rule_actions),
  'automation_runs', (select count(*) from public.automation_runs),
  'automation_run_logs', (select count(*) from public.automation_run_logs),
  'notifications', (select count(*) from public.notifications),
  'reminders', (select count(*) from public.reminders),
  'communication_logs', (select count(*) from public.communication_logs),
  'audit_logs', (select count(*) from public.audit_logs),
  'monthly_usage_counters',
    (select count(*) from coachfort_internal.monthly_usage_counters),
  'monthly_usage_consumption_events',
    (select count(*)
     from coachfort_internal.monthly_usage_consumption_events),
  'transactional_email_outbox',
    (select count(*)
     from coachfort_internal.transactional_email_outbox),
  'transactional_email_attempts',
    (select count(*)
     from coachfort_internal.transactional_email_attempts),
  'transactional_email_provider_events',
    (select count(*)
     from coachfort_internal.transactional_email_provider_events),
  'transactional_email_suppressions',
    (select count(*)
     from coachfort_internal.transactional_email_suppressions),
  'subscription_lifecycle_reminder_deliveries',
    (select count(*)
     from coachfort_internal.subscription_lifecycle_reminder_deliveries)
);

select counts baseline_counts
from ux8g4a2d1_runtime_baseline;

-- Commit only temporary harness objects/data and read-only preflight results.
commit;

-- ================================================================
-- CONTROLLED RUNTIME PROOF. EVERY FIXTURE WRITE IS BELOW BEGIN.
-- ================================================================

begin;

do $$
declare
  v_ctx ux8g4a2d1_runtime_context%rowtype;
  v_result record;
  v_run public.automation_runs%rowtype;
  v_bridge_run public.automation_runs%rowtype;
  v_success_run_id uuid;
  v_success_fingerprint text;
  v_success_log_count bigint;
  v_meter_events bigint;
  v_meter_amount bigint;
  v_before_runs bigint;
  v_before_logs bigint;
  v_before_events bigint;
  v_before_amount bigint;
  v_before_reminders bigint;
  v_rejected boolean;
  v_deleted_rule uuid;
  v_lifecycle jsonb;
begin
  select * into strict v_ctx from ux8g4a2d1_runtime_context;

  perform set_config('request.jwt.claim.sub', v_ctx.actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_ctx.actor_id,
      'role', 'authenticated'
    )::text,
    true
  );

  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 10, true);
  insert into public.tenants (
    id, name, slug, category, owner_user_id,
    trial_started_at, trial_ends_at, is_trial_active
  ) values (
    v_ctx.tenant_id,
    'UX-8G4A2D1 Runtime Proof',
    'ux8g4a2d1-runtime-proof',
    'education',
    v_ctx.actor_id,
    statement_timestamp() - interval '7 days',
    statement_timestamp() + interval '3 days',
    true
  );

  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 20, true);
  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_ctx.tenant_id, v_ctx.actor_id, 'owner');

  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 30, true);
  insert into public.tenant_subscription_assignments (
    id, tenant_id, plan_id, status, billing_cycle, currency,
    trial_started_at, trial_ends_at,
    current_period_start, current_period_end, grace_period_ends_at,
    payment_status, source, is_current, metadata_json,
    created_by, updated_by
  ) values (
    v_ctx.assignment_id,
    v_ctx.tenant_id,
    v_ctx.plan_id,
    'active',
    'monthly',
    'INR',
    null,
    null,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '30 days',
    statement_timestamp() + interval '37 days',
    'paid',
    'migration',
    true,
    jsonb_build_object(
      'fixture', 'ux8g4a2d1_runtime_proof',
      'rollbackRequired', true
    ),
    v_ctx.actor_id,
    v_ctx.actor_id
  );

  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 40, true);
  insert into public.tenant_subscription_overrides (
    id, tenant_id, override_type, resource_key, feature_key,
    override_value_json, reason, expires_at, approved_by, metadata_json
  ) values (
    v_ctx.override_id,
    v_ctx.tenant_id,
    'limit_lower',
    'automation_runs_monthly',
    null,
    jsonb_build_object('limit_value', 10),
    'UX-8G4A2D1 rollback-only runtime meter proof',
    statement_timestamp() + interval '1 hour',
    v_ctx.actor_id,
    jsonb_build_object('fixture', 'ux8g4a2d1_runtime_proof')
  );

  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 50, true);
  select coachfort_internal.tenant_subscription_effective_lifecycle(
    v_ctx.tenant_id
  ) into strict v_lifecycle;
  if v_lifecycle->>'effective_state' <> 'active'
     or not coalesce((v_lifecycle->>'operational_allowed')::boolean, false) then
    raise exception 'Synthetic lifecycle did not resolve ACTIVE.'
      using errcode = '55000';
  end if;
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 60, true);
  perform coachfort_internal.assert_effective_operational_feature(
    v_ctx.tenant_id,
    'automations'
  );
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 70, true);
  if coachfort_internal.resolve_monthly_usage_limit(
       v_ctx.tenant_id, 'automation_runs_monthly'
     ) <> 10 then
    raise exception 'Synthetic monthly limit did not resolve to 10.'
      using errcode = '55000';
  end if;
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 80, true);
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');

  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 90, true);
  insert into public.automation_rules (
    id, tenant_id, name, description, trigger_type, action_type,
    is_active, status, execution_mode, config, created_by, metadata_json
  ) values
    (v_ctx.success_rule_id, v_ctx.tenant_id, 'Runtime success rule',
      'Rollback-only request-aware success/replay/delete proof.',
      'trial_expiring', 'add_internal_note', true, 'active', 'instant',
      '{}'::jsonb, v_ctx.actor_id, '{"fixture":"ux8g4a2d1"}'::jsonb),
    (v_ctx.nonbillable_rule_id, v_ctx.tenant_id,
      'Runtime nonbillable rule', 'Rollback-only condition-miss proof.',
      'trial_expiring', 'add_internal_note', false, 'draft', 'instant',
      '{}'::jsonb, v_ctx.actor_id, '{"fixture":"ux8g4a2d1"}'::jsonb),
    (v_ctx.failure_rule_id, v_ctx.tenant_id, 'Runtime action-failure rule',
      'Rollback-only accepted downstream failure proof.',
      'trial_expiring', 'create_reminder', false, 'draft', 'instant',
      '{}'::jsonb, v_ctx.actor_id, '{"fixture":"ux8g4a2d1"}'::jsonb),
    (v_ctx.quota_rule_id, v_ctx.tenant_id, 'Runtime quota rule',
      'Rollback-only exact quota-boundary proof.',
      'trial_expiring', 'add_internal_note', false, 'draft', 'instant',
      '{}'::jsonb, v_ctx.actor_id, '{"fixture":"ux8g4a2d1"}'::jsonb),
    (v_ctx.bridge_rule_id, v_ctx.tenant_id, 'Runtime bridge rule',
      'Rollback-only five-argument compatibility proof.',
      'trial_expiring', 'add_internal_note', false, 'draft', 'instant',
      '{}'::jsonb, v_ctx.actor_id, '{"fixture":"ux8g4a2d1"}'::jsonb),
    (v_ctx.alternate_rule_id, v_ctx.tenant_id, 'Runtime alternate parent',
      'Rollback-only identity reassignment target.',
      'trial_expiring', 'add_internal_note', false, 'draft', 'instant',
      '{}'::jsonb, v_ctx.actor_id, '{"fixture":"ux8g4a2d1"}'::jsonb);

  insert into public.automation_rule_conditions (
    id, tenant_id, rule_id, condition_type, operator, value_json, sort_order
  ) values
    (v_ctx.success_condition_id, v_ctx.tenant_id, v_ctx.success_rule_id,
      'equals', 'equals',
      '{"field":"metadata.allow","value":"yes"}'::jsonb, 0),
    (v_ctx.nonbillable_condition_id, v_ctx.tenant_id,
      v_ctx.nonbillable_rule_id, 'equals', 'equals',
      '{"field":"metadata.allow","value":"yes"}'::jsonb, 0);

  insert into public.automation_rule_actions (
    id, tenant_id, rule_id, action_type, config_json, sort_order
  ) values
    (v_ctx.success_action_id, v_ctx.tenant_id, v_ctx.success_rule_id,
      'add_internal_note', '{"message":"rollback-only"}'::jsonb, 0),
    (v_ctx.nonbillable_action_id, v_ctx.tenant_id,
      v_ctx.nonbillable_rule_id, 'add_internal_note',
      '{"message":"must not execute"}'::jsonb, 0),
    (v_ctx.failure_action_id, v_ctx.tenant_id, v_ctx.failure_rule_id,
      'create_reminder',
      '{"title":"Rollback only","due_offset_days":"invalid"}'::jsonb, 0),
    (v_ctx.quota_action_id, v_ctx.tenant_id, v_ctx.quota_rule_id,
      'add_internal_note', '{"message":"rollback-only"}'::jsonb, 0),
    (v_ctx.bridge_action_id, v_ctx.tenant_id, v_ctx.bridge_rule_id,
      'add_internal_note', '{"message":"rollback-only"}'::jsonb, 0);

  -- C. Canonical six-argument request-aware success.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 100, true);
  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id,
    'trial_expiring',
    'tenant',
    v_ctx.tenant_id,
    '{"allow":"yes","case":"success"}'::jsonb,
    v_ctx.success_execution_id
  );
  if v_result.executed_count <> 1
     or v_result.skipped_count <> 0
     or v_result.failed_count <> 0
     or v_result.quota_denied_count <> 0 then
    raise exception 'Request-aware success result was unexpected: %',
      to_jsonb(v_result) using errcode = '55000';
  end if;

  select * into strict v_run
  from public.automation_runs run
  where run.tenant_id = v_ctx.tenant_id
    and run.rule_id_snapshot = v_ctx.success_rule_id
    and run.execution_id = v_ctx.success_execution_id;
  v_success_run_id := v_run.id;
  v_success_fingerprint := v_run.execution_fingerprint;

  select count(*) into v_success_log_count
  from public.automation_run_logs log
  where log.run_id = v_success_run_id;
  select count(*), coalesce(sum(event.amount), 0)
  into v_meter_events, v_meter_amount
  from coachfort_internal.monthly_usage_consumption_events event
  where event.tenant_id = v_ctx.tenant_id
    and event.resource_key = 'automation_runs_monthly';

  if v_run.status <> 'success'
     or v_run.rule_id <> v_ctx.success_rule_id
     or v_run.rule_id_snapshot <> v_ctx.success_rule_id
     or v_run.execution_id <> v_ctx.success_execution_id
     or v_run.execution_fingerprint !~ '^[0-9a-f]{64}$'
     or v_success_log_count <> 2
     or v_meter_events <> 1
     or v_meter_amount <> 1
     or not exists (
       select 1
       from coachfort_internal.monthly_usage_consumption_events event
       where event.tenant_id = v_ctx.tenant_id
         and event.resource_key = 'automation_runs_monthly'
         and event.event_key =
           'automation:' || v_ctx.success_execution_id::text || ':'
             || v_ctx.success_rule_id::text
         and event.amount = 1
     ) then
    raise exception 'Request-aware success evidence was incomplete.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');

  -- D. Exact replay reuses the same business execution and meter evidence.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 110, true);
  select count(*) into v_before_runs
  from public.automation_runs where tenant_id = v_ctx.tenant_id;
  select count(*) into v_before_logs
  from public.automation_run_logs where tenant_id = v_ctx.tenant_id;
  select count(*), coalesce(sum(amount), 0)
  into v_before_events, v_before_amount
  from coachfort_internal.monthly_usage_consumption_events
  where tenant_id = v_ctx.tenant_id
    and resource_key = 'automation_runs_monthly';

  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id, 'trial_expiring', 'tenant', v_ctx.tenant_id,
    '{"allow":"yes","case":"success"}'::jsonb,
    v_ctx.success_execution_id
  );
  if v_result.executed_count <> 1
     or (select count(*) from public.automation_runs
         where tenant_id = v_ctx.tenant_id) <> v_before_runs
     or (select count(*) from public.automation_run_logs
         where tenant_id = v_ctx.tenant_id) <> v_before_logs
     or (select count(*)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id
           and resource_key = 'automation_runs_monthly') <> v_before_events
     or (select coalesce(sum(amount), 0)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id
           and resource_key = 'automation_runs_monthly') <> v_before_amount then
    raise exception 'Exact replay duplicated business or meter evidence.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');

  -- E. Conflicting reuse fails with no run, meter, action, or log delta.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 120, true);
  v_rejected := false;
  begin
    perform *
    from public.run_automation_trigger(
      v_ctx.tenant_id, 'trial_expiring', 'tenant', v_ctx.tenant_id,
      '{"allow":"yes","case":"materially-different"}'::jsonb,
      v_ctx.success_execution_id
    );
  exception when sqlstate '22023' then
    if sqlerrm = 'Automation execution id conflicts with prior execution.' then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected
     or (select count(*) from public.automation_runs
         where tenant_id = v_ctx.tenant_id) <> v_before_runs
     or (select count(*) from public.automation_run_logs
         where tenant_id = v_ctx.tenant_id) <> v_before_logs
     or (select count(*)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> v_before_events then
    raise exception 'Conflicting execution reuse did not fail cleanly.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');

  update public.automation_rules
  set status = 'inactive', is_active = false
  where id = v_ctx.success_rule_id;

  -- F. Deterministic condition miss persists skipped history but consumes zero.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 130, true);
  update public.automation_rules
  set status = 'active', is_active = true
  where id = v_ctx.nonbillable_rule_id;
  select count(*) into v_before_events
  from coachfort_internal.monthly_usage_consumption_events
  where tenant_id = v_ctx.tenant_id;
  select coalesce(sum(amount), 0) into v_before_amount
  from coachfort_internal.monthly_usage_consumption_events
  where tenant_id = v_ctx.tenant_id;

  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id, 'trial_expiring', 'tenant', v_ctx.tenant_id,
    '{"allow":"no","case":"condition-miss"}'::jsonb,
    v_ctx.nonbillable_execution_id
  );
  if v_result.executed_count <> 0
     or v_result.skipped_count <> 1
     or v_result.failed_count <> 0
     or v_result.quota_denied_count <> 0
     or (select count(*) from public.automation_runs run
         where run.tenant_id = v_ctx.tenant_id
           and run.execution_id = v_ctx.nonbillable_execution_id
           and run.status = 'skipped') <> 1
     or (select count(*) from public.automation_run_logs log
         join public.automation_runs run on run.id = log.run_id
         where run.execution_id = v_ctx.nonbillable_execution_id
           and log.log_level = 'warning') <> 1
     or (select count(*)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> v_before_events
     or (select coalesce(sum(amount), 0)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> v_before_amount then
    raise exception 'Condition-miss billing contract was not preserved.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');
  update public.automation_rules
  set status = 'inactive', is_active = false
  where id = v_ctx.nonbillable_rule_id;

  -- H. Accepted action failure keeps one unit and a durable failed run.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 140, true);
  update public.automation_rules
  set status = 'active', is_active = true
  where id = v_ctx.failure_rule_id;
  select count(*) into v_before_reminders from public.reminders;
  select coalesce(sum(amount), 0) into v_before_amount
  from coachfort_internal.monthly_usage_consumption_events
  where tenant_id = v_ctx.tenant_id;

  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id, 'trial_expiring', 'tenant', v_ctx.tenant_id,
    '{"case":"accepted-action-failure"}'::jsonb,
    v_ctx.failure_execution_id
  );
  if v_result.executed_count <> 0
     or v_result.failed_count <> 1
     or v_result.quota_denied_count <> 0
     or (select count(*) from public.automation_runs run
         where run.execution_id = v_ctx.failure_execution_id
           and run.status = 'failed'
           and run.error_message is not null) <> 1
     or (select count(*) from public.automation_run_logs log
         join public.automation_runs run on run.id = log.run_id
         where run.execution_id = v_ctx.failure_execution_id
           and log.log_level = 'error') <> 1
     or (select coalesce(sum(amount), 0)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> v_before_amount + 1
     or (select count(*) from public.reminders) <> v_before_reminders then
    raise exception 'Accepted action-failure evidence was unexpected.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');
  update public.automation_rules
  set status = 'inactive', is_active = false
  where id = v_ctx.failure_rule_id;

  -- G. Lower the isolated tenant limit to 3: unit 3 succeeds, unit 4 denies.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 150, true);
  update public.tenant_subscription_overrides
  set override_value_json = '{"limit_value":3}'::jsonb
  where id = v_ctx.override_id;
  if coachfort_internal.resolve_monthly_usage_limit(
       v_ctx.tenant_id, 'automation_runs_monthly'
     ) <> 3 then
    raise exception 'Quota proof limit did not resolve to 3.'
      using errcode = '55000';
  end if;
  update public.automation_rules
  set status = 'active', is_active = true
  where id = v_ctx.quota_rule_id;

  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id, 'trial_expiring', 'tenant', v_ctx.tenant_id,
    '{"case":"final-available-unit"}'::jsonb,
    v_ctx.quota_success_execution_id
  );
  if v_result.executed_count <> 1
     or (select coalesce(sum(amount), 0)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> 3 then
    raise exception 'Final available Automation unit did not succeed.'
      using errcode = '55000';
  end if;

  -- Move only synthetic timing to avoid the existing five-minute debounce.
  update public.automation_runs
  set started_at = statement_timestamp() - interval '10 minutes'
  where tenant_id = v_ctx.tenant_id
    and execution_id = v_ctx.quota_success_execution_id;
  select count(*) into v_before_runs
  from public.automation_runs where tenant_id = v_ctx.tenant_id;
  select count(*) into v_before_logs
  from public.automation_run_logs where tenant_id = v_ctx.tenant_id;
  select count(*) into v_before_events
  from coachfort_internal.monthly_usage_consumption_events
  where tenant_id = v_ctx.tenant_id;

  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id, 'trial_expiring', 'tenant', v_ctx.tenant_id,
    '{"case":"quota-denied"}'::jsonb,
    v_ctx.quota_denied_execution_id
  );
  if v_result.executed_count <> 0
     or v_result.skipped_count <> 1
     or v_result.failed_count <> 0
     or v_result.quota_denied_count <> 1
     or (select count(*) from public.automation_runs
         where tenant_id = v_ctx.tenant_id) <> v_before_runs
     or (select count(*) from public.automation_runs
         where execution_id = v_ctx.quota_denied_execution_id) <> 0
     or (select count(*) from public.automation_run_logs
         where tenant_id = v_ctx.tenant_id) <> v_before_logs
     or (select count(*)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> v_before_events
     or (select coalesce(sum(amount), 0)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> 3 then
    raise exception 'Quota denial left accepted business or meter residue.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');
  update public.automation_rules
  set status = 'inactive', is_active = false
  where id = v_ctx.quota_rule_id;

  -- J. Identity-bearing runs reject every unauthorized identity mutation.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 160, true);
  v_rejected := false;
  begin
    update public.automation_runs
    set rule_id_snapshot = v_ctx.alternate_rule_id
    where id = v_success_run_id;
  exception when sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'rule_id_snapshot tamper was accepted.' using errcode = '55000';
  end if;

  v_rejected := false;
  begin
    update public.automation_runs
    set execution_id = gen_random_uuid()
    where id = v_success_run_id;
  exception when sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'execution_id tamper was accepted.' using errcode = '55000';
  end if;

  v_rejected := false;
  begin
    update public.automation_runs
    set execution_fingerprint = repeat('a', 64)
    where id = v_success_run_id;
  exception when sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'execution_fingerprint tamper was accepted.'
      using errcode = '55000';
  end if;

  v_rejected := false;
  begin
    update public.automation_runs
    set rule_id = v_ctx.alternate_rule_id
    where id = v_success_run_id;
  exception when sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Rule A to Rule B reassignment was accepted.'
      using errcode = '55000';
  end if;

  v_rejected := false;
  begin
    update public.automation_runs
    set rule_id = null
    where id = v_success_run_id;
  exception when sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Arbitrary parent removal was accepted while parent existed.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.automation_runs run
    where run.id = v_success_run_id
      and run.rule_id = v_ctx.success_rule_id
      and run.rule_id_snapshot = v_ctx.success_rule_id
      and run.execution_id = v_ctx.success_execution_id
      and run.execution_fingerprint = v_success_fingerprint
  ) then
    raise exception 'Identity changed after rejected tamper attempts.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');

  -- I. Canonical rule delete must preserve run/log/meter identity history.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 170, true);
  select public.delete_automation_rule_secure(
    v_ctx.tenant_id,
    v_ctx.success_rule_id
  ) into strict v_deleted_rule;
  if v_deleted_rule <> v_ctx.success_rule_id
     or exists (
       select 1 from public.automation_rules
       where id = v_ctx.success_rule_id
     )
     or exists (
       select 1 from public.automation_rule_conditions
       where rule_id = v_ctx.success_rule_id
     )
     or exists (
       select 1 from public.automation_rule_actions
       where rule_id = v_ctx.success_rule_id
     )
     or not exists (
       select 1 from public.automation_runs run
       where run.id = v_success_run_id
         and run.rule_id is null
         and run.rule_id_snapshot = v_ctx.success_rule_id
         and run.execution_id = v_ctx.success_execution_id
         and run.execution_fingerprint = v_success_fingerprint
     )
     or (select count(*) from public.automation_run_logs
         where run_id = v_success_run_id) <> v_success_log_count
     or not exists (
       select 1
       from coachfort_internal.monthly_usage_consumption_events event
       where event.tenant_id = v_ctx.tenant_id
         and event.event_key =
           'automation:' || v_ctx.success_execution_id::text || ':'
             || v_ctx.success_rule_id::text
         and event.amount = 1
     ) then
    raise exception 'Canonical rule delete did not preserve execution history.'
      using errcode = '55000';
  end if;

  v_rejected := false;
  begin
    update public.automation_runs
    set rule_id = v_ctx.alternate_rule_id
    where id = v_success_run_id;
  exception when sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'NULL rule_id reattachment was accepted.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');

  -- K. Five-argument bridge remains compatible and cannot bypass quota.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 180, true);
  update public.tenant_subscription_overrides
  set override_value_json = '{"limit_value":4}'::jsonb
  where id = v_ctx.override_id;
  update public.automation_rules
  set status = 'active', is_active = true
  where id = v_ctx.bridge_rule_id;

  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id,
    'trial_expiring',
    'tenant',
    v_ctx.tenant_id,
    '{"case":"five-argument-bridge"}'::jsonb
  );
  select * into strict v_bridge_run
  from public.automation_runs run
  where run.tenant_id = v_ctx.tenant_id
    and run.rule_id_snapshot = v_ctx.bridge_rule_id;
  if v_result.executed_count <> 1
     or v_result.skipped_count <> 0
     or v_result.failed_count <> 0
     or v_bridge_run.status <> 'success'
     or v_bridge_run.execution_id is null
     or v_bridge_run.execution_fingerprint !~ '^[0-9a-f]{64}$'
     or (select coalesce(sum(amount), 0)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> 4
     or not exists (
       select 1
       from coachfort_internal.monthly_usage_consumption_events event
       where event.tenant_id = v_ctx.tenant_id
         and event.event_key =
           'automation:' || v_bridge_run.execution_id::text || ':'
             || v_ctx.bridge_rule_id::text
         and event.amount = 1
     ) then
    raise exception 'Five-argument bridge did not meter one accepted run.'
      using errcode = '55000';
  end if;

  -- A fresh bridge invocation at the now-exhausted limit must not bypass the
  -- meter. Its server-generated request id intentionally is not replayable by
  -- the caller, so only zero accepted residue is asserted here.
  update public.automation_runs
  set started_at = statement_timestamp() - interval '10 minutes'
  where id = v_bridge_run.id;
  select count(*) into v_before_runs
  from public.automation_runs where tenant_id = v_ctx.tenant_id;
  select count(*) into v_before_logs
  from public.automation_run_logs where tenant_id = v_ctx.tenant_id;
  select count(*) into v_before_events
  from coachfort_internal.monthly_usage_consumption_events
  where tenant_id = v_ctx.tenant_id;

  select * into strict v_result
  from public.run_automation_trigger(
    v_ctx.tenant_id,
    'trial_expiring',
    'tenant',
    v_ctx.tenant_id,
    '{"case":"five-argument-quota-denial"}'::jsonb
  );
  if v_result.executed_count <> 0
     or v_result.skipped_count <> 1
     or v_result.failed_count <> 0
     or (select count(*) from public.automation_runs
         where tenant_id = v_ctx.tenant_id) <> v_before_runs
     or (select count(*) from public.automation_run_logs
         where tenant_id = v_ctx.tenant_id) <> v_before_logs
     or (select count(*)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> v_before_events
     or (select coalesce(sum(amount), 0)
         from coachfort_internal.monthly_usage_consumption_events
         where tenant_id = v_ctx.tenant_id) <> 4 then
    raise exception 'Five-argument bridge bypassed the exhausted meter.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');

  -- No selected action may have produced communication/delivery side effects.
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 190, true);
  if (select count(*) from public.notifications) <>
       ((select counts from ux8g4a2d1_runtime_baseline)
         ->> 'notifications')::bigint
     or (select count(*) from public.reminders) <>
       ((select counts from ux8g4a2d1_runtime_baseline)
         ->> 'reminders')::bigint
     or (select count(*) from public.communication_logs) <>
       ((select counts from ux8g4a2d1_runtime_baseline)
         ->> 'communication_logs')::bigint
     or (select count(*)
         from coachfort_internal.transactional_email_outbox) <>
       ((select counts from ux8g4a2d1_runtime_baseline)
         ->> 'transactional_email_outbox')::bigint
     or (select count(*)
         from coachfort_internal.subscription_lifecycle_reminder_deliveries) <>
       ((select counts from ux8g4a2d1_runtime_baseline)
         ->> 'subscription_lifecycle_reminder_deliveries')::bigint then
    raise exception 'Runtime proof created forbidden communication evidence.'
      using errcode = '55000';
  end if;
  perform nextval('pg_temp.ux8g4a2d1_runtime_passed_seq');
  perform setval('pg_temp.ux8g4a2d1_runtime_stage_seq', 200, true);

exception when others then
  -- Entering this handler rolls the entire DO block's fixture DML back to its
  -- implicit subtransaction savepoint. Sequence increments are not rolled
  -- back, so the final post-ROLLBACK result still reports the failure.
  perform nextval('pg_temp.ux8g4a2d1_runtime_failed_seq');
  raise warning 'UX-8G4A2D1 runtime assertion failed [%]: %', sqlstate, sqlerrm;
end;
$$;

-- Mandatory: no synthetic fixture or proof evidence may commit.
rollback;

-- ================================================================
-- AFTER-ROLLBACK READ-ONLY VERIFICATION (SAME DATABASE SESSION)
-- ================================================================

do $$
declare
  v_before jsonb;
  v_after jsonb;
  v_residue bigint;
begin
  select counts into strict v_before
  from ux8g4a2d1_runtime_baseline;

  select jsonb_build_object(
    'auth_users', (select count(*) from auth.users),
    'profiles', (select count(*) from public.profiles),
    'tenants', (select count(*) from public.tenants),
    'tenant_members', (select count(*) from public.tenant_members),
    'subscription_plans', (select count(*) from public.subscription_plans),
    'plan_feature_entitlements',
      (select count(*) from public.subscription_plan_feature_entitlements),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits),
    'tenant_subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'tenant_subscription_overrides',
      (select count(*) from public.tenant_subscription_overrides),
    'automation_rules', (select count(*) from public.automation_rules),
    'automation_rule_conditions',
      (select count(*) from public.automation_rule_conditions),
    'automation_rule_actions',
      (select count(*) from public.automation_rule_actions),
    'automation_runs', (select count(*) from public.automation_runs),
    'automation_run_logs', (select count(*) from public.automation_run_logs),
    'notifications', (select count(*) from public.notifications),
    'reminders', (select count(*) from public.reminders),
    'communication_logs', (select count(*) from public.communication_logs),
    'audit_logs', (select count(*) from public.audit_logs),
    'monthly_usage_counters',
      (select count(*) from coachfort_internal.monthly_usage_counters),
    'monthly_usage_consumption_events',
      (select count(*)
       from coachfort_internal.monthly_usage_consumption_events),
    'transactional_email_outbox',
      (select count(*)
       from coachfort_internal.transactional_email_outbox),
    'transactional_email_attempts',
      (select count(*)
       from coachfort_internal.transactional_email_attempts),
    'transactional_email_provider_events',
      (select count(*)
       from coachfort_internal.transactional_email_provider_events),
    'transactional_email_suppressions',
      (select count(*)
       from coachfort_internal.transactional_email_suppressions),
    'subscription_lifecycle_reminder_deliveries',
      (select count(*)
       from coachfort_internal.subscription_lifecycle_reminder_deliveries)
  ) into v_after;

  select
    (select count(*) from public.tenants
      where id = '8a2d1000-0000-4000-8000-000000000001'::uuid
         or slug = 'ux8g4a2d1-runtime-proof')
    + (select count(*) from public.tenant_members
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.tenant_subscription_assignments
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.tenant_subscription_overrides
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_rules
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_rule_conditions
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_rule_actions
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_runs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_run_logs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.audit_logs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from coachfort_internal.monthly_usage_counters
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*)
      from coachfort_internal.monthly_usage_consumption_events
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*)
      from coachfort_internal.transactional_email_outbox
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*)
      from coachfort_internal.subscription_lifecycle_reminder_deliveries
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
  into v_residue;

  if v_before is distinct from v_after then
    raise exception 'Global counts did not return to baseline. Before %, after %',
      v_before, v_after using errcode = '55000';
  end if;
  if v_residue <> 0 then
    raise exception 'Synthetic runtime fixture residue remains: % rows', v_residue
      using errcode = '55000';
  end if;
end;
$$;

with after_counts as (
  select jsonb_build_object(
    'auth_users', (select count(*) from auth.users),
    'profiles', (select count(*) from public.profiles),
    'tenants', (select count(*) from public.tenants),
    'tenant_members', (select count(*) from public.tenant_members),
    'subscription_plans', (select count(*) from public.subscription_plans),
    'plan_feature_entitlements',
      (select count(*) from public.subscription_plan_feature_entitlements),
    'plan_usage_limits',
      (select count(*) from public.subscription_plan_usage_limits),
    'tenant_subscription_assignments',
      (select count(*) from public.tenant_subscription_assignments),
    'tenant_subscription_overrides',
      (select count(*) from public.tenant_subscription_overrides),
    'automation_rules', (select count(*) from public.automation_rules),
    'automation_rule_conditions',
      (select count(*) from public.automation_rule_conditions),
    'automation_rule_actions',
      (select count(*) from public.automation_rule_actions),
    'automation_runs', (select count(*) from public.automation_runs),
    'automation_run_logs', (select count(*) from public.automation_run_logs),
    'notifications', (select count(*) from public.notifications),
    'reminders', (select count(*) from public.reminders),
    'communication_logs', (select count(*) from public.communication_logs),
    'audit_logs', (select count(*) from public.audit_logs),
    'monthly_usage_counters',
      (select count(*) from coachfort_internal.monthly_usage_counters),
    'monthly_usage_consumption_events',
      (select count(*)
       from coachfort_internal.monthly_usage_consumption_events),
    'transactional_email_outbox',
      (select count(*)
       from coachfort_internal.transactional_email_outbox),
    'transactional_email_attempts',
      (select count(*)
       from coachfort_internal.transactional_email_attempts),
    'transactional_email_provider_events',
      (select count(*)
       from coachfort_internal.transactional_email_provider_events),
    'transactional_email_suppressions',
      (select count(*)
       from coachfort_internal.transactional_email_suppressions),
    'subscription_lifecycle_reminder_deliveries',
      (select count(*)
       from coachfort_internal.subscription_lifecycle_reminder_deliveries)
  ) counts
), residue as (
  select
    (select count(*) from public.tenants
      where id = '8a2d1000-0000-4000-8000-000000000001'::uuid
         or slug = 'ux8g4a2d1-runtime-proof')
    + (select count(*) from public.tenant_members
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.tenant_subscription_assignments
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.tenant_subscription_overrides
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_rules
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_rule_conditions
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_rule_actions
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_runs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.automation_run_logs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from public.audit_logs
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*) from coachfort_internal.monthly_usage_counters
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*)
      from coachfort_internal.monthly_usage_consumption_events
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*)
      from coachfort_internal.transactional_email_outbox
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    + (select count(*)
      from coachfort_internal.subscription_lifecycle_reminder_deliveries
      where tenant_id = '8a2d1000-0000-4000-8000-000000000001'::uuid)
    as synthetic_residue_count
), assertion_counts as (
  select
    case when passed.is_called then passed.last_value else 0 end
      as passed_count,
    case when failed.is_called then failed.last_value else 0 end
      as failed_count
  from pg_temp.ux8g4a2d1_runtime_passed_seq passed
  cross join pg_temp.ux8g4a2d1_runtime_failed_seq failed
), stage_state as (
  select
    case when stage.is_called then stage.last_value else 0 end last_stage_code
  from pg_temp.ux8g4a2d1_runtime_stage_seq stage
)
select
  assertion_counts.passed_count = 11
    and assertion_counts.failed_count = 0 runtime_proof_passed,
  assertion_counts.passed_count + assertion_counts.failed_count
    assertion_count,
  assertion_counts.passed_count,
  assertion_counts.failed_count,
  stage_state.last_stage_code,
  case stage_state.last_stage_code
    when 10 then 'tenant_insert'
    when 20 then 'tenant_member_insert'
    when 30 then 'subscription_assignment_insert'
    when 40 then 'usage_override_insert'
    when 50 then 'lifecycle_resolution'
    when 60 then 'automations_feature_assertion'
    when 70 then 'monthly_limit_resolution'
    when 80 then 'fixture_authority_passed'
    when 90 then 'automation_fixture_definition'
    when 100 then 'request_aware_success'
    when 110 then 'exact_replay'
    when 120 then 'conflicting_reuse'
    when 130 then 'nonbillable_condition_miss'
    when 140 then 'accepted_action_failure'
    when 150 then 'quota_boundary'
    when 160 then 'identity_tamper'
    when 170 then 'rule_delete_history'
    when 180 then 'five_argument_bridge'
    when 190 then 'external_side_effect_guard'
    when 200 then 'runtime_proof_completed'
    else 'not_started'
  end last_stage_name,
  baseline.counts baseline_counts,
  after_counts.counts after_rollback_counts,
  baseline.counts = after_counts.counts baseline_restored,
  residue.synthetic_residue_count,
  residue.synthetic_residue_count = 0 zero_fixture_residue,
  true mandatory_rollback_completed
from ux8g4a2d1_runtime_baseline baseline
cross join after_counts
cross join residue
cross join assertion_counts
cross join stage_state;

-- Expected checklist when reviewed and later executed as one session:
-- 1. trigger inventory returns exactly the 12 allowlisted local triggers;
-- 2. runtime_proof_passed=true, assertion_count=11, failed_count=0;
--    last_stage_code=200, last_stage_name=runtime_proof_completed;
-- 3. success consumes one unit and exact replay consumes none;
-- 4. conflicting reuse returns SQLSTATE 22023 with no residue;
-- 5. condition miss persists one skipped run and consumes zero units;
-- 6. accepted action failure persists one failed run and one unit;
-- 7. unit 3 succeeds and unit 4 is quota-denied without run/log residue;
-- 8. all five pre-delete identity tamper attempts are rejected;
-- 9. canonical rule delete leaves the run/log/meter identity intact and
--    permits only the FK-driven rule_id transition to NULL;
-- 10. NULL-to-rule reattachment is rejected;
-- 11. the five-argument bridge consumes the fourth and final unit, then a
--     fresh bridge call at the exhausted limit leaves no run/log/meter residue;
-- 12. no notification/reminder/communication/email evidence is created;
-- 13. baseline_restored=true and zero_fixture_residue=true after ROLLBACK.
