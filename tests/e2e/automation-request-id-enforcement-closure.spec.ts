import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, test } from "@playwright/test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const closure = read(
  "supabase/bundle_ux8g4a2d2_automation_request_id_enforcement_closure.sql",
);
const bridge = read(
  "supabase/bundle_ux8g4a2d1_automation_monthly_meter_integration.sql",
);
const triggers = read("src/lib/automationTriggers.ts");
const students = read("src/lib/students.ts");
const sessions = read("src/lib/sessions.ts");

const legacyIdentity =
  "public.run_automation_trigger(uuid,text,text,uuid,jsonb)";
const requestIdentity =
  "public.run_automation_trigger(uuid,text,text,uuid,jsonb,uuid)";

function a2d1ExecutableSql() {
  const match = bridge.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);
  expect(match, "Expected the historical A2D1 transaction").not.toBeNull();
  return match?.[0].toLowerCase() ?? "";
}

function executableSql() {
  const matches = closure.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0].toLowerCase() ?? "";
}

function structuralSql() {
  return executableSql().replace(/do \$\$[\s\S]*?^\$\$;/gm, "");
}

function verifier(label: "PRE-APPLY" | "POST-APPLY") {
  const match = closure.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1].toLowerCase() ?? "";
}

function automationCallBodies(source: string, triggerType: string) {
  return [
    ...source.matchAll(
      new RegExp(
        `runAutomationTrigger\\("${triggerType}",\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\);`,
        "g",
      ),
    ),
  ].map((match) => match[1]);
}

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const absolutePath = join(path, name);
    if (statSync(absolutePath).isDirectory()) {
      return sourceFiles(absolutePath);
    }
    return /\.(?:ts|tsx)$/.test(name) ? [absolutePath] : [];
  });
}

test.describe("UX-8G4A2D2 Automation request-ID enforcement closure", () => {
  test("1. requires the exact installed A2D1 bridge before APPLY", () => {
    const pre = verifier("PRE-APPLY");

    expect(pre).toContain("ready_for_apply");
    expect(pre).toContain("exact_bridge_inventory");
    expect(pre).toContain("legacy_metered_bridge_contract");
    expect(pre).toContain("request_aware_runner_contract");
    expect(pre).toContain("partial_a2d2_installation");
    expect(pre).toContain(legacyIdentity);
    expect(pre).toContain(requestIdentity);
    expect(pre).toContain("total_overloads = 2");
    expect(pre).toContain("legacy_overloads = 1");
    expect(pre).toContain("request_overloads = 1");
    expect(pre).toContain("exact_bridge_acl");
    expect(pre).toContain("authenticated_execute");
    expect(pre).toContain("not anon_execute");
    expect(pre).toContain("not service_execute");
    expect(pre).toContain("not public_execute");
  });

  test("2. drops only the five-argument public bridge without CASCADE", () => {
    const sql = structuralSql();
    const drops = [...sql.matchAll(/drop function ([^;]+);/g)].map(
      (match) => match[1].trim(),
    );

    expect(drops).toEqual([legacyIdentity]);
    expect(sql).not.toContain("cascade");
    expect(sql).not.toContain(`drop function ${requestIdentity}`);
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  test("3. performs no business DML or runtime-authority rewrite", () => {
    const sql = structuralSql();

    expect(sql).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:public|coachfort_internal)\./,
    );
    expect(sql).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/);
    expect(sql).not.toMatch(/\balter\s+function\b/);
    expect(sql).not.toMatch(/\bgrant\b|\brevoke\b/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
  });

  test("4. fingerprints every protected row and adjacent authority", () => {
    const sql = executableSql();

    for (const relation of [
      "automation_rules",
      "automation_conditions",
      "automation_actions",
      "automation_runs",
      "automation_run_logs",
      "monthly_usage_counters",
      "monthly_usage_consumption_events",
      "subscription_assignments",
      "plan_usage_limits",
    ]) {
      expect(sql).toContain(`'${relation}'`);
    }

    expect(sql).toContain("function_contract");
    expect(sql).toContain("schema_contract");
    expect(sql).toContain("protected_rows");
    expect(sql).toContain("is distinct from v_function_contract");
    expect(sql).toContain("is distinct from v_schema_contract");
    expect(sql).toContain("is distinct from v_protected_rows");
    expect(sql).toContain("a2d2 changed protected data or adjacent authorities");
    expect(sql).toContain("a2d1 metering or delete-history authority drifted");
    expect(sql).toContain("automation rule-delete/history fk authority drifted");
    expect(sql).toContain("automation_runs_execution_identity_pair_check");
    expect(sql).toContain("automation_runs_tenant_rule_execution_unique_idx");
  });

  test("5. leaves one request-aware public RPC with an exact ACL", () => {
    const post = verifier("POST-APPLY");

    expect(post).toContain("exact_final_rpc_inventory");
    expect(post).toContain("final_rpc_inventory");
    expect(post).toContain("security_gate");
    expect(post).toContain("total_overloads = 1");
    expect(post).toContain("request_overloads = 1");
    expect(post).toContain("identities.legacy_runner is null");
    expect(post).toContain("pronargdefaults = 0");
    expect(post).toContain("'p_execution_id' = any(procedure.proargnames)");
    expect(post).toContain("exact_rpc_acl");
    expect(post).toContain("no_alternate_public_wrapper");
  });

  test("6. preserves lifecycle, validation, feature, and meter ordering", () => {
    const post = verifier("POST-APPLY");
    const correctedFeaturePositions = closure.match(
      /position\s*\(\s*'assert_effective_operational_feature'\s+in\s+sources\.request_source\s*\)/gi,
    );

    expect(post).toContain("request_aware_runner_contract");
    expect(post).toContain("p_execution_id is null");
    expect(post).toContain("assert_tenant_operational_access");
    expect(post).toContain("is_valid_automation_trigger");
    expect(post).toContain("assert_effective_operational_feature");
    expect(post).toContain("run_automation_trigger_metered");
    expect(post).toContain("sources.request_source not like '%gen_random_uuid()%'");
    expect(post).toContain("metered_runner_contract");
    expect(post).toContain("monthly_meter_contract");
    expect(correctedFeaturePositions).toHaveLength(4);
    expect(closure).not.toMatch(
      /position\s*\(\s*'(?:''|[^'])*'\s*,/i,
    );
  });

  test("7. preserves private helpers, durable schema, and delete history", () => {
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");

    for (const identity of [
      "public.run_automation_trigger_unvalidated(uuid,text,text,uuid,jsonb)",
      "coachfort_internal.run_automation_trigger_metered(uuid,text,text,uuid,jsonb,uuid)",
      "coachfort_internal.enforce_automation_run_execution_identity()",
      "coachfort_internal.consume_monthly_usage(uuid,text,text,integer)",
    ]) {
      expect(pre).toContain(identity);
      expect(post).toContain(identity);
    }

    expect(post).toContain("private_authority_contract");
    expect(post).toContain("execution_identity_contract");
    expect(post).toContain("exact_identity_constraint");
    expect(post).toContain("exact_execution_index");
    expect(post).toContain("identity_trigger_bound");
    expect(post).toContain("delete_history_contract");
    expect(post).toContain("fk_detach_after_parent_delete");
    expect(post).toContain("browser_write_contract");
    expect(post).toContain("rule_id_snapshot");
  });

  test("8. keeps all active creation callers on canonical entity IDs", () => {
    const studentCalls = automationCallBodies(students, "student_created");
    const sessionCalls = automationCallBodies(sessions, "session_scheduled");
    const allApplicationSources = sourceFiles(join(root, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(studentCalls).toHaveLength(1);
    expect(studentCalls[0]).toContain("executionId: student.id");
    expect(sessionCalls).toHaveLength(2);
    for (const call of sessionCalls) {
      expect(call).toContain("executionId: session.id");
    }

    expect(students).not.toContain('.rpc("run_automation_trigger"');
    expect(sessions).not.toContain('.rpc("run_automation_trigger"');
    expect(triggers.match(/\.rpc\("run_automation_trigger"/g)).toHaveLength(1);
    expect(
      allApplicationSources.match(/\.rpc\("run_automation_trigger"/g),
    ).toHaveLength(1);
    expect(triggers).toContain("p_execution_id: executionId");
    expect(triggers).toContain(
      "context.executionId ?? createAutomationExecutionId()",
    );
  });

  test("9. keeps dormant helpers on the six-argument wrapper only", () => {
    const dormantHelpers = [
      "runAssignmentOverdueAutomationForTenant",
      "runLowAttendanceAutomationForTenant",
      "runTrialExpiringAutomationForTenant",
    ];
    const otherSources = sourceFiles(join(root, "src"))
      .filter(
        (path) => relative(root, path).replaceAll("\\", "/") !==
          "src/lib/automationTriggers.ts",
      )
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const helper of dormantHelpers) {
      expect(triggers).toContain(`export async function ${helper}`);
      expect(otherSources).not.toContain(helper);
    }
    expect(triggers.match(/runAutomationTrigger\(/g)).toHaveLength(4);
    expect(triggers.match(/runAutomationTrigger\("assignment_overdue"/g)).toHaveLength(1);
    expect(triggers.match(/runAutomationTrigger\("attendance_low"/g)).toHaveLength(1);
    expect(triggers.match(/runAutomationTrigger\("trial_expiring"/g)).toHaveLength(1);
  });

  test("10. retains A2D1 as immutable bridge history", () => {
    const a2d1Sql = a2d1ExecutableSql();

    expect(
      a2d1Sql.match(
        /create (?:or replace )?function public\.run_automation_trigger\(/g,
      ),
    ).toHaveLength(2);
    expect(bridge).toContain(`'${legacyIdentity}'`);
    expect(bridge).toContain(`'${requestIdentity}'`);
    expect(closure).not.toContain(`create function ${requestIdentity}`);
    expect(closure).not.toContain(`create or replace function ${requestIdentity}`);
  });
});
