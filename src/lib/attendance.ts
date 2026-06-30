import { logActivity } from "@/src/lib/auditLogger";
import { getCohortMembers } from "@/src/lib/cohorts";
import {
  explainPermissionSource,
  logDelegatedPermissionUsage,
  type DelegatedPermission,
  type DelegatedPermissionKey,
  type DelegatedPermissionScopeType,
} from "@/src/lib/delegatedPermissions";
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

type DelegatedAttendanceDecision =
  | { source: "role" }
  | {
      delegatedPermission: DelegatedPermission;
      permissionKey: DelegatedPermissionKey;
      scopeId: string | null;
      scopeType: DelegatedPermissionScopeType;
      source: "delegated";
    };

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
  studentIds: string[] = [],
) {
  const { role, user } = await getCurrentUserAndRole(session.tenant_id);

  if (canManageAttendance(role)) {
    return { decision: { source: "role" } satisfies DelegatedAttendanceDecision, role, user };
  }

  const decision = await getDelegatedAttendanceDecision({
    session,
    studentIds,
    userId: user.id,
  });

  if (!decision) {
    await logActivity({
      action: "access_denied",
      description: "Blocked attendance marking without effective permission.",
      entityId: session.id,
      entityName: session.title,
      entityType: "security",
      metadata: {
        role,
        sessionId: session.id,
        studentIds,
      },
      severity: "warning",
      tenantId: session.tenant_id,
    });
    throw new Error("You do not have permission to mark attendance.");
  }

  return { decision, role, user };
}

async function getDelegatedAttendanceDecision(params: {
  session: TrainingSessionWithRelations;
  studentIds?: string[];
  userId: string;
}): Promise<DelegatedAttendanceDecision | null> {
  const permissionKeys: DelegatedPermissionKey[] = [
    "edit_attendance",
    "edit_attendance_after_lock",
  ];
  const sessionScopes: {
    scopeId: string | null;
    scopeType: DelegatedPermissionScopeType;
  }[] = [
    { scopeId: null, scopeType: "workspace" },
    { scopeId: params.session.id, scopeType: "session" },
  ];

  if (params.session.cohort_id) {
    sessionScopes.push({
      scopeId: params.session.cohort_id,
      scopeType: "cohort",
    });
  }

  for (const permissionKey of permissionKeys) {
    for (const scope of sessionScopes) {
      const source = await explainPermissionSource({
        permission: permissionKey,
        scopeId: scope.scopeId,
        scopeType: scope.scopeType,
        tenantId: params.session.tenant_id,
        userId: params.userId,
      });

      if (source.source === "delegated") {
        return {
          delegatedPermission: source.delegatedPermission,
          permissionKey,
          scopeId: scope.scopeId,
          scopeType: scope.scopeType,
          source: "delegated",
        };
      }
    }

    if (params.studentIds?.length) {
      const studentMatches = await Promise.all(
        params.studentIds.map((studentId) =>
          explainPermissionSource({
            permission: permissionKey,
            scopeId: studentId,
            scopeType: "student",
            tenantId: params.session.tenant_id,
            userId: params.userId,
          }),
        ),
      );

      if (studentMatches.every((source) => source.source === "delegated")) {
        const firstMatch = studentMatches.find(
          (source) => source.source === "delegated",
        );

        if (firstMatch?.source === "delegated") {
          return {
            delegatedPermission: firstMatch.delegatedPermission,
            permissionKey,
            scopeId: params.studentIds.length === 1 ? params.studentIds[0] : null,
            scopeType: "student",
            source: "delegated",
          };
        }
      }
    }
  }

  return null;
}

async function logAttendanceDelegatedUse(params: {
  action: string;
  decision: DelegatedAttendanceDecision;
  entityId: string;
  entityType: string;
  tenantId: string;
  userId: string;
}) {
  if (params.decision.source !== "delegated") {
    return;
  }

  await logDelegatedPermissionUsage({
    action: params.action,
    delegatedPermission: params.decision.delegatedPermission,
    entityId: params.entityId,
    entityType: params.entityType,
    scopeId: params.decision.scopeId,
    scopeType: params.decision.scopeType,
    tenantId: params.tenantId,
    userId: params.userId,
  });
}

async function markDelegatedAttendanceWithRpc(params: {
  remarks?: string;
  sessionId: string;
  status: AttendanceStatus;
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("mark_delegated_attendance", {
      p_remarks: params.remarks?.trim() || null,
      p_session_id: params.sessionId,
      p_status: params.status,
      p_student_id: params.studentId,
      p_tenant_id: params.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as AttendanceRecord;
}

async function markAttendanceWithRpc(params: {
  remarks?: string;
  sessionId: string;
  status: AttendanceStatus;
  studentId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .rpc("mark_attendance_secure", {
      p_remarks: params.remarks?.trim() || null,
      p_session_id: params.sessionId,
      p_status: params.status,
      p_student_id: params.studentId,
      p_tenant_id: params.tenantId,
    })
    .single();

  if (error) {
    throw error;
  }

  return data as AttendanceRecord;
}

async function bulkMarkAttendanceWithRpc(params: {
  records: {
    remarks?: string;
    status: AttendanceStatus;
    studentId: string;
  }[];
  sessionId: string;
  tenantId: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("bulk_mark_attendance_secure", {
    p_records: params.records.map((record) => ({
      remarks: record.remarks?.trim() || null,
      status: record.status,
      studentId: record.studentId,
    })),
    p_session_id: params.sessionId,
    p_tenant_id: params.tenantId,
  });

  if (error) {
    throw error;
  }

  return (data ?? []) as AttendanceRecord[];
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
    return markDelegatedAttendanceWithRpc(params);
  }

  const { decision, user } = await ensureCanManageAttendanceForSession(session, [
    params.studentId,
  ]);
  await ensureStudentsBelongToSession(session, [params.studentId]);

  if (decision.source === "delegated") {
    const record = await markDelegatedAttendanceWithRpc(params);

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

  const record = await markAttendanceWithRpc(params);

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
  await logAttendanceDelegatedUse({
    action: "mark_attendance",
    decision,
    entityId: record.id,
    entityType: "attendance_record",
    tenantId: record.tenant_id,
    userId: user.id,
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

  const { decision, user } = await ensureCanManageAttendanceForSession(
    session,
    params.records.map((record) => record.studentId),
  );
  await ensureStudentsBelongToSession(
    session,
    params.records.map((record) => record.studentId),
  );

  if (decision.source === "delegated") {
    const records = await Promise.all(
      params.records.map((record) =>
        markDelegatedAttendanceWithRpc({
          remarks: record.remarks,
          sessionId: params.sessionId,
          status: record.status,
          studentId: record.studentId,
          tenantId: params.tenantId,
        }),
      ),
    );

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

    return records;
  }

  const records = await bulkMarkAttendanceWithRpc(params);

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
  await logAttendanceDelegatedUse({
    action: "bulk_mark_attendance",
    decision,
    entityId: session.id,
    entityType: "session",
    tenantId: params.tenantId,
    userId: user.id,
  });
  await notifyAttendanceAlert({
    absentCount: params.records.filter((record) => record.status === "absent")
      .length,
    session,
  });

  return records;
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

export async function canCurrentUserMarkAttendance(params: {
  sessionId: string;
  studentIds?: string[];
  tenantId: string;
}) {
  const session = await getSessionById({
    sessionId: params.sessionId,
    tenantId: params.tenantId,
  });

  if (!session || session.status === "canceled") {
    return false;
  }

  try {
    await ensureCanManageAttendanceForSession(session, params.studentIds ?? []);
    return true;
  } catch {
    return false;
  }
}
