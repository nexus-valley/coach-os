alter table public.tenants
add column if not exists logo_url text,
add column if not exists brand_color text default '#14b8a6',
add column if not exists support_email text,
add column if not exists support_phone text,
add column if not exists website_url text;