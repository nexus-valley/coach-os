import type {
  CourseSectionWithLessons,
  Lesson,
  LessonType,
  UpdateLessonInput,
} from "@/src/lib/courses";

export type PersistedLessonEditorSnapshot = {
  content: string;
  isPreview: boolean;
  lessonId: string;
  lessonType: LessonType;
  resourceUrl: string;
  sectionId: string;
  title: string;
  videoUrl: string;
};

export type LessonEditorDraft = PersistedLessonEditorSnapshot & {
  mode: "edit";
};

export type CanonicalLessonEditorState = {
  lesson: Lesson;
  sections: CourseSectionWithLessons[];
};

export type ExternalVideoClearOutcome = {
  canonical: CanonicalLessonEditorState;
  status: "already_clear" | "cleared" | "reconciled_cleared";
};

export class ExternalVideoClearError extends Error {
  readonly code:
    | "EXTERNAL_VIDEO_CANONICAL_READ_FAILED"
    | "EXTERNAL_VIDEO_CLEAR_FAILED"
    | "EXTERNAL_VIDEO_RECONCILIATION_FAILED";
  readonly canonical: CanonicalLessonEditorState | null;

  constructor(
    code: ExternalVideoClearError["code"],
    canonical: CanonicalLessonEditorState | null = null,
  ) {
    super("Unable to update this lesson video right now. Try again.");
    this.name = "ExternalVideoClearError";
    this.code = code;
    this.canonical = canonical;
  }
}

export function createPersistedLessonEditorSnapshot(
  lesson: Lesson,
): PersistedLessonEditorSnapshot {
  return {
    content: lesson.content ?? "",
    isPreview: lesson.is_preview,
    lessonId: lesson.id,
    lessonType: lesson.lesson_type,
    resourceUrl: lesson.resource_url ?? "",
    sectionId: lesson.section_id,
    title: lesson.title,
    videoUrl: lesson.video_url ?? "",
  };
}

export function buildExternalVideoClearInput(
  snapshot: PersistedLessonEditorSnapshot,
  authority: { courseId: string; tenantId: string },
): UpdateLessonInput {
  return {
    content: snapshot.content,
    courseId: authority.courseId,
    isPreview: snapshot.isPreview,
    lessonId: snapshot.lessonId,
    lessonType: snapshot.lessonType,
    resourceUrl: snapshot.resourceUrl,
    sectionId: snapshot.sectionId,
    tenantId: authority.tenantId,
    title: snapshot.title,
    videoUrl: "",
  };
}

export function clearCanonicalExternalVideoState<T extends LessonEditorDraft>(
  draft: T,
  snapshot: PersistedLessonEditorSnapshot,
) {
  if (draft.lessonId !== snapshot.lessonId) {
    throw new Error("Lesson editor snapshot does not match the active draft.");
  }

  return {
    draft: { ...draft, videoUrl: "" },
    snapshot: { ...snapshot, videoUrl: "" },
  };
}

export function clearExternalVideoFromCourseStructure(
  sections: CourseSectionWithLessons[],
  lessonId: string,
) {
  return sections.map((section) => ({
    ...section,
    lessons: section.lessons.map((lesson) =>
      lesson.id === lessonId ? { ...lesson, video_url: null } : lesson,
    ),
  }));
}

export function findLessonInCourseStructure(
  sections: CourseSectionWithLessons[],
  lessonId: string,
) {
  for (const section of sections) {
    const lesson = section.lessons.find((item) => item.id === lessonId);
    if (lesson) return lesson;
  }
  return null;
}

export async function clearExternalVideoWithCanonicalReconciliation(input: {
  clearCanonical: (lesson: Lesson) => Promise<void>;
  readCanonical: () => Promise<CanonicalLessonEditorState>;
}): Promise<ExternalVideoClearOutcome> {
  let latest: CanonicalLessonEditorState;
  try {
    latest = await input.readCanonical();
  } catch {
    throw new ExternalVideoClearError("EXTERNAL_VIDEO_CANONICAL_READ_FAILED");
  }

  if (!latest.lesson.video_url?.trim()) {
    return {
      canonical: latest,
      status: "already_clear",
    };
  }

  try {
    await input.clearCanonical(latest.lesson);
  } catch {
    let reconciled: CanonicalLessonEditorState;
    try {
      reconciled = await input.readCanonical();
    } catch {
      throw new ExternalVideoClearError(
        "EXTERNAL_VIDEO_RECONCILIATION_FAILED",
      );
    }

    if (reconciled.lesson.video_url?.trim()) {
      throw new ExternalVideoClearError(
        "EXTERNAL_VIDEO_CLEAR_FAILED",
        reconciled,
      );
    }

    return {
      canonical: reconciled,
      status: "reconciled_cleared",
    };
  }

  return {
    canonical: {
      lesson: { ...latest.lesson, video_url: null },
      sections: clearExternalVideoFromCourseStructure(
        latest.sections,
        latest.lesson.id,
      ),
    },
    status: "cleared",
  };
}

export async function runNativeVideoAttachTransition<T>(input: {
  attachNative: () => Promise<T>;
  hasNativeAttachment: boolean;
  onExternalCleared: () => void;
  prepareCanonicalExternal: () => Promise<ExternalVideoClearOutcome["status"]>;
}) {
  let externalCleared = false;
  if (!input.hasNativeAttachment) {
    const preparationStatus = await input.prepareCanonicalExternal();
    if (preparationStatus !== "already_clear") {
      input.onExternalCleared();
      externalCleared = true;
    }
    if (preparationStatus === "reconciled_cleared") {
      return { status: "reconciled_cleared" as const };
    }
  }

  const result = await input.attachNative();
  if (!externalCleared) input.onExternalCleared();
  return { result, status: "attached" as const };
}

export async function reconcileNativeVideoAttachFailure(input: {
  error: unknown;
  refreshNative: () => Promise<void>;
  synchronizeCanonicalExternal: (externalVideoUrl: string) => void;
}) {
  if (input.error instanceof ExternalVideoClearError) {
    if (input.error.canonical) {
      input.synchronizeCanonicalExternal(
        input.error.canonical.lesson.video_url ?? "",
      );
    }
    return "external_preparation_failed" as const;
  }

  await input.refreshNative();
  return "native_reconciled" as const;
}

export function areLessonModalActionsBlocked(input: {
  canManage: boolean;
  lessonMutationBusy: boolean;
  videoMutationBusy: boolean;
}) {
  return (
    !input.canManage ||
    input.lessonMutationBusy ||
    input.videoMutationBusy
  );
}

export function resolveLessonVideoMode(input: {
  hasNativeAttachment: boolean;
  externalVideoUrl: string;
}) {
  if (input.hasNativeAttachment) return "native" as const;
  return input.externalVideoUrl.trim() ? ("external" as const) : ("none" as const);
}

export async function runLessonVideoMutation<T>(input: {
  begin: () => void;
  isCurrent: () => boolean;
  operation: () => Promise<T>;
  release: () => void;
}) {
  input.begin();
  try {
    return await input.operation();
  } finally {
    if (input.isCurrent()) input.release();
  }
}
