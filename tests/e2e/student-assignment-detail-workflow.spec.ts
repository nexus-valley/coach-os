import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatStudentAssignmentDateTime,
  getSafeStudentAttachmentUrls,
  getStudentAssignmentViewModel,
} from "../../src/lib/studentAssignmentModel";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const detail = read(
  "src/components/portal/StudentPortalAssignmentDetail.tsx",
);
const helper = read("src/lib/studentPortalAssignments.ts");
const list = read("src/components/portal/StudentPortalAssignments.tsx");
const dashboard = read("src/components/portal/StudentPortalDashboard.tsx");
const layout = read("src/components/portal/StudentPortalLayout.tsx");
const route = read("app/portal/assignments/[assignmentId]/page.tsx");

const future = "2026-08-20T12:00:00.000Z";
const past = "2026-08-01T12:00:00.000Z";
const now = new Date("2026-08-12T12:00:00.000Z");
const submitted = {
  reviewed_at: null,
  status: "submitted" as const,
  submitted_at: "2026-08-10T12:00:00.000Z",
};

test.describe("UX-6C Student assignment detail workflow", () => {
  test("fails closed for draft, unknown, and missing assignment status", () => {
    for (const status of ["draft", "reopened", null, undefined]) {
      expect(
        getStudentAssignmentViewModel({
          dueAt: future,
          now,
          status,
          submission: null,
        }),
      ).toMatchObject({ canSubmit: false, state: "unavailable" });
    }
  });

  test("distinguishes published open and overdue-open presentation", () => {
    expect(
      getStudentAssignmentViewModel({
        dueAt: future,
        now,
        status: "published",
        submission: null,
      }),
    ).toMatchObject({ canSubmit: true, label: "Open", state: "open" });
    expect(
      getStudentAssignmentViewModel({
        dueAt: past,
        now,
        status: "published",
        submission: null,
      }),
    ).toMatchObject({
      canSubmit: true,
      label: "Overdue, still open",
      state: "overdue_open",
    });
  });

  test("uses persisted submission and review state as authoritative evidence", () => {
    expect(
      getStudentAssignmentViewModel({
        dueAt: future,
        now,
        status: "published",
        submission: submitted,
      }),
    ).toMatchObject({ state: "submitted", hasReview: false });
    expect(
      getStudentAssignmentViewModel({
        dueAt: past,
        now,
        status: "published",
        submission: { ...submitted, status: "late" },
      }),
    ).toMatchObject({ isLate: true, state: "submitted_late" });
    expect(
      getStudentAssignmentViewModel({
        dueAt: past,
        now,
        status: "published",
        submission: {
          ...submitted,
          reviewed_at: "2026-08-11T12:00:00.000Z",
          status: "reviewed",
        },
      }),
    ).toMatchObject({ canSubmit: true, hasReview: true, state: "reviewed" });
  });

  test("models every closed assignment as read-only current history", () => {
    expect(
      getStudentAssignmentViewModel({
        now,
        status: "closed",
        submission: null,
      }),
    ).toMatchObject({ canSubmit: false, state: "closed_missed" });
    expect(
      getStudentAssignmentViewModel({
        now,
        status: "closed",
        submission: submitted,
      }),
    ).toMatchObject({ canSubmit: false, state: "closed_submitted" });
    expect(
      getStudentAssignmentViewModel({
        now,
        status: "closed",
        submission: {
          ...submitted,
          reviewed_at: "2026-08-11T12:00:00.000Z",
          status: "reviewed",
        },
      }),
    ).toMatchObject({
      canSubmit: false,
      hasReview: true,
      state: "closed_reviewed",
    });
  });

  test("allows read-only http attachments and rejects unsafe schemes", () => {
    expect(
      getSafeStudentAttachmentUrls([
        "https://example.com/brief.pdf",
        "http://example.com/reference",
        "javascript:alert(1)",
        "data:text/plain,secret",
        "not-a-url",
        null,
      ]),
    ).toEqual([
      "https://example.com/brief.pdf",
      "http://example.com/reference",
    ]);
    expect(detail).toContain('rel="noopener noreferrer"');
    expect(detail).toContain('target="_blank"');
    expect(detail).not.toContain("uploadDocumentFile");
  });

  test("adds a guarded Student detail route without coach detail reuse", () => {
    expect(route).toContain("StudentPortalGuard");
    expect(route).toContain("StudentPortalLayout");
    expect(route).toContain("StudentPortalAssignmentDetail");
    expect(route).not.toContain("AssignmentDetailClient");
    expect(route).not.toContain("AppShell");
    expect(layout).toContain(
      '{ href: "/portal/assignments", label: "Assignments" }',
    );
  });

  test("loads only published or closed assignments and the linked Student submission", () => {
    expect(helper).toContain('.in("status", ["published", "closed"])');
    expect(helper).toContain('.eq("assignment_id", assignmentId)');
    expect(helper).toContain('.eq("student_id", studentId)');
    expect(helper).toContain('.eq("tenant_id", tenantId)');
    expect(helper).not.toContain("getAssignmentSubmissionRoster");
    expect(helper).not.toContain('.from("students")');
    expect(helper).not.toContain("trainer_user_id");
  });

  test("keeps Student identity context-bound and submission mutation RPC-only", () => {
    const submitSignature = helper.match(
      /export async function submitStudentAssignment\(params: \{([\s\S]*?)\n\}\)/,
    )?.[1];

    expect(submitSignature).toBeTruthy();
    expect(submitSignature).toContain("context: StudentPortalContext");
    expect(submitSignature).not.toContain("studentId:");
    expect(helper).toContain('.rpc("submit_assignment_secure"');
    expect(helper).toContain("p_student_id: studentId");
    expect(helper).not.toMatch(
      /\.from\("assignment_submissions"\)[\s\S]{0,200}\.(?:insert|update|delete|upsert)\(/,
    );
  });

  test("links list and published dashboard items to Student detail", () => {
    expect(list).toContain("getStudentAssignments(context)");
    expect(list).toContain("/portal/assignments/${item.assignment.id}");
    expect(dashboard).toContain(
      "/portal/assignments/${nextAssignment.assignment.id}",
    );
    expect(dashboard).toContain(
      "/portal/assignments/${assignment.assignment.id}",
    );
    expect(dashboard).toContain("overview.assignments[0]");
  });

  test("renders one current submission and gates mutation on published state", () => {
    expect(detail).toContain("Current submission");
    expect(detail).not.toContain("Submission history");
    expect(detail).toContain("view.canSubmit ? (");
    expect(detail).toContain("Submit assignment");
    expect(detail).toContain("Resubmit assignment");
    expect(detail).toContain("Only your current submission is retained.");
    expect(detail).toContain("Assignment closed - no submission recorded.");
  });

  test("requires dirty resubmission and warns when review will be cleared", () => {
    expect(detail).toContain(
      "submissionText.trim() !== initialText.trim()",
    );
    expect(detail).toContain("!nativeSelectionDirty");
    expect(detail).toContain("!nativeWorkspaceReady");
    expect(detail).toContain("nativeFilesBusy");
    expect(detail).toContain(
      "Resubmit this assignment? Your current submission will be replaced.",
    );
    expect(detail).toContain(
      "clear the existing score and feedback until your coach reviews it again.",
    );
    expect(detail).toContain('role="dialog"');
    expect(detail).toContain('aria-modal="true"');
  });

  test("reloads stale detail after a rejected submit and shows safe errors", () => {
    expect(detail).toMatch(/catch \(caught\)[\s\S]*?await loadDetail\(\)/);
    expect(detail).toContain(
      "This assignment has been closed and can no longer accept submissions.",
    );
    expect(helper).toContain(
      '"Unable to load this assignment right now. Please try again."',
    );
    expect(detail).not.toMatch(/caught\.message|error\.message/);
  });

  test("uses accessible mobile-safe controls and local-time wording", () => {
    expect(detail).toContain('htmlFor="student-assignment-submission"');
    expect(detail).toContain('id="student-assignment-submission"');
    expect(detail).toContain("Back to My Assignments");
    expect(formatStudentAssignmentDateTime(future)).toContain(
      "(your local time)",
    );
    expect(detail).toContain("flex flex-col-reverse gap-3 sm:flex-row");
    expect(detail).not.toMatch(/min-w-\[[^\]]+\]|w-\[[5-9][0-9]{2}px\]/);
  });
});
