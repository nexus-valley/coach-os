import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  getBillingCountryDisplayName,
  getBillingCurrencyForCountry,
  normalizeBillingCountryCode,
  normalizeTaxRegistrationType,
  type BillingCurrency,
  type TaxRegistrationType,
} from "@/src/lib/billingCountries";

export type TenantBillingProfile = {
  address_line1: string | null;
  address_line2: string | null;
  billing_email: string | null;
  billing_notes: string | null;
  billing_phone: string | null;
  city: string | null;
  country: string | null;
  created_at: string | null;
  id: string | null;
  invoice_contact_name: string | null;
  legal_name: string | null;
  postal_code: string | null;
  preferred_currency: BillingCurrency | null;
  state: string | null;
  tax_registration_type: TaxRegistrationType;
  tax_id: string | null;
  tenant_id: string;
  updated_at: string | null;
  updated_by: string | null;
};

export type TenantBillingProfileInput = {
  address_line1?: string | null;
  address_line2?: string | null;
  billing_email?: string | null;
  billing_notes?: string | null;
  billing_phone?: string | null;
  city?: string | null;
  country?: string | null;
  invoice_contact_name?: string | null;
  legal_name?: string | null;
  postal_code?: string | null;
  preferred_currency?: BillingCurrency;
  state?: string | null;
  tax_registration_type?: TaxRegistrationType;
  tax_id?: string | null;
};

export type TenantBillingProfileCompletion = {
  completion_score: number;
  is_complete: boolean;
  missing_fields: string[];
  tenant_id: string;
};

const missingFieldLabels: Record<string, string> = {
  address_line1: "Address line 1",
  billing_email: "Billing email",
  city: "City",
  country: "Billing country",
  legal_name: "Legal name",
  postal_code: "Postal code",
  preferred_currency: "Billing currency",
  state: "State",
};

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeCurrency(value: unknown): BillingCurrency | null {
  return value === "USD" || value === "EUR" || value === "INR" ? value : null;
}

function normalizeProfile(row: Record<string, unknown>): TenantBillingProfile {
  return {
    address_line1: asNullableString(row.address_line1),
    address_line2: asNullableString(row.address_line2),
    billing_email: asNullableString(row.billing_email),
    billing_notes: asNullableString(row.billing_notes),
    billing_phone: asNullableString(row.billing_phone),
    city: asNullableString(row.city),
    country: asNullableString(row.country),
    created_at: asNullableString(row.created_at),
    id: asNullableString(row.id),
    invoice_contact_name: asNullableString(row.invoice_contact_name),
    legal_name: asNullableString(row.legal_name),
    postal_code: asNullableString(row.postal_code),
    preferred_currency: normalizeCurrency(row.preferred_currency),
    state: asNullableString(row.state),
    tax_registration_type: normalizeTaxRegistrationType(
      asNullableString(row.tax_registration_type),
    ),
    tax_id: asNullableString(row.tax_id),
    tenant_id: String(row.tenant_id ?? ""),
    updated_at: asNullableString(row.updated_at),
    updated_by: asNullableString(row.updated_by),
  };
}

function normalizeProfileResponse(data: unknown): TenantBillingProfile {
  if (Array.isArray(data)) {
    return normalizeProfile((data[0] ?? {}) as Record<string, unknown>);
  }

  return normalizeProfile((data ?? {}) as Record<string, unknown>);
}

function normalizeCompletionResponse(data: unknown): TenantBillingProfileCompletion {
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | null
    | undefined;

  return {
    completion_score:
      typeof row?.completion_score === "number" ? row.completion_score : 0,
    is_complete: row?.is_complete === true,
    missing_fields: Array.isArray(row?.missing_fields)
      ? row.missing_fields.map(String)
      : [],
    tenant_id: String(row?.tenant_id ?? ""),
  };
}

function cleanInput(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  return trimmed ? trimmed : null;
}

export function getBillingProfileMissingFieldLabel(field: string) {
  return missingFieldLabels[field] ?? field.replace(/_/g, " ");
}

export function getBillingProfileMissingFieldLabels(fields: string[]) {
  return fields.map(getBillingProfileMissingFieldLabel);
}

export { getBillingCountryDisplayName, getBillingCurrencyForCountry };

export async function getTenantBillingProfile(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_tenant_billing_profile", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return normalizeProfileResponse(data);
}

export async function upsertTenantBillingProfile(
  tenantId: string,
  payload: TenantBillingProfileInput,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("upsert_tenant_billing_profile", {
    p_address_line1: cleanInput(payload.address_line1),
    p_address_line2: cleanInput(payload.address_line2),
    p_billing_email: cleanInput(payload.billing_email),
    p_billing_notes: cleanInput(payload.billing_notes),
    p_billing_phone: cleanInput(payload.billing_phone),
    p_city: cleanInput(payload.city),
    p_country: cleanInput(normalizeBillingCountryCode(payload.country)),
    p_invoice_contact_name: cleanInput(payload.invoice_contact_name),
    p_legal_name: cleanInput(payload.legal_name),
    p_postal_code: cleanInput(payload.postal_code),
    p_preferred_currency: payload.preferred_currency ?? "INR",
    p_state: cleanInput(payload.state),
    p_tax_registration_type: payload.tax_registration_type ?? "NONE",
    p_tax_id: cleanInput(payload.tax_id),
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return normalizeProfileResponse(data);
}

export async function getTenantBillingProfileCompletion(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_tenant_billing_profile_completion",
    {
      p_tenant_id: tenantId,
    },
  );

  if (error) {
    throw error;
  }

  return normalizeCompletionResponse(data);
}
