import {
  type CloudflareStreamUploadConfig,
} from "@/src/lib/server/video/cloudflareStreamConfig";

export const cloudflareTusTimeoutMs = 15_000;
export const cloudflareVideoGetTimeoutMs = 10_000;
export const cloudflareVideoListTimeoutMs = 10_000;
export const cloudflareVideoDeleteTimeoutMs = 15_000;

export const cloudflareStreamVideoStates = [
  "pendingupload",
  "downloading",
  "queued",
  "inprogress",
  "ready",
  "error",
  "live-inprogress",
] as const;

export type CloudflareStreamVideoState =
  (typeof cloudflareStreamVideoStates)[number];

export type CloudflareStreamVideo = {
  creatorCorrelation: string | null;
  durationSeconds: number | null;
  modifiedAt: string | null;
  providerAssetId: string;
  readyToStream: boolean | null;
  requireSignedURLs: boolean | null;
  safeErrorCode: string | null;
  state: CloudflareStreamVideoState;
  uploadedAt: string | null;
  uploadExpiry: string | null;
};

export type CloudflareStreamDeleteResult = {
  alreadyAbsent: boolean;
  deleted: true;
};

export type CloudflareStreamProviderErrorKind =
  | "invalid_response"
  | "not_found"
  | "unavailable";

export class CloudflareStreamProviderError extends Error {
  readonly kind: CloudflareStreamProviderErrorKind;
  readonly safeCode: string;
  readonly statusCategory: string | null;

  constructor(params: {
    kind: CloudflareStreamProviderErrorKind;
    safeCode: string;
    statusCategory?: string | null;
  }) {
    super("Video provider operation failed.");
    this.name = "CloudflareStreamProviderError";
    this.kind = params.kind;
    this.safeCode = params.safeCode;
    this.statusCategory = params.statusCategory ?? null;
  }
}

export interface CloudflareStreamAdapter {
  deleteVideo(providerAssetId: string): Promise<CloudflareStreamDeleteResult>;
  getVideo(providerAssetId: string): Promise<CloudflareStreamVideo>;
  listVideosByCreator(creator: string): Promise<CloudflareStreamVideo[]>;
}

export type CloudflareTusUploadInput = {
  creatorCorrelation: string;
  declaredSizeBytes: number;
  reservationExpiresAt: string;
  reservedSeconds: number;
};

export type CloudflareTusUploadResult = {
  providerAssetId: string;
  providerUploadExpiresAt: string;
  uploadUrl: string;
};

export type CloudflareCreateOutcome = "ambiguous" | "definite_failure";

export class CloudflareTusCreateError extends Error {
  readonly outcome: CloudflareCreateOutcome;
  readonly safeCode: string;
  readonly statusCategory: string | null;

  constructor(params: {
    outcome: CloudflareCreateOutcome;
    safeCode: string;
    statusCategory?: string | null;
  }) {
    super("Video upload provider could not create an upload session.");
    this.name = "CloudflareTusCreateError";
    this.outcome = params.outcome;
    this.safeCode = params.safeCode;
    this.statusCategory = params.statusCategory ?? null;
  }
}

function encodeMetadataValue(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

export function getProviderUploadExpiry(reservationExpiresAt: string) {
  const milliseconds = Date.parse(reservationExpiresAt);

  if (!Number.isFinite(milliseconds)) {
    throw new CloudflareTusCreateError({
      outcome: "ambiguous",
      safeCode: "provider_creation_response_invalid",
    });
  }

  const roundedDown = Math.floor(milliseconds / 1000) * 1000;

  if (roundedDown <= Date.now()) {
    throw new CloudflareTusCreateError({
      outcome: "definite_failure",
      safeCode: "upload_reservation_expired",
    });
  }

  return new Date(roundedDown).toISOString();
}

export function buildCloudflareTusUploadMetadata(input: {
  providerUploadExpiresAt: string;
  reservedSeconds: number;
}) {
  return [
    `maxDurationSeconds ${encodeMetadataValue(String(input.reservedSeconds))}`,
    "requiresignedurls",
    `expiry ${encodeMetadataValue(input.providerUploadExpiresAt)}`,
  ].join(",");
}

function statusCategory(status: number) {
  return `${Math.floor(status / 100)}xx`;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function normalizedIdentifier(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized &&
    normalized.length <= maximumLength &&
    !/[\s\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

function normalizedSafeErrorCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || null;
}

function invalidProviderResponse(): never {
  throw new CloudflareStreamProviderError({
    kind: "invalid_response",
    safeCode: "video_provider_response_invalid",
  });
}

function normalizeCloudflareVideo(value: unknown): CloudflareStreamVideo {
  const row = asRecord(value);
  const status = asRecord(row?.status);
  const providerAssetId = normalizedIdentifier(row?.uid, 255);
  const state =
    typeof status?.state === "string"
      ? status.state.trim().toLowerCase()
      : "";

  if (
    !row ||
    !providerAssetId ||
    !cloudflareStreamVideoStates.includes(
      state as CloudflareStreamVideoState,
    )
  ) {
    return invalidProviderResponse();
  }

  const rawDuration = row.duration;
  const durationSeconds =
    typeof rawDuration === "number" &&
    Number.isFinite(rawDuration) &&
    rawDuration > 0
      ? Math.ceil(rawDuration)
      : null;

  return {
    creatorCorrelation: normalizedIdentifier(row.creator, 64),
    durationSeconds,
    modifiedAt: normalizedTimestamp(row.modified),
    providerAssetId,
    readyToStream:
      typeof row.readyToStream === "boolean" ? row.readyToStream : null,
    requireSignedURLs:
      typeof row.requireSignedURLs === "boolean"
        ? row.requireSignedURLs
        : null,
    safeErrorCode: normalizedSafeErrorCode(
      status?.errorReasonCode ?? status?.errReasonCode,
    ),
    state: state as CloudflareStreamVideoState,
    uploadedAt: normalizedTimestamp(row.uploaded),
    uploadExpiry: normalizedTimestamp(row.uploadExpiry),
  };
}

function providerUrl(config: CloudflareStreamUploadConfig, suffix = "") {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/stream${suffix}`;
}

async function providerFetch(
  config: CloudflareStreamUploadConfig,
  url: string,
  init: RequestInit,
  options: { fetchImpl: typeof fetch; timeoutMs: number },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    return await options.fetchImpl(url, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        ...init.headers,
      },
      redirect: "manual",
      signal: controller.signal,
    });
  } catch {
    throw new CloudflareStreamProviderError({
      kind: "unavailable",
      safeCode: "video_provider_unavailable",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function providerJson(response: Response) {
  try {
    return asRecord(await response.json());
  } catch {
    return invalidProviderResponse();
  }
}

function providerFailure(response: Response): never {
  throw new CloudflareStreamProviderError({
    kind: response.status === 404 ? "not_found" : "unavailable",
    safeCode:
      response.status === 404
        ? "video_provider_not_found"
        : "video_provider_unavailable",
    statusCategory: statusCategory(response.status),
  });
}

export function createCloudflareStreamAdapter(
  config: CloudflareStreamUploadConfig,
  options: {
    deleteTimeoutMs?: number;
    fetchImpl?: typeof fetch;
    getTimeoutMs?: number;
    listTimeoutMs?: number;
  } = {},
): CloudflareStreamAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async getVideo(providerAssetId) {
      const identifier = normalizedIdentifier(providerAssetId, 255);
      if (!identifier) return invalidProviderResponse();
      const response = await providerFetch(
        config,
        providerUrl(config, `/${encodeURIComponent(identifier)}`),
        { method: "GET" },
        {
          fetchImpl,
          timeoutMs: options.getTimeoutMs ?? cloudflareVideoGetTimeoutMs,
        },
      );
      if (!response.ok) providerFailure(response);
      const envelope = await providerJson(response);
      if (envelope?.success !== true) return invalidProviderResponse();
      return normalizeCloudflareVideo(envelope.result);
    },

    async listVideosByCreator(creator) {
      const correlation = normalizedIdentifier(creator, 64);
      if (!correlation) return invalidProviderResponse();
      const query = new URLSearchParams({ creator: correlation, limit: "3" });
      const response = await providerFetch(
        config,
        `${providerUrl(config)}?${query.toString()}`,
        { method: "GET" },
        {
          fetchImpl,
          timeoutMs: options.listTimeoutMs ?? cloudflareVideoListTimeoutMs,
        },
      );
      if (!response.ok) providerFailure(response);
      const envelope = await providerJson(response);
      if (envelope?.success !== true || !Array.isArray(envelope.result)) {
        return invalidProviderResponse();
      }
      const videos = envelope.result.map(normalizeCloudflareVideo);
      if (videos.some((video) => video.creatorCorrelation !== correlation)) {
        return invalidProviderResponse();
      }
      return videos;
    },

    async deleteVideo(providerAssetId) {
      const identifier = normalizedIdentifier(providerAssetId, 255);
      if (!identifier) return invalidProviderResponse();
      let response: Response;
      try {
        response = await providerFetch(
          config,
          providerUrl(config, `/${encodeURIComponent(identifier)}`),
          { method: "DELETE" },
          {
            fetchImpl,
            timeoutMs:
              options.deleteTimeoutMs ?? cloudflareVideoDeleteTimeoutMs,
          },
        );
      } catch (error) {
        if (error instanceof CloudflareStreamProviderError) {
          throw new CloudflareStreamProviderError({
            kind: error.kind,
            safeCode: "video_provider_delete_failed",
            statusCategory: error.statusCategory,
          });
        }
        throw error;
      }
      if (response.status === 404) {
        return { alreadyAbsent: true, deleted: true };
      }
      if (!response.ok) {
        throw new CloudflareStreamProviderError({
          kind: "unavailable",
          safeCode: "video_provider_delete_failed",
          statusCategory: statusCategory(response.status),
        });
      }
      return { alreadyAbsent: false, deleted: true };
    },
  };
}

const definiteRejectionStatuses = new Set([
  400, 401, 403, 404, 405, 413, 415, 422, 429,
]);

export async function createCloudflareTusUpload(
  config: CloudflareStreamUploadConfig,
  input: CloudflareTusUploadInput,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<CloudflareTusUploadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? cloudflareTusTimeoutMs;
  const providerUploadExpiresAt = getProviderUploadExpiry(
    input.reservationExpiresAt,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/stream?direct_user=true`,
      {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Tus-Resumable": "1.0.0",
          "Upload-Creator": input.creatorCorrelation,
          "Upload-Length": String(input.declaredSizeBytes),
          "Upload-Metadata": buildCloudflareTusUploadMetadata({
            providerUploadExpiresAt,
            reservedSeconds: input.reservedSeconds,
          }),
        },
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const category = statusCategory(response.status);
      const definiteFailure = definiteRejectionStatuses.has(response.status);

      throw new CloudflareTusCreateError({
        outcome: definiteFailure ? "definite_failure" : "ambiguous",
        safeCode: definiteFailure
          ? "provider_creation_rejected"
          : "provider_creation_outcome_unknown",
        statusCategory: category,
      });
    }

    const uploadUrl = response.headers.get("location")?.trim() ?? "";
    const providerAssetId =
      response.headers.get("stream-media-id")?.trim() ?? "";

    if (
      !uploadUrl ||
      !providerAssetId ||
      !uploadUrl.startsWith("https://") ||
      providerAssetId.length > 255 ||
      /[\s\u0000-\u001f\u007f]/.test(providerAssetId)
    ) {
      throw new CloudflareTusCreateError({
        outcome: "ambiguous",
        safeCode: "provider_creation_response_invalid",
        statusCategory: statusCategory(response.status),
      });
    }

    return { providerAssetId, providerUploadExpiresAt, uploadUrl };
  } catch (error) {
    if (error instanceof CloudflareTusCreateError) {
      throw error;
    }

    throw new CloudflareTusCreateError({
      outcome: "ambiguous",
      safeCode: "provider_creation_outcome_unknown",
    });
  } finally {
    clearTimeout(timeout);
  }
}
