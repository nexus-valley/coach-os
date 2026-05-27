-- Module 36: Chat and communication system foundation
-- Additive only. Run after Module 35 live classes.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.conversation_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  thread_type text not null check (
    thread_type in (
      'announcement',
      'course_discussion',
      'cohort_discussion',
      'direct_message',
      'staff_note'
    )
  ),
  title text,
  description text,
  entity_type text,
  entity_id uuid,
  course_id uuid references public.courses(id) on delete set null,
  cohort_id uuid references public.cohorts(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived', 'locked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  role text check (role in ('owner', 'admin', 'staff', 'trainer', 'student')),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_id is not null or student_id is not null)
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_student_id uuid references public.students(id) on delete set null,
  message text not null,
  message_type text not null default 'text' check (message_type in ('text', 'system', 'announcement')),
  status text not null default 'sent' check (status in ('sent', 'edited', 'deleted')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (sender_user_id is not null or sender_student_id is not null)
);

create unique index if not exists conversation_participants_thread_user_unique_idx
on public.conversation_participants (thread_id, user_id)
where user_id is not null;

create unique index if not exists conversation_participants_thread_student_unique_idx
on public.conversation_participants (thread_id, student_id)
where student_id is not null;

create index if not exists conversation_threads_tenant_id_idx on public.conversation_threads (tenant_id);
create index if not exists conversation_threads_thread_type_idx on public.conversation_threads (tenant_id, thread_type);
create index if not exists conversation_threads_course_id_idx on public.conversation_threads (tenant_id, course_id);
create index if not exists conversation_threads_cohort_id_idx on public.conversation_threads (tenant_id, cohort_id);
create index if not exists conversation_threads_student_id_idx on public.conversation_threads (tenant_id, student_id);
create index if not exists conversation_threads_created_at_idx on public.conversation_threads (tenant_id, created_at desc);
create index if not exists conversation_threads_status_idx on public.conversation_threads (tenant_id, status);

create index if not exists conversation_participants_tenant_id_idx on public.conversation_participants (tenant_id);
create index if not exists conversation_participants_thread_id_idx on public.conversation_participants (tenant_id, thread_id);
create index if not exists conversation_participants_user_id_idx on public.conversation_participants (tenant_id, user_id);
create index if not exists conversation_participants_student_id_idx on public.conversation_participants (tenant_id, student_id);

create index if not exists conversation_messages_tenant_id_idx on public.conversation_messages (tenant_id);
create index if not exists conversation_messages_thread_id_idx on public.conversation_messages (tenant_id, thread_id, created_at desc);
create index if not exists conversation_messages_sender_user_id_idx on public.conversation_messages (tenant_id, sender_user_id);
create index if not exists conversation_messages_sender_student_id_idx on public.conversation_messages (tenant_id, sender_student_id);
create index if not exists conversation_messages_created_at_idx on public.conversation_messages (tenant_id, created_at desc);

drop trigger if exists set_conversation_threads_updated_at on public.conversation_threads;
create trigger set_conversation_threads_updated_at
before update on public.conversation_threads
for each row execute function public.set_updated_at();

alter table public.conversation_threads enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.conversation_messages enable row level security;

grant select, insert, update on public.conversation_threads to authenticated;
grant select, insert, update on public.conversation_participants to authenticated;
grant select, insert, update on public.conversation_messages to authenticated;

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
        'assignment_notice',
        'live_session_notice',
        'communication_notice'
      )
    );
  end if;
end $$;

drop policy if exists "Owner and admin can read conversation threads" on public.conversation_threads;
create policy "Owner and admin can read conversation threads"
on public.conversation_threads
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Staff can read operational conversation threads" on public.conversation_threads;
create policy "Staff can read operational conversation threads"
on public.conversation_threads
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['staff'])
  and (
    thread_type in ('announcement', 'course_discussion', 'cohort_discussion', 'staff_note')
    or exists (
      select 1
      from public.conversation_participants cp
      where cp.thread_id = conversation_threads.id
        and cp.tenant_id = conversation_threads.tenant_id
        and cp.user_id = auth.uid()
    )
  )
);

drop policy if exists "Trainer can read scoped conversation threads" on public.conversation_threads;
create policy "Trainer can read scoped conversation threads"
on public.conversation_threads
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
  and (
    exists (
      select 1
      from public.conversation_participants cp
      where cp.thread_id = conversation_threads.id
        and cp.tenant_id = conversation_threads.tenant_id
        and cp.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.trainer_course_assignments tca
      where tca.tenant_id = conversation_threads.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.course_id = conversation_threads.course_id
    )
    or exists (
      select 1
      from public.trainer_cohort_assignments tca
      where tca.tenant_id = conversation_threads.tenant_id
        and tca.trainer_user_id = auth.uid()
        and tca.cohort_id = conversation_threads.cohort_id
    )
    or (
      conversation_threads.student_id is not null
      and (
        exists (
          select 1
          from public.enrollments e
          join public.trainer_course_assignments tca
            on tca.tenant_id = e.tenant_id
           and tca.course_id = e.course_id
          where e.tenant_id = conversation_threads.tenant_id
            and e.student_id = conversation_threads.student_id
            and tca.trainer_user_id = auth.uid()
        )
        or exists (
          select 1
          from public.cohort_members cm
          join public.trainer_cohort_assignments tca
            on tca.tenant_id = cm.tenant_id
           and tca.cohort_id = cm.cohort_id
          where cm.tenant_id = conversation_threads.tenant_id
            and cm.student_id = conversation_threads.student_id
            and tca.trainer_user_id = auth.uid()
        )
      )
    )
  )
);

drop policy if exists "Owner admin staff trainer can create conversation threads" on public.conversation_threads;
create policy "Owner admin staff trainer can create conversation threads"
on public.conversation_threads
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
  and (
    public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
    or (
      public.has_tenant_role(tenant_id, auth.uid(), array['staff'])
      and thread_type in ('staff_note', 'direct_message')
    )
    or (
      public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
      and thread_type in ('course_discussion', 'cohort_discussion', 'direct_message')
      and (
        (
          thread_type = 'course_discussion'
          and course_id is not null
          and exists (
            select 1
            from public.trainer_course_assignments tca
            where tca.tenant_id = conversation_threads.tenant_id
              and tca.trainer_user_id = auth.uid()
              and tca.course_id = conversation_threads.course_id
          )
        )
        or (
          thread_type = 'cohort_discussion'
          and cohort_id is not null
          and exists (
            select 1
            from public.trainer_cohort_assignments tca
            where tca.tenant_id = conversation_threads.tenant_id
              and tca.trainer_user_id = auth.uid()
              and tca.cohort_id = conversation_threads.cohort_id
          )
        )
        or (
          thread_type = 'direct_message'
          and conversation_threads.student_id is not null
          and (
            exists (
              select 1
              from public.enrollments e
              join public.trainer_course_assignments tca
                on tca.tenant_id = e.tenant_id
               and tca.course_id = e.course_id
              where e.tenant_id = conversation_threads.tenant_id
                and e.student_id = conversation_threads.student_id
                and tca.trainer_user_id = auth.uid()
            )
            or exists (
              select 1
              from public.cohort_members cm
              join public.trainer_cohort_assignments tca
                on tca.tenant_id = cm.tenant_id
               and tca.cohort_id = cm.cohort_id
              where cm.tenant_id = conversation_threads.tenant_id
                and cm.student_id = conversation_threads.student_id
                and tca.trainer_user_id = auth.uid()
            )
          )
        )
      )
    )
  )
);

drop policy if exists "Owner admin can update conversation threads" on public.conversation_threads;
create policy "Owner admin can update conversation threads"
on public.conversation_threads
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Users can read own conversation participants" on public.conversation_participants;
create policy "Users can read own conversation participants"
on public.conversation_participants
for select
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or user_id = auth.uid()
  or (
    public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
    and exists (
      select 1
      from public.conversation_threads ct
      where ct.id = conversation_participants.thread_id
        and ct.tenant_id = conversation_participants.tenant_id
        and (
          exists (
            select 1
            from public.trainer_course_assignments tca
            where tca.tenant_id = ct.tenant_id
              and tca.trainer_user_id = auth.uid()
              and tca.course_id = ct.course_id
          )
          or exists (
            select 1
            from public.trainer_cohort_assignments tca
            where tca.tenant_id = ct.tenant_id
              and tca.trainer_user_id = auth.uid()
              and tca.cohort_id = ct.cohort_id
          )
          or (
            ct.student_id is not null
            and (
              exists (
                select 1
                from public.enrollments e
                join public.trainer_course_assignments tca
                  on tca.tenant_id = e.tenant_id
                 and tca.course_id = e.course_id
                where e.tenant_id = ct.tenant_id
                  and e.student_id = ct.student_id
                  and tca.trainer_user_id = auth.uid()
              )
              or exists (
                select 1
                from public.cohort_members cm
                join public.trainer_cohort_assignments tca
                  on tca.tenant_id = cm.tenant_id
                 and tca.cohort_id = cm.cohort_id
                where cm.tenant_id = ct.tenant_id
                  and cm.student_id = ct.student_id
                  and tca.trainer_user_id = auth.uid()
              )
            )
          )
        )
    )
  )
);

drop policy if exists "Tenant users can create conversation participants" on public.conversation_participants;
create policy "Tenant users can create conversation participants"
on public.conversation_participants
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id, auth.uid())
  and (
    conversation_participants.user_id is not null
    or conversation_participants.student_id is not null
  )
  and (
    conversation_participants.user_id is null
    or exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = conversation_participants.tenant_id
        and tm.user_id = conversation_participants.user_id
    )
  )
  and (
    conversation_participants.student_id is null
    or exists (
      select 1
      from public.students s
      where s.tenant_id = conversation_participants.tenant_id
        and s.id = conversation_participants.student_id
    )
  )
  and exists (
    select 1
    from public.conversation_threads ct
    where ct.id = conversation_participants.thread_id
      and ct.tenant_id = conversation_participants.tenant_id
  )
  and (
    public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
    or (
      conversation_participants.user_id = auth.uid()
      and exists (
        select 1
        from public.conversation_threads ct
        where ct.id = conversation_participants.thread_id
          and ct.tenant_id = conversation_participants.tenant_id
          and ct.created_by = auth.uid()
      )
    )
    or (
      conversation_participants.student_id is not null
      and public.has_tenant_role(tenant_id, auth.uid(), array['trainer'])
      and exists (
        select 1
        from public.conversation_threads ct
        where ct.id = conversation_participants.thread_id
          and ct.tenant_id = conversation_participants.tenant_id
          and ct.created_by = auth.uid()
          and ct.thread_type = 'direct_message'
          and ct.student_id = conversation_participants.student_id
          and (
            exists (
              select 1
              from public.enrollments e
              join public.trainer_course_assignments tca
                on tca.tenant_id = e.tenant_id
               and tca.course_id = e.course_id
              where e.tenant_id = ct.tenant_id
                and e.student_id = ct.student_id
                and tca.trainer_user_id = auth.uid()
            )
            or exists (
              select 1
              from public.cohort_members cm
              join public.trainer_cohort_assignments tca
                on tca.tenant_id = cm.tenant_id
               and tca.cohort_id = cm.cohort_id
              where cm.tenant_id = ct.tenant_id
                and cm.student_id = ct.student_id
                and tca.trainer_user_id = auth.uid()
            )
          )
      )
    )
  )
);

drop policy if exists "Users can update own conversation participants" on public.conversation_participants;
create policy "Users can update own conversation participants"
on public.conversation_participants
for update
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or user_id = auth.uid()
)
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or user_id = auth.uid()
);

drop policy if exists "Users can read scoped conversation messages" on public.conversation_messages;
create policy "Users can read scoped conversation messages"
on public.conversation_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_threads ct
    where ct.id = conversation_messages.thread_id
      and ct.tenant_id = conversation_messages.tenant_id
      and (
        public.has_tenant_role(ct.tenant_id, auth.uid(), array['owner', 'admin'])
        or (
          public.has_tenant_role(ct.tenant_id, auth.uid(), array['staff'])
          and (
            ct.thread_type in ('announcement', 'course_discussion', 'cohort_discussion', 'staff_note')
            or exists (
              select 1
              from public.conversation_participants cp
              where cp.thread_id = ct.id
                and cp.tenant_id = ct.tenant_id
                and cp.user_id = auth.uid()
            )
          )
        )
        or (
          public.has_tenant_role(ct.tenant_id, auth.uid(), array['trainer'])
          and (
            exists (
              select 1
              from public.conversation_participants cp
              where cp.thread_id = ct.id
                and cp.tenant_id = ct.tenant_id
                and cp.user_id = auth.uid()
            )
            or exists (
              select 1
              from public.trainer_course_assignments tca
              where tca.tenant_id = ct.tenant_id
                and tca.trainer_user_id = auth.uid()
                and tca.course_id = ct.course_id
            )
            or exists (
              select 1
              from public.trainer_cohort_assignments tca
              where tca.tenant_id = ct.tenant_id
                and tca.trainer_user_id = auth.uid()
                and tca.cohort_id = ct.cohort_id
            )
            or (
              ct.student_id is not null
              and (
                exists (
                  select 1
                  from public.enrollments e
                  join public.trainer_course_assignments tca
                    on tca.tenant_id = e.tenant_id
                   and tca.course_id = e.course_id
                  where e.tenant_id = ct.tenant_id
                    and e.student_id = ct.student_id
                    and tca.trainer_user_id = auth.uid()
                )
                or exists (
                  select 1
                  from public.cohort_members cm
                  join public.trainer_cohort_assignments tca
                    on tca.tenant_id = cm.tenant_id
                   and tca.cohort_id = cm.cohort_id
                  where cm.tenant_id = ct.tenant_id
                    and cm.student_id = ct.student_id
                    and tca.trainer_user_id = auth.uid()
                )
              )
            )
          )
        )
      )
  )
);

drop policy if exists "Users can insert scoped conversation messages" on public.conversation_messages;
create policy "Users can insert scoped conversation messages"
on public.conversation_messages
for insert
to authenticated
with check (
  conversation_messages.sender_user_id = auth.uid()
  and conversation_messages.sender_student_id is null
  and public.is_tenant_member(tenant_id, auth.uid())
  and exists (
    select 1
    from public.conversation_threads ct
    where ct.id = conversation_messages.thread_id
      and ct.tenant_id = conversation_messages.tenant_id
      and ct.status = 'active'
      and (
        public.has_tenant_role(ct.tenant_id, auth.uid(), array['owner', 'admin'])
        or exists (
          select 1
          from public.conversation_participants cp
          where cp.thread_id = ct.id
            and cp.tenant_id = ct.tenant_id
            and cp.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "Users can update own conversation messages" on public.conversation_messages;
create policy "Users can update own conversation messages"
on public.conversation_messages
for update
to authenticated
using (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or sender_user_id = auth.uid()
)
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin'])
  or sender_user_id = auth.uid()
);
