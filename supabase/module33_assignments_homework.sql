-- Module 33: Assignments and homework system
-- Additive only. Run after Module 32 notification center.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'notifications'
  ) then
    alter table public.notifications
    drop constraint if exists notifications_type_check;

    alter table public.notifications
    add constraint notifications_type_check
    check (
      type in (
        'session_reminder',
        'attendance_alert',
        'payment_reminder',
        'invoice_notice',
        'invitation_notice',
        'system_notice',
        'subscription_notice',
        'assignment_notice'
      )
    );
  end if;
end $$;

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  cohort_id uuid references public.cohorts(id) on delete set null,
  trainer_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  instructions text,
  attachment_urls_json jsonb not null default '[]'::jsonb,
  max_score numeric(10,2),
  due_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (course_id is not null or cohort_id is not null),
  check (max_score is null or max_score >= 0)
);

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  submission_text text,
  attachment_urls_json jsonb not null default '[]'::jsonb,
  score numeric(10,2),
  feedback text,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'reviewed', 'late')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id),
  check (score is null or score >= 0)
);

create or replace function public.assignment_student_in_roster(
  check_tenant_id uuid,
  check_assignment_id uuid,
  check_student_id uuid
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.assignments a
    where a.id = check_assignment_id
      and a.tenant_id = check_tenant_id
      and (
        (
          a.cohort_id is not null
          and exists (
            select 1
            from public.cohort_members cm
            where cm.tenant_id = check_tenant_id
              and cm.cohort_id = a.cohort_id
              and cm.student_id = check_student_id
          )
        )
        or (
          a.cohort_id is null
          and a.course_id is not null
          and exists (
            select 1
            from public.enrollments e
            where e.tenant_id = check_tenant_id
              and e.course_id = a.course_id
              and e.student_id = check_student_id
          )
        )
      )
  );
$$;

create or replace function public.prevent_trainer_submission_impersonation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.has_tenant_role(new.tenant_id, auth.uid(), array['trainer'])
     and not public.has_tenant_role(new.tenant_id, auth.uid(), array['owner', 'admin']) then
    if new.tenant_id is distinct from old.tenant_id
       or new.assignment_id is distinct from old.assignment_id
       or new.student_id is distinct from old.student_id
       or new.submitted_by is distinct from old.submitted_by
       or new.submission_text is distinct from old.submission_text
       or new.attachment_urls_json is distinct from old.attachment_urls_json
       or new.submitted_at is distinct from old.submitted_at
       or new.created_at is distinct from old.created_at then
      raise exception 'Trainers can only update review fields on assignment submissions.'
        using errcode = '42501';
    end if;

    if new.reviewed_by is distinct from auth.uid() then
      raise exception 'Trainer review updates must be attributed to the signed-in trainer.'
        using errcode = '42501';
    end if;

    if new.status not in ('reviewed', 'late') then
      raise exception 'Trainers can only mark assignment submissions as reviewed or late.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create index if not exists assignments_tenant_id_idx on public.assignments (tenant_id);
create index if not exists assignments_tenant_course_idx on public.assignments (tenant_id, course_id);
create index if not exists assignments_tenant_cohort_idx on public.assignments (tenant_id, cohort_id);
create index if not exists assignments_tenant_trainer_idx on public.assignments (tenant_id, trainer_user_id);
create index if not exists assignments_tenant_due_idx on public.assignments (tenant_id, due_at);
create index if not exists assignments_tenant_status_idx on public.assignments (tenant_id, status);
create index if not exists assignments_tenant_created_idx on public.assignments (tenant_id, created_at desc);

create index if not exists assignment_submissions_tenant_id_idx on public.assignment_submissions (tenant_id);
create index if not exists assignment_submissions_assignment_idx on public.assignment_submissions (tenant_id, assignment_id);
create index if not exists assignment_submissions_student_idx on public.assignment_submissions (tenant_id, student_id);
create index if not exists assignment_submissions_status_idx on public.assignment_submissions (tenant_id, status);
create index if not exists assignment_submissions_submitted_idx on public.assignment_submissions (tenant_id, submitted_at desc);

drop trigger if exists set_assignments_updated_at on public.assignments;
create trigger set_assignments_updated_at
before update on public.assignments
for each row execute function public.set_updated_at();

drop trigger if exists set_assignment_submissions_updated_at on public.assignment_submissions;
create trigger set_assignment_submissions_updated_at
before update on public.assignment_submissions
for each row execute function public.set_updated_at();

drop trigger if exists prevent_trainer_submission_impersonation on public.assignment_submissions;
create trigger prevent_trainer_submission_impersonation
before update on public.assignment_submissions
for each row execute function public.prevent_trainer_submission_impersonation();

alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;

grant select, insert, update on public.assignments to authenticated;
grant select, insert, update on public.assignment_submissions to authenticated;
grant execute on function public.assignment_student_in_roster(uuid, uuid, uuid) to authenticated;
grant execute on function public.prevent_trainer_submission_impersonation() to authenticated;

drop policy if exists "Owner admin staff can read assignments" on public.assignments;
create policy "Owner admin staff can read assignments"
on public.assignments
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']));

drop policy if exists "Trainer can read assigned assignments" on public.assignments;
create policy "Trainer can read assigned assignments"
on public.assignments
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and (
    trainer_user_id = auth.uid()
    or exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = assignments.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = assignments.cohort_id
    )
  )
);

drop policy if exists "Owner and admin can manage assignments" on public.assignments;
create policy "Owner and admin can manage assignments"
on public.assignments
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and (course_id is null or exists (
    select 1 from public.courses c
    where c.id = assignments.course_id
      and c.tenant_id = assignments.tenant_id
  ))
  and (cohort_id is null or exists (
    select 1 from public.cohorts c
    where c.id = assignments.cohort_id
      and c.tenant_id = assignments.tenant_id
  ))
);

drop policy if exists "Trainer can insert assigned assignments" on public.assignments;
create policy "Trainer can insert assigned assignments"
on public.assignments
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and trainer_user_id = auth.uid()
  and (
    exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = assignments.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = assignments.cohort_id
    )
  )
);

drop policy if exists "Trainer can update assigned assignments" on public.assignments;
create policy "Trainer can update assigned assignments"
on public.assignments
for update
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and (
    trainer_user_id = auth.uid()
    or exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = assignments.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = assignments.cohort_id
    )
  )
)
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and (trainer_user_id is null or trainer_user_id = auth.uid())
  and (
    exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = assignments.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = assignments.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = assignments.cohort_id
    )
  )
);

drop policy if exists "Owner admin staff can read assignment submissions" on public.assignment_submissions;
create policy "Owner admin staff can read assignment submissions"
on public.assignment_submissions
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']));

drop policy if exists "Trainer can read scoped assignment submissions" on public.assignment_submissions;
create policy "Trainer can read scoped assignment submissions"
on public.assignment_submissions
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and exists (
    select 1
    from public.assignments a
    where a.id = assignment_submissions.assignment_id
      and a.tenant_id = assignment_submissions.tenant_id
      and (
        a.trainer_user_id = auth.uid()
        or exists (
          select 1
          from public.trainer_course_assignments tca
          where tca.tenant_id = a.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.course_id = a.course_id
        )
        or exists (
          select 1
          from public.trainer_cohort_assignments tca
          where tca.tenant_id = a.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.cohort_id = a.cohort_id
        )
      )
  )
);

drop policy if exists "Owner and admin can manage assignment submissions" on public.assignment_submissions;
create policy "Owner and admin can manage assignment submissions"
on public.assignment_submissions
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_submissions.assignment_id
      and a.tenant_id = assignment_submissions.tenant_id
  )
  and exists (
    select 1 from public.students s
    where s.id = assignment_submissions.student_id
      and s.tenant_id = assignment_submissions.tenant_id
  )
  and public.assignment_student_in_roster(
    tenant_id,
    assignment_id,
    student_id
  )
);

drop policy if exists "Trainer can insert scoped assignment submissions" on public.assignment_submissions;

drop policy if exists "Trainer can update scoped assignment submissions" on public.assignment_submissions;
create policy "Trainer can update scoped assignment submissions"
on public.assignment_submissions
for update
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and exists (
    select 1
    from public.assignments a
    where a.id = assignment_submissions.assignment_id
      and a.tenant_id = assignment_submissions.tenant_id
      and (
        a.trainer_user_id = auth.uid()
        or exists (
          select 1 from public.trainer_course_assignments tca
          where tca.tenant_id = a.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.course_id = a.course_id
        )
        or exists (
          select 1 from public.trainer_cohort_assignments tca
          where tca.tenant_id = a.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.cohort_id = a.cohort_id
        )
      )
  )
)
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and reviewed_by = auth.uid()
  and status in ('reviewed', 'late')
  and public.assignment_student_in_roster(
    tenant_id,
    assignment_id,
    student_id
  )
);
