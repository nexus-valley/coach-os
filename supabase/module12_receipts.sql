alter table public.payments
add column if not exists receipt_number text,
add column if not exists receipt_generated_at timestamptz;

create unique index if not exists payments_receipt_number_unique_idx
on public.payments (tenant_id, receipt_number)
where receipt_number is not null;