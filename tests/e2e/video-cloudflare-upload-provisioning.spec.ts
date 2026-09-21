import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildCloudflareTusUploadMetadata,
  cloudflareVideoEditTimeoutMs,
  cloudflareTusTimeoutMs,
  CloudflareStreamProviderError,
  CloudflareTusCreateError,
  createCloudflareTusUpload,
  updateCloudflareStreamAllowedOrigins,
} from "../../src/lib/server/video/cloudflareStream";
import {
  CloudflareStreamConfigurationError,
  getCloudflareStreamAllowedOriginsConfig,
  getCloudflareStreamConfigurationState,
  getCloudflareStreamUploadConfig,
} from "../../src/lib/server/video/cloudflareStreamConfig";
import {
  assertNativeVideoUploadRole,
  type NativeVideoUploadDatabase,
  NativeVideoUploadPublicError,
  normalizeNativeVideoUploadRequest,
  provisionNativeVideoUpload,
} from "../../src/lib/server/video/nativeVideoUploadProvisioning";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const tenantId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";
const claimToken = "55555555-5555-4555-8555-555555555555";
const reservationExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const validRequest = {
  declaredMimeType: "video/mp4",
  declaredSizeBytes: 1_048_576,
  expectedDurationSeconds: 600,
  filename: "lesson.mp4",
  requestId,
  tenantId,
};

type DatabaseOverrides = Partial<NativeVideoUploadDatabase>;

function createDatabase(overrides: DatabaseOverrides = {}) {
  const calls = {
    claim: 0,
    complete: 0,
    fail: 0,
    markAmbiguous: 0,
    reserve: 0,
  };
  const database: NativeVideoUploadDatabase = {
    async reserve() {
      calls.reserve += 1;
      return {
        assetId,
        replayed: false,
        reservationExpiresAt,
        reservedSeconds: 600,
      };
    },
    async claim() {
      calls.claim += 1;
      return {
        action: "create_provider_upload",
        assetId,
        claimToken,
        creatorCorrelation: assetId,
        reservationExpiresAt,
        reservedSeconds: 600,
      };
    },
    async complete(input) {
      calls.complete += 1;
      return {
        assetId: input.assetId,
        expiresAt: input.providerUploadExpiresAt,
        replayed: false,
        reservedSeconds: 600,
        status: "upload_pending",
        uploadUrl: input.uploadUrl,
      };
    },
    async fail() {
      calls.fail += 1;
    },
    async markAmbiguous() {
      calls.markAmbiguous += 1;
    },
    ...overrides,
  };
  return { calls, database };
}

async function expectPublicError(
  action: () => unknown | Promise<unknown>,
  code: string,
) {
  try {
    await action();
    throw new Error("Expected action to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(NativeVideoUploadPublicError);
    expect((error as NativeVideoUploadPublicError).code).toBe(code);
  }
}

function decodeMetadata(metadata: string) {
  return new Map(
    metadata.split(",").map((item) => {
      const [key, encoded] = item.trim().split(" ", 2);
      return [
        key,
        encoded ? Buffer.from(encoded, "base64").toString("utf8") : true,
      ];
    }),
  );
}

test.describe("VIDEO-2B1A Cloudflare TUS upload provisioning", () => {
  test("1. configuration reports only safe booleans and keeps webhook optional", () => {
    expect(getCloudflareStreamConfigurationState({})).toEqual({
      uploadConfigured: false,
      webhookConfigured: false,
    });
    expect(
      getCloudflareStreamConfigurationState({
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_STREAM_API_TOKEN: "private-token",
      }),
    ).toEqual({ uploadConfigured: false, webhookConfigured: false });
    expect(
      getCloudflareStreamConfigurationState({
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_STREAM_ALLOWED_ORIGINS: "coachfort.com",
        CLOUDFLARE_STREAM_API_TOKEN: "private-token",
        CLOUDFLARE_STREAM_WEBHOOK_SECRET: "optional-secret",
      }),
    ).toEqual({ uploadConfigured: true, webhookConfigured: true });
  });

  test("2. missing upload configuration fails without naming environment variables", () => {
    for (const environment of [
      {},
      { CLOUDFLARE_ACCOUNT_ID: "account-id" },
      { CLOUDFLARE_STREAM_API_TOKEN: "private-token" },
    ]) {
      expect(() => getCloudflareStreamUploadConfig(environment)).toThrow(
        CloudflareStreamConfigurationError,
      );
      try {
        getCloudflareStreamUploadConfig(environment);
      } catch (error) {
        expect(String(error)).not.toContain("CLOUDFLARE_");
        expect(String(error)).not.toContain("private-token");
      }
    }
    expect(read(".env.example")).not.toContain("NEXT_PUBLIC_CLOUDFLARE");
  });

  test("2A. Allowed Origins config is strict, normalized and deterministic", () => {
    expect(
      getCloudflareStreamAllowedOriginsConfig({
        CLOUDFLARE_STREAM_ALLOWED_ORIGINS:
          "MEDIA.EXAMPLE.COM,coachfort.com",
        NODE_ENV: "production",
      }),
    ).toEqual({
      allowedOrigins: ["coachfort.com", "media.example.com"],
      allowLocalhost: false,
    });
    expect(
      getCloudflareStreamAllowedOriginsConfig({
        CLOUDFLARE_STREAM_ALLOWED_ORIGINS: "  coachfort.com  ",
        NODE_ENV: "production",
      }),
    ).toEqual({
      allowedOrigins: ["coachfort.com"],
      allowLocalhost: false,
    });

    for (const value of [
      undefined,
      "",
      "coachfort.com,",
      "coachfort.com, media.example.com",
      "coachfort.com,COACHFORT.COM",
      "http://coachfort.com",
      "https://coachfort.com",
      "coachfort.com/app",
      "coachfort.com?mode=video",
      "coachfort.com#video",
      "user@coachfort.com",
      "coachfort.com.",
      "*",
      "*.coachfort.com",
      "media.*.coachfort.com",
      "coachfort\u0000.com",
      "café.example",
      "xn--caf-dma.example",
      "127.0.0.1",
      "[::1]",
      "coachfort.com:443",
      "localhost",
      "localhost:3001",
    ]) {
      expect(() =>
        getCloudflareStreamAllowedOriginsConfig({
          CLOUDFLARE_STREAM_ALLOWED_ORIGINS: value,
          NODE_ENV: "production",
        }),
      ).toThrow(CloudflareStreamConfigurationError);
    }
  });

  test("2B. localhost is allowed only by the explicit development policy", () => {
    expect(
      getCloudflareStreamAllowedOriginsConfig({
        CLOUDFLARE_STREAM_ALLOWED_ORIGINS: "localhost:3000",
        NODE_ENV: "development",
      }),
    ).toEqual({
      allowedOrigins: ["localhost:3000"],
      allowLocalhost: true,
    });
    expect(() =>
      getCloudflareStreamAllowedOriginsConfig({
        CLOUDFLARE_STREAM_ALLOWED_ORIGINS: "localhost:3000",
        NODE_ENV: "production",
      }),
    ).toThrow(CloudflareStreamConfigurationError);
  });

  test("3. TUS request uses the direct-user endpoint and exact safe headers", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const result = await createCloudflareTusUpload(
      { accountId: "account-id", apiToken: "private-token" },
      {
        creatorCorrelation: assetId,
        declaredSizeBytes: validRequest.declaredSizeBytes,
        reservationExpiresAt,
        reservedSeconds: validRequest.expectedDurationSeconds,
      },
      {
        fetchImpl: async (url, init) => {
          requestUrl = String(url);
          requestInit = init;
          return new Response(null, {
            headers: {
              Location: "https://upload.cloudflarestream.com/tus-capability",
              "stream-media-id": "provider-video-uid",
            },
            status: 201,
          });
        },
      },
    );

    expect(requestUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-id/stream?direct_user=true",
    );
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.redirect).toBe("manual");
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer private-token");
    expect(headers["Tus-Resumable"]).toBe("1.0.0");
    expect(headers["Upload-Length"]).toBe(String(validRequest.declaredSizeBytes));
    expect(headers["Upload-Creator"]).toBe(assetId);
    expect(result.providerAssetId).toBe("provider-video-uid");
    expect(result.uploadUrl).toBe(
      "https://upload.cloudflarestream.com/tus-capability",
    );
  });

  test("4. upload metadata contains duration, signed-url policy and bounded expiry only", () => {
    const metadata = buildCloudflareTusUploadMetadata({
      providerUploadExpiresAt: reservationExpiresAt,
      reservedSeconds: 600,
    });
    const values = decodeMetadata(metadata);
    const expected = [
      `maxDurationSeconds ${Buffer.from("600", "utf8").toString("base64")}`,
      "requiresignedurls",
      `expiry ${Buffer.from(reservationExpiresAt, "utf8").toString("base64")}`,
    ].join(",");
    expect(metadata).toBe(expected);
    expect(metadata.match(/(?:^|,)requiresignedurls(?:,|$)/g)).toHaveLength(1);
    expect(metadata).not.toMatch(/requiresignedurls\s+[^,]+/);
    expect(metadata.endsWith(",")).toBe(false);
    expect(values.get("maxDurationSeconds")).toBe("600");
    expect(values.get("requiresignedurls")).toBe(true);
    expect(values.get("expiry")).toBe(reservationExpiresAt);
    expect([...values.keys()]).toEqual([
      "maxDurationSeconds",
      "requiresignedurls",
      "expiry",
    ]);
    expect(metadata.toLowerCase()).not.toContain("allowedorigins");
    for (const forbidden of [
      "tenant",
      "coach",
      "student",
      "email",
      "lesson",
      "billing",
      validRequest.filename,
    ]) {
      expect(metadata.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  test("4A. provider edit applies only Allowed Origins and verifies hardened response", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const result = await updateCloudflareStreamAllowedOrigins(
      { accountId: "account-id", apiToken: "private-token" },
      {
        allowedOrigins: ["media.example.com", "coachfort.com"],
        creatorCorrelation: assetId,
        providerAssetId: "provider-video-uid",
      },
      {
        fetchImpl: async (url, init) => {
          calls.push({ init, url: String(url) });
          return Response.json({
            result: {
              allowedOrigins: ["coachfort.com", "media.example.com"],
              creator: assetId,
              requireSignedURLs: true,
              uid: "provider-video-uid",
            },
            success: true,
          });
        },
      },
    );

    expect(result).toEqual({
      allowedOrigins: ["coachfort.com", "media.example.com"],
      providerAssetId: "provider-video-uid",
      requireSignedURLs: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-id/stream/provider-video-uid",
    );
    expect(calls[0].init).toMatchObject({
      cache: "no-store",
      method: "POST",
      redirect: "manual",
    });
    expect(calls[0].init?.headers).toEqual({
      Authorization: "Bearer private-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      allowedOrigins: ["coachfort.com", "media.example.com"],
    });
    expect(Object.keys(JSON.parse(String(calls[0].init?.body)))).toEqual([
      "allowedOrigins",
    ]);
  });

  test("4AA. provider edit accepts localhost only through explicit development policy", async () => {
    for (const options of [{}, { allowLocalhost: false }]) {
      let providerFetches = 0;
      await expect(
        updateCloudflareStreamAllowedOrigins(
          { accountId: "account-id", apiToken: "private-token" },
          {
            allowedOrigins: ["localhost:3000"],
            creatorCorrelation: assetId,
            providerAssetId: "provider-video-uid",
          },
          {
            ...options,
            fetchImpl: async () => {
              providerFetches += 1;
              throw new Error("provider fetch must not run");
            },
          },
        ),
      ).rejects.toMatchObject({
        safeCode: "video_provider_response_invalid",
      });
      expect(providerFetches).toBe(0);
    }

    const accepted = await updateCloudflareStreamAllowedOrigins(
      { accountId: "account-id", apiToken: "private-token" },
      {
        allowedOrigins: ["localhost:3000"],
        creatorCorrelation: assetId,
        providerAssetId: "provider-video-uid",
      },
      {
        allowLocalhost: true,
        fetchImpl: async () =>
          Response.json({
            result: {
              allowedOrigins: ["localhost:3000"],
              creator: assetId,
              requireSignedURLs: true,
              uid: "provider-video-uid",
            },
            success: true,
          }),
      },
    );
    expect(accepted.allowedOrigins).toEqual(["localhost:3000"]);

    await expect(
      updateCloudflareStreamAllowedOrigins(
        { accountId: "account-id", apiToken: "private-token" },
        {
          allowedOrigins: ["coachfort.com"],
          creatorCorrelation: assetId,
          providerAssetId: "provider-video-uid",
        },
        {
          allowLocalhost: false,
          fetchImpl: async () =>
            Response.json({
              result: {
                allowedOrigins: ["localhost:3000"],
                creator: assetId,
                requireSignedURLs: true,
                uid: "provider-video-uid",
              },
              success: true,
            }),
        },
      ),
    ).rejects.toMatchObject({
      safeCode: "video_provider_response_invalid",
    });

    const adapterSource = read("src/lib/server/video/cloudflareStream.ts");
    expect(adapterSource).not.toContain(
      'input.allowedOrigins.includes("localhost:3000")',
    );
    expect(adapterSource).not.toContain(
      'requestedOrigins.includes("localhost:3000")',
    );
    expect(adapterSource).toContain(
      "allowLocalhost: options.allowLocalhost === true",
    );
  });

  test("4B. provider edit rejects every incomplete or conflicting hardened response", async () => {
    const baseResult = {
      allowedOrigins: ["coachfort.com"],
      creator: assetId,
      requireSignedURLs: true,
      uid: "provider-video-uid",
    };
    const invalidResults: unknown[] = [
      null,
      {},
      { ...baseResult, uid: "wrong-provider-uid" },
      { ...baseResult, uid: undefined },
      { ...baseResult, creator: "wrong-creator" },
      { ...baseResult, creator: undefined },
      { ...baseResult, requireSignedURLs: false },
      { ...baseResult, requireSignedURLs: undefined },
      { ...baseResult, allowedOrigins: undefined },
      { ...baseResult, allowedOrigins: [] },
      { ...baseResult, allowedOrigins: ["https://coachfort.com"] },
      { ...baseResult, allowedOrigins: ["coachfort.com", "coachfort.com"] },
      { ...baseResult, allowedOrigins: ["coachfort.com", "extra.example.com"] },
      { ...baseResult, allowedOrigins: ["media.example.com"] },
    ];

    for (const providerResult of invalidResults) {
      await expect(
        updateCloudflareStreamAllowedOrigins(
          { accountId: "account-id", apiToken: "private-token" },
          {
            allowedOrigins: ["coachfort.com"],
            creatorCorrelation: assetId,
            providerAssetId: "provider-video-uid",
          },
          {
            fetchImpl: async () =>
              Response.json({ result: providerResult, success: true }),
          },
        ),
      ).rejects.toMatchObject({
        safeCode: "video_provider_response_invalid",
      });
    }

    await expect(
      updateCloudflareStreamAllowedOrigins(
        { accountId: "account-id", apiToken: "private-token" },
        {
          allowedOrigins: ["coachfort.com"],
          creatorCorrelation: assetId,
          providerAssetId: "provider-video-uid",
        },
        {
          fetchImpl: async () =>
            Response.json({ result: baseResult, success: false }),
        },
      ),
    ).rejects.toMatchObject({ safeCode: "video_provider_response_invalid" });
  });

  test("4C. provider edit maps HTTP, network, timeout and malformed JSON failures safely", async () => {
    for (const status of [302, 401, 403, 404, 429, 500, 503]) {
      await expect(
        updateCloudflareStreamAllowedOrigins(
          { accountId: "account-id", apiToken: "private-token" },
          {
            allowedOrigins: ["coachfort.com"],
            creatorCorrelation: assetId,
            providerAssetId: "provider-video-uid",
          },
          { fetchImpl: async () => new Response(null, { status }) },
        ),
      ).rejects.toBeInstanceOf(CloudflareStreamProviderError);
    }

    for (const fetchImpl of [
      async () => {
        throw new Error("private network detail");
      },
      async () => new Response("not-json", { status: 200 }),
    ]) {
      await expect(
        updateCloudflareStreamAllowedOrigins(
          { accountId: "account-id", apiToken: "private-token" },
          {
            allowedOrigins: ["coachfort.com"],
            creatorCorrelation: assetId,
            providerAssetId: "provider-video-uid",
          },
          { fetchImpl },
        ),
      ).rejects.toBeInstanceOf(CloudflareStreamProviderError);
    }

    await expect(
      updateCloudflareStreamAllowedOrigins(
        { accountId: "account-id", apiToken: "private-token" },
        {
          allowedOrigins: ["coachfort.com"],
          creatorCorrelation: assetId,
          providerAssetId: "provider-video-uid",
        },
        {
          fetchImpl: async (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new Error("aborted private detail")),
              );
            }),
          timeoutMs: 1,
        },
      ),
    ).rejects.toMatchObject({ safeCode: "video_provider_unavailable" });
    expect(cloudflareVideoEditTimeoutMs).toBe(10_000);
  });

  test("5. provider expiry is rounded down and never exceeds reservation expiry", async () => {
    const unroundedExpiry = new Date(Date.now() + 3_600_987).toISOString();
    const result = await createCloudflareTusUpload(
      { accountId: "account-id", apiToken: "private-token" },
      {
        creatorCorrelation: assetId,
        declaredSizeBytes: 10,
        reservationExpiresAt: unroundedExpiry,
        reservedSeconds: 1,
      },
      {
        fetchImpl: async () =>
          new Response(null, {
            headers: {
              Location: "https://upload.cloudflarestream.com/capability",
              "stream-media-id": "uid",
            },
            status: 201,
          }),
      },
    );
    expect(Date.parse(result.providerUploadExpiresAt)).toBeLessThanOrEqual(
      Date.parse(unroundedExpiry),
    );
    expect(result.providerUploadExpiresAt).toMatch(/\.000Z$/);
  });

  test("6. provider UID must come from stream-media-id rather than Location", async () => {
    await expect(
      createCloudflareTusUpload(
        { accountId: "account-id", apiToken: "private-token" },
        {
          creatorCorrelation: assetId,
          declaredSizeBytes: 10,
          reservationExpiresAt,
          reservedSeconds: 1,
        },
        {
          fetchImpl: async () =>
            new Response(null, {
              headers: {
                Location:
                  "https://upload.cloudflarestream.com/provider-id-in-url",
              },
              status: 201,
            }),
        },
      ),
    ).rejects.toMatchObject({ outcome: "ambiguous" });
  });

  test("7. missing Location and malformed successful responses are ambiguous", async () => {
    for (const headers of [
      new Headers({ "stream-media-id": "uid" }),
      new Headers({
        Location: "not-https",
        "stream-media-id": "uid",
      }),
    ]) {
      await expect(
        createCloudflareTusUpload(
          { accountId: "account-id", apiToken: "private-token" },
          {
            creatorCorrelation: assetId,
            declaredSizeBytes: 10,
            reservationExpiresAt,
            reservedSeconds: 1,
          },
          {
            fetchImpl: async () =>
              new Response("raw-provider-secret", { headers, status: 201 }),
          },
        ),
      ).rejects.toMatchObject({
        outcome: "ambiguous",
        safeCode: "provider_creation_response_invalid",
      });
    }
  });

  test("8. definite rejection is narrow while timeout, 5xx and network failures are ambiguous", async () => {
    const input = {
      creatorCorrelation: assetId,
      declaredSizeBytes: 10,
      reservationExpiresAt,
      reservedSeconds: 1,
    };
    await expect(
      createCloudflareTusUpload(
        { accountId: "account-id", apiToken: "private-token" },
        input,
        { fetchImpl: async () => new Response("secret", { status: 400 }) },
      ),
    ).rejects.toMatchObject({ outcome: "definite_failure" });
    await expect(
      createCloudflareTusUpload(
        { accountId: "account-id", apiToken: "private-token" },
        input,
        { fetchImpl: async () => new Response("secret", { status: 503 }) },
      ),
    ).rejects.toMatchObject({ outcome: "ambiguous" });
    await expect(
      createCloudflareTusUpload(
        { accountId: "account-id", apiToken: "private-token" },
        input,
        { fetchImpl: async () => new Response("secret", { status: 408 }) },
      ),
    ).rejects.toMatchObject({ outcome: "ambiguous" });
    await expect(
      createCloudflareTusUpload(
        { accountId: "account-id", apiToken: "private-token" },
        input,
        { fetchImpl: async () => Promise.reject(new Error("connection reset")) },
      ),
    ).rejects.toMatchObject({ outcome: "ambiguous" });
  });

  test("9. timeout is bounded, ambiguous and never retried", async () => {
    let calls = 0;
    await expect(
      createCloudflareTusUpload(
        { accountId: "account-id", apiToken: "private-token" },
        {
          creatorCorrelation: assetId,
          declaredSizeBytes: 10,
          reservationExpiresAt,
          reservedSeconds: 1,
        },
        {
          fetchImpl: async (_url, init) => {
            calls += 1;
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
            });
          },
          timeoutMs: 5,
        },
      ),
    ).rejects.toMatchObject({ outcome: "ambiguous" });
    expect(calls).toBe(1);
    expect(cloudflareTusTimeoutMs).toBe(15_000);
  });

  test("10. Owner and Admin are allowed while other actors are denied", () => {
    expect(() => assertNativeVideoUploadRole("owner")).not.toThrow();
    expect(() => assertNativeVideoUploadRole("admin")).not.toThrow();
    for (const role of ["staff", "trainer", "student", null, undefined]) {
      expect(() => assertNativeVideoUploadRole(role)).toThrow(
        NativeVideoUploadPublicError,
      );
    }
  });

  test("11. request validation mirrors VIDEO-2A limits", () => {
    expect(normalizeNativeVideoUploadRequest(validRequest)).toEqual(validRequest);
    const invalidCases = [
      { tenantId: "bad" },
      { requestId: "bad" },
      { expectedDurationSeconds: 0 },
      { expectedDurationSeconds: 7201 },
      { declaredSizeBytes: 0 },
      { declaredSizeBytes: 10_737_418_241 },
      { declaredMimeType: "video/unsupported" },
      { filename: "unsafe/path.mp4" },
      { filename: "x".repeat(256) },
    ];
    for (const change of invalidCases) {
      expect(() =>
        normalizeNativeVideoUploadRequest({ ...validRequest, ...change }),
      ).toThrow(NativeVideoUploadPublicError);
    }
  });

  test("12. reservation failure stops before claim or Cloudflare", async () => {
    let providerCalls = 0;
    const { calls, database } = createDatabase({
      async reserve() {
        calls.reserve += 1;
        throw new NativeVideoUploadPublicError(
          "VIDEO_CAPACITY_FULL",
          "Video storage capacity is full.",
          409,
        );
      },
    });
    await expectPublicError(
      () =>
        provisionNativeVideoUpload({
          actorUserId,
          database,
          prepareProviderUpload: () => async () => {
            providerCalls += 1;
            throw new Error("must not run");
          },
          request: validRequest,
        }),
      "VIDEO_CAPACITY_FULL",
    );
    expect(calls.claim).toBe(0);
    expect(providerCalls).toBe(0);
  });

  test("13. lifecycle and entitlement denials stop before Cloudflare", async () => {
    for (const reason of ["inactive lifecycle", "feature entitlement denied"]) {
      let providerCalls = 0;
      const { calls, database } = createDatabase({
        async reserve() {
          calls.reserve += 1;
          throw new NativeVideoUploadPublicError(
            "VIDEO_UPLOAD_FORBIDDEN",
            reason,
            403,
          );
        },
      });
      await expectPublicError(
        () =>
          provisionNativeVideoUpload({
            actorUserId,
            database,
            prepareProviderUpload: () => async () => {
              providerCalls += 1;
              throw new Error("must not run");
            },
            request: validRequest,
          }),
        "VIDEO_UPLOAD_FORBIDDEN",
      );
      expect(calls.claim).toBe(0);
      expect(providerCalls).toBe(0);
    }
  });

  test("14. create_provider_upload calls Cloudflare exactly once and completes as upload_pending", async () => {
    let providerCalls = 0;
    const { calls, database } = createDatabase();
    const result = await provisionNativeVideoUpload({
      actorUserId,
      database,
      prepareProviderUpload: () => async (input) => {
        providerCalls += 1;
        expect(input.creatorCorrelation).toBe(assetId);
        expect(input.reservedSeconds).toBe(600);
        return {
          providerAssetId: "provider-uid",
          providerUploadExpiresAt: reservationExpiresAt,
          uploadUrl: "https://upload.cloudflarestream.com/capability",
        };
      },
      request: validRequest,
    });
    expect(providerCalls).toBe(1);
    expect(calls.complete).toBe(1);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ assetId, replayed: false });
    expect(result.body).not.toHaveProperty("providerAssetId");
  });

  test("15. wait, replay, reconcile and closed never create another provider upload", async () => {
    const cases = [
      { action: "wait", expectedStatus: 202 },
      { action: "reconcile_required", expectedStatus: 202 },
      { action: "replay_existing", expectedStatus: 200 },
      { action: "closed", expectedStatus: 409 },
    ] as const;
    for (const current of cases) {
      let providerCalls = 0;
      const { database } = createDatabase({
        async claim() {
          if (current.action === "replay_existing") {
            return {
              action: current.action,
              assetId,
              expiresAt: reservationExpiresAt,
              reservedSeconds: 600,
              uploadUrl: "https://upload.cloudflarestream.com/existing",
            };
          }
          return { action: current.action, assetId };
        },
      });
      try {
        const result = await provisionNativeVideoUpload({
          actorUserId,
          database,
          prepareProviderUpload: () => async () => {
            providerCalls += 1;
            throw new Error("must not run");
          },
          request: validRequest,
        });
        expect(result.status).toBe(current.expectedStatus);
      } catch (error) {
        expect(current.action).toBe("closed");
        expect((error as NativeVideoUploadPublicError).status).toBe(409);
      }
      expect(providerCalls).toBe(0);
    }
  });

  test("16. ambiguous provider outcomes mark reconciliation without retry", async () => {
    let providerCalls = 0;
    const operationalStages: string[] = [];
    const { calls, database } = createDatabase();
    const result = await provisionNativeVideoUpload({
      actorUserId,
      database,
      onOperationalError(_error, stage) {
        operationalStages.push(stage);
      },
      prepareProviderUpload: () => async () => {
        providerCalls += 1;
        throw new CloudflareTusCreateError({
          outcome: "ambiguous",
          safeCode: "provider_creation_outcome_unknown",
        });
      },
      request: validRequest,
    });
    expect(providerCalls).toBe(1);
    expect(calls.markAmbiguous).toBe(1);
    expect(calls.fail).toBe(0);
    expect(operationalStages).toContain("provider_create");
    expect(result).toMatchObject({
      status: 202,
      body: { code: "VIDEO_RECONCILIATION_REQUIRED" },
    });
  });

  test("17. definite provider rejection invokes fail authority", async () => {
    const { calls, database } = createDatabase();
    await expectPublicError(
      () =>
        provisionNativeVideoUpload({
          actorUserId,
          database,
          prepareProviderUpload: () => async () => {
            throw new CloudflareTusCreateError({
              outcome: "definite_failure",
              safeCode: "provider_creation_rejected",
            });
          },
          request: validRequest,
        }),
      "VIDEO_UPLOAD_CREATION_FAILED",
    );
    expect(calls.fail).toBe(1);
    expect(calls.markAmbiguous).toBe(0);
    expect(calls.complete).toBe(0);
  });

  test("18. provider success followed by completion failure never creates again", async () => {
    let providerCalls = 0;
    const { calls, database } = createDatabase({
      async complete() {
        calls.complete += 1;
        throw new NativeVideoUploadPublicError(
          "VIDEO_UPLOAD_CREATION_FAILED",
          "Video upload preparation failed.",
          500,
        );
      },
    });
    const result = await provisionNativeVideoUpload({
      actorUserId,
      database,
      prepareProviderUpload: () => async () => {
        providerCalls += 1;
        return {
          providerAssetId: "provider-uid",
          providerUploadExpiresAt: reservationExpiresAt,
          uploadUrl: "https://upload.cloudflarestream.com/capability",
        };
      },
      request: validRequest,
    });
    expect(providerCalls).toBe(1);
    expect(calls.markAmbiguous).toBe(1);
    expect(result.status).toBe(202);
  });

  test("18A. post-create hardening failure is ambiguous and withholds completion", async () => {
    const { calls, database } = createDatabase();
    const result = await provisionNativeVideoUpload({
      actorUserId,
      database,
      prepareProviderUpload: () => async () => {
        throw new CloudflareStreamProviderError({
          kind: "unavailable",
          safeCode: "video_provider_unavailable",
        });
      },
      request: validRequest,
    });

    expect(result).toMatchObject({
      body: { code: "VIDEO_RECONCILIATION_REQUIRED", status: "pending" },
      status: 202,
    });
    expect(calls.markAmbiguous).toBe(1);
    expect(calls.complete).toBe(0);
    expect(calls.fail).toBe(0);
  });

  test("18B. fresh-only origin configuration failure closes before provider mutation", async () => {
    let providerMutations = 0;
    const { calls, database } = createDatabase();
    await expectPublicError(
      () =>
        provisionNativeVideoUpload({
          actorUserId,
          database,
          prepareProviderUpload: () => async () => {
            getCloudflareStreamAllowedOriginsConfig({ NODE_ENV: "production" });
            providerMutations += 1;
            throw new Error("must not run");
          },
          request: validRequest,
        }),
      "VIDEO_NOT_CONFIGURED",
    );
    expect(providerMutations).toBe(0);
    expect(calls.reserve).toBe(1);
    expect(calls.claim).toBe(1);
    expect(calls.fail).toBe(1);
    expect(calls.markAmbiguous).toBe(0);
    expect(calls.complete).toBe(0);
  });

  test("19. missing configuration stops before reservation, claim or provider call", async () => {
    let providerCalls = 0;
    const loadMissingConfiguration = () => {
      throw new CloudflareStreamConfigurationError();
    };
    const { calls, database } = createDatabase();
    await expectPublicError(
      () =>
        provisionNativeVideoUpload({
          actorUserId,
          database,
          prepareProviderUpload: () => {
            loadMissingConfiguration();
            return async () => {
              providerCalls += 1;
              throw new Error("must not run");
            };
          },
          request: validRequest,
        }),
      "VIDEO_NOT_CONFIGURED",
    );
    expect(calls.reserve).toBe(0);
    expect(calls.claim).toBe(0);
    expect(calls.fail).toBe(0);
    expect(calls.complete).toBe(0);
    expect(providerCalls).toBe(0);
  });

  test("20. route authenticates actor and membership without accepting actorUserId", () => {
    const route = read("app/api/video/uploads/route.ts");
    expect(route).toContain("getBearerToken(request)");
    expect(route).toContain("requireAuthenticatedUser(accessToken)");
    expect(route).toContain('.from("tenant_members")');
    expect(route).toContain("assertNativeVideoUploadRole(membership.data?.role)");
    expect(route).not.toContain("body.actorUserId");
    expect(route.indexOf("requireAuthenticatedUser(accessToken)")).toBeLessThan(
      route.indexOf("normalizeNativeVideoUploadRequest("),
    );
    expect(route.indexOf("normalizeNativeVideoUploadRequest(")).toBeLessThan(
      route.indexOf('.from("tenant_members")'),
    );
    expect(route.indexOf("assertNativeVideoUploadRole(membership.data?.role)")).toBeLessThan(
      route.indexOf("provisionNativeVideoUpload({"),
    );
    expect(route.indexOf("getCloudflareStreamUploadConfig()")).toBeLessThan(
      route.indexOf("createCloudflareTusUpload(config, input)"),
    );
    expect(route.indexOf("getCloudflareStreamAllowedOriginsConfig()"))
      .toBeLessThan(route.indexOf("createCloudflareTusUpload(config, input)"));
    expect(route).toContain("const { allowedOrigins, allowLocalhost }");
    expect(route).toContain("{ allowLocalhost },");
    expect(route.indexOf("createCloudflareTusUpload(config, input)"))
      .toBeLessThan(route.indexOf("updateCloudflareStreamAllowedOrigins("));
    expect(route.indexOf("updateCloudflareStreamAllowedOrigins("))
      .toBeLessThan(route.indexOf("return providerUpload"));
    expect(route).not.toContain("deleteVideo(");
  });

  test("21. route and database preserve reservation-claim-provider-completion order", () => {
    const source = read(
      "src/lib/server/video/nativeVideoUploadProvisioning.ts",
    );
    const flow = source.slice(source.indexOf("export async function provisionNativeVideoUpload"));
    expect(flow.indexOf("params.prepareProviderUpload")).toBeLessThan(
      flow.indexOf("params.database.reserve"),
    );
    expect(flow.indexOf("params.database.reserve")).toBeLessThan(
      flow.indexOf("params.database.claim"),
    );
    expect(flow.indexOf("params.database.claim")).toBeLessThan(
      flow.indexOf("createProviderUpload({"),
    );
    expect(flow.indexOf("createProviderUpload({")).toBeLessThan(
      flow.indexOf("params.database.complete"),
    );
    for (const rpcName of [
      "reserve_native_video_upload_server",
      "claim_native_video_upload_provisioning_server",
      "complete_native_video_upload_provisioning_server",
      "mark_native_video_upload_provisioning_ambiguous_server",
      "fail_unbound_native_video_upload_server",
    ]) {
      expect(source).toContain(rpcName);
    }
  });

  test("21A. replay bypasses fresh origin config and all provider mutations", async () => {
    let freshConfigurationLoads = 0;
    let providerMutations = 0;
    const { calls, database } = createDatabase({
      async claim() {
        calls.claim += 1;
        return {
          action: "replay_existing",
          assetId,
          expiresAt: reservationExpiresAt,
          reservedSeconds: 600,
          uploadUrl: "https://upload.cloudflarestream.com/existing",
        };
      },
    });
    const result = await provisionNativeVideoUpload({
      actorUserId,
      database,
      prepareProviderUpload: () => async () => {
        freshConfigurationLoads += 1;
        providerMutations += 1;
        throw new Error("must not run");
      },
      request: validRequest,
    });

    expect(result).toMatchObject({
      body: { assetId, replayed: true },
      status: 200,
    });
    expect(freshConfigurationLoads).toBe(0);
    expect(providerMutations).toBe(0);
    expect(calls.complete).toBe(0);
    expect(calls.fail).toBe(0);
    expect(calls.markAmbiguous).toBe(0);
  });

  test("22. public route errors contain no secrets, SQLSTATE, function names or environment names", () => {
    const route = read("app/api/video/uploads/route.ts");
    const publicErrors = route.slice(
      route.indexOf("function errorResponse"),
      route.indexOf("export async function POST"),
    );
    for (const forbidden of [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_STREAM_API_TOKEN",
      "CLOUDFLARE_STREAM_ALLOWED_ORIGINS",
      "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
      "SQLSTATE",
      "reserve_native_video_upload_server",
      "claim_native_video_upload_provisioning_server",
      "accountId",
      "apiToken",
    ]) {
      expect(route).not.toContain(forbidden);
    }
    expect(publicErrors).not.toMatch(/providerAssetId|allowedOrigins|providerUpload/);
    for (const monitoringCall of route.matchAll(
      /captureServerException\([\s\S]*?\n\s*}\);/g,
    )) {
      expect(monitoringCall[0]).not.toMatch(
        /providerAssetId|allowedOrigins|apiToken|accountId/,
      );
    }
  });

  test("23. Cloudflare modules remain server-route dependencies only", () => {
    const clientFiles = [
      ...read("tests/e2e/route-guard-static.spec.ts").matchAll(/read\("([^"]+)"\)/g),
    ].map((match) => match[1]);
    for (const path of clientFiles.filter((path) => path.includes("components/"))) {
      const source = read(path);
      expect(source).not.toContain("cloudflareStream");
      expect(source).not.toContain("nativeVideoUploadProvisioning");
    }
    expect(read("app/api/video/uploads/route.ts")).toContain(
      "@/src/lib/server/video/cloudflareStream",
    );
  });

  test("24. this bundle adds no webhook, reconciliation worker, cron, uploader or playback path", () => {
    const route = read("app/api/video/uploads/route.ts");
    const adapter = read("src/lib/server/video/cloudflareStream.ts");
    expect(route).not.toContain("webhook");
    expect(route).not.toContain("reconciliation_batch");
    expect(route).not.toContain("signed playback");
    expect(adapter).not.toContain("tus-js-client");
    expect(read("vercel.json")).not.toContain("/api/video/");
  });
});
