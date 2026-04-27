-- Module 9: Cohorts / batch management
-- Run this only if the cohorts and cohort_members tables do not already exist.

create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.cohort_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (tenant_id, cohort_id, student_id)
);

create index if not exists cohorts_tenant_id_idx on public.cohorts (tenant_id);
create index if not exists cohorts_course_id_idx on public.cohorts (course_id);
create index if not exists cohorts_start_date_idx on public.cohorts (start_date);
create index if not exists cohort_members_tenant_id_idx on public.cohort_members (tenant_id);
create index if not exists cohort_members_cohort_id_idx on public.cohort_members (cohort_id);
create index if not exists cohort_members_student_id_idx on public.cohort_members (student_id);

alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;

grant select, insert, update, delete on public.cohorts to authenticated;
grant select, insert, update, delete on public.cohort_members to authenticated;

drop policy if exists "Tenant members can read cohorts" on public.cohorts;
create policy "Tenant members can read cohorts"
on public.cohorts
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create cohorts" on public.cohorts;
create policy "Tenant members can create cohorts"
on public.cohorts
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and exists (
    select 1
    from public.courses c
    where c.id = course_id
      and c.tenant_id = tenant_id
  )
);

drop policy if exists "Tenant members can update cohorts" on public.cohorts;
create policy "Tenant members can update cohorts"
on public.cohorts
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and exists (
    select 1
    from public.courses c
    where c.id = course_id
      and c.tenant_id = tenant_id
  )
);

drop policy if exists "Tenant members can delete cohorts" on public.cohorts;
create policy "Tenant members can delete cohorts"
on public.cohorts
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can read cohort memberships" on public.cohort_members;
create policy "Tenant members can read cohort memberships"
on public.cohort_members
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create cohort memberships" on public.cohort_members;
create policy "Tenant members can create cohort memberships"
on public.cohort_members
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and exists (
    select 1
    from public.cohorts c
    where c.id = cohort_id
      and c.tenant_id = tenant_id
  )
  and exists (
    select 1
    from public.students s
    where s.id = student_id
      and s.tenant_id = tenant_id
  )
);

drop policy if exists "Tenant members can delete cohort memberships" on public.cohort_members;
create policy "Tenant members can delete cohort memberships"
on public.cohort_members
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));
