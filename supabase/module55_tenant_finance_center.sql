-- Module 55: Tenant Finance Center
-- Tenant-level institute finance. This is not CoachFort platform billing.
-- Review before execution. Additive only.

create table if not exists public.finance_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  default_currency text not null default 'INR' check (default_currency in ('INR')),
  invoice_prefix text not null default 'INV-' check (length(invoice_prefix) between 1 and 16 and invoice_prefix !~ '[<>]'),
  receipt_prefix text not null default 'RCPT-' check (length(receipt_prefix) between 1 and 16 and receipt_prefix !~ '[<>]'),
  next_invoice_number integer not null default 1 check (next_invoice_number >= 1),
  next_receipt_number integer not null default 1 check (next_receipt_number >= 1),
  payment_terms_days integer not null default 15 check (payment_terms_days between 0 and 365),
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object' and length(metadata_json::text) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_fee_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  name text not null,
  description text,
  amount numeric not null check (amount >= 0),
  currency text not null default 'INR' check (currency in ('INR')),
  billing_cycle text not null default 'one_time' check (billing_cycle in ('one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom')),
  installments_count integer check (installments_count is null or installments_count >= 1),
  due_day integer check (due_day is null or due_day between 1 and 31),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object' and length(metadata_json::text) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_fee_plans_name_safe_chk check (length(name) between 1 and 180 and name !~ '[<>]'),
  constraint finance_fee_plans_description_safe_chk check (description is null or (length(description) <= 1500 and description !~ '[<>]'))
);

create table if not exists public.finance_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  fee_plan_id uuid references public.finance_fee_plans(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date,
  subtotal_amount numeric not null check (subtotal_amount >= 0),
  discount_amount numeric not null default 0 check (discount_amount >= 0),
  tax_amount numeric not null default 0 check (tax_amount >= 0),
  total_amount numeric not null check (total_amount >= 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  balance_amount numeric not null check (balance_amount >= 0),
  currency text not null default 'INR' check (currency in ('INR')),
  status text not null default 'draft' check (status in ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void', 'cancelled')),
  notes text,
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object' and length(metadata_json::text) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, invoice_number),
  constraint finance_invoices_notes_safe_chk check (notes is null or (length(notes) <= 1500 and notes !~ '[<>]')),
  constraint finance_invoices_due_after_invoice_chk check (due_date is null or due_date >= invoice_date),
  constraint finance_invoices_total_math_chk check (total_amount = subtotal_amount - discount_amount + tax_amount),
  constraint finance_invoices_balance_math_chk check (balance_amount = total_amount - paid_amount),
  constraint finance_invoices_paid_not_over_total_chk check (paid_amount <= total_amount)
);

create table if not exists public.finance_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid references public.finance_invoices(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  recorded_by uuid references auth.users(id) on delete set null,
  payment_date date not null default current_date,
  amount numeric not null check (amount > 0),
  currency text not null default 'INR' check (currency in ('INR')),
  payment_method text not null default 'cash' check (payment_method in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'online', 'other')),
  reference_number text,
  status text not null default 'recorded' check (status in ('recorded', 'confirmed', 'failed', 'refunded', 'cancelled')),
  notes text,
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object' and length(metadata_json::text) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_payments_reference_safe_chk check (reference_number is null or (length(reference_number) <= 120 and reference_number !~ '[<>]')),
  constraint finance_payments_notes_safe_chk check (notes is null or (length(notes) <= 1500 and notes !~ '[<>]'))
);

create table if not exists public.finance_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_id uuid not null references public.finance_payments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  receipt_number text not null,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  amount numeric not null check (amount > 0),
  currency text not null default 'INR' check (currency in ('INR')),
  status text not null default 'issued' check (status in ('issued', 'void', 'cancelled')),
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object' and length(metadata_json::text) <= 3000),
  created_at timestamptz not null default now(),
  unique (tenant_id, receipt_number)
);

create table if not exists public.finance_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  adjustment_type text not null check (adjustment_type in ('discount', 'waiver', 'correction', 'penalty', 'refund_note', 'other')),
  amount numeric not null check (amount >= 0),
  reason text not null,
  status text not null default 'applied' check (status in ('applied', 'reversed', 'cancelled')),
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object' and length(metadata_json::text) <= 3000),
  created_at timestamptz not null default now(),
  constraint finance_adjustments_reason_safe_chk check (length(reason) between 1 and 500 and reason !~ '[<>]')
);

create table if not exists public.finance_activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  invoice_id uuid references public.finance_invoices(id) on delete set null,
  payment_id uuid references public.finance_payments(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object' and length(metadata_json::text) <= 3000),
  created_at timestamptz not null default now()
);

create index if not exists finance_fee_plans_tenant_status_idx on public.finance_fee_plans (tenant_id, status);
create index if not exists finance_invoices_tenant_student_idx on public.finance_invoices (tenant_id, student_id, created_at desc);
create index if not exists finance_invoices_tenant_status_idx on public.finance_invoices (tenant_id, status);
create index if not exists finance_invoices_due_idx on public.finance_invoices (tenant_id, due_date, status);
create index if not exists finance_payments_tenant_student_idx on public.finance_payments (tenant_id, student_id, created_at desc);
create index if not exists finance_payments_invoice_idx on public.finance_payments (tenant_id, invoice_id);
create index if not exists finance_receipts_tenant_student_idx on public.finance_receipts (tenant_id, student_id, created_at desc);
create index if not exists finance_adjustments_invoice_idx on public.finance_adjustments (tenant_id, invoice_id);
create index if not exists finance_activity_tenant_created_idx on public.finance_activity_logs (tenant_id, created_at desc);

drop trigger if exists set_finance_settings_updated_at on public.finance_settings;
create trigger set_finance_settings_updated_at before update on public.finance_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_finance_fee_plans_updated_at on public.finance_fee_plans;
create trigger set_finance_fee_plans_updated_at before update on public.finance_fee_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_finance_invoices_updated_at on public.finance_invoices;
create trigger set_finance_invoices_updated_at before update on public.finance_invoices
for each row execute function public.set_updated_at();

drop trigger if exists set_finance_payments_updated_at on public.finance_payments;
create trigger set_finance_payments_updated_at before update on public.finance_payments
for each row execute function public.set_updated_at();

alter table public.finance_settings enable row level security;
alter table public.finance_fee_plans enable row level security;
alter table public.finance_invoices enable row level security;
alter table public.finance_payments enable row level security;
alter table public.finance_receipts enable row level security;
alter table public.finance_adjustments enable row level security;
alter table public.finance_activity_logs enable row level security;

create or replace function public.finance_current_role(check_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.tenant_members tm
  where tm.tenant_id = check_tenant_id
    and tm.user_id = auth.uid()
    and tm.role in ('owner', 'admin', 'staff', 'trainer')
  limit 1;
$$;

create or replace function public.finance_is_owner_admin(check_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_member_role text;
begin
  if auth.uid() is null then
    return false;
  end if;

  current_member_role := public.finance_current_role(check_tenant_id);
  return coalesce(current_member_role in ('owner', 'admin'), false);
end;
$$;

create or replace function public.finance_student_can_access(check_tenant_id uuid, check_student_id uuid)
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
    where spa.tenant_id = check_tenant_id
      and spa.student_id = check_student_id
      and spa.user_id = auth.uid()
      and spa.status = 'active'
      and coalesce(s.portal_enabled, true) = true
      and s.status = 'active'
  );
$$;

create or replace function public.finance_row_is_visible(check_tenant_id uuid, check_student_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return coalesce(
    public.finance_is_owner_admin(check_tenant_id)
    or (
      check_student_id is not null
      and public.finance_student_can_access(check_tenant_id, check_student_id)
    ),
    false
  );
end;
$$;

create or replace function public.validate_finance_text(
  value text,
  field_name text,
  required boolean,
  max_length integer
)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  normalized text := nullif(trim(coalesce(value, '')), '');
begin
  if required and normalized is null then
    raise exception '% is required.', field_name using errcode = '22023';
  end if;

  if normalized is null then
    return null;
  end if;

  if length(normalized) > max_length then
    raise exception '% is too long.', field_name using errcode = '22023';
  end if;

  if normalized ~ '[<>]' then
    raise exception '% cannot contain HTML.', field_name using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create or replace function public.normalize_finance_metadata(value jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if value is null then
    return '{}'::jsonb;
  end if;

  if jsonb_typeof(value) <> 'object' then
    raise exception 'Metadata must be a JSON object.' using errcode = '22023';
  end if;

  if length(value::text) > 3000 then
    raise exception 'Metadata is too large.' using errcode = '22023';
  end if;

  return value;
end;
$$;

create or replace function public.insert_finance_activity(
  p_tenant_id uuid,
  p_student_id uuid,
  p_invoice_id uuid,
  p_payment_id uuid,
  p_action text,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_activity_id uuid;
begin
  insert into public.finance_activity_logs (
    tenant_id,
    student_id,
    invoice_id,
    payment_id,
    actor_id,
    action,
    metadata_json
  )
  values (
    p_tenant_id,
    p_student_id,
    p_invoice_id,
    p_payment_id,
    auth.uid(),
    public.validate_finance_text(p_action, 'Finance action', true, 100),
    public.normalize_finance_metadata(p_metadata_json)
  )
  returning id into new_activity_id;

  return new_activity_id;
end;
$$;

create or replace function public.finance_recalculate_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_row public.finance_invoices%rowtype;
  computed_paid numeric;
  computed_balance numeric;
  computed_status text;
begin
  select *
  into invoice_row
  from public.finance_invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;

  select coalesce(sum(fp.amount), 0)
  into computed_paid
  from public.finance_payments fp
  where fp.invoice_id = p_invoice_id
    and fp.tenant_id = invoice_row.tenant_id
    and fp.status in ('recorded', 'confirmed');

  if computed_paid > invoice_row.total_amount then
    raise exception 'Invoice paid amount cannot exceed total.' using errcode = '22023';
  end if;

  computed_balance := invoice_row.total_amount - computed_paid;

  computed_status := case
    when invoice_row.status in ('void', 'cancelled') then invoice_row.status
    when computed_balance = 0 and invoice_row.total_amount > 0 then 'paid'
    when computed_paid > 0 and computed_balance > 0 then 'partially_paid'
    when invoice_row.due_date is not null and invoice_row.due_date < current_date and computed_balance > 0 then 'overdue'
    else 'issued'
  end;

  update public.finance_invoices
  set paid_amount = computed_paid,
      balance_amount = computed_balance,
      status = computed_status
  where id = p_invoice_id;
end;
$$;

create or replace function public.upsert_finance_settings(
  p_tenant_id uuid,
  p_invoice_prefix text default 'INV-',
  p_receipt_prefix text default 'RCPT-',
  p_payment_terms_days integer default 15,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.finance_is_owner_admin(p_tenant_id) then
    raise exception 'Only owners and admins can manage finance settings.' using errcode = '42501';
  end if;

  if p_payment_terms_days is null or p_payment_terms_days < 0 or p_payment_terms_days > 365 then
    raise exception 'Payment terms must be between 0 and 365 days.' using errcode = '22023';
  end if;

  insert into public.finance_settings (
    tenant_id,
    invoice_prefix,
    receipt_prefix,
    payment_terms_days,
    metadata_json
  )
  values (
    p_tenant_id,
    public.validate_finance_text(p_invoice_prefix, 'Invoice prefix', true, 16),
    public.validate_finance_text(p_receipt_prefix, 'Receipt prefix', true, 16),
    p_payment_terms_days,
    public.normalize_finance_metadata(p_metadata_json)
  )
  on conflict (tenant_id) do update
  set invoice_prefix = excluded.invoice_prefix,
      receipt_prefix = excluded.receipt_prefix,
      payment_terms_days = excluded.payment_terms_days,
      metadata_json = excluded.metadata_json;

  perform public.insert_finance_activity(
    p_tenant_id,
    null,
    null,
    null,
    'finance_settings_updated',
    jsonb_build_object('payment_terms_days', p_payment_terms_days)
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    p_tenant_id, actor_id, 'finance_settings_updated', 'finance_settings',
    p_tenant_id, 'Finance settings', 'Tenant finance settings updated.', 'info',
    jsonb_build_object('changed_fields', array['invoice_prefix','receipt_prefix','payment_terms_days'])
  );

  return p_tenant_id;
end;
$$;

create or replace function public.create_fee_plan(
  p_tenant_id uuid,
  p_name text,
  p_description text default null,
  p_amount numeric default 0,
  p_course_id uuid default null,
  p_billing_cycle text default 'one_time',
  p_installments_count integer default null,
  p_due_day integer default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_cycle text := lower(trim(coalesce(p_billing_cycle, 'one_time')));
  new_plan_id uuid;
begin
  if actor_id is null or not public.finance_is_owner_admin(p_tenant_id) then
    raise exception 'Only owners and admins can create fee plans.' using errcode = '42501';
  end if;

  if p_course_id is not null and not exists (
    select 1 from public.courses c where c.id = p_course_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Course is not in this tenant.' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Fee plan amount must be non-negative.' using errcode = '22023';
  end if;

  if normalized_cycle not in ('one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom') then
    raise exception 'Billing cycle is invalid.' using errcode = '22023';
  end if;

  if p_installments_count is not null and p_installments_count < 1 then
    raise exception 'Installments count must be at least 1.' using errcode = '22023';
  end if;

  if p_due_day is not null and (p_due_day < 1 or p_due_day > 31) then
    raise exception 'Due day must be between 1 and 31.' using errcode = '22023';
  end if;

  insert into public.finance_fee_plans (
    tenant_id, course_id, created_by, updated_by, name, description, amount,
    currency, billing_cycle, installments_count, due_day, status, metadata_json
  )
  values (
    p_tenant_id, p_course_id, actor_id, actor_id,
    public.validate_finance_text(p_name, 'Fee plan name', true, 180),
    public.validate_finance_text(p_description, 'Fee plan description', false, 1500),
    p_amount, 'INR', normalized_cycle, p_installments_count, p_due_day,
    'active', public.normalize_finance_metadata(p_metadata_json)
  )
  returning id into new_plan_id;

  perform public.insert_finance_activity(
    p_tenant_id, null, null, null, 'finance_fee_plan_created',
    jsonb_build_object('fee_plan_id', new_plan_id, 'amount', p_amount, 'currency', 'INR')
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    p_tenant_id, actor_id, 'finance_fee_plan_created', 'finance_fee_plan',
    new_plan_id, public.validate_finance_text(p_name, 'Fee plan name', true, 180),
    'Finance fee plan created.', 'info',
    jsonb_build_object('fee_plan_id', new_plan_id, 'amount', p_amount, 'currency', 'INR', 'course_id', p_course_id)
  );

  return new_plan_id;
end;
$$;

create or replace function public.update_fee_plan(
  p_fee_plan_id uuid,
  p_name text default null,
  p_description text default null,
  p_amount numeric default null,
  p_status text default null,
  p_billing_cycle text default null,
  p_installments_count integer default null,
  p_due_day integer default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  plan_row public.finance_fee_plans%rowtype;
  new_status text;
  new_cycle text;
begin
  select * into plan_row from public.finance_fee_plans where id = p_fee_plan_id limit 1;

  if not found then
    raise exception 'Fee plan not found.' using errcode = '22023';
  end if;

  if actor_id is null or not public.finance_is_owner_admin(plan_row.tenant_id) then
    raise exception 'Only owners and admins can update fee plans.' using errcode = '42501';
  end if;

  new_status := coalesce(nullif(lower(trim(coalesce(p_status, ''))), ''), plan_row.status);
  new_cycle := coalesce(nullif(lower(trim(coalesce(p_billing_cycle, ''))), ''), plan_row.billing_cycle);

  if new_status not in ('active', 'inactive', 'archived') then
    raise exception 'Fee plan status is invalid.' using errcode = '22023';
  end if;

  if new_cycle not in ('one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom') then
    raise exception 'Billing cycle is invalid.' using errcode = '22023';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'Fee plan amount must be non-negative.' using errcode = '22023';
  end if;

  update public.finance_fee_plans
  set updated_by = actor_id,
      name = coalesce(public.validate_finance_text(p_name, 'Fee plan name', false, 180), name),
      description = case when p_description is null then description else public.validate_finance_text(p_description, 'Fee plan description', false, 1500) end,
      amount = coalesce(p_amount, amount),
      status = new_status,
      billing_cycle = new_cycle,
      installments_count = coalesce(p_installments_count, installments_count),
      due_day = coalesce(p_due_day, due_day),
      metadata_json = case when p_metadata_json is null then metadata_json else public.normalize_finance_metadata(p_metadata_json) end
  where id = p_fee_plan_id;

  perform public.insert_finance_activity(
    plan_row.tenant_id, null, null, null,
    case when new_status = 'archived' and plan_row.status <> 'archived' then 'finance_fee_plan_archived' else 'finance_fee_plan_updated' end,
    jsonb_build_object('fee_plan_id', p_fee_plan_id, 'old_status', plan_row.status, 'new_status', new_status)
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    plan_row.tenant_id, actor_id,
    case when new_status = 'archived' and plan_row.status <> 'archived' then 'finance_fee_plan_archived' else 'finance_fee_plan_updated' end,
    'finance_fee_plan', p_fee_plan_id, plan_row.name,
    'Finance fee plan updated.', 'info',
    jsonb_build_object('fee_plan_id', p_fee_plan_id, 'old_status', plan_row.status, 'new_status', new_status)
  );

  return p_fee_plan_id;
end;
$$;

create or replace function public.create_invoice(
  p_tenant_id uuid,
  p_student_id uuid,
  p_course_id uuid default null,
  p_fee_plan_id uuid default null,
  p_invoice_date date default current_date,
  p_due_date date default null,
  p_subtotal_amount numeric default 0,
  p_discount_amount numeric default 0,
  p_tax_amount numeric default 0,
  p_notes text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  settings_row public.finance_settings%rowtype;
  invoice_total numeric;
  invoice_number_value text;
  new_invoice_id uuid;
begin
  if actor_id is null or not public.finance_is_owner_admin(p_tenant_id) then
    raise exception 'Only owners and admins can create invoices.' using errcode = '42501';
  end if;

  if p_invoice_date is null then
    raise exception 'Invoice date is required.' using errcode = '22023';
  end if;

  if p_due_date is not null and p_due_date < p_invoice_date then
    raise exception 'Invoice due date cannot be before invoice date.' using errcode = '22023';
  end if;

  if p_subtotal_amount is null or p_subtotal_amount < 0 or p_discount_amount < 0 or p_tax_amount < 0 then
    raise exception 'Invoice amounts must be non-negative.' using errcode = '22023';
  end if;

  invoice_total := p_subtotal_amount - coalesce(p_discount_amount, 0) + coalesce(p_tax_amount, 0);

  if invoice_total < 0 then
    raise exception 'Invoice total cannot be negative.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.students s where s.id = p_student_id and s.tenant_id = p_tenant_id) then
    raise exception 'Student is not in this tenant.' using errcode = '22023';
  end if;

  if p_course_id is not null and not exists (select 1 from public.courses c where c.id = p_course_id and c.tenant_id = p_tenant_id) then
    raise exception 'Course is not in this tenant.' using errcode = '22023';
  end if;

  if p_fee_plan_id is not null and not exists (select 1 from public.finance_fee_plans fp where fp.id = p_fee_plan_id and fp.tenant_id = p_tenant_id) then
    raise exception 'Fee plan is not in this tenant.' using errcode = '22023';
  end if;

  insert into public.finance_settings (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select * into settings_row from public.finance_settings where tenant_id = p_tenant_id for update;
  invoice_number_value := settings_row.invoice_prefix || lpad(settings_row.next_invoice_number::text, 5, '0');

  update public.finance_settings
  set next_invoice_number = next_invoice_number + 1
  where tenant_id = p_tenant_id;

  insert into public.finance_invoices (
    tenant_id, student_id, course_id, fee_plan_id, created_by, updated_by,
    invoice_number, invoice_date, due_date, subtotal_amount, discount_amount,
    tax_amount, total_amount, paid_amount, balance_amount, currency, status,
    notes, metadata_json
  )
  values (
    p_tenant_id, p_student_id, p_course_id, p_fee_plan_id, actor_id, actor_id,
    invoice_number_value, p_invoice_date, p_due_date, p_subtotal_amount,
    coalesce(p_discount_amount, 0), coalesce(p_tax_amount, 0), invoice_total,
    0, invoice_total, 'INR', 'issued',
    public.validate_finance_text(p_notes, 'Invoice notes', false, 1500),
    public.normalize_finance_metadata(p_metadata_json)
  )
  returning id into new_invoice_id;

  perform public.insert_finance_activity(
    p_tenant_id, p_student_id, new_invoice_id, null, 'finance_invoice_created',
    jsonb_build_object('invoice_id', new_invoice_id, 'amount', invoice_total, 'currency', 'INR', 'status', 'issued')
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    p_tenant_id, actor_id, 'finance_invoice_created', 'finance_invoice',
    new_invoice_id, invoice_number_value, 'Finance invoice created.', 'info',
    jsonb_build_object('invoice_id', new_invoice_id, 'student_id', p_student_id, 'amount', invoice_total, 'currency', 'INR', 'status', 'issued')
  );

  return new_invoice_id;
end;
$$;

create or replace function public.update_invoice(
  p_invoice_id uuid,
  p_due_date date default null,
  p_subtotal_amount numeric default null,
  p_discount_amount numeric default null,
  p_tax_amount numeric default null,
  p_notes text default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.finance_invoices%rowtype;
  new_subtotal numeric;
  new_discount numeric;
  new_tax numeric;
  new_total numeric;
begin
  select * into invoice_row from public.finance_invoices where id = p_invoice_id for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;

  if actor_id is null or not public.finance_is_owner_admin(invoice_row.tenant_id) then
    raise exception 'Only owners and admins can update invoices.' using errcode = '42501';
  end if;

  if invoice_row.status not in ('draft', 'issued', 'overdue') or invoice_row.paid_amount > 0 then
    raise exception 'Only unpaid draft or issued invoices can be edited.' using errcode = '42501';
  end if;

  if p_due_date is not null and p_due_date < invoice_row.invoice_date then
    raise exception 'Invoice due date cannot be before invoice date.' using errcode = '22023';
  end if;

  new_subtotal := coalesce(p_subtotal_amount, invoice_row.subtotal_amount);
  new_discount := coalesce(p_discount_amount, invoice_row.discount_amount);
  new_tax := coalesce(p_tax_amount, invoice_row.tax_amount);

  if new_subtotal < 0 or new_discount < 0 or new_tax < 0 then
    raise exception 'Invoice amounts must be non-negative.' using errcode = '22023';
  end if;

  new_total := new_subtotal - new_discount + new_tax;

  if new_total < 0 then
    raise exception 'Invoice total cannot be negative.' using errcode = '22023';
  end if;

  update public.finance_invoices
  set updated_by = actor_id,
      due_date = coalesce(p_due_date, due_date),
      subtotal_amount = new_subtotal,
      discount_amount = new_discount,
      tax_amount = new_tax,
      total_amount = new_total,
      paid_amount = 0,
      balance_amount = new_total,
      status = case when coalesce(p_due_date, due_date) is not null and coalesce(p_due_date, due_date) < current_date then 'overdue' else 'issued' end,
      notes = case when p_notes is null then notes else public.validate_finance_text(p_notes, 'Invoice notes', false, 1500) end,
      metadata_json = case when p_metadata_json is null then metadata_json else public.normalize_finance_metadata(p_metadata_json) end
  where id = p_invoice_id;

  perform public.insert_finance_activity(
    invoice_row.tenant_id, invoice_row.student_id, p_invoice_id, null, 'finance_invoice_updated',
    jsonb_build_object('invoice_id', p_invoice_id, 'amount', new_total, 'currency', invoice_row.currency)
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    invoice_row.tenant_id, actor_id, 'finance_invoice_updated', 'finance_invoice',
    p_invoice_id, invoice_row.invoice_number, 'Finance invoice updated.', 'info',
    jsonb_build_object('invoice_id', p_invoice_id, 'student_id', invoice_row.student_id, 'amount', new_total, 'currency', invoice_row.currency)
  );

  return p_invoice_id;
end;
$$;

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.finance_invoices%rowtype;
begin
  select * into invoice_row from public.finance_invoices where id = p_invoice_id for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;

  if actor_id is null or not public.finance_is_owner_admin(invoice_row.tenant_id) then
    raise exception 'Only owners and admins can void invoices.' using errcode = '42501';
  end if;

  if invoice_row.status in ('paid', 'partially_paid') or exists (
    select 1 from public.finance_payments fp
    where fp.invoice_id = p_invoice_id and fp.status in ('recorded', 'confirmed')
  ) then
    raise exception 'Invoices with recorded payments cannot be voided.' using errcode = '42501';
  end if;

  update public.finance_invoices
  set updated_by = actor_id,
      status = 'void'
  where id = p_invoice_id;

  perform public.insert_finance_activity(
    invoice_row.tenant_id, invoice_row.student_id, p_invoice_id, null, 'finance_invoice_voided',
    jsonb_build_object('invoice_id', p_invoice_id, 'reason_present', nullif(trim(coalesce(p_reason, '')), '') is not null)
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    invoice_row.tenant_id, actor_id, 'finance_invoice_voided', 'finance_invoice',
    p_invoice_id, invoice_row.invoice_number, 'Finance invoice voided.', 'warning',
    jsonb_build_object('invoice_id', p_invoice_id, 'student_id', invoice_row.student_id, 'reason_present', nullif(trim(coalesce(p_reason, '')), '') is not null)
  );

  return p_invoice_id;
end;
$$;

create or replace function public.record_payment(
  p_tenant_id uuid,
  p_student_id uuid,
  p_invoice_id uuid default null,
  p_amount numeric default 0,
  p_payment_method text default 'cash',
  p_payment_date date default current_date,
  p_reference_number text default null,
  p_notes text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.finance_invoices%rowtype;
  settings_row public.finance_settings%rowtype;
  normalized_method text := lower(trim(coalesce(p_payment_method, 'cash')));
  receipt_number_value text;
  new_payment_id uuid;
  new_receipt_id uuid;
begin
  if actor_id is null or not public.finance_is_owner_admin(p_tenant_id) then
    raise exception 'Only owners and admins can record payments.' using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;

  if normalized_method not in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'online', 'other') then
    raise exception 'Payment method is invalid.' using errcode = '22023';
  end if;

  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'Payment date cannot be in the future.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.students s where s.id = p_student_id and s.tenant_id = p_tenant_id) then
    raise exception 'Student is not in this tenant.' using errcode = '22023';
  end if;

  if p_invoice_id is not null then
    select * into invoice_row from public.finance_invoices where id = p_invoice_id for update;

    if not found or invoice_row.tenant_id <> p_tenant_id or invoice_row.student_id <> p_student_id then
      raise exception 'Invoice is not in this tenant or student account.' using errcode = '22023';
    end if;

    if invoice_row.status in ('void', 'cancelled') then
      raise exception 'Payment cannot be recorded against a void or cancelled invoice.' using errcode = '42501';
    end if;

    if p_amount > invoice_row.balance_amount then
      raise exception 'Payment would exceed invoice balance.' using errcode = '22023';
    end if;
  end if;

  insert into public.finance_settings (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select * into settings_row from public.finance_settings where tenant_id = p_tenant_id for update;
  receipt_number_value := settings_row.receipt_prefix || lpad(settings_row.next_receipt_number::text, 5, '0');

  update public.finance_settings
  set next_receipt_number = next_receipt_number + 1
  where tenant_id = p_tenant_id;

  insert into public.finance_payments (
    tenant_id, invoice_id, student_id, recorded_by, payment_date, amount,
    currency, payment_method, reference_number, status, notes, metadata_json
  )
  values (
    p_tenant_id, p_invoice_id, p_student_id, actor_id, p_payment_date, p_amount,
    'INR', normalized_method,
    public.validate_finance_text(p_reference_number, 'Payment reference', false, 120),
    'recorded',
    public.validate_finance_text(p_notes, 'Payment notes', false, 1500),
    public.normalize_finance_metadata(p_metadata_json)
  )
  returning id into new_payment_id;

  insert into public.finance_receipts (
    tenant_id, payment_id, student_id, receipt_number, issued_by, amount, currency, status
  )
  values (
    p_tenant_id, new_payment_id, p_student_id, receipt_number_value, actor_id, p_amount, 'INR', 'issued'
  )
  returning id into new_receipt_id;

  if p_invoice_id is not null then
    perform public.finance_recalculate_invoice(p_invoice_id);
  end if;

  perform public.insert_finance_activity(
    p_tenant_id, p_student_id, p_invoice_id, new_payment_id, 'finance_payment_recorded',
    jsonb_build_object('payment_id', new_payment_id, 'receipt_id', new_receipt_id, 'amount', p_amount, 'currency', 'INR', 'payment_method', normalized_method, 'reference_present', nullif(trim(coalesce(p_reference_number, '')), '') is not null)
  );

  perform public.insert_finance_activity(
    p_tenant_id, p_student_id, p_invoice_id, new_payment_id, 'finance_receipt_issued',
    jsonb_build_object('payment_id', new_payment_id, 'receipt_id', new_receipt_id, 'amount', p_amount, 'currency', 'INR')
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    p_tenant_id, actor_id, 'finance_payment_recorded', 'finance_payment',
    new_payment_id, 'Manual payment', 'Manual finance payment recorded. No external payment gateway was called.', 'info',
    jsonb_build_object('payment_id', new_payment_id, 'invoice_id', p_invoice_id, 'student_id', p_student_id, 'amount', p_amount, 'currency', 'INR', 'payment_method', normalized_method, 'reference_present', nullif(trim(coalesce(p_reference_number, '')), '') is not null)
  );

  return new_payment_id;
end;
$$;

create or replace function public.cancel_payment(p_payment_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  payment_row public.finance_payments%rowtype;
begin
  select * into payment_row from public.finance_payments where id = p_payment_id for update;

  if not found then
    raise exception 'Payment not found.' using errcode = '22023';
  end if;

  if actor_id is null or not public.finance_is_owner_admin(payment_row.tenant_id) then
    raise exception 'Only owners and admins can cancel payments.' using errcode = '42501';
  end if;

  if payment_row.status not in ('recorded', 'confirmed') then
    raise exception 'Only recorded or confirmed payments can be cancelled.' using errcode = '42501';
  end if;

  update public.finance_payments
  set status = 'cancelled'
  where id = p_payment_id;

  update public.finance_receipts
  set status = 'cancelled'
  where payment_id = p_payment_id
    and tenant_id = payment_row.tenant_id;

  if payment_row.invoice_id is not null then
    perform public.finance_recalculate_invoice(payment_row.invoice_id);
  end if;

  perform public.insert_finance_activity(
    payment_row.tenant_id, payment_row.student_id, payment_row.invoice_id, p_payment_id, 'finance_payment_cancelled',
    jsonb_build_object('payment_id', p_payment_id, 'amount', payment_row.amount, 'currency', payment_row.currency, 'reason_present', nullif(trim(coalesce(p_reason, '')), '') is not null)
  );

  perform public.insert_finance_activity(
    payment_row.tenant_id, payment_row.student_id, payment_row.invoice_id, p_payment_id, 'finance_receipt_cancelled',
    jsonb_build_object('payment_id', p_payment_id)
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    payment_row.tenant_id, actor_id, 'finance_payment_cancelled', 'finance_payment',
    p_payment_id, 'Manual payment', 'Finance payment cancelled.', 'warning',
    jsonb_build_object('payment_id', p_payment_id, 'invoice_id', payment_row.invoice_id, 'student_id', payment_row.student_id, 'amount', payment_row.amount, 'currency', payment_row.currency, 'reason_present', nullif(trim(coalesce(p_reason, '')), '') is not null)
  );

  return p_payment_id;
end;
$$;

create or replace function public.apply_invoice_adjustment(
  p_invoice_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text,
  p_metadata_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.finance_invoices%rowtype;
  normalized_type text := lower(trim(coalesce(p_adjustment_type, '')));
  new_subtotal numeric;
  new_discount numeric;
  new_tax numeric;
  new_total numeric;
  new_adjustment_id uuid;
begin
  select * into invoice_row from public.finance_invoices where id = p_invoice_id for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;

  if actor_id is null or not public.finance_is_owner_admin(invoice_row.tenant_id) then
    raise exception 'Only owners and admins can apply invoice adjustments.' using errcode = '42501';
  end if;

  if invoice_row.status in ('paid', 'void', 'cancelled') then
    raise exception 'Paid, void, or cancelled invoices cannot be adjusted.' using errcode = '42501';
  end if;

  if normalized_type not in ('discount', 'waiver', 'correction', 'penalty', 'refund_note', 'other') then
    raise exception 'Adjustment type is invalid.' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Adjustment amount must be non-negative.' using errcode = '22023';
  end if;

  new_subtotal := invoice_row.subtotal_amount;
  new_discount := invoice_row.discount_amount;
  new_tax := invoice_row.tax_amount;

  if normalized_type in ('discount', 'waiver') then
    new_discount := new_discount + p_amount;
  elsif normalized_type = 'penalty' then
    new_tax := new_tax + p_amount;
  elsif normalized_type = 'correction' then
    new_subtotal := new_subtotal + p_amount;
  end if;

  new_total := new_subtotal - new_discount + new_tax;

  if new_total < 0 or new_total < invoice_row.paid_amount then
    raise exception 'Adjustment would make invoice total invalid.' using errcode = '22023';
  end if;

  insert into public.finance_adjustments (
    tenant_id, invoice_id, student_id, created_by, adjustment_type,
    amount, reason, status, metadata_json
  )
  values (
    invoice_row.tenant_id, p_invoice_id, invoice_row.student_id, actor_id,
    normalized_type, p_amount,
    public.validate_finance_text(p_reason, 'Adjustment reason', true, 500),
    'applied', public.normalize_finance_metadata(p_metadata_json)
  )
  returning id into new_adjustment_id;

  update public.finance_invoices
  set updated_by = actor_id,
      subtotal_amount = new_subtotal,
      discount_amount = new_discount,
      tax_amount = new_tax,
      total_amount = new_total,
      balance_amount = new_total - paid_amount
  where id = p_invoice_id;

  perform public.finance_recalculate_invoice(p_invoice_id);

  perform public.insert_finance_activity(
    invoice_row.tenant_id, invoice_row.student_id, p_invoice_id, null, 'finance_adjustment_applied',
    jsonb_build_object('adjustment_id', new_adjustment_id, 'adjustment_type', normalized_type, 'amount', p_amount, 'currency', invoice_row.currency, 'reason_present', true)
  );

  insert into public.audit_logs (
    tenant_id, user_id, action, entity_type, entity_id, entity_name,
    description, severity, metadata
  )
  values (
    invoice_row.tenant_id, actor_id, 'finance_adjustment_applied', 'finance_adjustment',
    new_adjustment_id, normalized_type, 'Finance invoice adjustment applied.', 'warning',
    jsonb_build_object('adjustment_id', new_adjustment_id, 'invoice_id', p_invoice_id, 'student_id', invoice_row.student_id, 'adjustment_type', normalized_type, 'amount', p_amount, 'currency', invoice_row.currency, 'reason_present', true)
  );

  return new_adjustment_id;
end;
$$;

create or replace function public.get_finance_dashboard(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.finance_is_owner_admin(p_tenant_id) then
    raise exception 'Only owners and admins can view finance dashboard.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'currency', 'INR',
    'total_invoiced', coalesce((select sum(total_amount) from public.finance_invoices where tenant_id = p_tenant_id and status not in ('void', 'cancelled')), 0),
    'total_collected', coalesce((select sum(amount) from public.finance_payments where tenant_id = p_tenant_id and status in ('recorded', 'confirmed')), 0),
    'total_outstanding', coalesce((select sum(balance_amount) from public.finance_invoices where tenant_id = p_tenant_id and status not in ('paid', 'void', 'cancelled')), 0),
    'overdue_amount', coalesce((select sum(balance_amount) from public.finance_invoices where tenant_id = p_tenant_id and status not in ('paid', 'void', 'cancelled') and due_date < current_date), 0),
    'invoice_counts', coalesce((
      select jsonb_object_agg(status, count)
      from (
        select status, count(*)::integer as count
        from public.finance_invoices
        where tenant_id = p_tenant_id
        group by status
      ) counts
    ), '{}'::jsonb),
    'recent_payments', coalesce((
      select jsonb_agg(item)
      from (
        select jsonb_build_object(
          'id', fp.id,
          'student_id', fp.student_id,
          'invoice_id', fp.invoice_id,
          'amount', fp.amount,
          'currency', fp.currency,
          'payment_method', fp.payment_method,
          'status', fp.status,
          'payment_date', fp.payment_date,
          'created_at', fp.created_at
        ) as item
        from public.finance_payments fp
        where fp.tenant_id = p_tenant_id
        order by fp.created_at desc
        limit 10
      ) recent
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_student_finance_summary(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  student_row public.students%rowtype;
begin
  select * into student_row from public.students where id = p_student_id limit 1;

  if not found then
    raise exception 'Student not found.' using errcode = '22023';
  end if;

  if auth.uid() is null or not (
    public.finance_is_owner_admin(student_row.tenant_id)
    or public.finance_student_can_access(student_row.tenant_id, p_student_id)
  ) then
    raise exception 'You do not have access to this student finance summary.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'student_id', p_student_id,
    'tenant_id', student_row.tenant_id,
    'currency', 'INR',
    'outstanding_amount', coalesce((select sum(balance_amount) from public.finance_invoices where tenant_id = student_row.tenant_id and student_id = p_student_id and status not in ('paid', 'void', 'cancelled')), 0),
    'paid_amount', coalesce((select sum(amount) from public.finance_payments where tenant_id = student_row.tenant_id and student_id = p_student_id and status in ('recorded', 'confirmed')), 0),
    'invoices', coalesce((
      select jsonb_agg(item)
      from (
        select jsonb_build_object(
          'id', fi.id,
          'invoice_number', fi.invoice_number,
          'invoice_date', fi.invoice_date,
          'due_date', fi.due_date,
          'total_amount', fi.total_amount,
          'paid_amount', fi.paid_amount,
          'balance_amount', fi.balance_amount,
          'currency', fi.currency,
          'status', fi.status,
          'course_id', fi.course_id,
          'created_at', fi.created_at
        ) as item
        from public.finance_invoices fi
        where fi.tenant_id = student_row.tenant_id
          and fi.student_id = p_student_id
        order by fi.created_at desc
        limit 50
      ) invoice_items
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(item)
      from (
        select jsonb_build_object(
          'id', fp.id,
          'invoice_id', fp.invoice_id,
          'payment_date', fp.payment_date,
          'amount', fp.amount,
          'currency', fp.currency,
          'payment_method', fp.payment_method,
          'status', fp.status,
          'created_at', fp.created_at
        ) as item
        from public.finance_payments fp
        where fp.tenant_id = student_row.tenant_id
          and fp.student_id = p_student_id
        order by fp.created_at desc
        limit 50
      ) payment_items
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(item)
      from (
        select jsonb_build_object(
          'id', fr.id,
          'payment_id', fr.payment_id,
          'receipt_number', fr.receipt_number,
          'issued_at', fr.issued_at,
          'amount', fr.amount,
          'currency', fr.currency,
          'status', fr.status,
          'created_at', fr.created_at
        ) as item
        from public.finance_receipts fr
        where fr.tenant_id = student_row.tenant_id
          and fr.student_id = p_student_id
        order by fr.created_at desc
        limit 50
      ) receipt_items
    ), '[]'::jsonb)
  );
end;
$$;

drop policy if exists "Finance settings visible to owner admins" on public.finance_settings;
create policy "Finance settings visible to owner admins"
on public.finance_settings
for select
to authenticated
using (public.finance_is_owner_admin(tenant_id));

drop policy if exists "Finance fee plans visible to owner admins" on public.finance_fee_plans;
create policy "Finance fee plans visible to owner admins"
on public.finance_fee_plans
for select
to authenticated
using (public.finance_is_owner_admin(tenant_id));

drop policy if exists "Finance invoices visible by role or student" on public.finance_invoices;
drop policy if exists "Finance invoices visible to owner admins" on public.finance_invoices;
create policy "Finance invoices visible to owner admins"
on public.finance_invoices
for select
to authenticated
using (public.finance_is_owner_admin(tenant_id));

drop policy if exists "Finance payments visible by role or student" on public.finance_payments;
drop policy if exists "Finance payments visible to owner admins" on public.finance_payments;
create policy "Finance payments visible to owner admins"
on public.finance_payments
for select
to authenticated
using (public.finance_is_owner_admin(tenant_id));

drop policy if exists "Finance receipts visible by role or student" on public.finance_receipts;
drop policy if exists "Finance receipts visible to owner admins" on public.finance_receipts;
create policy "Finance receipts visible to owner admins"
on public.finance_receipts
for select
to authenticated
using (public.finance_is_owner_admin(tenant_id));

drop policy if exists "Finance adjustments visible to owner admins" on public.finance_adjustments;
create policy "Finance adjustments visible to owner admins"
on public.finance_adjustments
for select
to authenticated
using (public.finance_is_owner_admin(tenant_id));

drop policy if exists "Finance activity visible to owner admins" on public.finance_activity_logs;
create policy "Finance activity visible to owner admins"
on public.finance_activity_logs
for select
to authenticated
using (public.finance_is_owner_admin(tenant_id));

revoke all on public.finance_settings from anon;
revoke all on public.finance_fee_plans from anon;
revoke all on public.finance_invoices from anon;
revoke all on public.finance_payments from anon;
revoke all on public.finance_receipts from anon;
revoke all on public.finance_adjustments from anon;
revoke all on public.finance_activity_logs from anon;

revoke insert, update, delete on public.finance_settings from authenticated;
revoke insert, update, delete on public.finance_fee_plans from authenticated;
revoke insert, update, delete on public.finance_invoices from authenticated;
revoke insert, update, delete on public.finance_payments from authenticated;
revoke insert, update, delete on public.finance_receipts from authenticated;
revoke insert, update, delete on public.finance_adjustments from authenticated;
revoke insert, update, delete on public.finance_activity_logs from authenticated;

grant select on public.finance_settings to authenticated;
grant select on public.finance_fee_plans to authenticated;
grant select on public.finance_invoices to authenticated;
grant select on public.finance_payments to authenticated;
grant select on public.finance_receipts to authenticated;
grant select on public.finance_adjustments to authenticated;
grant select on public.finance_activity_logs to authenticated;

revoke execute on function public.finance_current_role(uuid) from public, anon;
revoke execute on function public.finance_is_owner_admin(uuid) from public, anon;
revoke execute on function public.finance_student_can_access(uuid, uuid) from public, anon;
revoke execute on function public.finance_row_is_visible(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.validate_finance_text(text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.normalize_finance_metadata(jsonb) from public, anon, authenticated;
revoke execute on function public.insert_finance_activity(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.finance_recalculate_invoice(uuid) from public, anon, authenticated;

revoke execute on function public.upsert_finance_settings(uuid, text, text, integer, jsonb) from public, anon;
revoke execute on function public.create_fee_plan(uuid, text, text, numeric, uuid, text, integer, integer, jsonb) from public, anon;
revoke execute on function public.update_fee_plan(uuid, text, text, numeric, text, text, integer, integer, jsonb) from public, anon;
revoke execute on function public.create_invoice(uuid, uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, jsonb) from public, anon;
revoke execute on function public.update_invoice(uuid, date, numeric, numeric, numeric, text, jsonb) from public, anon;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
revoke execute on function public.record_payment(uuid, uuid, uuid, numeric, text, date, text, text, jsonb) from public, anon;
revoke execute on function public.cancel_payment(uuid, text) from public, anon;
revoke execute on function public.apply_invoice_adjustment(uuid, text, numeric, text, jsonb) from public, anon;
revoke execute on function public.get_finance_dashboard(uuid) from public, anon;
revoke execute on function public.get_student_finance_summary(uuid) from public, anon;

grant execute on function public.finance_current_role(uuid) to authenticated;
grant execute on function public.finance_is_owner_admin(uuid) to authenticated;
grant execute on function public.finance_student_can_access(uuid, uuid) to authenticated;

grant execute on function public.upsert_finance_settings(uuid, text, text, integer, jsonb) to authenticated;
grant execute on function public.create_fee_plan(uuid, text, text, numeric, uuid, text, integer, integer, jsonb) to authenticated;
grant execute on function public.update_fee_plan(uuid, text, text, numeric, text, text, integer, integer, jsonb) to authenticated;
grant execute on function public.create_invoice(uuid, uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.update_invoice(uuid, date, numeric, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated;
grant execute on function public.record_payment(uuid, uuid, uuid, numeric, text, date, text, text, jsonb) to authenticated;
grant execute on function public.cancel_payment(uuid, text) to authenticated;
grant execute on function public.apply_invoice_adjustment(uuid, text, numeric, text, jsonb) to authenticated;
grant execute on function public.get_finance_dashboard(uuid) to authenticated;
grant execute on function public.get_student_finance_summary(uuid) to authenticated;
