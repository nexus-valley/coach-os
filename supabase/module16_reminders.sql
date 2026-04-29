create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  title text not null,
  description text,
  reminder_type text not null default 'general',
  due_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reminder_type in ('general', 'payment', 'course_followup', 'student_followup')),
  check (status in ('pending', 'completed', 'cancelled'))
);

create index if not exists reminders_tenant_due_idx
on public.reminders (tenant_id, due_at desc);

create index if not exists reminders_student_idx
on public.reminders (student_id);

drop trigger if exists set_reminders_updated_at on public.reminders;
create trigger set_reminders_updated_at
before update on public.reminders
for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;

grant select, insert, update, delete on public.reminders to authenticated;

drop policy if exists "Tenant members can read reminders" on public.reminders;
create policy "Tenant members can read reminders"
on public.reminders
for select
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can create reminders" on public.reminders;
create policy "Tenant members can create reminders"
on public.reminders
for insert
to authenticated
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can update reminders" on public.reminders;
create policy "Tenant members can update reminders"
on public.reminders
for update
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()))
with check (public.is_tenant_member(tenant_id, auth.uid()));

drop policy if exists "Tenant members can delete reminders" on public.reminders;
create policy "Tenant members can delete reminders"
on public.reminders
for delete
to authenticated
using (public.is_tenant_member(tenant_id, auth.uid()));