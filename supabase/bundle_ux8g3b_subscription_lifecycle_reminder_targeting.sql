/*
PRE-APPLY READ-ONLY VERIFICATION

with orchestration as (
  select
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
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)'
  )
), contract as (
  select
    count(*) = 1 as exact_existing_identity,
    bool_and(owner_name = 'postgres') as postgres_owned,
    bool_and(security_definer and fixed_search_path) as hardened_function,
    bool_and(
      service_role_execute
      and not anon_execute
      and not authenticated_execute
      and not public_execute
    ) as service_only,
    bool_and(
      source like
        '%subscription_lifecycle_reminder_candidates(now()) candidate%'
      and source like '%where exists (%'
      and source like '%limit p_limit%'
      and source like '%pg_advisory_xact_lock%'
      and source like '%coachfort_internal.enqueue_transactional_email%'
      and source like '%insert into public.notifications%'
      and source like
        '%subscription_lifecycle_reminder_deliveries%'
    ) as ux8g3a_orchestration_intact
  from orchestration
), data_state as (
  select jsonb_build_object(
    'reminder_delivery_rows', (
      select count(*)
      from coachfort_internal.subscription_lifecycle_reminder_deliveries
    ),
    'email_outbox', (
      select count(*)
      from coachfort_internal.transactional_email_outbox
    ),
    'notifications', (select count(*) from public.notifications),
    'subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
    ),
    'current_subscription_assignments', (
      select count(*)
      from public.tenant_subscription_assignments
      where is_current
    ),
    'payment_orders', (select count(*) from public.tenant_payment_orders)
  ) as value
)
select jsonb_build_object(
  'ready_for_apply',
    exact_existing_identity
    and postgres_owned
    and hardened_function
    and service_only
    and ux8g3a_orchestration_intact
    and to_regprocedure(
      'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'
    ) is null,
  'exact_existing_identity', exact_existing_identity,
  'postgres_owned', postgres_owned,
  'hardened_function', hardened_function,
  'service_only', service_only,
  'ux8g3a_orchestration_intact', ux8g3a_orchestration_intact,
  'targeted_identity_absent', to_regprocedure(
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'
  ) is null,
  'data_state', data_state.value
)
from contract
cross join data_state;
*/

begin;

do $$
declare
  v_source text;
  v_oid oid;
begin
  v_oid := to_regprocedure(
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)'
  );
  if v_oid is null then
    raise exception 'UX-8G3A reminder orchestration identity is missing.';
  end if;

  if to_regprocedure(
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'
  ) is not null then
    raise exception 'UX-8G3B targeted reminder identity already exists.';
  end if;

  select lower(regexp_replace(
    pg_get_functiondef(v_oid), '[[:space:]]+', ' ', 'g'
  )) into v_source;

  if pg_get_userbyid((select proowner from pg_proc where oid = v_oid)) <> 'postgres'
    or not (select prosecdef from pg_proc where oid = v_oid)
    or not ((select proconfig from pg_proc where oid = v_oid)
      @> array['search_path=public, pg_temp']::text[])
    or not coalesce(has_function_privilege(
      'service_role', v_oid, 'EXECUTE'
    ), false)
    or coalesce(has_function_privilege('anon', v_oid, 'EXECUTE'), false)
    or coalesce(has_function_privilege(
      'authenticated', v_oid, 'EXECUTE'
    ), false)
    or exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(
        procedure.proacl, acldefault('f', procedure.proowner)
      )) acl
      where procedure.oid = v_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    or v_source not like
      '%subscription_lifecycle_reminder_candidates(now()) candidate%'
    or v_source not like '%where exists (%'
    or v_source not like '%limit p_limit%'
    or v_source not like '%pg_advisory_xact_lock%'
    or v_source not like '%coachfort_internal.enqueue_transactional_email%'
    or v_source not like '%insert into public.notifications%'
  then
    raise exception 'UX-8G3A reminder orchestration contract has drifted.';
  end if;
end;
$$;

drop function public.enqueue_subscription_lifecycle_reminders_server(
  boolean, integer
);

create function public.enqueue_subscription_lifecycle_reminders_server(
  p_dry_run boolean default false,
  p_limit integer default 500,
  p_target_tenant_id uuid default null,
  p_target_event_type text default null
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

  if (p_target_tenant_id is null) <> (p_target_event_type is null) then
    raise exception 'Subscription reminder target is incomplete.'
      using errcode = '22023';
  end if;

  if p_target_event_type is not null and p_target_event_type not in (
    'trial_ending',
    'trial_expired',
    'renewal_due_soon',
    'grace_started',
    'grace_ending',
    'subscription_expired'
  ) then
    raise exception 'Subscription reminder event is invalid.'
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
    where (p_target_tenant_id is null
        or candidate.tenant_id = p_target_tenant_id)
      and (p_target_event_type is null
        or candidate.event_type = p_target_event_type)
      and exists (
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

alter function public.enqueue_subscription_lifecycle_reminders_server(
  boolean, integer, uuid, text
) owner to postgres;

revoke all on function
  public.enqueue_subscription_lifecycle_reminders_server(
    boolean, integer, uuid, text
  )
  from public, anon, authenticated, service_role;

grant execute on function
  public.enqueue_subscription_lifecycle_reminders_server(
    boolean, integer, uuid, text
  )
  to service_role;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with orchestration as (
  select
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
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer,uuid,text)'
  )
), contract as (
  select
    count(*) = 1 as exact_targeted_identity,
    bool_and(owner_name = 'postgres') as postgres_owned,
    bool_and(security_definer and fixed_search_path) as hardened_function,
    bool_and(
      service_role_execute
      and not anon_execute
      and not authenticated_execute
      and not public_execute
    ) as service_only,
    bool_and(
      source like
        '%(p_target_tenant_id is null) <> (p_target_event_type is null)%'
      and source like
        '%p_target_event_type not in ( ''trial_ending'', ''trial_expired'', ''renewal_due_soon'', ''grace_started'', ''grace_ending'', ''subscription_expired'' )%'
      and source like
        '%where (p_target_tenant_id is null or candidate.tenant_id = p_target_tenant_id) and (p_target_event_type is null or candidate.event_type = p_target_event_type) and exists (%'
      and position('candidate.tenant_id = p_target_tenant_id' in source)
        < position('limit p_limit' in source)
      and position('candidate.event_type = p_target_event_type' in source)
        < position('limit p_limit' in source)
      and position('candidate.event_type = p_target_event_type' in source)
        < position('enqueue_transactional_email' in source)
      and position('candidate.event_type = p_target_event_type' in source)
        < position('insert into public.notifications' in source)
    ) as target_before_delivery,
    bool_and(
      source like
        '%subscription_lifecycle_reminder_candidates(now()) candidate%'
      and source like '%delivery.recipient_user_id = member.user_id%'
      and source like
        '%delivery.recipient_email = lower(btrim(auth_user.email))%'
      and source like '%pg_advisory_xact_lock%'
      and source like '%on conflict do nothing%'
      and source like '%subscription_notice%'
      and source not like '%profiles.email%'
      and source not like '%owner_user_id%'
    ) as ux8g3a_safety_preserved
  from orchestration
), data_state as (
  select jsonb_build_object(
    'reminder_delivery_rows', (
      select count(*)
      from coachfort_internal.subscription_lifecycle_reminder_deliveries
    ),
    'email_outbox', (
      select count(*)
      from coachfort_internal.transactional_email_outbox
    ),
    'notifications', (select count(*) from public.notifications),
    'subscription_assignments', (
      select count(*) from public.tenant_subscription_assignments
    ),
    'current_subscription_assignments', (
      select count(*)
      from public.tenant_subscription_assignments
      where is_current
    ),
    'payment_orders', (select count(*) from public.tenant_payment_orders)
  ) as value
)
select jsonb_build_object(
  'security_gate',
    exact_targeted_identity
    and postgres_owned
    and hardened_function
    and service_only
    and target_before_delivery
    and ux8g3a_safety_preserved
    and to_regprocedure(
      'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)'
    ) is null,
  'exact_targeted_identity', exact_targeted_identity,
  'legacy_identity_absent', to_regprocedure(
    'public.enqueue_subscription_lifecycle_reminders_server(boolean,integer)'
  ) is null,
  'postgres_owned', postgres_owned,
  'hardened_function', hardened_function,
  'service_only', service_only,
  'target_before_delivery', target_before_delivery,
  'ux8g3a_safety_preserved', ux8g3a_safety_preserved,
  'data_state', data_state.value
)
from contract
cross join data_state;
*/
