import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getAssignmentDetailLifecycleUi } from "../../src/lib/assignmentDetailLifecycle";

const detailSource = readFileSync(
  join(
    process.cwd(),
    "src/components/assignments/AssignmentDetailClient.tsx",
  ),
  "utf8",
);

test.describe("UX-6B1 assignment detail lifecycle UI", () => {
  test("maps every supported lifecycle state to the backend contract", () => {
    expect(getAssignmentDetailLifecycleUi("draft")).toEqual({
      canCaptureSubmission: false,
      canClose: false,
      canPublish: true,
      canReview: false,
    });
    expect(getAssignmentDetailLifecycleUi("published")).toEqual({
      canCaptureSubmission: true,
      canClose: true,
      canPublish: false,
      canReview: true,
    });
    expect(getAssignmentDetailLifecycleUi("closed")).toEqual({
      canCaptureSubmission: false,
      canClose: false,
      canPublish: false,
      canReview: true,
    });
  });

  test("fails closed for unknown, null, and missing status values", () => {
    for (const status of ["reopened", "", null, undefined]) {
      expect(getAssignmentDetailLifecycleUi(status)).toEqual({
        canCaptureSubmission: false,
        canClose: false,
        canPublish: false,
        canReview: false,
      });
    }
  });

  test("composes lifecycle state with existing role and delegation checks", () => {
    expect(detailSource).toContain(
      "const canPublish = canManage && lifecycleUi.canPublish;",
    );
    expect(detailSource).toContain(
      "const canClose = canManage && lifecycleUi.canClose;",
    );
    expect(detailSource).toMatch(
      /\(currentRole === "owner" \|\| currentRole === "admin"\) &&\s+lifecycleUi\.canCaptureSubmission/,
    );
    expect(detailSource).toContain(
      "const canReviewSubmission = canReviewEffective && lifecycleUi.canReview;",
    );
    expect(detailSource).not.toContain('assignment.status !== "published"');
    expect(detailSource).not.toContain('assignment.status !== "closed"');
  });

  test("guards stale handlers before calling secure mutation helpers", () => {
    expect(detailSource).toContain("if (!transitionAllowed)");
    expect(detailSource).toContain("if (!tenant || !canCreateSubmission)");
    expect(detailSource).toContain("if (!tenant || !canReviewSubmission)");
    expect(detailSource).toContain("await publishAssignment(");
    expect(detailSource).toContain("await closeAssignment(");
    expect(detailSource).toContain("await submitAssignment(");
    expect(detailSource).toContain("await reviewSubmission(");
  });

  test("renders unavailable submission and review data without mutation controls", () => {
    expect(detailSource).toMatch(
      /\{canCreateSubmission \? \([\s\S]*?<textarea[\s\S]*?No submission recorded\./,
    );
    expect(detailSource).toMatch(
      /\{canReviewSubmission \? \([\s\S]*?<input[\s\S]*?No feedback recorded\./,
    );
    expect(detailSource).not.toContain("updateAssignment(");
    expect(detailSource).not.toContain('currentRole === "student"');
    expect(detailSource).not.toContain("/portal");
  });
});
