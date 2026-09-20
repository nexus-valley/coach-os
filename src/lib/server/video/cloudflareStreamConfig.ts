export type CloudflareStreamConfigurationState = {
  uploadConfigured: boolean;
  webhookConfigured: boolean;
};

export type CloudflareStreamUploadConfig = {
  accountId: string;
  apiToken: string;
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
  return {
    uploadConfigured: Boolean(
      configuredValue(environment.CLOUDFLARE_ACCOUNT_ID) &&
        configuredValue(environment.CLOUDFLARE_STREAM_API_TOKEN),
    ),
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
