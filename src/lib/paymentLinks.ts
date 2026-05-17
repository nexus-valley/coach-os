import type { Course } from "@/src/lib/courses";
import type { Enrollment } from "@/src/lib/enrollments";
import type { Student } from "@/src/lib/students";
import { logActivity } from "@/src/lib/auditLogger";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

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

function createManualUpiLink(amount: number) {
  const params = new URLSearchParams({
    am: amount.toFixed(2),
    cu: "INR",
    pa: "YOUR_UPI_ID",
    pn: "CoachFort",
  });

  return `upi://pay?${params.toString()}`;
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

export function buildManualUpiPaymentUrl(amount: number) {
  return createManualUpiLink(amount);
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

export async function createPaymentLink(payload: CreatePaymentLinkPayload) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("You must be logged in to create a payment link.");
  }

  if (!payload.student_id) {
    throw new Error("Select a student.");
  }

  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  const paymentUrl =
    payload.payment_url.trim() || createManualUpiLink(payload.amount);

  const { data, error } = await supabase
    .from("payment_links")
    .insert({
      amount: payload.amount,
      course_id: payload.course_id,
      created_by: user.id,
      currency: "INR",
      description: payload.description.trim() || null,
      enrollment_id: payload.enrollment_id,
      expires_at: payload.expires_at || null,
      payment_url: paymentUrl,
      provider: "manual",
      status: "created",
      student_id: payload.student_id,
      tenant_id: payload.tenant_id,
    })
    .select(paymentLinkSelect)
    .single();

  if (error) {
    throw error;
  }

  const [link] = await attachPaymentLinkRelations(
    [data as PaymentLink],
    payload.tenant_id,
  );

  await logActivity({
    action: "payment_link_created",
    description: "Created payment link",
    entityId: link.id,
    entityName: link.student?.full_name ?? "Payment link",
    entityType: "payment_link",
    metadata: {
      amount: link.amount,
      courseId: link.course_id,
      status: link.status,
      studentId: link.student_id,
    },
    tenantId: link.tenant_id,
  });

  return link;
}

export async function updatePaymentLinkStatus(
  paymentLinkId: string,
  tenantId: string,
  status: PaymentLinkStatus,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("payment_links")
    .update({ status })
    .eq("tenant_id", tenantId)
    .eq("id", paymentLinkId)
    .select(paymentLinkSelect)
    .single();

  if (error) {
    throw error;
  }

  const [link] = await attachPaymentLinkRelations([data as PaymentLink], tenantId);

  await logActivity({
    action: status === "sent" ? "payment_link_sent" : "payment_link_updated",
    description:
      status === "sent"
        ? "Marked payment link as sent"
        : `Updated payment link status to ${status}`,
    entityId: link.id,
    entityName: link.student?.full_name ?? "Payment link",
    entityType: "payment_link",
    metadata: { status: link.status, studentId: link.student_id },
    tenantId: link.tenant_id,
  });

  return link;
}

export async function deletePaymentLink(
  paymentLinkId: string,
  tenantId: string,
) {
  const supabase = getSupabaseClient();
  const { data: existingLink, error: existingError } = await supabase
    .from("payment_links")
    .select(paymentLinkSelect)
    .eq("tenant_id", tenantId)
    .eq("id", paymentLinkId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { error } = await supabase
    .from("payment_links")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", paymentLinkId);

  if (error) {
    throw error;
  }

  if (existingLink) {
    const [link] = await attachPaymentLinkRelations(
      [existingLink as PaymentLink],
      tenantId,
    );
    await logActivity({
      action: "payment_link_deleted",
      description: "Deleted payment link",
      entityId: link.id,
      entityName: link.student?.full_name ?? "Payment link",
      entityType: "payment_link",
      metadata: {
        amount: link.amount,
        courseId: link.course_id,
        status: link.status,
        studentId: link.student_id,
      },
      severity: "warning",
      tenantId: link.tenant_id,
    });
  }
}

export async function convertPaymentLinkToPayment(
  paymentLinkId: string,
  tenantId: string,
  notes = "Paid via payment link",
) {
  const supabase = getSupabaseClient();
  const { data: existingLink, error: linkError } = await supabase
    .from("payment_links")
    .select(paymentLinkSelect)
    .eq("tenant_id", tenantId)
    .eq("id", paymentLinkId)
    .maybeSingle();

  if (linkError) {
    throw linkError;
  }

  if (!existingLink) {
    throw new Error("Payment link not found in this workspace.");
  }

  const link = existingLink as PaymentLink;

  if (link.status === "paid" && link.paid_at) {
    throw new Error("Payment has already been recorded for this link.");
  }

  if (!link.course_id) {
    throw new Error("Select a course before recording this link as payment.");
  }

  const paymentNotes = notes.trim() || link.description || "Paid via payment link";
  let duplicateQuery = supabase
    .from("payments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("student_id", link.student_id)
    .eq("course_id", link.course_id)
    .eq("amount", link.amount)
    .eq("payment_method", "UPI Link")
    .eq("status", "completed")
    .eq("notes", paymentNotes);

  duplicateQuery = link.enrollment_id
    ? duplicateQuery.eq("enrollment_id", link.enrollment_id)
    : duplicateQuery.is("enrollment_id", null);

  const { data: duplicatePayments, error: duplicateError } =
    await duplicateQuery.limit(1);

  if (duplicateError) {
    throw duplicateError;
  }

  if ((duplicatePayments ?? []).length > 0) {
    throw new Error("Payment has already been recorded for this link.");
  }

  const paidAt = new Date().toISOString();
  const { error: paymentError } = await supabase.from("payments").insert({
    amount: link.amount,
    course_id: link.course_id,
    currency: link.currency || "INR",
    enrollment_id: link.enrollment_id,
    notes: paymentNotes,
    paid_at: paidAt,
    payment_method: "UPI Link",
    status: "completed",
    student_id: link.student_id,
    tenant_id: tenantId,
  });

  if (paymentError) {
    throw paymentError;
  }

  const { data: updatedLink, error: updateError } = await supabase
    .from("payment_links")
    .update({
      paid_at: paidAt,
      status: "paid",
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentLinkId)
    .select(paymentLinkSelect)
    .single();

  if (updateError) {
    throw updateError;
  }

  const [convertedLink] = await attachPaymentLinkRelations(
    [updatedLink as PaymentLink],
    tenantId,
  );

  await logActivity({
    action: "payment_link_converted",
    description: "Recorded completed payment from payment link",
    entityId: convertedLink.id,
    entityName: convertedLink.student?.full_name ?? "Payment link",
    entityType: "payment_link",
    metadata: {
      amount: convertedLink.amount,
      courseId: convertedLink.course_id,
      studentId: convertedLink.student_id,
    },
    tenantId: convertedLink.tenant_id,
  });

  return convertedLink;
}
