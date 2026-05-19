-- Module 28.2: QA security hardening patches
-- Run after Module 26 roles/permissions and Module 17 automations.

-- Automation rules are an admin-level workspace control. Earlier policies
-- allowed every tenant member to read and mutate them, which bypassed the
-- app-level RBAC helpers. Keep access tenant-scoped and restrict it to
-- owner/admin at the RLS layer.

drop policy if exists "Tenant members can read automation rules" on public.automation_rules;
create policy "Owner and admin can read automation rules"
on public.automation_rules
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Tenant members can create automation rules" on public.automation_rules;
create policy "Owner and admin can create automation rules"
on public.automation_rules
for insert
to authenticated
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Tenant members can update automation rules" on public.automation_rules;
create policy "Owner and admin can update automation rules"
on public.automation_rules
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Tenant members can delete automation rules" on public.automation_rules;
create policy "Owner and admin can delete automation rules"
on public.automation_rules
for delete
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));
