import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveNoncommercialAccessPresentation,
  deriveSubscriptionLifecyclePresentation,
  isInactiveLifecycleState,
  type TenantOperationalState,
  type TenantSubscriptionLifecycle,
} from "../../src/lib/subscriptionLifecycleModel";
import {
  derivePlatformTenantCommercialControlState,
  type PlatformCommercialSubscriptionEvidence,
  type PlatformCommercialTenantDetail,
} from "../../src/lib/platformCommercialControlState";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const sha256 = (path: string) =>
  createHash("sha256").update(read(path)).digest("hex");

const fixtureHygieneSource = read(
  "supabase/bundle_ux8g3b1_fixture_communication_hygiene.sql",
);
const fixtureHygiene = fixtureHygieneSource.toLowerCase();
const reminderTargeting = read(
  "supabase/bundle_ux8g3b_subscription_lifecycle_reminder_targeting.sql",
).toLowerCase();
const transactionalEmail = read("src/lib/server/transactionalEmail.ts");
const emailTemplates = read("src/lib/server/emailTemplates.ts");
const vercel = read("vercel.json");
const coachSubscription = read(
  "src/components/subscription/SubscriptionPageClient.tsx",
);
const platformConsole = read(
  "src/components/platform/PlatformOwnerConsolePage.tsx",
);
const r2 = read("supabase/regression_r2_noncommercial_access_authority.sql");
const r3b = read("supabase/regression_r3b_commercial_mutation_boundary.sql");
const r3c = read("supabase/regression_r3c_reporting_projection_authority.sql");
const r3g = read("support-ops/regression-r3g-final-first-grant-verifier.sql");

const activeState: TenantOperationalState = {
  effectiveState: "active",
  operationalAllowed: true,
  tenantId: "00000000-0000-4000-8000-000000000001",
};

const noncommercialLifecycle: TenantSubscriptionLifecycle = {
  assignmentId: "00000000-0000-4000-8000-000000000002",
  currentPeriodEnd: null,
  currentPeriodStart: null,
  effectiveState: "active",
  gracePeriodEndsAt: null,
  operationalAllowed: true,
  paymentStatus: "not_required",
  reason: "within_noncommercial_access",
  storedStatus: "noncommercial",
  tenantId: activeState.tenantId,
  trialEndsAt: null,
  trialStartedAt: null,
};

const ordinarySubscription: PlatformCommercialSubscriptionEvidence = {
  commercial_reporting_excluded: false,
  commercial_reporting_exclusion: null,
};

const regressionSubscription: PlatformCommercialSubscriptionEvidence = {
  commercial_reporting_excluded: true,
  commercial_reporting_exclusion: "noncommercial_regression",
};

function platformDetail(
  tenantId: string,
  subscription: PlatformCommercialSubscriptionEvidence,
): PlatformCommercialTenantDetail {
  return {
    subscription,
    tenant: {
      id: tenantId,
    },
  };
}

function between(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `Expected start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `Expected end marker: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function postgresNormalizedFunctionBodySha(
  source: string,
  qualifiedFunctionName: string,
) {
  const escapedName = qualifiedFunctionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create(?: or replace)? function ${escapedName}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected function body for ${qualifiedFunctionName}`).not.toBeNull();
  const postgresBtrimmed = match?.[1].replace(/^ +| +$/g, "") ?? "";
  const normalized = postgresBtrimmed.replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

test.describe("REGRESSION-R3E/R3F/R3G first-grant readiness", () => {
  test("1. lifecycle reminder discovery applies the fixture communication policy", () => {
    expect(fixtureHygiene).toMatch(
      /subscription_lifecycle_reminder_candidates[\s\S]*tenant_allows_automated_customer_communications/,
    );
  });

  test("2. queued lifecycle reminder delivery revalidates the fixture policy", () => {
    expect(fixtureHygiene).toMatch(
      /subscription_lifecycle_reminder_delivery_is_current[\s\S]*tenant_allows_automated_customer_communications/,
    );
  });

  test("3. reminder enqueue consumes only canonical lifecycle candidates", () => {
    expect(reminderTargeting).toContain(
      "subscription_lifecycle_reminder_candidates(now()) candidate",
    );
  });

  test("4. the email worker revalidates lifecycle mail before provider delivery", () => {
    expect(transactionalEmail).toContain(
      'claim.template_key === "billing.subscription_lifecycle"',
    );
    expect(transactionalEmail).toContain(
      "isSubscriptionLifecycleReminderCurrent(claim.outbox_id)",
    );
  });

  test("5. the only commercial lifecycle cron enters the guarded reminder authority", () => {
    expect(vercel).toContain("/api/internal/subscription-lifecycle/reminders");
    expect(vercel).not.toMatch(/renewal[^\n]*cron|payment[^\n]*cron|invoice[^\n]*cron/i);
  });

  test("6. commercial lifecycle templates are explicit and do not include noncommercial", () => {
    for (const event of [
      "trial_ending",
      "trial_expired",
      "renewal_due_soon",
      "grace_started",
      "grace_ending",
      "subscription_expired",
    ]) {
      expect(emailTemplates).toContain(event);
    }
    expect(emailTemplates).not.toContain("noncommercial_renewal");
  });

  test("7. legitimate product communication routes remain available", () => {
    expect(existsSync(join(root, "app/api/onboarding/workspace-ready-email/route.ts"))).toBe(true);
    expect(existsSync(join(root, "app/api/team-invitations/send-email/route.ts"))).toBe(true);
    expect(existsSync(join(root, "app/api/student-portal-invitations/send/route.ts"))).toBe(true);
  });

  test("8. placeholder automation actions do not dispatch an external provider", () => {
    const automation = read("supabase/bundle_ux8g4a2d1_automation_monthly_meter_integration.sql").toLowerCase();
    expect(automation).toContain("send_email_placeholder");
    expect(automation).not.toContain("net.http_post");
    expect(automation).not.toContain("resend.com");
  });

  test("9. active noncommercial authority receives truthful active presentation", () => {
    expect(
      deriveSubscriptionLifecyclePresentation(activeState, noncommercialLifecycle),
    ).toEqual({
      accessThrough: null,
      badge: "Regression access",
      description:
        "Your workspace has Growth product access with no billing or renewal required.",
      primaryActionHref: null,
      primaryActionLabel: null,
      secondaryActionHref: null,
      secondaryActionLabel: null,
      state: "noncommercial",
      title: "Regression access",
    });
    expect(deriveNoncommercialAccessPresentation(activeState)).toEqual({
      badge: "Regression access",
      description:
        "This workspace has Growth product access with no billing or renewal required.",
      planLabel: "Product access",
      state: "active",
      title: "Growth product access",
      workspaceAccess: "Available",
    });
  });

  test("10. active noncommercial access is operational in the application shell", () => {
    expect(isInactiveLifecycleState("noncommercial")).toBe(false);
  });

  test("11. revoked noncommercial evidence remains classified but does not claim access", () => {
    const inactiveState: TenantOperationalState = {
      ...activeState,
      effectiveState: "inactive",
      operationalAllowed: false,
    };
    const result = deriveSubscriptionLifecyclePresentation(
      inactiveState,
      { ...noncommercialLifecycle, effectiveState: "inactive", operationalAllowed: false },
    );
    expect(result.state).toBe("needs_attention");
    expect(deriveNoncommercialAccessPresentation(inactiveState)).toEqual({
      badge: "Regression access inactive",
      description:
        "This workspace retains its noncommercial regression record, but current workspace access is paused. No billing or renewal is required.",
      planLabel: "Regression plan",
      state: "inactive",
      title: "Growth plan retained for regression record",
      workspaceAccess: "Paused",
    });
  });

  test("12. unavailable noncommercial state fails closed without claiming access", () => {
    expect(deriveNoncommercialAccessPresentation(null, true)).toEqual({
      badge: "Regression access status unavailable",
      description:
        "Current workspace access could not be confirmed. No commercial billing action is available.",
      planLabel: "Regression plan",
      state: "unavailable",
      title: "Growth plan retained for regression record",
      workspaceAccess: "Unavailable",
    });
  });

  test("13. Coach detects every durable noncommercial assignment marker", () => {
    expect(coachSubscription).toContain('lifecycle?.storedStatus === "noncommercial"');
    expect(coachSubscription).toContain('assignment?.status === "noncommercial"');
    expect(coachSubscription).toContain(
      'assignment?.source === "platform_noncommercial"',
    );
  });

  test("14. Coach active state shows Growth access with no billing or renewal", () => {
    const branch = between(
      coachSubscription,
      "if (noncommercialEvidence)",
      'actions={<Badge tone={operationalState?.operationalAllowed ? "success" : "warning"}',
    );
    expect(branch).toContain("deriveNoncommercialAccessPresentation");
    expect(branch).toContain('label="Billing required" value="No"');
    expect(branch).toContain('label="Renewal required" value="No"');
  });

  test("15. Coach inactive and unavailable states still suppress commercial controls", () => {
    const branch = between(
      coachSubscription,
      "if (noncommercialEvidence)",
      'actions={<Badge tone={operationalState?.operationalAllowed ? "success" : "warning"}',
    );
    for (const forbidden of [
      "Billing cycle",
      "Currency",
      "Current period",
      "Trial ends",
      "Payment status",
      "PaymentGatewayParkedCard",
      "RequestPlanUpgradePanel",
      "BillingProfileReadinessCard",
    ]) {
      expect(branch).not.toContain(forbidden);
    }
  });

  test("16. Coach regression branch retains canonical entitlement and usage", () => {
    const branch = between(
      coachSubscription,
      "if (noncommercialEvidence)",
      'actions={<Badge tone={operationalState?.operationalAllowed ? "success" : "warning"}',
    );
    expect(branch).toContain("CanonicalEntitlementSummary");
    expect(branch).toContain("Workspace usage");
    expect(branch).toContain("usageLimits.map");
  });

  test("17. commercial to regression transition fails closed before detail resolves", () => {
    const selectedTenantId = "00000000-0000-4000-8000-000000000020";
    const state = derivePlatformTenantCommercialControlState({
      detail: platformDetail(
        "00000000-0000-4000-8000-000000000010",
        ordinarySubscription,
      ),
      detailLoading: true,
      directorySubscription: regressionSubscription,
      selectedTenantId,
    });

    expect(state).toEqual({
      commercialControlsReady: false,
      commercialReportingExcluded: true,
      detailMatchesSelection: false,
      detailReady: false,
    });
  });

  test("18. regression to commercial transition restores controls only for matching detail", () => {
    const selectedTenantId = "00000000-0000-4000-8000-000000000030";
    const staleState = derivePlatformTenantCommercialControlState({
      detail: platformDetail(
        "00000000-0000-4000-8000-000000000020",
        regressionSubscription,
      ),
      detailLoading: true,
      directorySubscription: ordinarySubscription,
      selectedTenantId,
    });
    const readyState = derivePlatformTenantCommercialControlState({
      detail: platformDetail(selectedTenantId, ordinarySubscription),
      detailLoading: false,
      directorySubscription: ordinarySubscription,
      selectedTenantId,
    });

    expect(staleState.commercialControlsReady).toBe(false);
    expect(staleState.detailMatchesSelection).toBe(false);
    expect(readyState).toMatchObject({
      commercialControlsReady: true,
      commercialReportingExcluded: false,
      detailMatchesSelection: true,
      detailReady: true,
    });
  });

  test("19. Platform selection clears stale tenant state and ignores stale responses", () => {
    expect(platformConsole).toContain("setSelectedTenantDetail(null)");
    expect(platformConsole).toContain("setSelectedTenantDetailLoading(tenantId !== null)");
    expect(platformConsole).toContain("selectedTenantIdRef.current !== tenantId");
    expect(platformConsole).toContain("commercialTenantControlsReady");
  });

  test("20. Platform directory supports explicit noncommercial filtering", () => {
    expect(platformConsole).toContain('| "noncommercial"');
    expect(platformConsole).toContain(
      '["all", "noncommercial", "not_set", ...subscriptionStatuses]',
    );
  });

  test("21. Platform durable exclusion wording does not claim current product access", () => {
    expect(platformConsole).toContain("Regression workspace");
    expect(platformConsole).toContain("Noncommercial regression");
    expect(platformConsole).toContain("Noncommercial Growth plan");
    expect(platformConsole).toContain("No billing required");
    expect(platformConsole).toContain("Commercial reporting");
    expect(platformConsole).toContain("Excluded");
    expect(platformConsole).not.toContain("Growth product access");
  });

  test("22. Platform suppresses all commercial panels until matching detail is ready", () => {
    expect(platformConsole).toContain(
      "canManagePlans(adminContext.role) && commercialTenantControlsReady",
    );
    const render = between(
      platformConsole,
      "const selectedTenantControlState",
      "function PlatformHeader",
    );
    for (const panel of [
      "CanonicalAssignmentControlsPanel",
      "ManualActivationPanel",
      "UpgradeRequestReviewPanel",
      "SubscriptionPanel",
    ]) {
      expect(render).toMatch(new RegExp(`commercialTenantControlsReady[\\s\\S]{0,2000}${panel}`));
    }
  });

  test("23. R3C commercial metrics and tenant readers retain permanent exclusion", () => {
    expect(r3c).toContain("tenant_has_noncommercial_regression_evidence");
    expect(r3c).toContain("commercial_reporting_excluded");
    expect(r3c).toContain("noncommercial_regression");
  });

  test("24. Growth entitlement and product limits remain part of R2 authority", () => {
    expect(r2).toContain("where plan.code = 'growth'");
    expect(r2).toContain("v_plan.id");
    expect(r2).toContain("within_noncommercial_access");
    expect(r2).not.toContain("disable_product_entitlements");
  });

  test("25. student-to-coach commerce remains outside consolidated exclusion", () => {
    const studentPayments = read("src/lib/payments.ts");
    expect(studentPayments).not.toContain("noncommercial_regression");
    expect(studentPayments).not.toContain("platform_noncommercial");
  });

  test("26. R2, R3B, and R3C reviewed migration artifacts remain unchanged", () => {
    expect(sha256("supabase/regression_r2_noncommercial_access_authority.sql")).toBe(
      "ee145f7400fc2c0d2d7e352563af5d1aa2d08f036ec275f011a4fea911fd46f0",
    );
    expect(sha256("supabase/regression_r3b_commercial_mutation_boundary.sql")).toBe(
      "82803ab8cb03d3ecdcd3b7409c6d998979f58661b991a667a287c39a26446354",
    );
    expect(sha256("supabase/regression_r3c_reporting_projection_authority.sql")).toBe(
      "9f55cc87f49ecbb55ba8a87a579e96ce137595b3922c03b016c2a042bccd9109",
    );
  });

  test("27. R3B permanent mutation exclusions remain installed in source", () => {
    expect(r3b).toContain("tenant_has_noncommercial_regression_evidence");
    expect(r3b).toContain("create_platform_payment_order_authority_server");
    expect(r3b).toContain("set_tenant_subscription_plan");
    expect(r3b).toContain("update_tenant_subscription");
  });

  test("28. R3D anti-fabrication behavior remains deployed source truth", () => {
    const subscriptions = read("src/lib/subscriptions.ts");
    const billing = read("src/lib/billing.ts");
    expect(subscriptions).not.toContain("getTenantFallbackSubscription");
    expect(subscriptions).toContain('billingCycle: subscription?.billing_cycle ?? null');
    expect(subscriptions).toContain('return "blocked"');
    expect(billing).toMatch(/planRecommendation: subscription[\s\S]*: null/);
  });

  test("29. R3G verifier is transactionally read-only and never invokes grant authority", () => {
    expect(r3g).toContain("begin transaction read only;");
    expect(r3g).toContain("rollback;");
    expect(r3g).toContain("'grant_rpc_invoked', false");
    expect(r3g).toContain("'mutation_executed', false");
    expect(r3g).not.toMatch(/\n\s*(insert into|update|delete from|call)\s/i);
  });

  test("30. R3G pins exact function contracts and rejects unexpected overloads", () => {
    expect(r3g).toContain("expected_functions(");
    expect(r3g).toContain("expected_search_path");
    expect(r3g).toContain("expected_volatility");
    expect(r3g).toContain("authenticated_execute");
    expect(r3g).toContain("service_execute");
    expect(r3g).toContain(
      "coachfort_internal.tenant_subscription_effective_lifecycle(uuid)",
    );
    expect(r3g).toContain(
      "7fe5e83c679119c017fea1fad5780c18d6eed51b44d2694201c0d7ef80cbb206",
    );
    expect(r3g).toContain("regexp_replace(");
    expect(r3g).toContain("btrim(procedure.prosrc)");
    expect(r3g).toContain("public_execute_absent");
    expect(r3g).toContain("no_unexpected_execute_acl");
    expect(r3g).toContain("exact_installed_authority");
    expect(r3g).toContain("function_overload_contract as (");
    expect(r3g).toContain("installed_name_count = 1");
    expect(r3g).toContain("and overloads.no_unexpected_overloads");
  });

  test("31. global commercial evidence is informational and absent from the gate", () => {
    const informational = between(
      r3g,
      "informational_commercial_evidence as (",
      "expired_fixture as (",
    );
    const gate = between(r3g, "gate as (", ")\nselect jsonb_build_object(");

    expect(informational).toContain("false as gates_first_grant_proof");
    for (const value of [
      "payment_orders",
      "payment_attempts",
      "activation_events",
      "manual_activations",
      "change_intents",
      "invoices",
      "receipts",
      "document_fulfillments",
    ]) {
      expect(informational).toContain(value);
      expect(gate).not.toContain(`commercial.${value}`);
    }
    expect(r3g).toContain(
      "'informational_commercial_evidence', to_jsonb(commercial)",
    );
  });

  test("32. zero noncommercial first-grant state remains decisive", () => {
    const gate = between(r3g, "gate as (", ")\nselect jsonb_build_object(");
    for (const value of [
      "first_grant.grants = 0",
      "first_grant.grant_events = 0",
      "first_grant.assignment_markers = 0",
    ]) {
      expect(gate).toContain(value);
    }
    const firstGrant = between(
      r3g,
      "first_grant_state as (",
      "historical_regression_tenant as (",
    );
    expect(firstGrant).not.toContain("tenant_fixture_classifications");
    expect(gate).not.toContain("first_grant.regression_classifications");
  });

  test("33. R3G requires the exact historical UX-8G3B1 classification baseline", () => {
    const historicalTenant = between(
      r3g,
      "historical_regression_tenant as (",
      "historical_regression_classification as (",
    );
    const historical = between(
      r3g,
      "historical_regression_classification as (",
      "informational_commercial_evidence as (",
    );
    const gate = between(r3g, "gate as (", ")\nselect jsonb_build_object(");

    expect(historicalTenant).toContain("29a33701-82ed-4c7f-8042-0a1af8296ce5");
    expect(historical).toContain("tenant.slug = 'coachfort-regression'");
    expect(historical).toContain(
      "tenant.name = 'CoachFort Regression Coaching'",
    );
    expect(historical).toContain("classification.fixture_type = 'regression'");
    expect(historical).toMatch(
      /select count\(\*\)[\s\S]*classification\.fixture_type = 'regression'\) = 1\s+as exact_regression_classification_count/,
    );
    expect(historical).toContain(
      "not classification.automated_customer_communications_enabled",
    );
    expect(historical).toContain(
      "coachfort_internal.tenant_has_noncommercial_regression_evidence(",
    );
    expect(historical).toContain(
      "not coachfort_internal.tenant_allows_automated_customer_communications(",
    );
    expect(historical).not.toContain("tenant_payment_orders");
    expect(historical).not.toContain("manual_subscription_activation_audits");
    expect(historical).toMatch(
      /tenant_noncommercial_access_grants grant_row[\s\S]*grant_row\.tenant_id = historical\.tenant_id[\s\S]*historical_grant_count_zero/,
    );
    expect(historical).toMatch(
      /tenant_noncommercial_access_events event_row[\s\S]*event_row\.tenant_id = historical\.tenant_id[\s\S]*historical_grant_event_count_zero/,
    );
    expect(historical).toMatch(
      /tenant_subscription_assignments assignment[\s\S]*assignment\.tenant_id = historical\.tenant_id[\s\S]*assignment\.status = 'noncommercial'[\s\S]*assignment\.source = 'platform_noncommercial'[\s\S]*assignment\.noncommercial_grant_id is not null[\s\S]*historical_noncommercial_assignment_markers_zero/,
    );
    expect(historical).not.toContain("f93faeee-b177-497e-854e-5052497914b9");

    for (const field of [
      "historical.exact_regression_classification_count",
      "historical.historical_classification_present",
      "historical.historical_tenant_present",
      "historical.historical_tenant_identity_exact",
      "historical.communications_disabled",
      "historical.r3b_regression_evidence_true",
      "historical.r3e_communications_blocked",
      "historical.historical_grant_count_zero",
      "historical.historical_grant_event_count_zero",
      "historical.historical_noncommercial_assignment_markers_zero",
      "historical.no_unexpected_regression_classifications",
    ]) {
      expect(gate).toContain(field);
    }
    expect(historical).toContain("classification.tenant_id <> historical.tenant_id");
    expect(r3g).toContain(
      "'historical_regression_classification', to_jsonb(historical)",
    );
  });

  test("34. R3G preserves the exact expired fixture without reclassification", () => {
    expect(r3g).toContain("f93faeee-b177-497e-854e-5052497914b9");
    expect(r3g).toContain("assignment.status = 'trial'");
    expect(r3g).toContain("assignment.source = 'system'");
    expect(r3g).toContain("assignment.payment_status = 'not_required'");
    expect(r3g).toContain("effective_state_expired");
    expect(r3g).toContain("operational_denied");
    expect(r3g).toContain("no_regression_classification");
    const fixtureState = between(
      r3g,
      "expired_fixture_state as (",
      "gate as (",
    );
    expect(fixtureState).not.toContain("29a33701-82ed-4c7f-8042-0a1af8296ce5");
    const gate = between(r3g, "gate as (", ")\nselect jsonb_build_object(");
    for (const field of [
      "fixture.tenant_present",
      "fixture.exact_current_assignment",
      "fixture.assignment_unchanged",
      "fixture.effective_state_expired",
      "fixture.trial_period_elapsed",
      "fixture.operational_denied",
      "fixture.no_grant",
      "fixture.no_grant_event",
      "fixture.no_regression_classification",
      "fixture.no_payment_order",
      "fixture.no_payment_attempt",
      "fixture.no_invoice",
      "fixture.no_receipt",
      "fixture.no_document_fulfillment",
      "fixture.no_activation",
      "fixture.no_manual_activation",
      "fixture.no_change_intent",
    ]) {
      expect(gate).toContain(field);
    }
  });

  test("35. R3G scopes all commercial-evidence checks to the expired fixture", () => {
    const fixtureState = between(
      r3g,
      "expired_fixture_state as (",
      "gate as (",
    );

    expect(fixtureState).toMatch(
      /public\.tenant_payment_attempts attempt[\s\S]*join public\.tenant_payment_orders payment_order[\s\S]*payment_order\.id = attempt\.payment_order_id[\s\S]*attempt\.tenant_id = fixture\.tenant_id[\s\S]*payment_order\.tenant_id = fixture\.tenant_id/,
    );
    for (const [relation, result] of [
      ["public.invoices", "no_invoice"],
      ["public.platform_billing_receipts", "no_receipt"],
      [
        "public.platform_billing_document_fulfillments",
        "no_document_fulfillment",
      ],
    ]) {
      expect(fixtureState).toMatch(
        new RegExp(
          `not exists \\(select 1 from ${relation.replace(".", "\\.")} row\\s+where row\\.tenant_id = fixture\\.tenant_id\\) as ${result}`,
        ),
      );
    }
    expect(r3g).toContain("'expired_fixture', to_jsonb(fixture)");
  });

  test("36. R3G verifies the exact payment trigger event contract", () => {
    expect(r3g).toContain("trigger.tgtype = 23");
    expect(r3g).toContain("trigger.tgattr::text = tenant_id_attribute.attnum::text");
    expect(r3g).toContain("trigger.tgnargs = 0");
    expect(r3g).toContain("trigger.tgqual is null");
    expect(r3g).toContain("and payment_trigger.exact_payment_boundary");
  });

  test("37. R3G pins all communication functions to reviewed source and security", () => {
    const communicationHashes = {
      "coachfort_internal.subscription_lifecycle_reminder_candidates":
        "f053633e4dff8622de7e1e556f492a53a349c6aa0d01a91810131369be7b658f",
      "coachfort_internal.subscription_lifecycle_reminder_delivery_is_current":
        "999be9b9d83f6ab66230f96465b6dd42d647d7423038e572938e3e71578275e6",
      "coachfort_internal.tenant_allows_automated_customer_communications":
        "71920c857ee2bed9b64a496c794b2eb0aacfa06e3ffbc929568d1ab683a6ec75",
    } as const;

    for (const [name, hash] of Object.entries(communicationHashes)) {
      expect(postgresNormalizedFunctionBodySha(fixtureHygieneSource, name)).toBe(hash);
      expect(r3g).toContain(hash);
    }
    expect(r3g).toContain("exact_communication_authority");
    expect(r3g).toContain("expected.expected_volatility");
    expect(r3g).toContain("expected.expected_search_path");
    expect(r3g).toContain("no_unexpected_execute_acl");
  });

  test("38. communication integration checks tolerate formatting whitespace", () => {
    expect(r3g).toContain("communication_sources as (");
    expect(r3g).toContain("'[[:space:]]+'");
    expect(r3g).toContain("candidate_uses_fixture_policy");
    expect(r3g).toContain("delivery_revalidates_fixture_policy");
    expect(r3g).toContain("position(");
    expect(r3g).not.toContain("lower(pg_get_functiondef");
  });

  test("39. application code contains no hardcoded regression identity", () => {
    const appSource = `${coachSubscription}\n${platformConsole}`.toLowerCase();
    expect(appSource).not.toContain("f93faeee-b177-497e-854e-5052497914b9");
    expect(appSource).not.toContain("coachfort regression 2026");
    expect(appSource).not.toContain("@coachfort.demo");
  });

  test("40. consolidated work introduces no migration or provider mutation", () => {
    expect(existsSync(join(root, "supabase/regression_r3efg_first_grant.sql"))).toBe(false);
    expect(coachSubscription).not.toContain("createRazorpayOrder");
    expect(platformConsole).not.toContain("createRazorpayOrder");
    expect(platformConsole).not.toContain("tenant_payment_orders");
  });
});
