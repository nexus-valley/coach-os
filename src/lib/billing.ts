import { getInvoices, getPaymentHistory } from "@/src/lib/invoices";
import {
  getAvailablePlans,
  getPlanUpgradeRecommendation,
  type PlanResource,
} from "@/src/lib/plans";
import { requireTenantPermission } from "@/src/lib/permissions";
import {
  getBillingAccessState,
  getCurrentSubscription,
  getSubscriptionAccessState,
} from "@/src/lib/subscriptions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { refreshWorkspaceUsageSnapshot } from "@/src/lib/usage";

export type BillingAddress = {
  city?: string;
  country?: string;
  line1?: string;
  line2?: string;
  postalCode?: string;
  state?: string;
};

export type BillingProfile = {
  billingAddress: BillingAddress;
  billingEmail: string;
  billingGstNumber: string;
  billingStatus: string;
  featureFlags: Record<string, unknown>;
};

export type BillingProfileInput = {
  billingAddress?: BillingAddress;
  billingEmail?: string;
  billingGstNumber?: string;
  billingStatus?: string;
  tenantId: string;
};

function isMissingBillingColumnError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    message.includes("column") ||
    message.includes("schema cache")
  );
}

function normalizeAddress(value: unknown): BillingAddress {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;

  return {
    city: typeof record.city === "string" ? record.city : "",
    country: typeof record.country === "string" ? record.country : "",
    line1: typeof record.line1 === "string" ? record.line1 : "",
    line2: typeof record.line2 === "string" ? record.line2 : "",
    postalCode:
      typeof record.postalCode === "string" ? record.postalCode : "",
    state: typeof record.state === "string" ? record.state : "",
  };
}

export async function getBillingProfile(tenantId: string): Promise<BillingProfile> {
  await requireTenantPermission({
    description: "Blocked billing profile access without billing permission.",
    permission: "access_subscription",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "billing_status,billing_email,billing_gst_number,billing_address_json,feature_flags_json",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    if (isMissingBillingColumnError(error)) {
      return {
        billingAddress: {},
        billingEmail: "",
        billingGstNumber: "",
        billingStatus: "not_configured",
        featureFlags: {},
      };
    }

    throw error;
  }

  return {
    billingAddress: normalizeAddress(data?.billing_address_json),
    billingEmail: data?.billing_email ?? "",
    billingGstNumber: data?.billing_gst_number ?? "",
    billingStatus: data?.billing_status ?? "not_configured",
    featureFlags: data?.feature_flags_json ?? {},
  };
}

export async function updateBillingProfile(input: BillingProfileInput) {
  void input;
  throw new Error(
    "Legacy subscription billing writes are retired. Manage subscriptions from the Platform Console.",
  );
}

export async function getBillingSummary(tenantId: string) {
  const [subscription, invoices, paymentHistory, billingProfile, usage] =
    await Promise.all([
    getCurrentSubscription(tenantId),
    getInvoices(tenantId),
    getPaymentHistory(tenantId),
    getBillingProfile(tenantId),
    refreshWorkspaceUsageSnapshot(tenantId),
  ]);
  const currentSubscriptionStatus = await getBillingAccessState(tenantId);
  const usageForRecommendation = Object.fromEntries(
    Object.entries(usage).map(([key, value]) => [key, value]),
  ) as Partial<Record<PlanResource, number>>;

  return {
    accessState: getSubscriptionAccessState(subscription),
    availablePlans: getAvailablePlans(),
    billingProfile,
    currentSubscriptionStatus,
    invoices,
    paymentHistory,
    planRecommendation: getPlanUpgradeRecommendation(
      usageForRecommendation,
      subscription?.plan_code,
    ),
    subscription,
  };
}
