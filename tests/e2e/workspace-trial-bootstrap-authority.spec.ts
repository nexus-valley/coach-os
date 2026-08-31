import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g1a1_canonical_workspace_trial_bootstrap.sql",
);
const lifecycleMigration = read(
  "supabase/bundle_ux8g1a_renewal_lifecycle_authority.sql",
);
const assignmentFoundation = read(
  "supabase/module71_7f2_subscription_entitlements.sql",
);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0] ?? "";
}

function verifier(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1] ?? "";
}

function workspaceFunction() {
  const match = executableSql().match(
    /create or replace function public\.create_workspace_with_owner\([\s\S]*?\n\$\$;/i,
  );
  expect(match, "Expected canonical workspace function").not.toBeNull();
  return match?.[0].toLowerCase() ?? "";
}

test.describe("UX-8G1A1 canonical workspace trial bootstrap", () => {
  test("1. initially designates Starter through a reusable default marker", () => {
    const sql = executableSql().toLowerCase();

    expect(sql).toContain(
      "add column is_workspace_trial_default boolean not null default false",
    );
    expect(sql).toContain(
      "create unique index subscription_plans_workspace_trial_default_uidx",
    );
    expect(sql).toContain("where is_workspace_trial_default");
    expect(sql).not.toContain(
      "subscription_plans_workspace_trial_default_code_check",
    );
    expect(sql).not.toContain(
      "check (not is_workspace_trial_default or code = 'starter')",
    );
    expect(sql).toContain(
      "check (not is_workspace_trial_default or trial_days > 0)",
    );
    expect(sql).toContain(
      "check (not is_workspace_trial_default or status in ('draft', 'active'))",
    );
    expect(sql).toMatch(
      /update public\.subscription_plans[\s\S]*?set is_workspace_trial_default = true[\s\S]*?where code = 'starter'/,
    );
    expect(sql).not.toMatch(
      /where code in \('starter',\s*'growth'|where code = '(?:growth|premium)'[\s\S]*?is_workspace_trial_default = true/,
    );
  });

  test("2. creates the canonical non-paid trial tuple for a fresh workspace", () => {
    const source = workspaceFunction();

    expect(source).toContain("where plan.is_workspace_trial_default");
    expect(source).toContain("plan.status in ('draft', 'active')");
    expect(source).toContain("plan.trial_days > 0");
    expect(source).not.toMatch(/plan\.code\s*=/);
    expect(source).toContain("for share");
    expect(source).toContain("v_trial_started_at := transaction_timestamp()");
    expect(source).toContain(
      "v_trial_ends_at := v_trial_started_at + make_interval(days => v_trial_days)",
    );
    expect(source).toContain(
      "insert into public.tenant_subscription_assignments",
    );
    expect(source).toMatch(
      /'trial',\s*'monthly',\s*'inr',\s*v_trial_started_at,\s*v_trial_ends_at,\s*null,\s*null,\s*null,\s*'not_required',\s*'system',\s*true/,
    );
    expect(source).toContain("'trial_placeholders_non_commercial', true");
    expect(source).toContain("'trial_days', v_trial_days");
    expect(source).toContain("'paid_currency_authority', false");
    expect(source).toContain("'paid_billing_cycle_authority', false");
  });

  test("3. synchronizes legacy trial fields without making them lifecycle authority", () => {
    const source = workspaceFunction();
    const lifecycle = lifecycleMigration.toLowerCase();

    expect(source).toMatch(
      /insert into public\.tenants \([\s\S]*?trial_started_at,[\s\S]*?trial_ends_at,[\s\S]*?is_trial_active[\s\S]*?v_trial_started_at,[\s\S]*?v_trial_ends_at,[\s\S]*?true/,
    );
    expect(lifecycle).toContain("if v_assignment.status = 'trial' then");
    expect(lifecycle).toContain("now() < v_assignment.trial_ends_at");
    expect(lifecycle).toContain("trial_period_elapsed");
    expect(source).not.toContain("current_period_start :=");
    expect(source).not.toContain("current_period_end :=");
    expect(source).not.toContain("grace_period_ends_at :=");
  });

  test("4. keeps tenant, Owner membership, and trial assignment in one atomic function", () => {
    const sql = executableSql().toLowerCase();
    const source = workspaceFunction();
    const tenantInsert = source.indexOf("insert into public.tenants (");
    const memberInsert = source.indexOf(
      "insert into public.tenant_members (tenant_id, user_id, role)",
      tenantInsert,
    );
    const assignmentInsert = source.indexOf(
      "insert into public.tenant_subscription_assignments",
    );

    expect(sql.match(/create or replace function public\.create_workspace_with_owner/g)).toHaveLength(1);
    expect(tenantInsert).toBeGreaterThan(-1);
    expect(memberInsert).toBeGreaterThan(tenantInsert);
    expect(assignmentInsert).toBeGreaterThan(memberInsert);
    expect(source).not.toContain("dblink");
    expect(source).not.toContain("commit;");
    expect(source).not.toContain("rollback;");
  });

  test("5. serializes retries and preserves the one-current-assignment invariant", () => {
    const source = workspaceFunction();

    expect(source).toContain(
      "perform pg_advisory_xact_lock(hashtextextended(requesting_user::text, 0))",
    );
    expect(source.indexOf("from public.tenant_members tm")).toBeLessThan(
      source.indexOf("from public.subscription_plans plan"),
    );
    expect(source.indexOf("where t.owner_user_id = requesting_user")).toBeLessThan(
      source.indexOf("from public.subscription_plans plan"),
    );
    expect(assignmentFoundation.toLowerCase()).toContain(
      "create unique index if not exists tenant_subscription_assignments_current_unique_idx",
    );
    expect(assignmentFoundation.toLowerCase()).toContain("where is_current");
  });

  test("6. preserves existing assigned workspaces and does not duplicate authority", () => {
    const source = workspaceFunction();
    const planResolution = source.indexOf("from public.subscription_plans plan");
    const memberBranch = source.slice(
      source.indexOf("from public.tenant_members tm"),
      source.indexOf("select t.*", source.indexOf("from public.tenant_members tm")),
    );
    const ownerBranch = source.slice(
      source.indexOf("where t.owner_user_id = requesting_user"),
      planResolution,
    );

    expect(memberBranch).toContain("if found then");
    expect(memberBranch).toContain("return query");
    expect(memberBranch).toContain("return;");
    expect(ownerBranch).toContain("if found then");
    expect(ownerBranch).toContain("return query");
    expect(ownerBranch).toContain("return;");
    expect(source.match(/insert into public\.tenant_subscription_assignments/g)).toHaveLength(1);
    expect(source).not.toContain("update public.tenant_subscription_assignments");
  });

  test("7. leaves historical zero-assignment workspaces inactive", () => {
    const sql = executableSql().toLowerCase();
    const source = workspaceFunction();
    const pre = verifier("PRE-APPLY").toLowerCase();
    const post = verifier("POST-APPLY").toLowerCase();
    const assignmentInsert = source.match(
      /insert into public\.tenant_subscription_assignments \([\s\S]*?\)\s*values \([\s\S]*?\);/,
    )?.[0] ?? "";

    expect(pre).toContain("zero_assignment_history");
    expect(post).toContain("zero_assignment_history");
    expect(post).toContain("historical_backfill_signals");
    expect(assignmentInsert).not.toBe("");
    expect(assignmentInsert).toContain("values (");
    expect(assignmentInsert).not.toContain("select");
    expect(assignmentInsert).not.toContain("from public.tenants");
    expect(sql).not.toContain("update public.tenant_subscription_assignments");
    expect(sql).not.toContain("delete from public.tenant_subscription_assignments");
  });

  test("8. propagates assignment failures so the workspace transaction rolls back", () => {
    const source = workspaceFunction();

    expect(source).toContain("when unique_violation then");
    expect(source).toContain(
      "get stacked diagnostics v_constraint_name = constraint_name",
    );
    expect(source).toContain("if v_constraint_name <> 'tenants_slug_key' then");
    expect(source).toMatch(
      /if v_constraint_name <> 'tenants_slug_key' then\s*raise;\s*end if/,
    );
    expect(source).not.toContain("when others then");
    expect(source).not.toContain("workspace trial authority is unavailable.'; return");
  });

  test("9. preserves browser write denial and exact workspace RPC ACL", () => {
    const sql = executableSql().toLowerCase();
    const assignmentSql = assignmentFoundation.toLowerCase();

    expect(assignmentSql).toContain(
      "revoke all privileges on table public.tenant_subscription_assignments from public, anon, authenticated",
    );
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]*?tenant_subscription_assignments[\s\S]*?(?:anon|authenticated)/,
    );
    expect(sql).toContain(
      "revoke all on function public.create_workspace_with_owner(text, text, text)\nfrom public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.create_workspace_with_owner(text, text, text)\nto authenticated",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
  });

  test("10. creates no payment, activation, Razorpay, invoice, or receipt side effect", () => {
    const source = workspaceFunction();

    for (const forbidden of [
      "tenant_payment_orders",
      "tenant_payment_attempts",
      "tenant_plan_activation_events",
      "platform_billing_receipts",
      "insert into public.invoices",
      "razorpay",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("11. keeps PRE and POST read-only and makes their gates decisive", () => {
    const pre = verifier("PRE-APPLY").toLowerCase();
    const post = verifier("POST-APPLY").toLowerCase();
    const statementMutation = /^\s*(?:insert|update|delete|merge|truncate|alter|create|drop|grant|revoke)\b/gm;

    expect(pre).not.toMatch(statementMutation);
    expect(post).not.toMatch(statementMutation);
    expect(pre).toContain("'ready_for_apply'");
    expect(pre).toContain("'subscription_plans', 'metadata_json', 'jsonb'");
    expect(pre).toContain(
      "'subscription_plans', 'updated_at', 'timestamp with time zone'",
    );
    expect(pre).toContain(
      "'tenant_subscription_assignments', 'metadata_json', 'jsonb'",
    );
    expect(pre).toContain(
      "'tenant_subscription_assignments', 'created_by', 'uuid'",
    );
    expect(pre).toContain(
      "'tenant_subscription_assignments', 'updated_by', 'uuid'",
    );
    expect(pre).toContain("metadata_capacity_ok");
    expect(pre).toContain("plan_metadata_contract");
    expect(pre).toContain("conflicting_bootstrap_objects");
    expect(pre).toContain("bootstrap_function_inventory");
    expect(pre).toContain("assignment_trial_tuple");
    expect(pre).toContain("historical_assignment_state");
    expect(post).toContain("'security_gate'");
    expect(post).toContain("bootstrap_function_inventory");
    expect(post).toContain("assignment_trial_tuple");
    expect(post).toContain("invalid_bootstrap_assignments = 0");
    expect(post).toContain("historical_backfill_signals = 0");
    expect(post).toContain("marker_driven_plan_resolution");
    expect(post).toContain("source not like '%plan.code =%'");
    expect(post).not.toContain("starter_only");
    expect(post).toContain("'migration_backfilled_historical_tenants', false");
  });

  test("12. preserves UX-8G1A lifecycle and UX-8F public authority identities", () => {
    const sql = executableSql().toLowerCase();
    const post = verifier("POST-APPLY").toLowerCase();

    expect(sql).not.toContain(
      "create or replace function coachfort_internal.tenant_subscription_effective_lifecycle",
    );
    expect(sql).not.toContain(
      "create or replace function public.create_platform_payment_order_authority_server",
    );
    expect(sql).not.toContain(
      "create or replace function public.activate_tenant_plan_after_verified_payment",
    );
    expect(post).toContain("ux8g1a_lifecycle_unchanged");
    expect(post).toContain("ux8f_authority_unchanged");
    expect(post).toContain(
      "public.issue_platform_invoice_for_activation_server(uuid)",
    );
    expect(post).toContain(
      "public.issue_platform_receipt_for_fulfillment_server(uuid)",
    );
  });
});
