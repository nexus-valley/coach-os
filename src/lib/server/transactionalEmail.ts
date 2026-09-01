import { randomUUID } from "node:crypto";

import {
  CoachFortEmailDeliveryError,
  sendCoachFortTransactionalEmail,
} from "@/src/lib/server/email";
import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";
import { transactionalEmailMaxBatchSize } from "@/src/lib/server/transactionalEmailPolicy";
import { renderTransactionalEmailTemplate } from "@/src/lib/server/transactionalEmailTemplates";

type ClaimedEmail = {
  attempt_number: number;
  claim_token: string;
  event_key: string;
  outbox_id: string;
  recipient_email: string;
  template_key: string;
  template_payload: unknown;
};

type AttemptOutcome =
  | "permanent_failure"
  | "provider_accepted"
  | "suppressed"
  | "transient_failure";

type DrainItemResult = {
  id: string;
  outcome: AttemptOutcome | "failed" | "lease_pending";
};

function safeBatchSize(value?: number) {
  if (!Number.isFinite(value)) {
    return 10;
  }
  return Math.min(Math.max(Math.trunc(value ?? 10), 1), transactionalEmailMaxBatchSize);
}

async function finalizeAttempt(params: {
  claim: ClaimedEmail;
  errorClass?: string | null;
  errorCode?: string | null;
  httpStatus?: number | null;
  outcome: AttemptOutcome;
  providerMessageId?: string | null;
}) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    "finalize_transactional_email_attempt_server",
    {
      p_claim_token: params.claim.claim_token,
      p_error_class: params.errorClass ?? null,
      p_error_code: params.errorCode ?? null,
      p_http_status: params.httpStatus ?? null,
      p_outbox_id: params.claim.outbox_id,
      p_outcome: params.outcome,
      p_provider_message_id: params.providerMessageId ?? null,
    },
  );

  if (error || typeof data !== "string") {
    throw new Error("Unable to finalize transactional email attempt.");
  }

  return data;
}

async function isSuppressed(recipientEmail: string) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    "transactional_email_suppression_state_server",
    { p_recipient_email: recipientEmail },
  );

  if (error) {
    throw new Error("Unable to check transactional email suppression.");
  }

  return data === true;
}

async function isSubscriptionLifecycleReminderCurrent(outboxId: string) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    "subscription_lifecycle_reminder_delivery_is_current_server",
    { p_outbox_id: outboxId },
  );

  if (error || typeof data !== "boolean") {
    throw new CoachFortEmailDeliveryError({
      code: "lifecycle_reminder_validation_unavailable",
      errorClass: "transient",
      message: "Unable to validate subscription lifecycle reminder.",
      retryable: true,
    });
  }

  return data;
}

async function processClaim(claim: ClaimedEmail): Promise<DrainItemResult> {
  try {
    if (
      claim.template_key === "billing.subscription_lifecycle" &&
      !(await isSubscriptionLifecycleReminderCurrent(claim.outbox_id))
    ) {
      await finalizeAttempt({
        claim,
        errorClass: "suppressed",
        errorCode: "obsolete_lifecycle_event",
        outcome: "suppressed",
      });
      return { id: claim.outbox_id, outcome: "suppressed" };
    }

    if (await isSuppressed(claim.recipient_email)) {
      await finalizeAttempt({
        claim,
        errorClass: "suppressed",
        errorCode: "recipient_suppressed",
        outcome: "suppressed",
      });
      return { id: claim.outbox_id, outcome: "suppressed" };
    }

    const template = renderTransactionalEmailTemplate(
      claim.template_key,
      claim.template_payload,
    );
    const result = await sendCoachFortTransactionalEmail({
      email: claim.recipient_email,
      failureMessage: "Unable to deliver transactional email.",
      idempotencyKey: claim.event_key,
      logContext: {
        attemptNumber: claim.attempt_number,
        outboxId: claim.outbox_id,
        template: claim.template_key,
      },
      template,
    });

    if (!result.delivered || !result.providerMessageId) {
      await finalizeAttempt({
        claim,
        errorClass: "configuration",
        errorCode: "provider_not_configured",
        outcome: "permanent_failure",
      });
      return { id: claim.outbox_id, outcome: "permanent_failure" };
    }

    await finalizeAttempt({
      claim,
      outcome: "provider_accepted",
      providerMessageId: result.providerMessageId,
    });
    return { id: claim.outbox_id, outcome: "provider_accepted" };
  } catch (error) {
    const deliveryError =
      error instanceof CoachFortEmailDeliveryError ? error : null;
    const outcome: AttemptOutcome = deliveryError?.retryable
      ? "transient_failure"
      : "permanent_failure";

    try {
      const finalStatus = await finalizeAttempt({
        claim,
        errorClass: deliveryError?.errorClass ?? "permanent",
        errorCode: deliveryError?.code ?? "template_or_worker_error",
        httpStatus: deliveryError?.httpStatus ?? null,
        outcome,
      });
      if (finalStatus === "failed") {
        captureServerException(error, {
          errorCategory: deliveryError?.code ?? "template_or_worker_error",
          operation: "transactional_email_delivery_exhausted",
          outboxId: claim.outbox_id,
          template: claim.template_key,
        });
        return { id: claim.outbox_id, outcome: "failed" };
      }
    } catch (finalizeError) {
      captureServerException(finalizeError, {
        operation: "transactional_email_finalize_failure",
        outboxId: claim.outbox_id,
      });
      return { id: claim.outbox_id, outcome: "lease_pending" };
    }

    captureServerException(error, {
      errorCategory: deliveryError?.code ?? "template_or_worker_error",
      operation: "transactional_email_delivery",
      outboxId: claim.outbox_id,
      template: claim.template_key,
    });
    return { id: claim.outbox_id, outcome };
  }
}

export async function drainTransactionalEmailOutbox(input?: {
  batchSize?: number;
  workerId?: string;
}) {
  const admin = getSupabaseAdminClient();
  const batchSize = safeBatchSize(input?.batchSize);
  const workerId = input?.workerId?.trim() || randomUUID();
  const { data, error } = await admin.rpc(
    "claim_transactional_email_batch_server",
    {
      p_batch_size: batchSize,
      p_lease_seconds: 300,
      p_worker_id: workerId,
    },
  );

  if (error) {
    throw new Error("Unable to claim transactional email work.");
  }

  const claims = Array.isArray(data) ? (data as ClaimedEmail[]) : [];
  const results: DrainItemResult[] = [];

  for (const claim of claims) {
    results.push(await processClaim(claim));
  }

  return {
    claimed: claims.length,
    failed: results.filter(
      (item) => item.outcome === "permanent_failure" || item.outcome === "failed",
    ).length,
    leasePending: results.filter((item) => item.outcome === "lease_pending").length,
    providerAccepted: results.filter(
      (item) => item.outcome === "provider_accepted",
    ).length,
    retryScheduled: results.filter(
      (item) => item.outcome === "transient_failure",
    ).length,
    suppressed: results.filter((item) => item.outcome === "suppressed").length,
  };
}
