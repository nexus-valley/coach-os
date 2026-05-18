-- Module 27: Trainer assignment scoping
-- Run after Module 26 roles/permissions.

create table if not exists public.trainer_course_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trainer_user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, trainer_user_id, course_id)
);

create table if not exists public.trainer_cohort_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trainer_user_id uuid not null references auth.users(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, trainer_user_id, cohort_id)
);

create index if not exists trainer_course_assignments_tenant_idx
on public.trainer_course_assignments (tenant_id);

create index if not exists trainer_course_assignments_trainer_idx
on public.trainer_course_assignments (tenant_id, trainer_user_id);

create index if not exists trainer_course_assignments_course_idx
on public.trainer_course_assignments (tenant_id, course_id);

create index if not exists trainer_cohort_assignments_tenant_idx
on public.trainer_cohort_assignments (tenant_id);

create index if not exists trainer_cohort_assignments_trainer_idx
on public.trainer_cohort_assignments (tenant_id, trainer_user_id);

create index if not exists trainer_cohort_assignments_cohort_idx
on public.trainer_cohort_assignments (tenant_id, cohort_id);

alter table public.trainer_course_assignments enable row level security;
alter table public.trainer_cohort_assignments enable row level security;

grant select, insert, delete on public.trainer_course_assignments to authenticated;
grant select, insert, delete on public.trainer_cohort_assignments to authenticated;

drop policy if exists "Owner and admin full access trainer course assignments" on public.trainer_course_assignments;
create policy "Owner and admin full access trainer course assignments"
on public.trainer_course_assignments
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = trainer_course_assignments.tenant_id
      and tm.user_id = trainer_course_assignments.trainer_user_id
      and tm.role = 'trainer'
  )
);

drop policy if exists "Trainer can read own course assignments" on public.trainer_course_assignments;
create policy "Trainer can read own course assignments"
on public.trainer_course_assignments
for select
to authenticated
using (
  trainer_user_id = auth.uid()
  and public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
);

drop policy if exists "Owner and admin full access trainer cohort assignments" on public.trainer_cohort_assignments;
create policy "Owner and admin full access trainer cohort assignments"
on public.trainer_cohort_assignments
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = trainer_cohort_assignments.tenant_id
      and tm.user_id = trainer_cohort_assignments.trainer_user_id
      and tm.role = 'trainer'
  )
);

drop policy if exists "Trainer can read own cohort assignments" on public.trainer_cohort_assignments;
create policy "Trainer can read own cohort assignments"
on public.trainer_cohort_assignments
for select
to authenticated
using (
  trainer_user_id = auth.uid()
  and public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
);
