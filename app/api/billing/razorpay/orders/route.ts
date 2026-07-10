import {
  getBearerToken,
  requireAuthenticatedUser,
} from "@/src/lib/server/documentStorage";
import { captureServerException } from "@/src/lib/server/monitoring";
import {
  InvalidJsonPayloadError,
  parseJsonBody,
} from "@/src/lib/server/requestJson";
import {
  assertRazorpayTenantAllowed,
  createRazorpayOrder,
  getRazorpayConfig,
} from "@/src/lib/server/razorpay";
import { getSupabaseAdminClient } from "@/src/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrderRequestBody = {
  billingCycle?: unknown;
  planCode?: unknown;
  tenantId?: unknown;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  is_public: boolean;
};

type PriceRow = {
  id: string;
  amount_minor: number;
  billing_cycle: string;
  currency: string;
  metadata_json: Record<string, unknown>;
  region_code: string;
  setup_fee_amount_minor: number;
  status: string;
  tax_behavior: string;
};

const allowedPlanCodes = new Set(["starter", "growth"]);
const allowedBillingCycles = new Set(["monthly", "yearly"]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function normalizeBody(body: OrderRequestBody) {
  const tenantId =
    typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const planCode =
    typeof body.planCode === "string" ? body.planCode.trim().toLowerCase() : "";
  const billingCycle =
    typeof body.billingCycle === "string"
      ? body.billingCycle.trim().toLowerCase()
      : "";

  if (!uuidPattern.test(tenantId)) {
    throw new Error("A valid tenant id is required.");
  }

  if (!allowedPlanCodes.has(planCode)) {
    throw new Error("Plan is not available for Razorpay test checkout.");
  }

  if (!allowedBillingCycles.has(billingCycle)) {
    throw new Error("Billing cycle is not available for Razorpay test checkout.");
  }

  return {
    billingCycle: billingCycle as "monthly" | "yearly",
    planCode: planCode as "starter" | "growth",
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

  if (/not allowlisted|restricted|denied|not available|not allowed/i.test(error.message)) {
    return 403;
  }

  if (/required|valid|configured|disabled|mode|price|plan|amount|cycle/i.test(error.message)) {
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

  return "Unable to create Razorpay test order.";
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
    throw new Error("Only tenant owners and admins can create test orders.");
  }

  return role;
}

async function loadPlanAndPrice(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  planCode: "starter" | "growth",
  billingCycle: "monthly" | "yearly",
) {
  const { data: plan, error: planError } = await admin
    .from("subscription_plans")
    .select("id,code,name,status,is_public")
    .eq("code", planCode)
    .maybeSingle();

  if (planError || !plan) {
    throw new Error("Subscription plan is not configured.");
  }

  const planRow = plan as PlanRow;

  if (planRow.status !== "draft" || planRow.is_public) {
    throw new Error("Plan is not available for Razorpay test checkout.");
  }

  const { data: price, error: priceError } = await admin
    .from("subscription_plan_prices")
    .select(
      "id,currency,billing_cycle,amount_minor,setup_fee_amount_minor,tax_behavior,region_code,status,metadata_json",
    )
    .eq("plan_id", planRow.id)
    .eq("currency", "INR")
    .eq("billing_cycle", billingCycle)
    .eq("region_code", "GLOBAL")
    .eq("status", "draft")
    .maybeSingle();

  if (priceError || !price) {
    throw new Error("Subscription price is not configured.");
  }

  const priceRow = price as PriceRow;
  const priceMetadata = priceRow.metadata_json ?? {};

  if (
    priceRow.currency !== "INR" ||
    priceRow.billing_cycle !== billingCycle ||
    priceRow.region_code !== "GLOBAL" ||
    priceRow.status !== "draft"
  ) {
    throw new Error("Subscription price is not available for test checkout.");
  }

  if (
    priceMetadata.pricing_finalized !== true ||
    priceMetadata.pricing_finalized_module !== "71.7R0B"
  ) {
    throw new Error("Subscription price is not finalized for test checkout.");
  }

  if (priceMetadata.checkout_enabled !== false) {
    throw new Error("Public checkout metadata must remain disabled in R3.");
  }

  if (!Number.isSafeInteger(priceRow.amount_minor) || priceRow.amount_minor <= 0) {
    throw new Error("Subscription price amount is invalid.");
  }

  if (
    !Number.isSafeInteger(priceRow.setup_fee_amount_minor) ||
    priceRow.setup_fee_amount_minor < 0
  ) {
    throw new Error("Subscription setup fee amount is invalid.");
  }

  return {
    plan: planRow,
    price: priceRow,
  };
}

function buildReceipt(orderId: string) {
  return `cf_${orderId.replace(/-/g, "").slice(0, 28)}`;
}

function buildDescription(planName: string, billingCycle: string) {
  return `CoachFort ${planName} ${billingCycle} test order`;
}

function validateRazorpayOrderMatchesRequest(params: {
  providerReceipt: string;
  razorpayOrder: Awaited<ReturnType<typeof createRazorpayOrder>>;
  totalAmountMinor: number;
}) {
  const { providerReceipt, razorpayOrder, totalAmountMinor } = params;

  if (!razorpayOrder.id.trim()) {
    throw new Error("Razorpay order response did not include an order id.");
  }

  if (razorpayOrder.amount !== totalAmountMinor) {
    throw new Error("Razorpay order amount did not match the requested amount.");
  }

  if (razorpayOrder.currency !== "INR") {
    throw new Error("Razorpay order currency did not match INR.");
  }

  if (razorpayOrder.receipt && razorpayOrder.receipt !== providerReceipt) {
    throw new Error("Razorpay order receipt did not match the internal receipt.");
  }
}

export async function POST(request: Request) {
  let internalOrderId: string | null = null;
  let admin: ReturnType<typeof getSupabaseAdminClient> | null = null;
  let providerOrderSummary: Record<string, unknown> | null = null;

  try {
    const accessToken = getBearerToken(request);
    const user = await requireAuthenticatedUser(accessToken);
    const body = normalizeBody(await parseJsonBody<OrderRequestBody>(request));
    const config = getRazorpayConfig();

    assertRazorpayTenantAllowed(config, body.tenantId);

    admin = getSupabaseAdminClient();
    await requireOwnerOrAdmin(admin, body.tenantId, user.id);

    const { plan, price } = await loadPlanAndPrice(
      admin,
      body.planCode,
      body.billingCycle,
    );

    const orderId = crypto.randomUUID();
    internalOrderId = orderId;
    const providerReceipt = buildReceipt(orderId);
    const idempotencyKey = `r3_${crypto.randomUUID()}`;
    const totalAmountMinor =
      price.amount_minor + price.setup_fee_amount_minor;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const metadata = {
      activation_enabled: false,
      browser_success_not_activation: true,
      module: "71.7R3",
      price_metadata_snapshot: price.metadata_json ?? {},
      public_launch_pending: true,
      test_tenant_allowlisted: true,
    };

    const inserted = await admin.from("tenant_payment_orders").insert({
      amount_minor: price.amount_minor,
      billing_cycle: body.billingCycle,
      checkout_enabled_source: "regression_test_gate",
      created_by: user.id,
      currency: "INR",
      expires_at: expiresAt,
      id: orderId,
      idempotency_key: idempotencyKey,
      internal_status: "created",
      metadata_json: metadata,
      plan_code: plan.code,
      plan_id: plan.id,
      price_id: price.id,
      provider: "razorpay",
      provider_mode: config.mode,
      provider_receipt: providerReceipt,
      setup_fee_amount_minor: price.setup_fee_amount_minor,
      tax_amount_minor: null,
      tenant_id: body.tenantId,
      total_amount_minor: totalAmountMinor,
    });

    if (inserted.error) {
      throw new Error("Internal payment order could not be created.");
    }

    const razorpayOrder = await createRazorpayOrder(config, {
      amount: totalAmountMinor,
      currency: "INR",
      notes: {
        billing_cycle: body.billingCycle,
        internal_order_id: orderId,
        module: "71.7R3",
        plan_code: plan.code,
        tenant_id: body.tenantId,
      },
      receipt: providerReceipt,
    });

    providerOrderSummary = {
      amount: razorpayOrder.amount,
      amount_due: razorpayOrder.amount_due,
      amount_paid: razorpayOrder.amount_paid,
      attempts: razorpayOrder.attempts,
      created_at: razorpayOrder.created_at,
      currency: razorpayOrder.currency,
      id: razorpayOrder.id,
      receipt: razorpayOrder.receipt,
      status: razorpayOrder.status,
    };

    validateRazorpayOrderMatchesRequest({
      providerReceipt,
      razorpayOrder,
      totalAmountMinor,
    });

    const providerMetadata = {
      ...metadata,
      provider_response_summary: providerOrderSummary,
    };

    const updated = await admin
      .from("tenant_payment_orders")
      .update({
        internal_status: "provider_order_created",
        metadata_json: providerMetadata,
        provider_order_id: razorpayOrder.id,
        provider_status: razorpayOrder.status,
      })
      .eq("id", orderId);

    if (updated.error) {
      captureServerException(updated.error, {
        internalOrderId: orderId,
        operation: "razorpay_order_persist_provider_order",
        route: "/api/billing/razorpay/orders",
      });
      throw new Error("Razorpay order was created but could not be persisted.");
    }

    return Response.json({
      activationEnabled: false,
      amount: totalAmountMinor,
      billingCycle: body.billingCycle,
      currency: "INR",
      description: buildDescription(plan.name, body.billingCycle),
      keyId: config.keyId,
      name: "CoachFort",
      orderId,
      planCode: plan.code,
      razorpayOrderId: razorpayOrder.id,
    });
  } catch (error) {
    if (admin && internalOrderId) {
      await admin
        .from("tenant_payment_orders")
        .update({
          internal_status: "failed",
          metadata_json: {
            activation_enabled: false,
            browser_success_not_activation: true,
            error_message:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Unknown Razorpay order creation error.",
            module: "71.7R3",
            provider_response_summary: providerOrderSummary,
            public_launch_pending: true,
          },
        })
        .eq("id", internalOrderId);
    }

    if (getRouteErrorStatus(error) >= 500) {
      captureServerException(error, {
        operation: "razorpay_order_create",
        route: "/api/billing/razorpay/orders",
      });
    }

    return jsonError(getRouteErrorMessage(error), getRouteErrorStatus(error));
  }
}
