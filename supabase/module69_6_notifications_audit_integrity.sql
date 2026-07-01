begin;

-- Module 69.6: Notifications, reminders, communication logs, and audit logging integrity.
-- Existing direct table grants are intentionally left in place. They can be
-- considered for revocation only after these RPC-backed flows have production confidence.

create or replace function public.m69_6_current_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.m69_6_assert_member_role(
  p_tenant_id uuid,
  p_allowed_roles text[] default null,
  p_message text default 'Workspace membership is required.'
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  v_role := public.m69_6_current_role(p_tenant_id);

  if v_role is null then
    raise exception 'Workspace membership is required.' using errcode = '42501';
  end if;

  if p_allowed_roles is not null and not (v_role = any(p_allowed_roles)) then
    raise exception '%', coalesce(p_message, 'You do not have permission to perform this action.') using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m69_6_sanitize_metadata(p_metadata jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_key text;
  v_blocked_keys text[] := array[
    'authorization',
    'cookie',
    'password',
    'token',
    'otp',
    'code',
    'service_role',
    'serviceRole',
    'signedUrl',
    'signed_url',
    'storage_path',
    'storagePath',
    'storage_bucket',
    'storageBucket',
    'invite_token',
    'inviteToken',
    'reset_token',
    'resetToken',
    'meeting_url',
    'meetingUrl',
    'recording_url',
    'recordingUrl',
    'meeting_passcode',
    'meetingPasscode',
    'attachment_urls',
    'attachmentUrls',
    'instructions',
    'submission_text',
    'submissionText',
    'feedback',
    'notes',
    'description',
    'email',
    'phone',
    'full_name',
    'fullName'
  ];
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Metadata must be an object.' using errcode = '22023';
  end if;

  if pg_column_size(v_metadata) > 4096 then
    raise exception 'Metadata is too large.' using errcode = '22023';
  end if;

  foreach v_key in array v_blocked_keys loop
    v_metadata := v_metadata - v_key;
  end loop;

  if pg_column_size(v_metadata) > 2048 then
    raise exception 'Metadata is too large.' using errcode = '22023';
  end if;

  return v_metadata;
end;
$$;

create or replace function public.m69_6_safe_text(
  p_value text,
  p_max_length integer,
  p_field_name text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v_value is not null and char_length(v_value) > p_max_length then
    raise exception '% is too long.', p_field_name using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m69_6_validate_notification_type(p_type text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_type is null or p_type not in (
    'attendance_alert',
    'assignment_notice',
    'communication_notice',
    'invitation_notice',
    'invoice_notice',
    'live_session_notice',
    'payment_reminder',
    'session_reminder',
    'subscription_notice',
    'system_notice'
  ) then
    raise exception 'Select a valid notification type.' using errcode = '22023';
  end if;

  return p_type;
end;
$$;

create or replace function public.m69_6_validate_severity(p_severity text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_severity is null then
    return 'info';
  end if;

  if p_severity not in ('info', 'warning', 'critical') then
    raise exception 'Select a valid severity.' using errcode = '22023';
  end if;

  return p_severity;
end;
$$;

create or replace function public.m69_6_validate_reminder_type(p_type text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_type is null or p_type not in ('general', 'payment', 'course_followup', 'student_followup') then
    raise exception 'Select a valid reminder type.' using errcode = '22023';
  end if;

  return p_type;
end;
$$;

create or replace function public.m69_6_validate_reminder_status(p_status text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('pending', 'completed', 'cancelled') then
    raise exception 'Select a valid reminder status.' using errcode = '22023';
  end if;

  return p_status;
end;
$$;

create or replace function public.m69_6_json_bool(
  p_payload jsonb,
  p_key text,
  p_default boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (p_payload ? p_key) then
    return p_default;
  end if;

  if jsonb_typeof(p_payload -> p_key) <> 'boolean' then
    raise exception 'Notification preference values must be boolean.' using errcode = '22023';
  end if;

  return (p_payload ->> p_key)::boolean;
end;
$$;

create or replace function public.m69_6_infer_audit_severity(p_action text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_action in (
    'settings_updated',
    'student_deleted',
    'subscription_plan_changed',
    'workspace_plan_changed',
    'plan_updated',
    'subscription_canceled',
    'team_member_removed',
    'certificate_revoked',
    'user_deleted',
    'workspace_modified'
  ) then
    return 'critical';
  end if;

  if p_action in (
    'access_denied',
    'automation_action_skipped',
    'automation_disabled',
    'automation_duplicate_skipped',
    'automation_failed',
    'billing_profile_updated',
    'cohort_deleted',
    'communication_logged',
    'course_section_deleted',
    'delegated_permission_activated',
    'delegated_permission_created',
    'delegated_permission_expired',
    'delegated_permission_revoked',
    'enrollment_deleted',
    'feature_limit_warning',
    'invitation_revoked',
    'lesson_deleted',
    'payment_deleted',
    'payment_link_deleted',
    'payment_link_updated',
    'reminder_deleted',
    'role_changed',
    'session_canceled',
    'subscription_status_changed',
    'trial_expired',
    'workspace_limit_reached'
  ) then
    return 'warning';
  end if;

  return 'info';
end;
$$;

create or replace function public.m69_6_validate_client_audit_action(p_action text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_action is null or p_action not in (
    'report_exported',
    'view_opened',
    'filter_applied',
    'notification_preferences_updated',
    'communication_logged',
    'reminder_created',
    'reminder_completed',
    'reminder_status_updated',
    'reminder_deleted'
  ) then
    raise exception 'Audit action is not allowed from this client path.' using errcode = '42501';
  end if;

  return p_action;
end;
$$;

create or replace function public.m69_6_assert_user_in_tenant(
  p_tenant_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'Notification recipient is required.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
  ) then
    raise exception 'Notification recipient is not in this workspace.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.m69_6_assert_reminder_refs(
  p_tenant_id uuid,
  p_student_id uuid,
  p_course_id uuid,
  p_payment_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_student_id is not null and not exists (
    select 1 from public.students s where s.tenant_id = p_tenant_id and s.id = p_student_id
  ) then
    raise exception 'Student not found in this workspace.' using errcode = '22023';
  end if;

  if p_course_id is not null and not exists (
    select 1 from public.courses c where c.tenant_id = p_tenant_id and c.id = p_course_id
  ) then
    raise exception 'Course not found in this workspace.' using errcode = '22023';
  end if;

  if p_payment_id is not null and not exists (
    select 1 from public.payments p where p.tenant_id = p_tenant_id and p.id = p_payment_id
  ) then
    raise exception 'Payment not found in this workspace.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.create_notification_secure(
  p_tenant_id uuid,
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_severity text default 'info',
  p_action_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.notifications
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role text;
  v_notification public.notifications%rowtype;
  v_title text := public.m69_6_safe_text(p_title, 180, 'Notification title');
  v_message text := public.m69_6_safe_text(p_message, 1000, 'Notification message');
  v_action_url text := public.m69_6_safe_text(p_action_url, 300, 'Notification action URL');
begin
  v_role := public.m69_6_assert_member_role(p_tenant_id);
  perform public.m69_6_assert_user_in_tenant(p_tenant_id, p_user_id);

  if p_user_id <> auth.uid() and v_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can create notifications for other users.' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'Notification title is required.' using errcode = '22023';
  end if;

  if v_message is null then
    raise exception 'Notification message is required.' using errcode = '22023';
  end if;

  if v_action_url is not null and (left(v_action_url, 1) <> '/' or left(v_action_url, 2) = '//') then
    raise exception 'Notification action URL must be a safe relative path.' using errcode = '22023';
  end if;

  insert into public.notifications (
    action_url,
    entity_id,
    entity_type,
    message,
    metadata_json,
    severity,
    status,
    tenant_id,
    title,
    type,
    user_id
  )
  values (
    v_action_url,
    p_entity_id,
    public.m69_6_safe_text(p_entity_type, 80, 'Notification entity type'),
    v_message,
    public.m69_6_sanitize_metadata(p_metadata),
    public.m69_6_validate_severity(p_severity),
    'unread',
    p_tenant_id,
    v_title,
    public.m69_6_validate_notification_type(p_type),
    p_user_id
  )
  returning * into v_notification;

  return v_notification;
end;
$$;

create or replace function public.mark_notification_read_secure(
  p_tenant_id uuid,
  p_notification_id uuid
)
returns public.notifications
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role text;
  v_notification public.notifications%rowtype;
begin
  v_role := public.m69_6_assert_member_role(p_tenant_id);

  update public.notifications n
  set status = 'read',
      read_at = coalesce(n.read_at, now())
  where n.tenant_id = p_tenant_id
    and n.id = p_notification_id
    and (n.user_id = auth.uid() or v_role in ('owner', 'admin'))
  returning * into v_notification;

  if not found then
    raise exception 'Notification not found or not accessible.' using errcode = '42501';
  end if;

  return v_notification;
end;
$$;

create or replace function public.archive_notification_secure(
  p_tenant_id uuid,
  p_notification_id uuid
)
returns public.notifications
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role text;
  v_notification public.notifications%rowtype;
begin
  v_role := public.m69_6_assert_member_role(p_tenant_id);

  update public.notifications n
  set status = 'archived'
  where n.tenant_id = p_tenant_id
    and n.id = p_notification_id
    and (n.user_id = auth.uid() or v_role in ('owner', 'admin'))
  returning * into v_notification;

  if not found then
    raise exception 'Notification not found or not accessible.' using errcode = '42501';
  end if;

  return v_notification;
end;
$$;

create or replace function public.ensure_notification_preferences_secure(
  p_tenant_id uuid
)
returns public.notification_preferences
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_preferences public.notification_preferences%rowtype;
begin
  perform public.m69_6_assert_member_role(p_tenant_id);

  select *
  into v_preferences
  from public.notification_preferences np
  where np.tenant_id = p_tenant_id
    and np.user_id = auth.uid();

  if found then
    return v_preferences;
  end if;

  insert into public.notification_preferences (tenant_id, user_id)
  values (p_tenant_id, auth.uid())
  returning * into v_preferences;

  return v_preferences;
end;
$$;

create or replace function public.update_notification_preferences_secure(
  p_tenant_id uuid,
  p_preferences jsonb
)
returns public.notification_preferences
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_preferences jsonb := public.m69_6_sanitize_metadata(p_preferences);
  v_row public.notification_preferences%rowtype;
begin
  perform public.m69_6_assert_member_role(p_tenant_id);

  select *
  into v_row
  from public.notification_preferences np
  where np.tenant_id = p_tenant_id
    and np.user_id = auth.uid();

  if found then
    update public.notification_preferences np
    set
      enable_attendance_alerts = public.m69_6_json_bool(v_preferences, 'enable_attendance_alerts', v_row.enable_attendance_alerts),
      enable_email = public.m69_6_json_bool(v_preferences, 'enable_email', v_row.enable_email),
      enable_in_app = public.m69_6_json_bool(v_preferences, 'enable_in_app', v_row.enable_in_app),
      enable_payment_alerts = public.m69_6_json_bool(v_preferences, 'enable_payment_alerts', v_row.enable_payment_alerts),
      enable_session_reminders = public.m69_6_json_bool(v_preferences, 'enable_session_reminders', v_row.enable_session_reminders),
      enable_system_notifications = public.m69_6_json_bool(v_preferences, 'enable_system_notifications', v_row.enable_system_notifications),
      enable_whatsapp = public.m69_6_json_bool(v_preferences, 'enable_whatsapp', v_row.enable_whatsapp)
    where np.id = v_row.id
    returning * into v_row;
  else
    insert into public.notification_preferences (
      tenant_id,
      user_id,
      enable_attendance_alerts,
      enable_email,
      enable_in_app,
      enable_payment_alerts,
      enable_session_reminders,
      enable_system_notifications,
      enable_whatsapp
    )
    values (
      p_tenant_id,
      auth.uid(),
      public.m69_6_json_bool(v_preferences, 'enable_attendance_alerts', true),
      public.m69_6_json_bool(v_preferences, 'enable_email', false),
      public.m69_6_json_bool(v_preferences, 'enable_in_app', true),
      public.m69_6_json_bool(v_preferences, 'enable_payment_alerts', true),
      public.m69_6_json_bool(v_preferences, 'enable_session_reminders', true),
      public.m69_6_json_bool(v_preferences, 'enable_system_notifications', true),
      public.m69_6_json_bool(v_preferences, 'enable_whatsapp', false)
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.queue_communication_log_secure(
  p_tenant_id uuid,
  p_channel text,
  p_type text,
  p_status text default 'queued',
  p_user_id uuid default null,
  p_target text default null,
  p_subject text default null,
  p_message text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.communication_logs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role text;
  v_log public.communication_logs%rowtype;
begin
  v_role := public.m69_6_assert_member_role(p_tenant_id);

  if p_user_id is not null then
    perform public.m69_6_assert_user_in_tenant(p_tenant_id, p_user_id);
  end if;

  if p_user_id is not null and p_user_id <> auth.uid() and v_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can log communications for other users.' using errcode = '42501';
  end if;

  if p_channel not in ('in_app', 'email', 'whatsapp', 'sms') then
    raise exception 'Select a valid communication channel.' using errcode = '22023';
  end if;

  if p_status is null or p_status not in ('queued', 'sent', 'failed', 'skipped') then
    raise exception 'Select a valid communication status.' using errcode = '22023';
  end if;

  if p_status in ('sent', 'failed') then
    raise exception 'Communication status is not allowed from this client path.' using errcode = '42501';
  end if;

  insert into public.communication_logs (
    channel,
    message,
    metadata_json,
    status,
    subject,
    target,
    tenant_id,
    type,
    user_id
  )
  values (
    p_channel,
    public.m69_6_safe_text(p_message, 1000, 'Communication message'),
    public.m69_6_sanitize_metadata(p_metadata),
    p_status,
    public.m69_6_safe_text(p_subject, 200, 'Communication subject'),
    public.m69_6_safe_text(p_target, 254, 'Communication target'),
    p_tenant_id,
    public.m69_6_safe_text(p_type, 80, 'Communication type'),
    p_user_id
  )
  returning * into v_log;

  return v_log;
end;
$$;

create or replace function public.create_reminder_secure(
  p_tenant_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_reminder_type text default 'general',
  p_description text default null,
  p_student_id uuid default null,
  p_course_id uuid default null,
  p_payment_id uuid default null
)
returns public.reminders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reminder public.reminders%rowtype;
  v_title text := public.m69_6_safe_text(p_title, 180, 'Reminder title');
begin
  perform public.m69_6_assert_member_role(
    p_tenant_id,
    array['owner', 'admin', 'staff', 'trainer'],
    'You do not have permission to manage reminders.'
  );

  if v_title is null then
    raise exception 'Reminder title is required.' using errcode = '22023';
  end if;

  if p_due_at is null then
    raise exception 'Reminder due date is required.' using errcode = '22023';
  end if;

  perform public.m69_6_assert_reminder_refs(p_tenant_id, p_student_id, p_course_id, p_payment_id);

  insert into public.reminders (
    course_id,
    description,
    due_at,
    payment_id,
    reminder_type,
    student_id,
    tenant_id,
    title
  )
  values (
    p_course_id,
    public.m69_6_safe_text(p_description, 1200, 'Reminder description'),
    p_due_at,
    p_payment_id,
    public.m69_6_validate_reminder_type(p_reminder_type),
    p_student_id,
    p_tenant_id,
    v_title
  )
  returning * into v_reminder;

  insert into public.audit_logs (
    action,
    description,
    entity_id,
    entity_name,
    entity_type,
    metadata,
    severity,
    tenant_id,
    user_email,
    user_id,
    user_name
  )
  values (
    'reminder_created',
    'Created reminder',
    v_reminder.id,
    'Reminder',
    'reminder',
    public.m69_6_sanitize_metadata(jsonb_build_object(
      'courseId', v_reminder.course_id,
      'dueAt', v_reminder.due_at,
      'studentId', v_reminder.student_id,
      'type', v_reminder.reminder_type
    )),
    'info',
    p_tenant_id,
    (select u.email from auth.users u where u.id = auth.uid()),
    auth.uid(),
    coalesce(
      nullif((select u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = auth.uid()), ''),
      split_part(coalesce((select u.email from auth.users u where u.id = auth.uid()), 'Workspace user'), '@', 1)
    )
  );

  return v_reminder;
end;
$$;

create or replace function public.update_reminder_status_secure(
  p_tenant_id uuid,
  p_reminder_id uuid,
  p_status text
)
returns public.reminders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reminder public.reminders%rowtype;
  v_status text := public.m69_6_validate_reminder_status(p_status);
begin
  perform public.m69_6_assert_member_role(
    p_tenant_id,
    array['owner', 'admin', 'staff', 'trainer'],
    'You do not have permission to manage reminders.'
  );

  update public.reminders r
  set status = v_status
  where r.tenant_id = p_tenant_id
    and r.id = p_reminder_id
  returning * into v_reminder;

  if not found then
    raise exception 'Reminder not found in this workspace.' using errcode = '22023';
  end if;

  insert into public.audit_logs (
    action,
    description,
    entity_id,
    entity_name,
    entity_type,
    metadata,
    severity,
    tenant_id,
    user_email,
    user_id,
    user_name
  )
  values (
    case when v_status = 'completed' then 'reminder_completed' else 'reminder_status_updated' end,
    case when v_status = 'completed' then 'Marked reminder as completed' else 'Updated reminder status' end,
    v_reminder.id,
    'Reminder',
    'reminder',
    jsonb_build_object('status', v_reminder.status),
    'info',
    p_tenant_id,
    (select u.email from auth.users u where u.id = auth.uid()),
    auth.uid(),
    coalesce(
      nullif((select u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = auth.uid()), ''),
      split_part(coalesce((select u.email from auth.users u where u.id = auth.uid()), 'Workspace user'), '@', 1)
    )
  );

  return v_reminder;
end;
$$;

create or replace function public.delete_reminder_secure(
  p_tenant_id uuid,
  p_reminder_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reminder public.reminders%rowtype;
begin
  perform public.m69_6_assert_member_role(
    p_tenant_id,
    array['owner', 'admin'],
    'You do not have permission to delete reminders.'
  );

  delete from public.reminders r
  where r.tenant_id = p_tenant_id
    and r.id = p_reminder_id
  returning * into v_reminder;

  if not found then
    raise exception 'Reminder not found in this workspace.' using errcode = '22023';
  end if;

  insert into public.audit_logs (
    action,
    description,
    entity_id,
    entity_name,
    entity_type,
    metadata,
    severity,
    tenant_id,
    user_email,
    user_id,
    user_name
  )
  values (
    'reminder_deleted',
    'Deleted reminder',
    v_reminder.id,
    'Reminder',
    'reminder',
    public.m69_6_sanitize_metadata(jsonb_build_object(
      'dueAt', v_reminder.due_at,
      'status', v_reminder.status,
      'type', v_reminder.reminder_type
    )),
    'warning',
    p_tenant_id,
    (select u.email from auth.users u where u.id = auth.uid()),
    auth.uid(),
    coalesce(
      nullif((select u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = auth.uid()), ''),
      split_part(coalesce((select u.email from auth.users u where u.id = auth.uid()), 'Workspace user'), '@', 1)
    )
  );

  return v_reminder.id;
end;
$$;

create or replace function public.record_audit_event_secure(
  p_tenant_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_entity_name text default null,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_severity text default null
)
returns public.audit_logs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_log public.audit_logs%rowtype;
  v_action text := public.m69_6_safe_text(p_action, 90, 'Audit action');
  v_entity_type text := public.m69_6_safe_text(p_entity_type, 80, 'Audit entity type');
  v_severity text;
begin
  perform public.m69_6_assert_member_role(p_tenant_id);

  if v_action is null then
    raise exception 'Audit action is required.' using errcode = '22023';
  end if;

  if v_entity_type is null then
    raise exception 'Audit entity type is required.' using errcode = '22023';
  end if;

  if v_action !~ '^[a-z0-9_]+$' or v_entity_type !~ '^[a-z0-9_]+$' then
    raise exception 'Audit event contains invalid identifiers.' using errcode = '22023';
  end if;

  v_action := public.m69_6_validate_client_audit_action(v_action);
  v_severity := public.m69_6_infer_audit_severity(v_action);

  if p_severity is not null
     and public.m69_6_current_role(p_tenant_id) in ('owner', 'admin')
     and public.m69_6_validate_severity(p_severity) in ('info', 'warning') then
    v_severity := p_severity;
  end if;

  insert into public.audit_logs (
    action,
    description,
    entity_id,
    entity_name,
    entity_type,
    metadata,
    severity,
    tenant_id,
    user_email,
    user_id,
    user_name
  )
  values (
    v_action,
    public.m69_6_safe_text(p_description, 400, 'Audit description'),
    p_entity_id,
    public.m69_6_safe_text(p_entity_name, 180, 'Audit entity name'),
    v_entity_type,
    public.m69_6_sanitize_metadata(p_metadata),
    v_severity,
    p_tenant_id,
    (select u.email from auth.users u where u.id = auth.uid()),
    auth.uid(),
    coalesce(
      nullif((select u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = auth.uid()), ''),
      split_part(coalesce((select u.email from auth.users u where u.id = auth.uid()), 'Workspace user'), '@', 1)
    )
  )
  returning * into v_log;

  return v_log;
end;
$$;

revoke execute on function public.m69_6_current_role(uuid) from public, anon, authenticated;
revoke execute on function public.m69_6_assert_member_role(uuid, text[], text) from public, anon, authenticated;
revoke execute on function public.m69_6_sanitize_metadata(jsonb) from public, anon, authenticated;
revoke execute on function public.m69_6_safe_text(text, integer, text) from public, anon, authenticated;
revoke execute on function public.m69_6_validate_notification_type(text) from public, anon, authenticated;
revoke execute on function public.m69_6_validate_severity(text) from public, anon, authenticated;
revoke execute on function public.m69_6_validate_reminder_type(text) from public, anon, authenticated;
revoke execute on function public.m69_6_validate_reminder_status(text) from public, anon, authenticated;
revoke execute on function public.m69_6_json_bool(jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function public.m69_6_infer_audit_severity(text) from public, anon, authenticated;
revoke execute on function public.m69_6_validate_client_audit_action(text) from public, anon, authenticated;
revoke execute on function public.m69_6_assert_user_in_tenant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m69_6_assert_reminder_refs(uuid, uuid, uuid, uuid) from public, anon, authenticated;

revoke execute on function public.create_notification_secure(uuid, uuid, text, text, text, text, uuid, text, text, jsonb) from public, anon;
revoke execute on function public.mark_notification_read_secure(uuid, uuid) from public, anon;
revoke execute on function public.archive_notification_secure(uuid, uuid) from public, anon;
revoke execute on function public.ensure_notification_preferences_secure(uuid) from public, anon;
revoke execute on function public.update_notification_preferences_secure(uuid, jsonb) from public, anon;
revoke execute on function public.queue_communication_log_secure(uuid, text, text, text, uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.create_reminder_secure(uuid, text, timestamptz, text, text, uuid, uuid, uuid) from public, anon;
revoke execute on function public.update_reminder_status_secure(uuid, uuid, text) from public, anon;
revoke execute on function public.delete_reminder_secure(uuid, uuid) from public, anon;
revoke execute on function public.record_audit_event_secure(uuid, text, text, uuid, text, text, jsonb, text) from public, anon;

grant execute on function public.create_notification_secure(uuid, uuid, text, text, text, text, uuid, text, text, jsonb) to authenticated;
grant execute on function public.mark_notification_read_secure(uuid, uuid) to authenticated;
grant execute on function public.archive_notification_secure(uuid, uuid) to authenticated;
grant execute on function public.ensure_notification_preferences_secure(uuid) to authenticated;
grant execute on function public.update_notification_preferences_secure(uuid, jsonb) to authenticated;
grant execute on function public.queue_communication_log_secure(uuid, text, text, text, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.create_reminder_secure(uuid, text, timestamptz, text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_reminder_status_secure(uuid, uuid, text) to authenticated;
grant execute on function public.delete_reminder_secure(uuid, uuid) to authenticated;
grant execute on function public.record_audit_event_secure(uuid, text, text, uuid, text, text, jsonb, text) to authenticated;

commit;
