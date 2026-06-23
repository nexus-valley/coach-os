-- Module 46: Backup and recovery center
-- Tenant-scoped export activity tracking. Run after Module 45.

create table if not exists public.backup_export_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  export_type text not null check (
    export_type in (
      'students',
      'courses',
      'cohorts',
      'enrollments',
      'sessions',
      'attendance',
      'assignments',
      'payments',
      'certificates'
    )
  ),
  status text not null check (status in ('started', 'completed', 'failed')),
  row_count integer check (row_count is null or row_count >= 0),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists backup_export_logs_tenant_created_at_idx
on public.backup_export_logs (tenant_id, created_at desc);

create index if not exists backup_export_logs_tenant_status_idx
on public.backup_export_logs (tenant_id, status, created_at desc);

create index if not exists backup_export_logs_tenant_type_idx
on public.backup_export_logs (tenant_id, export_type, created_at desc);

alter table public.backup_export_logs enable row level security;

grant select, insert on public.backup_export_logs to authenticated;

drop policy if exists "Owner and admin can read backup export logs" on public.backup_export_logs;
create policy "Owner and admin can read backup export logs"
on public.backup_export_logs
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can create backup export logs" on public.backup_export_logs;
create policy "Owner and admin can create backup export logs"
on public.backup_export_logs
for insert
to authenticated
with check (
  requested_by = auth.uid()
  and public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
);
