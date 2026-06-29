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

  test("monitoring setup scrubs sensitive fields and keeps server tokens out of client files", () => {
    const scrubber = read("src/lib/monitoring.ts");

    for (const expected of [
      "password",
      "authorization",
      "cookie",
      "otp",
      "service.?role",
      "signed.?url",
      "storage_path",
      "storage_bucket",
      "reset.?token",
    ]) {
      expect(scrubber).toContain(expected);
    }

    for (const path of [
      "instrumentation-client.ts",
      "src/lib/monitoringClient.ts",
      "app/error.tsx",
      "app/app/error.tsx",
      "app/global-error.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain("SENTRY_AUTH_TOKEN");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("COACHFORT_OTP_SECRET");
      expect(source).not.toContain("RESEND_API_KEY");
    }
  });

  test("environment example contains monitoring placeholders only", () => {
    const source = read(".env.example");

    for (const expected of [
      "NEXT_PUBLIC_SENTRY_DSN=",
      "SENTRY_DSN=",
      "SENTRY_AUTH_TOKEN=",
      "SENTRY_ORG=",
      "SENTRY_PROJECT=",
      "SENTRY_ENVIRONMENT=",
      "NEXT_PUBLIC_APP_ENV=",
    ]) {
      expect(source).toContain(expected);
    }

    expect(source).not.toMatch(/https:\/\/[a-z0-9]+@/i);
    expect(source).not.toMatch(/sntrys_|[A-Za-z0-9_-]{60,}/);
  });
});
