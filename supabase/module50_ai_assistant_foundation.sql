-- Module 50: AI Assistant foundation
-- Additive only. Run after Module 49 mobile API readiness.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  scope text not null check (scope in ('team', 'student')),
  title text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(content) <= 8000)
);

create table if not exists public.ai_request_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  scope text not null check (scope in ('team', 'student')),
  provider text not null default 'mock',
  status text not null check (status in ('success', 'failed', 'blocked')),
  prompt_char_count integer,
  response_char_count integer,
  context_summary_json jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  check (prompt_char_count is null or prompt_char_count >= 0),
  check (response_char_count is null or response_char_count >= 0)
);

create index if not exists ai_conversations_tenant_user_idx
on public.ai_conversations (tenant_id, user_id, created_at desc);

create index if not exists ai_conversations_student_idx
on public.ai_conversations (tenant_id, student_id, created_at desc);

create index if not exists ai_messages_conversation_idx
on public.ai_messages (conversation_id, created_at asc);

create index if not exists ai_request_logs_tenant_created_at_idx
on public.ai_request_logs (tenant_id, created_at desc);

create index if not exists ai_request_logs_tenant_user_idx
on public.ai_request_logs (tenant_id, user_id, created_at desc);

drop trigger if exists set_ai_conversations_updated_at on public.ai_conversations;
create trigger set_ai_conversations_updated_at
before update on public.ai_conversations
for each row execute function public.set_updated_at();

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_request_logs enable row level security;

revoke all on public.ai_conversations from anon;
revoke all on public.ai_messages from anon;
revoke all on public.ai_request_logs from anon;

revoke insert, update, delete on public.ai_conversations from authenticated;
revoke insert, update, delete on public.ai_messages from authenticated;
revoke insert, update, delete on public.ai_request_logs from authenticated;

grant select on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;
grant select on public.ai_request_logs to authenticated;

drop policy if exists "Users can read own AI conversations" on public.ai_conversations;
create policy "Users can read own AI conversations"
on public.ai_conversations
for select
to authenticated
using (
  user_id = auth.uid()
  and (
    (
      scope = 'team'
      and student_id is null
      and public.is_tenant_member(tenant_id, auth.uid())
    )
    or (
      scope = 'student'
      and exists (
        select 1
        from public.student_portal_accounts spa
        join public.students s
          on s.id = spa.student_id
         and s.tenant_id = spa.tenant_id
        where spa.tenant_id = ai_conversations.tenant_id
          and spa.student_id = ai_conversations.student_id
          and spa.user_id = auth.uid()
          and spa.status = 'active'
          and coalesce(s.portal_enabled, true) = true
          and s.status = 'active'
      )
    )
  )
);

drop policy if exists "Users can read own AI messages" on public.ai_messages;
create policy "Users can read own AI messages"
on public.ai_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.ai_conversations c
    where c.id = ai_messages.conversation_id
      and c.tenant_id = ai_messages.tenant_id
      and c.user_id = auth.uid()
      and (
        (
          c.scope = 'team'
          and c.student_id is null
          and public.is_tenant_member(c.tenant_id, auth.uid())
        )
        or (
          c.scope = 'student'
          and exists (
            select 1
            from public.student_portal_accounts spa
            join public.students s
              on s.id = spa.student_id
             and s.tenant_id = spa.tenant_id
            where spa.tenant_id = c.tenant_id
              and spa.student_id = c.student_id
              and spa.user_id = auth.uid()
              and spa.status = 'active'
              and coalesce(s.portal_enabled, true) = true
              and s.status = 'active'
          )
        )
      )
  )
);

drop policy if exists "Users can read own AI request logs" on public.ai_request_logs;
create policy "Users can read own AI request logs"
on public.ai_request_logs
for select
to authenticated
using (
  user_id = auth.uid()
  and (
    public.is_tenant_member(tenant_id, auth.uid())
    or exists (
      select 1
      from public.student_portal_accounts spa
      join public.students s
        on s.id = spa.student_id
       and s.tenant_id = spa.tenant_id
      where spa.tenant_id = ai_request_logs.tenant_id
        and spa.student_id = ai_request_logs.student_id
        and spa.user_id = auth.uid()
        and spa.status = 'active'
        and coalesce(s.portal_enabled, true) = true
        and s.status = 'active'
    )
  )
);

create or replace function public.record_ai_assistant_exchange(
  p_tenant_id uuid,
  p_scope text,
  p_student_id uuid,
  p_conversation_id uuid,
  p_user_message text,
  p_assistant_message text,
  p_provider text,
  p_status text,
  p_prompt_char_count integer,
  p_response_char_count integer,
  p_context_summary_json jsonb,
  p_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  resolved_conversation_id uuid;
  normalized_user_message text := trim(coalesce(p_user_message, ''));
  normalized_assistant_message text := trim(coalesce(p_assistant_message, ''));
  normalized_provider text := coalesce(nullif(trim(p_provider), ''), 'mock');
  normalized_error_code text := nullif(trim(coalesce(p_error_code, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if p_scope not in ('team', 'student') then
    raise exception 'Invalid assistant scope.' using errcode = '22023';
  end if;

  if p_status not in ('success', 'failed', 'blocked') then
    raise exception 'Invalid assistant status.' using errcode = '22023';
  end if;

  if char_length(normalized_user_message) = 0 or char_length(normalized_user_message) > 2000 then
    raise exception 'Invalid assistant message length.' using errcode = '22023';
  end if;

  if normalized_assistant_message <> '' and char_length(normalized_assistant_message) > 8000 then
    raise exception 'Assistant response is too long to store.' using errcode = '22023';
  end if;

  if p_prompt_char_count is not null
     and (p_prompt_char_count < 0 or p_prompt_char_count > 2000) then
    raise exception 'Invalid assistant prompt character count.' using errcode = '22023';
  end if;

  if p_response_char_count is not null
     and (p_response_char_count < 0 or p_response_char_count > 8000) then
    raise exception 'Invalid assistant response character count.' using errcode = '22023';
  end if;

  if char_length(normalized_provider) > 50 then
    raise exception 'Assistant provider value is too long.' using errcode = '22023';
  end if;

  if normalized_error_code is not null and char_length(normalized_error_code) > 100 then
    raise exception 'Assistant error code is too long.' using errcode = '22023';
  end if;

  if p_context_summary_json is not null
     and jsonb_typeof(p_context_summary_json) <> 'object' then
    raise exception 'Assistant context summary must be a JSON object.' using errcode = '22023';
  end if;

  if p_context_summary_json is not null
     and char_length(p_context_summary_json::text) > 4000 then
    raise exception 'Assistant context summary is too large.' using errcode = '22023';
  end if;

  if p_scope = 'team' then
    if p_student_id is not null or not public.is_tenant_member(p_tenant_id, actor_id) then
      raise exception 'Team assistant access denied.' using errcode = '42501';
    end if;
  else
    if p_student_id is null or not exists (
      select 1
      from public.student_portal_accounts spa
      join public.students s
        on s.id = spa.student_id
       and s.tenant_id = spa.tenant_id
      where spa.tenant_id = p_tenant_id
        and spa.student_id = p_student_id
        and spa.user_id = actor_id
        and spa.status = 'active'
        and coalesce(s.portal_enabled, true) = true
        and s.status = 'active'
    ) then
      raise exception 'Student assistant access denied.' using errcode = '42501';
    end if;
  end if;

  if p_conversation_id is not null then
    select c.id
    into resolved_conversation_id
    from public.ai_conversations c
    where c.id = p_conversation_id
      and c.tenant_id = p_tenant_id
      and c.user_id = actor_id
      and c.scope = p_scope
      and c.status = 'active'
      and (
        (p_scope = 'team' and c.student_id is null)
        or (p_scope = 'student' and c.student_id = p_student_id)
      );

    if resolved_conversation_id is null then
      raise exception 'AI conversation not found.' using errcode = '42501';
    end if;
  else
    insert into public.ai_conversations (
      tenant_id,
      user_id,
      student_id,
      scope,
      title
    )
    values (
      p_tenant_id,
      actor_id,
      case when p_scope = 'student' then p_student_id else null end,
      p_scope,
      left(normalized_user_message, 80)
    )
    returning id into resolved_conversation_id;
  end if;

  insert into public.ai_messages (
    conversation_id,
    tenant_id,
    user_id,
    role,
    content,
    metadata_json
  )
  values (
    resolved_conversation_id,
    p_tenant_id,
    actor_id,
    'user',
    normalized_user_message,
    jsonb_build_object('scope', p_scope)
  );

  if normalized_assistant_message <> '' then
    insert into public.ai_messages (
      conversation_id,
      tenant_id,
      user_id,
      role,
      content,
      metadata_json
    )
    values (
      resolved_conversation_id,
      p_tenant_id,
      actor_id,
      'assistant',
      normalized_assistant_message,
      jsonb_build_object(
        'provider', normalized_provider,
        'scope', p_scope
      )
    );
  end if;

  insert into public.ai_request_logs (
    tenant_id,
    user_id,
    student_id,
    scope,
    provider,
    status,
    prompt_char_count,
    response_char_count,
    context_summary_json,
    error_code
  )
  values (
    p_tenant_id,
    actor_id,
    case when p_scope = 'student' then p_student_id else null end,
    p_scope,
    normalized_provider,
    p_status,
    p_prompt_char_count,
    p_response_char_count,
    case
      when p_context_summary_json is null or jsonb_typeof(p_context_summary_json) <> 'object'
        then '{}'::jsonb
      else p_context_summary_json
    end,
    normalized_error_code
  );

  return resolved_conversation_id;
end;
$$;

revoke execute on function public.record_ai_assistant_exchange(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  integer,
  integer,
  jsonb,
  text
) from public;

grant execute on function public.record_ai_assistant_exchange(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  integer,
  integer,
  jsonb,
  text
) to authenticated;
