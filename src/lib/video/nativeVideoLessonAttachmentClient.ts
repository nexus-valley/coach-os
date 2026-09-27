export type NativeVideoLessonAssetStatus =
  | "upload_pending"
  | "processing"
  | "ready"
  | "failed"
  | "delete_pending"
  | "deleted";

export type NativeVideoLessonState = {
  attachment: null | {
    assetId: string;
    attachedAt: string;
    durationSeconds: number | null;
    filename: string;
    status: NativeVideoLessonAssetStatus;
  };
  lessonId: string;
};

type RequestOptions = {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
  signal?: AbortSignal;
};

export class NativeVideoLessonRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Native video lesson request failed.");
    this.name = "NativeVideoLessonRequestError";
    this.status = status;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const statuses = new Set<NativeVideoLessonAssetStatus>([
  "upload_pending",
  "processing",
  "ready",
  "failed",
  "delete_pending",
  "deleted",
]);

function hasExactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    actual.length === expectedKeys.length &&
    actual.every((key, index) => key === expectedKeys[index])
  );
}

function invalidResponse(): never {
  throw new NativeVideoLessonRequestError(500);
}

export function normalizeNativeVideoLessonState(
  value: unknown,
  expectedLessonId: string,
): NativeVideoLessonState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidResponse();
  }

  const row = value as Record<string, unknown>;
  if (!hasExactKeys(row, ["attachment", "lessonId"])) invalidResponse();

  const lessonId =
    typeof row.lessonId === "string" ? row.lessonId.toLowerCase() : "";
  if (!uuidPattern.test(lessonId) || lessonId !== expectedLessonId.toLowerCase()) {
    invalidResponse();
  }

  if (row.attachment === null) return { attachment: null, lessonId };
  if (
    !row.attachment ||
    typeof row.attachment !== "object" ||
    Array.isArray(row.attachment)
  ) {
    invalidResponse();
  }

  const attachment = row.attachment as Record<string, unknown>;
  if (
    !hasExactKeys(attachment, [
      "assetId",
      "attachedAt",
      "durationSeconds",
      "filename",
      "status",
    ])
  ) {
    invalidResponse();
  }

  const assetId =
    typeof attachment.assetId === "string"
      ? attachment.assetId.toLowerCase()
      : "";
  const attachedAt =
    typeof attachment.attachedAt === "string" ? attachment.attachedAt : "";
  const durationSeconds = attachment.durationSeconds;
  const filename =
    typeof attachment.filename === "string" ? attachment.filename : "";
  const status = attachment.status;

  if (
    !uuidPattern.test(assetId) ||
    !attachedAt ||
    !Number.isFinite(Date.parse(attachedAt)) ||
    filename.length < 1 ||
    filename.length > 255 ||
    typeof status !== "string" ||
    !statuses.has(status as NativeVideoLessonAssetStatus) ||
    !(
      durationSeconds === null ||
      (Number.isInteger(durationSeconds) &&
        (durationSeconds as number) >= 1 &&
        (durationSeconds as number) <= 7200)
    )
  ) {
    invalidResponse();
  }

  return {
    attachment: {
      assetId,
      attachedAt,
      durationSeconds: durationSeconds as number | null,
      filename,
      status: status as NativeVideoLessonAssetStatus,
    },
    lessonId,
  };
}

async function getCurrentAccessToken() {
  const { getSupabaseClient } = await import("@/src/lib/supabaseClient");
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new NativeVideoLessonRequestError(401);
  return data.session?.access_token ?? null;
}

async function requestState(
  path: string,
  lessonId: string,
  init: RequestInit,
  options: RequestOptions,
) {
  const accessToken = await (options.getAccessToken ?? getCurrentAccessToken)();
  if (!accessToken) throw new NativeVideoLessonRequestError(401);

  const response = await (options.fetchImpl ?? fetch)(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
    signal: options.signal,
  });
  if (!response.ok) throw new NativeVideoLessonRequestError(response.status);

  const body = await response.json().catch(invalidResponse);
  return normalizeNativeVideoLessonState(body, lessonId);
}

function lessonPath(lessonId: string) {
  return `/api/video/lessons/${encodeURIComponent(lessonId)}/native-video`;
}

export function getNativeVideoLessonState(
  input: { lessonId: string; tenantId: string },
  options: RequestOptions = {},
) {
  const query = new URLSearchParams({ tenantId: input.tenantId });
  return requestState(
    `${lessonPath(input.lessonId)}?${query.toString()}`,
    input.lessonId,
    { method: "GET" },
    options,
  );
}

export function putNativeVideoLessonAttachment(
  input: { assetId: string; lessonId: string; tenantId: string },
  options: RequestOptions = {},
) {
  return requestState(
    lessonPath(input.lessonId),
    input.lessonId,
    {
      body: JSON.stringify({ assetId: input.assetId, tenantId: input.tenantId }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
    options,
  );
}

export function deleteNativeVideoLessonAttachment(
  input: { lessonId: string; tenantId: string },
  options: RequestOptions = {},
) {
  return requestState(
    lessonPath(input.lessonId),
    input.lessonId,
    {
      body: JSON.stringify({ tenantId: input.tenantId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    },
    options,
  );
}

export function getNativeVideoLessonErrorMessage(status: number) {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You do not have permission to manage this lesson video.";
  if (status === 404) return "This lesson is no longer available.";
  if (status === 409) {
    return "The selected video cannot be attached in its current state. Refresh and try again.";
  }
  return "Lesson video details are temporarily unavailable. Please try again.";
}
