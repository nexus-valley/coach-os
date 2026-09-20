import type { SupabaseClient } from "@supabase/supabase-js";

import { isUuid } from "@/src/lib/server/assignmentAttachmentStorage";
import {
  type CloudflareStreamPlaybackAdapter,
  CloudflareStreamProviderError,
  createCloudflareStreamPlaybackAdapter,
} from "@/src/lib/server/video/cloudflareStream";
import {
  CloudflareStreamPlaybackConfigurationError,
  getCloudflareStreamPlaybackConfig,
} from "@/src/lib/server/video/cloudflareStreamConfig";

export const nativeVideoPlaybackMinimumTtlSeconds = 1_800;
export const nativeVideoPlaybackBufferSeconds = 900;
export const nativeVideoPlaybackMaximumTtlSeconds = 8_100;

type DatabaseError = {
  code?: string;
  message?: string;
};

type PlaybackAuthority = {
  durationSeconds: number;
  lessonId: string;
  providerAssetId: string;
  videoAssetId: string;
};

export type NativeVideoPlaybackDatabase = {
  authorize(input: {
    actorUserId: string;
    lessonId: string;
    tenantId: string;
  }): Promise<PlaybackAuthority>;
};

export type NativeVideoPlaybackRequest = {
  actorUserId: string;
  lessonId: string;
  tenantId: string;
};

export type NativeVideoPlaybackDescriptor = {
  durationSeconds: number;
  lessonId: string;
  playback: {
    expiresAt: string;
    kind: "native_video";
    mode: "iframe";
    url: string;
  };
};

export class NativeVideoPlaybackPublicError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "NativeVideoPlaybackPublicError";
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validProviderIdentifier(value: unknown) {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 255 &&
    !/[\s\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function invalidAuthorityResponse(): never {
  throw new NativeVideoPlaybackPublicError(
    "VIDEO_PLAYBACK_AUTHORITY_INVALID",
    "Video playback could not be authorized.",
    500,
  );
}

function normalizeAuthorityResponse(
  value: unknown,
  expectedLessonId: string,
): PlaybackAuthority {
  const row = asRecord(value);
  const lessonId = typeof row?.lesson_id === "string" ? row.lesson_id : "";
  const videoAssetId =
    typeof row?.video_asset_id === "string" ? row.video_asset_id : "";
  const durationSeconds = row?.duration_seconds;
  const providerAssetId = validProviderIdentifier(row?.provider_asset_id);

  if (
    !row ||
    lessonId !== expectedLessonId ||
    !isUuid(lessonId) ||
    !isUuid(videoAssetId) ||
    row.provider !== "cloudflare_stream" ||
    !providerAssetId ||
    !Number.isSafeInteger(durationSeconds) ||
    Number(durationSeconds) < 1 ||
    Number(durationSeconds) > 7_200
  ) {
    return invalidAuthorityResponse();
  }

  return {
    durationSeconds: Number(durationSeconds),
    lessonId,
    providerAssetId,
    videoAssetId,
  };
}

function mapAuthorizationError(error: DatabaseError) {
  if (error.code === "28000") {
    return new NativeVideoPlaybackPublicError(
      "VIDEO_AUTHENTICATION_REQUIRED",
      "Authentication required.",
      401,
    );
  }
  if (error.code === "22023") {
    return new NativeVideoPlaybackPublicError(
      "VIDEO_INVALID_REQUEST",
      "Video playback request is invalid.",
      400,
    );
  }
  if (error.code === "42501") {
    return new NativeVideoPlaybackPublicError(
      "VIDEO_PLAYBACK_FORBIDDEN",
      "Video playback is not available for this lesson.",
      403,
    );
  }
  if (error.code === "P0002" || error.code === "02000") {
    return new NativeVideoPlaybackPublicError(
      "VIDEO_PLAYBACK_NOT_FOUND",
      "This lesson video is unavailable.",
      404,
    );
  }
  if (error.code === "55000") {
    return new NativeVideoPlaybackPublicError(
      "VIDEO_PLAYBACK_NOT_READY",
      "This lesson video is not ready for playback.",
      409,
    );
  }
  return new NativeVideoPlaybackPublicError(
    "VIDEO_PLAYBACK_AUTHORITY_FAILED",
    "Video playback could not be authorized.",
    500,
  );
}

export function createNativeVideoPlaybackDatabase(
  client: SupabaseClient,
): NativeVideoPlaybackDatabase {
  return {
    async authorize(input) {
      const result = await client.rpc("authorize_native_video_playback_server", {
        p_actor_user_id: input.actorUserId,
        p_lesson_id: input.lessonId,
        p_tenant_id: input.tenantId,
      });
      if (result.error) throw mapAuthorizationError(result.error);
      return normalizeAuthorityResponse(result.data, input.lessonId);
    },
  };
}

export function nativeVideoPlaybackTtlSeconds(durationSeconds: number) {
  return Math.min(
    nativeVideoPlaybackMaximumTtlSeconds,
    Math.max(
      nativeVideoPlaybackMinimumTtlSeconds,
      durationSeconds + nativeVideoPlaybackBufferSeconds,
    ),
  );
}

function providerError(error: unknown): NativeVideoPlaybackPublicError {
  if (error instanceof CloudflareStreamPlaybackConfigurationError) {
    return new NativeVideoPlaybackPublicError(
      "VIDEO_PLAYBACK_NOT_CONFIGURED",
      "Video playback is temporarily unavailable.",
      503,
    );
  }
  if (error instanceof CloudflareStreamProviderError) {
    if (error.kind === "invalid_response") {
      return new NativeVideoPlaybackPublicError(
        "VIDEO_PROVIDER_RESPONSE_INVALID",
        "Video playback is temporarily unavailable.",
        502,
      );
    }
    if (error.kind === "not_found") {
      return new NativeVideoPlaybackPublicError(
        "VIDEO_PLAYBACK_NOT_READY",
        "This lesson video is not ready for playback.",
        409,
      );
    }
    return new NativeVideoPlaybackPublicError(
      "VIDEO_PROVIDER_UNAVAILABLE",
      "Video playback is temporarily unavailable.",
      503,
    );
  }
  return new NativeVideoPlaybackPublicError(
    "VIDEO_PLAYBACK_FAILED",
    "Video playback is temporarily unavailable.",
    500,
  );
}

export async function createNativeVideoPlayback(params: {
  database: NativeVideoPlaybackDatabase;
  nowEpochSeconds?: () => number;
  prepareProvider?: () => CloudflareStreamPlaybackAdapter;
  request: NativeVideoPlaybackRequest;
}): Promise<NativeVideoPlaybackDescriptor> {
  const authority = await params.database.authorize(params.request);

  let provider: CloudflareStreamPlaybackAdapter;
  try {
    provider =
      params.prepareProvider?.() ??
      createCloudflareStreamPlaybackAdapter(
        getCloudflareStreamPlaybackConfig(),
      );
  } catch (error) {
    throw providerError(error);
  }

  try {
    const providerVideo = await provider.getVideo(authority.providerAssetId);
    if (
      providerVideo.providerAssetId !== authority.providerAssetId ||
      providerVideo.state !== "ready" ||
      providerVideo.readyToStream !== true ||
      providerVideo.requireSignedURLs !== true ||
      providerVideo.creatorCorrelation !== authority.videoAssetId
    ) {
      throw new NativeVideoPlaybackPublicError(
        "VIDEO_PLAYBACK_NOT_READY",
        "This lesson video is not ready for playback.",
        409,
      );
    }

    const nowEpochSeconds = Math.floor(
      params.nowEpochSeconds?.() ?? Date.now() / 1_000,
    );
    if (!Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds <= 0) {
      return invalidAuthorityResponse();
    }
    const expiresAtEpochSeconds =
      nowEpochSeconds + nativeVideoPlaybackTtlSeconds(authority.durationSeconds);
    const token = await provider.createSignedPlaybackToken(
      authority.providerAssetId,
      expiresAtEpochSeconds,
    );

    return {
      durationSeconds: authority.durationSeconds,
      lessonId: authority.lessonId,
      playback: {
        expiresAt: new Date(expiresAtEpochSeconds * 1_000).toISOString(),
        kind: "native_video",
        mode: "iframe",
        url: provider.getIframeUrl(token),
      },
    };
  } catch (error) {
    if (error instanceof NativeVideoPlaybackPublicError) throw error;
    throw providerError(error);
  }
}
