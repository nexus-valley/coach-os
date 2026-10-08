import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const r2 = read("supabase/regression_r2_noncommercial_access_authority.sql");
const r3b = read("supabase/regression_r3b_commercial_mutation_boundary.sql");
const r3c = read("supabase/regression_r3c_reporting_projection_authority.sql");
const renewal = read("supabase/bundle_ux8g1a_renewal_lifecycle_authority.sql");
const documents = read("supabase/bundle_ux8e_platform_invoice_receipt_foundation.sql");
const fulfillment = read("supabase/bundle_ux8f_verified_payment_document_fulfillment.sql");
const manualActivation = read(
  "supabase/bundle_ux8g4b0a_manual_activation_authority_replacement.sql",
);
const orderRoute = read("app/api/billing/razorpay/orders/route.ts");
const activationRoute = read("app/api/billing/razorpay/activate/route.ts");
const webhookRoute = read("app/api/billing/razorpay/webhook/route.ts");
const fulfillmentWorker = read("src/lib/server/platformBillingFulfillment.ts");
const subscriptions = read("src/lib/subscriptions.ts");
const billing = read("src/lib/billing.ts");
const platformDocuments = read("src/lib/platformBillingDocuments.ts");
const studentPayments = read("src/lib/payments.ts");
const studentReceipts = read("src/lib/receipts.ts");

function functionDefinition(sql: string, schema: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create(?: or replace)? function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return (match?.[0] ?? "").toLowerCase();
}

function indexOfRequired(source: string, value: string) {
  const index = source.indexOf(value);
  expect(index, `Expected ${value}`).toBeGreaterThanOrEqual(0);
  return index;
}

function sha256(path: string) {
  return createHash("sha256").update(read(path)).digest("hex");
}

test.describe("REGRESSION-R3D billing and document authority", () => {
  test("1. initial SaaS checkout rejects durable regression evidence before order insertion", () => {
    const authority = functionDefinition(
      r3b,
      "public",
      "create_platform_payment_order_authority_server",
    );
    const guard = indexOfRequired(
      authority,
      "tenant_has_noncommercial_regression_evidence",
    );
    const insert = indexOfRequired(
      authority,
      "insert into public.tenant_payment_orders",
    );
    expect(guard).toBeLessThan(insert);
    expect(authority).toContain("using errcode = '42501'");
  });

  test("2. the R2 payment-order trigger remains the final concurrent race boundary", () => {
    expect(r2).toContain(
      "create trigger enforce_noncommercial_payment_order_boundary",
    );
    expect(r2).toMatch(
      /before insert or update of tenant_id\s+on public\.tenant_payment_orders/,
    );
    expect(r2).toContain("for share");
    expect(r3b.toLowerCase()).toContain("the unchanged r2 before insert");
  });

  test("3. the provider order is created only after database checkout authority", () => {
    const authority = indexOfRequired(
      orderRoute,
      "const checkoutAuthority = await loadCheckoutAuthority(",
    );
    const provider = indexOfRequired(
      orderRoute,
      "const razorpayOrder = await createRazorpayOrder(",
    );
    expect(authority).toBeLessThan(provider);
  });

  test("4. revoked durable grant evidence remains a permanent checkout exclusion", () => {
    const helper = functionDefinition(
      r3b,
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    const durableGrantClause = helper.slice(
      helper.indexOf("tenant_noncommercial_access_grants"),
      helper.indexOf("tenant_fixture_classifications"),
    );
    expect(durableGrantClause).toContain("grant_row.tenant_id = p_tenant_id");
    expect(durableGrantClause).not.toContain("revoked_at");
  });

  test("5. renewal requires a purchased assignment and canonical paid period", () => {
    const authority = functionDefinition(
      renewal,
      "public",
      "create_platform_renewal_payment_order_authority_server",
    );
    expect(authority).toContain("v_base.status not in ('active','grace','past_due')");
    expect(authority).toContain("v_base.payment_status in ('paid','waived')");
    expect(authority).toContain("v_base.current_period_end is null");
    expect(authority).toContain("v_base.current_period_start is null");
  });

  test("6. noncommercial assignment shape cannot satisfy renewal eligibility", () => {
    const authority = functionDefinition(
      renewal,
      "public",
      "create_platform_renewal_payment_order_authority_server",
    );
    expect(authority).not.toContain("'noncommercial'");
    expect(authority).not.toContain("'not_required'");
  });

  test("7. renewal intent and order are created inside one serialized authority", () => {
    const authority = functionDefinition(
      renewal,
      "public",
      "create_platform_renewal_payment_order_authority_server",
    );
    const lock = indexOfRequired(authority, "ux8g1a_renewal:");
    const intent = indexOfRequired(
      authority,
      "insert into public.tenant_subscription_change_intents",
    );
    const order = indexOfRequired(
      authority,
      "insert into public.tenant_payment_orders",
    );
    expect(lock).toBeLessThan(intent);
    expect(intent).toBeLessThan(order);
  });

  test("8. no application caller bypasses renewal intent authority", () => {
    expect(orderRoute).not.toContain(
      "create_platform_renewal_payment_order_authority_server",
    );
    expect(activationRoute).not.toContain(
      "create_platform_renewal_payment_order_authority_server",
    );
    expect(webhookRoute).not.toContain(
      "create_platform_renewal_payment_order_authority_server",
    );
  });

  test("9. renewal activation requires captured signed provider evidence", () => {
    const authority = functionDefinition(
      renewal,
      "coachfort_internal",
      "activate_renewal_tenant_plan_after_verified_payment",
    );
    expect(authority).toContain("attempt.internal_status = 'captured'");
    expect(authority).toContain("coalesce(attempt.signature_valid, false) is true");
    expect(authority).toContain("event.event_type = 'payment.captured'");
    expect(authority).toContain("event.processing_status = 'processed'");
  });

  test("10. renewal setup fee is structurally zero", () => {
    expect(renewal).toContain(
      "constraint tenant_payment_orders_renewal_setup_fee_zero_check",
    );
    const authority = functionDefinition(
      renewal,
      "public",
      "create_platform_renewal_payment_order_authority_server",
    );
    expect(authority).toContain("'setup_fee_amount_minor', 0");
    expect(authority).toContain("v_price.amount_minor,\n    0, v_tax_amount_minor");
  });

  test("11. manual activation is restricted to canonical trial conversion", () => {
    const authority = functionDefinition(
      manualActivation,
      "public",
      "activate_tenant_subscription_manual_authority_server",
    );
    expect(authority).toContain("v_current.status <> 'trial'");
    expect(authority).toContain("v_current.payment_status <> 'not_required'");
    expect(authority).toContain("v_current.current_period_start is not null");
    expect(authority).toContain("v_has_commercial_assignment_history");
  });

  test("12. noncommercial and revoked-grant assignments cannot use manual activation", () => {
    const authority = functionDefinition(
      manualActivation,
      "public",
      "activate_tenant_subscription_manual_authority_server",
    );
    expect(authority).toContain("assignment.status <> 'trial'");
    expect(authority).toContain("assignment.payment_status <> 'not_required'");
    expect(authority).toContain("raise exception 'canonical renewal or plan-change authority is required");
  });

  test("13. commercial activation events require an existing internal payment order", () => {
    expect(activationRoute).toContain('.from("tenant_payment_orders")');
    expect(activationRoute).toContain(
      '"activate_tenant_plan_after_verified_payment"',
    );
    expect(activationRoute).not.toContain("tenant_noncommercial_access_grants");
  });

  test("14. invoice issuance requires a current commercial assignment", () => {
    const authority = functionDefinition(
      documents,
      "public",
      "issue_platform_subscription_invoice",
    );
    expect(authority).toContain("not v_assignment.is_current");
    expect(authority).toContain("v_assignment.status not in ('active', 'past_due', 'grace')");
    expect(authority).toContain("v_assignment.payment_status not in ('paid', 'unpaid', 'overdue')");
    expect(authority).toContain("invoice period does not match the current subscription assignment");
  });

  test("15. a regression grant alone cannot satisfy invoice authority", () => {
    const authority = functionDefinition(
      documents,
      "public",
      "issue_platform_subscription_invoice",
    );
    expect(authority).not.toContain("operational_allowed");
    expect(authority).not.toContain("get_tenant_entitlement_state");
    expect(authority).not.toContain("noncommercial_grant_id");
  });

  test("16. verified-payment invoice issuance is bound to order, attempt, activation, and webhook", () => {
    const authority = functionDefinition(
      fulfillment,
      "public",
      "issue_platform_invoice_for_activation_server",
    );
    expect(authority).toContain("v_order.internal_status <> 'activated'");
    expect(authority).toContain("v_attempt.internal_status <> 'captured'");
    expect(authority).toContain("coalesce(v_attempt.signature_valid, false) is not true");
    expect(authority).toContain("event.event_type = 'payment.captured'");
  });

  test("17. receipt issuance requires canonical captured payment and activation evidence", () => {
    const authority = functionDefinition(
      documents,
      "public",
      "issue_platform_payment_receipt",
    );
    expect(authority).toContain("v_attempt.internal_status <> 'captured'");
    expect(authority).toContain("coalesce(v_attempt.signature_valid, false) is not true");
    expect(authority).toContain("v_activation.activation_status not in ('activated', 'skipped_already_active')");
    expect(authority).toContain("v_order.internal_status <> 'activated'");
  });

  test("18. a regression grant alone cannot satisfy receipt authority", () => {
    const authority = functionDefinition(
      documents,
      "public",
      "issue_platform_payment_receipt",
    );
    expect(authority).not.toContain("operational_allowed");
    expect(authority).not.toContain("get_tenant_entitlement_state");
    expect(authority).not.toContain("tenant_noncommercial_access_grants");
  });

  test("19. fulfillment discovery derives work only from verified activation evidence", () => {
    const authority = functionDefinition(
      fulfillment,
      "public",
      "discover_platform_billing_document_fulfillments_server",
    );
    expect(authority).toContain("activation.activation_status in ('activated','skipped_already_active')");
    expect(authority).toContain("attempt.internal_status = 'captured'");
    expect(authority).toContain("event.event_type = 'payment.captured'");
    expect(authority).toContain("payment_order.internal_status = 'activated'");
  });

  test("20. the fulfillment worker can issue documents only through service RPCs", () => {
    expect(fulfillmentWorker).toContain(
      '"issue_platform_invoice_for_activation_server"',
    );
    expect(fulfillmentWorker).toContain(
      '"issue_platform_receipt_for_fulfillment_server"',
    );
    expect(fulfillmentWorker).not.toContain('.from("invoices").insert');
    expect(fulfillmentWorker).not.toContain(
      '.from("platform_billing_receipts").insert',
    );
  });

  test("21. webhook reconciliation cannot synthesize an internal payment order", () => {
    expect(webhookRoute).toContain('.from("tenant_payment_orders")');
    expect(webhookRoute).toContain('.eq("provider_order_id", providerOrderId)');
    expect(webhookRoute).not.toContain('.from("tenant_payment_orders")\n    .insert');
    expect(webhookRoute).not.toContain("create_platform_payment_order_authority_server");
  });

  test("22. webhook processing remains signature-verified and idempotent", () => {
    expect(webhookRoute).toContain("verifyRazorpayWebhookSignature");
    expect(webhookRoute).toContain("provider_event_id");
    expect(webhookRoute).toContain("payload_hash");
    expect(webhookRoute).toContain('error.code === "23505"');
  });

  test("23. initial setup fees remain canonical price evidence, not grant evidence", () => {
    const authority = functionDefinition(
      r3b,
      "public",
      "create_platform_payment_order_authority_server",
    );
    expect(authority).toContain("v_price.setup_fee_amount_minor");
    expect(authority).toContain("v_price.amount_minor + v_price.setup_fee_amount_minor");
    expect(indexOfRequired(authority, "tenant_has_noncommercial_regression_evidence")).toBeLessThan(
      indexOfRequired(authority, "v_total_amount_minor :="),
    );
  });

  test("24. legacy Coach subscription reads no longer synthesize tenant billing truth", () => {
    expect(subscriptions).not.toContain("getTenantFallbackSubscription");
    expect(subscriptions).not.toContain('.from("tenants")');
    expect(subscriptions).not.toContain('id: `fallback-${tenantId}`');
    expect(subscriptions).not.toContain('currency: "INR"');
  });

  test("25. absent legacy subscription data has no fake cycle, provider, status, or plan", () => {
    expect(subscriptions).toContain(
      'billingCycle: subscription?.billing_cycle ?? null',
    );
    expect(subscriptions).toContain('provider: subscription?.provider ?? null');
    expect(subscriptions).toContain('status: subscription?.status ?? null');
    expect(subscriptions).toContain(
      'plan: subscription ? normalizePlanKey(subscription.plan_code) : null',
    );
    expect(subscriptions).not.toContain('provider: subscription?.provider ?? "manual"');
  });

  test("26. absent legacy commercial data cannot become active or trial commercial access", () => {
    const access = subscriptions.slice(
      subscriptions.indexOf("export function getSubscriptionAccessState"),
    );
    expect(access).toContain('if (!subscription) {\n    return "blocked";');
    expect(access).not.toContain('if (!subscription) {\n    return "trialing";');
  });

  test("27. billing summary does not recommend a paid plan without commercial subscription data", () => {
    expect(billing).toContain("planRecommendation: subscription");
    expect(billing).toContain(": null,");
    expect(billing).not.toContain("subscription?.plan_code");
  });

  test("28. historical genuine platform documents remain readable and are not deleted", () => {
    expect(platformDocuments).toContain(
      'supabase.rpc("get_platform_billing_documents"',
    );
    expect(platformDocuments).not.toMatch(/\.delete\s*\(/);
    expect(r3b).not.toMatch(/delete\s+from\s+public\.(invoices|platform_billing_receipts)/i);
    expect(r3c).not.toMatch(/delete\s+from\s+public\.(invoices|platform_billing_receipts)/i);
  });

  test("29. R2 grant issuance requires zero commercial order, activation, manual, and intent history", () => {
    const grant = functionDefinition(
      r2,
      "public",
      "grant_tenant_noncommercial_access_server",
    );
    expect(grant).toContain("from public.tenant_payment_orders");
    expect(grant).toContain("from public.tenant_plan_activation_events");
    expect(grant).toContain("from public.manual_subscription_activation_audits");
    expect(grant).toContain("from public.tenant_subscription_change_intents");
  });

  test("30. student-to-coach commerce remains outside the SaaS exclusion", () => {
    expect(studentPayments).toContain('.from("payments")');
    expect(studentPayments).toContain("student_id");
    expect(studentPayments).toContain("course_id");
    expect(studentReceipts).toContain('.from("payments")');
    expect(studentPayments).not.toContain("tenant_has_noncommercial_regression_evidence");
    expect(studentReceipts).not.toContain("tenant_has_noncommercial_regression_evidence");
  });

  test("31. R2, R3B, and R3C reviewed authority artifacts remain unchanged", () => {
    expect(sha256("supabase/regression_r2_noncommercial_access_authority.sql")).toBe(
      "ee145f7400fc2c0d2d7e352563af5d1aa2d08f036ec275f011a4fea911fd46f0",
    );
    expect(sha256("supabase/regression_r3b_commercial_mutation_boundary.sql")).toBe(
      "82803ab8cb03d3ecdcd3b7409c6d998979f58661b991a667a287c39a26446354",
    );
    expect(sha256("supabase/regression_r3c_reporting_projection_authority.sql")).toBe(
      "9f55cc87f49ecbb55ba8a87a579e96ce137595b3922c03b016c2a042bccd9109",
    );
  });

  test("32. R3D introduces no SQL migration, hardcoded fixture identity, or grant opening", () => {
    expect(
      existsSync(join(root, "supabase/regression_r3d_billing_document_authority.sql")),
    ).toBe(false);
    const changedSources = `${subscriptions}\n${billing}`;
    expect(changedSources).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(changedSources).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(changedSources).not.toMatch(/coachfort regression/i);
    expect(changedSources).not.toContain("grant_tenant_noncommercial_access_server");
  });
});
