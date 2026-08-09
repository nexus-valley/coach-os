import type { Course } from "@/src/lib/courses";
import type { Enrollment } from "@/src/lib/enrollments";
import { requireEffectivePermission } from "@/src/lib/permissions";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type { TenantSettings } from "@/src/lib/tenantSettings";

export type PaymentLinkStatus =
  | "created"
  | "sent"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";

export type PaymentLinkProvider = "manual" | "razorpay";

export type PaymentLink = {
  amount: number;
  course_id: string | null;
  created_at: string;
  created_by: string | null;
  currency: string;
  description: string | null;
  enrollment_id: string | null;
  expires_at: string | null;
  id: string;
  paid_at: string | null;
  payment_url: string | null;
  provider: PaymentLinkProvider;
  provider_link_id: string | null;
  status: PaymentLinkStatus;
  student_id: string;
  tenant_id: string;
  updated_at: string;
};

export type PaymentLinkWithRelations = PaymentLink & {
  course: Pick<Course, "id" | "title"> | null;
  enrollment: Pick<Enrollment, "course_id" | "id" | "status"> | null;
  student: Pick<Student, "email" | "full_name" | "id" | "phone"> | null;
};

export type CreatePaymentLinkPayload = {
  amount: number;
  course_id: string | null;
  description: string;
  enrollment_id: string | null;
  expires_at: string | null;
  payment_url: string;
  student_id: string;
  tenant_id: string;
};

const paymentLinkSelect =
  "id,tenant_id,student_id,course_id,enrollment_id,amount,currency,provider,provider_link_id,payment_url,status,description,expires_at,paid_at,created_by,created_at,updated_at";

function legacyPaymentLinkWriteRetired(): never {
  throw new Error(
    "Payment links are on hold. Use Finance Center for manual invoices, payments, and receipts.",
  );
}

async function attachPaymentLinkRelations(
  links: PaymentLink[],
  tenantId: string,
) {
  if (links.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const studentIds = Array.from(new Set(links.map((link) => link.student_id)));
  const courseIds = Array.from(
    new Set(links.map((link) => link.course_id).filter(Boolean) as string[]),
  );
  const enrollmentIds = Array.from(
    new Set(
      links.map((link) => link.enrollment_id).filter(Boolean) as string[],
    ),
  );

  const [studentsResult, coursesResult, enrollmentsResult] = await Promise.all([
    studentIds.length
      ? supabase
          .from("students")
          .select("id,full_name,email,phone")
          .eq("tenant_id", tenantId)
          .in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length
      ? supabase
          .from("courses")
          .select("id,title")
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    enrollmentIds.length
      ? supabase
          .from("enrollments")
          .select("id,course_id,status")
          .eq("tenant_id", tenantId)
          .in("id", enrollmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (enrollmentsResult.error) {
    throw enrollmentsResult.error;
  }

  const students = (studentsResult.data ?? []) as PaymentLinkWithRelations["student"][];
  const courses = (coursesResult.data ?? []) as PaymentLinkWithRelations["course"][];
  const enrollments = (enrollmentsResult.data ?? []) as PaymentLinkWithRelations["enrollment"][];
  const studentById = new Map(students.map((student) => [student?.id, student]));
  const courseById = new Map(courses.map((course) => [course?.id, course]));
  const enrollmentById = new Map(
    enrollments.map((enrollment) => [enrollment?.id, enrollment]),
  );

  return links.map((link) => ({
    ...link,
    course: link.course_id ? courseById.get(link.course_id) ?? null : null,
    enrollment: link.enrollment_id
      ? enrollmentById.get(link.enrollment_id) ?? null
      : null,
    student: studentById.get(link.student_id) ?? null,
  })) satisfies PaymentLinkWithRelations[];
}

async function getPaymentLinksByFilter(
  tenantId: string,
  filter?: { column: "student_id"; value: string },
) {
  await requireEffectivePermission({
    action: filter ? "view_student_payment_links" : "view_payment_links",
    description:
      "Blocked payment-link access without payment visibility permission.",
    entityId: filter?.value ?? tenantId,
    entityType: filter ? "student" : "tenant",
    permission: "view_payments",
    scopeId: filter?.value ?? null,
    scopeType: filter ? "student" : "workspace",
    tenantId,
  });

  const supabase = getSupabaseClient();
  let query = supabase
    .from("payment_links")
    .select(paymentLinkSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (filter) {
    query = query.eq(filter.column, filter.value);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return attachPaymentLinkRelations((data ?? []) as PaymentLink[], tenantId);
}

export function buildManualUpiPaymentUrl(
  amount: number,
  tenantSettings?: TenantSettings | null,
) {
  void amount;
  void tenantSettings;
  return "";
}

export async function getPaymentLinksForTenant(tenantId: string) {
  return getPaymentLinksByFilter(tenantId);
}

export async function getPaymentLinksByStudent(
  studentId: string,
  tenantId: string,
) {
  return getPaymentLinksByFilter(tenantId, {
    column: "student_id",
    value: studentId,
  });
}

export async function createPaymentLink(
  payload: CreatePaymentLinkPayload,
): Promise<PaymentLinkWithRelations> {
  void payload;
  legacyPaymentLinkWriteRetired();
}

export async function updatePaymentLinkStatus(
  paymentLinkId: string,
  tenantId: string,
  status: PaymentLinkStatus,
): Promise<PaymentLinkWithRelations> {
  void paymentLinkId;
  void tenantId;
  void status;
  legacyPaymentLinkWriteRetired();
}

export async function deletePaymentLink(
  paymentLinkId: string,
  tenantId: string,
): Promise<void> {
  void paymentLinkId;
  void tenantId;
  legacyPaymentLinkWriteRetired();
}

export async function convertPaymentLinkToPayment(
  paymentLinkId: string,
  tenantId: string,
  notes = "Paid via payment link",
): Promise<PaymentLinkWithRelations> {
  void paymentLinkId;
  void tenantId;
  void notes;
  legacyPaymentLinkWriteRetired();
}
