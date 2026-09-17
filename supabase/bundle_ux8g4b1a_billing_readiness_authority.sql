-- Bundle UX-8G4B1A: Canonical Billing Readiness Authority
-- Review-only migration. Do not execute until PRE/APPLY/POST review is complete.

/*
PRE-APPLY READ-ONLY VERIFICATION

with expected_columns(table_name, column_name) as (
  values
    ('platform_billing_issuer_profiles','profile_key'),
    ('platform_billing_issuer_profiles','legal_name'),
    ('platform_billing_issuer_profiles','billing_email'),
    ('platform_billing_issuer_profiles','billing_phone'),
    ('platform_billing_issuer_profiles','address_line1'),
    ('platform_billing_issuer_profiles','address_line2'),
    ('platform_billing_issuer_profiles','city'),
    ('platform_billing_issuer_profiles','state'),
    ('platform_billing_issuer_profiles','postal_code'),
    ('platform_billing_issuer_profiles','country'),
    ('platform_billing_issuer_profiles','tax_registration_type'),
    ('platform_billing_issuer_profiles','tax_id'),
    ('platform_billing_issuer_profiles','status'),
    ('platform_billing_issuer_profiles','effective_from'),
    ('platform_billing_issuer_profiles','updated_at'),
    ('tenant_billing_profiles','tenant_id'),
    ('tenant_billing_profiles','legal_name'),
    ('tenant_billing_profiles','billing_email'),
    ('tenant_billing_profiles','billing_phone'),
    ('tenant_billing_profiles','invoice_contact_name'),
    ('tenant_billing_profiles','address_line1'),
    ('tenant_billing_profiles','address_line2'),
    ('tenant_billing_profiles','city'),
    ('tenant_billing_profiles','state'),
    ('tenant_billing_profiles','postal_code'),
    ('tenant_billing_profiles','country'),
    ('tenant_billing_profiles','preferred_currency'),
    ('tenant_billing_profiles','tax_registration_type'),
    ('tenant_billing_profiles','tax_id'),
    ('tenant_billing_profiles','updated_at'),
    ('tenant_payment_orders','billing_snapshot'),
    ('tenant_payment_orders','issuer_snapshot'),
    ('tenant_payment_orders','plan_snapshot'),
    ('invoices','billing_snapshot'),
    ('invoices','issuer_snapshot'),
    ('invoices','plan_snapshot'),
    ('platform_billing_receipts','billing_snapshot'),
    ('platform_billing_receipts','issuer_snapshot'),
    ('platform_billing_receipts','plan_snapshot')
), column_state as (
  select
    count(*) expected_count,
    count(column_def.column_name) installed_count
  from expected_columns expected
  left join information_schema.columns column_def
    on column_def.table_schema = 'public'
   and column_def.table_name = expected.table_name
   and column_def.column_name = expected.column_name
), expected_constraints(table_name, constraint_name) as (
  values
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_pkey'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_singleton_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_country_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_tax_type_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_tax_id_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_status_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_text_check'),
    ('platform_billing_issuer_profiles','platform_billing_issuer_profiles_effective_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_legal_name_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_billing_email_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_address_line1_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_city_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_postal_code_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_country_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_preferred_currency_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_country_currency_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_tax_registration_type_check'),
    ('tenant_billing_profiles','tenant_billing_profiles_tax_id_type_check'),
    ('tenant_payment_orders','tenant_payment_orders_frozen_snapshot_shape_check'),
    ('invoices','invoices_snapshot_shape_check'),
    ('platform_billing_receipts','platform_billing_receipts_snapshot_shape_check')
), constraint_state as (
  select
    count(*) expected_count,
    count(constraint_def.oid) installed_count
  from expected_constraints expected
  left join pg_catalog.pg_constraint constraint_def
    on constraint_def.conrelid = to_regclass('public.' || expected.table_name)
   and constraint_def.conname = expected.constraint_name
), profile_authority_state as (
  select
    exists (
      select 1
      from pg_constraint constraint_def
      join pg_index backing_index on backing_index.indexrelid = constraint_def.conindid
      where constraint_def.conrelid = to_regclass('public.platform_billing_issuer_profiles')
        and constraint_def.contype in ('p','u')
        and constraint_def.convalidated
        and backing_index.indisunique
        and backing_index.indisvalid
        and backing_index.indisready
        and backing_index.indpred is null
        and backing_index.indexprs is null
        and (
          select array_agg(attribute.attname order by key_column.ordinality)
          from unnest(constraint_def.conkey) with ordinality key_column(attnum, ordinality)
          join pg_attribute attribute
            on attribute.attrelid = constraint_def.conrelid
           and attribute.attnum = key_column.attnum
        ) = array['profile_key']::name[]
    ) issuer_profile_key_unique,
    exists (
      select 1
      from pg_constraint constraint_def
      join pg_index backing_index on backing_index.indexrelid = constraint_def.conindid
      where constraint_def.conrelid = to_regclass('public.tenant_billing_profiles')
        and constraint_def.contype in ('p','u')
        and constraint_def.convalidated
        and backing_index.indisunique
        and backing_index.indisvalid
        and backing_index.indisready
        and backing_index.indpred is null
        and backing_index.indexprs is null
        and (
          select array_agg(attribute.attname order by key_column.ordinality)
          from unnest(constraint_def.conkey) with ordinality key_column(attnum, ordinality)
          join pg_attribute attribute
            on attribute.attrelid = constraint_def.conrelid
           and attribute.attnum = key_column.attnum
        ) = array['tenant_id']::name[]
    ) tenant_billing_profile_tenant_unique,
    exists (
      select 1
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_billing_issuer_profiles')
        and constraint_def.contype = 'c'
        and constraint_def.convalidated
        and regexp_replace(
          lower(pg_get_expr(constraint_def.conbin, constraint_def.conrelid)),
          '[[:space:]()]', '', 'g'
        ) = 'profile_key=''default''::text'
    ) issuer_singleton_default_contract
), profile_duplicate_state as (
  select
    (
      select count(*)
      from (
        select profile.profile_key
        from public.platform_billing_issuer_profiles profile
        group by profile.profile_key
        having count(*) > 1
      ) duplicate_key
    ) issuer_duplicate_key_count,
    (
      select count(*)
      from (
        select profile.tenant_id
        from public.tenant_billing_profiles profile
        group by profile.tenant_id
        having count(*) > 1
      ) duplicate_key
    ) tenant_billing_duplicate_tenant_count
), snapshot_shape_state as (
  select
    (
      select lower(pg_get_constraintdef(constraint_def.oid))
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.tenant_payment_orders')
        and constraint_def.conname = 'tenant_payment_orders_frozen_snapshot_shape_check'
        and constraint_def.contype = 'c'
    ) order_definition,
    (
      select lower(pg_get_constraintdef(constraint_def.oid))
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.invoices')
        and constraint_def.conname = 'invoices_snapshot_shape_check'
        and constraint_def.contype = 'c'
    ) invoice_definition,
    (
      select lower(pg_get_constraintdef(constraint_def.oid))
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_billing_receipts')
        and constraint_def.conname = 'platform_billing_receipts_snapshot_shape_check'
        and constraint_def.contype = 'c'
    ) receipt_definition
), expected_functions(identity) as (
  values
    ('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
    ('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
    ('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'),
    ('public.issue_platform_invoice_for_activation_server(uuid)'),
    ('public.issue_platform_receipt_for_fulfillment_server(uuid)'),
    ('public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'),
    ('public.get_tenant_billing_profile_completion(uuid)'),
    ('public.billing_profile_currency_for_country(text)')
), function_state as (
  select
    expected.identity,
    procedure.oid,
    pg_get_userbyid(procedure.proowner) owner_name,
    procedure.prosecdef security_definer,
    procedure.proconfig,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE') service_role_execute,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE') authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_execute,
    exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) public_execute
  from expected_functions expected
  left join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
), source_state as (
  select
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'
    )), '[[:space:]]+', ' ', 'g')) initial_order_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'
    )), '[[:space:]]+', ' ', 'g')) renewal_order_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'
    )), '[[:space:]]+', ' ', 'g')) live_invoice_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_invoice_for_activation_server(uuid)'
    )), '[[:space:]]+', ' ', 'g')) activation_invoice_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_receipt_for_fulfillment_server(uuid)'
    )), '[[:space:]]+', ' ', 'g')) fulfillment_receipt_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'
    )), '[[:space:]]+', ' ', 'g')) payment_receipt_source
), acl_state as (
  select count(*) browser_write_grants
  from information_schema.table_privileges grant_state
  where grant_state.table_schema = 'public'
    and grant_state.table_name in (
      'platform_billing_issuer_profiles','tenant_billing_profiles',
      'tenant_payment_orders','tenant_payment_attempts',
      'tenant_plan_activation_events','tenant_subscription_assignments',
      'tenant_subscription_change_intents','subscription_plan_prices',
      'invoices','invoice_items',
      'platform_billing_receipts'
    )
    and grant_state.grantee in ('PUBLIC','anon','authenticated')
    and grant_state.privilege_type in (
      'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
    )
), gates as (
  select
    to_regnamespace('coachfort_internal') is not null private_schema_present,
    column_state.expected_count = column_state.installed_count column_contract,
    constraint_state.expected_count = constraint_state.installed_count constraint_contract,
    profile_authority_state.issuer_profile_key_unique,
    profile_authority_state.tenant_billing_profile_tenant_unique,
    profile_authority_state.issuer_singleton_default_contract,
    profile_duplicate_state.issuer_duplicate_key_count,
    profile_duplicate_state.tenant_billing_duplicate_tenant_count,
    snapshot_shape_state.order_definition is not null
      and snapshot_shape_state.order_definition like all (array[
        '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
        '%legal_name%','%billing_email%','%billing_phone%','%invoice_contact_name%',
        '%address_line1%','%address_line2%','%city%','%state%','%postal_code%',
        '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%',
        '%profile_updated_at%','%effective_from%'
      ]::text[])
      and snapshot_shape_state.invoice_definition is not null
      and snapshot_shape_state.invoice_definition like all (array[
        '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
        '%legal_name%','%billing_email%','%address_line1%','%city%','%postal_code%',
        '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%'
      ]::text[])
      and snapshot_shape_state.receipt_definition is not null
      and snapshot_shape_state.receipt_definition like all (array[
        '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
        '%legal_name%','%billing_email%','%address_line1%','%city%','%postal_code%',
        '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%'
      ]::text[])
      snapshot_shape_contract,
    (select count(*) from function_state where oid is not null) = 8 function_contract,
    not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'create_platform_payment_order_authority_server',
          'create_platform_renewal_payment_order_authority_server',
          'issue_platform_subscription_invoice'
        )
        and procedure.oid not in (
          to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
          to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
          to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)')
        )
    ) exact_live_authority_identities,
    not exists (
      select 1 from function_state
      where identity in (
        'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',
        'public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)',
        'public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)',
        'public.issue_platform_invoice_for_activation_server(uuid)',
        'public.issue_platform_receipt_for_fulfillment_server(uuid)',
        'public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'
      ) and (
        owner_name <> 'postgres'
        or not security_definer
        or not coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']
        or not service_role_execute
        or authenticated_execute
        or anon_execute
        or public_execute
      )
    ) financial_function_security,
    source_state.initial_order_source like '%from public.tenant_billing_profiles%'
      and source_state.initial_order_source like '%from public.platform_billing_issuer_profiles%'
      and source_state.initial_order_source not like '%assert_platform_billing_readiness%'
      and source_state.renewal_order_source like '%from public.tenant_billing_profiles%'
      and source_state.renewal_order_source like '%from public.platform_billing_issuer_profiles%'
      and source_state.renewal_order_source not like '%assert_platform_billing_readiness%'
      and source_state.live_invoice_source like '%from public.tenant_billing_profiles%'
      and source_state.live_invoice_source like '%from public.platform_billing_issuer_profiles%'
      and source_state.live_invoice_source not like '%assert_platform_billing_readiness%'
      duplicated_live_readiness_present,
    source_state.activation_invoice_source like '%v_order.billing_snapshot%'
      and source_state.activation_invoice_source like '%v_order.issuer_snapshot%'
      and source_state.activation_invoice_source not like '%platform_billing_issuer_profiles%'
      and source_state.fulfillment_receipt_source like '%issue_platform_payment_receipt%'
      and source_state.payment_receipt_source like '%v_invoice.billing_snapshot%'
      and source_state.payment_receipt_source like '%v_invoice.issuer_snapshot%'
      snapshot_boundary_present,
    not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where (namespace.nspname, procedure.proname) in (
        ('coachfort_internal','resolve_platform_billing_readiness'),
        ('coachfort_internal','assert_platform_billing_readiness'),
        ('public','get_platform_billing_readiness_server')
      )
    ) clean_install_state,
    acl_state.browser_write_grants = 0 browser_writes_absent
  from column_state
  cross join constraint_state
  cross join profile_authority_state
  cross join profile_duplicate_state
  cross join snapshot_shape_state
  cross join source_state
  cross join acl_state
)
select
  gates.*,
  jsonb_build_object(
    'issuer_profiles', (select count(*) from public.platform_billing_issuer_profiles),
    'tenant_billing_profiles', (select count(*) from public.tenant_billing_profiles),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'webhook_events', (select count(*) from public.razorpay_webhook_events),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'assignments', (select count(*) from public.tenant_subscription_assignments),
    'change_intents', (select count(*) from public.tenant_subscription_change_intents),
    'invoices', (select count(*) from public.invoices),
    'receipts', (select count(*) from public.platform_billing_receipts)
  ) protected_row_counts,
  gates.private_schema_present
    and gates.column_contract
    and gates.constraint_contract
    and gates.issuer_profile_key_unique
    and gates.tenant_billing_profile_tenant_unique
    and gates.issuer_singleton_default_contract
    and gates.issuer_duplicate_key_count = 0
    and gates.tenant_billing_duplicate_tenant_count = 0
    and gates.snapshot_shape_contract
    and gates.function_contract
    and gates.exact_live_authority_identities
    and gates.financial_function_security
    and gates.duplicated_live_readiness_present
    and gates.snapshot_boundary_present
    and gates.clean_install_state
    and gates.browser_writes_absent
    ready_for_apply
from gates;
*/

begin;

do $$
declare
  v_initial_source text;
  v_renewal_source text;
  v_invoice_source text;
  v_activation_invoice_source text;
  v_receipt_source text;
  v_order_snapshot_definition text;
  v_invoice_snapshot_definition text;
  v_receipt_snapshot_definition text;
begin
  if to_regnamespace('coachfort_internal') is null
     or to_regclass('public.platform_billing_issuer_profiles') is null
     or to_regclass('public.tenant_billing_profiles') is null
     or to_regclass('public.tenant_payment_orders') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.platform_billing_receipts') is null then
    raise exception 'UX-8G4B1A billing prerequisites are missing.' using errcode = 'P0001';
  end if;

  if to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)') is null
     or to_regprocedure('public.issue_platform_invoice_for_activation_server(uuid)') is null
     or to_regprocedure('public.issue_platform_receipt_for_fulfillment_server(uuid)') is null
     or to_regprocedure('public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)') is null
     or to_regprocedure('public.get_tenant_billing_profile_completion(uuid)') is null
     or to_regprocedure('public.billing_profile_currency_for_country(text)') is null then
    raise exception 'UX-8G4B1A function prerequisites are missing.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'create_platform_payment_order_authority_server',
        'create_platform_renewal_payment_order_authority_server',
        'issue_platform_subscription_invoice'
      )
      and procedure.oid not in (
        to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
        to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
        to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)')
      )
  ) then
    raise exception 'UX-8G4B1A live authority overloads require review.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where (namespace.nspname, procedure.proname) in (
      ('coachfort_internal','resolve_platform_billing_readiness'),
      ('coachfort_internal','assert_platform_billing_readiness'),
      ('public','get_platform_billing_readiness_server')
    )
  ) then
    raise exception 'A partial UX-8G4B1A installation already exists.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges grant_state
    where grant_state.table_schema = 'public'
      and grant_state.table_name in (
        'platform_billing_issuer_profiles','tenant_billing_profiles',
        'tenant_payment_orders','tenant_payment_attempts',
        'tenant_plan_activation_events','tenant_subscription_assignments',
        'tenant_subscription_change_intents','subscription_plan_prices',
        'invoices','invoice_items','platform_billing_receipts'
      )
      and grant_state.grantee in ('PUBLIC','anon','authenticated')
      and grant_state.privilege_type in (
        'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
      )
  ) then
    raise exception 'UX-8G4B1A browser financial-table authority is unsafe.' using errcode = 'P0001';
  end if;

  v_initial_source := lower(pg_get_functiondef(to_regprocedure(
    'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'
  )));
  v_renewal_source := lower(pg_get_functiondef(to_regprocedure(
    'public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'
  )));
  v_invoice_source := lower(pg_get_functiondef(to_regprocedure(
    'public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'
  )));
  v_activation_invoice_source := lower(pg_get_functiondef(to_regprocedure(
    'public.issue_platform_invoice_for_activation_server(uuid)'
  )));
  v_receipt_source := lower(pg_get_functiondef(to_regprocedure(
    'public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'
  )));

  if v_initial_source not like '%from public.tenant_billing_profiles%'
     or v_initial_source not like '%from public.platform_billing_issuer_profiles%'
     or v_renewal_source not like '%from public.tenant_billing_profiles%'
     or v_renewal_source not like '%from public.platform_billing_issuer_profiles%'
     or v_invoice_source not like '%from public.tenant_billing_profiles%'
     or v_invoice_source not like '%from public.platform_billing_issuer_profiles%'
     or v_activation_invoice_source not like '%v_order.billing_snapshot%'
     or v_activation_invoice_source not like '%v_order.issuer_snapshot%'
     or v_receipt_source not like '%v_invoice.billing_snapshot%'
     or v_receipt_source not like '%v_invoice.issuer_snapshot%' then
    raise exception 'UX-8G4B1A authority source drift requires review.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_def
    join pg_index backing_index on backing_index.indexrelid = constraint_def.conindid
    where constraint_def.conrelid = to_regclass('public.platform_billing_issuer_profiles')
      and constraint_def.contype in ('p','u')
      and constraint_def.convalidated
      and backing_index.indisunique and backing_index.indisvalid and backing_index.indisready
      and backing_index.indpred is null and backing_index.indexprs is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(constraint_def.conkey) with ordinality key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = constraint_def.conrelid
         and attribute.attnum = key_column.attnum
      ) = array['profile_key']::name[]
  ) or not exists (
    select 1
    from pg_constraint constraint_def
    join pg_index backing_index on backing_index.indexrelid = constraint_def.conindid
    where constraint_def.conrelid = to_regclass('public.tenant_billing_profiles')
      and constraint_def.contype in ('p','u')
      and constraint_def.convalidated
      and backing_index.indisunique and backing_index.indisvalid and backing_index.indisready
      and backing_index.indpred is null and backing_index.indexprs is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(constraint_def.conkey) with ordinality key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = constraint_def.conrelid
         and attribute.attnum = key_column.attnum
      ) = array['tenant_id']::name[]
  ) or not exists (
    select 1
    from pg_constraint constraint_def
    where constraint_def.conrelid = to_regclass('public.platform_billing_issuer_profiles')
      and constraint_def.contype = 'c'
      and constraint_def.convalidated
      and regexp_replace(
        lower(pg_get_expr(constraint_def.conbin, constraint_def.conrelid)),
        '[[:space:]()]', '', 'g'
      ) = 'profile_key=''default''::text'
  ) or exists (
    select 1 from public.platform_billing_issuer_profiles profile
    group by profile.profile_key having count(*) > 1
  ) or exists (
    select 1 from public.tenant_billing_profiles profile
    group by profile.tenant_id having count(*) > 1
  ) then
    raise exception 'UX-8G4B1A billing profile uniqueness authority has drifted.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenant_billing_profiles'::regclass
      and conname = 'tenant_billing_profiles_country_currency_check'
      and convalidated
  ) then
    raise exception 'UX-8G4B1A readiness constraints have drifted.' using errcode = 'P0001';
  end if;

  select lower(pg_get_constraintdef(constraint_def.oid))
  into v_order_snapshot_definition
  from pg_constraint constraint_def
  where constraint_def.conrelid = to_regclass('public.tenant_payment_orders')
    and constraint_def.conname = 'tenant_payment_orders_frozen_snapshot_shape_check'
    and constraint_def.contype = 'c' and constraint_def.convalidated;
  select lower(pg_get_constraintdef(constraint_def.oid))
  into v_invoice_snapshot_definition
  from pg_constraint constraint_def
  where constraint_def.conrelid = to_regclass('public.invoices')
    and constraint_def.conname = 'invoices_snapshot_shape_check'
    and constraint_def.contype = 'c' and constraint_def.convalidated;
  select lower(pg_get_constraintdef(constraint_def.oid))
  into v_receipt_snapshot_definition
  from pg_constraint constraint_def
  where constraint_def.conrelid = to_regclass('public.platform_billing_receipts')
    and constraint_def.conname = 'platform_billing_receipts_snapshot_shape_check'
    and constraint_def.contype = 'c' and constraint_def.convalidated;

  if v_order_snapshot_definition is null
     or not (v_order_snapshot_definition like all (array[
       '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
       '%legal_name%','%billing_email%','%billing_phone%','%invoice_contact_name%',
       '%address_line1%','%address_line2%','%city%','%state%','%postal_code%',
       '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%',
       '%profile_updated_at%','%effective_from%'
     ]::text[]))
     or v_invoice_snapshot_definition is null
     or not (v_invoice_snapshot_definition like all (array[
       '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
       '%legal_name%','%billing_email%','%address_line1%','%city%','%postal_code%',
       '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%'
     ]::text[]))
     or v_receipt_snapshot_definition is null
     or not (v_receipt_snapshot_definition like all (array[
       '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
       '%legal_name%','%billing_email%','%address_line1%','%city%','%postal_code%',
       '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%'
     ]::text[])) then
    raise exception 'UX-8G4B1A snapshot-shape authority has drifted.' using errcode = 'P0001';
  end if;
end;
$$;

create temp table ux8g4b1a_protected_baseline on commit drop as
select
  jsonb_build_object(
    'issuer_profiles', (select count(*) from public.platform_billing_issuer_profiles),
    'tenant_billing_profiles', (select count(*) from public.tenant_billing_profiles),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'webhook_events', (select count(*) from public.razorpay_webhook_events),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'assignments', (select count(*) from public.tenant_subscription_assignments),
    'change_intents', (select count(*) from public.tenant_subscription_change_intents),
    'invoices', (select count(*) from public.invoices),
    'invoice_items', (select count(*) from public.invoice_items),
    'receipts', (select count(*) from public.platform_billing_receipts)
  ) row_counts,
  jsonb_build_object(
    'activation_invoice', md5(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_invoice_for_activation_server(uuid)'
    ))),
    'fulfillment_receipt', md5(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_receipt_for_fulfillment_server(uuid)'
    ))),
    'payment_receipt', md5(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'
    ))),
    'completion_helper', md5(pg_get_functiondef(to_regprocedure(
      'public.get_tenant_billing_profile_completion(uuid)'
    )))
  ) protected_function_fingerprints;

create function coachfort_internal.resolve_platform_billing_readiness(
  p_tenant_id uuid,
  p_expected_currency text,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.tenant_billing_profiles%rowtype;
  v_issuer public.platform_billing_issuer_profiles%rowtype;
  v_expected_currency text := upper(nullif(btrim(coalesce(p_expected_currency, '')), ''));
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_customer_country_currency text;
  v_issuer_country_currency text;
  v_issuer_missing text[] := array[]::text[];
  v_issuer_invalid text[] := array[]::text[];
  v_customer_missing text[] := array[]::text[];
  v_customer_invalid text[] := array[]::text[];
  v_currency_ready boolean;
  v_issuer_ready boolean;
  v_customer_ready boolean;
  v_billing_snapshot jsonb;
  v_issuer_snapshot jsonb;
begin
  select * into v_profile
  from public.tenant_billing_profiles profile
  where profile.tenant_id = p_tenant_id;

  select * into v_issuer
  from public.platform_billing_issuer_profiles issuer
  where issuer.profile_key = 'default';

  v_currency_ready := coalesce(v_expected_currency in ('INR','EUR','USD'), false);

  if v_issuer.profile_key is null then
    v_issuer_missing := array[
      'legal_name','billing_email','address_line1','city','postal_code','country'
    ];
  else
    if nullif(btrim(coalesce(v_issuer.legal_name, '')), '') is null then
      v_issuer_missing := array_append(v_issuer_missing, 'legal_name');
    end if;
    if nullif(btrim(coalesce(v_issuer.billing_email, '')), '') is null then
      v_issuer_missing := array_append(v_issuer_missing, 'billing_email');
    elsif v_issuer.billing_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or v_issuer.billing_email ~ '[<>]' then
      v_issuer_invalid := array_append(v_issuer_invalid, 'billing_email');
    end if;
    if nullif(btrim(coalesce(v_issuer.address_line1, '')), '') is null then
      v_issuer_missing := array_append(v_issuer_missing, 'address_line1');
    end if;
    if nullif(btrim(coalesce(v_issuer.city, '')), '') is null then
      v_issuer_missing := array_append(v_issuer_missing, 'city');
    end if;
    if nullif(btrim(coalesce(v_issuer.postal_code, '')), '') is null then
      v_issuer_missing := array_append(v_issuer_missing, 'postal_code');
    end if;
    if nullif(btrim(coalesce(v_issuer.country, '')), '') is null then
      v_issuer_missing := array_append(v_issuer_missing, 'country');
    else
      v_issuer_country_currency := public.billing_profile_currency_for_country(v_issuer.country);
      if v_issuer.country !~ '^[A-Z]{2}$' or v_issuer_country_currency is null then
        v_issuer_invalid := array_append(v_issuer_invalid, 'country');
      end if;
    end if;
    if v_issuer.status is distinct from 'active' then
      v_issuer_invalid := array_append(v_issuer_invalid, 'status');
    end if;
    if v_issuer.effective_from is null or v_issuer.effective_from > v_as_of then
      v_issuer_invalid := array_append(v_issuer_invalid, 'effective_from');
    end if;
    if v_issuer.tax_registration_type is null
       or v_issuer.tax_registration_type not in ('NONE','GSTIN','VAT','OTHER') then
      v_issuer_invalid := array_append(v_issuer_invalid, 'tax_registration_type');
    elsif v_issuer.tax_registration_type = 'NONE'
       and nullif(btrim(coalesce(v_issuer.tax_id, '')), '') is not null then
      v_issuer_invalid := array_append(v_issuer_invalid, 'tax_id');
    elsif v_issuer.tax_registration_type <> 'NONE'
       and nullif(btrim(coalesce(v_issuer.tax_id, '')), '') is null then
      v_issuer_missing := array_append(v_issuer_missing, 'tax_id');
    end if;
  end if;

  if v_profile.tenant_id is null then
    v_customer_missing := array[
      'legal_name','billing_email','address_line1','city','postal_code',
      'country','preferred_currency'
    ];
  else
    if nullif(btrim(coalesce(v_profile.legal_name, '')), '') is null then
      v_customer_missing := array_append(v_customer_missing, 'legal_name');
    end if;
    if nullif(btrim(coalesce(v_profile.billing_email, '')), '') is null then
      v_customer_missing := array_append(v_customer_missing, 'billing_email');
    elsif v_profile.billing_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
       or v_profile.billing_email ~ '[<>]' then
      v_customer_invalid := array_append(v_customer_invalid, 'billing_email');
    end if;
    if nullif(btrim(coalesce(v_profile.address_line1, '')), '') is null then
      v_customer_missing := array_append(v_customer_missing, 'address_line1');
    end if;
    if nullif(btrim(coalesce(v_profile.city, '')), '') is null then
      v_customer_missing := array_append(v_customer_missing, 'city');
    end if;
    if nullif(btrim(coalesce(v_profile.postal_code, '')), '') is null then
      v_customer_missing := array_append(v_customer_missing, 'postal_code');
    end if;
    if nullif(btrim(coalesce(v_profile.country, '')), '') is null then
      v_customer_missing := array_append(v_customer_missing, 'country');
    else
      v_customer_country_currency := public.billing_profile_currency_for_country(v_profile.country);
      if v_profile.country !~ '^[A-Z]{2}$' or v_customer_country_currency is null then
        v_customer_invalid := array_append(v_customer_invalid, 'country');
      end if;
    end if;
    if nullif(btrim(coalesce(v_profile.preferred_currency, '')), '') is null then
      v_customer_missing := array_append(v_customer_missing, 'preferred_currency');
    elsif v_profile.preferred_currency not in ('INR','EUR','USD')
       or v_profile.preferred_currency is distinct from v_customer_country_currency
       or v_profile.preferred_currency is distinct from v_expected_currency then
      v_customer_invalid := array_append(v_customer_invalid, 'preferred_currency');
    end if;
    if v_profile.tax_registration_type is null
       or v_profile.tax_registration_type not in ('NONE','GSTIN','VAT','OTHER') then
      v_customer_invalid := array_append(v_customer_invalid, 'tax_registration_type');
    elsif v_profile.tax_registration_type = 'NONE'
       and nullif(btrim(coalesce(v_profile.tax_id, '')), '') is not null then
      v_customer_invalid := array_append(v_customer_invalid, 'tax_id');
    end if;
  end if;

  if not v_currency_ready then
    v_customer_invalid := array_append(v_customer_invalid, 'expected_currency');
  end if;

  v_issuer_ready := v_issuer.profile_key is not null
    and cardinality(v_issuer_missing) = 0
    and cardinality(v_issuer_invalid) = 0;
  v_customer_ready := v_profile.tenant_id is not null
    and cardinality(v_customer_missing) = 0
    and cardinality(v_customer_invalid) = 0;

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

  return jsonb_build_object(
    'ready', v_currency_ready and v_issuer_ready and v_customer_ready,
    'currency_ready', v_currency_ready,
    'expected_currency', v_expected_currency,
    'issuer', jsonb_build_object(
      'ready', v_issuer_ready,
      'missing_fields', to_jsonb(v_issuer_missing),
      'invalid_fields', to_jsonb(v_issuer_invalid),
      'snapshot', v_issuer_snapshot
    ),
    'customer', jsonb_build_object(
      'ready', v_customer_ready,
      'missing_fields', to_jsonb(v_customer_missing),
      'invalid_fields', to_jsonb(v_customer_invalid),
      'snapshot', v_billing_snapshot
    )
  );
end;
$$;

create function coachfort_internal.assert_platform_billing_readiness(
  p_tenant_id uuid,
  p_expected_currency text,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_readiness jsonb;
begin
  v_readiness := coachfort_internal.resolve_platform_billing_readiness(
    p_tenant_id,
    p_expected_currency,
    p_as_of
  );

  if coalesce((v_readiness->>'currency_ready')::boolean, false) is not true then
    raise exception 'Billing currency is not supported.' using errcode = '22023';
  end if;
  if coalesce((v_readiness#>>'{customer,ready}')::boolean, false) is not true then
    raise exception 'Complete the billing profile before continuing.' using errcode = '22023';
  end if;
  if coalesce((v_readiness#>>'{issuer,ready}')::boolean, false) is not true then
    raise exception 'CoachFort billing issuer profile is not configured.' using errcode = '55000';
  end if;

  return v_readiness;
end;
$$;

create function public.get_platform_billing_readiness_server(
  p_tenant_id uuid,
  p_expected_currency text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_readiness jsonb;
begin
  v_readiness := coachfort_internal.resolve_platform_billing_readiness(
    p_tenant_id,
    p_expected_currency,
    now()
  );

  return jsonb_build_object(
    'ready', coalesce((v_readiness->>'ready')::boolean, false),
    'currency_ready', coalesce((v_readiness->>'currency_ready')::boolean, false),
    'expected_currency', v_readiness->>'expected_currency',
    'issuer', jsonb_build_object(
      'ready', coalesce((v_readiness#>>'{issuer,ready}')::boolean, false),
      'missing_fields', coalesce(v_readiness#>'{issuer,missing_fields}', '[]'::jsonb),
      'invalid_fields', coalesce(v_readiness#>'{issuer,invalid_fields}', '[]'::jsonb)
    ),
    'customer', jsonb_build_object(
      'ready', coalesce((v_readiness#>>'{customer,ready}')::boolean, false),
      'missing_fields', coalesce(v_readiness#>'{customer,missing_fields}', '[]'::jsonb),
      'invalid_fields', coalesce(v_readiness#>'{customer,invalid_fields}', '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.create_platform_payment_order_authority_server(
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
  v_current public.tenant_subscription_assignments%rowtype;
  v_readiness jsonb;
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

  v_readiness := coachfort_internal.assert_platform_billing_readiness(
    p_tenant_id,
    v_price.currency,
    now()
  );
  v_billing_snapshot := v_readiness#>'{customer,snapshot}';
  v_issuer_snapshot := v_readiness#>'{issuer,snapshot}';

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

create or replace function public.create_platform_renewal_payment_order_authority_server(
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
  v_base public.tenant_subscription_assignments%rowtype;
  v_intent public.tenant_subscription_change_intents%rowtype;
  v_existing_order public.tenant_payment_orders%rowtype;
  v_lifecycle jsonb;
  v_readiness jsonb;
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

  v_readiness := coachfort_internal.assert_platform_billing_readiness(
    p_tenant_id,
    v_price.currency,
    now()
  );
  v_billing_snapshot := v_readiness#>'{customer,snapshot}';
  v_issuer_snapshot := v_readiness#>'{issuer,snapshot}';

  v_generation := v_intent.order_generation + 1;
  v_tax_calculation_status := case
    when v_price.tax_behavior = 'not_applicable' then 'not_applicable'
    else 'not_calculated'
  end;
  v_tax_amount_minor := case when v_tax_calculation_status = 'not_applicable' then 0 else null end;
  v_total_amount_minor := v_price.amount_minor + coalesce(v_tax_amount_minor, 0);

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

create or replace function public.issue_platform_subscription_invoice(
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
  v_readiness jsonb;
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

  v_readiness := coachfort_internal.assert_platform_billing_readiness(
    v_assignment.tenant_id,
    v_price.currency,
    coalesce(p_issued_at, now())
  );
  v_billing_snapshot := v_readiness#>'{customer,snapshot}';
  v_issuer_snapshot := v_readiness#>'{issuer,snapshot}';

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
    v_price.currency, v_billing_snapshot->>'legal_name', v_billing_snapshot->>'billing_email',
    concat_ws(', ',
      v_billing_snapshot->>'address_line1',
      v_billing_snapshot->>'address_line2',
      v_billing_snapshot->>'city',
      v_billing_snapshot->>'state',
      v_billing_snapshot->>'postal_code',
      v_billing_snapshot->>'country'
    ),
    case when v_billing_snapshot->>'tax_registration_type' = 'GSTIN'
      then v_billing_snapshot->>'tax_id' else null end,
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

alter function coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz) owner to postgres;
alter function coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz) owner to postgres;
alter function public.get_platform_billing_readiness_server(uuid,text) owner to postgres;
alter function public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz) owner to postgres;

revoke all on function coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.get_platform_billing_readiness_server(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_platform_billing_readiness_server(uuid,text)
  to service_role;

revoke all on function public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)
  to service_role;
revoke all on function public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)
  to service_role;
revoke all on function public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  to service_role;

do $$
declare
  v_baseline ux8g4b1a_protected_baseline%rowtype;
  v_current_counts jsonb;
  v_current_fingerprints jsonb;
  v_initial_source text;
  v_renewal_source text;
  v_invoice_source text;
  v_safe_source text;
begin
  select * into v_baseline from ux8g4b1a_protected_baseline;

  v_current_counts := jsonb_build_object(
    'issuer_profiles', (select count(*) from public.platform_billing_issuer_profiles),
    'tenant_billing_profiles', (select count(*) from public.tenant_billing_profiles),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'webhook_events', (select count(*) from public.razorpay_webhook_events),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'assignments', (select count(*) from public.tenant_subscription_assignments),
    'change_intents', (select count(*) from public.tenant_subscription_change_intents),
    'invoices', (select count(*) from public.invoices),
    'invoice_items', (select count(*) from public.invoice_items),
    'receipts', (select count(*) from public.platform_billing_receipts)
  );
  v_current_fingerprints := jsonb_build_object(
    'activation_invoice', md5(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_invoice_for_activation_server(uuid)'
    ))),
    'fulfillment_receipt', md5(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_receipt_for_fulfillment_server(uuid)'
    ))),
    'payment_receipt', md5(pg_get_functiondef(to_regprocedure(
      'public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'
    ))),
    'completion_helper', md5(pg_get_functiondef(to_regprocedure(
      'public.get_tenant_billing_profile_completion(uuid)'
    )))
  );

  if v_current_counts is distinct from v_baseline.row_counts
     or v_current_fingerprints is distinct from v_baseline.protected_function_fingerprints then
    raise exception 'UX-8G4B1A changed protected data or snapshot authorities.' using errcode = 'P0001';
  end if;

  v_initial_source := lower(pg_get_functiondef(to_regprocedure(
    'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'
  )));
  v_renewal_source := lower(pg_get_functiondef(to_regprocedure(
    'public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'
  )));
  v_invoice_source := lower(pg_get_functiondef(to_regprocedure(
    'public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'
  )));
  v_safe_source := lower(pg_get_functiondef(to_regprocedure(
    'public.get_platform_billing_readiness_server(uuid,text)'
  )));

  if v_initial_source not like '%assert_platform_billing_readiness%'
     or v_initial_source like '%from public.tenant_billing_profiles%'
     or v_initial_source like '%from public.platform_billing_issuer_profiles%'
     or v_renewal_source not like '%assert_platform_billing_readiness%'
     or v_renewal_source like '%from public.tenant_billing_profiles%'
     or v_renewal_source like '%from public.platform_billing_issuer_profiles%'
     or position('if v_existing_order.id is not null then' in v_renewal_source) = 0
     or position('if v_existing_order.id is not null then' in v_renewal_source)
        >= position('v_readiness := coachfort_internal.assert_platform_billing_readiness' in v_renewal_source)
     or position('v_readiness := coachfort_internal.assert_platform_billing_readiness' in v_renewal_source)
        >= position('v_generation := v_intent.order_generation + 1' in v_renewal_source)
     or v_renewal_source not like '%''billing_snapshot'', v_existing_order.billing_snapshot%'
     or v_renewal_source not like '%''issuer_snapshot'', v_existing_order.issuer_snapshot%'
     or v_renewal_source not like '%''plan_snapshot'', v_existing_order.plan_snapshot%'
     or v_invoice_source not like '%assert_platform_billing_readiness%'
     or v_invoice_source like '%from public.tenant_billing_profiles%'
     or v_invoice_source like '%from public.platform_billing_issuer_profiles%'
     or v_safe_source like '%{issuer,snapshot}%'
     or v_safe_source like '%{customer,snapshot}%'
     or v_safe_source like '%razorpay_%' then
    raise exception 'UX-8G4B1A readiness integration is unsafe.' using errcode = 'P0001';
  end if;

  if not has_function_privilege('service_role',
       'public.get_platform_billing_readiness_server(uuid,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.get_platform_billing_readiness_server(uuid,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon',
       'public.get_platform_billing_readiness_server(uuid,text)'::regprocedure, 'EXECUTE')
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl,
         acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = 'public.get_platform_billing_readiness_server(uuid,text)'::regprocedure
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'UX-8G4B1A readiness RPC ACL is unsafe.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    where procedure.oid in (
      'coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)'::regprocedure,
      'coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz)'::regprocedure
    ) and (
      pg_get_userbyid(procedure.proowner) <> 'postgres'
      or not procedure.prosecdef
      or procedure.provolatile <> 's'
      or not coalesce(procedure.proconfig, '{}'::text[])
        @> array['search_path=public, pg_temp']
      or has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      or has_function_privilege('anon', procedure.oid, 'EXECUTE')
      or exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  ) then
    raise exception 'UX-8G4B1A private readiness authority is unsafe.' using errcode = 'P0001';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with function_state as (
  select
    procedure.oid function_oid,
    format('%I.%I(%s)', namespace.nspname, procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)) identity,
    pg_get_userbyid(procedure.proowner) owner_name,
    procedure.prosecdef security_definer,
    procedure.provolatile,
    procedure.proconfig,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE') service_role_execute,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE') authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_execute,
    exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) public_execute,
    lower(regexp_replace(pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')) source
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where procedure.oid in (
    to_regprocedure('coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)'),
    to_regprocedure('coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz)'),
    to_regprocedure('public.get_platform_billing_readiness_server(uuid,text)'),
    to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'),
    to_regprocedure('public.issue_platform_invoice_for_activation_server(uuid)'),
    to_regprocedure('public.issue_platform_receipt_for_fulfillment_server(uuid)'),
    to_regprocedure('public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)')
  )
), resolver as (
  select source from function_state
  where function_oid = to_regprocedure(
    'coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)'
  )
), assertion as (
  select source from function_state
  where function_oid = to_regprocedure(
    'coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz)'
  )
), safe_rpc as (
  select * from function_state
  where function_oid = to_regprocedure(
    'public.get_platform_billing_readiness_server(uuid,text)'
  )
), initial_order as (
  select source from function_state
  where function_oid = to_regprocedure(
    'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'
  )
), renewal_order as (
  select source from function_state
  where function_oid = to_regprocedure(
    'public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'
  )
), live_invoice as (
  select source from function_state
  where function_oid = to_regprocedure(
    'public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)'
  )
), activation_invoice as (
  select source from function_state
  where function_oid = to_regprocedure(
    'public.issue_platform_invoice_for_activation_server(uuid)'
  )
), fulfillment_receipt as (
  select source from function_state
  where function_oid = to_regprocedure(
    'public.issue_platform_receipt_for_fulfillment_server(uuid)'
  )
), payment_receipt as (
  select source from function_state
  where function_oid = to_regprocedure(
    'public.issue_platform_payment_receipt(uuid,text,uuid,timestamptz)'
  )
), profile_authority_state as (
  select
    exists (
      select 1
      from pg_constraint constraint_def
      join pg_index backing_index on backing_index.indexrelid = constraint_def.conindid
      where constraint_def.conrelid = to_regclass('public.platform_billing_issuer_profiles')
        and constraint_def.contype in ('p','u')
        and constraint_def.convalidated
        and backing_index.indisunique
        and backing_index.indisvalid
        and backing_index.indisready
        and backing_index.indpred is null
        and backing_index.indexprs is null
        and (
          select array_agg(attribute.attname order by key_column.ordinality)
          from unnest(constraint_def.conkey) with ordinality key_column(attnum, ordinality)
          join pg_attribute attribute
            on attribute.attrelid = constraint_def.conrelid
           and attribute.attnum = key_column.attnum
        ) = array['profile_key']::name[]
    ) issuer_profile_key_unique,
    exists (
      select 1
      from pg_constraint constraint_def
      join pg_index backing_index on backing_index.indexrelid = constraint_def.conindid
      where constraint_def.conrelid = to_regclass('public.tenant_billing_profiles')
        and constraint_def.contype in ('p','u')
        and constraint_def.convalidated
        and backing_index.indisunique
        and backing_index.indisvalid
        and backing_index.indisready
        and backing_index.indpred is null
        and backing_index.indexprs is null
        and (
          select array_agg(attribute.attname order by key_column.ordinality)
          from unnest(constraint_def.conkey) with ordinality key_column(attnum, ordinality)
          join pg_attribute attribute
            on attribute.attrelid = constraint_def.conrelid
           and attribute.attnum = key_column.attnum
        ) = array['tenant_id']::name[]
    ) tenant_billing_profile_tenant_unique,
    exists (
      select 1
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_billing_issuer_profiles')
        and constraint_def.contype = 'c'
        and constraint_def.convalidated
        and regexp_replace(
          lower(pg_get_expr(constraint_def.conbin, constraint_def.conrelid)),
          '[[:space:]()]', '', 'g'
        ) = 'profile_key=''default''::text'
    ) issuer_singleton_default_contract
), profile_duplicate_state as (
  select
    (
      select count(*)
      from (
        select profile.profile_key
        from public.platform_billing_issuer_profiles profile
        group by profile.profile_key
        having count(*) > 1
      ) duplicate_key
    ) issuer_duplicate_key_count,
    (
      select count(*)
      from (
        select profile.tenant_id
        from public.tenant_billing_profiles profile
        group by profile.tenant_id
        having count(*) > 1
      ) duplicate_key
    ) tenant_billing_duplicate_tenant_count
), snapshot_shape_state as (
  select
    (
      select lower(pg_get_constraintdef(constraint_def.oid))
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.tenant_payment_orders')
        and constraint_def.conname = 'tenant_payment_orders_frozen_snapshot_shape_check'
        and constraint_def.contype = 'c'
        and constraint_def.convalidated
    ) order_definition,
    (
      select lower(pg_get_constraintdef(constraint_def.oid))
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.invoices')
        and constraint_def.conname = 'invoices_snapshot_shape_check'
        and constraint_def.contype = 'c'
        and constraint_def.convalidated
    ) invoice_definition,
    (
      select lower(pg_get_constraintdef(constraint_def.oid))
      from pg_constraint constraint_def
      where constraint_def.conrelid = to_regclass('public.platform_billing_receipts')
        and constraint_def.conname = 'platform_billing_receipts_snapshot_shape_check'
        and constraint_def.contype = 'c'
        and constraint_def.convalidated
    ) receipt_definition
), acl_state as (
  select count(*) browser_write_grants
  from information_schema.table_privileges grant_state
  where grant_state.table_schema = 'public'
    and grant_state.table_name in (
      'platform_billing_issuer_profiles','tenant_billing_profiles',
      'tenant_payment_orders','tenant_payment_attempts',
      'tenant_plan_activation_events','tenant_subscription_assignments',
      'tenant_subscription_change_intents','subscription_plan_prices',
      'invoices','invoice_items',
      'platform_billing_receipts'
    )
    and grant_state.grantee in ('PUBLIC','anon','authenticated')
    and grant_state.privilege_type in (
      'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'
    )
), gates as (
  select
    (select count(*) from function_state) = 9 canonical_readiness_authority_ready,
    profile_authority_state.issuer_profile_key_unique,
    profile_authority_state.tenant_billing_profile_tenant_unique,
    profile_authority_state.issuer_singleton_default_contract,
    profile_duplicate_state.issuer_duplicate_key_count,
    profile_duplicate_state.tenant_billing_duplicate_tenant_count,
    snapshot_shape_state.order_definition is not null
      and snapshot_shape_state.order_definition like all (array[
        '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
        '%legal_name%','%billing_email%','%billing_phone%','%invoice_contact_name%',
        '%address_line1%','%address_line2%','%city%','%state%','%postal_code%',
        '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%',
        '%profile_updated_at%','%effective_from%'
      ]::text[])
      and snapshot_shape_state.invoice_definition is not null
      and snapshot_shape_state.invoice_definition like all (array[
        '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
        '%legal_name%','%billing_email%','%address_line1%','%city%','%postal_code%',
        '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%'
      ]::text[])
      and snapshot_shape_state.receipt_definition is not null
      and snapshot_shape_state.receipt_definition like all (array[
        '%jsonb_typeof(billing_snapshot)%','%jsonb_typeof(issuer_snapshot)%',
        '%legal_name%','%billing_email%','%address_line1%','%city%','%postal_code%',
        '%country%','%preferred_currency%','%tax_registration_type%','%tax_id%'
      ]::text[])
      snapshot_shape_contract,
    not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where (namespace.nspname, procedure.proname) in (
        ('coachfort_internal','resolve_platform_billing_readiness'),
        ('coachfort_internal','assert_platform_billing_readiness'),
        ('public','get_platform_billing_readiness_server'),
        ('public','create_platform_payment_order_authority_server'),
        ('public','create_platform_renewal_payment_order_authority_server'),
        ('public','issue_platform_subscription_invoice')
      )
        and procedure.oid not in (
          to_regprocedure('coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)'),
          to_regprocedure('coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz)'),
          to_regprocedure('public.get_platform_billing_readiness_server(uuid,text)'),
          to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
          to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
          to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)')
        )
    ) exact_function_identities,
    not exists (
      select 1
      from function_state
      where function_oid in (
        to_regprocedure('coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)'),
        to_regprocedure('coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz)')
      ) and (
        owner_name <> 'postgres'
        or not security_definer
        or provolatile <> 's'
        or not coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']
        or service_role_execute
        or authenticated_execute
        or anon_execute
        or public_execute
      )
    ) private_readiness_authority_security,
    not exists (
      select 1
      from function_state
      where function_oid in (
        to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
        to_regprocedure('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
        to_regprocedure('public.issue_platform_subscription_invoice(text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz)')
      ) and (
        owner_name <> 'postgres'
        or not security_definer
        or not coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']
        or not service_role_execute
        or authenticated_execute
        or anon_execute
        or public_execute
      )
    ) live_authority_security,
    (select source from resolver) like '%profile_key = ''default''%'
      and (select source from resolver) like '%status is distinct from ''active''%'
      and (select source from resolver) like '%effective_from > v_as_of%'
      and (select source from resolver) like '%billing_email%'
      and (select source from resolver) like '%address_line1%'
      and (select source from resolver) like '%tax_registration_type%'
      and (select source from resolver) like '%billing_profile_currency_for_country(v_issuer.country)%'
      issuer_readiness_contract,
    (select source from resolver) like '%from public.tenant_billing_profiles%'
      and (select source from resolver) like '%legal_name%'
      and (select source from resolver) like '%preferred_currency%'
      and (select source from resolver) not like '%public.tenants%'
      customer_readiness_contract,
    (select source from resolver) like '%v_expected_currency in (''inr'',''eur'',''usd'')%'
      and (select source from resolver) like '%v_profile.preferred_currency is distinct from v_expected_currency%'
      and (select source from resolver) like '%billing_profile_currency_for_country(v_profile.country)%'
      currency_readiness_contract,
    (select source from resolver) like all (array[
      '%''legal_name'', v_profile.legal_name%',
      '%''billing_email'', v_profile.billing_email%',
      '%''billing_phone'', v_profile.billing_phone%',
      '%''invoice_contact_name'', v_profile.invoice_contact_name%',
      '%''address_line1'', v_profile.address_line1%',
      '%''address_line2'', v_profile.address_line2%',
      '%''city'', v_profile.city%',
      '%''state'', v_profile.state%',
      '%''postal_code'', v_profile.postal_code%',
      '%''country'', v_profile.country%',
      '%''preferred_currency'', v_profile.preferred_currency%',
      '%''tax_registration_type'', v_profile.tax_registration_type%',
      '%''tax_id'', v_profile.tax_id%',
      '%''profile_updated_at'', v_profile.updated_at%'
    ]::text[])
      and (select source from resolver) like all (array[
        '%''legal_name'', v_issuer.legal_name%',
        '%''billing_email'', v_issuer.billing_email%',
        '%''billing_phone'', v_issuer.billing_phone%',
        '%''address_line1'', v_issuer.address_line1%',
        '%''address_line2'', v_issuer.address_line2%',
        '%''city'', v_issuer.city%',
        '%''state'', v_issuer.state%',
        '%''postal_code'', v_issuer.postal_code%',
        '%''country'', v_issuer.country%',
        '%''tax_registration_type'', v_issuer.tax_registration_type%',
        '%''tax_id'', v_issuer.tax_id%',
        '%''effective_from'', v_issuer.effective_from%',
        '%''profile_updated_at'', v_issuer.updated_at%'
      ]::text[])
      resolver_snapshot_shape_contract,
    (select source from assertion) like '%resolve_platform_billing_readiness%'
      and (select source from assertion) like '%complete the billing profile before continuing%'
      and (select source from assertion) like '%coachfort billing issuer profile is not configured%'
      assertion_contract,
    (select source from initial_order) like '%assert_platform_billing_readiness%'
      and (select source from initial_order) like '%v_readiness#>''{customer,snapshot}''%'
      and (select source from initial_order) like '%v_readiness#>''{issuer,snapshot}''%'
      and (select source from initial_order) not like '%from public.tenant_billing_profiles%'
      and (select source from initial_order) not like '%from public.platform_billing_issuer_profiles%'
      initial_order_uses_shared_readiness,
    (select source from renewal_order) like '%assert_platform_billing_readiness%'
      and (select source from renewal_order) like '%v_readiness#>''{customer,snapshot}''%'
      and (select source from renewal_order) like '%v_readiness#>''{issuer,snapshot}''%'
      and (select source from renewal_order) not like '%from public.tenant_billing_profiles%'
      and (select source from renewal_order) not like '%from public.platform_billing_issuer_profiles%'
      renewal_order_uses_shared_readiness,
    (select position('if v_existing_order.id is not null then' in source) from renewal_order) > 0
      and (select position('if v_existing_order.id is not null then' in source) from renewal_order)
        < (select position('v_readiness := coachfort_internal.assert_platform_billing_readiness' in source) from renewal_order)
      and (select position('v_readiness := coachfort_internal.assert_platform_billing_readiness' in source) from renewal_order)
        < (select position('v_generation := v_intent.order_generation + 1' in source) from renewal_order)
      and (select source from renewal_order) like '%''billing_snapshot'', v_existing_order.billing_snapshot%'
      and (select source from renewal_order) like '%''issuer_snapshot'', v_existing_order.issuer_snapshot%'
      and (select source from renewal_order) like '%''plan_snapshot'', v_existing_order.plan_snapshot%'
      renewal_replay_precedes_live_readiness,
    (select source from live_invoice) like '%assert_platform_billing_readiness%'
      and (select source from live_invoice) like '%v_readiness#>''{customer,snapshot}''%'
      and (select source from live_invoice) like '%v_readiness#>''{issuer,snapshot}''%'
      and (select source from live_invoice) not like '%from public.tenant_billing_profiles%'
      and (select source from live_invoice) not like '%from public.platform_billing_issuer_profiles%'
      live_invoice_shared_readiness,
    (select source from activation_invoice) like '%v_order.billing_snapshot%'
      and (select source from activation_invoice) like '%v_order.issuer_snapshot%'
      and (select source from activation_invoice) not like '%assert_platform_billing_readiness%'
      and (select source from activation_invoice) not like '%platform_billing_issuer_profiles%'
      activation_invoice_snapshot_boundary_preserved,
    (select source from fulfillment_receipt) like '%issue_platform_payment_receipt%'
      and (select source from fulfillment_receipt) not like '%assert_platform_billing_readiness%'
      and (select source from payment_receipt) like '%v_invoice.billing_snapshot%'
      and (select source from payment_receipt) like '%v_invoice.issuer_snapshot%'
      and (select source from payment_receipt) not like '%platform_billing_issuer_profiles%'
      receipt_snapshot_boundary_preserved,
    (select count(*) from safe_rpc) = 1 safe_readiness_rpc_present,
    (select owner_name = 'postgres'
      and security_definer
      and coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']
      and service_role_execute
      and not authenticated_execute
      and not anon_execute
      and not public_execute
      from safe_rpc) safe_readiness_rpc_server_only,
    (select source from safe_rpc) like '%missing_fields%'
      and (select source from safe_rpc) like '%invalid_fields%'
      and (select source from safe_rpc) not like '%{issuer,snapshot}%'
      and (select source from safe_rpc) not like '%{customer,snapshot}%'
      and (select source from safe_rpc) not like '%legal_name%'
      and (select source from safe_rpc) not like '%billing_email%'
      and (select source from safe_rpc) not like '%tax_id%'
      safe_readiness_output_contract,
    (select source from resolver) not like '%razorpay_%'
      and (select source from assertion) not like '%razorpay_%'
      and (select source from safe_rpc) not like '%razorpay_%'
      and (select source from resolver) not like '%provider%'
      and (select source from assertion) not like '%provider%'
      and (select source from safe_rpc) not like '%provider%'
      no_provider_runtime_authority_in_sql,
    acl_state.browser_write_grants = 0 browser_write_authority_unchanged
  from profile_authority_state
  cross join profile_duplicate_state
  cross join snapshot_shape_state
  cross join acl_state
)
select
  gates.*,
  jsonb_build_object(
    'issuer_profiles', (select count(*) from public.platform_billing_issuer_profiles),
    'tenant_billing_profiles', (select count(*) from public.tenant_billing_profiles),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'webhook_events', (select count(*) from public.razorpay_webhook_events),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'assignments', (select count(*) from public.tenant_subscription_assignments),
    'change_intents', (select count(*) from public.tenant_subscription_change_intents),
    'invoices', (select count(*) from public.invoices),
    'invoice_items', (select count(*) from public.invoice_items),
    'receipts', (select count(*) from public.platform_billing_receipts)
  ) protected_row_counts,
  -- APPLY raises before COMMIT if either protected counts or protected
  -- function fingerprints differ from its in-transaction baseline.
  true protected_rows_unchanged,
  gates.canonical_readiness_authority_ready
    and gates.issuer_profile_key_unique
    and gates.tenant_billing_profile_tenant_unique
    and gates.issuer_singleton_default_contract
    and gates.issuer_duplicate_key_count = 0
    and gates.tenant_billing_duplicate_tenant_count = 0
    and gates.snapshot_shape_contract
    and gates.exact_function_identities
    and gates.private_readiness_authority_security
    and gates.live_authority_security
    and gates.issuer_readiness_contract
    and gates.customer_readiness_contract
    and gates.currency_readiness_contract
    and gates.resolver_snapshot_shape_contract
    and gates.assertion_contract
    and gates.initial_order_uses_shared_readiness
    and gates.renewal_order_uses_shared_readiness
    and gates.renewal_replay_precedes_live_readiness
    and gates.live_invoice_shared_readiness
    and gates.activation_invoice_snapshot_boundary_preserved
    and gates.receipt_snapshot_boundary_preserved
    and gates.safe_readiness_rpc_present
    and gates.safe_readiness_rpc_server_only
    and gates.safe_readiness_output_contract
    and gates.no_provider_runtime_authority_in_sql
    and gates.browser_write_authority_unchanged
    and true -- protected_rows_unchanged is guaranteed by the APPLY commit guard.
    security_gate
from gates;
*/
