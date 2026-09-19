import type { SupabaseClient } from "@supabase/supabase-js";

import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import {
  createCloudflareStreamAdapter,
  type CloudflareStreamAdapter,
  CloudflareStreamProviderError,
} from "@/src/lib/server/video/cloudflareStream";
import { getCloudflareStreamUploadConfig } from "@/src/lib/server/video/cloudflareStreamConfig";
import {
  createNativeVideoObservationDatabase,
  type NativeVideoObservationDatabase,
  NativeVideoProviderObservationError,
  observeCloudflareStreamVideo,
} from "@/src/lib/server/video/nativeVideoProviderObservation";

export const nativeVideoReconciliationBatchSize = 25;
export const nativeVideoReconciliationLeaseSeconds = 300;

const reconciliationActions = [
  "delete_provider",
  "get_provider_state",
  "recover_ambiguous_provider",
  "resolve_unbound_reservation",
] as const;

type ReconciliationAction = (typeof reconciliationActions)[number];

export type NativeVideoReconciliationItem = {
  action: ReconciliationAction;
  assetId: string;
  claimToken: string;
  providerAssetId: string | null;
};

export type NativeVideoReconciliationSummary = {
  claimed: number;
  deferred: number;
  deleted: number;
  failed: number;
  processed: number;
  reconciled: number;
};

export interface NativeVideoReconciliationDatabase
  extends NativeVideoObservationDatabase {
  claim(input: {
    leaseSeconds: number;
    limit: number;
  }): Promise<NativeVideoReconciliationItem[]>;
  confirmDeletion(input: {
    assetId: string;
    providerAssetId: string;
  }): Promise<void>;
  expireUnbound(input: {
    assetId: string;
    claimToken: string;
    providerMatchCount: number;
  }): Promise<void>;
  recoverIdentity(input: {
    assetId: string;
    claimToken: string;
    providerAssetId: string;
    providerMatchCount: number;
  }): Promise<void>;
  release(input: {
    assetId: string;
    claimToken: string;
    safeFailureCode: string | null;
  }): Promise<void>;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Native video reconciliation response is invalid.");
  }
  return value.trim();
}

async function rpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw new Error("Native video reconciliation authority failed.");
  return data;
}

export function createNativeVideoReconciliationDatabase(
  client: SupabaseClient,
): NativeVideoReconciliationDatabase {
  const observation = createNativeVideoObservationDatabase(client);
  return {
    ...observation,
    async claim(input) {
      const data = asRecord(
        await rpc(client, "claim_native_video_reconciliation_batch_server", {
          p_lease_seconds: input.leaseSeconds,
          p_limit: input.limit,
        }),
      );
      if (!data || !Array.isArray(data.items)) {
        throw new Error("Native video reconciliation response is invalid.");
      }
      return data.items.map((value) => {
        const row = asRecord(value);
        if (!row) throw new Error("Native video reconciliation item is invalid.");
        const action = requiredString(row, "reconcile_action");
        if (!reconciliationActions.includes(action as ReconciliationAction)) {
          throw new Error("Native video reconciliation action is invalid.");
        }
        const providerAssetId = row.provider_asset_id;
        if (
          providerAssetId !== null &&
          providerAssetId !== undefined &&
          typeof providerAssetId !== "string"
        ) {
          throw new Error("Native video provider identity is invalid.");
        }
        return {
          action: action as ReconciliationAction,
          assetId: requiredString(row, "asset_id"),
          claimToken: requiredString(row, "claim_token"),
          providerAssetId:
            typeof providerAssetId === "string" ? providerAssetId : null,
        };
      });
    },
    async confirmDeletion(input) {
      await rpc(client, "confirm_native_video_provider_deletion_server", {
        p_asset_id: input.assetId,
        p_provider_asset_id: input.providerAssetId,
      });
    },
    async expireUnbound(input) {
      await rpc(client, "expire_unbound_native_video_upload_server", {
        p_asset_id: input.assetId,
        p_provider_match_count: input.providerMatchCount,
        p_reconciliation_claim_token: input.claimToken,
      });
    },
    async recoverIdentity(input) {
      await rpc(client, "recover_native_video_provider_identity_server", {
        p_asset_id: input.assetId,
        p_provider_asset_id: input.providerAssetId,
        p_provider_match_count: input.providerMatchCount,
        p_reconciliation_claim_token: input.claimToken,
      });
    },
    async release(input) {
      await rpc(client, "release_native_video_reconciliation_claim_server", {
        p_asset_id: input.assetId,
        p_claim_token: input.claimToken,
        p_safe_failure_code: input.safeFailureCode,
      });
    },
  };
}

async function releaseBestEffort(
  database: NativeVideoReconciliationDatabase,
  item: NativeVideoReconciliationItem,
  safeFailureCode: string | null,
) {
  await database.release({
    assetId: item.assetId,
    claimToken: item.claimToken,
    safeFailureCode,
  });
}

async function observeItem(params: {
  database: NativeVideoReconciliationDatabase;
  item: NativeVideoReconciliationItem;
  provider: CloudflareStreamAdapter;
  providerAssetId: string;
}) {
  const video = await params.provider.getVideo(params.providerAssetId);
  if (video.providerAssetId !== params.providerAssetId) {
    throw new NativeVideoProviderObservationError();
  }
  const { result } = await observeCloudflareStreamVideo({
    database: params.database,
    expectedAssetId: params.item.assetId,
    source: "reconciliation",
    video,
  });
  if (result.replayed === true || result.stale_observation === true) {
    await releaseBestEffort(params.database, params.item, null);
  }
}

async function recoverOrExpire(params: {
  allowExpiry: boolean;
  database: NativeVideoReconciliationDatabase;
  item: NativeVideoReconciliationItem;
  provider: CloudflareStreamAdapter;
}) {
  const matches = await params.provider.listVideosByCreator(params.item.assetId);
  if (matches.length > 1) {
    await releaseBestEffort(
      params.database,
      params.item,
      "provider_identity_ambiguous",
    );
    return "deferred" as const;
  }
  if (matches.length === 0) {
    if (params.allowExpiry) {
      await params.database.expireUnbound({
        assetId: params.item.assetId,
        claimToken: params.item.claimToken,
        providerMatchCount: 0,
      });
      await releaseBestEffort(params.database, params.item, null);
      return "reconciled" as const;
    }
    await releaseBestEffort(
      params.database,
      params.item,
      "provider_identity_not_found",
    );
    return "deferred" as const;
  }

  const match = matches[0];
  await params.database.recoverIdentity({
    assetId: params.item.assetId,
    claimToken: params.item.claimToken,
    providerAssetId: match.providerAssetId,
    providerMatchCount: 1,
  });
  const currentVideo = await params.provider.getVideo(match.providerAssetId);
  if (currentVideo.providerAssetId !== match.providerAssetId) {
    throw new NativeVideoProviderObservationError();
  }
  const { result } = await observeCloudflareStreamVideo({
    database: params.database,
    expectedAssetId: params.item.assetId,
    source: "reconciliation",
    video: currentVideo,
  });
  if (result.replayed === true || result.stale_observation === true) {
    await releaseBestEffort(params.database, params.item, null);
  }
  return "reconciled" as const;
}

async function processItem(params: {
  database: NativeVideoReconciliationDatabase;
  item: NativeVideoReconciliationItem;
  provider: CloudflareStreamAdapter;
}) {
  const { database, item, provider } = params;
  if (item.action === "delete_provider") {
    if (!item.providerAssetId) {
      throw new NativeVideoProviderObservationError();
    }
    await provider.deleteVideo(item.providerAssetId);
    await database.confirmDeletion({
      assetId: item.assetId,
      providerAssetId: item.providerAssetId,
    });
    await releaseBestEffort(database, item, null);
    return "deleted" as const;
  }
  if (item.action === "get_provider_state") {
    if (!item.providerAssetId) {
      throw new NativeVideoProviderObservationError();
    }
    await observeItem({
      database,
      item,
      provider,
      providerAssetId: item.providerAssetId,
    });
    return "reconciled" as const;
  }
  return recoverOrExpire({
    allowExpiry: item.action === "resolve_unbound_reservation",
    database,
    item,
    provider,
  });
}

function safeFailureCode(error: unknown) {
  if (error instanceof CloudflareStreamProviderError) return error.safeCode;
  if (error instanceof NativeVideoProviderObservationError) return error.safeCode;
  return "video_reconciliation_deferred";
}

export async function runNativeVideoReconciliation(
  options: {
    database?: NativeVideoReconciliationDatabase;
    onOperationalError?: (
      error: unknown,
      context: Record<string, unknown>,
    ) => void;
    provider?: CloudflareStreamAdapter;
  } = {},
): Promise<NativeVideoReconciliationSummary> {
  const admin = options.database ? null : getSupabaseAdminClient();
  const database =
    options.database ?? createNativeVideoReconciliationDatabase(admin!);
  const provider =
    options.provider ??
    createCloudflareStreamAdapter(getCloudflareStreamUploadConfig());
  const onOperationalError =
    options.onOperationalError ??
    ((error, context) => captureServerException(error, context));
  const items = await database.claim({
    leaseSeconds: nativeVideoReconciliationLeaseSeconds,
    limit: nativeVideoReconciliationBatchSize,
  });
  const summary: NativeVideoReconciliationSummary = {
    claimed: items.length,
    deferred: 0,
    deleted: 0,
    failed: 0,
    processed: 0,
    reconciled: 0,
  };

  for (const item of items) {
    try {
      const outcome = await processItem({ database, item, provider });
      summary[outcome] += 1;
    } catch (error) {
      const expectedProviderFailure =
        error instanceof CloudflareStreamProviderError ||
        error instanceof NativeVideoProviderObservationError;
      try {
        await releaseBestEffort(database, item, safeFailureCode(error));
      } catch (releaseError) {
        onOperationalError(releaseError, {
          assetId: item.assetId,
          operation: "native_video_reconciliation",
          stage: "release_claim",
        });
      }
      summary[expectedProviderFailure ? "deferred" : "failed"] += 1;
      onOperationalError(error, {
        assetId: item.assetId,
        operation: "native_video_reconciliation",
        providerAssetId: item.providerAssetId,
        safeCode: safeFailureCode(error),
        stage: item.action,
      });
    } finally {
      summary.processed += 1;
    }
  }

  return summary;
}
