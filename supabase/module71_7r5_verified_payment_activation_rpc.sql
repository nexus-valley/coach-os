-- Module 71.7R5: Verified Payment Activation RPC SQL Proposal
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Add a service-only, idempotent activation RPC that converts an already
--   verified Razorpay paid/captured internal order into a canonical tenant
--   subscription assignment.
-- - Activation is based on database-persisted verified payment state only.
-- - Browser checkout success is not an activation source.
-- - R5 does not wire the webhook route, create checkout UI, make plans public,
--   unlock payment gateway/live classes, or change plan catalog data.

begin;

create or replace function public.activate_tenant_plan_after_verified_payment(
  p_payment_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.tenant_payment_orders%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_price public.subscription_plan_prices%rowtype;
  v_webhook public.razorpay_webhook_events%rowtype;
  v_attempt public.tenant_payment_attempts%rowtype;
  v_activation public.tenant_plan_activation_events%rowtype;
  v_current_assignment public.tenant_subscription_assignments%rowtype;
  v_has_current_assignment boolean := false;
  v_activation_event_id uuid;
  v_new_assignment_id uuid;
  v_previous_assignment_id uuid;
  v_idempotency_key text;
  v_provider_payment_id text;
  v_now timestamptz := now();
  v_period_end timestamptz;
  v_error_message text;
begin
  if p_payment_order_id is null then
    raise exception 'Payment order id is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('r5_verified_payment_activation:' || p_payment_order_id::text, 7175));

  v_idempotency_key := 'razorpay_payment_order:' || p_payment_order_id::text;

  select *
  into v_order
  from public.tenant_payment_orders
  where id = p_payment_order_id
  for update;

  if not found then
    raise exception 'Payment order not found.' using errcode = '22023';
  end if;

  select *
  into v_activation
  from public.tenant_plan_activation_events
  where payment_order_id = p_payment_order_id
     or idempotency_key = v_idempotency_key
  order by created_at asc
  limit 1
  for update;

  if found then
    if v_activation.activation_status in ('activated', 'skipped_already_active') then
      if v_order.internal_status <> 'activated' then
        update public.tenant_payment_orders
        set internal_status = 'activated',
            metadata_json = coalesce(metadata_json, '{}'::jsonb)
              || jsonb_build_object(
                'activation_enabled', true,
                'activation_module', '71.7R5',
                'activation_event_id', v_activation.id,
                'assignment_id', v_activation.new_assignment_id,
                'activated_at', coalesce(v_activation.activated_at, v_now),
                'browser_success_not_activation', true,
                'idempotent_reconciled', true
              ),
            updated_at = now()
        where id = v_order.id;
      end if;

      return jsonb_build_object(
        'activated', v_activation.activation_status = 'activated',
        'idempotent', true,
        'activation_status', v_activation.activation_status,
        'tenant_id', v_activation.tenant_id,
        'plan_code', v_order.plan_code,
        'payment_order_id', v_order.id,
        'assignment_id', v_activation.new_assignment_id,
        'activation_event_id', v_activation.id
      );
    end if;

    if v_activation.activation_status = 'failed' and v_activation.new_assignment_id is not null then
      raise exception 'Previous activation attempt failed after assignment linkage; manual review is required.'
        using errcode = '22023';
    end if;
  end if;

  if v_order.provider <> 'razorpay' then
    raise exception 'Payment order provider is not eligible for activation.' using errcode = '22023';
  end if;

  if v_order.provider_mode <> 'test' then
    raise exception 'R5 activation is restricted to Razorpay test mode.' using errcode = '22023';
  end if;

  if v_order.provider_order_id is null then
    raise exception 'Payment order is missing provider order id.' using errcode = '22023';
  end if;

  if v_order.checkout_enabled_source <> 'regression_test_gate' then
    raise exception 'Payment order is not from the R3 regression test gate.' using errcode = '22023';
  end if;

  if coalesce(v_order.metadata_json->>'test_tenant_allowlisted', 'false') <> 'true'
     or coalesce(v_order.metadata_json->>'browser_success_not_activation', 'false') <> 'true' then
    raise exception 'Payment order is missing required R3 regression safety metadata.' using errcode = '22023';
  end if;

  if v_order.internal_status not in ('payment_captured', 'order_paid') then
    raise exception 'Payment order is not in a verified paid/captured state.' using errcode = '22023';
  end if;

  if v_order.total_amount_minor <= 0 then
    raise exception 'Payment order total amount must be greater than zero.' using errcode = '22023';
  end if;

  if v_order.currency <> 'INR' then
    raise exception 'Only INR payment orders are eligible for activation.' using errcode = '22023';
  end if;

  if v_order.plan_code not in ('starter', 'growth') then
    raise exception 'Only Starter and Growth orders are eligible for automatic activation.' using errcode = '22023';
  end if;

  if v_order.billing_cycle not in ('monthly', 'yearly') then
    raise exception 'Only monthly/yearly billing cycles are eligible for automatic activation.' using errcode = '22023';
  end if;

  if v_order.amount_minor + v_order.setup_fee_amount_minor + coalesce(v_order.tax_amount_minor, 0) <> v_order.total_amount_minor then
    raise exception 'Payment order amount components do not match total amount.' using errcode = '22023';
  end if;

  select *
  into v_plan
  from public.subscription_plans
  where id = v_order.plan_id
  for share;

  if not found then
    raise exception 'Subscription plan not found.' using errcode = '22023';
  end if;

  if v_plan.code <> v_order.plan_code then
    raise exception 'Payment order plan code does not match canonical plan.' using errcode = '22023';
  end if;

  if v_plan.status <> 'draft' or v_plan.is_public then
    raise exception 'R5 test activation requires plan to remain draft/private.' using errcode = '22023';
  end if;

  select *
  into v_price
  from public.subscription_plan_prices
  where id = v_order.price_id
  for share;

  if not found then
    raise exception 'Subscription price not found.' using errcode = '22023';
  end if;

  if v_price.plan_id <> v_order.plan_id
     or v_price.currency <> 'INR'
     or v_price.billing_cycle <> v_order.billing_cycle
     or v_price.region_code <> 'GLOBAL'
     or v_price.status <> 'draft'
     or v_price.amount_minor <> v_order.amount_minor
     or v_price.setup_fee_amount_minor <> v_order.setup_fee_amount_minor then
    raise exception 'Payment order price does not match canonical draft INR price.' using errcode = '22023';
  end if;

  if coalesce(v_price.metadata_json->>'pricing_finalized', 'false') <> 'true'
     or coalesce(v_price.metadata_json->>'pricing_finalized_module', '') <> '71.7R0B'
     or coalesce(v_price.metadata_json->>'checkout_enabled', 'true') <> 'false' then
    raise exception 'Subscription price metadata is not eligible for R5 activation.' using errcode = '22023';
  end if;

  select *
  into v_webhook
  from public.razorpay_webhook_events
  where provider = 'razorpay'
    and provider_mode = 'test'
    and signature_valid = true
    and processing_status = 'processed'
    and event_type in ('payment.captured', 'order.paid')
    and related_provider_order_id = v_order.provider_order_id
  order by processed_at desc nulls last, received_at desc
  limit 1;

  if not found then
    raise exception 'Verified processed payment webhook evidence is required before activation.' using errcode = '22023';
  end if;

  select *
  into v_attempt
  from public.tenant_payment_attempts
  where provider = 'razorpay'
    and provider_mode = 'test'
    and provider_order_id = v_order.provider_order_id
    and payment_order_id = v_order.id
    and signature_valid = true
    and internal_status = 'captured'
    and amount_minor = v_order.total_amount_minor
    and currency = v_order.currency
  order by captured_at desc nulls last, created_at desc
  limit 1;

  v_provider_payment_id := coalesce(v_attempt.provider_payment_id, v_webhook.related_provider_payment_id);

  if v_activation.id is null then
    insert into public.tenant_plan_activation_events (
      tenant_id,
      payment_order_id,
      plan_id,
      price_id,
      activation_status,
      idempotency_key,
      activation_source,
      provider,
      provider_order_id,
      provider_payment_id,
      metadata_json
    )
    values (
      v_order.tenant_id,
      v_order.id,
      v_order.plan_id,
      v_order.price_id,
      'pending',
      v_idempotency_key,
      'verified_payment',
      'razorpay',
      v_order.provider_order_id,
      v_provider_payment_id,
      jsonb_build_object(
        'module', '71.7R5',
        'provider_mode', v_order.provider_mode,
        'payment_order_status', v_order.internal_status,
        'webhook_event_id', v_webhook.id,
        'webhook_event_type', v_webhook.event_type,
        'captured_attempt_id', v_attempt.id,
        'browser_success_not_activation', true
      )
    )
    returning * into v_activation;
  else
    update public.tenant_plan_activation_events
    set activation_status = 'pending',
        failed_at = null,
        error_message = null,
        provider_order_id = v_order.provider_order_id,
        provider_payment_id = v_provider_payment_id,
        metadata_json = coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'module', '71.7R5',
            'provider_mode', v_order.provider_mode,
            'payment_order_status', v_order.internal_status,
            'webhook_event_id', v_webhook.id,
            'webhook_event_type', v_webhook.event_type,
            'captured_attempt_id', v_attempt.id,
            'retry_after_failed_or_pending', true,
            'browser_success_not_activation', true
          )
    where id = v_activation.id
    returning * into v_activation;
  end if;

  v_activation_event_id := v_activation.id;

  begin
    select *
    into v_current_assignment
    from public.tenant_subscription_assignments
    where tenant_id = v_order.tenant_id
      and is_current
    for update;

    v_has_current_assignment := found;
    v_previous_assignment_id := case when v_has_current_assignment then v_current_assignment.id else null end;

    if v_order.billing_cycle = 'monthly' then
      v_period_end := v_now + interval '1 month';
    elsif v_order.billing_cycle = 'yearly' then
      v_period_end := v_now + interval '1 year';
    else
      raise exception 'Unsupported billing cycle for activation.' using errcode = '22023';
    end if;

    if v_has_current_assignment
       and v_current_assignment.plan_id = v_order.plan_id
       and v_current_assignment.billing_cycle = v_order.billing_cycle
       and v_current_assignment.currency = v_order.currency
       and v_current_assignment.payment_status = 'paid'
       and coalesce(v_current_assignment.metadata_json->>'price_id', '') = v_order.price_id::text then
      v_new_assignment_id := v_current_assignment.id;

      update public.tenant_plan_activation_events
      set previous_assignment_id = v_previous_assignment_id,
          new_assignment_id = v_new_assignment_id,
          activation_status = 'skipped_already_active',
          activated_at = v_now,
          failed_at = null,
          error_message = null,
          provider_payment_id = v_provider_payment_id,
          metadata_json = coalesce(metadata_json, '{}'::jsonb)
            || jsonb_build_object(
              'module', '71.7R5',
              'skip_reason', 'same_plan_price_billing_cycle_already_current',
              'payment_order_status', v_order.internal_status,
              'browser_success_not_activation', true
            )
      where id = v_activation_event_id;

      update public.tenant_payment_orders
      set internal_status = 'activated',
          metadata_json = coalesce(metadata_json, '{}'::jsonb)
            || jsonb_build_object(
              'activation_enabled', true,
              'activation_module', '71.7R5',
              'activation_event_id', v_activation_event_id,
              'assignment_id', v_new_assignment_id,
              'activated_at', v_now,
              'browser_success_not_activation', true,
              'activation_result', 'skipped_already_active'
            ),
          updated_at = now()
      where id = v_order.id;

      return jsonb_build_object(
        'activated', false,
        'idempotent', false,
        'activation_status', 'skipped_already_active',
        'tenant_id', v_order.tenant_id,
        'plan_code', v_order.plan_code,
        'payment_order_id', v_order.id,
        'assignment_id', v_new_assignment_id,
        'activation_event_id', v_activation_event_id
      );
    end if;

    if v_has_current_assignment then
      update public.tenant_subscription_assignments
      set is_current = false,
          metadata_json = coalesce(metadata_json, '{}'::jsonb)
            || jsonb_build_object(
              'superseded_by_payment_order_id', v_order.id,
              'superseded_by_activation_event_id', v_activation_event_id,
              'superseded_at', v_now
            ),
          updated_at = now()
      where id = v_current_assignment.id;
    end if;

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
      payment_status,
      source,
      is_current,
      metadata_json,
      created_by,
      updated_by
    )
    values (
      v_order.tenant_id,
      v_order.plan_id,
      'active',
      v_order.billing_cycle,
      v_order.currency,
      null,
      null,
      v_now,
      v_period_end,
      'paid',
      'checkout',
      true,
      jsonb_build_object(
        'module', '71.7R5',
        'payment_provider', 'razorpay',
        'provider_mode', v_order.provider_mode,
        'provider_order_id', v_order.provider_order_id,
        'provider_payment_id', v_provider_payment_id,
        'payment_order_id', v_order.id,
        'activation_event_id', v_activation_event_id,
        'price_id', v_order.price_id,
        'amount_minor', v_order.amount_minor,
        'setup_fee_amount_minor', v_order.setup_fee_amount_minor,
        'tax_amount_minor', v_order.tax_amount_minor,
        'total_amount_minor', v_order.total_amount_minor,
        'browser_success_not_activation', true
      ),
      v_order.created_by,
      v_order.created_by
    )
    returning id into v_new_assignment_id;

    update public.tenant_plan_activation_events
    set previous_assignment_id = v_previous_assignment_id,
        new_assignment_id = v_new_assignment_id,
        activation_status = 'activated',
        activated_at = v_now,
        failed_at = null,
        error_message = null,
        provider_payment_id = v_provider_payment_id,
        metadata_json = coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'module', '71.7R5',
            'provider_mode', v_order.provider_mode,
            'payment_order_status', v_order.internal_status,
            'webhook_event_id', v_webhook.id,
            'webhook_event_type', v_webhook.event_type,
            'captured_attempt_id', v_attempt.id,
            'assignment_status', 'active',
            'payment_status', 'paid',
            'browser_success_not_activation', true
          )
    where id = v_activation_event_id;

    update public.tenant_payment_orders
    set internal_status = 'activated',
        metadata_json = coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'activation_enabled', true,
            'activation_module', '71.7R5',
            'activation_event_id', v_activation_event_id,
            'assignment_id', v_new_assignment_id,
            'activated_at', v_now,
            'browser_success_not_activation', true,
            'activation_result', 'activated'
          ),
        updated_at = now()
    where id = v_order.id;

    return jsonb_build_object(
      'activated', true,
      'idempotent', false,
      'activation_status', 'activated',
      'tenant_id', v_order.tenant_id,
      'plan_code', v_order.plan_code,
      'payment_order_id', v_order.id,
      'assignment_id', v_new_assignment_id,
      'activation_event_id', v_activation_event_id
    );
  exception
    when others then
      v_error_message := left(replace(replace(sqlerrm, '<', ''), '>', ''), 1200);

      update public.tenant_plan_activation_events
      set activation_status = 'failed',
          failed_at = now(),
          error_message = v_error_message,
          metadata_json = coalesce(metadata_json, '{}'::jsonb)
            || jsonb_build_object(
              'module', '71.7R5',
              'failure_stage', 'assignment_activation',
              'browser_success_not_activation', true
            )
      where id = v_activation_event_id;

      return jsonb_build_object(
        'activated', false,
        'idempotent', false,
        'activation_status', 'failed',
        'tenant_id', v_order.tenant_id,
        'plan_code', v_order.plan_code,
        'payment_order_id', v_order.id,
        'assignment_id', null,
        'activation_event_id', v_activation_event_id,
        'error_message', v_error_message
      );
  end;
end;
$$;

comment on function public.activate_tenant_plan_after_verified_payment(uuid) is
  'Service-only R5 RPC. Activates a canonical tenant subscription assignment only from verified Razorpay paid/captured database state. Browser checkout success is not an activation source.';

revoke all on function public.activate_tenant_plan_after_verified_payment(uuid) from public, anon, authenticated;
grant execute on function public.activate_tenant_plan_after_verified_payment(uuid) to service_role;

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Confirm RPC exists:
-- select routine_schema, routine_name, security_type
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name = 'activate_tenant_plan_after_verified_payment';
--
-- 2. Confirm execute grants are not open to PUBLIC/anon/authenticated:
-- select grantee, routine_name, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name = 'activate_tenant_plan_after_verified_payment'
-- order by grantee;
-- -- Expected: service_role only, no PUBLIC/anon/authenticated.
--
-- 3. Confirm SQL execution alone did not create activation events:
-- select count(*) as activation_event_count
-- from public.tenant_plan_activation_events;
--
-- 4. Confirm no tenant assignments changed by SQL execution:
-- select tenant_id, count(*) as assignment_count
-- from public.tenant_subscription_assignments
-- group by tenant_id
-- order by tenant_id;
--
-- 5. Confirm public catalog remains empty:
-- select public.get_public_plan_catalog();
--
-- 6. Confirm plans remain draft/private:
-- select code, status, is_public
-- from public.subscription_plans
-- where code in ('starter', 'growth', 'premium')
-- order by code;
--
-- 7. Confirm checkout metadata remains false on finalized INR prices:
-- select
--   sp.code,
--   spp.billing_cycle,
--   spp.currency,
--   spp.amount_minor,
--   spp.status,
--   spp.metadata_json->>'checkout_enabled' as checkout_enabled,
--   spp.metadata_json->>'pricing_finalized_module' as pricing_finalized_module
-- from public.subscription_plan_prices spp
-- join public.subscription_plans sp on sp.id = spp.plan_id
-- where sp.code in ('starter', 'growth', 'premium')
--   and spp.currency = 'INR'
-- order by sp.code, spp.billing_cycle;
--
-- 8. Confirm payment_gateway/live_classes remain globally coming soon:
-- select public.resolve_effective_feature_access(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'payment_gateway'
-- );
-- select public.resolve_effective_feature_access(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'live_classes'
-- );
--
-- 9. Confirm regression tenant assignment unchanged before any paid smoke:
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- 10. Confirm existing Growth request remains approved/blocked:
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 11. Confirm no request options changed:
-- select *
-- from public.subscription_plan_request_options
-- order by plan_code, display_order;
--
-- 12. Optional negative RPC check only after approval:
-- -- select public.activate_tenant_plan_after_verified_payment(gen_random_uuid());
-- -- Expected: fails safely with "Payment order not found." and no assignment changes.
--
-- Rollback SQL for later review only:
-- begin;
-- revoke all on function public.activate_tenant_plan_after_verified_payment(uuid) from public, anon, authenticated, service_role;
-- drop function if exists public.activate_tenant_plan_after_verified_payment(uuid);
-- commit;
