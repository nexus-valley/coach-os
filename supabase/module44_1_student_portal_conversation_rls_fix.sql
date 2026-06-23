-- Module 44.1: Student portal conversation RLS recursion fix
-- Run after supabase/module44_role_specific_portals.sql.

-- Student conversation access is deferred until a dedicated student-safe
-- message RLS/RPC design is implemented. This drops only the student portal
-- policy added by Module 44 and leaves existing team-user conversation
-- policies unchanged.

drop policy if exists "Linked students can read safe conversation threads"
on public.conversation_threads;
