import * as Sentry from "@sentry/nextjs";

import { scrubMonitoringValue } from "@/src/lib/monitoring";

export function isServerMonitoringEnabled() {
  return Boolean(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN);
}

export function captureServerException(
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (!isServerMonitoringEnabled()) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext(
        "coachfort",
        scrubMonitoringValue(context) as Record<string, unknown>,
      );
    }

    Sentry.captureException(error);
  });
}

export function captureServerMessage(
  message: string,
  context?: Record<string, unknown>,
) {
  if (!isServerMonitoringEnabled()) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext(
        "coachfort",
        scrubMonitoringValue(context) as Record<string, unknown>,
      );
    }

    Sentry.captureMessage(message);
  });
}
