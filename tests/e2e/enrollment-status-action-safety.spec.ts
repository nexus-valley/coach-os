import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canCreateStudentDetailEnrollment,
  getAvailableStudentDetailEnrollmentOptions,
  getStudentDetailEnrollmentAction,
  studentDetailEnrollmentTransitions,
  type StudentDetailRelationship,
} from "../../src/lib/studentDetailModel";
import type { EnrollmentStatus } from "../../src/lib/enrollments";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function relationshipForCourse(
  courseId: string,
  status: EnrollmentStatus = "active",
): StudentDetailRelationship {
  return {
    canManageCohorts: true,
    canManageEnrollment: true,
    canRemoveEnrollment: false,
    canViewProgram: true,
    cohorts: [],
    enrollment: {
      completed_at:
        status === "completed" ? "2026-02-01T00:00:00.000Z" : null,
      course_id: courseId,
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: null,
      enrolled_at: "2026-01-01T00:00:00.000Z",
      id: `enrollment-${courseId}`,
      status,
      student_id: "student-1",
      tenant_id: "tenant-1",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    program: {
      id: courseId,
      status: "published",
      title: `Program ${courseId}`,
    },
  };
}

test.describe("UX-4E enrollment status action model", () => {
  const actions: Array<{
    current: EnrollmentStatus;
    label: string;
    success: string;
    target: EnrollmentStatus;
  }> = [
    {
      current: "active",
      label: "Pause enrollment",
      success: "Enrollment paused.",
      target: "paused",
    },
    {
      current: "active",
      label: "Complete enrollment",
      success: "Enrollment completed.",
      target: "completed",
    },
    {
      current: "active",
      label: "Cancel enrollment",
      success: "Enrollment cancelled.",
      target: "cancelled",
    },
    {
      current: "paused",
      label: "Resume enrollment",
      success: "Enrollment resumed.",
      target: "active",
    },
    {
      current: "paused",
      label: "Cancel enrollment",
      success: "Enrollment cancelled.",
      target: "cancelled",
    },
    {
      current: "cancelled",
      label: "Reactivate enrollment",
      success: "Enrollment reactivated.",
      target: "active",
    },
  ];

  for (const actionCase of actions) {
    test(`${actionCase.current} to ${actionCase.target} uses deliberate copy`, () => {
      const action = getStudentDetailEnrollmentAction({
        currentStatus: actionCase.current,
        targetStatus: actionCase.target,
      });

      expect(action).toMatchObject({
        confirmLabel: actionCase.label,
        label: actionCase.label,
        successMessage: actionCase.success,
        targetStatus: actionCase.target,
      });
      expect(action?.description).toContain("Portal identity and payment state remain separate.");
    });
  }

  test("keeps completed terminal and rejects impossible action metadata", () => {
    expect(studentDetailEnrollmentTransitions.completed).toEqual([]);
    expect(
      getStudentDetailEnrollmentAction({
        currentStatus: "completed",
        targetStatus: "active",
      }),
    ).toBeNull();
    expect(
      getStudentDetailEnrollmentAction({
        currentStatus: "paused",
        targetStatus: "completed",
      }),
    ).toBeNull();
  });

  test("documents terminal completion and reuse semantics", () => {
    const complete = getStudentDetailEnrollmentAction({
      currentStatus: "active",
      targetStatus: "completed",
    });
    const resume = getStudentDetailEnrollmentAction({
      currentStatus: "paused",
      targetStatus: "active",
    });
    const reactivate = getStudentDetailEnrollmentAction({
      currentStatus: "cancelled",
      targetStatus: "active",
    });

    expect(complete?.description).toContain(
      "Completed enrollments cannot be resumed or reactivated.",
    );
    expect(resume?.description).toContain("No new enrollment record is created.");
    expect(reactivate?.description).toContain(
      "its original record is reused. No new enrollment is created.",
    );
  });

  test("supports first and additional programs while excluding every existing relationship", () => {
    const options = [
      { id: "course-1", status: "published" as const, title: "Program One" },
      { id: "course-2", status: "draft" as const, title: "Program Two" },
      { id: "course-3", status: "archived" as const, title: "Program Three" },
    ];

    expect(
      getAvailableStudentDetailEnrollmentOptions({
        options,
        relationships: [],
      }).map((option) => option.id),
    ).toEqual(["course-1", "course-2", "course-3"]);
    expect(
      getAvailableStudentDetailEnrollmentOptions({
        options,
        relationships: [relationshipForCourse("course-1")],
      }).map((option) => option.id),
    ).toEqual(["course-2", "course-3"]);
    expect(
      getAvailableStudentDetailEnrollmentOptions({
        options,
        relationships: [
          relationshipForCourse("course-1"),
          relationshipForCourse("course-2", "completed"),
        ],
      }).map((option) => option.id),
    ).toEqual(["course-3"]);
  });

  test("allows eligible roles only for active students and direct-course Trainers", () => {
    for (const role of ["owner", "admin", "staff"] as const) {
      expect(
        canCreateStudentDetailEnrollment({
          role,
          studentStatus: "active",
          trainerCourseIds: [],
        }),
      ).toBe(true);
    }

    for (const studentStatus of ["inactive", "lead", "blocked"] as const) {
      expect(
        canCreateStudentDetailEnrollment({
          role: "owner",
          studentStatus,
          trainerCourseIds: [],
        }),
      ).toBe(false);
    }

    expect(
      canCreateStudentDetailEnrollment({
        role: "trainer",
        studentStatus: "active",
        trainerCourseIds: ["course-1"],
      }),
    ).toBe(true);
    expect(
      canCreateStudentDetailEnrollment({
        role: "trainer",
        studentStatus: "active",
        trainerCourseIds: [],
      }),
    ).toBe(false);
  });
});

test.describe("UX-4E enrollment workflow architecture", () => {
  test("opens confirmation before invoking the existing secure status helper", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");
    const requestHandler = sourceBetween(
      component,
      "function requestStatusChange(",
      "async function handleStatusChange()",
    );
    const mutationHandler = sourceBetween(
      component,
      "async function handleStatusChange()",
      "async function handleDeleteStudent()",
    );

    expect(requestHandler).toContain("setStatusActionTarget");
    expect(requestHandler).not.toContain("updateEnrollmentStatus");
    expect(mutationHandler).toContain("updateEnrollmentStatus({");
    expect(component).toContain("statusActionTarget.action.description");
    expect(component).toContain("statusActionTarget.action.confirmLabel");
    expect(component).toContain("Keep current status");
    expect(component).toContain("statusActionTarget.relationship.program?.title");
  });

  test("removes routine hard deletion while retaining the reviewed backend helper", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");
    const enrollments = read("src/lib/enrollments.ts");

    expect(component).not.toContain("deleteEnrollment");
    expect(component).not.toContain("Remove enrollment");
    expect(component).not.toContain("Remove relationship");
    expect(enrollments).toContain("export async function deleteEnrollment");
    expect(enrollments).toContain('.rpc("remove_enrollment_secure"');
  });

  test("preserves bounded creation and current draft or archived behavior", () => {
    const component = read("src/components/students/StudentDetailClient.tsx");
    const enrollments = read("src/lib/enrollments.ts");
    const optionsLoader = sourceBetween(
      enrollments,
      "export async function getEnrollmentCourseOptions",
      "export async function createEnrollment",
    );

    expect(component).toContain("getEnrollmentCourseOptions(tenant.id)");
    expect(component).toContain("getAvailableStudentDetailEnrollmentOptions({");
    expect(component).toContain('status: "active"');
    expect(enrollments).toContain('.rpc("create_enrollment_secure"');
    expect(optionsLoader).toContain('.select("id,title,status")');
    expect(optionsLoader).not.toMatch(/\.eq\("status",/);
    expect(component).toContain(
      "New enrollments start active. Payment and portal access remain",
    );
  });

  test("lets RLS return direct and exact cohort enrollment rows without widening links", () => {
    const enrollments = read("src/lib/enrollments.ts");
    const page = read("src/components/enrollments/EnrollmentsPageClient.tsx");
    const tenantLoader = sourceBetween(
      enrollments,
      "async function getEnrollmentsByFilter",
      "export async function getEnrollmentsForTenant",
    );

    expect(tenantLoader).toContain('.from("enrollments")');
    expect(tenantLoader).not.toContain(
      'query = query.in("course_id", trainerScope.courseIds)',
    );
    expect(tenantLoader).not.toMatch(
      /trainerScope\.courseIds\.length\s*===\s*0[\s\S]{0,100}return \[\]/,
    );
    expect(tenantLoader).toContain('filter?.column === "course_id"');
    expect(enrollments).toContain("canOpenCourse:");
    expect(enrollments).toContain("trainerCourseIds.includes(enrollment.course_id)");
    expect(page.match(/enrollment\.canOpenCourse \?/g)).toHaveLength(2);
    expect(page).not.toContain("updateEnrollmentStatus");
    expect(page).not.toContain("createEnrollment");
  });

  test("uses safe errors and a stacked mobile enrollment view", () => {
    const enrollmentsPage = read(
      "src/components/enrollments/EnrollmentsPageClient.tsx",
    );
    const courseDetail = read("src/components/courses/CourseDetailClient.tsx");
    const cohortDetail = read("src/components/cohorts/CohortDetailClient.tsx");

    expect(enrollmentsPage).toContain(
      "Unable to load enrollments right now. Please try again.",
    );
    expect(enrollmentsPage).not.toContain("caught.message");
    expect(enrollmentsPage).toContain('className="mt-6 grid gap-3 md:hidden"');
    expect(enrollmentsPage).toContain("md:block");
    expect(enrollmentsPage).toContain("Enrollment state");
    expect(courseDetail).toContain(
      "Unable to load this program right now. Please try again.",
    );
    expect(cohortDetail).not.toContain("getErrorMessage");
    expect(cohortDetail).toContain(
      "Unable to add this student to the cohort. Please try again.",
    );
  });

  test("does not overclaim request lifecycle as active enrollment state", () => {
    const courseDetail = read("src/components/courses/CourseDetailClient.tsx");

    expect(courseDetail).not.toContain("Student enrollment is active.");
    expect(courseDetail).toContain(
      "The request created or reused an enrollment. Current enrollment and portal access are managed separately.",
    );
  });

  test("introduces no direct writes, portal lookup, or finance coupling", () => {
    const changedSources = [
      read("src/components/students/StudentDetailClient.tsx"),
      read("src/components/enrollments/EnrollmentsPageClient.tsx"),
      read("src/lib/enrollments.ts"),
    ].join("\n");

    expect(changedSources).not.toMatch(
      /\.from\(["']enrollments["']\)[\s\S]{0,300}\.(?:insert|update|delete|upsert)\(/,
    );
    expect(changedSources).not.toContain("student_portal_accounts");
    expect(changedSources).not.toContain("payment_links");
    expect(changedSources).not.toContain('.from("payments")');
    expect(changedSources).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
