-- Module 25: Audit log production upgrades
-- Run after supabase/module24_audit_logs.sql.

alter table public.audit_logs
add column if not exists severity text not null default 'info';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'audit_logs_severity_check'
  ) then
    alter table public.audit_logs
    add constraint audit_logs_severity_check
    check (severity in ('info', 'warning', 'critical'));
  end if;
end $$;

create index if not exists audit_logs_tenant_severity_idx
on public.audit_logs (tenant_id, severity);

update public.audit_logs
set severity = case
  when action in (
    'settings_updated',
    'student_deleted',
    'team_member_removed',
    'certificate_revoked',
    'user_deleted',
    'workspace_modified'
  ) then 'critical'
  when action in (
    'role_changed',
    'enrollment_deleted',
    'payment_deleted',
    'payment_link_deleted',
    'course_section_deleted',
    'lesson_deleted',
    'reminder_deleted',
    'payment_link_updated'
  ) then 'warning'
  else 'info'
end
where severity is null or severity = 'info';
