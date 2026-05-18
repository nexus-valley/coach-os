-- Module 26: Roles, permissions, and workspace security foundation
-- Run after Module 11 role helper SQL.

alter table public.tenant_members
drop constraint if exists tenant_members_role_check;

alter table public.tenant_members
add constraint tenant_members_role_check
check (role in ('owner', 'admin', 'staff', 'trainer'));

-- Existing public.has_tenant_role(...) continues to work with the new role.
-- Trainer scoping by assigned courses/cohorts can be added later with a
-- dedicated assignment table without changing tenant_members again.

update public.audit_logs
set severity = case
  when action = 'subscription_plan_changed' then 'critical'
  when action = 'access_denied' then 'warning'
  else severity
end
where action in ('access_denied', 'subscription_plan_changed');
