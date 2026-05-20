import { logActivity } from "@/src/lib/auditLogger";
import { getCohortMembers } from "@/src/lib/cohorts";
import { getEnrollmentsForCourse } from "@/src/lib/enrollments";
import { canManageAttendance } from "@/src/lib/permissions";
import {
  getSessionById,
  type TrainingSessionWithRelations,
} from "@/src/lib/sessions";
import { createNotificationForTenantRoles } from "@/src/lib/notifications";
import type { Student } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export type AttendanceRecord = {
  created_at: string;
  id: string;
  marked_at: string;
  marked_by: string | null;
  remarks: string | null;
  session_id: string;
  status: AttendanceStatus;
  student_id: string;
  tenant_id: string;
};

export type AttendanceRecordWithStudent = AttendanceRecord & {
  student: Pick<Student, "email" | "full_name" | "id" | "phone" | "status"> | null;
};

export type AttendanceRosterItem = {
  record: AttendanceRecord | null;
  student: Pick<Student, "email" | "full_name" | "id" | "phone" | "status">;
};

export type AttendanceSummary = {
  absent: number;
  excused: number;
  late: number;
  marked: number;
  percent: number | null;
  present: number;
  total: number;
};

const attendanceColumns =
  "id,tenant_id,session_id,student_id,status,remarks,marked_by,marked_at,created_at";

async function notifyAttendanceAlert(params: {
  absentCount: number;
  session: TrainingSessionWithRelations;
}) {
  if (params.absentCount <= 0) {
    return;
  }

  try {
    await createNotificationForTenantRoles({
      actionUrl: `/app/sessions/${params.session.id}`,
      entityId: params.session.id,
      entityType: "attendance_record",
      message: `${params.absentCount} student${
        params.absentCount === 1 ? "" : "s"
      } marked absent for ${params.session.title}.`,
      metadata: {
        absentCount: params.absentCount,
        cohortId: params.session.cohort_id,
        courseId: params.session.course_id,
        sessionId: params.session.id,
      },
      roles: ["owner", "admin"],
      severity: "warning",
      tenantId: params.session.tenant_id,
      title: `Attendance alert: ${params.session.title}`,
      type: "attendance_alert",
    });
  } catch {
    // Notifications are non-blocking for attendance marking.
  }
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
    throw new Error("You must be logged in to manage attendance.");
  }

  const role = await getCurrentMemberRole(tenantId, user.id);

  return { role, user };
}

async function ensureCanManageAttendanceForSession(
  session: TrainingSessionWithRelations,
) {
  const { role, user } = await getCurrentUserAndRole(session.tenant_id);

  if (!canManageAttendance(role)) {
    throw new Error("You do not have permission to mark attendance.");
  }

  return { role, user };
}

function calculateSummary(total: number, records: AttendanceRecord[]) {
  const summary: AttendanceSummary = {
    absent: 0,
    excused: 0,
    late: 0,
    marked: records.length,
    percent: null,
    present: 0,
    total,
  };

  for (const record of records) {
    summary[record.status] += 1;
  }

  summary.percent =
    total > 0 ? Math.round(((summary.present + summary.late) / total) * 100) : null;

  return summary;
}

async function getStudentRows(
  studentIds: string[],
  tenantId: string,
): Promise<AttendanceRosterItem["student"][]> {
  if (studentIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("students")
    .select("id,full_name,email,phone,status")
    .eq("tenant_id", tenantId)
    .in("id", studentIds)
    .order("full_name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as AttendanceRosterItem["student"][];
}

async function getEligibleStudentIdsForSession(
  session: TrainingSessionWithRelations,
) {
  if (session.cohort_id) {
    const members = await getCohortMembers({
      cohortId: session.cohort_id,
      tenantId: session.tenant_id,
    });

    return new Set(members.map((member) => member.student_id));
  }

  if (session.course_id) {
    const enrollments = await getEnrollmentsForCourse({
      courseId: session.course_id,
      tenantId: session.tenant_id,
    });

    return new Set(enrollments.map((enrollment) => enrollment.student_id));
  }

  return new Set<string>();
}

async function ensureStudentsBelongToSession(
  session: TrainingSessionWithRelations,
  studentIds: string[],
) {
  const eligibleStudentIds = await getEligibleStudentIdsForSession(session);
  const invalidStudentId = studentIds.find(
    (studentId) => !eligibleStudentIds.has(studentId),
  );

  if (invalidStudentId) {
    await logActivity({
      action: "access_denied",
      description: "Blocked attendance marking outside session roster.",
      entityId: session.id,
      entityName: session.title,
      entityType: "security",
      metadata: {
        invalidStudentId,
        sessionId: session.id,
      },
      severity: "warning",
      tenantId: session.tenant_id,
    });
    throw new Error("Attendance can only be marked for students in this session roster.");
  }
}

export async function getSessionAttendance(params: {
  sessionId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select(attendanceColumns)
    .eq("tenant_id", params.tenantId)
    .eq("session_id", params.sessionId)
    .order("marked_at", { ascending: false });

  if (error) {
    throw error;
  }

  const records = (data ?? []) as AttendanceRecord[];
  const studentIds = Array.from(new Set(records.map((record) => record.student_id)));
  const students = await getStudentRows(studentIds, params.tenantId);
  const studentById = new Map(students.map((student) => [student.id, student]));

  return records.map((record) => ({
    ...record,
    student: studentById.get(record.student_id) ?? null,
  })) satisfies AttendanceRecordWithStudent[];
}

export async function getSessionAttendanceRoster(params: {
  sessionId: string;
  tenantId: string;
}) {
  const session = await getSessionById(params);

  if (!session) {
    throw new Error("Session not found in this workspace.");
  }

  const [records, cohortMembers, enrollments] = await Promise.all([
    getSessionAttendance(params),
    session.cohort_id
      ? getCohortMembers({
          cohortId: session.cohort_id,
          tenantId: params.tenantId,
        })
      : Promise.resolve([]),
    !session.cohort_id && session.course_id
      ? getEnrollmentsForCourse({
          courseId: session.course_id,
          tenantId: params.tenantId,
        })
      : Promise.resolve([]),
  ]);

  const studentIds = Array.from(
    new Set([
      ...cohortMembers.map((member) => member.student_id),
      ...enrollments.map((enrollment) => enrollment.student_id),
      ...records.map((record) => record.student_id),
    ]),
  );
  const students = await getStudentRows(studentIds, params.tenantId);
  const recordByStudentId = new Map(
    records.map((record) => [record.student_id, record]),
  );

  return {
    roster: students.map((student) => ({
      record: recordByStudentId.get(student.id) ?? null,
      student,
    })) satisfies AttendanceRosterItem[],
    session,
    summary: calculateSummary(students.length, records),
  };
}

export async function markAttendance(params: {
  remarks?: string;
  sessionId: string;
  status: AttendanceStatus;
  studentId: string;
  tenantId: string;
}) {
  const session = await getSessionById({
    sessionId: params.sessionId,
    tenantId: params.tenantId,
  });

  if (!session) {
    throw new Error("Session not found in this workspace.");
  }

  const { user } = await ensureCanManageAttendanceForSession(session);
  await ensureStudentsBelongToSession(session, [params.studentId]);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .upsert(
      {
        marked_at: new Date().toISOString(),
        marked_by: user.id,
        remarks: params.remarks?.trim() || null,
        session_id: params.sessionId,
        status: params.status,
        student_id: params.studentId,
        tenant_id: params.tenantId,
      },
      { onConflict: "session_id,student_id" },
    )
    .select(attendanceColumns)
    .single();

  if (error) {
    throw error;
  }

  const record = data as AttendanceRecord;

  await logActivity({
    action: "attendance_marked",
    description: "Marked student attendance",
    entityId: record.id,
    entityName: session.title,
    entityType: "attendance_record",
    metadata: {
      sessionId: record.session_id,
      status: record.status,
      studentId: record.student_id,
    },
    tenantId: record.tenant_id,
  });
  await notifyAttendanceAlert({
    absentCount: record.status === "absent" ? 1 : 0,
    session,
  });

  return record;
}

export async function bulkMarkAttendance(params: {
  records: {
    remarks?: string;
    status: AttendanceStatus;
    studentId: string;
  }[];
  sessionId: string;
  tenantId: string;
}) {
  const session = await getSessionById({
    sessionId: params.sessionId,
    tenantId: params.tenantId,
  });

  if (!session) {
    throw new Error("Session not found in this workspace.");
  }

  if (params.records.length === 0) {
    throw new Error("No attendance records selected.");
  }

  const { user } = await ensureCanManageAttendanceForSession(session);
  await ensureStudentsBelongToSession(
    session,
    params.records.map((record) => record.studentId),
  );
  const markedAt = new Date().toISOString();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .upsert(
      params.records.map((record) => ({
        marked_at: markedAt,
        marked_by: user.id,
        remarks: record.remarks?.trim() || null,
        session_id: params.sessionId,
        status: record.status,
        student_id: record.studentId,
        tenant_id: params.tenantId,
      })),
      { onConflict: "session_id,student_id" },
    )
    .select(attendanceColumns);

  if (error) {
    throw error;
  }

  await logActivity({
    action: "attendance_bulk_marked",
    description: `Bulk marked attendance for ${params.records.length} students`,
    entityId: session.id,
    entityName: session.title,
    entityType: "attendance_record",
    metadata: {
      count: params.records.length,
      sessionId: params.sessionId,
    },
    tenantId: params.tenantId,
  });
  await notifyAttendanceAlert({
    absentCount: params.records.filter((record) => record.status === "absent")
      .length,
    session,
  });

  return (data ?? []) as AttendanceRecord[];
}

export async function getStudentAttendanceSummary(params: {
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select(attendanceColumns)
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId);

  if (error) {
    throw error;
  }

  const records = (data ?? []) as AttendanceRecord[];
  return calculateSummary(records.length, records);
}

export async function getCohortAttendanceSummary(params: {
  cohortId: string;
  tenantId: string;
}) {
  const members = await getCohortMembers(params);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("cohort_id", params.cohortId);

  if (error) {
    throw error;
  }

  const sessionIds = ((data ?? []) as { id: string }[]).map((session) => session.id);
  const recordsResult = sessionIds.length
    ? await supabase
        .from("attendance_records")
        .select(attendanceColumns)
        .eq("tenant_id", params.tenantId)
        .in("session_id", sessionIds)
    : { data: [], error: null };

  if (recordsResult.error) {
    throw recordsResult.error;
  }

  return calculateSummary(
    members.length * sessionIds.length,
    (recordsResult.data ?? []) as AttendanceRecord[],
  );
}

export function canRoleMarkAttendance(role: MemberRole | null | undefined) {
  return canManageAttendance(role);
}
