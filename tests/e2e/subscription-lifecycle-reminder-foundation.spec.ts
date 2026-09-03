import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSubscriptionLifecycleEmail } from "../../src/lib/server/emailTemplates";
import { handleSubscriptionLifecycleReminderRequest } from "../../src/lib/server/subscriptionLifecycleReminders";
import { renderTransactionalEmailTemplate } from "../../src/lib/server/transactionalEmailTemplates";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath =
  "supabase/bundle_ux8g3a_subscription_lifecycle_reminder_foundation.sql";
const migration = read(migrationPath);
const worker = read("src/lib/server/transactionalEmail.ts");
const route = read(
  "app/api/internal/subscription-lifecycle/reminders/route.ts",
);
const reminderServer = read(
  "src/lib/server/subscriptionLifecycleReminders.ts",
);
const templateRegistry = read("src/lib/server/transactionalEmailTemplates.ts");

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
      `create (?:or replace )?function ${schema}\\.${name}\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected function ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8G3A subscription lifecycle reminder foundation", () => {
  test("keeps PRE and POST read-only around one transactional APPLY", () => {
    for (const label of ["PRE-APPLY", "POST-APPLY"] as const) {
      expect(verificationBlock(label)).not.toMatch(
        /\b(insert\s+into|update\s+(?:public\.|coachfort_internal\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index)|drop\s+(?:table|function)|truncate|merge\s+into)\b/,
      );
    }
    expect(executableSql()).toContain("notify pgrst, 'reload schema'");
    expect(executableSql()).not.toContain("cascade");
  });

  test("implements only the six approved events with bounded daily catch-up", () => {
    const candidates = functionBody(
      "coachfort_internal",
      "subscription_lifecycle_reminder_candidates",
    );
    for (const event of [
      "trial_ending",
      "trial_expired",
      "renewal_due_soon",
      "grace_started",
      "grace_ending",
      "subscription_expired",
    ]) {
      expect(candidates).toContain(`'${event}'`);
    }
    expect(candidates).not.toContain("paid_period_ended");
    expect(candidates).toContain("at time zone 'utc'");
    expect(candidates).toContain("::date - 3");
    expect(candidates).toContain("::date - 7");
    expect(candidates).toContain("::date - 2");
    expect(candidates.match(/'grace_started'/g)).toHaveLength(1);
    // Six event windows plus the grace-ending overlap suppression predicate.
    expect(candidates.match(/utc_today\s+>=/g)).toHaveLength(7);
    expect(candidates.match(/and as_of\s+</g)).toHaveLength(3);
    expect(candidates).toMatch(
      /'trial_ending'[\s\S]*?reason'\s*=\s*'within_trial_period'[\s\S]*?as_of\s*<[\s\S]*?utc_today\s*>=/,
    );
    expect(candidates).toMatch(
      /'renewal_due_soon'[\s\S]*?effective_state'\s*=\s*'active'[\s\S]*?as_of\s*<[\s\S]*?utc_today\s*>=/,
    );
    expect(candidates).toMatch(
      /'grace_ending'[\s\S]*?effective_state'\s*=\s*'grace'[\s\S]*?as_of\s*<[\s\S]*?utc_today\s*>=/,
    );
    expect(candidates).toMatch(
      /'trial_expired'[\s\S]*?reason'\s*=\s*'trial_period_elapsed'[\s\S]*?utc_today\s*>=/,
    );
    expect(candidates).toMatch(
      /'grace_started'[\s\S]*?effective_state'\s*=\s*'grace'[\s\S]*?utc_today\s*>=/,
    );
    expect(candidates).toMatch(
      /'subscription_expired'[\s\S]*?reason'\s*=\s*'grace_period_elapsed'[\s\S]*?utc_today\s*>=/,
    );
    expect(candidates).toMatch(
      /'grace_started'[\s\S]*?and not\s*\(\s*as_of\s*<\s*\(lifecycle->>'grace_period_ends_at'\)::timestamptz[\s\S]*?utc_today\s*>=[\s\S]*?::date\s*-\s*2/,
    );
  });

  test("uses canonical current assignment authority and suppresses obsolete queued work", () => {
    const candidates = functionBody(
      "coachfort_internal",
      "subscription_lifecycle_reminder_candidates",
    );
    const current = functionBody(
      "coachfort_internal",
      "subscription_lifecycle_reminder_delivery_is_current",
    );
    for (const body of [candidates, current]) {
      expect(body).toContain("tenant_subscription_effective_lifecycle");
      expect(body).toContain("assignment_id");
    }
    expect(candidates).toContain("assignment.is_current");
    expect(current).toContain("assignment.is_current");
    expect(current).toMatch(
      /is distinct from\s+v_delivery\.assignment_id::text/,
    );
    expect(worker).toContain(
      'claim.template_key === "billing.subscription_lifecycle"',
    );
    expect(worker).toContain("isSubscriptionLifecycleReminderCurrent");
    expect(worker).toContain('errorCode: "obsolete_lifecycle_event"');
    expect(worker.indexOf("isSubscriptionLifecycleReminderCurrent"))
      .toBeLessThan(worker.indexOf("isSuppressed(claim.recipient_email)"));
  });

  test("excludes all legacy tenant and automation lifecycle authority", () => {
    const executable = executableSql();
    for (const forbidden of [
      "tenants.subscription_status",
      "tenants.plan_renews_at",
      "tenants.trial_ends_at",
      "tenants.is_trial_active",
      "runtrialexpiringautomationfortenant",
      "send_email_placeholder",
    ]) {
      expect(executable).not.toContain(forbidden);
    }
    expect(executable).not.toContain("communication_logs");
    expect(executable).not.toContain("public.reminders");
  });

  test("resolves only current Owner/Admin users and canonical auth emails", () => {
    const enqueue = functionBody(
      "public",
      "enqueue_subscription_lifecycle_reminders_server",
    );
    expect(enqueue).toContain("member.role in ('owner', 'admin')");
    expect(enqueue).toContain("join auth.users auth_user");
    expect(enqueue).toContain("lower(btrim(auth_user.email))");
    expect(enqueue).not.toContain("profiles.email");
    expect(enqueue).not.toContain("owner_user_id");
    expect(enqueue).not.toMatch(/member\.role in \([^)]*(?:staff|trainer|student)/);
  });

  test("deduplicates one email per normalized address and one in-app notice per user", () => {
    const sql = executableSql();
    const enqueue = functionBody(
      "public",
      "enqueue_subscription_lifecycle_reminders_server",
    );
    expect(sql).toContain("subscription_lifecycle_reminder_email_unique");
    expect(sql).toContain("subscription_lifecycle_reminder_user_unique");
    expect(sql).toContain("subscription_lifecycle_reminder_outbox_unique");
    expect(sql).toContain("subscription_lifecycle_reminder_notification_unique");
    expect(enqueue).toContain("select distinct lower(btrim(auth_user.email))");
    expect(enqueue).toContain("pg_advisory_xact_lock");
    expect(enqueue).toContain("on conflict do nothing");
    expect(enqueue).toContain("coachfort_internal.enqueue_transactional_email");
    expect(enqueue).toContain("'subscription_notice'");
    expect(enqueue).not.toContain("notification_preferences");
    expect(enqueue).not.toContain("lifecycle_boundary_at::text");
    expect(enqueue).toContain(
      "lifecycle_boundary_at at time zone 'utc'",
    );
    expect(enqueue).toContain('yyyy-mm-dd"t"hh24:mi:ss.us"z"');
  });

  test("filters fully satisfied historical candidates before applying p_limit", () => {
    const enqueue = functionBody(
      "public",
      "enqueue_subscription_lifecycle_reminders_server",
    );
    const cursor = enqueue.match(
      /from coachfort_internal\.subscription_lifecycle_reminder_candidates\(now\(\)\)\s+candidate([\s\S]*?)limit p_limit/,
    )?.[1];
    expect(cursor).toBeTruthy();
    expect(cursor).toContain("where exists (");
    expect(cursor).toContain("member.role in ('owner', 'admin')");
    expect(cursor).toContain("delivery.channel = 'in_app'");
    expect(cursor).toContain("delivery.recipient_user_id = member.user_id");
    expect(cursor).toContain("delivery.channel = 'email'");
    expect(cursor).toContain(
      "delivery.recipient_email = lower(btrim(auth_user.email))",
    );
    expect(cursor).toContain("order by candidate.intended_on");
    expect(enqueue.indexOf("where exists ("))
      .toBeLessThan(enqueue.indexOf("limit p_limit"));
    expect(enqueue.indexOf("order by candidate.intended_on"))
      .toBeLessThan(enqueue.indexOf("limit p_limit"));
  });

  test("does not replay satisfied email when only in-app delivery is missing", () => {
    const enqueue = functionBody(
      "public",
      "enqueue_subscription_lifecycle_reminders_server",
    );
    const emailCursor = enqueue.match(
      /for v_email in([\s\S]*?)loop\s+v_event_key :=/,
    )?.[1];
    expect(emailCursor).toBeTruthy();
    expect(emailCursor).toContain(
      "select distinct lower(btrim(auth_user.email)) as recipient_email",
    );
    expect(emailCursor).toContain("and not exists (");
    expect(emailCursor).toContain("delivery.tenant_id = v_candidate.tenant_id");
    expect(emailCursor).toContain(
      "delivery.assignment_id = v_candidate.assignment_id",
    );
    expect(emailCursor).toContain("delivery.event_type = v_candidate.event_type");
    expect(emailCursor).toContain("delivery.channel = 'email'");
    expect(emailCursor).toContain(
      "delivery.recipient_email = lower(btrim(auth_user.email))",
    );
    expect(emailCursor).not.toContain("enqueue_transactional_email");
    expect(enqueue.indexOf("for v_email in"))
      .toBeLessThan(enqueue.indexOf("enqueue_transactional_email("));
  });

  test("revalidates current Owner/Admin email authority immediately before send", () => {
    const current = functionBody(
      "coachfort_internal",
      "subscription_lifecycle_reminder_delivery_is_current",
    );
    expect(current).toContain("join auth.users auth_user");
    expect(current).toContain("member.role in ('owner', 'admin')");
    expect(current).toContain(
      "lower(btrim(auth_user.email)) = v_delivery.recipient_email",
    );
    expect(current).not.toContain("profiles.email");
    expect(current).not.toContain("owner_user_id");
    expect(current).toContain("if not exists (");
    expect(current).toContain("return false");
    expect(current).toContain("tenant_subscription_effective_lifecycle");
    expect(current).toContain("assignment.is_current");
  });

  test("invalidates queued grace-start email in the grace-ending window", () => {
    const current = functionBody(
      "coachfort_internal",
      "subscription_lifecycle_reminder_delivery_is_current",
    );
    expect(current).toMatch(
      /when 'grace_started' then[\s\S]*?effective_state'\s*=\s*'grace'[\s\S]*?and not\s*\([\s\S]*?now\(\)\s*<[\s\S]*?grace_period_ends_at[\s\S]*?\(now\(\) at time zone 'utc'\)::date\s*>=[\s\S]*?::date\s*-\s*2/,
    );
    expect(current).toMatch(
      /when 'grace_ending' then[\s\S]*?effective_state'\s*=\s*'grace'[\s\S]*?grace_period_ends_at[\s\S]*?now\(\)\s*<\s*v_delivery\.lifecycle_boundary_at/,
    );
    expect(current).toContain("tenant_subscription_effective_lifecycle");
    expect(current).toContain(
      "lower(btrim(auth_user.email)) = v_delivery.recipient_email",
    );
  });

  test("fails closed on shared email, notification, and lifecycle drift", () => {
    const pre = verificationBlock("PRE-APPLY");
    const apply = executableSql();
    const post = verificationBlock("POST-APPLY");
    for (const block of [pre, apply]) {
      expect(block).toContain("transactional_email_outbox_event_key_unique");
      expect(block).toContain("subscription_notice");
      expect(block).toContain("notification_lifecycle_access_allowed");
      expect(block).toContain("tenant_subscription_effective_lifecycle");
      expect(block).toContain("coach.welcome");
      expect(block).toContain("coach.workspace_ready");
    }
    expect(pre).toContain("exact_two_template_baseline");
    expect(pre).toContain("exact_two_template_branches");
    expect(pre).toContain("browser_writes_absent");
    expect(apply).toContain("v_template_constraint_keys");
    expect(apply).toContain("v_payload_template_keys");
    expect(apply).toContain("has_table_privilege");
    expect(post).toContain("exact_three_template_contract");
    expect(post).toContain("exact_three_template_branches");
    expect(post).toContain("expected_security_definer");
    expect(post).toContain("actionable_before_limit");
    expect(post).toContain("satisfied_email_filtered");
    expect(post).toContain("current_recipient_required");
    expect(post).toContain("grace_overlap_suppressed");
    expect(post).toContain("grace_send_overlap_suppressed");
    expect(post).toContain(
      "and expected_security_definer from security_state",
    );
    expect(post).toContain("payload_validator_state");
    expect(post).toContain("security_invoker");
    expect(post).toContain("execute_private");
  });

  test("extends the only email outbox without creating another queue", () => {
    const sql = executableSql();
    expect(sql).toContain(
      "alter table coachfort_internal.transactional_email_outbox",
    );
    expect(sql).toContain("'billing.subscription_lifecycle'");
    expect(sql.match(/create table\s+[a-z0-9_.]+/g)).toEqual([
      "create table coachfort_internal.subscription_lifecycle_reminder_deliveries",
    ]);
  });

  test("renders one strict, customer-safe lifecycle template with UTC date-only copy", () => {
    const rendered = renderTransactionalEmailTemplate(
      "billing.subscription_lifecycle",
      {
        deadlineDate: "2026-09-04",
        event: "renewal_due_soon",
        planName: "Growth",
        subscriptionUrl: "https://coachfort.com/app/subscription",
        supportUrl: "https://coachfort.com/support",
        workspaceName: "Example Coaching",
      },
    );
    expect(rendered.key).toBe("billing.subscription_lifecycle");
    expect(rendered.text).toContain("4 Sep 2026");
    expect(rendered.text).toContain("Review subscription");
    expect(rendered.text).not.toMatch(
      /canonical assignment|operational_allowed|grace_period_elapsed|entitlement|payment_forced|gateway_required|pay now|renew now|razorpay|instant activation/i,
    );
    expect(templateRegistry).toContain("buildSubscriptionLifecycleEmail");
    expect(templateRegistry).not.toContain("Asia/Kolkata");
    expect(() =>
      buildSubscriptionLifecycleEmail({
        deadlineDate: "2026-02-30",
        event: "trial_ending",
        subscriptionUrl: "https://coachfort.com/app/subscription",
        supportUrl: "https://coachfort.com/support",
        workspaceName: "Example Coaching",
      }),
    ).toThrow(/invalid/i);
    const enqueue = functionBody(
      "public",
      "enqueue_subscription_lifecycle_reminders_server",
    );
    expect(enqueue).toContain("v_deadline_display");
    expect(enqueue).toContain("'jan', 'feb', 'mar'");
    expect(enqueue).toContain("'deadlinedate', v_deadline_date");
    expect(enqueue).toContain(
      "'your coachfort trial ends on ' || v_deadline_display",
    );
    expect(enqueue).not.toContain(
      "'your coachfort trial ends on ' || v_deadline_date",
    );
  });

  test("keeps hard suppression in the existing worker after lifecycle validation", () => {
    expect(worker).toContain("isSuppressed(claim.recipient_email)");
    expect(worker).toContain("transactional_email_suppression_state_server");
    expect(worker).toContain("sendCoachFortTransactionalEmail");
    expect(worker).toContain("idempotencyKey: claim.event_key");
  });

  test("protects the route, supports dry-run, and returns aggregate data only", async () => {
    const secret = "c".repeat(48);
    const process = async ({ dryRun }: { dryRun: boolean }) => ({
      dryRun,
      eligibleEvents: 2,
      emailDeliveriesCreated: 0,
      inAppDeliveriesCreated: 0,
      recipientUsers: 3,
      replayedEmailDeliveries: 0,
      replayedInAppDeliveries: 0,
      uniqueEmailRecipients: 2,
    });
    const denied = await handleSubscriptionLifecycleReminderRequest(
      new Request("https://coachfort.com/api/internal/subscription-lifecycle/reminders"),
      { configuredSecret: secret, process },
    );
    expect(denied.status).toBe(404);

    const allowed = await handleSubscriptionLifecycleReminderRequest(
      new Request(
        "https://coachfort.com/api/internal/subscription-lifecycle/reminders?dryRun=true",
        { headers: { authorization: `Bearer ${secret}` } },
      ),
      { configuredSecret: secret, process },
    );
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body).toEqual({
      dryRun: true,
      eligibleEvents: 2,
      emailDeliveriesCreated: 0,
      inAppDeliveriesCreated: 0,
      recipientUsers: 3,
      replayedEmailDeliveries: 0,
      replayedInAppDeliveries: 0,
      uniqueEmailRecipients: 2,
    });
    expect(JSON.stringify(body)).not.toMatch(/@|recipient_email|reason|secret/i);
    expect(reminderServer).toContain("process.env.CRON_SECRET");
    expect(reminderServer).toContain("hasMatchingBearerSecret");
    expect(reminderServer).toContain('return Response.json({ message: "Not found." }');
  });

  test("grants only service orchestration and keeps the ledger browser-private", () => {
    const sql = executableSql();
    expect(sql).toMatch(
      /grant execute on function\s+public\.enqueue_subscription_lifecycle_reminders_server\(boolean,integer\)\s+to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function\s+public\.subscription_lifecycle_reminder_delivery_is_current_server\(uuid\)\s+to service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function (?:public|coachfort_internal)\.[\s\S]*?to (?:anon|authenticated)/,
    );
    expect(sql).toMatch(
      /revoke all on table\s+coachfort_internal\.subscription_lifecycle_reminder_deliveries\s+from public, anon, authenticated, service_role/,
    );
  });

  test("performs communication writes only and uses the approved production schedules", () => {
    const sql = executableSql();
    expect(sql).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:tenant_subscription_assignments|tenant_payment_orders|tenant_payment_attempts|platform_invoices|platform_billing_receipts)/,
    );
    expect(sql).toContain("insert into public.notifications");
    expect(existsSync(join(root, "vercel.json"))).toBe(true);
    const vercelConfigSource = read("vercel.json");
    expect(JSON.parse(vercelConfigSource)).toEqual({
      crons: [
        {
          path: "/api/internal/subscription-lifecycle/reminders",
          schedule: "0 6 * * *",
        },
        {
          path: "/api/internal/transactional-email/drain",
          schedule: "*/5 * * * *",
        },
      ],
    });
    expect(vercelConfigSource).not.toMatch(
      /\?|dryRun|tenantId|[?&]event=|CRON_SECRET|COACHFORT_EMAIL_WORKER_SECRET|authorization|bearer/i,
    );
    expect(route).not.toContain("drainTransactionalEmailOutbox");
    for (const block of [
      verificationBlock("PRE-APPLY"),
      verificationBlock("POST-APPLY"),
    ]) {
      for (const count of [
        "subscription_assignments",
        "current_subscription_assignments",
        "payment_orders",
        "notifications",
        "email_outbox",
      ]) {
        expect(block).toContain(`'${count}'`);
      }
    }
  });
});
