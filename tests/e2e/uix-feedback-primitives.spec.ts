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
import {
  type ReactElement,
} from "react";
import ts from "typescript";

import { Button, type ButtonProps } from "../../src/components/ui/Button";
import {
  FeedbackAlert,
  type FeedbackAlertProps,
} from "../../src/components/ui/FeedbackAlert";
import {
  LiveStatus,
  type LiveStatusProps,
} from "../../src/components/ui/LiveStatus";

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
const feedbackPath = join(
  root,
  "src",
  "components",
  "ui",
  "FeedbackAlert.tsx",
);
const liveStatusPath = join(
  root,
  "src",
  "components",
  "ui",
  "LiveStatus.tsx",
);

const globalsSource = readFileSync(globalsPath, "utf8");
const feedbackSource = readFileSync(feedbackPath, "utf8");
const liveStatusSource = readFileSync(liveStatusPath, "utf8");

const toneClasses = {
  error:
    "border-status-danger/30 bg-status-danger-subtle text-status-danger",
  info: "border-status-info/30 bg-status-info-subtle text-status-info",
  success:
    "border-status-success/30 bg-status-success-subtle text-status-success",
  warning:
    "border-status-warning/30 bg-status-warning-subtle text-status-warning",
} as const;

const toneStyles = {
  error: {
    backgroundColor: "rgb(254, 242, 242)",
    color: "rgb(185, 28, 28)",
    minimumContrast: 5.9,
  },
  info: {
    backgroundColor: "rgb(240, 249, 255)",
    color: "rgb(3, 105, 161)",
    minimumContrast: 5.56,
  },
  success: {
    backgroundColor: "rgb(232, 248, 243)",
    color: "rgb(4, 120, 87)",
    minimumContrast: 4.99,
  },
  warning: {
    backgroundColor: "rgb(255, 247, 237)",
    color: "rgb(194, 65, 12)",
    minimumContrast: 4.87,
  },
} as const;

let compiledCssPromise:
  | Promise<{ css: string; dependencyFiles: string[] }>
  | undefined;

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

function feedbackElement(props: FeedbackAlertProps) {
  return FeedbackAlert(props) as ReactElement<Record<string, unknown>>;
}

function liveStatusElement(props: LiveStatusProps) {
  return LiveStatus(props) as ReactElement<Record<string, unknown>>;
}

function feedbackMarkup(props: FeedbackAlertProps) {
  return serializeElement(FeedbackAlert(props));
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
  if (typeof node === "string" || typeof node === "number") return escapeHtml(node);
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

function retryElement(props: FeedbackAlertProps) {
  const children = feedbackElement(props).props.children as unknown[];
  return children[1] as ReactElement<ButtonProps> | undefined;
}

function nativeRetryElement(props: FeedbackAlertProps) {
  const retry = retryElement(props);
  if (!retry) throw new Error("Expected FeedbackAlert retry control.");
  return Button(retry.props) as ReactElement<Record<string, unknown>>;
}

async function setPrimitiveContent(page: Page, markup: string) {
  const { css } = await compiledProductCss();
  await page.setContent(`<style>${css}</style>${markup}`);
}

function parseRgb(value: string) {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`Unsupported computed color: ${value}`);
  return match.slice(1, 4).map(Number);
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = parseRgb(color).map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
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

function feedbackConsumerInventory() {
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
      if (
        ts.isJsxElement(node) &&
        node.openingElement.tagName.getText(sourceFile) === "FeedbackAlert"
      ) {
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
      throw new Error(
        `Feedback primitive harness exited before startup.\n${output()}`,
      );
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The loopback server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Feedback primitive harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(harnessRuntimeRoot, { recursive: true });
  harnessDirectory = mkdtempSync(join(harnessRuntimeRoot, "feedback-"));
  const appDirectory = join(harnessDirectory, "app");
  const serverDirectory = join(appDirectory, "server");
  const uiDirectory = join(harnessDirectory, "src", "components", "ui");
  mkdirSync(serverDirectory, { recursive: true });
  mkdirSync(uiDirectory, { recursive: true });

  for (const file of [buttonPath, buttonStylesPath, feedbackPath, liveStatusPath]) {
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
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { LiveStatus } from "@/src/components/ui/LiveStatus";

export default function ClientPage() {
  const [retries, setRetries] = useState(0);
  return (
    <main>
      <FeedbackAlert onRetry={() => setRetries((value) => value + 1)}>
        Client feedback
      </FeedbackAlert>
      <output data-retries>{retries}</output>
      <LiveStatus>Client status</LiveStatus>
    </main>
  );
}
`,
  );
  writeFileSync(
    join(serverDirectory, "page.tsx"),
    `import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { LiveStatus } from "@/src/components/ui/LiveStatus";

export default function ServerPage() {
  return (
    <main>
      <FeedbackAlert>Server feedback</FeedbackAlert>
      <LiveStatus>Server status</LiveStatus>
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

test.describe("UIX-1C4B FeedbackAlert and LiveStatus", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await buildHarness();
  });

  test.afterAll(async () => {
    await stopHarness();
  });

  test("preserves the 123-use, 49-file consumer boundary", () => {
    expect(feedbackConsumerInventory()).toEqual({ fileCount: 49, uses: 123 });
  });

  test("exports the frozen FeedbackAlert API with compatible defaults", () => {
    const props: FeedbackAlertProps = { children: "Default feedback" };
    const element = feedbackElement(props);
    expect(element.props.role).toBeUndefined();
    expect(element.props.className).toBe(
      "rounded-ui border p-4 text-sm leading-6 break-words border-status-danger/30 bg-status-danger-subtle text-status-danger",
    );

    for (const forbidden of ["title?:", "icon?:", "dismiss", "action?:", "ariaLive"] ) {
      expect(feedbackSource).not.toContain(forbidden);
    }
  });

  test("renders all four exact tone classes without changing role", () => {
    for (const [tone, classes] of Object.entries(toneClasses)) {
      const element = feedbackElement({
        children: `${tone} feedback`,
        tone: tone as FeedbackAlertProps["tone"],
      });
      expect(element.props.className).toContain(classes);
      expect(element.props.role).toBeUndefined();
    }
  });

  test("separates none, polite, and assertive announcements from tone", () => {
    expect(feedbackElement({ children: "None", announcement: "none" }).props.role).toBeUndefined();
    expect(feedbackElement({ children: "Polite", announcement: "polite", tone: "error" }).props.role).toBe("status");
    expect(feedbackElement({ children: "Assertive", announcement: "assertive", tone: "info" }).props.role).toBe("alert");

    for (const attribute of ["aria-live", "aria-atomic", "aria-relevant"]) {
      expect(feedbackSource).not.toContain(attribute);
    }
  });

  test("keeps caller classes last and paragraph-safe body classes exact", () => {
    const element = feedbackElement({
      children: "Body",
      className: "caller-override",
      onRetry: () => undefined,
    });
    expect(element.props.className).toBe(
      "rounded-ui border p-4 text-sm leading-6 break-words flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-status-danger/30 bg-status-danger-subtle text-status-danger caller-override",
    );
    const body = (element.props.children as unknown[])[0] as ReactElement<
      Record<string, unknown>
    >;
    expect(body.type).toBe("p");
    expect(body.props.className).toBe("min-w-0 flex-1 font-medium");
    expect(body.props.children).toBe("Body");
  });

  test("renders no button without onRetry and the exact retry contract with it", () => {
    expect(retryElement({ children: "No retry" })).toBeNull();
    const onRetry = () => undefined;
    const retry = retryElement({ children: "Retryable", onRetry });
    expect(retry?.type).toBe(Button);
    expect(retry?.props).toMatchObject({
      children: "Retry",
      className: "shrink-0",
      disabled: false,
      isLoading: false,
      loadingText: "Retrying...",
      onClick: onRetry,
      size: "sm",
      type: "button",
      variant: "secondary",
    });
  });

  test("blocks retryDisabled and retrying through native Button semantics", () => {
    const disabled = nativeRetryElement({
      children: "Disabled",
      onRetry: () => undefined,
      retryDisabled: true,
    });
    const retrying = nativeRetryElement({
      children: "Retrying",
      onRetry: () => undefined,
      retrying: true,
    });
    expect(disabled.type).toBe("button");
    expect(disabled.props.disabled).toBe(true);
    expect(disabled.props["aria-busy"]).toBeUndefined();
    expect(retrying.props.disabled).toBe(true);
    expect(retrying.props["aria-busy"]).toBe(true);
  });

  test("preserves Retry as the accessible name while showing Retrying visually", async ({ page }) => {
    await setPrimitiveContent(
      page,
      feedbackMarkup({
        children: "The request could not be completed.",
        onRetry: () => undefined,
        retrying: true,
      }),
    );
    const button = page.getByRole("button", { name: "Retry" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveAccessibleName("Retry");
    await expect(button).not.toHaveAccessibleName("Retrying...");
    await expect(button.getByText("Retrying...")).toBeVisible();

    await button.evaluate((element) => {
      (window as typeof window & { retryActivations?: number }).retryActivations = 0;
      element.addEventListener("click", () => {
        (window as typeof window & { retryActivations: number }).retryActivations += 1;
      });
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    expect(
      await page.evaluate(
        () => (window as typeof window & { retryActivations: number }).retryActivations,
      ),
    ).toBe(0);
  });

  test("compiles exact semantic utilities from product roots without a safelist", async ({ page }) => {
    const { css, dependencyFiles } = await compiledProductCss();
    const candidates = [
      "rounded-ui",
      "text-content-muted",
      ...Object.values(toneClasses).flatMap((classes) => classes.split(" ")),
    ];
    const selectors = await page.evaluate(
      (values) => values.map((value) => `.${CSS.escape(value)}`),
      [...new Set(candidates)],
    );
    for (const [index, candidate] of [...new Set(candidates)].entries()) {
      expect(css, candidate).toContain(selectors[index]);
    }
    expect(globalsSource).toContain('@source "../app";');
    expect(globalsSource).toContain('@source "../src";');
    expect(globalsSource).not.toContain("safelist");
    expect(dependencyFiles.some((file) => file.endsWith("FeedbackAlert.tsx"))).toBe(true);
    expect(dependencyFiles.some((file) => file.endsWith("LiveStatus.tsx"))).toBe(true);
  });

  test("meets computed contrast and avoids compatibility remapping for every tone", async ({ page }) => {
    const markup = Object.keys(toneClasses)
      .map((tone) => feedbackMarkup({ children: `${tone} feedback`, tone: tone as FeedbackAlertProps["tone"] }).replace("<div ", `<div data-tone="${tone}" `))
      .join("");
    await setPrimitiveContent(page, `<main class="coachos-light"><div class="coachos-content">${markup}</div></main>`);

    for (const [tone, expected] of Object.entries(toneStyles)) {
      const locator = page.locator(`[data-tone="${tone}"]`);
      const styles = await locator.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          backgroundColor: computed.backgroundColor,
          borderColor: computed.borderColor,
          color: computed.color,
        };
      });
      expect(styles.backgroundColor).toBe(expected.backgroundColor);
      expect(styles.color).toBe(expected.color);
      expect(styles.borderColor).toContain("/ 0.3)");
      expect(contrastRatio(styles.color, styles.backgroundColor)).toBeGreaterThanOrEqual(expected.minimumContrast);

      await page.locator("main").evaluate((element) => element.classList.remove("coachos-light"));
      const plainStyles = await locator.evaluate((element) => {
        const computed = getComputedStyle(element);
        return [computed.backgroundColor, computed.borderColor, computed.color];
      });
      expect(plainStyles).toEqual([styles.backgroundColor, styles.borderColor, styles.color]);
      await page.locator("main").evaluate((element) => element.classList.add("coachos-light"));
    }
  });

  test("keeps long retry alerts bounded at mobile and top-aligned on desktop", async ({ page }) => {
    const longText = `Unable to complete this request. ${"LongStatus".repeat(80)}`;
    const markup = [
      feedbackMarkup({ children: longText, onRetry: () => undefined, tone: "error" }),
      feedbackMarkup({ children: longText, onRetry: () => undefined, tone: "warning" }),
    ].join("");
    await page.setViewportSize({ width: 390, height: 844 });
    await setPrimitiveContent(page, `<main style="width:100%">${markup}</main>`);

    for (const alert of await page.locator("main > div").all()) {
      await expect(alert).toHaveCSS("flex-direction", "column");
      expect(await alert.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await alert.locator("button").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    for (const alert of await page.locator("main > div").all()) {
      await expect(alert).toHaveCSS("flex-direction", "row");
      const layout = await alert.evaluate((element) => {
        const body = element.querySelector("p")!.getBoundingClientRect();
        const button = element.querySelector("button")!.getBoundingClientRect();
        return {
          horizontalOverflow: element.scrollWidth > element.clientWidth,
          topDelta: Math.abs(body.top - button.top),
        };
      });
      expect(layout.horizontalOverflow).toBe(false);
      expect(layout.topDelta).toBeLessThanOrEqual(0.5);
    }
  });

  test("exports LiveStatus with exact visible, hidden, polite, and assertive contracts", () => {
    const visible = liveStatusElement({ children: "Saved" });
    expect(visible.props.role).toBe("status");
    expect(visible.props.className).toBe("text-sm leading-6 text-content-muted");
    expect(visible.props.children).toBe("Saved");

    const polite = liveStatusElement({ children: "Saving", politeness: "polite" });
    const assertive = liveStatusElement({ children: "Failed", politeness: "assertive" });
    const hidden = liveStatusElement({ children: "Loading", visuallyHidden: true, className: "caller" });
    expect(polite.props.role).toBe("status");
    expect(assertive.props.role).toBe("alert");
    expect(hidden.props.className).toBe("text-sm leading-6 text-content-muted sr-only caller");
  });

  test("keeps LiveStatus and FeedbackAlert directive-free and environment-neutral", () => {
    const combined = `${feedbackSource}\n${liveStatusSource}`;
    for (const forbidden of [
      '"use client"',
      "'use client'",
      "aria-live",
      "aria-atomic",
      "aria-relevant",
      "useEffect",
      "useState",
      "window.",
      "document.",
      "localStorage",
      "sessionStorage",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
    expect(liveStatusSource).not.toContain("aria-busy");
    expect(liveStatusSource).not.toContain("tabIndex");
    expect(combined).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  test("renders both primitives in the actual Next server graph", async ({ page }) => {
    if (!harnessUrl) throw new Error("Feedback primitive harness was not started.");
    await page.goto(`${harnessUrl}/server`);
    await expect(page.getByText("Server feedback")).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Server status");
  });

  test("renders and activates both primitives in an actual Next client graph", async ({ page }) => {
    if (!harnessUrl) throw new Error("Feedback primitive harness was not started.");
    await page.goto(harnessUrl);
    await expect(page.getByText("Client feedback")).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Client status" }),
    ).toHaveText("Client status");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("[data-retries]")).toHaveText("1");

  });
});
