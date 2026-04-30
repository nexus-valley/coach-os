import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type SubscriptionPlan = "free" | "starter" | "pro" | "business";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled";
export type LimitedResource = "automations" | "cohorts" | "courses" | "students";
export type ResourceLimit = number | "unlimited";

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

const validPlans: SubscriptionPlan[] = ["free", "starter", "pro", "business"];
const validStatuses: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "cancelled",
];

const planLimits: Record<SubscriptionPlan, PlanLimits> = {
  business: {
    automations: "unlimited",
    cohorts: "unlimited",
    courses: "unlimited",
    students: "unlimited",
  },
  free: {
    automations: 1,
    cohorts: 2,
    courses: 2,
    students: 25,
  },
  pro: {
    automations: 25,
    cohorts: 50,
    courses: 50,
    students: 1000,
  },
  starter: {
    automations: 5,
    cohorts: 10,
    courses: 10,
    students: 250,
  },
};

function normalizePlan(value: unknown): SubscriptionPlan {
  return validPlans.includes(value as SubscriptionPlan)
    ? (value as SubscriptionPlan)
    : "free";
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

export function getPlanLimits(plan: SubscriptionPlan) {
  return planLimits[plan];
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
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .update({
      plan,
      plan_started_at: new Date().toISOString(),
      subscription_status: "active",
    })
    .eq("id", tenantId)
    .select(subscriptionSelect)
    .single();

  if (error) {
    throw error;
  }

  return normalizeSubscription(data as TenantSubscription);
}
