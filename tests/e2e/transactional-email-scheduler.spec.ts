import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { handleTransactionalEmailDrainRequest } from "../../src/lib/server/transactionalEmailDrain";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const routeSource = read(
  "app/api/internal/transactional-email/drain/route.ts",
);
const handlerSource = read("src/lib/server/transactionalEmailDrain.ts");
const vercelConfigPath = join(root, "vercel.json");
const vercelConfigSource = read("vercel.json");
const vercelConfig = JSON.parse(vercelConfigSource) as {
  crons: Array<{ path: string; schedule: string }>;
};

const cronSecret = "c".repeat(48);
const workerSecret = "w".repeat(48);
const safeDrainResult = {
  claimed: 0,
  failed: 0,
  leasePending: 0,
  providerAccepted: 0,
  retryScheduled: 0,
  suppressed: 0,
};

function request(authorization?: string) {
  return new Request("https://coachfort.test/api/internal/transactional-email/drain", {
    headers: authorization ? { authorization } : undefined,
  });
}

async function responseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test.describe("UX-8B1 transactional email scheduler", () => {
  test("cron authorization fails closed for missing configuration", async () => {
    let calls = 0;
    const response = await handleTransactionalEmailDrainRequest(
      request(`Bearer ${cronSecret}`),
      {
        configuredSecret: undefined,
        drain: async () => {
          calls += 1;
          return safeDrainResult;
        },
        minimumSecretLength: 32,
        operation: "transactional_email_cron_drain",
      },
    );

    expect(response.status).toBe(404);
    expect(await responseBody(response)).toEqual({ message: "Not found." });
    expect(calls).toBe(0);
  });

  test("cron authorization rejects missing, malformed, wrong, and Coach JWT credentials", async () => {
    const authorizations = [
      undefined,
      cronSecret,
      `Basic ${cronSecret}`,
      "Bearer",
      "Bearer ",
      "bearer wrong-case",
      "Bearer wrong-secret",
      "Bearer owner.jwt.session",
      `Bearer ${cronSecret} trailing`,
    ];

    for (const authorization of authorizations) {
      let calls = 0;
      const response = await handleTransactionalEmailDrainRequest(
        request(authorization),
        {
          configuredSecret: cronSecret,
          drain: async () => {
            calls += 1;
            return safeDrainResult;
          },
          minimumSecretLength: 32,
          operation: "transactional_email_cron_drain",
        },
      );

      expect(response.status, authorization).toBe(404);
      expect(await responseBody(response)).toEqual({ message: "Not found." });
      expect(calls).toBe(0);
    }
  });

  test("requires a strong cron secret", async () => {
    let calls = 0;
    const weakSecret = "short-cron-secret";
    const response = await handleTransactionalEmailDrainRequest(
      request(`Bearer ${weakSecret}`),
      {
        configuredSecret: weakSecret,
        drain: async () => {
          calls += 1;
          return safeDrainResult;
        },
        minimumSecretLength: 32,
        operation: "transactional_email_cron_drain",
      },
    );

    expect(response.status).toBe(404);
    expect(calls).toBe(0);
  });

  test("correct cron authorization reaches one bounded shared drain call", async () => {
    let calls = 0;
    const response = await handleTransactionalEmailDrainRequest(
      request(`Bearer ${cronSecret}`),
      {
        configuredSecret: cronSecret,
        drain: async () => {
          calls += 1;
          return safeDrainResult;
        },
        minimumSecretLength: 32,
        operation: "transactional_email_cron_drain",
      },
    );

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toEqual(safeDrainResult);
    expect(calls).toBe(1);
  });

  test("cron and worker secrets remain method-specific", () => {
    expect(routeSource).toMatch(
      /export async function GET[\s\S]*configuredSecret: process\.env\.CRON_SECRET/,
    );
    expect(routeSource).toMatch(
      /export async function POST[\s\S]*configuredSecret: process\.env\.COACHFORT_EMAIL_WORKER_SECRET/,
    );
    expect(routeSource).not.toMatch(
      /export async function GET[\s\S]*configuredSecret: process\.env\.COACHFORT_EMAIL_WORKER_SECRET[\s\S]*export async function POST/,
    );
    expect(routeSource).not.toMatch(
      /export async function POST[\s\S]*configuredSecret: process\.env\.CRON_SECRET/,
    );
  });

  test("GET and POST reuse the same drain implementation", () => {
    expect(
      routeSource.match(/handleTransactionalEmailDrainRequest\(request/g),
    ).toHaveLength(2);
    expect(handlerSource).toContain(
      "options.drain ?? drainTransactionalEmailOutbox",
    );
    expect(routeSource).not.toContain("claim_transactional_email_batch_server");
    expect(routeSource).not.toContain("transactional_email_outbox");
    expect(handlerSource).not.toMatch(/\.(?:insert|update|delete)\(/);
    expect(handlerSource).not.toMatch(/getSupabase|admin\.rpc|createClient/);
  });

  test("worker authorization remains operational through the shared boundary", async () => {
    let calls = 0;
    const response = await handleTransactionalEmailDrainRequest(
      request(`Bearer ${workerSecret}`),
      {
        configuredSecret: workerSecret,
        drain: async () => {
          calls += 1;
          return safeDrainResult;
        },
        operation: "transactional_email_drain",
      },
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });

  test("failure responses do not expose secrets, recipients, or provider detail", async () => {
    const response = await handleTransactionalEmailDrainRequest(
      request(`Bearer ${cronSecret}`),
      {
        configuredSecret: cronSecret,
        drain: async () => {
          throw new Error(
            `provider rejected student@example.com using ${cronSecret}`,
          );
        },
        minimumSecretLength: 32,
        operation: "transactional_email_cron_drain",
      },
    );
    const body = JSON.stringify(await responseBody(response));

    expect(response.status).toBe(503);
    expect(body).toContain(
      "Transactional email processing is temporarily unavailable.",
    );
    expect(body).not.toContain(cronSecret);
    expect(body).not.toContain("student@example.com");
    expect(body).not.toContain("provider rejected");
  });

  test("activates only the approved production cron schedules", () => {
    expect(existsSync(vercelConfigPath)).toBe(true);
    expect(vercelConfig).toEqual({
      crons: [
        {
          path: "/api/internal/subscription-lifecycle/reminders",
          schedule: "0 6 * * *",
        },
        {
          path: "/api/internal/transactional-email/drain",
          schedule: "*/5 * * * *",
        },
      ],
    });
    expect(new Set(vercelConfig.crons.map((cron) => cron.path)).size).toBe(2);
    for (const cron of vercelConfig.crons) {
      expect(cron.path).not.toMatch(/\?|dryRun|tenantId|[?&]event=/i);
    }
    expect(vercelConfigSource).not.toMatch(
      /CRON_SECRET|COACHFORT_EMAIL_WORKER_SECRET|authorization|bearer/i,
    );
    expect(read(".env.example")).toMatch(/^CRON_SECRET=$/m);
  });
});
