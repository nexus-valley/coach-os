-- Module 47: White label branding and tenant customization
-- Additive tenant branding fields and a whitelisted owner/admin update RPC.
-- Run after Module 44 student portal auth and Module 33.1 workspace branding.

alter table public.tenants
add column if not exists brand_name text,
add column if not exists brand_tagline text,
add column if not exists icon_url text,
add column if not exists accent_color text,
add column if not exists student_portal_theme_color text,
add column if not exists portal_welcome_title text,
add column if not exists portal_welcome_subtitle text,
add column if not exists portal_login_message text,
add column if not exists show_powered_by boolean not null default true,
add column if not exists public_page_title text,
add column if not exists public_page_description text,
add column if not exists contact_cta_text text,
add column if not exists branding_json jsonb not null default '{}'::jsonb;

update public.tenants
set
  brand_name = coalesce(nullif(trim(brand_name), ''), workspace_display_name, name),
  student_portal_theme_color = case
    when student_portal_theme_color ~* '^#[0-9a-f]{6}$' then lower(student_portal_theme_color)
    when brand_color ~* '^#[0-9a-f]{6}$' then lower(brand_color)
    else '#145da0'
  end,
  show_powered_by = coalesce(show_powered_by, true)
where brand_name is null
   or trim(coalesce(brand_name, '')) = ''
   or student_portal_theme_color is null
   or student_portal_theme_color !~* '^#[0-9a-f]{6}$';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenants_accent_color_hex_check'
  ) then
    alter table public.tenants
    add constraint tenants_accent_color_hex_check
    check (accent_color is null or accent_color ~* '^#[0-9a-f]{6}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenants_student_portal_theme_color_hex_check'
  ) then
    alter table public.tenants
    add constraint tenants_student_portal_theme_color_hex_check
    check (
      student_portal_theme_color is null
      or student_portal_theme_color ~* '^#[0-9a-f]{6}$'
    );
  end if;
end $$;

create or replace function public.update_tenant_branding_settings(
  p_tenant_id uuid,
  p_workspace_display_name text,
  p_brand_name text,
  p_brand_tagline text,
  p_logo_url text,
  p_icon_url text,
  p_brand_color text,
  p_accent_color text,
  p_student_portal_theme_color text,
  p_support_email text,
  p_support_phone text,
  p_whatsapp_number text,
  p_website_url text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_city text,
  p_state text,
  p_country text,
  p_postal_code text,
  p_certificate_issuer_name text,
  p_receipt_footer_text text,
  p_portal_welcome_title text,
  p_portal_welcome_subtitle text,
  p_portal_login_message text,
  p_show_powered_by boolean,
  p_public_page_title text,
  p_public_page_description text,
  p_contact_cta_text text
)
returns setof public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text := nullif(trim(p_workspace_display_name), '');
  normalized_icon_url text := nullif(trim(coalesce(p_icon_url, '')), '');
  normalized_logo_url text := nullif(trim(coalesce(p_logo_url, '')), '');
  normalized_website_url text := nullif(trim(coalesce(p_website_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin']) then
    raise exception 'Only workspace owners and admins can update branding.'
      using errcode = '42501';
  end if;

  if normalized_name is null then
    raise exception 'Institute / Academy name is required.' using errcode = '22023';
  end if;

  if p_brand_color is not null and p_brand_color !~* '^#[0-9a-f]{6}$' then
    raise exception 'Brand color must be a valid hex value.' using errcode = '22023';
  end if;

  if p_accent_color is not null and p_accent_color !~* '^#[0-9a-f]{6}$' then
    raise exception 'Accent color must be a valid hex value.' using errcode = '22023';
  end if;

  if p_student_portal_theme_color is not null
     and p_student_portal_theme_color !~* '^#[0-9a-f]{6}$' then
    raise exception 'Student portal theme color must be a valid hex value.'
      using errcode = '22023';
  end if;

  if normalized_logo_url is not null
     and normalized_logo_url !~* '^https://[^[:space:]<>"]+$' then
    raise exception 'Logo URL must be a valid https URL.'
      using errcode = '22023';
  end if;

  if normalized_icon_url is not null
     and normalized_icon_url !~* '^https://[^[:space:]<>"]+$' then
    raise exception 'Icon URL must be a valid https URL.'
      using errcode = '22023';
  end if;

  if normalized_website_url is not null
     and normalized_website_url !~* '^https://[^[:space:]<>"]+$' then
    raise exception 'Website URL must be a valid https URL.'
      using errcode = '22023';
  end if;

  return query
  update public.tenants
  set
    name = normalized_name,
    workspace_display_name = normalized_name,
    brand_name = nullif(trim(coalesce(p_brand_name, '')), ''),
    brand_tagline = nullif(trim(coalesce(p_brand_tagline, '')), ''),
    logo_url = normalized_logo_url,
    icon_url = normalized_icon_url,
    brand_color = coalesce(p_brand_color, '#145da0'),
    accent_color = p_accent_color,
    student_portal_theme_color = coalesce(p_student_portal_theme_color, p_brand_color, '#145da0'),
    support_email = p_support_email,
    support_phone = p_support_phone,
    whatsapp_number = p_whatsapp_number,
    website_url = normalized_website_url,
    address_line_1 = p_address_line_1,
    address_line_2 = p_address_line_2,
    city = p_city,
    state = p_state,
    country = p_country,
    postal_code = p_postal_code,
    certificate_issuer_name = p_certificate_issuer_name,
    receipt_footer_text = p_receipt_footer_text,
    portal_welcome_title = p_portal_welcome_title,
    portal_welcome_subtitle = p_portal_welcome_subtitle,
    portal_login_message = p_portal_login_message,
    show_powered_by = coalesce(p_show_powered_by, true),
    public_page_title = p_public_page_title,
    public_page_description = p_public_page_description,
    contact_cta_text = p_contact_cta_text,
    updated_at = now()
  where id = p_tenant_id
  returning *;
end;
$$;

revoke execute on function public.update_tenant_branding_settings(
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
  boolean,
  text,
  text,
  text
) from public;

grant execute on function public.update_tenant_branding_settings(
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
  boolean,
  text,
  text,
  text
) to authenticated;
