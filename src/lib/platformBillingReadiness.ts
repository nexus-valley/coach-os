export const platformBillingCurrencies = ["INR", "EUR", "USD"] as const;

export type PlatformBillingCurrency =
  (typeof platformBillingCurrencies)[number];

export type PlatformBillingFieldKey =
  | "address_line1"
  | "billing_email"
  | "city"
  | "country"
  | "effective_from"
  | "expected_currency"
  | "legal_name"
  | "postal_code"
  | "preferred_currency"
  | "status"
  | "tax_id"
  | "tax_registration_type";

export type PlatformBillingReadinessSection = {
  invalidFields: PlatformBillingFieldKey[];
  missingFields: PlatformBillingFieldKey[];
  ready: boolean;
};

export type PlatformProviderReadiness = {
  checkoutEnabled: boolean;
  configured: boolean;
  mode: "live" | "test" | "unknown";
  publicCheckoutEnabled: boolean;
  webhookConfigured: boolean;
};

export type PlatformBillingReadiness = {
  currencyReady: boolean;
  customer: PlatformBillingReadinessSection;
  expectedCurrency: PlatformBillingCurrency | null;
  issuer: PlatformBillingReadinessSection;
  provider: PlatformProviderReadiness;
  ready: boolean;
};

export const platformBillingFieldLabels: Record<
  PlatformBillingFieldKey,
  string
> = {
  address_line1: "Address",
  billing_email: "Billing email",
  city: "City",
  country: "Country",
  effective_from: "Effective date",
  expected_currency: "Transaction currency",
  legal_name: "Legal business name",
  postal_code: "Postal code",
  preferred_currency: "Billing currency",
  status: "Profile status",
  tax_id: "Tax ID",
  tax_registration_type: "Tax registration type",
};
