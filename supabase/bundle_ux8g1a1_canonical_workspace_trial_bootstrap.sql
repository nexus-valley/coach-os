-- Bundle UX-8G1A1: Canonical workspace trial bootstrap
-- Review PRE, APPLY, and POST separately. Do not execute without approval.

/*
PRE-APPLY READ-ONLY VERIFICATION

with required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.tenant_members'),
    ('public.subscription_plans'),
    ('public.tenant_subscription_assignments'),
    ('public.tenant_payment_orders'),
    ('public.tenant_payment_attempts'),
    ('public.tenant_plan_activation_events'),
    ('public.invoices'),
    ('public.platform_billing_receipts')
), relation_state as (
  select identity, to_regclass(identity) is not null as installed
  from required_relations
), required_functions(identity) as (
  values
    ('public.create_workspace_with_owner(text,text,text)'),
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'),
    ('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
    ('public.activate_tenant_plan_after_verified_payment(uuid)'),
    ('public.issue_platform_invoice_for_activation_server(uuid)'),
    ('public.issue_platform_receipt_for_fulfillment_server(uuid)')
), function_state as (
  select identity, to_regprocedure(identity) is not null as installed
  from required_functions
), required_columns(table_name, column_name, data_type) as (
  values
    ('tenants', 'id', 'uuid'),
    ('tenants', 'owner_user_id', 'uuid'),
    ('tenants', 'trial_started_at', 'timestamp with time zone'),
    ('tenants', 'trial_ends_at', 'timestamp with time zone'),
    ('tenants', 'is_trial_active', 'boolean'),
    ('tenant_members', 'tenant_id', 'uuid'),
    ('tenant_members', 'user_id', 'uuid'),
    ('tenant_members', 'role', 'text'),
    ('subscription_plans', 'id', 'uuid'),
    ('subscription_plans', 'code', 'text'),
    ('subscription_plans', 'status', 'text'),
    ('subscription_plans', 'trial_days', 'integer'),
    ('subscription_plans', 'metadata_json', 'jsonb'),
    ('subscription_plans', 'updated_at', 'timestamp with time zone'),
    ('tenant_subscription_assignments', 'tenant_id', 'uuid'),
    ('tenant_subscription_assignments', 'plan_id', 'uuid'),
    ('tenant_subscription_assignments', 'status', 'text'),
    ('tenant_subscription_assignments', 'billing_cycle', 'text'),
    ('tenant_subscription_assignments', 'currency', 'text'),
    ('tenant_subscription_assignments', 'trial_started_at', 'timestamp with time zone'),
    ('tenant_subscription_assignments', 'trial_ends_at', 'timestamp with time zone'),
    ('tenant_subscription_assignments', 'current_period_start', 'timestamp with time zone'),
    ('tenant_subscription_assignments', 'current_period_end', 'timestamp with time zone'),
    ('tenant_subscription_assignments', 'grace_period_ends_at', 'timestamp with time zone'),
    ('tenant_subscription_assignments', 'payment_status', 'text'),
    ('tenant_subscription_assignments', 'source', 'text'),
    ('tenant_subscription_assignments', 'is_current', 'boolean'),
    ('tenant_subscription_assignments', 'metadata_json', 'jsonb'),
    ('tenant_subscription_assignments', 'created_by', 'uuid'),
    ('tenant_subscription_assignments', 'updated_by', 'uuid')
), column_state as (
  select required.table_name, required.column_name,
    exists (
      select 1
      from information_schema.columns column_definition
      where column_definition.table_schema = 'public'
        and column_definition.table_name = required.table_name
        and column_definition.column_name = required.column_name
        and column_definition.data_type = required.data_type
    ) as installed
  from required_columns required
), starter_candidate as (
  select count(*) as candidate_count,
    min(trial_days) as trial_days,
    bool_and(status in ('draft', 'active')) as eligible_status,
    bool_and(
      char_length((
        coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'workspace_trial_default', true,
            'workspace_trial_default_module', 'UX-8G1A1',
            'workspace_trial_public_purchase_authority', false
          )
      )::text) <= 3000
    ) as metadata_capacity_ok
  from public.subscription_plans
  where code = 'starter'
), plan_metadata_contract as (
  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.subscription_plans'::regclass
      and constraint_definition.conname = 'subscription_plans_metadata_object_check'
      and lower(pg_get_constraintdef(constraint_definition.oid)) like '%jsonb_typeof(metadata_json)%object%'
      and lower(pg_get_constraintdef(constraint_definition.oid)) like '%3000%'
  ) as metadata_constraint
), assignment_integrity as (
  select
    exists (
      select 1
      from pg_catalog.pg_class index_relation
      join pg_catalog.pg_namespace namespace on namespace.oid = index_relation.relnamespace
      join pg_catalog.pg_index index_definition on index_definition.indexrelid = index_relation.oid
      where namespace.nspname = 'public'
        and index_relation.relname = 'tenant_subscription_assignments_current_unique_idx'
        and index_definition.indrelid = 'public.tenant_subscription_assignments'::regclass
        and index_definition.indisunique
        and pg_get_expr(index_definition.indpred, index_definition.indrelid) = 'is_current'
    ) as one_current_assignment,
    count(*) filter (where constraint_definition.conname = 'tenant_subscription_assignments_status_check') = 1 as status_constraint,
    count(*) filter (where constraint_definition.conname = 'tenant_subscription_assignments_billing_cycle_check') = 1 as billing_cycle_constraint,
    count(*) filter (where constraint_definition.conname = 'tenant_subscription_assignments_currency_check') = 1 as currency_constraint,
    count(*) filter (where constraint_definition.conname = 'tenant_subscription_assignments_payment_status_check') = 1 as payment_constraint,
    count(*) filter (where constraint_definition.conname = 'tenant_subscription_assignments_source_check') = 1 as source_constraint
  from pg_catalog.pg_constraint constraint_definition
  where constraint_definition.conrelid = 'public.tenant_subscription_assignments'::regclass
), assignment_tuple_contract as (
  select
    bool_or(conname = 'tenant_subscription_assignments_status_check'
      and lower(pg_get_constraintdef(oid)) like '%trial%') as trial_allowed,
    bool_or(conname = 'tenant_subscription_assignments_billing_cycle_check'
      and lower(pg_get_constraintdef(oid)) like '%monthly%') as monthly_allowed,
    bool_or(conname = 'tenant_subscription_assignments_currency_check'
      and lower(pg_get_constraintdef(oid)) like '%inr%') as inr_allowed,
    bool_or(conname = 'tenant_subscription_assignments_payment_status_check'
      and lower(pg_get_constraintdef(oid)) like '%not_required%') as not_required_allowed,
    bool_or(conname = 'tenant_subscription_assignments_source_check'
      and lower(pg_get_constraintdef(oid)) like '%system%') as system_source_allowed
  from pg_catalog.pg_constraint
  where conrelid = 'public.tenant_subscription_assignments'::regclass
), workspace_function as (
  select
    procedure_definition.oid,
    owner_role.rolname as owner_name,
    procedure_definition.prosecdef as security_definer,
    procedure_definition.proconfig as config,
    lower(regexp_replace(pg_get_functiondef(procedure_definition.oid), '[[:space:]]+', ' ', 'g')) as source
  from pg_catalog.pg_proc procedure_definition
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure_definition.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = procedure_definition.proowner
  where procedure_definition.oid = to_regprocedure('public.create_workspace_with_owner(text,text,text)')
), workspace_acl as (
  select
    coalesce(has_function_privilege('authenticated', 'public.create_workspace_with_owner(text,text,text)', 'EXECUTE'), false) as authenticated_execute,
    coalesce(has_function_privilege('anon', 'public.create_workspace_with_owner(text,text,text)', 'EXECUTE'), false) as anon_execute,
    coalesce(has_function_privilege('service_role', 'public.create_workspace_with_owner(text,text,text)', 'EXECUTE'), false) as service_execute,
    exists (
      select 1
      from pg_catalog.pg_proc procedure_definition,
        lateral aclexplode(coalesce(procedure_definition.proacl, acldefault('f', procedure_definition.proowner))) acl
      where procedure_definition.oid = to_regprocedure('public.create_workspace_with_owner(text,text,text)')
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute
), historical_state as (
  select
    count(*) as tenant_count,
    count(*) filter (where assignment_history.assignment_count > 0) as with_assignment_history,
    count(*) filter (where assignment_history.assignment_count = 0) as zero_assignment_history,
    count(*) filter (where assignment_history.current_count > 0) as with_current_assignment
  from public.tenants tenant
  cross join lateral (
    select count(*) as assignment_count,
      count(*) filter (where assignment.is_current) as current_count
    from public.tenant_subscription_assignments assignment
    where assignment.tenant_id = tenant.id
  ) assignment_history
), conflicting_bootstrap_objects as (
  select jsonb_build_object(
    'default_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'subscription_plans'
        and column_name = 'is_workspace_trial_default'
    ),
    'default_index', to_regclass('public.subscription_plans_workspace_trial_default_uidx') is not null,
    'default_duration_constraint', exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.subscription_plans'::regclass
        and conname = 'subscription_plans_workspace_trial_default_duration_check'
    ),
    'default_status_constraint', exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.subscription_plans'::regclass
        and conname = 'subscription_plans_workspace_trial_default_status_check'
    )
  ) as value
), bootstrap_function_inventory as (
  select
    count(*) filter (
      where namespace.nspname = 'public'
        and procedure_definition.proname = 'create_workspace_with_owner'
    ) as workspace_overload_count,
    count(*) filter (
      where procedure_definition.proname <> 'create_workspace_with_owner'
        and procedure_definition.proname ~ '(workspace.*trial|trial.*workspace)'
    ) as conflicting_trial_helper_count
  from pg_catalog.pg_proc procedure_definition
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure_definition.pronamespace
  where namespace.nspname in ('public', 'coachfort_internal')
), browser_assignment_writes as (
  select count(*) as grant_count
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'tenant_subscription_assignments'
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
), business_counts as (
  select jsonb_build_object(
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'platform_invoices', (select count(*) from public.invoices),
    'platform_receipts', (select count(*) from public.platform_billing_receipts)
  ) as value
)
select jsonb_build_object(
  'bundle', 'UX-8G1A1',
  'ready_for_apply',
    (select bool_and(installed) from relation_state)
    and (select bool_and(installed) from function_state)
    and (select bool_and(installed) from column_state)
    and (select candidate_count = 1 and trial_days > 0 and trial_days <= 365
      and eligible_status and metadata_capacity_ok from starter_candidate)
    and (select metadata_constraint from plan_metadata_contract)
    and (select one_current_assignment and status_constraint and billing_cycle_constraint
      and currency_constraint and payment_constraint and source_constraint from assignment_integrity)
    and (select trial_allowed and monthly_allowed and inr_allowed
      and not_required_allowed and system_source_allowed from assignment_tuple_contract)
    and (select owner_name = 'postgres' and security_definer
      and config @> array['search_path=public']::text[]
      and source like '%perform public.auth_otp_assert_workspace_creation_allowed()%'
      and source like '%insert into public.tenants%'
      and source like '%insert into public.tenant_members%'
      and source not like '%insert into public.tenant_subscription_assignments%' from workspace_function)
    and (select authenticated_execute and not anon_execute and not public_execute from workspace_acl)
    and (select value = jsonb_build_object(
      'default_column', false,
      'default_index', false,
      'default_duration_constraint', false,
      'default_status_constraint', false
    ) from conflicting_bootstrap_objects)
    and (select workspace_overload_count = 1 and conflicting_trial_helper_count = 0
      from bootstrap_function_inventory)
    and (select grant_count = 0 from browser_assignment_writes),
  'required_relations', (select jsonb_object_agg(identity, installed) from relation_state),
  'required_functions', (select jsonb_object_agg(identity, installed) from function_state),
  'required_columns', (select jsonb_object_agg(table_name || '.' || column_name, installed) from column_state),
  'starter_candidate', (select to_jsonb(starter_candidate) from starter_candidate),
  'plan_metadata_contract', (select to_jsonb(plan_metadata_contract) from plan_metadata_contract),
  'assignment_integrity', (select to_jsonb(assignment_integrity) from assignment_integrity),
  'assignment_trial_tuple', (select to_jsonb(assignment_tuple_contract) from assignment_tuple_contract),
  'workspace_function', (select jsonb_build_object(
    'owner', owner_name, 'security_definer', security_definer, 'config', config,
    'canonical_assignment_insert_present', source like '%insert into public.tenant_subscription_assignments%'
  ) from workspace_function),
  'workspace_acl', (select to_jsonb(workspace_acl) from workspace_acl),
  'conflicting_bootstrap_objects', (select value from conflicting_bootstrap_objects),
  'bootstrap_function_inventory', (select to_jsonb(bootstrap_function_inventory) from bootstrap_function_inventory),
  'historical_assignment_state', (select to_jsonb(historical_state) from historical_state),
  'browser_assignment_writes', (select grant_count from browser_assignment_writes),
  'payment_document_counts', (select value from business_counts)
);
*/

begin;

do $$
declare
  v_workspace_source text;
begin
  if exists (
    select 1
    from unnest(array[
      'public.tenants',
      'public.tenant_members',
      'public.subscription_plans',
      'public.tenant_subscription_assignments',
      'public.tenant_payment_orders',
      'public.tenant_payment_attempts',
      'public.tenant_plan_activation_events',
      'public.invoices',
      'public.platform_billing_receipts'
    ]) required(identity)
    where to_regclass(required.identity) is null
  ) then
    raise exception 'UX-8G1A1 required relations are missing.' using errcode = '55000';
  end if;

  if to_regprocedure('public.create_workspace_with_owner(text,text,text)') is null
     or to_regprocedure('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)') is null
     or to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.activate_tenant_plan_after_verified_payment(uuid)') is null
     or to_regprocedure('public.issue_platform_invoice_for_activation_server(uuid)') is null
     or to_regprocedure('public.issue_platform_receipt_for_fulfillment_server(uuid)') is null then
    raise exception 'UX-8G1A1 required workspace, lifecycle, or UX-8F functions are missing.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('tenants', 'id', 'uuid'),
      ('tenants', 'owner_user_id', 'uuid'),
      ('tenants', 'trial_started_at', 'timestamp with time zone'),
      ('tenants', 'trial_ends_at', 'timestamp with time zone'),
      ('tenants', 'is_trial_active', 'boolean'),
      ('tenant_members', 'tenant_id', 'uuid'),
      ('tenant_members', 'user_id', 'uuid'),
      ('tenant_members', 'role', 'text'),
      ('subscription_plans', 'id', 'uuid'),
      ('subscription_plans', 'code', 'text'),
      ('subscription_plans', 'status', 'text'),
      ('subscription_plans', 'trial_days', 'integer'),
      ('subscription_plans', 'metadata_json', 'jsonb'),
      ('subscription_plans', 'updated_at', 'timestamp with time zone'),
      ('tenant_subscription_assignments', 'tenant_id', 'uuid'),
      ('tenant_subscription_assignments', 'plan_id', 'uuid'),
      ('tenant_subscription_assignments', 'status', 'text'),
      ('tenant_subscription_assignments', 'billing_cycle', 'text'),
      ('tenant_subscription_assignments', 'currency', 'text'),
      ('tenant_subscription_assignments', 'trial_started_at', 'timestamp with time zone'),
      ('tenant_subscription_assignments', 'trial_ends_at', 'timestamp with time zone'),
      ('tenant_subscription_assignments', 'current_period_start', 'timestamp with time zone'),
      ('tenant_subscription_assignments', 'current_period_end', 'timestamp with time zone'),
      ('tenant_subscription_assignments', 'grace_period_ends_at', 'timestamp with time zone'),
      ('tenant_subscription_assignments', 'payment_status', 'text'),
      ('tenant_subscription_assignments', 'source', 'text'),
      ('tenant_subscription_assignments', 'is_current', 'boolean'),
      ('tenant_subscription_assignments', 'metadata_json', 'jsonb'),
      ('tenant_subscription_assignments', 'created_by', 'uuid'),
      ('tenant_subscription_assignments', 'updated_by', 'uuid')
    ) required(table_name, column_name, data_type)
    where not exists (
      select 1
      from information_schema.columns column_definition
      where column_definition.table_schema = 'public'
        and column_definition.table_name = required.table_name
        and column_definition.column_name = required.column_name
        and column_definition.data_type = required.data_type
    )
  ) then
    raise exception 'UX-8G1A1 required workspace or assignment columns drifted.' using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure_definition
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure_definition.pronamespace
    where namespace.nspname = 'public'
      and procedure_definition.proname = 'create_workspace_with_owner'
  ) <> 1
  or exists (
    select 1
    from pg_catalog.pg_proc procedure_definition
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure_definition.pronamespace
    where namespace.nspname in ('public', 'coachfort_internal')
      and procedure_definition.proname <> 'create_workspace_with_owner'
      and procedure_definition.proname ~ '(workspace.*trial|trial.*workspace)'
  ) then
    raise exception 'UX-8G1A1 found a conflicting workspace bootstrap function.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_definition
    join pg_catalog.pg_roles owner_role on owner_role.oid = procedure_definition.proowner
    where procedure_definition.oid = to_regprocedure('public.create_workspace_with_owner(text,text,text)')
      and owner_role.rolname = 'postgres'
      and procedure_definition.prosecdef
      and procedure_definition.proconfig @> array['search_path=public']::text[]
  ) then
    raise exception 'UX-8G1A1 workspace function security prerequisites drifted.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'subscription_plans'
      and column_name = 'is_workspace_trial_default'
  )
  or to_regclass('public.subscription_plans_workspace_trial_default_uidx') is not null
  or exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname in (
        'subscription_plans_workspace_trial_default_duration_check',
        'subscription_plans_workspace_trial_default_status_check'
      )
  ) then
    raise exception 'UX-8G1A1 bootstrap-plan objects already exist or conflict.' using errcode = '55000';
  end if;

  if (select count(*) from public.subscription_plans where code = 'starter') <> 1
     or exists (
       select 1 from public.subscription_plans
       where code = 'starter'
         and (
           status not in ('draft', 'active')
           or trial_days <= 0
           or trial_days > 365
           or char_length((
             coalesce(metadata_json, '{}'::jsonb)
               || jsonb_build_object(
                 'workspace_trial_default', true,
                 'workspace_trial_default_module', 'UX-8G1A1',
                 'workspace_trial_public_purchase_authority', false
               )
           )::text) > 3000
         )
     ) then
    raise exception 'UX-8G1A1 requires one eligible Starter plan with positive trial_days and safe metadata capacity.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.subscription_plans'::regclass
      and constraint_definition.conname = 'subscription_plans_metadata_object_check'
      and lower(pg_get_constraintdef(constraint_definition.oid)) like '%jsonb_typeof(metadata_json)%object%'
      and lower(pg_get_constraintdef(constraint_definition.oid)) like '%3000%'
  ) then
    raise exception 'UX-8G1A1 requires the canonical subscription plan metadata constraint.' using errcode = '55000';
  end if;

  if to_regclass('public.tenant_subscription_assignments_current_unique_idx') is null
     or not exists (
       select 1
       from pg_catalog.pg_index index_definition
       where index_definition.indexrelid = 'public.tenant_subscription_assignments_current_unique_idx'::regclass
         and index_definition.indrelid = 'public.tenant_subscription_assignments'::regclass
         and index_definition.indisunique
         and pg_get_expr(index_definition.indpred, index_definition.indrelid) = 'is_current'
     ) then
    raise exception 'UX-8G1A1 requires the canonical one-current-assignment index.' using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tenant_subscription_assignments'::regclass
      and conname = 'tenant_subscription_assignments_status_check'
      and lower(pg_get_constraintdef(oid)) like '%trial%'
  )
  or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tenant_subscription_assignments'::regclass
      and conname = 'tenant_subscription_assignments_billing_cycle_check'
      and lower(pg_get_constraintdef(oid)) like '%monthly%'
  )
  or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tenant_subscription_assignments'::regclass
      and conname = 'tenant_subscription_assignments_currency_check'
      and lower(pg_get_constraintdef(oid)) like '%inr%'
  )
  or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tenant_subscription_assignments'::regclass
      and conname = 'tenant_subscription_assignments_payment_status_check'
      and lower(pg_get_constraintdef(oid)) like '%not_required%'
  )
  or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tenant_subscription_assignments'::regclass
      and conname = 'tenant_subscription_assignments_source_check'
      and lower(pg_get_constraintdef(oid)) like '%system%'
  ) then
    raise exception 'UX-8G1A1 canonical trial tuple is not accepted by assignment constraints.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name = 'tenant_subscription_assignments'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ) then
    raise exception 'UX-8G1A1 requires zero browser assignment writes.' using errcode = '55000';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure('public.create_workspace_with_owner(text,text,text)')),
    '[[:space:]]+', ' ', 'g'
  )) into v_workspace_source;

  if v_workspace_source not like '%perform public.auth_otp_assert_workspace_creation_allowed()%'
     or v_workspace_source not like '%insert into public.tenants%'
     or v_workspace_source not like '%insert into public.tenant_members%'
     or v_workspace_source like '%insert into public.tenant_subscription_assignments%' then
    raise exception 'UX-8G1A1 workspace bootstrap function drifted from the expected pre-apply body.' using errcode = '55000';
  end if;
end;
$$;

alter table public.subscription_plans
  add column is_workspace_trial_default boolean not null default false;

alter table public.subscription_plans
  add constraint subscription_plans_workspace_trial_default_duration_check
    check (not is_workspace_trial_default or trial_days > 0),
  add constraint subscription_plans_workspace_trial_default_status_check
    check (not is_workspace_trial_default or status in ('draft', 'active'));

create unique index subscription_plans_workspace_trial_default_uidx
on public.subscription_plans (is_workspace_trial_default)
where is_workspace_trial_default;

update public.subscription_plans
set is_workspace_trial_default = true,
    metadata_json = coalesce(metadata_json, '{}'::jsonb)
      || jsonb_build_object(
        'workspace_trial_default', true,
        'workspace_trial_default_module', 'UX-8G1A1',
        'workspace_trial_public_purchase_authority', false
      ),
    updated_at = now()
where code = 'starter'
  and status in ('draft', 'active')
  and trial_days > 0;

do $$
begin
  if (select count(*) from public.subscription_plans where is_workspace_trial_default) <> 1
     or not exists (
       select 1 from public.subscription_plans
       where is_workspace_trial_default
         and code = 'starter'
         and status in ('draft', 'active')
         and trial_days > 0
     ) then
    raise exception 'UX-8G1A1 could not establish exactly one eligible Starter trial default.' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.create_workspace_with_owner(
  workspace_name text,
  workspace_slug text,
  workspace_category text
)
returns table (
  id uuid,
  name text,
  slug text,
  category text,
  owner_user_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user uuid := auth.uid();
  normalized_name text := nullif(trim(workspace_name), '');
  normalized_slug text := nullif(trim(workspace_slug), '');
  candidate_slug text;
  created_tenant public.tenants%rowtype;
  suffix text;
  attempt integer := 0;
  v_constraint_name text;
  v_trial_plan_id uuid;
  v_trial_days integer;
  v_trial_started_at timestamptz;
  v_trial_ends_at timestamptz;
begin
  if requesting_user is null then
    raise exception 'You must be logged in to create a workspace.'
      using errcode = '28000';
  end if;

  if normalized_name is null then
    raise exception 'Workspace name is required.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user::text, 0));

  select t.*
  into created_tenant
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = requesting_user
  order by tm.created_at asc
  limit 1;

  if found then
    return query
    select
      created_tenant.id,
      created_tenant.name,
      created_tenant.slug,
      created_tenant.category,
      created_tenant.owner_user_id;
    return;
  end if;

  select t.*
  into created_tenant
  from public.tenants t
  where t.owner_user_id = requesting_user
  order by t.created_at asc
  limit 1;

  if found then
    insert into public.tenant_members (tenant_id, user_id, role)
    values (created_tenant.id, requesting_user, 'owner')
    on conflict (tenant_id, user_id) do update
    set role = 'owner';

    return query
    select
      created_tenant.id,
      created_tenant.name,
      created_tenant.slug,
      created_tenant.category,
      created_tenant.owner_user_id;
    return;
  end if;

  perform public.auth_otp_assert_workspace_creation_allowed();

  select plan.id, plan.trial_days
  into v_trial_plan_id, v_trial_days
  from public.subscription_plans plan
  where plan.is_workspace_trial_default
    and plan.status in ('draft', 'active')
    and plan.trial_days > 0
  for share;

  if v_trial_plan_id is null or v_trial_days is null then
    raise exception 'Workspace trial authority is unavailable.' using errcode = '55000';
  end if;

  v_trial_started_at := transaction_timestamp();
  v_trial_ends_at := v_trial_started_at + make_interval(days => v_trial_days);
  candidate_slug := coalesce(normalized_slug, 'workspace');

  loop
    begin
      insert into public.tenants (
        name,
        slug,
        category,
        owner_user_id,
        trial_started_at,
        trial_ends_at,
        is_trial_active
      )
      values (
        normalized_name,
        candidate_slug,
        workspace_category,
        requesting_user,
        v_trial_started_at,
        v_trial_ends_at,
        true
      )
      returning * into created_tenant;

      insert into public.tenant_members (tenant_id, user_id, role)
      values (created_tenant.id, requesting_user, 'owner')
      on conflict (tenant_id, user_id) do update
      set role = 'owner';

      insert into public.tenant_subscription_assignments (
        tenant_id,
        plan_id,
        status,
        billing_cycle,
        currency,
        trial_started_at,
        trial_ends_at,
        current_period_start,
        current_period_end,
        grace_period_ends_at,
        payment_status,
        source,
        is_current,
        metadata_json,
        created_by,
        updated_by
      )
      values (
        created_tenant.id,
        v_trial_plan_id,
        'trial',
        'monthly',
        'INR',
        v_trial_started_at,
        v_trial_ends_at,
        null,
        null,
        null,
        'not_required',
        'system',
        true,
        jsonb_build_object(
          'module', 'UX-8G1A1',
          'authority', 'workspace_trial_bootstrap',
          'trial_days', v_trial_days,
          'trial_placeholders_non_commercial', true,
          'paid_currency_authority', false,
          'paid_billing_cycle_authority', false
        ),
        requesting_user,
        requesting_user
      );

      if lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '')) <> 'google' then
        update public.auth_otp_challenges challenge
        set completed_at = now()
        where challenge.id = (
          select latest.id
          from public.auth_otp_challenges latest
          where latest.purpose = 'signup_email_verification'
            and latest.email_normalized = lower(coalesce(auth.jwt() ->> 'email', ''))
            and latest.verified_at is not null
            and latest.consumed_at is not null
            and latest.completed_at is null
            and latest.expires_at >= now()
          order by latest.verified_at desc
          limit 1
        );
      end if;

      return query
      select
        created_tenant.id,
        created_tenant.name,
        created_tenant.slug,
        created_tenant.category,
        created_tenant.owner_user_id;
      return;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;

        if v_constraint_name <> 'tenants_slug_key' then
          raise;
        end if;

        attempt := attempt + 1;

        if attempt > 5 then
          raise;
        end if;

        suffix := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
        candidate_slug := left(coalesce(normalized_slug, 'workspace'), 42) || '-' || suffix;
    end;
  end loop;
end;
$$;

alter function public.create_workspace_with_owner(text, text, text) owner to postgres;
revoke all on function public.create_workspace_with_owner(text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.create_workspace_with_owner(text, text, text)
to authenticated;

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with default_plan as (
  select count(*) as default_count,
    count(*) filter (
      where code = 'starter'
        and status in ('draft', 'active')
        and trial_days > 0
    ) as valid_starter_count,
    min(trial_days) as trial_days
  from public.subscription_plans
  where is_workspace_trial_default
), default_integrity as (
  select
    to_regclass('public.subscription_plans_workspace_trial_default_uidx') is not null
      and exists (
        select 1
        from pg_catalog.pg_index index_definition
        where index_definition.indexrelid = 'public.subscription_plans_workspace_trial_default_uidx'::regclass
          and index_definition.indrelid = 'public.subscription_plans'::regclass
          and index_definition.indisunique
          and pg_get_expr(index_definition.indpred, index_definition.indrelid) = 'is_workspace_trial_default'
      ) as unique_default,
    count(*) filter (where conname = 'subscription_plans_workspace_trial_default_duration_check') = 1 as positive_duration,
    count(*) filter (where conname = 'subscription_plans_workspace_trial_default_status_check') = 1 as eligible_status
  from pg_catalog.pg_constraint
  where conrelid = 'public.subscription_plans'::regclass
), assignment_tuple_contract as (
  select
    bool_or(conname = 'tenant_subscription_assignments_status_check'
      and lower(pg_get_constraintdef(oid)) like '%trial%') as trial_allowed,
    bool_or(conname = 'tenant_subscription_assignments_billing_cycle_check'
      and lower(pg_get_constraintdef(oid)) like '%monthly%') as monthly_allowed,
    bool_or(conname = 'tenant_subscription_assignments_currency_check'
      and lower(pg_get_constraintdef(oid)) like '%inr%') as inr_allowed,
    bool_or(conname = 'tenant_subscription_assignments_payment_status_check'
      and lower(pg_get_constraintdef(oid)) like '%not_required%') as not_required_allowed,
    bool_or(conname = 'tenant_subscription_assignments_source_check'
      and lower(pg_get_constraintdef(oid)) like '%system%') as system_source_allowed
  from pg_catalog.pg_constraint
  where conrelid = 'public.tenant_subscription_assignments'::regclass
), workspace_function as (
  select
    procedure_definition.oid,
    owner_role.rolname as owner_name,
    procedure_definition.prosecdef as security_definer,
    procedure_definition.proconfig as config,
    lower(regexp_replace(pg_get_functiondef(procedure_definition.oid), '[[:space:]]+', ' ', 'g')) as source
  from pg_catalog.pg_proc procedure_definition
  join pg_catalog.pg_roles owner_role on owner_role.oid = procedure_definition.proowner
  where procedure_definition.oid = to_regprocedure('public.create_workspace_with_owner(text,text,text)')
), workspace_acl as (
  select
    coalesce(has_function_privilege('authenticated', 'public.create_workspace_with_owner(text,text,text)', 'EXECUTE'), false) as authenticated_execute,
    coalesce(has_function_privilege('anon', 'public.create_workspace_with_owner(text,text,text)', 'EXECUTE'), false) as anon_execute,
    coalesce(has_function_privilege('service_role', 'public.create_workspace_with_owner(text,text,text)', 'EXECUTE'), false) as service_execute,
    exists (
      select 1
      from pg_catalog.pg_proc procedure_definition,
        lateral aclexplode(coalesce(procedure_definition.proacl, acldefault('f', procedure_definition.proowner))) acl
      where procedure_definition.oid = to_regprocedure('public.create_workspace_with_owner(text,text,text)')
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute
), bootstrap_function_inventory as (
  select
    count(*) filter (
      where namespace.nspname = 'public'
        and procedure_definition.proname = 'create_workspace_with_owner'
    ) as workspace_overload_count,
    count(*) filter (
      where procedure_definition.proname <> 'create_workspace_with_owner'
        and procedure_definition.proname ~ '(workspace.*trial|trial.*workspace)'
    ) as conflicting_trial_helper_count
  from pg_catalog.pg_proc procedure_definition
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure_definition.pronamespace
  where namespace.nspname in ('public', 'coachfort_internal')
), contracts as (
  select
    source like '%perform pg_advisory_xact_lock(hashtextextended(requesting_user::text, 0))%'
      and source like '%from public.tenant_members tm%if found then%return query%return;%'
      and source like '%where t.owner_user_id = requesting_user%if found then%insert into public.tenant_members%return query%return;%'
      and position('perform public.auth_otp_assert_workspace_creation_allowed()' in source)
        < position('from public.subscription_plans plan' in source)
      and position('from public.subscription_plans plan' in source)
        < position('insert into public.tenants' in source)
      and source ~ 'insert into public\.tenants .*insert into public\.tenant_members .*insert into public\.tenant_subscription_assignments'
      and source like '%for share%'
      and source like '%v_trial_started_at := transaction_timestamp()%'
      and source like '%v_trial_ends_at := v_trial_started_at + make_interval(days => v_trial_days)%'
      and source like '%''trial'', ''monthly'', ''inr''%'
      and source like '%null, null, null, ''not_required'', ''system'', true%'
      and source like '%''trial_placeholders_non_commercial'', true%'
      and source like '%''trial_days'', v_trial_days%'
      and source like '%get stacked diagnostics v_constraint_name = constraint_name%'
      and source like '%if v_constraint_name <> ''tenants_slug_key'' then raise%'
      as atomic_trial_bootstrap,
    source like '%where plan.is_workspace_trial_default%'
      and source like '%plan.status in (''draft'', ''active'')%'
      and source like '%plan.trial_days > 0%'
      and source not like '%plan.code =%'
      as marker_driven_plan_resolution,
    source not like '%tenant_payment_orders%'
      and source not like '%tenant_payment_attempts%'
      and source not like '%tenant_plan_activation_events%'
      and source not like '%invoices%'
      and source not like '%platform_billing_receipts%'
      and source not like '%razorpay%'
      as no_billing_side_effects
  from workspace_function
), lifecycle_contract as (
  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)')),
    '[[:space:]]+', ' ', 'g'
  )) as source
), ux8f_contract as (
  select
    to_regprocedure('public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)') is not null as order_authority,
    to_regprocedure('public.activate_tenant_plan_after_verified_payment(uuid)') is not null as activation_authority,
    to_regprocedure('public.issue_platform_invoice_for_activation_server(uuid)') is not null as invoice_authority,
    to_regprocedure('public.issue_platform_receipt_for_fulfillment_server(uuid)') is not null as receipt_authority
), historical_state as (
  select
    count(*) as tenant_count,
    count(*) filter (where assignment_history.assignment_count = 0) as zero_assignment_history,
    count(*) filter (where assignment_history.current_count > 0) as with_current_assignment
  from public.tenants tenant
  cross join lateral (
    select count(*) as assignment_count,
      count(*) filter (where assignment.is_current) as current_count
    from public.tenant_subscription_assignments assignment
    where assignment.tenant_id = tenant.id
  ) assignment_history
), bootstrap_assignment_integrity as (
  select
    count(*) filter (
      where assignment.status <> 'trial'
        or assignment.payment_status <> 'not_required'
        or assignment.billing_cycle <> 'monthly'
        or assignment.currency <> 'INR'
        or assignment.current_period_start is not null
        or assignment.current_period_end is not null
        or assignment.grace_period_ends_at is not null
        or assignment.trial_started_at is null
        or assignment.trial_ends_at is null
        or case
          when coalesce(assignment.metadata_json->>'trial_days', '') ~ '^[1-9][0-9]*$'
            then assignment.trial_ends_at is distinct from assignment.trial_started_at
              + make_interval(days => (assignment.metadata_json->>'trial_days')::integer)
          else true
        end
        or assignment.trial_started_at is distinct from tenant.trial_started_at
        or assignment.trial_ends_at is distinct from tenant.trial_ends_at
        or not tenant.is_trial_active
    ) as invalid_bootstrap_assignments,
    count(*) filter (
      where tenant.created_at < assignment.trial_started_at - interval '1 second'
    ) as historical_backfill_signals
  from public.tenant_subscription_assignments assignment
  join public.subscription_plans plan on plan.id = assignment.plan_id
  join public.tenants tenant on tenant.id = assignment.tenant_id
  where assignment.metadata_json->>'module' = 'UX-8G1A1'
    and assignment.metadata_json->>'authority' = 'workspace_trial_bootstrap'
), browser_assignment_writes as (
  select count(*) as grant_count
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'tenant_subscription_assignments'
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
), business_counts as (
  select jsonb_build_object(
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'payment_attempts', (select count(*) from public.tenant_payment_attempts),
    'activation_events', (select count(*) from public.tenant_plan_activation_events),
    'platform_invoices', (select count(*) from public.invoices),
    'platform_receipts', (select count(*) from public.platform_billing_receipts)
  ) as value
)
select jsonb_build_object(
  'bundle', 'UX-8G1A1',
  'security_gate',
    (select default_count = 1 and valid_starter_count = 1 and trial_days > 0 from default_plan)
    and (select unique_default and positive_duration and eligible_status from default_integrity)
    and (select trial_allowed and monthly_allowed and inr_allowed
      and not_required_allowed and system_source_allowed from assignment_tuple_contract)
    and (select owner_name = 'postgres' and security_definer
      and config @> array['search_path=public, pg_temp']::text[] from workspace_function)
    and (select authenticated_execute and not anon_execute and not service_execute and not public_execute from workspace_acl)
    and (select workspace_overload_count = 1 and conflicting_trial_helper_count = 0
      from bootstrap_function_inventory)
    and (select atomic_trial_bootstrap and marker_driven_plan_resolution
      and no_billing_side_effects from contracts)
    and (select source like '%if v_assignment.status = ''trial'' then%'
      and source like '%now() < v_assignment.trial_ends_at%'
      and source like '%trial_period_elapsed%'
      and source not like '%coalesce(v_assignment.grace_period_ends_at%' from lifecycle_contract)
    and (select order_authority and activation_authority and invoice_authority and receipt_authority from ux8f_contract)
    and (select invalid_bootstrap_assignments = 0 and historical_backfill_signals = 0 from bootstrap_assignment_integrity)
    and (select grant_count = 0 from browser_assignment_writes),
  'default_plan', (select to_jsonb(default_plan) from default_plan),
  'default_plan_integrity', (select to_jsonb(default_integrity) from default_integrity),
  'assignment_trial_tuple', (select to_jsonb(assignment_tuple_contract) from assignment_tuple_contract),
  'workspace_function', (select jsonb_build_object(
    'owner', owner_name,
    'security_definer', security_definer,
    'config', config
  ) from workspace_function),
  'workspace_acl', (select to_jsonb(workspace_acl) from workspace_acl),
  'bootstrap_function_inventory', (select to_jsonb(bootstrap_function_inventory) from bootstrap_function_inventory),
  'workspace_contract', (select to_jsonb(contracts) from contracts),
  'historical_assignment_state', (select to_jsonb(historical_state) from historical_state),
  'bootstrap_assignment_integrity', (select to_jsonb(bootstrap_assignment_integrity) from bootstrap_assignment_integrity),
  'browser_assignment_writes', (select grant_count from browser_assignment_writes),
  'ux8g1a_lifecycle_unchanged', (select source like '%if v_assignment.status = ''trial'' then%'
    and source like '%trial_period_elapsed%' from lifecycle_contract),
  'ux8f_authority_unchanged', (select to_jsonb(ux8f_contract) from ux8f_contract),
  'payment_document_counts', (select value from business_counts),
  'migration_backfilled_historical_tenants', false,
  'ux8g1b_changed', false
);
*/
