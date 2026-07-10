-- Module 71.7R0B: Final INR Pricing SQL Proposal
--
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Set final draft/private INR prices for Starter and Growth.
-- - Keep Premium as contact-sales with suggested starting-price metadata only.
-- - Keep checkout disabled and public catalog hidden until Razorpay test-mode
--   flow is integrated and approved.
--
-- Non-goals:
-- - Does not update subscription_plans.status or subscription_plans.is_public.
-- - Does not update subscription_plan_usage_limits.
-- - Does not update subscription_plan_feature_entitlements.
-- - Does not update tenant_subscription_assignments.
-- - Does not update subscription_plan_request_options.
-- - Does not update USD/EUR price rows.
-- - Does not activate checkout or payment gateway behavior.
-- - Does not change Module 62, FeatureGate, or legacy Module 56 behavior.

begin;

with approved_price_rows (
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
      149900,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"placeholder_price":false,"pricing_finalized":true,"pricing_finalized_module":"71.7R0B","pricing_option":"balanced_launch_v1","public_launch_pending":true,"checkout_enabled":false,"payment_gateway_called":false,"tax_mode":"gst_exclusive_gateway_or_invoice_pending","currency_market":"IN","billing_display":"monthly"}'::jsonb
    ),
    (
      'starter',
      'INR',
      'yearly',
      1499000,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"placeholder_price":false,"pricing_finalized":true,"pricing_finalized_module":"71.7R0B","pricing_option":"balanced_launch_v1","public_launch_pending":true,"checkout_enabled":false,"payment_gateway_called":false,"tax_mode":"gst_exclusive_gateway_or_invoice_pending","currency_market":"IN","billing_display":"yearly","yearly_discount_note":"approximately_two_months_free"}'::jsonb
    ),
    (
      'growth',
      'INR',
      'monthly',
      599900,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"placeholder_price":false,"pricing_finalized":true,"pricing_finalized_module":"71.7R0B","pricing_option":"balanced_launch_v1","public_launch_pending":true,"checkout_enabled":false,"payment_gateway_called":false,"tax_mode":"gst_exclusive_gateway_or_invoice_pending","currency_market":"IN","billing_display":"monthly"}'::jsonb
    ),
    (
      'growth',
      'INR',
      'yearly',
      5999000,
      0,
      'exclusive',
      'GLOBAL',
      'draft',
      '{"placeholder_price":false,"pricing_finalized":true,"pricing_finalized_module":"71.7R0B","pricing_option":"balanced_launch_v1","public_launch_pending":true,"checkout_enabled":false,"payment_gateway_called":false,"tax_mode":"gst_exclusive_gateway_or_invoice_pending","currency_market":"IN","billing_display":"yearly","yearly_discount_note":"approximately_two_months_free"}'::jsonb
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
      '{"placeholder_price":false,"pricing_finalized":true,"pricing_finalized_module":"71.7R0B","pricing_option":"balanced_launch_v1","public_launch_pending":true,"checkout_enabled":false,"payment_gateway_called":false,"tax_mode":"gst_exclusive_gateway_or_invoice_pending","currency_market":"IN","billing_display":"contact_sales","commercial_model":"contact_sales","contact_sales":true,"suggested_starting_price_minor":1499900,"suggested_starting_price_label":"Starts from ₹14,999/month equivalent"}'::jsonb
    )
),
resolved_price_rows as (
  select
    sp.id as plan_id,
    apr.plan_code,
    apr.currency,
    apr.billing_cycle,
    apr.amount_minor,
    apr.setup_fee_amount_minor,
    apr.tax_behavior,
    apr.region_code,
    apr.status,
    apr.metadata_json
  from approved_price_rows apr
  join public.subscription_plans sp on sp.code = apr.plan_code
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
  plan_id,
  currency,
  billing_cycle,
  amount_minor,
  setup_fee_amount_minor,
  tax_behavior,
  region_code,
  status,
  metadata_json
from resolved_price_rows
on conflict (plan_id, currency, billing_cycle, region_code, status) do update
set
  amount_minor = excluded.amount_minor,
  setup_fee_amount_minor = excluded.setup_fee_amount_minor,
  tax_behavior = excluded.tax_behavior,
  metadata_json = coalesce(public.subscription_plan_prices.metadata_json, '{}'::jsonb)
    || excluded.metadata_json,
  updated_at = now();

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Verify Starter/Growth final INR monthly/yearly prices.
-- with expected(plan_code, billing_cycle, amount_minor) as (
--   values
--     ('starter', 'monthly', 149900::bigint),
--     ('starter', 'yearly', 1499000::bigint),
--     ('growth', 'monthly', 599900::bigint),
--     ('growth', 'yearly', 5999000::bigint)
-- )
-- select
--   e.plan_code,
--   e.billing_cycle,
--   e.amount_minor as expected_amount_minor,
--   spp.amount_minor as actual_amount_minor,
--   spp.currency,
--   spp.status,
--   spp.tax_behavior,
--   spp.region_code
-- from expected e
-- join public.subscription_plans sp on sp.code = e.plan_code
-- join public.subscription_plan_prices spp
--   on spp.plan_id = sp.id
--  and spp.currency = 'INR'
--  and spp.billing_cycle = e.billing_cycle
--  and spp.region_code = 'GLOBAL'
--  and spp.status = 'draft'
-- where spp.amount_minor is distinct from e.amount_minor
-- order by e.plan_code, e.billing_cycle;
-- -- Expected: zero rows.
--
-- 2. Verify Premium remains contact-sales/custom with suggested metadata.
-- select
--   sp.code,
--   spp.currency,
--   spp.billing_cycle,
--   spp.amount_minor,
--   spp.setup_fee_amount_minor,
--   spp.status,
--   spp.metadata_json->>'commercial_model' as commercial_model,
--   spp.metadata_json->>'contact_sales' as contact_sales,
--   spp.metadata_json->>'checkout_enabled' as checkout_enabled,
--   spp.metadata_json->>'suggested_starting_price_minor' as suggested_starting_price_minor,
--   spp.metadata_json->>'suggested_starting_price_label' as suggested_starting_price_label
-- from public.subscription_plans sp
-- join public.subscription_plan_prices spp on spp.plan_id = sp.id
-- where sp.code = 'premium'
--   and spp.currency = 'INR'
--   and spp.billing_cycle = 'custom'
--   and spp.region_code = 'GLOBAL'
--   and spp.status = 'draft';
-- -- Expected: amount_minor=0, checkout_enabled=false, contact_sales=true.
--
-- 3. Verify all updated INR price rows remain draft and checkout disabled.
-- select
--   sp.code,
--   spp.currency,
--   spp.billing_cycle,
--   spp.amount_minor,
--   spp.status,
--   spp.metadata_json->>'placeholder_price' as placeholder_price,
--   spp.metadata_json->>'pricing_finalized' as pricing_finalized,
--   spp.metadata_json->>'pricing_finalized_module' as pricing_finalized_module,
--   spp.metadata_json->>'checkout_enabled' as checkout_enabled,
--   spp.metadata_json->>'payment_gateway_called' as payment_gateway_called,
--   spp.metadata_json->>'tax_mode' as tax_mode
-- from public.subscription_plans sp
-- join public.subscription_plan_prices spp on spp.plan_id = sp.id
-- where sp.code in ('starter', 'growth', 'premium')
--   and spp.currency = 'INR'
--   and spp.region_code = 'GLOBAL'
--   and (
--     (sp.code in ('starter', 'growth') and spp.billing_cycle in ('monthly', 'yearly'))
--     or (sp.code = 'premium' and spp.billing_cycle = 'custom')
--   )
-- order by sp.tier_rank, spp.billing_cycle;
--
-- 4. Verify USD/EUR rows, if present, were not targeted by this module.
-- select
--   sp.code,
--   spp.currency,
--   spp.billing_cycle,
--   spp.amount_minor,
--   spp.status,
--   spp.metadata_json
-- from public.subscription_plans sp
-- join public.subscription_plan_prices spp on spp.plan_id = sp.id
-- where sp.code in ('starter', 'growth', 'premium')
--   and spp.currency in ('USD', 'EUR')
-- order by sp.tier_rank, spp.currency, spp.billing_cycle;
--
-- 5. Verify public catalog remains empty.
-- select public.get_public_plan_catalog(null);
--
-- 6. Verify plans remain draft/private.
-- select code, status, is_public
-- from public.subscription_plans
-- where code in ('starter', 'growth', 'premium')
-- order by tier_rank;
--
-- 7. Verify plan limits remain approved Option B from R0A.
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
-- 8. Verify payment_gateway/live_classes remain coming_soon in canonical entitlements.
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
-- 9. Verify regression tenant assignment remains unchanged.
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- 10. Verify existing Growth request remains approved/blocked.
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 11. Verify request options were not changed by this module.
-- select
--   spro.id,
--   sp.code as plan_code,
--   spro.status,
--   spro.tenant_scope,
--   spro.display_order
-- from public.subscription_plan_request_options spro
-- join public.subscription_plans sp on sp.id = spro.plan_id
-- order by spro.created_at;
--
-- Rollback SQL for later review only:
-- -- Restore Module 71.7P2 placeholder price rows if needed by rerunning the
-- -- approved Module 71.7P2 price section or a dedicated rollback patch. Do not
-- -- change plan visibility, limits, features, assignments, request options, or
-- -- checkout/payment gateway behavior during rollback without separate review.
