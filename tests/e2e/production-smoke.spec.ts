import { expect, test } from "@playwright/test";

const publicRoutes = [
  { path: "/", text: /CoachFort|coaching|academy/i },
  { path: "/login", text: /Login to CoachFort/i },
  { path: "/portal/login", text: /Login as a student|Student Portal/i },
];

const privateRoutes = [
  { path: "/app/documents", fallbackText: /Login to CoachFort|Secure access|Document Center|Documents/i },
  { path: "/portal/documents", fallbackText: /Login as a student|Student Portal|Documents/i },
];

test.describe("production route smoke", () => {
  for (const route of publicRoutes) {
    test(`${route.path} returns a rendered page`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      expect(response, `${route.path} should return a page response`).not.toBeNull();
      expect(response?.status(), `${route.path} should not be an HTTP error`).toBeLessThan(400);
      await expect(page.locator("body")).toContainText(route.text);
      await expect(page.locator("body")).not.toContainText(/404: NOT_FOUND|This page could not be found/i);
    });
  }

  for (const route of privateRoutes) {
    test(`${route.path} returns a protected page or auth redirect`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      expect(response, `${route.path} should return a page response`).not.toBeNull();
      expect(response?.status(), `${route.path} should not be an HTTP error`).toBeLessThan(400);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.locator("body")).not.toContainText(/404: NOT_FOUND|This page could not be found/i);
      await expect(page.locator("body")).toContainText(route.fallbackText);
    });
  }
});
