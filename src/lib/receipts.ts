import type { Course } from "@/src/lib/courses";
import type { Payment, PaymentWithRelations } from "@/src/lib/payments";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

type ReceiptCourse = Pick<Course, "id" | "tenant_id" | "title">;
type ReceiptStudent = Pick<
  Student,
  "email" | "full_name" | "id" | "phone" | "tenant_id"
>;

const receiptPaymentSelect =
  "id,tenant_id,student_id,course_id,enrollment_id,amount,currency,payment_method,status,paid_at,receipt_number,receipt_generated_at,notes,created_at";

function legacyReceiptWriteRetired(): never {
  throw new Error(
    "Legacy receipt generation is retired. Use Finance Center receipts.",
  );
}

function padReceiptSequence(value: number) {
  return String(value).padStart(4, "0");
}

async function attachReceiptRelations(payment: Payment) {
  const supabase = getSupabaseClient();
  const [courseResult, studentResult] = await Promise.all([
    supabase
      .from("courses")
      .select("id,tenant_id,title")
      .eq("tenant_id", payment.tenant_id)
      .eq("id", payment.course_id)
      .maybeSingle(),
    supabase
      .from("students")
      .select("id,tenant_id,full_name,email,phone")
      .eq("tenant_id", payment.tenant_id)
      .eq("id", payment.student_id)
      .maybeSingle(),
  ]);

  if (courseResult.error) {
    throw courseResult.error;
  }

  if (studentResult.error) {
    throw studentResult.error;
  }

  return {
    ...payment,
    course: (courseResult.data as ReceiptCourse | null) ?? null,
    enrollment: null,
    student: (studentResult.data as ReceiptStudent | null) ?? null,
  } as PaymentWithRelations;
}

export async function generateReceiptNumber(
  paymentId: string,
  tenantId: string,
) {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .not("receipt_number", "is", null);

  if (error) {
    throw error;
  }

  const year = new Date().getFullYear();
  const sequence = padReceiptSequence((count ?? 0) + 1);
  const fallback = paymentId.replace(/-/g, "").slice(0, 4).toUpperCase();

  return `RCPT-${year}-${sequence || fallback}`;
}

export async function attachReceiptToPayment(
  paymentId: string,
  tenantId: string,
): Promise<PaymentWithRelations> {
  void paymentId;
  void tenantId;
  legacyReceiptWriteRetired();
}

export async function getPaymentReceipt(paymentId: string, tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .select(receiptPaymentSelect)
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return attachReceiptRelations(data as Payment);
}
