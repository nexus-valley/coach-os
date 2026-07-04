-- Module 70.4B2: Audit Logs Direct Write Revoke
--
-- Browser/client direct writes to public.audit_logs are retired. Secure
-- SECURITY DEFINER RPC/function paths are now the canonical audit write paths,
-- including record_audit_event_secure, record_ai_assistant_audit_secure,
-- record_report_export_event, and module-specific internal audit helpers.
--
-- This patch preserves SELECT/read access for activity, compliance, and audit
-- history displays. RLS policy cleanup is intentionally deferred.
--
-- Include PUBLIC defensively: the backend smoke found a valid authenticated
-- tenant member could still insert after revoking from anon/authenticated,
-- which means an effective broad grant remains outside the named app roles.

begin;

revoke insert, update, delete on table public.audit_logs from public, anon, authenticated;

-- Rollback, if emergency restoration is required:
-- grant insert, update, delete on table public.audit_logs to authenticated;
--
-- Do not grant write access back to anon. SELECT grants are intentionally not
-- changed by this module.

commit;
