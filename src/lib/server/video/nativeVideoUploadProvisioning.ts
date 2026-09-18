import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CloudflareTusCreateError,
  type CloudflareTusUploadInput,
  type CloudflareTusUploadResult,
} from "@/src/lib/server/video/cloudflareStream";
import { CloudflareStreamConfigurationError } from "@/src/lib/server/video/cloudflareStreamConfig";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const allowedMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/mpeg",
]);

export type NativeVideoUploadRequest = {
  declaredMimeType: string;
  declaredSizeBytes: number;
  expectedDurationSeconds: number;
  filename: string;
  requestId: string;
  tenantId: string;
};

export type NativeVideoUploadRouteResult = {
  body: Record<string, unknown>;
  status: number;
};

type RpcError = {
  code?: string;
  message?: string;
};

type Reservation = {
  assetId: string;
  replayed: boolean;
  reservationExpiresAt: string;
  reservedSeconds: number;
};

type ProvisioningClaim =
  | {
      action: "create_provider_upload";
      assetId: string;
      claimToken: string;
      creatorCorrelation: string;
      reservationExpiresAt: string;
      reservedSeconds: number;
    }
  | {
      action: "replay_existing";
      assetId: string;
      expiresAt: string;
      reservedSeconds: number;
      uploadUrl: string;
    }
  | { action: "wait"; assetId: string }
  | { action: "reconcile_required"; assetId: string }
  | { action: "closed"; assetId: string };

export interface NativeVideoUploadDatabase {
  claim(assetId: string): Promise<ProvisioningClaim>;
  complete(input: {
    assetId: string;
    claimToken: string;
    providerAssetId: string;
    providerUploadExpiresAt: string;
    uploadUrl: string;
  }): Promise<{
    assetId: string;
    expiresAt: string;
    replayed: boolean;
    reservedSeconds: number;
    status: string;
    uploadUrl: string;
  }>;
  fail(input: {
    assetId: string;
    claimToken: string;
    safeFailureCode: string;
  }): Promise<void>;
  markAmbiguous(input: {
    assetId: string;
    claimToken: string;
    safeFailureCode: string;
  }): Promise<void>;
  reserve(
    request: NativeVideoUploadRequest & { actorUserId: string },
  ): Promise<Reservation>;
}

export class NativeVideoUploadPublicError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "NativeVideoUploadPublicError";
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new NativeVideoUploadPublicError(
      "VIDEO_UPLOAD_CREATION_FAILED",
      "Video upload preparation failed.",
      500,
    );
  }
  return value.trim();
}

function requiredPositiveInteger(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new NativeVideoUploadPublicError(
      "VIDEO_UPLOAD_CREATION_FAILED",
      "Video upload preparation failed.",
      500,
    );
  }
  return Number(value);
}

export function normalizeNativeVideoUploadRequest(
  body: Record<string, unknown>,
): NativeVideoUploadRequest {
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const requestId =
    typeof body.requestId === "string" ? body.requestId.trim() : "";
  const declaredMimeType =
    typeof body.declaredMimeType === "string"
      ? body.declaredMimeType.trim().toLowerCase()
      : "";
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const expectedDurationSeconds = body.expectedDurationSeconds;
  const declaredSizeBytes = body.declaredSizeBytes;

  if (
    !uuidPattern.test(tenantId) ||
    !uuidPattern.test(requestId) ||
    !Number.isSafeInteger(expectedDurationSeconds) ||
    Number(expectedDurationSeconds) < 1 ||
    Number(expectedDurationSeconds) > 7200 ||
    !Number.isSafeInteger(declaredSizeBytes) ||
    Number(declaredSizeBytes) < 1 ||
    Number(declaredSizeBytes) > 10_737_418_240 ||
    !allowedMimeTypes.has(declaredMimeType) ||
    filename.length < 1 ||
    filename.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw new NativeVideoUploadPublicError(
      "VIDEO_INVALID_REQUEST",
      "Video upload details are invalid.",
      400,
    );
  }

  return {
    declaredMimeType,
    declaredSizeBytes: Number(declaredSizeBytes),
    expectedDurationSeconds: Number(expectedDurationSeconds),
    filename,
    requestId,
    tenantId,
  };
}

export function assertNativeVideoUploadRole(role: unknown) {
  if (role !== "owner" && role !== "admin") {
    throw new NativeVideoUploadPublicError(
      "VIDEO_UPLOAD_FORBIDDEN",
      "Only workspace owners and admins can upload videos.",
      403,
    );
  }
}

function mapRpcError(error: RpcError) {
  const message = error.message?.toLowerCase() ?? "";

  if (message.includes("storage capacity is full")) {
    return new NativeVideoUploadPublicError(
      "VIDEO_CAPACITY_FULL",
      "Video storage capacity is full.",
      409,
    );
  }

  if (
    /subscription|lifecycle|operational|feature|entitlement|owner|admin|membership/.test(
      message,
    )
  ) {
    return new NativeVideoUploadPublicError(
      "VIDEO_UPLOAD_FORBIDDEN",
      "Video uploads are not available for this workspace.",
      403,
    );
  }

  if (error.code === "22023" || error.code === "23505") {
    return new NativeVideoUploadPublicError(
      "VIDEO_INVALID_REQUEST",
      "Video upload details are invalid.",
      error.code === "23505" ? 409 : 400,
    );
  }

  if (error.code === "42501" || error.code === "55000") {
    return new NativeVideoUploadPublicError(
      "VIDEO_UPLOAD_FORBIDDEN",
      "Video uploads are not available for this workspace.",
      403,
    );
  }

  return new NativeVideoUploadPublicError(
    "VIDEO_UPLOAD_CREATION_FAILED",
    "Video upload preparation failed.",
    500,
  );
}

async function rpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
) {
  const result = await client.rpc(name, parameters);
  if (result.error) {
    throw mapRpcError(result.error);
  }
  return result.data;
}

export function createNativeVideoUploadDatabase(
  client: SupabaseClient,
): NativeVideoUploadDatabase {
  return {
    async reserve(request) {
      const data = asRecord(
        await rpc(client, "reserve_native_video_upload_server", {
          p_actor_user_id: request.actorUserId,
          p_declared_mime_type: request.declaredMimeType,
          p_declared_size_bytes: request.declaredSizeBytes,
          p_expected_duration_seconds: request.expectedDurationSeconds,
          p_request_id: request.requestId,
          p_safe_filename: request.filename,
          p_tenant_id: request.tenantId,
        }),
      );
      if (!data) throw mapRpcError({});
      return {
        assetId: requiredString(data, "asset_id"),
        replayed: data.replayed === true,
        reservationExpiresAt: requiredString(data, "reservation_expires_at"),
        reservedSeconds: requiredPositiveInteger(data, "reserved_seconds"),
      };
    },
    async claim(assetId) {
      const data = asRecord(
        await rpc(client, "claim_native_video_upload_provisioning_server", {
          p_asset_id: assetId,
        }),
      );
      if (!data) throw mapRpcError({});
      const action = requiredString(data, "action");
      const claimedAssetId = requiredString(data, "asset_id");

      if (action === "create_provider_upload") {
        return {
          action,
          assetId: claimedAssetId,
          claimToken: requiredString(data, "claim_token"),
          creatorCorrelation: requiredString(data, "creator_correlation"),
          reservationExpiresAt: requiredString(data, "reservation_expires_at"),
          reservedSeconds: requiredPositiveInteger(data, "reserved_seconds"),
        };
      }
      if (action === "replay_existing") {
        return {
          action,
          assetId: claimedAssetId,
          expiresAt: requiredString(data, "provider_upload_expires_at"),
          reservedSeconds: requiredPositiveInteger(data, "reserved_seconds"),
          uploadUrl: requiredString(data, "upload_url"),
        };
      }
      if (action === "wait" || action === "reconcile_required" || action === "closed") {
        return { action, assetId: claimedAssetId };
      }
      throw mapRpcError({});
    },
    async complete(input) {
      const data = asRecord(
        await rpc(client, "complete_native_video_upload_provisioning_server", {
          p_asset_id: input.assetId,
          p_claim_token: input.claimToken,
          p_provider_asset_id: input.providerAssetId,
          p_provider_upload_expires_at: input.providerUploadExpiresAt,
          p_upload_url: input.uploadUrl,
        }),
      );
      if (!data) throw mapRpcError({});
      return {
        assetId: requiredString(data, "asset_id"),
        expiresAt: requiredString(data, "provider_upload_expires_at"),
        replayed: data.replayed === true,
        reservedSeconds: requiredPositiveInteger(data, "reserved_seconds"),
        status: requiredString(data, "status"),
        uploadUrl: requiredString(data, "upload_url"),
      };
    },
    async markAmbiguous(input) {
      await rpc(client, "mark_native_video_upload_provisioning_ambiguous_server", {
        p_asset_id: input.assetId,
        p_claim_token: input.claimToken,
        p_safe_failure_code: input.safeFailureCode,
      });
    },
    async fail(input) {
      await rpc(client, "fail_unbound_native_video_upload_server", {
        p_asset_id: input.assetId,
        p_claim_token: input.claimToken,
        p_safe_failure_code: input.safeFailureCode,
      });
    },
  };
}

function pending(assetId: string, code: string, message: string) {
  return { body: { assetId, code, message, status: "pending" }, status: 202 };
}

async function bestEffortMarkAmbiguous(
  database: NativeVideoUploadDatabase,
  claim: Extract<ProvisioningClaim, { action: "create_provider_upload" }>,
  safeFailureCode: string,
  onOperationalError: (error: unknown, stage: string, assetId: string) => void,
) {
  try {
    await database.markAmbiguous({
      assetId: claim.assetId,
      claimToken: claim.claimToken,
      safeFailureCode,
    });
  } catch (error) {
    onOperationalError(error, "mark_ambiguous", claim.assetId);
  }
}

export async function provisionNativeVideoUpload(params: {
  actorUserId: string;
  database: NativeVideoUploadDatabase;
  onOperationalError?: (error: unknown, stage: string, assetId: string) => void;
  prepareProviderUpload: () => (
    input: CloudflareTusUploadInput,
  ) => Promise<CloudflareTusUploadResult>;
  request: NativeVideoUploadRequest;
}): Promise<NativeVideoUploadRouteResult> {
  const onOperationalError = params.onOperationalError ?? (() => undefined);
  let createProviderUpload: (
    input: CloudflareTusUploadInput,
  ) => Promise<CloudflareTusUploadResult>;

  try {
    createProviderUpload = params.prepareProviderUpload();
  } catch (error) {
    if (error instanceof CloudflareStreamConfigurationError) {
      throw new NativeVideoUploadPublicError(
        "VIDEO_NOT_CONFIGURED",
        "Video uploads are temporarily unavailable.",
        503,
      );
    }
    throw error;
  }

  const reservation = await params.database.reserve({
    ...params.request,
    actorUserId: params.actorUserId,
  });
  const claim = await params.database.claim(reservation.assetId);

  if (claim.action === "replay_existing") {
    return {
      body: {
        assetId: claim.assetId,
        expiresAt: claim.expiresAt,
        replayed: true,
        reservedSeconds: claim.reservedSeconds,
        uploadUrl: claim.uploadUrl,
      },
      status: 200,
    };
  }
  if (claim.action === "wait") {
    return pending(
      claim.assetId,
      "VIDEO_UPLOAD_PENDING",
      "Video upload preparation is already in progress.",
    );
  }
  if (claim.action === "reconcile_required") {
    return pending(
      claim.assetId,
      "VIDEO_RECONCILIATION_REQUIRED",
      "Video upload preparation is being recovered.",
    );
  }
  if (claim.action === "closed") {
    throw new NativeVideoUploadPublicError(
      "VIDEO_UPLOAD_CREATION_FAILED",
      "This video upload session is no longer available.",
      409,
    );
  }

  let providerUpload: CloudflareTusUploadResult;
  try {
    providerUpload = await createProviderUpload({
      creatorCorrelation: claim.creatorCorrelation,
      declaredSizeBytes: params.request.declaredSizeBytes,
      reservationExpiresAt: claim.reservationExpiresAt,
      reservedSeconds: claim.reservedSeconds,
    });
  } catch (error) {
    if (error instanceof CloudflareStreamConfigurationError) {
      try {
        await params.database.fail({
          assetId: claim.assetId,
          claimToken: claim.claimToken,
          safeFailureCode: "provider_not_configured",
        });
      } catch (failureError) {
        onOperationalError(
          failureError,
          "close_unconfigured_claim",
          claim.assetId,
        );
      }
      throw new NativeVideoUploadPublicError(
        "VIDEO_NOT_CONFIGURED",
        "Video uploads are temporarily unavailable.",
        503,
      );
    }

    if (error instanceof CloudflareTusCreateError) {
      onOperationalError(error, "provider_create", claim.assetId);
    }

    if (
      error instanceof CloudflareTusCreateError &&
      error.outcome === "definite_failure"
    ) {
      try {
        await params.database.fail({
          assetId: claim.assetId,
          claimToken: claim.claimToken,
          safeFailureCode: error.safeCode,
        });
      } catch (failureError) {
        onOperationalError(
          failureError,
          "close_rejected_provider_create",
          claim.assetId,
        );
      }
      throw new NativeVideoUploadPublicError(
        "VIDEO_UPLOAD_CREATION_FAILED",
        "Video upload creation was rejected. Please try again later.",
        503,
      );
    }

    const safeFailureCode =
      error instanceof CloudflareTusCreateError
        ? error.safeCode
        : "provider_creation_outcome_unknown";
    await bestEffortMarkAmbiguous(
      params.database,
      claim,
      safeFailureCode,
      onOperationalError,
    );
    return pending(
      claim.assetId,
      "VIDEO_RECONCILIATION_REQUIRED",
      "Video upload preparation is being verified.",
    );
  }

  try {
    const completed = await params.database.complete({
      assetId: claim.assetId,
      claimToken: claim.claimToken,
      providerAssetId: providerUpload.providerAssetId,
      providerUploadExpiresAt: providerUpload.providerUploadExpiresAt,
      uploadUrl: providerUpload.uploadUrl,
    });

    if (completed.status !== "upload_pending") {
      throw new Error("Video upload provisioning returned an invalid status.");
    }

    return {
      body: {
        assetId: completed.assetId,
        expiresAt: completed.expiresAt,
        replayed: completed.replayed,
        reservedSeconds: completed.reservedSeconds,
        uploadUrl: completed.uploadUrl,
      },
      status: 200,
    };
  } catch (error) {
    onOperationalError(error, "complete_provider_upload", claim.assetId);
    await bestEffortMarkAmbiguous(
      params.database,
      claim,
      "provider_creation_outcome_unknown",
      onOperationalError,
    );
    return pending(
      claim.assetId,
      "VIDEO_RECONCILIATION_REQUIRED",
      "Video upload preparation is being verified.",
    );
  }
}
