import { expect, type Page, test } from "@playwright/test";

export type RegressionRole =
  | "admin"
  | "owner"
  | "platformOwner"
  | "staff"
  | "student"
  | "trainer";

export const regressionEnv = {
  admin: process.env.COACHFORT_ADMIN_EMAIL,
  owner: process.env.COACHFORT_OWNER_EMAIL,
  password: process.env.COACHFORT_TEST_PASSWORD,
  platformOwner: process.env.COACHFORT_PLATFORM_OWNER_EMAIL,
  staff: process.env.COACHFORT_STAFF_EMAIL,
  student: process.env.COACHFORT_STUDENT_EMAIL,
  trainer: process.env.COACHFORT_TRAINER_EMAIL,
};

export function requireRegressionEnv(
  roles: RegressionRole[],
  reason = "Set regression account env vars to run authenticated smoke tests.",
) {
  const missing = [
    !regressionEnv.password ? "COACHFORT_TEST_PASSWORD" : null,
    ...roles.map((role) => {
      const envNameByRole: Record<RegressionRole, string> = {
        admin: "COACHFORT_ADMIN_EMAIL",
        owner: "COACHFORT_OWNER_EMAIL",
        platformOwner: "COACHFORT_PLATFORM_OWNER_EMAIL",
        staff: "COACHFORT_STAFF_EMAIL",
        student: "COACHFORT_STUDENT_EMAIL",
        trainer: "COACHFORT_TRAINER_EMAIL",
      };

      return regressionEnv[role] ? null : envNameByRole[role];
    }),
  ].filter(Boolean);

  test.skip(missing.length > 0, `${reason} Missing: ${missing.join(", ")}.`);
}

export async function loginToWorkspace(
  page: Page,
  email: string,
  nextPath = "/app",
) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(regressionEnv.password ?? "");
  await page.getByRole("button", { name: /^Login$/ }).click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

export async function loginToPortal(page: Page, email: string) {
  await page.goto("/portal/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Student email").fill(email);
  await page.getByLabel("Password").fill(regressionEnv.password ?? "");
  await page.getByRole("button", { name: /Open Student Portal/i }).click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

export async function expectNoHardFailure(page: Page) {
  await expect(page.locator("body")).not.toContainText(
    /404: NOT_FOUND|This page could not be found|Application error|Unhandled Runtime Error/i,
  );
}

export async function expectProtectedPageLoaded(
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
  await expect(page.locator("body")).toContainText(expectedText);
}

export async function expectUnavailableOrDenied(page: Page) {
  await expect(page.locator("body")).toContainText(
    /not enabled|unavailable|Access denied|do not have access|restricted/i,
  );
}
