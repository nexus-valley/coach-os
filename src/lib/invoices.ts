import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type InvoiceStatus = "draft" | "issued" | "overdue" | "paid" | "void";
export type PaymentProvider = "manual" | "razorpay" | "stripe";
export type PaymentTransactionStatus =
  | "failed"
  | "pending"
  | "refunded"
  | "success";

export type Invoice = {
  billing_address: string | null;
  billing_email: string | null;
  billing_name: string | null;
  created_at: string;
  currency: string;
  due_at: string | null;
  gst_number: string | null;
  id: string;
  invoice_number: string;
  issued_at: string | null;
  paid_at: string | null;
  status: InvoiceStatus;
  subscription_id: string | null;
  subtotal: number;
  tax_amount: number;
  tenant_id: string;
  total_amount: number;
};

export type InvoiceItem = {
  created_at: string;
  description: string;
  id: string;
  invoice_id: string;
  line_total: number;
  quantity: number;
  tax_percent: number;
  unit_price: number;
};

export type InvoiceWithItems = Invoice & {
  items: InvoiceItem[];
};

export type PaymentTransaction = {
  amount: number;
  created_at: string;
  currency: string;
  id: string;
  invoice_id: string | null;
  metadata_json: Record<string, unknown>;
  provider: PaymentProvider;
  provider_transaction_id: string | null;
  status: PaymentTransactionStatus;
  tenant_id: string;
};

export type CreateDraftInvoiceInput = {
  billingAddress?: string;
  billingEmail?: string;
  billingName?: string;
  currency?: string;
  dueAt?: string | null;
  gstNumber?: string;
  items: {
    description: string;
    quantity: number;
    taxPercent?: number;
    unitPrice: number;
  }[];
  subscriptionId?: string | null;
  tenantId: string;
};

const invoiceSelect =
  "id,tenant_id,subscription_id,invoice_number,status,subtotal,tax_amount,total_amount,currency,billing_name,billing_email,billing_address,gst_number,issued_at,due_at,paid_at,created_at";
const invoiceItemSelect =
  "id,invoice_id,description,quantity,unit_price,tax_percent,line_total,created_at";
const paymentTransactionSelect =
  "id,tenant_id,invoice_id,provider,provider_transaction_id,status,amount,currency,metadata_json,created_at";

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function normalizeInvoice(row: Invoice) {
  return {
    ...row,
    subtotal: Number(row.subtotal || 0),
    tax_amount: Number(row.tax_amount || 0),
    total_amount: Number(row.total_amount || 0),
  } satisfies Invoice;
}

function normalizeInvoiceItem(row: InvoiceItem) {
  return {
    ...row,
    line_total: Number(row.line_total || 0),
    quantity: Number(row.quantity || 0),
    tax_percent: Number(row.tax_percent || 0),
    unit_price: Number(row.unit_price || 0),
  } satisfies InvoiceItem;
}

function normalizePaymentTransaction(row: PaymentTransaction) {
  return {
    ...row,
    amount: Number(row.amount || 0),
    metadata_json: row.metadata_json ?? {},
  } satisfies PaymentTransaction;
}

function legacySubscriptionBillingWriteRetired(): never {
  throw new Error(
    "Legacy subscription billing writes are retired. Manage subscriptions from the Platform Console.",
  );
}

export async function getInvoices(tenantId: string) {
  await requireTenantPermission({
    description: "Blocked invoice access without billing permission.",
    permission: "access_subscription",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(`${invoiceSelect}, invoice_items (${invoiceItemSelect})`)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as (Invoice & { invoice_items?: InvoiceItem[] })[]).map(
    (invoice) => ({
      ...normalizeInvoice(invoice),
      items: (invoice.invoice_items ?? []).map(normalizeInvoiceItem),
    }),
  ) as InvoiceWithItems[];
}

export async function getPaymentHistory(tenantId: string) {
  await requireTenantPermission({
    description: "Blocked billing payment history access without billing permission.",
    permission: "access_subscription",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("payment_transactions")
    .select(paymentTransactionSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as PaymentTransaction[]).map(normalizePaymentTransaction);
}

export async function createDraftInvoice(input: CreateDraftInvoiceInput) {
  void input;
  legacySubscriptionBillingWriteRetired();
}

export async function markInvoicePaid(params: {
  invoiceId: string;
  providerTransactionId?: string;
  tenantId: string;
}) {
  void params;
  legacySubscriptionBillingWriteRetired();
}
