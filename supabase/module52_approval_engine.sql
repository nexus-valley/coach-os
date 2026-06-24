-- Module 52: Approval Engine foundation
-- Additive only. Approval decisions update approval tables and linked workflow
-- gate steps only; they do not mutate product entities.

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_role text check (assigned_role in ('owner', 'admin', 'staff', 'trainer')),
  approval_type text not null check (
    approval_type in (
      'workflow_gate',
      'course_publish',
      'certificate_issue',
      'payment_adjustment',
      'student_change',
      'settings_change',
      'automation_action',
      'general'
    )
  ),
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  entity_type text,
  entity_id uuid,
  workflow_run_id uuid references public.workflow_runs(id) on delete set null,
  workflow_step_id uuid references public.workflow_run_steps(id) on delete set null,
  decision_by uuid references auth.users(id) on delete set null,
  decision_at timestamptz,
  decision_note text,
  due_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(title) between 1 and 180),
  check (description is null or char_length(description) <= 1500),
  check (decision_note is null or char_length(decision_note) <= 1500),
  check (entity_type is null or char_length(entity_type) <= 80),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 3000)
);

create table if not exists public.approval_activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  approval_id uuid references public.approval_requests(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(action) between 1 and 120),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 3000)
);

create index if not exists approval_requests_tenant_status_idx
on public.approval_requests (tenant_id, status, created_at desc);

create index if not exists approval_requests_requested_by_idx
on public.approval_requests (tenant_id, requested_by, status);

create index if not exists approval_requests_assigned_to_idx
on public.approval_requests (tenant_id, assigned_to, status);

create index if not exists approval_requests_assigned_role_idx
on public.approval_requests (tenant_id, assigned_role, status);

create index if not exists approval_requests_type_idx
on public.approval_requests (tenant_id, approval_type, status);

create index if not exists approval_requests_workflow_step_idx
on public.approval_requests (workflow_step_id);

create index if not exists approval_activity_logs_approval_idx
on public.approval_activity_logs (approval_id, created_at desc);

drop trigger if exists set_approval_requests_updated_at on public.approval_requests;
create trigger set_approval_requests_updated_at
before update on public.approval_requests
for each row execute function public.set_updated_at();

alter table public.approval_requests enable row level security;
alter table public.approval_activity_logs enable row level security;

revoke all on public.approval_requests from anon;
revoke all on public.approval_activity_logs from anon;
revoke insert, update, delete on public.approval_requests from authenticated;
revoke insert, update, delete on public.approval_activity_logs from authenticated;
grant select on public.approval_requests to authenticated;
grant select on public.approval_activity_logs to authenticated;

create or replace function public.approval_current_role(check_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.tenant_members tm
  where tm.tenant_id = check_tenant_id
    and tm.user_id = auth.uid()
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  limit 1;
$$;

create or replace function public.approval_user_role(
  check_tenant_id uuid,
  check_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.tenant_members tm
  where tm.tenant_id = check_tenant_id
    and tm.user_id = check_user_id
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  limit 1;
$$;

create or replace function public.approval_is_visible(check_approval_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  approval_row public.approval_requests%rowtype;
  current_member_role text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into approval_row
  from public.approval_requests
  where id = check_approval_id;

  if not found then
    return false;
  end if;

  current_member_role := public.approval_current_role(approval_row.tenant_id);

  if public.has_tenant_role(approval_row.tenant_id, auth.uid(), array['owner', 'admin']) then
    return true;
  end if;

  if current_member_role is null then
    return false;
  end if;

  return coalesce(
    (
      approval_row.requested_by is not null
      and approval_row.requested_by = auth.uid()
    )
    or (
      approval_row.assigned_to is not null
      and approval_row.assigned_to = auth.uid()
    )
    or (
      approval_row.assigned_to is null
      and approval_row.assigned_role is not null
      and approval_row.assigned_role = current_member_role
    ),
    false
  );
end;
$$;

revoke execute on function public.approval_current_role(uuid) from public;
revoke execute on function public.approval_user_role(uuid, uuid) from public;
revoke execute on function public.approval_is_visible(uuid) from public;
grant execute on function public.approval_current_role(uuid) to authenticated;
revoke execute on function public.approval_user_role(uuid, uuid) from authenticated;
grant execute on function public.approval_is_visible(uuid) to authenticated;

drop policy if exists "Users can read visible approval requests" on public.approval_requests;
create policy "Users can read visible approval requests"
on public.approval_requests
for select
to authenticated
using (public.approval_is_visible(id));

drop policy if exists "Users can read visible approval activity logs" on public.approval_activity_logs;
create policy "Users can read visible approval activity logs"
on public.approval_activity_logs
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or public.approval_is_visible(approval_id)
);

create or replace function public.validate_approval_text(
  check_value text,
  check_field text,
  check_required boolean,
  check_max integer
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(check_value, '')), '');
begin
  if check_required and normalized is null then
    raise exception '% is required.', check_field using errcode = '22023';
  end if;

  if normalized is not null and char_length(normalized) > check_max then
    raise exception '% is too long.', check_field using errcode = '22023';
  end if;

  if normalized is not null and normalized ~ '[<>]' then
    raise exception '% cannot contain HTML-like characters.', check_field using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.normalize_approval_metadata(p_metadata_json jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_metadata_json is null then
    return '{}'::jsonb;
  end if;

  if jsonb_typeof(p_metadata_json) <> 'object' then
    raise exception 'Approval metadata must be a JSON object.' using errcode = '22023';
  end if;

  if char_length(p_metadata_json::text) > 3000 then
    raise exception 'Approval metadata is too large.' using errcode = '22023';
  end if;

  return p_metadata_json;
end;
$$;

create or replace function public.insert_approval_activity(
  p_tenant_id uuid,
  p_approval_id uuid,
  p_action text,
  p_metadata_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.approval_activity_logs (
    tenant_id,
    approval_id,
    actor_id,
    action,
    metadata_json
  )
  values (
    p_tenant_id,
    p_approval_id,
    auth.uid(),
    public.validate_approval_text(p_action, 'Approval action', true, 120),
    public.normalize_approval_metadata(p_metadata_json)
  );
end;
$$;

revoke execute on function public.validate_approval_text(text, text, boolean, integer) from public;
revoke execute on function public.normalize_approval_metadata(jsonb) from public;
revoke execute on function public.insert_approval_activity(uuid, uuid, text, jsonb) from public;

create or replace function public.approval_type_requires_admin(p_approval_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_approval_type in (
    'course_publish',
    'certificate_issue',
    'payment_adjustment',
    'student_change',
    'settings_change',
    'automation_action'
  );
$$;

revoke execute on function public.approval_type_requires_admin(text) from public;

create or replace function public.create_approval_request(
  p_tenant_id uuid,
  p_approval_type text,
  p_title text,
  p_description text,
  p_assigned_to uuid,
  p_assigned_role text,
  p_priority text,
  p_entity_type text,
  p_entity_id uuid,
  p_workflow_run_id uuid,
  p_workflow_step_id uuid,
  p_due_at timestamptz,
  p_metadata_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  assigned_user_role text;
  final_assigned_role text := nullif(trim(coalesce(p_assigned_role, '')), '');
  normalized_type text := nullif(trim(coalesce(p_approval_type, '')), '');
  normalized_priority text := coalesce(nullif(trim(coalesce(p_priority, '')), ''), 'normal');
  final_workflow_run_id uuid := p_workflow_run_id;
  workflow_step_row public.workflow_run_steps%rowtype;
  workflow_run_row public.workflow_runs%rowtype;
  new_approval_id uuid;
begin
  actor_role := public.approval_current_role(p_tenant_id);

  if actor_id is null or actor_role is null then
    raise exception 'Only tenant team members can create approval requests.' using errcode = '42501';
  end if;

  if normalized_type not in (
    'workflow_gate',
    'course_publish',
    'certificate_issue',
    'payment_adjustment',
    'student_change',
    'settings_change',
    'automation_action',
    'general'
  ) then
    raise exception 'Invalid approval type.' using errcode = '22023';
  end if;

  if normalized_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid approval priority.' using errcode = '22023';
  end if;

  if final_assigned_role is not null
     and final_assigned_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'Invalid assigned approval role.' using errcode = '22023';
  end if;

  if p_assigned_to is not null then
    assigned_user_role := public.approval_user_role(p_tenant_id, p_assigned_to);

    if assigned_user_role is null then
      raise exception 'Assigned approver must be a member of this tenant.' using errcode = '42501';
    end if;
  end if;

  if p_assigned_to is null and final_assigned_role is null then
    final_assigned_role := 'owner';
  end if;

  if actor_role not in ('owner', 'admin')
     and public.approval_type_requires_admin(normalized_type)
     and coalesce(assigned_user_role, final_assigned_role) not in ('owner', 'admin') then
    raise exception 'Sensitive approval requests must be assigned to owner/admin.' using errcode = '42501';
  end if;

  if p_workflow_step_id is not null then
    select * into workflow_step_row
    from public.workflow_run_steps
    where id = p_workflow_step_id;

    if not found then
      raise exception 'Workflow approval gate step not found.' using errcode = 'P0002';
    end if;

    if workflow_step_row.tenant_id <> p_tenant_id then
      raise exception 'Workflow approval gate belongs to another tenant.' using errcode = '42501';
    end if;

    if workflow_step_row.step_type <> 'approval_gate' then
      raise exception 'Workflow step must be an approval gate.' using errcode = '22023';
    end if;

    select * into workflow_run_row
    from public.workflow_runs
    where id = workflow_step_row.run_id;

    if not found then
      raise exception 'Parent workflow run not found.' using errcode = 'P0002';
    end if;

    if workflow_run_row.tenant_id <> p_tenant_id then
      raise exception 'Parent workflow run belongs to another tenant.' using errcode = '42501';
    end if;

    if workflow_run_row.status in ('completed', 'cancelled') then
      raise exception 'Parent workflow run is already completed or cancelled.' using errcode = '42501';
    end if;

    if actor_role not in ('owner', 'admin')
       and not coalesce(
         public.workflow_step_is_assigned(
           workflow_step_row.tenant_id,
           workflow_step_row.assigned_to,
           workflow_step_row.assigned_role
         ),
         false
       ) then
      raise exception 'Workflow approval gate is not assigned to this user.' using errcode = '42501';
    end if;

    if final_workflow_run_id is not null and final_workflow_run_id <> workflow_step_row.run_id then
      raise exception 'Workflow run does not match approval gate step.' using errcode = '22023';
    end if;

    final_workflow_run_id := workflow_step_row.run_id;
    normalized_type := 'workflow_gate';
  elsif final_workflow_run_id is not null then
    select * into workflow_run_row
    from public.workflow_runs
    where id = final_workflow_run_id;

    if not found then
      raise exception 'Workflow run not found.' using errcode = 'P0002';
    end if;

    if workflow_run_row.tenant_id <> p_tenant_id then
      raise exception 'Workflow run belongs to another tenant.' using errcode = '42501';
    end if;

    if workflow_run_row.status in ('completed', 'cancelled') then
      raise exception 'Workflow run is already completed or cancelled.' using errcode = '42501';
    end if;
  end if;

  insert into public.approval_requests (
    tenant_id,
    requested_by,
    assigned_to,
    assigned_role,
    approval_type,
    title,
    description,
    priority,
    entity_type,
    entity_id,
    workflow_run_id,
    workflow_step_id,
    due_at,
    metadata_json
  )
  values (
    p_tenant_id,
    actor_id,
    p_assigned_to,
    final_assigned_role,
    normalized_type,
    public.validate_approval_text(p_title, 'Approval title', true, 180),
    public.validate_approval_text(p_description, 'Approval description', false, 1500),
    normalized_priority,
    public.validate_approval_text(p_entity_type, 'Approval entity type', false, 80),
    p_entity_id,
    final_workflow_run_id,
    p_workflow_step_id,
    p_due_at,
    public.normalize_approval_metadata(p_metadata_json)
  )
  returning id into new_approval_id;

  perform public.insert_approval_activity(
    p_tenant_id,
    new_approval_id,
    'approval_request_created',
    jsonb_build_object(
      'approval_type', normalized_type,
      'assigned_role', final_assigned_role,
      'assigned_to_present', p_assigned_to is not null,
      'workflow_run_id', final_workflow_run_id,
      'workflow_step_id', p_workflow_step_id
    )
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
    p_tenant_id,
    actor_id,
    'approval_request_created',
    'approval_request',
    new_approval_id,
    public.validate_approval_text(p_title, 'Approval title', true, 180),
    'Approval request created.',
    'info',
    jsonb_build_object(
      'approval_id', new_approval_id,
      'approval_type', normalized_type,
      'entity_type', p_entity_type,
      'entity_id', p_entity_id,
      'workflow_run_id', final_workflow_run_id,
      'workflow_step_id', p_workflow_step_id,
      'assigned_role', final_assigned_role,
      'assigned_to_present', p_assigned_to is not null,
      'status_transition', 'created_pending'
    )
  );

  return new_approval_id;
end;
$$;

create or replace function public.decide_approval_request(
  p_approval_id uuid,
  p_decision text,
  p_decision_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  approval_row public.approval_requests%rowtype;
  actor_role text;
  normalized_decision text := nullif(trim(coalesce(p_decision, '')), '');
  new_step_status text;
  workflow_step_row public.workflow_run_steps%rowtype;
  workflow_run_row public.workflow_runs%rowtype;
  all_done boolean;
begin
  select * into approval_row
  from public.approval_requests
  where id = p_approval_id;

  if not found then
    raise exception 'Approval request not found.' using errcode = 'P0002';
  end if;

  actor_role := public.approval_current_role(approval_row.tenant_id);

  if actor_id is null or actor_role is null then
    raise exception 'Only tenant team members can decide approval requests.' using errcode = '42501';
  end if;

  if approval_row.status <> 'pending' then
    raise exception 'Approval request is not pending.' using errcode = '22023';
  end if;

  if normalized_decision not in ('approved', 'rejected') then
    raise exception 'Approval decision must be approved or rejected.' using errcode = '22023';
  end if;

  if not (
    actor_role in ('owner', 'admin')
    or (
      approval_row.assigned_to is not null
      and approval_row.assigned_to = actor_id
    )
    or (
      approval_row.assigned_to is null
      and approval_row.assigned_role is not null
      and approval_row.assigned_role = actor_role
    )
  ) then
    raise exception 'Approval request is not assigned to this user.' using errcode = '42501';
  end if;

  update public.approval_requests
  set
    status = normalized_decision,
    decision_by = actor_id,
    decision_at = now(),
    decision_note = public.validate_approval_text(p_decision_note, 'Approval decision note', false, 1500)
  where id = p_approval_id;

  perform public.insert_approval_activity(
    approval_row.tenant_id,
    p_approval_id,
    case
      when normalized_decision = 'approved' then 'approval_request_approved'
      else 'approval_request_rejected'
    end,
    jsonb_build_object(
      'approval_type', approval_row.approval_type,
      'workflow_run_id', approval_row.workflow_run_id,
      'workflow_step_id', approval_row.workflow_step_id,
      'status_transition', 'pending_' || normalized_decision
    )
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
    approval_row.tenant_id,
    actor_id,
    case
      when normalized_decision = 'approved' then 'approval_request_approved'
      else 'approval_request_rejected'
    end,
    'approval_request',
    p_approval_id,
    approval_row.title,
    'Approval request decided.',
    case when normalized_decision = 'approved' then 'info' else 'warning' end,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'approval_type', approval_row.approval_type,
      'entity_type', approval_row.entity_type,
      'entity_id', approval_row.entity_id,
      'workflow_run_id', approval_row.workflow_run_id,
      'workflow_step_id', approval_row.workflow_step_id,
      'assigned_role', approval_row.assigned_role,
      'assigned_to_present', approval_row.assigned_to is not null,
      'status_transition', 'pending_' || normalized_decision
    )
  );

  if approval_row.workflow_step_id is not null then
    select * into workflow_step_row
    from public.workflow_run_steps
    where id = approval_row.workflow_step_id;

    if found then
      if workflow_step_row.tenant_id <> approval_row.tenant_id then
        raise exception 'Linked workflow step belongs to another tenant.' using errcode = '42501';
      end if;

      select * into workflow_run_row
      from public.workflow_runs
      where id = workflow_step_row.run_id;

      if workflow_run_row.status in ('completed', 'cancelled') then
        raise exception 'Linked workflow run is already completed or cancelled.' using errcode = '42501';
      end if;

      new_step_status := case
        when normalized_decision = 'approved' then 'completed'
        else 'blocked'
      end;

      update public.workflow_run_steps
      set
        status = new_step_status,
        completed_by = case when normalized_decision = 'approved' then actor_id else null end,
        completed_at = case when normalized_decision = 'approved' then now() else null end,
        notes = null
      where id = approval_row.workflow_step_id;

      perform public.insert_workflow_activity(
        approval_row.tenant_id,
        workflow_step_row.run_id,
        approval_row.workflow_step_id,
        case
          when normalized_decision = 'approved' then 'workflow_gate_approved'
          else 'workflow_gate_rejected'
        end,
        jsonb_build_object('approval_id', p_approval_id)
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
        approval_row.tenant_id,
        actor_id,
        case
          when normalized_decision = 'approved' then 'workflow_gate_approved'
          else 'workflow_gate_rejected'
        end,
        'workflow_run_step',
        approval_row.workflow_step_id,
        workflow_step_row.title,
        'Workflow approval gate updated by approval decision.',
        case when normalized_decision = 'approved' then 'info' else 'warning' end,
        jsonb_build_object(
          'approval_id', p_approval_id,
          'workflow_run_id', workflow_step_row.run_id,
          'workflow_step_id', approval_row.workflow_step_id,
          'status_transition', new_step_status
        )
      );

      if normalized_decision = 'approved' then
        select not exists (
          select 1
          from public.workflow_run_steps wrs
          where wrs.run_id = workflow_step_row.run_id
            and wrs.status not in ('completed', 'skipped')
        )
        into all_done;

        if all_done then
          update public.workflow_runs
          set
            status = 'completed',
            completed_by = actor_id,
            completed_at = now()
          where id = workflow_step_row.run_id
            and status not in ('completed', 'cancelled');

          perform public.insert_workflow_activity(
            approval_row.tenant_id,
            workflow_step_row.run_id,
            null,
            'workflow_run_completed',
            jsonb_build_object('approval_id', p_approval_id)
          );
        end if;
      end if;
    end if;
  end if;

  return p_approval_id;
end;
$$;

create or replace function public.cancel_approval_request(p_approval_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  approval_row public.approval_requests%rowtype;
  actor_role text;
begin
  select * into approval_row
  from public.approval_requests
  where id = p_approval_id;

  if not found then
    raise exception 'Approval request not found.' using errcode = 'P0002';
  end if;

  actor_role := public.approval_current_role(approval_row.tenant_id);

  if actor_id is null or actor_role is null then
    raise exception 'Only tenant team members can cancel approval requests.' using errcode = '42501';
  end if;

  if approval_row.status <> 'pending' then
    raise exception 'Approval request is not pending.' using errcode = '22023';
  end if;

  if not (
    actor_role in ('owner', 'admin')
    or (
      approval_row.requested_by is not null
      and approval_row.requested_by = actor_id
    )
  ) then
    raise exception 'Only the requester or owner/admin can cancel this approval request.' using errcode = '42501';
  end if;

  update public.approval_requests
  set status = 'cancelled'
  where id = p_approval_id;

  perform public.insert_approval_activity(
    approval_row.tenant_id,
    p_approval_id,
    'approval_request_cancelled',
    jsonb_build_object(
      'approval_type', approval_row.approval_type,
      'status_transition', 'pending_cancelled'
    )
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
    approval_row.tenant_id,
    actor_id,
    'approval_request_cancelled',
    'approval_request',
    p_approval_id,
    approval_row.title,
    'Approval request cancelled.',
    'warning',
    jsonb_build_object(
      'approval_id', p_approval_id,
      'approval_type', approval_row.approval_type,
      'entity_type', approval_row.entity_type,
      'entity_id', approval_row.entity_id,
      'workflow_run_id', approval_row.workflow_run_id,
      'workflow_step_id', approval_row.workflow_step_id,
      'assigned_role', approval_row.assigned_role,
      'assigned_to_present', approval_row.assigned_to is not null,
      'status_transition', 'pending_cancelled'
    )
  );

  return p_approval_id;
end;
$$;

revoke execute on function public.create_approval_request(uuid, text, text, text, uuid, text, text, text, uuid, uuid, uuid, timestamptz, jsonb) from public;
revoke execute on function public.decide_approval_request(uuid, text, text) from public;
revoke execute on function public.cancel_approval_request(uuid) from public;

grant execute on function public.create_approval_request(uuid, text, text, text, uuid, text, text, text, uuid, uuid, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.decide_approval_request(uuid, text, text) to authenticated;
grant execute on function public.cancel_approval_request(uuid) to authenticated;
