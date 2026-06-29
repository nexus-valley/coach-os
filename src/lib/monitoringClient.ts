"use client";

import * as Sentry from "@sentry/nextjs";

import { scrubMonitoringValue } from "@/src/lib/monitoring";

export function captureClientException(
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
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
