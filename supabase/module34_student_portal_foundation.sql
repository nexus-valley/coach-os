-- Module 34: Student portal foundation
-- Additive only. Run after Module 5 students.

alter table public.students
add column if not exists portal_enabled boolean not null default true,
add column if not exists portal_access_code text unique,
add column if not exists portal_last_accessed_at timestamptz;

create index if not exists students_tenant_portal_enabled_idx
on public.students (tenant_id, portal_enabled);

create unique index if not exists students_portal_access_code_unique_idx
on public.students (portal_access_code)
where portal_access_code is not null;
