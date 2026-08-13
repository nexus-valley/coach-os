import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getSafeAssignmentError } from "../../src/lib/assignmentErrors";
import {
  delegatedPermissionMatchesAssignment,
  filterAssignmentReviewRoster,
  getAssignmentReviewPresentation,
  getNextAwaitingReviewStudentId,
} from "../../src/lib/assignmentReviewModel";
import type { DelegatedPermission } from "../../src/lib/delegatedPermissions";
import type {
  AssignmentRosterItem,
  AssignmentSubmission,
} from "../../src/lib/submissions";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const assignments = read("src/lib/assignments.ts");
const submissions = read("src/lib/submissions.ts");
const list = read("src/components/assignments/AssignmentsPageClient.tsx");
const detail = read("src/components/assignments/AssignmentDetailClient.tsx");

function submission(
  studentId: string,
  status: AssignmentSubmission["status"],
): AssignmentSubmission {
  return {
    assignment_id: "assignment-1",
    attachment_urls_json: [],
    created_at: "2026-01-01T00:00:00Z",
    feedback: null,
    id: `submission-${studentId}`,
    reviewed_at: status === "reviewed" ? "2026-01-03T00:00:00Z" : null,
    reviewed_by: null,
    score: null,
    status,
    student_id: studentId,
    submission_text: "Work",
    submitted_at: "2026-01-02T00:00:00Z",
    submitted_by: studentId,
    tenant_id: "tenant-1",
    updated_at: "2026-01-02T00:00:00.123456Z",
  };
}

function rosterItem(
  id: string,
  status: AssignmentSubmission["status"] | null,
): AssignmentRosterItem {
  return {
    student: {
      email: `${id}@example.test`,
      full_name: id,
      id,
      phone: null,
      status: "active",
    },
    submission: status ? submission(id, status) : null,
  };
}

function permission(
  scopeType: DelegatedPermission["scope_type"],
  scopeId: string | null,
): DelegatedPermission {
  return {
    approved_by: null,
    created_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    granted_by: null,
    id: "permission-1",
    metadata_json: {},
    permission_key: "review_assignments",
    reason: null,
    revoked_at: null,
    revoked_by: null,
    scope_id: scopeId,
    scope_type: scopeType,
    starts_at: "2026-01-01T00:00:00Z",
    status: "active",
    tenant_id: "tenant-1",
    updated_at: "2026-01-01T00:00:00Z",
    user_id: "user-1",
  };
}

test.describe("UX-6D2 coach assignment operations", () => {
  test("hard-bounds assignment pages and returns pagination metadata", () => {
    expect(assignments).toContain("export const assignmentListDefaultPageSize = 24");
    expect(assignments).toContain("export const assignmentListMaximumPageSize = 50");
    expect(assignments).toContain(".range(start, start + pageSize - 1)");
    expect(assignments).toContain("Number.isSafeInteger(value)");
    expect(assignments).toContain("if (page > totalPages)");
    expect(assignments).toContain("page: totalPages");
    expect(assignments).toContain('select(assignmentNeedsReviewColumns, { count: "exact" })');
    expect(assignments).toContain("hasNext: page < totalPages");
  });

  test("supports bounded server search, filters, review queue, and stable sorting", () => {
    expect(assignments).toContain('value.replace(/[\\\\%_]/g, "\\\\$&")');
    expect(assignments).toContain('.ilike("title", `%${escapeIlikePattern(search)}%`)');
    expect(assignments).toContain('query = query.eq("status", options.status)');
    expect(assignments).toContain('query = query.eq("course_id", options.courseId)');
    expect(assignments).toContain('query = query.in("assignment_submissions.status"');
    expect(assignments).toContain('.order("id", { ascending: true })');
    expect(list).toContain("setDebouncedSearch(search.trim().slice(0, 120))");
    expect(list).toContain("setPage(1)");
  });

  test("counts only persisted unreviewed states for the current page", () => {
    expect(assignments).toContain('select("assignment_id,status")');
    expect(assignments).toContain('.in("assignment_id", assignmentIds)');
    expect(assignments).toContain("awaitingReviewCount:");
    expect(assignments).not.toContain("getAllAssignmentSubmissions");
    expect(list).toContain("awaiting review");
  });

  test("keeps direct Trainer assignment parity and avoids detail list preloads", () => {
    expect(assignments).toContain("trainer_user_id.eq.${trainerUserId}");
    expect(assignments).toContain("params.assignmentTrainerUserId === user.id");
    expect(assignments).not.toContain("const visible = await getAssignments");
    expect(assignments).toContain(
      "assignmentTrainerUserId: existing.trainer_user_id",
    );
    expect(assignments).not.toContain(
      "assignmentTrainerUserId: input.trainerUserId",
    );
  });

  test("loads creation selectors only when the create dialog opens", () => {
    const initialize = list.slice(list.indexOf("async function initialize"), list.indexOf("async function loadPage"));
    expect(initialize).not.toContain("getCoursesForTenant");
    expect(initialize).not.toContain("getCohortsForTenant");
    expect(list).toMatch(/async function openCreateForm[\s\S]*getCoursesForTenant[\s\S]*getCohortsForTenant/);
  });

  test("unions eligible and persisted Student IDs without duplicates", () => {
    expect(submissions).toContain("new Set([...eligibleStudentIds, ...submissionStudentIds])");
    expect(submissions).toContain('full_name: "Former student"');
    expect(submissions).toContain("summary: calculateSummary(roster.length, submissions)");
    expect(submissions).not.toContain("getAssignmentSubmissions(params),");
  });

  test("maps reliable open and closed review states", () => {
    expect(getAssignmentReviewPresentation("published", null).state).toBe("not_submitted");
    expect(getAssignmentReviewPresentation("published", submission("a", "submitted")).state).toBe("submitted_awaiting_review");
    expect(getAssignmentReviewPresentation("published", submission("a", "late")).state).toBe("submitted_late_awaiting_review");
    expect(getAssignmentReviewPresentation("published", submission("a", "reviewed")).state).toBe("reviewed");
    expect(getAssignmentReviewPresentation("closed", null).state).toBe("closed_without_submission");
    expect(getAssignmentReviewPresentation("closed", submission("a", "submitted")).state).toBe("closed_unreviewed");
    expect(getAssignmentReviewPresentation("closed", submission("a", "reviewed")).state).toBe("closed_reviewed");
  });

  test("filters roster states and moves through awaiting reviews deterministically", () => {
    const roster = [rosterItem("a", "submitted"), rosterItem("b", "reviewed"), rosterItem("c", null), rosterItem("d", "late")];
    expect(filterAssignmentReviewRoster(roster, "published", "needs_review").map((item) => item.student.id)).toEqual(["a", "d"]);
    expect(filterAssignmentReviewRoster(roster, "published", "reviewed").map((item) => item.student.id)).toEqual(["b"]);
    expect(filterAssignmentReviewRoster(roster, "published", "not_submitted").map((item) => item.student.id)).toEqual(["c"]);
    expect(getNextAwaitingReviewStudentId(roster, "a")).toBe("d");
    expect(getNextAwaitingReviewStudentId(roster, "d")).toBe("a");
  });

  test("matches delegated controls to the current assignment or Student", () => {
    const assignment = { cohort_id: "cohort-1", course_id: "course-1", id: "assignment-1" };
    expect(delegatedPermissionMatchesAssignment(permission("assignment", "assignment-1"), assignment)).toBe(true);
    expect(delegatedPermissionMatchesAssignment(permission("assignment", "other"), assignment)).toBe(false);
    expect(delegatedPermissionMatchesAssignment(permission("course", "course-1"), assignment)).toBe(true);
    expect(delegatedPermissionMatchesAssignment(permission("cohort", "cohort-1"), assignment)).toBe(true);
    expect(delegatedPermissionMatchesAssignment(permission("student", "student-1"), assignment, "student-1")).toBe(true);
  });

  test("presents capture as missing-only and never as overwrite", () => {
    expect(detail).toContain("!selectedItem.submission && canCreateSubmission");
    expect(detail).toContain("if (!tenant || !canCreateSubmission || item.submission)");
    expect(detail).toContain("Record missing submission");
    expect(detail).toContain("does not overwrite student-authored work");
    expect(detail).not.toContain(">Save<");
  });

  test("retains exact revision and stale handling through the selected panel", () => {
    expect(detail).toContain("if (!item.submission?.updated_at)");
    expect(detail).toContain("expectedSubmissionUpdatedAt: item.submission.updated_at");
    expect(detail).toContain("if (isStaleAssignmentReviewError(caught))");
    expect(detail).toContain("setDraft({})");
    expect(detail).toContain("await refresh().catch(() => undefined)");
    expect(detail).not.toContain("PGRST202");
  });

  test("normalizes backend failures without exposing implementation text", () => {
    expect(getSafeAssignmentError({ code: "42501", message: "policy assignments denied" })).toBe("You do not have permission for this assignment.");
    expect(getSafeAssignmentError({ code: "XX000", message: "relation assignment_submissions failed" }, "Review could not be saved.")).toBe("Review could not be saved.");
    expect(getSafeAssignmentError(new TypeError("Failed to fetch"))).toBe("Temporary network problem. Try again.");
    expect(detail).not.toContain("caught.message");
    expect(list).not.toContain("caught.message");
  });

  test("uses one selected review surface with timestamps and textual filters", () => {
    expect(detail).toContain("selectedItem");
    expect(detail).toContain("selectedItem.submission?.reviewed_at");
    expect(detail).toContain(
      "data.roster.some((item) => item.student.id === current)",
    );
    expect(detail).toContain("data.roster[0]?.student.id ?? null");
    expect(detail).toContain("Next awaiting review");
    expect(detail).toContain('aria-live="polite"');
    expect(detail).not.toContain("roster.map((item) =>");
  });

  test("keeps assignment and submission writes on secure RPC paths", () => {
    expect(assignments).not.toMatch(/\.from\("assignments"\)[\s\S]{0,180}\.(insert|update|delete)\(/);
    expect(submissions).not.toMatch(/\.from\("assignment_submissions"\)[\s\S]{0,180}\.(insert|update|delete)\(/);
    expect(detail).not.toMatch(/service.?role|SUPABASE_SERVICE_ROLE/i);
    expect(list).not.toMatch(/service.?role|SUPABASE_SERVICE_ROLE/i);
  });

  test("provides mobile-safe controls and accessible dialog semantics", () => {
    expect(list).toContain('aria-label="Assignment pages"');
    expect(list).toContain('aria-modal="true"');
    expect(list).toContain('role="dialog"');
    expect(list).toContain('event.key === "Escape"');
    expect(list).toContain('aria-label="Close create assignment"');
    expect(detail).toContain("break-words");
    expect(detail).toContain("min-w-0");
  });
});
