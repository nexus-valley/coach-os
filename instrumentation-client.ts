import * as Sentry from "@sentry/nextjs";

import { getMonitoringEnvironment, scrubSentryEvent } from "@/src/lib/monitoring";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    beforeSend: scrubSentryEvent,
    debug: false,
    dsn,
    environment: getMonitoringEnvironment(),
    maxBreadcrumbs: 30,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
    tracesSampleRate: 0.02,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
