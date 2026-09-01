import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveSubscriptionLifecyclePresentation,
  getSubscriptionPlanRequestMode,
  normalizeTenantSubscriptionLifecycle,
  type TenantOperationalState,
  type TenantSubscriptionLifecycle,
} from "../../src/lib/subscriptionLifecycleModel";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const subscriptionPage = () =>
  read("src/components/subscription/SubscriptionPageClient.tsx");
const dashboardPage = () =>
  read("src/components/dashboard/DashboardPageClient.tsx");

const activeState = {
  effectiveState: "active",
  operationalAllowed: true,
  tenantId: "tenant-a",
} satisfies TenantOperationalState;

const inactiveState = {
  effectiveState: "inactive",
  operationalAllowed: false,
  tenantId: "tenant-a",
} satisfies TenantOperationalState;

function lifecycle(
  overrides: Partial<TenantSubscriptionLifecycle> = {},
): TenantSubscriptionLifecycle {
  return {
    assignmentId: "assignment-a",
    currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    currentPeriodStart: "2026-08-31T00:00:00.000Z",
    effectiveState: "active",
    gracePeriodEndsAt: null,
    operationalAllowed: true,
    paymentStatus: "paid",
    reason: "within_current_period",
    storedStatus: "active",
    tenantId: "tenant-a",
    trialEndsAt: null,
    trialStartedAt: null,
    ...overrides,
  };
}

test.describe("UX-8G2B canonical subscription lifecycle presentation", () => {
  test("1. retains canonical payment, current-period, and trial evidence", () => {
    expect(
      normalizeTenantSubscriptionLifecycle({
        assignment_id: "assignment-a",
        current_period_end: "2026-09-30T00:00:00.000Z",
        current_period_start: "2026-08-31T00:00:00.000Z",
        effective_state: "active",
        grace_period_ends_at: null,
        operational_allowed: true,
        payment_status: "paid",
        reason: "within_current_period",
        stored_status: "active",
        tenant_id: "tenant-a",
        trial_ends_at: "2026-09-14T00:00:00.000Z",
        trial_started_at: "2026-08-31T00:00:00.000Z",
      }),
    ).toEqual(lifecycle({
      trialEndsAt: "2026-09-14T00:00:00.000Z",
      trialStartedAt: "2026-08-31T00:00:00.000Z",
    }));
  });

  test("2. maps active and grace from canonical lifecycle dates", () => {
    const active = deriveSubscriptionLifecyclePresentation(
      activeState,
      lifecycle(),
    );
    const graceEndsAt = "2026-10-07T00:00:00.000Z";
    const grace = deriveSubscriptionLifecyclePresentation(
      { ...activeState, effectiveState: "grace" },
      lifecycle({
        effectiveState: "grace",
        gracePeriodEndsAt: graceEndsAt,
        reason: "within_fixed_grace_period",
        storedStatus: "grace",
      }),
    );

    expect(active.state).toBe("active");
    expect(grace.state).toBe("grace");
    expect(grace.accessThrough).toBe(graceEndsAt);
  });

  test("3. distinguishes expired paid, active trial, and expired trial copy", () => {
    const expiredPaid = deriveSubscriptionLifecyclePresentation(
      inactiveState,
      lifecycle({
        effectiveState: "expired",
        operationalAllowed: false,
        reason: "grace_period_elapsed",
      }),
    );
    const trial = lifecycle({
      currentPeriodEnd: null,
      currentPeriodStart: null,
      paymentStatus: "not_required",
      reason: "within_trial_period",
      storedStatus: "trial",
      trialEndsAt: "2026-09-14T00:00:00.000Z",
      trialStartedAt: "2026-08-31T00:00:00.000Z",
    });
    const activeTrial = deriveSubscriptionLifecyclePresentation(activeState, trial);
    const expiredTrial = deriveSubscriptionLifecyclePresentation(inactiveState, {
      ...trial,
      effectiveState: "expired",
      operationalAllowed: false,
      reason: "trial_period_elapsed",
    });

    expect(expiredPaid.title).toBe("Workspace access is paused");
    expect(expiredPaid.description).toMatch(/data is safe/i);
    expect(activeTrial.accessThrough).toBe(trial.trialEndsAt);
    expect(expiredTrial.title).toBe("Your trial has ended");
    expect(expiredTrial.primaryActionLabel).toBe("Choose a plan");
  });

  test("4. keeps zero-assignment and malformed authority customer-safe", () => {
    const zeroAssignment = deriveSubscriptionLifecyclePresentation(
      inactiveState,
      lifecycle({
        assignmentId: null,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        reason: "missing_canonical_assignment",
        storedStatus: null,
      }),
    );
    const malformed = deriveSubscriptionLifecyclePresentation(
      inactiveState,
      lifecycle({ reason: "invalid_grace_authority" }),
    );
    const unavailable = deriveSubscriptionLifecyclePresentation(null, null);

    expect(`${zeroAssignment.title} ${zeroAssignment.description}`).not.toMatch(
      /expired|renew|previous subscription/i,
    );
    expect(zeroAssignment.state).toBe("subscription_required");
    expect(malformed.state).toBe("needs_attention");
    expect(unavailable.title).toBe("Subscription needs attention");
    expect(JSON.stringify([malformed, unavailable])).not.toMatch(
      /invalid_grace_authority|missing_canonical_assignment|operational_allowed/,
    );
  });

  test("5. uses canonical and independently isolated Subscription data sources", () => {
    const source = subscriptionPage();

    for (const call of [
      "getCurrentTenantOperationalState(currentTenant.id)",
      "getTenantSubscriptionLifecycle(currentTenant.id)",
      "getTenantEntitlementState(currentTenant.id)",
      "getTenantBillingProfile(currentTenant.id)",
      "getTenantBillingProfileCompletion(currentTenant.id)",
      "getPlatformBillingDocuments(currentTenant.id)",
      "getTenantRequestablePlanCatalog(currentTenant.id)",
      "getTenantUpgradeRequests({ tenantId: currentTenant.id })",
    ]) {
      expect(source).toContain(call);
    }

    expect(source.match(/isolatedLoad\(/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(source).toContain("billingProfileError");
    expect(source).toContain("billingDocumentsError");
    expect(source).toContain("requestablePlanError");
    expect(source).toContain("upgradeRequestError");
  });

  test("6. never loads or fabricates operational usage for an inactive workspace", () => {
    const source = subscriptionPage();
    const lifecycleGate = source.indexOf(
      "lifecycleResult.data?.operationalState.operationalAllowed",
    );
    const usageCall = source.indexOf("getWorkspaceUsage(currentTenant.id)");

    expect(lifecycleGate).toBeGreaterThanOrEqual(0);
    expect(lifecycleGate).toBeLessThan(usageCall);
    expect(source).toContain(
      "Usage is unavailable while workspace access is paused.",
    );
    expect(source).toContain(
      "No usage totals have been substituted.",
    );
    expect(source).not.toContain("emptyUsage");
  });

  test("7. removes legacy live authority from Subscription and Dashboard", () => {
    for (const source of [subscriptionPage(), dashboardPage()]) {
      for (const legacy of [
        "getTenantSubscription(",
        "getTrialStatus(",
        "refreshWorkspaceUsageSnapshot(",
        "getBillingSummary(",
        "getPlanLimits(",
        "plan_started_at",
        "plan_renews_at",
        "subscription_status",
      ]) {
        expect(source).not.toContain(legacy);
      }
    }
  });

  test("8. Dashboard uses canonical lifecycle, entitlement warnings, and real usage", () => {
    const source = dashboardPage();

    expect(source).toContain("getCurrentTenantOperationalState(currentTenant.id)");
    expect(source).toContain("getTenantSubscriptionLifecycle(currentTenant.id)");
    expect(source).toContain("getTenantEntitlementState(currentTenant.id)");
    expect(source).toContain("getWorkspaceUsage(currentTenant.id)");
    expect(source).toContain("canonicalEntitlement?.warnings ?? []");
    expect(source).not.toMatch(/limit\s*\*\s*0\.8|daysRemaining|<=\s*3/);
  });

  test("9. keeps same-plan help separate from controlled plan-change requests", () => {
    const source = subscriptionPage();

    expect(source).toContain('href="/support"');
    expect(source).toContain("Get renewal help");
    expect(source).toContain("requestPlanUpgrade({");
    expect(source).toContain('id="plan-options"');
    expect(source).not.toMatch(/requestPlanUpgrade\([\s\S]{0,300}renew/i);
  });

  test("10. maps first-plan and paid plan-request copy from lifecycle presentation", () => {
    for (const state of [
      "subscription_required",
      "trial_active",
      "trial_expired",
    ] as const) {
      expect(getSubscriptionPlanRequestMode(state)).toBe("selection");
    }

    for (const state of ["active", "grace", "expired_paid"] as const) {
      expect(getSubscriptionPlanRequestMode(state)).toBe("change");
    }

    const source = subscriptionPage();
    const normalizedSource = source.replace(/\s+/g, " ");
    expect(source).toContain("Choose a CoachFort plan");
    expect(source).toContain("Ask CoachFort to review your plan selection");
    expect(source).toContain("Submit plan request");
    expect(source).toContain("Request a plan change");
    expect(source).toContain("Submit plan change request");
    expect(source).toContain("Plan selections require CoachFort review.");
    expect(source).toContain("Choose a plan below or contact CoachFort support.");
    expect(normalizedSource).toContain(
      "Workspace access and billing remain unchanged until CoachFort confirms the selection.",
    );
    expect(source).toContain("Plan changes require CoachFort review.");
    expect(source).toContain("Request a plan change below or contact CoachFort support.");
    expect(source).not.toContain('"Request plan upgrade"');
    expect(source).not.toContain('"Submit upgrade request"');
  });

  test("11. preserves Owner/Admin authorization without role elevation", () => {
    const source = subscriptionPage();

    expect(source).toContain("canAccessSubscription(currentRole)");
    expect(source).toContain("getCurrentMemberRole(currentTenant.id, user.id)");
    expect(source).toContain("<AccessDeniedCard");
    expect(source).toContain(
      "Subscription and billing controls are available to workspace Owners and Admins.",
    );
    expect(source).not.toContain("workspace owners only");
    expect(source).not.toMatch(/currentRole\s*===\s*["']staff["'][\s\S]{0,100}subscription/i);
    expect(source).not.toMatch(/currentRole\s*===\s*["']trainer["'][\s\S]{0,100}subscription/i);
  });

  test("12. renders customer-safe entitlement details without internal jargon", () => {
    const source = subscriptionPage();

    for (const internalPresentation of [
      'label="Payment required"',
      'label="Online payment required"',
      'label="Warnings"',
      "limit.override_type",
      "limit.enforcement_mode",
      "formatCanonicalStatus(feature?.effective_status",
    ]) {
      expect(source).not.toContain(internalPresentation);
    }

    expect(source).toContain("featureAvailability(feature?.effective_status)");
    expect(source).toContain('label: "Available"');
    expect(source).toContain('label: "Coming soon"');
    expect(source).toContain('label: "Contact CoachFort"');
    expect(source).toContain('label: "Not available"');
    expect(source).toContain('status === "coming_soon"');
    expect(source).toContain('return value ? "Yes" : "No";');
    expect(source).not.toContain('return value ? "true" : "false";');
    expect(source).toContain("Current usage needs attention for this plan limit.");

    for (const technicalCopy of [
      "recorded by CoachFort subscription authority",
      "tenant users",
      "Platform-managed",
    ]) {
      expect(source).not.toContain(technicalCopy);
    }

    expect(source).toContain(
      "Review your current plan, billing cycle, payment status, and billing period.",
    );
    expect(source).toContain("workspace members");
    expect(source).toContain("Managed by CoachFort");
  });

  test("13. keeps evergreen billing readiness and CoachFort documents mobile-readable", () => {
    const source = subscriptionPage();

    expect(source).toContain("getPlatformBillingDocuments(currentTenant.id)");
    expect(source).toContain("Subscription invoices and payment receipts issued by CoachFort.");
    expect(source).toContain('className="divide-y divide-white/10 md:hidden"');
    expect(source).toContain('className="min-h-11 w-full"');
    expect(source).toContain(
      "for CoachFort invoices, payment receipts, and renewal support",
    );
    expect(source).toContain(
      'completionUnavailable ? "Unavailable" : `${completion.completion_score}%`',
    );
    expect(source).not.toContain("completion?.completion_score ?? 0");
    expect(source).toContain(
      'billingDocumentsError ? "Unavailable" : `${billingDocuments.length} records`',
    );
    expect(source).not.toContain("invoice workflows go live");
    expect(source).not.toMatch(/Student Finance|finance_invoices|finance_receipts/);
  });

  test("14. introduces no checkout, provider, or instant-activation action", () => {
    for (const source of [subscriptionPage(), dashboardPage()]) {
      expect(source).not.toMatch(
        /Pay now|Renew now|Complete payment|Instant activation|Activate subscription|Razorpay/i,
      );
      expect(source).not.toMatch(/create.*payment.*order|activate.*subscription/i);
    }
  });
});
