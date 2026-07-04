begin;

-- Module 70.4A2: Backup Export Logs Direct Write Revoke
--
-- Module 70.3A introduced public.record_backup_export_log_secure as the
-- canonical write path for backup export activity. src/lib/backup.ts now logs
-- started/completed/failed export events through that RPC instead of directly
-- inserting into public.backup_export_logs.
--
-- SELECT/read paths are preserved for backup activity/history display in the
-- Backup & Recovery Center. This patch intentionally does not alter RLS
-- policies, RPC execute grants, helper functions, schema usage, data, or
-- unrelated tables. RLS policy cleanup is deferred.

revoke insert, update, delete on table public.backup_export_logs from anon, authenticated;

-- rollback, if an emergency restoration is required:
-- grant insert, update, delete on table public.backup_export_logs to authenticated;

commit;
