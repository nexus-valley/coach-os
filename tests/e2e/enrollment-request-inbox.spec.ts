import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canApproveEnrollmentRequest,
  canRejectEnrollmentRequest,
  filterEnrollmentRequests,
  getEnrollmentRequestEmptyTitle,
  getEnrollmentRequestLifecycleStatus,
  getEnrollmentRequestStatusLabel,
  getNeedsAttentionGuidance,
} from "../../src/lib/enrollmentRequestInbox";
import type { PublicSiteLead } from "../../src/lib/publicSite";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function request(
  id: string,
  overrides: Partial<PublicSiteLead> = {},
): PublicSiteLead {
  return {
    created_at: "2026-08-08T08:00:00.000Z",
    email: `${id}@example.test`,
    id,
    interested_course_id: "course-one",
    message: null,
    name: `Prospect ${id}`,
    phone: null,
    source: "public_program_request",
    status: "new",
    ...overrides,
  };
}

test.describe("enrollment request inbox behavior", () => {
  const requests: PublicSiteLead[] = [
    request("new", { enrollment_request_status: "new", name: "Asha New" }),
    request("attention", {
      enrollment_request_status: "needs_attention",
      last_error_code: "enrollment_requires_review",
    }),
    request("enrolled", {
      email: "enrolled@example.test",
      enrollment_request_status: "enrolled",
      interested_course_id: "course-two",
    }),
    request("rejected", { enrollment_request_status: "rejected" }),
    request("processing", { enrollment_request_status: "processing" }),
  ];
  const courseTitleById = {
    "course-one": "Coach Foundations",
    "course-two": "Leadership Program",
  };

  test("uses canonical lifecycle state without legacy inference", () => {
    expect(
      getEnrollmentRequestLifecycleStatus(
        request("canonical", {
          enrollment_request_status: "new",
          status: "converted",
        }),
      ),
    ).toBe("new");
    expect(
      getEnrollmentRequestLifecycleStatus(
        request("compatibility", { status: "converted" }),
      ),
    ).toBe("new");
    expect(getEnrollmentRequestStatusLabel("processing")).toBe("Processing");
  });

  test("filters canonical states while processing remains visible in All", () => {
    for (const status of [
      "new",
      "needs_attention",
      "enrolled",
      "rejected",
    ] as const) {
      const result = filterEnrollmentRequests({
        courseId: "",
        courseTitleById,
        requests,
        search: "",
        status,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.enrollment_request_status).toBe(status);
    }

    expect(
      filterEnrollmentRequests({
        courseId: "",
        courseTitleById,
        requests,
        search: "",
        status: "all",
      }).map((item) => item.id),
    ).toContain("processing");
  });

  test("searches safe prospect, email, and program fields", () => {
    for (const search of ["asha", "enrolled@example", "leadership program"]) {
      expect(
        filterEnrollmentRequests({
          courseId: "",
          courseTitleById,
          requests,
          search,
          status: "all",
        }),
      ).toHaveLength(1);
    }
  });

  test("filters by program and exposes stable empty states", () => {
    expect(
      filterEnrollmentRequests({
        courseId: "course-two",
        courseTitleById,
        requests,
        search: "",
        status: "all",
      }).map((item) => item.id),
    ).toEqual(["enrolled"]);
    expect(
      getEnrollmentRequestEmptyTitle({
        courseId: "",
        search: "",
        status: "all",
      }),
    ).toBe("No enrollment requests yet.");
    expect(
      getEnrollmentRequestEmptyTitle({
        courseId: "",
        search: "",
        status: "new",
      }),
    ).toBe("No new requests.");
    expect(
      getEnrollmentRequestEmptyTitle({
        courseId: "",
        search: "missing",
        status: "all",
      }),
    ).toBe("No matching requests.");
  });

  test("needs-attention guidance is bounded and coach-facing", () => {
    expect(getNeedsAttentionGuidance("enrollment_requires_review")).toBe(
      "Review the existing enrollment before continuing.",
    );
    expect(getNeedsAttentionGuidance("arbitrary-database-detail")).toBe(
      "Review the student and program details before continuing.",
    );
  });

  test("limits lifecycle mutations to intentional states", () => {
    expect(canApproveEnrollmentRequest("new")).toBe(true);

    for (const status of [
      "processing",
      "needs_attention",
      "enrolled",
      "rejected",
    ] as const) {
      expect(canApproveEnrollmentRequest(status)).toBe(false);
    }

    expect(canRejectEnrollmentRequest("new")).toBe(true);
    expect(canRejectEnrollmentRequest("needs_attention")).toBe(true);
    expect(canRejectEnrollmentRequest("enrolled")).toBe(false);
    expect(canRejectEnrollmentRequest("rejected")).toBe(false);
  });

  test("keeps Requests navigation Owner/Admin-only", () => {
    const permissions = read("src/lib/permissions.ts");

    expect(permissions).toContain("Requests: canAccessRequests");
    expect(permissions).toContain(
      "export function canAccessRequests(role: MemberRole | null | undefined)",
    );
    expect(permissions).toContain('return hasPermission(role, "manage_courses")');
  });
});

test.describe("enrollment request inbox architecture", () => {
  test("registers one central Requests route with existing guards", () => {
    const page = read("app/app/enrollment-requests/page.tsx");
    const shell = read("src/components/layout/AppShell.tsx");
    const permissions = read("src/lib/permissions.ts");
    const features = read("src/lib/featureAccess.ts");

    expect(page).toContain('<RouteGuard mode="app">');
    expect(page).toContain('<AppShell activeItem="Requests">');
    expect(shell).toContain('/app/enrollment-requests", label: "Requests"');
    expect(permissions).toContain("Requests: canAccessRequests");
    expect(features).toContain('Requests: "courses"');
  });

  test("reuses UX-3C v2 and UX-3D without manual matching or payment controls", () => {
    const component = read(
      "src/components/enrollment-requests/EnrollmentRequestsPageClient.tsx",
    );
    const publicSite = read("src/lib/publicSite.ts");
    const courseDetail = read("src/components/courses/CourseDetailClient.tsx");

    expect(component).toContain("approvePublicProgramEnrollmentRequest");
    expect(component).toContain("rejectPublicProgramEnrollmentRequest");
    expect(component).toContain("getStudentPortalInvitationStatus");
    expect(component).toContain("sendStudentPortalInvitation");
    expect(publicSite).toContain(
      '"approve_public_program_enrollment_request_v2"',
    );
    expect(publicSite).toContain(
      '"reject_public_program_enrollment_request_v2"',
    );
    expect(component).not.toContain("studentAction");
    expect(component).not.toContain("Create student");
    expect(component).not.toContain("Link student");
    expect(component).not.toContain("payment_confirmation_mode");
    expect(component).not.toContain("payment_reference");
    expect(courseDetail).toContain(
      "View enrollment requests",
    );
    expect(courseDetail).toContain("/app/enrollment-requests?course=");
    expect(courseDetail).not.toContain(
      "approvePublicProgramEnrollmentRequest",
    );
    expect(courseDetail).not.toContain("sendStudentPortalInvitation");
  });

  test("keeps mutations Owner/Admin-only and supports responsive states", () => {
    const component = read(
      "src/components/enrollment-requests/EnrollmentRequestsPageClient.tsx",
    );
    const inbox = read("src/lib/enrollmentRequestInbox.ts");

    expect(component).toContain(
      'const canMutate = role === "owner" || role === "admin"',
    );
    expect(component).toContain(
      'currentRole !== "owner" && currentRole !== "admin"',
    );
    expect(component).toContain("Only workspace owners and admins");
    expect(component).toContain('className="hidden min-w-[900px] lg:block"');
    expect(component).toContain(
      'className="divide-y divide-[#E2E8F0] lg:hidden"',
    );
    expect(inbox).toContain("No enrollment requests yet.");
    expect(inbox).toContain("No new requests.");
    expect(inbox).toContain("No matching requests.");
  });
});
