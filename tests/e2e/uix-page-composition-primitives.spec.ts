import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const uiRoot = join(root, "src", "components", "ui");
const pageContainerPath = join(uiRoot, "PageContainer.tsx");
const pageToolbarPath = join(uiRoot, "PageToolbar.tsx");
const pageHeaderPath = join(uiRoot, "PageHeader.tsx");
const feedbackAlertPath = join(uiRoot, "FeedbackAlert.tsx");
const emptyStatePath = join(uiRoot, "EmptyState.tsx");
const cardPath = join(uiRoot, "Card.tsx");
const buttonPath = join(uiRoot, "Button.tsx");
const buttonStylesPath = join(uiRoot, "buttonStyles.ts");

const globalsSource = readFileSync(globalsPath, "utf8");
const pageContainerSource = readFileSync(pageContainerPath, "utf8");
const pageToolbarSource = readFileSync(pageToolbarPath, "utf8");
const containerWidthClasses = {
  editor: "mx-auto w-full max-w-7xl",
  full: "w-full",
  narrow: "mx-auto w-full max-w-3xl",
  standard: "mx-auto w-full max-w-6xl",
} as const;
const toolbarOuterClasses =
  "flex w-full flex-col gap-4 md:flex-row md:items-end md:justify-between";
const toolbarControlClasses =
  "flex min-w-0 w-full flex-1 flex-wrap items-end gap-3";
const toolbarActionClasses =
  "flex w-full flex-wrap items-center justify-start gap-3 md:w-auto md:shrink-0 md:justify-end";
const harnessRuntimeRoot = join(root, "support-ops", "runtime-tests");
const screenshotDirectory = join(
  harnessRuntimeRoot,
  "uix-1e4b-page-composition",
);

let harnessDirectory: string | undefined;
let harnessProcess: ChildProcess | undefined;
let harnessUrl: string | undefined;

const widthMatrix = [
  {
    viewport: { height: 844, width: 390 },
    available: 350,
    widths: { editor: 350, full: 350, narrow: 350, standard: 350 },
  },
  {
    viewport: { height: 932, width: 430 },
    available: 390,
    widths: { editor: 390, full: 390, narrow: 390, standard: 390 },
  },
  {
    viewport: { height: 1024, width: 768 },
    available: 720,
    widths: { editor: 720, full: 720, narrow: 720, standard: 720 },
  },
  {
    viewport: { height: 1180, width: 820 },
    available: 772,
    widths: { editor: 772, full: 772, narrow: 768, standard: 772 },
  },
  {
    viewport: { height: 768, width: 1023 },
    available: 975,
    widths: { editor: 975, full: 975, narrow: 768, standard: 975 },
  },
  {
    viewport: { height: 768, width: 1024 },
    available: 672,
    widths: { editor: 672, full: 672, narrow: 672, standard: 672 },
  },
  {
    viewport: { height: 800, width: 1280 },
    available: 928,
    widths: { editor: 928, full: 928, narrow: 768, standard: 928 },
  },
  {
    viewport: { height: 900, width: 1440 },
    available: 1088,
    widths: { editor: 1088, full: 1088, narrow: 768, standard: 1088 },
  },
] as const;

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
      throw new Error(`Page-composition harness exited early.\n${output()}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The isolated loopback server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Page-composition harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(harnessRuntimeRoot, { recursive: true });
  rmSync(screenshotDirectory, { force: true, recursive: true });
  mkdirSync(screenshotDirectory, { recursive: true });
  harnessDirectory = mkdtempSync(join(harnessRuntimeRoot, "page-composition-"));

  const appDirectory = join(harnessDirectory, "app");
  const uiDirectory = join(harnessDirectory, "src", "components", "ui");
  mkdirSync(appDirectory, { recursive: true });
  mkdirSync(uiDirectory, { recursive: true });

  for (const file of [
    pageContainerPath,
    pageToolbarPath,
    pageHeaderPath,
    feedbackAlertPath,
    emptyStatePath,
    cardPath,
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
    `import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageContainer } from "@/src/components/ui/PageContainer";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { PageToolbar } from "@/src/components/ui/PageToolbar";

const fieldClass = "flex min-w-0 max-w-full flex-1 basis-52 flex-col gap-2 text-sm font-medium text-content-primary";
const controlClass = "h-11 min-w-0 w-full rounded-ui border border-line bg-surface px-3 text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className={fieldClass}><span className="break-words">{label}</span>{children}</label>;
}

function Search({ label = "Search", placeholder = "Search records" }: { label?: string; placeholder?: string }) {
  return <Field label={label}><input className={controlClass} placeholder={placeholder} type="search" /></Field>;
}

function Filter({ label, options = ["All", "Active", "Archived"] }: { label: string; options?: string[] }) {
  return <Field label={label}><select className={controlClass}>{options.map((option) => <option key={option}>{option}</option>)}</select></Field>;
}

const containers = ["full", "standard", "narrow", "editor"] as const;

export default function Page() {
  const safeArea = {
    "--ui-safe-area-left": "11px",
    "--ui-safe-area-right": "13px",
  } as CSSProperties;

  return (
    <>
      <div id="shell" className="min-w-0 lg:pl-72">
        <main id="shell-main" className="min-w-0 px-5 sm:px-6 lg:px-8">
          <div id="width-cases" className="flex flex-col gap-3">
            {containers.map((width) => (
              <PageContainer className="min-h-4" key={width} width={width}>
                <div data-container={width} />
              </PageContainer>
            ))}
            <PageContainer className="min-h-4"><div data-container="default" /></PageContainer>
          </div>

          <PageContainer className="flex flex-col gap-10 py-10" width="full">
            <PageToolbar label="Search controls">
              <Search />
            </PageToolbar>

            <PageToolbar label="Program filters">
              <Search placeholder="Search programs" />
              <Filter label="Program status" />
              <Filter label="Delivery format" options={["All formats", "Online", "In person"]} />
            </PageToolbar>

            <PageToolbar label="Long record filters">
              <Search
                label="Search across every coaching workspace record"
                placeholder="Search by student, program, coach, enrollment, or workspace reference"
              />
              <Filter
                label="Enrollment request lifecycle and review status"
                options={["All enrollment request states", "Awaiting workspace review", "Approved for enrollment"]}
              />
              <Filter
                label="Assigned coaching team responsibility"
                options={["Every assigned coaching team member", "Workspace owner", "Program trainer"]}
              />
            </PageToolbar>

            <PageToolbar
              actions={
                <>
                  <Button variant="secondary">Export detailed workspace report</Button>
                  <Button variant="secondary">Refresh enrollment request results</Button>
                </>
              }
              label="Detailed workspace controls"
            >
              <Search placeholder="Search detailed workspace records" />
              <Filter label="Current record status" />
              <Filter label="Assigned team member" />
            </PageToolbar>

            <PageToolbar label="Children only controls">
              <Filter label="Sort records" options={["Newest first", "Oldest first"]} />
            </PageToolbar>

            <PageToolbar
              actions={
                <>
                  <Button id="refresh-action" variant="secondary">Refresh</Button>
                  <Button id="export-action" variant="secondary">Export</Button>
                </>
              }
              label="Refresh and export controls"
            >
              <Search label="Find a workspace record" />
            </PageToolbar>

            <PageToolbar
              actions={
                <>
                  <Button variant="secondary">Refresh results</Button>
                  <Button variant="secondary">Export records</Button>
                </>
              }
              label="Five control test"
            >
              <Search />
              <Filter label="Status" />
              <Filter label="Audience" />
              <Filter label="Owner" />
              <Filter label="Date range" />
            </PageToolbar>

            <div id="composed-page">
              <PageContainer className="flex flex-col gap-8" width="full">
                <PageHeader
                  actions={<Button>Create program</Button>}
                  description="Review programs, enrollment availability, and delivery status."
                  eyebrow="Workspace"
                  title="Programs"
                />
                <PageToolbar
                  actions={<Button variant="secondary">Refresh</Button>}
                  label="Program list controls"
                >
                  <Search placeholder="Search programs by title" />
                  <Filter label="Program status" />
                </PageToolbar>
                <FeedbackAlert announcement="polite" tone="info">
                  Program availability is synchronized with the workspace.
                </FeedbackAlert>
                <Card padding="md">
                  <p className="text-sm text-content-secondary">Three active programs</p>
                </Card>
                <EmptyState
                  description="Create a program when the workspace is ready for another offering."
                  eyebrow="Programs"
                  title="No matching programs"
                />
              </PageContainer>
            </div>
          </PageContainer>
        </main>
      </div>

      <div id="safe-shell" className="min-w-0" style={safeArea}>
        <main className="min-w-0 pl-[calc(1.25rem+var(--ui-safe-area-left))] pr-[calc(1.25rem+var(--ui-safe-area-right))]">
          <PageContainer width="full"><div data-safe-child className="min-h-4" /></PageContainer>
        </main>
      </div>

      <div id="centering-model" className="w-full px-5">
        <PageContainer width="standard"><div data-centered="standard" className="min-h-4" /></PageContainer>
        <PageContainer width="narrow"><div data-centered="narrow" className="min-h-4" /></PageContainer>
        <PageContainer width="editor"><div data-centered="editor" className="min-h-4" /></PageContainer>
      </div>
    </>
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
  if (harnessDirectory) rmSync(harnessDirectory, { force: true, recursive: true });
  harnessDirectory = undefined;
  harnessUrl = undefined;
}

async function openHarness(page: Page) {
  if (!harnessUrl) throw new Error("Page-composition harness was not started.");
  await page.goto(harnessUrl);
  await expect(page.getByRole("group", { name: "Search controls" })).toBeVisible();
}

test.describe("UIX-1E4B PageContainer and PageToolbar", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await buildHarness();
  });

  test.afterAll(async () => {
    await stopHarness();
  });

  test("keeps the exact PageContainer API and defaults", () => {
    for (const property of [
      "children: ReactNode;",
      "className?: string;",
      'width?: "editor" | "full" | "narrow" | "standard";',
    ]) {
      expect(pageContainerSource).toContain(property);
    }
    expect(pageContainerSource).toContain('className = ""');
    expect(pageContainerSource).toContain('width = "standard"');
    expect(pageContainerSource).not.toContain("HTMLAttributes");
  });

  test("owns only the exact PageContainer width mapping", () => {
    for (const [width, classes] of Object.entries(containerWidthClasses)) {
      expect(pageContainerSource).toContain(`${width}: "${classes}"`);
    }
    expect(pageContainerSource.match(/<div\b/g)).toHaveLength(1);
    expect(pageContainerSource).not.toMatch(
      /(?:safe-area|scroll-|sidebar|\b(?:px|pl|pr|py|pt|pb|mt|mb)-|\b(?:bg|border|shadow|overflow|min-h)-)/,
    );
  });

  test("keeps the exact PageToolbar API", () => {
    for (const property of [
      "actions?: ReactNode;",
      "children: ReactNode;",
      "className?: string;",
      "label: string;",
    ]) {
      expect(pageToolbarSource).toContain(property);
    }
    for (const forbidden of [
      "children?:",
      "HTMLAttributes",
      "description",
      "orientation",
      "variant",
    ]) {
      expect(pageToolbarSource).not.toContain(forbidden);
    }
  });

  test("locks PageToolbar semantics, classes and source order", () => {
    expect(pageToolbarSource.match(/<div\b/g)).toHaveLength(3);
    expect(pageToolbarSource).toContain('aria-label={label}');
    expect(pageToolbarSource).toContain('role="group"');
    expect(pageToolbarSource).toContain(`"${toolbarOuterClasses}"`);
    expect(pageToolbarSource).toContain(`className="${toolbarControlClasses}"`);
    expect(pageToolbarSource).toContain(`className="${toolbarActionClasses}"`);
    expect(pageToolbarSource.indexOf("{children}")).toBeLessThan(
      pageToolbarSource.indexOf("{actions}"),
    );
    expect(pageToolbarSource).toContain("{actions ? (");
    expect(pageToolbarSource).toContain(") : null}");
  });

  test("keeps both primitives server-compatible, unframed and behavior-free", () => {
    const combined = `${pageContainerSource}\n${pageToolbarSource}`;
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
      "tabIndex",
      "onKeyDown",
      "[&_",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
    expect(pageToolbarSource).not.toMatch(
      /(?:\b(?:bg|border|rounded|shadow|ring|p|mt|mb)-|input\b|button\b)/,
    );
  });

  test("compiles through product Tailwind discovery only", async ({ page }) => {
    const result = await postcss([tailwindcss()]).process(globalsSource, {
      from: globalsPath,
    });
    const candidates = [
      "max-w-3xl",
      "max-w-6xl",
      "max-w-7xl",
      "md:flex-row",
      "md:shrink-0",
      "md:justify-end",
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
    expect(dependencies.some((file) => file.endsWith("PageContainer.tsx"))).toBe(true);
    expect(dependencies.some((file) => file.endsWith("PageToolbar.tsx"))).toBe(true);
    expect(
      dependencies.some((file) => /tests|support-ops/.test(relative(root, file))),
    ).toBe(false);
  });

  test("renders actual primitives in a Next server graph", async ({ page }) => {
    await openHarness(page);
    await expect(page.getByRole("group")).toHaveCount(8);
    await expect(page.getByRole("heading", { level: 1, name: "Programs" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("synchronized");
    await expect(page.getByRole("heading", { level: 3, name: "No matching programs" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Search controls" }).locator(":scope > div")).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Refresh and export controls" }).locator(":scope > div")).toHaveCount(2);
  });

  test("applies exact maxima and makes omitted width equal standard", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    const maxima = await page.locator("#width-cases > div").evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).maxWidth),
    );
    expect(maxima).toEqual(["none", "1152px", "768px", "1280px", "1152px"]);
    const standard = page.locator('[data-container="standard"]').locator("..");
    const omitted = page.locator('[data-container="default"]').locator("..");
    expectClose(await standard.evaluate((element) => element.getBoundingClientRect().width), await omitted.evaluate((element) => element.getBoundingClientRect().width));
  });

  test("matches the frozen eight-viewport width matrix", async ({ page }) => {
    await openHarness(page);
    for (const entry of widthMatrix) {
      await page.setViewportSize(entry.viewport);
      const shellWidth = await page.locator("#shell-main").evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.getBoundingClientRect().width -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)
        );
      });
      expectClose(shellWidth, entry.available);
      for (const width of ["full", "standard", "narrow", "editor"] as const) {
        const actual = await page
          .locator(`[data-container="${width}"]`)
          .locator("..")
          .evaluate((element) => element.getBoundingClientRect().width);
        expectClose(actual, entry.widths[width]);
      }
      const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        document: document.documentElement.scrollWidth - window.innerWidth,
      }));
      expect(overflow.body).toBeLessThanOrEqual(0);
      expect(overflow.document).toBeLessThanOrEqual(0);

      if ([390, 768, 1024, 1440].includes(entry.viewport.width)) {
        await page.screenshot({
          fullPage: true,
          path: join(
            screenshotDirectory,
            `${entry.viewport.width}x${entry.viewport.height}.png`,
          ),
        });
      }
    }
  });

  test("centers every constrained width when its maximum is reached", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    const model = page.locator("#centering-model");
    const modelRect = await model.evaluate((element) => element.getBoundingClientRect());
    for (const width of ["standard", "narrow", "editor"] as const) {
      const rect = await page
        .locator(`[data-centered="${width}"]`)
        .locator("..")
        .evaluate((element) => element.getBoundingClientRect());
      expectClose(rect.left - modelRect.left, modelRect.right - rect.right);
    }
  });

  test("leaves safe-area ownership entirely with the shell", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ height: 844, width: 390 });
    const result = await page.locator("#safe-shell").evaluate((shell) => {
      const main = shell.querySelector("main")!;
      const container = main.firstElementChild!;
      const mainStyle = getComputedStyle(main);
      const containerStyle = getComputedStyle(container);
      return {
        containerLeft: containerStyle.paddingLeft,
        containerRight: containerStyle.paddingRight,
        mainLeft: mainStyle.paddingLeft,
        mainRight: mainStyle.paddingRight,
      };
    });
    expect(result).toEqual({
      containerLeft: "0px",
      containerRight: "0px",
      mainLeft: "31px",
      mainRight: "33px",
    });
  });

  test("stacks controls before full-width actions below md", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ height: 844, width: 390 });
    const toolbar = page.getByRole("group", { name: "Detailed workspace controls" });
    const regions = toolbar.locator(":scope > div");
    await expect(toolbar).toHaveCSS("flex-direction", "column");
    await expect(regions.nth(0)).toHaveCSS("width", "350px");
    await expect(regions.nth(1)).toHaveCSS("width", "350px");
    const boxes = await regions.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect()),
    );
    expect(boxes[0].top).toBeLessThan(boxes[1].top);
  });

  test("uses row layout with flexible controls and nonshrinking actions at md+", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ height: 1024, width: 768 });
    const toolbar = page.getByRole("group", { name: "Refresh and export controls" });
    const regions = toolbar.locator(":scope > div");
    await expect(toolbar).toHaveCSS("flex-direction", "row");
    await expect(regions.nth(0)).toHaveCSS("flex-grow", "1");
    await expect(regions.nth(1)).toHaveCSS("flex-shrink", "0");
    await expect(regions.nth(1)).toHaveCSS("justify-content", "flex-end");
    const widths = await toolbar.evaluate((element) => ({
      actions: element.children[1].getBoundingClientRect().width,
      toolbar: element.getBoundingClientRect().width,
    }));
    expect(widths.actions).toBeLessThan(widths.toolbar);
  });

  test("preserves native focus order from controls into actions", async ({ page }) => {
    await openHarness(page);
    const toolbar = page.getByRole("group", { name: "Refresh and export controls" });
    const search = toolbar.getByRole("searchbox");
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#refresh-action")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#export-action")).toBeFocused();
  });

  test("keeps individual action buttons at their natural width on mobile", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ height: 844, width: 390 });
    const toolbar = page.getByRole("group", { name: "Refresh and export controls" });
    const actionRegion = toolbar.locator(":scope > div").nth(1);
    const regionWidth = await actionRegion.evaluate((element) => element.getBoundingClientRect().width);
    for (const button of await actionRegion.getByRole("button").all()) {
      expect(await button.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(regionWidth);
    }
  });

  test("wraps long labels, five controls and actions without overflow", async ({ page }) => {
    await openHarness(page);
    for (const viewport of [
      { height: 844, width: 390 },
      { height: 932, width: 430 },
      { height: 1024, width: 768 },
      { height: 768, width: 1024 },
      { height: 900, width: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      for (const label of [
        "Long record filters",
        "Detailed workspace controls",
        "Five control test",
      ]) {
        const toolbar = page.getByRole("group", { name: label });
        expect(
          await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
      }
      const fiveControlToolbar = page.getByRole("group", { name: "Five control test" });
      await expect(fiveControlToolbar.locator("input, select")).toHaveCount(5);
      await expect(fiveControlToolbar.getByRole("button")).toHaveCount(2);
    }
  });

  test("composes the frozen page grammar without hidden spacing conflicts", async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ height: 900, width: 1440 });
    const composed = page.locator("#composed-page > div");
    await expect(composed).toHaveCSS("display", "flex");
    await expect(composed).toHaveCSS("row-gap", "32px");
    await expect(composed).toHaveCSS("padding-left", "0px");
    await expect(composed).toHaveCSS("padding-right", "0px");
    await expect(composed).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const toolbar = page.getByRole("group", { name: "Program list controls" });
    await expect(toolbar).toHaveCSS("margin-top", "0px");
    await expect(toolbar).toHaveCSS("padding-left", "0px");
    await expect(toolbar).toHaveCSS("border-top-width", "0px");
  });
});
