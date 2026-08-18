type BackendErrorShape = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

export type AssignmentErrorKind =
  | "invalid_input"
  | "lifecycle_changed"
  | "network"
  | "not_found"
  | "permission"
  | "relationship_frozen"
  | "stale_review"
  | "submission_cutoff"
  | "unknown";

function getErrorShape(error: unknown): BackendErrorShape {
  return error && typeof error === "object" ? (error as BackendErrorShape) : {};
}

export function getAssignmentErrorKind(error: unknown): AssignmentErrorKind {
  const candidate = getErrorShape(error);
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const details = typeof candidate.details === "string" ? candidate.details : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const normalized = `${details} ${message}`.toLowerCase();

  if (code === "P0001" && details === "assignment_submission_stale") {
    return "stale_review";
  }

  if (/due date and max score cannot be changed after the first submission/.test(normalized)) {
    return "submission_cutoff";
  }

  if (/program, cohort, and trainer cannot be changed after publication/.test(normalized)) {
    return "relationship_frozen";
  }

  if (
    code === "42501" ||
    /permission|not authorized|access denied|authentication required/.test(normalized)
  ) {
    return "permission";
  }

  if (
    code === "PGRST116" ||
    /assignment not found|assignment (?:is )?not available/.test(normalized)
  ) {
    return "not_found";
  }

  if (/failed to fetch|network|timeout|connection/.test(normalized)) {
    return "network";
  }

  if (
    /closed assignments cannot be edited|assignment lifecycle state is not supported|assignment state|lifecycle/.test(
      normalized,
    )
  ) {
    return "lifecycle_changed";
  }

  if (
    /assignment title|description|instructions|attachment url|max score|score must|score cannot|due date|select a course or cohort|selected trainer|invalid course|invalid cohort|invalid program|course not found|cohort not found|program not found|cohort does not belong|course is not available|cohort is not available|program is not available/.test(
      normalized,
    )
  ) {
    return "invalid_input";
  }

  if (code === "22023") {
    return "lifecycle_changed";
  }

  return "unknown";
}

export function getSafeAssignmentError(
  error: unknown,
  fallback = "Assignment data could not be loaded.",
) {
  switch (getAssignmentErrorKind(error)) {
    case "stale_review":
      return "Submission changed since it was loaded. Reload the latest submission.";
    case "submission_cutoff":
      return "Submission activity started while this assignment was open. Due date and maximum score can no longer be changed.";
    case "relationship_frozen":
      return "Assignment state changed while it was open. Program, cohort, and trainer are now fixed.";
    case "permission":
      return "You do not have permission for this assignment.";
    case "not_found":
      return "Assignment unavailable.";
    case "network":
      return "Temporary network problem. Try again.";
    case "lifecycle_changed":
      return "Assignment state changed while it was open. Latest details have been reloaded.";
    case "invalid_input":
      return "Review the assignment fields and try again.";
    default:
      return fallback;
  }
}
