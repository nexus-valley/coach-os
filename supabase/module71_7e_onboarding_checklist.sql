-- Module 71.7E: Platform-Guided Academy Onboarding Checklist
--
-- Phase 1 adds durable checklist tracking only. It does not automate tenant
-- setup, student portal account provisioning, finance setup, feature flags,
-- payment gateway setup, or public signup.
--
-- Security posture:
-- - Browser/client direct writes are revoked.
-- - Reads are authenticated-only and scoped by RLS.
-- - Mutations go through SECURITY DEFINER RPCs with tenant/platform checks.
-- - Metadata is bounded and must not contain secrets, OTPs, raw invite tokens,
--   signed URLs, private storage paths, or credentials.

begin;

create table if not exists public.tenant_onboarding_checklists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  status text not null default 'not_started',
  platform_approval_status text not null default 'not_requested',
  launch_ready_at timestamptz,
  platform_approved_at timestamptz,
  platform_approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_onboarding_checklists_status_check check (
    status in (
      'not_started',
      'in_progress',
      'ready_for_review',
      'approved',
      'blocked',
      'deferred'
    )
  ),
  constraint tenant_onboarding_checklists_approval_status_check check (
    platform_approval_status in (
      'not_requested',
      'pending_review',
      'approved',
      'changes_requested'
    )
  ),
  constraint tenant_onboarding_checklists_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  )
);

create table if not exists public.tenant_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checklist_id uuid not null references public.tenant_onboarding_checklists(id) on delete cascade,
  step_key text not null,
  title text not null,
  description text,
  owner_scope text not null,
  onboarding_phase text not null default 'progressive_setup',
  blocking_level text not null default 'recommended',
  editability_policy text not null default 'editable_anytime',
  status text not null default 'pending',
  applicability_status text not null default 'applicable',
  required boolean not null default true,
  sort_order integer not null,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  notes text,
  skip_reason text,
  skip_approved_by uuid references auth.users(id) on delete set null,
  skip_approved_at timestamptz,
  skip_approval_source text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_onboarding_steps_step_key_check check (
    step_key in (
      'academy_profile',
      'owner_admin_setup',
      'team_setup',
      'courses_cohorts_sessions',
      'student_records',
      'student_portal_accounts',
      'finance_settings',
      'document_setup',
      'feature_profile',
      'payment_gateway',
      'live_classes',
      'automations',
      'website_builder',
      'certificates',
      'marketing_crm',
      'ai_assistant',
      'launch_smoke',
      'platform_approval'
    )
  ),
  constraint tenant_onboarding_steps_owner_scope_check check (
    owner_scope in ('platform', 'tenant', 'system')
  ),
  constraint tenant_onboarding_steps_phase_check check (
    onboarding_phase in (
      'minimum_setup',
      'progressive_setup',
      'launch_readiness',
      'advanced'
    )
  ),
  constraint tenant_onboarding_steps_blocking_level_check check (
    blocking_level in (
      'required_to_enter_workspace',
      'required_for_launch',
      'recommended',
      'optional',
      'coming_soon'
    )
  ),
  constraint tenant_onboarding_steps_editability_policy_check check (
    editability_policy in (
      'editable_anytime',
      'editable_until_launch',
      'support_only_after_launch',
      'locked_after_activation'
    )
  ),
  constraint tenant_onboarding_steps_status_check check (
    status in ('pending', 'in_progress', 'completed', 'blocked', 'skipped')
  ),
  constraint tenant_onboarding_steps_applicability_status_check check (
    applicability_status in (
      'applicable',
      'not_applicable',
      'coming_soon',
      'pending_decision'
    )
  ),
  constraint tenant_onboarding_steps_skip_approval_source_check check (
    skip_approval_source is null
    or skip_approval_source in ('platform', 'system', 'tenant_optional')
  ),
  constraint tenant_onboarding_steps_sort_order_check check (
    sort_order > 0 and sort_order <= 200
  ),
  constraint tenant_onboarding_steps_notes_check check (
    notes is null or (
      char_length(notes) <= 2000
      and position('<' in notes) = 0
      and position('>' in notes) = 0
    )
  ),
  constraint tenant_onboarding_steps_skip_reason_check check (
    skip_reason is null or (
      char_length(skip_reason) <= 1000
      and position('<' in skip_reason) = 0
      and position('>' in skip_reason) = 0
    )
  ),
  constraint tenant_onboarding_steps_metadata_object_check check (
    jsonb_typeof(metadata_json) = 'object'
    and char_length(metadata_json::text) <= 3000
  ),
  constraint tenant_onboarding_steps_skip_state_check check (
    (
      status <> 'skipped'
      and skip_reason is null
      and skip_approved_by is null
      and skip_approved_at is null
      and skip_approval_source is null
    )
    or (
      status = 'skipped'
      and skip_reason is not null
    )
  ),
  constraint tenant_onboarding_steps_required_skip_approval_check check (
    not (
      blocking_level in ('required_to_enter_workspace', 'required_for_launch')
      and status = 'skipped'
      and (
        applicability_status not in ('not_applicable', 'coming_soon')
        or skip_approved_by is null
        or skip_approved_at is null
        or skip_approval_source is distinct from 'platform'
      )
    )
  ),
  constraint tenant_onboarding_steps_platform_approval_not_skipped_check check (
    not (step_key = 'platform_approval' and status = 'skipped')
  ),
  constraint tenant_onboarding_steps_minimum_setup_not_skipped_check check (
    not (blocking_level = 'required_to_enter_workspace' and status = 'skipped')
  ),
  constraint tenant_onboarding_steps_required_flag_consistency_check check (
    required = (blocking_level in ('required_to_enter_workspace', 'required_for_launch'))
  ),
  unique (tenant_id, step_key),
  unique (checklist_id, sort_order)
);

create index if not exists tenant_onboarding_checklists_status_idx
on public.tenant_onboarding_checklists (status, platform_approval_status);

create index if not exists tenant_onboarding_steps_checklist_order_idx
on public.tenant_onboarding_steps (checklist_id, sort_order);

create index if not exists tenant_onboarding_steps_tenant_status_idx
on public.tenant_onboarding_steps (tenant_id, status);

create index if not exists tenant_onboarding_steps_scope_status_idx
on public.tenant_onboarding_steps (owner_scope, status);

create index if not exists tenant_onboarding_steps_phase_blocking_idx
on public.tenant_onboarding_steps (onboarding_phase, blocking_level, status);

drop trigger if exists set_tenant_onboarding_checklists_updated_at
on public.tenant_onboarding_checklists;
create trigger set_tenant_onboarding_checklists_updated_at
before update on public.tenant_onboarding_checklists
for each row execute function public.set_updated_at();

drop trigger if exists set_tenant_onboarding_steps_updated_at
on public.tenant_onboarding_steps;
create trigger set_tenant_onboarding_steps_updated_at
before update on public.tenant_onboarding_steps
for each row execute function public.set_updated_at();

alter table public.tenant_onboarding_checklists enable row level security;
alter table public.tenant_onboarding_steps enable row level security;

revoke all on table public.tenant_onboarding_checklists from public, anon;
revoke all on table public.tenant_onboarding_steps from public, anon;
revoke insert, update, delete on table public.tenant_onboarding_checklists from public, anon, authenticated;
revoke insert, update, delete on table public.tenant_onboarding_steps from public, anon, authenticated;
grant select on table public.tenant_onboarding_checklists to authenticated;
grant select on table public.tenant_onboarding_steps to authenticated;

drop policy if exists "platform and tenant owner admin can read onboarding checklists"
on public.tenant_onboarding_checklists;
create policy "platform and tenant owner admin can read onboarding checklists"
on public.tenant_onboarding_checklists
for select
to authenticated
using (
  public.platform_current_role() in ('owner', 'admin')
  or public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
);

drop policy if exists "platform and tenant owner admin can read onboarding steps"
on public.tenant_onboarding_steps;
create policy "platform and tenant owner admin can read onboarding steps"
on public.tenant_onboarding_steps
for select
to authenticated
using (
  public.platform_current_role() in ('owner', 'admin')
  or public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
);

create or replace function public.onboarding_validate_metadata(
  p_metadata_json jsonb,
  p_field text default 'metadata_json',
  p_max_length integer default 3000
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized jsonb := coalesce(p_metadata_json, '{}'::jsonb);
begin
  if jsonb_typeof(normalized) <> 'object' then
    raise exception '% must be a JSON object.', p_field using errcode = '22023';
  end if;

  if char_length(normalized::text) > p_max_length then
    raise exception '% is too large.', p_field using errcode = '22023';
  end if;

  if normalized::text ~* '(password|passcode|secret|token|otp|signed[_ -]?url|storage[_ -]?path|private[_ -]?storage|credential|authorization|cookie)' then
    raise exception '% cannot contain secrets, tokens, signed URLs, storage paths, or credentials.', p_field
      using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.onboarding_validate_step_key(p_step_key text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(p_step_key, '')), '');
begin
  if normalized not in (
    'academy_profile',
    'owner_admin_setup',
    'team_setup',
    'courses_cohorts_sessions',
    'student_records',
    'student_portal_accounts',
    'finance_settings',
    'document_setup',
    'feature_profile',
    'payment_gateway',
    'live_classes',
    'automations',
    'website_builder',
    'certificates',
    'marketing_crm',
    'ai_assistant',
    'launch_smoke',
    'platform_approval'
  ) then
    raise exception 'Invalid onboarding step key.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.onboarding_validate_step_status(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(p_status, '')), '');
begin
  if normalized not in ('pending', 'in_progress', 'completed', 'blocked', 'skipped') then
    raise exception 'Invalid onboarding step status.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.onboarding_validate_approval_status(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(p_status, '')), '');
begin
  if normalized not in ('not_requested', 'pending_review', 'approved', 'changes_requested') then
    raise exception 'Invalid onboarding approval status.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.onboarding_validate_applicability_status(p_status text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(p_status, '')), '');
begin
  if normalized not in (
    'applicable',
    'not_applicable',
    'coming_soon',
    'pending_decision'
  ) then
    raise exception 'Invalid onboarding applicability status.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.onboarding_validate_blocking_level(p_blocking_level text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(p_blocking_level, '')), '');
begin
  if normalized not in (
    'required_to_enter_workspace',
    'required_for_launch',
    'recommended',
    'optional',
    'coming_soon'
  ) then
    raise exception 'Invalid onboarding blocking level.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.onboarding_step_is_launch_satisfied(
  p_blocking_level text,
  p_status text,
  p_applicability_status text,
  p_skip_approved_by uuid
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_blocking_level <> 'required_for_launch' then true
    when p_applicability_status in ('not_applicable', 'coming_soon')
      and p_skip_approved_by is not null then true
    when p_status = 'completed' then true
    when p_status = 'skipped'
      and p_applicability_status in ('not_applicable', 'coming_soon')
      and p_skip_approved_by is not null then true
    else false
  end;
$$;

create or replace function public.onboarding_step_is_workspace_satisfied(
  p_blocking_level text,
  p_status text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_blocking_level <> 'required_to_enter_workspace' then true
    when p_status = 'completed' then true
    else false
  end;
$$;

create or replace function public.onboarding_step_blocks_launch(
  p_blocking_level text,
  p_status text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status = 'blocked'
    and p_blocking_level in ('required_to_enter_workspace', 'required_for_launch');
$$;

create or replace function public.onboarding_recalculate_checklist_status(
  p_checklist_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_launch_blocking_step boolean := false;
  has_progress boolean := false;
  minimum_setup_satisfied boolean := false;
  launch_required_satisfied boolean := false;
  current_approval_status text;
begin
  select platform_approval_status
  into current_approval_status
  from public.tenant_onboarding_checklists
  where id = p_checklist_id;

  if current_approval_status is null then
    raise exception 'Onboarding checklist not found.' using errcode = 'P0002';
  end if;

  select
    coalesce(bool_or(public.onboarding_step_blocks_launch(blocking_level, status)), false),
    coalesce(bool_or(status in ('in_progress', 'completed', 'skipped')), false),
    not exists (
      select 1
      from public.tenant_onboarding_steps workspace_check
      where workspace_check.checklist_id = p_checklist_id
        and workspace_check.blocking_level = 'required_to_enter_workspace'
        and not public.onboarding_step_is_workspace_satisfied(
          workspace_check.blocking_level,
          workspace_check.status
        )
    ),
    not exists (
      select 1
      from public.tenant_onboarding_steps launch_check
      where launch_check.checklist_id = p_checklist_id
        and launch_check.blocking_level = 'required_for_launch'
        and launch_check.step_key <> 'platform_approval'
        and not public.onboarding_step_is_launch_satisfied(
          launch_check.blocking_level,
          launch_check.status,
          launch_check.applicability_status,
          launch_check.skip_approved_by
        )
    )
  into has_launch_blocking_step, has_progress, minimum_setup_satisfied, launch_required_satisfied
  from public.tenant_onboarding_steps step_check
  where step_check.checklist_id = p_checklist_id;

  update public.tenant_onboarding_checklists
  set
    status = case
      when has_launch_blocking_step then 'blocked'
      when current_approval_status = 'approved' and minimum_setup_satisfied and launch_required_satisfied then 'approved'
      when minimum_setup_satisfied and launch_required_satisfied then 'ready_for_review'
      when minimum_setup_satisfied and has_progress then 'in_progress'
      when has_progress then 'in_progress'
      else 'not_started'
    end,
    launch_ready_at = case
      when minimum_setup_satisfied and launch_required_satisfied and not has_launch_blocking_step then coalesce(launch_ready_at, now())
      else null
    end
  where id = p_checklist_id;
end;
$$;

create or replace function public.onboarding_default_steps()
returns table (
  step_key text,
  title text,
  description text,
  owner_scope text,
  onboarding_phase text,
  blocking_level text,
  editability_policy text,
  applicability_status text,
  required boolean,
  sort_order integer
)
language sql
immutable
set search_path = public
as $$
  values
    ('academy_profile', 'Academy profile', 'Confirm academy name, coaching type, location, and contact basics.', 'tenant', 'minimum_setup', 'required_to_enter_workspace', 'editable_anytime', 'applicable', true, 10),
    ('owner_admin_setup', 'Owner and admin setup', 'Confirm owner/admin access and workspace responsibility.', 'tenant', 'minimum_setup', 'required_to_enter_workspace', 'editable_anytime', 'applicable', true, 20),
    ('team_setup', 'Team setup', 'Invite staff/trainers and assign trainer visibility when needed.', 'tenant', 'progressive_setup', 'recommended', 'editable_anytime', 'applicable', false, 30),
    ('courses_cohorts_sessions', 'Courses, cohorts, and sessions', 'Create the initial course, cohort, and session structure when ready.', 'tenant', 'progressive_setup', 'recommended', 'editable_anytime', 'applicable', false, 40),
    ('student_records', 'Student records', 'Create or import initial student records and enrollments when ready.', 'tenant', 'progressive_setup', 'recommended', 'editable_anytime', 'applicable', false, 50),
    ('finance_settings', 'Finance settings', 'Configure manual finance prefixes, terms, and receipt/payment workflow if fees are used.', 'tenant', 'progressive_setup', 'required_for_launch', 'editable_until_launch', 'pending_decision', true, 60),
    ('document_setup', 'Document setup', 'Confirm document metadata, storage readiness, and student visibility only if document sharing is used.', 'tenant', 'progressive_setup', 'required_for_launch', 'editable_until_launch', 'pending_decision', true, 70),
    ('student_portal_accounts', 'Student portal accounts', 'Confirm student portal account provisioning only if student portal launch is in scope.', 'platform', 'launch_readiness', 'required_for_launch', 'support_only_after_launch', 'pending_decision', true, 80),
    ('feature_profile', 'Feature profile', 'Confirm enabled, disabled, preview, and coming-soon modules for launch.', 'platform', 'progressive_setup', 'recommended', 'support_only_after_launch', 'applicable', false, 90),
    ('launch_smoke', 'Launch smoke', 'Complete owner/admin/student route and workflow smoke checks before real student launch.', 'platform', 'launch_readiness', 'required_for_launch', 'locked_after_activation', 'applicable', true, 100),
    ('platform_approval', 'Platform approval', 'Platform owner/admin signs off launch readiness.', 'platform', 'launch_readiness', 'required_for_launch', 'locked_after_activation', 'applicable', true, 110),
    ('payment_gateway', 'Payment gateway', 'Online payment collection remains coming soon; use manual payment tracking for MVP.', 'platform', 'advanced', 'coming_soon', 'support_only_after_launch', 'coming_soon', false, 120),
    ('live_classes', 'Live classes', 'Live class automation is planned for a later launch phase.', 'platform', 'advanced', 'coming_soon', 'support_only_after_launch', 'coming_soon', false, 130),
    ('automations', 'Automations', 'Automation workflows can be explored after core academy setup is stable.', 'tenant', 'advanced', 'optional', 'editable_anytime', 'pending_decision', false, 140),
    ('website_builder', 'Website builder', 'Website builder setup is optional and not required for first launch.', 'platform', 'advanced', 'coming_soon', 'support_only_after_launch', 'coming_soon', false, 150),
    ('certificates', 'Certificates', 'Certificate workflows are optional and can be configured later.', 'tenant', 'advanced', 'optional', 'editable_anytime', 'pending_decision', false, 160),
    ('marketing_crm', 'Marketing and CRM', 'Marketing/CRM workflows are optional and can be configured later.', 'tenant', 'advanced', 'optional', 'editable_anytime', 'pending_decision', false, 170),
    ('ai_assistant', 'AI Assistant Preview', 'AI Assistant remains a preview/foundation feature and does not block launch.', 'platform', 'advanced', 'optional', 'support_only_after_launch', 'pending_decision', false, 180);
$$;

create or replace function public.onboarding_actor_can_view(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(
    public.platform_current_role() in ('owner', 'admin')
    or public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin']),
    false
  );
end;
$$;

create or replace function public.onboarding_actor_can_manage_tenant_steps(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(
    public.platform_current_role() in ('owner', 'admin')
    or public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin']),
    false
  );
end;
$$;

create or replace function public.onboarding_actor_can_manage_platform_steps()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(public.platform_current_role() in ('owner', 'admin'), false);
end;
$$;

create or replace function public.onboarding_actor_can_approve_launch()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(public.platform_current_role() in ('owner', 'admin'), false);
end;
$$;

create or replace function public.onboarding_assert_tenant_exists(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Tenant not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.initialize_tenant_onboarding_checklist(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  checklist_id uuid;
  created_checklist boolean := false;
  default_step record;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform public.onboarding_assert_tenant_exists(p_tenant_id);

  if not public.onboarding_actor_can_view(p_tenant_id) then
    raise exception 'Onboarding checklist access denied.' using errcode = '42501';
  end if;

  insert into public.tenant_onboarding_checklists (
    tenant_id,
    created_by,
    updated_by,
    status,
    platform_approval_status,
    metadata_json
  )
  values (
    p_tenant_id,
    actor_id,
    actor_id,
    'not_started',
    'not_requested',
    '{}'::jsonb
  )
  on conflict (tenant_id) do nothing
  returning id into checklist_id;

  if checklist_id is not null then
    created_checklist := true;
  else
    select id
    into checklist_id
    from public.tenant_onboarding_checklists
    where tenant_id = p_tenant_id;
  end if;

  for default_step in select * from public.onboarding_default_steps() loop
    insert into public.tenant_onboarding_steps (
      tenant_id,
      checklist_id,
      step_key,
      title,
      description,
      owner_scope,
      onboarding_phase,
      blocking_level,
      editability_policy,
      applicability_status,
      required,
      sort_order,
      status,
      metadata_json
    )
    values (
      p_tenant_id,
      checklist_id,
      default_step.step_key,
      default_step.title,
      default_step.description,
      default_step.owner_scope,
      default_step.onboarding_phase,
      default_step.blocking_level,
      default_step.editability_policy,
      default_step.applicability_status,
      default_step.required,
      default_step.sort_order,
      'pending',
      '{}'::jsonb
    )
    on conflict (tenant_id, step_key) do nothing;
  end loop;

  if created_checklist then
    perform public.platform_log_activity(
      p_tenant_id,
      'tenant_onboarding_checklist_initialized',
      'tenant_onboarding_checklist',
      checklist_id,
      jsonb_build_object('tenant_id', p_tenant_id)
    );
  end if;

  return public.get_tenant_onboarding_status(p_tenant_id);
end;
$$;

create or replace function public.get_tenant_onboarding_status(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  checklist_record public.tenant_onboarding_checklists%rowtype;
  can_view boolean;
  can_manage_tenant boolean;
  can_manage_platform boolean;
  can_approve boolean;
  total_launch_required integer := 0;
  satisfied_launch_required integer := 0;
  total_workspace_required integer := 0;
  satisfied_workspace_required integer := 0;
  launch_blocking_steps integer := 0;
  progress_percent integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform public.onboarding_assert_tenant_exists(p_tenant_id);

  can_view := public.onboarding_actor_can_view(p_tenant_id);
  if not can_view then
    raise exception 'Onboarding checklist access denied.' using errcode = '42501';
  end if;

  select *
  into checklist_record
  from public.tenant_onboarding_checklists
  where tenant_id = p_tenant_id;

  if checklist_record.id is null then
    return jsonb_build_object(
      'tenant_id', p_tenant_id,
      'checklist', null,
      'steps', '[]'::jsonb,
      'progress_percent', 0,
      'workspace_entry_ready', false,
      'required_completed', false,
      'launch_required_completed', false,
      'launch_ready', false,
      'can_manage_tenant_steps', public.onboarding_actor_can_manage_tenant_steps(p_tenant_id),
      'can_manage_platform_steps', public.onboarding_actor_can_manage_platform_steps(),
      'can_approve_launch', public.onboarding_actor_can_approve_launch()
    );
  end if;

  select
    count(*) filter (where blocking_level = 'required_for_launch'),
    count(*) filter (
      where blocking_level = 'required_for_launch'
        and public.onboarding_step_is_launch_satisfied(
          blocking_level,
          status,
          applicability_status,
          skip_approved_by
        )
    ),
    count(*) filter (where blocking_level = 'required_to_enter_workspace'),
    count(*) filter (
      where blocking_level = 'required_to_enter_workspace'
        and public.onboarding_step_is_workspace_satisfied(blocking_level, status)
    ),
    count(*) filter (where public.onboarding_step_blocks_launch(blocking_level, status))
  into
    total_launch_required,
    satisfied_launch_required,
    total_workspace_required,
    satisfied_workspace_required,
    launch_blocking_steps
  from public.tenant_onboarding_steps
  where checklist_id = checklist_record.id;

  progress_percent := case
    when coalesce(total_launch_required, 0) = 0 then 0
    else round((satisfied_launch_required::numeric / total_launch_required::numeric) * 100)::integer
  end;

  can_manage_tenant := public.onboarding_actor_can_manage_tenant_steps(p_tenant_id);
  can_manage_platform := public.onboarding_actor_can_manage_platform_steps();
  can_approve := public.onboarding_actor_can_approve_launch();

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'checklist', to_jsonb(checklist_record),
    'steps', coalesce((
      select jsonb_agg(to_jsonb(step_row) order by step_row.sort_order)
      from public.tenant_onboarding_steps step_row
      where step_row.checklist_id = checklist_record.id
    ), '[]'::jsonb),
    'progress_percent', progress_percent,
    'workspace_entry_ready',
      coalesce(total_workspace_required, 0) > 0
      and total_workspace_required = satisfied_workspace_required,
    'required_completed', coalesce(total_launch_required, 0) > 0 and total_launch_required = satisfied_launch_required,
    'launch_required_completed', coalesce(total_launch_required, 0) > 0 and total_launch_required = satisfied_launch_required,
    'launch_blocking_steps', launch_blocking_steps,
    'launch_ready',
      coalesce(total_launch_required, 0) > 0
      and total_launch_required = satisfied_launch_required
      and coalesce(total_workspace_required, 0) > 0
      and total_workspace_required = satisfied_workspace_required
      and launch_blocking_steps = 0
      and checklist_record.platform_approval_status = 'approved',
    'can_manage_tenant_steps', can_manage_tenant,
    'can_manage_platform_steps', can_manage_platform,
    'can_approve_launch', can_approve
  );
end;
$$;

create or replace function public.update_tenant_onboarding_step(
  p_tenant_id uuid,
  p_step_key text,
  p_status text,
  p_notes text default null,
  p_metadata_json jsonb default '{}'::jsonb,
  p_applicability_status text default null,
  p_skip_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_step_key text := public.onboarding_validate_step_key(p_step_key);
  normalized_status text := public.onboarding_validate_step_status(p_status);
  normalized_notes text := public.platform_normalize_text(p_notes, 'notes', false, 2000);
  normalized_metadata jsonb := public.onboarding_validate_metadata(p_metadata_json, 'metadata_json', 3000);
  normalized_applicability_status text;
  normalized_skip_reason text;
  actor_is_platform boolean := false;
  step_record public.tenant_onboarding_steps%rowtype;
  checklist_record public.tenant_onboarding_checklists%rowtype;
  checklist_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform public.onboarding_assert_tenant_exists(p_tenant_id);
  perform public.initialize_tenant_onboarding_checklist(p_tenant_id);

  select *
  into step_record
  from public.tenant_onboarding_steps
  where tenant_id = p_tenant_id
    and step_key = normalized_step_key;

  if step_record.id is null then
    raise exception 'Onboarding step not found.' using errcode = 'P0002';
  end if;

  select *
  into checklist_record
  from public.tenant_onboarding_checklists
  where id = step_record.checklist_id;

  actor_is_platform := public.onboarding_actor_can_manage_platform_steps();
  normalized_applicability_status := case
    when p_applicability_status is null then step_record.applicability_status
    else public.onboarding_validate_applicability_status(p_applicability_status)
  end;
  normalized_skip_reason := public.platform_normalize_text(p_skip_reason, 'skip_reason', false, 1000);

  if step_record.owner_scope = 'tenant' then
    if not public.onboarding_actor_can_manage_tenant_steps(p_tenant_id) then
      raise exception 'Only tenant owner/admin or platform admins can update this onboarding step.' using errcode = '42501';
    end if;
  elsif step_record.owner_scope = 'platform' then
    if not public.onboarding_actor_can_manage_platform_steps() then
      raise exception 'Only platform admins can update this onboarding step.' using errcode = '42501';
    end if;
  else
    raise exception 'System-owned onboarding steps cannot be updated manually.' using errcode = '42501';
  end if;

  if checklist_record.platform_approval_status = 'approved' then
    if step_record.editability_policy = 'locked_after_activation' then
      raise exception 'This onboarding step is locked after platform approval.' using errcode = '42501';
    end if;

    if step_record.editability_policy in ('editable_until_launch', 'support_only_after_launch') and not actor_is_platform then
      raise exception 'This onboarding step requires platform/support update after launch approval.' using errcode = '42501';
    end if;
  end if;

  if normalized_status = 'skipped' then
    if normalized_step_key = 'platform_approval' then
      raise exception 'Platform approval cannot be skipped.' using errcode = '42501';
    end if;

    if normalized_skip_reason is null then
      raise exception 'A skip reason is required to skip an onboarding step.' using errcode = '22023';
    end if;

    if step_record.blocking_level in ('required_to_enter_workspace', 'required_for_launch') then
      if not actor_is_platform then
        raise exception 'Only platform admins can skip workspace-entry or launch-required onboarding steps.' using errcode = '42501';
      end if;

      if step_record.blocking_level = 'required_to_enter_workspace' then
        raise exception 'Minimum workspace setup steps cannot be skipped.' using errcode = '42501';
      end if;

      if normalized_applicability_status not in ('not_applicable', 'coming_soon') then
        raise exception 'Launch-required onboarding steps can only be skipped when marked not_applicable or coming_soon.'
          using errcode = '22023';
      end if;
    else
      if not actor_is_platform and step_record.owner_scope <> 'tenant' then
        raise exception 'Only platform admins can skip non-tenant onboarding steps.' using errcode = '42501';
      end if;
    end if;
  elsif p_skip_reason is not null then
    raise exception 'skip_reason is only allowed when status is skipped.' using errcode = '22023';
  end if;

  if p_applicability_status is not null and not actor_is_platform then
    if step_record.blocking_level in ('required_to_enter_workspace', 'required_for_launch')
      or normalized_applicability_status <> step_record.applicability_status then
      raise exception 'Only platform admins can change onboarding step applicability.' using errcode = '42501';
    end if;
  end if;

  update public.tenant_onboarding_steps
  set
    status = normalized_status,
    applicability_status = normalized_applicability_status,
    notes = normalized_notes,
    skip_reason = case
      when normalized_status = 'skipped' then normalized_skip_reason
      else null
    end,
    skip_approved_by = case
      when normalized_status = 'skipped' and step_record.blocking_level in ('required_to_enter_workspace', 'required_for_launch') then actor_id
      else null
    end,
    skip_approved_at = case
      when normalized_status = 'skipped' and step_record.blocking_level in ('required_to_enter_workspace', 'required_for_launch') then now()
      else null
    end,
    skip_approval_source = case
      when normalized_status = 'skipped' and step_record.blocking_level in ('required_to_enter_workspace', 'required_for_launch') then 'platform'
      when normalized_status = 'skipped' and actor_is_platform then 'platform'
      when normalized_status = 'skipped' then 'tenant_optional'
      else null
    end,
    metadata_json = normalized_metadata,
    completed_at = case
      when normalized_status in ('completed', 'skipped') then now()
      else null
    end,
    completed_by = case
      when normalized_status in ('completed', 'skipped') then actor_id
      else null
    end,
    reviewed_at = case
      when step_record.owner_scope = 'platform' then now()
      else reviewed_at
    end,
    reviewed_by = case
      when step_record.owner_scope = 'platform' then actor_id
      else reviewed_by
    end
  where id = step_record.id
  returning checklist_id into checklist_id;

  update public.tenant_onboarding_checklists
  set updated_by = actor_id
  where id = checklist_id;

  perform public.onboarding_recalculate_checklist_status(checklist_id);

  perform public.platform_log_activity(
    p_tenant_id,
    'tenant_onboarding_step_updated',
    'tenant_onboarding_step',
    step_record.id,
    jsonb_build_object(
      'step_key', normalized_step_key,
      'status', normalized_status,
      'owner_scope', step_record.owner_scope,
      'applicability_status', normalized_applicability_status
    )
  );

  return public.get_tenant_onboarding_status(p_tenant_id);
end;
$$;

create or replace function public.complete_tenant_onboarding_step(
  p_tenant_id uuid,
  p_step_key text,
  p_notes text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.update_tenant_onboarding_step(
    p_tenant_id,
    p_step_key,
    'completed',
    p_notes,
    p_metadata_json
  );
end;
$$;

create or replace function public.platform_review_tenant_onboarding(
  p_tenant_id uuid,
  p_approval_status text,
  p_notes text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_status text := public.onboarding_validate_approval_status(p_approval_status);
  normalized_notes text := public.platform_normalize_text(p_notes, 'notes', false, 2000);
  normalized_metadata jsonb := public.onboarding_validate_metadata(p_metadata_json, 'metadata_json', 3000);
  checklist_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform public.onboarding_assert_tenant_exists(p_tenant_id);

  if not public.onboarding_actor_can_approve_launch() then
    raise exception 'Only platform owner/admin users can review tenant onboarding launch readiness.' using errcode = '42501';
  end if;

  perform public.initialize_tenant_onboarding_checklist(p_tenant_id);

  if normalized_status = 'approved' then
    if exists (
      select 1
      from public.tenant_onboarding_steps step_check
      where step_check.tenant_id = p_tenant_id
        and public.onboarding_step_blocks_launch(step_check.blocking_level, step_check.status)
    ) then
      raise exception 'Blocked onboarding steps must be resolved before platform approval.'
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.tenant_onboarding_steps step_check
      where step_check.tenant_id = p_tenant_id
        and step_check.blocking_level = 'required_to_enter_workspace'
        and not public.onboarding_step_is_workspace_satisfied(
          step_check.blocking_level,
          step_check.status
        )
    ) then
      raise exception 'Minimum workspace setup steps must be completed before platform approval.'
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.tenant_onboarding_steps step_check
      where step_check.tenant_id = p_tenant_id
        and step_check.blocking_level = 'required_for_launch'
        and step_check.step_key <> 'platform_approval'
        and not public.onboarding_step_is_launch_satisfied(
          step_check.blocking_level,
          step_check.status,
          step_check.applicability_status,
          step_check.skip_approved_by
        )
    ) then
      raise exception 'Required onboarding steps must be completed or platform-approved as not applicable/coming soon before platform approval.'
        using errcode = '42501';
    end if;
  end if;

  update public.tenant_onboarding_checklists
  set
    platform_approval_status = normalized_status,
    platform_approved_at = case
      when normalized_status = 'approved' then now()
      else null
    end,
    platform_approved_by = case
      when normalized_status = 'approved' then actor_id
      else null
    end,
    metadata_json = normalized_metadata,
    updated_by = actor_id
  where tenant_id = p_tenant_id
  returning id into checklist_id;

  update public.tenant_onboarding_steps
  set
    status = case
      when normalized_status = 'approved' then 'completed'
      when normalized_status = 'changes_requested' then 'blocked'
      when normalized_status = 'pending_review' then 'in_progress'
      when normalized_status = 'not_requested' then 'pending'
      else status
    end,
    applicability_status = 'applicable',
    notes = normalized_notes,
    skip_reason = null,
    skip_approved_by = null,
    skip_approved_at = null,
    skip_approval_source = null,
    metadata_json = normalized_metadata,
    completed_at = case
      when normalized_status = 'approved' then now()
      else null
    end,
    completed_by = case
      when normalized_status = 'approved' then actor_id
      else null
    end,
    reviewed_at = now(),
    reviewed_by = actor_id
  where tenant_id = p_tenant_id
    and step_key = 'platform_approval';

  perform public.onboarding_recalculate_checklist_status(checklist_id);

  perform public.platform_log_activity(
    p_tenant_id,
    'tenant_onboarding_reviewed',
    'tenant_onboarding_checklist',
    checklist_id,
    jsonb_build_object('approval_status', normalized_status)
  );

  return public.get_tenant_onboarding_status(p_tenant_id);
end;
$$;

comment on table public.tenant_onboarding_checklists is
'Phase 1 platform-guided academy onboarding checklist header. Mutations must use secure RPCs.';

comment on table public.tenant_onboarding_steps is
'Phase 1 platform-guided academy onboarding checklist steps. No automated product setup actions are performed.';

comment on function public.initialize_tenant_onboarding_checklist(uuid) is
'Lazily creates default onboarding checklist rows for an existing tenant.';

comment on function public.update_tenant_onboarding_step(uuid, text, text, text, jsonb, text, text) is
'Updates an authorized onboarding checklist step. Tenant owner/admin may update tenant-owned steps only and can skip only optional tenant steps; platform admins may update platform and tenant steps and approve required skips.';

comment on function public.platform_review_tenant_onboarding(uuid, text, text, jsonb) is
'Platform owner/admin launch review for tenant onboarding checklist.';

revoke execute on function public.onboarding_validate_metadata(jsonb, text, integer) from public;
revoke execute on function public.onboarding_validate_step_key(text) from public;
revoke execute on function public.onboarding_validate_step_status(text) from public;
revoke execute on function public.onboarding_validate_approval_status(text) from public;
revoke execute on function public.onboarding_validate_applicability_status(text) from public;
revoke execute on function public.onboarding_validate_blocking_level(text) from public;
revoke execute on function public.onboarding_step_is_launch_satisfied(text, text, text, uuid) from public;
revoke execute on function public.onboarding_step_is_workspace_satisfied(text, text) from public;
revoke execute on function public.onboarding_step_blocks_launch(text, text) from public;
revoke execute on function public.onboarding_recalculate_checklist_status(uuid) from public;
revoke execute on function public.onboarding_default_steps() from public;
revoke execute on function public.onboarding_actor_can_view(uuid) from public;
revoke execute on function public.onboarding_actor_can_manage_tenant_steps(uuid) from public;
revoke execute on function public.onboarding_actor_can_manage_platform_steps() from public;
revoke execute on function public.onboarding_actor_can_approve_launch() from public;
revoke execute on function public.onboarding_assert_tenant_exists(uuid) from public;
revoke execute on function public.initialize_tenant_onboarding_checklist(uuid) from public;
revoke execute on function public.get_tenant_onboarding_status(uuid) from public;
revoke execute on function public.update_tenant_onboarding_step(uuid, text, text, text, jsonb, text, text) from public;
revoke execute on function public.complete_tenant_onboarding_step(uuid, text, text, jsonb) from public;
revoke execute on function public.platform_review_tenant_onboarding(uuid, text, text, jsonb) from public;

revoke execute on function public.onboarding_validate_metadata(jsonb, text, integer) from authenticated;
revoke execute on function public.onboarding_validate_step_key(text) from authenticated;
revoke execute on function public.onboarding_validate_step_status(text) from authenticated;
revoke execute on function public.onboarding_validate_approval_status(text) from authenticated;
revoke execute on function public.onboarding_validate_applicability_status(text) from authenticated;
revoke execute on function public.onboarding_validate_blocking_level(text) from authenticated;
revoke execute on function public.onboarding_step_is_launch_satisfied(text, text, text, uuid) from authenticated;
revoke execute on function public.onboarding_step_is_workspace_satisfied(text, text) from authenticated;
revoke execute on function public.onboarding_step_blocks_launch(text, text) from authenticated;
revoke execute on function public.onboarding_recalculate_checklist_status(uuid) from authenticated;
revoke execute on function public.onboarding_default_steps() from authenticated;
revoke execute on function public.onboarding_actor_can_view(uuid) from authenticated;
revoke execute on function public.onboarding_actor_can_manage_tenant_steps(uuid) from authenticated;
revoke execute on function public.onboarding_actor_can_manage_platform_steps() from authenticated;
revoke execute on function public.onboarding_actor_can_approve_launch() from authenticated;
revoke execute on function public.onboarding_assert_tenant_exists(uuid) from authenticated;

grant execute on function public.initialize_tenant_onboarding_checklist(uuid) to authenticated;
grant execute on function public.get_tenant_onboarding_status(uuid) to authenticated;
grant execute on function public.update_tenant_onboarding_step(uuid, text, text, text, jsonb, text, text) to authenticated;
grant execute on function public.complete_tenant_onboarding_step(uuid, text, text, jsonb) to authenticated;
grant execute on function public.platform_review_tenant_onboarding(uuid, text, text, jsonb) to authenticated;

commit;

-- Read-only verification queries for manual review after execution:
--
-- Tables exist:
-- select table_schema, table_name
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name in ('tenant_onboarding_checklists', 'tenant_onboarding_steps')
-- order by table_name;
--
-- Functions exist:
-- select n.nspname as schema_name, p.proname, pg_get_function_arguments(p.oid) as arguments
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in (
--     'get_tenant_onboarding_status',
--     'initialize_tenant_onboarding_checklist',
--     'update_tenant_onboarding_step',
--     'complete_tenant_onboarding_step',
--     'platform_review_tenant_onboarding'
--   )
-- order by p.proname;
--
-- Direct write grants absent for public/anon/authenticated:
-- select
--   grantee,
--   table_name,
--   privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('tenant_onboarding_checklists', 'tenant_onboarding_steps')
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
-- order by table_name, grantee, privilege_type;
--
-- has_table_privilege posture:
-- select
--   role_name,
--   table_name,
--   has_table_privilege(role_name, 'public.' || table_name, 'SELECT') as can_select,
--   has_table_privilege(role_name, 'public.' || table_name, 'INSERT') as can_insert,
--   has_table_privilege(role_name, 'public.' || table_name, 'UPDATE') as can_update,
--   has_table_privilege(role_name, 'public.' || table_name, 'DELETE') as can_delete
-- from (
--   values ('public'), ('anon'), ('authenticated'), ('service_role'), ('postgres')
-- ) as roles(role_name)
-- cross join (
--   values ('tenant_onboarding_checklists'), ('tenant_onboarding_steps')
-- ) as tables(table_name)
-- order by table_name, role_name;
--
-- Default step count:
-- select count(*) as default_step_count
-- from public.onboarding_default_steps();
--
-- Product-model, skip, and applicability columns exist:
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'tenant_onboarding_steps'
--   and column_name in (
--     'onboarding_phase',
--     'blocking_level',
--     'editability_policy',
--     'applicability_status',
--     'skip_reason',
--     'skip_approved_by',
--     'skip_approved_at',
--     'skip_approval_source'
--   )
-- order by column_name;
--
-- Public execute grants are limited to the intended authenticated RPC surface:
-- select routine_name, grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name like '%onboarding%'
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
-- order by routine_name, grantee, privilege_type;
--
-- Workspace-entry or launch-required skipped steps cannot exist without platform approval and approved applicability:
-- select id, tenant_id, step_key, blocking_level, status, applicability_status, skip_approved_by, skip_approved_at, skip_approval_source
-- from public.tenant_onboarding_steps
-- where blocking_level in ('required_to_enter_workspace', 'required_for_launch')
--   and status = 'skipped'
--   and (
--     applicability_status not in ('not_applicable', 'coming_soon')
--     or skip_approved_by is null
--     or skip_approved_at is null
--     or skip_approval_source is distinct from 'platform'
--   );
--
-- Launch-blocking steps prevent checklist launch-ready state:
-- select c.id, c.tenant_id, c.status, c.launch_ready_at
-- from public.tenant_onboarding_checklists c
-- where exists (
--   select 1
--   from public.tenant_onboarding_steps s
--   where s.checklist_id = c.id
--     and s.status = 'blocked'
--     and s.blocking_level in ('required_to_enter_workspace', 'required_for_launch')
-- )
-- and (
--   c.status <> 'blocked'
--   or c.launch_ready_at is not null
-- );
--
-- Approved checklist with incomplete minimum setup should return zero rows:
-- select c.id, c.tenant_id, c.status, c.platform_approval_status
-- from public.tenant_onboarding_checklists c
-- where c.status = 'approved'
--   and exists (
--     select 1
--     from public.tenant_onboarding_steps s
--     where s.checklist_id = c.id
--       and s.blocking_level = 'required_to_enter_workspace'
--       and not public.onboarding_step_is_workspace_satisfied(s.blocking_level, s.status)
--   );
--
-- launch_ready_at with incomplete minimum setup should return zero rows:
-- select c.id, c.tenant_id, c.status, c.launch_ready_at
-- from public.tenant_onboarding_checklists c
-- where c.launch_ready_at is not null
--   and exists (
--     select 1
--     from public.tenant_onboarding_steps s
--     where s.checklist_id = c.id
--       and s.blocking_level = 'required_to_enter_workspace'
--       and not public.onboarding_step_is_workspace_satisfied(s.blocking_level, s.status)
--   );
--
-- ready_for_review with incomplete minimum setup should return zero rows:
-- select c.id, c.tenant_id, c.status, c.platform_approval_status
-- from public.tenant_onboarding_checklists c
-- where c.status = 'ready_for_review'
--   and exists (
--     select 1
--     from public.tenant_onboarding_steps s
--     where s.checklist_id = c.id
--       and s.blocking_level = 'required_to_enter_workspace'
--       and not public.onboarding_step_is_workspace_satisfied(s.blocking_level, s.status)
--   );
--
-- Regression tenant can be initialized later by RPC:
-- select id, name, slug
-- from public.tenants
-- where id = '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
--   and slug = 'coachfort-regression';
