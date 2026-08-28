-- Bundle UX-8E: CoachFort platform invoice and payment-receipt foundation.
-- Review before execution. This migration creates no billing documents, calls no
-- payment provider, sends no email, and does not change subscription state.

/*
PRE-APPLY READ-ONLY VERIFICATION

with expected_tables(table_name) as (
  values
    ('invoices'),
    ('invoice_items'),
    ('payment_transactions'),
    ('subscriptions'),
    ('tenant_billing_profiles'),
    ('subscription_plans'),
    ('subscription_plan_prices'),
    ('tenant_subscription_assignments'),
    ('tenant_payment_orders'),
    ('tenant_payment_attempts'),
    ('tenant_plan_activation_events'),
    ('finance_invoices'),
    ('finance_payments'),
    ('finance_receipts')
), table_state as (
  select
    e.table_name,
    to_regclass(format('public.%I', e.table_name)) is not null as installed,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    pg_get_userbyid(c.relowner) as table_owner
  from expected_tables e
  left join pg_class c on c.oid = to_regclass(format('public.%I', e.table_name))
), legacy_expected_columns(table_name, column_name, formatted_type, not_null, default_expr) as (
  values
    ('invoices','id','uuid',true,'gen_random_uuid()'),
    ('invoices','tenant_id','uuid',true,null),
    ('invoices','subscription_id','uuid',false,null),
    ('invoices','invoice_number','text',true,null),
    ('invoices','status','text',true,'''draft''::text'),
    ('invoices','subtotal','numeric(12,2)',true,'0'),
    ('invoices','tax_amount','numeric(12,2)',true,'0'),
    ('invoices','total_amount','numeric(12,2)',true,'0'),
    ('invoices','currency','text',true,'''INR''::text'),
    ('invoices','billing_name','text',false,null),
    ('invoices','billing_email','text',false,null),
    ('invoices','billing_address','text',false,null),
    ('invoices','gst_number','text',false,null),
    ('invoices','issued_at','timestamp with time zone',false,null),
    ('invoices','due_at','timestamp with time zone',false,null),
    ('invoices','paid_at','timestamp with time zone',false,null),
    ('invoices','created_at','timestamp with time zone',true,'now()'),
    ('invoice_items','id','uuid',true,'gen_random_uuid()'),
    ('invoice_items','invoice_id','uuid',true,null),
    ('invoice_items','description','text',true,null),
    ('invoice_items','quantity','numeric(12,2)',true,'1'),
    ('invoice_items','unit_price','numeric(12,2)',true,'0'),
    ('invoice_items','tax_percent','numeric(5,2)',true,'0'),
    ('invoice_items','line_total','numeric(12,2)',true,'0'),
    ('invoice_items','created_at','timestamp with time zone',true,'now()'),
    ('payment_transactions','id','uuid',true,'gen_random_uuid()'),
    ('payment_transactions','tenant_id','uuid',true,null),
    ('payment_transactions','invoice_id','uuid',false,null),
    ('payment_transactions','provider','text',true,'''manual''::text'),
    ('payment_transactions','provider_transaction_id','text',false,null),
    ('payment_transactions','status','text',true,'''pending''::text'),
    ('payment_transactions','amount','numeric(12,2)',true,'0'),
    ('payment_transactions','currency','text',true,'''INR''::text'),
    ('payment_transactions','metadata_json','jsonb',true,'''{}''::jsonb'),
    ('payment_transactions','created_at','timestamp with time zone',true,'now()')
), legacy_schema_state as (
  select
    e.*,
    a.attname is not null as installed,
    case when a.attname is null then null else format_type(a.atttypid, a.atttypmod) end as actual_type,
    case when a.attname is null then null else a.attnotnull end as actual_not_null,
    pg_get_expr(d.adbin, d.adrelid) as actual_default,
    a.attname is not null
      and format_type(a.atttypid, a.atttypmod) = e.formatted_type
      and a.attnotnull = e.not_null
      and pg_get_expr(d.adbin, d.adrelid) is not distinct from e.default_expr as compatible
  from legacy_expected_columns e
  left join pg_class c on c.oid = to_regclass(format('public.%I', e.table_name))
  left join pg_attribute a
    on a.attrelid = c.oid
   and a.attname = e.column_name
   and a.attnum > 0
   and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
), legacy_constraint_state as (
  select jsonb_build_object(
    'invoice_primary_key', exists (
      select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'p'
    ),
    'invoice_number_unique', exists (
      select 1
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.invoices'::regclass
        and i.indisunique and i.indisvalid and i.indisready
        and i.indnkeyatts = 1 and a.attname = 'invoice_number'
    ),
    'invoice_tenant_fk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and contype = 'f'
        and confrelid = 'public.tenants'::regclass and confdeltype = 'c'
        and conkey = array[(select attnum from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'tenant_id')]::smallint[]
    ),
    'invoice_subscription_fk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and contype = 'f'
        and confrelid = 'public.subscriptions'::regclass and confdeltype = 'n'
        and conkey = array[(select attnum from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'subscription_id')]::smallint[]
    ),
    'invoice_item_primary_key', exists (
      select 1 from pg_constraint where conrelid = 'public.invoice_items'::regclass and contype = 'p'
    ),
    'invoice_item_invoice_fk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoice_items'::regclass and contype = 'f'
        and confrelid = 'public.invoices'::regclass and confdeltype = 'c'
        and conkey = array[(select attnum from pg_attribute where attrelid = 'public.invoice_items'::regclass and attname = 'invoice_id')]::smallint[]
    ),
    'payment_transaction_primary_key', exists (
      select 1 from pg_constraint where conrelid = 'public.payment_transactions'::regclass and contype = 'p'
    ),
    'payment_transaction_tenant_fk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.payment_transactions'::regclass and contype = 'f'
        and confrelid = 'public.tenants'::regclass and confdeltype = 'c'
    ),
    'payment_transaction_invoice_fk', exists (
      select 1 from pg_constraint
      where conrelid = 'public.payment_transactions'::regclass and contype = 'f'
        and confrelid = 'public.invoices'::regclass and confdeltype = 'n'
    )
  ) as value
), authority_expected_columns(table_name, column_name, formatted_type) as (
  values
    ('tenant_subscription_assignments','id','uuid'),
    ('tenant_subscription_assignments','tenant_id','uuid'),
    ('tenant_subscription_assignments','plan_id','uuid'),
    ('tenant_subscription_assignments','status','text'),
    ('tenant_subscription_assignments','billing_cycle','text'),
    ('tenant_subscription_assignments','currency','text'),
    ('tenant_subscription_assignments','current_period_start','timestamp with time zone'),
    ('tenant_subscription_assignments','current_period_end','timestamp with time zone'),
    ('tenant_subscription_assignments','payment_status','text'),
    ('tenant_subscription_assignments','is_current','boolean'),
    ('subscription_plan_prices','id','uuid'),
    ('subscription_plan_prices','plan_id','uuid'),
    ('subscription_plan_prices','currency','text'),
    ('subscription_plan_prices','billing_cycle','text'),
    ('subscription_plan_prices','amount_minor','bigint'),
    ('subscription_plan_prices','setup_fee_amount_minor','bigint'),
    ('subscription_plan_prices','tax_behavior','text'),
    ('subscription_plan_prices','region_code','text'),
    ('subscription_plan_prices','status','text'),
    ('tenant_payment_orders','id','uuid'),
    ('tenant_payment_orders','tenant_id','uuid'),
    ('tenant_payment_orders','plan_id','uuid'),
    ('tenant_payment_orders','price_id','uuid'),
    ('tenant_payment_orders','provider','text'),
    ('tenant_payment_orders','provider_mode','text'),
    ('tenant_payment_orders','provider_order_id','text'),
    ('tenant_payment_orders','internal_status','text'),
    ('tenant_payment_orders','total_amount_minor','bigint'),
    ('tenant_payment_orders','currency','text'),
    ('tenant_payment_attempts','id','uuid'),
    ('tenant_payment_attempts','payment_order_id','uuid'),
    ('tenant_payment_attempts','tenant_id','uuid'),
    ('tenant_payment_attempts','provider','text'),
    ('tenant_payment_attempts','provider_mode','text'),
    ('tenant_payment_attempts','provider_order_id','text'),
    ('tenant_payment_attempts','provider_payment_id','text'),
    ('tenant_payment_attempts','signature_valid','boolean'),
    ('tenant_payment_attempts','internal_status','text'),
    ('tenant_payment_attempts','amount_minor','bigint'),
    ('tenant_payment_attempts','currency','text'),
    ('tenant_payment_attempts','captured_at','timestamp with time zone'),
    ('tenant_plan_activation_events','id','uuid'),
    ('tenant_plan_activation_events','tenant_id','uuid'),
    ('tenant_plan_activation_events','payment_order_id','uuid'),
    ('tenant_plan_activation_events','plan_id','uuid'),
    ('tenant_plan_activation_events','price_id','uuid'),
    ('tenant_plan_activation_events','new_assignment_id','uuid'),
    ('tenant_plan_activation_events','activation_status','text'),
    ('tenant_plan_activation_events','provider','text'),
    ('tenant_plan_activation_events','provider_order_id','text'),
    ('tenant_plan_activation_events','provider_payment_id','text'),
    ('tenant_plan_activation_events','metadata_json','jsonb')
), authority_schema_state as (
  select
    e.*,
    a.attname is not null as installed,
    case when a.attname is null then null else format_type(a.atttypid, a.atttypmod) end as actual_type,
    a.attname is not null and format_type(a.atttypid, a.atttypmod) = e.formatted_type as compatible
  from authority_expected_columns e
  left join pg_class c on c.oid = to_regclass(format('public.%I', e.table_name))
  left join pg_attribute a
    on a.attrelid = c.oid and a.attname = e.column_name
    and a.attnum > 0 and not a.attisdropped
), legacy_counts as (
  select
    (select count(*) from public.invoices) as invoice_rows,
    (select count(*) from public.invoice_items) as invoice_item_rows,
    (select count(*) from public.payment_transactions) as payment_transaction_rows,
    (select count(*) from public.finance_invoices) as student_finance_invoice_rows,
    (select count(*) from public.finance_payments) as student_finance_payment_rows,
    (select count(*) from public.finance_receipts) as student_finance_receipt_rows
), current_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', table_name,
    'grantee', grantee,
    'privilege', privilege_type
  ) order by table_name, grantee, privilege_type), '[]'::jsonb) as value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('invoices', 'invoice_items', 'payment_transactions')
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), payment_transactions_grant_classification as (
  select jsonb_build_object(
    'browser_direct_grants', count(*) filter (
      where grantee in ('PUBLIC','anon','authenticated')
    ),
    'browser_destructive_or_write_grants', count(*) filter (
      where grantee in ('PUBLIC','anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
    ),
    'authenticated_select', count(*) filter (
      where grantee = 'authenticated' and privilege_type = 'SELECT'
    ),
    'service_role_grants', count(*) filter (where grantee = 'service_role')
  ) as value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'payment_transactions'
    and grantee in ('PUBLIC','anon','authenticated','service_role')
), existing_functions as (
  select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '[]'::jsonb) as value
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'coachfort_internal')
    and (
      p.proname ilike '%invoice%'
      or p.proname ilike '%receipt%'
      or p.proname ilike '%billing_document%'
    )
), numbering_objects as (
  select coalesce(jsonb_agg(c.oid::regclass::text order by c.oid::regclass::text), '[]'::jsonb) as value
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'coachfort_internal')
    and c.relkind = 'S'
    and (c.relname ilike '%invoice%' or c.relname ilike '%receipt%')
), payment_fk_candidates as (
  select jsonb_build_object(
    'orders', (select count(*) from public.tenant_payment_orders),
    'attempts', (select count(*) from public.tenant_payment_attempts),
    'activations', (select count(*) from public.tenant_plan_activation_events),
    'prices', (select count(*) from public.subscription_plan_prices),
    'assignments', (select count(*) from public.tenant_subscription_assignments)
  ) as value
), billing_profile_state as (
  select jsonb_build_object(
    'profiles', count(*),
    'complete_profiles', count(*) filter (where
      nullif(btrim(legal_name), '') is not null
      and nullif(btrim(billing_email), '') is not null
      and nullif(btrim(address_line1), '') is not null
      and nullif(btrim(city), '') is not null
      and nullif(btrim(postal_code), '') is not null
      and country is not null
      and preferred_currency in ('INR', 'EUR', 'USD')
    )
  ) as value
  from public.tenant_billing_profiles
), conflicts as (
  select jsonb_build_object(
    'issuer_table', exists(select 1 from pg_class where oid = to_regclass('public.platform_billing_issuer_profiles') and relkind = 'r'),
    'receipt_table', exists(select 1 from pg_class where oid = to_regclass('public.platform_billing_receipts') and relkind = 'r'),
    'invoice_sequence', exists(select 1 from pg_class where oid = to_regclass('coachfort_internal.platform_invoice_number_seq') and relkind = 'S'),
    'receipt_sequence', exists(select 1 from pg_class where oid = to_regclass('coachfort_internal.platform_receipt_number_seq') and relkind = 'S'),
    'list_rpc', to_regprocedure('public.get_platform_billing_documents(uuid)') is not null,
    'detail_rpc', to_regprocedure('public.get_platform_billing_document(uuid,text,uuid)') is not null,
    'invoice_issue_rpc', to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)') is not null,
    'receipt_issue_rpc', to_regprocedure('public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)') is not null,
    'issuer_config_rpc', exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'configure_platform_billing_issuer_profile'
    ),
    'invoice_column_conflicts', coalesce((
      select jsonb_agg(column_name order by column_name)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'invoices'
        and column_name in (
          'source_key','subscription_assignment_id','plan_id','price_id',
          'billing_cycle','period_start','period_end','subtotal_minor',
          'discount_amount_minor','tax_amount_minor','total_amount_minor',
          'billing_snapshot','issuer_snapshot','plan_snapshot','voided_at','void_reason'
        )
    ), '[]'::jsonb),
    'invoice_item_column_conflicts', coalesce((
      select jsonb_agg(column_name order by column_name)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'invoice_items'
        and column_name in (
          'billing_cycle','period_start','period_end','unit_amount_minor',
          'discount_amount_minor','tax_amount_minor','line_total_minor','item_snapshot'
        )
    ), '[]'::jsonb)
  ) as value
)
select jsonb_build_object(
  'table_state', (select jsonb_agg(to_jsonb(table_state) order by table_name) from table_state),
  'legacy_schema', (select jsonb_agg(to_jsonb(legacy_schema_state) order by table_name, column_name) from legacy_schema_state),
  'legacy_schema_violation_count', (select count(*) from legacy_schema_state where not compatible),
  'legacy_constraints', (select value from legacy_constraint_state),
  'authority_schema', (select jsonb_agg(to_jsonb(authority_schema_state) order by table_name, column_name) from authority_schema_state),
  'authority_schema_violation_count', (select count(*) from authority_schema_state where not compatible),
  'legacy_platform_counts', (select to_jsonb(legacy_counts) from legacy_counts),
  'student_finance_counts_preserved', (select jsonb_build_object(
    'invoices', student_finance_invoice_rows,
    'payments', student_finance_payment_rows,
    'receipts', student_finance_receipt_rows
  ) from legacy_counts),
  'current_direct_grants', (select value from current_grants),
  'payment_transactions_grant_classification', (select value from payment_transactions_grant_classification),
  'existing_billing_functions', (select value from existing_functions),
  'existing_numbering_objects', (select value from numbering_objects),
  'payment_reference_candidates', (select value from payment_fk_candidates),
  'billing_profiles', (select value from billing_profile_state),
  'proposed_object_conflicts', (select value from conflicts),
  'required_extensions', jsonb_build_object(
    'pgcrypto', exists(select 1 from pg_extension where extname = 'pgcrypto')
  ),
  'internal_schema_exposed', exists (
    select 1
    from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
    where btrim(exposed.schema_name) = 'coachfort_internal'
  )
);
*/

begin;

do $$
declare
  v_missing text[];
  v_invoice_rows bigint;
  v_invoice_item_rows bigint;
  v_payment_transaction_rows bigint;
begin
  select array_agg(name order by name)
  into v_missing
  from unnest(array[
    'public.invoices',
    'public.invoice_items',
    'public.payment_transactions',
    'public.subscriptions',
    'public.tenant_billing_profiles',
    'public.subscription_plans',
    'public.subscription_plan_prices',
    'public.tenant_subscription_assignments',
    'public.tenant_payment_orders',
    'public.tenant_payment_attempts',
    'public.tenant_plan_activation_events',
    'public.finance_invoices',
    'public.finance_payments',
    'public.finance_receipts'
  ]) name
  where to_regclass(name) is null;

  if v_missing is not null then
    raise exception 'UX-8E prerequisites are missing: %', array_to_string(v_missing, ', ')
      using errcode = '42P01';
  end if;

  if to_regprocedure('public.m77b_assert_billing_profile_access(uuid)') is null
     or to_regprocedure('public.platform_can_manage_billing()') is null
     or to_regprocedure('public.billing_profile_supported_country_codes()') is null then
    raise exception 'UX-8E access prerequisites are missing.' using errcode = '42883';
  end if;

  if not exists (
       select 1 from pg_index where indexrelid = to_regclass('public.subscription_plan_prices_active_unique_idx')
         and indisunique and indisvalid and indisready and indpred is not null
     )
     or not exists (
       select 1 from pg_index where indexrelid = to_regclass('public.tenant_subscription_assignments_current_unique_idx')
         and indisunique and indisvalid and indisready and indpred is not null
     )
     or not exists (
       select 1 from pg_index where indexrelid = to_regclass('public.tenant_payment_attempts_provider_payment_id_uidx')
         and indisunique and indisvalid and indisready
     )
     or not exists (
       select 1 from pg_index where indexrelid = to_regclass('public.tenant_plan_activation_events_payment_order_uidx')
         and indisunique and indisvalid and indisready
     ) then
    raise exception 'Subscription or payment authority uniqueness prerequisites are incompatible.' using errcode = 'P0001';
  end if;

  if exists (
    with expected(table_name, column_name, formatted_type, not_null, default_expr) as (
      values
        ('invoices','id','uuid',true,'gen_random_uuid()'),
        ('invoices','tenant_id','uuid',true,null),
        ('invoices','subscription_id','uuid',false,null),
        ('invoices','invoice_number','text',true,null),
        ('invoices','status','text',true,'''draft''::text'),
        ('invoices','subtotal','numeric(12,2)',true,'0'),
        ('invoices','tax_amount','numeric(12,2)',true,'0'),
        ('invoices','total_amount','numeric(12,2)',true,'0'),
        ('invoices','currency','text',true,'''INR''::text'),
        ('invoices','billing_name','text',false,null),
        ('invoices','billing_email','text',false,null),
        ('invoices','billing_address','text',false,null),
        ('invoices','gst_number','text',false,null),
        ('invoices','issued_at','timestamp with time zone',false,null),
        ('invoices','due_at','timestamp with time zone',false,null),
        ('invoices','paid_at','timestamp with time zone',false,null),
        ('invoices','created_at','timestamp with time zone',true,'now()'),
        ('invoice_items','id','uuid',true,'gen_random_uuid()'),
        ('invoice_items','invoice_id','uuid',true,null),
        ('invoice_items','description','text',true,null),
        ('invoice_items','quantity','numeric(12,2)',true,'1'),
        ('invoice_items','unit_price','numeric(12,2)',true,'0'),
        ('invoice_items','tax_percent','numeric(5,2)',true,'0'),
        ('invoice_items','line_total','numeric(12,2)',true,'0'),
        ('invoice_items','created_at','timestamp with time zone',true,'now()'),
        ('payment_transactions','id','uuid',true,'gen_random_uuid()'),
        ('payment_transactions','tenant_id','uuid',true,null),
        ('payment_transactions','invoice_id','uuid',false,null),
        ('payment_transactions','provider','text',true,'''manual''::text'),
        ('payment_transactions','provider_transaction_id','text',false,null),
        ('payment_transactions','status','text',true,'''pending''::text'),
        ('payment_transactions','amount','numeric(12,2)',true,'0'),
        ('payment_transactions','currency','text',true,'''INR''::text'),
        ('payment_transactions','metadata_json','jsonb',true,'''{}''::jsonb'),
        ('payment_transactions','created_at','timestamp with time zone',true,'now()')
    )
    select 1
    from expected e
    left join pg_class c on c.oid = to_regclass(format('public.%I', e.table_name))
    left join pg_attribute a
      on a.attrelid = c.oid and a.attname = e.column_name
      and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attname is null
       or format_type(a.atttypid, a.atttypmod) <> e.formatted_type
       or a.attnotnull <> e.not_null
       or pg_get_expr(d.adbin, d.adrelid) is distinct from e.default_expr
  ) then
    raise exception 'Legacy platform billing schema differs from the exact UX-8E prerequisites.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.invoices'::regclass
      and i.indisunique and i.indisvalid and i.indisready
      and i.indnkeyatts = 1 and a.attname = 'invoice_number'
  ) then
    raise exception 'invoices.invoice_number must be protected by a valid unique index.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'p')
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.invoices'::regclass and contype = 'f'
         and confrelid = 'public.tenants'::regclass and confdeltype = 'c'
         and conkey = array[(select attnum from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'tenant_id')]::smallint[]
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.invoices'::regclass and contype = 'f'
         and confrelid = 'public.subscriptions'::regclass and confdeltype = 'n'
         and conkey = array[(select attnum from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'subscription_id')]::smallint[]
     )
     or not exists (select 1 from pg_constraint where conrelid = 'public.invoice_items'::regclass and contype = 'p')
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.invoice_items'::regclass and contype = 'f'
         and confrelid = 'public.invoices'::regclass and confdeltype = 'c'
         and conkey = array[(select attnum from pg_attribute where attrelid = 'public.invoice_items'::regclass and attname = 'invoice_id')]::smallint[]
     )
     or not exists (select 1 from pg_constraint where conrelid = 'public.payment_transactions'::regclass and contype = 'p')
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.payment_transactions'::regclass and contype = 'f'
         and confrelid = 'public.tenants'::regclass and confdeltype = 'c'
         and conkey = array[(select attnum from pg_attribute where attrelid = 'public.payment_transactions'::regclass and attname = 'tenant_id')]::smallint[]
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.payment_transactions'::regclass and contype = 'f'
         and confrelid = 'public.invoices'::regclass and confdeltype = 'n'
         and conkey = array[(select attnum from pg_attribute where attrelid = 'public.payment_transactions'::regclass and attname = 'invoice_id')]::smallint[]
     ) then
    raise exception 'Legacy platform billing key or foreign-key contract is incompatible.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_status_check' and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%draft%'
      and pg_get_constraintdef(oid) ilike '%issued%'
      and pg_get_constraintdef(oid) ilike '%paid%'
      and pg_get_constraintdef(oid) ilike '%overdue%'
      and pg_get_constraintdef(oid) ilike '%void%'
  ) then
    raise exception 'The expected legacy invoices_status_check is missing or incompatible.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
    where btrim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'coachfort_internal must not be exposed through PostgREST.' using errcode = '42501';
  end if;

  select count(*) into v_invoice_rows from public.invoices;
  select count(*) into v_invoice_item_rows from public.invoice_items;
  select count(*) into v_payment_transaction_rows from public.payment_transactions;

  if v_invoice_rows <> 0 or v_invoice_item_rows <> 0 or v_payment_transaction_rows <> 0 then
    raise exception 'Legacy platform billing rows require explicit classification before UX-8E (invoices %, items %, transactions %).',
      v_invoice_rows, v_invoice_item_rows, v_payment_transaction_rows
      using errcode = 'P0001';
  end if;

  if to_regclass('public.platform_billing_issuer_profiles') is not null
     or to_regclass('public.platform_billing_receipts') is not null
     or to_regclass('coachfort_internal.platform_invoice_number_seq') is not null
     or to_regclass('coachfort_internal.platform_receipt_number_seq') is not null
     or to_regclass('public.invoices_source_key_uidx') is not null
     or to_regclass('public.invoices_tenant_issued_idx') is not null
     or exists (
       select 1
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname, p.proname) in (
         ('coachfort_internal','next_platform_billing_document_number'),
         ('coachfort_internal','enforce_platform_billing_immutability'),
         ('coachfort_internal','enforce_platform_billing_item_immutability'),
         ('coachfort_internal','platform_billing_can_read_tenant'),
         ('public','configure_platform_billing_issuer_profile'),
         ('public','get_platform_billing_documents'),
         ('public','get_platform_billing_document'),
         ('public','issue_platform_subscription_invoice'),
         ('public','issue_platform_payment_receipt')
       )
     )
     or exists (
       select 1 from pg_trigger
       where tgname in (
         'enforce_invoices_immutability',
         'enforce_invoice_items_immutability',
         'enforce_platform_billing_receipts_immutability'
       ) and not tgisinternal
     )
     or exists (
       select 1 from pg_constraint
       where conrelid in ('public.invoices'::regclass, 'public.invoice_items'::regclass)
         and conname in (
           'invoices_currency_check','invoices_billing_cycle_check','invoices_source_key_check',
           'invoices_period_check','invoices_due_after_issue_check','invoices_minor_amounts_check',
           'invoices_tax_state_check','invoices_legacy_amount_parity_check','invoices_snapshot_shape_check',
           'invoices_snapshot_size_check','invoices_void_state_check','invoice_items_billing_cycle_check',
           'invoice_items_period_check','invoice_items_minor_amounts_check','invoice_items_tax_state_check',
           'invoice_items_legacy_amount_parity_check','invoice_items_snapshot_shape_check',
           'invoice_items_snapshot_size_check'
         )
     ) then
    raise exception 'Conflicting UX-8E object already exists; review before applying.' using errcode = '42710';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'invoices' and column_name in (
          'source_key','subscription_assignment_id','plan_id','price_id',
           'billing_cycle','period_start','period_end','subtotal_minor',
           'discount_amount_minor','tax_amount_minor','tax_calculation_status','total_amount_minor',
          'billing_snapshot','issuer_snapshot','plan_snapshot','voided_at','void_reason'
        ))
        or (table_name = 'invoice_items' and column_name in (
           'billing_cycle','period_start','period_end','unit_amount_minor',
           'discount_amount_minor','tax_amount_minor','tax_calculation_status','line_total_minor','item_snapshot'
        ))
      )
  ) then
    raise exception 'Conflicting UX-8E invoice columns already exist; review before applying.' using errcode = '42701';
  end if;
end;
$$;

create table public.platform_billing_issuer_profiles (
  profile_key text primary key default 'default',
  legal_name text not null,
  billing_email text not null,
  billing_phone text,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text,
  postal_code text not null,
  country text not null,
  tax_registration_type text not null default 'NONE',
  tax_id text,
  status text not null default 'active',
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_billing_issuer_profiles_singleton_check check (profile_key = 'default'),
  constraint platform_billing_issuer_profiles_country_check check (country ~ '^[A-Z]{2}$'),
  constraint platform_billing_issuer_profiles_tax_type_check check (tax_registration_type in ('NONE', 'GSTIN', 'VAT', 'OTHER')),
  constraint platform_billing_issuer_profiles_tax_id_check check (
    (tax_registration_type = 'NONE' and nullif(btrim(coalesce(tax_id, '')), '') is null)
    or (tax_registration_type <> 'NONE' and nullif(btrim(coalesce(tax_id, '')), '') is not null)
  ),
  constraint platform_billing_issuer_profiles_status_check check (status in ('active', 'inactive')),
  constraint platform_billing_issuer_profiles_text_check check (
    char_length(btrim(legal_name)) between 1 and 240
    and char_length(btrim(billing_email)) between 3 and 254
    and billing_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and (billing_phone is null or char_length(btrim(billing_phone)) between 5 and 40)
    and char_length(btrim(address_line1)) between 1 and 300
    and (address_line2 is null or char_length(btrim(address_line2)) between 1 and 300)
    and char_length(btrim(city)) between 1 and 160
    and (state is null or char_length(btrim(state)) between 1 and 160)
    and char_length(btrim(postal_code)) between 1 and 40
    and (tax_id is null or char_length(btrim(tax_id)) between 1 and 120)
    and legal_name !~ '[<>]'
    and billing_email !~ '[<>]'
    and address_line1 !~ '[<>]'
  ),
  constraint platform_billing_issuer_profiles_effective_check check (effective_from <= updated_at)
);

create function public.configure_platform_billing_issuer_profile(
  p_legal_name text,
  p_billing_email text,
  p_billing_phone text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_country text,
  p_tax_registration_type text,
  p_tax_id text,
  p_status text default 'active',
  p_effective_from timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_tax_type text := upper(btrim(coalesce(p_tax_registration_type, 'NONE')));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_effective_from timestamptz := coalesce(p_effective_from, now());
begin
  if nullif(btrim(coalesce(p_legal_name, '')), '') is null
     or char_length(btrim(p_legal_name)) > 240
     or p_legal_name ~ '[<>]' then
    raise exception 'A valid issuer legal name is required.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_billing_email, '')), '') is null
     or char_length(btrim(p_billing_email)) > 254
     or btrim(p_billing_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_billing_email ~ '[<>]' then
    raise exception 'A valid issuer billing email is required.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_address_line1, '')), '') is null
     or char_length(btrim(p_address_line1)) > 300
     or p_address_line1 ~ '[<>]'
     or nullif(btrim(coalesce(p_city, '')), '') is null
     or char_length(btrim(p_city)) > 160
     or nullif(btrim(coalesce(p_postal_code, '')), '') is null
     or char_length(btrim(p_postal_code)) > 40 then
    raise exception 'A complete issuer billing address is required.' using errcode = '22023';
  end if;

  if v_country <> all(public.billing_profile_supported_country_codes()) then
    raise exception 'Issuer billing country is not supported.' using errcode = '22023';
  end if;

  if v_tax_type not in ('NONE', 'GSTIN', 'VAT', 'OTHER')
     or (v_tax_type = 'NONE' and nullif(btrim(coalesce(p_tax_id, '')), '') is not null)
     or (v_tax_type <> 'NONE' and nullif(btrim(coalesce(p_tax_id, '')), '') is null) then
    raise exception 'Issuer tax registration is invalid.' using errcode = '22023';
  end if;

  if v_status not in ('active', 'inactive') or v_effective_from > now() then
    raise exception 'Issuer status or effective timestamp is invalid.' using errcode = '22023';
  end if;

  insert into public.platform_billing_issuer_profiles (
    profile_key, legal_name, billing_email, billing_phone, address_line1,
    address_line2, city, state, postal_code, country, tax_registration_type,
    tax_id, status, effective_from, updated_at
  ) values (
    'default', btrim(p_legal_name), lower(btrim(p_billing_email)), nullif(btrim(p_billing_phone), ''),
    btrim(p_address_line1), nullif(btrim(p_address_line2), ''), btrim(p_city),
    nullif(btrim(p_state), ''), btrim(p_postal_code), v_country, v_tax_type,
    nullif(btrim(p_tax_id), ''), v_status, v_effective_from, now()
  )
  on conflict (profile_key) do update
  set legal_name = excluded.legal_name,
      billing_email = excluded.billing_email,
      billing_phone = excluded.billing_phone,
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      city = excluded.city,
      state = excluded.state,
      postal_code = excluded.postal_code,
      country = excluded.country,
      tax_registration_type = excluded.tax_registration_type,
      tax_id = excluded.tax_id,
      status = excluded.status,
      effective_from = excluded.effective_from,
      updated_at = now();

  return jsonb_build_object(
    'configured', true,
    'profile_key', 'default',
    'status', v_status,
    'effective_from', v_effective_from
  );
end;
$$;

alter table public.invoices
  add column source_key text,
  add column subscription_assignment_id uuid references public.tenant_subscription_assignments(id) on delete restrict,
  add column plan_id uuid references public.subscription_plans(id) on delete restrict,
  add column price_id uuid references public.subscription_plan_prices(id) on delete restrict,
  add column billing_cycle text,
  add column period_start timestamptz,
  add column period_end timestamptz,
  add column subtotal_minor bigint,
  add column discount_amount_minor bigint not null default 0,
  add column tax_amount_minor bigint,
  add column tax_calculation_status text,
  add column total_amount_minor bigint,
  add column billing_snapshot jsonb,
  add column issuer_snapshot jsonb,
  add column plan_snapshot jsonb,
  add column voided_at timestamptz,
  add column void_reason text;

alter table public.invoice_items
  add column billing_cycle text,
  add column period_start timestamptz,
  add column period_end timestamptz,
  add column unit_amount_minor bigint,
  add column discount_amount_minor bigint not null default 0,
  add column tax_amount_minor bigint,
  add column tax_calculation_status text,
  add column line_total_minor bigint,
  add column item_snapshot jsonb;

alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices alter column status set default 'issued';

alter table public.invoices
  alter column source_key set not null,
  alter column issued_at set not null,
  alter column plan_id set not null,
  alter column price_id set not null,
  alter column billing_cycle set not null,
  alter column subtotal_minor set not null,
  alter column tax_calculation_status set not null,
  alter column total_amount_minor set not null,
  alter column billing_snapshot set not null,
  alter column issuer_snapshot set not null,
  alter column plan_snapshot set not null,
  add constraint invoices_status_check check (status in ('issued', 'void')),
  add constraint invoices_currency_check check (currency in ('INR', 'EUR', 'USD')),
  add constraint invoices_billing_cycle_check check (billing_cycle in ('monthly', 'yearly', 'custom')),
  add constraint invoices_source_key_check check (char_length(source_key) between 8 and 240 and source_key !~ '[<>]'),
  add constraint invoices_period_check check (period_start is null or period_end is null or period_start < period_end),
  add constraint invoices_due_after_issue_check check (due_at is null or due_at >= issued_at),
  add constraint invoices_minor_amounts_check check (
    subtotal_minor >= 0 and discount_amount_minor >= 0 and subtotal_minor >= discount_amount_minor
    and (tax_amount_minor is null or tax_amount_minor >= 0)
    and total_amount_minor = subtotal_minor - discount_amount_minor + coalesce(tax_amount_minor, 0)
  ),
  add constraint invoices_tax_state_check check (
    (tax_calculation_status = 'not_calculated' and tax_amount_minor is null)
    or (tax_calculation_status = 'not_applicable' and tax_amount_minor = 0)
    or (tax_calculation_status = 'calculated' and tax_amount_minor is not null and tax_amount_minor >= 0)
  ),
  add constraint invoices_legacy_amount_parity_check check (
    subtotal = subtotal_minor::numeric / 100
    and (
      (tax_amount_minor is null and tax_amount = 0)
      or tax_amount = tax_amount_minor::numeric / 100
    )
    and total_amount = total_amount_minor::numeric / 100
  ),
  add constraint invoices_snapshot_shape_check check (
    jsonb_typeof(billing_snapshot) = 'object'
    and jsonb_typeof(issuer_snapshot) = 'object'
    and jsonb_typeof(plan_snapshot) = 'object'
    and billing_snapshot ?& array['legal_name','billing_email','address_line1','city','postal_code','country','preferred_currency','tax_registration_type','tax_id']
    and issuer_snapshot ?& array['legal_name','billing_email','address_line1','city','postal_code','country','tax_registration_type','tax_id']
    and plan_snapshot ?& array['plan_id','plan_code','plan_name','price_id','billing_cycle','currency','unit_amount_minor','tax_behavior','tax_calculation_status']
  ),
  add constraint invoices_snapshot_size_check check (
    char_length(billing_snapshot::text) <= 12000
    and char_length(issuer_snapshot::text) <= 12000
    and char_length(plan_snapshot::text) <= 8000
  ),
  add constraint invoices_void_state_check check (
    (status = 'issued' and voided_at is null and void_reason is null)
    or (status = 'void' and voided_at is not null and nullif(btrim(coalesce(void_reason, '')), '') is not null)
  );

alter table public.invoice_items
  alter column billing_cycle set not null,
  alter column unit_amount_minor set not null,
  alter column tax_calculation_status set not null,
  alter column line_total_minor set not null,
  alter column item_snapshot set not null,
  add constraint invoice_items_billing_cycle_check check (billing_cycle in ('monthly', 'yearly', 'custom')),
  add constraint invoice_items_period_check check (period_start is null or period_end is null or period_start < period_end),
  add constraint invoice_items_minor_amounts_check check (
    unit_amount_minor >= 0 and discount_amount_minor >= 0
    and round(quantity * unit_amount_minor)::bigint >= discount_amount_minor
    and (tax_amount_minor is null or tax_amount_minor >= 0)
    and line_total_minor = round(quantity * unit_amount_minor)::bigint - discount_amount_minor + coalesce(tax_amount_minor, 0)
  ),
  add constraint invoice_items_tax_state_check check (
    (tax_calculation_status = 'not_calculated' and tax_amount_minor is null)
    or (tax_calculation_status = 'not_applicable' and tax_amount_minor = 0)
    or (tax_calculation_status = 'calculated' and tax_amount_minor is not null and tax_amount_minor >= 0)
  ),
  add constraint invoice_items_legacy_amount_parity_check check (
    unit_price = unit_amount_minor::numeric / 100
    and line_total = line_total_minor::numeric / 100
  ),
  add constraint invoice_items_snapshot_shape_check check (
    jsonb_typeof(item_snapshot) = 'object'
    and item_snapshot ?& array['description','billing_cycle','unit_amount_minor','line_total_minor','tax_calculation_status']
  ),
  add constraint invoice_items_snapshot_size_check check (char_length(item_snapshot::text) <= 8000);

create unique index invoices_source_key_uidx on public.invoices(source_key);
create index invoices_tenant_issued_idx on public.invoices(tenant_id, issued_at desc, id desc);

create table public.platform_billing_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_order_id uuid not null references public.tenant_payment_orders(id) on delete restrict,
  payment_attempt_id uuid not null references public.tenant_payment_attempts(id) on delete restrict,
  activation_event_id uuid not null references public.tenant_plan_activation_events(id) on delete restrict,
  receipt_number text not null,
  source_key text not null,
  status text not null default 'issued',
  amount_minor bigint not null,
  currency text not null,
  billing_snapshot jsonb not null,
  issuer_snapshot jsonb not null,
  plan_snapshot jsonb not null,
  payment_reference_snapshot jsonb not null,
  issued_at timestamptz not null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint platform_billing_receipts_number_key unique (receipt_number),
  constraint platform_billing_receipts_source_key_key unique (source_key),
  constraint platform_billing_receipts_invoice_key unique (invoice_id),
  constraint platform_billing_receipts_payment_attempt_key unique (payment_attempt_id),
  constraint platform_billing_receipts_activation_event_key unique (activation_event_id),
  constraint platform_billing_receipts_status_check check (status in ('issued', 'void')),
  constraint platform_billing_receipts_currency_check check (currency in ('INR', 'EUR', 'USD')),
  constraint platform_billing_receipts_amount_check check (amount_minor > 0),
  constraint platform_billing_receipts_source_key_check check (char_length(source_key) between 8 and 240 and source_key !~ '[<>]'),
  constraint platform_billing_receipts_snapshot_shape_check check (
    jsonb_typeof(billing_snapshot) = 'object'
    and jsonb_typeof(issuer_snapshot) = 'object'
    and jsonb_typeof(plan_snapshot) = 'object'
    and jsonb_typeof(payment_reference_snapshot) = 'object'
    and billing_snapshot ?& array['legal_name','billing_email','address_line1','city','postal_code','country','preferred_currency','tax_registration_type','tax_id']
    and issuer_snapshot ?& array['legal_name','billing_email','address_line1','city','postal_code','country','tax_registration_type','tax_id']
    and plan_snapshot ?& array['plan_id','plan_code','plan_name','price_id','billing_cycle','currency','unit_amount_minor']
    and payment_reference_snapshot ?& array['provider','provider_order_id','provider_payment_id','payment_order_id','payment_attempt_id','activation_event_id']
  ),
  constraint platform_billing_receipts_snapshot_size_check check (
    char_length(billing_snapshot::text) <= 12000
    and char_length(issuer_snapshot::text) <= 12000
    and char_length(plan_snapshot::text) <= 8000
    and char_length(payment_reference_snapshot::text) <= 8000
  ),
  constraint platform_billing_receipts_void_state_check check (
    (status = 'issued' and voided_at is null and void_reason is null)
    or (status = 'void' and voided_at is not null and nullif(btrim(coalesce(void_reason, '')), '') is not null)
  )
);

create index platform_billing_receipts_tenant_issued_idx
  on public.platform_billing_receipts(tenant_id, issued_at desc, id desc);
create index platform_billing_receipts_payment_order_idx
  on public.platform_billing_receipts(payment_order_id);

create sequence coachfort_internal.platform_invoice_number_seq;
create sequence coachfort_internal.platform_receipt_number_seq;

create function coachfort_internal.next_platform_billing_document_number(
  p_document_type text,
  p_issued_at timestamptz
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_sequence bigint;
  v_prefix text;
begin
  if p_document_type = 'invoice' then
    v_sequence := nextval('coachfort_internal.platform_invoice_number_seq');
    v_prefix := 'CF-INV';
  elsif p_document_type = 'receipt' then
    v_sequence := nextval('coachfort_internal.platform_receipt_number_seq');
    v_prefix := 'CF-RCT';
  else
    raise exception 'Unsupported platform billing document type.' using errcode = '22023';
  end if;

  return format('%s-%s-%s', v_prefix, to_char(coalesce(p_issued_at, now()) at time zone 'UTC', 'YYYY'), lpad(v_sequence::text, 10, '0'));
end;
$$;

create function coachfort_internal.enforce_platform_billing_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Issued CoachFort billing documents are immutable.' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array['status','voided_at','void_reason'])
     <> (to_jsonb(old) - array['status','voided_at','void_reason'])
     or old.status <> 'issued'
     or new.status <> 'void' then
    raise exception 'Only the controlled issued-to-void transition is allowed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create function coachfort_internal.enforce_platform_billing_item_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Issued CoachFort billing line items are immutable.' using errcode = '42501';
end;
$$;

create trigger enforce_invoices_immutability
before update or delete on public.invoices
for each row execute function coachfort_internal.enforce_platform_billing_immutability();

create trigger enforce_invoice_items_immutability
before update or delete on public.invoice_items
for each row execute function coachfort_internal.enforce_platform_billing_item_immutability();

create trigger enforce_platform_billing_receipts_immutability
before update or delete on public.platform_billing_receipts
for each row execute function coachfort_internal.enforce_platform_billing_immutability();

create function coachfort_internal.platform_billing_can_read_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin'])
      or public.platform_can_manage_billing()
    );
$$;

create function public.get_platform_billing_documents(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_documents jsonb;
begin
  if not coachfort_internal.platform_billing_can_read_tenant(p_tenant_id) then
    raise exception 'CoachFort billing documents are restricted.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(document order by issued_at desc, id desc), '[]'::jsonb)
  into v_documents
  from (
    select
      i.id,
      i.issued_at,
      jsonb_build_object(
        'id', i.id,
        'document_type', 'invoice',
        'document_number', i.invoice_number,
        'status', i.status,
        'currency', i.currency,
        'subtotal_minor', i.subtotal_minor,
        'tax_amount_minor', i.tax_amount_minor,
        'tax_calculation_status', i.tax_calculation_status,
        'total_amount_minor', i.total_amount_minor,
        'issued_at', i.issued_at,
        'due_at', i.due_at,
        'billing_cycle', i.billing_cycle,
        'period_start', i.period_start,
        'period_end', i.period_end,
        'plan_name', i.plan_snapshot->>'plan_name',
        'billing_snapshot', i.billing_snapshot,
        'issuer_snapshot', i.issuer_snapshot,
        'payment_reference', null,
        'line_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'description', ii.description,
            'quantity', ii.quantity,
            'unit_amount_minor', ii.unit_amount_minor,
            'discount_amount_minor', ii.discount_amount_minor,
            'tax_amount_minor', ii.tax_amount_minor,
            'tax_calculation_status', ii.tax_calculation_status,
            'line_total_minor', ii.line_total_minor,
            'billing_cycle', ii.billing_cycle,
            'period_start', ii.period_start,
            'period_end', ii.period_end
          ) order by ii.created_at, ii.id)
          from public.invoice_items ii
          where ii.invoice_id = i.id
        ), '[]'::jsonb)
      ) as document
    from public.invoices i
    where i.tenant_id = p_tenant_id

    union all

    select
      r.id,
      r.issued_at,
      jsonb_build_object(
        'id', r.id,
        'document_type', 'receipt',
        'document_number', r.receipt_number,
        'status', r.status,
        'currency', r.currency,
        'subtotal_minor', r.amount_minor,
        'tax_amount_minor', i.tax_amount_minor,
        'tax_calculation_status', i.tax_calculation_status,
        'total_amount_minor', r.amount_minor,
        'issued_at', r.issued_at,
        'due_at', null,
        'billing_cycle', r.plan_snapshot->>'billing_cycle',
        'period_start', i.period_start,
        'period_end', i.period_end,
        'plan_name', r.plan_snapshot->>'plan_name',
        'billing_snapshot', r.billing_snapshot,
        'issuer_snapshot', r.issuer_snapshot,
        'payment_reference', null,
        'line_items', '[]'::jsonb
      ) as document
    from public.platform_billing_receipts r
    join public.invoices i on i.id = r.invoice_id and i.tenant_id = r.tenant_id
    where r.tenant_id = p_tenant_id
  ) documents;

  return v_documents;
end;
$$;

create function public.get_platform_billing_document(
  p_tenant_id uuid,
  p_document_type text,
  p_document_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select document
  from jsonb_array_elements(public.get_platform_billing_documents(p_tenant_id)) document
  where document->>'document_type' = p_document_type
    and document->>'id' = p_document_id::text
  limit 1;
$$;

create function public.issue_platform_subscription_invoice(
  p_source_key text,
  p_subscription_assignment_id uuid,
  p_price_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_issued_at timestamptz default now(),
  p_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.invoices%rowtype;
  v_assignment public.tenant_subscription_assignments%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_price public.subscription_plan_prices%rowtype;
  v_profile public.tenant_billing_profiles%rowtype;
  v_issuer public.platform_billing_issuer_profiles%rowtype;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal_minor bigint;
  v_tax_amount_minor bigint;
  v_tax_calculation_status text;
  v_total_amount_minor bigint;
  v_billing_snapshot jsonb;
  v_issuer_snapshot jsonb;
  v_plan_snapshot jsonb;
begin
  if p_subscription_assignment_id is null or p_price_id is null
     or p_source_key is null or char_length(p_source_key) not between 8 and 240
     or p_source_key !~ '^invoice:[A-Za-z0-9:_-]+$' then
    raise exception 'A valid invoice source key is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ux8e:' || p_source_key, 80));

  select * into v_existing from public.invoices where source_key = p_source_key;
  if v_existing.id is not null then
    if v_existing.subscription_assignment_id = p_subscription_assignment_id
       and v_existing.price_id = p_price_id
       and v_existing.period_start is not distinct from p_period_start
       and v_existing.period_end is not distinct from p_period_end
       and v_existing.due_at is not distinct from p_due_at then
      return v_existing.id;
    end if;
    raise exception 'Invoice source key conflicts with an existing document.' using errcode = '23505';
  end if;

  select * into v_assignment
  from public.tenant_subscription_assignments
  where id = p_subscription_assignment_id
  for share;
  if v_assignment.id is null
     or not v_assignment.is_current
     or v_assignment.status not in ('active', 'past_due', 'grace')
     or v_assignment.payment_status not in ('paid', 'unpaid', 'overdue') then
    raise exception 'Subscription assignment is not eligible for invoice issuance.' using errcode = '22023';
  end if;

  select * into v_plan from public.subscription_plans where id = v_assignment.plan_id;
  select * into v_price
  from public.subscription_plan_prices
  where id = p_price_id and plan_id = v_assignment.plan_id;
  if v_plan.id is null or v_price.id is null
     or v_plan.status <> 'active' or v_price.status <> 'active'
     or v_price.currency <> v_assignment.currency
     or v_price.billing_cycle <> v_assignment.billing_cycle
     or v_price.region_code <> 'GLOBAL'
     or exists (
       select 1
       from public.subscription_plan_prices competing_price
       where competing_price.plan_id = v_assignment.plan_id
         and competing_price.currency = v_assignment.currency
         and competing_price.billing_cycle = v_assignment.billing_cycle
         and competing_price.region_code = 'GLOBAL'
         and competing_price.status = 'active'
         and competing_price.id <> v_price.id
     ) then
    raise exception 'Plan price does not match subscription authority.' using errcode = '22023';
  end if;

  if (v_assignment.current_period_start is not null
        and p_period_start is distinct from v_assignment.current_period_start)
     or (v_assignment.current_period_end is not null
        and p_period_end is distinct from v_assignment.current_period_end) then
    raise exception 'Invoice period does not match the current subscription assignment.' using errcode = '22023';
  end if;

  select * into v_profile from public.tenant_billing_profiles where tenant_id = v_assignment.tenant_id;
  if v_profile.tenant_id is null
     or nullif(btrim(v_profile.legal_name), '') is null
     or nullif(btrim(v_profile.billing_email), '') is null
     or nullif(btrim(v_profile.address_line1), '') is null
     or nullif(btrim(v_profile.city), '') is null
     or nullif(btrim(v_profile.postal_code), '') is null
     or v_profile.country is null
     or v_profile.preferred_currency <> v_price.currency then
    raise exception 'A complete matching tenant billing profile is required.' using errcode = '22023';
  end if;

  select * into v_issuer
  from public.platform_billing_issuer_profiles
  where profile_key = 'default'
    and status = 'active'
    and effective_from <= coalesce(p_issued_at, now());
  if v_issuer.profile_key is null then
    raise exception 'CoachFort billing issuer profile is not configured.' using errcode = '55000';
  end if;

  if p_period_start is not null and p_period_end is not null and p_period_start >= p_period_end then
    raise exception 'Invoice period is invalid.' using errcode = '22023';
  end if;
  if p_due_at is not null and p_due_at < coalesce(p_issued_at, now()) then
    raise exception 'Invoice due date cannot precede issue date.' using errcode = '22023';
  end if;

  v_subtotal_minor := v_price.amount_minor + v_price.setup_fee_amount_minor;
  v_tax_calculation_status := case
    when v_price.tax_behavior = 'not_applicable' then 'not_applicable'
    else 'not_calculated'
  end;
  v_tax_amount_minor := case
    when v_tax_calculation_status = 'not_applicable' then 0
    else null
  end;
  v_total_amount_minor := v_subtotal_minor + coalesce(v_tax_amount_minor, 0);
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
    'tax_id', v_profile.tax_id
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
    'effective_from', v_issuer.effective_from
  );
  v_plan_snapshot := jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_code', v_plan.code,
    'plan_name', v_plan.name,
    'price_id', v_price.id,
    'billing_cycle', v_price.billing_cycle,
    'currency', v_price.currency,
    'unit_amount_minor', v_price.amount_minor,
    'setup_fee_amount_minor', v_price.setup_fee_amount_minor,
    'tax_behavior', v_price.tax_behavior,
    'tax_calculation_status', v_tax_calculation_status
  );
  v_invoice_number := coachfort_internal.next_platform_billing_document_number('invoice', p_issued_at);

  insert into public.invoices (
    tenant_id, subscription_id, invoice_number, status, subtotal, tax_amount,
    total_amount, currency, billing_name, billing_email, billing_address,
    gst_number, issued_at, due_at, paid_at, source_key,
    subscription_assignment_id, plan_id, price_id, billing_cycle, period_start,
    period_end, subtotal_minor, discount_amount_minor, tax_amount_minor, tax_calculation_status,
    total_amount_minor, billing_snapshot, issuer_snapshot, plan_snapshot
  ) values (
    v_assignment.tenant_id, null, v_invoice_number, 'issued',
    v_subtotal_minor::numeric / 100, 0, v_total_amount_minor::numeric / 100,
    v_price.currency, v_profile.legal_name, v_profile.billing_email,
    concat_ws(', ', v_profile.address_line1, v_profile.address_line2, v_profile.city, v_profile.state, v_profile.postal_code, v_profile.country),
    case when v_profile.tax_registration_type = 'GSTIN' then v_profile.tax_id else null end,
    coalesce(p_issued_at, now()), p_due_at, null, p_source_key,
    p_subscription_assignment_id, v_assignment.plan_id, p_price_id, v_price.billing_cycle,
    p_period_start, p_period_end, v_subtotal_minor, 0, v_tax_amount_minor,
    v_tax_calculation_status, v_total_amount_minor,
    v_billing_snapshot, v_issuer_snapshot, v_plan_snapshot
  ) returning id into v_invoice_id;

  insert into public.invoice_items (
    invoice_id, description, quantity, unit_price, tax_percent, line_total,
    billing_cycle, period_start, period_end, unit_amount_minor,
    discount_amount_minor, tax_amount_minor, tax_calculation_status, line_total_minor, item_snapshot
  ) values (
    v_invoice_id, v_plan.name || ' - ' || initcap(v_price.billing_cycle), 1,
    v_price.amount_minor::numeric / 100, 0, v_price.amount_minor::numeric / 100,
    v_price.billing_cycle, p_period_start, p_period_end, v_price.amount_minor,
    0, v_tax_amount_minor, v_tax_calculation_status,
    v_price.amount_minor + coalesce(v_tax_amount_minor, 0),
    jsonb_build_object(
      'description', v_plan.name || ' - ' || initcap(v_price.billing_cycle),
      'billing_cycle', v_price.billing_cycle,
      'unit_amount_minor', v_price.amount_minor,
      'line_total_minor', v_price.amount_minor + coalesce(v_tax_amount_minor, 0),
      'tax_calculation_status', v_tax_calculation_status,
      'plan_id', v_plan.id,
      'price_id', v_price.id
    )
  );

  if v_price.setup_fee_amount_minor > 0 then
    insert into public.invoice_items (
      invoice_id, description, quantity, unit_price, tax_percent, line_total,
      billing_cycle, period_start, period_end, unit_amount_minor,
      discount_amount_minor, tax_amount_minor, tax_calculation_status, line_total_minor, item_snapshot
    ) values (
      v_invoice_id, 'CoachFort setup fee', 1,
      v_price.setup_fee_amount_minor::numeric / 100, 0,
      v_price.setup_fee_amount_minor::numeric / 100,
      v_price.billing_cycle, p_period_start, p_period_end,
      v_price.setup_fee_amount_minor, 0, v_tax_amount_minor,
      v_tax_calculation_status,
      v_price.setup_fee_amount_minor + coalesce(v_tax_amount_minor, 0),
      jsonb_build_object(
        'description', 'CoachFort setup fee',
        'billing_cycle', v_price.billing_cycle,
        'unit_amount_minor', v_price.setup_fee_amount_minor,
        'line_total_minor', v_price.setup_fee_amount_minor + coalesce(v_tax_amount_minor, 0),
        'tax_calculation_status', v_tax_calculation_status,
        'plan_id', v_plan.id,
        'price_id', v_price.id
      )
    );
  end if;

  return v_invoice_id;
end;
$$;

create function public.issue_platform_payment_receipt(
  p_invoice_id uuid,
  p_source_key text,
  p_payment_attempt_id uuid,
  p_issued_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.platform_billing_receipts%rowtype;
  v_invoice public.invoices%rowtype;
  v_order public.tenant_payment_orders%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_activation public.tenant_plan_activation_events%rowtype;
  v_receipt_id uuid;
begin
  if p_source_key is null or char_length(p_source_key) not between 8 and 240
     or p_source_key !~ '^receipt:[A-Za-z0-9:_-]+$' then
    raise exception 'A valid receipt source key is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ux8e:' || p_source_key, 80));
  select * into v_existing from public.platform_billing_receipts where source_key = p_source_key;
  if v_existing.id is not null then
    if v_existing.invoice_id = p_invoice_id
       and v_existing.payment_attempt_id = p_payment_attempt_id then
      return v_existing.id;
    end if;
    raise exception 'Receipt source key conflicts with an existing document.' using errcode = '23505';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  select * into v_attempt from public.tenant_payment_attempts where id = p_payment_attempt_id;
  select * into v_order
  from public.tenant_payment_orders
  where id = v_attempt.payment_order_id;
  select * into v_activation
  from public.tenant_plan_activation_events
  where payment_order_id = v_order.id;

  if v_invoice.id is null or v_invoice.status <> 'issued'
     or v_order.id is null or v_order.tenant_id <> v_invoice.tenant_id
     or v_attempt.id is null or v_attempt.payment_order_id <> v_order.id or v_attempt.tenant_id <> v_invoice.tenant_id
     or v_activation.id is null or v_activation.payment_order_id <> v_order.id or v_activation.tenant_id <> v_invoice.tenant_id
     or v_attempt.internal_status <> 'captured' or coalesce(v_attempt.signature_valid, false) is not true
     or v_attempt.captured_at is null
     or v_activation.activation_status not in ('activated', 'skipped_already_active')
     or v_attempt.provider_payment_id is null
     or v_order.provider_order_id is null
     or v_order.internal_status <> 'activated'
     or v_attempt.provider <> v_order.provider
     or v_attempt.provider_mode <> v_order.provider_mode
     or v_attempt.provider_order_id is distinct from v_order.provider_order_id
     or v_attempt.amount_minor is distinct from v_order.total_amount_minor
     or v_attempt.currency is distinct from v_order.currency
     or v_activation.provider <> v_order.provider
     or v_activation.provider_order_id is distinct from v_order.provider_order_id
     or v_activation.provider_payment_id is distinct from v_attempt.provider_payment_id
     or v_activation.plan_id <> v_invoice.plan_id
     or v_activation.price_id <> v_invoice.price_id
     or v_activation.new_assignment_id is distinct from v_invoice.subscription_assignment_id
     or v_activation.metadata_json->>'captured_attempt_id' is distinct from v_attempt.id::text
     or v_order.plan_id <> v_invoice.plan_id
     or v_order.price_id <> v_invoice.price_id
     or v_order.total_amount_minor <> v_invoice.total_amount_minor
     or v_order.currency <> v_invoice.currency then
    raise exception 'Verified payment authority does not match the invoice.' using errcode = '22023';
  end if;

  insert into public.platform_billing_receipts (
    tenant_id, invoice_id, payment_order_id, payment_attempt_id,
    activation_event_id, receipt_number, source_key, status, amount_minor,
    currency, billing_snapshot, issuer_snapshot, plan_snapshot,
    payment_reference_snapshot, issued_at
  ) values (
    v_invoice.tenant_id, v_invoice.id, v_order.id, v_attempt.id,
    v_activation.id,
    coachfort_internal.next_platform_billing_document_number('receipt', p_issued_at),
    p_source_key, 'issued', v_invoice.total_amount_minor, v_invoice.currency,
    v_invoice.billing_snapshot, v_invoice.issuer_snapshot, v_invoice.plan_snapshot,
    jsonb_build_object(
      'provider', v_order.provider,
      'provider_order_id', v_order.provider_order_id,
      'provider_payment_id', v_attempt.provider_payment_id,
      'payment_order_id', v_order.id,
      'payment_attempt_id', v_attempt.id,
      'activation_event_id', v_activation.id
    ),
    coalesce(p_issued_at, now())
  ) returning id into v_receipt_id;

  return v_receipt_id;
end;
$$;

alter table public.platform_billing_issuer_profiles enable row level security;
alter table public.platform_billing_receipts enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

revoke all on table public.platform_billing_issuer_profiles from public, anon, authenticated, service_role;
revoke all on table public.platform_billing_receipts from public, anon, authenticated, service_role;
revoke all on table public.invoices from public, anon, authenticated, service_role;
revoke all on table public.invoice_items from public, anon, authenticated, service_role;
revoke all on table public.payment_transactions from public, anon, authenticated, service_role;
revoke all on sequence coachfort_internal.platform_invoice_number_seq from public, anon, authenticated, service_role;
revoke all on sequence coachfort_internal.platform_receipt_number_seq from public, anon, authenticated, service_role;

alter table public.platform_billing_issuer_profiles owner to postgres;
alter table public.platform_billing_receipts owner to postgres;
alter sequence coachfort_internal.platform_invoice_number_seq owner to postgres;
alter sequence coachfort_internal.platform_receipt_number_seq owner to postgres;
alter function public.configure_platform_billing_issuer_profile(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz) owner to postgres;
alter function coachfort_internal.next_platform_billing_document_number(text,timestamptz) owner to postgres;
alter function coachfort_internal.enforce_platform_billing_immutability() owner to postgres;
alter function coachfort_internal.enforce_platform_billing_item_immutability() owner to postgres;
alter function coachfort_internal.platform_billing_can_read_tenant(uuid) owner to postgres;
alter function public.get_platform_billing_documents(uuid) owner to postgres;
alter function public.get_platform_billing_document(uuid,text,uuid) owner to postgres;
alter function public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz) owner to postgres;
alter function public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz) owner to postgres;

revoke all on function coachfort_internal.next_platform_billing_document_number(text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_platform_billing_immutability() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_platform_billing_item_immutability() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.platform_billing_can_read_tenant(uuid) from public, anon, authenticated, service_role;
revoke all on function public.configure_platform_billing_issuer_profile(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_platform_billing_documents(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_platform_billing_document(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.get_platform_billing_documents(uuid) to authenticated;
grant execute on function public.get_platform_billing_document(uuid,text,uuid) to authenticated;
grant execute on function public.configure_platform_billing_issuer_profile(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with function_state as (
  select
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as identity,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,
    p.provolatile,
    p.proconfig,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.oid in (
    to_regprocedure('public.get_platform_billing_documents(uuid)'),
    to_regprocedure('public.get_platform_billing_document(uuid,text,uuid)'),
    to_regprocedure('public.configure_platform_billing_issuer_profile(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)'),
    to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'),
    to_regprocedure('public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'),
    to_regprocedure('coachfort_internal.next_platform_billing_document_number(text,timestamptz)'),
    to_regprocedure('coachfort_internal.enforce_platform_billing_immutability()'),
    to_regprocedure('coachfort_internal.enforce_platform_billing_item_immutability()'),
    to_regprocedure('coachfort_internal.platform_billing_can_read_tenant(uuid)')
  )
), function_overload_state as (
  select count(*) as value
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (
    ('coachfort_internal','next_platform_billing_document_number'),
    ('coachfort_internal','enforce_platform_billing_immutability'),
    ('coachfort_internal','enforce_platform_billing_item_immutability'),
    ('coachfort_internal','platform_billing_can_read_tenant'),
    ('public','configure_platform_billing_issuer_profile'),
    ('public','get_platform_billing_documents'),
    ('public','get_platform_billing_document'),
    ('public','issue_platform_subscription_invoice'),
    ('public','issue_platform_payment_receipt')
  )
), expected_constraints(table_name, constraint_name) as (
  values
    ('invoices','invoices_subscription_assignment_id_fkey'),
    ('invoices','invoices_plan_id_fkey'),
    ('invoices','invoices_price_id_fkey'),
    ('invoices','invoices_status_check'),
    ('invoices','invoices_currency_check'),
    ('invoices','invoices_billing_cycle_check'),
    ('invoices','invoices_source_key_check'),
    ('invoices','invoices_period_check'),
    ('invoices','invoices_due_after_issue_check'),
    ('invoices','invoices_minor_amounts_check'),
    ('invoices','invoices_tax_state_check'),
    ('invoices','invoices_legacy_amount_parity_check'),
    ('invoices','invoices_snapshot_shape_check'),
    ('invoices','invoices_snapshot_size_check'),
    ('invoices','invoices_void_state_check'),
    ('invoice_items','invoice_items_billing_cycle_check'),
    ('invoice_items','invoice_items_period_check'),
    ('invoice_items','invoice_items_minor_amounts_check'),
    ('invoice_items','invoice_items_tax_state_check'),
    ('invoice_items','invoice_items_legacy_amount_parity_check'),
    ('invoice_items','invoice_items_snapshot_shape_check'),
    ('invoice_items','invoice_items_snapshot_size_check'),
    ('platform_billing_receipts','platform_billing_receipts_pkey'),
    ('platform_billing_receipts','platform_billing_receipts_tenant_id_fkey'),
    ('platform_billing_receipts','platform_billing_receipts_invoice_id_fkey'),
    ('platform_billing_receipts','platform_billing_receipts_payment_order_id_fkey'),
    ('platform_billing_receipts','platform_billing_receipts_payment_attempt_id_fkey'),
    ('platform_billing_receipts','platform_billing_receipts_activation_event_id_fkey'),
    ('platform_billing_receipts','platform_billing_receipts_number_key'),
    ('platform_billing_receipts','platform_billing_receipts_source_key_key'),
    ('platform_billing_receipts','platform_billing_receipts_invoice_key'),
    ('platform_billing_receipts','platform_billing_receipts_payment_attempt_key'),
    ('platform_billing_receipts','platform_billing_receipts_activation_event_key'),
    ('platform_billing_receipts','platform_billing_receipts_status_check'),
    ('platform_billing_receipts','platform_billing_receipts_currency_check'),
    ('platform_billing_receipts','platform_billing_receipts_amount_check'),
    ('platform_billing_receipts','platform_billing_receipts_source_key_check'),
    ('platform_billing_receipts','platform_billing_receipts_snapshot_shape_check'),
    ('platform_billing_receipts','platform_billing_receipts_snapshot_size_check'),
    ('platform_billing_receipts','platform_billing_receipts_void_state_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_pkey'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_singleton_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_country_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_tax_type_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_tax_id_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_status_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_text_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_effective_check')
), constraints_state as (
  select
    e.table_name,
    e.constraint_name,
    c.contype,
    pg_get_constraintdef(c.oid) as definition,
    c.oid is not null as installed
  from expected_constraints e
  left join pg_constraint c
    on c.conrelid = to_regclass(format('public.%I', e.table_name))
   and c.conname = e.constraint_name
), browser_write_grants as (
  select count(*) as value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('invoices','invoice_items','platform_billing_receipts','platform_billing_issuer_profiles')
    and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE')
), browser_direct_grants as (
  select count(*) as value
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('invoices','invoice_items','platform_billing_receipts','platform_billing_issuer_profiles')
    and grantee in ('PUBLIC','anon','authenticated')
), payment_transactions_grants as (
  select
    count(*) filter (
      where grantee in ('PUBLIC','anon','authenticated')
    ) as browser_direct,
    count(*) filter (
      where grantee in ('PUBLIC','anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
    ) as browser_destructive_or_write,
    count(*) filter (
      where grantee = 'authenticated' and privilege_type = 'SELECT'
    ) as authenticated_select,
    count(*) filter (where grantee = 'service_role') as service_role_direct
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'payment_transactions'
    and grantee in ('PUBLIC','anon','authenticated','service_role')
), browser_internal_execute as (
  select count(*) as value
  from function_state
  where identity like 'coachfort_internal.%'
    and (public_execute or anon_execute or authenticated_execute)
), object_state as (
  select jsonb_build_object(
    'issuer_table', to_regclass('public.platform_billing_issuer_profiles') is not null,
    'receipt_table', to_regclass('public.platform_billing_receipts') is not null,
    'invoice_sequence', to_regclass('coachfort_internal.platform_invoice_number_seq') is not null,
    'receipt_sequence', to_regclass('coachfort_internal.platform_receipt_number_seq') is not null,
    'invoice_rls', (select relrowsecurity from pg_class where oid = 'public.invoices'::regclass),
    'invoice_items_rls', (select relrowsecurity from pg_class where oid = 'public.invoice_items'::regclass),
    'receipts_rls', (select relrowsecurity from pg_class where oid = 'public.platform_billing_receipts'::regclass),
    'issuer_rls', (select relrowsecurity from pg_class where oid = 'public.platform_billing_issuer_profiles'::regclass),
    'invoice_source_unique', exists (
      select 1 from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.invoices'::regclass and i.indisunique and i.indisvalid and i.indisready
        and i.indnkeyatts = 1 and a.attname = 'source_key'
    ),
    'invoice_number_unique', exists (
      select 1 from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.invoices'::regclass and i.indisunique and i.indisvalid and i.indisready
        and i.indnkeyatts = 1 and a.attname = 'invoice_number'
    ),
    'receipt_source_unique', exists(select 1 from pg_constraint where conrelid = 'public.platform_billing_receipts'::regclass and conname = 'platform_billing_receipts_source_key_key' and contype = 'u'),
    'receipt_number_unique', exists(select 1 from pg_constraint where conrelid = 'public.platform_billing_receipts'::regclass and conname = 'platform_billing_receipts_number_key' and contype = 'u'),
    'receipt_invoice_unique', exists(select 1 from pg_constraint where conrelid = 'public.platform_billing_receipts'::regclass and conname = 'platform_billing_receipts_invoice_key' and contype = 'u'),
    'receipt_payment_attempt_unique', exists(select 1 from pg_constraint where conrelid = 'public.platform_billing_receipts'::regclass and conname = 'platform_billing_receipts_payment_attempt_key' and contype = 'u'),
    'receipt_activation_event_unique', exists(select 1 from pg_constraint where conrelid = 'public.platform_billing_receipts'::regclass and conname = 'platform_billing_receipts_activation_event_key' and contype = 'u'),
    'invoice_immutability_trigger', exists(select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'enforce_invoices_immutability' and tgfoid = to_regprocedure('coachfort_internal.enforce_platform_billing_immutability()') and not tgisinternal and tgenabled <> 'D'),
    'item_immutability_trigger', exists(select 1 from pg_trigger where tgrelid = 'public.invoice_items'::regclass and tgname = 'enforce_invoice_items_immutability' and tgfoid = to_regprocedure('coachfort_internal.enforce_platform_billing_item_immutability()') and not tgisinternal and tgenabled <> 'D'),
    'receipt_immutability_trigger', exists(select 1 from pg_trigger where tgrelid = 'public.platform_billing_receipts'::regclass and tgname = 'enforce_platform_billing_receipts_immutability' and tgfoid = to_regprocedure('coachfort_internal.enforce_platform_billing_immutability()') and not tgisinternal and tgenabled <> 'D')
  ) as value
), object_gate as (
  select coalesce(bool_and(entry.value::boolean), false) as value
  from object_state, lateral jsonb_each_text(object_state.value) entry
), constraint_semantics as (
  select
    (select count(*) from constraints_state where constraint_name = 'invoices_status_check' and definition ilike '%issued%' and definition ilike '%void%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_currency_check' and definition ilike '%INR%' and definition ilike '%EUR%' and definition ilike '%USD%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_billing_cycle_check' and definition ilike '%monthly%' and definition ilike '%yearly%' and definition ilike '%custom%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_source_key_check' and definition ilike '%char_length%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_period_check' and definition ilike '%period_start%' and definition ilike '%period_end%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_due_after_issue_check' and definition ilike '%due_at%' and definition ilike '%issued_at%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_minor_amounts_check' and definition ilike '%coalesce%' and definition ilike '%tax_amount_minor%' and definition ilike '%total_amount_minor%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_tax_state_check' and definition ilike '%not_calculated%' and definition ilike '%not_applicable%' and definition ilike '%calculated%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_legacy_amount_parity_check' and definition ilike '%tax_amount_minor is null%' and definition ilike '%tax_amount%' and definition ilike '%total_amount_minor%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_snapshot_shape_check' and definition ilike '%billing_snapshot%' and definition ilike '%issuer_snapshot%' and definition ilike '%plan_snapshot%' and definition ilike '%tax_calculation_status%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_snapshot_size_check' and definition ilike '%char_length%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoices_void_state_check' and definition ilike '%voided_at%' and definition ilike '%void_reason%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoice_items_minor_amounts_check' and definition ilike '%coalesce%' and definition ilike '%tax_amount_minor%' and definition ilike '%line_total_minor%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoice_items_tax_state_check' and definition ilike '%not_calculated%' and definition ilike '%not_applicable%' and definition ilike '%calculated%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoice_items_legacy_amount_parity_check' and definition ilike '%unit_price%' and definition ilike '%line_total%') = 1
    and (select count(*) from constraints_state where constraint_name = 'invoice_items_snapshot_shape_check' and definition ilike '%tax_calculation_status%') = 1
    and (select count(*) from constraints_state where table_name = 'platform_billing_receipts' and contype = 'u') = 5
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_receipts_status_check' and definition ilike '%issued%' and definition ilike '%void%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_receipts_currency_check' and definition ilike '%INR%' and definition ilike '%EUR%' and definition ilike '%USD%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_receipts_amount_check' and definition ilike '%amount_minor%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_receipts_source_key_check' and definition ilike '%char_length%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_receipts_snapshot_shape_check' and definition ilike '%payment_reference_snapshot%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_receipts_snapshot_size_check' and definition ilike '%char_length%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_receipts_void_state_check' and definition ilike '%voided_at%' and definition ilike '%void_reason%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_issuer_profiles_singleton_check' and definition ilike '%default%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_issuer_profiles_country_check' and definition ilike '%country%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_issuer_profiles_tax_type_check' and definition ilike '%GSTIN%' and definition ilike '%VAT%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_issuer_profiles_tax_id_check' and definition ilike '%tax_id%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_issuer_profiles_status_check' and definition ilike '%active%' and definition ilike '%inactive%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_issuer_profiles_text_check' and definition ilike '%billing_email%') = 1
    and (select count(*) from constraints_state where constraint_name = 'platform_billing_issuer_profiles_effective_check' and definition ilike '%effective_from%' and definition ilike '%updated_at%') = 1
    as value
), unchanged_counts as (
  select jsonb_build_object(
    'platform_invoices', (select count(*) from public.invoices),
    'platform_receipts', (select count(*) from public.platform_billing_receipts),
    'legacy_payment_transactions', (select count(*) from public.payment_transactions),
    'student_finance_invoices', (select count(*) from public.finance_invoices),
    'student_finance_payments', (select count(*) from public.finance_payments),
    'student_finance_receipts', (select count(*) from public.finance_receipts),
    'issuer_profiles', (select count(*) from public.platform_billing_issuer_profiles),
    'subscription_plan_prices', (select count(*) from public.subscription_plan_prices),
    'subscription_assignments', (select count(*) from public.tenant_subscription_assignments),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'activation_events', (select count(*) from public.tenant_plan_activation_events)
  ) as value
), gates as (
  select
    (select count(*) from function_state) = 9
      and (select value from function_overload_state) = 9 as expected_functions,
    not exists (
      select 1 from function_state
      where owner <> 'postgres'
        or not security_definer
        or not ('search_path=public, pg_temp' = any(coalesce(proconfig, array[]::text[])))
        or public_execute or anon_execute
        or (
          (identity like 'public.get_platform_billing_%' or identity like 'coachfort_internal.platform_billing_can_read_tenant%')
          and provolatile <> 's'
        )
        or (
          identity not like 'public.get_platform_billing_%'
          and identity not like 'coachfort_internal.platform_billing_can_read_tenant%'
          and provolatile <> 'v'
        )
    ) as function_security,
    (select count(*) from function_state where identity like 'public.get_platform_billing_%' and authenticated_execute and not service_role_execute) = 2 as read_acl,
    (select count(*) from function_state
      where (identity like 'public.issue_platform_%' or identity like 'public.configure_platform_billing_issuer_profile%')
        and service_role_execute and not authenticated_execute) = 3 as service_acl,
    not exists (
      select 1 from function_state
      where identity like 'coachfort_internal.%'
        and (public_execute or anon_execute or authenticated_execute or service_role_execute)
    ) as internal_acl,
    (select value from browser_write_grants) = 0 as browser_writes_closed,
    (select value from browser_direct_grants) = 0 as direct_grants_closed,
    (select browser_direct = 0
      and browser_destructive_or_write = 0
      and authenticated_select = 0
      and service_role_direct = 0
      from payment_transactions_grants) as legacy_payment_grants_closed,
    (select value from browser_internal_execute) = 0 as internal_execution_closed,
    (select value from object_gate) as object_contract,
    not exists (select 1 from constraints_state where not installed or definition is null) as integrity_constraints,
    (select value from constraint_semantics) as integrity_semantics,
    (select count(*) from public.invoices) = 0
      and (select count(*) from public.platform_billing_receipts) = 0
      and (select count(*) from public.platform_billing_issuer_profiles) = 0
      and (select count(*) from public.payment_transactions) = 0 as no_values_created,
    to_regclass('public.finance_invoices') is not null
      and to_regclass('public.finance_payments') is not null
      and to_regclass('public.finance_receipts') is not null as student_finance_preserved,
    to_regclass('public.payment_transactions') is not null
      and to_regclass('public.tenant_payment_orders') is not null
      and to_regclass('public.tenant_payment_attempts') is not null
      and to_regclass('public.tenant_plan_activation_events') is not null
      and to_regclass('public.subscription_plan_prices') is not null
      and to_regclass('public.tenant_subscription_assignments') is not null as payment_architecture_preserved,
    not exists (
      select 1
      from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
      where btrim(exposed.schema_name) = 'coachfort_internal'
    ) as internal_schema_safe
)
select jsonb_build_object(
  'security_gate', coalesce(expected_functions and function_security and read_acl and service_acl
    and internal_acl and browser_writes_closed and direct_grants_closed and internal_execution_closed
    and legacy_payment_grants_closed
    and object_contract and integrity_constraints and integrity_semantics and no_values_created and student_finance_preserved
    and payment_architecture_preserved and internal_schema_safe, false),
  'functions', (select jsonb_agg(to_jsonb(function_state) order by identity) from function_state),
  'objects', (select value from object_state),
  'browser_write_grants', (select value from browser_write_grants),
  'browser_direct_grants', (select value from browser_direct_grants),
  'payment_transactions_grants', (select to_jsonb(payment_transactions_grants) from payment_transactions_grants),
  'browser_internal_execute', (select value from browser_internal_execute),
  'integrity_constraints', (select jsonb_agg(to_jsonb(constraints_state) order by table_name, constraint_name) from constraints_state),
  'unchanged_counts', (select value from unchanged_counts),
  'gates', (select to_jsonb(gates) from gates),
  'internal_schema_exposed', exists (
    select 1
    from unnest(string_to_array(coalesce(current_setting('pgrst.db_schemas', true), ''), ',')) exposed(schema_name)
    where btrim(exposed.schema_name) = 'coachfort_internal'
  )
)
from gates;
*/
