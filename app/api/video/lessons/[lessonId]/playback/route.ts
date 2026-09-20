import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { isUuid } from "@/src/lib/server/assignmentAttachmentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import {
  createNativeVideoPlayback,
  createNativeVideoPlaybackDatabase,
  type NativeVideoPlaybackDescriptor,
  NativeVideoPlaybackPublicError,
} from "@/src/lib/server/video/nativeVideoPlayback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PlaybackContext = {
  params: Promise<{ lessonId: string }>;
};

type PlaybackOptions = {
  authenticate?: (accessToken: string) => Promise<{ id: string }>;
  createPlayback?: (input: {
    actorUserId: string;
    lessonId: string;
    tenantId: string;
  }) => Promise<NativeVideoPlaybackDescriptor>;
};

function jsonError(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { headers: { "Cache-Control": "private, no-store" }, status },
  );
}

function normalizeBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidJsonPayloadError();
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 1 ||
    typeof body.tenantId !== "string" ||
    !isUuid(body.tenantId)
  ) {
    throw new InvalidJsonPayloadError();
  }
  return { tenantId: body.tenantId.toLowerCase() };
}

async function createPlayback(input: {
  actorUserId: string;
  lessonId: string;
  tenantId: string;
}) {
  return createNativeVideoPlayback({
    database: createNativeVideoPlaybackDatabase(getSupabaseAdminClient()),
    request: input,
  });
}

export async function handleNativeVideoPlaybackRequest(
  request: Request,
  context: PlaybackContext,
  options: PlaybackOptions = {},
) {
  let lessonId = "";
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await (options.authenticate ?? requireAuthenticatedUser)(accessToken);
    ({ lessonId } = await context.params);
    if (!isUuid(lessonId)) {
      return jsonError(
        "VIDEO_INVALID_REQUEST",
        "Video playback request is invalid.",
        400,
      );
    }
    lessonId = lessonId.toLowerCase();

    const body = normalizeBody(await parseJsonBody<unknown>(request));
    tenantId = body.tenantId;
    const result = await (options.createPlayback ?? createPlayback)({
      actorUserId: user.id,
      lessonId,
      tenantId,
    });

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
      status: 200,
    });
  } catch (error) {
    if (error instanceof InvalidJsonPayloadError) {
      return jsonError(
        "VIDEO_INVALID_REQUEST",
        "Video playback request is invalid.",
        400,
      );
    }
    if (error instanceof Error && error.message === "Authentication required.") {
      return jsonError(
        "VIDEO_AUTHENTICATION_REQUIRED",
        "Authentication required.",
        401,
      );
    }
    if (error instanceof NativeVideoPlaybackPublicError) {
      if (error.status >= 500) {
        captureServerException(new Error(error.code), {
          lessonId: lessonId || undefined,
          operation: "native_video_playback",
          route: "/api/video/lessons/[lessonId]/playback",
          tenantId,
        });
      }
      return jsonError(error.code, error.message, error.status);
    }

    captureServerException(new Error("VIDEO_PLAYBACK_UNEXPECTED"), {
      lessonId: lessonId || undefined,
      operation: "native_video_playback",
      route: "/api/video/lessons/[lessonId]/playback",
      tenantId,
    });
    return jsonError(
      "VIDEO_PLAYBACK_FAILED",
      "Video playback is temporarily unavailable.",
      500,
    );
  }
}

export async function POST(request: Request, context: PlaybackContext) {
  return handleNativeVideoPlaybackRequest(request, context);
}
