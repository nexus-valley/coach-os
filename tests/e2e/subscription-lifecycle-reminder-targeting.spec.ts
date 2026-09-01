import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  handleSubscriptionLifecycleReminderRequest,
  type SubscriptionLifecycleReminderTarget,
} from "../../src/lib/server/subscriptionLifecycleReminders";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g3b_subscription_lifecycle_reminder_targeting.sql",
);
const server = read("src/lib/server/subscriptionLifecycleReminders.ts");
const controlledTenantId = "d417104c-2009-4334-98de-e6d09c26aae3";
const otherTenantId = "29a33701-82ed-4c7f-8042-0a1af8296ce5";

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

function orchestrationBody() {
  const match = executableSql().match(
    /create function public\.enqueue_subscription_lifecycle_reminders_server\([\s\S]*?\n\$\$;/,
  );
  expect(match, "Expected targeted orchestration function").not.toBeNull();
  return match?.[0] ?? "";
}

function summary(dryRun: boolean, eligibleEvents: number) {
  return {
    dryRun,
    eligibleEvents,
    emailDeliveriesCreated: 0,
    inAppDeliveriesCreated: 0,
    recipientUsers: eligibleEvents,
    replayedEmailDeliveries: 0,
    replayedInAppDeliveries: 0,
    uniqueEmailRecipients: eligibleEvents,
  };
}

function authorizedRequest(query: string, secret: string) {
  return new Request(
    `https://coachfort.com/api/internal/subscription-lifecycle/reminders${query}`,
    { headers: { authorization: `Bearer ${secret}` } },
  );
}

test.describe("UX-8G3B controlled reminder targeting", () => {
  test("keeps PRE and POST read-only around one fail-closed transaction", () => {
    for (const label of ["PRE-APPLY", "POST-APPLY"] as const) {
      expect(verificationBlock(label)).not.toMatch(
        /^\s*(insert\s+into|update\s+(?:public\.|coachfort_internal\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index)|drop\s+(?:table|function)|truncate|merge\s+into)\b/m,
      );
    }
    expect(executableSql()).not.toContain("cascade");
    expect(executableSql()).toContain("notify pgrst, 'reload schema'");
    expect(verificationBlock("PRE-APPLY")).toContain("ready_for_apply");
    expect(verificationBlock("POST-APPLY")).toContain("security_gate");
  });

  test("validates the target pair and exactly six approved events in the database", () => {
    const body = orchestrationBody();
    expect(body).toContain(
      "if (p_target_tenant_id is null) <> (p_target_event_type is null)",
    );
    const validation = body.match(
      /p_target_event_type not in \(([\s\S]*?)\) then/,
    )?.[1] ?? "";
    expect(validation.match(/'[a-z_]+'/g)?.sort()).toEqual([
      "'grace_ending'",
      "'grace_started'",
      "'renewal_due_soon'",
      "'subscription_expired'",
      "'trial_ending'",
      "'trial_expired'",
    ]);
    expect(body).toContain("using errcode = '22023'");
  });

  test("filters the canonical actionable candidate before limit or delivery writes", () => {
    const body = orchestrationBody();
    const tenantFilter = body.indexOf(
      "candidate.tenant_id = p_target_tenant_id",
    );
    const eventFilter = body.indexOf(
      "candidate.event_type = p_target_event_type",
    );
    expect(body).toContain(
      "subscription_lifecycle_reminder_candidates(now())",
    );
    expect(tenantFilter).toBeGreaterThan(-1);
    expect(eventFilter).toBeGreaterThan(-1);
    for (const laterBoundary of [
      "and exists (",
      "limit p_limit",
      "enqueue_transactional_email(",
      "insert into public.notifications",
    ]) {
      expect(tenantFilter).toBeLessThan(body.indexOf(laterBoundary));
      expect(eventFilter).toBeLessThan(body.indexOf(laterBoundary));
    }
    expect(body).toContain("delivery.recipient_user_id = member.user_id");
    expect(body).toContain(
      "delivery.recipient_email = lower(btrim(auth_user.email))",
    );
  });

  test("preserves the unfiltered scheduler behavior when no target is supplied", async () => {
    const secret = "g".repeat(48);
    let receivedTarget: SubscriptionLifecycleReminderTarget | null | undefined;
    const response = await handleSubscriptionLifecycleReminderRequest(
      authorizedRequest("?dryRun=true", secret),
      {
        configuredSecret: secret,
        process: async ({ dryRun, target }) => {
          receivedTarget = target;
          return summary(dryRun, 2);
        },
      },
    );
    expect(response.status).toBe(200);
    expect(receivedTarget).toBeNull();
    expect(await response.json()).toEqual(summary(true, 2));
    expect(orchestrationBody()).toContain(
      "p_target_tenant_id uuid default null",
    );
    expect(orchestrationBody()).toContain(
      "p_target_event_type text default null",
    );
  });

  test("targets Workspace Email Smoke in dry-run without exposing its identity", async () => {
    const secret = "h".repeat(48);
    let receivedTarget: SubscriptionLifecycleReminderTarget | null = null;
    const response = await handleSubscriptionLifecycleReminderRequest(
      authorizedRequest(
        `?dryRun=true&tenantId=${controlledTenantId}&event=grace_ending`,
        secret,
      ),
      {
        configuredSecret: secret,
        process: async ({ dryRun, target }) => {
          receivedTarget = target;
          return summary(dryRun, 1);
        },
      },
    );
    expect(response.status).toBe(200);
    expect(receivedTarget).toEqual({
      tenantId: controlledTenantId,
      event: "grace_ending",
    });
    const body = await response.json();
    expect(body).toEqual(summary(true, 1));
    expect(JSON.stringify(body)).not.toContain(controlledTenantId);
    expect(JSON.stringify(body)).not.toMatch(
      /tenantId|eventType|recipientEmail|recipientUserId|@/i,
    );
  });

  test("valid but nonmatching tenant or event returns aggregate zero", async () => {
    const secret = "i".repeat(48);
    for (const query of [
      `?dryRun=true&tenantId=${otherTenantId}&event=grace_ending`,
      `?dryRun=true&tenantId=${controlledTenantId}&event=subscription_expired`,
    ]) {
      const response = await handleSubscriptionLifecycleReminderRequest(
        authorizedRequest(query, secret),
        {
          configuredSecret: secret,
          process: async ({ dryRun }) => summary(dryRun, 0),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(summary(true, 0));
    }
  });

  test("rejects incomplete, duplicate, malformed, and unapproved targets", async () => {
    const secret = "j".repeat(48);
    let calls = 0;
    const process = async ({ dryRun }: { dryRun: boolean }) => {
      calls += 1;
      return summary(dryRun, 0);
    };
    for (const query of [
      `?tenantId=${controlledTenantId}`,
      "?event=grace_ending",
      "?tenantId=not-a-uuid&event=grace_ending",
      `?tenantId=${controlledTenantId}&event=made_up_event`,
      `?tenantId=${controlledTenantId}&tenantId=${otherTenantId}&event=grace_ending`,
    ]) {
      const response = await handleSubscriptionLifecycleReminderRequest(
        authorizedRequest(query, secret),
        { configuredSecret: secret, process },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        message: "Invalid reminder target.",
      });
    }
    expect(calls).toBe(0);
  });

  test("keeps unauthorized target probes on the sanitized 404 boundary", async () => {
    const secret = "k".repeat(48);
    const response = await handleSubscriptionLifecycleReminderRequest(
      new Request(
        `https://coachfort.com/api/internal/subscription-lifecycle/reminders?tenantId=bad&event=bad`,
      ),
      {
        configuredSecret: secret,
        process: async ({ dryRun }) => summary(dryRun, 0),
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Not found." });
  });

  test("uses one service-only RPC and preserves G3A delivery safeguards", () => {
    const sql = executableSql();
    const body = orchestrationBody();
    expect(sql).toContain(
      "drop function public.enqueue_subscription_lifecycle_reminders_server(\n  boolean, integer\n)",
    );
    expect(sql).toMatch(
      /grant execute on function\s+public\.enqueue_subscription_lifecycle_reminders_server\(\s*boolean, integer, uuid, text\s*\)\s+to service_role/,
    );
    expect(sql).not.toMatch(
      /grant execute on function[\s\S]*?to (?:anon|authenticated)/,
    );
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body).toContain("on conflict do nothing");
    expect(body).toContain("member.role in ('owner', 'admin')");
    expect(body).toContain("join auth.users auth_user");
    expect(body).not.toContain("profiles.email");
    expect(body).not.toContain("owner_user_id");
    expect(server).toContain("const rpcArguments = input.target");
    expect(server).toContain("p_target_tenant_id: input.target.tenantId");
    expect(server).toContain("p_target_event_type: input.target.event");
  });
});
