begin;

-- Module 70.3D2: Conversation Table Direct Write Revoke.
--
-- Module 57 academy chat RPCs are the canonical write path for
-- academy-student chat. Legacy conversation/message browser helper writes were
-- fail-closed in Module 70.3D, and active message routes now use RPC-backed
-- helpers in src/lib/academyChat.ts.
--
-- Preserve SELECT/read paths for legacy dashboard and operations visibility.
-- Revoke only direct browser/client write privileges on the legacy
-- conversation tables. RLS policy cleanup is intentionally deferred.

revoke insert, update, delete on table public.conversation_threads from anon, authenticated;
revoke insert, update, delete on table public.conversation_participants from anon, authenticated;
revoke insert, update, delete on table public.conversation_messages from anon, authenticated;

-- Rollback notes only. Do not run unless explicitly approved during emergency
-- rollback. SELECT grants and Module 57 RPC execute grants are intentionally
-- not affected by this patch.
--
-- grant insert, update, delete on table public.conversation_threads to authenticated;
-- grant insert, update, delete on table public.conversation_participants to authenticated;
-- grant insert, update, delete on table public.conversation_messages to authenticated;

commit;
