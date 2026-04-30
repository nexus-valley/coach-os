create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  amount numeric(10,2) not null,
  currency text not null default 'INR',
  provider text not null default 'manual',
  provider_link_id text,
  payment_url text,
  status text not null default 'created',
  description text,
  expires_at timestamptz,
  paid_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider in ('manual', 'razorpay')),
  check (status in ('created', 'sent', 'paid', 'expired', 'cancelled', 'failed'))
);

create index if not exists payment_links_tenant_id_idx on public.payment_links (tenant_id);
create index if not exists payment_links_student_id_idx on public.payment_links (student_id);
create index if not exists payment_links_status_idx on public.payment_links (status);
create index if not exists payment_links_created_at_idx on public.payment_links (created_at desc);

drop trigger if exists set_payment_links_updated_at on public.payment_links;
create trigger set_payment_links_updated_at
before update on public.payment_links
for each row execute function public.set_updated_at();

alter table public.payment_links enable row level security;

grant select, insert, update, delete on public.payment_links to authenticated;

drop policy if exists "Tenant members can read payment links" on public.payment_links;
create policy "Tenant members can read payment links"
on public.payment_links
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create payment links" on public.payment_links;
create policy "Tenant members can create payment links"
on public.payment_links
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and created_by = auth.uid()
);

drop policy if exists "Tenant members can update payment links" on public.payment_links;
create policy "Tenant members can update payment links"
on public.payment_links
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can delete payment links" on public.payment_links;
create policy "Tenant members can delete payment links"
on public.payment_links
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));