import { expect, type Page, test } from "@playwright/test";

import {
  expectNoHardFailure,
  loginToPortal,
  loginToWorkspace,
  requireRegressionEnv,
} from "./helpers/auth";

const appReadinessTimeout = 20_000;
const rawInfrastructureErrorPattern =
  /42501|PGRST\d+|permission denied for|PostgreSQL|Supabase|relation "[^"]+" does not exist/i;
const directWriteMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const protectedTablePathPattern =
  /\/rest\/v1\/(?:cohort_members|enrollments|payment_links|payments|students)(?:$|[/?])/i;
const mutationRpcPathPattern =
  /\/rest\/v1\/rpc\/(?:add_|create_|delete_|mark_|record_|remove_|submit_|update_)/i;
const financeTablePathPattern =
  /\/rest\/v1\/(?:payment_links|payments)(?:$|[/?])/i;
const studentDetailPathPattern = /^\/app\/students\/[0-9a-f-]{36}$/i;
const courseDetailPathPattern = /^\/app\/courses\/[0-9a-f-]{36}$/i;
const safeProviderCodePattern = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;

type FixturePaths = {
  course: string;
  student: string;
};

type ReadOnlyProbe = ReturnType<typeof createReadOnlyProbe>;

let fixturePaths: FixturePaths | null = null;

function getPathname(rawUrl: string) {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return "<invalid-url>";
  }
}

function getSafeRequestCategory(rawUrl: string) {
  const pathname = getPathname(rawUrl);
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "rest" && segments[1] === "v1") {
    return segments[2] === "rpc"
      ? `/rest/v1/rpc/${segments[3] ?? "<operation>"}`
      : `/rest/v1/${segments[2] ?? "<resource>"}`;
  }

  return `/${segments
    .slice(0, 3)
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment) ? "<id>" : segment,
    )
    .join("/")}`;
}

function sanitizeConsoleError(rawText: string) {
  return rawText
    .replace(/https?:\/\/[^\s)]+/gi, (rawUrl) => getSafeRequestCategory(rawUrl))
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "<email>")
    .replace(/eyJ[a-zA-Z0-9._-]+/g, "<credential>")
    .replace(
      /\b(authorization|cookie|service[_-]?role|token|hash|apikey)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=<redacted>",
    )
    .slice(0, 500);
}

function getSafeProviderCode(value: unknown) {
  return typeof value === "string" && safeProviderCodePattern.test(value)
    ? value
    : null;
}

function createReadOnlyProbe(page: Page) {
  const directWrites: string[] = [];
  const pageErrors: string[] = [];
  const rawConsoleErrors: string[] = [];
  const authorizationResponses: number[] = [];
  const failedResponseCategories: string[] = [];
  const failedResponseDetails: string[] = [];
  const pendingResponseReads: Promise<void>[] = [];
  const cohortResponseCounts = new Map<string, number>();
  let financeReads = 0;

  const onPageError = (error: Error) => {
    pageErrors.push(error.name || "Error");
  };
  const onConsole = (message: { text(): string; type(): string }) => {
    if (
      message.type() === "error" &&
      rawInfrastructureErrorPattern.test(message.text())
    ) {
      rawConsoleErrors.push(
        `${getPathname(page.url())}: ${sanitizeConsoleError(message.text())}`,
      );
    }
  };
  const onRequest = (request: { method(): string; url(): string }) => {
    const method = request.method().toUpperCase();
    const pathname = getPathname(request.url());

    if (method === "GET" && financeTablePathPattern.test(pathname)) {
      financeReads += 1;
    }

    if (
      directWriteMethods.has(method) &&
      (protectedTablePathPattern.test(pathname) ||
        mutationRpcPathPattern.test(pathname))
    ) {
      directWrites.push(`${method} protected_business_path`);
    }
  };
  const onResponse = (response: {
    json(): Promise<unknown>;
    status(): number;
    url(): string;
  }) => {
    const pathname = getPathname(response.url());

    if (/\/rest\/v1\/(?:cohorts|cohort_members)(?:$|[/?])/i.test(pathname)) {
      const category = `${response.status()} ${getSafeRequestCategory(response.url())}`;
      cohortResponseCounts.set(category, (cohortResponseCounts.get(category) ?? 0) + 1);
    }

    if (response.status() >= 400) {
      const category = `${response.status()} ${getSafeRequestCategory(response.url())}`;

      if (!failedResponseCategories.includes(category)) {
        failedResponseCategories.push(category);
      }

      pendingResponseReads.push(
        response
          .json()
          .then((body) => {
            const code =
              body && typeof body === "object" && "code" in body
                ? getSafeProviderCode(body.code)
                : null;
            const detail = `${category}${code ? ` code=${code}` : ""}`;

            if (!failedResponseDetails.includes(detail)) {
              failedResponseDetails.push(detail);
            }
          })
          .catch(() => undefined),
      );
    }

    if (response.status() === 401 || response.status() === 403) {
      const pathname = getPathname(response.url());

      if (
        pathname.startsWith("/rest/v1/") ||
        pathname.startsWith("/api/")
      ) {
        authorizationResponses.push(response.status());
      }
    }
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("request", onRequest);
  page.on("response", onResponse);

  return {
    async assertClean(options: { maxAuthorizationResponses?: number } = {}) {
      await Promise.allSettled(pendingResponseReads);
      expect(
        directWrites,
        "read-only smoke must not issue protected business writes",
      ).toEqual([]);
      expect(pageErrors, "route must not raise uncaught page errors").toEqual(
        [],
      );
      expect(
        rawConsoleErrors,
        "route must not log raw infrastructure errors",
      ).toEqual([]);
      expect(
        authorizationResponses.length,
        "route must not enter an authorization failure loop",
      ).toBeLessThanOrEqual(options.maxAuthorizationResponses ?? 0);
    },
    dispose() {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      page.off("request", onRequest);
      page.off("response", onResponse);
    },
    get financeReads() {
      return financeReads;
    },
    summary() {
      const responseSummary =
        failedResponseDetails.length > 0
          ? failedResponseDetails
          : failedResponseCategories;
      return responseSummary.length > 0
        ? responseSummary.join(", ")
        : "no categorized HTTP failures";
    },
    cohortSummary() {
      return cohortResponseCounts.size > 0
        ? Array.from(cohortResponseCounts.entries())
            .map(([category, count]) => `${category} count=${count}`)
            .join(", ")
        : "no cohort REST reads observed";
    },
    assertCohortReadsHealthy(options: { required?: boolean } = {}) {
      const responses = Array.from(cohortResponseCounts.entries());
      const failed = responses
        .filter(([category]) => !/^2\d\d /.test(category))
        .map(([category, count]) => `${category} count=${count}`);
      const responseCount = responses.reduce((total, [, count]) => total + count, 0);

      expect(failed, "cohort REST reads must not fail").toEqual([]);
      expect(
        responseCount,
        "cohort REST reads must not enter a repeated request loop",
      ).toBeLessThanOrEqual(30);
      if (options.required) {
        expect(
          responseCount,
          "this route must exercise cohort or cohort-member RLS",
        ).toBeGreaterThan(0);
      }
    },
  };
}

async function openReadOnlyRoute(
  page: Page,
  path: string,
  expectedText: RegExp,
) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  expect(response, `${path} should return a page response`).not.toBeNull();
  expect(response?.status(), `${path} should not be an HTTP error`).toBeLessThan(
    400,
  );
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expectNoHardFailure(page);
  await expect(page.locator("body")).toContainText(expectedText, {
    timeout: appReadinessTimeout,
  });
  await expect(page.locator("body")).not.toContainText(
    rawInfrastructureErrorPattern,
  );
}

async function expectFinanceContext(page: Page, probe: ReadOnlyProbe) {
  await expect(
    page.getByText("Historical payment-link records", { exact: true }),
  ).toBeVisible({ timeout: appReadinessTimeout });
  await expect(
    page.getByText("Historical student payments", { exact: true }),
  ).toBeVisible({ timeout: appReadinessTimeout });
  expect(
    probe.financeReads,
    "authorized Student Detail should load finance records",
  ).toBeGreaterThan(0);
}

async function expectFinanceVisibilityMatchesQueries(
  page: Page,
  probe: ReadOnlyProbe,
) {
  const financeContextVisible = await page
    .getByText("Historical payment-link records", { exact: true })
    .isVisible();

  if (financeContextVisible) {
    expect(
      probe.financeReads,
      "visible finance context should be backed by authorized reads",
    ).toBeGreaterThan(0);
    return;
  }

  expect(
    probe.financeReads,
    "hidden finance context must not preload finance records",
  ).toBe(0);
}

function requireDiscoveredFixturePaths(): FixturePaths {
  expect(
    fixturePaths !== null,
    "Owner smoke should discover safe regression fixture paths",
  ).toBe(true);

  return fixturePaths as FixturePaths;
}

async function assertNoPageOverflow(page: Page) {
  const hasPageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );

  expect(hasPageOverflow, "mobile page should not overflow horizontally").toBe(
    false,
  );
}

async function discoverRegressionFixturePaths(page: Page) {
  await loginToWorkspace(page, "owner", "/app/enrollments");
  await openReadOnlyRoute(page, "/app/enrollments", /Enrollments/i);
  const smokeProgramLink = page
    .getByRole("link", { exact: true, name: "CoachFort Smoke Program" })
    .first();
  await expect(
    smokeProgramLink,
    "the existing CoachFort Smoke Program enrollment should be available",
  ).toBeVisible({ timeout: appReadinessTimeout });
  const enrollmentRow = smokeProgramLink.locator("..");
  const studentPath = await enrollmentRow
    .locator('a[href^="/app/students/"]')
    .first()
    .getAttribute("href");
  const coursePath = await smokeProgramLink.getAttribute("href");

  expect(
    Boolean(studentPath && studentDetailPathPattern.test(studentPath)),
    "student fixture link should be a safe internal detail path",
  ).toBe(true);
  expect(
    Boolean(coursePath && courseDetailPathPattern.test(coursePath)),
    "program fixture link should be a safe internal detail path",
  ).toBe(true);

  return {
    course: coursePath as string,
    student: studentPath as string,
  };
}

test.describe("UX-4B authenticated production deployment smoke", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      fixturePaths = await discoverRegressionFixturePaths(page);
    } finally {
      await context.close();
    }
  });

  test("Owner can read students, enrollments, Student Detail, and the Smoke Program", async ({
    page,
  }) => {
    requireRegressionEnv(["owner"]);
    await loginToWorkspace(page, "owner", "/app/enrollments");
    const probe = createReadOnlyProbe(page);

    try {
      await openReadOnlyRoute(page, "/app/students", /Students/i);
      await expect(
        page.locator('a[href^="/app/students/"]').first(),
        "Owner should have an existing safe student fixture",
      ).toBeVisible({ timeout: appReadinessTimeout });

      await openReadOnlyRoute(page, "/app/enrollments", /Enrollments/i);
      await expect(page.getByLabel("Search")).toBeVisible();
      await expect(page.getByLabel("Status")).toBeVisible();

      const paths = requireDiscoveredFixturePaths();

      await openReadOnlyRoute(
        page,
        paths.course,
        /CoachFort Smoke Program/i,
      );
      await expect(
        page.getByText("Program enrollment roster", { exact: true }),
      ).toBeVisible({ timeout: appReadinessTimeout });
      await expect(
        page.getByText("Enrolled Students", { exact: true }),
      ).toBeVisible();

      await openReadOnlyRoute(
        page,
        paths.student,
        /Student profile|Enrolled programs/i,
      );
      await expect(
        page.getByText("Enrolled programs", { exact: true }),
        `Owner Student Detail should load (${probe.summary()})`,
      ).toBeVisible();
      await expect(
        page.getByText("CoachFort Smoke Program", { exact: true }).first(),
      ).toBeVisible();
      await expectFinanceContext(page, probe);
      probe.assertCohortReadsHealthy({ required: true });
      await probe.assertClean();
    } finally {
      probe.dispose();
    }
  });

  test("Admin retains authorized Student Detail and finance reads", async ({
    page,
  }) => {
    requireRegressionEnv(["admin"]);
    const paths = requireDiscoveredFixturePaths();
    await loginToWorkspace(page, "admin", "/app/students");
    const probe = createReadOnlyProbe(page);

    try {
      await openReadOnlyRoute(page, "/app/students", /Students/i);
      await openReadOnlyRoute(page, "/app/enrollments", /Enrollments/i);
      await openReadOnlyRoute(
        page,
        paths.student,
        /Student profile|Enrolled programs/i,
      );
      await expect(
        page.getByText("Enrolled programs", { exact: true }),
        `Admin Student Detail should load (${probe.summary()})`,
      ).toBeVisible();
      await expect(
        page.getByText("CoachFort Smoke Program", { exact: true }).first(),
      ).toBeVisible();
      await expectFinanceContext(page, probe);
      await probe.assertClean();
    } finally {
      probe.dispose();
    }
  });

  test("Staff reads remain safe and finance loading follows effective permission", async ({
    page,
  }) => {
    requireRegressionEnv(["staff"]);
    const paths = requireDiscoveredFixturePaths();
    await loginToWorkspace(page, "staff", "/app/students");
    const probe = createReadOnlyProbe(page);

    try {
      await openReadOnlyRoute(page, "/app/students", /Students/i);
      await openReadOnlyRoute(page, "/app/enrollments", /Enrollments/i);
      await openReadOnlyRoute(
        page,
        paths.student,
        /Student profile|Enrolled programs/i,
      );
      await expect(
        page.getByText("Enrolled programs", { exact: true }),
        `Staff Student Detail should load (${probe.summary()})`,
      ).toBeVisible();
      await expectFinanceVisibilityMatchesQueries(page, probe);
      await probe.assertClean({ maxAuthorizationResponses: 1 });
    } finally {
      probe.dispose();
    }
  });

  test("unassigned Trainer remains scoped out of student, enrollment, cohort, and finance controls", async ({
    page,
  }) => {
    requireRegressionEnv(["trainer"]);
    const paths = requireDiscoveredFixturePaths();
    await loginToWorkspace(page, "trainer", "/app/students");
    const probe = createReadOnlyProbe(page);

    try {
      await openReadOnlyRoute(
        page,
        "/app/students",
        /Students|No students added yet/i,
      );
      await expect(
        page.locator('a[href^="/app/students/"]'),
        "unassigned Trainer should not receive tenant-wide student links",
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add Student" })).toHaveCount(
        0,
      );

      await openReadOnlyRoute(
        page,
        "/app/enrollments",
        /Enrollments|No enrollments found/i,
      );
      await expect(
        page.locator('a[href^="/app/students/"]'),
        "unassigned Trainer should not receive tenant-wide enrollment links",
      ).toHaveCount(0);

      await openReadOnlyRoute(
        page,
        paths.student,
        /Student profile/i,
      );
      await expect(
        page.locator("body"),
        `Trainer direct Student Detail should be controlled (${probe.summary()})`,
      ).toContainText(
        /Student not found|do not have access|Access denied/i,
      );
      await expect(
        page.getByText("Enrolled programs", { exact: true }),
      ).toHaveCount(0);
      for (const actionName of [
        "Add to Cohort",
        "Delete Student",
        "Edit Student",
        "Enroll in Program",
        "Open Sales",
      ]) {
        await expect(
          page.getByRole("button", { exact: true, name: actionName }),
          `${actionName} must be unavailable outside Trainer scope`,
        ).toHaveCount(0);
      }
      await expectFinanceVisibilityMatchesQueries(page, probe);
      await probe.assertClean({ maxAuthorizationResponses: 1 });
    } finally {
      probe.dispose();
    }
  });

  test("regression Student portal learning reads remain authorized and recursion-free", async ({
    page,
  }) => {
    requireRegressionEnv(["student"]);
    await loginToPortal(page);
    const probe = createReadOnlyProbe(page);

    try {
      await openReadOnlyRoute(page, "/portal", /Student portal|Programs/i);
      await openReadOnlyRoute(page, "/portal/courses", /My Programs/i);
      await expect(
        page.getByText("Unable to load student portal.", { exact: true }),
        `Student Portal course reads should succeed (${probe.summary()})`,
      ).toHaveCount(0);
      const noPrograms = page.getByText(
        "No programs have been assigned to you yet. Your coach will add programs here after your access is active.",
        { exact: true },
      );
      const activeBadges = page.getByText(/^Active$/i);
      const completedBadges = page.getByText(/^Completed$/i);

      if (await noPrograms.isVisible()) {
        await expect(page.getByText("Enrolled", { exact: true })).toBeVisible();
        await expect(page.getByText("0", { exact: true }).first()).toBeVisible();
        test.info().annotations.push({
          description:
            "NO ACTIVE PORTAL FIXTURE - AUTHORIZED EMPTY/COHORT READ COVERAGE ONLY",
          type: "fixture",
        });
      } else {
        expect(
          (await activeBadges.count()) + (await completedBadges.count()),
          "assigned program cards should expose their enrollment state",
        ).toBeGreaterThan(0);
      }

      const completedCount = await completedBadges.count();
      if (completedCount === 0) {
        test.info().annotations.push({
          description: "NO COMPLETED PORTAL FIXTURE - STATIC/SQL COVERAGE ONLY",
          type: "fixture",
        });
      }
      await expect(page.getByText(/^Paused$/i)).toHaveCount(0);
      await expect(page.getByText(/^Cancelled$/i)).toHaveCount(0);
      test.info().annotations.push({
        description:
          "NO SAFE PAUSED/CANCELLED FIXTURE - STATIC/SQL COVERAGE ONLY",
        type: "fixture",
      });

      await openReadOnlyRoute(page, "/portal/sessions", /Live Classes/i);
      await openReadOnlyRoute(page, "/portal/assignments", /Assignments/i);
      await openReadOnlyRoute(page, "/portal/documents", /Materials/i);
      probe.assertCohortReadsHealthy({ required: true });
      await probe.assertClean();
    } finally {
      probe.dispose();
    }
  });

  test("Owner mobile routes remain readable without page overflow", async ({
    page,
  }) => {
    requireRegressionEnv(["owner"]);
    const paths = requireDiscoveredFixturePaths();
    await page.setViewportSize({ height: 844, width: 390 });
    await loginToWorkspace(page, "owner", "/app/students");
    const probe = createReadOnlyProbe(page);

    try {
      await openReadOnlyRoute(page, "/app/students", /Students/i);
      await assertNoPageOverflow(page);
      await openReadOnlyRoute(page, "/app/enrollments", /Enrollments/i);
      await assertNoPageOverflow(page);
      await openReadOnlyRoute(
        page,
        paths.student,
        /Student profile|Enrolled programs/i,
      );
      await expect(
        page.getByText("Enrolled programs", { exact: true }),
        `Owner mobile Student Detail should load (${probe.summary()})`,
      ).toBeVisible();
      await assertNoPageOverflow(page);
      await probe.assertClean();
    } finally {
      probe.dispose();
    }
  });
});
