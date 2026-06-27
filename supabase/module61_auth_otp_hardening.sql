-- Module 61: Signup OTP, forgot password, and password reset hardening
-- Additive auth OTP storage plus workspace creation guard.
-- Review before execution.

create table if not exists public.auth_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('signup_email_verification', 'password_reset')),
  email_normalized text not null,
  email_domain text,
  otp_hash text not null,
  verification_token_hash text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  verified_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  resend_count integer not null default 0 check (resend_count >= 0),
  last_sent_at timestamptz,
  locked_until timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 3000),
  created_ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_otp_email_safe_chk check (
    length(email_normalized) between 3 and 254
    and email_normalized = lower(email_normalized)
    and email_normalized !~ '[<>]'
  ),
  constraint auth_otp_domain_safe_chk check (
    email_domain is null
    or (length(email_domain) between 1 and 254 and email_domain = lower(email_domain) and email_domain !~ '[<>]')
  ),
  constraint auth_otp_hash_safe_chk check (length(otp_hash) between 32 and 256 and otp_hash !~ '[<>]'),
  constraint auth_otp_verification_token_hash_safe_chk check (
    verification_token_hash is null
    or (length(verification_token_hash) between 32 and 256 and verification_token_hash !~ '[<>]')
  ),
  constraint auth_otp_expiry_future_chk check (expires_at > created_at),
  constraint auth_otp_verified_after_created_chk check (verified_at is null or verified_at >= created_at),
  constraint auth_otp_consumed_after_created_chk check (consumed_at is null or consumed_at >= created_at),
  constraint auth_otp_completed_after_created_chk check (completed_at is null or completed_at >= created_at)
);

create table if not exists public.auth_otp_audit_logs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.auth_otp_challenges(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in (
      'signup_otp_requested',
      'signup_otp_verified',
      'password_reset_otp_requested',
      'password_reset_otp_verified',
      'password_reset_completed',
      'otp_failed_verification',
      'otp_rate_limited'
    )
  ),
  purpose text not null check (purpose in ('signup_email_verification', 'password_reset')),
  email_domain text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 2000),
  created_at timestamptz not null default now(),
  constraint auth_otp_audit_domain_safe_chk check (
    email_domain is null
    or (length(email_domain) between 1 and 254 and email_domain = lower(email_domain) and email_domain !~ '[<>]')
  )
);

create index if not exists auth_otp_challenges_purpose_email_created_idx
on public.auth_otp_challenges (purpose, email_normalized, created_at desc);

create index if not exists auth_otp_challenges_expires_at_idx
on public.auth_otp_challenges (expires_at);

create index if not exists auth_otp_challenges_consumed_at_idx
on public.auth_otp_challenges (consumed_at);

create index if not exists auth_otp_challenges_locked_until_idx
on public.auth_otp_challenges (locked_until);

create index if not exists auth_otp_challenges_verification_token_hash_idx
on public.auth_otp_challenges (verification_token_hash)
where verification_token_hash is not null;

create index if not exists auth_otp_audit_logs_created_idx
on public.auth_otp_audit_logs (created_at desc);

create index if not exists auth_otp_audit_logs_action_idx
on public.auth_otp_audit_logs (action, created_at desc);

alter table public.auth_otp_challenges enable row level security;
alter table public.auth_otp_audit_logs enable row level security;

revoke all on public.auth_otp_challenges from anon, authenticated;
revoke all on public.auth_otp_audit_logs from anon, authenticated;

grant all on public.auth_otp_challenges to service_role;
grant all on public.auth_otp_audit_logs to service_role;

create or replace function public.auth_otp_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_auth_otp_challenges_updated_at on public.auth_otp_challenges;
create trigger set_auth_otp_challenges_updated_at
before update on public.auth_otp_challenges
for each row execute function public.auth_otp_touch_updated_at();

create or replace function public.auth_otp_can_create_workspace()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  auth_provider text := lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', ''));
begin
  if current_user_id is null then
    return false;
  end if;

  if auth_provider = 'google' then
    return true;
  end if;

  if current_email = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.auth_otp_challenges challenge
    where challenge.purpose = 'signup_email_verification'
      and challenge.email_normalized = current_email
      and challenge.consumed_at is not null
      and challenge.verified_at is not null
      and challenge.completed_at is null
      and challenge.expires_at >= now()
      and challenge.created_at >= now() - interval '24 hours'
  );
end;
$$;

create or replace function public.auth_otp_assert_workspace_creation_allowed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.auth_otp_can_create_workspace(), false) then
    raise exception 'Email verification is required before workspace creation.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.auth_otp_user_has_existing_workspace(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    check_user_id is not null
    and auth.uid() is not null
    and check_user_id = auth.uid()
    and (
      exists (
        select 1
        from public.tenant_members tm
        where tm.user_id = check_user_id
      )
      or exists (
        select 1
        from public.tenants t
        where t.owner_user_id = check_user_id
      )
    ),
    false
  );
$$;

create or replace function public.create_workspace_with_owner(
  workspace_name text,
  workspace_slug text,
  workspace_category text
)
returns table (
  id uuid,
  name text,
  slug text,
  category text,
  owner_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requesting_user uuid := auth.uid();
  normalized_name text := nullif(trim(workspace_name), '');
  normalized_slug text := nullif(trim(workspace_slug), '');
  candidate_slug text;
  created_tenant public.tenants%rowtype;
  suffix text;
  attempt integer := 0;
begin
  if requesting_user is null then
    raise exception 'You must be logged in to create a workspace.'
      using errcode = '28000';
  end if;

  if normalized_name is null then
    raise exception 'Workspace name is required.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user::text, 0));

  select t.*
  into created_tenant
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = requesting_user
  order by tm.created_at asc
  limit 1;

  if found then
    return query
    select
      created_tenant.id,
      created_tenant.name,
      created_tenant.slug,
      created_tenant.category,
      created_tenant.owner_user_id;
    return;
  end if;

  select t.*
  into created_tenant
  from public.tenants t
  where t.owner_user_id = requesting_user
  order by t.created_at asc
  limit 1;

  if found then
    insert into public.tenant_members (tenant_id, user_id, role)
    values (created_tenant.id, requesting_user, 'owner')
    on conflict (tenant_id, user_id) do update
    set role = 'owner';

    return query
    select
      created_tenant.id,
      created_tenant.name,
      created_tenant.slug,
      created_tenant.category,
      created_tenant.owner_user_id;
    return;
  end if;

  perform public.auth_otp_assert_workspace_creation_allowed();

  candidate_slug := coalesce(normalized_slug, 'workspace');

  loop
    begin
      insert into public.tenants (name, slug, category, owner_user_id)
      values (normalized_name, candidate_slug, workspace_category, requesting_user)
      returning * into created_tenant;

      insert into public.tenant_members (tenant_id, user_id, role)
      values (created_tenant.id, requesting_user, 'owner')
      on conflict (tenant_id, user_id) do update
      set role = 'owner';

      if lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '')) <> 'google' then
        update public.auth_otp_challenges challenge
        set completed_at = now()
        where challenge.id = (
          select latest.id
          from public.auth_otp_challenges latest
          where latest.purpose = 'signup_email_verification'
            and latest.email_normalized = lower(coalesce(auth.jwt() ->> 'email', ''))
            and latest.verified_at is not null
            and latest.consumed_at is not null
            and latest.completed_at is null
            and latest.expires_at >= now()
          order by latest.verified_at desc
          limit 1
        );
      end if;

      return query
      select
        created_tenant.id,
        created_tenant.name,
        created_tenant.slug,
        created_tenant.category,
        created_tenant.owner_user_id;
      return;
    exception
      when unique_violation then
        attempt := attempt + 1;

        if attempt > 5 then
          raise;
        end if;

        suffix := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
        candidate_slug := left(coalesce(normalized_slug, 'workspace'), 42) || '-' || suffix;
    end;
  end loop;
end;
$$;

drop policy if exists "Authenticated users can create tenants" on public.tenants;
create policy "Authenticated users can create tenants"
on public.tenants
for insert
to authenticated
with check (
  owner_user_id = auth.uid()
  and public.auth_otp_can_create_workspace()
  and not public.auth_otp_user_has_existing_workspace(auth.uid())
);

drop policy if exists "Users can create their owner membership during onboarding" on public.tenant_members;
create policy "Users can create their owner membership during onboarding"
on public.tenant_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'owner'
  and public.user_owns_tenant(tenant_id, auth.uid())
  and public.auth_otp_can_create_workspace()
);

revoke execute on function public.auth_otp_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.auth_otp_can_create_workspace() from public, anon, authenticated;
revoke execute on function public.auth_otp_assert_workspace_creation_allowed() from public, anon, authenticated;
revoke execute on function public.auth_otp_user_has_existing_workspace(uuid) from public, anon, authenticated;
revoke execute on function public.create_workspace_with_owner(text, text, text) from public, anon;
grant execute on function public.auth_otp_can_create_workspace() to authenticated;
grant execute on function public.auth_otp_user_has_existing_workspace(uuid) to authenticated;
grant execute on function public.create_workspace_with_owner(text, text, text) to authenticated;
