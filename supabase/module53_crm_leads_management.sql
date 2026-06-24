-- Module 53: CRM & Leads Management
-- Internal tenant-scoped CRM pipeline. Run after Module 48 public website builder.

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  public_site_lead_id uuid references public.public_site_leads(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_role text check (assigned_role in ('owner', 'admin', 'staff', 'trainer')),
  name text not null,
  email text,
  phone text,
  source text not null default 'manual'
    check (source in ('manual', 'public_site', 'referral', 'whatsapp', 'phone', 'walk_in', 'campaign', 'import', 'other')),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'demo_scheduled', 'proposal_sent', 'follow_up', 'converted', 'lost', 'archived')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  interested_course_id uuid references public.courses(id) on delete set null,
  lead_value numeric check (lead_value is null or lead_value >= 0),
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  converted_student_id uuid references public.students(id) on delete set null,
  lost_reason text,
  tags text[] not null default '{}'::text[],
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_leads_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint crm_leads_metadata_size_chk check (length(metadata_json::text) <= 3000),
  constraint crm_leads_name_safe_chk check (length(name) between 1 and 180 and name !~ '[<>]'),
  constraint crm_leads_email_safe_chk check (email is null or (length(email) <= 254 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  constraint crm_leads_phone_safe_chk check (phone is null or (length(phone) <= 30 and phone ~ '^[+0-9() -]{5,30}$')),
  constraint crm_leads_lost_reason_safe_chk check (lost_reason is null or (length(lost_reason) <= 500 and lost_reason !~ '[<>]')),
  constraint crm_leads_assignment_exclusive_chk check (not (assigned_to is not null and assigned_role is not null))
);

create unique index if not exists crm_leads_public_site_lead_unique_idx
on public.crm_leads (public_site_lead_id)
where public_site_lead_id is not null;

create index if not exists crm_leads_tenant_created_at_idx
on public.crm_leads (tenant_id, created_at desc);

create index if not exists crm_leads_tenant_status_idx
on public.crm_leads (tenant_id, status);

create index if not exists crm_leads_tenant_assigned_to_idx
on public.crm_leads (tenant_id, assigned_to);

create index if not exists crm_leads_tenant_assigned_role_idx
on public.crm_leads (tenant_id, assigned_role);

create index if not exists crm_leads_tenant_next_follow_up_idx
on public.crm_leads (tenant_id, next_follow_up_at);

create table if not exists public.crm_lead_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  note_type text not null default 'note'
    check (note_type in ('note', 'call', 'whatsapp', 'email', 'meeting', 'demo', 'system')),
  note text not null,
  is_private boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint crm_lead_notes_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint crm_lead_notes_metadata_size_chk check (length(metadata_json::text) <= 3000),
  constraint crm_lead_notes_note_safe_chk check (length(note) between 1 and 2000 and note !~ '[<>]')
);

create index if not exists crm_lead_notes_tenant_lead_idx
on public.crm_lead_notes (tenant_id, lead_id, created_at desc);

create table if not exists public.crm_follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_role text check (assigned_role in ('owner', 'admin', 'staff', 'trainer')),
  title text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  due_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_follow_up_tasks_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint crm_follow_up_tasks_metadata_size_chk check (length(metadata_json::text) <= 3000),
  constraint crm_follow_up_tasks_title_safe_chk check (length(title) between 1 and 180 and title !~ '[<>]'),
  constraint crm_follow_up_tasks_description_safe_chk check (description is null or (length(description) <= 1200 and description !~ '[<>]')),
  constraint crm_follow_up_tasks_assignment_exclusive_chk check (not (assigned_to is not null and assigned_role is not null))
);

create index if not exists crm_follow_up_tasks_tenant_lead_idx
on public.crm_follow_up_tasks (tenant_id, lead_id, created_at desc);

create index if not exists crm_follow_up_tasks_tenant_assigned_to_idx
on public.crm_follow_up_tasks (tenant_id, assigned_to);

create index if not exists crm_follow_up_tasks_tenant_due_idx
on public.crm_follow_up_tasks (tenant_id, due_at);

create table if not exists public.crm_activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint crm_activity_logs_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint crm_activity_logs_metadata_size_chk check (length(metadata_json::text) <= 3000),
  constraint crm_activity_logs_action_safe_chk check (length(action) between 1 and 120 and action !~ '[<>]')
);

create index if not exists crm_activity_logs_tenant_lead_idx
on public.crm_activity_logs (tenant_id, lead_id, created_at desc);

drop trigger if exists set_crm_leads_updated_at on public.crm_leads;
create trigger set_crm_leads_updated_at
before update on public.crm_leads
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_follow_up_tasks_updated_at on public.crm_follow_up_tasks;
create trigger set_crm_follow_up_tasks_updated_at
before update on public.crm_follow_up_tasks
for each row execute function public.set_updated_at();

alter table public.crm_leads enable row level security;
alter table public.crm_lead_notes enable row level security;
alter table public.crm_follow_up_tasks enable row level security;
alter table public.crm_activity_logs enable row level security;

create or replace function public.crm_user_role(check_tenant_id uuid, check_user_id uuid)
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

create or replace function public.crm_current_role(check_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_user_role(check_tenant_id, auth.uid());
$$;

create or replace function public.crm_is_owner_admin(check_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_member_role text;
begin
  if auth.uid() is null then
    return false;
  end if;

  current_member_role := public.crm_current_role(check_tenant_id);
  return coalesce(current_member_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.crm_lead_is_visible(check_lead_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lead_row public.crm_leads%rowtype;
  current_member_role text;
  actor_id uuid := auth.uid();
begin
  if actor_id is null or check_lead_id is null then
    return false;
  end if;

  select *
  into lead_row
  from public.crm_leads
  where id = check_lead_id
  limit 1;

  if not found then
    return false;
  end if;

  current_member_role := public.crm_current_role(lead_row.tenant_id);

  if current_member_role is null then
    return false;
  end if;

  if current_member_role in ('owner', 'admin') then
    return true;
  end if;

  if lead_row.assigned_to is not null and lead_row.assigned_to = actor_id then
    return true;
  end if;

  if lead_row.assigned_to is null
     and lead_row.assigned_role is not null
     and lead_row.assigned_role = current_member_role then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.crm_follow_up_task_is_visible(check_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  task_row public.crm_follow_up_tasks%rowtype;
  current_member_role text;
  actor_id uuid := auth.uid();
begin
  if actor_id is null or check_task_id is null then
    return false;
  end if;

  select *
  into task_row
  from public.crm_follow_up_tasks
  where id = check_task_id
  limit 1;

  if not found then
    return false;
  end if;

  current_member_role := public.crm_current_role(task_row.tenant_id);

  if current_member_role is null then
    return false;
  end if;

  if current_member_role in ('owner', 'admin') then
    return true;
  end if;

  if public.crm_lead_is_visible(task_row.lead_id) then
    return true;
  end if;

  if task_row.assigned_to is not null and task_row.assigned_to = actor_id then
    return true;
  end if;

  if task_row.assigned_to is null
     and task_row.assigned_role is not null
     and task_row.assigned_role = current_member_role then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.validate_crm_text(
  input_value text,
  field_label text,
  required boolean,
  max_length integer
)
returns text
language plpgsql
immutable
as $$
declare
  normalized text := nullif(trim(coalesce(input_value, '')), '');
begin
  if normalized is null then
    if required then
      raise exception '% is required.', field_label using errcode = '22023';
    end if;

    return null;
  end if;

  if length(normalized) > max_length then
    raise exception '% is too long.', field_label using errcode = '22023';
  end if;

  if normalized ~ '[<>]' then
    raise exception '% cannot contain HTML.', field_label using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.normalize_crm_email(input_value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text := nullif(lower(trim(coalesce(input_value, ''))), '');
begin
  if normalized is null then
    return null;
  end if;

  if length(normalized) > 254 or normalized !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email must be valid.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.normalize_crm_phone(input_value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text := nullif(trim(coalesce(input_value, '')), '');
begin
  if normalized is null then
    return null;
  end if;

  if length(normalized) > 30 or normalized !~ '^[+0-9() -]{5,30}$' then
    raise exception 'Phone must be valid.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.normalize_crm_metadata(input_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
begin
  if input_value is null then
    return '{}'::jsonb;
  end if;

  if jsonb_typeof(input_value) <> 'object' then
    raise exception 'Metadata must be a JSON object.' using errcode = '22023';
  end if;

  if length(input_value::text) > 3000 then
    raise exception 'Metadata is too large.' using errcode = '22023';
  end if;

  return input_value;
end;
$$;

create or replace function public.normalize_crm_tags(input_tags text[])
returns text[]
language plpgsql
immutable
as $$
declare
  normalized text[];
  tag text;
begin
  if input_tags is null then
    return '{}'::text[];
  end if;

  select array_agg(distinct trimmed order by trimmed)
  into normalized
  from (
    select nullif(trim(value), '') as trimmed
    from unnest(input_tags) as raw(value)
  ) cleaned
  where trimmed is not null;

  if normalized is null then
    return '{}'::text[];
  end if;

  if cardinality(normalized) > 20 then
    raise exception 'At most 20 tags are allowed.' using errcode = '22023';
  end if;

  foreach tag in array normalized loop
    if length(tag) > 40 or tag ~ '[<>]' then
      raise exception 'Tags are too long or contain unsafe characters.' using errcode = '22023';
    end if;
  end loop;

  return normalized;
end;
$$;

create or replace function public.insert_crm_activity(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_action text,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
begin
  insert into public.crm_activity_logs (
    tenant_id,
    lead_id,
    actor_id,
    action,
    metadata_json
  )
  values (
    p_tenant_id,
    p_lead_id,
    auth.uid(),
    public.validate_crm_text(p_action, 'CRM activity action', true, 120),
    public.normalize_crm_metadata(p_metadata_json)
  )
  returning id into created_id;

  return created_id;
end;
$$;

drop policy if exists "CRM leads visible by tenant assignment" on public.crm_leads;
create policy "CRM leads visible by tenant assignment"
on public.crm_leads
for select
to authenticated
using (public.crm_lead_is_visible(id));

drop policy if exists "CRM notes visible through lead access" on public.crm_lead_notes;
create policy "CRM notes visible through lead access"
on public.crm_lead_notes
for select
to authenticated
using (
  public.crm_is_owner_admin(tenant_id)
  or (
    public.crm_lead_is_visible(lead_id)
    and (
      is_private = false
      or (created_by is not null and created_by = auth.uid())
    )
  )
);

drop policy if exists "CRM follow up tasks visible by assignment" on public.crm_follow_up_tasks;
create policy "CRM follow up tasks visible by assignment"
on public.crm_follow_up_tasks
for select
to authenticated
using (public.crm_follow_up_task_is_visible(id));

drop policy if exists "CRM activity visible through lead access" on public.crm_activity_logs;
create policy "CRM activity visible through lead access"
on public.crm_activity_logs
for select
to authenticated
using (
  public.crm_is_owner_admin(tenant_id)
  or (lead_id is not null and public.crm_lead_is_visible(lead_id))
);

create or replace function public.create_crm_lead(
  p_tenant_id uuid,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_source text default 'manual',
  p_priority text default 'normal',
  p_interested_course_id uuid default null,
  p_assigned_to uuid default null,
  p_assigned_role text default null,
  p_tags text[] default '{}'::text[],
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_source text := lower(trim(coalesce(p_source, 'manual')));
  normalized_priority text := lower(trim(coalesce(p_priority, 'normal')));
  normalized_assigned_role text := nullif(lower(trim(coalesce(p_assigned_role, ''))), '');
  normalized_email text := public.normalize_crm_email(p_email);
  normalized_phone text := public.normalize_crm_phone(p_phone);
  normalized_name text := public.validate_crm_text(p_name, 'Lead name', true, 180);
  final_assigned_to uuid := p_assigned_to;
  final_assigned_role text := normalized_assigned_role;
  new_lead_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  actor_role := public.crm_current_role(p_tenant_id);

  if actor_role is null then
    raise exception 'CRM access requires a tenant team member.' using errcode = '42501';
  end if;

  if p_assigned_to is not null and normalized_assigned_role is not null then
    raise exception 'Use assigned_to or assigned_role, not both.' using errcode = '22023';
  end if;

  if normalized_source = 'public_site' then
    raise exception 'Public site leads must be imported through create_crm_lead_from_public_site_lead.'
      using errcode = '22023';
  end if;

  if normalized_source not in ('manual', 'public_site', 'referral', 'whatsapp', 'phone', 'walk_in', 'campaign', 'import', 'other') then
    raise exception 'Lead source is invalid.' using errcode = '22023';
  end if;

  if normalized_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Lead priority is invalid.' using errcode = '22023';
  end if;

  if p_interested_course_id is not null and not exists (
    select 1
    from public.courses c
    where c.id = p_interested_course_id
      and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Interested course is not in this tenant.' using errcode = '22023';
  end if;

  if final_assigned_to is not null and public.crm_user_role(p_tenant_id, final_assigned_to) is null then
    raise exception 'Assigned user must belong to this tenant.' using errcode = '22023';
  end if;

  if final_assigned_role is not null and final_assigned_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'Assigned role is invalid.' using errcode = '22023';
  end if;

  if actor_role not in ('owner', 'admin') then
    if final_assigned_role is not null then
      raise exception 'Staff and trainers cannot create role-assigned CRM leads.'
        using errcode = '42501';
    end if;

    if final_assigned_to is not null and final_assigned_to <> actor_id then
      raise exception 'Staff and trainers can only assign new CRM leads to themselves.'
        using errcode = '42501';
    end if;

    final_assigned_to := actor_id;
    final_assigned_role := null;
  end if;

  if final_assigned_to is null and final_assigned_role is null then
    if actor_role in ('owner', 'admin') then
      final_assigned_role := 'owner';
    else
      final_assigned_to := actor_id;
    end if;
  end if;

  insert into public.crm_leads (
    tenant_id,
    created_by,
    updated_by,
    assigned_to,
    assigned_role,
    name,
    email,
    phone,
    source,
    priority,
    interested_course_id,
    tags,
    metadata_json
  )
  values (
    p_tenant_id,
    actor_id,
    actor_id,
    final_assigned_to,
    final_assigned_role,
    normalized_name,
    normalized_email,
    normalized_phone,
    normalized_source,
    normalized_priority,
    p_interested_course_id,
    public.normalize_crm_tags(p_tags),
    public.normalize_crm_metadata(p_metadata_json)
  )
  returning id into new_lead_id;

  perform public.insert_crm_activity(
    p_tenant_id,
    new_lead_id,
    'crm_lead_created',
    jsonb_build_object(
      'source', normalized_source,
      'priority', normalized_priority,
      'assigned_to_present', final_assigned_to is not null,
      'assigned_role', final_assigned_role,
      'interested_course_id', p_interested_course_id
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
    'crm_lead_created',
    'crm_lead',
    new_lead_id,
    normalized_name,
    'CRM lead created.',
    'info',
    jsonb_build_object(
      'lead_id', new_lead_id,
      'source', normalized_source,
      'priority', normalized_priority,
      'assigned_to_present', final_assigned_to is not null,
      'assigned_role', final_assigned_role,
      'interested_course_id', p_interested_course_id
    )
  );

  return new_lead_id;
end;
$$;

create or replace function public.create_crm_lead_from_public_site_lead(
  p_public_site_lead_id uuid,
  p_assigned_to uuid default null,
  p_assigned_role text default null,
  p_priority text default 'normal',
  p_tags text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  site_lead public.public_site_leads%rowtype;
  actor_role text;
  normalized_priority text := lower(trim(coalesce(p_priority, 'normal')));
  normalized_assigned_role text := nullif(lower(trim(coalesce(p_assigned_role, ''))), '');
  final_assigned_to uuid := p_assigned_to;
  final_assigned_role text;
  new_lead_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into site_lead
  from public.public_site_leads
  where id = p_public_site_lead_id
  limit 1;

  if not found then
    raise exception 'Public site lead not found.' using errcode = '22023';
  end if;

  actor_role := public.crm_current_role(site_lead.tenant_id);

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can import public site leads.' using errcode = '42501';
  end if;

  if p_assigned_to is not null and normalized_assigned_role is not null then
    raise exception 'Use assigned_to or assigned_role, not both.' using errcode = '22023';
  end if;

  if p_assigned_to is not null then
    final_assigned_to := p_assigned_to;
    final_assigned_role := null;
  else
    final_assigned_to := null;
    final_assigned_role := coalesce(normalized_assigned_role, 'owner');
  end if;

  if exists (
    select 1
    from public.crm_leads cl
    where cl.public_site_lead_id = p_public_site_lead_id
  ) then
    raise exception 'This public site lead has already been imported.' using errcode = '23505';
  end if;

  if normalized_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Lead priority is invalid.' using errcode = '22023';
  end if;

  if final_assigned_to is not null and public.crm_user_role(site_lead.tenant_id, final_assigned_to) is null then
    raise exception 'Assigned user must belong to this tenant.' using errcode = '22023';
  end if;

  if final_assigned_role is not null and final_assigned_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'Assigned role is invalid.' using errcode = '22023';
  end if;

  insert into public.crm_leads (
    tenant_id,
    public_site_lead_id,
    created_by,
    updated_by,
    assigned_to,
    assigned_role,
    name,
    email,
    phone,
    source,
    status,
    priority,
    interested_course_id,
    tags,
    metadata_json
  )
  values (
    site_lead.tenant_id,
    site_lead.id,
    actor_id,
    actor_id,
    final_assigned_to,
    final_assigned_role,
    public.validate_crm_text(site_lead.name, 'Lead name', true, 180),
    public.normalize_crm_email(site_lead.email),
    public.normalize_crm_phone(site_lead.phone),
    'public_site',
    'new',
    normalized_priority,
    site_lead.interested_course_id,
    public.normalize_crm_tags(p_tags),
    jsonb_build_object('public_site_lead_status', site_lead.status)
  )
  returning id into new_lead_id;

  perform public.insert_crm_activity(
    site_lead.tenant_id,
    new_lead_id,
    'crm_lead_imported_from_public_site',
    jsonb_build_object(
      'public_site_lead_id', site_lead.id,
      'assigned_to_present', final_assigned_to is not null,
      'assigned_role', final_assigned_role
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
    site_lead.tenant_id,
    actor_id,
    'crm_lead_imported_from_public_site',
    'crm_lead',
    new_lead_id,
    site_lead.name,
    'Public site lead imported into CRM.',
    'info',
    jsonb_build_object(
      'lead_id', new_lead_id,
      'public_site_lead_id', site_lead.id,
      'source', 'public_site',
      'assigned_to_present', final_assigned_to is not null,
      'assigned_role', final_assigned_role
    )
  );

  return new_lead_id;
end;
$$;

create or replace function public.update_crm_lead(
  p_lead_id uuid,
  p_status text default null,
  p_priority text default null,
  p_assigned_to uuid default null,
  p_assigned_role text default null,
  p_interested_course_id uuid default null,
  p_next_follow_up_at timestamptz default null,
  p_lost_reason text default null,
  p_tags text[] default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  lead_row public.crm_leads%rowtype;
  actor_role text;
  is_owner_admin boolean;
  new_status text;
  new_priority text;
  new_assigned_to uuid;
  new_assigned_role text;
  new_course_id uuid;
  status_changed boolean := false;
  assignment_changed boolean := false;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into lead_row
  from public.crm_leads
  where id = p_lead_id
  limit 1;

  if not found then
    raise exception 'CRM lead not found.' using errcode = '22023';
  end if;

  actor_role := public.crm_current_role(lead_row.tenant_id);
  is_owner_admin := coalesce(actor_role in ('owner', 'admin'), false);

  if actor_role is null or (not is_owner_admin and not coalesce(public.crm_lead_is_visible(p_lead_id), false)) then
    raise exception 'You do not have access to update this lead.' using errcode = '42501';
  end if;

  new_status := coalesce(nullif(lower(trim(coalesce(p_status, ''))), ''), lead_row.status);
  new_priority := coalesce(nullif(lower(trim(coalesce(p_priority, ''))), ''), lead_row.priority);
  new_assigned_to := lead_row.assigned_to;
  new_assigned_role := lead_row.assigned_role;
  new_course_id := coalesce(p_interested_course_id, lead_row.interested_course_id);

  if p_assigned_to is not null
     and nullif(lower(trim(coalesce(p_assigned_role, ''))), '') is not null then
    raise exception 'Use assigned_to or assigned_role, not both.' using errcode = '22023';
  end if;

  if new_status not in ('new', 'contacted', 'qualified', 'demo_scheduled', 'proposal_sent', 'follow_up', 'converted', 'lost', 'archived') then
    raise exception 'Lead status is invalid.' using errcode = '22023';
  end if;

  if new_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Lead priority is invalid.' using errcode = '22023';
  end if;

  if not is_owner_admin and new_status in ('converted', 'lost', 'archived') then
    raise exception 'Only owners and admins can mark leads converted, lost, or archived.' using errcode = '42501';
  end if;

  if new_course_id is not null and not exists (
    select 1
    from public.courses c
    where c.id = new_course_id
      and c.tenant_id = lead_row.tenant_id
  ) then
    raise exception 'Interested course is not in this tenant.' using errcode = '22023';
  end if;

  if is_owner_admin then
    if p_assigned_to is not null then
      if public.crm_user_role(lead_row.tenant_id, p_assigned_to) is null then
        raise exception 'Assigned user must belong to this tenant.' using errcode = '22023';
      end if;

      new_assigned_to := p_assigned_to;
      new_assigned_role := null;
    elsif nullif(lower(trim(coalesce(p_assigned_role, ''))), '') is not null then
      new_assigned_to := null;
      new_assigned_role := lower(trim(coalesce(p_assigned_role, '')));

      if new_assigned_role not in ('owner', 'admin', 'staff', 'trainer') then
        raise exception 'Assigned role is invalid.' using errcode = '22023';
      end if;
    end if;
  elsif p_assigned_to is not null or nullif(lower(trim(coalesce(p_assigned_role, ''))), '') is not null then
    raise exception 'Only owners and admins can reassign CRM leads.' using errcode = '42501';
  end if;

  status_changed := new_status is distinct from lead_row.status;
  assignment_changed :=
    new_assigned_to is distinct from lead_row.assigned_to
    or new_assigned_role is distinct from lead_row.assigned_role;

  update public.crm_leads
  set
    updated_by = actor_id,
    assigned_to = new_assigned_to,
    assigned_role = new_assigned_role,
    status = new_status,
    priority = new_priority,
    interested_course_id = new_course_id,
    next_follow_up_at = coalesce(p_next_follow_up_at, next_follow_up_at),
    lost_reason = case
      when new_status = 'lost' then public.validate_crm_text(p_lost_reason, 'Lost reason', false, 500)
      when new_status <> 'lost' then null
      else lost_reason
    end,
    last_contacted_at = case
      when new_status in ('contacted', 'qualified', 'demo_scheduled', 'proposal_sent', 'follow_up') then now()
      else last_contacted_at
    end,
    tags = case
      when p_tags is null then tags
      else public.normalize_crm_tags(p_tags)
    end,
    metadata_json = case
      when p_metadata_json is null then metadata_json
      else public.normalize_crm_metadata(p_metadata_json)
    end
  where id = p_lead_id;

  perform public.insert_crm_activity(
    lead_row.tenant_id,
    p_lead_id,
    'crm_lead_updated',
    jsonb_build_object(
      'old_status', lead_row.status,
      'new_status', new_status,
      'status_changed', status_changed,
      'assignment_changed', assignment_changed,
      'assigned_to_present', new_assigned_to is not null,
      'assigned_role', new_assigned_role,
      'interested_course_id', new_course_id
    )
  );

  if status_changed then
    perform public.insert_crm_activity(
      lead_row.tenant_id,
      p_lead_id,
      'crm_lead_status_changed',
      jsonb_build_object('old_status', lead_row.status, 'new_status', new_status)
    );
  end if;

  if assignment_changed then
    perform public.insert_crm_activity(
      lead_row.tenant_id,
      p_lead_id,
      'crm_lead_assigned',
      jsonb_build_object(
        'assigned_to_present', new_assigned_to is not null,
        'assigned_role', new_assigned_role
      )
    );
  end if;

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
    lead_row.tenant_id,
    actor_id,
    case
      when status_changed and new_status = 'converted' then 'crm_lead_marked_converted'
      when status_changed and new_status = 'lost' then 'crm_lead_marked_lost'
      when assignment_changed then 'crm_lead_assigned'
      when status_changed then 'crm_lead_status_changed'
      else 'crm_lead_updated'
    end,
    'crm_lead',
    p_lead_id,
    lead_row.name,
    'CRM lead updated.',
    case
      when new_status in ('converted', 'lost', 'archived') then 'warning'
      else 'info'
    end,
    jsonb_build_object(
      'lead_id', p_lead_id,
      'old_status', lead_row.status,
      'new_status', new_status,
      'assigned_to_present', new_assigned_to is not null,
      'assigned_role', new_assigned_role,
      'interested_course_id', new_course_id
    )
  );

  return p_lead_id;
end;
$$;

create or replace function public.add_crm_lead_note(
  p_lead_id uuid,
  p_note_type text default 'note',
  p_note text default null,
  p_is_private boolean default false,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  lead_row public.crm_leads%rowtype;
  actor_role text;
  normalized_note_type text := lower(trim(coalesce(p_note_type, 'note')));
  new_note_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into lead_row
  from public.crm_leads
  where id = p_lead_id
  limit 1;

  if not found then
    raise exception 'CRM lead not found.' using errcode = '22023';
  end if;

  actor_role := public.crm_current_role(lead_row.tenant_id);

  if actor_role is null or not coalesce(public.crm_lead_is_visible(p_lead_id), false) then
    raise exception 'You do not have access to add notes to this lead.' using errcode = '42501';
  end if;

  if normalized_note_type not in ('note', 'call', 'whatsapp', 'email', 'meeting', 'demo', 'system') then
    raise exception 'CRM note type is invalid.' using errcode = '22023';
  end if;

  insert into public.crm_lead_notes (
    tenant_id,
    lead_id,
    created_by,
    note_type,
    note,
    is_private,
    metadata_json
  )
  values (
    lead_row.tenant_id,
    p_lead_id,
    actor_id,
    normalized_note_type,
    public.validate_crm_text(p_note, 'CRM note', true, 2000),
    coalesce(p_is_private, false),
    public.normalize_crm_metadata(p_metadata_json)
  )
  returning id into new_note_id;

  perform public.insert_crm_activity(
    lead_row.tenant_id,
    p_lead_id,
    'crm_lead_note_added',
    jsonb_build_object(
      'note_id', new_note_id,
      'note_type', normalized_note_type,
      'is_private', coalesce(p_is_private, false)
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
    lead_row.tenant_id,
    actor_id,
    'crm_lead_note_added',
    'crm_lead_note',
    new_note_id,
    lead_row.name,
    'CRM lead note added.',
    'info',
    jsonb_build_object(
      'lead_id', p_lead_id,
      'note_id', new_note_id,
      'note_type', normalized_note_type,
      'is_private', coalesce(p_is_private, false)
    )
  );

  return new_note_id;
end;
$$;

create or replace function public.create_crm_follow_up_task(
  p_lead_id uuid,
  p_title text,
  p_description text default null,
  p_assigned_to uuid default null,
  p_assigned_role text default null,
  p_due_at timestamptz default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  lead_row public.crm_leads%rowtype;
  actor_role text;
  normalized_assigned_role text := nullif(lower(trim(coalesce(p_assigned_role, ''))), '');
  final_assigned_to uuid := p_assigned_to;
  final_assigned_role text := normalized_assigned_role;
  new_task_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into lead_row
  from public.crm_leads
  where id = p_lead_id
  limit 1;

  if not found then
    raise exception 'CRM lead not found.' using errcode = '22023';
  end if;

  actor_role := public.crm_current_role(lead_row.tenant_id);

  if actor_role is null or not coalesce(public.crm_lead_is_visible(p_lead_id), false) then
    raise exception 'You do not have access to create follow-up tasks for this lead.' using errcode = '42501';
  end if;

  if final_assigned_to is not null and final_assigned_role is not null then
    raise exception 'Use assigned_to or assigned_role, not both.' using errcode = '22023';
  end if;

  if final_assigned_to is not null and public.crm_user_role(lead_row.tenant_id, final_assigned_to) is null then
    raise exception 'Assigned user must belong to this tenant.' using errcode = '22023';
  end if;

  if final_assigned_role is not null and final_assigned_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'Assigned role is invalid.' using errcode = '22023';
  end if;

  if actor_role not in ('owner', 'admin') then
    if final_assigned_role is not null then
      raise exception 'Staff and trainers cannot create role-assigned follow-up tasks.'
        using errcode = '42501';
    end if;

    if final_assigned_to is not null and final_assigned_to <> actor_id then
      raise exception 'Staff and trainers can only assign follow-up tasks to themselves.'
        using errcode = '42501';
    end if;

    final_assigned_to := actor_id;
    final_assigned_role := null;
  end if;

  if final_assigned_to is null and final_assigned_role is null then
    final_assigned_to := lead_row.assigned_to;
    final_assigned_role := lead_row.assigned_role;
  end if;

  insert into public.crm_follow_up_tasks (
    tenant_id,
    lead_id,
    created_by,
    assigned_to,
    assigned_role,
    title,
    description,
    due_at,
    metadata_json
  )
  values (
    lead_row.tenant_id,
    p_lead_id,
    actor_id,
    final_assigned_to,
    final_assigned_role,
    public.validate_crm_text(p_title, 'Follow-up title', true, 180),
    public.validate_crm_text(p_description, 'Follow-up description', false, 1200),
    p_due_at,
    public.normalize_crm_metadata(p_metadata_json)
  )
  returning id into new_task_id;

  perform public.insert_crm_activity(
    lead_row.tenant_id,
    p_lead_id,
    'crm_follow_up_created',
    jsonb_build_object(
      'task_id', new_task_id,
      'assigned_to_present', final_assigned_to is not null,
      'assigned_role', final_assigned_role,
      'due_at', p_due_at
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
    lead_row.tenant_id,
    actor_id,
    'crm_follow_up_created',
    'crm_follow_up_task',
    new_task_id,
    public.validate_crm_text(p_title, 'Follow-up title', true, 180),
    'CRM follow-up task created.',
    'info',
    jsonb_build_object(
      'lead_id', p_lead_id,
      'task_id', new_task_id,
      'assigned_to_present', final_assigned_to is not null,
      'assigned_role', final_assigned_role
    )
  );

  return new_task_id;
end;
$$;

create or replace function public.update_crm_follow_up_task(
  p_task_id uuid,
  p_status text default null,
  p_title text default null,
  p_description text default null,
  p_due_at timestamptz default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  task_row public.crm_follow_up_tasks%rowtype;
  actor_role text;
  new_status text;
  can_update boolean := false;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into task_row
  from public.crm_follow_up_tasks
  where id = p_task_id
  limit 1;

  if not found then
    raise exception 'CRM follow-up task not found.' using errcode = '22023';
  end if;

  actor_role := public.crm_current_role(task_row.tenant_id);

  if actor_role in ('owner', 'admin') then
    can_update := true;
  elsif actor_role is not null then
    can_update :=
      (task_row.assigned_to is not null and task_row.assigned_to = actor_id)
      or (
        task_row.assigned_to is null
        and task_row.assigned_role is not null
        and task_row.assigned_role = actor_role
      );
  end if;

  if not coalesce(can_update, false) then
    raise exception 'You do not have access to update this follow-up task.' using errcode = '42501';
  end if;

  new_status := coalesce(nullif(lower(trim(coalesce(p_status, ''))), ''), task_row.status);

  if new_status not in ('pending', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Follow-up task status is invalid.' using errcode = '22023';
  end if;

  update public.crm_follow_up_tasks
  set
    status = new_status,
    title = coalesce(public.validate_crm_text(p_title, 'Follow-up title', false, 180), title),
    description = case
      when p_description is null then description
      else public.validate_crm_text(p_description, 'Follow-up description', false, 1200)
    end,
    due_at = coalesce(p_due_at, due_at),
    completed_by = case when new_status = 'completed' then actor_id else completed_by end,
    completed_at = case when new_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
    metadata_json = case
      when p_metadata_json is null then metadata_json
      else public.normalize_crm_metadata(p_metadata_json)
    end
  where id = p_task_id;

  perform public.insert_crm_activity(
    task_row.tenant_id,
    task_row.lead_id,
    'crm_follow_up_updated',
    jsonb_build_object(
      'task_id', p_task_id,
      'old_status', task_row.status,
      'new_status', new_status
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
    task_row.tenant_id,
    actor_id,
    'crm_follow_up_updated',
    'crm_follow_up_task',
    p_task_id,
    task_row.title,
    'CRM follow-up task updated.',
    'info',
    jsonb_build_object(
      'lead_id', task_row.lead_id,
      'task_id', p_task_id,
      'old_status', task_row.status,
      'new_status', new_status
    )
  );

  return p_task_id;
end;
$$;

revoke all on public.crm_leads from anon;
revoke all on public.crm_lead_notes from anon;
revoke all on public.crm_follow_up_tasks from anon;
revoke all on public.crm_activity_logs from anon;

revoke insert, update, delete on public.crm_leads from authenticated;
revoke insert, update, delete on public.crm_lead_notes from authenticated;
revoke insert, update, delete on public.crm_follow_up_tasks from authenticated;
revoke insert, update, delete on public.crm_activity_logs from authenticated;

grant select on public.crm_leads to authenticated;
grant select on public.crm_lead_notes to authenticated;
grant select on public.crm_follow_up_tasks to authenticated;
grant select on public.crm_activity_logs to authenticated;

revoke execute on function public.crm_user_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.crm_current_role(uuid) from public, anon;
revoke execute on function public.crm_is_owner_admin(uuid) from public, anon;
revoke execute on function public.crm_lead_is_visible(uuid) from public, anon;
revoke execute on function public.crm_follow_up_task_is_visible(uuid) from public, anon;
revoke execute on function public.validate_crm_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.normalize_crm_email(text) from public, anon, authenticated;
revoke execute on function public.normalize_crm_phone(text) from public, anon, authenticated;
revoke execute on function public.normalize_crm_metadata(jsonb) from public, anon, authenticated;
revoke execute on function public.normalize_crm_tags(text[]) from public, anon, authenticated;
revoke execute on function public.insert_crm_activity(uuid, uuid, text, jsonb) from public, anon, authenticated;

revoke execute on function public.create_crm_lead(uuid, text, text, text, text, text, uuid, uuid, text, text[], jsonb) from public, anon;
revoke execute on function public.create_crm_lead_from_public_site_lead(uuid, uuid, text, text, text[]) from public, anon;
revoke execute on function public.update_crm_lead(uuid, text, text, uuid, text, uuid, timestamptz, text, text[], jsonb) from public, anon;
revoke execute on function public.add_crm_lead_note(uuid, text, text, boolean, jsonb) from public, anon;
revoke execute on function public.create_crm_follow_up_task(uuid, text, text, uuid, text, timestamptz, jsonb) from public, anon;
revoke execute on function public.update_crm_follow_up_task(uuid, text, text, text, timestamptz, jsonb) from public, anon;

grant execute on function public.crm_current_role(uuid) to authenticated;
grant execute on function public.crm_is_owner_admin(uuid) to authenticated;
grant execute on function public.crm_lead_is_visible(uuid) to authenticated;
grant execute on function public.crm_follow_up_task_is_visible(uuid) to authenticated;

grant execute on function public.create_crm_lead(uuid, text, text, text, text, text, uuid, uuid, text, text[], jsonb) to authenticated;
grant execute on function public.create_crm_lead_from_public_site_lead(uuid, uuid, text, text, text[]) to authenticated;
grant execute on function public.update_crm_lead(uuid, text, text, uuid, text, uuid, timestamptz, text, text[], jsonb) to authenticated;
grant execute on function public.add_crm_lead_note(uuid, text, text, boolean, jsonb) to authenticated;
grant execute on function public.create_crm_follow_up_task(uuid, text, text, uuid, text, timestamptz, jsonb) to authenticated;
grant execute on function public.update_crm_follow_up_task(uuid, text, text, text, timestamptz, jsonb) to authenticated;
