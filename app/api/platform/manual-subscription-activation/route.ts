import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ManualActivationRequestBody = {
  amountMinor?: unknown;
  billingCycle?: unknown;
  currency?: unknown;
  customerEmail?: unknown;
  founderApproval?: unknown;
  operatorNote?: unknown;
  paymentMethod?: unknown;
  paymentReference?: unknown;
  paymentVerifiedAt?: unknown;
  planCode?: unknown;
  replaceCurrent?: unknown;
  requestId?: unknown;
  tenantId?: unknown;
};

type NormalizedManualActivationRequest = {
  amountMinor: number;
  billingCycle: "monthly" | "yearly";
  currency: string;
  customerEmail: string;
  founderApproval: string;
  operatorNote: string | null;
  paymentMethod: string;
  paymentReference: string;
  paymentVerifiedAt: string;
  planCode: string;
  replaceCurrent: boolean;
  requestId: string;
  tenantId: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const planCodePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const currencyPattern = /^[A-Z]{3}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonError(error: string, status: number) {
  return Response.json(
    { error },
    {
      headers: { "Cache-Control": "no-store" },
      status,
    },
  );
}

function requiredText(
  value: unknown,
  label: string,
  maximumLength: number,
) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (
    !normalized ||
    normalized.length > maximumLength ||
    normalized.includes("<") ||
    normalized.includes(">")
  ) {
    throw new Error(`${label} is invalid.`);
  }

  return normalized;
}

function optionalText(value: unknown, label: string, maximumLength: number) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return requiredText(value, label, maximumLength);
}

function normalizeRequest(
  body: ManualActivationRequestBody,
): NormalizedManualActivationRequest {
  const tenantId = requiredText(body.tenantId, "Tenant id", 36);
  const requestId = requiredText(body.requestId, "Request id", 36);
  const planCode = requiredText(body.planCode, "Plan", 64).toLowerCase();
  const billingCycle = requiredText(
    body.billingCycle,
    "Billing cycle",
    12,
  ).toLowerCase();
  const currency = requiredText(body.currency, "Currency", 3).toUpperCase();
  const customerEmail = requiredText(
    body.customerEmail,
    "Customer email",
    320,
  ).toLowerCase();
  const paymentVerifiedAt = requiredText(
    body.paymentVerifiedAt,
    "Payment verification time",
    64,
  );

  if (!uuidPattern.test(tenantId) || !uuidPattern.test(requestId)) {
    throw new Error("Tenant and request identifiers must be valid UUIDs.");
  }

  if (!planCodePattern.test(planCode)) {
    throw new Error("Plan selection is invalid.");
  }

  if (billingCycle !== "monthly" && billingCycle !== "yearly") {
    throw new Error("Billing cycle is invalid.");
  }

  if (!currencyPattern.test(currency)) {
    throw new Error("Currency is invalid.");
  }

  if (!emailPattern.test(customerEmail)) {
    throw new Error("Customer email is invalid.");
  }

  if (
    !Number.isSafeInteger(body.amountMinor) ||
    Number(body.amountMinor) <= 0
  ) {
    throw new Error("Manual payment amount is invalid.");
  }

  const verifiedAt = new Date(paymentVerifiedAt);
  if (
    !Number.isFinite(verifiedAt.getTime()) ||
    verifiedAt.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    throw new Error("Payment verification time is invalid.");
  }

  if (typeof body.replaceCurrent !== "boolean") {
    throw new Error("Replacement intent is required.");
  }

  return {
    amountMinor: Number(body.amountMinor),
    billingCycle,
    currency,
    customerEmail,
    founderApproval: requiredText(
      body.founderApproval,
      "Founder approval",
      240,
    ),
    operatorNote: optionalText(body.operatorNote, "Operator note", 1500),
    paymentMethod: requiredText(body.paymentMethod, "Payment method", 80),
    paymentReference: requiredText(
      body.paymentReference,
      "Payment reference",
      180,
    ),
    paymentVerifiedAt: verifiedAt.toISOString(),
    planCode,
    replaceCurrent: body.replaceCurrent,
    requestId,
    tenantId,
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredResultString(
  row: Record<string, unknown>,
  key: string,
) {
  const value = row[key];
  if (typeof value !== "string" || !value) {
    throw new Error("Manual activation returned an invalid result.");
  }
  return value;
}

function normalizeResult(value: unknown) {
  const row = asRecord(value);
  if (
    !row ||
    row.activated !== true ||
    typeof row.idempotent !== "boolean" ||
    !Number.isSafeInteger(row.amount_minor)
  ) {
    throw new Error("Manual activation returned an invalid result.");
  }

  const billingCycle = requiredResultString(row, "billing_cycle");
  if (billingCycle !== "monthly" && billingCycle !== "yearly") {
    throw new Error("Manual activation returned an invalid result.");
  }

  return {
    activated: true,
    activationAuditId: requiredResultString(row, "activation_audit_id"),
    amountMinor: Number(row.amount_minor),
    assignmentId: requiredResultString(row, "assignment_id"),
    billingCycle,
    currency: requiredResultString(row, "currency"),
    currentPeriodEnd: requiredResultString(row, "current_period_end"),
    currentPeriodStart: requiredResultString(row, "current_period_start"),
    gracePeriodEndsAt: requiredResultString(row, "grace_period_ends_at"),
    idempotent: row.idempotent,
    paymentStatus: "paid" as const,
    planCode: requiredResultString(row, "plan_code"),
    requestId: requiredResultString(row, "request_id"),
    status: "active" as const,
    tenantId: requiredResultString(row, "tenant_id"),
  };
}

function getDatabaseErrorStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "23505" || code === "55000") return 409;
  if (code === "22023" || code === "23514") return 400;
  return 500;
}

function getDatabaseErrorMessage(status: number) {
  if (status === 403) {
    return "Manual activation is restricted to Platform Owner and Admin roles.";
  }
  if (status === 409) {
    return "This activation conflicts with current subscription or request history.";
  }
  if (status === 400) {
    return "Manual activation details do not match current CoachFort billing authority.";
  }
  return "Unable to complete manual activation right now.";
}

export async function POST(request: Request) {
  let actorId: string | null = null;
  let requestId: string | null = null;
  let tenantId: string | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    actorId = user.id;

    const body = normalizeRequest(
      await parseJsonBody<ManualActivationRequestBody>(request),
    );
    requestId = body.requestId;
    tenantId = body.tenantId;

    const admin = getSupabaseAdminClient();
    const { data: platformActor, error: roleError } = await admin
      .from("platform_admin_users")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (roleError) {
      throw new Error("Platform role verification failed.");
    }

    if (platformActor?.role !== "owner" && platformActor?.role !== "admin") {
      return jsonError(
        "Manual activation is restricted to Platform Owner and Admin roles.",
        403,
      );
    }

    const { data, error } = await admin.rpc(
      "activate_tenant_subscription_manual_authority_server",
      {
        p_actor_user_id: user.id,
        p_amount_minor: body.amountMinor,
        p_billing_cycle: body.billingCycle,
        p_currency: body.currency,
        p_customer_email: body.customerEmail,
        p_founder_approval: body.founderApproval,
        p_operator_note: body.operatorNote,
        p_payment_method: body.paymentMethod,
        p_payment_reference: body.paymentReference,
        p_payment_verified_at: body.paymentVerifiedAt,
        p_plan_code: body.planCode,
        p_replace_current: body.replaceCurrent,
        p_request_id: body.requestId,
        p_tenant_id: body.tenantId,
      },
    );

    if (error) {
      const status = getDatabaseErrorStatus(error.code);
      if (status >= 500) {
        captureServerException(error, {
          actor_id: actorId,
          operation: "manual_subscription_activation",
          request_id: requestId,
          tenant_id: tenantId,
        });
      }
      return jsonError(getDatabaseErrorMessage(status), status);
    }

    return Response.json(
      { result: normalizeResult(data) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof InvalidJsonPayloadError ||
      (error instanceof Error && /invalid|required|valid UUID/i.test(error.message))
    ) {
      return jsonError("Manual activation request is invalid.", 400);
    }

    if (
      error instanceof Error &&
      (error.message === "Authentication required." ||
        error.message === "Please sign in again to continue.")
    ) {
      return jsonError("Please sign in again to continue.", 401);
    }

    captureServerException(error, {
      actor_id: actorId,
      operation: "manual_subscription_activation",
      request_id: requestId,
      tenant_id: tenantId,
    });
    return jsonError("Unable to complete manual activation right now.", 500);
  }
}
