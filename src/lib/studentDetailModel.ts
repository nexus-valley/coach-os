import type { CourseStatus } from "@/src/lib/courses";
import type { Cohort, CohortMember } from "@/src/lib/cohorts";
import type {
  Enrollment,
  EnrollmentCourseOption,
  EnrollmentStatus,
} from "@/src/lib/enrollments";
import type {
  StudentPortalInvitationStatus,
  StudentPortalInvitationSummary,
} from "@/src/lib/studentPortalInvitations";
import type { Student } from "@/src/lib/students";
import type { MemberRole } from "@/src/lib/team";

export type StudentDetailProgram = {
  id: string;
  status: CourseStatus;
  title: string;
};

export type StudentDetailCohort = CohortMember & {
  canOpenCohort: boolean;
  cohort: Cohort | null;
  program: StudentDetailProgram | null;
};

export type StudentDetailRelationship = {
  canManageCohorts: boolean;
  canManageEnrollment: boolean;
  canRemoveEnrollment: boolean;
  canViewProgram: boolean;
  cohorts: StudentDetailCohort[];
  enrollment: Enrollment;
  program: StudentDetailProgram | null;
};

export type StudentDetailPortalState =
  | StudentPortalInvitationStatus
  | "access_unavailable"
  | "status_restricted"
  | "status_unavailable";

export type StudentDetailPortalEvidence = {
  state: StudentDetailPortalState;
  summary: StudentPortalInvitationSummary | null;
};

export type StudentDetailModel = {
  capabilities: {
    canCreateEnrollment: boolean;
    canDeleteStudent: boolean;
    canEditProfile: boolean;
    canPreviewPortal: boolean;
    canViewFinance: boolean;
  };
  currentRelationships: StudentDetailRelationship[];
  historyRelationships: StudentDetailRelationship[];
  portal: StudentDetailPortalEvidence;
  role: MemberRole;
  student: Student;
  unmatchedCohorts: StudentDetailCohort[];
};

export const studentDetailEnrollmentTransitions: Record<
  EnrollmentStatus,
  EnrollmentStatus[]
> = {
  active: ["paused", "completed", "cancelled"],
  cancelled: ["active"],
  completed: [],
  paused: ["active", "cancelled"],
};

export type StudentDetailEnrollmentAction = {
  confirmLabel: string;
  description: string;
  label: string;
  successMessage: string;
  targetStatus: EnrollmentStatus;
};

const studentDetailEnrollmentActions: Partial<
  Record<
    EnrollmentStatus,
    Partial<Record<EnrollmentStatus, StudentDetailEnrollmentAction>>
  >
> = {
  active: {
    cancelled: {
      confirmLabel: "Cancel enrollment",
      description:
        "Current learning access ends and the relationship moves to history. The existing enrollment may be reactivated later. Portal identity and payment state remain separate.",
      label: "Cancel enrollment",
      successMessage: "Enrollment cancelled.",
      targetStatus: "cancelled",
    },
    completed: {
      confirmLabel: "Complete enrollment",
      description:
        "The relationship moves to enrollment history and participation ends. Historical read access may remain where available. Completed enrollments cannot be resumed or reactivated. Portal identity and payment state remain separate.",
      label: "Complete enrollment",
      successMessage: "Enrollment completed.",
      targetStatus: "completed",
    },
    paused: {
      confirmLabel: "Pause enrollment",
      description:
        "The enrollment relationship is preserved in Current, but current learning access and participation are suspended. Portal identity and payment state remain separate.",
      label: "Pause enrollment",
      successMessage: "Enrollment paused.",
      targetStatus: "paused",
    },
  },
  cancelled: {
    active: {
      confirmLabel: "Reactivate enrollment",
      description:
        "The existing enrollment relationship is reactivated and its original record is reused. No new enrollment is created. Portal identity and payment state remain separate.",
      label: "Reactivate enrollment",
      successMessage: "Enrollment reactivated.",
      targetStatus: "active",
    },
  },
  paused: {
    active: {
      confirmLabel: "Resume enrollment",
      description:
        "The existing enrollment relationship resumes. No new enrollment record is created. Portal identity and payment state remain separate.",
      label: "Resume enrollment",
      successMessage: "Enrollment resumed.",
      targetStatus: "active",
    },
    cancelled: {
      confirmLabel: "Cancel enrollment",
      description:
        "Current learning access ends and the relationship moves to history. The existing enrollment may be reactivated later. Portal identity and payment state remain separate.",
      label: "Cancel enrollment",
      successMessage: "Enrollment cancelled.",
      targetStatus: "cancelled",
    },
  },
};

export function getStudentDetailEnrollmentAction(params: {
  currentStatus: EnrollmentStatus;
  targetStatus: EnrollmentStatus;
}) {
  return (
    studentDetailEnrollmentActions[params.currentStatus]?.[
      params.targetStatus
    ] ?? null
  );
}

export function getAvailableStudentDetailEnrollmentOptions(params: {
  options: EnrollmentCourseOption[];
  relationships: StudentDetailRelationship[];
}) {
  const existingCourseIds = new Set(
    params.relationships.map(
      (relationship) => relationship.enrollment.course_id,
    ),
  );

  return params.options.filter((option) => !existingCourseIds.has(option.id));
}

export function canCreateStudentDetailEnrollment(params: {
  role: MemberRole;
  studentStatus: Student["status"];
  trainerCourseIds: string[];
}) {
  if (params.studentStatus !== "active") {
    return false;
  }

  return (
    params.role === "owner" ||
    params.role === "admin" ||
    params.role === "staff" ||
    (params.role === "trainer" && params.trainerCourseIds.length > 0)
  );
}

export function getStudentDetailEnrollmentTransitions(params: {
  enrollmentStatus: EnrollmentStatus;
  studentStatus: Student["status"];
}) {
  const transitions =
    studentDetailEnrollmentTransitions[params.enrollmentStatus];

  return params.studentStatus === "active"
    ? transitions
    : transitions.filter((status) => status !== "active");
}

export function isCurrentStudentDetailEnrollment(status: EnrollmentStatus) {
  return status === "active" || status === "paused";
}

export function deriveStudentDetailPortalEvidence(params: {
  role: MemberRole;
  student: Student;
  summary: StudentPortalInvitationSummary | null;
}): StudentDetailPortalEvidence {
  if (params.role !== "owner" && params.role !== "admin") {
    return { state: "status_restricted", summary: null };
  }

  if (params.student.status !== "active" || !params.student.portal_enabled) {
    return { state: "access_unavailable", summary: params.summary };
  }

  if (!params.summary) {
    return { state: "status_unavailable", summary: null };
  }

  return { state: params.summary.status, summary: params.summary };
}

export function getStudentDetailRelationshipCapabilities(params: {
  courseId: string;
  enrollmentStatus: EnrollmentStatus;
  role: MemberRole;
  studentStatus: Student["status"];
  trainerCohortCourseIds: string[];
  trainerCourseIds: string[];
}) {
  const canManageTenantStudents =
    params.role === "owner" ||
    params.role === "admin" ||
    params.role === "staff";

  return {
    canManageCohorts:
      params.studentStatus === "active" &&
      params.enrollmentStatus === "active" &&
      (canManageTenantStudents ||
        params.trainerCohortCourseIds.includes(params.courseId)),
    canManageEnrollment:
      canManageTenantStudents ||
      params.trainerCourseIds.includes(params.courseId),
    canRemoveEnrollment:
      params.role === "owner" || params.role === "admin",
    canViewProgram:
      params.role !== "trainer" ||
      params.trainerCourseIds.includes(params.courseId),
  };
}

function sortRelationships(
  relationships: StudentDetailRelationship[],
): StudentDetailRelationship[] {
  return [...relationships].sort((left, right) => {
    const dateOrder =
      new Date(right.enrollment.enrolled_at).getTime() -
      new Date(left.enrollment.enrolled_at).getTime();

    if (dateOrder !== 0) {
      return dateOrder;
    }

    return left.enrollment.id.localeCompare(right.enrollment.id);
  });
}

export function groupStudentDetailRelationships(
  relationships: StudentDetailRelationship[],
) {
  return {
    currentRelationships: sortRelationships(
      relationships.filter((relationship) =>
        isCurrentStudentDetailEnrollment(relationship.enrollment.status),
      ),
    ),
    historyRelationships: sortRelationships(
      relationships.filter(
        (relationship) =>
          !isCurrentStudentDetailEnrollment(relationship.enrollment.status),
      ),
    ),
  };
}
