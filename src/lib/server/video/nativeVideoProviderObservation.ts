import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CloudflareStreamVideo,
  CloudflareStreamVideoState,
} from "@/src/lib/server/video/cloudflareStream";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NativeVideoObservationSource = "reconciliation" | "webhook";

export type NativeVideoProviderObservation = {
  assetId: string;
  durationSeconds: number | null;
  eventKey: string;
  eventTime: string;
  providerAssetId: string;
  safeEvidence: Record<string, unknown>;
  safePayloadHash: string;
  state: CloudflareStreamVideoState;
};

export interface NativeVideoObservationDatabase {
  observe(
    observation: NativeVideoProviderObservation,
  ): Promise<Record<string, unknown>>;
}

export class NativeVideoProviderObservationError extends Error {
  readonly safeCode: string;

  constructor(safeCode = "video_provider_response_invalid") {
    super("Video provider observation is invalid.");
    this.name = "NativeVideoProviderObservationError";
    this.safeCode = safeCode;
  }
}

function canonicalEventIdentity(video: CloudflareStreamVideo) {
  return `${video.providerAssetId}\n${video.state}\n${video.modifiedAt}`;
}

export function createNativeVideoProviderEventKey(
  video: CloudflareStreamVideo,
) {
  if (!video.modifiedAt) {
    throw new NativeVideoProviderObservationError();
  }
  return createHash("sha256")
    .update(canonicalEventIdentity(video), "utf8")
    .digest("hex");
}

export function buildNativeVideoProviderObservation(
  video: CloudflareStreamVideo,
  source: NativeVideoObservationSource,
  expectedAssetId?: string,
): NativeVideoProviderObservation {
  const assetId = video.creatorCorrelation ?? "";
  if (
    !uuidPattern.test(assetId) ||
    (expectedAssetId && assetId.toLowerCase() !== expectedAssetId.toLowerCase()) ||
    !video.modifiedAt ||
    (video.state === "ready" && !video.durationSeconds)
  ) {
    throw new NativeVideoProviderObservationError();
  }

  const canonicalSafeEvidence = {
    duration_seconds: video.durationSeconds,
    provider_modified_at: video.modifiedAt,
    provider_state: video.state,
    ready_to_stream: video.readyToStream,
    safe_error_code: video.safeErrorCode,
  };
  const safeEvidence = {
    ...canonicalSafeEvidence,
    observation_source: source,
  };

  return {
    assetId,
    durationSeconds: video.state === "ready" ? video.durationSeconds : null,
    eventKey: createNativeVideoProviderEventKey(video),
    eventTime: video.modifiedAt,
    providerAssetId: video.providerAssetId,
    safeEvidence,
    safePayloadHash: createHash("sha256")
      .update(JSON.stringify(canonicalSafeEvidence), "utf8")
      .digest("hex"),
    state: video.state,
  };
}

export function createNativeVideoObservationDatabase(
  client: SupabaseClient,
): NativeVideoObservationDatabase {
  return {
    async observe(observation) {
      const { data, error } = await client.rpc(
        "observe_native_video_provider_state_server",
        {
          p_asset_id: observation.assetId,
          p_event_key: observation.eventKey,
          p_event_time: observation.eventTime,
          p_provider_asset_id: observation.providerAssetId,
          p_provider_duration_seconds: observation.durationSeconds,
          p_provider_state: observation.state,
          p_safe_evidence_json: observation.safeEvidence,
          p_safe_payload_hash: observation.safePayloadHash,
        },
      );
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Unable to record video provider observation.");
      }
      return data as Record<string, unknown>;
    },
  };
}

export async function observeCloudflareStreamVideo(params: {
  database: NativeVideoObservationDatabase;
  expectedAssetId?: string;
  source: NativeVideoObservationSource;
  video: CloudflareStreamVideo;
}) {
  const observation = buildNativeVideoProviderObservation(
    params.video,
    params.source,
    params.expectedAssetId,
  );
  const result = await params.database.observe(observation);
  return { observation, result };
}
