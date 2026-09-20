import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

import { getCloudflareStreamFrameSources } from "./src/lib/server/video/cloudflareStreamConfig";

const frameSources = [
  "'self'",
  ...getCloudflareStreamFrameSources(),
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
];
const contentSecurityPolicy = `frame-src ${frameSources.join(" ")};`;

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
        ],
        source: "/(.*)",
      },
    ];
  },
};

const sentrySourceMapUploadConfigured = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT,
);

export default sentrySourceMapUploadConfigured
  ? withSentryConfig(nextConfig, {
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disableLogger: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      telemetry: false,
      widenClientFileUpload: false,
      sourcemaps: {
        deleteSourcemapsAfterUpload: true,
      },
    })
  : nextConfig;
