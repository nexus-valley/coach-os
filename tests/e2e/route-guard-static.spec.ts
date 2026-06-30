import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test.describe("static route guard coverage", () => {
  test("AppShell enforces direct route role and feature access", () => {
    const source = read("src/components/layout/AppShell.tsx");

    expect(source).toContain("canAccessNavigationItem(currentRole, activeItem)");
    expect(source).toContain("isFeatureEnabled(featureAccess, activeFeatureKey)");
    expect(source).toContain("This module is not enabled for your workspace.");
    expect(source).toContain("You do not have access to this workspace area.");
  });

  test("StudentPortalLayout enforces direct route feature access", () => {
    const source = read("src/components/portal/StudentPortalLayout.tsx");

    expect(source).toContain("portalNavFeatureByLabel");
    expect(source).toContain("isFeatureEnabled(featureAccess, activeFeatureKey)");
    expect(source).toContain("This module is not enabled for your student portal.");
  });

  test("important app routes are mapped to feature keys", () => {
    const source = read("src/lib/featureAccess.ts");

    for (const expected of [
      'Finance: "finance"',
      'Documents: "documents"',
      'Messages: "messages"',
      'Reports: "reports"',
      'CRM: "crm"',
      'Marketing: "marketing"',
      'Automations: "automations"',
      'Workflows: "workflows"',
      'Approvals: "approvals"',
      '"Team Operations": "team_operations"',
      'Certificates: "certificates"',
      'Payments: "finance"',
    ]) {
      expect(source).toContain(expected);
    }
  });

  test("legacy payments routes remain redirected or held", () => {
    expect(read("app/app/payments/page.tsx")).toContain('redirect("/app/finance")');
    expect(read("app/app/receipts/page.tsx")).toContain('redirect("/app/finance")');
    expect(read("app/app/payment-links/page.tsx")).toContain(
      "Payment gateway on hold",
    );
    expect(read("app/app/payment-links/page.tsx")).not.toContain(
      "PaymentLinksPageClient",
    );
  });

  test("server-only service role usage is not imported by app client code", () => {
    for (const path of [
      "app/app/documents/page.tsx",
      "app/portal/documents/page.tsx",
      "src/components/documents/DocumentCenterPage.tsx",
      "src/components/portal/StudentPortalDocuments.tsx",
      "tests/e2e/authenticated-smoke.spec.ts",
    ]) {
      const source = read(path);
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("getSupabaseAdminClient");
    }
  });

  test("monitoring setup scrubs sensitive fields and keeps server tokens out of client files", () => {
    const scrubber = read("src/lib/monitoring.ts");

    for (const expected of [
      "password",
      "authorization",
      "cookie",
      "otp",
      "service.?role",
      "signed.?url",
      "storage_path",
      "storage_bucket",
      "reset.?token",
    ]) {
      expect(scrubber).toContain(expected);
    }

    for (const path of [
      "instrumentation-client.ts",
      "src/lib/monitoringClient.ts",
      "app/error.tsx",
      "app/app/error.tsx",
      "app/global-error.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain("SENTRY_AUTH_TOKEN");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("COACHFORT_OTP_SECRET");
      expect(source).not.toContain("RESEND_API_KEY");
    }
  });

  test("environment example contains monitoring placeholders only", () => {
    const source = read(".env.example");

    for (const expected of [
      "NEXT_PUBLIC_SENTRY_DSN=",
      "SENTRY_DSN=",
      "SENTRY_AUTH_TOKEN=",
      "SENTRY_ORG=",
      "SENTRY_PROJECT=",
      "SENTRY_ENVIRONMENT=",
      "NEXT_PUBLIC_APP_ENV=",
    ]) {
      expect(source).toContain(expected);
    }

    expect(source).not.toMatch(/https:\/\/[a-z0-9]+@/i);
    expect(source).not.toMatch(/sntrys_|[A-Za-z0-9_-]{60,}/);
  });

  test("security sweep keeps malformed JSON and assistant errors safe", () => {
    for (const path of [
      "app/api/auth/request-otp/route.ts",
      "app/api/auth/verify-otp/route.ts",
      "app/api/auth/reset-password/route.ts",
      "app/api/documents/download-url/route.ts",
      "app/api/documents/remove-file/route.ts",
      "app/api/assistant/message/route.ts",
    ]) {
      const source = read(path);
      expect(source).toContain("InvalidJsonPayloadError");
      expect(source).toContain("parseJsonBody");
    }

    const assistantService = read("src/lib/ai/assistantService.ts");
    expect(assistantService).toContain("Unable to process assistant request.");
    expect(assistantService).not.toContain("message: error.message,\n      status: 500");

    const legacyPayments = read("src/components/payments/PaymentsPageClient.tsx");
    expect(legacyPayments).not.toContain("raw error");
    expect(legacyPayments).not.toContain("JSON.stringify(error");
    expect(legacyPayments).not.toContain("error.details");
    expect(legacyPayments).not.toContain("error.hint");
  });

  test("student enrollment writes use RPCs instead of direct browser table mutations", () => {
    const expectations = [
      {
        path: "src/lib/students.ts",
        requiredRpcs: [
          "create_student_secure",
          "update_student_secure",
          "delete_student_secure",
        ],
        forbiddenPatterns: [
          /\.from\("students"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("students"\)\s*\r?\n\s*\.update\(/,
          /\.from\("students"\)\s*\r?\n\s*\.delete\(/,
        ],
      },
      {
        path: "src/lib/enrollments.ts",
        requiredRpcs: [
          "create_enrollment_secure",
          "update_enrollment_status_secure",
          "remove_enrollment_secure",
        ],
        forbiddenPatterns: [
          /\.from\("enrollments"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("enrollments"\)\s*\r?\n\s*\.update\(/,
          /\.from\("enrollments"\)\s*\r?\n\s*\.delete\(/,
        ],
      },
      {
        path: "src/lib/cohorts.ts",
        requiredRpcs: [
          "add_cohort_member_secure",
          "remove_cohort_member_secure",
        ],
        forbiddenPatterns: [
          /\.from\("cohort_members"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("cohort_members"\)\s*\r?\n\s*\.delete\(/,
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = read(expectation.path);

      for (const rpc of expectation.requiredRpcs) {
        expect(source).toContain(rpc);
      }

      for (const pattern of expectation.forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  test("course and cohort writes use RPCs instead of direct browser table mutations", () => {
    const expectations = [
      {
        path: "src/lib/courses.ts",
        requiredRpcs: [
          "create_course_secure",
          "create_course_section_secure",
          "update_course_section_secure",
          "delete_course_section_secure",
          "create_lesson_secure",
          "update_lesson_secure",
          "delete_lesson_secure",
        ],
        forbiddenPatterns: [
          /\.from\("courses"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("courses"\)\s*\r?\n\s*\.update\(/,
          /\.from\("courses"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("course_sections"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("course_sections"\)\s*\r?\n\s*\.update\(/,
          /\.from\("course_sections"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("lessons"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("lessons"\)\s*\r?\n\s*\.update\(/,
          /\.from\("lessons"\)\s*\r?\n\s*\.delete\(/,
        ],
      },
      {
        path: "src/lib/cohorts.ts",
        requiredRpcs: [
          "create_cohort_secure",
          "update_cohort_secure",
          "delete_cohort_secure",
        ],
        forbiddenPatterns: [
          /\.from\("cohorts"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("cohorts"\)\s*\r?\n\s*\.update\(/,
          /\.from\("cohorts"\)\s*\r?\n\s*\.delete\(/,
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = read(expectation.path);

      for (const rpc of expectation.requiredRpcs) {
        expect(source).toContain(rpc);
      }

      for (const pattern of expectation.forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  test("session and attendance writes use RPCs instead of direct browser table mutations", () => {
    const expectations = [
      {
        path: "src/lib/sessions.ts",
        requiredRpcs: [
          "create_session_secure",
          "update_session_secure",
          "update_session_status_secure",
          "update_session_meeting_details_secure",
        ],
        forbiddenPatterns: [
          /\.from\("sessions"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("sessions"\)\s*\r?\n\s*\.update\(/,
          /\.from\("sessions"\)\s*\r?\n\s*\.delete\(/,
        ],
      },
      {
        path: "src/lib/attendance.ts",
        requiredRpcs: [
          "mark_attendance_secure",
          "bulk_mark_attendance_secure",
        ],
        forbiddenPatterns: [
          /\.from\("attendance_records"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("attendance_records"\)\s*\r?\n\s*\.update\(/,
          /\.from\("attendance_records"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("attendance_records"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = read(expectation.path);

      for (const rpc of expectation.requiredRpcs) {
        expect(source).toContain(rpc);
      }

      for (const pattern of expectation.forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  test("assignment and submission writes use RPCs instead of direct browser table mutations", () => {
    const expectations = [
      {
        path: "src/lib/assignments.ts",
        requiredRpcs: [
          "create_assignment_secure",
          "update_assignment_secure",
          "update_assignment_status_secure",
        ],
        forbiddenPatterns: [
          /\.from\("assignments"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("assignments"\)\s*\r?\n\s*\.update\(/,
          /\.from\("assignments"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("assignments"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
      {
        path: "src/lib/submissions.ts",
        requiredRpcs: [
          "submit_assignment_secure",
          "review_assignment_submission_secure",
        ],
        forbiddenPatterns: [
          /\.from\("assignment_submissions"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("assignment_submissions"\)\s*\r?\n\s*\.update\(/,
          /\.from\("assignment_submissions"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("assignment_submissions"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = read(expectation.path);

      for (const rpc of expectation.requiredRpcs) {
        expect(source).toContain(rpc);
      }

      for (const pattern of expectation.forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
