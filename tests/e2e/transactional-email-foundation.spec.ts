import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Webhook } from "svix";

import {
  CoachFortEmailDeliveryError,
  sendCoachFortTransactionalEmail,
  sendOtpEmail,
} from "../../src/lib/server/email";
import {
  getTransactionalEmailRetryDelaySeconds,
  shouldRetryTransactionalEmail,
  transactionalEmailMaxAttempts,
} from "../../src/lib/server/transactionalEmailPolicy";
import {
  renderTransactionalEmailTemplate,
  transactionalEmailTemplateKeys,
} from "../../src/lib/server/transactionalEmailTemplates";
import { verifyResendEmailWebhook } from "../../src/lib/server/resendWebhook";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8b_transactional_email_delivery_foundation.sql",
);
const sender = read("src/lib/server/email.ts");
const worker = read("src/lib/server/transactionalEmail.ts");
const webhookRoute = read("app/api/webhooks/resend/route.ts");
const drainRoute = read(
  "app/api/internal/transactional-email/drain/route.ts",
);

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
      `create function ${schema}\\.${name}\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected function ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8B transactional email delivery foundation", () => {
  test("keeps PRE read-only and APPLY transaction-scoped", () => {
    const pre = verificationBlock("PRE-APPLY");
    expect(pre).not.toMatch(
      /\b(insert\s+into|update\s+(?:public\.|coachfort_internal\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index)|drop\s+(?:table|function)|truncate\s+(?:table\s+)?|merge\s+into)\b/,
    );
    expect(executableSql()).toContain("notify pgrst, 'reload schema'");
    expect(executableSql()).not.toContain("cascade");
  });

  test("creates a private minimal outbox without rendered bodies", () => {
    const sql = executableSql();
    expect(sql).toContain(
      "create table coachfort_internal.transactional_email_outbox",
    );
    for (const column of [
      "event_key",
      "tenant_id",
      "recipient_email",
      "template_key",
      "template_payload",
      "attempt_count",
      "next_attempt_at",
      "claim_token",
      "lease_expires_at",
      "provider_message_id",
      "queued_at",
      "sent_at",
      "delivered_at",
      "failed_at",
      "suppressed_at",
      "last_error_class",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(/\brendered_(html|text)\b|\bhtml_body\b|\btext_body\b/);
  });

  test("enforces logical event idempotency and rejects conflicting reuse", () => {
    const enqueue = functionBody(
      "coachfort_internal",
      "enqueue_transactional_email",
    );
    expect(executableSql()).toContain(
      "constraint transactional_email_outbox_event_key_unique unique (event_key)",
    );
    expect(enqueue).toContain("on conflict (event_key) do nothing");
    expect(enqueue).toContain("event key conflicts with existing content");
    expect(enqueue).toContain("is distinct from p_template_payload");
    expect(enqueue).toContain("is distinct from v_recipient");
  });

  test("fails APPLY closed on any pre-existing internal helper overload", () => {
    const sql = executableSql();
    expect(sql).toContain(
      "where n.nspname = 'coachfort_internal' and p.proname in (",
    );
    for (const name of [
      "transactional_email_normalize_recipient",
      "transactional_email_payload_valid",
      "transactional_email_immutable_identity",
      "transactional_email_suppression_updated_at",
      "enqueue_transactional_email",
    ]) {
      expect(sql).toContain(`'${name}'`);
    }
    expect(sql).toContain(
      "raise exception 'conflicting ux-8b email foundation objects already exist.'",
    );

    const post = verificationBlock("POST-APPLY");
    expect(post).toContain("public_rpc_identity_state");
    expect(post).toContain("expected_identity_count");
    expect(post).toContain("unexpected_overloads");
    expect(post).toContain("count(*) = 5");
  });

  test("normalizes recipients and validates a controlled template registry", () => {
    const normalize = functionBody(
      "coachfort_internal",
      "transactional_email_normalize_recipient",
    );
    const payload = functionBody(
      "coachfort_internal",
      "transactional_email_payload_valid",
    );
    expect(normalize).toContain("lower(btrim(p_email))");
    expect(payload).toContain("coach.welcome");
    expect(payload).toContain("coach.workspace_ready");
    expect(payload).toContain("else false");
    expect(payload).toContain("select coalesce(case");
    expect(payload).toContain("p_payload is null");
    expect(payload).toContain("octet_length(p_payload::text) > 8192");
    expect(payload).toContain("jsonb_typeof(p_payload->'appurl') = 'string'");
    expect(payload).toContain("btrim(p_payload->>'appurl') ~*");
    expect(
      functionBody("coachfort_internal", "enqueue_transactional_email"),
    ).toContain(") is not true then");
    expect(transactionalEmailTemplateKeys).toEqual([
      "coach.welcome",
      "coach.workspace_ready",
    ]);
    expect(() => renderTransactionalEmailTemplate("arbitrary", {})).toThrow(
      /unsupported/i,
    );
  });

  test("renders existing welcome and workspace-ready templates", () => {
    expect(
      renderTransactionalEmailTemplate("coach.welcome", {
        coachName: "Coach",
        tenantName: "Workspace",
      }).key,
    ).toBe("coach.welcome");
    expect(
      renderTransactionalEmailTemplate("coach.workspace_ready", {
        appUrl: "https://coachfort.com/app",
        tenantName: "Workspace",
      }).key,
    ).toBe("coach.workspace_ready");
  });

  test("fails closed for null, malformed, invalid URL, oversized, and unsupported payloads", () => {
    for (const payload of [null, {}, { appUrl: null }, { appUrl: 42 }]) {
      expect(() =>
        renderTransactionalEmailTemplate("coach.workspace_ready", payload),
      ).toThrow();
    }
    expect(() =>
      renderTransactionalEmailTemplate("coach.workspace_ready", {
        appUrl: "not-a-url",
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      renderTransactionalEmailTemplate("coach.welcome", {
        coachName: "x".repeat(9_000),
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      renderTransactionalEmailTemplate("unsupported.template", {}),
    ).toThrow(/unsupported/i);
  });

  test("claims bounded work with SKIP LOCKED and finite recoverable leases", () => {
    const claim = functionBody(
      "public",
      "claim_transactional_email_batch_server",
    );
    expect(claim).toContain("for update skip locked");
    expect(claim).toContain("p_batch_size not between 1 and 25");
    expect(claim).toContain("p_lease_seconds not between 30 and 900");
    expect(claim).toContain("lease_expires_at <= now()");
    expect(claim).toContain("order by o.next_attempt_at, o.queued_at, o.id");
    expect(claim).toContain("claim_lease_expired");
    expect(claim).toContain("o.attempt_count >= 5");
    expect(claim).toContain("status = 'failed'");
  });

  test("uses deterministic bounded retry with terminal exhaustion", () => {
    const finalize = functionBody(
      "public",
      "finalize_transactional_email_attempt_server",
    );
    expect(transactionalEmailMaxAttempts).toBe(5);
    expect([1, 2, 3, 4].map(getTransactionalEmailRetryDelaySeconds)).toEqual([
      60, 300, 1_800, 7_200,
    ]);
    expect(() => getTransactionalEmailRetryDelaySeconds(5)).toThrow(RangeError);
    expect(shouldRetryTransactionalEmail({ attemptNumber: 4, retryable: true })).toBe(
      true,
    );
    expect(shouldRetryTransactionalEmail({ attemptNumber: 5, retryable: true })).toBe(
      false,
    );
    expect(shouldRetryTransactionalEmail({ attemptNumber: 1, retryable: false })).toBe(
      false,
    );
    expect(finalize).toContain("v_row.attempt_count < 5");
    expect(finalize).toContain("v_status := 'failed'");
    expect(finalize).not.toContain("interval '12 hours'");
  });

  test("persists per-attempt acceptance and failure evidence", () => {
    const sql = executableSql();
    expect(sql).toContain(
      "create table coachfort_internal.transactional_email_attempts",
    );
    expect(sql).toContain(
      "constraint transactional_email_attempts_number_unique unique (outbox_id, attempt_number)",
    );
    expect(sql).toContain("provider_message_id text");
    expect(sql).toContain("retry_scheduled_at timestamptz");
    expect(sql).toContain("'lease_expired'");
    expect(sql).toContain("'provider_accepted'");
  });

  test("suppresses before delivery and only for reviewed terminal reasons", () => {
    const enqueue = functionBody(
      "coachfort_internal",
      "enqueue_transactional_email",
    );
    const claim = functionBody(
      "public",
      "claim_transactional_email_batch_server",
    );
    expect(enqueue).toContain("transactional_email_suppressions");
    expect(claim).toContain("transactional_email_suppressions");
    expect(worker).toContain("if (await isSuppressed(claim.recipient_email))");
    expect(executableSql()).toContain(
      "reason in ('complaint', 'hard_bounce', 'provider_suppressed')",
    );
    expect(executableSql()).toContain(
      "transactional_email_provider_events_bounce_type_check",
    );
    expect(executableSql()).not.toContain("'delivery_delayed' as reason");
  });

  test("keeps suppression reason and source evidence under one precedence decision", () => {
    type Reason = "complaint" | "hard_bounce" | "provider_suppressed";
    const rank: Record<Reason, number> = {
      complaint: 3,
      hard_bounce: 2,
      provider_suppressed: 1,
    };
    const winner = (existing: Reason, incoming: Reason) =>
      rank[existing] >= rank[incoming] ? "existing" : "incoming";

    expect([
      winner("complaint", "provider_suppressed"),
      winner("complaint", "hard_bounce"),
      winner("hard_bounce", "provider_suppressed"),
      winner("provider_suppressed", "hard_bounce"),
      winner("hard_bounce", "complaint"),
      winner("complaint", "complaint"),
    ]).toEqual([
      "existing",
      "existing",
      "existing",
      "incoming",
      "incoming",
      "existing",
    ]);

    const record = functionBody(
      "public",
      "record_transactional_email_provider_event_server",
    );
    expect(
      record.match(
        /transactional_email_suppressions\.reason = excluded\.reason/g,
      ),
    ).toHaveLength(4);
    for (const field of [
      "reason",
      "source_event_id",
      "provider_message_id",
      "suppressed_at",
    ]) {
      expect(record).toContain(`${field} = case`);
      expect(record).toContain(
        `then transactional_email_suppressions.${field}`,
      );
      expect(record).toContain(`else excluded.${field}`);
    }
    expect(record).toContain("active = true, lifted_at = null");
  });

  test("records verified provider events idempotently and handles unknown messages safely", () => {
    const record = functionBody(
      "public",
      "record_transactional_email_provider_event_server",
    );
    expect(record).toContain(
      "on conflict (provider, provider_event_id) do nothing",
    );
    expect(record).toContain("processing_status = 'unmatched'");
    expect(record).toContain("where o.provider_message_id");
    expect(record).not.toContain("where o.recipient_email");
    expect(record).toContain(
      "p_event_type = 'email.bounced' and p_bounce_type = 'permanent'",
    );
    expect(record).toContain("v_reason := 'hard_bounce'");
    expect(record).toContain("v_reason := 'complaint'");
  });

  test("keeps delivery lifecycle monotonic for out-of-order provider events", () => {
    const record = functionBody(
      "public",
      "record_transactional_email_provider_event_server",
    );
    expect(record).toContain(
      "v_outbox.status in ('bounced', 'complained', 'suppressed')",
    );
    expect(record).toContain(
      "p_event_type = 'email.failed' and v_outbox.status <> 'delivered'",
    );
    expect(record).toContain(
      "p_event_type in ('email.delivery_delayed', 'email.sent') then 'ignored'",
    );
    expect(record.indexOf("v_outbox.status in ('bounced', 'complained', 'suppressed')"))
      .toBeLessThan(record.indexOf("elsif p_event_type = 'email.delivered'"));
  });

  test("uses Resend message ids and provider idempotency through the central sender", () => {
    expect(sender).toContain('"Idempotency-Key": input.idempotencyKey');
    expect(sender).toContain("const resendTimeoutMs = 10_000");
    expect(sender).toContain("providerMessageId");
    expect(sender).toContain('fetch("https://api.resend.com/emails"');
    expect(worker).toContain("sendCoachFortTransactionalEmail");
    expect(worker).toContain("idempotencyKey: claim.event_key");
    expect(worker).toContain("p_lease_seconds: 300");

    const directResendCallers = [
      "src/lib/server/email.ts",
      "src/lib/server/transactionalEmail.ts",
      "app/api/internal/transactional-email/drain/route.ts",
      "app/api/webhooks/resend/route.ts",
    ].filter((path) => read(path).includes("https://api.resend.com/emails"));
    expect(directResendCallers).toEqual(["src/lib/server/email.ts"]);
  });

  test("verifies an untouched Resend payload with Svix and rejects tampering", () => {
    const secret = `whsec_${Buffer.from("coachfort-webhook-test-secret-32b").toString("base64")}`;
    const rawBody = JSON.stringify({
      created_at: new Date().toISOString(),
      data: { email_id: "resend-message-id" },
      type: "email.delivered",
    });
    const svixId = "msg_test_delivery_event";
    const timestamp = new Date();
    const signature = new Webhook(secret).sign(svixId, timestamp, rawBody);

    expect(
      verifyResendEmailWebhook({
        rawBody,
        signature,
        signingSecret: secret,
        svixId,
        svixTimestamp: String(Math.floor(timestamp.getTime() / 1000)),
      }),
    ).toMatchObject({
      bounceType: null,
      eventType: "email.delivered",
      providerMessageId: "resend-message-id",
    });
    expect(() =>
      verifyResendEmailWebhook({
        rawBody: `${rawBody} `,
        signature,
        signingSecret: secret,
        svixId,
        svixTimestamp: String(Math.floor(timestamp.getTime() / 1000)),
      }),
    ).toThrow();
  });

  test("classifies only permanent Resend bounces for suppression", () => {
    const secret = `whsec_${Buffer.from("coachfort-bounce-test-secret-32b").toString("base64")}`;
    const timestamp = new Date();

    for (const [providerType, expected] of [
      ["Permanent", "permanent"],
      ["Transient", "transient"],
      ["Temporary", "transient"],
      ["Undetermined", "undetermined"],
      ["FutureType", "undetermined"],
    ] as const) {
      const rawBody = JSON.stringify({
        created_at: timestamp.toISOString(),
        data: {
          bounce: { type: providerType },
          email_id: `resend-${expected}-${providerType}`,
        },
        type: "email.bounced",
      });
      const svixId = `msg_${providerType.toLowerCase()}`;
      const signature = new Webhook(secret).sign(svixId, timestamp, rawBody);

      expect(
        verifyResendEmailWebhook({
          rawBody,
          signature,
          signingSecret: secret,
          svixId,
          svixTimestamp: String(Math.floor(timestamp.getTime() / 1000)),
        }),
      ).toMatchObject({ bounceType: expected, eventType: "email.bounced" });
    }

    const record = functionBody(
      "public",
      "record_transactional_email_provider_event_server",
    );
    expect(record).toContain(
      "p_bounce_type not in ('permanent', 'transient', 'undetermined')",
    );
    expect(record).not.toMatch(
      /p_event_type = 'email\.bounced' then[\s\S]{0,100}v_reason := 'hard_bounce'/,
    );
    expect(record).toContain(
      "p_event_type = 'email.complained' then\n    v_reason := 'complaint'",
    );
    expect(record).toContain(
      "p_event_type = 'email.suppressed' then\n    v_reason := 'provider_suppressed'",
    );
    expect(record).toContain(
      "provider_event_id, provider_message_id, event_type, bounce_type, occurred_at",
    );
  });

  test("keeps webhook signature and duplicate handling on authoritative boundaries", () => {
    expect(webhookRoute).toContain("await request.text()");
    expect(webhookRoute).toContain("verifyResendEmailWebhook");
    expect(webhookRoute).toContain("svix-id");
    expect(webhookRoute).toContain(
      'rpc(\n      "record_transactional_email_provider_event_server"',
    );
    expect(webhookRoute).not.toContain("recipient_email");
    expect(webhookRoute).not.toContain("RESEND_API_KEY");
    expect(webhookRoute).toContain("p_bounce_type: event.bounceType");
  });

  test("protects the drain route independently from browser roles", () => {
    expect(drainRoute).toContain("COACHFORT_EMAIL_WORKER_SECRET");
    expect(drainRoute).toContain("timingSafeEqual");
    expect(drainRoute).toContain('return Response.json({ message: "Not found." }');
    expect(drainRoute).not.toMatch(/owner|admin|authenticated/i);
    expect(drainRoute).toContain('export const runtime = "nodejs"');
  });

  test("revokes all table access and grants exact worker RPC execution", () => {
    const sql = executableSql();
    for (const table of [
      "transactional_email_outbox",
      "transactional_email_attempts",
      "transactional_email_provider_events",
      "transactional_email_suppressions",
    ]) {
      expect(sql).toContain(
        `revoke all on table coachfort_internal.${table} from public, anon, authenticated, service_role`,
      );
      expect(sql).toContain(
        `alter table coachfort_internal.${table} enable row level security`,
      );
    }
    expect(sql).toContain(
      "grant execute on function public.claim_transactional_email_batch_server(text,integer,integer) to service_role",
    );
    expect(sql).not.toContain(
      "grant execute on function public.claim_transactional_email_batch_server(text,integer,integer) to authenticated",
    );
  });

  test("keeps the internal enqueue primitive private and tenant-validating", () => {
    const enqueue = functionBody(
      "coachfort_internal",
      "enqueue_transactional_email",
    );
    expect(enqueue).toContain("from public.tenants t where t.id = p_tenant_id");
    expect(enqueue).toContain("transactional email tenant is required for this template");
    expect(executableSql()).toContain(
      "revoke all on function coachfort_internal.enqueue_transactional_email(text,uuid,text,text,jsonb) from public, anon, authenticated, service_role",
    );
    expect(executableSql()).not.toContain(
      "grant execute on function coachfort_internal.enqueue_transactional_email",
    );
  });

  test("does not alter existing auth, invitation, communication, or billing tables", () => {
    const sql = executableSql();
    expect(sql).not.toMatch(
      /(?:alter|drop|truncate) table public\.(?:communication_logs|team_invitations|student_portal_invitations|tenant_billing_profiles)/,
    );
    expect(sql).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:communication_logs|team_invitations|student_portal_invitations|tenant_billing_profiles)/,
    );
  });

  test("preserves existing synchronous OTP and invitation flows", () => {
    expect(read("src/lib/server/authOtp.ts")).toContain("sendOtpEmail");
    expect(read("app/api/team-invitations/send-email/route.ts")).toContain(
      "sendCoachFortTransactionalEmail",
    );
    expect(read("app/api/student-portal-invitations/send/route.ts")).toContain(
      "sendCoachFortTransactionalEmail",
    );
    expect(read("app/api/onboarding/workspace-ready-email/route.ts")).toContain(
      "sendCoachFortTransactionalEmail",
    );
    for (const path of [
      "src/lib/server/authOtp.ts",
      "app/api/team-invitations/send-email/route.ts",
      "app/api/student-portal-invitations/send/route.ts",
      "app/api/onboarding/workspace-ready-email/route.ts",
    ]) {
      expect(read(path)).not.toContain("enqueue_transactional_email_server");
    }
  });

  test("keeps OTP delivery synchronous through the hardened central sender", async () => {
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.COACHFORT_EMAIL_FROM;
    const originalFetch = globalThis.fetch;
    let capturedInit: RequestInit | undefined;

    try {
      process.env.RESEND_API_KEY = "test-provider-key";
      process.env.COACHFORT_EMAIL_FROM = "CoachFort <test@coachfort.test>";
      globalThis.fetch = async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({ id: "provider-message-id" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      };

      const result = await sendOtpEmail({
        email: "student@example.com",
        expiresInMinutes: 10,
        otp: "123456",
        purpose: "signup_email_verification",
      });

      expect(result).toMatchObject({
        delivered: true,
        provider: "resend",
        providerMessageId: "provider-message-id",
      });
      expect(capturedInit?.headers).not.toMatchObject({
        "Idempotency-Key": expect.any(String),
      });
      expect(String(capturedInit?.body)).toContain("123456");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalApiKey;
      if (originalFrom === undefined) delete process.env.COACHFORT_EMAIL_FROM;
      else process.env.COACHFORT_EMAIL_FROM = originalFrom;
    }
  });

  test("classifies provider throttling as transient without exposing provider text", async () => {
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.COACHFORT_EMAIL_FROM;
    const originalFetch = globalThis.fetch;

    try {
      process.env.RESEND_API_KEY = "test-provider-key";
      process.env.COACHFORT_EMAIL_FROM = "CoachFort <test@coachfort.test>";
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            message: "provider detail that must not cross the boundary",
            name: "rate_limit_exceeded",
          }),
          { headers: { "Content-Type": "application/json" }, status: 429 },
        );

      const send = sendCoachFortTransactionalEmail({
        email: "student@example.com",
        failureMessage: "Unable to deliver transactional email.",
        logContext: { template: "coach.welcome" },
        template: renderTransactionalEmailTemplate("coach.welcome", {}),
      });

      await expect(send).rejects.toMatchObject({
        code: "rate_limit_exceeded",
        errorClass: "transient",
        message: "Unable to deliver transactional email.",
        retryable: true,
      } satisfies Partial<CoachFortEmailDeliveryError>);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalApiKey;
      if (originalFrom === undefined) delete process.env.COACHFORT_EMAIL_FROM;
      else process.env.COACHFORT_EMAIL_FROM = originalFrom;
    }
  });

  test("classifies hard provider rejection as permanent", async () => {
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.COACHFORT_EMAIL_FROM;
    const originalFetch = globalThis.fetch;

    try {
      process.env.RESEND_API_KEY = "test-provider-key";
      process.env.COACHFORT_EMAIL_FROM = "CoachFort <test@coachfort.test>";
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ name: "validation_error" }), {
          headers: { "Content-Type": "application/json" },
          status: 422,
        });

      const send = sendCoachFortTransactionalEmail({
        email: "student@example.com",
        failureMessage: "Unable to deliver transactional email.",
        logContext: { template: "coach.welcome" },
        template: renderTransactionalEmailTemplate("coach.welcome", {}),
      });

      await expect(send).rejects.toMatchObject({
        code: "validation_error",
        errorClass: "permanent",
        retryable: false,
      } satisfies Partial<CoachFortEmailDeliveryError>);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalApiKey;
      if (originalFrom === undefined) delete process.env.COACHFORT_EMAIL_FROM;
      else process.env.COACHFORT_EMAIL_FROM = originalFrom;
    }
  });

  test("returns only sanitized worker and webhook errors", () => {
    expect(drainRoute).toContain(
      "Transactional email processing is temporarily unavailable.",
    );
    expect(webhookRoute).toContain("Invalid webhook.");
    expect(webhookRoute).toContain("maxWebhookBytes = 64 * 1024");
    expect(webhookRoute).toContain(
      "Webhook processing is temporarily unavailable.",
    );
    expect(webhookRoute).not.toMatch(/error\.message|error\.details|error\.hint/);
    expect(drainRoute).not.toMatch(/error\.message|error\.details|error\.hint/);
  });

  test("POST verifier covers ACL, payloads, lifecycle, retry, and suppression", () => {
    const post = verificationBlock("POST-APPLY");
    for (const signal of [
      "security_gate",
      "browser_writes",
      "browser_dangerous",
      "event_key_unique",
      "claim_skip_locked",
      "finite_lease",
      "max_attempts",
      "retry_schedule",
      "payload_null_safe",
      "bounce_classified",
      "nonpermanent_bounce_evidence_only",
      "complaint_and_provider_suppression",
      "suppression_reason_source_atomic",
      "lifecycle_monotonic",
      "suppression_checked",
      "webhook_idempotent",
      "unknown_provider_safe",
    ]) {
      expect(post).toContain(signal);
    }
  });
});
