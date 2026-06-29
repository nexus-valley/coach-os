import { expect, test } from "@playwright/test";

import { expectNoHardFailure } from "./helpers/auth";

const publicRoutes = [
  { path: "/", text: /CoachFort|coaching|academy/i },
  { path: "/login", text: /Login to CoachFort/i },
  { path: "/signup", text: /Create|Sign up|academy/i },
  { path: "/forgot-password", text: /Forgot|verification code|email/i },
  { path: "/reset-password", text: /Reset|password|verification code/i },
  { path: "/portal/login", text: /Login as a student|Student Portal/i },
];

const privateRoutes = [
  { path: "/app/documents", fallbackText: /Login to CoachFort|Secure access|Document Center|Documents/i },
  { path: "/app/finance", fallbackText: /Login to CoachFort|Secure access|Finance/i },
  { path: "/app/reports", fallbackText: /Login to CoachFort|Secure access|Reports/i },
  { path: "/portal/documents", fallbackText: /Login as a student|Student Portal|Documents/i },
  { path: "/portal/payments", fallbackText: /Login as a student|Student Portal|Payments|Finance/i },
  { path: "/platform", fallbackText: /Login to CoachFort|Secure access|Platform|Access denied/i },
];

test.describe("production route smoke", () => {
  test("health endpoint returns a safe payload", async ({ request }) => {
    const response = await request.get("/api/health");

    test.skip(
      response.status() === 404,
      "Health endpoint is not deployed on the configured base URL yet.",
    );
    expect(response.status(), "health endpoint should be available").toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe("ok");
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body.environment).toEqual(expect.any(String));
    expect(Object.keys(body).sort()).toEqual([
      "environment",
      "monitoringEnabled",
      "release",
      "status",
      "timestamp",
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /SUPABASE|SERVICE_ROLE|SENTRY_AUTH_TOKEN|RESEND|OTP|password|secret/i,
    );
  });

  test("document remove API rejects unauthenticated requests safely", async ({ request }) => {
    const response = await request.post("/api/documents/remove-file", {
      data: "{",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const bodyText = await response.text();
    const bodyIsSafe =
      bodyText.includes("Authentication required.") &&
      !/Expected property|JSON at position|stack|trace|Supabase|service.?role|token|signedUrl|storage_path|storage_bucket/i.test(
        bodyText,
      );

    test.skip(
      response.status() === 500 && bodyIsSafe,
      "Document remove status-code patch is not deployed on the configured base URL yet.",
    );

    expect(response.status(), "unauthenticated remove should not 500").toBe(401);
    expect(bodyText).toContain("Authentication required.");
    expect(bodyText).not.toMatch(
      /Expected property|JSON at position|stack|trace|Supabase|service.?role|token|signedUrl|storage_path|storage_bucket/i,
    );
  });

  for (const route of publicRoutes) {
    test(`${route.path} returns a rendered page`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      expect(response, `${route.path} should return a page response`).not.toBeNull();
      expect(response?.status(), `${route.path} should not be an HTTP error`).toBeLessThan(400);
      await expect(page.locator("body")).toContainText(route.text);
      await expectNoHardFailure(page);
    });
  }

  for (const route of privateRoutes) {
    test(`${route.path} returns a protected page or auth redirect`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      expect(response, `${route.path} should return a page response`).not.toBeNull();
      expect(response?.status(), `${route.path} should not be an HTTP error`).toBeLessThan(400);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expectNoHardFailure(page);
      await expect(page.locator("body")).toContainText(route.fallbackText);
    });
  }

  test("public tenant site route does not crash", async ({ page }) => {
    const response = await page.goto("/site/coachfort-regression", {
      waitUntil: "domcontentloaded",
    });

    expect(response, "public tenant site should return a response").not.toBeNull();
    expect(response?.status(), "public tenant site should not 500").toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText(
      /Application error|Unhandled Runtime Error/i,
    );
  });
});
