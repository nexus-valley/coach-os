-- Module 51: Workflow Builder foundation
-- Additive only. Human-controlled workflows; no automatic product write actions.

create table if not exists public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  category text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(name) between 1 and 160),
  check (description is null or char_length(description) <= 1200),
  check (category is null or char_length(category) <= 80)
);

create table if not exists public.workflow_template_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.workflow_templates(id) on delete cascade,
  step_order integer not null check (step_order > 0 and step_order <= 100),
  title text not null,
  description text,
  step_type text not null check (step_type in ('manual_task', 'checklist', 'approval_gate', 'reference')),
  default_assignee_role text check (default_assignee_role in ('owner', 'admin', 'staff', 'trainer')),
  is_required boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, step_order),
  check (char_length(title) between 1 and 160),
  check (description is null or char_length(description) <= 1200),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 2500)
);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid references public.workflow_templates(id) on delete set null,
  name text not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'cancelled')),
  entity_type text,
  entity_id uuid,
  started_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(name) between 1 and 180),
  check (entity_type is null or char_length(entity_type) <= 80)
);

create table if not exists public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  template_step_id uuid references public.workflow_template_steps(id) on delete set null,
  step_order integer not null check (step_order > 0 and step_order <= 100),
  title text not null,
  description text,
  step_type text not null check (step_type in ('manual_task', 'checklist', 'approval_gate', 'reference')),
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_role text check (assigned_role in ('owner', 'admin', 'staff', 'trainer')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'skipped', 'blocked')),
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  notes text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, step_order),
  check (char_length(title) between 1 and 160),
  check (description is null or char_length(description) <= 1200),
  check (notes is null or char_length(notes) <= 2000),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 2500)
);

create table if not exists public.workflow_activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid references public.workflow_runs(id) on delete cascade,
  step_id uuid references public.workflow_run_steps(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(action) between 1 and 120),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 2500)
);

create index if not exists workflow_templates_tenant_status_idx
on public.workflow_templates (tenant_id, status);

create index if not exists workflow_template_steps_template_idx
on public.workflow_template_steps (template_id, step_order);

create index if not exists workflow_runs_tenant_status_idx
on public.workflow_runs (tenant_id, status, created_at desc);

create index if not exists workflow_run_steps_run_idx
on public.workflow_run_steps (run_id, step_order);

create index if not exists workflow_run_steps_assigned_to_idx
on public.workflow_run_steps (tenant_id, assigned_to, status);

create index if not exists workflow_run_steps_assigned_role_idx
on public.workflow_run_steps (tenant_id, assigned_role, status);

create index if not exists workflow_activity_logs_run_idx
on public.workflow_activity_logs (run_id, created_at desc);

drop trigger if exists set_workflow_templates_updated_at on public.workflow_templates;
create trigger set_workflow_templates_updated_at
before update on public.workflow_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_workflow_template_steps_updated_at on public.workflow_template_steps;
create trigger set_workflow_template_steps_updated_at
before update on public.workflow_template_steps
for each row execute function public.set_updated_at();

drop trigger if exists set_workflow_runs_updated_at on public.workflow_runs;
create trigger set_workflow_runs_updated_at
before update on public.workflow_runs
for each row execute function public.set_updated_at();

drop trigger if exists set_workflow_run_steps_updated_at on public.workflow_run_steps;
create trigger set_workflow_run_steps_updated_at
before update on public.workflow_run_steps
for each row execute function public.set_updated_at();

alter table public.workflow_templates enable row level security;
alter table public.workflow_template_steps enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;
alter table public.workflow_activity_logs enable row level security;

revoke all on public.workflow_templates from anon;
revoke all on public.workflow_template_steps from anon;
revoke all on public.workflow_runs from anon;
revoke all on public.workflow_run_steps from anon;
revoke all on public.workflow_activity_logs from anon;

revoke insert, update, delete on public.workflow_templates from authenticated;
revoke insert, update, delete on public.workflow_template_steps from authenticated;
revoke insert, update, delete on public.workflow_runs from authenticated;
revoke insert, update, delete on public.workflow_run_steps from authenticated;
revoke insert, update, delete on public.workflow_activity_logs from authenticated;

grant select on public.workflow_templates to authenticated;
grant select on public.workflow_template_steps to authenticated;
grant select on public.workflow_runs to authenticated;
grant select on public.workflow_run_steps to authenticated;
grant select on public.workflow_activity_logs to authenticated;

create or replace function public.workflow_current_role(check_tenant_id uuid)
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

create or replace function public.workflow_step_is_assigned(
  check_tenant_id uuid,
  check_assigned_to uuid,
  check_assigned_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.workflow_current_role(check_tenant_id) is not null
    and (
      check_assigned_to = auth.uid()
      or (
        check_assigned_to is null
        and check_assigned_role is not null
        and check_assigned_role = public.workflow_current_role(check_tenant_id)
      )
    );
$$;

create or replace function public.workflow_run_is_visible(check_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workflow_runs wr
    where wr.id = check_run_id
      and (
        public.has_tenant_role(wr.tenant_id, auth.uid(), array['owner', 'admin'])
        or exists (
          select 1
          from public.workflow_run_steps wrs
          where wrs.run_id = wr.id
            and public.workflow_step_is_assigned(wrs.tenant_id, wrs.assigned_to, wrs.assigned_role)
        )
      )
  );
$$;

revoke execute on function public.workflow_current_role(uuid) from public;
revoke execute on function public.workflow_step_is_assigned(uuid, uuid, text) from public;
revoke execute on function public.workflow_run_is_visible(uuid) from public;
grant execute on function public.workflow_current_role(uuid) to authenticated;
grant execute on function public.workflow_step_is_assigned(uuid, uuid, text) to authenticated;
grant execute on function public.workflow_run_is_visible(uuid) to authenticated;

drop policy if exists "Owner admin can read workflow templates" on public.workflow_templates;
create policy "Owner admin can read workflow templates"
on public.workflow_templates
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or exists (
    select 1
    from public.workflow_runs wr
    where wr.template_id = workflow_templates.id
      and public.workflow_run_is_visible(wr.id)
  )
);

drop policy if exists "Users can read visible workflow template steps" on public.workflow_template_steps;
create policy "Users can read visible workflow template steps"
on public.workflow_template_steps
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or exists (
    select 1
    from public.workflow_run_steps wrs
    join public.workflow_runs wr on wr.id = wrs.run_id
    where wr.template_id = workflow_template_steps.template_id
      and wrs.template_step_id = workflow_template_steps.id
      and public.workflow_step_is_assigned(wrs.tenant_id, wrs.assigned_to, wrs.assigned_role)
  )
);

drop policy if exists "Users can read visible workflow runs" on public.workflow_runs;
create policy "Users can read visible workflow runs"
on public.workflow_runs
for select
to authenticated
using (public.workflow_run_is_visible(id));

drop policy if exists "Users can read visible workflow run steps" on public.workflow_run_steps;
create policy "Users can read visible workflow run steps"
on public.workflow_run_steps
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or public.workflow_step_is_assigned(tenant_id, assigned_to, assigned_role)
);

drop policy if exists "Users can read visible workflow activity logs" on public.workflow_activity_logs;
create policy "Users can read visible workflow activity logs"
on public.workflow_activity_logs
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or public.workflow_run_is_visible(run_id)
);

create or replace function public.validate_workflow_text(
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

create or replace function public.workflow_validate_steps(p_steps jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  step_count integer;
  step_item jsonb;
  order_key text;
  order_value integer;
  seen_orders integer[] := '{}';
  is_required_value jsonb;
  metadata_value jsonb;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Workflow steps must be a JSON array.' using errcode = '22023';
  end if;

  step_count := jsonb_array_length(p_steps);

  if step_count < 1 or step_count > 50 then
    raise exception 'Workflow templates must include 1 to 50 steps.' using errcode = '22023';
  end if;

  for step_item in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(step_item) <> 'object' then
      raise exception 'Each workflow step must be an object.' using errcode = '22023';
    end if;

    perform public.validate_workflow_text(step_item ->> 'title', 'Step title', true, 160);
    perform public.validate_workflow_text(step_item ->> 'description', 'Step description', false, 1200);

    if step_item ->> 'step_type' not in ('manual_task', 'checklist', 'approval_gate', 'reference') then
      raise exception 'Invalid workflow step type.' using errcode = '22023';
    end if;

    if coalesce(step_item ->> 'default_assignee_role', '') <> ''
       and step_item ->> 'default_assignee_role' not in ('owner', 'admin', 'staff', 'trainer') then
      raise exception 'Invalid default assignee role.' using errcode = '22023';
    end if;

    order_key := nullif(trim(coalesce(step_item ->> 'step_order', '')), '');

    if order_key is null or order_key !~ '^[0-9]+$' then
      raise exception 'Workflow step order must be a whole number.' using errcode = '22023';
    end if;

    order_value := order_key::integer;
    if order_value is null or order_value < 1 or order_value > 100 then
      raise exception 'Invalid workflow step order.' using errcode = '22023';
    end if;

    if order_value = any(seen_orders) then
      raise exception 'Workflow step order values must be unique.' using errcode = '22023';
    end if;
    seen_orders := array_append(seen_orders, order_value);

    if step_item ? 'is_required' then
      is_required_value := step_item -> 'is_required';

      if jsonb_typeof(is_required_value) = 'boolean' then
        null;
      elsif jsonb_typeof(is_required_value) = 'string'
            and lower(trim(step_item ->> 'is_required')) in ('true', 'false') then
        null;
      else
        raise exception 'Workflow step is_required must be true or false.' using errcode = '22023';
      end if;
    end if;

    metadata_value := coalesce(step_item -> 'metadata_json', '{}'::jsonb);
    if jsonb_typeof(metadata_value) <> 'object' or char_length(metadata_value::text) > 2500 then
      raise exception 'Invalid workflow step metadata.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke execute on function public.validate_workflow_text(text, text, boolean, integer) from public;
revoke execute on function public.workflow_validate_steps(jsonb) from public;

create or replace function public.insert_workflow_activity(
  p_tenant_id uuid,
  p_run_id uuid,
  p_step_id uuid,
  p_action text,
  p_metadata_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workflow_activity_logs (
    tenant_id,
    run_id,
    step_id,
    actor_id,
    action,
    metadata_json
  )
  values (
    p_tenant_id,
    p_run_id,
    p_step_id,
    auth.uid(),
    public.validate_workflow_text(p_action, 'Workflow action', true, 120),
    case
      when p_metadata_json is null then '{}'::jsonb
      when jsonb_typeof(p_metadata_json) <> 'object' then '{}'::jsonb
      when char_length(p_metadata_json::text) > 2500 then '{}'::jsonb
      else p_metadata_json
    end
  );
end;
$$;

revoke execute on function public.insert_workflow_activity(uuid, uuid, uuid, text, jsonb) from public;

create or replace function public.create_workflow_template(
  p_tenant_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_status text,
  p_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  new_template_id uuid;
  step_item jsonb;
begin
  if actor_id is null or not public.has_tenant_role(p_tenant_id, actor_id, array['owner', 'admin']) then
    raise exception 'Only owner/admin users can create workflow templates.' using errcode = '42501';
  end if;

  if coalesce(p_status, 'draft') not in ('draft', 'active') then
    raise exception 'Invalid workflow template status.' using errcode = '22023';
  end if;

  perform public.workflow_validate_steps(p_steps);

  insert into public.workflow_templates (
    tenant_id,
    name,
    description,
    category,
    status,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    public.validate_workflow_text(p_name, 'Workflow name', true, 160),
    public.validate_workflow_text(p_description, 'Workflow description', false, 1200),
    public.validate_workflow_text(p_category, 'Workflow category', false, 80),
    coalesce(p_status, 'draft'),
    actor_id,
    actor_id
  )
  returning id into new_template_id;

  for step_item in select value from jsonb_array_elements(p_steps) loop
    insert into public.workflow_template_steps (
      tenant_id,
      template_id,
      step_order,
      title,
      description,
      step_type,
      default_assignee_role,
      is_required,
      metadata_json
    )
    values (
      p_tenant_id,
      new_template_id,
      (step_item ->> 'step_order')::integer,
      public.validate_workflow_text(step_item ->> 'title', 'Step title', true, 160),
      public.validate_workflow_text(step_item ->> 'description', 'Step description', false, 1200),
      step_item ->> 'step_type',
      nullif(step_item ->> 'default_assignee_role', ''),
      coalesce((step_item ->> 'is_required')::boolean, true),
      coalesce(step_item -> 'metadata_json', '{}'::jsonb)
    );
  end loop;

  perform public.insert_workflow_activity(
    p_tenant_id,
    null,
    null,
    'workflow_template_created',
    jsonb_build_object('template_id', new_template_id, 'step_count', jsonb_array_length(p_steps))
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
    'workflow_template_created',
    'workflow_template',
    new_template_id,
    public.validate_workflow_text(p_name, 'Workflow name', true, 160),
    'Workflow template created.',
    'info',
    jsonb_build_object('step_count', jsonb_array_length(p_steps), 'status', coalesce(p_status, 'draft'))
  );

  return new_template_id;
end;
$$;

create or replace function public.update_workflow_template(
  p_template_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_status text,
  p_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  template_row public.workflow_templates%rowtype;
  step_item jsonb;
begin
  select * into template_row
  from public.workflow_templates
  where id = p_template_id;

  if not found then
    raise exception 'Workflow template not found.' using errcode = 'P0002';
  end if;

  if actor_id is null or not public.has_tenant_role(template_row.tenant_id, actor_id, array['owner', 'admin']) then
    raise exception 'Only owner/admin users can update workflow templates.' using errcode = '42501';
  end if;

  if p_status not in ('draft', 'active', 'archived') then
    raise exception 'Invalid workflow template status.' using errcode = '22023';
  end if;

  perform public.workflow_validate_steps(p_steps);

  update public.workflow_templates
  set
    name = public.validate_workflow_text(p_name, 'Workflow name', true, 160),
    description = public.validate_workflow_text(p_description, 'Workflow description', false, 1200),
    category = public.validate_workflow_text(p_category, 'Workflow category', false, 80),
    status = p_status,
    updated_by = actor_id
  where id = p_template_id;

  delete from public.workflow_template_steps
  where template_id = p_template_id;

  for step_item in select value from jsonb_array_elements(p_steps) loop
    insert into public.workflow_template_steps (
      tenant_id,
      template_id,
      step_order,
      title,
      description,
      step_type,
      default_assignee_role,
      is_required,
      metadata_json
    )
    values (
      template_row.tenant_id,
      p_template_id,
      (step_item ->> 'step_order')::integer,
      public.validate_workflow_text(step_item ->> 'title', 'Step title', true, 160),
      public.validate_workflow_text(step_item ->> 'description', 'Step description', false, 1200),
      step_item ->> 'step_type',
      nullif(step_item ->> 'default_assignee_role', ''),
      coalesce((step_item ->> 'is_required')::boolean, true),
      coalesce(step_item -> 'metadata_json', '{}'::jsonb)
    );
  end loop;

  perform public.insert_workflow_activity(
    template_row.tenant_id,
    null,
    null,
    'workflow_template_updated',
    jsonb_build_object('template_id', p_template_id, 'step_count', jsonb_array_length(p_steps), 'status', p_status)
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
    template_row.tenant_id,
    actor_id,
    'workflow_template_updated',
    'workflow_template',
    p_template_id,
    public.validate_workflow_text(p_name, 'Workflow name', true, 160),
    'Workflow template updated.',
    'info',
    jsonb_build_object('changed_fields', array['name', 'description', 'category', 'status', 'steps'], 'step_count', jsonb_array_length(p_steps), 'status', p_status)
  );

  return p_template_id;
end;
$$;

create or replace function public.archive_workflow_template(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  template_row public.workflow_templates%rowtype;
begin
  select * into template_row
  from public.workflow_templates
  where id = p_template_id;

  if not found then
    raise exception 'Workflow template not found.' using errcode = 'P0002';
  end if;

  if actor_id is null or not public.has_tenant_role(template_row.tenant_id, actor_id, array['owner', 'admin']) then
    raise exception 'Only owner/admin users can archive workflow templates.' using errcode = '42501';
  end if;

  update public.workflow_templates
  set status = 'archived', updated_by = actor_id
  where id = p_template_id;

  perform public.insert_workflow_activity(
    template_row.tenant_id,
    null,
    null,
    'workflow_template_archived',
    jsonb_build_object('template_id', p_template_id)
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
    template_row.tenant_id,
    actor_id,
    'workflow_template_archived',
    'workflow_template',
    p_template_id,
    template_row.name,
    'Workflow template archived.',
    'warning',
    jsonb_build_object('status', 'archived')
  );

  return p_template_id;
end;
$$;

create or replace function public.start_workflow_run(
  p_template_id uuid,
  p_name text,
  p_entity_type text,
  p_entity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  template_row public.workflow_templates%rowtype;
  new_run_id uuid;
  step_row public.workflow_template_steps%rowtype;
begin
  select * into template_row
  from public.workflow_templates
  where id = p_template_id
    and status = 'active';

  if not found then
    raise exception 'Active workflow template not found.' using errcode = 'P0002';
  end if;

  if actor_id is null or not public.has_tenant_role(template_row.tenant_id, actor_id, array['owner', 'admin']) then
    raise exception 'Only owner/admin users can start workflow runs.' using errcode = '42501';
  end if;

  insert into public.workflow_runs (
    tenant_id,
    template_id,
    name,
    status,
    entity_type,
    entity_id,
    started_by,
    started_at
  )
  values (
    template_row.tenant_id,
    p_template_id,
    coalesce(public.validate_workflow_text(p_name, 'Workflow run name', false, 180), template_row.name),
    'in_progress',
    public.validate_workflow_text(p_entity_type, 'Workflow entity type', false, 80),
    p_entity_id,
    actor_id,
    now()
  )
  returning id into new_run_id;

  for step_row in
    select *
    from public.workflow_template_steps
    where template_id = p_template_id
    order by step_order asc
  loop
    insert into public.workflow_run_steps (
      tenant_id,
      run_id,
      template_step_id,
      step_order,
      title,
      description,
      step_type,
      assigned_role,
      status,
      metadata_json
    )
    values (
      template_row.tenant_id,
      new_run_id,
      step_row.id,
      step_row.step_order,
      step_row.title,
      step_row.description,
      step_row.step_type,
      step_row.default_assignee_role,
      'pending',
      step_row.metadata_json
    );
  end loop;

  perform public.insert_workflow_activity(
    template_row.tenant_id,
    new_run_id,
    null,
    'workflow_run_started',
    jsonb_build_object('template_id', p_template_id, 'run_id', new_run_id)
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
    template_row.tenant_id,
    actor_id,
    'workflow_run_started',
    'workflow_run',
    new_run_id,
    template_row.name,
    'Workflow run started.',
    'info',
    jsonb_build_object('template_id', p_template_id, 'entity_type', p_entity_type)
  );

  return new_run_id;
end;
$$;

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
    or public.workflow_step_is_assigned(step_row.tenant_id, step_row.assigned_to, step_row.assigned_role)
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

revoke execute on function public.create_workflow_template(uuid, text, text, text, text, jsonb) from public;
revoke execute on function public.update_workflow_template(uuid, text, text, text, text, jsonb) from public;
revoke execute on function public.archive_workflow_template(uuid) from public;
revoke execute on function public.start_workflow_run(uuid, text, text, uuid) from public;
revoke execute on function public.update_workflow_run_step(uuid, text, text) from public;

grant execute on function public.create_workflow_template(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.update_workflow_template(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.archive_workflow_template(uuid) to authenticated;
grant execute on function public.start_workflow_run(uuid, text, text, uuid) to authenticated;
grant execute on function public.update_workflow_run_step(uuid, text, text) to authenticated;
