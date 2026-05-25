-- Module 33.1: Workspace branding completion
-- Additive only. Run after Module 19 workspace branding.

alter table public.tenants
add column if not exists workspace_display_name text,
add column if not exists whatsapp_number text,
add column if not exists address_line_1 text,
add column if not exists address_line_2 text,
add column if not exists city text,
add column if not exists state text,
add column if not exists country text,
add column if not exists postal_code text,
add column if not exists certificate_issuer_name text,
add column if not exists receipt_footer_text text;

update public.tenants
set workspace_display_name = coalesce(nullif(trim(workspace_display_name), ''), name)
where workspace_display_name is null
   or trim(workspace_display_name) = '';
