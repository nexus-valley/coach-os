-- Bundle UX-8G1A: Renewal lifecycle authority
-- Review PRE, APPLY, and POST separately. Do not execute without approval.

/*
PRE-APPLY READ-ONLY VERIFICATION

with required_relations(name) as (
  values
    ('tenants'), ('tenant_members'), ('subscription_plans'),
    ('subscription_plan_prices'), ('tenant_subscription_assignments'),
    ('tenant_billing_profiles'), ('platform_billing_issuer_profiles'),
    ('tenant_payment_orders'), ('tenant_payment_attempts'),
    ('razorpay_webhook_events'), ('tenant_plan_activation_events'),
    ('platform_billing_document_fulfillments'), ('invoices'),
    ('platform_billing_receipts'), ('finance_invoices'), ('finance_payments'),
    ('finance_receipts')
), relation_state as (
  select name, to_regclass('public.' || name) is not null as installed
  from required_relations
), required_functions(identity) as (
  values
    ('public.activate_tenant_plan_after_verified_payment(uuid)'),
    ('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
    ('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()'),
    ('coachfort_internal.enforce_captured_attempt_activation_authority()'),
    ('public.discover_platform_billing_document_fulfillments_server(integer)'),
    ('public.issue_platform_invoice_for_activation_server(uuid)'),
    ('public.issue_platform_receipt_for_fulfillment_server(uuid)')
), function_state as (
  select identity, to_regprocedure(identity) is not null as installed
  from required_functions
), ux8f_prerequisite_state as (
  select
    exists (
      select 1
      from pg_catalog.pg_class index_relation
      join pg_catalog.pg_namespace namespace on namespace.oid = index_relation.relnamespace
      join pg_catalog.pg_index index_definition on index_definition.indexrelid = index_relation.oid
      where namespace.nspname = 'public'
        and index_relation.relname = 'tenant_plan_activation_events_payment_order_uidx'
        and index_definition.indrelid = 'public.tenant_plan_activation_events'::regclass
        and index_definition.indisunique
        and pg_get_indexdef(index_relation.oid) like '%(payment_order_id)%'
    ) as activation_order_unique,
    (
      select count(*) = 2 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
        and column_name in ('billing_period_start','billing_period_end')
    ) as billing_period_columns,
    (
      select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name in ('billing_snapshot','issuer_snapshot','plan_snapshot','tax_calculation_status')
    ) as frozen_order_snapshots
), current_authority as (
  select assignment.*,
    case
      when assignment.status = 'trial' and assignment.payment_status <> 'not_required'
        then 'status_payment_anomaly'
      when assignment.status = 'trial'
        and (assignment.trial_started_at is null or assignment.trial_ends_at is null)
        then 'missing_period'
      when assignment.status = 'trial' and assignment.trial_started_at > now()
        then 'future_start_anomaly'
      when assignment.status = 'trial' and assignment.trial_started_at >= assignment.trial_ends_at
        then 'invalid_period'
      when assignment.status = 'trial' then 'valid_trial'
      when assignment.current_period_start is null or assignment.current_period_end is null
        then 'missing_period'
      when assignment.current_period_start > now() then 'future_start_anomaly'
      when assignment.current_period_start >= assignment.current_period_end then 'invalid_period'
      when assignment.status = 'active'
        and assignment.payment_status in ('paid','waived') then 'valid_paid'
      when assignment.status = 'grace'
        and assignment.payment_status in ('paid','overdue','waived') then 'valid_paid'
      when assignment.status = 'past_due'
        and assignment.payment_status in ('unpaid','overdue') then 'past_due'
      when assignment.status in ('active','grace','past_due','trial')
        then 'status_payment_anomaly'
      else 'other_malformed'
    end as classification
  from public.tenant_subscription_assignments assignment
  where assignment.is_current
), classification as (
  select
    count(*) filter (where classification = 'valid_paid') as valid_paid_count,
    count(*) filter (where classification = 'valid_trial') as valid_trial_count,
    count(*) filter (where classification = 'missing_period') as missing_period_count,
    count(*) filter (where classification = 'future_start_anomaly') as future_start_anomaly_count,
    count(*) filter (where classification = 'invalid_period') as invalid_period_count,
    count(*) filter (where classification = 'status_payment_anomaly') as status_payment_anomaly_count,
    count(*) filter (where classification = 'past_due') as past_due_count,
    count(*) filter (where classification = 'other_malformed') as other_malformed_count,
    count(*) filter (
      where current_period_start is not null
        and current_period_end is not null
        and current_period_start < current_period_end
        and status in ('active','grace','past_due')
        and grace_period_ends_at is not null
        and grace_period_ends_at is distinct from current_period_end + interval '7 days'
    ) as grace_drift_count
  from current_authority
), conflicting_objects as (
  select jsonb_build_object(
    'intent_table', to_regclass('public.tenant_subscription_change_intents') is not null,
    'order_intent_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name = 'subscription_change_intent_id'
    ),
    'activation_intent_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
        and column_name = 'subscription_change_intent_id'
    ),
    'conflicting_indexes', exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind = 'i'
        and relation.relname in (
          'tenant_payment_orders_change_intent_generation_uidx',
          'tenant_payment_orders_change_intent_nonterminal_uidx',
          'tenant_plan_activation_events_change_intent_success_uidx',
          'tenant_plan_activation_events_change_intent_idx'
        )
    ),
    'lifecycle_helper', to_regprocedure('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)') is not null,
    'renewal_authority', to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)') is not null
  ) as value
), browser_grants as (
  select count(*) as grant_count
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('tenant_payment_orders','tenant_payment_attempts','tenant_plan_activation_events')
    and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
), counts as (
  select jsonb_build_object(
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'platform_invoices', (select count(*) from public.invoices),
    'platform_receipts', (select count(*) from public.platform_billing_receipts),
    'finance_invoices', (select count(*) from public.finance_invoices),
    'finance_payments', (select count(*) from public.finance_payments),
    'finance_receipts', (select count(*) from public.finance_receipts)
  ) as value
)
select jsonb_build_object(
  'bundle', 'UX-8G1A',
  'ready_for_apply',
    (select bool_and(installed) from relation_state)
    and (select bool_and(installed) from function_state)
    and (select activation_order_unique and billing_period_columns and frozen_order_snapshots from ux8f_prerequisite_state)
    and (select value = '{"intent_table": false, "order_intent_column": false, "activation_intent_column": false, "conflicting_indexes": false, "lifecycle_helper": false, "renewal_authority": false}'::jsonb from conflicting_objects)
    and (select grant_count = 0 from browser_grants)
    and to_regprocedure('extensions.digest(bytea,text)') is not null
    and not exists (
      select 1
      from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
      where btrim(exposed.schema_name) = 'coachfort_internal'
    ),
  'required_relations', (select jsonb_object_agg(name, installed) from relation_state),
  'required_functions', (select jsonb_object_agg(identity, installed) from function_state),
  'ux8f_prerequisite_integrity', (select to_jsonb(ux8f_prerequisite_state) from ux8f_prerequisite_state),
  'current_assignment_classification', (select to_jsonb(classification) from classification),
  'existing_change_intent_objects', (select value from conflicting_objects),
  'browser_grants', (select grant_count from browser_grants),
  'internal_schema_exposed', exists (
    select 1
    from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
    where btrim(exposed.schema_name) = 'coachfort_internal'
  ),
  'payment_document_and_student_finance_counts', (select value from counts),
  'deterministic_grace_backfill_candidates', (
    select count(*) from current_authority
    where classification in ('valid_paid','past_due')
      and grace_period_ends_at is null
      and current_period_start < current_period_end
  ),
  'ux8g1b_malformed_blockers', (
    select missing_period_count + future_start_anomaly_count + invalid_period_count
      + grace_drift_count + status_payment_anomaly_count + other_malformed_count
    from classification
  )
);
*/

begin;

do $$
begin
  if to_regnamespace('coachfort_internal') is null then
    raise exception 'UX-8G1A requires coachfort_internal.' using errcode = '55000';
  end if;

  if exists (
    select 1 from unnest(array[
      'public.tenants','public.tenant_members','public.subscription_plans',
      'public.subscription_plan_prices','public.tenant_subscription_assignments',
      'public.tenant_billing_profiles','public.platform_billing_issuer_profiles',
      'public.tenant_payment_orders','public.tenant_payment_attempts',
      'public.razorpay_webhook_events','public.tenant_plan_activation_events',
      'public.platform_billing_document_fulfillments','public.invoices',
      'public.platform_billing_receipts'
    ]) required(identity)
    where to_regclass(required.identity) is null
  ) then
    raise exception 'UX-8G1A required relations are missing.' using errcode = '55000';
  end if;

  if to_regprocedure('public.activate_tenant_plan_after_verified_payment(uuid)') is null
     or to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()') is null
     or to_regprocedure('coachfort_internal.enforce_captured_attempt_activation_authority()') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'UX-8G1A required UX-8F functions or pgcrypto are missing.' using errcode = '55000';
  end if;

  if to_regclass('public.tenant_subscription_change_intents') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_payment_orders'
         and column_name in ('subscription_change_intent_id','change_intent_generation')
     )
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
         and column_name = 'subscription_change_intent_id'
     )
     or to_regprocedure('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)') is not null
     or to_regprocedure('public.get_tenant_subscription_lifecycle(uuid)') is not null
     or to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)') is not null
     or to_regprocedure('coachfort_internal.activate_initial_tenant_plan_after_verified_payment(uuid)') is not null
     or to_regprocedure('coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(uuid)') is not null then
    raise exception 'Conflicting UX-8G1A objects already exist.' using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind = 'i'
      and relation.relname in (
        'tenant_payment_orders_change_intent_generation_uidx',
        'tenant_payment_orders_change_intent_nonterminal_uidx',
        'tenant_plan_activation_events_change_intent_success_uidx',
        'tenant_plan_activation_events_change_intent_idx'
      )
  ) then
    raise exception 'Conflicting UX-8G1A indexes already exist.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
    where btrim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'coachfort_internal must not be exposed through PostgREST.' using errcode = '55000';
  end if;

  if exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in ('tenant_payment_orders','tenant_payment_attempts','tenant_plan_activation_events')
      and grantee in ('PUBLIC','anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
  ) then
    raise exception 'UX-8G1A browser payment authority grants must be closed.' using errcode = '55000';
  end if;
end;
$$;

create table public.tenant_subscription_change_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  base_assignment_id uuid not null references public.tenant_subscription_assignments(id) on delete restrict,
  target_plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  target_price_id uuid not null references public.subscription_plan_prices(id) on delete restrict,
  change_type text not null default 'renewal',
  billing_cycle text not null,
  currency text not null,
  base_period_end timestamptz not null,
  authority_key text not null,
  status text not null default 'open',
  order_generation integer not null default 0,
  activated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_subscription_change_intents_change_type_check check (change_type = 'renewal'),
  constraint tenant_subscription_change_intents_billing_cycle_check check (billing_cycle in ('monthly','yearly')),
  constraint tenant_subscription_change_intents_currency_check check (currency in ('INR','EUR','USD')),
  constraint tenant_subscription_change_intents_authority_key_check check (authority_key ~ '^[0-9a-f]{64}$'),
  constraint tenant_subscription_change_intents_status_check check (
    status in ('open','payment_pending','captured','activated','cancelled','manual_review')
  ),
  constraint tenant_subscription_change_intents_generation_check check (order_generation >= 0),
  constraint tenant_subscription_change_intents_activation_state_check check (
    (status = 'activated' and activated_at is not null)
    or (status <> 'activated' and activated_at is null)
  ),
  constraint tenant_subscription_change_intents_authority_key_unique unique (authority_key)
);

create index tenant_subscription_change_intents_tenant_status_idx
  on public.tenant_subscription_change_intents(tenant_id, status, created_at desc);
create index tenant_subscription_change_intents_base_assignment_idx
  on public.tenant_subscription_change_intents(base_assignment_id, created_at desc);

alter table public.tenant_subscription_change_intents enable row level security;
alter table public.tenant_subscription_change_intents owner to postgres;

alter table public.tenant_payment_orders
  add column subscription_change_intent_id uuid references public.tenant_subscription_change_intents(id) on delete restrict,
  add column change_intent_generation integer,
  add constraint tenant_payment_orders_change_intent_linkage_check check (
    (subscription_change_intent_id is null and change_intent_generation is null)
    or (subscription_change_intent_id is not null and change_intent_generation is not null and change_intent_generation > 0)
  ),
  add constraint tenant_payment_orders_renewal_setup_fee_zero_check check (
    subscription_change_intent_id is null
    or (
      billing_snapshot is not null
      and issuer_snapshot is not null
      and plan_snapshot is not null
      and tax_calculation_status is not null
      and setup_fee_amount_minor is not distinct from 0
      and (plan_snapshot->>'setup_fee_amount_minor') is not distinct from '0'
      and total_amount_minor = amount_minor + coalesce(tax_amount_minor, 0)
    )
  );

create unique index tenant_payment_orders_change_intent_generation_uidx
  on public.tenant_payment_orders(subscription_change_intent_id, change_intent_generation)
  where subscription_change_intent_id is not null;
create unique index tenant_payment_orders_change_intent_nonterminal_uidx
  on public.tenant_payment_orders(subscription_change_intent_id)
  where subscription_change_intent_id is not null
    and internal_status not in ('failed','cancelled','expired','activated');

alter table public.tenant_plan_activation_events
  add column subscription_change_intent_id uuid references public.tenant_subscription_change_intents(id) on delete restrict;

create unique index tenant_plan_activation_events_change_intent_success_uidx
  on public.tenant_plan_activation_events(subscription_change_intent_id)
  where subscription_change_intent_id is not null
    and activation_status in ('activated','skipped_already_active');
create index tenant_plan_activation_events_change_intent_idx
  on public.tenant_plan_activation_events(subscription_change_intent_id, created_at desc)
  where subscription_change_intent_id is not null;

create function coachfort_internal.renewal_authority_key(
  p_tenant_id uuid,
  p_base_assignment_id uuid,
  p_target_plan_id uuid,
  p_target_price_id uuid,
  p_billing_cycle text,
  p_currency text,
  p_base_period_end timestamptz
)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws('|',
          'ux8g1a:v1', p_tenant_id::text, p_base_assignment_id::text,
          p_target_plan_id::text, p_target_price_id::text,
          p_billing_cycle, p_currency
        ),
        'UTF8'
      ) || pg_catalog.timestamptz_send(p_base_period_end),
      'sha256'
    ),
    'hex'
  )
  where p_tenant_id is not null
    and p_base_assignment_id is not null
    and p_target_plan_id is not null
    and p_target_price_id is not null
    and p_billing_cycle in ('monthly','yearly')
    and p_currency in ('INR','EUR','USD')
    and p_base_period_end is not null;
$$;

create function coachfort_internal.enforce_subscription_change_intent_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_key text;
  v_base public.tenant_subscription_assignments%rowtype;
  v_price public.subscription_plan_prices%rowtype;
begin
  v_expected_key := coachfort_internal.renewal_authority_key(
    new.tenant_id, new.base_assignment_id, new.target_plan_id, new.target_price_id,
    new.billing_cycle, new.currency, new.base_period_end
  );

  if v_expected_key is null or new.authority_key is distinct from v_expected_key then
    raise exception 'Renewal intent authority key is invalid.' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    select * into v_base
    from public.tenant_subscription_assignments assignment
    where assignment.id = new.base_assignment_id;
    select * into v_price
    from public.subscription_plan_prices price
    where price.id = new.target_price_id;

    if v_base.id is null or v_price.id is null
       or not v_base.is_current
       or v_base.tenant_id <> new.tenant_id
       or v_base.status not in ('active','grace','past_due')
       or not (
         (v_base.status = 'active' and v_base.payment_status in ('paid','waived'))
         or (v_base.status = 'grace' and v_base.payment_status in ('paid','overdue','waived'))
         or (v_base.status = 'past_due' and v_base.payment_status in ('unpaid','overdue'))
       )
       or v_base.plan_id <> new.target_plan_id
       or v_base.billing_cycle <> new.billing_cycle
       or v_base.currency <> new.currency
       or v_base.current_period_end is distinct from new.base_period_end
       or v_price.plan_id <> new.target_plan_id
       or v_price.billing_cycle <> new.billing_cycle
       or v_price.currency <> new.currency then
      raise exception 'Renewal intent relationships do not match canonical authority.' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
       or new.base_assignment_id is distinct from old.base_assignment_id
       or new.target_plan_id is distinct from old.target_plan_id
       or new.target_price_id is distinct from old.target_price_id
       or new.change_type is distinct from old.change_type
       or new.billing_cycle is distinct from old.billing_cycle
       or new.currency is distinct from old.currency
       or new.base_period_end is distinct from old.base_period_end
       or new.authority_key is distinct from old.authority_key
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Renewal intent commercial authority is immutable.' using errcode = '55000';
    end if;

    if new.order_generation < old.order_generation
       or new.order_generation > old.order_generation + 1
       or (new.order_generation > old.order_generation and new.status <> 'payment_pending') then
      raise exception 'Renewal order generation transition is invalid.' using errcode = '55000';
    end if;

    if new.status <> old.status and not (
      (old.status = 'open' and new.status in ('payment_pending','cancelled'))
      or (old.status = 'payment_pending' and new.status in ('open','captured','cancelled','manual_review'))
      or (old.status = 'captured' and new.status in ('activated','manual_review'))
    ) then
      raise exception 'Renewal intent status transition is invalid.' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_subscription_change_intent_authority
before insert or update on public.tenant_subscription_change_intents
for each row execute function coachfort_internal.enforce_subscription_change_intent_authority();

create trigger set_tenant_subscription_change_intents_updated_at
before update on public.tenant_subscription_change_intents
for each row execute function public.set_updated_at();

create function coachfort_internal.tenant_subscription_effective_lifecycle(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.tenant_subscription_assignments%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_grace_end timestamptz;
  v_effective_state text := 'expired';
  v_allowed boolean := false;
  v_reason text := 'missing_canonical_assignment';
  v_valid_payment boolean := false;
begin
  if p_tenant_id is null then
    return jsonb_build_object(
      'tenant_id', null, 'assignment_id', null, 'stored_status', null,
      'payment_status', null, 'current_period_start', null,
      'current_period_end', null, 'grace_period_ends_at', null,
      'trial_started_at', null, 'trial_ends_at', null,
      'effective_state', 'expired', 'operational_allowed', false,
      'reason', 'invalid_tenant'
    );
  end if;

  select * into v_assignment
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id and assignment.is_current
  limit 1;

  if v_assignment.id is null then
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'assignment_id', null, 'stored_status', null,
      'payment_status', null, 'current_period_start', null,
      'current_period_end', null, 'grace_period_ends_at', null,
      'trial_started_at', null, 'trial_ends_at', null,
      'effective_state', 'expired', 'operational_allowed', false,
      'reason', v_reason
    );
  end if;

  v_period_start := v_assignment.current_period_start;
  v_period_end := v_assignment.current_period_end;

  if v_assignment.status = 'trial' then
    if v_assignment.payment_status <> 'not_required' then
      v_reason := 'invalid_status_payment_combination';
    elsif v_assignment.trial_started_at is null or v_assignment.trial_ends_at is null then
      v_reason := 'missing_trial_authority';
    elsif v_assignment.trial_started_at > now() then
      v_reason := 'future_trial_start';
    elsif v_assignment.trial_started_at >= v_assignment.trial_ends_at then
      v_reason := 'invalid_trial_ordering';
    elsif now() < v_assignment.trial_ends_at then
      v_effective_state := 'active';
      v_allowed := true;
      v_reason := 'within_trial_period';
    else
      v_effective_state := 'expired';
      v_allowed := false;
      v_reason := 'trial_period_elapsed';
    end if;

    return jsonb_build_object(
      'tenant_id', v_assignment.tenant_id,
      'assignment_id', v_assignment.id,
      'stored_status', v_assignment.status,
      'payment_status', v_assignment.payment_status,
      'current_period_start', v_assignment.current_period_start,
      'current_period_end', v_assignment.current_period_end,
      'grace_period_ends_at', v_assignment.grace_period_ends_at,
      'trial_started_at', v_assignment.trial_started_at,
      'trial_ends_at', v_assignment.trial_ends_at,
      'effective_state', v_effective_state,
      'operational_allowed', v_allowed,
      'reason', v_reason
    );
  end if;

  v_valid_payment :=
    (v_assignment.status = 'active' and v_assignment.payment_status in ('paid','waived'))
    or (v_assignment.status = 'grace' and v_assignment.payment_status in ('paid','overdue','waived'))
    or (v_assignment.status = 'past_due' and v_assignment.payment_status in ('unpaid','overdue'));
  v_grace_end := v_assignment.grace_period_ends_at;

  if v_assignment.status in ('cancelled','suspended','expired') then
    v_reason := 'stored_terminal_or_suspended';
  elsif not v_valid_payment then
    v_reason := 'invalid_status_payment_combination';
  elsif v_period_start is null or v_period_end is null then
    v_reason := 'missing_period_authority';
  elsif v_period_start > now() then
    v_reason := 'future_period_start';
  elsif v_period_start >= v_period_end then
    v_reason := 'invalid_period_ordering';
  elsif v_grace_end is null or v_grace_end is distinct from v_period_end + interval '7 days' then
    v_reason := 'invalid_grace_authority';
  elsif now() < v_period_end then
    v_effective_state := 'active';
    v_allowed := true;
    v_reason := 'within_purchased_period';
  elsif now() < v_grace_end then
    v_effective_state := 'grace';
    v_allowed := true;
    v_reason := 'within_fixed_grace_period';
  else
    v_effective_state := 'expired';
    v_allowed := false;
    v_reason := 'grace_period_elapsed';
  end if;

  return jsonb_build_object(
    'tenant_id', v_assignment.tenant_id,
    'assignment_id', v_assignment.id,
    'stored_status', v_assignment.status,
    'payment_status', v_assignment.payment_status,
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'grace_period_ends_at', v_grace_end,
    'trial_started_at', v_assignment.trial_started_at,
    'trial_ends_at', v_assignment.trial_ends_at,
    'effective_state', v_effective_state,
    'operational_allowed', v_allowed,
    'reason', v_reason
  );
end;
$$;

create function public.get_tenant_subscription_lifecycle(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = auth.uid()
      and member.role in ('owner','admin')
  ) then
    raise exception 'Billing lifecycle access is not authorized.' using errcode = '42501';
  end if;

  return coachfort_internal.tenant_subscription_effective_lifecycle(p_tenant_id);
end;
$$;

-- Deterministic only: no period, status, trial, or payment authority is invented.
update public.tenant_subscription_assignments assignment
set grace_period_ends_at = assignment.current_period_end + interval '7 days',
    updated_at = now()
where assignment.is_current
  and assignment.grace_period_ends_at is null
  and assignment.current_period_start is not null
  and assignment.current_period_end is not null
  and assignment.current_period_start <= now()
  and assignment.current_period_start < assignment.current_period_end
  and (
    (assignment.status = 'active' and assignment.payment_status in ('paid','waived'))
    or (assignment.status = 'grace' and assignment.payment_status in ('paid','overdue','waived'))
    or (assignment.status = 'past_due' and assignment.payment_status in ('unpaid','overdue'))
  );

create or replace function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.billing_snapshot is distinct from old.billing_snapshot
     or new.issuer_snapshot is distinct from old.issuer_snapshot
     or new.plan_snapshot is distinct from old.plan_snapshot
     or new.tax_calculation_status is distinct from old.tax_calculation_status
     or new.amount_minor is distinct from old.amount_minor
     or new.setup_fee_amount_minor is distinct from old.setup_fee_amount_minor
     or new.tax_amount_minor is distinct from old.tax_amount_minor
     or new.total_amount_minor is distinct from old.total_amount_minor
     or new.currency is distinct from old.currency
     or new.plan_id is distinct from old.plan_id
     or new.price_id is distinct from old.price_id
     or new.plan_code is distinct from old.plan_code
     or new.billing_cycle is distinct from old.billing_cycle
     or new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by
     or new.provider is distinct from old.provider
     or new.provider_mode is distinct from old.provider_mode
     or new.provider_receipt is distinct from old.provider_receipt
     or new.idempotency_key is distinct from old.idempotency_key
     or new.checkout_enabled_source is distinct from old.checkout_enabled_source
     or new.subscription_change_intent_id is distinct from old.subscription_change_intent_id
     or new.change_intent_generation is distinct from old.change_intent_generation then
    raise exception 'Payment-order commercial authority is immutable.' using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger enforce_payment_order_commercial_snapshot_immutability on public.tenant_payment_orders;
create trigger enforce_payment_order_commercial_snapshot_immutability
before update on public.tenant_payment_orders
for each row execute function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability();

create function public.create_platform_renewal_payment_order_authority_server(
  p_tenant_id uuid,
  p_created_by uuid,
  p_plan_id uuid,
  p_price_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_price public.subscription_plan_prices%rowtype;
  v_profile public.tenant_billing_profiles%rowtype;
  v_issuer public.platform_billing_issuer_profiles%rowtype;
  v_base public.tenant_subscription_assignments%rowtype;
  v_intent public.tenant_subscription_change_intents%rowtype;
  v_existing_order public.tenant_payment_orders%rowtype;
  v_lifecycle jsonb;
  v_authority_key text;
  v_generation integer;
  v_tax_calculation_status text;
  v_tax_amount_minor bigint;
  v_total_amount_minor bigint;
  v_order_id uuid := gen_random_uuid();
  v_provider_receipt text;
  v_billing_snapshot jsonb;
  v_issuer_snapshot jsonb;
  v_plan_snapshot jsonb;
  v_order_metadata jsonb;
begin
  if p_tenant_id is null or p_created_by is null or p_plan_id is null or p_price_id is null then
    raise exception 'Tenant, creator, plan, and price are required for renewal.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id and member.user_id = p_created_by
      and member.role in ('owner','admin')
  ) then
    raise exception 'Only tenant owners and admins can create renewal orders.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ux8g1a_renewal:' || p_tenant_id::text, 81));

  select * into v_base
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id and assignment.is_current
  for update;

  if v_base.id is null then
    raise exception 'A canonical current assignment is required for renewal.' using errcode = '22023';
  end if;

  if v_base.status not in ('active','grace','past_due') or not (
    (v_base.status = 'active' and v_base.payment_status in ('paid','waived'))
    or (v_base.status = 'grace' and v_base.payment_status in ('paid','overdue','waived'))
    or (v_base.status = 'past_due' and v_base.payment_status in ('unpaid','overdue'))
  ) then
    raise exception 'A purchased subscription lifecycle is required for renewal.' using errcode = '22023';
  end if;

  v_lifecycle := coachfort_internal.tenant_subscription_effective_lifecycle(p_tenant_id);
  if v_lifecycle->>'reason' in (
      'invalid_status_payment_combination','missing_period_authority','future_period_start',
      'invalid_period_ordering','invalid_grace_authority','stored_terminal_or_suspended'
    ) then
    raise exception 'Subscription lifecycle authority is not eligible for renewal.' using errcode = '22023';
  end if;
  if v_base.current_period_end is null or v_base.current_period_start is null then
    raise exception 'Canonical paid period authority is required for renewal.' using errcode = '22023';
  end if;
  if v_lifecycle->>'effective_state' = 'active'
     and now() < v_base.current_period_end - interval '30 days' then
    raise exception 'Renewal opens 30 days before the current period ends.' using errcode = '22023';
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  select * into v_price from public.subscription_plan_prices
  where id = p_price_id and plan_id = p_plan_id;

  if v_plan.id is null or v_price.id is null
     or v_base.plan_id <> p_plan_id
     or v_base.billing_cycle <> v_price.billing_cycle
     or v_base.currency <> v_price.currency
     or v_price.billing_cycle not in ('monthly','yearly') then
    raise exception 'Renewal is limited to the same plan, billing cycle, and currency.' using errcode = '22023';
  end if;

  if v_plan.code not in ('starter','growth')
     or v_plan.status <> 'draft' or v_plan.is_public
     or v_price.status <> 'draft' or v_price.currency <> 'INR'
     or v_price.region_code <> 'GLOBAL'
     or coalesce(v_price.metadata_json->>'pricing_finalized', 'false') <> 'true'
     or coalesce(v_price.metadata_json->>'pricing_finalized_module', '') <> '71.7R0B'
     or coalesce(v_price.metadata_json->>'checkout_enabled', 'true') <> 'false' then
    raise exception 'Canonical price is not eligible for Razorpay test renewal.' using errcode = '22023';
  end if;

  select * into v_profile from public.tenant_billing_profiles where tenant_id = p_tenant_id;
  if v_profile.tenant_id is null
     or nullif(btrim(v_profile.legal_name), '') is null
     or nullif(btrim(v_profile.billing_email), '') is null
     or nullif(btrim(v_profile.address_line1), '') is null
     or nullif(btrim(v_profile.city), '') is null
     or nullif(btrim(v_profile.postal_code), '') is null
     or public.billing_profile_currency_for_country(v_profile.country) is null
     or v_profile.preferred_currency is distinct from public.billing_profile_currency_for_country(v_profile.country)
     or v_profile.preferred_currency is distinct from v_price.currency then
    raise exception 'Complete the billing profile before starting renewal.' using errcode = '22023';
  end if;

  select * into v_issuer from public.platform_billing_issuer_profiles
  where profile_key = 'default' and status = 'active' and effective_from <= now();
  if v_issuer.profile_key is null then
    raise exception 'CoachFort billing issuer profile is not configured.' using errcode = '55000';
  end if;

  v_authority_key := coachfort_internal.renewal_authority_key(
    p_tenant_id, v_base.id, p_plan_id, p_price_id,
    v_price.billing_cycle, v_price.currency, v_base.current_period_end
  );

  select * into v_intent
  from public.tenant_subscription_change_intents intent
  where intent.authority_key = v_authority_key
  for update;

  if v_intent.id is null then
    insert into public.tenant_subscription_change_intents (
      tenant_id, base_assignment_id, target_plan_id, target_price_id,
      change_type, billing_cycle, currency, base_period_end,
      authority_key, status, order_generation, created_by
    ) values (
      p_tenant_id, v_base.id, p_plan_id, p_price_id,
      'renewal', v_price.billing_cycle, v_price.currency, v_base.current_period_end,
      v_authority_key, 'open', 0, p_created_by
    ) returning * into v_intent;
  elsif v_intent.status in ('activated','cancelled','manual_review') then
    raise exception 'This renewal authority is no longer available for payment.' using errcode = '22023';
  end if;

  select * into v_existing_order
  from public.tenant_payment_orders payment_order
  where payment_order.subscription_change_intent_id = v_intent.id
    and payment_order.internal_status not in ('failed','cancelled','expired','activated')
  order by payment_order.change_intent_generation desc
  limit 1
  for update;

  if v_existing_order.id is not null then
    return jsonb_build_object(
      'billing_snapshot', v_existing_order.billing_snapshot,
      'issuer_snapshot', v_existing_order.issuer_snapshot,
      'order_id', v_existing_order.id,
      'order_metadata', v_existing_order.metadata_json,
      'plan_snapshot', v_existing_order.plan_snapshot,
      'provider_receipt', v_existing_order.provider_receipt,
      'tax_amount_minor', v_existing_order.tax_amount_minor,
      'tax_calculation_status', v_existing_order.tax_calculation_status,
      'total_amount_minor', v_existing_order.total_amount_minor,
      'subscription_change_intent_id', v_intent.id,
      'change_intent_generation', v_existing_order.change_intent_generation,
      'idempotent', true
    );
  end if;

  if exists (
    select 1
    from public.tenant_payment_orders conflicting_order
    join public.tenant_subscription_change_intents conflicting_intent
      on conflicting_intent.id = conflicting_order.subscription_change_intent_id
    where conflicting_intent.tenant_id = p_tenant_id
      and conflicting_intent.base_assignment_id = v_base.id
      and conflicting_intent.id <> v_intent.id
      and conflicting_order.internal_status not in ('failed','cancelled','expired','activated')
  ) then
    raise exception 'Another renewal checkout for this subscription period is already in progress.' using errcode = '22023';
  end if;

  if v_intent.status = 'payment_pending' then
    update public.tenant_subscription_change_intents
    set status = 'open'
    where id = v_intent.id
    returning * into v_intent;
  end if;
  if v_intent.status <> 'open' then
    raise exception 'Renewal intent is not available for a new order generation.' using errcode = '22023';
  end if;

  v_generation := v_intent.order_generation + 1;
  v_tax_calculation_status := case
    when v_price.tax_behavior = 'not_applicable' then 'not_applicable'
    else 'not_calculated'
  end;
  v_tax_amount_minor := case when v_tax_calculation_status = 'not_applicable' then 0 else null end;
  v_total_amount_minor := v_price.amount_minor + coalesce(v_tax_amount_minor, 0);

  v_billing_snapshot := jsonb_build_object(
    'legal_name', v_profile.legal_name, 'billing_email', v_profile.billing_email,
    'billing_phone', v_profile.billing_phone, 'invoice_contact_name', v_profile.invoice_contact_name,
    'address_line1', v_profile.address_line1, 'address_line2', v_profile.address_line2,
    'city', v_profile.city, 'state', v_profile.state, 'postal_code', v_profile.postal_code,
    'country', v_profile.country, 'preferred_currency', v_profile.preferred_currency,
    'tax_registration_type', v_profile.tax_registration_type, 'tax_id', v_profile.tax_id,
    'profile_updated_at', v_profile.updated_at
  );
  v_issuer_snapshot := jsonb_build_object(
    'legal_name', v_issuer.legal_name, 'billing_email', v_issuer.billing_email,
    'billing_phone', v_issuer.billing_phone, 'address_line1', v_issuer.address_line1,
    'address_line2', v_issuer.address_line2, 'city', v_issuer.city, 'state', v_issuer.state,
    'postal_code', v_issuer.postal_code, 'country', v_issuer.country,
    'tax_registration_type', v_issuer.tax_registration_type, 'tax_id', v_issuer.tax_id,
    'effective_from', v_issuer.effective_from, 'profile_updated_at', v_issuer.updated_at
  );
  v_plan_snapshot := jsonb_build_object(
    'plan_id', v_plan.id, 'plan_code', v_plan.code, 'plan_name', v_plan.name,
    'price_id', v_price.id, 'billing_cycle', v_price.billing_cycle,
    'currency', v_price.currency, 'region_code', v_price.region_code,
    'amount_minor', v_price.amount_minor, 'unit_amount_minor', v_price.amount_minor,
    'setup_fee_amount_minor', 0, 'tax_amount_minor', v_tax_amount_minor,
    'tax_behavior', v_price.tax_behavior, 'tax_calculation_status', v_tax_calculation_status,
    'total_amount_minor', v_total_amount_minor
  );
  v_order_metadata := jsonb_build_object(
    'activation_enabled', false, 'browser_success_not_activation', true,
    'module', 'UX-8G1A', 'change_type', 'renewal',
    'price_metadata_snapshot', coalesce(v_price.metadata_json, '{}'::jsonb),
    'public_launch_pending', true, 'test_tenant_allowlisted', true
  );
  v_provider_receipt := 'cf_' || left(replace(v_order_id::text, '-', ''), 28);

  insert into public.tenant_payment_orders (
    id, tenant_id, created_by, plan_id, price_id, plan_code, billing_cycle,
    currency, amount_minor, setup_fee_amount_minor, tax_amount_minor,
    tax_calculation_status, total_amount_minor, provider, provider_mode,
    provider_receipt, internal_status, idempotency_key,
    checkout_enabled_source, metadata_json, billing_snapshot,
    issuer_snapshot, plan_snapshot, expires_at,
    subscription_change_intent_id, change_intent_generation
  ) values (
    v_order_id, p_tenant_id, p_created_by, v_plan.id, v_price.id, v_plan.code,
    v_price.billing_cycle, v_price.currency, v_price.amount_minor,
    0, v_tax_amount_minor, v_tax_calculation_status, v_total_amount_minor,
    'razorpay', 'test', v_provider_receipt, 'created',
    'ux8g1a:' || v_authority_key || ':' || v_generation::text,
    'regression_test_gate', v_order_metadata, v_billing_snapshot,
    v_issuer_snapshot, v_plan_snapshot, now() + interval '30 minutes',
    v_intent.id, v_generation
  );

  update public.tenant_subscription_change_intents
  set status = 'payment_pending', order_generation = v_generation
  where id = v_intent.id;

  return jsonb_build_object(
    'billing_snapshot', v_billing_snapshot, 'issuer_snapshot', v_issuer_snapshot,
    'order_id', v_order_id, 'order_metadata', v_order_metadata,
    'plan_snapshot', v_plan_snapshot, 'provider_receipt', v_provider_receipt,
    'tax_amount_minor', v_tax_amount_minor,
    'tax_calculation_status', v_tax_calculation_status,
    'total_amount_minor', v_total_amount_minor,
    'subscription_change_intent_id', v_intent.id,
    'change_intent_generation', v_generation,
    'idempotent', false
  );
end;
$$;

create or replace function coachfort_internal.enforce_captured_attempt_activation_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.tenant_payment_orders%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_assignment public.tenant_subscription_assignments%rowtype;
  v_intent public.tenant_subscription_change_intents%rowtype;
  v_expected_period_start timestamptz;
  v_expected_period_end timestamptz;
begin
  if tg_op = 'UPDATE' and old.activation_status in ('activated','skipped_already_active') then
    if new.activation_status is distinct from old.activation_status
       or new.activated_at is distinct from old.activated_at
       or new.payment_order_id is distinct from old.payment_order_id
       or new.provider_order_id is distinct from old.provider_order_id
       or new.provider_payment_id is distinct from old.provider_payment_id
       or new.tenant_id is distinct from old.tenant_id
       or new.plan_id is distinct from old.plan_id
       or new.price_id is distinct from old.price_id
       or new.previous_assignment_id is distinct from old.previous_assignment_id
       or new.new_assignment_id is distinct from old.new_assignment_id
       or new.subscription_change_intent_id is distinct from old.subscription_change_intent_id
       or new.billing_period_start is distinct from old.billing_period_start
       or new.billing_period_end is distinct from old.billing_period_end
       or new.idempotency_key is distinct from old.idempotency_key
       or new.activation_source is distinct from old.activation_source
       or new.provider is distinct from old.provider
       or new.metadata_json is distinct from old.metadata_json then
      raise exception 'Successful activation authority is immutable.' using errcode = '55000';
    end if;
    return new;
  end if;

  if new.activation_status not in ('activated','skipped_already_active') then
    return new;
  end if;

  select * into v_order
  from public.tenant_payment_orders
  where id = new.payment_order_id;

  select * into v_attempt
  from public.tenant_payment_attempts attempt
  where attempt.payment_order_id = v_order.id
    and attempt.tenant_id = v_order.tenant_id
    and attempt.internal_status = 'captured'
    and coalesce(attempt.signature_valid, false) is true
    and attempt.captured_at is not null
    and attempt.provider_payment_id is not null
    and attempt.provider = v_order.provider
    and attempt.provider_mode = v_order.provider_mode
    and attempt.provider_order_id is not distinct from v_order.provider_order_id
    and attempt.amount_minor is not distinct from v_order.total_amount_minor
    and attempt.currency is not distinct from v_order.currency
    and exists (
      select 1 from public.razorpay_webhook_events event
      where event.provider = v_order.provider
        and event.provider_mode = v_order.provider_mode
        and event.signature_valid
        and event.processing_status = 'processed'
        and event.event_type = 'payment.captured'
        and event.related_provider_order_id = v_order.provider_order_id
        and event.related_provider_payment_id = attempt.provider_payment_id
    )
  order by attempt.captured_at desc, attempt.created_at desc, attempt.id
  limit 1;

  select * into v_assignment
  from public.tenant_subscription_assignments assignment
  where assignment.id = new.new_assignment_id;

  if v_order.id is null or v_attempt.id is null
     or new.tenant_id <> v_order.tenant_id
     or new.plan_id <> v_order.plan_id
     or new.price_id <> v_order.price_id
     or new.new_assignment_id is null
     or v_assignment.id is null
     or v_assignment.tenant_id <> new.tenant_id
     or v_assignment.plan_id <> new.plan_id
     or v_assignment.current_period_start is null
     or v_assignment.current_period_end is null
     or v_assignment.current_period_start >= v_assignment.current_period_end then
    raise exception 'An exact captured payment attempt is required before activation.' using errcode = '22023';
  end if;

  if v_order.subscription_change_intent_id is null then
    if new.subscription_change_intent_id is not null then
      raise exception 'Initial activation cannot claim renewal intent authority.' using errcode = '22023';
    end if;
    v_expected_period_start := v_assignment.current_period_start;
    v_expected_period_end := v_assignment.current_period_end;
  else
    select * into v_intent
    from public.tenant_subscription_change_intents intent
    where intent.id = v_order.subscription_change_intent_id;

    if v_intent.id is null
       or new.subscription_change_intent_id is distinct from v_intent.id
       or v_order.change_intent_generation is null
       or v_intent.tenant_id <> v_order.tenant_id
       or v_intent.target_plan_id <> v_order.plan_id
       or v_intent.target_price_id <> v_order.price_id
       or v_intent.billing_cycle <> v_order.billing_cycle
       or v_intent.currency <> v_order.currency then
      raise exception 'Renewal activation intent linkage is invalid.' using errcode = '22023';
    end if;

    v_expected_period_start := case
      when v_attempt.captured_at <= v_intent.base_period_end then v_intent.base_period_end
      else v_attempt.captured_at
    end;
    v_expected_period_end := case v_intent.billing_cycle
      when 'monthly' then v_expected_period_start + interval '1 month'
      when 'yearly' then v_expected_period_start + interval '1 year'
      else null
    end;

    if v_expected_period_end is null
       or v_assignment.current_period_end is distinct from v_expected_period_end
       or (
         v_attempt.captured_at <= v_intent.base_period_end
         and (v_assignment.id <> v_intent.base_assignment_id
           or v_assignment.current_period_start >= v_intent.base_period_end)
       )
       or (
         v_attempt.captured_at > v_intent.base_period_end
         and (v_assignment.id = v_intent.base_assignment_id
           or v_assignment.current_period_start is distinct from v_attempt.captured_at)
       ) then
      raise exception 'Renewal assignment period does not match captured intent authority.' using errcode = '22023';
    end if;
  end if;

  new.provider_order_id := v_order.provider_order_id;
  new.provider_payment_id := v_attempt.provider_payment_id;
  new.billing_period_start := v_expected_period_start;
  new.billing_period_end := v_expected_period_end;
  new.metadata_json := coalesce(new.metadata_json, '{}'::jsonb)
    || jsonb_build_object(
      'captured_attempt_id', v_attempt.id,
      'captured_at', v_attempt.captured_at,
      'billing_period_frozen', true,
      'ux8f1_captured_attempt_required', true,
      'ux8g1a_renewal_segment', v_order.subscription_change_intent_id is not null
    );

  return new;
end;
$$;

drop trigger enforce_captured_attempt_activation_authority on public.tenant_plan_activation_events;
create trigger enforce_captured_attempt_activation_authority
before insert or update on public.tenant_plan_activation_events
for each row execute function coachfort_internal.enforce_captured_attempt_activation_authority();

-- Preserve the deployed UX-8F initial-activation implementation by OID and body.
alter function public.activate_tenant_plan_after_verified_payment(uuid)
  set schema coachfort_internal;
alter function coachfort_internal.activate_tenant_plan_after_verified_payment(uuid)
  rename to activate_initial_tenant_plan_after_verified_payment;
alter function coachfort_internal.activate_initial_tenant_plan_after_verified_payment(uuid)
  set search_path = public, pg_temp;

create function coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(
  p_payment_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.tenant_payment_orders%rowtype;
  v_intent public.tenant_subscription_change_intents%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_activation public.tenant_plan_activation_events%rowtype;
  v_base public.tenant_subscription_assignments%rowtype;
  v_current public.tenant_subscription_assignments%rowtype;
  v_new_assignment_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_continuous boolean;
  v_now timestamptz := now();
begin
  if p_payment_order_id is null then
    raise exception 'Payment order id is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ux8g1a_renewal_activation:' || p_payment_order_id::text, 8171));

  select * into v_order
  from public.tenant_payment_orders payment_order
  where payment_order.id = p_payment_order_id
  for update;

  if v_order.id is null or v_order.subscription_change_intent_id is null
     or v_order.change_intent_generation is null then
    raise exception 'Intent-linked renewal payment order is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ux8g1a_intent_activation:' || v_order.subscription_change_intent_id::text, 8171
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'ux8g1a_tenant_activation:' || v_order.tenant_id::text, 8171
  ));

  select * into v_intent
  from public.tenant_subscription_change_intents intent
  where intent.id = v_order.subscription_change_intent_id
  for update;

  if v_intent.id is null
     or v_intent.tenant_id <> v_order.tenant_id
     or v_intent.target_plan_id <> v_order.plan_id
     or v_intent.target_price_id <> v_order.price_id
     or v_intent.billing_cycle <> v_order.billing_cycle
     or v_intent.currency <> v_order.currency
     or v_order.setup_fee_amount_minor is distinct from 0
     or (v_order.plan_snapshot->>'setup_fee_amount_minor') is distinct from '0'
     or v_order.total_amount_minor <> v_order.amount_minor + coalesce(v_order.tax_amount_minor, 0) then
    raise exception 'Renewal payment order does not match immutable intent authority.' using errcode = '22023';
  end if;

  select * into v_activation
  from public.tenant_plan_activation_events activation
  where activation.payment_order_id = v_order.id
  for update;

  if v_activation.id is not null
     and v_activation.activation_status in ('activated','skipped_already_active') then
    return jsonb_build_object(
      'activated', true, 'idempotent', true,
      'activation_status', v_activation.activation_status,
      'tenant_id', v_activation.tenant_id, 'plan_code', v_order.plan_code,
      'payment_order_id', v_order.id, 'assignment_id', v_activation.new_assignment_id,
      'activation_event_id', v_activation.id,
      'subscription_change_intent_id', v_intent.id
    );
  end if;

  select * into v_attempt
  from public.tenant_payment_attempts attempt
  where attempt.payment_order_id = v_order.id
    and attempt.tenant_id = v_order.tenant_id
    and attempt.internal_status = 'captured'
    and coalesce(attempt.signature_valid, false) is true
    and attempt.captured_at is not null
    and attempt.provider_payment_id is not null
    and attempt.provider = v_order.provider
    and attempt.provider_mode = v_order.provider_mode
    and attempt.provider_order_id is not distinct from v_order.provider_order_id
    and attempt.amount_minor is not distinct from v_order.total_amount_minor
    and attempt.currency is not distinct from v_order.currency
    and exists (
      select 1 from public.razorpay_webhook_events event
      where event.provider = v_order.provider
        and event.provider_mode = v_order.provider_mode
        and event.signature_valid
        and event.processing_status = 'processed'
        and event.event_type = 'payment.captured'
        and event.related_provider_order_id = v_order.provider_order_id
        and event.related_provider_payment_id = attempt.provider_payment_id
    )
  order by attempt.captured_at desc, attempt.created_at desc, attempt.id
  limit 1
  for update;

  if v_attempt.id is null
     or v_order.provider <> 'razorpay'
     or v_order.provider_mode <> 'test'
     or v_order.provider_order_id is null
     or v_order.checkout_enabled_source <> 'regression_test_gate'
     or coalesce(v_order.metadata_json->>'test_tenant_allowlisted', 'false') <> 'true'
     or coalesce(v_order.metadata_json->>'browser_success_not_activation', 'false') <> 'true'
     or v_order.internal_status not in ('payment_captured','order_paid')
     or v_order.total_amount_minor <= 0
     or v_order.currency <> 'INR'
     or v_order.billing_cycle not in ('monthly','yearly') then
    raise exception 'Exact verified captured-payment evidence is required for renewal activation.' using errcode = '22023';
  end if;

  if v_intent.status = 'activated' then
    insert into public.tenant_plan_activation_events (
      tenant_id, payment_order_id, plan_id, price_id,
      subscription_change_intent_id, activation_status, idempotency_key,
      activation_source, provider, provider_order_id, provider_payment_id,
      failed_at, error_message, metadata_json
    ) values (
      v_order.tenant_id, v_order.id, v_order.plan_id, v_order.price_id,
      v_intent.id, 'failed', 'razorpay_payment_order:' || v_order.id::text,
      'verified_payment', v_order.provider, v_order.provider_order_id,
      v_attempt.provider_payment_id, now(),
      'Renewal intent was already activated; manual review is required.',
      jsonb_build_object(
        'module', 'UX-8G1A', 'manual_review_required', true,
        'reason', 'second_captured_payment_after_intent_activation',
        'captured_attempt_id', v_attempt.id
      )
    )
    on conflict (payment_order_id) do update
      set activation_status = 'failed', failed_at = now(),
          error_message = 'Renewal intent was already activated; manual review is required.',
          metadata_json = tenant_plan_activation_events.metadata_json
            || jsonb_build_object(
              'module', 'UX-8G1A', 'manual_review_required', true,
              'reason', 'second_captured_payment_after_intent_activation',
              'captured_attempt_id', v_attempt.id
            );

    return jsonb_build_object(
      'activated', false, 'idempotent', false,
      'activation_status', 'manual_review', 'tenant_id', v_order.tenant_id,
      'plan_code', v_order.plan_code, 'payment_order_id', v_order.id,
      'assignment_id', null, 'subscription_change_intent_id', v_intent.id
    );
  end if;

  if v_intent.status = 'payment_pending' then
    update public.tenant_subscription_change_intents
    set status = 'captured'
    where id = v_intent.id
    returning * into v_intent;
  elsif v_intent.status <> 'captured' then
    raise exception 'Renewal intent is not eligible for activation.' using errcode = '22023';
  end if;

  select * into v_base
  from public.tenant_subscription_assignments assignment
  where assignment.id = v_intent.base_assignment_id
  for update;
  select * into v_current
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = v_intent.tenant_id and assignment.is_current
  for update;

  if v_base.id is null
     or v_current.id is distinct from v_base.id
     or v_base.tenant_id <> v_intent.tenant_id
     or v_base.plan_id <> v_intent.target_plan_id
     or v_base.billing_cycle <> v_intent.billing_cycle
     or v_base.currency <> v_intent.currency
     or v_base.current_period_end is distinct from v_intent.base_period_end
     or v_base.current_period_start is null
     or v_base.current_period_start >= v_base.current_period_end then
    update public.tenant_subscription_change_intents
    set status = 'manual_review'
    where id = v_intent.id;

    insert into public.tenant_plan_activation_events (
      tenant_id, payment_order_id, plan_id, price_id,
      subscription_change_intent_id, activation_status, idempotency_key,
      activation_source, provider, provider_order_id, provider_payment_id,
      failed_at, error_message, metadata_json
    ) values (
      v_order.tenant_id, v_order.id, v_order.plan_id, v_order.price_id,
      v_intent.id, 'failed', 'razorpay_payment_order:' || v_order.id::text,
      'verified_payment', v_order.provider, v_order.provider_order_id,
      v_attempt.provider_payment_id, now(),
      'Renewal base authority changed; manual review is required.',
      jsonb_build_object('module', 'UX-8G1A', 'manual_review_required', true,
        'reason', 'base_assignment_authority_changed', 'captured_attempt_id', v_attempt.id)
    )
    on conflict (payment_order_id) do update
      set activation_status = 'failed', failed_at = now(),
          error_message = 'Renewal base authority changed; manual review is required.',
          metadata_json = tenant_plan_activation_events.metadata_json
            || jsonb_build_object('module', 'UX-8G1A', 'manual_review_required', true,
              'reason', 'base_assignment_authority_changed', 'captured_attempt_id', v_attempt.id);

    return jsonb_build_object(
      'activated', false, 'idempotent', false,
      'activation_status', 'manual_review', 'tenant_id', v_order.tenant_id,
      'plan_code', v_order.plan_code, 'payment_order_id', v_order.id,
      'assignment_id', null, 'subscription_change_intent_id', v_intent.id
    );
  end if;

  v_continuous := v_attempt.captured_at <= v_intent.base_period_end;
  v_period_start := case when v_continuous then v_intent.base_period_end else v_attempt.captured_at end;
  v_period_end := case v_intent.billing_cycle
    when 'monthly' then v_period_start + interval '1 month'
    when 'yearly' then v_period_start + interval '1 year'
    else null
  end;
  if v_period_end is null then
    raise exception 'Unsupported renewal billing cycle.' using errcode = '22023';
  end if;

  if v_activation.id is null then
    insert into public.tenant_plan_activation_events (
      tenant_id, payment_order_id, plan_id, price_id,
      subscription_change_intent_id, activation_status, idempotency_key,
      activation_source, provider, provider_order_id, provider_payment_id,
      metadata_json
    ) values (
      v_order.tenant_id, v_order.id, v_order.plan_id, v_order.price_id,
      v_intent.id, 'pending', 'razorpay_payment_order:' || v_order.id::text,
      'verified_payment', v_order.provider, v_order.provider_order_id,
      v_attempt.provider_payment_id,
      jsonb_build_object(
        'module', 'UX-8G1A', 'change_type', 'renewal',
        'captured_attempt_id', v_attempt.id, 'browser_success_not_activation', true
      )
    ) returning * into v_activation;
  else
    update public.tenant_plan_activation_events
    set activation_status = 'pending', subscription_change_intent_id = v_intent.id,
        failed_at = null, error_message = null,
        provider_order_id = v_order.provider_order_id,
        provider_payment_id = v_attempt.provider_payment_id,
        metadata_json = coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'module', 'UX-8G1A', 'change_type', 'renewal',
            'captured_attempt_id', v_attempt.id, 'browser_success_not_activation', true
          )
    where id = v_activation.id
    returning * into v_activation;
  end if;

  if v_continuous then
    update public.tenant_subscription_assignments
    set current_period_end = v_period_end,
        grace_period_ends_at = v_period_end + interval '7 days',
        status = 'active', payment_status = 'paid',
        metadata_json = coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'module', 'UX-8G1A', 'renewal_intent_id', v_intent.id,
            'renewal_payment_order_id', v_order.id,
            'renewal_activation_event_id', v_activation.id,
            'price_id', v_order.price_id, 'renewed_at', v_now
          ),
        updated_by = v_order.created_by, updated_at = now()
    where id = v_base.id;
    v_new_assignment_id := v_base.id;
  else
    update public.tenant_subscription_assignments
    set is_current = false,
        metadata_json = coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'superseded_by_renewal_intent_id', v_intent.id,
            'superseded_by_payment_order_id', v_order.id,
            'superseded_by_activation_event_id', v_activation.id,
            'superseded_at', v_now
          ),
        updated_at = now()
    where id = v_base.id;

    insert into public.tenant_subscription_assignments (
      tenant_id, plan_id, status, billing_cycle, currency,
      trial_started_at, trial_ends_at, current_period_start, current_period_end,
      grace_period_ends_at, payment_status, source, is_current,
      metadata_json, created_by, updated_by
    ) values (
      v_order.tenant_id, v_order.plan_id, 'active', v_order.billing_cycle,
      v_order.currency, null, null, v_period_start, v_period_end,
      v_period_end + interval '7 days', 'paid', 'checkout', true,
      jsonb_build_object(
        'module', 'UX-8G1A', 'change_type', 'renewal',
        'renewal_intent_id', v_intent.id, 'payment_provider', 'razorpay',
        'provider_mode', v_order.provider_mode,
        'provider_order_id', v_order.provider_order_id,
        'provider_payment_id', v_attempt.provider_payment_id,
        'payment_order_id', v_order.id, 'activation_event_id', v_activation.id,
        'price_id', v_order.price_id, 'amount_minor', v_order.amount_minor,
        'setup_fee_amount_minor', 0, 'tax_amount_minor', v_order.tax_amount_minor,
        'total_amount_minor', v_order.total_amount_minor,
        'browser_success_not_activation', true
      ),
      v_order.created_by, v_order.created_by
    ) returning id into v_new_assignment_id;
  end if;

  update public.tenant_plan_activation_events
  set previous_assignment_id = v_base.id,
      new_assignment_id = v_new_assignment_id,
      subscription_change_intent_id = v_intent.id,
      activation_status = 'activated', activated_at = v_now,
      failed_at = null, error_message = null,
      provider_payment_id = v_attempt.provider_payment_id,
      metadata_json = coalesce(metadata_json, '{}'::jsonb)
        || jsonb_build_object(
          'module', 'UX-8G1A', 'change_type', 'renewal',
          'renewal_mode', case when v_continuous then 'continuous' else 'post_lapse' end,
          'captured_attempt_id', v_attempt.id,
          'assignment_status', 'active', 'payment_status', 'paid',
          'browser_success_not_activation', true
        )
  where id = v_activation.id;

  update public.tenant_payment_orders
  set internal_status = 'activated',
      metadata_json = coalesce(metadata_json, '{}'::jsonb)
        || jsonb_build_object(
          'activation_enabled', true, 'activation_module', 'UX-8G1A',
          'activation_event_id', v_activation.id, 'assignment_id', v_new_assignment_id,
          'activated_at', v_now, 'browser_success_not_activation', true,
          'activation_result', 'activated'
        ),
      updated_at = now()
  where id = v_order.id;

  update public.tenant_subscription_change_intents
  set status = 'activated', activated_at = v_now
  where id = v_intent.id;

  return jsonb_build_object(
    'activated', true, 'idempotent', false, 'activation_status', 'activated',
    'tenant_id', v_order.tenant_id, 'plan_code', v_order.plan_code,
    'payment_order_id', v_order.id, 'assignment_id', v_new_assignment_id,
    'activation_event_id', v_activation.id,
    'subscription_change_intent_id', v_intent.id,
    'renewal_mode', case when v_continuous then 'continuous' else 'post_lapse' end,
    'billing_period_start', v_period_start, 'billing_period_end', v_period_end
  );
end;
$$;

create function public.activate_tenant_plan_after_verified_payment(p_payment_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent_id uuid;
  v_result jsonb;
  v_assignment_id uuid;
begin
  if p_payment_order_id is null then
    raise exception 'Payment order id is required.' using errcode = '22023';
  end if;

  select payment_order.subscription_change_intent_id into v_intent_id
  from public.tenant_payment_orders payment_order
  where payment_order.id = p_payment_order_id;

  if not found then
    raise exception 'Payment order not found.' using errcode = '22023';
  end if;

  if v_intent_id is null then
    v_result := coachfort_internal.activate_initial_tenant_plan_after_verified_payment(p_payment_order_id);

    if v_result->>'activation_status' in ('activated','skipped_already_active')
       and nullif(v_result->>'assignment_id', '') is not null then
      v_assignment_id := (v_result->>'assignment_id')::uuid;

      update public.tenant_subscription_assignments
      set grace_period_ends_at = current_period_end + interval '7 days',
          updated_at = now()
      where id = v_assignment_id
        and status = 'active'
        and payment_status = 'paid'
        and current_period_start is not null
        and current_period_end is not null
        and current_period_start < current_period_end
        and grace_period_ends_at is null;
    end if;

    return v_result;
  end if;

  return coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(p_payment_order_id);
end;
$$;

comment on function public.activate_tenant_plan_after_verified_payment(uuid) is
  'Service-only activation coordinator. Immutable payment-order linkage selects initial or renewal activation authority.';

alter function coachfort_internal.renewal_authority_key(uuid,uuid,uuid,uuid,text,text,timestamptz) owner to postgres;
alter function coachfort_internal.enforce_subscription_change_intent_authority() owner to postgres;
alter function coachfort_internal.tenant_subscription_effective_lifecycle(uuid) owner to postgres;
alter function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability() owner to postgres;
alter function coachfort_internal.enforce_captured_attempt_activation_authority() owner to postgres;
alter function coachfort_internal.activate_initial_tenant_plan_after_verified_payment(uuid) owner to postgres;
alter function coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(uuid) owner to postgres;
alter function public.get_tenant_subscription_lifecycle(uuid) owner to postgres;
alter function public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.activate_tenant_plan_after_verified_payment(uuid) owner to postgres;

revoke all on table public.tenant_subscription_change_intents from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.renewal_authority_key(uuid,uuid,uuid,uuid,text,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_subscription_change_intent_authority() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.tenant_subscription_effective_lifecycle(uuid) from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_captured_attempt_activation_authority() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.activate_initial_tenant_plan_after_verified_payment(uuid) from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_tenant_subscription_lifecycle(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.activate_tenant_plan_after_verified_payment(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_tenant_subscription_lifecycle(uuid) to authenticated;
grant execute on function public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.activate_tenant_plan_after_verified_payment(uuid) to service_role;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with expected_functions(identity, expected_authenticated, expected_service) as (
  values
    ('coachfort_internal.renewal_authority_key(uuid,uuid,uuid,uuid,text,text,timestamptz)', false, false),
    ('coachfort_internal.enforce_subscription_change_intent_authority()', false, false),
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)', false, false),
    ('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()', false, false),
    ('coachfort_internal.enforce_captured_attempt_activation_authority()', false, false),
    ('coachfort_internal.activate_initial_tenant_plan_after_verified_payment(uuid)', false, false),
    ('coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(uuid)', false, false),
    ('public.get_tenant_subscription_lifecycle(uuid)', true, false),
    ('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)', false, true),
    ('public.activate_tenant_plan_after_verified_payment(uuid)', false, true)
), function_state as (
  select expected.*,
    procedure.oid is not null as installed,
    owner_role.rolname as owner_name,
    procedure.prosecdef as security_definer,
    procedure.provolatile,
    coalesce(procedure.proconfig, array[]::text[]) as config,
    case when procedure.oid is null then false else has_function_privilege('authenticated', procedure.oid, 'EXECUTE') end as authenticated_execute,
    case when procedure.oid is null then false else has_function_privilege('anon', procedure.oid, 'EXECUTE') end as anon_execute,
    case when procedure.oid is null then false else has_function_privilege('service_role', procedure.oid, 'EXECUTE') end as service_execute,
    coalesce(exists (
      select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ), false) as public_execute
  from expected_functions expected
  left join pg_catalog.pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  left join pg_catalog.pg_roles owner_role on owner_role.oid = procedure.proowner
), source_state as (
  select
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.renewal_authority_key(uuid,uuid,uuid,uuid,text,text,timestamptz)')), '[[:space:]]+', ' ', 'g')) authority_key_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)')), '[[:space:]]+', ' ', 'g')) lifecycle_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.enforce_subscription_change_intent_authority()')), '[[:space:]]+', ' ', 'g')) intent_trigger_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)')), '[[:space:]]+', ' ', 'g')) order_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.activate_renewal_tenant_plan_after_verified_payment(uuid)')), '[[:space:]]+', ' ', 'g')) renewal_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.activate_tenant_plan_after_verified_payment(uuid)')), '[[:space:]]+', ' ', 'g')) coordinator_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()')), '[[:space:]]+', ' ', 'g')) payment_order_trigger_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.enforce_captured_attempt_activation_authority()')), '[[:space:]]+', ' ', 'g')) activation_trigger_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.discover_platform_billing_document_fulfillments_server(integer)')), '[[:space:]]+', ' ', 'g')) discovery_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.issue_platform_invoice_for_activation_server(uuid)')), '[[:space:]]+', ' ', 'g')) invoice_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.issue_platform_receipt_for_fulfillment_server(uuid)')), '[[:space:]]+', ' ', 'g')) receipt_source
), trigger_state as (
  select
    exists (
      select 1
      from pg_catalog.pg_trigger trigger_definition
      where trigger_definition.tgrelid = 'public.tenant_plan_activation_events'::regclass
        and trigger_definition.tgname = 'enforce_captured_attempt_activation_authority'
        and not trigger_definition.tgisinternal
        and trigger_definition.tgenabled <> 'D'
        and trigger_definition.tgfoid = to_regprocedure('coachfort_internal.enforce_captured_attempt_activation_authority()')
    ) as activation_function_bound,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger_definition
      where trigger_definition.tgrelid = 'public.tenant_plan_activation_events'::regclass
        and trigger_definition.tgname = 'enforce_captured_attempt_activation_authority'
        and not trigger_definition.tgisinternal
        and trigger_definition.tgenabled <> 'D'
        and trigger_definition.tgfoid = to_regprocedure('coachfort_internal.enforce_captured_attempt_activation_authority()')
        and (trigger_definition.tgtype & 1) = 1
        and (trigger_definition.tgtype & 2) = 2
        and (trigger_definition.tgtype & 4) = 4
        and (trigger_definition.tgtype & 16) = 16
        and trigger_definition.tgattr::text = ''
    ) as activation_insert_and_all_updates,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger_definition
      where trigger_definition.tgrelid = 'public.tenant_payment_orders'::regclass
        and trigger_definition.tgname = 'enforce_payment_order_commercial_snapshot_immutability'
        and not trigger_definition.tgisinternal
        and trigger_definition.tgenabled <> 'D'
        and trigger_definition.tgfoid = to_regprocedure('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()')
    ) as payment_order_function_bound,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger_definition
      where trigger_definition.tgrelid = 'public.tenant_payment_orders'::regclass
        and trigger_definition.tgname = 'enforce_payment_order_commercial_snapshot_immutability'
        and not trigger_definition.tgisinternal
        and trigger_definition.tgenabled <> 'D'
        and trigger_definition.tgfoid = to_regprocedure('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()')
        and (trigger_definition.tgtype & 1) = 1
        and (trigger_definition.tgtype & 2) = 2
        and (trigger_definition.tgtype & 16) = 16
        and trigger_definition.tgattr::text = ''
    ) as payment_order_all_updates
), object_state as (
  select jsonb_build_object(
    'intent_table', to_regclass('public.tenant_subscription_change_intents') is not null,
    'order_linkage_columns', (
      select count(*) = 2 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name in ('subscription_change_intent_id','change_intent_generation')
    ),
    'activation_linkage_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
        and column_name = 'subscription_change_intent_id'
    ),
    'intent_rls', exists (
      select 1 from pg_catalog.pg_class relation
      where relation.oid = 'public.tenant_subscription_change_intents'::regclass
        and relation.relrowsecurity and not relation.relforcerowsecurity
    ),
    'one_order_generation', to_regclass('public.tenant_payment_orders_change_intent_generation_uidx') is not null,
    'one_nonterminal_order', to_regclass('public.tenant_payment_orders_change_intent_nonterminal_uidx') is not null,
    'one_successful_activation', to_regclass('public.tenant_plan_activation_events_change_intent_success_uidx') is not null,
    'one_activation_per_order', to_regclass('public.tenant_plan_activation_events_payment_order_uidx') is not null,
    'intent_trigger', exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.tenant_subscription_change_intents'::regclass
        and tgname = 'enforce_subscription_change_intent_authority' and not tgisinternal and tgenabled <> 'D'
    ),
    'activation_trigger_function_bound', (select activation_function_bound from trigger_state),
    'activation_trigger_insert_and_all_updates', (select activation_insert_and_all_updates from trigger_state),
    'payment_order_trigger_function_bound', (select payment_order_function_bound from trigger_state),
    'payment_order_trigger_all_updates', (select payment_order_all_updates from trigger_state)
  ) as value
), browser_grants as (
  select count(*) as grant_count
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in (
      'tenant_subscription_change_intents','tenant_payment_orders',
      'tenant_payment_attempts','tenant_plan_activation_events'
    )
    and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
), browser_direct_intent_grants as (
  select count(*) as grant_count
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'tenant_subscription_change_intents'
    and grantee in ('PUBLIC','anon','authenticated','service_role')
), counts as (
  select jsonb_build_object(
    'change_intents', (select count(*) from public.tenant_subscription_change_intents),
    'renewal_payment_orders', (select count(*) from public.tenant_payment_orders where subscription_change_intent_id is not null),
    'renewal_activation_events', (select count(*) from public.tenant_plan_activation_events where subscription_change_intent_id is not null),
    'platform_invoices', (select count(*) from public.invoices),
    'platform_receipts', (select count(*) from public.platform_billing_receipts),
    'finance_invoices', (select count(*) from public.finance_invoices),
    'finance_payments', (select count(*) from public.finance_payments),
    'finance_receipts', (select count(*) from public.finance_receipts)
  ) as value
), contracts as (
  select
    to_regprocedure('extensions.digest(bytea,text)') is not null
      and authority_key_source like '%extensions.digest(%'
      and authority_key_source not like '%public.digest(%'
      as pgcrypto_authority_secure,
    lifecycle_source like '%v_grace_end := v_assignment.grace_period_ends_at%'
      and lifecycle_source not like '%coalesce(v_assignment.grace_period_ends_at%'
      and lifecycle_source like '%if v_assignment.status = ''trial'' then%'
      and lifecycle_source like '%now() < v_assignment.trial_ends_at%'
      and lifecycle_source like '%trial_period_elapsed%'
      and lifecycle_source like '%now() < v_period_end%'
      and lifecycle_source like '%now() < v_grace_end%'
      and lifecycle_source like '%interval ''7 days''%'
      and lifecycle_source like '%operational_allowed%'
      and lifecycle_source like '%invalid_status_payment_combination%' as lifecycle_secure,
    intent_trigger_source like '%v_base.status not in (''active'',''grace'',''past_due'')%'
      and intent_trigger_source like '%v_base.status = ''active'' and v_base.payment_status in (''paid'',''waived'')%'
      and intent_trigger_source like '%v_base.status = ''grace'' and v_base.payment_status in (''paid'',''overdue'',''waived'')%'
      and intent_trigger_source like '%v_base.status = ''past_due'' and v_base.payment_status in (''unpaid'',''overdue'')%'
      as renewal_intent_anchor_secure,
    order_source like '%v_base.status not in (''active'',''grace'',''past_due'')%'
      and order_source like '%v_base.status = ''active'' and v_base.payment_status in (''paid'',''waived'')%'
      and order_source like '%v_base.status = ''grace'' and v_base.payment_status in (''paid'',''overdue'',''waived'')%'
      and order_source like '%v_base.status = ''past_due'' and v_base.payment_status in (''unpaid'',''overdue'')%'
      and order_source like '%v_base.plan_id <> p_plan_id%'
      and order_source like '%v_base.billing_cycle <> v_price.billing_cycle%'
      and order_source like '%v_base.currency <> v_price.currency%'
      and order_source like '%interval ''30 days''%'
      and order_source like '%setup_fee_amount_minor'', 0%'
      and order_source like '%v_total_amount_minor := v_price.amount_minor + coalesce(v_tax_amount_minor, 0)%'
      and order_source like '%subscription_change_intent_id%'
      and order_source like '%change_intent_generation%' as renewal_order_secure,
    renewal_source like '%v_attempt.captured_at <= v_intent.base_period_end%'
      and renewal_source like '%then v_intent.base_period_end else v_attempt.captured_at%'
      and renewal_source like '%interval ''1 month''%'
      and renewal_source like '%interval ''1 year''%'
      and renewal_source like '%grace_period_ends_at = v_period_end + interval ''7 days''%'
      and renewal_source like '%second_captured_payment_after_intent_activation%'
      and renewal_source like '%status = ''activated'', activated_at = v_now%'
      and renewal_source like '%event.event_type = ''payment.captured''%' as renewal_activation_secure,
    coordinator_source like '%if v_intent_id is null%'
      and coordinator_source like '%activate_initial_tenant_plan_after_verified_payment%'
      and coordinator_source like '%grace_period_ends_at = current_period_end + interval ''7 days''%'
      and coordinator_source like '%and grace_period_ends_at is null%'
      and coordinator_source like '%activate_renewal_tenant_plan_after_verified_payment%' as coordinator_secure,
    payment_order_trigger_source like '%new.subscription_change_intent_id is distinct from old.subscription_change_intent_id%'
      and payment_order_trigger_source like '%new.change_intent_generation is distinct from old.change_intent_generation%'
      and payment_order_trigger_source like '%payment-order commercial authority is immutable%' as payment_order_immutability_secure,
    activation_trigger_source like '%new.billing_period_start := v_expected_period_start%'
      and activation_trigger_source like '%new.billing_period_end := v_expected_period_end%'
      and activation_trigger_source like '%when v_attempt.captured_at <= v_intent.base_period_end then v_intent.base_period_end%'
      and activation_trigger_source like '%else v_attempt.captured_at%'
      and activation_trigger_source like '%successful activation authority is immutable%'
      and activation_trigger_source like '%new.subscription_change_intent_id is distinct from old.subscription_change_intent_id%'
      and activation_trigger_source like '%new.previous_assignment_id is distinct from old.previous_assignment_id%'
      and activation_trigger_source like '%new.metadata_json is distinct from old.metadata_json%' as activation_period_secure,
    discovery_source like '%activation.activation_status in (''activated'',''skipped_already_active'')%'
      and invoice_source like '%invoice:activation:%'
      and receipt_source like '%receipt:payment_attempt:%' as ux8f_documents_unchanged
  from source_state
), constraint_state as (
  select
    count(*) filter (where conname = 'tenant_payment_orders_renewal_setup_fee_zero_check') = 1 as setup_fee_zero,
    count(*) filter (where conname = 'tenant_payment_orders_change_intent_linkage_check') = 1 as linkage_complete,
    count(*) filter (where conname = 'tenant_subscription_change_intents_authority_key_unique') = 1 as authority_unique,
    count(*) filter (where conname = 'tenant_subscription_change_intents_status_check') = 1 as status_limited
  from pg_catalog.pg_constraint
  where conname in (
    'tenant_payment_orders_renewal_setup_fee_zero_check',
    'tenant_payment_orders_change_intent_linkage_check',
    'tenant_subscription_change_intents_authority_key_unique',
    'tenant_subscription_change_intents_status_check'
  )
), security as (
  select
    bool_and(installed and owner_name = 'postgres' and security_definer
      and config @> array['search_path=public, pg_temp']::text[]
      and authenticated_execute = expected_authenticated
      and service_execute = expected_service
      and not anon_execute and not public_execute) as function_acl_secure
  from function_state
)
select jsonb_build_object(
  'bundle', 'UX-8G1A',
  'security_gate',
    (select function_acl_secure from security)
    and (select grant_count = 0 from browser_grants)
    and (select grant_count = 0 from browser_direct_intent_grants)
    and (select provolatile = 's' from function_state where identity = 'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)')
    and (select provolatile = 'i' from function_state where identity = 'coachfort_internal.renewal_authority_key(uuid,uuid,uuid,uuid,text,text,timestamptz)')
    and (select value = jsonb_build_object(
      'intent_table', true, 'order_linkage_columns', true,
      'activation_linkage_column', true, 'intent_rls', true,
      'one_order_generation', true, 'one_nonterminal_order', true,
      'one_successful_activation', true, 'one_activation_per_order', true, 'intent_trigger', true,
      'activation_trigger_function_bound', true,
      'activation_trigger_insert_and_all_updates', true,
      'payment_order_trigger_function_bound', true,
      'payment_order_trigger_all_updates', true
    ) from object_state)
    and (select pgcrypto_authority_secure and lifecycle_secure and renewal_intent_anchor_secure
      and renewal_order_secure and renewal_activation_secure
      and coordinator_secure and payment_order_immutability_secure
      and activation_period_secure and ux8f_documents_unchanged from contracts)
    and (select setup_fee_zero and linkage_complete and authority_unique and status_limited from constraint_state)
    and (select count(*) = 0 from public.tenant_subscription_change_intents)
    and (select count(*) = 0 from public.tenant_payment_orders where subscription_change_intent_id is not null)
    and (select count(*) = 0 from public.tenant_plan_activation_events where subscription_change_intent_id is not null)
    and not exists (
      select 1
      from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
      where btrim(exposed.schema_name) = 'coachfort_internal'
    ),
  'objects', (select value from object_state),
  'trigger_catalog', (select to_jsonb(trigger_state) from trigger_state),
  'function_security', (select jsonb_agg(to_jsonb(function_state) order by identity) from function_state),
  'browser_write_grants', (select grant_count from browser_grants),
  'browser_direct_intent_grants', (select grant_count from browser_direct_intent_grants),
  'internal_schema_exposed', exists (
    select 1
    from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
    where btrim(exposed.schema_name) = 'coachfort_internal'
  ),
  'pgcrypto_authority', (select pgcrypto_authority_secure from contracts),
  'lifecycle_contract', (select lifecycle_secure from contracts),
  'renewal_intent_anchor_contract', (select renewal_intent_anchor_secure from contracts),
  'renewal_order_contract', (select renewal_order_secure from contracts),
  'renewal_activation_contract', (select renewal_activation_secure from contracts),
  'activation_coordinator', (select coordinator_secure from contracts),
  'payment_order_immutability', (select payment_order_immutability_secure from contracts),
  'activation_event_period_and_immutability', (select activation_period_secure from contracts),
  'ux8f_document_keys_and_discovery_unchanged', (select ux8f_documents_unchanged from contracts),
  'constraints', (select to_jsonb(constraint_state) from constraint_state),
  'migration_created_business_rows', jsonb_build_object(
    'change_intents', (select count(*) from public.tenant_subscription_change_intents),
    'renewal_orders', (select count(*) from public.tenant_payment_orders where subscription_change_intent_id is not null),
    'renewal_activations', (select count(*) from public.tenant_plan_activation_events where subscription_change_intent_id is not null)
  ),
  'payment_document_and_student_finance_counts', (select value from counts),
  'invoice_receipt_schema_changed', false,
  'student_finance_changed', false,
  'ux8g1b_operational_restriction_enabled', false
);
*/
