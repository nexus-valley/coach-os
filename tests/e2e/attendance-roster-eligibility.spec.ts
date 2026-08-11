import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  composeAttendanceRoster,
  getNewAttendanceRelationshipStudentIds,
} from "../../src/lib/attendanceRoster";
import type { StudentStatus } from "../../src/lib/students";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function student(id: string, status: StudentStatus = "active") {
  return {
    email: `${id}@example.test`,
    full_name: `Student ${id}`,
    id,
    phone: null,
    status,
  };
}

function attendance(studentId: string) {
  return {
    created_at: "2026-08-01T09:00:00.000Z",
    id: `attendance-${studentId}`,
    marked_at: "2026-08-01T09:00:00.000Z",
    marked_by: "member-1",
    remarks: null,
    session_id: "session-1",
    status: "present",
    student_id: studentId,
    tenant_id: "tenant-1",
  };
}

test.describe("UX-5B1 attendance roster compatibility", () => {
  test("program-wide candidates require an active enrollment", () => {
    const eligible = getNewAttendanceRelationshipStudentIds({
      enrollments: [
        { status: "active", student_id: "active" },
        { status: "paused", student_id: "paused" },
        { status: "completed", student_id: "completed" },
        { status: "cancelled", student_id: "cancelled" },
      ],
    });

    expect([...eligible]).toEqual(["active"]);
  });

  test("cohort candidates require exact membership and active enrollment", () => {
    const eligible = getNewAttendanceRelationshipStudentIds({
      cohortMemberIds: ["eligible", "member-without-active-enrollment"],
      enrollments: [
        { status: "active", student_id: "eligible" },
        {
          status: "paused",
          student_id: "member-without-active-enrollment",
        },
        { status: "active", student_id: "active-outside-cohort" },
      ],
    });

    expect([...eligible]).toEqual(["eligible"]);
  });

  test("new rows require an active student as well as relationship eligibility", () => {
    const roster = composeAttendanceRoster({
      records: [],
      relationshipEligibleStudentIds: ["active", "inactive", "blocked", "lead"],
      sessionStatus: "scheduled",
      students: [
        student("active"),
        student("inactive", "inactive"),
        student("blocked", "blocked"),
        student("lead", "lead"),
      ],
    });

    expect(roster.map((item) => item.student.id)).toEqual(["active"]);
    expect(roster[0]).toMatchObject({
      hasExistingAttendance: false,
      isNewAttendanceEligible: true,
    });
  });

  test("persisted attendance remains visible and correctable after eligibility changes", () => {
    const students = [
      student("paused"),
      student("completed"),
      student("cancelled"),
      student("inactive", "inactive"),
      student("blocked", "blocked"),
    ];
    const roster = composeAttendanceRoster({
      records: students.map((item) => attendance(item.id)),
      relationshipEligibleStudentIds: [],
      sessionStatus: "completed",
      students,
    });

    expect(roster.map((item) => item.student.id)).toEqual([
      "paused",
      "completed",
      "cancelled",
      "inactive",
      "blocked",
    ]);
    expect(
      roster.every(
        (item) =>
          item.hasExistingAttendance && !item.isNewAttendanceEligible,
      ),
    ).toBe(true);
  });

  test("canceled sessions preserve history but exclude every new candidate", () => {
    const roster = composeAttendanceRoster({
      records: [attendance("historical")],
      relationshipEligibleStudentIds: ["historical", "new-candidate"],
      sessionStatus: "canceled",
      students: [student("historical"), student("new-candidate")],
    });

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      hasExistingAttendance: true,
      isNewAttendanceEligible: false,
      student: { id: "historical" },
    });
  });

  test("loads exact relationship evidence in bounded batches without cohort expansion", () => {
    const source = read("src/lib/attendance.ts");

    expect(source).toContain('.from("attendance_records")');
    expect(source).toContain('.eq("session_id", params.sessionId)');
    expect(source).toContain('.from("cohort_members")');
    expect(source).toContain('.eq("cohort_id", session.cohort_id)');
    expect(source).toContain('.eq("course_id", cohort.course_id)');
    expect(source).toContain('.in("student_id", memberIds)');
    expect(source).toContain('.in("id", studentIds)');
    expect(source).not.toContain("getEnrollmentsForCourse");
    expect(source).not.toMatch(/for\s*\([^)]*student[^)]*\)[\s\S]*?\.from\(/i);
  });

  test("saves only eligible candidates or persisted historical rows through secure RPCs", () => {
    const attendanceSource = read("src/lib/attendance.ts");
    const componentSource = read(
      "src/components/sessions/SessionDetailClient.tsx",
    );

    expect(componentSource).toContain(
      "item.hasExistingAttendance || item.isNewAttendanceEligible",
    );
    expect(attendanceSource).toContain(
      "!existingStudentIds.has(studentId)",
    );
    expect(attendanceSource).toContain(
      "relationshipEligibleStudentIds.has(studentId)",
    );
    expect(attendanceSource).toContain('.rpc("mark_attendance_secure"');
    expect(attendanceSource).toContain('.rpc("bulk_mark_attendance_secure"');
    expect(attendanceSource).toContain('.rpc("mark_delegated_attendance"');
    expect(attendanceSource).not.toMatch(
      /\.from\("attendance_records"\)[\s\S]{0,240}\.(insert|update|delete)\(/,
    );
  });

  test("keeps canceled attendance read-only and maps failures to safe copy", () => {
    const attendanceSource = read("src/lib/attendance.ts");
    const componentSource = read(
      "src/components/sessions/SessionDetailClient.tsx",
    );

    expect(attendanceSource).toContain(
      'session.status === "canceled"',
    );
    expect(attendanceSource).toContain(
      "Attendance is read-only for canceled live classes.",
    );
    expect(componentSource).toContain(
      'canMarkEffective && session?.status !== "canceled"',
    );
    expect(componentSource).toContain("Existing attendance remains available");
    expect(componentSource).toContain("safeMessages.has(message)");
    expect(componentSource).not.toContain(
      "return caught instanceof Error ? caught.message",
    );
  });

  test("retains effective role checks and avoids portal or reports scope changes", () => {
    const attendanceSource = read("src/lib/attendance.ts");

    expect(attendanceSource).toContain("ensureCanManageAttendanceForSession(");
    expect(attendanceSource).toContain("getDelegatedAttendanceDecision({");
    expect(attendanceSource).toContain("canManageAttendance(role)");
    expect(attendanceSource).toContain("getSessionById({");
    expect(attendanceSource).not.toContain("student_portal_access_allowed");
    expect(attendanceSource).not.toContain("get_reports_center_data");
  });
});
