import { logActivity } from "@/src/lib/auditLogger";
import { getPlanDisplayName, normalizePlanKey } from "@/src/lib/plans";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getTrialStatus } from "@/src/lib/usage";

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
  canceled_at: string | null;
  created_at: string;
  currency: string;
  grace_period_ends_at: string | null;
  id: string;
  plan_code: string;
  renewal_at: string | null;
  started_at: string;
  status: SubscriptionLifecycleStatus;
  tenant_id: string;
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

const subscriptionSelect =
  "id,tenant_id,plan_code,status,billing_cycle,amount,currency,started_at,renewal_at,canceled_at,grace_period_ends_at,created_at,updated_at";

function normalizeSubscription(row: BillingSubscription) {
  return {
    ...row,
    amount: Number(row.amount || 0),
  } satisfies BillingSubscription;
}

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
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
    created_at: data.plan_started_at ?? new Date().toISOString(),
    currency: "INR",
    grace_period_ends_at: null,
    id: `fallback-${tenantId}`,
    plan_code: plan,
    renewal_at: data.plan_renews_at ?? trialStatus.endsAt,
    started_at: data.plan_started_at ?? trialStatus.startedAt ?? new Date().toISOString(),
    status,
    tenant_id: tenantId,
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
  const { data, error } = await supabase
    .from("subscriptions")
    .select(subscriptionSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return getTenantFallbackSubscription(tenantId);
    }

    throw error;
  }

  return data
    ? normalizeSubscription(data as BillingSubscription)
    : getTenantFallbackSubscription(tenantId);
}

export async function createSubscription(input: CreateSubscriptionInput) {
  await requireTenantPermission({
    description: "Blocked subscription creation without billing permission.",
    permission: "access_subscription",
    tenantId: input.tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      amount: Math.max(0, Number(input.amount) || 0),
      billing_cycle: input.billingCycle ?? "monthly",
      currency: input.currency ?? "INR",
      grace_period_ends_at: input.gracePeriodEndsAt ?? null,
      plan_code: normalizePlanKey(input.planCode),
      renewal_at: input.renewalAt ?? null,
      status: input.status ?? "trialing",
      tenant_id: input.tenantId,
    })
    .select(subscriptionSelect)
    .single();

  if (error) {
    throw error;
  }

  const subscription = normalizeSubscription(data as BillingSubscription);

  await logActivity({
    action: "subscription_created",
    description: `Created ${getPlanDisplayName(subscription.plan_code)} subscription foundation.`,
    entityId: subscription.id,
    entityName: subscription.plan_code,
    entityType: "subscription",
    metadata: {
      billingCycle: subscription.billing_cycle,
      status: subscription.status,
    },
    tenantId: input.tenantId,
  });

  return subscription;
}

export async function cancelSubscription(tenantId: string, subscriptionId: string) {
  await requireTenantPermission({
    description: "Blocked subscription cancellation without billing permission.",
    permission: "access_subscription",
    tenantId,
  });

  if (subscriptionId.startsWith("fallback-")) {
    throw new Error("Create a billing subscription record before cancellation.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .update({
      canceled_at: new Date().toISOString(),
      status: "canceled",
    })
    .eq("tenant_id", tenantId)
    .eq("id", subscriptionId)
    .select(subscriptionSelect)
    .single();

  if (error) {
    throw error;
  }

  const subscription = normalizeSubscription(data as BillingSubscription);

  await logActivity({
    action: "subscription_canceled",
    description: `Canceled ${getPlanDisplayName(subscription.plan_code)} subscription.`,
    entityId: subscription.id,
    entityName: subscription.plan_code,
    entityType: "subscription",
    metadata: { billingCycle: subscription.billing_cycle },
    severity: "critical",
    tenantId,
  });

  return subscription;
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
