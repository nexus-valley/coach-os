import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function listSourceFiles(dir: string): string[] {
  const absolute = join(root, dir);
  const entries = readdirSync(absolute);
  const files: string[] = [];

  for (const entry of entries) {
    const relative = `${dir}/${entry}`;
    const fullPath = join(root, relative);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listSourceFiles(relative));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(relative);
    }
  }

  return files;
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

  test("team access writes use RPCs instead of direct browser table mutations", () => {
    const expectations = [
      {
        path: "src/lib/team.ts",
        requiredRpcs: [
          "update_tenant_member_role_secure",
          "remove_tenant_member_secure",
        ],
        forbiddenPatterns: [
          /\.from\("tenant_members"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("tenant_members"\)\s*\r?\n\s*\.update\(/,
          /\.from\("tenant_members"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("tenant_members"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
      {
        path: "src/lib/teamInvitations.ts",
        requiredRpcs: [
          "create_team_invitation_secure",
          "cancel_team_invitation_secure",
          "resend_team_invitation_secure",
        ],
        forbiddenPatterns: [
          /\.from\("team_invitations"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("team_invitations"\)\s*\r?\n\s*\.update\(/,
          /\.from\("team_invitations"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("team_invitations"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
      {
        path: "src/lib/trainerAssignments.ts",
        requiredRpcs: [
          "assign_trainer_to_course_secure",
          "remove_trainer_from_course_secure",
          "assign_trainer_to_cohort_secure",
          "remove_trainer_from_cohort_secure",
        ],
        forbiddenPatterns: [
          /\.from\("trainer_course_assignments"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("trainer_course_assignments"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("trainer_cohort_assignments"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("trainer_cohort_assignments"\)\s*\r?\n\s*\.delete\(/,
        ],
      },
      {
        path: "src/lib/delegatedPermissions.ts",
        requiredRpcs: [
          "grant_delegated_permission_secure",
          "revoke_delegated_permission_secure",
          "expire_delegated_permissions_secure",
        ],
        forbiddenPatterns: [
          /\.from\("delegated_permissions"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("delegated_permissions"\)\s*\r?\n\s*\.update\(/,
          /\.from\("delegated_permissions"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("delegated_permissions"\)\s*\r?\n\s*\.upsert\(/,
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

  test("notification reminder and audit writes use RPCs instead of direct browser table mutations", () => {
    const expectations = [
      {
        path: "src/lib/notifications.ts",
        requiredRpcs: [
          "create_notification_secure",
          "mark_notification_read_secure",
          "archive_notification_secure",
          "ensure_notification_preferences_secure",
          "update_notification_preferences_secure",
        ],
        forbiddenPatterns: [
          /\.from\("notifications"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("notifications"\)\s*\r?\n\s*\.update\(/,
          /\.from\("notifications"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("notifications"\)\s*\r?\n\s*\.upsert\(/,
          /\.from\("notification_preferences"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("notification_preferences"\)\s*\r?\n\s*\.update\(/,
          /\.from\("notification_preferences"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("notification_preferences"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
      {
        path: "src/lib/reminders.ts",
        requiredRpcs: [
          "create_reminder_secure",
          "update_reminder_status_secure",
          "delete_reminder_secure",
        ],
        forbiddenPatterns: [
          /\.from\("reminders"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("reminders"\)\s*\r?\n\s*\.update\(/,
          /\.from\("reminders"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("reminders"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
      {
        path: "src/lib/auditLogger.ts",
        requiredRpcs: ["record_audit_event_secure"],
        forbiddenPatterns: [
          /\.from\("audit_logs"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("audit_logs"\)\s*\r?\n\s*\.update\(/,
          /\.from\("audit_logs"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("audit_logs"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
      {
        path: "src/lib/communication.ts",
        requiredRpcs: ["queue_communication_log_secure"],
        forbiddenPatterns: [
          /\.from\("communication_logs"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("communication_logs"\)\s*\r?\n\s*\.update\(/,
          /\.from\("communication_logs"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("communication_logs"\)\s*\r?\n\s*\.upsert\(/,
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

  test("legacy billing and payment writes are retired in favor of finance RPCs", () => {
    const finance = read("src/lib/finance.ts");
    const module55Sql = read("supabase/module55_tenant_finance_center.sql");

    for (const rpc of [
      "create_invoice",
      "update_invoice",
      "void_invoice",
      "record_payment",
      "cancel_payment",
      "apply_invoice_adjustment",
      "get_student_finance_summary",
    ]) {
      expect(module55Sql).toContain(rpc);
    }

    for (const rpc of [
      "create_invoice",
      "void_invoice",
      "record_payment",
      "cancel_payment",
      "apply_invoice_adjustment",
      "get_student_finance_summary",
    ]) {
      expect(finance).toContain(rpc);
    }

    const expectations = [
      {
        path: "src/lib/payments.ts",
        retiredMessage: "Legacy payment writes are retired",
        forbiddenPatterns: [
          /\.from\("payments"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("payments"\)\s*\r?\n\s*\.update\(/,
          /\.from\("payments"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("payments"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
      {
        path: "src/lib/paymentLinks.ts",
        retiredMessage: "Payment links are on hold",
        forbiddenPatterns: [
          /\.from\("payment_links"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("payment_links"\)\s*\r?\n\s*\.update\(/,
          /\.from\("payment_links"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("payment_links"\)\s*\r?\n\s*\.upsert\(/,
          /\.from\("payments"\)\s*\r?\n\s*\.insert\(/,
          /upi:\/\/pay/,
        ],
      },
      {
        path: "src/lib/receipts.ts",
        retiredMessage: "Legacy receipt generation is retired",
        forbiddenPatterns: [
          /\.from\("payments"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("payments"\)\s*\r?\n\s*\.update\(/,
          /\.from\("payments"\)\s*\r?\n\s*\.delete\(/,
          /\.from\("payments"\)\s*\r?\n\s*\.upsert\(/,
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = read(expectation.path);
      expect(source).toContain(expectation.retiredMessage);

      for (const pattern of expectation.forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }

    expect(read("src/components/payment-links/PaymentLinksPageClient.tsx")).not.toContain(
      "upi://pay",
    );
  });

  test("tenant subscription page is read-only and platform-managed", () => {
    const source = read("src/components/subscription/SubscriptionPageClient.tsx");

    expect(source).toContain("Subscription is managed by the platform owner.");
    expect(source).toContain("Contact platform support or your platform admin");
    expect(source).toContain("Platform-managed");

    for (const forbidden of [
      "updateBillingProfile",
      "updateWorkspacePlanManual",
      "handlePlanChange",
      "handleBillingProfileSave",
      "Change for testing",
      "Save billing profile",
      "Owner controls enabled",
    ]) {
      expect(source).not.toContain(forbidden);
    }

    for (const forbiddenPattern of [
      /\.from\("tenants"\)\s*\r?\n\s*\.update\(/,
      /\.from\("subscriptions"\)\s*\r?\n\s*\.insert\(/,
      /\.from\("subscriptions"\)\s*\r?\n\s*\.update\(/,
      /\.from\("invoices"\)\s*\r?\n\s*\.insert\(/,
      /\.from\("invoices"\)\s*\r?\n\s*\.update\(/,
      /\.from\("invoice_items"\)\s*\r?\n\s*\.insert\(/,
      /\.from\("payment_transactions"\)\s*\r?\n\s*\.insert\(/,
    ]) {
      expect(source).not.toMatch(forbiddenPattern);
    }
  });

  test("legacy subscription billing helpers fail closed", () => {
    const expectations = [
      {
        path: "src/lib/billing.ts",
        retiredFunctions: ["updateBillingProfile"],
        forbiddenPatterns: [
          /\.from\("tenants"\)\s*\r?\n\s*\.update\(/,
        ],
      },
      {
        path: "src/lib/subscription.ts",
        retiredFunctions: ["updateTenantPlanForTesting"],
        forbiddenPatterns: [
          /\.from\("tenants"\)\s*\r?\n\s*\.update\(/,
        ],
      },
      {
        path: "src/lib/subscriptions.ts",
        retiredFunctions: [
          "createSubscription",
          "cancelSubscription",
          "updateWorkspacePlanManual",
        ],
        forbiddenPatterns: [
          /\.from\("subscriptions"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("subscriptions"\)\s*\r?\n\s*\.update\(/,
          /\.from\("tenants"\)\s*\r?\n\s*\.update\(/,
        ],
      },
      {
        path: "src/lib/invoices.ts",
        retiredFunctions: ["createDraftInvoice", "markInvoicePaid"],
        forbiddenPatterns: [
          /\.from\("invoices"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("invoices"\)\s*\r?\n\s*\.update\(/,
          /\.from\("invoice_items"\)\s*\r?\n\s*\.insert\(/,
          /\.from\("payment_transactions"\)\s*\r?\n\s*\.insert\(/,
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = read(expectation.path);

      expect(source).toContain("Legacy subscription billing writes are retired");

      for (const functionName of expectation.retiredFunctions) {
        expect(source).toContain(`function ${functionName}`);
      }

      for (const pattern of expectation.forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  test("student progress and certificates use secure RPC paths", () => {
    const studentPortal = read("src/lib/studentPortal.ts");
    const certificates = read("src/lib/certificates.ts");
    const module69_8Sql = read("supabase/module69_8_student_progress_certificates.sql");

    for (const rpc of [
      "mark_lesson_progress_secure",
      "recalculate_student_course_progress_secure",
      "get_certificate_data_secure",
      "m69_8_assert_can_manage_progress",
    ]) {
      expect(module69_8Sql).toContain(rpc);
    }

    expect(module69_8Sql).toContain("array['manage_students', 'manage_courses']");
    expect(module69_8Sql).toContain(
      "revoke execute on function public.m69_8_assert_can_manage_progress",
    );

    expect(studentPortal).toContain("mark_lesson_progress_secure");
    expect(certificates).toContain("recalculate_student_course_progress_secure");
    expect(certificates).toContain("get_certificate_data_secure");

    for (const source of [studentPortal, certificates]) {
      for (const pattern of [
        /\.from\("lesson_progress"\)\s*\r?\n\s*\.insert\(/,
        /\.from\("lesson_progress"\)\s*\r?\n\s*\.update\(/,
        /\.from\("lesson_progress"\)\s*\r?\n\s*\.delete\(/,
        /\.from\("lesson_progress"\)\s*\r?\n\s*\.upsert\(/,
        /\.from\("enrollments"\)\s*\r?\n\s*\.insert\(/,
        /\.from\("enrollments"\)\s*\r?\n\s*\.update\(/,
        /\.from\("enrollments"\)\s*\r?\n\s*\.delete\(/,
        /\.from\("enrollments"\)\s*\r?\n\s*\.upsert\(/,
        /\.from\("certificates"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
        /\.from\("student_certificates"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
        /\.from\("certificate_templates"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
      ]) {
        expect(source).not.toMatch(pattern);
      }
    }

    expect(certificates).not.toContain('runAutomationTrigger("certificate_issued"');
    expect(certificates).not.toContain('action: "certificate_generated"');
    expect(studentPortal).not.toContain("student_name: scope.student.full_name");
  });

  test("automation writes use secure RPC paths and browser runner is retired", () => {
    const automations = read("src/lib/automations.ts");
    const automationRunner = read("src/lib/automationRunner.ts");
    const automationPage = read("src/components/automations/AutomationsPageClient.tsx");
    const automationTriggers = read("src/lib/automationTriggers.ts");
    const module69_9Sql = read("supabase/module69_9_automation_write_consolidation.sql");

    for (const rpc of [
      "create_automation_rule_secure",
      "update_automation_rule_secure",
      "set_automation_rule_enabled_secure",
      "delete_automation_rule_secure",
      "create_automation_condition_secure",
      "update_automation_condition_secure",
      "delete_automation_condition_secure",
      "create_automation_action_secure",
      "update_automation_action_secure",
      "delete_automation_action_secure",
    ]) {
      expect(module69_9Sql).toContain(rpc);
    }

    expect(module69_9Sql).toContain(
      "revoke execute on function public.run_automation_trigger_unvalidated",
    );
    expect(module69_9Sql).toContain(
      "grant execute on function public.run_automation_trigger",
    );

    for (const rpc of [
      "create_automation_rule_secure",
      "update_automation_rule_secure",
      "set_automation_rule_enabled_secure",
      "delete_automation_rule_secure",
    ]) {
      expect(automations).toContain(rpc);
    }

    for (const source of [automations, automationRunner]) {
      for (const pattern of [
        /\.from\("automation_rules"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
        /\.from\("automation_rule_conditions"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
        /\.from\("automation_rule_actions"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
        /\.from\("automation_runs"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
        /\.from\("automation_run_logs"\)\s*\r?\n\s*\.(insert|update|delete|upsert)\(/,
      ]) {
        expect(source).not.toMatch(pattern);
      }
    }

    expect(automationPage).not.toContain("runAutomationRule");
    expect(automationPage).not.toContain("Run test");
    expect(automationRunner).toContain("Browser-side automation action execution is retired");
    expect(automationTriggers).toContain("run_automation_trigger");
    expect(automationTriggers).not.toContain("run_automation_trigger_unvalidated");
  });

  test("demo workspace direct-write seeder is not reachable from client components", () => {
    const dashboard = read("src/components/dashboard/DashboardPageClient.tsx");

    expect(dashboard).not.toContain("seedDemoWorkspace");
    expect(dashboard).not.toContain("resetDemoWorkspace");
    expect(dashboard).not.toContain("backfillDemoMessages");
    expect(dashboard).not.toContain("@/src/lib/demoWorkspace");

    const clientFiles = [
      ...listSourceFiles("app"),
      ...listSourceFiles("src"),
    ].filter((path) => read(path).startsWith('"use client";'));

    for (const path of clientFiles) {
      expect(read(path), path).not.toContain("@/src/lib/demoWorkspace");
    }
  });
});
