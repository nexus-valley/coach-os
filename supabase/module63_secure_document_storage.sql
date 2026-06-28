-- Module 63: Secure Document Upload & Storage
-- Review before execution. Do not execute automatically.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'coachfort-documents',
  'coachfort-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.document_records
  add column if not exists file_name text,
  add column if not exists file_mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists upload_status text not null default 'metadata_only',
  add column if not exists file_uploaded_at timestamptz,
  add column if not exists file_uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists file_removed_at timestamptz,
  add column if not exists file_removed_by uuid references auth.users(id) on delete set null;

update public.document_records
set upload_status = 'metadata_only'
where upload_status is null
   or upload_status = 'archived';

update public.document_records
set file_size_bytes = null
where file_size_bytes is not null
  and (file_size_bytes < 1 or file_size_bytes > 10485760);

alter table public.document_records
  alter column upload_status set default 'metadata_only',
  alter column upload_status set not null;

alter table public.document_records
  drop constraint if exists document_records_upload_status_check,
  drop constraint if exists document_records_upload_status_safe_check,
  drop constraint if exists document_records_file_size_bytes_check,
  drop constraint if exists document_records_file_size_bytes_safe_check,
  drop constraint if exists document_records_file_name_check,
  drop constraint if exists document_records_file_name_safe_check,
  drop constraint if exists document_records_file_mime_type_check,
  drop constraint if exists document_records_file_mime_type_safe_check,
  drop constraint if exists document_records_storage_bucket_check,
  drop constraint if exists document_records_storage_bucket_safe_check,
  drop constraint if exists document_records_storage_path_check,
  drop constraint if exists document_records_storage_path_safe_check;

alter table public.document_records
  add constraint document_records_upload_status_safe_check check (
    upload_status in ('metadata_only', 'pending_upload', 'uploaded', 'removed')
  ),
  add constraint document_records_file_size_bytes_safe_check check (
    file_size_bytes is null or file_size_bytes between 1 and 10485760
  ),
  add constraint document_records_file_name_safe_check check (
    file_name is null or char_length(file_name) <= 240
  ),
  add constraint document_records_file_mime_type_safe_check check (
    file_mime_type is null or char_length(file_mime_type) <= 160
  ),
  add constraint document_records_storage_bucket_safe_check check (
    storage_bucket is null or char_length(storage_bucket) <= 120
  ),
  add constraint document_records_storage_path_safe_check check (
    storage_path is null or char_length(storage_path) <= 700
  );

create index if not exists document_records_storage_reference_idx
  on public.document_records (storage_bucket, storage_path)
  where storage_bucket is not null and storage_path is not null;

create index if not exists document_records_upload_status_idx
  on public.document_records (tenant_id, upload_status);

alter table public.document_activity_logs
  drop constraint if exists document_activity_logs_action_check;

alter table public.document_activity_logs
  add constraint document_activity_logs_action_check check (
    action in (
      'document_created',
      'document_updated',
      'document_archived',
      'document_viewed',
      'document_reference_opened',
      'document_visibility_changed',
      'document_file_upload_prepared',
      'document_file_uploaded',
      'document_file_replaced',
      'document_file_removed',
      'document_download_url_requested',
      'document_download_unauthorized'
    )
  );

create or replace function public.document_storage_bucket_name()
returns text
language sql
immutable
set search_path = public
as $$
  select 'coachfort-documents'::text;
$$;

create or replace function public.document_storage_max_file_size_bytes()
returns bigint
language sql
immutable
set search_path = public
as $$
  select 10485760::bigint;
$$;

create or replace function public.document_storage_allowed_mime_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[];
$$;

create or replace function public.document_storage_validate_file(
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_file_name text := trim(coalesce(p_file_name, ''));
  v_mime_type text := lower(trim(coalesce(p_file_mime_type, '')));
  v_extension text;
begin
  if v_file_name = '' or char_length(v_file_name) > 240 then
    raise exception 'File name is required and must be 240 characters or fewer.'
      using errcode = '22023';
  end if;

  if position('/' in v_file_name) > 0
     or position(chr(92) in v_file_name) > 0
     or v_file_name in ('.', '..')
     or v_file_name like '%.%'
        and (v_file_name like '../%' or v_file_name like '%/../%') then
    raise exception 'File name is invalid.' using errcode = '22023';
  end if;

  if v_file_name ~ '[<>:"|?*]' then
    raise exception 'File name contains unsupported characters.' using errcode = '22023';
  end if;

  if p_file_size_bytes is null
     or p_file_size_bytes <= 0
     or p_file_size_bytes > public.document_storage_max_file_size_bytes() then
    raise exception 'File size is invalid or exceeds the 10 MB limit.'
      using errcode = '22023';
  end if;

  if v_mime_type = ''
     or not (v_mime_type = any (public.document_storage_allowed_mime_types())) then
    raise exception 'File type is not allowed.' using errcode = '22023';
  end if;

  v_extension := lower(coalesce(nullif(regexp_replace(v_file_name, '^.*\.', ''), v_file_name), ''));

  if v_extension not in ('pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx') then
    raise exception 'File extension is not allowed.' using errcode = '22023';
  end if;

  if v_extension in ('png') and v_mime_type <> 'image/png' then
    raise exception 'File extension and MIME type do not match.' using errcode = '22023';
  end if;

  if v_extension in ('jpg', 'jpeg') and v_mime_type <> 'image/jpeg' then
    raise exception 'File extension and MIME type do not match.' using errcode = '22023';
  end if;

  if v_extension = 'pdf' and v_mime_type <> 'application/pdf' then
    raise exception 'File extension and MIME type do not match.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.document_storage_sanitize_file_name(p_file_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_file_name, ''));
begin
  v_name := regexp_replace(v_name, '[\/\\]+', '-', 'g');
  v_name := regexp_replace(v_name, '[^A-Za-z0-9._ -]+', '-', 'g');
  v_name := regexp_replace(v_name, '\s+', '-', 'g');
  v_name := regexp_replace(v_name, '-+', '-', 'g');
  v_name := trim(both '-.' from v_name);

  if v_name = '' then
    v_name := 'document';
  end if;

  return left(v_name, 160);
end;
$$;

create or replace function public.document_storage_feature_enabled(
  p_tenant_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.feature_access_effective_rows(p_tenant_id) far
    where far.feature_key = p_feature_key
      and far.status = 'enabled'
  ), false);
$$;

create or replace function public.prepare_document_file_upload(
  p_document_id uuid,
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.document_records%rowtype;
  v_safe_file_name text;
  v_storage_bucket text := public.document_storage_bucket_name();
  v_storage_path text;
  v_previous_path text;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into v_document
  from public.document_records dr
  where dr.id = p_document_id
  for update;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not public.document_center_is_owner_admin(v_document.tenant_id) then
    raise exception 'Only owners and admins can upload document files.' using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'documents') then
    raise exception 'Document Center is not enabled for this workspace.' using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'document_uploads') then
    raise exception 'Document uploads are not enabled for this workspace.' using errcode = '42501';
  end if;

  if v_document.status <> 'active' then
    raise exception 'Archived documents cannot receive file uploads.' using errcode = '22023';
  end if;

  perform public.document_storage_validate_file(
    p_file_name,
    p_file_mime_type,
    p_file_size_bytes
  );

  v_safe_file_name := public.document_storage_sanitize_file_name(p_file_name);
  v_storage_path := concat(
    'tenant/',
    v_document.tenant_id,
    '/documents/',
    v_document.id,
    '/',
    v_safe_file_name
  );
  v_previous_path := v_document.storage_path;

  update public.document_records
  set
    file_name = v_safe_file_name,
    file_mime_type = lower(trim(p_file_mime_type)),
    file_size_bytes = p_file_size_bytes,
    storage_bucket = v_storage_bucket,
    storage_path = v_storage_path,
    upload_status = 'pending_upload',
    updated_by = v_actor
  where id = p_document_id;

  perform public.document_center_write_activity(
    v_document.tenant_id,
    p_document_id,
    v_actor,
    null,
    'document_file_upload_prepared',
    jsonb_build_object(
      'document_id', p_document_id,
      'file_name', v_safe_file_name,
      'file_mime_type', lower(trim(p_file_mime_type)),
      'file_size_bytes', p_file_size_bytes,
      'replacing_existing_file', v_document.storage_path is not null
    )
  );

  return jsonb_build_object(
    'tenant_id', v_document.tenant_id,
    'document_id', p_document_id,
    'storage_bucket', v_storage_bucket,
    'storage_path', v_storage_path,
    'previous_storage_bucket', v_document.storage_bucket,
    'previous_storage_path', v_previous_path,
    'file_name', v_safe_file_name,
    'file_mime_type', lower(trim(p_file_mime_type)),
    'file_size_bytes', p_file_size_bytes
  );
end;
$$;

create or replace function public.mark_document_file_uploaded(
  p_document_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.document_records%rowtype;
  v_action text;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into v_document
  from public.document_records dr
  where dr.id = p_document_id
  for update;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not public.document_center_is_owner_admin(v_document.tenant_id) then
    raise exception 'Only owners and admins can mark document uploads complete.' using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'documents') then
    raise exception 'Document Center is not enabled for this workspace.' using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'document_uploads') then
    raise exception 'Document uploads are not enabled for this workspace.' using errcode = '42501';
  end if;

  if v_document.upload_status <> 'pending_upload' then
    raise exception 'Document upload has not been prepared.' using errcode = '22023';
  end if;

  if v_document.storage_bucket is distinct from p_storage_bucket
     or v_document.storage_path is distinct from p_storage_path then
    raise exception 'Prepared storage reference does not match uploaded file.' using errcode = '22023';
  end if;

  if p_storage_bucket <> public.document_storage_bucket_name()
     or p_storage_path is null
     or p_storage_path !~ ('^tenant/' || v_document.tenant_id || '/documents/' || v_document.id || '/[^/]+$') then
    raise exception 'Storage reference is invalid.' using errcode = '22023';
  end if;

  perform public.document_storage_validate_file(
    p_file_name,
    p_file_mime_type,
    p_file_size_bytes
  );

  v_action := case when v_document.file_uploaded_at is null then 'document_file_uploaded' else 'document_file_replaced' end;

  update public.document_records
  set
    file_name = public.document_storage_sanitize_file_name(p_file_name),
    file_mime_type = lower(trim(p_file_mime_type)),
    file_size_bytes = p_file_size_bytes,
    storage_bucket = p_storage_bucket,
    storage_path = p_storage_path,
    upload_status = 'uploaded',
    file_uploaded_at = now(),
    file_uploaded_by = v_actor,
    file_removed_at = null,
    file_removed_by = null,
    updated_by = v_actor
  where id = p_document_id;

  perform public.document_center_write_activity(
    v_document.tenant_id,
    p_document_id,
    v_actor,
    null,
    v_action,
    jsonb_build_object(
      'document_id', p_document_id,
      'file_name', public.document_storage_sanitize_file_name(p_file_name),
      'file_mime_type', lower(trim(p_file_mime_type)),
      'file_size_bytes', p_file_size_bytes
    )
  );

  return jsonb_build_object('document_id', p_document_id, 'status', 'uploaded');
end;
$$;

create or replace function public.prepare_document_file_removal(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.document_records%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into v_document
  from public.document_records dr
  where dr.id = p_document_id
  for update;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not public.document_center_is_owner_admin(v_document.tenant_id) then
    raise exception 'Only owners and admins can remove document files.' using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'document_uploads') then
    raise exception 'Document uploads are not enabled for this workspace.' using errcode = '42501';
  end if;

  if v_document.storage_bucket is null or v_document.storage_path is null then
    raise exception 'Document has no uploaded file.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'tenant_id', v_document.tenant_id,
    'document_id', p_document_id,
    'storage_bucket', v_document.storage_bucket,
    'storage_path', v_document.storage_path,
    'file_name', v_document.file_name
  );
end;
$$;

create or replace function public.mark_document_file_removed(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.document_records%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into v_document
  from public.document_records dr
  where dr.id = p_document_id
  for update;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not public.document_center_is_owner_admin(v_document.tenant_id) then
    raise exception 'Only owners and admins can remove document files.' using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'documents') then
    raise exception 'Document Center is not enabled for this workspace.' using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'document_uploads') then
    raise exception 'Document uploads are not enabled for this workspace.' using errcode = '42501';
  end if;

  update public.document_records
  set
    storage_bucket = null,
    storage_path = null,
    -- Keep metadata_only for Module 59 compatibility: existing metadata edit
    -- RPCs treat upload_status as a metadata state and do not accept removed.
    upload_status = 'metadata_only',
    file_removed_at = now(),
    file_removed_by = v_actor,
    updated_by = v_actor
  where id = p_document_id;

  perform public.document_center_write_activity(
    v_document.tenant_id,
    p_document_id,
    v_actor,
    null,
    'document_file_removed',
    jsonb_build_object(
      'document_id', p_document_id,
      'file_name_present', v_document.file_name is not null
    )
  );

  return jsonb_build_object('document_id', p_document_id, 'status', 'removed');
end;
$$;

create or replace function public.get_authorized_document_storage_reference(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.document_records%rowtype;
  v_allowed boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into v_document
  from public.document_records dr
  where dr.id = p_document_id;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if public.document_center_team_can_access_document(p_document_id) then
    v_allowed := true;
  elsif public.document_center_student_can_access_document(p_document_id) then
    v_allowed := true;
  end if;

  if not coalesce(v_allowed, false) then
    perform public.document_center_write_activity(
      v_document.tenant_id,
      p_document_id,
      v_actor,
      null,
      'document_download_unauthorized',
      jsonb_build_object(
        'document_id', p_document_id,
        'reason', 'access_denied'
      )
    );

    raise exception 'Document access denied.' using errcode = '42501';
  end if;

  if v_document.status <> 'active'
     or v_document.upload_status <> 'uploaded'
     or v_document.storage_bucket is null
     or v_document.storage_path is null
     or v_document.file_name is null then
    raise exception 'No uploaded file is available for this document.' using errcode = '22023';
  end if;

  if v_document.storage_bucket <> public.document_storage_bucket_name()
     or v_document.storage_path !~ ('^tenant/' || v_document.tenant_id || '/documents/' || v_document.id || '/[^/]+$')
     or v_document.storage_path like '%..%' then
    raise exception 'Document storage reference is invalid.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'document_id', v_document.id,
    'tenant_id', v_document.tenant_id,
    'storage_bucket', v_document.storage_bucket,
    'storage_path', v_document.storage_path,
    'file_name', v_document.file_name,
    'file_mime_type', v_document.file_mime_type,
    'file_size_bytes', v_document.file_size_bytes
  );
end;
$$;

create or replace function public.archive_document_record(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  document_row public.document_records%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into document_row
  from public.document_records dr
  where dr.id = p_document_id;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not public.document_center_is_owner_admin(document_row.tenant_id) then
    raise exception 'Only owners and admins can archive documents.' using errcode = '42501';
  end if;

  update public.document_records
  set
    status = 'archived',
    upload_status = case
      when upload_status = 'uploaded' then 'uploaded'
      else 'metadata_only'
    end,
    archived_by = actor_id,
    archived_at = coalesce(archived_at, now()),
    updated_by = actor_id
  where id = p_document_id;

  perform public.document_center_write_activity(
    document_row.tenant_id,
    p_document_id,
    actor_id,
    null,
    'document_archived',
    jsonb_build_object(
      'document_id', p_document_id,
      'document_type', document_row.document_type,
      'previous_status', document_row.status
    )
  );

  return p_document_id;
end;
$$;

create or replace function public.record_document_download_url_requested(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.document_records%rowtype;
  v_student_context record;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into v_document
  from public.document_records dr
  where dr.id = p_document_id;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if public.document_center_team_can_access_document(p_document_id) then
    perform public.document_center_write_activity(
      v_document.tenant_id,
      p_document_id,
      v_actor,
      null,
      'document_download_url_requested',
      jsonb_build_object(
        'document_id', p_document_id,
        'actor_type', 'team',
        'file_name_present', v_document.file_name is not null
      )
    );
    return;
  end if;

  if public.document_center_student_can_access_document(p_document_id) then
    select *
    into v_student_context
    from public.document_center_student_context()
    where tenant_id = v_document.tenant_id
    limit 1;

    perform public.document_center_write_activity(
      v_document.tenant_id,
      p_document_id,
      null,
      v_student_context.student_id,
      'document_download_url_requested',
      jsonb_build_object(
        'document_id', p_document_id,
        'actor_type', 'student',
        'file_name_present', v_document.file_name is not null
      )
    );
    return;
  end if;

  perform public.document_center_write_activity(
    v_document.tenant_id,
    p_document_id,
    v_actor,
    null,
    'document_download_unauthorized',
    jsonb_build_object(
      'document_id', p_document_id,
      'reason', 'access_denied'
    )
  );

  raise exception 'Document access denied.' using errcode = '42501';
end;
$$;

revoke execute on function public.document_storage_bucket_name() from public, anon, authenticated;
revoke execute on function public.document_storage_max_file_size_bytes() from public, anon, authenticated;
revoke execute on function public.document_storage_allowed_mime_types() from public, anon, authenticated;
revoke execute on function public.document_storage_validate_file(text, text, bigint) from public, anon, authenticated;
revoke execute on function public.document_storage_sanitize_file_name(text) from public, anon, authenticated;
revoke execute on function public.document_storage_feature_enabled(uuid, text) from public, anon, authenticated;

revoke execute on function public.prepare_document_file_upload(uuid, text, text, bigint) from public, anon;
revoke execute on function public.mark_document_file_uploaded(uuid, text, text, text, text, bigint) from public, anon;
revoke execute on function public.prepare_document_file_removal(uuid) from public, anon;
revoke execute on function public.mark_document_file_removed(uuid) from public, anon;
revoke execute on function public.get_authorized_document_storage_reference(uuid) from public, anon;
revoke execute on function public.record_document_download_url_requested(uuid) from public, anon;

grant execute on function public.prepare_document_file_upload(uuid, text, text, bigint) to authenticated;
grant execute on function public.mark_document_file_uploaded(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.prepare_document_file_removal(uuid) to authenticated;
grant execute on function public.mark_document_file_removed(uuid) to authenticated;
grant execute on function public.get_authorized_document_storage_reference(uuid) to authenticated;
grant execute on function public.record_document_download_url_requested(uuid) to authenticated;

commit;
