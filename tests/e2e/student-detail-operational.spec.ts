import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveStudentDetailPortalEvidence,
  getStudentDetailEnrollmentTransitions,
  getStudentDetailRelationshipCapabilities,
  groupStudentDetailRelationships,
  studentDetailEnrollmentTransitions,
  type StudentDetailRelationship,
} from "../../src/lib/studentDetailModel";
import type { StudentPortalInvitationSummary } from "../../src/lib/studentPortalInvitations";
import type { Student } from "../../src/lib/students";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const activeStudent: Student = {
  created_at: "2026-01-01T00:00:00.000Z",
  created_by: null,
  email: "student@example.com",
  full_name: "Student Example",
  id: "student-1",
  notes: null,
  phone: null,
  portal_enabled: true,
  source: "Request",
  status: "active",
  tenant_id: "tenant-1",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function portalSummary(
  status: StudentPortalInvitationSummary["status"],
): StudentPortalInvitationSummary {
  return {
    accepted_at: null,
    attempt_count: 1,
    can_resend: status === "invitation_expired",
    expires_at: "2026-12-01T00:00:00.000Z",
    sent_at: "2026-01-02T00:00:00.000Z",
    status,
  };
}

function relationship(
  status: StudentDetailRelationship["enrollment"]["status"],
  id: string,
  enrolledAt: string,
): StudentDetailRelationship {
  return {
    canManageCohorts: false,
    canManageEnrollment: false,
    canRemoveEnrollment: false,
    canViewProgram: true,
    cohorts: [],
    enrollment: {
      completed_at:
        status === "completed" ? "2026-02-01T00:00:00.000Z" : null,
      course_id: `course-${id}`,
      created_at: enrolledAt,
      created_by: null,
      enrolled_at: enrolledAt,
      id,
      status,
      student_id: activeStudent.id,
      tenant_id: activeStudent.tenant_id,
      updated_at: enrolledAt,
    },
    program: {
      id: `course-${id}`,
      status: id === "archived" ? "archived" : "published",
      title: `Program ${id}`,
    },
  };
}

test.describe("UX-4D Student Detail operational model", () => {
  test("groups zero, one, and multiple relationships into current and history", () => {
    expect(groupStudentDetailRelationships([])).toEqual({
      currentRelationships: [],
      historyRelationships: [],
    });

    const active = relationship("active", "active", "2026-04-01T00:00:00Z");
    const paused = relationship("paused", "paused", "2026-03-01T00:00:00Z");
    const completed = relationship(
      "completed",
      "completed",
      "2026-02-01T00:00:00Z",
    );
    const cancelled = relationship(
      "cancelled",
      "cancelled",
      "2026-01-01T00:00:00Z",
    );
    const grouped = groupStudentDetailRelationships([
      cancelled,
      paused,
      completed,
      active,
    ]);

    expect(groupStudentDetailRelationships([active]).currentRelationships).toEqual([
      active,
    ]);
    expect(grouped.currentRelationships.map((item) => item.enrollment.status)).toEqual([
      "active",
      "paused",
    ]);
    expect(grouped.historyRelationships.map((item) => item.enrollment.status)).toEqual([
      "completed",
      "cancelled",
    ]);
  });

  test("preserves the exact enrollment transition contract", () => {
    expect(studentDetailEnrollmentTransitions).toEqual({
      active: ["completed", "paused", "cancelled"],
      cancelled: ["active"],
      completed: [],
      paused: ["active", "cancelled"],
    });

    expect(
      getStudentDetailEnrollmentTransitions({
        enrollmentStatus: "paused",
        studentStatus: "active",
      }),
    ).toEqual(["active", "cancelled"]);
    expect(
      getStudentDetailEnrollmentTransitions({
        enrollmentStatus: "paused",
        studentStatus: "inactive",
      }),
    ).toEqual(["cancelled"]);
    expect(
      getStudentDetailEnrollmentTransitions({
        enrollmentStatus: "cancelled",
        studentStatus: "blocked",
      }),
    ).toEqual([]);
  });

  test("uses authoritative portal evidence without enrollment inference", () => {
    expect(
      deriveStudentDetailPortalEvidence({
        role: "owner",
        student: activeStudent,
        summary: portalSummary("access_active"),
      }).state,
    ).toBe("access_active");
    expect(
      deriveStudentDetailPortalEvidence({
        role: "admin",
        student: activeStudent,
        summary: portalSummary("invitation_pending"),
      }).state,
    ).toBe("invitation_pending");
    expect(
      deriveStudentDetailPortalEvidence({
        role: "owner",
        student: { ...activeStudent, portal_enabled: false },
        summary: portalSummary("access_active"),
      }).state,
    ).toBe("access_unavailable");
    expect(
      deriveStudentDetailPortalEvidence({
        role: "owner",
        student: { ...activeStudent, status: "blocked" },
        summary: portalSummary("access_active"),
      }).state,
    ).toBe("access_unavailable");

    for (const role of ["staff", "trainer"] as const) {
      expect(
        deriveStudentDetailPortalEvidence({
          role,
          student: activeStudent,
          summary: portalSummary("access_active"),
        }),
      ).toEqual({ state: "status_restricted", summary: null });
    }
  });

  test("matches Owner, Admin, Staff, and Trainer relationship boundaries", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(
        getStudentDetailRelationshipCapabilities({
          courseId: "course-1",
          enrollmentStatus: "active",
          role,
          studentStatus: "active",
          trainerCohortCourseIds: [],
          trainerCourseIds: [],
        }),
      ).toEqual({
        canManageCohorts: true,
        canManageEnrollment: true,
        canRemoveEnrollment: true,
        canViewProgram: true,
      });
    }

    expect(
      getStudentDetailRelationshipCapabilities({
        courseId: "course-1",
        enrollmentStatus: "active",
        role: "staff",
        studentStatus: "active",
        trainerCohortCourseIds: [],
        trainerCourseIds: [],
      }),
    ).toEqual({
      canManageCohorts: true,
      canManageEnrollment: true,
      canRemoveEnrollment: false,
      canViewProgram: true,
    });

    expect(
      getStudentDetailRelationshipCapabilities({
        courseId: "course-1",
        enrollmentStatus: "active",
        role: "trainer",
        studentStatus: "active",
        trainerCohortCourseIds: [],
        trainerCourseIds: ["course-1"],
      }),
    ).toEqual({
      canManageCohorts: false,
      canManageEnrollment: true,
      canRemoveEnrollment: false,
      canViewProgram: true,
    });

    expect(
      getStudentDetailRelationshipCapabilities({
        courseId: "course-1",
        enrollmentStatus: "active",
        role: "trainer",
        studentStatus: "active",
        trainerCohortCourseIds: ["course-1"],
        trainerCourseIds: [],
      }),
    ).toEqual({
      canManageCohorts: true,
      canManageEnrollment: false,
      canRemoveEnrollment: false,
      canViewProgram: false,
    });

    expect(
      getStudentDetailRelationshipCapabilities({
        courseId: "course-1",
        enrollmentStatus: "active",
        role: "trainer",
        studentStatus: "active",
        trainerCohortCourseIds: [],
        trainerCourseIds: [],
      }),
    ).toEqual({
      canManageCohorts: false,
      canManageEnrollment: false,
      canRemoveEnrollment: false,
      canViewProgram: false,
    });
  });

  test("keeps cohort mutation unavailable for paused or inactive relationships", () => {
    expect(
      getStudentDetailRelationshipCapabilities({
        courseId: "course-1",
        enrollmentStatus: "paused",
        role: "staff",
        studentStatus: "active",
        trainerCohortCourseIds: [],
        trainerCourseIds: [],
      }).canManageCohorts,
    ).toBe(false);
    expect(
      getStudentDetailRelationshipCapabilities({
        courseId: "course-1",
        enrollmentStatus: "active",
        role: "staff",
        studentStatus: "inactive",
        trainerCohortCourseIds: [],
        trainerCourseIds: [],
      }).canManageCohorts,
    ).toBe(false);
  });
});

test.describe("UX-4D Student Detail architecture", () => {
  test("uses bounded relationship reads and one Trainer scope calculation", () => {
    const loader = read("src/lib/studentDetail.ts");

    expect(loader).toContain('.from("students")');
    expect(loader).toContain('.eq("id", params.studentId)');
    expect(loader.match(/\.eq\("student_id", params\.studentId\)/g)).toHaveLength(2);
    expect(loader).toContain('.in("id", cohortIds)');
    expect(loader).toContain('.in("id", courseIds)');
    expect(loader).toContain("getTrainerAssignedCourseIds");
    expect(loader).toContain("getTrainerAssignedCohortIds");
    expect(loader).not.toContain("getCurrentTrainerScope");
    expect(loader).not.toMatch(/\.map\(\s*async\b/);
  });

  test("preserves cohort-only relationships and hides unauthorized program links", () => {
    const loader = read("src/lib/studentDetail.ts");
    const component = read("src/components/students/StudentDetailClient.tsx");
    const enrollments = read("src/lib/enrollments.ts");

    expect(loader).toContain('.from("enrollments")');
    expect(loader).not.toMatch(/trainerCourseIds\.length\s*===\s*0[\s\S]{0,300}return null/);
    expect(enrollments).toContain("export async function getEnrollmentsForStudent");
    expect(enrollments).not.toMatch(
      /getEnrollmentsForStudent[\s\S]{0,500}trainerScope\.courseIds\.length === 0/,
    );
    expect(component).toContain(
      "relationship.program && relationship.canViewProgram ?",
    );
    expect(component).toContain("relationship.canManageEnrollment");
    expect(component).toContain("relationship.canManageCohorts");
  });

  test("loads portal evidence only for Owner and Admin and never loads finance history", () => {
    const loader = read("src/lib/studentDetail.ts");
    const component = read("src/components/students/StudentDetailClient.tsx");
    const changedSources = `${loader}\n${component}`;

    expect(loader).toContain('role === "owner" || role === "admin"');
    expect(loader).toContain("getStudentPortalInvitationStatus");
    expect(loader).toContain('permission: "view_payments"');
    expect(changedSources).not.toContain("getPaymentsByStudent");
    expect(changedSources).not.toContain("getPaymentLinksByStudent");
    expect(changedSources).not.toContain("Historical payment-link records");
    expect(changedSources).not.toContain("payment_url");
    expect(component).toContain('href="/app/finance"');
  });

  test("lazy-loads bounded mutation selectors outside the initial effect", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");
    const cohorts = read("src/lib/cohorts.ts");
    const enrollments = read("src/lib/enrollments.ts");
    const effectEnd = component.indexOf("async function openEnrollmentDialog");

    expect(effectEnd).toBeGreaterThan(0);
    expect(component.indexOf("getEnrollmentCourseOptions")).toBeLessThan(
      component.indexOf("export function StudentDetailClient"),
    );
    expect(
      component.indexOf("getEnrollmentCourseOptions(tenant.id)", effectEnd),
    ).toBeGreaterThan(effectEnd);
    expect(
      component.indexOf("getCohortAssignmentOptions({", effectEnd),
    ).toBeGreaterThan(effectEnd);
    expect(cohorts).toContain('.eq("course_id", params.courseId)');
    expect(enrollments).toContain('.select("id,title,status")');
  });

  test("renders operational hierarchy, archived programs, safe empty state, and no placeholders", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");

    for (const text of [
      "Student workspace",
      "Needs attention",
      "Programs &amp; enrollments",
      'label="Current"',
      'label="History"',
      "Other cohort memberships",
      "Operational shortcuts",
      "Profile &amp; notes",
      "Program {relationship.program.status}",
      "No program relationships",
    ]) {
      expect(component).toContain(text);
    }

    expect(component).not.toContain("Placeholder for a future module");
    expect(component.match(/onClick=\{openEnrollmentDialog\}/g)).toHaveLength(1);
  });

  test("keeps mutations on secure helpers with exact destructive copy", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");
    const changedSources = [
      component,
      read("src/lib/studentDetail.ts"),
      read("src/lib/cohorts.ts"),
      read("src/lib/enrollments.ts"),
    ].join("\n");

    expect(component).toContain("createEnrollment({");
    expect(component).toContain("updateEnrollmentStatus({");
    expect(component).toContain("deleteEnrollment({");
    expect(component).toContain("addStudentToCohort({");
    expect(component).toContain(
      "permanently deletes the enrollment relationship record",
    );
    expect(changedSources).not.toMatch(
      /\.from\(["'](?:students|enrollments|cohort_members)["']\)[\s\S]{0,300}\.(?:insert|update|delete)\(/,
    );
  });

  test("uses safe errors and accessible viewport-bound dialogs", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");

    expect(component).toContain("safeActionError");
    expect(component).toContain("Unable to load this student. Please try again.");
    expect(component).not.toContain("getErrorMessage");
    expect(component).toContain('aria-modal="true"');
    expect(component).toContain('role="dialog"');
    expect(component).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(component).toContain("overflow-y-auto");
    expect(component).toContain('event.key === "Escape"');
    expect(component).toContain("previousFocus?.focus()");
  });

  test("keeps mobile relationships readable and Trainer finance/Add Student absent", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");
    const loader = read("src/lib/studentDetail.ts");

    expect(component).toContain("flex flex-col gap-4 lg:flex-row");
    expect(component).toContain("wrap-break-word");
    expect(component).toContain("sm:max-h-[calc(100dvh-3rem)]");
    expect(loader).toContain('role !== "trainer"');
    expect(component).not.toContain("Add Student");
    expect(component).not.toContain("payment link");
  });
});
