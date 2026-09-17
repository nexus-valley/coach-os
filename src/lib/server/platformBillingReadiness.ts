import { getRazorpayConfig } from "@/src/lib/server/razorpay";
import { getRazorpayWebhookConfig } from "@/src/lib/server/razorpayWebhook";
import {
  platformBillingCurrencies,
  type PlatformBillingCurrency,
  type PlatformBillingFieldKey,
  type PlatformBillingReadiness,
  type PlatformBillingReadinessSection,
  type PlatformProviderReadiness,
} from "@/src/lib/platformBillingReadiness";

const safeFieldKeys = new Set<PlatformBillingFieldKey>([
  "address_line1",
  "billing_email",
  "city",
  "country",
  "effective_from",
  "expected_currency",
  "legal_name",
  "postal_code",
  "preferred_currency",
  "status",
  "tax_id",
  "tax_registration_type",
]);

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeFieldList(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Billing readiness returned an invalid field list.");
  }

  const result: PlatformBillingFieldKey[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !safeFieldKeys.has(item as PlatformBillingFieldKey)) {
      throw new Error("Billing readiness returned an unsupported field.");
    }

    const field = item as PlatformBillingFieldKey;
    if (!result.includes(field)) result.push(field);
  }

  return result;
}

function normalizeSection(value: unknown): PlatformBillingReadinessSection {
  const section = asRecord(value);
  if (!section || typeof section.ready !== "boolean") {
    throw new Error("Billing readiness returned an invalid section.");
  }

  return {
    invalidFields: normalizeFieldList(section.invalid_fields),
    missingFields: normalizeFieldList(section.missing_fields),
    ready: section.ready,
  };
}

export function normalizePlatformBillingReadiness(
  value: unknown,
  provider: PlatformProviderReadiness,
): PlatformBillingReadiness {
  const result = asRecord(value);
  if (
    !result ||
    typeof result.ready !== "boolean" ||
    typeof result.currency_ready !== "boolean"
  ) {
    throw new Error("Billing readiness returned an invalid result.");
  }

  const expectedCurrency =
    typeof result.expected_currency === "string" &&
    platformBillingCurrencies.includes(
      result.expected_currency as PlatformBillingCurrency,
    )
      ? (result.expected_currency as PlatformBillingCurrency)
      : null;

  if (result.currency_ready && !expectedCurrency) {
    throw new Error("Billing readiness returned an invalid currency.");
  }

  return {
    currencyReady: result.currency_ready,
    customer: normalizeSection(result.customer),
    expectedCurrency,
    issuer: normalizeSection(result.issuer),
    provider,
    ready: result.ready,
  };
}

export function normalizePlatformBillingCurrency(value: string | null) {
  const currency = value?.trim().toUpperCase() ?? "";
  return platformBillingCurrencies.includes(currency as PlatformBillingCurrency)
    ? (currency as PlatformBillingCurrency)
    : null;
}

export function getPlatformProviderReadiness(): PlatformProviderReadiness {
  const configuredMode = process.env.RAZORPAY_MODE?.trim().toLowerCase();
  const mode =
    configuredMode === "test" || configuredMode === "live"
      ? configuredMode
      : "unknown";

  let checkoutEnabled = false;
  let webhookConfigured = false;

  try {
    getRazorpayConfig();
    checkoutEnabled = true;
  } catch {
    checkoutEnabled = false;
  }

  try {
    getRazorpayWebhookConfig();
    webhookConfigured = true;
  } catch {
    webhookConfigured = false;
  }

  return {
    checkoutEnabled,
    configured: checkoutEnabled && webhookConfigured,
    mode,
    publicCheckoutEnabled: false,
    webhookConfigured,
  };
}
