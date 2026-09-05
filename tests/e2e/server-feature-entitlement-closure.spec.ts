import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g4a2a_server_feature_entitlement_closure.sql",
);
const automations = read("src/lib/automations.ts");
const assistantRoute = read("app/api/assistant/message/route.ts");
const assistantService = read("src/lib/ai/assistantService.ts");
const assistantProvider = read("src/lib/ai/assistantProvider.ts");
const featureAccess = read("src/lib/featureAccess.ts");
const plans = read("src/lib/plans.ts");
const ux8g1b = read(
  "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
);

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

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create (?:or replace )?function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8G4A2A server feature entitlement closure", () => {
  test("1. reuses lifecycle-aware canonical effective feature authority", () => {
    const helper = functionBody(
      "coachfort_internal",
      "assert_effective_operational_feature",
    );

    expect(helper).toContain("stable");
    expect(helper).toContain("security definer");
    expect(helper).toContain("set search_path = public, pg_temp");
    expect(helper).toContain("assert_tenant_operational_access(p_tenant_id)");
    expect(helper).toContain("resolve_effective_feature_access_authority");
    expect(helper).toContain("effective_status");
    expect(helper).toContain("<> 'included'");
    expect(helper.indexOf("assert_tenant_operational_access")).toBeLessThan(
      helper.indexOf("resolve_effective_feature_access_authority"),
    );
    expect(ux8g1b.toLowerCase()).toContain(
      "when not v_operational_allowed then 'locked'",
    );
    expect(executableSql()).toContain(
      "revoke all on function\n  coachfort_internal.assert_effective_operational_feature",
    );
  });

  test("2. gates every positive Automation configuration path", () => {
    for (const name of [
      "create_automation_rule_secure",
      "update_automation_rule_secure",
      "create_automation_condition_secure",
      "update_automation_condition_secure",
      "delete_automation_condition_secure",
      "create_automation_action_secure",
      "update_automation_action_secure",
      "delete_automation_action_secure",
    ]) {
      const source = functionBody("public", name);
      expect(source, name).toContain("m69_9_assert_automation_manager");
      expect(source, name).toContain(
        "assert_effective_operational_feature",
      );
      expect(source, name).toContain("'automations'");
      expect(source, name).not.toContain("automation_runs_monthly");
    }
  });

  test("3. requires entitlement only when enabling and preserves cleanup", () => {
    const toggle = functionBody(
      "public",
      "set_automation_rule_enabled_secure",
    );
    const remove = functionBody("public", "delete_automation_rule_secure");

    expect(toggle).toContain("if coalesce(p_enabled, false) then");
    expect(toggle).toContain("assert_effective_operational_feature");
    expect(toggle.indexOf("if coalesce(p_enabled, false) then")).toBeLessThan(
      toggle.indexOf("assert_effective_operational_feature"),
    );
    expect(toggle.indexOf("assert_effective_operational_feature")).toBeLessThan(
      toggle.indexOf("update public.automation_rules"),
    );
    expect(remove).toContain("m69_9_assert_automation_manager");
    expect(remove).not.toContain("assert_effective_operational_feature");
    expect(remove).toContain("delete from public.automation_rules");
  });

  test("4. blocks trigger execution before the unvalidated runner", () => {
    const source = functionBody("public", "run_automation_trigger");

    expect(source).toContain("assert_tenant_operational_access");
    expect(source).toContain("is_valid_automation_trigger");
    expect(source).toContain("assert_effective_operational_feature");
    expect(source).toContain("run_automation_trigger_unvalidated");
    expect(source.indexOf("assert_tenant_operational_access")).toBeLessThan(
      source.indexOf("assert_effective_operational_feature"),
    );
    expect(source.indexOf("assert_effective_operational_feature")).toBeLessThan(
      source.indexOf("run_automation_trigger_unvalidated"),
    );
    expect(source).not.toContain("automation_runs_monthly");
  });

  test("5. removes the browser rule-count and monthly-run conflation", () => {
    expect(automations).not.toContain("enforceWorkspaceLimit");
    expect(automations).not.toContain("refreshWorkspaceUsageSnapshot");
    expect(automations).not.toContain(
      'enforceWorkspaceLimit(payload.tenant_id, "automations")',
    );
    expect(functionBody("public", "run_automation_trigger")).not.toContain(
      "automation_runs_monthly",
    );
    expect(executableSql()).not.toContain("assert_tenant_usage_limit");
  });

  test("6. gates all four Chat writes without changing Community", () => {
    const expectedAuthorities: Record<string, string> = {
      create_student_direct_chat: "chat_team_can_start_student_thread",
      create_student_support_thread: "chat_student_context",
      send_student_chat_message: "chat_student_can_access_thread",
      send_team_chat_message: "chat_team_can_access_thread",
    };

    for (const [name, authority] of Object.entries(expectedAuthorities)) {
      const source = functionBody("public", name);
      expect(source, name).toContain(authority);
      expect(source, name).toContain("assert_effective_operational_feature");
      expect(source, name).toContain("'messages'");
      expect(source.indexOf(authority), name).toBeLessThan(
        source.indexOf("assert_effective_operational_feature"),
      );
      expect(source.indexOf("assert_effective_operational_feature"), name)
        .toBeLessThan(source.indexOf("insert into public.conversation_"));
    }

    const sql = executableSql();
    expect(sql).not.toContain("community_posts");
    expect(sql).not.toContain("community_comments");
    expect(sql).not.toContain("community_hub");
  });

  test("7. enforces AI access before local generation or persistence", () => {
    expect(assistantService).toContain('"get_portal_feature_access"');
    expect(assistantService).toContain('"get_tenant_feature_access"');
    expect(assistantService).toContain(
      'feature.feature_key === "ai_assistant"',
    );
    expect(assistantService).toContain('assistantFeature?.status !== "enabled"');
    expect(assistantService).toContain(
      "AI Assistant is not available for this workspace.",
    );
    expect(assistantService).toContain("context.tenantId, context.mode");
    expect(assistantRoute).toContain("handleAssistantMessage");
    expect(assistantRoute).not.toContain("tenantId");
    expect(ux8g1b).toContain(
      "coachfort_internal.resolve_effective_feature_access_authority(\n      p_tenant_id,\n      null",
    );

    const context = assistantService.indexOf("await buildAssistantContext");
    const entitlement = assistantService.indexOf(
      "await assertAssistantFeatureAccess",
    );
    const generation = assistantService.indexOf(
      "await generateAssistantResponse",
    );
    const persistence = assistantService.indexOf(
      "await recordAssistantExchange",
    );
    expect(context).toBeGreaterThanOrEqual(0);
    expect(context).toBeLessThan(entitlement);
    expect(entitlement).toBeLessThan(generation);
    expect(entitlement).toBeLessThan(persistence);
    expect(assistantService).not.toContain("ai_requests_monthly");
    expect(assistantProvider).toContain('const provider = "mock"');
    expect(assistantProvider).not.toMatch(/openai|anthropic|gemini/i);
  });

  test("8. maps Assistant navigation to canonical AI entitlement", () => {
    expect(featureAccess).toContain('Assistant: "ai_assistant"');
    expect(featureAccess).not.toContain('Assistant: "dashboard"');
    expect(plans).toContain('ai_assistant: "locked"');
    expect(plans).toContain('ai_assistant: "platform_approval_required"');
    expect(plans).toContain('automations: "locked"');
    expect(plans).toContain('automations: "included"');
  });

  test("9. preserves RPC identities and browser table-write denial", () => {
    const sql = executableSql();
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");

    expect(pre).toContain("installed_count = 15");
    expect(pre).toContain("service_role_execute_count = 0");
    expect(pre).toContain("browser_write_grants");
    expect(post).toContain("expected_count");
    expect(post).toContain("service_role_execute_denied");
    expect(post).toContain("no_browser_writes");
    expect(post).toContain("security_gate");
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]*?on\s+(?:table\s+)?public\.(?:automation_|conversation_)/,
    );
  });

  test("10. contains no business DML, catalog changes, meters, or scheduling", () => {
    const structuralSql = executableSqlWithoutFunctionBodies();

    expect(structuralSql).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+public\./,
    );
    expect(structuralSql).not.toContain("subscription_plan_usage_limits");
    expect(structuralSql).not.toContain("subscription_plan_feature_entitlements");
    expect(structuralSql).not.toContain("tenant_usage_events");
    expect(structuralSql).not.toContain("tenant_usage_snapshots");
    expect(structuralSql).not.toContain("create table");
    expect(structuralSql).not.toContain("vercel");
    expect(structuralSql).not.toContain("cron");
  });
});
