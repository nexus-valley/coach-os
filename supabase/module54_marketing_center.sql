-- Module 54: Marketing Center
-- Campaign planning, template library, audience selection, and manual touch tracking.
-- No external message sending is implemented in this module.

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_role text check (assigned_role in ('owner', 'admin', 'staff', 'trainer')),
  name text not null,
  description text,
  campaign_type text not null default 'lead_nurture'
    check (campaign_type in ('lead_nurture', 'admission_drive', 'webinar', 'course_launch', 'reactivation', 'announcement', 'referral', 'other')),
  channel text not null default 'manual'
    check (channel in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'mixed', 'other')),
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'active', 'paused', 'completed', 'archived')),
  goal text,
  start_at timestamptz,
  end_at timestamptz,
  budget numeric check (budget is null or budget >= 0),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_campaigns_assignment_exclusive_chk check (not (assigned_to is not null and assigned_role is not null)),
  constraint marketing_campaigns_dates_chk check (start_at is null or end_at is null or start_at <= end_at),
  constraint marketing_campaigns_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint marketing_campaigns_metadata_size_chk check (length(metadata_json::text) <= 3000),
  constraint marketing_campaigns_name_safe_chk check (length(name) between 1 and 180 and name !~ '[<>]'),
  constraint marketing_campaigns_description_safe_chk check (description is null or (length(description) <= 1500 and description !~ '[<>]')),
  constraint marketing_campaigns_goal_safe_chk check (goal is null or (length(goal) <= 500 and goal !~ '[<>]'))
);

create index if not exists marketing_campaigns_tenant_created_at_idx
on public.marketing_campaigns (tenant_id, created_at desc);

create index if not exists marketing_campaigns_tenant_status_idx
on public.marketing_campaigns (tenant_id, status);

create index if not exists marketing_campaigns_tenant_assigned_to_idx
on public.marketing_campaigns (tenant_id, assigned_to);

create index if not exists marketing_campaigns_tenant_assigned_role_idx
on public.marketing_campaigns (tenant_id, assigned_role);

create table if not exists public.marketing_message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  name text not null,
  channel text not null
    check (channel in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'other')),
  template_type text not null default 'lead_nurture'
    check (template_type in ('lead_nurture', 'follow_up', 'webinar_invite', 'course_launch', 'reminder', 'announcement', 'referral', 'other')),
  subject text,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_templates_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint marketing_templates_metadata_size_chk check (length(metadata_json::text) <= 3000),
  constraint marketing_templates_name_safe_chk check (length(name) between 1 and 180 and name !~ '[<>]'),
  constraint marketing_templates_subject_safe_chk check (subject is null or (length(subject) <= 180 and subject !~ '[<>]')),
  constraint marketing_templates_body_safe_chk check (length(body) between 1 and 3000 and body !~ '[<>]')
);

create index if not exists marketing_templates_tenant_created_at_idx
on public.marketing_message_templates (tenant_id, created_at desc);

create index if not exists marketing_templates_tenant_status_idx
on public.marketing_message_templates (tenant_id, status);

create table if not exists public.marketing_campaign_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  status text not null default 'added'
    check (status in ('added', 'contacted', 'responded', 'interested', 'not_interested', 'converted', 'removed')),
  last_touch_at timestamptz,
  next_touch_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id),
  constraint marketing_campaign_leads_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint marketing_campaign_leads_metadata_size_chk check (length(metadata_json::text) <= 3000)
);

create index if not exists marketing_campaign_leads_tenant_campaign_idx
on public.marketing_campaign_leads (tenant_id, campaign_id, created_at desc);

create index if not exists marketing_campaign_leads_tenant_lead_idx
on public.marketing_campaign_leads (tenant_id, lead_id);

create table if not exists public.marketing_campaign_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  template_id uuid references public.marketing_message_templates(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  activity_type text not null
    check (activity_type in ('campaign_created', 'campaign_updated', 'campaign_status_changed', 'lead_added', 'lead_removed', 'lead_status_changed', 'template_created', 'template_updated', 'manual_touch_logged', 'planned_touch_created')),
  channel text
    check (channel is null or channel in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'mixed', 'other')),
  note text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint marketing_activities_metadata_object_chk check (jsonb_typeof(metadata_json) = 'object'),
  constraint marketing_activities_metadata_size_chk check (length(metadata_json::text) <= 3000),
  constraint marketing_activities_note_safe_chk check (note is null or (length(note) <= 1500 and note !~ '[<>]'))
);

create index if not exists marketing_activities_tenant_campaign_idx
on public.marketing_campaign_activities (tenant_id, campaign_id, created_at desc);

drop trigger if exists set_marketing_campaigns_updated_at on public.marketing_campaigns;
create trigger set_marketing_campaigns_updated_at
before update on public.marketing_campaigns
for each row execute function public.set_updated_at();

drop trigger if exists set_marketing_templates_updated_at on public.marketing_message_templates;
create trigger set_marketing_templates_updated_at
before update on public.marketing_message_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_marketing_campaign_leads_updated_at on public.marketing_campaign_leads;
create trigger set_marketing_campaign_leads_updated_at
before update on public.marketing_campaign_leads
for each row execute function public.set_updated_at();

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_message_templates enable row level security;
alter table public.marketing_campaign_leads enable row level security;
alter table public.marketing_campaign_activities enable row level security;

create or replace function public.marketing_user_role(check_tenant_id uuid, check_user_id uuid)
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

create or replace function public.marketing_current_member_role(check_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.marketing_user_role(check_tenant_id, auth.uid());
$$;

create or replace function public.marketing_is_owner_admin(check_tenant_id uuid)
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

  current_member_role := public.marketing_current_member_role(check_tenant_id);
  return coalesce(current_member_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.marketing_campaign_is_visible(check_campaign_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  campaign_row public.marketing_campaigns%rowtype;
  current_member_role text;
  actor_id uuid := auth.uid();
begin
  if actor_id is null or check_campaign_id is null then
    return false;
  end if;

  select *
  into campaign_row
  from public.marketing_campaigns
  where id = check_campaign_id
  limit 1;

  if not found then
    return false;
  end if;

  current_member_role := public.marketing_current_member_role(campaign_row.tenant_id);

  if current_member_role is null then
    return false;
  end if;

  if current_member_role in ('owner', 'admin') then
    return true;
  end if;

  if campaign_row.assigned_to is not null and campaign_row.assigned_to = actor_id then
    return true;
  end if;

  if campaign_row.assigned_to is null
     and campaign_row.assigned_role is not null
     and campaign_row.assigned_role = current_member_role then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.marketing_template_is_visible(check_template_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  template_row public.marketing_message_templates%rowtype;
  current_member_role text;
  actor_id uuid := auth.uid();
begin
  if actor_id is null or check_template_id is null then
    return false;
  end if;

  select *
  into template_row
  from public.marketing_message_templates
  where id = check_template_id
  limit 1;

  if not found then
    return false;
  end if;

  current_member_role := public.marketing_current_member_role(template_row.tenant_id);

  if current_member_role is null then
    return false;
  end if;

  if current_member_role in ('owner', 'admin') then
    return true;
  end if;

  return template_row.status = 'active';
end;
$$;

create or replace function public.marketing_campaign_lead_is_visible(check_campaign_lead_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  campaign_lead_row public.marketing_campaign_leads%rowtype;
begin
  if auth.uid() is null or check_campaign_lead_id is null then
    return false;
  end if;

  select *
  into campaign_lead_row
  from public.marketing_campaign_leads
  where id = check_campaign_lead_id
  limit 1;

  if not found then
    return false;
  end if;

  if public.marketing_is_owner_admin(campaign_lead_row.tenant_id) then
    return true;
  end if;

  return coalesce(public.marketing_campaign_is_visible(campaign_lead_row.campaign_id), false)
    and coalesce(public.crm_lead_is_visible(campaign_lead_row.lead_id), false);
end;
$$;

create or replace function public.validate_marketing_text(
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

create or replace function public.normalize_marketing_metadata(input_value jsonb)
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

create or replace function public.insert_marketing_activity(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_lead_id uuid,
  p_template_id uuid,
  p_activity_type text,
  p_channel text default null,
  p_note text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_activity_type text := lower(trim(coalesce(p_activity_type, '')));
  normalized_channel text := nullif(lower(trim(coalesce(p_channel, ''))), '');
  created_id uuid;
begin
  if normalized_activity_type not in ('campaign_created', 'campaign_updated', 'campaign_status_changed', 'lead_added', 'lead_removed', 'lead_status_changed', 'template_created', 'template_updated', 'manual_touch_logged', 'planned_touch_created') then
    raise exception 'Marketing activity type is invalid.' using errcode = '22023';
  end if;

  if normalized_channel is not null and normalized_channel not in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'mixed', 'other') then
    raise exception 'Marketing activity channel is invalid.' using errcode = '22023';
  end if;

  insert into public.marketing_campaign_activities (
    tenant_id,
    campaign_id,
    lead_id,
    template_id,
    actor_id,
    activity_type,
    channel,
    note,
    metadata_json
  )
  values (
    p_tenant_id,
    p_campaign_id,
    p_lead_id,
    p_template_id,
    auth.uid(),
    normalized_activity_type,
    normalized_channel,
    public.validate_marketing_text(p_note, 'Marketing activity note', false, 1500),
    public.normalize_marketing_metadata(p_metadata_json)
  )
  returning id into created_id;

  return created_id;
end;
$$;

drop policy if exists "Marketing campaigns visible by assignment" on public.marketing_campaigns;
create policy "Marketing campaigns visible by assignment"
on public.marketing_campaigns
for select
to authenticated
using (public.marketing_campaign_is_visible(id));

drop policy if exists "Marketing templates visible by role" on public.marketing_message_templates;
create policy "Marketing templates visible by role"
on public.marketing_message_templates
for select
to authenticated
using (public.marketing_template_is_visible(id));

drop policy if exists "Marketing campaign leads visible by campaign and CRM lead" on public.marketing_campaign_leads;
create policy "Marketing campaign leads visible by campaign and CRM lead"
on public.marketing_campaign_leads
for select
to authenticated
using (public.marketing_campaign_lead_is_visible(id));

drop policy if exists "Marketing activity visible by campaign and CRM lead" on public.marketing_campaign_activities;
create policy "Marketing activity visible by campaign and CRM lead"
on public.marketing_campaign_activities
for select
to authenticated
using (
  public.marketing_is_owner_admin(tenant_id)
  or (
    campaign_id is not null
    and public.marketing_campaign_is_visible(campaign_id)
    and (lead_id is null or public.crm_lead_is_visible(lead_id))
  )
);

create or replace function public.create_marketing_campaign(
  p_tenant_id uuid,
  p_name text,
  p_description text default null,
  p_campaign_type text default 'lead_nurture',
  p_channel text default 'manual',
  p_assigned_to uuid default null,
  p_assigned_role text default null,
  p_goal text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_budget numeric default null,
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
  normalized_type text := lower(trim(coalesce(p_campaign_type, 'lead_nurture')));
  normalized_channel text := lower(trim(coalesce(p_channel, 'manual')));
  normalized_assigned_role text := nullif(lower(trim(coalesce(p_assigned_role, ''))), '');
  final_assigned_to uuid := p_assigned_to;
  final_assigned_role text := normalized_assigned_role;
  new_campaign_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  actor_role := public.marketing_current_member_role(p_tenant_id);

  if actor_role is null then
    raise exception 'Marketing access requires a tenant team member.' using errcode = '42501';
  end if;

  if p_assigned_to is not null and normalized_assigned_role is not null then
    raise exception 'Use assigned_to or assigned_role, not both.' using errcode = '22023';
  end if;

  if normalized_type not in ('lead_nurture', 'admission_drive', 'webinar', 'course_launch', 'reactivation', 'announcement', 'referral', 'other') then
    raise exception 'Campaign type is invalid.' using errcode = '22023';
  end if;

  if normalized_channel not in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'mixed', 'other') then
    raise exception 'Campaign channel is invalid.' using errcode = '22023';
  end if;

  if p_budget is not null and p_budget < 0 then
    raise exception 'Budget must be non-negative.' using errcode = '22023';
  end if;

  if p_start_at is not null and p_end_at is not null and p_start_at > p_end_at then
    raise exception 'Campaign start must be before end.' using errcode = '22023';
  end if;

  if final_assigned_to is not null and public.marketing_user_role(p_tenant_id, final_assigned_to) is null then
    raise exception 'Assigned user must belong to this tenant.' using errcode = '22023';
  end if;

  if final_assigned_role is not null and final_assigned_role not in ('owner', 'admin', 'staff', 'trainer') then
    raise exception 'Assigned role is invalid.' using errcode = '22023';
  end if;

  if actor_role is null or actor_role not in ('owner', 'admin') then
    if final_assigned_role is not null then
      raise exception 'Staff and trainers cannot create role-assigned marketing campaigns.' using errcode = '42501';
    end if;

    if final_assigned_to is not null and final_assigned_to <> actor_id then
      raise exception 'Staff and trainers can only create self-assigned marketing campaign drafts.' using errcode = '42501';
    end if;

    final_assigned_to := actor_id;
    final_assigned_role := null;
  elsif final_assigned_to is null and final_assigned_role is null then
    final_assigned_role := 'owner';
  end if;

  insert into public.marketing_campaigns (
    tenant_id,
    created_by,
    updated_by,
    assigned_to,
    assigned_role,
    name,
    description,
    campaign_type,
    channel,
    status,
    goal,
    start_at,
    end_at,
    budget,
    metadata_json
  )
  values (
    p_tenant_id,
    actor_id,
    actor_id,
    final_assigned_to,
    final_assigned_role,
    public.validate_marketing_text(p_name, 'Campaign name', true, 180),
    public.validate_marketing_text(p_description, 'Campaign description', false, 1500),
    normalized_type,
    normalized_channel,
    'draft',
    public.validate_marketing_text(p_goal, 'Campaign goal', false, 500),
    p_start_at,
    p_end_at,
    p_budget,
    public.normalize_marketing_metadata(p_metadata_json)
  )
  returning id into new_campaign_id;

  perform public.insert_marketing_activity(
    p_tenant_id,
    new_campaign_id,
    null,
    null,
    'campaign_created',
    normalized_channel,
    null,
    jsonb_build_object(
      'campaign_type', normalized_type,
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
    p_tenant_id,
    actor_id,
    'marketing_campaign_created',
    'marketing_campaign',
    new_campaign_id,
    public.validate_marketing_text(p_name, 'Campaign name', true, 180),
    'Marketing campaign created.',
    'info',
    jsonb_build_object(
      'campaign_id', new_campaign_id,
      'campaign_type', normalized_type,
      'channel', normalized_channel,
      'assigned_to_present', final_assigned_to is not null,
      'assigned_role', final_assigned_role
    )
  );

  return new_campaign_id;
end;
$$;

create or replace function public.update_marketing_campaign(
  p_campaign_id uuid,
  p_name text default null,
  p_description text default null,
  p_status text default null,
  p_campaign_type text default null,
  p_channel text default null,
  p_assigned_to uuid default null,
  p_assigned_role text default null,
  p_goal text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_budget numeric default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  campaign_row public.marketing_campaigns%rowtype;
  actor_role text;
  is_owner_admin boolean;
  new_status text;
  new_type text;
  new_channel text;
  new_assigned_to uuid;
  new_assigned_role text;
  status_changed boolean;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into campaign_row
  from public.marketing_campaigns
  where id = p_campaign_id
  limit 1;

  if not found then
    raise exception 'Marketing campaign not found.' using errcode = '22023';
  end if;

  actor_role := public.marketing_current_member_role(campaign_row.tenant_id);
  is_owner_admin := coalesce(actor_role in ('owner', 'admin'), false);

  if actor_role is null or (not is_owner_admin and not coalesce(public.marketing_campaign_is_visible(p_campaign_id), false)) then
    raise exception 'You do not have access to update this campaign.' using errcode = '42501';
  end if;

  if p_assigned_to is not null and nullif(lower(trim(coalesce(p_assigned_role, ''))), '') is not null then
    raise exception 'Use assigned_to or assigned_role, not both.' using errcode = '22023';
  end if;

  new_status := coalesce(nullif(lower(trim(coalesce(p_status, ''))), ''), campaign_row.status);
  new_type := coalesce(nullif(lower(trim(coalesce(p_campaign_type, ''))), ''), campaign_row.campaign_type);
  new_channel := coalesce(nullif(lower(trim(coalesce(p_channel, ''))), ''), campaign_row.channel);
  new_assigned_to := campaign_row.assigned_to;
  new_assigned_role := campaign_row.assigned_role;

  if new_status not in ('draft', 'planned', 'active', 'paused', 'completed', 'archived') then
    raise exception 'Campaign status is invalid.' using errcode = '22023';
  end if;

  if new_type not in ('lead_nurture', 'admission_drive', 'webinar', 'course_launch', 'reactivation', 'announcement', 'referral', 'other') then
    raise exception 'Campaign type is invalid.' using errcode = '22023';
  end if;

  if new_channel not in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'mixed', 'other') then
    raise exception 'Campaign channel is invalid.' using errcode = '22023';
  end if;

  if not is_owner_admin and new_status in ('completed', 'archived') then
    raise exception 'Only owners and admins can complete or archive marketing campaigns.' using errcode = '42501';
  end if;

  if not is_owner_admin and new_status is distinct from campaign_row.status then
    raise exception 'Only owners and admins can change marketing campaign lifecycle status.' using errcode = '42501';
  end if;

  if p_budget is not null and p_budget < 0 then
    raise exception 'Budget must be non-negative.' using errcode = '22023';
  end if;

  if coalesce(p_start_at, campaign_row.start_at) is not null
     and coalesce(p_end_at, campaign_row.end_at) is not null
     and coalesce(p_start_at, campaign_row.start_at) > coalesce(p_end_at, campaign_row.end_at) then
    raise exception 'Campaign start must be before end.' using errcode = '22023';
  end if;

  if is_owner_admin then
    if p_assigned_to is not null then
      if public.marketing_user_role(campaign_row.tenant_id, p_assigned_to) is null then
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
    raise exception 'Only owners and admins can reassign marketing campaigns.' using errcode = '42501';
  end if;

  status_changed := new_status is distinct from campaign_row.status;

  update public.marketing_campaigns
  set
    updated_by = actor_id,
    assigned_to = new_assigned_to,
    assigned_role = new_assigned_role,
    name = coalesce(public.validate_marketing_text(p_name, 'Campaign name', false, 180), name),
    description = case
      when p_description is null then description
      else public.validate_marketing_text(p_description, 'Campaign description', false, 1500)
    end,
    status = new_status,
    campaign_type = new_type,
    channel = new_channel,
    goal = case
      when p_goal is null then goal
      else public.validate_marketing_text(p_goal, 'Campaign goal', false, 500)
    end,
    start_at = coalesce(p_start_at, start_at),
    end_at = coalesce(p_end_at, end_at),
    budget = coalesce(p_budget, budget),
    metadata_json = case
      when p_metadata_json is null then metadata_json
      else public.normalize_marketing_metadata(p_metadata_json)
    end
  where id = p_campaign_id;

  perform public.insert_marketing_activity(
    campaign_row.tenant_id,
    p_campaign_id,
    null,
    null,
    case when status_changed then 'campaign_status_changed' else 'campaign_updated' end,
    new_channel,
    null,
    jsonb_build_object(
      'old_status', campaign_row.status,
      'new_status', new_status,
      'campaign_type', new_type,
      'assigned_to_present', new_assigned_to is not null,
      'assigned_role', new_assigned_role
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
    campaign_row.tenant_id,
    actor_id,
    case
      when status_changed and new_status = 'archived' then 'marketing_campaign_archived'
      when status_changed then 'marketing_campaign_status_changed'
      else 'marketing_campaign_updated'
    end,
    'marketing_campaign',
    p_campaign_id,
    campaign_row.name,
    'Marketing campaign updated.',
    case when new_status in ('completed', 'archived') then 'warning' else 'info' end,
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'campaign_type', new_type,
      'channel', new_channel,
      'old_status', campaign_row.status,
      'new_status', new_status,
      'assigned_to_present', new_assigned_to is not null,
      'assigned_role', new_assigned_role
    )
  );

  return p_campaign_id;
end;
$$;

create or replace function public.create_marketing_template(
  p_tenant_id uuid,
  p_name text,
  p_channel text,
  p_template_type text default 'lead_nurture',
  p_subject text default null,
  p_body text default null,
  p_status text default 'draft',
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
  normalized_channel text := lower(trim(coalesce(p_channel, 'manual')));
  normalized_type text := lower(trim(coalesce(p_template_type, 'lead_nurture')));
  normalized_status text := lower(trim(coalesce(p_status, 'draft')));
  new_template_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  actor_role := public.marketing_current_member_role(p_tenant_id);

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can create marketing templates.' using errcode = '42501';
  end if;

  if normalized_channel not in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'other') then
    raise exception 'Template channel is invalid.' using errcode = '22023';
  end if;

  if normalized_type not in ('lead_nurture', 'follow_up', 'webinar_invite', 'course_launch', 'reminder', 'announcement', 'referral', 'other') then
    raise exception 'Template type is invalid.' using errcode = '22023';
  end if;

  if normalized_status not in ('draft', 'active', 'archived') then
    raise exception 'Template status is invalid.' using errcode = '22023';
  end if;

  insert into public.marketing_message_templates (
    tenant_id,
    created_by,
    updated_by,
    name,
    channel,
    template_type,
    subject,
    body,
    status,
    metadata_json
  )
  values (
    p_tenant_id,
    actor_id,
    actor_id,
    public.validate_marketing_text(p_name, 'Template name', true, 180),
    normalized_channel,
    normalized_type,
    public.validate_marketing_text(p_subject, 'Template subject', false, 180),
    public.validate_marketing_text(p_body, 'Template body', true, 3000),
    normalized_status,
    public.normalize_marketing_metadata(p_metadata_json)
  )
  returning id into new_template_id;

  perform public.insert_marketing_activity(
    p_tenant_id,
    null,
    null,
    new_template_id,
    'template_created',
    normalized_channel,
    null,
    jsonb_build_object('template_type', normalized_type, 'status', normalized_status)
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
    'marketing_template_created',
    'marketing_template',
    new_template_id,
    public.validate_marketing_text(p_name, 'Template name', true, 180),
    'Marketing template created.',
    'info',
    jsonb_build_object(
      'template_id', new_template_id,
      'template_type', normalized_type,
      'channel', normalized_channel,
      'status', normalized_status
    )
  );

  return new_template_id;
end;
$$;

create or replace function public.update_marketing_template(
  p_template_id uuid,
  p_name text default null,
  p_channel text default null,
  p_template_type text default null,
  p_subject text default null,
  p_body text default null,
  p_status text default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  template_row public.marketing_message_templates%rowtype;
  actor_role text;
  new_channel text;
  new_type text;
  new_status text;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into template_row
  from public.marketing_message_templates
  where id = p_template_id
  limit 1;

  if not found then
    raise exception 'Marketing template not found.' using errcode = '22023';
  end if;

  actor_role := public.marketing_current_member_role(template_row.tenant_id);

  if actor_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can update marketing templates.' using errcode = '42501';
  end if;

  new_channel := coalesce(nullif(lower(trim(coalesce(p_channel, ''))), ''), template_row.channel);
  new_type := coalesce(nullif(lower(trim(coalesce(p_template_type, ''))), ''), template_row.template_type);
  new_status := coalesce(nullif(lower(trim(coalesce(p_status, ''))), ''), template_row.status);

  if new_channel not in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'other') then
    raise exception 'Template channel is invalid.' using errcode = '22023';
  end if;

  if new_type not in ('lead_nurture', 'follow_up', 'webinar_invite', 'course_launch', 'reminder', 'announcement', 'referral', 'other') then
    raise exception 'Template type is invalid.' using errcode = '22023';
  end if;

  if new_status not in ('draft', 'active', 'archived') then
    raise exception 'Template status is invalid.' using errcode = '22023';
  end if;

  update public.marketing_message_templates
  set
    updated_by = actor_id,
    name = coalesce(public.validate_marketing_text(p_name, 'Template name', false, 180), name),
    channel = new_channel,
    template_type = new_type,
    subject = case
      when p_subject is null then subject
      else public.validate_marketing_text(p_subject, 'Template subject', false, 180)
    end,
    body = coalesce(public.validate_marketing_text(p_body, 'Template body', false, 3000), body),
    status = new_status,
    metadata_json = case
      when p_metadata_json is null then metadata_json
      else public.normalize_marketing_metadata(p_metadata_json)
    end
  where id = p_template_id;

  perform public.insert_marketing_activity(
    template_row.tenant_id,
    null,
    null,
    p_template_id,
    'template_updated',
    new_channel,
    null,
    jsonb_build_object('template_type', new_type, 'old_status', template_row.status, 'new_status', new_status)
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
    case when new_status = 'archived' and template_row.status <> 'archived' then 'marketing_template_archived' else 'marketing_template_updated' end,
    'marketing_template',
    p_template_id,
    template_row.name,
    'Marketing template updated.',
    case when new_status = 'archived' then 'warning' else 'info' end,
    jsonb_build_object(
      'template_id', p_template_id,
      'template_type', new_type,
      'channel', new_channel,
      'old_status', template_row.status,
      'new_status', new_status
    )
  );

  return p_template_id;
end;
$$;

create or replace function public.add_leads_to_marketing_campaign(
  p_campaign_id uuid,
  p_lead_ids uuid[],
  p_next_touch_at timestamptz default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  campaign_row public.marketing_campaigns%rowtype;
  actor_role text;
  lead_id_item uuid;
  inserted_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_lead_ids is null or cardinality(p_lead_ids) = 0 then
    raise exception 'At least one lead is required.' using errcode = '22023';
  end if;

  if cardinality(p_lead_ids) > 200 then
    raise exception 'At most 200 leads can be added at once.' using errcode = '22023';
  end if;

  select *
  into campaign_row
  from public.marketing_campaigns
  where id = p_campaign_id
  limit 1;

  if not found then
    raise exception 'Marketing campaign not found.' using errcode = '22023';
  end if;

  actor_role := public.marketing_current_member_role(campaign_row.tenant_id);

  if actor_role is null or not coalesce(public.marketing_campaign_is_visible(p_campaign_id), false) then
    raise exception 'You do not have access to add leads to this campaign.' using errcode = '42501';
  end if;

  if campaign_row.status in ('completed', 'archived') then
    raise exception 'Completed or archived campaigns cannot be changed.' using errcode = '42501';
  end if;

  foreach lead_id_item in array p_lead_ids loop
    if not exists (
      select 1
      from public.crm_leads cl
      where cl.id = lead_id_item
        and cl.tenant_id = campaign_row.tenant_id
    ) then
      raise exception 'Campaign lead is not in this tenant.' using errcode = '22023';
    end if;

    if actor_role not in ('owner', 'admin')
       and not coalesce(public.crm_lead_is_visible(lead_id_item), false) then
      raise exception 'You can only add CRM leads visible to you.' using errcode = '42501';
    end if;

    insert into public.marketing_campaign_leads (
      tenant_id,
      campaign_id,
      lead_id,
      added_by,
      next_touch_at,
      metadata_json
    )
    values (
      campaign_row.tenant_id,
      p_campaign_id,
      lead_id_item,
      actor_id,
      p_next_touch_at,
      public.normalize_marketing_metadata(p_metadata_json)
    )
    on conflict (campaign_id, lead_id) do nothing;

    if found then
      inserted_count := inserted_count + 1;

      perform public.insert_marketing_activity(
        campaign_row.tenant_id,
        p_campaign_id,
        lead_id_item,
        null,
        'lead_added',
        campaign_row.channel,
        null,
        jsonb_build_object('campaign_id', p_campaign_id)
      );
    end if;
  end loop;

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
    campaign_row.tenant_id,
    actor_id,
    'marketing_campaign_leads_added',
    'marketing_campaign',
    p_campaign_id,
    campaign_row.name,
    'CRM leads added to marketing campaign.',
    'info',
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'lead_count', inserted_count,
      'channel', campaign_row.channel,
      'campaign_type', campaign_row.campaign_type
    )
  );

  return inserted_count;
end;
$$;

create or replace function public.update_marketing_campaign_lead(
  p_campaign_lead_id uuid,
  p_status text default null,
  p_last_touch_at timestamptz default null,
  p_next_touch_at timestamptz default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  campaign_lead_row public.marketing_campaign_leads%rowtype;
  campaign_row public.marketing_campaigns%rowtype;
  new_status text;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into campaign_lead_row
  from public.marketing_campaign_leads
  where id = p_campaign_lead_id
  limit 1;

  if not found then
    raise exception 'Marketing campaign lead not found.' using errcode = '22023';
  end if;

  if not coalesce(public.marketing_campaign_lead_is_visible(p_campaign_lead_id), false) then
    raise exception 'You do not have access to update this campaign lead.' using errcode = '42501';
  end if;

  select *
  into campaign_row
  from public.marketing_campaigns
  where id = campaign_lead_row.campaign_id
  limit 1;

  if not found then
    raise exception 'Marketing campaign not found.' using errcode = '22023';
  end if;

  if campaign_row.status in ('completed', 'archived') then
    raise exception 'Completed or archived campaigns cannot be changed.' using errcode = '42501';
  end if;

  new_status := coalesce(nullif(lower(trim(coalesce(p_status, ''))), ''), campaign_lead_row.status);

  if new_status not in ('added', 'contacted', 'responded', 'interested', 'not_interested', 'converted', 'removed') then
    raise exception 'Campaign lead status is invalid.' using errcode = '22023';
  end if;

  update public.marketing_campaign_leads
  set
    status = new_status,
    last_touch_at = coalesce(p_last_touch_at, last_touch_at),
    next_touch_at = coalesce(p_next_touch_at, next_touch_at),
    metadata_json = case
      when p_metadata_json is null then metadata_json
      else public.normalize_marketing_metadata(p_metadata_json)
    end
  where id = p_campaign_lead_id;

  perform public.insert_marketing_activity(
    campaign_lead_row.tenant_id,
    campaign_lead_row.campaign_id,
    campaign_lead_row.lead_id,
    null,
    'lead_status_changed',
    campaign_row.channel,
    null,
    jsonb_build_object('old_status', campaign_lead_row.status, 'new_status', new_status)
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
    campaign_lead_row.tenant_id,
    actor_id,
    'marketing_campaign_lead_updated',
    'marketing_campaign_lead',
    p_campaign_lead_id,
    campaign_row.name,
    'Marketing campaign lead updated.',
    'info',
    jsonb_build_object(
      'campaign_id', campaign_lead_row.campaign_id,
      'old_status', campaign_lead_row.status,
      'new_status', new_status
    )
  );

  return p_campaign_lead_id;
end;
$$;

create or replace function public.log_marketing_touch(
  p_campaign_id uuid,
  p_lead_id uuid,
  p_template_id uuid default null,
  p_channel text default 'manual',
  p_note text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  campaign_row public.marketing_campaigns%rowtype;
  template_row public.marketing_message_templates%rowtype;
  actor_role text;
  normalized_channel text := lower(trim(coalesce(p_channel, 'manual')));
  activity_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into campaign_row
  from public.marketing_campaigns
  where id = p_campaign_id
  limit 1;

  if not found then
    raise exception 'Marketing campaign not found.' using errcode = '22023';
  end if;

  actor_role := public.marketing_current_member_role(campaign_row.tenant_id);

  if campaign_row.status in ('completed', 'archived') then
    raise exception 'Completed or archived campaigns cannot be changed.' using errcode = '42501';
  end if;

  if not coalesce(public.marketing_campaign_is_visible(p_campaign_id), false)
     or not coalesce(public.crm_lead_is_visible(p_lead_id), false) then
    raise exception 'You do not have access to log this campaign touch.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.marketing_campaign_leads mcl
    where mcl.campaign_id = p_campaign_id
      and mcl.lead_id = p_lead_id
      and mcl.tenant_id = campaign_row.tenant_id
  ) then
    raise exception 'Lead is not part of this campaign.' using errcode = '22023';
  end if;

  if p_template_id is not null then
    select *
    into template_row
    from public.marketing_message_templates
    where id = p_template_id
    limit 1;

    if not found or template_row.tenant_id <> campaign_row.tenant_id then
      raise exception 'Template is not in this tenant.' using errcode = '22023';
    end if;

    if template_row.status <> 'active' then
      raise exception 'Only active marketing templates can be used for touch logging.' using errcode = '42501';
    end if;

    if (actor_role is null or actor_role not in ('owner', 'admin'))
       and not coalesce(public.marketing_template_is_visible(p_template_id), false) then
      raise exception 'You do not have access to use this marketing template.' using errcode = '42501';
    end if;
  end if;

  if normalized_channel not in ('manual', 'whatsapp', 'email', 'sms', 'phone', 'in_app', 'mixed', 'other') then
    raise exception 'Marketing touch channel is invalid.' using errcode = '22023';
  end if;

  activity_id := public.insert_marketing_activity(
    campaign_row.tenant_id,
    p_campaign_id,
    p_lead_id,
    p_template_id,
    'manual_touch_logged',
    normalized_channel,
    p_note,
    public.normalize_marketing_metadata(p_metadata_json)
  );

  update public.marketing_campaign_leads
  set last_touch_at = now()
  where campaign_id = p_campaign_id
    and lead_id = p_lead_id
    and tenant_id = campaign_row.tenant_id;

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
    campaign_row.tenant_id,
    actor_id,
    'marketing_touch_logged',
    'marketing_campaign',
    p_campaign_id,
    campaign_row.name,
    'Marketing touch logged. No external message was sent.',
    'info',
    jsonb_build_object(
      'campaign_id', p_campaign_id,
      'template_id', p_template_id,
      'channel', normalized_channel
    )
  );

  return activity_id;
end;
$$;

revoke all on public.marketing_campaigns from anon;
revoke all on public.marketing_message_templates from anon;
revoke all on public.marketing_campaign_leads from anon;
revoke all on public.marketing_campaign_activities from anon;

revoke insert, update, delete on public.marketing_campaigns from authenticated;
revoke insert, update, delete on public.marketing_message_templates from authenticated;
revoke insert, update, delete on public.marketing_campaign_leads from authenticated;
revoke insert, update, delete on public.marketing_campaign_activities from authenticated;

grant select on public.marketing_campaigns to authenticated;
grant select on public.marketing_message_templates to authenticated;
grant select on public.marketing_campaign_leads to authenticated;
grant select on public.marketing_campaign_activities to authenticated;

revoke execute on function public.marketing_user_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.marketing_current_member_role(uuid) from public, anon;
revoke execute on function public.marketing_is_owner_admin(uuid) from public, anon;
revoke execute on function public.marketing_campaign_is_visible(uuid) from public, anon;
revoke execute on function public.marketing_template_is_visible(uuid) from public, anon;
revoke execute on function public.marketing_campaign_lead_is_visible(uuid) from public, anon;
revoke execute on function public.validate_marketing_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.normalize_marketing_metadata(jsonb) from public, anon, authenticated;
revoke execute on function public.insert_marketing_activity(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

revoke execute on function public.create_marketing_campaign(uuid, text, text, text, text, uuid, text, text, timestamptz, timestamptz, numeric, jsonb) from public, anon;
revoke execute on function public.update_marketing_campaign(uuid, text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, numeric, jsonb) from public, anon;
revoke execute on function public.create_marketing_template(uuid, text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.update_marketing_template(uuid, text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.add_leads_to_marketing_campaign(uuid, uuid[], timestamptz, jsonb) from public, anon;
revoke execute on function public.update_marketing_campaign_lead(uuid, text, timestamptz, timestamptz, jsonb) from public, anon;
revoke execute on function public.log_marketing_touch(uuid, uuid, uuid, text, text, jsonb) from public, anon;

grant execute on function public.marketing_current_member_role(uuid) to authenticated;
grant execute on function public.marketing_is_owner_admin(uuid) to authenticated;
grant execute on function public.marketing_campaign_is_visible(uuid) to authenticated;
grant execute on function public.marketing_template_is_visible(uuid) to authenticated;
grant execute on function public.marketing_campaign_lead_is_visible(uuid) to authenticated;

grant execute on function public.create_marketing_campaign(uuid, text, text, text, text, uuid, text, text, timestamptz, timestamptz, numeric, jsonb) to authenticated;
grant execute on function public.update_marketing_campaign(uuid, text, text, text, text, text, uuid, text, text, timestamptz, timestamptz, numeric, jsonb) to authenticated;
grant execute on function public.create_marketing_template(uuid, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.update_marketing_template(uuid, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.add_leads_to_marketing_campaign(uuid, uuid[], timestamptz, jsonb) to authenticated;
grant execute on function public.update_marketing_campaign_lead(uuid, text, timestamptz, timestamptz, jsonb) to authenticated;
grant execute on function public.log_marketing_touch(uuid, uuid, uuid, text, text, jsonb) to authenticated;
