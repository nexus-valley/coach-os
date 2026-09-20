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
  createNativeVideoLessonAttachmentDatabase,
  type NativeVideoLessonAttachmentDatabase,
  NativeVideoLessonAttachmentPublicError,
} from "@/src/lib/server/video/nativeVideoLessonAttachment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type NativeVideoLessonContext = {
  params: Promise<{ lessonId: string }>;
};

type NativeVideoLessonRouteOptions = {
  authenticate?: (accessToken: string) => Promise<{ id: string }>;
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
  ) => void;
  database?: NativeVideoLessonAttachmentDatabase;
};

function jsonError(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { headers: { "Cache-Control": "private, no-store" }, status },
  );
}

function normalizePutBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidJsonPayloadError();
  }

  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 2 ||
    typeof body.tenantId !== "string" ||
    typeof body.assetId !== "string" ||
    !isUuid(body.tenantId) ||
    !isUuid(body.assetId)
  ) {
    throw new InvalidJsonPayloadError();
  }

  return {
    assetId: body.assetId.toLowerCase(),
    tenantId: body.tenantId.toLowerCase(),
  };
}

function normalizeDeleteBody(value: unknown) {
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

function routeError(error: unknown) {
  if (error instanceof InvalidJsonPayloadError) {
    return jsonError(
      "VIDEO_LESSON_ATTACHMENT_INVALID_REQUEST",
      "Lesson video details are invalid.",
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

  if (error instanceof NativeVideoLessonAttachmentPublicError) {
    return jsonError(error.code, error.message, error.status);
  }

  return jsonError(
    "VIDEO_LESSON_ATTACHMENT_FAILED",
    "The lesson video could not be updated.",
    500,
  );
}

function database(options: NativeVideoLessonRouteOptions) {
  return (
    options.database ??
    createNativeVideoLessonAttachmentDatabase(getSupabaseAdminClient())
  );
}

function captureRouteFailure(
  error: unknown,
  response: Response,
  context: Record<string, unknown>,
  options: NativeVideoLessonRouteOptions,
) {
  if (response.status < 500) {
    return;
  }

  const safeError =
    error instanceof NativeVideoLessonAttachmentPublicError
      ? new Error(error.code)
      : new Error("VIDEO_LESSON_ATTACHMENT_UNEXPECTED");

  (options.captureException ?? captureServerException)(safeError, context);
}

export async function handleNativeVideoLessonAttachmentPut(
  request: Request,
  context: NativeVideoLessonContext,
  options: NativeVideoLessonRouteOptions = {},
) {
  let lessonId = "";
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await (options.authenticate ?? requireAuthenticatedUser)(accessToken);
    ({ lessonId } = await context.params);

    if (!isUuid(lessonId)) {
      throw new InvalidJsonPayloadError();
    }
    lessonId = lessonId.toLowerCase();

    const body = normalizePutBody(await parseJsonBody<unknown>(request));
    tenantId = body.tenantId;
    const result = await database(options).attach({
      actorUserId: user.id,
      assetId: body.assetId,
      lessonId,
      tenantId,
    });

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
      status: 200,
    });
  } catch (error) {
    const response = routeError(error);
    captureRouteFailure(
      error,
      response,
      {
        lessonId: lessonId || undefined,
        operation: "native_video_lesson_attachment_put",
        route: "/api/video/lessons/[lessonId]/native-video",
        tenantId,
      },
      options,
    );
    return response;
  }
}

export async function handleNativeVideoLessonAttachmentDelete(
  request: Request,
  context: NativeVideoLessonContext,
  options: NativeVideoLessonRouteOptions = {},
) {
  let lessonId = "";
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await (options.authenticate ?? requireAuthenticatedUser)(accessToken);
    ({ lessonId } = await context.params);

    if (!isUuid(lessonId)) {
      throw new InvalidJsonPayloadError();
    }
    lessonId = lessonId.toLowerCase();

    const body = normalizeDeleteBody(await parseJsonBody<unknown>(request));
    tenantId = body.tenantId;
    const result = await database(options).detach({
      actorUserId: user.id,
      lessonId,
      tenantId,
    });

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
      status: 200,
    });
  } catch (error) {
    const response = routeError(error);
    captureRouteFailure(
      error,
      response,
      {
        lessonId: lessonId || undefined,
        operation: "native_video_lesson_attachment_delete",
        route: "/api/video/lessons/[lessonId]/native-video",
        tenantId,
      },
      options,
    );
    return response;
  }
}

export async function PUT(request: Request, context: NativeVideoLessonContext) {
  return handleNativeVideoLessonAttachmentPut(request, context);
}

export async function DELETE(request: Request, context: NativeVideoLessonContext) {
  return handleNativeVideoLessonAttachmentDelete(request, context);
}
