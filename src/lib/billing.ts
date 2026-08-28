import {
  getBillingCountryDisplayName,
  getTenantBillingProfile,
} from "@/src/lib/billingProfile";
import { getPlatformBillingDocuments } from "@/src/lib/platformBillingDocuments";
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
  billingCurrency: string;
  taxRegistrationId: string;
  taxRegistrationType: string;
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

export async function getBillingProfile(tenantId: string): Promise<BillingProfile> {
  await requireTenantPermission({
    description: "Blocked billing profile access without billing permission.",
    permission: "access_subscription",
    tenantId,
  });

  const profile = await getTenantBillingProfile(tenantId);

  return {
    billingAddress: {
      city: profile.city ?? "",
      country: getBillingCountryDisplayName(profile.country),
      line1: profile.address_line1 ?? "",
      line2: profile.address_line2 ?? "",
      postalCode: profile.postal_code ?? "",
      state: profile.state ?? "",
    },
    billingCurrency: profile.preferred_currency ?? "",
    billingEmail: profile.billing_email ?? "",
    billingStatus: profile.id ? "configured" : "not_configured",
    featureFlags: {},
    taxRegistrationId: profile.tax_id ?? "",
    taxRegistrationType: profile.tax_registration_type,
  };
}

export async function updateBillingProfile(input: BillingProfileInput) {
  void input;
  throw new Error(
    "Legacy subscription billing writes are retired. Manage subscriptions from the Platform Console.",
  );
}

export async function getBillingSummary(tenantId: string) {
  const [subscription, billingDocuments, billingProfile, usage] =
    await Promise.all([
      getCurrentSubscription(tenantId),
      getPlatformBillingDocuments(tenantId),
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
    billingDocuments,
    billingProfile,
    currentSubscriptionStatus,
    planRecommendation: getPlanUpgradeRecommendation(
      usageForRecommendation,
      subscription?.plan_code,
    ),
    subscription,
  };
}
