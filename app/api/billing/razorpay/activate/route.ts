import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";
import { drainPlatformBillingDocumentFulfillments } from "@/src/lib/server/platformBillingFulfillment";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ActivationRequestBody = {
  orderId?: unknown;
  tenantId?: unknown;
};

type PaymentOrderRow = {
  billing_cycle: string;
  checkout_enabled_source: string | null;
  created_by: string | null;
  currency: string;
  id: string;
  internal_status: string;
  metadata_json: Record<string, unknown> | null;
  plan_code: string;
  provider: string;
  provider_mode: string;
  provider_order_id: string | null;
  tenant_id: string;
  total_amount_minor: number;
};

type ActivationRpcResult = {
  activated?: unknown;
  activation_event_id?: unknown;
  activation_status?: unknown;
  assignment_id?: unknown;
  error_message?: unknown;
  idempotent?: unknown;
  payment_order_id?: unknown;
  plan_code?: unknown;
  tenant_id?: unknown;
};

const allowedPlanCodes = new Set(["starter", "growth"]);
const allowedBillingCycles = new Set(["monthly", "yearly"]);
const paidOrActivatableStatuses = new Set([
  "activated",
  "order_paid",
  "payment_captured",
]);
const successfulActivationStatuses = new Set([
  "activated",
  "skipped_already_active",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizeBody(body: ActivationRequestBody) {
  const tenantId =
    typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";

  if (!uuidPattern.test(tenantId)) {
    throw new Error("A valid tenant id is required.");
  }

  if (!uuidPattern.test(orderId)) {
    throw new Error("A valid order id is required.");
  }

  return {
    orderId,
    tenantId,
  };
}

function getRouteErrorStatus(error: unknown) {
  if (error instanceof InvalidJsonPayloadError) {
    return 400;
  }

  if (!(error instanceof Error)) {
    return 500;
  }

  if (error.message === "Authentication required.") {
    return 401;
  }

  if (/owners and admins|denied|belongs to another tenant/i.test(error.message)) {
    return 403;
  }

  if (/not verified|not ready|not captured|not paid/i.test(error.message)) {
    return 409;
  }

  if (/required|valid|eligible|configured|invalid|unsupported|missing|not found/i.test(error.message)) {
    return 400;
  }

  return 500;
}

function getRouteErrorMessage(error: unknown) {
  const status = getRouteErrorStatus(error);

  if (error instanceof InvalidJsonPayloadError) {
    return error.message;
  }

  if (error instanceof Error && status < 500) {
    return error.message;
  }

  return "Unable to activate verified payment order.";
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown) {
  return value === true;
}

async function requireOwnerOrAdmin(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  tenantId: string,
  userId: string,
) {
  const { data, error } = await admin
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Tenant membership could not be verified.");
  }

  const role = typeof data?.role === "string" ? data.role : "";

  if (role !== "owner" && role !== "admin") {
    throw new Error("Only tenant owners and admins can activate verified payments.");
  }

  return role;
}

async function loadPaymentOrder(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
) {
  const { data, error } = await admin
    .from("tenant_payment_orders")
    .select(
      [
        "id",
        "tenant_id",
        "created_by",
        "provider",
        "provider_mode",
        "provider_order_id",
        "internal_status",
        "plan_code",
        "billing_cycle",
        "currency",
        "total_amount_minor",
        "checkout_enabled_source",
        "metadata_json",
      ].join(","),
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error("Payment order could not be loaded.");
  }

  if (!data) {
    throw new Error("Payment order not found.");
  }

  return data as unknown as PaymentOrderRow;
}

function validatePaymentOrderForActivation(
  order: PaymentOrderRow,
  tenantId: string,
) {
  const metadata = order.metadata_json ?? {};

  if (order.tenant_id !== tenantId) {
    throw new Error("Payment order belongs to another tenant.");
  }

  if (order.provider !== "razorpay") {
    throw new Error("Payment order provider is not eligible.");
  }

  if (order.provider_mode !== "test") {
    throw new Error("Payment order mode is not eligible.");
  }

  if (!order.provider_order_id) {
    throw new Error("Payment order is missing provider order id.");
  }

  if (order.checkout_enabled_source !== "regression_test_gate") {
    throw new Error("Payment order is not eligible for test activation.");
  }

  if (
    metadata.browser_success_not_activation !== true ||
    metadata.test_tenant_allowlisted !== true
  ) {
    throw new Error("Payment order is missing required safety metadata.");
  }

  if (!allowedPlanCodes.has(order.plan_code)) {
    throw new Error("Payment order plan is not eligible for activation.");
  }

  if (!allowedBillingCycles.has(order.billing_cycle)) {
    throw new Error("Payment order billing cycle is not eligible for activation.");
  }

  if (order.currency !== "INR") {
    throw new Error("Payment order currency is not eligible for activation.");
  }

  if (
    !Number.isSafeInteger(order.total_amount_minor) ||
    order.total_amount_minor <= 0
  ) {
    throw new Error("Payment order total amount is invalid.");
  }

  if (!paidOrActivatableStatuses.has(order.internal_status)) {
    return {
      pending: true,
      reason: "payment_not_verified_yet",
    };
  }

  return {
    pending: false,
    reason: null,
  };
}

function normalizeActivationResult(
  value: ActivationRpcResult | null,
  fallback: { orderId: string; tenantId: string },
) {
  const activationStatus = asString(value?.activation_status) ?? "unknown";

  return {
    activationEnabled: false,
    activated: asBoolean(value?.activated),
    activationEventId: asString(value?.activation_event_id),
    activationStatus,
    assignmentId: asString(value?.assignment_id),
    idempotent: asBoolean(value?.idempotent),
    orderId: asString(value?.payment_order_id) ?? fallback.orderId,
    pending: false,
    planCode: asString(value?.plan_code),
    reason: asString(value?.error_message) ?? undefined,
    tenantId: asString(value?.tenant_id) ?? fallback.tenantId,
  };
}

export async function POST(request: Request) {
  try {
    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    const body = normalizeBody(
      await parseJsonBody<ActivationRequestBody>(request),
    );
    const admin = getSupabaseAdminClient();

    await requireOwnerOrAdmin(admin, body.tenantId, user.id);

    const order = await loadPaymentOrder(admin, body.orderId);
    const orderCheck = validatePaymentOrderForActivation(order, body.tenantId);

    if (orderCheck.pending) {
      return Response.json(
        {
          activationEnabled: false,
          activated: false,
          activationEventId: null,
          activationStatus: order.internal_status,
          assignmentId: null,
          idempotent: false,
          orderId: order.id,
          pending: true,
          planCode: order.plan_code,
          reason: orderCheck.reason,
          tenantId: order.tenant_id,
        },
        { status: 409 },
      );
    }

    const { data, error } = await admin.rpc(
      "activate_tenant_plan_after_verified_payment",
      {
        p_payment_order_id: order.id,
      },
    );

    if (error) {
      const safeMessage =
        error.code === "22023"
          ? error.message
          : "Verified payment activation failed.";
      return Response.json(
        {
          activationEnabled: false,
          activated: false,
          activationEventId: null,
          activationStatus: "failed",
          assignmentId: null,
          idempotent: false,
          orderId: order.id,
          pending: false,
          planCode: order.plan_code,
          reason: safeMessage,
          tenantId: order.tenant_id,
        },
        { status: error.code === "22023" ? 409 : 500 },
      );
    }

    const result = normalizeActivationResult(data as ActivationRpcResult | null, {
      orderId: order.id,
      tenantId: order.tenant_id,
    });

    if (
      successfulActivationStatuses.has(result.activationStatus) &&
      result.activationEventId
    ) {
      try {
        await drainPlatformBillingDocumentFulfillments({
          batchSize: 3,
          discoveryBatchSize: 25,
          workerId: `activation:${result.activationEventId}`,
        });
      } catch (fulfillmentError) {
        captureServerException(fulfillmentError, {
          activationEventId: result.activationEventId,
          operation: "platform_billing_fulfillment_after_activation",
          route: "/api/billing/razorpay/activate",
        });
      }
    }

    return Response.json(result, {
      status: result.activationStatus === "failed" ? 409 : 200,
    });
  } catch (error) {
    const status = getRouteErrorStatus(error);

    if (status >= 500) {
      captureServerException(error, {
        operation: "razorpay_activation_request",
        route: "/api/billing/razorpay/activate",
      });
    }

    return jsonError(getRouteErrorMessage(error), status);
  }
}
