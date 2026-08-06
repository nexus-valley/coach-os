import { expect, test } from "@playwright/test";

import {
  expectNoHardFailure,
  expectProgramsRouteReady,
  expectProtectedPageLoaded,
  expectUnavailableOrDenied,
  loginToPortal,
  loginToWorkspace,
  requireRegressionEnv,
} from "./helpers/auth";

const ownerAdminRoutes = [
  { path: "/app", text: /Dashboard|Workspace/i },
  { path: "/app/students", text: /Students/i },
  { path: "/app/finance", text: /Finance|Invoice|Payment/i },
  { path: "/app/reports", text: /Reports|Overview/i },
  { path: "/app/documents", text: /Documents/i },
  { path: "/app/messages", text: /Messages|Chat|Thread/i },
  { path: "/app/settings/features", text: /Feature|Module/i },
];

const restrictedForStaffTrainer = [
  "/app/finance",
  "/app/settings/features",
  "/app/team-operations",
];

const studentPortalRoutes = [
  { path: "/portal", text: /Overview|Portal|Courses/i },
  { path: "/portal/payments", text: /Payment|Finance|Invoice|Receipt/i },
  { path: "/portal/documents", text: /Documents/i },
  { path: "/portal/messages", text: /Messages|Chat|Support/i },
  { path: "/portal/assignments", text: /Assignments/i },
];

test.describe("authenticated role and module smoke", () => {
  test("owner can reach key app routes", async ({ page }) => {
    requireRegressionEnv(["owner"]);

    await loginToWorkspace(page, "owner");
    await expectProgramsRouteReady(page);

    for (const route of ownerAdminRoutes) {
      await expectProtectedPageLoaded(page, route.path, route.text);
    }
  });

  test("admin can reach key app routes", async ({ page }) => {
    requireRegressionEnv(["admin"]);

    await loginToWorkspace(page, "admin");
    await expectProgramsRouteReady(page);

    for (const route of ownerAdminRoutes) {
      await expectProtectedPageLoaded(page, route.path, route.text);
    }
  });

  test("staff is blocked from restricted admin routes", async ({ page }) => {
    requireRegressionEnv(["staff"]);

    await loginToWorkspace(page, "staff");

    for (const path of restrictedForStaffTrainer) {
      await page.goto(path, { waitUntil: "networkidle" });
      await expectNoHardFailure(page);
      await expectUnavailableOrDenied(page);
    }
  });

  test("trainer is blocked from restricted admin routes", async ({ page }) => {
    requireRegressionEnv(["trainer"]);

    await loginToWorkspace(page, "trainer");

    for (const path of restrictedForStaffTrainer) {
      await page.goto(path, { waitUntil: "networkidle" });
      await expectNoHardFailure(page);
      await expectUnavailableOrDenied(page);
    }
  });

  test("student can reach safe portal routes and cannot access app routes", async ({
    page,
  }) => {
    requireRegressionEnv(["student"]);

    await loginToPortal(page);

    for (const route of studentPortalRoutes) {
      await expectProtectedPageLoaded(page, route.path, route.text);
      await expect(page.locator("body")).not.toContainText(
        /Team Operations|Feature Settings|Platform Owner Console/i,
      );
    }

    await page.goto("/app/finance", { waitUntil: "networkidle" });
    await expectNoHardFailure(page);
    await expect(page).toHaveURL(/\/login|\/portal/);
  });

  test("platform owner can access platform while tenant users are blocked", async ({
    browser,
  }) => {
    requireRegressionEnv(["platformOwner", "owner", "admin", "staff", "trainer"]);

    const platformContext = await browser.newContext();
    const platformPage = await platformContext.newPage();
    await loginToWorkspace(platformPage, "platformOwner", "/platform");
    await platformPage.goto("/platform", { waitUntil: "networkidle" });
    await expectNoHardFailure(platformPage);
    await expect(platformPage.locator("body")).toContainText(
      /Platform Owner Console|Tenant directory|Platform overview/i,
    );
    await platformContext.close();

    for (const role of ["owner", "admin", "staff", "trainer"] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginToWorkspace(page, role, "/platform");
      await page.goto("/platform", { waitUntil: "networkidle" });
      await expectNoHardFailure(page);
      await expect(page.locator("body"), `${role} should not access platform`).not.toContainText(
        /Platform overview|Tenant directory/i,
      );
      await expect(page.locator("body")).toContainText(
        /Access denied|Platform access|required|restricted/i,
      );
      await context.close();
    }
  });
});

test.describe("authenticated module regressions", () => {
  test("legacy payment routes stay canonicalized to Finance Center", async ({
    page,
  }) => {
    requireRegressionEnv(["owner"]);

    await loginToWorkspace(page, "owner");

    await page.goto("/app/payments", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/app\/finance/);

    await page.goto("/app/receipts", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/app\/finance/);

    await page.goto("/app/payment-links", { waitUntil: "networkidle" });
    await expectNoHardFailure(page);
    await expect(page.locator("body")).toContainText(
      /Payment gateway on hold|not the active finance workflow/i,
    );
    await expect(page.locator("body")).not.toContainText(/Create Payment Link/i);
  });

  test("finance, documents, reports, and chat routes do not show fatal errors", async ({
    page,
  }) => {
    requireRegressionEnv(["owner"]);

    await loginToWorkspace(page, "owner");

    for (const route of [
      { path: "/app/finance", blocked: /Application error|Unable to load finance/i },
      { path: "/app/documents", blocked: /Application error|Unable to load documents/i },
      { path: "/app/reports", blocked: /Application error|Unable to load reports/i },
      { path: "/app/messages", blocked: /Application error|Unable to load messages/i },
    ]) {
      await page.goto(route.path, { waitUntil: "networkidle" });
      await expectNoHardFailure(page);
      await expect(page.locator("body")).not.toContainText(route.blocked);
    }
  });

  test("student portal finance, documents, and chat routes do not show admin navigation", async ({
    page,
  }) => {
    requireRegressionEnv(["student"]);

    await loginToPortal(page);

    for (const path of ["/portal/payments", "/portal/documents", "/portal/messages"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      await expectNoHardFailure(page);
      await expect(page.locator("body")).not.toContainText(
        /Feature Settings|Team Operations|Platform Owner Console|Finance Center/i,
      );
    }
  });
});
