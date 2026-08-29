import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyPlatformBillingFulfillmentError,
  drainPlatformBillingDocumentFulfillments,
  type PlatformBillingFulfillmentClaim,
  type PlatformBillingFulfillmentOperations,
} from "../../src/lib/server/platformBillingFulfillment";
import { handlePlatformBillingFulfillmentDrainRequest } from "../../src/lib/server/platformBillingFulfillmentDrain";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const orderRoute = read("app/api/billing/razorpay/orders/route.ts");
const webhookRoute = read("app/api/billing/razorpay/webhook/route.ts");
const activationRoute = read("app/api/billing/razorpay/activate/route.ts");
const drainRoute = read(
  "app/api/internal/platform-billing/fulfillment/drain/route.ts",
);
const orchestratorSource = read(
  "src/lib/server/platformBillingFulfillment.ts",
);
const migration = read(
  "supabase/bundle_ux8f_verified_payment_document_fulfillment.sql",
);

const ids = {
  activation: "10000000-0000-4000-8000-000000000001",
  assignment: "10000000-0000-4000-8000-000000000002",
  claim: "10000000-0000-4000-8000-000000000003",
  fulfillment: "10000000-0000-4000-8000-000000000004",
  invoice: "10000000-0000-4000-8000-000000000005",
  order: "10000000-0000-4000-8000-000000000006",
  paymentAttempt: "10000000-0000-4000-8000-000000000007",
  receipt: "10000000-0000-4000-8000-000000000008",
};

function claim(
  overrides: Partial<PlatformBillingFulfillmentClaim> = {},
): PlatformBillingFulfillmentClaim {
  return {
    activation_event_id: ids.activation,
    attempt_number: 1,
    claim_token: ids.claim,
    fulfillment_id: ids.fulfillment,
    invoice_id: null,
    payment_attempt_id: ids.paymentAttempt,
    payment_order_id: ids.order,
    receipt_id: null,
    subscription_assignment_id: ids.assignment,
    ...overrides,
  };
}

function operations(input?: {
  claims?: PlatformBillingFulfillmentClaim[];
  events?: string[];
  issueInvoice?: PlatformBillingFulfillmentOperations["issueInvoice"];
  issueReceipt?: PlatformBillingFulfillmentOperations["issueReceipt"];
  finalize?: PlatformBillingFulfillmentOperations["finalize"];
}): PlatformBillingFulfillmentOperations {
  const events = input?.events ?? [];
  return {
    async claim() {
      events.push("claim");
      return input?.claims ?? [];
    },
    async discover() {
      events.push("discover");
      return 1;
    },
    async finalize(value) {
      events.push(`finalize:${value.outcome}`);
      if (input?.finalize) {
        return input.finalize(value);
      }
      return value.outcome === "invoice_issued" ? "processing" : value.outcome;
    },
    async issueInvoice(activationEventId) {
      events.push(`invoice:${activationEventId}`);
      return input?.issueInvoice
        ? input.issueInvoice(activationEventId)
        : ids.invoice;
    },
    async issueReceipt(fulfillmentId) {
      events.push(`receipt:${fulfillmentId}`);
      return input?.issueReceipt
        ? input.issueReceipt(fulfillmentId)
        : ids.receipt;
    },
  };
}

function drainRequest(authorization?: string) {
  return new Request(
    "https://coachfort.test/api/internal/platform-billing/fulfillment/drain",
    {
      headers: authorization ? { authorization } : undefined,
      method: "POST",
    },
  );
}

test.describe("UX-8F2 payment document fulfillment orchestration", () => {
  test("keeps provider order creation behind canonical database authority", () => {
    const authorityCall = orderRoute.indexOf(
      '"create_platform_payment_order_authority_server"',
    );
    const providerCall = orderRoute.indexOf("await createRazorpayOrder");

    expect(authorityCall).toBeGreaterThan(-1);
    expect(providerCall).toBeGreaterThan(authorityCall);
    expect(orderRoute.slice(0, providerCall)).toContain(
      "await loadCheckoutAuthority",
    );
    expect(orderRoute).not.toMatch(
      /Response\.json\([\s\S]{0,400}(?:billing_snapshot|issuer_snapshot|plan_snapshot)/,
    );
  });

  test("preserves verified webhook redelivery and duplicate safety", () => {
    expect(webhookRoute).toContain("prepareFailedWebhookEventForRetry");
    expect(webhookRoute).toContain('existing.processing_status === "failed"');
    expect(webhookRoute).toContain("existing.payload_hash === payloadHash");
    expect(webhookRoute).toContain("existing.signature_valid");
    expect(webhookRoute).toContain("signatureValid");
    expect(webhookRoute).toContain('error.code === "23505"');
    expect(webhookRoute).toContain("duplicate: true");
  });

  test("discovers, claims, issues invoice and receipt, then completes", async () => {
    const events: string[] = [];
    const result = await drainPlatformBillingDocumentFulfillments(
      { batchSize: 2, workerId: "focused-test" },
      operations({ claims: [claim()], events }),
    );

    expect(events).toEqual([
      "discover",
      "claim",
      `invoice:${ids.activation}`,
      "finalize:invoice_issued",
      `receipt:${ids.fulfillment}`,
      "finalize:completed",
    ]);
    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      discovered: 1,
    });
  });

  test("resumes invoice-only progress without issuing another invoice", async () => {
    const events: string[] = [];
    const result = await drainPlatformBillingDocumentFulfillments(
      undefined,
      operations({
        claims: [claim({ invoice_id: ids.invoice })],
        events,
        issueInvoice: async () => {
          throw new Error("Invoice must not be reissued.");
        },
      }),
    );

    expect(events).toEqual([
      "discover",
      "claim",
      `receipt:${ids.fulfillment}`,
      "finalize:completed",
    ]);
    expect(result.completed).toBe(1);
  });

  test("duplicate empty drains issue no documents", async () => {
    const events: string[] = [];
    const database = operations({ claims: [], events });

    await drainPlatformBillingDocumentFulfillments(undefined, database);
    await drainPlatformBillingDocumentFulfillments(undefined, database);

    expect(events).toEqual(["discover", "claim", "discover", "claim"]);
  });

  test("classifies missing prerequisites as blocked and preserves invoice progress", async () => {
    const finalizations: Array<Record<string, unknown>> = [];
    const result = await drainPlatformBillingDocumentFulfillments(
      undefined,
      operations({
        claims: [claim({ invoice_id: ids.invoice })],
        issueReceipt: async () => {
          throw { code: "55000", message: "Issuer configuration is missing." };
        },
        finalize: async (value) => {
          finalizations.push(value as unknown as Record<string, unknown>);
          return value.outcome;
        },
      }),
    );

    expect(result.blockedPrerequisite).toBe(1);
    expect(finalizations).toHaveLength(1);
    expect(finalizations[0]).toMatchObject({
      errorClass: "configuration",
      errorCode: "billing_prerequisite_unavailable",
      invoiceId: ids.invoice,
      outcome: "blocked_prerequisite",
    });
  });

  test("classifies document authority conflicts for manual review", async () => {
    const failure = classifyPlatformBillingFulfillmentError({
      code: "23505",
      message: "Invoice source key conflicts with existing authority.",
    });
    const finalizations: string[] = [];
    const result = await drainPlatformBillingDocumentFulfillments(
      undefined,
      operations({
        claims: [claim()],
        finalize: async (value) => {
          finalizations.push(value.outcome);
          return value.outcome;
        },
        issueInvoice: async () => {
          throw { code: "23505", message: "Source key conflict." };
        },
      }),
    );

    expect(failure).toEqual({
      errorClass: "conflict",
      errorCode: "billing_authority_conflict",
      outcome: "manual_review",
    });
    expect(finalizations).toEqual(["manual_review"]);
    expect(result.manualReview).toBe(1);
  });

  test("classifies temporary database failures for bounded retry", () => {
    expect(
      classifyPlatformBillingFulfillmentError({
        code: "40001",
        message: "Serialization failure.",
      }),
    ).toEqual({
      errorClass: "transient",
      errorCode: "billing_processing_transient",
      outcome: "retryable",
    });
  });

  test("relies on durable discovery and lease-expiry recovery", () => {
    expect(orchestratorSource.indexOf("operations.discover")).toBeLessThan(
      orchestratorSource.indexOf("operations.claim"),
    );
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("fulfillment.lease_expires_at <= now()");
    expect(migration).toContain("claim_lease_expired");
    expect(migration).toContain(
      "resume_platform_billing_document_fulfillment_server",
    );
    expect(migration).toContain("on conflict do nothing");
  });

  test("keeps activation success independent from fulfillment failure", () => {
    const activationCall = activationRoute.indexOf(
      '"activate_tenant_plan_after_verified_payment"',
    );
    const drainCall = activationRoute.indexOf(
      "await drainPlatformBillingDocumentFulfillments",
    );
    const response = activationRoute.indexOf("return Response.json(result");

    expect(activationCall).toBeGreaterThan(-1);
    expect(drainCall).toBeGreaterThan(activationCall);
    expect(response).toBeGreaterThan(drainCall);
    expect(activationRoute.slice(drainCall, response)).toContain(
      "catch (fulfillmentError)",
    );
    expect(activationRoute).toContain('"skipped_already_active"');
    expect(activationRoute).not.toContain("Generate invoice");
  });

  test("internal drain rejects browser credentials and accepts only worker secret", async () => {
    const secret = "b".repeat(48);
    let missingConfigCalls = 0;
    const missingConfig =
      await handlePlatformBillingFulfillmentDrainRequest(
        drainRequest(`Bearer ${secret}`),
        {
          configuredSecret: undefined,
          drain: async () => {
            missingConfigCalls += 1;
            throw new Error("Unreachable drain.");
          },
        },
      );
    expect(missingConfig.status).toBe(404);
    expect(missingConfigCalls).toBe(0);

    const invalidAuthorizations = [
      undefined,
      "Bearer owner.jwt.session",
      "Bearer wrong-secret",
      `Basic ${secret}`,
    ];

    for (const authorization of invalidAuthorizations) {
      let calls = 0;
      const response = await handlePlatformBillingFulfillmentDrainRequest(
        drainRequest(authorization),
        {
          configuredSecret: secret,
          drain: async () => {
            calls += 1;
            return {
              blockedPrerequisite: 0,
              claimed: 0,
              completed: 0,
              discovered: 0,
              leasePending: 0,
              manualReview: 0,
              retryScheduled: 0,
            };
          },
        },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Not found." });
      expect(calls).toBe(0);
    }

    let authorizedCalls = 0;
    const authorized = await handlePlatformBillingFulfillmentDrainRequest(
      drainRequest(`Bearer ${secret}`),
      {
        configuredSecret: secret,
        drain: async () => {
          authorizedCalls += 1;
          return {
            blockedPrerequisite: 0,
            claimed: 0,
            completed: 0,
            discovered: 0,
            leasePending: 0,
            manualReview: 0,
            retryScheduled: 0,
          };
        },
      },
    );

    expect(authorized.status).toBe(200);
    expect(authorizedCalls).toBe(1);
    expect(drainRoute).toContain("COACHFORT_BILLING_WORKER_SECRET");
    expect(drainRoute).not.toContain("COACHFORT_EMAIL_WORKER_SECRET");
  });

  test("sanitizes drain failures without exposing worker secrets", async () => {
    const secret = "s".repeat(48);
    const response = await handlePlatformBillingFulfillmentDrainRequest(
      drainRequest(`Bearer ${secret}`),
      {
        configuredSecret: secret,
        drain: async () => {
          throw new Error(`Database rejected secret ${secret}`);
        },
      },
    );
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).toContain(
      "Billing document processing is temporarily unavailable.",
    );
    expect(body).not.toContain(secret);
    expect(body).not.toContain("Database rejected");
  });

  test("uses only UX-8F1 RPC authority and preserves deferred boundaries", () => {
    for (const rpc of [
      "discover_platform_billing_document_fulfillments_server",
      "claim_platform_billing_document_fulfillments_server",
      "issue_platform_invoice_for_activation_server",
      "issue_platform_receipt_for_fulfillment_server",
      "finalize_platform_billing_document_fulfillment_server",
    ]) {
      expect(orchestratorSource).toContain(rpc);
    }
    expect(orchestratorSource).not.toMatch(/\.from\(|\.insert\(|\.update\(|\.delete\(/);
    expect(orchestratorSource).not.toMatch(
      /finance_invoices|finance_payments|finance_receipts|finance_adjustments|payment_transactions/,
    );
    expect(drainRoute).toContain("export async function POST");
    expect(drainRoute).not.toContain("export async function GET");
    expect(orderRoute).toContain("Razorpay test checkout");
    expect(orderRoute).toContain('currency: "INR"');
    expect(orderRoute).not.toContain('providerMode: "live"');
    expect(orchestratorSource).not.toMatch(/resend|email|pdf|renewal/i);
  });
});
