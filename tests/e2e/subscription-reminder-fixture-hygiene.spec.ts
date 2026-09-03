import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g3b1_fixture_communication_hygiene.sql",
);
const targetingMigration = read(
  "supabase/bundle_ux8g3b_subscription_lifecycle_reminder_targeting.sql",
);
const worker = read("src/lib/server/transactionalEmail.ts");

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected exactly one executable transaction").toHaveLength(1);
  return (matches?.[0] ?? "").toLowerCase();
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create(?: or replace)? function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

function targetingBody() {
  const matches = targetingMigration
    .toLowerCase()
    .match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected the G3B executable transaction").toHaveLength(1);
  const match = (matches?.[0] ?? "").match(
    /create function public\.enqueue_subscription_lifecycle_reminders_server\([\s\S]*?\n\$\$;/,
  );
  expect(match, "Expected the G3B targeting function").not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8G3B1 production fixture communication hygiene", () => {
  test("keeps read-only verification around one guarded transaction", () => {
    for (const label of ["PRE-APPLY", "POST-APPLY"] as const) {
      expect(verificationBlock(label)).not.toMatch(
        /^\s*(insert\s+into|update\s+(?:public\.|coachfort_internal\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index)|drop\s+(?:table|function)|truncate|merge\s+into)\b/m,
      );
    }
    expect(verificationBlock("PRE-APPLY")).toContain("ready_for_apply");
    expect(verificationBlock("POST-APPLY")).toContain("security_gate");
    expect(executableSql()).not.toContain("cascade");
  });

  test("creates one private, constrained tenant fixture classification", () => {
    const sql = executableSql();
    const table = sql.match(
      /create table coachfort_internal\.tenant_fixture_classifications \([\s\S]*?\n\);/,
    )?.[0] ?? "";
    expect(table).toContain("tenant_id uuid primary key");
    expect(table).toContain("fixture_type text not null");
    expect(table).toContain(
      "automated_customer_communications_enabled boolean not null",
    );
    expect(table).toContain("created_at timestamptz not null default now()");
    expect(table).toContain("updated_at timestamptz not null default now()");
    expect(table).toContain("references public.tenants(id) on delete restrict");
    expect(table).toContain("fixture_type in ('regression', 'smoke')");
    expect(sql).toContain(
      "alter table coachfort_internal.tenant_fixture_classifications\n  enable row level security",
    );
    expect(sql).toContain(
      "revoke all on table coachfort_internal.tenant_fixture_classifications\n  from public, anon, authenticated, service_role",
    );
  });

  test("defaults ordinary tenants to allowed and honors explicit fixture policy", () => {
    const helper = functionBody(
      "coachfort_internal",
      "tenant_allows_automated_customer_communications",
    );
    expect(helper).toContain("if p_tenant_id is null or not exists (");
    expect(helper).toContain("return false");
    expect(helper).toContain(
      "classification.automated_customer_communications_enabled",
    );
    expect(helper).toContain("if not found then\n    return true");
    expect(helper).toContain("return v_allowed");

    const allows = (
      tenantExists: boolean,
      classifiedValue: boolean | null,
    ) => tenantExists && (classifiedValue ?? true);
    expect(allows(false, null)).toBe(false);
    expect(allows(true, null)).toBe(true);
    expect(allows(true, true)).toBe(true);
    expect(allows(true, false)).toBe(false);
  });

  test("guard-classifies only the exact regression fixture", () => {
    const sql = executableSql();
    expect(sql).toContain("v_exact_identity_count <> 1");
    expect(sql).toContain("v_conflicting_identity_count <> 0");
    expect(sql).toContain(
      "insert into coachfort_internal.tenant_fixture_classifications",
    );
    expect(sql).toContain("select tenant.id, 'regression', false");
    expect(sql).toContain("get diagnostics v_rows = row_count");
    expect(sql).toContain("if v_rows <> 1 then");
    expect(verificationBlock("POST-APPLY")).toContain(
      "workspace_email_smoke_not_classified",
    );
  });

  test("excludes fixtures during canonical discovery before targeting and limit", () => {
    const candidates = functionBody(
      "coachfort_internal",
      "subscription_lifecycle_reminder_candidates",
    );
    const policy = candidates.indexOf(
      "where coachfort_internal.tenant_allows_automated_customer_communications",
    );
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(candidates.indexOf("), candidates as ("));
    expect(candidates).toContain("assignment.is_current");
    expect(candidates).toContain("tenant_subscription_effective_lifecycle");

    const targeting = targetingBody();
    expect(targeting).toContain(
      "from coachfort_internal.subscription_lifecycle_reminder_candidates(now())",
    );
    expect(targeting.indexOf("subscription_lifecycle_reminder_candidates(now())"))
      .toBeLessThan(targeting.indexOf("candidate.tenant_id = p_target_tenant_id"));
    expect(targeting.indexOf("candidate.tenant_id = p_target_tenant_id"))
      .toBeLessThan(targeting.indexOf("limit p_limit"));
  });

  test("prevents targeted and unfiltered fixture candidates from creating either channel", () => {
    const targeting = targetingBody();
    const candidateCursor = targeting.indexOf(
      "subscription_lifecycle_reminder_candidates(now())",
    );
    expect(candidateCursor).toBeGreaterThan(-1);
    expect(candidateCursor).toBeLessThan(
      targeting.indexOf("enqueue_transactional_email("),
    );
    expect(candidateCursor).toBeLessThan(
      targeting.indexOf("insert into public.notifications"),
    );
    expect(targeting).toContain(
      "p_target_tenant_id is null\n        or candidate.tenant_id = p_target_tenant_id",
    );
    expect(targeting).toContain("if p_dry_run then\n      continue");

    const sql = executableSql();
    expect(sql).not.toMatch(
      /^\s*insert into (?:public\.notifications|coachfort_internal\.transactional_email_outbox|coachfort_internal\.subscription_lifecycle_reminder_deliveries)\b/m,
    );
    expect(sql).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:tenant_subscription_assignments|tenant_payment_orders|tenant_payment_attempts)/,
    );
  });

  test("revalidates fixture policy before sending an already queued reminder", () => {
    const current = functionBody(
      "coachfort_internal",
      "subscription_lifecycle_reminder_delivery_is_current",
    );
    const policy = current.indexOf(
      "tenant_allows_automated_customer_communications",
    );
    expect(policy).toBeGreaterThan(-1);
    expect(current).toContain("if not found then\n    return false");
    expect(current).toContain(
      "if not coachfort_internal.tenant_allows_automated_customer_communications",
    );
    expect(policy).toBeLessThan(current.indexOf("assignment.is_current"));
    expect(policy).toBeLessThan(
      current.indexOf("tenant_subscription_effective_lifecycle"),
    );
    expect(current).toContain("join auth.users auth_user");
    expect(current).toContain(
      "lower(btrim(auth_user.email)) = v_delivery.recipient_email",
    );
    expect(worker).toContain("obsolete_lifecycle_event");
    expect(worker).toContain("isSubscriptionLifecycleReminderCurrent");
  });

  test("keeps fixture identity out of every runtime authority function", () => {
    const runtime = [
      functionBody(
        "coachfort_internal",
        "tenant_allows_automated_customer_communications",
      ),
      functionBody(
        "coachfort_internal",
        "subscription_lifecycle_reminder_candidates",
      ),
      functionBody(
        "coachfort_internal",
        "subscription_lifecycle_reminder_delivery_is_current",
      ),
      targetingBody(),
    ].join("\n");
    expect(runtime).not.toContain("29a33701-82ed-4c7f-8042-0a1af8296ce5");
    expect(runtime).not.toContain("coachfort-regression");
    expect(runtime).not.toContain("regression coaching");
    expect(runtime).not.toContain(".demo");
    expect(runtime).not.toContain("profiles.email");
  });

  test("keeps classification private and reminder orchestration service-only", () => {
    const sql = executableSql();
    for (const identity of [
      "tenant_fixture_classification_updated_at()",
      "tenant_allows_automated_customer_communications(uuid)",
      "subscription_lifecycle_reminder_candidates(timestamptz)",
      "subscription_lifecycle_reminder_delivery_is_current(uuid)",
    ]) {
      expect(sql).toContain(
        `revoke all on function\n  coachfort_internal.${identity}\n  from public, anon, authenticated, service_role`,
      );
    }
    expect(targetingMigration.toLowerCase()).toMatch(
      /grant execute on function\s+public\.enqueue_subscription_lifecycle_reminders_server\(\s*boolean, integer, uuid, text\s*\)\s+to service_role/,
    );
    expect(targetingMigration.toLowerCase()).not.toMatch(
      /grant execute on function[\s\S]*?to (?:anon|authenticated)/,
    );
  });

  test("guards all protected row counts and verifies the installed security contract", () => {
    const sql = executableSql();
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");
    for (const count of [
      "reminder_delivery_rows",
      "notifications",
      "email_outbox",
      "subscription_assignments",
      "current_subscription_assignments",
      "payment_orders",
      "fixture_classification_rows",
    ]) {
      expect(pre).toContain(`'${count}'`);
      expect(post).toContain(`'${count}'`);
    }
    expect(sql).toContain("set_config(");
    expect(sql).toContain("changed protected business or delivery row counts");
    expect(post).toContain("candidate_policy_before_event_discovery");
    expect(post).toContain("delivery_policy_rechecked");
    expect(post).toContain("runtime_fixture_literals_absent");
    expect(post).toContain("browser_and_service_access_absent");
  });
});
