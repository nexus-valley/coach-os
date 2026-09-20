import type { SupabaseClient } from "@supabase/supabase-js";

import { isUuid } from "@/src/lib/server/assignmentAttachmentStorage";

type DatabaseError = {
  code?: string;
  message?: string;
};

type AttachAuthorityResult = {
  attachment_id?: unknown;
  lesson_id?: unknown;
  video_asset_id?: unknown;
};

type DetachAuthorityResult = {
  detached?: unknown;
};

export type NativeVideoLessonAttachmentInput = {
  actorUserId: string;
  assetId: string;
  lessonId: string;
  tenantId: string;
};

export type NativeVideoLessonDetachmentInput = Omit<
  NativeVideoLessonAttachmentInput,
  "assetId"
>;

export type NativeVideoLessonAttachmentResult = {
  lessonId: string;
  status: "attached";
  videoAssetId: string;
};

export type NativeVideoLessonDetachmentResult = {
  lessonId: string;
  status: "detached";
};

export type NativeVideoLessonAttachmentDatabase = {
  attach(
    input: NativeVideoLessonAttachmentInput,
  ): Promise<NativeVideoLessonAttachmentResult>;
  detach(
    input: NativeVideoLessonDetachmentInput,
  ): Promise<NativeVideoLessonDetachmentResult>;
};

export class NativeVideoLessonAttachmentPublicError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "NativeVideoLessonAttachmentPublicError";
    this.code = code;
    this.status = status;
  }
}

function authorityError(operation: "attach" | "detach", error: DatabaseError) {
  const action = operation === "attach" ? "attach" : "remove";
  const message = (error.message ?? "").toLowerCase();

  if (error.code === "42501") {
    return new NativeVideoLessonAttachmentPublicError(
      "VIDEO_LESSON_ATTACHMENT_FORBIDDEN",
      `You do not have permission to ${action} this lesson video.`,
      403,
    );
  }

  if (error.code === "02000" || error.code === "PGRST116") {
    return new NativeVideoLessonAttachmentPublicError(
      "VIDEO_LESSON_ATTACHMENT_NOT_FOUND",
      "This lesson or video is unavailable.",
      404,
    );
  }

  if (error.code === "22023") {
    return new NativeVideoLessonAttachmentPublicError(
      "VIDEO_LESSON_ATTACHMENT_CONFLICT",
      message.includes("external video")
        ? "Remove the external video before attaching a native video."
        : "This video cannot be attached to the lesson in its current state.",
      409,
    );
  }

  return new NativeVideoLessonAttachmentPublicError(
    "VIDEO_LESSON_ATTACHMENT_FAILED",
    "The lesson video could not be updated.",
    500,
  );
}

function invalidAuthorityResult(): never {
  throw new NativeVideoLessonAttachmentPublicError(
    "VIDEO_LESSON_ATTACHMENT_AUTHORITY_INVALID",
    "The lesson video could not be updated.",
    500,
  );
}

function normalizeAttachResult(
  value: unknown,
  expected: Pick<NativeVideoLessonAttachmentInput, "assetId" | "lessonId">,
) {
  const result = value as AttachAuthorityResult | null;
  const attachmentId =
    typeof result?.attachment_id === "string"
      ? result.attachment_id.toLowerCase()
      : "";
  const lessonId =
    typeof result?.lesson_id === "string" ? result.lesson_id.toLowerCase() : "";
  const videoAssetId =
    typeof result?.video_asset_id === "string"
      ? result.video_asset_id.toLowerCase()
      : "";

  if (
    !isUuid(attachmentId) ||
    !isUuid(lessonId) ||
    !isUuid(videoAssetId) ||
    lessonId !== expected.lessonId ||
    videoAssetId !== expected.assetId
  ) {
    invalidAuthorityResult();
  }

  return {
    lessonId,
    status: "attached" as const,
    videoAssetId,
  };
}

function normalizeDetachResult(value: unknown, lessonId: string) {
  const result = value as DetachAuthorityResult | null;

  if (typeof result?.detached !== "boolean") {
    invalidAuthorityResult();
  }

  return {
    lessonId,
    status: "detached" as const,
  };
}

export function createNativeVideoLessonAttachmentDatabase(
  client: SupabaseClient,
): NativeVideoLessonAttachmentDatabase {
  return {
    async attach(input) {
      const { data, error } = await client.rpc(
        "attach_native_video_to_lesson_server",
        {
          p_actor_user_id: input.actorUserId,
          p_asset_id: input.assetId,
          p_lesson_id: input.lessonId,
          p_tenant_id: input.tenantId,
        },
      );

      if (error) {
        throw authorityError("attach", error);
      }

      return normalizeAttachResult(data, input);
    },

    async detach(input) {
      const { data, error } = await client.rpc(
        "detach_native_video_from_lesson_server",
        {
          p_actor_user_id: input.actorUserId,
          p_lesson_id: input.lessonId,
          p_tenant_id: input.tenantId,
        },
      );

      if (error) {
        throw authorityError("detach", error);
      }

      return normalizeDetachResult(data, input.lessonId);
    },
  };
}
