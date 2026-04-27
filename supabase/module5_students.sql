create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  status text not null default 'active',
  source text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('active', 'inactive', 'lead', 'blocked'))
);

create index if not exists students_tenant_id_idx on public.students (tenant_id);
create index if not exists students_email_idx on public.students (email);
create index if not exists students_phone_idx on public.students (phone);
create index if not exists students_status_idx on public.students (status);

drop trigger if exists set_students_updated_at on public.students;
create trigger set_students_updated_at
before update on public.students
for each row execute function public.set_updated_at();

alter table public.students enable row level security;

grant select, insert, update, delete on public.students to authenticated;

drop policy if exists "Tenant members can read students" on public.students;
create policy "Tenant members can read students"
on public.students
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create students" on public.students;
create policy "Tenant members can create students"
on public.students
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and created_by = auth.uid()
);

drop policy if exists "Tenant members can update students" on public.students;
create policy "Tenant members can update students"
on public.students
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can delete students" on public.students;
create policy "Tenant members can delete students"
on public.students
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));