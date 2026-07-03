import {
  normalizePlanKey,
  type PlanKey,
} from "@/src/lib/plans";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getTrialLifecycleState, getTrialStatus } from "@/src/lib/usage";

export type BillingCycle = "monthly" | "yearly";
export type SubscriptionLifecycleStatus =
  | "active"
  | "canceled"
  | "expired"
  | "past_due"
  | "trialing";
export type SubscriptionAccessState =
  | "active"
  | "blocked"
  | "grace_period"
  | "read_only"
  | "trialing";

export type BillingSubscription = {
  amount: number;
  billing_cycle: BillingCycle;
  cancel_at_period_end?: boolean;
  canceled_at: string | null;
  created_at: string;
  currency: string;
  current_period_end?: string | null;
  current_period_start?: string | null;
  grace_period_ends_at: string | null;
  id: string;
  metadata_json?: Record<string, unknown>;
  plan_code: string;
  provider?: string | null;
  provider_subscription_id?: string | null;
  renewal_at: string | null;
  started_at: string;
  status: SubscriptionLifecycleStatus;
  tenant_id: string;
  trial_ends_at?: string | null;
  updated_at: string;
};

export type CreateSubscriptionInput = {
  amount?: number;
  billingCycle?: BillingCycle;
  currency?: string;
  gracePeriodEndsAt?: string | null;
  planCode: string;
  renewalAt?: string | null;
  status?: SubscriptionLifecycleStatus;
  tenantId: string;
};

const baseSubscriptionSelect =
  "id,tenant_id,plan_code,status,billing_cycle,amount,currency,started_at,renewal_at,canceled_at,grace_period_ends_at,created_at,updated_at";
const subscriptionSelect = `${baseSubscriptionSelect},provider,provider_subscription_id,cancel_at_period_end,current_period_start,current_period_end,trial_ends_at,metadata_json`;

function normalizeSubscription(row: BillingSubscription) {
  return {
    ...row,
    amount: Number(row.amount || 0),
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
    metadata_json: row.metadata_json ?? {},
  } satisfies BillingSubscription;
}

function isMissingSchemaError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function legacySubscriptionBillingWriteRetired(): never {
  throw new Error(
    "Legacy subscription billing writes are retired. Manage subscriptions from the Platform Console.",
  );
}

async function getTenantFallbackSubscription(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id,plan,subscription_status,plan_started_at,plan_renews_at")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const trialStatus = await getTrialStatus(tenantId);
  const plan = normalizePlanKey(data.plan);
  const status =
    data.subscription_status === "cancelled"
      ? "canceled"
      : trialStatus.active
        ? "trialing"
        : data.subscription_status === "past_due"
          ? "past_due"
          : "active";

  return {
    amount: 0,
    billing_cycle: "monthly",
    canceled_at: null,
    cancel_at_period_end: false,
    created_at: data.plan_started_at ?? new Date().toISOString(),
    currency: "INR",
    current_period_end: data.plan_renews_at ?? trialStatus.endsAt,
    current_period_start: data.plan_started_at ?? trialStatus.startedAt,
    grace_period_ends_at: null,
    id: `fallback-${tenantId}`,
    metadata_json: {},
    plan_code: plan,
    provider: null,
    provider_subscription_id: null,
    renewal_at: data.plan_renews_at ?? trialStatus.endsAt,
    started_at: data.plan_started_at ?? trialStatus.startedAt ?? new Date().toISOString(),
    status,
    tenant_id: tenantId,
    trial_ends_at: trialStatus.endsAt,
    updated_at: data.plan_started_at ?? new Date().toISOString(),
  } satisfies BillingSubscription;
}

export async function getCurrentSubscription(tenantId: string) {
  await requireTenantPermission({
    description: "Blocked billing subscription access without billing permission.",
    permission: "access_subscription",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const fullResult = await supabase
    .from("subscriptions")
    .select(subscriptionSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fullResult.error) {
    if (!isMissingSchemaError(fullResult.error)) {
      throw fullResult.error;
    }

    if (fullResult.error.code === "42P01" || fullResult.error.code === "PGRST205") {
      return getTenantFallbackSubscription(tenantId);
    }

    const fallbackResult = await supabase
      .from("subscriptions")
      .select(baseSubscriptionSelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackResult.error) {
      if (isMissingSchemaError(fallbackResult.error)) {
        return getTenantFallbackSubscription(tenantId);
      }

      throw fallbackResult.error;
    }

    return fallbackResult.data
      ? normalizeSubscription(fallbackResult.data as BillingSubscription)
      : getTenantFallbackSubscription(tenantId);
  }

  return fullResult.data
    ? normalizeSubscription(fullResult.data as BillingSubscription)
    : getTenantFallbackSubscription(tenantId);
}

export async function createSubscription(input: CreateSubscriptionInput) {
  void input;
  legacySubscriptionBillingWriteRetired();
}

export async function cancelSubscription(tenantId: string, subscriptionId: string) {
  void tenantId;
  void subscriptionId;
  legacySubscriptionBillingWriteRetired();
}

export async function getCurrentSubscriptionStatus(tenantId: string) {
  const subscription = await getCurrentSubscription(tenantId);

  return {
    accessState: getSubscriptionAccessState(subscription),
    billingCycle: subscription?.billing_cycle ?? "monthly",
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    currentPeriodEnd: subscription?.current_period_end ?? subscription?.renewal_at ?? null,
    plan: normalizePlanKey(subscription?.plan_code),
    provider: subscription?.provider ?? "manual",
    status: subscription?.status ?? "trialing",
    subscription,
  };
}

export async function getBillingAccessState(tenantId: string) {
  const [subscriptionStatus, trialLifecycle] = await Promise.all([
    getCurrentSubscriptionStatus(tenantId),
    getTrialLifecycleState(tenantId),
  ]);

  return {
    ...subscriptionStatus,
    trialLifecycle,
  };
}

export async function updateWorkspacePlanManual(params: {
  billingCycle?: BillingCycle;
  plan: PlanKey;
  tenantId: string;
}) {
  void params;
  legacySubscriptionBillingWriteRetired();
}

export function getSubscriptionAccessState(
  subscription: BillingSubscription | null,
): SubscriptionAccessState {
  if (!subscription) {
    return "trialing";
  }

  if (subscription.status === "active") {
    return "active";
  }

  if (subscription.status === "trialing") {
    return "trialing";
  }

  if (
    subscription.status === "past_due" &&
    subscription.grace_period_ends_at &&
    new Date(subscription.grace_period_ends_at).getTime() > Date.now()
  ) {
    return "grace_period";
  }

  if (subscription.status === "past_due" || subscription.status === "canceled") {
    return "read_only";
  }

  return "blocked";
}
