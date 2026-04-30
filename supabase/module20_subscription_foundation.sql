alter table public.tenants
add column if not exists plan text not null default 'free',
add column if not exists subscription_status text not null default 'active',
add column if not exists plan_started_at timestamptz default now(),
add column if not exists plan_renews_at timestamptz;

alter table public.tenants
drop constraint if exists tenants_plan_check;

alter table public.tenants
add constraint tenants_plan_check
check (plan in ('free', 'starter', 'pro', 'business'));

alter table public.tenants
drop constraint if exists tenants_subscription_status_check;

alter table public.tenants
add constraint tenants_subscription_status_check
check (subscription_status in ('active', 'trialing', 'past_due', 'cancelled'));