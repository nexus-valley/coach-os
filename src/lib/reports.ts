import type { Course } from "@/src/lib/courses";
import type { Enrollment } from "@/src/lib/enrollments";
import type { Payment, PaymentWithRelations } from "@/src/lib/payments";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type ReportsDateRange =
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "all_time";

export type CourseRevenueReportRow = {
  completedPaymentCount: number;
  courseId: string;
  courseTitle: string;
  revenueAmount: number;
};

export type ReportsData = {
  courseRevenue: CourseRevenueReportRow[];
  enrollments: Enrollment[];
  metrics: {
    enrollmentsCount: number;
    newStudentsCount: number;
    totalPaymentsCount: number;
    totalRevenue: number;
  };
  payments: PaymentWithRelations[];
  students: Student[];
};

type PaymentCourse = Pick<Course, "id" | "tenant_id" | "title">;
type PaymentStudent = Pick<
  Student,
  "email" | "full_name" | "id" | "phone" | "tenant_id"
>;

const paymentSelect =
  "id,tenant_id,student_id,course_id,enrollment_id,amount,currency,payment_method,status,paid_at,receipt_number,receipt_generated_at,notes,created_at";

const studentSelect =
  "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at";

const enrollmentSelect =
  "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at";

function getRangeStart(dateRange: ReportsDateRange) {
  const now = new Date();

  if (dateRange === "all_time") {
    return null;
  }

  if (dateRange === "this_month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  const days = dateRange === "last_7_days" ? 7 : 30;
  const start = new Date(now);
  start.setDate(now.getDate() - days);
  return start.toISOString();
}

async function attachPaymentRelations(payments: Payment[], tenantId: string) {
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
  })) as PaymentWithRelations[];
}

function getCourseRevenue(payments: PaymentWithRelations[]) {
  const revenueByCourse = new Map<string, CourseRevenueReportRow>();

  for (const payment of payments) {
    if (payment.status !== "completed") {
      continue;
    }

    const current = revenueByCourse.get(payment.course_id) ?? {
      completedPaymentCount: 0,
      courseId: payment.course_id,
      courseTitle: payment.course?.title ?? "Course unavailable",
      revenueAmount: 0,
    };

    current.completedPaymentCount += 1;
    current.revenueAmount += payment.amount;
    revenueByCourse.set(payment.course_id, current);
  }

  return Array.from(revenueByCourse.values()).sort(
    (first, second) => second.revenueAmount - first.revenueAmount,
  );
}

export async function getReportsData(
  tenantId: string,
  dateRange: ReportsDateRange,
) {
  const supabase = getSupabaseClient();
  const rangeStart = getRangeStart(dateRange);

  let paymentsQuery = supabase
    .from("payments")
    .select(paymentSelect)
    .eq("tenant_id", tenantId)
    .order("paid_at", { ascending: false });
  let studentsQuery = supabase
    .from("students")
    .select(studentSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  let enrollmentsQuery = supabase
    .from("enrollments")
    .select(enrollmentSelect)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (rangeStart) {
    paymentsQuery = paymentsQuery.gte("paid_at", rangeStart);
    studentsQuery = studentsQuery.gte("created_at", rangeStart);
    enrollmentsQuery = enrollmentsQuery.gte("created_at", rangeStart);
  }

  const [paymentsResult, studentsResult, enrollmentsResult] = await Promise.all([
    paymentsQuery,
    studentsQuery,
    enrollmentsQuery,
  ]);

  if (paymentsResult.error) {
    throw paymentsResult.error;
  }

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  if (enrollmentsResult.error) {
    throw enrollmentsResult.error;
  }

  const payments = await attachPaymentRelations(
    (paymentsResult.data ?? []) as Payment[],
    tenantId,
  );
  const students = (studentsResult.data ?? []) as Student[];
  const enrollments = (enrollmentsResult.data ?? []) as Enrollment[];
  const completedPayments = payments.filter(
    (payment) => payment.status === "completed",
  );

  return {
    courseRevenue: getCourseRevenue(payments),
    enrollments,
    metrics: {
      enrollmentsCount: enrollments.length,
      newStudentsCount: students.length,
      totalPaymentsCount: payments.length,
      totalRevenue: completedPayments.reduce(
        (total, payment) => total + payment.amount,
        0,
      ),
    },
    payments,
    students,
  } satisfies ReportsData;
}

function escapeCsvCell(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? "" : String(value);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadCsv(fileName: string, headers: string[], rows: string[][]) {
  if (typeof window === "undefined") {
    return;
  }

  const csv = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export function exportPaymentsCsv(data: PaymentWithRelations[]) {
  downloadCsv(
    "payments-report.csv",
    [
      "Student",
      "Course",
      "Amount",
      "Currency",
      "Status",
      "Method",
      "Paid Date",
      "Receipt Number",
    ],
    data.map((payment) => [
      payment.student?.full_name ?? "",
      payment.course?.title ?? "",
      String(payment.amount),
      payment.currency || "USD",
      payment.status,
      payment.payment_method,
      payment.paid_at,
      payment.receipt_number ?? "",
    ]),
  );
}

export function exportStudentsCsv(data: Student[]) {
  downloadCsv(
    "students-report.csv",
    ["Name", "Email", "Phone", "Status", "Source", "Created Date"],
    data.map((student) => [
      student.full_name,
      student.email ?? "",
      student.phone ?? "",
      student.status,
      student.source ?? "",
      student.created_at,
    ]),
  );
}

export function exportCourseRevenueCsv(data: CourseRevenueReportRow[]) {
  downloadCsv(
    "course-revenue-report.csv",
    ["Course", "Completed Payment Count", "Revenue Amount"],
    data.map((course) => [
      course.courseTitle,
      String(course.completedPaymentCount),
      String(course.revenueAmount),
    ]),
  );
}
