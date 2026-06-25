-- Module 57: Academy-Student Chat
-- Review before execution. Do not run until approved.
--
-- Design:
-- - Reuses conversation_threads, conversation_participants, and conversation_messages.
-- - Does not add student-facing table SELECT policies.
-- - Student access is provided only through SECURITY DEFINER RPCs.
-- - Direct table writes are revoked from authenticated users; writes go through RPCs.

alter table public.conversation_threads
drop constraint if exists conversation_threads_thread_type_check;

alter table public.conversation_threads
add constraint conversation_threads_thread_type_check
check (
  thread_type in (
    'announcement',
    'course_discussion',
    'cohort_discussion',
    'direct_message',
    'staff_note',
    'student_direct',
    'student_support',
    'course_announcement',
    'cohort_announcement'
  )
);

alter table public.conversation_threads
add column if not exists replies_enabled boolean not null default true;

create index if not exists conversation_threads_student_chat_idx
on public.conversation_threads (tenant_id, thread_type, student_id, status, updated_at desc)
where thread_type in ('student_direct', 'student_support', 'course_announcement', 'cohort_announcement');

create index if not exists conversation_messages_thread_created_at_idx
on public.conversation_messages (thread_id, created_at);

grant select on public.conversation_threads to authenticated;
grant select on public.conversation_participants to authenticated;
grant select on public.conversation_messages to authenticated;

revoke insert, update, delete on public.conversation_threads from authenticated;
revoke insert, update, delete on public.conversation_participants from authenticated;
revoke insert, update, delete on public.conversation_messages from authenticated;

create or replace function public.chat_validate_plain_text(
  p_value text,
  p_label text,
  p_required boolean,
  p_max_length integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_value text;
begin
  normalized_value := nullif(trim(coalesce(p_value, '')), '');

  if p_required and normalized_value is null then
    raise exception '% is required.', p_label using errcode = '22023';
  end if;

  if normalized_value is not null and char_length(normalized_value) > p_max_length then
    raise exception '% is too long.', p_label using errcode = '22023';
  end if;

  if normalized_value is not null and (position('<' in normalized_value) > 0 or position('>' in normalized_value) > 0) then
    raise exception '% cannot contain HTML-like characters.', p_label using errcode = '22023';
  end if;

  return normalized_value;
end;
$$;

create or replace function public.chat_current_team_role(p_tenant_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select tm.role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = auth.uid()
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  limit 1;
$$;

create or replace function public.chat_student_context()
returns table (
  tenant_id uuid,
  student_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select spa.tenant_id, spa.student_id
  from public.student_portal_accounts spa
  join public.students s
    on s.id = spa.student_id
   and s.tenant_id = spa.tenant_id
  where spa.user_id = auth.uid()
    and spa.status = 'active'
    and coalesce(s.portal_enabled, true) = true
    and s.status = 'active'
  order by spa.linked_at asc
  limit 1;
$$;

create or replace function public.chat_team_can_access_thread(p_thread_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  thread_row public.conversation_threads%rowtype;
begin
  if actor_id is null then
    return false;
  end if;

  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id;

  if not found then
    return false;
  end if;

  if thread_row.thread_type not in (
    'student_direct',
    'student_support',
    'course_announcement',
    'cohort_announcement'
  ) then
    return false;
  end if;

  actor_role := public.chat_current_team_role(thread_row.tenant_id);

  if actor_role is null then
    return false;
  end if;

  if actor_role in ('owner', 'admin') then
    return true;
  end if;

  if exists (
    select 1
    from public.conversation_participants cp
    where cp.thread_id = thread_row.id
      and cp.tenant_id = thread_row.tenant_id
      and cp.user_id = actor_id
  ) then
    return true;
  end if;

  if thread_row.created_by = actor_id then
    return true;
  end if;

  if actor_role = 'trainer' then
    return coalesce(
      (
        thread_row.course_id is not null
        and exists (
          select 1
          from public.trainer_course_assignments tca
          where tca.tenant_id = thread_row.tenant_id
            and tca.trainer_user_id = actor_id
            and tca.course_id = thread_row.course_id
        )
      )
      or (
        thread_row.cohort_id is not null
        and exists (
          select 1
          from public.trainer_cohort_assignments tca
          where tca.tenant_id = thread_row.tenant_id
            and tca.trainer_user_id = actor_id
            and tca.cohort_id = thread_row.cohort_id
        )
      )
      or (
        thread_row.student_id is not null
        and (
          exists (
            select 1
            from public.enrollments e
            join public.trainer_course_assignments tca
              on tca.tenant_id = e.tenant_id
             and tca.course_id = e.course_id
            where e.tenant_id = thread_row.tenant_id
              and e.student_id = thread_row.student_id
              and tca.trainer_user_id = actor_id
          )
          or exists (
            select 1
            from public.cohort_members cm
            join public.trainer_cohort_assignments tca
              on tca.tenant_id = cm.tenant_id
             and tca.cohort_id = cm.cohort_id
            where cm.tenant_id = thread_row.tenant_id
              and cm.student_id = thread_row.student_id
              and tca.trainer_user_id = actor_id
          )
        )
      ),
      false
    );
  end if;

  return false;
end;
$$;

create or replace function public.chat_team_can_start_student_thread(
  p_tenant_id uuid,
  p_student_id uuid
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
begin
  if actor_id is null then
    return false;
  end if;

  actor_role := public.chat_current_team_role(p_tenant_id);

  if actor_role in ('owner', 'admin') then
    return true;
  end if;

  if actor_role = 'trainer' then
    return coalesce(
      exists (
        select 1
        from public.enrollments e
        join public.trainer_course_assignments tca
          on tca.tenant_id = e.tenant_id
         and tca.course_id = e.course_id
        where e.tenant_id = p_tenant_id
          and e.student_id = p_student_id
          and tca.trainer_user_id = actor_id
      )
      or exists (
        select 1
        from public.cohort_members cm
        join public.trainer_cohort_assignments tca
          on tca.tenant_id = cm.tenant_id
         and tca.cohort_id = cm.cohort_id
        where cm.tenant_id = p_tenant_id
          and cm.student_id = p_student_id
          and tca.trainer_user_id = actor_id
      ),
      false
    );
  end if;

  return false;
end;
$$;

create or replace function public.chat_student_can_access_thread(p_thread_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  ctx record;
  thread_row public.conversation_threads%rowtype;
begin
  select *
  into ctx
  from public.chat_student_context()
  limit 1;

  if ctx.student_id is null then
    return false;
  end if;

  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id
    and tenant_id = ctx.tenant_id
    and status <> 'archived';

  if not found then
    return false;
  end if;

  if thread_row.thread_type in ('student_direct', 'student_support') then
    return thread_row.student_id = ctx.student_id;
  end if;

  if thread_row.thread_type = 'course_announcement' then
    return coalesce(
      thread_row.course_id is not null
      and exists (
        select 1
        from public.enrollments e
        where e.tenant_id = ctx.tenant_id
          and e.student_id = ctx.student_id
          and e.course_id = thread_row.course_id
          and e.status in ('active', 'completed')
      ),
      false
    );
  end if;

  if thread_row.thread_type = 'cohort_announcement' then
    return coalesce(
      thread_row.cohort_id is not null
      and exists (
        select 1
        from public.cohort_members cm
        where cm.tenant_id = ctx.tenant_id
          and cm.student_id = ctx.student_id
          and cm.cohort_id = thread_row.cohort_id
      ),
      false
    );
  end if;

  return false;
end;
$$;

create or replace function public.chat_insert_audit(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_thread_id uuid,
  p_student_id uuid,
  p_sender_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    entity_id,
    entity_name,
    description,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    p_actor_user_id,
    p_action,
    'conversation_thread',
    p_thread_id,
    'Academy-student chat',
    'Academy-student chat event recorded.',
    'info',
    jsonb_build_object(
      'thread_id', p_thread_id,
      'student_id', p_student_id,
      'sender_type', p_sender_type,
      'message_present', p_action in ('chat_message_sent', 'student_support_thread_created')
    )
  );
end;
$$;

create or replace function public.chat_thread_json(p_thread_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', ct.id,
    'tenant_id', ct.tenant_id,
    'thread_type', ct.thread_type,
    'title', ct.title,
    'description', ct.description,
    'course_id', ct.course_id,
    'cohort_id', ct.cohort_id,
    'student_id', ct.student_id,
    'created_by', ct.created_by,
    'status', ct.status,
    'replies_enabled', ct.replies_enabled,
    'created_at', ct.created_at,
    'updated_at', ct.updated_at,
    'student_name', s.full_name,
    'course_title', c.title,
    'cohort_name', co.name,
    'recent_message', (
      select cm.message
      from public.conversation_messages cm
      where cm.thread_id = ct.id
        and cm.status <> 'deleted'
      order by cm.created_at desc
      limit 1
    ),
    'recent_message_at', (
      select cm.created_at
      from public.conversation_messages cm
      where cm.thread_id = ct.id
        and cm.status <> 'deleted'
      order by cm.created_at desc
      limit 1
    )
  )
  from public.conversation_threads ct
  left join public.students s
    on s.id = ct.student_id
   and s.tenant_id = ct.tenant_id
  left join public.courses c
    on c.id = ct.course_id
   and c.tenant_id = ct.tenant_id
  left join public.cohorts co
    on co.id = ct.cohort_id
   and co.tenant_id = ct.tenant_id
  where ct.id = p_thread_id;
$$;

create or replace function public.chat_messages_json(p_thread_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cm.id,
        'thread_id', cm.thread_id,
        'tenant_id', cm.tenant_id,
        'sender_user_id', cm.sender_user_id,
        'sender_student_id', cm.sender_student_id,
        'sender_type', case
          when cm.sender_student_id is not null then 'student'
          when cm.sender_user_id is not null then 'team'
          else 'system'
        end,
        'message', cm.message,
        'message_type', cm.message_type,
        'status', cm.status,
        'created_at', cm.created_at,
        'edited_at', cm.edited_at,
        'deleted_at', cm.deleted_at
      )
      order by cm.created_at asc
    ),
    '[]'::jsonb
  )
  from public.conversation_messages cm
  where cm.thread_id = p_thread_id
    and cm.status <> 'deleted';
$$;

create or replace function public.get_team_chat_threads(p_tenant_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case
    when public.chat_current_team_role(p_tenant_id) is null then
      jsonb_build_object('threads', '[]'::jsonb)
    else
      jsonb_build_object(
        'threads',
        coalesce(
          jsonb_agg(public.chat_thread_json(ct.id) order by ct.updated_at desc),
          '[]'::jsonb
        )
      )
    end
  from public.conversation_threads ct
  where ct.tenant_id = p_tenant_id
    and ct.thread_type in ('student_direct', 'student_support', 'course_announcement', 'cohort_announcement')
    and ct.status <> 'archived'
    and public.chat_team_can_access_thread(ct.id);
$$;

create or replace function public.get_team_chat_thread(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not coalesce(public.chat_team_can_access_thread(p_thread_id), false) then
    raise exception 'Chat thread access denied.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'thread', public.chat_thread_json(p_thread_id),
    'messages', public.chat_messages_json(p_thread_id)
  );
end;
$$;

create or replace function public.get_student_chat_threads()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with ctx as (
    select *
    from public.chat_student_context()
    limit 1
  )
  select jsonb_build_object(
    'threads',
    coalesce(
      jsonb_agg(public.chat_thread_json(ct.id) order by ct.updated_at desc),
      '[]'::jsonb
    )
  )
  from ctx
  join public.conversation_threads ct
    on ct.tenant_id = ctx.tenant_id
   and ct.status <> 'archived'
   and public.chat_student_can_access_thread(ct.id);
$$;

create or replace function public.get_student_chat_thread(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not coalesce(public.chat_student_can_access_thread(p_thread_id), false) then
    raise exception 'Student chat thread access denied.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'thread', public.chat_thread_json(p_thread_id),
    'messages', public.chat_messages_json(p_thread_id)
  );
end;
$$;

create or replace function public.add_default_team_chat_participants(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_actor_user_id uuid,
  p_student_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversation_participants (tenant_id, thread_id, user_id, role, last_read_at)
  select p_tenant_id, p_thread_id, tm.user_id, tm.role, now()
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and (tm.role in ('owner', 'admin') or tm.user_id = p_actor_user_id)
  on conflict do nothing;

  if p_student_id is not null then
    insert into public.conversation_participants (tenant_id, thread_id, student_id, role)
    values (p_tenant_id, p_thread_id, p_student_id, 'student')
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.create_student_direct_chat(
  p_tenant_id uuid,
  p_student_id uuid,
  p_title text,
  p_initial_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_title text;
  normalized_message text;
  thread_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  normalized_title := public.chat_validate_plain_text(p_title, 'Title', true, 180);
  normalized_message := public.chat_validate_plain_text(p_initial_message, 'Message', true, 4000);

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.tenant_id = p_tenant_id
      and s.status = 'active'
  ) then
    raise exception 'Active student was not found in this tenant.' using errcode = '22023';
  end if;

  if not coalesce(public.chat_team_can_start_student_thread(p_tenant_id, p_student_id), false) then
    raise exception 'You do not have permission to start a chat with this student.' using errcode = '42501';
  end if;

  insert into public.conversation_threads (
    tenant_id,
    thread_type,
    title,
    student_id,
    created_by,
    status,
    replies_enabled
  )
  values (
    p_tenant_id,
    'student_direct',
    normalized_title,
    p_student_id,
    actor_id,
    'active',
    true
  )
  returning id into thread_id;

  perform public.add_default_team_chat_participants(p_tenant_id, thread_id, actor_id, p_student_id);

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_user_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    p_tenant_id,
    thread_id,
    actor_id,
    normalized_message,
    'text',
    'sent',
    '{}'::jsonb
  );

  update public.conversation_threads
  set updated_at = now()
  where id = thread_id;

  perform public.chat_insert_audit(p_tenant_id, actor_id, 'chat_thread_created', thread_id, p_student_id, 'team');
  perform public.chat_insert_audit(p_tenant_id, actor_id, 'chat_message_sent', thread_id, p_student_id, 'team');

  return thread_id;
end;
$$;

create or replace function public.create_student_support_thread(
  p_title text,
  p_initial_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  normalized_title text;
  normalized_message text;
  thread_id uuid;
begin
  select *
  into ctx
  from public.chat_student_context()
  limit 1;

  if ctx.student_id is null then
    raise exception 'Active student portal account required.' using errcode = '42501';
  end if;

  normalized_title := public.chat_validate_plain_text(p_title, 'Title', true, 180);
  normalized_message := public.chat_validate_plain_text(p_initial_message, 'Message', true, 4000);

  insert into public.conversation_threads (
    tenant_id,
    thread_type,
    title,
    student_id,
    status,
    replies_enabled
  )
  values (
    ctx.tenant_id,
    'student_support',
    normalized_title,
    ctx.student_id,
    'active',
    true
  )
  returning id into thread_id;

  perform public.add_default_team_chat_participants(ctx.tenant_id, thread_id, null, ctx.student_id);

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_student_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    ctx.tenant_id,
    thread_id,
    ctx.student_id,
    normalized_message,
    'text',
    'sent',
    '{}'::jsonb
  );

  update public.conversation_threads
  set updated_at = now()
  where id = thread_id;

  perform public.chat_insert_audit(ctx.tenant_id, null, 'student_support_thread_created', thread_id, ctx.student_id, 'student');

  return thread_id;
end;
$$;

create or replace function public.send_team_chat_message(
  p_thread_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  thread_row public.conversation_threads%rowtype;
  normalized_body text;
  message_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not coalesce(public.chat_team_can_access_thread(p_thread_id), false) then
    raise exception 'Chat thread access denied.' using errcode = '42501';
  end if;

  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id;

  if thread_row.status <> 'active' then
    raise exception 'This chat thread is closed.' using errcode = '22023';
  end if;

  normalized_body := public.chat_validate_plain_text(p_body, 'Message', true, 4000);

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_user_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    thread_row.tenant_id,
    thread_row.id,
    actor_id,
    normalized_body,
    case when thread_row.thread_type in ('course_announcement', 'cohort_announcement') then 'announcement' else 'text' end,
    'sent',
    '{}'::jsonb
  )
  returning id into message_id;

  update public.conversation_threads
  set updated_at = now()
  where id = thread_row.id;

  insert into public.conversation_participants (tenant_id, thread_id, user_id, role, last_read_at)
  values (thread_row.tenant_id, thread_row.id, actor_id, public.chat_current_team_role(thread_row.tenant_id), now())
  on conflict do nothing;

  perform public.chat_insert_audit(thread_row.tenant_id, actor_id, 'chat_message_sent', thread_row.id, thread_row.student_id, 'team');

  return message_id;
end;
$$;

create or replace function public.send_student_chat_message(
  p_thread_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
  thread_row public.conversation_threads%rowtype;
  normalized_body text;
  message_id uuid;
begin
  select *
  into ctx
  from public.chat_student_context()
  limit 1;

  if ctx.student_id is null then
    raise exception 'Active student portal account required.' using errcode = '42501';
  end if;

  if not coalesce(public.chat_student_can_access_thread(p_thread_id), false) then
    raise exception 'Student chat thread access denied.' using errcode = '42501';
  end if;

  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id
    and tenant_id = ctx.tenant_id;

  if thread_row.status <> 'active' then
    raise exception 'This chat thread is closed.' using errcode = '22023';
  end if;

  if not coalesce(thread_row.replies_enabled, false) then
    raise exception 'Replies are disabled for this thread.' using errcode = '42501';
  end if;

  if thread_row.thread_type not in ('student_direct', 'student_support') then
    raise exception 'Students cannot reply to announcement threads.' using errcode = '42501';
  end if;

  normalized_body := public.chat_validate_plain_text(p_body, 'Message', true, 4000);

  insert into public.conversation_messages (
    tenant_id,
    thread_id,
    sender_student_id,
    message,
    message_type,
    status,
    metadata_json
  )
  values (
    thread_row.tenant_id,
    thread_row.id,
    ctx.student_id,
    normalized_body,
    'text',
    'sent',
    '{}'::jsonb
  )
  returning id into message_id;

  update public.conversation_threads
  set updated_at = now()
  where id = thread_row.id;

  insert into public.conversation_participants (tenant_id, thread_id, student_id, role, last_read_at)
  values (thread_row.tenant_id, thread_row.id, ctx.student_id, 'student', now())
  on conflict do nothing;

  perform public.chat_insert_audit(thread_row.tenant_id, null, 'chat_message_sent', thread_row.id, ctx.student_id, 'student');

  return message_id;
end;
$$;

create or replace function public.close_chat_thread(p_thread_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  thread_row public.conversation_threads%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id;

  if not found then
    raise exception 'Chat thread not found.' using errcode = '22023';
  end if;

  if thread_row.thread_type not in (
    'student_direct',
    'student_support',
    'course_announcement',
    'cohort_announcement'
  ) then
    raise exception 'This RPC can only close student-facing chat threads.' using errcode = '42501';
  end if;

  if not coalesce(public.chat_team_can_access_thread(p_thread_id), false) then
    raise exception 'Chat thread access denied.' using errcode = '42501';
  end if;

  actor_role := public.chat_current_team_role(thread_row.tenant_id);

  if actor_role not in ('owner', 'admin') and thread_row.created_by <> actor_id then
    raise exception 'Only owner/admin users or the thread creator can close this chat.' using errcode = '42501';
  end if;

  update public.conversation_threads
  set status = 'locked',
      updated_at = now()
  where id = thread_row.id;

  perform public.chat_insert_audit(thread_row.tenant_id, actor_id, 'chat_thread_closed', thread_row.id, thread_row.student_id, 'team');

  return thread_row.id;
end;
$$;

create or replace function public.mark_chat_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  ctx record;
  thread_row public.conversation_threads%rowtype;
begin
  select *
  into thread_row
  from public.conversation_threads
  where id = p_thread_id;

  if not found then
    return;
  end if;

  if actor_id is not null and coalesce(public.chat_team_can_access_thread(p_thread_id), false) then
    insert into public.conversation_participants (tenant_id, thread_id, user_id, role, last_read_at)
    values (thread_row.tenant_id, thread_row.id, actor_id, public.chat_current_team_role(thread_row.tenant_id), now())
    on conflict (thread_id, user_id) where user_id is not null
    do update set last_read_at = excluded.last_read_at;
    return;
  end if;

  select *
  into ctx
  from public.chat_student_context()
  limit 1;

  if ctx.student_id is not null and coalesce(public.chat_student_can_access_thread(p_thread_id), false) then
    insert into public.conversation_participants (tenant_id, thread_id, student_id, role, last_read_at)
    values (thread_row.tenant_id, thread_row.id, ctx.student_id, 'student', now())
    on conflict (thread_id, student_id) where student_id is not null
    do update set last_read_at = excluded.last_read_at;
  end if;
end;
$$;

revoke all on function public.chat_validate_plain_text(text, text, boolean, integer) from public;
revoke all on function public.chat_current_team_role(uuid) from public;
revoke all on function public.chat_student_context() from public;
revoke all on function public.chat_team_can_access_thread(uuid) from public;
revoke all on function public.chat_team_can_start_student_thread(uuid, uuid) from public;
revoke all on function public.chat_student_can_access_thread(uuid) from public;
revoke all on function public.chat_insert_audit(uuid, uuid, text, uuid, uuid, text) from public;
revoke all on function public.chat_thread_json(uuid) from public;
revoke all on function public.chat_messages_json(uuid) from public;
revoke all on function public.add_default_team_chat_participants(uuid, uuid, uuid, uuid) from public;

revoke all on function public.get_team_chat_threads(uuid) from public;
revoke all on function public.get_team_chat_thread(uuid) from public;
revoke all on function public.get_student_chat_threads() from public;
revoke all on function public.get_student_chat_thread(uuid) from public;
revoke all on function public.create_student_direct_chat(uuid, uuid, text, text) from public;
revoke all on function public.create_student_support_thread(text, text) from public;
revoke all on function public.send_team_chat_message(uuid, text) from public;
revoke all on function public.send_student_chat_message(uuid, text) from public;
revoke all on function public.close_chat_thread(uuid) from public;
revoke all on function public.mark_chat_thread_read(uuid) from public;

grant execute on function public.get_team_chat_threads(uuid) to authenticated;
grant execute on function public.get_team_chat_thread(uuid) to authenticated;
grant execute on function public.get_student_chat_threads() to authenticated;
grant execute on function public.get_student_chat_thread(uuid) to authenticated;
grant execute on function public.create_student_direct_chat(uuid, uuid, text, text) to authenticated;
grant execute on function public.create_student_support_thread(text, text) to authenticated;
grant execute on function public.send_team_chat_message(uuid, text) to authenticated;
grant execute on function public.send_student_chat_message(uuid, text) to authenticated;
grant execute on function public.close_chat_thread(uuid) to authenticated;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;
