import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  commercialPlanContracts,
  getPlanDisplayPrice,
  getPlanLimitSummary,
  getPublicPlanCards,
  getPublicStartingPrice,
} from "../../src/lib/plans";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const plansSource = read("src/lib/plans.ts");
const homepageSource = read("app/page.tsx");
const onboardingSource = read("src/components/auth/OnboardingForm.tsx");
const paymentPolicySource = read("app/payment-policy/page.tsx");
const tenantSource = read("src/lib/tenant.ts");
const operationsSource = read("src/lib/operations.ts");
const operationsPageSource = read(
  "src/components/operations/OperationsPageClient.tsx",
);
const manualActivationSource = read(
  "src/components/platform/ManualActivationPanel.tsx",
);
const platformConsoleSource = read(
  "src/components/platform/PlatformOwnerConsolePage.tsx",
);
const limitMigration = read("supabase/module71_7r0a_plan_limit_alignment.sql");
const pricingMigration = read("supabase/module71_7r0b_final_inr_pricing.sql");

test.describe("UX-8G4A1 canonical commercial plan contract", () => {
  test("1. Starter presentation matches the approved R0A/R0B contract", () => {
    expect(commercialPlanContracts.starter).toMatchObject({
      billing: { monthly: 1499, yearly: 14990 },
      code: "starter",
      limits: {
        admins: 2,
        aiRequestsMonthly: 0,
        automationRunsMonthly: 0,
        batches: 5,
        cohorts: 5,
        documentUploads: 500,
        messagesMonthly: 1000,
        programs: 5,
        staffTrainers: 3,
        storageMb: 2048,
        students: 100,
        teamMembers: 5,
      },
      trialDays: 14,
    });
    expect(getPlanDisplayPrice("starter", "monthly")).toBe(
      "INR 1,499 / month",
    );
    expect(getPlanDisplayPrice("starter", "yearly")).toBe(
      "INR 14,990 / year",
    );
    expect(getPlanLimitSummary("starter")).toBe(
      "100 Students, 5 Programs, 5 Team members, 2 GB Storage",
    );
  });

  test("2. Growth presentation matches the approved R0A/R0B contract", () => {
    expect(commercialPlanContracts.growth).toMatchObject({
      billing: { monthly: 5999, yearly: 59990 },
      code: "growth",
      limits: {
        admins: 5,
        aiRequestsMonthly: 500,
        automationRunsMonthly: 5000,
        batches: 25,
        cohorts: 25,
        documentUploads: 10000,
        messagesMonthly: 25000,
        programs: 25,
        staffTrainers: 15,
        storageMb: 25600,
        students: 500,
        teamMembers: 20,
      },
      trialDays: 14,
    });
    expect(getPlanDisplayPrice("growth", "monthly")).toBe(
      "INR 5,999 / month",
    );
    expect(getPlanDisplayPrice("growth", "yearly")).toBe(
      "INR 59,990 / year",
    );
    expect(getPlanLimitSummary("growth")).toBe(
      "500 Students, 25 Programs, 20 Team members, 25 GB Storage",
    );
  });

  test("3. Premium remains contact-sales without a public numeric price", () => {
    expect(commercialPlanContracts.enterprise).toMatchObject({
      billing: { monthly: null, yearly: null },
      code: "premium",
      limits: {
        admins: 15,
        aiRequestsMonthly: 10000,
        automationRunsMonthly: 25000,
        batches: 150,
        cohorts: 150,
        documentUploads: 50000,
        messagesMonthly: 100000,
        programs: 150,
        staffTrainers: 75,
        storageMb: 102400,
        students: 5000,
        teamMembers: 100,
      },
      trialDays: 14,
    });
    expect(getPlanDisplayPrice("enterprise", "monthly")).toBe("Contact Sales");
    expect(getPlanDisplayPrice("enterprise", "yearly")).toBe("Contact Sales");
    expect(getPublicPlanCards().find((plan) => plan.key === "enterprise")).toMatchObject(
      {
        monthly: "Contact Sales",
        name: "Premium",
        yearly: "Contact Sales",
      },
    );
  });

  test("4. feature presentation matches approved packaging", () => {
    const starter = commercialPlanContracts.starter.features;
    const growth = commercialPlanContracts.growth.features;
    const premium = commercialPlanContracts.enterprise.features;

    for (const features of [starter, growth, premium]) {
      expect(features.community_hub).toBe("included");
      expect(features.messages).toBe("included");
      expect(features.payment_gateway).toBe("coming_soon");
      expect(features.live_classes).toBe("coming_soon");
    }

    expect(starter).toMatchObject({
      ai_assistant: "locked",
      api_integrations: "locked",
      automations: "locked",
      certificates: "locked",
      crm: "locked",
      custom_branding: "locked",
      website_builder: "locked",
    });
    expect(growth).toMatchObject({
      ai_assistant: "platform_approval_required",
      api_integrations: "locked",
      automations: "included",
      certificates: "included",
      crm: "included",
      custom_branding: "addon",
      website_builder: "addon",
    });
    expect(premium).toMatchObject({
      ai_assistant: "platform_approval_required",
      api_integrations: "included",
      custom_branding: "included",
      website_builder: "included",
    });
  });

  test("5. homepage and onboarding retain the reconciled shared plan helpers", () => {
    expect(homepageSource).toContain("getPublicPlanCards");
    expect(homepageSource).toContain("getPublicStartingPrice");
    expect(onboardingSource).toContain("getPlanDisplayPrice");
    expect(onboardingSource).toContain("getPlanLimitSummary");
    expect(getPublicStartingPrice()).toBe("INR 1,499");
    expect(getPublicPlanCards()).toHaveLength(3);
    expect(
      getPublicPlanCards().find((plan) => plan.key === "starter")?.limitSummary,
    ).toBe("100 Students, 5 Programs, 5 Team members, 2 GB Storage");
    expect(
      getPublicPlanCards().find((plan) => plan.key === "growth")?.limitSummary,
    ).toBe("500 Students, 25 Programs, 20 Team members, 25 GB Storage");
  });

  test("6. active presentation sources do not retain superseded limits", () => {
    expect(plansSource).not.toContain("students: 1000");
    expect(plansSource).not.toContain('value: "50GB"');
    expect(plansSource).not.toContain('value: "50 GB"');
    expect(plansSource).not.toContain('value: "5GB"');
    expect(plansSource).not.toContain('label: "Trainer seats", value: "1"');
    expect(commercialPlanContracts.starter.limits.teamMembers).toBe(5);
    expect(getPlanLimitSummary("starter")).not.toContain("2 Team members");
    expect(getPlanLimitSummary("starter")).not.toContain("5 GB Storage");
    expect(getPlanLimitSummary("growth")).not.toContain("1,000 Students");
    expect(getPlanLimitSummary("growth")).not.toContain("50 GB Storage");
  });

  test("7. payment-policy pricing remains shared and final INR pricing stays private", () => {
    expect(paymentPolicySource).toContain("getPlanDisplayPrice");
    expect(pricingMigration).toContain("149900");
    expect(pricingMigration).toContain("1499000");
    expect(pricingMigration).toContain("599900");
    expect(pricingMigration).toContain("5999000");
    expect(pricingMigration).toContain("'draft'");
    expect(pricingMigration).toContain('"checkout_enabled":false');
    expect(limitMigration).toContain(
      "Does not update subscription_plans.status or subscription_plans.is_public",
    );
  });

  test("8. workspace activity copy does not hard-code canonical trial duration", () => {
    expect(tenantSource).toContain('description: "Started workspace trial."');
    expect(tenantSource).not.toContain("Started 14-day workspace trial");
    expect(tenantSource).not.toContain("trialDays: 14");
    expect(tenantSource).toContain('.rpc("create_workspace_with_owner"');
  });

  test("9. Operations delegates subscription presentation to its canonical page", () => {
    expect(operationsSource).not.toContain("getSafeTenantSubscription");
    expect(operationsSource).not.toContain("getTrialStatus");
    expect(operationsSource).not.toContain("refreshWorkspaceUsageSnapshot");
    expect(operationsSource).not.toContain('select("plan,billing_status")');
    expect(operationsPageSource).not.toContain("data.subscription");
    expect(operationsPageSource).toContain('href="/app/subscription"');
    expect(operationsPageSource).toContain("Open subscription");
  });

  test("10. manual activation validates against the loaded Platform catalog", () => {
    expect(manualActivationSource).toContain(
      "canonicalPlanCatalog: CanonicalPlanCatalogItem[]",
    );
    expect(manualActivationSource).toContain("getCanonicalActivationAmounts");
    expect(manualActivationSource).toContain("plan.code === planCode");
    expect(manualActivationSource).toMatch(
      /\.prices\.find\([\s\S]*?\)\?\.amount_minor/,
    );
    expect(manualActivationSource).not.toContain("getPlanAmountMinor");
    expect(platformConsoleSource).toContain(
      "canonicalPlanCatalog={canonicalPlanCatalog}",
    );
  });

  test("11. Premium stays excluded from manual activation", () => {
    expect(manualActivationSource).toContain(
      'form.planCode !== "starter" && form.planCode !== "growth"',
    );
    expect(manualActivationSource).toContain(
      '<option value="starter">Starter</option>',
    );
    expect(manualActivationSource).toContain(
      '<option value="growth">Growth</option>',
    );
    expect(manualActivationSource).not.toContain('<option value="premium">');
  });

  test("12. catalog reconciliation adds no checkout or payment mutation path", () => {
    expect(plansSource).not.toContain("get_platform_plan_catalog");
    expect(operationsSource).not.toContain("activateTenantSubscription");
    expect(operationsPageSource).not.toContain("Pay now");
    expect(manualActivationSource).not.toContain("fetch(");
    expect(manualActivationSource).not.toContain(".rpc(");
    expect(
      manualActivationSource.match(/activateTenantSubscriptionManual\(/g),
    ).toHaveLength(1);
  });
});
