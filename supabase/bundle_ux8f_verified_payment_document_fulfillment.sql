-- Bundle UX-8F1: verified-payment authority and durable platform billing fulfillment.
-- Review before execution. This migration creates no payments, activations,
-- invoices, receipts, issuer profiles, or Student Finance records.

/*
PRE-APPLY READ-ONLY VERIFICATION

with required_relations(identity) as (
  values
    ('public.tenant_payment_orders'),
    ('public.tenant_payment_attempts'),
    ('public.razorpay_webhook_events'),
    ('public.tenant_plan_activation_events'),
    ('public.tenant_subscription_assignments'),
    ('public.subscription_plans'),
    ('public.subscription_plan_prices'),
    ('public.tenant_billing_profiles'),
    ('public.platform_billing_issuer_profiles'),
    ('public.invoices'),
    ('public.invoice_items'),
    ('public.platform_billing_receipts'),
    ('public.payment_transactions'),
    ('public.finance_invoices'),
    ('public.finance_payments'),
    ('public.finance_receipts'),
    ('public.finance_adjustments')
), relation_state as (
  select rr.identity, c.oid is not null as installed,
    case when c.oid is null then null else pg_get_userbyid(c.relowner) end as owner,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    coalesce(c.relforcerowsecurity, false) as force_rls
  from required_relations rr
  left join pg_catalog.pg_class c on c.oid = to_regclass(rr.identity)
), required_functions(identity) as (
  values
    ('public.activate_tenant_plan_after_verified_payment(uuid)'),
    ('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'),
    ('public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'),
    ('public.get_platform_billing_documents(uuid)'),
    ('public.get_tenant_billing_profile_completion(uuid)'),
    ('coachfort_internal.next_platform_billing_document_number(text,timestamptz)')
), function_state as (
  select rf.identity, p.oid is not null as installed,
    case when p.oid is null then null else pg_get_userbyid(p.proowner) end as owner,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(p.proconfig, array[]::text[]) as configuration
  from required_functions rf
  left join pg_catalog.pg_proc p on p.oid = to_regprocedure(rf.identity)
), existing_ux8f_objects as (
  select jsonb_build_object(
    'fulfillment_table', to_regclass('public.platform_billing_document_fulfillments') is not null,
    'billing_snapshot_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name = 'billing_snapshot'
    ),
    'issuer_snapshot_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name = 'issuer_snapshot'
    ),
    'plan_snapshot_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name = 'plan_snapshot'
    ),
    'activation_period_columns', (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
        and column_name in ('billing_period_start','billing_period_end')
    ),
    'public_function_count', (
      select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'create_platform_payment_order_authority_server',
        'discover_platform_billing_document_fulfillments_server',
        'claim_platform_billing_document_fulfillments_server',
        'resume_platform_billing_document_fulfillment_server',
        'finalize_platform_billing_document_fulfillment_server',
        'issue_platform_invoice_for_activation_server',
        'issue_platform_receipt_for_fulfillment_server'
      )
    )
  ) as value
), direct_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', tp.table_schema || '.' || tp.table_name,
    'grantee', tp.grantee,
    'privilege', tp.privilege_type
  ) order by tp.table_schema, tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb) as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name in (
      'tenant_payment_orders','tenant_payment_attempts','tenant_plan_activation_events',
      'platform_billing_issuer_profiles','invoices','invoice_items',
      'platform_billing_receipts','payment_transactions'
    )
    and tp.grantee in ('PUBLIC','anon','authenticated','service_role')
), counts as (
  select jsonb_build_object(
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'platform_invoices', (select count(*) from public.invoices),
    'platform_receipts', (select count(*) from public.platform_billing_receipts),
    'issuer_profiles', (select count(*) from public.platform_billing_issuer_profiles),
    'student_finance_invoices', (select count(*) from public.finance_invoices),
    'student_finance_payments', (select count(*) from public.finance_payments),
    'student_finance_receipts', (select count(*) from public.finance_receipts),
    'student_finance_adjustments', (select count(*) from public.finance_adjustments)
  ) as value
), index_state as (
  select jsonb_build_object(
    'payment_attempt_provider_payment_unique', to_regclass('public.tenant_payment_attempts_provider_payment_id_uidx') is not null,
    'activation_payment_order_unique', to_regclass('public.tenant_plan_activation_events_payment_order_uidx') is not null,
    'invoice_source_unique', to_regclass('public.invoices_source_key_uidx') is not null,
    'receipt_source_unique', exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = to_regclass('public.platform_billing_receipts')
        and conname = 'platform_billing_receipts_source_key_key' and contype = 'u'
    )
  ) as value
), gates as (
  select
    (select bool_and(installed) from relation_state) as relations_ready,
    (select bool_and(installed and owner = 'postgres' and security_definer
      and 'search_path=public, pg_temp' = any(configuration)) from function_state
      where identity <> 'public.activate_tenant_plan_after_verified_payment(uuid)')
      and exists (
        select 1 from function_state
        where identity = 'public.activate_tenant_plan_after_verified_payment(uuid)'
          and installed and owner = 'postgres' and security_definer
      ) as functions_ready,
    not exists (
      select 1 from information_schema.table_privileges tp
      where tp.table_schema = 'public' and tp.table_name = 'payment_transactions'
        and tp.grantee in ('PUBLIC','anon','authenticated','service_role')
    ) as legacy_payment_closed,
    to_regclass('public.platform_billing_document_fulfillments') is null
      and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tenant_payment_orders'
          and column_name in ('billing_snapshot','issuer_snapshot','plan_snapshot','tax_calculation_status')
      )
      and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
          and column_name in ('billing_period_start','billing_period_end')
      )
      and not exists (
        select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','coachfort_internal')
          and p.proname in (
            'create_platform_payment_order_authority_server',
            'discover_platform_billing_document_fulfillments_server',
            'claim_platform_billing_document_fulfillments_server',
            'resume_platform_billing_document_fulfillment_server',
            'finalize_platform_billing_document_fulfillment_server',
            'issue_platform_invoice_for_activation_server',
            'issue_platform_receipt_for_fulfillment_server',
            'enforce_payment_order_commercial_snapshot_immutability',
            'enforce_captured_attempt_activation_authority'
          )
      ) as ux8f_objects_clear,
    to_regclass('public.tenant_payment_attempts_provider_payment_id_uidx') is not null
      and to_regclass('public.tenant_plan_activation_events_payment_order_uidx') is not null
      and to_regclass('public.invoices_source_key_uidx') is not null
      and exists (
        select 1 from pg_catalog.pg_constraint
        where conrelid = to_regclass('public.platform_billing_receipts')
          and conname = 'platform_billing_receipts_source_key_key' and contype = 'u'
      ) as indexes_ready,
    not exists (
      select 1
      from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
      where btrim(exposed.schema_name) = 'coachfort_internal'
    ) as internal_schema_safe
)
select jsonb_build_object(
  'ready_for_apply', coalesce(relations_ready and functions_ready and legacy_payment_closed
    and ux8f_objects_clear and indexes_ready and internal_schema_safe, false),
  'relations', (select jsonb_agg(to_jsonb(relation_state) order by identity) from relation_state),
  'functions', (select jsonb_agg(to_jsonb(function_state) order by identity) from function_state),
  'existing_ux8f_objects', (select value from existing_ux8f_objects),
  'direct_grants', (select value from direct_grants),
  'indexes', (select value from index_state),
  'counts', (select value from counts),
  'internal_schema_exposed', not internal_schema_safe
)
from gates;
*/

begin;

do $$
declare
  v_missing text[];
begin
  select array_agg(required.identity order by required.identity) into v_missing
  from unnest(array[
    'public.tenant_payment_orders',
    'public.tenant_payment_attempts',
    'public.razorpay_webhook_events',
    'public.tenant_plan_activation_events',
    'public.tenant_subscription_assignments',
    'public.subscription_plans',
    'public.subscription_plan_prices',
    'public.tenant_billing_profiles',
    'public.platform_billing_issuer_profiles',
    'public.invoices',
    'public.invoice_items',
    'public.platform_billing_receipts',
    'public.payment_transactions',
    'public.finance_invoices',
    'public.finance_payments',
    'public.finance_receipts',
    'public.finance_adjustments'
  ]) as required(identity)
  where to_regclass(required.identity) is null;

  if v_missing is not null then
    raise exception 'UX-8F1 required relations are missing: %', v_missing using errcode = '55000';
  end if;

  if to_regprocedure('public.activate_tenant_plan_after_verified_payment(uuid)') is null
     or to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)') is null
     or to_regprocedure('public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)') is null
     or to_regprocedure('public.get_platform_billing_documents(uuid)') is null
     or to_regprocedure('public.get_tenant_billing_profile_completion(uuid)') is null
     or to_regprocedure('coachfort_internal.next_platform_billing_document_number(text,timestamptz)') is null then
    raise exception 'UX-8D/UX-8E or verified-payment prerequisites are incomplete.' using errcode = '55000';
  end if;

  if to_regclass('public.tenant_payment_attempts_provider_payment_id_uidx') is null
     or to_regclass('public.tenant_plan_activation_events_payment_order_uidx') is null
     or to_regclass('public.invoices_source_key_uidx') is null
     or not exists (
       select 1 from pg_catalog.pg_constraint
       where conrelid = to_regclass('public.platform_billing_receipts')
         and conname = 'platform_billing_receipts_source_key_key' and contype = 'u'
     ) then
    raise exception 'UX-8F1 idempotency prerequisites are incomplete.' using errcode = '55000';
  end if;

  if to_regclass('public.platform_billing_document_fulfillments') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_payment_orders'
         and column_name in ('billing_snapshot','issuer_snapshot','plan_snapshot','tax_calculation_status')
     )
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
         and column_name in ('billing_period_start','billing_period_end')
     )
     or exists (
       select 1 from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','coachfort_internal')
         and p.proname in (
           'create_platform_payment_order_authority_server',
           'discover_platform_billing_document_fulfillments_server',
           'claim_platform_billing_document_fulfillments_server',
           'resume_platform_billing_document_fulfillment_server',
           'finalize_platform_billing_document_fulfillment_server',
           'issue_platform_invoice_for_activation_server',
           'issue_platform_receipt_for_fulfillment_server',
           'enforce_payment_order_commercial_snapshot_immutability',
           'enforce_captured_attempt_activation_authority'
         )
     ) then
    raise exception 'Conflicting UX-8F1 objects already exist.' using errcode = '55000';
  end if;

  if (select count(*) from public.tenant_payment_orders) <> 0
     or (select count(*) from public.tenant_payment_attempts) <> 0
     or (select count(*) from public.tenant_plan_activation_events) <> 0
     or (select count(*) from public.invoices) <> 0
     or (select count(*) from public.platform_billing_receipts) <> 0 then
    raise exception 'UX-8F1 requires explicit compatibility review for existing payment or platform-document rows.' using errcode = '55000';
  end if;

  if exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public' and tp.table_name = 'payment_transactions'
      and tp.grantee in ('PUBLIC','anon','authenticated','service_role')
  ) then
    raise exception 'Legacy payment_transactions direct grants must remain closed.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
    where btrim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'coachfort_internal must not be exposed through PostgREST.' using errcode = '55000';
  end if;
end;
$$;

-- SQL-first rollout compatibility: baseline a4b7aa9 inserts payment orders
-- directly without these fields. New authority writes all four atomically.
alter table public.tenant_payment_orders
  add column billing_snapshot jsonb,
  add column issuer_snapshot jsonb,
  add column plan_snapshot jsonb,
  add column tax_calculation_status text;

alter table public.tenant_plan_activation_events
  add column billing_period_start timestamptz,
  add column billing_period_end timestamptz;

alter table public.tenant_payment_orders
  add constraint tenant_payment_orders_snapshot_presence_check check (
    (
      billing_snapshot is null
      and issuer_snapshot is null
      and plan_snapshot is null
      and tax_calculation_status is null
    )
    or
    (
      billing_snapshot is not null
      and issuer_snapshot is not null
      and plan_snapshot is not null
      and tax_calculation_status is not null
    )
  ),
  add constraint tenant_payment_orders_tax_calculation_status_check check (
    tax_calculation_status in ('not_calculated','not_applicable','calculated')
  ),
  add constraint tenant_payment_orders_tax_state_check check (
    (tax_calculation_status = 'not_calculated' and tax_amount_minor is null)
    or (tax_calculation_status = 'not_applicable' and tax_amount_minor = 0)
    or (tax_calculation_status = 'calculated' and tax_amount_minor is not null and tax_amount_minor >= 0)
  ),
  add constraint tenant_payment_orders_commercial_total_check check (
    total_amount_minor = amount_minor + setup_fee_amount_minor + coalesce(tax_amount_minor, 0)
  ),
  add constraint tenant_payment_orders_frozen_snapshot_shape_check check (
    jsonb_typeof(billing_snapshot) = 'object'
    and jsonb_typeof(issuer_snapshot) = 'object'
    and jsonb_typeof(plan_snapshot) = 'object'
    and billing_snapshot ?& array[
      'legal_name','billing_email','billing_phone','invoice_contact_name',
      'address_line1','address_line2','city','state','postal_code','country',
      'preferred_currency','tax_registration_type','tax_id','profile_updated_at'
    ]
    and issuer_snapshot ?& array[
      'legal_name','billing_email','billing_phone','address_line1','address_line2',
      'city','state','postal_code','country','tax_registration_type','tax_id',
      'effective_from','profile_updated_at'
    ]
    and plan_snapshot ?& array[
      'plan_id','plan_code','plan_name','price_id','billing_cycle','currency',
      'region_code','amount_minor','unit_amount_minor','setup_fee_amount_minor','tax_amount_minor',
      'tax_behavior','tax_calculation_status','total_amount_minor'
    ]
  ),
  add constraint tenant_payment_orders_frozen_snapshot_size_check check (
    octet_length(billing_snapshot::text) <= 12000
    and octet_length(issuer_snapshot::text) <= 12000
    and octet_length(plan_snapshot::text) <= 8000
  );

alter table public.tenant_plan_activation_events
  add constraint tenant_plan_activation_events_billing_period_check check (
    activation_status not in ('activated','skipped_already_active')
    or (
      billing_period_start is not null
      and billing_period_end is not null
      and billing_period_start < billing_period_end
    )
  );

create function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()
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
     or new.checkout_enabled_source is distinct from old.checkout_enabled_source then
    raise exception 'Payment-order commercial authority is immutable.' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger enforce_payment_order_commercial_snapshot_immutability
before update on public.tenant_payment_orders
for each row execute function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability();

create function public.create_platform_payment_order_authority_server(
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
  v_current public.tenant_subscription_assignments%rowtype;
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
    raise exception 'Tenant, creator, plan, and price are required for checkout.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id and member.user_id = p_created_by
      and member.role in ('owner','admin')
  ) then
    raise exception 'Only tenant owners and admins can create payment orders.' using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  select * into v_price
  from public.subscription_plan_prices
  where id = p_price_id and plan_id = p_plan_id;

  if v_plan.id is null or v_price.id is null then
    raise exception 'Canonical checkout plan or price is unavailable.' using errcode = '22023';
  end if;

  if v_plan.code not in ('starter','growth')
     or v_plan.status <> 'draft' or v_plan.is_public
     or v_price.status <> 'draft'
     or v_price.currency <> 'INR'
     or v_price.billing_cycle not in ('monthly','yearly')
     or v_price.region_code <> 'GLOBAL'
     or coalesce(v_price.metadata_json->>'pricing_finalized', 'false') <> 'true'
     or coalesce(v_price.metadata_json->>'pricing_finalized_module', '') <> '71.7R0B'
     or coalesce(v_price.metadata_json->>'checkout_enabled', 'true') <> 'false' then
    raise exception 'Canonical price is not eligible for Razorpay test checkout.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.tenant_billing_profiles
  where tenant_id = p_tenant_id;

  if v_profile.tenant_id is null
     or nullif(btrim(v_profile.legal_name), '') is null
     or nullif(btrim(v_profile.billing_email), '') is null
     or nullif(btrim(v_profile.address_line1), '') is null
     or nullif(btrim(v_profile.city), '') is null
     or nullif(btrim(v_profile.postal_code), '') is null
     or public.billing_profile_currency_for_country(v_profile.country) is null
     or v_profile.preferred_currency is distinct from public.billing_profile_currency_for_country(v_profile.country)
     or v_profile.preferred_currency is distinct from v_price.currency then
    raise exception 'Complete the billing profile before starting payment.' using errcode = '22023';
  end if;

  select * into v_issuer
  from public.platform_billing_issuer_profiles
  where profile_key = 'default' and status = 'active' and effective_from <= now();

  if v_issuer.profile_key is null then
    raise exception 'CoachFort billing issuer profile is not configured.' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ux8f1_checkout:' || p_tenant_id::text || ':' || p_plan_id::text || ':' || v_price.billing_cycle,
    81
  ));

  select * into v_current
  from public.tenant_subscription_assignments
  where tenant_id = p_tenant_id and is_current
  for share;

  if v_current.id is not null
     and v_current.plan_id = p_plan_id
     and v_current.billing_cycle = v_price.billing_cycle
     and v_current.status = 'active'
     and v_current.payment_status = 'paid' then
    raise exception 'This plan and billing cycle are already active. Renewal checkout is not available yet.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenant_payment_orders existing_order
    where existing_order.tenant_id = p_tenant_id
      and existing_order.plan_id = p_plan_id
      and existing_order.billing_cycle = v_price.billing_cycle
      and existing_order.internal_status not in ('failed','cancelled','expired','activated')
  ) then
    raise exception 'A checkout for this plan and billing cycle is already in progress.' using errcode = '22023';
  end if;

  v_tax_calculation_status := case
    when v_price.tax_behavior = 'not_applicable' then 'not_applicable'
    else 'not_calculated'
  end;
  v_tax_amount_minor := case when v_tax_calculation_status = 'not_applicable' then 0 else null end;
  v_total_amount_minor := v_price.amount_minor + v_price.setup_fee_amount_minor + coalesce(v_tax_amount_minor, 0);

  v_billing_snapshot := jsonb_build_object(
    'legal_name', v_profile.legal_name,
    'billing_email', v_profile.billing_email,
    'billing_phone', v_profile.billing_phone,
    'invoice_contact_name', v_profile.invoice_contact_name,
    'address_line1', v_profile.address_line1,
    'address_line2', v_profile.address_line2,
    'city', v_profile.city,
    'state', v_profile.state,
    'postal_code', v_profile.postal_code,
    'country', v_profile.country,
    'preferred_currency', v_profile.preferred_currency,
    'tax_registration_type', v_profile.tax_registration_type,
    'tax_id', v_profile.tax_id,
    'profile_updated_at', v_profile.updated_at
  );
  v_issuer_snapshot := jsonb_build_object(
    'legal_name', v_issuer.legal_name,
    'billing_email', v_issuer.billing_email,
    'billing_phone', v_issuer.billing_phone,
    'address_line1', v_issuer.address_line1,
    'address_line2', v_issuer.address_line2,
    'city', v_issuer.city,
    'state', v_issuer.state,
    'postal_code', v_issuer.postal_code,
    'country', v_issuer.country,
    'tax_registration_type', v_issuer.tax_registration_type,
    'tax_id', v_issuer.tax_id,
    'effective_from', v_issuer.effective_from,
    'profile_updated_at', v_issuer.updated_at
  );
  v_plan_snapshot := jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_code', v_plan.code,
    'plan_name', v_plan.name,
    'price_id', v_price.id,
    'billing_cycle', v_price.billing_cycle,
    'currency', v_price.currency,
    'region_code', v_price.region_code,
    'amount_minor', v_price.amount_minor,
    'unit_amount_minor', v_price.amount_minor,
    'setup_fee_amount_minor', v_price.setup_fee_amount_minor,
    'tax_amount_minor', v_tax_amount_minor,
    'tax_behavior', v_price.tax_behavior,
    'tax_calculation_status', v_tax_calculation_status,
    'total_amount_minor', v_total_amount_minor
  );
  v_order_metadata := jsonb_build_object(
    'activation_enabled', false,
    'browser_success_not_activation', true,
    'module', 'UX-8F1',
    'price_metadata_snapshot', coalesce(v_price.metadata_json, '{}'::jsonb),
    'public_launch_pending', true,
    'test_tenant_allowlisted', true
  );
  v_provider_receipt := 'cf_' || left(replace(v_order_id::text, '-', ''), 28);

  insert into public.tenant_payment_orders (
    id, tenant_id, created_by, plan_id, price_id, plan_code, billing_cycle,
    currency, amount_minor, setup_fee_amount_minor, tax_amount_minor,
    tax_calculation_status, total_amount_minor, provider, provider_mode,
    provider_receipt, internal_status, idempotency_key,
    checkout_enabled_source, metadata_json, billing_snapshot,
    issuer_snapshot, plan_snapshot, expires_at
  ) values (
    v_order_id, p_tenant_id, p_created_by, v_plan.id, v_price.id, v_plan.code,
    v_price.billing_cycle, v_price.currency, v_price.amount_minor,
    v_price.setup_fee_amount_minor, v_tax_amount_minor,
    v_tax_calculation_status, v_total_amount_minor, 'razorpay', 'test',
    v_provider_receipt, 'created', 'ux8f1:' || gen_random_uuid()::text,
    'regression_test_gate', v_order_metadata, v_billing_snapshot,
    v_issuer_snapshot, v_plan_snapshot, now() + interval '30 minutes'
  );

  return jsonb_build_object(
    'billing_snapshot', v_billing_snapshot,
    'issuer_snapshot', v_issuer_snapshot,
    'order_id', v_order_id,
    'order_metadata', v_order_metadata,
    'plan_snapshot', v_plan_snapshot,
    'provider_receipt', v_provider_receipt,
    'tax_amount_minor', v_tax_amount_minor,
    'tax_calculation_status', v_tax_calculation_status,
    'total_amount_minor', v_total_amount_minor
  );
end;
$$;

create function coachfort_internal.enforce_captured_attempt_activation_authority()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.tenant_payment_orders%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_assignment public.tenant_subscription_assignments%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.activation_status in ('activated','skipped_already_active') then
      if new.activation_status is distinct from old.activation_status
         or new.activated_at is distinct from old.activated_at
         or new.payment_order_id is distinct from old.payment_order_id
         or new.provider_order_id is distinct from old.provider_order_id
         or new.provider_payment_id is distinct from old.provider_payment_id
         or new.tenant_id is distinct from old.tenant_id
         or new.plan_id is distinct from old.plan_id
         or new.price_id is distinct from old.price_id
         or new.new_assignment_id is distinct from old.new_assignment_id
         or new.billing_period_start is distinct from old.billing_period_start
         or new.billing_period_end is distinct from old.billing_period_end
         or new.metadata_json->>'captured_attempt_id' is distinct from old.metadata_json->>'captured_attempt_id' then
        raise exception 'Successful activation authority is immutable.' using errcode = '55000';
      end if;
      return new;
    end if;
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
      select 1
      from public.razorpay_webhook_events event
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

  new.provider_order_id := v_order.provider_order_id;
  new.provider_payment_id := v_attempt.provider_payment_id;
  new.billing_period_start := v_assignment.current_period_start;
  new.billing_period_end := v_assignment.current_period_end;
  new.metadata_json := coalesce(new.metadata_json, '{}'::jsonb)
    || jsonb_build_object(
      'captured_attempt_id', v_attempt.id,
      'captured_at', v_attempt.captured_at,
      'billing_period_frozen', true,
      'ux8f1_captured_attempt_required', true
    );

  return new;
end;
$$;

create trigger enforce_captured_attempt_activation_authority
before insert or update of activation_status, metadata_json, new_assignment_id,
  billing_period_start, billing_period_end, payment_order_id, tenant_id, plan_id, price_id,
  activated_at, provider_order_id, provider_payment_id
on public.tenant_plan_activation_events
for each row execute function coachfort_internal.enforce_captured_attempt_activation_authority();

create table public.platform_billing_document_fulfillments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  activation_event_id uuid not null references public.tenant_plan_activation_events(id) on delete restrict,
  payment_order_id uuid not null references public.tenant_payment_orders(id) on delete restrict,
  payment_attempt_id uuid not null references public.tenant_payment_attempts(id) on delete restrict,
  subscription_assignment_id uuid not null references public.tenant_subscription_assignments(id) on delete restrict,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claim_owner text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  invoice_id uuid references public.invoices(id) on delete restrict,
  receipt_id uuid references public.platform_billing_receipts(id) on delete restrict,
  last_error_code text,
  last_error_class text,
  last_error_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_billing_document_fulfillments_activation_key unique (activation_event_id),
  constraint platform_billing_document_fulfillments_order_key unique (payment_order_id),
  constraint platform_billing_document_fulfillments_attempt_key unique (payment_attempt_id),
  constraint platform_billing_document_fulfillments_invoice_key unique (invoice_id),
  constraint platform_billing_document_fulfillments_receipt_key unique (receipt_id),
  constraint platform_billing_document_fulfillments_status_check check (
    status in ('pending','processing','retryable','blocked_prerequisite','manual_review','completed')
  ),
  constraint platform_billing_document_fulfillments_attempt_count_check check (attempt_count between 0 and 5),
  constraint platform_billing_document_fulfillments_claim_check check (
    (status = 'processing' and claim_token is not null and claim_owner is not null
      and claimed_at is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and claim_token is null and claim_owner is null
      and claimed_at is null and lease_expires_at is null)
  ),
  constraint platform_billing_document_fulfillments_error_class_check check (
    last_error_class is null or last_error_class in ('configuration','transient','conflict','permanent')
  ),
  constraint platform_billing_document_fulfillments_error_text_check check (
    (last_error_code is null or (char_length(last_error_code) <= 120 and last_error_code !~ '[<>]'))
    and (claim_owner is null or (char_length(claim_owner) <= 100 and claim_owner !~ '[<>]'))
  ),
  constraint platform_billing_document_fulfillments_completion_check check (
    (status = 'completed' and invoice_id is not null and receipt_id is not null and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index platform_billing_document_fulfillments_claim_idx
  on public.platform_billing_document_fulfillments(status, next_attempt_at, created_at, id);
create index platform_billing_document_fulfillments_lease_idx
  on public.platform_billing_document_fulfillments(lease_expires_at)
  where status = 'processing';
create index platform_billing_document_fulfillments_tenant_idx
  on public.platform_billing_document_fulfillments(tenant_id, created_at desc);

create trigger set_platform_billing_document_fulfillments_updated_at
before update on public.platform_billing_document_fulfillments
for each row execute function public.set_updated_at();

create function public.discover_platform_billing_document_fulfillments_server(
  p_batch_size integer default 100
)
returns table(fulfillment_id uuid, activation_event_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_batch_size not between 1 and 250 then
    raise exception 'Fulfillment discovery batch size is invalid.' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select
      activation.id as activation_event_id,
      activation.tenant_id,
      activation.payment_order_id,
      attempt.id as payment_attempt_id,
      activation.new_assignment_id as subscription_assignment_id
    from public.tenant_plan_activation_events activation
    join public.tenant_payment_orders payment_order
      on payment_order.id = activation.payment_order_id
     and payment_order.tenant_id = activation.tenant_id
    join public.tenant_payment_attempts attempt
      on attempt.id::text = activation.metadata_json->>'captured_attempt_id'
     and attempt.payment_order_id = payment_order.id
     and attempt.tenant_id = payment_order.tenant_id
     and attempt.internal_status = 'captured'
     and coalesce(attempt.signature_valid, false) is true
     and attempt.captured_at is not null
     and attempt.provider_payment_id = activation.provider_payment_id
     and attempt.provider = payment_order.provider
     and attempt.provider_mode = payment_order.provider_mode
     and attempt.provider_order_id = payment_order.provider_order_id
     and attempt.amount_minor = payment_order.total_amount_minor
     and attempt.currency = payment_order.currency
     and exists (
       select 1
       from public.razorpay_webhook_events event
       where event.provider = payment_order.provider
         and event.provider_mode = payment_order.provider_mode
         and event.signature_valid
         and event.processing_status = 'processed'
         and event.event_type = 'payment.captured'
         and event.related_provider_order_id = payment_order.provider_order_id
         and event.related_provider_payment_id = attempt.provider_payment_id
     )
    where activation.activation_status in ('activated','skipped_already_active')
      and activation.activated_at is not null
      and activation.new_assignment_id is not null
      and activation.billing_period_start is not null
      and activation.billing_period_end is not null
      and activation.billing_period_start < activation.billing_period_end
      and payment_order.internal_status = 'activated'
      and not exists (
        select 1 from public.platform_billing_document_fulfillments existing
        where existing.activation_event_id = activation.id
           or existing.payment_order_id = payment_order.id
           or existing.payment_attempt_id = attempt.id
      )
    order by activation.activated_at, activation.id
    limit p_batch_size
  ), inserted_rows as (
    insert into public.platform_billing_document_fulfillments (
      tenant_id, activation_event_id, payment_order_id, payment_attempt_id,
      subscription_assignment_id
    )
    select tenant_id, activation_event_id, payment_order_id, payment_attempt_id,
      subscription_assignment_id
    from candidates
    on conflict do nothing
    returning id, platform_billing_document_fulfillments.activation_event_id
  )
  select inserted_rows.id, inserted_rows.activation_event_id, true
  from inserted_rows;
end;
$$;

create function public.claim_platform_billing_document_fulfillments_server(
  p_worker_id text,
  p_batch_size integer default 10,
  p_lease_seconds integer default 300
)
returns table(
  fulfillment_id uuid,
  activation_event_id uuid,
  payment_order_id uuid,
  payment_attempt_id uuid,
  subscription_assignment_id uuid,
  invoice_id uuid,
  receipt_id uuid,
  attempt_number integer,
  claim_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.platform_billing_document_fulfillments%rowtype;
  v_token uuid;
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 100 then
    raise exception 'Fulfillment worker identity is invalid.' using errcode = '22023';
  end if;
  if p_batch_size not between 1 and 25 or p_lease_seconds not between 30 and 900 then
    raise exception 'Fulfillment claim bounds are invalid.' using errcode = '22023';
  end if;

  with expired as (
    select fulfillment.id
    from public.platform_billing_document_fulfillments fulfillment
    where fulfillment.status = 'processing' and fulfillment.lease_expires_at <= now()
    order by fulfillment.lease_expires_at, fulfillment.id
    for update skip locked
    limit p_batch_size
  )
  update public.platform_billing_document_fulfillments fulfillment
  set status = case when attempt_count >= 5 then 'manual_review' else 'retryable' end,
      next_attempt_at = now(),
      last_error_class = case when attempt_count >= 5 then 'permanent' else 'transient' end,
      last_error_code = 'claim_lease_expired',
      last_error_at = now(),
      claim_token = null,
      claim_owner = null,
      claimed_at = null,
      lease_expires_at = null
  from expired
  where fulfillment.id = expired.id;

  for v_row in
    select fulfillment.*
    from public.platform_billing_document_fulfillments fulfillment
    where fulfillment.status in ('pending','retryable')
      and fulfillment.next_attempt_at <= now()
      and fulfillment.attempt_count < 5
    order by fulfillment.next_attempt_at, fulfillment.created_at, fulfillment.id
    for update skip locked
    limit p_batch_size
  loop
    v_token := gen_random_uuid();

    update public.platform_billing_document_fulfillments fulfillment
    set status = 'processing',
        attempt_count = fulfillment.attempt_count + 1,
        claim_token = v_token,
        claim_owner = btrim(p_worker_id),
        claimed_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        last_error_code = null,
        last_error_class = null,
        last_error_at = null
    where fulfillment.id = v_row.id
    returning * into v_row;

    return query select
      v_row.id, v_row.activation_event_id, v_row.payment_order_id,
      v_row.payment_attempt_id, v_row.subscription_assignment_id,
      v_row.invoice_id, v_row.receipt_id, v_row.attempt_count,
      v_token, v_row.lease_expires_at;
  end loop;
end;
$$;

create function public.resume_platform_billing_document_fulfillment_server(
  p_fulfillment_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fulfillment public.platform_billing_document_fulfillments%rowtype;
  v_activation public.tenant_plan_activation_events%rowtype;
  v_order public.tenant_payment_orders%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_assignment public.tenant_subscription_assignments%rowtype;
  v_invoice public.invoices%rowtype;
  v_receipt public.platform_billing_receipts%rowtype;
begin
  if p_fulfillment_id is null then
    raise exception 'Fulfillment is required for prerequisite recovery.' using errcode = '22023';
  end if;

  select * into v_fulfillment
  from public.platform_billing_document_fulfillments
  where id = p_fulfillment_id
  for update;

  if v_fulfillment.id is null then
    raise exception 'Fulfillment was not found.' using errcode = '22023';
  end if;
  if v_fulfillment.status in ('retryable','completed') then
    return v_fulfillment.status;
  end if;
  if v_fulfillment.status <> 'blocked_prerequisite' then
    raise exception 'Only blocked prerequisite fulfillment can be resumed.' using errcode = '22023';
  end if;
  if v_fulfillment.attempt_count >= 5 then
    raise exception 'Fulfillment requires manual review after the retry limit.' using errcode = '22023';
  end if;

  select * into v_activation
  from public.tenant_plan_activation_events
  where id = v_fulfillment.activation_event_id;
  select * into v_order
  from public.tenant_payment_orders
  where id = v_fulfillment.payment_order_id;
  select * into v_attempt
  from public.tenant_payment_attempts
  where id = v_fulfillment.payment_attempt_id;
  select * into v_assignment
  from public.tenant_subscription_assignments
  where id = v_fulfillment.subscription_assignment_id;

  if v_activation.id is null
     or v_activation.activation_status not in ('activated','skipped_already_active')
     or v_activation.tenant_id <> v_fulfillment.tenant_id
     or v_activation.payment_order_id <> v_order.id
     or v_activation.new_assignment_id <> v_assignment.id
     or v_activation.billing_period_start is null
     or v_activation.billing_period_end is null
     or v_activation.billing_period_start >= v_activation.billing_period_end
     or v_order.id is null or v_order.tenant_id <> v_fulfillment.tenant_id
     or v_order.internal_status <> 'activated'
     or v_order.plan_id <> v_activation.plan_id
     or v_order.price_id <> v_activation.price_id
     or v_attempt.id is null or v_attempt.tenant_id <> v_fulfillment.tenant_id
     or v_attempt.payment_order_id <> v_order.id
     or v_attempt.internal_status <> 'captured'
     or coalesce(v_attempt.signature_valid, false) is not true
     or v_attempt.captured_at is null
     or v_attempt.provider_payment_id is distinct from v_activation.provider_payment_id
     or v_attempt.provider <> v_order.provider
     or v_attempt.provider_mode <> v_order.provider_mode
     or v_attempt.provider_order_id is distinct from v_order.provider_order_id
     or v_attempt.amount_minor is distinct from v_order.total_amount_minor
     or v_attempt.currency is distinct from v_order.currency
     or v_assignment.id is null or v_assignment.tenant_id <> v_fulfillment.tenant_id
     or v_assignment.plan_id <> v_activation.plan_id
     or not exists (
       select 1
       from public.razorpay_webhook_events event
       where event.provider = v_order.provider
         and event.provider_mode = v_order.provider_mode
         and event.signature_valid
         and event.processing_status = 'processed'
         and event.event_type = 'payment.captured'
         and event.related_provider_order_id = v_order.provider_order_id
         and event.related_provider_payment_id = v_attempt.provider_payment_id
     ) then
    raise exception 'Verified fulfillment authority is not safe to resume.' using errcode = '22023';
  end if;

  if v_fulfillment.invoice_id is not null then
    select * into v_invoice from public.invoices where id = v_fulfillment.invoice_id;
    if v_invoice.id is null
       or v_invoice.tenant_id <> v_fulfillment.tenant_id
       or v_invoice.subscription_assignment_id <> v_fulfillment.subscription_assignment_id
       or v_invoice.plan_id <> v_activation.plan_id
       or v_invoice.price_id <> v_activation.price_id
       or v_invoice.source_key <> 'invoice:activation:' || v_activation.id::text
       or v_invoice.issued_at is distinct from v_activation.activated_at
       or v_invoice.paid_at is distinct from v_attempt.captured_at
       or v_invoice.period_start is distinct from v_activation.billing_period_start
       or v_invoice.period_end is distinct from v_activation.billing_period_end then
      raise exception 'Persisted invoice authority is not safe to resume.' using errcode = '22023';
    end if;
  end if;

  if v_fulfillment.receipt_id is not null then
    select * into v_receipt from public.platform_billing_receipts where id = v_fulfillment.receipt_id;
    if v_fulfillment.invoice_id is null
       or v_receipt.id is null
       or v_receipt.invoice_id <> v_fulfillment.invoice_id
       or v_receipt.tenant_id <> v_fulfillment.tenant_id
       or v_receipt.activation_event_id <> v_activation.id
       or v_receipt.payment_order_id <> v_order.id
       or v_receipt.payment_attempt_id <> v_attempt.id
       or v_receipt.source_key <> 'receipt:payment_attempt:' || v_attempt.id::text
       or v_receipt.amount_minor <> v_order.total_amount_minor
       or v_receipt.currency <> v_order.currency
       or v_receipt.issued_at is distinct from v_attempt.captured_at then
      raise exception 'Persisted receipt authority is not safe to resume.' using errcode = '22023';
    end if;
  end if;

  update public.platform_billing_document_fulfillments
  set status = 'retryable',
      next_attempt_at = now(),
      claim_token = null,
      claim_owner = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error_code = null,
      last_error_class = null,
      last_error_at = null
  where id = v_fulfillment.id;

  return 'retryable';
end;
$$;

create function public.issue_platform_invoice_for_activation_server(
  p_activation_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activation public.tenant_plan_activation_events%rowtype;
  v_order public.tenant_payment_orders%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_assignment public.tenant_subscription_assignments%rowtype;
  v_existing public.invoices%rowtype;
  v_invoice_id uuid;
  v_source_key text;
  v_invoice_number text;
  v_plan_name text;
  v_base_tax_minor bigint;
  v_setup_tax_minor bigint;
begin
  if p_activation_event_id is null then
    raise exception 'Activation event is required for invoice issuance.' using errcode = '22023';
  end if;

  v_source_key := 'invoice:activation:' || p_activation_event_id::text;
  perform pg_advisory_xact_lock(hashtextextended('ux8f1:' || v_source_key, 81));

  select * into v_activation
  from public.tenant_plan_activation_events
  where id = p_activation_event_id;

  select * into v_existing from public.invoices where source_key = v_source_key;
  if v_existing.id is not null then
    if v_activation.id is not null
       and v_existing.subscription_assignment_id = v_activation.new_assignment_id
       and v_existing.plan_id = v_activation.plan_id
       and v_existing.price_id = v_activation.price_id
       and v_existing.period_start is not distinct from v_activation.billing_period_start
       and v_existing.period_end is not distinct from v_activation.billing_period_end then
      return v_existing.id;
    end if;
    raise exception 'Invoice source key conflicts with existing authority.' using errcode = '23505';
  end if;

  select * into v_order
  from public.tenant_payment_orders
  where id = v_activation.payment_order_id;
  select * into v_attempt
  from public.tenant_payment_attempts
  where id::text = v_activation.metadata_json->>'captured_attempt_id';
  select * into v_assignment
  from public.tenant_subscription_assignments
  where id = v_activation.new_assignment_id;

  if v_activation.id is null
     or v_activation.activation_status not in ('activated','skipped_already_active')
     or v_activation.activated_at is null
     or v_order.id is null or v_order.internal_status <> 'activated'
     or v_attempt.id is null or v_attempt.internal_status <> 'captured'
     or coalesce(v_attempt.signature_valid, false) is not true
     or v_attempt.captured_at is null
     or v_assignment.id is null
     or v_activation.tenant_id <> v_order.tenant_id
     or v_activation.tenant_id <> v_attempt.tenant_id
     or v_activation.tenant_id <> v_assignment.tenant_id
     or v_attempt.payment_order_id <> v_order.id
     or v_attempt.provider <> v_order.provider
     or v_attempt.provider_mode <> v_order.provider_mode
     or v_attempt.provider_order_id is distinct from v_order.provider_order_id
     or v_attempt.provider_payment_id is distinct from v_activation.provider_payment_id
     or v_attempt.amount_minor is distinct from v_order.total_amount_minor
     or v_attempt.currency is distinct from v_order.currency
     or v_assignment.plan_id <> v_activation.plan_id
     or v_order.plan_id <> v_activation.plan_id
     or v_order.price_id <> v_activation.price_id
     or v_activation.billing_period_start is null
     or v_activation.billing_period_end is null
     or v_activation.billing_period_start >= v_activation.billing_period_end
     or not exists (
       select 1
       from public.razorpay_webhook_events event
       where event.provider = v_order.provider
         and event.provider_mode = v_order.provider_mode
         and event.signature_valid
         and event.processing_status = 'processed'
         and event.event_type = 'payment.captured'
         and event.related_provider_order_id = v_order.provider_order_id
         and event.related_provider_payment_id = v_attempt.provider_payment_id
     ) then
    raise exception 'Verified activation authority is incomplete for invoice issuance.' using errcode = '22023';
  end if;

  if v_order.billing_snapshot->>'preferred_currency' is distinct from v_order.currency
     or v_order.plan_snapshot->>'plan_id' is distinct from v_order.plan_id::text
     or v_order.plan_snapshot->>'price_id' is distinct from v_order.price_id::text
     or v_order.plan_snapshot->>'billing_cycle' is distinct from v_order.billing_cycle
     or v_order.plan_snapshot->>'currency' is distinct from v_order.currency
     or (v_order.plan_snapshot->>'amount_minor')::bigint is distinct from v_order.amount_minor
     or (v_order.plan_snapshot->>'setup_fee_amount_minor')::bigint is distinct from v_order.setup_fee_amount_minor
     or nullif(v_order.plan_snapshot->>'tax_amount_minor', '')::bigint is distinct from v_order.tax_amount_minor
     or v_order.plan_snapshot->>'tax_calculation_status' is distinct from v_order.tax_calculation_status
     or (v_order.plan_snapshot->>'total_amount_minor')::bigint is distinct from v_order.total_amount_minor
     or v_order.amount_minor + v_order.setup_fee_amount_minor + coalesce(v_order.tax_amount_minor, 0) <> v_order.total_amount_minor then
    raise exception 'Frozen commercial authority does not match the verified payment order.' using errcode = '22023';
  end if;

  v_plan_name := nullif(btrim(v_order.plan_snapshot->>'plan_name'), '');
  if v_plan_name is null then
    raise exception 'Frozen plan identity is incomplete.' using errcode = '22023';
  end if;

  v_base_tax_minor := case
    when v_order.tax_calculation_status = 'not_calculated' then null
    else coalesce(v_order.tax_amount_minor, 0)
  end;
  v_setup_tax_minor := case
    when v_order.tax_calculation_status = 'not_calculated' then null
    else 0
  end;
  v_invoice_number := coachfort_internal.next_platform_billing_document_number(
    'invoice', v_activation.activated_at
  );

  insert into public.invoices (
    tenant_id, subscription_id, invoice_number, status, subtotal, tax_amount,
    total_amount, currency, billing_name, billing_email, billing_address,
    gst_number, issued_at, due_at, paid_at, source_key,
    subscription_assignment_id, plan_id, price_id, billing_cycle, period_start,
    period_end, subtotal_minor, discount_amount_minor, tax_amount_minor,
    tax_calculation_status, total_amount_minor, billing_snapshot,
    issuer_snapshot, plan_snapshot
  ) values (
    v_order.tenant_id, null, v_invoice_number, 'issued',
    (v_order.amount_minor + v_order.setup_fee_amount_minor)::numeric / 100,
    coalesce(v_order.tax_amount_minor, 0)::numeric / 100,
    v_order.total_amount_minor::numeric / 100, v_order.currency,
    v_order.billing_snapshot->>'legal_name', v_order.billing_snapshot->>'billing_email',
    concat_ws(', ',
      v_order.billing_snapshot->>'address_line1',
      v_order.billing_snapshot->>'address_line2',
      v_order.billing_snapshot->>'city',
      v_order.billing_snapshot->>'state',
      v_order.billing_snapshot->>'postal_code',
      v_order.billing_snapshot->>'country'
    ),
    case when v_order.billing_snapshot->>'tax_registration_type' = 'GSTIN'
      then v_order.billing_snapshot->>'tax_id' else null end,
    v_activation.activated_at, null, v_attempt.captured_at, v_source_key,
    v_assignment.id, v_order.plan_id, v_order.price_id, v_order.billing_cycle,
    v_activation.billing_period_start, v_activation.billing_period_end,
    v_order.amount_minor + v_order.setup_fee_amount_minor, 0,
    v_order.tax_amount_minor, v_order.tax_calculation_status,
    v_order.total_amount_minor, v_order.billing_snapshot,
    v_order.issuer_snapshot, v_order.plan_snapshot
  ) returning id into v_invoice_id;

  insert into public.invoice_items (
    invoice_id, description, quantity, unit_price, tax_percent, line_total,
    billing_cycle, period_start, period_end, unit_amount_minor,
    discount_amount_minor, tax_amount_minor, tax_calculation_status,
    line_total_minor, item_snapshot
  ) values (
    v_invoice_id, v_plan_name || ' - ' || initcap(v_order.billing_cycle), 1,
    v_order.amount_minor::numeric / 100, 0,
    (v_order.amount_minor + coalesce(v_base_tax_minor, 0))::numeric / 100,
    v_order.billing_cycle, v_activation.billing_period_start,
    v_activation.billing_period_end, v_order.amount_minor, 0,
    v_base_tax_minor, v_order.tax_calculation_status,
    v_order.amount_minor + coalesce(v_base_tax_minor, 0),
    jsonb_build_object(
      'description', v_plan_name || ' - ' || initcap(v_order.billing_cycle),
      'billing_cycle', v_order.billing_cycle,
      'unit_amount_minor', v_order.amount_minor,
      'line_total_minor', v_order.amount_minor + coalesce(v_base_tax_minor, 0),
      'tax_calculation_status', v_order.tax_calculation_status,
      'plan_id', v_order.plan_id,
      'price_id', v_order.price_id
    )
  );

  if v_order.setup_fee_amount_minor > 0 then
    insert into public.invoice_items (
      invoice_id, description, quantity, unit_price, tax_percent, line_total,
      billing_cycle, period_start, period_end, unit_amount_minor,
      discount_amount_minor, tax_amount_minor, tax_calculation_status,
      line_total_minor, item_snapshot
    ) values (
      v_invoice_id, 'CoachFort setup fee', 1,
      v_order.setup_fee_amount_minor::numeric / 100, 0,
      (v_order.setup_fee_amount_minor + coalesce(v_setup_tax_minor, 0))::numeric / 100,
      v_order.billing_cycle, v_activation.billing_period_start,
      v_activation.billing_period_end, v_order.setup_fee_amount_minor, 0,
      v_setup_tax_minor, v_order.tax_calculation_status,
      v_order.setup_fee_amount_minor + coalesce(v_setup_tax_minor, 0),
      jsonb_build_object(
        'description', 'CoachFort setup fee',
        'billing_cycle', v_order.billing_cycle,
        'unit_amount_minor', v_order.setup_fee_amount_minor,
        'line_total_minor', v_order.setup_fee_amount_minor + coalesce(v_setup_tax_minor, 0),
        'tax_calculation_status', v_order.tax_calculation_status,
        'plan_id', v_order.plan_id,
        'price_id', v_order.price_id
      )
    );
  end if;

  return v_invoice_id;
end;
$$;

create function public.issue_platform_receipt_for_fulfillment_server(
  p_fulfillment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fulfillment public.platform_billing_document_fulfillments%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
begin
  if p_fulfillment_id is null then
    raise exception 'Fulfillment is required for receipt issuance.' using errcode = '22023';
  end if;

  select * into v_fulfillment
  from public.platform_billing_document_fulfillments
  where id = p_fulfillment_id;

  select * into v_attempt
  from public.tenant_payment_attempts
  where id = v_fulfillment.payment_attempt_id;

  if v_fulfillment.id is null or v_fulfillment.invoice_id is null
     or v_attempt.id is null
     or v_attempt.payment_order_id <> v_fulfillment.payment_order_id
     or v_attempt.tenant_id <> v_fulfillment.tenant_id
     or v_attempt.internal_status <> 'captured'
     or coalesce(v_attempt.signature_valid, false) is not true
     or v_attempt.captured_at is null then
    raise exception 'Verified fulfillment authority is incomplete for receipt issuance.' using errcode = '22023';
  end if;

  return public.issue_platform_payment_receipt(
    v_fulfillment.invoice_id,
    'receipt:payment_attempt:' || v_attempt.id::text,
    v_attempt.id,
    v_attempt.captured_at
  );
end;
$$;

create function public.finalize_platform_billing_document_fulfillment_server(
  p_fulfillment_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_invoice_id uuid default null,
  p_receipt_id uuid default null,
  p_error_class text default null,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fulfillment public.platform_billing_document_fulfillments%rowtype;
  v_invoice public.invoices%rowtype;
  v_receipt public.platform_billing_receipts%rowtype;
  v_activation public.tenant_plan_activation_events%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_status text;
  v_next_attempt_at timestamptz;
begin
  if p_fulfillment_id is null or p_claim_token is null
     or p_outcome not in ('invoice_issued','receipt_issued','completed','retryable','blocked_prerequisite','manual_review') then
    raise exception 'Fulfillment finalization input is invalid.' using errcode = '22023';
  end if;
  if p_error_class is not null and p_error_class not in ('configuration','transient','conflict','permanent') then
    raise exception 'Fulfillment error class is invalid.' using errcode = '22023';
  end if;
  if p_error_code is not null and (char_length(p_error_code) > 120 or p_error_code ~ '[<>]') then
    raise exception 'Fulfillment error code is invalid.' using errcode = '22023';
  end if;

  select * into v_fulfillment
  from public.platform_billing_document_fulfillments
  where id = p_fulfillment_id
  for update;

  if v_fulfillment.id is null or v_fulfillment.status <> 'processing'
     or v_fulfillment.claim_token <> p_claim_token
     or v_fulfillment.lease_expires_at <= now() then
    raise exception 'Fulfillment claim is missing or expired.' using errcode = '22023';
  end if;

  if p_invoice_id is not null then
    select * into v_invoice from public.invoices where id = p_invoice_id;
    select * into v_activation
    from public.tenant_plan_activation_events
    where id = v_fulfillment.activation_event_id;
    if v_invoice.id is null
       or v_activation.id is null
       or v_invoice.tenant_id <> v_fulfillment.tenant_id
       or v_invoice.subscription_assignment_id <> v_fulfillment.subscription_assignment_id
       or v_invoice.source_key <> 'invoice:activation:' || v_fulfillment.activation_event_id::text
       or v_invoice.issued_at is distinct from v_activation.activated_at
       or v_invoice.period_start is distinct from v_activation.billing_period_start
       or v_invoice.period_end is distinct from v_activation.billing_period_end then
      raise exception 'Invoice does not match fulfillment authority.' using errcode = '22023';
    end if;
  end if;

  if p_receipt_id is not null then
    select * into v_receipt from public.platform_billing_receipts where id = p_receipt_id;
    select * into v_attempt
    from public.tenant_payment_attempts
    where id = v_fulfillment.payment_attempt_id;
    if v_receipt.id is null
       or v_attempt.id is null
       or v_receipt.tenant_id <> v_fulfillment.tenant_id
       or v_receipt.activation_event_id <> v_fulfillment.activation_event_id
       or v_receipt.payment_order_id <> v_fulfillment.payment_order_id
       or v_receipt.payment_attempt_id <> v_fulfillment.payment_attempt_id
       or v_receipt.source_key <> 'receipt:payment_attempt:' || v_fulfillment.payment_attempt_id::text
       or v_receipt.invoice_id <> coalesce(p_invoice_id, v_fulfillment.invoice_id)
       or v_receipt.issued_at is distinct from v_attempt.captured_at then
      raise exception 'Receipt does not match fulfillment authority.' using errcode = '22023';
    end if;
  end if;

  if p_outcome = 'invoice_issued' then
    if p_invoice_id is null then
      raise exception 'Invoice id is required.' using errcode = '22023';
    end if;
    update public.platform_billing_document_fulfillments
    set invoice_id = p_invoice_id
    where id = v_fulfillment.id;
    return 'processing';
  end if;

  if p_outcome in ('receipt_issued','completed') then
    if coalesce(p_invoice_id, v_fulfillment.invoice_id) is null or p_receipt_id is null then
      raise exception 'Invoice and receipt ids are required for completion.' using errcode = '22023';
    end if;
    update public.platform_billing_document_fulfillments
    set invoice_id = coalesce(p_invoice_id, invoice_id),
        receipt_id = p_receipt_id,
        status = 'completed',
        completed_at = now(),
        claim_token = null, claim_owner = null, claimed_at = null, lease_expires_at = null,
        last_error_code = null, last_error_class = null, last_error_at = null
    where id = v_fulfillment.id;
    return 'completed';
  end if;

  if p_outcome in ('retryable','blocked_prerequisite') and v_fulfillment.attempt_count >= 5 then
    v_status := 'manual_review';
    v_next_attempt_at := v_fulfillment.next_attempt_at;
  elsif p_outcome = 'retryable' then
    v_status := 'retryable';
    v_next_attempt_at := now() + case v_fulfillment.attempt_count
      when 1 then interval '1 minute'
      when 2 then interval '5 minutes'
      when 3 then interval '30 minutes'
      else interval '2 hours'
    end;
  else
    v_status := p_outcome;
    v_next_attempt_at := v_fulfillment.next_attempt_at;
  end if;

  update public.platform_billing_document_fulfillments
  set invoice_id = coalesce(p_invoice_id, invoice_id),
      receipt_id = coalesce(p_receipt_id, receipt_id),
      status = v_status,
      next_attempt_at = v_next_attempt_at,
      last_error_class = p_error_class,
      last_error_code = p_error_code,
      last_error_at = case when p_error_class is null and p_error_code is null then null else now() end,
      claim_token = null, claim_owner = null, claimed_at = null, lease_expires_at = null
  where id = v_fulfillment.id;

  return v_status;
end;
$$;

alter table public.platform_billing_document_fulfillments enable row level security;

alter table public.platform_billing_document_fulfillments owner to postgres;
alter function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability() owner to postgres;
alter function coachfort_internal.enforce_captured_attempt_activation_authority() owner to postgres;
alter function public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.discover_platform_billing_document_fulfillments_server(integer) owner to postgres;
alter function public.claim_platform_billing_document_fulfillments_server(text,integer,integer) owner to postgres;
alter function public.resume_platform_billing_document_fulfillment_server(uuid) owner to postgres;
alter function public.issue_platform_invoice_for_activation_server(uuid) owner to postgres;
alter function public.issue_platform_receipt_for_fulfillment_server(uuid) owner to postgres;
alter function public.finalize_platform_billing_document_fulfillment_server(uuid,uuid,text,uuid,uuid,text,text) owner to postgres;

revoke all on table public.platform_billing_document_fulfillments from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_payment_order_commercial_snapshot_immutability() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_captured_attempt_activation_authority() from public, anon, authenticated, service_role;
revoke all on function public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.discover_platform_billing_document_fulfillments_server(integer) from public, anon, authenticated, service_role;
revoke all on function public.claim_platform_billing_document_fulfillments_server(text,integer,integer) from public, anon, authenticated, service_role;
revoke all on function public.resume_platform_billing_document_fulfillment_server(uuid) from public, anon, authenticated, service_role;
revoke all on function public.issue_platform_invoice_for_activation_server(uuid) from public, anon, authenticated, service_role;
revoke all on function public.issue_platform_receipt_for_fulfillment_server(uuid) from public, anon, authenticated, service_role;
revoke all on function public.finalize_platform_billing_document_fulfillment_server(uuid,uuid,text,uuid,uuid,text,text) from public, anon, authenticated, service_role;

grant execute on function public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.discover_platform_billing_document_fulfillments_server(integer) to service_role;
grant execute on function public.claim_platform_billing_document_fulfillments_server(text,integer,integer) to service_role;
grant execute on function public.resume_platform_billing_document_fulfillment_server(uuid) to service_role;
grant execute on function public.issue_platform_invoice_for_activation_server(uuid) to service_role;
grant execute on function public.issue_platform_receipt_for_fulfillment_server(uuid) to service_role;
grant execute on function public.finalize_platform_billing_document_fulfillment_server(uuid,uuid,text,uuid,uuid,text,text) to service_role;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with expected_functions(identity, service_execute_expected) as (
  values
    ('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)', true),
    ('public.discover_platform_billing_document_fulfillments_server(integer)', true),
    ('public.claim_platform_billing_document_fulfillments_server(text,integer,integer)', true),
    ('public.resume_platform_billing_document_fulfillment_server(uuid)', true),
    ('public.issue_platform_invoice_for_activation_server(uuid)', true),
    ('public.issue_platform_receipt_for_fulfillment_server(uuid)', true),
    ('public.finalize_platform_billing_document_fulfillment_server(uuid,uuid,text,uuid,uuid,text,text)', true),
    ('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()', false),
    ('coachfort_internal.enforce_captured_attempt_activation_authority()', false)
), function_state as (
  select ef.identity, ef.service_execute_expected, p.oid is not null as installed,
    case when p.oid is null then null else pg_get_userbyid(p.proowner) end as owner,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_execute,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_execute,
    coalesce(has_function_privilege('service_role', p.oid, 'EXECUTE'), false) as service_execute,
    coalesce((
      select bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    ), false) as public_execute
  from expected_functions ef
  left join pg_catalog.pg_proc p on p.oid = to_regprocedure(ef.identity)
), function_overload_state as (
  select count(*) as value
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (
    ('public','create_platform_payment_order_authority_server'),
    ('public','discover_platform_billing_document_fulfillments_server'),
    ('public','claim_platform_billing_document_fulfillments_server'),
    ('public','resume_platform_billing_document_fulfillment_server'),
    ('public','issue_platform_invoice_for_activation_server'),
    ('public','issue_platform_receipt_for_fulfillment_server'),
    ('public','finalize_platform_billing_document_fulfillment_server'),
    ('coachfort_internal','enforce_payment_order_commercial_snapshot_immutability'),
    ('coachfort_internal','enforce_captured_attempt_activation_authority')
  )
), object_state as (
  select jsonb_build_object(
    'fulfillment_table', to_regclass('public.platform_billing_document_fulfillments') is not null,
    'table_owner', (
      select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c
      where c.oid = to_regclass('public.platform_billing_document_fulfillments')
    ),
    'rls_enabled', (
      select c.relrowsecurity from pg_catalog.pg_class c
      where c.oid = to_regclass('public.platform_billing_document_fulfillments')
    ),
    'force_rls', (
      select c.relforcerowsecurity from pg_catalog.pg_class c
      where c.oid = to_regclass('public.platform_billing_document_fulfillments')
    ),
    'snapshot_columns', (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name in ('billing_snapshot','issuer_snapshot','plan_snapshot','tax_calculation_status')
    ),
    'nullable_snapshot_columns', (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name in ('billing_snapshot','issuer_snapshot','plan_snapshot','tax_calculation_status')
        and is_nullable = 'YES'
    ),
    'activation_period_columns', (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
        and column_name in ('billing_period_start','billing_period_end')
        and is_nullable = 'YES'
    ),
    'fulfillment_rows', (select count(*) from public.platform_billing_document_fulfillments),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'platform_invoices', (select count(*) from public.invoices),
    'platform_receipts', (select count(*) from public.platform_billing_receipts),
    'issuer_profiles', (select count(*) from public.platform_billing_issuer_profiles)
  ) as value
), constraint_state as (
  select jsonb_build_object(
    'activation_unique', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.platform_billing_document_fulfillments') and conname = 'platform_billing_document_fulfillments_activation_key' and contype = 'u'),
    'payment_order_unique', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.platform_billing_document_fulfillments') and conname = 'platform_billing_document_fulfillments_order_key' and contype = 'u'),
    'payment_attempt_unique', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.platform_billing_document_fulfillments') and conname = 'platform_billing_document_fulfillments_attempt_key' and contype = 'u'),
    'invoice_unique', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.platform_billing_document_fulfillments') and conname = 'platform_billing_document_fulfillments_invoice_key' and contype = 'u'),
    'receipt_unique', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.platform_billing_document_fulfillments') and conname = 'platform_billing_document_fulfillments_receipt_key' and contype = 'u'),
    'snapshot_presence', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.tenant_payment_orders') and conname = 'tenant_payment_orders_snapshot_presence_check' and contype = 'c'),
    'commercial_total', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.tenant_payment_orders') and conname = 'tenant_payment_orders_commercial_total_check' and contype = 'c'),
    'snapshot_shape', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.tenant_payment_orders') and conname = 'tenant_payment_orders_frozen_snapshot_shape_check' and contype = 'c'),
    'snapshot_size', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.tenant_payment_orders') and conname = 'tenant_payment_orders_frozen_snapshot_size_check' and contype = 'c'),
    'activation_period', exists(select 1 from pg_catalog.pg_constraint where conrelid = to_regclass('public.tenant_plan_activation_events') and conname = 'tenant_plan_activation_events_billing_period_check' and contype = 'c'),
    'snapshot_immutability_trigger', exists(select 1 from pg_catalog.pg_trigger where tgrelid = to_regclass('public.tenant_payment_orders') and tgname = 'enforce_payment_order_commercial_snapshot_immutability' and not tgisinternal and tgenabled <> 'D'),
    'activation_authority_trigger', exists(
      select 1
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_proc function_row on function_row.oid = trigger_row.tgfoid
      join pg_catalog.pg_namespace function_schema on function_schema.oid = function_row.pronamespace
      where trigger_row.tgrelid = to_regclass('public.tenant_plan_activation_events')
        and trigger_row.tgname = 'enforce_captured_attempt_activation_authority'
        and not trigger_row.tgisinternal and trigger_row.tgenabled <> 'D'
        and function_schema.nspname = 'coachfort_internal'
        and function_row.proname = 'enforce_captured_attempt_activation_authority'
        and pg_get_triggerdef(trigger_row.oid) ilike '%UPDATE OF activation_status%'
        and pg_get_triggerdef(trigger_row.oid) ilike '%activated_at%'
        and pg_get_triggerdef(trigger_row.oid) ilike '%provider_order_id%'
        and pg_get_triggerdef(trigger_row.oid) ilike '%provider_payment_id%'
    )
  ) as value
), browser_grants as (
  select jsonb_build_object(
    'direct', count(*),
    'writes', count(*) filter (where privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')),
    'dangerous', count(*) filter (where privilege_type in ('REFERENCES','TRIGGER','TRUNCATE','MAINTAIN'))
  ) as value
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'platform_billing_document_fulfillments'
    and grantee in ('PUBLIC','anon','authenticated','service_role')
), legacy_payment_grants as (
  select count(*) as direct
  from information_schema.table_privileges
  where table_schema = 'public' and table_name = 'payment_transactions'
    and grantee in ('PUBLIC','anon','authenticated','service_role')
), payment_order_browser_writes as (
  select count(*) as value
  from information_schema.table_privileges
  where table_schema = 'public' and table_name = 'tenant_payment_orders'
    and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
), student_finance_state as (
  select jsonb_build_object(
    'tables_present', to_regclass('public.finance_invoices') is not null
      and to_regclass('public.finance_payments') is not null
      and to_regclass('public.finance_receipts') is not null
      and to_regclass('public.finance_adjustments') is not null,
    'invoice_rows', (select count(*) from public.finance_invoices),
    'payment_rows', (select count(*) from public.finance_payments),
    'receipt_rows', (select count(*) from public.finance_receipts),
    'adjustment_rows', (select count(*) from public.finance_adjustments)
  ) as value
), source_state as (
  select jsonb_build_object(
    'new_authority_snapshots_complete', authority_source like '%tax_calculation_status, total_amount_minor%'
      and authority_source like '%checkout_enabled_source, metadata_json, billing_snapshot, issuer_snapshot, plan_snapshot, expires_at%'
      and authority_source like '%v_tax_calculation_status, v_total_amount_minor%'
      and authority_source like '%v_billing_snapshot, v_issuer_snapshot, v_plan_snapshot%',
    'captured_attempt_required', activation_source like '%attempt.internal_status = ''captured''%'
      and activation_source like '%event.event_type = ''payment.captured''%'
      and activation_source like '%attempt.amount_minor is not distinct from v_order.total_amount_minor%',
    'snapshot_immutable', snapshot_source like '%commercial authority is immutable%',
    'activation_period_frozen', activation_source like '%where assignment.id = new.new_assignment_id%'
      and activation_source like '%new.billing_period_start := v_assignment.current_period_start%'
      and activation_source like '%new.billing_period_end := v_assignment.current_period_end%'
      and activation_source like '%successful activation authority is immutable%',
    'successful_activation_authority_immutable', activation_source like '%old.activation_status in (''activated'',''skipped_already_active'')%'
      and activation_source like '%new.activated_at is distinct from old.activated_at%'
      and activation_source like '%new.provider_order_id is distinct from old.provider_order_id%'
      and activation_source like '%new.provider_payment_id is distinct from old.provider_payment_id%'
      and activation_source like '%new.billing_period_start is distinct from old.billing_period_start%'
      and activation_source like '%new.billing_period_end is distinct from old.billing_period_end%',
    'discovery_idempotent', discovery_source like '%on conflict do nothing%',
    'discovery_signed_webhook', discovery_source like '%event.processing_status = ''processed''%'
      and discovery_source like '%event.event_type = ''payment.captured''%',
    'claim_skip_locked', claim_source like '%for update skip locked%',
    'finite_lease', claim_source like '%p_lease_seconds not between 30 and 900%'
      and claim_source like '%lease_expires_at <= now()%',
    'bounded_claim', claim_source like '%p_batch_size not between 1 and 25%',
    'blocked_recovery_narrow', recovery_source like '%only blocked prerequisite fulfillment can be resumed%'
      and recovery_source like '%status = ''retryable''%'
      and recovery_source like '%next_attempt_at = now()%'
      and recovery_source like '%persisted invoice authority is not safe to resume%'
      and recovery_source not like '%update public.tenant_payment_orders%'
      and recovery_source not like '%update public.tenant_payment_attempts%'
      and recovery_source not like '%update public.tenant_plan_activation_events%'
      and recovery_source not like '%update public.tenant_subscription_assignments%'
      and recovery_source not like '%invoice_id = null%'
      and recovery_source not like '%receipt_id = null%',
    'blocked_retry_ceiling', finalize_source like '%p_outcome in (''retryable'',''blocked_prerequisite'') and v_fulfillment.attempt_count >= 5%'
      and finalize_source like '%v_status := ''manual_review''%',
    'partial_completion', finalize_source like '%p_outcome = ''invoice_issued''%'
      and finalize_source like '%return ''processing''%'
      and finalize_source like '%p_outcome in (''receipt_issued'',''completed'')%',
    'deterministic_invoice_key', invoice_source like '%invoice:activation:%',
    'invoice_uses_frozen_activation_period', invoice_source like '%v_activation.billing_period_start%'
      and invoice_source like '%v_activation.billing_period_end%'
      and invoice_source not like '%v_assignment.current_period_start%'
      and invoice_source not like '%v_assignment.current_period_end%',
    'invoice_signed_webhook', invoice_source like '%event.processing_status = ''processed''%'
      and invoice_source like '%event.event_type = ''payment.captured''%',
    'deterministic_receipt_key', receipt_source like '%receipt:payment_attempt:%',
    'receipt_uses_captured_at', receipt_source like '%v_attempt.captured_at%'
  ) as value
  from (
    select
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)')), '[[:space:]]+', ' ', 'g')) as authority_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.enforce_captured_attempt_activation_authority()')), '[[:space:]]+', ' ', 'g')) as activation_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('coachfort_internal.enforce_payment_order_commercial_snapshot_immutability()')), '[[:space:]]+', ' ', 'g')) as snapshot_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.discover_platform_billing_document_fulfillments_server(integer)')), '[[:space:]]+', ' ', 'g')) as discovery_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.claim_platform_billing_document_fulfillments_server(text,integer,integer)')), '[[:space:]]+', ' ', 'g')) as claim_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.resume_platform_billing_document_fulfillment_server(uuid)')), '[[:space:]]+', ' ', 'g')) as recovery_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.finalize_platform_billing_document_fulfillment_server(uuid,uuid,text,uuid,uuid,text,text)')), '[[:space:]]+', ' ', 'g')) as finalize_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.issue_platform_invoice_for_activation_server(uuid)')), '[[:space:]]+', ' ', 'g')) as invoice_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure('public.issue_platform_receipt_for_fulfillment_server(uuid)')), '[[:space:]]+', ' ', 'g')) as receipt_source
  ) definitions
), gates as (
  select
    (select bool_and(installed and owner = 'postgres' and security_definer
      and 'search_path=public, pg_temp' = any(configuration)
      and not public_execute and not anon_execute and not authenticated_execute
      and service_execute = service_execute_expected)
      from function_state) as functions_secure,
    (select value = 9 from function_overload_state) as overloads_exact,
    to_regclass('public.platform_billing_document_fulfillments') is not null
      and (select pg_get_userbyid(relowner) = 'postgres' and relrowsecurity and not relforcerowsecurity
        from pg_catalog.pg_class where oid = to_regclass('public.platform_billing_document_fulfillments')) as table_secure,
    (select relrowsecurity and not relforcerowsecurity
      from pg_catalog.pg_class where oid = to_regclass('public.tenant_payment_orders')) as payment_orders_rls_safe,
    (select (value->>'direct')::integer = 0 from browser_grants) as direct_grants_closed,
    (select value = 0 from payment_order_browser_writes) as payment_order_browser_writes_closed,
    (select direct = 0 from legacy_payment_grants) as legacy_payment_closed,
    (select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_payment_orders'
        and column_name in ('billing_snapshot','issuer_snapshot','plan_snapshot','tax_calculation_status')
        and is_nullable = 'YES')
      and exists (
        select 1 from pg_catalog.pg_constraint
        where conrelid = to_regclass('public.tenant_payment_orders')
          and conname = 'tenant_payment_orders_snapshot_presence_check' and contype = 'c'
      ) as snapshots_ready,
    (select count(*) = 2 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_plan_activation_events'
        and column_name in ('billing_period_start','billing_period_end')
        and is_nullable = 'YES')
      and exists (
        select 1 from pg_catalog.pg_constraint
        where conrelid = to_regclass('public.tenant_plan_activation_events')
          and conname = 'tenant_plan_activation_events_billing_period_check' and contype = 'c'
      ) as activation_period_ready,
    (select count(*) = 0 from public.platform_billing_document_fulfillments) as no_fulfillments_created,
    (select count(*) = 0 from public.tenant_payment_orders) as payment_orders_unchanged,
    (select count(*) = 0 from public.tenant_payment_attempts) as payment_attempts_unchanged,
    (select count(*) = 0 from public.tenant_plan_activation_events) as activations_unchanged,
    (select count(*) = 0 from public.invoices) as invoices_unchanged,
    (select count(*) = 0 from public.platform_billing_receipts) as receipts_unchanged,
    (select value @> '{
      "activation_unique": true,
      "payment_order_unique": true,
      "payment_attempt_unique": true,
      "invoice_unique": true,
      "receipt_unique": true,
      "snapshot_presence": true,
      "commercial_total": true,
      "snapshot_shape": true,
      "snapshot_size": true,
      "activation_period": true,
      "snapshot_immutability_trigger": true,
      "activation_authority_trigger": true
    }'::jsonb from constraint_state) as constraints_secure,
    (select value @> '{
      "new_authority_snapshots_complete": true,
      "captured_attempt_required": true,
      "snapshot_immutable": true,
      "activation_period_frozen": true,
      "successful_activation_authority_immutable": true,
      "discovery_idempotent": true,
      "discovery_signed_webhook": true,
      "claim_skip_locked": true,
      "finite_lease": true,
      "bounded_claim": true,
      "blocked_recovery_narrow": true,
      "blocked_retry_ceiling": true,
      "partial_completion": true,
      "deterministic_invoice_key": true,
      "invoice_uses_frozen_activation_period": true,
      "invoice_signed_webhook": true,
      "deterministic_receipt_key": true,
      "receipt_uses_captured_at": true
    }'::jsonb from source_state) as source_contract_secure,
    to_regclass('public.finance_invoices') is not null
      and to_regclass('public.finance_payments') is not null
      and to_regclass('public.finance_receipts') is not null
      and to_regclass('public.finance_adjustments') is not null as student_finance_preserved,
    not exists (
      select 1
      from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
      where btrim(exposed.schema_name) = 'coachfort_internal'
    ) as internal_schema_safe
)
select jsonb_build_object(
  'security_gate', coalesce(functions_secure and overloads_exact and table_secure
    and payment_orders_rls_safe and direct_grants_closed and payment_order_browser_writes_closed
    and legacy_payment_closed and snapshots_ready and activation_period_ready and constraints_secure
    and source_contract_secure and no_fulfillments_created
    and payment_orders_unchanged and payment_attempts_unchanged and activations_unchanged
    and invoices_unchanged and receipts_unchanged and student_finance_preserved
    and internal_schema_safe, false),
  'functions', (select jsonb_agg(to_jsonb(function_state) order by identity) from function_state),
  'objects', (select value from object_state),
  'constraints', (select value from constraint_state),
  'browser_grants', (select value from browser_grants),
  'payment_order_browser_writes', (select value from payment_order_browser_writes),
  'legacy_payment_grants', (select to_jsonb(legacy_payment_grants) from legacy_payment_grants),
  'student_finance', (select value from student_finance_state),
  'source_contract', (select value from source_state),
  'internal_schema_exposed', not internal_schema_safe
)
from gates;
*/
