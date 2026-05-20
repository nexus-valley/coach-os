-- Module 30.1: Billing validation fixes
-- Run after supabase/module30_billing_foundation.sql.

-- Make the existing-tenant subscription seed idempotent even after RLS has
-- already been enabled by the Module 30 migration. This avoids rerun failures
-- without weakening runtime RLS policies for authenticated users.

create or replace function public.seed_foundation_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.subscriptions (
    tenant_id,
    plan_code,
    status,
    billing_cycle,
    amount,
    currency,
    started_at,
    renewal_at
  )
  select
    t.id,
    coalesce(t.plan, 'free'),
    case
      when t.subscription_status = 'cancelled' then 'canceled'
      when t.subscription_status = 'past_due' then 'past_due'
      else 'trialing'
    end,
    'monthly',
    0,
    'INR',
    coalesce(t.plan_started_at, now()),
    t.plan_renews_at
  from public.tenants t
  where not exists (
    select 1
    from public.subscriptions s
    where s.tenant_id = t.id
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke execute on function public.seed_foundation_subscriptions() from public;
grant execute on function public.seed_foundation_subscriptions() to authenticated;

select public.seed_foundation_subscriptions();
