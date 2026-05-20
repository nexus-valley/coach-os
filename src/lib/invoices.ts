import { logActivity } from "@/src/lib/auditLogger";
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

function calculateInvoiceTotals(input: CreateDraftInvoiceInput["items"]) {
  return input.reduce(
    (totals, item) => {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
      const taxPercent = Math.max(0, Number(item.taxPercent) || 0);
      const subtotal = quantity * unitPrice;
      const taxAmount = subtotal * (taxPercent / 100);

      return {
        subtotal: totals.subtotal + subtotal,
        taxAmount: totals.taxAmount + taxAmount,
      };
    },
    { subtotal: 0, taxAmount: 0 },
  );
}

async function generateInvoiceNumber() {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw error;
  }

  return `CF-INV-${String((count ?? 0) + 1).padStart(6, "0")}`;
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
  await requireTenantPermission({
    description: "Blocked draft invoice creation without billing permission.",
    permission: "access_subscription",
    tenantId: input.tenantId,
  });

  if (input.items.length === 0) {
    throw new Error("At least one invoice item is required.");
  }

  const totals = calculateInvoiceTotals(input.items);
  const totalAmount = totals.subtotal + totals.taxAmount;
  const supabase = getSupabaseClient();
  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      billing_address: input.billingAddress?.trim() || null,
      billing_email: input.billingEmail?.trim() || null,
      billing_name: input.billingName?.trim() || null,
      currency: input.currency ?? "INR",
      due_at: input.dueAt ?? null,
      gst_number: input.gstNumber?.trim() || null,
      invoice_number: await generateInvoiceNumber(),
      status: "draft",
      subscription_id: input.subscriptionId ?? null,
      subtotal: totals.subtotal,
      tax_amount: totals.taxAmount,
      tenant_id: input.tenantId,
      total_amount: totalAmount,
    })
    .select(invoiceSelect)
    .single();

  if (invoiceError) {
    throw invoiceError;
  }

  const invoice = normalizeInvoice(invoiceData as Invoice);
  const itemPayload = input.items.map((item) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
    const taxPercent = Math.max(0, Number(item.taxPercent) || 0);
    const subtotal = quantity * unitPrice;
    const lineTotal = subtotal + subtotal * (taxPercent / 100);

    return {
      description: item.description.trim(),
      invoice_id: invoice.id,
      line_total: lineTotal,
      quantity,
      tax_percent: taxPercent,
      unit_price: unitPrice,
    };
  });
  const { data: itemsData, error: itemsError } = await supabase
    .from("invoice_items")
    .insert(itemPayload)
    .select(invoiceItemSelect);

  if (itemsError) {
    throw itemsError;
  }

  await logActivity({
    action: "invoice_created",
    description: `Created draft invoice ${invoice.invoice_number}.`,
    entityId: invoice.id,
    entityName: invoice.invoice_number,
    entityType: "invoice",
    metadata: { totalAmount: invoice.total_amount },
    tenantId: input.tenantId,
  });

  return {
    ...invoice,
    items: ((itemsData ?? []) as InvoiceItem[]).map(normalizeInvoiceItem),
  } satisfies InvoiceWithItems;
}

export async function markInvoicePaid(params: {
  invoiceId: string;
  providerTransactionId?: string;
  tenantId: string;
}) {
  await requireTenantPermission({
    description: "Blocked invoice payment update without billing permission.",
    permission: "access_subscription",
    tenantId: params.tenantId,
  });

  const supabase = getSupabaseClient();
  const paidAt = new Date().toISOString();
  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .update({
      paid_at: paidAt,
      status: "paid",
    })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.invoiceId)
    .select(invoiceSelect)
    .single();

  if (invoiceError) {
    throw invoiceError;
  }

  const invoice = normalizeInvoice(invoiceData as Invoice);
  const { data: transactionData, error: transactionError } = await supabase
    .from("payment_transactions")
    .insert({
      amount: invoice.total_amount,
      currency: invoice.currency,
      invoice_id: invoice.id,
      metadata_json: { source: "manual_foundation" },
      provider: "manual",
      provider_transaction_id: params.providerTransactionId?.trim() || null,
      status: "success",
      tenant_id: params.tenantId,
    })
    .select(paymentTransactionSelect)
    .single();

  if (transactionError) {
    throw transactionError;
  }

  await logActivity({
    action: "invoice_paid",
    description: `Marked invoice ${invoice.invoice_number} as paid.`,
    entityId: invoice.id,
    entityName: invoice.invoice_number,
    entityType: "invoice",
    metadata: { totalAmount: invoice.total_amount },
    tenantId: params.tenantId,
  });

  await logActivity({
    action: "payment_recorded",
    description: `Recorded manual billing payment for ${invoice.invoice_number}.`,
    entityId: transactionData.id,
    entityName: invoice.invoice_number,
    entityType: "payment_transaction",
    metadata: {
      amount: invoice.total_amount,
      invoiceId: invoice.id,
      provider: "manual",
    },
    tenantId: params.tenantId,
  });

  return {
    invoice,
    transaction: normalizePaymentTransaction(
      transactionData as PaymentTransaction,
    ),
  };
}
