export type CloudflareStreamConfigurationState = {
  uploadConfigured: boolean;
  webhookConfigured: boolean;
};

export type CloudflareStreamUploadConfig = {
  accountId: string;
  apiToken: string;
};

export type CloudflareStreamAllowedOriginsConfig = {
  allowedOrigins: string[];
  allowLocalhost: boolean;
};

export type CloudflareStreamPlaybackConfig = CloudflareStreamUploadConfig & {
  customerCode: string;
};

export type CloudflareStreamWebhookConfig = {
  signingSecret: string;
};

export class CloudflareStreamConfigurationError extends Error {
  constructor() {
    super("Video uploads are not configured.");
    this.name = "CloudflareStreamConfigurationError";
  }
}

export class CloudflareStreamWebhookConfigurationError extends Error {
  constructor() {
    super("Video webhook is not configured.");
    this.name = "CloudflareStreamWebhookConfigurationError";
  }
}

export class CloudflareStreamPlaybackConfigurationError extends Error {
  constructor() {
    super("Video playback is not configured.");
    this.name = "CloudflareStreamPlaybackConfigurationError";
  }
}

type ServerEnvironment = Record<string, string | undefined>;

function configuredValue(value: string | undefined) {
  return value?.trim() ?? "";
}

const domainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeCloudflareStreamAllowedOriginEntries(
  values: readonly string[],
  options: { allowLocalhost?: boolean } = {},
) {
  if (values.length === 0 || values.length > 16) {
    throw new CloudflareStreamConfigurationError();
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (
      typeof value !== "string" ||
      !value ||
      value !== value.trim() ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new CloudflareStreamConfigurationError();
    }

    const origin = value.toLowerCase();
    if (origin === "localhost:3000") {
      if (!options.allowLocalhost) {
        throw new CloudflareStreamConfigurationError();
      }
    } else {
      if (
        origin.length > 253 ||
        !origin.includes(".") ||
        origin.endsWith(".") ||
        /[^\x00-\x7f]/.test(origin) ||
        /[:/?#@*]/.test(origin) ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(origin)
      ) {
        throw new CloudflareStreamConfigurationError();
      }

      const labels = origin.split(".");
      if (
        labels.some(
          (label) =>
            !domainLabelPattern.test(label) || label.startsWith("xn--"),
        )
      ) {
        throw new CloudflareStreamConfigurationError();
      }
    }

    if (seen.has(origin)) {
      throw new CloudflareStreamConfigurationError();
    }
    seen.add(origin);
    normalized.push(origin);
  }

  return normalized.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function getCloudflareStreamAllowedOriginsConfig(
  environment: ServerEnvironment = process.env,
): CloudflareStreamAllowedOriginsConfig {
  const allowLocalhost = environment.NODE_ENV === "development";
  const configuredOrigins = configuredValue(
    environment.CLOUDFLARE_STREAM_ALLOWED_ORIGINS,
  );
  if (!configuredOrigins) {
    throw new CloudflareStreamConfigurationError();
  }

  return {
    allowedOrigins: normalizeCloudflareStreamAllowedOriginEntries(
      configuredOrigins.split(","),
      { allowLocalhost },
    ),
    allowLocalhost,
  };
}

export function normalizeCloudflareStreamCustomerCode(
  value: string | undefined,
) {
  const customerCode = configuredValue(value);
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,126}[A-Za-z0-9])?$/.test(
    customerCode,
  )
    ? customerCode
    : null;
}

export function getCloudflareStreamFrameSources(
  environment: ServerEnvironment = process.env,
) {
  const configuredCustomerCode = configuredValue(
    environment.CLOUDFLARE_STREAM_CUSTOMER_CODE,
  );

  if (!configuredCustomerCode) return [];

  const customerCode = normalizeCloudflareStreamCustomerCode(
    configuredCustomerCode,
  );
  if (!customerCode) {
    throw new CloudflareStreamPlaybackConfigurationError();
  }

  return [
    `https://customer-${customerCode}.cloudflarestream.com`,
    `https://customer-${customerCode}.videodelivery.net`,
  ];
}

export function getCloudflareStreamConfigurationState(
  environment: ServerEnvironment = process.env,
): CloudflareStreamConfigurationState {
  let uploadConfigured = false;
  try {
    getCloudflareStreamUploadConfig(environment);
    getCloudflareStreamAllowedOriginsConfig(environment);
    uploadConfigured = true;
  } catch {
    uploadConfigured = false;
  }

  return {
    uploadConfigured,
    webhookConfigured: Boolean(
      configuredValue(environment.CLOUDFLARE_STREAM_WEBHOOK_SECRET),
    ),
  };
}

export function getCloudflareStreamUploadConfig(
  environment: ServerEnvironment = process.env,
): CloudflareStreamUploadConfig {
  const accountId = configuredValue(environment.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = configuredValue(environment.CLOUDFLARE_STREAM_API_TOKEN);

  if (!accountId || !apiToken || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
    throw new CloudflareStreamConfigurationError();
  }

  return { accountId, apiToken };
}

export function getCloudflareStreamPlaybackConfig(
  environment: ServerEnvironment = process.env,
): CloudflareStreamPlaybackConfig {
  let uploadConfig: CloudflareStreamUploadConfig;
  try {
    uploadConfig = getCloudflareStreamUploadConfig(environment);
  } catch {
    throw new CloudflareStreamPlaybackConfigurationError();
  }

  const customerCode = normalizeCloudflareStreamCustomerCode(
    environment.CLOUDFLARE_STREAM_CUSTOMER_CODE,
  );
  if (!customerCode) {
    throw new CloudflareStreamPlaybackConfigurationError();
  }

  return { ...uploadConfig, customerCode };
}

export function getCloudflareStreamWebhookConfig(
  environment: ServerEnvironment = process.env,
): CloudflareStreamWebhookConfig {
  const signingSecret = configuredValue(
    environment.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
  );

  if (!signingSecret) {
    throw new CloudflareStreamWebhookConfigurationError();
  }

  return { signingSecret };
}
