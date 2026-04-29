create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  trigger_type text not null,
  action_type text not null,
  is_active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trigger_type in ('payment_created', 'enrollment_created', 'student_created', 'course_completed')),
  check (action_type in ('create_reminder'))
);

create index if not exists automation_rules_tenant_idx
on public.automation_rules (tenant_id, is_active);

drop trigger if exists set_automation_rules_updated_at on public.automation_rules;
create trigger set_automation_rules_updated_at
before update on public.automation_rules
for each row execute function public.set_updated_at();

alter table public.automation_rules enable row level security;

grant select, insert, update, delete on public.automation_rules to authenticated;

drop policy if exists "Tenant members can read automation rules" on public.automation_rules;
create policy "Tenant members can read automation rules"
on public.automation_rules
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create automation rules" on public.automation_rules;
create policy "Tenant members can create automation rules"
on public.automation_rules
for insert
to authenticated
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can update automation rules" on public.automation_rules;
create policy "Tenant members can update automation rules"
on public.automation_rules
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can delete automation rules" on public.automation_rules;
create policy "Tenant members can delete automation rules"
on public.automation_rules
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));