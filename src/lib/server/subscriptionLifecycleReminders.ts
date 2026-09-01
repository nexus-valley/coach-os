import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import { hasMatchingBearerSecret } from "@/src/lib/server/transactionalEmailDrain";

export type SubscriptionLifecycleReminderSummary = {
  dryRun: boolean;
  eligibleEvents: number;
  emailDeliveriesCreated: number;
  inAppDeliveriesCreated: number;
  recipientUsers: number;
  replayedEmailDeliveries: number;
  replayedInAppDeliveries: number;
  uniqueEmailRecipients: number;
};

type ProcessFunction = (input: {
  dryRun: boolean;
}) => Promise<SubscriptionLifecycleReminderSummary>;

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSummary(
  value: unknown,
  dryRun: boolean,
): SubscriptionLifecycleReminderSummary {
  const row = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  return {
    dryRun,
    eligibleEvents: numberValue(row.eligible_events),
    emailDeliveriesCreated: numberValue(row.email_deliveries_created),
    inAppDeliveriesCreated: numberValue(row.in_app_deliveries_created),
    recipientUsers: numberValue(row.recipient_users),
    replayedEmailDeliveries: numberValue(row.replayed_email_deliveries),
    replayedInAppDeliveries: numberValue(row.replayed_in_app_deliveries),
    uniqueEmailRecipients: numberValue(row.unique_email_recipients),
  };
}

export async function processSubscriptionLifecycleReminders(input: {
  dryRun: boolean;
}) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    "enqueue_subscription_lifecycle_reminders_server",
    {
      p_dry_run: input.dryRun,
      p_limit: 500,
    },
  );

  if (error) {
    throw new Error("Unable to process subscription lifecycle reminders.");
  }

  return normalizeSummary(data, input.dryRun);
}

export async function handleSubscriptionLifecycleReminderRequest(
  request: Request,
  options?: {
    configuredSecret?: string;
    process?: ProcessFunction;
  },
) {
  if (
    !hasMatchingBearerSecret(
      request,
      options?.configuredSecret ?? process.env.CRON_SECRET,
      32,
    )
  ) {
    return Response.json({ message: "Not found." }, { status: 404 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  try {
    const summary = await (options?.process ?? processSubscriptionLifecycleReminders)({
      dryRun,
    });
    return Response.json(summary);
  } catch (error) {
    captureServerException(error, {
      operation: "subscription_lifecycle_reminder_processing",
      route: "/api/internal/subscription-lifecycle/reminders",
    });
    return Response.json(
      { message: "Subscription reminder processing is temporarily unavailable." },
      { status: 503 },
    );
  }
}
