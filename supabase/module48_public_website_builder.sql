-- Module 48: Public website builder
-- Additive only. Run after Module 47 white label branding.

alter table public.tenants
add column if not exists public_site_enabled boolean not null default false,
add column if not exists public_hero_title text,
add column if not exists public_hero_subtitle text,
add column if not exists public_hero_cta_label text,
add column if not exists public_about_title text,
add column if not exists public_about_body text,
add column if not exists public_highlight_1_title text,
add column if not exists public_highlight_1_body text,
add column if not exists public_highlight_2_title text,
add column if not exists public_highlight_2_body text,
add column if not exists public_highlight_3_title text,
add column if not exists public_highlight_3_body text,
add column if not exists public_show_courses boolean not null default true,
add column if not exists public_show_contact_form boolean not null default true,
add column if not exists public_show_support_contact boolean not null default true,
add column if not exists public_footer_note text;

create index if not exists tenants_public_site_enabled_idx
on public.tenants (public_site_enabled);

grant usage on schema public to anon;

create table if not exists public.public_site_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null default 'public_site',
  name text not null,
  email text,
  phone text,
  message text,
  interested_course_id uuid references public.courses(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'closed')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists public_site_leads_tenant_created_at_idx
on public.public_site_leads (tenant_id, created_at desc);

create index if not exists public_site_leads_tenant_status_idx
on public.public_site_leads (tenant_id, status);

create index if not exists public_site_leads_tenant_course_idx
on public.public_site_leads (tenant_id, interested_course_id);

alter table public.public_site_leads enable row level security;

revoke all on public.public_site_leads from anon;
revoke insert, update, delete on public.public_site_leads from authenticated;
grant select on public.public_site_leads to authenticated;

drop policy if exists "Owner and admin can read public site leads" on public.public_site_leads;
create policy "Owner and admin can read public site leads"
on public.public_site_leads
for select
to authenticated
using (public.has_tenant_role(tenant_id, auth.uid(), array['owner', 'admin']));

create or replace function public.get_public_site(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_slug text := lower(trim(coalesce(p_slug, '')));
  site_tenant public.tenants%rowtype;
  course_items jsonb := '[]'::jsonb;
begin
  if normalized_slug = ''
     or normalized_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    return null;
  end if;

  select *
  into site_tenant
  from public.tenants
  where slug = normalized_slug
    and public_site_enabled = true
  limit 1;

  if not found then
    return null;
  end if;

  if coalesce(site_tenant.public_show_courses, true) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'slug', c.slug,
          'description', c.description,
          'thumbnail_url', c.thumbnail_url
        )
        order by c.created_at desc
      ),
      '[]'::jsonb
    )
    into course_items
    from (
      select id, title, slug, description, thumbnail_url, created_at
      from public.courses
      where tenant_id = site_tenant.id
        and status = 'published'
      order by created_at desc
      limit 12
    ) c;
  end if;

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', site_tenant.id,
      'slug', site_tenant.slug,
      'name', site_tenant.name,
      'workspace_display_name', site_tenant.workspace_display_name,
      'brand_name', site_tenant.brand_name,
      'brand_tagline', site_tenant.brand_tagline,
      'logo_url', site_tenant.logo_url,
      'icon_url', site_tenant.icon_url,
      'brand_color', site_tenant.brand_color,
      'accent_color', site_tenant.accent_color,
      'show_powered_by', site_tenant.show_powered_by,
      'support_email', case when coalesce(site_tenant.public_show_support_contact, true) then site_tenant.support_email else null end,
      'support_phone', case when coalesce(site_tenant.public_show_support_contact, true) then site_tenant.support_phone else null end,
      'website_url', case when coalesce(site_tenant.public_show_support_contact, true) then site_tenant.website_url else null end
    ),
    'site', jsonb_build_object(
      'public_site_enabled', site_tenant.public_site_enabled,
      'public_page_title', site_tenant.public_page_title,
      'public_page_description', site_tenant.public_page_description,
      'contact_cta_text', site_tenant.contact_cta_text,
      'public_hero_title', site_tenant.public_hero_title,
      'public_hero_subtitle', site_tenant.public_hero_subtitle,
      'public_hero_cta_label', site_tenant.public_hero_cta_label,
      'public_about_title', site_tenant.public_about_title,
      'public_about_body', site_tenant.public_about_body,
      'public_highlight_1_title', site_tenant.public_highlight_1_title,
      'public_highlight_1_body', site_tenant.public_highlight_1_body,
      'public_highlight_2_title', site_tenant.public_highlight_2_title,
      'public_highlight_2_body', site_tenant.public_highlight_2_body,
      'public_highlight_3_title', site_tenant.public_highlight_3_title,
      'public_highlight_3_body', site_tenant.public_highlight_3_body,
      'public_show_courses', site_tenant.public_show_courses,
      'public_show_contact_form', site_tenant.public_show_contact_form,
      'public_show_support_contact', site_tenant.public_show_support_contact,
      'public_footer_note', site_tenant.public_footer_note
    ),
    'courses', course_items
  );
end;
$$;

create or replace function public.submit_public_site_lead(
  p_slug text,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_message text default null,
  p_interested_course_id uuid default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_slug text := lower(trim(coalesce(p_slug, '')));
  normalized_name text := nullif(trim(coalesce(p_name, '')), '');
  normalized_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  normalized_phone text := nullif(trim(coalesce(p_phone, '')), '');
  normalized_message text := nullif(trim(coalesce(p_message, '')), '');
  site_tenant public.tenants%rowtype;
  created_lead public.public_site_leads%rowtype;
begin
  if normalized_slug = ''
     or normalized_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    raise exception 'Public site is unavailable.' using errcode = '22023';
  end if;

  select *
  into site_tenant
  from public.tenants
  where slug = normalized_slug
    and public_site_enabled = true
  limit 1;

  if not found or coalesce(site_tenant.public_show_contact_form, true) = false then
    raise exception 'Public inquiries are not enabled for this site.'
      using errcode = '42501';
  end if;

  if normalized_name is null or length(normalized_name) < 2 or length(normalized_name) > 120 then
    raise exception 'Name must be between 2 and 120 characters.'
      using errcode = '22023';
  end if;

  if normalized_name ~ '[<>]' then
    raise exception 'Name cannot contain HTML.' using errcode = '22023';
  end if;

  if normalized_email is null and normalized_phone is null then
    raise exception 'Email or phone is required.' using errcode = '22023';
  end if;

  if normalized_email is not null
     and (length(normalized_email) > 160 or normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Email must be valid.' using errcode = '22023';
  end if;

  if normalized_phone is not null
     and (length(normalized_phone) > 32 or normalized_phone !~ '^[+0-9() -]{7,32}$') then
    raise exception 'Phone must be valid.' using errcode = '22023';
  end if;

  if normalized_message is not null
     and (length(normalized_message) > 2000 or normalized_message ~ '[<>]') then
    raise exception 'Message is too long or contains unsafe characters.'
      using errcode = '22023';
  end if;

  if p_interested_course_id is not null and not exists (
    select 1
    from public.courses c
    where c.id = p_interested_course_id
      and c.tenant_id = site_tenant.id
      and c.status = 'published'
  ) then
    raise exception 'Selected course is unavailable.' using errcode = '22023';
  end if;

  insert into public.public_site_leads (
    tenant_id,
    name,
    email,
    phone,
    message,
    interested_course_id,
    metadata_json
  )
  values (
    site_tenant.id,
    normalized_name,
    normalized_email,
    normalized_phone,
    normalized_message,
    p_interested_course_id,
    '{}'::jsonb
  )
  returning * into created_lead;

  return jsonb_build_object(
    'id', created_lead.id,
    'status', created_lead.status,
    'created_at', created_lead.created_at
  );
end;
$$;

create or replace function public.update_public_site_settings(
  p_tenant_id uuid,
  p_slug text,
  p_public_site_enabled boolean,
  p_public_page_title text,
  p_public_page_description text,
  p_contact_cta_text text,
  p_public_hero_title text,
  p_public_hero_subtitle text,
  p_public_hero_cta_label text,
  p_public_about_title text,
  p_public_about_body text,
  p_public_highlight_1_title text,
  p_public_highlight_1_body text,
  p_public_highlight_2_title text,
  p_public_highlight_2_body text,
  p_public_highlight_3_title text,
  p_public_highlight_3_body text,
  p_public_show_courses boolean,
  p_public_show_contact_form boolean,
  p_public_show_support_contact boolean,
  p_public_footer_note text
)
returns setof public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_slug text := lower(trim(coalesce(p_slug, '')));
  normalized_public_page_title text := nullif(trim(coalesce(p_public_page_title, '')), '');
  normalized_public_page_description text := nullif(trim(coalesce(p_public_page_description, '')), '');
  normalized_contact_cta_text text := nullif(trim(coalesce(p_contact_cta_text, '')), '');
  normalized_public_hero_title text := nullif(trim(coalesce(p_public_hero_title, '')), '');
  normalized_public_hero_subtitle text := nullif(trim(coalesce(p_public_hero_subtitle, '')), '');
  normalized_public_hero_cta_label text := nullif(trim(coalesce(p_public_hero_cta_label, '')), '');
  normalized_public_about_title text := nullif(trim(coalesce(p_public_about_title, '')), '');
  normalized_public_about_body text := nullif(trim(coalesce(p_public_about_body, '')), '');
  normalized_public_highlight_1_title text := nullif(trim(coalesce(p_public_highlight_1_title, '')), '');
  normalized_public_highlight_1_body text := nullif(trim(coalesce(p_public_highlight_1_body, '')), '');
  normalized_public_highlight_2_title text := nullif(trim(coalesce(p_public_highlight_2_title, '')), '');
  normalized_public_highlight_2_body text := nullif(trim(coalesce(p_public_highlight_2_body, '')), '');
  normalized_public_highlight_3_title text := nullif(trim(coalesce(p_public_highlight_3_title, '')), '');
  normalized_public_highlight_3_body text := nullif(trim(coalesce(p_public_highlight_3_body, '')), '');
  normalized_public_footer_note text := nullif(trim(coalesce(p_public_footer_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not public.has_tenant_role(p_tenant_id, auth.uid(), array['owner', 'admin']) then
    raise exception 'Only workspace owners and admins can update public site settings.'
      using errcode = '42501';
  end if;

  if normalized_slug = ''
     or normalized_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    raise exception 'Public slug must use lowercase letters, numbers, and hyphens.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenants t
    where t.slug = normalized_slug
      and t.id <> p_tenant_id
  ) then
    raise exception 'That public slug is already in use.' using errcode = '23505';
  end if;

  if coalesce(normalized_public_page_title, '') ~ '[<>]'
     or coalesce(normalized_public_page_description, '') ~ '[<>]'
     or coalesce(normalized_contact_cta_text, '') ~ '[<>]'
     or coalesce(normalized_public_hero_title, '') ~ '[<>]'
     or coalesce(normalized_public_hero_subtitle, '') ~ '[<>]'
     or coalesce(normalized_public_hero_cta_label, '') ~ '[<>]'
     or coalesce(normalized_public_about_title, '') ~ '[<>]'
     or coalesce(normalized_public_about_body, '') ~ '[<>]'
     or coalesce(normalized_public_highlight_1_title, '') ~ '[<>]'
     or coalesce(normalized_public_highlight_1_body, '') ~ '[<>]'
     or coalesce(normalized_public_highlight_2_title, '') ~ '[<>]'
     or coalesce(normalized_public_highlight_2_body, '') ~ '[<>]'
     or coalesce(normalized_public_highlight_3_title, '') ~ '[<>]'
     or coalesce(normalized_public_highlight_3_body, '') ~ '[<>]'
     or coalesce(normalized_public_footer_note, '') ~ '[<>]' then
    raise exception 'Public site copy must be plain text only.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_page_title, '')) > 120 then
    raise exception 'Public page title must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_page_description, '')) > 500 then
    raise exception 'Public page description must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_contact_cta_text, '')) > 80 then
    raise exception 'Contact CTA text must be 80 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_hero_title, '')) > 140 then
    raise exception 'Hero title must be 140 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_hero_subtitle, '')) > 500 then
    raise exception 'Hero subtitle must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_hero_cta_label, '')) > 60 then
    raise exception 'Hero CTA label must be 60 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_about_title, '')) > 120 then
    raise exception 'About title must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_about_body, '')) > 2000 then
    raise exception 'About body must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_highlight_1_title, '')) > 100
     or length(coalesce(normalized_public_highlight_2_title, '')) > 100
     or length(coalesce(normalized_public_highlight_3_title, '')) > 100 then
    raise exception 'Highlight titles must be 100 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_highlight_1_body, '')) > 700
     or length(coalesce(normalized_public_highlight_2_body, '')) > 700
     or length(coalesce(normalized_public_highlight_3_body, '')) > 700 then
    raise exception 'Highlight bodies must be 700 characters or fewer.'
      using errcode = '22023';
  end if;

  if length(coalesce(normalized_public_footer_note, '')) > 500 then
    raise exception 'Footer note must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  return query
  update public.tenants
  set
    slug = normalized_slug,
    public_site_enabled = coalesce(p_public_site_enabled, false),
    public_page_title = normalized_public_page_title,
    public_page_description = normalized_public_page_description,
    contact_cta_text = normalized_contact_cta_text,
    public_hero_title = normalized_public_hero_title,
    public_hero_subtitle = normalized_public_hero_subtitle,
    public_hero_cta_label = normalized_public_hero_cta_label,
    public_about_title = normalized_public_about_title,
    public_about_body = normalized_public_about_body,
    public_highlight_1_title = normalized_public_highlight_1_title,
    public_highlight_1_body = normalized_public_highlight_1_body,
    public_highlight_2_title = normalized_public_highlight_2_title,
    public_highlight_2_body = normalized_public_highlight_2_body,
    public_highlight_3_title = normalized_public_highlight_3_title,
    public_highlight_3_body = normalized_public_highlight_3_body,
    public_show_courses = coalesce(p_public_show_courses, true),
    public_show_contact_form = coalesce(p_public_show_contact_form, true),
    public_show_support_contact = coalesce(p_public_show_support_contact, true),
    public_footer_note = normalized_public_footer_note,
    updated_at = now()
  where id = p_tenant_id
  returning *;
end;
$$;

revoke execute on function public.get_public_site(text) from public;
revoke execute on function public.submit_public_site_lead(text, text, text, text, text, uuid, jsonb) from public;
revoke execute on function public.update_public_site_settings(
  uuid,
  text,
  boolean,
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
  boolean,
  boolean,
  text
) from public;

grant execute on function public.get_public_site(text) to anon, authenticated;
grant execute on function public.submit_public_site_lead(text, text, text, text, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.update_public_site_settings(
  uuid,
  text,
  boolean,
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
  boolean,
  boolean,
  text
) to authenticated;
