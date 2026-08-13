import type {
  AssignmentRosterItem,
  AssignmentSubmission,
} from "@/src/lib/submissions";
import type { Assignment } from "@/src/lib/assignments";
import type { DelegatedPermission } from "@/src/lib/delegatedPermissions";

export type AssignmentReviewFilter =
  | "all"
  | "needs_review"
  | "not_submitted"
  | "reviewed";

export type AssignmentReviewState =
  | "closed_reviewed"
  | "closed_unreviewed"
  | "closed_without_submission"
  | "not_submitted"
  | "reviewed"
  | "submitted_awaiting_review"
  | "submitted_late_awaiting_review";

export type AssignmentReviewPresentation = {
  label: string;
  needsReview: boolean;
  state: AssignmentReviewState;
  tone: "danger" | "light" | "success" | "warning";
};

function isAwaitingReview(submission: AssignmentSubmission | null) {
  return Boolean(submission && submission.status !== "reviewed");
}

export function getAssignmentReviewPresentation(
  assignmentStatus: string | null | undefined,
  submission: AssignmentSubmission | null,
): AssignmentReviewPresentation {
  if (assignmentStatus === "closed") {
    if (!submission) {
      return {
        label: "Closed without submission",
        needsReview: false,
        state: "closed_without_submission",
        tone: "light",
      };
    }

    if (submission.status === "reviewed") {
      return {
        label: "Closed · Reviewed",
        needsReview: false,
        state: "closed_reviewed",
        tone: "success",
      };
    }

    return {
      label: "Closed · Awaiting review",
      needsReview: true,
      state: "closed_unreviewed",
      tone: "danger",
    };
  }

  if (!submission) {
    return {
      label: "Not submitted",
      needsReview: false,
      state: "not_submitted",
      tone: "light",
    };
  }

  if (submission.status === "reviewed") {
    return {
      label: "Reviewed",
      needsReview: false,
      state: "reviewed",
      tone: "success",
    };
  }

  if (submission.status === "late") {
    return {
      label: "Late · Awaiting review",
      needsReview: true,
      state: "submitted_late_awaiting_review",
      tone: "warning",
    };
  }

  return {
    label: "Awaiting review",
    needsReview: true,
    state: "submitted_awaiting_review",
    tone: "warning",
  };
}

export function filterAssignmentReviewRoster(
  roster: AssignmentRosterItem[],
  assignmentStatus: string | null | undefined,
  filter: AssignmentReviewFilter,
) {
  if (filter === "all") {
    return roster;
  }

  return roster.filter((item) => {
    const presentation = getAssignmentReviewPresentation(
      assignmentStatus,
      item.submission,
    );

    if (filter === "needs_review") {
      return presentation.needsReview;
    }

    if (filter === "reviewed") {
      return item.submission?.status === "reviewed";
    }

    return !item.submission;
  });
}

export function getNextAwaitingReviewStudentId(
  roster: AssignmentRosterItem[],
  selectedStudentId: string | null,
) {
  const awaiting = roster.filter((item) => isAwaitingReview(item.submission));

  if (awaiting.length === 0) {
    return null;
  }

  const currentIndex = awaiting.findIndex(
    (item) => item.student.id === selectedStudentId,
  );
  return awaiting[(currentIndex + 1) % awaiting.length]?.student.id ?? null;
}

export function delegatedPermissionMatchesAssignment(
  permission: DelegatedPermission,
  assignment: Pick<Assignment, "cohort_id" | "course_id" | "id">,
  studentId?: string | null,
) {
  if (!permission.scope_type || permission.scope_type === "workspace") {
    return true;
  }

  if (permission.scope_type === "assignment") {
    return permission.scope_id === assignment.id;
  }

  if (permission.scope_type === "course") {
    return Boolean(
      assignment.course_id && permission.scope_id === assignment.course_id,
    );
  }

  if (permission.scope_type === "cohort") {
    return Boolean(
      assignment.cohort_id && permission.scope_id === assignment.cohort_id,
    );
  }

  return permission.scope_type === "student" && permission.scope_id === studentId;
}
