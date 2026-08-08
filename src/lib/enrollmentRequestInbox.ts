import type {
  EnrollmentRequestLifecycleStatus,
  PublicSiteLead,
} from "@/src/lib/publicSite";

export type EnrollmentRequestStatusFilter =
  | "all"
  | "enrolled"
  | "needs_attention"
  | "new"
  | "rejected";

export const enrollmentRequestStatusFilters: Array<{
  label: string;
  value: EnrollmentRequestStatusFilter;
}> = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Needs attention", value: "needs_attention" },
  { label: "Enrolled", value: "enrolled" },
  { label: "Rejected", value: "rejected" },
];

export function getEnrollmentRequestLifecycleStatus(
  request: PublicSiteLead,
): EnrollmentRequestLifecycleStatus {
  return request.enrollment_request_status ?? "new";
}

export function canApproveEnrollmentRequest(
  status: EnrollmentRequestLifecycleStatus,
) {
  return status === "new";
}

export function canRejectEnrollmentRequest(
  status: EnrollmentRequestLifecycleStatus,
) {
  return status === "new" || status === "needs_attention";
}

export function getEnrollmentRequestStatusLabel(
  status: EnrollmentRequestLifecycleStatus,
) {
  switch (status) {
    case "needs_attention":
      return "Needs attention";
    case "processing":
      return "Processing";
    case "enrolled":
      return "Enrolled";
    case "rejected":
      return "Rejected";
    default:
      return "New";
  }
}

export function filterEnrollmentRequests(params: {
  courseId: string;
  courseTitleById: Record<string, string>;
  requests: PublicSiteLead[];
  search: string;
  status: EnrollmentRequestStatusFilter;
}) {
  const normalizedSearch = params.search.trim().toLowerCase();

  return params.requests.filter((request) => {
    const lifecycleStatus = getEnrollmentRequestLifecycleStatus(request);
    const matchesStatus =
      params.status === "all" || lifecycleStatus === params.status;
    const matchesCourse =
      !params.courseId || request.interested_course_id === params.courseId;
    const programTitle = request.interested_course_id
      ? params.courseTitleById[request.interested_course_id]
      : "";
    const searchText = [request.name, request.email, programTitle]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      matchesStatus &&
      matchesCourse &&
      (!normalizedSearch || searchText.includes(normalizedSearch))
    );
  });
}

export function getEnrollmentRequestEmptyTitle(params: {
  courseId: string;
  search: string;
  status: EnrollmentRequestStatusFilter;
}) {
  if (params.search.trim()) {
    return "No matching requests.";
  }

  if (params.status === "new") {
    return "No new requests.";
  }

  if (params.status !== "all" || params.courseId) {
    return "No requests in this view.";
  }

  return "No enrollment requests yet.";
}

export function getNeedsAttentionGuidance(errorCode: string | null | undefined) {
  switch (errorCode) {
    case "ambiguous_student_phone":
      return "Review matching student records before trying again.";
    case "enrollment_requires_review":
      return "Review the existing enrollment before continuing.";
    case "invalid_enrollment_links":
      return "Review the linked student and enrollment records.";
    case "matched_student_not_active":
      return "Review the student record before continuing.";
    default:
      return "Review the student and program details before continuing.";
  }
}
