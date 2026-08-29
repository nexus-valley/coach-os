import { captureServerException } from "@/src/lib/server/monitoring";
import {
  getRazorpayWebhookConfig,
  parseRazorpayWebhookPayload,
  sha256Hex,
  verifyRazorpayWebhookSignature,
} from "@/src/lib/server/razorpayWebhook";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

type PaymentOrderRow = {
  id: string;
  tenant_id: string;
  provider_order_id: string | null;
  total_amount_minor: number;
  currency: string;
  internal_status: string;
  provider_status: string | null;
  metadata_json: JsonRecord | null;
};

type WebhookEventRow = {
  id: string;
  payload_hash: string;
  processing_status: string;
  signature_valid: boolean;
};

type ProcessResult = {
  processed: boolean;
  processingStatus: "processed" | "ignored" | "failed";
  errorMessage?: string;
};

const supportedEventTypes = new Set([
  "order.paid",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
]);

function jsonResponse(
  status: number,
  body: {
    duplicate?: boolean;
    eventType: string;
    processed: boolean;
    received: boolean;
  },
) {
  return Response.json(
    {
      activationEnabled: false,
      duplicate: body.duplicate ?? false,
      eventType: body.eventType,
      processed: body.processed,
      received: body.received,
    },
    { status },
  );
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeText(value: unknown, maxLength = 600) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[<>]/g, "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isoFromUnixSeconds(value: unknown) {
  const seconds = asNumber(value);

  if (!seconds || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

function getPayloadContainer(payload: JsonRecord) {
  return asRecord(payload.payload) ?? {};
}

function getPaymentEntity(payload: JsonRecord) {
  const payment = asRecord(getPayloadContainer(payload).payment);
  return asRecord(payment?.entity);
}

function getOrderEntity(payload: JsonRecord) {
  const order = asRecord(getPayloadContainer(payload).order);
  return asRecord(order?.entity);
}

function getEventType(payload: JsonRecord | null, fallback: string) {
  return sanitizeText(payload?.event, 120) ?? fallback;
}

function getProviderEventId(payload: JsonRecord | null) {
  return sanitizeText(payload?.id, 200);
}

function getRelatedProviderOrderId(payload: JsonRecord | null) {
  if (!payload) {
    return null;
  }

  return (
    sanitizeText(getPaymentEntity(payload)?.order_id, 160) ??
    sanitizeText(getOrderEntity(payload)?.id, 160)
  );
}

function getRelatedProviderPaymentId(payload: JsonRecord | null) {
  if (!payload) {
    return null;
  }

  return sanitizeText(getPaymentEntity(payload)?.id, 160);
}

function getSafePayloadForStorage(payload: JsonRecord | null) {
  return payload ?? { parse_error: true };
}

async function findExistingWebhookEvent(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  providerEventId: string | null,
  payloadHash: string,
) {
  if (providerEventId) {
    const { data, error } = await admin
      .from("razorpay_webhook_events")
      .select("id,payload_hash,processing_status,signature_valid")
      .eq("provider", "razorpay")
      .eq("provider_event_id", providerEventId)
      .maybeSingle();

    if (error) {
      throw new Error("Webhook idempotency check failed.");
    }

    if (data) {
      return data as WebhookEventRow;
    }
  }

  const { data, error } = await admin
    .from("razorpay_webhook_events")
    .select("id,payload_hash,processing_status,signature_valid")
    .eq("provider", "razorpay")
    .eq("payload_hash", payloadHash)
    .maybeSingle();

  if (error) {
    throw new Error("Webhook payload idempotency check failed.");
  }

  return (data as WebhookEventRow | null) ?? null;
}

async function insertWebhookEvent(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  eventType: string;
  errorMessage?: string;
  payload: JsonRecord | null;
  payloadHash: string;
  processingStatus: "received" | "verified" | "ignored" | "processed" | "failed";
  providerEventId: string | null;
  relatedProviderOrderId: string | null;
  relatedProviderPaymentId: string | null;
  signatureHeader: string | null;
  signatureValid: boolean;
}) {
  const { data, error } = await params.admin
    .from("razorpay_webhook_events")
    .insert({
      error_message: sanitizeText(params.errorMessage, 1200),
      event_type: params.eventType,
      metadata_json: {
        activation_enabled: false,
        module: "71.7R4",
      },
      payload_hash: params.payloadHash,
      payload_json: getSafePayloadForStorage(params.payload),
      processing_status: params.processingStatus,
      provider: "razorpay",
      provider_event_id: params.providerEventId,
      provider_mode: "test",
      related_provider_order_id: params.relatedProviderOrderId,
      related_provider_payment_id: params.relatedProviderPaymentId,
      signature_header: sanitizeText(params.signatureHeader, 512),
      signature_valid: params.signatureValid,
    })
    .select("id,payload_hash,processing_status,signature_valid")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { duplicate: true, event: null };
    }

    throw new Error("Webhook event could not be stored.");
  }

  return { duplicate: false, event: data as WebhookEventRow };
}

async function prepareFailedWebhookEventForRetry(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  eventId: string;
}) {
  const { data, error } = await params.admin
    .from("razorpay_webhook_events")
    .update({
      error_message: null,
      metadata_json: {
        activation_enabled: false,
        module: "71.7R4",
        retry_source: "verified_provider_redelivery",
      },
      processed_at: null,
      processing_status: "verified",
    })
    .eq("id", params.eventId)
    .eq("processing_status", "failed")
    .eq("signature_valid", true)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error("Failed webhook event could not be prepared for retry.");
  }

  return Boolean(data?.id);
}

async function updateWebhookEvent(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  errorMessage?: string;
  eventId: string;
  metadata?: JsonRecord;
  processingStatus: "ignored" | "processed" | "failed";
}) {
  const { error } = await params.admin
    .from("razorpay_webhook_events")
    .update({
      error_message: sanitizeText(params.errorMessage, 1200),
      metadata_json: {
        activation_enabled: false,
        module: "71.7R4",
        ...(params.metadata ?? {}),
      },
      processed_at: new Date().toISOString(),
      processing_status: params.processingStatus,
    })
    .eq("id", params.eventId);

  if (error) {
    throw new Error("Webhook processing status could not be updated.");
  }
}

async function loadPaymentOrder(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  providerOrderId: string,
) {
  const { data, error } = await admin
    .from("tenant_payment_orders")
    .select(
      "id,tenant_id,provider_order_id,total_amount_minor,currency,internal_status,provider_status,metadata_json",
    )
    .eq("provider_order_id", providerOrderId)
    .maybeSingle();

  if (error) {
    throw new Error("Internal payment order lookup failed.");
  }

  return (data as PaymentOrderRow | null) ?? null;
}

function validateAmountAndCurrency(params: {
  amount: number | null;
  currency: string | null;
  order: PaymentOrderRow;
}) {
  if (
    params.amount === null ||
    !Number.isSafeInteger(params.amount) ||
    params.amount < 0
  ) {
    throw new Error("Webhook amount is missing or invalid.");
  }

  if (!params.currency || params.currency !== "INR") {
    throw new Error("Webhook currency is missing or unsupported.");
  }

  if (params.amount !== params.order.total_amount_minor) {
    throw new Error("Webhook amount does not match the internal order.");
  }

  if (params.currency !== params.order.currency) {
    throw new Error("Webhook currency does not match the internal order.");
  }
}

function safeErrorMessage(error: unknown) {
  return sanitizeText(
    error instanceof Error ? error.message : "Webhook processing failed.",
    1200,
  );
}

function orderMetadata(
  order: PaymentOrderRow,
  summary: JsonRecord,
) {
  return {
    ...(order.metadata_json ?? {}),
    activation_enabled: false,
    latest_webhook_summary: {
      ...summary,
      module: "71.7R4",
    },
  };
}

async function upsertPaymentAttempt(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  amountMinor: number | null;
  capturedAt?: string | null;
  currency: string | null;
  failedAt?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  internalStatus: "authorized" | "captured" | "failed";
  order: PaymentOrderRow;
  payment: JsonRecord;
  providerOrderId: string;
  providerPaymentId: string;
  providerStatus: string | null;
}) {
  const payload = {
    amount_minor: params.amountMinor,
    captured_at: params.capturedAt ?? null,
    currency: params.currency,
    failed_at: params.failedAt ?? null,
    failure_code: sanitizeText(params.failureCode, 120),
    failure_reason: sanitizeText(params.failureReason, 600),
    internal_status: params.internalStatus,
    metadata_json: {
      activation_enabled: false,
      method: sanitizeText(params.payment.method, 80),
      module: "71.7R4",
    },
    payment_order_id: params.order.id,
    provider: "razorpay",
    provider_mode: "test",
    provider_order_id: params.providerOrderId,
    provider_payment_id: params.providerPaymentId,
    provider_status: sanitizeText(params.providerStatus, 80),
    raw_payload_json: params.payment,
    signature_valid: true,
    tenant_id: params.order.tenant_id,
  };

  const existing = await params.admin
    .from("tenant_payment_attempts")
    .select("id")
    .eq("provider_payment_id", params.providerPaymentId)
    .maybeSingle();

  if (existing.error) {
    throw new Error("Payment attempt idempotency check failed.");
  }

  if (existing.data?.id) {
    const { error } = await params.admin
      .from("tenant_payment_attempts")
      .update(payload)
      .eq("id", existing.data.id);

    if (error) {
      throw new Error("Payment attempt could not be updated.");
    }

    return;
  }

  const { error } = await params.admin
    .from("tenant_payment_attempts")
    .insert(payload);

  if (error) {
    if (error.code === "23505") {
      const retry = await params.admin
        .from("tenant_payment_attempts")
        .update(payload)
        .eq("provider_payment_id", params.providerPaymentId);

      if (retry.error) {
        throw new Error("Duplicate payment attempt could not be updated.");
      }

      return;
    }

    throw new Error("Payment attempt could not be stored.");
  }
}

async function updateOrderStatus(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  internalStatus: "payment_authorized" | "payment_captured" | "order_paid" | "failed";
  order: PaymentOrderRow;
  providerStatus: string | null;
  summary: JsonRecord;
}) {
  const { error } = await params.admin
    .from("tenant_payment_orders")
    .update({
      internal_status: params.internalStatus,
      metadata_json: orderMetadata(params.order, params.summary),
      provider_status: sanitizeText(params.providerStatus, 80),
    })
    .eq("id", params.order.id)
    .eq("provider_order_id", params.order.provider_order_id);

  if (error) {
    throw new Error("Internal payment order could not be updated.");
  }
}

function isPaidOrActivationState(status: string) {
  return (
    status === "payment_captured" ||
    status === "order_paid" ||
    isActivationState(status)
  );
}

function isActivationState(status: string) {
  return status === "activation_pending" || status === "activated";
}

function shouldApplyAuthorizedOrCapturedStatus(params: {
  eventType: "payment.authorized" | "payment.captured";
  orderStatus: string;
}) {
  if (params.eventType === "payment.authorized") {
    return ["created", "provider_order_created", "checkout_started"].includes(
      params.orderStatus,
    );
  }

  return !(
    params.orderStatus === "order_paid" ||
    isActivationState(params.orderStatus)
  );
}

async function processPaymentEvent(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  eventType: "payment.authorized" | "payment.captured" | "payment.failed";
  payload: JsonRecord;
}): Promise<ProcessResult> {
  const payment = getPaymentEntity(params.payload);

  if (!payment) {
    throw new Error("Webhook payment entity is missing.");
  }

  const providerPaymentId = sanitizeText(payment.id, 160);
  const providerOrderId = sanitizeText(payment.order_id, 160);
  const amountMinor = asNumber(payment.amount);
  const currency = sanitizeText(payment.currency, 12);
  const providerStatus = sanitizeText(payment.status, 80);

  if (!providerPaymentId || !providerOrderId) {
    throw new Error("Webhook payment identifiers are missing.");
  }

  const order = await loadPaymentOrder(params.admin, providerOrderId);

  if (!order) {
    return {
      errorMessage: "Matching internal payment order was not found.",
      processed: false,
      processingStatus: "failed",
    };
  }

  validateAmountAndCurrency({
    amount: amountMinor,
    currency,
    order,
  });

  if (params.eventType === "payment.failed") {
    await upsertPaymentAttempt({
      admin: params.admin,
      amountMinor,
      currency,
      failedAt: isoFromUnixSeconds(payment.created_at),
      failureCode: sanitizeText(payment.error_code, 120),
      failureReason: sanitizeText(
        payment.error_description ?? payment.error_reason,
        600,
      ),
      internalStatus: "failed",
      order,
      payment,
      providerOrderId,
      providerPaymentId,
      providerStatus,
    });

    if (!isPaidOrActivationState(order.internal_status)) {
      await updateOrderStatus({
        admin: params.admin,
        internalStatus: "failed",
        order,
        providerStatus: providerStatus ?? "failed",
        summary: {
          event_type: params.eventType,
          provider_order_id: providerOrderId,
          provider_payment_id: providerPaymentId,
          provider_status: providerStatus,
        },
      });
    }

    return {
      processed: true,
      processingStatus: "processed",
    };
  }

  const internalStatus =
    params.eventType === "payment.captured" ? "captured" : "authorized";
  const orderStatus =
    params.eventType === "payment.captured"
      ? "payment_captured"
      : "payment_authorized";

  await upsertPaymentAttempt({
    admin: params.admin,
    amountMinor,
    capturedAt:
      params.eventType === "payment.captured"
        ? isoFromUnixSeconds(payment.created_at)
        : null,
    currency,
    internalStatus,
    order,
    payment,
    providerOrderId,
    providerPaymentId,
    providerStatus,
  });

  if (
    shouldApplyAuthorizedOrCapturedStatus({
      eventType: params.eventType,
      orderStatus: order.internal_status,
    })
  ) {
    await updateOrderStatus({
      admin: params.admin,
      internalStatus: orderStatus,
      order,
      providerStatus,
      summary: {
        amount_minor: amountMinor,
        currency,
        event_type: params.eventType,
        provider_order_id: providerOrderId,
        provider_payment_id: providerPaymentId,
        provider_status: providerStatus,
      },
    });
  }

  return {
    processed: true,
    processingStatus: "processed",
  };
}

async function processOrderPaidEvent(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  payload: JsonRecord;
}): Promise<ProcessResult> {
  const orderEntity = getOrderEntity(params.payload);

  if (!orderEntity) {
    throw new Error("Webhook order entity is missing.");
  }

  const providerOrderId = sanitizeText(orderEntity.id, 160);
  const amountMinor = asNumber(orderEntity.amount);
  const currency = sanitizeText(orderEntity.currency, 12);
  const providerStatus = sanitizeText(orderEntity.status, 80) ?? "paid";

  if (!providerOrderId) {
    throw new Error("Webhook order id is missing.");
  }

  const order = await loadPaymentOrder(params.admin, providerOrderId);

  if (!order) {
    return {
      errorMessage: "Matching internal payment order was not found.",
      processed: false,
      processingStatus: "failed",
    };
  }

  validateAmountAndCurrency({
    amount: amountMinor,
    currency,
    order,
  });

  if (isActivationState(order.internal_status)) {
    return {
      processed: true,
      processingStatus: "processed",
    };
  }

  await updateOrderStatus({
    admin: params.admin,
    internalStatus: "order_paid",
    order,
    providerStatus,
    summary: {
      amount_minor: amountMinor,
      amount_paid: asNumber(orderEntity.amount_paid),
      attempts: asNumber(orderEntity.attempts),
      currency,
      event_type: "order.paid",
      provider_order_id: providerOrderId,
      provider_status: providerStatus,
    },
  });

  return {
    processed: true,
    processingStatus: "processed",
  };
}

async function processSupportedEvent(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  eventType: string;
  payload: JsonRecord;
}) {
  if (
    params.eventType === "payment.authorized" ||
    params.eventType === "payment.captured" ||
    params.eventType === "payment.failed"
  ) {
    return processPaymentEvent({
      admin: params.admin,
      eventType: params.eventType,
      payload: params.payload,
    });
  }

  if (params.eventType === "order.paid") {
    return processOrderPaidEvent(params);
  }

  return {
    processed: false,
    processingStatus: "ignored",
  } satisfies ProcessResult;
}

async function handleWebhookPost(request: Request) {
  const admin = getSupabaseAdminClient();
  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get("x-razorpay-signature") ??
    request.headers.get("X-Razorpay-Signature");
  const payloadHash = sha256Hex(rawBody);
  const config = getRazorpayWebhookConfig();
  const signatureValid = verifyRazorpayWebhookSignature({
    rawBody,
    signature: signatureHeader,
    webhookSecret: config.webhookSecret,
  });

  let payload: JsonRecord | null = null;
  let parseError: Error | null = null;

  try {
    payload = parseRazorpayWebhookPayload(rawBody);
  } catch (error) {
    parseError = error instanceof Error ? error : new Error("Invalid JSON.");
  }

  const eventType = getEventType(payload, parseError ? "invalid_json" : "unknown");
  const providerEventId = getProviderEventId(payload);
  const relatedProviderOrderId = getRelatedProviderOrderId(payload);
  const relatedProviderPaymentId = getRelatedProviderPaymentId(payload);
  let verifiedWebhookEventId: string | null = null;

  try {
    const existing = await findExistingWebhookEvent(
      admin,
      providerEventId,
      payloadHash,
    );

    if (
      existing &&
      !(
        existing.processing_status === "failed" &&
        existing.payload_hash === payloadHash &&
        existing.signature_valid &&
        signatureValid &&
        !parseError
      )
    ) {
      return jsonResponse(200, {
        duplicate: true,
        eventType,
        processed: false,
        received: true,
      });
    }

    if (existing) {
      const retryClaimed = await prepareFailedWebhookEventForRetry({
        admin,
        eventId: existing.id,
      });
      if (!retryClaimed) {
        return jsonResponse(200, {
          duplicate: true,
          eventType,
          processed: false,
          received: true,
        });
      }
      verifiedWebhookEventId = existing.id;
    }

    if (parseError) {
      await insertWebhookEvent({
        admin,
        errorMessage: "Invalid Razorpay webhook JSON.",
        eventType,
        payload,
        payloadHash,
        processingStatus: "failed",
        providerEventId,
        relatedProviderOrderId,
        relatedProviderPaymentId,
        signatureHeader,
        signatureValid,
      });

      return jsonResponse(400, {
        eventType,
        processed: false,
        received: false,
      });
    }

    if (!signatureValid) {
      await insertWebhookEvent({
        admin,
        errorMessage: "Invalid Razorpay webhook signature.",
        eventType,
        payload,
        payloadHash,
        processingStatus: "failed",
        providerEventId,
        relatedProviderOrderId,
        relatedProviderPaymentId,
        signatureHeader,
        signatureValid: false,
      });

      return jsonResponse(400, {
        eventType,
        processed: false,
        received: false,
      });
    }

    if (!existing) {
      const inserted = await insertWebhookEvent({
        admin,
        eventType,
        payload,
        payloadHash,
        processingStatus: "verified",
        providerEventId,
        relatedProviderOrderId,
        relatedProviderPaymentId,
        signatureHeader,
        signatureValid: true,
      });

      if (inserted.duplicate || !inserted.event) {
        return jsonResponse(200, {
          duplicate: true,
          eventType,
          processed: false,
          received: true,
        });
      }

      verifiedWebhookEventId = inserted.event.id;
    }

    if (!verifiedWebhookEventId) {
      throw new Error("Verified webhook event identity is missing.");
    }

    if (!supportedEventTypes.has(eventType)) {
      await updateWebhookEvent({
        admin,
        eventId: verifiedWebhookEventId,
        metadata: { reason: "unsupported_event" },
        processingStatus: "ignored",
      });

      return jsonResponse(200, {
        eventType,
        processed: false,
        received: true,
      });
    }

    if (!payload) {
      throw new Error("Verified webhook payload is missing.");
    }

    const result = await processSupportedEvent({
      admin,
      eventType,
      payload,
    });

    await updateWebhookEvent({
      admin,
      errorMessage: result.errorMessage,
      eventId: verifiedWebhookEventId,
      metadata: {
        event_type: eventType,
        related_provider_order_id: relatedProviderOrderId,
        related_provider_payment_id: relatedProviderPaymentId,
      },
      processingStatus: result.processingStatus,
    });

    return jsonResponse(200, {
      eventType,
      processed: result.processed,
      received: true,
    });
  } catch (error) {
    if (verifiedWebhookEventId) {
      try {
        await updateWebhookEvent({
          admin,
          errorMessage: safeErrorMessage(error) ?? undefined,
          eventId: verifiedWebhookEventId,
          processingStatus: "failed",
        });
      } catch (updateError) {
        captureServerException(updateError, {
          eventType,
          operation: "razorpay_webhook_mark_failed",
          route: "/api/billing/razorpay/webhook",
        });
      }
    }

    captureServerException(error, {
      eventType,
      operation: "razorpay_webhook_process",
      route: "/api/billing/razorpay/webhook",
    });

    return jsonResponse(500, {
      eventType,
      processed: false,
      received: false,
    });
  }
}

export async function POST(request: Request) {
  try {
    return await handleWebhookPost(request);
  } catch (error) {
    captureServerException(error, {
      eventType: "unknown",
      operation: "razorpay_webhook_route",
      route: "/api/billing/razorpay/webhook",
    });

    return jsonResponse(500, {
      eventType: "unknown",
      processed: false,
      received: false,
    });
  }
}
