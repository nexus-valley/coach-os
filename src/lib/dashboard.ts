import { getAutomationRuleCounts } from "@/src/lib/automations";
import type { CourseStatus } from "@/src/lib/courses";
import type { PaymentMethod, PaymentStatus } from "@/src/lib/payments";
import { getReminderCounts } from "@/src/lib/reminders";
import type { StudentStatus } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";

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

export type DashboardSessionPreview = {
  cohortName: string | null;
  courseTitle: string | null;
  id: string;
  scheduled_start_at: string;
  status: string;
  title: string;
};

export type DashboardAttendanceSummary = {
  attendancePercent: number | null;
  lowAttendanceAlerts: number;
  recentSessions: DashboardSessionPreview[];
  totalMarkedAttendance: number;
  upcomingSessions: DashboardSessionPreview[];
};

export type DashboardMetrics = {
  activeCourses: number;
  activeAutomations: number;
  attendance: DashboardAttendanceSummary;
  courseRevenue: DashboardCourseRevenue[];
  paymentStatusSummary: Record<PaymentStatus, number>;
  pendingPayments: number;
  pendingRemindersDue: number;
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

const emptyAttendanceSummary: DashboardAttendanceSummary = {
  attendancePercent: null,
  lowAttendanceAlerts: 0,
  recentSessions: [],
  totalMarkedAttendance: 0,
  upcomingSessions: [],
};

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

async function loadSessionPreviews(
  sessions: {
    cohort_id: string | null;
    course_id: string | null;
    id: string;
    scheduled_start_at: string;
    status: string;
    title: string;
  }[],
  tenantId: string,
) {
  if (sessions.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const courseIds = Array.from(
    new Set(sessions.map((session) => session.course_id).filter(Boolean)),
  ) as string[];
  const cohortIds = Array.from(
    new Set(sessions.map((session) => session.cohort_id).filter(Boolean)),
  ) as string[];

  const [coursesResult, cohortsResult] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select("id,title")
          .eq("tenant_id", tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    cohortIds.length
      ? supabase
          .from("cohorts")
          .select("id,name")
          .eq("tenant_id", tenantId)
          .in("id", cohortIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (cohortsResult.error) {
    throw cohortsResult.error;
  }

  const courseById = new Map(
    ((coursesResult.data ?? []) as { id: string; title: string }[]).map(
      (course) => [course.id, course.title],
    ),
  );
  const cohortById = new Map(
    ((cohortsResult.data ?? []) as { id: string; name: string }[]).map(
      (cohort) => [cohort.id, cohort.name],
    ),
  );

  return sessions.map((session) => ({
    cohortName: session.cohort_id
      ? cohortById.get(session.cohort_id) ?? null
      : null,
    courseTitle: session.course_id
      ? courseById.get(session.course_id) ?? null
      : null,
    id: session.id,
    scheduled_start_at: session.scheduled_start_at,
    status: session.status,
    title: session.title,
  })) satisfies DashboardSessionPreview[];
}

async function getAttendanceDashboardSummary(
  tenantId: string,
  trainerScope: Awaited<ReturnType<typeof getCurrentTrainerScope>>,
) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  let scopedSessionIds: string[] | null = null;
  let upcomingQuery = supabase
    .from("sessions")
    .select("id,title,status,scheduled_start_at,course_id,cohort_id")
    .eq("tenant_id", tenantId)
    .eq("status", "scheduled")
    .gte("scheduled_start_at", now)
    .order("scheduled_start_at", { ascending: true })
    .limit(3);
  let recentQuery = supabase
    .from("sessions")
    .select("id,title,status,scheduled_start_at,course_id,cohort_id")
    .eq("tenant_id", tenantId)
    .order("scheduled_start_at", { ascending: false })
    .limit(3);

  if (trainerScope) {
    const filters: string[] = [];

    if (trainerScope.courseIds.length > 0) {
      filters.push(`course_id.in.(${trainerScope.courseIds.join(",")})`);
    }

    if (trainerScope.cohortIds.length > 0) {
      filters.push(`cohort_id.in.(${trainerScope.cohortIds.join(",")})`);
    }

    if (filters.length === 0) {
      return emptyAttendanceSummary;
    }

    upcomingQuery = upcomingQuery.or(filters.join(","));
    recentQuery = recentQuery.or(filters.join(","));

    const scopedSessionsResult = await supabase
      .from("sessions")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(filters.join(","));

    if (scopedSessionsResult.error) {
      throw scopedSessionsResult.error;
    }

    scopedSessionIds = ((scopedSessionsResult.data ?? []) as { id: string }[]).map(
      (session) => session.id,
    );

    if (scopedSessionIds.length === 0) {
      return emptyAttendanceSummary;
    }
  }

  let attendanceQuery = supabase
    .from("attendance_records")
    .select("status")
    .eq("tenant_id", tenantId);

  if (scopedSessionIds) {
    attendanceQuery = attendanceQuery.in("session_id", scopedSessionIds);
  }

  const [upcomingResult, recentResult, attendanceResult] = await Promise.all([
    upcomingQuery,
    recentQuery,
    attendanceQuery,
  ]);

  if (upcomingResult.error) {
    throw upcomingResult.error;
  }

  if (recentResult.error) {
    throw recentResult.error;
  }

  if (attendanceResult.error) {
    throw attendanceResult.error;
  }

  const attendanceRows = (attendanceResult.data ?? []) as { status: string }[];
  const attended = attendanceRows.filter(
    (record) => record.status === "present" || record.status === "late",
  ).length;
  const absent = attendanceRows.filter((record) => record.status === "absent")
    .length;

  return {
    attendancePercent:
      attendanceRows.length > 0
        ? Math.round((attended / attendanceRows.length) * 100)
        : null,
    lowAttendanceAlerts: absent,
    recentSessions: await loadSessionPreviews(
      (recentResult.data ?? []) as {
        cohort_id: string | null;
        course_id: string | null;
        id: string;
        scheduled_start_at: string;
        status: string;
        title: string;
      }[],
      tenantId,
    ),
    totalMarkedAttendance: attendanceRows.length,
    upcomingSessions: await loadSessionPreviews(
      (upcomingResult.data ?? []) as {
        cohort_id: string | null;
        course_id: string | null;
        id: string;
        scheduled_start_at: string;
        status: string;
        title: string;
      }[],
      tenantId,
    ),
  } satisfies DashboardAttendanceSummary;
}

export async function getDashboardMetrics(
  tenantId: string,
): Promise<DashboardMetrics> {
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);

  if (trainerScope) {
    const [courseRowsResult, enrollmentRowsResult, cohortMembersResult] =
      await Promise.all([
        trainerScope.courseIds.length
          ? supabase
              .from("courses")
              .select("id,title,status")
              .eq("tenant_id", tenantId)
              .in("id", trainerScope.courseIds)
          : Promise.resolve({ data: [], error: null }),
        trainerScope.courseIds.length
          ? supabase
              .from("enrollments")
              .select("id,student_id,course_id")
              .eq("tenant_id", tenantId)
              .in("course_id", trainerScope.courseIds)
          : Promise.resolve({ data: [], error: null }),
        trainerScope.cohortIds.length
          ? supabase
              .from("cohort_members")
              .select("student_id")
              .eq("tenant_id", tenantId)
              .in("cohort_id", trainerScope.cohortIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (courseRowsResult.error) {
      throw courseRowsResult.error;
    }

    if (enrollmentRowsResult.error) {
      throw enrollmentRowsResult.error;
    }

    if (cohortMembersResult.error) {
      throw cohortMembersResult.error;
    }

    const enrollmentRows = (enrollmentRowsResult.data ?? []) as {
      course_id: string;
      id: string;
      student_id: string;
    }[];
    const studentIds = Array.from(
      new Set([
        ...enrollmentRows.map((enrollment) => enrollment.student_id),
        ...((cohortMembersResult.data ?? []) as { student_id: string }[]).map(
          (member) => member.student_id,
        ),
      ]),
    );
    const recentStudentsResult = studentIds.length
      ? await supabase
          .from("students")
          .select("id,full_name,email,phone,status,created_at")
          .eq("tenant_id", tenantId)
          .in("id", studentIds)
          .order("created_at", { ascending: false })
          .limit(5)
      : { data: [], error: null };

    if (recentStudentsResult.error) {
      throw recentStudentsResult.error;
    }

    const courses = (courseRowsResult.data ?? []) as DashboardCourseLookup[];
    const activeCourses = courses.filter(
      (course) => course.status === "published",
    ).length;

    const attendance = await getAttendanceDashboardSummary(tenantId, trainerScope);

    return {
      activeAutomations: 0,
      activeCourses: activeCourses > 0 ? activeCourses : courses.length,
      attendance,
      courseRevenue: [],
      paymentStatusSummary: {
        completed: 0,
        failed: 0,
        pending: 0,
      },
      pendingPayments: 0,
      pendingRemindersDue: 0,
      recentPayments: [],
      recentStudents: (recentStudentsResult.data ?? []) as DashboardRecentStudent[],
      totalEnrollments: enrollmentRows.length,
      totalRevenue: 0,
      totalStudents: studentIds.length,
    };
  }

  const [
    studentsCountResult,
    publishedCoursesCountResult,
    draftCoursesCountResult,
    enrollmentsCountResult,
    paymentsResult,
    recentStudentsResult,
    reminderCounts,
    automationCounts,
    attendance,
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
    getReminderCounts(tenantId),
    getAutomationRuleCounts(tenantId),
    getAttendanceDashboardSummary(tenantId, null),
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
    activeAutomations: automationCounts.activeAutomations,
    activeCourses: publishedCourses > 0 ? publishedCourses : draftCourses,
    attendance,
    courseRevenue: buildCourseRevenue(payments, coursesById),
    paymentStatusSummary: buildPaymentSummary(payments),
    pendingPayments: payments.filter((payment) => payment.status === "pending")
      .length,
    pendingRemindersDue: reminderCounts.pendingDueTodayOrOverdue,
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
