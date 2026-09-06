import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g4a2d1_automation_monthly_meter_integration.sql",
);
const sql = migration.toLowerCase();
const triggers = read("src/lib/automationTriggers.ts");
const browserRunner = read("src/lib/automationRunner.ts");
const a2a = read(
  "supabase/bundle_ux8g4a2a_server_feature_entitlement_closure.sql",
).toLowerCase();
const automationSchema = read(
  "supabase/module41_automation_workflow_engine.sql",
).toLowerCase();

function section(name: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${name}[\\s\\S]*?\\n([\\s\\S]*?)\\n\\*/`, "i"),
  );
  expect(match, `${name} section`).not.toBeNull();
  return match![1].toLowerCase();
}

function functionBody(identityStart: string, endMarker: string) {
  const start = sql.indexOf(identityStart.toLowerCase());
  expect(start, identityStart).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(endMarker.toLowerCase(), start);
  expect(end, endMarker).toBeGreaterThan(start);
  return sql.slice(start, end);
}

test.describe("UX-8G4A2D1 Automation monthly meter integration", () => {
  test("1. wraps one schema-only APPLY transaction in read-only verification", () => {
    expect(section("PRE-APPLY")).toContain("ready_for_apply");
    expect(section("POST-APPLY")).toContain("security_gate");
    expect(sql).not.toMatch(/information_schema\.columns\s+column\b/);
    expect(sql).not.toMatch(/\bcolumn\.(?:table_schema|table_name|column_name|is_nullable)\b/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(
      /^\s*(?:insert into|update|delete from)\s+public\.subscription_/gm,
    );
    expect(sql).not.toMatch(
      /^\s*(?:insert into|update|delete from)\s+public\.automation_rules/gm,
    );
  });

  test("2. requires A2A feature authority and the private A2B meter", () => {
    const pre = section("PRE-APPLY");
    expect(pre).toContain("assert_tenant_operational_access(uuid)");
    expect(pre).toContain("assert_effective_operational_feature(uuid,text)");
    expect(pre).toContain("consume_monthly_usage(uuid,text,text,integer)");
    expect(pre).toContain("extensions.digest(bytea,text)");
    expect(pre).toContain("browser_write_grants");
    expect(pre).toContain("service_role_write_inventory");
  });

  test("3. adds durable nullable history-compatible execution authority", () => {
    expect(sql).toContain("add column execution_id uuid");
    expect(sql).toContain("add column execution_fingerprint text");
    expect(sql).toContain("add column rule_id_snapshot uuid");
    expect(sql).toContain("automation_runs_execution_identity_pair_check");
    expect(sql).toContain(
      "execution_id is null\n      and execution_fingerprint is null\n      and rule_id_snapshot is null",
    );
    expect(sql).toContain(
      "execution_id is not null\n      and execution_fingerprint is not null\n      and rule_id_snapshot is not null\n      and execution_fingerprint ~ '^[0-9a-f]{64}$'",
    );
    expect(sql).toContain("automation_runs_tenant_rule_execution_unique_idx");
    expect(sql).toContain("where execution_id is not null");
    expect(sql).toContain("automation_runs_execution_identity_immutable");
    expect(sql).toContain(
      "(new.execution_id is null) is distinct from\n       (new.execution_fingerprint is null)",
    );
    expect(sql).toContain(
      "(new.execution_id is null) is distinct from\n          (new.rule_id_snapshot is null)",
    );
    expect(sql).toContain("new.rule_id is distinct from new.rule_id_snapshot");
    expect(sql).toContain(
      "new.rule_id_snapshot is distinct from old.rule_id_snapshot",
    );
    expect(sql).not.toContain("automation execution identity is required");
    expect(sql).not.toMatch(/update public\.automation_runs[\s\S]*set execution_id/);
  });

  test("4. makes one accepted rule execution exactly one monthly unit", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(body.match(/consume_monthly_usage\(/g)).toHaveLength(1);
    expect(body).toContain("'automation_runs_monthly'");
    expect(body).toContain("'automation:' || p_execution_id::text || ':' || v_rule.id::text");
    expect(body).toContain(",\n        1\n      )");
    expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
      body.indexOf("'queued', v_actor"),
    );
  });

  test("5. checks exact business replay and conflict before metering", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(body).toContain("run.execution_id = p_execution_id");
    expect(body).toContain("run.rule_id_snapshot = v_rule.id");
    expect(body).toContain("execution_fingerprint is distinct from v_fingerprint");
    expect(body).toContain("automation execution id conflicts with prior execution");
    expect(body.indexOf("run.execution_id = p_execution_id")).toBeLessThan(
      body.indexOf("consume_monthly_usage"),
    );
    expect(body.indexOf("execution_fingerprint is distinct")).toBeLessThan(
      body.indexOf("consume_monthly_usage"),
    );
  });

  test("6. keeps replay identity independent of UTC meter periods", () => {
    expect(sql).toContain(
      "on public.automation_runs (tenant_id, rule_id_snapshot, execution_id)",
    );
    expect(sql).not.toContain(
      "on public.automation_runs (tenant_id, rule_id, execution_id)",
    );
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("automation_execution:");
  });

  test("7. evaluates conditions before meter and meters no skipped rule", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(body.indexOf("for v_condition in")).toBeLessThan(
      body.indexOf("consume_monthly_usage"),
    );
    expect(body.indexOf("if not v_conditions_passed")).toBeLessThan(
      body.indexOf("consume_monthly_usage"),
    );
  });

  test("8. counts one run regardless of configured action count", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
      body.indexOf("for v_action in"),
    );
    expect(body.match(/consume_monthly_usage\(/g)).toHaveLength(1);
  });

  test("9. charges accepted downstream failures but leaves quota denial clean", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(body.indexOf("consume_monthly_usage")).toBeLessThan(
      body.indexOf("insert into public.automation_runs (", body.indexOf("consume_monthly_usage")),
    );
    expect(body).toContain("if sqlerrm = 'monthly usage limit reached.'");
    expect(body).toContain("quota_denied_count := quota_denied_count + 1");
    expect(body).toContain("status = 'failed'");
    expect(body).toContain("failed_count := failed_count + 1");
  });

  test("10. preserves deterministic partial fan-out", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(body).toContain("order by rule.created_at asc, rule.id asc");
    expect(body).toContain("quota_denied_count := quota_denied_count + 1");
    expect(body).toContain("continue;");
    expect(body).not.toContain("p_amount");
  });

  test("11. preserves lifecycle then feature then meter ordering", () => {
    const request = functionBody(
      "create function public.run_automation_trigger(\n  tenant_id uuid,\n  trigger_type text,\n  entity_type text,\n  entity_id uuid,",
      "alter function coachfort_internal.enforce_automation_run_execution_identity",
    );
    expect(request.indexOf("assert_tenant_operational_access")).toBeLessThan(
      request.indexOf("assert_effective_operational_feature"),
    );
    expect(request.indexOf("assert_effective_operational_feature")).toBeLessThan(
      request.indexOf("run_automation_trigger_metered"),
    );
    expect(request).not.toContain("automation_runs_monthly");
  });

  test("12. keeps the five-argument deployment bridge metered", () => {
    const bridge = functionBody(
      "create or replace function public.run_automation_trigger_unvalidated(",
      "create or replace function public.run_automation_trigger(\n  tenant_id uuid,",
    );
    expect(bridge).toContain("run_automation_trigger_metered");
    expect(bridge).toContain("gen_random_uuid()");
    expect(section("POST-APPLY")).toContain("rollout_bridge_pending");
    expect(section("POST-APPLY")).toContain("total_overloads = 2");
  });

  test("13. keeps meter and runner internals private", () => {
    expect(sql).toContain(
      "revoke all on function\n  coachfort_internal.run_automation_trigger_metered",
    );
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("grant execute on function public.run_automation_trigger(");
    expect(section("POST-APPLY")).toContain("metered_runner_private");
    expect(section("POST-APPLY")).toContain("legacy_bridge_private");
    expect(section("POST-APPLY")).toContain("monthly_consumer_private");
    expect(section("POST-APPLY")).toContain("exact_identity_pair_constraint");
    expect(section("POST-APPLY")).toContain("snapshot_nullable");
    expect(section("POST-APPLY")).toContain("snapshot_not_foreign_key");
    expect(section("POST-APPLY")).toContain("identity_trigger_private");
    expect(section("POST-APPLY")).toContain("delete_contract");
    expect(section("POST-APPLY")).toContain("browser_write_grants");
  });

  test("14. sends a request-aware execution id and maps quota safely", () => {
    expect(triggers).toContain("export function createAutomationExecutionId()");
    expect(triggers).toContain("const executionId =");
    expect(triggers).toContain("context.executionId ?? createAutomationExecutionId()");
    expect(triggers).toContain("p_execution_id: executionId");
    expect(triggers).toContain("quota_denied_count");
    expect(triggers).toContain(
      "You've reached your monthly automation run limit.",
    );
    expect(triggers).not.toMatch(/automation_runs_monthly|sqlstate|\bcounter\b|\bmeter\b/i);
  });

  test("15. keeps manual browser execution retired", () => {
    expect(browserRunner).toContain("Manual browser automation execution is retired");
    expect(browserRunner).toContain("run: null");
    expect(browserRunner).toContain('status: "skipped"');
  });

  test("16. preserves A2A enable and cleanup exceptions", () => {
    expect(a2a).toContain("if coalesce(p_enabled, false) then");
    expect(a2a).toContain("delete from public.automation_rules");
    expect(sql).not.toContain("create_automation_rule_secure(");
    expect(sql).not.toContain("set_automation_rule_enabled_secure(");
    expect(sql).not.toContain(
      "create or replace function public.delete_automation_rule_secure(",
    );
  });

  test("17. does not touch Chat, AI, plans, scheduling, or usage UI", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(sql).not.toMatch(/create (?:or replace )?function public\.(?:create_student|send_student|send_team)_chat/);
    expect(sql).not.toMatch(/\b(?:insert into|update|delete from)\s+public\.subscription_plans/);
    expect(body).not.toContain("ai_requests_monthly");
    expect(body).not.toContain("messages_monthly");
    expect(sql).not.toContain("vercel.json");
    expect(triggers).not.toContain("getWorkspaceUsage");
  });

  test("18. installation preserves all protected row counts", () => {
    for (const key of [
      "automation_rules",
      "automation_conditions",
      "automation_actions",
      "automation_runs",
      "automation_run_logs",
      "monthly_usage_counters",
      "monthly_usage_events",
      "subscription_assignments",
      "plan_usage_limits",
    ]) {
      expect(sql).toContain(`baseline.${key}`);
      expect(section("POST-APPLY")).toContain(`'${key}'`);
    }
  });

  test("19. preserves rule cleanup and durable run history authority", () => {
    const identity = functionBody(
      "create function coachfort_internal.enforce_automation_run_execution_identity()",
      "create trigger automation_runs_execution_identity_immutable",
    );
    const deleteStart = a2a.indexOf(
      "create or replace function public.delete_automation_rule_secure(",
    );
    const deleteEnd = a2a.indexOf("create or replace function", deleteStart + 1);
    expect(deleteStart).toBeGreaterThanOrEqual(0);
    expect(deleteEnd).toBeGreaterThan(deleteStart);
    const remove = a2a.slice(deleteStart, deleteEnd);

    expect(automationSchema).toContain(
      "rule_id uuid references public.automation_rules(id) on delete set null",
    );
    expect(automationSchema).toContain(
      "run_id uuid not null references public.automation_runs(id) on delete cascade",
    );
    expect(automationSchema.match(
      /rule_id uuid not null references public\.automation_rules\(id\) on delete cascade/g,
    )).toHaveLength(2);
    expect(remove).toContain("delete from public.automation_rule_conditions");
    expect(remove).toContain("delete from public.automation_rule_actions");
    expect(remove).toContain("delete from public.automation_rules ar");
    expect(remove).not.toContain("delete from public.automation_runs");
    expect(remove).not.toContain("delete from public.automation_run_logs");
    expect(remove).not.toContain("monthly_usage_consumption_events");

    expect(identity).toContain("new.rule_id is distinct from old.rule_id");
    expect(identity).toContain("old.rule_id is null");
    expect(identity).toContain("new.rule_id is not null");
    expect(identity).toContain("from public.automation_rules rule");
    expect(identity).toContain("where rule.id = old.rule_id");
    expect(identity).toContain(
      "new.rule_id_snapshot is distinct from old.rule_id_snapshot",
    );
    expect(identity).toContain("new.execution_id is distinct from old.execution_id");
    expect(identity).toContain(
      "new.execution_fingerprint is distinct from old.execution_fingerprint",
    );
  });

  test("20. records the snapshot on every request-aware run and verifies exact delete FKs", () => {
    const body = functionBody(
      "create function coachfort_internal.run_automation_trigger_metered(",
      "-- metered compatibility bridge",
    );
    expect(body.match(/insert into public\.automation_runs \(/g)).toHaveLength(3);
    expect(body.match(/execution_fingerprint,\s*rule_id_snapshot/g)).toHaveLength(3);

    const pre = section("PRE-APPLY");
    const post = section("POST-APPLY");
    for (const contract of [
      "automation_rule_conditions_rule_id_fkey",
      "automation_rule_actions_rule_id_fkey",
      "automation_runs_rule_id_fkey",
      "automation_run_logs_run_id_fkey",
    ]) {
      expect(pre).toContain(contract);
      expect(post).toContain(contract);
    }
    expect(post).toContain("fk_detach_after_parent_delete");
    expect(post).toContain("ri_fkey_setnull_del");
    expect(post).toContain("detach_guarded_by_parent_absence");
  });
});
