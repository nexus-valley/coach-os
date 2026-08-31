import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveSubscriptionLifecyclePresentation,
  getInactiveShellMode,
  inactiveOwnerAdminRecoveryRoutes,
  normalizeTenantOperationalState,
  normalizeTenantSubscriptionLifecycle,
  type TenantOperationalState,
  type TenantSubscriptionLifecycle,
} from "../../src/lib/subscriptionLifecycleModel";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const activeOperationalState = {
  effectiveState: "active",
  operationalAllowed: true,
  tenantId: "tenant-a",
} satisfies TenantOperationalState;

const inactiveOperationalState = {
  effectiveState: "inactive",
  operationalAllowed: false,
  tenantId: "tenant-a",
} satisfies TenantOperationalState;

function lifecycle(
  overrides: Partial<TenantSubscriptionLifecycle> = {},
): TenantSubscriptionLifecycle {
  return {
    assignmentId: "assignment-a",
    effectiveState: "expired",
    gracePeriodEndsAt: null,
    operationalAllowed: false,
    reason: "grace_period_elapsed",
    storedStatus: "active",
    tenantId: "tenant-a",
    trialEndsAt: null,
    ...overrides,
  };
}

test.describe("UX-8G2A lifecycle-aware workspace shell", () => {
  test("1. normalizes the auth-bound operational state without client lifecycle math", () => {
    expect(
      normalizeTenantOperationalState({
        effective_state: "grace",
        operational_allowed: true,
        reason: "operational",
        tenant_id: "tenant-a",
      }),
    ).toEqual({
      effectiveState: "grace",
      operationalAllowed: true,
      tenantId: "tenant-a",
    });
  });

  test("2. maps active state without an intrusive recovery action", () => {
    const result = deriveSubscriptionLifecyclePresentation(
      activeOperationalState,
    );

    expect(result.state).toBe("active");
    expect(result.primaryActionHref).toBeNull();
  });

  test("3. maps grace and preserves the canonical access-through date", () => {
    const accessThrough = "2026-09-07T00:00:00.000Z";
    const result = deriveSubscriptionLifecyclePresentation(
      { ...activeOperationalState, effectiveState: "grace" },
      lifecycle({
        effectiveState: "grace",
        gracePeriodEndsAt: accessThrough,
        operationalAllowed: true,
        reason: "within_fixed_grace_period",
      }),
    );

    expect(result.state).toBe("grace");
    expect(result.accessThrough).toBe(accessThrough);
    expect(result.primaryActionLabel).toBe("Review renewal options");
  });

  test("4. maps a paid expiry to paused workspace recovery", () => {
    const result = deriveSubscriptionLifecyclePresentation(
      inactiveOperationalState,
      lifecycle(),
    );

    expect(result.state).toBe("expired_paid");
    expect(result.title).toBe("Workspace access is paused");
    expect(result.secondaryActionHref).toBe("/app/billing-profile");
  });

  test("5. distinguishes active and expired trials", () => {
    const trial = lifecycle({
      effectiveState: "active",
      operationalAllowed: true,
      reason: "within_trial_period",
      storedStatus: "trial",
      trialEndsAt: "2026-09-10T00:00:00.000Z",
    });
    const active = deriveSubscriptionLifecyclePresentation(
      activeOperationalState,
      trial,
    );
    const expired = deriveSubscriptionLifecyclePresentation(
      inactiveOperationalState,
      {
        ...trial,
        effectiveState: "expired",
        operationalAllowed: false,
        reason: "trial_period_elapsed",
      },
    );

    expect(active.state).toBe("trial_active");
    expect(expired.state).toBe("trial_expired");
    expect(expired.primaryActionLabel).toBe("Choose a plan");
  });

  test("6. maps a zero-assignment workspace to plan selection, not renewal", () => {
    const result = deriveSubscriptionLifecyclePresentation(
      inactiveOperationalState,
      lifecycle({
        assignmentId: null,
        reason: "missing_canonical_assignment",
        storedStatus: null,
      }),
    );

    expect(result.state).toBe("subscription_required");
    expect(result.title).toBe(
      "Choose a CoachFort plan to activate this workspace",
    );
    expect(`${result.title} ${result.primaryActionLabel}`).not.toMatch(
      /expired|renew/i,
    );
  });

  test("7. fails unavailable or malformed authority into customer-safe copy", () => {
    const result = deriveSubscriptionLifecyclePresentation(
      inactiveOperationalState,
      lifecycle({ reason: "invalid_grace_authority" }),
    );
    const renderedModel = JSON.stringify(result);

    expect(result.state).toBe("needs_attention");
    for (const internalReason of [
      "invalid_grace_authority",
      "grace_period_elapsed",
      "missing_canonical_assignment",
      "operational_allowed",
    ]) {
      expect(renderedModel).not.toContain(internalReason);
    }
  });

  test("8. normalizes detailed lifecycle evidence without exposing extra payload", () => {
    expect(
      normalizeTenantSubscriptionLifecycle({
        assignment_id: "assignment-a",
        effective_state: "expired",
        grace_period_ends_at: "2026-08-27T00:00:00.000Z",
        operational_allowed: false,
        payment_status: "overdue",
        reason: "grace_period_elapsed",
        stored_status: "past_due",
        tenant_id: "tenant-a",
        trial_ends_at: null,
      }),
    ).toEqual({
      assignmentId: "assignment-a",
      effectiveState: "expired",
      gracePeriodEndsAt: "2026-08-27T00:00:00.000Z",
      operationalAllowed: false,
      reason: "grace_period_elapsed",
      storedStatus: "past_due",
      tenantId: "tenant-a",
      trialEndsAt: null,
    });
  });

  test("9. allows only the exact Owner and Admin inactive recovery routes", () => {
    expect(inactiveOwnerAdminRecoveryRoutes).toEqual([
      "/app",
      "/app/subscription",
      "/app/billing-profile",
    ]);
    expect(getInactiveShellMode("owner", "/app")).toBe("recovery_home");
    expect(getInactiveShellMode("admin", "/app/subscription/")).toBe(
      "recovery_content",
    );
    expect(getInactiveShellMode("owner", "/app/billing-profile")).toBe(
      "recovery_content",
    );
  });

  test("10. blocks operational routes and gives Staff or Trainer no recovery elevation", () => {
    for (const path of [
      "/app/courses",
      "/app/students",
      "/app/settings",
      "/app/settings/features",
      "/app/subscription/history",
    ]) {
      expect(getInactiveShellMode("owner", path)).toBe("blocked");
    }

    for (const role of ["staff", "trainer"] as const) {
      for (const path of inactiveOwnerAdminRecoveryRoutes) {
        expect(getInactiveShellMode(role, path)).toBe("blocked");
      }
    }
  });

  test("11. integrates lifecycle before generic feature fallback and preserves logout", () => {
    const shell = read("src/components/layout/AppShell.tsx");
    const lifecycleGuard = shell.indexOf(
      "lifecycleInactive && lifecyclePresentation",
    );
    const featureGuard = shell.indexOf("!routeFeatureEnabled");

    expect(shell).toContain("getCurrentTenantOperationalState(currentTenant.id)");
    expect(shell).toContain("getTenantSubscriptionLifecycle(currentTenant.id)");
    expect(lifecycleGuard).toBeGreaterThanOrEqual(0);
    expect(lifecycleGuard).toBeLessThan(featureGuard);
    expect(shell).toContain('lifecycleInactive\n      ? "Workspace paused"');
    expect(shell).toContain("{workspaceStatusLabel}");
    expect(shell).toContain("await supabase.auth.signOut()");
    expect(shell).toContain('router.replace("/login")');
  });

  test("12. retains backend feature and role authority and avoids payment claims", () => {
    const shell = read("src/components/layout/AppShell.tsx");
    const panel = read(
      "src/components/subscription/InactiveWorkspacePanel.tsx",
    );
    const banner = read(
      "src/components/subscription/SubscriptionLifecycleBanner.tsx",
    );
    const adapter = read("src/lib/subscriptionLifecycle.ts");

    expect(shell).toContain("canAccessNavigationItem(currentRole, activeItem)");
    expect(shell).toContain("isFeatureEnabled(featureAccess, activeFeatureKey)");
    expect(adapter).toContain('"get_current_tenant_operational_state"');
    expect(adapter).toContain('"get_tenant_subscription_lifecycle"');

    for (const source of [shell, panel, banner]) {
      expect(source).not.toMatch(/Pay now|Razorpay|canonical assignment/i);
    }
  });
});
