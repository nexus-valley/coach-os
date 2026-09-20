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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DeletionContext = {
  params: Promise<{ assetId: string }>;
};

type DatabaseError = {
  code?: string;
  message?: string;
};

type DeletionResult = {
  asset_id?: unknown;
  status?: unknown;
};

type DeletionRequest = {
  actorUserId: string;
  assetId: string;
  tenantId: string;
};

type DeletionOptions = {
  authenticate?: (accessToken: string) => Promise<{ id: string }>;
  requestDeletion?: (
    input: DeletionRequest,
  ) => Promise<{ data: unknown; error: DatabaseError | null }>;
};

function jsonError(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { headers: { "Cache-Control": "private, no-store" }, status },
  );
}

function deletionError(error: DatabaseError) {
  const message = (error.message ?? "").toLowerCase();

  if (error.code === "42501") {
    return jsonError(
      "VIDEO_DELETION_FORBIDDEN",
      "You do not have permission to delete this video.",
      403,
    );
  }

  if (error.code === "02000" || error.code === "PGRST116") {
    return jsonError(
      "VIDEO_ASSET_NOT_FOUND",
      "This video is unavailable.",
      404,
    );
  }

  if (error.code === "22023") {
    if (message.includes("detach this video from lessons")) {
      return jsonError(
        "VIDEO_ATTACHED_TO_LESSON",
        "Remove this video from its lessons before deleting it.",
        409,
      );
    }

    return jsonError(
      "VIDEO_DELETION_STATE_CONFLICT",
      "This video cannot be deleted in its current state.",
      409,
    );
  }

  return jsonError(
    "VIDEO_DELETION_REQUEST_FAILED",
    "Video deletion could not be requested.",
    500,
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

async function requestDeletion(input: DeletionRequest) {
  const admin = getSupabaseAdminClient();
  return admin.rpc("request_native_video_deletion_server", {
    p_actor_user_id: input.actorUserId,
    p_asset_id: input.assetId,
    p_tenant_id: input.tenantId,
  });
}

export async function handleNativeVideoDeletionRequest(
  request: Request,
  context: DeletionContext,
  options: DeletionOptions = {},
) {
  let assetId = "";
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await (options.authenticate ?? requireAuthenticatedUser)(accessToken);
    ({ assetId } = await context.params);

    if (!isUuid(assetId)) {
      return jsonError(
        "VIDEO_INVALID_REQUEST",
        "Video deletion request is invalid.",
        400,
      );
    }
    assetId = assetId.toLowerCase();

    const body = normalizeBody(await parseJsonBody<unknown>(request));
    tenantId = body.tenantId;
    const result = await (options.requestDeletion ?? requestDeletion)({
      actorUserId: user.id,
      assetId,
      tenantId,
    });

    if (result.error) {
      const response = deletionError(result.error);
      if (response.status >= 500) {
        captureServerException(result.error, {
          assetId,
          operation: "native_video_deletion_request",
          route: "/api/video/assets/[assetId]",
          tenantId,
        });
      }
      return response;
    }

    const data = result.data as DeletionResult | null;
    if (data?.asset_id !== assetId || data.status !== "delete_pending") {
      throw new Error("Native video deletion authority returned an invalid response.");
    }

    return Response.json(
      { assetId, status: "delete_pending" },
      {
        headers: { "Cache-Control": "private, no-store" },
        status: 202,
      },
    );
  } catch (error) {
    if (
      error instanceof InvalidJsonPayloadError ||
      (error instanceof SyntaxError && !tenantId)
    ) {
      return jsonError(
        "VIDEO_INVALID_REQUEST",
        "Video deletion request is invalid.",
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

    captureServerException(error, {
      assetId: assetId || undefined,
      operation: "native_video_deletion_route",
      route: "/api/video/assets/[assetId]",
      tenantId,
    });
    return jsonError(
      "VIDEO_DELETION_REQUEST_FAILED",
      "Video deletion could not be requested.",
      500,
    );
  }
}

export async function DELETE(request: Request, context: DeletionContext) {
  return handleNativeVideoDeletionRequest(request, context);
}
