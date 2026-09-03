-- Bundle UX-8G3B1: Production fixture automated-communication hygiene.
-- Review before execution. This bundle does not activate scheduling.

/*
PRE-APPLY READ-ONLY VERIFICATION

with expected_relations(identity) as (
  values
    ('public.tenants'),
    ('public.tenant_members'),
    ('public.tenant_subscription_assignments'),
    ('public.tenant_payment_orders'),
    ('public.notifications'),
    ('coachfort_internal.transactional_email_outbox'),
    ('coachfort_internal.subscription_lifecycle_reminder_deliveries')
), relation_state as (
  select identity, to_regclass(identity) is not null as installed
  from expected_relations
), expected_functions(identity) as (
  values
    ('coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'),
    ('coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'),
    ('coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'),
    ('public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)'),
    ('public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)')
), function_state as (
  select identity, to_regprocedure(identity) is not null as installed
  from expected_functions
), runtime_functions as (
  select
    expected.identity,
    procedure.oid,
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
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) as source
  from expected_functions expected
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), existing_contract as (
  select
    count(*) filter (where identity =
      'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
      and owner_name = 'postgres'
      and security_definer
      and fixed_search_path
      and not anon_execute
      and not authenticated_execute
      and not service_role_execute
      and not public_execute
    ) = 1 as lifecycle_contract,
    count(*) filter (where identity =
      'coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'
      and owner_name = 'postgres'
      and security_definer
      and fixed_search_path
      and not anon_execute
      and not authenticated_execute
      and not service_role_execute
      and not public_execute
      and source like
        '%tenant_subscription_effective_lifecycle(tenant.id)%'
      and source like '%assignment.is_current%'
      and source like '%''trial_ending''::text%'
      and source like '%''trial_expired''%'
      and source like '%''renewal_due_soon''%'
      and source like '%''grace_started''%'
      and source like '%''grace_ending''%'
      and source like '%''subscription_expired''%'
      and source not like
        '%tenant_allows_automated_customer_communications%'
    ) = 1 as candidate_contract,
    count(*) filter (where identity =
      'coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'
      and owner_name = 'postgres'
      and security_definer
      and fixed_search_path
      and not anon_execute
      and not authenticated_execute
      and not service_role_execute
      and not public_execute
      and source like '%assignment.is_current%'
      and source like '%join auth.users auth_user%'
      and source like
        '%lower(btrim(auth_user.email)) = v_delivery.recipient_email%'
      and source like '%tenant_subscription_effective_lifecycle%'
      and source like '%v_delivery.tenant_id%'
      and source not like
        '%tenant_allows_automated_customer_communications%'
    ) = 1 as delivery_contract,
    count(*) filter (where identity =
      'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'
      and owner_name = 'postgres'
      and security_definer
      and fixed_search_path
      and not anon_execute
      and not authenticated_execute
      and service_role_execute
      and not public_execute
      and source like
        '%(p_target_tenant_id is null) <> (p_target_event_type is null)%'
      and source like
        '%subscription_lifecycle_reminder_candidates(now()) candidate%'
      and source like '%candidate.tenant_id = p_target_tenant_id%'
      and source like '%candidate.event_type = p_target_event_type%'
      and source like '%pg_advisory_xact_lock%'
      and source like '%limit p_limit%'
      and source like '%coachfort_internal.enqueue_transactional_email%'
      and source like '%insert into public.notifications%'
      and position('candidate.tenant_id = p_target_tenant_id' in source)
        < position('limit p_limit' in source)
      and position('candidate.event_type = p_target_event_type' in source)
        < position('limit p_limit' in source)
    ) = 1 as targeted_orchestration_contract,
    count(*) filter (where identity =
      'public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)'
      and owner_name = 'postgres'
      and security_definer
      and fixed_search_path
      and not anon_execute
      and not authenticated_execute
      and service_role_execute
      and not public_execute
      and source like
        '%subscription_lifecycle_reminder_delivery_is_current( p_outbox_id )%'
    ) = 1 as delivery_wrapper_contract
  from runtime_functions
), fixture_identity as (
  select
    count(*) filter (
      where tenant.id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
        and tenant.slug = 'coachfort-regression'
        and tenant.name = 'CoachFort Regression Coaching'
    ) as exact_match_count,
    count(*) filter (
      where (
        tenant.id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
        or tenant.slug = 'coachfort-regression'
      )
      and not (
        tenant.id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
        and tenant.slug = 'coachfort-regression'
        and tenant.name = 'CoachFort Regression Coaching'
      )
    ) as conflicting_identity_count
  from public.tenants tenant
), conflicts as (
  select
    to_regclass(
      'coachfort_internal.tenant_fixture_classifications'
    ) is not null as classification_table_exists,
    to_regprocedure(
      'coachfort_internal.tenant_fixture_classification_updated_at()'
    ) is not null as timestamp_helper_exists,
    to_regprocedure(
      'coachfort_internal.tenant_allows_automated_customer_communications(uuid)'
    ) is not null as communication_helper_exists,
    to_regprocedure(
      'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)'
    ) is not null as obsolete_orchestration_exists
), baseline_counts as (
  select jsonb_build_object(
    'reminder_delivery_rows', (
      select count(*)
      from coachfort_internal.subscription_lifecycle_reminder_deliveries
    ),
    'notifications', (select count(*) from public.notifications),
    'email_outbox', (
      select count(*)
      from coachfort_internal.transactional_email_outbox
    ),
    'subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
    ),
    'current_subscription_assignments', (
      select count(*)
      from public.tenant_subscription_assignments
      where is_current
    ),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'fixture_classification_rows', 0
  ) as value
), readiness as (
  select
    not exists (select 1 from relation_state where not installed)
    and not exists (select 1 from function_state where not installed)
    and (select lifecycle_contract
      and candidate_contract
      and delivery_contract
      and targeted_orchestration_contract
      and delivery_wrapper_contract from existing_contract)
    and (select exact_match_count = 1
      and conflicting_identity_count = 0 from fixture_identity)
    and (select not classification_table_exists
      and not timestamp_helper_exists
      and not communication_helper_exists
      and not obsolete_orchestration_exists from conflicts)
      as ready_for_apply
)
select jsonb_pretty(jsonb_build_object(
  'ready_for_apply', (select ready_for_apply from readiness),
  'relations', (
    select jsonb_agg(to_jsonb(relation_state) order by identity)
    from relation_state
  ),
  'functions', (
    select jsonb_agg(to_jsonb(function_state) order by identity)
    from function_state
  ),
  'existing_contract', (select to_jsonb(existing_contract) from existing_contract),
  'fixture_identity', (select to_jsonb(fixture_identity) from fixture_identity),
  'conflicts', (select to_jsonb(conflicts) from conflicts),
  'baseline_counts', (select value from baseline_counts)
));
*/

begin;

do $$
declare
  v_candidate_source text;
  v_conflicting_identity_count integer;
  v_delivery_source text;
  v_exact_identity_count integer;
  v_orchestration_oid oid;
  v_orchestration_source text;
begin
  if to_regclass('public.tenants') is null
     or to_regclass('public.tenant_members') is null
     or to_regclass('public.tenant_subscription_assignments') is null
     or to_regclass('public.tenant_payment_orders') is null
     or to_regclass('public.notifications') is null
     or to_regclass(
       'coachfort_internal.transactional_email_outbox'
     ) is null
     or to_regclass(
       'coachfort_internal.subscription_lifecycle_reminder_deliveries'
     ) is null
     or to_regprocedure(
       'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'
     ) is null
     or to_regprocedure(
       'coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'
     ) is null
     or to_regprocedure(
       'public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)'
     ) is null
  then
    raise exception 'UX-8G3B1 prerequisites are missing.';
  end if;

  if to_regclass(
       'coachfort_internal.tenant_fixture_classifications'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.tenant_fixture_classification_updated_at()'
     ) is not null
     or to_regprocedure(
       'coachfort_internal.tenant_allows_automated_customer_communications(uuid)'
     ) is not null
  then
    raise exception 'UX-8G3B1 fixture authority is partially installed.';
  end if;

  v_orchestration_oid := to_regprocedure(
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'
  );
  if v_orchestration_oid is null
     or to_regprocedure(
       'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)'
     ) is not null
  then
    raise exception 'UX-8G3B targeted reminder identity has drifted.';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    where procedure.oid in (
      to_regprocedure(
        'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
      ),
      to_regprocedure(
        'coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'
      ),
      to_regprocedure(
        'coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'
      )
    )
      and (
        pg_get_userbyid(procedure.proowner) <> 'postgres'
        or not procedure.prosecdef
        or not (
          procedure.proconfig @> array[
            'search_path=public, pg_temp'
          ]::text[]
        )
      )
  ) or exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) acl
    where procedure.oid in (
      to_regprocedure(
        'coachfort_internal.tenant_subscription_effective_lifecycle(uuid)'
      ),
      to_regprocedure(
        'coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'
      ),
      to_regprocedure(
        'coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'
      )
    )
      and acl.privilege_type = 'EXECUTE'
      and (
        acl.grantee = 0
        or acl.grantee in (
          select role.oid from pg_roles role
          where role.rolname in ('anon', 'authenticated', 'service_role')
        )
      )
  ) then
    raise exception 'UX-8G3A private lifecycle authority has drifted.';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef(v_orchestration_oid), '[[:space:]]+', ' ', 'g'
  )) into v_orchestration_source;
  if pg_get_userbyid((select proowner from pg_proc
       where oid = v_orchestration_oid)) <> 'postgres'
     or not (select prosecdef from pg_proc where oid = v_orchestration_oid)
     or not ((select proconfig from pg_proc where oid = v_orchestration_oid)
       @> array['search_path=public, pg_temp']::text[])
     or not coalesce(has_function_privilege(
       'service_role', v_orchestration_oid, 'EXECUTE'
     ), false)
     or coalesce(has_function_privilege(
       'anon', v_orchestration_oid, 'EXECUTE'
     ), false)
     or coalesce(has_function_privilege(
       'authenticated', v_orchestration_oid, 'EXECUTE'
     ), false)
     or exists (
       select 1
       from pg_proc procedure
       cross join lateral aclexplode(coalesce(
         procedure.proacl, acldefault('f', procedure.proowner)
       )) acl
       where procedure.oid = v_orchestration_oid
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     )
     or v_orchestration_source not like
       '%(p_target_tenant_id is null) <> (p_target_event_type is null)%'
     or v_orchestration_source not like
       '%subscription_lifecycle_reminder_candidates(now()) candidate%'
     or v_orchestration_source not like
       '%candidate.tenant_id = p_target_tenant_id%'
     or v_orchestration_source not like
       '%candidate.event_type = p_target_event_type%'
     or v_orchestration_source not like '%pg_advisory_xact_lock%'
     or v_orchestration_source not like '%limit p_limit%'
     or v_orchestration_source not like
       '%coachfort_internal.enqueue_transactional_email%'
     or v_orchestration_source not like '%insert into public.notifications%'
  then
    raise exception 'UX-8G3B targeted reminder contract has drifted.';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_candidate_source;
  select lower(regexp_replace(
    pg_get_functiondef(to_regprocedure(
      'coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'
    )), '[[:space:]]+', ' ', 'g'
  )) into v_delivery_source;

  if v_candidate_source not like
       '%tenant_subscription_effective_lifecycle(tenant.id)%'
     or v_candidate_source not like '%assignment.is_current%'
     or v_candidate_source not like '%''trial_ending''::text%'
     or v_candidate_source not like '%''trial_expired''%'
     or v_candidate_source not like '%''renewal_due_soon''%'
     or v_candidate_source not like '%''grace_started''%'
     or v_candidate_source not like '%''grace_ending''%'
     or v_candidate_source not like '%''subscription_expired''%'
     or v_candidate_source like
       '%tenant_allows_automated_customer_communications%'
     or v_delivery_source not like '%assignment.is_current%'
     or v_delivery_source not like '%join auth.users auth_user%'
     or v_delivery_source not like
       '%lower(btrim(auth_user.email)) = v_delivery.recipient_email%'
     or v_delivery_source not like '%tenant_subscription_effective_lifecycle%'
     or v_delivery_source not like '%v_delivery.tenant_id%'
     or v_delivery_source like
       '%tenant_allows_automated_customer_communications%'
  then
    raise exception 'UX-8G3A reminder authority has drifted.';
  end if;

  select count(*) into v_exact_identity_count
  from public.tenants tenant
  where tenant.id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
    and tenant.slug = 'coachfort-regression'
    and tenant.name = 'CoachFort Regression Coaching';

  select count(*) into v_conflicting_identity_count
  from public.tenants tenant
  where (
      tenant.id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
      or tenant.slug = 'coachfort-regression'
    )
    and not (
      tenant.id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
      and tenant.slug = 'coachfort-regression'
      and tenant.name = 'CoachFort Regression Coaching'
    );

  if v_exact_identity_count <> 1 or v_conflicting_identity_count <> 0 then
    raise exception 'Regression fixture identity does not match the approved tenant.';
  end if;

  perform set_config(
    'coachfort.ux8g3b1.reminder_delivery_rows_before',
    (select count(*)::text
      from coachfort_internal.subscription_lifecycle_reminder_deliveries),
    true
  );
  perform set_config(
    'coachfort.ux8g3b1.notifications_before',
    (select count(*)::text from public.notifications),
    true
  );
  perform set_config(
    'coachfort.ux8g3b1.email_outbox_before',
    (select count(*)::text
      from coachfort_internal.transactional_email_outbox),
    true
  );
  perform set_config(
    'coachfort.ux8g3b1.subscription_assignments_before',
    (select count(*)::text from public.tenant_subscription_assignments),
    true
  );
  perform set_config(
    'coachfort.ux8g3b1.current_assignments_before',
    (select count(*)::text
      from public.tenant_subscription_assignments where is_current),
    true
  );
  perform set_config(
    'coachfort.ux8g3b1.payment_orders_before',
    (select count(*)::text from public.tenant_payment_orders),
    true
  );
end;
$$;

create table coachfort_internal.tenant_fixture_classifications (
  tenant_id uuid primary key,
  fixture_type text not null,
  automated_customer_communications_enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_fixture_classifications_tenant_fk
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  constraint tenant_fixture_classifications_type_check
    check (fixture_type in ('regression', 'smoke')),
  constraint tenant_fixture_classifications_timestamp_check
    check (updated_at >= created_at)
);

create function coachfort_internal.tenant_fixture_classification_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenant_fixture_classification_updated_at
before update on coachfort_internal.tenant_fixture_classifications
for each row execute function
  coachfort_internal.tenant_fixture_classification_updated_at();

create function coachfort_internal.tenant_allows_automated_customer_communications(
  p_tenant_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
begin
  if p_tenant_id is null or not exists (
    select 1 from public.tenants tenant where tenant.id = p_tenant_id
  ) then
    return false;
  end if;

  select classification.automated_customer_communications_enabled
    into v_allowed
  from coachfort_internal.tenant_fixture_classifications classification
  where classification.tenant_id = p_tenant_id;

  if not found then
    return true;
  end if;

  return v_allowed;
end;
$$;

alter table coachfort_internal.tenant_fixture_classifications
  owner to postgres;
alter function
  coachfort_internal.tenant_fixture_classification_updated_at()
  owner to postgres;
alter function
  coachfort_internal.tenant_allows_automated_customer_communications(uuid)
  owner to postgres;

alter table coachfort_internal.tenant_fixture_classifications
  enable row level security;
revoke all on table coachfort_internal.tenant_fixture_classifications
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.tenant_fixture_classification_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.tenant_allows_automated_customer_communications(uuid)
  from public, anon, authenticated, service_role;

do $$
declare
  v_rows integer;
begin
  insert into coachfort_internal.tenant_fixture_classifications (
    tenant_id,
    fixture_type,
    automated_customer_communications_enabled
  )
  select tenant.id, 'regression', false
  from public.tenants tenant
  where tenant.id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
    and tenant.slug = 'coachfort-regression'
    and tenant.name = 'CoachFort Regression Coaching';

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Regression fixture classification did not affect exactly one tenant.';
  end if;
end;
$$;

create or replace function coachfort_internal.subscription_lifecycle_reminder_candidates(
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
    where coachfort_internal.tenant_allows_automated_customer_communications(
      tenant.id
    )
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

create or replace function coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(
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

  if not found then
    return false;
  end if;

  if not coachfort_internal.tenant_allows_automated_customer_communications(
    v_delivery.tenant_id
  ) then
    return false;
  end if;

  if not exists (
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

alter function
  coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)
  owner to postgres;
alter function
  coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)
  owner to postgres;
revoke all on function
  coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function
  coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)
  from public, anon, authenticated, service_role;

do $$
begin
  if (select count(*)
      from coachfort_internal.subscription_lifecycle_reminder_deliveries)
       <> current_setting(
         'coachfort.ux8g3b1.reminder_delivery_rows_before'
       )::bigint
     or (select count(*) from public.notifications)
       <> current_setting('coachfort.ux8g3b1.notifications_before')::bigint
     or (select count(*)
         from coachfort_internal.transactional_email_outbox)
       <> current_setting('coachfort.ux8g3b1.email_outbox_before')::bigint
     or (select count(*) from public.tenant_subscription_assignments)
       <> current_setting(
         'coachfort.ux8g3b1.subscription_assignments_before'
       )::bigint
     or (select count(*)
         from public.tenant_subscription_assignments where is_current)
       <> current_setting(
         'coachfort.ux8g3b1.current_assignments_before'
       )::bigint
     or (select count(*) from public.tenant_payment_orders)
       <> current_setting('coachfort.ux8g3b1.payment_orders_before')::bigint
  then
    raise exception 'UX-8G3B1 changed protected business or delivery row counts.';
  end if;
end;
$$;

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with expected_columns(column_name, data_type, is_nullable) as (
  values
    ('tenant_id', 'uuid', 'NO'),
    ('fixture_type', 'text', 'NO'),
    ('automated_customer_communications_enabled', 'boolean', 'NO'),
    ('created_at', 'timestamp with time zone', 'NO'),
    ('updated_at', 'timestamp with time zone', 'NO')
), actual_columns as (
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'coachfort_internal'
    and table_name = 'tenant_fixture_classifications'
), column_state as (
  select
    not exists (
      select 1 from expected_columns expected
      where not exists (
        select 1 from actual_columns actual
        where actual.column_name = expected.column_name
          and actual.data_type = expected.data_type
          and actual.is_nullable = expected.is_nullable
      )
    ) as expected_columns_present,
    (select count(*) from actual_columns) = 5 as exact_column_count
), table_state as (
  select
    pg_get_userbyid(class.relowner) = 'postgres' as postgres_owned,
    class.relrowsecurity as rls_enabled,
    not class.relforcerowsecurity as force_rls_disabled,
    not exists (
      select 1
      from aclexplode(coalesce(
        class.relacl, acldefault('r', class.relowner)
      )) acl
      where acl.grantee = 0
         or acl.grantee in (
           select role.oid from pg_roles role
           where role.rolname in ('anon', 'authenticated', 'service_role')
         )
    ) as browser_and_service_access_absent,
    not exists (
      select 1 from pg_policy policy where policy.polrelid = class.oid
    ) as policies_absent
  from pg_class class
  where class.oid = to_regclass(
    'coachfort_internal.tenant_fixture_classifications'
  )
), constraint_state as (
  select
    count(*) filter (
      where constraint_state.conname =
        'tenant_fixture_classifications_pkey'
        and constraint_state.contype = 'p'
    ) = 1 as tenant_primary_key,
    count(*) filter (
      where constraint_state.conname =
        'tenant_fixture_classifications_tenant_fk'
        and constraint_state.contype = 'f'
        and constraint_state.confrelid = to_regclass('public.tenants')
        and constraint_state.confdeltype = 'r'
    ) = 1 as tenant_foreign_key,
    count(*) filter (
      where constraint_state.conname =
        'tenant_fixture_classifications_type_check'
        and pg_get_constraintdef(constraint_state.oid) like '%regression%'
        and pg_get_constraintdef(constraint_state.oid) like '%smoke%'
    ) = 1 as fixture_type_check,
    count(*) filter (
      where constraint_state.conname =
        'tenant_fixture_classifications_timestamp_check'
    ) = 1 as timestamp_check
  from pg_constraint constraint_state
  where constraint_state.conrelid = to_regclass(
    'coachfort_internal.tenant_fixture_classifications'
  )
), trigger_state as (
  select count(*) = 1 as exact_timestamp_trigger
  from pg_trigger trigger_state
  where trigger_state.tgrelid = to_regclass(
      'coachfort_internal.tenant_fixture_classifications'
    )
    and not trigger_state.tgisinternal
    and trigger_state.tgname = 'tenant_fixture_classification_updated_at'
    and trigger_state.tgfoid = to_regprocedure(
      'coachfort_internal.tenant_fixture_classification_updated_at()'
    )
), function_contract as (
  select
    expected.identity,
    procedure.oid,
    pg_get_userbyid(procedure.proowner) as owner_name,
    procedure.prosecdef as security_definer,
    procedure.provolatile,
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
      select 1
      from aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    lower(regexp_replace(
      pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'
    )) as source
  from (values
    ('coachfort_internal.tenant_fixture_classification_updated_at()'),
    ('coachfort_internal.tenant_allows_automated_customer_communications(uuid)'),
    ('coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'),
    ('coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'),
    ('public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'),
    ('public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)')
  ) expected(identity)
  left join pg_proc procedure
    on procedure.oid = to_regprocedure(expected.identity)
), helper_state as (
  select
    count(*) = 1 as exact_helper_identity,
    bool_and(owner_name = 'postgres') as postgres_owned,
    bool_and(security_definer and provolatile = 's') as stable_security_definer,
    bool_and(fixed_search_path) as fixed_search_path,
    bool_and(
      not anon_execute
      and not authenticated_execute
      and not service_role_execute
      and not public_execute
    ) as execute_private,
    bool_and(
      source like '%if p_tenant_id is null or not exists (%'
      and source like '%return false%'
      and source like
        '%from coachfort_internal.tenant_fixture_classifications classification%'
      and source like '%if not found then return true%'
      and source like '%return v_allowed%'
    ) as expected_behavior
  from function_contract
  where identity =
    'coachfort_internal.tenant_allows_automated_customer_communications(uuid)'
), timestamp_helper_state as (
  select
    count(*) = 1 as exact_timestamp_helper,
    bool_and(owner_name = 'postgres') as postgres_owned,
    bool_and(not security_definer and fixed_search_path) as hardened_invoker,
    bool_and(
      not anon_execute
      and not authenticated_execute
      and not service_role_execute
      and not public_execute
    ) as execute_private,
    bool_and(source like '%new.updated_at := now()%') as expected_behavior
  from function_contract
  where identity =
    'coachfort_internal.tenant_fixture_classification_updated_at()'
), reminder_state as (
  select
    count(*) filter (
      where identity =
        'coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)'
        and owner_name = 'postgres'
        and security_definer
        and fixed_search_path
        and not anon_execute
        and not authenticated_execute
        and not service_role_execute
        and not public_execute
        and source like
          '%where coachfort_internal.tenant_allows_automated_customer_communications( tenant.id )%'
        and position(
          'tenant_allows_automated_customer_communications' in source
        ) < position('), candidates as (' in source)
        and source like
          '%tenant_subscription_effective_lifecycle(tenant.id)%'
        and source like '%assignment.is_current%'
        and source like '%''trial_ending''::text%'
        and source like '%''trial_expired''%'
        and source like '%''renewal_due_soon''%'
        and source like '%''grace_started''%'
        and source like '%''grace_ending''%'
        and source like '%''subscription_expired''%'
    ) = 1 as candidate_policy_before_event_discovery,
    count(*) filter (
      where identity =
        'coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)'
        and owner_name = 'postgres'
        and security_definer
        and fixed_search_path
        and not anon_execute
        and not authenticated_execute
        and not service_role_execute
        and not public_execute
        and source like
          '%if not coachfort_internal.tenant_allows_automated_customer_communications( v_delivery.tenant_id ) then return false%'
        and position(
          'tenant_allows_automated_customer_communications' in source
        ) < position('tenant_subscription_effective_lifecycle' in source)
        and source like '%assignment.is_current%'
        and source like '%join auth.users auth_user%'
        and source like
          '%lower(btrim(auth_user.email)) = v_delivery.recipient_email%'
    ) = 1 as delivery_policy_rechecked,
    count(*) filter (
      where identity =
        'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'
        and owner_name = 'postgres'
        and security_definer
        and fixed_search_path
        and not anon_execute
        and not authenticated_execute
        and service_role_execute
        and not public_execute
        and source like
          '%subscription_lifecycle_reminder_candidates(now()) candidate%'
        and source like '%candidate.tenant_id = p_target_tenant_id%'
        and source like '%candidate.event_type = p_target_event_type%'
        and source like '%pg_advisory_xact_lock%'
        and source like '%limit p_limit%'
        and source like '%coachfort_internal.enqueue_transactional_email%'
        and source like '%insert into public.notifications%'
    ) = 1 as targeted_orchestration_preserved,
    count(*) filter (
      where identity =
        'public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)'
        and owner_name = 'postgres'
        and security_definer
        and fixed_search_path
        and not anon_execute
        and not authenticated_execute
        and service_role_execute
        and not public_execute
        and source like
          '%subscription_lifecycle_reminder_delivery_is_current( p_outbox_id )%'
    ) = 1 as delivery_wrapper_preserved
  from function_contract
), runtime_literal_state as (
  select
    bool_and(source not like
      '%29a33701-82ed-4c7f-8042-0a1af8296ce5%')
      and bool_and(source not like '%coachfort-regression%')
      and bool_and(source not like '%regression coaching%')
      and bool_and(source not like '%.demo%')
      as runtime_fixture_literals_absent
  from function_contract
  where identity in (
    'coachfort_internal.tenant_allows_automated_customer_communications(uuid)',
    'coachfort_internal.subscription_lifecycle_reminder_candidates(timestamptz)',
    'coachfort_internal.subscription_lifecycle_reminder_delivery_is_current(uuid)',
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)',
    'public.subscription_lifecycle_reminder_delivery_is_current_server(uuid)'
  )
), classification_state as (
  select
    count(*) filter (
      where classification.tenant_id =
          '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
        and tenant.slug = 'coachfort-regression'
        and tenant.name = 'CoachFort Regression Coaching'
        and classification.fixture_type = 'regression'
        and not classification.automated_customer_communications_enabled
    ) = 1 as regression_fixture_blocked,
    not coachfort_internal.tenant_allows_automated_customer_communications(
      '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
    ) as regression_helper_blocked,
    not exists (
      select 1
      from coachfort_internal.tenant_fixture_classifications classification
      where classification.tenant_id =
        'd417104c-2009-4334-98de-e6d09c26aae3'::uuid
    ) as workspace_email_smoke_not_classified,
    coachfort_internal.tenant_allows_automated_customer_communications(
      'd417104c-2009-4334-98de-e6d09c26aae3'::uuid
    ) as workspace_email_smoke_allowed,
    count(*) as fixture_classification_rows
  from coachfort_internal.tenant_fixture_classifications classification
  join public.tenants tenant on tenant.id = classification.tenant_id
), data_state as (
  select jsonb_build_object(
    'reminder_delivery_rows', (
      select count(*)
      from coachfort_internal.subscription_lifecycle_reminder_deliveries
    ),
    'notifications', (select count(*) from public.notifications),
    'email_outbox', (
      select count(*)
      from coachfort_internal.transactional_email_outbox
    ),
    'subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
    ),
    'current_subscription_assignments', (
      select count(*)
      from public.tenant_subscription_assignments
      where is_current
    ),
    'payment_orders', (select count(*) from public.tenant_payment_orders),
    'fixture_classification_rows', (
      select count(*)
      from coachfort_internal.tenant_fixture_classifications
    )
  ) as value
), gate as (
  select
    (select expected_columns_present and exact_column_count from column_state)
    and (select postgres_owned and rls_enabled and force_rls_disabled
      and browser_and_service_access_absent and policies_absent from table_state)
    and (select tenant_primary_key and tenant_foreign_key
      and fixture_type_check and timestamp_check from constraint_state)
    and (select exact_timestamp_trigger from trigger_state)
    and (select exact_helper_identity and postgres_owned
      and stable_security_definer and fixed_search_path
      and execute_private and expected_behavior from helper_state)
    and (select exact_timestamp_helper and postgres_owned
      and hardened_invoker and execute_private
      and expected_behavior from timestamp_helper_state)
    and (select candidate_policy_before_event_discovery
      and delivery_policy_rechecked
      and targeted_orchestration_preserved
      and delivery_wrapper_preserved from reminder_state)
    and (select runtime_fixture_literals_absent from runtime_literal_state)
    and (select regression_fixture_blocked
      and regression_helper_blocked
      and workspace_email_smoke_not_classified
      and workspace_email_smoke_allowed from classification_state)
      as security_gate
)
select jsonb_pretty(jsonb_build_object(
  'security_gate', (select security_gate from gate),
  'columns', (select to_jsonb(column_state) from column_state),
  'table_security', (select to_jsonb(table_state) from table_state),
  'constraints', (select to_jsonb(constraint_state) from constraint_state),
  'trigger', (select to_jsonb(trigger_state) from trigger_state),
  'helper', (select to_jsonb(helper_state) from helper_state),
  'timestamp_helper', (
    select to_jsonb(timestamp_helper_state) from timestamp_helper_state
  ),
  'reminder_contract', (select to_jsonb(reminder_state) from reminder_state),
  'runtime_literals', (
    select to_jsonb(runtime_literal_state) from runtime_literal_state
  ),
  'classification', (
    select to_jsonb(classification_state) from classification_state
  ),
  'data_state', (select value from data_state)
));
*/
