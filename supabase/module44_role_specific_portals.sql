-- Module 44: Role-specific portals and student portal auth
-- Additive only. Run after Module 43 delegated permissions.

create table if not exists public.student_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'pending')),
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  last_login_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_id),
  unique (tenant_id, user_id)
);

create index if not exists student_portal_accounts_tenant_id_idx
on public.student_portal_accounts (tenant_id);

create index if not exists student_portal_accounts_student_id_idx
on public.student_portal_accounts (tenant_id, student_id);

create index if not exists student_portal_accounts_user_id_idx
on public.student_portal_accounts (tenant_id, user_id);

create index if not exists student_portal_accounts_status_idx
on public.student_portal_accounts (tenant_id, status);

drop trigger if exists set_student_portal_accounts_updated_at on public.student_portal_accounts;
create trigger set_student_portal_accounts_updated_at
before update on public.student_portal_accounts
for each row execute function public.set_updated_at();

alter table public.student_portal_accounts enable row level security;

grant select, insert, update, delete on public.student_portal_accounts to authenticated;
grant select, insert, update on public.student_portal_accounts to service_role;

create or replace function public.has_active_student_portal_account(
  check_tenant_id uuid,
  check_student_id uuid,
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
    from public.student_portal_accounts spa
    where spa.tenant_id = check_tenant_id
      and spa.student_id = check_student_id
      and spa.user_id = check_user_id
      and spa.status = 'active'
      and check_user_id = auth.uid()
  );
$$;

create or replace function public.has_any_active_student_portal_account(
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
    from public.student_portal_accounts spa
    where spa.tenant_id = check_tenant_id
      and spa.user_id = check_user_id
      and spa.status = 'active'
      and check_user_id = auth.uid()
  );
$$;

revoke execute on function public.has_active_student_portal_account(uuid, uuid, uuid) from public;
revoke execute on function public.has_any_active_student_portal_account(uuid, uuid) from public;
grant execute on function public.has_active_student_portal_account(uuid, uuid, uuid) to authenticated;
grant execute on function public.has_any_active_student_portal_account(uuid, uuid) to authenticated;

drop policy if exists "Owner and admin can manage student portal accounts" on public.student_portal_accounts;
create policy "Owner and admin can manage student portal accounts"
on public.student_portal_accounts
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and exists (
    select 1
    from public.students s
    where s.id = student_portal_accounts.student_id
      and s.tenant_id = student_portal_accounts.tenant_id
  )
);

drop policy if exists "Students can read own portal account" on public.student_portal_accounts;
create policy "Students can read own portal account"
on public.student_portal_accounts
for select
to authenticated
using (
  user_id = auth.uid()
  and status = 'active'
);

drop policy if exists "Linked students can read portal tenant" on public.tenants;
create policy "Linked students can read portal tenant"
on public.tenants
for select
to authenticated
using (public.has_any_active_student_portal_account(id, auth.uid()));

drop policy if exists "Linked students can read own student record" on public.students;
create policy "Linked students can read own student record"
on public.students
for select
to authenticated
using (
  public.has_active_student_portal_account(tenant_id, id, auth.uid())
  and portal_enabled = true
);

drop policy if exists "Linked students can read own enrollments" on public.enrollments;
create policy "Linked students can read own enrollments"
on public.enrollments
for select
to authenticated
using (public.has_active_student_portal_account(tenant_id, student_id, auth.uid()));

drop policy if exists "Linked students can read enrolled courses" on public.courses;
create policy "Linked students can read enrolled courses"
on public.courses
for select
to authenticated
using (
  status = 'published'
  and exists (
    select 1
    from public.enrollments e
    where e.tenant_id = courses.tenant_id
      and e.course_id = courses.id
      and public.has_active_student_portal_account(e.tenant_id, e.student_id, auth.uid())
  )
);

drop policy if exists "Linked students can read enrolled course sections" on public.course_sections;
create policy "Linked students can read enrolled course sections"
on public.course_sections
for select
to authenticated
using (
  exists (
    select 1
    from public.enrollments e
    join public.courses c on c.id = e.course_id and c.tenant_id = e.tenant_id
    where e.tenant_id = course_sections.tenant_id
      and e.course_id = course_sections.course_id
      and c.status = 'published'
      and public.has_active_student_portal_account(e.tenant_id, e.student_id, auth.uid())
  )
);

drop policy if exists "Linked students can read enrolled lessons" on public.lessons;
create policy "Linked students can read enrolled lessons"
on public.lessons
for select
to authenticated
using (
  exists (
    select 1
    from public.enrollments e
    join public.courses c on c.id = e.course_id and c.tenant_id = e.tenant_id
    where e.tenant_id = lessons.tenant_id
      and e.course_id = lessons.course_id
      and c.status = 'published'
      and public.has_active_student_portal_account(e.tenant_id, e.student_id, auth.uid())
  )
);

drop policy if exists "Linked students can read own lesson progress" on public.lesson_progress;
create policy "Linked students can read own lesson progress"
on public.lesson_progress
for select
to authenticated
using (public.has_active_student_portal_account(tenant_id, student_id, auth.uid()));

drop policy if exists "Linked students can read own cohort memberships" on public.cohort_members;
create policy "Linked students can read own cohort memberships"
on public.cohort_members
for select
to authenticated
using (public.has_active_student_portal_account(tenant_id, student_id, auth.uid()));

drop policy if exists "Linked students can read own cohorts" on public.cohorts;
create policy "Linked students can read own cohorts"
on public.cohorts
for select
to authenticated
using (
  exists (
    select 1
    from public.cohort_members cm
    where cm.tenant_id = cohorts.tenant_id
      and cm.cohort_id = cohorts.id
      and public.has_active_student_portal_account(cm.tenant_id, cm.student_id, auth.uid())
  )
);

drop policy if exists "Linked students can read own sessions" on public.sessions;
create policy "Linked students can read own sessions"
on public.sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.enrollments e
    where e.tenant_id = sessions.tenant_id
      and e.course_id = sessions.course_id
      and public.has_active_student_portal_account(e.tenant_id, e.student_id, auth.uid())
  )
  or exists (
    select 1
    from public.cohort_members cm
    where cm.tenant_id = sessions.tenant_id
      and cm.cohort_id = sessions.cohort_id
      and public.has_active_student_portal_account(cm.tenant_id, cm.student_id, auth.uid())
  )
);

drop policy if exists "Linked students can read own attendance records" on public.attendance_records;
create policy "Linked students can read own attendance records"
on public.attendance_records
for select
to authenticated
using (public.has_active_student_portal_account(tenant_id, student_id, auth.uid()));

drop policy if exists "Linked students can read assigned assignments" on public.assignments;
create policy "Linked students can read assigned assignments"
on public.assignments
for select
to authenticated
using (
  status = 'published'
  and (
    exists (
      select 1
      from public.enrollments e
      where e.tenant_id = assignments.tenant_id
        and e.course_id = assignments.course_id
        and public.has_active_student_portal_account(e.tenant_id, e.student_id, auth.uid())
    )
    or exists (
      select 1
      from public.cohort_members cm
      where cm.tenant_id = assignments.tenant_id
        and cm.cohort_id = assignments.cohort_id
        and public.has_active_student_portal_account(cm.tenant_id, cm.student_id, auth.uid())
    )
  )
);

drop policy if exists "Linked students can read own assignment submissions" on public.assignment_submissions;
create policy "Linked students can read own assignment submissions"
on public.assignment_submissions
for select
to authenticated
using (public.has_active_student_portal_account(tenant_id, student_id, auth.uid()));

drop policy if exists "Linked students can read own payments" on public.payments;
create policy "Linked students can read own payments"
on public.payments
for select
to authenticated
using (public.has_active_student_portal_account(tenant_id, student_id, auth.uid()));

drop policy if exists "Linked students can read own payment links" on public.payment_links;
create policy "Linked students can read own payment links"
on public.payment_links
for select
to authenticated
using (public.has_active_student_portal_account(tenant_id, student_id, auth.uid()));

drop policy if exists "Linked students can read own notifications" on public.notifications;
create policy "Linked students can read own notifications"
on public.notifications
for select
to authenticated
using (
  user_id = auth.uid()
  and public.has_any_active_student_portal_account(tenant_id, auth.uid())
);

drop policy if exists "Linked students can read safe conversation threads" on public.conversation_threads;
create policy "Linked students can read safe conversation threads"
on public.conversation_threads
for select
to authenticated
using (
  status <> 'archived'
  and exists (
    select 1
    from public.student_portal_accounts spa
    where spa.tenant_id = conversation_threads.tenant_id
      and spa.user_id = auth.uid()
      and spa.status = 'active'
      and (
        (
          conversation_threads.thread_type = 'direct_message'
          and conversation_threads.student_id = spa.student_id
        )
        or (
          conversation_threads.thread_type = 'course_discussion'
          and exists (
          select 1
          from public.enrollments e
          where e.tenant_id = spa.tenant_id
            and e.student_id = spa.student_id
            and e.course_id = conversation_threads.course_id
          )
        )
        or (
          conversation_threads.thread_type = 'cohort_discussion'
          and exists (
          select 1
          from public.cohort_members cm
          where cm.tenant_id = spa.tenant_id
            and cm.student_id = spa.student_id
            and cm.cohort_id = conversation_threads.cohort_id
          )
        )
      )
  )
);
