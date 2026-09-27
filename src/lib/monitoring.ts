const redacted = "[redacted]";
const maxStringLength = 600;
const maxArrayLength = 25;
const maxDepth = 5;
const nativeVideoUploadCapabilityPlaceholder = "[native-video-upload-capability]";
const nativeVideoUploadCapabilityPattern =
  /https:\/\/upload\.cloudflarestream\.com\/tus(?:\/|\?)[^\s"'<>]*/gi;
export const nativeVideoUploadCapabilitySpanPattern =
  /https:\/\/upload\.cloudflarestream\.com\/tus(?:\/|\?)/i;

const sensitiveKeyPattern =
  /(password|passcode|secret|token|authorization|cookie|otp|code|service.?role|signed.?url|storage_path|storage_bucket|payment_reference|payment.?id|card|cvv|otp_hash|reset.?token|access.?token|refresh.?token|file.?content)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNativeVideoUploadCapabilityUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "upload.cloudflarestream.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.pathname === "/tus" || url.pathname.startsWith("/tus/"))
    );
  } catch {
    return false;
  }
}

export function scrubNativeVideoUploadCapabilities(value: string) {
  if (isNativeVideoUploadCapabilityUrl(value)) {
    return nativeVideoUploadCapabilityPlaceholder;
  }
  nativeVideoUploadCapabilityPattern.lastIndex = 0;
  return value.replace(
    nativeVideoUploadCapabilityPattern,
    nativeVideoUploadCapabilityPlaceholder,
  );
}

export function getMonitoringEnvironment() {
  return (
    process.env.NEXT_PUBLIC_APP_ENV ??
    process.env.SENTRY_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    "development"
  );
}

export function scrubMonitoringValue(value: unknown, depth = 0): unknown {
  if (depth > maxDepth) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    const scrubbedValue = scrubNativeVideoUploadCapabilities(value);
    return scrubbedValue.length > maxStringLength
      ? `${scrubbedValue.slice(0, maxStringLength)}...[truncated]`
      : scrubbedValue;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayLength)
      .map((item) => scrubMonitoringValue(item, depth + 1));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key)
        ? redacted
        : scrubMonitoringValue(entry, depth + 1),
    ]),
  );
}

export function scrubSentryBreadcrumb<T>(breadcrumb: T): T | null {
  return scrubMonitoringValue(breadcrumb) as T;
}

export function scrubSentrySpan<T>(span: T): T {
  return scrubMonitoringValue(span) as T;
}

type ScrubbableSentryEvent = {
  contexts?: unknown;
  extra?: unknown;
  request?: {
    cookies?: unknown;
    headers?: unknown;
    query_string?: unknown;
  };
  user?: {
    email?: unknown;
    id?: string;
    ip_address?: unknown;
    username?: unknown;
  };
};

export function scrubSentryEvent<T>(event: T): T {
  const scrubbed = scrubMonitoringValue(event) as T & ScrubbableSentryEvent;

  if (scrubbed.user) {
    scrubbed.user = {
      id: scrubbed.user.id,
    };
  }

  if (scrubbed.request) {
    scrubbed.request.cookies = undefined;
    scrubbed.request.query_string = undefined;
    scrubbed.request.headers = scrubMonitoringValue(scrubbed.request.headers);
  }

  scrubbed.extra = scrubMonitoringValue(scrubbed.extra);
  scrubbed.contexts = scrubMonitoringValue(scrubbed.contexts);

  return scrubbed as T;
}

export function getSafeReleaseId() {
  const release =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA;

  return release ? release.slice(0, 12) : undefined;
}
