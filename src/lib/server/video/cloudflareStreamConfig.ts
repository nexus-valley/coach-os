export type CloudflareStreamConfigurationState = {
  uploadConfigured: boolean;
  webhookConfigured: boolean;
};

export type CloudflareStreamUploadConfig = {
  accountId: string;
  apiToken: string;
};

export class CloudflareStreamConfigurationError extends Error {
  constructor() {
    super("Video uploads are not configured.");
    this.name = "CloudflareStreamConfigurationError";
  }
}

type ServerEnvironment = Record<string, string | undefined>;

function configuredValue(value: string | undefined) {
  return value?.trim() ?? "";
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
