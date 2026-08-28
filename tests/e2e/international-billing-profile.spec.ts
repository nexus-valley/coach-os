import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  billingCountryOptions,
  europeCommercialCountryCodes,
  getBillingCurrencyForCountry,
} from "../../src/lib/billingCountries";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/bundle_ux8d_international_billing_profile.sql");
const billingProfileFoundation = read("supabase/module77b_tenant_billing_profiles.sql");
const billingProfileLibrary = read("src/lib/billingProfile.ts");
const billingSummaryLibrary = read("src/lib/billing.ts");
const billingProfileClient = read(
  "src/components/billing/BillingProfilePageClient.tsx",
);
const subscriptionClient = read(
  "src/components/subscription/SubscriptionPageClient.tsx",
);
const countryCatalog = read("src/lib/billingCountries.ts");

function executableSql() {
  const match = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);
  expect(match, "Expected one executable transaction").not.toBeNull();
  return match?.[0] ?? "";
}

function lowerExecutableSql() {
  return executableSql().toLowerCase();
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1] ?? "";
}

function functionBody(name: string) {
  const match = lowerExecutableSql().match(
    new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"),
  );
  expect(match, `Expected function public.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8D international billing profile consolidation", () => {
  test("keeps PRE read-only and migration scoped to canonical billing profile", () => {
    const pre = verificationBlock("PRE-APPLY");
    expect(pre).not.toMatch(
      /\b(insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from|alter\s+(?:table|function)|create\s+(?:table|function|index)|drop\s+(?:table|function)|truncate\s+(?:table\s+)?|merge\s+into)\b/i,
    );
    expect(lowerExecutableSql()).toContain("alter table public.tenant_billing_profiles");
    expect(lowerExecutableSql()).not.toContain("create table public.tenant_billing_profiles");
    expect(lowerExecutableSql()).not.toMatch(/\bdrop\s+table\b|\bcascade\b/);
    expect(lowerExecutableSql()).not.toMatch(/\brazorpay\b[\s\S]{0,120}\b(update|insert|delete)\b/);
  });

  test("normalizes country to ISO code and derives supported billing currencies", () => {
    const sql = lowerExecutableSql();
    const currency = functionBody("billing_profile_currency_for_country");
    expect(currency).toContain("if v_country = 'in' then");
    expect(currency).toContain("return 'inr'");
    expect(currency).toContain("billing_profile_eur_country_codes");
    expect(currency).toContain("return 'eur'");
    expect(currency).toContain("return 'usd'");
    expect(sql).toContain("tenant_billing_profiles_country_currency_check");
    expect(sql).toContain("preferred_currency = public.billing_profile_currency_for_country(country)");

    expect(getBillingCurrencyForCountry("IN")).toBe("INR");
    expect(getBillingCurrencyForCountry("BG")).toBe("EUR");
    expect(getBillingCurrencyForCountry("DE")).toBe("EUR");
    expect(getBillingCurrencyForCountry("SE")).toBe("EUR");
    expect(getBillingCurrencyForCountry("DK")).toBe("EUR");
    expect(getBillingCurrencyForCountry("NO")).toBe("EUR");
    expect(getBillingCurrencyForCountry("GB")).toBe("EUR");
    expect(getBillingCurrencyForCountry("CH")).toBe("EUR");
    expect(getBillingCurrencyForCountry("PL")).toBe("EUR");
    expect(getBillingCurrencyForCountry("US")).toBe("USD");
    expect(getBillingCurrencyForCountry("AU")).toBe("USD");
  });

  test("uses the Europe commercial EUR set consistently", () => {
    const eurCountries = billingCountryOptions
      .filter((country) => country.currency === "EUR")
      .map((country) => country.code)
      .sort();
    expect(eurCountries).toEqual([
      "AD",
      "AT",
      "AX",
      "BE",
      "BG",
      "CH",
      "CY",
      "CZ",
      "DE",
      "DK",
      "EE",
      "ES",
      "FI",
      "FO",
      "FR",
      "GB",
      "GG",
      "GI",
      "GR",
      "HR",
      "HU",
      "IE",
      "IM",
      "IS",
      "IT",
      "JE",
      "LI",
      "LT",
      "LU",
      "LV",
      "MC",
      "MT",
      "NL",
      "NO",
      "PL",
      "PT",
      "RO",
      "SE",
      "SI",
      "SK",
      "SM",
      "VA",
    ]);
    expect([...europeCommercialCountryCodes].sort()).toEqual(eurCountries);
    for (const code of eurCountries) {
      expect(lowerExecutableSql()).toContain(`'${code.toLowerCase()}'`);
    }
  });

  test("does not silently overwrite existing canonical currency mismatches", () => {
    const sql = lowerExecutableSql();
    expect(sql).toContain("when tbp.preferred_currency is null");
    expect(sql).toContain("then public.billing_profile_currency_for_country");
    expect(sql).toContain("else tbp.preferred_currency");
    expect(verificationBlock("PRE-APPLY").toLowerCase()).toContain(
      "existing_country_currency_mismatch_rows",
    );
    expect(verificationBlock("PRE-APPLY").toLowerCase()).toContain(
      "unsupported_country_rows",
    );
    expect(verificationBlock("PRE-APPLY").toLowerCase()).not.toContain(
      "= any((select codes",
    );
    expect(sql).toContain(
      "raise exception 'billing country/currency mismatch remains; classify before applying ux-8d.'",
    );
  });

  test("enforces the null country/currency database integrity contract", () => {
    const sql = lowerExecutableSql();
    const constraint = sql.match(
      /add constraint tenant_billing_profiles_country_currency_check\s+check\s*\(([\s\S]*?)\);/i,
    )?.[1] ?? "";
    expect(constraint).toContain("country is null");
    expect(constraint).toContain("preferred_currency is null");
    expect(constraint).toContain("country is not null");
    expect(constraint).toContain("preferred_currency is not null");
    expect(constraint).toContain(
      "preferred_currency = public.billing_profile_currency_for_country(country)",
    );
    const post = verificationBlock("POST-APPLY").toLowerCase();
    expect(post).toContain("null_country_non_null_currency_rows");
    expect(post).toContain("non_null_country_null_currency_rows");
  });

  test("adds tax registration type without building tax calculation", () => {
    const sql = lowerExecutableSql();
    expect(sql).toContain("add column if not exists tax_registration_type");
    expect(sql).toContain("tenant_billing_profiles_tax_registration_type_check");
    expect(sql).toContain("tenant_billing_profiles_tax_id_type_check");
    expect(sql).toContain("check (tax_registration_type in ('none', 'gstin', 'vat', 'other'))");
    expect(sql).toContain("tax registration id requires a tax registration type");
    expect(sql).toContain("when nullif(trim(coalesce(tbp.tax_id, '')), '') is not null");
    expect(sql).toContain("then 'other'");
    expect(verificationBlock("POST-APPLY").toLowerCase()).toContain(
      "tax_id_without_type_rows",
    );
    expect(billingProfileClient).toContain("Tax registration type");
    expect(billingProfileClient).toContain("Tax registration ID");
    expect(billingProfileClient).not.toMatch(/\btax rate\b|\btax_percent\b|calculate tax/i);
  });

  test("preserves Owner/Admin RPC security and direct-write revocation", () => {
    const sql = lowerExecutableSql();
    expect(sql).toContain("perform public.m77b_assert_billing_profile_access(p_tenant_id)");
    expect(billingProfileFoundation.toLowerCase()).toContain("array['owner', 'admin']");
    expect(sql).toContain("revoke all on table public.tenant_billing_profiles from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.get_tenant_billing_profile(uuid)");
    expect(sql).toContain("grant execute on function public.upsert_tenant_billing_profile");
    expect(sql).toContain("to authenticated");
    expect(sql).not.toMatch(/grant\s+execute[\s\S]{0,160}to\s+(public|anon|service_role)/i);
    const post = verificationBlock("POST-APPLY").toLowerCase();
    expect(post).toContain("browser_write_grants");
    expect(post).toContain("browser_direct_grants");
    expect(post).toContain("security_gate");
    expect(post).toContain("relrowsecurity");
    expect(post).toContain("not service_role_execute");
    expect(post).toContain("not exists");
  });

  test("keeps canonical reads on tenant_billing_profiles and legacy tenant fields compatibility-only", () => {
    expect(billingSummaryLibrary).toContain("getTenantBillingProfile");
    expect(billingSummaryLibrary).not.toContain("billing_gst_number");
    expect(billingSummaryLibrary).not.toContain("billing_address_json");
    expect(billingSummaryLibrary).not.toMatch(/\.from\("tenants"\)[\s\S]{0,200}billing_/);
    expect(migration).toContain("'billing_gst_number'");
    expect(migration).not.toMatch(/alter table public\.tenants[\s\S]{0,120}drop column/i);
  });

  test("updates app contract for ISO country, derived currency, and readiness", () => {
    expect(countryCatalog).toContain("billingCountryOptions");
    expect(countryCatalog).toContain("normalizeBillingCountryCode");
    expect(billingProfileLibrary).toContain("p_tax_registration_type");
    expect(billingProfileLibrary).toContain("p_country: cleanInput(normalizeBillingCountryCode");
    expect(billingProfileClient).toContain("Choose country");
    expect(billingProfileClient).toContain("Billing country determines CoachFort billing currency");
    expect(billingProfileClient).toContain("readOnly");
    expect(billingProfileClient).toContain('label="State/Province"');
    expect(billingProfileClient).not.toContain('label="State" required');
    expect(billingProfileClient).not.toContain("Academy");
    expect(subscriptionClient).toContain("Billing currency");
    expect(subscriptionClient).toContain("Tax registration");
  });

  test("keeps SQL and TypeScript country mappings in parity", () => {
    const sql = lowerExecutableSql();
    for (const option of billingCountryOptions) {
      expect(sql).toContain(`'${option.code.toLowerCase()}'`);
      expect(getBillingCurrencyForCountry(option.code)).toBe(option.currency);
    }
  });

  test("covers final billing authority integrity cases", () => {
    const sql = lowerExecutableSql();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    for (const [country, currency] of [
      ["IN", "INR"],
      ["DE", "EUR"],
      ["BG", "EUR"],
      ["SE", "EUR"],
      ["DK", "EUR"],
      ["NO", "EUR"],
      ["GB", "EUR"],
      ["CH", "EUR"],
      ["PL", "EUR"],
      ["US", "USD"],
      ["AU", "USD"],
    ] as const) {
      expect(getBillingCurrencyForCountry(country)).toBe(currency);
    }

    expect(sql).toContain("country is null");
    expect(sql).toContain("preferred_currency is null");
    expect(sql).toContain("country is not null");
    expect(sql).toContain("preferred_currency is not null");
    expect(sql).toContain("preferred_currency = public.billing_profile_currency_for_country(country)");
    expect(sql).toContain("tax_registration_type = 'none'");
    expect(sql).toContain("nullif(trim(coalesce(tax_id, '')), '') is null");
    expect(sql).toContain("tax_registration_type in ('gstin', 'vat', 'other')");
    expect(post).toContain("expected_columns_present_count");
    expect(post).not.toContain("jsonb_object_length");
    expect(post).not.toContain("has_function_privilege('public'");
    expect(post).toContain("aclexplode");
    expect(post).toContain("get_tenant_billing_profile_completion");
    expect(post).toContain("expected_helper_count");
  });
});
