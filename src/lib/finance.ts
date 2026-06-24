import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type FinanceFeePlanStatus = "active" | "archived" | "inactive";
export type FinanceBillingCycle =
  | "custom"
  | "half_yearly"
  | "monthly"
  | "one_time"
  | "quarterly"
  | "yearly";
export type FinanceInvoiceStatus =
  | "cancelled"
  | "draft"
  | "issued"
  | "overdue"
  | "paid"
  | "partially_paid"
  | "void";
export type FinancePaymentMethod =
  | "bank_transfer"
  | "card"
  | "cash"
  | "cheque"
  | "online"
  | "other"
  | "upi";
export type FinancePaymentStatus =
  | "cancelled"
  | "confirmed"
  | "failed"
  | "recorded"
  | "refunded";
export type FinanceReceiptStatus = "cancelled" | "issued" | "void";
export type FinanceAdjustmentType =
  | "correction"
  | "discount"
  | "other"
  | "penalty"
  | "refund_note"
  | "waiver";

export type FinanceSettings = {
  default_currency: string;
  invoice_prefix: string;
  metadata_json: Record<string, unknown>;
  next_invoice_number: number;
  next_receipt_number: number;
  payment_terms_days: number;
  receipt_prefix: string;
  tenant_id: string;
  updated_at: string;
};

export type FinanceFeePlan = {
  amount: number;
  billing_cycle: FinanceBillingCycle;
  course_id: string | null;
  created_at: string;
  currency: string;
  description: string | null;
  due_day: number | null;
  id: string;
  installments_count: number | null;
  metadata_json: Record<string, unknown>;
  name: string;
  status: FinanceFeePlanStatus;
  tenant_id: string;
};

export type FinanceInvoice = {
  balance_amount: number;
  course_id: string | null;
  created_at: string;
  currency: string;
  discount_amount: number;
  due_date: string | null;
  fee_plan_id: string | null;
  id: string;
  invoice_date: string;
  invoice_number: string;
  notes: string | null;
  paid_amount: number;
  status: FinanceInvoiceStatus;
  student_id: string;
  subtotal_amount: number;
  tax_amount: number;
  tenant_id: string;
  total_amount: number;
};

export type FinancePayment = {
  amount: number;
  created_at: string;
  currency: string;
  id: string;
  invoice_id: string | null;
  payment_date: string;
  payment_method: FinancePaymentMethod;
  status: FinancePaymentStatus;
  student_id: string;
  tenant_id: string;
};

export type FinanceReceipt = {
  amount: number;
  created_at: string;
  currency: string;
  id: string;
  issued_at: string;
  payment_id: string;
  receipt_number: string;
  status: FinanceReceiptStatus;
  student_id: string;
  tenant_id: string;
};

export type FinanceAdjustment = {
  adjustment_type: FinanceAdjustmentType;
  amount: number;
  created_at: string;
  id: string;
  invoice_id: string;
  status: "applied" | "cancelled" | "reversed";
  student_id: string;
  tenant_id: string;
};

export type FinanceActivityLog = {
  action: string;
  created_at: string;
  id: string;
  invoice_id: string | null;
  metadata_json: Record<string, unknown>;
  payment_id: string | null;
  student_id: string | null;
  tenant_id: string;
};

export type FinanceDashboard = {
  currency: string;
  invoice_counts: Record<string, number>;
  overdue_amount: number;
  recent_payments: FinancePayment[];
  total_collected: number;
  total_invoiced: number;
  total_outstanding: number;
};

export type FinanceStudentSummary = {
  currency: string;
  invoices: FinanceInvoice[];
  outstanding_amount: number;
  paid_amount: number;
  payments: FinancePayment[];
  receipts: FinanceReceipt[];
  student_id: string;
  tenant_id: string;
};

export type FinanceCenterData = {
  activities: FinanceActivityLog[];
  adjustments: FinanceAdjustment[];
  dashboard: FinanceDashboard;
  feePlans: FinanceFeePlan[];
  invoices: FinanceInvoice[];
  payments: FinancePayment[];
  receipts: FinanceReceipt[];
  settings: FinanceSettings | null;
};

export const financeBillingCycles: FinanceBillingCycle[] = [
  "one_time",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "custom",
];

export const financePaymentMethods: FinancePaymentMethod[] = [
  "cash",
  "upi",
  "bank_transfer",
  "card",
  "cheque",
  "online",
  "other",
];

export const financeAdjustmentTypes: FinanceAdjustmentType[] = [
  "discount",
  "waiver",
  "correction",
  "penalty",
  "refund_note",
  "other",
];

const settingsSelect =
  "tenant_id,default_currency,invoice_prefix,receipt_prefix,next_invoice_number,next_receipt_number,payment_terms_days,metadata_json,updated_at";
const feePlanSelect =
  "id,tenant_id,course_id,name,description,amount,currency,billing_cycle,installments_count,due_day,status,metadata_json,created_at";
const invoiceSelect =
  "id,tenant_id,student_id,course_id,fee_plan_id,invoice_number,invoice_date,due_date,subtotal_amount,discount_amount,tax_amount,total_amount,paid_amount,balance_amount,currency,status,notes,created_at";
const paymentSelect =
  "id,tenant_id,invoice_id,student_id,payment_date,amount,currency,payment_method,status,created_at";
const receiptSelect =
  "id,tenant_id,payment_id,student_id,receipt_number,issued_at,amount,currency,status,created_at";
const adjustmentSelect =
  "id,tenant_id,invoice_id,student_id,adjustment_type,amount,status,created_at";
const activitySelect =
  "id,tenant_id,student_id,invoice_id,payment_id,action,metadata_json,created_at";

function isSchemaMissing(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST200" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find the function")
  );
}

function emptyDashboard(): FinanceDashboard {
  return {
    currency: "INR",
    invoice_counts: {},
    overdue_amount: 0,
    recent_payments: [],
    total_collected: 0,
    total_invoiced: 0,
    total_outstanding: 0,
  };
}

export function formatFinanceCurrency(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    currency,
    style: "currency",
  }).format(value);
}

export function formatFinanceDate(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export async function getFinanceCenterData(
  tenantId: string,
): Promise<FinanceCenterData> {
  const supabase = getSupabaseClient();
  const [
    dashboardResult,
    settingsResult,
    feePlansResult,
    invoicesResult,
    paymentsResult,
    receiptsResult,
    adjustmentsResult,
    activitiesResult,
  ] = await Promise.all([
    supabase.rpc("get_finance_dashboard", { p_tenant_id: tenantId }),
    supabase
      .from("finance_settings")
      .select(settingsSelect)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("finance_fee_plans")
      .select(feePlanSelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("finance_invoices")
      .select(invoiceSelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("finance_payments")
      .select(paymentSelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("finance_receipts")
      .select(receiptSelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("finance_adjustments")
      .select(adjustmentSelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("finance_activity_logs")
      .select(activitySelect)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(120),
  ]);

  const allErrors = [
    dashboardResult.error,
    settingsResult.error,
    feePlansResult.error,
    invoicesResult.error,
    paymentsResult.error,
    receiptsResult.error,
    adjustmentsResult.error,
    activitiesResult.error,
  ].filter(Boolean);

  if (allErrors.some(isSchemaMissing)) {
    return {
      activities: [],
      adjustments: [],
      dashboard: emptyDashboard(),
      feePlans: [],
      invoices: [],
      payments: [],
      receipts: [],
      settings: null,
    };
  }

  if (dashboardResult.error) throw dashboardResult.error;
  if (settingsResult.error) throw settingsResult.error;
  if (feePlansResult.error) throw feePlansResult.error;
  if (invoicesResult.error) throw invoicesResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  if (receiptsResult.error) throw receiptsResult.error;
  if (adjustmentsResult.error) throw adjustmentsResult.error;
  if (activitiesResult.error) throw activitiesResult.error;

  return {
    activities: (activitiesResult.data ?? []) as FinanceActivityLog[],
    adjustments: (adjustmentsResult.data ?? []) as FinanceAdjustment[],
    dashboard: (dashboardResult.data as FinanceDashboard | null) ?? emptyDashboard(),
    feePlans: (feePlansResult.data ?? []) as FinanceFeePlan[],
    invoices: (invoicesResult.data ?? []) as FinanceInvoice[],
    payments: (paymentsResult.data ?? []) as FinancePayment[],
    receipts: (receiptsResult.data ?? []) as FinanceReceipt[],
    settings: (settingsResult.data as FinanceSettings | null) ?? null,
  };
}

export async function getStudentFinanceSummary(studentId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_finance_summary", {
    p_student_id: studentId,
  });

  if (error) {
    if (isSchemaMissing(error)) {
      return {
        currency: "INR",
        invoices: [],
        outstanding_amount: 0,
        paid_amount: 0,
        payments: [],
        receipts: [],
        student_id: studentId,
        tenant_id: "",
      } satisfies FinanceStudentSummary;
    }

    throw error;
  }

  return data as FinanceStudentSummary;
}

export async function upsertFinanceSettings(input: {
  invoicePrefix: string;
  paymentTermsDays: number;
  receiptPrefix: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("upsert_finance_settings", {
    p_invoice_prefix: input.invoicePrefix,
    p_metadata_json: {},
    p_payment_terms_days: input.paymentTermsDays,
    p_receipt_prefix: input.receiptPrefix,
    p_tenant_id: input.tenantId,
  });

  if (error) throw error;
  return data as string;
}

export async function createFinanceFeePlan(input: {
  amount: number;
  billingCycle: FinanceBillingCycle;
  courseId?: string | null;
  description?: string;
  dueDay?: number | null;
  installmentsCount?: number | null;
  name: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_fee_plan", {
    p_amount: input.amount,
    p_billing_cycle: input.billingCycle,
    p_course_id: input.courseId || null,
    p_description: input.description || null,
    p_due_day: input.dueDay ?? null,
    p_installments_count: input.installmentsCount ?? null,
    p_metadata_json: {},
    p_name: input.name,
    p_tenant_id: input.tenantId,
  });

  if (error) throw error;
  return data as string;
}

export async function updateFinanceFeePlan(input: {
  amount?: number | null;
  feePlanId: string;
  status?: FinanceFeePlanStatus | null;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_fee_plan", {
    p_amount: input.amount ?? null,
    p_billing_cycle: null,
    p_description: null,
    p_due_day: null,
    p_fee_plan_id: input.feePlanId,
    p_installments_count: null,
    p_metadata_json: null,
    p_name: null,
    p_status: input.status ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function createFinanceInvoice(input: {
  courseId?: string | null;
  discountAmount: number;
  dueDate?: string | null;
  feePlanId?: string | null;
  invoiceDate: string;
  notes?: string;
  studentId: string;
  subtotalAmount: number;
  taxAmount: number;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_invoice", {
    p_course_id: input.courseId || null,
    p_discount_amount: input.discountAmount,
    p_due_date: input.dueDate || null,
    p_fee_plan_id: input.feePlanId || null,
    p_invoice_date: input.invoiceDate,
    p_metadata_json: {},
    p_notes: input.notes || null,
    p_student_id: input.studentId,
    p_subtotal_amount: input.subtotalAmount,
    p_tax_amount: input.taxAmount,
    p_tenant_id: input.tenantId,
  });

  if (error) throw error;
  return data as string;
}

export async function recordFinancePayment(input: {
  amount: number;
  invoiceId?: string | null;
  notes?: string;
  paymentDate: string;
  paymentMethod: FinancePaymentMethod;
  referenceNumber?: string;
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("record_payment", {
    p_amount: input.amount,
    p_invoice_id: input.invoiceId || null,
    p_metadata_json: {},
    p_notes: input.notes || null,
    p_payment_date: input.paymentDate,
    p_payment_method: input.paymentMethod,
    p_reference_number: input.referenceNumber || null,
    p_student_id: input.studentId,
    p_tenant_id: input.tenantId,
  });

  if (error) throw error;
  return data as string;
}

export async function cancelFinancePayment(paymentId: string, reason: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_payment", {
    p_payment_id: paymentId,
    p_reason: reason || null,
  });

  if (error) throw error;
  return data as string;
}

export async function voidFinanceInvoice(invoiceId: string, reason: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("void_invoice", {
    p_invoice_id: invoiceId,
    p_reason: reason || null,
  });

  if (error) throw error;
  return data as string;
}

export async function applyFinanceAdjustment(input: {
  adjustmentType: FinanceAdjustmentType;
  amount: number;
  invoiceId: string;
  reason: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("apply_invoice_adjustment", {
    p_adjustment_type: input.adjustmentType,
    p_amount: input.amount,
    p_invoice_id: input.invoiceId,
    p_metadata_json: {},
    p_reason: input.reason,
  });

  if (error) throw error;
  return data as string;
}
