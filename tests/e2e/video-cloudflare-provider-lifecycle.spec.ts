import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type CloudflareStreamAdapter,
  CloudflareStreamProviderError,
  type CloudflareStreamVideo,
  type CloudflareStreamVideoState,
  createCloudflareStreamAdapter,
} from "../../src/lib/server/video/cloudflareStream";
import {
  buildNativeVideoProviderObservation,
  createNativeVideoProviderEventKey,
  type NativeVideoObservationDatabase,
} from "../../src/lib/server/video/nativeVideoProviderObservation";
import {
  type NativeVideoReconciliationDatabase,
  type NativeVideoReconciliationItem,
  nativeVideoReconciliationBatchSize,
  nativeVideoReconciliationLeaseSeconds,
  runNativeVideoReconciliation,
} from "../../src/lib/server/video/nativeVideoReconciliation";
import { handleNativeVideoReconciliationRequest } from "../../src/lib/server/video/nativeVideoReconciliationRoute";
import {
  cloudflareWebhookReplayWindowSeconds,
  handleCloudflareStreamWebhookRequest,
  processCloudflareStreamWebhook,
  verifyCloudflareWebhookSignature,
} from "../../src/lib/server/video/cloudflareStreamWebhook";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const accountId = "account-id";
const apiToken = "private-provider-token";
const assetId = "11111111-1111-4111-8111-111111111111";
const secondAssetId = "22222222-2222-4222-8222-222222222222";
const claimToken = "33333333-3333-4333-8333-333333333333";
const providerAssetId = "provider-video-uid";
const modifiedAt = "2026-09-19T08:30:00.000Z";
const webhookSecret = "webhook-secret-value";
const nowSeconds = 1_800_000_000;

function providerVideo(
  state: CloudflareStreamVideoState = "ready",
  overrides: Partial<CloudflareStreamVideo> = {},
): CloudflareStreamVideo {
  return {
    creatorCorrelation: assetId,
    durationSeconds: state === "ready" ? 121 : null,
    modifiedAt,
    providerAssetId,
    readyToStream: state === "ready",
    requireSignedURLs: true,
    safeErrorCode: state === "error" ? "err_malformed_video" : null,
    state,
    uploadedAt: "2026-09-19T08:20:00.000Z",
    uploadExpiry: "2026-09-19T10:00:00.000Z",
    ...overrides,
  };
}

function providerEnvelope(
  state: CloudflareStreamVideoState = "ready",
  overrides: Record<string, unknown> = {},
) {
  return {
    result: {
      creator: assetId,
      duration: state === "ready" ? 120.25 : 0,
      modified: modifiedAt,
      readyToStream: state === "ready",
      requireSignedURLs: true,
      status: {
        errorReasonCode: state === "error" ? "ERR_MALFORMED_VIDEO" : "",
        state,
      },
      uid: providerAssetId,
      uploaded: "2026-09-19T08:20:00.000Z",
      uploadExpiry: "2026-09-19T10:00:00.000Z",
      ...overrides,
    },
    success: true,
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function signBody(body: Buffer, timestamp = nowSeconds) {
  const signature = createHmac("sha256", webhookSecret)
    .update(Buffer.from(`${timestamp}.`, "utf8"))
    .update(body)
    .digest("hex");
  return `time=${timestamp},sig1=${signature}`;
}

function webhookRequest(body: Buffer, signature = signBody(body)) {
  return new Request("https://coachfort.test/api/video/cloudflare/webhook", {
    body: body.toString("utf8"),
    headers: {
      "content-type": "application/json",
      "webhook-signature": signature,
    },
    method: "POST",
  });
}

function reconciliationItem(
  action: NativeVideoReconciliationItem["action"],
  overrides: Partial<NativeVideoReconciliationItem> = {},
): NativeVideoReconciliationItem {
  return {
    action,
    assetId,
    claimToken,
    providerAssetId,
    ...overrides,
  };
}

function createReconciliationDatabase(
  items: NativeVideoReconciliationItem[],
  overrides: Partial<NativeVideoReconciliationDatabase> = {},
) {
  const calls = {
    claims: [] as Array<{ leaseSeconds: number; limit: number }>,
    confirmations: [] as Array<Record<string, unknown>>,
    expirations: [] as Array<Record<string, unknown>>,
    observations: [] as Array<Record<string, unknown>>,
    recoveries: [] as Array<Record<string, unknown>>,
    releases: [] as Array<Record<string, unknown>>,
  };
  const database: NativeVideoReconciliationDatabase = {
    async claim(input) {
      calls.claims.push(input);
      return items;
    },
    async confirmDeletion(input) {
      calls.confirmations.push(input);
    },
    async expireUnbound(input) {
      calls.expirations.push(input);
    },
    async observe(input) {
      calls.observations.push(input);
      return { replayed: false, status: "processing" };
    },
    async recoverIdentity(input) {
      calls.recoveries.push(input);
    },
    async release(input) {
      calls.releases.push(input);
    },
    ...overrides,
  };
  return { calls, database };
}

function createProvider(
  overrides: Partial<CloudflareStreamAdapter> = {},
): CloudflareStreamAdapter {
  return {
    async deleteVideo() {
      return { alreadyAbsent: false, deleted: true };
    },
    async getVideo() {
      return providerVideo("queued");
    },
    async listVideosByCreator() {
      return [];
    },
    ...overrides,
  };
}

async function expectProviderError(
  action: () => Promise<unknown>,
  kind: CloudflareStreamProviderError["kind"],
) {
  try {
    await action();
    throw new Error("Expected provider action to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(CloudflareStreamProviderError);
    expect((error as CloudflareStreamProviderError).kind).toBe(kind);
  }
}

test.describe("VIDEO-2B1B Cloudflare provider lifecycle", () => {
  test("1. normalizes every supported provider state without exposing raw payloads", async () => {
    for (const state of [
      "pendingupload",
      "downloading",
      "queued",
      "inprogress",
      "ready",
      "error",
      "live-inprogress",
    ] as const) {
      const adapter = createCloudflareStreamAdapter(
        { accountId, apiToken },
        { fetchImpl: async () => jsonResponse(providerEnvelope(state)) },
      );
      const result = await adapter.getVideo(providerAssetId);
      expect(result.state).toBe(state);
      expect(result.providerAssetId).toBe(providerAssetId);
      expect(result.modifiedAt).toBe(modifiedAt);
      expect(result.creatorCorrelation).toBe(assetId);
      expect(result).not.toHaveProperty("playback");
      expect(result).not.toHaveProperty("thumbnail");
      expect(result).not.toHaveProperty("meta");
    }
  });

  test("2. rounds trusted duration up and retains only a safe error code", async () => {
    const adapter = createCloudflareStreamAdapter(
      { accountId, apiToken },
      {
        fetchImpl: async () =>
          jsonResponse(
            providerEnvelope("error", {
              duration: 120.01,
              status: {
                errorReasonCode: "ERR-MALFORMED VIDEO/private detail",
                errorReasonText: "raw provider explanation",
                state: "error",
              },
            }),
          ),
      },
    );
    const result = await adapter.getVideo(providerAssetId);
    expect(result.durationSeconds).toBe(121);
    expect(result.safeErrorCode).toBe("err_malformed_video_private_detail");
    expect(JSON.stringify(result)).not.toContain("raw provider explanation");
  });

  test("3. rejects unknown states, malformed responses, 404, 5xx and timeout", async () => {
    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          {
            fetchImpl: async () =>
              jsonResponse(providerEnvelope("ready", { status: { state: "new" } })),
          },
        ).getVideo(providerAssetId),
      "invalid_response",
    );
    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          { fetchImpl: async () => jsonResponse({ success: true, result: {} }) },
        ).getVideo(providerAssetId),
      "invalid_response",
    );
    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          { fetchImpl: async () => jsonResponse({}, 404) },
        ).getVideo(providerAssetId),
      "not_found",
    );
    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          { fetchImpl: async () => jsonResponse({}, 503) },
        ).getVideo(providerAssetId),
      "unavailable",
    );
    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          {
            fetchImpl: async (_url, init) =>
              new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                  reject(new DOMException("Aborted", "AbortError")),
                );
              }),
            getTimeoutMs: 5,
          },
        ).getVideo(providerAssetId),
      "unavailable",
    );
  });

  test("4. lists at most three exact creator matches for 0, 1 and multiple recovery results", async () => {
    for (const count of [0, 1, 3]) {
      let requestedUrl = "";
      const adapter = createCloudflareStreamAdapter(
        { accountId, apiToken },
        {
          fetchImpl: async (url) => {
            requestedUrl = String(url);
            return jsonResponse({
              result: Array.from({ length: count }, (_, index) =>
                providerEnvelope("queued", {
                  uid: `${providerAssetId}-${index}`,
                }).result,
              ),
              success: true,
            });
          },
        },
      );
      expect(await adapter.listVideosByCreator(assetId)).toHaveLength(count);
      expect(requestedUrl).toContain(`creator=${assetId}`);
      expect(requestedUrl).toContain("limit=3");
    }

    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          {
            fetchImpl: async () =>
              jsonResponse({
                result: [
                  providerEnvelope("queued", {
                    creator: secondAssetId,
                  }).result,
                ],
                success: true,
              }),
          },
        ).listVideosByCreator(assetId),
      "invalid_response",
    );
  });

  test("5. deletion treats success and 404 as confirmed absence and never retries 5xx or timeout", async () => {
    for (const [status, alreadyAbsent] of [
      [204, false],
      [404, true],
    ] as const) {
      let calls = 0;
      const adapter = createCloudflareStreamAdapter(
        { accountId, apiToken },
        {
          fetchImpl: async (_url, init) => {
            calls += 1;
            expect(init?.method).toBe("DELETE");
            return new Response(null, { status });
          },
        },
      );
      expect(await adapter.deleteVideo(providerAssetId)).toEqual({
        alreadyAbsent,
        deleted: true,
      });
      expect(calls).toBe(1);
    }

    let failureCalls = 0;
    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          {
            fetchImpl: async () => {
              failureCalls += 1;
              return new Response(null, { status: 503 });
            },
          },
        ).deleteVideo(providerAssetId),
      "unavailable",
    );
    expect(failureCalls).toBe(1);

    let timeoutCalls = 0;
    await expectProviderError(
      () =>
        createCloudflareStreamAdapter(
          { accountId, apiToken },
          {
            deleteTimeoutMs: 5,
            fetchImpl: async (_url, init) => {
              timeoutCalls += 1;
              return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                  reject(new DOMException("Aborted", "AbortError")),
                );
              });
            },
          },
        ).deleteVideo(providerAssetId),
      "unavailable",
    );
    expect(timeoutCalls).toBe(1);
  });

  test("6. event identity is deterministic across replay and changes with state or modified time", () => {
    const base = providerVideo("queued");
    expect(createNativeVideoProviderEventKey(base)).toBe(
      createNativeVideoProviderEventKey({ ...base }),
    );
    expect(createNativeVideoProviderEventKey(base)).not.toBe(
      createNativeVideoProviderEventKey({ ...base, state: "inprogress" }),
    );
    expect(createNativeVideoProviderEventKey(base)).not.toBe(
      createNativeVideoProviderEventKey({
        ...base,
        modifiedAt: "2026-09-19T08:31:00.000Z",
      }),
    );
    expect(createNativeVideoProviderEventKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("7. safe evidence is bounded and excludes provider capabilities and secrets", () => {
    const observation = buildNativeVideoProviderObservation(
      providerVideo("ready"),
      "webhook",
    );
    expect(observation.safeEvidence).toEqual({
      duration_seconds: 121,
      observation_source: "webhook",
      provider_modified_at: modifiedAt,
      provider_state: "ready",
      ready_to_stream: true,
      safe_error_code: null,
    });
    const serialized = JSON.stringify(observation);
    for (const forbidden of [
      apiToken,
      accountId,
      webhookSecret,
      "Authorization",
      "upload.cloudflarestream.com",
      "playback",
      "signed",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("8. signature verification preserves raw bytes and enforces a five-minute replay window", () => {
    const body = Buffer.from('{\n  "uid": "provider-video-uid"\n}\n', "utf8");
    expect(
      verifyCloudflareWebhookSignature({
        nowSeconds,
        rawBody: body,
        signatureHeader: signBody(body),
        signingSecret: webhookSecret,
      }),
    ).toEqual({ timestamp: nowSeconds, valid: true });

    const changedWhitespace = Buffer.from('{"uid":"provider-video-uid"}', "utf8");
    expect(
      verifyCloudflareWebhookSignature({
        nowSeconds,
        rawBody: changedWhitespace,
        signatureHeader: signBody(body),
        signingSecret: webhookSecret,
      }).valid,
    ).toBe(false);

    for (const header of [
      "",
      `time=nope,sig1=${"a".repeat(64)}`,
      `time=${nowSeconds}`,
      `sig1=${"a".repeat(64)}`,
      `time=${nowSeconds},sig1=short`,
      `time=${nowSeconds},sig1=${"a".repeat(64)}`,
    ]) {
      expect(
        verifyCloudflareWebhookSignature({
          nowSeconds,
          rawBody: body,
          signatureHeader: header,
          signingSecret: webhookSecret,
        }).valid,
      ).toBe(false);
    }

    for (const timestamp of [
      nowSeconds - cloudflareWebhookReplayWindowSeconds - 1,
      nowSeconds + cloudflareWebhookReplayWindowSeconds + 1,
    ]) {
      expect(
        verifyCloudflareWebhookSignature({
          nowSeconds,
          rawBody: body,
          signatureHeader: signBody(body, timestamp),
          signingSecret: webhookSecret,
        }),
      ).toEqual({ reason: "stale", valid: false });
    }

    const source = read(
      "src/lib/server/video/cloudflareStreamWebhook.ts",
    );
    expect(source).toContain("timingSafeEqual(expected, supplied)");
    expect(source).toContain("Buffer.alloc(expected.length)");
  });

  test("9. unverified and malformed webhooks never reach provider or database work", async () => {
    const body = Buffer.from(JSON.stringify({ uid: providerAssetId }));
    let processCalls = 0;
    for (const request of [
      webhookRequest(body, `time=${nowSeconds},sig1=${"0".repeat(64)}`),
      new Request("https://coachfort.test/api/video/cloudflare/webhook", {
        body,
        method: "POST",
      }),
      webhookRequest(Buffer.from("{}")),
    ]) {
      const response = await handleCloudflareStreamWebhookRequest(request, {
        nowSeconds,
        process: async () => {
          processCalls += 1;
        },
        signingSecret: webhookSecret,
      });
      expect([400, 401]).toContain(response.status);
    }
    expect(processCalls).toBe(0);
  });

  test("10. missing webhook configuration fails safely without global startup dependency", async () => {
    const response = await handleCloudflareStreamWebhookRequest(
      webhookRequest(Buffer.from(JSON.stringify({ uid: providerAssetId }))),
      { signingSecret: "" },
    );
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("VIDEO_NOT_CONFIGURED");
    expect(body).not.toContain("CLOUDFLARE_STREAM_WEBHOOK_SECRET");
  });

  test("11. verified webhook uses provider GET truth rather than payload state", async () => {
    const observations: Array<Record<string, unknown>> = [];
    const database: NativeVideoObservationDatabase = {
      async observe(observation) {
        observations.push(observation);
        return { replayed: false };
      },
    };
    let gets = 0;
    await processCloudflareStreamWebhook(providerAssetId, {
      database,
      provider: createProvider({
        async getVideo() {
          gets += 1;
          return providerVideo("queued");
        },
      }),
    });
    expect(gets).toBe(1);
    expect(observations[0]?.state).toBe("queued");

    const payloadSaysReady = Buffer.from(
      JSON.stringify({ status: { state: "ready" }, uid: providerAssetId }),
    );
    let receivedUid = "";
    const response = await handleCloudflareStreamWebhookRequest(
      webhookRequest(payloadSaysReady),
      {
        nowSeconds,
        process: async (uid) => {
          receivedUid = uid;
        },
        signingSecret: webhookSecret,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(receivedUid).toBe(providerAssetId);

    const payloadSaysProcessing = Buffer.from(
      JSON.stringify({ status: { state: "inprogress" }, uid: providerAssetId }),
    );
    const readyObservations: Array<Record<string, unknown>> = [];
    const readyResponse = await handleCloudflareStreamWebhookRequest(
      webhookRequest(payloadSaysProcessing),
      {
        nowSeconds,
        process: async (uid) =>
          processCloudflareStreamWebhook(uid, {
            database: {
              async observe(observation) {
                readyObservations.push(observation);
                return { replayed: false };
              },
            },
            provider: createProvider({
              async getVideo() {
                return providerVideo("ready");
              },
            }),
          }),
        signingSecret: webhookSecret,
      },
    );
    expect(readyResponse.status).toBe(200);
    expect(readyObservations[0]?.state).toBe("ready");
  });

  test("12. duplicate webhook observations reuse the exact same event key", async () => {
    const observations: Array<Record<string, unknown>> = [];
    const database: NativeVideoObservationDatabase = {
      async observe(observation) {
        observations.push(observation);
        return { replayed: observations.length > 1 };
      },
    };
    const provider = createProvider({
      async getVideo() {
        return providerVideo("ready");
      },
    });
    await processCloudflareStreamWebhook(providerAssetId, { database, provider });
    await processCloudflareStreamWebhook(providerAssetId, { database, provider });
    expect(observations).toHaveLength(2);
    expect(observations[0]?.eventKey).toBe(observations[1]?.eventKey);
  });

  test("13. reconciliation claims a bounded lease and observes all supported states", async () => {
    for (const state of [
      "pendingupload",
      "downloading",
      "queued",
      "inprogress",
      "ready",
      "error",
      "live-inprogress",
    ] as const) {
      const { calls, database } = createReconciliationDatabase([
        reconciliationItem("get_provider_state"),
      ]);
      const summary = await runNativeVideoReconciliation({
        database,
        provider: createProvider({
          async getVideo() {
            return providerVideo(state);
          },
        }),
      });
      expect(calls.claims).toEqual([
        {
          leaseSeconds: nativeVideoReconciliationLeaseSeconds,
          limit: nativeVideoReconciliationBatchSize,
        },
      ]);
      expect(calls.observations[0]?.state).toBe(state);
      expect(summary.reconciled).toBe(1);
    }
  });

  test("14. ambiguous recovery handles zero, one and multiple creator matches safely", async () => {
    for (const [count, expected] of [
      [0, "deferred"],
      [1, "reconciled"],
      [2, "deferred"],
    ] as const) {
      const { calls, database } = createReconciliationDatabase([
        reconciliationItem("recover_ambiguous_provider", {
          providerAssetId: null,
        }),
      ]);
      const matches = Array.from({ length: count }, (_, index) =>
        providerVideo("queued", {
          providerAssetId: `${providerAssetId}-${index}`,
        }),
      );
      const summary = await runNativeVideoReconciliation({
        database,
        provider: createProvider({
          async getVideo(id) {
            return (
              matches.find((video) => video.providerAssetId === id) ??
              providerVideo("queued", { providerAssetId: id })
            );
          },
          async listVideosByCreator() {
            return matches;
          },
        }),
      });
      expect(summary[expected]).toBe(1);
      expect(calls.recoveries).toHaveLength(count === 1 ? 1 : 0);
      expect(calls.observations).toHaveLength(count === 1 ? 1 : 0);
      expect(calls.releases).toHaveLength(count === 1 ? 0 : 1);
    }
  });

  test("15. expired unbound reservations require provider absence before quota release", async () => {
    const { calls, database } = createReconciliationDatabase([
      reconciliationItem("resolve_unbound_reservation", {
        providerAssetId: null,
      }),
    ]);
    const summary = await runNativeVideoReconciliation({
      database,
      provider: createProvider({
        async listVideosByCreator() {
          return [];
        },
      }),
    });
    expect(summary.reconciled).toBe(1);
    expect(calls.expirations).toEqual([
      { assetId, claimToken, providerMatchCount: 0 },
    ]);
    expect(calls.releases).toEqual([
      { assetId, claimToken, safeFailureCode: null },
    ]);
  });

  test("16. deletion confirms success or absence but not 5xx/timeout ambiguity", async () => {
    for (const alreadyAbsent of [false, true]) {
      const { calls, database } = createReconciliationDatabase([
        reconciliationItem("delete_provider"),
      ]);
      const summary = await runNativeVideoReconciliation({
        database,
        provider: createProvider({
          async deleteVideo() {
            return { alreadyAbsent, deleted: true };
          },
        }),
      });
      expect(summary.deleted).toBe(1);
      expect(calls.confirmations).toEqual([{ assetId, providerAssetId }]);
      expect(calls.releases).toHaveLength(1);
    }

    const { calls, database } = createReconciliationDatabase([
      reconciliationItem("delete_provider"),
    ]);
    const summary = await runNativeVideoReconciliation({
      database,
      onOperationalError: () => undefined,
      provider: createProvider({
        async deleteVideo() {
          throw new CloudflareStreamProviderError({
            kind: "unavailable",
            safeCode: "video_provider_delete_failed",
          });
        },
      }),
    });
    expect(summary.deferred).toBe(1);
    expect(calls.confirmations).toHaveLength(0);
    expect(calls.releases).toHaveLength(1);
  });

  test("17. one item failure does not abort later reconciliation items", async () => {
    const { calls, database } = createReconciliationDatabase([
      reconciliationItem("get_provider_state"),
      reconciliationItem("get_provider_state", {
        assetId: secondAssetId,
        providerAssetId: "second-provider-id",
      }),
    ]);
    let gets = 0;
    const summary = await runNativeVideoReconciliation({
      database,
      onOperationalError: () => undefined,
      provider: createProvider({
        async getVideo(id) {
          gets += 1;
          if (id === providerAssetId) {
            throw new CloudflareStreamProviderError({
              kind: "unavailable",
              safeCode: "video_provider_unavailable",
            });
          }
          return providerVideo("queued", {
            creatorCorrelation: secondAssetId,
            providerAssetId: id,
          });
        },
      }),
    });
    expect(gets).toBe(2);
    expect(summary).toMatchObject({
      claimed: 2,
      deferred: 1,
      processed: 2,
      reconciled: 1,
    });
    expect(calls.observations).toHaveLength(1);
  });

  test("18. internal route fails closed and returns aggregate-only results", async () => {
    const secret = "c".repeat(48);
    const safeSummary = {
      claimed: 2,
      deferred: 1,
      deleted: 0,
      failed: 0,
      processed: 2,
      reconciled: 1,
    };
    let calls = 0;
    for (const authorization of [undefined, "Bearer wrong", "Bearer owner.jwt"]) {
      const response = await handleNativeVideoReconciliationRequest(
        new Request("https://coachfort.test/api/internal/video/reconcile", {
          headers: authorization ? { authorization } : undefined,
        }),
        {
          configuredSecret: secret,
          reconcile: async () => {
            calls += 1;
            return safeSummary;
          },
        },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Not found." });
    }
    expect(calls).toBe(0);

    const response = await handleNativeVideoReconciliationRequest(
      new Request("https://coachfort.test/api/internal/video/reconcile", {
        headers: { authorization: `Bearer ${secret}` },
      }),
      {
        configuredSecret: secret,
        reconcile: async () => {
          calls += 1;
          return safeSummary;
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(safeSummary);
    expect(calls).toBe(1);
    expect(JSON.stringify(safeSummary)).not.toMatch(
      /asset|provider|email|token|secret/i,
    );
  });

  test("19. routes are server-only, webhook is raw-body POST, and cron remains inactive", () => {
    const webhookRoute = read("app/api/video/cloudflare/webhook/route.ts");
    const webhook = read("src/lib/server/video/cloudflareStreamWebhook.ts");
    const reconcileRoute = read("app/api/internal/video/reconcile/route.ts");
    const reconcile = read("src/lib/server/video/nativeVideoReconciliation.ts");
    const observation = read(
      "src/lib/server/video/nativeVideoProviderObservation.ts",
    );
    const vercel = read("vercel.json");

    expect(webhookRoute).toContain('export const runtime = "nodejs"');
    expect(webhookRoute).toContain("export async function POST");
    expect(webhook).toContain("request.arrayBuffer()");
    expect(webhook.indexOf("verifyCloudflareWebhookSignature")).toBeLessThan(
      webhook.indexOf("webhookUid(rawBody)"),
    );
    expect(reconcileRoute).toContain("export async function GET");
    expect(reconcileRoute).toContain("process.env.CRON_SECRET");
    expect(reconcile).toContain("claim_native_video_reconciliation_batch_server");
    expect(observation).toContain("observe_native_video_provider_state_server");
    expect(reconcile).toContain("recover_native_video_provider_identity_server");
    expect(reconcile).toContain("confirm_native_video_provider_deletion_server");
    expect(reconcile).not.toMatch(/\.from\(["']video_(?:assets|provider_events)/);
    expect(vercel).not.toContain("/api/internal/video/reconcile");
  });

  test("20. provider and webhook secrets stay out of responses, evidence and logs", async () => {
    const files = [
      "src/lib/server/video/cloudflareStream.ts",
      "src/lib/server/video/cloudflareStreamWebhook.ts",
      "src/lib/server/video/nativeVideoProviderObservation.ts",
      "src/lib/server/video/nativeVideoReconciliation.ts",
      "src/lib/server/video/nativeVideoReconciliationRoute.ts",
      "app/api/video/cloudflare/webhook/route.ts",
      "app/api/internal/video/reconcile/route.ts",
    ];
    const source = files.map(read).join("\n");
    const webhook = read("src/lib/server/video/cloudflareStreamWebhook.ts");
    const reconcile = read("src/lib/server/video/nativeVideoReconciliation.ts");
    expect(source).not.toMatch(/console\.(?:log|error|warn)/);
    expect(webhook).not.toMatch(
      /captureServerException\([\s\S]{0,500}(?:rawBody|signingSecret)/,
    );
    expect(reconcile).not.toMatch(
      /captureServerException\([\s\S]{0,500}(?:apiToken|accountId)/,
    );
    expect(source).not.toMatch(
      /Response\.json\(\s*\{[\s\S]{0,120}(?:accountId|signingSecret)\s*:/,
    );
    expect(source).not.toMatch(/safeEvidence[\s\S]{0,400}(?:uploadUrl|Authorization)/);

    const signedBody = Buffer.from(JSON.stringify({ uid: providerAssetId }));
    const webhookResponse = await handleCloudflareStreamWebhookRequest(
      webhookRequest(signedBody),
      {
        nowSeconds,
        process: async () => {
          throw new Error(`${apiToken}:${webhookSecret}:${accountId}`);
        },
        signingSecret: webhookSecret,
      },
    );
    const webhookResponseBody = JSON.stringify(await webhookResponse.json());
    expect(webhookResponse.status).toBe(503);
    expect(webhookResponseBody).not.toContain(apiToken);
    expect(webhookResponseBody).not.toContain(webhookSecret);
    expect(webhookResponseBody).not.toContain(accountId);
  });
});
