type BackendErrorShape = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

function getErrorShape(error: unknown): BackendErrorShape {
  return error && typeof error === "object" ? (error as BackendErrorShape) : {};
}

export function getSafeAssignmentError(
  error: unknown,
  fallback = "Assignment data could not be loaded.",
) {
  const candidate = getErrorShape(error);
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const details = typeof candidate.details === "string" ? candidate.details : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const normalized = `${details} ${message}`.toLowerCase();

  if (code === "P0001" && details === "assignment_submission_stale") {
    return "Submission changed since it was loaded. Reload the latest submission.";
  }

  if (code === "42501" || /permission|not authorized|access denied/.test(normalized)) {
    return "You do not have permission for this assignment.";
  }

  if (code === "PGRST116" || /assignment not found|not available/.test(normalized)) {
    return "Assignment unavailable.";
  }

  if (/failed to fetch|network|timeout|connection/.test(normalized)) {
    return "Temporary network problem. Try again.";
  }

  if (code === "22023" || /assignment state|lifecycle/.test(normalized)) {
    return "Assignment state changed. Reload before continuing.";
  }

  return fallback;
}
