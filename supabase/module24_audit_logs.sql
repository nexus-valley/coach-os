-- Module 24: Admin audit logs / activity timeline
-- Run this in Supabase SQL editor before enabling activity tracking in production.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_name text,
  user_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_name text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_tenant_created_at_idx
on public.audit_logs (tenant_id, created_at desc);

create index if not exists audit_logs_tenant_action_idx
on public.audit_logs (tenant_id, action);

create index if not exists audit_logs_tenant_entity_type_idx
on public.audit_logs (tenant_id, entity_type);

create index if not exists audit_logs_tenant_user_id_idx
on public.audit_logs (tenant_id, user_id);

alter table public.audit_logs enable row level security;

grant select, insert on public.audit_logs to authenticated;

drop policy if exists "Owner and admin can read audit logs" on public.audit_logs;
create policy "Owner and admin can read audit logs"
on public.audit_logs
for select
to authenticated
using (
  public.has_tenant_role(audit_logs.tenant_id, auth.uid(), array['owner', 'admin'])
);

drop policy if exists "Tenant members can create own audit logs" on public.audit_logs;
create policy "Tenant members can create own audit logs"
on public.audit_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_tenant_member(tenant_id, auth.uid())
);
