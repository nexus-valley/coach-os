import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { handleNativeVideoPlaybackRequest } from "../../app/api/video/lessons/[lessonId]/playback/route";
import {
  type CloudflareStreamPlaybackAdapter,
  type CloudflareStreamVideo,
  CloudflareStreamProviderError,
  createCloudflareStreamPlaybackAdapter,
} from "../../src/lib/server/video/cloudflareStream";
import {
  CloudflareStreamPlaybackConfigurationError,
  getCloudflareStreamConfigurationState,
  getCloudflareStreamPlaybackConfig,
  getCloudflareStreamUploadConfig,
} from "../../src/lib/server/video/cloudflareStreamConfig";
import {
  createNativeVideoPlayback,
  createNativeVideoPlaybackDatabase,
  type NativeVideoPlaybackDatabase,
  NativeVideoPlaybackPublicError,
  nativeVideoPlaybackMaximumTtlSeconds,
  nativeVideoPlaybackMinimumTtlSeconds,
  nativeVideoPlaybackTtlSeconds,
} from "../../src/lib/server/video/nativeVideoPlayback";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const tenantId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const lessonId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";
const providerAssetId = "provider-video-uid";
const customerCode = "customer-code";
const nowEpochSeconds = 1_800_000_000;
const signedToken = "signed.playback.token";

const routePath = "app/api/video/lessons/[lessonId]/playback/route.ts";
const playbackPath = "src/lib/server/video/nativeVideoPlayback.ts";
const providerPath = "src/lib/server/video/cloudflareStream.ts";
const configPath = "src/lib/server/video/cloudflareStreamConfig.ts";

function playbackRequest(
  body: Record<string, unknown> = { tenantId },
  token = "approved-user-token",
) {
  return new Request(
    `https://coachfort.test/api/video/lessons/${lessonId}/playback`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
}

function context(id = lessonId) {
  return { params: Promise.resolve({ lessonId: id }) };
}

function authority(durationSeconds = 900) {
  return { durationSeconds, lessonId, providerAssetId, videoAssetId: assetId };
}

function providerVideo(
  overrides: Partial<CloudflareStreamVideo> = {},
): CloudflareStreamVideo {
  return {
    creatorCorrelation: assetId,
    durationSeconds: 900,
    modifiedAt: "2027-01-15T08:00:00.000Z",
    providerAssetId,
    readyToStream: true,
    requireSignedURLs: true,
    safeErrorCode: null,
    state: "ready",
    uploadedAt: "2027-01-15T07:55:00.000Z",
    uploadExpiry: null,
    ...overrides,
  };
}

function provider(
  overrides: Partial<CloudflareStreamPlaybackAdapter> = {},
): CloudflareStreamPlaybackAdapter {
  return {
    async createSignedPlaybackToken() {
      return signedToken;
    },
    getIframeUrl(token) {
      return `https://customer-${customerCode}.cloudflarestream.com/${token}/iframe`;
    },
    async getVideo() {
      return providerVideo();
    },
    ...overrides,
  };
}

function database(
  overrides: Partial<NativeVideoPlaybackDatabase> = {},
): NativeVideoPlaybackDatabase {
  return {
    async authorize() {
      return authority();
    },
    ...overrides,
  };
}

function publicError(code: string, status: number) {
  return new NativeVideoPlaybackPublicError(
    code,
    "Safe customer-facing message.",
    status,
  );
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
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

test.describe("VIDEO-2C1 Cloudflare signed native-video playback", () => {
  test("1. route authenticates, canonicalizes UUIDs and binds the actor server-side", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handleNativeVideoPlaybackRequest(
      playbackRequest({ tenantId: tenantId.toUpperCase() }),
      context(lessonId.toUpperCase()),
      {
        authenticate: async () => ({ id: actorUserId }),
        createPlayback: async (input) => {
          calls.push(input);
          return {
            durationSeconds: 900,
            lessonId,
            playback: {
              expiresAt: "2027-01-15T08:30:00.000Z",
              kind: "native_video",
              mode: "iframe",
              url: `https://customer-${customerCode}.cloudflarestream.com/${signedToken}/iframe`,
            },
          };
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([{ actorUserId, lessonId, tenantId }]);
    expect(await json(response)).toEqual({
      durationSeconds: 900,
      lessonId,
      playback: {
        expiresAt: "2027-01-15T08:30:00.000Z",
        kind: "native_video",
        mode: "iframe",
        url: `https://customer-${customerCode}.cloudflarestream.com/${signedToken}/iframe`,
      },
    });
  });

  test("2. missing or invalid authentication stops before playback authority", async () => {
    let calls = 0;
    const noHeader = new Request(
      `https://coachfort.test/api/video/lessons/${lessonId}/playback`,
      {
        body: JSON.stringify({ tenantId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    for (const [request, authenticate] of [
      [noHeader, undefined],
      [
        playbackRequest(),
        async () => {
          throw new Error("Authentication required.");
        },
      ],
    ] as const) {
      const response = await handleNativeVideoPlaybackRequest(request, context(), {
        authenticate,
        createPlayback: async () => {
          calls += 1;
          throw new Error("must not run");
        },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(calls).toBe(0);
  });

  test("3. invalid UUID, JSON and expanded authority-bearing bodies are rejected", async () => {
    const scenarios = [
      { body: { tenantId: "not-a-uuid" }, id: lessonId },
      { body: { tenantId }, id: "not-a-uuid" },
      { body: { assetId, tenantId }, id: lessonId },
      { body: { actorUserId, tenantId }, id: lessonId },
      { body: { courseId: assetId, tenantId }, id: lessonId },
      { body: { customerCode, tenantId }, id: lessonId },
      { body: { duration: 900, tenantId }, id: lessonId },
      { body: { featureState: "enabled", tenantId }, id: lessonId },
      { body: { lifecycle: "active", tenantId }, id: lessonId },
      { body: { providerAssetId, tenantId }, id: lessonId },
      { body: { role: "owner", tenantId }, id: lessonId },
      { body: { studentId: actorUserId, tenantId }, id: lessonId },
      { body: { tenantId, tokenExpiry: 99_999 }, id: lessonId },
    ];
    let calls = 0;
    for (const scenario of scenarios) {
      const response = await handleNativeVideoPlaybackRequest(
        playbackRequest(scenario.body),
        context(scenario.id),
        {
          authenticate: async () => ({ id: actorUserId }),
          createPlayback: async () => {
            calls += 1;
            throw new Error("must not run");
          },
        },
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }

    const malformed = new Request(
      `https://coachfort.test/api/video/lessons/${lessonId}/playback`,
      {
        body: "{",
        headers: {
          Authorization: "Bearer approved-user-token",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    const response = await handleNativeVideoPlaybackRequest(
      malformed,
      context(),
      { authenticate: async () => ({ id: actorUserId }) },
    );
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("4. route preserves sanitized database/provider error status and no-store", async () => {
    for (const status of [400, 403, 404, 409, 500, 502, 503]) {
      const response = await handleNativeVideoPlaybackRequest(
        playbackRequest(),
        context(),
        {
          authenticate: async () => ({ id: actorUserId }),
          createPlayback: async () => {
            throw publicError(`SAFE_${status}`, status);
          },
        },
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await json(response)).toEqual({
        code: `SAFE_${status}`,
        error: "Safe customer-facing message.",
      });
    }
  });

  test("5. database adapter calls only VIDEO-2C0 and maps authority failures safely", async () => {
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    const client = {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        return {
          data: {
            duration_seconds: 900,
            lesson_id: lessonId,
            provider: "cloudflare_stream",
            provider_asset_id: providerAssetId,
            video_asset_id: assetId,
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;
    const result = await createNativeVideoPlaybackDatabase(client).authorize({
      actorUserId,
      lessonId,
      tenantId,
    });
    expect(result).toEqual(authority());
    expect(calls).toEqual([
      {
        name: "authorize_native_video_playback_server",
        parameters: {
          p_actor_user_id: actorUserId,
          p_lesson_id: lessonId,
          p_tenant_id: tenantId,
        },
      },
    ]);

    for (const [code, status] of [
      ["28000", 401],
      ["22023", 400],
      ["42501", 403],
      ["P0002", 404],
      ["55000", 409],
      ["XX000", 500],
    ] as const) {
      const failingClient = {
        async rpc() {
          return { data: null, error: { code, message: "private SQL detail" } };
        },
      } as unknown as SupabaseClient;
      await expect(
        createNativeVideoPlaybackDatabase(failingClient).authorize({
          actorUserId,
          lessonId,
          tenantId,
        }),
      ).rejects.toMatchObject({ status });
    }
  });

  test("6. malformed VIDEO-2C0 output fails closed", async () => {
    const invalidRows = [
      null,
      {},
      {
        duration_seconds: 900,
        lesson_id: tenantId,
        provider: "cloudflare_stream",
        provider_asset_id: providerAssetId,
        video_asset_id: assetId,
      },
      {
        duration_seconds: 900,
        lesson_id: lessonId,
        provider: "other",
        provider_asset_id: providerAssetId,
        video_asset_id: assetId,
      },
      {
        duration_seconds: 0,
        lesson_id: lessonId,
        provider: "cloudflare_stream",
        provider_asset_id: providerAssetId,
        video_asset_id: assetId,
      },
      {
        duration_seconds: 900,
        lesson_id: lessonId,
        provider: "cloudflare_stream",
        provider_asset_id: "provider uid",
        video_asset_id: assetId,
      },
    ];
    for (const data of invalidRows) {
      const client = {
        async rpc() {
          return { data, error: null };
        },
      } as unknown as SupabaseClient;
      await expect(
        createNativeVideoPlaybackDatabase(client).authorize({
          actorUserId,
          lessonId,
          tenantId,
        }),
      ).rejects.toMatchObject({
        code: "VIDEO_PLAYBACK_AUTHORITY_INVALID",
        status: 500,
      });
    }
  });

  test("7. lifecycle/database authority completes before provider preparation", async () => {
    const order: string[] = [];
    const result = await createNativeVideoPlayback({
      database: database({
        async authorize() {
          order.push("database");
          return authority();
        },
      }),
      nowEpochSeconds: () => nowEpochSeconds,
      prepareProvider() {
        order.push("provider_config");
        return provider({
          async createSignedPlaybackToken() {
            order.push("token");
            return signedToken;
          },
          async getVideo() {
            order.push("lookup");
            return providerVideo();
          },
        });
      },
      request: { actorUserId, lessonId, tenantId },
    });
    expect(order).toEqual(["database", "provider_config", "lookup", "token"]);
    expect(result.durationSeconds).toBe(900);

    order.length = 0;
    await expect(
      createNativeVideoPlayback({
        database: database({
          async authorize() {
            order.push("database_denied");
            throw publicError("VIDEO_PLAYBACK_FORBIDDEN", 403);
          },
        }),
        prepareProvider() {
          order.push("provider_must_not_run");
          return provider();
        },
        request: { actorUserId, lessonId, tenantId },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(order).toEqual(["database_denied"]);
  });

  test("8. provider truth must be ready, signed and correlated to the authorized asset", async () => {
    const scenarios: Array<Partial<CloudflareStreamVideo>> = [
      { state: "queued" },
      { readyToStream: false },
      { requireSignedURLs: false },
      { creatorCorrelation: null },
      { creatorCorrelation: tenantId },
      { providerAssetId: "different-provider-uid" },
    ];
    for (const overrides of scenarios) {
      let tokenCalls = 0;
      await expect(
        createNativeVideoPlayback({
          database: database(),
          prepareProvider: () =>
            provider({
              async createSignedPlaybackToken() {
                tokenCalls += 1;
                return signedToken;
              },
              async getVideo() {
                return providerVideo(overrides);
              },
            }),
          request: { actorUserId, lessonId, tenantId },
        }),
      ).rejects.toMatchObject({
        code: "VIDEO_PLAYBACK_NOT_READY",
        status: 409,
      });
      expect(tokenCalls).toBe(0);
    }
  });

  test("9. TTL uses 30-minute minimum, duration buffer and 135-minute cap", () => {
    expect(nativeVideoPlaybackTtlSeconds(1)).toBe(
      nativeVideoPlaybackMinimumTtlSeconds,
    );
    expect(nativeVideoPlaybackTtlSeconds(900)).toBe(1_800);
    expect(nativeVideoPlaybackTtlSeconds(1_800)).toBe(2_700);
    expect(nativeVideoPlaybackTtlSeconds(7_200)).toBe(8_100);
    expect(nativeVideoPlaybackTtlSeconds(9_000)).toBe(
      nativeVideoPlaybackMaximumTtlSeconds,
    );
  });

  test("10. fixed clock drives exact custom exp and provider-neutral response", async () => {
    const tokenCalls: Array<Record<string, unknown>> = [];
    const result = await createNativeVideoPlayback({
      database: database({ async authorize() { return authority(1_800); } }),
      nowEpochSeconds: () => nowEpochSeconds,
      prepareProvider: () =>
        provider({
          async createSignedPlaybackToken(id, expiresAtEpochSeconds) {
            tokenCalls.push({ expiresAtEpochSeconds, providerAssetId: id });
            return signedToken;
          },
        }),
      request: { actorUserId, lessonId, tenantId },
    });
    const exp = nowEpochSeconds + 2_700;
    expect(tokenCalls).toEqual([
      { expiresAtEpochSeconds: exp, providerAssetId },
    ]);
    expect(result).toEqual({
      durationSeconds: 1_800,
      lessonId,
      playback: {
        expiresAt: new Date(exp * 1_000).toISOString(),
        kind: "native_video",
        mode: "iframe",
        url: `https://customer-${customerCode}.cloudflarestream.com/${signedToken}/iframe`,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(providerAssetId);
    expect(serialized).not.toContain(assetId);
    expect(serialized).not.toMatch(/accountId|apiToken|customerCode|token\s*:/i);
  });

  test("11. playback config is isolated from upload/webhook configuration", () => {
    const base = {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_STREAM_API_TOKEN: "private-token",
    };
    expect(getCloudflareStreamUploadConfig(base)).toEqual({
      accountId: "account-id",
      apiToken: "private-token",
    });
    expect(getCloudflareStreamConfigurationState(base)).toEqual({
      uploadConfigured: true,
      webhookConfigured: false,
    });
    expect(() => getCloudflareStreamPlaybackConfig(base)).toThrow(
      CloudflareStreamPlaybackConfigurationError,
    );
    for (const invalidCustomerCode of ["_private", "-private", "private-"]) {
      expect(() =>
        getCloudflareStreamPlaybackConfig({
          ...base,
          CLOUDFLARE_STREAM_CUSTOMER_CODE: invalidCustomerCode,
        }),
      ).toThrow(CloudflareStreamPlaybackConfigurationError);
    }
    expect(
      getCloudflareStreamPlaybackConfig({
        ...base,
        CLOUDFLARE_STREAM_CUSTOMER_CODE: customerCode,
      }),
    ).toEqual({
      accountId: "account-id",
      apiToken: "private-token",
      customerCode,
    });
  });

  test("12. signed-token adapter uses exact endpoint and body without downloads or access rules", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const adapter = createCloudflareStreamPlaybackAdapter(
      {
        accountId: "account-id",
        apiToken: "private-token",
        customerCode,
      },
      {
        fetchImpl: async (url, init) => {
          calls.push({ init, url: String(url) });
          return Response.json({ result: { token: signedToken }, success: true });
        },
      },
    );
    const exp = nowEpochSeconds + 1_800;
    expect(await adapter.createSignedPlaybackToken(providerAssetId, exp)).toBe(
      signedToken,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/account-id/stream/${providerAssetId}/token`,
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer private-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ exp });
    expect(String(calls[0]?.init?.body)).not.toMatch(
      /downloadable|accessRules|ip|geo/i,
    );
    expect(adapter.getIframeUrl(signedToken)).toBe(
      `https://customer-${customerCode}.cloudflarestream.com/${signedToken}/iframe`,
    );
  });

  test("13. provider lookup parses signed-URL and Creator facts robustly", async () => {
    const adapter = createCloudflareStreamPlaybackAdapter(
      {
        accountId: "account-id",
        apiToken: "private-token",
        customerCode,
      },
      {
        fetchImpl: async () =>
          Response.json({
            result: {
              creator: assetId,
              duration: 899.2,
              readyToStream: true,
              requireSignedURLs: true,
              status: { state: "ready" },
              uid: providerAssetId,
            },
            success: true,
          }),
      },
    );
    expect(await adapter.getVideo(providerAssetId)).toMatchObject({
      creatorCorrelation: assetId,
      durationSeconds: 900,
      providerAssetId,
      readyToStream: true,
      requireSignedURLs: true,
      state: "ready",
    });
  });

  test("14. lookup and token endpoints classify 401, 403, 404, 429 and 5xx safely", async () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const adapter = createCloudflareStreamPlaybackAdapter(
        {
          accountId: "account-id",
          apiToken: "private-token",
          customerCode,
        },
        { fetchImpl: async () => new Response("private provider detail", { status }) },
      );
      const expectedKind = status === 404 ? "not_found" : "unavailable";
      await expectProviderError(
        () => adapter.getVideo(providerAssetId),
        expectedKind,
      );
      await expectProviderError(
        () => adapter.createSignedPlaybackToken(providerAssetId, nowEpochSeconds),
        expectedKind,
      );
    }
  });

  test("15. lookup and token timeout/network failures are sanitized", async () => {
    const adapter = createCloudflareStreamPlaybackAdapter(
      {
        accountId: "account-id",
        apiToken: "private-token",
        customerCode,
      },
      {
        fetchImpl: async () => {
          throw new Error("private network detail");
        },
      },
    );
    await expectProviderError(
      () => adapter.getVideo(providerAssetId),
      "unavailable",
    );
    await expectProviderError(
      () => adapter.createSignedPlaybackToken(providerAssetId, nowEpochSeconds),
      "unavailable",
    );
  });

  test("16. malformed lookup and token responses fail closed", async () => {
    const responses = [
      () => new Response("not-json", { status: 200 }),
      () => Response.json({ success: false }),
      () => Response.json({ result: {}, success: true }),
      () => Response.json({ result: { token: "" }, success: true }),
    ];
    for (const createResponse of responses) {
      const adapter = createCloudflareStreamPlaybackAdapter(
        {
          accountId: "account-id",
          apiToken: "private-token",
          customerCode,
        },
        { fetchImpl: async () => createResponse() },
      );
      await expectProviderError(
        () => adapter.createSignedPlaybackToken(providerAssetId, nowEpochSeconds),
        "invalid_response",
      );
    }

    const lookup = createCloudflareStreamPlaybackAdapter(
      {
        accountId: "account-id",
        apiToken: "private-token",
        customerCode,
      },
      { fetchImpl: async () => Response.json({ result: {}, success: true }) },
    );
    await expectProviderError(
      () => lookup.getVideo(providerAssetId),
      "invalid_response",
    );
  });

  test("17. provider/config failures map to safe playback errors", async () => {
    const scenarios: Array<[unknown, number, string]> = [
      [new CloudflareStreamPlaybackConfigurationError(), 503, "VIDEO_PLAYBACK_NOT_CONFIGURED"],
      [
        new CloudflareStreamProviderError({
          kind: "invalid_response",
          safeCode: "video_provider_response_invalid",
        }),
        502,
        "VIDEO_PROVIDER_RESPONSE_INVALID",
      ],
      [
        new CloudflareStreamProviderError({
          kind: "not_found",
          safeCode: "video_provider_not_found",
        }),
        409,
        "VIDEO_PLAYBACK_NOT_READY",
      ],
      [
        new CloudflareStreamProviderError({
          kind: "unavailable",
          safeCode: "video_provider_unavailable",
        }),
        503,
        "VIDEO_PROVIDER_UNAVAILABLE",
      ],
    ];
    for (const [failure, status, code] of scenarios) {
      await expect(
        createNativeVideoPlayback({
          database: database(),
          prepareProvider() {
            if (failure instanceof CloudflareStreamPlaybackConfigurationError) {
              throw failure;
            }
            return provider({
              async getVideo() {
                throw failure;
              },
            });
          },
          request: { actorUserId, lessonId, tenantId },
        }),
      ).rejects.toMatchObject({ code, status });
    }
  });

  test("18. source preserves one service-only call chain and does not recreate authorization", () => {
    const route = read(routePath);
    const playback = read(playbackPath);
    const providerSource = read(providerPath);
    const config = read(configPath);
    expect(route).toContain("getBearerToken(request)");
    expect(route).toContain("actorUserId: user.id");
    expect(route).toContain("Object.keys(body).length !== 1");
    expect(route).not.toMatch(/\.from\(["']video_/);
    expect(route).not.toMatch(/cloudflare|provider_asset|video_asset_id/i);
    expect(playback.match(/\.rpc\(/g)).toHaveLength(1);
    expect(playback).toContain('"authorize_native_video_playback_server"');
    expect(playback).not.toMatch(/\.from\(["'](?:lessons|courses|tenant_members|video_)/);
    const orchestration = playback.slice(
      playback.indexOf("export async function createNativeVideoPlayback"),
    );
    expect(orchestration.indexOf("database.authorize")).toBeLessThan(
      orchestration.indexOf("params.prepareProvider"),
    );
    expect(providerSource).toContain("createCloudflareStreamPlaybackAdapter");
    expect(providerSource).toContain("JSON.stringify({ exp: expiresAtEpochSeconds })");
    expect(providerSource).not.toContain("downloadable: true");
    expect(config).toContain("CLOUDFLARE_STREAM_CUSTOMER_CODE");
    expect(config).not.toMatch(/PRIVATE KEY|SIGNING_KEY|WORKERS/i);
  });

  test("19. token-bearing values are absent from monitoring context and standalone response fields", () => {
    const route = read(routePath);
    const playback = read(playbackPath);
    const monitoringCalls = route.match(
      /captureServerException\([\s\S]*?\}\);/g,
    ) ?? [];
    for (const call of monitoringCalls) {
      expect(call).not.toMatch(/playback\.url|signedToken|apiToken|customerCode/);
    }
    expect(playback).not.toMatch(/console\.(?:log|warn|error)/);
    expect(route).not.toMatch(/console\.(?:log|warn|error)/);
    expect(playback).not.toMatch(/token:\s*token/);
    expect(playback).not.toMatch(/providerAssetId:\s*authority\.providerAssetId/);
  });

  test("20. CSP permits only account-scoped Cloudflare Stream player frames", () => {
    const nextConfig = read("next.config.ts");
    expect(nextConfig).toContain("frame-src");
    expect(nextConfig).toContain("getCloudflareStreamFrameSources()");
    expect(nextConfig).toContain("https://www.youtube-nocookie.com");
    expect(nextConfig).toContain("https://player.vimeo.com");
    expect(nextConfig).not.toContain('"https://www.youtube.com"');
    expect(nextConfig).not.toContain("*.cloudflarestream.com");
    expect(nextConfig).not.toContain("*.videodelivery.net");
    expect(nextConfig).not.toMatch(
      /CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_STREAM_API_TOKEN|WEBHOOK_SECRET/,
    );
  });
});
