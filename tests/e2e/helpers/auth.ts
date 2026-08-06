import { expect, type Locator, type Page, test } from "@playwright/test";

export type RegressionRole =
  | "admin"
  | "owner"
  | "platformOwner"
  | "staff"
  | "student"
  | "trainer";

type WorkspaceRegressionRole = Exclude<RegressionRole, "student">;

const emailEnvNameByRole: Record<RegressionRole, string> = {
  admin: "COACHFORT_ADMIN_EMAIL",
  owner: "COACHFORT_OWNER_EMAIL",
  platformOwner: "COACHFORT_PLATFORM_OWNER_EMAIL",
  staff: "COACHFORT_STAFF_EMAIL",
  student: "COACHFORT_STUDENT_EMAIL",
  trainer: "COACHFORT_TRAINER_EMAIL",
};

const passwordEnvNameByRole: Record<RegressionRole, string> = {
  admin: "COACHFORT_ADMIN_PASSWORD",
  owner: "COACHFORT_OWNER_PASSWORD",
  platformOwner: "COACHFORT_PLATFORM_OWNER_PASSWORD",
  staff: "COACHFORT_STAFF_PASSWORD",
  student: "COACHFORT_STUDENT_PASSWORD",
  trainer: "COACHFORT_TRAINER_PASSWORD",
};

const appReadinessTimeout = 20_000;
const loginUrlPattern = /\/login(?:$|[/?#])/;
const portalLoginUrlPattern = /\/portal\/login(?:$|[/?#])/;
const portalUrlPattern = /\/portal(?:$|[/?#])/;

function getRegressionCredential(role: RegressionRole) {
  const emailEnvName = emailEnvNameByRole[role];
  const passwordEnvName = passwordEnvNameByRole[role];
  const email = process.env[emailEnvName];
  const password = process.env[passwordEnvName];

  if (!email) {
    throw new Error(`${emailEnvName} is required.`);
  }

  if (!password) {
    throw new Error(`${passwordEnvName} is required.`);
  }

  return { email, password };
}

export function requireRegressionEnv(
  roles: RegressionRole[],
  reason = "Set regression account env vars to run authenticated smoke tests.",
) {
  const requiredEnvNames = roles.flatMap((role) => [
    emailEnvNameByRole[role],
    passwordEnvNameByRole[role],
  ]);
  const missing = requiredEnvNames.filter((name) => !process.env[name]);

  test.skip(missing.length > 0, `${reason} Missing: ${missing.join(", ")}.`);
}

async function waitForModuleAccessCheckToFinish(page: Page) {
  const moduleAccessCheck = page
    .getByText("Checking module access...", { exact: true })
    .first();
  const appeared = await moduleAccessCheck
    .waitFor({ state: "visible", timeout: 1_500 })
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
  await expect(
    input,
    `${String(label)} input should contain a non-empty value`,
  ).not.toHaveValue("", { timeout: appReadinessTimeout });
}

export async function loginToWorkspace(
  page: Page,
  role: WorkspaceRegressionRole,
  nextPath = "/app",
) {
  const credential = getRegressionCredential(role);

  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await fillLoginInput(page, "Email", credential.email);
  await fillLoginInput(page, "Password", credential.password);
  const loginButton = page.getByRole("button", { name: /^Login$/ });
  await expect(
    loginButton,
    "workspace login button should be ready",
  ).toBeEnabled({
    timeout: appReadinessTimeout,
  });
  await loginButton.click();
  await expect(page, "workspace login should leave the login route").not.toHaveURL(
    loginUrlPattern,
    { timeout: appReadinessTimeout },
  );
  await expect(
    loginButton,
    "workspace login form should no longer be visible",
  ).toBeHidden({
    timeout: appReadinessTimeout,
  });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

export async function loginToPortal(page: Page) {
  const credential = getRegressionCredential("student");

  await page.goto("/portal/login", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await fillLoginInput(page, "Student email", credential.email);
  await fillLoginInput(page, "Password", credential.password);
  const portalLoginButton = page.getByRole("button", {
    name: /Open Student Portal/i,
  });
  await expect(
    portalLoginButton,
    "student portal login button should be ready",
  ).toBeEnabled({
    timeout: appReadinessTimeout,
  });
  await portalLoginButton.click();
  await expect(
    page,
    "student portal login should leave /portal/login",
  ).not.toHaveURL(portalLoginUrlPattern, { timeout: appReadinessTimeout });
  await expect(
    page,
    "student portal login should land on a portal route",
  ).toHaveURL(portalUrlPattern, { timeout: appReadinessTimeout });
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

function getSafeUrlCategory(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const safeOrigin = url.hostname.endsWith(".supabase.co")
      ? "supabase://configured-project"
      : url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "::1" ||
          url.hostname === "coachfort.com"
        ? url.origin
        : `${url.protocol}//<external-host>`;
    const segments = url.pathname.split("/").filter(Boolean);
    let pathCategory = "/";

    if (segments[0] === "rest" && segments[1] === "v1") {
      pathCategory =
        segments[2] === "rpc"
          ? `/rest/v1/rpc/${segments[3] ?? "<operation>"}`
          : `/rest/v1/${segments[2] ?? "<resource>"}`;
    } else if (segments[0] === "auth" && segments[1] === "v1") {
      pathCategory = `/auth/v1/${segments[2] ?? "<operation>"}`;
    } else {
      pathCategory = `/${segments
        .slice(0, 3)
        .map((segment) =>
          /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)
            ? "<id>"
            : segment,
        )
        .join("/")}`;
    }

    return `${safeOrigin}${pathCategory}`;
  } catch {
    return "<invalid-url>";
  }
}

function sanitizeDiagnosticMessage(message: string) {
  return message
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "<masked-email>",
    )
    .replace(
      /https?:\/\/[^\s"'<>]+/gi,
      (url) => getSafeUrlCategory(url),
    )
    .replace(
      /\b(password|authorization|cookie|access_token|refresh_token|otp)\s*[:=]\s*\S+/gi,
      "$1=<redacted>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<masked-id>",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\b/g, "<redacted-token>")
    .slice(0, 500);
}

function createSanitizedRouteDiagnostics(page: Page) {
  const entries: string[] = [];
  const add = (entry: string) => {
    if (entries.length < 20 && !entries.includes(entry)) {
      entries.push(entry);
    }
  };
  const onConsole = (message: { text(): string; type(): string }) => {
    if (message.type() === "error") {
      add(`console:error ${sanitizeDiagnosticMessage(message.text())}`);
    }
  };
  const onRequestFailed = (request: {
    failure(): { errorText: string } | null;
    method(): string;
    url(): string;
  }) => {
    add(
      `request:failed ${request.method()} ${getSafeUrlCategory(request.url())} ${sanitizeDiagnosticMessage(request.failure()?.errorText ?? "unknown failure")}`,
    );
  };
  const onResponse = (response: {
    request(): { method(): string };
    status(): number;
    url(): string;
  }) => {
    if (response.status() >= 400) {
      add(
        `response:${response.status()} ${response.request().method()} ${getSafeUrlCategory(response.url())}`,
      );
    }
  };

  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  return {
    dispose() {
      page.off("console", onConsole);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
    },
    summary() {
      return entries.length > 0
        ? entries.join("\n")
        : "No sanitized console or request failure was observed.";
    },
  };
}

export type ProgramsAccessibleState = "empty" | "loaded";

type ProgramsFailureState =
  | "access_denied"
  | "hard_failure"
  | "http_error"
  | "load_error"
  | "module_unavailable"
  | "timeout";

type ProgramsReadinessOptions = {
  indicatorGraceMs?: number;
  timeoutMs?: number;
};

type ProgramsStateLocators = {
  accessDenied: Locator;
  empty: Locator;
  hardFailure: Locator;
  loadError: Locator;
  loaded: Locator;
  loading: Locator;
  moduleUnavailable: Locator;
  terminal: Locator;
};

class ProgramsReadinessError extends Error {
  constructor(
    readonly state: ProgramsFailureState,
    diagnosticSummary: string,
  ) {
    super(`Programs readiness failed: ${state}.\n${diagnosticSummary}`);
    this.name = "ProgramsReadinessError";
  }
}

function getProgramsStateLocators(page: Page): ProgramsStateLocators {
  const loaded = page
    .getByRole("link", { name: /Manage program|View program/i })
    .first();
  const empty = page.getByRole("heading", {
    exact: true,
    name: "Create your first program",
  });
  const loadError = page.getByRole("button", { exact: true, name: "Retry" });
  const accessDenied = page.getByText(
    "You do not have access to this workspace area.",
    { exact: true },
  );
  const moduleUnavailable = page.getByText(
    "This module is not enabled for your workspace.",
    { exact: true },
  );
  const hardFailure = page
    .getByText(
      /404: NOT_FOUND|This page could not be found|Application error|Unhandled Runtime Error/i,
    )
    .first();
  const loading = page
    .getByText("Checking module access...", { exact: true })
    .first()
    .or(page.getByText("Loading program", { exact: true }).first())
    .first();
  const terminal = loaded
    .or(empty)
    .or(loadError)
    .or(accessDenied)
    .or(moduleUnavailable)
    .or(hardFailure)
    .first();

  return {
    accessDenied,
    empty,
    hardFailure,
    loadError,
    loaded,
    loading,
    moduleUnavailable,
    terminal,
  };
}

async function waitForProgramsTerminalState(
  page: Page,
  diagnostics: ReturnType<typeof createSanitizedRouteDiagnostics>,
  options: ProgramsReadinessOptions = {},
): Promise<ProgramsAccessibleState> {
  const indicatorGraceMs = options.indicatorGraceMs ?? 1_500;
  const timeoutMs = options.timeoutMs ?? appReadinessTimeout;
  const states = getProgramsStateLocators(page);
  const terminalAlreadyVisible = await states.terminal.isVisible();

  if (!terminalAlreadyVisible) {
    const loadingAppeared = await states.loading
      .waitFor({ state: "visible", timeout: indicatorGraceMs })
      .then(() => true)
      .catch(() => false);

    if (loadingAppeared) {
      await Promise.any([
        states.loading.waitFor({ state: "hidden", timeout: timeoutMs }),
        states.terminal.waitFor({ state: "visible", timeout: timeoutMs }),
      ]);
    }
  }

  await states.terminal.waitFor({ state: "visible", timeout: timeoutMs });

  for (const [state, locator] of [
    ["load_error", states.loadError],
    ["access_denied", states.accessDenied],
    ["module_unavailable", states.moduleUnavailable],
    ["hard_failure", states.hardFailure],
  ] as const) {
    if (await locator.isVisible()) {
      throw new ProgramsReadinessError(state, diagnostics.summary());
    }
  }

  if (await states.loaded.isVisible()) {
    return "loaded";
  }

  if (await states.empty.isVisible()) {
    return "empty";
  }

  throw new ProgramsReadinessError("timeout", diagnostics.summary());
}

export async function expectProgramsAccessibleState(
  page: Page,
  options: ProgramsReadinessOptions = {},
): Promise<ProgramsAccessibleState> {
  const diagnostics = createSanitizedRouteDiagnostics(page);

  try {
    return await waitForProgramsTerminalState(page, diagnostics, options);
  } catch (error) {
    if (error instanceof ProgramsReadinessError) {
      throw error;
    }

    throw new ProgramsReadinessError("timeout", diagnostics.summary());
  } finally {
    diagnostics.dispose();
  }
}

export async function expectProgramsRouteReady(
  page: Page,
): Promise<ProgramsAccessibleState> {
  const diagnostics = createSanitizedRouteDiagnostics(page);

  try {
    const response = await page.goto("/app/courses", {
      waitUntil: "domcontentloaded",
    });

    if (!response || response.status() >= 400) {
      throw new ProgramsReadinessError("http_error", diagnostics.summary());
    }

    return await waitForProgramsTerminalState(page, diagnostics);
  } catch (error) {
    if (error instanceof ProgramsReadinessError) {
      throw error;
    }

    throw new ProgramsReadinessError("timeout", diagnostics.summary());
  } finally {
    diagnostics.dispose();
  }
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
