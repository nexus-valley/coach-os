-- Bundle UX-6F1: native assignment attachment backend foundation.
--
-- Adds normalized private assignment files without replacing legacy
-- attachment_urls_json. Student submission uploads remain deliberately absent.

/*
PRE-APPLY READ-ONLY VERIFICATION

Run this query separately before applying the executable migration. It reads
catalog metadata and aggregate counts only; it does not return business content.

with
required_relations(name) as (
  values
    ('assignments'), ('assignment_submissions'), ('students'),
    ('student_portal_accounts'), ('courses'), ('cohorts'), ('cohort_members'),
    ('tenant_members'), ('trainer_course_assignments'),
    ('trainer_cohort_assignments'), ('delegated_permissions'),
    ('document_records'), ('tenant_subscription_assignments'),
    ('subscription_plan_usage_limits'), ('tenant_subscription_overrides')
), relation_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation', rr.name,
    'installed', c.oid is not null,
    'owner', case when c.oid is null then null else pg_get_userbyid(c.relowner) end,
    'rls_enabled', coalesce(c.relrowsecurity, false),
    'rls_forced', coalesce(c.relforcerowsecurity, false)
  ) order by rr.name), '[]'::jsonb) as value
  from required_relations rr
  left join pg_catalog.pg_class c
    on c.oid = pg_catalog.to_regclass('public.' || rr.name)
), bucket_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'public', b.public,
    'file_size_limit', b.file_size_limit,
    'allowed_mime_types', b.allowed_mime_types
  )), '[]'::jsonb) as value
  from storage.buckets b
  where b.id = 'coachfort-documents'
), column_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.table_name,
    'column', c.column_name,
    'type', c.udt_name,
    'nullable', c.is_nullable,
    'default', c.column_default
  ) order by c.table_name, c.ordinal_position), '[]'::jsonb) as value
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('assignments', 'assignment_submissions', 'document_records')
    and c.column_name in (
      'id', 'tenant_id', 'course_id', 'cohort_id', 'trainer_user_id',
      'student_id', 'assignment_id', 'attachment_urls_json', 'status',
      'updated_at', 'upload_status', 'file_size_bytes', 'storage_bucket',
      'storage_path'
    )
), assignment_state as (
  select jsonb_build_object(
    'status_counts', coalesce((
      select jsonb_object_agg(status_rows.status, status_rows.row_count)
      from (
        select a.status, count(*) as row_count
        from public.assignments a
        group by a.status
        order by a.status
      ) status_rows
    ), '{}'::jsonb),
    'legacy_attachment_rows', (
      select count(*) from public.assignments a
      where a.attachment_urls_json <> '[]'::jsonb
    ),
    'submission_legacy_attachment_rows', (
      select count(*) from public.assignment_submissions s
      where s.attachment_urls_json <> '[]'::jsonb
    )
  ) as value
), function_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'identity', expected.identity,
    'installed', p.oid is not null,
    'owner', case when p.oid is null then null else pg_get_userbyid(p.proowner) end,
    'security_definer', coalesce(p.prosecdef, false),
    'configuration', coalesce(p.proconfig, array[]::text[]),
    'authenticated_execute', p.oid is not null and
      pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role_execute', p.oid is not null and
      pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) order by expected.identity), '[]'::jsonb) as value
  from (values
    ('public.get_tenant_document_storage_usage(uuid)'),
    ('public.assert_tenant_document_upload_quota(uuid,bigint)'),
    ('public.prepare_document_file_upload(uuid,text,text,bigint)'),
    ('public.document_storage_validate_file(text,text,bigint)'),
    ('public.document_storage_sanitize_file_name(text)'),
    ('public.m69_4_assert_manage_assignment(uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_trainer_can_manage_scope(uuid,uuid,uuid,uuid,uuid)'),
    ('public.m69_4_delegated_permission_id(uuid,uuid,text[],uuid,uuid,uuid,uuid)'),
    ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
    ('public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    ('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
    ('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'),
    ('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'),
    ('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)')
  ) expected(identity)
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(expected.identity)
), direct_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', tp.table_name,
    'grantee', tp.grantee,
    'privilege', tp.privilege_type
  ) order by tp.table_name, tp.grantee, tp.privilege_type), '[]'::jsonb) as value
  from information_schema.table_privileges tp
  where (tp.table_schema, tp.table_name) in (
      ('public', 'assignments'),
      ('public', 'assignment_submissions'),
      ('public', 'document_records'),
      ('storage', 'buckets'),
      ('storage', 'objects')
    )
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), document_records_acl_state as (
  select jsonb_build_object(
    'document_records_authenticated_select', count(*) filter (
      where tp.grantee = 'authenticated' and tp.privilege_type = 'SELECT'
    ) > 0,
    'document_records_browser_write_grants', count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'document_records_browser_dangerous_grants', count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in (
          'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
        )
    ),
    'document_records_public_privileges', count(*) filter (
      where tp.grantee = 'PUBLIC'
    ),
    'document_records_anon_privileges', count(*) filter (
      where tp.grantee = 'anon'
    ),
    'document_records_unexpected_browser_grants', count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon')
         or (
           tp.grantee = 'authenticated'
           and tp.privilege_type not in (
             'SELECT', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
           )
         )
    ),
    'recognized_remediable_baseline',
      count(*) filter (
        where tp.grantee = 'authenticated' and tp.privilege_type = 'SELECT'
      ) > 0
      and count(*) filter (
        where tp.grantee in ('PUBLIC', 'anon')
      ) = 0
      and count(*) filter (
        where tp.grantee in ('PUBLIC', 'anon', 'authenticated')
          and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      ) = 0
      and count(*) filter (
        where tp.grantee = 'authenticated'
          and tp.privilege_type not in (
            'SELECT', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
          )
      ) = 0
  ) as value
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name = 'document_records'
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
), internal_schema_state as (
  select jsonb_build_object(
    'installed', n.oid is not null,
    'owner', case when n.oid is null then null else pg_get_userbyid(n.nspowner) end,
    'postgrest_setting', current_setting('pgrst.db_schemas', true),
    'api_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1
      from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(settings.setting, '=', 2), ','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and rs.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d
           where d.datname = current_database())
        )
        and settings.setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    ),
    'schema_acl', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        'privilege', a.privilege_type
      ) order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
      from pg_catalog.aclexplode(
        coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
      ) a
    ), '[]'::jsonb)
  ) as value
  from (select pg_catalog.to_regnamespace('coachfort_internal') as oid) existing
  left join pg_catalog.pg_namespace n on n.oid = existing.oid
), quota_signals as (
  select jsonb_build_object(
    'document_usage_source', lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.get_tenant_document_storage_usage(uuid)'
      )), ''), '[[:space:]]+', ' ', 'g'
    )),
    'document_assert_source', lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.assert_tenant_document_upload_quota(uuid,bigint)'
      )), ''), '[[:space:]]+', ' ', 'g'
    )),
    'document_prepare_source', lower(pg_catalog.regexp_replace(
      coalesce(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.prepare_document_file_upload(uuid,text,text,bigint)'
      )), ''), '[[:space:]]+', ' ', 'g'
    )),
    'active_uploaded_document_count', (
      select count(*) from public.document_records dr
      where dr.status = 'active' and dr.upload_status = 'uploaded'
    ),
    'active_pending_document_count', (
      select count(*) from public.document_records dr
      where dr.status = 'active' and dr.upload_status = 'pending_upload'
    )
  ) as value
), risk_state as (
  select jsonb_build_object(
    'assignment_attachments_relation', pg_catalog.to_regclass(
      'public.assignment_attachments'
    ),
    'assignment_attachments_named_objects', (
      select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'assignment_attachments'
    ),
    'assignment_browser_writes', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in ('assignments', 'assignment_submissions')
        and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'browser_dangerous_grants', (
      select count(*) from information_schema.table_privileges tp
      where tp.table_schema = 'public'
        and tp.table_name in ('assignments', 'assignment_submissions', 'document_records')
        and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
    ),
    'document_pending_bytes', (
      select coalesce(sum(dr.file_size_bytes), 0)::bigint
      from public.document_records dr
      where dr.status = 'active'
        and dr.upload_status = 'pending_upload'
        and dr.file_size_bytes > 0
    )
  ) as value
)
select jsonb_build_object(
  'relations', (select value from relation_state),
  'bucket', (select value from bucket_state),
  'columns', (select value from column_state),
  'assignment', (select value from assignment_state),
  'functions', (select value from function_state),
  'direct_grants', (select value from direct_grants),
  'document_records_acl', (select value from document_records_acl_state),
  'internal_schema', (select value from internal_schema_state),
  'quota', (select value from quota_signals),
  'risk', (select value from risk_state)
) as ux6f1_preflight;
*/

begin;

do $$
declare
  v_missing text[];
  v_bucket storage.buckets%rowtype;
  v_postgres pg_catalog.pg_roles%rowtype;
begin
  select array_agg(required.name order by required.name)
  into v_missing
  from (values
    ('public.assignments'),
    ('public.assignment_submissions'),
    ('public.students'),
    ('public.student_portal_accounts'),
    ('public.courses'),
    ('public.cohorts'),
    ('public.cohort_members'),
    ('public.tenant_members'),
    ('public.trainer_course_assignments'),
    ('public.trainer_cohort_assignments'),
    ('public.delegated_permissions'),
    ('public.document_records'),
    ('public.tenant_subscription_assignments'),
    ('public.subscription_plan_usage_limits'),
    ('public.tenant_subscription_overrides')
  ) required(name)
  where pg_catalog.to_regclass(required.name) is null;

  if coalesce(cardinality(v_missing), 0) > 0 then
    raise exception 'UX-6F1 prerequisite failed: missing relations: %.',
      array_to_string(v_missing, ', ') using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('public.assignment_attachments') is not null
     or exists (
       select 1 from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'assignment_attachments'
     ) then
    raise exception 'UX-6F1 prerequisite failed: assignment_attachments already exists.'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regnamespace('coachfort_internal') is null then
    raise exception 'UX-6F1 prerequisite failed: coachfort_internal is missing.'
      using errcode = '55000';
  end if;

  if coalesce(
       'coachfort_internal' = any(regexp_split_to_array(
         replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
       )), false
     ) or exists (
       select 1
       from pg_catalog.pg_db_role_setting rs
       join pg_catalog.pg_roles r on r.oid = rs.setrole
       cross join lateral unnest(rs.setconfig) settings(setting)
       cross join lateral regexp_split_to_table(
         split_part(settings.setting, '=', 2), ','
       ) exposed(schema_name)
       where r.rolname = 'authenticator'
         and rs.setdatabase in (
           0,
           (select d.oid from pg_catalog.pg_database d
            where d.datname = current_database())
         )
         and settings.setting like 'pgrst.db_schemas=%'
         and btrim(exposed.schema_name) = 'coachfort_internal'
     ) then
    raise exception 'UX-6F1 prerequisite failed: internal schema is API-exposed.'
      using errcode = '55000';
  end if;

  select * into v_bucket
  from storage.buckets b
  where b.id = 'coachfort-documents';

  if not found
     or v_bucket.name <> 'coachfort-documents'
     or v_bucket.public
     or v_bucket.file_size_limit is distinct from 10485760
     or not (
       array[
         'application/pdf',
         'image/png',
         'image/jpeg',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ]::text[] <@ coalesce(v_bucket.allowed_mime_types, array[]::text[])
     ) then
    raise exception 'UX-6F1 prerequisite failed: private storage bucket contract is incompatible.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'assignments'
      and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
      and c.is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'assignment_submissions'
      and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
      and c.is_nullable = 'NO'
  ) then
    raise exception 'UX-6F1 prerequisite failed: legacy attachment URL columns are incompatible.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name in ('assignments', 'assignment_submissions')
      and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
      and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'UX-6F1 prerequisite failed: assignment browser writes are not revoked.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name = 'document_records'
      and tp.grantee = 'authenticated'
      and tp.privilege_type = 'SELECT'
  ) or exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name = 'document_records'
      and (
        tp.grantee in ('PUBLIC', 'anon')
        or (
          tp.grantee = 'authenticated'
          and tp.privilege_type not in (
            'SELECT', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
          )
        )
      )
  ) then
    raise exception 'UX-6F1 prerequisite failed: document_records browser grants are not a recognized remediable baseline.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (values
      ('public.get_tenant_document_storage_usage(uuid)'),
      ('public.assert_tenant_document_upload_quota(uuid,bigint)'),
      ('public.prepare_document_file_upload(uuid,text,text,bigint)'),
      ('public.document_storage_bucket_name()'),
      ('public.document_storage_validate_file(text,text,bigint)'),
      ('public.document_storage_sanitize_file_name(text)'),
      ('public.m69_4_current_role(uuid)'),
      ('public.m69_4_assert_manage_assignment(uuid,uuid,uuid,uuid,uuid)'),
      ('public.m69_4_trainer_can_manage_scope(uuid,uuid,uuid,uuid,uuid)'),
      ('public.m69_4_delegated_permission_id(uuid,uuid,text[],uuid,uuid,uuid,uuid)'),
      ('public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)'),
      ('public.set_updated_at()'),
      ('public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
      ('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'),
      ('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'),
      ('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'),
      ('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)')
    ) required(identity)
    where pg_catalog.to_regprocedure(required.identity) is null
  ) then
    raise exception 'UX-6F1 prerequisite failed: required function identity is missing.'
      using errcode = '55000';
  end if;

  select * into v_postgres
  from pg_catalog.pg_roles r
  where r.rolname = 'postgres';

  if not found or not (v_postgres.rolsuper or v_postgres.rolbypassrls) then
    raise exception 'UX-6F1 prerequisite failed: postgres cannot safely own RLS-bypassing helpers.'
      using errcode = '55000';
  end if;
end;
$$;

revoke truncate, references, trigger, maintain
  on table public.document_records
  from public, anon, authenticated;

create table public.assignment_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  submission_id uuid references public.assignment_submissions(id) on delete restrict,
  student_id uuid references public.students(id) on delete restrict,
  purpose text not null,
  display_file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  bucket_name text,
  object_path text,
  status text not null default 'pending_upload',
  created_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz,
  delete_requested_at timestamptz,
  delete_requested_by uuid references auth.users(id) on delete set null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignment_attachments_purpose_check check (
    purpose in ('assignment', 'submission')
  ),
  constraint assignment_attachments_purpose_relation_check check (
    (purpose = 'assignment' and submission_id is null and student_id is null)
    or (purpose = 'submission' and student_id is not null)
  ),
  constraint assignment_attachments_status_check check (
    status in ('pending_upload', 'uploaded', 'pending_delete', 'removed')
  ),
  constraint assignment_attachments_display_file_name_check check (
    char_length(display_file_name) between 1 and 160
    and display_file_name = btrim(display_file_name)
    and display_file_name not in ('.', '..')
    and position('/' in display_file_name) = 0
    and position(chr(92) in display_file_name) = 0
    and position('..' in display_file_name) = 0
    and display_file_name !~ '[<>:"|?*]'
    and display_file_name !~ '[[:cntrl:]]'
  ),
  constraint assignment_attachments_mime_type_check check (
    mime_type in (
      'application/pdf',
      'image/png',
      'image/jpeg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  ),
  constraint assignment_attachments_byte_size_check check (
    byte_size between 1 and 10485760
  ),
  constraint assignment_attachments_storage_state_check check (
    (
      status = 'pending_upload'
      and bucket_name = 'coachfort-documents'
      and object_path is not null
      and uploaded_at is null
      and delete_requested_at is null
      and removed_at is null
    )
    or (
      status = 'uploaded'
      and bucket_name = 'coachfort-documents'
      and object_path is not null
      and uploaded_at is not null
      and delete_requested_at is null
      and removed_at is null
    )
    or (
      status = 'pending_delete'
      and bucket_name = 'coachfort-documents'
      and object_path is not null
      and uploaded_at is not null
      and delete_requested_at is not null
      and removed_at is null
    )
    or (
      status = 'removed'
      and bucket_name is null
      and object_path is null
      and removed_at is not null
    )
  ),
  constraint assignment_attachments_object_path_check check (
    object_path is null
    or (
      purpose = 'assignment'
      and student_id is null
      and object_path = concat(
        'tenant/', tenant_id,
        '/assignments/', assignment_id,
        '/attachments/', id,
        '/', display_file_name
      )
    )
    or (
      purpose = 'submission'
      and student_id is not null
      and object_path = concat(
        'tenant/', tenant_id,
        '/assignments/', assignment_id,
        '/submissions/', student_id,
        '/attachments/', id,
        '/', display_file_name
      )
    )
  )
);

alter table public.assignment_attachments owner to postgres;

comment on table public.assignment_attachments is
  'Private assignment-domain file metadata. UX-6F1 activates assignment-purpose rows only.';
comment on column public.assignment_attachments.submission_id is
  'Reserved for UX-6F2 submission association; no UX-6F1 browser mutation path can set it.';
comment on column public.assignment_attachments.object_path is
  'Server-generated private object path; never accepted from browser callers.';

create unique index assignment_attachments_storage_identity_uidx
  on public.assignment_attachments (bucket_name, object_path)
  where bucket_name is not null and object_path is not null;

create index assignment_attachments_assignment_list_idx
  on public.assignment_attachments (
    tenant_id, assignment_id, purpose, status, created_at, id
  );

create index assignment_attachments_submission_idx
  on public.assignment_attachments (tenant_id, submission_id, status)
  where submission_id is not null;

create index assignment_attachments_student_assignment_idx
  on public.assignment_attachments (
    tenant_id, student_id, assignment_id, status
  )
  where student_id is not null;

alter table public.assignment_attachments enable row level security;

revoke all privileges on table public.assignment_attachments
  from public, anon, authenticated, service_role;

create or replace function coachfort_internal.assignment_attachment_path_valid(
  p_attachment_id uuid,
  p_tenant_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_purpose text,
  p_display_file_name text,
  p_bucket_name text,
  p_object_path text
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_attachment_id is not null
    and p_tenant_id is not null
    and p_assignment_id is not null
    and p_display_file_name is not null
    and p_bucket_name = 'coachfort-documents'
    and (
      (
        p_purpose = 'assignment'
        and p_student_id is null
        and p_object_path = concat(
          'tenant/', p_tenant_id,
          '/assignments/', p_assignment_id,
          '/attachments/', p_attachment_id,
          '/', p_display_file_name
        )
      )
      or (
        p_purpose = 'submission'
        and p_student_id is not null
        and p_object_path = concat(
          'tenant/', p_tenant_id,
          '/assignments/', p_assignment_id,
          '/submissions/', p_student_id,
          '/attachments/', p_attachment_id,
          '/', p_display_file_name
        )
      )
    )
    and position('..' in p_object_path) = 0,
    false
  )
$$;

create or replace function coachfort_internal.enforce_assignment_attachment_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments%rowtype;
  v_submission public.assignment_submissions%rowtype;
begin
  select a.* into v_assignment
  from public.assignments a
  where a.id = new.assignment_id;

  if not found or v_assignment.tenant_id is distinct from new.tenant_id then
    raise exception 'Assignment attachment tenant relationship is invalid.'
      using errcode = '23514';
  end if;

  if new.purpose = 'assignment' then
    if new.submission_id is not null or new.student_id is not null then
      raise exception 'Assignment files cannot reference a submission or student.'
        using errcode = '23514';
    end if;
  elsif new.purpose = 'submission' then
    if new.student_id is null or not exists (
      select 1 from public.students s
      where s.id = new.student_id and s.tenant_id = new.tenant_id
    ) then
      raise exception 'Submission attachment student relationship is invalid.'
        using errcode = '23514';
    end if;

    if new.submission_id is not null then
      select s.* into v_submission
      from public.assignment_submissions s
      where s.id = new.submission_id;

      if not found
         or v_submission.tenant_id is distinct from new.tenant_id
         or v_submission.assignment_id is distinct from new.assignment_id
         or v_submission.student_id is distinct from new.student_id then
        raise exception 'Submission attachment relationship is invalid.'
          using errcode = '23514';
      end if;
    end if;
  else
    raise exception 'Assignment attachment purpose is invalid.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

alter function coachfort_internal.assignment_attachment_path_valid(
  uuid, uuid, uuid, uuid, text, text, text, text
) owner to postgres;
alter function coachfort_internal.enforce_assignment_attachment_consistency()
  owner to postgres;

revoke all on function coachfort_internal.assignment_attachment_path_valid(
  uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.enforce_assignment_attachment_consistency()
  from public, anon, authenticated, service_role;

create trigger enforce_assignment_attachment_consistency
before insert or update of
  tenant_id, assignment_id, submission_id, student_id, purpose
on public.assignment_attachments
for each row execute function
  coachfort_internal.enforce_assignment_attachment_consistency();

create trigger set_assignment_attachments_updated_at
before update on public.assignment_attachments
for each row execute function public.set_updated_at();

create or replace function coachfort_internal.private_storage_usage(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_document_uploaded_bytes bigint := 0;
  v_document_pending_bytes bigint := 0;
  v_uploaded_document_count integer := 0;
  v_pending_document_count integer := 0;
  v_assignment_attachment_bytes bigint := 0;
begin
  if p_tenant_id is null then
    raise exception 'Tenant id is required.' using errcode = '22023';
  end if;

  select
    coalesce(sum(dr.file_size_bytes), 0)::bigint,
    count(*)::integer
  into v_document_uploaded_bytes, v_uploaded_document_count
  from public.document_records dr
  where dr.tenant_id = p_tenant_id
    and dr.status = 'active'
    and dr.upload_status = 'uploaded'
    and dr.storage_bucket = public.document_storage_bucket_name()
    and dr.storage_path is not null
    and dr.file_size_bytes between 1 and 10485760;

  select
    coalesce(sum(dr.file_size_bytes), 0)::bigint,
    count(*)::integer
  into v_document_pending_bytes, v_pending_document_count
  from public.document_records dr
  where dr.tenant_id = p_tenant_id
    and dr.status = 'active'
    and dr.upload_status = 'pending_upload'
    and dr.storage_bucket = public.document_storage_bucket_name()
    and dr.storage_path is not null
    and dr.file_size_bytes between 1 and 10485760;

  select coalesce(sum(aa.byte_size), 0)::bigint
  into v_assignment_attachment_bytes
  from public.assignment_attachments aa
  where aa.tenant_id = p_tenant_id
    and aa.status in ('pending_upload', 'uploaded', 'pending_delete');

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'document_uploaded_bytes', v_document_uploaded_bytes,
    'document_pending_bytes', v_document_pending_bytes,
    'uploaded_document_count', v_uploaded_document_count,
    'pending_document_count', v_pending_document_count,
    'assignment_attachment_bytes', v_assignment_attachment_bytes,
    'used_storage_bytes',
      v_document_uploaded_bytes
      + v_document_pending_bytes
      + v_assignment_attachment_bytes,
    'document_count_usage',
      v_uploaded_document_count + v_pending_document_count,
    'source', 'canonical_private_storage_usage'
  );
end;
$$;

create or replace function coachfort_internal.private_storage_limit(
  p_tenant_id uuid,
  p_resource_key text
)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(limit_override.override_value_json->>'limit_value', '')::bigint,
    spl.limit_value::bigint
  )
  from public.tenant_subscription_assignments tsa
  join public.subscription_plan_usage_limits spl
    on spl.plan_id = tsa.plan_id
   and spl.resource_key = p_resource_key
  left join lateral (
    select tso.override_value_json
    from public.tenant_subscription_overrides tso
    where tso.tenant_id = p_tenant_id
      and tso.resource_key = p_resource_key
      and tso.override_type in ('limit_raise', 'limit_lower')
      and (tso.expires_at is null or tso.expires_at > now())
    order by tso.created_at desc
    limit 1
  ) limit_override on true
  where tsa.tenant_id = p_tenant_id
    and tsa.is_current
  order by tsa.created_at desc
  limit 1
$$;

create or replace function coachfort_internal.assert_private_storage_quota(
  p_tenant_id uuid,
  p_storage_byte_delta bigint,
  p_document_count_delta integer,
  p_enforce_document_count boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usage jsonb;
  v_storage_limit_mb bigint;
  v_storage_limit_bytes bigint;
  v_document_upload_limit bigint;
  v_used_storage_bytes bigint;
  v_document_count_usage bigint;
  v_projected_storage_bytes bigint;
  v_projected_document_uploads bigint;
begin
  if p_tenant_id is null
     or p_storage_byte_delta is null
     or p_document_count_delta is null then
    raise exception 'Private storage quota inputs are required.'
      using errcode = '22023';
  end if;

  v_usage := coachfort_internal.private_storage_usage(p_tenant_id);
  v_storage_limit_mb := coachfort_internal.private_storage_limit(
    p_tenant_id, 'storage_mb'
  );
  v_document_upload_limit := coachfort_internal.private_storage_limit(
    p_tenant_id, 'document_uploads'
  );

  if v_storage_limit_mb is null or v_storage_limit_mb <= 0 then
    raise exception 'Canonical storage quota is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  if coalesce(p_enforce_document_count, false)
     and (v_document_upload_limit is null or v_document_upload_limit < 0) then
    raise exception 'Canonical document upload limit is not configured for this tenant plan.'
      using errcode = '22023';
  end if;

  v_storage_limit_bytes := v_storage_limit_mb * 1024 * 1024;
  v_used_storage_bytes := coalesce((v_usage->>'used_storage_bytes')::bigint, 0);
  v_document_count_usage := coalesce((v_usage->>'document_count_usage')::bigint, 0);
  v_projected_storage_bytes := v_used_storage_bytes + p_storage_byte_delta;
  v_projected_document_uploads :=
    v_document_count_usage + p_document_count_delta;

  if v_projected_storage_bytes < 0
     or v_projected_storage_bytes > v_storage_limit_bytes then
    raise exception 'Upload would exceed the tenant storage quota.'
      using errcode = '22023';
  end if;

  if coalesce(p_enforce_document_count, false)
     and (
       v_projected_document_uploads < 0
       or v_projected_document_uploads > v_document_upload_limit
     ) then
    raise exception 'Document upload would exceed the tenant document upload limit.'
      using errcode = '22023';
  end if;

  return v_usage || jsonb_build_object(
    'allowed', true,
    'storage_limit_mb', v_storage_limit_mb,
    'storage_limit_bytes', v_storage_limit_bytes,
    'document_upload_limit', v_document_upload_limit,
    'projected_storage_bytes', v_projected_storage_bytes,
    'projected_document_uploads', v_projected_document_uploads,
    'remaining_storage_bytes',
      greatest(v_storage_limit_bytes - v_projected_storage_bytes, 0),
    'remaining_document_uploads',
      case when v_document_upload_limit is null then null
      else greatest(v_document_upload_limit - v_projected_document_uploads, 0)
      end
  );
end;
$$;

alter function coachfort_internal.private_storage_usage(uuid) owner to postgres;
alter function coachfort_internal.private_storage_limit(uuid, text) owner to postgres;
alter function coachfort_internal.assert_private_storage_quota(
  uuid, bigint, integer, boolean
) owner to postgres;

revoke all on function coachfort_internal.private_storage_usage(uuid)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.private_storage_limit(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function coachfort_internal.assert_private_storage_quota(
  uuid, bigint, integer, boolean
) from public, anon, authenticated, service_role;

create or replace function public.get_tenant_document_storage_usage(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_usage jsonb;
  v_storage_limit_mb bigint;
  v_storage_limit_bytes bigint;
  v_document_upload_limit bigint;
  v_used_storage_bytes bigint;
  v_document_count_usage bigint;
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

  v_usage := coachfort_internal.private_storage_usage(p_tenant_id);
  v_storage_limit_mb := coachfort_internal.private_storage_limit(
    p_tenant_id, 'storage_mb'
  );
  v_document_upload_limit := coachfort_internal.private_storage_limit(
    p_tenant_id, 'document_uploads'
  );
  v_storage_limit_bytes := case when v_storage_limit_mb is null then null
    else v_storage_limit_mb * 1024 * 1024 end;
  v_used_storage_bytes := coalesce((v_usage->>'used_storage_bytes')::bigint, 0);
  v_document_count_usage := coalesce((v_usage->>'document_count_usage')::bigint, 0);

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'used_storage_bytes', v_used_storage_bytes,
    'used_storage_mb', round((v_used_storage_bytes::numeric / 1024 / 1024), 2),
    'uploaded_document_count',
      coalesce((v_usage->>'uploaded_document_count')::integer, 0),
    'pending_or_failed_document_count',
      coalesce((v_usage->>'pending_document_count')::integer, 0),
    'storage_limit_mb', v_storage_limit_mb,
    'storage_limit_bytes', v_storage_limit_bytes,
    'document_upload_limit', v_document_upload_limit,
    'remaining_storage_bytes', case when v_storage_limit_bytes is null then null
      else greatest(v_storage_limit_bytes - v_used_storage_bytes, 0) end,
    'remaining_document_uploads', case when v_document_upload_limit is null then null
      else greatest(v_document_upload_limit - v_document_count_usage, 0) end,
    'over_storage_limit', case when v_storage_limit_bytes is null then false
      else v_used_storage_bytes > v_storage_limit_bytes end,
    'over_document_upload_limit', case when v_document_upload_limit is null then false
      else v_document_count_usage > v_document_upload_limit end,
    'has_canonical_assignment', v_storage_limit_mb is not null,
    'document_uploaded_bytes',
      coalesce((v_usage->>'document_uploaded_bytes')::bigint, 0),
    'document_pending_bytes',
      coalesce((v_usage->>'document_pending_bytes')::bigint, 0),
    'assignment_attachment_bytes',
      coalesce((v_usage->>'assignment_attachment_bytes')::bigint, 0),
    'storage_scope', 'global_private_storage',
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
set search_path = public, pg_temp
as $$
declare
  v_quota jsonb;
  v_storage_limit_bytes bigint;
  v_document_upload_limit bigint;
  v_projected_storage_bytes bigint;
  v_projected_document_uploads bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_tenant_id is null or p_file_size_bytes is null or p_file_size_bytes <= 0 then
    raise exception 'Tenant id and a positive file size are required.'
      using errcode = '22023';
  end if;

  if not public.subscription_entitlements_can_read_tenant(p_tenant_id) then
    raise exception 'Document upload quota access denied.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'document_upload_quota:' || p_tenant_id::text, 7174
    )
  );

  v_quota := coachfort_internal.assert_private_storage_quota(
    p_tenant_id, p_file_size_bytes, 1, true
  );
  v_storage_limit_bytes := (v_quota->>'storage_limit_bytes')::bigint;
  v_document_upload_limit := (v_quota->>'document_upload_limit')::bigint;
  v_projected_storage_bytes := (v_quota->>'projected_storage_bytes')::bigint;
  v_projected_document_uploads :=
    (v_quota->>'projected_document_uploads')::bigint;

  return v_quota || jsonb_build_object(
    'tenant_id', p_tenant_id,
    'file_size_bytes', p_file_size_bytes,
    'storage_warning',
      v_projected_storage_bytes >= ceil(v_storage_limit_bytes::numeric * 0.8),
    'document_upload_warning',
      v_document_upload_limit > 0 and
      v_projected_document_uploads >= ceil(v_document_upload_limit::numeric * 0.8),
    'warning',
      v_projected_storage_bytes >= ceil(v_storage_limit_bytes::numeric * 0.8)
      or (
        v_document_upload_limit > 0 and
        v_projected_document_uploads >= ceil(v_document_upload_limit::numeric * 0.8)
      ),
    'reason', 'allowed',
    'source', 'canonical_document_upload_quota'
  );
end;
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
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.document_records%rowtype;
  v_safe_file_name text;
  v_storage_bucket text := public.document_storage_bucket_name();
  v_storage_path text;
  v_previous_path text;
  v_existing_counted_bytes bigint := 0;
  v_document_count_delta integer := 1;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select dr.* into v_document
  from public.document_records dr
  where dr.id = p_document_id
  for update;

  if not found then
    raise exception 'Document not found.' using errcode = '02000';
  end if;

  if not public.document_center_is_owner_admin(v_document.tenant_id) then
    raise exception 'Only owners and admins can upload document files.'
      using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(v_document.tenant_id, 'documents') then
    raise exception 'Document Center is not enabled for this workspace.'
      using errcode = '42501';
  end if;

  if not public.document_storage_feature_enabled(
    v_document.tenant_id, 'document_uploads'
  ) then
    raise exception 'Document uploads are not enabled for this workspace.'
      using errcode = '42501';
  end if;

  if v_document.status <> 'active' then
    raise exception 'Archived documents cannot receive file uploads.'
      using errcode = '22023';
  end if;

  perform public.document_storage_validate_file(
    p_file_name, p_file_mime_type, p_file_size_bytes
  );

  v_safe_file_name := public.document_storage_sanitize_file_name(p_file_name);
  v_storage_path := concat(
    'tenant/', v_document.tenant_id,
    '/documents/', v_document.id,
    '/', v_safe_file_name
  );
  v_previous_path := v_document.storage_path;

  if v_document.upload_status in ('uploaded', 'pending_upload')
     and v_document.storage_bucket = public.document_storage_bucket_name()
     and v_document.storage_path is not null
     and v_document.file_size_bytes between 1 and 10485760 then
    v_existing_counted_bytes := v_document.file_size_bytes;
    v_document_count_delta := 0;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'document_upload_quota:' || v_document.tenant_id::text, 7174
    )
  );

  perform coachfort_internal.assert_private_storage_quota(
    v_document.tenant_id,
    p_file_size_bytes - v_existing_counted_bytes,
    v_document_count_delta,
    true
  );

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

alter function public.get_tenant_document_storage_usage(uuid) owner to postgres;
alter function public.assert_tenant_document_upload_quota(uuid, bigint)
  owner to postgres;
alter function public.prepare_document_file_upload(uuid, text, text, bigint)
  owner to postgres;

revoke all on function public.get_tenant_document_storage_usage(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_tenant_document_upload_quota(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_document_file_upload(
  uuid, text, text, bigint
) from public, anon, authenticated, service_role;

grant execute on function public.get_tenant_document_storage_usage(uuid)
  to authenticated;
grant execute on function public.assert_tenant_document_upload_quota(uuid, bigint)
  to authenticated;
grant execute on function public.prepare_document_file_upload(
  uuid, text, text, bigint
) to authenticated;

create or replace function coachfort_internal.assignment_attachment_read_scope(
  p_assignment_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments%rowtype;
  v_role text;
  v_course_id uuid;
  v_student record;
begin
  if p_assignment_id is null
     or p_user_id is null
     or auth.uid() is null
     or p_user_id is distinct from auth.uid() then
    return null;
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = p_assignment_id;

  if not found then
    return null;
  end if;

  v_course_id := v_assignment.course_id;

  if v_course_id is null and v_assignment.cohort_id is not null then
    select c.course_id into v_course_id
    from public.cohorts c
    where c.tenant_id = v_assignment.tenant_id
      and c.id = v_assignment.cohort_id;
  end if;

  v_role := public.m69_4_current_role(v_assignment.tenant_id);

  if v_role in ('owner', 'admin', 'staff') then
    return 'team';
  end if;

  if v_role = 'trainer' and public.m69_4_trainer_can_manage_scope(
    v_assignment.tenant_id,
    p_user_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    v_assignment.trainer_user_id
  ) then
    return 'team';
  end if;

  if public.m69_4_delegated_permission_id(
    v_assignment.tenant_id,
    p_user_id,
    array['manage_assignments', 'review_assignments'],
    v_assignment.course_id,
    v_assignment.cohort_id,
    null,
    v_assignment.id
  ) is not null then
    return 'team';
  end if;

  if v_assignment.status not in ('published', 'closed') then
    return null;
  end if;

  for v_student in
    select spa.student_id
    from public.student_portal_accounts spa
    where spa.tenant_id = v_assignment.tenant_id
      and spa.user_id = p_user_id
  loop
    if (
      v_assignment.cohort_id is null
      or exists (
        select 1 from public.cohort_members cm
        where cm.tenant_id = v_assignment.tenant_id
          and cm.cohort_id = v_assignment.cohort_id
          and cm.student_id = v_student.student_id
      )
    ) and public.student_portal_access_allowed(
      v_assignment.tenant_id,
      v_student.student_id,
      p_user_id,
      v_course_id,
      'course_read'
    ) then
      return 'student';
    end if;
  end loop;

  return null;
end;
$$;

alter function coachfort_internal.assignment_attachment_read_scope(uuid, uuid)
  owner to postgres;
revoke all on function coachfort_internal.assignment_attachment_read_scope(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.get_assignment_attachments_secure(
  p_assignment_id uuid
)
returns table (
  id uuid,
  display_file_name text,
  mime_type text,
  byte_size bigint,
  status text,
  created_at timestamptz,
  uploaded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text;
begin
  if auth.uid() is null or p_assignment_id is null then
    raise exception 'Authentication and assignment id are required.'
      using errcode = '42501';
  end if;

  v_scope := coachfort_internal.assignment_attachment_read_scope(
    p_assignment_id, auth.uid()
  );

  if v_scope is null then
    raise exception 'Assignment attachment access denied.' using errcode = '42501';
  end if;

  return query
  select
    aa.id,
    aa.display_file_name,
    aa.mime_type,
    aa.byte_size,
    aa.status,
    aa.created_at,
    aa.uploaded_at
  from public.assignment_attachments aa
  where aa.assignment_id = p_assignment_id
    and aa.purpose = 'assignment'
    and aa.status <> 'removed'
    and (v_scope = 'team' or aa.status = 'uploaded')
  order by aa.created_at, aa.id
  limit 10;
end;
$$;

create or replace function public.prepare_assignment_attachment_upload_secure(
  p_assignment_id uuid,
  p_display_file_name text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.assignments%rowtype;
  v_attachment_id uuid := gen_random_uuid();
  v_safe_file_name text;
  v_mime_type text := lower(trim(coalesce(p_mime_type, '')));
  v_object_path text;
  v_live_count integer;
begin
  if v_actor is null or p_assignment_id is null then
    raise exception 'Authentication and assignment id are required.'
      using errcode = '42501';
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = p_assignment_id
  for share;

  if not found then
    raise exception 'Assignment not found.' using errcode = '02000';
  end if;

  perform public.m69_4_assert_manage_assignment(
    v_assignment.tenant_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    v_assignment.id,
    v_assignment.trainer_user_id
  );

  if v_assignment.status not in ('draft', 'published') then
    raise exception 'Closed assignments cannot receive attachment changes.'
      using errcode = '22023';
  end if;

  perform public.document_storage_validate_file(
    p_display_file_name, v_mime_type, p_byte_size
  );
  v_safe_file_name := public.document_storage_sanitize_file_name(
    p_display_file_name
  );
  v_object_path := concat(
    'tenant/', v_assignment.tenant_id,
    '/assignments/', v_assignment.id,
    '/attachments/', v_attachment_id,
    '/', v_safe_file_name
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'document_upload_quota:' || v_assignment.tenant_id::text, 7174
    )
  );

  perform coachfort_internal.assert_private_storage_quota(
    v_assignment.tenant_id, p_byte_size, 0, false
  );

  select count(*)::integer into v_live_count
  from public.assignment_attachments aa
  where aa.tenant_id = v_assignment.tenant_id
    and aa.assignment_id = v_assignment.id
    and aa.purpose = 'assignment'
    and aa.status in ('pending_upload', 'uploaded', 'pending_delete');

  if v_live_count >= 10 then
    raise exception 'An assignment can have no more than 10 native files.'
      using errcode = '22023';
  end if;

  insert into public.assignment_attachments (
    id, tenant_id, assignment_id, purpose,
    display_file_name, mime_type, byte_size,
    bucket_name, object_path, status, created_by
  ) values (
    v_attachment_id,
    v_assignment.tenant_id,
    v_assignment.id,
    'assignment',
    v_safe_file_name,
    v_mime_type,
    p_byte_size,
    'coachfort-documents',
    v_object_path,
    'pending_upload',
    v_actor
  );

  perform public.m69_4_write_audit(
    v_assignment.tenant_id,
    'assignment_attachment_upload_prepared',
    'assignment_attachment',
    v_attachment_id,
    'Assignment attachment',
    'Prepared assignment attachment upload',
    'info',
    jsonb_build_object(
      'assignmentId', v_assignment.id,
      'fileSizeBytes', p_byte_size,
      'mimeType', v_mime_type
    )
  );

  return jsonb_build_object(
    'id', v_attachment_id,
    'display_file_name', v_safe_file_name,
    'mime_type', v_mime_type,
    'byte_size', p_byte_size,
    'status', 'pending_upload'
  );
end;
$$;

create or replace function public.authorize_assignment_attachment_download_secure(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attachment public.assignment_attachments%rowtype;
  v_scope text;
begin
  if auth.uid() is null or p_attachment_id is null then
    raise exception 'Authentication and attachment id are required.'
      using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id;

  if not found
     or v_attachment.purpose <> 'assignment'
     or v_attachment.status <> 'uploaded' then
    raise exception 'Assignment attachment is unavailable.' using errcode = '02000';
  end if;

  v_scope := coachfort_internal.assignment_attachment_read_scope(
    v_attachment.assignment_id, auth.uid()
  );

  if v_scope is null then
    raise exception 'Assignment attachment access denied.' using errcode = '42501';
  end if;

  perform public.m69_4_write_audit(
    v_attachment.tenant_id,
    'assignment_attachment_download_authorized',
    'assignment_attachment',
    v_attachment.id,
    'Assignment attachment',
    'Authorized assignment attachment download',
    'info',
    jsonb_build_object(
      'assignmentId', v_attachment.assignment_id,
      'actorScope', v_scope
    )
  );

  return jsonb_build_object(
    'id', v_attachment.id,
    'display_file_name', v_attachment.display_file_name,
    'mime_type', v_attachment.mime_type,
    'byte_size', v_attachment.byte_size,
    'status', v_attachment.status
  );
end;
$$;

create or replace function public.prepare_assignment_attachment_removal_secure(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_attachment public.assignment_attachments%rowtype;
  v_assignment public.assignments%rowtype;
begin
  if v_actor is null or p_attachment_id is null then
    raise exception 'Authentication and attachment id are required.'
      using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id
  for update;

  if not found or v_attachment.purpose <> 'assignment' then
    raise exception 'Assignment attachment not found.' using errcode = '02000';
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.id = v_attachment.assignment_id;

  if not found or v_assignment.tenant_id is distinct from v_attachment.tenant_id then
    raise exception 'Assignment attachment relationship is invalid.'
      using errcode = '23514';
  end if;

  perform public.m69_4_assert_manage_assignment(
    v_assignment.tenant_id,
    v_assignment.course_id,
    v_assignment.cohort_id,
    v_assignment.id,
    v_assignment.trainer_user_id
  );

  if v_assignment.status not in ('draft', 'published') then
    raise exception 'Closed assignments cannot receive attachment changes.'
      using errcode = '22023';
  end if;

  if v_attachment.status = 'removed' then
    return jsonb_build_object(
      'id', v_attachment.id,
      'display_file_name', v_attachment.display_file_name,
      'mime_type', v_attachment.mime_type,
      'byte_size', v_attachment.byte_size,
      'status', 'removed',
      'cleanup_mode', 'none'
    );
  end if;

  if v_attachment.status = 'pending_upload' then
    return jsonb_build_object(
      'id', v_attachment.id,
      'display_file_name', v_attachment.display_file_name,
      'mime_type', v_attachment.mime_type,
      'byte_size', v_attachment.byte_size,
      'status', 'pending_upload',
      'cleanup_mode', 'cancel_upload'
    );
  end if;

  if v_attachment.status = 'pending_delete' then
    return jsonb_build_object(
      'id', v_attachment.id,
      'display_file_name', v_attachment.display_file_name,
      'mime_type', v_attachment.mime_type,
      'byte_size', v_attachment.byte_size,
      'status', 'pending_delete',
      'cleanup_mode', 'delete_uploaded'
    );
  end if;

  if v_attachment.status <> 'uploaded' then
    raise exception 'Only uploaded assignment attachments can be removed.'
      using errcode = '22023';
  end if;

  update public.assignment_attachments aa
  set
    status = 'pending_delete',
    delete_requested_at = now(),
    delete_requested_by = v_actor
  where aa.id = v_attachment.id;

  perform public.m69_4_write_audit(
    v_attachment.tenant_id,
    'assignment_attachment_removal_prepared',
    'assignment_attachment',
    v_attachment.id,
    'Assignment attachment',
    'Prepared assignment attachment removal',
    'info',
    jsonb_build_object('assignmentId', v_attachment.assignment_id)
  );

  return jsonb_build_object(
    'id', v_attachment.id,
    'display_file_name', v_attachment.display_file_name,
    'mime_type', v_attachment.mime_type,
    'byte_size', v_attachment.byte_size,
    'status', 'pending_delete',
    'cleanup_mode', 'delete_uploaded'
  );
end;
$$;

create or replace function public.get_assignment_attachment_storage_reference_server(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_attachment public.assignment_attachments%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role access required.' using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id;

  if not found or v_attachment.status = 'removed' then
    raise exception 'Assignment attachment storage reference is unavailable.'
      using errcode = '02000';
  end if;

  if not coachfort_internal.assignment_attachment_path_valid(
    v_attachment.id,
    v_attachment.tenant_id,
    v_attachment.assignment_id,
    v_attachment.student_id,
    v_attachment.purpose,
    v_attachment.display_file_name,
    v_attachment.bucket_name,
    v_attachment.object_path
  ) then
    raise exception 'Assignment attachment storage reference is invalid.'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', v_attachment.id,
    'bucket_name', v_attachment.bucket_name,
    'object_path', v_attachment.object_path,
    'display_file_name', v_attachment.display_file_name,
    'mime_type', v_attachment.mime_type,
    'byte_size', v_attachment.byte_size,
    'status', v_attachment.status
  );
end;
$$;

create or replace function public.finalize_assignment_attachment_upload_server(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attachment public.assignment_attachments%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role access required.' using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id
  for update;

  if not found then
    raise exception 'Assignment attachment not found.' using errcode = '02000';
  end if;

  if v_attachment.status = 'uploaded' then
    return jsonb_build_object('id', v_attachment.id, 'status', 'uploaded');
  end if;

  if v_attachment.status <> 'pending_upload'
     or not coachfort_internal.assignment_attachment_path_valid(
       v_attachment.id,
       v_attachment.tenant_id,
       v_attachment.assignment_id,
       v_attachment.student_id,
       v_attachment.purpose,
       v_attachment.display_file_name,
       v_attachment.bucket_name,
       v_attachment.object_path
     ) then
    raise exception 'Assignment attachment upload cannot be finalized.'
      using errcode = '22023';
  end if;

  update public.assignment_attachments aa
  set status = 'uploaded', uploaded_at = now()
  where aa.id = v_attachment.id;

  return jsonb_build_object('id', v_attachment.id, 'status', 'uploaded');
end;
$$;

create or replace function public.cancel_assignment_attachment_upload_server(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attachment public.assignment_attachments%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role access required.' using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id
  for update;

  if not found then
    raise exception 'Assignment attachment not found.' using errcode = '02000';
  end if;

  if v_attachment.status = 'removed' then
    return jsonb_build_object('id', v_attachment.id, 'status', 'removed');
  end if;

  if v_attachment.status <> 'pending_upload' then
    raise exception 'Assignment attachment upload cannot be cancelled.'
      using errcode = '22023';
  end if;

  update public.assignment_attachments aa
  set
    status = 'removed',
    bucket_name = null,
    object_path = null,
    removed_at = now()
  where aa.id = v_attachment.id;

  return jsonb_build_object('id', v_attachment.id, 'status', 'removed');
end;
$$;

create or replace function public.finalize_assignment_attachment_removal_server(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attachment public.assignment_attachments%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role access required.' using errcode = '42501';
  end if;

  select aa.* into v_attachment
  from public.assignment_attachments aa
  where aa.id = p_attachment_id
  for update;

  if not found then
    raise exception 'Assignment attachment not found.' using errcode = '02000';
  end if;

  if v_attachment.status = 'removed' then
    return jsonb_build_object('id', v_attachment.id, 'status', 'removed');
  end if;

  if v_attachment.status <> 'pending_delete' then
    raise exception 'Assignment attachment removal cannot be finalized.'
      using errcode = '22023';
  end if;

  update public.assignment_attachments aa
  set
    status = 'removed',
    bucket_name = null,
    object_path = null,
    removed_at = now()
  where aa.id = v_attachment.id;

  return jsonb_build_object('id', v_attachment.id, 'status', 'removed');
end;
$$;

alter function public.get_assignment_attachments_secure(uuid) owner to postgres;
alter function public.prepare_assignment_attachment_upload_secure(
  uuid, text, text, bigint
) owner to postgres;
alter function public.authorize_assignment_attachment_download_secure(uuid)
  owner to postgres;
alter function public.prepare_assignment_attachment_removal_secure(uuid)
  owner to postgres;
alter function public.get_assignment_attachment_storage_reference_server(uuid)
  owner to postgres;
alter function public.finalize_assignment_attachment_upload_server(uuid)
  owner to postgres;
alter function public.cancel_assignment_attachment_upload_server(uuid)
  owner to postgres;
alter function public.finalize_assignment_attachment_removal_server(uuid)
  owner to postgres;

revoke all on function public.get_assignment_attachments_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_assignment_attachment_upload_secure(
  uuid, text, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.authorize_assignment_attachment_download_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_assignment_attachment_removal_secure(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_assignment_attachments_secure(uuid)
  to authenticated;
grant execute on function public.prepare_assignment_attachment_upload_secure(
  uuid, text, text, bigint
) to authenticated;
grant execute on function public.authorize_assignment_attachment_download_secure(uuid)
  to authenticated;
grant execute on function public.prepare_assignment_attachment_removal_secure(uuid)
  to authenticated;

revoke all on function public.get_assignment_attachment_storage_reference_server(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_assignment_attachment_upload_server(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_assignment_attachment_upload_server(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_assignment_attachment_removal_server(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_assignment_attachment_storage_reference_server(uuid)
  to service_role;
grant execute on function public.finalize_assignment_attachment_upload_server(uuid)
  to service_role;
grant execute on function public.cancel_assignment_attachment_upload_server(uuid)
  to service_role;
grant execute on function public.finalize_assignment_attachment_removal_server(uuid)
  to service_role;

do $$
declare
  v_function regprocedure;
  v_definition text;
  v_path_definition text;
  v_removal_definition text;
  v_cancel_definition text;
  v_pending_upload_branch text;
  v_browser_grants integer;
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'assignment_attachments'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not c.relforcerowsecurity
      and pg_get_userbyid(c.relowner) = 'postgres'
  ) then
    raise exception 'UX-6F1 postcondition failed: attachment table RLS/owner contract.'
      using errcode = '55000';
  end if;

  select count(*) into v_browser_grants
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name = 'assignment_attachments'
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
  if v_browser_grants <> 0 then
    raise exception 'UX-6F1 postcondition failed: direct attachment table grants remain.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name = 'document_records'
      and tp.grantee = 'authenticated'
      and tp.privilege_type = 'SELECT'
  ) or exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name = 'document_records'
      and (
        tp.grantee in ('PUBLIC', 'anon')
        or (
          tp.grantee = 'authenticated'
          and tp.privilege_type <> 'SELECT'
        )
      )
  ) then
    raise exception 'UX-6F1 postcondition failed: document_records browser ACL contract.'
      using errcode = '55000';
  end if;

  if (
    select count(*) from pg_catalog.pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'assignment_attachments'
      and i.indexname in (
        'assignment_attachments_pkey',
        'assignment_attachments_storage_identity_uidx',
        'assignment_attachments_assignment_list_idx',
        'assignment_attachments_submission_idx',
        'assignment_attachments_student_assignment_idx'
      )
  ) <> 5 then
    raise exception 'UX-6F1 postcondition failed: required indexes are missing.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.assignment_attachments'::regclass
      and t.tgname = 'enforce_assignment_attachment_consistency'
      and not t.tgisinternal and t.tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.assignment_attachments'::regclass
      and t.tgname = 'set_assignment_attachments_updated_at'
      and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception 'UX-6F1 postcondition failed: required triggers are missing.'
      using errcode = '55000';
  end if;

  foreach v_function in array array[
    pg_catalog.to_regprocedure('public.get_assignment_attachments_secure(uuid)'),
    pg_catalog.to_regprocedure('public.prepare_assignment_attachment_upload_secure(uuid,text,text,bigint)'),
    pg_catalog.to_regprocedure('public.authorize_assignment_attachment_download_secure(uuid)'),
    pg_catalog.to_regprocedure('public.prepare_assignment_attachment_removal_secure(uuid)')
  ] loop
    if v_function is null or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_function::oid
        and pg_get_userbyid(p.proowner) = 'postgres'
        and p.prosecdef
        and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array[]::text[]))
    ) or pg_catalog.has_function_privilege('public', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      or not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'UX-6F1 postcondition failed: authenticated RPC contract.'
        using errcode = '55000';
    end if;
  end loop;

  foreach v_function in array array[
    pg_catalog.to_regprocedure('public.get_assignment_attachment_storage_reference_server(uuid)'),
    pg_catalog.to_regprocedure('public.finalize_assignment_attachment_upload_server(uuid)'),
    pg_catalog.to_regprocedure('public.cancel_assignment_attachment_upload_server(uuid)'),
    pg_catalog.to_regprocedure('public.finalize_assignment_attachment_removal_server(uuid)')
  ] loop
    if v_function is null or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_function::oid
        and pg_get_userbyid(p.proowner) = 'postgres'
        and p.prosecdef
        and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array[]::text[]))
    ) or pg_catalog.has_function_privilege('public', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'UX-6F1 postcondition failed: service RPC contract.'
        using errcode = '55000';
    end if;
  end loop;

  foreach v_function in array array[
    pg_catalog.to_regprocedure('coachfort_internal.assignment_attachment_path_valid(uuid,uuid,uuid,uuid,text,text,text,text)'),
    pg_catalog.to_regprocedure('coachfort_internal.enforce_assignment_attachment_consistency()'),
    pg_catalog.to_regprocedure('coachfort_internal.private_storage_usage(uuid)'),
    pg_catalog.to_regprocedure('coachfort_internal.private_storage_limit(uuid,text)'),
    pg_catalog.to_regprocedure('coachfort_internal.assert_private_storage_quota(uuid,bigint,integer,boolean)'),
    pg_catalog.to_regprocedure('coachfort_internal.assignment_attachment_read_scope(uuid,uuid)')
  ] loop
    if v_function is null
       or pg_catalog.has_function_privilege('public', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'UX-6F1 postcondition failed: internal helper is executable.'
        using errcode = '55000';
    end if;
  end loop;

  v_definition := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'coachfort_internal.private_storage_usage(uuid)'
    )), '[[:space:]]+', ' ', 'g'
  ));
  if v_definition not like '%from public.document_records%'
     or v_definition not like '%from public.assignment_attachments%'
     or v_definition not like '%pending_upload%uploaded%pending_delete%'
     or v_definition like '%aa.status in (%removed%' then
    raise exception 'UX-6F1 postcondition failed: canonical storage usage contract.'
      using errcode = '55000';
  end if;

  if position(
    'document_upload_quota:' in lower(pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure('public.prepare_document_file_upload(uuid,text,text,bigint)')
    ))
  ) = 0 or position(
    'document_upload_quota:' in lower(pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure('public.prepare_assignment_attachment_upload_secure(uuid,text,text,bigint)')
    ))
  ) = 0 then
    raise exception 'UX-6F1 postcondition failed: shared storage lock contract.'
      using errcode = '55000';
  end if;

  v_definition := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.prepare_assignment_attachment_upload_secure(uuid,text,text,bigint)'
    )), '[[:space:]]+', ' ', 'g'
  ));
  if v_definition not like '%m69_4_assert_manage_assignment%'
     or v_definition not like '%status not in (''draft'', ''published'')%'
     or v_definition not like '%v_live_count >= 10%'
     or v_definition not like '%''assignment''%'
     or v_definition like '%p_purpose%' then
    raise exception 'UX-6F1 postcondition failed: assignment prepare authorization/lifecycle contract.'
      using errcode = '55000';
  end if;

  v_path_definition := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'coachfort_internal.assignment_attachment_path_valid(uuid,uuid,uuid,uuid,text,text,text,text)'
    )), '[[:space:]]+', ' ', 'g'
  ));
  if v_path_definition not like '%p_purpose = ''assignment''%'
     or v_path_definition not like '%p_student_id is null%'
     or v_path_definition not like '%''/assignments/'', p_assignment_id%''/attachments/'', p_attachment_id%'
     or v_path_definition not like '%p_purpose = ''submission''%'
     or v_path_definition not like '%p_student_id is not null%'
     or v_path_definition not like '%''/submissions/'', p_student_id%''/attachments/'', p_attachment_id%'
     or v_path_definition not like '%p_bucket_name = ''coachfort-documents''%'
     or exists (
       select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'get_assignment_attachments_secure',
           'prepare_assignment_attachment_upload_secure',
           'authorize_assignment_attachment_download_secure',
           'prepare_assignment_attachment_removal_secure'
         )
         and lower(pg_catalog.pg_get_function_arguments(p.oid))
           ~ 'p_[a-z0-9_]*(bucket|path)[a-z0-9_]*'
     ) then
    raise exception 'UX-6F1 postcondition failed: purpose-aware path contract.'
      using errcode = '55000';
  end if;

  v_removal_definition := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.prepare_assignment_attachment_removal_secure(uuid)'
    )), '[[:space:]]+', ' ', 'g'
  ));
  v_cancel_definition := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'public.cancel_assignment_attachment_upload_server(uuid)'
    )), '[[:space:]]+', ' ', 'g'
  ));
  v_pending_upload_branch := (
    pg_catalog.regexp_match(
      v_removal_definition,
      'if v_attachment.status = ''pending_upload'' then (.*?) end if;'
    )
  )[1];

  if v_removal_definition not like '%m69_4_assert_manage_assignment%'
     or v_removal_definition not like '%status not in (''draft'', ''published'')%'
     or v_pending_upload_branch is null
     or v_pending_upload_branch not like '%''status'', ''pending_upload''%'
     or v_pending_upload_branch not like '%''cleanup_mode'', ''cancel_upload''%'
     or v_pending_upload_branch like '%update public.assignment_attachments%'
     or v_pending_upload_branch like '%pending_delete%'
     or v_removal_definition not like '%if v_attachment.status = ''pending_delete'' then%''cleanup_mode'', ''delete_uploaded''%'
     or v_removal_definition not like '%if v_attachment.status = ''removed'' then%''cleanup_mode'', ''none''%'
     or v_cancel_definition not like '%status <> ''pending_upload''%'
     or v_cancel_definition not like '%set status = ''removed''%'
     or pg_catalog.to_regprocedure(
       'public.cancel_assignment_attachment_upload_server(uuid)'
     ) is null then
    raise exception 'UX-6F1 postcondition failed: pending upload recovery contract.'
      using errcode = '55000';
  end if;

  v_definition := lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'coachfort_internal.assignment_attachment_read_scope(uuid,uuid)'
    )), '[[:space:]]+', ' ', 'g'
  ));
  if v_definition not like '%p_user_id is distinct from auth.uid()%'
     or v_definition not like '%status not in (''published'', ''closed'')%'
     or v_definition not like '%from public.cohort_members%'
     or v_definition not like '%student_portal_access_allowed%course_read%'
     or v_definition not like '%m69_4_trainer_can_manage_scope%'
     or v_definition not like '%review_assignments%' then
    raise exception 'UX-6F1 postcondition failed: assignment read authorization contract.'
      using errcode = '55000';
  end if;

  if coalesce(
       'coachfort_internal' = any(regexp_split_to_array(
         replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
       )), false
     ) or exists (
       select 1 from pg_catalog.pg_db_role_setting rs
       join pg_catalog.pg_roles r on r.oid = rs.setrole
       cross join lateral unnest(rs.setconfig) settings(setting)
       cross join lateral regexp_split_to_table(
         split_part(settings.setting, '=', 2), ','
       ) exposed(schema_name)
       where r.rolname = 'authenticator'
         and rs.setdatabase in (
           0,
           (select d.oid from pg_catalog.pg_database d
            where d.datname = current_database())
         )
         and settings.setting like 'pgrst.db_schemas=%'
         and btrim(exposed.schema_name) = 'coachfort_internal'
     ) then
    raise exception 'UX-6F1 postcondition failed: internal schema API exposure.'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
       'public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)'
     ) is null then
    raise exception 'UX-6F1 postcondition failed: assignment RPC compatibility.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'assignments'
      and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'assignment_submissions'
      and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
  ) or exists (
    select 1 from public.assignment_attachments aa
    where aa.purpose = 'submission'
  ) then
    raise exception 'UX-6F1 postcondition failed: legacy/deferred submission contract.'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

Run this query after applying the executable migration. `security_gate` is true
only when the installed metadata and source contracts remain fail closed.

with
table_contract as (
  select jsonb_build_object(
    'installed', c.oid is not null,
    'owner', case when c.oid is null then null else pg_get_userbyid(c.relowner) end,
    'rls_enabled', coalesce(c.relrowsecurity, false),
    'rls_forced', coalesce(c.relforcerowsecurity, false),
    'column_count', (
      select count(*) from information_schema.columns col
      where col.table_schema = 'public'
        and col.table_name = 'assignment_attachments'
    ),
    'row_count', (select count(*) from public.assignment_attachments),
    'submission_purpose_rows', (
      select count(*) from public.assignment_attachments aa
      where aa.purpose = 'submission'
    )
  ) as value
  from (select pg_catalog.to_regclass('public.assignment_attachments') as oid) x
  left join pg_catalog.pg_class c on c.oid = x.oid
), index_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', i.indexname, 'definition', i.indexdef
  ) order by i.indexname), '[]'::jsonb) as value,
  count(*) filter (where i.indexname in (
    'assignment_attachments_pkey',
    'assignment_attachments_storage_identity_uidx',
    'assignment_attachments_assignment_list_idx',
    'assignment_attachments_submission_idx',
    'assignment_attachments_student_assignment_idx'
  )) = 5 as passed
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public' and i.tablename = 'assignment_attachments'
), direct_grant_state as (
  select jsonb_build_object(
    'grants', coalesce(jsonb_agg(jsonb_build_object(
      'grantee', tp.grantee, 'privilege', tp.privilege_type
    ) order by tp.grantee, tp.privilege_type), '[]'::jsonb),
    'browser_or_service_grants', count(*)
  ) as value,
  count(*) = 0 as passed
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name = 'assignment_attachments'
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), document_records_acl_counts as (
  select
    count(*) filter (
      where tp.grantee = 'authenticated' and tp.privilege_type = 'SELECT'
    ) as authenticated_select_grants,
    count(*) filter (where tp.grantee = 'PUBLIC') as public_privileges,
    count(*) filter (where tp.grantee = 'anon') as anon_privileges,
    count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) as browser_write_grants,
    count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon', 'authenticated')
        and tp.privilege_type in (
          'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'
        )
    ) as browser_dangerous_grants,
    count(*) filter (
      where tp.grantee in ('PUBLIC', 'anon')
         or (tp.grantee = 'authenticated' and tp.privilege_type <> 'SELECT')
    ) as unexpected_browser_grants,
    count(*) filter (where tp.grantee = 'authenticated') as authenticated_grants
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.table_name = 'document_records'
    and tp.grantee in ('PUBLIC', 'anon', 'authenticated')
), document_records_acl_state as (
  select jsonb_build_object(
    'authenticated_select_preserved', authenticated_select_grants > 0,
    'public_privileges_absent', public_privileges = 0,
    'anon_privileges_absent', anon_privileges = 0,
    'browser_write_grants', browser_write_grants,
    'browser_dangerous_grants', browser_dangerous_grants,
    'unexpected_browser_grants', unexpected_browser_grants,
    'authenticated_select_only',
      authenticated_select_grants > 0
      and authenticated_grants = authenticated_select_grants
  ) as value,
  authenticated_select_grants > 0
    and public_privileges = 0
    and anon_privileges = 0
    and browser_write_grants = 0
    and browser_dangerous_grants = 0
    and unexpected_browser_grants = 0
    and authenticated_grants = authenticated_select_grants as passed
  from document_records_acl_counts
), expected_functions(identity, expected_role) as (
  values
    ('public.get_assignment_attachments_secure(uuid)', 'authenticated'),
    ('public.prepare_assignment_attachment_upload_secure(uuid,text,text,bigint)', 'authenticated'),
    ('public.authorize_assignment_attachment_download_secure(uuid)', 'authenticated'),
    ('public.prepare_assignment_attachment_removal_secure(uuid)', 'authenticated'),
    ('public.get_assignment_attachment_storage_reference_server(uuid)', 'service_role'),
    ('public.finalize_assignment_attachment_upload_server(uuid)', 'service_role'),
    ('public.cancel_assignment_attachment_upload_server(uuid)', 'service_role'),
    ('public.finalize_assignment_attachment_removal_server(uuid)', 'service_role')
), rpc_state as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'identity', ef.identity,
    'expected_role', ef.expected_role,
    'installed', p.oid is not null,
    'owner', case when p.oid is null then null else pg_get_userbyid(p.proowner) end,
    'security_definer', coalesce(p.prosecdef, false),
    'configuration', coalesce(p.proconfig, array[]::text[]),
    'public_execute', p.oid is not null and has_function_privilege('public', p.oid, 'EXECUTE'),
    'anon_execute', p.oid is not null and has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', p.oid is not null and has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_role_execute', p.oid is not null and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) order by ef.identity), '[]'::jsonb) as value,
  bool_and(
    p.oid is not null
    and pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef
    and 'search_path=public, pg_temp' = any(coalesce(p.proconfig, array[]::text[]))
    and not has_function_privilege('public', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE')
    and (has_function_privilege('authenticated', p.oid, 'EXECUTE') = (ef.expected_role = 'authenticated'))
    and (has_function_privilege('service_role', p.oid, 'EXECUTE') = (ef.expected_role = 'service_role'))
  ) as passed
  from expected_functions ef
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(ef.identity)
), private_helper_state as (
  select jsonb_build_object(
    'helpers', coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '[]'::jsonb),
    'unexpected_execute_grants', count(*) filter (
      where has_function_privilege('public', p.oid, 'EXECUTE')
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
  ) as value,
  count(*) = 6 and count(*) filter (
    where has_function_privilege('public', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) = 0 as passed
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'coachfort_internal'
    and p.proname in (
      'assignment_attachment_path_valid',
      'enforce_assignment_attachment_consistency',
      'private_storage_usage',
      'private_storage_limit',
      'assert_private_storage_quota',
      'assignment_attachment_read_scope'
    )
), internal_schema_state as (
  select jsonb_build_object(
    'installed', n.oid is not null,
    'owner', case when n.oid is null then null else pg_get_userbyid(n.nspowner) end,
    'api_exposed', coalesce(
      'coachfort_internal' = any(regexp_split_to_array(
        replace(current_setting('pgrst.db_schemas', true), ' ', ''), ','
      )), false
    ) or exists (
      select 1 from pg_catalog.pg_db_role_setting rs
      join pg_catalog.pg_roles r on r.oid = rs.setrole
      cross join lateral unnest(rs.setconfig) settings(setting)
      cross join lateral regexp_split_to_table(
        split_part(settings.setting, '=', 2), ','
      ) exposed(schema_name)
      where r.rolname = 'authenticator'
        and rs.setdatabase in (
          0,
          (select d.oid from pg_catalog.pg_database d
           where d.datname = current_database())
        )
        and settings.setting like 'pgrst.db_schemas=%'
        and btrim(exposed.schema_name) = 'coachfort_internal'
    )
  ) as value
  from (select pg_catalog.to_regnamespace('coachfort_internal') as oid) x
  left join pg_catalog.pg_namespace n on n.oid = x.oid
), caller_path_state as (
  select not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_assignment_attachments_secure',
        'prepare_assignment_attachment_upload_secure',
        'authorize_assignment_attachment_download_secure',
        'prepare_assignment_attachment_removal_secure'
      )
      and lower(pg_catalog.pg_get_function_arguments(p.oid))
        ~ 'p_[a-z0-9_]*(bucket|path)[a-z0-9_]*'
  ) as passed
), source_state as (
  select jsonb_build_object(
    'quota_contract', jsonb_build_object(
      'documents_counted', usage_source like '%from public.document_records%',
      'assignments_counted', usage_source like '%from public.assignment_attachments%',
      'live_statuses_counted', usage_source like '%pending_upload%uploaded%pending_delete%',
      'removed_excluded', usage_source not like '%aa.status in (%removed%',
      'document_count_document_specific', usage_source like '%document_count_usage%'
    ),
    'shared_lock_contract', jsonb_build_object(
      'document_prepare', document_prepare_source like '%document_upload_quota:%7174%',
      'assignment_prepare', assignment_prepare_source like '%document_upload_quota:%7174%'
    ),
    'assignment_lifecycle_contract', jsonb_build_object(
      'manage_helper', assignment_prepare_source like '%m69_4_assert_manage_assignment%',
      'draft_published_only', assignment_prepare_source like '%status not in (''draft'', ''published'')%',
      'native_limit', assignment_prepare_source like '%v_live_count >= 10%'
    ),
    'student_download_contract', jsonb_build_object(
      'auth_bound', read_source like '%p_user_id is distinct from auth.uid()%',
      'published_closed', read_source like '%status not in (''published'', ''closed'')%',
      'cohort_membership', read_source like '%from public.cohort_members%',
      'canonical_course_read', read_source like '%student_portal_access_allowed%course_read%'
    ),
    'path_contract', jsonb_build_object(
      'assignment_path_supported',
        path_source like '%p_purpose = ''assignment''%'
        and path_source like '%p_student_id is null%'
        and path_source like '%''/assignments/'', p_assignment_id%''/attachments/'', p_attachment_id%',
      'submission_path_supported',
        path_source like '%p_purpose = ''submission''%'
        and path_source like '%p_student_id is not null%'
        and path_source like '%''/submissions/'', p_student_id%''/attachments/'', p_attachment_id%',
      'bucket_fixed', path_source like '%p_bucket_name = ''coachfort-documents''%',
      'caller_path_absent', caller_path_state.passed
    ),
    'recovery_contract', jsonb_build_object(
      'pending_upload_manager_authorized',
        removal_source like '%m69_4_assert_manage_assignment%'
        and removal_source like '%status not in (''draft'', ''published'')%'
        and pending_upload_branch like '%''cleanup_mode'', ''cancel_upload''%',
      'pending_upload_not_changed_to_pending_delete',
        pending_upload_branch not like '%update public.assignment_attachments%'
        and pending_upload_branch not like '%pending_delete%',
      'service_cancel_available',
        cancel_source like '%status <> ''pending_upload''%'
        and cancel_source like '%set status = ''removed''%',
      'pending_delete_retry_supported',
        removal_source like '%if v_attachment.status = ''pending_delete'' then%''cleanup_mode'', ''delete_uploaded''%',
      'removed_idempotent',
        removal_source like '%if v_attachment.status = ''removed'' then%''cleanup_mode'', ''none''%'
    )
  ) as value,
  usage_source like '%from public.document_records%'
    and usage_source like '%from public.assignment_attachments%'
    and usage_source like '%pending_upload%uploaded%pending_delete%'
    and document_prepare_source like '%document_upload_quota:%7174%'
    and assignment_prepare_source like '%document_upload_quota:%7174%'
    and assignment_prepare_source like '%m69_4_assert_manage_assignment%'
    and assignment_prepare_source like '%status not in (''draft'', ''published'')%'
    and read_source like '%p_user_id is distinct from auth.uid()%'
    and read_source like '%from public.cohort_members%'
    and read_source like '%student_portal_access_allowed%course_read%'
    and path_source like '%p_purpose = ''assignment''%'
    and path_source like '%p_student_id is null%'
    and path_source like '%''/assignments/'', p_assignment_id%''/attachments/'', p_attachment_id%'
    and path_source like '%p_purpose = ''submission''%'
    and path_source like '%p_student_id is not null%'
    and path_source like '%''/submissions/'', p_student_id%''/attachments/'', p_attachment_id%'
    and path_source like '%p_bucket_name = ''coachfort-documents''%'
    and caller_path_state.passed
    and removal_source like '%m69_4_assert_manage_assignment%'
    and removal_source like '%status not in (''draft'', ''published'')%'
    and pending_upload_branch like '%''status'', ''pending_upload''%'
    and pending_upload_branch like '%''cleanup_mode'', ''cancel_upload''%'
    and pending_upload_branch not like '%update public.assignment_attachments%'
    and pending_upload_branch not like '%pending_delete%'
    and removal_source like '%if v_attachment.status = ''pending_delete'' then%''cleanup_mode'', ''delete_uploaded''%'
    and removal_source like '%if v_attachment.status = ''removed'' then%''cleanup_mode'', ''none''%'
    and cancel_source like '%status <> ''pending_upload''%'
    and cancel_source like '%set status = ''removed''%' as passed
  from (
    select raw_sources.*,
      coalesce((regexp_match(
        raw_sources.removal_source,
        'if v_attachment.status = ''pending_upload'' then (.*?) end if;'
      ))[1], '') as pending_upload_branch
    from (
      select
        lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'coachfort_internal.private_storage_usage(uuid)'
        )), '[[:space:]]+', ' ', 'g')) as usage_source,
        lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.prepare_document_file_upload(uuid,text,text,bigint)'
        )), '[[:space:]]+', ' ', 'g')) as document_prepare_source,
        lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.prepare_assignment_attachment_upload_secure(uuid,text,text,bigint)'
        )), '[[:space:]]+', ' ', 'g')) as assignment_prepare_source,
        lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'coachfort_internal.assignment_attachment_read_scope(uuid,uuid)'
        )), '[[:space:]]+', ' ', 'g')) as read_source,
        lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'coachfort_internal.assignment_attachment_path_valid(uuid,uuid,uuid,uuid,text,text,text,text)'
        )), '[[:space:]]+', ' ', 'g')) as path_source,
        lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.prepare_assignment_attachment_removal_secure(uuid)'
        )), '[[:space:]]+', ' ', 'g')) as removal_source,
        lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.cancel_assignment_attachment_upload_server(uuid)'
        )), '[[:space:]]+', ' ', 'g')) as cancel_source
    ) raw_sources
  ) sources
  cross join caller_path_state
), compatibility_state as (
  select jsonb_build_object(
    'create_assignment', to_regprocedure('public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)') is not null,
    'update_assignment', to_regprocedure('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)') is not null,
    'submit_assignment', to_regprocedure('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)') is not null,
    'safe_review', to_regprocedure('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)') is not null,
    'safe_delegated_review', to_regprocedure('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)') is not null,
    'document_prepare', to_regprocedure('public.prepare_document_file_upload(uuid,text,text,bigint)') is not null,
    'legacy_assignment_urls', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'assignments'
        and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
    ),
    'legacy_submission_urls', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'assignment_submissions'
        and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
    ),
    'student_submission_upload_rpc_count', (
      select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%submission%attachment%upload%'
    )
  ) as value,
  to_regprocedure('public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)') is not null
    and to_regprocedure('public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)') is not null
    and to_regprocedure('public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)') is not null
    and to_regprocedure('public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)') is not null
    and to_regprocedure('public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)') is not null
    and to_regprocedure('public.prepare_document_file_upload(uuid,text,text,bigint)') is not null
    and exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'assignments'
        and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
    )
    and exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'assignment_submissions'
        and c.column_name = 'attachment_urls_json' and c.udt_name = 'jsonb'
    )
    and not exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%submission%attachment%upload%'
    ) as passed
), gate as (
  select
    (tc.value->>'installed')::boolean
    and tc.value->>'owner' = 'postgres'
    and (tc.value->>'rls_enabled')::boolean
    and not (tc.value->>'rls_forced')::boolean
    and (tc.value->>'submission_purpose_rows')::integer = 0
    and ix.passed
    and dg.passed
    and dra.passed
    and rpc.passed
    and ph.passed
    and not (ins.value->>'api_exposed')::boolean
    and ss.passed
    and cs.passed as security_gate
  from table_contract tc
  cross join index_state ix
  cross join direct_grant_state dg
  cross join document_records_acl_state dra
  cross join rpc_state rpc
  cross join private_helper_state ph
  cross join internal_schema_state ins
  cross join source_state ss
  cross join compatibility_state cs
)
select jsonb_build_object(
  'security_gate', (select security_gate from gate),
  'table_contract', (select value from table_contract),
  'indexes', (select value from index_state),
  'rls', jsonb_build_object(
    'enabled', ((select value from table_contract)->>'rls_enabled')::boolean,
    'forced', ((select value from table_contract)->>'rls_forced')::boolean
  ),
  'direct_grants', (select value from direct_grant_state),
  'document_records_acl_contract', (select value from document_records_acl_state),
  'rpc_contract', (select value from rpc_state),
  'service_rpc_contract', (select value from rpc_state),
  'private_helpers', (select value from private_helper_state),
  'internal_schema', (select value from internal_schema_state),
  'quota_contract', (select value->'quota_contract' from source_state),
  'shared_lock_contract', (select value->'shared_lock_contract' from source_state),
  'document_center_compatibility', (select value from compatibility_state),
  'assignment_lifecycle_contract', (select value->'assignment_lifecycle_contract' from source_state),
  'student_download_contract', (select value->'student_download_contract' from source_state),
  'path_contract', (select value->'path_contract' from source_state),
  'recovery_contract', (select value->'recovery_contract' from source_state),
  'legacy_url_contract', (select value from compatibility_state),
  'submission_deferred_contract', jsonb_build_object(
    'submission_purpose_rows', ((select value from table_contract)->>'submission_purpose_rows')::integer,
    'student_submission_upload_rpc_count', ((select value from compatibility_state)->>'student_submission_upload_rpc_count')::integer
  )
) as ux6f1_post_apply_verification;
*/
