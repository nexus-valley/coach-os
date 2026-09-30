import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join, relative } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { createElement, type ReactElement } from "react";
import ts from "typescript";

import { Button, type ButtonProps } from "../../src/components/ui/Button";
import { Card } from "../../src/components/ui/Card";
import {
  EmptyState,
  type EmptyStateAction,
  type EmptyStateProps,
} from "../../src/components/ui/EmptyState";
import {
  Skeleton,
  type SkeletonProps,
} from "../../src/components/ui/Skeleton";

const root = process.cwd();
const globalsPath = join(root, "app", "globals.css");
const buttonPath = join(root, "src", "components", "ui", "Button.tsx");
const buttonStylesPath = join(
  root,
  "src",
  "components",
  "ui",
  "buttonStyles.ts",
);
const cardPath = join(root, "src", "components", "ui", "Card.tsx");
const emptyStatePath = join(
  root,
  "src",
  "components",
  "ui",
  "EmptyState.tsx",
);
const skeletonPath = join(root, "src", "components", "ui", "Skeleton.tsx");

const globalsSource = readFileSync(globalsPath, "utf8");
const emptyStateSource = readFileSync(emptyStatePath, "utf8");
const skeletonSource = readFileSync(skeletonPath, "utf8");

const skeletonBase = "animate-pulse rounded-ui bg-action-primary-subtle";
const defaultContainer =
  "mt-6 rounded-ui border border-line bg-surface p-8 text-content-primary shadow-surface";
const compactContainer =
  "mt-4 rounded-ui border border-line bg-surface p-5 text-content-primary shadow-surface";
const actionLayout =
  "flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center";
const classifierCandidates = [
  "h-4",
  "bg-action-primary-subtle",
  "bg-linear-45",
  "bg-linear-65",
  "bg-linear-to-r",
  "bg-conic-180",
  "bg-radial",
  "from-blue-500",
  "to-red-500",
  "bg-red-500",
  "bg-red-500/20",
  "bg-status-info",
  "bg-status-info/30",
] as const;

let compiledCssPromise:
  | Promise<{ css: string; dependencyFiles: string[] }>
  | undefined;
let classifierCssPromise: Promise<string> | undefined;

function compiledProductCss() {
  compiledCssPromise ??= postcss([tailwindcss()])
    .process(globalsSource, { from: globalsPath })
    .then((result) => ({
      css: result.css,
      dependencyFiles: result.messages.flatMap((message) =>
        "file" in message && typeof message.file === "string"
          ? [message.file]
          : [],
      ),
    }));

  return compiledCssPromise;
}

function compiledClassifierCss() {
  classifierCssPromise ??= postcss([tailwindcss()])
    .process(
      `${globalsSource}\n${classifierCandidates
        .map((candidate) => `@source inline("${candidate}");`)
        .join("\n")}`,
      { from: join(root, "app", "uix-1c4c2-classifier.css") },
    )
    .then((result) => result.css);

  return classifierCssPromise;
}

function skeletonElement(props: SkeletonProps = {}) {
  return Skeleton(props) as ReactElement<Record<string, unknown>>;
}

function emptyStateElement(props: EmptyStateProps) {
  return EmptyState(props) as ReactElement<Record<string, unknown>>;
}

function renderedEmptyState(props: EmptyStateProps) {
  return Card(
    emptyStateElement(props).props as unknown as Parameters<typeof Card>[0],
  ) as ReactElement<Record<string, unknown>>;
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function serializeElement(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") {
    return escapeHtml(node);
  }
  if (Array.isArray(node)) return node.map(serializeElement).join("");
  if (typeof node !== "object") return "";

  const element = node as {
    props?: Record<string, unknown>;
    type?: unknown;
  };
  const props = element.props ?? {};
  if (typeof element.type === "function") {
    return serializeElement(element.type(props));
  }
  if (typeof element.type !== "string") {
    return serializeElement(props.children);
  }

  const attributes: string[] = [];
  for (const [rawName, value] of Object.entries(props)) {
    if (
      rawName === "children" ||
      rawName === "key" ||
      rawName.startsWith("on") ||
      value === undefined ||
      value === null ||
      value === false
    ) {
      continue;
    }
    const name = rawName === "className" ? "class" : rawName;
    if (value === true && !name.startsWith("aria-")) {
      attributes.push(name);
    } else {
      attributes.push(`${name}="${escapeHtml(value)}"`);
    }
  }

  return `<${element.type}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${serializeElement(props.children)}</${element.type}>`;
}

async function setProductContent(page: Page, markup: string) {
  const { css } = await compiledProductCss();
  await page.setContent(`<style>${css}</style>${markup}`);
}

async function setClassifierContent(page: Page, markup: string) {
  const css = await compiledClassifierCss();
  await page.setContent(`<style>${css}</style>${markup}`);
}

function sourceFiles(directory: string, files: string[] = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".next", "node_modules", "support-ops"].includes(entry.name)) {
      continue;
    }
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(fullPath, files);
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function consumerInventory(componentName: "EmptyState" | "Skeleton") {
  const uses: { file: string; line: number }[] = [];
  for (const file of [
    ...sourceFiles(join(root, "app")),
    ...sourceFiles(join(root, "src")),
  ]) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      const isTarget =
        (ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(sourceFile) === componentName) ||
        (ts.isJsxSelfClosingElement(node) &&
          node.tagName.getText(sourceFile) === componentName);
      if (isTarget) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        uses.push({ file: relative(root, file), line: position.line + 1 });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return {
    fileCount: new Set(uses.map((use) => use.file)).size,
    uses: uses.length,
  };
}

function emptyStateChildren(props: EmptyStateProps) {
  const inner = renderedEmptyState(props).props.children as ReactElement<
    Record<string, unknown>
  >;
  return inner.props.children as unknown[];
}

function actionRow(props: EmptyStateProps) {
  return emptyStateChildren(props)[4] as
    | ReactElement<Record<string, unknown>>
    | null;
}

const harnessRuntimeRoot = join(root, "support-ops", "runtime-tests");
let harnessDirectory: string | undefined;
let harnessProcess: ChildProcess | undefined;
let harnessUrl: string | undefined;

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
      throw new Error(`Loading/empty harness exited early.\n${output()}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The isolated loopback server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Loading/empty harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(harnessRuntimeRoot, { recursive: true });
  harnessDirectory = mkdtempSync(join(harnessRuntimeRoot, "loading-empty-"));
  const appDirectory = join(harnessDirectory, "app");
  const serverDirectory = join(appDirectory, "server");
  const uiDirectory = join(harnessDirectory, "src", "components", "ui");
  mkdirSync(serverDirectory, { recursive: true });
  mkdirSync(uiDirectory, { recursive: true });

  for (const file of [
    buttonPath,
    buttonStylesPath,
    cardPath,
    emptyStatePath,
    skeletonPath,
  ]) {
    copyFileSync(file, join(uiDirectory, file.split(/[\\/]/).at(-1)!));
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

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
  );
  writeFileSync(
    join(appDirectory, "page.tsx"),
    `"use client";

import { useState } from "react";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Skeleton } from "@/src/components/ui/Skeleton";

export default function ClientPage() {
  const [activations, setActivations] = useState(0);
  return (
    <main>
      <Skeleton className="h-4 w-20" />
      <EmptyState
        action={{ label: "Create", onClick: () => setActivations((value) => value + 1) }}
        description="Client empty description"
        title="Client empty"
      />
      <output data-activations>{activations}</output>
    </main>
  );
}
`,
  );
  writeFileSync(
    join(serverDirectory, "page.tsx"),
    `import { EmptyState } from "@/src/components/ui/EmptyState";
import { Skeleton } from "@/src/components/ui/Skeleton";

export default function ServerPage() {
  return (
    <main>
      <Skeleton className="h-4 w-20" />
      <EmptyState
        action={<a href="/server">Browse</a>}
        description="Server empty description"
        title="Server empty"
      />
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
  if (
    existsSync(harnessRuntimeRoot) &&
    readdirSync(harnessRuntimeRoot).length === 0
  ) {
    rmdirSync(harnessRuntimeRoot);
  }
}

test.describe("UIX-1C4C Skeleton and EmptyState", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await buildHarness();
  });

  test.afterAll(async () => {
    await stopHarness();
  });

  test("preserves exact consumer boundaries", () => {
    expect(consumerInventory("Skeleton")).toEqual({ fileCount: 11, uses: 55 });
    expect(consumerInventory("EmptyState")).toEqual({ fileCount: 25, uses: 33 });
  });

  test("exports the frozen Skeleton API and visual-only semantics", () => {
    const props: SkeletonProps = {};
    const element = skeletonElement(props);
    expect(element.type).toBe("div");
    expect(element.props).toMatchObject({
      "aria-hidden": "true",
      className: skeletonBase,
    });
    for (const attribute of ["role", "aria-live", "aria-label", "aria-busy"]) {
      expect(element.props[attribute]).toBeUndefined();
    }
    expect(element.props.children).toBeUndefined();
  });

  test("keeps Skeleton dimensions caller-owned and caller classes last", () => {
    const element = skeletonElement({ className: "h-8 w-24 caller" });
    expect(element.props.className).toBe(
      `${skeletonBase} h-8 w-24 caller`,
    );
    expect(skeletonSource).not.toMatch(/\bh-\d|\bw-\d/);
  });

  test("recognizes only narrow base background-color overrides", () => {
    for (const className of [
      "bg-[#D8E8F0]",
      "bg-white/10",
      "bg-red-500",
      "bg-red-500/20",
      "bg-red-500!",
      "bg-status-info",
      "bg-status-info/30",
    ]) {
      expect(
        skeletonElement({ className: `h-4 ${className}` }).props.className,
      ).toBe(`animate-pulse rounded-ui h-4 ${className}`);
    }

    for (const className of [
      "bg-clip-text",
      "bg-cover",
      "bg-contain",
      "bg-center",
      "bg-no-repeat",
      "bg-fixed",
      "bg-linear-45",
      "bg-linear-65",
      "bg-linear-to-r",
      "bg-conic-180",
      "bg-radial",
      "bg-[url(https://example.com/image.png)]",
      "sm:bg-red-500",
      "hover:bg-red-500/10",
    ]) {
      expect(skeletonElement({ className }).props.className).toBe(
        `${skeletonBase} ${className}`,
      );
    }
  });

  test("keeps semantic background color under gradient and image utilities", async ({ page }) => {
    await setClassifierContent(
      page,
      `<main>
        ${serializeElement(Skeleton({ className: "h-4 bg-linear-45 from-blue-500 to-red-500" })).replace("<div ", '<div data-linear-45 ')}
        ${serializeElement(Skeleton({ className: "h-4 bg-linear-65 from-blue-500 to-red-500" })).replace("<div ", '<div data-linear-65 ')}
        ${serializeElement(Skeleton({ className: "h-4 bg-linear-to-r from-blue-500 to-red-500" })).replace("<div ", '<div data-linear-direction ')}
        ${serializeElement(Skeleton({ className: "h-4 bg-conic-180" })).replace("<div ", '<div data-conic ')}
        ${serializeElement(Skeleton({ className: "h-4 bg-radial" })).replace("<div ", '<div data-radial ')}
        ${serializeElement(Skeleton({ className: "h-4 bg-red-500" })).replace("<div ", '<div data-red ')}
        <div data-red-reference class="h-4 bg-red-500"></div>
        ${serializeElement(Skeleton({ className: "h-4 bg-red-500/20" })).replace("<div ", '<div data-red-opacity ')}
        <div data-red-opacity-reference class="h-4 bg-red-500/20"></div>
        ${serializeElement(Skeleton({ className: "h-4 bg-status-info" })).replace("<div ", '<div data-semantic ')}
        <div data-semantic-reference class="h-4 bg-status-info"></div>
        ${serializeElement(Skeleton({ className: "h-4 bg-status-info/30" })).replace("<div ", '<div data-semantic-opacity ')}
        <div data-semantic-opacity-reference class="h-4 bg-status-info/30"></div>
      </main>`,
    );

    for (const selector of [
      "[data-linear-45]",
      "[data-linear-65]",
      "[data-linear-direction]",
      "[data-conic]",
      "[data-radial]",
    ]) {
      await expect(page.locator(selector)).toHaveCSS(
        "background-color",
        "rgb(234, 247, 252)",
      );
    }
    expect(
      await page.locator("[data-linear-45]").evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      ),
    ).not.toBe("none");

    for (const [actual, reference] of [
      ["[data-red]", "[data-red-reference]"],
      ["[data-red-opacity]", "[data-red-opacity-reference]"],
      ["[data-semantic]", "[data-semantic-reference]"],
      ["[data-semantic-opacity]", "[data-semantic-opacity-reference]"],
    ]) {
      const actualColor = await page.locator(actual).evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const referenceColor = await page.locator(reference).evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(actualColor).toBe(referenceColor);
      expect(actualColor).not.toBe("rgb(234, 247, 252)");
    }
  });

  test("computes Courses and Cohorts caller background behavior", async ({ page }) => {
    await setProductContent(
      page,
      `<main>
        ${serializeElement(Skeleton({ className: "h-4 w-full bg-[#D8E8F0]" })).replace("<div ", '<div data-course ')}
        ${serializeElement(Skeleton({ className: "h-4 w-full bg-white/10" })).replace("<div ", '<div data-cohorts ')}
        <section class="coachos-light"><div class="coachos-content">
          ${serializeElement(Skeleton({ className: "h-4 w-full bg-white/10" })).replace("<div ", '<div data-compat ')}
        </div></section>
      </main>`,
    );
    await expect(page.locator("[data-course]")).toHaveCSS(
      "background-color",
      "rgb(216, 232, 240)",
    );
    expect(
      await page.locator("[data-cohorts]").evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toContain("/ 0.1)");
    await expect(page.locator("[data-compat]")).toHaveCSS(
      "background-color",
      "rgb(247, 252, 255)",
    );
  });

  test("retains the default under non-color and state background utilities", async ({ page }) => {
    await setProductContent(
      page,
      `<main>
        ${serializeElement(Skeleton({ className: "h-4 bg-cover" })).replace("<div ", '<div data-cover ')}
        ${serializeElement(Skeleton({ className: "h-4 hover:bg-red-500/10" })).replace("<div ", '<div data-hover ')}
      </main>`,
    );
    await expect(page.locator("[data-cover]")).toHaveCSS(
      "background-color",
      "rgb(234, 247, 252)",
    );
    await expect(page.locator("[data-hover]")).toHaveCSS(
      "background-color",
      "rgb(234, 247, 252)",
    );
    await page.locator("[data-hover]").hover();
    expect(
      await page.locator("[data-hover]").evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgb(234, 247, 252)");
  });

  test("makes Skeleton effectively static under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setProductContent(page, serializeElement(Skeleton({ className: "h-4" })));
    const styles = await page.locator("div").evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        duration: computed.animationDuration,
        iterations: computed.animationIterationCount,
      };
    });
    expect(styles).toEqual({ duration: "1e-05s", iterations: "1" });
  });

  test("compiles every frozen utility through product roots without a safelist", async ({ page }) => {
    const { css, dependencyFiles } = await compiledProductCss();
    const classes = [
      "animate-pulse",
      "rounded-ui",
      "bg-action-primary-subtle",
      "border-line",
      "border-line-strong",
      "bg-surface",
      "text-content-primary",
      "text-content-secondary",
      "text-status-info",
      "text-action-primary",
      "shadow-surface",
    ];
    const selectors = await page.evaluate(
      (values) => values.map((value) => `.${CSS.escape(value)}`),
      classes,
    );
    for (const [index, className] of classes.entries()) {
      expect(css, className).toContain(selectors[index]);
    }
    expect(globalsSource).toContain('@source "../app";');
    expect(globalsSource).toContain('@source "../src";');
    expect(globalsSource).not.toContain("safelist");
    expect(dependencyFiles.some((file) => file.endsWith("Skeleton.tsx"))).toBe(true);
    expect(dependencyFiles.some((file) => file.endsWith("EmptyState.tsx"))).toBe(true);
  });

  test("keeps representative Skeleton shapes bounded at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const markup = [
      "h-4 w-48",
      "h-28",
      "h-16 w-full",
      "h-2 w-full",
    ]
      .map((className) => serializeElement(Skeleton({ className })))
      .join("");
    await setProductContent(page, `<main>${markup}</main>`);
    for (const skeleton of await page.locator("main > div").all()) {
      expect(
        await skeleton.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.getBoundingClientRect().right <= window.innerWidth,
        ),
      ).toBe(true);
    }
  });

  test("exports both EmptyState public types with compatible defaults", () => {
    const config: EmptyStateAction = {
      label: "Create",
      onClick: () => undefined,
    };
    const props: EmptyStateProps = {
      action: config,
      description: "Description",
      title: "Title",
    };
    const element = emptyStateElement(props);
    expect(element.type).toBe(Card);
    expect(element.props.className).toBe(defaultContainer);
  });

  test("renders exact default, compact, caller, inner, and text contracts", () => {
    const normal = emptyStateElement({ description: "Description", title: "Title" });
    const compact = emptyStateElement({
      className: "caller",
      description: "Description",
      size: "compact",
      title: "Title",
    });
    expect(normal.props.className).toBe(defaultContainer);
    expect(compact.props.className).toBe(`${compactContainer} caller`);

    const normalChildren = emptyStateChildren({
      description: "Description",
      title: "Title",
    });
    const compactChildren = emptyStateChildren({
      description: "Description",
      size: "compact",
      title: "Title",
    });
    const normalInner = renderedEmptyState({
      description: "Description",
      title: "Title",
    }).props.children as ReactElement<Record<string, unknown>>;
    expect(normalInner.props.className).toBe("mx-auto max-w-2xl text-center");
    expect((normalChildren[2] as ReactElement<Record<string, unknown>>).props.className).toBe(
      "break-words text-2xl font-semibold",
    );
    expect((compactChildren[2] as ReactElement<Record<string, unknown>>).props.className).toBe(
      "break-words text-lg font-semibold",
    );
    expect((normalChildren[3] as ReactElement<Record<string, unknown>>).props.className).toBe(
      "mt-3 break-words text-sm leading-6 text-content-secondary",
    );
  });

  test("renders exact optional icon, eyebrow, and title spacing", () => {
    const children = emptyStateChildren({
      description: "Description",
      eyebrow: "Empty",
      icon: "AN",
      title: "Title",
    });
    expect((children[0] as ReactElement<Record<string, unknown>>).props.className).toBe(
      "mx-auto flex h-12 w-12 items-center justify-center rounded-ui border border-line-strong bg-action-primary-subtle text-sm font-bold text-action-primary",
    );
    expect((children[1] as ReactElement<Record<string, unknown>>).props.className).toBe(
      "mt-5 text-xs font-semibold uppercase text-status-info",
    );
    expect((children[2] as ReactElement<Record<string, unknown>>).props.className).toBe(
      "break-words text-2xl font-semibold mt-4",
    );
    expect(emptyStateSource).not.toContain("tracking-[0.18em]");
  });

  test("renders the exact config action and native disabled semantics", () => {
    const onClick = () => undefined;
    const row = actionRow({
      action: { disabled: true, label: "Create", onClick },
      description: "Description",
      title: "Title",
    });
    expect(row?.props.className).toBe(`mt-6 ${actionLayout}`);
    const action = (row?.props.children as unknown[])[0] as ReactElement<ButtonProps>;
    expect(action.type).toBe(Button);
    expect(action.props).toMatchObject({
      children: "Create",
      disabled: true,
      onClick,
      size: "md",
      type: "button",
      variant: "primary",
    });
    const nativeButton = Button(action.props) as ReactElement<Record<string, unknown>>;
    expect(nativeButton.type).toBe("button");
    expect(nativeButton.props.disabled).toBe(true);
  });

  test("preserves ReactNode actions and fixes secondary-only rendering", () => {
    const primary = createElement("a", { href: "/programs" }, "Browse");
    const secondary = createElement("button", { type: "button" }, "Dismiss");
    const primaryOnly = actionRow({
      action: primary,
      description: "Description",
      title: "Title",
    });
    const secondaryOnly = actionRow({
      description: "Description",
      secondaryAction: secondary,
      title: "Title",
    });
    const both = actionRow({
      action: primary,
      description: "Description",
      secondaryAction: secondary,
      size: "compact",
      title: "Title",
    });
    expect((primaryOnly?.props.children as unknown[])[0]).toBe(primary);
    expect((secondaryOnly?.props.children as unknown[])[1]).toBe(secondary);
    expect(secondaryOnly?.props.className).toBe(`mt-6 ${actionLayout}`);
    expect(both?.props.children).toEqual([primary, secondary]);
    expect(both?.props.className).toBe(`mt-5 ${actionLayout}`);
    expect(
      actionRow({ description: "Description", title: "Title" }),
    ).toBeNull();
  });

  test("keeps EmptyState ordinary content without live semantics", () => {
    const markup = serializeElement(
      EmptyState({ description: "Description", title: "Title" }),
    );
    for (const attribute of [
      "role=",
      "aria-live",
      "aria-atomic",
      "aria-relevant",
    ]) {
      expect(markup).not.toContain(attribute);
    }
  });

  test("applies semantic Card precedence inside and outside compatibility mode", async ({ page }) => {
    const markup = serializeElement(
      EmptyState({ description: "Description", title: "Title" }),
    ).replace("<div ", '<div data-empty ');
    await setProductContent(
      page,
      `<main>${markup}<section class="coachos-light"><div class="coachos-content">${markup.replace("data-empty", "data-compat")}</div></section></main>`,
    );
    const expected = {
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgb(216, 232, 240)",
      borderRadius: "8px",
      color: "rgb(11, 31, 51)",
    };
    for (const selector of ["[data-empty]", "[data-compat]"]) {
      const styles = await page.locator(selector).evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          backgroundColor: computed.backgroundColor,
          borderColor: computed.borderColor,
          borderRadius: computed.borderRadius,
          color: computed.color,
          shadow: computed.boxShadow,
        };
      });
      expect(styles).toMatchObject(expected);
      expect(styles.shadow).toContain("rgba(11, 42, 61, 0.06)");
    }
  });

  test("keeps default and compact EmptyStates bounded and responsive", async ({ page }) => {
    const longText = `LongUnbrokenEmptyStateText${"Segment".repeat(80)}`;
    const primary = createElement("button", { type: "button" }, "Primary action");
    const secondary = createElement("button", { type: "button" }, "Secondary action");
    const defaultMarkup = serializeElement(
      EmptyState({
        action: primary,
        description: longText,
        secondaryAction: secondary,
        title: longText,
      }),
    ).replace("<div ", '<div data-default ');
    const compactMarkup = serializeElement(
      EmptyState({
        description: longText,
        secondaryAction: secondary,
        size: "compact",
        title: longText,
      }),
    ).replace("<div ", '<div data-compact ');

    await page.setViewportSize({ width: 390, height: 844 });
    await setProductContent(page, `<main>${defaultMarkup}${compactMarkup}</main>`);
    for (const selector of ["[data-default]", "[data-compact]"]) {
      const state = page.locator(selector);
      expect(
        await state.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.getBoundingClientRect().right <= window.innerWidth,
        ),
      ).toBe(true);
      await expect(state.locator(":scope > div > div:last-child")).toHaveCSS(
        "flex-direction",
        "column",
      );
    }
    await expect(page.getByRole("button", { name: "Secondary action" })).toHaveCount(2);

    await page.setViewportSize({ width: 1440, height: 900 });
    const desktop = await page.locator("[data-default]").evaluate((element) => {
      const inner = element.firstElementChild as HTMLElement;
      const row = inner.lastElementChild as HTMLElement;
      return {
        innerWidth: inner.getBoundingClientRect().width,
        overflow: element.scrollWidth > element.clientWidth,
        rowDirection: getComputedStyle(row).flexDirection,
        rowWrap: getComputedStyle(row).flexWrap,
      };
    });
    expect(desktop).toEqual({
      innerWidth: 672,
      overflow: false,
      rowDirection: "row",
      rowWrap: "wrap",
    });
  });

  test("keeps both modules directive-free, semantic, and environment-neutral", () => {
    const combined = `${skeletonSource}\n${emptyStateSource}`;
    for (const forbidden of [
      '"use client"',
      "'use client'",
      "useEffect",
      "useState",
      "window.",
      "document.",
      "localStorage",
      "sessionStorage",
      "aria-live",
      "aria-atomic",
      "aria-relevant",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
    expect(combined).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(skeletonSource).not.toContain("role=");
    expect(skeletonSource).not.toContain("aria-label");
    expect(skeletonSource).not.toContain("aria-busy");
  });

  test("renders Skeleton and static/composed EmptyState in an actual Next server graph", async ({ page }) => {
    if (!harnessUrl) throw new Error("Loading/empty harness was not started.");
    await page.goto(`${harnessUrl}/server`);
    await expect(
      page.getByRole("heading", { name: "Server empty" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse" })).toBeVisible();
    await expect(
      page.locator('.animate-pulse.rounded-ui[aria-hidden="true"]'),
    ).toHaveCount(1);
  });

  test("renders Skeleton and activates config EmptyState in an actual Next client graph", async ({ page }) => {
    if (!harnessUrl) throw new Error("Loading/empty harness was not started.");
    await page.goto(harnessUrl);
    await expect(
      page.getByRole("heading", { name: "Client empty" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("[data-activations]")).toHaveText("1");
    await expect(
      page.locator('.animate-pulse.rounded-ui[aria-hidden="true"]'),
    ).toHaveCount(1);
  });
});
