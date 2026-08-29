import { randomUUID } from "node:crypto";

import { captureServerException } from "@/src/lib/server/monitoring";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

type FulfillmentOutcome =
  | "blocked_prerequisite"
  | "completed"
  | "lease_pending"
  | "manual_review"
  | "retryable";

type FinalizeOutcome =
  | "blocked_prerequisite"
  | "completed"
  | "invoice_issued"
  | "manual_review"
  | "retryable";

export type PlatformBillingFulfillmentClaim = {
  activation_event_id: string;
  attempt_number: number;
  claim_token: string;
  fulfillment_id: string;
  invoice_id: string | null;
  payment_attempt_id: string;
  payment_order_id: string;
  receipt_id: string | null;
  subscription_assignment_id: string;
};

export type PlatformBillingFulfillmentFailure = {
  errorClass: "configuration" | "conflict" | "permanent" | "transient";
  errorCode: string;
  outcome: "blocked_prerequisite" | "manual_review" | "retryable";
};

type FinalizeInput = {
  claim: PlatformBillingFulfillmentClaim;
  errorClass?: PlatformBillingFulfillmentFailure["errorClass"];
  errorCode?: string;
  invoiceId?: string | null;
  outcome: FinalizeOutcome;
  receiptId?: string | null;
};

export type PlatformBillingFulfillmentOperations = {
  claim(input: {
    batchSize: number;
    leaseSeconds: number;
    workerId: string;
  }): Promise<PlatformBillingFulfillmentClaim[]>;
  discover(batchSize: number): Promise<number>;
  finalize(input: FinalizeInput): Promise<string>;
  issueInvoice(activationEventId: string): Promise<string>;
  issueReceipt(fulfillmentId: string): Promise<string>;
};

type RpcErrorShape = {
  code?: unknown;
  message?: unknown;
};

class PlatformBillingFulfillmentOperationError extends Error {
  readonly classification: PlatformBillingFulfillmentFailure;

  constructor(
    message: string,
    classification: PlatformBillingFulfillmentFailure,
  ) {
    super(message);
    this.name = "PlatformBillingFulfillmentOperationError";
    this.classification = classification;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { code: "", message: "" };
  }

  const candidate = error as RpcErrorShape;
  return {
    code: typeof candidate.code === "string" ? candidate.code.toUpperCase() : "",
    message:
      typeof candidate.message === "string"
        ? candidate.message.toLowerCase()
        : "",
  };
}

export function classifyPlatformBillingFulfillmentError(
  error: unknown,
): PlatformBillingFulfillmentFailure {
  if (error instanceof PlatformBillingFulfillmentOperationError) {
    return error.classification;
  }

  const { code, message } = errorDetails(error);

  if (
    code === "23505" ||
    code === "23514" ||
    /conflict|does not match|mismatch|immutable|unsafe authority|source key/.test(
      message,
    )
  ) {
    return {
      errorClass: "conflict",
      errorCode: "billing_authority_conflict",
      outcome: "manual_review",
    };
  }

  if (
    code === "55000" ||
    code === "42501" ||
    code === "PGRST202" ||
    /not configured|configuration|prerequisite|incomplete|missing|required/.test(
      message,
    )
  ) {
    return {
      errorClass: "configuration",
      errorCode: "billing_prerequisite_unavailable",
      outcome: "blocked_prerequisite",
    };
  }

  if (
    code.startsWith("08") ||
    ["40001", "40P01", "53300", "57014", "57P01"].includes(code) ||
    /network|timeout|temporar|connection|fetch failed/.test(message)
  ) {
    return {
      errorClass: "transient",
      errorCode: "billing_processing_transient",
      outcome: "retryable",
    };
  }

  if (code === "22023") {
    return {
      errorClass: "permanent",
      errorCode: "billing_authority_invalid",
      outcome: "manual_review",
    };
  }

  return {
    errorClass: "transient",
    errorCode: "billing_processing_unavailable",
    outcome: "retryable",
  };
}

function operationError(message: string, error: unknown) {
  return new PlatformBillingFulfillmentOperationError(
    message,
    classifyPlatformBillingFulfillmentError(error),
  );
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value ?? fallback), minimum), maximum);
}

function requiredUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`Fulfillment ${label} is invalid.`);
  }

  return value;
}

function optionalUuid(value: unknown, label: string) {
  if (value === null || value === undefined) {
    return null;
  }

  return requiredUuid(value, label);
}

function normalizeClaim(value: unknown): PlatformBillingFulfillmentClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fulfillment claim is invalid.");
  }

  const row = value as Record<string, unknown>;
  const attemptNumber = row.attempt_number;
  if (!Number.isSafeInteger(attemptNumber) || Number(attemptNumber) < 1) {
    throw new Error("Fulfillment attempt number is invalid.");
  }

  return {
    activation_event_id: requiredUuid(
      row.activation_event_id,
      "activation event",
    ),
    attempt_number: Number(attemptNumber),
    claim_token: requiredUuid(row.claim_token, "claim token"),
    fulfillment_id: requiredUuid(row.fulfillment_id, "identity"),
    invoice_id: optionalUuid(row.invoice_id, "invoice identity"),
    payment_attempt_id: requiredUuid(
      row.payment_attempt_id,
      "payment attempt",
    ),
    payment_order_id: requiredUuid(row.payment_order_id, "payment order"),
    receipt_id: optionalUuid(row.receipt_id, "receipt identity"),
    subscription_assignment_id: requiredUuid(
      row.subscription_assignment_id,
      "subscription assignment",
    ),
  };
}

function createDatabaseOperations(): PlatformBillingFulfillmentOperations {
  return {
    async claim(input) {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.rpc(
        "claim_platform_billing_document_fulfillments_server",
        {
          p_batch_size: input.batchSize,
          p_lease_seconds: input.leaseSeconds,
          p_worker_id: input.workerId,
        },
      );

      if (error) {
        throw operationError("Unable to claim billing document work.", error);
      }

      return Array.isArray(data) ? data.map(normalizeClaim) : [];
    },

    async discover(batchSize) {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.rpc(
        "discover_platform_billing_document_fulfillments_server",
        { p_batch_size: batchSize },
      );

      if (error) {
        throw operationError("Unable to discover billing document work.", error);
      }

      return Array.isArray(data) ? data.length : 0;
    },

    async finalize(input) {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.rpc(
        "finalize_platform_billing_document_fulfillment_server",
        {
          p_claim_token: input.claim.claim_token,
          p_error_class: input.errorClass ?? null,
          p_error_code: input.errorCode ?? null,
          p_fulfillment_id: input.claim.fulfillment_id,
          p_invoice_id: input.invoiceId ?? null,
          p_outcome: input.outcome,
          p_receipt_id: input.receiptId ?? null,
        },
      );

      if (error || typeof data !== "string") {
        throw operationError(
          "Unable to finalize billing document work.",
          error ?? { code: "", message: "Invalid finalization response." },
        );
      }

      return data;
    },

    async issueInvoice(activationEventId) {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.rpc(
        "issue_platform_invoice_for_activation_server",
        { p_activation_event_id: activationEventId },
      );

      if (error) {
        throw operationError("Unable to issue platform invoice.", error);
      }

      return requiredUuid(data, "invoice result");
    },

    async issueReceipt(fulfillmentId) {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.rpc(
        "issue_platform_receipt_for_fulfillment_server",
        { p_fulfillment_id: fulfillmentId },
      );

      if (error) {
        throw operationError("Unable to issue platform receipt.", error);
      }

      return requiredUuid(data, "receipt result");
    },
  };
}

async function processClaim(
  claim: PlatformBillingFulfillmentClaim,
  operations: PlatformBillingFulfillmentOperations,
): Promise<FulfillmentOutcome> {
  let invoiceId = claim.invoice_id;
  let receiptId = claim.receipt_id;

  try {
    if (!invoiceId) {
      invoiceId = await operations.issueInvoice(claim.activation_event_id);
      const invoiceProgress = await operations.finalize({
        claim,
        invoiceId,
        outcome: "invoice_issued",
      });
      if (invoiceProgress !== "processing") {
        throw new Error("Billing invoice progress was not persisted safely.");
      }
    }

    if (!receiptId) {
      receiptId = await operations.issueReceipt(claim.fulfillment_id);
    }

    const completion = await operations.finalize({
      claim,
      invoiceId,
      outcome: "completed",
      receiptId,
    });
    if (completion !== "completed") {
      throw new Error("Billing document completion was not persisted safely.");
    }

    return "completed";
  } catch (error) {
    const failure = classifyPlatformBillingFulfillmentError(error);

    try {
      const finalStatus = await operations.finalize({
        claim,
        errorClass: failure.errorClass,
        errorCode: failure.errorCode,
        invoiceId,
        outcome: failure.outcome,
        receiptId,
      });

      captureServerException(error, {
        attemptNumber: claim.attempt_number,
        errorCategory: failure.errorCode,
        fulfillmentId: claim.fulfillment_id,
        operation: "platform_billing_fulfillment_process",
      });

      if (finalStatus === "manual_review") {
        return "manual_review";
      }

      return failure.outcome;
    } catch (finalizeError) {
      captureServerException(finalizeError, {
        errorCategory: failure.errorCode,
        fulfillmentId: claim.fulfillment_id,
        operation: "platform_billing_fulfillment_finalize_failure",
      });
      return "lease_pending";
    }
  }
}

export async function drainPlatformBillingDocumentFulfillments(
  input?: {
    batchSize?: number;
    discoveryBatchSize?: number;
    leaseSeconds?: number;
    workerId?: string;
  },
  operations: PlatformBillingFulfillmentOperations = createDatabaseOperations(),
) {
  const batchSize = boundedInteger(input?.batchSize, 5, 1, 25);
  const discoveryBatchSize = boundedInteger(
    input?.discoveryBatchSize,
    25,
    1,
    250,
  );
  const leaseSeconds = boundedInteger(input?.leaseSeconds, 300, 30, 900);
  const workerId = input?.workerId?.trim() || `billing:${randomUUID()}`;

  if (workerId.length > 100) {
    throw new Error("Billing fulfillment worker identity is invalid.");
  }

  const discovered = await operations.discover(discoveryBatchSize);
  const claims = await operations.claim({ batchSize, leaseSeconds, workerId });
  const outcomes: FulfillmentOutcome[] = [];

  for (const claim of claims) {
    outcomes.push(await processClaim(claim, operations));
  }

  return {
    blockedPrerequisite: outcomes.filter(
      (outcome) => outcome === "blocked_prerequisite",
    ).length,
    claimed: claims.length,
    completed: outcomes.filter((outcome) => outcome === "completed").length,
    discovered,
    leasePending: outcomes.filter((outcome) => outcome === "lease_pending")
      .length,
    manualReview: outcomes.filter((outcome) => outcome === "manual_review")
      .length,
    retryScheduled: outcomes.filter((outcome) => outcome === "retryable")
      .length,
  };
}
