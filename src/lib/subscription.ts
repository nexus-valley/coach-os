import {
  getPlanLimits,
  normalizePlanKey,
  type PlanKey,
  type PlanResource,
  type ResourceLimit,
} from "@/src/lib/plans";
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
  void tenantId;
  void plan;
  throw new Error(
    "Legacy subscription billing writes are retired. Manage subscriptions from the Platform Console.",
  );
}
