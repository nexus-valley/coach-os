import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/regression_r3b_commercial_mutation_boundary.sql",
);
const closureVerifier = read(
  "support-ops/regression-r3b2-production-closure-verifier.sql",
);
const r2 = read("supabase/regression_r2_noncommercial_access_authority.sql");
const entitlementBaseline = read(
  "supabase/module71_7f2_subscription_entitlements.sql",
);
const projectionBaseline = read("supabase/module56_platform_owner_console.sql");
const billingBaseline = read(
  "supabase/bundle_ux8g4b1a_billing_readiness_authority.sql",
);
const orderRoute = read("app/api/billing/razorpay/orders/route.ts");

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected exactly one executable transaction").toHaveLength(1);
  return (matches?.[0] ?? "").toLowerCase();
}

function preSql() {
  return migration.slice(0, migration.indexOf("-- APPLY (")).toLowerCase();
}

function postSql() {
  return migration.slice(migration.indexOf("-- POST-APPLY")).toLowerCase();
}

function functionDefinition(sql: string, schema: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create(?: or replace)? function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

function functionBody(sql: string, schema: string, name: string) {
  return functionDefinition(sql, schema, name).toLowerCase();
}

function normalizePostgresProsrc(body: string) {
  // PostgreSQL btrim(text) removes literal spaces by default, not newlines.
  return body.replace(/^ +| +$/g, "").replace(/\s+/g, " ");
}

function prosrcHash(sql: string, schema: string, name: string) {
  const definition = functionDefinition(sql, schema, name);
  const match = definition.match(/\bas\s+\$\$([\s\S]*?)\$\$;/i);
  expect(match, `Expected body for ${schema}.${name}`).not.toBeNull();
  const normalized = normalizePostgresProsrc(match?.[1] ?? "");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function position(source: string, value: string) {
  const result = source.indexOf(value);
  expect(result, `Expected ${value}`).toBeGreaterThanOrEqual(0);
  return result;
}

test.describe("REGRESSION-R3B commercial mutation boundary", () => {
  test("normalizes prosrc with PostgreSQL btrim boundary semantics", () => {
    expect(
      normalizePostgresProsrc("\nbegin\n  return true;\nend;\n"),
    ).toBe(" begin return true; end; ");
    expect(normalizePostgresProsrc("   begin return true; end;")).toBe(
      "begin return true; end;",
    );
    expect(normalizePostgresProsrc("begin return true; end;   ")).toBe(
      "begin return true; end;",
    );
    expect(normalizePostgresProsrc("\n  begin")).toBe(" begin");
    expect(normalizePostgresProsrc("end;  \n")).toBe("end; ");
    expect(normalizePostgresProsrc("begin\treturn\ntrue;\r\nend;")).toBe(
      "begin return true; end;",
    );
  });

  test("1. preserves one review-only PRE, one transaction, and read-only POST", () => {
    expect(executableSql()).toMatch(/^begin;/);
    expect(executableSql()).toMatch(/commit;\s*$/);
    for (const verifier of [preSql(), postSql()]) {
      expect(verifier).not.toMatch(
        /^\s*(insert\s+into|update\s+\S+\s+set|delete\s+from|create\s+(?:table|function|trigger)|alter\s+(?:table|function)|drop\s+|truncate\s+)/m,
      );
    }
  });

  test("2. fingerprints all three exact pre-R3B function bodies", () => {
    const expected = [
      [
        entitlementBaseline,
        "set_tenant_subscription_plan",
        "24937832f4955b1f93856aa774befc3163177597a043b9231d560879ca6fc0c7",
      ],
      [
        projectionBaseline,
        "update_tenant_subscription",
        "856a57613ac1a7e4fc245ac1b8fa5e8cf8fc431a5d19f93ce250115a10d95f99",
      ],
      [
        billingBaseline,
        "create_platform_payment_order_authority_server",
        "082779ec79038f6eaabbaac5738171b04924f160d3134a3bc559a664e2d4d0c7",
      ],
    ] as const;

    for (const [source, name, hash] of expected) {
      expect(prosrcHash(source, "public", name)).toBe(hash);
      expect(preSql()).toContain(hash);
      expect(executableSql()).toContain(hash);
    }
  });

  test("3. fingerprints the installed R2 grant, revoke, authority, and payment guard", () => {
    const expected = [
      [
        "tenant_noncommercial_access_authority",
        "d92e3b03aa7e216564b99c493cc048b0f4318833d885f0523ee027604a5a2543",
      ],
      [
        "enforce_noncommercial_payment_order_boundary",
        "20300988e6b8b7be9a5ad37972cc1ebad8b7ec1c34bd9c578f2b9a0e25c122ac",
      ],
      [
        "grant_tenant_noncommercial_access_server",
        "414d791d20a6474a14bcbcc9dc2ea308ebc923b79c93d0634a634f925d71fa3d",
      ],
      [
        "revoke_tenant_noncommercial_access_server",
        "3621bea92d3294711cd3c04f1cd3316e07ac468cd944d916ab95e17bf240b9ac",
      ],
    ] as const;

    for (const [name, hash] of expected) {
      const schema = name.startsWith("tenant_") || name.startsWith("enforce_")
        ? "coachfort_internal"
        : "public";
      expect(prosrcHash(r2, schema, name)).toBe(hash);
      expect(executableSql()).toContain(hash);
    }
  });

  test("4. creates one private fail-closed exclusion helper", () => {
    const helper = functionBody(
      executableSql(),
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    expect(helper).toContain("returns boolean");
    expect(helper).toContain("language sql");
    expect(helper).toContain("stable");
    expect(helper).toContain("security definer");
    expect(helper).toContain("set search_path = public, pg_temp");
    expect(helper).toContain("when p_tenant_id is null then true");
  });

  test("5. blocks each current-assignment marker independently", () => {
    const helper = functionBody(
      executableSql(),
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    expect(helper).toContain("assignment.status = 'noncommercial'");
    expect(helper).toContain("or assignment.source = 'platform_noncommercial'");
    expect(helper).toContain("or assignment.noncommercial_grant_id is not null");
    expect(helper).not.toContain("assignment.status = 'noncommercial'\n            and");
  });

  test("6. blocks active and revoked durable grant evidence", () => {
    const helper = functionBody(
      executableSql(),
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    const grantEvidence = helper.match(
      /from coachfort_internal\.tenant_noncommercial_access_grants[\s\S]*?\)/,
    )?.[0] ?? "";
    expect(grantEvidence).toContain("grant_row.tenant_id = p_tenant_id");
    expect(grantEvidence).not.toContain("revoked_at");
  });

  test("7. blocks regression fixture classification independently", () => {
    const helper = functionBody(
      executableSql(),
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    expect(helper).toContain("tenant_fixture_classifications classification");
    expect(helper).toContain("classification.fixture_type = 'regression'");
  });

  test("8. exposes the helper to no browser, PUBLIC, or service role", () => {
    const sql = executableSql();
    expect(sql).toContain(
      "revoke all on function\n  coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)\n  from public, anon, authenticated, service_role",
    );
    expect(sql).not.toMatch(
      /grant execute on function\s+coachfort_internal\.tenant_has_noncommercial_regression_evidence/i,
    );
  });

  test("9. keeps the ordinary set-plan write and result contract", () => {
    const setter = functionBody(
      executableSql(),
      "public",
      "set_tenant_subscription_plan",
    );
    expect(setter).toContain("perform public.subscription_entitlements_assert_platform_manager()");
    expect(setter).toContain("insert into public.tenant_subscription_assignments");
    expect(setter).toContain("'platform_manual'");
    expect(setter).toContain("return public.get_tenant_entitlement_state(p_tenant_id)");
  });

  test("10. orders setter locks tenant, plan, assignment, guard, then mutation", () => {
    const setter = functionBody(
      executableSql(),
      "public",
      "set_tenant_subscription_plan",
    );
    const tenant = position(setter, "from public.tenants tenant");
    const plan = position(setter, "from public.subscription_plans plan");
    const assignment = position(
      setter,
      "from public.tenant_subscription_assignments assignment",
    );
    const guard = position(
      setter,
      "tenant_has_noncommercial_regression_evidence",
    );
    const mutation = position(
      setter,
      "update public.tenant_subscription_assignments",
    );
    expect(tenant).toBeLessThan(plan);
    expect(plan).toBeLessThan(assignment);
    expect(assignment).toBeLessThan(guard);
    expect(guard).toBeLessThan(mutation);
    expect(setter.slice(tenant, guard)).toContain("for update");
    expect(setter.slice(plan, assignment)).toContain("for share");
  });

  test("11. rejects setter mutation on any exclusion evidence", () => {
    const setter = functionBody(
      executableSql(),
      "public",
      "set_tenant_subscription_plan",
    );
    expect(setter).toContain(
      "noncommercial regression authority blocks generic subscription mutation.",
    );
    expect(setter).toContain("using errcode = '42501'");
  });

  test("12. proves setter and grant share tenant-plan-assignment order", () => {
    const setter = functionBody(
      executableSql(),
      "public",
      "set_tenant_subscription_plan",
    );
    const grant = functionBody(
      r2.toLowerCase(),
      "public",
      "grant_tenant_noncommercial_access_server",
    );
    const setterTenant = position(setter, "from public.tenants tenant");
    const setterPlan = position(setter, "from public.subscription_plans plan");
    const setterAssignment = position(
      setter,
      "from public.tenant_subscription_assignments",
    );
    expect(setterTenant).toBeLessThan(setterPlan);
    expect(setterPlan).toBeLessThan(setterAssignment);

    const grantTenant = position(grant, "from public.tenants tenant");
    const grantLockedPlan = position(
      grant,
      "from public.subscription_plans plan\n  where plan.id = v_plan.id",
    );
    const grantAssignment = position(
      grant,
      "from public.tenant_subscription_assignments",
    );
    expect(grantTenant).toBeLessThan(grantLockedPlan);
    expect(grantLockedPlan).toBeLessThan(grantAssignment);
  });

  test("13. keeps the ordinary legacy projection upsert unchanged", () => {
    const projection = functionBody(
      executableSql(),
      "public",
      "update_tenant_subscription",
    );
    expect(projection).toContain("public.platform_can_manage_billing()");
    expect(projection).toContain("insert into public.platform_tenant_subscriptions");
    expect(projection).toContain("on conflict (tenant_id) do update");
    expect(projection).toContain("return saved_id");
  });

  test("14. locks tenant and checks exclusion before legacy projection mutation", () => {
    const projection = functionBody(
      executableSql(),
      "public",
      "update_tenant_subscription",
    );
    const tenant = position(projection, "from public.tenants tenant");
    const guard = position(
      projection,
      "tenant_has_noncommercial_regression_evidence",
    );
    const mutation = position(
      projection,
      "insert into public.platform_tenant_subscriptions",
    );
    expect(tenant).toBeLessThan(guard);
    expect(guard).toBeLessThan(mutation);
    expect(projection.slice(tenant, guard)).toContain("for update");
  });

  test("15. preserves R2 commercial projection rejection and allowed zero-trial nuance", () => {
    const grant = functionBody(
      r2.toLowerCase(),
      "public",
      "grant_tenant_noncommercial_access_server",
    );
    const projectionCheck = grant.match(
      /from public\.platform_tenant_subscriptions projection[\s\S]*?\n\s*\)/,
    )?.[0] ?? "";
    expect(projectionCheck).toContain("projection.status <> 'trial'");
    expect(projectionCheck).toContain("projection.payment_status <> 'not_required'");
    expect(projectionCheck).toContain("projection.amount <> 0");
    expect(projectionCheck).toContain("projection.current_period_start is not null");
    expect(projectionCheck).toContain("projection.current_period_end is not null");
  });

  test("16. keeps initial checkout assignment serialization without tenant lock", () => {
    const order = functionBody(
      executableSql(),
      "public",
      "create_platform_payment_order_authority_server",
    );
    expect(order).toContain("from public.tenant_subscription_assignments");
    expect(order).toContain("for share");
    expect(order).not.toMatch(/from public\.tenants tenant[\s\S]*?for update/);
  });

  test("17. rejects all current noncommercial markers before checkout insert", () => {
    const order = functionBody(
      executableSql(),
      "public",
      "create_platform_payment_order_authority_server",
    );
    const guard = position(order, "if v_current.status = 'noncommercial'");
    expect(order.slice(guard)).toContain("or v_current.source = 'platform_noncommercial'");
    expect(order.slice(guard)).toContain("or v_current.noncommercial_grant_id is not null");
    expect(guard).toBeLessThan(position(order, "insert into public.tenant_payment_orders"));
  });

  test("18. performs a distinct fresh helper read after assignment serialization", () => {
    const order = functionBody(
      executableSql(),
      "public",
      "create_platform_payment_order_authority_server",
    );
    const share = position(order, "for share");
    const helper = position(
      order,
      "tenant_has_noncommercial_regression_evidence",
    );
    expect(share).toBeLessThan(helper);
    expect(order.slice(share, helper)).toContain("noncommercial regression authority");
    expect(order).toContain("fresh read");
    expect(order).toContain("committed snapshot");
  });

  test("19. preserves the exact R2 payment trigger and final race boundary", () => {
    const sql = executableSql();
    expect(sql).toContain("enforce_noncommercial_payment_order_boundary");
    expect(sql).toContain(
      "20300988e6b8b7be9a5ad37972cc1ebad8b7ec1c34bd9c578f2b9a0e25c122ac",
    );
    expect(sql).not.toMatch(
      /(?:create or replace|drop) function coachfort_internal\.enforce_noncommercial_payment_order_boundary/,
    );
    expect(sql).not.toMatch(
      /(?:drop|alter) trigger enforce_noncommercial_payment_order_boundary/,
    );
  });

  test("20. keeps provider creation after successful database authority", () => {
    const authority = position(orderRoute, "await loadCheckoutAuthority(");
    const provider = position(orderRoute, "await createRazorpayOrder(");
    expect(authority).toBeLessThan(provider);
  });

  test("21. does not replace renewal or change-intent authority", () => {
    const sql = executableSql();
    expect(sql).not.toMatch(
      /create(?: or replace)? function public\.create_platform_renewal_payment_order_authority_server/,
    );
    expect(sql).not.toContain("insert into public.tenant_subscription_change_intents");
  });

  test("22. does not replace invoice or fulfillment authority", () => {
    const sql = executableSql();
    expect(sql).not.toMatch(/create(?: or replace)? function public\.issue_platform_/);
    expect(sql).not.toContain("platform_billing_document_fulfillments");
  });

  test("23. does not replace receipt, webhook, or activation authority", () => {
    const sql = executableSql();
    expect(sql).not.toContain("issue_platform_payment_receipt");
    expect(sql).not.toContain("tenant_payment_attempts");
    expect(sql).not.toContain("tenant_plan_activation_events");
  });

  test("24. leaves lifecycle, Growth entitlements, usage, and video authority untouched", () => {
    const sql = executableSql();
    for (const forbidden of [
      "tenant_subscription_effective_lifecycle",
      "resolve_effective_feature_access",
      "consume_monthly_usage",
      "video_storage_minutes",
      "native_video",
    ]) {
      expect(sql).not.toContain(`create or replace function ${forbidden}`);
    }
    expect(sql).not.toContain("update public.subscription_plan_");
  });

  test("25. contains no hardcoded tenant, user, email, or workspace identity", () => {
    const sql = migration.toLowerCase();
    expect(sql).not.toMatch(/coachfort\s+regression\s+\d{4}/);
    expect(sql).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
    expect(sql).not.toMatch(
      /'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'/,
    );
  });

  test("26. keeps the R3B2 production closure verifier read-only and decisive", () => {
    const sql = closureVerifier.toLowerCase();
    expect(sql).toMatch(/begin transaction read only;/);
    expect(sql).toMatch(/rollback;\s*$/);
    expect(sql.match(/^select jsonb_build_object\(/gm)).toHaveLength(1);
    expect(sql).not.toMatch(
      /^\s*(?:create|alter|drop|truncate|insert|update|delete|grant|revoke|call|do)\b/gm,
    );
    expect(sql).not.toMatch(
      /^\s*(?:select|perform|call)\s+(?:public\.)?(?:grant|revoke)_tenant_noncommercial_access_server\s*\(/gm,
    );

    for (const hash of [
      "3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed",
      "d8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5",
      "a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc",
      "6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11",
      "d92e3b03aa7e216564b99c493cc048b0f4318833d885f0523ee027604a5a2543",
      "20300988e6b8b7be9a5ad37972cc1ebad8b7ec1c34bd9c578f2b9a0e25c122ac",
      "414d791d20a6474a14bcbcc9dc2ea308ebc923b79c93d0634a634f925d71fa3d",
      "3621bea92d3294711cd3c04f1cd3316e07ac468cd944d916ab95e17bf240b9ac",
    ]) {
      expect(sql).toContain(hash);
    }

    expect(sql).toContain("f93faeee-b177-497e-854e-5052497914b9");
    expect(sql).toContain("trial_period_elapsed");
    expect(sql).toContain("noncommercial_assignment_markers");
    expect(sql).toContain("required_product_authorities_present");
    expect(sql).toContain("r3b_production_closure_pass");
    expect(sql).toContain("current_setting('transaction_read_only') = 'on'");
  });
});
