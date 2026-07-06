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

const appReadinessTimeout = 20_000;
const loginUrlPattern = /\/login(?:$|[/?#])/;
const portalLoginUrlPattern = /\/portal\/login(?:$|[/?#])/;
const portalUrlPattern = /\/portal(?:$|[/?#])/;

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

async function waitForModuleAccessCheckToFinish(page: Page) {
  const moduleAccessCheck = page
    .getByText("Checking module access...", { exact: true })
    .first();
  const appeared = await moduleAccessCheck
    .waitFor({ state: "visible", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);

  if (appeared) {
    await expect(
      moduleAccessCheck,
      "module access check should finish before route assertions",
    ).toBeHidden({ timeout: appReadinessTimeout });
  }
}

async function fillLoginInput(
  page: Page,
  label: string | RegExp,
  value: string,
) {
  const input = page.getByLabel(label);

  await expect(input, `${String(label)} input should be ready`).toBeEditable({
    timeout: appReadinessTimeout,
  });
  await input.fill(value);
  await expect(input, `${String(label)} input should keep the entered value`).not.toHaveValue(
    "",
    { timeout: appReadinessTimeout },
  );
}

export async function loginToWorkspace(
  page: Page,
  email: string,
  nextPath = "/app",
) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await fillLoginInput(page, "Email", email);
  await fillLoginInput(page, "Password", regressionEnv.password ?? "");
  const loginButton = page.getByRole("button", { name: /^Login$/ });
  await expect(loginButton, "workspace login button should be ready").toBeEnabled({
    timeout: appReadinessTimeout,
  });
  await loginButton.click();
  await expect(page, "workspace login should leave the login route").not.toHaveURL(
    loginUrlPattern,
    { timeout: appReadinessTimeout },
  );
  await expect(loginButton, "workspace login form should no longer be visible").toBeHidden({
    timeout: appReadinessTimeout,
  });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

export async function loginToPortal(page: Page, email: string) {
  await page.goto("/portal/login", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await fillLoginInput(page, "Student email", email);
  await fillLoginInput(page, "Password", regressionEnv.password ?? "");
  const portalLoginButton = page.getByRole("button", {
    name: /Open Student Portal/i,
  });
  await expect(portalLoginButton, "student portal login button should be ready").toBeEnabled({
    timeout: appReadinessTimeout,
  });
  await portalLoginButton.click();
  await expect(page, "student portal login should leave /portal/login").not.toHaveURL(
    portalLoginUrlPattern,
    { timeout: appReadinessTimeout },
  );
  await expect(page, "student portal login should land on a portal route").toHaveURL(
    portalUrlPattern,
    { timeout: appReadinessTimeout },
  );
  await expect(
    portalLoginButton,
    "student portal login form should no longer be visible",
  ).toBeHidden({ timeout: appReadinessTimeout });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
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
  await waitForModuleAccessCheckToFinish(page);
  await expectNoHardFailure(page);
  await expect(page.locator("body")).toContainText(expectedText, {
    timeout: appReadinessTimeout,
  });
}

export async function expectUnavailableOrDenied(page: Page) {
  await expect(page.locator("body")).toContainText(
    /not enabled|unavailable|Access denied|do not have access|restricted/i,
  );
}
