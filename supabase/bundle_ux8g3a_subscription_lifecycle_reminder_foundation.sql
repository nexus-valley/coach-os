-- Bundle UX-8G3A: Subscription lifecycle reminder foundation.
-- Review before execution. Scheduling remains intentionally inactive.

/*
PRE-APPLY READ-ONLY VERIFICATION

with required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.tenant_members'),
    ('public.subscription_plans'),
    ('public.tenant_subscription_assignments'),
    ('public.tenant_payment_orders'),
    ('public.notifications'),
    ('coachfort_internal.transactional_email_outbox'),
    ('coachfort_internal.transactional_email_attempts'),
    ('coachfort_internal.transactional_email_suppressions')
), relation_state as (
  select identity, to_regclass(identity) is not null as installed
  from required_relations
), required_functions(identity) as (
  values
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'),
    ('coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)'),
    ('coachfort_internal.transactional_email_normalize_recipient(text)'),
    ('coachfort_internal.transactional_email_payload_valid(text,jsonb)'),
    ('coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb)'),
    ('public.claim_transactional_email_batch_server(text,integer,integer)'),
    ('public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)')
), function_state as (
  select identity, to_regprocedure(identity) is not null as installed
  from required_functions
), lifecycle_state as (
  select
    procedure.oid is not null as installed,
    pg_get_userbyid(procedure.proowner) = 'postgres' as postgres_owned,
    procedure.prosecdef as security_definer,
    procedure.proconfig @> array['search_path=public, pg_temp']::text[]
      as fixed_search_path
  from (select to_regprocedure(
    'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
  ) as oid) expected
  left join pg_proc procedure on procedure.oid = expected.oid
), outbox_state as (
  select
    class.relname = 'transactional_email_outbox' as canonical_outbox_present,
    pg_get_userbyid(class.relowner) = 'postgres' as postgres_owned,
    class.relrowsecurity as rls_enabled,
    exists (
      select 1 from pg_constraint constraint_state
      where constraint_state.conrelid = class.oid
        and constraint_state.conname = 'transactional_email_outbox_event_key_unique'
        and constraint_state.contype = 'u'
        and not constraint_state.condeferrable
    ) as event_key_unique,
    not has_table_privilege('anon', class.oid, 'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege(
        'authenticated', class.oid, 'SELECT,INSERT,UPDATE,DELETE'
      ) as browser_access_absent
  from pg_class class
  where class.oid = to_regclass(
    'coachfort_internal.transactional_email_outbox'
  )
), template_constraint_source as (
  select pg_get_constraintdef(constraint_state.oid) as source
  from pg_constraint constraint_state
  where constraint_state.conrelid = to_regclass(
    'coachfort_internal.transactional_email_outbox'
  )
    and constraint_state.conname = 'transactional_email_outbox_template_check'
), template_constraint_state as (
  select
    coalesce((
      select array_agg(template_match.value[1] order by template_match.value[1])
      from template_constraint_source constraint_source
      cross join lateral regexp_matches(
        constraint_source.source, '''([^'']+)''', 'g'
      ) template_match(value)
    ), array[]::text[]) = array['coach.welcome', 'coach.workspace_ready']
      as exact_two_template_baseline
), payload_validator_source as (
  select
    procedure.oid,
    procedure.proowner,
    procedure.prosecdef,
    procedure.proconfig,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) as source
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'coachfort_internal.transactional_email_payload_valid(text,jsonb)'
  )
), payload_validator_state as (
  select
    pg_get_userbyid(validator.proowner) = 'postgres' as postgres_owned,
    not validator.prosecdef as security_invoker,
    validator.proconfig @> array['search_path=public, pg_temp']::text[]
      as fixed_search_path,
    not coalesce(has_function_privilege('anon', validator.oid, 'EXECUTE'), false)
      and not coalesce(has_function_privilege(
        'authenticated', validator.oid, 'EXECUTE'
      ), false)
      and not coalesce(has_function_privilege(
        'service_role', validator.oid, 'EXECUTE'
      ), false)
      and not exists (
        select 1 from aclexplode(coalesce(
          (select procedure.proacl from pg_proc procedure
            where procedure.oid = validator.oid),
          acldefault('f', validator.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) as execute_private,
    coalesce((
      select array_agg(template_match.value[1] order by template_match.value[1])
      from regexp_matches(
        validator.source,
        'when p_template_key = ''([^'']+)''',
        'g'
      ) template_match(value)
    ), array[]::text[]) = array['coach.welcome', 'coach.workspace_ready']
      as exact_two_template_branches,
    validator.source like '%octet_length(p_payload::text) > 8192%'
      and validator.source like
        '%p_payload - array[''coachname'', ''tenantname''] = ''{}''::jsonb%'
      and validator.source like
        '%p_payload - array[''appurl'', ''publicpageurl'', ''tenantname''] = ''{}''::jsonb%'
      and validator.source like '%else false%'
      as expected_prior_semantics
  from payload_validator_source validator
), notification_state as (
  select
    exists (
      select 1 from pg_constraint constraint_state
      where constraint_state.conrelid = to_regclass('public.notifications')
        and pg_get_constraintdef(constraint_state.oid) like '%subscription_notice%'
    ) as subscription_notice_supported,
    lower(regexp_replace(
      pg_get_functiondef(to_regprocedure(
        'coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)'
      )), '[[:space:]]+', ' ', 'g'
    )) like '%p_notification_type = ''subscription_notice''%'
      as inactive_boundary_preserved,
    not has_table_privilege('anon', 'public.notifications', 'INSERT,UPDATE,DELETE')
      and not has_table_privilege(
        'authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE'
      ) as browser_writes_absent
), conflicts as (
  select
    to_regclass(
      'coachfort_internal.subscription_lifecycle_reminder_deliveries'
    ) is not null as ledger_exists,
    exists (
      select 1 from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('public', 'coachfort_internal')
        and procedure.proname in (
          'subscription_lifecycle_reminder_candidates',
          'subscription_lifecycle_reminder_delivery_is_current',
          'subscription_lifecycle_reminder_ledger_immutable',
          'enqueue_subscription_lifecycle_reminders_server',
          'subscription_lifecycle_reminder_delivery_is_current_server'
        )
    ) as functions_exist
), baseline_counts as (
  select jsonb_build_object(
    'subscription_assignments', (select count(*) from public.tenant_subscription_assignments),
    'current_subscription_assignments', (select count(*) from public.tenant_subscription_assignments where is_current),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'notifications', (select count(*) from public.notifications),
    'email_outbox', (select count(*) from coachfort_internal.transactional_email_outbox)
  ) as value
), readiness as (
  select
    not exists (select 1 from relation_state where not installed)
    and not exists (select 1 from function_state where not installed)
    and (select installed and postgres_owned and security_definer
      and fixed_search_path from lifecycle_state)
    and (select canonical_outbox_present and postgres_owned and rls_enabled
      and event_key_unique and browser_access_absent from outbox_state)
    and (select exact_two_template_baseline from template_constraint_state)
    and (select postgres_owned and security_invoker and fixed_search_path
      and execute_private and exact_two_template_branches
      and expected_prior_semantics from payload_validator_state)
    and (select subscription_notice_supported and inactive_boundary_preserved
      and browser_writes_absent from notification_state)
    and to_regprocedure('extensions.digest(bytea,text)') is not null
    and not (select ledger_exists or functions_exist from conflicts)
      as ready_for_apply
)
select jsonb_pretty(jsonb_build_object(
  'ready_for_apply', (select ready_for_apply from readiness),
  'relations', (select jsonb_agg(to_jsonb(relation_state) order by identity) from relation_state),
  'functions', (select jsonb_agg(to_jsonb(function_state) order by identity) from function_state),
  'lifecycle', (select to_jsonb(lifecycle_state) from lifecycle_state),
  'outbox', (select to_jsonb(outbox_state) from outbox_state),
  'template_constraint', (select to_jsonb(template_constraint_state) from template_constraint_state),
  'payload_validator', (select to_jsonb(payload_validator_state) from payload_validator_state),
  'notifications', (select to_jsonb(notification_state) from notification_state),
  'conflicts', (select to_jsonb(conflicts) from conflicts),
  'baseline_counts', (select value from baseline_counts)
));
*/

begin;

do $$
declare
  v_notification_source text;
  v_payload_source text;
  v_payload_template_keys text[];
  v_template_constraint_keys text[];
begin
  if to_regclass('public.tenants') is null
     or to_regclass('public.tenant_members') is null
     or to_regclass('public.subscription_plans') is null
     or to_regclass('public.tenant_subscription_assignments') is null
     or to_regclass('public.tenant_payment_orders') is null
     or to_regclass('public.notifications') is null
     or to_regclass('coachfort_internal.transactional_email_outbox') is null
     or to_regclass('coachfort_internal.transactional_email_attempts') is null
     or to_regclass('coachfort_internal.transactional_email_suppressions') is null
     or to_regprocedure(
       'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.transactional_email_normalize_recipient(text)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.transactional_email_payload_valid(text,jsonb)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb)'
     ) is null
     or to_regprocedure(
       'public.claim_transactional_email_batch_server(text,integer,integer)'
     ) is null
     or to_regprocedure(
       'public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)'
     ) is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'UX-8G3A prerequisites are missing.' using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_proc procedure
    where procedure.oid = to_regprocedure(
      'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
    )
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'UX-8G3A lifecycle authority has drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_class class
    where class.oid = to_regclass(
      'coachfort_internal.transactional_email_outbox'
    )
      and (
        pg_get_userbyid(class.relowner) <> 'postgres'
        or not class.relrowsecurity
        or has_table_privilege('anon', class.oid, 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege(
          'authenticated', class.oid, 'SELECT,INSERT,UPDATE,DELETE'
        )
      )
  ) then
    raise exception 'UX-8G3A transactional email authority has drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_constraint constraint_state
    where constraint_state.conrelid = to_regclass(
      'coachfort_internal.transactional_email_outbox'
    )
      and constraint_state.conname =
        'transactional_email_outbox_event_key_unique'
      and constraint_state.contype = 'u'
      and not constraint_state.condeferrable
  ) then
    raise exception 'UX-8G3A outbox event-key authority has drifted.'
      using errcode = '55000';
  end if;

  select coalesce(
    array_agg(template_match.value[1] order by template_match.value[1]),
    array[]::text[]
  ) into v_template_constraint_keys
  from pg_constraint constraint_state
  cross join lateral regexp_matches(
    pg_get_constraintdef(constraint_state.oid), '''([^'']+)''', 'g'
  ) template_match(value)
  where constraint_state.conrelid = to_regclass(
    'coachfort_internal.transactional_email_outbox'
  )
    and constraint_state.conname =
      'transactional_email_outbox_template_check';

  select lower(regexp_replace(
    pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
  )) into v_payload_source
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'coachfort_internal.transactional_email_payload_valid(text,jsonb)'
  )
    and pg_get_userbyid(procedure.proowner) = 'postgres'
    and not procedure.prosecdef
    and procedure.proconfig @> array['search_path=public, pg_temp']::text[]
    and not coalesce(has_function_privilege(
      'anon', procedure.oid, 'EXECUTE'
    ), false)
    and not coalesce(has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    ), false)
    and not coalesce(has_function_privilege(
      'service_role', procedure.oid, 'EXECUTE'
    ), false)
    and not exists (
      select 1 from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    );

  select coalesce(
    array_agg(template_match.value[1] order by template_match.value[1]),
    array[]::text[]
  ) into v_payload_template_keys
  from regexp_matches(
    v_payload_source,
    'when p_template_key = ''([^'']+)''',
    'g'
  ) template_match(value);

  if v_template_constraint_keys is distinct from
       array['coach.welcome', 'coach.workspace_ready']::text[]
     or v_payload_template_keys is distinct from
       array['coach.welcome', 'coach.workspace_ready']::text[]
     or v_payload_source not like '%octet_length(p_payload::text) > 8192%'
     or v_payload_source not like
       '%p_payload - array[''coachname'', ''tenantname''] = ''{}''::jsonb%'
     or v_payload_source not like
       '%p_payload - array[''appurl'', ''publicpageurl'', ''tenantname''] = ''{}''::jsonb%'
     or v_payload_source not like '%else false%' then
    raise exception 'UX-8G3A transactional email template contract has drifted.'
      using errcode = '55000';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_notification_source;
  if not exists (
       select 1 from pg_constraint constraint_state
       where constraint_state.conrelid = to_regclass('public.notifications')
         and pg_get_constraintdef(constraint_state.oid)
           like '%subscription_notice%'
     )
     or v_notification_source not like
       '%p_notification_type = ''subscription_notice''%'
     or has_table_privilege('anon', 'public.notifications', 'INSERT,UPDATE,DELETE')
     or has_table_privilege(
       'authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE'
     ) then
    raise exception 'UX-8G3A notification authority has drifted.'
      using errcode = '55000';
  end if;

  if to_regclass(
       'coachfort_internal.subscription_lifecycle_reminder_deliveries'
     ) is not null
     or exists (
       select 1 from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname in ('public', 'coachfort_internal')
         and procedure.proname in (
           'subscription_lifecycle_reminder_candidates',
           'subscription_lifecycle_reminder_delivery_is_current',
           'subscription_lifecycle_reminder_ledger_immutable',
           'enqueue_subscription_lifecycle_reminders_server',
           'subscription_lifecycle_reminder_delivery_is_current_server'
         )
     ) then
    raise exception 'Conflicting UX-8G3A reminder objects already exist.'
      using errcode = '55000';
  end if;
end;
$$;

alter table coachfort_internal.transactional_email_outbox
  drop constraint transactional_email_outbox_template_check;
alter table coachfort_internal.transactional_email_outbox
  add constraint transactional_email_outbox_template_check check (
    template_key in (
      'coach.welcome',
      'coach.workspace_ready',
      'billing.subscription_lifecycle'
    )
  );

create or replace function coachfort_internal.transactional_email_payload_valid(
  p_template_key text,
  p_payload jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(case
    when p_payload is null
      or jsonb_typeof(p_payload) <> 'object'
      or octet_length(p_payload::text) > 8192 then false
    when p_template_key = 'coach.welcome' then
      p_payload - array['coachName', 'tenantName'] = '{}'::jsonb
      and (not (p_payload ? 'coachName') or jsonb_typeof(p_payload->'coachName') in ('string', 'null'))
      and (not (p_payload ? 'tenantName') or jsonb_typeof(p_payload->'tenantName') in ('string', 'null'))
    when p_template_key = 'coach.workspace_ready' then
      p_payload - array['appUrl', 'publicPageUrl', 'tenantName'] = '{}'::jsonb
      and jsonb_typeof(p_payload->'appUrl') = 'string'
      and length(btrim(p_payload->>'appUrl')) between 1 and 2048
      and btrim(p_payload->>'appUrl') ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
      and (not (p_payload ? 'publicPageUrl') or jsonb_typeof(p_payload->'publicPageUrl') in ('string', 'null'))
      and (not (p_payload ? 'tenantName') or jsonb_typeof(p_payload->'tenantName') in ('string', 'null'))
    when p_template_key = 'billing.subscription_lifecycle' then
      p_payload - array[
        'deadlineDate', 'event', 'planName', 'subscriptionUrl', 'supportUrl',
        'workspaceName'
      ] = '{}'::jsonb
      and p_payload->>'event' in (
        'trial_ending', 'trial_expired', 'renewal_due_soon',
        'grace_started', 'grace_ending', 'subscription_expired'
      )
      and jsonb_typeof(p_payload->'deadlineDate') = 'string'
      and p_payload->>'deadlineDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and jsonb_typeof(p_payload->'workspaceName') = 'string'
      and length(btrim(p_payload->>'workspaceName')) between 1 and 180
      and (not (p_payload ? 'planName') or jsonb_typeof(p_payload->'planName') in ('string', 'null'))
      and coalesce(length(p_payload->>'planName'), 0) <= 180
      and jsonb_typeof(p_payload->'subscriptionUrl') = 'string'
      and length(btrim(p_payload->>'subscriptionUrl')) between 1 and 2048
      and btrim(p_payload->>'subscriptionUrl') ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
      and jsonb_typeof(p_payload->'supportUrl') = 'string'
      and length(btrim(p_payload->>'supportUrl')) between 1 and 2048
      and btrim(p_payload->>'supportUrl') ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
    else false
  end, false);
$$;

create table coachfort_internal.subscription_lifecycle_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  assignment_id uuid not null references public.tenant_subscription_assignments(id) on delete restrict,
  event_type text not null check (event_type in (
    'trial_ending', 'trial_expired', 'renewal_due_soon',
    'grace_started', 'grace_ending', 'subscription_expired'
  )),
  lifecycle_boundary_at timestamptz not null,
  intended_on date not null,
  channel text not null check (channel in ('email', 'in_app')),
  recipient_user_id uuid,
  recipient_email text,
  outbox_id uuid references coachfort_internal.transactional_email_outbox(id) on delete restrict,
  notification_id uuid,
  created_at timestamptz not null default now(),
  constraint subscription_lifecycle_reminder_delivery_shape_check check (
    (
      channel = 'email'
      and recipient_email is not null
      and recipient_user_id is null
      and outbox_id is not null
      and notification_id is null
    ) or (
      channel = 'in_app'
      and recipient_user_id is not null
      and recipient_email is null
      and outbox_id is null
      and notification_id is not null
    )
  ),
  constraint subscription_lifecycle_reminder_email_normalized_check check (
    recipient_email is null or recipient_email = lower(btrim(recipient_email))
  )
);

create unique index subscription_lifecycle_reminder_email_unique
on coachfort_internal.subscription_lifecycle_reminder_deliveries (
  tenant_id, assignment_id, event_type, lifecycle_boundary_at, recipient_email
)
where channel = 'email';

create unique index subscription_lifecycle_reminder_user_unique
on coachfort_internal.subscription_lifecycle_reminder_deliveries (
  tenant_id, assignment_id, event_type, lifecycle_boundary_at, recipient_user_id
)
where channel = 'in_app';

create unique index subscription_lifecycle_reminder_outbox_unique
on coachfort_internal.subscription_lifecycle_reminder_deliveries (outbox_id)
where outbox_id is not null;

create unique index subscription_lifecycle_reminder_notification_unique
on coachfort_internal.subscription_lifecycle_reminder_deliveries (notification_id)
where notification_id is not null;

create function coachfort_internal.subscription_lifecycle_reminder_ledger_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Subscription lifecycle reminder evidence is immutable.'
    using errcode = '55000';
end;
$$;

create trigger subscription_lifecycle_reminder_ledger_immutable
before update or delete
on coachfort_internal.subscription_lifecycle_reminder_deliveries
for each row execute function
  coachfort_internal.subscription_lifecycle_reminder_ledger_immutable();

create function coachfort_internal.subscription_lifecycle_reminder_candidates(
  p_as_of timestamptz
)
returns table(
  tenant_id uuid,
  assignment_id uuid,
  event_type text,
  lifecycle_boundary_at timestamptz,
  intended_on date,
  workspace_name text,
  plan_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with authority as (
    select
      tenant.id as tenant_id,
      assignment.id as assignment_id,
      tenant.name as workspace_name,
      plan.name as plan_name,
      coalesce(p_as_of, now()) as as_of,
      (coalesce(p_as_of, now()) at time zone 'UTC')::date as utc_today,
      coachfort_internal.tenant_subscription_effective_lifecycle(tenant.id)
        as lifecycle
    from public.tenants tenant
    join public.tenant_subscription_assignments assignment
      on assignment.tenant_id = tenant.id
     and assignment.is_current
    left join public.subscription_plans plan on plan.id = assignment.plan_id
  ), candidates as (
    select authority.*, 'trial_ending'::text as event_type,
      (lifecycle->>'trial_ends_at')::timestamptz as boundary_at,
      ((lifecycle->>'trial_ends_at')::timestamptz at time zone 'UTC')::date - 3
        as intended_on
    from authority
    where lifecycle->>'assignment_id' = assignment_id::text
      and lifecycle->>'stored_status' = 'trial'
      and lifecycle->>'reason' = 'within_trial_period'
      and as_of < (lifecycle->>'trial_ends_at')::timestamptz
      and utc_today >=
        ((lifecycle->>'trial_ends_at')::timestamptz at time zone 'UTC')::date - 3
    union all
    select authority.*, 'trial_expired',
      (lifecycle->>'trial_ends_at')::timestamptz,
      ((lifecycle->>'trial_ends_at')::timestamptz at time zone 'UTC')::date
    from authority
    where lifecycle->>'assignment_id' = assignment_id::text
      and lifecycle->>'stored_status' = 'trial'
      and lifecycle->>'reason' = 'trial_period_elapsed'
      and utc_today >=
        ((lifecycle->>'trial_ends_at')::timestamptz at time zone 'UTC')::date
    union all
    select authority.*, 'renewal_due_soon',
      (lifecycle->>'current_period_end')::timestamptz,
      ((lifecycle->>'current_period_end')::timestamptz at time zone 'UTC')::date - 7
    from authority
    where lifecycle->>'assignment_id' = assignment_id::text
      and lifecycle->>'effective_state' = 'active'
      and coalesce((lifecycle->>'operational_allowed')::boolean, false)
      and lifecycle->>'stored_status' in ('active', 'grace', 'past_due')
      and as_of < (lifecycle->>'current_period_end')::timestamptz
      and utc_today >=
        ((lifecycle->>'current_period_end')::timestamptz at time zone 'UTC')::date - 7
    union all
    select authority.*, 'grace_started',
      (lifecycle->>'current_period_end')::timestamptz,
      ((lifecycle->>'current_period_end')::timestamptz at time zone 'UTC')::date
    from authority
    where lifecycle->>'assignment_id' = assignment_id::text
      and lifecycle->>'effective_state' = 'grace'
      and coalesce((lifecycle->>'operational_allowed')::boolean, false)
      and utc_today >=
        ((lifecycle->>'current_period_end')::timestamptz at time zone 'UTC')::date
      and not (
        as_of < (lifecycle->>'grace_period_ends_at')::timestamptz
        and utc_today >=
          ((lifecycle->>'grace_period_ends_at')::timestamptz
            at time zone 'UTC')::date - 2
      )
    union all
    select authority.*, 'grace_ending',
      (lifecycle->>'grace_period_ends_at')::timestamptz,
      ((lifecycle->>'grace_period_ends_at')::timestamptz at time zone 'UTC')::date - 2
    from authority
    where lifecycle->>'assignment_id' = assignment_id::text
      and lifecycle->>'effective_state' = 'grace'
      and coalesce((lifecycle->>'operational_allowed')::boolean, false)
      and as_of < (lifecycle->>'grace_period_ends_at')::timestamptz
      and utc_today >=
        ((lifecycle->>'grace_period_ends_at')::timestamptz at time zone 'UTC')::date - 2
    union all
    select authority.*, 'subscription_expired',
      (lifecycle->>'grace_period_ends_at')::timestamptz,
      ((lifecycle->>'grace_period_ends_at')::timestamptz at time zone 'UTC')::date
    from authority
    where lifecycle->>'assignment_id' = assignment_id::text
      and lifecycle->>'stored_status' in ('active', 'grace', 'past_due')
      and lifecycle->>'reason' = 'grace_period_elapsed'
      and utc_today >=
        ((lifecycle->>'grace_period_ends_at')::timestamptz at time zone 'UTC')::date
  )
  select candidate.tenant_id, candidate.assignment_id, candidate.event_type,
    candidate.boundary_at, candidate.intended_on, candidate.workspace_name,
    candidate.plan_name
  from candidates candidate
  where candidate.boundary_at is not null
  order by candidate.intended_on, candidate.tenant_id, candidate.event_type;
$$;

create function coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(
  p_outbox_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery coachfort_internal.subscription_lifecycle_reminder_deliveries%rowtype;
  v_lifecycle jsonb;
begin
  select delivery.* into v_delivery
  from coachfort_internal.subscription_lifecycle_reminder_deliveries delivery
  join coachfort_internal.transactional_email_outbox outbox
    on outbox.id = delivery.outbox_id
   and outbox.template_key = 'billing.subscription_lifecycle'
  where delivery.outbox_id = p_outbox_id
    and delivery.channel = 'email';

  if not found or not exists (
    select 1 from public.tenant_subscription_assignments assignment
    where assignment.id = v_delivery.assignment_id
      and assignment.tenant_id = v_delivery.tenant_id
      and assignment.is_current
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from public.tenant_members member
    join auth.users auth_user on auth_user.id = member.user_id
    where member.tenant_id = v_delivery.tenant_id
      and member.role in ('owner', 'admin')
      and auth_user.email is not null
      and lower(btrim(auth_user.email)) = v_delivery.recipient_email
      and lower(btrim(auth_user.email))
        ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    return false;
  end if;

  v_lifecycle := coachfort_internal.tenant_subscription_effective_lifecycle(
    v_delivery.tenant_id
  );
  if v_lifecycle->>'assignment_id' is distinct from
       v_delivery.assignment_id::text then
    return false;
  end if;

  return case v_delivery.event_type
    when 'trial_ending' then
      v_lifecycle->>'reason' = 'within_trial_period'
      and (v_lifecycle->>'trial_ends_at')::timestamptz
        is not distinct from v_delivery.lifecycle_boundary_at
      and now() < v_delivery.lifecycle_boundary_at
    when 'trial_expired' then
      v_lifecycle->>'reason' = 'trial_period_elapsed'
      and (v_lifecycle->>'trial_ends_at')::timestamptz
        is not distinct from v_delivery.lifecycle_boundary_at
    when 'renewal_due_soon' then
      v_lifecycle->>'effective_state' = 'active'
      and coalesce((v_lifecycle->>'operational_allowed')::boolean, false)
      and (v_lifecycle->>'current_period_end')::timestamptz
        is not distinct from v_delivery.lifecycle_boundary_at
      and now() < v_delivery.lifecycle_boundary_at
    when 'grace_started' then
      v_lifecycle->>'effective_state' = 'grace'
      and coalesce((v_lifecycle->>'operational_allowed')::boolean, false)
      and (v_lifecycle->>'current_period_end')::timestamptz
        is not distinct from v_delivery.lifecycle_boundary_at
      and not (
        now() < (v_lifecycle->>'grace_period_ends_at')::timestamptz
        and (now() at time zone 'UTC')::date >=
          ((v_lifecycle->>'grace_period_ends_at')::timestamptz
            at time zone 'UTC')::date - 2
      )
    when 'grace_ending' then
      v_lifecycle->>'effective_state' = 'grace'
      and coalesce((v_lifecycle->>'operational_allowed')::boolean, false)
      and (v_lifecycle->>'grace_period_ends_at')::timestamptz
        is not distinct from v_delivery.lifecycle_boundary_at
      and now() < v_delivery.lifecycle_boundary_at
    when 'subscription_expired' then
      v_lifecycle->>'reason' = 'grace_period_elapsed'
      and (v_lifecycle->>'grace_period_ends_at')::timestamptz
        is not distinct from v_delivery.lifecycle_boundary_at
    else false
  end;
end;
$$;

create function public.subscription_lifecycle_reminder_delivery_is_current_server(
  p_outbox_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(
    p_outbox_id
  );
$$;

create function public.enqueue_subscription_lifecycle_reminders_server(
  p_dry_run boolean default false,
  p_limit integer default 500
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_email record;
  v_member record;
  v_outbox record;
  v_event_key text;
  v_deadline_date text;
  v_deadline_display text;
  v_notification_id uuid;
  v_notification_title text;
  v_notification_message text;
  v_rows integer;
  v_eligible_events integer := 0;
  v_recipient_users integer := 0;
  v_unique_email_recipients integer := 0;
  v_email_created integer := 0;
  v_email_replayed integer := 0;
  v_in_app_created integer := 0;
  v_in_app_replayed integer := 0;
begin
  if p_dry_run is null or p_limit not between 1 and 500 then
    raise exception 'Subscription reminder processing bounds are invalid.'
      using errcode = '22023';
  end if;

  if not p_dry_run then
    perform pg_advisory_xact_lock(
      hashtextextended('ux8g3a_subscription_lifecycle_reminders', 83)
    );
  end if;

  for v_candidate in
    select candidate.*
    from coachfort_internal.subscription_lifecycle_reminder_candidates(now())
      candidate
    where exists (
      select 1
      from public.tenant_members member
      left join auth.users auth_user on auth_user.id = member.user_id
      where member.tenant_id = candidate.tenant_id
        and member.role in ('owner', 'admin')
        and (
          not exists (
            select 1
            from coachfort_internal.subscription_lifecycle_reminder_deliveries
              delivery
            where delivery.tenant_id = candidate.tenant_id
              and delivery.assignment_id = candidate.assignment_id
              and delivery.event_type = candidate.event_type
              and delivery.lifecycle_boundary_at =
                candidate.lifecycle_boundary_at
              and delivery.channel = 'in_app'
              and delivery.recipient_user_id = member.user_id
          )
          or (
            auth_user.email is not null
            and lower(btrim(auth_user.email))
              ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
            and not exists (
              select 1
              from coachfort_internal.subscription_lifecycle_reminder_deliveries
                delivery
              where delivery.tenant_id = candidate.tenant_id
                and delivery.assignment_id = candidate.assignment_id
                and delivery.event_type = candidate.event_type
                and delivery.lifecycle_boundary_at =
                  candidate.lifecycle_boundary_at
                and delivery.channel = 'email'
                and delivery.recipient_email = lower(btrim(auth_user.email))
            )
          )
        )
    )
    order by candidate.intended_on, candidate.tenant_id, candidate.event_type
    limit p_limit
  loop
    v_eligible_events := v_eligible_events + 1;
    v_deadline_date := to_char(
      v_candidate.lifecycle_boundary_at at time zone 'UTC', 'YYYY-MM-DD'
    );
    v_deadline_display :=
      extract(day from v_candidate.lifecycle_boundary_at at time zone 'UTC')
        ::integer::text
      || ' ' || (array[
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ])[extract(
        month from v_candidate.lifecycle_boundary_at at time zone 'UTC'
      )::integer]
      || ' ' || extract(
        year from v_candidate.lifecycle_boundary_at at time zone 'UTC'
      )::integer::text;

    select count(*)::integer into v_rows
    from public.tenant_members member
    where member.tenant_id = v_candidate.tenant_id
      and member.role in ('owner', 'admin');
    v_recipient_users := v_recipient_users + v_rows;

    select count(*)::integer into v_rows
    from (
      select distinct lower(btrim(auth_user.email)) as recipient_email
      from public.tenant_members member
      join auth.users auth_user on auth_user.id = member.user_id
      where member.tenant_id = v_candidate.tenant_id
        and member.role in ('owner', 'admin')
        and auth_user.email is not null
        and lower(btrim(auth_user.email))
          ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ) recipients;
    v_unique_email_recipients := v_unique_email_recipients + v_rows;

    if p_dry_run then
      continue;
    end if;

    for v_email in
      select distinct lower(btrim(auth_user.email)) as recipient_email
      from public.tenant_members member
      join auth.users auth_user on auth_user.id = member.user_id
      where member.tenant_id = v_candidate.tenant_id
        and member.role in ('owner', 'admin')
        and auth_user.email is not null
        and lower(btrim(auth_user.email))
          ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        and not exists (
          select 1
          from coachfort_internal.subscription_lifecycle_reminder_deliveries
            delivery
          where delivery.tenant_id = v_candidate.tenant_id
            and delivery.assignment_id = v_candidate.assignment_id
            and delivery.event_type = v_candidate.event_type
            and delivery.lifecycle_boundary_at =
              v_candidate.lifecycle_boundary_at
            and delivery.channel = 'email'
            and delivery.recipient_email = lower(btrim(auth_user.email))
        )
      order by recipient_email
    loop
      v_event_key := 'subscription-lifecycle:' || v_candidate.event_type || ':'
        || encode(extensions.digest(convert_to(concat_ws('|',
          v_candidate.tenant_id::text,
          v_candidate.assignment_id::text,
          v_candidate.event_type,
          to_char(
            v_candidate.lifecycle_boundary_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          v_email.recipient_email
        ), 'UTF8'), 'sha256'), 'hex');

      select * into v_outbox
      from coachfort_internal.enqueue_transactional_email(
        v_event_key,
        v_candidate.tenant_id,
        v_email.recipient_email,
        'billing.subscription_lifecycle',
        jsonb_build_object(
          'deadlineDate', v_deadline_date,
          'event', v_candidate.event_type,
          'planName', left(v_candidate.plan_name, 180),
          'subscriptionUrl', 'https://coachfort.com/app/subscription',
          'supportUrl', 'https://coachfort.com/support',
          'workspaceName', left(v_candidate.workspace_name, 180)
        )
      );

      insert into coachfort_internal.subscription_lifecycle_reminder_deliveries (
        tenant_id, assignment_id, event_type, lifecycle_boundary_at,
        intended_on, channel, recipient_email, outbox_id
      ) values (
        v_candidate.tenant_id, v_candidate.assignment_id,
        v_candidate.event_type, v_candidate.lifecycle_boundary_at,
        v_candidate.intended_on, 'email', v_email.recipient_email,
        v_outbox.outbox_id
      ) on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 then
        v_email_created := v_email_created + 1;
      else
        v_email_replayed := v_email_replayed + 1;
      end if;
    end loop;

    for v_member in
      select member.user_id
      from public.tenant_members member
      where member.tenant_id = v_candidate.tenant_id
        and member.role in ('owner', 'admin')
      order by member.user_id
    loop
      if exists (
        select 1
        from coachfort_internal.subscription_lifecycle_reminder_deliveries
          delivery
        where delivery.tenant_id = v_candidate.tenant_id
          and delivery.assignment_id = v_candidate.assignment_id
          and delivery.event_type = v_candidate.event_type
          and delivery.lifecycle_boundary_at =
            v_candidate.lifecycle_boundary_at
          and delivery.channel = 'in_app'
          and delivery.recipient_user_id = v_member.user_id
      ) then
        v_in_app_replayed := v_in_app_replayed + 1;
        continue;
      end if;

      v_notification_title := case v_candidate.event_type
        when 'trial_ending' then 'Your CoachFort trial ends soon'
        when 'trial_expired' then 'Your CoachFort trial has ended'
        when 'renewal_due_soon' then 'Your subscription is due for renewal soon'
        when 'grace_started' then 'Your renewal period has started'
        when 'grace_ending' then 'Your renewal period ends soon'
        else 'Your workspace access is paused'
      end;
      v_notification_message := case v_candidate.event_type
        when 'trial_ending' then
          'Your CoachFort trial ends on ' || v_deadline_display
          || '. Choose a plan or contact CoachFort support for help.'
        when 'trial_expired' then
          'Your CoachFort trial has ended. Your workspace data is safe.'
        when 'renewal_due_soon' then
          'Your CoachFort subscription is due for renewal on '
          || v_deadline_display || '. Review your subscription options.'
        when 'grace_started' then
          'Your workspace remains available during the renewal period.'
        when 'grace_ending' then
          'Your renewal period ends on ' || v_deadline_display
          || '. Review your subscription options.'
        else
          'Your workspace access is paused, but your data is safe.'
      end;
      v_notification_id := gen_random_uuid();

      insert into public.notifications (
        id, tenant_id, user_id, type, title, message, entity_type,
        severity, status, action_url, metadata_json
      ) values (
        v_notification_id, v_candidate.tenant_id, v_member.user_id,
        'subscription_notice', v_notification_title, v_notification_message,
        'subscription', case when v_candidate.event_type in (
          'trial_expired', 'subscription_expired'
        ) then 'critical' else 'warning' end,
        'unread', '/app/subscription', jsonb_build_object(
          'deadlineDate', v_deadline_date,
          'source', 'coachfort_subscription_lifecycle'
        )
      );

      insert into coachfort_internal.subscription_lifecycle_reminder_deliveries (
        tenant_id, assignment_id, event_type, lifecycle_boundary_at,
        intended_on, channel, recipient_user_id, notification_id
      ) values (
        v_candidate.tenant_id, v_candidate.assignment_id,
        v_candidate.event_type, v_candidate.lifecycle_boundary_at,
        v_candidate.intended_on, 'in_app', v_member.user_id,
        v_notification_id
      );
      v_in_app_created := v_in_app_created + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'eligible_events', v_eligible_events,
    'recipient_users', v_recipient_users,
    'unique_email_recipients', v_unique_email_recipients,
    'email_deliveries_created', v_email_created,
    'replayed_email_deliveries', v_email_replayed,
    'in_app_deliveries_created', v_in_app_created,
    'replayed_in_app_deliveries', v_in_app_replayed
  );
end;
$$;

alter table coachfort_internal.subscription_lifecycle_reminder_deliveries
  owner to postgres;
alter function coachfort_internal.transactional_email_payload_valid(text,jsonb)
  owner to postgres;
alter function coachfort_internal.subscription_lifecycle_reminder_ledger_immutable()
  owner to postgres;
alter function coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)
  owner to postgres;
alter function coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)
  owner to postgres;
alter function public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)
  owner to postgres;
alter function public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)
  owner to postgres;

alter table coachfort_internal.subscription_lifecycle_reminder_deliveries
  enable row level security;
revoke all on table
  coachfort_internal.subscription_lifecycle_reminder_deliveries
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.subscription_lifecycle_reminder_ledger_immutable()
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)
  to service_role;
grant execute on function
  public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)
  to service_role;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with function_contract as (
  select
    namespace.nspname,
    procedure.proname,
    pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
    pg_get_userbyid(procedure.proowner) as owner_name,
    procedure.prosecdef as security_definer,
    procedure.proconfig @> array['search_path=public, pg_temp']::text[]
      as fixed_search_path,
    coalesce(has_function_privilege('anon', procedure.oid, 'EXECUTE'), false)
      as anon_execute,
    coalesce(has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    ), false) as authenticated_execute,
    coalesce(has_function_privilege(
      'service_role', procedure.oid, 'EXECUTE'
    ), false) as service_role_execute,
    exists (
      select 1 from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) as source
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where (namespace.nspname, procedure.proname) in (
    ('coachfort_internal', 'subscription_lifecycle_reminder_candidates'),
    ('coachfort_internal', 'subscription_lifecycle_reminder_delivery_is_current'),
    ('coachfort_internal', 'subscription_lifecycle_reminder_ledger_immutable'),
    ('public', 'enqueue_subscription_lifecycle_reminders_server'),
    ('public', 'subscription_lifecycle_reminder_delivery_is_current_server')
  )
), constraint_state as (
  select
    count(*) filter (where constraint_state.conname =
      'subscription_lifecycle_reminder_delivery_shape_check') = 1
      as delivery_shape,
    count(*) filter (where constraint_state.conname =
      'subscription_lifecycle_reminder_email_normalized_check') = 1
      as normalized_email
  from pg_constraint constraint_state
  where constraint_state.conrelid = to_regclass(
    'coachfort_internal.subscription_lifecycle_reminder_deliveries'
  )
), index_state as (
  select
    count(*) filter (where index_state.indexname =
      'subscription_lifecycle_reminder_email_unique') = 1 as email_unique,
    count(*) filter (where index_state.indexname =
      'subscription_lifecycle_reminder_user_unique') = 1 as user_unique,
    count(*) filter (where index_state.indexname =
      'subscription_lifecycle_reminder_outbox_unique') = 1 as outbox_unique,
    count(*) filter (where index_state.indexname =
      'subscription_lifecycle_reminder_notification_unique') = 1
      as notification_unique
  from pg_indexes index_state
  where index_state.schemaname = 'coachfort_internal'
    and index_state.tablename = 'subscription_lifecycle_reminder_deliveries'
), outbox_state as (
  select
    pg_get_userbyid(class.relowner) = 'postgres' as postgres_owned,
    class.relrowsecurity as rls_enabled,
    exists (
      select 1 from pg_constraint constraint_state
      where constraint_state.conrelid = class.oid
        and constraint_state.conname =
          'transactional_email_outbox_event_key_unique'
        and constraint_state.contype = 'u'
        and not constraint_state.condeferrable
    ) as event_key_unique,
    not has_table_privilege('anon', class.oid, 'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege(
        'authenticated', class.oid, 'SELECT,INSERT,UPDATE,DELETE'
      ) as browser_access_absent
  from pg_class class
  where class.oid = to_regclass(
    'coachfort_internal.transactional_email_outbox'
  )
), template_constraint_source as (
  select pg_get_constraintdef(constraint_state.oid) as source
  from pg_constraint constraint_state
  where constraint_state.conrelid = to_regclass(
    'coachfort_internal.transactional_email_outbox'
  )
    and constraint_state.conname = 'transactional_email_outbox_template_check'
), template_constraint_state as (
  select
    coalesce((
      select array_agg(template_match.value[1] order by template_match.value[1])
      from template_constraint_source constraint_source
      cross join lateral regexp_matches(
        constraint_source.source, '''([^'']+)''', 'g'
      ) template_match(value)
    ), array[]::text[]) = array[
      'billing.subscription_lifecycle', 'coach.welcome', 'coach.workspace_ready'
    ] as exact_three_template_contract
), payload_validator_source as (
  select
    procedure.oid,
    procedure.proowner,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.proacl,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) as source
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'coachfort_internal.transactional_email_payload_valid(text,jsonb)'
  )
), payload_validator_state as (
  select
    pg_get_userbyid(validator.proowner) = 'postgres' as postgres_owned,
    not validator.prosecdef as security_invoker,
    validator.proconfig @> array['search_path=public, pg_temp']::text[]
      as fixed_search_path,
    not coalesce(has_function_privilege('anon', validator.oid, 'EXECUTE'), false)
      and not coalesce(has_function_privilege(
        'authenticated', validator.oid, 'EXECUTE'
      ), false)
      and not coalesce(has_function_privilege(
        'service_role', validator.oid, 'EXECUTE'
      ), false)
      and not exists (
        select 1 from aclexplode(coalesce(
          validator.proacl, acldefault('f', validator.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) as execute_private,
    coalesce((
      select array_agg(template_match.value[1] order by template_match.value[1])
      from regexp_matches(
        validator.source,
        'when p_template_key = ''([^'']+)''',
        'g'
      ) template_match(value)
    ), array[]::text[]) = array[
      'billing.subscription_lifecycle', 'coach.welcome', 'coach.workspace_ready'
    ] as exact_three_template_branches,
    validator.source like '%octet_length(p_payload::text) > 8192%'
      and validator.source like
        '%p_payload - array[''coachname'', ''tenantname''] = ''{}''::jsonb%'
      and validator.source like
        '%p_payload - array[''appurl'', ''publicpageurl'', ''tenantname''] = ''{}''::jsonb%'
      and validator.source like
        '%when p_template_key = ''billing.subscription_lifecycle''%'
      and validator.source like '%else false%'
      as expected_final_semantics
  from payload_validator_source validator
), notification_state as (
  select
    exists (
      select 1 from pg_constraint constraint_state
      where constraint_state.conrelid = to_regclass('public.notifications')
        and pg_get_constraintdef(constraint_state.oid)
          like '%subscription_notice%'
    ) as subscription_notice_supported,
    lower(regexp_replace(pg_get_functiondef(to_regprocedure(
      'coachfort_internal.notification_lifecycle_access_allowed(uuid,uuid,text)'
    )), '[[:space:]]+', ' ', 'g')) like
      '%p_notification_type = ''subscription_notice''%'
      as inactive_boundary_preserved,
    not has_table_privilege('anon', 'public.notifications', 'INSERT,UPDATE,DELETE')
      and not has_table_privilege(
        'authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE'
      ) as browser_writes_absent
), orchestration_state as (
  select
    (select source like '%tenant_subscription_effective_lifecycle%'
      from function_contract
      where nspname = 'coachfort_internal'
        and proname = 'subscription_lifecycle_reminder_candidates')
      as canonical_lifecycle_used,
    source like '%member.role in (''owner'', ''admin'')%'
      and source like '%join auth.users%'
      and source not like '%profiles.email%'
      and source not like '%owner_user_id%'
      as recipient_authority,
    source like '%pg_advisory_xact_lock%'
      and source like '%on conflict do nothing%'
      as concurrency_safe,
    source like
      '%from coachfort_internal.subscription_lifecycle_reminder_candidates(now()) candidate where exists (%'
      and source like '%delivery.recipient_user_id = member.user_id%'
      and source like
        '%delivery.recipient_email = lower(btrim(auth_user.email))%'
      and position('where exists (' in source) < position('limit p_limit' in source)
      and position('order by candidate.intended_on' in source)
        < position('limit p_limit' in source)
      as actionable_before_limit,
    substring(
      source
      from position('for v_email in' in source)
      for position('v_event_key :=' in source)
        - position('for v_email in' in source)
    ) like '%and not exists (%'
      and substring(
        source
        from position('for v_email in' in source)
        for position('v_event_key :=' in source)
          - position('for v_email in' in source)
      ) like '%delivery.channel = ''email''%'
      and substring(
        source
        from position('for v_email in' in source)
        for position('v_event_key :=' in source)
          - position('for v_email in' in source)
      ) like
        '%delivery.recipient_email = lower(btrim(auth_user.email))%'
      as satisfied_email_filtered,
    source like '%subscription_notice%'
      and source like '%/app/subscription%'
      as notification_boundary,
    source not like '%runtrialexpiringautomationfortenant%'
      and source not like '%tenants.trial_ends_at%'
      and source not like '%is_trial_active%'
      as legacy_authority_absent
  from function_contract
  where nspname = 'public'
    and proname = 'enqueue_subscription_lifecycle_reminders_server'
), candidate_state as (
  select
    source like '%tenant_subscription_effective_lifecycle%'
      and source like '%assignment.is_current%'
      as canonical_current_assignment,
    source like '%''grace_started''%'
      and source like '%''grace_ending''%'
      and source like
        '%and not ( as_of < (lifecycle->>''grace_period_ends_at'')::timestamptz%'
      and source like
        '%at time zone ''utc'')::date - 2%'
      as grace_overlap_suppressed
  from function_contract
  where nspname = 'coachfort_internal'
    and proname = 'subscription_lifecycle_reminder_candidates'
), delivery_revalidation_state as (
  select
    source like '%join auth.users auth_user on auth_user.id = member.user_id%'
      and source like '%member.role in (''owner'', ''admin'')%'
      and source like
        '%lower(btrim(auth_user.email)) = v_delivery.recipient_email%'
      and source not like '%profiles.email%'
      and source not like '%owner_user_id%'
      as current_recipient_required,
    source like '%tenant_subscription_effective_lifecycle%'
      and source like '%assignment.is_current%'
      as lifecycle_revalidation_preserved,
    source like
      '%when ''grace_started'' then v_lifecycle->>''effective_state'' = ''grace''%'
      and source like
        '%and not ( now() < (v_lifecycle->>''grace_period_ends_at'')::timestamptz%'
      and source like
        '%(now() at time zone ''utc'')::date >=%'
      and source like
        '%at time zone ''utc'')::date - 2%'
      as grace_send_overlap_suppressed
  from function_contract
  where nspname = 'coachfort_internal'
    and proname = 'subscription_lifecycle_reminder_delivery_is_current'
), security_state as (
  select
    count(*) = 5 as expected_function_count,
    bool_and(owner_name = 'postgres') as postgres_owned,
    bool_and(fixed_search_path) as fixed_search_path,
    bool_and(not anon_execute and not authenticated_execute and not public_execute)
      as browser_execute_absent,
    bool_and(case when nspname = 'public' then service_role_execute
      else not service_role_execute end) as exact_service_execution,
    bool_and(case
      when nspname = 'coachfort_internal'
        and proname = 'subscription_lifecycle_reminder_ledger_immutable'
        then not security_definer
      else security_definer
    end) as expected_security_definer
  from function_contract
), data_state as (
  select jsonb_build_object(
    'reminder_delivery_rows', (
      select count(*) from coachfort_internal.subscription_lifecycle_reminder_deliveries
    ),
    'subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
    ),
    'current_subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments where is_current
    ),
    'payment_orders', (
      select count(*) from public.tenant_payment_orders
    ),
    'notifications', (select count(*) from public.notifications),
    'email_outbox', (
      select count(*) from coachfort_internal.transactional_email_outbox
    )
  ) as value
), final_state as (
  select
    to_regclass(
      'coachfort_internal.subscription_lifecycle_reminder_deliveries'
    ) is not null
    and (select delivery_shape and normalized_email from constraint_state)
    and (select email_unique and user_unique and outbox_unique
      and notification_unique from index_state)
    and (select postgres_owned and rls_enabled and event_key_unique
      and browser_access_absent from outbox_state)
    and (select exact_three_template_contract from template_constraint_state)
    and (select postgres_owned and security_invoker and fixed_search_path
      and execute_private and exact_three_template_branches
      and expected_final_semantics from payload_validator_state)
    and (select subscription_notice_supported and inactive_boundary_preserved
      and browser_writes_absent from notification_state)
    and (select canonical_lifecycle_used and recipient_authority
      and concurrency_safe and actionable_before_limit
      and satisfied_email_filtered
      and notification_boundary and legacy_authority_absent
      from orchestration_state)
    and (select canonical_current_assignment and grace_overlap_suppressed
      from candidate_state)
    and (select current_recipient_required
      and lifecycle_revalidation_preserved and grace_send_overlap_suppressed
      from delivery_revalidation_state)
    and (select expected_function_count and postgres_owned and fixed_search_path
      and browser_execute_absent and exact_service_execution
      and expected_security_definer from security_state)
    and (select count(*) = 0 from coachfort_internal.subscription_lifecycle_reminder_deliveries)
    and not has_table_privilege(
      'anon', 'coachfort_internal.subscription_lifecycle_reminder_deliveries',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'coachfort_internal.subscription_lifecycle_reminder_deliveries',
      'SELECT,INSERT,UPDATE,DELETE'
    ) as security_gate
)
select jsonb_pretty(jsonb_build_object(
  'security_gate', (select security_gate from final_state),
  'functions', (select jsonb_agg(to_jsonb(function_contract)
    - 'source' order by nspname, proname) from function_contract),
  'constraints', (select to_jsonb(constraint_state) from constraint_state),
  'indexes', (select to_jsonb(index_state) from index_state),
  'outbox', (select to_jsonb(outbox_state) from outbox_state),
  'template_constraint', (select to_jsonb(template_constraint_state) from template_constraint_state),
  'payload_validator', (select to_jsonb(payload_validator_state) from payload_validator_state),
  'notifications', (select to_jsonb(notification_state) from notification_state),
  'orchestration', (select to_jsonb(orchestration_state) from orchestration_state),
  'candidates', (select to_jsonb(candidate_state) from candidate_state),
  'delivery_revalidation', (select to_jsonb(delivery_revalidation_state) from delivery_revalidation_state),
  'security', (select to_jsonb(security_state) from security_state),
  'data_counts', (select value from data_state)
));
*/
