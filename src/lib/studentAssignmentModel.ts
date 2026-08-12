export type StudentAssignmentSubmissionState = {
  reviewed_at: string | null;
  status: "late" | "pending" | "reviewed" | "submitted";
  submitted_at: string | null;
} | null;

export type StudentAssignmentViewState =
  | "closed_missed"
  | "closed_reviewed"
  | "closed_submitted"
  | "open"
  | "overdue_open"
  | "reviewed"
  | "submitted"
  | "submitted_late"
  | "unavailable";

export type StudentAssignmentViewModel = {
  canSubmit: boolean;
  hasReview: boolean;
  isClosed: boolean;
  isLate: boolean;
  label: string;
  state: StudentAssignmentViewState;
};

function isPastDue(dueAt: string | null | undefined, now: Date) {
  if (!dueAt) {
    return false;
  }

  const timestamp = Date.parse(dueAt);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
}

export function getStudentAssignmentViewModel(params: {
  dueAt?: string | null;
  now?: Date;
  status: unknown;
  submission: StudentAssignmentSubmissionState;
}): StudentAssignmentViewModel {
  const now = params.now ?? new Date();
  const hasReview = Boolean(
    params.submission &&
      (params.submission.status === "reviewed" ||
        params.submission.reviewed_at),
  );
  const isLate = params.submission?.status === "late";

  if (params.status === "closed") {
    if (!params.submission) {
      return {
        canSubmit: false,
        hasReview: false,
        isClosed: true,
        isLate: false,
        label: "Closed - no submission",
        state: "closed_missed",
      };
    }

    if (hasReview) {
      return {
        canSubmit: false,
        hasReview: true,
        isClosed: true,
        isLate,
        label: "Closed - reviewed",
        state: "closed_reviewed",
      };
    }

    return {
      canSubmit: false,
      hasReview: false,
      isClosed: true,
      isLate,
      label: isLate ? "Closed - submitted late" : "Closed - submitted",
      state: "closed_submitted",
    };
  }

  if (params.status !== "published") {
    return {
      canSubmit: false,
      hasReview: false,
      isClosed: false,
      isLate: false,
      label: "Assignment unavailable",
      state: "unavailable",
    };
  }

  if (hasReview) {
    return {
      canSubmit: true,
      hasReview: true,
      isClosed: false,
      isLate,
      label: isLate ? "Reviewed - submitted late" : "Reviewed",
      state: "reviewed",
    };
  }

  if (params.submission) {
    return {
      canSubmit: true,
      hasReview: false,
      isClosed: false,
      isLate,
      label: isLate ? "Submitted late" : "Submitted - awaiting review",
      state: isLate ? "submitted_late" : "submitted",
    };
  }

  if (isPastDue(params.dueAt, now)) {
    return {
      canSubmit: true,
      hasReview: false,
      isClosed: false,
      isLate: false,
      label: "Overdue, still open",
      state: "overdue_open",
    };
  }

  return {
    canSubmit: true,
    hasReview: false,
    isClosed: false,
    isLate: false,
    label: "Open",
    state: "open",
  };
}

export function getSafeStudentAttachmentUrls(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => {
    if (typeof item !== "string") {
      return false;
    }

    try {
      const url = new URL(item);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
}

export function formatStudentAssignmentDateTime(
  value: string | null | undefined,
) {
  if (!value) {
    return "No due date";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Due date unavailable";
  }

  return `${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)} (your local time)`;
}
