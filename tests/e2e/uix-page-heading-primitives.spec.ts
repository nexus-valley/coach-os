import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join, relative } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const root = process.cwd();
const globalsPath = join(root, "app", "globals.css");
const pageHeaderPath = join(
  root,
  "src",
  "components",
  "ui",
  "PageHeader.tsx",
);
const sectionHeaderPath = join(
  root,
  "src",
  "components",
  "ui",
  "SectionHeader.tsx",
);
const buttonPath = join(root, "src", "components", "ui", "Button.tsx");
const buttonStylesPath = join(
  root,
  "src",
  "components",
  "ui",
  "buttonStyles.ts",
);

const globalsSource = readFileSync(globalsPath, "utf8");
const pageHeaderSource = readFileSync(pageHeaderPath, "utf8");
const sectionHeaderSource = readFileSync(sectionHeaderPath, "utf8");

const expectedPageHeaderFiles = [
  "src/components/announcements/AnnouncementsPageClient.tsx",
  "src/components/billing/BillingProfilePageClient.tsx",
  "src/components/community/CommunityPageClient.tsx",
  "src/components/dashboard/DashboardPageClient.tsx",
  "src/components/documents/DocumentCenterPage.tsx",
  "src/components/enrollment-requests/EnrollmentRequestsPageClient.tsx",
  "src/components/finance/FinanceCenterPage.tsx",
  "src/components/messages/MessagesPageClient.tsx",
  "src/components/messages/ThreadDetailClient.tsx",
  "src/components/portal/StudentPortalAnnouncements.tsx",
  "src/components/portal/StudentPortalAssignments.tsx",
  "src/components/portal/StudentPortalCertificates.tsx",
  "src/components/portal/StudentPortalCommunity.tsx",
  "src/components/portal/StudentPortalCourses.tsx",
  "src/components/portal/StudentPortalDashboard.tsx",
  "src/components/portal/StudentPortalDocuments.tsx",
  "src/components/portal/StudentPortalMessages.tsx",
  "src/components/portal/StudentPortalNotifications.tsx",
  "src/components/portal/StudentPortalPayments.tsx",
  "src/components/portal/StudentPortalProfile.tsx",
  "src/components/portal/StudentPortalSessions.tsx",
  "src/components/students/StudentDetailClient.tsx",
  "src/components/students/StudentsPageClient.tsx",
  "src/components/subscription/SubscriptionPageClient.tsx",
] as const;

const expectedSectionHeaderFiles = [
  "src/components/billing/BillingProfilePageClient.tsx",
  "src/components/cohorts/CohortsPageClient.tsx",
  "src/components/community/CommunityPageClient.tsx",
  "src/components/courses/CoursesPageClient.tsx",
  "src/components/dashboard/AdminDashboard.tsx",
  "src/components/dashboard/DashboardPageClient.tsx",
  "src/components/dashboard/StaffDashboard.tsx",
  "src/components/dashboard/TrainerDashboard.tsx",
  "src/components/documents/DocumentCenterPage.tsx",
  "src/components/finance/FinanceCenterPage.tsx",
  "src/components/messages/MessagesPageClient.tsx",
  "src/components/messages/ThreadDetailClient.tsx",
  "src/components/operations/OperationsPageClient.tsx",
  "src/components/portal/StudentPortalAnnouncements.tsx",
  "src/components/portal/StudentPortalAssignments.tsx",
  "src/components/portal/StudentPortalCertificates.tsx",
  "src/components/portal/StudentPortalCommunity.tsx",
  "src/components/portal/StudentPortalCourses.tsx",
  "src/components/portal/StudentPortalDashboard.tsx",
  "src/components/portal/StudentPortalDocuments.tsx",
  "src/components/portal/StudentPortalMessages.tsx",
  "src/components/portal/StudentPortalPayments.tsx",
  "src/components/portal/StudentPortalProfile.tsx",
  "src/components/portal/StudentPortalSessions.tsx",
  "src/components/team-operations/TeamOperationsPage.tsx",
  "src/components/ui/TableShell.tsx",
] as const;

const harnessRuntimeRoot = join(root, "support-ops", "runtime-tests");
const screenshotDirectory = join(
  harnessRuntimeRoot,
  "uix-1e2-page-headings",
);
let harnessDirectory: string | undefined;
let harnessProcess: ChildProcess | undefined;
let harnessUrl: string | undefined;

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function consumerInventory(componentName: "PageHeader" | "SectionHeader") {
  const pattern = new RegExp(`<${componentName}(?=\\s|/|>)`, "g");
  const records = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "src"))]
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const uses = source.match(pattern)?.length ?? 0;
      return uses > 0
        ? [{ file: relative(root, file).replaceAll("\\", "/"), uses }]
        : [];
    })
    .sort((left, right) => left.file.localeCompare(right.file));

  return {
    fileCount: records.length,
    files: records.map((record) => record.file),
    uses: records.reduce((sum, record) => sum + record.uses, 0),
  };
}

function availableLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
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
      throw new Error(`Page-heading harness exited early.\n${output()}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The isolated loopback server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Page-heading harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(harnessRuntimeRoot, { recursive: true });
  rmSync(screenshotDirectory, { force: true, recursive: true });
  mkdirSync(screenshotDirectory, { recursive: true });
  harnessDirectory = mkdtempSync(join(harnessRuntimeRoot, "page-headings-"));

  const appDirectory = join(harnessDirectory, "app");
  const targetDirectory = join(appDirectory, "previous");
  const uiDirectory = join(harnessDirectory, "src", "components", "ui");
  mkdirSync(targetDirectory, { recursive: true });
  mkdirSync(uiDirectory, { recursive: true });

  for (const file of [
    pageHeaderPath,
    sectionHeaderPath,
    buttonPath,
    buttonStylesPath,
  ]) {
    copyFileSync(file, join(uiDirectory, file.split(/[\\/]/).at(-1)!));
  }
  copyFileSync(globalsPath, join(appDirectory, "globals.css"));

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
          allowJs: true,
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
    join(targetDirectory, "page.tsx"),
    `export default function PreviousPage() {
  return <main>Previous page</main>;
}
`,
  );
  writeFileSync(
    join(appDirectory, "page.tsx"),
    `import { Button } from "@/src/components/ui/Button";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";

const longTitle = "A deliberately long workspace record title that must wrap naturally without clipping, scaling, or forcing the page beyond the viewport";
const longDescription = "This source-faithful description is intentionally long so the browser proves the readable line length, wrapping behavior, and responsive relationship between the title region and command area across compact and wide viewports.";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-12 p-4 sm:p-8">
      <div id="case-back-link">
        <PageHeader
          actions={
            <>
              <Button variant="secondary">Review workspace history</Button>
              <Button>Save record changes</Button>
            </>
          }
          backLink={{ href: "/previous", label: "Back to student records" }}
          description={longDescription}
          eyebrow="Student record"
          metadata={
            <>
              <span className="rounded-ui bg-status-success-subtle px-2 py-1 text-xs font-semibold text-status-success">Active</span>
              <span className="rounded-ui bg-surface-subtle px-2 py-1 text-xs text-content-muted">Updated today</span>
            </>
          }
          title={longTitle}
        />
      </div>

      <div id="case-short">
        <PageHeader
          actions={<Button>Create program</Button>}
          description="A concise operational description."
          eyebrow="Programs"
          title="Programs"
        />
      </div>

      <div id="case-long-content">
        <PageHeader description={longDescription} title={longTitle} />
      </div>

      <div id="case-metadata">
        <PageHeader
          description="Metadata wraps without changing its semantics."
          eyebrow="Subscription"
          metadata={
            <>
              <span className="rounded-ui bg-surface-subtle px-2 py-1 text-xs">Starter</span>
              <span className="rounded-ui bg-surface-subtle px-2 py-1 text-xs">Trial active</span>
              <span className="rounded-ui bg-surface-subtle px-2 py-1 text-xs">Ends in fourteen days</span>
              <span className="rounded-ui bg-surface-subtle px-2 py-1 text-xs">Payment not required</span>
            </>
          }
          title="Subscription overview"
        />
      </div>

      <div id="case-long-actions">
        <PageHeader
          actions={
            <>
              <Button variant="secondary">Download detailed workspace report</Button>
              <Button variant="secondary">Invite another coaching team member</Button>
              <Button>Create a new coaching program</Button>
            </>
          }
          description="Long command labels must remain reachable without horizontal overflow."
          eyebrow="Workspace"
          title="Workspace commands"
        />
      </div>

      <section id="case-section-header" className="space-y-6">
        <SectionHeader
          actions={
            <>
              <Button size="sm" variant="secondary">Review all activity records</Button>
              <Button size="sm">Add another section item</Button>
            </>
          }
          description={longDescription}
          eyebrow="Recent activity"
          title="A long section title that must remain readable beside multiple section commands"
        />
        <div className="min-h-24 rounded-ui bg-surface-subtle" />
      </section>
    </main>
  );
}
`,
  );

  const nextPackageDirectory = join(root, "node_modules", "next");
  const nextPackage = JSON.parse(
    readFileSync(join(nextPackageDirectory, "package.json"), "utf8"),
  ) as { bin?: { next?: string } };
  if (!nextPackage.bin?.next) throw new Error("Next CLI is unavailable.");

  const port = await availableLoopbackPort();
  harnessUrl = `http://127.0.0.1:${port}`;
  harnessProcess = spawn(
    process.execPath,
    [
      join(nextPackageDirectory, nextPackage.bin.next),
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

  let harnessOutput = "";
  const captureOutput = (chunk: Buffer) => {
    harnessOutput = `${harnessOutput}${chunk.toString()}`.slice(-12_000);
  };
  harnessProcess.stdout?.on("data", captureOutput);
  harnessProcess.stderr?.on("data", captureOutput);
  await waitForHarness(harnessProcess, harnessUrl, () => harnessOutput);
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
  if (harnessDirectory) {
    rmSync(harnessDirectory, { force: true, recursive: true });
  }
  harnessDirectory = undefined;
  harnessUrl = undefined;
}

async function openHarness(page: Page) {
  if (!harnessUrl) throw new Error("Page-heading harness was not started.");
  await page.goto(harnessUrl);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

test.describe("UIX-1E2 PageHeader and SectionHeader", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await buildHarness();
  });

  test.afterAll(async () => {
    await stopHarness();
  });

  test("preserves the exact current consumer inventories", () => {
    expect(consumerInventory("PageHeader")).toEqual({
      fileCount: 24,
      files: [...expectedPageHeaderFiles],
      uses: 25,
    });
    expect(consumerInventory("SectionHeader")).toEqual({
      fileCount: 26,
      files: [...expectedSectionHeaderFiles],
      uses: 57,
    });
  });

  test("keeps both primitives server-compatible and environment-neutral", () => {
    const combined = `${pageHeaderSource}\n${sectionHeaderSource}`;
    for (const forbidden of [
      '"use client"',
      "'use client'",
      "useEffect",
      "useLayoutEffect",
      "useState",
      "window.",
      "document.",
      "localStorage",
      "sessionStorage",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
    expect(pageHeaderSource).toContain('import Link from "next/link";');
  });

  test("exports only the frozen additive PageHeader API", () => {
    for (const property of [
      "actions?: ReactNode;",
      "backLink?: {",
      "href: string;",
      "label: string;",
      "className?: string;",
      "description?: ReactNode;",
      "eyebrow?: ReactNode;",
      "metadata?: ReactNode;",
      "title: ReactNode;",
    ]) {
      expect(pageHeaderSource).toContain(property);
    }
    for (const forbidden of [
      "breadcrumbs",
      "status?:",
      "filters",
      "toolbar",
      "search",
      "bulkActions",
    ]) {
      expect(pageHeaderSource).not.toContain(forbidden);
    }
  });

  test("keeps one fixed semantic h1 and no external page margin", () => {
    expect(pageHeaderSource.match(/<h1\b/g)).toHaveLength(1);
    expect(pageHeaderSource).not.toContain("sm:text-4xl");
    expect(pageHeaderSource).toContain(
      '"break-words text-3xl font-semibold tracking-normal text-content-primary"',
    );
    const rootClasses =
      "flex min-w-0 flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between";
    expect(pageHeaderSource).toContain(rootClasses);
    expect(rootClasses).not.toMatch(/(?:^|\s)m[bt]-/);
  });

  test("keeps description, metadata and command arrangement exact", () => {
    expect(pageHeaderSource).toContain(
      '"mt-3 max-w-3xl text-sm leading-6 text-content-secondary"',
    );
    expect(pageHeaderSource).toContain('"mt-4 flex flex-wrap gap-2"');
    expect(pageHeaderSource).toContain(
      '"flex w-full min-w-0 max-w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end"',
    );
  });

  test("retains the exact SectionHeader API and structural ownership", () => {
    for (const property of [
      "actions?: ReactNode;",
      "className?: string;",
      "description?: ReactNode;",
      "eyebrow?: ReactNode;",
      "title: ReactNode;",
    ]) {
      expect(sectionHeaderSource).toContain(property);
    }
    expect(sectionHeaderSource).not.toContain("backLink");
    expect(sectionHeaderSource.match(/<h2\b/g)).toHaveLength(1);
    expect(sectionHeaderSource).toContain(
      '"break-words text-xl font-semibold tracking-normal text-content-primary"',
    );
    expect(sectionHeaderSource).toContain(
      '"mt-2 max-w-2xl text-sm leading-6 text-content-secondary"',
    );
    const rootClasses =
      "flex min-w-0 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between";
    expect(sectionHeaderSource).toContain(rootClasses);
    expect(rootClasses).not.toMatch(/(?:^|\s)(?:m[bt]-|border)/);
  });

  test("uses semantic tokens without raw colors or motion", () => {
    const combined = `${pageHeaderSource}\n${sectionHeaderSource}`;
    expect(combined).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(combined).not.toMatch(/\b(?:animate|transition|duration)-/);
    for (const utility of [
      "border-line",
      "text-action-primary",
      "text-content-primary",
      "text-content-secondary",
      "text-status-info",
    ]) {
      expect(combined).toContain(utility);
    }
  });

  test("compiles semantic utilities from product discovery roots only", async ({
    page,
  }) => {
    const result = await postcss([tailwindcss()]).process(globalsSource, {
      from: globalsPath,
    });
    const candidates = [
      "border-line",
      "min-h-11",
      "rounded-ui",
      "text-action-primary",
      "text-content-primary",
      "text-content-secondary",
      "text-status-info",
      "focus-visible:outline-focus",
    ];
    const selectors = await page.evaluate(
      (values) => values.map((value) => `.${CSS.escape(value)}`),
      candidates,
    );
    for (const [index, candidate] of candidates.entries()) {
      expect(result.css, candidate).toContain(selectors[index]);
    }
    expect(globalsSource).toContain('@source "../app";');
    expect(globalsSource).toContain('@source "../src";');
    expect(globalsSource).not.toContain("safelist");
    const dependencies = result.messages.flatMap((message) =>
      "file" in message && typeof message.file === "string" ? [message.file] : [],
    );
    expect(dependencies.some((file) => file.endsWith("PageHeader.tsx"))).toBe(true);
    expect(dependencies.some((file) => file.endsWith("SectionHeader.tsx"))).toBe(
      true,
    );
    expect(
      dependencies.some((file) => /tests|support-ops/.test(relative(root, file))),
    ).toBe(false);
  });

  test("renders the actual primitives in a Next server graph", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(5);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "Back to student records" }),
    ).toHaveAttribute("href", "/previous");
  });

  test("keeps fixed heading sizes at 390, 768 and 1440", async ({ page }) => {
    await openHarness(page);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("#case-back-link h1")).toHaveCSS(
        "font-size",
        "30px",
      );
      await expect(page.locator("#case-section-header h2")).toHaveCSS(
        "font-size",
        "20px",
      );
    }
  });

  test("bounds description widths and preserves wrapping", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const pageDescription = page.locator("#case-long-content p");
    const sectionDescription = page.locator("#case-section-header p").last();
    await expect(pageDescription).toHaveCSS("max-width", "768px");
    await expect(sectionDescription).toHaveCSS("max-width", "672px");
    expect(
      await pageDescription.evaluate(
        (element) => element.getBoundingClientRect().width <= 768,
      ),
    ).toBe(true);
    expect(
      await sectionDescription.evaluate(
        (element) => element.getBoundingClientRect().width <= 672,
      ),
    ).toBe(true);
  });

  test("meets the back-link semantic, target and focus contract", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const backLink = page.getByRole("link", { name: "Back to student records" });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAccessibleName("Back to student records");
    await expect(backLink.locator('[aria-hidden="true"]')).toHaveCount(1);
    await page.locator("body").press("Tab");
    await expect(backLink).toBeFocused();
    const focus = await backLink.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        height: rect.height,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focus.height).toBeGreaterThanOrEqual(44);
    expect(focus.outlineStyle).toBe("solid");
    expect(focus.outlineWidth).toBe("2px");
    expect(focus.outlineOffset).toBe("2px");
    expect(focus.outlineColor).toBe("rgb(14, 116, 144)");
  });

  test("stacks mobile commands and wraps them into desktop rows", async ({ page }) => {
    await openHarness(page);
    const pageActions = page.locator("#case-long-actions > section > div").last();
    const sectionActions = page.locator("#case-section-header > div > div").last();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(pageActions).toHaveCSS("flex-direction", "column");
    await expect(sectionActions).toHaveCSS("flex-direction", "column");
    for (const actions of [pageActions, sectionActions]) {
      expect(
        await actions.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(pageActions).toHaveCSS("flex-direction", "row");
    await expect(sectionActions).toHaveCSS("flex-direction", "row");
    expect(
      await page.locator("#case-long-actions h1").evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    ).toBeGreaterThanOrEqual(320);
    expect(
      await page.locator("#case-section-header h2").evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    ).toBeGreaterThanOrEqual(256);
  });

  test("passes the five-viewport long-content matrix without overflow", async ({
    page,
  }) => {
    await openHarness(page);
    const viewports = [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        document: document.documentElement.scrollWidth - window.innerWidth,
        overflowingCases: [...document.querySelectorAll("main > div, main > section")]
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.id),
      }));
      expect(layout.body).toBeLessThanOrEqual(0);
      expect(layout.document).toBeLessThanOrEqual(0);
      expect(layout.overflowingCases).toEqual([]);

      if ([390, 768, 1440].includes(viewport.width)) {
        await page.screenshot({
          fullPage: true,
          path: join(
            screenshotDirectory,
            `${viewport.width}x${viewport.height}.png`,
          ),
        });
      }
    }
  });
});
