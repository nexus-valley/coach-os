-- Module 32: Notification and communication center
-- Additive only. Run after Module 31 attendance tracking.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (
    type in (
      'session_reminder',
      'attendance_alert',
      'payment_reminder',
      'invoice_notice',
      'invitation_notice',
      'system_notice',
      'subscription_notice'
    )
  ),
  title text not null,
  message text not null,
  entity_type text,
  entity_id uuid,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  status text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  action_url text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enable_in_app boolean not null default true,
  enable_email boolean not null default false,
  enable_whatsapp boolean not null default false,
  enable_attendance_alerts boolean not null default true,
  enable_payment_alerts boolean not null default true,
  enable_session_reminders boolean not null default true,
  enable_system_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null check (channel in ('in_app', 'email', 'whatsapp', 'sms')),
  type text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  target text,
  subject text,
  message text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_tenant_id_idx on public.notifications (tenant_id);
create index if not exists notifications_tenant_user_idx on public.notifications (tenant_id, user_id);
create index if not exists notifications_tenant_user_status_idx on public.notifications (tenant_id, user_id, status);
create index if not exists notifications_tenant_status_idx on public.notifications (tenant_id, status);
create index if not exists notifications_tenant_severity_idx on public.notifications (tenant_id, severity);
create index if not exists notifications_tenant_created_at_idx on public.notifications (tenant_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id, status, created_at desc);

create index if not exists notification_preferences_tenant_user_idx
on public.notification_preferences (tenant_id, user_id);

create index if not exists communication_logs_tenant_id_idx on public.communication_logs (tenant_id);
create index if not exists communication_logs_tenant_user_idx on public.communication_logs (tenant_id, user_id);
create index if not exists communication_logs_tenant_status_idx on public.communication_logs (tenant_id, status);
create index if not exists communication_logs_tenant_created_at_idx on public.communication_logs (tenant_id, created_at desc);

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.communication_logs enable row level security;

grant select, insert, update on public.notifications to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert on public.communication_logs to authenticated;

drop policy if exists "Owner and admin can read tenant notifications" on public.notifications;
create policy "Owner and admin can read tenant notifications"
on public.notifications
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
on public.notifications
for select
to authenticated
using (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Tenant members can create notifications" on public.notifications;
drop policy if exists "Owner and admin can create tenant notifications" on public.notifications;
create policy "Owner and admin can create tenant notifications"
on public.notifications
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = notifications.tenant_id
      and tm.user_id = notifications.user_id
  )
);

drop policy if exists "Users can create own notifications" on public.notifications;
create policy "Users can create own notifications"
on public.notifications
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
on public.notifications
for update
to authenticated
using (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
)
with check (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Owner and admin can update tenant notifications" on public.notifications;
create policy "Owner and admin can update tenant notifications"
on public.notifications
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Users can read own notification preferences" on public.notification_preferences;
create policy "Users can read own notification preferences"
on public.notification_preferences
for select
to authenticated
using (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Users can create own notification preferences" on public.notification_preferences;
create policy "Users can create own notification preferences"
on public.notification_preferences
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Users can update own notification preferences" on public.notification_preferences;
create policy "Users can update own notification preferences"
on public.notification_preferences
for update
to authenticated
using (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
)
with check (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Owner and admin can read communication logs" on public.communication_logs;
create policy "Owner and admin can read communication logs"
on public.communication_logs
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Users can read own communication logs" on public.communication_logs;
create policy "Users can read own communication logs"
on public.communication_logs
for select
to authenticated
using (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);

drop policy if exists "Tenant members can create communication logs" on public.communication_logs;
drop policy if exists "Owner and admin can create tenant communication logs" on public.communication_logs;
create policy "Owner and admin can create tenant communication logs"
on public.communication_logs
for insert
to authenticated
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Users can create own communication logs" on public.communication_logs;
create policy "Users can create own communication logs"
on public.communication_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);
