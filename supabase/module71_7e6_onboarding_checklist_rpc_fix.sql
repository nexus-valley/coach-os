-- Module 71.7E6: Onboarding Checklist RPC ambiguous checklist_id fix
--
-- Corrects public.update_tenant_onboarding_step only.
-- No schema changes, data changes, policy changes, or grant changes are included.
-- CREATE OR REPLACE preserves the existing execute grant posture for this RPC.

begin;

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
  v_checklist_id uuid;
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

  update public.tenant_onboarding_steps as onboarding_step
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
      else onboarding_step.reviewed_at
    end,
    reviewed_by = case
      when step_record.owner_scope = 'platform' then actor_id
      else onboarding_step.reviewed_by
    end
  where onboarding_step.id = step_record.id
  returning onboarding_step.checklist_id into v_checklist_id;

  update public.tenant_onboarding_checklists
  set updated_by = actor_id
  where id = v_checklist_id;

  perform public.onboarding_recalculate_checklist_status(v_checklist_id);

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

commit;

-- Read-only verification SQL for after execution:
--
-- Confirm function signature still exists:
-- select n.nspname as schema_name, p.proname, pg_get_function_arguments(p.oid) as arguments
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname = 'update_tenant_onboarding_step';
--
-- Confirm execute grants remain on the same public RPC only:
-- select routine_name, grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name = 'update_tenant_onboarding_step'
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
-- order by grantee, privilege_type;
--
-- Confirm direct table writes remain absent for public/anon/authenticated:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('tenant_onboarding_checklists', 'tenant_onboarding_steps')
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
--   and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
-- order by table_name, grantee, privilege_type;
--
-- Regression RPC smoke targets after execution:
-- -- As tenant owner:
-- -- complete_tenant_onboarding_step('29a33701-82ed-4c7f-8042-0a1af8296ce5', 'academy_profile', ...)
-- -- complete_tenant_onboarding_step('29a33701-82ed-4c7f-8042-0a1af8296ce5', 'owner_admin_setup', ...)
-- -- update_tenant_onboarding_step('29a33701-82ed-4c7f-8042-0a1af8296ce5', 'team_setup', 'in_progress', ...)
-- -- Expected: no 42702 ambiguity error.
