-- Bundle UX-8G1B: Subscription Operational Lifecycle Enforcement
-- Review before execution. This file has not been executed by this change.

/*
PRE-APPLY READ-ONLY VERIFICATION

with required_functions(identity) as (
  values
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'),
    ('public.resolve_effective_feature_access(uuid,text)'),
    ('public.feature_access_effective_rows(uuid)'),
    ('public.get_tenant_feature_access(uuid)'),
    ('public.get_portal_feature_access(uuid)'),
    ('public.get_tenant_entitlement_state(uuid)'),
    ('public.assert_tenant_usage_limit(uuid,text,integer)'),
    ('public.assert_tenant_entity_usage_limit(uuid,text,integer,boolean)'),
    ('public.m71_7p6d_assert_entity_usage_limit_internal(uuid,text,integer)'),
    ('coachfort_internal.assert_private_storage_quota(uuid,bigint,integer,boolean)'),
    ('public.get_tenant_subscription_lifecycle(uuid)'),
    ('public.get_tenant_billing_profile(uuid)'),
    ('public.get_platform_billing_documents(uuid)'),
    ('public.request_plan_upgrade(uuid,text,text)'),
    ('public.create_workspace_with_owner(text,text,text)'),
    ('public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'),
    ('public.get_public_site(text)'),
    ('public.submit_public_site_lead(text,text,text,text,text,uuid,jsonb)'),
    ('public.is_platform_admin()'),
    ('public.platform_current_role()'),
    ('public.mark_notification_read_secure(uuid,uuid)'),
    ('public.get_mobile_notifications(integer,integer)')
), prerequisite_state as (
  select identity, to_regprocedure(identity) is not null as installed
  from required_functions
), workspace_bootstrap_function as (
  select
    procedure.oid,
    owner_role.rolname as owner_name,
    procedure.prosecdef as security_definer,
    procedure.proconfig as config,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) as source,
    coalesce(has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    ), false) as authenticated_execute,
    coalesce(has_function_privilege('anon', procedure.oid, 'EXECUTE'), false)
      as anon_execute,
    coalesce(has_function_privilege(
      'service_role', procedure.oid, 'EXECUTE'
    ), false) as service_role_execute,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute
  from (select to_regprocedure(
    'public.create_workspace_with_owner(text,text,text)'
  ) as oid) expected
  left join pg_proc procedure on procedure.oid = expected.oid
  left join pg_roles owner_role on owner_role.oid = procedure.proowner
), workspace_bootstrap_prerequisite as (
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'subscription_plans'
        and column_name = 'is_workspace_trial_default'
        and data_type = 'boolean'
    ) as marker_column_present,
    (select count(*) from public.subscription_plans
      where is_workspace_trial_default) as default_plan_count,
    (select count(*) from public.subscription_plans
      where is_workspace_trial_default
        and status in ('draft', 'active')
        and trial_days > 0) as eligible_default_plan_count,
    bootstrap.oid is not null
      and bootstrap.owner_name = 'postgres'
      and bootstrap.security_definer
      and bootstrap.config @> array['search_path=public, pg_temp']::text[]
      as secure_workspace_rpc,
    bootstrap.authenticated_execute
      and not bootstrap.anon_execute
      and not bootstrap.service_role_execute
      and not bootstrap.public_execute as authenticated_only_rpc,
    bootstrap.source like
      '%insert into public.tenant_subscription_assignments%'
      and bootstrap.source like '%''trial'', ''monthly'', ''inr''%'
      and bootstrap.source like '%''not_required'', ''system'', true%'
      as canonical_trial_insert,
    bootstrap.source like '%where plan.is_workspace_trial_default%'
      and bootstrap.source like '%plan.status in (''draft'', ''active'')%'
      and bootstrap.source like '%plan.trial_days > 0%'
      and bootstrap.source not like '%plan.code =%'
      as marker_driven_resolution
  from workspace_bootstrap_function bootstrap
), tenant_coverage as (
  select
    tenant.id as tenant_id,
    exists (
      select 1
      from public.tenant_subscription_assignments assignment
      where assignment.tenant_id = tenant.id
        and assignment.is_current
    ) as has_current_assignment,
    exists (
      select 1
      from public.tenant_subscription_assignments assignment
      where assignment.tenant_id = tenant.id
    ) as has_any_assignment,
    exists (
      select 1
      from public.tenant_members member
      where member.tenant_id = tenant.id
    ) as has_membership_identity,
    exists (
      select 1 from public.courses course where course.tenant_id = tenant.id
    ) or exists (
      select 1 from public.students student where student.tenant_id = tenant.id
    ) or exists (
      select 1 from public.enrollments enrollment
      where enrollment.tenant_id = tenant.id
    ) or exists (
      select 1 from public.sessions session_row
      where session_row.tenant_id = tenant.id
    ) or exists (
      select 1 from public.assignments assignment
      where assignment.tenant_id = tenant.id
    ) as has_operational_rows
  from public.tenants tenant
), classified_tenants as (
  select
    coverage.*,
    (
      coverage.has_current_assignment
      or coverage.has_any_assignment
      or coverage.has_membership_identity
      or coverage.has_operational_rows
    ) as operational_in_scope
  from tenant_coverage coverage
), current_lifecycle as (
  select
    coverage.tenant_id,
    coverage.has_current_assignment,
    coverage.has_any_assignment,
    assignment.status as stored_status,
    coachfort_internal.tenant_subscription_effective_lifecycle(
      coverage.tenant_id
    ) as lifecycle
  from classified_tenants coverage
  left join public.tenant_subscription_assignments assignment
    on assignment.tenant_id = coverage.tenant_id
   and assignment.is_current
  where coverage.operational_in_scope
), lifecycle_counts as (
  select
    count(*) as operational_tenant_count,
    count(*) filter (where has_current_assignment) as current_assignment_count,
    count(*) filter (
      where lifecycle->>'effective_state' = 'active'
        and coalesce((lifecycle->>'operational_allowed')::boolean, false)
    ) as active_count,
    count(*) filter (
      where lifecycle->>'effective_state' = 'grace'
        and coalesce((lifecycle->>'operational_allowed')::boolean, false)
    ) as grace_count,
    count(*) filter (where lifecycle->>'effective_state' = 'expired') as expired_count,
    count(*) filter (
      where has_current_assignment
        and (
          lifecycle->>'effective_state' = 'malformed'
          or lifecycle->>'reason' in (
           'invalid_status_payment_combination',
           'missing_period_authority',
           'future_period_start',
           'invalid_period_ordering',
           'missing_trial_authority',
           'future_trial_start',
           'invalid_trial_ordering',
           'invalid_grace_authority'
          )
        )
    ) as malformed_count,
    count(*) filter (
      where stored_status in ('active', 'grace', 'past_due')
        and lifecycle->>'effective_state' = 'expired'
    ) as dynamically_expired_renewable_count
  from current_lifecycle
), tenant_coverage_counts as (
  select
    count(*) as tenant_count,
    count(*) filter (where operational_in_scope) as operational_tenant_count,
    count(*) filter (where has_current_assignment)
      as canonical_current_assignment_count,
    count(*) filter (where not has_any_assignment)
      as legacy_pre_subscription_inactive_count,
    count(*) filter (
      where has_any_assignment and not has_current_assignment
    ) as assignment_history_without_current_count,
    count(*) filter (
      where not operational_in_scope
    ) as dormant_unassigned_tenant_count,
    coalesce(jsonb_agg(tenant_id order by tenant_id) filter (
      where not has_any_assignment
    ), '[]'::jsonb) as legacy_pre_subscription_inactive_tenant_ids,
    coalesce(jsonb_agg(tenant_id order by tenant_id) filter (
      where has_any_assignment and not has_current_assignment
    ), '[]'::jsonb) as assignment_history_without_current_tenant_ids,
    coalesce(jsonb_agg(tenant_id order by tenant_id) filter (
      where not operational_in_scope
    ), '[]'::jsonb) as dormant_unassigned_tenant_ids
  from classified_tenants
), target_tables(table_name) as (
  select unnest(array[
    'courses','course_sections','lessons','students','enrollments','cohorts',
    'cohort_members','sessions','attendance_records','assignments',
    'assignment_submissions','academy_announcements','community_posts',
    'community_comments','document_records','finance_settings','finance_fee_plans',
    'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
    'payments','receipts','payment_links','conversation_threads',
    'conversation_participants','conversation_messages','automation_rules',
    'automation_rule_conditions','automation_rule_actions','automation_runs',
    'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
    'workflow_templates',
    'workflow_template_steps','workflow_runs','workflow_run_steps',
    'approval_requests','delegated_permissions','crm_leads','crm_lead_notes',
    'crm_follow_up_tasks','marketing_campaigns','marketing_campaign_leads',
    'marketing_message_templates','trainer_course_assignments',
    'trainer_cohort_assignments','team_invitations','student_portal_invitations',
    'lesson_progress','certificates','tenant_feature_settings','reminders',
    'notification_preferences','communication_logs','notifications',
    'public_site_leads','tenant_members'
  ]::text[])
), authenticated_target_authority as (
  select
    target.table_name,
    class.relrowsecurity as rls_enabled,
    exists (
      select 1
      from information_schema.columns column_state
      where column_state.table_schema = 'public'
        and column_state.table_name = target.table_name
        and column_state.column_name = 'tenant_id'
    ) as tenant_key_present,
    case target.table_name
      when 'students' then 'student_bootstrap_policy'
      when 'notifications' then 'notification_recovery_policy'
      when 'tenant_members' then 'membership_bootstrap_policy'
      else 'generic_operational_policy'
    end as intended_enforcement
  from target_tables target
  join pg_class class on class.relname = target.table_name
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relkind in ('r', 'p')
    and (
      has_table_privilege('authenticated', class.oid, 'SELECT')
      or has_table_privilege('authenticated', class.oid, 'INSERT')
      or has_table_privilege('authenticated', class.oid, 'UPDATE')
      or has_table_privilege('authenticated', class.oid, 'DELETE')
    )
), operational_rls_baseline as (
  select
    count(*) as authenticated_operational_table_count,
    count(*) filter (
      where not rls_enabled or not tenant_key_present
    ) as unclassified_bypass_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'rls_enabled', rls_enabled,
      'tenant_key_present', tenant_key_present,
      'intended_enforcement', intended_enforcement
    ) order by table_name) filter (
      where not rls_enabled or not tenant_key_present
    ), '[]'::jsonb) as unclassified_bypasses
  from authenticated_target_authority
), feature_row_authority as (
  select
    procedure.oid is not null as installed,
    owner_role.rolname = 'postgres' as postgres_owned,
    procedure.prosecdef as security_definer,
    procedure.provolatile = 's' as stable,
    coalesce(procedure.proconfig, array[]::text[])
      && array['search_path=public', 'search_path=public, pg_temp']
      as fixed_search_path,
    not has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    ) as authenticated_execute_absent,
    not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      as anon_execute_absent,
    not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      as service_role_execute_absent,
    not exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute_absent,
    lower(pg_get_functiondef(to_regprocedure(
      'public.get_tenant_feature_access(uuid)'
    ))) like '%feature_access_current_role%'
      and lower(pg_get_functiondef(to_regprocedure(
        'public.get_tenant_feature_access(uuid)'
      ))) like '%is_platform_admin%'
      as tenant_wrapper_auth_bound,
    lower(pg_get_functiondef(to_regprocedure(
      'public.get_portal_feature_access(uuid)'
    ))) like '%has_any_active_student_portal_account%'
      and lower(pg_get_functiondef(to_regprocedure(
        'public.get_portal_feature_access(uuid)'
      ))) like '%auth.uid()%'
      as portal_wrapper_auth_bound
  from (select to_regprocedure(
    'public.feature_access_effective_rows(uuid)'
  ) oid) expected
  left join pg_proc procedure on procedure.oid = expected.oid
  left join pg_roles owner_role on owner_role.oid = procedure.proowner
), platform_authority as (
  select
    admin_check.oid is not null and role_check.oid is not null as installed,
    admin_owner.rolname = 'postgres' and role_owner.rolname = 'postgres'
      as postgres_owned,
    admin_check.prosecdef and role_check.prosecdef as security_definer,
    admin_check.provolatile = 's' and role_check.provolatile = 's' as stable,
    coalesce(admin_check.proconfig, array[]::text[])
      && array['search_path=public', 'search_path=public, pg_temp']
      and coalesce(role_check.proconfig, array[]::text[])
        && array['search_path=public', 'search_path=public, pg_temp']
      as fixed_search_path,
    lower(pg_get_functiondef(admin_check.oid)) like
      '%public.platform_current_role()%'
      and lower(pg_get_functiondef(admin_check.oid)) not like
        '%tenant_members%' as admin_uses_platform_role_only,
    lower(pg_get_functiondef(role_check.oid)) like
      '%from public.platform_admin_users%'
      and lower(pg_get_functiondef(role_check.oid)) like '%auth.uid()%'
      and lower(pg_get_functiondef(role_check.oid)) like
        '%status = ''active''%'
      and lower(pg_get_functiondef(role_check.oid)) not like
        '%tenant_members%' as role_is_auth_bound,
    has_function_privilege(
      'authenticated', admin_check.oid, 'EXECUTE'
    ) as authenticated_execute,
    not has_function_privilege('anon', admin_check.oid, 'EXECUTE')
      as anon_execute_absent,
    not has_function_privilege('service_role', admin_check.oid, 'EXECUTE')
      as service_role_execute_absent,
    not exists (
      select 1
      from aclexplode(coalesce(
        admin_check.proacl,
        acldefault('f', admin_check.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute_absent
  from pg_proc admin_check
  join pg_roles admin_owner on admin_owner.oid = admin_check.proowner
  cross join pg_proc role_check
  join pg_roles role_owner on role_owner.oid = role_check.proowner
  where admin_check.oid = to_regprocedure('public.is_platform_admin()')
    and role_check.oid = to_regprocedure('public.platform_current_role()')
), browser_grants as (
  select
    privilege.grantee,
    privilege.table_name,
    array_agg(distinct privilege.privilege_type order by privilege.privilege_type) privileges
  from information_schema.table_privileges privilege
  join target_tables target on target.table_name = privilege.table_name
  where privilege.table_schema = 'public'
    and privilege.grantee in ('anon', 'authenticated')
    and privilege.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
  group by privilege.grantee, privilege.table_name
), anon_boundary as (
  select
    count(*) filter (
      where privilege.grantee in ('PUBLIC', 'anon')
        and privilege.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
    ) as direct_operational_grant_count,
    has_function_privilege('anon', 'public.get_public_site(text)', 'EXECUTE')
      as public_site_callable,
    has_function_privilege(
      'anon',
      'public.submit_public_site_lead(text,text,text,text,text,uuid,jsonb)',
      'EXECUTE'
    ) as public_lead_callable
  from information_schema.table_privileges privilege
  join target_tables target on target.table_name = privilege.table_name
  where privilege.table_schema = 'public'
), protected_baseline as (
  select
    to_regclass('public.tenant_members') is not null
      and has_table_privilege('authenticated', 'public.tenant_members', 'SELECT')
      and not has_table_privilege(
        'authenticated', 'public.tenant_members', 'INSERT,UPDATE,DELETE'
      ) tenant_members_safe,
    to_regclass('public.notifications') is not null
      and to_regclass('public.reminders') is not null
      and has_table_privilege('authenticated', 'public.notifications', 'SELECT')
      and not has_table_privilege(
        'authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE'
      )
      and not has_table_privilege(
        'authenticated', 'public.reminders', 'INSERT,UPDATE,DELETE'
      ) notification_surfaces_safe
), notification_type_inventory as (
  select
    count(*) filter (where type = 'payment_reminder')
      as payment_reminder_count,
    count(*) filter (where type = 'invoice_notice')
      as invoice_notice_count,
    count(*) filter (where type = 'subscription_notice')
      as subscription_notice_count
  from public.notifications
), conflicts as (
  select
    count(*) filter (
      where to_regprocedure(identity) is not null
    ) as conflicting_function_count
  from (values
    ('coachfort_internal.tenant_operational_access_allowed(uuid)'),
    ('coachfort_internal.assert_tenant_operational_access(uuid)'),
    ('coachfort_internal.student_bootstrap_identity_allowed(uuid,uuid,uuid)'),
    ('coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)'),
    ('coachfort_internal.resolve_effective_feature_access_authority(uuid,text)'),
    ('public.get_current_tenant_operational_state(uuid)'),
    ('public.assert_tenant_operational_access(uuid)')
  ) expected(identity)
), existing_policies as (
  select count(*) as policy_count
  from pg_policies
  where schemaname = 'public'
    and policyname like 'UX8G1B%'
), existing_triggers as (
  select count(*) as trigger_count
  from pg_trigger
  where not tgisinternal
    and tgname = 'ux8g1b_enforce_operational_lifecycle'
)
select jsonb_build_object(
  'ready_for_apply',
    (select bool_and(installed) from prerequisite_state)
    and (select marker_column_present
      and default_plan_count = 1
      and eligible_default_plan_count = 1
      and secure_workspace_rpc
      and authenticated_only_rpc
      and canonical_trial_insert
      and marker_driven_resolution
      from workspace_bootstrap_prerequisite)
    and (select malformed_count = 0 from lifecycle_counts)
    and (select assignment_history_without_current_count = 0
      from tenant_coverage_counts)
    and (select unclassified_bypass_count = 0
      from operational_rls_baseline)
    and (select installed and postgres_owned and security_definer and stable
      and fixed_search_path and authenticated_execute_absent
      and anon_execute_absent and service_role_execute_absent
      and public_execute_absent and tenant_wrapper_auth_bound
      and portal_wrapper_auth_bound from feature_row_authority)
    and (select installed and postgres_owned and security_definer and stable
      and fixed_search_path and admin_uses_platform_role_only
      and role_is_auth_bound and authenticated_execute
      and anon_execute_absent and service_role_execute_absent
      and public_execute_absent from platform_authority)
    and (select direct_operational_grant_count = 0
      and public_site_callable and public_lead_callable from anon_boundary)
    and (select tenant_members_safe and notification_surfaces_safe
      from protected_baseline)
    and (select conflicting_function_count = 0 from conflicts)
    and (select policy_count = 0 from existing_policies)
    and (select trigger_count = 0 from existing_triggers)
    and not exists (
      select 1
      from unnest(string_to_array(
        coalesce(current_setting('pgrst.db_schemas', true), ''),
        ','
      )) exposed(schema_name)
      where trim(exposed.schema_name) = 'coachfort_internal'
    )
    and not exists (
      select 1
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname in (
          'tenant_subscription_assignments',
          'tenant_members',
          'student_portal_accounts'
        )
        and class.relforcerowsecurity
    )
    and has_schema_privilege(
      'authenticated',
      'coachfort_internal',
      'USAGE'
    ),
  'prerequisites', (select jsonb_object_agg(identity, installed) from prerequisite_state),
  'workspace_bootstrap_prerequisite',
    (select to_jsonb(workspace_bootstrap_prerequisite)
      from workspace_bootstrap_prerequisite),
  'lifecycle_counts', (select to_jsonb(lifecycle_counts) from lifecycle_counts),
  'tenant_coverage', (select to_jsonb(tenant_coverage_counts) from tenant_coverage_counts),
  'operational_rls_baseline', (select to_jsonb(operational_rls_baseline) from operational_rls_baseline),
  'feature_row_authority', (select to_jsonb(feature_row_authority) from feature_row_authority),
  'platform_authority', (select to_jsonb(platform_authority) from platform_authority),
  'browser_grants', coalesce((select jsonb_agg(to_jsonb(browser_grants) order by table_name) from browser_grants), '[]'::jsonb),
  'anonymous_boundary', (select to_jsonb(anon_boundary) from anon_boundary),
  'protected_baseline', (select to_jsonb(protected_baseline) from protected_baseline),
  'notification_type_inventory', (select to_jsonb(notification_type_inventory) from notification_type_inventory),
  'conflicting_functions', (select conflicting_function_count from conflicts),
  'existing_operational_policies', (select policy_count from existing_policies),
  'existing_operational_triggers', (select trigger_count from existing_triggers),
  'stored_status_rewrite_required', false
);
*/

begin;

do $$
begin
  if to_regprocedure(
       'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
     ) is null
     or to_regprocedure('public.resolve_effective_feature_access(uuid,text)') is null
     or to_regprocedure('public.feature_access_effective_rows(uuid)') is null
     or to_regprocedure('public.assert_tenant_usage_limit(uuid,text,integer)') is null
     or to_regprocedure(
       'public.assert_tenant_entity_usage_limit(uuid,text,integer,boolean)'
     ) is null
     or to_regprocedure(
       'public.m71_7p6d_assert_entity_usage_limit_internal(uuid,text,integer)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.assert_private_storage_quota(uuid,bigint,integer,boolean)'
     ) is null
     or to_regprocedure('public.get_public_site(text)') is null
     or to_regprocedure(
       'public.submit_public_site_lead(text,text,text,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure('public.is_platform_admin()') is null
     or to_regprocedure('public.platform_current_role()') is null
     or to_regprocedure(
       'public.mark_notification_read_secure(uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.get_mobile_notifications(integer,integer)'
     ) is null
     or to_regprocedure(
       'public.create_workspace_with_owner(text,text,text)'
     ) is null then
    raise exception 'UX-8G1B prerequisites are not installed.'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'subscription_plans'
         and column_name = 'is_workspace_trial_default'
         and data_type = 'boolean'
     )
     or (select count(*) from public.subscription_plans
       where is_workspace_trial_default) <> 1
     or (select count(*) from public.subscription_plans
       where is_workspace_trial_default
         and status in ('draft', 'active')
         and trial_days > 0) <> 1
     or not exists (
       select 1
       from pg_proc procedure
       join pg_roles owner_role on owner_role.oid = procedure.proowner
       where procedure.oid = to_regprocedure(
         'public.create_workspace_with_owner(text,text,text)'
       )
         and owner_role.rolname = 'postgres'
         and procedure.prosecdef
         and procedure.proconfig
           @> array['search_path=public, pg_temp']::text[]
         and has_function_privilege(
           'authenticated', procedure.oid, 'EXECUTE'
         )
         and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
         and not has_function_privilege(
           'service_role', procedure.oid, 'EXECUTE'
         )
         and not exists (
           select 1
           from aclexplode(coalesce(
             procedure.proacl,
             acldefault('f', procedure.proowner)
           )) acl
           where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
         )
         and lower(regexp_replace(
           pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
         )) like '%insert into public.tenant_subscription_assignments%'
         and lower(regexp_replace(
           pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
         )) like '%''trial'', ''monthly'', ''inr''%'
         and lower(regexp_replace(
           pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
         )) like '%''not_required'', ''system'', true%'
         and lower(regexp_replace(
           pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
         )) like '%where plan.is_workspace_trial_default%'
         and lower(regexp_replace(
           pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
         )) like '%plan.status in (''draft'', ''active'')%'
         and lower(regexp_replace(
           pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
         )) like '%plan.trial_days > 0%'
         and lower(regexp_replace(
           pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
         )) not like '%plan.code =%'
     ) then
    raise exception 'Canonical workspace trial bootstrap authority is unavailable.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from unnest(string_to_array(
      coalesce(current_setting('pgrst.db_schemas', true), ''),
      ','
    )) exposed(schema_name)
    where trim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'coachfort_internal must not be PostgREST-exposed.'
      using errcode = '55000';
  end if;

  if not has_schema_privilege(
    'authenticated',
    'coachfort_internal',
    'USAGE'
  ) then
    raise exception 'Authenticated RLS evaluation lacks internal schema usage.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = any(array[
        'courses','course_sections','lessons','students','enrollments','cohorts',
        'cohort_members','sessions','attendance_records','assignments',
        'assignment_submissions','academy_announcements','community_posts',
        'community_comments','document_records','finance_settings','finance_fee_plans',
        'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
        'payments','receipts','payment_links','conversation_threads',
        'conversation_participants','conversation_messages','automation_rules',
        'automation_rule_conditions','automation_rule_actions','automation_runs',
        'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
        'workflow_templates','workflow_template_steps','workflow_runs',
        'workflow_run_steps','approval_requests','delegated_permissions','crm_leads',
        'crm_lead_notes','crm_follow_up_tasks','marketing_campaigns',
        'marketing_campaign_leads','marketing_message_templates',
        'trainer_course_assignments','trainer_cohort_assignments','team_invitations',
        'student_portal_invitations','lesson_progress','certificates',
        'tenant_feature_settings','reminders','notification_preferences',
        'communication_logs','notifications','public_site_leads','tenant_members'
      ]::text[])
      and privilege.grantee in ('PUBLIC', 'anon')
      and privilege.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
  ) then
    raise exception 'Anonymous operational table grants must be absent.'
      using errcode = '55000';
  end if;

  if not has_function_privilege(
       'anon', 'public.get_public_site(text)', 'EXECUTE'
     )
     or not has_function_privilege(
       'anon',
       'public.submit_public_site_lead(text,text,text,text,text,uuid,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'Existing public site authority is unavailable.'
      using errcode = '55000';
  end if;

  if has_table_privilege(
       'authenticated', 'public.tenant_members', 'INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'authenticated', 'public.reminders', 'INSERT,UPDATE,DELETE'
     ) then
    raise exception 'Protected operational direct-write baseline is unsafe.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from unnest(array[
      'courses','course_sections','lessons','students','enrollments','cohorts',
      'cohort_members','sessions','attendance_records','assignments',
      'assignment_submissions','academy_announcements','community_posts',
      'community_comments','document_records','finance_settings','finance_fee_plans',
      'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
      'payments','receipts','payment_links','conversation_threads',
      'conversation_participants','conversation_messages','automation_rules',
      'automation_rule_conditions','automation_rule_actions','automation_runs',
      'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
      'workflow_templates','workflow_template_steps','workflow_runs',
      'workflow_run_steps','approval_requests','delegated_permissions','crm_leads',
      'crm_lead_notes','crm_follow_up_tasks','marketing_campaigns',
      'marketing_campaign_leads','marketing_message_templates',
      'trainer_course_assignments','trainer_cohort_assignments','team_invitations',
      'student_portal_invitations','lesson_progress','certificates',
      'tenant_feature_settings','reminders','notification_preferences',
      'communication_logs','notifications','public_site_leads','tenant_members'
    ]::text[]) target(table_name)
    join pg_class class on class.relname = target.table_name
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relkind in ('r', 'p')
      and (
        has_table_privilege('authenticated', class.oid, 'SELECT')
        or has_table_privilege('authenticated', class.oid, 'INSERT')
        or has_table_privilege('authenticated', class.oid, 'UPDATE')
        or has_table_privilege('authenticated', class.oid, 'DELETE')
      )
      and (
        not class.relrowsecurity
        or not exists (
          select 1
          from information_schema.columns column_state
          where column_state.table_schema = 'public'
            and column_state.table_name = target.table_name
            and column_state.column_name = 'tenant_id'
        )
      )
  ) then
    raise exception
      'Authenticated operational table authority lacks lifecycle-compatible RLS.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.tenants tenant
    where exists (
      select 1 from public.tenant_subscription_assignments assignment
      where assignment.tenant_id = tenant.id
    )
      and not exists (
        select 1 from public.tenant_subscription_assignments assignment
        where assignment.tenant_id = tenant.id
          and assignment.is_current
      )
  ) then
    raise exception
      'Workspace assignment history lacks a current canonical assignment.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.tenant_subscription_assignments assignment
    cross join lateral (
      select coachfort_internal.tenant_subscription_effective_lifecycle(
        assignment.tenant_id
      ) as value
    ) lifecycle
    where assignment.is_current
      and (
        lifecycle.value->>'effective_state' = 'malformed'
        or lifecycle.value->>'reason' in (
          'missing_canonical_assignment',
          'invalid_status_payment_combination',
          'missing_period_authority',
          'future_period_start',
          'invalid_period_ordering',
          'missing_trial_authority',
          'future_trial_start',
          'invalid_trial_ordering',
          'invalid_grace_authority'
        )
      )
  ) then
    raise exception 'Canonical subscription lifecycle authority is malformed.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_roles owner_role on owner_role.oid = procedure.proowner
    where procedure.oid = to_regprocedure(
      'public.feature_access_effective_rows(uuid)'
    )
      and (
        owner_role.rolname <> 'postgres'
        or not procedure.prosecdef
        or procedure.provolatile <> 's'
        or not (
          coalesce(procedure.proconfig, array[]::text[])
            && array['search_path=public', 'search_path=public, pg_temp']
        )
        or has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        )
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception 'Direct feature row authority is not private.'
      using errcode = '55000';
  end if;

  if lower(pg_get_functiondef(to_regprocedure(
       'public.get_tenant_feature_access(uuid)'
     ))) not like '%feature_access_current_role%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.get_tenant_feature_access(uuid)'
     ))) not like '%is_platform_admin%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.get_portal_feature_access(uuid)'
     ))) not like '%has_any_active_student_portal_account%'
     or lower(pg_get_functiondef(to_regprocedure(
       'public.get_portal_feature_access(uuid)'
     ))) not like '%auth.uid()%' then
    raise exception 'Authorized feature access wrapper contract has drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_proc admin_check
    join pg_roles admin_owner on admin_owner.oid = admin_check.proowner
    cross join pg_proc role_check
    join pg_roles role_owner on role_owner.oid = role_check.proowner
    where admin_check.oid = to_regprocedure('public.is_platform_admin()')
      and role_check.oid = to_regprocedure('public.platform_current_role()')
      and admin_owner.rolname = 'postgres'
      and role_owner.rolname = 'postgres'
      and admin_check.prosecdef
      and role_check.prosecdef
      and admin_check.provolatile = 's'
      and role_check.provolatile = 's'
      and coalesce(admin_check.proconfig, array[]::text[])
        && array['search_path=public', 'search_path=public, pg_temp']
      and coalesce(role_check.proconfig, array[]::text[])
        && array['search_path=public', 'search_path=public, pg_temp']
      and lower(pg_get_functiondef(admin_check.oid)) like
        '%public.platform_current_role()%'
      and lower(pg_get_functiondef(admin_check.oid)) not like
        '%tenant_members%'
      and lower(pg_get_functiondef(role_check.oid)) like
        '%from public.platform_admin_users%'
      and lower(pg_get_functiondef(role_check.oid)) like '%auth.uid()%'
      and lower(pg_get_functiondef(role_check.oid)) like '%status = ''active''%'
      and lower(pg_get_functiondef(role_check.oid)) not like
        '%tenant_members%'
      and has_function_privilege(
        'authenticated', admin_check.oid, 'EXECUTE'
      )
      and not has_function_privilege('anon', admin_check.oid, 'EXECUTE')
      and not has_function_privilege(
        'service_role', admin_check.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          admin_check.proacl,
          acldefault('f', admin_check.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception 'Canonical Platform Admin authority is unsafe for RLS use.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_roles owner_role on owner_role.oid = procedure.proowner
    where procedure.oid = to_regprocedure(
      'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
    )
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and owner_role.rolname = 'postgres'
  ) then
    raise exception 'UX-8G1A lifecycle helper authority is unsafe.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'tenant_subscription_assignments',
        'tenant_members',
        'student_portal_accounts'
      )
      and class.relforcerowsecurity
  ) then
    raise exception 'UX-8G1B helper prerequisites cannot use FORCE RLS.'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'coachfort_internal.tenant_operational_access_allowed(uuid)'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.assert_tenant_operational_access(uuid)'
     ) is not null
     or exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and policyname like 'UX8G1B%'
     ) then
    raise exception 'UX-8G1B appears partially installed.'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.get_tenant_entitlement_state(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lifecycle jsonb;
  v_assignment jsonb;
  v_plan_id uuid;
  v_features jsonb;
  v_usage jsonb;
  v_limits jsonb;
  v_warnings jsonb;
begin
  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Subscription entitlement access denied.' using errcode = '42501';
  end if;

  -- Lifecycle and feature authority are resolved before usage/quota evidence.
  v_lifecycle :=
    coachfort_internal.tenant_subscription_effective_lifecycle(p_tenant_id);
  v_features := (
    coachfort_internal.resolve_effective_feature_access_authority(
      p_tenant_id,
      null
    )->'features'
  );

  select assignment.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  order by assignment.created_at desc
  limit 1;

  v_assignment := public.subscription_entitlements_current_assignment(p_tenant_id);
  v_usage := public.subscription_entitlements_latest_usage(p_tenant_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'resource_key', plan_limit.resource_key,
    'limit_value', coalesce(
      limit_override.override_value_json->>'limit_value',
      plan_limit.limit_value::text
    ),
    'base_limit_value', plan_limit.limit_value,
    'limit_type', plan_limit.limit_type,
    'enforcement_mode', plan_limit.enforcement_mode,
    'warning_threshold_percent', plan_limit.warning_threshold_percent,
    'allow_platform_override', plan_limit.allow_platform_override,
    'override_type', limit_override.override_type
  ) order by plan_limit.resource_key), '[]'::jsonb)
  into v_limits
  from public.subscription_plan_usage_limits plan_limit
  left join lateral (
    select override_row.override_type, override_row.override_value_json
    from public.tenant_subscription_overrides override_row
    where override_row.tenant_id = p_tenant_id
      and override_row.resource_key = plan_limit.resource_key
      and override_row.override_type in ('limit_raise', 'limit_lower')
      and (override_row.expires_at is null or override_row.expires_at > now())
    order by override_row.created_at desc
    limit 1
  ) limit_override on true
  where plan_limit.plan_id = v_plan_id;

  select coalesce(jsonb_agg(warning order by resource_key), '[]'::jsonb)
  into v_warnings
  from (
    select
      limit_row.resource_key,
      jsonb_build_object(
        'resource_key', limit_row.resource_key,
        'current_usage', limit_row.current_usage,
        'limit_value', limit_row.limit_value,
        'warning_threshold_percent', limit_row.warning_threshold_percent,
        'enforcement_mode', limit_row.enforcement_mode,
        'reason', 'usage_threshold'
      ) warning
    from (
      select
        limit_item->>'resource_key' resource_key,
        nullif(limit_item->>'limit_value', '')::integer limit_value,
        coalesce(
          (limit_item->>'warning_threshold_percent')::integer,
          80
        ) warning_threshold_percent,
        coalesce(limit_item->>'enforcement_mode', 'warn') enforcement_mode,
        coalesce(
          (v_usage->>(limit_item->>'resource_key'))::integer,
          0
        ) current_usage
      from jsonb_array_elements(v_limits) limit_item
    ) limit_row
    where limit_row.limit_value is not null
      and limit_row.limit_value > 0
      and limit_row.current_usage >= ceil(
        limit_row.limit_value
        * (limit_row.warning_threshold_percent::numeric / 100)
      )
  ) warning_rows;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'lifecycle', v_lifecycle,
    'assignment', v_assignment,
    'limits', coalesce(v_limits, '[]'::jsonb),
    'features', coalesce(v_features, '[]'::jsonb),
    'latest_usage', coalesce(v_usage, '{}'::jsonb),
    'warnings', coalesce(v_warnings, '[]'::jsonb),
    'payment_forced', false,
    'gateway_required', false
  );
end;
$$;

create or replace function public.assert_tenant_usage_limit(
  p_tenant_id uuid,
  p_resource_key text,
  p_requested_delta integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource_key text;
  v_requested_delta integer := coalesce(p_requested_delta, 1);
  v_plan_id uuid;
  v_limit record;
  v_override record;
  v_has_limit boolean := false;
  v_has_override boolean := false;
  v_usage jsonb;
  v_current_usage integer := 0;
  v_effective_limit integer;
  v_allowed boolean := true;
  v_warning boolean := false;
  v_reason text := 'allowed';
begin
  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Usage limit access denied.' using errcode = '42501';
  end if;

  -- Fail inactive/malformed lifecycle before key normalization or quota reads.
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);
  v_resource_key := public.subscription_entitlements_normalize_resource_key(
    p_resource_key
  );

  if v_requested_delta < 0 then
    raise exception 'Requested delta cannot be negative.' using errcode = '22023';
  end if;

  select assignment.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  order by assignment.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'Canonical subscription authority is unavailable.'
      using errcode = '42501';
  end if;

  select * into v_limit
  from public.subscription_plan_usage_limits plan_limit
  where plan_limit.plan_id = v_plan_id
    and plan_limit.resource_key = v_resource_key;
  v_has_limit := found;

  if not v_has_limit then
    return jsonb_build_object(
      'allowed', true,
      'resource_key', v_resource_key,
      'current_usage', 0,
      'requested_delta', v_requested_delta,
      'limit_value', null,
      'warning', false,
      'enforcement_mode', 'none',
      'reason', 'no_limit_configured'
    );
  end if;

  select * into v_override
  from public.tenant_subscription_overrides override_row
  where override_row.tenant_id = p_tenant_id
    and override_row.resource_key = v_resource_key
    and override_row.override_type in ('limit_raise', 'limit_lower')
    and (override_row.expires_at is null or override_row.expires_at > now())
  order by override_row.created_at desc
  limit 1;
  v_has_override := found;

  v_effective_limit := v_limit.limit_value;
  if v_has_override and (v_override.override_value_json ? 'limit_value') then
    v_effective_limit := nullif(
      v_override.override_value_json->>'limit_value',
      ''
    )::integer;
  end if;

  v_usage := public.subscription_entitlements_latest_usage(p_tenant_id);
  v_current_usage := coalesce((v_usage->>v_resource_key)::integer, 0);

  if v_effective_limit is null then
    v_reason := 'unlimited';
  elsif v_limit.enforcement_mode = 'hard'
        and v_current_usage + v_requested_delta > v_effective_limit then
    v_allowed := false;
    v_reason := 'hard_limit_exceeded';
  elsif v_limit.enforcement_mode in ('warn', 'hard')
        and v_effective_limit > 0
        and v_current_usage + v_requested_delta >= ceil(
          v_effective_limit
          * (v_limit.warning_threshold_percent::numeric / 100)
        ) then
    v_warning := true;
    v_reason := 'warning_threshold_reached';
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'resource_key', v_resource_key,
    'current_usage', v_current_usage,
    'requested_delta', v_requested_delta,
    'limit_value', v_effective_limit,
    'base_limit_value', v_limit.limit_value,
    'warning', v_warning,
    'enforcement_mode', v_limit.enforcement_mode,
    'warning_threshold_percent', v_limit.warning_threshold_percent,
    'reason', v_reason,
    'override_type', case when v_has_override
      then v_override.override_type else null end
  );
end;
$$;

create function coachfort_internal.tenant_operational_access_allowed(
  p_tenant_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lifecycle jsonb;
begin
  if p_tenant_id is null then
    return false;
  end if;

  v_lifecycle :=
    coachfort_internal.tenant_subscription_effective_lifecycle(p_tenant_id);

  return coalesce(
    (v_lifecycle->>'operational_allowed')::boolean,
    false
  ) and v_lifecycle->>'effective_state' in ('active', 'grace');
exception when others then
  return false;
end;
$$;

create function coachfort_internal.assert_tenant_operational_access(
  p_tenant_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coachfort_internal.tenant_operational_access_allowed(p_tenant_id) then
    raise exception 'Workspace subscription is inactive.'
      using errcode = '42501';
  end if;
end;
$$;

create function coachfort_internal.operational_actor_has_tenant_identity(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_tenant_id is not null
    and p_user_id is not null
    and (
      exists (
        select 1
        from public.tenant_members member
        where member.tenant_id = p_tenant_id
          and member.user_id = p_user_id
      )
      or exists (
        select 1
        from public.student_portal_accounts account
        where account.tenant_id = p_tenant_id
          and account.user_id = p_user_id
          and account.status = 'active'
      )
    );
$$;

create function coachfort_internal.operational_current_team_role(
  p_tenant_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member.role
  from public.tenant_members member
  where member.tenant_id = p_tenant_id
    and member.user_id = p_user_id
    and coachfort_internal.tenant_operational_access_allowed(p_tenant_id)
  limit 1;
$$;

create function coachfort_internal.student_bootstrap_identity_allowed(
  p_tenant_id uuid,
  p_student_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_tenant_id is not null
    and p_student_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.student_portal_accounts account
      where account.tenant_id = p_tenant_id
        and account.student_id = p_student_id
        and account.user_id = p_user_id
        and account.status = 'active'
    );
$$;

create function coachfort_internal.notification_lifecycle_access_allowed(
  p_tenant_id uuid,
  p_recipient_user_id uuid,
  p_notification_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.tenant_operational_access_allowed(p_tenant_id)
    or (
      p_tenant_id is not null
      and p_recipient_user_id = auth.uid()
      and p_notification_type = 'subscription_notice'
      and exists (
        select 1
        from public.tenant_members member
        where member.tenant_id = p_tenant_id
          and member.user_id = auth.uid()
          and member.role in ('owner', 'admin')
      )
    );
$$;

create function public.get_current_tenant_operational_state(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lifecycle jsonb;
  v_allowed boolean;
begin
  if auth.uid() is null
     or not coachfort_internal.operational_actor_has_tenant_identity(
       p_tenant_id,
       auth.uid()
     ) then
    raise exception 'Workspace access is unavailable.' using errcode = '42501';
  end if;

  v_lifecycle :=
    coachfort_internal.tenant_subscription_effective_lifecycle(p_tenant_id);
  v_allowed := coachfort_internal.tenant_operational_access_allowed(p_tenant_id);

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'operational_allowed', v_allowed,
    'effective_state', case
      when v_allowed and v_lifecycle->>'effective_state' = 'grace' then 'grace'
      when v_allowed then 'active'
      else 'inactive'
    end,
    'reason', case when v_allowed then 'operational'
      else 'subscription_inactive' end
  );
end;
$$;

create function public.assert_tenant_operational_access(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not coachfort_internal.operational_actor_has_tenant_identity(
       p_tenant_id,
       auth.uid()
     ) then
    raise exception 'Workspace access is unavailable.' using errcode = '42501';
  end if;

  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);
end;
$$;

create or replace function public.get_public_site(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(trim(coalesce(p_slug, '')));
  site_tenant public.tenants%rowtype;
  course_items jsonb := '[]'::jsonb;
begin
  if normalized_slug = ''
     or normalized_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    return null;
  end if;

  select *
  into site_tenant
  from public.tenants
  where slug = normalized_slug
    and public_site_enabled = true
  limit 1;

  if not found
     or not coachfort_internal.tenant_operational_access_allowed(
       site_tenant.id
     ) then
    return null;
  end if;

  if coalesce(site_tenant.public_show_courses, true) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', course.id,
          'title', course.title,
          'slug', course.slug,
          'description', course.description,
          'thumbnail_url', course.thumbnail_url
        )
        order by course.created_at desc
      ),
      '[]'::jsonb
    )
    into course_items
    from (
      select id, title, slug, description, thumbnail_url, created_at
      from public.courses
      where tenant_id = site_tenant.id
        and status = 'published'
      order by created_at desc
      limit 12
    ) course;
  end if;

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', site_tenant.id,
      'slug', site_tenant.slug,
      'name', site_tenant.name,
      'workspace_display_name', site_tenant.workspace_display_name,
      'brand_name', site_tenant.brand_name,
      'brand_tagline', site_tenant.brand_tagline,
      'logo_url', site_tenant.logo_url,
      'icon_url', site_tenant.icon_url,
      'brand_color', site_tenant.brand_color,
      'accent_color', site_tenant.accent_color,
      'show_powered_by', site_tenant.show_powered_by,
      'support_email', case
        when coalesce(site_tenant.public_show_support_contact, true)
        then site_tenant.support_email else null end,
      'support_phone', case
        when coalesce(site_tenant.public_show_support_contact, true)
        then site_tenant.support_phone else null end,
      'website_url', case
        when coalesce(site_tenant.public_show_support_contact, true)
        then site_tenant.website_url else null end
    ),
    'site', jsonb_build_object(
      'public_site_enabled', site_tenant.public_site_enabled,
      'public_page_title', site_tenant.public_page_title,
      'public_page_description', site_tenant.public_page_description,
      'contact_cta_text', site_tenant.contact_cta_text,
      'public_hero_title', site_tenant.public_hero_title,
      'public_hero_subtitle', site_tenant.public_hero_subtitle,
      'public_hero_cta_label', site_tenant.public_hero_cta_label,
      'public_about_title', site_tenant.public_about_title,
      'public_about_body', site_tenant.public_about_body,
      'public_highlight_1_title', site_tenant.public_highlight_1_title,
      'public_highlight_1_body', site_tenant.public_highlight_1_body,
      'public_highlight_2_title', site_tenant.public_highlight_2_title,
      'public_highlight_2_body', site_tenant.public_highlight_2_body,
      'public_highlight_3_title', site_tenant.public_highlight_3_title,
      'public_highlight_3_body', site_tenant.public_highlight_3_body,
      'public_show_courses', site_tenant.public_show_courses,
      'public_show_contact_form', site_tenant.public_show_contact_form,
      'public_show_support_contact', site_tenant.public_show_support_contact,
      'public_footer_note', site_tenant.public_footer_note
    ),
    'courses', course_items
  );
end;
$$;

create function coachfort_internal.resolve_effective_feature_access_authority(
  p_tenant_id uuid,
  p_feature_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_feature_key text;
  v_assignment jsonb;
  v_plan_id uuid;
  v_operational_allowed boolean;
  v_result jsonb;
begin
  if p_tenant_id is null then
    return jsonb_build_object(
      'tenant_id', p_tenant_id,
      'assignment', null,
      'features', '[]'::jsonb
    );
  end if;

  -- Lifecycle is resolved before Module 62, plan, override, or quota authority.
  v_operational_allowed :=
    coachfort_internal.tenant_operational_access_allowed(p_tenant_id);

  if p_feature_key is not null and nullif(trim(p_feature_key), '') is not null then
    v_feature_key := public.subscription_entitlements_normalize_feature_key(
      p_feature_key
    );
  end if;

  v_assignment := public.subscription_entitlements_current_assignment(p_tenant_id);

  select assignment.plan_id
  into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  order by assignment.created_at desc
  limit 1;

  with feature_keys as (
    select unnest(public.subscription_entitlements_feature_keys()) feature_key
  ), resolved as (
    select
      keys.feature_key,
      coalesce(plan_feature.entitlement_status, 'locked') plan_status,
      coalesce(plan_feature.requires_platform_approval, false)
        requires_platform_approval,
      plan_feature.included_quota,
      setting.status module62_status,
      setting.source module62_source,
      feature_override.override_type feature_override_type,
      case
        when not v_operational_allowed then 'locked'
        when keys.feature_key = any (
          public.subscription_entitlements_global_locked_features()
        ) then 'coming_soon'
        when feature_override.override_type = 'feature_lock' then 'locked'
        when feature_override.override_type = 'feature_unlock' then 'included'
        when coalesce(
          setting.status,
          case when keys.feature_key = any (public.feature_access_allowed_keys())
            then public.feature_access_default_status(keys.feature_key) end
        ) = 'coming_soon' then 'coming_soon'
        when coalesce(
          setting.status,
          case when keys.feature_key = any (public.feature_access_allowed_keys())
            then public.feature_access_default_status(keys.feature_key) end
        ) in ('disabled', 'locked_by_plan') then 'locked'
        when coalesce(plan_feature.entitlement_status, 'locked') = 'coming_soon'
          then 'coming_soon'
        when coalesce(plan_feature.entitlement_status, 'locked') in (
          'platform_approval_required', 'addon'
        ) and feature_override.override_type is distinct from 'feature_unlock'
          then 'locked'
        else coalesce(plan_feature.entitlement_status, 'locked')
      end effective_status,
      case
        when not v_operational_allowed then 'subscription_lifecycle'
        when keys.feature_key = any (
          public.subscription_entitlements_global_locked_features()
        ) then 'global_coming_soon'
        when feature_override.override_type = 'feature_lock'
          then 'platform_feature_lock'
        when feature_override.override_type = 'feature_unlock'
          then 'platform_feature_unlock'
        when coalesce(
          setting.status,
          case when keys.feature_key = any (public.feature_access_allowed_keys())
            then public.feature_access_default_status(keys.feature_key) end
        ) in ('coming_soon', 'disabled', 'locked_by_plan')
          then 'module62_status'
        when coalesce(plan_feature.entitlement_status, 'locked') in (
          'coming_soon', 'addon', 'platform_approval_required'
        ) then coalesce(plan_feature.entitlement_status, 'locked')
        else 'plan'
      end reason
    from feature_keys keys
    left join public.subscription_plan_feature_entitlements plan_feature
      on plan_feature.plan_id = v_plan_id
     and plan_feature.feature_key = keys.feature_key
    left join public.tenant_feature_settings setting
      on setting.tenant_id = p_tenant_id
     and setting.feature_key = keys.feature_key
    left join lateral (
      select override_row.override_type
      from public.tenant_subscription_overrides override_row
      where override_row.tenant_id = p_tenant_id
        and override_row.feature_key = keys.feature_key
        and override_row.override_type in ('feature_unlock', 'feature_lock')
        and (override_row.expires_at is null or override_row.expires_at > now())
      order by override_row.created_at desc
      limit 1
    ) feature_override on true
    where v_feature_key is null or keys.feature_key = v_feature_key
  )
  select jsonb_build_object(
    'tenant_id', p_tenant_id,
    'assignment', v_assignment,
    'operational_allowed', v_operational_allowed,
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'feature_key', resolved.feature_key,
      'effective_status', resolved.effective_status,
      'reason', resolved.reason,
      'plan_status', resolved.plan_status,
      'requires_platform_approval', resolved.requires_platform_approval,
      'included_quota', resolved.included_quota,
      'module62_status', resolved.module62_status,
      'module62_source', resolved.module62_source,
      'override_type', resolved.feature_override_type
    ) order by resolved.feature_key), '[]'::jsonb)
  )
  into v_result
  from resolved;

  return v_result;
end;
$$;

create or replace function public.resolve_effective_feature_access(
  p_tenant_id uuid,
  p_feature_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Subscription entitlement access denied.' using errcode = '42501';
  end if;

  return coachfort_internal.resolve_effective_feature_access_authority(
    p_tenant_id,
    p_feature_key
  );
end;
$$;

create or replace function public.feature_access_effective_rows(p_tenant_id uuid)
returns table (
  feature_key text,
  status text,
  source text,
  configured_by uuid,
  configured_at timestamptz,
  metadata_json jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with authority as (
    select jsonb_array_elements(
      coachfort_internal.resolve_effective_feature_access_authority(
        p_tenant_id,
        null
      )->'features'
    ) feature
  )
  select
    feature->>'feature_key',
    case feature->>'effective_status'
      when 'included' then 'enabled'
      when 'coming_soon' then 'coming_soon'
      else 'locked_by_plan'
    end,
    feature->>'reason',
    setting.configured_by,
    setting.configured_at,
    coalesce(setting.metadata_json, '{}'::jsonb),
    setting.updated_at
  from authority
  left join public.tenant_feature_settings setting
    on setting.tenant_id = p_tenant_id
   and setting.feature_key = feature->>'feature_key';
$$;

create or replace function public.assert_tenant_entity_usage_limit(
  p_tenant_id uuid,
  p_resource_key text,
  p_requested_delta integer default 1,
  p_include_pending_invitations boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource_key text := lower(trim(coalesce(p_resource_key, '')));
  v_requested_delta integer := coalesce(p_requested_delta, 1);
  v_counts jsonb;
  v_plan_id uuid;
  v_limit record;
  v_override record;
  v_effective_limit integer;
  v_current_count integer := 0;
  v_pending_count integer := 0;
  v_projected_count integer;
  v_remaining_after integer;
  v_warning boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;
  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Entity usage limit access denied.' using errcode = '42501';
  end if;

  -- Lifecycle is authoritative before input-specific quota diagnostics.
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);

  if v_requested_delta < 0 then
    raise exception 'Requested delta cannot be negative.' using errcode = '22023';
  end if;
  if v_resource_key not in (
    'students','courses','cohorts','batches','admins','staff_trainers',
    'team_members'
  ) then
    raise exception 'Invalid entity resource key.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'entity_usage_limit:' || p_tenant_id::text || ':' || v_resource_key,
    7176
  ));

  select assignment.plan_id into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id and assignment.is_current
  order by assignment.created_at desc limit 1;
  if v_plan_id is null then
    raise exception 'A canonical subscription assignment is required before entity limits can be enforced.'
      using errcode = '22023';
  end if;

  select * into v_limit
  from public.subscription_plan_usage_limits plan_limit
  where plan_limit.plan_id = v_plan_id
    and plan_limit.resource_key = v_resource_key;
  if not found then
    raise exception 'Canonical entity limit is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  select * into v_override
  from public.tenant_subscription_overrides override_row
  where override_row.tenant_id = p_tenant_id
    and override_row.resource_key = v_resource_key
    and override_row.override_type in ('limit_raise','limit_lower')
    and (override_row.expires_at is null or override_row.expires_at > now())
  order by override_row.created_at desc limit 1;

  v_effective_limit := v_limit.limit_value;
  if found and v_override.override_value_json ? 'limit_value' then
    v_effective_limit := nullif(
      v_override.override_value_json->>'limit_value',
      ''
    )::integer;
  end if;
  if v_effective_limit is null then
    raise exception 'Unlimited entity limits are not supported for this enforcement helper yet.'
      using errcode = '22023';
  end if;
  if v_effective_limit < 0 then
    raise exception 'Canonical entity limit is invalid.' using errcode = '22023';
  end if;

  v_counts := public.get_tenant_entity_usage_counts(p_tenant_id);
  v_current_count := case v_resource_key
    when 'students' then coalesce((v_counts->>'students_count')::integer, 0)
    when 'courses' then coalesce((v_counts->>'courses_count')::integer, 0)
    when 'cohorts' then coalesce((v_counts->>'cohorts_count')::integer, 0)
    when 'batches' then coalesce((v_counts->>'batches_count')::integer, 0)
    when 'admins' then coalesce((v_counts->>'admins_count')::integer, 0)
    when 'staff_trainers' then coalesce((v_counts->>'staff_trainers_count')::integer, 0)
    when 'team_members' then coalesce((v_counts->>'team_members_count')::integer, 0)
    else 0 end;

  if coalesce(p_include_pending_invitations, false) then
    v_pending_count := case v_resource_key
      when 'admins' then coalesce((v_counts->>'pending_admin_invitations_count')::integer, 0)
      when 'staff_trainers' then coalesce((v_counts->>'pending_staff_trainer_invitations_count')::integer, 0)
      when 'team_members' then coalesce((v_counts->>'pending_team_invitations_count')::integer, 0)
      else 0 end;
  end if;

  v_current_count := v_current_count + v_pending_count;
  v_projected_count := v_current_count + v_requested_delta;
  v_remaining_after := greatest(v_effective_limit - v_projected_count, 0);
  if v_limit.enforcement_mode = 'hard'
     and v_projected_count > v_effective_limit then
    raise exception 'Canonical entity usage limit exceeded.' using errcode = '22023';
  end if;
  v_warning := v_effective_limit > 0 and v_projected_count >= ceil(
    v_effective_limit
    * (coalesce(v_limit.warning_threshold_percent, 80)::numeric / 100)
  );

  return jsonb_build_object(
    'allowed', true,
    'tenant_id', p_tenant_id,
    'resource_key', v_resource_key,
    'current_count', v_current_count,
    'pending_count_included', v_pending_count,
    'requested_delta', v_requested_delta,
    'projected_count', v_projected_count,
    'limit_value', v_effective_limit,
    'base_limit_value', v_limit.limit_value,
    'remaining_after', v_remaining_after,
    'warning', v_warning,
    'enforcement_mode', v_limit.enforcement_mode,
    'warning_threshold_percent', v_limit.warning_threshold_percent,
    'include_pending_invitations', coalesce(p_include_pending_invitations, false),
    'batches_count_source', case when v_resource_key = 'batches'
      then 'cohorts' else null end,
    'source', 'canonical_live_entity_usage_limit'
  );
end;
$$;

create or replace function public.m71_7p6d_assert_entity_usage_limit_internal(
  p_tenant_id uuid,
  p_resource_key text,
  p_requested_delta integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resource_key text := lower(trim(coalesce(p_resource_key, '')));
  v_requested_delta integer := coalesce(p_requested_delta, 1);
  v_plan_id uuid;
  v_limit record;
  v_override record;
  v_effective_limit integer;
  v_current_count integer := 0;
  v_projected_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  -- Invite acceptance is auth-bound but can precede membership; lifecycle still
  -- must be checked before any team-count or limit lookup.
  perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);

  if v_requested_delta < 0 then
    raise exception 'Requested delta cannot be negative.' using errcode = '22023';
  end if;
  if v_resource_key not in ('team_members','admins','staff_trainers') then
    raise exception 'Invalid team entity resource key.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'entity_usage_limit:' || p_tenant_id::text || ':' || v_resource_key,
    7176
  ));

  select assignment.plan_id into v_plan_id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id and assignment.is_current
  order by assignment.created_at desc limit 1;
  if v_plan_id is null then
    raise exception 'A canonical subscription assignment is required before team limits can be enforced.'
      using errcode = '22023';
  end if;

  select * into v_limit
  from public.subscription_plan_usage_limits plan_limit
  where plan_limit.plan_id = v_plan_id
    and plan_limit.resource_key = v_resource_key;
  if not found then
    raise exception 'Canonical team limit is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  select * into v_override
  from public.tenant_subscription_overrides override_row
  where override_row.tenant_id = p_tenant_id
    and override_row.resource_key = v_resource_key
    and override_row.override_type in ('limit_raise','limit_lower')
    and (override_row.expires_at is null or override_row.expires_at > now())
  order by override_row.created_at desc limit 1;
  v_effective_limit := v_limit.limit_value;
  if found and v_override.override_value_json ? 'limit_value' then
    v_effective_limit := nullif(
      v_override.override_value_json->>'limit_value',
      ''
    )::integer;
  end if;
  if v_effective_limit is null or v_effective_limit < 0 then
    raise exception 'Canonical team limit is invalid.' using errcode = '22023';
  end if;

  select case v_resource_key
    when 'admins' then count(*) filter (where member.role = 'admin')::integer
    when 'staff_trainers' then count(*) filter (
      where member.role in ('staff','trainer')
    )::integer
    when 'team_members' then count(*)::integer
    else 0 end
  into v_current_count
  from public.tenant_members member
  where member.tenant_id = p_tenant_id;

  v_projected_count := coalesce(v_current_count, 0) + v_requested_delta;
  if v_limit.enforcement_mode = 'hard'
     and v_projected_count > v_effective_limit then
    raise exception 'Canonical team usage limit exceeded.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'allowed', true,
    'tenant_id', p_tenant_id,
    'resource_key', v_resource_key,
    'current_count', coalesce(v_current_count, 0),
    'requested_delta', v_requested_delta,
    'projected_count', v_projected_count,
    'limit_value', v_effective_limit,
    'base_limit_value', v_limit.limit_value,
    'remaining_after', greatest(v_effective_limit - v_projected_count, 0),
    'warning', v_effective_limit > 0 and v_projected_count >= ceil(
      v_effective_limit
      * (coalesce(v_limit.warning_threshold_percent, 80)::numeric / 100)
    ),
    'enforcement_mode', v_limit.enforcement_mode,
    'source', 'canonical_team_acceptance_entity_usage_limit'
  );
end;
$$;

create or replace function coachfort_internal.assert_private_storage_quota(
  p_tenant_id uuid,
  p_storage_byte_delta bigint,
  p_document_count_delta integer,
  p_enforce_document_count boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usage jsonb;
  v_storage_limit_mb bigint;
  v_storage_limit_bytes bigint;
  v_document_upload_limit bigint;
  v_used_storage_bytes bigint;
  v_document_count_usage bigint;
  v_projected_storage_bytes bigint;
  v_projected_document_uploads bigint;
begin
  if p_tenant_id is null
     or p_storage_byte_delta is null
     or p_document_count_delta is null then
    raise exception 'Private storage quota inputs are required.' using errcode = '22023';
  end if;

  -- Positive preparation is operational. Zero/negative finalization or cleanup
  -- remains available so already-authorized uploads cannot be orphaned.
  if p_storage_byte_delta > 0 or p_document_count_delta > 0 then
    perform coachfort_internal.assert_tenant_operational_access(p_tenant_id);
  end if;

  v_usage := coachfort_internal.private_storage_usage(p_tenant_id);
  v_storage_limit_mb := coachfort_internal.private_storage_limit(
    p_tenant_id, 'storage_mb'
  );
  v_document_upload_limit := coachfort_internal.private_storage_limit(
    p_tenant_id, 'document_uploads'
  );
  if v_storage_limit_mb is null or v_storage_limit_mb <= 0 then
    raise exception 'Canonical storage quota is not configured for this tenant plan.'
      using errcode = '22023';
  end if;
  if coalesce(p_enforce_document_count, false)
     and (v_document_upload_limit is null or v_document_upload_limit < 0) then
    raise exception 'Canonical document upload limit is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  v_storage_limit_bytes := v_storage_limit_mb * 1024 * 1024;
  v_used_storage_bytes := coalesce((v_usage->>'used_storage_bytes')::bigint, 0);
  v_document_count_usage := coalesce(
    (v_usage->>'document_count_usage')::bigint,
    0
  );
  v_projected_storage_bytes := v_used_storage_bytes + p_storage_byte_delta;
  v_projected_document_uploads :=
    v_document_count_usage + p_document_count_delta;
  if v_projected_storage_bytes < 0
     or v_projected_storage_bytes > v_storage_limit_bytes then
    raise exception 'Upload would exceed the tenant storage quota.' using errcode = '22023';
  end if;
  if coalesce(p_enforce_document_count, false)
     and (v_projected_document_uploads < 0
       or v_projected_document_uploads > v_document_upload_limit) then
    raise exception 'Document upload would exceed the tenant document upload limit.'
      using errcode = '22023';
  end if;

  return v_usage || jsonb_build_object(
    'allowed', true,
    'storage_limit_mb', v_storage_limit_mb,
    'storage_limit_bytes', v_storage_limit_bytes,
    'document_upload_limit', v_document_upload_limit,
    'projected_storage_bytes', v_projected_storage_bytes,
    'projected_document_uploads', v_projected_document_uploads,
    'remaining_storage_bytes', greatest(
      v_storage_limit_bytes - v_projected_storage_bytes,
      0
    ),
    'remaining_document_uploads', case
      when v_document_upload_limit is null then null
      else greatest(v_document_upload_limit - v_projected_document_uploads, 0)
    end
  );
end;
$$;

-- Shared operational role authorities. Recovery/subscription/billing helpers
-- intentionally retain their existing membership-only contracts.
create or replace function public.m69_1_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m69_2_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m69_3_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m69_4_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m69_5_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m69_6_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m69_8_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m69_9_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.finance_current_role(check_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(check_tenant_id, auth.uid());
$$;
create or replace function public.reports_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.document_center_current_role(check_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(check_tenant_id, auth.uid());
$$;
create or replace function public.chat_current_team_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.workflow_current_role(check_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(check_tenant_id, auth.uid());
$$;
create or replace function public.approval_current_role(check_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(check_tenant_id, auth.uid());
$$;
create or replace function public.team_ops_current_role(check_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(check_tenant_id, auth.uid());
$$;
create or replace function public.crm_current_role(check_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(check_tenant_id, auth.uid());
$$;
create or replace function public.marketing_current_member_role(check_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(check_tenant_id, auth.uid());
$$;
create or replace function public.m70_3a_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;
create or replace function public.m70_3b_current_role(p_tenant_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select coachfort_internal.operational_current_team_role(p_tenant_id, auth.uid());
$$;

create or replace function public.run_automation_trigger(
  tenant_id uuid,
  trigger_type text,
  entity_type text,
  entity_id uuid default null,
  metadata_json jsonb default '{}'::jsonb
)
returns table (
  executed_count integer,
  skipped_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id alias for $1;
  v_trigger_type alias for $2;
  v_entity_type alias for $3;
  v_entity_id alias for $4;
  v_metadata_json alias for $5;
begin
  executed_count := 0;
  skipped_count := 0;
  failed_count := 0;

  -- Keep lifecycle denial outside legacy failure normalization so an inactive
  -- workspace cannot look like a successful no-op automation dispatch.
  perform coachfort_internal.assert_tenant_operational_access(v_tenant_id);

  begin
    if not public.is_valid_automation_trigger(
      v_tenant_id,
      v_trigger_type,
      v_entity_type,
      v_entity_id,
      coalesce(v_metadata_json, '{}'::jsonb)
    ) then
      return next;
      return;
    end if;

    return query
    select *
    from public.run_automation_trigger_unvalidated(
      v_tenant_id,
      v_trigger_type,
      v_entity_type,
      v_entity_id,
      coalesce(v_metadata_json, '{}'::jsonb)
    );
  exception when others then
    executed_count := 0;
    skipped_count := 0;
    failed_count := 0;
    return next;
  end;
end;
$$;

create or replace function coachfort_internal.student_portal_access_allowed_for_user(
  p_tenant_id uuid,
  p_student_id uuid,
  p_user_id uuid,
  p_course_id uuid,
  p_access_mode text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := lower(trim(coalesce(p_access_mode, 'portal')));
begin
  if p_tenant_id is null or p_student_id is null or p_user_id is null
     or v_mode not in ('portal','course_read','course_participate') then
    return false;
  end if;
  if not exists (
    select 1
    from public.students student
    join public.student_portal_accounts account
      on account.tenant_id = student.tenant_id
     and account.student_id = student.id
    where student.tenant_id = p_tenant_id
      and student.id = p_student_id
      and student.status = 'active'
      and student.portal_enabled = true
      and account.user_id = p_user_id
      and account.status = 'active'
  ) then
    return false;
  end if;

  -- Portal identity bootstrap remains available only for the inactive-state
  -- shell. All Program read/participation requires operational lifecycle.
  if v_mode = 'portal' then
    return true;
  end if;
  if not coachfort_internal.tenant_operational_access_allowed(p_tenant_id)
     or p_course_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.enrollments enrollment
    join public.courses course
      on course.tenant_id = enrollment.tenant_id
     and course.id = enrollment.course_id
    where enrollment.tenant_id = p_tenant_id
      and enrollment.student_id = p_student_id
      and enrollment.course_id = p_course_id
      and (
        (v_mode = 'course_read' and (
          (enrollment.status = 'active' and course.status = 'published')
          or (enrollment.status = 'completed'
            and course.status in ('published','archived'))
        ))
        or (v_mode = 'course_participate'
          and enrollment.status = 'active'
          and course.status = 'published')
      )
  );
end;
$$;

create or replace function public.finance_student_can_access(
  check_tenant_id uuid,
  check_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.tenant_operational_access_allowed(check_tenant_id)
    and public.student_portal_access_allowed(
      check_tenant_id,
      check_student_id,
      auth.uid(),
      null,
      'portal'
    );
$$;

create or replace function public.chat_student_context()
returns table (tenant_id uuid, student_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select account.tenant_id, account.student_id
  from public.student_portal_accounts account
  where account.user_id = auth.uid()
    and coachfort_internal.tenant_operational_access_allowed(account.tenant_id)
    and public.student_portal_access_allowed(
      account.tenant_id,
      account.student_id,
      auth.uid(),
      null,
      'portal'
    )
  order by account.linked_at asc
  limit 1;
$$;

create or replace function public.document_center_student_context()
returns table (tenant_id uuid, student_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select account.tenant_id, account.student_id
  from public.student_portal_accounts account
  where account.user_id = auth.uid()
    and coachfort_internal.tenant_operational_access_allowed(account.tenant_id)
    and public.student_portal_access_allowed(
      account.tenant_id,
      account.student_id,
      auth.uid(),
      null,
      'portal'
    )
  order by account.linked_at asc
  limit 1;
$$;

create or replace function public.get_mobile_notifications(
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_tenant_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select member.tenant_id
  into v_tenant_id
  from public.tenant_members member
  where member.user_id = v_actor
    and member.role in ('owner', 'admin', 'staff', 'trainer')
  order by member.created_at asc
  limit 1;

  if v_tenant_id is null then
    select account.tenant_id
    into v_tenant_id
    from public.student_portal_accounts account
    where account.user_id = v_actor
      and public.student_portal_access_allowed(
        account.tenant_id,
        account.student_id,
        v_actor,
        null,
        'portal'
      )
    order by account.linked_at asc
    limit 1;
  end if;

  if v_tenant_id is null then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'limit', v_limit,
      'offset', v_offset,
      'unread_count', 0
    );
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item order by item->>'created_at' desc)
      from (
        select jsonb_build_object(
          'id', notification.id,
          'type', notification.type,
          'title', notification.title,
          'message', notification.message,
          'severity', notification.severity,
          'status', notification.status,
          'action_url', notification.action_url,
          'created_at', notification.created_at,
          'read_at', notification.read_at
        ) item
        from public.notifications notification
        where notification.tenant_id = v_tenant_id
          and notification.user_id = v_actor
          and coachfort_internal.notification_lifecycle_access_allowed(
            notification.tenant_id,
            notification.user_id,
            notification.type
          )
        order by notification.created_at desc
        limit v_limit
        offset v_offset
      ) page
    ), '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset,
    'unread_count', (
      select count(*)
      from public.notifications notification
      where notification.tenant_id = v_tenant_id
        and notification.user_id = v_actor
        and notification.status = 'unread'
        and coachfort_internal.notification_lifecycle_access_allowed(
          notification.tenant_id,
          notification.user_id,
          notification.type
        )
    )
  );
end;
$$;

create or replace function public.mark_notification_read_secure(
  p_tenant_id uuid,
  p_notification_id uuid
)
returns public.notifications
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_student_portal_allowed boolean := false;
  v_operational_allowed boolean;
  v_notification public.notifications%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select notification.*
  into v_notification
  from public.notifications notification
  where notification.tenant_id = p_tenant_id
    and notification.id = p_notification_id;

  if not found
     or not coachfort_internal.notification_lifecycle_access_allowed(
       p_tenant_id,
       v_notification.user_id,
       v_notification.type
     ) then
    raise exception 'Notification not found or not accessible.'
      using errcode = '42501';
  end if;

  v_operational_allowed :=
    coachfort_internal.tenant_operational_access_allowed(p_tenant_id);

  if v_operational_allowed then
    v_role := public.m69_6_current_role(p_tenant_id);
    if v_role is null then
      v_student_portal_allowed := public.has_any_active_student_portal_account(
        p_tenant_id,
        v_actor
      );
    end if;

    if v_role is null and not v_student_portal_allowed then
      raise exception 'Notification not found or not accessible.'
        using errcode = '42501';
    end if;

    if v_role not in ('owner', 'admin')
       and v_notification.user_id <> v_actor then
      raise exception 'Notification not found or not accessible.'
        using errcode = '42501';
    end if;
  elsif v_notification.user_id <> v_actor then
    raise exception 'Notification not found or not accessible.'
      using errcode = '42501';
  end if;

  update public.notifications notification
  set
    status = 'read',
    read_at = coalesce(notification.read_at, now())
  where notification.tenant_id = p_tenant_id
    and notification.id = p_notification_id
  returning * into v_notification;

  if not found then
    raise exception 'Notification not found or not accessible.'
      using errcode = '42501';
  end if;

  return v_notification;
end;
$$;

create function coachfort_internal.enforce_tenant_operational_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_tenant_id uuid;
  v_new_tenant_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_tenant_id := old.tenant_id;
    perform coachfort_internal.assert_tenant_operational_access(v_old_tenant_id);
  end if;
  if tg_op <> 'DELETE' then
    v_new_tenant_id := new.tenant_id;
    perform coachfort_internal.assert_tenant_operational_access(v_new_tenant_id);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
  v_trigger_tables constant text[] := array[
    'courses','course_sections','lessons','students','enrollments','cohorts',
    'cohort_members','sessions','attendance_records','assignments',
    'assignment_submissions','academy_announcements','community_posts',
    'community_comments','finance_settings','finance_fee_plans',
    'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
    'payments','receipts','payment_links','conversation_threads',
    'conversation_participants','conversation_messages','automation_rules',
    'automation_rule_conditions','automation_rule_actions','automation_runs',
    'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
    'workflow_templates',
    'workflow_template_steps','workflow_runs','workflow_run_steps',
    'approval_requests','delegated_permissions','crm_leads','crm_lead_notes',
    'crm_follow_up_tasks','marketing_campaigns','marketing_campaign_leads',
    'marketing_message_templates','trainer_course_assignments',
    'trainer_cohort_assignments','team_invitations','student_portal_invitations',
    'lesson_progress','certificates','tenant_feature_settings','reminders',
    'notification_preferences','public_site_leads'
  ]::text[];
begin
  for v_table in
    select table_name
    from unnest(v_trigger_tables) as target(table_name)
    where to_regclass(format('public.%I', target.table_name)) is not null
      and exists (
        select 1
        from information_schema.columns column_state
        where column_state.table_schema = 'public'
          and column_state.table_name = target.table_name
          and column_state.column_name = 'tenant_id'
      )
  loop
    execute format(
      'create trigger ux8g1b_enforce_operational_lifecycle '
      || 'before insert or update or delete on public.%I '
      || 'for each row execute function '
      || 'coachfort_internal.enforce_tenant_operational_mutation()',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
  v_policy_tables constant text[] := array[
    'courses','course_sections','lessons','enrollments','cohorts',
    'cohort_members','sessions','attendance_records','assignments',
    'assignment_submissions','academy_announcements','community_posts',
    'community_comments','document_records','finance_settings','finance_fee_plans',
    'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
    'payments','receipts','payment_links','conversation_threads',
    'conversation_participants','conversation_messages','automation_rules',
    'automation_rule_conditions','automation_rule_actions','automation_runs',
    'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
    'workflow_templates',
    'workflow_template_steps','workflow_runs','workflow_run_steps',
    'approval_requests','delegated_permissions','crm_leads','crm_lead_notes',
    'crm_follow_up_tasks','marketing_campaigns','marketing_campaign_leads',
    'marketing_message_templates','trainer_course_assignments',
    'trainer_cohort_assignments','team_invitations','student_portal_invitations',
    'lesson_progress','certificates','tenant_feature_settings','reminders',
    'notification_preferences','communication_logs','public_site_leads'
  ]::text[];
begin
  for v_table in
    select class.relname
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relkind = 'r'
      and class.relname = any(v_policy_tables)
      and class.relrowsecurity
      and (
        has_table_privilege('authenticated', class.oid, 'SELECT')
        or has_table_privilege('authenticated', class.oid, 'INSERT')
        or has_table_privilege('authenticated', class.oid, 'UPDATE')
        or has_table_privilege('authenticated', class.oid, 'DELETE')
      )
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      || 'using (coachfort_internal.tenant_operational_access_allowed(tenant_id)) '
      || 'with check (coachfort_internal.tenant_operational_access_allowed(tenant_id))',
      'UX8G1B operational lifecycle gate',
      v_table
    );
  end loop;

  -- Students retain only the authenticated Student's own bootstrap identity.
  if to_regclass('public.students') is not null
     and has_table_privilege('authenticated', 'public.students', 'SELECT') then
    execute $policy$
      create policy "UX8G1B operational lifecycle gate"
      on public.students
      as restrictive
      for all
      to authenticated
      using (
        coachfort_internal.tenant_operational_access_allowed(tenant_id)
        or coachfort_internal.student_bootstrap_identity_allowed(
          tenant_id,
          id,
          auth.uid()
        )
      )
      with check (coachfort_internal.tenant_operational_access_allowed(tenant_id))
    $policy$;
  end if;

  -- Notifications are mixed-purpose. Inactive workspaces expose only the
  -- recipient Owner/Admin's billing and subscription recovery notices.
  if to_regclass('public.notifications') is not null
     and has_table_privilege('authenticated', 'public.notifications', 'SELECT') then
    execute $policy$
      create policy "UX8G1B notification lifecycle gate"
      on public.notifications
      as restrictive
      for select
      to authenticated
      using (
        coachfort_internal.notification_lifecycle_access_allowed(
          tenant_id,
          user_id,
          type
        )
      )
    $policy$;
  end if;

  -- Inactive users retain only their own membership identity for shell and
  -- recovery bootstrap. Canonical Platform Admin authority remains separate.
  if to_regclass('public.tenant_members') is not null
     and has_table_privilege(
       'authenticated', 'public.tenant_members', 'SELECT'
     ) then
    execute $policy$
      create policy "UX8G1B tenant membership bootstrap gate"
      on public.tenant_members
      as restrictive
      for select
      to authenticated
      using (
        coachfort_internal.tenant_operational_access_allowed(tenant_id)
        or user_id = auth.uid()
        or public.is_platform_admin()
      )
    $policy$;
  end if;
end;
$$;

alter function coachfort_internal.tenant_operational_access_allowed(uuid)
  owner to postgres;
alter function coachfort_internal.assert_tenant_operational_access(uuid)
  owner to postgres;
alter function coachfort_internal.operational_actor_has_tenant_identity(uuid,uuid)
  owner to postgres;
alter function coachfort_internal.operational_current_team_role(uuid,uuid)
  owner to postgres;
alter function coachfort_internal.student_bootstrap_identity_allowed(uuid,uuid,uuid)
  owner to postgres;
alter function coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)
  owner to postgres;
alter function coachfort_internal.resolve_effective_feature_access_authority(uuid,text)
  owner to postgres;
alter function coachfort_internal.enforce_tenant_operational_mutation()
  owner to postgres;
alter function public.get_current_tenant_operational_state(uuid) owner to postgres;
alter function public.assert_tenant_operational_access(uuid) owner to postgres;
alter function public.resolve_effective_feature_access(uuid,text) owner to postgres;
alter function public.feature_access_effective_rows(uuid) owner to postgres;
alter function public.get_tenant_entitlement_state(uuid) owner to postgres;
alter function public.assert_tenant_usage_limit(uuid,text,integer) owner to postgres;
alter function public.assert_tenant_entity_usage_limit(uuid,text,integer,boolean)
  owner to postgres;
alter function public.m71_7p6d_assert_entity_usage_limit_internal(uuid,text,integer)
  owner to postgres;
alter function public.run_automation_trigger(uuid,text,text,uuid,jsonb)
  owner to postgres;
alter function coachfort_internal.assert_private_storage_quota(
  uuid,bigint,integer,boolean
) owner to postgres;
alter function public.get_public_site(text) owner to postgres;
alter function public.get_mobile_notifications(integer,integer) owner to postgres;
alter function public.mark_notification_read_secure(uuid,uuid) owner to postgres;

revoke all on function coachfort_internal.tenant_operational_access_allowed(uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.assert_tenant_operational_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.operational_actor_has_tenant_identity(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.operational_current_team_role(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.student_bootstrap_identity_allowed(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.resolve_effective_feature_access_authority(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_tenant_operational_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.get_current_tenant_operational_state(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_tenant_operational_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.feature_access_effective_rows(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.run_automation_trigger(uuid,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

-- Exact authenticated execution is required for restrictive RLS evaluation.
-- coachfort_internal remains outside the exposed API schemas.
grant execute on function coachfort_internal.tenant_operational_access_allowed(uuid)
  to authenticated;
grant execute on function coachfort_internal.student_bootstrap_identity_allowed(uuid,uuid,uuid)
  to authenticated;
grant execute on function coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)
  to authenticated;
grant execute on function public.get_current_tenant_operational_state(uuid)
  to authenticated;
grant execute on function public.assert_tenant_operational_access(uuid)
  to authenticated;
grant execute on function public.run_automation_trigger(uuid,text,text,uuid,jsonb)
  to authenticated;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with expected_functions(identity, authenticated_execute, expected_stable) as (
  values
    ('coachfort_internal.tenant_operational_access_allowed(uuid)', true, true),
    ('coachfort_internal.assert_tenant_operational_access(uuid)', false, true),
    ('coachfort_internal.operational_actor_has_tenant_identity(uuid,uuid)', false, true),
    ('coachfort_internal.operational_current_team_role(uuid,uuid)', false, true),
    ('coachfort_internal.student_bootstrap_identity_allowed(uuid,uuid,uuid)', true, true),
    ('coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)', true, true),
    ('coachfort_internal.resolve_effective_feature_access_authority(uuid,text)', false, true),
    ('coachfort_internal.enforce_tenant_operational_mutation()', false, false),
    ('public.get_current_tenant_operational_state(uuid)', true, true),
    ('public.assert_tenant_operational_access(uuid)', true, true),
    ('public.feature_access_effective_rows(uuid)', false, true)
), function_state as (
  select
    expected.identity,
    procedure.oid is not null installed,
    owner_role.rolname owner_name,
    procedure.prosecdef security_definer,
    procedure.provolatile = 's' stable,
    coalesce(procedure.proconfig, array[]::text[])
      @> array['search_path=public, pg_temp'] fixed_search_path,
    coalesce(has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    ), false) authenticated_execute,
    coalesce(has_function_privilege('anon', procedure.oid, 'EXECUTE'), false)
      anon_execute,
    coalesce(has_function_privilege(
      'service_role', procedure.oid, 'EXECUTE'
    ), false) service_role_execute,
    exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) public_execute,
    expected.authenticated_execute expected_authenticated_execute
    , expected.expected_stable
  from expected_functions expected
  left join pg_proc procedure on procedure.oid = to_regprocedure(expected.identity)
  left join pg_roles owner_role on owner_role.oid = procedure.proowner
), source_state as (
  select
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.resolve_effective_feature_access_authority(uuid,text)'
    )), '[[:space:]]+', ' ', 'g')) resolver_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.assert_tenant_usage_limit(uuid,text,integer)'
    )), '[[:space:]]+', ' ', 'g')) usage_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.assert_tenant_entity_usage_limit(uuid,text,integer,boolean)'
    )), '[[:space:]]+', ' ', 'g')) entity_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.m71_7p6d_assert_entity_usage_limit_internal(uuid,text,integer)'
    )), '[[:space:]]+', ' ', 'g')) team_limit_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.assert_private_storage_quota(uuid,bigint,integer,boolean)'
    )), '[[:space:]]+', ' ', 'g')) storage_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.get_tenant_feature_access(uuid)'
    )), '[[:space:]]+', ' ', 'g')) tenant_feature_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.get_portal_feature_access(uuid)'
    )), '[[:space:]]+', ' ', 'g')) portal_feature_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.get_tenant_entitlement_state(uuid)'
    )), '[[:space:]]+', ' ', 'g')) entitlement_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.feature_access_effective_rows(uuid)'
    )), '[[:space:]]+', ' ', 'g')) feature_rows_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.enforce_tenant_operational_mutation()'
    )), '[[:space:]]+', ' ', 'g')) mutation_trigger_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.get_public_site(text)'
    )), '[[:space:]]+', ' ', 'g')) public_site_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.mark_notification_read_secure(uuid,uuid)'
    )), '[[:space:]]+', ' ', 'g')) notification_mark_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.get_mobile_notifications(integer,integer)'
    )), '[[:space:]]+', ' ', 'g')) mobile_notifications_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)'
    )), '[[:space:]]+', ' ', 'g')) notification_access_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.is_platform_admin()'
    )), '[[:space:]]+', ' ', 'g')) platform_admin_source,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'public.platform_current_role()'
    )), '[[:space:]]+', ' ', 'g')) platform_role_source
), expected_policy_tables as (
  select class.oid, class.relname, class.relrowsecurity as rls_enabled
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relkind = 'r'
    and class.relname = any(array[
      'courses','course_sections','lessons','enrollments','cohorts',
      'cohort_members','sessions','attendance_records','assignments',
      'assignment_submissions','academy_announcements','community_posts',
      'community_comments','document_records','finance_settings','finance_fee_plans',
      'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
      'payments','receipts','payment_links','conversation_threads',
      'conversation_participants','conversation_messages','automation_rules',
      'automation_rule_conditions','automation_rule_actions','automation_runs',
      'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
      'workflow_templates',
      'workflow_template_steps','workflow_runs','workflow_run_steps',
      'approval_requests','delegated_permissions','crm_leads','crm_lead_notes',
      'crm_follow_up_tasks','marketing_campaigns','marketing_campaign_leads',
      'marketing_message_templates','trainer_course_assignments',
      'trainer_cohort_assignments','team_invitations','student_portal_invitations',
      'lesson_progress','certificates','tenant_feature_settings','reminders',
      'notification_preferences','communication_logs','public_site_leads'
    ]::text[])
    and (
      has_table_privilege('authenticated', class.oid, 'SELECT')
      or has_table_privilege('authenticated', class.oid, 'INSERT')
      or has_table_privilege('authenticated', class.oid, 'UPDATE')
      or has_table_privilege('authenticated', class.oid, 'DELETE')
    )
), policy_state as (
  select
    expected.relname,
    expected.rls_enabled,
    policy.policyname is not null installed,
    policy.permissive = 'RESTRICTIVE' restrictive,
    coalesce(policy.qual, '') like
      '%tenant_operational_access_allowed(tenant_id)%' lifecycle_using,
    coalesce(policy.with_check, '') like
      '%tenant_operational_access_allowed(tenant_id)%' lifecycle_check
  from expected_policy_tables expected
  left join pg_policies policy
    on policy.schemaname = 'public'
   and policy.tablename = expected.relname
   and policy.policyname = 'UX8G1B operational lifecycle gate'
), authenticated_operational_authority as (
  select
    class.oid,
    class.relname,
    class.relrowsecurity as rls_enabled,
    exists (
      select 1
      from information_schema.columns column_state
      where column_state.table_schema = 'public'
        and column_state.table_name = class.relname
        and column_state.column_name = 'tenant_id'
    ) as tenant_key_present
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relkind in ('r', 'p')
    and class.relname = any(array[
      'courses','course_sections','lessons','students','enrollments','cohorts',
      'cohort_members','sessions','attendance_records','assignments',
      'assignment_submissions','academy_announcements','community_posts',
      'community_comments','document_records','finance_settings','finance_fee_plans',
      'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
      'payments','receipts','payment_links','conversation_threads',
      'conversation_participants','conversation_messages','automation_rules',
      'automation_rule_conditions','automation_rule_actions','automation_runs',
      'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
      'workflow_templates','workflow_template_steps','workflow_runs',
      'workflow_run_steps','approval_requests','delegated_permissions','crm_leads',
      'crm_lead_notes','crm_follow_up_tasks','marketing_campaigns',
      'marketing_campaign_leads','marketing_message_templates',
      'trainer_course_assignments','trainer_cohort_assignments','team_invitations',
      'student_portal_invitations','lesson_progress','certificates',
      'tenant_feature_settings','reminders','notification_preferences',
      'communication_logs','notifications','public_site_leads','tenant_members'
    ]::text[])
    and (
      has_table_privilege('authenticated', class.oid, 'SELECT')
      or has_table_privilege('authenticated', class.oid, 'INSERT')
      or has_table_privilege('authenticated', class.oid, 'UPDATE')
      or has_table_privilege('authenticated', class.oid, 'DELETE')
    )
), operational_authority_state as (
  select
    authority.relname,
    authority.rls_enabled,
    authority.tenant_key_present,
    case authority.relname
      when 'students' then exists (
        select 1 from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = authority.relname
          and policy.policyname = 'UX8G1B operational lifecycle gate'
          and policy.permissive = 'RESTRICTIVE'
          and policy.cmd = 'ALL'
          and coalesce(policy.qual, '') like
            '%student_bootstrap_identity_allowed%'
          and coalesce(policy.with_check, '') like
            '%tenant_operational_access_allowed(tenant_id)%'
      )
      when 'notifications' then exists (
        select 1 from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = authority.relname
          and policy.policyname = 'UX8G1B notification lifecycle gate'
          and policy.permissive = 'RESTRICTIVE'
          and policy.cmd = 'SELECT'
          and coalesce(policy.qual, '') like
            '%notification_lifecycle_access_allowed%'
      ) and not has_table_privilege(
        'authenticated', authority.oid, 'INSERT,UPDATE,DELETE'
      )
      when 'tenant_members' then exists (
        select 1 from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = authority.relname
          and policy.policyname = 'UX8G1B tenant membership bootstrap gate'
          and policy.permissive = 'RESTRICTIVE'
          and policy.cmd = 'SELECT'
          and coalesce(policy.qual, '') like
            '%tenant_operational_access_allowed(tenant_id)%'
          and coalesce(policy.qual, '') like '%user_id = auth.uid()%'
          and coalesce(policy.qual, '') like '%is_platform_admin()%'
      ) and not has_table_privilege(
        'authenticated', authority.oid, 'INSERT,UPDATE,DELETE'
      )
      else exists (
        select 1 from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = authority.relname
          and policy.policyname = 'UX8G1B operational lifecycle gate'
          and policy.permissive = 'RESTRICTIVE'
          and policy.cmd = 'ALL'
          and coalesce(policy.qual, '') like
            '%tenant_operational_access_allowed(tenant_id)%'
          and coalesce(policy.with_check, '') like
            '%tenant_operational_access_allowed(tenant_id)%'
      )
    end as lifecycle_authority_installed
  from authenticated_operational_authority authority
), expected_trigger_tables as (
  select class.oid, class.relname
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relkind = 'r'
    and class.relname = any(array[
      'courses','course_sections','lessons','students','enrollments','cohorts',
      'cohort_members','sessions','attendance_records','assignments',
      'assignment_submissions','academy_announcements','community_posts',
      'community_comments','finance_settings','finance_fee_plans',
      'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
      'payments','receipts','payment_links','conversation_threads',
      'conversation_participants','conversation_messages','automation_rules',
      'automation_rule_conditions','automation_rule_actions','automation_runs',
      'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
      'workflow_templates',
      'workflow_template_steps','workflow_runs','workflow_run_steps',
      'approval_requests','delegated_permissions','crm_leads','crm_lead_notes',
      'crm_follow_up_tasks','marketing_campaigns','marketing_campaign_leads',
      'marketing_message_templates','trainer_course_assignments',
      'trainer_cohort_assignments','team_invitations','student_portal_invitations',
      'lesson_progress','certificates','tenant_feature_settings','reminders',
      'notification_preferences','public_site_leads'
    ]::text[])
    and exists (
      select 1 from information_schema.columns column_state
      where column_state.table_schema = 'public'
        and column_state.table_name = class.relname
        and column_state.column_name = 'tenant_id'
    )
), trigger_state as (
  select
    expected.relname,
    trigger.oid is not null installed,
    coalesce(pg_get_triggerdef(trigger.oid), '') like
      '%coachfort_internal.enforce_tenant_operational_mutation()%'
      correct_binding
  from expected_trigger_tables expected
  left join pg_trigger trigger
    on trigger.tgrelid = expected.oid
   and trigger.tgname = 'ux8g1b_enforce_operational_lifecycle'
   and not trigger.tgisinternal
), special_policy_state as (
  select
    exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'tenant_members'
        and policy.policyname = 'UX8G1B tenant membership bootstrap gate'
        and policy.permissive = 'RESTRICTIVE'
        and policy.cmd = 'SELECT'
        and coalesce(policy.qual, '') like
          '%tenant_operational_access_allowed(tenant_id)%'
        and coalesce(policy.qual, '') like '%user_id = auth.uid()%'
        and coalesce(policy.qual, '') like '%is_platform_admin()%'
        and policy.with_check is null
    ) tenant_members_bootstrap,
    exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'notifications'
        and policy.policyname = 'UX8G1B notification lifecycle gate'
        and policy.permissive = 'RESTRICTIVE'
        and policy.cmd = 'SELECT'
        and coalesce(policy.qual, '') like
          '%notification_lifecycle_access_allowed%'
        and policy.with_check is null
    ) notification_lifecycle,
    not has_table_privilege(
      'authenticated', 'public.tenant_members', 'INSERT,UPDATE,DELETE'
    ) tenant_member_browser_writes_absent,
    not has_table_privilege(
      'authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE'
    ) notification_browser_writes_absent,
    not has_table_privilege(
      'authenticated', 'public.reminders', 'INSERT,UPDATE,DELETE'
    ) reminder_browser_writes_absent
), platform_authority_state as (
  select
    admin_check.oid is not null and role_check.oid is not null as installed,
    admin_owner.rolname = 'postgres' and role_owner.rolname = 'postgres'
      as postgres_owned,
    admin_check.prosecdef and role_check.prosecdef as security_definer,
    admin_check.provolatile = 's' and role_check.provolatile = 's' as stable,
    coalesce(admin_check.proconfig, array[]::text[])
      && array['search_path=public', 'search_path=public, pg_temp']
      and coalesce(role_check.proconfig, array[]::text[])
        && array['search_path=public', 'search_path=public, pg_temp']
      as fixed_search_path,
    has_function_privilege(
      'authenticated', admin_check.oid, 'EXECUTE'
    ) as authenticated_execute,
    not has_function_privilege('anon', admin_check.oid, 'EXECUTE')
      as anon_execute_absent,
    not has_function_privilege('service_role', admin_check.oid, 'EXECUTE')
      as service_role_execute_absent,
    not exists (
      select 1
      from aclexplode(coalesce(
        admin_check.proacl,
        acldefault('f', admin_check.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute_absent
  from pg_proc admin_check
  join pg_roles admin_owner on admin_owner.oid = admin_check.proowner
  cross join pg_proc role_check
  join pg_roles role_owner on role_owner.oid = role_check.proowner
  where admin_check.oid = to_regprocedure('public.is_platform_admin()')
    and role_check.oid = to_regprocedure('public.platform_current_role()')
), anonymous_boundary as (
  select
    count(*) filter (
      where privilege.grantee in ('PUBLIC', 'anon')
        and privilege.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
    ) as direct_operational_grant_count,
    has_function_privilege('anon', 'public.get_public_site(text)', 'EXECUTE')
      as public_site_callable,
    has_function_privilege(
      'anon',
      'public.submit_public_site_lead(text,text,text,text,text,uuid,jsonb)',
      'EXECUTE'
    ) as public_lead_callable
  from information_schema.table_privileges privilege
  where privilege.table_schema = 'public'
    and privilege.table_name = any(array[
      'courses','course_sections','lessons','students','enrollments','cohorts',
      'cohort_members','sessions','attendance_records','assignments',
      'assignment_submissions','academy_announcements','community_posts',
      'community_comments','document_records','finance_settings','finance_fee_plans',
      'finance_invoices','finance_payments','finance_receipts','finance_adjustments',
      'payments','receipts','payment_links','conversation_threads',
      'conversation_participants','conversation_messages','automation_rules',
      'automation_rule_conditions','automation_rule_actions','automation_runs',
      'automation_run_logs','ai_conversations','ai_messages','ai_request_logs',
      'workflow_templates','workflow_template_steps','workflow_runs',
      'workflow_run_steps','approval_requests','delegated_permissions','crm_leads',
      'crm_lead_notes','crm_follow_up_tasks','marketing_campaigns',
      'marketing_campaign_leads','marketing_message_templates',
      'trainer_course_assignments','trainer_cohort_assignments','team_invitations',
      'student_portal_invitations','lesson_progress','certificates',
      'tenant_feature_settings','reminders','notification_preferences',
      'communication_logs','notifications','public_site_leads','tenant_members'
    ]::text[])
), domain_helpers(identity, student_helper) as (
  values
    ('public.m69_1_current_role(uuid)', false),
    ('public.m69_2_current_role(uuid)', false),
    ('public.m69_3_current_role(uuid)', false),
    ('public.m69_4_current_role(uuid)', false),
    ('public.m69_5_current_role(uuid)', false),
    ('public.m69_6_current_role(uuid)', false),
    ('public.m69_8_current_role(uuid)', false),
    ('public.m69_9_current_role(uuid)', false),
    ('public.finance_current_role(uuid)', false),
    ('public.reports_current_role(uuid)', false),
    ('public.document_center_current_role(uuid)', false),
    ('public.chat_current_team_role(uuid)', false),
    ('public.workflow_current_role(uuid)', false),
    ('public.approval_current_role(uuid)', false),
    ('public.team_ops_current_role(uuid)', false),
    ('public.crm_current_role(uuid)', false),
    ('public.marketing_current_member_role(uuid)', false),
    ('public.m70_3a_current_role(uuid)', false),
    ('public.m70_3b_current_role(uuid)', false),
    ('coachfort_internal.student_portal_access_allowed_for_user(uuid,uuid,uuid,uuid,text)', true),
    ('public.finance_student_can_access(uuid,uuid)', true),
    ('public.chat_student_context()', true),
    ('public.document_center_student_context()', true)
), domain_state as (
  select
    helper.identity,
    procedure.oid is not null installed,
    owner_role.rolname = 'postgres' postgres_owned,
    procedure.prosecdef security_definer,
    coalesce(procedure.proconfig, array[]::text[])
      @> array['search_path=public, pg_temp'] fixed_search_path,
    case when helper.student_helper then
      lower(pg_get_functiondef(procedure.oid)) like
        '%tenant_operational_access_allowed%'
    else
      lower(pg_get_functiondef(procedure.oid)) like
        '%operational_current_team_role%'
    end lifecycle_bound
  from domain_helpers helper
  left join pg_proc procedure on procedure.oid = to_regprocedure(helper.identity)
  left join pg_roles owner_role on owner_role.oid = procedure.proowner
), leaf_state as (
  select
    procedure.oid is not null installed,
    owner_role.rolname = 'postgres' postgres_owned,
    procedure.prosecdef security_definer,
    coalesce(procedure.proconfig, array[]::text[])
      @> array['search_path=public, pg_temp'] fixed_search_path,
    lower(pg_get_functiondef(procedure.oid)) source
  from (select to_regprocedure(
    'public.run_automation_trigger(uuid,text,text,uuid,jsonb)'
  ) oid) expected
  left join pg_proc procedure on procedure.oid = expected.oid
  left join pg_roles owner_role on owner_role.oid = procedure.proowner
), exclusions as (
  select count(*) as accidental_policy_count
  from pg_policies
  where schemaname = 'public'
    and policyname = 'UX8G1B operational lifecycle gate'
    and tablename = any(array[
      'profiles','tenants','student_portal_accounts',
      'tenant_subscription_assignments','tenant_billing_profiles',
      'platform_billing_invoices','platform_billing_receipts',
      'subscription_plans','tenant_plan_upgrade_requests',
      'subscription_change_intents','tenant_payment_orders'
    ]::text[])
), contract_state as (
  select
    to_regprocedure('public.get_tenant_subscription_lifecycle(uuid)') is not null
      recovery_lifecycle_read,
    to_regprocedure('public.get_tenant_billing_profile(uuid)') is not null
      recovery_billing_read,
    to_regprocedure('public.get_platform_billing_documents(uuid)') is not null
      recovery_document_read,
    to_regprocedure(
      'public.create_platform_renewal_payment_order_authority_server(uuid,uuid,uuid,uuid)'
    ) is not null renewal_authority,
    to_regprocedure(
      'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)'
    ) is not null initial_payment_authority,
    to_regprocedure('public.get_public_plan_catalog(text)') is not null
      public_plan_catalog,
    to_regprocedure(
      'public.activate_tenant_plan_after_verified_payment(uuid)'
    ) is not null ux8f_activation_identity
), workspace_bootstrap_function as (
  select
    procedure.oid,
    owner_role.rolname as owner_name,
    procedure.prosecdef as security_definer,
    procedure.proconfig as config,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) as source,
    coalesce(has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    ), false) as authenticated_execute,
    coalesce(has_function_privilege('anon', procedure.oid, 'EXECUTE'), false)
      as anon_execute,
    coalesce(has_function_privilege(
      'service_role', procedure.oid, 'EXECUTE'
    ), false) as service_role_execute,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute
  from (select to_regprocedure(
    'public.create_workspace_with_owner(text,text,text)'
  ) as oid) expected
  left join pg_proc procedure on procedure.oid = expected.oid
  left join pg_roles owner_role on owner_role.oid = procedure.proowner
), workspace_bootstrap_state as (
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'subscription_plans'
        and column_name = 'is_workspace_trial_default'
        and data_type = 'boolean'
    ) as marker_column_present,
    (select count(*) from public.subscription_plans
      where is_workspace_trial_default) as default_plan_count,
    (select count(*) from public.subscription_plans
      where is_workspace_trial_default
        and status in ('draft', 'active')
        and trial_days > 0) as eligible_default_plan_count,
    bootstrap.oid is not null
      and bootstrap.owner_name = 'postgres'
      and bootstrap.security_definer
      and bootstrap.config @> array['search_path=public, pg_temp']::text[]
      as secure_workspace_rpc,
    bootstrap.authenticated_execute
      and not bootstrap.anon_execute
      and not bootstrap.service_role_execute
      and not bootstrap.public_execute as authenticated_only_rpc,
    bootstrap.source like
      '%insert into public.tenant_subscription_assignments%'
      and bootstrap.source like '%''trial'', ''monthly'', ''inr''%'
      and bootstrap.source like '%''not_required'', ''system'', true%'
      as canonical_trial_insert,
    bootstrap.source like '%where plan.is_workspace_trial_default%'
      and bootstrap.source like '%plan.status in (''draft'', ''active'')%'
      and bootstrap.source like '%plan.trial_days > 0%'
      and bootstrap.source not like '%plan.code =%'
      as marker_driven_resolution
  from workspace_bootstrap_function bootstrap
), tenant_assignment_state as (
  select
    count(*) filter (where operational_in_scope) as operational_tenant_count,
    count(*) filter (where has_current_assignment)
      as canonical_current_assignment_count,
    count(*) filter (where not has_any_assignment)
      as legacy_pre_subscription_inactive_count,
    count(*) filter (
      where has_any_assignment and not has_current_assignment
    ) as assignment_history_without_current_count,
    coalesce(jsonb_agg(tenant_id order by tenant_id) filter (
      where not has_any_assignment
    ), '[]'::jsonb) as legacy_pre_subscription_inactive_tenant_ids,
    coalesce(jsonb_agg(tenant_id order by tenant_id) filter (
      where has_any_assignment and not has_current_assignment
    ), '[]'::jsonb) as assignment_history_without_current_tenant_ids,
    count(*) filter (
      where not has_any_assignment
        and coachfort_internal.tenant_operational_access_allowed(tenant_id)
    ) as legacy_pre_subscription_operationally_allowed_count,
    count(*) filter (
      where has_current_assignment
        and (
          lifecycle->>'effective_state' = 'malformed'
          or lifecycle->>'reason' in (
            'missing_canonical_assignment',
            'invalid_status_payment_combination',
            'missing_period_authority',
            'future_period_start',
            'invalid_period_ordering',
            'missing_trial_authority',
            'future_trial_start',
            'invalid_trial_ordering',
            'invalid_grace_authority'
          )
        )
    ) as malformed_current_assignment_count
  from (
    select
      tenant.id as tenant_id,
      exists (
        select 1 from public.tenant_subscription_assignments assignment
        where assignment.tenant_id = tenant.id and assignment.is_current
      ) as has_current_assignment,
      exists (
        select 1 from public.tenant_subscription_assignments assignment
        where assignment.tenant_id = tenant.id
      ) as has_any_assignment,
      coachfort_internal.tenant_subscription_effective_lifecycle(
        tenant.id
      ) as lifecycle,
      (
        exists (
          select 1 from public.tenant_subscription_assignments assignment
          where assignment.tenant_id = tenant.id
        )
        or exists (
          select 1 from public.tenant_members member
          where member.tenant_id = tenant.id
        )
        or exists (
          select 1 from public.courses course where course.tenant_id = tenant.id
        )
        or exists (
          select 1 from public.students student where student.tenant_id = tenant.id
        )
        or exists (
          select 1 from public.enrollments enrollment
          where enrollment.tenant_id = tenant.id
        )
        or exists (
          select 1 from public.sessions session_row
          where session_row.tenant_id = tenant.id
        )
        or exists (
          select 1 from public.assignments assignment
          where assignment.tenant_id = tenant.id
        )
      ) as operational_in_scope
    from public.tenants tenant
  ) coverage
), gates as (
  select
    (select bool_and(
      installed and owner_name = 'postgres' and security_definer
      and stable = expected_stable
      and fixed_search_path
      and authenticated_execute = expected_authenticated_execute
      and not anon_execute and not service_role_execute and not public_execute
    ) from function_state) function_security,
    (select position(
        'when not v_operational_allowed then ''locked''' in resolver_source
      ) < position(
        'when feature_override.override_type = ''feature_lock'' then ''locked'''
        in resolver_source
      )
      and resolver_source like '%subscription_lifecycle%'
      from source_state) lifecycle_before_feature_override,
    (select tenant_feature_source like '%feature_access_effective_rows%'
      and portal_feature_source like '%feature_access_effective_rows%'
      and position(
        'tenant_subscription_effective_lifecycle' in entitlement_source
      ) < position(
        'subscription_entitlements_latest_usage' in entitlement_source
      )
      from source_state) public_entitlement_chain,
    (select feature_rows_source like
        '%coachfort_internal.resolve_effective_feature_access_authority%'
      and tenant_feature_source like '%feature_access_current_role%'
      and tenant_feature_source like '%is_platform_admin%'
      and portal_feature_source like '%has_any_active_student_portal_account%'
      and portal_feature_source like '%auth.uid()%'
      from source_state) feature_row_isolation,
    (select position('assert_tenant_operational_access' in usage_source)
      < position('subscription_plan_usage_limits' in usage_source)
      and position('assert_tenant_operational_access' in entity_source)
      < position('subscription_plan_usage_limits' in entity_source)
      and position('assert_tenant_operational_access' in team_limit_source)
      < position('subscription_plan_usage_limits' in team_limit_source)
      and position('assert_tenant_operational_access' in storage_source)
      < position('private_storage_usage' in storage_source)
      from source_state) quota_lifecycle_first,
    (select coalesce(bool_and(
      rls_enabled and installed and restrictive
      and lifecycle_using and lifecycle_check
    ), true) from policy_state) restrictive_policy_gate,
    (select coalesce(bool_and(
      rls_enabled and tenant_key_present and lifecycle_authority_installed
    ), true) from operational_authority_state) operational_authority_gate,
    (select coalesce(bool_and(installed and correct_binding), true)
      from trigger_state) mutation_trigger_gate,
    (select mutation_trigger_source not like '%auth.uid() is null%'
      and mutation_trigger_source like
        '%assert_tenant_operational_access(v_old_tenant_id)%'
      and mutation_trigger_source like
        '%assert_tenant_operational_access(v_new_tenant_id)%'
      from source_state) null_uid_fail_closed,
    (select direct_operational_grant_count = 0
      and public_site_callable and public_lead_callable
      from anonymous_boundary)
      and (select public_site_source like
        '%tenant_operational_access_allowed( site_tenant.id )%'
        or public_site_source like
        '%tenant_operational_access_allowed(site_tenant.id)%'
      from source_state) anonymous_public_boundary,
    (select tenant_members_bootstrap
      and tenant_member_browser_writes_absent
      from special_policy_state) tenant_members_bootstrap_gate,
    (select installed and postgres_owned and security_definer and stable
      and fixed_search_path and authenticated_execute
      and anon_execute_absent and service_role_execute_absent
      and public_execute_absent from platform_authority_state)
      and (select platform_admin_source like '%public.platform_current_role()%'
        and platform_admin_source not like '%tenant_members%'
        and platform_role_source like '%from public.platform_admin_users%'
        and platform_role_source like '%auth.uid()%'
        and platform_role_source like '%status = ''active''%'
        and platform_role_source not like '%tenant_members%'
      from source_state) platform_authority_gate,
    (select notification_lifecycle
      and notification_browser_writes_absent
      and reminder_browser_writes_absent
      from special_policy_state)
      and (select notification_mark_source like
          '%notification_lifecycle_access_allowed%'
        and mobile_notifications_source like
          '%notification_lifecycle_access_allowed%'
        and notification_access_source like
          '%p_notification_type = ''subscription_notice''%'
        and notification_access_source not like '%payment_reminder%'
        and notification_access_source not like '%invoice_notice%'
        and notification_access_source like '%member.role in (''owner'', ''admin'')%'
        and notification_access_source not like '%invitation_notice%'
        and notification_access_source not like '%system_notice%'
      from source_state) notification_lifecycle_gate,
    (select bool_and(
      installed and postgres_owned and security_definer
      and fixed_search_path and lifecycle_bound
    )
      from domain_state) domain_authority_gate,
    (select installed and postgres_owned and security_definer
      and fixed_search_path
      and position('assert_tenant_operational_access' in source)
        < position('is_valid_automation_trigger' in source)
      and position('assert_tenant_operational_access' in source)
        < position('run_automation_trigger_unvalidated' in source)
      from leaf_state) leaf_authority_gate,
    exists (
      select 1 from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'students'
        and policy.policyname = 'UX8G1B operational lifecycle gate'
        and policy.permissive = 'RESTRICTIVE'
        and coalesce(policy.qual, '') like
          '%student_bootstrap_identity_allowed%'
        and coalesce(policy.qual, '') not like
          '%student_portal_accounts%'
    ) student_bootstrap_policy_gate,
    (select accidental_policy_count = 0 from exclusions) recovery_exclusions,
    not exists (
      select 1
      from unnest(string_to_array(
        coalesce(current_setting('pgrst.db_schemas', true), ''),
        ','
      )) exposed(schema_name)
      where trim(exposed.schema_name) = 'coachfort_internal'
    ) internal_schema_private,
    not exists (
      select 1
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relname in (
          'tenant_subscription_assignments',
          'tenant_members',
          'student_portal_accounts'
        )
        and class.relforcerowsecurity
    ) helper_force_rls_safe,
    has_schema_privilege(
      'authenticated',
      'coachfort_internal',
      'USAGE'
    ) rls_helper_schema_usage,
    (select bool_and(
      recovery_lifecycle_read and recovery_billing_read
      and recovery_document_read and renewal_authority
      and initial_payment_authority and public_plan_catalog
      and ux8f_activation_identity
    ) from contract_state) recovery_contracts,
    (select marker_column_present
      and default_plan_count = 1
      and eligible_default_plan_count = 1
      and secure_workspace_rpc
      and authenticated_only_rpc
      and canonical_trial_insert
      and marker_driven_resolution
      from workspace_bootstrap_state) workspace_bootstrap_gate,
    (select assignment_history_without_current_count = 0
      and legacy_pre_subscription_operationally_allowed_count = 0
      and malformed_current_assignment_count = 0
      from tenant_assignment_state) tenant_assignment_coverage_gate
)
select jsonb_build_object(
  'security_gate', function_security
    and lifecycle_before_feature_override
    and public_entitlement_chain
    and feature_row_isolation
    and quota_lifecycle_first
    and restrictive_policy_gate
    and operational_authority_gate
    and mutation_trigger_gate
    and null_uid_fail_closed
    and anonymous_public_boundary
    and tenant_members_bootstrap_gate
    and platform_authority_gate
    and notification_lifecycle_gate
    and domain_authority_gate
    and leaf_authority_gate
    and student_bootstrap_policy_gate
    and recovery_exclusions
    and internal_schema_private
    and helper_force_rls_safe
    and rls_helper_schema_usage
    and recovery_contracts
    and workspace_bootstrap_gate
    and tenant_assignment_coverage_gate,
  'function_security', function_security,
  'lifecycle_before_feature_override', lifecycle_before_feature_override,
  'public_entitlement_chain', public_entitlement_chain,
  'feature_row_isolation', feature_row_isolation,
  'quota_lifecycle_first', quota_lifecycle_first,
  'restrictive_policy_gate', restrictive_policy_gate,
  'operational_authority_gate', operational_authority_gate,
  'mutation_trigger_gate', mutation_trigger_gate,
  'null_uid_fail_closed', null_uid_fail_closed,
  'anonymous_public_boundary', anonymous_public_boundary,
  'tenant_members_bootstrap_gate', tenant_members_bootstrap_gate,
  'platform_authority_gate', platform_authority_gate,
  'notification_lifecycle_gate', notification_lifecycle_gate,
  'domain_authority_gate', domain_authority_gate,
  'leaf_authority_gate', leaf_authority_gate,
  'student_bootstrap_policy_gate', student_bootstrap_policy_gate,
  'recovery_exclusions', recovery_exclusions,
  'internal_schema_private', internal_schema_private,
  'helper_force_rls_safe', helper_force_rls_safe,
  'rls_helper_schema_usage', rls_helper_schema_usage,
  'recovery_contracts', recovery_contracts,
  'workspace_bootstrap_gate', workspace_bootstrap_gate,
  'workspace_bootstrap',
    (select to_jsonb(workspace_bootstrap_state) from workspace_bootstrap_state),
  'tenant_assignment_coverage_gate', tenant_assignment_coverage_gate,
  'functions', (select jsonb_agg(to_jsonb(function_state) order by identity) from function_state),
  'anonymous_boundary', (select to_jsonb(anonymous_boundary) from anonymous_boundary),
  'special_policies', (select to_jsonb(special_policy_state) from special_policy_state),
  'platform_authority', (select to_jsonb(platform_authority_state) from platform_authority_state),
  'tenant_assignment_coverage', (select to_jsonb(tenant_assignment_state) from tenant_assignment_state),
  'policies', coalesce((select jsonb_agg(to_jsonb(policy_state) order by relname) from policy_state), '[]'::jsonb),
  'authenticated_operational_authority', coalesce((select jsonb_agg(to_jsonb(operational_authority_state) order by relname) from operational_authority_state), '[]'::jsonb),
  'operational_triggers', (select jsonb_agg(to_jsonb(trigger_state) order by relname) from trigger_state),
  'domain_helpers', (select jsonb_agg(to_jsonb(domain_state) order by identity) from domain_state),
  'stored_status_rewritten', false,
  'migration_backfilled_legacy_assignments', false,
  'business_rows_created_or_deleted', false
)
from gates;
*/
