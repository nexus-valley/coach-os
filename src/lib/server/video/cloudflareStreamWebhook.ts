import { createHmac, timingSafeEqual } from "node:crypto";

import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import {
  createCloudflareStreamAdapter,
  type CloudflareStreamAdapter,
  CloudflareStreamProviderError,
} from "@/src/lib/server/video/cloudflareStream";
import {
  CloudflareStreamConfigurationError,
  CloudflareStreamWebhookConfigurationError,
  getCloudflareStreamUploadConfig,
  getCloudflareStreamWebhookConfig,
} from "@/src/lib/server/video/cloudflareStreamConfig";
import {
  createNativeVideoObservationDatabase,
  type NativeVideoObservationDatabase,
  NativeVideoProviderObservationError,
  observeCloudflareStreamVideo,
} from "@/src/lib/server/video/nativeVideoProviderObservation";

export const cloudflareWebhookReplayWindowSeconds = 5 * 60;
export const cloudflareWebhookMaxBytes = 64 * 1024;

export type CloudflareWebhookVerificationResult =
  | { valid: true; timestamp: number }
  | { reason: "invalid" | "stale"; valid: false };

function signatureParts(header: string) {
  const entries = header.split(",").map((part) => part.trim().split("="));
  const times = entries.filter(([key]) => key === "time");
  const signatures = entries.filter(([key]) => key === "sig1");
  if (
    times.length !== 1 ||
    signatures.length !== 1 ||
    times[0].length !== 2 ||
    signatures[0].length !== 2
  ) {
    return null;
  }
  return { signature: signatures[0][1] ?? "", time: times[0][1] ?? "" };
}

export function verifyCloudflareWebhookSignature(input: {
  nowSeconds?: number;
  rawBody: Buffer;
  signatureHeader: string;
  signingSecret: string;
}): CloudflareWebhookVerificationResult {
  const parts = signatureParts(input.signatureHeader);
  if (!parts || !/^\d{1,16}$/.test(parts.time)) {
    return { reason: "invalid", valid: false };
  }

  const timestamp = Number(parts.time);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > cloudflareWebhookReplayWindowSeconds
  ) {
    return { reason: "stale", valid: false };
  }

  const expected = createHmac("sha256", input.signingSecret)
    .update(Buffer.from(`${parts.time}.`, "utf8"))
    .update(input.rawBody)
    .digest();
  const validHex = /^[0-9a-fA-F]{64}$/.test(parts.signature);
  const supplied = validHex
    ? Buffer.from(parts.signature, "hex")
    : Buffer.alloc(expected.length);
  const matches = timingSafeEqual(expected, supplied);

  return validHex && matches
    ? { timestamp, valid: true }
    : { reason: "invalid", valid: false };
}

function webhookUid(rawBody: Buffer) {
  try {
    const value = JSON.parse(rawBody.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const uid = (value as Record<string, unknown>).uid;
    if (
      typeof uid !== "string" ||
      !uid.trim() ||
      uid.length > 255 ||
      /[\s\u0000-\u001f\u007f]/.test(uid)
    ) {
      return null;
    }
    return uid;
  } catch {
    return null;
  }
}

type WebhookProcess = (providerAssetId: string) => Promise<void>;

export async function processCloudflareStreamWebhook(
  providerAssetId: string,
  options: {
    database?: NativeVideoObservationDatabase;
    provider?: CloudflareStreamAdapter;
  } = {},
) {
  const provider =
    options.provider ??
    createCloudflareStreamAdapter(getCloudflareStreamUploadConfig());
  const database =
    options.database ??
    createNativeVideoObservationDatabase(getSupabaseAdminClient());
  const video = await provider.getVideo(providerAssetId);

  if (video.providerAssetId !== providerAssetId) {
    throw new NativeVideoProviderObservationError();
  }

  await observeCloudflareStreamVideo({
    database,
    source: "webhook",
    video,
  });
}

function webhookFailure(error: unknown) {
  if (error instanceof CloudflareStreamWebhookConfigurationError) {
    return Response.json(
      {
        code: "VIDEO_NOT_CONFIGURED",
        error: "Video webhook is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
  if (
    error instanceof CloudflareStreamConfigurationError ||
    error instanceof CloudflareStreamProviderError ||
    error instanceof NativeVideoProviderObservationError
  ) {
    return Response.json(
      {
        code: "VIDEO_PROVIDER_UNAVAILABLE",
        error: "Video status processing is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
  return Response.json(
    {
      code: "VIDEO_PROVIDER_UNAVAILABLE",
      error: "Video status processing is temporarily unavailable.",
    },
    { status: 503 },
  );
}

export async function handleCloudflareStreamWebhookRequest(
  request: Request,
  options: {
    nowSeconds?: number;
    process?: WebhookProcess;
    signingSecret?: string;
  } = {},
) {
  let signingSecret: string;
  try {
    signingSecret =
      options.signingSecret ?? getCloudflareStreamWebhookConfig().signingSecret;
    if (!signingSecret.trim()) {
      throw new CloudflareStreamWebhookConfigurationError();
    }
  } catch (error) {
    return webhookFailure(error);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > cloudflareWebhookMaxBytes
  ) {
    return Response.json(
      { code: "VIDEO_WEBHOOK_INVALID", error: "Invalid webhook." },
      { status: 413 },
    );
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.byteLength > cloudflareWebhookMaxBytes) {
    return Response.json(
      { code: "VIDEO_WEBHOOK_INVALID", error: "Invalid webhook." },
      { status: 413 },
    );
  }

  const verification = verifyCloudflareWebhookSignature({
    nowSeconds: options.nowSeconds,
    rawBody,
    signatureHeader: request.headers.get("webhook-signature")?.trim() ?? "",
    signingSecret,
  });
  if (!verification.valid) {
    return Response.json(
      {
        code:
          verification.reason === "stale"
            ? "VIDEO_WEBHOOK_STALE"
            : "VIDEO_WEBHOOK_SIGNATURE_INVALID",
        error: "Invalid webhook.",
      },
      { status: 401 },
    );
  }

  const providerAssetId = webhookUid(rawBody);
  if (!providerAssetId) {
    return Response.json(
      { code: "VIDEO_WEBHOOK_INVALID", error: "Invalid webhook." },
      { status: 400 },
    );
  }

  try {
    await (options.process ?? processCloudflareStreamWebhook)(providerAssetId);
    return Response.json({ received: true });
  } catch (error) {
    captureServerException(error, {
      operation: "cloudflare_stream_webhook",
      providerAssetId,
      route: "/api/video/cloudflare/webhook",
      stage: "provider_observation",
    });
    return webhookFailure(error);
  }
}
