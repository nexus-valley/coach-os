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
