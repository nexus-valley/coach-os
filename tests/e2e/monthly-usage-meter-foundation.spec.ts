import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g4a2b_monthly_usage_meter_foundation.sql",
);
const ux8g1b = read(
  "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
);
const ux8g4a2a = read(
  "supabase/bundle_ux8g4a2a_server_feature_entitlement_closure.sql",
);
const subscriptionEntitlementsMigration = read(
  "supabase/module71_7f2_subscription_entitlements.sql",
);
const module70Cleanup = [
  "supabase/module70_1_smoke_cleanup.sql",
  "supabase/module70_2_smoke_cleanup.sql",
  "supabase/module70_3a_smoke_cleanup.sql",
  "supabase/module70_3e4_smoke_cleanup.sql",
  "supabase/module70_4b2_final_smoke_cleanup.sql",
  "supabase/module70_4b2_smoke_cleanup.sql",
].map(read);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0].toLowerCase() ?? "";
}

function executableSqlWithoutFunctionBodies() {
  return executableSql()
    .replace(
      /create (?:or replace )?function[\s\S]*?\bas \$\$[\s\S]*?^\$\$;/gm,
      "",
    )
    .replace(/do \$\$[\s\S]*?^\$\$;/gm, "");
}

function verifier(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1].toLowerCase() ?? "";
}

function withoutSqlStringLiterals(sql: string) {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

function functionBody(name: string) {
  const match = executableSql().match(
    new RegExp(
      `create function coachfort_internal\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected coachfort_internal.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

function canConsume(usage: number, limit: number, amount: number) {
  return usage < limit && amount <= limit - usage;
}

test.describe("UX-8G4A2B monthly usage meter foundation", () => {
  test("1. contains read-only PRE/POST verification around one APPLY transaction", () => {
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");

    expect(pre).toContain("ready_for_apply");
    expect(pre).toContain("partial_installation");
    expect(pre).toContain("current_limit_violations");
    expect(pre).toContain("active_override_violations");
    expect(pre).toContain("legacy_snapshot_rows");
    expect(pre).toContain("subscription_assignment_rows");
    expect(post).toContain("security_gate");
    expect(post).toContain("monthly_counter_rows = 0");
    expect(post).toContain("monthly_consumption_event_rows = 0");
    const mutatingSql =
      /\b(?:insert\s+into|update\s+(?:public|coachfort_internal)\.|delete\s+from|truncate\s+table|alter\s+table|create\s+table|drop\s+table)\b/;
    expect(withoutSqlStringLiterals(pre)).not.toMatch(mutatingSql);
    expect(withoutSqlStringLiterals(post)).not.toMatch(mutatingSql);
  });

  test("2. preserves old reporting data and reuses canonical limit authorities", () => {
    const sql = executableSql();
    const structuralSql = executableSqlWithoutFunctionBodies();

    expect(sql).toContain("public.subscription_plan_usage_limits");
    expect(sql).toContain("public.tenant_subscription_overrides");
    expect(sql).toContain("public.tenant_subscription_assignments");
    expect(sql).toContain("assert_tenant_operational_access");
    expect(structuralSql).not.toMatch(
      /(?:alter|drop|truncate)\s+table\s+public\.tenant_usage_(?:snapshots|events)/,
    );
    expect(structuralSql).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+public\.tenant_usage_(?:snapshots|events)/,
    );
    expect(structuralSql).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+public\.(?:tenant_subscription_assignments|subscription_plan_usage_limits|tenant_subscription_overrides)/,
    );
  });

  test("3. supports exactly the three approved monthly resources", () => {
    const sql = executableSql();
    const approved = [
      "messages_monthly",
      "automation_runs_monthly",
      "ai_requests_monthly",
    ];

    for (const resource of approved) {
      expect(sql).toContain(`'${resource}'`);
    }
    for (const unsupported of [
      "students_monthly",
      "storage_monthly",
      "document_uploads_monthly",
      "community_posts_monthly",
    ]) {
      expect(sql).not.toContain(unsupported);
    }
    expect(functionBody("resolve_monthly_usage_limit")).toContain(
      "unsupported monthly usage resource",
    );
    expect(functionBody("consume_monthly_usage")).toContain(
      "unsupported monthly usage resource",
    );
  });

  test("4. resolves deterministic exclusive UTC calendar-month boundaries", () => {
    const period = functionBody("utc_calendar_month");
    const post = verifier("POST-APPLY");

    expect(period).toContain("immutable");
    expect(period).toContain("strict");
    expect(period).toContain("at time zone 'utc'");
    expect(period).toContain("interval '1 month'");
    expect(post).toContain("2026-09-01 00:00:00+00");
    expect(post).toContain("2026-09-30 23:59:59.999999+00");
    expect(post).toContain("2026-10-01 00:00:00+00");
    expect(post).toContain("2026-09-30 23:30:00-07");

    const utcPeriod = (value: string) => {
      const date = new Date(value);
      const start = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
      );
      const end = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
      );
      return [start.toISOString(), end.toISOString()];
    };
    expect(utcPeriod("2026-09-01T00:00:00Z")).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
    expect(utcPeriod("2026-09-30T23:59:59.999Z")[0]).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(utcPeriod("2026-10-01T00:00:00Z")[0]).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(utcPeriod("2026-09-30T23:30:00-07:00")[0]).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  test("5. resolves lifecycle then current assignment, hard limit, and override", () => {
    const limit = functionBody("resolve_monthly_usage_limit");
    const lifecycle = limit.indexOf("assert_tenant_operational_access");
    const assignment = limit.indexOf("tenant_subscription_assignments");
    const planLimit = limit.indexOf("subscription_plan_usage_limits");
    const override = limit.indexOf("tenant_subscription_overrides");

    expect(lifecycle).toBeGreaterThanOrEqual(0);
    expect(lifecycle).toBeLessThan(assignment);
    expect(assignment).toBeLessThan(planLimit);
    expect(planLimit).toBeLessThan(override);
    expect(limit).toContain("assignment.is_current");
    expect(limit).toContain("v_limit_type <> 'monthly_count'");
    expect(limit).toContain("v_enforcement_mode <> 'hard'");
    expect(limit).toContain("v_base_limit is null");
    expect(limit).toContain("limit_raise");
    expect(limit).toContain("limit_lower");
    expect(limit).not.toContain("tenants.plan");
    expect(limit).not.toContain("tenant_usage_snapshots");
  });

  test("6. fails closed for missing, malformed, and zero limit authority", () => {
    const limit = functionBody("resolve_monthly_usage_limit");
    const consume = functionBody("consume_monthly_usage");

    expect(limit).toContain("monthly usage limit authority is unavailable");
    expect(limit).toContain("monthly usage override authority is invalid");
    expect(limit).toContain("!~ '^[0-9]{1,10}$'");
    expect(limit).toContain("v_override_value::bigint > 2147483647");
    expect(limit).not.toMatch(/\bunlimited\b/);
    expect(consume).toContain("v_usage_before >= v_limit");
    expect(canConsume(0, 0, 1)).toBe(false);
    expect(canConsume(9, 10, 1)).toBe(true);
    expect(canConsume(10, 10, 1)).toBe(false);
    expect(canConsume(8, 10, 3)).toBe(false);
    expect(consume).toContain("p_amount is null");
    expect(consume).toContain("p_amount < 1");
    expect(consume).toContain("p_amount > 1000000");
  });

  test("7. enforces durable period-scoped idempotency and conflict rejection", () => {
    const sql = executableSql();
    const consume = functionBody("consume_monthly_usage");

    expect(sql).toContain(
      "unique (tenant_id, resource_key, period_start, event_key)",
    );
    expect(consume).toContain("v_existing_amount is distinct from p_amount");
    expect(consume).toContain("'replayed', true");
    expect(consume).toContain("'consumed', 0");
    expect(consume).toContain("'replayed', false");
    expect(consume).toContain("event.tenant_id = p_tenant_id");
    expect(consume).toContain("event.resource_key = v_resource_key");
    expect(consume).toContain("event.period_start = v_period_start");
    expect(consume).toContain("event.event_key = v_event_key");
  });

  test("8. preserves usage while current plan and override headroom changes", () => {
    const consume = functionBody("consume_monthly_usage");

    expect(consume.match(/resolve_monthly_usage_limit/g)).toHaveLength(1);
    expect(consume).toContain(
      "re-resolve after waiting/locking so committed authority changes apply now",
    );
    expect(consume.match(/for share/g)).toHaveLength(2);
    expect(consume).toContain("select assignment.plan_id");
    expect(consume).toContain("public.subscription_plan_usage_limits plan_limit");
    expect(consume).not.toMatch(/\breset\b/);
    expect(canConsume(80, 100, 1)).toBe(true);
    expect(canConsume(80, 200, 1)).toBe(true);
    expect(canConsume(80, 50, 1)).toBe(false);
  });

  test("9. serializes final-unit consumers before replay and quota decisions", () => {
    const consume = functionBody("consume_monthly_usage");
    const authorityLock = consume.indexOf("monthly_usage_authority_lock(");
    const periodLock = consume.indexOf("pg_advisory_xact_lock");
    const lifecycle = consume.indexOf("assert_tenant_operational_access");
    const rowLock = consume.indexOf("for share");
    const limit = consume.indexOf("resolve_monthly_usage_limit");
    const replay = consume.indexOf("select event.amount");
    const current = consume.indexOf("select counter.consumed", replay + 1);
    const update = consume.indexOf("insert into coachfort_internal.monthly_usage_counters");

    expect(authorityLock).toBeGreaterThanOrEqual(0);
    expect(authorityLock).toBeLessThan(periodLock);
    expect(periodLock).toBeLessThan(lifecycle);
    expect(lifecycle).toBeLessThan(rowLock);
    expect(rowLock).toBeLessThan(limit);
    expect(limit).toBeLessThan(replay);
    expect(replay).toBeLessThan(current);
    expect(current).toBeLessThan(update);
    expect(consume).toContain("tenant/resource/utc-month boundary");
    expect(consume).toContain(
      "extract(epoch from v_period_start)::bigint::text",
    );
    expect(consume).not.toContain("v_period_start::text");
    expect(consume).toContain("v_limit - v_usage_before");
  });

  test("10. leaves no partial writes on denied consumption or caller rollback", () => {
    const consume = functionBody("consume_monthly_usage");
    const denial = consume.indexOf("monthly usage limit reached");
    const counterWrite = consume.indexOf(
      "insert into coachfort_internal.monthly_usage_counters",
    );
    const eventWrite = consume.indexOf(
      "insert into coachfort_internal.monthly_usage_consumption_events",
    );

    expect(denial).toBeGreaterThanOrEqual(0);
    expect(denial).toBeLessThan(counterWrite);
    expect(counterWrite).toBeLessThan(eventWrite);
    expect(consume).not.toContain("exception when");
    expect(consume).not.toMatch(/\b(?:commit|rollback|dblink)\b/);
    expect(executableSql().trim()).toMatch(/^begin;/);
    expect(executableSql().trim()).toMatch(/commit;$/);
  });

  test("11. keeps event evidence immutable and counter updates atomic", () => {
    const sql = executableSql();
    const immutable = functionBody(
      "enforce_monthly_usage_event_immutability",
    );
    const consume = functionBody("consume_monthly_usage");

    expect(sql).toContain(
      "before update or delete\non coachfort_internal.monthly_usage_consumption_events",
    );
    expect(immutable).toContain("consumption evidence is immutable");
    expect(immutable).toContain("pg_trigger_depth() > 1");
    expect(immutable).toContain("from public.tenants tenant");
    expect(consume).toContain(
      "on conflict (tenant_id, resource_key, period_start) do update",
    );
    expect(consume).toContain(
      "consumed = counter.consumed + excluded.consumed",
    );
    expect(consume).toContain("returning consumed into v_usage_after");
  });

  test("12. keeps tables and all helpers private from browser and service roles", () => {
    const sql = executableSql();
    const post = verifier("POST-APPLY");

    expect(sql).toContain(
      "alter table coachfort_internal.monthly_usage_counters enable row level security",
    );
    expect(sql).toContain(
      "alter table coachfort_internal.monthly_usage_consumption_events\n  enable row level security",
    );
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).not.toMatch(/grant\s+execute[\s\S]*monthly_usage/);
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|all)[\s\S]*monthly_usage/);
    expect(post).toContain("anon_execute = 0");
    expect(post).toContain("authenticated_execute = 0");
    expect(post).toContain("service_role_execute = 0");
    expect(post).toContain("public_execute = 0");
    expect(post).toContain("direct_grants = 0");
    expect(post).toContain("effective_privileges = 0");
    expect(post).toContain("has_table_privilege(");
    expect(post).toContain("not api_exposed");
  });

  test("13. provides private current-state and full-join reconciliation authority", () => {
    const state = functionBody("monthly_usage_state");
    const reconciliation = functionBody("monthly_usage_reconciliation");

    expect(state).toContain("resolve_monthly_usage_limit");
    expect(state).toContain("coalesce(counter.consumed, 0)");
    expect(state).toContain("greatest(");
    expect(state).toContain("remaining");
    expect(reconciliation).toContain("sum(event.amount)");
    expect(reconciliation).toContain("full join event_totals");
    expect(reconciliation).toContain(
      "coalesce(counter.consumed, 0) = coalesce(event.event_consumed, 0)",
    );
  });

  test("14. does not integrate Chat, Automation, AI, UI, or scheduling yet", () => {
    const structuralSql = executableSqlWithoutFunctionBodies();

    for (const forbidden of [
      "create_student_direct_chat",
      "create_student_support_thread",
      "send_team_chat_message",
      "send_student_chat_message",
      "run_automation_trigger",
      "automation_rules",
      "ai_conversations",
      "vercel",
      "cron",
    ]) {
      expect(structuralSql).not.toContain(forbidden);
    }
    expect(ux8g1b.toLowerCase()).toContain(
      "coachfort_internal.assert_tenant_operational_access",
    );
    expect(ux8g4a2a.toLowerCase()).toContain(
      "assert_effective_operational_feature",
    );
    expect(migration).not.toContain("src/components");
  });

  test("15. serializes every monthly override write with the same authority lock", () => {
    const sql = executableSql();
    const authorityLock = functionBody("monthly_usage_authority_lock");
    const overrideTrigger = functionBody(
      "enforce_monthly_usage_override_authority_lock",
    );
    const consume = functionBody("consume_monthly_usage");

    expect(authorityLock).toContain("monthly_usage_authority:");
    expect(authorityLock).toContain("pg_advisory_xact_lock");
    expect(overrideTrigger).toContain("limit_raise");
    expect(overrideTrigger).toContain("limit_lower");
    expect(overrideTrigger).toContain("messages_monthly");
    expect(overrideTrigger).toContain("automation_runs_monthly");
    expect(overrideTrigger).toContain("ai_requests_monthly");
    expect(overrideTrigger).toContain("v_old_lock_key < v_new_lock_key");
    expect(overrideTrigger).toContain("monthly_usage_authority_lock(");
    expect(consume).toContain("monthly_usage_authority_lock(");
    expect(sql).toContain(
      "create trigger monthly_usage_override_authority_lock\nbefore insert or update or delete\non public.tenant_subscription_overrides",
    );
  });

  test("16. inventories the canonical writer and commercial mutation ACLs", () => {
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    const writerMatches = subscriptionEntitlementsMigration.match(
      /insert into public\.tenant_subscription_overrides/g,
    );

    expect(writerMatches).toHaveLength(1);
    expect(subscriptionEntitlementsMigration).toContain(
      "create or replace function public.approve_tenant_feature_override(",
    );
    expect(subscriptionEntitlementsMigration).toContain(
      "perform public.subscription_entitlements_assert_platform_owner_admin()",
    );
    expect(subscriptionEntitlementsMigration).toContain(
      "grant execute on function public.approve_tenant_feature_override",
    );
    for (const verifierSql of [pre, post]) {
      expect(verifierSql).toContain("anon_mutation_table_count");
      expect(verifierSql).toContain("authenticated_mutation_table_count");
      expect(verifierSql).toContain("public_direct_mutation_grant_count");
      expect(verifierSql).toContain("browser_mutation_authority_count");
      expect(verifierSql).toContain("service_role_mutation_table_count");
      expect(verifierSql).toContain("service_role_mutation_tables");
      expect(verifierSql).toContain("tenant_subscription_assignments");
      expect(verifierSql).toContain("subscription_plan_usage_limits");
      expect(verifierSql).toContain("tenant_subscription_overrides");
      expect(verifierSql).toContain("'insert', 'update', 'delete'");
    }
    expect(pre).toContain("anon_mutation_table_count = 0");
    expect(pre).toContain("authenticated_mutation_table_count = 0");
    expect(pre).toContain("public_direct_mutation_grant_count = 0");
    expect(pre).toContain("browser_mutation_authority_count = 0");
    expect(post).toContain("anon_mutation_table_count = 0");
    expect(post).toContain("authenticated_mutation_table_count = 0");
    expect(post).toContain("public_direct_mutation_grant_count = 0");
    expect(post).toContain("browser_mutation_authority_count = 0");
  });

  test("17. preserves intentional tenant cascade cleanup without mutable evidence", () => {
    const sql = executableSql();
    const immutable = functionBody(
      "enforce_monthly_usage_event_immutability",
    );

    expect(sql.match(/references public\.tenants\(id\) on delete cascade/g))
      .toHaveLength(2);
    expect(immutable).toContain("tg_op = 'delete'");
    expect(immutable).toContain("pg_trigger_depth() > 1");
    expect(immutable).toContain("not exists (");
    expect(immutable).toContain("tenant.id = old.tenant_id");
    expect(immutable).toContain("return old");
    for (const cleanup of module70Cleanup) {
      expect(cleanup.toLowerCase()).toContain("delete from public.tenants");
    }
  });
});
