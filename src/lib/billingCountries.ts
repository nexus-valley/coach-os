export type BillingCurrency = "EUR" | "INR" | "USD";

export type TaxRegistrationType = "GSTIN" | "NONE" | "OTHER" | "VAT";

export type BillingCountryOption = {
  code: string;
  currency: BillingCurrency;
  name: string;
};

// CoachFort's EUR commercial billing region. This is not a legal-tender or
// monetary-union list; product pricing maps these countries to EUR.
export const europeCommercialCountryCodes = [
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
] as const;

const europeCommercialCountryCodeSet = new Set<string>(
  europeCommercialCountryCodes,
);

const supportedBillingCountryCodes = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RW",
  "SA",
  "SB",
  "SC",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SZ",
  "TC",
  "TD",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "XK",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
] as const;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function getCountryName(code: string) {
  return regionNames.of(code) ?? code;
}

export function normalizeBillingCountryCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export function isEuropeCommercialBillingCountry(
  value: string | null | undefined,
) {
  return europeCommercialCountryCodeSet.has(normalizeBillingCountryCode(value));
}

export function getBillingCurrencyForCountry(
  value: string | null | undefined,
): BillingCurrency {
  const code = normalizeBillingCountryCode(value);

  if (code === "IN") {
    return "INR";
  }

  if (isEuropeCommercialBillingCountry(code)) {
    return "EUR";
  }

  return "USD";
}

export const billingCountryOptions: BillingCountryOption[] =
  supportedBillingCountryCodes
    .map((code) => ({
      code,
      currency: getBillingCurrencyForCountry(code),
      name: getCountryName(code),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

export const billingTaxRegistrationTypes: {
  description: string;
  label: string;
  value: TaxRegistrationType;
}[] = [
  {
    description: "No tax registration is recorded for this billing profile.",
    label: "None",
    value: "NONE",
  },
  {
    description: "Indian Goods and Services Tax Identification Number.",
    label: "GSTIN",
    value: "GSTIN",
  },
  {
    description: "Value-added tax registration for EUR-region billing profiles.",
    label: "VAT",
    value: "VAT",
  },
  {
    description: "Another business tax registration identifier.",
    label: "Other",
    value: "OTHER",
  },
];

export function getBillingCountryOption(value: string | null | undefined) {
  const code = normalizeBillingCountryCode(value);

  return billingCountryOptions.find((country) => country.code === code) ?? null;
}

export function getBillingCountryDisplayName(value: string | null | undefined) {
  const code = normalizeBillingCountryCode(value);

  return getBillingCountryOption(code)?.name ?? value ?? "";
}

export function isSupportedBillingCountry(value: string | null | undefined) {
  return Boolean(getBillingCountryOption(value));
}

export function normalizeTaxRegistrationType(
  value: string | null | undefined,
): TaxRegistrationType {
  const normalized = value?.trim().toUpperCase();

  if (
    normalized === "GSTIN" ||
    normalized === "VAT" ||
    normalized === "OTHER"
  ) {
    return normalized;
  }

  return "NONE";
}
