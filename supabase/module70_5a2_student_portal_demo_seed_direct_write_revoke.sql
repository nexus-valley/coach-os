-- Module 70.5A2: Student Portal Accounts + Demo Seed Records Direct Write Revoke
--
-- Active student portal flows only read public.student_portal_accounts to
-- resolve portal context. Future student portal account mutation must use a
-- secure RPC/API path instead of direct browser table writes.
--
-- public.demo_seed_records belongs to retired/unreachable demo seed/reset
-- helpers. Demo seed/reset browser access was retired before this module.
--
-- SELECT/read paths are preserved for existing portal context and historical
-- demo tracking reads. RLS policy cleanup is intentionally deferred.

begin;

revoke insert, update, delete
on table public.student_portal_accounts
from public, anon, authenticated;

revoke insert, update, delete
on table public.demo_seed_records
from public, anon, authenticated;

-- Rollback, if an emergency restore is required for authenticated direct writes:
-- grant insert, update, delete on table public.student_portal_accounts to authenticated;
-- grant insert, update, delete on table public.demo_seed_records to authenticated;

commit;
