-- Module 42.3: Secure trigger validation for automation RPC
-- Run after supabase/module42_2_secure_automation_execution.sql.

-- Keep the Module 42.2 SECURITY DEFINER execution implementation, but move it
-- behind a revoked internal function. The public RPC becomes a validating
-- wrapper that rejects fake entity IDs before any automation definitions are
-- read or side effects are created.

do $$
begin
  if to_regprocedure('public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)') is null
     and to_regprocedure('public.run_automation_trigger(uuid,text,text,uuid,jsonb)') is not null then
    alter function public.run_automation_trigger(uuid, text, text, uuid, jsonb)
    rename to run_automation_trigger_unvalidated;
  end if;
end;
$$;

revoke execute on function public.run_automation_trigger_unvalidated(uuid, text, text, uuid, jsonb) from public;
revoke execute on function public.run_automation_trigger_unvalidated(uuid, text, text, uuid, jsonb) from authenticated;

create or replace function public.is_valid_automation_trigger(
  tenant_id uuid,
  trigger_type text,
  entity_type text,
  entity_id uuid,
  metadata_json jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id alias for $1;
  v_trigger_type alias for $2;
  v_entity_type alias for $3;
  v_entity_id alias for $4;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return false;
  end if;

  if not public.is_tenant_member(v_tenant_id, v_actor) then
    return false;
  end if;

  if v_trigger_type = 'student_created' then
    return v_entity_type = 'student'
      and v_entity_id is not null
      and exists (
        select 1
        from public.students s
        where s.tenant_id = v_tenant_id
          and s.id = v_entity_id
      );
  end if;

  if v_trigger_type = 'payment_received' then
    return v_entity_type = 'payment'
      and v_entity_id is not null
      and exists (
        select 1
        from public.payments p
        where p.tenant_id = v_tenant_id
          and p.id = v_entity_id
          and lower(coalesce(p.status, '')) in ('completed', 'paid', 'success')
      );
  end if;

  if v_trigger_type = 'session_scheduled' then
    return v_entity_type = 'session'
      and v_entity_id is not null
      and exists (
        select 1
        from public.sessions s
        where s.tenant_id = v_tenant_id
          and s.id = v_entity_id
      );
  end if;

  if v_trigger_type = 'certificate_issued' then
    -- Certificates are currently generated from completed enrollments. The app
    -- passes entity_type='certificate' and entity_id=enrollment.id.
    return v_entity_type = 'certificate'
      and v_entity_id is not null
      and exists (
        select 1
        from public.enrollments e
        where e.tenant_id = v_tenant_id
          and e.id = v_entity_id
          and e.status = 'completed'
          and e.completed_at is not null
      );
  end if;

  if v_trigger_type = 'assignment_overdue' then
    return v_entity_type = 'assignment'
      and v_entity_id is not null
      and exists (
        select 1
        from public.assignments a
        where a.tenant_id = v_tenant_id
          and a.id = v_entity_id
          and a.due_at is not null
          and a.due_at < now()
          and coalesce(a.status, '') <> 'closed'
      );
  end if;

  if v_trigger_type = 'attendance_low' then
    return v_entity_type = 'student'
      and v_entity_id is not null
      and exists (
        select 1
        from public.students s
        where s.tenant_id = v_tenant_id
          and s.id = v_entity_id
      )
      and exists (
        select 1
        from public.attendance_records ar
        where ar.tenant_id = v_tenant_id
          and ar.student_id = v_entity_id
      );
  end if;

  if v_trigger_type = 'trial_expiring' then
    return v_entity_type = 'tenant'
      and v_entity_id = v_tenant_id
      and exists (
        select 1
        from public.tenants t
        where t.id = v_tenant_id
          and coalesce(t.is_trial_active, false) = true
          and t.trial_ends_at is not null
          and t.trial_ends_at >= now()
          and t.trial_ends_at <= now() + interval '7 days'
      );
  end if;

  return false;
exception
  when undefined_table or undefined_column then
    return false;
  when others then
    return false;
end;
$$;

revoke execute on function public.is_valid_automation_trigger(uuid, text, text, uuid, jsonb) from public;
revoke execute on function public.is_valid_automation_trigger(uuid, text, text, uuid, jsonb) from authenticated;

create or replace function public.run_automation_trigger(
  tenant_id uuid,
  trigger_type text,
  entity_type text,
  entity_id uuid default null,
  metadata_json jsonb default '{}'::jsonb
)
returns table (
  executed_count integer,
  skipped_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id alias for $1;
  v_trigger_type alias for $2;
  v_entity_type alias for $3;
  v_entity_id alias for $4;
  v_metadata_json alias for $5;
begin
  executed_count := 0;
  skipped_count := 0;
  failed_count := 0;

  if not public.is_valid_automation_trigger(
    v_tenant_id,
    v_trigger_type,
    v_entity_type,
    v_entity_id,
    coalesce(v_metadata_json, '{}'::jsonb)
  ) then
    return next;
    return;
  end if;

  return query
  select *
  from public.run_automation_trigger_unvalidated(
    v_tenant_id,
    v_trigger_type,
    v_entity_type,
    v_entity_id,
    coalesce(v_metadata_json, '{}'::jsonb)
  );
exception
  when others then
    executed_count := 0;
    skipped_count := 0;
    failed_count := 0;
    return next;
end;
$$;

revoke execute on function public.run_automation_trigger(uuid, text, text, uuid, jsonb) from public;
grant execute on function public.run_automation_trigger(uuid, text, text, uuid, jsonb) to authenticated;
