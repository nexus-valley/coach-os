create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  status text not null default 'not_started',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_id, course_id, lesson_id),
  check (status in ('not_started', 'in_progress', 'completed'))
);

create index if not exists lesson_progress_tenant_id_idx on public.lesson_progress (tenant_id);
create index if not exists lesson_progress_student_id_idx on public.lesson_progress (student_id);
create index if not exists lesson_progress_course_id_idx on public.lesson_progress (course_id);
create index if not exists lesson_progress_lesson_id_idx on public.lesson_progress (lesson_id);

drop trigger if exists set_lesson_progress_updated_at on public.lesson_progress;
create trigger set_lesson_progress_updated_at
before update on public.lesson_progress
for each row execute function public.set_updated_at();

alter table public.lesson_progress enable row level security;

grant select, insert, update, delete on public.lesson_progress to authenticated;

drop policy if exists "Tenant members can read lesson progress" on public.lesson_progress;
create policy "Tenant members can read lesson progress"
on public.lesson_progress
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create lesson progress" on public.lesson_progress;
create policy "Tenant members can create lesson progress"
on public.lesson_progress
for insert
to authenticated
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can update lesson progress" on public.lesson_progress;
create policy "Tenant members can update lesson progress"
on public.lesson_progress
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can delete lesson progress" on public.lesson_progress;
create policy "Tenant members can delete lesson progress"
on public.lesson_progress
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));