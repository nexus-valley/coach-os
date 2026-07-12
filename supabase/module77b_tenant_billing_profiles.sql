-- Module 77B: Tenant Billing Profile SQL/RLS Foundation
-- Proposal only. Review before execution. Do not run until approved.
--
-- MVP scope:
-- - Dedicated tenant billing profile data for future invoices, receipts,
--   GST/tax details, renewal/payment support, and eventual Razorpay readiness.
-- - Owner/admin users can view and edit their tenant billing profile.
-- - No student, staff, trainer, public, or anonymous access in MVP.
-- - No checkout, payment activation, plan/pricing/catalog, Razorpay, or tenant
--   finance behavior is changed by this SQL.

begin;

create table if not exists public.tenant_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  legal_name text,
  billing_email text,
  billing_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  tax_id text,
  preferred_currency text not null default 'INR',
  invoice_contact_name text,
  billing_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_legal_name_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_legal_name_check
    check (
      legal_name is null
      or (char_length(legal_name) <= 180 and legal_name !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_billing_email_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_billing_email_check
    check (
      billing_email is null
      or (
        char_length(billing_email) <= 254
        and billing_email !~ '[<>]'
        and billing_email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
      )
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_billing_phone_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_billing_phone_check
    check (
      billing_phone is null
      or (char_length(billing_phone) <= 40 and billing_phone !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_address_line1_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_address_line1_check
    check (
      address_line1 is null
      or (char_length(address_line1) <= 240 and address_line1 !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_address_line2_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_address_line2_check
    check (
      address_line2 is null
      or (char_length(address_line2) <= 240 and address_line2 !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_city_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_city_check
    check (
      city is null
      or (char_length(city) <= 120 and city !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_state_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_state_check
    check (
      state is null
      or (char_length(state) <= 120 and state !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_postal_code_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_postal_code_check
    check (
      postal_code is null
      or (char_length(postal_code) <= 40 and postal_code !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_country_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_country_check
    check (
      country is null
      or (char_length(country) <= 120 and country !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_tax_id_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_tax_id_check
    check (
      tax_id is null
      or (char_length(tax_id) <= 40 and tax_id !~ '[<>]')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_preferred_currency_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_preferred_currency_check
    check (preferred_currency in ('INR', 'USD'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_invoice_contact_name_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_invoice_contact_name_check
    check (
      invoice_contact_name is null
      or (
        char_length(invoice_contact_name) <= 180
        and invoice_contact_name !~ '[<>]'
      )
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_billing_profiles_billing_notes_check'
      and conrelid = 'public.tenant_billing_profiles'::regclass
  ) then
    alter table public.tenant_billing_profiles
    add constraint tenant_billing_profiles_billing_notes_check
    check (
      billing_notes is null
      or (char_length(billing_notes) <= 2000 and billing_notes !~ '[<>]')
    );
  end if;
end $$;

create index if not exists tenant_billing_profiles_tenant_idx
on public.tenant_billing_profiles (tenant_id);

create index if not exists tenant_billing_profiles_updated_idx
on public.tenant_billing_profiles (updated_at desc);

create index if not exists tenant_billing_profiles_currency_idx
on public.tenant_billing_profiles (preferred_currency);

create or replace function public.m77b_set_tenant_billing_profiles_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tenant_billing_profiles_updated_at
on public.tenant_billing_profiles;
create trigger set_tenant_billing_profiles_updated_at
before update on public.tenant_billing_profiles
for each row execute function public.m77b_set_tenant_billing_profiles_updated_at();

alter table public.tenant_billing_profiles enable row level security;

revoke all on table public.tenant_billing_profiles from public, anon, authenticated;

create or replace function public.m77b_assert_billing_profile_access(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Workspace is required.' using errcode = '22023';
  end if;

  if not public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin']) then
    raise exception 'Only owner or admin users can manage billing profiles.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.m77b_validate_billing_text(
  p_value text,
  p_label text,
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
  if v_value is not null and char_length(v_value) > p_max_length then
    raise exception '% is too long.', p_label using errcode = '22023';
  end if;

  if v_value is not null and (position('<' in v_value) > 0 or position('>' in v_value) > 0) then
    raise exception '% cannot contain HTML-like characters.', p_label using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function public.m77b_validate_billing_email(p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := public.m77b_validate_billing_text(p_value, 'Billing email', 254);
begin
  if v_email is not null and v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'Billing email must be a valid email address.' using errcode = '22023';
  end if;

  return lower(v_email);
end;
$$;

create or replace function public.m77b_validate_currency(p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text := upper(nullif(trim(coalesce(p_value, '')), ''));
begin
  if v_currency is null then
    v_currency := 'INR';
  end if;

  if v_currency not in ('INR', 'USD') then
    raise exception 'Preferred currency is not supported.' using errcode = '22023';
  end if;

  return v_currency;
end;
$$;

drop policy if exists "Owner and admin can read tenant billing profiles"
on public.tenant_billing_profiles;
create policy "Owner and admin can read tenant billing profiles"
on public.tenant_billing_profiles
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can insert tenant billing profiles"
on public.tenant_billing_profiles;
create policy "Owner and admin can insert tenant billing profiles"
on public.tenant_billing_profiles
for insert
to authenticated
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

drop policy if exists "Owner and admin can update tenant billing profiles"
on public.tenant_billing_profiles;
create policy "Owner and admin can update tenant billing profiles"
on public.tenant_billing_profiles
for update
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']))
with check (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

create or replace function public.get_tenant_billing_profile(p_tenant_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  legal_name text,
  billing_email text,
  billing_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  tax_id text,
  preferred_currency text,
  invoice_contact_name text,
  billing_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.m77b_assert_billing_profile_access(p_tenant_id);

  if exists (
    select 1
    from public.tenant_billing_profiles tbp
    where tbp.tenant_id = p_tenant_id
  ) then
    return query
    select
      tbp.id,
      tbp.tenant_id,
      tbp.legal_name,
      tbp.billing_email,
      tbp.billing_phone,
      tbp.address_line1,
      tbp.address_line2,
      tbp.city,
      tbp.state,
      tbp.postal_code,
      tbp.country,
      tbp.tax_id,
      tbp.preferred_currency,
      tbp.invoice_contact_name,
      tbp.billing_notes,
      tbp.created_at,
      tbp.updated_at,
      tbp.updated_by
    from public.tenant_billing_profiles tbp
    where tbp.tenant_id = p_tenant_id;

    return;
  end if;

  return query
  select
    null::uuid as id,
    p_tenant_id as tenant_id,
    null::text as legal_name,
    null::text as billing_email,
    null::text as billing_phone,
    null::text as address_line1,
    null::text as address_line2,
    null::text as city,
    null::text as state,
    null::text as postal_code,
    null::text as country,
    null::text as tax_id,
    'INR'::text as preferred_currency,
    null::text as invoice_contact_name,
    null::text as billing_notes,
    null::timestamptz as created_at,
    null::timestamptz as updated_at,
    null::uuid as updated_by;
end;
$$;

create or replace function public.upsert_tenant_billing_profile(
  p_tenant_id uuid,
  p_legal_name text default null,
  p_billing_email text default null,
  p_billing_phone text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country text default null,
  p_tax_id text default null,
  p_preferred_currency text default 'INR',
  p_invoice_contact_name text default null,
  p_billing_notes text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  legal_name text,
  billing_email text,
  billing_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  tax_id text,
  preferred_currency text,
  invoice_contact_name text,
  billing_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_legal_name text;
  v_billing_email text;
  v_billing_phone text;
  v_address_line1 text;
  v_address_line2 text;
  v_city text;
  v_state text;
  v_postal_code text;
  v_country text;
  v_tax_id text;
  v_preferred_currency text;
  v_invoice_contact_name text;
  v_billing_notes text;
begin
  perform public.m77b_assert_billing_profile_access(p_tenant_id);

  v_legal_name := public.m77b_validate_billing_text(p_legal_name, 'Legal name', 180);
  v_billing_email := public.m77b_validate_billing_email(p_billing_email);
  v_billing_phone := public.m77b_validate_billing_text(p_billing_phone, 'Billing phone', 40);
  v_address_line1 := public.m77b_validate_billing_text(p_address_line1, 'Address line 1', 240);
  v_address_line2 := public.m77b_validate_billing_text(p_address_line2, 'Address line 2', 240);
  v_city := public.m77b_validate_billing_text(p_city, 'City', 120);
  v_state := public.m77b_validate_billing_text(p_state, 'State', 120);
  v_postal_code := public.m77b_validate_billing_text(p_postal_code, 'Postal code', 40);
  v_country := public.m77b_validate_billing_text(p_country, 'Country', 120);
  v_tax_id := public.m77b_validate_billing_text(p_tax_id, 'Tax ID', 40);
  v_preferred_currency := public.m77b_validate_currency(p_preferred_currency);
  v_invoice_contact_name := public.m77b_validate_billing_text(p_invoice_contact_name, 'Invoice contact name', 180);
  v_billing_notes := public.m77b_validate_billing_text(p_billing_notes, 'Billing notes', 2000);

  insert into public.tenant_billing_profiles (
    tenant_id,
    legal_name,
    billing_email,
    billing_phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    tax_id,
    preferred_currency,
    invoice_contact_name,
    billing_notes,
    updated_by
  )
  values (
    p_tenant_id,
    v_legal_name,
    v_billing_email,
    v_billing_phone,
    v_address_line1,
    v_address_line2,
    v_city,
    v_state,
    v_postal_code,
    v_country,
    v_tax_id,
    v_preferred_currency,
    v_invoice_contact_name,
    v_billing_notes,
    auth.uid()
  )
  on conflict (tenant_id) do update
  set legal_name = excluded.legal_name,
      billing_email = excluded.billing_email,
      billing_phone = excluded.billing_phone,
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      city = excluded.city,
      state = excluded.state,
      postal_code = excluded.postal_code,
      country = excluded.country,
      tax_id = excluded.tax_id,
      preferred_currency = excluded.preferred_currency,
      invoice_contact_name = excluded.invoice_contact_name,
      billing_notes = excluded.billing_notes,
      updated_by = auth.uid()
  returning
    tenant_billing_profiles.id,
    tenant_billing_profiles.tenant_id,
    tenant_billing_profiles.legal_name,
    tenant_billing_profiles.billing_email,
    tenant_billing_profiles.billing_phone,
    tenant_billing_profiles.address_line1,
    tenant_billing_profiles.address_line2,
    tenant_billing_profiles.city,
    tenant_billing_profiles.state,
    tenant_billing_profiles.postal_code,
    tenant_billing_profiles.country,
    tenant_billing_profiles.tax_id,
    tenant_billing_profiles.preferred_currency,
    tenant_billing_profiles.invoice_contact_name,
    tenant_billing_profiles.billing_notes,
    tenant_billing_profiles.created_at,
    tenant_billing_profiles.updated_at,
    tenant_billing_profiles.updated_by
  into
    id,
    tenant_id,
    legal_name,
    billing_email,
    billing_phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    tax_id,
    preferred_currency,
    invoice_contact_name,
    billing_notes,
    created_at,
    updated_at,
    updated_by;

  return next;
end;
$$;

create or replace function public.get_tenant_billing_profile_completion(p_tenant_id uuid)
returns table (
  tenant_id uuid,
  is_complete boolean,
  missing_fields text[],
  completion_score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.tenant_billing_profiles%rowtype;
  v_missing text[] := array[]::text[];
  v_required_count integer := 8;
begin
  perform public.m77b_assert_billing_profile_access(p_tenant_id);

  select *
  into v_profile
  from public.tenant_billing_profiles tbp
  where tbp.tenant_id = p_tenant_id;

  if v_profile.tenant_id is null then
    v_missing := array[
      'legal_name',
      'billing_email',
      'address_line1',
      'city',
      'state',
      'postal_code',
      'country',
      'preferred_currency'
    ];
  else
    if nullif(trim(coalesce(v_profile.legal_name, '')), '') is null then
      v_missing := array_append(v_missing, 'legal_name');
    end if;

    if nullif(trim(coalesce(v_profile.billing_email, '')), '') is null then
      v_missing := array_append(v_missing, 'billing_email');
    end if;

    if nullif(trim(coalesce(v_profile.address_line1, '')), '') is null then
      v_missing := array_append(v_missing, 'address_line1');
    end if;

    if nullif(trim(coalesce(v_profile.city, '')), '') is null then
      v_missing := array_append(v_missing, 'city');
    end if;

    if nullif(trim(coalesce(v_profile.state, '')), '') is null then
      v_missing := array_append(v_missing, 'state');
    end if;

    if nullif(trim(coalesce(v_profile.postal_code, '')), '') is null then
      v_missing := array_append(v_missing, 'postal_code');
    end if;

    if nullif(trim(coalesce(v_profile.country, '')), '') is null then
      v_missing := array_append(v_missing, 'country');
    end if;

    if nullif(trim(coalesce(v_profile.preferred_currency, '')), '') is null then
      v_missing := array_append(v_missing, 'preferred_currency');
    end if;
  end if;

  return query
  select
    p_tenant_id,
    cardinality(v_missing) = 0,
    v_missing,
    greatest(
      0,
      least(
        100,
        round(((v_required_count - cardinality(v_missing))::numeric / v_required_count::numeric) * 100)::integer
      )
    );
end;
$$;

revoke execute on function public.m77b_set_tenant_billing_profiles_updated_at()
from public, anon, authenticated;
revoke execute on function public.m77b_assert_billing_profile_access(uuid)
from public, anon, authenticated;
revoke execute on function public.m77b_validate_billing_text(text, text, integer)
from public, anon, authenticated;
revoke execute on function public.m77b_validate_billing_email(text)
from public, anon, authenticated;
revoke execute on function public.m77b_validate_currency(text)
from public, anon, authenticated;

revoke execute on function public.get_tenant_billing_profile(uuid)
from public, anon;
revoke execute on function public.upsert_tenant_billing_profile(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
from public, anon;
revoke execute on function public.get_tenant_billing_profile_completion(uuid)
from public, anon;

grant execute on function public.get_tenant_billing_profile(uuid)
to authenticated;
grant execute on function public.upsert_tenant_billing_profile(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
to authenticated;
grant execute on function public.get_tenant_billing_profile_completion(uuid)
to authenticated;

commit;

-- Verification queries for reviewer/operator use only. Do not execute during
-- proposal creation.
--
-- 1. Confirm table exists and RLS is enabled:
-- select c.relname, c.relrowsecurity
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname = 'tenant_billing_profiles';
--
-- 2. Confirm constraints:
-- select conname
-- from pg_constraint
-- where conrelid = 'public.tenant_billing_profiles'::regclass
-- order by conname;
--
-- 3. Confirm indexes:
-- select indexname
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'tenant_billing_profiles'
-- order by indexname;
--
-- 4. Confirm policies:
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'tenant_billing_profiles'
-- order by policyname;
--
-- 5. Confirm RPCs are SECURITY DEFINER:
-- select p.proname, p.prosecdef
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in (
--     'get_tenant_billing_profile',
--     'upsert_tenant_billing_profile',
--     'get_tenant_billing_profile_completion'
--   )
-- order by p.proname;
--
-- 6. Confirm direct table access is not granted to authenticated:
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name = 'tenant_billing_profiles'
--   and grantee in ('public', 'anon', 'authenticated')
-- order by grantee, privilege_type;
--
-- 7. Confirm authenticated can execute public RPCs and anon cannot:
-- select routine_name, grantee, privilege_type
-- from information_schema.routine_privileges
-- where specific_schema = 'public'
--   and routine_name in (
--     'get_tenant_billing_profile',
--     'upsert_tenant_billing_profile',
--     'get_tenant_billing_profile_completion'
--   )
-- order by routine_name, grantee;
--
-- 8. Confirm payment/Razorpay/subscription activation behavior was not changed:
-- select to_regclass('public.payment_orders') as payment_orders,
--        to_regclass('public.payment_webhook_events') as payment_webhook_events,
--        to_regclass('public.tenant_plan_activation_events') as activation_events,
--        to_regclass('public.subscription_plan_prices') as plan_prices;
