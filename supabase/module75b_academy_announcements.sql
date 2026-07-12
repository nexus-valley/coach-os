-- Module 75B: Academy Announcements SQL/RLS Foundation
-- Proposal only. Review before execution. Do not run until approved.
--
-- MVP scope:
-- - Owner/admin/staff can create, update, publish, and archive announcements.
-- - Students can read published, non-expired all-students announcements for
--   their active student portal tenant.
-- - No comments, reactions, student posting, course/cohort targeting, or
--   external broadcast providers.

begin;

create table if not exists public.academy_announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  body text not null,
  status text not null default 'draft',
  audience_type text not null default 'all_students',
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'academy_announcements_status_check'
      and conrelid = 'public.academy_announcements'::regclass
  ) then
    alter table public.academy_announcements
    add constraint academy_announcements_status_check
    check (status in ('draft', 'published', 'archived'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'academy_announcements_audience_type_check'
      and conrelid = 'public.academy_announcements'::regclass
  ) then
    alter table public.academy_announcements
    add constraint academy_announcements_audience_type_check
    check (audience_type = 'all_students');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'academy_announcements_title_not_blank'
      and conrelid = 'public.academy_announcements'::regclass
  ) then
    alter table public.academy_announcements
    add constraint academy_announcements_title_not_blank
    check (btrim(title) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'academy_announcements_body_not_blank'
      and conrelid = 'public.academy_announcements'::regclass
  ) then
    alter table public.academy_announcements
    add constraint academy_announcements_body_not_blank
    check (btrim(body) <> '');
  end if;
end $$;

create index if not exists academy_announcements_tenant_status_published_idx
on public.academy_announcements (tenant_id, status, published_at desc);

create index if not exists academy_announcements_tenant_created_idx
on public.academy_announcements (tenant_id, created_at desc);

create index if not exists academy_announcements_tenant_status_expires_idx
on public.academy_announcements (tenant_id, status, expires_at);

create or replace function public.m75b_set_academy_announcements_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_academy_announcements_updated_at on public.academy_announcements;
create trigger set_academy_announcements_updated_at
before update on public.academy_announcements
for each row execute function public.m75b_set_academy_announcements_updated_at();

alter table public.academy_announcements enable row level security;

revoke all on table public.academy_announcements from public, anon, authenticated;

create or replace function public.m75b_current_team_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = auth.uid()
    and tm.role in ('owner', 'admin', 'staff')
    and public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin', 'staff'])
  limit 1
$$;

create or replace function public.m75b_assert_team_can_manage(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  if not public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin', 'staff']) then
    raise exception 'Only owner, admin, or staff users can manage announcements.' using errcode = '42501';
  end if;

  v_role := public.m75b_current_team_role(p_tenant_id);

  if v_role is null then
    raise exception 'Only owner, admin, or staff users can manage announcements.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m75b_student_context()
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
    and coalesce(s.portal_enabled, true) = true
    and s.status = 'active'
  order by spa.linked_at asc
  limit 1
$$;

create or replace function public.m75b_has_active_student_portal_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.student_portal_accounts spa
    join public.students s
      on s.id = spa.student_id
     and s.tenant_id = spa.tenant_id
    where spa.tenant_id = p_tenant_id
      and spa.user_id = auth.uid()
      and spa.status = 'active'
      and coalesce(s.portal_enabled, true) = true
      and s.status = 'active'
  )
$$;

create or replace function public.m75b_validate_text(
  p_value text,
  p_label text,
  p_required boolean,
  p_max_length integer
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_required and v_value is null then
    raise exception '% is required.', p_label using errcode = '22023';
  end if;

  if v_value is not null and char_length(v_value) > p_max_length then
    raise exception '% is too long.', p_label using errcode = '22023';
  end if;

  if v_value is not null and (position('<' in v_value) > 0 or position('>' in v_value) > 0) then
    raise exception '% cannot contain HTML-like characters.', p_label using errcode = '22023';
  end if;

  return v_value;
end;
$$;

drop policy if exists "Team can read academy announcements" on public.academy_announcements;
create policy "Team can read academy announcements"
on public.academy_announcements
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']));

drop policy if exists "Students can read published academy announcements" on public.academy_announcements;
create policy "Students can read published academy announcements"
on public.academy_announcements
for select
to authenticated
using (
  status = 'published'
  and audience_type = 'all_students'
  and published_at is not null
  and published_at <= now()
  and (expires_at is null or expires_at > now())
  and public.m75b_has_active_student_portal_tenant(tenant_id)
);

drop policy if exists "Team can insert academy announcements" on public.academy_announcements;
create policy "Team can insert academy announcements"
on public.academy_announcements
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff'])
  and audience_type = 'all_students'
);

drop policy if exists "Team can update academy announcements" on public.academy_announcements;
create policy "Team can update academy announcements"
on public.academy_announcements
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff'])
  and audience_type = 'all_students'
);

create or replace function public.get_student_announcements()
returns table (
  id uuid,
  tenant_id uuid,
  title text,
  body text,
  status text,
  audience_type text,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    aa.id,
    aa.tenant_id,
    aa.title,
    aa.body,
    aa.status,
    aa.audience_type,
    aa.published_at,
    aa.expires_at,
    aa.created_at,
    aa.updated_at,
    aa.archived_at
  from public.m75b_student_context() ctx
  join public.academy_announcements aa
    on aa.tenant_id = ctx.tenant_id
   and aa.status = 'published'
   and aa.audience_type = 'all_students'
   and aa.published_at is not null
   and aa.published_at <= now()
   and (aa.expires_at is null or aa.expires_at > now())
  order by aa.published_at desc, aa.created_at desc
$$;

create or replace function public.get_team_announcements(p_tenant_id uuid)
returns setof public.academy_announcements
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.m75b_assert_team_can_manage(p_tenant_id);

  return query
  select aa.*
  from public.academy_announcements aa
  where aa.tenant_id = p_tenant_id
  order by
    case aa.status
      when 'published' then 1
      when 'draft' then 2
      else 3
    end,
    coalesce(aa.published_at, aa.created_at) desc,
    aa.created_at desc;
end;
$$;

create or replace function public.create_academy_announcement(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz default null
)
returns public.academy_announcements
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_announcement public.academy_announcements%rowtype;
  v_body text := public.m75b_validate_text(p_body, 'Announcement body', true, 6000);
  v_title text := public.m75b_validate_text(p_title, 'Announcement title', true, 180);
begin
  perform public.m75b_assert_team_can_manage(p_tenant_id);

  insert into public.academy_announcements (
    tenant_id,
    title,
    body,
    status,
    audience_type,
    expires_at,
    created_by
  )
  values (
    p_tenant_id,
    v_title,
    v_body,
    'draft',
    'all_students',
    p_expires_at,
    auth.uid()
  )
  returning * into v_announcement;

  return v_announcement;
end;
$$;

create or replace function public.update_academy_announcement(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_expires_at timestamptz default null
)
returns public.academy_announcements
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_announcement public.academy_announcements%rowtype;
  v_body text := public.m75b_validate_text(p_body, 'Announcement body', true, 6000);
  v_existing public.academy_announcements%rowtype;
  v_title text := public.m75b_validate_text(p_title, 'Announcement title', true, 180);
begin
  select *
  into v_existing
  from public.academy_announcements
  where id = p_announcement_id;

  if not found then
    raise exception 'Announcement not found.' using errcode = '22023';
  end if;

  perform public.m75b_assert_team_can_manage(v_existing.tenant_id);

  if v_existing.status = 'archived' then
    raise exception 'Archived announcements cannot be edited.' using errcode = '22023';
  end if;

  update public.academy_announcements aa
  set title = v_title,
      body = v_body,
      expires_at = p_expires_at
  where aa.id = v_existing.id
  returning * into v_announcement;

  return v_announcement;
end;
$$;

create or replace function public.publish_academy_announcement(p_announcement_id uuid)
returns public.academy_announcements
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_announcement public.academy_announcements%rowtype;
  v_existing public.academy_announcements%rowtype;
begin
  select *
  into v_existing
  from public.academy_announcements
  where id = p_announcement_id;

  if not found then
    raise exception 'Announcement not found.' using errcode = '22023';
  end if;

  perform public.m75b_assert_team_can_manage(v_existing.tenant_id);

  if v_existing.status = 'archived' then
    raise exception 'Archived announcements cannot be published.' using errcode = '22023';
  end if;

  update public.academy_announcements aa
  set status = 'published',
      published_at = coalesce(aa.published_at, now()),
      archived_at = null
  where aa.id = v_existing.id
  returning * into v_announcement;

  return v_announcement;
end;
$$;

create or replace function public.archive_academy_announcement(p_announcement_id uuid)
returns public.academy_announcements
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_announcement public.academy_announcements%rowtype;
  v_existing public.academy_announcements%rowtype;
begin
  select *
  into v_existing
  from public.academy_announcements
  where id = p_announcement_id;

  if not found then
    raise exception 'Announcement not found.' using errcode = '22023';
  end if;

  perform public.m75b_assert_team_can_manage(v_existing.tenant_id);

  update public.academy_announcements aa
  set status = 'archived',
      archived_at = coalesce(aa.archived_at, now())
  where aa.id = v_existing.id
  returning * into v_announcement;

  return v_announcement;
end;
$$;

revoke execute on function public.m75b_set_academy_announcements_updated_at() from public, anon, authenticated;
revoke execute on function public.m75b_current_team_role(uuid) from public, anon, authenticated;
revoke execute on function public.m75b_assert_team_can_manage(uuid) from public, anon, authenticated;
revoke execute on function public.m75b_student_context() from public, anon, authenticated;
revoke execute on function public.m75b_has_active_student_portal_tenant(uuid) from public, anon;
revoke execute on function public.m75b_validate_text(text, text, boolean, integer) from public, anon, authenticated;

revoke execute on function public.get_student_announcements() from public, anon;
revoke execute on function public.get_team_announcements(uuid) from public, anon;
revoke execute on function public.create_academy_announcement(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.update_academy_announcement(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.publish_academy_announcement(uuid) from public, anon;
revoke execute on function public.archive_academy_announcement(uuid) from public, anon;

grant execute on function public.get_student_announcements() to authenticated;
grant execute on function public.get_team_announcements(uuid) to authenticated;
grant execute on function public.create_academy_announcement(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.update_academy_announcement(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.publish_academy_announcement(uuid) to authenticated;
grant execute on function public.archive_academy_announcement(uuid) to authenticated;
grant execute on function public.m75b_has_active_student_portal_tenant(uuid) to authenticated;

commit;

-- Verification queries for manual review after approved execution:
--
-- 1. Table exists and RLS is enabled:
-- select relname, relrowsecurity
-- from pg_class
-- where oid = 'public.academy_announcements'::regclass;
--
-- 2. Expected policies exist:
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'academy_announcements'
-- order by policyname;
--
-- 3. Expected RPCs exist:
-- select proname, prosecdef
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in (
--     'get_student_announcements',
--     'get_team_announcements',
--     'create_academy_announcement',
--     'update_academy_announcement',
--     'publish_academy_announcement',
--     'archive_academy_announcement'
--   )
-- order by proname;
--
-- 4. Function grants are authenticated-only for public RPCs:
-- select routine_name, privilege_type, grantee
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name in (
--     'get_student_announcements',
--     'get_team_announcements',
--     'create_academy_announcement',
--     'update_academy_announcement',
--     'publish_academy_announcement',
--     'archive_academy_announcement'
--   )
-- order by routine_name, grantee;
--
-- 5. Generic notifications behavior unchanged by this module:
-- select to_regclass('public.notifications') as notifications_table;
--
-- 6. Academy chat behavior unchanged by this module:
-- select to_regclass('public.conversation_threads') as conversation_threads_table,
--        to_regprocedure('public.get_student_chat_threads()') as student_chat_rpc,
--        to_regprocedure('public.get_team_chat_threads(uuid)') as team_chat_rpc;
