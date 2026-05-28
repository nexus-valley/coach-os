-- Module 38.1: Demo reset delete policy fixes
-- Run after Module 32 notifications, Module 33 assignments, Module 36 chat,
-- and Module 38 demo workspace.

-- Demo reset deletes only rows tracked in public.demo_seed_records.
-- These grants are required for DELETE, while RLS below restricts deletion to:
-- 1) owner/admin of the tenant
-- 2) same tenant_id
-- 3) matching demo_seed_records.entity_type
-- 4) matching demo_seed_records.entity_id

grant delete on public.notifications to authenticated;
grant delete on public.communication_logs to authenticated;
grant delete on public.assignments to authenticated;
grant delete on public.assignment_submissions to authenticated;
grant delete on public.conversation_threads to authenticated;
grant delete on public.conversation_participants to authenticated;
grant delete on public.conversation_messages to authenticated;
grant delete on public.payments to authenticated;

drop policy if exists "Owner and admin can delete tenant notifications" on public.notifications;
create policy "Owner and admin can delete tenant notifications"
on public.notifications
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = notifications.tenant_id
      and dsr.entity_type = 'notifications'
      and dsr.entity_id = notifications.id
  )
);

drop policy if exists "Demo reset restricts notification deletes" on public.notifications;
create policy "Demo reset restricts notification deletes"
on public.notifications
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = notifications.tenant_id
      and dsr.entity_type = 'notifications'
      and dsr.entity_id = notifications.id
  )
);

drop policy if exists "Owner and admin can delete communication logs" on public.communication_logs;
create policy "Owner and admin can delete communication logs"
on public.communication_logs
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = communication_logs.tenant_id
      and dsr.entity_type = 'communication_logs'
      and dsr.entity_id = communication_logs.id
  )
);

drop policy if exists "Demo reset restricts communication log deletes" on public.communication_logs;
create policy "Demo reset restricts communication log deletes"
on public.communication_logs
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = communication_logs.tenant_id
      and dsr.entity_type = 'communication_logs'
      and dsr.entity_id = communication_logs.id
  )
);

drop policy if exists "Owner and admin can delete demo assignments" on public.assignments;
create policy "Owner and admin can delete demo assignments"
on public.assignments
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = assignments.tenant_id
      and dsr.entity_type = 'assignments'
      and dsr.entity_id = assignments.id
  )
);

drop policy if exists "Demo reset restricts assignment deletes" on public.assignments;
create policy "Demo reset restricts assignment deletes"
on public.assignments
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = assignments.tenant_id
      and dsr.entity_type = 'assignments'
      and dsr.entity_id = assignments.id
  )
);

drop policy if exists "Owner and admin can delete demo assignment submissions" on public.assignment_submissions;
create policy "Owner and admin can delete demo assignment submissions"
on public.assignment_submissions
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = assignment_submissions.tenant_id
      and dsr.entity_type = 'assignment_submissions'
      and dsr.entity_id = assignment_submissions.id
  )
);

drop policy if exists "Demo reset restricts assignment submission deletes" on public.assignment_submissions;
create policy "Demo reset restricts assignment submission deletes"
on public.assignment_submissions
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = assignment_submissions.tenant_id
      and dsr.entity_type = 'assignment_submissions'
      and dsr.entity_id = assignment_submissions.id
  )
);

drop policy if exists "Owner and admin can delete conversation threads" on public.conversation_threads;
create policy "Owner and admin can delete conversation threads"
on public.conversation_threads
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = conversation_threads.tenant_id
      and dsr.entity_type = 'conversation_threads'
      and dsr.entity_id = conversation_threads.id
  )
);

drop policy if exists "Demo reset restricts conversation thread deletes" on public.conversation_threads;
create policy "Demo reset restricts conversation thread deletes"
on public.conversation_threads
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = conversation_threads.tenant_id
      and dsr.entity_type = 'conversation_threads'
      and dsr.entity_id = conversation_threads.id
  )
);

drop policy if exists "Owner and admin can delete conversation participants" on public.conversation_participants;
create policy "Owner and admin can delete conversation participants"
on public.conversation_participants
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = conversation_participants.tenant_id
      and dsr.entity_type = 'conversation_participants'
      and dsr.entity_id = conversation_participants.id
  )
);

drop policy if exists "Demo reset restricts conversation participant deletes" on public.conversation_participants;
create policy "Demo reset restricts conversation participant deletes"
on public.conversation_participants
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = conversation_participants.tenant_id
      and dsr.entity_type = 'conversation_participants'
      and dsr.entity_id = conversation_participants.id
  )
);

drop policy if exists "Owner and admin can delete conversation messages" on public.conversation_messages;
create policy "Owner and admin can delete conversation messages"
on public.conversation_messages
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = conversation_messages.tenant_id
      and dsr.entity_type = 'conversation_messages'
      and dsr.entity_id = conversation_messages.id
  )
);

drop policy if exists "Demo reset restricts conversation message deletes" on public.conversation_messages;
create policy "Demo reset restricts conversation message deletes"
on public.conversation_messages
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = conversation_messages.tenant_id
      and dsr.entity_type = 'conversation_messages'
      and dsr.entity_id = conversation_messages.id
  )
);

drop policy if exists "Owner and admin can delete payments" on public.payments;
create policy "Owner and admin can delete payments"
on public.payments
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = payments.tenant_id
      and dsr.entity_type = 'payments'
      and dsr.entity_id = payments.id
  )
);

drop policy if exists "Demo reset restricts payment deletes" on public.payments;
create policy "Demo reset restricts payment deletes"
on public.payments
as restrictive
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.demo_seed_records dsr
    where dsr.tenant_id = payments.tenant_id
      and dsr.entity_type = 'payments'
      and dsr.entity_id = payments.id
  )
);
