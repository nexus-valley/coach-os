-- Module 71.7R0A-B: Final Plan Limit Alignment SQL Proposal
--
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Align canonical Starter, Growth, and Premium usage limits to the approved
--   Option B balanced commercial packaging matrix.
-- - Update subscription_plan_usage_limits only.
-- - Preserve draft/private plan visibility, disabled checkout, global
--   payment/live-class locks, tenant overrides, tenant assignments, and request
--   options.
--
-- Non-goals:
-- - Does not update subscription_plans.status or subscription_plans.is_public.
-- - Does not update subscription_plan_prices.
-- - Does not update subscription_plan_feature_entitlements.
-- - Does not update tenant_subscription_assignments.
-- - Does not update tenant_subscription_overrides.
-- - Does not update subscription_plan_request_options.
-- - Does not activate checkout or payment gateway behavior.
-- - Does not change Module 62, FeatureGate, or legacy Module 56 behavior.

begin;

with approved_limit_rows (
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
    ('starter', 'students', 100, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'courses', 5, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'cohorts', 5, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'batches', 5, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'admins', 2, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'staff_trainers', 3, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'team_members', 5, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'storage_mb', 2048, 'storage_mb', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"storage_quota_mb":2048}'::jsonb),
    ('starter', 'document_uploads', 500, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('starter', 'messages_monthly', 1000, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true}'::jsonb),
    ('starter', 'automation_runs_monthly', 0, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true}'::jsonb),
    ('starter', 'ai_requests_monthly', 0, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true,"ai_launch_pending":true}'::jsonb),

    ('growth', 'students', 500, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'courses', 25, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'cohorts', 25, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'batches', 25, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'admins', 5, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'staff_trainers', 15, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'team_members', 20, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'storage_mb', 25600, 'storage_mb', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"storage_quota_mb":25600}'::jsonb),
    ('growth', 'document_uploads', 10000, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true}'::jsonb),
    ('growth', 'messages_monthly', 25000, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true}'::jsonb),
    ('growth', 'automation_runs_monthly', 5000, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true}'::jsonb),
    ('growth', 'ai_requests_monthly', 500, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true,"ai_launch_pending":true}'::jsonb),

    ('premium', 'students', 5000, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'courses', 150, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'cohorts', 150, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'batches', 150, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'admins', 15, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'staff_trainers', 75, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'team_members', 100, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'storage_mb', 102400, 'storage_mb', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"storage_quota_mb":102400,"premium_high_limit":true}'::jsonb),
    ('premium', 'document_uploads', 50000, 'count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'messages_monthly', 100000, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'automation_runs_monthly', 25000, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true,"premium_high_limit":true}'::jsonb),
    ('premium', 'ai_requests_monthly', 10000, 'monthly_count', 'hard', 80, true, '{"commercial_limits_aligned":true,"commercial_limits_module":"71.7R0A","commercial_limits_option":"option_b_balanced","public_launch_pending":true,"monthly_window_required":true,"ai_launch_pending":true,"premium_high_limit":true}'::jsonb)
),
resolved_limit_rows as (
  select
    sp.id as plan_id,
    alr.plan_code,
    alr.resource_key,
    alr.limit_value,
    alr.limit_type,
    alr.enforcement_mode,
    alr.warning_threshold_percent,
    alr.allow_platform_override,
    alr.metadata_json
  from approved_limit_rows alr
  join public.subscription_plans sp on sp.code = alr.plan_code
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
  plan_id,
  resource_key,
  limit_value,
  limit_type,
  enforcement_mode,
  warning_threshold_percent,
  allow_platform_override,
  metadata_json
from resolved_limit_rows
on conflict (plan_id, resource_key) do update
set
  limit_value = excluded.limit_value,
  limit_type = excluded.limit_type,
  enforcement_mode = excluded.enforcement_mode,
  warning_threshold_percent = coalesce(public.subscription_plan_usage_limits.warning_threshold_percent, excluded.warning_threshold_percent, 80),
  allow_platform_override = coalesce(public.subscription_plan_usage_limits.allow_platform_override, excluded.allow_platform_override, true),
  metadata_json = coalesce(public.subscription_plan_usage_limits.metadata_json, '{}'::jsonb)
    || excluded.metadata_json,
  updated_at = now();

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Verify all three plans have all 12 approved usage keys.
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
-- 2. Verify approved Option B values.
-- with expected(plan_code, resource_key, limit_value) as (
--   values
--     ('starter', 'students', 100),
--     ('starter', 'courses', 5),
--     ('starter', 'cohorts', 5),
--     ('starter', 'batches', 5),
--     ('starter', 'admins', 2),
--     ('starter', 'staff_trainers', 3),
--     ('starter', 'team_members', 5),
--     ('starter', 'storage_mb', 2048),
--     ('starter', 'document_uploads', 500),
--     ('starter', 'messages_monthly', 1000),
--     ('starter', 'automation_runs_monthly', 0),
--     ('starter', 'ai_requests_monthly', 0),
--     ('growth', 'students', 500),
--     ('growth', 'courses', 25),
--     ('growth', 'cohorts', 25),
--     ('growth', 'batches', 25),
--     ('growth', 'admins', 5),
--     ('growth', 'staff_trainers', 15),
--     ('growth', 'team_members', 20),
--     ('growth', 'storage_mb', 25600),
--     ('growth', 'document_uploads', 10000),
--     ('growth', 'messages_monthly', 25000),
--     ('growth', 'automation_runs_monthly', 5000),
--     ('growth', 'ai_requests_monthly', 500),
--     ('premium', 'students', 5000),
--     ('premium', 'courses', 150),
--     ('premium', 'cohorts', 150),
--     ('premium', 'batches', 150),
--     ('premium', 'admins', 15),
--     ('premium', 'staff_trainers', 75),
--     ('premium', 'team_members', 100),
--     ('premium', 'storage_mb', 102400),
--     ('premium', 'document_uploads', 50000),
--     ('premium', 'messages_monthly', 100000),
--     ('premium', 'automation_runs_monthly', 25000),
--     ('premium', 'ai_requests_monthly', 10000)
-- )
-- select e.plan_code, e.resource_key, e.limit_value as expected_limit, spl.limit_value as actual_limit
-- from expected e
-- join public.subscription_plans sp on sp.code = e.plan_code
-- join public.subscription_plan_usage_limits spl
--   on spl.plan_id = sp.id and spl.resource_key = e.resource_key
-- where spl.limit_value is distinct from e.limit_value
-- order by e.plan_code, e.resource_key;
-- -- Expected: zero rows.
--
-- 3. Verify public catalog remains empty.
-- select public.get_public_plan_catalog(null);
--
-- 4. Verify plans remain draft/private.
-- select code, status, is_public
-- from public.subscription_plans
-- where code in ('starter', 'growth', 'premium')
-- order by tier_rank;
--
-- 5. Verify price rows were not changed and checkout metadata remains disabled.
-- select
--   sp.code,
--   spp.currency,
--   spp.billing_cycle,
--   spp.amount_minor,
--   spp.status,
--   spp.metadata_json->>'placeholder_price' as placeholder_price,
--   spp.metadata_json->>'checkout_enabled' as checkout_enabled
-- from public.subscription_plans sp
-- join public.subscription_plan_prices spp on spp.plan_id = sp.id
-- where sp.code in ('starter', 'growth', 'premium')
-- order by sp.tier_rank, spp.currency, spp.billing_cycle;
--
-- 6. Verify payment_gateway/live_classes remain coming_soon in canonical entitlements.
-- select
--   sp.code,
--   spfe.feature_key,
--   spfe.entitlement_status,
--   spfe.requires_platform_approval
-- from public.subscription_plans sp
-- join public.subscription_plan_feature_entitlements spfe on spfe.plan_id = sp.id
-- where sp.code in ('starter', 'growth', 'premium')
--   and spfe.feature_key in ('payment_gateway', 'live_classes')
-- order by sp.tier_rank, spfe.feature_key;
--
-- 7. Verify regression tenant assignment remains unchanged.
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- 8. Verify existing Growth request remains approved/blocked.
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 9. Verify live entity usage counts still work.
-- select public.get_tenant_entity_usage_counts(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 10. Verify small canonical entity assertions still work for regression tenant.
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'students',
--   1,
--   false
-- );
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'courses',
--   1,
--   false
-- );
-- select public.assert_tenant_entity_usage_limit(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'team_members',
--   1,
--   true
-- );
--
-- 11. Verify document storage usage still reports the current quota.
-- select public.get_tenant_document_storage_usage(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 12. Verify tenant overrides were not removed or altered by this module.
-- select tenant_id, plan_id, feature_key, resource_key, override_type, override_value_json, expires_at
-- from public.tenant_subscription_overrides
-- where tenant_id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- order by created_at desc;
--
-- Rollback SQL for later review only:
-- -- Restore values from Module 71.7P2 if needed by rerunning the approved
-- -- Module 71.7P2 usage-limit section or a dedicated rollback patch. Do not
-- -- change plan visibility, prices, assignments, request options, or feature
-- -- entitlements during rollback without separate review.
