-- Module 30: Billing and subscription foundation
-- Additive only. No live payment gateways, webhooks, or auto-renewal logic.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_code text not null,
  status text not null default 'trialing',
  billing_cycle text not null default 'monthly',
  amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  started_at timestamptz not null default now(),
  renewal_at timestamptz,
  canceled_at timestamptz,
  grace_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  check (billing_cycle in ('monthly', 'yearly')),
  check (amount >= 0)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  invoice_number text not null unique,
  status text not null default 'draft',
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  billing_name text,
  billing_email text,
  billing_address text,
  gst_number text,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (status in ('draft', 'issued', 'paid', 'overdue', 'void')),
  check (subtotal >= 0),
  check (tax_amount >= 0),
  check (total_amount >= 0)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  tax_percent numeric(5,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  check (quantity > 0),
  check (unit_price >= 0),
  check (tax_percent >= 0),
  check (line_total >= 0)
);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  provider text not null default 'manual',
  provider_transaction_id text,
  status text not null default 'pending',
  amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (provider in ('razorpay', 'stripe', 'manual')),
  check (status in ('pending', 'success', 'failed', 'refunded')),
  check (amount >= 0)
);

create index if not exists subscriptions_tenant_status_idx
on public.subscriptions (tenant_id, status);

create index if not exists subscriptions_tenant_renewal_idx
on public.subscriptions (tenant_id, renewal_at);

create index if not exists invoices_tenant_created_idx
on public.invoices (tenant_id, created_at desc);

create index if not exists invoices_tenant_status_idx
on public.invoices (tenant_id, status);

create index if not exists invoices_subscription_idx
on public.invoices (subscription_id);

create index if not exists invoice_items_invoice_idx
on public.invoice_items (invoice_id);

create index if not exists payment_transactions_tenant_created_idx
on public.payment_transactions (tenant_id, created_at desc);

create index if not exists payment_transactions_invoice_idx
on public.payment_transactions (invoice_id);

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

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payment_transactions enable row level security;

grant select, insert, update on public.subscriptions to authenticated;
grant select, insert, update on public.invoices to authenticated;
grant select, insert on public.invoice_items to authenticated;
grant select, insert, update on public.payment_transactions to authenticated;

drop policy if exists "Owner and admin can read subscriptions" on public.subscriptions;
create policy "Owner and admin can read subscriptions"
on public.subscriptions
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can create subscriptions" on public.subscriptions;
create policy "Owner and admin can create subscriptions"
on public.subscriptions
for insert
to authenticated
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can update subscriptions" on public.subscriptions;
create policy "Owner and admin can update subscriptions"
on public.subscriptions
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can read invoices" on public.invoices;
create policy "Owner and admin can read invoices"
on public.invoices
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can create invoices" on public.invoices;
create policy "Owner and admin can create invoices"
on public.invoices
for insert
to authenticated
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can update invoices" on public.invoices;
create policy "Owner and admin can update invoices"
on public.invoices
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can read invoice items" on public.invoice_items;
create policy "Owner and admin can read invoice items"
on public.invoice_items
for select
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    where i.id = invoice_items.invoice_id
      and public.has_tenant_role(i.tenant_id, auth.uid(), array['owner', 'admin'])
  )
);

drop policy if exists "Owner and admin can create invoice items" on public.invoice_items;
create policy "Owner and admin can create invoice items"
on public.invoice_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.invoices i
    where i.id = invoice_items.invoice_id
      and public.has_tenant_role(i.tenant_id, auth.uid(), array['owner', 'admin'])
  )
);

drop policy if exists "Owner and admin can read payment transactions" on public.payment_transactions;
create policy "Owner and admin can read payment transactions"
on public.payment_transactions
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can create payment transactions" on public.payment_transactions;
create policy "Owner and admin can create payment transactions"
on public.payment_transactions
for insert
to authenticated
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can update payment transactions" on public.payment_transactions;
create policy "Owner and admin can update payment transactions"
on public.payment_transactions
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));
