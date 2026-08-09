import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildEnrollmentRequestActivity,
  getEnrollmentRequestRecovery,
} from "../../src/lib/enrollmentRequestActivity";
import type { PublicSiteLead } from "../../src/lib/publicSite";
import type { StudentPortalInvitationSummary } from "../../src/lib/studentPortalInvitations";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function request(overrides: Partial<PublicSiteLead> = {}): PublicSiteLead {
  return {
    created_at: "2026-08-09T08:00:00.000Z",
    email: "student@example.test",
    id: "request-one",
    interested_course_id: "course-one",
    message: null,
    name: "Regression Student",
    phone: null,
    source: "public_program_request",
    status: "new",
    ...overrides,
  };
}

function invitation(
  overrides: Partial<StudentPortalInvitationSummary> = {},
): StudentPortalInvitationSummary {
  return {
    accepted_at: null,
    attempt_count: 0,
    can_resend: false,
    expires_at: "2026-08-10T08:00:00.000Z",
    sent_at: null,
    status: "invitation_not_sent",
    ...overrides,
  };
}

test.describe("request activity presentation", () => {
  test("builds received and approval events only from canonical fields", () => {
    const events = buildEnrollmentRequestActivity({
      request: request({
        metadata_json: {
          provider_error: "private provider detail",
          token_hash: "not-browser-safe",
        },
        processing_started_at: "2026-08-09T08:05:00.000Z",
      }),
    });

    expect(events).toEqual([
      {
        key: "request_received",
        label: "Request received",
        timestamp: "2026-08-09T08:00:00.000Z",
      },
      {
        key: "approval_started",
        label: "Approval started",
        timestamp: "2026-08-09T08:05:00.000Z",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("provider_error");
    expect(JSON.stringify(events)).not.toContain("token_hash");
  });

  test("presents safely evidenced student, enrollment, and enrolled outcomes", () => {
    const labels = buildEnrollmentRequestActivity({
      request: request({
        approval_enrollment_action: "reused",
        approval_student_action: "matched",
        converted_at: "2026-08-09T08:10:00.000Z",
        enrollment_request_status: "enrolled",
        processed_at: "2026-08-09T08:10:00.000Z",
        status: "converted",
      }),
    }).map((event) => event.label);

    expect(labels).toEqual([
      "Request received",
      "Student matched",
      "Existing enrollment reused",
      "Request enrolled",
    ]);
  });

  test("presents rejected and needs-attention lifecycle outcomes", () => {
    const rejected = buildEnrollmentRequestActivity({
      request: request({
        enrollment_request_status: "rejected",
        processed_at: "2026-08-09T08:12:00.000Z",
        status: "closed",
      }),
    });
    const attention = buildEnrollmentRequestActivity({
      request: request({
        enrollment_request_status: "needs_attention",
        processed_at: "2026-08-09T08:12:00.000Z",
      }),
    });

    expect(rejected.at(-1)?.label).toBe("Request rejected");
    expect(attention.at(-1)?.label).toBe("Request needs attention");
  });

  test("uses safe invitation evidence for sent and access-active activity", () => {
    const sent = buildEnrollmentRequestActivity({
      invitation: invitation({
        sent_at: "2026-08-09T08:15:00.000Z",
        status: "invitation_sent",
      }),
      request: request(),
    });
    const active = buildEnrollmentRequestActivity({
      invitation: invitation({ status: "access_active" }),
      request: request(),
    });

    expect(sent.at(-1)?.label).toBe("Portal invitation sent");
    expect(active.at(-1)).toEqual({
      key: "portal_access_active",
      label: "Portal access active",
      timestamp: null,
    });
  });
});

test.describe("request recovery classification", () => {
  test("maps known student and enrollment conflicts to reviewed destinations", () => {
    const studentConflict = getEnrollmentRequestRecovery({
      request: request({
        enrollment_request_status: "needs_attention",
        last_error_code: "ambiguous_student_phone",
      }),
    });
    const enrollmentConflict = getEnrollmentRequestRecovery({
      request: request({
        enrollment_request_status: "needs_attention",
        last_error_code: "enrollment_requires_review",
      }),
    });

    expect(studentConflict?.category).toBe("student_record_conflict");
    expect(studentConflict?.action).toBe("open_program");
    expect(enrollmentConflict?.category).toBe("enrollment_conflict");
    expect(enrollmentConflict?.action).toBe("review_enrollment");
  });

  test("reuses invitation retry only when the existing lifecycle allows it", () => {
    const retry = getEnrollmentRequestRecovery({
      invitation: invitation({ can_resend: true, status: "needs_attention" }),
      request: request({
        converted_student_id: "student-one",
        enrollment_request_status: "enrolled",
      }),
    });
    const portalConflict = getEnrollmentRequestRecovery({
      invitation: invitation({ can_resend: false, status: "needs_attention" }),
      request: request({
        converted_student_id: "student-one",
        enrollment_request_status: "enrolled",
      }),
    });

    expect(retry).toMatchObject({
      action: "retry_invitation",
      category: "invitation_retry",
      title: "Invitation needs retry",
    });
    expect(portalConflict).toMatchObject({
      action: "review_student",
      category: "portal_access_conflict",
    });
  });

  test("keeps unknown errors bounded and never renders technical detail", () => {
    const recovery = getEnrollmentRequestRecovery({
      request: request({
        enrollment_request_status: "needs_attention",
        last_error_code: "provider_private_stack_or_rpc_message",
      }),
    });

    expect(recovery).toEqual({
      action: "open_program",
      category: "manual_review",
      description: "Review this request and its related student record.",
      title: "Manual review required",
    });
    expect(JSON.stringify(recovery)).not.toContain("provider_private");
  });
});

test.describe("request activity architecture", () => {
  test("keeps history in the central guarded inbox and reuses existing actions", () => {
    const component = read(
      "src/components/enrollment-requests/EnrollmentRequestsPageClient.tsx",
    );
    const page = read("app/app/enrollment-requests/page.tsx");
    const publicSite = read("src/lib/publicSite.ts");

    expect(component).toContain("Request history");
    expect(component).toContain("sendStudentPortalInvitation");
    expect(component).toContain("Retry invitation");
    expect(component).toContain('href="/app/enrollments"');
    expect(component).toContain(
      'selectedRecovery?.action !== "open_program"',
    );
    expect(component).toContain(
      'selectedRecovery?.action !== "review_student"',
    );
    expect(component).not.toContain("audit_logs");
    expect(component).not.toContain("raw metadata");
    expect(component).not.toMatch(/>\s*Fix\s*</);
    expect(page).toContain('<RouteGuard mode="app">');
    expect(page).toContain('<AppShell activeItem="Requests">');
    expect(publicSite).toContain("processing_started_at");
  });

  test("preserves role, mobile, privacy, and payment boundaries", () => {
    const component = read(
      "src/components/enrollment-requests/EnrollmentRequestsPageClient.tsx",
    );
    const activity = read("src/lib/enrollmentRequestActivity.ts");
    const courseDetail = read("src/components/courses/CourseDetailClient.tsx");

    expect(component).toContain(
      'const canMutate = role === "owner" || role === "admin"',
    );
    expect(component).toContain(
      'currentRole !== "owner" && currentRole !== "admin"',
    );
    expect(component).toContain("max-h-[calc(100vh-1.5rem)]");
    expect(component).toContain("overflow-y-auto");
    expect(activity).not.toContain("metadata_json");
    expect(activity).not.toContain("audit_logs");
    expect(activity).not.toContain("provider_error");
    expect(courseDetail).not.toContain("Request history");
    expect(component).not.toContain("payment_confirmation_mode");
    expect(component).not.toContain("payment_reference");
  });
});
