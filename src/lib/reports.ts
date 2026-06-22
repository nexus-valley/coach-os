import { logActivity } from "@/src/lib/auditLogger";
import {
  average,
  countBy,
  getStartDateForRange,
  safePercent,
  sumBy,
} from "@/src/lib/analytics";
import {
  canAccessPayments,
  getMemberRoleForTenant,
  hasEffectivePermission,
  type MemberRole,
} from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentTrainerScope } from "@/src/lib/trainerAssignments";

export type ReportsDateRange =
  | "all_time"
  | "last_30_days"
  | "last_7_days"
  | "this_month";

export type ReportCategory =
  | "assignments"
  | "attendance"
  | "communication"
  | "courses"
  | "overview"
  | "payments"
  | "students"
  | "trainers";

export type ReportFilters = {
  cohortId?: string;
  courseId?: string;
  dateRange: ReportsDateRange;
  status?: string;
  trainerUserId?: string;
};

export type ReportOption = {
  id: string;
  label: string;
};

type StudentRow = {
  created_at: string;
  email: string | null;
  full_name: string;
  id: string;
  phone: string | null;
  status: string;
};

type CourseRow = {
  created_at: string;
  id: string;
  status: string;
  title: string;
};

type CohortRow = {
  course_id: string | null;
  end_date: string | null;
  id: string;
  name: string;
  start_date: string | null;
};

type EnrollmentRow = {
  completed_at: string | null;
  course_id: string;
  created_at: string;
  id: string;
  status: string;
  student_id: string;
};

type PaymentRow = {
  amount: number;
  course_id: string | null;
  created_at: string;
  currency: string;
  id: string;
  paid_at: string | null;
  receipt_generated_at: string | null;
  status: string;
  student_id: string;
};

type PaymentLinkRow = {
  amount: number;
  course_id: string | null;
  created_at: string;
  id: string;
  status: string;
  student_id: string;
};

type SessionRow = {
  cohort_id: string | null;
  course_id: string | null;
  created_at: string;
  id: string;
  scheduled_start_at: string;
  status: string;
  title: string;
  trainer_user_id: string | null;
};

type AttendanceRow = {
  id: string;
  marked_at: string | null;
  session_id: string;
  status: string;
  student_id: string;
};

type AssignmentRow = {
  cohort_id: string | null;
  course_id: string | null;
  created_at: string;
  due_at: string | null;
  id: string;
  status: string;
  title: string;
  trainer_user_id: string | null;
};

type SubmissionRow = {
  assignment_id: string;
  created_at: string;
  id: string;
  reviewed_by: string | null;
  score: number | null;
  status: string;
  student_id: string;
  submitted_at: string | null;
};

type TenantMemberRow = {
  role: MemberRole;
  user_id: string;
};

type NotificationRow = {
  created_at: string;
  id: string;
  severity: string;
  status: string;
  type: string;
  user_id: string;
};

type ThreadRow = {
  cohort_id: string | null;
  course_id: string | null;
  created_at: string;
  id: string;
  status: string;
  thread_type: string;
  title: string | null;
};

export type ReportMetric = {
  helper: string;
  label: string;
  tone: "blue" | "cyan" | "emerald" | "orange" | "rose" | "slate";
  value: string;
};

export type ReportTableRow = {
  cells: string[];
  id: string;
};

export type ReportSection = {
  description: string;
  headers: string[];
  key: ReportCategory;
  metrics: ReportMetric[];
  rows: ReportTableRow[];
  title: string;
};

export type ReportsData = {
  canExport: boolean;
  canViewFinancials: boolean;
  filters: {
    cohorts: ReportOption[];
    courses: ReportOption[];
    statuses: ReportOption[];
    trainers: ReportOption[];
  };
  generatedAt: string;
  role: MemberRole;
  sections: Record<ReportCategory, ReportSection>;
  scopeLabel: string;
};

export type CourseRevenueReportRow = {
  completedPaymentCount: number;
  courseId: string;
  courseTitle: string;
  revenueAmount: number;
};

type RawData = {
  assignments: AssignmentRow[];
  attendance: AttendanceRow[];
  cohorts: CohortRow[];
  courses: CourseRow[];
  enrollments: EnrollmentRow[];
  members: TenantMemberRow[];
  notifications: NotificationRow[];
  paymentLinks: PaymentLinkRow[];
  payments: PaymentRow[];
  sessions: SessionRow[];
  students: StudentRow[];
  submissions: SubmissionRow[];
  threads: ThreadRow[];
};

const emptyRawData: RawData = {
  assignments: [],
  attendance: [],
  cohorts: [],
  courses: [],
  enrollments: [],
  members: [],
  notifications: [],
  paymentLinks: [],
  payments: [],
  sessions: [],
  students: [],
  submissions: [],
  threads: [],
};

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

async function getCurrentUserAndRole(tenantId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in to view reports.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (!role) {
    throw new Error("You do not have access to this workspace.");
  }

  return { role, user };
}

async function fetchRows<T>(
  table: string,
  select: string,
  tenantId: string,
  rangeStart: string | null,
  dateColumn = "created_at",
) {
  const supabase = getSupabaseClient();
  let query = supabase.from(table).select(select).eq("tenant_id", tenantId);

  if (rangeStart) {
    query = query.gte(dateColumn, rangeStart);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return (data ?? []) as T[];
}

function optionFromCourse(course: CourseRow): ReportOption {
  return { id: course.id, label: course.title };
}

function optionFromCohort(cohort: CohortRow): ReportOption {
  return { id: cohort.id, label: cohort.name };
}

function formatCurrency(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "N/A" : `${value}%`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function normalizeStatus(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function applyReportFilters(raw: RawData, filters: ReportFilters, canViewFinancials: boolean) {
  const courseIds = new Set(raw.courses.map((course) => course.id));
  const cohortIds = new Set(raw.cohorts.map((cohort) => cohort.id));
  let students = raw.students;
  let enrollments = raw.enrollments.filter((enrollment) =>
    courseIds.has(enrollment.course_id),
  );
  let sessions = raw.sessions.filter(
    (session) =>
      (!session.course_id || courseIds.has(session.course_id)) &&
      (!session.cohort_id || cohortIds.has(session.cohort_id)),
  );
  let assignments = raw.assignments.filter(
    (assignment) =>
      (!assignment.course_id || courseIds.has(assignment.course_id)) &&
      (!assignment.cohort_id || cohortIds.has(assignment.cohort_id)),
  );

  if (filters.courseId) {
    enrollments = enrollments.filter(
      (enrollment) => enrollment.course_id === filters.courseId,
    );
    sessions = sessions.filter((session) => session.course_id === filters.courseId);
    assignments = assignments.filter(
      (assignment) => assignment.course_id === filters.courseId,
    );
  }

  if (filters.cohortId) {
    sessions = sessions.filter((session) => session.cohort_id === filters.cohortId);
    assignments = assignments.filter(
      (assignment) => assignment.cohort_id === filters.cohortId,
    );
  }

  if (filters.trainerUserId) {
    sessions = sessions.filter(
      (session) => session.trainer_user_id === filters.trainerUserId,
    );
    assignments = assignments.filter(
      (assignment) => assignment.trainer_user_id === filters.trainerUserId,
    );
  }

  if (filters.status) {
    students = students.filter((student) => student.status === filters.status);
    sessions = sessions.filter((session) => session.status === filters.status);
    assignments = assignments.filter(
      (assignment) => assignment.status === filters.status,
    );
  }

  const studentIds = new Set([
    ...students.map((student) => student.id),
    ...enrollments.map((enrollment) => enrollment.student_id),
  ]);
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
  const sessionIds = new Set(sessions.map((session) => session.id));

  return {
    ...raw,
    assignments,
    attendance: raw.attendance.filter(
      (record) => studentIds.has(record.student_id) && sessionIds.has(record.session_id),
    ),
    enrollments,
    paymentLinks: canViewFinancials
      ? raw.paymentLinks.filter((link) => studentIds.has(link.student_id))
      : [],
    payments: canViewFinancials
      ? raw.payments.filter((payment) => studentIds.has(payment.student_id))
      : [],
    sessions,
    students,
    submissions: raw.submissions.filter(
      (submission) =>
        studentIds.has(submission.student_id) &&
        assignmentIds.has(submission.assignment_id),
    ),
    threads: raw.threads.filter(
      (thread) =>
        thread.thread_type === "announcement" ||
        (thread.course_id ? courseIds.has(thread.course_id) : true) ||
        (thread.cohort_id ? cohortIds.has(thread.cohort_id) : true),
    ),
  } satisfies RawData;
}

function getScopedStudentIds(raw: RawData) {
  return Array.from(
    new Set([
      ...raw.enrollments.map((enrollment) => enrollment.student_id),
      ...raw.students.map((student) => student.id),
    ]),
  );
}

async function getRawReportData(
  tenantId: string,
  filters: ReportFilters,
  role: MemberRole,
  canViewFinancials: boolean,
) {
  const rangeStart = getStartDateForRange(filters.dateRange);
  const [
    students,
    courses,
    cohorts,
    enrollments,
    payments,
    paymentLinks,
    sessions,
    attendance,
    assignments,
    submissions,
    members,
    notifications,
    threads,
  ] = await Promise.all([
    fetchRows<StudentRow>(
      "students",
      "id,full_name,email,phone,status,created_at",
      tenantId,
      rangeStart,
    ),
    fetchRows<CourseRow>(
      "courses",
      "id,title,status,created_at",
      tenantId,
      null,
    ),
    fetchRows<CohortRow>(
      "cohorts",
      "id,name,course_id,start_date,end_date",
      tenantId,
      null,
    ),
    fetchRows<EnrollmentRow>(
      "enrollments",
      "id,student_id,course_id,status,completed_at,created_at",
      tenantId,
      rangeStart,
    ),
    canViewFinancials
      ? fetchRows<PaymentRow>(
          "payments",
          "id,student_id,course_id,amount,currency,status,paid_at,receipt_generated_at,created_at",
          tenantId,
          rangeStart,
        )
      : Promise.resolve([]),
    canViewFinancials
      ? fetchRows<PaymentLinkRow>(
          "payment_links",
          "id,student_id,course_id,amount,status,created_at",
          tenantId,
          rangeStart,
        )
      : Promise.resolve([]),
    fetchRows<SessionRow>(
      "sessions",
      "id,title,course_id,cohort_id,trainer_user_id,status,scheduled_start_at,created_at",
      tenantId,
      rangeStart,
      "scheduled_start_at",
    ),
    fetchRows<AttendanceRow>(
      "attendance_records",
      "id,session_id,student_id,status,marked_at",
      tenantId,
      rangeStart,
      "marked_at",
    ),
    fetchRows<AssignmentRow>(
      "assignments",
      "id,title,course_id,cohort_id,trainer_user_id,status,due_at,created_at",
      tenantId,
      rangeStart,
    ),
    fetchRows<SubmissionRow>(
      "assignment_submissions",
      "id,assignment_id,student_id,status,score,submitted_at,reviewed_by,created_at",
      tenantId,
      rangeStart,
    ),
    fetchRows<TenantMemberRow>("tenant_members", "user_id,role", tenantId, null),
    fetchRows<NotificationRow>(
      "notifications",
      "id,user_id,type,severity,status,created_at",
      tenantId,
      rangeStart,
    ),
    fetchRows<ThreadRow>(
      "conversation_threads",
      "id,title,thread_type,status,course_id,cohort_id,created_at",
      tenantId,
      rangeStart,
    ),
  ]);

  let raw = {
    assignments,
    attendance,
    cohorts,
    courses,
    enrollments,
    members,
    notifications,
    paymentLinks,
    payments,
    sessions,
    students,
    submissions,
    threads,
  } satisfies RawData;

  if (role === "trainer") {
    const trainerScope = await getCurrentTrainerScope(tenantId);

    if (!trainerScope) {
      return emptyRawData;
    }

    const scopedCourseIds = new Set(trainerScope.courseIds);
    const scopedCohortIds = new Set(trainerScope.cohortIds);
    const scopedStudents = new Set(getScopedStudentIds(raw));

    raw = {
      ...raw,
      assignments: raw.assignments.filter(
        (assignment) =>
          (assignment.course_id && scopedCourseIds.has(assignment.course_id)) ||
          (assignment.cohort_id && scopedCohortIds.has(assignment.cohort_id)),
      ),
      cohorts: raw.cohorts.filter((cohort) => scopedCohortIds.has(cohort.id)),
      courses: raw.courses.filter((course) => scopedCourseIds.has(course.id)),
      enrollments: raw.enrollments.filter((enrollment) =>
        scopedCourseIds.has(enrollment.course_id),
      ),
      sessions: raw.sessions.filter(
        (session) =>
          session.trainer_user_id === trainerScope.userId ||
          Boolean(session.course_id && scopedCourseIds.has(session.course_id)) ||
          Boolean(session.cohort_id && scopedCohortIds.has(session.cohort_id)),
      ),
      students: raw.students.filter((student) => scopedStudents.has(student.id)),
      threads: raw.threads.filter(
        (thread) =>
          thread.thread_type === "announcement" ||
          Boolean(thread.course_id && scopedCourseIds.has(thread.course_id)) ||
          Boolean(thread.cohort_id && scopedCohortIds.has(thread.cohort_id)),
      ),
    };
  }

  return applyReportFilters(raw, filters, canViewFinancials);
}

function buildMetric(
  label: string,
  value: string | number,
  helper: string,
  tone: ReportMetric["tone"] = "blue",
) {
  return {
    helper,
    label,
    tone,
    value: String(value),
  } satisfies ReportMetric;
}

function buildStudentSection(data: RawData): ReportSection {
  const active = data.students.filter((student) => student.status === "active").length;
  const inactive = data.students.filter(
    (student) => student.status === "inactive" || student.status === "blocked",
  ).length;
  const presentOrExcused = data.attendance.filter((record) =>
    ["excused", "present"].includes(record.status),
  ).length;
  const attendanceRate = safePercent(presentOrExcused, data.attendance.length);
  const lowAttendanceStudentIds = new Set(
    data.attendance
      .filter((record) => ["absent", "late"].includes(record.status))
      .map((record) => record.student_id),
  );
  const pendingSubmissionStudentIds = new Set(
    data.submissions
      .filter((submission) => ["late", "pending", "submitted"].includes(submission.status))
      .map((submission) => submission.student_id),
  );
  const pendingPaymentStudentIds = new Set(
    data.paymentLinks
      .filter((link) => ["created", "sent"].includes(link.status))
      .map((link) => link.student_id),
  );

  return {
    description: "Student status, attendance risk, assignment backlog, and payment exposure.",
    headers: ["Student", "Status", "Attendance flags", "Pending assignments", "Payment due"],
    key: "students",
    metrics: [
      buildMetric("Total students", data.students.length, "Visible students in scope"),
      buildMetric("Active", active, "Students marked active", "emerald"),
      buildMetric("Inactive/blocked", inactive, "Inactive or blocked students", "orange"),
      buildMetric("Overall attendance", formatPercent(attendanceRate), "Present or excused records", "cyan"),
    ],
    rows: data.students.slice(0, 12).map((student) => ({
      cells: [
        student.full_name,
        normalizeStatus(student.status),
        lowAttendanceStudentIds.has(student.id) ? "Absent/late flags" : "No major flags",
        pendingSubmissionStudentIds.has(student.id) ? "Pending" : "Clear",
        pendingPaymentStudentIds.has(student.id) ? "Pending" : "Clear",
      ],
      id: student.id,
    })),
    title: "Student report",
  };
}

function buildAttendanceSection(data: RawData): ReportSection {
  const present = data.attendance.filter((record) => record.status === "present").length;
  const absent = data.attendance.filter((record) => record.status === "absent").length;
  const late = data.attendance.filter((record) => record.status === "late").length;
  const excused = data.attendance.filter((record) => record.status === "excused").length;
  const attendanceRate = safePercent(present + excused, data.attendance.length);
  const recordsByStudent = countBy(data.attendance, (record) => record.student_id);
  const studentById = new Map(data.students.map((student) => [student.id, student]));

  return {
    description: "Attendance percentage, absent/late volume, and student-wise signal.",
    headers: ["Student", "Records", "Absent", "Late", "Attendance health"],
    key: "attendance",
    metrics: [
      buildMetric("Attendance rate", formatPercent(attendanceRate), "Present plus excused over all records", "emerald"),
      buildMetric("Present", present, "Marked present"),
      buildMetric("Absent", absent, "Marked absent", "rose"),
      buildMetric("Late", late, "Marked late", "orange"),
      buildMetric("Excused", excused, "Marked excused", "slate"),
    ],
    rows: Array.from(recordsByStudent.entries()).slice(0, 12).map(([studentId, total]) => {
      const studentRecords = data.attendance.filter(
        (record) => record.student_id === studentId,
      );
      const studentAbsent = studentRecords.filter(
        (record) => record.status === "absent",
      ).length;
      const studentLate = studentRecords.filter((record) => record.status === "late").length;
      const studentRate = safePercent(
        studentRecords.filter((record) => ["excused", "present"].includes(record.status)).length,
        total,
      );

      return {
        cells: [
          studentById.get(studentId)?.full_name ?? "Student unavailable",
          String(total),
          String(studentAbsent),
          String(studentLate),
          formatPercent(studentRate),
        ],
        id: studentId,
      };
    }),
    title: "Attendance report",
  };
}

function buildAssignmentSection(data: RawData): ReportSection {
  const reviewed = data.submissions.filter((submission) => submission.status === "reviewed");
  const late = data.submissions.filter((submission) => submission.status === "late").length;
  const pending = data.assignments.length * Math.max(data.students.length, 1) - data.submissions.length;
  const submissionRate = safePercent(data.submissions.length, data.assignments.length * Math.max(data.students.length, 1));
  const scores = reviewed.map((submission) => submission.score);
  const assignmentById = new Map(data.assignments.map((assignment) => [assignment.id, assignment]));

  return {
    description: "Assignment throughput, review backlog, late work, and score averages.",
    headers: ["Assignment", "Status", "Due", "Submissions", "Reviewed"],
    key: "assignments",
    metrics: [
      buildMetric("Assignments", data.assignments.length, "Assignments in selected scope"),
      buildMetric("Submission rate", formatPercent(submissionRate), "Submitted rows over expected submissions", "cyan"),
      buildMetric("Pending submissions", Math.max(pending, 0), "Estimated pending submissions", "orange"),
      buildMetric("Reviewed", reviewed.length, "Reviewed submissions", "emerald"),
      buildMetric("Late", late, "Late submissions", "rose"),
      buildMetric("Avg score", average(scores) ?? "N/A", "Reviewed scores only"),
    ],
    rows: data.assignments.slice(0, 12).map((assignment) => {
      const submissions = data.submissions.filter(
        (submission) => submission.assignment_id === assignment.id,
      );
      const reviewedCount = submissions.filter(
        (submission) => submission.status === "reviewed",
      ).length;

      return {
        cells: [
          assignmentById.get(assignment.id)?.title ?? assignment.title,
          normalizeStatus(assignment.status),
          formatDate(assignment.due_at),
          String(submissions.length),
          String(reviewedCount),
        ],
        id: assignment.id,
      };
    }),
    title: "Assignment report",
  };
}

function buildCourseSection(data: RawData): ReportSection {
  const activeCourses = data.courses.filter((course) => course.status === "published").length;
  const activeCohorts = data.cohorts.filter(
    (cohort) =>
      !cohort.end_date || new Date(cohort.end_date).getTime() >= Date.now(),
  ).length;
  const completedSessions = data.sessions.filter(
    (session) => session.status === "completed",
  ).length;
  const upcomingSessions = data.sessions.filter(
    (session) =>
      session.status === "scheduled" &&
      new Date(session.scheduled_start_at).getTime() >= Date.now(),
  ).length;
  const enrollmentsByCourse = countBy(data.enrollments, (enrollment) => enrollment.course_id);

  return {
    description: "Course, cohort, enrollment, and session operations.",
    headers: ["Course", "Status", "Enrollments", "Completed sessions", "Upcoming sessions"],
    key: "courses",
    metrics: [
      buildMetric("Active courses", activeCourses, "Published courses", "emerald"),
      buildMetric("Active cohorts", activeCohorts, "Cohorts without an ended date", "cyan"),
      buildMetric("Completed sessions", completedSessions, "Completed classes"),
      buildMetric("Upcoming sessions", upcomingSessions, "Scheduled future sessions", "orange"),
    ],
    rows: data.courses.slice(0, 12).map((course) => ({
      cells: [
        course.title,
        normalizeStatus(course.status),
        String(enrollmentsByCourse.get(course.id) ?? 0),
        String(data.sessions.filter((session) => session.course_id === course.id && session.status === "completed").length),
        String(data.sessions.filter((session) => session.course_id === course.id && session.status === "scheduled").length),
      ],
      id: course.id,
    })),
    title: "Course and cohort report",
  };
}

function buildPaymentSection(data: RawData, canViewFinancials: boolean): ReportSection {
  if (!canViewFinancials) {
    return {
      description: "Payment analytics are hidden for this role.",
      headers: ["Scope", "Status", "Notes"],
      key: "payments",
      metrics: [
        buildMetric("Financial access", "Restricted", "Trainer reports exclude billing data", "slate"),
      ],
      rows: [{ cells: ["Payments", "Restricted", "Owner/admin/staff only"], id: "restricted" }],
      title: "Payment report",
    };
  }

  const completed = data.payments.filter((payment) => payment.status === "completed");
  const pendingLinks = data.paymentLinks.filter((link) =>
    ["created", "sent"].includes(link.status),
  );
  const paidReceipts = data.payments.filter((payment) => payment.receipt_generated_at);

  return {
    description: "Collected revenue, pending payment links, and receipt volume.",
    headers: ["Student", "Status", "Amount", "Course", "Date"],
    key: "payments",
    metrics: [
      buildMetric("Collected", formatCurrency(sumBy(completed, (payment) => payment.amount), completed[0]?.currency ?? "INR"), "Completed payments", "emerald"),
      buildMetric("Pending amount", formatCurrency(sumBy(pendingLinks, (link) => link.amount)), "Created or sent payment links", "orange"),
      buildMetric("Paid receipts", paidReceipts.length, "Payments with generated receipts", "cyan"),
      buildMetric("Unpaid links", pendingLinks.length, "Open payment links", "rose"),
    ],
    rows: data.payments.slice(0, 12).map((payment) => ({
      cells: [
        data.students.find((student) => student.id === payment.student_id)?.full_name ?? "Student unavailable",
        normalizeStatus(payment.status),
        formatCurrency(payment.amount, payment.currency || "INR"),
        data.courses.find((course) => course.id === payment.course_id)?.title ?? "Unassigned",
        formatDate(payment.paid_at ?? payment.created_at),
      ],
      id: payment.id,
    })),
    title: "Payment report",
  };
}

function buildTrainerSection(data: RawData): ReportSection {
  const trainers = data.members.filter((member) => member.role === "trainer");

  return {
    description: "Trainer load across sessions, attendance, assignments, and scoped students.",
    headers: ["Trainer", "Sessions", "Assignments", "Reviews", "Student load"],
    key: "trainers",
    metrics: [
      buildMetric("Trainers", trainers.length, "Trainer users in workspace"),
      buildMetric("Sessions handled", data.sessions.length, "Visible sessions"),
      buildMetric("Attendance records", data.attendance.length, "Marked attendance records", "cyan"),
      buildMetric("Reviews", data.submissions.filter((submission) => submission.reviewed_by).length, "Reviewed submissions", "emerald"),
    ],
    rows: trainers.slice(0, 12).map((trainer) => ({
      cells: [
        trainer.user_id,
        String(data.sessions.filter((session) => session.trainer_user_id === trainer.user_id).length),
        String(data.assignments.filter((assignment) => assignment.trainer_user_id === trainer.user_id).length),
        String(data.submissions.filter((submission) => submission.reviewed_by === trainer.user_id).length),
        String(data.students.length),
      ],
      id: trainer.user_id,
    })),
    title: "Trainer report",
  };
}

function buildCommunicationSection(data: RawData): ReportSection {
  const unread = data.notifications.filter(
    (notification) => notification.status === "unread",
  ).length;
  const critical = data.notifications.filter(
    (notification) => notification.severity === "critical",
  ).length;
  const announcements = data.threads.filter(
    (thread) => thread.thread_type === "announcement",
  );

  return {
    description: "Notifications, unread volume, active threads, and announcements.",
    headers: ["Thread", "Type", "Status", "Created"],
    key: "communication",
    metrics: [
      buildMetric("Notifications sent", data.notifications.length, "Notifications in selected range", "cyan"),
      buildMetric("Unread", unread, "Unread notifications", "orange"),
      buildMetric("Critical", critical, "Critical notifications", "rose"),
      buildMetric("Active threads", data.threads.filter((thread) => thread.status === "active").length, "Open message threads", "emerald"),
      buildMetric("Announcements", announcements.length, "Announcement threads"),
    ],
    rows: data.threads.slice(0, 12).map((thread) => ({
      cells: [
        thread.title ?? "Untitled thread",
        normalizeStatus(thread.thread_type),
        normalizeStatus(thread.status),
        formatDate(thread.created_at),
      ],
      id: thread.id,
    })),
    title: "Communication report",
  };
}

function buildOverviewSection(data: RawData, canViewFinancials: boolean): ReportSection {
  const present = data.attendance.filter((record) =>
    ["excused", "present"].includes(record.status),
  ).length;
  const attendanceRate = safePercent(present, data.attendance.length);
  const reviewedScores = data.submissions
    .filter((submission) => submission.status === "reviewed")
    .map((submission) => submission.score);

  return {
    description: "Cross-functional health snapshot for the selected report filters.",
    headers: ["Area", "Signal", "Value"],
    key: "overview",
    metrics: [
      buildMetric("Students", data.students.length, "Visible students"),
      buildMetric("Attendance", formatPercent(attendanceRate), "Present or excused records", "emerald"),
      buildMetric("Assignments", data.assignments.length, "Assignments in scope", "cyan"),
      buildMetric("Average score", average(reviewedScores) ?? "N/A", "Reviewed submissions"),
      buildMetric("Revenue", canViewFinancials ? formatCurrency(sumBy(data.payments.filter((payment) => payment.status === "completed"), (payment) => payment.amount), data.payments[0]?.currency ?? "INR") : "Restricted", "Completed payments", canViewFinancials ? "emerald" : "slate"),
    ],
    rows: [
      { cells: ["Students", "Active", String(data.students.filter((student) => student.status === "active").length)], id: "students" },
      { cells: ["Courses", "Published", String(data.courses.filter((course) => course.status === "published").length)], id: "courses" },
      { cells: ["Sessions", "Upcoming", String(data.sessions.filter((session) => session.status === "scheduled").length)], id: "sessions" },
      { cells: ["Communication", "Unread notifications", String(data.notifications.filter((notification) => notification.status === "unread").length)], id: "communication" },
    ],
    title: "Executive overview",
  };
}

function buildReportSections(data: RawData, canViewFinancials: boolean) {
  return {
    assignments: buildAssignmentSection(data),
    attendance: buildAttendanceSection(data),
    communication: buildCommunicationSection(data),
    courses: buildCourseSection(data),
    overview: buildOverviewSection(data, canViewFinancials),
    payments: buildPaymentSection(data, canViewFinancials),
    students: buildStudentSection(data),
    trainers: buildTrainerSection(data),
  } satisfies Record<ReportCategory, ReportSection>;
}

export async function getReportsData(tenantId: string, filters: ReportFilters) {
  const { role, user } = await getCurrentUserAndRole(tenantId);
  const hasWorkspacePaymentAccess = await hasEffectivePermission({
    action: "view_payment_report",
    entityId: tenantId,
    entityType: "tenant",
    logUsage: true,
    permission: "view_payments",
    scopeId: null,
    scopeType: "workspace",
    tenantId,
    userId: user.id,
  });
  const canViewFinancials =
    (role !== "trainer" && canAccessPayments(role)) || hasWorkspacePaymentAccess;
  const raw = await getRawReportData(tenantId, filters, role, canViewFinancials);
  const sections = buildReportSections(raw, canViewFinancials);

  await logActivity({
    action: "report_viewed",
    description: "Viewed reports and analytics center.",
    entityName: "Reports center",
    entityType: "report",
    metadata: {
      cohortId: filters.cohortId ?? null,
      courseId: filters.courseId ?? null,
      dateRange: filters.dateRange,
      role,
      status: filters.status ?? null,
      trainerUserId: filters.trainerUserId ?? null,
    },
    tenantId,
  });

  return {
    canExport: role === "owner" || role === "admin" || role === "staff",
    canViewFinancials,
    filters: {
      cohorts: raw.cohorts.map(optionFromCohort),
      courses: raw.courses.map(optionFromCourse),
      statuses: [
        { id: "active", label: "Active" },
        { id: "published", label: "Published" },
        { id: "scheduled", label: "Scheduled" },
        { id: "completed", label: "Completed" },
        { id: "pending", label: "Pending" },
      ],
      trainers: raw.members
        .filter((member) => member.role === "trainer")
        .map((member) => ({ id: member.user_id, label: member.user_id })),
    },
    generatedAt: new Date().toISOString(),
    role,
    scopeLabel:
      role === "trainer"
        ? "Trainer scoped"
        : role === "staff"
          ? "Operational workspace scope"
          : "Full workspace scope",
    sections,
  } satisfies ReportsData;
}

function escapeCsvCell(value: string | number | null | undefined) {
  const raw = value === null || typeof value === "undefined" ? "" : String(value);

  return `"${raw.replace(/"/g, '""')}"`;
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

export async function exportReportSectionCsv(
  tenantId: string,
  section: ReportSection,
) {
  downloadCsv(
    `${section.key}-report.csv`,
    section.headers,
    section.rows.map((row) => row.cells),
  );

  await logActivity({
    action: "report_exported",
    description: `Exported ${section.title}.`,
    entityName: section.title,
    entityType: "report",
    metadata: {
      reportKey: section.key,
      rowCount: section.rows.length,
    },
    tenantId,
  });
}

export function exportPaymentsCsv(data: { cells: string[] }[]) {
  downloadCsv(
    "payments-report.csv",
    ["Student", "Status", "Amount", "Course", "Date"],
    data.map((row) => row.cells),
  );
}

export function exportStudentsCsv(data: { cells: string[] }[]) {
  downloadCsv(
    "students-report.csv",
    ["Student", "Status", "Attendance flags", "Pending assignments", "Payment due"],
    data.map((row) => row.cells),
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
