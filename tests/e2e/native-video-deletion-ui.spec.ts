import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assetMatchesNativeVideoFilter,
  createNativeVideoPollingController,
  getActiveNativeVideoAssets,
  isNativeVideoDeletionEligible,
  mergeNativeVideoManagementPages,
  type NativeVideoDeletionErrorCode,
  NativeVideoDeletionRequestError,
  type NativeVideoManagementAsset,
  NativeVideoManagementRequestError,
  normalizeNativeVideoManagementPage,
  requestNativeVideoDeletion,
} from "../../src/lib/video/nativeVideoManagementClient";

const root = process.cwd();
const componentPath = "src/components/video/VideoLibraryClient.tsx";
const clientPath = "src/lib/video/nativeVideoManagementClient.ts";
const routePath = "app/api/video/assets/[assetId]/route.ts";
const tenantId = "11111111-1111-4111-8111-111111111111";
const assetId = "a2222222-2222-4222-8222-222222222222";
const secondAssetId = "33333333-3333-4333-8333-333333333333";

const read = (path: string) => readFileSync(join(root, path), "utf8");

function response(value: unknown, status = 202) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function rawAsset(overrides: Record<string, unknown> = {}) {
  return {
    assetId,
    attachments: [],
    attention: null,
    createdAt: "2026-09-27T00:00:00Z",
    deleteRequestedAt: null,
    durationSeconds: 30,
    filename: "delete-smoke.mp4",
    reservedSeconds: 0,
    status: "ready",
    updatedAt: "2026-09-27T00:00:00Z",
    ...overrides,
  };
}

function asset(
  overrides: Partial<NativeVideoManagementAsset> = {},
): NativeVideoManagementAsset {
  return normalizeNativeVideoManagementPage({
    items: [rawAsset(overrides)],
    nextCursor: null,
  }).items[0]!;
}

async function expectDeletionError(
  promise: Promise<unknown>,
  expected: {
    ambiguous: boolean;
    code: NativeVideoDeletionErrorCode | null;
    status: number;
  },
) {
  try {
    await promise;
    throw new Error("Expected deletion request to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(NativeVideoDeletionRequestError);
    expect(error).toMatchObject(expected);
    expect((error as Error).message).toBe(
      "Native video deletion request failed.",
    );
  }
}

test.describe("VIDEO-2C2D4 canonical delete lifecycle UI", () => {
  test("1. obtains a fresh bearer token for every delete request", async () => {
    let tokenCalls = 0;
    const authorizations: string[] = [];
    const options = {
      fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
        authorizations.push(String((init?.headers as Record<string, string>).Authorization));
        return response({ assetId, status: "delete_pending" });
      },
      getAccessToken: async () => `fresh-token-${++tokenCalls}`,
    };

    await requestNativeVideoDeletion({ assetId, tenantId }, options);
    await requestNativeVideoDeletion({ assetId, tenantId }, options);
    expect(authorizations).toEqual([
      "Bearer fresh-token-1",
      "Bearer fresh-token-2",
    ]);
  });

  test("2. canonicalizes UUIDs and sends the exact DELETE request", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const controller = new AbortController();
    const result = await requestNativeVideoDeletion(
      { assetId: assetId.toUpperCase(), tenantId: tenantId.toUpperCase() },
      {
        fetchImpl: async (url, init) => {
          calls.push({ init, url: String(url) });
          return response({ assetId, status: "delete_pending" });
        },
        getAccessToken: async () => "fresh-token",
        signal: controller.signal,
      },
    );

    expect(result).toEqual({ assetId, status: "delete_pending" });
    expect(calls).toEqual([
      {
        init: {
          body: JSON.stringify({ tenantId }),
          cache: "no-store",
          headers: {
            Authorization: "Bearer fresh-token",
            "Content-Type": "application/json",
          },
          method: "DELETE",
          signal: controller.signal,
        },
        url: `/api/video/assets/${assetId}`,
      },
    ]);
  });

  test("3. accepts only the exact canonical 202 result", async () => {
    await expect(
      requestNativeVideoDeletion(
        { assetId, tenantId },
        {
          fetchImpl: async () => response({ assetId, status: "delete_pending" }),
          getAccessToken: async () => "token",
        },
      ),
    ).resolves.toEqual({ assetId, status: "delete_pending" });
  });

  test("4. rejects a mismatched success asset as ambiguous", async () => {
    await expectDeletionError(
      requestNativeVideoDeletion(
        { assetId, tenantId },
        {
          fetchImpl: async () =>
            response({ assetId: secondAssetId, status: "delete_pending" }),
          getAccessToken: async () => "token",
        },
      ),
      { ambiguous: true, code: null, status: 202 },
    );
  });

  test("5. rejects uppercase server UUIDs instead of normalizing them", async () => {
    await expectDeletionError(
      requestNativeVideoDeletion(
        { assetId, tenantId },
        {
          fetchImpl: async () =>
            response({ assetId: assetId.toUpperCase(), status: "delete_pending" }),
          getAccessToken: async () => "token",
        },
      ),
      { ambiguous: true, code: null, status: 202 },
    );
  });

  test("6. rejects wrong status and extra success fields", async () => {
    for (const body of [
      { assetId, status: "deleted" },
      { assetId, providerAssetId: "private", status: "delete_pending" },
    ]) {
      await expectDeletionError(
        requestNativeVideoDeletion(
          { assetId, tenantId },
          {
            fetchImpl: async () => response(body),
            getAccessToken: async () => "token",
          },
        ),
        { ambiguous: true, code: null, status: 202 },
      );
    }
  });

  test("7. rejects malformed JSON, arrays and null success bodies", async () => {
    for (const providerResponse of [
      new Response("not-json", { status: 202 }),
      response([]),
      response(null),
    ]) {
      await expectDeletionError(
        requestNativeVideoDeletion(
          { assetId, tenantId },
          {
            fetchImpl: async () => providerResponse,
            getAccessToken: async () => "token",
          },
        ),
        { ambiguous: true, code: null, status: 202 },
      );
    }
  });

  test("8. rejects unexpected successful statuses as ambiguous", async () => {
    await expectDeletionError(
      requestNativeVideoDeletion(
        { assetId, tenantId },
        {
          fetchImpl: async () =>
            response({ assetId, status: "delete_pending" }, 200),
          getAccessToken: async () => "token",
        },
      ),
      { ambiguous: true, code: null, status: 200 },
    );
  });

  test("9. maps every bounded rejection status and code definitively", async () => {
    const cases: Array<[number, NativeVideoDeletionErrorCode]> = [
      [400, "VIDEO_INVALID_REQUEST"],
      [401, "VIDEO_AUTHENTICATION_REQUIRED"],
      [403, "VIDEO_DELETION_FORBIDDEN"],
      [404, "VIDEO_ASSET_NOT_FOUND"],
      [409, "VIDEO_ATTACHED_TO_LESSON"],
      [409, "VIDEO_DELETION_STATE_CONFLICT"],
    ];
    for (const [status, code] of cases) {
      await expectDeletionError(
        requestNativeVideoDeletion(
          { assetId, tenantId },
          {
            fetchImpl: async () => response({ code, error: "ignored" }, status),
            getAccessToken: async () => "token",
          },
        ),
        { ambiguous: false, code, status },
      );
    }
  });

  test("10. classifies bounded 500 and unknown responses as ambiguous", async () => {
    await expectDeletionError(
      requestNativeVideoDeletion(
        { assetId, tenantId },
        {
          fetchImpl: async () =>
            response(
              { code: "VIDEO_DELETION_REQUEST_FAILED", error: "private" },
              500,
            ),
          getAccessToken: async () => "token",
        },
      ),
      {
        ambiguous: true,
        code: "VIDEO_DELETION_REQUEST_FAILED",
        status: 500,
      },
    );
    await expectDeletionError(
      requestNativeVideoDeletion(
        { assetId, tenantId },
        {
          fetchImpl: async () => response({ code: "UNKNOWN", error: "private" }, 418),
          getAccessToken: async () => "token",
        },
      ),
      { ambiguous: true, code: null, status: 418 },
    );
  });

  test("11. classifies network and abort failures as ambiguous without raw text", async () => {
    for (const failure of [
      new Error("private network details"),
      new DOMException("private abort details", "AbortError"),
    ]) {
      await expectDeletionError(
        requestNativeVideoDeletion(
          { assetId, tenantId },
          {
            fetchImpl: async () => {
              throw failure;
            },
            getAccessToken: async () => "token",
          },
        ),
        { ambiguous: true, code: null, status: 0 },
      );
    }
  });

  test("12. rejects invalid or expanded caller authority before fetch", async () => {
    let calls = 0;
    const options = {
      fetchImpl: async () => {
        calls += 1;
        return response({ assetId, status: "delete_pending" });
      },
      getAccessToken: async () => "token",
    };
    await expectDeletionError(
      requestNativeVideoDeletion({ assetId: "invalid", tenantId }, options),
      { ambiguous: false, code: "VIDEO_INVALID_REQUEST", status: 400 },
    );
    await expectDeletionError(
      requestNativeVideoDeletion(
        { assetId, tenantId, providerAssetId: "private" } as never,
        options,
      ),
      { ambiguous: false, code: "VIDEO_INVALID_REQUEST", status: 400 },
    );
    expect(calls).toBe(0);
  });

  test("13. active projection removes only deleted evidence rows", () => {
    const ready = asset();
    const deleted = asset({ assetId: secondAssetId, status: "deleted" });
    expect(getActiveNativeVideoAssets([ready, deleted])).toEqual([ready]);
  });

  test("14. active filtering preserves a server cursor through an empty active page", () => {
    const page = normalizeNativeVideoManagementPage({
      items: [rawAsset({ status: "deleted" })],
      nextCursor: "next_page_cursor",
    });
    const merged = mergeNativeVideoManagementPages(
      [],
      getActiveNativeVideoAssets(page.items),
    );
    expect(merged).toEqual([]);
    expect(page.nextCursor).toBe("next_page_cursor");
  });

  test("15. all active filters reject deleted rows", () => {
    const deleted = asset({ status: "deleted" });
    for (const filter of [
      "all",
      "processing",
      "ready",
      "attention",
      "deleting",
    ] as const) {
      expect(assetMatchesNativeVideoFilter(deleted, filter)).toBe(false);
    }
  });

  test("16. ready unattached assets are deletion eligible", () => {
    expect(isNativeVideoDeletionEligible(asset())).toBe(true);
  });

  test("17. attached and non-ready assets are not deletion eligible", () => {
    expect(
      isNativeVideoDeletionEligible(
        asset({
          attachments: [
            {
              courseId: "44444444-4444-4444-8444-444444444444",
              courseTitle: "Course",
              lessonId: "55555555-5555-4555-8555-555555555555",
              lessonTitle: "Lesson",
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(isNativeVideoDeletionEligible(asset({ status: "processing" }))).toBe(false);
  });

  test("18. unresolved and submitting assets are not deletion eligible", () => {
    expect(isNativeVideoDeletionEligible(asset(), { unresolved: true })).toBe(false);
    expect(isNativeVideoDeletionEligible(asset(), { submitting: true })).toBe(false);
  });

  test("19. ready action is beside refresh and uses destructive presentation", () => {
    const source = read(componentPath);
    expect(source).toContain("<AssetActions");
    expect(source).toContain("Refresh item");
    expect(source).toContain('variant="destructive"');
    expect(source).toContain("Delete video");
  });

  test("20. confirmation contains the frozen destructive copy", () => {
    const source = read(componentPath);
    expect(source).toContain("Delete video?");
    expect(source).toContain("This cannot be undone.");
    expect(source).toContain("Storage remains in use until deletion is completed.");
    expect(source).toContain('loadingText="Deleting..."');
  });

  test("21. confirmation is modal, labelled, focus-contained and restorable", () => {
    const source = read(componentPath);
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("cancelRef.current?.focus()");
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain("returnFocus?.focus()");
  });

  test("22. confirmation blocks close and duplicate controls while submitting", () => {
    const source = read(componentPath);
    expect(source).toContain('if (!submitting) onCancel()');
    expect(source).toContain("disabled={submitting}");
    expect(source).toContain("deleteSubmittingAssetIdRef.current !== null");
  });

  test("23. attached assets expose detach-first copy and no automatic detach", () => {
    const source = read(componentPath);
    expect(source).toContain("Remove this video from its lessons before deleting it.");
    expect(source).toContain("asset.attachments.length > 0");
    expect(source).not.toContain("detachNativeVideo");
  });

  test("24. delete-pending presentation retains capacity and omits eligible delete", () => {
    const source = read(componentPath);
    expect(source).toContain('asset.status === "delete_pending"');
    expect(source).toContain(
      "Deletion is being completed. Storage capacity remains in use until it",
    );
    expect(source).toContain('asset.status === "ready"');
  });

  test("25. browser deletion source contains no provider or reconciliation authority", () => {
    const source = `${read(componentPath)}\n${read(clientPath)}`;
    expect(source).not.toMatch(/cloudflare/i);
    expect(source).not.toContain("providerAssetId");
    expect(source).not.toContain("provider_asset_id");
    expect(source).not.toContain("reconciliation");
    expect(source).not.toMatch(/\.from\(["']video_/);
  });

  test("26. validated 202 is followed by one exact management read", () => {
    const source = read(componentPath);
    expect(source).toMatch(
      /await requestNativeVideoDeletion[\s\S]*await reconcileAcceptedDeletion/,
    );
    expect(source).toMatch(
      /async function reconcileAcceptedDeletion[\s\S]*getNativeVideoAsset/,
    );
  });

  test("27. accepted transient read failure changes only local status and resumes polling", () => {
    const source = read(componentPath);
    expect(source).toMatch(
      /applyAcceptedDeletePending[\s\S]*\.\.\.asset, status: "delete_pending" as const/,
    );
    expect(source).toContain("CoachFort will keep checking.");
    expect(source).toMatch(/clearUnresolvedDeleteAsset\(assetId\)/);
  });

  test("28. accepted exact-read 401 stops all polling", () => {
    const source = read(componentPath);
    const accepted = source.slice(source.indexOf("async function reconcileAcceptedDeletion"));
    expect(accepted).toMatch(/status === 401[\s\S]*pollingRef\.current\?\.stopAll\(\)/);
    expect(accepted).toContain("Your session has expired. Sign in again.");
  });

  test("29. accepted exact-read 403 marks unresolved and stops item polling", () => {
    const source = read(componentPath);
    const accepted = source.slice(source.indexOf("async function reconcileAcceptedDeletion"));
    expect(accepted).toMatch(/status === 403[\s\S]*markUnresolvedDeleteAsset\(assetId\)/);
    expect(source).toContain("pollingRef.current?.stop(assetId)");
  });

  test("30. accepted exact-read 404 removes without capacity inference", () => {
    const source = read(componentPath);
    const accepted = source.slice(
      source.indexOf("async function reconcileAcceptedDeletion"),
      source.indexOf("async function submitDelete"),
    );
    expect(accepted).toMatch(/status === 404[\s\S]*removeActiveAsset\(assetId\)/);
    expect(accepted).not.toContain("getNativeVideoCapacity");
  });

  test("31. ambiguous deletion exact-reads and never repeats DELETE", () => {
    const source = read(componentPath);
    const ambiguous = source.slice(
      source.indexOf("async function reconcileAmbiguousDeletion"),
      source.indexOf("async function reconcileDeletionConflict"),
    );
    expect(ambiguous).toContain("getNativeVideoAsset");
    expect(ambiguous).not.toContain("requestNativeVideoDeletion");
  });

  test("32. ambiguous canonical states apply without local fabrication", () => {
    const source = read(componentPath);
    const ambiguous = source.slice(
      source.indexOf("async function reconcileAmbiguousDeletion"),
      source.indexOf("async function reconcileDeletionConflict"),
    );
    expect(ambiguous).toContain("applyCanonicalAsset(asset, expectedTenantId)");
    expect(ambiguous).toContain('asset.status === "ready"');
    expect(ambiguous).toContain("markUnresolvedDeleteAsset(assetId)");
  });

  test("33. both 409 codes exact-refresh without automatic delete or detach", () => {
    const source = read(componentPath);
    expect(source).toContain('error.code === "VIDEO_ATTACHED_TO_LESSON"');
    expect(source).toContain('error.code === "VIDEO_DELETION_STATE_CONFLICT"');
    const conflict = source.slice(
      source.indexOf("async function reconcileDeletionConflict"),
      source.indexOf("async function reconcileAcceptedDeletion"),
    );
    expect(conflict).toContain("getNativeVideoAsset");
    expect(conflict).not.toContain("requestNativeVideoDeletion");
  });

  test("34. canonical deleted uses one idempotent terminal capacity path", () => {
    const source = read(componentPath);
    expect(source).toContain("terminalDeleteIdsRef.current.has(assetId)");
    expect(source).toContain("terminalDeleteIdsRef.current.add(assetId)");
    expect(source).toMatch(
      /asset\.status === "deleted"[\s\S]*finalizeDeletedAsset/,
    );
    expect(source).toContain("await getNativeVideoCapacity(expectedTenantId)");
  });

  test("35. no deletion branch performs optimistic capacity arithmetic", () => {
    const source = read(componentPath);
    expect(source).not.toMatch(/setCapacity\([^)]*[+-]/);
    expect(source).not.toMatch(/reservedMinutes\s*[+-]/);
    expect(source).not.toMatch(/storedMinutes\s*[+-]/);
  });

  test("36. every post-await deletion path uses operation and tenant guards", () => {
    const source = read(componentPath);
    expect(source).toContain("deleteOperationIsCurrent(");
    expect(source).toContain("deleteOperationGenerationRef.current === generation");
    expect(source).toContain("tenantIdRef.current === expectedTenantId");
    expect(source).toContain("deleteRequestRef.current?.abort()");
  });

  test("37. canonical and unresolved changes invalidate idle confirmation", () => {
    const source = read(componentPath);
    expect(source).toContain(
      "deleteSubmittingAssetIdRef.current === asset.assetId",
    );
    expect(source).toContain(
      "return isNativeVideoDeletionEligible(asset) ? current : null",
    );
    expect(source).toMatch(
      /markUnresolvedDeleteAsset[\s\S]*setDeleteCandidateId/,
    );
  });

  test("38. submission re-reads current asset and unresolved state before DELETE", () => {
    const source = read(componentPath);
    const submit = source.slice(source.indexOf("async function submitDelete"));
    expect(submit).toContain("assetsRef.current.find");
    expect(submit).toContain("unresolvedDeleteAssetIdsRef.current.has(assetId)");
    expect(submit.indexOf("isNativeVideoDeletionEligible")).toBeLessThan(
      submit.indexOf("requestNativeVideoDeletion"),
    );
  });

  test("39. unresolved assets are excluded from automatic polling synchronization", () => {
    const source = read(componentPath);
    expect(source).toMatch(
      /pollingRef\.current\?\.sync\([\s\S]*!unresolvedDeleteAssetIds\.has/,
    );
    expect(source).toContain("clearDeleteLifecycleFlags(asset.assetId)");
  });

  test("40. timeout fires only at the real hard deadline for a pollable item", () => {
    let now = 0;
    const timers: Array<() => void> = [];
    const timeouts: Array<[string, string]> = [];
    const controller = createNativeVideoPollingController({
      now: () => now,
      onAsset: () => undefined,
      onAuthFailure: () => undefined,
      onError: () => undefined,
      onTimeout: (id, status) => timeouts.push([id, status]),
      requestAsset: async () => asset({ status: "delete_pending" }),
      setTimer(callback) {
        timers.push(callback);
        return timers.length;
      },
    });
    controller.sync([asset({ status: "delete_pending" })]);
    expect(timeouts).toEqual([]);
    now = 600_000;
    controller.pause();
    expect(timeouts).toEqual([]);
    controller.resume();
    expect(timeouts).toEqual([[assetId, "delete_pending"]]);
  });

  test("41. terminal deleted never invokes timeout", async () => {
    let now = 0;
    const timers: Array<() => void> = [];
    const timeouts: string[] = [];
    const controller = createNativeVideoPollingController({
      now: () => now,
      onAsset: () => undefined,
      onAuthFailure: () => undefined,
      onError: () => undefined,
      onTimeout: (id) => timeouts.push(id),
      requestAsset: async () => asset({ status: "deleted" }),
      setTimer(callback) {
        timers.push(callback);
        return timers.length;
      },
    });
    controller.sync([asset({ status: "delete_pending" })]);
    now = 600_000;
    timers[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timeouts).toEqual([]);
  });

  test("42. authentication stop never invokes timeout", async () => {
    let now = 0;
    const timers: Array<() => void> = [];
    const timeouts: string[] = [];
    const controller = createNativeVideoPollingController({
      now: () => now,
      onAsset: () => undefined,
      onAuthFailure: () => undefined,
      onError: () => undefined,
      onTimeout: (id) => timeouts.push(id),
      requestAsset: async () => {
        throw new NativeVideoManagementRequestError(401);
      },
      setTimer(callback) {
        timers.push(callback);
        return timers.length;
      },
    });
    controller.sync([asset({ status: "delete_pending" })]);
    now = 600_000;
    timers[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timeouts).toEqual([]);
  });

  test("43. item 403 and 404 stops never invoke timeout", async () => {
    for (const status of [403, 404]) {
      let now = 0;
      const timers: Array<() => void> = [];
      const timeouts: string[] = [];
      const controller = createNativeVideoPollingController({
        now: () => now,
        onAsset: () => undefined,
        onAuthFailure: () => undefined,
        onError: () => undefined,
        onTimeout: (id) => timeouts.push(id),
        requestAsset: async () => {
          throw new NativeVideoManagementRequestError(status);
        },
        setTimer(callback) {
          timers.push(callback);
          return timers.length;
        },
      });
      controller.sync([asset({ status: "delete_pending" })]);
      now = 600_000;
      timers[0]!();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(timeouts).toEqual([]);
    }
  });

  test("44. pause, item stop and stopAll do not create false timeouts", () => {
    let now = 0;
    const timeouts: string[] = [];
    const controller = createNativeVideoPollingController({
      now: () => now,
      onAsset: () => undefined,
      onAuthFailure: () => undefined,
      onError: () => undefined,
      onTimeout: (id) => timeouts.push(id),
      requestAsset: async () => asset({ status: "delete_pending" }),
      setTimer: () => 1,
    });
    controller.sync([asset({ status: "delete_pending" })]);
    controller.pause();
    now = 600_000;
    expect(timeouts).toEqual([]);
    controller.stop(assetId);
    controller.stopAll();
    expect(timeouts).toEqual([]);
  });

  test("45. every inventory ingestion boundary applies active filtering", () => {
    const source = read(componentPath);
    expect(source.match(/getActiveNativeVideoAssets\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('if (asset.status === "deleted")');
  });

  test("46. pagination stores the server next cursor independently of active items", () => {
    const source = read(componentPath);
    const loadMore = source.slice(
      source.indexOf("async function loadMore"),
      source.indexOf("function upsertUploadedAsset"),
    );
    expect(loadMore).toContain("getActiveNativeVideoAssets(page.items)");
    expect(loadMore).toContain("setNextCursor(page.nextCursor)");
  });

  test("47. mobile actions and dialog remain bounded and stack cleanly", () => {
    const source = read(componentPath);
    expect(source).toContain("md:hidden");
    expect(source).toContain("max-h-[calc(100dvh-2rem)]");
    expect(source).toContain("flex-col-reverse");
    expect(source).toContain("break-words");
  });

  test("48. route monitoring captures only the two synthetic identifiers", () => {
    const source = read(routePath);
    expect(source).toContain('new Error("VIDEO_DELETION_REQUEST_FAILED")');
    expect(source).toContain('new Error("VIDEO_DELETION_UNEXPECTED_FAILURE")');
    expect(source).not.toContain("captureServerException(result.error");
    expect(source).not.toContain("captureServerException(error");
  });

  test("49. route public deletion response and authority remain unchanged", () => {
    const source = read(routePath);
    expect(source).toContain('"request_native_video_deletion_server"');
    expect(source).toContain('{ assetId, status: "delete_pending" }');
    expect(source).toContain('"Cache-Control": "private, no-store"');
    expect(source).toContain("status: 202");
  });

  test("50. D4 introduces no SQL, provider, playback or reconciliation path", () => {
    const component = read(componentPath);
    const client = read(clientPath);
    const combined = `${component}\n${client}`;
    expect(combined).not.toMatch(/\.rpc\(/);
    expect(combined).not.toMatch(/\.from\(["']video_/);
    expect(combined).not.toContain("/playback");
    expect(combined).not.toContain("/reconciliation");
    expect(combined).not.toMatch(/cloudflare/i);
  });
});

test.describe("VIDEO-2C2D4-C1 non-pollable manual refresh scheduling", () => {
  test("manual refresh HTTP 500 reports once and remains explicit-refresh only", async () => {
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const errors: number[] = [];
    const timeouts: string[] = [];
    let requests = 0;
    const controller = createNativeVideoPollingController({
      onAsset: () => undefined,
      onAuthFailure: () => undefined,
      onError: (status) => errors.push(status),
      onTimeout: (id) => timeouts.push(id),
      requestAsset: async () => {
        requests += 1;
        throw new NativeVideoManagementRequestError(500);
      },
      setTimer(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
    });

    await controller.refresh(assetId);
    await Promise.resolve();

    expect(requests).toBe(1);
    expect(errors).toEqual([500]);
    expect(timers).toHaveLength(0);
    expect(timeouts).toHaveLength(0);

    await controller.refresh(assetId);
    expect(requests).toBe(2);
    expect(errors).toEqual([500, 500]);
    expect(timers).toHaveLength(0);
  });

  test("manual refresh network failure reports once and remains explicit-refresh only", async () => {
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const errors: number[] = [];
    const timeouts: string[] = [];
    let requests = 0;
    const controller = createNativeVideoPollingController({
      onAsset: () => undefined,
      onAuthFailure: () => undefined,
      onError: (status) => errors.push(status),
      onTimeout: (id) => timeouts.push(id),
      requestAsset: async () => {
        requests += 1;
        throw new Error("simulated private network failure");
      },
      setTimer(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
    });

    await controller.refresh(assetId);
    await Promise.resolve();

    expect(requests).toBe(1);
    expect(errors).toEqual([500]);
    expect(timers).toHaveLength(0);
    expect(timeouts).toHaveLength(0);

    await controller.refresh(assetId);
    expect(requests).toBe(2);
    expect(errors).toEqual([500, 500]);
    expect(timers).toHaveLength(0);
  });

  test("manual refresh of a ready asset updates once without scheduling", async () => {
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const assets: NativeVideoManagementAsset[] = [];
    let requests = 0;
    const controller = createNativeVideoPollingController({
      onAsset: (item) => assets.push(item),
      onAuthFailure: () => undefined,
      onError: () => undefined,
      requestAsset: async () => {
        requests += 1;
        return asset({ status: "ready" });
      },
      setTimer(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
    });

    await controller.refresh(assetId);

    expect(requests).toBe(1);
    expect(assets.map((item) => item.status)).toEqual(["ready"]);
    expect(timers).toHaveLength(0);
  });

  test("manual refresh of delete_pending starts the canonical three-second poll", async () => {
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const assets: NativeVideoManagementAsset[] = [];
    let requests = 0;
    const controller = createNativeVideoPollingController({
      onAsset: (item) => assets.push(item),
      onAuthFailure: () => undefined,
      onError: () => undefined,
      requestAsset: async () => {
        requests += 1;
        return asset({ status: "delete_pending" });
      },
      setTimer(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
    });

    await controller.refresh(assetId);

    expect(requests).toBe(1);
    expect(assets.map((item) => item.status)).toEqual(["delete_pending"]);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.delay).toBe(3_000);
  });
});
