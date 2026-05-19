import { logActivity } from "@/src/lib/auditLogger";
import {
  getPlanLimits,
  getStoredPlanForPlanKey,
  normalizePlanKey,
  type PlanKey,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type SubscriptionPlan = PlanKey;
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled";
export type LimitedResource = PlanResource;
export type { ResourceLimit };

export type TenantSubscription = {
  id: string;
  name: string;
  plan: SubscriptionPlan;
  plan_renews_at: string | null;
  plan_started_at: string | null;
  subscription_status: SubscriptionStatus;
};

export type PlanLimits = Record<LimitedResource, ResourceLimit>;

const subscriptionSelect =
  "id,name,plan,subscription_status,plan_started_at,plan_renews_at";

const validStatuses: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "cancelled",
];

function normalizePlan(value: unknown): SubscriptionPlan {
  return normalizePlanKey(value);
}

function normalizeStatus(value: unknown): SubscriptionStatus {
  return validStatuses.includes(value as SubscriptionStatus)
    ? (value as SubscriptionStatus)
    : "active";
}

function normalizeSubscription(value: TenantSubscription): TenantSubscription {
  return {
    ...value,
    plan: normalizePlan(value.plan),
    subscription_status: normalizeStatus(value.subscription_status),
  };
}

export function canCreateResource(
  plan: SubscriptionPlan,
  resourceType: LimitedResource,
  currentCount: number,
) {
  const limit = getPlanLimits(plan)[resourceType];

  return limit === "unlimited" || currentCount < limit;
}

export async function getTenantSubscription(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(subscriptionSelect)
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? normalizeSubscription(data as TenantSubscription) : null;
}

export async function updateTenantPlanForTesting(
  tenantId: string,
  plan: SubscriptionPlan,
) {
  await requireTenantPermission({
    description: "Blocked subscription plan change without owner permission.",
    permission: "access_subscription",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .update({
      plan: getStoredPlanForPlanKey(plan),
      plan_started_at: new Date().toISOString(),
      subscription_status: "active",
    })
    .eq("id", tenantId)
    .select(subscriptionSelect)
    .single();

  if (error) {
    throw error;
  }

  const subscription = normalizeSubscription(data as TenantSubscription);

  await logActivity({
    action: "plan_updated",
    description: `Changed testing plan to ${subscription.plan}`,
    entityId: subscription.id,
    entityName: subscription.plan,
    entityType: "subscription",
    metadata: { plan: subscription.plan },
    severity: "critical",
    tenantId: subscription.id,
  });

  return subscription;
}
