import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CourseSectionWithLessons, Lesson } from "../../src/lib/courses";
import {
  areLessonModalActionsBlocked,
  buildExternalVideoClearInput,
  clearCanonicalExternalVideoState,
  clearExternalVideoFromCourseStructure,
  clearExternalVideoWithCanonicalReconciliation,
  createPersistedLessonEditorSnapshot,
  ExternalVideoClearError,
  reconcileNativeVideoAttachFailure,
  resolveLessonVideoMode,
  runNativeVideoAttachTransition,
  runLessonVideoMutation,
} from "../../src/lib/video/nativeVideoLessonEditorState";

const root = process.cwd();
const courseId = "11111111-1111-4111-8111-111111111111";
const sectionId = "22222222-2222-4222-8222-222222222222";
const lessonId = "33333333-3333-4333-8333-333333333333";
const tenantId = "44444444-4444-4444-8444-444444444444";
const externalUrl = "https://www.youtube.com/watch?v=abcdefghijk";

const read = (path: string) => readFileSync(join(root, path), "utf8");

function persistedLesson(): Lesson {
  return {
    content: "Content A",
    course_id: courseId,
    created_at: "2026-09-27T08:00:00.000Z",
    id: lessonId,
    is_preview: false,
    lesson_type: "video",
    resource_url: "https://coachfort.com/resource-a",
    section_id: sectionId,
    sort_order: 1,
    tenant_id: tenantId,
    title: "Title A",
    updated_at: "2026-09-27T08:00:00.000Z",
    video_url: externalUrl,
  };
}

function canonicalState(lesson: Lesson) {
  return {
    lesson,
    sections: [
      {
        course_id: courseId,
        created_at: lesson.created_at,
        id: sectionId,
        lessons: [lesson],
        sort_order: 0,
        tenant_id: tenantId,
        title: "Section",
        updated_at: lesson.updated_at,
      },
    ] satisfies CourseSectionWithLessons[],
  };
}

test.describe("VIDEO-2C2D3-C1 lesson editor state integrity", () => {
  test("external clear uses fresh canonical values while retaining unrelated modal drafts", async () => {
    const openSnapshot = createPersistedLessonEditorSnapshot(persistedLesson());
    const latestLesson = {
      ...persistedLesson(),
      content: "Content C",
      resource_url: "https://coachfort.com/resource-c",
      title: "Title C",
      updated_at: "2026-09-27T09:00:00.000Z",
    };
    const draft = {
      ...openSnapshot,
      content: "Content B",
      isPreview: true,
      mode: "edit" as const,
      resourceUrl: "https://coachfort.com/resource-b",
      title: "Title B",
      videoUrl: "https://vimeo.com/123456789",
    };
    let clearInput: ReturnType<typeof buildExternalVideoClearInput> | null = null;

    const outcome = await clearExternalVideoWithCanonicalReconciliation({
      async clearCanonical(lesson) {
        clearInput = buildExternalVideoClearInput(
          createPersistedLessonEditorSnapshot(lesson),
          { courseId, tenantId },
        );
      },
      async readCanonical() {
        return canonicalState(latestLesson);
      },
    });

    expect(clearInput).toEqual({
      content: "Content C",
      courseId,
      isPreview: false,
      lessonId,
      lessonType: "video",
      resourceUrl: "https://coachfort.com/resource-c",
      sectionId,
      tenantId,
      title: "Title C",
      videoUrl: "",
    });

    const latestSnapshot = createPersistedLessonEditorSnapshot(
      outcome.canonical.lesson,
    );
    const cleared = clearCanonicalExternalVideoState(draft, latestSnapshot);
    expect(outcome.status).toBe("cleared");
    expect(cleared.snapshot).toMatchObject({
      content: "Content C",
      resourceUrl: "https://coachfort.com/resource-c",
      title: "Title C",
      videoUrl: "",
    });
    expect(cleared.draft).toEqual({
      ...draft,
      content: "Content B",
      isPreview: true,
      resourceUrl: "https://coachfort.com/resource-b",
      title: "Title B",
      videoUrl: "",
    });
  });

  test("canonical external state requires a clear even when the draft is empty", async () => {
    let clearCalls = 0;
    const outcome = await clearExternalVideoWithCanonicalReconciliation({
      async clearCanonical() {
        clearCalls += 1;
      },
      async readCanonical() {
        return canonicalState(persistedLesson());
      },
    });

    expect(clearCalls).toBe(1);
    expect(outcome.status).toBe("cleared");
    for (const draftExternalUrl of ["", "https://vimeo.com/123456789"]) {
      const order: string[] = [];
      let localExternalUrl = draftExternalUrl;
      const transition = await runNativeVideoAttachTransition({
        async attachNative() {
          order.push("put");
          expect(localExternalUrl).toBe("");
          return "attached";
        },
        hasNativeAttachment: false,
        onExternalCleared() {
          order.push("local_clear");
          localExternalUrl = "";
        },
        async prepareCanonicalExternal() {
          order.push("canonical_prepare");
          return outcome.status;
        },
      });
      expect(transition.status).toBe("attached");
      expect(order).toEqual(["canonical_prepare", "local_clear", "put"]);
    }
  });

  test("canonical already-clear state skips the lesson write and attaches once", async () => {
    for (const draftExternalUrl of ["", "https://vimeo.com/123456789"]) {
      let clearCalls = 0;
      const preparation = await clearExternalVideoWithCanonicalReconciliation({
        async clearCanonical() {
          clearCalls += 1;
        },
        async readCanonical() {
          return canonicalState({ ...persistedLesson(), video_url: null });
        },
      });
      let attachCalls = 0;
      let localExternalUrl = draftExternalUrl;
      const transition = await runNativeVideoAttachTransition({
        async attachNative() {
          attachCalls += 1;
          expect(localExternalUrl).toBe(draftExternalUrl);
          return "attached";
        },
        hasNativeAttachment: false,
        onExternalCleared() {
          localExternalUrl = "";
        },
        async prepareCanonicalExternal() {
          return preparation.status;
        },
      });

      expect(clearCalls).toBe(0);
      expect(preparation.status).toBe("already_clear");
      expect(attachCalls).toBe(1);
      expect(transition).toEqual({ result: "attached", status: "attached" });
      expect(localExternalUrl).toBe("");
    }
  });

  test("native replacement is one PUT with no canonical external preparation", async () => {
    let preparationCalls = 0;
    let attachCalls = 0;
    let localClearCalls = 0;
    const transition = await runNativeVideoAttachTransition({
      async attachNative() {
        attachCalls += 1;
        return "replacement";
      },
      hasNativeAttachment: true,
      onExternalCleared() {
        localClearCalls += 1;
      },
      async prepareCanonicalExternal() {
        preparationCalls += 1;
        return "already_clear";
      },
    });

    expect(transition).toEqual({ result: "replacement", status: "attached" });
    expect(preparationCalls).toBe(0);
    expect(attachCalls).toBe(1);
    expect(localClearCalls).toBe(1);
  });

  test("ambiguous clear reconciles a committed clear without authorizing a second mutation", async () => {
    const latestLesson = { ...persistedLesson(), title: "Title C" };
    const clearedLesson = { ...latestLesson, video_url: null };
    const reads = [canonicalState(latestLesson), canonicalState(clearedLesson)];
    let clearCalls = 0;

    const outcome = await clearExternalVideoWithCanonicalReconciliation({
      async clearCanonical() {
        clearCalls += 1;
        throw new Error("ambiguous transport failure");
      },
      async readCanonical() {
        const current = reads.shift();
        if (!current) throw new Error("unexpected read");
        return current;
      },
    });

    expect(clearCalls).toBe(1);
    expect(reads).toHaveLength(0);
    expect(outcome.status).toBe("reconciled_cleared");
    expect(outcome.canonical.lesson.video_url).toBeNull();
    expect(
      resolveLessonVideoMode({
        externalVideoUrl: outcome.canonical.lesson.video_url ?? "",
        hasNativeAttachment: false,
      }),
    ).toBe("none");

    let attachCalls = 0;
    let localClearCalls = 0;
    const transition = await runNativeVideoAttachTransition({
      async attachNative() {
        attachCalls += 1;
        return "unexpected";
      },
      hasNativeAttachment: false,
      onExternalCleared() {
        localClearCalls += 1;
      },
      async prepareCanonicalExternal() {
        return outcome.status;
      },
    });
    expect(transition).toEqual({ status: "reconciled_cleared" });
    expect(attachCalls).toBe(0);
    expect(localClearCalls).toBe(1);
  });

  test("a true clear failure remains External and fails closed", async () => {
    const latest = canonicalState({ ...persistedLesson(), title: "Title C" });
    let reads = 0;
    let attachCalls = 0;
    const operation = runNativeVideoAttachTransition({
      async attachNative() {
        attachCalls += 1;
        return "unexpected";
      },
      hasNativeAttachment: false,
      onExternalCleared() {
        throw new Error("must not clear local state");
      },
      async prepareCanonicalExternal() {
        const outcome = await clearExternalVideoWithCanonicalReconciliation({
          async clearCanonical() {
            throw new Error("clear failed");
          },
          async readCanonical() {
            reads += 1;
            return latest;
          },
        });
        return outcome.status;
      },
    });

    await expect(operation).rejects.toMatchObject({
      code: "EXTERNAL_VIDEO_CLEAR_FAILED",
      canonical: latest,
      message: "Unable to update this lesson video right now. Try again.",
    });
    expect(reads).toBe(2);
    expect(attachCalls).toBe(0);
    expect(
      resolveLessonVideoMode({
        externalVideoUrl: latest.lesson.video_url ?? "",
        hasNativeAttachment: false,
      }),
    ).toBe("external");
  });

  test("a failed reconciliation read fabricates no canonical outcome", async () => {
    let reads = 0;
    const operation = clearExternalVideoWithCanonicalReconciliation({
      async clearCanonical() {
        throw new Error("ambiguous transport failure");
      },
      async readCanonical() {
        reads += 1;
        if (reads === 1) return canonicalState(persistedLesson());
        throw new Error("canonical read unavailable");
      },
    });

    await expect(operation).rejects.toBeInstanceOf(ExternalVideoClearError);
    await expect(operation).rejects.toMatchObject({
      code: "EXTERNAL_VIDEO_RECONCILIATION_FAILED",
      canonical: null,
    });
  });

  test("unknown canonical preparation failures retain mode and skip native reconciliation", async () => {
    for (const code of [
      "EXTERNAL_VIDEO_CANONICAL_READ_FAILED",
      "EXTERNAL_VIDEO_RECONCILIATION_FAILED",
    ] as const) {
      let attachCalls = 0;
      let refreshCalls = 0;
      let canonicalSyncCalls = 0;
      let mode = "native";
      let safeError = "";
      const busy: boolean[] = [];

      await runLessonVideoMutation({
        begin: () => busy.push(true),
        isCurrent: () => true,
        async operation() {
          try {
            await runNativeVideoAttachTransition({
              async attachNative() {
                attachCalls += 1;
                return "unexpected";
              },
              hasNativeAttachment: false,
              onExternalCleared() {
                throw new Error("must not clear local state");
              },
              async prepareCanonicalExternal() {
                throw new ExternalVideoClearError(code);
              },
            });
          } catch (error) {
            safeError = "Unable to update this lesson video right now. Try again.";
            await reconcileNativeVideoAttachFailure({
              error,
              async refreshNative() {
                refreshCalls += 1;
                mode = "none";
              },
              synchronizeCanonicalExternal() {
                canonicalSyncCalls += 1;
                mode = "external";
              },
            });
          }
        },
        release: () => busy.push(false),
      });

      expect(attachCalls).toBe(0);
      expect(refreshCalls).toBe(0);
      expect(canonicalSyncCalls).toBe(0);
      expect(mode).toBe("native");
      expect(safeError).toBe(
        "Unable to update this lesson video right now. Try again.",
      );
      expect(busy).toEqual([true, false]);
    }
  });

  test("known canonical preparation failure synchronizes External without native GET", async () => {
    const canonical = canonicalState(persistedLesson());
    const error = new ExternalVideoClearError(
      "EXTERNAL_VIDEO_CLEAR_FAILED",
      canonical,
    );
    let refreshCalls = 0;
    let synchronizedUrl = "";

    const result = await reconcileNativeVideoAttachFailure({
      error,
      async refreshNative() {
        refreshCalls += 1;
      },
      synchronizeCanonicalExternal(externalVideoUrl) {
        synchronizedUrl = externalVideoUrl;
      },
    });

    expect(result).toBe("external_preparation_failed");
    expect(refreshCalls).toBe(0);
    expect(synchronizedUrl).toBe(externalUrl);
    expect(
      resolveLessonVideoMode({
        externalVideoUrl: synchronizedUrl,
        hasNativeAttachment: false,
      }),
    ).toBe("external");
  });

  test("native PUT failures retain exact native reconciliation after preparation", async () => {
    for (const preparationStatus of ["cleared", "already_clear"] as const) {
      let refreshCalls = 0;
      let putCalls = 0;
      let localExternalUrl =
        preparationStatus === "already_clear"
          ? "https://vimeo.com/123456789"
          : externalUrl;
      try {
        await runNativeVideoAttachTransition({
          async attachNative() {
            putCalls += 1;
            throw new Error("ambiguous native PUT response");
          },
          hasNativeAttachment: false,
          onExternalCleared() {
            localExternalUrl = "";
          },
          async prepareCanonicalExternal() {
            return preparationStatus;
          },
        });
      } catch (error) {
        const result = await reconcileNativeVideoAttachFailure({
          error,
          async refreshNative() {
            refreshCalls += 1;
          },
          synchronizeCanonicalExternal() {
            throw new Error("native failure must not use preparation recovery");
          },
        });
        expect(result).toBe("native_reconciled");
      }

      expect(putCalls).toBe(1);
      expect(refreshCalls).toBe(1);
      expect(localExternalUrl).toBe(
        preparationStatus === "cleared"
          ? ""
          : "https://vimeo.com/123456789",
      );
    }
  });

  test("a failed native attach after external clear resolves to canonical No video", () => {
    const snapshot = createPersistedLessonEditorSnapshot(persistedLesson());
    const cleared = clearCanonicalExternalVideoState(
      { ...snapshot, mode: "edit" as const },
      snapshot,
    );

    expect(
      resolveLessonVideoMode({
        externalVideoUrl: cleared.draft.videoUrl,
        hasNativeAttachment: false,
      }),
    ).toBe("none");
    expect(cleared.draft.videoUrl).toBe("");
    expect(cleared.snapshot.videoUrl).toBe("");
  });

  test("parent lesson actions are blocked by video work, lesson save, or role", () => {
    expect(
      areLessonModalActionsBlocked({
        canManage: true,
        lessonMutationBusy: false,
        videoMutationBusy: false,
      }),
    ).toBe(false);
    for (const input of [
      { canManage: true, lessonMutationBusy: false, videoMutationBusy: true },
      { canManage: true, lessonMutationBusy: true, videoMutationBusy: false },
      { canManage: false, lessonMutationBusy: false, videoMutationBusy: false },
    ]) {
      expect(areLessonModalActionsBlocked(input)).toBe(true);
    }
  });

  test("video mutation busy state is released on success and failure", async () => {
    for (const shouldFail of [false, true]) {
      const busy: boolean[] = [];
      const operation = runLessonVideoMutation({
        begin: () => busy.push(true),
        isCurrent: () => true,
        operation: async () => {
          if (shouldFail) throw new Error("safe test failure");
          return "complete";
        },
        release: () => busy.push(false),
      });

      if (shouldFail) await expect(operation).rejects.toThrow("safe test failure");
      else await expect(operation).resolves.toBe("complete");
      expect(busy).toEqual([true, false]);
    }
  });

  test("an obsolete operation cannot release a newer operation's busy lock", async () => {
    const busy: boolean[] = [];
    await runLessonVideoMutation({
      begin: () => busy.push(true),
      isCurrent: () => false,
      operation: async () => undefined,
      release: () => busy.push(false),
    });
    expect(busy).toEqual([true]);
  });

  test("committed external clear synchronizes the parent course projection", () => {
    const lesson = persistedLesson();
    const sections = [
      {
        course_id: courseId,
        created_at: lesson.created_at,
        id: sectionId,
        lessons: [lesson],
        sort_order: 0,
        tenant_id: tenantId,
        title: "Section",
        updated_at: lesson.updated_at,
      },
    ] satisfies CourseSectionWithLessons[];

    const updated = clearExternalVideoFromCourseStructure(sections, lessonId);
    expect(updated[0]?.lessons[0]?.video_url).toBeNull();
    expect(sections[0]?.lessons[0]?.video_url).toBe(externalUrl);
  });

  test("course modal coordinates snapshot, permission, submit and close boundaries", () => {
    const source = read("src/components/courses/CourseDetailClient.tsx");
    expect(source).toContain("createPersistedLessonEditorSnapshot(lesson)");
    expect(source).toContain("const canonicalSections = await getCourseStructure");
    expect(source).toContain("buildExternalVideoClearInput(canonicalSnapshot");
    expect(source).not.toContain(
      "buildExternalVideoClearInput(persistedLessonSnapshot",
    );
    expect(source).toContain('outcome.status !== "already_clear"');
    expect(source).toContain("error.canonical");
    expect(source).toContain("if (!tenant || !lessonModal || lessonActionsBlocked)");
    expect(source).toContain("disabled={lessonActionsBlocked}");
    expect(source).toContain("onClick={closeLessonModal}");
    expect(source).toContain("disabled={lessonCloseBlocked}");
    expect(source).toContain("onMutationBusyChange={setVideoMutationBusy}");
  });

  test("cross-mode operations retain one canonical mutation and deterministic failure refresh", () => {
    const source = read("src/components/video/LessonNativeVideoEditor.tsx");
    const attachStart = source.indexOf("async function attach");
    const detachStart = source.indexOf("async function detach", attachStart);
    const chooseStart = source.indexOf("async function chooseMode", detachStart);
    const attach = source.slice(attachStart, detachStart);
    const detach = source.slice(detachStart, chooseStart);

    expect(attach.match(/putNativeVideoLessonAttachment\(/g)).toHaveLength(1);
    expect(attach).not.toContain("deleteNativeVideoLessonAttachment(");
    expect(attach).not.toContain("if (externalVideoUrl.trim())");
    expect(attach).toContain("hasNativeAttachment: Boolean(state?.attachment)");
    expect(attach).toContain("runNativeVideoAttachTransition({");
    expect(attach).toContain("reconcileNativeVideoAttachFailure({");
    expect(attach).toMatch(
      /transition\.status === "reconciled_cleared"[\s\S]*setMode\("none"\)[\s\S]*return;/,
    );
    expect(attach).toContain("onExternalVideoUrlChange(canonicalExternalUrl)");
    expect(attach).toContain(
      "refreshNative: () => refreshAfterFailure(controller.signal)",
    );
    expect(detach.match(/deleteNativeVideoLessonAttachment\(/g)).toHaveLength(1);
    expect(detach).not.toContain("putNativeVideoLessonAttachment(");
    expect(source).toContain("await detach(nextMode)");
  });

  test("UI explains immediate video saves and introduces no provider authority", () => {
    const editor = read("src/components/video/LessonNativeVideoEditor.tsx");
    const course = read("src/components/courses/CourseDetailClient.tsx");
    const combined = `${editor}\n${course}`;

    expect(editor).toContain(
      "CoachFort video changes save immediately. Other lesson changes save with Save lesson.",
    );
    expect(editor).toContain("This lesson has no video.");
    expect(editor).not.toContain(
      "This lesson has no video. Save the lesson to keep this choice.",
    );
    expect(combined).not.toContain("providerAssetId");
    expect(combined).not.toContain("providerUid");
    expect(combined).not.toContain("video_provider_events");
    expect(combined).not.toContain("video_upload_sessions");
    expect(combined).not.toContain("Cloudflare");
  });
});
