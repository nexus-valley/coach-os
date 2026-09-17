import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g4b1a_billing_readiness_authority.sql",
);
const orderRoute = read("app/api/billing/razorpay/orders/route.ts");
const fulfillmentMigration = read(
  "supabase/bundle_ux8f_verified_payment_document_fulfillment.sql",
);
const documentMigration = read(
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
      `create (?:or replace )?function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return match?.[0].toLowerCase() ?? "";
}

test.describe("UX-8G4B1A canonical billing readiness authority", () => {
  test("keeps PRE and POST read-only and APPLY transactional", () => {
    for (const block of [
      verificationBlock("PRE-APPLY"),
      verificationBlock("POST-APPLY"),
    ]) {
      expect(block).not.toMatch(
        /\b(insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index|trigger)|drop\s+(?:table|function)|truncate\s+(?:table\s+)?|merge\s+into)\b/i,
      );
    }

    const sql = executableSql();
    expect(sql).toMatch(/^begin;/i);
    expect(sql).toMatch(/commit;\s*$/i);
    expect(sql).not.toMatch(/\bcascade\b/i);
    expect(sql).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+public\.(?:platform_billing_issuer_profiles|tenant_billing_profiles)/i,
    );
    expect(sql).not.toMatch(
      /(?:select|perform)\s+public\.(?:create_platform_payment_order_authority_server|create_platform_renewal_payment_order_authority_server|issue_platform_subscription_invoice)/i,
    );
  });

  test("fails closed on prerequisite, source, constraint, and partial-install drift", () => {
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const sql = executableSql().toLowerCase();

    expect(pre).toContain("duplicated_live_readiness_present");
    expect(pre).toContain("snapshot_boundary_present");
    expect(pre).toContain("private_schema_present");
    expect(pre).toContain("exact_live_authority_identities");
    expect(pre).toContain("clean_install_state");
    expect(pre).toContain("ready_for_apply");
    expect(sql).toContain("billing prerequisites are missing");
    expect(sql).toContain("function prerequisites are missing");
    expect(sql).toContain("partial ux-8g4b1a installation already exists");
    expect(sql).toContain("authority source drift requires review");
    expect(sql).toContain("live authority overloads require review");
    expect(sql).toContain("readiness constraints have drifted");
    expect(sql).toContain("procedure.proname");
  });

  test("uses decisive browser ACL verification consistently in PRE, APPLY, and POST", () => {
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const apply = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    for (const block of [pre, apply, post]) {
      expect(block).toContain("information_schema.table_privileges");
      expect(block).not.toContain("information_schema.role_table_grants");
      expect(block).toContain("'subscription_plan_prices'");
      expect(block).toContain("'public','anon','authenticated'");
      for (const privilege of [
        "insert",
        "update",
        "delete",
        "truncate",
        "trigger",
        "references",
        "maintain",
      ]) {
        expect(block).toContain(`'${privilege}'`);
      }
    }

    expect(apply.indexOf("information_schema.table_privileges")).toBeLessThan(
      apply.indexOf(
        "create function coachfort_internal.resolve_platform_billing_readiness",
      ),
    );
  });

  test("requires exact deterministic billing-profile keys and rejects duplicate authority", () => {
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const apply = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    for (const block of [pre, apply, post]) {
      expect(block).toContain("constraint_def.conkey");
      expect(block).toContain("backing_index.indisunique");
      expect(block).toContain("backing_index.indpred is null");
      expect(block).toContain("array['profile_key']::name[]");
      expect(block).toContain("array['tenant_id']::name[]");
      expect(block).toContain("profile_key=''default''::text");
      expect(block).toContain("group by profile.profile_key");
      expect(block).toContain("group by profile.tenant_id");
    }

    expect(pre).toContain("gates.issuer_duplicate_key_count = 0");
    expect(pre).toContain("gates.tenant_billing_duplicate_tenant_count = 0");
    expect(post).toContain("gates.issuer_duplicate_key_count = 0");
    expect(post).toContain("gates.tenant_billing_duplicate_tenant_count = 0");
    expect(apply).toContain("billing profile uniqueness authority has drifted");
  });

  test("defines deterministic issuer readiness from the canonical default profile", () => {
    const resolver = functionBody(
      "coachfort_internal",
      "resolve_platform_billing_readiness",
    );

    expect(resolver).toContain("from public.platform_billing_issuer_profiles");
    expect(resolver).toContain("issuer.profile_key = 'default'");
    for (const field of [
      "legal_name",
      "billing_email",
      "address_line1",
      "city",
      "postal_code",
      "country",
    ]) {
      expect(resolver).toContain(`'${field}'`);
    }
    expect(resolver).toContain("v_issuer.status is distinct from 'active'");
    expect(resolver).toContain("v_issuer.effective_from > v_as_of");
    expect(resolver).toContain("billing_profile_currency_for_country(v_issuer.country)");
    expect(resolver).toContain("v_issuer.billing_email !~*");
    expect(resolver).toContain("v_issuer.country !~ '^[a-z]{2}$'");
    expect(resolver).toContain("v_issuer.tax_registration_type is null");
    expect(resolver).toContain("v_issuer.tax_registration_type = 'none'");
    expect(resolver).toContain("v_issuer.tax_registration_type <> 'none'");
    expect(resolver).toContain("array_append(v_issuer_missing, 'tax_id')");
    expect(resolver).not.toMatch(
      /v_issuer_missing[^;]+(?:billing_phone|address_line2|state)/,
    );
  });

  test("defines canonical customer and expected-currency readiness", () => {
    const resolver = functionBody(
      "coachfort_internal",
      "resolve_platform_billing_readiness",
    );

    expect(resolver).toContain("from public.tenant_billing_profiles");
    expect(resolver).toContain("profile.tenant_id = p_tenant_id");
    expect(resolver).not.toContain("from public.tenants");
    for (const field of [
      "legal_name",
      "billing_email",
      "address_line1",
      "city",
      "postal_code",
      "country",
      "preferred_currency",
    ]) {
      expect(resolver).toContain(`'${field}'`);
    }
    expect(resolver).toContain(
      "v_currency_ready := coalesce(v_expected_currency in ('inr','eur','usd'), false)",
    );
    expect(resolver).toContain("array_append(v_customer_invalid, 'expected_currency')");
    expect(resolver).toContain("billing_profile_currency_for_country(v_profile.country)");
    expect(resolver).toContain(
      "v_profile.preferred_currency is distinct from v_customer_country_currency",
    );
    expect(resolver).toContain(
      "v_profile.preferred_currency is distinct from v_expected_currency",
    );
    expect(resolver).toContain("v_profile.billing_email !~*");
    expect(resolver).toContain("v_profile.country !~ '^[a-z]{2}$'");
  });

  test("returns one validated internal snapshot payload and fails closed through one assertion", () => {
    const resolver = functionBody(
      "coachfort_internal",
      "resolve_platform_billing_readiness",
    );
    const assertion = functionBody(
      "coachfort_internal",
      "assert_platform_billing_readiness",
    );

    expect(resolver).toContain("'snapshot', v_issuer_snapshot");
    expect(resolver).toContain("'snapshot', v_billing_snapshot");
    expect(resolver).toContain("'missing_fields', to_jsonb(v_issuer_missing)");
    expect(resolver).toContain("'invalid_fields', to_jsonb(v_customer_invalid)");
    expect(assertion).toContain("resolve_platform_billing_readiness");
    expect(assertion).toContain("using errcode = '22023'");
    expect(assertion).toContain("using errcode = '55000'");
    expect(assertion).toContain("return v_readiness");
    expect(assertion.match(/resolve_platform_billing_readiness/g)).toHaveLength(1);
  });

  test("uses shared readiness and its snapshots in all three live-profile authorities", () => {
    for (const [schema, name] of [
      ["public", "create_platform_payment_order_authority_server"],
      ["public", "create_platform_renewal_payment_order_authority_server"],
      ["public", "issue_platform_subscription_invoice"],
    ]) {
      const body = functionBody(schema, name);
      expect(body).toContain("assert_platform_billing_readiness");
      expect(body).toContain("v_readiness#>'{customer,snapshot}'");
      expect(body).toContain("v_readiness#>'{issuer,snapshot}'");
      expect(body).not.toContain("from public.tenant_billing_profiles");
      expect(body).not.toContain("from public.platform_billing_issuer_profiles");
      expect(body.match(/assert_platform_billing_readiness/g)).toHaveLength(1);
    }
  });

  test("replays an existing renewal from frozen snapshots before live readiness", () => {
    const renewal = functionBody(
      "public",
      "create_platform_renewal_payment_order_authority_server",
    );
    const replay = renewal.indexOf("if v_existing_order.id is not null then");
    const readiness = renewal.indexOf(
      "v_readiness := coachfort_internal.assert_platform_billing_readiness",
    );
    const generation = renewal.indexOf(
      "v_generation := v_intent.order_generation + 1",
    );

    expect(replay).toBeGreaterThan(-1);
    expect(readiness).toBeGreaterThan(replay);
    expect(generation).toBeGreaterThan(readiness);
    expect(renewal).toContain(
      "'billing_snapshot', v_existing_order.billing_snapshot",
    );
    expect(renewal).toContain(
      "'issuer_snapshot', v_existing_order.issuer_snapshot",
    );
    expect(renewal).toContain("'plan_snapshot', v_existing_order.plan_snapshot");
    expect(renewal).toContain("'idempotent', true");
    expect(renewal).toContain(
      "internal_status not in ('failed','cancelled','expired','activated')",
    );
    expect(renewal).toContain("'setup_fee_amount_minor', 0");
    expect(renewal.match(/assert_platform_billing_readiness/g)).toHaveLength(1);
  });

  test("proves resolver snapshots match installed order, invoice, and receipt shapes", () => {
    const resolver = functionBody(
      "coachfort_internal",
      "resolve_platform_billing_readiness",
    );
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const apply = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    const customerKeys = [
      "legal_name",
      "billing_email",
      "billing_phone",
      "invoice_contact_name",
      "address_line1",
      "address_line2",
      "city",
      "state",
      "postal_code",
      "country",
      "preferred_currency",
      "tax_registration_type",
      "tax_id",
      "profile_updated_at",
    ];
    const issuerKeys = [
      "legal_name",
      "billing_email",
      "billing_phone",
      "address_line1",
      "address_line2",
      "city",
      "state",
      "postal_code",
      "country",
      "tax_registration_type",
      "tax_id",
      "effective_from",
      "profile_updated_at",
    ];

    for (const key of customerKeys) {
      expect(resolver).toContain(`'${key}', v_profile.`);
    }
    for (const key of issuerKeys) {
      expect(resolver).toContain(`'${key}', v_issuer.`);
    }
    for (const block of [pre, apply, post]) {
      expect(block).toContain("tenant_payment_orders_frozen_snapshot_shape_check");
      expect(block).toContain("invoices_snapshot_shape_check");
      expect(block).toContain("platform_billing_receipts_snapshot_shape_check");
      expect(block).toContain("pg_get_constraintdef");
    }
    expect(post).toContain("resolver_snapshot_shape_contract");
    expect(post).toContain("renewal_replay_precedes_live_readiness");
  });

  test("keeps provider contact after database order authority", () => {
    const authorityCall = orderRoute.indexOf(
      '"create_platform_payment_order_authority_server"',
    );
    const providerCall = orderRoute.indexOf("await createRazorpayOrder");

    expect(authorityCall).toBeGreaterThan(-1);
    expect(providerCall).toBeGreaterThan(authorityCall);
  });

  test("keeps activation invoices and receipts bound to frozen snapshots", () => {
    const sql = executableSql().toLowerCase();
    const activationSource = fulfillmentMigration.toLowerCase();
    const receiptSource = documentMigration.toLowerCase();

    expect(sql).not.toMatch(
      /create (?:or replace )?function public\.issue_platform_invoice_for_activation_server/i,
    );
    expect(sql).not.toMatch(
      /create (?:or replace )?function public\.issue_platform_(?:receipt_for_fulfillment_server|payment_receipt)/i,
    );
    expect(activationSource).toContain("v_order.billing_snapshot");
    expect(activationSource).toContain("v_order.issuer_snapshot");
    expect(receiptSource).toContain("v_invoice.billing_snapshot");
    expect(receiptSource).toContain("v_invoice.issuer_snapshot");
    expect(sql).toContain("protected_function_fingerprints");
    expect(sql).toContain("changed protected data or snapshot authorities");
  });

  test("exposes only aggregate field-status data through a service-role RPC", () => {
    const safeRpc = functionBody(
      "public",
      "get_platform_billing_readiness_server",
    );
    const sql = executableSql().toLowerCase();

    expect(safeRpc).toContain("resolve_platform_billing_readiness");
    expect(safeRpc).toContain("'missing_fields'");
    expect(safeRpc).toContain("'invalid_fields'");
    expect(safeRpc).not.toContain("'{issuer,snapshot}'");
    expect(safeRpc).not.toContain("'{customer,snapshot}'");
    for (const sensitive of [
      "legal_name",
      "billing_email",
      "billing_phone",
      "address_line1",
      "tax_id",
      "razorpay",
      "provider",
    ]) {
      expect(safeRpc).not.toContain(sensitive);
    }
    expect(sql).toContain(
      "grant execute on function public.get_platform_billing_readiness_server(uuid,text)\n  to service_role",
    );
    expect(sql).toContain(
      "revoke all on function public.get_platform_billing_readiness_server(uuid,text)\n  from public, anon, authenticated, service_role",
    );
  });

  test("keeps private helpers private with fixed ownership and search paths", () => {
    const sql = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    for (const identity of [
      "coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)",
      "coachfort_internal.assert_platform_billing_readiness(uuid,text,timestamptz)",
    ]) {
      expect(sql).toContain(`alter function ${identity} owner to postgres`);
      expect(sql).toContain(`revoke all on function ${identity}`);
    }
    expect(post).toContain("private_readiness_authority_security");
    expect(post).toContain("live_authority_security");
    expect(post).toContain("search_path=public, pg_temp");
    expect(post).toContain("acl.grantee = 0");
  });

  test("leaves the percentage completion helper unchanged", () => {
    const sql = executableSql().toLowerCase();
    expect(sql).not.toMatch(
      /create (?:or replace )?function public\.get_tenant_billing_profile_completion/i,
    );
    expect(sql).toContain("'completion_helper', md5(pg_get_functiondef");
  });

  test("introduces no browser table writes or provider-runtime authority", () => {
    const sql = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();
    const resolver = functionBody(
      "coachfort_internal",
      "resolve_platform_billing_readiness",
    );

    expect(sql).not.toMatch(/(?:grant|revoke)[\s\S]{0,80}on table/i);
    expect(resolver).not.toContain("razorpay_");
    expect(resolver).not.toContain("provider");
    expect(post).toContain("no_provider_runtime_authority_in_sql");
    expect(post).toContain("browser_write_authority_unchanged");
  });

  test("protects financial rows and makes POST security gating decisive", () => {
    const sql = executableSql().toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    for (const label of [
      "issuer_profiles",
      "tenant_billing_profiles",
      "payment_orders",
      "payment_attempts",
      "webhook_events",
      "activation_events",
      "assignments",
      "change_intents",
      "invoices",
      "invoice_items",
      "receipts",
    ]) {
      expect(sql).toContain(`'${label}'`);
    }
    expect(sql).toContain("v_current_counts is distinct from v_baseline.row_counts");
    expect(post).toContain("procedure.oid function_oid");
    expect(post).toContain(
      "where function_oid = to_regprocedure(\n    'coachfort_internal.resolve_platform_billing_readiness(uuid,text,timestamptz)'",
    );
    expect(post).not.toContain(
      "where identity = 'coachfort_internal.resolve_platform_billing_readiness(uuid, text",
    );
    expect(post).toContain("protected_rows_unchanged");
    expect(post).toContain("security_gate");
    for (const gate of [
      "canonical_readiness_authority_ready",
      "exact_function_identities",
      "private_readiness_authority_security",
      "live_authority_security",
      "issuer_readiness_contract",
      "customer_readiness_contract",
      "currency_readiness_contract",
      "resolver_snapshot_shape_contract",
      "initial_order_uses_shared_readiness",
      "renewal_order_uses_shared_readiness",
      "renewal_replay_precedes_live_readiness",
      "live_invoice_shared_readiness",
      "activation_invoice_snapshot_boundary_preserved",
      "receipt_snapshot_boundary_preserved",
      "safe_readiness_rpc_server_only",
      "safe_readiness_output_contract",
      "no_provider_runtime_authority_in_sql",
      "browser_write_authority_unchanged",
    ]) {
      expect(post).toContain(`gates.${gate}`);
    }
  });
});
