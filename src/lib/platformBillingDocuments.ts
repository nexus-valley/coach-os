import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type PlatformBillingDocumentType = "invoice" | "receipt";
export type PlatformBillingDocumentStatus = "issued" | "void";

export type PlatformBillingSnapshot = {
  address_line1: string;
  address_line2: string | null;
  billing_email: string;
  billing_phone: string | null;
  city: string;
  country: string;
  invoice_contact_name: string | null;
  legal_name: string;
  postal_code: string;
  state: string | null;
  tax_id: string | null;
  tax_registration_type: string;
};

export type PlatformBillingLineItem = {
  billing_cycle: string;
  description: string;
  discount_amount_minor: number;
  line_total_minor: number;
  period_end: string | null;
  period_start: string | null;
  quantity: number;
  tax_amount_minor: number | null;
  tax_calculation_status: "calculated" | "not_applicable" | "not_calculated";
  unit_amount_minor: number;
};

export type PlatformBillingDocument = {
  billing_cycle: string | null;
  billing_snapshot: PlatformBillingSnapshot;
  currency: string;
  document_number: string;
  document_type: PlatformBillingDocumentType;
  due_at: string | null;
  id: string;
  issued_at: string;
  issuer_snapshot: Record<string, unknown>;
  line_items: PlatformBillingLineItem[];
  payment_reference: string | null;
  period_end: string | null;
  period_start: string | null;
  plan_name: string | null;
  status: PlatformBillingDocumentStatus;
  subtotal_minor: number;
  tax_amount_minor: number | null;
  tax_calculation_status: "calculated" | "not_applicable" | "not_calculated";
  total_amount_minor: number;
};

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeTaxCalculationStatus(value: unknown) {
  return value === "calculated" || value === "not_applicable"
    ? value
    : "not_calculated";
}

function normalizeBillingSnapshot(value: unknown): PlatformBillingSnapshot {
  const row =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    address_line1: String(row.address_line1 ?? ""),
    address_line2: nullableString(row.address_line2),
    billing_email: String(row.billing_email ?? ""),
    billing_phone: nullableString(row.billing_phone),
    city: String(row.city ?? ""),
    country: String(row.country ?? ""),
    invoice_contact_name: nullableString(row.invoice_contact_name),
    legal_name: String(row.legal_name ?? ""),
    postal_code: String(row.postal_code ?? ""),
    state: nullableString(row.state),
    tax_id: nullableString(row.tax_id),
    tax_registration_type: String(row.tax_registration_type ?? "NONE"),
  };
}

function normalizeLineItem(value: unknown): PlatformBillingLineItem {
  const row =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    billing_cycle: String(row.billing_cycle ?? ""),
    description: String(row.description ?? "CoachFort Plan"),
    discount_amount_minor: Number(row.discount_amount_minor ?? 0),
    line_total_minor: Number(row.line_total_minor ?? 0),
    period_end: nullableString(row.period_end),
    period_start: nullableString(row.period_start),
    quantity: Number(row.quantity ?? 1),
    tax_amount_minor:
      row.tax_amount_minor === null || row.tax_amount_minor === undefined
        ? null
        : Number(row.tax_amount_minor),
    tax_calculation_status: normalizeTaxCalculationStatus(
      row.tax_calculation_status,
    ),
    unit_amount_minor: Number(row.unit_amount_minor ?? 0),
  };
}

function normalizeDocument(value: unknown): PlatformBillingDocument {
  const row = value as Record<string, unknown>;
  const rawItems = Array.isArray(row.line_items) ? row.line_items : [];

  return {
    billing_cycle: nullableString(row.billing_cycle),
    billing_snapshot: normalizeBillingSnapshot(row.billing_snapshot),
    currency: String(row.currency ?? ""),
    document_number: String(row.document_number ?? ""),
    document_type: row.document_type === "receipt" ? "receipt" : "invoice",
    due_at: nullableString(row.due_at),
    id: String(row.id ?? ""),
    issued_at: String(row.issued_at ?? ""),
    issuer_snapshot:
      row.issuer_snapshot && typeof row.issuer_snapshot === "object"
        ? (row.issuer_snapshot as Record<string, unknown>)
        : {},
    line_items: rawItems.map(normalizeLineItem),
    payment_reference: nullableString(row.payment_reference),
    period_end: nullableString(row.period_end),
    period_start: nullableString(row.period_start),
    plan_name: nullableString(row.plan_name),
    status: row.status === "void" ? "void" : "issued",
    subtotal_minor: Number(row.subtotal_minor ?? 0),
    tax_amount_minor:
      row.tax_amount_minor === null || row.tax_amount_minor === undefined
        ? null
        : Number(row.tax_amount_minor),
    tax_calculation_status: normalizeTaxCalculationStatus(
      row.tax_calculation_status,
    ),
    total_amount_minor: Number(row.total_amount_minor ?? 0),
  };
}

export async function getPlatformBillingDocuments(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_platform_billing_documents", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error("Unable to load CoachFort billing documents.");
  }

  return (Array.isArray(data) ? data : []).map(normalizeDocument);
}
