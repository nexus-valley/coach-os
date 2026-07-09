-- Module 71.7P2: Internal Plan Catalog Configuration
--
-- Review before execution. Do not execute automatically.
--
-- Purpose:
-- - Configure canonical Starter, Growth, and Premium plan catalog rows with
--   draft/private prices, usage limits, storage quotas, and feature
--   entitlements.
-- - Keep all plans private and out of the public catalog.
-- - Prepare internal completeness for later Razorpay-verified activation work.
--
-- Non-goals:
-- - Does not make any plan public.
-- - Does not activate checkout or payment gateway behavior.
-- - Does not assign any tenant to Growth or Premium.
-- - Does not change request options, Module 62, FeatureGate, or legacy
--   Module 56 billing state.
-- - Does not create payment orders, invoices, links, or transactions.
--
-- Pricing note:
-- - Amounts are internal placeholders only and intentionally draft/private.
-- - Final commercial prices, tax/GST behavior, and Razorpay test-mode smoke
--   must be approved before any public pricing or checkout activation.

begin;

with plan_rows (
  code,
  name,
  tier_rank,
  description,
  status,
  is_public,
  trial_days,
  metadata_json
) as (
  values
    (
      'starter',
      'Starter',
      10,
      'Internal draft starter plan for early paid-launch configuration review.',
      'draft',
      false,
      14,
      '{"module":"71.7P2","catalog_state":"internal_configured_draft","public_pricing":"not_final","checkout_enabled":false,"payment_gateway_called":false}'::jsonb
    ),
    (
      'growth',
      'Growth',
      20,
      'Internal draft growth plan for paid-launch configuration review.',
      'draft',
      false,
      14,
      '{"module":"71.7P2","catalog_state":"internal_configured_draft","public_pricing":"not_final","checkout_enabled":false,"payment_gateway_called":false}'::jsonb
    ),
    (
      'premium',
      'Premium',
      30,
      'Internal draft premium plan for high-scale and platform-approved needs.',
      'draft',
      false,
      14,
      '{"module":"71.7P2","catalog_state":"internal_configured_draft","public_pricing":"not_final","checkout_enabled":false,"payment_gateway_called":false,"commercial_model":"contact_sales_pending"}'::jsonb
    )
)
insert into public.subscription_plans (
  code,
  name,
  tier_rank,
  description,
  status,
  is_public,
  trial_days,
  metadata_json
)
select
  code,
  name,
  tier_rank,
  description,
  status,
  is_public,
  trial_days,
  metadata_json
from plan_rows
on conflict (code) do update
set
  name = excluded.name,
  tier_rank = excluded.tier_rank,
  description = excluded.description,
  status = 'draft',
  is_public = false,
  trial_days = excluded.trial_days,
  metadata_json = coalesce(public.subscription_plans.metadata_json, '{}'::jsonb)
    || excluded.metadata_json,
  updated_at = now();

with price_rows (
  plan_code,
  currency,
  billing_cycle,
  amount_minor,
  setup_fee_amount_minor,
  tax_behavior,
  region_code,
  status,
  metadata_json
) as (
  values
    (
      'starter',
      'INR',
      'monthly',
      0,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"module":"71.7P2","placeholder_price":true,"public_pricing":"not_final","owner_approval_required":true,"checkout_enabled":false}'::jsonb
    ),
    (
      'starter',
      'INR',
      'yearly',
      0,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"module":"71.7P2","placeholder_price":true,"public_pricing":"not_final","owner_approval_required":true,"checkout_enabled":false}'::jsonb
    ),
    (
      'growth',
      'INR',
      'monthly',
      0,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"module":"71.7P2","placeholder_price":true,"public_pricing":"not_final","owner_approval_required":true,"checkout_enabled":false}'::jsonb
    ),
    (
      'growth',
      'INR',
      'yearly',
      0,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"module":"71.7P2","placeholder_price":true,"public_pricing":"not_final","owner_approval_required":true,"checkout_enabled":false}'::jsonb
    ),
    (
      'premium',
      'INR',
      'custom',
      0,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"module":"71.7P2","placeholder_price":true,"public_pricing":"not_final","owner_approval_required":true,"checkout_enabled":false,"commercial_model":"contact_sales_pending"}'::jsonb
    )
)
insert into public.subscription_plan_prices (
  plan_id,
  currency,
  billing_cycle,
  amount_minor,
  setup_fee_amount_minor,
  tax_behavior,
  region_code,
  status,
  metadata_json
)
select
  sp.id,
  pr.currency,
  pr.billing_cycle,
  pr.amount_minor,
  pr.setup_fee_amount_minor,
  pr.tax_behavior,
  pr.region_code,
  pr.status,
  pr.metadata_json
from price_rows pr
join public.subscription_plans sp on sp.code = pr.plan_code
on conflict (plan_id, currency, billing_cycle, region_code, status) do update
set
  amount_minor = excluded.amount_minor,
  setup_fee_amount_minor = excluded.setup_fee_amount_minor,
  tax_behavior = excluded.tax_behavior,
  metadata_json = excluded.metadata_json,
  updated_at = now();

with limit_rows (
  plan_code,
  resource_key,
  limit_value,
  limit_type,
  enforcement_mode,
  warning_threshold_percent,
  allow_platform_override,
  metadata_json
) as (
  values
    ('starter', 'students', 100, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('starter', 'courses', 5, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('starter', 'cohorts', 5, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('starter', 'batches', 5, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('starter', 'admins', 2, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('starter', 'staff_trainers', 3, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('starter', 'team_members', 5, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('starter', 'storage_mb', 2048, 'storage_mb', 'hard', 80, true, '{"module":"71.7P2","storage_quota_mb":2048,"storage_enforcement_integration_pending":true}'::jsonb),
    ('starter', 'document_uploads', 500, 'count', 'hard', 80, true, '{"module":"71.7P2","storage_enforcement_integration_pending":true}'::jsonb),
    ('starter', 'messages_monthly', 1000, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true}'::jsonb),
    ('starter', 'automation_runs_monthly', 0, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true}'::jsonb),
    ('starter', 'ai_requests_monthly', 0, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true,"ai_launch_pending":true}'::jsonb),

    ('growth', 'students', 1000, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('growth', 'courses', 50, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('growth', 'cohorts', 50, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('growth', 'batches', 50, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('growth', 'admins', 5, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('growth', 'staff_trainers', 20, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('growth', 'team_members', 25, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true}'::jsonb),
    ('growth', 'storage_mb', 25600, 'storage_mb', 'hard', 80, true, '{"module":"71.7P2","storage_quota_mb":25600,"storage_enforcement_integration_pending":true}'::jsonb),
    ('growth', 'document_uploads', 10000, 'count', 'hard', 80, true, '{"module":"71.7P2","storage_enforcement_integration_pending":true}'::jsonb),
    ('growth', 'messages_monthly', 25000, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true}'::jsonb),
    ('growth', 'automation_runs_monthly', 5000, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true}'::jsonb),
    ('growth', 'ai_requests_monthly', 500, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true,"ai_launch_pending":true}'::jsonb),

    ('premium', 'students', 10000, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'courses', 500, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'cohorts', 500, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'batches', 500, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'admins', 20, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'staff_trainers', 100, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'team_members', 125, 'count', 'hard', 80, true, '{"module":"71.7P2","launch_review_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'storage_mb', 102400, 'storage_mb', 'hard', 80, true, '{"module":"71.7P2","storage_quota_mb":102400,"storage_enforcement_integration_pending":true}'::jsonb),
    ('premium', 'document_uploads', 50000, 'count', 'hard', 80, true, '{"module":"71.7P2","storage_enforcement_integration_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'messages_monthly', 100000, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'automation_runs_monthly', 25000, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'ai_requests_monthly', 10000, 'monthly_count', 'hard', 80, true, '{"module":"71.7P2","monthly_window_required":true,"ai_launch_pending":true,"premium_high_limit":true}'::jsonb)
)
insert into public.subscription_plan_usage_limits (
  plan_id,
  resource_key,
  limit_value,
  limit_type,
  enforcement_mode,
  warning_threshold_percent,
  allow_platform_override,
  metadata_json
)
select
  sp.id,
  lr.resource_key,
  lr.limit_value,
  lr.limit_type,
  lr.enforcement_mode,
  lr.warning_threshold_percent,
  lr.allow_platform_override,
  lr.metadata_json
from limit_rows lr
join public.subscription_plans sp on sp.code = lr.plan_code
on conflict (plan_id, resource_key) do update
set
  limit_value = excluded.limit_value,
  limit_type = excluded.limit_type,
  enforcement_mode = excluded.enforcement_mode,
  warning_threshold_percent = excluded.warning_threshold_percent,
  allow_platform_override = excluded.allow_platform_override,
  metadata_json = excluded.metadata_json,
  updated_at = now();

with feature_rows (
  plan_code,
  feature_key,
  entitlement_status,
  requires_platform_approval,
  included_quota,
  metadata_json
) as (
  select
    'starter',
    feature_key,
    'included',
    false,
    null::integer,
    '{"module":"71.7P2","launch_review_required":true}'::jsonb
  from unnest(array[
    'dashboard',
    'students',
    'courses',
    'attendance',
    'assignments',
    'finance',
    'reports',
    'documents',
    'document_uploads',
    'messages',
    'notifications',
    'mobile_pwa'
  ]::text[]) as feature_key
  union all
  select
    'starter',
    feature_key,
    'locked',
    false,
    null::integer,
    '{"module":"71.7P2","requires_higher_plan_or_override":true}'::jsonb
  from unnest(array[
    'crm',
    'marketing',
    'automations',
    'workflows',
    'approvals',
    'team_operations',
    'audit_compliance',
    'backup_recovery',
    'website_builder',
    'certificates',
    'ai_assistant',
    'custom_branding',
    'api_integrations'
  ]::text[]) as feature_key
  union all
  select
    'starter',
    feature_key,
    'coming_soon',
    true,
    null::integer,
    '{"module":"71.7P2","global_lock_expected":true,"activation_module_required":true}'::jsonb
  from unnest(array[
    'payment_gateway',
    'live_classes',
    'community_hub'
  ]::text[]) as feature_key

  union all
  select
    'growth',
    feature_key,
    'included',
    false,
    null::integer,
    '{"module":"71.7P2","launch_review_required":true}'::jsonb
  from unnest(array[
    'dashboard',
    'students',
    'courses',
    'attendance',
    'assignments',
    'finance',
    'reports',
    'documents',
    'document_uploads',
    'messages',
    'crm',
    'marketing',
    'automations',
    'workflows',
    'approvals',
    'team_operations',
    'audit_compliance',
    'backup_recovery',
    'certificates',
    'notifications',
    'mobile_pwa'
  ]::text[]) as feature_key
  union all
  select
    'growth',
    feature_key,
    'addon',
    true,
    null::integer,
    '{"module":"71.7P2","addon_or_platform_approval_required":true}'::jsonb
  from unnest(array[
    'website_builder',
    'custom_branding'
  ]::text[]) as feature_key
  union all
  select
    'growth',
    feature_key,
    'locked',
    false,
    null::integer,
    '{"module":"71.7P2","requires_premium_or_override":true}'::jsonb
  from unnest(array[
    'api_integrations'
  ]::text[]) as feature_key
  union all
  select
    'growth',
    feature_key,
    'platform_approval_required',
    true,
    null::integer,
    '{"module":"71.7P2","ai_launch_pending":true,"platform_approval_required":true}'::jsonb
  from unnest(array[
    'ai_assistant'
  ]::text[]) as feature_key
  union all
  select
    'growth',
    feature_key,
    'coming_soon',
    true,
    null::integer,
    '{"module":"71.7P2","global_lock_expected":true,"activation_module_required":true}'::jsonb
  from unnest(array[
    'payment_gateway',
    'live_classes',
    'community_hub'
  ]::text[]) as feature_key

  union all
  select
    'premium',
    feature_key,
    'included',
    false,
    null::integer,
    '{"module":"71.7P2","premium_included":true,"launch_review_required":true}'::jsonb
  from unnest(array[
    'dashboard',
    'students',
    'courses',
    'attendance',
    'assignments',
    'finance',
    'reports',
    'documents',
    'document_uploads',
    'messages',
    'crm',
    'marketing',
    'automations',
    'workflows',
    'approvals',
    'team_operations',
    'audit_compliance',
    'backup_recovery',
    'website_builder',
    'certificates',
    'notifications',
    'mobile_pwa',
    'custom_branding',
    'api_integrations'
  ]::text[]) as feature_key
  union all
  select
    'premium',
    feature_key,
    'platform_approval_required',
    true,
    null::integer,
    '{"module":"71.7P2","ai_launch_pending":true,"platform_approval_required":true}'::jsonb
  from unnest(array[
    'ai_assistant'
  ]::text[]) as feature_key
  union all
  select
    'premium',
    feature_key,
    'coming_soon',
    true,
    null::integer,
    '{"module":"71.7P2","global_lock_expected":true,"activation_module_required":true}'::jsonb
  from unnest(array[
    'payment_gateway',
    'live_classes',
    'community_hub'
  ]::text[]) as feature_key
)
insert into public.subscription_plan_feature_entitlements (
  plan_id,
  feature_key,
  entitlement_status,
  requires_platform_approval,
  included_quota,
  metadata_json
)
select
  sp.id,
  fr.feature_key,
  fr.entitlement_status,
  fr.requires_platform_approval,
  fr.included_quota,
  fr.metadata_json
from feature_rows fr
join public.subscription_plans sp on sp.code = fr.plan_code
on conflict (plan_id, feature_key) do update
set
  entitlement_status = excluded.entitlement_status,
  requires_platform_approval = excluded.requires_platform_approval,
  included_quota = excluded.included_quota,
  metadata_json = excluded.metadata_json,
  updated_at = now();

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Plans remain draft/private.
-- select code, status, is_public, trial_days
-- from public.subscription_plans
-- where code in ('starter', 'growth', 'premium')
-- order by tier_rank;
--
-- 2. Public catalog remains empty because no plan is active/public.
-- select public.get_public_plan_catalog(null);
--
-- 3. Expected draft INR price rows exist.
-- select sp.code, spp.currency, spp.billing_cycle, spp.amount_minor, spp.status, spp.metadata_json->>'placeholder_price' as placeholder_price
-- from public.subscription_plans sp
-- join public.subscription_plan_prices spp on spp.plan_id = sp.id
-- where sp.code in ('starter', 'growth', 'premium')
-- order by sp.tier_rank, spp.currency, spp.billing_cycle;
--
-- 4. Required usage limits are present for every plan.
-- with required(resource_key) as (
--   values
--     ('students'),
--     ('courses'),
--     ('cohorts'),
--     ('batches'),
--     ('admins'),
--     ('staff_trainers'),
--     ('team_members'),
--     ('storage_mb'),
--     ('document_uploads'),
--     ('messages_monthly'),
--     ('automation_runs_monthly'),
--     ('ai_requests_monthly')
-- ),
-- plans as (
--   select id, code
--   from public.subscription_plans
--   where code in ('starter', 'growth', 'premium')
-- )
-- select p.code, r.resource_key
-- from plans p
-- cross join required r
-- left join public.subscription_plan_usage_limits spl
--   on spl.plan_id = p.id and spl.resource_key = r.resource_key
-- where spl.id is null
-- order by p.code, r.resource_key;
-- -- Expected: zero rows.
--
-- 5. Required feature entitlements are present for every plan.
-- with required(feature_key) as (
--   values
--     ('dashboard'),
--     ('students'),
--     ('courses'),
--     ('attendance'),
--     ('assignments'),
--     ('finance'),
--     ('reports'),
--     ('documents'),
--     ('document_uploads'),
--     ('messages'),
--     ('crm'),
--     ('marketing'),
--     ('automations'),
--     ('workflows'),
--     ('approvals'),
--     ('team_operations'),
--     ('audit_compliance'),
--     ('backup_recovery'),
--     ('website_builder'),
--     ('certificates'),
--     ('payment_gateway'),
--     ('live_classes'),
--     ('notifications'),
--     ('mobile_pwa'),
--     ('ai_assistant'),
--     ('custom_branding'),
--     ('api_integrations'),
--     ('community_hub')
-- ),
-- plans as (
--   select id, code
--   from public.subscription_plans
--   where code in ('starter', 'growth', 'premium')
-- )
-- select p.code, r.feature_key
-- from plans p
-- cross join required r
-- left join public.subscription_plan_feature_entitlements spf
--   on spf.plan_id = p.id and spf.feature_key = r.feature_key
-- where spf.id is null
-- order by p.code, r.feature_key;
-- -- Expected: zero rows.
--
-- 6. Gateway/live classes remain coming soon.
-- select sp.code, spf.feature_key, spf.entitlement_status, spf.requires_platform_approval
-- from public.subscription_plans sp
-- join public.subscription_plan_feature_entitlements spf on spf.plan_id = sp.id
-- where sp.code in ('starter', 'growth', 'premium')
--   and spf.feature_key in ('payment_gateway', 'live_classes')
-- order by sp.tier_rank, spf.feature_key;
--
-- 7. No tenant assignment is created by this patch.
-- select count(*) as tenant_assignment_count
-- from public.tenant_subscription_assignments;
--
-- 8. Regression tenant assignment, if present, remains unchanged.
-- select tsa.tenant_id, sp.code as plan_code, tsa.status, tsa.payment_status, tsa.currency, tsa.billing_cycle
-- from public.tenant_subscription_assignments tsa
-- join public.subscription_plans sp on sp.id = tsa.plan_id
-- where tsa.tenant_id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
--   and tsa.is_current;
--
-- 9. Direct table grants should remain absent for PUBLIC/anon/authenticated.
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in (
--     'subscription_plans',
--     'subscription_plan_prices',
--     'subscription_plan_usage_limits',
--     'subscription_plan_feature_entitlements'
--   )
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
-- order by table_name, grantee, privilege_type;
-- -- Expected: zero rows.
