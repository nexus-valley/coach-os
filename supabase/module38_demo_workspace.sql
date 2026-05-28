-- Module 38: Demo workspace seeding and reset tracking
-- Additive only. Run after Module 36 chat/communication and Module 37 reports.

create table if not exists public.demo_seed_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  seed_batch_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists demo_seed_records_tenant_id_idx
on public.demo_seed_records (tenant_id);

create index if not exists demo_seed_records_seed_batch_id_idx
on public.demo_seed_records (tenant_id, seed_batch_id);

create index if not exists demo_seed_records_entity_type_idx
on public.demo_seed_records (tenant_id, entity_type);

create unique index if not exists demo_seed_records_entity_unique_idx
on public.demo_seed_records (tenant_id, entity_type, entity_id);

alter table public.demo_seed_records enable row level security;

grant select, insert, delete on public.demo_seed_records to authenticated;

drop policy if exists "Owner and admin can read demo seed records" on public.demo_seed_records;
create policy "Owner and admin can read demo seed records"
on public.demo_seed_records
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can create demo seed records" on public.demo_seed_records;
create policy "Owner and admin can create demo seed records"
on public.demo_seed_records
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and created_by = auth.uid()
);

drop policy if exists "Owner and admin can delete demo seed records" on public.demo_seed_records;
create policy "Owner and admin can delete demo seed records"
on public.demo_seed_records
for delete
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));
