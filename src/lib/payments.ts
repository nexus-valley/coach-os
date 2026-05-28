import type { Course } from "@/src/lib/courses";
import type { Enrollment } from "@/src/lib/enrollments";
import type { Student } from "@/src/lib/students";
import { logActivity } from "@/src/lib/auditLogger";
import { runAutomationTrigger } from "@/src/lib/automationTriggers";
import { requireTenantPermission } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type PaymentMethod = "UPI" | "Cash" | "Bank" | "UPI Link";
export type PaymentStatus = "completed" | "pending" | "failed";

export type Payment = {
  id: string;
  tenant_id: string;
  student_id: string;
  course_id: string;
  currency: string;
  enrollment_id: string | null;
  amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  notes: string | null;
  paid_at: string;
  receipt_generated_at: string | null;
  receipt_number: string | null;
  created_at: string;
};

type PaymentCourse = Pick<Course, "id" | "tenant_id" | "title">;
type PaymentStudent = Pick<
  Student,
  "email" | "full_name" | "id" | "phone" | "tenant_id"
>;

export type PaymentWithRelations = Payment & {
  course: PaymentCourse | null;
  enrollment: Enrollment | null;
  student: PaymentStudent | null;
};

export type CreatePaymentInput = {
  amount: number;
  course_id: string;
  enrollment_id: string | null;
  notes: string;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  student_id: string;
  tenant_id: string;
};

const paymentSelect =
  "id,tenant_id,student_id,course_id,enrollment_id,amount,currency,payment_method,status,paid_at,receipt_number,receipt_generated_at,notes,created_at";

async function loadPaymentRelations(payments: Payment[], tenantId: string) {
  const supabase = getSupabaseClient();
  const courseIds = Array.from(
    new Set(payments.map((payment) => payment.course_id)),
  );
  const studentIds = Array.from(
    new Set(payments.map((payment) => payment.student_id)),
  );

  const [coursesResult, studentsResult] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select("id,tenant_id,title")
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("students")
          .select("id,tenant_id,full_name,email,phone")
          .eq("tenant_id", tenantId)
          .in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  const courses = (coursesResult.data ?? []) as PaymentCourse[];
  const students = (studentsResult.data ?? []) as PaymentStudent[];
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const studentById = new Map(students.map((student) => [student.id, student]));

  return payments.map((payment) => ({
    ...payment,
    course: courseById.get(payment.course_id) ?? null,
    enrollment: null,
    student: studentById.get(payment.student_id) ?? null,
  }));
}

async function getPaymentsByFilter(
  tenantId: string,
  filter?: { column: "student_id"; value: string },
) {
  await requireTenantPermission({
    description: "Blocked payment access without payment visibility permission.",
    permission: "access_payments",
    tenantId,
  });

  const supabase = getSupabaseClient();
  let query = supabase
    .from("payments")
    .select(paymentSelect)
    .eq("tenant_id", tenantId)
    .order("paid_at", { ascending: false });

  if (filter) {
    query = query.eq(filter.column, filter.value);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const payments = (data ?? []) as Payment[];

  if (payments.length === 0) {
    return [];
  }

  return loadPaymentRelations(payments, tenantId);
}

export async function getPaymentsForTenant(tenantId: string) {
  return getPaymentsByFilter(tenantId);
}

export async function createPayment(input: CreatePaymentInput) {
  await requireTenantPermission({
    description: "Blocked payment creation without payment management permission.",
    permission: "manage_payments",
    tenantId: input.tenant_id,
  });

  const supabase = getSupabaseClient();
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      amount: input.amount,
      course_id: input.course_id,
      currency: "USD",
      enrollment_id: input.enrollment_id,
      notes: input.notes.trim() || null,
      payment_method: input.payment_method,
      status: input.status,
      student_id: input.student_id,
      tenant_id: input.tenant_id,
    })
    .select(paymentSelect)
    .single();

  if (error) {
    throw error;
  }

  const payment = data as Payment;

  await logActivity({
    action: "payment_created",
    description: "Recorded payment",
    entityId: payment.id,
    entityName: `${payment.currency} ${payment.amount}`,
    entityType: "payment",
    metadata: {
      amount: payment.amount,
      courseId: payment.course_id,
      method: payment.payment_method,
      status: payment.status,
      studentId: payment.student_id,
    },
    tenantId: payment.tenant_id,
  });

  if (payment.status === "completed") {
    await runAutomationTrigger("payment_received", {
      entityId: payment.id,
      entityType: "payment",
      metadata: {
        amount: payment.amount,
        course_id: payment.course_id,
        currency: payment.currency,
        status: payment.status,
        student_id: payment.student_id,
      },
      tenantId: payment.tenant_id,
    });
  }

  return payment;
}

export async function getPaymentsByStudent(studentId: string, tenantId: string) {
  return getPaymentsByFilter(tenantId, {
    column: "student_id",
    value: studentId,
  });
}

export async function deletePayment(paymentId: string, tenantId: string) {
  await requireTenantPermission({
    description: "Blocked payment deletion without delete permission.",
    permission: "delete_records",
    tenantId,
  });

  const supabase = getSupabaseClient();
  const { data: existingPayment, error: existingError } = await supabase
    .from("payments")
    .select(paymentSelect)
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("payments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", paymentId);

  if (error) {
    throw error;
  }

  if (existingPayment) {
    const payment = existingPayment as Payment;
    await logActivity({
      action: "payment_deleted",
      description: "Deleted payment record",
      entityId: payment.id,
      entityName: `${payment.currency} ${payment.amount}`,
      entityType: "payment",
      metadata: {
        amount: payment.amount,
        courseId: payment.course_id,
        method: payment.payment_method,
        status: payment.status,
        studentId: payment.student_id,
      },
      severity: "warning",
      tenantId: payment.tenant_id,
    });
  }
}
