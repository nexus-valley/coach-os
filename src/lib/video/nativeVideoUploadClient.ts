import { isNativeVideoUploadCapabilityUrl } from "@/src/lib/monitoring";

export const nativeVideoAllowedMimeTypes = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/mpeg",
] as const;

export const nativeVideoMaximumBytes = 10_737_418_240;
export const nativeVideoMaximumDurationSeconds = 7_200;
export const nativeVideoRecoveryVersion = 1;

export type NativeVideoUploadSafePhase =
  | "ready_to_start"
  | "provisioning"
  | "provisioning_pending"
  | "uploading"
  | "paused_or_interrupted"
  | "cancelled_local"
  | "binary_complete"
  | "processing"
  | "needs_review";

export type NativeVideoUploadRecoveryRecord = {
  assetId?: string;
  createdAt: string;
  expectedDurationSeconds: number;
  filename: string;
  lastModified: number;
  mimeType: string;
  requestId: string;
  safePhase: NativeVideoUploadSafePhase;
  sizeBytes: number;
  tenantId: string;
  version: 1;
};

export type NativeVideoProvisioningSuccess = {
  assetId: string;
  expiresAt: string;
  replayed: boolean;
  reservedSeconds: number;
  uploadUrl: string;
};

export type NativeVideoProvisioningPending = {
  assetId: string;
  code: "VIDEO_RECONCILIATION_REQUIRED" | "VIDEO_UPLOAD_PENDING";
  message: string;
  status: "pending";
};

export class NativeVideoUploadClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super("Native video upload request failed.");
    this.name = "NativeVideoUploadClientError";
    this.code = code;
    this.status = status;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const allowedMimeTypes = new Set<string>(nativeVideoAllowedMimeTypes);
const recoveryPhases = new Set<NativeVideoUploadSafePhase>([
  "ready_to_start",
  "provisioning",
  "provisioning_pending",
  "uploading",
  "paused_or_interrupted",
  "cancelled_local",
  "binary_complete",
  "processing",
  "needs_review",
]);

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(record: Record<string, unknown>, required: string[], optional: string[] = []) {
  const permitted = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(record, key)) &&
    Object.keys(record).every((key) => permitted.has(key))
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

export function getNativeVideoRecoveryKey(tenantId: string) {
  if (!isUuid(tenantId)) throw new NativeVideoUploadClientError("VIDEO_INVALID_REQUEST", 400);
  return `coachfort:native-video-upload:v${nativeVideoRecoveryVersion}:${tenantId}`;
}

export function validateNativeVideoFile(file: Pick<File, "name" | "size" | "type">) {
  const mimeType = file.type.trim().toLowerCase();
  if (!allowedMimeTypes.has(mimeType)) {
    throw new NativeVideoUploadClientError("VIDEO_FILE_TYPE_UNSUPPORTED", 400);
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > nativeVideoMaximumBytes) {
    throw new NativeVideoUploadClientError("VIDEO_FILE_SIZE_INVALID", 400);
  }
  if (!file.name.trim() || file.name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) {
    throw new NativeVideoUploadClientError("VIDEO_FILENAME_INVALID", 400);
  }
  return { filename: file.name, mimeType, sizeBytes: file.size };
}

type DurationVideo = Pick<
  HTMLVideoElement,
  | "duration"
  | "load"
  | "onerror"
  | "onloadedmetadata"
  | "preload"
  | "removeAttribute"
  | "src"
>;

type DurationEnvironment = {
  createObjectURL(file: File): string;
  createVideo(): DurationVideo;
  revokeObjectURL(url: string): void;
};

function browserDurationEnvironment(): DurationEnvironment {
  return {
    createObjectURL: (file) => URL.createObjectURL(file),
    createVideo: () => document.createElement("video"),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

export async function extractNativeVideoDuration(
  file: File,
  environment: DurationEnvironment = browserDurationEnvironment(),
) {
  const objectUrl = environment.createObjectURL(file);
  const video = environment.createVideo();

  try {
    const duration = await new Promise<number>((resolve, reject) => {
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new NativeVideoUploadClientError("VIDEO_DURATION_UNAVAILABLE", 400));
      video.src = objectUrl;
      video.load();
    });
    const rounded = Math.ceil(duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isSafeInteger(rounded) ||
      rounded < 1 ||
      rounded > nativeVideoMaximumDurationSeconds
    ) {
      throw new NativeVideoUploadClientError("VIDEO_DURATION_INVALID", 400);
    }
    return rounded;
  } finally {
    video.onerror = null;
    video.onloadedmetadata = null;
    video.removeAttribute("src");
    video.load();
    environment.revokeObjectURL(objectUrl);
  }
}

export function createNativeVideoRecoveryRecord(input: {
  assetId?: string;
  durationSeconds: number;
  file: Pick<File, "lastModified" | "name" | "size" | "type">;
  now?: () => Date;
  requestId: string;
  safePhase: NativeVideoUploadSafePhase;
  tenantId: string;
}): NativeVideoUploadRecoveryRecord {
  const details = validateNativeVideoFile(input.file);
  if (!isUuid(input.tenantId) || !isUuid(input.requestId)) {
    throw new NativeVideoUploadClientError("VIDEO_INVALID_REQUEST", 400);
  }
  if (
    !Number.isSafeInteger(input.durationSeconds) ||
    input.durationSeconds < 1 ||
    input.durationSeconds > nativeVideoMaximumDurationSeconds
  ) {
    throw new NativeVideoUploadClientError("VIDEO_DURATION_INVALID", 400);
  }
  if (input.assetId !== undefined && !isUuid(input.assetId)) {
    throw new NativeVideoUploadClientError("VIDEO_INVALID_REQUEST", 400);
  }
  return {
    ...(input.assetId ? { assetId: input.assetId } : {}),
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    expectedDurationSeconds: input.durationSeconds,
    filename: details.filename,
    lastModified: input.file.lastModified,
    mimeType: details.mimeType,
    requestId: input.requestId.toLowerCase(),
    safePhase: input.safePhase,
    sizeBytes: details.sizeBytes,
    tenantId: input.tenantId.toLowerCase(),
    version: nativeVideoRecoveryVersion,
  };
}

export function normalizeNativeVideoRecoveryRecord(value: unknown): NativeVideoUploadRecoveryRecord | null {
  const row = asRecord(value);
  if (
    !row ||
    !hasExactKeys(
      row,
      [
        "createdAt",
        "expectedDurationSeconds",
        "filename",
        "lastModified",
        "mimeType",
        "requestId",
        "safePhase",
        "sizeBytes",
        "tenantId",
        "version",
      ],
      ["assetId"],
    ) ||
    row.version !== nativeVideoRecoveryVersion ||
    !isUuid(row.tenantId) ||
    !isUuid(row.requestId) ||
    (row.assetId !== undefined && !isUuid(row.assetId)) ||
    !isTimestamp(row.createdAt) ||
    typeof row.filename !== "string" ||
    !row.filename ||
    !allowedMimeTypes.has(String(row.mimeType)) ||
    !Number.isSafeInteger(row.sizeBytes) ||
    Number(row.sizeBytes) < 1 ||
    Number(row.sizeBytes) > nativeVideoMaximumBytes ||
    !Number.isSafeInteger(row.lastModified) ||
    !Number.isSafeInteger(row.expectedDurationSeconds) ||
    Number(row.expectedDurationSeconds) < 1 ||
    Number(row.expectedDurationSeconds) > nativeVideoMaximumDurationSeconds ||
    !recoveryPhases.has(row.safePhase as NativeVideoUploadSafePhase)
  ) {
    return null;
  }
  return row as NativeVideoUploadRecoveryRecord;
}

export function readNativeVideoRecoveryRecord(tenantId: string, storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage) {
  const key = getNativeVideoRecoveryKey(tenantId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const record = normalizeNativeVideoRecoveryRecord(JSON.parse(raw));
    if (!record || record.tenantId !== tenantId.toLowerCase()) storage.removeItem(key);
    return record;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeNativeVideoRecoveryRecord(record: NativeVideoUploadRecoveryRecord, storage: Pick<Storage, "setItem"> = sessionStorage) {
  const normalized = normalizeNativeVideoRecoveryRecord(record);
  if (!normalized) throw new NativeVideoUploadClientError("VIDEO_INVALID_REQUEST", 400);
  storage.setItem(getNativeVideoRecoveryKey(normalized.tenantId), JSON.stringify(normalized));
}

export function clearNativeVideoRecoveryRecord(tenantId: string, storage: Pick<Storage, "removeItem"> = sessionStorage) {
  storage.removeItem(getNativeVideoRecoveryKey(tenantId));
}

export function nativeVideoFileMatchesRecovery(
  file: Pick<File, "lastModified" | "name" | "size" | "type">,
  record: NativeVideoUploadRecoveryRecord,
) {
  return (
    file.name === record.filename &&
    file.size === record.sizeBytes &&
    file.type.trim().toLowerCase() === record.mimeType &&
    file.lastModified === record.lastModified
  );
}

export type NativeVideoFileSelectionDecision =
  | "new_attempt"
  | "replace_local_attempt"
  | "resume_attempt"
  | "require_original_file";

export function getNativeVideoFileSelectionDecision(
  file: Pick<File, "lastModified" | "name" | "size" | "type">,
  record: NativeVideoUploadRecoveryRecord | null,
): NativeVideoFileSelectionDecision {
  if (!record) return "new_attempt";
  if (nativeVideoFileMatchesRecovery(file, record)) return "resume_attempt";
  if (!record.assetId && record.safePhase === "ready_to_start") {
    return "replace_local_attempt";
  }
  return "require_original_file";
}

export function getNativeVideoSuccessfulSelectionPhase(
  decision: NativeVideoFileSelectionDecision,
  record: NativeVideoUploadRecoveryRecord | null,
): "ready_to_start" | "paused_or_interrupted" | "cancelled_local" {
  if (decision !== "resume_attempt" || record?.safePhase === "ready_to_start") {
    return "ready_to_start";
  }
  return record?.safePhase === "cancelled_local"
    ? "cancelled_local"
    : "paused_or_interrupted";
}

export function advanceNativeVideoRecoveryRecord(
  record: NativeVideoUploadRecoveryRecord,
  safePhase: NativeVideoUploadSafePhase,
  assetId?: string,
) {
  const incomingAssetId = assetId?.toLowerCase();
  if (incomingAssetId !== undefined && !isUuid(incomingAssetId)) {
    throw new NativeVideoUploadClientError("VIDEO_UPLOAD_IDENTITY_CONFLICT", 409);
  }
  if (record.assetId && incomingAssetId && record.assetId !== incomingAssetId) {
    throw new NativeVideoUploadClientError("VIDEO_UPLOAD_IDENTITY_CONFLICT", 409);
  }
  return {
    ...record,
    ...(record.assetId || incomingAssetId
      ? { assetId: record.assetId ?? incomingAssetId }
      : {}),
    safePhase,
  };
}

export function canStartNativeVideoUpload(input: {
  capacityAvailable: boolean;
  capacitySufficient: boolean;
  hasFile: boolean;
  operationalUploadAllowed: boolean;
  phase: string;
}) {
  return (
    input.phase === "ready_to_start" &&
    input.hasFile &&
    input.operationalUploadAllowed &&
    input.capacityAvailable &&
    input.capacitySufficient
  );
}

export function canContinueNativeVideoUpload(input: {
  hasFile: boolean;
  operationalUploadAllowed: boolean;
  phase: string;
}) {
  return (
    (input.phase === "paused_or_interrupted" || input.phase === "cancelled_local") &&
    input.hasFile &&
    input.operationalUploadAllowed
  );
}

function normalizeProvisioningResponse(value: unknown, status: number) {
  const row = asRecord(value);
  if (status === 200) {
    if (
      !row ||
      !hasExactKeys(row, ["assetId", "expiresAt", "replayed", "reservedSeconds", "uploadUrl"]) ||
      !isUuid(row.assetId) ||
      !isTimestamp(row.expiresAt) ||
      typeof row.replayed !== "boolean" ||
      !Number.isSafeInteger(row.reservedSeconds) ||
      Number(row.reservedSeconds) < 1 ||
      Number(row.reservedSeconds) > nativeVideoMaximumDurationSeconds ||
      !isNativeVideoUploadCapabilityUrl(row.uploadUrl)
    ) {
      throw new NativeVideoUploadClientError("VIDEO_UPLOAD_RESPONSE_INVALID", 500);
    }
    return row as NativeVideoProvisioningSuccess;
  }
  if (status === 202) {
    if (
      !row ||
      !hasExactKeys(row, ["assetId", "code", "message", "status"]) ||
      !isUuid(row.assetId) ||
      typeof row.message !== "string" ||
      !row.message ||
      row.status !== "pending" ||
      (row.code !== "VIDEO_UPLOAD_PENDING" && row.code !== "VIDEO_RECONCILIATION_REQUIRED")
    ) {
      throw new NativeVideoUploadClientError("VIDEO_UPLOAD_RESPONSE_INVALID", 500);
    }
    return row as NativeVideoProvisioningPending;
  }
  throw new NativeVideoUploadClientError("VIDEO_UPLOAD_RESPONSE_INVALID", 500);
}

async function getCurrentAccessToken() {
  const { getSupabaseClient } = await import("@/src/lib/supabaseClient");
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

export async function provisionNativeVideoUpload(
  input: {
    declaredMimeType: string;
    declaredSizeBytes: number;
    expectedDurationSeconds: number;
    filename: string;
    requestId: string;
    tenantId: string;
  },
  options: {
    fetchImpl?: typeof fetch;
    getAccessToken?: () => Promise<string | null>;
    signal?: AbortSignal;
  } = {},
) {
  const accessToken = await (options.getAccessToken ?? getCurrentAccessToken)();
  if (!accessToken) throw new NativeVideoUploadClientError("VIDEO_AUTHENTICATION_REQUIRED", 401);
  const response = await (options.fetchImpl ?? fetch)("/api/video/uploads", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: options.signal,
  });
  const body = await response.json().catch(() => null);
  if (response.status === 200 || response.status === 202) {
    return normalizeProvisioningResponse(body, response.status);
  }
  const row = asRecord(body);
  const code = typeof row?.code === "string" ? row.code : "VIDEO_UPLOAD_CREATION_FAILED";
  throw new NativeVideoUploadClientError(code, response.status);
}

export function getNativeVideoUploadErrorMessage(error: unknown) {
  if (!(error instanceof NativeVideoUploadClientError)) {
    return "Video upload is temporarily unavailable. Please try again.";
  }
  if (error.status === 401) return "Your session has expired. Sign in again.";
  if (error.status === 403) return "Video uploads are not available for this account.";
  if (error.status === 409) return "This upload can no longer continue. Review its status before starting again.";
  if (error.code === "VIDEO_FILE_TYPE_UNSUPPORTED") return "Choose a supported video file.";
  if (error.code === "VIDEO_FILE_SIZE_INVALID") return "Choose a video between 1 byte and 10 GB.";
  if (error.code === "VIDEO_FILENAME_INVALID") return "Choose a video with a valid file name.";
  if (error.code === "VIDEO_DURATION_INVALID") return "Choose a video between 1 second and 2 hours.";
  if (error.code === "VIDEO_DURATION_UNAVAILABLE") return "CoachFort could not read this video's duration.";
  return "Video upload is temporarily unavailable. Please try again.";
}

export function formatNativeVideoFileSize(bytes: number) {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}
