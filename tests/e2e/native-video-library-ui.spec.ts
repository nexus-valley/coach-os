import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { getInactiveShellMode } from "../../src/lib/subscriptionLifecycleModel";
import {
  assetMatchesNativeVideoFilter,
  createNativeVideoPollingController,
  getNativeVideoAsset,
  getNativeVideoAttentionLabel,
  getNativeVideoCapacity,
  getNativeVideoInventory,
  getNativeVideoPollingDelay,
  getNativeVideoStatusLabel,
  mergeNativeVideoManagementPages,
  type NativeVideoManagementAsset,
  NativeVideoManagementRequestError,
  normalizeNativeVideoCapacity,
  normalizeNativeVideoManagementPage,
} from "../../src/lib/video/nativeVideoManagementClient";

const root = process.cwd();
const tenantId = "f93faeee-b177-497e-854e-5052497914b9";
const assetId = "c3cd5bfd-7112-43a9-84e9-63bf69b6fd58";
const courseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const lessonId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const createdAt = "2026-09-24T05:00:00.123456Z";

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function rawAsset(overrides: Record<string, unknown> = {}) {
  return {
    assetId,
    attachments: [
      { courseId, courseTitle: "Program", lessonId, lessonTitle: "Lesson" },
    ],
    attention: null,
    createdAt,
    deleteRequestedAt: null,
    durationSeconds: 75,
    filename: "lesson.mp4",
    reservedSeconds: 0,
    status: "ready",
    updatedAt: createdAt,
    ...overrides,
  };
}

function asset(overrides: Partial<NativeVideoManagementAsset> = {}) {
  return normalizeNativeVideoManagementPage({
    items: [rawAsset(overrides)],
    nextCursor: null,
  }).items[0]!;
}

function rawCapacity(overrides: Record<string, unknown> = {}) {
  return {
    capacity: {
      addOnCapacityMinutes: 0,
      availableForNewUploadMinutes: 597,
      baseCapacityMinutes: 600,
      capacityState: "normal",
      effectiveCapacityMinutes: 600,
      featureEnabled: true,
      overrideCapacityMinutes: null,
      percentUsed: 0.5,
      reservedMinutes: 1,
      storedMinutes: 2,
      ...overrides,
    },
  };
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test.describe("VIDEO-2C2D1 video library", () => {
  test("Owner/Admin navigation and inactive recovery are narrow", () => {
    const permissions = read("src/lib/permissions.ts");
    expect(permissions).toContain('"Video Library": canAccessVideoLibrary');
    expect(permissions).toMatch(
      /function canAccessVideoLibrary[\s\S]*role === "owner" \|\| role === "admin"/,
    );
    expect(getInactiveShellMode("owner", "/app/video-library")).toBe(
      "recovery_content",
    );
    expect(getInactiveShellMode("admin", "/app/video-library/")).toBe(
      "recovery_content",
    );
    expect(getInactiveShellMode("owner", "/app/courses")).toBe("blocked");
    expect(getInactiveShellMode("staff", "/app/video-library")).toBe("blocked");

    const shell = read("src/components/layout/AppShell.tsx");
    expect(shell).toContain('{ href: "/app/video-library", label: "Video Library" }');
    expect(shell).toMatch(/label: "Deliver"[\s\S]*"Video Library"/);
    expect(shell).toMatch(/\["Home", "Subscription", "Video Library"\]/);
  });

  test("page uses RouteGuard and AppShell without a feature gate", () => {
    const page = read("app/app/video-library/page.tsx");
    expect(page).toContain('<RouteGuard mode="app">');
    expect(page).toContain('<AppShell activeItem="Video Library">');
    expect(page).toContain("<VideoLibraryClient />");
    expect(page).not.toContain("FeatureGate");
  });

  test("inventory client uses exact GET path and a fresh bearer token", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const result = await getNativeVideoInventory(
      { cursor: "eyJ2IjoxfQ", limit: 25, tenantId },
      {
        fetchImpl: async (url, init) => {
          calls.push({ init, url: String(url) });
          return response({ items: [rawAsset()], nextCursor: null });
        },
        getAccessToken: async () => "fresh-session-token",
      },
    );

    expect(calls).toEqual([
      {
        init: {
          cache: "no-store",
          headers: { Authorization: "Bearer fresh-session-token" },
          method: "GET",
          signal: undefined,
        },
        url: `/api/video/assets?tenantId=${tenantId}&limit=25&cursor=eyJ2IjoxfQ`,
      },
    ]);
    expect(result.items).toHaveLength(1);
  });

  test("exact item and capacity clients use only canonical GET routes", async () => {
    const calls: string[] = [];
    const options = {
      fetchImpl: async (url: string | URL | Request) => {
        calls.push(String(url));
        return String(url).startsWith("/api/video/capacity")
          ? response(rawCapacity())
          : response({ asset: rawAsset() });
      },
      getAccessToken: async () => "token",
    };

    await expect(getNativeVideoAsset({ assetId, tenantId }, options)).resolves.toMatchObject({
      assetId,
    });
    await expect(getNativeVideoCapacity(tenantId, options)).resolves.toMatchObject({
      effectiveCapacityMinutes: 600,
      overrideCapacityMinutes: null,
    });
    expect(calls).toEqual([
      `/api/video/assets/${assetId}?tenantId=${tenantId}`,
      `/api/video/capacity?tenantId=${tenantId}`,
    ]);
  });

  test("strict DTO normalization rejects private, extra and malformed fields", () => {
    expect(() =>
      normalizeNativeVideoManagementPage({
        items: [rawAsset({ provider_asset_id: "private" })],
        nextCursor: null,
      }),
    ).toThrow(NativeVideoManagementRequestError);
    expect(() =>
      normalizeNativeVideoManagementPage({
        items: [rawAsset({ status: "provider_ready" })],
        nextCursor: null,
      }),
    ).toThrow(NativeVideoManagementRequestError);
    expect(() =>
      normalizeNativeVideoManagementPage({
        items: [rawAsset()],
        nextCursor: "not+a+cursor",
      }),
    ).toThrow(NativeVideoManagementRequestError);
    expect(() =>
      normalizeNativeVideoCapacity(rawCapacity({ hidden_limit: 1 })),
    ).toThrow(NativeVideoManagementRequestError);
  });

  test("pagination preserves order, deduplicates exact replay and rejects conflicts", () => {
    const first = asset();
    const second = asset({
      assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      filename: "second.mp4",
    });
    expect(mergeNativeVideoManagementPages([first], [first, second])).toEqual([
      first,
      second,
    ]);
    expect(() =>
      mergeNativeVideoManagementPages([first], [
        { ...first, filename: "conflicting.mp4" },
      ]),
    ).toThrow(NativeVideoManagementRequestError);
  });

  test("filters and customer-facing labels map all canonical states", () => {
    expect(assetMatchesNativeVideoFilter(asset({ status: "upload_pending" }), "processing")).toBe(true);
    expect(assetMatchesNativeVideoFilter(asset({ status: "processing" }), "processing")).toBe(true);
    expect(assetMatchesNativeVideoFilter(asset({ status: "ready" }), "ready")).toBe(true);
    expect(assetMatchesNativeVideoFilter(asset({ status: "failed" }), "attention")).toBe(true);
    expect(assetMatchesNativeVideoFilter(asset({ attention: "needs_review" }), "attention")).toBe(true);
    expect(assetMatchesNativeVideoFilter(asset({ status: "delete_pending" }), "deleting")).toBe(true);
    expect(assetMatchesNativeVideoFilter(asset({ status: "deleted" }), "all")).toBe(true);

    expect(getNativeVideoStatusLabel("upload_pending")).toBe("Waiting for upload");
    expect(getNativeVideoStatusLabel("processing")).toBe("Processing");
    expect(getNativeVideoStatusLabel("ready")).toBe("Ready");
    expect(getNativeVideoStatusLabel("failed")).toBe("Needs attention");
    expect(getNativeVideoStatusLabel("delete_pending")).toBe("Deleting");
    expect(getNativeVideoStatusLabel("deleted")).toBe("Deleted");
    expect(getNativeVideoAttentionLabel("upload_expired")).toBe("Upload expired");
    expect(getNativeVideoAttentionLabel("processing_failed")).toBe("Processing failed");
    expect(getNativeVideoAttentionLabel("capacity_issue")).toBe("Capacity issue");
    expect(getNativeVideoAttentionLabel("needs_review")).toBe("Needs review");
  });

  test("polling starts at three seconds, advances to ten seconds and stops terminal", async () => {
    let now = 0;
    const scheduled: Array<{ callback: () => void; delay: number; id: number }> = [];
    const cleared: number[] = [];
    const updates: NativeVideoManagementAsset[] = [];
    let responseStatus: NativeVideoManagementAsset["status"] = "processing";
    const controller = createNativeVideoPollingController({
      clearTimer(timer) {
        cleared.push(timer as number);
      },
      now: () => now,
      onAsset: (value) => updates.push(value),
      onAuthFailure: () => undefined,
      onError: () => undefined,
      requestAsset: async () => asset({ status: responseStatus }),
      setTimer(callback, delay) {
        const id = scheduled.length + 1;
        scheduled.push({ callback, delay, id });
        return id;
      },
    });

    controller.sync([asset({ status: "processing" })]);
    expect(scheduled[0]?.delay).toBe(3_000);
    now = 31_000;
    scheduled[0]!.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduled[1]?.delay).toBe(10_000);

    responseStatus = "ready";
    scheduled[1]!.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates.at(-1)?.status).toBe("ready");
    expect(scheduled).toHaveLength(2);
    controller.stopAll();
    expect(cleared).toEqual([]);
  });

  test("polling pauses hidden work, resumes, expires at ten minutes and cleans up", async () => {
    let now = 0;
    const scheduled: Array<{ callback: () => void; delay: number; id: number }> = [];
    const cleared: number[] = [];
    const controller = createNativeVideoPollingController({
      clearTimer: (timer) => cleared.push(timer as number),
      now: () => now,
      onAsset: () => undefined,
      onAuthFailure: () => undefined,
      onError: () => undefined,
      requestAsset: async () => asset({ status: "processing" }),
      setTimer(callback, delay) {
        const id = scheduled.length + 1;
        scheduled.push({ callback, delay, id });
        return id;
      },
    });

    controller.sync([asset({ status: "processing" })]);
    controller.pause();
    expect(cleared).toEqual([1]);
    controller.resume();
    expect(scheduled[1]?.delay).toBe(3_000);
    now = 600_000;
    scheduled[1]!.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduled).toHaveLength(2);
    controller.stopAll();
  });

  test("polling auth failure stops all and manual refresh uses exact request", async () => {
    const scheduled: Array<() => void> = [];
    let authFailures = 0;
    let requests = 0;
    const controller = createNativeVideoPollingController({
      onAsset: () => undefined,
      onAuthFailure: () => {
        authFailures += 1;
      },
      onError: () => undefined,
      requestAsset: async () => {
        requests += 1;
        throw new NativeVideoManagementRequestError(401);
      },
      setTimer(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
    });

    controller.sync([asset({ status: "processing" })]);
    scheduled[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authFailures).toBe(1);
    expect(requests).toBe(1);
    await controller.refresh(assetId);
    expect(requests).toBe(1);
  });

  test("successful manual item refresh updates only the requested asset", async () => {
    const scheduled: Array<{ callback: () => void; delay: number; id: number }> = [];
    const cleared: number[] = [];
    const requestedAssetIds: string[] = [];
    const updates: NativeVideoManagementAsset[] = [];
    const updatedAsset = asset({ status: "processing", updatedAt: "2026-09-24T05:01:00Z" });
    const controller = createNativeVideoPollingController({
      clearTimer: (timer) => cleared.push(timer as number),
      onAsset: (value) => updates.push(value),
      onAuthFailure: () => undefined,
      onError: () => undefined,
      requestAsset: async (requestedAssetId) => {
        requestedAssetIds.push(requestedAssetId);
        return updatedAsset;
      },
      setTimer(callback, delay) {
        const id = scheduled.length + 1;
        scheduled.push({ callback, delay, id });
        return id;
      },
    });

    await controller.refresh(assetId);

    expect(requestedAssetIds).toEqual([assetId]);
    expect(updates).toEqual([updatedAsset]);
    expect(new Set(updates.map((item) => item.assetId))).toEqual(new Set([assetId]));
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(3_000);
    controller.stopAll();
    expect(cleared).toEqual([1]);
  });

  test("feature-disabled capacity copy is customer-safe and inventory is not a broad live region", () => {
    const source = read("src/components/video/VideoLibraryClient.tsx");
    expect(source).toContain("!capacity.featureEnabled");
    expect(source).toContain(
      "New native video uploads are not currently available. Existing videos remain visible.",
    );
    expect(source).toContain(
      "Your workspace is inactive. You can still review existing videos and their current status.",
    );
    expect(source).not.toContain("manage cleanup");
    expect(source).not.toContain('aria-live="polite"');
  });

  test("all capacity states have bounded customer-facing presentation", () => {
    const source = read("src/components/video/VideoLibraryClient.tsx");
    const states = [
      { label: "Capacity available", percentUsed: 0, state: "normal" },
      { label: "Capacity notice", percentUsed: 50, state: "notice" },
      { label: "Capacity running low", percentUsed: 80, state: "warning" },
      { label: "Capacity nearly full", percentUsed: 95, state: "critical" },
      { label: "Capacity full", percentUsed: 100, state: "full" },
    ] as const;

    for (const expected of states) {
      const normalized = normalizeNativeVideoCapacity(
        rawCapacity({ capacityState: expected.state, percentUsed: expected.percentUsed }),
      );
      expect(normalized.capacityState).toBe(expected.state);
      expect(normalized.percentUsed).toBeGreaterThanOrEqual(0);
      expect(normalized.percentUsed).toBeLessThanOrEqual(100);
      expect(source).toContain(`${expected.state}: "${expected.label}"`);
    }
    expect(source).toContain(
      "Math.min(100, Math.max(0, capacity.percentUsed))",
    );
  });

  test("component includes loading, empty, populated, capacity and responsive states", () => {
    const source = read("src/components/video/VideoLibraryClient.tsx");
    expect(source).toContain("CapacitySkeleton");
    expect(source).toContain("InventorySkeleton");
    expect(source).toContain("No videos yet");
    expect(source).toContain("No matching videos");
    expect(source).toContain("Load more");
    expect(source).toContain('{ label: "Used", value: capacity.storedMinutes }');
    expect(source).toContain('{ label: "Processing", value: capacity.reservedMinutes }');
    expect(source).toContain("capacity.availableForNewUploadMinutes");
    expect(source).toContain("Total capacity");
    expect(source).toContain('className="hidden md:block"');
    expect(source).toContain('className="divide-y divide-[#E2E8F0] md:hidden"');
    expect(source).toContain("<UsageDetails asset={asset} />");
    expect(source).toContain('asset.status === "deleted"');
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-pressed={filter === item.value}');
  });

  test("visibility, tenant change and unmount wire polling cleanup without realtime", () => {
    const source = read("src/components/video/VideoLibraryClient.tsx");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain("if (document.hidden) controller.pause()");
    expect(source).toContain("else controller.resume()");
    expect(source).toContain("controller.stopAll()");
    expect(source).toContain("}, [tenantId]);");
    expect(source).not.toContain("channel(");
    expect(source).not.toContain("postgres_changes");
  });

  test("library introduces no direct tables, mutation, playback or provider capability", () => {
    const component = read("src/components/video/VideoLibraryClient.tsx");
    const client = read("src/lib/video/nativeVideoManagementClient.ts");
    const combined = `${component}\n${client}`;
    expect(combined).not.toMatch(/\.from\(["']video_assets["']\)/);
    expect(combined).not.toMatch(/\.from\(["']video_asset_attachments["']\)/);
    expect(combined).not.toContain("video_provider_events");
    expect(combined).not.toContain("video_upload_sessions");
    expect(combined).not.toContain("/playback");
    expect(combined).not.toContain("/api/video/uploads");
    expect(combined).not.toContain("Cloudflare");
    expect(combined).not.toContain("providerAssetId");
    expect(combined).not.toContain("uploadUrl");
    expect(client).toContain('method: "GET"');
  });

  test("polling delay contract is bounded", () => {
    expect(getNativeVideoPollingDelay(0)).toBe(3_000);
    expect(getNativeVideoPollingDelay(29_999)).toBe(3_000);
    expect(getNativeVideoPollingDelay(30_000)).toBe(10_000);
    expect(getNativeVideoPollingDelay(599_999)).toBe(10_000);
    expect(getNativeVideoPollingDelay(600_000)).toBeNull();
  });
});
