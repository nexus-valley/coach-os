import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import {
  createNativeVideoManagementDatabase,
  type NativeVideoCapacity,
  NativeVideoManagementPublicError,
  parseNativeVideoTenantRequest,
} from "@/src/lib/server/video/nativeVideoManagement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CapacityOptions = {
  authenticate?: (accessToken: string) => Promise<{ id: string }>;
  getCapacity?: (input: {
    actorUserId: string;
    tenantId: string;
  }) => Promise<NativeVideoCapacity>;
};

function jsonError(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { headers: { "Cache-Control": "private, no-store" }, status },
  );
}

async function getCapacity(input: {
  actorUserId: string;
  tenantId: string;
}) {
  return createNativeVideoManagementDatabase(
    getSupabaseAdminClient(),
  ).getCapacity(input);
}

export async function handleNativeVideoCapacityRequest(
  request: Request,
  options: CapacityOptions = {},
) {
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await (options.authenticate ?? requireAuthenticatedUser)(accessToken);
    ({ tenantId } = parseNativeVideoTenantRequest(request));
    const capacity = await (options.getCapacity ?? getCapacity)({
      actorUserId: user.id,
      tenantId,
    });

    return Response.json(
      { capacity },
      {
        headers: { "Cache-Control": "private, no-store" },
        status: 200,
      },
    );
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
          operation: "native_video_management_capacity",
          route: "/api/video/capacity",
          tenantId,
        });
      }
      return jsonError(error.code, error.message, error.status);
    }

    captureServerException(new Error("VIDEO_CAPACITY_UNEXPECTED"), {
      operation: "native_video_management_capacity",
      route: "/api/video/capacity",
      tenantId,
    });
    return jsonError(
      "VIDEO_CAPACITY_UNAVAILABLE",
      "Video capacity information is temporarily unavailable.",
      500,
    );
  }
}

export async function GET(request: Request) {
  return handleNativeVideoCapacityRequest(request);
}
