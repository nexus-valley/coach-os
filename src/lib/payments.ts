import type { Course } from "@/src/lib/courses";
import type { Enrollment } from "@/src/lib/enrollments";
import type { Student } from "@/src/lib/students";
import { requireEffectivePermission } from "@/src/lib/permissions";
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

function legacyPaymentWriteRetired(): never {
  throw new Error(
    "Legacy payment writes are retired. Use Finance Center to manage invoices, payments, and receipts.",
  );
}

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
  await requireEffectivePermission({
    action: filter ? "view_student_payments" : "view_payments",
    description:
      "Blocked payment access without payment visibility permission.",
    entityId: filter?.value ?? tenantId,
    entityType: filter ? "student" : "tenant",
    permission: "view_payments",
    scopeId: filter?.value ?? null,
    scopeType: filter ? "student" : "workspace",
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

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  void input;
  legacyPaymentWriteRetired();
}

export async function getPaymentsByStudent(studentId: string, tenantId: string) {
  return getPaymentsByFilter(tenantId, {
    column: "student_id",
    value: studentId,
  });
}

export async function deletePayment(
  paymentId: string,
  tenantId: string,
): Promise<void> {
  void paymentId;
  void tenantId;
  legacyPaymentWriteRetired();
}
