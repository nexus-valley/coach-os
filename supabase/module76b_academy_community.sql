-- Module 76B: Controlled Academy Community SQL/RLS Foundation
-- Proposal only. Review before execution. Do not run until approved.
--
-- MVP scope:
-- - Team users create draft community posts.
-- - Owner/admin/staff users publish, archive, and hide posts.
-- - Students read published all-students posts for their active portal tenant.
-- - Students and team users can comment on published, visible posts.
-- - Owner/admin/staff users can hide comments.
-- - No student top-level posts, private student-to-student chat, attachments,
--   reactions, realtime, external broadcasts, public feed, or targeting.

begin;

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  body text not null,
  status text not null default 'draft',
  post_type text not null default 'discussion',
  audience_type text not null default 'all_students',
  created_by_user_id uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  archived_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  body text not null,
  status text not null default 'published',
  author_type text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_student_id uuid references public.students(id) on delete set null,
  hidden_by_user_id uuid references auth.users(id) on delete set null,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_posts_status_check'
      and conrelid = 'public.community_posts'::regclass
  ) then
    alter table public.community_posts
    add constraint community_posts_status_check
    check (status in ('draft', 'published', 'archived', 'hidden'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_posts_post_type_check'
      and conrelid = 'public.community_posts'::regclass
  ) then
    alter table public.community_posts
    add constraint community_posts_post_type_check
    check (post_type in ('discussion', 'question', 'resource', 'update'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_posts_audience_type_check'
      and conrelid = 'public.community_posts'::regclass
  ) then
    alter table public.community_posts
    add constraint community_posts_audience_type_check
    check (audience_type = 'all_students');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_posts_title_not_blank'
      and conrelid = 'public.community_posts'::regclass
  ) then
    alter table public.community_posts
    add constraint community_posts_title_not_blank
    check (btrim(title) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_posts_body_not_blank'
      and conrelid = 'public.community_posts'::regclass
  ) then
    alter table public.community_posts
    add constraint community_posts_body_not_blank
    check (btrim(body) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_comments_status_check'
      and conrelid = 'public.community_comments'::regclass
  ) then
    alter table public.community_comments
    add constraint community_comments_status_check
    check (status in ('published', 'hidden'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_comments_author_type_check'
      and conrelid = 'public.community_comments'::regclass
  ) then
    alter table public.community_comments
    add constraint community_comments_author_type_check
    check (author_type in ('team', 'student'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_comments_body_not_blank'
      and conrelid = 'public.community_comments'::regclass
  ) then
    alter table public.community_comments
    add constraint community_comments_body_not_blank
    check (btrim(body) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_comments_author_identity_check'
      and conrelid = 'public.community_comments'::regclass
  ) then
    alter table public.community_comments
    add constraint community_comments_author_identity_check
    check (
      (
        author_type = 'team'
        and created_by_user_id is not null
        and created_by_student_id is null
      )
      or (
        author_type = 'student'
        and created_by_student_id is not null
      )
    );
  end if;
end $$;

create index if not exists community_posts_tenant_status_published_idx
on public.community_posts (tenant_id, status, published_at desc);

create index if not exists community_posts_tenant_created_idx
on public.community_posts (tenant_id, created_at desc);

create index if not exists community_posts_tenant_status_post_type_idx
on public.community_posts (tenant_id, status, post_type);

create index if not exists community_comments_post_status_created_idx
on public.community_comments (post_id, status, created_at asc);

create index if not exists community_comments_tenant_status_created_idx
on public.community_comments (tenant_id, status, created_at desc);

create or replace function public.m76b_set_community_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.m76b_validate_comment_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_post_tenant_id uuid;
begin
  select tenant_id
  into v_post_tenant_id
  from public.community_posts
  where id = new.post_id;

  if v_post_tenant_id is null then
    raise exception 'Community post was not found.' using errcode = '23503';
  end if;

  if new.tenant_id <> v_post_tenant_id then
    raise exception 'Comment tenant must match the community post tenant.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists set_community_posts_updated_at on public.community_posts;
create trigger set_community_posts_updated_at
before update on public.community_posts
for each row execute function public.m76b_set_community_updated_at();

drop trigger if exists set_community_comments_updated_at on public.community_comments;
create trigger set_community_comments_updated_at
before update on public.community_comments
for each row execute function public.m76b_set_community_updated_at();

drop trigger if exists validate_community_comment_tenant on public.community_comments;
create trigger validate_community_comment_tenant
before insert or update on public.community_comments
for each row execute function public.m76b_validate_comment_tenant();

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;

revoke all on table public.community_posts from public, anon, authenticated;
revoke all on table public.community_comments from public, anon, authenticated;

create or replace function public.m76b_current_team_role(p_tenant_id uuid)
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
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
    and public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer'])
  limit 1
$$;

create or replace function public.m76b_assert_team_can_create(p_tenant_id uuid)
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

  if not public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer']) then
    raise exception 'Only team users can use community management.' using errcode = '42501';
  end if;

  v_role := public.m76b_current_team_role(p_tenant_id);

  if v_role is null then
    raise exception 'Only team users can use community management.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m76b_assert_team_can_moderate(p_tenant_id uuid)
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
    raise exception 'Only owner, admin, or staff users can moderate community content.' using errcode = '42501';
  end if;

  v_role := public.m76b_current_team_role(p_tenant_id);

  if v_role not in ('owner', 'admin', 'staff') then
    raise exception 'Only owner, admin, or staff users can moderate community content.' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.m76b_student_context()
returns table (
  tenant_id uuid,
  student_id uuid,
  user_id uuid,
  student_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select spa.tenant_id, spa.student_id, spa.user_id, s.full_name
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

create or replace function public.m76b_has_active_student_portal_tenant(p_tenant_id uuid)
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

create or replace function public.m76b_validate_text(
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

create or replace function public.m76b_normalize_post_type(p_post_type text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_type text := lower(trim(coalesce(p_post_type, 'discussion')));
begin
  if v_post_type not in ('discussion', 'question', 'resource', 'update') then
    raise exception 'Community post type is invalid.' using errcode = '22023';
  end if;

  return v_post_type;
end;
$$;

drop policy if exists "Team can read community posts" on public.community_posts;
create policy "Team can read community posts"
on public.community_posts
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer']));

drop policy if exists "Students can read published community posts" on public.community_posts;
create policy "Students can read published community posts"
on public.community_posts
for select
to authenticated
using (
  status = 'published'
  and audience_type = 'all_students'
  and published_at is not null
  and public.m76b_has_active_student_portal_tenant(tenant_id)
);

drop policy if exists "Team can insert community posts" on public.community_posts;
create policy "Team can insert community posts"
on public.community_posts
for insert
to authenticated
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer'])
  and audience_type = 'all_students'
);

drop policy if exists "Team can update community posts" on public.community_posts;
create policy "Team can update community posts"
on public.community_posts
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer']))
with check (
  public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer'])
  and audience_type = 'all_students'
);

drop policy if exists "Team can read community comments" on public.community_comments;
create policy "Team can read community comments"
on public.community_comments
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer']));

drop policy if exists "Students can read published community comments" on public.community_comments;
create policy "Students can read published community comments"
on public.community_comments
for select
to authenticated
using (
  status = 'published'
  and public.m76b_has_active_student_portal_tenant(tenant_id)
  and exists (
    select 1
    from public.community_posts cp
    where cp.id = community_comments.post_id
      and cp.tenant_id = community_comments.tenant_id
      and cp.status = 'published'
      and cp.audience_type = 'all_students'
      and cp.published_at is not null
  )
);

drop policy if exists "Team can insert community comments" on public.community_comments;
create policy "Team can insert community comments"
on public.community_comments
for insert
to authenticated
with check (
  author_type = 'team'
  and public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff', 'trainer'])
);

drop policy if exists "Students can insert community comments" on public.community_comments;
create policy "Students can insert community comments"
on public.community_comments
for insert
to authenticated
with check (
  author_type = 'student'
  and public.m76b_has_active_student_portal_tenant(tenant_id)
);

drop policy if exists "Team can update community comments" on public.community_comments;
create policy "Team can update community comments"
on public.community_comments
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin', 'staff']));

create or replace function public.get_student_community_posts()
returns table (
  id uuid,
  tenant_id uuid,
  title text,
  body text,
  post_type text,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  comment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cp.id,
    cp.tenant_id,
    cp.title,
    cp.body,
    cp.post_type,
    cp.published_at,
    cp.created_at,
    cp.updated_at,
    (
      select count(*)
      from public.community_comments cc
      where cc.post_id = cp.id
        and cc.tenant_id = cp.tenant_id
        and cc.status = 'published'
    ) as comment_count
  from public.m76b_student_context() ctx
  join public.community_posts cp
    on cp.tenant_id = ctx.tenant_id
   and cp.status = 'published'
   and cp.audience_type = 'all_students'
   and cp.published_at is not null
  order by cp.published_at desc, cp.created_at desc
$$;

create or replace function public.get_student_community_comments(p_post_id uuid)
returns table (
  id uuid,
  post_id uuid,
  body text,
  author_type text,
  author_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cc.id,
    cc.post_id,
    cc.body,
    cc.author_type,
    case
      when cc.author_type = 'team' then 'Academy'
      else coalesce(s.full_name, 'Student')
    end as author_name,
    cc.created_at,
    cc.updated_at
  from public.m76b_student_context() ctx
  join public.community_posts cp
    on cp.id = p_post_id
   and cp.tenant_id = ctx.tenant_id
   and cp.status = 'published'
   and cp.audience_type = 'all_students'
   and cp.published_at is not null
  join public.community_comments cc
    on cc.post_id = cp.id
   and cc.tenant_id = cp.tenant_id
   and cc.status = 'published'
  left join public.students s
    on s.id = cc.created_by_student_id
   and s.tenant_id = cc.tenant_id
  order by cc.created_at asc
$$;

create or replace function public.create_student_community_comment(
  p_post_id uuid,
  p_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  ctx record;
  v_body text := public.m76b_validate_text(p_body, 'Comment', true, 3000);
  v_comment_id uuid;
  v_post public.community_posts%rowtype;
begin
  select *
  into ctx
  from public.m76b_student_context()
  limit 1;

  if ctx.student_id is null then
    raise exception 'Active student portal account required.' using errcode = '42501';
  end if;

  select *
  into v_post
  from public.community_posts
  where id = p_post_id
    and tenant_id = ctx.tenant_id
    and status = 'published'
    and audience_type = 'all_students'
    and published_at is not null;

  if not found then
    raise exception 'Community post is not available for commenting.' using errcode = '42501';
  end if;

  insert into public.community_comments (
    tenant_id,
    post_id,
    body,
    status,
    author_type,
    created_by_user_id,
    created_by_student_id
  )
  values (
    v_post.tenant_id,
    v_post.id,
    v_body,
    'published',
    'student',
    ctx.user_id,
    ctx.student_id
  )
  returning id into v_comment_id;

  return v_comment_id;
end;
$$;

create or replace function public.get_team_community_posts(p_tenant_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  title text,
  body text,
  status text,
  post_type text,
  audience_type text,
  published_at timestamptz,
  archived_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  comment_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.m76b_assert_team_can_create(p_tenant_id);

  return query
  select
    cp.id,
    cp.tenant_id,
    cp.title,
    cp.body,
    cp.status,
    cp.post_type,
    cp.audience_type,
    cp.published_at,
    cp.archived_at,
    cp.hidden_at,
    cp.created_at,
    cp.updated_at,
    (
      select count(*)
      from public.community_comments cc
      where cc.post_id = cp.id
        and cc.tenant_id = cp.tenant_id
    ) as comment_count
  from public.community_posts cp
  where cp.tenant_id = p_tenant_id
  order by
    case cp.status
      when 'published' then 1
      when 'draft' then 2
      when 'hidden' then 3
      else 4
    end,
    coalesce(cp.published_at, cp.created_at) desc,
    cp.created_at desc;
end;
$$;

create or replace function public.get_team_community_comments(p_post_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  post_id uuid,
  body text,
  status text,
  author_type text,
  author_name text,
  created_at timestamptz,
  updated_at timestamptz,
  hidden_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post public.community_posts%rowtype;
begin
  select *
  into v_post
  from public.community_posts
  where id = p_post_id;

  if not found then
    raise exception 'Community post not found.' using errcode = '22023';
  end if;

  perform public.m76b_assert_team_can_create(v_post.tenant_id);

  return query
  select
    cc.id,
    cc.tenant_id,
    cc.post_id,
    cc.body,
    cc.status,
    cc.author_type,
    case
      when cc.author_type = 'team' then 'Academy'
      else coalesce(s.full_name, 'Student')
    end as author_name,
    cc.created_at,
    cc.updated_at,
    cc.hidden_at
  from public.community_comments cc
  left join public.students s
    on s.id = cc.created_by_student_id
   and s.tenant_id = cc.tenant_id
  where cc.post_id = v_post.id
    and cc.tenant_id = v_post.tenant_id
  order by cc.created_at asc;
end;
$$;

create or replace function public.create_team_community_post(
  p_tenant_id uuid,
  p_title text,
  p_body text,
  p_post_type text default 'discussion'
)
returns public.community_posts
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_body text := public.m76b_validate_text(p_body, 'Community post body', true, 6000);
  v_post public.community_posts%rowtype;
  v_post_type text := public.m76b_normalize_post_type(p_post_type);
  v_title text := public.m76b_validate_text(p_title, 'Community post title', true, 180);
begin
  perform public.m76b_assert_team_can_create(p_tenant_id);

  insert into public.community_posts (
    tenant_id,
    title,
    body,
    status,
    post_type,
    audience_type,
    created_by_user_id
  )
  values (
    p_tenant_id,
    v_title,
    v_body,
    'draft',
    v_post_type,
    'all_students',
    auth.uid()
  )
  returning * into v_post;

  return v_post;
end;
$$;

create or replace function public.update_team_community_post(
  p_post_id uuid,
  p_title text,
  p_body text,
  p_post_type text default 'discussion'
)
returns public.community_posts
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_body text := public.m76b_validate_text(p_body, 'Community post body', true, 6000);
  v_existing public.community_posts%rowtype;
  v_post public.community_posts%rowtype;
  v_post_type text := public.m76b_normalize_post_type(p_post_type);
  v_role text;
  v_title text := public.m76b_validate_text(p_title, 'Community post title', true, 180);
begin
  select *
  into v_existing
  from public.community_posts
  where id = p_post_id;

  if not found then
    raise exception 'Community post not found.' using errcode = '22023';
  end if;

  if v_existing.status in ('archived', 'hidden') then
    raise exception 'Archived or hidden community posts cannot be edited.' using errcode = '22023';
  end if;

  v_role := public.m76b_assert_team_can_create(v_existing.tenant_id);

  if v_existing.status = 'published' and v_role not in ('owner', 'admin', 'staff') then
    raise exception 'Only owner, admin, or staff users can edit published community posts.' using errcode = '42501';
  end if;

  update public.community_posts cp
  set title = v_title,
      body = v_body,
      post_type = v_post_type
  where cp.id = v_existing.id
  returning * into v_post;

  return v_post;
end;
$$;

create or replace function public.publish_community_post(p_post_id uuid)
returns public.community_posts
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_existing public.community_posts%rowtype;
  v_post public.community_posts%rowtype;
begin
  select *
  into v_existing
  from public.community_posts
  where id = p_post_id;

  if not found then
    raise exception 'Community post not found.' using errcode = '22023';
  end if;

  perform public.m76b_assert_team_can_moderate(v_existing.tenant_id);

  if v_existing.status in ('archived', 'hidden') then
    raise exception 'Archived or hidden community posts cannot be published.' using errcode = '22023';
  end if;

  update public.community_posts cp
  set status = 'published',
      published_at = coalesce(cp.published_at, now()),
      archived_at = null,
      hidden_at = null
  where cp.id = v_existing.id
  returning * into v_post;

  return v_post;
end;
$$;

create or replace function public.archive_community_post(p_post_id uuid)
returns public.community_posts
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_existing public.community_posts%rowtype;
  v_post public.community_posts%rowtype;
begin
  select *
  into v_existing
  from public.community_posts
  where id = p_post_id;

  if not found then
    raise exception 'Community post not found.' using errcode = '22023';
  end if;

  perform public.m76b_assert_team_can_moderate(v_existing.tenant_id);

  update public.community_posts cp
  set status = 'archived',
      archived_at = now()
  where cp.id = v_existing.id
  returning * into v_post;

  return v_post;
end;
$$;

create or replace function public.hide_community_post(p_post_id uuid)
returns public.community_posts
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_existing public.community_posts%rowtype;
  v_post public.community_posts%rowtype;
begin
  select *
  into v_existing
  from public.community_posts
  where id = p_post_id;

  if not found then
    raise exception 'Community post not found.' using errcode = '22023';
  end if;

  perform public.m76b_assert_team_can_moderate(v_existing.tenant_id);

  update public.community_posts cp
  set status = 'hidden',
      hidden_at = now()
  where cp.id = v_existing.id
  returning * into v_post;

  return v_post;
end;
$$;

create or replace function public.create_team_community_comment(
  p_post_id uuid,
  p_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_body text := public.m76b_validate_text(p_body, 'Comment', true, 3000);
  v_comment_id uuid;
  v_post public.community_posts%rowtype;
begin
  select *
  into v_post
  from public.community_posts
  where id = p_post_id;

  if not found then
    raise exception 'Community post not found.' using errcode = '22023';
  end if;

  perform public.m76b_assert_team_can_create(v_post.tenant_id);

  if v_post.status in ('archived', 'hidden') then
    raise exception 'Archived or hidden posts cannot receive comments.' using errcode = '22023';
  end if;

  insert into public.community_comments (
    tenant_id,
    post_id,
    body,
    status,
    author_type,
    created_by_user_id
  )
  values (
    v_post.tenant_id,
    v_post.id,
    v_body,
    'published',
    'team',
    auth.uid()
  )
  returning id into v_comment_id;

  return v_comment_id;
end;
$$;

create or replace function public.hide_community_comment(p_comment_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_comment public.community_comments%rowtype;
begin
  select *
  into v_comment
  from public.community_comments
  where id = p_comment_id;

  if not found then
    raise exception 'Community comment not found.' using errcode = '22023';
  end if;

  perform public.m76b_assert_team_can_moderate(v_comment.tenant_id);

  update public.community_comments cc
  set status = 'hidden',
      hidden_by_user_id = auth.uid(),
      hidden_at = now()
  where cc.id = v_comment.id;

  return v_comment.id;
end;
$$;

revoke execute on function public.m76b_set_community_updated_at() from public, anon, authenticated;
revoke execute on function public.m76b_validate_comment_tenant() from public, anon, authenticated;
revoke execute on function public.m76b_current_team_role(uuid) from public, anon, authenticated;
revoke execute on function public.m76b_assert_team_can_create(uuid) from public, anon, authenticated;
revoke execute on function public.m76b_assert_team_can_moderate(uuid) from public, anon, authenticated;
revoke execute on function public.m76b_student_context() from public, anon, authenticated;
revoke execute on function public.m76b_has_active_student_portal_tenant(uuid) from public, anon;
revoke execute on function public.m76b_validate_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.m76b_normalize_post_type(text) from public, anon, authenticated;

revoke execute on function public.get_student_community_posts() from public, anon;
revoke execute on function public.get_student_community_comments(uuid) from public, anon;
revoke execute on function public.create_student_community_comment(uuid, text) from public, anon;
revoke execute on function public.get_team_community_posts(uuid) from public, anon;
revoke execute on function public.get_team_community_comments(uuid) from public, anon;
revoke execute on function public.create_team_community_post(uuid, text, text, text) from public, anon;
revoke execute on function public.update_team_community_post(uuid, text, text, text) from public, anon;
revoke execute on function public.publish_community_post(uuid) from public, anon;
revoke execute on function public.archive_community_post(uuid) from public, anon;
revoke execute on function public.hide_community_post(uuid) from public, anon;
revoke execute on function public.create_team_community_comment(uuid, text) from public, anon;
revoke execute on function public.hide_community_comment(uuid) from public, anon;

grant execute on function public.get_student_community_posts() to authenticated;
grant execute on function public.get_student_community_comments(uuid) to authenticated;
grant execute on function public.create_student_community_comment(uuid, text) to authenticated;
grant execute on function public.get_team_community_posts(uuid) to authenticated;
grant execute on function public.get_team_community_comments(uuid) to authenticated;
grant execute on function public.create_team_community_post(uuid, text, text, text) to authenticated;
grant execute on function public.update_team_community_post(uuid, text, text, text) to authenticated;
grant execute on function public.publish_community_post(uuid) to authenticated;
grant execute on function public.archive_community_post(uuid) to authenticated;
grant execute on function public.hide_community_post(uuid) to authenticated;
grant execute on function public.create_team_community_comment(uuid, text) to authenticated;
grant execute on function public.hide_community_comment(uuid) to authenticated;
grant execute on function public.m76b_has_active_student_portal_tenant(uuid) to authenticated;

commit;

-- Verification queries for manual review after approved execution:
--
-- 1. Tables exist and RLS is enabled:
-- select relname, relrowsecurity
-- from pg_class
-- where oid in (
--   'public.community_posts'::regclass,
--   'public.community_comments'::regclass
-- )
-- order by relname;
--
-- 2. Expected constraints exist:
-- select conname
-- from pg_constraint
-- where conrelid in (
--   'public.community_posts'::regclass,
--   'public.community_comments'::regclass
-- )
--   and conname like 'community_%'
-- order by conname;
--
-- 3. Expected indexes exist:
-- select indexname
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('community_posts', 'community_comments')
-- order by tablename, indexname;
--
-- 4. Expected policies exist:
-- select tablename, policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('community_posts', 'community_comments')
-- order by tablename, policyname;
--
-- 5. Expected RPCs are SECURITY DEFINER:
-- select proname, prosecdef
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in (
--     'get_student_community_posts',
--     'get_student_community_comments',
--     'create_student_community_comment',
--     'get_team_community_posts',
--     'get_team_community_comments',
--     'create_team_community_post',
--     'update_team_community_post',
--     'publish_community_post',
--     'archive_community_post',
--     'hide_community_post',
--     'create_team_community_comment',
--     'hide_community_comment'
--   )
-- order by proname;
--
-- 6. RPC grants are authenticated-only:
-- select routine_name, privilege_type, grantee
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name like '%community%'
-- order by routine_name, grantee;
--
-- 7. Direct table grants are revoked:
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('community_posts', 'community_comments')
--   and grantee in ('anon', 'authenticated', 'public')
-- order by table_name, grantee, privilege_type;
--
-- 8. Existing communication modules remain separate:
-- select to_regclass('public.academy_announcements') as announcements_table,
--        to_regclass('public.conversation_threads') as chat_threads_table,
--        to_regclass('public.notifications') as notifications_table;
