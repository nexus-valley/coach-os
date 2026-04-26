create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  slug text not null,
  description text,
  status text not null default 'draft',
  thumbnail_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  check (status in ('draft', 'published', 'archived'))
);

create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.course_sections(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  lesson_type text not null default 'text',
  content text,
  video_url text,
  resource_url text,
  sort_order integer not null default 0,
  is_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lesson_type in ('text', 'video', 'pdf', 'quiz', 'assignment'))
);

create index if not exists courses_tenant_id_idx on public.courses (tenant_id);
create index if not exists courses_status_idx on public.courses (status);
create index if not exists course_sections_course_id_idx on public.course_sections (course_id);
create index if not exists lessons_course_id_idx on public.lessons (course_id);
create index if not exists lessons_section_id_idx on public.lessons (section_id);

drop trigger if exists set_courses_updated_at on public.courses;
create trigger set_courses_updated_at
before update on public.courses
for each row execute function public.set_updated_at();

drop trigger if exists set_course_sections_updated_at on public.course_sections;
create trigger set_course_sections_updated_at
before update on public.course_sections
for each row execute function public.set_updated_at();

drop trigger if exists set_lessons_updated_at on public.lessons;
create trigger set_lessons_updated_at
before update on public.lessons
for each row execute function public.set_updated_at();

alter table public.courses enable row level security;
alter table public.course_sections enable row level security;
alter table public.lessons enable row level security;

grant select, insert, update, delete on public.courses to authenticated;
grant select, insert, update, delete on public.course_sections to authenticated;
grant select, insert, update, delete on public.lessons to authenticated;

drop policy if exists "Tenant members can read courses" on public.courses;
create policy "Tenant members can read courses"
on public.courses
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create courses" on public.courses;
create policy "Tenant members can create courses"
on public.courses
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and created_by = auth.uid()
);

drop policy if exists "Tenant members can update courses" on public.courses;
create policy "Tenant members can update courses"
on public.courses
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can delete courses" on public.courses;
create policy "Tenant members can delete courses"
on public.courses
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can read course sections" on public.course_sections;
create policy "Tenant members can read course sections"
on public.course_sections
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can manage course sections" on public.course_sections;
create policy "Tenant members can manage course sections"
on public.course_sections
for all
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can read lessons" on public.lessons;
create policy "Tenant members can read lessons"
on public.lessons
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can manage lessons" on public.lessons;
create policy "Tenant members can manage lessons"
on public.lessons
for all
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));