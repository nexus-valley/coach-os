import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath =
  "supabase/regression_r3c_reporting_projection_authority.sql";
const migration = read(migrationPath);
const r2 = read("supabase/regression_r2_noncommercial_access_authority.sql");
const r3b = read(
  "supabase/regression_r3b_commercial_mutation_boundary.sql",
);
const platformBaseline = read("supabase/module56_platform_owner_console.sql");
const platformClient = read("src/lib/platform.ts");
const closureVerifier = read(
  "support-ops/regression-r3c-production-closure-verifier.sql",
).toLowerCase();

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

function sliceBetween(
  source: string,
  start: string,
  end: string,
  fromIndex = 0,
) {
  const startIndex = source.indexOf(start, fromIndex);
  expect(startIndex, `Expected section start: ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex, `Expected section end: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function countOccurrences(source: string, value: string) {
  return source.split(value).length - 1;
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
  return body.replace(/^ +| +$/g, "").replace(/\s+/g, " ");
}

function prosrcHash(sql: string, schema: string, name: string) {
  const definition = functionDefinition(sql, schema, name);
  const match = definition.match(/\bas\s+\$\$([\s\S]*?)\$\$;/i);
  expect(match, `Expected body for ${schema}.${name}`).not.toBeNull();
  return createHash("sha256")
    .update(normalizePostgresProsrc(match?.[1] ?? ""), "utf8")
    .digest("hex");
}

type ReportingEvidence = {
  currentGrantId?: string | null;
  currentSource?: string | null;
  currentStatus?: string | null;
  durableGrant?: boolean;
  fixtureType?: string | null;
  tenantId?: string | null;
};

function isCommerciallyExcluded(evidence: ReportingEvidence) {
  if (!evidence.tenantId) return true;
  return Boolean(
    evidence.currentStatus === "noncommercial" ||
      evidence.currentSource === "platform_noncommercial" ||
      evidence.currentGrantId ||
      evidence.durableGrant ||
      evidence.fixtureType === "regression",
  );
}

function commercialProjection<T>(evidence: ReportingEvidence, row: T) {
  return isCommerciallyExcluded(evidence) ? null : row;
}

test.describe("REGRESSION-R3C reporting projection authority", () => {
  test("1. has one transactional APPLY with read-only PRE and POST", () => {
    expect(executableSql()).toMatch(/^begin;/);
    expect(executableSql()).toMatch(/commit;\s*$/);
    for (const verifier of [preSql(), postSql()]) {
      expect(verifier).not.toMatch(
        /^\s*(insert\s+into|update\s+\S+\s+set|delete\s+from|create\s+(?:table|function|trigger)|alter\s+(?:table|function)|drop\s+|truncate\s+)/m,
      );
    }
  });

  test("2. pins PostgreSQL-compatible baselines for all three readers", () => {
    const expected = [
      [
        "get_platform_dashboard",
        "0cf0ac80b08c6731c9f7c901ef30e95b09da1aa762cb4c0a7dc1de91738349c3",
      ],
      [
        "get_platform_tenants",
        "01b03feb41d320b728ef8c78e74f1a157b4f38c2bb5b43802ade7bef8284df90",
      ],
      [
        "get_platform_tenant_detail",
        "736cffab0418a368a4fe3b4764cb6a22475f49008c203bd8221c7585c650c4e4",
      ],
    ] as const;

    for (const [name, hash] of expected) {
      expect(prosrcHash(platformBaseline, "public", name)).toBe(hash);
      expect(preSql()).toContain(hash);
      expect(executableSql()).toContain(hash);
    }
  });

  test("3. pins exact installed hashes for the corrected readers", () => {
    const expected = [
      [
        "get_platform_dashboard",
        "3c565dad47bb518cbe0ada11f9d352aa7ce49571a2680249f6c44a3f1012ea74",
      ],
      [
        "get_platform_tenants",
        "aeee712368e4c923f496f461d34ac1ad39b1c8c362cfb36fa44c8857920c3b84",
      ],
      [
        "get_platform_tenant_detail",
        "d99412b6b30966b744a1df4cdba515a8b8fe184f56739c5f6be400b7f632eddf",
      ],
    ] as const;

    for (const [name, hash] of expected) {
      expect(prosrcHash(migration, "public", name)).toBe(hash);
      expect(executableSql()).toContain(hash);
      expect(postSql()).toContain(hash);
    }
  });

  test("4. reuses the exact private R3B exclusion helper", () => {
    const apply = executableSql();
    expect(apply).toContain(
      "coachfort_internal.tenant_has_noncommercial_regression_evidence",
    );
    expect(apply).toContain(
      "3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed",
    );
    expect(apply).not.toMatch(
      /create(?: or replace)? function coachfort_internal\.tenant_has_noncommercial_regression_evidence/,
    );
    expect(migration).not.toContain("commercial_reporting_helper");
  });

  test("5. exclusion is fail-closed for null tenant identity", () => {
    const helper = functionBody(
      r3b,
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    expect(helper).toContain("when p_tenant_id is null then true");
    expect(isCommerciallyExcluded({ tenantId: null })).toBe(true);
  });

  test("6. excludes each independent current assignment marker", () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    expect(
      isCommerciallyExcluded({ currentStatus: "noncommercial", tenantId }),
    ).toBe(true);
    expect(
      isCommerciallyExcluded({
        currentSource: "platform_noncommercial",
        tenantId,
      }),
    ).toBe(true);
    expect(
      isCommerciallyExcluded({ currentGrantId: "grant", tenantId }),
    ).toBe(true);
  });

  test("7. durable grant evidence excludes active and revoked grants", () => {
    const helper = functionBody(
      r3b,
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    expect(helper).toContain("tenant_noncommercial_access_grants");
    expect(helper).not.toContain("revoked_at");
    expect(
      isCommerciallyExcluded({ durableGrant: true, tenantId: "tenant" }),
    ).toBe(true);
  });

  test("8. regression fixture classification excludes commercial reporting", () => {
    const helper = functionBody(
      r3b,
      "coachfort_internal",
      "tenant_has_noncommercial_regression_evidence",
    );
    expect(helper).toContain("classification.fixture_type = 'regression'");
    expect(
      isCommerciallyExcluded({ fixtureType: "regression", tenantId: "tenant" }),
    ).toBe(true);
  });

  test("9. dashboard derives every commercial KPI from one excluded relation", () => {
    const body = functionBody(migration, "public", "get_platform_dashboard");
    expect(body).toContain("with commercial_subscriptions as");
    expect(body).toContain(
      "tenant_has_noncommercial_regression_evidence(\n      projection.tenant_id",
    );
    for (const metric of [
      "active_tenants",
      "trial_tenants",
      "suspended_tenants",
      "active_subscriptions",
      "overdue_subscriptions",
    ]) {
      expect(body).toMatch(
        new RegExp(`'${metric}'[\\s\\S]*?commercial_subscriptions`),
      );
    }
  });

  test("10. generic workspace and product footprint counts stay inclusive", () => {
    const body = functionBody(migration, "public", "get_platform_dashboard");
    expect(body).toContain(
      "'tenant_count', (select count(*) from public.tenants)",
    );
    expect(body).toContain(
      "'total_students', (select count(*) from public.students)",
    );
    expect(body).toContain(
      "'total_courses', (select count(*) from public.courses)",
    );
  });

  test("11. stale trial projection is absent from commercial trial count", () => {
    const staleTrial = { amount: 0, paymentStatus: "not_required", status: "trial" };
    expect(
      commercialProjection(
        { durableGrant: true, tenantId: "tenant" },
        staleTrial,
      ),
    ).toBeNull();
    expect(
      commercialProjection(
        { fixtureType: "regression", tenantId: "tenant" },
        staleTrial,
      ),
    ).toBeNull();
  });

  test("12. stale trial projection is absent from active subscriptions", () => {
    const body = functionBody(migration, "public", "get_platform_dashboard");
    expect(body).toContain(
      "'active_subscriptions', (select count(*) from commercial_subscriptions where status in ('trial', 'active'))",
    );
  });

  test("13. commercial customer and subscription proxies exclude regression", () => {
    const body = functionBody(migration, "public", "get_platform_dashboard");
    expect(body).toContain(
      "'active_tenants', (select count(*) from commercial_subscriptions where status = 'active')",
    );
    expect(body).toContain(
      "'active_subscriptions', (select count(*) from commercial_subscriptions where status in ('trial', 'active'))",
    );
  });

  test("14. no trial conversion KPI is invented", () => {
    const reportingSources = [
      functionBody(migration, "public", "get_platform_dashboard"),
      functionBody(migration, "public", "get_platform_tenants"),
      functionBody(migration, "public", "get_platform_tenant_detail"),
    ].join("\n");
    expect(reportingSources).not.toMatch(
      /trial_conversion|conversion_rate|converted_subscriptions|paid_conversion/,
    );
  });

  test("15. future conversion numerator and denominator share the permanent exclusion", () => {
    const historicalTrial = { status: "trial" };
    const converted = { status: "active" };
    const evidence = { durableGrant: true, tenantId: "tenant" };
    expect(commercialProjection(evidence, historicalTrial)).toBeNull();
    expect(commercialProjection(evidence, converted)).toBeNull();
  });

  test("16. R3C adds no MRR, ARR, or subscription revenue authority", () => {
    const readerBodies = [
      functionBody(migration, "public", "get_platform_dashboard"),
      functionBody(migration, "public", "get_platform_tenants"),
      functionBody(migration, "public", "get_platform_tenant_detail"),
    ].join("\n");
    expect(readerBodies).not.toMatch(/\bmrr\b|\barr\b|subscription_revenue/);
  });

  test("17. tenant list exposes truthful exclusion and suppresses stale fields", () => {
    const body = functionBody(migration, "public", "get_platform_tenants");
    expect(body).toContain(
      "'commercial_reporting_excluded', reporting.commercial_reporting_excluded",
    );
    expect(body).toContain("then 'noncommercial_regression'");
    expect(body).toContain(
      "left join public.platform_tenant_subscriptions pts\n      on pts.tenant_id = t.id\n     and not reporting.commercial_reporting_excluded",
    );
    for (const field of [
      "status",
      "payment_status",
      "billing_cycle",
      "amount",
      "currency",
      "trial_ends_at",
      "current_period_end",
      "plan_name",
      "plan_code",
    ]) {
      expect(body).toContain(`'${field}'`);
    }
  });

  test("18. tenant detail exposes truth without fake paid fields", () => {
    const body = functionBody(
      migration,
      "public",
      "get_platform_tenant_detail",
    );
    expect(body).toContain(
      "'commercial_reporting_excluded', reporting.commercial_reporting_excluded",
    );
    expect(body).toContain("then 'noncommercial_regression'");
    expect(body).toContain(
      "left join public.platform_tenant_subscriptions pts\n    on pts.tenant_id = t.id\n   and not reporting.commercial_reporting_excluded",
    );
    expect(body).not.toContain("'status', 'active'");
    expect(body).not.toContain("'payment_status', 'paid'");
    expect(body).not.toContain("'billing_cycle', 'monthly'");
    expect(body).not.toContain("'currency', 'inr'");
    expect(body).toContain(
      "'subscription_status', case\n        when reporting.commercial_reporting_excluded then null",
    );
  });

  test("19. client data contract carries the explicit reporting state", () => {
    expect(platformClient).toContain("commercial_reporting_excluded: boolean;");
    expect(platformClient).toContain(
      'commercial_reporting_exclusion: "noncommercial_regression" | null;',
    );
    expect(platformClient).not.toContain('status: "noncommercial"');
  });

  test("20. readers never update or delete stale projection evidence", () => {
    const apply = executableSql();
    expect(apply).not.toMatch(
      /(?:insert into|update|delete from) public\.platform_tenant_subscriptions/,
    );
    expect(apply).not.toMatch(
      /(?:insert into|update|delete from) public\.tenant_subscription_assignments/,
    );
  });

  test("21. only the three approved reader bodies are replaced", () => {
    const definitions = [
      ...migration.matchAll(
        /create or replace function\s+([a-z0-9_.]+)\s*\(/gi,
      ),
    ].map((match) => match[1]?.toLowerCase());
    expect(definitions).toEqual([
      "public.get_platform_dashboard",
      "public.get_platform_tenants",
      "public.get_platform_tenant_detail",
    ]);
  });

  test("22. R2 and R3B mutation authorities are fingerprinted, not replaced", () => {
    const apply = executableSql();
    for (const [name, hash] of [
      [
        "set_tenant_subscription_plan",
        "d8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5",
      ],
      [
        "update_tenant_subscription",
        "a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc",
      ],
      [
        "create_platform_payment_order_authority_server",
        "6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11",
      ],
    ]) {
      expect(apply).toContain(hash);
      expect(apply).not.toMatch(
        new RegExp(`create(?: or replace)? function public\\.${name}\\(`),
      );
    }
  });

  test("23. product entitlement and lifecycle authorities are untouched", () => {
    expect(migration).not.toMatch(
      /create(?: or replace)? function public\.(?:tenant_subscription_effective_lifecycle|resolve_effective_feature_access|consume_monthly_usage)/i,
    );
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:subscription_plan_features|subscription_plan_usage_limits|tenant_subscription_overrides)/i,
    );
  });

  test("24. valid Growth noncommercial access remains product-entitled", () => {
    const grant = functionBody(
      r2,
      "public",
      "grant_tenant_noncommercial_access_server",
    );
    expect(grant).toContain("plan.code = 'growth'");
    expect(grant).toContain("'noncommercial'");
    expect(grant).toContain("'platform_noncommercial'");
    expect(migration).not.toContain("subscription_plan_features");
    expect(migration).not.toContain("subscription_plan_usage_limits");
  });

  test("25. payment, renewal, invoice, receipt, and provider writes are absent", () => {
    const apply = executableSql();
    expect(apply).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:tenant_payment_orders|tenant_subscription_change_intents|platform_subscription_invoices|platform_payment_receipts|payment_attempts)/,
    );
    expect(apply).not.toMatch(/razorpay|provider_order_id|provider_payment_id/);
  });

  test("26. Platform reader ACLs remain authenticated-only", () => {
    const apply = executableSql();
    for (const signature of [
      "get_platform_dashboard()",
      "get_platform_tenants()",
      "get_platform_tenant_detail(uuid)",
    ]) {
      expect(apply).toContain(
        `revoke all on function public.${signature}\n  from public, anon, authenticated, service_role;`,
      );
      expect(apply).toContain(
        `grant execute on function public.${signature}`,
      );
    }
    expect(postSql()).toContain("exact_reader_contract");
  });

  test("27. protected business counts are unchanged transactionally", () => {
    const apply = executableSql();
    expect(apply).toContain("regression_r3c_protected_baseline");
    for (const relation of [
      "public.tenants",
      "public.students",
      "public.courses",
      "public.tenant_members",
      "public.platform_tenant_subscriptions",
      "public.platform_subscription_plans",
      "public.tenant_subscription_assignments",
      "tenant_noncommercial_access_grants",
      "tenant_noncommercial_access_events",
      "tenant_fixture_classifications",
    ]) {
      expect(apply).toContain(relation);
    }
    expect(apply).toContain("changed protected business data");
  });

  test("28. PRE and APPLY retain the closed first-grant gate", () => {
    expect(preSql()).toContain("no_grants_issued");
    expect(preSql()).toContain("no_grant_events");
    expect(preSql()).toContain("no_noncommercial_assignment_markers");
    expect(executableSql()).toContain(
      "must be installed before the first grant",
    );
  });

  test("29. no tenant, user, email, or workspace identity is hardcoded", () => {
    expect(migration).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(migration).not.toMatch(/@[a-z0-9.-]+|coachfort regression 2026/i);
  });

  test("30. expired fixture behavior is not repaired or reclassified", () => {
    const apply = executableSql();
    expect(apply).not.toMatch(
      /update public\.tenants|update public\.tenant_fixture_classifications|trial_period_elapsed/,
    );
    expect(apply).not.toContain("operational_allowed");
  });

  test("31. no commercial export or frontend-only hiding is introduced", () => {
    expect(migration).not.toMatch(/csv|export|download/);
    expect(platformClient).not.toContain("filterCommercialTenants");
    expect(platformClient).not.toContain("hideRegressionTenant");
  });

  test("32. source verifiers prove dashboard, list, detail, and no mutation", () => {
    const post = postSql();
    expect(post).toContain("dashboard_commercial_exclusion");
    expect(post).toContain("tenant_list_truthful_projection");
    expect(post).toContain("tenant_detail_truthful_projection");
    expect(post).toContain("readers_are_nonmutating");
    expect(post).toContain("security_gate");
  });

  test("33. migration remains pre-grant and does not issue authority", () => {
    const apply = executableSql();
    expect(apply).not.toMatch(
      /grant_tenant_noncommercial_access_server\s*\(|revoke_tenant_noncommercial_access_server\s*\(/,
    );
    expect(apply).not.toMatch(
      /insert into coachfort_internal\.tenant_noncommercial_access_/,
    );
  });

  test("34. migration content has a stable review hash", () => {
    const hash = createHash("sha256").update(migration, "utf8").digest("hex");
    expect(hash).toBe(
      "9f55cc87f49ecbb55ba8a87a579e96ce137595b3922c03b016c2a042bccd9109",
    );
    expect(read(migrationPath)).toBe(migration);
  });

  test("35. reader PRE rejects unexpected EXECUTE roles", () => {
    const pre = preSql();
    const reader = sliceBetween(pre, "reader_state as (", "expected_r3b(");
    expect(reader).toContain("acl.grantee <> procedure.proowner");
    expect(reader).toContain("role_definition.rolname = 'authenticated'");
  });

  test("36. opening APPLY reader guard rejects unexpected EXECUTE roles", () => {
    const apply = executableSql();
    const reader = sliceBetween(
      apply,
      "with expected(identity, expected_sha256) as (",
      "if not coalesce(v_readers_ready, false)",
    );
    expect(reader).toContain("acl.grantee <> procedure.proowner");
    expect(reader).toContain("role_definition.rolname = 'authenticated'");
  });

  test("37. installed-reader verification rejects unexpected EXECUTE roles", () => {
    const apply = executableSql();
    const installedStart = apply.indexOf(
      "alter function public.get_platform_dashboard() owner to postgres;",
    );
    const reader = sliceBetween(
      apply,
      "with expected(identity, expected_sha256) as (",
      "if not coalesce(v_readers_ready, false)",
      installedStart,
    );
    expect(reader).toContain("acl.grantee <> procedure.proowner");
    expect(reader).toContain("role_definition.rolname = 'authenticated'");
  });

  test("38. reader POST rejects unexpected EXECUTE roles", () => {
    const post = postSql();
    const reader = sliceBetween(post, "reader_state as (", "source_state as (");
    expect(reader).toContain("acl.grantee <> procedure.proowner");
    expect(reader).toContain("role_definition.rolname = 'authenticated'");
  });

  test("39. R3B helper permits owner only", () => {
    const sql = migration.toLowerCase().replace(/\s+/g, " ");
    const tuple = [
      "'coachfort_internal.tenant_has_noncommercial_regression_evidence(uuid)',",
      "'3b55db11d94aa77f79e723947c81a457483e33076ecfae3177a1402f0b51b0ed',",
      "'s', false, false",
    ].join(" ");
    expect(countOccurrences(sql, tuple)).toBe(4);
  });

  test("40. R3B setter permits owner and authenticated only", () => {
    const sql = migration.toLowerCase().replace(/\s+/g, " ");
    const tuple = [
      "'public.set_tenant_subscription_plan(uuid,text,text,text,text,text,timestamptz,jsonb)',",
      "'d8e25b1d867ae03abcda0e7dd8496160f39f6e092de4498d504cbf4c866e2bd5',",
      "'v', true, false",
    ].join(" ");
    expect(countOccurrences(sql, tuple)).toBe(4);
  });

  test("41. R3B projection writer permits owner and authenticated only", () => {
    const sql = migration.toLowerCase().replace(/\s+/g, " ");
    const tuple = [
      "'public.update_tenant_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,numeric,text,text,text,jsonb)',",
      "'a528079ee4f579cc6f9c443b370446658f92ef4afe0fc2118271eff049e97bcc',",
      "'v', true, false",
    ].join(" ");
    expect(countOccurrences(sql, tuple)).toBe(4);
  });

  test("42. R3B checkout permits owner and service_role only", () => {
    const sql = migration.toLowerCase().replace(/\s+/g, " ");
    const tuple = [
      "'public.create_platform_payment_order_authority_server(uuid,uuid,uuid,uuid)',",
      "'6d0ec8fd99ec3436bbf3145f827b6928f5de860a745fccc2a9789abf1bad1f11',",
      "'v', false, true",
    ].join(" ");
    expect(countOccurrences(sql, tuple)).toBe(4);
  });

  test("43. every R3B contract rejects unexpected EXECUTE grantees", () => {
    const sql = migration.toLowerCase();
    expect(countOccurrences(sql, "acl.grantee <> procedure.proowner")).toBe(8);
    expect(
      countOccurrences(
        sql,
        "expected.authenticated_execute\n            and acl.grantee = (",
      ),
    ).toBe(4);
    expect(
      countOccurrences(
        sql,
        "expected.service_execute\n            and acl.grantee = (",
      ),
    ).toBe(4);
  });

  test("44. POST R3B contract verifies full security and exact ACL", () => {
    const post = postSql();
    const r3b = sliceBetween(post, "expected_r3b(", "first_grant_state as (");
    expect(r3b).toContain("pg_get_userbyid(procedure.proowner) = 'postgres'");
    expect(r3b).toContain("procedure.prosecdef");
    expect(r3b).toContain(
      'procedure.provolatile = expected.expected_volatility::"char"',
    );
    expect(r3b).toContain("procedure.proconfig = array[");
    expect(r3b).toContain("expected.expected_sha256");
    expect(r3b).toContain("expected.authenticated_execute");
    expect(r3b).toContain("expected.service_execute");
    expect(r3b).toContain("acl.grantee <> procedure.proowner");
  });

  test("45. multiline exclusion calls require whitespace-tolerant verification", () => {
    const dashboard = functionBody(
      migration,
      "public",
      "get_platform_dashboard",
    );
    const tenantList = functionBody(
      migration,
      "public",
      "get_platform_tenants",
    );
    const tenantDetail = functionBody(
      migration,
      "public",
      "get_platform_tenant_detail",
    );

    const normalizedDashboard = normalizePostgresProsrc(dashboard);
    const normalizedTenantList = normalizePostgresProsrc(tenantList);
    const normalizedTenantDetail = normalizePostgresProsrc(tenantDetail);

    expect(normalizedDashboard).toContain(
      "tenant_has_noncommercial_regression_evidence( projection.tenant_id )",
    );
    expect(normalizedDashboard).not.toContain(
      "tenant_has_noncommercial_regression_evidence(projection.tenant_id)",
    );
    expect(normalizedTenantList).toContain(
      "tenant_has_noncommercial_regression_evidence( t.id )",
    );
    expect(normalizedTenantDetail).toContain(
      "tenant_has_noncommercial_regression_evidence( t.id )",
    );

    expect(dashboard).toMatch(
      /tenant_has_noncommercial_regression_evidence\s*\(\s*projection\.tenant_id\s*\)/,
    );
    expect(tenantList).toMatch(
      /tenant_has_noncommercial_regression_evidence\s*\(\s*t\.id\s*\)/,
    );
    expect(tenantDetail).toMatch(
      /tenant_has_noncommercial_regression_evidence\s*\(\s*t\.id\s*\)/,
    );
    expect(closureVerifier).toContain(
      "tenant_has_noncommercial_regression_evidence[[:space:]]*[(][[:space:]]*projection[.]tenant_id[[:space:]]*[)]",
    );
    expect(
      countOccurrences(
        closureVerifier,
        "tenant_has_noncommercial_regression_evidence[[:space:]]*[(][[:space:]]*t[.]id[[:space:]]*[)]",
      ),
    ).toBe(2);
  });

  test("46. closure returns business counts as informational context", () => {
    expect(closureVerifier).toContain("'informational_business_counts'");
    expect(closureVerifier).toContain("'gates_closure', false");
    expect(closureVerifier).toContain("'actual', jsonb_build_object(");
    expect(closureVerifier).toContain("'expected', jsonb_build_object(");
    expect(closureVerifier).toContain(
      "'matches_pre_snapshot', counts.matches_pre_snapshot",
    );
  });

  test("47. ordinary production count drift cannot control closure", () => {
    const gate = sliceBetween(
      closureVerifier,
      "gate as (",
      "select jsonb_build_object(",
    );
    expect(gate).not.toContain("counts.");
    expect(gate).not.toContain("matches_pre_snapshot");
    expect(gate).not.toContain("business_count_state");
  });

  test("48. zero first-grant state remains a closure gate", () => {
    const gate = sliceBetween(
      closureVerifier,
      "gate as (",
      "select jsonb_build_object(",
    );
    expect(gate).toContain("first_grant.noncommercial_grants = 0");
    expect(gate).toContain("first_grant.noncommercial_grant_events = 0");
    expect(gate).toContain(
      "first_grant.noncommercial_assignment_markers = 0",
    );
  });

  test("49. expired fixture preservation remains a closure gate", () => {
    const gate = sliceBetween(
      closureVerifier,
      "gate as (",
      "select jsonb_build_object(",
    );
    expect(gate).toContain("fixture.tenant_present");
    expect(gate).toContain("fixture.expired_fixture_unchanged");
    expect(gate).toContain("cross join expired_fixture_state fixture");
  });

  test("50. exact reader and R3B authority remain closure gates", () => {
    const gate = sliceBetween(
      closureVerifier,
      "gate as (",
      "select jsonb_build_object(",
    );
    expect(gate).toContain("readers.exact_reader_identities");
    expect(gate).toContain("readers.no_unexpected_reader_overloads");
    expect(gate).toContain("readers.exact_reader_contract");
    expect(gate).toContain("semantics.exact_reader_semantics");
    expect(gate).toContain("semantics.readers_are_nonmutating");
    expect(gate).toContain("r3b.exact_r3b_identities");
    expect(gate).toContain("r3b.no_unexpected_r3b_overloads");
    expect(gate).toContain("r3b.exact_r3b_contract");
  });

  test("51. closure requires every direct reader relation", () => {
    const relations = sliceBetween(
      closureVerifier,
      "expected_relations(identity) as (",
      "expected_reader_dependencies(identity) as (",
    );
    for (const identity of [
      "public.audit_logs",
      "public.platform_activity_logs",
      "public.platform_tenant_usage_snapshots",
      "public.platform_support_notes",
    ]) {
      expect(relations).toContain(`('${identity}')`);
    }
    expect(relations).toContain("all_required_relations_present");
  });

  test("52. closure checks Platform reader authorization dependencies", () => {
    const dependencies = sliceBetween(
      closureVerifier,
      "expected_reader_dependencies(identity) as (",
      "first_grant_state as (",
    );
    for (const identity of [
      "public.is_platform_admin()",
      "public.platform_can_view_tenant(uuid)",
      "public.platform_can_manage_support()",
    ]) {
      expect(dependencies).toContain(`('${identity}')`);
    }
    expect(dependencies).toContain("to_regprocedure(identity) is not null");
    expect(dependencies).toContain("as all_present");
  });

  test("53. reader dependency presence remains a closure gate", () => {
    const gate = sliceBetween(
      closureVerifier,
      "gate as (",
      "select jsonb_build_object(",
    );
    expect(gate).toContain("dependencies.all_present");
    expect(gate).toContain("cross join reader_dependency_state dependencies");
    expect(closureVerifier).toContain("'reader_dependencies'");
    expect(closureVerifier).toContain("'all_present', dependencies.all_present");
    expect(closureVerifier).toContain("'functions', dependencies.functions");
  });
});
