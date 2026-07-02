begin;

-- Module 70.1: Low-risk direct write grant revoke.
--
-- These tables now have production-smoked secure RPC replacements from
-- Modules 69.1, 69.2, 69.8, and 69.9. Keep SELECT grants and existing RLS
-- policies intact; this patch only removes ordinary browser/client write
-- privileges from anon/authenticated roles.
--
-- Do not touch automation_runs or automation_run_logs here. Those direct
-- runner write grants were already revoked in Module 69.9.

revoke insert, update, delete on table public.students from anon, authenticated;
revoke insert, update, delete on table public.enrollments from anon, authenticated;
revoke insert, update, delete on table public.cohort_members from anon, authenticated;
revoke insert, update, delete on table public.courses from anon, authenticated;
revoke insert, update, delete on table public.course_sections from anon, authenticated;
revoke insert, update, delete on table public.lessons from anon, authenticated;
revoke insert, update, delete on table public.cohorts from anon, authenticated;
revoke insert, update, delete on table public.lesson_progress from anon, authenticated;
revoke insert, update, delete on table public.automation_rules from anon, authenticated;
revoke insert, update, delete on table public.automation_rule_conditions from anon, authenticated;
revoke insert, update, delete on table public.automation_rule_actions from anon, authenticated;

-- Rollback, if direct browser writes must be temporarily restored during an
-- incident. Prefer fixing callers to use the secure RPCs before using this.
--
-- grant insert, update, delete on table public.students to authenticated;
-- grant insert, update, delete on table public.enrollments to authenticated;
-- grant insert, update, delete on table public.cohort_members to authenticated;
-- grant insert, update, delete on table public.courses to authenticated;
-- grant insert, update, delete on table public.course_sections to authenticated;
-- grant insert, update, delete on table public.lessons to authenticated;
-- grant insert, update, delete on table public.cohorts to authenticated;
-- grant insert, update, delete on table public.lesson_progress to authenticated;
-- grant insert, update, delete on table public.automation_rules to authenticated;
-- grant insert, update, delete on table public.automation_rule_conditions to authenticated;
-- grant insert, update, delete on table public.automation_rule_actions to authenticated;

commit;
