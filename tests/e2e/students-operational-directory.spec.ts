import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  defaultStudentDirectoryFilters,
  deriveStudentPortalState,
  filterStudentDirectoryRows,
  getStudentDirectoryEmptyCopy,
  sortStudentDirectoryRows,
  type StudentDirectoryRow,
} from "../../src/lib/studentDirectory";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const rows: StudentDirectoryRow[] = [
  {
    enrollments: [
      {
        canOpenCourse: true,
        courseId: "program-a",
        courseTitle: "Leadership Foundations",
        enrolledAt: "2026-05-01T00:00:00.000Z",
        id: "enrollment-a",
        status: "active",
      },
      {
        canOpenCourse: true,
        courseId: "program-b",
        courseTitle: "Executive Practice",
        enrolledAt: "2026-04-01T00:00:00.000Z",
        id: "enrollment-b",
        status: "paused",
      },
    ],
    portalState: "access_active",
    student: {
      created_at: "2026-05-02T00:00:00.000Z",
      created_by: null,
      email: "alice@example.com",
      full_name: "Alice Johnson",
      id: "student-a",
      notes: null,
      phone: "+1 555 0101",
      portal_enabled: true,
      source: "Request",
      status: "active",
      tenant_id: "tenant-a",
      updated_at: "2026-05-02T00:00:00.000Z",
    },
  },
  {
    enrollments: [],
    portalState: "access_unavailable",
    student: {
      created_at: "2026-05-03T00:00:00.000Z",
      created_by: null,
      email: "lead@example.com",
      full_name: "Ben Lead",
      id: "student-b",
      notes: null,
      phone: "+1 555 0102",
      portal_enabled: false,
      source: "Direct",
      status: "lead",
      tenant_id: "tenant-a",
      updated_at: "2026-05-03T00:00:00.000Z",
    },
  },
  {
    enrollments: [
      {
        canOpenCourse: true,
        courseId: "program-a",
        courseTitle: "Leadership Foundations",
        enrolledAt: "2026-03-01T00:00:00.000Z",
        id: "enrollment-c",
        status: "completed",
      },
    ],
    portalState: "access_unavailable",
    student: {
      created_at: "2026-04-01T00:00:00.000Z",
      created_by: null,
      email: "carol@example.com",
      full_name: "Carol Singh",
      id: "student-c",
      notes: null,
      phone: null,
      portal_enabled: true,
      source: "Request",
      status: "inactive",
      tenant_id: "tenant-a",
      updated_at: "2026-04-01T00:00:00.000Z",
    },
  },
  {
    enrollments: [],
    portalState: "no_active_access",
    student: {
      created_at: "2026-03-01T00:00:00.000Z",
      created_by: null,
      email: null,
      full_name: "Dana Morris",
      id: "student-d",
      notes: null,
      phone: "+1 555 0104",
      portal_enabled: true,
      source: null,
      status: "active",
      tenant_id: "tenant-a",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
  },
];

test.describe("UX-4C student directory behavior", () => {
  test("searches name, email, and phone case-insensitively", () => {
    for (const [search, expectedId] of [
      ["ALICE", "student-a"],
      ["carol@example.com", "student-c"],
      ["0104", "student-d"],
    ]) {
      const result = filterStudentDirectoryRows(rows, {
        ...defaultStudentDirectoryFilters,
        search,
      });

      expect(result.map((row) => row.student.id)).toEqual([expectedId]);
    }
  });

  test("filters canonical student status independently", () => {
    const result = filterStudentDirectoryRows(rows, {
      ...defaultStudentDirectoryFilters,
      studentStatus: "active",
    });

    expect(result.map((row) => row.student.id)).toEqual([
      "student-a",
      "student-d",
    ]);
  });

  test("filters program and enrollment status against the same relationship", () => {
    const matching = filterStudentDirectoryRows(rows, {
      ...defaultStudentDirectoryFilters,
      enrollmentStatus: "paused",
      programId: "program-b",
    });
    const notMatching = filterStudentDirectoryRows(rows, {
      ...defaultStudentDirectoryFilters,
      enrollmentStatus: "completed",
      programId: "program-b",
    });

    expect(matching.map((row) => row.student.id)).toEqual(["student-a"]);
    expect(notMatching).toEqual([]);
  });

  test("filters authoritative portal-access states", () => {
    const active = filterStudentDirectoryRows(rows, {
      ...defaultStudentDirectoryFilters,
      portalState: "access_active",
    });
    const noActiveAccess = filterStudentDirectoryRows(rows, {
      ...defaultStudentDirectoryFilters,
      portalState: "no_active_access",
    });

    expect(active.map((row) => row.student.id)).toEqual(["student-a"]);
    expect(noActiveAccess.map((row) => row.student.id)).toEqual(["student-d"]);
  });

  test("reset defaults restore the complete directory", () => {
    expect(
      filterStudentDirectoryRows(rows, defaultStudentDirectoryFilters),
    ).toHaveLength(rows.length);
  });

  test("keeps student and enrollment status as separate concepts", () => {
    const activeStudent = rows[0];

    expect(activeStudent.student.status).toBe("active");
    expect(activeStudent.enrollments.map((item) => item.status)).toEqual([
      "active",
      "paused",
    ]);
  });

  test("derives access only from student eligibility and portal-account evidence", () => {
    expect(
      deriveStudentPortalState({
        canViewPortalAccounts: true,
        portalAccountStatus: "active",
        portalEnabled: true,
        studentStatus: "active",
      }),
    ).toBe("access_active");
    expect(
      deriveStudentPortalState({
        canViewPortalAccounts: true,
        portalAccountStatus: "pending",
        portalEnabled: true,
        studentStatus: "active",
      }),
    ).toBe("no_active_access");
    expect(
      deriveStudentPortalState({
        canViewPortalAccounts: true,
        portalAccountStatus: "revoked",
        portalEnabled: true,
        studentStatus: "active",
      }),
    ).toBe("access_unavailable");
    expect(
      deriveStudentPortalState({
        canViewPortalAccounts: true,
        portalAccountStatus: "active",
        portalEnabled: false,
        studentStatus: "active",
      }),
    ).toBe("access_unavailable");
    expect(
      deriveStudentPortalState({
        canViewPortalAccounts: true,
        portalAccountStatus: "active",
        portalEnabled: true,
        studentStatus: "blocked",
      }),
    ).toBe("access_unavailable");
    expect(
      deriveStudentPortalState({
        canViewPortalAccounts: false,
        portalAccountStatus: null,
        portalEnabled: true,
        studentStatus: "active",
      }),
    ).toBe("status_restricted");
  });

  test("supports stable newest and name sorting", () => {
    expect(sortStudentDirectoryRows(rows, "newest")[0].student.id).toBe(
      "student-b",
    );
    expect(sortStudentDirectoryRows(rows, "name")[0].student.id).toBe(
      "student-a",
    );

    const tiedRows = rows.slice(0, 2).map((row) => ({
      ...row,
      student: {
        ...row.student,
        created_at: "2026-05-02T00:00:00.000Z",
        full_name: "Same Name",
      },
    }));

    expect(
      sortStudentDirectoryRows(tiedRows.reverse(), "name").map(
        (row) => row.student.id,
      ),
    ).toEqual(["student-a", "student-b"]);
    expect(
      sortStudentDirectoryRows(tiedRows.reverse(), "newest").map(
        (row) => row.student.id,
      ),
    ).toEqual(["student-a", "student-b"]);
  });

  test("provides distinct tenant-empty, search-empty, and filter-empty copy", () => {
    expect(
      getStudentDirectoryEmptyCopy({
        hasFilters: false,
        hasSearch: false,
        totalStudents: 0,
      }).title,
    ).toBe("No students yet");
    expect(
      getStudentDirectoryEmptyCopy({
        hasFilters: false,
        hasSearch: true,
        totalStudents: 4,
      }).title,
    ).toBe("No matching students");
    expect(
      getStudentDirectoryEmptyCopy({
        hasFilters: true,
        hasSearch: false,
        totalStudents: 4,
      }).title,
    ).toBe("No students match these filters");
  });
});

test.describe("UX-4C student directory architecture", () => {
  test("uses RLS-authorized students and explicitly bounded secondary reads", () => {
    const students = read("src/lib/students.ts");
    const component = read(
      "src/components/students/StudentsPageClient.tsx",
    );
    const changedSources = `${students}\n${component}`;

    expect(students).toContain("const authorizedStudentIds = students.map");
    expect(students).toContain('.from("enrollments")');
    expect(students).toContain('.in("student_id", authorizedStudentIds)');
    expect(students).toContain('.from("courses")');
    expect(students).toContain('.in("id", courseIds)');
    expect(students).toContain('.from("student_portal_accounts")');
    expect(students).toContain('.select("student_id,status")');
    expect(students.match(/\.in\("student_id", authorizedStudentIds\)/g)).toHaveLength(2);
    expect(students).not.toContain("getTrainerDirectoryCourseIds");
    expect(students).not.toContain('.in("course_id", trainerCourseIds)');
    expect(students).not.toMatch(/trainerScope\.cohortIds[\s\S]{0,500}course_id/);
    expect(students).not.toContain("getStudentPortalInvitationStatus");
    expect(changedSources).not.toContain("student_portal_invitations");
    expect(changedSources).not.toContain("payment_links");
    expect(changedSources).not.toContain('.from("payments")');
    expect(changedSources).not.toContain("getSupabaseAdminClient");
    expect(changedSources).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(changedSources).not.toMatch(/\.map\(\s*async\b/);
  });

  test("keeps cohort-only program metadata non-navigable", () => {
    const students = read("src/lib/students.ts");
    const component = read(
      "src/components/students/StudentsPageClient.tsx",
    );

    expect(students).toContain("canOpenCourse:");
    expect(students).toContain("trainerScope?.courseIds.includes");
    expect(component).toContain("enrollment.canOpenCourse ?");
    expect(component).toContain('href={`/app/courses/${enrollment.courseId}`}');
  });

  test("keeps student and enrollment mutations on existing secure RPCs", () => {
    const students = read("src/lib/students.ts");
    const component = read(
      "src/components/students/StudentsPageClient.tsx",
    );

    expect(students).toContain('.rpc("create_student_secure"');
    expect(component).not.toMatch(
      /\.from\(["'](?:students|enrollments)["']\)[\s\S]{0,300}\.(?:insert|update|delete)\(/,
    );
  });

  test("preserves Add Student and Trainer boundaries", () => {
    const component = read(
      "src/components/students/StudentsPageClient.tsx",
    );

    expect(component).toContain(
      'memberRole !== null && memberRole !== "trainer"',
    );
    expect(component).toContain("formOpen && canCreateStudent");
    expect(component).toContain("Add Student");
  });

  test("renders operational desktop, labeled mobile, loading, and detail-link states", () => {
    const component = read(
      "src/components/students/StudentsPageClient.tsx",
    );

    for (const copy of [
      "Student directory",
      "Search students",
      "Student status filter",
      "All programs",
      "All enrollments",
      "All portal states",
      "Loading student directory",
      "Programs",
      "Portal",
      "View student",
    ]) {
      expect(component).toContain(copy);
    }
    expect(component).toContain('href={`/app/students/${row.student.id}`}');
    expect(component).toContain("lg:hidden");
    expect(component).toContain("hidden min-w-[920px] lg:block");
  });
});
