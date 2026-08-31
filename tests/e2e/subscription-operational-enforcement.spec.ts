import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
);
const ux8g1a = read(
  "supabase/bundle_ux8g1a_renewal_lifecycle_authority.sql",
);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0].toLowerCase() ?? "";
}

function executableSqlWithoutFunctionBodies() {
  return executableSql().replace(
    /create (?:or replace )?function[\s\S]*?\bas \$\$[\s\S]*?^\$\$;/gm,
    "",
  );
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

test.describe("UX-8G1B operational subscription enforcement", () => {
  test("1. derives operational access only from UX-8G1A effective lifecycle", () => {
    const source = functionBody(
      "coachfort_internal",
      "tenant_operational_access_allowed",
    );
    expect(source).toContain("tenant_subscription_effective_lifecycle");
    expect(source).toContain("operational_allowed");
    expect(source).toContain("in ('active', 'grace')");
    expect(source).not.toContain("tenant_subscription_assignments");
    expect(source).not.toContain("subscription_plans");
  });

  test("2. preserves trial authority and fails expired or malformed state closed", () => {
    const predicate = functionBody(
      "coachfort_internal",
      "tenant_operational_access_allowed",
    );
    const lifecycle = ux8g1a.toLowerCase();
    expect(predicate).toContain("operational_allowed");
    expect(lifecycle).toContain("if v_assignment.status = 'trial' then");
    expect(lifecycle).toContain("trial_period_elapsed");
    expect(lifecycle).toContain("'operational_allowed', false");
    expect(lifecycle).toContain("v_effective_state := 'expired'");
    const pre = verifier("PRE-APPLY");
    expect(pre).toContain("'missing_trial_authority'");
    expect(pre).toContain("'future_trial_start'");
    expect(pre).toContain("'invalid_trial_ordering'");
    expect(pre).not.toMatch(
      /malformed_count[\s\S]*?'trial_period_elapsed'[\s\S]*?from current_lifecycle/,
    );
  });

  test("3. exposes only auth-bound safe operational state", () => {
    const source = functionBody(
      "public",
      "get_current_tenant_operational_state",
    );
    expect(source).toContain("operational_actor_has_tenant_identity");
    expect(source).toContain("auth.uid()");
    expect(source).toContain("'subscription_inactive'");
    expect(source).toContain("'effective_state'");
    for (const forbidden of [
      "billing_email",
      "billing_phone",
      "current_period_end",
      "grace_period_ends_at",
      "payment_status",
      "plan_id",
      "student_id",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("4. evaluates lifecycle before Module 62, plan, and feature overrides", () => {
    const source = functionBody(
      "coachfort_internal",
      "resolve_effective_feature_access_authority",
    );
    const post = verifier("POST-APPLY");
    const lifecycle = source.indexOf("tenant_operational_access_allowed");
    const module62 = source.indexOf("tenant_feature_settings");
    const plan = source.indexOf("subscription_plan_feature_entitlements");
    const override = source.indexOf("tenant_subscription_overrides");
    expect(lifecycle).toBeGreaterThanOrEqual(0);
    expect(lifecycle).toBeLessThan(module62);
    expect(lifecycle).toBeLessThan(plan);
    expect(lifecycle).toBeLessThan(override);
    expect(source).toContain("when not v_operational_allowed then 'locked'");
    expect(source.indexOf("when not v_operational_allowed")).toBeLessThan(
      source.indexOf("feature_override.override_type = 'feature_unlock'"),
    );
    expect(post).toContain(
      "'when not v_operational_allowed then ''locked''' in resolver_source",
    );
    expect(post).toContain(
      "'when feature_override.override_type = ''feature_lock'' then ''locked'''",
    );
    expect(post).toContain(
      "resolver_source like '%subscription_lifecycle%'",
    );
    expect(post).not.toContain(
      "position('feature_override.override_type' in resolver_source)",
    );
  });

  test("5. bridges all public entitlement readers to canonical authority", () => {
    const sql = executableSql();
    expect(functionBody("public", "resolve_effective_feature_access")).toContain(
      "resolve_effective_feature_access_authority",
    );
    expect(functionBody("public", "feature_access_effective_rows")).toContain(
      "resolve_effective_feature_access_authority",
    );
    expect(functionBody("public", "get_tenant_entitlement_state")).toContain(
      "resolve_effective_feature_access_authority",
    );
    expect(sql).toContain("create or replace function public.feature_access_effective_rows");
    expect(sql).not.toContain("coalesce(v_status, 'trial') = 'past_due'");
  });

  test("6. denies lifecycle before every quota lookup", () => {
    const checks: Array<[string, string, string]> = [
      ["public", "assert_tenant_usage_limit", "subscription_plan_usage_limits"],
      [
        "public",
        "assert_tenant_entity_usage_limit",
        "subscription_plan_usage_limits",
      ],
      [
        "public",
        "m71_7p6d_assert_entity_usage_limit_internal",
        "subscription_plan_usage_limits",
      ],
      [
        "coachfort_internal",
        "assert_private_storage_quota",
        "private_storage_usage",
      ],
    ];
    for (const [schema, name, quotaMarker] of checks) {
      const source = functionBody(schema, name);
      expect(source).toContain("assert_tenant_operational_access");
      expect(source.indexOf("assert_tenant_operational_access")).toBeLessThan(
        source.indexOf(quotaMarker),
      );
    }
    expect(
      functionBody("public", "assert_tenant_usage_limit"),
    ).not.toContain("'reason', 'no_assignment'");
  });

  test("7. keeps upload cleanup possible while blocking positive preparation", () => {
    const source = functionBody(
      "coachfort_internal",
      "assert_private_storage_quota",
    );
    expect(source).toContain(
      "if p_storage_byte_delta > 0 or p_document_count_delta > 0 then",
    );
    expect(source).toContain("assert_tenant_operational_access");
    expect(source.indexOf("if p_storage_byte_delta > 0")).toBeLessThan(
      source.indexOf("private_storage_usage"),
    );
  });

  test("8. gates shared team and Student SECURITY DEFINER authority", () => {
    const sql = executableSql();
    for (const helper of [
      "m69_1_current_role",
      "m69_2_current_role",
      "m69_3_current_role",
      "m69_4_current_role",
      "m69_5_current_role",
      "m69_6_current_role",
      "m69_8_current_role",
      "m69_9_current_role",
      "finance_current_role",
      "reports_current_role",
      "document_center_current_role",
      "chat_current_team_role",
      "workflow_current_role",
      "approval_current_role",
      "team_ops_current_role",
      "crm_current_role",
      "marketing_current_member_role",
      "m70_3b_current_role",
    ]) {
      expect(functionBody("public", helper)).toContain(
        "operational_current_team_role",
      );
    }
    expect(sql).toContain(
      "create or replace function coachfort_internal.student_portal_access_allowed_for_user",
    );
    expect(sql).toContain("v_mode = 'portal'");
    expect(sql).toContain("tenant_operational_access_allowed(p_tenant_id)");
    expect(functionBody("public", "finance_student_can_access")).toContain(
      "tenant_operational_access_allowed",
    );
  });

  test("9. adds restrictive operational RLS without recursive policy joins", () => {
    const sql = executableSql();
    expect(sql).toContain("create policy %i on public.%i as restrictive");
    expect(sql).toContain("ux8g1b operational lifecycle gate");
    expect(sql).toContain(
      "coachfort_internal.tenant_operational_access_allowed(tenant_id)",
    );
    expect(sql).toContain("student_bootstrap_identity_allowed");
    const studentPolicy = sql.match(
      /create policy "ux8g1b operational lifecycle gate"[\s\S]*?\$policy\$/,
    )?.[0];
    expect(studentPolicy).toBeTruthy();
    expect(studentPolicy).not.toContain("from public.student_portal_accounts");
    for (const table of [
      "automation_runs",
      "automation_run_logs",
      "ai_conversations",
      "ai_messages",
      "ai_request_logs",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    for (const table of [
      "reminders",
      "notification_preferences",
      "communication_logs",
      "public_site_leads",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  test("9b. keeps anonymous access on the existing lifecycle-gated public authority", () => {
    const sql = executableSql();
    const publicSite = functionBody("public", "get_public_site");
    expect(publicSite).toContain("tenant_operational_access_allowed");
    expect(publicSite.indexOf("tenant_operational_access_allowed")).toBeLessThan(
      publicSite.indexOf("from public.courses"),
    );
    expect(sql).toContain("'public_site_leads'");
    expect(sql).not.toContain(
      "grant execute on function coachfort_internal.tenant_operational_access_allowed(uuid) to anon",
    );
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    for (const check of [pre, post]) {
      expect(check).toContain("direct_operational_grant_count");
      expect(check).toContain("public_site_callable");
      expect(check).toContain("public_lead_callable");
    }
    expect(post).toContain("anonymous_public_boundary");
  });

  test("9c. limits inactive membership reads to self or canonical platform authority", () => {
    const sql = executableSql();
    const policy = sql.match(
      /create policy "ux8g1b tenant membership bootstrap gate"[\s\S]*?\$policy\$/,
    )?.[0];
    expect(policy).toBeTruthy();
    expect(policy).toContain("as restrictive");
    expect(policy).toContain("for select");
    expect(policy).toContain("user_id = auth.uid()");
    expect(policy).toContain("public.is_platform_admin()");
    expect(policy).toContain("tenant_operational_access_allowed(tenant_id)");
    expect(policy).not.toContain("with check");
    expect(verifier("POST-APPLY")).toContain(
      "tenant_members_bootstrap_gate",
    );
  });

  test("9d. classifies notification recovery and gates reminders operationally", () => {
    const sql = executableSql();
    const notificationAccess = functionBody(
      "coachfort_internal",
      "notification_lifecycle_access_allowed",
    );
    expect(notificationAccess).toContain("tenant_operational_access_allowed");
    expect(notificationAccess).toContain("p_recipient_user_id = auth.uid()");
    expect(notificationAccess).toContain(
      "p_notification_type = 'subscription_notice'",
    );
    expect(notificationAccess).not.toContain("'payment_reminder'");
    expect(notificationAccess).not.toContain("'invoice_notice'");
    expect(notificationAccess).toContain("member.role in ('owner', 'admin')");
    expect(notificationAccess).not.toContain("'invitation_notice'");
    expect(notificationAccess).not.toContain("'system_notice'");
    expect(functionBody("public", "mark_notification_read_secure")).toContain(
      "notification_lifecycle_access_allowed",
    );
    expect(functionBody("public", "get_mobile_notifications")).toContain(
      "notification_lifecycle_access_allowed",
    );
    expect(sql).toContain('"ux8g1b notification lifecycle gate"');
    const triggerTables = sql.match(
      /v_trigger_tables constant text\[\] := array\[([\s\S]*?)\]::text\[\]/,
    )?.[1];
    expect(triggerTables).toContain("'reminders'");
    expect(triggerTables).toContain("'notification_preferences'");
    expect(triggerTables).not.toContain("'notifications'");
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    expect(pre).toContain("notification_type_inventory");
    expect(pre).toContain("payment_reminder_count");
    expect(pre).toContain("invoice_notice_count");
    expect(pre).toContain("subscription_notice_count");
    const readyGate = pre.match(
      /'ready_for_apply',([\s\S]*?),\s*'prerequisites'/,
    )?.[1];
    expect(readyGate).toBeTruthy();
    expect(readyGate).not.toContain("notification_type_inventory");
    expect(post).toContain("notification_lifecycle_gate");
    expect(post).toContain(
      "%p_notification_type = ''subscription_notice''%",
    );
    expect(post).toContain(
      "notification_access_source not like '%payment_reminder%'",
    );
    expect(post).toContain(
      "notification_access_source not like '%invoice_notice%'",
    );
  });

  test("9e. fails closed when authenticated operational authority lacks RLS", () => {
    const sql = executableSql();
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    expect(pre).toContain("authenticated_target_authority");
    expect(pre).toContain("operational_rls_baseline");
    expect(pre).toContain("not rls_enabled or not tenant_key_present");
    expect(pre).toContain("unclassified_bypass_count = 0");
    expect(sql).toContain(
      "authenticated operational table authority lacks lifecycle-compatible rls",
    );
    const expectedPolicies = post.match(
      /expected_policy_tables as \(([\s\S]*?)\), policy_state as/,
    )?.[1];
    expect(expectedPolicies).toBeTruthy();
    expect(expectedPolicies).toContain("class.relrowsecurity as rls_enabled");
    expect(expectedPolicies).not.toContain("and class.relrowsecurity");
    expect(post).toContain("authenticated_operational_authority");
    expect(post).toContain("operational_authority_state");
    expect(post).toContain("operational_authority_gate");
    expect(post).toContain(
      "rls_enabled and tenant_key_present and lifecycle_authority_installed",
    );
  });

  test("9f. grandfathers only zero-history workspaces as inactive", () => {
    const sql = executableSql();
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    expect(pre).toContain("from public.tenants tenant");
    expect(pre).toContain("classified_tenants");
    expect(pre).toContain("left join public.tenant_subscription_assignments");
    expect(pre).toContain("canonical_current_assignment_count");
    expect(pre).toContain(
      "legacy_pre_subscription_inactive_count",
    );
    expect(pre).toContain(
      "legacy_pre_subscription_inactive_tenant_ids",
    );
    expect(pre).toContain("assignment_history_without_current_count");
    expect(pre).toContain(
      "assignment_history_without_current_tenant_ids",
    );
    const readyGate = pre.match(
      /'ready_for_apply',([\s\S]*?),\s*'prerequisites'/,
    )?.[1];
    expect(readyGate).toBeTruthy();
    expect(readyGate).toContain(
      "assignment_history_without_current_count = 0",
    );
    expect(readyGate).not.toContain(
      "legacy_pre_subscription_inactive_count = 0",
    );
    expect(sql).toContain(
      "workspace assignment history lacks a current canonical assignment",
    );
    expect(sql).toMatch(
      /where exists \([\s\S]*?tenant_subscription_assignments[\s\S]*?and not exists \([\s\S]*?assignment\.is_current[\s\S]*?workspace assignment history lacks a current canonical assignment/,
    );
    expect(sql).toContain(
      "canonical subscription lifecycle authority is malformed",
    );
    expect(sql).not.toMatch(
      /^\s*(?:insert\s+into|update|delete\s+from)\s+public\.tenant_subscription_assignments\b/gm,
    );
    expect(post).toContain("tenant_assignment_state");
    expect(post).toContain("tenant_assignment_coverage_gate");
    expect(post).toContain(
      "legacy_pre_subscription_operationally_allowed_count = 0",
    );
    expect(post).toContain("malformed_current_assignment_count = 0");
    expect(post).toContain("migration_backfilled_legacy_assignments', false");
  });

  test("9f-bootstrap. requires the canonical UX-8G1A1 workspace bootstrap", () => {
    const sql = executableSql();
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");

    for (const verifierSql of [pre, post]) {
      expect(verifierSql).toContain("is_workspace_trial_default");
      expect(verifierSql).toContain("default_plan_count = 1");
      expect(verifierSql).toContain("eligible_default_plan_count = 1");
      expect(verifierSql).toContain(
        "insert into public.tenant_subscription_assignments",
      );
      expect(verifierSql).toContain("where plan.is_workspace_trial_default");
      expect(verifierSql).toContain("plan.status in (''draft'', ''active'')");
      expect(verifierSql).toContain("plan.trial_days > 0");
      expect(verifierSql).toContain("source not like '%plan.code =%'");
      expect(verifierSql).toContain("authenticated_execute");
      expect(verifierSql).toContain("not bootstrap.anon_execute");
      expect(verifierSql).toContain("not bootstrap.service_role_execute");
      expect(verifierSql).toContain("not bootstrap.public_execute");
    }
    expect(pre).toContain("workspace_bootstrap_prerequisite");
    expect(post).toContain("workspace_bootstrap_gate");
    expect(sql).toContain(
      "canonical workspace trial bootstrap authority is unavailable",
    );
  });

  test("9g. keeps direct feature rows private behind authorized wrappers", () => {
    const sql = executableSql();
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    expect(sql).toContain(
      "revoke all on function public.feature_access_effective_rows(uuid)",
    );
    expect(sql).not.toContain(
      "grant execute on function public.feature_access_effective_rows(uuid)",
    );
    expect(pre).toContain("feature_row_authority");
    expect(pre).toContain("authenticated_execute_absent");
    expect(pre).toContain("tenant_wrapper_auth_bound");
    expect(pre).toContain("portal_wrapper_auth_bound");
    expect(post).toContain(
      "('public.feature_access_effective_rows(uuid)', false, true)",
    );
    expect(post).toContain("feature_row_isolation");
    expect(post).toContain("feature_access_current_role");
    expect(post).toContain("has_any_active_student_portal_account");
  });

  test("9h. proves canonical Platform Admin authority cannot recurse through membership", () => {
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    for (const check of [pre, post]) {
      expect(check).toContain("public.platform_current_role()");
      expect(check).toContain("public.platform_admin_users");
      expect(check).toContain("auth.uid()");
      expect(check).toContain("status = ''active''");
      expect(check).toContain("not like");
      expect(check).toContain("%tenant_members%");
    }
    expect(pre).toContain("platform_authority");
    expect(post).toContain("platform_authority_state");
    expect(post).toContain("platform_authority_gate");
  });

  test("9a. blocks legacy automation dispatch before execution", () => {
    const source = functionBody("public", "run_automation_trigger");
    expect(source).toContain("assert_tenant_operational_access");
    expect(source.indexOf("assert_tenant_operational_access")).toBeLessThan(
      source.indexOf("is_valid_automation_trigger"),
    );
    expect(source.indexOf("assert_tenant_operational_access")).toBeLessThan(
      source.indexOf("run_automation_trigger_unvalidated"),
    );
    expect(source.indexOf("assert_tenant_operational_access")).toBeLessThan(
      source.indexOf("exception when others"),
    );
  });

  test("10. enforces SECURITY DEFINER mutations without blocking recovery tables", () => {
    const sql = executableSql();
    const trigger = functionBody(
      "coachfort_internal",
      "enforce_tenant_operational_mutation",
    );
    expect(trigger).toContain("assert_tenant_operational_access");
    expect(trigger).not.toContain("auth.uid() is null");
    expect(trigger).not.toContain("trusted service/background");
    expect(sql).toContain("before insert or update or delete");
    const triggerTables = sql.match(
      /v_trigger_tables constant text\[\] := array\[([\s\S]*?)\]::text\[]/,
    )?.[1];
    expect(triggerTables).toBeTruthy();
    for (const excluded of [
      "tenant_subscription_assignments",
      "tenant_billing_profiles",
      "platform_billing_invoices",
      "platform_billing_receipts",
      "subscription_change_intents",
      "tenant_payment_orders",
    ]) {
      expect(triggerTables).not.toContain(`'${excluded}'`);
      expect(verifier("POST-APPLY")).toContain(excluded);
    }
  });

  test("11. preserves dynamic expiry and UX-8G1A post-lapse renewal", () => {
    const sql = executableSql();
    expect(executableSqlWithoutFunctionBodies()).not.toMatch(
      /^\s*(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)/m,
    );
    expect(sql).not.toMatch(
      /update\s+public\.tenant_subscription_assignments[\s\S]*?status\s*=\s*'expired'/,
    );
    expect(sql).not.toContain(
      "create or replace function public.create_platform_renewal_payment_order_authority_server",
    );
    expect(sql).not.toContain(
      "create or replace function coachfort_internal.activate_renewal_tenant_plan_after_verified_payment",
    );
    expect(ux8g1a.toLowerCase()).toContain(
      "v_base.status not in ('active','grace','past_due')",
    );
  });

  test("12. has decisive read-only PRE and POST verification", () => {
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    expect(pre).toContain("ready_for_apply");
    expect(pre).toContain("grace_count");
    expect(pre).toContain("expired_count");
    expect(pre).toContain("malformed_count");
    expect(pre).toContain("dynamically_expired_renewable_count");
    expect(pre).toContain("browser_grants");
    expect(post).toContain("security_gate");
    expect(post).toContain("quota_lifecycle_first");
    expect(post).toContain("domain_authority_gate");
    expect(post).toContain("leaf_authority_gate");
    expect(post).toContain("mutation_trigger_gate");
    expect(post).toContain("student_bootstrap_policy_gate");
    expect(post).toContain("null_uid_fail_closed");
    expect(post).toContain("anonymous_public_boundary");
    expect(post).toContain("tenant_members_bootstrap_gate");
    expect(post).toContain("notification_lifecycle_gate");
    expect(post).toContain("operational_authority_gate");
    expect(post).toContain("feature_row_isolation");
    expect(post).toContain("platform_authority_gate");
    expect(post).toContain("tenant_assignment_coverage_gate");
    for (const verifierSql of [pre, post]) {
      expect(verifierSql).not.toMatch(
        /^\s*(?:insert|update|delete|merge|truncate|alter|create|drop|grant|revoke)\b/gm,
      );
    }
  });
});
