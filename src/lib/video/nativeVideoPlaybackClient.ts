export type NativePlaybackDescriptor = {
  durationSeconds: number;
  lessonId: string;
  playback: {
    expiresAt: string;
    kind: "native_video";
    mode: "iframe";
    url: string;
  };
};

export class NativePlaybackRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Native video playback request failed.");
    this.name = "NativePlaybackRequestError";
    this.status = status;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isStreamIframeUrl(value: unknown) {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^customer-[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?\.(?:cloudflarestream\.com|videodelivery\.net)$/i.test(
        host,
      ) &&
      /^\/[^/]+\/iframe$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function parseNativePlaybackDescriptor(
  value: unknown,
  expectedLessonId: string,
  nowMilliseconds = Date.now(),
): NativePlaybackDescriptor | null {
  const row = asRecord(value);
  const playback = asRecord(row?.playback);
  const expiresAt =
    typeof playback?.expiresAt === "string" ? playback.expiresAt : "";
  const expiresAtMilliseconds = Date.parse(expiresAt);

  if (
    !row ||
    row.lessonId !== expectedLessonId ||
    !Number.isSafeInteger(row.durationSeconds) ||
    Number(row.durationSeconds) < 1 ||
    Number(row.durationSeconds) > 7_200 ||
    playback?.kind !== "native_video" ||
    playback.mode !== "iframe" ||
    !isStreamIframeUrl(playback.url) ||
    !Number.isFinite(expiresAtMilliseconds) ||
    expiresAtMilliseconds <= nowMilliseconds
  ) {
    return null;
  }

  return {
    durationSeconds: Number(row.durationSeconds),
    lessonId: expectedLessonId,
    playback: {
      expiresAt,
      kind: "native_video",
      mode: "iframe",
      url: playback.url as string,
    },
  };
}

export function getNativePlaybackErrorState(status: number) {
  if (status === 401) {
    return {
      message: "Your session has expired. Sign in again.",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      message: "Video playback is not available for your account.",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      message: "No video has been added to this lesson.",
      retryable: false,
    };
  }
  if (status === 409) {
    return {
      message: "This video is still processing or temporarily unavailable.",
      retryable: true,
    };
  }
  return {
    message: "Video playback is temporarily unavailable.",
    retryable: true,
  };
}

type PlaybackRequestOptions = {
  fetchImpl?: typeof fetch;
  getAccessToken: () => Promise<string | null>;
  nowMilliseconds?: number;
  signal?: AbortSignal;
};

export async function requestNativeLessonPlayback(
  input: { lessonId: string; tenantId: string },
  options: PlaybackRequestOptions,
) {
  const accessToken = await options.getAccessToken();
  if (!accessToken) throw new NativePlaybackRequestError(401);

  const response = await (options.fetchImpl ?? fetch)(
    `/api/video/lessons/${encodeURIComponent(input.lessonId)}/playback`,
    {
      body: JSON.stringify({ tenantId: input.tenantId }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: options.signal,
    },
  );

  if (!response.ok) throw new NativePlaybackRequestError(response.status);

  const payload = await response.json().catch(() => null);
  const descriptor = parseNativePlaybackDescriptor(
    payload,
    input.lessonId,
    options.nowMilliseconds,
  );
  if (!descriptor) throw new NativePlaybackRequestError(500);
  return descriptor;
}
