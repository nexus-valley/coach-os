import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { filterReadyNativeVideoAssets } from "../../src/components/video/LessonNativeVideoEditor";
import {
  deleteNativeVideoLessonAttachment,
  getNativeVideoLessonState,
  NativeVideoLessonRequestError,
  normalizeNativeVideoLessonState,
  putNativeVideoLessonAttachment,
} from "../../src/lib/video/nativeVideoLessonAttachmentClient";
import type { NativeVideoManagementAsset } from "../../src/lib/video/nativeVideoManagementClient";

const root = process.cwd();
const lessonId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";
const tenantId = "11111111-1111-4111-8111-111111111111";
const attachedAt = "2026-09-27T08:00:00.000Z";

const read = (path: string) => readFileSync(join(root, path), "utf8");

function state(overrides: Record<string, unknown> = {}) {
  return {
    attachment: {
      assetId,
      attachedAt,
      durationSeconds: 24,
      filename: "lesson-video.mp4",
      status: "ready",
    },
    lessonId,
    ...overrides,
  };
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function asset(
  id: string,
  status: NativeVideoManagementAsset["status"],
): NativeVideoManagementAsset {
  return {
    assetId: id,
    attachments: [],
    attention: null,
    createdAt: attachedAt,
    deleteRequestedAt: null,
    durationSeconds: 24,
    filename: `${id}.mp4`,
    reservedSeconds: 0,
    status,
    updatedAt: attachedAt,
  };
}

test.describe("VIDEO-2C2D3-C lesson native-video management", () => {
  test("strict browser DTO accepts only the safe canonical lesson state", () => {
    expect(normalizeNativeVideoLessonState(state(), lessonId)).toEqual(state());
    expect(
      normalizeNativeVideoLessonState(
        { attachment: null, lessonId: lessonId.toUpperCase() },
        lessonId,
      ),
    ).toEqual({ attachment: null, lessonId });

    for (const malformed of [
      state({ providerAssetId: "private" }),
      state({ requestId: assetId }),
      state({ lessonId: tenantId }),
      state({ attachment: { ...state().attachment, providerUid: "private" } }),
      state({ attachment: { ...state().attachment, durationSeconds: 0 } }),
      state({ attachment: { ...state().attachment, status: "provider_ready" } }),
    ]) {
      expect(() => normalizeNativeVideoLessonState(malformed, lessonId)).toThrow(
        NativeVideoLessonRequestError,
      );
    }
  });

  test("GET uses the exact lesson route, fresh bearer session and no-store", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    await expect(
      getNativeVideoLessonState(
        { lessonId, tenantId },
        {
          fetchImpl: async (url, init) => {
            calls.push({ init, url: String(url) });
            return response(state());
          },
          getAccessToken: async () => "fresh-session-token",
        },
      ),
    ).resolves.toEqual(state());

    expect(calls).toEqual([
      {
        init: {
          cache: "no-store",
          headers: { Authorization: "Bearer fresh-session-token" },
          method: "GET",
          signal: undefined,
        },
        url: `/api/video/lessons/${lessonId}/native-video?tenantId=${tenantId}`,
      },
    ]);
  });

  test("PUT and DELETE send exact bodies and accept only canonical server state", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    const options = {
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          body: JSON.parse(String(init?.body)),
          method: String(init?.method),
          url: String(url),
        });
        return response(
          init?.method === "PUT" ? state() : { attachment: null, lessonId },
        );
      },
      getAccessToken: async () => "fresh-session-token",
    };

    await expect(
      putNativeVideoLessonAttachment({ assetId, lessonId, tenantId }, options),
    ).resolves.toEqual(state());
    await expect(
      deleteNativeVideoLessonAttachment({ lessonId, tenantId }, options),
    ).resolves.toEqual({ attachment: null, lessonId });
    expect(calls).toEqual([
      {
        body: { assetId, tenantId },
        method: "PUT",
        url: `/api/video/lessons/${lessonId}/native-video`,
      },
      {
        body: { tenantId },
        method: "DELETE",
        url: `/api/video/lessons/${lessonId}/native-video`,
      },
    ]);
  });

  test("browser client fails closed for missing auth, safe HTTP failures and malformed success", async () => {
    await expect(
      getNativeVideoLessonState(
        { lessonId, tenantId },
        { getAccessToken: async () => null },
      ),
    ).rejects.toMatchObject({ status: 401 });

    for (const status of [401, 403, 404, 409, 500]) {
      await expect(
        getNativeVideoLessonState(
          { lessonId, tenantId },
          {
            fetchImpl: async () => response({ private: "database detail" }, status),
            getAccessToken: async () => "token",
          },
        ),
      ).rejects.toMatchObject({ status });
    }

    await expect(
      getNativeVideoLessonState(
        { lessonId, tenantId },
        {
          fetchImpl: async () => response({ ...state(), providerUid: "private" }),
          getAccessToken: async () => "token",
        },
      ),
    ).rejects.toMatchObject({ status: 500 });
  });

  test("ready-only filtering excludes every non-ready canonical state", () => {
    const statuses: NativeVideoManagementAsset["status"][] = [
      "upload_pending",
      "processing",
      "ready",
      "failed",
      "delete_pending",
      "deleted",
    ];
    const assets = statuses.map((status, index) =>
      asset(`00000000-0000-4000-8000-00000000000${index}`, status),
    );
    expect(filterReadyNativeVideoAssets(assets).map((item) => item.status)).toEqual([
      "ready",
    ]);
  });

  test("editor loads exact state, paginates inventory and uses canonical mode labels", () => {
    const editor = read("src/components/video/LessonNativeVideoEditor.tsx");
    expect(editor).toContain("getNativeVideoLessonState(");
    expect(editor).toContain("getNativeVideoInventory(");
    expect(editor).toContain("mergeNativeVideoManagementPages(current, ready)");
    expect(editor).toContain("setNextCursor(page.nextCursor)");
    expect(editor).toContain("inventoryControllerRef.current?.abort()");
    expect(editor).toMatch(
      /async function openPicker\(\)[\s\S]*if \(!lessonId\)[\s\S]*return;[\s\S]*loadAssets\(null, true\)/,
    );
    expect(editor).toContain('"No video"');
    expect(editor).toContain('"External link"');
    expect(editor).toContain('"CoachFort video"');
    expect(editor).toContain("Replace video");
    expect(editor).toContain("Remove from lesson");
    expect(editor).not.toContain("Delete video");
    expect(editor).toContain("disabled={unavailable}");
    expect(editor).toContain("disabled={disabled || busy}");
  });

  test("native replacement is one PUT while source switches retain ordered two-step authority", () => {
    const editor = read("src/components/video/LessonNativeVideoEditor.tsx");
    const attachStart = editor.indexOf("async function attach");
    const detachStart = editor.indexOf("async function detach", attachStart);
    const attach = editor.slice(attachStart, detachStart);
    const detach = editor.slice(detachStart, editor.indexOf("async function chooseMode"));

    expect(attach.match(/putNativeVideoLessonAttachment\(/g)).toHaveLength(1);
    expect(attach).not.toContain("deleteNativeVideoLessonAttachment(");
    expect(attach).toContain("runNativeVideoAttachTransition({");
    expect(attach).toContain("hasNativeAttachment: Boolean(state?.attachment)");
    expect(attach).not.toContain("if (externalVideoUrl.trim())");
    expect(detach.match(/deleteNativeVideoLessonAttachment\(/g)).toHaveLength(1);
    expect(detach).not.toContain("putNativeVideoLessonAttachment(");
    expect(editor).toContain('await detach(nextMode)');
    expect(editor).toContain("await refreshAfterFailure(controller.signal)");
  });

  test("course editor uses canonical lesson update for external clearing and preserves new-lesson safety", () => {
    const editor = read("src/components/video/LessonNativeVideoEditor.tsx");
    const course = read("src/components/courses/CourseDetailClient.tsx");
    const clearStart = course.indexOf("async function clearExternalVideoBeforeNative");
    const clearEnd = course.indexOf("async function handleDeleteConfirm", clearStart);
    const clear = course.slice(clearStart, clearEnd);

    expect(clear).toContain(
      "await updateLesson(buildExternalVideoClearInput(canonicalSnapshot",
    );
    expect(clear).toContain("const canonicalSections = await getCourseStructure");
    expect(clear).toContain("clearExternalVideoWithCanonicalReconciliation");
    expect(clear).not.toContain(
      "buildExternalVideoClearInput(persistedLessonSnapshot",
    );
    expect(clear).not.toContain("content: lessonModal.content");
    expect(clear).not.toContain("title: lessonModal.title");
    expect(course).toContain("onClearExternalBeforeNative={clearExternalVideoBeforeNative}");
    expect(editor).toContain(
      "Save this lesson first, then reopen it to choose a CoachFort video.",
    );
  });

  test("browser layer introduces no provider, playback, protected-table or direct mutation authority", () => {
    const editor = read("src/components/video/LessonNativeVideoEditor.tsx");
    const client = read("src/lib/video/nativeVideoLessonAttachmentClient.ts");
    const combined = `${editor}\n${client}`;

    expect(combined).not.toMatch(/\.from\(["'](?:video_assets|video_asset_attachments)["']\)/);
    expect(combined).not.toContain("video_provider_events");
    expect(combined).not.toContain("video_upload_sessions");
    expect(combined).not.toContain("providerAssetId");
    expect(combined).not.toContain("providerUid");
    expect(combined).not.toContain("uploadUrl");
    expect(combined).not.toContain("/playback");
    expect(combined).not.toContain("Cloudflare");
    expect(combined).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
