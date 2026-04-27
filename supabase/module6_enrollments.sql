create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'active',
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_id, course_id),
  check (status in ('active', 'completed', 'paused', 'cancelled'))
);

create index if not exists enrollments_tenant_id_idx on public.enrollments (tenant_id);
create index if not exists enrollments_student_id_idx on public.enrollments (student_id);
create index if not exists enrollments_course_id_idx on public.enrollments (course_id);
create index if not exists enrollments_status_idx on public.enrollments (status);

drop trigger if exists set_enrollments_updated_at on public.enrollments;
create trigger set_enrollments_updated_at
before update on public.enrollments
for each row execute function public.set_updated_at();

alter table public.enrollments enable row level security;

grant select, insert, update, delete on public.enrollments to authenticated;

drop policy if exists "Tenant members can read enrollments" on public.enrollments;
create policy "Tenant members can read enrollments"
on public.enrollments
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create enrollments" on public.enrollments;
create policy "Tenant members can create enrollments"
on public.enrollments
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and created_by = auth.uid()
);

drop policy if exists "Tenant members can update enrollments" on public.enrollments;
create policy "Tenant members can update enrollments"
on public.enrollments
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can delete enrollments" on public.enrollments;
create policy "Tenant members can delete enrollments"
on public.enrollments
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));