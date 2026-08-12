import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyOperationalSessions,
  formatSessionDateTimeLocal,
  sessionWallClockToIso,
} from "../../src/lib/sessionDateTime";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

type TestSession = {
  id: string;
  scheduled_start_at: string;
  status: "canceled" | "completed" | "scheduled";
};

function session(
  id: string,
  status: TestSession["status"],
  scheduledStartAt: string,
): TestSession {
  return {
    id,
    scheduled_start_at: scheduledStartAt,
    status,
  };
}

test.describe("UX-5C session and attendance operational workflow", () => {
  test("converts wall-clock values using the selected session timezone", () => {
    expect(sessionWallClockToIso("2026-08-12T10:30", "Asia/Kolkata")).toBe(
      "2026-08-12T05:00:00.000Z",
    );
    expect(
      formatSessionDateTimeLocal("2026-08-12T05:00:00.000Z", "Asia/Kolkata"),
    ).toBe("2026-08-12T10:30");
    expect(
      sessionWallClockToIso("2026-07-15T10:30", "America/New_York"),
    ).toBe("2026-07-15T14:30:00.000Z");
  });

  test("fails closed for invalid, missing, and ambiguous local times", () => {
    expect(() => sessionWallClockToIso("not-a-date", "Asia/Kolkata")).toThrow(
      "Enter a valid date and time.",
    );
    expect(() =>
      sessionWallClockToIso("2026-03-08T02:30", "America/New_York"),
    ).toThrow("does not exist");
    expect(() =>
      sessionWallClockToIso("2026-11-01T01:30", "America/New_York"),
    ).toThrow("occurs twice");
  });

  test("organizes a bounded list with operational filters and empty states", () => {
    const component = read("src/components/sessions/SessionsPageClient.tsx");
    const sessions = read("src/lib/sessions.ts");

    for (const label of [
      "Upcoming",
      "Past due / needs attention",
      "Completed",
      "Canceled",
    ]) {
      expect(component).toContain(label);
    }
    expect(component).toContain("Search title");
    expect(component).toContain("All programs");
    expect(component).toContain("All cohorts");
    expect(component).toContain("No matching live classes");
    expect(component).toContain(
      "getOperationalSessionsForTenant(currentTenant.id, 200)",
    );
    expect(component).toContain("groupSessions(filteredSessions)");
    expect(sessions).toContain(".limit(Math.max(1, Math.min(limit, 500)))");
    expect(sessions).toContain(".limit(upcomingLimit)");
    expect(sessions).toContain(".limit(groupLimit)");
    expect(sessions).toContain(".limit(canceledLimit)");
  });

  test("classifies each session once and orders operational groups correctly", () => {
    const now = new Date("2026-08-12T12:00:00.000Z").getTime();
    const groups = classifyOperationalSessions(
      [
        session("upcoming-later", "scheduled", "2026-08-14T12:00:00.000Z"),
        session("completed-old", "completed", "2026-08-01T12:00:00.000Z"),
        session("past-due-new", "scheduled", "2026-08-11T12:00:00.000Z"),
        session("canceled-new", "canceled", "2026-08-10T12:00:00.000Z"),
        session("upcoming-near", "scheduled", "2026-08-13T12:00:00.000Z"),
        session("completed-new", "completed", "2026-08-09T12:00:00.000Z"),
        session("past-due-old", "scheduled", "2026-08-02T12:00:00.000Z"),
      ],
      now,
    );

    expect(groups.upcoming.map((item) => item.id)).toEqual([
      "upcoming-near",
      "upcoming-later",
    ]);
    expect(groups.pastDue.map((item) => item.id)).toEqual([
      "past-due-new",
      "past-due-old",
    ]);
    expect(groups.completed.map((item) => item.id)).toEqual([
      "completed-new",
      "completed-old",
    ]);
    expect(groups.canceled.map((item) => item.id)).toEqual(["canceled-new"]);
    expect(
      new Set(Object.values(groups).flat().map((item) => item.id)).size,
    ).toBe(7);
  });

  test("keeps program and cohort selection correlated in create and edit", () => {
    const form = read("src/components/sessions/SessionForm.tsx");
    const list = read("src/components/sessions/SessionsPageClient.tsx");
    const detail = read("src/components/sessions/SessionDetailClient.tsx");

    expect(form).toContain("cohort?.course_id === courseId");
    expect(form).toContain("cohorts.filter((cohort) => cohort.course_id === form.courseId)");
    expect(form).toContain("courseId: cohort?.course_id ?? form.courseId");
    expect(list).toContain("selectedCohort.course_id !== form.courseId");
    expect(detail).toContain("selectedCohort.course_id !== editForm.courseId");
  });

  test("requires explicit lifecycle confirmation and management capability", () => {
    const detail = read("src/components/sessions/SessionDetailClient.tsx");

    expect(detail).toContain("canCurrentUserManageSession({");
    expect(detail).toContain('setLifecycleAction("completed")');
    expect(detail).toContain('setLifecycleAction("canceled")');
    expect(detail).toContain("confirmLifecycle");
    expect(detail).toContain('Confirm {lifecycleAction === "completed" ? "completion" : "cancellation"}');
    expect(detail).toContain('session.status === "scheduled"');
    expect(detail).toContain('session.status === "completed"');
    expect(detail).not.toMatch(/onClick=\{\(\) => (completeSession|cancelSession)/);
  });

  test("gates contextual Trainer links by exact direct assignments", () => {
    const detail = read("src/components/sessions/SessionDetailClient.tsx");

    expect(detail).toContain("getCurrentTrainerScope(currentTenant.id)");
    expect(detail).toContain("trainerCourseIds.includes(session.course_id)");
    expect(detail).toContain("trainerCohortIds.includes(session.cohort_id)");
    expect(detail).toContain("canOpenProgram ? <Link");
    expect(detail).toContain("canOpenCohort ? <Link");
  });

  test("uses explicit unmarked drafts and submits changed rows only", () => {
    const detail = read("src/components/sessions/SessionDetailClient.tsx");

    expect(detail).toContain('status: item.record?.status ?? null');
    expect(detail).toContain("Unmarked");
    expect(detail).toContain("getChangedAttendanceRecords(draft)");
    expect(detail).toContain("dirtyCount");
    expect(detail).toContain("Only explicit changes are saved");
    expect(detail).not.toContain('status: item.record?.status ?? "present"');
  });

  test("separates current roster from persisted historical attendance", () => {
    const detail = read("src/components/sessions/SessionDetailClient.tsx");

    expect(detail).toContain("roster.filter((item) => item.isNewAttendanceEligible)");
    expect(detail).toContain(
      "roster.filter((item) => item.hasExistingAttendance && !item.isNewAttendanceEligible)",
    );
    expect(detail).toContain("Completed classes allow authorized correction");
    expect(detail).toContain("canceled classes are read-only");
  });

  test("routes delegated correction through the narrow installed RPC", () => {
    const sessions = read("src/lib/sessions.ts");
    const correction = sessions.slice(sessions.indexOf("export async function updateMeetingDetails"));

    expect(sessions).toContain('.rpc("update_delegated_session_meeting_details"');
    expect(correction).toContain("updateDelegatedSessionMeetingDetailsWithRpc({");
    expect(correction).not.toContain("updateDelegatedSessionWithRpc(");
  });

  test("renders canceled portal history without links and uses delivery-aware copy", () => {
    const portal = read("src/components/portal/StudentPortalSessions.tsx");
    const portalData = read("src/lib/studentPortal.ts");

    expect(portal).toContain("Canceled classes");
    expect(portal).toContain("Meeting and recording links are not available");
    expect(portal).toContain("This class is delivered offline");
    expect(portal).toContain("Program: {session.course.title}");
    expect(portal).toContain("Cohort: {session.cohort.name}");
    expect(portal).toContain(
      'session.status === "completed" && session.recording_url',
    );
    expect(portal).toContain(
      'renderSession(session, "muted", { allowJoin: false })',
    );
    expect(portalData).toContain('session.status === "canceled"');
  });

  test("retains RPC-only mutations and passive capability checks", () => {
    const sessions = read("src/lib/sessions.ts");
    const attendance = read("src/lib/attendance.ts");
    const detail = read("src/components/sessions/SessionDetailClient.tsx");

    expect(sessions).not.toMatch(/\.from\("sessions"\)[\s\S]{0,240}\.(insert|update|delete)\(/);
    expect(attendance).not.toMatch(/\.from\("attendance_records"\)[\s\S]{0,240}\.(insert|update|delete)\(/);
    expect(detail).not.toContain("record_audit_event_secure");
    expect(detail).toContain("canCurrentUserMarkAttendance({");
    expect(detail).toContain("canCurrentUserManageSession({");
  });

  test("uses accessible mobile-safe dialogs and roster controls", () => {
    const form = read("src/components/sessions/SessionForm.tsx");
    const detail = read("src/components/sessions/SessionDetailClient.tsx");

    expect(form).toContain('role="dialog"');
    expect(form).toContain('aria-modal="true"');
    expect(form).toContain('event.key === "Escape"');
    expect(form).toContain("100dvh");
    expect(detail).toContain("sticky bottom-3");
    expect(detail).toContain('aria-label={`Attendance status for');
  });
});
