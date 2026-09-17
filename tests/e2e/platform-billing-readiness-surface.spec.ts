import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getPlatformProviderReadiness,
  normalizePlatformBillingReadiness,
} from "../../src/lib/server/platformBillingReadiness";
import { platformBillingFieldLabels } from "../../src/lib/platformBillingReadiness";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const route = read("app/api/platform/billing-readiness/route.ts");
const sharedContract = read("src/lib/platformBillingReadiness.ts");
const client = read("src/lib/platform.ts");
const panel = read("src/components/platform/BillingReadinessPanel.tsx");
const consolePage = read("src/components/platform/PlatformOwnerConsolePage.tsx");

const providerReady = {
  checkoutEnabled: true,
  configured: true,
  mode: "test" as const,
  publicCheckoutEnabled: false,
  webhookConfigured: true,
};

function databaseResult(overrides: Record<string, unknown> = {}) {
  return {
    currency_ready: true,
    customer: {
      invalid_fields: [],
      missing_fields: [],
      ready: true,
    },
    expected_currency: "INR",
    issuer: {
      invalid_fields: [],
      missing_fields: [],
      ready: true,
    },
    ready: true,
    ...overrides,
  };
}

const providerEnvNames = [
  "RAZORPAY_MODE",
  "RAZORPAY_CHECKOUT_TEST_ENABLED",
  "RAZORPAY_TEST_TENANT_IDS",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
] as const;

async function withProviderEnv(
  values: Partial<Record<(typeof providerEnvNames)[number], string>>,
  run: () => void,
) {
  const original = Object.fromEntries(
    providerEnvNames.map((name) => [name, process.env[name]]),
  );

  try {
    for (const name of providerEnvNames) delete process.env[name];
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) process.env[name] = value;
    }
    run();
  } finally {
    for (const name of providerEnvNames) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test.describe("UX-8G4B1B Platform billing readiness surface", () => {
  test.describe.configure({ mode: "serial" });

  test("1. uses a dynamic no-store GET route with safe input validation", () => {
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain('export const runtime = "nodejs"');
    expect(route).toContain("export async function GET(request: Request)");
    expect(route).toContain('url.searchParams.get("tenantId")');
    expect(route).toContain('url.searchParams.get("expectedCurrency")');
    expect(route).toContain("uuidPattern.test(tenantId)");
    expect(route).toContain("normalizePlatformBillingCurrency");
    expect(route).toContain('"Cache-Control": "no-store"');
    expect(client).toContain('cache: "no-store"');
    expect(sharedContract).toContain('["INR", "EUR", "USD"]');
    expect(route).not.toContain("export async function POST");
  });

  test("2. authenticates Platform Owner/Admin and denies tenant or inactive authority", () => {
    expect(route).toContain("getBearerToken(request)");
    expect(route).toContain("requireAuthenticatedUser(accessToken)");
    expect(route).toContain("getUserScopedSupabase(accessToken)");
    expect(route).toContain('.from("platform_admin_users")');
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain('.eq("status", "active")');
    expect(route).toContain('platformActor?.role !== "owner"');
    expect(route).toContain('platformActor?.role !== "admin"');
    expect(route).toContain("403");
    expect(route).toContain("401");
    expect(route).not.toContain('.from("tenant_members")');
    expect(consolePage).toContain("canManagePlans(adminContext.role) ? (");
    expect(consolePage).toContain("<BillingReadinessPanel");
  });

  test("3. calls only the service-side safe readiness RPC", () => {
    expect(route).toContain("getSupabaseAdminClient()");
    expect(route.indexOf("getUserScopedSupabase(accessToken)")).toBeLessThan(
      route.indexOf("getSupabaseAdminClient()"),
    );
    expect(route).toContain('"get_platform_billing_readiness_server"');
    expect(route).toContain("p_expected_currency: expectedCurrency");
    expect(route).toContain("p_tenant_id: tenantId");
    expect(client).toContain('fetch(`/api/platform/billing-readiness?${search}`');
    expect(client).not.toContain('rpc("get_platform_billing_readiness_server"');
    expect(client).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(panel).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  test("4. sanitizes the database payload and never forwards identity snapshots", () => {
    const readiness = normalizePlatformBillingReadiness(
      databaseResult({
        customer: {
          billing_email: "private@example.test",
          invalid_fields: ["preferred_currency"],
          missing_fields: ["legal_name"],
          ready: false,
          snapshot: { address_line1: "Private address", tax_id: "PRIVATE" },
        },
        issuer: {
          invalid_fields: ["status"],
          legal_name: "Private issuer",
          missing_fields: ["billing_email"],
          ready: false,
        },
      }),
      providerReady,
    );
    const serialized = JSON.stringify(readiness);

    expect(readiness.customer.missingFields).toEqual(["legal_name"]);
    expect(readiness.customer.invalidFields).toEqual(["preferred_currency"]);
    expect(readiness.issuer.invalidFields).toEqual(["status"]);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("Private address");
    expect(serialized).not.toContain("Private issuer");
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("snapshot");
  });

  test("5. rejects malformed or unsupported database field shapes", () => {
    expect(() =>
      normalizePlatformBillingReadiness(
        databaseResult({
          issuer: {
            invalid_fields: [],
            missing_fields: ["billing_email", "secret_field"],
            ready: false,
          },
        }),
        providerReady,
      ),
    ).toThrow(/unsupported field/i);

    expect(() =>
      normalizePlatformBillingReadiness(
        databaseResult({ currency_ready: true, expected_currency: "GBP" }),
        providerReady,
      ),
    ).toThrow(/invalid currency/i);
  });

  test("6. maps a complete private test provider configuration without exposing values", async () => {
    await withProviderEnv(
      {
        RAZORPAY_CHECKOUT_TEST_ENABLED: "true",
        RAZORPAY_KEY_ID: "safe-test-key-id",
        RAZORPAY_KEY_SECRET: "never-return-this-secret",
        RAZORPAY_MODE: "test",
        RAZORPAY_TEST_TENANT_IDS: "00000000-0000-4000-8000-000000000001",
        RAZORPAY_WEBHOOK_SECRET: "never-return-this-webhook-secret",
      },
      () => {
        const readiness = getPlatformProviderReadiness();
        const serialized = JSON.stringify(readiness);
        expect(readiness).toEqual({
          checkoutEnabled: true,
          configured: true,
          mode: "test",
          publicCheckoutEnabled: false,
          webhookConfigured: true,
        });
        expect(serialized).not.toContain("safe-test-key-id");
        expect(serialized).not.toContain("never-return-this");
        expect(serialized).not.toContain("RAZORPAY_");
      },
    );
  });

  test("7. reports missing secrets as safe false states", async () => {
    const base = {
      RAZORPAY_CHECKOUT_TEST_ENABLED: "true",
      RAZORPAY_KEY_ID: "safe-test-key-id",
      RAZORPAY_MODE: "test",
      RAZORPAY_TEST_TENANT_IDS: "00000000-0000-4000-8000-000000000001",
      RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
    };

    await withProviderEnv(base, () => {
      expect(getPlatformProviderReadiness()).toMatchObject({
        checkoutEnabled: false,
        configured: false,
        mode: "test",
        publicCheckoutEnabled: false,
        webhookConfigured: true,
      });
    });

    await withProviderEnv(
      { ...base, RAZORPAY_KEY_SECRET: "key-secret", RAZORPAY_WEBHOOK_SECRET: undefined },
      () => {
        expect(getPlatformProviderReadiness()).toMatchObject({
          checkoutEnabled: true,
          configured: false,
          mode: "test",
          publicCheckoutEnabled: false,
          webhookConfigured: false,
        });
      },
    );
  });

  test("8. maps live and unknown modes without enabling public checkout", async () => {
    await withProviderEnv({ RAZORPAY_MODE: "live" }, () => {
      expect(getPlatformProviderReadiness()).toEqual({
        checkoutEnabled: false,
        configured: false,
        mode: "live",
        publicCheckoutEnabled: false,
        webhookConfigured: false,
      });
    });
    await withProviderEnv({ RAZORPAY_MODE: "preview" }, () => {
      expect(getPlatformProviderReadiness()).toMatchObject({
        configured: false,
        mode: "unknown",
        publicCheckoutEnabled: false,
      });
    });
  });

  test("9. renders safe readiness, missing, invalid, unavailable, and provider states", () => {
    for (const copy of [
      "Billing readiness",
      "CoachFort billing identity",
      "Customer billing identity",
      "Ready",
      "Needs attention",
      "Unavailable",
      "Payment provider",
      "Payment updates",
      "Private checkout",
      "Public checkout",
      "Disabled",
    ]) {
      expect(panel).toContain(copy);
    }
    expect(panel).toContain("section.missingFields");
    expect(panel).toContain("section.invalidFields");
    expect(panel).toContain("platformBillingFieldLabels[field]");
    expect(platformBillingFieldLabels).toMatchObject({
      address_line1: "Address",
      billing_email: "Billing email",
      expected_currency: "Transaction currency",
      legal_name: "Legal business name",
      preferred_currency: "Billing currency",
      tax_id: "Tax ID",
    });
  });

  test("10. uses selected business context and controlled currency choices", () => {
    expect(consolePage).toContain("selectedBusinessName={selectedTenant?.name}");
    expect(consolePage).toContain("selectedTenantId={selectedTenantId}");
    expect(consolePage).toContain("getBillingReadinessCurrency(entitlement)");
    expect(panel).toContain("platformBillingCurrencies.map");
    expect(panel).not.toContain("Regression Coaching");
    expect(panel).toContain("selected coaching business");
    expect(panel).not.toContain("selected tenant");
  });

  test("11. keeps route and UI errors generic and excludes backend jargon", () => {
    expect(route).toContain('"Billing readiness could not be checked."');
    expect(route).not.toContain("jsonError(error.message");
    expect(route).not.toContain("jsonError(error.code");
    expect(route).not.toContain("{ error: error.message }");
    expect(client).not.toContain("RAZORPAY_KEY_SECRET");

    for (const forbidden of [
      "SQLSTATE",
      "SECURITY DEFINER",
      "service_role",
      "PostgREST",
      "tenant_billing_profiles",
      "platform_billing_issuer_profiles",
    ]) {
      expect(panel).not.toContain(forbidden);
    }
  });

  test("12. remains read-only and leaves billing/payment controls unchanged", () => {
    expect(route).toContain("export async function GET");
    expect(route).not.toMatch(/\.rpc\(\s*["'](?:create|update|issue|activate)/i);
    expect(route).not.toMatch(/\.(?:insert|update|delete|upsert)\(/);
    expect(panel).not.toMatch(/<form|type="submit"|Fix automatically/i);
    expect(consolePage).toContain("<ManualActivationPanel");
    expect(consolePage.indexOf("<BillingReadinessPanel")).toBeLessThan(
      consolePage.indexOf("<ManualActivationPanel"),
    );
  });
});
