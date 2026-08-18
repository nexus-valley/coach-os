import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assignmentDateTimeLocalToIso,
  assignmentIsoToDateTimeLocal,
  buildAssignmentUpdateInput,
  changeAssignmentEditProgram,
  createAssignmentEditForm,
  getAssignmentEditCapability,
  getCohortsForAssignmentProgram,
  isAssignmentEditDirty,
  parseAssignmentMaxScore,
  validateAssignmentAttachmentUrls,
  type AssignmentEditCapability,
} from "../../src/lib/assignmentEditModel";
import {
  getAssignmentErrorKind,
  getSafeAssignmentError,
} from "../../src/lib/assignmentErrors";
import type { AssignmentWithRelations } from "../../src/lib/assignments";

const root = process.cwd();
const assignmentLibrary = readFileSync(join(root, "src/lib/assignments.ts"), "utf8");
const detailSource = readFileSync(
  join(root, "src/components/assignments/AssignmentDetailClient.tsx"),
  "utf8",
);
const dialogSource = readFileSync(
  join(root, "src/components/assignments/AssignmentEditDialog.tsx"),
  "utf8",
);
const submissionsSource = readFileSync(join(root, "src/lib/submissions.ts"), "utf8");

function assignment(
  values: Partial<AssignmentWithRelations> = {},
): AssignmentWithRelations {
  return {
    attachment_urls_json: ["https://example.com/original.pdf"],
    awaitingReviewCount: 0,
    cohort: { id: "cohort-a", name: "Cohort A" },
    cohort_id: "cohort-a",
    course: { id: "course-a", title: "Program A" },
    course_id: "course-a",
    created_at: "2026-08-18T05:00:00.000Z",
    created_by: "owner-a",
    description: "Description",
    due_at: "2026-08-20T10:15:30.000Z",
    id: "assignment-a",
    instructions: "Instructions",
    max_score: 100,
    status: "draft",
    submissionCounts: { late: 0, pending: 0, reviewed: 0, submitted: 0 },
    tenant_id: "tenant-a",
    title: "Assignment A",
    trainer_user_id: "trainer-a",
    updated_at: "2026-08-18T05:00:00.000Z",
    ...values,
  };
}

function capability(
  values: Partial<AssignmentEditCapability> = {},
): AssignmentEditCapability {
  return {
    canEdit: true,
    canEditAttachments: true,
    canEditContent: true,
    canEditDueAndMax: true,
    canEditRelationships: true,
    canRetargetTrainer: false,
    ...values,
  };
}

test.describe("UX-6D3 assignment edit operational workflow", () => {
  test("maps Draft, Published, and Closed field capabilities fail closed", () => {
    expect(
      getAssignmentEditCapability({
        canManage: true,
        canMoveRelationships: true,
        hasPersistedSubmissions: false,
        role: "owner",
        status: "draft",
      }),
    ).toEqual({
      canEdit: true,
      canEditAttachments: true,
      canEditContent: true,
      canEditDueAndMax: true,
      canEditRelationships: true,
      canRetargetTrainer: true,
    });

    expect(
      getAssignmentEditCapability({
        canManage: true,
        canMoveRelationships: true,
        hasPersistedSubmissions: false,
        role: "trainer",
        status: "published",
      }),
    ).toMatchObject({
      canEdit: true,
      canEditDueAndMax: true,
      canEditRelationships: false,
      canRetargetTrainer: false,
    });

    expect(
      getAssignmentEditCapability({
        canManage: true,
        canMoveRelationships: true,
        hasPersistedSubmissions: true,
        role: "admin",
        status: "published",
      }),
    ).toMatchObject({
      canEdit: true,
      canEditAttachments: true,
      canEditContent: true,
      canEditDueAndMax: false,
      canEditRelationships: false,
      canRetargetTrainer: false,
    });

    for (const status of ["closed", "invalid", null]) {
      expect(
        getAssignmentEditCapability({
          canManage: true,
          canMoveRelationships: true,
          hasPersistedSubmissions: false,
          role: "owner",
          status,
        }).canEdit,
      ).toBe(false);
    }
  });

  test("keeps trainer retargeting Owner/Admin Draft-only", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(
        getAssignmentEditCapability({
          canManage: true,
          canMoveRelationships: true,
          hasPersistedSubmissions: false,
          role,
          status: "draft",
        }).canRetargetTrainer,
      ).toBe(true);
    }

    for (const role of ["staff", "trainer"] as const) {
      expect(
        getAssignmentEditCapability({
          canManage: true,
          canMoveRelationships: true,
          hasPersistedSubmissions: false,
          role,
          status: "draft",
        }).canRetargetTrainer,
      ).toBe(false);
    }
  });

  test("preserves the exact stored trainer for scoped Staff and Trainer edits", () => {
    const current = assignment({ trainer_user_id: "trainer-a" });
    const form = { ...createAssignmentEditForm(current), title: "Updated title" };
    const input = buildAssignmentUpdateInput({
      assignment: current,
      capability: capability({ canRetargetTrainer: false }),
      form: { ...form, trainerUserId: "trainer-b" },
    });

    expect(input.trainerUserId).toBe("trainer-a");
    expect(input.title).toBe("Updated title");

    const unassigned = assignment({ trainer_user_id: null });
    expect(
      buildAssignmentUpdateInput({
        assignment: unassigned,
        capability: capability({ canRetargetTrainer: false }),
        form: {
          ...createAssignmentEditForm(unassigned),
          title: "Updated unassigned title",
          trainerUserId: "trainer-b",
        },
      }).trainerUserId,
    ).toBeNull();
  });

  test("supports Owner/Admin Draft retarget and Unassigned", () => {
    const current = assignment();
    const initial = createAssignmentEditForm(current);

    expect(
      buildAssignmentUpdateInput({
        assignment: current,
        capability: capability({ canRetargetTrainer: true }),
        form: { ...initial, trainerUserId: "trainer-b" },
      }).trainerUserId,
    ).toBe("trainer-b");
    expect(
      buildAssignmentUpdateInput({
        assignment: current,
        capability: capability({ canRetargetTrainer: true }),
        form: { ...initial, trainerUserId: "" },
      }).trainerUserId,
    ).toBeNull();
  });

  test("correlates cohorts to the selected Program and clears incompatible state", () => {
    const cohorts = [
      { course_id: "course-a", id: "cohort-a", name: "A" },
      { course_id: "course-b", id: "cohort-b", name: "B" },
    ];
    const form = createAssignmentEditForm(assignment());

    expect(getCohortsForAssignmentProgram(cohorts, "course-a")).toEqual([
      cohorts[0],
    ]);
    expect(changeAssignmentEditProgram(form, "course-b", cohorts)).toMatchObject({
      cohortId: "",
      courseId: "course-b",
    });
  });

  test("converts browser-local dates strictly and preserves clear as NULL", () => {
    const source = "2026-08-20T10:15:30.000Z";
    const local = assignmentIsoToDateTimeLocal(source);
    expect(assignmentDateTimeLocalToIso(local)).toBe(source);
    expect(assignmentDateTimeLocalToIso("")).toBeNull();
    expect(() => assignmentDateTimeLocalToIso("2026-02-31T10:00")).toThrow(
      "Due date must be a valid date and time.",
    );
  });

  test("accepts nullable, zero, and decimal scores but rejects negatives", () => {
    expect(parseAssignmentMaxScore("")).toBeNull();
    expect(parseAssignmentMaxScore("0")).toBe(0);
    expect(parseAssignmentMaxScore("12.5")).toBe(12.5);
    expect(() => parseAssignmentMaxScore("-0.01")).toThrow(
      "Maximum score must be a non-negative number.",
    );
  });

  test("preserves unchanged attachments and validates add/remove limits", () => {
    const current = assignment({
      attachment_urls_json: ["https://example.com/exact.pdf"],
    });
    const initial = createAssignmentEditForm(current);
    expect(
      buildAssignmentUpdateInput({
        assignment: current,
        capability: capability(),
        form: { ...initial, title: "Changed" },
      }).attachmentUrls,
    ).toEqual(["https://example.com/exact.pdf"]);
    expect(validateAssignmentAttachmentUrls(["https://example.com/new.pdf"])).toEqual([
      "https://example.com/new.pdf",
    ]);
    expect(() =>
      validateAssignmentAttachmentUrls(Array.from({ length: 11 }, () => "https://example.com")),
    ).toThrow("Add no more than 10 attachment links.");
    expect(() => validateAssignmentAttachmentUrls(["javascript:alert(1)"])).toThrow(
      "Attachment links must use HTTP or HTTPS",
    );
  });

  test("tracks dirty state without mutation on open", () => {
    const initial = createAssignmentEditForm(assignment());
    expect(isAssignmentEditDirty(initial, { ...initial })).toBe(false);
    expect(isAssignmentEditDirty(initial, { ...initial, title: "Changed" })).toBe(true);
  });

  test("normalizes edit races and invalid input without raw backend text", () => {
    const cutoff = {
      code: "22023",
      message: "Due date and max score cannot be changed after the first submission.",
    };
    const closed = { code: "22023", message: "Closed assignments cannot be edited." };
    const frozen = {
      code: "22023",
      message: "Program, cohort, and trainer cannot be changed after publication.",
    };

    expect(getAssignmentErrorKind(cutoff)).toBe("submission_cutoff");
    expect(getSafeAssignmentError(cutoff)).toContain("Submission activity started");
    expect(getAssignmentErrorKind(closed)).toBe("lifecycle_changed");
    expect(getAssignmentErrorKind(frozen)).toBe("relationship_frozen");
    expect(getSafeAssignmentError({ code: "22023", message: "Invalid cohort" })).toBe(
      "Review the assignment fields and try again.",
    );
    expect(
      getSafeAssignmentError({
        code: "22023",
        message: "Selected trainer is not available in this workspace.",
      }),
    ).toBe("Review the assignment fields and try again.");
    expect(
      getSafeAssignmentError({
        code: "22023",
        message: "Course not found in this workspace.",
      }),
    ).toBe("Review the assignment fields and try again.");
    expect(
      getSafeAssignmentError({
        code: "22023",
        message: "Cohort not found in this workspace.",
      }),
    ).toBe("Review the assignment fields and try again.");
    expect(
      getSafeAssignmentError({
        code: "22023",
        message: "Cohort does not belong to the selected course.",
      }),
    ).toBe("Review the assignment fields and try again.");
    expect(
      getSafeAssignmentError({
        code: "22023",
        message: "Assignment not found in this workspace.",
      }),
    ).toBe("Assignment unavailable.");
  });

  test("uses one secure RPC call and never substitutes auth.uid during update", () => {
    const updateHelper = assignmentLibrary.slice(
      assignmentLibrary.indexOf("export async function updateAssignment("),
      assignmentLibrary.indexOf("async function updateAssignmentStatus("),
    );

    expect(updateHelper).toContain('.rpc("update_assignment_secure"');
    expect(updateHelper).toContain("p_trainer_user_id: trainerUserId");
    expect(updateHelper).toContain(
      "const trainerUserId = input.trainerUserId?.trim() || null;",
    );
    expect(updateHelper).not.toContain('role === "trainer"');
    expect(updateHelper).not.toMatch(/\.from\("assignments"\)[\s\S]*?\.update\(/);
    expect((detailSource.match(/await updateAssignment\(input\)/g) ?? [])).toHaveLength(1);
  });

  test("uses the exact persisted-submission signal and canonical refresh races", () => {
    expect(submissionsSource).toContain(
      "hasPersistedSubmissions: submissions.length > 0",
    );
    expect(detailSource).toContain("setHasPersistedSubmissions(data.hasPersistedSubmissions)");
    expect(detailSource).toContain("await refresh()");
    expect(dialogSource).toContain('kind === "submission_cutoff"');
    expect(dialogSource).toContain('kind === "lifecycle_changed"');
    expect(dialogSource).not.toContain("retry");
  });

  test("loads selectors only in editable modes and keeps Trainer options Owner/Admin-only", () => {
    expect(dialogSource).toContain(
      "if (!capability.canEditRelationships && !capability.canRetargetTrainer)",
    );
    expect(dialogSource).toContain("getCoursesForTenant(assignment.tenant_id)");
    expect(dialogSource).toContain("getCohortsForTenant(assignment.tenant_id)");
    expect(dialogSource).toContain("capability.canRetargetTrainer");
    expect(dialogSource).toContain("getTenantMembers(assignment.tenant_id)");
    expect(dialogSource).not.toContain("auth.users");
    expect(dialogSource).not.toContain("service_role");
  });

  test("renders frozen Published context and accessible mobile-bounded dialog controls", () => {
    expect(dialogSource).toContain('role="dialog"');
    expect(dialogSource).toContain('aria-modal="true"');
    expect(dialogSource).toContain('event.key === "Escape"');
    expect(dialogSource).toContain("previousFocus?.focus()");
    expect(dialogSource).toContain("100dvh");
    expect(dialogSource).toContain("overflow-y-auto");
    expect(dialogSource).toContain("Program, cohort, and trainer cannot be changed after publishing.");
    expect(dialogSource).toContain("Current due date");
    expect(dialogSource).toContain("Current maximum score");
    expect(dialogSource).toContain("Due date and maximum score can no longer be changed after submission activity.");
    expect(dialogSource).toContain('disabled={!dirty || saving}');
    expect(dialogSource).toContain('step="0.01"');
  });
});
