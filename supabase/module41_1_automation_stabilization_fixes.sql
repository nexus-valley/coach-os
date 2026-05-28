-- Module 41.1: Automation stabilization fixes
-- Run after supabase/module41_automation_workflow_engine.sql if Module 41
-- was applied before the legacy is_active/status backfill fix.

update public.automation_rules
set status = 'inactive'
where is_active = false
  and status = 'active';

