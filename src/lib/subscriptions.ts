import { logActivity } from "@/src/lib/auditLogger";
import { createNotificationForTenantRoles } from "@/src/lib/notifications";
import {
  getPlanDisplayName,
  getStoredPlanForPlanKey,
  normalizePlanKey,
  type PlanKey,
} from "@/src/lib/plans";
import {
  getMemberRoleForTenant,
  requireTenantPermission,
} from "@/src/lib/permissions";
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

async function requireTenantOwner(tenantId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to manage billing.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (role !== "owner") {
    await logActivity({
      action: "access_denied",
      description: "Blocked owner-only billing management action.",
      entityName: "Billing",
      entityType: "security",
      metadata: { role },
      severity: "warning",
      tenantId,
    });

    throw new Error("Only the workspace owner can change billing settings.");
  }

  return user;
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

async function notifySubscriptionEvent(params: {
  entityId?: string;
  message: string;
  severity?: "critical" | "info" | "warning";
  tenantId: string;
  title: string;
}) {
  try {
    await createNotificationForTenantRoles({
      actionUrl: "/app/subscription",
      entityId: params.entityId,
      entityType: "subscription",
      message: params.message,
      roles: ["owner", "admin"],
      severity: params.severity ?? "info",
      tenantId: params.tenantId,
      title: params.title,
      type: "subscription_notice",
    });
  } catch {
    // Notifications are non-blocking for subscription foundation workflows.
  }
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
      current_period_start: new Date().toISOString(),
      metadata_json: {},
      grace_period_ends_at: input.gracePeriodEndsAt ?? null,
      plan_code: normalizePlanKey(input.planCode),
      renewal_at: input.renewalAt ?? null,
      status: input.status ?? "trialing",
      trial_ends_at: input.status === "trialing" ? input.renewalAt ?? null : null,
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
  await notifySubscriptionEvent({
    entityId: subscription.id,
    message: `${getPlanDisplayName(subscription.plan_code)} subscription foundation is active in ${subscription.status} state.`,
    tenantId: input.tenantId,
    title: "Subscription created",
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
      cancel_at_period_end: true,
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
  await notifySubscriptionEvent({
    entityId: subscription.id,
    message: `${getPlanDisplayName(subscription.plan_code)} subscription was canceled.`,
    severity: "critical",
    tenantId,
    title: "Subscription canceled",
  });

  return subscription;
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
  await requireTenantOwner(params.tenantId);

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(now.getMonth() + (params.billingCycle === "yearly" ? 12 : 1));

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tenants")
    .update({
      billing_status: "manual_active",
      plan: getStoredPlanForPlanKey(params.plan),
      plan_started_at: now.toISOString(),
      plan_renews_at: periodEnd.toISOString(),
      subscription_status: "active",
    })
    .eq("id", params.tenantId)
    .select("id,name,plan,subscription_status,plan_started_at,plan_renews_at")
    .single();

  if (error) {
    throw error;
  }

  await logActivity({
    action: "workspace_plan_changed",
    description: `Manually changed workspace plan to ${getPlanDisplayName(params.plan)}.`,
    entityId: params.tenantId,
    entityName: getPlanDisplayName(params.plan),
    entityType: "subscription",
    metadata: {
      billingCycle: params.billingCycle ?? "monthly",
      plan: params.plan,
      provider: "manual",
    },
    severity: "critical",
    tenantId: params.tenantId,
  });

  await logActivity({
    action: "subscription_status_changed",
    description: "Updated subscription status through manual billing control.",
    entityId: params.tenantId,
    entityName: "manual_active",
    entityType: "subscription",
    metadata: { status: "active" },
    severity: "warning",
    tenantId: params.tenantId,
  });

  return {
    id: data.id,
    name: data.name,
    plan: normalizePlanKey(data.plan),
    plan_renews_at: data.plan_renews_at,
    plan_started_at: data.plan_started_at,
    subscription_status: data.subscription_status,
  };
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
