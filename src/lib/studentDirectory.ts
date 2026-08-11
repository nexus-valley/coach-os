import type { EnrollmentStatus } from "@/src/lib/enrollments";
import type { Student, StudentStatus } from "@/src/lib/students";

export type StudentDirectoryPortalState =
  | "access_active"
  | "access_unavailable"
  | "no_active_access"
  | "status_restricted";

export type StudentDirectoryEnrollment = {
  canOpenCourse: boolean;
  courseId: string;
  courseTitle: string;
  enrolledAt: string;
  id: string;
  status: EnrollmentStatus;
};

export type StudentDirectoryRow = {
  enrollments: StudentDirectoryEnrollment[];
  portalState: StudentDirectoryPortalState;
  student: Student;
};

export type StudentDirectoryFilters = {
  enrollmentStatus: "all" | EnrollmentStatus;
  portalState: "all" | StudentDirectoryPortalState;
  programId: string;
  search: string;
  studentStatus: "all" | StudentStatus;
};

export type StudentDirectorySort = "name" | "newest";

export const defaultStudentDirectoryFilters: StudentDirectoryFilters = {
  enrollmentStatus: "all",
  portalState: "all",
  programId: "",
  search: "",
  studentStatus: "all",
};

export function deriveStudentPortalState(params: {
  canViewPortalAccounts: boolean;
  portalAccountStatus: "active" | "pending" | "revoked" | null;
  portalEnabled: boolean;
  studentStatus: StudentStatus;
}): StudentDirectoryPortalState {
  if (params.studentStatus !== "active" || !params.portalEnabled) {
    return "access_unavailable";
  }

  if (!params.canViewPortalAccounts) {
    return "status_restricted";
  }

  if (params.portalAccountStatus === "active") {
    return "access_active";
  }

  if (params.portalAccountStatus === "revoked") {
    return "access_unavailable";
  }

  return "no_active_access";
}

export function getStudentPortalStateLabel(
  state: StudentDirectoryPortalState,
) {
  const labels: Record<StudentDirectoryPortalState, string> = {
    access_active: "Access active",
    access_unavailable: "Access unavailable",
    no_active_access: "No active access",
    status_restricted: "Status restricted",
  };

  return labels[state];
}

export function getEnrollmentStatusLabel(status: EnrollmentStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function normalizedSearchValue(value: string | null) {
  return (value ?? "").trim().toLocaleLowerCase();
}

export function filterStudentDirectoryRows(
  rows: StudentDirectoryRow[],
  filters: StudentDirectoryFilters,
) {
  const search = normalizedSearchValue(filters.search);

  return rows.filter((row) => {
    const matchesSearch =
      !search ||
      [row.student.full_name, row.student.email, row.student.phone].some(
        (value) => normalizedSearchValue(value).includes(search),
      );
    const matchesStudentStatus =
      filters.studentStatus === "all" ||
      row.student.status === filters.studentStatus;
    const matchesPortalState =
      filters.portalState === "all" || row.portalState === filters.portalState;
    const matchesEnrollment = row.enrollments.some(
      (enrollment) =>
        (!filters.programId || enrollment.courseId === filters.programId) &&
        (filters.enrollmentStatus === "all" ||
          enrollment.status === filters.enrollmentStatus),
    );
    const requiresEnrollment =
      Boolean(filters.programId) || filters.enrollmentStatus !== "all";

    return (
      matchesSearch &&
      matchesStudentStatus &&
      matchesPortalState &&
      (!requiresEnrollment || matchesEnrollment)
    );
  });
}

export function sortStudentDirectoryRows(
  rows: StudentDirectoryRow[],
  sort: StudentDirectorySort,
) {
  return [...rows].sort((left, right) => {
    if (sort === "name") {
      const nameOrder = left.student.full_name.localeCompare(
        right.student.full_name,
        undefined,
        { sensitivity: "base" },
      );

      if (nameOrder !== 0) {
        return nameOrder;
      }

      return left.student.id.localeCompare(right.student.id);
    }

    const createdOrder =
      new Date(right.student.created_at).getTime() -
      new Date(left.student.created_at).getTime();

    return createdOrder || left.student.id.localeCompare(right.student.id);
  });
}

export function getStudentDirectoryEmptyCopy(params: {
  hasFilters: boolean;
  hasSearch: boolean;
  totalStudents: number;
}) {
  if (params.totalStudents === 0) {
    return {
      description:
        "Student records will appear here after they are added directly or created through an approved enrollment request.",
      title: "No students yet",
    };
  }

  if (params.hasSearch) {
    return {
      description: "Try a different name, email, or phone number.",
      title: "No matching students",
    };
  }

  if (params.hasFilters) {
    return {
      description: "Adjust or reset the directory filters to see more students.",
      title: "No students match these filters",
    };
  }

  return {
    description: "Adjust the directory view to see more students.",
    title: "No students in this view",
  };
}
