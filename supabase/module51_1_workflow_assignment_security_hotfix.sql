-- Module 51.1: Workflow assignment authorization hotfix
-- Purpose: ensure workflow_step_is_assigned always returns strict true/false
-- and update_workflow_run_step treats assignment checks as false when null.

create or replace function public.workflow_step_is_assigned(
  check_tenant_id uuid,
  check_assigned_to uuid,
  check_assigned_role text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_member_role text := public.workflow_current_role(check_tenant_id);
begin
  return coalesce(
    auth.uid() is not null
    and current_member_role is not null
    and (
      (
        check_assigned_to is not null
        and check_assigned_to = auth.uid()
      )
      or (
        check_assigned_to is null
        and check_assigned_role is not null
        and check_assigned_role = current_member_role
      )
    ),
    false
  );
end;
$$;

revoke execute on function public.workflow_step_is_assigned(uuid, uuid, text) from public;
grant execute on function public.workflow_step_is_assigned(uuid, uuid, text) to authenticated;

create or replace function public.update_workflow_run_step(
  p_step_id uuid,
  p_status text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  step_row public.workflow_run_steps%rowtype;
  run_row public.workflow_runs%rowtype;
  new_notes text;
  all_done boolean;
begin
  select * into step_row
  from public.workflow_run_steps
  where id = p_step_id;

  if not found then
    raise exception 'Workflow step not found.' using errcode = 'P0002';
  end if;

  select * into run_row
  from public.workflow_runs
  where id = step_row.run_id;

  if run_row.status in ('completed', 'cancelled') then
    raise exception 'Workflow run is already completed or cancelled.' using errcode = '42501';
  end if;

  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not (
    public.has_tenant_role(step_row.tenant_id, actor_id, array['owner', 'admin'])
    or coalesce(public.workflow_step_is_assigned(step_row.tenant_id, step_row.assigned_to, step_row.assigned_role), false)
  ) then
    raise exception 'Workflow step is not assigned to this user.' using errcode = '42501';
  end if;

  if p_status not in ('pending', 'in_progress', 'completed', 'skipped', 'blocked') then
    raise exception 'Invalid workflow step status.' using errcode = '22023';
  end if;

  new_notes := public.validate_workflow_text(p_notes, 'Workflow step notes', false, 2000);

  update public.workflow_run_steps
  set
    status = p_status,
    notes = new_notes,
    completed_by = case when p_status in ('completed', 'skipped') then actor_id else null end,
    completed_at = case when p_status in ('completed', 'skipped') then now() else null end
  where id = p_step_id;

  perform public.insert_workflow_activity(
    step_row.tenant_id,
    step_row.run_id,
    p_step_id,
    'workflow_step_updated',
    jsonb_build_object('status', p_status)
  );

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
    step_row.tenant_id,
    actor_id,
    'workflow_step_updated',
    'workflow_run_step',
    p_step_id,
    step_row.title,
    'Workflow step status updated.',
    'info',
    jsonb_build_object('run_id', step_row.run_id, 'status', p_status)
  );

  select not exists (
    select 1
    from public.workflow_run_steps wrs
    where wrs.run_id = step_row.run_id
      and wrs.status not in ('completed', 'skipped')
  )
  into all_done;

  if all_done then
    update public.workflow_runs
    set
      status = 'completed',
      completed_by = actor_id,
      completed_at = now()
    where id = step_row.run_id
      and status <> 'completed';

    perform public.insert_workflow_activity(
      step_row.tenant_id,
      step_row.run_id,
      null,
      'workflow_run_completed',
      jsonb_build_object('run_id', step_row.run_id)
    );
  end if;

  return p_step_id;
end;
$$;

revoke execute on function public.update_workflow_run_step(uuid, text, text) from public;
grant execute on function public.update_workflow_run_step(uuid, text, text) to authenticated;
