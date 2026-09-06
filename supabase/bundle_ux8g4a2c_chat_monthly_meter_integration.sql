-- Bundle UX-8G4A2C1: Chat monthly meter integration.
-- Review before execution. This file has not been executed by Codex.

/* PRE-APPLY READ-ONLY VERIFICATION
with expected_old(identity) as (
  values
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'),
    ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)')
), expected_new(identity) as (
  values
    ('public.create_student_direct_chat(uuid,uuid,text,text,uuid)'),
    ('public.create_student_support_thread(text,text,uuid)'),
    ('public.send_team_chat_message(uuid,text,uuid)'),
    ('public.send_student_chat_message(uuid,text,uuid)')
), old_functions as (
  select
    expected.identity,
    procedure.oid,
    procedure.prosecdef,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')) source
  from expected_old expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), required_message_columns(column_name) as (
  values
    ('id'), ('tenant_id'), ('thread_id'), ('sender_user_id'),
    ('sender_student_id'), ('message'), ('message_type'), ('status'),
    ('metadata_json'), ('created_at'), ('edited_at'), ('deleted_at')
), chat_writers as (
  select procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and lower(procedure.prosrc) like '%insert into public.conversation_messages%'
), browser_dml as (
  select count(*) grant_count
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) acl
  left join pg_catalog.pg_roles role on role.oid = acl.grantee
  where namespace.nspname = 'public'
    and class.relname in (
      'conversation_threads', 'conversation_participants', 'conversation_messages'
    )
    and coalesce(role.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')
    and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), old_function_acl as (
  select
    count(*) filter (
      where old_function.oid is not null
        and has_function_privilege('authenticated', old_function.oid, 'EXECUTE')
    ) authenticated_execute,
    count(*) filter (
      where old_function.oid is not null
        and has_function_privilege('anon', old_function.oid, 'EXECUTE')
    ) anon_execute,
    count(*) filter (
      where old_function.oid is not null
        and has_function_privilege('service_role', old_function.oid, 'EXECUTE')
    ) service_execute,
    count(*) filter (
      where exists (
        select 1
        from pg_catalog.pg_proc procedure
        cross join lateral aclexplode(
          coalesce(procedure.proacl, acldefault('f', procedure.proowner))
        ) acl
        where procedure.oid = old_function.oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ) public_execute
  from old_functions old_function
), counts as (
  select
    (select count(*) from public.conversation_threads) conversation_threads,
    (select count(*) from public.conversation_participants) conversation_participants,
    (select count(*) from public.conversation_messages) conversation_messages,
    (select count(*) from coachfort_internal.monthly_usage_counters) monthly_usage_counters,
    (select count(*) from coachfort_internal.monthly_usage_consumption_events) monthly_usage_events
), gates as (
  select
    to_regclass('public.conversation_threads') is not null
      and to_regclass('public.conversation_participants') is not null
      and to_regclass('public.conversation_messages') is not null table_gate,
    to_regprocedure(
      'coachfort_internal.assert_effective_operational_feature(uuid,text)'
    ) is not null a2a_feature_authority,
    to_regprocedure(
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    ) is not null a2b_meter_authority,
    (
      select count(*) = 12
      from required_message_columns required
      join information_schema.columns column_row
        on column_row.table_schema = 'public'
       and column_row.table_name = 'conversation_messages'
       and column_row.column_name = required.column_name
    ) message_schema_gate,
    (select count(*) = 4 from old_functions where oid is not null)
      old_identity_gate,
    (select coalesce(bool_and(
      prosecdef
      and owner_name = 'postgres'
      and source like '%assert_effective_operational_feature%'
      and source like '%''messages''%'
    ), false) from old_functions where oid is not null) old_authority_gate,
    (select count(*) = 4 from chat_writers) exact_writer_gate,
    (select grant_count = 0 from browser_dml) browser_write_gate,
    (
      select authenticated_execute = 4
        and anon_execute = 0
        and service_execute = 0
        and public_execute = 0
      from old_function_acl
    ) old_acl_gate,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_messages'
        and column_name = 'request_id'
    ) request_column_absent,
    to_regclass('public.conversation_messages_tenant_request_unique_idx') is null
      request_index_absent,
    to_regprocedure('coachfort_internal.chat_request_lock(uuid,uuid)') is null
      and to_regprocedure(
        'coachfort_internal.enforce_chat_request_id_immutability()'
      ) is null request_helpers_absent,
    not exists (
      select 1 from pg_catalog.pg_trigger trigger
      where trigger.tgrelid = 'public.conversation_messages'::regclass
        and trigger.tgname = 'conversation_messages_request_id_immutable'
        and not trigger.tgisinternal
    ) request_trigger_absent,
    not exists (
      select 1 from expected_new
      where to_regprocedure(identity) is not null
    ) new_overloads_absent
)
select
  gates.*,
  counts.*,
  (select jsonb_agg(identity order by identity) from chat_writers) chat_writer_identities,
  (
    table_gate
    and a2a_feature_authority
    and a2b_meter_authority
    and message_schema_gate
    and old_identity_gate
    and old_authority_gate
    and exact_writer_gate
    and browser_write_gate
    and old_acl_gate
    and request_column_absent
    and request_index_absent
    and request_helpers_absent
    and request_trigger_absent
    and new_overloads_absent
  ) ready_for_apply
from gates cross join counts;
*/

begin;

do $$
declare
  v_old_identity text;
  v_old_identities constant text[] := array[
    'public.create_student_direct_chat(uuid,uuid,text,text)',
    'public.create_student_support_thread(text,text)',
    'public.send_team_chat_message(uuid,text)',
    'public.send_student_chat_message(uuid,text)'
  ];
  v_new_identities constant text[] := array[
    'public.create_student_direct_chat(uuid,uuid,text,text,uuid)',
    'public.create_student_support_thread(text,text,uuid)',
    'public.send_team_chat_message(uuid,text,uuid)',
    'public.send_student_chat_message(uuid,text,uuid)'
  ];
  v_identity text;
begin
  if to_regclass('public.conversation_threads') is null
     or to_regclass('public.conversation_participants') is null
     or to_regclass('public.conversation_messages') is null then
    raise exception 'UX-8G4A2C requires the canonical Chat tables.';
  end if;

  if to_regprocedure(
       'coachfort_internal.assert_effective_operational_feature(uuid,text)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
     ) is null then
    raise exception 'UX-8G4A2C requires the UX-8G4A2A and UX-8G4A2B authorities.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_messages'
      and column_name = 'request_id'
  )
  or to_regclass('public.conversation_messages_tenant_request_unique_idx') is not null
  or to_regprocedure('coachfort_internal.chat_request_lock(uuid,uuid)') is not null
  or to_regprocedure(
    'coachfort_internal.enforce_chat_request_id_immutability()'
  ) is not null
  or exists (
    select 1 from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.conversation_messages'::regclass
      and trigger.tgname = 'conversation_messages_request_id_immutable'
      and not trigger.tgisinternal
  ) then
    raise exception 'UX-8G4A2C request authority is already or partially installed.';
  end if;

  foreach v_identity in array v_new_identities loop
    if to_regprocedure(v_identity) is not null then
      raise exception 'UX-8G4A2C overload already exists: %', v_identity;
    end if;
  end loop;

  foreach v_old_identity in array v_old_identities loop
    if to_regprocedure(v_old_identity) is null then
      raise exception 'Required Chat RPC identity is missing: %', v_old_identity;
    end if;

    if lower(pg_get_functiondef(to_regprocedure(v_old_identity)))
         not like '%assert_effective_operational_feature%'
       or lower(pg_get_functiondef(to_regprocedure(v_old_identity)))
         not like '%''messages''%' then
      raise exception 'Chat feature authority drifted: %', v_old_identity;
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and lower(procedure.prosrc) like '%insert into public.conversation_messages%'
  ) <> 4 then
    raise exception 'Active Chat message-writer inventory drifted.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(
      coalesce(class.relacl, acldefault('r', class.relowner))
    ) acl
    left join pg_catalog.pg_roles role on role.oid = acl.grantee
    where namespace.nspname = 'public'
      and class.relname in (
        'conversation_threads', 'conversation_participants', 'conversation_messages'
      )
      and coalesce(role.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')
      and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Browser Chat table-write authority must remain absent.';
  end if;
end
$$;

alter table public.conversation_messages
  add column request_id uuid;

comment on column public.conversation_messages.request_id is
  'Durable client request UUID for an idempotent logical Chat message action.';

create unique index conversation_messages_tenant_request_unique_idx
  on public.conversation_messages (tenant_id, request_id)
  where request_id is not null;

create function coachfort_internal.chat_request_lock(
  p_tenant_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null or p_request_id is null then
    raise exception 'A valid Chat request id is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'chat_request:' || p_tenant_id::text || ':' || p_request_id::text,
    8423
  ));
end;
$$;

create function coachfort_internal.enforce_chat_request_id_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.request_id is distinct from old.request_id then
    raise exception 'Chat request identity is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger conversation_messages_request_id_immutable
before update of request_id on public.conversation_messages
for each row execute function
  coachfort_internal.enforce_chat_request_id_immutability();

create function public.create_student_direct_chat(
  p_tenant_id uuid,
  p_student_id uuid,
  p_title text,
  p_initial_message text,
  p_request_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_title text;
  normalized_message text;
  thread_id uuid;
  existing_message public.conversation_messages%rowtype;
  existing_thread public.conversation_threads%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  normalized_title := public.chat_validate_plain_text(
    p_title, 'Title', true, 180
  );
  normalized_message := public.chat_validate_plain_text(
    p_initial_message, 'Message', true, 4000
  );

  if not exists (
    select 1 from public.students student
    where student.id = p_student_id
      and student.tenant_id = p_tenant_id
      and student.status = 'active'
  ) then
    raise exception 'Active student was not found in this tenant.'
      using errcode = '22023';
  end if;

  if not coalesce(
    public.chat_team_can_start_student_thread(p_tenant_id, p_student_id), false
  ) then
    raise exception 'You do not have permission to start a chat with this student.'
      using errcode = '42501';
  end if;

  perform coachfort_internal.assert_effective_operational_feature(
    p_tenant_id, 'messages'
  );
  perform coachfort_internal.chat_request_lock(p_tenant_id, p_request_id);

  select message.* into existing_message
  from public.conversation_messages message
  where message.tenant_id = p_tenant_id
    and message.request_id = p_request_id;

  if found then
    select thread.* into existing_thread
    from public.conversation_threads thread
    where thread.id = existing_message.thread_id
      and thread.tenant_id = p_tenant_id;

    if not found
       or existing_message.sender_user_id is distinct from actor_id
       or existing_message.sender_student_id is not null
       or existing_message.message is distinct from normalized_message
       or existing_message.metadata_json->>'chat_request_operation'
            is distinct from 'create_student_direct_chat'
       or existing_thread.thread_type is distinct from 'student_direct'
       or existing_thread.student_id is distinct from p_student_id
       or existing_thread.created_by is distinct from actor_id
       or existing_thread.title is distinct from normalized_title then
      raise exception 'Chat request id conflicts with a prior action.'
        using errcode = '22023';
    end if;

    return existing_thread.id;
  end if;

  perform coachfort_internal.consume_monthly_usage(
    p_tenant_id, 'messages_monthly', 'chat:' || p_request_id::text, 1
  );

  insert into public.conversation_threads (
    tenant_id, thread_type, title, student_id, created_by, status, replies_enabled
  ) values (
    p_tenant_id, 'student_direct', normalized_title, p_student_id,
    actor_id, 'active', true
  ) returning id into thread_id;

  perform public.add_default_team_chat_participants(
    p_tenant_id, thread_id, actor_id, p_student_id
  );

  insert into public.conversation_messages (
    tenant_id, thread_id, sender_user_id, message, message_type,
    status, metadata_json, request_id
  ) values (
    p_tenant_id, thread_id, actor_id, normalized_message, 'text', 'sent',
    jsonb_build_object('chat_request_operation', 'create_student_direct_chat'),
    p_request_id
  );

  update public.conversation_threads set updated_at = now() where id = thread_id;

  perform public.chat_insert_audit(
    p_tenant_id, actor_id, 'chat_thread_created', thread_id, p_student_id, 'team'
  );
  perform public.chat_insert_audit(
    p_tenant_id, actor_id, 'chat_message_sent', thread_id, p_student_id, 'team'
  );

  return thread_id;
end;
$$;

create function public.create_student_support_thread(
  p_title text,
  p_initial_message text,
  p_request_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ctx record;
  normalized_title text;
  normalized_message text;
  thread_id uuid;
  existing_message public.conversation_messages%rowtype;
  existing_thread public.conversation_threads%rowtype;
begin
  select * into ctx from public.chat_student_context() limit 1;
  if ctx.student_id is null then
    raise exception 'Active student portal account required.' using errcode = '42501';
  end if;

  perform coachfort_internal.assert_effective_operational_feature(
    ctx.tenant_id, 'messages'
  );

  normalized_title := public.chat_validate_plain_text(p_title, 'Title', true, 180);
  normalized_message := public.chat_validate_plain_text(
    p_initial_message, 'Message', true, 4000
  );
  perform coachfort_internal.chat_request_lock(ctx.tenant_id, p_request_id);

  select message.* into existing_message
  from public.conversation_messages message
  where message.tenant_id = ctx.tenant_id
    and message.request_id = p_request_id;

  if found then
    select thread.* into existing_thread
    from public.conversation_threads thread
    where thread.id = existing_message.thread_id
      and thread.tenant_id = ctx.tenant_id;

    if not found
       or existing_message.sender_student_id is distinct from ctx.student_id
       or existing_message.sender_user_id is not null
       or existing_message.message is distinct from normalized_message
       or existing_message.metadata_json->>'chat_request_operation'
            is distinct from 'create_student_support_thread'
       or existing_thread.thread_type is distinct from 'student_support'
       or existing_thread.student_id is distinct from ctx.student_id
       or existing_thread.title is distinct from normalized_title then
      raise exception 'Chat request id conflicts with a prior action.'
        using errcode = '22023';
    end if;

    return existing_thread.id;
  end if;

  perform coachfort_internal.consume_monthly_usage(
    ctx.tenant_id, 'messages_monthly', 'chat:' || p_request_id::text, 1
  );

  insert into public.conversation_threads (
    tenant_id, thread_type, title, student_id, status, replies_enabled
  ) values (
    ctx.tenant_id, 'student_support', normalized_title, ctx.student_id,
    'active', true
  ) returning id into thread_id;

  perform public.add_default_team_chat_participants(
    ctx.tenant_id, thread_id, null, ctx.student_id
  );

  insert into public.conversation_messages (
    tenant_id, thread_id, sender_student_id, message, message_type,
    status, metadata_json, request_id
  ) values (
    ctx.tenant_id, thread_id, ctx.student_id, normalized_message, 'text', 'sent',
    jsonb_build_object('chat_request_operation', 'create_student_support_thread'),
    p_request_id
  );

  update public.conversation_threads set updated_at = now() where id = thread_id;
  perform public.chat_insert_audit(
    ctx.tenant_id, null, 'student_support_thread_created',
    thread_id, ctx.student_id, 'student'
  );

  return thread_id;
end;
$$;

create function public.send_team_chat_message(
  p_thread_id uuid,
  p_body text,
  p_request_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  thread_row public.conversation_threads%rowtype;
  normalized_body text;
  message_id uuid;
  existing_message public.conversation_messages%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not coalesce(public.chat_team_can_access_thread(p_thread_id), false) then
    raise exception 'Chat thread access denied.' using errcode = '42501';
  end if;

  select * into thread_row from public.conversation_threads where id = p_thread_id;
  if not found then
    raise exception 'Chat thread was not found.' using errcode = '22023';
  end if;

  perform coachfort_internal.assert_effective_operational_feature(
    thread_row.tenant_id, 'messages'
  );
  if thread_row.status <> 'active' then
    raise exception 'This chat thread is closed.' using errcode = '22023';
  end if;

  normalized_body := public.chat_validate_plain_text(p_body, 'Message', true, 4000);
  perform coachfort_internal.chat_request_lock(thread_row.tenant_id, p_request_id);

  select message.* into existing_message
  from public.conversation_messages message
  where message.tenant_id = thread_row.tenant_id
    and message.request_id = p_request_id;

  if found then
    if existing_message.thread_id is distinct from thread_row.id
       or existing_message.sender_user_id is distinct from actor_id
       or existing_message.sender_student_id is not null
       or existing_message.message is distinct from normalized_body
       or existing_message.metadata_json->>'chat_request_operation'
            is distinct from 'send_team_chat_message' then
      raise exception 'Chat request id conflicts with a prior action.'
        using errcode = '22023';
    end if;
    return existing_message.id;
  end if;

  perform coachfort_internal.consume_monthly_usage(
    thread_row.tenant_id, 'messages_monthly', 'chat:' || p_request_id::text, 1
  );

  insert into public.conversation_messages (
    tenant_id, thread_id, sender_user_id, message, message_type,
    status, metadata_json, request_id
  ) values (
    thread_row.tenant_id, thread_row.id, actor_id, normalized_body,
    case when thread_row.thread_type in (
      'course_announcement', 'cohort_announcement'
    ) then 'announcement' else 'text' end,
    'sent', jsonb_build_object('chat_request_operation', 'send_team_chat_message'),
    p_request_id
  ) returning id into message_id;

  update public.conversation_threads set updated_at = now() where id = thread_row.id;
  insert into public.conversation_participants (
    tenant_id, thread_id, user_id, role, last_read_at
  ) values (
    thread_row.tenant_id, thread_row.id, actor_id,
    public.chat_current_team_role(thread_row.tenant_id), now()
  ) on conflict do nothing;
  perform public.chat_insert_audit(
    thread_row.tenant_id, actor_id, 'chat_message_sent',
    thread_row.id, thread_row.student_id, 'team'
  );
  return message_id;
end;
$$;

create function public.send_student_chat_message(
  p_thread_id uuid,
  p_body text,
  p_request_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ctx record;
  thread_row public.conversation_threads%rowtype;
  normalized_body text;
  message_id uuid;
  existing_message public.conversation_messages%rowtype;
begin
  select * into ctx from public.chat_student_context() limit 1;
  if ctx.student_id is null then
    raise exception 'Active student portal account required.' using errcode = '42501';
  end if;
  if not coalesce(public.chat_student_can_access_thread(p_thread_id), false) then
    raise exception 'Student chat thread access denied.' using errcode = '42501';
  end if;

  select * into thread_row
  from public.conversation_threads
  where id = p_thread_id and tenant_id = ctx.tenant_id;
  if not found then
    raise exception 'Student chat thread was not found.' using errcode = '22023';
  end if;

  perform coachfort_internal.assert_effective_operational_feature(
    thread_row.tenant_id, 'messages'
  );
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
  perform coachfort_internal.chat_request_lock(thread_row.tenant_id, p_request_id);

  select message.* into existing_message
  from public.conversation_messages message
  where message.tenant_id = thread_row.tenant_id
    and message.request_id = p_request_id;

  if found then
    if existing_message.thread_id is distinct from thread_row.id
       or existing_message.sender_student_id is distinct from ctx.student_id
       or existing_message.sender_user_id is not null
       or existing_message.message is distinct from normalized_body
       or existing_message.metadata_json->>'chat_request_operation'
            is distinct from 'send_student_chat_message' then
      raise exception 'Chat request id conflicts with a prior action.'
        using errcode = '22023';
    end if;
    return existing_message.id;
  end if;

  perform coachfort_internal.consume_monthly_usage(
    thread_row.tenant_id, 'messages_monthly', 'chat:' || p_request_id::text, 1
  );

  insert into public.conversation_messages (
    tenant_id, thread_id, sender_student_id, message, message_type,
    status, metadata_json, request_id
  ) values (
    thread_row.tenant_id, thread_row.id, ctx.student_id, normalized_body,
    'text', 'sent',
    jsonb_build_object('chat_request_operation', 'send_student_chat_message'),
    p_request_id
  ) returning id into message_id;

  update public.conversation_threads set updated_at = now() where id = thread_row.id;
  insert into public.conversation_participants (
    tenant_id, thread_id, student_id, role, last_read_at
  ) values (
    thread_row.tenant_id, thread_row.id, ctx.student_id, 'student', now()
  ) on conflict do nothing;
  perform public.chat_insert_audit(
    thread_row.tenant_id, null, 'chat_message_sent',
    thread_row.id, ctx.student_id, 'student'
  );
  return message_id;
end;
$$;

-- SQL-first compatibility wrappers. They meter every legacy call but cannot
-- provide durable client retry identity; UX-8G4A2C2 removes these identities.
create or replace function public.create_student_direct_chat(
  p_tenant_id uuid,
  p_student_id uuid,
  p_title text,
  p_initial_message text
)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.create_student_direct_chat(
    p_tenant_id, p_student_id, p_title, p_initial_message, gen_random_uuid()
  );
$$;

create or replace function public.create_student_support_thread(
  p_title text,
  p_initial_message text
)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.create_student_support_thread(
    p_title, p_initial_message, gen_random_uuid()
  );
$$;

create or replace function public.send_team_chat_message(
  p_thread_id uuid,
  p_body text
)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.send_team_chat_message(p_thread_id, p_body, gen_random_uuid());
$$;

create or replace function public.send_student_chat_message(
  p_thread_id uuid,
  p_body text
)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.send_student_chat_message(p_thread_id, p_body, gen_random_uuid());
$$;

alter function coachfort_internal.chat_request_lock(uuid,uuid) owner to postgres;
alter function coachfort_internal.enforce_chat_request_id_immutability()
  owner to postgres;
alter function public.create_student_direct_chat(uuid,uuid,text,text,uuid)
  owner to postgres;
alter function public.create_student_support_thread(text,text,uuid)
  owner to postgres;
alter function public.send_team_chat_message(uuid,text,uuid) owner to postgres;
alter function public.send_student_chat_message(uuid,text,uuid) owner to postgres;
alter function public.create_student_direct_chat(uuid,uuid,text,text)
  owner to postgres;
alter function public.create_student_support_thread(text,text) owner to postgres;
alter function public.send_team_chat_message(uuid,text) owner to postgres;
alter function public.send_student_chat_message(uuid,text) owner to postgres;

revoke all on function coachfort_internal.chat_request_lock(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_chat_request_id_immutability()
  from public, anon, authenticated, service_role;

revoke all on function public.create_student_direct_chat(uuid,uuid,text,text,uuid)
  from public, anon, service_role;
revoke all on function public.create_student_support_thread(text,text,uuid)
  from public, anon, service_role;
revoke all on function public.send_team_chat_message(uuid,text,uuid)
  from public, anon, service_role;
revoke all on function public.send_student_chat_message(uuid,text,uuid)
  from public, anon, service_role;
revoke all on function public.create_student_direct_chat(uuid,uuid,text,text)
  from public, anon, service_role;
revoke all on function public.create_student_support_thread(text,text)
  from public, anon, service_role;
revoke all on function public.send_team_chat_message(uuid,text)
  from public, anon, service_role;
revoke all on function public.send_student_chat_message(uuid,text)
  from public, anon, service_role;

grant execute on function public.create_student_direct_chat(uuid,uuid,text,text,uuid)
  to authenticated;
grant execute on function public.create_student_support_thread(text,text,uuid)
  to authenticated;
grant execute on function public.send_team_chat_message(uuid,text,uuid)
  to authenticated;
grant execute on function public.send_student_chat_message(uuid,text,uuid)
  to authenticated;
grant execute on function public.create_student_direct_chat(uuid,uuid,text,text)
  to authenticated;
grant execute on function public.create_student_support_thread(text,text)
  to authenticated;
grant execute on function public.send_team_chat_message(uuid,text)
  to authenticated;
grant execute on function public.send_student_chat_message(uuid,text)
  to authenticated;

notify pgrst, 'reload schema';

commit;

/* POST-APPLY READ-ONLY VERIFICATION
with expected_new(identity) as (
  values
    ('public.create_student_direct_chat(uuid,uuid,text,text,uuid)'),
    ('public.create_student_support_thread(text,text,uuid)'),
    ('public.send_team_chat_message(uuid,text,uuid)'),
    ('public.send_student_chat_message(uuid,text,uuid)')
), expected_old(identity) as (
  values
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'),
    ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)')
), new_functions as (
  select
    expected.identity,
    procedure.oid,
    procedure.prosecdef,
    procedure.provolatile,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')) source
  from expected_new expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), old_functions as (
  select
    expected.identity,
    procedure.oid,
    procedure.prosecdef,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')) source
  from expected_old expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), writer_functions as (
  select procedure.oid, procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and lower(procedure.prosrc) like '%insert into public.conversation_messages%'
), browser_dml as (
  select count(*) grant_count
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) acl
  left join pg_catalog.pg_roles role on role.oid = acl.grantee
  where namespace.nspname = 'public'
    and class.relname in (
      'conversation_threads', 'conversation_participants', 'conversation_messages'
    )
    and coalesce(role.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')
    and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), function_acl as (
  select
    count(*) filter (
      where target_function.oid is not null
        and has_function_privilege('authenticated', target_function.oid, 'EXECUTE')
    ) authenticated_execute,
    count(*) filter (
      where target_function.oid is not null
        and has_function_privilege('anon', target_function.oid, 'EXECUTE')
    ) anon_execute,
    count(*) filter (
      where target_function.oid is not null
        and has_function_privilege('service_role', target_function.oid, 'EXECUTE')
    ) service_execute,
    count(*) filter (
      where exists (
        select 1 from aclexplode(coalesce(
          (select procedure.proacl from pg_catalog.pg_proc procedure
           where procedure.oid = target_function.oid),
          acldefault('f', (select procedure.proowner from pg_catalog.pg_proc procedure
                           where procedure.oid = target_function.oid))
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    ) public_execute
  from (
    select oid from new_functions
    union all
    select oid from old_functions
  ) target_function
), counts as (
  select
    (select count(*) from public.conversation_threads) conversation_threads,
    (select count(*) from public.conversation_participants) conversation_participants,
    (select count(*) from public.conversation_messages) conversation_messages,
    (select count(*) from coachfort_internal.monthly_usage_counters) monthly_usage_counters,
    (select count(*) from coachfort_internal.monthly_usage_consumption_events) monthly_usage_events
), contracts as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_messages'
        and column_name = 'request_id' and data_type = 'uuid' and is_nullable = 'YES'
    ) request_column_contract,
    exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class on index_class.oid = index_row.indexrelid
      where index_class.oid = to_regclass(
        'public.conversation_messages_tenant_request_unique_idx'
      )
        and index_row.indisunique
        and lower(pg_get_indexdef(index_class.oid)) like
          '%on public.conversation_messages using btree (tenant_id, request_id)%'
        and pg_get_expr(index_row.indpred, index_row.indrelid)
          = '(request_id IS NOT NULL)'
    ) request_unique_contract,
    exists (
      select 1 from pg_catalog.pg_trigger trigger
      where trigger.tgrelid = 'public.conversation_messages'::regclass
        and trigger.tgname = 'conversation_messages_request_id_immutable'
        and trigger.tgfoid = to_regprocedure(
          'coachfort_internal.enforce_chat_request_id_immutability()'
        )
        and lower(pg_get_triggerdef(trigger.oid)) like
          '%before update of request_id on public.conversation_messages%'
        and not trigger.tgisinternal
    ) request_immutable_contract,
    (
      select count(*) = 4 and bool_and(
        oid is not null and prosecdef and provolatile = 'v' and owner_name = 'postgres'
        and source like '%set search_path to ''public'', ''pg_temp''%'
        and source like '%assert_effective_operational_feature%'
        and source like '%chat_request_lock%'
        and source like '%message.request_id = p_request_id%'
        and source like '%chat_request_operation%'
        and source like '%chat request id conflicts with a prior action%'
        and source like '%return existing_%'
        and source like '%consume_monthly_usage%'
        and source like '%''messages_monthly''%'
        and source like '%''chat:'' || p_request_id::text%'
        and position('assert_effective_operational_feature' in source)
          < position('message.request_id = p_request_id' in source)
        and position('message.request_id = p_request_id' in source)
          < position('consume_monthly_usage' in source)
        and position('consume_monthly_usage' in source)
          < position('insert into public.conversation_messages' in source)
        and position('consume_monthly_usage' in source)
          < position('update public.conversation_threads' in source)
        and source not like '%period_start%'
      ) from new_functions
    ) new_runtime_contract,
    (
      select count(*) = 2 and bool_and(
        position('consume_monthly_usage' in source)
          < position('insert into public.conversation_threads' in source)
        and position('consume_monthly_usage' in source)
          < position('add_default_team_chat_participants' in source)
        and position('consume_monthly_usage' in source)
          < position('chat_insert_audit' in source)
      )
      from new_functions
      where identity in (
        'public.create_student_direct_chat(uuid,uuid,text,text,uuid)',
        'public.create_student_support_thread(text,text,uuid)'
      )
    ) thread_creation_atomic_contract,
    (
      select count(*) = 4 and bool_and(
        oid is not null and prosecdef and owner_name = 'postgres'
        and source like '%set search_path to ''public'', ''pg_temp''%'
        and source like '%select public.%'
        and source like '%gen_random_uuid()%'
        and source not like '%insert into public.conversation_messages%'
      ) from old_functions
    ) metered_compatibility_contract,
    (
      select count(*) = 4
        and bool_and(writer.oid in (
          select to_regprocedure(expected.identity) from expected_new expected
        ))
      from writer_functions writer
    ) exact_writer_contract,
    (select grant_count = 0 from browser_dml) no_browser_writes,
    (
      select authenticated_execute = 8
        and anon_execute = 0 and service_execute = 0 and public_execute = 0
      from function_acl
    ) exact_rpc_acl,
    (
      select count(*) = 2 and bool_and(
        procedure.prosecdef
        and pg_get_userbyid(procedure.proowner) = 'postgres'
        and lower(pg_get_functiondef(procedure.oid))
          like '%set search_path to ''public'', ''pg_temp''%'
        and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
        and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        and not exists (
          select 1
          from aclexplode(coalesce(
            procedure.proacl, acldefault('f', procedure.proowner)
          )) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
        and (
          procedure.oid <> to_regprocedure(
            'coachfort_internal.chat_request_lock(uuid,uuid)'
          )
          or (
            lower(procedure.prosrc) like '%pg_advisory_xact_lock%'
            and lower(procedure.prosrc) like '%p_tenant_id::text%'
            and lower(procedure.prosrc) like '%p_request_id::text%'
            and lower(procedure.prosrc) not like '%period_start%'
          )
        )
        and (
          procedure.oid <> to_regprocedure(
            'coachfort_internal.enforce_chat_request_id_immutability()'
          )
          or lower(procedure.prosrc) like
            '%new.request_id is distinct from old.request_id%'
        )
      )
      from pg_catalog.pg_proc procedure
      where procedure.oid in (
        to_regprocedure('coachfort_internal.chat_request_lock(uuid,uuid)'),
        to_regprocedure(
          'coachfort_internal.enforce_chat_request_id_immutability()'
        )
      )
    ) request_helpers_private,
    not exists (
      select 1 from new_functions
      where source like '%community_posts%'
        or source like '%community_comments%'
        or source like '%community_hub%'
        or source like '%automation_runs_monthly%'
        or source like '%ai_requests_monthly%'
    ) adjacent_domains_unchanged
)
select
  contracts.*,
  counts.*,
  (select jsonb_agg(identity order by identity) from writer_functions)
    active_message_writers,
  (
    request_column_contract
    and request_unique_contract
    and request_immutable_contract
    and new_runtime_contract
    and thread_creation_atomic_contract
    and metered_compatibility_contract
    and exact_writer_contract
    and no_browser_writes
    and exact_rpc_acl
    and request_helpers_private
    and adjacent_domains_unchanged
  ) security_gate
from contracts cross join counts;
*/
