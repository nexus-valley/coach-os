-- Module 41: Automation and workflow engine foundation
-- Additive workflow architecture. Run after Module 17 automations and Module 28.2 security hardening.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null,
  action_type text not null default 'create_reminder',
  is_active boolean not null default true,
  status text not null default 'active',
  execution_mode text not null default 'instant',
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automation_rules
add column if not exists description text,
add column if not exists status text not null default 'active',
add column if not exists execution_mode text not null default 'instant',
add column if not exists created_by uuid references auth.users(id) on delete set null,
add column if not exists metadata_json jsonb not null default '{}'::jsonb;

update public.automation_rules
set
  status = coalesce(status, case when is_active then 'active' else 'inactive' end),
  execution_mode = coalesce(execution_mode, 'instant'),
  metadata_json = coalesce(metadata_json, '{}'::jsonb),
  config = coalesce(config, '{}'::jsonb)
where status is null
   or execution_mode is null
   or metadata_json is null
   or config is null;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.automation_rules'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%trigger_type%'
        or pg_get_constraintdef(oid) ilike '%action_type%'
        or pg_get_constraintdef(oid) ilike '%status%'
        or pg_get_constraintdef(oid) ilike '%execution_mode%'
      )
  loop
    execute format(
      'alter table public.automation_rules drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;
end;
$$;

alter table public.automation_rules
add constraint automation_rules_trigger_type_check
check (
  trigger_type in (
    'student_created',
    'payment_received',
    'payment_created',
    'assignment_overdue',
    'attendance_low',
    'session_scheduled',
    'trial_expiring',
    'certificate_issued',
    'enrollment_created',
    'course_completed'
  )
);

alter table public.automation_rules
add constraint automation_rules_action_type_check
check (
  action_type in (
    'create_notification',
    'create_reminder',
    'send_email_placeholder',
    'send_whatsapp_placeholder',
    'add_internal_note',
    'generate_task_placeholder'
  )
);

alter table public.automation_rules
add constraint automation_rules_status_check
check (status in ('active', 'inactive', 'draft'));

alter table public.automation_rules
add constraint automation_rules_execution_mode_check
check (execution_mode in ('instant', 'scheduled'));

create table if not exists public.automation_rule_conditions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  condition_type text not null check (
    condition_type in (
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'contains',
      'date_before',
      'date_after'
    )
  ),
  operator text not null default 'equals',
  value_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_rule_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  action_type text not null check (
    action_type in (
      'create_notification',
      'create_reminder',
      'send_email_placeholder',
      'send_whatsapp_placeholder',
      'add_internal_note',
      'generate_task_placeholder'
    )
  ),
  config_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete set null,
  trigger_source text,
  entity_type text,
  entity_id uuid,
  status text not null default 'queued' check (status in ('queued', 'success', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb
);

create table if not exists public.automation_run_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.automation_runs(id) on delete cascade,
  log_level text not null default 'info' check (log_level in ('info', 'warning', 'error')),
  message text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists automation_rules_tenant_idx
on public.automation_rules (tenant_id, is_active);
create index if not exists automation_rules_tenant_status_idx
on public.automation_rules (tenant_id, status);
create index if not exists automation_rules_tenant_trigger_idx
on public.automation_rules (tenant_id, trigger_type);
create index if not exists automation_rules_tenant_created_at_idx
on public.automation_rules (tenant_id, created_at desc);

create index if not exists automation_rule_conditions_tenant_idx
on public.automation_rule_conditions (tenant_id);
create index if not exists automation_rule_conditions_rule_idx
on public.automation_rule_conditions (rule_id, sort_order);

create index if not exists automation_rule_actions_tenant_idx
on public.automation_rule_actions (tenant_id);
create index if not exists automation_rule_actions_rule_idx
on public.automation_rule_actions (rule_id, sort_order);

create index if not exists automation_runs_tenant_idx
on public.automation_runs (tenant_id);
create index if not exists automation_runs_tenant_rule_idx
on public.automation_runs (tenant_id, rule_id);
create index if not exists automation_runs_tenant_status_idx
on public.automation_runs (tenant_id, status);
create index if not exists automation_runs_tenant_started_at_idx
on public.automation_runs (tenant_id, started_at desc);

create index if not exists automation_run_logs_tenant_idx
on public.automation_run_logs (tenant_id);
create index if not exists automation_run_logs_run_idx
on public.automation_run_logs (run_id, created_at);

drop trigger if exists set_automation_rules_updated_at on public.automation_rules;
create trigger set_automation_rules_updated_at
before update on public.automation_rules
for each row execute function public.set_updated_at();

alter table public.automation_rules enable row level security;
alter table public.automation_rule_conditions enable row level security;
alter table public.automation_rule_actions enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_run_logs enable row level security;

grant select, insert, update, delete on public.automation_rules to authenticated;
grant select, insert, update, delete on public.automation_rule_conditions to authenticated;
grant select, insert, update, delete on public.automation_rule_actions to authenticated;
grant select, insert, update on public.automation_runs to authenticated;
grant select, insert on public.automation_run_logs to authenticated;

drop policy if exists "Tenant members can read automation rules" on public.automation_rules;
drop policy if exists "Tenant members can create automation rules" on public.automation_rules;
drop policy if exists "Tenant members can update automation rules" on public.automation_rules;
drop policy if exists "Tenant members can delete automation rules" on public.automation_rules;

drop policy if exists "Owner and admin can read automation rules" on public.automation_rules;
create policy "Owner and admin can read automation rules"
on public.automation_rules
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can create automation rules" on public.automation_rules;
create policy "Owner and admin can create automation rules"
on public.automation_rules
for insert
to authenticated
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can update automation rules" on public.automation_rules;
create policy "Owner and admin can update automation rules"
on public.automation_rules
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can delete automation rules" on public.automation_rules;
create policy "Owner and admin can delete automation rules"
on public.automation_rules
for delete
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can manage automation conditions" on public.automation_rule_conditions;
create policy "Owner and admin can manage automation conditions"
on public.automation_rule_conditions
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can manage automation actions" on public.automation_rule_actions;
create policy "Owner and admin can manage automation actions"
on public.automation_rule_actions
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can manage automation runs" on public.automation_runs;
create policy "Owner and admin can manage automation runs"
on public.automation_runs
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can manage automation run logs" on public.automation_run_logs;
create policy "Owner and admin can manage automation run logs"
on public.automation_run_logs
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

