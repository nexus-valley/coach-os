import { expect, type Page, test } from "@playwright/test";

const ownerEmail = process.env.COACHFORT_OWNER_EMAIL;
const adminEmail = process.env.COACHFORT_ADMIN_EMAIL;
const studentEmail = process.env.COACHFORT_STUDENT_EMAIL;
const password = process.env.COACHFORT_TEST_PASSWORD;

async function loginToWorkspace(page: Page, email: string) {
  await page.goto("/login?next=/app/documents", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: /^Login$/ }).click();
  await page.waitForLoadState("networkidle");
}

async function loginToPortal(page: Page, email: string) {
  await page.goto("/portal/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Student email").fill(email);
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: /Open Student Portal/i }).click();
  await page.waitForLoadState("networkidle");
  await page.goto("/portal/documents", { waitUntil: "networkidle" });
}

test.describe("authenticated production smoke", () => {
  test("owner can login and reach app documents", async ({ page }) => {
    test.skip(!ownerEmail || !password, "Set COACHFORT_OWNER_EMAIL and COACHFORT_TEST_PASSWORD to run.");

    await loginToWorkspace(page, ownerEmail ?? "");
    await page.goto("/app/documents", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Documents/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/404: NOT_FOUND|This page could not be found/i);
  });

  test("admin can login and reach app documents", async ({ page }) => {
    test.skip(!adminEmail || !password, "Set COACHFORT_ADMIN_EMAIL and COACHFORT_TEST_PASSWORD to run.");

    await loginToWorkspace(page, adminEmail ?? "");
    await page.goto("/app/documents", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Documents/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/404: NOT_FOUND|This page could not be found/i);
  });

  test("student can login and reach portal documents", async ({ page }) => {
    test.skip(!studentEmail || !password, "Set COACHFORT_STUDENT_EMAIL and COACHFORT_TEST_PASSWORD to run.");

    await loginToPortal(page, studentEmail ?? "");
    await expect(page.getByRole("heading", { name: /Documents/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/404: NOT_FOUND|This page could not be found/i);
  });
});
