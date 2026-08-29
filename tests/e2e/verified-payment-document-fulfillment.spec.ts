import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8f_verified_payment_document_fulfillment.sql",
);
const activationMigration = read(
  "supabase/module71_7r5_verified_payment_activation_rpc.sql",
);
const orderRoute = read("app/api/billing/razorpay/orders/route.ts");
const webhookRoute = read("app/api/billing/razorpay/webhook/route.ts");
const ux8eMigration = read(
  "supabase/bundle_ux8e_platform_invoice_receipt_foundation.sql",
);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected exactly one executable transaction").toHaveLength(1);
  return matches?.[0] ?? "";
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1] ?? "";
}

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create function ${schema}\\.${name}\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8F1 verified payment and document fulfillment", () => {
  test("keeps PRE and POST read-only and APPLY transactional", () => {
    for (const block of [
      verificationBlock("PRE-APPLY"),
      verificationBlock("POST-APPLY"),
    ]) {
      expect(block).not.toMatch(
        /\b(insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index|trigger)|drop\s+(?:table|function)|truncate\s+(?:table\s+)?|merge\s+into)\b/i,
      );
    }

    expect(executableSql()).not.toMatch(/\bcascade\b/i);
    expect(executableSql()).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from)\s+public\.finance_/i,
    );
    expect(executableSql()).not.toMatch(
      /select\s+public\.(?:issue_platform_invoice_for_activation_server|issue_platform_payment_receipt)/i,
    );
  });

  test("fails closed on prerequisite drift and creates no payment or document rows", () => {
    const sql = executableSql().toLowerCase();
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    expect(sql).toContain("ux-8f1 required relations are missing");
    expect(sql).toContain("ux-8f1 idempotency prerequisites are incomplete");
    expect(sql).toContain("conflicting ux-8f1 objects already exist");
    expect(sql).toContain("requires explicit compatibility review for existing payment or platform-document rows");
    expect(pre).toContain("ready_for_apply");
    expect(pre).toContain("ux8f_objects_clear");
    expect(pre).toContain("indexes_ready");
    expect(post).toContain("security_gate");
    expect(post).toContain("payment_orders_unchanged");
    expect(post).toContain("invoices_unchanged");
    expect(post).toContain("receipts_unchanged");
  });

  test("requires one exact signed captured attempt and processed captured webhook", () => {
    const trigger = functionBody(
      "coachfort_internal",
      "enforce_captured_attempt_activation_authority",
    ).toLowerCase();

    expect(trigger).toContain("new.payment_order_id");
    expect(trigger).toContain("attempt.payment_order_id = v_order.id");
    expect(trigger).toContain("attempt.tenant_id = v_order.tenant_id");
    expect(trigger).toContain("attempt.internal_status = 'captured'");
    expect(trigger).toContain("coalesce(attempt.signature_valid, false) is true");
    expect(trigger).toContain("attempt.captured_at is not null");
    expect(trigger).toContain("attempt.provider_payment_id is not null");
    expect(trigger).toContain("attempt.provider = v_order.provider");
    expect(trigger).toContain("attempt.provider_mode = v_order.provider_mode");
    expect(trigger).toContain("attempt.provider_order_id is not distinct from v_order.provider_order_id");
    expect(trigger).toContain("attempt.amount_minor is not distinct from v_order.total_amount_minor");
    expect(trigger).toContain("attempt.currency is not distinct from v_order.currency");
    expect(trigger).toContain("event.processing_status = 'processed'");
    expect(trigger).toContain("event.event_type = 'payment.captured'");
    expect(trigger).toContain("'captured_attempt_id', v_attempt.id");
  });

  test("preserves payment-order activation identity and duplicate replay", () => {
    const activation = activationMigration.toLowerCase();
    expect(activation).toContain(
      "create or replace function public.activate_tenant_plan_after_verified_payment(\n  p_payment_order_id uuid",
    );
    expect(activation).toContain("perform pg_advisory_xact_lock");
    expect(activation).toContain("where payment_order_id = p_payment_order_id");
    expect(activation).toContain("if found then");
    expect(activation).toContain("'idempotent', true");
    expect(migration).not.toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+public\.activate_tenant_plan_after_verified_payment/i,
    );
  });

  test("blocks repeat same-plan checkout before provider contact", () => {
    const authority = functionBody(
      "public",
      "create_platform_payment_order_authority_server",
    ).toLowerCase();
    const authorityCall = orderRoute.indexOf(
      '"create_platform_payment_order_authority_server"',
    );
    const providerCall = orderRoute.indexOf("await createRazorpayOrder");

    expect(authority).toContain("pg_advisory_xact_lock");
    expect(authority).toContain("v_current.plan_id = p_plan_id");
    expect(authority).toContain("v_current.billing_cycle = v_price.billing_cycle");
    expect(authority).toContain("v_current.status = 'active'");
    expect(authority).toContain("v_current.payment_status = 'paid'");
    const repeatGate = authority.slice(
      authority.indexOf("if v_current.id is not null"),
      authority.indexOf("v_tax_calculation_status := case"),
    );
    expect(repeatGate).not.toContain("metadata_json->>'price_id'");
    expect(authority).toContain("renewal checkout is not available yet");
    expect(authority).toContain("from public.tenant_payment_orders existing_order");
    expect(authority).toContain(
      "existing_order.internal_status not in ('failed','cancelled','expired','activated')",
    );
    expect(authority).toContain("checkout for this plan and billing cycle is already in progress");
    expect(orderRoute).toContain("already in progress");
    expect(authorityCall).toBeGreaterThan(-1);
    expect(providerCall).toBeGreaterThan(authorityCall);
  });

  test("gates checkout on canonical billing and issuer authority", () => {
    const authority = functionBody(
      "public",
      "create_platform_payment_order_authority_server",
    ).toLowerCase();

    for (const field of [
      "legal_name",
      "billing_email",
      "address_line1",
      "city",
      "postal_code",
      "country",
      "preferred_currency",
    ]) {
      expect(authority).toContain(`v_profile.${field}`);
    }
    expect(authority).toContain("billing_profile_currency_for_country");
    expect(authority).toContain("v_profile.preferred_currency is distinct from v_price.currency");
    expect(authority).toContain("from public.platform_billing_issuer_profiles");
    expect(authority).toContain("profile_key = 'default'");
    expect(authority).toContain("status = 'active'");
    expect(authority).toContain("effective_from <= now()");
    expect(authority).toContain("issuer profile is not configured");
  });

  test("creates immutable commercial snapshots only inside service authority", () => {
    const sql = executableSql().toLowerCase();
    const authority = functionBody(
      "public",
      "create_platform_payment_order_authority_server",
    ).toLowerCase();
    const immutable = functionBody(
      "coachfort_internal",
      "enforce_payment_order_commercial_snapshot_immutability",
    ).toLowerCase();

    expect(authority).toContain("from public.tenant_billing_profiles");
    expect(authority).toContain("from public.platform_billing_issuer_profiles");
    expect(authority).toContain("from public.subscription_plan_prices");
    expect(authority).toContain("v_billing_snapshot := jsonb_build_object");
    expect(authority).toContain("v_issuer_snapshot := jsonb_build_object");
    expect(authority).toContain("v_plan_snapshot := jsonb_build_object");
    expect(authority).toContain("'unit_amount_minor', v_price.amount_minor");
    expect(orderRoute).not.toMatch(/body\.(?:billingSnapshot|issuerSnapshot|planSnapshot)/);
    expect(orderRoute).not.toContain('.from("tenant_payment_orders").insert');
    expect(immutable).toContain("new.billing_snapshot is distinct from old.billing_snapshot");
    expect(immutable).toContain("new.issuer_snapshot is distinct from old.issuer_snapshot");
    expect(immutable).toContain("new.plan_snapshot is distinct from old.plan_snapshot");
    expect(sql).toContain("tenant_payment_orders_commercial_total_check");
  });

  test("keeps SQL-first rollout compatible while new authority writes complete snapshots", () => {
    const sql = executableSql().toLowerCase();
    const authority = functionBody(
      "public",
      "create_platform_payment_order_authority_server",
    ).toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    expect(migration).toContain(
      "baseline a4b7aa9 inserts payment orders\n-- directly without these fields",
    );
    for (const definition of [
      "add column billing_snapshot jsonb",
      "add column issuer_snapshot jsonb",
      "add column plan_snapshot jsonb",
      "add column tax_calculation_status text",
    ]) {
      expect(sql).toContain(definition);
      expect(sql).not.toContain(`${definition} not null`);
    }
    expect(sql).toContain("tenant_payment_orders_snapshot_presence_check");
    expect(sql).toContain("billing_snapshot is null");
    expect(sql).toContain("billing_snapshot is not null");
    expect(authority).toContain(
      "checkout_enabled_source, metadata_json, billing_snapshot",
    );
    expect(authority).toContain("issuer_snapshot, plan_snapshot, expires_at");
    expect(authority).toMatch(
      /v_order_metadata,\s*v_billing_snapshot,\s*v_issuer_snapshot,\s*v_plan_snapshot/,
    );
    expect(post).toContain("nullable_snapshot_columns");
    expect(post).toContain("new_authority_snapshots_complete");
  });

  test("models one durable fulfillment per activation, order, attempt, invoice, and receipt", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).toContain("create table public.platform_billing_document_fulfillments");
    for (const relationship of [
      "activation_event_id",
      "payment_order_id",
      "payment_attempt_id",
      "subscription_assignment_id",
    ]) {
      expect(sql).toContain(`${relationship} uuid not null references`);
    }
    for (const constraint of [
      "platform_billing_document_fulfillments_activation_key",
      "platform_billing_document_fulfillments_order_key",
      "platform_billing_document_fulfillments_attempt_key",
      "platform_billing_document_fulfillments_invoice_key",
      "platform_billing_document_fulfillments_receipt_key",
    ]) {
      expect(sql).toContain(constraint);
    }
    expect(sql).toContain(
      "status in ('pending','processing','retryable','blocked_prerequisite','manual_review','completed')",
    );
  });

  test("discovers crash-gap work idempotently from exact activation authority", () => {
    const discovery = functionBody(
      "public",
      "discover_platform_billing_document_fulfillments_server",
    ).toLowerCase();
    expect(discovery).toContain("activation.activation_status in ('activated','skipped_already_active')");
    expect(discovery).toContain("attempt.id::text = activation.metadata_json->>'captured_attempt_id'");
    expect(discovery).toContain("attempt.internal_status = 'captured'");
    expect(discovery).toContain("attempt.amount_minor = payment_order.total_amount_minor");
    expect(discovery).toContain("event.processing_status = 'processed'");
    expect(discovery).toContain("event.event_type = 'payment.captured'");
    expect(discovery).toContain("not exists");
    expect(discovery).toContain("insert into public.platform_billing_document_fulfillments");
    expect(discovery).toContain("on conflict do nothing");
  });

  test("claims bounded work with skip-locked leases and stale recovery", () => {
    const claim = functionBody(
      "public",
      "claim_platform_billing_document_fulfillments_server",
    ).toLowerCase();
    expect(claim).toContain("p_batch_size not between 1 and 25");
    expect(claim).toContain("p_lease_seconds not between 30 and 900");
    expect(claim.match(/for update skip locked/g)?.length).toBe(2);
    expect(claim.match(/limit p_batch_size/g)?.length).toBe(2);
    expect(claim).toContain("fulfillment.lease_expires_at <= now()");
    expect(claim).toContain("attempt_count < 5");
    expect(claim).toContain("attempt_count = fulfillment.attempt_count + 1");
    expect(claim).toContain("lease_expires_at = now() + make_interval");
  });

  test("resumes only revalidated blocked fulfillment without corrupting durable authority", () => {
    const recovery = functionBody(
      "public",
      "resume_platform_billing_document_fulfillment_server",
    ).toLowerCase();
    const finalize = functionBody(
      "public",
      "finalize_platform_billing_document_fulfillment_server",
    ).toLowerCase();

    expect(recovery).toContain("status in ('retryable','completed')");
    expect(recovery).toContain("status <> 'blocked_prerequisite'");
    expect(recovery).toContain("attempt_count >= 5");
    expect(recovery).toContain("verified fulfillment authority is not safe to resume");
    expect(recovery).toContain("persisted invoice authority is not safe to resume");
    expect(recovery).toContain("persisted receipt authority is not safe to resume");
    expect(recovery).toContain("update public.platform_billing_document_fulfillments");
    expect(recovery).toContain("set status = 'retryable'");
    expect(recovery).toContain("next_attempt_at = now()");
    expect(recovery).not.toMatch(/(?:invoice_id|receipt_id)\s*=\s*null/);
    expect(recovery).not.toMatch(
      /update public\.(?:tenant_payment_orders|tenant_payment_attempts|tenant_plan_activation_events|tenant_subscription_assignments|invoices|platform_billing_receipts)/,
    );
    expect(finalize).toContain(
      "p_outcome in ('retryable','blocked_prerequisite') and v_fulfillment.attempt_count >= 5",
    );
    expect(finalize).toContain("v_status := 'manual_review'");
  });

  test("persists invoice-only progress and requires an exact claim token", () => {
    const finalize = functionBody(
      "public",
      "finalize_platform_billing_document_fulfillment_server",
    ).toLowerCase();
    expect(finalize).toContain("where id = p_fulfillment_id");
    expect(finalize).toContain("for update");
    expect(finalize).toContain("v_fulfillment.claim_token <> p_claim_token");
    expect(finalize).toContain("lease_expires_at <= now()");
    expect(finalize).toContain("if p_outcome = 'invoice_issued' then");
    expect(finalize).toContain("set invoice_id = p_invoice_id");
    expect(finalize).toContain("return 'processing'");
    expect(finalize).toContain("coalesce(p_invoice_id, v_fulfillment.invoice_id)");
    expect(finalize).toContain("v_invoice.issued_at is distinct from v_activation.activated_at");
    expect(finalize).toContain("v_receipt.issued_at is distinct from v_attempt.captured_at");
    expect(finalize).toContain("status = 'completed'");
  });

  test("issues activation-bound invoices from frozen authority and durable timestamps", () => {
    const invoice = functionBody(
      "public",
      "issue_platform_invoice_for_activation_server",
    ).toLowerCase();
    expect(invoice).toContain("v_source_key := 'invoice:activation:' || p_activation_event_id::text");
    expect(invoice).toContain("select * into v_existing from public.invoices where source_key = v_source_key");
    expect(invoice).toContain("return v_existing.id");
    expect(invoice).toContain("v_order.billing_snapshot");
    expect(invoice).toContain("v_order.issuer_snapshot");
    expect(invoice).toContain("v_order.plan_snapshot");
    expect(invoice).toContain("v_activation.activated_at");
    expect(invoice).toContain("v_attempt.captured_at");
    expect(invoice).toContain("v_attempt.provider <> v_order.provider");
    expect(invoice).toContain("event.processing_status = 'processed'");
    expect(invoice).toContain("event.event_type = 'payment.captured'");
    expect(invoice).toContain("v_order.setup_fee_amount_minor");
    expect(invoice).toContain("if v_order.setup_fee_amount_minor > 0 then");
    expect(invoice).not.toContain("tenant_billing_profiles");
    expect(invoice).not.toContain("platform_billing_issuer_profiles");
    expect(invoice).not.toContain("subscription_plan_prices");
  });

  test("freezes the assignment period at activation and invoices only that period", () => {
    const activation = functionBody(
      "coachfort_internal",
      "enforce_captured_attempt_activation_authority",
    ).toLowerCase();
    const discovery = functionBody(
      "public",
      "discover_platform_billing_document_fulfillments_server",
    ).toLowerCase();
    const invoice = functionBody(
      "public",
      "issue_platform_invoice_for_activation_server",
    ).toLowerCase();
    const finalize = functionBody(
      "public",
      "finalize_platform_billing_document_fulfillment_server",
    ).toLowerCase();

    expect(activation).toContain("where assignment.id = new.new_assignment_id");
    expect(activation).toContain(
      "new.billing_period_start := v_assignment.current_period_start",
    );
    expect(activation).toContain(
      "new.billing_period_end := v_assignment.current_period_end",
    );
    expect(activation).toContain("successful activation authority is immutable");
    expect(discovery).toContain("activation.billing_period_start is not null");
    expect(discovery).toContain(
      "activation.billing_period_start < activation.billing_period_end",
    );
    expect(invoice).toContain(
      "v_activation.billing_period_start, v_activation.billing_period_end",
    );
    expect(invoice).not.toContain("v_assignment.current_period_start");
    expect(invoice).not.toContain("v_assignment.current_period_end");
    expect(finalize).toContain(
      "v_invoice.period_start is distinct from v_activation.billing_period_start",
    );
    expect(finalize).toContain(
      "v_invoice.period_end is distinct from v_activation.billing_period_end",
    );
  });

  test("keeps all successful activation financial authority immutable", () => {
    const sql = executableSql().toLowerCase();
    const activation = functionBody(
      "coachfort_internal",
      "enforce_captured_attempt_activation_authority",
    ).toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    expect(activation).toContain(
      "old.activation_status in ('activated','skipped_already_active')",
    );
    for (const field of [
      "activated_at",
      "provider_order_id",
      "provider_payment_id",
      "billing_period_start",
      "billing_period_end",
    ]) {
      expect(activation).toContain(
        `new.${field} is distinct from old.${field}`,
      );
    }
    expect(sql).toMatch(
      /before insert or update of activation_status,[\s\S]*?activated_at, provider_order_id, provider_payment_id[\s\S]*?on public\.tenant_plan_activation_events/,
    );
    expect(activation).toContain(
      "new.provider_order_id := v_order.provider_order_id",
    );
    expect(activation).toContain(
      "new.provider_payment_id := v_attempt.provider_payment_id",
    );
    expect(activationMigration.toLowerCase()).toMatch(
      /activation_status = 'activated',[\s\S]{0,120}activated_at = v_now/,
    );
    expect(post).toContain("function_schema.nspname = 'coachfort_internal'");
    expect(post).toContain(
      "function_row.proname = 'enforce_captured_attempt_activation_authority'",
    );
    expect(post).toContain("pg_get_triggerdef(trigger_row.oid)");
    expect(post).toContain("successful_activation_authority_immutable");
  });

  test("reuses UX-8E receipt authority with deterministic captured-at source", () => {
    const receipt = functionBody(
      "public",
      "issue_platform_receipt_for_fulfillment_server",
    ).toLowerCase();
    const ux8e = ux8eMigration.toLowerCase();
    expect(receipt).toContain("return public.issue_platform_payment_receipt(");
    expect(receipt).toContain("'receipt:payment_attempt:' || v_attempt.id::text");
    expect(receipt).toContain("v_attempt.captured_at");
    expect(ux8e).toContain(
      "create function public.issue_platform_payment_receipt(\n  p_invoice_id uuid,\n  p_source_key text,\n  p_payment_attempt_id uuid,\n  p_issued_at timestamptz default now()",
    );
    expect(ux8e).toContain("v_attempt.internal_status <> 'captured'");
    expect(ux8e).toContain("v_attempt.captured_at is null");
    expect(migration).not.toMatch(/create\s+table\s+public\.platform_billing_receipts/i);
  });

  test("preserves explicit tax state and setup-fee amount parity", () => {
    const sql = executableSql().toLowerCase();
    const authority = functionBody(
      "public",
      "create_platform_payment_order_authority_server",
    ).toLowerCase();
    expect(sql).toContain("tax_calculation_status in ('not_calculated','not_applicable','calculated')");
    expect(authority).toContain("when v_price.tax_behavior = 'not_applicable' then 'not_applicable'");
    expect(authority).toContain("else 'not_calculated'");
    expect(authority).toContain(
      "v_total_amount_minor := v_price.amount_minor + v_price.setup_fee_amount_minor + coalesce(v_tax_amount_minor, 0)",
    );
    expect(sql).toContain(
      "total_amount_minor = amount_minor + setup_fee_amount_minor + coalesce(tax_amount_minor, 0)",
    );
    expect(sql).not.toMatch(/calculate_(?:gst|vat|tax)|tax_(?:rate|percent)\s*:=/);
  });

  test("keeps the fulfillment document model international while Razorpay remains INR test-only", () => {
    const sql = executableSql().toLowerCase();
    expect(ux8eMigration).toContain("currency in ('INR', 'EUR', 'USD')");
    expect(sql).not.toMatch(
      /platform_billing_document_fulfillments[\s\S]{0,2000}currency\s*=\s*'inr'/,
    );
    expect(sql).toContain("v_price.currency <> 'inr'");
    expect(sql).toContain("provider_mode,\n    provider_receipt");
    expect(sql).toContain("v_tax_calculation_status");
    expect(orderRoute).toContain('currency: "INR"');
    expect(orderRoute).toContain("Razorpay test checkout");
    expect(orderRoute).not.toMatch(/provider_mode:\s*"live"/);
  });

  test("recovers only one failed signed webhook redelivery claim", () => {
    expect(webhookRoute).toContain("prepareFailedWebhookEventForRetry");
    expect(webhookRoute).toContain('existing.processing_status === "failed"');
    expect(webhookRoute).toContain("existing.payload_hash === payloadHash");
    expect(webhookRoute).toContain("existing.signature_valid");
    expect(webhookRoute).toContain("signatureValid");
    expect(webhookRoute).toContain('.eq("processing_status", "failed")');
    expect(webhookRoute).toContain('.eq("signature_valid", true)');
    expect(webhookRoute).toContain('.select("id")');
    expect(webhookRoute).toContain("if (!retryClaimed)");
    expect(webhookRoute).toContain('retry_source: "verified_provider_redelivery"');
    expect(webhookRoute).not.toMatch(
      /existing\.processing_status === "failed"[\s\S]{0,180}!existing\.signature_valid/,
    );
  });

  test("keeps all new authority service-only and browser financial writes closed", () => {
    const sql = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();
    for (const name of [
      "create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)",
      "discover_platform_billing_document_fulfillments_server(integer)",
      "claim_platform_billing_document_fulfillments_server(text,integer,integer)",
      "resume_platform_billing_document_fulfillment_server(uuid)",
      "issue_platform_invoice_for_activation_server(uuid)",
      "issue_platform_receipt_for_fulfillment_server(uuid)",
      "finalize_platform_billing_document_fulfillment_server(uuid,uuid,text,uuid,uuid,text,text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${name} from public, anon, authenticated, service_role`);
      expect(sql).toContain(`grant execute on function public.${name} to service_role`);
    }
    expect(sql).toContain("enable row level security");
    expect(sql).toContain(
      "revoke all on table public.platform_billing_document_fulfillments from public, anon, authenticated, service_role",
    );
    expect(post).toContain("payment_order_browser_writes_closed");
    expect(post).toContain("internal_schema_safe");
    expect(post).toContain("overloads_exact");
    expect(post).toContain("source_contract_secure");
    expect(post).toContain("constraints_secure");
  });

  test("leaves Student Finance and legacy payment_transactions untouched and closed", () => {
    const sql = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();
    expect(sql).not.toMatch(
      /\b(?:alter|drop|truncate|insert into|update|delete from)\s+(?:table\s+)?public\.finance_/,
    );
    expect(sql).not.toMatch(/\b(?:insert into|update|delete from)\s+public\.payment_transactions/);
    expect(sql).not.toMatch(/grant\s+.+\s+on\s+table\s+public\.payment_transactions/);
    expect(post).toContain("student_finance_preserved");
    expect(post).toContain("legacy_payment_closed");
    expect(post).toContain("legacy_payment_grants");
  });

  test("does not add live checkout, a drain route, email, PDF, or subscription UI work", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).not.toMatch(/\bcron\b|pg_cron|net\.http|http_post/);
    expect(sql).not.toMatch(/send.*email|transactional_email|resend/);
    expect(sql).not.toMatch(/pdf|storage\.objects/);
    expect(orderRoute).not.toContain('providerMode: "live"');
    expect(migration).not.toContain("COACHFORT_EMAIL");
  });
});
