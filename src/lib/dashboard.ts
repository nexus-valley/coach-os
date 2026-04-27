import type { CourseStatus } from "@/src/lib/courses";
import type { PaymentMethod, PaymentStatus } from "@/src/lib/payments";
import type { StudentStatus } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

type DashboardPayment = {
  amount: number;
  course_id: string;
  created_at: string;
  currency: string;
  id: string;
  paid_at: string;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  student_id: string;
  tenant_id: string;
};

export type DashboardRecentPayment = DashboardPayment & {
  courseTitle: string;
  studentName: string;
};

export type DashboardRecentStudent = {
  created_at: string;
  email: string | null;
  full_name: string;
  id: string;
  phone: string | null;
  status: StudentStatus;
};

export type DashboardCourseRevenue = {
  courseId: string;
  courseTitle: string;
  currency: string;
  paymentCount: number;
  revenue: number;
};

export type DashboardMetrics = {
  activeCourses: number;
  courseRevenue: DashboardCourseRevenue[];
  paymentStatusSummary: Record<PaymentStatus, number>;
  pendingPayments: number;
  recentPayments: DashboardRecentPayment[];
  recentStudents: DashboardRecentStudent[];
  totalEnrollments: number;
  totalRevenue: number;
  totalStudents: number;
};

type DashboardCourseLookup = {
  id: string;
  status: CourseStatus;
  title: string;
};

type DashboardStudentLookup = {
  full_name: string;
  id: string;
};

const paymentSelect =
  "id,tenant_id,student_id,course_id,amount,currency,payment_method,status,paid_at,created_at";

function sumCompletedRevenue(payments: DashboardPayment[]) {
  return payments
    .filter((payment) => payment.status === "completed")
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

function buildPaymentSummary(payments: DashboardPayment[]) {
  return payments.reduce<Record<PaymentStatus, number>>(
    (summary, payment) => ({
      ...summary,
      [payment.status]: summary[payment.status] + 1,
    }),
    {
      completed: 0,
      failed: 0,
      pending: 0,
    },
  );
}

function buildCourseRevenue(
  payments: DashboardPayment[],
  coursesById: Map<string, DashboardCourseLookup>,
) {
  const revenueByCourse = new Map<string, DashboardCourseRevenue>();

  payments
    .filter((payment) => payment.status === "completed")
    .forEach((payment) => {
      const current = revenueByCourse.get(payment.course_id) ?? {
        courseId: payment.course_id,
        courseTitle:
          coursesById.get(payment.course_id)?.title ?? "Course unavailable",
        currency: payment.currency || "USD",
        paymentCount: 0,
        revenue: 0,
      };

      revenueByCourse.set(payment.course_id, {
        ...current,
        paymentCount: current.paymentCount + 1,
        revenue: current.revenue + Number(payment.amount || 0),
      });
    });

  return Array.from(revenueByCourse.values()).sort(
    (left, right) => right.revenue - left.revenue,
  );
}

export async function getDashboardMetrics(
  tenantId: string,
): Promise<DashboardMetrics> {
  const supabase = getSupabaseClient();

  const [
    studentsCountResult,
    publishedCoursesCountResult,
    draftCoursesCountResult,
    enrollmentsCountResult,
    paymentsResult,
    recentStudentsResult,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "published"),
    supabase
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "draft"),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("payments")
      .select(paymentSelect)
      .eq("tenant_id", tenantId)
      .order("paid_at", { ascending: false }),
    supabase
      .from("students")
      .select("id,full_name,email,phone,status,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (studentsCountResult.error) {
    throw studentsCountResult.error;
  }

  if (publishedCoursesCountResult.error) {
    throw publishedCoursesCountResult.error;
  }

  if (draftCoursesCountResult.error) {
    throw draftCoursesCountResult.error;
  }

  if (enrollmentsCountResult.error) {
    throw enrollmentsCountResult.error;
  }

  if (paymentsResult.error) {
    throw paymentsResult.error;
  }

  if (recentStudentsResult.error) {
    throw recentStudentsResult.error;
  }

  const payments = (paymentsResult.data ?? []) as DashboardPayment[];
  const courseIds = Array.from(
    new Set(payments.map((payment) => payment.course_id)),
  );
  const studentIds = Array.from(
    new Set(payments.slice(0, 5).map((payment) => payment.student_id)),
  );

  const [coursesResult, paymentStudentsResult] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select("id,title,status")
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase
          .from("students")
          .select("id,full_name")
          .eq("tenant_id", tenantId)
          .in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (paymentStudentsResult.error) {
    throw paymentStudentsResult.error;
  }

  const coursesById = new Map(
    ((coursesResult.data ?? []) as DashboardCourseLookup[]).map((course) => [
      course.id,
      course,
    ]),
  );
  const studentsById = new Map(
    ((paymentStudentsResult.data ?? []) as DashboardStudentLookup[]).map(
      (student) => [student.id, student],
    ),
  );
  const publishedCourses = publishedCoursesCountResult.count ?? 0;
  const draftCourses = draftCoursesCountResult.count ?? 0;

  return {
    activeCourses: publishedCourses > 0 ? publishedCourses : draftCourses,
    courseRevenue: buildCourseRevenue(payments, coursesById),
    paymentStatusSummary: buildPaymentSummary(payments),
    pendingPayments: payments.filter((payment) => payment.status === "pending")
      .length,
    recentPayments: payments.slice(0, 5).map((payment) => ({
      ...payment,
      courseTitle:
        coursesById.get(payment.course_id)?.title ?? "Course unavailable",
      studentName:
        studentsById.get(payment.student_id)?.full_name ??
        "Student unavailable",
    })),
    recentStudents: (recentStudentsResult.data ??
      []) as DashboardRecentStudent[],
    totalEnrollments: enrollmentsCountResult.count ?? 0,
    totalRevenue: sumCompletedRevenue(payments),
    totalStudents: studentsCountResult.count ?? 0,
  };
}
