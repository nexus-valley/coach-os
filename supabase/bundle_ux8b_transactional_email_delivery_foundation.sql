-- Bundle UX-8B: durable transactional email delivery foundation.
--
-- Existing synchronous OTP and invitation delivery remains unchanged. This
-- migration adds a private outbox, bounded worker RPCs, delivery evidence, and
-- suppression handling for controlled templates used by future server flows.

/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query separately in Supabase SQL Editor. It reads catalog metadata and
aggregate configuration only; it does not access email recipients or payloads.

with required_relations(identity) as (
  values
    ('public.tenants'),
    ('public.communication_logs')
), relation_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'identity', rr.identity,
    'installed', c.oid is not null,
    'owner', case when c.oid is null then null else pg_get_userbyid(c.relowner) end,
    'rls_enabled', coalesce(c.relrowsecurity, false),
    'rls_forced', coalesce(c.relforcerowsecurity, false)
  ) order by rr.identity), '[]'::jsonb) as value
  from required_relations rr
  left join pg_catalog.pg_class c on c.oid = to_regclass(rr.identity)
), conflict_state as (
  select jsonb_build_object(
    'outbox', to_regclass('coachfort_internal.transactional_email_outbox') is not null,
    'attempts', to_regclass('coachfort_internal.transactional_email_attempts') is not null,
    'provider_events', to_regclass('coachfort_internal.transactional_email_provider_events') is not null,
    'suppressions', to_regclass('coachfort_internal.transactional_email_suppressions') is not null,
    'public_rpc_count', (
      select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'enqueue_transactional_email_server',
        'claim_transactional_email_batch_server',
        'finalize_transactional_email_attempt_server',
        'transactional_email_suppression_state_server',
        'record_transactional_email_provider_event_server'
      )
    ),
    'internal_function_count', (
      select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'coachfort_internal' and p.proname in (
        'transactional_email_normalize_recipient',
        'transactional_email_payload_valid',
        'transactional_email_immutable_identity',
        'transactional_email_suppression_updated_at',
        'enqueue_transactional_email'
      )
    )
  ) as value
), internal_schema_state as (
  select jsonb_build_object(
    'installed', n.oid is not null,
    'owner', case when n.oid is null then null else pg_get_userbyid(n.nspowner) end,
    'api_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1 from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(settings.setting, '=', 2), ','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and settings.setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) as value
  from (select to_regnamespace('coachfort_internal') as oid) existing
  left join pg_catalog.pg_namespace n on n.oid = existing.oid
), prerequisite_state as (
  select jsonb_build_object(
    'pgcrypto', exists (
      select 1 from pg_catalog.pg_extension where extname = 'pgcrypto'
    ),
    'postgres_owner_bypass_safe', exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'postgres' and (rolsuper or rolbypassrls)
    ),
    'service_role_exists', exists (
      select 1 from pg_catalog.pg_roles where rolname = 'service_role'
    )
  ) as value
), communication_log_state as (
  select jsonb_build_object(
    'installed', to_regclass('public.communication_logs') is not null,
    'email_rows', case when to_regclass('public.communication_logs') is null
      then null else (select count(*) from public.communication_logs where channel = 'email') end,
    'authoritative_outbox_candidate', false
  ) as value
), direct_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', tp.table_schema,
    'table', tp.table_name,
    'grantee', tp.grantee,
    'privilege', tp.privilege_type
  ) order by tp.table_schema, tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb) as value
  from information_schema.table_privileges tp
  where tp.table_schema in ('public', 'coachfort_internal')
    and tp.table_name in (
      'communication_logs', 'transactional_email_outbox',
      'transactional_email_attempts', 'transactional_email_provider_events',
      'transactional_email_suppressions'
    )
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
)
select jsonb_pretty(jsonb_build_object(
  'relations', (select value from relation_state),
  'conflicts', (select value from conflict_state),
  'internal_schema', (select value from internal_schema_state),
  'prerequisites', (select value from prerequisite_state),
  'communication_logs', (select value from communication_log_state),
  'direct_grants', (select value from direct_grants)
));
*/

begin;

do $$
begin
  if to_regclass('public.tenants') is null
     or to_regclass('public.communication_logs') is null then
    raise exception 'UX-8B prerequisites are missing.';
  end if;

  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pgcrypto') then
    raise exception 'UX-8B requires pgcrypto.';
  end if;

  if to_regnamespace('coachfort_internal') is null then
    raise exception 'UX-8B requires the existing coachfort_internal schema.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_namespace n
    where n.oid = to_regnamespace('coachfort_internal')
      and pg_get_userbyid(n.nspowner) = 'postgres'
  ) then
    raise exception 'coachfort_internal must remain postgres-owned.';
  end if;

  if coalesce(
    'coachfort_internal' = any(regexp_split_to_array(
      replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
    )), false
  ) or exists (
    select 1 from pg_catalog.pg_db_role_setting rs
    join pg_catalog.pg_roles r on r.oid = rs.setrole
    cross join lateral unnest(rs.setconfig) settings(setting)
    cross join lateral regexp_split_to_table(
      split_part(settings.setting, '=', 2), ','
    ) exposed(schema_name)
    where r.rolname = 'authenticator'
      and settings.setting like 'pgrst.db_schemas=%'
      and btrim(exposed.schema_name) = 'coachfort_internal'
  ) then
    raise exception 'coachfort_internal must not be API exposed.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'postgres' and (rolsuper or rolbypassrls)
  ) then
    raise exception 'postgres cannot safely own UX-8B SECURITY DEFINER functions.';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    raise exception 'service_role is required for the UX-8B worker boundary.';
  end if;

  if to_regclass('coachfort_internal.transactional_email_outbox') is not null
     or to_regclass('coachfort_internal.transactional_email_attempts') is not null
     or to_regclass('coachfort_internal.transactional_email_provider_events') is not null
     or to_regclass('coachfort_internal.transactional_email_suppressions') is not null
     or exists (
       select 1 from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in (
         'enqueue_transactional_email_server',
         'claim_transactional_email_batch_server',
         'finalize_transactional_email_attempt_server',
         'transactional_email_suppression_state_server',
         'record_transactional_email_provider_event_server'
       )
     )
     or exists (
       select 1 from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'coachfort_internal' and p.proname in (
         'transactional_email_normalize_recipient',
         'transactional_email_payload_valid',
         'transactional_email_immutable_identity',
         'transactional_email_suppression_updated_at',
         'enqueue_transactional_email'
       )
     ) then
    raise exception 'Conflicting UX-8B email foundation objects already exist.';
  end if;
end;
$$;

create table coachfort_internal.transactional_email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  tenant_id uuid,
  recipient_email text not null,
  template_key text not null,
  template_payload jsonb not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claim_owner text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  provider_message_id text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  suppressed_at timestamptz,
  last_error_class text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactional_email_outbox_event_key_unique unique (event_key),
  constraint transactional_email_outbox_event_key_check check (
    event_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
  ),
  constraint transactional_email_outbox_recipient_check check (
    recipient_email = lower(btrim(recipient_email))
    and length(recipient_email) between 3 and 320
    and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint transactional_email_outbox_template_check check (
    template_key in ('coach.welcome', 'coach.workspace_ready')
  ),
  constraint transactional_email_outbox_payload_check check (
    jsonb_typeof(template_payload) = 'object'
    and octet_length(template_payload::text) <= 8192
  ),
  constraint transactional_email_outbox_status_check check (
    status in (
      'queued', 'claimed', 'retry_scheduled', 'provider_accepted',
      'delivered', 'bounced', 'complained', 'failed', 'suppressed'
    )
  ),
  constraint transactional_email_outbox_attempt_count_check check (
    attempt_count between 0 and 5
  ),
  constraint transactional_email_outbox_claim_check check (
    (status = 'claimed' and claim_token is not null and claim_owner is not null
      and claimed_at is not null and lease_expires_at is not null)
    or
    (status <> 'claimed' and claim_token is null and claim_owner is null
      and claimed_at is null and lease_expires_at is null)
  ),
  constraint transactional_email_outbox_error_class_check check (
    last_error_class is null or last_error_class in (
      'configuration', 'permanent', 'suppressed', 'timeout', 'transient'
    )
  )
);

create unique index transactional_email_outbox_provider_message_id_unique
  on coachfort_internal.transactional_email_outbox(provider_message_id)
  where provider_message_id is not null;
create index transactional_email_outbox_claim_queue_idx
  on coachfort_internal.transactional_email_outbox(
    next_attempt_at, queued_at, id
  )
  where status in ('queued', 'retry_scheduled', 'claimed');
create index transactional_email_outbox_tenant_created_idx
  on coachfort_internal.transactional_email_outbox(tenant_id, created_at desc)
  where tenant_id is not null;

create table coachfort_internal.transactional_email_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references coachfort_internal.transactional_email_outbox(id) on delete restrict,
  attempt_number integer not null,
  claim_token uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text,
  provider_message_id text,
  http_status integer,
  error_class text,
  error_code text,
  retry_scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint transactional_email_attempts_number_unique unique (outbox_id, attempt_number),
  constraint transactional_email_attempts_number_check check (attempt_number between 1 and 5),
  constraint transactional_email_attempts_outcome_check check (
    outcome is null or outcome in (
      'lease_expired', 'permanent_failure', 'provider_accepted',
      'suppressed', 'transient_failure'
    )
  ),
  constraint transactional_email_attempts_error_class_check check (
    error_class is null or error_class in (
      'configuration', 'permanent', 'suppressed', 'timeout', 'transient'
    )
  ),
  constraint transactional_email_attempts_http_status_check check (
    http_status is null or http_status between 100 and 599
  )
);

create unique index transactional_email_attempts_claim_token_unique
  on coachfort_internal.transactional_email_attempts(claim_token);
create index transactional_email_attempts_outbox_started_idx
  on coachfort_internal.transactional_email_attempts(outbox_id, started_at desc);

create table coachfort_internal.transactional_email_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend',
  provider_event_id text not null,
  provider_message_id text not null,
  event_type text not null,
  bounce_type text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  matched_outbox_id uuid references coachfort_internal.transactional_email_outbox(id) on delete restrict,
  processing_status text not null default 'received',
  constraint transactional_email_provider_events_identity_unique unique (provider, provider_event_id),
  constraint transactional_email_provider_events_provider_check check (provider = 'resend'),
  constraint transactional_email_provider_events_type_check check (
    event_type in (
      'email.bounced', 'email.complained', 'email.delivered',
      'email.delivery_delayed', 'email.failed', 'email.sent', 'email.suppressed'
    )
  ),
  constraint transactional_email_provider_events_bounce_type_check check (
    (event_type = 'email.bounced' and bounce_type is not null
      and bounce_type in ('permanent', 'transient', 'undetermined'))
    or (event_type <> 'email.bounced' and bounce_type is null)
  ),
  constraint transactional_email_provider_events_status_check check (
    processing_status in ('ignored', 'processed', 'received', 'unmatched')
  )
);

create index transactional_email_provider_events_message_idx
  on coachfort_internal.transactional_email_provider_events(provider_message_id, occurred_at);

create table coachfort_internal.transactional_email_suppressions (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  reason text not null,
  source_provider text not null default 'resend',
  source_event_id text,
  provider_message_id text,
  active boolean not null default true,
  suppressed_at timestamptz not null default now(),
  lifted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactional_email_suppressions_recipient_unique unique (recipient_email),
  constraint transactional_email_suppressions_recipient_check check (
    recipient_email = lower(btrim(recipient_email))
    and length(recipient_email) between 3 and 320
  ),
  constraint transactional_email_suppressions_reason_check check (
    reason in ('complaint', 'hard_bounce', 'provider_suppressed')
  ),
  constraint transactional_email_suppressions_provider_check check (source_provider = 'resend'),
  constraint transactional_email_suppressions_active_check check (
    (active and lifted_at is null) or (not active and lifted_at is not null)
  )
);

alter table coachfort_internal.transactional_email_outbox enable row level security;
alter table coachfort_internal.transactional_email_attempts enable row level security;
alter table coachfort_internal.transactional_email_provider_events enable row level security;
alter table coachfort_internal.transactional_email_suppressions enable row level security;

alter table coachfort_internal.transactional_email_outbox owner to postgres;
alter table coachfort_internal.transactional_email_attempts owner to postgres;
alter table coachfort_internal.transactional_email_provider_events owner to postgres;
alter table coachfort_internal.transactional_email_suppressions owner to postgres;

revoke all on table coachfort_internal.transactional_email_outbox from public, anon, authenticated, service_role;
revoke all on table coachfort_internal.transactional_email_attempts from public, anon, authenticated, service_role;
revoke all on table coachfort_internal.transactional_email_provider_events from public, anon, authenticated, service_role;
revoke all on table coachfort_internal.transactional_email_suppressions from public, anon, authenticated, service_role;

create function coachfort_internal.transactional_email_normalize_recipient(p_email text)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if length(v_email) not between 3 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Transactional email recipient is invalid.' using errcode = '22023';
  end if;
  return v_email;
end;
$$;

create function coachfort_internal.transactional_email_payload_valid(
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
    else false
  end, false);
$$;

create function coachfort_internal.transactional_email_immutable_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.event_key is distinct from old.event_key
     or new.tenant_id is distinct from old.tenant_id
     or new.recipient_email is distinct from old.recipient_email
     or new.template_key is distinct from old.template_key
     or new.template_payload is distinct from old.template_payload
     or new.queued_at is distinct from old.queued_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Transactional email event identity is immutable.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger transactional_email_outbox_immutable_identity
before update on coachfort_internal.transactional_email_outbox
for each row execute function coachfort_internal.transactional_email_immutable_identity();

create function coachfort_internal.transactional_email_suppression_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger transactional_email_suppression_updated_at
before update on coachfort_internal.transactional_email_suppressions
for each row execute function coachfort_internal.transactional_email_suppression_updated_at();

create function coachfort_internal.enqueue_transactional_email(
  p_event_key text,
  p_tenant_id uuid,
  p_recipient_email text,
  p_template_key text,
  p_template_payload jsonb
)
returns table(outbox_id uuid, outbox_status text, idempotent boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_key text := btrim(p_event_key);
  v_recipient text;
  v_existing coachfort_internal.transactional_email_outbox%rowtype;
  v_suppressed boolean;
begin
  if v_event_key is null
     or v_event_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'Transactional email event key is invalid.' using errcode = '22023';
  end if;

  v_recipient := coachfort_internal.transactional_email_normalize_recipient(p_recipient_email);

  if p_tenant_id is null then
    raise exception 'Transactional email tenant is required for this template.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Transactional email tenant is invalid.' using errcode = '22023';
  end if;

  if coachfort_internal.transactional_email_payload_valid(
    p_template_key, p_template_payload
  ) is not true then
    raise exception 'Transactional email template or payload is invalid.' using errcode = '22023';
  end if;

  select exists (
    select 1
    from coachfort_internal.transactional_email_suppressions s
    where s.recipient_email = v_recipient and s.active
  ) into v_suppressed;

  insert into coachfort_internal.transactional_email_outbox (
    event_key, tenant_id, recipient_email, template_key, template_payload,
    status, suppressed_at, last_error_class, last_error_code
  ) values (
    v_event_key, p_tenant_id, v_recipient, p_template_key, p_template_payload,
    case when v_suppressed then 'suppressed' else 'queued' end,
    case when v_suppressed then now() else null end,
    case when v_suppressed then 'suppressed' else null end,
    case when v_suppressed then 'recipient_suppressed' else null end
  )
  on conflict (event_key) do nothing
  returning * into v_existing;

  if found then
    return query select v_existing.id, v_existing.status, false;
    return;
  end if;

  select * into strict v_existing
  from coachfort_internal.transactional_email_outbox o
  where o.event_key = v_event_key;

  if v_existing.tenant_id is distinct from p_tenant_id
     or v_existing.recipient_email is distinct from v_recipient
     or v_existing.template_key is distinct from p_template_key
     or v_existing.template_payload is distinct from p_template_payload then
    raise exception 'Transactional email event key conflicts with existing content.'
      using errcode = '23505';
  end if;

  return query select v_existing.id, v_existing.status, true;
end;
$$;

create function public.enqueue_transactional_email_server(
  p_event_key text,
  p_tenant_id uuid,
  p_recipient_email text,
  p_template_key text,
  p_template_payload jsonb
)
returns table(outbox_id uuid, outbox_status text, idempotent boolean)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from coachfort_internal.enqueue_transactional_email(
    p_event_key, p_tenant_id, p_recipient_email, p_template_key, p_template_payload
  );
$$;

create function public.claim_transactional_email_batch_server(
  p_worker_id text,
  p_batch_size integer default 10,
  p_lease_seconds integer default 120
)
returns table(
  outbox_id uuid,
  event_key text,
  tenant_id uuid,
  recipient_email text,
  template_key text,
  template_payload jsonb,
  attempt_number integer,
  claim_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row coachfort_internal.transactional_email_outbox%rowtype;
  v_token uuid;
begin
  if p_worker_id is null or length(btrim(p_worker_id)) not between 1 and 100 then
    raise exception 'Transactional email worker identity is invalid.' using errcode = '22023';
  end if;
  if p_batch_size not between 1 and 25 or p_lease_seconds not between 30 and 900 then
    raise exception 'Transactional email claim bounds are invalid.' using errcode = '22023';
  end if;

  update coachfort_internal.transactional_email_attempts a
  set completed_at = now(), outcome = 'suppressed', error_class = 'suppressed',
      error_code = 'recipient_suppressed'
  from coachfort_internal.transactional_email_outbox o
  where a.outbox_id = o.id and a.claim_token = o.claim_token and a.outcome is null
    and o.status = 'claimed' and o.lease_expires_at <= now()
    and exists (
      select 1 from coachfort_internal.transactional_email_suppressions s
      where s.recipient_email = o.recipient_email and s.active
    );

  update coachfort_internal.transactional_email_outbox o
  set status = 'suppressed', suppressed_at = coalesce(o.suppressed_at, now()),
      last_error_class = 'suppressed', last_error_code = 'recipient_suppressed',
      claim_token = null, claim_owner = null, claimed_at = null, lease_expires_at = null
  where (
      o.status in ('queued', 'retry_scheduled')
      or (o.status = 'claimed' and o.lease_expires_at <= now())
    )
    and exists (
      select 1 from coachfort_internal.transactional_email_suppressions s
      where s.recipient_email = o.recipient_email and s.active
    );

  update coachfort_internal.transactional_email_attempts a
  set completed_at = now(), outcome = 'lease_expired',
      error_class = 'transient', error_code = 'claim_lease_expired'
  from coachfort_internal.transactional_email_outbox o
  where a.outbox_id = o.id and a.claim_token = o.claim_token and a.outcome is null
    and o.status = 'claimed' and o.lease_expires_at <= now()
    and o.attempt_count >= 5;

  update coachfort_internal.transactional_email_outbox o
  set status = 'failed', failed_at = coalesce(o.failed_at, now()),
      last_error_class = 'transient', last_error_code = 'claim_lease_expired',
      claim_token = null, claim_owner = null, claimed_at = null, lease_expires_at = null
  where o.status = 'claimed' and o.lease_expires_at <= now()
    and o.attempt_count >= 5;

  for v_row in
    select o.*
    from coachfort_internal.transactional_email_outbox o
    where (
        o.status in ('queued', 'retry_scheduled')
        or (o.status = 'claimed' and o.lease_expires_at <= now())
      )
      and o.next_attempt_at <= now()
      and o.attempt_count < 5
      and not exists (
        select 1 from coachfort_internal.transactional_email_suppressions s
        where s.recipient_email = o.recipient_email and s.active
      )
    order by o.next_attempt_at, o.queued_at, o.id
    for update skip locked
    limit p_batch_size
  loop
    if v_row.status = 'claimed' then
      update coachfort_internal.transactional_email_attempts a
      set completed_at = now(), outcome = 'lease_expired',
          error_class = 'transient', error_code = 'claim_lease_expired'
      where a.outbox_id = v_row.id and a.claim_token = v_row.claim_token
        and a.outcome is null;
    end if;

    v_token := gen_random_uuid();
    update coachfort_internal.transactional_email_outbox o
    set status = 'claimed', attempt_count = o.attempt_count + 1,
        claim_token = v_token, claim_owner = btrim(p_worker_id),
        claimed_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        last_error_class = null, last_error_code = null
    where o.id = v_row.id
    returning * into v_row;

    insert into coachfort_internal.transactional_email_attempts (
      outbox_id, attempt_number, claim_token
    ) values (v_row.id, v_row.attempt_count, v_token);

    return query select
      v_row.id, v_row.event_key, v_row.tenant_id, v_row.recipient_email,
      v_row.template_key, v_row.template_payload, v_row.attempt_count,
      v_token, v_row.lease_expires_at;
  end loop;
end;
$$;

create function public.finalize_transactional_email_attempt_server(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_http_status integer default null,
  p_error_class text default null,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row coachfort_internal.transactional_email_outbox%rowtype;
  v_status text;
  v_retry_at timestamptz;
begin
  if p_outbox_id is null or p_claim_token is null
     or p_outcome not in (
       'provider_accepted', 'transient_failure', 'permanent_failure', 'suppressed'
     ) then
    raise exception 'Transactional email completion is invalid.' using errcode = '22023';
  end if;
  if p_http_status is not null and p_http_status not between 100 and 599 then
    raise exception 'Transactional email HTTP status is invalid.' using errcode = '22023';
  end if;
  if p_error_class is not null and p_error_class not in (
    'configuration', 'permanent', 'suppressed', 'timeout', 'transient'
  ) then
    raise exception 'Transactional email error class is invalid.' using errcode = '22023';
  end if;
  if p_error_code is not null and (
    length(p_error_code) > 80 or p_error_code !~ '^[a-z0-9_]+$'
  ) then
    raise exception 'Transactional email error code is invalid.' using errcode = '22023';
  end if;

  select * into strict v_row
  from coachfort_internal.transactional_email_outbox o
  where o.id = p_outbox_id
  for update;

  if v_row.status <> 'claimed' or v_row.claim_token is distinct from p_claim_token then
    raise exception 'Transactional email claim is stale.' using errcode = '40001';
  end if;

  if p_outcome = 'provider_accepted' then
    if p_provider_message_id is null or length(btrim(p_provider_message_id)) not between 1 and 255 then
      raise exception 'Provider message identity is required.' using errcode = '22023';
    end if;
    v_status := 'provider_accepted';
  elsif p_outcome = 'transient_failure' and v_row.attempt_count < 5 then
    v_status := 'retry_scheduled';
    v_retry_at := now() + case v_row.attempt_count
      when 1 then interval '1 minute'
      when 2 then interval '5 minutes'
      when 3 then interval '30 minutes'
      when 4 then interval '2 hours'
    end;
  elsif p_outcome = 'suppressed' then
    v_status := 'suppressed';
  else
    v_status := 'failed';
  end if;

  update coachfort_internal.transactional_email_attempts a
  set completed_at = now(), outcome = p_outcome,
      provider_message_id = case when p_outcome = 'provider_accepted' then btrim(p_provider_message_id) else null end,
      http_status = p_http_status, error_class = p_error_class,
      error_code = p_error_code, retry_scheduled_at = v_retry_at
  where a.outbox_id = p_outbox_id and a.claim_token = p_claim_token
    and a.outcome is null;

  if not found then
    raise exception 'Transactional email attempt evidence is missing.' using errcode = 'P0001';
  end if;

  update coachfort_internal.transactional_email_outbox o
  set status = v_status,
      next_attempt_at = coalesce(v_retry_at, o.next_attempt_at),
      provider_message_id = case when p_outcome = 'provider_accepted'
        then btrim(p_provider_message_id) else o.provider_message_id end,
      sent_at = case when p_outcome = 'provider_accepted' then now() else o.sent_at end,
      failed_at = case when v_status = 'failed' then now() else o.failed_at end,
      suppressed_at = case when v_status = 'suppressed' then now() else o.suppressed_at end,
      last_error_class = p_error_class, last_error_code = p_error_code,
      claim_token = null, claim_owner = null, claimed_at = null, lease_expires_at = null
  where o.id = p_outbox_id;

  return v_status;
end;
$$;

create function public.transactional_email_suppression_state_server(
  p_recipient_email text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from coachfort_internal.transactional_email_suppressions s
    where s.recipient_email = coachfort_internal.transactional_email_normalize_recipient(p_recipient_email)
      and s.active
  );
$$;

create function public.record_transactional_email_provider_event_server(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_bounce_type text
)
returns table(duplicate boolean, matched boolean, outbox_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_outbox coachfort_internal.transactional_email_outbox%rowtype;
  v_status text;
  v_reason text;
begin
  if p_provider_event_id is null or length(btrim(p_provider_event_id)) not between 1 and 255
     or p_provider_message_id is null or length(btrim(p_provider_message_id)) not between 1 and 255
     or p_occurred_at is null
     or p_event_type not in (
       'email.bounced', 'email.complained', 'email.delivered',
       'email.delivery_delayed', 'email.failed', 'email.sent', 'email.suppressed'
     ) then
    raise exception 'Transactional email provider event is invalid.' using errcode = '22023';
  end if;

  if (p_event_type = 'email.bounced' and (
        p_bounce_type is null
        or p_bounce_type not in ('permanent', 'transient', 'undetermined')
      ))
     or (p_event_type <> 'email.bounced' and p_bounce_type is not null) then
    raise exception 'Transactional email bounce classification is invalid.' using errcode = '22023';
  end if;

  insert into coachfort_internal.transactional_email_provider_events (
    provider_event_id, provider_message_id, event_type, bounce_type, occurred_at
  ) values (
    btrim(p_provider_event_id), btrim(p_provider_message_id), p_event_type,
    p_bounce_type, p_occurred_at
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return query select true, false, null::text;
    return;
  end if;

  select * into v_outbox
  from coachfort_internal.transactional_email_outbox o
  where o.provider_message_id = btrim(p_provider_message_id)
  for update;

  if not found then
    update coachfort_internal.transactional_email_provider_events e
    set processing_status = 'unmatched'
    where e.id = v_event_id;
    return query select false, false, null::text;
    return;
  end if;

  if p_event_type = 'email.complained' then
    v_reason := 'complaint';
  elsif p_event_type = 'email.bounced' and p_bounce_type = 'permanent' then
    v_reason := 'hard_bounce';
  elsif p_event_type = 'email.suppressed' then
    v_reason := 'provider_suppressed';
  end if;

  if v_outbox.status in ('bounced', 'complained', 'suppressed') then
    v_status := v_outbox.status;
  elsif p_event_type = 'email.complained' then
    v_status := 'complained';
  elsif p_event_type = 'email.bounced' and p_bounce_type = 'permanent' then
    v_status := 'bounced';
  elsif p_event_type = 'email.suppressed' then
    v_status := 'suppressed';
  elsif p_event_type = 'email.delivered' then
    v_status := 'delivered';
  elsif p_event_type = 'email.failed' and v_outbox.status <> 'delivered' then
    v_status := 'failed';
  else
    v_status := v_outbox.status;
  end if;

  if v_status is distinct from v_outbox.status then
    update coachfort_internal.transactional_email_outbox o
    set status = v_status,
        delivered_at = case when v_status = 'delivered' then p_occurred_at else o.delivered_at end,
        failed_at = case when v_status in ('bounced', 'complained', 'failed') then p_occurred_at else o.failed_at end,
        suppressed_at = case when v_status in ('bounced', 'complained', 'suppressed')
          then p_occurred_at else o.suppressed_at end,
        last_error_class = case when v_status in ('bounced', 'complained', 'failed') then 'permanent'
          when v_status = 'suppressed' then 'suppressed'
          when v_status = 'delivered' then null else o.last_error_class end,
        last_error_code = case when v_status in ('bounced', 'complained', 'failed', 'suppressed')
          then replace(p_event_type, 'email.', 'provider_')
          when v_status = 'delivered' then null else o.last_error_code end
    where o.id = v_outbox.id;
  end if;

  if v_reason is not null then
    insert into coachfort_internal.transactional_email_suppressions (
      recipient_email, reason, source_event_id, provider_message_id,
      active, suppressed_at, lifted_at
    ) values (
      v_outbox.recipient_email, v_reason, btrim(p_provider_event_id),
      btrim(p_provider_message_id), true, p_occurred_at, null
    )
    on conflict (recipient_email) do update
    set reason = case
          when transactional_email_suppressions.reason = excluded.reason
            or transactional_email_suppressions.reason = 'complaint'
            or (
              transactional_email_suppressions.reason = 'hard_bounce'
              and excluded.reason = 'provider_suppressed'
            ) then transactional_email_suppressions.reason
          else excluded.reason
        end,
        source_event_id = case
          when transactional_email_suppressions.reason = excluded.reason
            or transactional_email_suppressions.reason = 'complaint'
            or (
              transactional_email_suppressions.reason = 'hard_bounce'
              and excluded.reason = 'provider_suppressed'
            ) then transactional_email_suppressions.source_event_id
          else excluded.source_event_id
        end,
        provider_message_id = case
          when transactional_email_suppressions.reason = excluded.reason
            or transactional_email_suppressions.reason = 'complaint'
            or (
              transactional_email_suppressions.reason = 'hard_bounce'
              and excluded.reason = 'provider_suppressed'
            ) then transactional_email_suppressions.provider_message_id
          else excluded.provider_message_id
        end,
        suppressed_at = case
          when transactional_email_suppressions.reason = excluded.reason
            or transactional_email_suppressions.reason = 'complaint'
            or (
              transactional_email_suppressions.reason = 'hard_bounce'
              and excluded.reason = 'provider_suppressed'
            ) then transactional_email_suppressions.suppressed_at
          else excluded.suppressed_at
        end,
        active = true, lifted_at = null;
  end if;

  update coachfort_internal.transactional_email_provider_events e
  set matched_outbox_id = v_outbox.id,
      processing_status = case
        when p_event_type in ('email.delivery_delayed', 'email.sent') then 'ignored'
        else 'processed'
      end
  where e.id = v_event_id;

  return query select false, true, v_status;
end;
$$;

alter function coachfort_internal.transactional_email_normalize_recipient(text) owner to postgres;
alter function coachfort_internal.transactional_email_payload_valid(text,jsonb) owner to postgres;
alter function coachfort_internal.transactional_email_immutable_identity() owner to postgres;
alter function coachfort_internal.transactional_email_suppression_updated_at() owner to postgres;
alter function coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb) owner to postgres;
alter function public.enqueue_transactional_email_server(text,uuid,text,text,jsonb) owner to postgres;
alter function public.claim_transactional_email_batch_server(text,integer,integer) owner to postgres;
alter function public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text) owner to postgres;
alter function public.transactional_email_suppression_state_server(text) owner to postgres;
alter function public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text) owner to postgres;

revoke all on function coachfort_internal.transactional_email_normalize_recipient(text) from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.transactional_email_payload_valid(text,jsonb) from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.transactional_email_immutable_identity() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.transactional_email_suppression_updated_at() from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_transactional_email_server(text,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.claim_transactional_email_batch_server(text,integer,integer) from public, anon, authenticated, service_role;
revoke all on function public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text) from public, anon, authenticated, service_role;
revoke all on function public.transactional_email_suppression_state_server(text) from public, anon, authenticated, service_role;
revoke all on function public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text) from public, anon, authenticated, service_role;

grant execute on function public.enqueue_transactional_email_server(text,uuid,text,text,jsonb) to service_role;
grant execute on function public.claim_transactional_email_batch_server(text,integer,integer) to service_role;
grant execute on function public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text) to service_role;
grant execute on function public.transactional_email_suppression_state_server(text) to service_role;
grant execute on function public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text) to service_role;

comment on function coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb) is
  'Private atomic UX-8B enqueue primitive for trusted postgres-owned business functions.';
comment on function public.claim_transactional_email_batch_server(text,integer,integer) is
  'Service-role-only bounded transactional email claim with SKIP LOCKED and finite leases.';

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with expected_tables(identity) as (
  values
    ('coachfort_internal.transactional_email_outbox'),
    ('coachfort_internal.transactional_email_attempts'),
    ('coachfort_internal.transactional_email_provider_events'),
    ('coachfort_internal.transactional_email_suppressions')
), table_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'identity', et.identity,
    'installed', c.oid is not null,
    'owner', case when c.oid is null then null else pg_get_userbyid(c.relowner) end,
    'rls_enabled', coalesce(c.relrowsecurity, false),
    'rls_forced', coalesce(c.relforcerowsecurity, false)
  ) order by et.identity), '[]'::jsonb) as value,
  bool_and(c.oid is not null and pg_get_userbyid(c.relowner) = 'postgres'
    and c.relrowsecurity and not c.relforcerowsecurity) as passed
  from expected_tables et
  left join pg_catalog.pg_class c on c.oid = to_regclass(et.identity)
), expected_functions(identity) as (
  values
    ('public.enqueue_transactional_email_server(text,uuid,text,text,jsonb)'),
    ('public.claim_transactional_email_batch_server(text,integer,integer)'),
    ('public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)'),
    ('public.transactional_email_suppression_state_server(text)'),
    ('public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text)')
), rpc_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'identity', ef.identity,
    'installed', p.oid is not null,
    'owner', case when p.oid is null then null else pg_get_userbyid(p.proowner) end,
    'security_definer', coalesce(p.prosecdef, false),
    'volatility', p.provolatile,
    'configuration', coalesce(p.proconfig, array[]::text[]),
    'public_execute', p.oid is not null and has_function_privilege('public', p.oid, 'EXECUTE'),
    'anon_execute', p.oid is not null and has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', p.oid is not null and has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role_execute', p.oid is not null and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) order by ef.identity), '[]'::jsonb) as value,
  bool_and(p.oid is not null and pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array[]::text[]))
    and not has_function_privilege('public', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')) as passed
  from expected_functions ef
  left join pg_catalog.pg_proc p on p.oid = to_regprocedure(ef.identity)
), public_rpc_identity_state as (
  select jsonb_build_object(
    'count', count(*),
    'expected_identity_count', count(*) filter (where p.oid in (
      to_regprocedure('public.enqueue_transactional_email_server(text,uuid,text,text,jsonb)')::oid,
      to_regprocedure('public.claim_transactional_email_batch_server(text,integer,integer)')::oid,
      to_regprocedure('public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)')::oid,
      to_regprocedure('public.transactional_email_suppression_state_server(text)')::oid,
      to_regprocedure('public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text)')::oid
    )),
    'unexpected_overloads', count(*) filter (where p.oid not in (
      to_regprocedure('public.enqueue_transactional_email_server(text,uuid,text,text,jsonb)')::oid,
      to_regprocedure('public.claim_transactional_email_batch_server(text,integer,integer)')::oid,
      to_regprocedure('public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)')::oid,
      to_regprocedure('public.transactional_email_suppression_state_server(text)')::oid,
      to_regprocedure('public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text)')::oid
    ))
  ) as value,
  count(*) = 5
  and count(*) filter (where p.oid in (
    to_regprocedure('public.enqueue_transactional_email_server(text,uuid,text,text,jsonb)')::oid,
    to_regprocedure('public.claim_transactional_email_batch_server(text,integer,integer)')::oid,
    to_regprocedure('public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)')::oid,
    to_regprocedure('public.transactional_email_suppression_state_server(text)')::oid,
    to_regprocedure('public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text)')::oid
  )) = 5
  and count(*) filter (where p.oid not in (
    to_regprocedure('public.enqueue_transactional_email_server(text,uuid,text,text,jsonb)')::oid,
    to_regprocedure('public.claim_transactional_email_batch_server(text,integer,integer)')::oid,
    to_regprocedure('public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)')::oid,
    to_regprocedure('public.transactional_email_suppression_state_server(text)')::oid,
    to_regprocedure('public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text)')::oid
  )) = 0 as passed
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'enqueue_transactional_email_server',
    'claim_transactional_email_batch_server',
    'finalize_transactional_email_attempt_server',
    'transactional_email_suppression_state_server',
    'record_transactional_email_provider_event_server'
  )
), internal_helper_state as (
  select jsonb_build_object(
    'count', count(*),
    'expected_identity_count', count(*) filter (where p.oid in (
      to_regprocedure('coachfort_internal.transactional_email_normalize_recipient(text)')::oid,
      to_regprocedure('coachfort_internal.transactional_email_payload_valid(text,jsonb)')::oid,
      to_regprocedure('coachfort_internal.transactional_email_immutable_identity()')::oid,
      to_regprocedure('coachfort_internal.transactional_email_suppression_updated_at()')::oid,
      to_regprocedure('coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb)')::oid
    )),
    'unexpected_overloads', count(*) filter (where p.oid not in (
      to_regprocedure('coachfort_internal.transactional_email_normalize_recipient(text)')::oid,
      to_regprocedure('coachfort_internal.transactional_email_payload_valid(text,jsonb)')::oid,
      to_regprocedure('coachfort_internal.transactional_email_immutable_identity()')::oid,
      to_regprocedure('coachfort_internal.transactional_email_suppression_updated_at()')::oid,
      to_regprocedure('coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb)')::oid
    )),
    'helpers', coalesce(jsonb_agg(jsonb_build_object(
      'identity', p.oid::regprocedure::text,
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'configuration', coalesce(p.proconfig, array[]::text[])
    ) order by p.oid::regprocedure::text), '[]'::jsonb),
    'browser_or_service_execute', count(*) filter (
      where has_function_privilege('public', p.oid, 'EXECUTE')
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
  ) as value,
  count(*) = 5
  and count(*) filter (where p.oid in (
    to_regprocedure('coachfort_internal.transactional_email_normalize_recipient(text)')::oid,
    to_regprocedure('coachfort_internal.transactional_email_payload_valid(text,jsonb)')::oid,
    to_regprocedure('coachfort_internal.transactional_email_immutable_identity()')::oid,
    to_regprocedure('coachfort_internal.transactional_email_suppression_updated_at()')::oid,
    to_regprocedure('coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb)')::oid
  )) = 5
  and count(*) filter (where p.oid not in (
    to_regprocedure('coachfort_internal.transactional_email_normalize_recipient(text)')::oid,
    to_regprocedure('coachfort_internal.transactional_email_payload_valid(text,jsonb)')::oid,
    to_regprocedure('coachfort_internal.transactional_email_immutable_identity()')::oid,
    to_regprocedure('coachfort_internal.transactional_email_suppression_updated_at()')::oid,
    to_regprocedure('coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb)')::oid
  )) = 0
  and bool_and(
    pg_get_userbyid(p.proowner) = 'postgres'
    and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array[]::text[]))
    and (p.prosecdef = (p.proname = 'enqueue_transactional_email'))
  )
  and count(*) filter (
    where has_function_privilege('public', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) = 0 as passed
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'coachfort_internal' and p.proname in (
    'transactional_email_normalize_recipient',
    'transactional_email_payload_valid',
    'transactional_email_immutable_identity',
    'transactional_email_suppression_updated_at',
    'enqueue_transactional_email'
  )
), constraint_state as (
  select jsonb_build_object(
    'event_key_unique', count(*) filter (where con.conname = 'transactional_email_outbox_event_key_unique') = 1,
    'attempt_number_unique', count(*) filter (where con.conname = 'transactional_email_attempts_number_unique') = 1,
    'provider_event_unique', count(*) filter (where con.conname = 'transactional_email_provider_events_identity_unique') = 1,
    'provider_bounce_type', count(*) filter (where con.conname = 'transactional_email_provider_events_bounce_type_check') = 1,
    'suppression_recipient_unique', count(*) filter (where con.conname = 'transactional_email_suppressions_recipient_unique') = 1
  ) as value,
  count(*) filter (where con.conname in (
    'transactional_email_outbox_event_key_unique',
    'transactional_email_attempts_number_unique',
    'transactional_email_provider_events_identity_unique',
    'transactional_email_provider_events_bounce_type_check',
    'transactional_email_suppressions_recipient_unique'
  )) = 5 as passed
  from pg_catalog.pg_constraint con
  where con.connamespace = to_regnamespace('coachfort_internal')
), index_state as (
  select jsonb_build_object(
    'claim_queue', to_regclass('coachfort_internal.transactional_email_outbox_claim_queue_idx') is not null,
    'provider_message_unique', to_regclass('coachfort_internal.transactional_email_outbox_provider_message_id_unique') is not null,
    'provider_event_message', to_regclass('coachfort_internal.transactional_email_provider_events_message_idx') is not null
  ) as value,
  to_regclass('coachfort_internal.transactional_email_outbox_claim_queue_idx') is not null
    and to_regclass('coachfort_internal.transactional_email_outbox_provider_message_id_unique') is not null
    and to_regclass('coachfort_internal.transactional_email_provider_events_message_idx') is not null as passed
), acl_state as (
  select jsonb_build_object(
    'direct_grants', coalesce(jsonb_agg(jsonb_build_object(
      'table', tp.table_name, 'grantee', tp.grantee, 'privilege', tp.privilege_type
    ) order by tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb),
    'browser_writes', count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'browser_dangerous', count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
    ),
    'any_direct_grants', count(*)
  ) as value,
  count(*) = 0 as passed
  from information_schema.table_privileges tp
  where tp.table_schema = 'coachfort_internal'
    and tp.table_name like 'transactional_email_%'
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), source_state as (
  select jsonb_build_object(
    'enqueue_conflict_check', enqueue_source like '%event key conflicts with existing content%'
      and enqueue_source like '%on conflict (event_key) do nothing%',
    'claim_skip_locked', claim_source like '%for update skip locked%',
    'bounded_batch', claim_source like '%p_batch_size not between 1 and 25%',
    'finite_lease', claim_source like '%p_lease_seconds not between 30 and 900%'
      and claim_source like '%lease_expires_at <= now()%',
    'max_attempts', claim_source like '%attempt_count < 5%'
      and finalize_source like '%attempt_count < 5%',
    'retry_schedule', finalize_source like '%interval ''1 minute''%'
      and finalize_source like '%interval ''5 minutes''%'
      and finalize_source like '%interval ''30 minutes''%'
      and finalize_source like '%interval ''2 hours''%'
      and finalize_source not like '%interval ''12 hours''%',
    'payload_null_safe', payload_source like '%coalesce(case%'
      and payload_source like '%p_payload is null%'
      and payload_source like '%octet_length(p_payload::text) > 8192%'
      and payload_source like '%jsonb_typeof(p_payload->''appurl'') = ''string''%'
      and payload_source like '%btrim(p_payload->>''appurl'') ~* ''^https?://%'
      and enqueue_source like '%) is not true then%',
    'suppression_checked', enqueue_source like '%transactional_email_suppressions%'
      and claim_source like '%transactional_email_suppressions%',
    'bounce_classified', provider_source like '%p_bounce_type%'
      and provider_source like '%p_event_type = ''email.bounced'' and p_bounce_type = ''permanent''%'
      and provider_source like '%p_bounce_type not in (''permanent'', ''transient'', ''undetermined'')%',
    'nonpermanent_bounce_evidence_only', provider_source like '%p_event_type = ''email.bounced'' and p_bounce_type = ''permanent'' then v_reason := ''hard_bounce''%'
      and provider_source not like '%p_event_type = ''email.bounced'' then%'
      and provider_source like '%insert into coachfort_internal.transactional_email_provider_events%'
      and provider_source like '%p_bounce_type, p_occurred_at%',
    'complaint_and_provider_suppression', provider_source like '%p_event_type = ''email.complained'' then v_reason := ''complaint''%'
      and provider_source like '%p_event_type = ''email.suppressed'' then v_reason := ''provider_suppressed''%',
    'suppression_reason_source_atomic', provider_source like '%reason = case%'
      and provider_source like '%transactional_email_suppressions.reason = excluded.reason%'
      and provider_source like '%transactional_email_suppressions.reason = ''complaint''%'
      and provider_source like '%transactional_email_suppressions.reason = ''hard_bounce'' and excluded.reason = ''provider_suppressed''%'
      and provider_source like '%then transactional_email_suppressions.source_event_id else excluded.source_event_id%'
      and provider_source like '%then transactional_email_suppressions.provider_message_id else excluded.provider_message_id%'
      and provider_source like '%then transactional_email_suppressions.suppressed_at else excluded.suppressed_at%'
      and provider_source like '%active = true, lifted_at = null%',
    'lifecycle_monotonic', provider_source like '%v_outbox.status in (''bounced'', ''complained'', ''suppressed'')%'
      and provider_source like '%p_event_type = ''email.failed'' and v_outbox.status <> ''delivered''%'
      and provider_source like '%p_event_type in (''email.delivery_delayed'', ''email.sent'') then ''ignored''%',
    'unknown_provider_safe', provider_source like '%processing_status = ''unmatched''%',
    'webhook_idempotent', provider_source like '%on conflict (provider, provider_event_id) do nothing%'
  ) as value,
  enqueue_source like '%event key conflicts with existing content%'
    and claim_source like '%for update skip locked%'
    and claim_source like '%p_batch_size not between 1 and 25%'
    and claim_source like '%lease_expires_at <= now()%'
    and claim_source like '%attempt_count < 5%'
    and finalize_source like '%interval ''1 minute''%'
    and finalize_source like '%interval ''5 minutes''%'
    and finalize_source like '%interval ''30 minutes''%'
    and finalize_source like '%interval ''2 hours''%'
    and finalize_source not like '%interval ''12 hours''%'
    and payload_source like '%coalesce(case%'
    and payload_source like '%p_payload is null%'
    and payload_source like '%octet_length(p_payload::text) > 8192%'
    and payload_source like '%jsonb_typeof(p_payload->''appurl'') = ''string''%'
    and payload_source like '%btrim(p_payload->>''appurl'') ~* ''^https?://%'
    and enqueue_source like '%) is not true then%'
    and provider_source like '%p_event_type = ''email.bounced'' and p_bounce_type = ''permanent''%'
    and provider_source like '%p_bounce_type not in (''permanent'', ''transient'', ''undetermined'')%'
    and provider_source not like '%p_event_type = ''email.bounced'' then%'
    and provider_source like '%p_event_type = ''email.complained'' then v_reason := ''complaint''%'
    and provider_source like '%p_event_type = ''email.suppressed'' then v_reason := ''provider_suppressed''%'
    and provider_source like '%transactional_email_suppressions.reason = excluded.reason%'
    and provider_source like '%transactional_email_suppressions.reason = ''complaint''%'
    and provider_source like '%transactional_email_suppressions.reason = ''hard_bounce'' and excluded.reason = ''provider_suppressed''%'
    and provider_source like '%then transactional_email_suppressions.source_event_id else excluded.source_event_id%'
    and provider_source like '%then transactional_email_suppressions.provider_message_id else excluded.provider_message_id%'
    and provider_source like '%then transactional_email_suppressions.suppressed_at else excluded.suppressed_at%'
    and provider_source like '%v_outbox.status in (''bounced'', ''complained'', ''suppressed'')%'
    and provider_source like '%p_event_type = ''email.failed'' and v_outbox.status <> ''delivered''%'
    and provider_source like '%on conflict (provider, provider_event_id) do nothing%'
    and provider_source like '%processing_status = ''unmatched''%' as passed
  from (
    select
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb)'
      )), '[[:space:]]+', ' ', 'g')) as enqueue_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'coachfort_internal.transactional_email_payload_valid(text,jsonb)'
      )), '[[:space:]]+', ' ', 'g')) as payload_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'public.claim_transactional_email_batch_server(text,integer,integer)'
      )), '[[:space:]]+', ' ', 'g')) as claim_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'public.finalize_transactional_email_attempt_server(uuid,uuid,text,text,integer,text,text)'
      )), '[[:space:]]+', ' ', 'g')) as finalize_source,
      lower(regexp_replace(pg_get_functiondef(to_regprocedure(
        'public.record_transactional_email_provider_event_server(text,text,text,timestamptz,text)'
      )), '[[:space:]]+', ' ', 'g')) as provider_source
  ) sources
), internal_schema_state as (
  select jsonb_build_object(
    'api_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1 from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(split_part(settings.setting, '=', 2), ',') exposed(schema_name)
      where r.rolname = 'authenticator' and settings.setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) as value,
  not (coalesce(
    'coachfort_internal' = any(regexp_split_to_array(
      replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
    )), false
  ) or exists (
    select 1 from pg_catalog.pg_db_role_setting rs
    join pg_catalog.pg_roles r on r.oid = rs.setrole
    cross join lateral unnest(rs.setconfig) settings(setting)
    cross join lateral regexp_split_to_table(split_part(settings.setting, '=', 2), ',') exposed(schema_name)
    where r.rolname = 'authenticator' and settings.setting like 'pgrst.db_schemas=%'
      and btrim(exposed.schema_name) = 'coachfort_internal'
  )) as passed
), unrelated_state as (
  select jsonb_build_object(
    'communication_logs_installed', to_regclass('public.communication_logs') is not null,
    'team_invitations_installed', to_regclass('public.team_invitations') is not null,
    'student_portal_invitations_installed', to_regclass('public.student_portal_invitations') is not null,
    'billing_profiles_installed', to_regclass('public.tenant_billing_profiles') is not null
  ) as value,
  to_regclass('public.communication_logs') is not null
    and to_regclass('public.team_invitations') is not null
    and to_regclass('public.student_portal_invitations') is not null as passed
), gate as (
  select ts.passed and rs.passed and pri.passed and ih.passed and cs.passed and ix.passed
    and acl.passed and ss.passed and ins.passed and us.passed as passed
  from table_state ts cross join rpc_state rs cross join public_rpc_identity_state pri
  cross join internal_helper_state ih
  cross join constraint_state cs cross join index_state ix cross join acl_state acl
  cross join source_state ss cross join internal_schema_state ins cross join unrelated_state us
)
select jsonb_pretty(jsonb_build_object(
  'tables', (select value from table_state),
  'rpcs', (select value from rpc_state),
  'public_rpc_identities', (select value from public_rpc_identity_state),
  'internal_helpers', (select value from internal_helper_state),
  'constraints', (select value from constraint_state),
  'indexes', (select value from index_state),
  'acl', (select value from acl_state),
  'contracts', (select value from source_state),
  'internal_schema', (select value from internal_schema_state),
  'unrelated_prerequisites', (select value from unrelated_state),
  'security_gate', (select passed from gate)
));
*/
