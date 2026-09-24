export type NativeVideoAssetStatus =
  | "upload_pending"
  | "processing"
  | "ready"
  | "failed"
  | "delete_pending"
  | "deleted";

export type NativeVideoAttention =
  | "upload_expired"
  | "processing_failed"
  | "capacity_issue"
  | "needs_review"
  | null;

export type NativeVideoManagementAttachment = {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
};

export type NativeVideoManagementAsset = {
  assetId: string;
  attachments: NativeVideoManagementAttachment[];
  attention: NativeVideoAttention;
  createdAt: string;
  deleteRequestedAt: string | null;
  durationSeconds: number | null;
  filename: string;
  reservedSeconds: number;
  status: NativeVideoAssetStatus;
  updatedAt: string;
};

export type NativeVideoManagementPage = {
  items: NativeVideoManagementAsset[];
  nextCursor: string | null;
};

export type NativeVideoCapacity = {
  addOnCapacityMinutes: number;
  availableForNewUploadMinutes: number;
  baseCapacityMinutes: number;
  capacityState: "normal" | "notice" | "warning" | "critical" | "full";
  effectiveCapacityMinutes: number;
  featureEnabled: boolean;
  overrideCapacityMinutes: number | null;
  percentUsed: number;
  reservedMinutes: number;
  storedMinutes: number;
};

export type NativeVideoLibraryFilter =
  | "all"
  | "processing"
  | "ready"
  | "attention"
  | "deleting";

export class NativeVideoManagementRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Native video management request failed.");
    this.name = "NativeVideoManagementRequestError";
    this.status = status;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cursorPattern = /^[A-Za-z0-9_-]+$/;
const assetStatuses = new Set<NativeVideoAssetStatus>([
  "upload_pending",
  "processing",
  "ready",
  "failed",
  "delete_pending",
  "deleted",
]);
const attentionStates = new Set<Exclude<NativeVideoAttention, null>>([
  "upload_expired",
  "processing_failed",
  "capacity_issue",
  "needs_review",
]);
const capacityStates = new Set<NativeVideoCapacity["capacityState"]>([
  "normal",
  "notice",
  "warning",
  "critical",
  "full",
]);

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(record).sort();
  const required = [...expected].sort();
  return (
    actual.length === required.length &&
    actual.every((key, index) => key === required[index])
  );
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function invalidResponse(): never {
  throw new NativeVideoManagementRequestError(500);
}

function normalizeAttachment(value: unknown): NativeVideoManagementAttachment {
  const row = asRecord(value);
  if (
    !row ||
    !hasExactKeys(row, ["courseId", "courseTitle", "lessonId", "lessonTitle"]) ||
    !isCanonicalUuid(row.courseId) ||
    !isCanonicalUuid(row.lessonId) ||
    typeof row.courseTitle !== "string" ||
    !row.courseTitle.trim() ||
    typeof row.lessonTitle !== "string" ||
    !row.lessonTitle.trim()
  ) {
    invalidResponse();
  }

  return {
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    lessonId: row.lessonId,
    lessonTitle: row.lessonTitle,
  };
}

export function normalizeNativeVideoManagementAsset(
  value: unknown,
): NativeVideoManagementAsset {
  const row = asRecord(value);
  if (
    !row ||
    !hasExactKeys(row, [
      "assetId",
      "attachments",
      "attention",
      "createdAt",
      "deleteRequestedAt",
      "durationSeconds",
      "filename",
      "reservedSeconds",
      "status",
      "updatedAt",
    ]) ||
    !isCanonicalUuid(row.assetId) ||
    !Array.isArray(row.attachments) ||
    !isTimestamp(row.createdAt) ||
    (row.deleteRequestedAt !== null && !isTimestamp(row.deleteRequestedAt)) ||
    (row.durationSeconds !== null &&
      (!Number.isSafeInteger(row.durationSeconds) ||
        Number(row.durationSeconds) < 1 ||
        Number(row.durationSeconds) > 7_200)) ||
    typeof row.filename !== "string" ||
    !row.filename.trim() ||
    !nonNegativeInteger(row.reservedSeconds) ||
    typeof row.status !== "string" ||
    !assetStatuses.has(row.status as NativeVideoAssetStatus) ||
    (row.attention !== null &&
      (typeof row.attention !== "string" ||
        !attentionStates.has(row.attention as Exclude<NativeVideoAttention, null>))) ||
    !isTimestamp(row.updatedAt)
  ) {
    invalidResponse();
  }

  return {
    assetId: row.assetId,
    attachments: row.attachments.map(normalizeAttachment),
    attention: row.attention as NativeVideoAttention,
    createdAt: row.createdAt,
    deleteRequestedAt: row.deleteRequestedAt,
    durationSeconds:
      row.durationSeconds === null ? null : Number(row.durationSeconds),
    filename: row.filename,
    reservedSeconds: row.reservedSeconds,
    status: row.status as NativeVideoAssetStatus,
    updatedAt: row.updatedAt,
  };
}

export function normalizeNativeVideoManagementPage(
  value: unknown,
): NativeVideoManagementPage {
  const row = asRecord(value);
  if (
    !row ||
    !hasExactKeys(row, ["items", "nextCursor"]) ||
    !Array.isArray(row.items) ||
    (row.nextCursor !== null &&
      (typeof row.nextCursor !== "string" ||
        row.nextCursor.length < 1 ||
        row.nextCursor.length > 512 ||
        !cursorPattern.test(row.nextCursor)))
  ) {
    invalidResponse();
  }

  const items = row.items.map(normalizeNativeVideoManagementAsset);
  if (new Set(items.map((item) => item.assetId)).size !== items.length) {
    invalidResponse();
  }

  return { items, nextCursor: row.nextCursor };
}

export function normalizeNativeVideoExactResponse(
  value: unknown,
  expectedAssetId: string,
) {
  const row = asRecord(value);
  if (!row || !hasExactKeys(row, ["asset"])) invalidResponse();
  const asset = normalizeNativeVideoManagementAsset(row.asset);
  if (asset.assetId !== expectedAssetId) invalidResponse();
  return asset;
}

export function normalizeNativeVideoCapacity(
  value: unknown,
): NativeVideoCapacity {
  const outer = asRecord(value);
  if (!outer || !hasExactKeys(outer, ["capacity"])) invalidResponse();
  const row = asRecord(outer.capacity);
  if (
    !row ||
    !hasExactKeys(row, [
      "addOnCapacityMinutes",
      "availableForNewUploadMinutes",
      "baseCapacityMinutes",
      "capacityState",
      "effectiveCapacityMinutes",
      "featureEnabled",
      "overrideCapacityMinutes",
      "percentUsed",
      "reservedMinutes",
      "storedMinutes",
    ]) ||
    !nonNegativeInteger(row.addOnCapacityMinutes) ||
    !nonNegativeInteger(row.availableForNewUploadMinutes) ||
    !nonNegativeInteger(row.baseCapacityMinutes) ||
    !nonNegativeInteger(row.effectiveCapacityMinutes) ||
    typeof row.featureEnabled !== "boolean" ||
    (row.overrideCapacityMinutes !== null &&
      !nonNegativeInteger(row.overrideCapacityMinutes)) ||
    typeof row.percentUsed !== "number" ||
    !Number.isFinite(row.percentUsed) ||
    row.percentUsed < 0 ||
    row.percentUsed > 100 ||
    !nonNegativeInteger(row.reservedMinutes) ||
    !nonNegativeInteger(row.storedMinutes) ||
    typeof row.capacityState !== "string" ||
    !capacityStates.has(row.capacityState as NativeVideoCapacity["capacityState"])
  ) {
    invalidResponse();
  }

  return {
    addOnCapacityMinutes: row.addOnCapacityMinutes,
    availableForNewUploadMinutes: row.availableForNewUploadMinutes,
    baseCapacityMinutes: row.baseCapacityMinutes,
    capacityState: row.capacityState as NativeVideoCapacity["capacityState"],
    effectiveCapacityMinutes: row.effectiveCapacityMinutes,
    featureEnabled: row.featureEnabled,
    overrideCapacityMinutes: row.overrideCapacityMinutes,
    percentUsed: row.percentUsed,
    reservedMinutes: row.reservedMinutes,
    storedMinutes: row.storedMinutes,
  };
}

async function getCurrentAccessToken() {
  const { getSupabaseClient } = await import("@/src/lib/supabaseClient");
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

type RequestOptions = {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
  signal?: AbortSignal;
};

async function requestJson(path: string, options: RequestOptions) {
  const accessToken = await (options.getAccessToken ?? getCurrentAccessToken)();
  if (!accessToken) throw new NativeVideoManagementRequestError(401);

  const response = await (options.fetchImpl ?? fetch)(path, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "GET",
    signal: options.signal,
  });
  if (!response.ok) throw new NativeVideoManagementRequestError(response.status);
  return response.json().catch(invalidResponse);
}

export async function getNativeVideoInventory(
  input: { cursor?: string | null; limit?: number; tenantId: string },
  options: RequestOptions = {},
) {
  const query = new URLSearchParams({ tenantId: input.tenantId });
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor) query.set("cursor", input.cursor);
  return normalizeNativeVideoManagementPage(
    await requestJson(`/api/video/assets?${query.toString()}`, options),
  );
}

export async function getNativeVideoAsset(
  input: { assetId: string; tenantId: string },
  options: RequestOptions = {},
) {
  const query = new URLSearchParams({ tenantId: input.tenantId });
  return normalizeNativeVideoExactResponse(
    await requestJson(
      `/api/video/assets/${encodeURIComponent(input.assetId)}?${query.toString()}`,
      options,
    ),
    input.assetId,
  );
}

export async function getNativeVideoCapacity(
  tenantId: string,
  options: RequestOptions = {},
) {
  const query = new URLSearchParams({ tenantId });
  return normalizeNativeVideoCapacity(
    await requestJson(`/api/video/capacity?${query.toString()}`, options),
  );
}

export function getNativeVideoManagementErrorMessage(status: number) {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) {
    return "Video management is not available for this workspace or account.";
  }
  return "Video management is temporarily unavailable. Please try again.";
}

export function mergeNativeVideoManagementPages(
  current: NativeVideoManagementAsset[],
  incoming: NativeVideoManagementAsset[],
) {
  const merged = [...current];
  const byId = new Map(current.map((asset) => [asset.assetId, asset]));

  for (const asset of incoming) {
    const existing = byId.get(asset.assetId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(asset)) invalidResponse();
      continue;
    }
    byId.set(asset.assetId, asset);
    merged.push(asset);
  }

  return merged;
}

export function assetMatchesNativeVideoFilter(
  asset: NativeVideoManagementAsset,
  filter: NativeVideoLibraryFilter,
) {
  if (filter === "all") return true;
  if (filter === "processing") {
    return asset.status === "upload_pending" || asset.status === "processing";
  }
  if (filter === "ready") return asset.status === "ready";
  if (filter === "attention") {
    return asset.status === "failed" || asset.attention !== null;
  }
  return asset.status === "delete_pending";
}

export function getNativeVideoStatusLabel(status: NativeVideoAssetStatus) {
  const labels: Record<NativeVideoAssetStatus, string> = {
    delete_pending: "Deleting",
    deleted: "Deleted",
    failed: "Needs attention",
    processing: "Processing",
    ready: "Ready",
    upload_pending: "Waiting for upload",
  };
  return labels[status];
}

export function getNativeVideoAttentionLabel(
  attention: NativeVideoAttention,
) {
  if (!attention) return null;
  const labels: Record<Exclude<NativeVideoAttention, null>, string> = {
    capacity_issue: "Capacity issue",
    needs_review: "Needs review",
    processing_failed: "Processing failed",
    upload_expired: "Upload expired",
  };
  return labels[attention];
}

export function isNativeVideoPollingStatus(status: NativeVideoAssetStatus) {
  return ["upload_pending", "processing", "delete_pending"].includes(status);
}

export function getNativeVideoPollingDelay(elapsedMilliseconds: number) {
  if (elapsedMilliseconds >= 10 * 60 * 1_000) return null;
  return elapsedMilliseconds < 30_000 ? 3_000 : 10_000;
}

type PollingEntry = {
  controller: AbortController | null;
  startedAt: number;
  status: NativeVideoAssetStatus;
  timer: unknown;
};

type PollingControllerOptions = {
  clearTimer?: (timer: unknown) => void;
  now?: () => number;
  onAsset: (asset: NativeVideoManagementAsset) => void;
  onAuthFailure: () => void;
  onError: (status: number) => void;
  requestAsset: (
    assetId: string,
    signal: AbortSignal,
  ) => Promise<NativeVideoManagementAsset>;
  setTimer?: (callback: () => void, delay: number) => unknown;
};

export function createNativeVideoPollingController(
  options: PollingControllerOptions,
) {
  const entries = new Map<string, PollingEntry>();
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer =
    options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let paused = false;
  let stopped = false;

  function stopEntry(assetId: string) {
    const entry = entries.get(assetId);
    if (!entry) return;
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.controller?.abort();
    entries.delete(assetId);
  }

  function stopAll() {
    stopped = true;
    for (const assetId of [...entries.keys()]) stopEntry(assetId);
  }

  function schedule(assetId: string) {
    const entry = entries.get(assetId);
    if (!entry || stopped || paused || entry.controller || entry.timer !== null) return;
    const delay = getNativeVideoPollingDelay(now() - entry.startedAt);
    if (delay === null) {
      stopEntry(assetId);
      return;
    }
    entry.timer = setTimer(() => {
      entry.timer = null;
      void poll(assetId);
    }, delay);
  }

  async function poll(assetId: string) {
    const entry = entries.get(assetId);
    if (!entry || stopped || paused) return;
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;

    try {
      const asset = await options.requestAsset(assetId, controller.signal);
      if (controller.signal.aborted || stopped) return;
      entry.status = asset.status;
      options.onAsset(asset);
      if (!isNativeVideoPollingStatus(asset.status)) {
        stopEntry(assetId);
        return;
      }
    } catch (error) {
      if (controller.signal.aborted || stopped) return;
      const status =
        error instanceof NativeVideoManagementRequestError ? error.status : 500;
      if (status === 401) {
        options.onAuthFailure();
        stopAll();
        return;
      }
      options.onError(status);
      if (status === 403 || status === 404) {
        stopEntry(assetId);
        return;
      }
    } finally {
      const current = entries.get(assetId);
      if (current?.controller === controller) current.controller = null;
    }

    schedule(assetId);
  }

  function sync(assets: NativeVideoManagementAsset[]) {
    if (stopped) return;
    const pollingIds = new Set(
      assets
        .filter((asset) => isNativeVideoPollingStatus(asset.status))
        .map((asset) => asset.assetId),
    );
    for (const assetId of [...entries.keys()]) {
      if (!pollingIds.has(assetId)) stopEntry(assetId);
    }
    for (const asset of assets) {
      if (!pollingIds.has(asset.assetId)) continue;
      const existing = entries.get(asset.assetId);
      if (existing) {
        existing.status = asset.status;
      } else {
        entries.set(asset.assetId, {
          controller: null,
          startedAt: now(),
          status: asset.status,
          timer: null,
        });
      }
      schedule(asset.assetId);
    }
  }

  function pause() {
    paused = true;
    for (const entry of entries.values()) {
      if (entry.timer !== null) clearTimer(entry.timer);
      entry.timer = null;
      entry.controller?.abort();
      entry.controller = null;
    }
  }

  function resume() {
    if (stopped) return;
    paused = false;
    for (const assetId of entries.keys()) schedule(assetId);
  }

  async function refresh(assetId: string) {
    if (stopped) return;
    let entry = entries.get(assetId);
    if (!entry) {
      entry = {
        controller: null,
        startedAt: now(),
        status: "ready",
        timer: null,
      };
      entries.set(assetId, entry);
    }
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.timer = null;
    entry.controller?.abort();
    await poll(assetId);
  }

  return { pause, refresh, resume, stopAll, sync };
}
