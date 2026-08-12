import type { StudentStatus } from "@/src/lib/students";

type EnrollmentEvidence = {
  status: "active" | "cancelled" | "completed" | "paused";
  student_id: string;
};

type RosterRecord = {
  student_id: string;
};

type RosterStudent = {
  id: string;
  status: StudentStatus;
};

export type AttendanceDraftStatus =
  | "absent"
  | "excused"
  | "late"
  | "present";

export type AttendanceDraftValue = {
  remarks: string;
  status: AttendanceDraftStatus | null;
};

export type AttendanceDraftState = Record<string, AttendanceDraftValue>;

export function updateAttendanceDraft(params: {
  baseline: AttendanceDraftValue;
  current: AttendanceDraftState;
  next: AttendanceDraftValue;
  studentId: string;
}) {
  const updated = { ...params.current };
  const restored =
    params.next.status === params.baseline.status &&
    params.next.remarks === params.baseline.remarks;

  if (restored) {
    delete updated[params.studentId];
  } else {
    updated[params.studentId] = params.next;
  }

  return updated;
}

export function getChangedAttendanceRecords(draft: AttendanceDraftState) {
  const entries = Object.entries(draft);
  const records = entries.flatMap(([studentId, value]) =>
    value.status
      ? [{ remarks: value.remarks, status: value.status, studentId }]
      : [],
  );

  return {
    hasUnmarkedChange: records.length !== entries.length,
    records,
  };
}

export function getNewAttendanceRelationshipStudentIds(params: {
  cohortMemberIds?: Iterable<string>;
  enrollments: EnrollmentEvidence[];
}) {
  const cohortMemberIds = params.cohortMemberIds
    ? new Set(params.cohortMemberIds)
    : null;

  return new Set(
    params.enrollments
      .filter(
        (enrollment) =>
          enrollment.status === "active" &&
          (!cohortMemberIds || cohortMemberIds.has(enrollment.student_id)),
      )
      .map((enrollment) => enrollment.student_id),
  );
}

export function composeAttendanceRoster<
  TRecord extends RosterRecord,
  TStudent extends RosterStudent,
>(params: {
  records: TRecord[];
  relationshipEligibleStudentIds: Iterable<string>;
  sessionStatus: "canceled" | "completed" | "scheduled";
  students: TStudent[];
}) {
  const relationshipEligibleStudentIds = new Set(
    params.relationshipEligibleStudentIds,
  );
  const recordByStudentId = new Map(
    params.records.map((record) => [record.student_id, record]),
  );

  return params.students.flatMap((student) => {
    const record = recordByStudentId.get(student.id) ?? null;
    const isNewAttendanceEligible =
      params.sessionStatus !== "canceled" &&
      student.status === "active" &&
      relationshipEligibleStudentIds.has(student.id);

    if (!record && !isNewAttendanceEligible) {
      return [];
    }

    return [
      {
        hasExistingAttendance: Boolean(record),
        isNewAttendanceEligible,
        record,
        student,
      },
    ];
  });
}
