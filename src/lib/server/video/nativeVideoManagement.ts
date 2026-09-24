import type { SupabaseClient } from "@supabase/supabase-js";

import { isUuid } from "@/src/lib/server/assignmentAttachmentStorage";

export const nativeVideoManagementDefaultLimit = 25;
export const nativeVideoManagementMaximumLimit = 100;

const assetStatuses = new Set([
  "upload_pending",
  "processing",
  "ready",
  "failed",
  "delete_pending",
  "deleted",
] as const);

const capacityStates = new Set([
  "normal",
  "notice",
  "warning",
  "critical",
  "full",
] as const);

const uploadExpiredCodes = new Set([
  "provider_upload_expired",
  "provider_upload_capability_expired",
  "upload_reservation_expired",
]);

const processingFailedCodes = new Set([
  "provider_creation_failed",
  "provider_processing_failed",
]);

const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type DatabaseError = {
  code?: string;
  message?: string;
};

type NativeVideoManagementCursor = {
  assetId: string;
  createdAt: string;
};

type NativeVideoProjectionRequest = {
  actorUserId: string;
  assetId: string | null;
  cursor: NativeVideoManagementCursor | null;
  limit: number;
  tenantId: string;
};

export type NativeVideoManagementAttachment = {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
};

export type NativeVideoManagementAssetStatus =
  | "upload_pending"
  | "processing"
  | "ready"
  | "failed"
  | "delete_pending"
  | "deleted";

export type NativeVideoManagementAttention =
  | "upload_expired"
  | "processing_failed"
  | "capacity_issue"
  | "needs_review"
  | null;

export type NativeVideoManagementAsset = {
  assetId: string;
  attachments: NativeVideoManagementAttachment[];
  attention: NativeVideoManagementAttention;
  createdAt: string;
  deleteRequestedAt: string | null;
  durationSeconds: number | null;
  filename: string;
  reservedSeconds: number;
  status: NativeVideoManagementAssetStatus;
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

export type NativeVideoManagementDatabase = {
  getAsset(input: {
    actorUserId: string;
    assetId: string;
    tenantId: string;
  }): Promise<NativeVideoManagementAsset | null>;
  getCapacity(input: {
    actorUserId: string;
    tenantId: string;
  }): Promise<NativeVideoCapacity>;
  listAssets(input: {
    actorUserId: string;
    cursor: NativeVideoManagementCursor | null;
    limit: number;
    tenantId: string;
  }): Promise<NativeVideoManagementPage>;
};

export class NativeVideoManagementPublicError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "NativeVideoManagementPublicError";
    this.code = code;
    this.status = status;
  }
}

function invalidRequest(): never {
  throw new NativeVideoManagementPublicError(
    "VIDEO_INVALID_REQUEST",
    "Video management request is invalid.",
    400,
  );
}

function invalidProjection(): never {
  throw new NativeVideoManagementPublicError(
    "VIDEO_MANAGEMENT_PROJECTION_INVALID",
    "Video management information is temporarily unavailable.",
    500,
  );
}

function invalidCapacity(): never {
  throw new NativeVideoManagementPublicError(
    "VIDEO_CAPACITY_RESPONSE_INVALID",
    "Video capacity information is temporarily unavailable.",
    500,
  );
}

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

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 35 &&
    timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function nonNegativeInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function normalizeUuid(value: unknown) {
  return typeof value === "string" && isUuid(value)
    ? value.toLowerCase()
    : null;
}

export function mapNativeVideoManagementAttention(
  safeFailureCode: string | null,
): NativeVideoManagementAttention {
  if (safeFailureCode === null) return null;
  if (uploadExpiredCodes.has(safeFailureCode)) return "upload_expired";
  if (processingFailedCodes.has(safeFailureCode)) return "processing_failed";
  return "needs_review";
}

function normalizeAttachment(value: unknown): NativeVideoManagementAttachment {
  const row = asRecord(value);
  if (
    !row ||
    !hasExactKeys(row, [
      "course_id",
      "course_title",
      "lesson_id",
      "lesson_title",
    ])
  ) {
    invalidProjection();
  }

  const courseId = normalizeUuid(row.course_id);
  const lessonId = normalizeUuid(row.lesson_id);
  if (
    !courseId ||
    !lessonId ||
    typeof row.course_title !== "string" ||
    typeof row.lesson_title !== "string"
  ) {
    invalidProjection();
  }

  return {
    courseId,
    courseTitle: row.course_title,
    lessonId,
    lessonTitle: row.lesson_title,
  };
}

function normalizeAsset(value: unknown): NativeVideoManagementAsset {
  const row = asRecord(value);
  if (
    !row ||
    !hasExactKeys(row, [
      "asset_id",
      "attachments",
      "created_at",
      "delete_requested_at",
      "duration_seconds",
      "original_filename",
      "reserved_seconds",
      "safe_failure_code",
      "status",
      "updated_at",
    ])
  ) {
    invalidProjection();
  }

  const assetId = normalizeUuid(row.asset_id);
  const durationSeconds = row.duration_seconds;
  const safeFailureCode = row.safe_failure_code;
  if (
    !assetId ||
    typeof row.original_filename !== "string" ||
    row.original_filename.length < 1 ||
    row.original_filename.length > 255 ||
    typeof row.status !== "string" ||
    !assetStatuses.has(row.status as NativeVideoManagementAssetStatus) ||
    (durationSeconds !== null &&
      (!nonNegativeInteger(durationSeconds, 7_200) || durationSeconds < 1)) ||
    !nonNegativeInteger(row.reserved_seconds, 7_200) ||
    !validTimestamp(row.created_at) ||
    !validTimestamp(row.updated_at) ||
    (row.delete_requested_at !== null &&
      !validTimestamp(row.delete_requested_at)) ||
    (safeFailureCode !== null &&
      (typeof safeFailureCode !== "string" ||
        !/^[a-z0-9_]{1,80}$/.test(safeFailureCode))) ||
    !Array.isArray(row.attachments)
  ) {
    invalidProjection();
  }

  return {
    assetId,
    attachments: row.attachments.map(normalizeAttachment),
    attention: mapNativeVideoManagementAttention(safeFailureCode),
    createdAt: row.created_at,
    deleteRequestedAt: row.delete_requested_at,
    durationSeconds,
    filename: row.original_filename,
    reservedSeconds: row.reserved_seconds,
    status: row.status as NativeVideoManagementAssetStatus,
    updatedAt: row.updated_at,
  };
}

function normalizeCursor(value: unknown): NativeVideoManagementCursor {
  const row = asRecord(value);
  if (!row || !hasExactKeys(row, ["asset_id", "created_at"])) {
    invalidProjection();
  }
  const assetId = normalizeUuid(row.asset_id);
  if (!assetId || !validTimestamp(row.created_at)) {
    invalidProjection();
  }
  return { assetId, createdAt: row.created_at };
}

export function encodeNativeVideoManagementCursor(
  cursor: NativeVideoManagementCursor,
) {
  const assetId = normalizeUuid(cursor.assetId);
  if (!assetId || !validTimestamp(cursor.createdAt)) invalidProjection();
  return Buffer.from(
    JSON.stringify({ assetId, createdAt: cursor.createdAt, v: 1 }),
    "utf8",
  ).toString("base64url");
}

export function decodeNativeVideoManagementCursor(
  cursor: string,
): NativeVideoManagementCursor {
  if (
    cursor.length < 1 ||
    cursor.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    invalidRequest();
  }

  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) {
      invalidRequest();
    }
    const row = asRecord(JSON.parse(decoded));
    if (!row || !hasExactKeys(row, ["assetId", "createdAt", "v"])) {
      invalidRequest();
    }
    const assetId = normalizeUuid(row.assetId);
    if (
      row.v !== 1 ||
      !assetId ||
      assetId !== row.assetId ||
      !validTimestamp(row.createdAt)
    ) {
      invalidRequest();
    }
    return { assetId, createdAt: row.createdAt };
  } catch (error) {
    if (error instanceof NativeVideoManagementPublicError) throw error;
    invalidRequest();
  }
}

export function normalizeNativeVideoManagementProjection(
  value: unknown,
  expected: { limit: number; mode: "exact" | "list" },
) {
  const row = asRecord(value);
  if (!row || !hasExactKeys(row, ["items", "mode", "next_cursor"])) {
    invalidProjection();
  }
  if (row.mode !== expected.mode || !Array.isArray(row.items)) {
    invalidProjection();
  }
  if (
    row.items.length > expected.limit ||
    (expected.mode === "exact" &&
      (row.items.length > 1 || row.next_cursor !== null))
  ) {
    invalidProjection();
  }

  const items = row.items.map(normalizeAsset);
  if (expected.mode === "exact") {
    return { items, nextCursor: null };
  }

  const nextCursor =
    row.next_cursor === null ? null : normalizeCursor(row.next_cursor);
  if (nextCursor !== null) {
    const lastItem = items.at(-1);
    if (
      !lastItem ||
      nextCursor.assetId !== lastItem.assetId ||
      nextCursor.createdAt !== lastItem.createdAt
    ) {
      invalidProjection();
    }
  }
  return {
    items,
    nextCursor:
      nextCursor === null
        ? null
        : encodeNativeVideoManagementCursor(nextCursor),
  };
}

export function normalizeNativeVideoCapacity(value: unknown): NativeVideoCapacity {
  const row = asRecord(value);
  if (
    !row ||
    !hasExactKeys(row, [
      "add_on_capacity_minutes",
      "available_for_new_upload_minutes",
      "base_capacity_minutes",
      "capacity_state",
      "effective_capacity_minutes",
      "feature_enabled",
      "override_capacity_minutes",
      "percent_used",
      "reserved_minutes",
      "stored_minutes",
    ]) ||
    !nonNegativeInteger(row.add_on_capacity_minutes) ||
    !nonNegativeInteger(row.available_for_new_upload_minutes) ||
    !nonNegativeInteger(row.base_capacity_minutes) ||
    !nonNegativeInteger(row.effective_capacity_minutes) ||
    typeof row.feature_enabled !== "boolean" ||
    (row.override_capacity_minutes !== null &&
      !nonNegativeInteger(row.override_capacity_minutes)) ||
    typeof row.percent_used !== "number" ||
    !Number.isFinite(row.percent_used) ||
    row.percent_used < 0 ||
    row.percent_used > 100 ||
    !nonNegativeInteger(row.reserved_minutes) ||
    !nonNegativeInteger(row.stored_minutes) ||
    typeof row.capacity_state !== "string" ||
    !capacityStates.has(row.capacity_state as NativeVideoCapacity["capacityState"])
  ) {
    invalidCapacity();
  }

  return {
    addOnCapacityMinutes: row.add_on_capacity_minutes,
    availableForNewUploadMinutes: row.available_for_new_upload_minutes,
    baseCapacityMinutes: row.base_capacity_minutes,
    capacityState: row.capacity_state as NativeVideoCapacity["capacityState"],
    effectiveCapacityMinutes: row.effective_capacity_minutes,
    featureEnabled: row.feature_enabled,
    overrideCapacityMinutes: row.override_capacity_minutes,
    percentUsed: row.percent_used,
    reservedMinutes: row.reserved_minutes,
    storedMinutes: row.stored_minutes,
  };
}

function authorityError(
  operation: "capacity" | "projection",
  error: DatabaseError,
) {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "28000") {
    return new NativeVideoManagementPublicError(
      "VIDEO_AUTHENTICATION_REQUIRED",
      "Authentication required.",
      401,
    );
  }
  if (error.code === "22023") return invalidRequest();
  if (error.code === "42501") {
    if (
      operation === "capacity" &&
      (message.includes("capacity authority is unavailable") ||
        message.includes("capacity override is invalid"))
    ) {
      return new NativeVideoManagementPublicError(
        "VIDEO_CAPACITY_UNAVAILABLE",
        "Video capacity information is temporarily unavailable.",
        503,
      );
    }
    return new NativeVideoManagementPublicError(
      "VIDEO_MANAGEMENT_FORBIDDEN",
      "You do not have permission to view this video information.",
      403,
    );
  }
  return new NativeVideoManagementPublicError(
    operation === "capacity"
      ? "VIDEO_CAPACITY_UNAVAILABLE"
      : "VIDEO_MANAGEMENT_UNAVAILABLE",
    operation === "capacity"
      ? "Video capacity information is temporarily unavailable."
      : "Video management information is temporarily unavailable.",
    error.code === "PGRST202" ? 503 : 500,
  );
}

async function getProjection(
  client: SupabaseClient,
  input: NativeVideoProjectionRequest,
) {
  const { data, error } = await client.rpc(
    "get_native_video_management_projection_server",
    {
      p_actor_user_id: input.actorUserId,
      p_asset_id: input.assetId,
      p_cursor_asset_id: input.cursor?.assetId ?? null,
      p_cursor_created_at: input.cursor?.createdAt ?? null,
      p_limit: input.limit,
      p_tenant_id: input.tenantId,
    },
  );
  if (error) throw authorityError("projection", error);
  return normalizeNativeVideoManagementProjection(data, {
    limit: input.limit,
    mode: input.assetId === null ? "list" : "exact",
  });
}

export function createNativeVideoManagementDatabase(
  client: SupabaseClient,
): NativeVideoManagementDatabase {
  return {
    async getAsset(input) {
      const page = await getProjection(client, {
        ...input,
        cursor: null,
        limit: 1,
      });
      const asset = page.items[0] ?? null;
      if (asset && asset.assetId !== input.assetId) invalidProjection();
      return asset;
    },
    async getCapacity(input) {
      const { data, error } = await client.rpc(
        "get_native_video_capacity_server",
        {
          p_actor_user_id: input.actorUserId,
          p_tenant_id: input.tenantId,
        },
      );
      if (error) throw authorityError("capacity", error);
      return normalizeNativeVideoCapacity(data);
    },
    async listAssets(input) {
      return getProjection(client, { ...input, assetId: null });
    },
  };
}

function strictSearchParams(request: Request, allowed: Set<string>) {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) invalidRequest();
  }
  for (const key of allowed) {
    if (searchParams.getAll(key).length > 1) invalidRequest();
  }
  return searchParams;
}

function requiredTenantId(searchParams: URLSearchParams) {
  const tenantId = searchParams.get("tenantId");
  if (!tenantId || !isUuid(tenantId)) invalidRequest();
  return tenantId.toLowerCase();
}

export function parseNativeVideoListRequest(request: Request) {
  const searchParams = strictSearchParams(
    request,
    new Set(["cursor", "limit", "tenantId"]),
  );
  const tenantId = requiredTenantId(searchParams);
  const limitValue = searchParams.get("limit");
  if (limitValue !== null && !/^[1-9]\d{0,5}$/.test(limitValue)) {
    invalidRequest();
  }
  const limit = Math.min(
    limitValue === null ? nativeVideoManagementDefaultLimit : Number(limitValue),
    nativeVideoManagementMaximumLimit,
  );
  const cursorValue = searchParams.get("cursor");
  return {
    cursor:
      cursorValue === null
        ? null
        : decodeNativeVideoManagementCursor(cursorValue),
    limit,
    tenantId,
  };
}

export function parseNativeVideoTenantRequest(request: Request) {
  return {
    tenantId: requiredTenantId(
      strictSearchParams(request, new Set(["tenantId"])),
    ),
  };
}
