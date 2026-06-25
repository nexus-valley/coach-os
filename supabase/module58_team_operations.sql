-- Module 58: Institute HR / Team Operations
-- Review before execution. Do not run until approved.
--
-- This module adds operational HR/team profile data on top of tenant_members.
-- tenant_members remains the source of truth for system access roles.
-- No salary, bank, government ID, health, address, document, or payroll data is stored.

create table if not exists public.team_member_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  staff_code text,
  display_name text,
  designation text,
  department text,
  employment_type text check (
    employment_type is null
    or employment_type in ('full_time', 'part_time', 'contract', 'visiting', 'intern', 'consultant')
  ),
  employment_status text not null default 'active' check (
    employment_status in ('active', 'onboarding', 'on_leave', 'suspended', 'exited')
  ),
  work_location text check (
    work_location is null
    or work_location in ('onsite', 'remote', 'hybrid')
  ),
  joining_date date,
  exit_date date,
  notes text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  check (staff_code is null or char_length(staff_code) <= 60),
  check (display_name is null or char_length(display_name) <= 180),
  check (designation is null or char_length(designation) <= 160),
  check (department is null or char_length(department) <= 120),
  check (notes is null or char_length(notes) <= 3000),
  check (joining_date is null or exit_date is null or joining_date <= exit_date),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 3000)
);

create table if not exists public.team_member_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  note text not null,
  note_type text not null default 'general' check (
    note_type in ('general', 'performance', 'onboarding', 'follow_up', 'exit', 'risk')
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (char_length(note) between 1 and 3000)
);

create table if not exists public.team_member_activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(action) between 1 and 120),
  check (jsonb_typeof(metadata_json) = 'object'),
  check (char_length(metadata_json::text) <= 3000)
);

create index if not exists team_member_profiles_tenant_status_idx
on public.team_member_profiles (tenant_id, employment_status, updated_at desc);

create index if not exists team_member_profiles_user_idx
on public.team_member_profiles (tenant_id, user_id);

create index if not exists team_member_notes_member_idx
on public.team_member_notes (tenant_id, user_id, created_at desc);

create index if not exists team_member_activity_member_idx
on public.team_member_activity_logs (tenant_id, user_id, created_at desc);

drop trigger if exists set_team_member_profiles_updated_at on public.team_member_profiles;
create trigger set_team_member_profiles_updated_at
before update on public.team_member_profiles
for each row execute function public.set_updated_at();

alter table public.team_member_profiles enable row level security;
alter table public.team_member_notes enable row level security;
alter table public.team_member_activity_logs enable row level security;

revoke all on public.team_member_profiles from anon;
revoke all on public.team_member_notes from anon;
revoke all on public.team_member_activity_logs from anon;

revoke insert, update, delete on public.team_member_profiles from authenticated;
revoke insert, update, delete on public.team_member_notes from authenticated;
revoke insert, update, delete on public.team_member_activity_logs from authenticated;

grant select on public.team_member_profiles to authenticated;
grant select on public.team_member_notes to authenticated;
grant select on public.team_member_activity_logs to authenticated;

create or replace function public.team_ops_current_role(check_tenant_id uuid)
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

create or replace function public.team_ops_is_owner_admin(check_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  member_role text;
begin
  if auth.uid() is null then
    return false;
  end if;

  member_role := public.team_ops_current_role(check_tenant_id);
  return coalesce(member_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.team_ops_validate_text(
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

create or replace function public.team_ops_validate_metadata(check_metadata jsonb)
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

create or replace function public.team_ops_member_exists(
  check_tenant_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = check_tenant_id
      and tm.user_id = check_user_id
      and tm.role in ('owner', 'admin', 'staff', 'trainer')
  );
$$;

create or replace function public.team_ops_write_activity(
  p_tenant_id uuid,
  p_user_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_metadata_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_metadata jsonb := public.team_ops_validate_metadata(p_metadata_json);
begin
  insert into public.team_member_activity_logs (
    tenant_id,
    user_id,
    action,
    actor_user_id,
    metadata_json
  )
  values (
    p_tenant_id,
    p_user_id,
    p_action,
    p_actor_user_id,
    safe_metadata
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
    p_actor_user_id,
    'team_operations_' || p_action,
    'team_member_profile',
    p_user_id,
    'Team member operations',
    'Team operations event recorded.',
    case when p_action in ('status_changed', 'exited') then 'warning' else 'info' end,
    safe_metadata || jsonb_build_object(
      'target_user_id', p_user_id,
      'note_present', coalesce((safe_metadata ->> 'note_present')::boolean, false)
    )
  );
end;
$$;

drop policy if exists "Owner admin can read team member profiles" on public.team_member_profiles;
create policy "Owner admin can read team member profiles"
on public.team_member_profiles
for select
to authenticated
using (public.team_ops_is_owner_admin(tenant_id));

drop policy if exists "Owner admin can read team member notes" on public.team_member_notes;
create policy "Owner admin can read team member notes"
on public.team_member_notes
for select
to authenticated
using (public.team_ops_is_owner_admin(tenant_id));

drop policy if exists "Owner admin can read team member activity logs" on public.team_member_activity_logs;
create policy "Owner admin can read team member activity logs"
on public.team_member_activity_logs
for select
to authenticated
using (public.team_ops_is_owner_admin(tenant_id));

create or replace function public.get_team_operations_dashboard(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  member_count integer;
  active_count integer;
  onboarding_count integer;
  on_leave_count integer;
  exited_count integer;
  trainer_count integer;
  staff_admin_count integer;
  members_json jsonb;
begin
  if not public.team_ops_is_owner_admin(p_tenant_id) then
    raise exception 'Only owner/admin users can access team operations.' using errcode = '42501';
  end if;

  with member_rows as (
    select
      tm.tenant_id,
      tm.user_id,
      tm.role,
      tm.created_at as member_created_at,
      p.full_name,
      p.email,
      tmp.id as profile_id,
      tmp.staff_code,
      tmp.display_name,
      tmp.designation,
      tmp.department,
      tmp.employment_type,
      coalesce(tmp.employment_status, 'active') as employment_status,
      tmp.work_location,
      tmp.joining_date,
      tmp.exit_date,
      tmp.updated_at as profile_updated_at,
      (
        select count(*)
        from public.trainer_course_assignments tca
        where tca.tenant_id = tm.tenant_id
          and tca.trainer_user_id = tm.user_id
      ) as assigned_courses_count,
      (
        select count(*)
        from public.trainer_cohort_assignments tcoa
        where tcoa.tenant_id = tm.tenant_id
          and tcoa.trainer_user_id = tm.user_id
      ) as assigned_cohorts_count,
      (
        select count(*)
        from public.sessions s
        where s.tenant_id = tm.tenant_id
          and s.trainer_user_id = tm.user_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
      ) as upcoming_sessions_count,
      (
        select count(distinct scoped_students.student_id)
        from (
          select e.student_id
          from public.enrollments e
          join public.trainer_course_assignments tca
            on tca.tenant_id = e.tenant_id
           and tca.course_id = e.course_id
          where e.tenant_id = tm.tenant_id
            and tca.trainer_user_id = tm.user_id
            and e.status in ('active', 'completed')
          union
          select cm.student_id
          from public.cohort_members cm
          join public.trainer_cohort_assignments tcoa
            on tcoa.tenant_id = cm.tenant_id
           and tcoa.cohort_id = cm.cohort_id
          where cm.tenant_id = tm.tenant_id
            and tcoa.trainer_user_id = tm.user_id
        ) scoped_students
      ) as active_students_count
    from public.tenant_members tm
    left join public.profiles p
      on p.id = tm.user_id
    left join public.team_member_profiles tmp
      on tmp.tenant_id = tm.tenant_id
     and tmp.user_id = tm.user_id
    where tm.tenant_id = p_tenant_id
      and tm.role in ('owner', 'admin', 'staff', 'trainer')
  )
  select
    count(*),
    count(*) filter (where employment_status = 'active'),
    count(*) filter (where employment_status = 'onboarding'),
    count(*) filter (where employment_status = 'on_leave'),
    count(*) filter (where employment_status = 'exited'),
    count(*) filter (where role = 'trainer'),
    count(*) filter (where role in ('owner', 'admin', 'staff')),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'tenant_id', tenant_id,
          'user_id', user_id,
          'role', role,
          'member_created_at', member_created_at,
          'full_name', full_name,
          'email', email,
          'profile_id', profile_id,
          'staff_code', staff_code,
          'display_name', display_name,
          'designation', designation,
          'department', department,
          'employment_type', employment_type,
          'employment_status', employment_status,
          'work_location', work_location,
          'joining_date', joining_date,
          'exit_date', exit_date,
          'profile_updated_at', profile_updated_at,
          'assigned_courses_count', assigned_courses_count,
          'assigned_cohorts_count', assigned_cohorts_count,
          'upcoming_sessions_count', upcoming_sessions_count,
          'active_students_count', active_students_count
        )
        order by coalesce(display_name, full_name, email), role
      ),
      '[]'::jsonb
    )
  into
    member_count,
    active_count,
    onboarding_count,
    on_leave_count,
    exited_count,
    trainer_count,
    staff_admin_count,
    members_json
  from member_rows;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'total_members', coalesce(member_count, 0),
      'active_members', coalesce(active_count, 0),
      'onboarding_members', coalesce(onboarding_count, 0),
      'on_leave_members', coalesce(on_leave_count, 0),
      'exited_members', coalesce(exited_count, 0),
      'trainer_count', coalesce(trainer_count, 0),
      'staff_admin_count', coalesce(staff_admin_count, 0)
    ),
    'members', members_json
  );
end;
$$;

create or replace function public.get_team_member_operations_detail(
  p_tenant_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  detail_json jsonb;
begin
  if not public.team_ops_is_owner_admin(p_tenant_id) then
    raise exception 'Only owner/admin users can access team operations.' using errcode = '42501';
  end if;

  if not public.team_ops_member_exists(p_tenant_id, p_user_id) then
    raise exception 'Team member was not found in this tenant.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'member', jsonb_build_object(
      'tenant_id', tm.tenant_id,
      'user_id', tm.user_id,
      'role', tm.role,
      'member_created_at', tm.created_at,
      'full_name', p.full_name,
      'email', p.email
    ),
    'profile', jsonb_build_object(
      'id', tmp.id,
      'staff_code', tmp.staff_code,
      'display_name', tmp.display_name,
      'designation', tmp.designation,
      'department', tmp.department,
      'employment_type', tmp.employment_type,
      'employment_status', coalesce(tmp.employment_status, 'active'),
      'work_location', tmp.work_location,
      'joining_date', tmp.joining_date,
      'exit_date', tmp.exit_date,
      'notes', tmp.notes,
      'metadata_json', coalesce(tmp.metadata_json, '{}'::jsonb),
      'created_at', tmp.created_at,
      'updated_at', tmp.updated_at
    ),
    'courses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'status', c.status
        )
        order by c.title
      )
      from public.trainer_course_assignments tca
      join public.courses c
        on c.id = tca.course_id
       and c.tenant_id = tca.tenant_id
      where tca.tenant_id = p_tenant_id
        and tca.trainer_user_id = p_user_id
    ), '[]'::jsonb),
    'cohorts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', co.id,
          'name', co.name,
          'course_id', co.course_id
        )
        order by co.name
      )
      from public.trainer_cohort_assignments tcoa
      join public.cohorts co
        on co.id = tcoa.cohort_id
       and co.tenant_id = tcoa.tenant_id
      where tcoa.tenant_id = p_tenant_id
        and tcoa.trainer_user_id = p_user_id
    ), '[]'::jsonb),
    'workload', jsonb_build_object(
      'assigned_courses_count', (
        select count(*)
        from public.trainer_course_assignments tca
        where tca.tenant_id = p_tenant_id
          and tca.trainer_user_id = p_user_id
      ),
      'assigned_cohorts_count', (
        select count(*)
        from public.trainer_cohort_assignments tcoa
        where tcoa.tenant_id = p_tenant_id
          and tcoa.trainer_user_id = p_user_id
      ),
      'upcoming_sessions_count', (
        select count(*)
        from public.sessions s
        where s.tenant_id = p_tenant_id
          and s.trainer_user_id = p_user_id
          and s.status = 'scheduled'
          and s.scheduled_start_at >= now()
      ),
      'active_students_count', (
        select count(distinct scoped_students.student_id)
        from (
          select e.student_id
          from public.enrollments e
          join public.trainer_course_assignments tca
            on tca.tenant_id = e.tenant_id
           and tca.course_id = e.course_id
          where e.tenant_id = p_tenant_id
            and tca.trainer_user_id = p_user_id
            and e.status in ('active', 'completed')
          union
          select cm.student_id
          from public.cohort_members cm
          join public.trainer_cohort_assignments tcoa
            on tcoa.tenant_id = cm.tenant_id
           and tcoa.cohort_id = cm.cohort_id
          where cm.tenant_id = p_tenant_id
            and tcoa.trainer_user_id = p_user_id
        ) scoped_students
      )
    ),
    'notes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'note', n.note,
          'note_type', n.note_type,
          'created_by', n.created_by,
          'created_at', n.created_at
        )
        order by n.created_at desc
      )
      from public.team_member_notes n
      where n.tenant_id = p_tenant_id
        and n.user_id = p_user_id
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', al.id,
          'action', al.action,
          'actor_user_id', al.actor_user_id,
          'metadata_json', al.metadata_json,
          'created_at', al.created_at
        )
        order by al.created_at desc
      )
      from public.team_member_activity_logs al
      where al.tenant_id = p_tenant_id
        and al.user_id = p_user_id
      limit 50
    ), '[]'::jsonb)
  )
  into detail_json
  from public.tenant_members tm
  left join public.profiles p
    on p.id = tm.user_id
  left join public.team_member_profiles tmp
    on tmp.tenant_id = tm.tenant_id
   and tmp.user_id = tm.user_id
  where tm.tenant_id = p_tenant_id
    and tm.user_id = p_user_id
    and tm.role in ('owner', 'admin', 'staff', 'trainer');

  return detail_json;
end;
$$;

create or replace function public.upsert_team_member_profile(
  p_tenant_id uuid,
  p_user_id uuid,
  p_staff_code text default null,
  p_display_name text default null,
  p_designation text default null,
  p_department text default null,
  p_employment_type text default null,
  p_employment_status text default 'active',
  p_work_location text default null,
  p_joining_date date default null,
  p_exit_date date default null,
  p_notes text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_staff_code text;
  normalized_display_name text;
  normalized_designation text;
  normalized_department text;
  normalized_employment_type text;
  normalized_employment_status text;
  normalized_work_location text;
  normalized_notes text;
  normalized_metadata jsonb;
  existing_profile public.team_member_profiles%rowtype;
  profile_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.team_ops_is_owner_admin(p_tenant_id) then
    raise exception 'Only owner/admin users can update team operations profiles.' using errcode = '42501';
  end if;

  if not public.team_ops_member_exists(p_tenant_id, p_user_id) then
    raise exception 'Team member was not found in this tenant.' using errcode = '22023';
  end if;

  normalized_staff_code := public.team_ops_validate_text(p_staff_code, 'Staff code', false, 60);
  normalized_display_name := public.team_ops_validate_text(p_display_name, 'Display name', false, 180);
  normalized_designation := public.team_ops_validate_text(p_designation, 'Designation', false, 160);
  normalized_department := public.team_ops_validate_text(p_department, 'Department', false, 120);
  normalized_notes := public.team_ops_validate_text(p_notes, 'Notes', false, 3000);
  normalized_employment_type := nullif(trim(coalesce(p_employment_type, '')), '');
  normalized_employment_status := coalesce(nullif(trim(coalesce(p_employment_status, '')), ''), 'active');
  normalized_work_location := nullif(trim(coalesce(p_work_location, '')), '');
  normalized_metadata := public.team_ops_validate_metadata(p_metadata_json);

  if normalized_employment_type is not null and normalized_employment_type not in ('full_time', 'part_time', 'contract', 'visiting', 'intern', 'consultant') then
    raise exception 'Invalid employment type.' using errcode = '22023';
  end if;

  if normalized_employment_status not in ('active', 'onboarding', 'on_leave', 'suspended', 'exited') then
    raise exception 'Invalid employment status.' using errcode = '22023';
  end if;

  if normalized_work_location is not null and normalized_work_location not in ('onsite', 'remote', 'hybrid') then
    raise exception 'Invalid work location.' using errcode = '22023';
  end if;

  if p_joining_date is not null and p_exit_date is not null and p_joining_date > p_exit_date then
    raise exception 'Joining date cannot be after exit date.' using errcode = '22023';
  end if;

  select *
  into existing_profile
  from public.team_member_profiles
  where tenant_id = p_tenant_id
    and user_id = p_user_id;

  insert into public.team_member_profiles (
    tenant_id,
    user_id,
    staff_code,
    display_name,
    designation,
    department,
    employment_type,
    employment_status,
    work_location,
    joining_date,
    exit_date,
    notes,
    metadata_json,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    p_user_id,
    normalized_staff_code,
    normalized_display_name,
    normalized_designation,
    normalized_department,
    normalized_employment_type,
    normalized_employment_status,
    normalized_work_location,
    p_joining_date,
    p_exit_date,
    normalized_notes,
    normalized_metadata,
    actor_id,
    actor_id
  )
  on conflict (tenant_id, user_id)
  do update set
    staff_code = excluded.staff_code,
    display_name = excluded.display_name,
    designation = excluded.designation,
    department = excluded.department,
    employment_type = excluded.employment_type,
    employment_status = excluded.employment_status,
    work_location = excluded.work_location,
    joining_date = excluded.joining_date,
    exit_date = excluded.exit_date,
    notes = excluded.notes,
    metadata_json = excluded.metadata_json,
    updated_by = actor_id,
    updated_at = now()
  returning id into profile_id;

  perform public.team_ops_write_activity(
    p_tenant_id,
    p_user_id,
    actor_id,
    case when existing_profile.id is null then 'profile_created' else 'profile_updated' end,
    jsonb_build_object(
      'profile_id', profile_id,
      'employment_status', normalized_employment_status,
      'employment_type', normalized_employment_type,
      'work_location', normalized_work_location,
      'notes_present', normalized_notes is not null,
      'changed_field_count', 11
    )
  );

  if existing_profile.id is not null and existing_profile.employment_status is distinct from normalized_employment_status then
    perform public.team_ops_write_activity(
      p_tenant_id,
      p_user_id,
      actor_id,
      case when normalized_employment_status = 'exited' then 'exited' else 'status_changed' end,
      jsonb_build_object(
        'profile_id', profile_id,
        'old_status', existing_profile.employment_status,
        'new_status', normalized_employment_status,
        'exit_date_present', p_exit_date is not null
      )
    );
  end if;

  return profile_id;
end;
$$;

create or replace function public.update_team_member_status(
  p_tenant_id uuid,
  p_user_id uuid,
  p_employment_status text,
  p_exit_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_status text := nullif(trim(coalesce(p_employment_status, '')), '');
  existing_profile public.team_member_profiles%rowtype;
  profile_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.team_ops_is_owner_admin(p_tenant_id) then
    raise exception 'Only owner/admin users can update team member status.' using errcode = '42501';
  end if;

  if not public.team_ops_member_exists(p_tenant_id, p_user_id) then
    raise exception 'Team member was not found in this tenant.' using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'onboarding', 'on_leave', 'suspended', 'exited') then
    raise exception 'Invalid employment status.' using errcode = '22023';
  end if;

  select *
  into existing_profile
  from public.team_member_profiles
  where tenant_id = p_tenant_id
    and user_id = p_user_id;

  if existing_profile.id is null then
    insert into public.team_member_profiles (
      tenant_id,
      user_id,
      employment_status,
      exit_date,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_user_id,
      normalized_status,
      case when normalized_status = 'exited' then p_exit_date else null end,
      actor_id,
      actor_id
    )
    returning id into profile_id;
  else
    update public.team_member_profiles
    set employment_status = normalized_status,
        exit_date = case when normalized_status = 'exited' then p_exit_date else null end,
        updated_by = actor_id,
        updated_at = now()
    where id = existing_profile.id
    returning id into profile_id;
  end if;

  perform public.team_ops_write_activity(
    p_tenant_id,
    p_user_id,
    actor_id,
    case when normalized_status = 'exited' then 'exited' else 'status_changed' end,
    jsonb_build_object(
      'profile_id', profile_id,
      'old_status', existing_profile.employment_status,
      'new_status', normalized_status,
      'exit_date_present', p_exit_date is not null
    )
  );

  return profile_id;
end;
$$;

create or replace function public.add_team_member_note(
  p_tenant_id uuid,
  p_user_id uuid,
  p_note text,
  p_note_type text default 'general'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_note text;
  normalized_note_type text := coalesce(nullif(trim(coalesce(p_note_type, '')), ''), 'general');
  note_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.team_ops_is_owner_admin(p_tenant_id) then
    raise exception 'Only owner/admin users can add team member notes.' using errcode = '42501';
  end if;

  if not public.team_ops_member_exists(p_tenant_id, p_user_id) then
    raise exception 'Team member was not found in this tenant.' using errcode = '22023';
  end if;

  if normalized_note_type not in ('general', 'performance', 'onboarding', 'follow_up', 'exit', 'risk') then
    raise exception 'Invalid note type.' using errcode = '22023';
  end if;

  normalized_note := public.team_ops_validate_text(p_note, 'Note', true, 3000);

  insert into public.team_member_notes (
    tenant_id,
    user_id,
    note,
    note_type,
    created_by
  )
  values (
    p_tenant_id,
    p_user_id,
    normalized_note,
    normalized_note_type,
    actor_id
  )
  returning id into note_id;

  perform public.team_ops_write_activity(
    p_tenant_id,
    p_user_id,
    actor_id,
    'note_added',
    jsonb_build_object(
      'note_id', note_id,
      'note_type', normalized_note_type,
      'note_present', true
    )
  );

  return note_id;
end;
$$;

revoke all on function public.team_ops_current_role(uuid) from public;
revoke all on function public.team_ops_is_owner_admin(uuid) from public;
revoke all on function public.team_ops_validate_text(text, text, boolean, integer) from public;
revoke all on function public.team_ops_validate_metadata(jsonb) from public;
revoke all on function public.team_ops_member_exists(uuid, uuid) from public;
revoke all on function public.team_ops_write_activity(uuid, uuid, uuid, text, jsonb) from public;

revoke all on function public.get_team_operations_dashboard(uuid) from public;
revoke all on function public.get_team_member_operations_detail(uuid, uuid) from public;
revoke all on function public.upsert_team_member_profile(uuid, uuid, text, text, text, text, text, text, text, date, date, text, jsonb) from public;
revoke all on function public.update_team_member_status(uuid, uuid, text, date) from public;
revoke all on function public.add_team_member_note(uuid, uuid, text, text) from public;

grant execute on function public.team_ops_is_owner_admin(uuid) to authenticated;
grant execute on function public.get_team_operations_dashboard(uuid) to authenticated;
grant execute on function public.get_team_member_operations_detail(uuid, uuid) to authenticated;
grant execute on function public.upsert_team_member_profile(uuid, uuid, text, text, text, text, text, text, text, date, date, text, jsonb) to authenticated;
grant execute on function public.update_team_member_status(uuid, uuid, text, date) to authenticated;
grant execute on function public.add_team_member_note(uuid, uuid, text, text) to authenticated;
