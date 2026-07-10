-- Module 71.7P8-lite-B: Module 62 Canonical Global-Lock Bridge
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Keep Module 62 feature access aligned with canonical 71.7 global locks.
-- - Force canonical globally locked feature keys to read as coming_soon through
--   Module 62 effective feature access.
-- - Prevent Module 62 feature settings from enabling or otherwise changing
--   canonical globally locked keys away from coming_soon.
--
-- Non-goals:
-- - Does not activate payment_gateway or live_classes.
-- - Does not modify FeatureGate TypeScript.
-- - Does not change payment, checkout, public catalog, tenant assignment,
--   request options, legacy Module 56, document upload behavior, or plan data.

begin;

create or replace function public.feature_access_effective_rows(p_tenant_id uuid)
returns table (
  feature_key text,
  status text,
  source text,
  configured_by uuid,
  configured_at timestamptz,
  metadata_json jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    key_name as feature_key,
    case
      when key_name = any (public.subscription_entitlements_global_locked_features())
        then 'coming_soon'
      else coalesce(tfs.status, public.feature_access_default_status(key_name))
    end as status,
    case
      when key_name = any (public.subscription_entitlements_global_locked_features())
        then 'system'
      else coalesce(tfs.source, 'system')
    end as source,
    tfs.configured_by,
    tfs.configured_at,
    case
      when key_name = any (public.subscription_entitlements_global_locked_features())
        then coalesce(tfs.metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'canonical_global_lock', true,
            'global_lock_source', 'module71_7_global_lock'
          )
      else coalesce(tfs.metadata_json, '{}'::jsonb)
    end as metadata_json,
    tfs.updated_at
  from unnest(public.feature_access_allowed_keys()) as key_name
  left join public.tenant_feature_settings tfs
    on tfs.tenant_id = p_tenant_id
   and tfs.feature_key = key_name;
$$;

create or replace function public.update_tenant_feature_access(
  p_tenant_id uuid,
  p_feature_key text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_key text;
  v_status text;
  v_old_status text;
  v_source text := 'manual';
  v_is_platform_manager boolean;
begin
  perform public.feature_access_assert_can_manage(p_tenant_id);

  v_feature_key := public.feature_access_normalize_feature_key(p_feature_key);
  v_status := public.feature_access_normalize_status(p_status);
  v_is_platform_manager := public.feature_access_platform_can_manage();

  if v_feature_key = any (public.feature_access_core_keys()) and v_status <> 'enabled' then
    raise exception 'Core workspace features cannot be disabled.' using errcode = '22023';
  end if;

  if v_feature_key = any (public.subscription_entitlements_global_locked_features())
     and v_status <> 'coming_soon' then
    raise exception 'This feature is globally locked until platform launch readiness is complete.'
      using errcode = '22023';
  end if;

  if v_status = 'locked_by_plan' and not v_is_platform_manager then
    raise exception 'Only platform owners/admins can lock features by plan.' using errcode = '42501';
  end if;

  if v_status = 'locked_by_plan' then
    v_source := 'plan';
  elsif v_status = 'coming_soon' then
    v_source := 'system';
  end if;

  select fer.status
  into v_old_status
  from public.feature_access_effective_rows(p_tenant_id) fer
  where fer.feature_key = v_feature_key
  limit 1;

  insert into public.tenant_feature_settings (
    tenant_id,
    feature_key,
    status,
    source,
    configured_by,
    configured_at,
    metadata_json
  )
  values (
    p_tenant_id,
    v_feature_key,
    v_status,
    v_source,
    auth.uid(),
    now(),
    case
      when v_feature_key = any (public.subscription_entitlements_global_locked_features())
        then jsonb_build_object(
          'canonical_global_lock', true,
          'global_lock_source', 'module71_7_global_lock'
        )
      else '{}'::jsonb
    end
  )
  on conflict (tenant_id, feature_key) do update
  set status = excluded.status,
      source = excluded.source,
      configured_by = excluded.configured_by,
      configured_at = excluded.configured_at,
      metadata_json = excluded.metadata_json,
      updated_at = now();

  perform public.feature_access_write_activity(
    p_tenant_id,
    v_feature_key,
    'tenant_feature_updated',
    v_old_status,
    v_status,
    v_source,
    jsonb_build_object(
      'bulk', false,
      'canonical_global_lock',
        v_feature_key = any (public.subscription_entitlements_global_locked_features())
    )
  );

  return public.get_tenant_feature_access(p_tenant_id);
end;
$$;

create or replace function public.bulk_update_tenant_feature_access(
  p_tenant_id uuid,
  p_features jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_feature_key text;
  v_status text;
  v_old_status text;
  v_source text;
  v_is_platform_manager boolean;
begin
  perform public.feature_access_assert_can_manage(p_tenant_id);

  if p_features is null
     or jsonb_typeof(p_features) <> 'object'
     or char_length(p_features::text) > 5000 then
    raise exception 'Feature update payload is invalid.' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_object_keys(p_features)) > 100 then
    raise exception 'Feature update payload is too large.' using errcode = '22023';
  end if;

  v_is_platform_manager := public.feature_access_platform_can_manage();

  for v_entry in
    select key, value
    from jsonb_each_text(p_features)
  loop
    v_feature_key := public.feature_access_normalize_feature_key(v_entry.key);
    v_status := public.feature_access_normalize_status(v_entry.value);
    v_source := 'manual';

    if v_feature_key = any (public.feature_access_core_keys()) and v_status <> 'enabled' then
      raise exception 'Core workspace features cannot be disabled.' using errcode = '22023';
    end if;

    if v_feature_key = any (public.subscription_entitlements_global_locked_features())
       and v_status <> 'coming_soon' then
      raise exception 'This feature is globally locked until platform launch readiness is complete.'
        using errcode = '22023';
    end if;

    if v_status = 'locked_by_plan' and not v_is_platform_manager then
      raise exception 'Only platform owners/admins can lock features by plan.' using errcode = '42501';
    end if;

    if v_status = 'locked_by_plan' then
      v_source := 'plan';
    elsif v_status = 'coming_soon' then
      v_source := 'system';
    end if;

    select fer.status
    into v_old_status
    from public.feature_access_effective_rows(p_tenant_id) fer
    where fer.feature_key = v_feature_key
    limit 1;

    insert into public.tenant_feature_settings (
      tenant_id,
      feature_key,
      status,
      source,
      configured_by,
      configured_at,
      metadata_json
    )
    values (
      p_tenant_id,
      v_feature_key,
      v_status,
      v_source,
      auth.uid(),
      now(),
      case
        when v_feature_key = any (public.subscription_entitlements_global_locked_features())
          then jsonb_build_object(
            'canonical_global_lock', true,
            'global_lock_source', 'module71_7_global_lock'
          )
        else '{}'::jsonb
      end
    )
    on conflict (tenant_id, feature_key) do update
    set status = excluded.status,
        source = excluded.source,
        configured_by = excluded.configured_by,
        configured_at = excluded.configured_at,
        metadata_json = excluded.metadata_json,
        updated_at = now();

    perform public.feature_access_write_activity(
      p_tenant_id,
      v_feature_key,
      'tenant_feature_bulk_updated',
      v_old_status,
      v_status,
      v_source,
      jsonb_build_object(
        'bulk', true,
        'canonical_global_lock',
          v_feature_key = any (public.subscription_entitlements_global_locked_features())
      )
    );
  end loop;

  return public.get_tenant_feature_access(p_tenant_id);
end;
$$;

revoke all on function public.feature_access_effective_rows(uuid) from public, anon, authenticated;
revoke all on function public.update_tenant_feature_access(uuid, text, text) from public, anon, authenticated;
revoke all on function public.bulk_update_tenant_feature_access(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.update_tenant_feature_access(uuid, text, text) to authenticated;
grant execute on function public.bulk_update_tenant_feature_access(uuid, jsonb) to authenticated;

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Confirm canonical global locks:
-- select public.subscription_entitlements_global_locked_features();
--
-- 2. Confirm Module 62 app read returns globally locked features as coming_soon:
-- select feature
-- from jsonb_array_elements(
--   public.get_tenant_feature_access('29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid)->'features'
-- ) as feature
-- where feature->>'feature_key' in ('payment_gateway', 'live_classes');
--
-- 3. Confirm effective rows include canonical lock metadata:
-- select feature_key, status, source, metadata_json
-- from public.feature_access_effective_rows('29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid)
-- where feature_key in ('payment_gateway', 'live_classes');
--
-- 4. Confirm attempts to enable globally locked keys reject with SQLSTATE 22023:
-- select public.update_tenant_feature_access(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'payment_gateway',
--   'enabled'
-- );
--
-- select public.bulk_update_tenant_feature_access(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   '{"live_classes":"enabled"}'::jsonb
-- );
--
-- 5. Confirm setting globally locked keys to coming_soon remains allowed:
-- select public.update_tenant_feature_access(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'payment_gateway',
--   'coming_soon'
-- );
--
-- 6. Confirm canonical resolver still returns global_coming_soon:
-- select feature
-- from jsonb_array_elements(
--   public.resolve_effective_feature_access(
--     '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--     null
--   )->'features'
-- ) as feature
-- where feature->>'feature_key' in ('payment_gateway', 'live_classes');
--
-- 7. Confirm public catalog remains empty:
-- select public.get_public_plan_catalog();
--
-- 8. Confirm regression tenant canonical assignment unchanged:
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- 9. Confirm existing Growth request remains approved/blocked:
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- Rollback SQL for later review only:
-- Re-apply Module 62 function definitions for:
-- - public.feature_access_effective_rows(uuid)
-- - public.update_tenant_feature_access(uuid, text, text)
-- - public.bulk_update_tenant_feature_access(uuid, jsonb)
-- from supabase/module62_feature_access.sql.
