-- Bundle UX-3C: Secure enrollment request lifecycle and approval core.
-- Proposal only. Review before execution.
--
-- This migration keeps the legacy approval RPC and CRM status column in place.
-- It does not provision portal accounts, call Auth Admin, send email, or write
-- finance, payment, invoice, receipt, subscription, or checkout records.

begin;

-- ---------------------------------------------------------------------------
-- 1. Close excess table privileges
-- ---------------------------------------------------------------------------

revoke truncate, trigger, references, maintain
on table public.public_site_leads
from public, anon, authenticated, service_role;

revoke insert, update, delete
on table public.public_site_leads
from public, anon, authenticated;

grant select
on table public.public_site_leads
to authenticated;

revoke truncate, trigger, references, maintain
on table public.student_portal_accounts
from public, anon, authenticated, service_role;

revoke insert, update, delete
on table public.student_portal_accounts
from public, anon, authenticated;

grant select
on table public.student_portal_accounts
to authenticated;

grant select, insert, update
on table public.student_portal_accounts
to service_role;

-- ---------------------------------------------------------------------------
-- 2. Normalized student email protection
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from public.students as s
    where nullif(btrim(s.email), '') is not null
    group by s.tenant_id, lower(btrim(s.email))
    having count(*) > 1
  ) then
    raise exception
      'Student email uniqueness cannot be enabled because duplicate normalized emails exist.'
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists students_tenant_normalized_email_uidx
on public.students (tenant_id, lower(btrim(email)))
where nullif(btrim(email), '') is not null;

create or replace function public.create_student_secure(
  p_tenant_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_source text default null,
  p_status text default 'active',
  p_notes text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  full_name text,
  email text,
  phone text,
  status text,
  source text,
  notes text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_full_name text;
  v_email text;
  v_phone text;
  v_source text;
  v_status text;
  v_notes text;
  v_student public.students%rowtype;
  v_constraint_name text;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);

  v_full_name := public.m69_1_normalize_text(p_full_name, 'Full name', true, 160);
  v_email := lower(
    nullif(
      btrim(
        public.m69_1_normalize_text(
          p_email,
          'Email',
          false,
          254
        )
      ),
      ''
    )
  );
  v_phone := public.m69_1_normalize_text(p_phone, 'Phone', false, 40);
  v_source := public.m69_1_normalize_text(p_source, 'Source', false, 80);
  v_notes := public.m69_1_normalize_text(p_notes, 'Notes', false, 2000);
  v_status := public.m69_1_validate_student_status(p_status);

  perform public.assert_tenant_entity_usage_limit(p_tenant_id, 'students', 1, false);

  insert into public.students (
    tenant_id,
    full_name,
    email,
    phone,
    status,
    source,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    v_full_name,
    v_email,
    v_phone,
    v_status,
    v_source,
    v_notes,
    v_actor
  )
  returning * into v_student;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'student_created',
    'student',
    v_student.id,
    'Student profile',
    'Created new student profile',
    'info',
    jsonb_build_object(
      'studentId', v_student.id,
      'status', v_student.status
    )
  );

  return query
  select
    v_student.id,
    v_student.tenant_id,
    v_student.full_name,
    v_student.email,
    v_student.phone,
    v_student.status,
    v_student.source,
    v_student.notes,
    v_student.created_by,
    v_student.created_at,
    v_student.updated_at;
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name = 'students_tenant_normalized_email_uidx' then
      raise exception
        'A student with this email already exists in this workspace. Use the existing student.'
        using
          errcode = '23505',
          constraint = v_constraint_name;
    end if;

    raise;
end;
$$;

create or replace function public.update_student_secure(
  p_tenant_id uuid,
  p_student_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_source text default null,
  p_status text default 'active',
  p_notes text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  full_name text,
  email text,
  phone text,
  status text,
  source text,
  notes text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_email text;
  v_phone text;
  v_source text;
  v_status text;
  v_notes text;
  v_student public.students%rowtype;
  v_constraint_name text;
begin
  perform public.m69_1_assert_manage_students(p_tenant_id);
  perform public.m69_1_assert_student_in_tenant(p_tenant_id, p_student_id);

  v_full_name := public.m69_1_normalize_text(p_full_name, 'Full name', true, 160);
  v_email := lower(
    nullif(
      btrim(
        public.m69_1_normalize_text(
          p_email,
          'Email',
          false,
          254
        )
      ),
      ''
    )
  );
  v_phone := public.m69_1_normalize_text(p_phone, 'Phone', false, 40);
  v_source := public.m69_1_normalize_text(p_source, 'Source', false, 80);
  v_notes := public.m69_1_normalize_text(p_notes, 'Notes', false, 2000);
  v_status := public.m69_1_validate_student_status(p_status);

  update public.students as s
  set
    full_name = v_full_name,
    email = v_email,
    phone = v_phone,
    source = v_source,
    status = v_status,
    notes = v_notes
  where s.tenant_id = p_tenant_id
    and s.id = p_student_id
  returning * into v_student;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'student_updated',
    'student',
    v_student.id,
    'Student profile',
    'Updated student profile',
    'info',
    jsonb_build_object(
      'studentId', v_student.id,
      'status', v_student.status
    )
  );

  return query
  select
    v_student.id,
    v_student.tenant_id,
    v_student.full_name,
    v_student.email,
    v_student.phone,
    v_student.status,
    v_student.source,
    v_student.notes,
    v_student.created_by,
    v_student.created_at,
    v_student.updated_at;
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name = 'students_tenant_normalized_email_uidx' then
      raise exception
        'A student with this email already exists in this workspace. Use the existing student.'
        using
          errcode = '23505',
          constraint = v_constraint_name;
    end if;

    raise;
end;
$$;

-- Preserve the established authenticated-only mutation boundary.
revoke execute on function public.create_student_secure(
  uuid, text, text, text, text, text, text
) from public, anon, service_role;
revoke execute on function public.update_student_secure(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, service_role;
grant execute on function public.create_student_secure(
  uuid, text, text, text, text, text, text
) to authenticated;
grant execute on function public.update_student_secure(
  uuid, uuid, text, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Request lifecycle fields
-- ---------------------------------------------------------------------------

alter table public.public_site_leads
  add column if not exists enrollment_request_status text not null default 'new',
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists processed_by uuid,
  add column if not exists rejection_reason text,
  add column if not exists last_error_code text,
  add column if not exists approval_idempotency_key text,
  add column if not exists approval_student_action text,
  add column if not exists approval_enrollment_action text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'public_site_leads_processed_by_fkey'
      and conrelid = 'public.public_site_leads'::regclass
  ) then
    alter table public.public_site_leads
      add constraint public_site_leads_processed_by_fkey
      foreign key (processed_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'public_site_leads_enrollment_request_status_check'
      and conrelid = 'public.public_site_leads'::regclass
  ) then
    alter table public.public_site_leads
      add constraint public_site_leads_enrollment_request_status_check
      check (
        enrollment_request_status in (
          'new', 'processing', 'enrolled', 'rejected', 'needs_attention'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'public_site_leads_approval_result_actions_check'
      and conrelid = 'public.public_site_leads'::regclass
  ) then
    alter table public.public_site_leads
      add constraint public_site_leads_approval_result_actions_check
      check (
        (
          approval_student_action is null
          or approval_student_action in ('matched', 'selected', 'created')
        )
        and (
          approval_enrollment_action is null
          or approval_enrollment_action in ('reused', 'created')
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'public_site_leads_rejection_reason_check'
      and conrelid = 'public.public_site_leads'::regclass
  ) then
    alter table public.public_site_leads
      add constraint public_site_leads_rejection_reason_check
      check (
        rejection_reason is null
        or (
          char_length(rejection_reason) <= 1000
          and rejection_reason !~ '[<>]'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'public_site_leads_last_error_code_check'
      and conrelid = 'public.public_site_leads'::regclass
  ) then
    alter table public.public_site_leads
      add constraint public_site_leads_last_error_code_check
      check (
        last_error_code is null
        or last_error_code ~ '^[a-z0-9_:-]{1,80}$'
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'public_site_leads_approval_idempotency_key_check'
      and conrelid = 'public.public_site_leads'::regclass
  ) then
    alter table public.public_site_leads
      add constraint public_site_leads_approval_idempotency_key_check
      check (
        approval_idempotency_key is null
        or (
          char_length(approval_idempotency_key) between 8 and 160
          and approval_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'public_site_leads_enrolled_links_check'
      and conrelid = 'public.public_site_leads'::regclass
  ) then
    alter table public.public_site_leads
      add constraint public_site_leads_enrolled_links_check
      check (
        enrollment_request_status <> 'enrolled'
        or (
          converted_student_id is not null
          and converted_enrollment_id is not null
          and processed_at is not null
        )
      );
  end if;
end;
$$;

-- Preserve existing requests while mapping completed legacy lifecycle states.
update public.public_site_leads
set
  enrollment_request_status = 'enrolled',
  processed_at = coalesce(processed_at, converted_at, created_at),
  processed_by = coalesce(processed_by, converted_by),
  processing_started_at = null,
  last_error_code = null
where status = 'converted'
  and converted_student_id is not null
  and converted_enrollment_id is not null;

update public.public_site_leads
set
  enrollment_request_status = 'rejected',
  processed_at = coalesce(processed_at, created_at),
  processing_started_at = null,
  last_error_code = null
where status = 'closed'
  and converted_student_id is null
  and converted_enrollment_id is null;

create index if not exists public_site_leads_tenant_request_status_created_idx
on public.public_site_leads (
  tenant_id,
  enrollment_request_status,
  created_at desc
);

create unique index if not exists public_site_leads_tenant_approval_key_uidx
on public.public_site_leads (tenant_id, approval_idempotency_key)
where approval_idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 4. Transactional approval RPC v2
-- ---------------------------------------------------------------------------

create or replace function public.approve_public_program_enrollment_request_v2(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_existing_student_id uuid default null,
  p_student_name text default null,
  p_student_email text default null,
  p_student_phone text default null,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.public_site_leads%rowtype;
  v_course public.courses%rowtype;
  v_student public.students%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_student_name text;
  v_student_email text;
  v_student_phone text;
  v_note text;
  v_idempotency_key text;
  v_student_action text;
  v_enrollment_action text;
  v_phone_match_count integer := 0;
  v_constraint_name text;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    v_actor,
    array['owner', 'admin']
  ) then
    raise exception
      'Only workspace owners and admins can approve enrollment requests.'
      using errcode = '42501';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  v_idempotency_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if v_note is not null
     and (char_length(v_note) > 1000 or v_note ~ '[<>]') then
    raise exception 'Approval note must be plain text under 1000 characters.'
      using errcode = '22023';
  end if;

  if v_idempotency_key is not null
     and (
       char_length(v_idempotency_key) not between 8 and 160
       or v_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
     ) then
    raise exception 'Approval request key is invalid.' using errcode = '22023';
  end if;

  select l.*
  into v_lead
  from public.public_site_leads as l
  where l.id = p_lead_id
    and l.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Enrollment request not found.' using errcode = '22023';
  end if;

  if v_lead.interested_course_id is null then
    raise exception 'Enrollment request is not linked to a program.'
      using errcode = '22023';
  end if;

  select c.*
  into v_course
  from public.courses as c
  where c.id = v_lead.interested_course_id
    and c.tenant_id = p_tenant_id
  for share;

  if not found then
    raise exception 'Program not found for this workspace.' using errcode = '22023';
  end if;

  if v_course.status <> 'published'
     and v_lead.enrollment_request_status <> 'enrolled' then
    raise exception 'Program must be published before a student can be enrolled.'
      using errcode = '22023';
  end if;

  if v_lead.enrollment_request_status = 'rejected' then
    raise exception 'Rejected enrollment requests cannot be approved.'
      using errcode = '22023';
  end if;

  if v_lead.approval_idempotency_key is not null
     and v_idempotency_key is not null
     and v_lead.approval_idempotency_key <> v_idempotency_key then
    raise exception 'This enrollment request already uses a different request key.'
      using errcode = '22023';
  end if;

  if v_idempotency_key is not null and exists (
    select 1
    from public.public_site_leads as other_lead
    where other_lead.tenant_id = p_tenant_id
      and other_lead.approval_idempotency_key = v_idempotency_key
      and other_lead.id <> v_lead.id
  ) then
    raise exception 'This approval request key has already been used.'
      using errcode = '23505';
  end if;

  if v_lead.enrollment_request_status = 'enrolled'
     and v_lead.converted_student_id is not null
     and v_lead.converted_enrollment_id is not null then
    select s.*
    into v_student
    from public.students as s
    where s.id = v_lead.converted_student_id
      and s.tenant_id = p_tenant_id
    for share;

    if found then
      select e.*
      into v_enrollment
      from public.enrollments as e
      where e.id = v_lead.converted_enrollment_id
        and e.tenant_id = p_tenant_id
        and e.student_id = v_student.id
        and e.course_id = v_course.id
        and e.status in ('active', 'completed')
      for share;
    end if;

    if v_student.id is not null and v_enrollment.id is not null then
      if v_idempotency_key is not null
         and v_lead.approval_idempotency_key is null then
        begin
          update public.public_site_leads as l
          set approval_idempotency_key = v_idempotency_key
          where l.id = v_lead.id
            and l.tenant_id = p_tenant_id;
        exception
          when unique_violation then
            get stacked diagnostics v_constraint_name = constraint_name;

            if v_constraint_name = 'public_site_leads_tenant_approval_key_uidx' then
              raise exception 'This approval request key has already been used.'
                using
                  errcode = '23505',
                  constraint = v_constraint_name;
            end if;

            raise;
        end;
      end if;

      return jsonb_build_object(
        'request_id', v_lead.id,
        'enrollment_request_status', 'enrolled',
        'student', jsonb_build_object(
          'id', v_student.id,
          'status', v_student.status
        ),
        'student_action', coalesce(
          v_lead.approval_student_action,
          'matched'
        ),
        'enrollment', jsonb_build_object(
          'id', v_enrollment.id,
          'status', v_enrollment.status
        ),
        'enrollment_action', coalesce(
          v_lead.approval_enrollment_action,
          'reused'
        ),
        'portal_access_status', 'not_started',
        'replayed', true
      );
    end if;

    update public.public_site_leads as l
    set
      enrollment_request_status = 'needs_attention',
      processing_started_at = null,
      processed_at = now(),
      processed_by = v_actor,
      last_error_code = 'invalid_enrollment_links',
      approval_student_action = null,
      approval_enrollment_action = null
    where l.id = v_lead.id
      and l.tenant_id = p_tenant_id;

    perform public.m69_1_write_audit(
      p_tenant_id,
      'public_program_request_needs_attention',
      'public_site_lead',
      v_lead.id,
      'Enrollment request',
      'Enrollment request needs attention because its enrollment links are invalid.',
      'warning',
      jsonb_build_object('errorCode', 'invalid_enrollment_links')
    );

    return jsonb_build_object(
      'request_id', v_lead.id,
      'enrollment_request_status', 'needs_attention',
      'error_code', 'invalid_enrollment_links',
      'message', 'The existing enrollment links need review before continuing.',
      'portal_access_status', 'not_started',
      'replayed', false
    );
  end if;

  begin
    update public.public_site_leads as l
    set
      enrollment_request_status = 'processing',
      processing_started_at = now(),
      processed_at = null,
      processed_by = null,
      rejection_reason = null,
      last_error_code = null,
      approval_student_action = null,
      approval_enrollment_action = null,
      approval_idempotency_key = coalesce(
        l.approval_idempotency_key,
        v_idempotency_key
      )
    where l.id = v_lead.id
      and l.tenant_id = p_tenant_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'public_site_leads_tenant_approval_key_uidx' then
        raise exception 'This approval request key has already been used.'
          using
            errcode = '23505',
            constraint = v_constraint_name;
      end if;

      raise;
  end;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'public_program_request_approval_started',
    'public_site_lead',
    v_lead.id,
    'Enrollment request',
    'Started enrollment request approval.',
    'info',
    jsonb_build_object('courseId', v_course.id)
  );

  if p_existing_student_id is not null then
    select s.*
    into v_student
    from public.students as s
    where s.id = p_existing_student_id
      and s.tenant_id = p_tenant_id
    for share;

    if not found then
      raise exception 'Selected student was not found in this workspace.'
        using errcode = '22023';
    end if;

    if v_student.status <> 'active' then
      raise exception 'Selected student must be active before enrollment.'
        using errcode = '22023';
    end if;

    v_student_action := 'selected';
  else
    v_student_email := lower(
      nullif(
        btrim(
          public.m69_1_normalize_text(
            coalesce(nullif(btrim(p_student_email), ''), v_lead.email),
            'Student email',
            false,
            254
          )
        ),
        ''
      )
    );
    v_student_phone := public.m69_1_normalize_text(
      coalesce(nullif(btrim(p_student_phone), ''), v_lead.phone),
      'Student phone',
      false,
      40
    );
    v_student_name := public.m69_1_normalize_text(
      coalesce(nullif(btrim(p_student_name), ''), v_lead.name),
      'Student name',
      true,
      160
    );

    if v_student_email is null and v_student_phone is null then
      raise exception 'Student email or phone is required.' using errcode = '22023';
    end if;

    if v_student_name ~ '[<>]' then
      raise exception 'Student name contains unsupported characters.'
        using errcode = '22023';
    end if;

    if v_student_email is not null
       and v_student_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Student email is invalid.' using errcode = '22023';
    end if;

    if v_student_phone is not null
       and v_student_phone !~ '^[+0-9() -]{7,40}$' then
      raise exception 'Student phone is invalid.' using errcode = '22023';
    end if;

    -- Serialize v2 resolution for the same tenant/contact identity. The email
    -- unique index remains the final database duplicate boundary.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_tenant_id::text
          || ':student-identity:'
          || coalesce(v_student_email, v_student_phone),
        0
      )
    );

    if v_student_email is not null then
      select s.*
      into v_student
      from public.students as s
      where s.tenant_id = p_tenant_id
        and lower(btrim(s.email)) = v_student_email
      limit 1
      for share;
    else
      select count(*)::integer
      into v_phone_match_count
      from public.students as s
      where s.tenant_id = p_tenant_id
        and nullif(btrim(s.phone), '') = v_student_phone;

      if v_phone_match_count > 1 then
        update public.public_site_leads as l
        set
          enrollment_request_status = 'needs_attention',
          processing_started_at = null,
          processed_at = now(),
          processed_by = v_actor,
          last_error_code = 'ambiguous_student_phone',
          approval_student_action = null,
          approval_enrollment_action = null
        where l.id = v_lead.id
          and l.tenant_id = p_tenant_id;

        perform public.m69_1_write_audit(
          p_tenant_id,
          'public_program_request_needs_attention',
          'public_site_lead',
          v_lead.id,
          'Enrollment request',
          'Enrollment request needs attention because the student match is ambiguous.',
          'warning',
          jsonb_build_object('errorCode', 'ambiguous_student_phone')
        );

        return jsonb_build_object(
          'request_id', v_lead.id,
          'enrollment_request_status', 'needs_attention',
          'error_code', 'ambiguous_student_phone',
          'message', 'More than one student matches this phone number. Select a student and try again.',
          'portal_access_status', 'not_started',
          'replayed', false
        );
      end if;

      if v_phone_match_count = 1 then
        select s.*
        into v_student
        from public.students as s
        where s.tenant_id = p_tenant_id
          and nullif(btrim(s.phone), '') = v_student_phone
        limit 1
        for share;
      end if;
    end if;

    if v_student.id is not null then
      if v_student.status <> 'active' then
        update public.public_site_leads as l
        set
          enrollment_request_status = 'needs_attention',
          processing_started_at = null,
          processed_at = now(),
          processed_by = v_actor,
          last_error_code = 'matched_student_not_active',
          approval_student_action = null,
          approval_enrollment_action = null
        where l.id = v_lead.id
          and l.tenant_id = p_tenant_id;

        perform public.m69_1_write_audit(
          p_tenant_id,
          'public_program_request_needs_attention',
          'public_site_lead',
          v_lead.id,
          'Enrollment request',
          'Enrollment request needs attention because the matched student is not active.',
          'warning',
          jsonb_build_object(
            'studentId', v_student.id,
            'errorCode', 'matched_student_not_active'
          )
        );

        return jsonb_build_object(
          'request_id', v_lead.id,
          'enrollment_request_status', 'needs_attention',
          'error_code', 'matched_student_not_active',
          'message', 'A matching student exists but is not active. Review the student before continuing.',
          'portal_access_status', 'not_started',
          'replayed', false
        );
      end if;

      v_student_action := 'matched';
    else
      begin
        select created.*
        into v_student
        from public.create_student_secure(
          p_tenant_id => p_tenant_id,
          p_full_name => v_student_name,
          p_email => v_student_email,
          p_phone => v_student_phone,
          p_source => 'public_program_request',
          p_status => 'active',
          p_notes => null
        ) as created;
        v_student_action := 'created';
      exception
        when unique_violation then
          get stacked diagnostics v_constraint_name = constraint_name;

          if v_constraint_name is distinct from 'students_tenant_normalized_email_uidx' then
            raise;
          end if;

          if v_student_email is null then
            raise;
          end if;

          select s.*
          into v_student
          from public.students as s
          where s.tenant_id = p_tenant_id
            and lower(btrim(s.email)) = v_student_email
          limit 1
          for share;

          if not found or v_student.status <> 'active' then
            raise exception
              'A matching student exists but cannot be enrolled automatically.'
              using errcode = '23505';
          end if;

          v_student_action := 'matched';
      end;
    end if;
  end if;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'public_program_request_student_resolved',
    'public_site_lead',
    v_lead.id,
    'Enrollment request',
    'Resolved the student for an enrollment request.',
    'info',
    jsonb_build_object(
      'studentId', v_student.id,
      'studentAction', v_student_action
    )
  );

  select e.*
  into v_enrollment
  from public.enrollments as e
  where e.tenant_id = p_tenant_id
    and e.student_id = v_student.id
    and e.course_id = v_course.id
  for update;

  if found then
    if v_enrollment.status in ('active', 'completed') then
      v_enrollment_action := 'reused';
    else
      update public.public_site_leads as l
      set
        enrollment_request_status = 'needs_attention',
        processing_started_at = null,
        processed_at = now(),
        processed_by = v_actor,
        last_error_code = 'enrollment_requires_review',
        approval_student_action = v_student_action,
        approval_enrollment_action = null
      where l.id = v_lead.id
        and l.tenant_id = p_tenant_id;

      perform public.m69_1_write_audit(
        p_tenant_id,
        'public_program_request_needs_attention',
        'public_site_lead',
        v_lead.id,
        'Enrollment request',
        'Enrollment request needs attention because an existing enrollment requires review.',
        'warning',
        jsonb_build_object(
          'studentId', v_student.id,
          'enrollmentId', v_enrollment.id,
          'enrollmentStatus', v_enrollment.status,
          'errorCode', 'enrollment_requires_review'
        )
      );

      return jsonb_build_object(
        'request_id', v_lead.id,
        'enrollment_request_status', 'needs_attention',
        'student', jsonb_build_object(
          'id', v_student.id,
          'status', v_student.status
        ),
        'student_action', v_student_action,
        'enrollment', jsonb_build_object(
          'id', v_enrollment.id,
          'status', v_enrollment.status
        ),
        'error_code', 'enrollment_requires_review',
        'message', 'The existing enrollment is paused or cancelled. Review it before continuing.',
        'portal_access_status', 'not_started',
        'replayed', false
      );
    end if;
  else
    select created.*
    into v_enrollment
    from public.create_enrollment_secure(
      p_tenant_id,
      v_student.id,
      v_course.id,
      'active'
    ) as created;
    v_enrollment_action := 'created';
  end if;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'public_program_request_enrollment_resolved',
    'public_site_lead',
    v_lead.id,
    'Enrollment request',
    'Resolved the program enrollment for an enrollment request.',
    'info',
    jsonb_build_object(
      'studentId', v_student.id,
      'enrollmentId', v_enrollment.id,
      'enrollmentAction', v_enrollment_action,
      'enrollmentStatus', v_enrollment.status
    )
  );

  update public.public_site_leads as l
  set
    enrollment_request_status = 'enrolled',
    status = 'converted',
    converted_student_id = v_student.id,
    converted_enrollment_id = v_enrollment.id,
    converted_at = now(),
    converted_by = v_actor,
    conversion_note = v_note,
    processed_at = now(),
    processed_by = v_actor,
    processing_started_at = null,
    rejection_reason = null,
    last_error_code = null,
    approval_student_action = v_student_action,
    approval_enrollment_action = v_enrollment_action,
    approval_idempotency_key = coalesce(
      l.approval_idempotency_key,
      v_idempotency_key
    )
  where l.id = v_lead.id
    and l.tenant_id = p_tenant_id;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'public_program_request_enrolled',
    'public_site_lead',
    v_lead.id,
    'Enrollment request',
    'Approved the enrollment request and completed enrollment.',
    'info',
    jsonb_build_object(
      'courseId', v_course.id,
      'studentId', v_student.id,
      'studentAction', v_student_action,
      'enrollmentId', v_enrollment.id,
      'enrollmentAction', v_enrollment_action,
      'enrollmentStatus', v_enrollment.status
    )
  );

  return jsonb_build_object(
    'request_id', v_lead.id,
    'enrollment_request_status', 'enrolled',
    'student', jsonb_build_object(
      'id', v_student.id,
      'status', v_student.status
    ),
    'student_action', v_student_action,
    'enrollment', jsonb_build_object(
      'id', v_enrollment.id,
      'status', v_enrollment.status
    ),
    'enrollment_action', v_enrollment_action,
    'portal_access_status', 'not_started',
    'replayed', false
  );
end;
$$;

revoke execute on function public.approve_public_program_enrollment_request_v2(
  uuid, uuid, uuid, text, text, text, text, text
) from public, anon, service_role;
grant execute on function public.approve_public_program_enrollment_request_v2(
  uuid, uuid, uuid, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Secure rejection RPC v2
-- ---------------------------------------------------------------------------

create or replace function public.reject_public_program_enrollment_request_v2(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.public_site_leads%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    v_actor,
    array['owner', 'admin']
  ) then
    raise exception
      'Only workspace owners and admins can reject enrollment requests.'
      using errcode = '42501';
  end if;

  if v_reason is not null
     and (char_length(v_reason) > 1000 or v_reason ~ '[<>]') then
    raise exception 'Rejection reason must be plain text under 1000 characters.'
      using errcode = '22023';
  end if;

  select l.*
  into v_lead
  from public.public_site_leads as l
  where l.id = p_lead_id
    and l.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Enrollment request not found.' using errcode = '22023';
  end if;

  if v_lead.enrollment_request_status = 'rejected' then
    return jsonb_build_object(
      'request_id', v_lead.id,
      'enrollment_request_status', 'rejected',
      'replayed', true
    );
  end if;

  if v_lead.enrollment_request_status = 'enrolled'
     or v_lead.status = 'converted'
     or v_lead.converted_student_id is not null
     or v_lead.converted_enrollment_id is not null then
    raise exception 'Enrolled requests cannot be rejected.' using errcode = '22023';
  end if;

  update public.public_site_leads as l
  set
    enrollment_request_status = 'rejected',
    status = 'closed',
    processing_started_at = null,
    processed_at = now(),
    processed_by = v_actor,
    rejection_reason = v_reason,
    last_error_code = null,
    approval_student_action = null,
    approval_enrollment_action = null
  where l.id = v_lead.id
    and l.tenant_id = p_tenant_id;

  perform public.m69_1_write_audit(
    p_tenant_id,
    'public_program_request_rejected',
    'public_site_lead',
    v_lead.id,
    'Enrollment request',
    'Rejected the enrollment request.',
    'info',
    jsonb_build_object('requestStatus', 'rejected')
  );

  return jsonb_build_object(
    'request_id', v_lead.id,
    'enrollment_request_status', 'rejected',
    'replayed', false
  );
end;
$$;

revoke execute on function public.reject_public_program_enrollment_request_v2(
  uuid, uuid, text
) from public, anon, service_role;
grant execute on function public.reject_public_program_enrollment_request_v2(
  uuid, uuid, text
) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 6. Read-only verification queries
-- Run after applying the reviewed migration. These queries do not invoke a
-- business RPC and do not return request contacts or student identities.
-- ---------------------------------------------------------------------------

-- Dangerous privileges are false while required read/server privileges remain.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('public_site_leads', 'student_portal_accounts')
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
order by table_name, grantee, privilege_type;

-- The preceding query must return zero rows.
select
  has_table_privilege('anon', 'public.public_site_leads', 'TRUNCATE')
    as anon_leads_truncate,
  has_table_privilege('authenticated', 'public.public_site_leads', 'TRUNCATE')
    as authenticated_leads_truncate,
  has_table_privilege('authenticated', 'public.public_site_leads', 'SELECT')
    as authenticated_leads_select,
  has_table_privilege('anon', 'public.student_portal_accounts', 'TRUNCATE')
    as anon_portal_truncate,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'TRUNCATE')
    as authenticated_portal_truncate,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'SELECT')
    as authenticated_portal_select,
  has_table_privilege('service_role', 'public.student_portal_accounts', 'SELECT')
    as service_role_portal_select,
  has_table_privilege('service_role', 'public.student_portal_accounts', 'INSERT')
    as service_role_portal_insert,
  has_table_privilege('service_role', 'public.student_portal_accounts', 'UPDATE')
    as service_role_portal_update;

-- Student identity index and aggregate-only duplicate state.
select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and tablename = 'students'
  and indexname = 'students_tenant_normalized_email_uidx';

with duplicate_groups as (
  select count(*)::bigint as rows_in_group
  from public.students
  where nullif(btrim(email), '') is not null
  group by tenant_id, lower(btrim(email))
  having count(*) > 1
)
select
  count(*)::bigint as duplicate_groups,
  coalesce(sum(rows_in_group), 0)::bigint as rows_in_duplicate_groups
from duplicate_groups;

-- Lifecycle columns, constraints, and aggregate status preservation.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'public_site_leads'
  and column_name in (
    'enrollment_request_status',
    'processing_started_at',
    'processed_at',
    'processed_by',
    'rejection_reason',
    'last_error_code',
    'approval_idempotency_key',
    'approval_student_action',
    'approval_enrollment_action'
  )
order by ordinal_position;

select conname, pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint
where conrelid = 'public.public_site_leads'::regclass
  and conname like 'public_site_leads_%'
order by conname;

select
  status as legacy_status,
  enrollment_request_status,
  count(*)::bigint as request_count
from public.public_site_leads
group by status, enrollment_request_status
order by status, enrollment_request_status;

-- All integrity-violation counts must be zero after migration.
select
  count(*) filter (
    where enrollment_request_status = 'processing'
      and processing_started_at is null
  )::bigint as processing_missing_started_at,
  count(*) filter (
    where enrollment_request_status = 'enrolled'
      and (
        converted_student_id is null
        or converted_enrollment_id is null
        or processed_at is null
      )
  )::bigint as enrolled_missing_links_or_processed_at,
  count(*) filter (
    where enrollment_request_status = 'needs_attention'
      and (processed_at is null or processed_by is null)
  )::bigint as needs_attention_missing_processing_metadata,
  count(*) filter (
    where enrollment_request_status = 'rejected'
      and processed_at is null
  )::bigint as rejected_missing_processed_at
from public.public_site_leads;

-- v2 and legacy function identity, security configuration, and execute access.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_arguments(p.oid) as declared_arguments,
  pg_get_function_result(p.oid) as return_type,
  l.lanname as language,
  case p.provolatile
    when 'i' then 'immutable'
    when 's' then 'stable'
    when 'v' then 'volatile'
    else p.provolatile::text
  end as volatility,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.proconfig as function_configuration,
  exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) as acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')
    as service_role_can_execute
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
join pg_catalog.pg_language as l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname in (
    'approve_public_program_enrollment_request',
    'approve_public_program_enrollment_request_v2',
    'reject_public_program_enrollment_request_v2'
  )
order by p.proname, identity_arguments;

-- Browser roles retain no portal-account direct mutation privilege.
select
  has_table_privilege('anon', 'public.student_portal_accounts', 'INSERT')
    as anon_insert,
  has_table_privilege('anon', 'public.student_portal_accounts', 'UPDATE')
    as anon_update,
  has_table_privilege('anon', 'public.student_portal_accounts', 'DELETE')
    as anon_delete,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'INSERT')
    as authenticated_insert,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'UPDATE')
    as authenticated_update,
  has_table_privilege('authenticated', 'public.student_portal_accounts', 'DELETE')
    as authenticated_delete;

-- ---------------------------------------------------------------------------
-- 7. Rollback notes (guidance only; review separately before any rollback)
-- ---------------------------------------------------------------------------
-- 1. Keep the privilege revocations. Do not restore direct browser writes or
--    TRUNCATE/TRIGGER/REFERENCES/MAINTAIN privileges.
-- 2. Revoke v2 EXECUTE and remove the v2 functions only after all callers have
--    been moved back to a reviewed path. Do not restore payment coupling.
-- 3. Keep the normalized email unique index unless a reviewed reconciliation
--    proves it must change; removing it reopens duplicate-student races.
-- 4. Do not drop lifecycle columns that contain data without an explicit,
--    verified backup and a reviewed compatibility plan.
-- 5. Restoring prior create/update student definitions would remove normalized
--    email protection at the RPC boundary and is not a safe default rollback.
