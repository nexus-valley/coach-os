import * as Sentry from "@sentry/nextjs";

import {
  getMonitoringEnvironment,
  nativeVideoUploadCapabilitySpanPattern,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
} from "@/src/lib/monitoring";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    beforeBreadcrumb: scrubSentryBreadcrumb,
    beforeSend: scrubSentryEvent,
    beforeSendSpan: scrubSentrySpan,
    debug: false,
    dsn,
    environment: getMonitoringEnvironment(),
    ignoreSpans: [nativeVideoUploadCapabilitySpanPattern],
    maxBreadcrumbs: 30,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
    tracePropagationTargets: [
      /^\/(?!\/)/,
      /^https:\/\/(?:www\.)?coachfort\.com(?:\/|$)/,
    ],
    tracesSampleRate: 0.02,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
