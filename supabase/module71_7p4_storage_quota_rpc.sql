-- Module 71.7P4: Storage Usage Snapshot + Quota RPC SQL Proposal
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Add read-only canonical document storage usage visibility.
-- - Add a canonical quota assertion RPC for future document upload wiring.
-- - Do not upload files, mutate document metadata, assign plans, activate
--   checkout, activate payment gateway, or change public plan visibility.
--
-- Design note:
-- This draft intentionally does not add a reservation table yet. The quota
-- assertion uses a tenant-scoped advisory transaction lock, which protects
-- concurrent checks within the SQL transaction only. The later P5 upload route
-- integration should decide whether a stronger reservation/finalization table
-- is required for upload-time race safety.

begin;

create or replace function public.get_tenant_document_storage_usage(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_storage_limit_mb integer;
  v_document_upload_limit integer;
  v_storage_limit_bytes bigint;
  v_used_storage_bytes bigint := 0;
  v_uploaded_document_count integer := 0;
  v_pending_or_failed_document_count integer := 0;
  v_remaining_storage_bytes bigint;
  v_remaining_document_uploads integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Document storage usage access denied.' using errcode = '42501';
  end if;

  v_state := public.get_tenant_entitlement_state(p_tenant_id);

  select nullif(limit_item->>'limit_value', '')::integer
  into v_storage_limit_mb
  from jsonb_array_elements(coalesce(v_state->'limits', '[]'::jsonb)) as limit_item
  where limit_item->>'resource_key' = 'storage_mb'
  limit 1;

  select nullif(limit_item->>'limit_value', '')::integer
  into v_document_upload_limit
  from jsonb_array_elements(coalesce(v_state->'limits', '[]'::jsonb)) as limit_item
  where limit_item->>'resource_key' = 'document_uploads'
  limit 1;

  select
    coalesce(sum(coalesce(dr.file_size_bytes, 0)), 0)::bigint,
    count(*)::integer
  into v_used_storage_bytes, v_uploaded_document_count
  from public.document_records dr
  where dr.tenant_id = p_tenant_id
    and dr.status = 'active'
    and dr.upload_status = 'uploaded'
    and dr.storage_bucket = public.document_storage_bucket_name()
    and dr.storage_path is not null
    and dr.file_size_bytes is not null
    and dr.file_size_bytes > 0;

  select count(*)::integer
  into v_pending_or_failed_document_count
  from public.document_records dr
  where dr.tenant_id = p_tenant_id
    and dr.status = 'active'
    and dr.upload_status = 'pending_upload';

  v_storage_limit_bytes :=
    case
      when v_storage_limit_mb is null then null
      else (v_storage_limit_mb::bigint * 1024::bigint * 1024::bigint)
    end;

  v_remaining_storage_bytes :=
    case
      when v_storage_limit_bytes is null then null
      else greatest(v_storage_limit_bytes - v_used_storage_bytes, 0)
    end;

  v_remaining_document_uploads :=
    case
      when v_document_upload_limit is null then null
      else greatest(v_document_upload_limit - v_uploaded_document_count, 0)
    end;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'used_storage_bytes', v_used_storage_bytes,
    'used_storage_mb', round((v_used_storage_bytes::numeric / 1024 / 1024), 2),
    'uploaded_document_count', v_uploaded_document_count,
    'pending_or_failed_document_count', v_pending_or_failed_document_count,
    'storage_limit_mb', v_storage_limit_mb,
    'storage_limit_bytes', v_storage_limit_bytes,
    'document_upload_limit', v_document_upload_limit,
    'remaining_storage_bytes', v_remaining_storage_bytes,
    'remaining_document_uploads', v_remaining_document_uploads,
    'over_storage_limit',
      case
        when v_storage_limit_bytes is null then false
        else v_used_storage_bytes > v_storage_limit_bytes
      end,
    'over_document_upload_limit',
      case
        when v_document_upload_limit is null then false
        else v_uploaded_document_count > v_document_upload_limit
      end,
    'has_canonical_assignment', coalesce((v_state->'assignment') is not null and jsonb_typeof(v_state->'assignment') = 'object', false),
    'source', 'canonical_document_storage_usage'
  );
end;
$$;

create or replace function public.assert_tenant_document_upload_quota(
  p_tenant_id uuid,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage jsonb;
  v_state jsonb;
  v_assignment jsonb;
  v_used_storage_bytes bigint;
  v_uploaded_document_count integer;
  v_storage_limit_mb integer;
  v_storage_limit_bytes bigint;
  v_document_upload_limit integer;
  v_projected_storage_bytes bigint;
  v_projected_document_uploads integer;
  v_remaining_storage_bytes bigint;
  v_remaining_document_uploads integer;
  v_storage_warning boolean := false;
  v_document_upload_warning boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    raise exception 'File size must be greater than zero.' using errcode = '22023';
  end if;

  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Document upload quota access denied.' using errcode = '42501';
  end if;

  -- Protect concurrent quota checks in this SQL transaction. This is not a
  -- full upload reservation; P5 should add reservation/finalization if needed.
  perform pg_advisory_xact_lock(hashtextextended('document_upload_quota:' || p_tenant_id::text, 7174));

  v_state := public.get_tenant_entitlement_state(p_tenant_id);
  v_assignment := v_state->'assignment';

  if v_assignment is null or jsonb_typeof(v_assignment) <> 'object' then
    raise exception 'A canonical subscription assignment is required before document uploads can be quota-checked.'
      using errcode = '22023';
  end if;

  v_usage := public.get_tenant_document_storage_usage(p_tenant_id);

  v_used_storage_bytes := coalesce((v_usage->>'used_storage_bytes')::bigint, 0);
  v_uploaded_document_count := coalesce((v_usage->>'uploaded_document_count')::integer, 0);
  v_storage_limit_mb := nullif(v_usage->>'storage_limit_mb', '')::integer;
  v_storage_limit_bytes := nullif(v_usage->>'storage_limit_bytes', '')::bigint;
  v_document_upload_limit := nullif(v_usage->>'document_upload_limit', '')::integer;

  if v_storage_limit_mb is null or v_storage_limit_bytes is null or v_storage_limit_bytes <= 0 then
    raise exception 'Canonical storage quota is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  if v_document_upload_limit is null or v_document_upload_limit < 0 then
    raise exception 'Canonical document upload limit is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  v_projected_storage_bytes := v_used_storage_bytes + p_file_size_bytes;
  v_projected_document_uploads := v_uploaded_document_count + 1;
  v_remaining_storage_bytes := greatest(v_storage_limit_bytes - v_projected_storage_bytes, 0);
  v_remaining_document_uploads := greatest(v_document_upload_limit - v_projected_document_uploads, 0);

  if v_projected_storage_bytes > v_storage_limit_bytes then
    raise exception 'Document upload would exceed the tenant storage quota.'
      using errcode = '22023';
  end if;

  if v_projected_document_uploads > v_document_upload_limit then
    raise exception 'Document upload would exceed the tenant document upload limit.'
      using errcode = '22023';
  end if;

  v_storage_warning :=
    v_storage_limit_bytes > 0
    and v_projected_storage_bytes >= ceil(v_storage_limit_bytes::numeric * 0.8);

  v_document_upload_warning :=
    v_document_upload_limit > 0
    and v_projected_document_uploads >= ceil(v_document_upload_limit::numeric * 0.8);

  return jsonb_build_object(
    'allowed', true,
    'tenant_id', p_tenant_id,
    'file_size_bytes', p_file_size_bytes,
    'used_storage_bytes', v_used_storage_bytes,
    'projected_storage_bytes', v_projected_storage_bytes,
    'storage_limit_mb', v_storage_limit_mb,
    'storage_limit_bytes', v_storage_limit_bytes,
    'remaining_storage_bytes', v_remaining_storage_bytes,
    'uploaded_document_count', v_uploaded_document_count,
    'projected_document_uploads', v_projected_document_uploads,
    'document_upload_limit', v_document_upload_limit,
    'remaining_document_uploads', v_remaining_document_uploads,
    'storage_warning', v_storage_warning,
    'document_upload_warning', v_document_upload_warning,
    'warning',
      v_storage_warning or v_document_upload_warning,
    'reason', 'allowed',
    'source', 'canonical_document_upload_quota'
  );
end;
$$;

revoke all on function public.get_tenant_document_storage_usage(uuid) from public, anon, authenticated;
revoke all on function public.assert_tenant_document_upload_quota(uuid, bigint) from public, anon, authenticated;

grant execute on function public.get_tenant_document_storage_usage(uuid) to authenticated;
grant execute on function public.assert_tenant_document_upload_quota(uuid, bigint) to authenticated;

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Confirm RPCs exist:
-- select routine_name
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name in (
--     'get_tenant_document_storage_usage',
--     'assert_tenant_document_upload_quota'
--   )
-- order by routine_name;
--
-- 2. Confirm direct document storage table grants were not opened by this patch:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('document_records')
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
-- order by table_name, grantee, privilege_type;
--
-- 3. Confirm execute grants are authenticated-only for the new RPCs:
-- select grantee, routine_name, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name in (
--     'get_tenant_document_storage_usage',
--     'assert_tenant_document_upload_quota'
--   )
-- order by routine_name, grantee;
--
-- 4. Regression tenant read smoke:
-- select public.get_tenant_document_storage_usage(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 5. Regression tenant quota check smoke with a 1 MB dry-run file:
-- select public.assert_tenant_document_upload_quota(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   1048576::bigint
-- );
--
-- 6. Confirm starter storage/document limits are still configured:
-- select p.code, spl.resource_key, spl.limit_value, spl.limit_type, spl.enforcement_mode
-- from public.subscription_plans p
-- join public.subscription_plan_usage_limits spl on spl.plan_id = p.id
-- where p.code = 'starter'
--   and spl.resource_key in ('storage_mb', 'document_uploads')
-- order by spl.resource_key;
--
-- 7. Confirm Growth/Premium storage/document limits remain configured:
-- select p.code, spl.resource_key, spl.limit_value, spl.limit_type, spl.enforcement_mode
-- from public.subscription_plans p
-- join public.subscription_plan_usage_limits spl on spl.plan_id = p.id
-- where p.code in ('growth', 'premium')
--   and spl.resource_key in ('storage_mb', 'document_uploads')
-- order by p.code, spl.resource_key;
--
-- 8. Confirm public catalog remains empty while plans stay draft/private:
-- select public.get_public_plan_catalog();
--
-- 9. Confirm regression tenant canonical assignment unchanged:
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- 10. Confirm existing Growth request remains approved/blocked:
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- Rollback SQL for later review only:
-- begin;
-- revoke all on function public.assert_tenant_document_upload_quota(uuid, bigint) from public, anon, authenticated;
-- revoke all on function public.get_tenant_document_storage_usage(uuid) from public, anon, authenticated;
-- drop function if exists public.assert_tenant_document_upload_quota(uuid, bigint);
-- drop function if exists public.get_tenant_document_storage_usage(uuid);
-- commit;
