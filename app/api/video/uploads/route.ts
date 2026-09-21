import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import {
  createCloudflareTusUpload,
  updateCloudflareStreamAllowedOrigins,
} from "@/src/lib/server/video/cloudflareStream";
import {
  getCloudflareStreamAllowedOriginsConfig,
  getCloudflareStreamUploadConfig,
} from "@/src/lib/server/video/cloudflareStreamConfig";
import {
  assertNativeVideoUploadRole,
  createNativeVideoUploadDatabase,
  NativeVideoUploadPublicError,
  normalizeNativeVideoUploadRequest,
  provisionNativeVideoUpload,
} from "@/src/lib/server/video/nativeVideoUploadProvisioning";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof InvalidJsonPayloadError) {
    return Response.json(
      { code: "VIDEO_INVALID_REQUEST", error: "Video upload details are invalid." },
      { status: 400 },
    );
  }

  if (error instanceof NativeVideoUploadPublicError) {
    return Response.json(
      { code: error.code, error: error.message },
      { status: error.status },
    );
  }

  if (error instanceof Error && error.message === "Authentication required.") {
    return Response.json(
      { code: "VIDEO_AUTHENTICATION_REQUIRED", error: "Authentication required." },
      { status: 401 },
    );
  }

  return Response.json(
    { code: "VIDEO_UPLOAD_CREATION_FAILED", error: "Video upload preparation failed." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  let tenantId: string | null = null;
  let assetId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    const body = normalizeNativeVideoUploadRequest(
      await parseJsonBody<Record<string, unknown>>(request),
    );
    tenantId = body.tenantId;

    const admin = getSupabaseAdminClient();
    const membership = await admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", body.tenantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership.error) {
      throw new NativeVideoUploadPublicError(
        "VIDEO_UPLOAD_FORBIDDEN",
        "Video uploads are not available for this workspace.",
        403,
      );
    }
    assertNativeVideoUploadRole(membership.data?.role);

    const result = await provisionNativeVideoUpload({
      actorUserId: user.id,
      database: createNativeVideoUploadDatabase(admin),
      onOperationalError(error, stage, operationalAssetId) {
        captureServerException(error, {
          assetId: operationalAssetId,
          operation: "native_video_upload_provisioning",
          route: "/api/video/uploads",
          stage,
          tenantId,
        });
      },
      prepareProviderUpload() {
        const config = getCloudflareStreamUploadConfig();
        return async (input) => {
          const { allowedOrigins, allowLocalhost } =
            getCloudflareStreamAllowedOriginsConfig();
          const providerUpload = await createCloudflareTusUpload(config, input);
          await updateCloudflareStreamAllowedOrigins(
            config,
            {
              allowedOrigins,
              creatorCorrelation: input.creatorCorrelation,
              providerAssetId: providerUpload.providerAssetId,
            },
            { allowLocalhost },
          );
          return providerUpload;
        };
      },
      request: body,
    });

    if (typeof result.body.assetId === "string") {
      assetId = result.body.assetId;
    }
    return Response.json(result.body, {
      headers: { "Cache-Control": "private, no-store" },
      status: result.status,
    });
  } catch (error) {
    const response = errorResponse(error);
    if (response.status >= 500) {
      captureServerException(error, {
        assetId,
        operation: "native_video_upload_route",
        route: "/api/video/uploads",
        tenantId,
      });
    }
    return response;
  }
}
