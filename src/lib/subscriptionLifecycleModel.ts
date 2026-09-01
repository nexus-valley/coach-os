import type { MemberRole } from "@/src/lib/permissions";

export type TenantOperationalState = {
  effectiveState: "active" | "grace" | "inactive";
  operationalAllowed: boolean;
  tenantId: string;
};

export type TenantSubscriptionLifecycle = {
  assignmentId: string | null;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  effectiveState: string | null;
  gracePeriodEndsAt: string | null;
  operationalAllowed: boolean;
  paymentStatus: string | null;
  reason: string | null;
  storedStatus: string | null;
  tenantId: string;
  trialEndsAt: string | null;
  trialStartedAt: string | null;
};

export type SubscriptionLifecyclePresentationState =
  | "active"
  | "expired_paid"
  | "grace"
  | "needs_attention"
  | "subscription_required"
  | "trial_active"
  | "trial_expired";

export type SubscriptionLifecyclePresentation = {
  accessThrough: string | null;
  badge: string;
  description: string;
  primaryActionHref: string | null;
  primaryActionLabel: string | null;
  secondaryActionHref: string | null;
  secondaryActionLabel: string | null;
  state: SubscriptionLifecyclePresentationState;
  title: string;
};

export type SubscriptionPlanRequestMode = "change" | "selection";

export type InactiveShellMode = "blocked" | "recovery_content" | "recovery_home";

export const inactiveOwnerAdminRecoveryRoutes = [
  "/app",
  "/app/subscription",
  "/app/billing-profile",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeTenantOperationalState(
  value: unknown,
): TenantOperationalState {
  const row = isRecord(value) ? value : {};
  const tenantId = asString(row.tenant_id);
  const effectiveState = asString(row.effective_state);

  if (!tenantId || !["active", "grace", "inactive"].includes(effectiveState ?? "")) {
    throw new Error("Workspace access state is unavailable.");
  }

  return {
    effectiveState: effectiveState as TenantOperationalState["effectiveState"],
    operationalAllowed: row.operational_allowed === true,
    tenantId,
  };
}

export function normalizeTenantSubscriptionLifecycle(
  value: unknown,
): TenantSubscriptionLifecycle {
  const row = isRecord(value) ? value : {};
  const tenantId = asString(row.tenant_id);

  if (!tenantId) {
    throw new Error("Subscription lifecycle is unavailable.");
  }

  return {
    assignmentId: asString(row.assignment_id),
    currentPeriodEnd: asString(row.current_period_end),
    currentPeriodStart: asString(row.current_period_start),
    effectiveState: asString(row.effective_state),
    gracePeriodEndsAt: asString(row.grace_period_ends_at),
    operationalAllowed: row.operational_allowed === true,
    paymentStatus: asString(row.payment_status),
    reason: asString(row.reason),
    storedStatus: asString(row.stored_status),
    tenantId,
    trialEndsAt: asString(row.trial_ends_at),
    trialStartedAt: asString(row.trial_started_at),
  };
}

function presentation(
  state: SubscriptionLifecyclePresentationState,
  accessThrough: string | null = null,
): SubscriptionLifecyclePresentation {
  switch (state) {
    case "active":
      return {
        accessThrough,
        badge: "Workspace active",
        description: "Your CoachFort workspace is available.",
        primaryActionHref: null,
        primaryActionLabel: null,
        secondaryActionHref: null,
        secondaryActionLabel: null,
        state,
        title: "Workspace active",
      };
    case "trial_active":
      return {
        accessThrough,
        badge: "Trial active",
        description: "Your CoachFort trial is active.",
        primaryActionHref: null,
        primaryActionLabel: null,
        secondaryActionHref: null,
        secondaryActionLabel: null,
        state,
        title: "Trial active",
      };
    case "grace":
      return {
        accessThrough,
        badge: "Renewal window",
        description:
          "Your workspace remains available while your subscription is restored.",
        primaryActionHref: "/app/subscription",
        primaryActionLabel: "Review renewal options",
        secondaryActionHref: null,
        secondaryActionLabel: null,
        state,
        title: "Your workspace remains open",
      };
    case "expired_paid":
      return {
        accessThrough: null,
        badge: "Workspace paused",
        description:
          "Your workspace data is safe and will remain available when your subscription is restored.",
        primaryActionHref: "/app/subscription",
        primaryActionLabel: "Review renewal options",
        secondaryActionHref: "/app/billing-profile",
        secondaryActionLabel: "Open billing profile",
        state,
        title: "Workspace access is paused",
      };
    case "trial_expired":
      return {
        accessThrough: null,
        badge: "Trial complete",
        description: "Your workspace data is preserved.",
        primaryActionHref: "/app/subscription",
        primaryActionLabel: "Choose a plan",
        secondaryActionHref: null,
        secondaryActionLabel: null,
        state,
        title: "Your trial has ended",
      };
    case "subscription_required":
      return {
        accessThrough: null,
        badge: "Plan required",
        description:
          "Your workspace data is preserved and ready when a plan is selected.",
        primaryActionHref: "/app/subscription",
        primaryActionLabel: "Choose a plan",
        secondaryActionHref: "/app/billing-profile",
        secondaryActionLabel: "Open billing profile",
        state,
        title: "Choose a CoachFort plan to activate this workspace",
      };
    case "needs_attention":
      return {
        accessThrough: null,
        badge: "Review needed",
        description:
          "Review your CoachFort plan or contact CoachFort support for help restoring access.",
        primaryActionHref: "/app/subscription",
        primaryActionLabel: "Review subscription",
        secondaryActionHref: "/app/billing-profile",
        secondaryActionLabel: "Open billing profile",
        state,
        title: "Subscription needs attention",
      };
  }
}

export function deriveSubscriptionLifecyclePresentation(
  operationalState: TenantOperationalState | null,
  lifecycle: TenantSubscriptionLifecycle | null = null,
): SubscriptionLifecyclePresentation {
  if (!operationalState) {
    return presentation("needs_attention");
  }

  if (operationalState.operationalAllowed) {
    if (lifecycle?.storedStatus === "trial") {
      return presentation("trial_active", lifecycle.trialEndsAt);
    }

    if (operationalState.effectiveState === "grace") {
      return presentation("grace", lifecycle?.gracePeriodEndsAt ?? null);
    }

    return presentation("active");
  }

  if (!lifecycle) {
    return presentation("needs_attention");
  }

  if (!lifecycle.assignmentId && lifecycle.reason === "missing_canonical_assignment") {
    return presentation("subscription_required");
  }

  if (lifecycle.storedStatus === "trial" && lifecycle.reason === "trial_period_elapsed") {
    return presentation("trial_expired");
  }

  if (lifecycle.reason === "grace_period_elapsed") {
    return presentation("expired_paid");
  }

  return presentation("needs_attention");
}

export function isInactiveLifecycleState(
  state: SubscriptionLifecyclePresentationState,
) {
  return !["active", "grace", "trial_active"].includes(state);
}

export function getSubscriptionPlanRequestMode(
  state: SubscriptionLifecyclePresentationState,
): SubscriptionPlanRequestMode {
  return ["subscription_required", "trial_active", "trial_expired"].includes(
    state,
  )
    ? "selection"
    : "change";
}

function normalizePathname(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function getInactiveShellMode(
  role: MemberRole | null | undefined,
  pathname: string,
): InactiveShellMode {
  if (role !== "owner" && role !== "admin") {
    return "blocked";
  }

  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === "/app") {
    return "recovery_home";
  }

  return inactiveOwnerAdminRecoveryRoutes.includes(
    normalizedPathname as (typeof inactiveOwnerAdminRecoveryRoutes)[number],
  )
    ? "recovery_content"
    : "blocked";
}
