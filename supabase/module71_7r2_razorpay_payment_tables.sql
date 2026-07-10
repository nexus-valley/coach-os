-- Module 71.7R2: Razorpay Payment Tables SQL Proposal
-- Review before execution. Do not run until approved.
--
-- Purpose:
-- - Create storage and idempotency foundations for future Razorpay order,
--   payment attempt, webhook, and verified-payment activation workflows.
-- - Do not create payment orders, call Razorpay, start checkout, activate a
--   plan, change tenant assignment, or unlock payment gateway behavior.
--
-- Payment safety rule:
-- Browser checkout success must never activate a tenant plan by itself.
-- Future activation must be performed only after server-side verified
-- payment/order/webhook processing, and must be idempotent.

begin;

create table if not exists public.tenant_payment_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  price_id uuid not null references public.subscription_plan_prices(id) on delete restrict,
  plan_code text not null,
  billing_cycle text not null,
  currency text not null,
  amount_minor bigint not null,
  setup_fee_amount_minor bigint not null default 0,
  tax_amount_minor bigint,
  total_amount_minor bigint not null,
  provider text not null default 'razorpay',
  provider_mode text not null default 'test',
  provider_order_id text,
  provider_receipt text,
  provider_status text,
  internal_status text not null default 'created',
  idempotency_key text not null,
  checkout_session_nonce text,
  checkout_enabled_source text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  constraint tenant_payment_orders_billing_cycle_check
    check (billing_cycle in ('monthly', 'yearly', 'custom')),
  constraint tenant_payment_orders_currency_check
    check (currency = 'INR'),
  constraint tenant_payment_orders_provider_check
    check (provider = 'razorpay'),
  constraint tenant_payment_orders_provider_mode_check
    check (provider_mode in ('test', 'live')),
  constraint tenant_payment_orders_internal_status_check
    check (
      internal_status in (
        'created',
        'provider_order_created',
        'checkout_started',
        'payment_authorized',
        'payment_captured',
        'order_paid',
        'failed',
        'cancelled',
        'expired',
        'activation_pending',
        'activated'
      )
    ),
  constraint tenant_payment_orders_amount_minor_check
    check (amount_minor >= 0),
  constraint tenant_payment_orders_setup_fee_amount_minor_check
    check (setup_fee_amount_minor >= 0),
  constraint tenant_payment_orders_tax_amount_minor_check
    check (tax_amount_minor is null or tax_amount_minor >= 0),
  constraint tenant_payment_orders_total_amount_minor_check
    check (total_amount_minor >= amount_minor),
  constraint tenant_payment_orders_plan_code_check
    check (char_length(btrim(plan_code)) between 1 and 80 and plan_code !~ '[<>]'),
  constraint tenant_payment_orders_provider_order_id_check
    check (provider_order_id is null or (char_length(provider_order_id) <= 160 and provider_order_id !~ '[<>]')),
  constraint tenant_payment_orders_provider_receipt_check
    check (provider_receipt is null or (char_length(provider_receipt) <= 160 and provider_receipt !~ '[<>]')),
  constraint tenant_payment_orders_provider_status_check
    check (provider_status is null or (char_length(provider_status) <= 80 and provider_status !~ '[<>]')),
  constraint tenant_payment_orders_idempotency_key_check
    check (char_length(idempotency_key) between 8 and 200 and idempotency_key !~ '[<>]'),
  constraint tenant_payment_orders_checkout_session_nonce_check
    check (checkout_session_nonce is null or (char_length(checkout_session_nonce) <= 200 and checkout_session_nonce !~ '[<>]')),
  constraint tenant_payment_orders_checkout_enabled_source_check
    check (checkout_enabled_source is null or (char_length(checkout_enabled_source) <= 120 and checkout_enabled_source !~ '[<>]')),
  constraint tenant_payment_orders_metadata_json_object_check
    check (jsonb_typeof(metadata_json) = 'object'),
  constraint tenant_payment_orders_metadata_json_size_check
    check (char_length(metadata_json::text) <= 8000)
);

comment on table public.tenant_payment_orders is
  'Internal Razorpay order records. R2 storage only; browser checkout success does not activate tenant plans.';
comment on column public.tenant_payment_orders.internal_status is
  'Internal order lifecycle. Plan activation is deferred to a later verified-payment activation module.';
comment on column public.tenant_payment_orders.checkout_session_nonce is
  'Optional nonce for future browser checkout correlation. It is not an activation credential.';
comment on column public.tenant_payment_orders.metadata_json is
  'Operational metadata only. Do not store secrets or trust browser-provided activation state here.';

create unique index if not exists tenant_payment_orders_idempotency_key_uidx
  on public.tenant_payment_orders(idempotency_key);

create unique index if not exists tenant_payment_orders_provider_order_id_uidx
  on public.tenant_payment_orders(provider_order_id)
  where provider_order_id is not null;

create index if not exists tenant_payment_orders_tenant_status_created_idx
  on public.tenant_payment_orders(tenant_id, internal_status, created_at desc);

create index if not exists tenant_payment_orders_tenant_plan_created_idx
  on public.tenant_payment_orders(tenant_id, plan_id, created_at desc);

create index if not exists tenant_payment_orders_price_created_idx
  on public.tenant_payment_orders(price_id, created_at desc);

create index if not exists tenant_payment_orders_provider_status_idx
  on public.tenant_payment_orders(provider_status, created_at desc)
  where provider_status is not null;

drop trigger if exists set_tenant_payment_orders_updated_at on public.tenant_payment_orders;
create trigger set_tenant_payment_orders_updated_at
before update on public.tenant_payment_orders
for each row execute function public.set_updated_at();

create table if not exists public.tenant_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.tenant_payment_orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'razorpay',
  provider_mode text not null default 'test',
  provider_order_id text,
  provider_payment_id text,
  provider_signature text,
  signature_valid boolean,
  provider_status text,
  internal_status text not null default 'received',
  amount_minor bigint,
  currency text,
  captured_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_reason text,
  raw_payload_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_payment_attempts_provider_check
    check (provider = 'razorpay'),
  constraint tenant_payment_attempts_provider_mode_check
    check (provider_mode in ('test', 'live')),
  constraint tenant_payment_attempts_internal_status_check
    check (
      internal_status in (
        'received',
        'signature_verified',
        'signature_failed',
        'authorized',
        'captured',
        'failed',
        'ignored'
      )
    ),
  constraint tenant_payment_attempts_amount_minor_check
    check (amount_minor is null or amount_minor >= 0),
  constraint tenant_payment_attempts_currency_check
    check (currency is null or currency = 'INR'),
  constraint tenant_payment_attempts_provider_order_id_check
    check (provider_order_id is null or (char_length(provider_order_id) <= 160 and provider_order_id !~ '[<>]')),
  constraint tenant_payment_attempts_provider_payment_id_check
    check (provider_payment_id is null or (char_length(provider_payment_id) <= 160 and provider_payment_id !~ '[<>]')),
  constraint tenant_payment_attempts_provider_signature_check
    check (provider_signature is null or (char_length(provider_signature) <= 512 and provider_signature !~ '[<>]')),
  constraint tenant_payment_attempts_provider_status_check
    check (provider_status is null or (char_length(provider_status) <= 80 and provider_status !~ '[<>]')),
  constraint tenant_payment_attempts_failure_code_check
    check (failure_code is null or (char_length(failure_code) <= 120 and failure_code !~ '[<>]')),
  constraint tenant_payment_attempts_failure_reason_check
    check (failure_reason is null or (char_length(failure_reason) <= 600 and failure_reason !~ '[<>]')),
  constraint tenant_payment_attempts_raw_payload_json_object_check
    check (jsonb_typeof(raw_payload_json) = 'object'),
  constraint tenant_payment_attempts_metadata_json_object_check
    check (jsonb_typeof(metadata_json) = 'object'),
  constraint tenant_payment_attempts_metadata_json_size_check
    check (char_length(metadata_json::text) <= 8000)
);

comment on table public.tenant_payment_attempts is
  'Razorpay payment attempts and browser callback verification audit. Attempts alone do not activate tenant plans.';
comment on column public.tenant_payment_attempts.provider_signature is
  'Razorpay checkout signature captured for server-side verification. Do not expose in client-facing payloads.';
comment on column public.tenant_payment_attempts.signature_valid is
  'Result of future server-side signature verification. Browser-provided success is not sufficient for activation.';

create unique index if not exists tenant_payment_attempts_provider_payment_id_uidx
  on public.tenant_payment_attempts(provider_payment_id)
  where provider_payment_id is not null;

create index if not exists tenant_payment_attempts_payment_order_idx
  on public.tenant_payment_attempts(payment_order_id, created_at desc);

create index if not exists tenant_payment_attempts_tenant_created_idx
  on public.tenant_payment_attempts(tenant_id, created_at desc);

create index if not exists tenant_payment_attempts_provider_order_idx
  on public.tenant_payment_attempts(provider_order_id, created_at desc)
  where provider_order_id is not null;

create index if not exists tenant_payment_attempts_internal_status_idx
  on public.tenant_payment_attempts(internal_status, created_at desc);

drop trigger if exists set_tenant_payment_attempts_updated_at on public.tenant_payment_attempts;
create trigger set_tenant_payment_attempts_updated_at
before update on public.tenant_payment_attempts
for each row execute function public.set_updated_at();

create table if not exists public.razorpay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text,
  event_type text not null,
  provider text not null default 'razorpay',
  provider_mode text not null default 'test',
  signature_header text,
  signature_valid boolean not null default false,
  payload_hash text not null,
  payload_json jsonb not null,
  related_provider_order_id text,
  related_provider_payment_id text,
  processing_status text not null default 'received',
  processed_at timestamptz,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint razorpay_webhook_events_provider_check
    check (provider = 'razorpay'),
  constraint razorpay_webhook_events_provider_mode_check
    check (provider_mode in ('test', 'live')),
  constraint razorpay_webhook_events_processing_status_check
    check (processing_status in ('received', 'verified', 'ignored', 'processed', 'failed', 'duplicate')),
  constraint razorpay_webhook_events_provider_event_id_check
    check (provider_event_id is null or (char_length(provider_event_id) <= 200 and provider_event_id !~ '[<>]')),
  constraint razorpay_webhook_events_event_type_check
    check (char_length(btrim(event_type)) between 1 and 120 and event_type !~ '[<>]'),
  constraint razorpay_webhook_events_signature_header_check
    check (signature_header is null or (char_length(signature_header) <= 512 and signature_header !~ '[<>]')),
  constraint razorpay_webhook_events_payload_hash_check
    check (char_length(payload_hash) between 32 and 200 and payload_hash !~ '[<>]'),
  constraint razorpay_webhook_events_related_order_id_check
    check (related_provider_order_id is null or (char_length(related_provider_order_id) <= 160 and related_provider_order_id !~ '[<>]')),
  constraint razorpay_webhook_events_related_payment_id_check
    check (related_provider_payment_id is null or (char_length(related_provider_payment_id) <= 160 and related_provider_payment_id !~ '[<>]')),
  constraint razorpay_webhook_events_error_message_check
    check (error_message is null or (char_length(error_message) <= 1200 and error_message !~ '[<>]')),
  constraint razorpay_webhook_events_payload_json_object_check
    check (jsonb_typeof(payload_json) = 'object'),
  constraint razorpay_webhook_events_metadata_json_object_check
    check (jsonb_typeof(metadata_json) = 'object'),
  constraint razorpay_webhook_events_metadata_json_size_check
    check (char_length(metadata_json::text) <= 8000)
);

comment on table public.razorpay_webhook_events is
  'Razorpay webhook receipt and idempotency audit. Future webhook route must validate raw-body signature before processing.';
comment on column public.razorpay_webhook_events.payload_hash is
  'Hash of raw webhook body used as fallback idempotency key when provider event id is unavailable.';
comment on column public.razorpay_webhook_events.signature_valid is
  'Signature validation result. Unverified webhook rows must not trigger activation.';

create unique index if not exists razorpay_webhook_events_provider_event_uidx
  on public.razorpay_webhook_events(provider, provider_event_id)
  where provider_event_id is not null;

create unique index if not exists razorpay_webhook_events_provider_payload_hash_uidx
  on public.razorpay_webhook_events(provider, payload_hash);

create index if not exists razorpay_webhook_events_event_type_idx
  on public.razorpay_webhook_events(event_type, received_at desc);

create index if not exists razorpay_webhook_events_related_order_idx
  on public.razorpay_webhook_events(related_provider_order_id, received_at desc)
  where related_provider_order_id is not null;

create index if not exists razorpay_webhook_events_related_payment_idx
  on public.razorpay_webhook_events(related_provider_payment_id, received_at desc)
  where related_provider_payment_id is not null;

create index if not exists razorpay_webhook_events_processing_status_idx
  on public.razorpay_webhook_events(processing_status, received_at desc);

create table if not exists public.tenant_plan_activation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_order_id uuid not null references public.tenant_payment_orders(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  price_id uuid not null references public.subscription_plan_prices(id) on delete restrict,
  previous_assignment_id uuid references public.tenant_subscription_assignments(id) on delete set null,
  new_assignment_id uuid references public.tenant_subscription_assignments(id) on delete set null,
  activation_status text not null default 'pending',
  idempotency_key text not null,
  activation_source text not null default 'verified_payment',
  provider text not null default 'razorpay',
  provider_order_id text,
  provider_payment_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  failed_at timestamptz,
  error_message text,
  constraint tenant_plan_activation_events_activation_status_check
    check (
      activation_status in (
        'pending',
        'activated',
        'skipped_already_active',
        'failed',
        'rolled_back'
      )
    ),
  constraint tenant_plan_activation_events_activation_source_check
    check (activation_source = 'verified_payment'),
  constraint tenant_plan_activation_events_provider_check
    check (provider = 'razorpay'),
  constraint tenant_plan_activation_events_idempotency_key_check
    check (char_length(idempotency_key) between 8 and 200 and idempotency_key !~ '[<>]'),
  constraint tenant_plan_activation_events_provider_order_id_check
    check (provider_order_id is null or (char_length(provider_order_id) <= 160 and provider_order_id !~ '[<>]')),
  constraint tenant_plan_activation_events_provider_payment_id_check
    check (provider_payment_id is null or (char_length(provider_payment_id) <= 160 and provider_payment_id !~ '[<>]')),
  constraint tenant_plan_activation_events_error_message_check
    check (error_message is null or (char_length(error_message) <= 1200 and error_message !~ '[<>]')),
  constraint tenant_plan_activation_events_metadata_json_object_check
    check (jsonb_typeof(metadata_json) = 'object'),
  constraint tenant_plan_activation_events_metadata_json_size_check
    check (char_length(metadata_json::text) <= 8000)
);

comment on table public.tenant_plan_activation_events is
  'Future verified-payment to canonical plan activation idempotency and audit table. R2 creates no activation RPC.';
comment on column public.tenant_plan_activation_events.activation_source is
  'Activation source is restricted to verified_payment. Browser callbacks are not activation sources.';
comment on column public.tenant_plan_activation_events.new_assignment_id is
  'Populated only by a future activation module after server-side payment verification.';

create unique index if not exists tenant_plan_activation_events_payment_order_uidx
  on public.tenant_plan_activation_events(payment_order_id);

create unique index if not exists tenant_plan_activation_events_idempotency_key_uidx
  on public.tenant_plan_activation_events(idempotency_key);

create index if not exists tenant_plan_activation_events_tenant_created_idx
  on public.tenant_plan_activation_events(tenant_id, created_at desc);

create index if not exists tenant_plan_activation_events_plan_created_idx
  on public.tenant_plan_activation_events(plan_id, created_at desc);

create index if not exists tenant_plan_activation_events_status_idx
  on public.tenant_plan_activation_events(activation_status, created_at desc);

create index if not exists tenant_plan_activation_events_provider_order_idx
  on public.tenant_plan_activation_events(provider_order_id, created_at desc)
  where provider_order_id is not null;

create index if not exists tenant_plan_activation_events_provider_payment_idx
  on public.tenant_plan_activation_events(provider_payment_id, created_at desc)
  where provider_payment_id is not null;

alter table public.tenant_payment_orders enable row level security;
alter table public.tenant_payment_attempts enable row level security;
alter table public.razorpay_webhook_events enable row level security;
alter table public.tenant_plan_activation_events enable row level security;

revoke all on table public.tenant_payment_orders from public, anon, authenticated;
revoke all on table public.tenant_payment_attempts from public, anon, authenticated;
revoke all on table public.razorpay_webhook_events from public, anon, authenticated;
revoke all on table public.tenant_plan_activation_events from public, anon, authenticated;

commit;

-- Verification SQL for later review/execution only:
--
-- 1. Confirm R2 tables exist:
-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name in (
--     'tenant_payment_orders',
--     'tenant_payment_attempts',
--     'razorpay_webhook_events',
--     'tenant_plan_activation_events'
--   )
-- order by table_name;
--
-- 2. Confirm RLS is enabled:
-- select c.relname as table_name, c.relrowsecurity as rls_enabled
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in (
--     'tenant_payment_orders',
--     'tenant_payment_attempts',
--     'razorpay_webhook_events',
--     'tenant_plan_activation_events'
--   )
-- order by c.relname;
--
-- 3. Confirm direct grants are not opened to PUBLIC/anon/authenticated:
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in (
--     'tenant_payment_orders',
--     'tenant_payment_attempts',
--     'razorpay_webhook_events',
--     'tenant_plan_activation_events'
--   )
--   and grantee in ('PUBLIC', 'anon', 'authenticated')
-- order by table_name, grantee, privilege_type;
--
-- 4. Confirm idempotency and lookup indexes exist:
-- select tablename, indexname
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename in (
--     'tenant_payment_orders',
--     'tenant_payment_attempts',
--     'razorpay_webhook_events',
--     'tenant_plan_activation_events'
--   )
-- order by tablename, indexname;
--
-- 5. Confirm all R2 tables are initially empty:
-- select 'tenant_payment_orders' as table_name, count(*) as row_count
-- from public.tenant_payment_orders
-- union all
-- select 'tenant_payment_attempts' as table_name, count(*) as row_count
-- from public.tenant_payment_attempts
-- union all
-- select 'razorpay_webhook_events' as table_name, count(*) as row_count
-- from public.razorpay_webhook_events
-- union all
-- select 'tenant_plan_activation_events' as table_name, count(*) as row_count
-- from public.tenant_plan_activation_events
-- order by table_name;
--
-- 6. Confirm public catalog remains empty:
-- select public.get_public_plan_catalog();
--
-- 7. Confirm plans remain draft/private:
-- select code, status, is_public
-- from public.subscription_plans
-- where code in ('starter', 'growth', 'premium')
-- order by code;
--
-- 8. Confirm INR pricing remains finalized but checkout metadata remains disabled:
-- select
--   p.code,
--   spp.currency,
--   spp.billing_cycle,
--   spp.amount_minor,
--   spp.status,
--   spp.metadata_json->>'checkout_enabled' as checkout_enabled,
--   spp.metadata_json->>'pricing_finalized_module' as pricing_finalized_module
-- from public.subscription_plan_prices spp
-- join public.subscription_plans p on p.id = spp.plan_id
-- where p.code in ('starter', 'growth', 'premium')
--   and spp.currency = 'INR'
-- order by p.code, spp.billing_cycle;
--
-- 9. Confirm payment_gateway/live_classes remain globally locked/coming soon:
-- select public.subscription_entitlements_global_locked_features();
-- select public.resolve_effective_feature_access(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'payment_gateway'
-- );
-- select public.resolve_effective_feature_access(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid,
--   'live_classes'
-- );
--
-- 10. Confirm regression tenant assignment unchanged:
-- select public.get_tenant_entitlement_state(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- )->'assignment';
--
-- 11. Confirm existing Growth request remains approved/blocked:
-- select public.get_tenant_requestable_plan_catalog(
--   '29a33701-82ed-4c7f-8042-0a1af8296ce5'::uuid
-- );
--
-- 12. Confirm request option rows were not changed by this module:
-- select *
-- from public.subscription_plan_request_options
-- where id = 'a040c5b1-e7a3-42dd-ad4f-56f250195013'::uuid;
--
-- Rollback SQL for later review only:
-- begin;
-- drop table if exists public.tenant_plan_activation_events;
-- drop table if exists public.razorpay_webhook_events;
-- drop table if exists public.tenant_payment_attempts;
-- drop table if exists public.tenant_payment_orders;
-- commit;
