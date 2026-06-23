import type {
  Course,
  CourseSection,
  Lesson,
} from "@/src/lib/courses";
import { syncEnrollmentCompletion } from "@/src/lib/certificates";
import {
  getCohortsForStudent,
  type CohortWithCourse,
  type StudentCohortMembership,
} from "@/src/lib/cohorts";
import type { Enrollment, EnrollmentStatus } from "@/src/lib/enrollments";
import { logActivity } from "@/src/lib/auditLogger";
import {
  canAccessAttendance,
  canAccessPayments,
  canManageStudents,
  getMemberRoleForTenant,
} from "@/src/lib/permissions";
import type { AttendanceStatus } from "@/src/lib/attendance";
import type { AssignmentStatus } from "@/src/lib/assignments";
import type { PaymentLinkStatus } from "@/src/lib/paymentLinks";
import type { PaymentStatus } from "@/src/lib/payments";
import type {
  SessionDeliveryMode,
  SessionMeetingProvider,
} from "@/src/lib/sessions";
import { getStudentById, type Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type { MemberRole } from "@/src/lib/team";

export type LessonProgressStatus =
  | "not_started"
  | "in_progress"
  | "completed";

export type LessonProgress = {
  id: string;
  tenant_id: string;
  student_id: string;
  course_id: string;
  lesson_id: string;
  status: LessonProgressStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PortalStudentSummary = {
  completedLessonsCount: number;
  enrolledCourseCount: number;
  progressRecordCount: number;
  student: Student;
};

export type StudentPortalCourse = {
  completedLessonsCount: number;
  course: Course;
  enrollment: Pick<Enrollment, "id" | "status" | "enrolled_at" | "completed_at">;
  isCompleted: boolean;
  lessonCount: number;
  progressPercentage: number;
  sectionCount: number;
};

export type PortalLesson = Lesson & {
  progress: LessonProgress | null;
  progressStatus: LessonProgressStatus;
};

export type PortalSection = CourseSection & {
  lessons: PortalLesson[];
};

export type StudentCourseAccess = {
  course: Course;
  sections: PortalSection[];
};

export type StudentPortalAttendanceRecord = {
  id: string;
  marked_at: string;
  remarks: string | null;
  session: {
    id: string;
    scheduled_start_at: string;
    status: string;
    title: string;
  } | null;
  status: AttendanceStatus;
};

export type StudentPortalAttendance = {
  absent: number;
  excused: number;
  late: number;
  percent: number | null;
  present: number;
  records: StudentPortalAttendanceRecord[];
  total: number;
};

export type StudentPortalAssignment = {
  assignment: {
    cohort_id: string | null;
    course_id: string | null;
    due_at: string | null;
    id: string;
    max_score: number | null;
    status: AssignmentStatus;
    title: string;
  };
  cohort: Pick<CohortWithCourse, "id" | "name"> | null;
  course: Pick<Course, "id" | "title"> | null;
  submission: {
    feedback: string | null;
    reviewed_at: string | null;
    score: number | null;
    status: "late" | "pending" | "reviewed" | "submitted";
    submitted_at: string | null;
  } | null;
};

export type StudentPortalCertificate = {
  certificateNumber: string;
  courseTitle: string;
  enrollmentId: string;
  issuedAt: string;
};

export type StudentPortalPayment = {
  amount: number;
  courseTitle: string | null;
  currency: string;
  id: string;
  paidAt: string | null;
  receiptNumber: string | null;
  status: PaymentStatus;
};

export type StudentPortalPaymentLink = {
  amount: number;
  courseTitle: string | null;
  currency: string;
  expiresAt: string | null;
  id: string;
  paymentUrl: string | null;
  status: PaymentLinkStatus;
};

export type StudentPortalPayments = {
  paidCount: number;
  paymentLinks: StudentPortalPaymentLink[];
  payments: StudentPortalPayment[];
  pendingCount: number;
};

export type StudentPortalSession = {
  cohort: Pick<CohortWithCourse, "id" | "name"> | null;
  course: Pick<Course, "id" | "title"> | null;
  delivery_mode: SessionDeliveryMode;
  id: string;
  join_available_from: string | null;
  meeting_provider: SessionMeetingProvider | null;
  meeting_url: string | null;
  scheduled_end_at: string | null;
  scheduled_start_at: string;
  status: string;
  timezone: string;
  title: string;
};

export type StudentPortalNotification = {
  created_at: string;
  id: string;
  message: string;
  severity: "critical" | "info" | "warning";
  title: string;
  type: string;
};

export type StudentPortalConversation = {
  created_at: string;
  id: string;
  thread_type: string;
  title: string | null;
  updated_at: string;
};

export type StudentPortalOverview = {
  activeCohorts: StudentCohortMembership[];
  assignments: StudentPortalAssignment[];
  attendance: StudentPortalAttendance;
  certificates: StudentPortalCertificate[];
  courses: StudentPortalCourse[];
  notifications: StudentPortalNotification[];
  conversations: StudentPortalConversation[];
  payments: StudentPortalPayments;
  sessions: {
    recent: StudentPortalSession[];
    upcoming: StudentPortalSession[];
  };
  student: Student;
  summary: {
    attendancePercent: number | null;
    completedCertificates: number;
    enrolledCourses: number;
    paidPayments: number;
    pendingAssignments: number;
    pendingPayments: number;
  };
};

type StudentPortalAccessMode = "student" | "team";

type StudentPortalRequest = {
  accessMode?: StudentPortalAccessMode;
  studentId: string;
  tenantId: string;
};

const studentSelect =
  "id,tenant_id,full_name,email,phone,status,source,notes,created_by,created_at,updated_at";

const courseSelect =
  "id,tenant_id,title,slug,description,status,thumbnail_url,created_by,created_at,updated_at";

const enrollmentSelect =
  "id,tenant_id,student_id,course_id,status,enrolled_at,completed_at,created_by,created_at,updated_at";

const progressSelect =
  "id,tenant_id,student_id,course_id,lesson_id,status,completed_at,created_at,updated_at";

function getProgressPercentage(completed: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((completed / total) * 100);
}

function canPreviewStudentPortal(role: MemberRole | null | undefined) {
  return (
    role === "owner" ||
    role === "admin" ||
    canManageStudents(role) ||
    canAccessAttendance(role)
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
    throw new Error("You must be logged in to preview the student portal.");
  }

  const role = await getMemberRoleForTenant(tenantId, user.id);

  if (!canPreviewStudentPortal(role)) {
    await logActivity({
      action: "access_denied",
      description: "Blocked student portal preview without permission.",
      entityName: "Student Portal",
      entityType: "security",
      metadata: { role, route: "/app/student-portal" },
      severity: "warning",
      tenantId,
    });
    throw new Error("You do not have permission to preview student portals.");
  }

  return { role, user };
}

async function ensureTeamPortalPreviewAccess(params: {
  accessMode?: StudentPortalAccessMode;
  tenantId: string;
}) {
  if (params.accessMode === "student") {
    return null;
  }

  return getCurrentUserAndRole(params.tenantId);
}

async function getLessonCountsForCourses(tenantId: string, courseIds: string[]) {
  if (courseIds.length === 0) {
    return new Map<string, { lessonCount: number; sectionCount: number }>();
  }

  const supabase = getSupabaseClient();
  const [sectionsResult, lessonsResult] = await Promise.all([
    supabase
      .from("course_sections")
      .select("id,course_id")
      .eq("tenant_id", tenantId)
      .in("course_id", courseIds),
    supabase
      .from("lessons")
      .select("id,course_id")
      .eq("tenant_id", tenantId)
      .in("course_id", courseIds),
  ]);

  if (sectionsResult.error) {
    throw sectionsResult.error;
  }

  if (lessonsResult.error) {
    throw lessonsResult.error;
  }

  const counts = new Map<string, { lessonCount: number; sectionCount: number }>();

  for (const courseId of courseIds) {
    counts.set(courseId, { lessonCount: 0, sectionCount: 0 });
  }

  for (const section of (sectionsResult.data ?? []) as {
    course_id: string;
    id: string;
  }[]) {
    const current = counts.get(section.course_id) ?? {
      lessonCount: 0,
      sectionCount: 0,
    };
    current.sectionCount += 1;
    counts.set(section.course_id, current);
  }

  for (const lesson of (lessonsResult.data ?? []) as {
    course_id: string;
    id: string;
  }[]) {
    const current = counts.get(lesson.course_id) ?? {
      lessonCount: 0,
      sectionCount: 0,
    };
    current.lessonCount += 1;
    counts.set(lesson.course_id, current);
  }

  return counts;
}

export async function getPortalStudentsForTenant(tenantId: string) {
  await getCurrentUserAndRole(tenantId);
  const supabase = getSupabaseClient();
  const { data: enrollmentsData, error: enrollmentsError } = await supabase
    .from("enrollments")
    .select(enrollmentSelect)
    .eq("tenant_id", tenantId)
    .order("enrolled_at", { ascending: false });

  if (enrollmentsError) {
    throw enrollmentsError;
  }

  const enrollments = (enrollmentsData ?? []) as Enrollment[];
  const studentIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.student_id)),
  );

  if (studentIds.length === 0) {
    return [];
  }

  const [studentsResult, progressResult] = await Promise.all([
    supabase
      .from("students")
      .select(studentSelect)
      .eq("tenant_id", tenantId)
      .in("id", studentIds),
    supabase
      .from("lesson_progress")
      .select(progressSelect)
      .eq("tenant_id", tenantId)
      .in("student_id", studentIds),
  ]);

  if (studentsResult.error) {
    throw studentsResult.error;
  }

  if (progressResult.error) {
    throw progressResult.error;
  }

  const students = (studentsResult.data ?? []) as Student[];
  const progressRows = (progressResult.data ?? []) as LessonProgress[];
  const enrollmentsByStudent = new Map<string, Set<string>>();
  const progressByStudent = new Map<
    string,
    { completedLessonsCount: number; progressRecordCount: number }
  >();

  for (const enrollment of enrollments) {
    const current =
      enrollmentsByStudent.get(enrollment.student_id) ?? new Set<string>();
    current.add(enrollment.course_id);
    enrollmentsByStudent.set(enrollment.student_id, current);
  }

  for (const progress of progressRows) {
    const current = progressByStudent.get(progress.student_id) ?? {
      completedLessonsCount: 0,
      progressRecordCount: 0,
    };
    current.progressRecordCount += 1;

    if (progress.status === "completed") {
      current.completedLessonsCount += 1;
    }

    progressByStudent.set(progress.student_id, current);
  }

  return students.map((student) => {
    const progress = progressByStudent.get(student.id);

    return {
      completedLessonsCount: progress?.completedLessonsCount ?? 0,
      enrolledCourseCount: enrollmentsByStudent.get(student.id)?.size ?? 0,
      progressRecordCount: progress?.progressRecordCount ?? 0,
      student,
    };
  }) as PortalStudentSummary[];
}

export async function getStudentPortalCourses(params: StudentPortalRequest) {
  await ensureTeamPortalPreviewAccess(params);
  const supabase = getSupabaseClient();
  const student = await getStudentById(params);

  if (!student) {
    return null;
  }

  const { data: enrollmentsData, error: enrollmentsError } = await supabase
    .from("enrollments")
    .select(enrollmentSelect)
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .order("enrolled_at", { ascending: false });

  if (enrollmentsError) {
    throw enrollmentsError;
  }

  const enrollments = (enrollmentsData ?? []) as Enrollment[];
  const courseIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.course_id)),
  );

  const [coursesResult, progressResult, lessonCounts] = await Promise.all([
    courseIds.length
      ? supabase
          .from("courses")
          .select(courseSelect)
          .eq("tenant_id", params.tenantId)
          .in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length
      ? supabase
          .from("lesson_progress")
          .select(progressSelect)
          .eq("tenant_id", params.tenantId)
          .eq("student_id", params.studentId)
          .in("course_id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    getLessonCountsForCourses(params.tenantId, courseIds),
  ]);

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  if (progressResult.error) {
    throw progressResult.error;
  }

  const courses = (coursesResult.data ?? []) as Course[];
  const progressRows = (progressResult.data ?? []) as LessonProgress[];
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const completedByCourse = new Map<string, number>();

  for (const progress of progressRows) {
    if (progress.status !== "completed") {
      continue;
    }

    completedByCourse.set(
      progress.course_id,
      (completedByCourse.get(progress.course_id) ?? 0) + 1,
    );
  }

  const coursesSummary = enrollments
    .map((enrollment) => {
      const course = courseById.get(enrollment.course_id);

      if (!course) {
        return null;
      }

      const counts = lessonCounts.get(course.id) ?? {
        lessonCount: 0,
        sectionCount: 0,
      };
      const completedLessonsCount = completedByCourse.get(course.id) ?? 0;

      return {
        completedLessonsCount,
        course,
        enrollment: {
          completed_at: enrollment.completed_at,
          enrolled_at: enrollment.enrolled_at,
          id: enrollment.id,
          status: enrollment.status as EnrollmentStatus,
        },
        isCompleted:
          counts.lessonCount > 0 && completedLessonsCount >= counts.lessonCount,
        lessonCount: counts.lessonCount,
        progressPercentage: getProgressPercentage(
          completedLessonsCount,
          counts.lessonCount,
        ),
        sectionCount: counts.sectionCount,
      } satisfies StudentPortalCourse;
    })
    .filter(Boolean) as StudentPortalCourse[];

  return {
    courses: coursesSummary,
    student,
  };
}

function createScopedOrFilter(params: {
  cohortIds: string[];
  courseIds: string[];
}) {
  const filters: string[] = [];

  if (params.courseIds.length > 0) {
    filters.push(`course_id.in.(${params.courseIds.join(",")})`);
  }

  if (params.cohortIds.length > 0) {
    filters.push(`cohort_id.in.(${params.cohortIds.join(",")})`);
  }

  return filters.join(",");
}

async function getPortalScope(params: StudentPortalRequest) {
  const [courseOverview, activeCohorts] = await Promise.all([
    getStudentPortalCourses(params),
    getCohortsForStudent(params),
  ]);

  if (!courseOverview) {
    return null;
  }

  return {
    activeCohorts,
    courseIds: courseOverview.courses.map((course) => course.course.id),
    courses: courseOverview.courses,
    cohortIds: activeCohorts
      .map((membership) => membership.cohort_id)
      .filter(Boolean),
    student: courseOverview.student,
  };
}

export async function getStudentPortalAttendance(params: StudentPortalRequest) {
  await ensureTeamPortalPreviewAccess(params);
  const student = await getStudentById(params);

  if (!student) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id,tenant_id,session_id,student_id,status,remarks,marked_at")
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .order("marked_at", { ascending: false });

  if (error) {
    throw error;
  }

  const records = (data ?? []) as {
    id: string;
    marked_at: string;
    remarks: string | null;
    session_id: string;
    status: AttendanceStatus;
  }[];
  const sessionIds = Array.from(new Set(records.map((record) => record.session_id)));
  const sessionsResult = sessionIds.length
    ? await supabase
        .from("sessions")
        .select("id,title,status,scheduled_start_at")
        .eq("tenant_id", params.tenantId)
        .in("id", sessionIds)
    : { data: [], error: null };

  if (sessionsResult.error) {
    throw sessionsResult.error;
  }

  const sessionById = new Map(
    ((sessionsResult.data ?? []) as {
      id: string;
      scheduled_start_at: string;
      status: string;
      title: string;
    }[]).map((session) => [session.id, session]),
  );
  const summary = {
    absent: 0,
    excused: 0,
    late: 0,
    present: 0,
  };

  for (const record of records) {
    summary[record.status] += 1;
  }

  const total = records.length;
  const percent =
    total > 0 ? Math.round(((summary.present + summary.late) / total) * 100) : null;

  return {
    ...summary,
    percent,
    records: records.map((record) => ({
      id: record.id,
      marked_at: record.marked_at,
      remarks: record.remarks,
      session: sessionById.get(record.session_id) ?? null,
      status: record.status,
    })),
    total,
  } satisfies StudentPortalAttendance;
}

export async function getStudentPortalSessions(params: StudentPortalRequest) {
  const scope = await getPortalScope(params);

  if (!scope) {
    return { recent: [], upcoming: [] };
  }

  if (scope.courseIds.length === 0 && scope.cohortIds.length === 0) {
    return { recent: [], upcoming: [] };
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("sessions")
    .select(
      "id,tenant_id,course_id,cohort_id,title,delivery_mode,meeting_provider,meeting_url,join_available_from,timezone,scheduled_start_at,scheduled_end_at,status",
    )
    .eq("tenant_id", params.tenantId);
  const scopedFilter = createScopedOrFilter(scope);

  if (scopedFilter) {
    query = query.or(scopedFilter);
  }

  const { data, error } = await query.order("scheduled_start_at", {
    ascending: true,
  });

  if (error) {
    throw error;
  }

  const courseById = new Map(
    scope.courses.map((course) => [
      course.course.id,
      { id: course.course.id, title: course.course.title },
    ]),
  );
  const cohortById = new Map(
    scope.activeCohorts
      .filter((membership) => membership.cohort)
      .map((membership) => [
        membership.cohort_id,
        {
          id: membership.cohort_id,
          name: membership.cohort?.name ?? "Cohort",
        },
      ]),
  );
  const now = Date.now();
  const sessions = ((data ?? []) as {
    cohort_id: string | null;
    course_id: string | null;
    delivery_mode: SessionDeliveryMode;
    id: string;
    join_available_from: string | null;
    meeting_provider: SessionMeetingProvider | null;
    meeting_url: string | null;
    scheduled_end_at: string | null;
    scheduled_start_at: string;
    status: string;
    timezone: string;
    title: string;
  }[]).map((session) => ({
    cohort: session.cohort_id ? cohortById.get(session.cohort_id) ?? null : null,
    course: session.course_id ? courseById.get(session.course_id) ?? null : null,
    delivery_mode: session.delivery_mode ?? "offline",
    id: session.id,
    join_available_from: session.join_available_from,
    meeting_provider: session.meeting_provider,
    meeting_url: session.meeting_url,
    scheduled_end_at: session.scheduled_end_at,
    scheduled_start_at: session.scheduled_start_at,
    status: session.status,
    timezone: session.timezone ?? "Asia/Kolkata",
    title: session.title,
  })) satisfies StudentPortalSession[];

  return {
    recent: sessions
      .filter((session) => new Date(session.scheduled_start_at).getTime() < now)
      .slice(-6)
      .reverse(),
    upcoming: sessions
      .filter(
        (session) =>
          session.status === "scheduled" &&
          new Date(session.scheduled_start_at).getTime() >= now,
      )
      .slice(0, 6),
  };
}

export async function getStudentUpcomingLiveClasses(params: StudentPortalRequest) {
  const sessions = await getStudentPortalSessions(params);

  return sessions.upcoming;
}

export async function getStudentPortalAssignments(params: StudentPortalRequest) {
  const scope = await getPortalScope(params);

  if (!scope) {
    return [];
  }

  if (scope.courseIds.length === 0 && scope.cohortIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("assignments")
    .select(
      "id,tenant_id,course_id,cohort_id,title,max_score,due_at,status,created_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("status", "published");
  const scopedFilter = createScopedOrFilter(scope);

  if (scopedFilter) {
    query = query.or(scopedFilter);
  }

  const { data, error } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const assignments = (data ?? []) as {
    cohort_id: string | null;
    course_id: string | null;
    due_at: string | null;
    id: string;
    max_score: number | null;
    status: AssignmentStatus;
    title: string;
  }[];
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const submissionsResult = assignmentIds.length
    ? await supabase
        .from("assignment_submissions")
        .select("assignment_id,status,score,feedback,submitted_at,reviewed_at")
        .eq("tenant_id", params.tenantId)
        .eq("student_id", params.studentId)
        .in("assignment_id", assignmentIds)
    : { data: [], error: null };

  if (submissionsResult.error) {
    throw submissionsResult.error;
  }

  const submissionByAssignment = new Map(
    ((submissionsResult.data ?? []) as {
      assignment_id: string;
      feedback: string | null;
      reviewed_at: string | null;
      score: number | null;
      status: "late" | "pending" | "reviewed" | "submitted";
      submitted_at: string | null;
    }[]).map((submission) => [submission.assignment_id, submission]),
  );
  const courseById = new Map(
    scope.courses.map((course) => [
      course.course.id,
      { id: course.course.id, title: course.course.title },
    ]),
  );
  const cohortById = new Map(
    scope.activeCohorts
      .filter((membership) => membership.cohort)
      .map((membership) => [
        membership.cohort_id,
        {
          id: membership.cohort_id,
          name: membership.cohort?.name ?? "Cohort",
        },
      ]),
  );

  return assignments.map((assignment) => ({
    assignment,
    cohort: assignment.cohort_id
      ? cohortById.get(assignment.cohort_id) ?? null
      : null,
    course: assignment.course_id
      ? courseById.get(assignment.course_id) ?? null
      : null,
    submission: submissionByAssignment.get(assignment.id) ?? null,
  })) satisfies StudentPortalAssignment[];
}

export async function getStudentPortalCertificates(params: StudentPortalRequest) {
  const courseOverview = await getStudentPortalCourses(params);

  if (!courseOverview) {
    return [];
  }

  return courseOverview.courses
    .filter(
      (course) =>
        course.enrollment.status === "completed" &&
        Boolean(course.enrollment.completed_at),
    )
    .map((course, index) => ({
      certificateNumber: `CERT-${new Date(
        course.enrollment.completed_at ?? course.enrollment.enrolled_at,
      ).getFullYear()}-${String(index + 1).padStart(4, "0")}`,
      courseTitle: course.course.title,
      enrollmentId: course.enrollment.id,
      issuedAt: course.enrollment.completed_at ?? course.enrollment.enrolled_at,
    })) satisfies StudentPortalCertificate[];
}

export async function getStudentPortalPayments(params: StudentPortalRequest) {
  if (params.accessMode !== "student") {
    const { role } = await getCurrentUserAndRole(params.tenantId);

    if (!canAccessPayments(role)) {
      return {
        paidCount: 0,
        paymentLinks: [],
        payments: [],
        pendingCount: 0,
      } satisfies StudentPortalPayments;
    }
  }

  const student = await getStudentById(params);

  if (!student) {
    return {
      paidCount: 0,
      paymentLinks: [],
      payments: [],
      pendingCount: 0,
    } satisfies StudentPortalPayments;
  }

  const supabase = getSupabaseClient();
  const [paymentsResult, linksResult] = await Promise.all([
    supabase
      .from("payments")
      .select("id,course_id,amount,currency,status,paid_at,receipt_number")
      .eq("tenant_id", params.tenantId)
      .eq("student_id", params.studentId)
      .order("paid_at", { ascending: false }),
    supabase
      .from("payment_links")
      .select("id,course_id,amount,currency,status,expires_at,payment_url")
      .eq("tenant_id", params.tenantId)
      .eq("student_id", params.studentId)
      .order("created_at", { ascending: false }),
  ]);

  if (paymentsResult.error) {
    throw paymentsResult.error;
  }

  if (linksResult.error) {
    throw linksResult.error;
  }

  const courseIds = Array.from(
    new Set([
      ...((paymentsResult.data ?? []) as { course_id: string | null }[])
        .map((payment) => payment.course_id)
        .filter(Boolean),
      ...((linksResult.data ?? []) as { course_id: string | null }[])
        .map((link) => link.course_id)
        .filter(Boolean),
    ]),
  ) as string[];
  const coursesResult = courseIds.length
    ? await supabase
        .from("courses")
        .select("id,title")
        .eq("tenant_id", params.tenantId)
        .in("id", courseIds)
    : { data: [], error: null };

  if (coursesResult.error) {
    throw coursesResult.error;
  }

  const courseById = new Map(
    ((coursesResult.data ?? []) as Pick<Course, "id" | "title">[]).map(
      (course) => [course.id, course.title],
    ),
  );
  const payments = ((paymentsResult.data ?? []) as {
    amount: number;
    course_id: string | null;
    currency: string;
    id: string;
    paid_at: string | null;
    receipt_number: string | null;
    status: PaymentStatus;
  }[]).map((payment) => ({
    amount: Number(payment.amount),
    courseTitle: payment.course_id
      ? courseById.get(payment.course_id) ?? null
      : null,
    currency: payment.currency,
    id: payment.id,
    paidAt: payment.paid_at,
    receiptNumber: payment.receipt_number,
    status: payment.status,
  }));
  const paymentLinks = ((linksResult.data ?? []) as {
    amount: number;
    course_id: string | null;
    currency: string;
    expires_at: string | null;
    id: string;
    payment_url: string | null;
    status: PaymentLinkStatus;
  }[]).map((link) => ({
    amount: Number(link.amount),
    courseTitle: link.course_id ? courseById.get(link.course_id) ?? null : null,
    currency: link.currency,
    expiresAt: link.expires_at,
    id: link.id,
    paymentUrl: link.payment_url,
    status: link.status,
  }));

  return {
    paidCount: payments.filter((payment) => payment.status === "completed").length,
    paymentLinks,
    payments,
    pendingCount:
      payments.filter((payment) => payment.status === "pending").length +
      paymentLinks.filter((link) => link.status === "created" || link.status === "sent")
        .length,
  } satisfies StudentPortalPayments;
}

export async function getStudentPortalNotifications(params: StudentPortalRequest) {
  if (params.accessMode !== "student") {
    return [] satisfies StudentPortalNotification[];
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id,type,title,message,severity,created_at")
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    const message = error.message?.toLowerCase() ?? "";

    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      message.includes("schema cache") ||
      message.includes("does not exist")
    ) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as StudentPortalNotification[]).map((notification) => ({
    created_at: notification.created_at,
    id: notification.id,
    message: notification.message,
    severity: notification.severity,
    title: notification.title,
    type: notification.type,
  }));
}

export async function getStudentPortalConversations(params: StudentPortalRequest) {
  void params;

  // Student conversation access deferred until safe message RLS/RPC is implemented.
  return [] satisfies StudentPortalConversation[];
}

export async function getStudentPortalOverview(params: StudentPortalRequest) {
  await ensureTeamPortalPreviewAccess(params);
  const scope = await getPortalScope(params);

  if (!scope) {
    return null;
  }

  const [
    attendance,
    assignments,
    certificates,
    payments,
    sessions,
    notifications,
    conversations,
  ] =
    await Promise.all([
      getStudentPortalAttendance(params),
      getStudentPortalAssignments(params),
      getStudentPortalCertificates(params),
      getStudentPortalPayments(params),
      getStudentPortalSessions(params),
      getStudentPortalNotifications(params),
      getStudentPortalConversations(params),
    ]);
  const pendingAssignments = assignments.filter(
    (assignment) =>
      !assignment.submission ||
      assignment.submission.status === "pending" ||
      assignment.submission.status === "late",
  ).length;

  if (params.accessMode !== "student") {
    await logActivity({
      action: "student_portal_previewed",
      description: "Previewed student portal",
      entityId: scope.student.id,
      entityName: scope.student.full_name,
      entityType: "student",
      metadata: {
        student_id: scope.student.id,
        student_name: scope.student.full_name,
      },
      tenantId: params.tenantId,
    });
  }

  return {
    activeCohorts: scope.activeCohorts,
    assignments,
    attendance:
      attendance ??
      ({
        absent: 0,
        excused: 0,
        late: 0,
        percent: null,
        present: 0,
        records: [],
        total: 0,
      } satisfies StudentPortalAttendance),
    certificates,
    courses: scope.courses,
    conversations,
    notifications,
    payments,
    sessions,
    student: scope.student,
    summary: {
      attendancePercent: attendance?.percent ?? null,
      completedCertificates: certificates.length,
      enrolledCourses: scope.courses.length,
      paidPayments: payments.paidCount,
      pendingAssignments,
      pendingPayments: payments.pendingCount,
    },
  } satisfies StudentPortalOverview;
}

export async function getStudentCourseAccess(params: {
  courseId: string;
  studentId: string;
  tenantId: string;
}) {
  await getCurrentUserAndRole(params.tenantId);
  const student = await getStudentById(params);

  if (!student) {
    return null;
  }

  const supabase = getSupabaseClient();
  const [{ data: courseData, error: courseError }, sectionsResult, lessonsResult, progressResult] =
    await Promise.all([
      supabase
        .from("courses")
        .select(courseSelect)
        .eq("tenant_id", params.tenantId)
        .eq("id", params.courseId)
        .maybeSingle(),
      supabase
        .from("course_sections")
        .select("id,course_id,tenant_id,title,sort_order,created_at,updated_at")
        .eq("tenant_id", params.tenantId)
        .eq("course_id", params.courseId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("lessons")
        .select(
          "id,section_id,course_id,tenant_id,title,lesson_type,content,video_url,resource_url,sort_order,is_preview,created_at,updated_at",
        )
        .eq("tenant_id", params.tenantId)
        .eq("course_id", params.courseId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("lesson_progress")
        .select(progressSelect)
        .eq("tenant_id", params.tenantId)
        .eq("student_id", params.studentId)
        .eq("course_id", params.courseId),
    ]);

  if (courseError) {
    throw courseError;
  }

  if (sectionsResult.error) {
    throw sectionsResult.error;
  }

  if (lessonsResult.error) {
    throw lessonsResult.error;
  }

  if (progressResult.error) {
    throw progressResult.error;
  }

  if (!courseData) {
    return null;
  }

  const sections = (sectionsResult.data ?? []) as CourseSection[];
  const lessons = (lessonsResult.data ?? []) as Lesson[];
  const progressRows = (progressResult.data ?? []) as LessonProgress[];
  const progressByLesson = new Map(
    progressRows.map((progress) => [progress.lesson_id, progress]),
  );
  const lessonsBySection = lessons.reduce<Record<string, PortalLesson[]>>(
    (accumulator, lesson) => {
      const progress = progressByLesson.get(lesson.id) ?? null;
      accumulator[lesson.section_id] = accumulator[lesson.section_id] ?? [];
      accumulator[lesson.section_id].push({
        ...lesson,
        progress,
        progressStatus: progress?.status ?? "not_started",
      });
      return accumulator;
    },
    {},
  );

  return {
    course: courseData as Course,
    sections: sections.map((section) => ({
      ...section,
      lessons: lessonsBySection[section.id] ?? [],
    })),
  } satisfies StudentCourseAccess;
}

export async function updateLessonProgress(params: {
  courseId: string;
  lessonId: string;
  status: LessonProgressStatus;
  studentId: string;
  tenantId: string;
}) {
  const { role } = await getCurrentUserAndRole(params.tenantId);
  const student = await getStudentById(params);

  if (!student || !canManageStudents(role)) {
    throw new Error("You do not have permission to update portal progress.");
  }

  const supabase = getSupabaseClient();
  const completedAt =
    params.status === "completed" ? new Date().toISOString() : null;

  const { data, error } = await supabase
    .from("lesson_progress")
    .upsert(
      {
        completed_at: completedAt,
        course_id: params.courseId,
        lesson_id: params.lessonId,
        status: params.status,
        student_id: params.studentId,
        tenant_id: params.tenantId,
      },
      {
        onConflict: "tenant_id,student_id,course_id,lesson_id",
      },
    )
    .select(progressSelect)
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .eq("course_id", params.courseId)
    .eq("lesson_id", params.lessonId)
    .single();

  if (error) {
    throw error;
  }

  await syncEnrollmentCompletion(
    params.studentId,
    params.courseId,
    params.tenantId,
  );

  return data as LessonProgress;
}
