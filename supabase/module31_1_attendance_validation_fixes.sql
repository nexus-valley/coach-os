-- Module 31.1: Attendance validation fixes
-- Run after supabase/module31_attendance_tracking.sql.

-- 1) Split the original trainer session "for all" policy into command-specific
-- policies. Inserts still require trainer_user_id = auth.uid(), while updates
-- can complete/cancel owner-created sessions that are assigned through course
-- or cohort scope.

drop policy if exists "Trainer can manage assigned sessions" on public.sessions;

drop policy if exists "Trainer can create assigned sessions" on public.sessions;
create policy "Trainer can create assigned sessions"
on public.sessions
for insert
to authenticated
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

drop policy if exists "Trainer can update assigned sessions" on public.sessions;
create policy "Trainer can update assigned sessions"
on public.sessions
for update
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
  and (trainer_user_id is null or trainer_user_id = auth.uid())
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

drop policy if exists "Trainer can delete assigned sessions" on public.sessions;
create policy "Trainer can delete assigned sessions"
on public.sessions
for delete
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and trainer_user_id = auth.uid()
);

-- 2) Enforce session roster membership at the RLS layer. This prevents forged
-- clients from marking unrelated tenant students against an assigned session.

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
    select 1
    from public.sessions s
    where s.id = attendance_records.session_id
      and s.tenant_id = attendance_records.tenant_id
      and (
        (
          s.cohort_id is not null
          and exists (
            select 1
            from public.cohort_members cm
            where cm.tenant_id = attendance_records.tenant_id
              and cm.cohort_id = s.cohort_id
              and cm.student_id = attendance_records.student_id
          )
        )
        or (
          s.cohort_id is null
          and s.course_id is not null
          and exists (
            select 1
            from public.enrollments e
            where e.tenant_id = attendance_records.tenant_id
              and e.course_id = s.course_id
              and e.student_id = attendance_records.student_id
          )
        )
      )
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
      and (
        (
          s.cohort_id is not null
          and exists (
            select 1
            from public.cohort_members cm
            where cm.tenant_id = attendance_records.tenant_id
              and cm.cohort_id = s.cohort_id
              and cm.student_id = attendance_records.student_id
          )
        )
        or (
          s.cohort_id is null
          and s.course_id is not null
          and exists (
            select 1
            from public.enrollments e
            where e.tenant_id = attendance_records.tenant_id
              and e.course_id = s.course_id
              and e.student_id = attendance_records.student_id
          )
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
  and exists (
    select 1
    from public.sessions s
    where s.id = attendance_records.session_id
      and s.tenant_id = attendance_records.tenant_id
      and (
        (
          s.cohort_id is not null
          and exists (
            select 1
            from public.cohort_members cm
            where cm.tenant_id = attendance_records.tenant_id
              and cm.cohort_id = s.cohort_id
              and cm.student_id = attendance_records.student_id
          )
        )
        or (
          s.cohort_id is null
          and s.course_id is not null
          and exists (
            select 1
            from public.enrollments e
            where e.tenant_id = attendance_records.tenant_id
              and e.course_id = s.course_id
              and e.student_id = attendance_records.student_id
          )
        )
      )
  )
);
