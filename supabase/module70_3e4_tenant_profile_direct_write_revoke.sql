begin;

-- Module 70.3E4: Tenant / Tenant Member / Profile Direct Write Revoke
--
-- Module 70.3E1 made public.create_workspace_with_owner the canonical
-- tenant/member bootstrap write path. Browser/client fallback inserts into
-- public.tenants and public.tenant_members have been removed.
--
-- Module 70.3E2 made the auth profile trigger the canonical profile creation
-- path. public.handle_new_user_profile / on_auth_user_created_profile remain
-- unchanged and continue to run from the auth.users insert trigger.
--
-- Team membership changes remain behind secure RPCs, including
-- public.accept_team_invitation and the Module 69.5 team member role/remove
-- RPCs. This patch intentionally does not alter RPC execute grants, functions,
-- triggers, data, or RLS policies.
--
-- SELECT/read paths are preserved. RLS policy cleanup is deferred.

revoke insert, update, delete on table public.tenants from anon, authenticated;
revoke insert, update, delete on table public.tenant_members from anon, authenticated;
revoke insert, update, delete on table public.profiles from anon, authenticated;

-- rollback, if an emergency restoration is required:
-- grant insert, update, delete on table public.tenants to authenticated;
-- grant insert, update, delete on table public.tenant_members to authenticated;
-- grant insert, update, delete on table public.profiles to authenticated;

commit;
