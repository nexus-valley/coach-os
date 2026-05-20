-- Module 31: Attendance and session tracking
-- Additive only. Run after Module 27 trainer assignments.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  cohort_id uuid references public.cohorts(id) on delete set null,
  trainer_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'canceled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end_at is null or scheduled_end_at >= scheduled_start_at)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  remarks text,
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index if not exists sessions_tenant_id_idx on public.sessions (tenant_id);
create index if not exists sessions_tenant_start_idx on public.sessions (tenant_id, scheduled_start_at desc);
create index if not exists sessions_course_id_idx on public.sessions (tenant_id, course_id);
create index if not exists sessions_cohort_id_idx on public.sessions (tenant_id, cohort_id);
create index if not exists sessions_trainer_user_id_idx on public.sessions (tenant_id, trainer_user_id);
create index if not exists sessions_status_idx on public.sessions (tenant_id, status);

create index if not exists attendance_records_tenant_id_idx on public.attendance_records (tenant_id);
create index if not exists attendance_records_session_id_idx on public.attendance_records (tenant_id, session_id);
create index if not exists attendance_records_student_id_idx on public.attendance_records (tenant_id, student_id);
create index if not exists attendance_records_status_idx on public.attendance_records (tenant_id, status);

drop trigger if exists set_sessions_updated_at on public.sessions;
create trigger set_sessions_updated_at
before update on public.sessions
for each row execute function public.set_updated_at();

alter table public.sessions enable row level security;
alter table public.attendance_records enable row level security;

grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;

drop policy if exists "Owner admin staff can read sessions" on public.sessions;
create policy "Owner admin staff can read sessions"
on public.sessions
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']));

drop policy if exists "Trainer can read assigned sessions" on public.sessions;
create policy "Trainer can read assigned sessions"
on public.sessions
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and (
    trainer_user_id = auth.uid()
    or exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = sessions.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = sessions.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = sessions.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = sessions.cohort_id
    )
  )
);

drop policy if exists "Owner and admin can manage sessions" on public.sessions;
create policy "Owner and admin can manage sessions"
on public.sessions
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and (course_id is null or exists (
    select 1 from public.courses c
    where c.id = sessions.course_id and c.tenant_id = sessions.tenant_id
  ))
  and (cohort_id is null or exists (
    select 1 from public.cohorts c
    where c.id = sessions.cohort_id and c.tenant_id = sessions.tenant_id
  ))
);

drop policy if exists "Trainer can manage assigned sessions" on public.sessions;
create policy "Trainer can manage assigned sessions"
on public.sessions
for all
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and (
    trainer_user_id = auth.uid()
    or exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = sessions.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = sessions.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = sessions.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = sessions.cohort_id
    )
  )
)
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and trainer_user_id = auth.uid()
  and (
    exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = sessions.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = sessions.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = sessions.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = sessions.cohort_id
    )
  )
);

drop policy if exists "Owner admin staff can read attendance records" on public.attendance_records;
create policy "Owner admin staff can read attendance records"
on public.attendance_records
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']));

drop policy if exists "Trainer can read assigned attendance records" on public.attendance_records;
create policy "Trainer can read assigned attendance records"
on public.attendance_records
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and exists (
    select 1
    from public.sessions s
    where s.id = attendance_records.session_id
      and s.tenant_id = attendance_records.tenant_id
      and (
        s.trainer_user_id = auth.uid()
        or exists (
          select 1
          from public.trainer_course_assignments tca
          where tca.tenant_id = s.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.course_id = s.course_id
        )
        or exists (
          select 1
          from public.trainer_cohort_assignments tca
          where tca.tenant_id = s.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.cohort_id = s.cohort_id
        )
      )
  )
);

drop policy if exists "Owner and admin can manage attendance records" on public.attendance_records;
create policy "Owner and admin can manage attendance records"
on public.attendance_records
for all
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  and marked_by = auth.uid()
  and exists (
    select 1 from public.sessions s
    where s.id = attendance_records.session_id
      and s.tenant_id = attendance_records.tenant_id
  )
  and exists (
    select 1 from public.students st
    where st.id = attendance_records.student_id
      and st.tenant_id = attendance_records.tenant_id
  )
);

drop policy if exists "Trainer can manage assigned attendance records" on public.attendance_records;
create policy "Trainer can manage assigned attendance records"
on public.attendance_records
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and marked_by = auth.uid()
  and exists (
    select 1
    from public.sessions s
    where s.id = attendance_records.session_id
      and s.tenant_id = attendance_records.tenant_id
      and (
        s.trainer_user_id = auth.uid()
        or exists (
          select 1
          from public.trainer_course_assignments tca
          where tca.tenant_id = s.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.course_id = s.course_id
        )
        or exists (
          select 1
          from public.trainer_cohort_assignments tca
          where tca.tenant_id = s.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.cohort_id = s.cohort_id
        )
      )
  )
);

drop policy if exists "Trainer can update assigned attendance records" on public.attendance_records;
create policy "Trainer can update assigned attendance records"
on public.attendance_records
for update
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and exists (
    select 1
    from public.sessions s
    where s.id = attendance_records.session_id
      and s.tenant_id = attendance_records.tenant_id
      and (
        s.trainer_user_id = auth.uid()
        or exists (
          select 1
          from public.trainer_course_assignments tca
          where tca.tenant_id = s.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.course_id = s.course_id
        )
        or exists (
          select 1
          from public.trainer_cohort_assignments tca
          where tca.tenant_id = s.tenant_id
            and tca.trainer_user_id = auth.uid()
            and tca.cohort_id = s.cohort_id
        )
      )
  )
)
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and marked_by = auth.uid()
);
