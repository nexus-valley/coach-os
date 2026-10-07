-- REGRESSION-R2A: durable noncommercial production-regression access authority.
--
-- Review-only draft. Do not execute before the separately reviewed R2B PRE.
-- Installing this authority does not authorize granting it to any production
-- tenant. No grant may be issued until REGRESSION-R3 commercial, reporting,
-- reminder, and automation exclusions are production-closed.

begin;

-- Fail closed unless the exact authority this migration extends is installed and
-- no partial R2 installation exists. This is an intentionally one-shot migration.
do $$
declare
  v_status_definition text;
  v_source_definition text;
  v_payment_definition text;
  v_lifecycle_fingerprint text;
begin
  if to_regnamespace('coachfort_internal') is null
     or to_regclass('public.tenants') is null
     or to_regclass('public.subscription_plans') is null
     or to_regclass('public.tenant_subscription_assignments') is null
     or to_regclass('public.platform_admin_users') is null
     or to_regclass('public.platform_activity_logs') is null
     or to_regclass('public.tenant_payment_orders') is null
     or to_regclass('public.tenant_plan_activation_events') is null
     or to_regclass('public.manual_subscription_activation_audits') is null
     or to_regclass('public.tenant_subscription_change_intents') is null
     or to_regclass('public.platform_tenant_subscriptions') is null
     or to_regclass('coachfort_internal.tenant_fixture_classifications') is null
     or to_regprocedure(
       'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.tenant_operational_access_allowed(uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.tenant_allows_automated_customer_communications(uuid)'
     ) is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'REGRESSION-R2 prerequisites are unavailable.'
      using errcode = '55000';
  end if;

  if to_regclass(
       'coachfort_internal.tenant_noncommercial_access_grants'
     ) is not null
     or to_regclass(
       'coachfort_internal.tenant_noncommercial_access_events'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.tenant_noncommercial_access_authority(uuid,uuid,uuid)'
     ) is not null
     or to_regprocedure(
       'public.grant_tenant_noncommercial_access_server(uuid,uuid,text,text,uuid)'
     ) is not null
     or to_regprocedure(
       'public.revoke_tenant_noncommercial_access_server(uuid,uuid,uuid,text,uuid)'
     ) is not null
     or exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'tenant_subscription_assignments'
         and column_name = 'noncommercial_grant_id'
     ) then
    raise exception 'REGRESSION-R2 is already or partially installed.'
      using errcode = '55000';
  end if;

  select pg_get_constraintdef(constraint_definition.oid)
  into v_status_definition
  from pg_catalog.pg_constraint constraint_definition
  where constraint_definition.conrelid =
      'public.tenant_subscription_assignments'::regclass
    and constraint_definition.conname =
      'tenant_subscription_assignments_status_check'
    and constraint_definition.contype = 'c'
    and constraint_definition.convalidated;

  select pg_get_constraintdef(constraint_definition.oid)
  into v_source_definition
  from pg_catalog.pg_constraint constraint_definition
  where constraint_definition.conrelid =
      'public.tenant_subscription_assignments'::regclass
    and constraint_definition.conname =
      'tenant_subscription_assignments_source_check'
    and constraint_definition.contype = 'c'
    and constraint_definition.convalidated;

  select pg_get_constraintdef(constraint_definition.oid)
  into v_payment_definition
  from pg_catalog.pg_constraint constraint_definition
  where constraint_definition.conrelid =
      'public.tenant_subscription_assignments'::regclass
    and constraint_definition.conname =
      'tenant_subscription_assignments_payment_status_check'
    and constraint_definition.contype = 'c'
    and constraint_definition.convalidated;

  -- Exact pg_get_constraintdef output prevents an unreviewed value or clause
  -- from being silently replaced during the PRE-to-APPLY window.
  if v_status_definition is distinct from
       'CHECK ((status = ANY (ARRAY[''trial''::text, ''active''::text, ''past_due''::text, ''grace''::text, ''suspended''::text, ''cancelled''::text, ''expired''::text])))' then
    raise exception 'REGRESSION-R2 assignment status baseline is incompatible.'
      using errcode = '55000';
  end if;

  if v_source_definition is distinct from
       'CHECK ((source = ANY (ARRAY[''platform_manual''::text, ''migration''::text, ''checkout''::text, ''system''::text])))' then
    raise exception 'REGRESSION-R2 assignment source baseline is incompatible.'
      using errcode = '55000';
  end if;

  if v_payment_definition is distinct from
       'CHECK ((payment_status = ANY (ARRAY[''not_required''::text, ''unpaid''::text, ''paid''::text, ''overdue''::text, ''waived''::text])))' then
    raise exception 'REGRESSION-R2 payment-status baseline is incompatible.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index index_definition
      on index_definition.indexrelid = index_relation.oid
    where namespace.nspname = 'public'
      and index_relation.relname =
        'tenant_subscription_assignments_current_unique_idx'
      and index_definition.indrelid =
        'public.tenant_subscription_assignments'::regclass
      and index_definition.indisunique
      and pg_get_expr(
        index_definition.indpred,
        index_definition.indrelid
      ) = 'is_current'
  ) then
    raise exception 'REGRESSION-R2 requires canonical current-assignment uniqueness.'
      using errcode = '55000';
  end if;

  if (select count(*) from public.subscription_plans where code = 'growth') <> 1
     or not exists (
       select 1
       from public.subscription_plans plan
       where plan.code = 'growth'
         and plan.status in ('draft', 'active')
     ) then
    raise exception 'REGRESSION-R2 requires one eligible canonical Growth plan.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid =
        'coachfort_internal.tenant_fixture_classifications'::regclass
      and constraint_definition.conname =
        'tenant_fixture_classifications_type_check'
      and constraint_definition.convalidated
      and lower(pg_get_constraintdef(constraint_definition.oid))
        like '%regression%'
  ) then
    raise exception 'REGRESSION-R2 fixture classification cannot represent regression.'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_subscription_assignments'
      and column_name in ('billing_cycle', 'currency')
      and is_nullable = 'NO'
  ) <> 2 then
    raise exception 'REGRESSION-R2 assignment billing baseline is incompatible.'
      using errcode = '55000';
  end if;

  -- Whitespace-normalized prosrc still fingerprints the complete reviewed body,
  -- while avoiding line-ending and formatting-only differences.
  select encode(
    extensions.digest(
      convert_to(
        regexp_replace(
          btrim(procedure_definition.prosrc),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into v_lifecycle_fingerprint
  from pg_catalog.pg_proc procedure_definition
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure_definition.pronamespace
  where procedure_definition.oid = to_regprocedure(
      'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
    )
    and namespace.nspname = 'coachfort_internal'
    and procedure_definition.prokind = 'f'
    and procedure_definition.prorettype = 'jsonb'::regtype
    and pg_get_userbyid(procedure_definition.proowner) = 'postgres'
    and procedure_definition.prosecdef
    and procedure_definition.provolatile = 's'
    and procedure_definition.proconfig @>
      array['search_path=public, pg_temp']::text[];

  if v_lifecycle_fingerprint is distinct from
       '226c968bacd6175aa8bfeb9a533b7a2ff9ec74cf432d1640c2956d8a160dae53' then
    raise exception 'REGRESSION-R2 lifecycle helper baseline has drifted.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure_definition
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure_definition.pronamespace
    where procedure_definition.oid = to_regprocedure(
        'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
      )
      and namespace.nspname = 'coachfort_internal'
      and pg_get_userbyid(procedure_definition.proowner) = 'postgres'
      and procedure_definition.prosecdef
      and procedure_definition.provolatile = 's'
      and procedure_definition.proconfig @>
        array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'REGRESSION-R2 lifecycle helper security baseline is incompatible.'
      using errcode = '55000';
  end if;
end;
$$;

create table coachfort_internal.tenant_noncommercial_access_grants (
  grant_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  plan_id uuid not null,
  purpose text not null,
  starts_at timestamptz not null,
  created_at timestamptz not null,
  created_by uuid not null,
  reason text not null,
  request_id uuid not null,
  request_fingerprint text not null,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  revocation_request_id uuid,
  revocation_request_fingerprint text,
  constraint tenant_noncommercial_access_grants_tenant_fk
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  constraint tenant_noncommercial_access_grants_plan_fk
    foreign key (plan_id)
    references public.subscription_plans(id) on delete restrict,
  constraint tenant_noncommercial_access_grants_created_by_fk
    foreign key (created_by) references auth.users(id) on delete restrict,
  constraint tenant_noncommercial_access_grants_revoked_by_fk
    foreign key (revoked_by) references auth.users(id) on delete restrict,
  constraint tenant_noncommercial_access_grants_identity_unique
    unique (grant_id, tenant_id, plan_id),
  constraint tenant_noncommercial_access_grants_request_unique
    unique (request_id),
  constraint tenant_noncommercial_access_grants_purpose_check
    check (purpose = 'production_regression'),
  constraint tenant_noncommercial_access_grants_time_check
    check (starts_at = created_at),
  constraint tenant_noncommercial_access_grants_reason_check
    check (
      char_length(reason) between 1 and 500
      and reason !~ '[<>[:cntrl:]]'
    ),
  constraint tenant_noncommercial_access_grants_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint tenant_noncommercial_access_grants_revocation_pair_check
    check (
      (
        revoked_at is null
        and revoked_by is null
        and revocation_reason is null
        and revocation_request_id is null
        and revocation_request_fingerprint is null
      )
      or
      (
        revoked_at is not null
        and revoked_by is not null
        and revocation_reason is not null
        and revocation_request_id is not null
        and revocation_request_fingerprint is not null
        and revoked_at >= starts_at
        and char_length(revocation_reason) between 1 and 500
        and revocation_reason !~ '[<>[:cntrl:]]'
        and revocation_request_fingerprint ~ '^[0-9a-f]{64}$'
      )
    )
);

create unique index tenant_noncommercial_access_grants_live_tenant_uidx
  on coachfort_internal.tenant_noncommercial_access_grants (tenant_id)
  where revoked_at is null;

create unique index tenant_noncommercial_access_grants_revoke_request_uidx
  on coachfort_internal.tenant_noncommercial_access_grants (
    revocation_request_id
  )
  where revocation_request_id is not null;

create table coachfort_internal.tenant_noncommercial_access_events (
  event_id uuid primary key default gen_random_uuid(),
  grant_id uuid not null,
  tenant_id uuid not null,
  plan_id uuid not null,
  assignment_id uuid not null,
  purpose text not null,
  actor_user_id uuid not null,
  event_type text not null,
  request_id uuid not null,
  request_fingerprint text not null,
  reason text not null,
  event_at timestamptz not null,
  constraint tenant_noncommercial_access_events_grant_fk
    foreign key (grant_id, tenant_id, plan_id)
    references coachfort_internal.tenant_noncommercial_access_grants (
      grant_id, tenant_id, plan_id
    ) on delete restrict,
  constraint tenant_noncommercial_access_events_assignment_fk
    foreign key (assignment_id)
    references public.tenant_subscription_assignments(id) on delete restrict,
  constraint tenant_noncommercial_access_events_actor_fk
    foreign key (actor_user_id) references auth.users(id) on delete restrict,
  constraint tenant_noncommercial_access_events_request_unique
    unique (request_id),
  constraint tenant_noncommercial_access_events_purpose_check
    check (purpose = 'production_regression'),
  constraint tenant_noncommercial_access_events_type_check
    check (event_type in ('grant_created', 'grant_revoked')),
  constraint tenant_noncommercial_access_events_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint tenant_noncommercial_access_events_reason_check
    check (
      char_length(reason) between 1 and 500
      and reason !~ '[<>[:cntrl:]]'
    )
);

create function coachfort_internal.enforce_noncommercial_grant_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Noncommercial access grant evidence cannot be deleted.'
      using errcode = '55000';
  end if;

  if old.revoked_at is not null then
    raise exception 'Revoked noncommercial access grant evidence is immutable.'
      using errcode = '55000';
  end if;

  if row(
       new.grant_id, new.tenant_id, new.plan_id, new.purpose,
       new.starts_at, new.created_at, new.created_by, new.reason,
       new.request_id, new.request_fingerprint
     ) is distinct from row(
       old.grant_id, old.tenant_id, old.plan_id, old.purpose,
       old.starts_at, old.created_at, old.created_by, old.reason,
       old.request_id, old.request_fingerprint
     )
     or new.revoked_at is null
     or new.revoked_by is null
     or new.revocation_reason is null
     or new.revocation_request_id is null
     or new.revocation_request_fingerprint is null then
    raise exception 'Noncommercial access grant issuance evidence is immutable.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger enforce_noncommercial_grant_immutability
before update or delete
on coachfort_internal.tenant_noncommercial_access_grants
for each row execute function
  coachfort_internal.enforce_noncommercial_grant_immutability();

create trigger enforce_noncommercial_grant_no_truncate
before truncate
on coachfort_internal.tenant_noncommercial_access_grants
for each statement execute function
  coachfort_internal.enforce_noncommercial_grant_immutability();

create function coachfort_internal.enforce_noncommercial_event_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Noncommercial access event evidence is immutable.'
    using errcode = '55000';
end;
$$;

create trigger enforce_noncommercial_event_immutability
before update or delete
on coachfort_internal.tenant_noncommercial_access_events
for each row execute function
  coachfort_internal.enforce_noncommercial_event_immutability();

create trigger enforce_noncommercial_event_no_truncate
before truncate
on coachfort_internal.tenant_noncommercial_access_events
for each statement execute function
  coachfort_internal.enforce_noncommercial_event_immutability();

alter table public.tenant_subscription_assignments
  add column noncommercial_grant_id uuid;

alter table public.tenant_subscription_assignments
  alter column billing_cycle drop not null,
  alter column currency drop not null;

alter table public.tenant_subscription_assignments
  drop constraint tenant_subscription_assignments_status_check,
  add constraint tenant_subscription_assignments_status_check check (
    status in (
      'trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled',
      'expired', 'noncommercial'
    )
  ),
  drop constraint tenant_subscription_assignments_source_check,
  add constraint tenant_subscription_assignments_source_check check (
    source in (
      'platform_manual', 'migration', 'checkout', 'system',
      'platform_noncommercial'
    )
  ),
  add constraint tenant_subscription_assignments_noncommercial_grant_fk
    foreign key (noncommercial_grant_id, tenant_id, plan_id)
    references coachfort_internal.tenant_noncommercial_access_grants (
      grant_id, tenant_id, plan_id
    ) on delete restrict,
  add constraint tenant_subscription_assignments_noncommercial_contract_check
    check (
      (
        status = 'noncommercial'
        and source = 'platform_noncommercial'
        and payment_status = 'not_required'
        and noncommercial_grant_id is not null
        and billing_cycle is null
        and currency is null
        and trial_started_at is null
        and trial_ends_at is null
        and current_period_start is null
        and current_period_end is null
        and grace_period_ends_at is null
      )
      or
      (
        status <> 'noncommercial'
        and source <> 'platform_noncommercial'
        and noncommercial_grant_id is null
        and billing_cycle is not null
        and currency is not null
      )
    );

create function coachfort_internal.tenant_noncommercial_access_authority(
  p_tenant_id uuid,
  p_grant_id uuid,
  p_plan_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant coachfort_internal.tenant_noncommercial_access_grants%rowtype;
begin
  if p_tenant_id is null or p_grant_id is null or p_plan_id is null then
    return jsonb_build_object(
      'valid', false,
      'reason', 'missing_noncommercial_grant_authority'
    );
  end if;

  select * into v_grant
  from coachfort_internal.tenant_noncommercial_access_grants grant_row
  where grant_row.grant_id = p_grant_id;

  if v_grant.grant_id is null then
    return jsonb_build_object(
      'valid', false,
      'reason', 'noncommercial_grant_not_found'
    );
  elsif v_grant.tenant_id is distinct from p_tenant_id then
    return jsonb_build_object(
      'valid', false,
      'reason', 'noncommercial_grant_tenant_mismatch'
    );
  elsif v_grant.plan_id is distinct from p_plan_id then
    return jsonb_build_object(
      'valid', false,
      'reason', 'noncommercial_grant_plan_mismatch'
    );
  elsif not exists (
    select 1
    from public.subscription_plans plan
    where plan.id = v_grant.plan_id
      and plan.code = 'growth'
  ) then
    return jsonb_build_object(
      'valid', false,
      'reason', 'noncommercial_grant_not_growth'
    );
  -- Catalog publication status does not revoke an already-issued grant. The
  -- immutable canonical Growth identity remains mandatory.
  elsif v_grant.purpose <> 'production_regression' then
    return jsonb_build_object(
      'valid', false,
      'reason', 'invalid_noncommercial_grant_purpose'
    );
  elsif v_grant.starts_at > now() then
    return jsonb_build_object(
      'valid', false,
      'reason', 'future_noncommercial_grant_start'
    );
  elsif v_grant.revoked_at is not null then
    return jsonb_build_object(
      'valid', false,
      'reason', 'noncommercial_access_revoked'
    );
  end if;

  return jsonb_build_object(
    'valid', true,
    'reason', 'within_noncommercial_access'
  );
exception when others then
  return jsonb_build_object(
    'valid', false,
    'reason', 'noncommercial_authority_unavailable'
  );
end;
$$;

create or replace function coachfort_internal.tenant_subscription_effective_lifecycle(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.tenant_subscription_assignments%rowtype;
  v_noncommercial jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_grace_end timestamptz;
  v_effective_state text := 'expired';
  v_allowed boolean := false;
  v_reason text := 'missing_canonical_assignment';
  v_valid_payment boolean := false;
begin
  if p_tenant_id is null then
    return jsonb_build_object(
      'tenant_id', null, 'assignment_id', null, 'stored_status', null,
      'payment_status', null, 'current_period_start', null,
      'current_period_end', null, 'grace_period_ends_at', null,
      'trial_started_at', null, 'trial_ends_at', null,
      'effective_state', 'expired', 'operational_allowed', false,
      'reason', 'invalid_tenant'
    );
  end if;

  select * into v_assignment
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id and assignment.is_current
  limit 1;

  if v_assignment.id is null then
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'assignment_id', null, 'stored_status', null,
      'payment_status', null, 'current_period_start', null,
      'current_period_end', null, 'grace_period_ends_at', null,
      'trial_started_at', null, 'trial_ends_at', null,
      'effective_state', 'expired', 'operational_allowed', false,
      'reason', v_reason
    );
  end if;

  if v_assignment.status = 'noncommercial' then
    if v_assignment.source <> 'platform_noncommercial'
       or v_assignment.payment_status <> 'not_required'
       or v_assignment.noncommercial_grant_id is null
       or v_assignment.billing_cycle is not null
       or v_assignment.currency is not null
       or v_assignment.trial_started_at is not null
       or v_assignment.trial_ends_at is not null
       or v_assignment.current_period_start is not null
       or v_assignment.current_period_end is not null
       or v_assignment.grace_period_ends_at is not null then
      v_reason := 'malformed_noncommercial_assignment';
    else
      v_noncommercial :=
        coachfort_internal.tenant_noncommercial_access_authority(
          v_assignment.tenant_id,
          v_assignment.noncommercial_grant_id,
          v_assignment.plan_id
        );
      v_reason := coalesce(
        v_noncommercial->>'reason',
        'noncommercial_authority_unavailable'
      );
      if coalesce((v_noncommercial->>'valid')::boolean, false) then
        v_effective_state := 'active';
        v_allowed := true;
      end if;
    end if;

    return jsonb_build_object(
      'tenant_id', v_assignment.tenant_id,
      'assignment_id', v_assignment.id,
      'stored_status', v_assignment.status,
      'payment_status', v_assignment.payment_status,
      'current_period_start', v_assignment.current_period_start,
      'current_period_end', v_assignment.current_period_end,
      'grace_period_ends_at', v_assignment.grace_period_ends_at,
      'trial_started_at', v_assignment.trial_started_at,
      'trial_ends_at', v_assignment.trial_ends_at,
      'effective_state', v_effective_state,
      'operational_allowed', v_allowed,
      'reason', v_reason
    );
  end if;

  v_period_start := v_assignment.current_period_start;
  v_period_end := v_assignment.current_period_end;

  if v_assignment.status = 'trial' then
    if v_assignment.payment_status <> 'not_required' then
      v_reason := 'invalid_status_payment_combination';
    elsif v_assignment.trial_started_at is null
       or v_assignment.trial_ends_at is null then
      v_reason := 'missing_trial_authority';
    elsif v_assignment.trial_started_at > now() then
      v_reason := 'future_trial_start';
    elsif v_assignment.trial_started_at >= v_assignment.trial_ends_at then
      v_reason := 'invalid_trial_ordering';
    elsif now() < v_assignment.trial_ends_at then
      v_effective_state := 'active';
      v_allowed := true;
      v_reason := 'within_trial_period';
    else
      v_effective_state := 'expired';
      v_allowed := false;
      v_reason := 'trial_period_elapsed';
    end if;

    return jsonb_build_object(
      'tenant_id', v_assignment.tenant_id,
      'assignment_id', v_assignment.id,
      'stored_status', v_assignment.status,
      'payment_status', v_assignment.payment_status,
      'current_period_start', v_assignment.current_period_start,
      'current_period_end', v_assignment.current_period_end,
      'grace_period_ends_at', v_assignment.grace_period_ends_at,
      'trial_started_at', v_assignment.trial_started_at,
      'trial_ends_at', v_assignment.trial_ends_at,
      'effective_state', v_effective_state,
      'operational_allowed', v_allowed,
      'reason', v_reason
    );
  end if;

  v_valid_payment :=
    (v_assignment.status = 'active'
      and v_assignment.payment_status in ('paid','waived'))
    or (v_assignment.status = 'grace'
      and v_assignment.payment_status in ('paid','overdue','waived'))
    or (v_assignment.status = 'past_due'
      and v_assignment.payment_status in ('unpaid','overdue'));
  v_grace_end := v_assignment.grace_period_ends_at;

  if v_assignment.status in ('cancelled','suspended','expired') then
    v_reason := 'stored_terminal_or_suspended';
  elsif not v_valid_payment then
    v_reason := 'invalid_status_payment_combination';
  elsif v_period_start is null or v_period_end is null then
    v_reason := 'missing_period_authority';
  elsif v_period_start > now() then
    v_reason := 'future_period_start';
  elsif v_period_start >= v_period_end then
    v_reason := 'invalid_period_ordering';
  elsif v_grace_end is null
     or v_grace_end is distinct from v_period_end + interval '7 days' then
    v_reason := 'invalid_grace_authority';
  elsif now() < v_period_end then
    v_effective_state := 'active';
    v_allowed := true;
    v_reason := 'within_purchased_period';
  elsif now() < v_grace_end then
    v_effective_state := 'grace';
    v_allowed := true;
    v_reason := 'within_fixed_grace_period';
  else
    v_effective_state := 'expired';
    v_allowed := false;
    v_reason := 'grace_period_elapsed';
  end if;

  return jsonb_build_object(
    'tenant_id', v_assignment.tenant_id,
    'assignment_id', v_assignment.id,
    'stored_status', v_assignment.status,
    'payment_status', v_assignment.payment_status,
    'current_period_start', v_period_start,
    'current_period_end', v_period_end,
    'grace_period_ends_at', v_grace_end,
    'trial_started_at', v_assignment.trial_started_at,
    'trial_ends_at', v_assignment.trial_ends_at,
    'effective_state', v_effective_state,
    'operational_allowed', v_allowed,
    'reason', v_reason
  );
end;
$$;

-- Prevent the broad initial checkout authority from accepting a noncommercial
-- current assignment. This trigger independently takes a share lock so direct
-- or future payment-order writers serialize with the grant assignment update.
-- Renewal already requires purchased active/grace/past_due tuples; manual
-- activation already rejects any non-trial assignment history.
create function coachfort_internal.enforce_noncommercial_payment_order_boundary()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid := new.tenant_id;
begin
  -- This statement exists only to serialize with a concurrent current-assignment
  -- transition. Final authority is read by the following statement using its
  -- fresh READ COMMITTED snapshot after any lock wait has completed.
  perform assignment.id
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = v_tenant_id
    and assignment.is_current
  limit 1
  for share;

  if exists (
    select 1
    from public.tenant_subscription_assignments assignment
    where assignment.tenant_id = v_tenant_id
      and assignment.is_current
      and (
        assignment.status = 'noncommercial'
        or assignment.source = 'platform_noncommercial'
        or assignment.noncommercial_grant_id is not null
      )
  ) then
    raise exception 'Noncommercial access is not eligible for payment checkout.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger enforce_noncommercial_payment_order_boundary
before insert or update of tenant_id
on public.tenant_payment_orders
for each row execute function
  coachfort_internal.enforce_noncommercial_payment_order_boundary();

create function public.grant_tenant_noncommercial_access_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_purpose text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_purpose text := lower(btrim(coalesce(p_purpose, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := transaction_timestamp();
  v_actor_role text;
  v_plan public.subscription_plans%rowtype;
  v_current public.tenant_subscription_assignments%rowtype;
  v_grant coachfort_internal.tenant_noncommercial_access_grants%rowtype;
  v_existing_event coachfort_internal.tenant_noncommercial_access_events%rowtype;
  v_assignment_id uuid;
  v_fixture_type text;
  v_fixture_communications_enabled boolean;
  v_request_payload jsonb;
  v_request_fingerprint text;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_request_id is null then
    raise exception 'Tenant, actor, and request identifiers are required.'
      using errcode = '22023';
  end if;

  select platform_actor.role into v_actor_role
  from public.platform_admin_users platform_actor
  where platform_actor.user_id = p_actor_user_id
    and platform_actor.status = 'active'
    and platform_actor.role in ('owner', 'admin')
  for share;

  if v_actor_role is null then
    raise exception 'Platform noncommercial access authority is required.'
      using errcode = '42501';
  end if;

  if v_purpose <> 'production_regression' then
    raise exception 'Only production_regression noncommercial access is supported.'
      using errcode = '22023';
  end if;

  if char_length(v_reason) not between 1 and 500
     or v_reason ~ '[<>[:cntrl:]]' then
    raise exception 'A safe bounded operator reason is required.'
      using errcode = '22023';
  end if;

  select * into v_plan
  from public.subscription_plans plan
  where plan.code = 'growth';

  if v_plan.id is null then
    raise exception 'Canonical Growth plan authority is unavailable.'
      using errcode = '55000';
  end if;

  v_request_payload := jsonb_build_object(
    'operation', 'grant_noncommercial_access',
    'request_id', p_request_id,
    'tenant_id', p_tenant_id,
    'actor_user_id', p_actor_user_id,
    'purpose', v_purpose,
    'plan_id', v_plan.id,
    'plan_code', v_plan.code,
    'starts_at_semantics', 'transaction_timestamp_at_first_accept',
    'expires_at', null,
    'reason', v_reason
  );
  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(v_request_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'regression_r2_request:' || p_request_id::text,
    9202
  ));

  select * into v_existing_event
  from coachfort_internal.tenant_noncommercial_access_events event_row
  where event_row.request_id = p_request_id
  for update;

  if v_existing_event.event_id is not null then
    if v_existing_event.event_type = 'grant_created'
       and v_existing_event.tenant_id = p_tenant_id
       and v_existing_event.actor_user_id = p_actor_user_id
       and v_existing_event.purpose = v_purpose
       and v_existing_event.plan_id = v_plan.id
       and v_existing_event.request_fingerprint = v_request_fingerprint then
      select * into v_grant
      from coachfort_internal.tenant_noncommercial_access_grants grant_row
      where grant_row.grant_id = v_existing_event.grant_id;

      if v_grant.grant_id is null then
        raise exception 'Noncommercial grant replay authority is malformed.'
          using errcode = '55000';
      end if;

      return jsonb_build_object(
        'grant_id', v_grant.grant_id,
        'tenant_id', v_grant.tenant_id,
        'assignment_id', v_existing_event.assignment_id,
        'plan_id', v_grant.plan_id,
        'plan_code', 'growth',
        'purpose', v_grant.purpose,
        'starts_at', v_grant.starts_at,
        'revoked_at', v_grant.revoked_at,
        'operational_allowed', v_grant.revoked_at is null,
        'request_id', p_request_id,
        'idempotent', true
      );
    end if;

    raise exception 'Noncommercial access request identity conflicts with existing evidence.'
      using errcode = '23505';
  end if;

  -- Shared lock order follows installed manual activation: tenant, catalog,
  -- current assignment, then grant. The first unlocked catalog read above is
  -- used only to derive deterministic request identity; this locked re-read is
  -- the authority for a new grant. Canonical checkout holds a share lock on the
  -- current assignment before its insert, so the payment-order trigger and this
  -- transition cannot both accept the old trial authority.
  perform tenant.id
  from public.tenants tenant
  where tenant.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  select * into v_plan
  from public.subscription_plans plan
  where plan.id = v_plan.id
    and plan.code = 'growth'
  for share;

  if v_plan.id is null or v_plan.status not in ('draft', 'active') then
    raise exception 'Canonical Growth plan is not eligible for a new grant.'
      using errcode = '55000';
  end if;

  select * into v_current
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  limit 1
  for update;

  if v_current.id is null then
    raise exception 'A canonical current workspace trial is required.'
      using errcode = '55000';
  end if;

  select * into v_grant
  from coachfort_internal.tenant_noncommercial_access_grants grant_row
  where grant_row.tenant_id = p_tenant_id
    and grant_row.revoked_at is null
  for update;

  if v_grant.grant_id is not null then
    raise exception 'An active noncommercial access grant already exists.'
      using errcode = '23505';
  end if;

  if v_current.status <> 'trial'
     or v_current.payment_status <> 'not_required'
     or v_current.source <> 'system'
     or v_current.noncommercial_grant_id is not null
     or v_current.trial_started_at is null
     or v_current.trial_ends_at is null
     or v_current.trial_started_at > v_now
     or v_current.trial_started_at >= v_current.trial_ends_at
     or v_current.current_period_start is not null
     or v_current.current_period_end is not null
     or v_current.grace_period_ends_at is not null
     or not exists (
       select 1
       from public.subscription_plans trial_plan
       where trial_plan.id = v_current.plan_id
         and trial_plan.is_workspace_trial_default
     ) then
    raise exception 'Only a canonical system workspace trial can be superseded.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.tenant_subscription_assignments assignment
    where assignment.tenant_id = p_tenant_id
      and (
        assignment.status <> 'trial'
        or assignment.payment_status <> 'not_required'
        or assignment.source <> 'system'
        or assignment.current_period_start is not null
        or assignment.current_period_end is not null
        or assignment.grace_period_ends_at is not null
        or assignment.noncommercial_grant_id is not null
        or not exists (
          select 1
          from public.subscription_plans history_plan
          where history_plan.id = assignment.plan_id
            and history_plan.is_workspace_trial_default
        )
      )
  )
  or exists (
    select 1 from public.tenant_payment_orders payment_order
    where payment_order.tenant_id = p_tenant_id
  )
  or exists (
    select 1 from public.tenant_plan_activation_events activation
    where activation.tenant_id = p_tenant_id
  )
  or exists (
    select 1 from public.manual_subscription_activation_audits evidence
    where evidence.tenant_id = p_tenant_id
  )
  or exists (
    select 1 from public.tenant_subscription_change_intents intent
    where intent.tenant_id = p_tenant_id
  )
  or exists (
    select 1 from public.platform_tenant_subscriptions projection
    where projection.tenant_id = p_tenant_id
      and (
        projection.status <> 'trial'
        or projection.payment_status <> 'not_required'
        or projection.amount <> 0
        or projection.current_period_start is not null
        or projection.current_period_end is not null
      )
  ) then
    raise exception 'Commercial or noncanonical subscription history cannot be replaced.'
      using errcode = '55000';
  end if;

  insert into coachfort_internal.tenant_noncommercial_access_grants (
    tenant_id,
    plan_id,
    purpose,
    starts_at,
    created_at,
    created_by,
    reason,
    request_id,
    request_fingerprint
  ) values (
    p_tenant_id,
    v_plan.id,
    v_purpose,
    v_now,
    v_now,
    p_actor_user_id,
    v_reason,
    p_request_id,
    v_request_fingerprint
  ) returning * into v_grant;

  update public.tenant_subscription_assignments assignment
  set is_current = false,
      updated_by = p_actor_user_id,
      updated_at = v_now
  where assignment.id = v_current.id;

  insert into public.tenant_subscription_assignments (
    tenant_id,
    plan_id,
    status,
    billing_cycle,
    currency,
    trial_started_at,
    trial_ends_at,
    current_period_start,
    current_period_end,
    grace_period_ends_at,
    payment_status,
    source,
    is_current,
    metadata_json,
    created_by,
    updated_by,
    noncommercial_grant_id
  ) values (
    p_tenant_id,
    v_plan.id,
    'noncommercial',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    'not_required',
    'platform_noncommercial',
    true,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id,
    v_grant.grant_id
  ) returning id into v_assignment_id;

  insert into coachfort_internal.tenant_noncommercial_access_events (
    grant_id,
    tenant_id,
    plan_id,
    assignment_id,
    purpose,
    actor_user_id,
    event_type,
    request_id,
    request_fingerprint,
    reason,
    event_at
  ) values (
    v_grant.grant_id,
    p_tenant_id,
    v_plan.id,
    v_assignment_id,
    v_purpose,
    p_actor_user_id,
    'grant_created',
    p_request_id,
    v_request_fingerprint,
    v_reason,
    v_now
  );

  insert into coachfort_internal.tenant_fixture_classifications (
    tenant_id,
    fixture_type,
    automated_customer_communications_enabled
  ) values (
    p_tenant_id,
    'regression',
    false
  )
  on conflict (tenant_id) do update
  set automated_customer_communications_enabled = false
  where tenant_fixture_classifications.fixture_type = 'regression'
  returning
    fixture_type,
    automated_customer_communications_enabled
  into
    v_fixture_type,
    v_fixture_communications_enabled;

  if not found
     or v_fixture_type is distinct from 'regression'
     or v_fixture_communications_enabled is distinct from false then
    raise exception 'Tenant has a conflicting fixture classification.'
      using errcode = '55000';
  end if;

  insert into public.platform_activity_logs (
    actor_id,
    tenant_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_actor_user_id,
    p_tenant_id,
    'tenant_noncommercial_access_granted',
    'tenant_noncommercial_access_grant',
    v_grant.grant_id,
    jsonb_build_object(
      'purpose', v_purpose,
      'plan_code', v_plan.code,
      'request_id', p_request_id,
      'payment_authority', false,
      'provider_authority', false
    )
  );

  return jsonb_build_object(
    'grant_id', v_grant.grant_id,
    'tenant_id', p_tenant_id,
    'assignment_id', v_assignment_id,
    'plan_id', v_plan.id,
    'plan_code', v_plan.code,
    'purpose', v_purpose,
    'starts_at', v_grant.starts_at,
    'revoked_at', null,
    'operational_allowed', true,
    'request_id', p_request_id,
    'idempotent', false
  );
end;
$$;

create function public.revoke_tenant_noncommercial_access_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_grant_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := transaction_timestamp();
  v_actor_role text;
  v_current public.tenant_subscription_assignments%rowtype;
  v_grant coachfort_internal.tenant_noncommercial_access_grants%rowtype;
  v_existing_event coachfort_internal.tenant_noncommercial_access_events%rowtype;
  v_request_payload jsonb;
  v_request_fingerprint text;
begin
  if p_tenant_id is null or p_actor_user_id is null
     or p_grant_id is null or p_request_id is null then
    raise exception 'Tenant, actor, grant, and request identifiers are required.'
      using errcode = '22023';
  end if;

  select platform_actor.role into v_actor_role
  from public.platform_admin_users platform_actor
  where platform_actor.user_id = p_actor_user_id
    and platform_actor.status = 'active'
    and platform_actor.role in ('owner', 'admin')
  for share;

  if v_actor_role is null then
    raise exception 'Platform noncommercial access authority is required.'
      using errcode = '42501';
  end if;

  if char_length(v_reason) not between 1 and 500
     or v_reason ~ '[<>[:cntrl:]]' then
    raise exception 'A safe bounded revocation reason is required.'
      using errcode = '22023';
  end if;

  v_request_payload := jsonb_build_object(
    'operation', 'revoke_noncommercial_access',
    'request_id', p_request_id,
    'tenant_id', p_tenant_id,
    'actor_user_id', p_actor_user_id,
    'grant_id', p_grant_id,
    'reason', v_reason
  );
  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(v_request_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'regression_r2_request:' || p_request_id::text,
    9202
  ));

  select * into v_existing_event
  from coachfort_internal.tenant_noncommercial_access_events event_row
  where event_row.request_id = p_request_id
  for update;

  if v_existing_event.event_id is not null then
    if v_existing_event.event_type = 'grant_revoked'
       and v_existing_event.tenant_id = p_tenant_id
       and v_existing_event.actor_user_id = p_actor_user_id
       and v_existing_event.grant_id = p_grant_id
       and v_existing_event.request_fingerprint = v_request_fingerprint then
      select * into v_grant
      from coachfort_internal.tenant_noncommercial_access_grants grant_row
      where grant_row.grant_id = p_grant_id;

      if v_grant.grant_id is null or v_grant.revoked_at is null then
        raise exception 'Noncommercial revocation replay authority is malformed.'
          using errcode = '55000';
      end if;

      return jsonb_build_object(
        'grant_id', v_grant.grant_id,
        'tenant_id', v_grant.tenant_id,
        'assignment_id', v_existing_event.assignment_id,
        'plan_id', v_grant.plan_id,
        'plan_code', 'growth',
        'purpose', v_grant.purpose,
        'starts_at', v_grant.starts_at,
        'revoked_at', v_grant.revoked_at,
        'operational_allowed', false,
        'request_id', p_request_id,
        'idempotent', true
      );
    end if;

    raise exception 'Noncommercial revocation request identity conflicts with existing evidence.'
      using errcode = '23505';
  end if;

  perform tenant.id
  from public.tenants tenant
  where tenant.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found.' using errcode = '22023';
  end if;

  select * into v_current
  from public.tenant_subscription_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.is_current
  limit 1
  for update;

  select * into v_grant
  from coachfort_internal.tenant_noncommercial_access_grants grant_row
  where grant_row.grant_id = p_grant_id
    and grant_row.tenant_id = p_tenant_id
  for update;

  if v_grant.grant_id is null then
    raise exception 'Noncommercial access grant not found.'
      using errcode = '22023';
  elsif v_grant.revoked_at is not null then
    raise exception 'Noncommercial access grant is already revoked.'
      using errcode = '55000';
  end if;

  if v_current.id is null
     or v_current.status <> 'noncommercial'
     or v_current.source <> 'platform_noncommercial'
     or v_current.payment_status <> 'not_required'
     or v_current.noncommercial_grant_id is distinct from v_grant.grant_id
     or v_current.plan_id is distinct from v_grant.plan_id
     or v_current.billing_cycle is not null
     or v_current.currency is not null
     or v_current.trial_started_at is not null
     or v_current.trial_ends_at is not null
     or v_current.current_period_start is not null
     or v_current.current_period_end is not null
     or v_current.grace_period_ends_at is not null then
    raise exception 'Current noncommercial assignment authority is malformed.'
      using errcode = '55000';
  end if;

  update coachfort_internal.tenant_noncommercial_access_grants grant_row
  set revoked_at = v_now,
      revoked_by = p_actor_user_id,
      revocation_reason = v_reason,
      revocation_request_id = p_request_id,
      revocation_request_fingerprint = v_request_fingerprint
  where grant_row.grant_id = v_grant.grant_id
  returning * into v_grant;

  insert into coachfort_internal.tenant_noncommercial_access_events (
    grant_id,
    tenant_id,
    plan_id,
    assignment_id,
    purpose,
    actor_user_id,
    event_type,
    request_id,
    request_fingerprint,
    reason,
    event_at
  ) values (
    v_grant.grant_id,
    v_grant.tenant_id,
    v_grant.plan_id,
    v_current.id,
    v_grant.purpose,
    p_actor_user_id,
    'grant_revoked',
    p_request_id,
    v_request_fingerprint,
    v_reason,
    v_now
  );

  -- Fixture communication suppression intentionally remains after revocation.
  if not exists (
    select 1
    from coachfort_internal.tenant_fixture_classifications classification
    where classification.tenant_id = p_tenant_id
      and classification.fixture_type = 'regression'
      and not classification.automated_customer_communications_enabled
  ) then
    raise exception 'Regression communication suppression authority is missing.'
      using errcode = '55000';
  end if;

  insert into public.platform_activity_logs (
    actor_id,
    tenant_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_actor_user_id,
    p_tenant_id,
    'tenant_noncommercial_access_revoked',
    'tenant_noncommercial_access_grant',
    v_grant.grant_id,
    jsonb_build_object(
      'purpose', v_grant.purpose,
      'plan_code', 'growth',
      'request_id', p_request_id,
      'payment_authority', false,
      'provider_authority', false
    )
  );

  return jsonb_build_object(
    'grant_id', v_grant.grant_id,
    'tenant_id', v_grant.tenant_id,
    'assignment_id', v_current.id,
    'plan_id', v_grant.plan_id,
    'plan_code', 'growth',
    'purpose', v_grant.purpose,
    'starts_at', v_grant.starts_at,
    'revoked_at', v_grant.revoked_at,
    'operational_allowed', false,
    'request_id', p_request_id,
    'idempotent', false
  );
end;
$$;

alter table coachfort_internal.tenant_noncommercial_access_grants
  owner to postgres;
alter table coachfort_internal.tenant_noncommercial_access_events
  owner to postgres;
alter function coachfort_internal.enforce_noncommercial_grant_immutability()
  owner to postgres;
alter function coachfort_internal.enforce_noncommercial_event_immutability()
  owner to postgres;
alter function coachfort_internal.tenant_noncommercial_access_authority(
  uuid, uuid, uuid
) owner to postgres;
alter function coachfort_internal.enforce_noncommercial_payment_order_boundary()
  owner to postgres;
alter function coachfort_internal.tenant_subscription_effective_lifecycle(uuid)
  owner to postgres;
alter function public.grant_tenant_noncommercial_access_server(
  uuid, uuid, text, text, uuid
) owner to postgres;
alter function public.revoke_tenant_noncommercial_access_server(
  uuid, uuid, uuid, text, uuid
) owner to postgres;

alter table coachfort_internal.tenant_noncommercial_access_grants
  enable row level security;
alter table coachfort_internal.tenant_noncommercial_access_events
  enable row level security;

revoke all on table
  coachfort_internal.tenant_noncommercial_access_grants,
  coachfort_internal.tenant_noncommercial_access_events
from public, anon, authenticated, service_role;

revoke all on function
  coachfort_internal.enforce_noncommercial_grant_immutability()
from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.enforce_noncommercial_event_immutability()
from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.tenant_noncommercial_access_authority(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.enforce_noncommercial_payment_order_boundary()
from public, anon, authenticated, service_role;
revoke all on function
  public.grant_tenant_noncommercial_access_server(uuid,uuid,text,text,uuid)
from public, anon, authenticated, service_role;
revoke all on function
  public.revoke_tenant_noncommercial_access_server(uuid,uuid,uuid,text,uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.grant_tenant_noncommercial_access_server(uuid,uuid,text,text,uuid)
to service_role;
grant execute on function
  public.revoke_tenant_noncommercial_access_server(uuid,uuid,uuid,text,uuid)
to service_role;

comment on table coachfort_internal.tenant_noncommercial_access_grants is
  'Durable Platform-controlled production-regression access grants. No payment, provider, renewal, or billing-document authority.';
comment on table coachfort_internal.tenant_noncommercial_access_events is
  'Immutable issuance and revocation evidence for production-regression access.';
comment on function public.grant_tenant_noncommercial_access_server(
  uuid,uuid,text,text,uuid
) is
  'Service-only, Platform Owner/Admin-authorized transition from a canonical system workspace trial to noncommercial Growth access. Do not use before REGRESSION-R3 closes commercial/reporting exclusions.';
comment on function public.revoke_tenant_noncommercial_access_server(
  uuid,uuid,uuid,text,uuid
) is
  'Service-only, Platform Owner/Admin-authorized noncommercial access revocation. Leaves the linked current assignment in place so lifecycle fails closed and keeps regression communication suppression.';

-- Transactional installation guard. This verifies structural installation only;
-- behavioral PRE/APPLY/POST evidence belongs to later reviewed modules.
do $$
begin
  if to_regclass(
       'coachfort_internal.tenant_noncommercial_access_grants'
     ) is null
     or to_regclass(
       'coachfort_internal.tenant_noncommercial_access_events'
     ) is null
     or to_regprocedure(
       'coachfort_internal.tenant_noncommercial_access_authority(uuid,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.grant_tenant_noncommercial_access_server(uuid,uuid,text,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.revoke_tenant_noncommercial_access_server(uuid,uuid,uuid,text,uuid)'
     ) is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'tenant_subscription_assignments'
         and column_name = 'noncommercial_grant_id'
         and is_nullable = 'YES'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_definition
       where trigger_definition.tgrelid =
           'public.tenant_payment_orders'::regclass
         and trigger_definition.tgname =
           'enforce_noncommercial_payment_order_boundary'
         and not trigger_definition.tgisinternal
     ) then
    raise exception 'REGRESSION-R2 transactional installation verification failed.'
      using errcode = '55000';
  end if;
end;
$$;

commit;
