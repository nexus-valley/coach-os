-- Optional index for faster reporting
create index if not exists payments_tenant_paid_at_idx
on public.payments (tenant_id, paid_at desc);

create index if not exists students_tenant_created_idx
on public.students (tenant_id, created_at desc);

create index if not exists enrollments_tenant_created_idx
on public.enrollments (tenant_id, created_at desc);