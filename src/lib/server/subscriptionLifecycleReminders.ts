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

export const subscriptionLifecycleReminderEventTypes = [
  "trial_ending",
  "trial_expired",
  "renewal_due_soon",
  "grace_started",
  "grace_ending",
  "subscription_expired",
] as const;

export type SubscriptionLifecycleReminderEvent =
  (typeof subscriptionLifecycleReminderEventTypes)[number];

export type SubscriptionLifecycleReminderTarget = {
  tenantId: string;
  event: SubscriptionLifecycleReminderEvent;
};

type ProcessFunction = (input: {
  dryRun: boolean;
  target: SubscriptionLifecycleReminderTarget | null;
}) => Promise<SubscriptionLifecycleReminderSummary>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTarget(searchParams: URLSearchParams) {
  const tenantIds = searchParams.getAll("tenantId");
  const events = searchParams.getAll("event");

  if (tenantIds.length === 0 && events.length === 0) {
    return { valid: true as const, target: null };
  }

  if (
    tenantIds.length !== 1 ||
    events.length !== 1 ||
    !uuidPattern.test(tenantIds[0] ?? "") ||
    !subscriptionLifecycleReminderEventTypes.includes(
      events[0] as SubscriptionLifecycleReminderEvent,
    )
  ) {
    return { valid: false as const };
  }

  return {
    valid: true as const,
    target: {
      tenantId: tenantIds[0],
      event: events[0] as SubscriptionLifecycleReminderEvent,
    },
  };
}

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
  target: SubscriptionLifecycleReminderTarget | null;
}) {
  const admin = getSupabaseAdminClient();
  const rpcArguments = input.target
    ? {
        p_dry_run: input.dryRun,
        p_limit: 500,
        p_target_event_type: input.target.event,
        p_target_tenant_id: input.target.tenantId,
      }
    : {
        p_dry_run: input.dryRun,
        p_limit: 500,
      };
  const { data, error } = await admin.rpc(
    "enqueue_subscription_lifecycle_reminders_server",
    rpcArguments,
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

  const searchParams = new URL(request.url).searchParams;
  const targetResult = parseTarget(searchParams);
  if (!targetResult.valid) {
    return Response.json({ message: "Invalid reminder target." }, { status: 400 });
  }

  const dryRun = searchParams.get("dryRun") === "true";
  try {
    const summary = await (options?.process ?? processSubscriptionLifecycleReminders)({
      dryRun,
      target: targetResult.target,
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
