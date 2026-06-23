-- Module 45: Audit and compliance center
-- Run after supabase/module25_audit_log_upgrades.sql.

-- The Audit & Compliance Center reuses public.audit_logs as the append-only
-- audit source. These indexes support owner/admin filtered reads without
-- adding duplicate audit storage or broad policies.

create index if not exists audit_logs_tenant_created_at_id_idx
on public.audit_logs (tenant_id, created_at desc, id);

create index if not exists audit_logs_tenant_severity_created_at_idx
on public.audit_logs (tenant_id, severity, created_at desc);

create index if not exists audit_logs_tenant_entity_created_at_idx
on public.audit_logs (tenant_id, entity_type, created_at desc);

create index if not exists audit_logs_tenant_action_created_at_idx
on public.audit_logs (tenant_id, action, created_at desc);

create index if not exists audit_logs_tenant_user_created_at_idx
on public.audit_logs (tenant_id, user_id, created_at desc);

-- Keep audit logs append-only from the authenticated application role.
-- Module 24 grants select/insert only; these revokes make that posture explicit
-- if a future/manual grant accidentally broadened app privileges.
revoke update, delete on public.audit_logs from authenticated;
