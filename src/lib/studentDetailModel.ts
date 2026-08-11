import type { CourseStatus } from "@/src/lib/courses";
import type { Cohort, CohortMember } from "@/src/lib/cohorts";
import type { Enrollment, EnrollmentStatus } from "@/src/lib/enrollments";
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
  active: ["completed", "paused", "cancelled"],
  cancelled: ["active"],
  completed: [],
  paused: ["active", "cancelled"],
};

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
