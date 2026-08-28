import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8e_platform_invoice_receipt_foundation.sql",
);
const documentsLibrary = read("src/lib/platformBillingDocuments.ts");
const billingLibrary = read("src/lib/billing.ts");
const subscriptionClient = read(
  "src/components/subscription/SubscriptionPageClient.tsx",
);
const studentFinanceMigration = read("supabase/module55_tenant_finance_center.sql");

function executableSql() {
  const match = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);
  expect(match, "Expected one executable transaction").not.toBeNull();
  return match?.[0] ?? "";
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

test.describe("UX-8E platform invoice and receipt foundation", () => {
  test("keeps platform billing separate from Student Finance and preserves legacy objects", () => {
    const sql = executableSql().toLowerCase();
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    expect(sql).toContain("alter table public.invoices");
    expect(sql).toContain("alter table public.invoice_items");
    expect(sql).toContain("create table public.platform_billing_receipts");
    expect(sql).not.toMatch(/(?:alter|drop|truncate|insert into|update|delete from) public\.finance_/);
    expect(sql).not.toMatch(/drop table[\s\S]*public\.(?:invoices|invoice_items|payment_transactions)/);
    expect(pre).toContain("student_finance_invoice_rows");
    expect(pre).toContain("student_finance_payment_rows");
    expect(post).toContain("student_finance_preserved");
    expect(post).toContain("public.finance_payments");
  });

  test("keeps PRE and POST read-only while APPLY creates no documents", () => {
    for (const block of [
      verificationBlock("PRE-APPLY"),
      verificationBlock("POST-APPLY"),
    ]) {
      expect(block).not.toMatch(
        /\b(insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index|sequence)|drop\s+(?:table|function)|truncate\s+(?:table\s+)?|merge\s+into)\b/i,
      );
    }

    expect(executableSql()).not.toMatch(
      /select\s+public\.issue_platform_(?:subscription_invoice|payment_receipt)/i,
    );
    expect(executableSql()).not.toMatch(/\brazorpay\b[\s\S]{0,80}\b(?:fetch|http|net\.)/i);
  });

  test("classifies ambiguous legacy rows instead of silently reinterpreting them", () => {
    const sql = executableSql().toLowerCase();
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    expect(sql).toContain("legacy platform billing rows require explicit classification");
    expect(sql).toContain("v_invoice_rows <> 0");
    expect(sql).toContain("v_invoice_item_rows <> 0");
    expect(sql).toContain("v_payment_transaction_rows <> 0");
    expect(pre).toContain("invoice_column_conflicts");
    expect(pre).toContain("invoice_item_column_conflicts");
    expect(sql).toContain("conflicting ux-8e invoice columns already exist");
    expect(sql).not.toMatch(/update public\.(?:invoices|invoice_items|payment_transactions)/);
  });

  test("fails closed on exact legacy schema and key drift", () => {
    const sql = executableSql().toLowerCase();
    const pre = verificationBlock("PRE-APPLY").toLowerCase();

    for (const column of [
      "invoice_number",
      "tax_amount",
      "billing_address",
      "tax_percent",
      "provider_transaction_id",
      "metadata_json",
    ]) {
      expect(pre).toContain(`'${column}'`);
    }
    expect(pre).toContain("legacy_schema_violation_count");
    expect(pre).toContain("legacy_constraint_state");
    expect(sql).toContain("legacy platform billing schema differs from the exact ux-8e prerequisites");
    expect(sql).toContain("legacy platform billing key or foreign-key contract is incompatible");
    expect(sql).toContain("invoices.invoice_number must be protected by a valid unique index");
    expect(sql).toContain("drop constraint invoices_status_check");
    expect(sql).not.toContain("drop constraint if exists invoices_status_check");
  });

  test("uses immutable minor-unit money and structured snapshots", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).toContain("subtotal_minor bigint");
    expect(sql).toContain("discount_amount_minor bigint");
    expect(sql).toContain("tax_amount_minor bigint");
    expect(sql).toContain("tax_calculation_status text");
    expect(sql).toContain("total_amount_minor bigint");
    expect(sql).toContain("currency in ('inr', 'eur', 'usd')");
    expect(sql).toContain("billing_snapshot jsonb");
    expect(sql).toContain("issuer_snapshot jsonb");
    expect(sql).toContain("plan_snapshot jsonb");
    expect(sql).toContain("enforce_invoices_immutability");
    expect(sql).toContain("enforce_invoice_items_immutability");
    expect(sql).toContain("enforce_platform_billing_receipts_immutability");
    expect(sql).not.toMatch(/alter column tax_amount_minor set not null/);
  });

  test("does not fabricate tax and snapshots canonical billing identity", () => {
    const invoice = functionBody("public", "issue_platform_subscription_invoice").toLowerCase();
    expect(invoice).toContain("v_profile public.tenant_billing_profiles%rowtype");
    expect(invoice).toContain("v_profile.preferred_currency <> v_price.currency");
    expect(invoice).toContain("'tax_registration_type', v_profile.tax_registration_type");
    expect(invoice).toContain("'tax_id', v_profile.tax_id");
    expect(invoice).toContain("v_tax_calculation_status := case");
    expect(invoice).toContain("when v_price.tax_behavior = 'not_applicable' then 'not_applicable'");
    expect(invoice).toContain("else 'not_calculated'");
    expect(invoice).toContain("when v_tax_calculation_status = 'not_applicable' then 0");
    expect(invoice).toContain("else null");
    expect(invoice).toContain("v_tax_amount_minor, v_tax_calculation_status");
    expect(invoice).toContain("if v_price.setup_fee_amount_minor > 0 then");
    expect(invoice).not.toMatch(/tax_(?:rate|percent)\s*:=|calculate_tax/);
    expect(documentsLibrary).toContain("tax_amount_minor: number | null");
    expect(documentsLibrary).not.toContain("Number(row.tax_amount_minor ?? 0)");
  });

  test("uses a service-only issuer configuration boundary without invented legal values", () => {
    const sql = executableSql();
    const lower = sql.toLowerCase();
    expect(sql).toContain("create table public.platform_billing_issuer_profiles");
    expect(sql).toContain("create function public.configure_platform_billing_issuer_profile");
    expect(sql).toContain("CoachFort billing issuer profile is not configured");
    expect(lower).toContain("grant execute on function public.configure_platform_billing_issuer_profile");
    expect(lower).toMatch(/configure_platform_billing_issuer_profile[\s\S]*?to service_role/);
    expect(lower).not.toMatch(/grant execute on function public\.configure_platform_billing_issuer_profile[\s\S]{0,300}to (?:anon|authenticated)/);
    expect(sql).not.toMatch(/select\s+public\.configure_platform_billing_issuer_profile/i);
    expect(sql).not.toMatch(/CoachFort (?:Private Limited|LLP|Inc\.|LLC)/);
  });

  test("uses race-safe numbering and database idempotency", () => {
    const sql = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();
    expect(sql).toContain("create sequence coachfort_internal.platform_invoice_number_seq");
    expect(sql).toContain("create sequence coachfort_internal.platform_receipt_number_seq");
    expect(sql).toContain("cf-inv");
    expect(sql).toContain("cf-rct");
    expect(sql).not.toMatch(/max\s*\([^)]*(?:invoice|receipt)/);
    expect(sql).toContain("create unique index invoices_source_key_uidx");
    expect(post).toContain("invoice_number_unique");
    expect(sql).toContain("platform_billing_receipts_source_key_key");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("source key conflicts with an existing document");
    expect(sql).toContain("v_existing.period_start is not distinct from p_period_start");
    expect(sql).toContain("v_existing.period_end is not distinct from p_period_end");
    expect(sql).toContain("v_existing.due_at is not distinct from p_due_at");
  });

  test("accepts only verified payment authority for receipts", () => {
    const receipt = functionBody("public", "issue_platform_payment_receipt").toLowerCase();
    expect(receipt.indexOf("select * into v_existing")).toBeLessThan(
      receipt.indexOf("select * into v_invoice"),
    );
    expect(receipt).toContain("return v_existing.id");
    expect(receipt).toContain("v_order public.tenant_payment_orders%rowtype");
    expect(receipt).toContain("v_attempt public.tenant_payment_attempts%rowtype");
    expect(receipt).toContain("v_activation public.tenant_plan_activation_events%rowtype");
    expect(receipt).toContain("v_attempt.internal_status <> 'captured'");
    expect(receipt).toContain("coalesce(v_attempt.signature_valid, false) is not true");
    expect(receipt).toContain("v_activation.activation_status not in ('activated', 'skipped_already_active')");
    expect(receipt).toContain("v_attempt.provider_order_id is distinct from v_order.provider_order_id");
    expect(receipt).toContain("v_attempt.amount_minor is distinct from v_order.total_amount_minor");
    expect(receipt).toContain("v_attempt.currency is distinct from v_order.currency");
    expect(receipt).toContain("v_activation.provider_payment_id is distinct from v_attempt.provider_payment_id");
    expect(receipt).toContain("v_activation.metadata_json->>'captured_attempt_id' is distinct from v_attempt.id::text");
    expect(receipt).toContain("v_activation.new_assignment_id is distinct from v_invoice.subscription_assignment_id");
    expect(receipt).toContain("v_order.total_amount_minor <> v_invoice.total_amount_minor");
    expect(receipt).not.toContain("p_payment_order_id");
    expect(receipt).not.toContain("p_activation_event_id");
  });

  test("derives invoice authority from one current eligible assignment and canonical price", () => {
    const invoice = functionBody("public", "issue_platform_subscription_invoice").toLowerCase();
    expect(invoice).toContain("where id = p_subscription_assignment_id");
    expect(invoice).toContain("not v_assignment.is_current");
    expect(invoice).toContain("v_assignment.status not in ('active', 'past_due', 'grace')");
    expect(invoice).toContain("v_assignment.payment_status not in ('paid', 'unpaid', 'overdue')");
    expect(invoice).toContain("where id = p_price_id and plan_id = v_assignment.plan_id");
    expect(invoice).toContain("v_price.region_code <> 'global'");
    expect(invoice).toContain("competing_price.status = 'active'");
    expect(invoice).toContain("invoice period does not match the current subscription assignment");
    expect(invoice).not.toContain("p_tenant_id");
    expect(invoice).not.toContain("p_plan_id");
  });

  test("returns an exact invoice replay before current assignment revalidation", () => {
    const invoice = functionBody(
      "public",
      "issue_platform_subscription_invoice",
    ).toLowerCase();
    const existingLookup = invoice.indexOf(
      "select * into v_existing from public.invoices where source_key = p_source_key",
    );
    const assignmentLookup = invoice.indexOf(
      "select * into v_assignment\n  from public.tenant_subscription_assignments",
    );
    const replayBranch = invoice.slice(existingLookup, assignmentLookup);

    expect(existingLookup).toBeGreaterThan(-1);
    expect(assignmentLookup).toBeGreaterThan(existingLookup);
    expect(replayBranch).toContain(
      "v_existing.subscription_assignment_id = p_subscription_assignment_id",
    );
    expect(replayBranch).toContain("v_existing.price_id = p_price_id");
    expect(replayBranch).toContain(
      "v_existing.period_start is not distinct from p_period_start",
    );
    expect(replayBranch).toContain(
      "v_existing.period_end is not distinct from p_period_end",
    );
    expect(replayBranch).toContain(
      "v_existing.due_at is not distinct from p_due_at",
    );
    expect(replayBranch).toContain("return v_existing.id");
    expect(replayBranch).toContain(
      "invoice source key conflicts with an existing document",
    );
    expect(replayBranch).not.toContain("v_assignment.is_current");
    expect(invoice.match(/insert into public\.invoices/g)).toHaveLength(1);
  });

  test("keeps issuance service-only and tenant reads role-scoped", () => {
    const sql = executableSql().toLowerCase();
    const readGuard = functionBody(
      "coachfort_internal",
      "platform_billing_can_read_tenant",
    ).toLowerCase();
    expect(readGuard).toContain("array['owner', 'admin']");
    expect(readGuard).toContain("public.platform_can_manage_billing()");
    expect(sql).toContain("grant execute on function public.get_platform_billing_documents(uuid) to authenticated");
    expect(sql).toContain("grant execute on function public.get_platform_billing_document(uuid,text,uuid) to authenticated");
    expect(sql).toContain("grant execute on function public.issue_platform_subscription_invoice");
    expect(sql).toContain("grant execute on function public.issue_platform_payment_receipt");
    expect(sql).not.toMatch(/grant execute on function public\.issue_platform_[\s\S]{0,260}to (?:public|anon|authenticated)/);
    expect(sql).toContain("revoke all on table public.invoices from public, anon, authenticated, service_role");
    expect(sql).toContain("revoke all on table public.platform_billing_receipts from public, anon, authenticated, service_role");
  });

  test("closes all direct legacy payment transaction grants", () => {
    const sql = executableSql().toLowerCase();
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    expect(pre).toContain("payment_transactions_grant_classification");
    expect(pre).toContain("browser_destructive_or_write_grants");
    expect(sql).toContain(
      "revoke all on table public.payment_transactions from public, anon, authenticated, service_role",
    );
    expect(sql).not.toMatch(/grant\s+select[\s\S]{0,120}payment_transactions/);
    expect(post).toContain("payment_transactions_grants");
    expect(post).toContain("legacy_payment_grants_closed");
    expect(post).toContain("authenticated_select = 0");
    expect(post).toContain("service_role_direct = 0");
    expect(post).toContain("and legacy_payment_grants_closed");
  });

  test("leaves generic Student Finance invoice RPCs unchanged and separate", () => {
    for (const functionName of [
      "create_invoice",
      "update_invoice",
      "void_invoice",
      "apply_invoice_adjustment",
      "finance_recalculate_invoice",
    ]) {
      const match = studentFinanceMigration.match(
        new RegExp(
          `create or replace function public\\.${functionName}\\([\\s\\S]*?\\$\\$;`,
          "i",
        ),
      );
      expect(match, `Expected Student Finance RPC ${functionName}`).not.toBeNull();
      expect(match?.[0]).toContain("public.finance_invoices");
      expect(match?.[0]).not.toMatch(
        /(?:insert into|update|delete from) public\.(?:invoices|invoice_items|payment_transactions)\b/i,
      );
    }

    expect(executableSql()).not.toMatch(
      /(?:create|replace|alter|drop) function public\.(?:create_invoice|update_invoice|void_invoice|apply_invoice_adjustment|finance_recalculate_invoice)\b/i,
    );
  });

  test("makes every required object, trigger, function, and integrity contract decisive", () => {
    const post = verificationBlock("POST-APPLY").toLowerCase();
    for (const signal of [
      "invoice_number_unique",
      "receipt_invoice_unique",
      "receipt_payment_attempt_unique",
      "receipt_activation_event_unique",
      "invoice_immutability_trigger",
      "item_immutability_trigger",
      "receipt_immutability_trigger",
    ]) {
      expect(post).toContain(`'${signal}'`);
    }
    expect(post).toContain("lateral jsonb_each_text(object_state.value)");
    expect(post).toContain("and object_contract");
    expect(post).toContain("coachfort_internal.enforce_platform_billing_immutability()");
    expect(post).toContain("coachfort_internal.enforce_platform_billing_item_immutability()");
    expect(post).toContain("(select count(*) from function_state) = 9");
    expect(post).toContain("function_overload_state");
    expect(post).toContain("constraint_semantics");
    expect(post).toContain("and integrity_semantics");
    expect(post).toContain("and tgenabled <> 'd'");
    expect(post).toContain("coalesce(expected_functions");
  });

  test("uses secure RPC reads with no browser billing writes", () => {
    expect(documentsLibrary).toContain('.rpc("get_platform_billing_documents"');
    expect(documentsLibrary).not.toMatch(/\.from\("(?:invoices|invoice_items|platform_billing_receipts)"\)/);
    expect(documentsLibrary).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(billingLibrary).toContain("getPlatformBillingDocuments");
    expect(billingLibrary).not.toContain("getPaymentHistory");
    expect(billingLibrary).not.toContain("getInvoices");
  });

  test("renders a clean responsive CoachFort billing-document surface", () => {
    expect(subscriptionClient).toContain("Billing documents");
    expect(subscriptionClient).toContain("No billing documents yet");
    expect(subscriptionClient).toContain(
      "Your CoachFort invoices and payment receipts will appear here.",
    );
    expect(subscriptionClient).toContain("Payment receipt");
    expect(subscriptionClient).toContain("md:hidden");
    expect(subscriptionClient).toContain("hidden overflow-x-auto md:block");
    expect(subscriptionClient).toContain('role="dialog"');
    expect(subscriptionClient).toContain('aria-modal="true"');
    expect(subscriptionClient).not.toContain("Student invoice");
    expect(subscriptionClient).not.toContain("Razorpay");
  });

  test("keeps PDF and email delivery deferred", () => {
    const changedSources = `${documentsLibrary}\n${billingLibrary}\n${subscriptionClient}`;
    expect(changedSources).not.toMatch(/pdfkit|react-pdf|generatePdf|sendCoachFortTransactionalEmail/);
    expect(executableSql()).not.toMatch(/transactional_email|email_outbox|storage\.objects/i);
  });
});
