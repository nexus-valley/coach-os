export type RazorpayOrderRequest = {
  amount: number;
  currency: "INR";
  receipt: string;
  notes: Record<string, string>;
};

export type RazorpayOrderResponse = {
  id: string;
  entity: "order";
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  offer_id: string | null;
  status: string;
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
};

export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  mode: "test";
  testTenantIds: Set<string>;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function getRazorpayConfig(): RazorpayConfig {
  const mode = requiredEnv("RAZORPAY_MODE");

  if (mode !== "test") {
    throw new Error("Razorpay order creation is restricted to test mode.");
  }

  if (process.env.RAZORPAY_CHECKOUT_TEST_ENABLED?.trim() !== "true") {
    throw new Error("Razorpay checkout test gate is disabled.");
  }

  const testTenantIds = new Set(
    (process.env.RAZORPAY_TEST_TENANT_IDS ?? "")
      .split(",")
      .map((tenantId) => tenantId.trim())
      .filter(Boolean),
  );

  if (testTenantIds.size === 0) {
    throw new Error("RAZORPAY_TEST_TENANT_IDS is not configured.");
  }

  return {
    keyId: requiredEnv("RAZORPAY_KEY_ID"),
    keySecret: requiredEnv("RAZORPAY_KEY_SECRET"),
    mode,
    testTenantIds,
  };
}

export function assertRazorpayTenantAllowed(
  config: RazorpayConfig,
  tenantId: string,
) {
  if (!config.testTenantIds.has(tenantId)) {
    throw new Error("Tenant is not allowlisted for Razorpay test checkout.");
  }
}

export function buildBasicAuthHeader(keyId: string, keySecret: string) {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString(
    "base64",
  )}`;
}

function normalizeRazorpayOrderResponse(value: unknown): RazorpayOrderResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Razorpay returned an invalid order response.");
  }

  const record = value as Partial<RazorpayOrderResponse>;

  if (
    typeof record.id !== "string" ||
    typeof record.amount !== "number" ||
    typeof record.currency !== "string" ||
    typeof record.status !== "string"
  ) {
    throw new Error("Razorpay returned an incomplete order response.");
  }

  return {
    id: record.id,
    entity: "order",
    amount: record.amount,
    amount_paid:
      typeof record.amount_paid === "number" ? record.amount_paid : 0,
    amount_due: typeof record.amount_due === "number" ? record.amount_due : 0,
    currency: record.currency,
    receipt: typeof record.receipt === "string" ? record.receipt : null,
    offer_id: typeof record.offer_id === "string" ? record.offer_id : null,
    status: record.status,
    attempts: typeof record.attempts === "number" ? record.attempts : 0,
    notes:
      record.notes && typeof record.notes === "object" ? record.notes : {},
    created_at:
      typeof record.created_at === "number" ? record.created_at : 0,
  };
}

export async function createRazorpayOrder(
  config: RazorpayConfig,
  payload: RazorpayOrderRequest,
) {
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    body: JSON.stringify(payload),
    headers: {
      Authorization: buildBasicAuthHeader(config.keyId, config.keySecret),
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const responseBody = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      responseBody &&
      typeof responseBody === "object" &&
      "error" in responseBody &&
      responseBody.error &&
      typeof responseBody.error === "object" &&
      "description" in responseBody.error &&
      typeof responseBody.error.description === "string"
        ? responseBody.error.description
        : "Razorpay order creation failed.";

    throw new Error(message);
  }

  return normalizeRazorpayOrderResponse(responseBody);
}
