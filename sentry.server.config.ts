import * as Sentry from "@sentry/nextjs";

import {
  getMonitoringEnvironment,
  getSafeReleaseId,
  scrubSentryEvent,
} from "@/src/lib/monitoring";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    beforeSend: scrubSentryEvent,
    debug: false,
    dsn,
    environment: getMonitoringEnvironment(),
    maxBreadcrumbs: 30,
    release: getSafeReleaseId(),
    sendDefaultPii: false,
    tracesSampleRate: 0.02,
  });
}
