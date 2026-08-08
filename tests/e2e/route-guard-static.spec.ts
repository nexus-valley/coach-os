import { expect, type Page, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { getSafeInternalPath } from "../../src/lib/authRedirects";
import { expectProgramsAccessibleState } from "./helpers/auth";

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

const isolatedProgramsReadinessOptions = {
  indicatorGraceMs: 20,
  timeoutMs: 1_000,
};

test.describe("Auth return path behavior", () => {
  test("accepts internal invitation paths and rejects redirect bypasses", () => {
    expect(getSafeInternalPath("/invite/student")).toBe("/invite/student");
    expect(getSafeInternalPath("/app/courses?tab=draft#status")).toBe(
      "/app/courses?tab=draft#status",
    );

    for (const unsafePath of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/%2f%2fexample.com",
      "/%5cexample.com",
      "/invite/student%0d%0aLocation:example.com",
    ]) {
      expect(getSafeInternalPath(unsafePath)).toBeNull();
    }
  });
});

async function expectIsolatedProgramsFailure(
  page: Page,
  body: string,
  state: "access_denied" | "load_error" | "module_unavailable",
) {
  let requestCount = 0;
  page.on("request", () => {
    requestCount += 1;
  });
  await page.setContent(body);

  await expect(
    expectProgramsAccessibleState(page, isolatedProgramsReadinessOptions),
  ).rejects.toThrow(`Programs readiness failed: ${state}.`);
  expect(requestCount).toBe(0);
}

test.describe("Programs readiness behavior", () => {
  test("delayed loaded state passes without a pre-hydration false positive", async ({
    page,
  }) => {
    let requestCount = 0;
    page.on("request", () => {
      requestCount += 1;
    });
    await page.setContent('<main id="programs"></main>');
    await page.evaluate(() => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = "/app/courses/local-program";
        link.textContent = "Manage program";
        document.querySelector("#programs")?.append(link);
      }, 75);
    });

    const state = await expectProgramsAccessibleState(
      page,
      isolatedProgramsReadinessOptions,
    );

    expect(state).toBe("loaded");
    expect(requestCount).toBe(0);
  });

  test("legitimate empty state passes", async ({ page }) => {
    let requestCount = 0;
    page.on("request", () => {
      requestCount += 1;
    });
    await page.setContent("<h1>Create your first program</h1>");

    const state = await expectProgramsAccessibleState(
      page,
      isolatedProgramsReadinessOptions,
    );

    expect(state).toBe("empty");
    expect(requestCount).toBe(0);
  });

  test("Retry load error is terminal but fails", async ({ page }) => {
    await expectIsolatedProgramsFailure(
      page,
      "<button>Retry</button>",
      "load_error",
    );
  });

  test("access denial is terminal but fails", async ({ page }) => {
    await expectIsolatedProgramsFailure(
      page,
      "<p>You do not have access to this workspace area.</p>",
      "access_denied",
    );
  });

  test("module unavailable is terminal but fails", async ({ page }) => {
    await expectIsolatedProgramsFailure(
      page,
      "<p>This module is not enabled for your workspace.</p>",
      "module_unavailable",
    );
  });
});

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
      'Requests: "courses"',
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

  test("regression credential infrastructure is local-only and role-specific", () => {
    const provisioning = read("scripts/create-regression-accounts.ts");
    const authHelper = read("tests/e2e/helpers/auth.ts");

    expect(provisioning).toContain(
      'const LOCAL_PROVISIONING_FLAG =\n  "COACHFORT_ALLOW_LOCAL_REGRESSION_PROVISIONING"',
    );
    expect(provisioning).toContain(
      "assertLocalProvisioningAllowed(supabaseUrl)",
    );
    expect(
      provisioning.indexOf("assertLocalProvisioningAllowed(supabaseUrl)"),
    ).toBeLessThan(provisioning.indexOf("createClient(supabaseUrl"));
    expect(provisioning).toContain(
      'parsedUrl.protocol !== "http:"',
    );
    expect(provisioning).toContain(
      "!localSupabaseHosts.has(parsedUrl.hostname)",
    );
    expect(provisioning).toContain('process.env.NODE_ENV === "production"');
    expect(provisioning).toContain("process.env.VERCEL_ENV");
    expect(provisioning).toContain(
      'const TENANT_NAME = "CoachFort Regression Coaching"',
    );
    expect(provisioning).toContain("maskEmail(result.email)");
    expect(provisioning).toContain("maskUuid(tenant.id)");
    expect(provisioning).toContain(
      "Each local regression role must use a distinct password.",
    );
    expect(provisioning).not.toContain("DEFAULT_PASSWORD");
    expect(provisioning).not.toContain("REGRESSION_TEST_PASSWORD");
    expect(provisioning).not.toContain("updateUserById");
    expect(provisioning).not.toContain("CoachFort Regression Academy");
    expect(provisioning).not.toContain("isOptionalSchemaError");
    expect(provisioning).not.toMatch(
      /\b[A-Z0-9._%+-]+@coachfort\.demo\b/i,
    );

    for (const envName of [
      "COACHFORT_OWNER_PASSWORD",
      "COACHFORT_ADMIN_PASSWORD",
      "COACHFORT_STAFF_PASSWORD",
      "COACHFORT_TRAINER_PASSWORD",
      "COACHFORT_STUDENT_PASSWORD",
      "COACHFORT_PLATFORM_OWNER_PASSWORD",
    ]) {
      expect(authHelper).toContain(envName);
    }

    for (const mapping of [
      'admin: "COACHFORT_ADMIN_PASSWORD"',
      'owner: "COACHFORT_OWNER_PASSWORD"',
      'platformOwner: "COACHFORT_PLATFORM_OWNER_PASSWORD"',
      'staff: "COACHFORT_STAFF_PASSWORD"',
      'student: "COACHFORT_STUDENT_PASSWORD"',
      'trainer: "COACHFORT_TRAINER_PASSWORD"',
    ]) {
      expect(authHelper).toContain(mapping);
    }

    expect(authHelper).toContain("getRegressionCredential(role)");
    expect(authHelper).toContain(
      "const passwordEnvName = passwordEnvNameByRole[role]",
    );
    expect(authHelper).not.toContain("COACHFORT_TEST_PASSWORD");
    expect(authHelper).not.toContain("storageState");
    expect(authHelper).not.toMatch(
      /(?:console\.(?:log|error)|test\.info\(\)\.attach).*password/i,
    );
  });

  test("Programs route readiness separates accessible and failure states", () => {
    const authHelper = read("tests/e2e/helpers/auth.ts");
    const authenticatedSmoke = read(
      "tests/e2e/authenticated-smoke.spec.ts",
    );

    expect(authHelper).toContain(
      "export async function expectProgramsRouteReady",
    );
    expect(authHelper).toContain(
      'export type ProgramsAccessibleState = "empty" | "loaded"',
    );
    expect(authHelper).toContain("type ProgramsFailureState =");
    expect(authHelper).toContain("getProgramsStateLocators(page)");
    expect(authHelper).toContain('return "loaded"');
    expect(authHelper).toContain('return "empty"');
    expect(authHelper).toContain(
      'throw new ProgramsReadinessError("timeout", diagnostics.summary())',
    );
    expect(authHelper).toContain(
      "throw new ProgramsReadinessError(state, diagnostics.summary())",
    );
    expect(authHelper).toContain('["load_error", states.loadError]');
    expect(authHelper).toContain('["access_denied", states.accessDenied]');
    expect(authHelper).toContain(
      '["module_unavailable", states.moduleUnavailable]',
    );
    expect(authHelper).toContain('["hard_failure", states.hardFailure]');
    expect(authHelper).toContain("appReadinessTimeout = 20_000");
    expect(authHelper).toContain("createSanitizedRouteDiagnostics(page)");
    expect(authHelper).toContain("request.method()");
    expect(authHelper).toContain("response.status()");
    expect(authHelper).toContain("getSafeUrlCategory");
    expect(authHelper).toContain("<masked-id>");
    expect(authHelper).not.toMatch(
      /\.(?:allHeaders|headers|headerValue|postData|postDataBuffer)\s*\(/,
    );
    expect(authHelper).not.toMatch(
      /(?:localStorage|sessionStorage|storageState|authorizationHeader|cookieHeader)/,
    );
    expect(authHelper).not.toContain("url.search");
    expect(authenticatedSmoke).toContain(
      "await expectProgramsRouteReady(page)",
    );
    expect(authenticatedSmoke).not.toContain(
      "expectProgramsAccessibleState(page",
    );
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
          "publish_course_secure",
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

  test("draft publication is RPC-only and owner-admin presented", () => {
    const courses = read("src/lib/courses.ts");
    const courseDetail = read(
      "src/components/courses/CourseDetailClient.tsx",
    );
    const permissions = read("src/lib/permissions.ts");
    const helperStart = courses.indexOf(
      "export async function publishCourse",
    );
    const helperEnd = courses.indexOf(
      "export async function getCourseById",
      helperStart,
    );
    const publishHelper = courses.slice(helperStart, helperEnd);
    const handlerStart = courseDetail.indexOf(
      "async function handlePublishCourse",
    );
    const handlerEnd = courseDetail.indexOf(
      "async function handleCopyPublicProgramLink",
      handlerStart,
    );
    const publishHandler = courseDetail.slice(handlerStart, handlerEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(publishHelper).toContain('.rpc("publish_course_secure"');
    expect(publishHelper).toContain("p_course_id: normalizedCourseId");
    expect(publishHelper).toContain(".single()");
    expect(publishHelper).not.toContain('.from("courses")');
    expect(publishHelper).not.toMatch(
      /enrollment|invoice|payment|receipt|portal|invitation|email|razorpay|stripe/i,
    );
    expect(publishHandler).toContain("await publishCourse(course.id)");
    expect(publishHandler).toContain("publishSaving");
    expect(publishHandler).not.toMatch(
      /createEnrollment|createStudent|createInvoice|createPayment|createReceipt|createPortal|sendInvitation|sendEmail|razorpay|stripe/i,
    );

    expect(courseDetail).toContain(
      'canManage && course.status === "draft"',
    );
    expect(courseDetail).toContain('course.status === "archived"');
    expect(courseDetail).toContain("Archived programs cannot be published.");
    expect(courseDetail).toContain("publishSaving");
    expect(courseDetail).toContain('loadingText="Publishing..."');
    expect(courseDetail).toContain("Program published successfully.");
    expect(courseDetail).toContain(
      "This program is already published. Its latest status has been refreshed.",
    );
    expect(publishHandler).toContain(
      "focusPublishFeedbackAfterSuccessRef.current = true",
    );
    expect(courseDetail).toContain("publishFeedbackRef.current?.focus()");
    expect(courseDetail).toContain("ref={publishFeedbackRef}");
    expect(courseDetail).toContain('aria-modal="true"');
    expect(courseDetail).toContain('event.key === "Escape"');

    const managerPermissions = permissions.slice(
      permissions.indexOf("admin: ["),
      permissions.indexOf("staff: ["),
    );
    const delegatedPermissions = permissions.slice(
      permissions.indexOf("staff: ["),
      permissions.indexOf("const navAccess"),
    );

    expect(managerPermissions.match(/"manage_courses"/g)).toHaveLength(2);
    expect(delegatedPermissions).not.toContain('"manage_courses"');
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

    expect(source).toContain("Plan changes require CoachFort review.");
    expect(source).toContain("These details are read-only for tenant users.");
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

  test("tenant usage snapshot helper is read-only from browser paths", () => {
    const usage = read("src/lib/usage.ts");

    expect(usage).toContain("function refreshWorkspaceUsageSnapshot");
    expect(usage).toContain("getWorkspaceUsage(tenantId)");

    for (const pattern of [
      /\.from\("tenants"\)\s*\r?\n\s*\.insert\(/,
      /\.from\("tenants"\)\s*\r?\n\s*\.update\(/,
      /\.from\("tenants"\)\s*\r?\n\s*\.upsert\(/,
      /\.from\("tenants"\)\s*\r?\n\s*\.delete\(/,
    ]) {
      expect(usage).not.toMatch(pattern);
    }
  });

  test("legacy conversation helpers fail closed while academy chat uses RPCs", () => {
    const conversations = read("src/lib/conversations.ts");
    const messages = read("src/lib/messages.ts");
    const academyChat = read("src/lib/academyChat.ts");
    const teamMessagesPage = read("src/components/messages/MessagesPageClient.tsx");
    const teamThreadPage = read("src/components/messages/ThreadDetailClient.tsx");
    const portalMessagesPage = read("src/components/portal/StudentPortalMessages.tsx");

    for (const source of [conversations, messages]) {
      expect(source).toContain(
        "Legacy conversation writes are retired. Use the Academy Chat module.",
      );

      for (const pattern of [
        /\.from\("conversation_threads"\)\s*\r?\n\s*\.insert\(/,
        /\.from\("conversation_threads"\)\s*\r?\n\s*\.update\(/,
        /\.from\("conversation_threads"\)\s*\r?\n\s*\.delete\(/,
        /\.from\("conversation_threads"\)\s*\r?\n\s*\.upsert\(/,
        /\.from\("conversation_participants"\)\s*\r?\n\s*\.insert\(/,
        /\.from\("conversation_participants"\)\s*\r?\n\s*\.update\(/,
        /\.from\("conversation_participants"\)\s*\r?\n\s*\.delete\(/,
        /\.from\("conversation_participants"\)\s*\r?\n\s*\.upsert\(/,
        /\.from\("conversation_messages"\)\s*\r?\n\s*\.insert\(/,
        /\.from\("conversation_messages"\)\s*\r?\n\s*\.update\(/,
        /\.from\("conversation_messages"\)\s*\r?\n\s*\.delete\(/,
        /\.from\("conversation_messages"\)\s*\r?\n\s*\.upsert\(/,
      ]) {
        expect(source).not.toMatch(pattern);
      }
    }

    for (const rpc of [
      "get_team_chat_threads",
      "get_team_chat_thread",
      "get_student_chat_threads",
      "get_student_chat_thread",
      "create_student_direct_chat",
      "create_student_support_thread",
      "send_team_chat_message",
      "send_student_chat_message",
      "close_chat_thread",
      "mark_chat_thread_read",
    ]) {
      expect(academyChat).toContain(rpc);
    }

    for (const source of [teamMessagesPage, teamThreadPage, portalMessagesPage]) {
      expect(source).toContain("@/src/lib/academyChat");
      expect(source).not.toContain("@/src/lib/conversations");
      expect(source).not.toContain("@/src/lib/messages");
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

  test("workspace bootstrap uses RPC and active tenant member writes stay retired", () => {
    const tenant = read("src/lib/tenant.ts");

    expect(tenant).toContain("create_workspace_with_owner");
    expect(tenant).toContain(
      "Workspace setup is temporarily unavailable. Please contact support.",
    );
    expect(tenant).not.toMatch(/\.from\("tenants"\)[\s\S]{0,700}\.insert\(/);
    expect(tenant).not.toMatch(
      /\.from\("tenant_members"\)[\s\S]{0,700}\.insert\(/,
    );

    const activeSourceFiles = [
      ...listSourceFiles("app"),
      ...listSourceFiles("src"),
    ].filter((path) => path !== "src/lib/demoWorkspace.ts");

    for (const path of activeSourceFiles) {
      const source = read(path);

      for (const table of ["tenants", "tenant_members"]) {
        expect(source, `${path} should not directly write ${table}`).not.toMatch(
          new RegExp(
            String.raw`\.from\(["'\`]${table}["'\`]\)[\s\S]{0,700}\.(insert|update|upsert|delete)\(`,
          ),
        );
      }
    }
  });

  test("signup relies on auth profile trigger and active profile writes stay retired", () => {
    const auth = read("src/lib/auth.ts");
    const signup = read("src/components/auth/SignupForm.tsx");
    const schema = read("supabase/schema.sql");

    expect(signup).toContain("signUpWithPassword");
    expect(auth).toContain("supabase.auth.signUp");
    expect(auth).not.toMatch(
      /\.from\(["'`]profiles["'`]\)[\s\S]{0,700}\.(insert|update|upsert|delete)\(/,
    );
    expect(schema).toContain("handle_new_user_profile");
    expect(schema).toContain("on_auth_user_created_profile");

    const activeSourceFiles = [
      ...listSourceFiles("app"),
      ...listSourceFiles("src"),
    ].filter((path) => path !== "src/lib/demoWorkspace.ts");

    for (const path of activeSourceFiles) {
      expect(read(path), `${path} should not directly write profiles`).not.toMatch(
        /\.from\(["'`]profiles["'`]\)[\s\S]{0,700}\.(insert|update|upsert|delete)\(/,
      );
    }
  });

  test("student portal invitations reuse secure server, auth, and email boundaries", () => {
    const sendRoute = read(
      "app/api/student-portal-invitations/send/route.ts",
    );
    const acceptRoute = read(
      "app/api/student-portal-invitations/accept/route.ts",
    );
    const invitationClient = read("src/lib/studentPortalInvitations.ts");
    const acceptanceDiagnostics = read(
      "src/lib/studentPortalInvitationAcceptance.ts",
    );
    const invitePage = read(
      "src/components/portal/StudentPortalInviteClient.tsx",
    );
    const loginPage = read("app/login/page.tsx");
    const signupPage = read("app/signup/page.tsx");
    const loginForm = read("src/components/auth/LoginForm.tsx");
    const forgotPasswordForm = read(
      "src/components/auth/ForgotPasswordForm.tsx",
    );
    const resetPasswordForm = read(
      "src/components/auth/ResetPasswordForm.tsx",
    );
    const authRedirects = read("src/lib/authRedirects.ts");
    const courseDetail = read(
      "src/components/courses/CourseDetailClient.tsx",
    );
    const enrollmentInbox = read(
      "src/components/enrollment-requests/EnrollmentRequestsPageClient.tsx",
    );
    const publicSite = read("src/lib/publicSite.ts");

    expect(sendRoute).toContain("requireAuthenticatedUser(accessToken)");
    expect(sendRoute).toContain('allowed_roles: ["owner", "admin"]');
    expect(sendRoute).toContain("prepare_student_portal_invitation_secure");
    expect(sendRoute).toContain(
      "record_student_portal_invitation_delivery_secure",
    );
    expect(sendRoute).toContain("buildStudentPortalInviteEmail");
    expect(sendRoute).toContain("sendCoachFortTransactionalEmail");
    expect(sendRoute).toContain('/invite/student#token=');
    expect(sendRoute).toContain("prepared.token_ready !== true");
    expect(sendRoute).not.toContain('select("token_hash")');
    expect(sendRoute).not.toContain("console.");

    expect(sendRoute.indexOf("prepared.token_ready !== true")).toBeLessThan(
      sendRoute.indexOf("sendCoachFortTransactionalEmail({"),
    );

    expect(acceptRoute).toContain("requireAuthenticatedUser(accessToken)");
    expect(acceptRoute).toContain('createHash("sha256")');
    expect(acceptRoute).toContain("accept_student_portal_invitation_secure");
    expect(acceptRoute).toContain("p_user_id: user.id");
    expect(acceptRoute).toContain(
      "classifyStudentPortalInvitationAcceptanceError(error)",
    );
    expect(acceptRoute).toContain(
      "classifyStudentPortalInvitationAcceptanceResult(data)",
    );
    expect(acceptRoute).not.toContain("console.");
    expect(acceptanceDiagnostics).toContain('providerCode === "42501"');
    expect(acceptanceDiagnostics).toContain(
      "normalizedMessage === wrongIdentityMessage",
    );
    expect(acceptanceDiagnostics).not.toContain("details");
    expect(acceptanceDiagnostics).not.toContain("hint");

    for (const serviceRpc of [
      "prepare_student_portal_invitation_secure",
      "record_student_portal_invitation_delivery_secure",
      "accept_student_portal_invitation_secure",
    ]) {
      expect(invitationClient).not.toContain(serviceRpc);
      expect(courseDetail).not.toContain(serviceRpc);
      expect(enrollmentInbox).not.toContain(serviceRpc);
      expect(invitePage).not.toContain(serviceRpc);
    }

    expect(invitationClient).toContain(
      'rpc(\n    "get_student_portal_invitation_status"',
    );
    expect(invitationClient).toContain(
      'fetch("/api/student-portal-invitations/send"',
    );
    expect(invitationClient).toContain(
      'fetch("/api/student-portal-invitations/accept"',
    );
    expect(invitePage).toContain("window.sessionStorage.setItem");
    expect(invitePage).toContain("window.history.replaceState");
    expect(invitePage).toContain('encodeURIComponent(inviteReturnPath)');
    expect(invitePage).toContain('href={`/login?next=${nextPath}`}');
    expect(invitePage).toContain('href={`/signup?next=${nextPath}`}');
    expect(invitePage).not.toContain("token_hash");
    expect(invitePage).toContain("handleContinueWithInvitedEmail");
    expect(invitePage).toContain("await supabase.auth.signOut()");
    expect(invitePage).toContain('setStage("signed_out")');
    expect(invitePage).toContain("Continue with invited email");
    expect(invitePage).toContain(
      "shouldClearStudentPortalInvitationToken(code)",
    );
    expect(loginPage).toContain("encodeURIComponent(nextPath)");
    expect(signupPage).toContain("encodeURIComponent(nextPath)");
    expect(loginPage).toContain("getSafeInternalPath");
    expect(signupPage).toContain("getSafeInternalPath");
    expect(loginForm).toContain("forgotPasswordHref");
    expect(forgotPasswordForm).toContain('resetParams.set("next", nextPath)');
    expect(resetPasswordForm).toContain("loginHref");

    for (const authSource of [
      loginForm,
      forgotPasswordForm,
      resetPasswordForm,
    ]) {
      expect(authSource).toContain("getSafeInternalPath");
    }
    expect(authRedirects).toContain('value.startsWith("//")');
    expect(authRedirects).toContain("unsafeEncodedPathPattern");
    expect(authRedirects).toContain("unsafePathCharacterPattern");

    expect(enrollmentInbox).toContain(
      'const canMutate = role === "owner" || role === "admin"',
    );
    expect(enrollmentInbox).toContain("Send invitation");
    expect(enrollmentInbox).toContain("Send new invitation");
    expect(enrollmentInbox).toContain("Retry invitation");
    expect(enrollmentInbox).toContain("Access active");
    expect(courseDetail).toContain("View enrollment requests");
    expect(publicSite).toContain(
      '"approve_public_program_enrollment_request_v2"',
    );
    expect(publicSite).not.toContain(
      '"approve_public_program_enrollment_request",',
    );
    expect(publicSite).not.toContain("p_payment_confirmation_mode");
    expect(publicSite).not.toContain("p_payment_reference");
  });

  test("student portal invitation orchestration has no finance or auth-admin side effects", () => {
    const invitationSources = [
      read("app/api/student-portal-invitations/send/route.ts"),
      read("app/api/student-portal-invitations/accept/route.ts"),
      read("src/lib/studentPortalInvitations.ts"),
      read("src/components/portal/StudentPortalInviteClient.tsx"),
    ];

    for (const source of invitationSources) {
      for (const forbidden of [
        'auth.admin.createUser',
        'auth.admin.updateUserById',
        '.from("payments")',
        '.from("invoices")',
        '.from("receipts")',
        '.from("subscriptions")',
        'payment_confirmation_mode',
        'payment_reference',
        'storageState',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }

    expect(invitationSources.join("\n")).not.toMatch(
      /\.from\("student_portal_accounts"\)[\s\S]{0,500}\.(insert|update|upsert|delete)\(/,
    );
  });

  test("student portal invitation send diagnostics are safe and distinct", () => {
    const sendRoute = read(
      "app/api/student-portal-invitations/send/route.ts",
    );
    const invitationClient = read("src/lib/studentPortalInvitations.ts");
    const diagnostics = read("src/lib/studentPortalInvitationDiagnostics.ts");
    const courseDetail = read(
      "src/components/courses/CourseDetailClient.tsx",
    );

    for (const category of [
      "server_admin_not_configured",
      "unauthorized",
      "forbidden",
      "invalid_request",
      "eligibility_read_failed",
      "invitation_prepare_failed",
      "invitation_not_sendable",
      "email_not_configured",
      "email_delivery_failed",
      "invitation_delivery_record_failed",
    ]) {
      expect(diagnostics).toContain(`"${category}"`);
      expect(sendRoute).toContain(`"${category}"`);
    }

    expect(sendRoute).toContain("captureServerException(new Error(params.errorCode)");
    expect(sendRoute).toContain(
      'operation: "student_portal_invitation_admin_init"',
    );
    expect(sendRoute).toContain(
      'operation: "student_portal_invitation_prepare"',
    );
    expect(sendRoute).toContain(
      'operation: "student_portal_invitation_delivery_record"',
    );
    expect(sendRoute).toContain(
      'const requestResult = await userScopedSupabase',
    );
    const eligibilityReads = sendRoute.slice(
      sendRoute.indexOf("const requestResult"),
      sendRoute.indexOf("let admin:"),
    );
    expect(eligibilityReads).toContain('.from("public_site_leads")');
    expect(eligibilityReads).toContain('.from("students")');
    expect(eligibilityReads).toContain('.from("enrollments")');
    expect(eligibilityReads).toContain('.from("tenants")');
    expect(eligibilityReads).not.toMatch(/\badmin\s*\.\s*from\(/);
    expect(sendRoute.indexOf("student_portal_invitation_admin_init")).toBeGreaterThan(
      sendRoute.indexOf('"get_student_portal_invitation_status"'),
    );
    expect(sendRoute.indexOf("student_portal_invitation_admin_init")).toBeLessThan(
      sendRoute.indexOf('"prepare_student_portal_invitation_secure"'),
    );
    expect(sendRoute.indexOf("student_portal_invitation_prepare")).toBeGreaterThan(
      sendRoute.indexOf('"prepare_student_portal_invitation_secure"'),
    );
    expect(sendRoute).toMatch(
      /try \{\s+admin = getSupabaseAdminClient\(\);\s+\} catch \{[\s\S]{0,700}errorCode: "server_admin_not_configured"[\s\S]{0,700}"server_admin_not_configured"/,
    );
    expect(sendRoute).toMatch(
      /if \(prepareResult\.error \|\| !prepareResult\.data\) \{[\s\S]{0,900}errorCode: "invitation_prepare_failed"[\s\S]{0,900}"invitation_prepare_failed"/,
    );
    expect(sendRoute).toContain(
      'admin.rpc(\n      "prepare_student_portal_invitation_secure"',
    );
    expect(sendRoute).toContain(
      'admin.rpc(\n      "record_student_portal_invitation_delivery_secure"',
    );
    expect(sendRoute).not.toContain(
      'userScopedSupabase.rpc(\n      "prepare_student_portal_invitation_secure"',
    );
    expect(sendRoute).not.toContain(
      'userScopedSupabase.rpc(\n      "record_student_portal_invitation_delivery_secure"',
    );
    expect(sendRoute).toMatch(
      /if \(requestResult\.error\) \{[\s\S]{0,300}"student_portal_invitation_request_read"[\s\S]{0,300}requestResult\.error/,
    );
    expect(sendRoute).toMatch(
      /if \(!requestResult\.data\) \{\s+return jsonError\("Enrolled request not found\.", 404, "invalid_request"\);/,
    );
    expect(sendRoute).toContain('errorCode: "eligibility_read_failed"');
    expect(sendRoute).toContain('allowed_roles: ["owner", "admin"]');
    expect(sendRoute).not.toContain("captureServerException(caught");
    expect(sendRoute).not.toContain("captureServerException(prepareResult.error");
    expect(sendRoute).not.toContain("captureServerException(deliveryResult.error");

    expect(diagnostics).toContain("postgresCodePattern");
    expect(diagnostics).toContain("postgrestCodePattern");
    expect(diagnostics).not.toContain("details:");
    expect(diagnostics).not.toContain("hint:");
    expect(invitationClient).toContain("StudentPortalInvitationActionError");
    expect(invitationClient).toContain("errorCode: result.error_code");
    expect(invitationClient).toContain(
      "safeProviderCode: result.safe_provider_code",
    );

    const monitoringCall = sendRoute.slice(
      sendRoute.indexOf("function captureInvitationSendDiagnostic"),
      sendRoute.indexOf("function jsonError"),
    );
    for (const sensitive of [
      "rawToken",
      "tokenHash",
      "normalizedEmail",
      "accessToken",
      "serviceRole",
      "inviteUrl",
    ]) {
      expect(monitoringCall).not.toContain(sensitive);
    }

    expect(courseDetail).toContain("Invitation sent");
    expect(courseDetail).toContain("Invitation needs retry");
    expect(courseDetail).toContain("Access active");
    expect(sendRoute).toMatch(
      /return Response\.json\(\{\s+message: "Portal invitation sent\.",\s+status: "invitation_sent",\s+\}\);/,
    );
  });

  test("pending student portal invitation recovery is explicit and race-safe", () => {
    const recoverySql = read(
      "supabase/bundle_ux3d1_pending_invitation_recovery.sql",
    );
    const originalSql = read(
      "supabase/bundle_ux3d_student_portal_invitation_lifecycle.sql",
    );
    const sendRoute = read(
      "app/api/student-portal-invitations/send/route.ts",
    );
    const invitePage = read(
      "src/components/portal/StudentPortalInviteClient.tsx",
    );
    const acceptanceDiagnostics = read(
      "src/lib/studentPortalInvitationAcceptance.ts",
    );

    expect(recoverySql).toContain("begin;");
    expect(recoverySql).toContain("commit;");
    expect(recoverySql).toContain("interval '2 minutes'");
    expect(recoverySql).toContain("v_invitation.updated_at <= now()");
    expect(recoverySql).toContain("limit 1\n  for update;");
    expect(recoverySql).toContain("v_action := 'recovered'");
    expect(recoverySql).toContain("v_action := 'retried'");
    expect(recoverySql).toContain("'token_ready', true");
    expect(recoverySql).toContain("'token_ready', false");
    expect(recoverySql).toContain("v_status := 'needs_attention'");
    expect(recoverySql).toContain("v_can_resend := true");
    expect(recoverySql).toContain("token_hash = v_token_hash");
    expect(recoverySql).not.toMatch(/\b(token|raw_token)\s+text\b/i);

    const recentOrSentReuse = recoverySql.slice(
      recoverySql.indexOf("if found then\n    if v_invitation.status = 'pending'"),
      recoverySql.indexOf(
        "  else\n    select i.*",
        recoverySql.indexOf("if found then\n    if v_invitation.status = 'pending'"),
      ),
    );
    expect(recentOrSentReuse).toContain("'token_ready', false");
    expect(recentOrSentReuse).toContain("v_action := 'recovered'");

    expect(sendRoute).toContain("prepared.token_ready !== true");
    expect(sendRoute).not.toContain("digestResult");
    expect(sendRoute).not.toContain('select("token_hash")');
    expect(sendRoute).toContain(
      'record_student_portal_invitation_delivery_secure',
    );
    expect(sendRoute).not.toMatch(
      /\.from\("(students|enrollments|public_site_leads)"\)[\s\S]{0,500}\.(insert|update|upsert|delete)\(/,
    );

    expect(originalSql).toContain(
      "create or replace function public.accept_student_portal_invitation_secure",
    );
    expect(originalSql).toContain("'replayed', true");
    expect(originalSql).toContain(
      "Sign in with the email address that received this invitation.",
    );
    expect(invitePage).toContain("window.sessionStorage.removeItem(tokenStorageKey)");

    expect(acceptanceDiagnostics).toContain(
      'code === "invitation_expired" || code === "invitation_unavailable"',
    );
    expect(acceptanceDiagnostics).not.toContain(
      'code === "email_mismatch"',
    );

    for (const forbidden of [
      "console.log",
      "console.error",
      "localStorage",
      "document.cookie",
      "token_hash",
    ]) {
      expect(invitePage).not.toContain(forbidden);
    }
  });
});
