-- Bundle UX-8D: International Billing Profile Consolidation
-- Review before execution. Do not execute automatically.
--
-- Purpose:
-- - Keep public.tenant_billing_profiles as the canonical CoachFort subscription
--   billing identity.
-- - Normalize authoritative billing country to an ISO-style supported country
--   code and derive/validate INR, EUR, or USD billing currency.
--   EUR is CoachFort's Europe commercial billing region, not a domestic
--   legal-tender or monetary-union country list.
-- - Add optional tax registration type without implementing tax calculation.
-- - Preserve Owner/Admin-only secure RPC access and leave payment activation,
--   Razorpay, invoices, receipts, Student Finance, and legacy tenant billing
--   fields unchanged.

/*
PRE-APPLY READ-ONLY VERIFICATION

with
profile_columns as (
  select
    column_name,
    data_type,
    is_nullable,
    column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tenant_billing_profiles'
),
legacy_tenant_billing_columns as (
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tenants'
    and column_name in (
      'billing_status',
      'billing_email',
      'billing_gst_number',
      'billing_address_json'
    )
),
supported_country_codes as (
  select array[
    'AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX',
    'AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO',
    'BQ','BR','BS','BT','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI',
    'CK','CL','CM','CN','CO','CR','CV','CW','CX','CY','CZ','DE','DJ','DK',
    'DM','DO','DZ','EC','EE','EG','ER','ES','ET','FI','FJ','FK','FM','FO',
    'FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ',
    'GR','GT','GU','GW','GY','HK','HN','HR','HT','HU','ID','IE','IL','IM',
    'IN','IO','IQ','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM',
    'KN','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU',
    'LV','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP',
    'MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF',
    'NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH',
    'PK','PL','PM','PR','PS','PT','PW','PY','QA','RE','RO','RS','RW','SA',
    'SB','SC','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
    'ST','SV','SX','SZ','TC','TD','TG','TH','TJ','TK','TL','TM','TN','TO',
    'TR','TT','TV','TW','TZ','UA','UG','US','UY','UZ','VA','VC','VE','VG',
    'VI','VN','VU','WF','WS','XK','YE','YT','ZA','ZM','ZW'
  ]::text[] as codes
),
eur_commercial_country_codes as (
  select array[
    'AD','AT','AX','BE','BG','CH','CY','CZ','DE','DK','EE','ES','FI','FO',
    'FR','GB','GG','GI','GR','HR','HU','IE','IM','IS','IT','JE','LI','LT',
    'LU','LV','MC','MT','NL','NO','PL','PT','RO','SE','SI','SK','SM','VA'
  ]::text[] as codes
),
profile_classification as (
  select
    count(*)::integer as profiles_total,
    count(*) filter (where nullif(trim(coalesce(country, '')), '') is null)::integer as null_country,
    count(*) filter (
      where nullif(trim(coalesce(country, '')), '') is not null
        and upper(trim(country)) !~ '^[A-Z]{2}$'
    )::integer as free_text_country_rows,
    count(*) filter (where preferred_currency not in ('INR', 'USD', 'EUR'))::integer as unsupported_currency_rows,
    count(*) filter (
      where nullif(trim(coalesce(country, '')), '') is not null
        and not ((
          case
            when upper(trim(country)) ~ '^[A-Z]{2}$' then upper(trim(country))
            when lower(trim(country)) in ('india', 'bharat') then 'IN'
            when lower(trim(country)) in ('united states', 'united states of america', 'usa') then 'US'
            when lower(trim(country)) in ('united kingdom', 'great britain', 'uk') then 'GB'
            when lower(trim(country)) = 'germany' then 'DE'
            when lower(trim(country)) = 'france' then 'FR'
            when lower(trim(country)) = 'spain' then 'ES'
            when lower(trim(country)) = 'italy' then 'IT'
            when lower(trim(country)) = 'netherlands' then 'NL'
            when lower(trim(country)) = 'ireland' then 'IE'
            when lower(trim(country)) = 'canada' then 'CA'
            when lower(trim(country)) = 'australia' then 'AU'
            when lower(trim(country)) = 'singapore' then 'SG'
            else country
          end
        ) in (select unnest(codes) from supported_country_codes))
    )::integer as unsupported_country_rows,
    count(*) filter (
      where nullif(trim(coalesce(country, '')), '') is null
        and preferred_currency is not null
    )::integer as null_country_non_null_currency_rows,
    count(*) filter (
      where nullif(trim(coalesce(country, '')), '') is not null
        and upper(trim(country)) ~ '^[A-Z]{2}$'
        and (
          upper(trim(country)) = 'IN'
          or upper(trim(country)) in (select unnest(codes) from eur_commercial_country_codes)
          or upper(trim(country)) ~ '^[A-Z]{2}$'
        )
        and preferred_currency is not null
        and preferred_currency is distinct from case
          when upper(trim(country)) = 'IN' then 'INR'
          when upper(trim(country)) in (select unnest(codes) from eur_commercial_country_codes) then 'EUR'
          else 'USD'
        end
    )::integer as existing_country_currency_mismatch_rows,
    count(*) filter (
      where nullif(trim(coalesce(tax_id, '')), '') is not null
    )::integer as non_empty_tax_id_rows,
    jsonb_object_agg(preferred_currency, currency_count) filter (where preferred_currency is not null) as currency_counts
  from (
    select tbp.*, count(*) over (partition by preferred_currency) as currency_count
    from public.tenant_billing_profiles tbp
  ) counted
),
legacy_population as (
  select
    count(*) filter (where nullif(trim(coalesce(billing_email, '')), '') is not null)::integer as tenants_with_legacy_billing_email,
    count(*) filter (where nullif(trim(coalesce(billing_gst_number, '')), '') is not null)::integer as tenants_with_legacy_gst,
    count(*) filter (where billing_address_json is not null and billing_address_json <> '{}'::jsonb)::integer as tenants_with_legacy_address
  from public.tenants
),
plan_currency_region as (
  select
    currency,
    region_code,
    count(*)::integer as price_rows
  from public.subscription_plan_prices
  group by currency, region_code
),
rpc_state as (
  select
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_args,
    p.prosecdef,
    p.provolatile,
    pg_get_userbyid(p.proowner) as owner,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_tenant_billing_profile',
      'upsert_tenant_billing_profile',
      'get_tenant_billing_profile_completion'
    )
),
direct_grants as (
  select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'tenant_billing_profiles'
    and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')
),
browser_writes as (
  select count(*)::integer as count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'tenant_billing_profiles'
    and grantee in ('PUBLIC', 'public', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
)
select jsonb_build_object(
  'tenant_billing_profiles_exists', to_regclass('public.tenant_billing_profiles') is not null,
  'profile_columns', (select jsonb_agg(to_jsonb(profile_columns) order by column_name) from profile_columns),
  'legacy_tenant_billing_columns', (select jsonb_agg(to_jsonb(legacy_tenant_billing_columns) order by column_name) from legacy_tenant_billing_columns),
  'profile_classification', (select to_jsonb(profile_classification) from profile_classification),
  'legacy_population', (select to_jsonb(legacy_population) from legacy_population),
  'plan_currency_region', (select jsonb_agg(to_jsonb(plan_currency_region) order by currency, region_code) from plan_currency_region),
  'rpc_state', (select jsonb_agg(to_jsonb(rpc_state) order by proname, identity_args) from rpc_state),
  'direct_grants', (select coalesce(jsonb_agg(to_jsonb(direct_grants) order by grantee, privilege_type), '[]'::jsonb) from direct_grants),
  'browser_write_grants', (select count from browser_writes),
  'conflicting_tax_type_column', exists (select 1 from profile_columns where column_name = 'tax_registration_type'),
  'existing_tax_type_shape', (
    select to_jsonb(pc)
    from profile_columns pc
    where pc.column_name = 'tax_registration_type'
  ),
  'conflicting_ux8d_helper_identities', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'identity_args', pg_get_function_identity_arguments(p.oid)
    ) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'billing_profile_supported_country_codes',
        'billing_profile_eur_country_codes',
        'billing_profile_currency_for_country',
        'm77b_validate_billing_country',
        'm77b_validate_tax_registration_type',
        'm77b_validate_currency',
        'm77b_validate_billing_country_currency'
      )
      and not (
        (p.proname in ('billing_profile_supported_country_codes', 'billing_profile_eur_country_codes') and pg_get_function_identity_arguments(p.oid) = '')
        or (p.proname in ('billing_profile_currency_for_country', 'm77b_validate_billing_country', 'm77b_validate_tax_registration_type', 'm77b_validate_currency') and pg_get_function_identity_arguments(p.oid) like 'p_% text')
        or (p.proname = 'm77b_validate_billing_country_currency' and pg_get_function_identity_arguments(p.oid) = 'p_country text, p_currency text')
      )
  )
) as ux8d_preflight;
*/

begin;

do $$
begin
  if to_regclass('public.tenant_billing_profiles') is null then
    raise exception 'tenant_billing_profiles is required.' using errcode = '42P01';
  end if;

  if to_regclass('public.tenants') is null then
    raise exception 'tenants table is required.' using errcode = '42P01';
  end if;

  if to_regclass('public.subscription_plan_prices') is null then
    raise exception 'subscription_plan_prices is required.' using errcode = '42P01';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'billing_profile_supported_country_codes',
        'billing_profile_eur_country_codes',
        'billing_profile_currency_for_country',
        'm77b_validate_billing_country',
        'm77b_validate_tax_registration_type',
        'm77b_validate_currency',
        'm77b_validate_billing_country_currency'
      )
      and not (
        (p.proname in ('billing_profile_supported_country_codes', 'billing_profile_eur_country_codes') and pg_get_function_identity_arguments(p.oid) = '')
        or (p.proname in ('billing_profile_currency_for_country', 'm77b_validate_billing_country', 'm77b_validate_tax_registration_type', 'm77b_validate_currency') and pg_get_function_identity_arguments(p.oid) like 'p_% text')
        or (p.proname = 'm77b_validate_billing_country_currency' and pg_get_function_identity_arguments(p.oid) = 'p_country text, p_currency text')
      )
  ) then
    raise exception 'conflicting UX-8D billing helper identity exists.' using errcode = '42710';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_tenant_billing_profile'
      and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid'
  ) then
    raise exception 'expected get_tenant_billing_profile identity is missing.' using errcode = '42883';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'upsert_tenant_billing_profile'
      and pg_get_function_identity_arguments(p.oid) in (
        'p_tenant_id uuid, p_legal_name text, p_billing_email text, p_billing_phone text, p_address_line1 text, p_address_line2 text, p_city text, p_state text, p_postal_code text, p_country text, p_tax_id text, p_preferred_currency text, p_invoice_contact_name text, p_billing_notes text',
        'p_tenant_id uuid, p_legal_name text, p_billing_email text, p_billing_phone text, p_address_line1 text, p_address_line2 text, p_city text, p_state text, p_postal_code text, p_country text, p_tax_id text, p_preferred_currency text, p_invoice_contact_name text, p_billing_notes text, p_tax_registration_type text'
      )
  ) then
    raise exception 'expected upsert_tenant_billing_profile identity is missing.' using errcode = '42883';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_tenant_billing_profile', 'upsert_tenant_billing_profile', 'get_tenant_billing_profile_completion')
      and not (
        (p.proname in ('get_tenant_billing_profile', 'get_tenant_billing_profile_completion') and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid')
        or (
          p.proname = 'upsert_tenant_billing_profile'
          and pg_get_function_identity_arguments(p.oid) in (
            'p_tenant_id uuid, p_legal_name text, p_billing_email text, p_billing_phone text, p_address_line1 text, p_address_line2 text, p_city text, p_state text, p_postal_code text, p_country text, p_tax_id text, p_preferred_currency text, p_invoice_contact_name text, p_billing_notes text',
            'p_tenant_id uuid, p_legal_name text, p_billing_email text, p_billing_phone text, p_address_line1 text, p_address_line2 text, p_city text, p_state text, p_postal_code text, p_country text, p_tax_id text, p_preferred_currency text, p_invoice_contact_name text, p_billing_notes text, p_tax_registration_type text'
          )
        )
      )
  ) then
    raise exception 'unexpected billing profile RPC overload exists.' using errcode = '42710';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_billing_profiles'
      and column_name = 'tax_registration_type'
      and not (
        data_type = 'text'
        and is_nullable = 'NO'
        and column_default = '''NONE''::text'
      )
  ) then
    raise exception 'unexpected tax_registration_type column shape exists.' using errcode = '42703';
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'tenant_billing_profiles'
      and con.conname in (
        'tenant_billing_profiles_country_check',
        'tenant_billing_profiles_preferred_currency_check',
        'tenant_billing_profiles_country_currency_check',
        'tenant_billing_profiles_tax_registration_type_check',
        'tenant_billing_profiles_tax_id_type_check'
      )
      and not (
        (con.conname = 'tenant_billing_profiles_country_check' and pg_get_constraintdef(con.oid) like '%country%')
        or (con.conname = 'tenant_billing_profiles_preferred_currency_check' and pg_get_constraintdef(con.oid) like '%preferred_currency%')
        or (con.conname = 'tenant_billing_profiles_country_currency_check' and pg_get_constraintdef(con.oid) like '%country%' and pg_get_constraintdef(con.oid) like '%preferred_currency%')
        or (con.conname = 'tenant_billing_profiles_tax_registration_type_check' and pg_get_constraintdef(con.oid) like '%tax_registration_type%')
        or (con.conname = 'tenant_billing_profiles_tax_id_type_check' and pg_get_constraintdef(con.oid) like '%tax_registration_type%' and pg_get_constraintdef(con.oid) like '%tax_id%')
      )
  ) then
    raise exception 'unexpected existing tenant_billing_profiles constraint definition; review before applying UX-8D.' using errcode = '42710';
  end if;
end $$;

create or replace function public.billing_profile_supported_country_codes()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    'AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX',
    'AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO',
    'BQ','BR','BS','BT','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI',
    'CK','CL','CM','CN','CO','CR','CV','CW','CX','CY','CZ','DE','DJ','DK',
    'DM','DO','DZ','EC','EE','EG','ER','ES','ET','FI','FJ','FK','FM','FO',
    'FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ',
    'GR','GT','GU','GW','GY','HK','HN','HR','HT','HU','ID','IE','IL','IM',
    'IN','IO','IQ','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM',
    'KN','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU',
    'LV','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP',
    'MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF',
    'NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH',
    'PK','PL','PM','PR','PS','PT','PW','PY','QA','RE','RO','RS','RW','SA',
    'SB','SC','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
    'ST','SV','SX','SZ','TC','TD','TG','TH','TJ','TK','TL','TM','TN','TO',
    'TR','TT','TV','TW','TZ','UA','UG','US','UY','UZ','VA','VC','VE','VG',
    'VI','VN','VU','WF','WS','XK','YE','YT','ZA','ZM','ZW'
  ]::text[];
$$;

create or replace function public.billing_profile_eur_country_codes()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  -- CoachFort's EUR commercial billing region. This is intentionally broader
  -- than domestic legal tender or monetary-union membership.
  select array[
    'AD','AT','AX','BE','BG','CH','CY','CZ','DE','DK','EE','ES','FI','FO',
    'FR','GB','GG','GI','GR','HR','HU','IE','IM','IS','IT','JE','LI','LT',
    'LU','LV','MC','MT','NL','NO','PL','PT','RO','SE','SI','SK','SM','VA'
  ]::text[];
$$;

create or replace function public.billing_profile_currency_for_country(p_country text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_country text := upper(nullif(trim(coalesce(p_country, '')), ''));
begin
  if v_country is null then
    return null;
  end if;

  if v_country = 'IN' then
    return 'INR';
  end if;

  if v_country = any(public.billing_profile_eur_country_codes()) then
    return 'EUR';
  end if;

  if v_country = any(public.billing_profile_supported_country_codes()) then
    return 'USD';
  end if;

  return null;
end;
$$;

create or replace function public.m77b_validate_billing_country(p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text := upper(nullif(trim(coalesce(p_value, '')), ''));
begin
  if v_country is null then
    return null;
  end if;

  if v_country !~ '^[A-Z]{2}$'
     or not (v_country = any(public.billing_profile_supported_country_codes())) then
    raise exception 'Billing country is not supported.' using errcode = '22023';
  end if;

  return v_country;
end;
$$;

create or replace function public.m77b_validate_tax_registration_type(p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := upper(nullif(trim(coalesce(p_value, '')), ''));
begin
  if v_type is null then
    return 'NONE';
  end if;

  if v_type not in ('NONE', 'GSTIN', 'VAT', 'OTHER') then
    raise exception 'Tax registration type is not supported.' using errcode = '22023';
  end if;

  return v_type;
end;
$$;

create or replace function public.m77b_validate_currency(p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_currency text := upper(nullif(trim(coalesce(p_value, '')), ''));
begin
  if v_currency is null then
    return null;
  end if;

  if v_currency not in ('INR', 'EUR', 'USD') then
    raise exception 'Preferred currency is not supported.' using errcode = '22023';
  end if;

  return v_currency;
end;
$$;

create or replace function public.m77b_validate_billing_country_currency(
  p_country text,
  p_currency text
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text := public.m77b_validate_billing_country(p_country);
  v_expected_currency text := public.billing_profile_currency_for_country(v_country);
  v_currency text := public.m77b_validate_currency(p_currency);
begin
  if v_country is null then
    if v_currency is not null then
      raise exception 'Billing country is required before billing currency.' using errcode = '22023';
    end if;

    return null;
  end if;

  if v_currency is null then
    return v_expected_currency;
  end if;

  if v_currency <> v_expected_currency then
    raise exception 'Billing currency must match billing country.' using errcode = '22023';
  end if;

  return v_currency;
end;
$$;

alter table public.tenant_billing_profiles
add column if not exists tax_registration_type text not null default 'NONE';

alter table public.tenant_billing_profiles
alter column preferred_currency drop not null;

alter table public.tenant_billing_profiles
alter column preferred_currency drop default;

with normalized as (
  select
    id,
    case
      when nullif(trim(coalesce(country, '')), '') is null then null
      when upper(trim(country)) ~ '^[A-Z]{2}$'
        and upper(trim(country)) = any(public.billing_profile_supported_country_codes())
        then upper(trim(country))
      when lower(trim(country)) in ('india', 'bharat') then 'IN'
      when lower(trim(country)) in ('united states', 'united states of america', 'usa') then 'US'
      when lower(trim(country)) in ('united kingdom', 'great britain', 'uk') then 'GB'
      when lower(trim(country)) = 'germany' then 'DE'
      when lower(trim(country)) = 'france' then 'FR'
      when lower(trim(country)) = 'spain' then 'ES'
      when lower(trim(country)) = 'italy' then 'IT'
      when lower(trim(country)) = 'netherlands' then 'NL'
      when lower(trim(country)) = 'ireland' then 'IE'
      when lower(trim(country)) = 'canada' then 'CA'
      when lower(trim(country)) = 'australia' then 'AU'
      when lower(trim(country)) = 'singapore' then 'SG'
      else country
    end as normalized_country
  from public.tenant_billing_profiles
)
update public.tenant_billing_profiles tbp
set country = normalized.normalized_country,
  preferred_currency = case
    when tbp.preferred_currency is null
      then public.billing_profile_currency_for_country(normalized.normalized_country)
    else tbp.preferred_currency
  end,
  tax_registration_type = case
    when nullif(trim(coalesce(tbp.tax_registration_type, '')), '') is not null
      and upper(trim(tbp.tax_registration_type)) in ('GSTIN', 'VAT', 'OTHER')
      then upper(trim(tbp.tax_registration_type))
    when nullif(trim(coalesce(tbp.tax_id, '')), '') is not null
      then 'OTHER'
    else 'NONE'
  end
from normalized
where normalized.id = tbp.id;

do $$
begin
  if exists (
    select 1
    from public.tenant_billing_profiles
    where country is not null
      and (
        country !~ '^[A-Z]{2}$'
        or public.billing_profile_currency_for_country(country) is null
      )
  ) then
    raise exception 'unsupported legacy billing country values remain; classify before applying UX-8D.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenant_billing_profiles
    where not (
      (country is null and preferred_currency is null)
      or (
        country is not null
        and preferred_currency is not null
        and preferred_currency = public.billing_profile_currency_for_country(country)
      )
    )
  ) then
    raise exception 'billing country/currency mismatch remains; classify before applying UX-8D.' using errcode = '22023';
  end if;
end $$;

alter table public.tenant_billing_profiles
drop constraint if exists tenant_billing_profiles_country_check;
alter table public.tenant_billing_profiles
add constraint tenant_billing_profiles_country_check
check (
  country is null
  or (
    country ~ '^[A-Z]{2}$'
    and country = any(public.billing_profile_supported_country_codes())
  )
);

alter table public.tenant_billing_profiles
drop constraint if exists tenant_billing_profiles_preferred_currency_check;
alter table public.tenant_billing_profiles
add constraint tenant_billing_profiles_preferred_currency_check
check (preferred_currency in ('INR', 'EUR', 'USD'));

alter table public.tenant_billing_profiles
drop constraint if exists tenant_billing_profiles_country_currency_check;
alter table public.tenant_billing_profiles
add constraint tenant_billing_profiles_country_currency_check
check (
  (
    country is null
    and preferred_currency is null
  )
  or (
    country is not null
    and preferred_currency is not null
    and preferred_currency = public.billing_profile_currency_for_country(country)
  )
);

alter table public.tenant_billing_profiles
drop constraint if exists tenant_billing_profiles_tax_registration_type_check;
alter table public.tenant_billing_profiles
add constraint tenant_billing_profiles_tax_registration_type_check
check (tax_registration_type in ('NONE', 'GSTIN', 'VAT', 'OTHER'));

alter table public.tenant_billing_profiles
drop constraint if exists tenant_billing_profiles_tax_id_type_check;
alter table public.tenant_billing_profiles
add constraint tenant_billing_profiles_tax_id_type_check
check (
  (
    tax_registration_type = 'NONE'
    and nullif(trim(coalesce(tax_id, '')), '') is null
  )
  or (
    tax_registration_type in ('GSTIN', 'VAT', 'OTHER')
  )
);

drop function if exists public.get_tenant_billing_profile(uuid);
create function public.get_tenant_billing_profile(p_tenant_id uuid)
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
  tax_registration_type text,
  invoice_contact_name text,
  billing_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
      tbp.tax_registration_type,
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
    null::uuid,
    p_tenant_id,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    'NONE'::text,
    null::text,
    null::text,
    null::timestamptz,
    null::timestamptz,
    null::uuid;
end;
$$;

drop function if exists public.upsert_tenant_billing_profile(
  uuid,text,text,text,text,text,text,text,text,text,text,text,text,text
);
create function public.upsert_tenant_billing_profile(
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
  p_preferred_currency text default null,
  p_invoice_contact_name text default null,
  p_billing_notes text default null,
  p_tax_registration_type text default 'NONE'
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
  tax_registration_type text,
  invoice_contact_name text,
  billing_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_tax_registration_type text;
  v_invoice_contact_name text;
  v_billing_notes text;
begin
  perform public.m77b_assert_billing_profile_access(p_tenant_id);

  v_legal_name := public.m77b_validate_billing_text(p_legal_name, 'Legal business name', 180);
  v_billing_email := public.m77b_validate_billing_email(p_billing_email);
  v_billing_phone := public.m77b_validate_billing_text(p_billing_phone, 'Billing phone', 40);
  v_address_line1 := public.m77b_validate_billing_text(p_address_line1, 'Address line 1', 240);
  v_address_line2 := public.m77b_validate_billing_text(p_address_line2, 'Address line 2', 240);
  v_city := public.m77b_validate_billing_text(p_city, 'City', 120);
  v_state := public.m77b_validate_billing_text(p_state, 'State or province', 120);
  v_postal_code := public.m77b_validate_billing_text(p_postal_code, 'Postal code', 40);
  v_country := public.m77b_validate_billing_country(p_country);
  v_tax_id := public.m77b_validate_billing_text(p_tax_id, 'Tax registration ID', 40);
  v_preferred_currency := public.m77b_validate_billing_country_currency(v_country, p_preferred_currency);
  v_tax_registration_type := public.m77b_validate_tax_registration_type(p_tax_registration_type);
  if v_tax_registration_type = 'NONE'
     and nullif(trim(coalesce(v_tax_id, '')), '') is not null then
    raise exception 'Tax registration ID requires a tax registration type.' using errcode = '22023';
  end if;
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
    tax_registration_type,
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
    v_tax_registration_type,
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
      tax_registration_type = excluded.tax_registration_type,
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
    tenant_billing_profiles.tax_registration_type,
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
    tax_registration_type,
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
set search_path = public, pg_temp
as $$
declare
  v_profile public.tenant_billing_profiles%rowtype;
  v_missing text[] := array[]::text[];
  v_required_count integer := 7;
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

    if nullif(trim(coalesce(v_profile.postal_code, '')), '') is null then
      v_missing := array_append(v_missing, 'postal_code');
    end if;

    if v_profile.country is null
       or public.billing_profile_currency_for_country(v_profile.country) is null then
      v_missing := array_append(v_missing, 'country');
    end if;

    if v_profile.preferred_currency is null
       or v_profile.preferred_currency <> public.billing_profile_currency_for_country(v_profile.country) then
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

alter function public.billing_profile_supported_country_codes() owner to postgres;
alter function public.billing_profile_eur_country_codes() owner to postgres;
alter function public.billing_profile_currency_for_country(text) owner to postgres;
alter function public.m77b_validate_billing_country(text) owner to postgres;
alter function public.m77b_validate_tax_registration_type(text) owner to postgres;
alter function public.m77b_validate_currency(text) owner to postgres;
alter function public.m77b_validate_billing_country_currency(text, text) owner to postgres;
alter function public.get_tenant_billing_profile(uuid) owner to postgres;
alter function public.upsert_tenant_billing_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text) owner to postgres;
alter function public.get_tenant_billing_profile_completion(uuid) owner to postgres;

revoke execute on function public.billing_profile_supported_country_codes()
from public, anon, authenticated, service_role;
revoke execute on function public.billing_profile_eur_country_codes()
from public, anon, authenticated, service_role;
revoke execute on function public.billing_profile_currency_for_country(text)
from public, anon, authenticated, service_role;
revoke execute on function public.m77b_validate_billing_country(text)
from public, anon, authenticated, service_role;
revoke execute on function public.m77b_validate_tax_registration_type(text)
from public, anon, authenticated, service_role;
revoke execute on function public.m77b_validate_currency(text)
from public, anon, authenticated, service_role;
revoke execute on function public.m77b_validate_billing_country_currency(text, text)
from public, anon, authenticated, service_role;

revoke execute on function public.get_tenant_billing_profile(uuid)
from public, anon, service_role;
revoke execute on function public.upsert_tenant_billing_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text)
from public, anon, service_role;
revoke execute on function public.get_tenant_billing_profile_completion(uuid)
from public, anon, service_role;

grant execute on function public.get_tenant_billing_profile(uuid)
to authenticated;
grant execute on function public.upsert_tenant_billing_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text)
to authenticated;
grant execute on function public.get_tenant_billing_profile_completion(uuid)
to authenticated;

alter table public.tenant_billing_profiles enable row level security;
revoke all on table public.tenant_billing_profiles from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;

/*
POST-APPLY READ-ONLY VERIFICATION

with
expected_columns as (
  select unnest(array[
    'tenant_id',
    'legal_name',
    'billing_email',
    'billing_phone',
    'invoice_contact_name',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'country',
    'tax_registration_type',
    'tax_id',
    'preferred_currency',
    'billing_notes',
    'updated_by',
    'created_at',
    'updated_at'
  ]) as column_name
),
columns_ok as (
  select
    count(*)::integer as expected_columns_present_count,
    jsonb_object_agg(c.column_name, true order by c.column_name) as present
  from information_schema.columns
  join expected_columns c using (column_name)
  where table_schema = 'public'
    and table_name = 'tenant_billing_profiles'
),
constraint_state as (
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.tenant_billing_profiles'::regclass
    and conname in (
      'tenant_billing_profiles_country_check',
      'tenant_billing_profiles_preferred_currency_check',
      'tenant_billing_profiles_country_currency_check',
      'tenant_billing_profiles_tax_registration_type_check',
      'tenant_billing_profiles_tax_id_type_check'
    )
),
table_state as (
  select
    c.relrowsecurity,
    c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'tenant_billing_profiles'
),
tax_column as (
  select
    data_type,
    is_nullable,
    column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tenant_billing_profiles'
    and column_name = 'tax_registration_type'
),
rpc_state as (
  select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_args,
    pg_get_userbyid(p.proowner) as owner,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_tenant_billing_profile',
      'upsert_tenant_billing_profile',
      'get_tenant_billing_profile_completion',
      'm77b_validate_billing_country',
      'm77b_validate_tax_registration_type',
      'm77b_validate_currency',
      'm77b_validate_billing_country_currency',
      'billing_profile_supported_country_codes',
      'billing_profile_eur_country_codes',
      'billing_profile_currency_for_country'
    )
),
overload_counts as (
  select proname, count(*)::integer as overload_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_tenant_billing_profile', 'upsert_tenant_billing_profile', 'get_tenant_billing_profile_completion')
  group by proname
),
browser_writes as (
  select count(*)::integer as count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'tenant_billing_profiles'
    and grantee in ('PUBLIC', 'public', 'anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
),
browser_direct_grants as (
  select count(*)::integer as count
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'tenant_billing_profiles'
    and grantee in ('PUBLIC', 'public', 'anon', 'authenticated')
),
expected_helpers as (
  select *
  from (values
    ('billing_profile_supported_country_codes', '', false, 'i'),
    ('billing_profile_eur_country_codes', '', false, 'i'),
    ('billing_profile_currency_for_country', 'p_country text', false, 'i'),
    ('m77b_validate_billing_country', 'p_value text', true, 's'),
    ('m77b_validate_tax_registration_type', 'p_value text', true, 's'),
    ('m77b_validate_currency', 'p_value text', true, 's'),
    ('m77b_validate_billing_country_currency', 'p_country text, p_currency text', true, 's')
  ) as expected(proname, identity_args, prosecdef, provolatile)
),
helper_contract as (
  select
    count(*) filter (
      where r.proname is not null
        and r.owner = 'postgres'
        and r.prosecdef = e.prosecdef
        and r.provolatile = e.provolatile
        and r.proconfig @> array['search_path=public, pg_temp']
        and not r.public_execute
        and not r.anon_execute
        and not r.authenticated_execute
        and not r.service_role_execute
    )::integer as expected_helper_count
  from expected_helpers e
  left join rpc_state r
    on r.proname = e.proname
   and r.identity_args = e.identity_args
),
data_contract as (
  select
    count(*) filter (where country is not null and country !~ '^[A-Z]{2}$')::integer as non_iso_country_rows,
    count(*) filter (where country is not null and public.billing_profile_currency_for_country(country) is null)::integer as unsupported_country_rows,
    count(*) filter (where preferred_currency not in ('INR', 'EUR', 'USD'))::integer as unsupported_currency_rows,
    count(*) filter (where country is null and preferred_currency is not null)::integer as null_country_non_null_currency_rows,
    count(*) filter (where country is not null and preferred_currency is null)::integer as non_null_country_null_currency_rows,
    count(*) filter (
      where country is not null
        and preferred_currency is distinct from public.billing_profile_currency_for_country(country)
    )::integer as country_currency_mismatch_rows,
    count(*) filter (where tax_registration_type not in ('NONE', 'GSTIN', 'VAT', 'OTHER'))::integer as unsupported_tax_type_rows,
    count(*) filter (
      where nullif(trim(coalesce(tax_id, '')), '') is not null
        and tax_registration_type = 'NONE'
    )::integer as tax_id_without_type_rows
  from public.tenant_billing_profiles
),
legacy_untouched as (
  select count(*)::integer = 4 as legacy_columns_still_present
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tenants'
    and column_name in ('billing_status', 'billing_email', 'billing_gst_number', 'billing_address_json')
)
select jsonb_build_object(
  'security_gate',
    (select count from browser_writes) = 0
    and (select count from browser_direct_grants) = 0
    and (select expected_columns_present_count from columns_ok) = 18
    and (select non_iso_country_rows from data_contract) = 0
    and (select unsupported_country_rows from data_contract) = 0
    and (select unsupported_currency_rows from data_contract) = 0
    and (select null_country_non_null_currency_rows from data_contract) = 0
    and (select non_null_country_null_currency_rows from data_contract) = 0
    and (select country_currency_mismatch_rows from data_contract) = 0
    and (select unsupported_tax_type_rows from data_contract) = 0
    and (select tax_id_without_type_rows from data_contract) = 0
    and (select relrowsecurity from table_state) = true
    and (select data_type = 'text' and is_nullable = 'NO' and column_default = '''NONE''::text' from tax_column) = true
    and (select count(*) from constraint_state) = 5
    and exists (
      select 1 from constraint_state
      where conname = 'tenant_billing_profiles_country_check'
        and definition like '%country IS NULL%'
        and definition like '%country ~%'
        and definition like '%billing_profile_supported_country_codes%'
    )
    and exists (
      select 1 from constraint_state
      where conname = 'tenant_billing_profiles_preferred_currency_check'
        and definition like '%preferred_currency%'
        and definition like '%INR%'
        and definition like '%EUR%'
        and definition like '%USD%'
    )
    and exists (
      select 1 from constraint_state
      where conname = 'tenant_billing_profiles_country_currency_check'
        and definition like '%country IS NULL%'
        and definition like '%preferred_currency IS NULL%'
        and definition like '%country IS NOT NULL%'
        and definition like '%preferred_currency IS NOT NULL%'
        and definition like '%billing_profile_currency_for_country(country)%'
    )
    and exists (
      select 1 from constraint_state
      where conname = 'tenant_billing_profiles_tax_registration_type_check'
        and definition like '%NONE%'
        and definition like '%GSTIN%'
        and definition like '%VAT%'
        and definition like '%OTHER%'
    )
    and exists (
      select 1 from constraint_state
      where conname = 'tenant_billing_profiles_tax_id_type_check'
        and definition like '%tax_registration_type%'
        and definition like '%tax_id%'
        and definition like '%NONE%'
        and definition like '%GSTIN%'
        and definition like '%VAT%'
        and definition like '%OTHER%'
    )
    and exists (
      select 1 from rpc_state
      where proname = 'get_tenant_billing_profile'
        and identity_args = 'p_tenant_id uuid'
        and owner = 'postgres'
        and prosecdef
        and provolatile = 's'
        and proconfig @> array['search_path=public, pg_temp']
        and authenticated_execute
        and not public_execute
        and not anon_execute
        and not service_role_execute
    )
    and exists (
      select 1 from rpc_state
      where proname = 'get_tenant_billing_profile_completion'
        and identity_args = 'p_tenant_id uuid'
        and owner = 'postgres'
        and prosecdef
        and provolatile = 's'
        and proconfig @> array['search_path=public, pg_temp']
        and authenticated_execute
        and not public_execute
        and not anon_execute
        and not service_role_execute
    )
    and exists (
      select 1 from rpc_state
      where proname = 'upsert_tenant_billing_profile'
        and identity_args = 'p_tenant_id uuid, p_legal_name text, p_billing_email text, p_billing_phone text, p_address_line1 text, p_address_line2 text, p_city text, p_state text, p_postal_code text, p_country text, p_tax_id text, p_preferred_currency text, p_invoice_contact_name text, p_billing_notes text, p_tax_registration_type text'
        and owner = 'postgres'
        and prosecdef
        and provolatile = 'v'
        and proconfig @> array['search_path=public, pg_temp']
        and authenticated_execute
        and not public_execute
        and not anon_execute
        and not service_role_execute
    )
    and (select expected_helper_count from helper_contract) = 7
    and not exists (
      select 1 from overload_counts
      where (proname = 'get_tenant_billing_profile' and overload_count <> 1)
         or (proname = 'upsert_tenant_billing_profile' and overload_count <> 1)
         or (proname = 'get_tenant_billing_profile_completion' and overload_count <> 1)
    )
    and (select legacy_columns_still_present from legacy_untouched) = true
    and to_regclass('public.tenant_payment_orders') is not null
    and to_regclass('public.subscription_plan_prices') is not null,
  'columns', (select present from columns_ok),
  'expected_columns_present_count', (select expected_columns_present_count from columns_ok),
  'tax_column', (select to_jsonb(tax_column) from tax_column),
  'table_state', (select to_jsonb(table_state) from table_state),
  'constraints', (select jsonb_agg(to_jsonb(constraint_state) order by conname) from constraint_state),
  'rpc_state', (select jsonb_agg(to_jsonb(rpc_state) order by proname, identity_args) from rpc_state),
  'overload_counts', (select jsonb_agg(to_jsonb(overload_counts) order by proname) from overload_counts),
  'helper_contract', (select to_jsonb(helper_contract) from helper_contract),
  'data_contract', (select to_jsonb(data_contract) from data_contract),
  'browser_write_grants', (select count from browser_writes),
  'browser_direct_grants', (select count from browser_direct_grants),
  'legacy_tenant_billing_fields_preserved', (select legacy_columns_still_present from legacy_untouched),
  'payment_activation_unchanged_markers', jsonb_build_object(
    'razorpay_orders_route_present', to_regclass('public.tenant_payment_orders') is not null,
    'subscription_plan_prices_present', to_regclass('public.subscription_plan_prices') is not null
  )
) as ux8d_post_apply;
*/
