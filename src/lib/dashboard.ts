import { getAutomationRuleCounts } from "@/src/lib/automations";
import {
  getTeamChatThreads,
  type AcademyChatThreadType,
} from "@/src/lib/academyChat";
import type { CourseStatus } from "@/src/lib/courses";
import { getDelegatedPermissionCounts } from "@/src/lib/delegatedPermissions";
import type {
  FinanceInvoiceStatus,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from "@/src/lib/finance";
import { getMemberRoleForTenant } from "@/src/lib/permissions";
import type {
  SessionDeliveryMode,
  SessionMeetingProvider,
} from "@/src/lib/sessions";
import { getReminderCounts } from "@/src/lib/reminders";
import type { StudentStatus } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";

type DashboardPayment = {
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

type DashboardFinanceInvoice = {
  balance_amount: number;
  course_id: string | null;
  created_at: string;
  currency: string;
  id: string;
  status: FinanceInvoiceStatus;
  student_id: string;
  tenant_id: string;
  total_amount: number;
};

export type DashboardPaymentStatusSummary = Record<
  FinancePaymentStatus,
  number
>;

export type DashboardSessionPreview = {
  cohortName: string | null;
  courseTitle: string | null;
  deliveryMode: SessionDeliveryMode;
  id: string;
  meetingProvider: SessionMeetingProvider | null;
  meetingUrl: string | null;
  scheduled_start_at: string;
  status: string;
  title: string;
};

export type DashboardAttendanceSummary = {
  attendancePercent: number | null;
  deliveryModeBreakdown: Record<SessionDeliveryMode, number>;
  lowAttendanceAlerts: number;
  recentSessions: DashboardSessionPreview[];
  todaysSessions: DashboardSessionPreview[];
  totalMarkedAttendance: number;
  upcomingSessions: DashboardSessionPreview[];
};

export type DashboardAssignmentPreview = {
  due_at: string | null;
  id: string;
  status: string;
  title: string;
};

export type DashboardAssignmentSummary = {
  averageScore: number | null;
  overdueAssignments: number;
  pendingReviews: number;
  submissionRate: number | null;
  totalAssignments: number;
  upcomingAssignments: DashboardAssignmentPreview[];
};

export type DashboardConversationPreview = {
  id: string;
  recentMessage: string | null;
  threadType: AcademyChatThreadType;
  title: string;
  updatedAt: string;
};

export type DashboardConversationSummary = {
  recentThreads: DashboardConversationPreview[];
  totalThreads: number;
  unreadThreads: number;
};

export type DashboardMetrics = {
  activeCourses: number;
  activeAutomations: number;
  assignments: DashboardAssignmentSummary;
  attendance: DashboardAttendanceSummary;
  conversations: DashboardConversationSummary;
  courseRevenue: DashboardCourseRevenue[];
  delegatedPermissions: number;
  paymentStatusSummary: DashboardPaymentStatusSummary;
  failedAutomationRuns: number;
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
  "id,tenant_id,invoice_id,student_id,payment_date,amount,currency,payment_method,status,created_at";
const financeInvoiceSelect =
  "id,tenant_id,student_id,course_id,total_amount,balance_amount,currency,status,created_at";

const emptyAttendanceSummary: DashboardAttendanceSummary = {
  attendancePercent: null,
  deliveryModeBreakdown: {
    hybrid: 0,
    offline: 0,
    online: 0,
  },
  lowAttendanceAlerts: 0,
  recentSessions: [],
  todaysSessions: [],
  totalMarkedAttendance: 0,
  upcomingSessions: [],
};

const emptyAssignmentSummary: DashboardAssignmentSummary = {
  averageScore: null,
  overdueAssignments: 0,
  pendingReviews: 0,
  submissionRate: null,
  totalAssignments: 0,
  upcomingAssignments: [],
};

const emptyConversationSummary: DashboardConversationSummary = {
  recentThreads: [],
  totalThreads: 0,
  unreadThreads: 0,
};

function isCollectedPayment(payment: DashboardPayment) {
  return payment.status === "recorded" || payment.status === "confirmed";
}

function isOpenInvoice(invoice: DashboardFinanceInvoice) {
  return (
    Number(invoice.balance_amount || 0) > 0 &&
    !["cancelled", "paid", "void"].includes(invoice.status)
  );
}

function sumRecordedRevenue(payments: DashboardPayment[]) {
  return payments
    .filter(isCollectedPayment)
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

function buildPaymentSummary(payments: DashboardPayment[]) {
  return payments.reduce<DashboardPaymentStatusSummary>(
    (summary, payment) => ({
      ...summary,
      [payment.status]: summary[payment.status] + 1,
    }),
    {
      cancelled: 0,
      confirmed: 0,
      failed: 0,
      recorded: 0,
      refunded: 0,
    },
  );
}

function buildCourseRevenue(
  payments: DashboardPayment[],
  invoicesById: Map<string, DashboardFinanceInvoice>,
  coursesById: Map<string, DashboardCourseLookup>,
) {
  const revenueByCourse = new Map<string, DashboardCourseRevenue>();

  payments
    .filter(isCollectedPayment)
    .forEach((payment) => {
      const invoice = payment.invoice_id
        ? invoicesById.get(payment.invoice_id)
        : undefined;
      const courseId = invoice?.course_id ?? "general-finance";
      const current = revenueByCourse.get(courseId) ?? {
        courseId,
        courseTitle:
          (invoice?.course_id
            ? coursesById.get(invoice.course_id)?.title
            : null) ?? "General finance",
        currency: payment.currency || "INR",
        paymentCount: 0,
        revenue: 0,
      };

      revenueByCourse.set(courseId, {
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
    delivery_mode?: SessionDeliveryMode | null;
    id: string;
    meeting_provider?: SessionMeetingProvider | null;
    meeting_url?: string | null;
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
    deliveryMode: session.delivery_mode ?? "offline",
    id: session.id,
    meetingProvider: session.meeting_provider ?? null,
    meetingUrl: session.meeting_url ?? null,
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
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  let scopedSessionIds: string[] | null = null;
  let upcomingQuery = supabase
    .from("sessions")
    .select(
      "id,title,status,scheduled_start_at,course_id,cohort_id,delivery_mode,meeting_provider,meeting_url",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "scheduled")
    .gte("scheduled_start_at", now)
    .order("scheduled_start_at", { ascending: true })
    .limit(3);
  let recentQuery = supabase
    .from("sessions")
    .select(
      "id,title,status,scheduled_start_at,course_id,cohort_id,delivery_mode,meeting_provider,meeting_url",
    )
    .eq("tenant_id", tenantId)
    .order("scheduled_start_at", { ascending: false })
    .limit(3);
  let todayQuery = supabase
    .from("sessions")
    .select(
      "id,title,status,scheduled_start_at,course_id,cohort_id,delivery_mode,meeting_provider,meeting_url",
    )
    .eq("tenant_id", tenantId)
    .gte("scheduled_start_at", todayStart.toISOString())
    .lt("scheduled_start_at", todayEnd.toISOString())
    .order("scheduled_start_at", { ascending: true })
    .limit(5);

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
    todayQuery = todayQuery.or(filters.join(","));

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

  const [upcomingResult, recentResult, todayResult, attendanceResult] = await Promise.all([
    upcomingQuery,
    recentQuery,
    todayQuery,
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

  if (todayResult.error) {
    throw todayResult.error;
  }

  const attendanceRows = (attendanceResult.data ?? []) as { status: string }[];
  const attended = attendanceRows.filter(
    (record) => record.status === "present" || record.status === "late",
  ).length;
  const absent = attendanceRows.filter((record) => record.status === "absent")
    .length;

  const upcomingSessions = (upcomingResult.data ?? []) as {
    cohort_id: string | null;
    course_id: string | null;
    delivery_mode?: SessionDeliveryMode | null;
    id: string;
    meeting_provider?: SessionMeetingProvider | null;
    meeting_url?: string | null;
    scheduled_start_at: string;
    status: string;
    title: string;
  }[];
  const recentSessions = (recentResult.data ?? []) as typeof upcomingSessions;
  const todaysSessions = (todayResult.data ?? []) as typeof upcomingSessions;
  const deliveryModeBreakdown = [...upcomingSessions, ...todaysSessions].reduce<
    Record<SessionDeliveryMode, number>
  >(
    (summary, session) => {
      const mode = session.delivery_mode ?? "offline";
      summary[mode] += 1;
      return summary;
    },
    { hybrid: 0, offline: 0, online: 0 },
  );

  return {
    attendancePercent:
      attendanceRows.length > 0
        ? Math.round((attended / attendanceRows.length) * 100)
        : null,
    deliveryModeBreakdown,
    lowAttendanceAlerts: absent,
    recentSessions: await loadSessionPreviews(recentSessions, tenantId),
    todaysSessions: await loadSessionPreviews(todaysSessions, tenantId),
    totalMarkedAttendance: attendanceRows.length,
    upcomingSessions: await loadSessionPreviews(upcomingSessions, tenantId),
  } satisfies DashboardAttendanceSummary;
}

async function getAssignmentDashboardSummary(
  tenantId: string,
  trainerScope: Awaited<ReturnType<typeof getCurrentTrainerScope>>,
) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  let assignmentIds: string[] | null = null;
  let assignmentsQuery = supabase
    .from("assignments")
    .select("id,title,status,due_at,course_id,cohort_id")
    .eq("tenant_id", tenantId);

  if (trainerScope) {
    const filters: string[] = [];

    if (trainerScope.courseIds.length > 0) {
      filters.push(`course_id.in.(${trainerScope.courseIds.join(",")})`);
    }

    if (trainerScope.cohortIds.length > 0) {
      filters.push(`cohort_id.in.(${trainerScope.cohortIds.join(",")})`);
    }

    if (filters.length === 0) {
      return emptyAssignmentSummary;
    }

    assignmentsQuery = assignmentsQuery.or(filters.join(","));
  }

  const assignmentsResult = await assignmentsQuery.order("due_at", {
    ascending: true,
    nullsFirst: false,
  });

  if (assignmentsResult.error) {
    const message = assignmentsResult.error.message?.toLowerCase() ?? "";

    if (
      assignmentsResult.error.code === "42P01" ||
      assignmentsResult.error.code === "PGRST205" ||
      message.includes("schema cache") ||
      message.includes("does not exist")
    ) {
      return emptyAssignmentSummary;
    }

    throw assignmentsResult.error;
  }

  const assignments = (assignmentsResult.data ?? []) as {
    due_at: string | null;
    id: string;
    status: string;
    title: string;
  }[];
  assignmentIds = assignments.map((assignment) => assignment.id);

  if (assignmentIds.length === 0) {
    return emptyAssignmentSummary;
  }

  const submissionsResult = await supabase
    .from("assignment_submissions")
    .select("assignment_id,status,score")
    .eq("tenant_id", tenantId)
    .in("assignment_id", assignmentIds);

  if (submissionsResult.error) {
    throw submissionsResult.error;
  }

  const submissions = (submissionsResult.data ?? []) as {
    score: number | null;
    status: string;
  }[];
  const submitted = submissions.filter((submission) =>
    ["late", "reviewed", "submitted"].includes(submission.status),
  ).length;
  const scores = submissions
    .map((submission) => submission.score)
    .filter((score): score is number => score !== null);

  return {
    averageScore:
      scores.length > 0
        ? Math.round(
            (scores.reduce((total, score) => total + Number(score || 0), 0) /
              scores.length) *
              10,
          ) / 10
        : null,
    overdueAssignments: assignments.filter(
      (assignment) =>
        assignment.status === "published" &&
        assignment.due_at &&
        assignment.due_at < now,
    ).length,
    pendingReviews: submissions.filter((submission) =>
      ["late", "submitted"].includes(submission.status),
    ).length,
    submissionRate:
      submissions.length > 0 ? Math.round((submitted / submissions.length) * 100) : null,
    totalAssignments: assignments.length,
    upcomingAssignments: assignments
      .filter(
        (assignment) =>
          assignment.status === "published" &&
          (!assignment.due_at || assignment.due_at >= now),
      )
      .slice(0, 3)
      .map((assignment) => ({
        due_at: assignment.due_at,
        id: assignment.id,
        status: assignment.status,
        title: assignment.title,
      })),
  } satisfies DashboardAssignmentSummary;
}

async function getConversationDashboardSummary(tenantId: string) {
  try {
    const threads = await getTeamChatThreads(tenantId);

    return {
      recentThreads: threads.slice(0, 4).map((thread) => ({
        id: thread.id,
        recentMessage: thread.recent_message ?? null,
        threadType: thread.thread_type,
        title: thread.title ?? "Conversation",
        updatedAt: thread.updated_at,
      })),
      totalThreads: threads.length,
      // Unread counts require a dedicated safe RPC. Avoid legacy direct
      // participant/message reads because their RLS currently recurses.
      unreadThreads: 0,
    } satisfies DashboardConversationSummary;
  } catch {
    return emptyConversationSummary;
  }
}

export async function getDashboardMetrics(
  tenantId: string,
): Promise<DashboardMetrics> {
  const supabase = getSupabaseClient();
  const trainerScope = await getCurrentTrainerScope(tenantId);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentRole = user
    ? await getMemberRoleForTenant(tenantId, user.id)
    : null;
  const canReadFinance = currentRole === "owner" || currentRole === "admin";

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

    const [attendance, assignments, conversations] = await Promise.all([
      getAttendanceDashboardSummary(tenantId, trainerScope),
      getAssignmentDashboardSummary(tenantId, trainerScope),
      getConversationDashboardSummary(tenantId),
    ]);

    return {
      activeAutomations: 0,
      activeCourses: activeCourses > 0 ? activeCourses : courses.length,
      assignments,
      attendance,
      conversations,
      courseRevenue: [],
      delegatedPermissions: 0,
      paymentStatusSummary: {
        cancelled: 0,
        confirmed: 0,
        failed: 0,
        recorded: 0,
        refunded: 0,
      },
      failedAutomationRuns: 0,
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
    financePaymentsResult,
    financeInvoicesResult,
    recentStudentsResult,
    reminderCounts,
    automationCounts,
    attendance,
    assignments,
    conversations,
    delegatedPermissionCounts,
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
    canReadFinance
      ? supabase
          .from("finance_payments")
          .select(paymentSelect)
          .eq("tenant_id", tenantId)
          .order("payment_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    canReadFinance
      ? supabase
          .from("finance_invoices")
          .select(financeInvoiceSelect)
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("students")
      .select("id,full_name,email,phone,status,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(5),
    getReminderCounts(tenantId),
    getAutomationRuleCounts(tenantId),
    getAttendanceDashboardSummary(tenantId, null),
    getAssignmentDashboardSummary(tenantId, null),
    getConversationDashboardSummary(tenantId),
    getDelegatedPermissionCounts(tenantId),
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

  if (financePaymentsResult.error) {
    throw financePaymentsResult.error;
  }

  if (financeInvoicesResult.error) {
    throw financeInvoicesResult.error;
  }

  if (recentStudentsResult.error) {
    throw recentStudentsResult.error;
  }

  const payments = (financePaymentsResult.data ?? []) as DashboardPayment[];
  const invoices = (financeInvoicesResult.data ?? []) as DashboardFinanceInvoice[];
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const courseIds = Array.from(
    new Set(invoices.map((invoice) => invoice.course_id).filter(Boolean)),
  ) as string[];
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
    assignments,
    attendance,
    conversations,
    courseRevenue: buildCourseRevenue(payments, invoicesById, coursesById),
    delegatedPermissions: delegatedPermissionCounts.active,
    paymentStatusSummary: buildPaymentSummary(payments),
    failedAutomationRuns: automationCounts.failedRuns,
    pendingPayments: invoices.filter(isOpenInvoice).length,
    pendingRemindersDue: reminderCounts.pendingDueTodayOrOverdue,
    recentPayments: payments.slice(0, 5).map((payment) => {
      const invoice = payment.invoice_id
        ? invoicesById.get(payment.invoice_id)
        : undefined;

      return {
        ...payment,
        courseTitle:
          (invoice?.course_id
            ? coursesById.get(invoice.course_id)?.title
            : null) ?? "General finance",
        studentName:
          studentsById.get(payment.student_id)?.full_name ??
          "Student unavailable",
      };
    }),
    recentStudents: (recentStudentsResult.data ??
      []) as DashboardRecentStudent[],
    totalEnrollments: enrollmentsCountResult.count ?? 0,
    totalRevenue: sumRecordedRevenue(payments),
    totalStudents: studentsCountResult.count ?? 0,
  };
}
