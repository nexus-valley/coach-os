import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import {
  createNativeVideoManagementDatabase,
  type NativeVideoManagementPage,
  NativeVideoManagementPublicError,
  parseNativeVideoListRequest,
} from "@/src/lib/server/video/nativeVideoManagement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InventoryOptions = {
  authenticate?: (accessToken: string) => Promise<{ id: string }>;
  listAssets?: (input: {
    actorUserId: string;
    cursor: { assetId: string; createdAt: string } | null;
    limit: number;
    tenantId: string;
  }) => Promise<NativeVideoManagementPage>;
};

function jsonError(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { headers: { "Cache-Control": "private, no-store" }, status },
  );
}

async function listAssets(input: {
  actorUserId: string;
  cursor: { assetId: string; createdAt: string } | null;
  limit: number;
  tenantId: string;
}) {
  return createNativeVideoManagementDatabase(
    getSupabaseAdminClient(),
  ).listAssets(input);
}

export async function handleNativeVideoInventoryRequest(
  request: Request,
  options: InventoryOptions = {},
) {
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await (options.authenticate ?? requireAuthenticatedUser)(accessToken);
    const input = parseNativeVideoListRequest(request);
    tenantId = input.tenantId;
    const result = await (options.listAssets ?? listAssets)({
      ...input,
      actorUserId: user.id,
    });

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
      status: 200,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Authentication required.") {
      return jsonError(
        "VIDEO_AUTHENTICATION_REQUIRED",
        "Authentication required.",
        401,
      );
    }
    if (error instanceof NativeVideoManagementPublicError) {
      if (error.status >= 500) {
        captureServerException(new Error(error.code), {
          operation: "native_video_management_inventory",
          route: "/api/video/assets",
          tenantId,
        });
      }
      return jsonError(error.code, error.message, error.status);
    }

    captureServerException(new Error("VIDEO_MANAGEMENT_UNEXPECTED"), {
      operation: "native_video_management_inventory",
      route: "/api/video/assets",
      tenantId,
    });
    return jsonError(
      "VIDEO_MANAGEMENT_UNAVAILABLE",
      "Video management information is temporarily unavailable.",
      500,
    );
  }
}

export async function GET(request: Request) {
  return handleNativeVideoInventoryRequest(request);
}
