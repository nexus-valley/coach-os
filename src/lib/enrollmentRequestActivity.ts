import type { PublicSiteLead } from "@/src/lib/publicSite";
import type { StudentPortalInvitationSummary } from "@/src/lib/studentPortalInvitations";

export type EnrollmentRequestActivityEvent = {
  key: string;
  label: string;
  timestamp: string | null;
};

export type EnrollmentRequestRecovery = {
  action:
    | "open_program"
    | "review_enrollment"
    | "review_student"
    | "retry_invitation"
    | null;
  category:
    | "enrollment_conflict"
    | "invitation_retry"
    | "manual_review"
    | "portal_access_conflict"
    | "student_record_conflict";
  description: string;
  title: string;
};

const studentActionLabels = {
  created: "Student created",
  matched: "Student matched",
  selected: "Existing student selected",
} as const;

const enrollmentActionLabels = {
  created: "Enrollment created",
  reused: "Existing enrollment reused",
} as const;

function getOutcomeTimestamp(request: PublicSiteLead) {
  return request.converted_at ?? request.processed_at ?? null;
}

export function buildEnrollmentRequestActivity(params: {
  invitation?: StudentPortalInvitationSummary | null;
  request: PublicSiteLead;
}) {
  const { invitation, request } = params;
  const events: EnrollmentRequestActivityEvent[] = [
    {
      key: "request_received",
      label: "Request received",
      timestamp: request.created_at,
    },
  ];

  if (request.processing_started_at) {
    events.push({
      key: "approval_started",
      label: "Approval started",
      timestamp: request.processing_started_at,
    });
  }

  const outcomeTimestamp = getOutcomeTimestamp(request);

  if (request.approval_student_action && outcomeTimestamp) {
    events.push({
      key: `student_${request.approval_student_action}`,
      label: studentActionLabels[request.approval_student_action],
      timestamp: outcomeTimestamp,
    });
  }

  if (request.approval_enrollment_action && outcomeTimestamp) {
    events.push({
      key: `enrollment_${request.approval_enrollment_action}`,
      label: enrollmentActionLabels[request.approval_enrollment_action],
      timestamp: outcomeTimestamp,
    });
  }

  if (request.enrollment_request_status === "enrolled" && outcomeTimestamp) {
    events.push({
      key: "request_enrolled",
      label: "Request enrolled",
      timestamp: outcomeTimestamp,
    });
  } else if (
    request.enrollment_request_status === "rejected" &&
    request.processed_at
  ) {
    events.push({
      key: "request_rejected",
      label: "Request rejected",
      timestamp: request.processed_at,
    });
  } else if (
    request.enrollment_request_status === "needs_attention" &&
    request.processed_at
  ) {
    events.push({
      key: "request_needs_attention",
      label: "Request needs attention",
      timestamp: request.processed_at,
    });
  }

  if (invitation?.sent_at) {
    events.push({
      key: "invitation_sent",
      label: "Portal invitation sent",
      timestamp: invitation.sent_at,
    });
  }

  if (invitation?.accepted_at) {
    events.push({
      key:
        invitation.status === "access_active"
          ? "portal_access_activated"
          : "invitation_accepted",
      label:
        invitation.status === "access_active"
          ? "Portal access activated"
          : "Invitation accepted",
      timestamp: invitation.accepted_at,
    });
  } else if (invitation?.status === "access_active") {
    events.push({
      key: "portal_access_active",
      label: "Portal access active",
      timestamp: null,
    });
  }

  if (invitation?.status === "invitation_expired" && invitation.expires_at) {
    events.push({
      key: "invitation_expired",
      label: "Portal invitation expired",
      timestamp: invitation.expires_at,
    });
  }

  return events.sort((left, right) => {
    if (!left.timestamp) return 1;
    if (!right.timestamp) return -1;
    return Date.parse(left.timestamp) - Date.parse(right.timestamp);
  });
}

export function getEnrollmentRequestRecovery(params: {
  invitation?: StudentPortalInvitationSummary | null;
  request: PublicSiteLead;
}): EnrollmentRequestRecovery | null {
  const { invitation, request } = params;

  if (invitation?.status === "needs_attention") {
    if (invitation.can_resend) {
      return {
        action: "retry_invitation",
        category: "invitation_retry",
        description:
          "The enrollment is complete, but the portal invitation needs another delivery attempt.",
        title: "Invitation needs retry",
      };
    }

    return {
      action: request.converted_student_id ? "review_student" : null,
      category: "portal_access_conflict",
      description:
        "Review the student's portal access before continuing with another invitation.",
      title: "Portal access needs review",
    };
  }

  if (request.enrollment_request_status !== "needs_attention") {
    return null;
  }

  switch (request.last_error_code) {
    case "ambiguous_student_phone":
      return {
        action: "open_program",
        category: "student_record_conflict",
        description:
          "More than one student record may match. Review the related records before continuing.",
        title: "Student match needs review",
      };
    case "matched_student_not_active":
      return {
        action: request.converted_student_id
          ? "review_student"
          : "open_program",
        category: "student_record_conflict",
        description:
          "The matching student is not active. Review the student record before continuing.",
        title: "Student record needs review",
      };
    case "enrollment_requires_review":
      return {
        action: "review_enrollment",
        category: "enrollment_conflict",
        description:
          "An existing enrollment must be reviewed before this request can continue.",
        title: "Enrollment needs review",
      };
    case "invalid_enrollment_links":
      return {
        action: request.converted_student_id
          ? "review_student"
          : "review_enrollment",
        category: "enrollment_conflict",
        description:
          "The linked student or enrollment is no longer consistent. Review the related records.",
        title: "Linked records need review",
      };
    default:
      return {
        action: request.converted_student_id ? "review_student" : "open_program",
        category: "manual_review",
        description: "Review this request and its related student record.",
        title: "Manual review required",
      };
  }
}
