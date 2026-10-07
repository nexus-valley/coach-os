import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { basename, join, relative } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const root = process.cwd();
const coursesPath = join(
  root,
  "src",
  "components",
  "courses",
  "CoursesPageClient.tsx",
);
const routePath = join(root, "app", "app", "courses", "page.tsx");
const globalsPath = join(root, "app", "globals.css");
const coursesSource = readFileSync(coursesPath, "utf8");
const routeSource = readFileSync(routePath, "utf8");
const runtimeRoot = join(root, "support-ops", "runtime-tests", "uix-1e5a-courses");
const focusedScreenshots = join(runtimeRoot, "focused");

const frozenHashes = {
  Card: "3366d932a8d016eee53d641e0657921c6b570fbc11bb99e7fc95c4a1762e5ce7",
  EmptyState:
    "387a96f05b082b7f367def9ac2a23ce0f9a858445bddbc84d5a98e507dcb8041",
  PageContainer:
    "9d52b3896bfc0839cd4c265dc7eb5b52b717393858442367e780523b0ecf38ba",
  PageHeader:
    "7192e28cc8b1a4e0fa1d8264365a7d6735f1685cd897dbdbece9195443115f41",
  PageToolbar:
    "55b68dbfc4d452d57881e8b696e5e4445e9b1318def7dcd6b2e2e0aadecaebad",
  SectionHeader:
    "febd7464dde1de19222f2bf13cbf35f5e46e6ef4cfe7aca91243e329e45436ec",
  StatCard:
    "e2bb86541eba1c3294e3a2fc7c6a685facbb5aa4006bc80b768ef6c3601eac81",
} as const;

const uiFiles = [
  "Badge.tsx",
  "Button.tsx",
  "buttonStyles.ts",
  "Card.tsx",
  "EmptyState.tsx",
  "FeedbackAlert.tsx",
  "FormField.tsx",
  "PageContainer.tsx",
  "PageHeader.tsx",
  "SectionHeader.tsx",
  "Skeleton.tsx",
  "StatCard.tsx",
] as const;

const widthMatrix = [
  { available: 350, viewport: { height: 844, width: 390 } },
  { available: 390, viewport: { height: 932, width: 430 } },
  { available: 720, viewport: { height: 1024, width: 768 } },
  { available: 772, viewport: { height: 1180, width: 820 } },
  { available: 975, viewport: { height: 768, width: 1023 } },
  { available: 672, viewport: { height: 768, width: 1024 } },
  { available: 928, viewport: { height: 800, width: 1280 } },
  { available: 1088, viewport: { height: 900, width: 1440 } },
] as const;

let harnessDirectory: string | undefined;
let harnessProcess: ChildProcess | undefined;
let harnessUrl: string | undefined;

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function productConsumers(component: "PageContainer" | "PageToolbar") {
  return [join(root, "app"), join(root, "src")]
    .flatMap(sourceFiles)
    .filter((path) => basename(path) !== `${component}.tsx`)
    .filter((path) => new RegExp(`<${component}\\b`).test(readFileSync(path, "utf8")))
    .map((path) => relative(root, path).replaceAll("\\", "/"));
}

function expectClose(actual: number, expected: number, tolerance = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

async function availableLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForHarness(
  child: ChildProcess,
  url: string,
  output: () => string,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Courses harness exited early.\n${output()}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The isolated loopback app is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Courses harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(runtimeRoot, { recursive: true });
  rmSync(focusedScreenshots, { force: true, recursive: true });
  mkdirSync(focusedScreenshots, { recursive: true });
  harnessDirectory = mkdtempSync(join(runtimeRoot, "courses-reference-"));

  const appDirectory = join(harnessDirectory, "app");
  const coursesDirectory = join(
    harnessDirectory,
    "src",
    "components",
    "courses",
  );
  const uiDirectory = join(harnessDirectory, "src", "components", "ui");
  const libDirectory = join(harnessDirectory, "src", "lib");
  mkdirSync(appDirectory, { recursive: true });
  mkdirSync(coursesDirectory, { recursive: true });
  mkdirSync(uiDirectory, { recursive: true });
  mkdirSync(libDirectory, { recursive: true });

  copyFileSync(coursesPath, join(coursesDirectory, "CoursesPageClient.tsx"));
  copyFileSync(globalsPath, join(appDirectory, "globals.css"));
  for (const file of uiFiles) {
    copyFileSync(join(root, "src", "components", "ui", file), join(uiDirectory, file));
  }

  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  writeFileSync(
    join(harnessDirectory, "package.json"),
    `${JSON.stringify(
      {
        dependencies: {
          next: packageJson.dependencies.next,
          react: packageJson.dependencies.react,
          "react-dom": packageJson.dependencies["react-dom"],
        },
        private: true,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(harnessDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          esModuleInterop: true,
          isolatedModules: true,
          jsx: "preserve",
          lib: ["dom", "dom.iterable", "esnext"],
          module: "esnext",
          moduleResolution: "bundler",
          noEmit: true,
          paths: { "@/*": ["./*"] },
          plugins: [{ name: "next" }],
          skipLibCheck: true,
          strict: true,
          target: "ES2017",
        },
        exclude: ["node_modules"],
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(harnessDirectory, "next.config.mjs"), "export default {};\n");
  writeFileSync(
    join(appDirectory, "layout.tsx"),
    `import type { ReactNode } from "react";
import "./globals.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
  );
  writeFileSync(
    join(appDirectory, "page.tsx"),
    `import { CoursesPageClient } from "@/src/components/courses/CoursesPageClient";

export default function Page() {
  return (
    <div id="shell" className="min-w-0 lg:pl-72">
      <main id="shell-main" className="min-w-0 px-5 sm:px-6 lg:px-8 py-8">
        <CoursesPageClient />
      </main>
    </div>
  );
}
`,
  );
  writeFileSync(
    join(libDirectory, "courses.ts"),
    `export type CreateCourseInput = {
  description: string;
  status: "draft" | "published";
  tenantId: string;
  title: string;
};

export type Course = {
  created_at: string;
  description: string | null;
  external_payment_url: string | null;
  id: string;
  payment_instructions: string | null;
  price_amount: number | null;
  pricing_type: "free" | "paid";
  public_sales_enabled: boolean;
  sales_currency: string | null;
  sales_headline: string | null;
  sales_payment_mode: "coach_managed" | "external";
  sales_summary: string | null;
  slug: string;
  status: "archived" | "draft" | "published";
  title: string;
};

const course: Course = {
  created_at: "2026-09-20T00:00:00.000Z",
  description: "A source-faithful reference program with a long description that must remain bounded across every required viewport.",
  external_payment_url: null,
  id: "11111111-1111-4111-8111-111111111111",
  payment_instructions: null,
  price_amount: null,
  pricing_type: "free",
  public_sales_enabled: false,
  sales_currency: "INR",
  sales_headline: null,
  sales_payment_mode: "coach_managed",
  sales_summary: null,
  slug: "reference-program",
  status: "draft",
  title: "Reference coaching program with a long title",
};

function state() {
  return new URLSearchParams(window.location.search).get("state") ?? "loaded";
}

export async function getCoursesForTenant(_tenantId: string) {
  if (state() === "loading") return new Promise<Course[]>(() => undefined);
  if (state() === "error") throw new Error("Unable to load programs right now.");
  return state() === "empty" ? [] : [course];
}

export async function createCourse(_input: CreateCourseInput) {
  throw new Error("The visual harness does not submit mutations.");
}
`,
  );
  writeFileSync(
    join(libDirectory, "tenant.ts"),
    `export type Tenant = { id: string; name: string; slug: string };
export async function getCurrentTenant(): Promise<Tenant> {
  return { id: "22222222-2222-4222-8222-222222222222", name: "CoachFort Regression 2026", slug: "coachfort-regression-2026" };
}
`,
  );
  writeFileSync(
    join(libDirectory, "team.ts"),
    `export type MemberRole = "admin" | "owner" | "staff" | "trainer";
export function canManageCourses(role: MemberRole | null) { return role === "owner" || role === "admin"; }
export async function getCurrentMemberRole(_tenantId: string, _userId: string): Promise<MemberRole> { return "owner"; }
`,
  );
  writeFileSync(
    join(libDirectory, "supabaseClient.ts"),
    `export function getSupabaseClient() {
  return { auth: { getUser: async () => ({ data: { user: { id: "33333333-3333-4333-8333-333333333333" } } }) } };
}
`,
  );

  const nextDirectory = join(root, "node_modules", "next");
  const nextPackage = JSON.parse(
    readFileSync(join(nextDirectory, "package.json"), "utf8"),
  ) as { bin?: { next?: string } };
  if (!nextPackage.bin?.next) throw new Error("Next CLI is unavailable.");

  const port = await availableLoopbackPort();
  harnessUrl = `http://127.0.0.1:${port}`;
  harnessProcess = spawn(
    process.execPath,
    [
      join(nextDirectory, nextPackage.bin.next),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: harnessDirectory,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      windowsHide: true,
    },
  );
  let output = "";
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-12_000);
  };
  harnessProcess.stdout?.on("data", capture);
  harnessProcess.stderr?.on("data", capture);
  await waitForHarness(harnessProcess, harnessUrl, () => output);
}

async function stopHarness() {
  const child = harnessProcess;
  harnessProcess = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        const taskkill = spawn(
          join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
          ["/pid", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        taskkill.once("error", () => resolve());
        taskkill.once("exit", () => resolve());
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (harnessDirectory) rmSync(harnessDirectory, { force: true, recursive: true });
  harnessDirectory = undefined;
  harnessUrl = undefined;
}

async function openHarness(page: Page, state = "loaded") {
  if (!harnessUrl) throw new Error("Courses harness was not started.");
  await page.goto(`${harnessUrl}?state=${state}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Create, publish, and share programs",
    }),
  ).toBeVisible();
  if (state === "loaded") {
    await expect(page.getByText("Reference coaching program with a long title")).toBeVisible();
  }
}

test.describe("UIX-1E5A Courses reference page", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await buildHarness();
  });

  test.afterAll(async () => {
    await stopHarness();
  });

  test("keeps the route and Courses client ownership exact", () => {
    expect(routeSource).toContain(
      'import { CoursesPageClient } from "@/src/components/courses/CoursesPageClient";',
    );
    expect(routeSource).toContain('<AppShell activeItem="Programs">');
    expect(routeSource).toContain("<CoursesPageClient />");
    expect(routeSource).toContain('<RouteGuard mode="app">');
  });

  test("uses the frozen page grammar without a competing root width", () => {
    expect(coursesSource).toContain(
      '<PageContainer className="flex flex-col gap-8" width="full">',
    );
    expect(coursesSource).not.toContain('className="mx-auto max-w-7xl"');
    expect(coursesSource).not.toContain("<PageToolbar");
    expect(coursesSource.match(/<h1\b/g) ?? []).toHaveLength(0);
    expect(coursesSource.match(/<h2\b/g) ?? []).toHaveLength(0);
  });

  test("keeps PageHeader as the sole heading owner and Create Program command owner", () => {
    expect(coursesSource).toContain("<PageHeader");
    expect(coursesSource).toContain('eyebrow="Programs"');
    expect(coursesSource).toContain(
      'title="Create, publish, and share programs"',
    );
    expect(coursesSource).toContain(
      'description="Build each coaching offer, prepare the page students will see, and follow enrollment requests through to access."',
    );
    const pageHeader = coursesSource.slice(
      coursesSource.indexOf("<PageHeader"),
      coursesSource.indexOf("<PageHeader") + 700,
    );
    expect(pageHeader).toContain("Create program");
    expect(pageHeader).toContain("setFormOpen(true)");
  });

  test("preserves the existing summary data through Card and StatCard", () => {
    expect(coursesSource).toContain('aria-label="Program overview"');
    expect(coursesSource).toContain("{tenant?.name ?? \"Loading workspace...\"}");
    expect(coursesSource).toContain(
      '<StatCard label="Total programs" value={courses.length} />',
    );
    expect(coursesSource).toContain(
      '<StatCard label="Published" value={publishedCourses} />',
    );
    expect(coursesSource).toContain(
      '<StatCard label="Private drafts" value={draftCourses} />',
    );
  });

  test("preserves loading, error, empty, and populated branches", () => {
    expect(coursesSource).toContain(
      '<FeedbackAlert onRetry={() => window.location.reload()}>',
    );
    expect(coursesSource).toContain("{[0, 1, 2].map((item) => (");
    expect(coursesSource).toContain('<EmptyState');
    expect(coursesSource).toContain('title="Create your first program"');
    expect(coursesSource).toContain("{courses.map((course) => {");
    expect(coursesSource).toContain('title="Your programs"');
  });

  test("does not change Courses data, role, create, or navigation authority", () => {
    for (const authority of [
      "getCurrentTenant()",
      "getSupabaseClient()",
      "getCoursesForTenant(currentTenant.id)",
      "getCurrentMemberRole(currentTenant.id, user.id)",
      "canManageCourses(currentRole)",
      "createCourse({",
      "router.push(`/app/courses/${course.id}`)",
      'href={`/app/courses/${course.id}`}',
      'href={`/app/courses/${course.id}#public-program-setup`}',
      'href={`/app/courses/${course.id}#enrollment-requests`}',
    ]) {
      expect(coursesSource).toContain(authority);
    }
    expect(coursesSource.match(/getCoursesForTenant\(/g)).toHaveLength(1);
    expect(coursesSource).not.toMatch(/\.from\(|\.rpc\(|fetch\(/);
  });

  test("preserves Courses within the approved PageContainer and PageToolbar inventory", () => {
    expect(productConsumers("PageContainer")).toEqual([
      "src/components/announcements/AnnouncementsPageClient.tsx",
      "src/components/courses/CoursesPageClient.tsx",
    ]);
    expect(productConsumers("PageToolbar")).toEqual([
      "src/components/announcements/AnnouncementsPageClient.tsx",
    ]);
  });

  test("leaves every frozen shared primitive byte-identical", () => {
    for (const [name, expected] of Object.entries(frozenHashes)) {
      expect(sha256(join(root, "src", "components", "ui", `${name}.tsx`))).toBe(
        expected,
      );
    }
  });

  test("renders the loaded reference page across the frozen viewport matrix", async ({
    page,
  }) => {
    await openHarness(page);
    for (const entry of widthMatrix) {
      await page.setViewportSize(entry.viewport);
      const shellMain = page.locator("#shell-main");
      const available = await shellMain.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.getBoundingClientRect().width -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)
        );
      });
      expectClose(available, entry.available);
      const containerWidth = await shellMain
        .locator(":scope > div")
        .evaluate((element) => element.getBoundingClientRect().width);
      expectClose(containerWidth, entry.available);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await expect(page.getByRole("button", { name: "Create program" }).first()).toBeVisible();
      if ([390, 768, 1024, 1440].includes(entry.viewport.width)) {
        await page.screenshot({
          fullPage: true,
          path: join(
            focusedScreenshots,
            `${entry.viewport.width}x${entry.viewport.height}.png`,
          ),
        });
      }
    }
  });

  test("keeps the 1023/1024 shell transition exact and bounded", async ({ page }) => {
    await openHarness(page);
    for (const expected of [
      { available: 975, width: 1023 },
      { available: 672, width: 1024 },
    ]) {
      await page.setViewportSize({ height: 768, width: expected.width });
      const geometry = await page.locator("#shell-main").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          available:
            element.getBoundingClientRect().width -
            Number.parseFloat(style.paddingLeft) -
            Number.parseFloat(style.paddingRight),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expectClose(geometry.available, expected.available);
      expect(geometry.overflow).toBeLessThanOrEqual(0);
    }
  });

  test("renders loading, error, and empty states inside the page composition", async ({
    page,
  }) => {
    await openHarness(page, "loading");
    await expect(page.getByText("Loading program")).toHaveCount(3);
    await openHarness(page, "error");
    await expect(page.getByText("Unable to load programs right now.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await openHarness(page, "empty");
    await expect(
      page.getByRole("heading", { level: 3, name: "Create your first program" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create program" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Configure public page" })).toBeVisible();
  });

  test("keeps Create Program open-only behavior and course navigation intact", async ({
    page,
  }) => {
    await openHarness(page);
    await expect(page.getByRole("link", { name: "Manage program" })).toHaveAttribute(
      "href",
      "/app/courses/11111111-1111-4111-8111-111111111111",
    );
    await page.getByRole("button", { name: "Create program" }).first().click();
    await expect(
      page.getByRole("heading", { level: 3, name: "Create a program" }),
    ).toBeVisible();
    await page.getByRole("button", { exact: true, name: "X" }).click();
    await expect(
      page.getByRole("heading", { level: 3, name: "Create a program" }),
    ).toBeHidden();
  });

  test("keeps the composed surface hierarchy unframed and rhythmic", async ({ page }) => {
    await openHarness(page);
    const rootContainer = page.locator("#shell-main > div");
    await expect(rootContainer).toHaveCSS("display", "flex");
    await expect(rootContainer).toHaveCSS("row-gap", "32px");
    await expect(rootContainer).toHaveCSS("max-width", "none");
    await expect(rootContainer).toHaveCSS("padding-left", "0px");
    await expect(rootContainer).toHaveCSS("padding-right", "0px");
    await expect(rootContainer).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
