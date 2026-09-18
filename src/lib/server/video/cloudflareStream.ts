import {
  type CloudflareStreamUploadConfig,
} from "@/src/lib/server/video/cloudflareStreamConfig";

export const cloudflareTusTimeoutMs = 15_000;

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
