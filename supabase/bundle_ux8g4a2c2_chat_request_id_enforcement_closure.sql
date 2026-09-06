-- Bundle UX-8G4A2C2: retire Chat RPCs without caller-supplied request IDs.
-- Review before execution. This file has not been executed by Codex.

/* PRE-APPLY READ-ONLY VERIFICATION
with expected_new(identity, authority_marker) as (
  values
    (
      'public.create_student_direct_chat(uuid,uuid,text,text,uuid)',
      'chat_team_can_start_student_thread'
    ),
    (
      'public.create_student_support_thread(text,text,uuid)',
      'chat_student_context'
    ),
    (
      'public.send_team_chat_message(uuid,text,uuid)',
      'chat_team_can_access_thread'
    ),
    (
      'public.send_student_chat_message(uuid,text,uuid)',
      'chat_student_can_access_thread'
    )
), expected_old(identity, call_marker) as (
  values
    (
      'public.create_student_direct_chat(uuid,uuid,text,text)',
      'select public.create_student_direct_chat('
    ),
    (
      'public.create_student_support_thread(text,text)',
      'select public.create_student_support_thread('
    ),
    (
      'public.send_team_chat_message(uuid,text)',
      'select public.send_team_chat_message('
    ),
    (
      'public.send_student_chat_message(uuid,text)',
      'select public.send_student_chat_message('
    )
), new_functions as (
  select
    expected.identity,
    expected.authority_marker,
    procedure.oid,
    procedure.prosecdef,
    procedure.provolatile,
    procedure.pronargdefaults,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) source
  from expected_new expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), old_functions as (
  select
    expected.identity,
    expected.call_marker,
    procedure.oid,
    procedure.prosecdef,
    procedure.provolatile,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) source
  from expected_old expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), named_rpc_inventory as (
  select procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'create_student_direct_chat',
      'create_student_support_thread',
      'send_team_chat_message',
      'send_student_chat_message'
    )
), direct_message_writers as (
  select procedure.oid, procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and lower(procedure.prosrc) like
      '%insert into public.conversation_messages%'
), unexpected_writer_wrappers as (
  select procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.oid not in (
      select oid from new_functions where oid is not null
      union all
      select oid from old_functions where oid is not null
    )
    and (
      lower(procedure.prosrc) like '%create_student_direct_chat(%'
      or lower(procedure.prosrc) like '%create_student_support_thread(%'
      or lower(procedure.prosrc) like '%send_team_chat_message(%'
      or lower(procedure.prosrc) like '%send_student_chat_message(%'
    )
), browser_dml as (
  select count(*) grant_count
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  cross join lateral aclexplode(
    coalesce(class.relacl, acldefault('r', class.relowner))
  ) acl
  left join pg_catalog.pg_roles role on role.oid = acl.grantee
  where namespace.nspname = 'public'
    and class.relname in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
    and coalesce(role.rolname, 'PUBLIC') in (
      'PUBLIC', 'anon', 'authenticated'
    )
    and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), function_acl as (
  select
    target.kind,
    count(*) filter (
      where target.oid is not null
        and has_function_privilege(
          'authenticated', target.oid, 'EXECUTE'
        )
    ) authenticated_execute,
    count(*) filter (
      where target.oid is not null
        and has_function_privilege('anon', target.oid, 'EXECUTE')
    ) anon_execute,
    count(*) filter (
      where target.oid is not null
        and has_function_privilege('service_role', target.oid, 'EXECUTE')
    ) service_execute,
    count(*) filter (
      where exists (
        select 1
        from pg_catalog.pg_proc procedure
        cross join lateral aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) acl
        where procedure.oid = target.oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ) public_execute
  from (
    select 'new'::text kind, oid from new_functions
    union all
    select 'old'::text kind, oid from old_functions
  ) target
  group by target.kind
), helper_contract as (
  select
    procedure.oid,
    procedure.oid::regprocedure::text identity,
    procedure.prosecdef,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) source,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_execute,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      service_execute,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) public_execute
  from pg_catalog.pg_proc procedure
  where procedure.oid in (
    to_regprocedure('coachfort_internal.chat_request_lock(uuid,uuid)'),
    to_regprocedure(
      'coachfort_internal.enforce_chat_request_id_immutability()'
    ),
    to_regprocedure(
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    )
  )
), counts as (
  select
    (select count(*) from public.conversation_threads)
      conversation_threads,
    (select count(*) from public.conversation_participants)
      conversation_participants,
    (select count(*) from public.conversation_messages)
      conversation_messages,
    (select count(*) from coachfort_internal.monthly_usage_counters)
      monthly_usage_counters,
    (
      select count(*)
      from coachfort_internal.monthly_usage_consumption_events
    ) monthly_usage_consumption_events
), contracts as (
  select
    (
      select count(*) = 4 and bool_and(
        oid is not null
        and prosecdef
        and provolatile = 'v'
        and pronargdefaults = 0
        and owner_name = 'postgres'
        and source like '%set search_path to ''public'', ''pg_temp''%'
        and source like '%' || authority_marker || '%'
        and source like '%assert_effective_operational_feature%'
        and source like '%''messages''%'
        and source like '%chat_request_lock%'
        and source like '%p_request_id%'
        and source like '%message.request_id = p_request_id%'
        and source like '%chat request id conflicts with a prior action%'
        and source like '%consume_monthly_usage%'
        and source like '%''messages_monthly''%'
        and source like '%''chat:'' || p_request_id::text%'
        and source like '%insert into public.conversation_messages%'
        and source not like '%gen_random_uuid()%'
        and source not like '%period_start%'
        and position('assert_effective_operational_feature' in source)
          < position('message.request_id = p_request_id' in source)
        and position('message.request_id = p_request_id' in source)
          < position('consume_monthly_usage' in source)
        and position('consume_monthly_usage' in source)
          < position('insert into public.conversation_messages' in source)
      )
      from new_functions
    ) request_aware_writer_contract,
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
        oid is not null
        and prosecdef
        and provolatile = 'v'
        and owner_name = 'postgres'
        and source like '%set search_path to ''public'', ''pg_temp''%'
        and source like '%' || call_marker || '%'
        and source like '%gen_random_uuid()%'
        and source not like '%insert into public.conversation_messages%'
        and source not like '%consume_monthly_usage%'
      )
      from old_functions
    ) legacy_metered_wrapper_contract,
    (
      select count(*) = 8
      from named_rpc_inventory
    ) exact_bridge_identity_contract,
    (
      select count(*) = 4
        and bool_and(
          writer.oid in (
            select to_regprocedure(identity) from expected_new
          )
        )
      from direct_message_writers writer
    ) exact_direct_writer_contract,
    not exists (select 1 from unexpected_writer_wrappers)
      no_unexpected_bridge_wrapper,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_messages'
        and column_name = 'request_id'
        and data_type = 'uuid'
        and is_nullable = 'YES'
    ) request_column_contract,
    exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class
        on index_class.oid = index_row.indexrelid
      where index_class.oid = to_regclass(
        'public.conversation_messages_tenant_request_unique_idx'
      )
        and index_row.indisunique
        and lower(pg_get_indexdef(index_class.oid)) like
          '%on public.conversation_messages using btree (tenant_id, request_id)%'
        and lower(pg_get_expr(index_row.indpred, index_row.indrelid))
          = '(request_id is not null)'
    ) request_unique_contract,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger
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
      select count(*) = 3 and bool_and(
        prosecdef
        and owner_name = 'postgres'
        and source like '%set search_path to ''public'', ''pg_temp''%'
        and not authenticated_execute
        and not anon_execute
        and not service_execute
        and not public_execute
      )
      from helper_contract
    ) private_helper_contract,
    (
      select count(*) = 1
        and bool_and(
          source like '%p_request_id is null%'
          and source like '%pg_advisory_xact_lock%'
          and source like '%p_tenant_id::text%'
          and source like '%p_request_id::text%'
        )
      from helper_contract
      where oid = to_regprocedure(
        'coachfort_internal.chat_request_lock(uuid,uuid)'
      )
    ) request_validation_contract,
    (
      select count(*) = 1
        and bool_and(
          authenticated_execute = 4
          and anon_execute = 0
          and service_execute = 0
          and public_execute = 0
        )
      from function_acl
      where kind = 'new'
    ) new_acl_contract,
    (
      select count(*) = 1
        and bool_and(
          authenticated_execute = 4
          and anon_execute = 0
          and service_execute = 0
          and public_execute = 0
        )
      from function_acl
      where kind = 'old'
    ) old_acl_contract,
    (select grant_count = 0 from browser_dml) browser_write_contract
)
select
  contracts.*,
  counts.*,
  (
    select jsonb_agg(identity order by identity)
    from named_rpc_inventory
  ) current_chat_rpc_identities,
  (
    select jsonb_agg(identity order by identity)
    from direct_message_writers
  ) current_direct_message_writers,
  (
    request_aware_writer_contract
    and thread_creation_atomic_contract
    and legacy_metered_wrapper_contract
    and exact_bridge_identity_contract
    and exact_direct_writer_contract
    and no_unexpected_bridge_wrapper
    and request_column_contract
    and request_unique_contract
    and request_immutable_contract
    and private_helper_contract
    and request_validation_contract
    and new_acl_contract
    and old_acl_contract
    and browser_write_contract
  ) ready_for_apply
from contracts cross join counts;
*/

begin;

do $$
declare
  v_authority_markers constant text[] := array[
    'chat_team_can_start_student_thread',
    'chat_student_context',
    'chat_team_can_access_thread',
    'chat_student_can_access_thread'
  ];
  v_identity text;
  v_helper_identities constant text[] := array[
    'coachfort_internal.chat_request_lock(uuid,uuid)',
    'coachfort_internal.enforce_chat_request_id_immutability()',
    'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
  ];
  v_index integer;
  v_new_identities constant text[] := array[
    'public.create_student_direct_chat(uuid,uuid,text,text,uuid)',
    'public.create_student_support_thread(text,text,uuid)',
    'public.send_team_chat_message(uuid,text,uuid)',
    'public.send_student_chat_message(uuid,text,uuid)'
  ];
  v_old_identities constant text[] := array[
    'public.create_student_direct_chat(uuid,uuid,text,text)',
    'public.create_student_support_thread(text,text)',
    'public.send_team_chat_message(uuid,text)',
    'public.send_student_chat_message(uuid,text)'
  ];
  v_oid oid;
  v_source text;
begin
  if to_regclass('public.conversation_threads') is null
     or to_regclass('public.conversation_participants') is null
     or to_regclass('public.conversation_messages') is null
     or to_regclass('coachfort_internal.monthly_usage_counters') is null
     or to_regclass(
       'coachfort_internal.monthly_usage_consumption_events'
     ) is null then
    raise exception 'UX-8G4A2C2 requires the installed Chat and meter tables.';
  end if;

  for v_index in 1..array_length(v_new_identities, 1) loop
    v_identity := v_new_identities[v_index];
    v_oid := to_regprocedure(v_identity);

    if v_oid is null then
      raise exception 'Request-aware Chat RPC is missing: %', v_identity;
    end if;

    select lower(regexp_replace(
      pg_get_functiondef(v_oid), '[[:space:]]+', ' ', 'g'
    )) into v_source;

    if not (
      (select procedure.prosecdef
       from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      and (select procedure.provolatile = 'v'
           from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      and (select procedure.pronargdefaults = 0
           from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      and pg_get_userbyid(
        (select procedure.proowner
         from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      ) = 'postgres'
      and v_source like '%set search_path to ''public'', ''pg_temp''%'
      and v_source like '%' || v_authority_markers[v_index] || '%'
      and v_source like '%assert_effective_operational_feature%'
      and v_source like '%''messages''%'
      and v_source like '%chat_request_lock%'
      and v_source like '%p_request_id%'
      and v_source like '%message.request_id = p_request_id%'
      and v_source like '%chat request id conflicts with a prior action%'
      and v_source like '%consume_monthly_usage%'
      and v_source like '%''messages_monthly''%'
      and v_source like '%''chat:'' || p_request_id::text%'
      and v_source like '%insert into public.conversation_messages%'
      and v_source not like '%gen_random_uuid()%'
      and v_source not like '%period_start%'
      and position('assert_effective_operational_feature' in v_source)
        < position('message.request_id = p_request_id' in v_source)
      and position('message.request_id = p_request_id' in v_source)
        < position('consume_monthly_usage' in v_source)
      and position('consume_monthly_usage' in v_source)
        < position('insert into public.conversation_messages' in v_source)
    ) then
      raise exception 'Request-aware Chat authority drifted: %', v_identity;
    end if;

    if v_index <= 2 and not (
      position('consume_monthly_usage' in v_source)
        < position('insert into public.conversation_threads' in v_source)
      and position('consume_monthly_usage' in v_source)
        < position('add_default_team_chat_participants' in v_source)
      and position('consume_monthly_usage' in v_source)
        < position('chat_insert_audit' in v_source)
    ) then
      raise exception 'Chat thread-creation atomicity drifted: %', v_identity;
    end if;

    if not has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('service_role', v_oid, 'EXECUTE')
       or exists (
         select 1
         from pg_catalog.pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) acl
         where procedure.oid = v_oid
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       ) then
      raise exception 'Request-aware Chat RPC ACL drifted: %', v_identity;
    end if;
  end loop;

  foreach v_identity in array v_old_identities loop
    v_oid := to_regprocedure(v_identity);

    if v_oid is null then
      raise exception 'Legacy Chat bridge identity is missing: %', v_identity;
    end if;

    select lower(regexp_replace(
      pg_get_functiondef(v_oid), '[[:space:]]+', ' ', 'g'
    )) into v_source;

    if not (
      (select procedure.prosecdef
       from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      and (select procedure.provolatile = 'v'
           from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      and pg_get_userbyid(
        (select procedure.proowner
         from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      ) = 'postgres'
      and v_source like '%set search_path to ''public'', ''pg_temp''%'
      and v_source like ('%select public.' || (
        select procedure.proname
        from pg_catalog.pg_proc procedure
        where procedure.oid = v_oid
      ) || '(%')
      and v_source like '%gen_random_uuid()%'
      and v_source not like '%insert into public.conversation_messages%'
      and v_source not like '%consume_monthly_usage%'
    ) then
      raise exception 'Legacy Chat bridge body drifted: %', v_identity;
    end if;

    if not has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('service_role', v_oid, 'EXECUTE')
       or exists (
         select 1
         from pg_catalog.pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) acl
         where procedure.oid = v_oid
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
      ) then
      raise exception 'Legacy Chat bridge ACL drifted: %', v_identity;
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'create_student_direct_chat',
        'create_student_support_thread',
        'send_team_chat_message',
        'send_student_chat_message'
      )
  ) <> 8 then
    raise exception 'The exact eight-function A2C1 bridge is required.';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and lower(procedure.prosrc) like
        '%insert into public.conversation_messages%'
      and procedure.oid = any (array(
        select to_regprocedure(expected.identity)
        from unnest(v_new_identities) as expected(identity)
      ))
  ) <> 4 or (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and lower(procedure.prosrc) like
        '%insert into public.conversation_messages%'
  ) <> 4 then
    raise exception 'Direct Chat message-writer inventory drifted.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.oid <> all (array(
        select to_regprocedure(expected.identity)
        from unnest(v_new_identities || v_old_identities)
          as expected(identity)
      ))
      and (
        lower(procedure.prosrc) like '%create_student_direct_chat(%'
        or lower(procedure.prosrc) like '%create_student_support_thread(%'
        or lower(procedure.prosrc) like '%send_team_chat_message(%'
        or lower(procedure.prosrc) like '%send_student_chat_message(%'
      )
  ) then
    raise exception 'An unexpected Chat writer wrapper is installed.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_messages'
      and column_name = 'request_id'
      and data_type = 'uuid'
      and is_nullable = 'YES'
  ) or not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_class
      on index_class.oid = index_row.indexrelid
    where index_class.oid = to_regclass(
      'public.conversation_messages_tenant_request_unique_idx'
    )
      and index_row.indisunique
      and lower(pg_get_indexdef(index_class.oid)) like
        '%on public.conversation_messages using btree (tenant_id, request_id)%'
      and lower(pg_get_expr(index_row.indpred, index_row.indrelid))
        = '(request_id is not null)'
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.conversation_messages'::regclass
      and trigger.tgname = 'conversation_messages_request_id_immutable'
      and trigger.tgfoid = to_regprocedure(
        'coachfort_internal.enforce_chat_request_id_immutability()'
      )
      and not trigger.tgisinternal
  ) then
    raise exception 'Durable Chat request schema authority drifted.';
  end if;

  foreach v_identity in array v_helper_identities loop
    v_oid := to_regprocedure(v_identity);

    if v_oid is null then
      raise exception 'Private Chat request or meter helper is missing: %',
        v_identity;
    end if;

    select lower(regexp_replace(
      pg_get_functiondef(v_oid), '[[:space:]]+', ' ', 'g'
    )) into v_source;

    if not (
      (select procedure.prosecdef
       from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      and pg_get_userbyid(
        (select procedure.proowner
         from pg_catalog.pg_proc procedure where procedure.oid = v_oid)
      ) = 'postgres'
      and v_source like '%set search_path to ''public'', ''pg_temp''%'
      and not has_function_privilege('authenticated', v_oid, 'EXECUTE')
      and not has_function_privilege('anon', v_oid, 'EXECUTE')
      and not has_function_privilege('service_role', v_oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.pg_proc procedure
        cross join lateral aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where procedure.oid = v_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ) then
      raise exception 'Private Chat request or meter helper drifted: %',
        v_identity;
    end if;

    if v_identity = 'coachfort_internal.chat_request_lock(uuid,uuid)'
       and not (
         v_source like '%p_request_id is null%'
         and v_source like '%pg_advisory_xact_lock%'
         and v_source like '%p_tenant_id::text%'
         and v_source like '%p_request_id::text%'
       ) then
      raise exception 'Chat request validation or lock authority drifted.';
    end if;

    if v_identity =
         'coachfort_internal.enforce_chat_request_id_immutability()'
       and v_source not like
         '%new.request_id is distinct from old.request_id%' then
      raise exception 'Chat request immutability helper drifted.';
    end if;

    if v_identity =
         'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
       and not (
         v_source like '%resolve_monthly_usage_limit%'
         and v_source like '%monthly_usage_counters%'
         and v_source like '%monthly_usage_consumption_events%'
       ) then
      raise exception 'Monthly usage meter helper drifted.';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(coalesce(
      class.relacl, acldefault('r', class.relowner)
    )) acl
    left join pg_catalog.pg_roles role on role.oid = acl.grantee
    where namespace.nspname = 'public'
      and class.relname in (
        'conversation_threads',
        'conversation_participants',
        'conversation_messages'
      )
      and coalesce(role.rolname, 'PUBLIC') in (
        'PUBLIC', 'anon', 'authenticated'
      )
      and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Browser Chat table-write authority must remain absent.';
  end if;
end
$$;

create temp table ux8g4a2c2_apply_baseline on commit drop as
with adjacent_functions as (
  select
    procedure.oid::regprocedure::text identity,
    pg_get_userbyid(procedure.proowner) owner_name,
    coalesce(procedure.proacl::text, '') acl,
    pg_get_functiondef(procedure.oid) definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and (
      procedure.proname like '%community%'
      or procedure.proname like '%announcement%'
    )
), adjacent_relations as (
  select
    class.relname,
    class.relrowsecurity,
    class.relforcerowsecurity,
    coalesce(class.relacl::text, '') acl
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname in (
      'community_posts', 'community_comments', 'academy_announcements'
    )
), adjacent_policies as (
  select
    policy.schemaname,
    policy.tablename,
    policy.policyname,
    policy.permissive,
    policy.roles,
    policy.cmd,
    policy.qual,
    policy.with_check
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename in (
      'community_posts', 'community_comments', 'academy_announcements'
    )
)
select
  (select count(*) from public.conversation_threads)
    conversation_threads,
  (select count(*) from public.conversation_participants)
    conversation_participants,
  (select count(*) from public.conversation_messages)
    conversation_messages,
  (select count(*) from coachfort_internal.monthly_usage_counters)
    monthly_usage_counters,
  (
    select count(*)
    from coachfort_internal.monthly_usage_consumption_events
  ) monthly_usage_consumption_events,
  jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(to_jsonb(function_row) order by function_row.identity)
      from adjacent_functions function_row
    ), '[]'::jsonb),
    'relations', coalesce((
      select jsonb_agg(to_jsonb(relation_row) order by relation_row.relname)
      from adjacent_relations relation_row
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(
        to_jsonb(policy_row)
        order by policy_row.tablename, policy_row.policyname
      )
      from adjacent_policies policy_row
    ), '[]'::jsonb)
  ) adjacent_authority_contract;

drop function public.create_student_direct_chat(uuid,uuid,text,text);
drop function public.create_student_support_thread(text,text);
drop function public.send_team_chat_message(uuid,text);
drop function public.send_student_chat_message(uuid,text);

do $$
declare
  v_adjacent_contract jsonb;
  v_identity text;
  v_new_identities constant text[] := array[
    'public.create_student_direct_chat(uuid,uuid,text,text,uuid)',
    'public.create_student_support_thread(text,text,uuid)',
    'public.send_team_chat_message(uuid,text,uuid)',
    'public.send_student_chat_message(uuid,text,uuid)'
  ];
  v_old_identities constant text[] := array[
    'public.create_student_direct_chat(uuid,uuid,text,text)',
    'public.create_student_support_thread(text,text)',
    'public.send_team_chat_message(uuid,text)',
    'public.send_student_chat_message(uuid,text)'
  ];
begin
  foreach v_identity in array v_old_identities loop
    if to_regprocedure(v_identity) is not null then
      raise exception 'Legacy Chat RPC was not removed: %', v_identity;
    end if;
  end loop;

  foreach v_identity in array v_new_identities loop
    if to_regprocedure(v_identity) is null then
      raise exception 'Request-aware Chat RPC was altered: %', v_identity;
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'create_student_direct_chat',
        'create_student_support_thread',
        'send_team_chat_message',
        'send_student_chat_message'
      )
  ) <> 4 then
    raise exception 'Final Chat RPC identity inventory is not exact.';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and lower(procedure.prosrc) like
        '%insert into public.conversation_messages%'
      and procedure.oid = any (array(
        select to_regprocedure(expected.identity)
        from unnest(v_new_identities) as expected(identity)
      ))
  ) <> 4 or (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and lower(procedure.prosrc) like
        '%insert into public.conversation_messages%'
  ) <> 4 then
    raise exception 'Final direct Chat writer inventory is not exact.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.oid <> all (array(
        select to_regprocedure(expected.identity)
        from unnest(v_new_identities) as expected(identity)
      ))
      and (
        lower(procedure.prosrc) like '%create_student_direct_chat(%'
        or lower(procedure.prosrc) like '%create_student_support_thread(%'
        or lower(procedure.prosrc) like '%send_team_chat_message(%'
        or lower(procedure.prosrc) like '%send_student_chat_message(%'
      )
  ) then
    raise exception 'An alternate Chat writer wrapper remains installed.';
  end if;

  with adjacent_functions as (
    select
      procedure.oid::regprocedure::text identity,
      pg_get_userbyid(procedure.proowner) owner_name,
      coalesce(procedure.proacl::text, '') acl,
      pg_get_functiondef(procedure.oid) definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        procedure.proname like '%community%'
        or procedure.proname like '%announcement%'
      )
  ), adjacent_relations as (
    select
      class.relname,
      class.relrowsecurity,
      class.relforcerowsecurity,
      coalesce(class.relacl::text, '') acl
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'community_posts', 'community_comments', 'academy_announcements'
      )
  ), adjacent_policies as (
    select
      policy.schemaname,
      policy.tablename,
      policy.policyname,
      policy.permissive,
      policy.roles,
      policy.cmd,
      policy.qual,
      policy.with_check
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'community_posts', 'community_comments', 'academy_announcements'
      )
  )
  select jsonb_build_object(
    'functions', coalesce((
      select jsonb_agg(to_jsonb(function_row) order by function_row.identity)
      from adjacent_functions function_row
    ), '[]'::jsonb),
    'relations', coalesce((
      select jsonb_agg(to_jsonb(relation_row) order by relation_row.relname)
      from adjacent_relations relation_row
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(
        to_jsonb(policy_row)
        order by policy_row.tablename, policy_row.policyname
      )
      from adjacent_policies policy_row
    ), '[]'::jsonb)
  ) into v_adjacent_contract;

  if exists (
    select 1
    from ux8g4a2c2_apply_baseline baseline
    where baseline.conversation_threads <>
        (select count(*) from public.conversation_threads)
      or baseline.conversation_participants <>
        (select count(*) from public.conversation_participants)
      or baseline.conversation_messages <>
        (select count(*) from public.conversation_messages)
      or baseline.monthly_usage_counters <>
        (select count(*) from coachfort_internal.monthly_usage_counters)
      or baseline.monthly_usage_consumption_events <>
        (
          select count(*)
          from coachfort_internal.monthly_usage_consumption_events
        )
      or baseline.adjacent_authority_contract is distinct from
        v_adjacent_contract
  ) then
    raise exception 'A2C2 changed protected data or adjacent authorities.';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;

/* POST-APPLY READ-ONLY VERIFICATION
with expected_new(identity, authority_marker) as (
  values
    (
      'public.create_student_direct_chat(uuid,uuid,text,text,uuid)',
      'chat_team_can_start_student_thread'
    ),
    (
      'public.create_student_support_thread(text,text,uuid)',
      'chat_student_context'
    ),
    (
      'public.send_team_chat_message(uuid,text,uuid)',
      'chat_team_can_access_thread'
    ),
    (
      'public.send_student_chat_message(uuid,text,uuid)',
      'chat_student_can_access_thread'
    )
), expected_old(identity) as (
  values
    ('public.create_student_direct_chat(uuid,uuid,text,text)'),
    ('public.create_student_support_thread(text,text)'),
    ('public.send_team_chat_message(uuid,text)'),
    ('public.send_student_chat_message(uuid,text)')
), new_functions as (
  select
    expected.identity,
    expected.authority_marker,
    procedure.oid,
    procedure.prosecdef,
    procedure.provolatile,
    procedure.pronargdefaults,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) source
  from expected_new expected
  left join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), named_rpc_inventory as (
  select procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'create_student_direct_chat',
      'create_student_support_thread',
      'send_team_chat_message',
      'send_student_chat_message'
    )
), direct_message_writers as (
  select procedure.oid, procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and lower(procedure.prosrc) like
      '%insert into public.conversation_messages%'
), alternate_wrappers as (
  select procedure.oid::regprocedure::text identity
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.oid not in (select oid from new_functions where oid is not null)
    and (
      lower(procedure.prosrc) like '%create_student_direct_chat(%'
      or lower(procedure.prosrc) like '%create_student_support_thread(%'
      or lower(procedure.prosrc) like '%send_team_chat_message(%'
      or lower(procedure.prosrc) like '%send_student_chat_message(%'
    )
), browser_dml as (
  select count(*) grant_count
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  cross join lateral aclexplode(
    coalesce(class.relacl, acldefault('r', class.relowner))
  ) acl
  left join pg_catalog.pg_roles role on role.oid = acl.grantee
  where namespace.nspname = 'public'
    and class.relname in (
      'conversation_threads',
      'conversation_participants',
      'conversation_messages'
    )
    and coalesce(role.rolname, 'PUBLIC') in (
      'PUBLIC', 'anon', 'authenticated'
    )
    and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), function_acl as (
  select
    count(*) filter (
      where function_row.oid is not null
        and has_function_privilege(
          'authenticated', function_row.oid, 'EXECUTE'
        )
    ) authenticated_execute,
    count(*) filter (
      where function_row.oid is not null
        and has_function_privilege('anon', function_row.oid, 'EXECUTE')
    ) anon_execute,
    count(*) filter (
      where function_row.oid is not null
        and has_function_privilege(
          'service_role', function_row.oid, 'EXECUTE'
        )
    ) service_execute,
    count(*) filter (
      where exists (
        select 1
        from pg_catalog.pg_proc procedure
        cross join lateral aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) acl
        where procedure.oid = function_row.oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    ) public_execute
  from new_functions function_row
), helper_contract as (
  select
    procedure.oid,
    procedure.oid::regprocedure::text identity,
    procedure.prosecdef,
    pg_get_userbyid(procedure.proowner) owner_name,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) source,
    has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'EXECUTE') anon_execute,
    has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      service_execute,
    exists (
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) public_execute
  from pg_catalog.pg_proc procedure
  where procedure.oid in (
    to_regprocedure('coachfort_internal.chat_request_lock(uuid,uuid)'),
    to_regprocedure(
      'coachfort_internal.enforce_chat_request_id_immutability()'
    ),
    to_regprocedure(
      'coachfort_internal.consume_monthly_usage(uuid,text,text,integer)'
    )
  )
), counts as (
  select
    (select count(*) from public.conversation_threads)
      conversation_threads,
    (select count(*) from public.conversation_participants)
      conversation_participants,
    (select count(*) from public.conversation_messages)
      conversation_messages,
    (select count(*) from coachfort_internal.monthly_usage_counters)
      monthly_usage_counters,
    (
      select count(*)
      from coachfort_internal.monthly_usage_consumption_events
    ) monthly_usage_consumption_events
), contracts as (
  select
    (
      select count(*) = 4 and bool_and(
        oid is not null
        and prosecdef
        and provolatile = 'v'
        and pronargdefaults = 0
        and owner_name = 'postgres'
        and source like '%set search_path to ''public'', ''pg_temp''%'
        and source like '%' || authority_marker || '%'
        and source like '%assert_effective_operational_feature%'
        and source like '%''messages''%'
        and source like '%chat_request_lock%'
        and source like '%p_request_id%'
        and source like '%message.request_id = p_request_id%'
        and source like '%chat request id conflicts with a prior action%'
        and source like '%consume_monthly_usage%'
        and source like '%''messages_monthly''%'
        and source like '%''chat:'' || p_request_id::text%'
        and source like '%insert into public.conversation_messages%'
        and source not like '%gen_random_uuid()%'
        and source not like '%period_start%'
        and position('assert_effective_operational_feature' in source)
          < position('message.request_id = p_request_id' in source)
        and position('message.request_id = p_request_id' in source)
          < position('consume_monthly_usage' in source)
        and position('consume_monthly_usage' in source)
          < position('insert into public.conversation_messages' in source)
      )
      from new_functions
    ) request_aware_writer_contract,
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
      select count(*) = 4
        and bool_and(
          writer.oid in (
            select to_regprocedure(identity) from expected_new
          )
        )
      from direct_message_writers writer
    ) exact_direct_writer_contract,
    (
      select count(*) = 4
      from named_rpc_inventory
    ) exact_named_rpc_inventory,
    not exists (select 1 from alternate_wrappers)
      no_alternate_writer_wrapper,
    (
      select count(*) = 4
      from expected_old expected
      where to_regprocedure(expected.identity) is null
    ) legacy_identities_absent,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'conversation_messages'
        and column_name = 'request_id'
        and data_type = 'uuid'
        and is_nullable = 'YES'
    ) request_column_contract,
    exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class
        on index_class.oid = index_row.indexrelid
      where index_class.oid = to_regclass(
        'public.conversation_messages_tenant_request_unique_idx'
      )
        and index_row.indisunique
        and lower(pg_get_indexdef(index_class.oid)) like
          '%on public.conversation_messages using btree (tenant_id, request_id)%'
        and lower(pg_get_expr(index_row.indpred, index_row.indrelid))
          = '(request_id is not null)'
    ) request_unique_contract,
    exists (
      select 1
      from pg_catalog.pg_trigger trigger
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
      select count(*) = 3 and bool_and(
        prosecdef
        and owner_name = 'postgres'
        and source like '%set search_path to ''public'', ''pg_temp''%'
        and not authenticated_execute
        and not anon_execute
        and not service_execute
        and not public_execute
      )
      from helper_contract
    ) private_helper_contract,
    (
      select count(*) = 1
        and bool_and(
          source like '%p_request_id is null%'
          and source like '%pg_advisory_xact_lock%'
          and source like '%p_tenant_id::text%'
          and source like '%p_request_id::text%'
        )
      from helper_contract
      where oid = to_regprocedure(
        'coachfort_internal.chat_request_lock(uuid,uuid)'
      )
    ) request_validation_contract,
    (
      select authenticated_execute = 4
        and anon_execute = 0
        and service_execute = 0
        and public_execute = 0
      from function_acl
    ) exact_rpc_acl,
    (select grant_count = 0 from browser_dml) browser_write_contract,
    not exists (
      select 1
      from new_functions
      where source like '%community_posts%'
        or source like '%community_comments%'
        or source like '%community_hub%'
        or source like '%academy_announcements%'
    ) adjacent_domain_separation
)
select
  contracts.*,
  counts.*,
  (
    select jsonb_agg(identity order by identity)
    from named_rpc_inventory
  ) final_chat_rpc_identities,
  (
    select jsonb_agg(identity order by identity)
    from direct_message_writers
  ) final_direct_message_writers,
  (
    select jsonb_agg(
      procedure.oid::regprocedure::text
      order by procedure.oid::regprocedure::text
    )
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        procedure.proname like '%community%'
        or procedure.proname like '%announcement%'
      )
  ) adjacent_authority_inventory,
  (
    request_aware_writer_contract
    and thread_creation_atomic_contract
    and exact_direct_writer_contract
    and exact_named_rpc_inventory
    and no_alternate_writer_wrapper
    and legacy_identities_absent
    and request_column_contract
    and request_unique_contract
    and request_immutable_contract
    and private_helper_contract
    and request_validation_contract
    and exact_rpc_acl
    and browser_write_contract
    and adjacent_domain_separation
  ) security_gate
from contracts cross join counts;
*/
