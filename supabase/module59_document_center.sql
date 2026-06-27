-- Module 59: Document Center
-- Review before execution. Do not run until approved.
--
-- Metadata-only document center. This migration does not create Supabase
-- Storage buckets, public URLs, upload policies, or file upload behavior.

create table if not exists public.document_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_type text not null check (
    document_type in ('student', 'course', 'cohort', 'session', 'internal', 'compliance', 'general')
  ),
  title text not null,
  description text,
  category text,
  linked_student_id uuid references public.students(id) on delete restrict,
  linked_course_id uuid references public.courses(id) on delete restrict,
  linked_cohort_id uuid references public.cohorts(id) on delete restrict,
  linked_session_id uuid references public.sessions(id) on delete restrict,
  linked_team_user_id uuid references auth.users(id) on delete restrict,
  file_name text,
  file_mime_type text,
  file_size_bytes bigint,
  storage_bucket text,
  storage_path text,
  external_url text,
  upload_status text not null default 'metadata_only' check (
    upload_status in ('metadata_only', 'pending_upload', 'uploaded', 'archived')
  ),
  visibility_scope text not null default 'owner_admin' check (
    visibility_scope in (
      'owner_admin',
      'linked_student',
      'linked_course',
      'linked_cohort',
      'linked_session',
      'linked_team',
      'role_shared'
    )
  ),
  student_visible boolean not null default false,
  trainer_visible boolean not null default false,
  staff_visible boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  archived_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(title)) between 1 and 180),
  check (description is null or char_length(description) <= 1000),
  check (category is null or char_length(category) <= 80),
  check (file_name is null or char_length(file_name) <= 240),
  check (file_mime_type is null or char_length(file_mime_type) <= 120),
  check (file_size_bytes is null or file_size_bytes >= 0),
  check (storage_bucket is null or char_length(storage_bucket) <= 120),
  check (storage_path is null or char_length(storage_path) <= 500),
  check (
    external_url is null
    or (char_length(external_url) <= 1000 and external_url ~* '^https://')
  ),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 3000),
  constraint document_records_required_link_chk check (
    (document_type = 'student' and linked_student_id is not null)
    or (document_type = 'course' and linked_course_id is not null)
    or (document_type = 'cohort' and linked_cohort_id is not null)
    or (document_type = 'session' and linked_session_id is not null)
    or document_type in ('internal', 'compliance', 'general')
  ),
  constraint document_records_compliance_visibility_chk check (
    document_type <> 'compliance'
    or (
      student_visible = false
      and trainer_visible = false
      and staff_visible = false
    )
  ),
  constraint document_records_internal_student_visibility_chk check (
    document_type <> 'internal'
    or student_visible = false
  ),
  constraint document_records_general_student_visibility_chk check (
    document_type <> 'general'
    or student_visible = false
  )
);

create table if not exists public.document_activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.document_records(id) on delete cascade,
  action text not null check (
    action in (
      'document_created',
      'document_updated',
      'document_archived',
      'document_viewed',
      'document_reference_opened',
      'document_visibility_changed'
    )
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_student_id uuid references public.students(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 3000)
);

create index if not exists document_records_tenant_type_status_idx
on public.document_records (tenant_id, document_type, status, updated_at desc);

create index if not exists document_records_tenant_student_idx
on public.document_records (tenant_id, linked_student_id)
where linked_student_id is not null;

create index if not exists document_records_tenant_course_idx
on public.document_records (tenant_id, linked_course_id)
where linked_course_id is not null;

create index if not exists document_records_tenant_cohort_idx
on public.document_records (tenant_id, linked_cohort_id)
where linked_cohort_id is not null;

create index if not exists document_records_tenant_session_idx
on public.document_records (tenant_id, linked_session_id)
where linked_session_id is not null;

create index if not exists document_activity_logs_document_idx
on public.document_activity_logs (tenant_id, document_id, created_at desc);

drop trigger if exists set_document_records_updated_at on public.document_records;
create trigger set_document_records_updated_at
before update on public.document_records
for each row execute function public.set_updated_at();

alter table public.document_records enable row level security;
alter table public.document_activity_logs enable row level security;

revoke all on public.document_records from anon;
revoke all on public.document_activity_logs from anon;

revoke insert, update, delete on public.document_records from authenticated;
revoke insert, update, delete on public.document_activity_logs from authenticated;

grant select on public.document_records to authenticated;
grant select on public.document_activity_logs to authenticated;

create or replace function public.document_center_current_role(check_tenant_id uuid)
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

create or replace function public.document_center_is_owner_admin(check_tenant_id uuid)
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

  current_member_role := public.document_center_current_role(check_tenant_id);
  return coalesce(current_member_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.document_center_student_context()
returns table (
  tenant_id uuid,
  student_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select spa.tenant_id, spa.student_id
  from public.student_portal_accounts spa
  join public.students s
    on s.id = spa.student_id
   and s.tenant_id = spa.tenant_id
  where spa.user_id = auth.uid()
    and spa.status = 'active'
    and s.status = 'active'
    and coalesce(s.portal_enabled, true) = true
  limit 1;
$$;

create or replace function public.document_center_student_enrolled_course(
  check_tenant_id uuid,
  check_student_id uuid,
  check_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.enrollments e
    where e.tenant_id = check_tenant_id
      and e.student_id = check_student_id
      and e.course_id = check_course_id
      and e.status in ('active', 'completed')
  ), false);
$$;

create or replace function public.document_center_student_in_cohort(
  check_tenant_id uuid,
  check_student_id uuid,
  check_cohort_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.cohort_members cm
    where cm.tenant_id = check_tenant_id
      and cm.student_id = check_student_id
      and cm.cohort_id = check_cohort_id
  ), false);
$$;

create or replace function public.document_center_student_can_access_session(
  check_tenant_id uuid,
  check_student_id uuid,
  check_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.sessions s
    where s.id = check_session_id
      and s.tenant_id = check_tenant_id
      and (
        (
          s.course_id is not null
          and public.document_center_student_enrolled_course(
            check_tenant_id,
            check_student_id,
            s.course_id
          )
        )
        or (
          s.cohort_id is not null
          and public.document_center_student_in_cohort(
            check_tenant_id,
            check_student_id,
            s.cohort_id
          )
        )
      )
  ), false);
$$;

create or replace function public.document_center_trainer_can_access_course(
  check_tenant_id uuid,
  check_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.trainer_course_assignments tca
    where tca.tenant_id = check_tenant_id
      and tca.trainer_user_id = auth.uid()
      and tca.course_id = check_course_id
  ), false);
$$;

create or replace function public.document_center_trainer_can_access_cohort(
  check_tenant_id uuid,
  check_cohort_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.trainer_cohort_assignments tca
    where tca.tenant_id = check_tenant_id
      and tca.trainer_user_id = auth.uid()
      and tca.cohort_id = check_cohort_id
  ), false);
$$;

create or replace function public.document_center_trainer_can_access_session(
  check_tenant_id uuid,
  check_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.sessions s
    where s.id = check_session_id
      and s.tenant_id = check_tenant_id
      and (
        s.trainer_user_id = auth.uid()
        or (
          s.course_id is not null
          and public.document_center_trainer_can_access_course(check_tenant_id, s.course_id)
        )
        or (
          s.cohort_id is not null
          and public.document_center_trainer_can_access_cohort(check_tenant_id, s.cohort_id)
        )
      )
  ), false);
$$;

create or replace function public.document_center_team_can_access_document(check_document_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  document_row public.document_records%rowtype;
  current_member_role text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select dr.*
  into document_row
  from public.document_records dr
  where dr.id = check_document_id;

  if not found then
    return false;
  end if;

  current_member_role := public.document_center_current_role(document_row.tenant_id);

  if current_member_role is null then
    return false;
  end if;

  if current_member_role in ('owner', 'admin') then
    return true;
  end if;

  if document_row.status <> 'active' then
    return false;
  end if;

  if current_member_role = 'staff' then
    return coalesce(
      document_row.staff_visible = true
      and document_row.document_type in ('internal', 'general')
      and document_row.visibility_scope in ('role_shared', 'linked_team'),
      false
    );
  end if;

  if current_member_role = 'trainer' then
    if document_row.trainer_visible <> true then
      return false;
    end if;

    if document_row.document_type = 'course' and document_row.linked_course_id is not null then
      return public.document_center_trainer_can_access_course(
        document_row.tenant_id,
        document_row.linked_course_id
      );
    end if;

    if document_row.document_type = 'cohort' and document_row.linked_cohort_id is not null then
      return public.document_center_trainer_can_access_cohort(
        document_row.tenant_id,
        document_row.linked_cohort_id
      );
    end if;

    if document_row.document_type = 'session' and document_row.linked_session_id is not null then
      return public.document_center_trainer_can_access_session(
        document_row.tenant_id,
        document_row.linked_session_id
      );
    end if;

    return coalesce(
      document_row.document_type = 'general'
      and document_row.visibility_scope = 'role_shared',
      false
    );
  end if;

  return false;
end;
$$;

create or replace function public.document_center_student_can_access_document(check_document_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  document_row public.document_records%rowtype;
  student_context record;
begin
  if auth.uid() is null then
    return false;
  end if;

  select dr.*
  into document_row
  from public.document_records dr
  where dr.id = check_document_id;

  if not found then
    return false;
  end if;

  if document_row.status <> 'active' or document_row.student_visible <> true then
    return false;
  end if;

  if document_row.document_type in ('internal', 'compliance') then
    return false;
  end if;

  select *
  into student_context
  from public.document_center_student_context()
  where tenant_id = document_row.tenant_id
  limit 1;

  if not found then
    return false;
  end if;

  if document_row.document_type = 'student' then
    return coalesce(document_row.linked_student_id = student_context.student_id, false);
  end if;

  if document_row.document_type = 'course' and document_row.linked_course_id is not null then
    return public.document_center_student_enrolled_course(
      document_row.tenant_id,
      student_context.student_id,
      document_row.linked_course_id
    );
  end if;

  if document_row.document_type = 'cohort' and document_row.linked_cohort_id is not null then
    return public.document_center_student_in_cohort(
      document_row.tenant_id,
      student_context.student_id,
      document_row.linked_cohort_id
    );
  end if;

  if document_row.document_type = 'session' and document_row.linked_session_id is not null then
    return public.document_center_student_can_access_session(
      document_row.tenant_id,
      student_context.student_id,
      document_row.linked_session_id
    );
  end if;

  return false;
end;
$$;

drop policy if exists "Document center owner admin can read document records" on public.document_records;
create policy "Document center owner admin can read document records"
on public.document_records
for select
to authenticated
using (public.document_center_is_owner_admin(tenant_id));

drop policy if exists "Document center owner admin can read document activity" on public.document_activity_logs;
create policy "Document center owner admin can read document activity"
on public.document_activity_logs
for select
to authenticated
using (public.document_center_is_owner_admin(tenant_id));

create or replace function public.document_center_validate_text(
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

  if normalized is not null and (position('<' in normalized) > 0 or position('>' in normalized) > 0) then
    raise exception '% cannot contain HTML-like characters.', check_field using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.document_center_validate_metadata(check_metadata jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized jsonb := coalesce(check_metadata, '{}'::jsonb);
begin
  if jsonb_typeof(normalized) <> 'object' then
    raise exception 'metadata_json must be a JSON object.' using errcode = '22023';
  end if;

  if char_length(normalized::text) > 3000 then
    raise exception 'metadata_json is too large.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.document_center_validate_external_url(check_external_url text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(check_external_url, '')), '');
begin
  if normalized is null then
    return null;
  end if;

  if char_length(normalized) > 1000 then
    raise exception 'External URL is too long.' using errcode = '22023';
  end if;

  if normalized !~* '^https://' then
    raise exception 'External URL must use https.' using errcode = '22023';
  end if;

  if position('<' in normalized) > 0 or position('>' in normalized) > 0 then
    raise exception 'External URL cannot contain HTML-like characters.' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.document_center_validate_visibility(
  check_document_type text,
  check_visibility_scope text,
  check_student_visible boolean,
  check_trainer_visible boolean,
  check_staff_visible boolean
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if check_document_type not in ('student', 'course', 'cohort', 'session', 'internal', 'compliance', 'general') then
    raise exception 'Document type is invalid.' using errcode = '22023';
  end if;

  if check_visibility_scope not in (
    'owner_admin',
    'linked_student',
    'linked_course',
    'linked_cohort',
    'linked_session',
    'linked_team',
    'role_shared'
  ) then
    raise exception 'Visibility scope is invalid.' using errcode = '22023';
  end if;

  if check_document_type = 'compliance'
     and (check_student_visible or check_trainer_visible or check_staff_visible) then
    raise exception 'Compliance documents are owner/admin-only in this module.'
      using errcode = '22023';
  end if;

  if check_document_type = 'student' then
    if check_visibility_scope not in ('owner_admin', 'linked_student') then
      raise exception 'Student documents must use owner_admin or linked_student visibility.'
        using errcode = '22023';
    end if;

    if check_student_visible and check_visibility_scope <> 'linked_student' then
      raise exception 'Student-visible student documents must use linked_student visibility.'
        using errcode = '22023';
    end if;

    if check_trainer_visible or check_staff_visible then
      raise exception 'Student documents cannot be trainer-visible or staff-visible in this module.'
        using errcode = '22023';
    end if;
  end if;

  if check_document_type = 'course' then
    if check_visibility_scope not in ('owner_admin', 'linked_course') then
      raise exception 'Course documents must use owner_admin or linked_course visibility.'
        using errcode = '22023';
    end if;

    if (check_student_visible or check_trainer_visible) and check_visibility_scope <> 'linked_course' then
      raise exception 'Student/trainer-visible course documents must use linked_course visibility.'
        using errcode = '22023';
    end if;

    if check_staff_visible then
      raise exception 'Course documents cannot be staff-visible in this module.'
        using errcode = '22023';
    end if;
  end if;

  if check_document_type = 'cohort' then
    if check_visibility_scope not in ('owner_admin', 'linked_cohort') then
      raise exception 'Cohort documents must use owner_admin or linked_cohort visibility.'
        using errcode = '22023';
    end if;

    if (check_student_visible or check_trainer_visible) and check_visibility_scope <> 'linked_cohort' then
      raise exception 'Student/trainer-visible cohort documents must use linked_cohort visibility.'
        using errcode = '22023';
    end if;

    if check_staff_visible then
      raise exception 'Cohort documents cannot be staff-visible in this module.'
        using errcode = '22023';
    end if;
  end if;

  if check_document_type = 'session' then
    if check_visibility_scope not in ('owner_admin', 'linked_session') then
      raise exception 'Session documents must use owner_admin or linked_session visibility.'
        using errcode = '22023';
    end if;

    if (check_student_visible or check_trainer_visible) and check_visibility_scope <> 'linked_session' then
      raise exception 'Student/trainer-visible session documents must use linked_session visibility.'
        using errcode = '22023';
    end if;

    if check_staff_visible then
      raise exception 'Session documents cannot be staff-visible in this module.'
        using errcode = '22023';
    end if;
  end if;

  if check_document_type = 'internal' then
    if check_student_visible then
      raise exception 'Internal documents cannot be student-visible.'
        using errcode = '22023';
    end if;

    if (check_trainer_visible or check_staff_visible)
       and check_visibility_scope not in ('role_shared', 'linked_team') then
      raise exception 'Trainer/staff-visible internal documents must use role_shared or linked_team visibility.'
        using errcode = '22023';
    end if;
  end if;

  if check_document_type = 'general' then
    if check_student_visible then
      raise exception 'General documents cannot be student-visible in this module.'
        using errcode = '22023';
    end if;

    if (check_trainer_visible or check_staff_visible)
       and check_visibility_scope <> 'role_shared' then
      raise exception 'Trainer/staff-visible general documents must use role_shared visibility.'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.document_center_validate_links(
  p_tenant_id uuid,
  p_document_type text,
  p_linked_student_id uuid,
  p_linked_course_id uuid,
  p_linked_cohort_id uuid,
  p_linked_session_id uuid,
  p_linked_team_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_document_type = 'student' then
    if p_linked_student_id is null then
      raise exception 'Student document requires linked_student_id.' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.students s
      where s.id = p_linked_student_id and s.tenant_id = p_tenant_id
    ) then
      raise exception 'Linked student does not belong to this tenant.' using errcode = '22023';
    end if;
  elsif p_linked_student_id is not null then
    if not exists (
      select 1 from public.students s
      where s.id = p_linked_student_id and s.tenant_id = p_tenant_id
    ) then
      raise exception 'Linked student does not belong to this tenant.' using errcode = '22023';
    end if;
  end if;

  if p_document_type = 'course' then
    if p_linked_course_id is null then
      raise exception 'Course document requires linked_course_id.' using errcode = '22023';
    end if;
  end if;

  if p_linked_course_id is not null and not exists (
    select 1 from public.courses c
    where c.id = p_linked_course_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Linked course does not belong to this tenant.' using errcode = '22023';
  end if;

  if p_document_type = 'cohort' then
    if p_linked_cohort_id is null then
      raise exception 'Cohort document requires linked_cohort_id.' using errcode = '22023';
    end if;
  end if;

  if p_linked_cohort_id is not null and not exists (
    select 1 from public.cohorts c
    where c.id = p_linked_cohort_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Linked cohort does not belong to this tenant.' using errcode = '22023';
  end if;

  if p_document_type = 'session' then
    if p_linked_session_id is null then
      raise exception 'Session document requires linked_session_id.' using errcode = '22023';
    end if;
  end if;

  if p_linked_session_id is not null and not exists (
    select 1 from public.sessions s
    where s.id = p_linked_session_id and s.tenant_id = p_tenant_id
  ) then
    raise exception 'Linked session does not belong to this tenant.' using errcode = '22023';
  end if;

  if p_linked_team_user_id is not null and not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_linked_team_user_id
      and tm.role in ('owner', 'admin', 'staff', 'trainer')
  ) then
    raise exception 'Linked team user does not belong to this tenant.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.document_center_safe_document_json(
  document_row public.document_records,
  include_sensitive_fields boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'id', document_row.id,
    'tenant_id', document_row.tenant_id,
    'document_type', document_row.document_type,
    'title', document_row.title,
    'description', document_row.description,
    'category', document_row.category,
    'linked_student_id', document_row.linked_student_id,
    'linked_course_id', document_row.linked_course_id,
    'linked_cohort_id', document_row.linked_cohort_id,
    'linked_session_id', document_row.linked_session_id,
    'linked_team_user_id', document_row.linked_team_user_id,
    'file_name', document_row.file_name,
    'file_mime_type', document_row.file_mime_type,
    'file_size_bytes', document_row.file_size_bytes,
    'external_url', case when include_sensitive_fields then document_row.external_url else null end,
    'upload_status', document_row.upload_status,
    'visibility_scope', document_row.visibility_scope,
    'student_visible', document_row.student_visible,
    'trainer_visible', document_row.trainer_visible,
    'staff_visible', document_row.staff_visible,
    'status', document_row.status,
    'created_at', document_row.created_at,
    'updated_at', document_row.updated_at,
    'archived_at', document_row.archived_at
  );
end;
$$;

create or replace function public.document_center_write_activity(
  p_tenant_id uuid,
  p_document_id uuid,
  p_actor_user_id uuid,
  p_actor_student_id uuid,
  p_action text,
  p_metadata_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
begin
  if jsonb_typeof(safe_metadata) <> 'object' then
    raise exception 'Activity metadata must be a JSON object.' using errcode = '22023';
  end if;

  if char_length(safe_metadata::text) > 3000 then
    raise exception 'Activity metadata is too large.' using errcode = '22023';
  end if;

  insert into public.document_activity_logs (
    tenant_id,
    document_id,
    action,
    actor_user_id,
    actor_student_id,
    metadata_json
  )
  values (
    p_tenant_id,
    p_document_id,
    p_action,
    p_actor_user_id,
    p_actor_student_id,
    safe_metadata
  );

  if p_actor_user_id is not null then
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
      p_actor_user_id,
      p_action,
      'document_record',
      p_document_id,
      'Document Center',
      'Document center event recorded.',
      case when p_action = 'document_archived' then 'warning' else 'info' end,
      safe_metadata
    );
  end if;
end;
$$;

create or replace function public.get_document_center_dashboard(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_role text;
  documents_json jsonb;
  summary_json jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  current_member_role := public.document_center_current_role(p_tenant_id);

  if current_member_role is null then
    raise exception 'Document center access denied.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      public.document_center_safe_document_json(dr, true)
      order by dr.updated_at desc
    ),
    '[]'::jsonb
  )
  into documents_json
  from public.document_records dr
  where dr.tenant_id = p_tenant_id
    and public.document_center_team_can_access_document(dr.id);

  select jsonb_build_object(
    'total_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id)),
    'active_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.status = 'active'),
    'archived_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.status = 'archived'),
    'student_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.document_type = 'student'),
    'course_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.document_type = 'course'),
    'cohort_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.document_type = 'cohort'),
    'session_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.document_type = 'session'),
    'internal_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.document_type = 'internal'),
    'compliance_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.document_type = 'compliance'),
    'student_visible_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.student_visible = true),
    'metadata_only_documents', count(*) filter (where public.document_center_team_can_access_document(dr.id) and dr.upload_status = 'metadata_only')
  )
  into summary_json
  from public.document_records dr
  where dr.tenant_id = p_tenant_id;

  return jsonb_build_object(
    'role', current_member_role,
    'summary', coalesce(summary_json, '{}'::jsonb),
    'documents', documents_json
  );
end;
$$;

create or replace function public.get_document_detail(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.document_records%rowtype;
  include_activity boolean := false;
  activity_json jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into document_row
  from public.document_records dr
  where dr.id = p_document_id;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not coalesce(public.document_center_team_can_access_document(p_document_id), false) then
    raise exception 'Document access denied.' using errcode = '42501';
  end if;

  include_activity := public.document_center_is_owner_admin(document_row.tenant_id);

  if include_activity then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', dal.id,
          'action', dal.action,
          'actor_user_id', dal.actor_user_id,
          'actor_student_id', dal.actor_student_id,
          'metadata_json', dal.metadata_json,
          'created_at', dal.created_at
        )
        order by dal.created_at desc
      ),
      '[]'::jsonb
    )
    into activity_json
    from public.document_activity_logs dal
    where dal.document_id = p_document_id
      and dal.tenant_id = document_row.tenant_id;
  end if;

  return jsonb_build_object(
    'document', public.document_center_safe_document_json(document_row, true),
    'activity', activity_json
  );
end;
$$;

create or replace function public.create_document_record(
  p_tenant_id uuid,
  p_document_type text,
  p_title text,
  p_description text default null,
  p_category text default null,
  p_linked_student_id uuid default null,
  p_linked_course_id uuid default null,
  p_linked_cohort_id uuid default null,
  p_linked_session_id uuid default null,
  p_linked_team_user_id uuid default null,
  p_file_name text default null,
  p_file_mime_type text default null,
  p_file_size_bytes bigint default null,
  p_storage_bucket text default null,
  p_storage_path text default null,
  p_external_url text default null,
  p_upload_status text default 'metadata_only',
  p_visibility_scope text default 'owner_admin',
  p_student_visible boolean default false,
  p_trainer_visible boolean default false,
  p_staff_visible boolean default false,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_document_type text := nullif(lower(trim(coalesce(p_document_type, ''))), '');
  normalized_upload_status text := lower(trim(coalesce(p_upload_status, 'metadata_only')));
  normalized_visibility_scope text := lower(trim(coalesce(p_visibility_scope, 'owner_admin')));
  normalized_title text;
  normalized_description text;
  normalized_category text;
  normalized_file_name text;
  normalized_file_mime_type text;
  normalized_storage_bucket text;
  normalized_storage_path text;
  normalized_external_url text;
  normalized_metadata jsonb;
  inserted_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not public.document_center_is_owner_admin(p_tenant_id) then
    raise exception 'Only owners and admins can create documents.' using errcode = '42501';
  end if;

  if normalized_upload_status not in ('metadata_only', 'pending_upload', 'uploaded', 'archived') then
    raise exception 'Upload status is invalid.' using errcode = '22023';
  end if;

  perform public.document_center_validate_visibility(
    normalized_document_type,
    normalized_visibility_scope,
    coalesce(p_student_visible, false),
    coalesce(p_trainer_visible, false),
    coalesce(p_staff_visible, false)
  );

  perform public.document_center_validate_links(
    p_tenant_id,
    normalized_document_type,
    p_linked_student_id,
    p_linked_course_id,
    p_linked_cohort_id,
    p_linked_session_id,
    p_linked_team_user_id
  );

  normalized_title := public.document_center_validate_text(p_title, 'Title', true, 180);
  normalized_description := public.document_center_validate_text(p_description, 'Description', false, 1000);
  normalized_category := public.document_center_validate_text(p_category, 'Category', false, 80);
  normalized_file_name := public.document_center_validate_text(p_file_name, 'File name', false, 240);
  normalized_file_mime_type := public.document_center_validate_text(p_file_mime_type, 'File MIME type', false, 120);
  normalized_storage_bucket := public.document_center_validate_text(p_storage_bucket, 'Storage bucket', false, 120);
  normalized_storage_path := public.document_center_validate_text(p_storage_path, 'Storage path', false, 500);
  normalized_external_url := public.document_center_validate_external_url(p_external_url);
  normalized_metadata := public.document_center_validate_metadata(p_metadata_json);

  if p_file_size_bytes is not null and p_file_size_bytes < 0 then
    raise exception 'File size must be zero or greater.' using errcode = '22023';
  end if;

  insert into public.document_records (
    tenant_id,
    document_type,
    title,
    description,
    category,
    linked_student_id,
    linked_course_id,
    linked_cohort_id,
    linked_session_id,
    linked_team_user_id,
    file_name,
    file_mime_type,
    file_size_bytes,
    storage_bucket,
    storage_path,
    external_url,
    upload_status,
    visibility_scope,
    student_visible,
    trainer_visible,
    staff_visible,
    status,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    normalized_document_type,
    normalized_title,
    normalized_description,
    normalized_category,
    p_linked_student_id,
    p_linked_course_id,
    p_linked_cohort_id,
    p_linked_session_id,
    p_linked_team_user_id,
    normalized_file_name,
    normalized_file_mime_type,
    p_file_size_bytes,
    normalized_storage_bucket,
    normalized_storage_path,
    normalized_external_url,
    normalized_upload_status,
    normalized_visibility_scope,
    coalesce(p_student_visible, false),
    coalesce(p_trainer_visible, false),
    coalesce(p_staff_visible, false),
    case when normalized_upload_status = 'archived' then 'archived' else 'active' end,
    normalized_metadata,
    actor_id,
    actor_id
  )
  returning id into inserted_id;

  perform public.document_center_write_activity(
    p_tenant_id,
    inserted_id,
    actor_id,
    null,
    'document_created',
    jsonb_build_object(
      'document_id', inserted_id,
      'document_type', normalized_document_type,
      'category_present', normalized_category is not null,
      'linked_student_present', p_linked_student_id is not null,
      'linked_course_present', p_linked_course_id is not null,
      'linked_cohort_present', p_linked_cohort_id is not null,
      'linked_session_present', p_linked_session_id is not null,
      'external_url_present', normalized_external_url is not null,
      'storage_reference_present', normalized_storage_bucket is not null or normalized_storage_path is not null,
      'student_visible', coalesce(p_student_visible, false),
      'trainer_visible', coalesce(p_trainer_visible, false),
      'staff_visible', coalesce(p_staff_visible, false)
    )
  );

  return inserted_id;
end;
$$;

create or replace function public.update_document_record(
  p_document_id uuid,
  p_document_type text,
  p_title text,
  p_description text default null,
  p_category text default null,
  p_linked_student_id uuid default null,
  p_linked_course_id uuid default null,
  p_linked_cohort_id uuid default null,
  p_linked_session_id uuid default null,
  p_linked_team_user_id uuid default null,
  p_file_name text default null,
  p_file_mime_type text default null,
  p_file_size_bytes bigint default null,
  p_storage_bucket text default null,
  p_storage_path text default null,
  p_external_url text default null,
  p_upload_status text default 'metadata_only',
  p_visibility_scope text default 'owner_admin',
  p_student_visible boolean default false,
  p_trainer_visible boolean default false,
  p_staff_visible boolean default false,
  p_status text default 'active',
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  document_row public.document_records%rowtype;
  normalized_document_type text := nullif(lower(trim(coalesce(p_document_type, ''))), '');
  normalized_upload_status text := lower(trim(coalesce(p_upload_status, 'metadata_only')));
  normalized_visibility_scope text := lower(trim(coalesce(p_visibility_scope, 'owner_admin')));
  normalized_status text := lower(trim(coalesce(p_status, 'active')));
  normalized_title text;
  normalized_description text;
  normalized_category text;
  normalized_file_name text;
  normalized_file_mime_type text;
  normalized_storage_bucket text;
  normalized_storage_path text;
  normalized_external_url text;
  normalized_metadata jsonb;
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
    raise exception 'Only owners and admins can update documents.' using errcode = '42501';
  end if;

  if normalized_upload_status not in ('metadata_only', 'pending_upload', 'uploaded', 'archived') then
    raise exception 'Upload status is invalid.' using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'archived') then
    raise exception 'Document status is invalid.' using errcode = '22023';
  end if;

  perform public.document_center_validate_visibility(
    normalized_document_type,
    normalized_visibility_scope,
    coalesce(p_student_visible, false),
    coalesce(p_trainer_visible, false),
    coalesce(p_staff_visible, false)
  );

  perform public.document_center_validate_links(
    document_row.tenant_id,
    normalized_document_type,
    p_linked_student_id,
    p_linked_course_id,
    p_linked_cohort_id,
    p_linked_session_id,
    p_linked_team_user_id
  );

  normalized_title := public.document_center_validate_text(p_title, 'Title', true, 180);
  normalized_description := public.document_center_validate_text(p_description, 'Description', false, 1000);
  normalized_category := public.document_center_validate_text(p_category, 'Category', false, 80);
  normalized_file_name := public.document_center_validate_text(p_file_name, 'File name', false, 240);
  normalized_file_mime_type := public.document_center_validate_text(p_file_mime_type, 'File MIME type', false, 120);
  normalized_storage_bucket := public.document_center_validate_text(p_storage_bucket, 'Storage bucket', false, 120);
  normalized_storage_path := public.document_center_validate_text(p_storage_path, 'Storage path', false, 500);
  normalized_external_url := public.document_center_validate_external_url(p_external_url);
  normalized_metadata := public.document_center_validate_metadata(p_metadata_json);

  if p_file_size_bytes is not null and p_file_size_bytes < 0 then
    raise exception 'File size must be zero or greater.' using errcode = '22023';
  end if;

  update public.document_records
  set
    document_type = normalized_document_type,
    title = normalized_title,
    description = normalized_description,
    category = normalized_category,
    linked_student_id = p_linked_student_id,
    linked_course_id = p_linked_course_id,
    linked_cohort_id = p_linked_cohort_id,
    linked_session_id = p_linked_session_id,
    linked_team_user_id = p_linked_team_user_id,
    file_name = normalized_file_name,
    file_mime_type = normalized_file_mime_type,
    file_size_bytes = p_file_size_bytes,
    storage_bucket = normalized_storage_bucket,
    storage_path = normalized_storage_path,
    external_url = normalized_external_url,
    upload_status = normalized_upload_status,
    visibility_scope = normalized_visibility_scope,
    student_visible = coalesce(p_student_visible, false),
    trainer_visible = coalesce(p_trainer_visible, false),
    staff_visible = coalesce(p_staff_visible, false),
    status = normalized_status,
    metadata_json = normalized_metadata,
    updated_by = actor_id,
    archived_by = case when normalized_status = 'archived' then actor_id else null end,
    archived_at = case when normalized_status = 'archived' then coalesce(document_row.archived_at, now()) else null end
  where id = p_document_id;

  perform public.document_center_write_activity(
    document_row.tenant_id,
    p_document_id,
    actor_id,
    null,
    case
      when document_row.student_visible is distinct from coalesce(p_student_visible, false)
        or document_row.trainer_visible is distinct from coalesce(p_trainer_visible, false)
        or document_row.staff_visible is distinct from coalesce(p_staff_visible, false)
        then 'document_visibility_changed'
      else 'document_updated'
    end,
    jsonb_build_object(
      'document_id', p_document_id,
      'document_type', normalized_document_type,
      'old_status', document_row.status,
      'new_status', normalized_status,
      'external_url_present', normalized_external_url is not null,
      'storage_reference_present', normalized_storage_bucket is not null or normalized_storage_path is not null,
      'student_visible', coalesce(p_student_visible, false),
      'trainer_visible', coalesce(p_trainer_visible, false),
      'staff_visible', coalesce(p_staff_visible, false)
    )
  );

  return p_document_id;
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
    upload_status = case when upload_status = 'uploaded' then upload_status else 'archived' end,
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

create or replace function public.get_student_documents()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  student_context record;
  documents_json jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select *
  into student_context
  from public.document_center_student_context()
  limit 1;

  if not found then
    raise exception 'Student portal access denied.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      public.document_center_safe_document_json(dr, true)
      order by dr.updated_at desc
    ),
    '[]'::jsonb
  )
  into documents_json
  from public.document_records dr
  where dr.tenant_id = student_context.tenant_id
    and dr.status = 'active'
    and public.document_center_student_can_access_document(dr.id);

  return jsonb_build_object('documents', documents_json);
end;
$$;

create or replace function public.get_student_document_detail(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.document_records%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.*
  into document_row
  from public.document_records dr
  where dr.id = p_document_id;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not public.document_center_student_can_access_document(p_document_id) then
    raise exception 'Document access denied.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'document', public.document_center_safe_document_json(document_row, true)
  );
end;
$$;

create or replace function public.record_document_view(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  document_row public.document_records%rowtype;
  student_context record;
  actor_student_id uuid := null;
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

  if public.document_center_team_can_access_document(p_document_id) then
    perform public.document_center_write_activity(
      document_row.tenant_id,
      p_document_id,
      actor_id,
      null,
      'document_viewed',
      jsonb_build_object(
        'document_id', p_document_id,
        'document_type', document_row.document_type,
        'actor_type', 'team'
      )
    );
    return;
  end if;

  if public.document_center_student_can_access_document(p_document_id) then
    select *
    into student_context
    from public.document_center_student_context()
    where tenant_id = document_row.tenant_id
    limit 1;

    actor_student_id := student_context.student_id;

    perform public.document_center_write_activity(
      document_row.tenant_id,
      p_document_id,
      null,
      actor_student_id,
      'document_viewed',
      jsonb_build_object(
        'document_id', p_document_id,
        'document_type', document_row.document_type,
        'actor_type', 'student'
      )
    );
    return;
  end if;

  raise exception 'Document access denied.' using errcode = '42501';
end;
$$;

revoke execute on function public.document_center_current_role(uuid) from public;
revoke execute on function public.document_center_is_owner_admin(uuid) from public;
revoke execute on function public.document_center_student_context() from public;
revoke execute on function public.document_center_student_enrolled_course(uuid, uuid, uuid) from public;
revoke execute on function public.document_center_student_in_cohort(uuid, uuid, uuid) from public;
revoke execute on function public.document_center_student_can_access_session(uuid, uuid, uuid) from public;
revoke execute on function public.document_center_trainer_can_access_course(uuid, uuid) from public;
revoke execute on function public.document_center_trainer_can_access_cohort(uuid, uuid) from public;
revoke execute on function public.document_center_trainer_can_access_session(uuid, uuid) from public;
revoke execute on function public.document_center_team_can_access_document(uuid) from public;
revoke execute on function public.document_center_student_can_access_document(uuid) from public;
revoke execute on function public.document_center_validate_text(text, text, boolean, integer) from public;
revoke execute on function public.document_center_validate_metadata(jsonb) from public;
revoke execute on function public.document_center_validate_external_url(text) from public;
revoke execute on function public.document_center_validate_visibility(text, text, boolean, boolean, boolean) from public;
revoke execute on function public.document_center_validate_links(uuid, text, uuid, uuid, uuid, uuid, uuid) from public;
revoke execute on function public.document_center_safe_document_json(public.document_records, boolean) from public;
revoke execute on function public.document_center_write_activity(uuid, uuid, uuid, uuid, text, jsonb) from public;
revoke execute on function public.get_document_center_dashboard(uuid) from public;
revoke execute on function public.get_document_detail(uuid) from public;
revoke execute on function public.create_document_record(uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, text, boolean, boolean, boolean, jsonb) from public;
revoke execute on function public.update_document_record(uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, text, boolean, boolean, boolean, text, jsonb) from public;
revoke execute on function public.archive_document_record(uuid) from public;
revoke execute on function public.get_student_documents() from public;
revoke execute on function public.get_student_document_detail(uuid) from public;
revoke execute on function public.record_document_view(uuid) from public;

revoke execute on function public.document_center_current_role(uuid) from authenticated;
revoke execute on function public.document_center_is_owner_admin(uuid) from authenticated;
revoke execute on function public.document_center_student_context() from authenticated;
revoke execute on function public.document_center_student_enrolled_course(uuid, uuid, uuid) from authenticated;
revoke execute on function public.document_center_student_in_cohort(uuid, uuid, uuid) from authenticated;
revoke execute on function public.document_center_student_can_access_session(uuid, uuid, uuid) from authenticated;
revoke execute on function public.document_center_trainer_can_access_course(uuid, uuid) from authenticated;
revoke execute on function public.document_center_trainer_can_access_cohort(uuid, uuid) from authenticated;
revoke execute on function public.document_center_trainer_can_access_session(uuid, uuid) from authenticated;
revoke execute on function public.document_center_team_can_access_document(uuid) from authenticated;
revoke execute on function public.document_center_student_can_access_document(uuid) from authenticated;
revoke execute on function public.document_center_validate_text(text, text, boolean, integer) from authenticated;
revoke execute on function public.document_center_validate_metadata(jsonb) from authenticated;
revoke execute on function public.document_center_validate_external_url(text) from authenticated;
revoke execute on function public.document_center_validate_visibility(text, text, boolean, boolean, boolean) from authenticated;
revoke execute on function public.document_center_validate_links(uuid, text, uuid, uuid, uuid, uuid, uuid) from authenticated;
revoke execute on function public.document_center_safe_document_json(public.document_records, boolean) from authenticated;
revoke execute on function public.document_center_write_activity(uuid, uuid, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.get_document_center_dashboard(uuid) to authenticated;
grant execute on function public.get_document_detail(uuid) to authenticated;
grant execute on function public.create_document_record(uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, text, boolean, boolean, boolean, jsonb) to authenticated;
grant execute on function public.update_document_record(uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, text, boolean, boolean, boolean, text, jsonb) to authenticated;
grant execute on function public.archive_document_record(uuid) to authenticated;
grant execute on function public.get_student_documents() to authenticated;
grant execute on function public.get_student_document_detail(uuid) to authenticated;
grant execute on function public.record_document_view(uuid) to authenticated;
