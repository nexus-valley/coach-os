-- Module 42.1: Automation integration smoke-test fixes
-- Superseded by Module 42.2 secure automation execution.
-- Run supabase/module42_2_secure_automation_execution.sql for production.

alter table public.automation_runs
add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

create index if not exists automation_runs_tenant_created_by_idx
on public.automation_runs (tenant_id, created_by);

-- Remove the temporary tenant-member visibility policies if this patch is
-- rerun after an earlier 42.1 draft. Staff/trainers should not read workflow
-- definitions directly.
drop policy if exists "Tenant members can read active automation rules for execution" on public.automation_rules;
drop policy if exists "Tenant members can read active automation conditions for execution" on public.automation_rule_conditions;
drop policy if exists "Tenant members can read active automation actions for execution" on public.automation_rule_actions;
drop policy if exists "Tenant members can read own automation runs" on public.automation_runs;
drop policy if exists "Tenant members can create automation runs for active rules" on public.automation_runs;
drop policy if exists "Tenant members can update own automation runs" on public.automation_runs;
drop policy if exists "Tenant members can create own automation run logs" on public.automation_run_logs;
