import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  isNativeVideoUploadCapabilityUrl,
  nativeVideoUploadCapabilitySpanPattern,
  scrubMonitoringValue,
  scrubNativeVideoUploadCapabilities,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
} from "../../src/lib/monitoring";
import {
  advanceNativeVideoRecoveryRecord,
  canContinueNativeVideoUpload,
  canStartNativeVideoUpload,
  clearNativeVideoRecoveryRecord,
  createNativeVideoRecoveryRecord,
  extractNativeVideoDuration,
  getNativeVideoFileSelectionDecision,
  getNativeVideoSuccessfulSelectionPhase,
  getNativeVideoRecoveryKey,
  getNativeVideoUploadErrorMessage,
  nativeVideoAllowedMimeTypes,
  nativeVideoFileMatchesRecovery,
  nativeVideoMaximumBytes,
  normalizeNativeVideoRecoveryRecord,
  provisionNativeVideoUpload,
  readNativeVideoRecoveryRecord,
  validateNativeVideoFile,
  writeNativeVideoRecoveryRecord,
  NativeVideoUploadClientError,
} from "../../src/lib/video/nativeVideoUploadClient";
import {
  classifyNativeVideoTusError,
  createNativeVideoTusHttpStack,
  createNativeVideoTusUpload,
  nativeVideoTusChunkSizeBytes,
  shouldRetryNativeVideoTusError,
} from "../../src/lib/video/nativeVideoTusUpload";

const root = process.cwd();
const tenantId = "f93faeee-b177-497e-854e-5052497914b9";
const requestId = "60eb936c-d3e3-48bb-8e35-46087348d5bb";
const assetId = "c3cd5bfd-7112-43a9-84e9-63bf69b6fd58";
const uploadUrl = "https://upload.cloudflarestream.com/tus/capability-secret?sig=private";

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function testFile(overrides: Partial<Pick<File, "lastModified" | "name" | "size" | "type">> = {}) {
  return {
    lastModified: 1_790_000_000_000,
    name: "lesson.mp4",
    size: 4_096,
    type: "video/mp4",
    ...overrides,
  } as File;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

function response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test.describe("VIDEO-2C2D2-C browser native video upload", () => {
  test("pins tus-js-client 4.3.1 in package and lockfile", () => {
    const packageJson = JSON.parse(read("package.json"));
    const lockfile = JSON.parse(read("package-lock.json"));
    expect(packageJson.dependencies["tus-js-client"]).toBe("4.3.1");
    expect(lockfile.packages["node_modules/tus-js-client"].version).toBe("4.3.1");
    expect(lockfile.packages["node_modules/tus-js-client"].integrity).toBeTruthy();
  });

  test("accepts only the approved MIME types and bounded byte sizes", () => {
    expect(nativeVideoAllowedMimeTypes).toEqual([
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-matroska",
      "video/x-msvideo",
      "video/mpeg",
    ]);
    for (const type of nativeVideoAllowedMimeTypes) {
      expect(validateNativeVideoFile(testFile({ type })).mimeType).toBe(type);
    }
    expect(validateNativeVideoFile(testFile({ size: 1 })).sizeBytes).toBe(1);
    expect(validateNativeVideoFile(testFile({ size: nativeVideoMaximumBytes })).sizeBytes).toBe(nativeVideoMaximumBytes);
    expect(() => validateNativeVideoFile(testFile({ size: 0 }))).toThrow(NativeVideoUploadClientError);
    expect(() => validateNativeVideoFile(testFile({ size: nativeVideoMaximumBytes + 1 }))).toThrow(NativeVideoUploadClientError);
    expect(() => validateNativeVideoFile(testFile({ type: "application/octet-stream" }))).toThrow(NativeVideoUploadClientError);
    expect(() => validateNativeVideoFile(testFile({ name: "folder/video.mp4" }))).toThrow(NativeVideoUploadClientError);
  });

  test("extracts, rounds and bounds duration while always revoking object URLs", async () => {
    const revoked: string[] = [];
    let video: Record<string, unknown>;
    const environment = {
      createObjectURL: () => "blob:local-video",
      createVideo() {
        video = {
          duration: 15.01,
          load() {
            const handler = video.onloadedmetadata as (() => void) | null;
            handler?.();
          },
          onerror: null,
          onloadedmetadata: null,
          preload: "",
          removeAttribute: () => undefined,
          src: "",
        };
        return video;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    };
    await expect(extractNativeVideoDuration(testFile(), environment as never)).resolves.toBe(16);
    expect(revoked).toEqual(["blob:local-video"]);

    const invalidEnvironment = {
      ...environment,
      createVideo() {
        video = {
          duration: Number.POSITIVE_INFINITY,
          load() {
            (video.onloadedmetadata as (() => void) | null)?.();
          },
          onerror: null,
          onloadedmetadata: null,
          preload: "",
          removeAttribute: () => undefined,
          src: "",
        };
        return video;
      },
    };
    await expect(extractNativeVideoDuration(testFile(), invalidEnvironment as never)).rejects.toThrow(
      NativeVideoUploadClientError,
    );
    expect(revoked).toEqual(["blob:local-video", "blob:local-video"]);
  });

  test("recovery stores one safe logical identity without any capability material", () => {
    const storage = memoryStorage();
    const record = createNativeVideoRecoveryRecord({
      durationSeconds: 15,
      file: testFile(),
      now: () => new Date("2026-09-26T10:00:00Z"),
      requestId,
      safePhase: "ready_to_start",
      tenantId,
    });
    writeNativeVideoRecoveryRecord(record, storage);
    expect(readNativeVideoRecoveryRecord(tenantId, storage)).toEqual(record);
    expect(getNativeVideoRecoveryKey(tenantId)).toContain(tenantId);
    const serialized = [...storage.values.values()].join("");
    for (const forbidden of ["uploadUrl", "expiresAt", "provider", "offset", "Authorization", "token", "secret"]) {
      expect(serialized).not.toContain(forbidden);
    }
    clearNativeVideoRecoveryRecord(tenantId, storage);
    expect(storage.values.size).toBe(0);
  });

  test("recovery accepts only exact, versioned records and exact file reselection", () => {
    const record = createNativeVideoRecoveryRecord({
      durationSeconds: 15,
      file: testFile(),
      requestId,
      safePhase: "paused_or_interrupted",
      tenantId,
    });
    expect(normalizeNativeVideoRecoveryRecord(record)).toEqual(record);
    expect(nativeVideoFileMatchesRecovery(testFile(), record)).toBe(true);
    expect(nativeVideoFileMatchesRecovery(testFile({ name: "other.mp4" }), record)).toBe(false);
    expect(nativeVideoFileMatchesRecovery(testFile({ size: 4_097 }), record)).toBe(false);
    expect(nativeVideoFileMatchesRecovery(testFile({ type: "video/webm" }), record)).toBe(false);
    expect(nativeVideoFileMatchesRecovery(testFile({ lastModified: 1 }), record)).toBe(false);
    expect(normalizeNativeVideoRecoveryRecord({ ...record, version: 2 })).toBeNull();
    expect(normalizeNativeVideoRecoveryRecord({ ...record, uploadUrl })).toBeNull();
  });

  test("file replacement is allowed only before canonical provisioning begins", () => {
    const original = testFile();
    const replacement = testFile({ lastModified: 1_790_000_000_100, name: "replacement.mp4" });
    const localAttempt = createNativeVideoRecoveryRecord({
      durationSeconds: 15,
      file: original,
      requestId,
      safePhase: "ready_to_start",
      tenantId,
    });
    expect(getNativeVideoFileSelectionDecision(original, localAttempt)).toBe("resume_attempt");
    expect(getNativeVideoFileSelectionDecision(replacement, localAttempt)).toBe("replace_local_attempt");

    const ambiguousAttempt = { ...localAttempt, safePhase: "provisioning" as const };
    const canonicalAttempt = { ...localAttempt, assetId, safePhase: "paused_or_interrupted" as const };
    expect(getNativeVideoFileSelectionDecision(replacement, ambiguousAttempt)).toBe("require_original_file");
    expect(getNativeVideoFileSelectionDecision(replacement, canonicalAttempt)).toBe("require_original_file");
    expect(getNativeVideoFileSelectionDecision(replacement, null)).toBe("new_attempt");
    expect(getNativeVideoSuccessfulSelectionPhase("resume_attempt", localAttempt)).toBe("ready_to_start");
    expect(getNativeVideoSuccessfulSelectionPhase("resume_attempt", canonicalAttempt)).toBe("paused_or_interrupted");
    expect(getNativeVideoSuccessfulSelectionPhase("resume_attempt", {
      ...canonicalAttempt,
      safePhase: "cancelled_local",
    })).toBe("cancelled_local");
  });

  test("initial capacity and same-request continuation use distinct gates", () => {
    const initial = {
      capacityAvailable: true,
      capacitySufficient: true,
      hasFile: true,
      operationalUploadAllowed: true,
      phase: "ready_to_start",
    };
    expect(canStartNativeVideoUpload(initial)).toBe(true);
    expect(canStartNativeVideoUpload({ ...initial, capacityAvailable: false })).toBe(false);
    expect(canStartNativeVideoUpload({ ...initial, capacitySufficient: false })).toBe(false);

    const continuation = {
      hasFile: true,
      operationalUploadAllowed: true,
      phase: "paused_or_interrupted",
    };
    expect(canContinueNativeVideoUpload(continuation)).toBe(true);
    expect(canContinueNativeVideoUpload({ ...continuation, phase: "cancelled_local" })).toBe(true);
    expect(canContinueNativeVideoUpload({ ...continuation, hasFile: false })).toBe(false);
    expect(canContinueNativeVideoUpload({ ...continuation, operationalUploadAllowed: false })).toBe(false);
    expect(canContinueNativeVideoUpload({ ...continuation, phase: "uploading" })).toBe(false);
  });

  test("canonical asset identity survives every later recovery transition", () => {
    const assetB = "b1668466-e8d0-4da8-b1a6-aa7c5d9316fd";
    let working = createNativeVideoRecoveryRecord({
      durationSeconds: 15,
      file: testFile(),
      requestId,
      safePhase: "ready_to_start",
      tenantId,
    });
    working = advanceNativeVideoRecoveryRecord(working, "provisioning");
    working = advanceNativeVideoRecoveryRecord(working, "provisioning_pending", assetId);
    expect(working.assetId).toBe(assetId);

    const afterNetworkError = advanceNativeVideoRecoveryRecord(working, "paused_or_interrupted");
    const after500 = advanceNativeVideoRecoveryRecord(working, "paused_or_interrupted");
    const after503 = advanceNativeVideoRecoveryRecord(working, "paused_or_interrupted");
    const afterConflictReview = advanceNativeVideoRecoveryRecord(working, "needs_review");
    expect(afterNetworkError.assetId).toBe(assetId);
    expect(after500.assetId).toBe(assetId);
    expect(after503.assetId).toBe(assetId);
    expect(afterConflictReview.assetId).toBe(assetId);
    expect(advanceNativeVideoRecoveryRecord(working, "uploading", assetId).assetId).toBe(assetId);
    expect(() => advanceNativeVideoRecoveryRecord(working, "uploading", assetB)).toThrow(
      NativeVideoUploadClientError,
    );
    try {
      advanceNativeVideoRecoveryRecord(working, "uploading", assetB);
    } catch (error) {
      expect(error).toMatchObject({ code: "VIDEO_UPLOAD_IDENTITY_CONFLICT", status: 409 });
    }
  });

  test("provisioning sends the exact CoachFort body with a fresh bearer token", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const result = await provisionNativeVideoUpload(
      {
        declaredMimeType: "video/mp4",
        declaredSizeBytes: 4_096,
        expectedDurationSeconds: 15,
        filename: "lesson.mp4",
        requestId,
        tenantId,
      },
      {
        fetchImpl: async (url, init) => {
          calls.push({ init, url: String(url) });
          return response({ assetId, expiresAt: "2099-09-27T10:00:00Z", replayed: false, reservedSeconds: 15, uploadUrl }, 200);
        },
        getAccessToken: async () => "fresh-session-token",
      },
    );
    expect(result).toMatchObject({ assetId, replayed: false, reservedSeconds: 15 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/video/uploads");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.headers).toEqual({ Authorization: "Bearer fresh-session-token", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      declaredMimeType: "video/mp4",
      declaredSizeBytes: 4_096,
      expectedDurationSeconds: 15,
      filename: "lesson.mp4",
      requestId,
      tenantId,
    });
  });

  test("browser clock skew does not invalidate a structurally valid server capability", async () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse("2099-09-27T10:00:00Z");
    try {
      await expect(provisionNativeVideoUpload(
        {
          declaredMimeType: "video/mp4",
          declaredSizeBytes: 4_096,
          expectedDurationSeconds: 15,
          filename: "lesson.mp4",
          requestId,
          tenantId,
        },
        {
          fetchImpl: async () => response({
            assetId,
            expiresAt: "2026-09-27T10:00:00Z",
            replayed: true,
            reservedSeconds: 15,
            uploadUrl,
          }, 200),
          getAccessToken: async () => "token",
        },
      )).resolves.toMatchObject({ assetId, replayed: true });
      await expect(provisionNativeVideoUpload(
        {
          declaredMimeType: "video/mp4",
          declaredSizeBytes: 4_096,
          expectedDurationSeconds: 15,
          filename: "lesson.mp4",
          requestId,
          tenantId,
        },
        {
          fetchImpl: async () => response({
            assetId,
            expiresAt: "not-a-timestamp",
            replayed: true,
            reservedSeconds: 15,
            uploadUrl,
          }, 200),
          getAccessToken: async () => "token",
        },
      )).rejects.toMatchObject({ code: "VIDEO_UPLOAD_RESPONSE_INVALID" });
    } finally {
      Date.now = originalNow;
    }
  });

  test("provisioning validates 202 and rejects malformed or unauthenticated responses", async () => {
    const input = {
      declaredMimeType: "video/mp4",
      declaredSizeBytes: 4_096,
      expectedDurationSeconds: 15,
      filename: "lesson.mp4",
      requestId,
      tenantId,
    };
    await expect(provisionNativeVideoUpload(input, { getAccessToken: async () => null })).rejects.toMatchObject({ status: 401 });
    await expect(
      provisionNativeVideoUpload(input, {
        fetchImpl: async () => response({ assetId, code: "VIDEO_UPLOAD_PENDING", message: "Pending.", status: "pending" }, 202),
        getAccessToken: async () => "token",
      }),
    ).resolves.toEqual({ assetId, code: "VIDEO_UPLOAD_PENDING", message: "Pending.", status: "pending" });
    await expect(
      provisionNativeVideoUpload(input, {
        fetchImpl: async () => response({ assetId, code: "VIDEO_RECONCILIATION_REQUIRED", message: "Pending.", status: "pending" }, 202),
        getAccessToken: async () => "token",
      }),
    ).resolves.toEqual({ assetId, code: "VIDEO_RECONCILIATION_REQUIRED", message: "Pending.", status: "pending" });
    await expect(
      provisionNativeVideoUpload(input, {
        fetchImpl: async () => response({ assetId, uploadUrl }, 200),
        getAccessToken: async () => "token",
      }),
    ).rejects.toMatchObject({ code: "VIDEO_UPLOAD_RESPONSE_INVALID" });
    let continuationRejection: unknown;
    try {
      await provisionNativeVideoUpload(input, {
        fetchImpl: async () => response({ code: "VIDEO_FEATURE_NOT_AVAILABLE" }, 403),
        getAccessToken: async () => "token",
      });
    } catch (error) {
      continuationRejection = error;
    }
    expect(continuationRejection).toMatchObject({ status: 403 });
    expect(getNativeVideoUploadErrorMessage(continuationRejection)).toBe(
      "Video uploads are not available for this account.",
    );
  });

  test("capability matcher is narrow to the actual HTTPS Cloudflare TUS host and path", () => {
    expect(isNativeVideoUploadCapabilityUrl(uploadUrl)).toBe(true);
    expect(isNativeVideoUploadCapabilityUrl("https://upload.cloudflarestream.com/tus?sig=private")).toBe(true);
    for (const invalid of [
      "http://upload.cloudflarestream.com/tus/private",
      "https://user:pass@upload.cloudflarestream.com/tus/private",
      "https://upload.cloudflarestream.com:444/tus/private",
      "https://upload.cloudflarestream.com/tus/private#fragment",
      "https://upload.cloudflarestream.com/video/private",
      "https://api.cloudflare.com/tus/private",
      "https://upload.videodelivery.net/tus/private",
      "https://attacker.example/tus/private",
    ]) {
      expect(isNativeVideoUploadCapabilityUrl(invalid)).toBe(false);
    }
    expect(isNativeVideoUploadCapabilityUrl("https://customer-example.cloudflarestream.com/token/iframe")).toBe(false);
  });

  test("tus transport disables persistence and sends no CoachFort/provider credentials", async () => {
    let options: Record<string, unknown> = {};
    let starts = 0;
    const abortArguments: unknown[] = [];
    class FakeUpload {
      constructor(_file: File, value: Record<string, unknown>) {
        options = value;
      }
      start() { starts += 1; }
      async abort(value?: boolean) { abortArguments.push(value); }
    }
    const transport = createNativeVideoTusUpload(
      { file: testFile(), onError: () => undefined, onProgress: () => undefined, onSuccess: () => undefined, uploadUrl },
      { UploadClass: FakeUpload as never },
    );
    expect(options.uploadUrl).toBe(uploadUrl);
    expect(options.storeFingerprintForResuming).toBe(false);
    expect(options.removeFingerprintOnSuccess).toBe(true);
    expect(options.headers).toEqual({});
    expect(options.metadata).toEqual({});
    expect(options.addRequestId).toBe(false);
    expect(options.chunkSize).toBe(nativeVideoTusChunkSizeBytes);
    expect(options.chunkSize).toBeGreaterThanOrEqual(5_242_880);
    expect((options.httpStack as { getName(): string }).getName()).toBe("NativeVideoTusFetchStack");
    expect(options.parallelUploads).toBe(1);
    expect(options.retryDelays).toEqual([0, 1_000, 3_000, 5_000, 10_000]);
    expect(options).not.toHaveProperty("endpoint");
    expect(options.urlStorage).toMatchObject({
      addUpload: expect.any(Function),
      findAllUploads: expect.any(Function),
      findUploadsByFingerprint: expect.any(Function),
      removeUpload: expect.any(Function),
    });
    const onBeforeRequest = options.onBeforeRequest as (request: { getURL(): string }) => void;
    expect(() => onBeforeRequest({ getURL: () => uploadUrl })).not.toThrow();
    expect(() => onBeforeRequest({ getURL: () => "https://attacker.example/tus/private" })).toThrow(
      "native_video_tus_capability_invalid",
    );
    transport.start();
    await transport.stop();
    expect(starts).toBe(1);
    expect(abortArguments).toEqual([false]);
  });

  test("tus transport rejects invalid capability and applies bounded retry classes", () => {
    let constructed = false;
    class FakeUpload {
      constructor() { constructed = true; }
      start() {}
      async abort() {}
    }
    expect(() => createNativeVideoTusUpload(
      { file: testFile(), onError: () => undefined, onProgress: () => undefined, onSuccess: () => undefined, uploadUrl: "https://attacker.example/tus/private" },
      { UploadClass: FakeUpload as never },
    )).toThrow("native_video_tus_capability_invalid");
    expect(constructed).toBe(false);
    const detailed = (status: number | null) => status === null ? {} : { originalResponse: { getStatus: () => status } };
    expect(classifyNativeVideoTusError(detailed(null))).toBe("native_video_tus_network_error");
    expect(classifyNativeVideoTusError(detailed(503))).toBe("native_video_tus_network_error");
    expect(classifyNativeVideoTusError(detailed(429))).toBe("native_video_tus_network_error");
    expect(classifyNativeVideoTusError(detailed(409))).toBe("native_video_tus_network_error");
    expect(shouldRetryNativeVideoTusError(detailed(409))).toBe(true);
    expect(shouldRetryNativeVideoTusError(detailed(422))).toBe(false);
    expect(shouldRetryNativeVideoTusError(detailed(410))).toBe(false);
    expect(classifyNativeVideoTusError(detailed(410))).toBe("native_video_tus_expired");
    expect(classifyNativeVideoTusError(detailed(422))).toBe("native_video_tus_rejected");
  });

  test("tus HTTP stack rejects redirects and validates the final response destination", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, url: String(input) });
      return {
        headers: new Headers({ "Upload-Offset": "4" }),
        redirected: false,
        status: 204,
        text: async () => "",
        url: uploadUrl,
      } as Response;
    };
    const stack = createNativeVideoTusHttpStack(fetchImpl);
    const request = stack.createRequest("PATCH", uploadUrl);
    request.setHeader("Tus-Resumable", "1.0.0");
    const progress: number[] = [];
    request.setProgressHandler((bytes) => progress.push(bytes));
    const result = await request.send(new Blob(["test"]));
    expect(result.getStatus()).toBe(204);
    expect(progress).toEqual([4]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(uploadUrl);
    expect(calls[0]?.init).toMatchObject({
      credentials: "omit",
      method: "PATCH",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect((calls[0]?.init?.headers as Headers).get("Tus-Resumable")).toBe("1.0.0");

    const redirectingStack = createNativeVideoTusHttpStack(async () => ({
      headers: new Headers(),
      redirected: true,
      status: 204,
      text: async () => "",
      url: "https://attacker.example/tus/private",
    }) as Response);
    await expect(redirectingStack.createRequest("HEAD", uploadUrl).send(null)).rejects.toThrow(
      "native_video_tus_redirect_rejected",
    );
    const mismatchedFinalUrlStack = createNativeVideoTusHttpStack(async () => ({
      headers: new Headers(),
      redirected: false,
      status: 204,
      text: async () => "",
      url: "https://attacker.example/tus/private",
    }) as Response);
    await expect(mismatchedFinalUrlStack.createRequest("HEAD", uploadUrl).send(null)).rejects.toThrow(
      "native_video_tus_redirect_rejected",
    );
    expect(() => stack.createRequest("PATCH", "https://attacker.example/tus/private")).toThrow(
      "native_video_tus_capability_invalid",
    );
  });

  test("monitoring recursively removes capabilities without redacting harmless URLs", () => {
    const harmlessCoachFort = "https://coachfort.com/app/video-library";
    const harmlessCloudflare = "https://customer-example.cloudflarestream.com/token/iframe";
    const nested = {
      breadcrumbs: [{ data: { url: uploadUrl } }],
      contexts: { request: { note: `failed at ${uploadUrl}` } },
      exception: { values: [{ value: uploadUrl }] },
      extra: { harmlessCloudflare, harmlessCoachFort },
      request: { url: uploadUrl },
      tags: { destination: uploadUrl },
    };
    const scrubbed = scrubSentryEvent(nested);
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain("capability-secret");
    expect(serialized).not.toContain("sig=private");
    expect(serialized).toContain("[native-video-upload-capability]");
    expect(serialized).toContain(harmlessCoachFort);
    expect(serialized).toContain(harmlessCloudflare);
    expect(scrubSentryBreadcrumb({ data: { url: uploadUrl } })).not.toEqual({ data: { url: uploadUrl } });
    expect(scrubNativeVideoUploadCapabilities(`prefix ${uploadUrl} suffix`)).toBe(
      "prefix [native-video-upload-capability] suffix",
    );
    expect(scrubMonitoringValue(harmlessCloudflare)).toBe(harmlessCloudflare);

    const capabilitySpan = {
      data: {
        "http.request.url": uploadUrl,
        nested: { request: { url: `PATCH ${uploadUrl}` } },
      },
      description: `PATCH ${uploadUrl}`,
      op: "http.client",
      span_id: "span",
      start_timestamp: 1,
      trace_id: "trace",
    };
    const scrubbedSpan = scrubSentrySpan(capabilitySpan);
    expect(JSON.stringify(scrubbedSpan)).not.toContain("capability-secret");
    expect(JSON.stringify(scrubbedSpan)).not.toContain("sig=private");
    expect(nativeVideoUploadCapabilitySpanPattern.test(capabilitySpan.description)).toBe(true);
    const normalSpan = { ...capabilitySpan, data: { url: harmlessCoachFort }, description: harmlessCoachFort };
    expect(scrubSentrySpan(normalSpan)).toEqual(normalSpan);
    expect(nativeVideoUploadCapabilitySpanPattern.test(harmlessCloudflare)).toBe(false);
  });

  test("instrumentation limits trace propagation and keeps replay disabled", () => {
    const source = read("instrumentation-client.ts");
    expect(source).toContain("beforeBreadcrumb: scrubSentryBreadcrumb");
    expect(source).toContain("beforeSend: scrubSentryEvent");
    expect(source).toContain("beforeSendSpan: scrubSentrySpan");
    expect(source).toContain("ignoreSpans: [nativeVideoUploadCapabilitySpanPattern]");
    expect(source).toContain("tracePropagationTargets");
    expect(source).toContain("coachfort\\.com");
    expect(source).not.toContain("upload.cloudflarestream.com");
    expect(source).not.toContain("cloudflarestream\\.com");
    expect(source).toContain("replaysOnErrorSampleRate: 0");
    expect(source).toContain("replaysSessionSampleRate: 0");
  });

  test("upload panel is inline, capacity-gated and preserves request identity", () => {
    const panel = read("src/components/video/NativeVideoUploadPanel.tsx");
    const library = read("src/components/video/VideoLibraryClient.tsx");
    expect(library.indexOf("<CapacitySummary")).toBeLessThan(library.indexOf("<NativeVideoUploadPanel"));
    expect(library.indexOf("<NativeVideoUploadPanel")).toBeLessThan(library.indexOf('aria-labelledby="video-inventory-title"'));
    expect(panel).toContain("capacity?.featureEnabled");
    expect(panel).toContain("!inactiveWorkspace");
    expect(panel).toContain("capacity.availableForNewUploadMinutes > 0");
    expect(panel).toContain("crypto.randomUUID()");
    expect(panel.match(/crypto\.randomUUID\(\)/g)).toHaveLength(1);
    expect(panel).toContain("getNativeVideoFileSelectionDecision(selected, attempt)");
    expect(panel).toContain("durationSeconds !== attempt.expectedDurationSeconds");
    expect(panel).toContain("Math.ceil(attempt.expectedDurationSeconds / 60)");
    expect(panel).toContain('let workingAttempt = persistAttempt(attempt, "provisioning")');
    expect(panel).toContain('workingAttempt = persistAttempt(workingAttempt, "provisioning_pending", result.assetId)');
    expect(panel).toContain("requestId: workingAttempt.requestId");
  });

  test("file reselection invalidates stale File state until every check succeeds", () => {
    const panel = read("src/components/video/NativeVideoUploadPanel.tsx");
    const selection = panel.slice(panel.indexOf("async function selectFile"), panel.indexOf("async function beginUpload"));
    expect(selection.indexOf("setFile(null)")).toBeGreaterThanOrEqual(0);
    expect(selection.indexOf("setFile(null)")).toBeLessThan(selection.indexOf("validateNativeVideoFile(selected)"));
    expect(selection.indexOf("setFile(null)")).toBeLessThan(selection.indexOf("extractNativeVideoDuration(selected)"));
    expect(selection.indexOf("setFile(selected)")).toBeGreaterThan(selection.indexOf("extractNativeVideoDuration(selected)"));
    expect(selection.indexOf("setFile(selected)")).toBeGreaterThan(selection.indexOf("getNativeVideoSuccessfulSelectionPhase"));
    expect(selection).toContain('selectionDecision === "require_original_file"');
  });

  test("upload panel has bounded pending, local stop, beforeunload and exact-item handoff", () => {
    const panel = read("src/components/video/NativeVideoUploadPanel.tsx");
    expect(panel).toContain("const pendingRetryDelays = [1_500, 3_000, 5_000]");
    expect(panel).toContain('result.code === "VIDEO_RECONCILIATION_REQUIRED"');
    expect(panel).toContain("transportRef.current?.stop()");
    expect(panel).toContain('phase !== "uploading"');
    expect(panel).toContain('window.addEventListener("beforeunload"');
    expect(panel).toContain("getNativeVideoAsset({ assetId, tenantId })");
    const continuation = panel.slice(panel.indexOf("async function continueUpload"), panel.indexOf("async function startNewUpload"));
    expect(continuation).toContain("await beginUpload()");
    expect(continuation).toContain("operationalUploadAllowed");
    expect(continuation).not.toContain("newUploadCapacityAvailable");
    expect(continuation).not.toContain("newUploadCapacitySufficient");
    expect(continuation).not.toContain(".start()");
    expect(panel).not.toContain("Cloudflare");
    expect(panel).not.toContain("reconciliation_batch");
    expect(panel).not.toMatch(/\.from\(["']video_/);
    expect(panel).not.toContain("providerAssetId");
    expect(panel).not.toContain("uploadUrl}</");
    expect(panel).toContain('role="progressbar"');
    expect(panel).toContain("aria-valuemin={0}");
    expect(panel).toContain("aria-valuemax={100}");
  });

  test("browser code never persists or logs upload capability data", () => {
    const panel = read("src/components/video/NativeVideoUploadPanel.tsx");
    const client = read("src/lib/video/nativeVideoUploadClient.ts");
    const tus = read("src/lib/video/nativeVideoTusUpload.ts");
    const combined = `${panel}\n${client}\n${tus}`;
    expect(combined).not.toMatch(/console\.(?:log|warn|error|debug)/);
    expect(panel).not.toContain("capabilityRef");
    expect(client).toContain("sessionStorage");
    expect(client).not.toMatch(/setItem\([^\n]*uploadUrl/);
    expect(client).not.toContain("localStorage");
    expect(tus).not.toContain("findPreviousUploads");
    expect(tus).toContain("storeFingerprintForResuming: false");
    expect(tus).toContain("headers: {}");
    for (const forbidden of ["sentry-trace", "baggage", "Authorization", "service_role", "SUPABASE", "CLOUDFLARE_STREAM_API_TOKEN"]) {
      expect(tus).not.toContain(forbidden);
    }
  });

  test("customer errors expose no provider, SQL or capability details", () => {
    expect(getNativeVideoUploadErrorMessage(new NativeVideoUploadClientError("PRIVATE", 500))).toBe(
      "Video upload is temporarily unavailable. Please try again.",
    );
    expect(getNativeVideoUploadErrorMessage(new NativeVideoUploadClientError("PRIVATE", 401))).toBe(
      "Your session has expired. Sign in again.",
    );
    const panel = read("src/components/video/NativeVideoUploadPanel.tsx");
    for (const forbidden of ["SQLSTATE", "Cloudflare", "provider UID", "upload URL", "service role"] ) {
      expect(panel).not.toContain(forbidden);
    }
    expect(panel).toContain("Stopping here does not delete the video or release reserved capacity.");
  });
});
