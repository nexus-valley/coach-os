import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test.describe("static route guard coverage", () => {
  test("AppShell enforces direct route role and feature access", () => {
    const source = read("src/components/layout/AppShell.tsx");

    expect(source).toContain("canAccessNavigationItem(currentRole, activeItem)");
    expect(source).toContain("isFeatureEnabled(featureAccess, activeFeatureKey)");
    expect(source).toContain("This module is not enabled for your workspace.");
    expect(source).toContain("You do not have access to this workspace area.");
  });

  test("StudentPortalLayout enforces direct route feature access", () => {
    const source = read("src/components/portal/StudentPortalLayout.tsx");

    expect(source).toContain("portalNavFeatureByLabel");
    expect(source).toContain("isFeatureEnabled(featureAccess, activeFeatureKey)");
    expect(source).toContain("This module is not enabled for your student portal.");
  });

  test("important app routes are mapped to feature keys", () => {
    const source = read("src/lib/featureAccess.ts");

    for (const expected of [
      'Finance: "finance"',
      'Documents: "documents"',
      'Messages: "messages"',
      'Reports: "reports"',
      'CRM: "crm"',
      'Marketing: "marketing"',
      'Automations: "automations"',
      'Workflows: "workflows"',
      'Approvals: "approvals"',
      '"Team Operations": "team_operations"',
      'Certificates: "certificates"',
      'Payments: "finance"',
    ]) {
      expect(source).toContain(expected);
    }
  });

  test("legacy payments routes remain redirected or held", () => {
    expect(read("app/app/payments/page.tsx")).toContain('redirect("/app/finance")');
    expect(read("app/app/receipts/page.tsx")).toContain('redirect("/app/finance")');
    expect(read("app/app/payment-links/page.tsx")).toContain(
      "Payment gateway on hold",
    );
    expect(read("app/app/payment-links/page.tsx")).not.toContain(
      "PaymentLinksPageClient",
    );
  });

  test("server-only service role usage is not imported by app client code", () => {
    for (const path of [
      "app/app/documents/page.tsx",
      "app/portal/documents/page.tsx",
      "src/components/documents/DocumentCenterPage.tsx",
      "src/components/portal/StudentPortalDocuments.tsx",
      "tests/e2e/authenticated-smoke.spec.ts",
    ]) {
      const source = read(path);
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("getSupabaseAdminClient");
    }
  });
});
