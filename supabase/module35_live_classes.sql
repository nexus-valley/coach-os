-- Module 35: Live classes and meeting infrastructure foundation
-- Additive only. Run after Module 31 attendance tracking and Module 32 notifications.

alter table public.sessions
add column if not exists delivery_mode text not null default 'offline',
add column if not exists meeting_provider text,
add column if not exists meeting_url text,
add column if not exists meeting_id text,
add column if not exists meeting_passcode text,
add column if not exists meeting_notes text,
add column if not exists timezone text not null default 'Asia/Kolkata',
add column if not exists join_available_from timestamptz,
add column if not exists recording_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_delivery_mode_check'
  ) then
    alter table public.sessions
    add constraint sessions_delivery_mode_check
    check (delivery_mode in ('online', 'offline', 'hybrid'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sessions_meeting_provider_check'
  ) then
    alter table public.sessions
    add constraint sessions_meeting_provider_check
    check (
      meeting_provider is null
      or meeting_provider in ('zoom', 'google_meet', 'microsoft_teams', 'custom')
    );
  end if;
end $$;

create index if not exists sessions_tenant_delivery_mode_idx
on public.sessions (tenant_id, delivery_mode);

create index if not exists sessions_tenant_provider_idx
on public.sessions (tenant_id, meeting_provider);

create index if not exists sessions_tenant_join_available_idx
on public.sessions (tenant_id, join_available_from);

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'notifications'
  ) then
    alter table public.notifications
    drop constraint if exists notifications_type_check;

    alter table public.notifications
    add constraint notifications_type_check
    check (
      type in (
        'session_reminder',
        'attendance_alert',
        'payment_reminder',
        'invoice_notice',
        'invitation_notice',
        'system_notice',
        'subscription_notice',
        'assignment_notice',
        'live_session_notice'
      )
    );
  end if;
end $$;
