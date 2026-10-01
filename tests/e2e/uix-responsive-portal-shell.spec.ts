import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join, relative } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const root = process.cwd();
const portalPath = join(
  root,
  "src",
  "components",
  "portal",
  "StudentPortalLayout.tsx",
);
const appShellPath = join(root, "src", "components", "layout", "AppShell.tsx");
const globalsPath = join(root, "app", "globals.css");
const portalSource = readFileSync(portalPath, "utf8");
const appShellSource = readFileSync(appShellPath, "utf8");
const globalsSource = readFileSync(globalsPath, "utf8");
const runtimeRoot = join(root, "support-ops", "runtime-tests");
const expectedDestinations = [
  ["Home", "/portal"],
  ["My Programs", "/portal/courses"],
  ["Live Classes", "/portal/sessions"],
  ["Assignments", "/portal/assignments"],
  ["Notifications", "/portal/notifications"],
  ["Materials", "/portal/documents"],
  ["Community", "/portal/community"],
  ["Announcements", "/portal/announcements"],
  ["Payments & Invoices", "/portal/payments"],
  ["Support", "/portal/messages"],
  ["Profile", "/portal/profile"],
] as const;
const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;
type PortalViewport = (typeof viewports)[number];
const syntheticInsets = { bottom: 21, left: 11, right: 13, top: 17 } as const;

let harnessDirectory: string | undefined;
let harnessProcess: ChildProcess | undefined;
let harnessUrl: string | undefined;

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    return statSync(absolute).isDirectory() ? listFiles(absolute) : [absolute];
  });
}

function portalRouteInventory() {
  return listFiles(join(root, "app", "portal"))
    .filter((path) => path.endsWith("page.tsx"))
    .map((path) => ({
      guarded:
        readFileSync(path, "utf8").includes("<StudentPortalGuard") &&
        readFileSync(path, "utf8").includes("<StudentPortalLayout"),
      path: relative(root, path).replaceAll("\\", "/"),
    }));
}

function contrastRatio(firstColor: string, secondColor: string) {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const first = luminance(firstColor);
  const second = luminance(secondColor);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
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

function writeHarnessFile(relativePath: string, contents: string) {
  if (!harnessDirectory) throw new Error("Portal harness directory is unavailable.");
  const target = join(harnessDirectory, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
}

async function waitForHarness(child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Portal harness exited before startup.\n${output()}`);
    }
    if (/Ready in [\d.]+s/.test(output())) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Portal harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(runtimeRoot, { recursive: true });
  harnessDirectory = mkdtempSync(join(runtimeRoot, "portal-shell-"));

  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  writeHarnessFile(
    "package.json",
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
  writeHarnessFile(
    "tsconfig.json",
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
          resolveJsonModule: true,
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
  writeHarnessFile("next.config.mjs", "export default {};\n");
  writeHarnessFile(
    "app/layout.tsx",
    `import type { ReactNode } from "react";
import "./globals.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
  );
  if (!harnessDirectory) throw new Error("Portal harness directory is unavailable.");
  copyFileSync(globalsPath, join(harnessDirectory, "app", "globals.css"));
  mkdirSync(join(harnessDirectory, "src", "components", "portal"), {
    recursive: true,
  });
  copyFileSync(
    portalPath,
    join(
      harnessDirectory,
      "src",
      "components",
      "portal",
      "StudentPortalLayout.tsx",
    ),
  );
  mkdirSync(join(harnessDirectory, "src", "components", "ui"), {
    recursive: true,
  });
  copyFileSync(
    join(root, "src", "components", "ui", "Button.tsx"),
    join(harnessDirectory, "src", "components", "ui", "Button.tsx"),
  );
  copyFileSync(
    join(root, "src", "components", "ui", "buttonStyles.ts"),
    join(harnessDirectory, "src", "components", "ui", "buttonStyles.ts"),
  );

  writeHarnessFile(
    "src/components/branding/CoachFortBrandAsset.tsx",
    `export function CoachFortBrandAsset({ className }: { className?: string; variant?: string }) {
  return <span aria-hidden="true" className={className}>CF</span>;
}
`,
  );
  writeHarnessFile(
    "src/lib/featureAccess.ts",
    `export type FeatureAccessMap = Record<string, { feature_key: string; status: string }>;
export const portalNavFeatureByLabel: Record<string, string | undefined> = {
  Announcements: "messages",
  Assignments: "assignments",
  Community: "community_hub",
  "Live Classes": "attendance",
  Materials: "documents",
  "My Programs": "courses",
  Notifications: "notifications",
  "Payments & Invoices": "finance",
  Support: "messages",
};
const keys = ["messages", "assignments", "community_hub", "attendance", "documents", "courses", "notifications", "finance"];
export function featureListToMap(features: Array<{ feature_key: string; status: string }>) {
  return Object.fromEntries(features.map((item) => [item.feature_key, item]));
}
export function getFeatureStatusLabel() { return "Unavailable"; }
export async function getPortalFeatureAccess() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("delay")) await new Promise((resolve) => setTimeout(resolve, Number(params.get("delay"))));
  const few = params.get("features") === "few";
  return { features: keys.map((feature_key) => ({ feature_key, status: !few || feature_key === "courses" ? "enabled" : "disabled" })) };
}
export function isFeatureEnabled(access: FeatureAccessMap | null | undefined, featureKey: string | undefined) {
  if (!featureKey || !access) return true;
  return (access[featureKey]?.status ?? "enabled") === "enabled";
}
`,
  );
  writeHarnessFile(
    "src/lib/supabaseClient.ts",
    `export function getSupabaseClient() {
  return { auth: { signOut: async () => undefined } };
}
`,
  );
  writeHarnessFile(
    "src/lib/tenantSettings.ts",
    `export type TenantSettings = { brand_color?: string | null; student_portal_theme_color?: string | null };
export function getSafeTenantBrandColor(value?: string | null) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#145da0";
}
export async function getTenantSettings() {
  const brandColor = new URLSearchParams(window.location.search).get("brand");
  return brandColor ? { student_portal_theme_color: brandColor } : null;
}
export function getWorkspaceBranding(_settings: TenantSettings | null, tenant: { name: string }) {
  const params = new URLSearchParams(window.location.search);
  return {
    brandTagline: params.get("tagline") || "Student Portal",
    displayName: params.get("brandName") || tenant.name,
    logoUrl: "",
    showPoweredBy: false,
  };
}
`,
  );
  writeHarnessFile(
    "src/lib/studentPortalAuth.ts",
    `export type StudentPortalContext = {
  student: { full_name: string };
  tenant: { id: string; name: string };
};
`,
  );
  writeHarnessFile(
    "app/portal/[[...slug]]/page.tsx",
    `import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

const context = {
  student: { full_name: "Regression Student" },
  tenant: { id: "f93faeee-b177-497e-854e-5052497914b9", name: "CoachFort Regression 2026" },
};

export default function PortalHarnessPage() {
  return (
    <StudentPortalLayout context={context}>
      <section>
        <h1>Student portal source-faithful harness</h1>
        <div style={{ height: 1600 }}>Long portal page content</div>
        <button type="button">Final content control</button>
      </section>
    </StudentPortalLayout>
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
  let output = "";
  const capture = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-12_000);
  };
  harnessProcess.stdout?.on("data", capture);
  harnessProcess.stderr?.on("data", capture);
  await waitForHarness(harnessProcess, () => output);
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
  if (existsSync(runtimeRoot) && readdirSync(runtimeRoot).length === 0) {
    rmdirSync(runtimeRoot);
  }
}

async function openPortal(
  page: Page,
  path = "/portal",
  query = "",
  viewport: PortalViewport = viewports[0],
) {
  if (!harnessUrl) throw new Error("Portal harness URL is unavailable.");
  await page.setViewportSize(viewport);
  await page.goto(`${harnessUrl}${path}${query}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("navigation", { name: "Student portal navigation" })
    .waitFor();
  await page.getByText("Checking module access...", { exact: true }).waitFor({
    state: "hidden",
  });
  await page.waitForTimeout(50);
}

async function setSafeInsets(
  page: Page,
  insets: { bottom: number; left: number; right: number; top: number },
) {
  await page.evaluate((values) => {
    const style = document.documentElement.style;
    style.setProperty("--ui-safe-area-top", `${values.top}px`);
    style.setProperty("--ui-safe-area-right", `${values.right}px`);
    style.setProperty("--ui-safe-area-bottom", `${values.bottom}px`);
    style.setProperty("--ui-safe-area-left", `${values.left}px`);
  }, insets);
}

async function portalGeometry(page: Page) {
  return page.evaluate(() => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const nav = document.querySelector<HTMLElement>(
      'nav[aria-label="Student portal navigation"]',
    )!;
    const header = document.querySelector<HTMLElement>("header")!;
    const headerFrame = header.firstElementChild as HTMLElement;
    const main = document.querySelector<HTMLElement>("main")!;
    const root = main.parentElement as HTMLElement;
    const logout = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Logout",
    )!;
    const links = Array.from(nav.querySelectorAll<HTMLElement>("a"));
    const active = nav.querySelector<HTMLElement>('a[aria-current="page"]');
    const rect = (element: HTMLElement) => element.getBoundingClientRect();
    const style = (element: HTMLElement) => getComputedStyle(element);

    return {
      activeVisible:
        !active ||
        (rect(active).left >= rect(nav).left - 1 &&
          rect(active).right <= rect(nav).right + 1),
      chipMinimum: Math.min(...links.map((link) => rect(link).height)),
      documentHorizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      headerHeight: rounded(rect(header).height),
      headerLeft: style(headerFrame).paddingLeft,
      headerRight: style(headerFrame).paddingRight,
      headerTop: style(header).paddingTop,
      leftFade: Boolean(document.querySelector('[data-portal-nav-fade="left"]')),
      logoutHeight: rounded(rect(logout).height),
      mainBottom: style(main).paddingBottom,
      mainLeft: style(main).paddingLeft,
      mainRight: style(main).paddingRight,
      navClientWidth: nav.clientWidth,
      navScrollLeft: rounded(nav.scrollLeft),
      navScrollWidth: nav.scrollWidth,
      rightFade: Boolean(document.querySelector('[data-portal-nav-fade="right"]')),
      rootMinHeight: style(root).minHeight,
    };
  });
}

async function touchPan(page: Page, fromX: number, toX: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [{ x: fromX, y }],
    type: "touchStart",
  });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      touchPoints: [{ x: fromX + ((toX - fromX) * step) / 8, y }],
      type: "touchMove",
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [],
    type: "touchEnd",
  });
  await page.waitForTimeout(100);
  await cdp.detach();
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await buildHarness();
});

test.afterAll(async () => {
  await stopHarness();
});

test("preserves the client, route, destination, and feature authority", () => {
  const routes = portalRouteInventory();
  const guarded = routes.filter((route) => route.guarded);
  const login = routes.filter((route) => route.path === "app/portal/login/page.tsx");

  expect(portalSource.startsWith('"use client";')).toBe(true);
  expect(routes).toHaveLength(16);
  expect(guarded).toHaveLength(15);
  expect(login).toHaveLength(1);
  expect(login[0].guarded).toBe(false);
  expect(appShellSource).not.toContain("Student portal navigation");

  let previousIndex = -1;
  for (const [label, href] of expectedDestinations) {
    const marker = `{ href: "${href}", label: "${label}" }`;
    const index = portalSource.indexOf(marker);
    expect(index, label).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
  expect(portalSource).toContain("portalNavFeatureByLabel[item.label]");
  expect(portalSource).toContain('featureKey === "notifications"');
  expect(portalSource).toContain("featureAccessLoaded &&");
  expect(portalSource).toContain("pathname?.startsWith(item.href)");
});

test("installs the reviewed document-scroll, safe-area, and target contract", () => {
  expect(portalSource).toContain("min-h-[var(--ui-viewport-height)]");
  expect(portalSource).not.toContain("min-h-screen");
  expect(portalSource).not.toContain("overflow-y-auto");
  expect(portalSource).not.toContain("overflow-hidden");
  expect(portalSource.match(/pt-\[var\(--ui-safe-area-top\)\]/g)).toHaveLength(1);
  for (const marker of [
    "max-w-7xl",
    "pl-[calc(1.25rem+var(--ui-safe-area-left))]",
    "pr-[calc(1.25rem+var(--ui-safe-area-right))]",
    "sm:pl-[calc(1.5rem+var(--ui-safe-area-left))]",
    "sm:pr-[calc(1.5rem+var(--ui-safe-area-right))]",
    "lg:pl-[calc(2rem+var(--ui-safe-area-left))]",
    "lg:pr-[calc(2rem+var(--ui-safe-area-right))]",
    "pb-[calc(1.5rem+var(--ui-safe-area-bottom))]",
    "min-h-11 shrink-0",
    "inline-flex min-h-11 shrink-0 items-center",
  ]) {
    expect(portalSource, marker).toContain(marker);
  }
});

test("uses labelled native navigation and one stable horizontal controller", () => {
  expect(portalSource).toContain('aria-label="Student portal navigation"');
  expect(portalSource).toContain('aria-current={active ? "page" : undefined}');
  expect(portalSource).not.toContain('role="navigation"');
  expect(portalSource).not.toMatch(/role="(?:tablist|tab|menu|menubar)"/);
  expect(portalSource).toContain("overflow-x-auto p-1 scroll-px-6");
  expect(portalSource).not.toContain("scrollbar-none");
  expect(portalSource).toContain("const updatePortalNavOverflow = useCallback");
  expect(portalSource).toContain("rail.scrollLeft > 1");
  expect(portalSource).toContain("maximumScrollLeft - 1");
  expect(portalSource).toContain("const portalNavFrameRef = useRef<number | null>");
  expect(portalSource).toContain(
    "const schedulePortalNavReconciliation = useCallback",
  );
  expect(portalSource).toContain(
    "new ResizeObserver(schedulePortalNavReconciliation)",
  );
  expect(portalSource).not.toContain(
    "new ResizeObserver(revealActivePortalItem)",
  );
  expect(portalSource).toContain("schedulePortalNavReconciliation();");
  expect(portalSource).toContain(
    'window.addEventListener("resize", schedulePortalNavReconciliation)',
  );
  expect(portalSource).toContain(
    'window.removeEventListener("resize", schedulePortalNavReconciliation)',
  );
  expect(portalSource).toContain(
    "window.cancelAnimationFrame(portalNavFrameRef.current)",
  );
  expect(portalSource).toContain("window.requestAnimationFrame");
  expect(portalSource).toContain("visiblePortalNavSignature");
  expect(portalSource).toContain("const edgeAllowance = 24");
  expect(portalSource).not.toContain("scrollIntoView");
  expect(portalSource).not.toMatch(/window\.scroll(?:To)?\(/);
  expect(portalSource).not.toMatch(/set(?:Timeout|Interval)\(/);
});

test("compiles all portal utilities from product-only Tailwind discovery", async () => {
  const result = await postcss([tailwindcss()]).process(globalsSource, {
    from: globalsPath,
  });
  const dependencies = result.messages.flatMap((message) =>
    "file" in message && typeof message.file === "string" ? [message.file] : [],
  );

  expect(globalsSource).toContain('@source "../app";');
  expect(globalsSource).toContain('@source "../src";');
  expect(globalsSource).not.toContain('@source "../tests";');
  expect(globalsSource).not.toContain('@source "../support-ops";');
  expect(dependencies.some((path) => path.endsWith("StudentPortalLayout.tsx"))).toBe(
    true,
  );
  expect(dependencies.every((path) => !path.includes("support-ops"))).toBe(true);
  for (const declaration of [
    "min-height: var(--ui-viewport-height)",
    "padding-top: var(--ui-safe-area-top)",
    "padding-bottom: calc(1.5rem + var(--ui-safe-area-bottom))",
    "background-color: var(--portal-brand)",
    "color: var(--portal-brand-foreground)",
    "outline-color: var(--ui-focus)",
    "scroll-padding-inline: calc(var(--spacing) * 6)",
    "width: calc(var(--spacing) * 6)",
  ]) {
    expect(result.css, declaration).toContain(declaration);
  }
  expect(result.css).toContain("linear-gradient(to right");
  expect(result.css).toContain("linear-gradient(to left");
});

test("selects a WCAG-safe portal brand foreground", async ({ page }) => {
  const cases = [
    { background: "#145da0", expected: "#ffffff", ratio: 6.77 },
    { background: "#ffffff", expected: "#000000", ratio: 21 },
    { background: "#777777", expected: "#000000", ratio: 4.69 },
    { background: "#0b1f33", expected: "#ffffff", ratio: 16.69 },
  ] as const;

  for (const value of cases) {
    await openPortal(page, "/portal", `?brand=${encodeURIComponent(value.background)}`);
    const variables = await page.locator("main").locator("..").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.getPropertyValue("--portal-brand").trim(),
        foreground: style.getPropertyValue("--portal-brand-foreground").trim(),
      };
    });
    const ratio = contrastRatio(variables.background, variables.foreground);
    expect(variables).toEqual({
      background: value.background,
      foreground: value.expected,
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(value.ratio, 1);
    const active = page.getByRole("link", { name: "Home", exact: true });
    expect(await active.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("meets the zero-inset responsive matrix without document overflow", async ({
  page,
}) => {
  for (const viewport of viewports) {
    await openPortal(page, "/portal", "", viewport);
    await setSafeInsets(page, { bottom: 0, left: 0, right: 0, top: 0 });
    const result = await portalGeometry(page);
    const gutter = viewport.width >= 1024 ? "32px" : viewport.width >= 640 ? "24px" : "20px";

    expect(result.rootMinHeight, viewport.name).toBe(`${viewport.height}px`);
    expect(result.headerTop, viewport.name).toBe("0px");
    expect(result.headerLeft, viewport.name).toBe(gutter);
    expect(result.headerRight, viewport.name).toBe(gutter);
    expect(result.mainLeft, viewport.name).toBe(gutter);
    expect(result.mainRight, viewport.name).toBe(gutter);
    expect(result.mainBottom, viewport.name).toBe("24px");
    expect(result.chipMinimum, viewport.name).toBeGreaterThanOrEqual(44);
    expect(result.logoutHeight, viewport.name).toBeGreaterThanOrEqual(44);
    expect(result.documentHorizontalOverflow, viewport.name).toBe(false);
    expect(result.activeVisible, viewport.name).toBe(true);
    expect(result.navScrollWidth, viewport.name).toBeGreaterThanOrEqual(
      result.navClientWidth,
    );
  }
});

test("adds synthetic safe areas once and bounds a long portal identity", async ({
  page,
}) => {
  const query = `?brandName=${encodeURIComponent("CoachFort Regression 2026 with an exceptionally long workspace identity")}&tagline=${encodeURIComponent("A deliberately long student portal tagline that must stay within the identity row")}`;
  for (const viewport of [viewports[0], viewports[viewports.length - 1]]) {
    await openPortal(page, "/portal", query, viewport);
    await setSafeInsets(page, syntheticInsets);
    const result = await portalGeometry(page);
    const base = viewport.width >= 1024 ? 32 : 20;
    expect(result.headerTop, viewport.name).toBe("17px");
    expect(result.headerLeft, viewport.name).toBe(`${base + 11}px`);
    expect(result.headerRight, viewport.name).toBe(`${base + 13}px`);
    expect(result.mainLeft, viewport.name).toBe(`${base + 11}px`);
    expect(result.mainRight, viewport.name).toBe(`${base + 13}px`);
    expect(result.mainBottom, viewport.name).toBe("45px");
    expect(result.documentHorizontalOverflow, viewport.name).toBe(false);
    const identity = page.getByRole("link", { name: /CoachFort Regression 2026/ });
    const logout = page.getByRole("button", { name: "Logout" });
    const [identityBox, logoutBox] = await Promise.all([
      identity.boundingBox(),
      logout.boundingBox(),
    ]);
    expect(identityBox?.x).toBeGreaterThanOrEqual(0);
    expect((identityBox?.x ?? 0) + (identityBox?.width ?? 0)).toBeLessThanOrEqual(
      logoutBox?.x ?? 0,
    );
    await expect(logout).toBeVisible();
  }
});

test("keeps document scrolling and the sticky portal header authoritative", async ({
  page,
}) => {
  for (const path of ["/portal", "/portal/documents", "/portal/profile"]) {
    await openPortal(page, path);
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 360);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(300);
    const before = await page.evaluate(() => window.scrollY);
    await page.setViewportSize({ width: 430, height: 932 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(50);
    const result = await page.evaluate(() => {
      const header = document.querySelector("header")!;
      const main = document.querySelector("main")!;
      return {
        headerTop: Math.round(header.getBoundingClientRect().top),
        mainOverflowY: getComputedStyle(main).overflowY,
        rootOverflowY: getComputedStyle(main.parentElement!).overflowY,
        scrollY: window.scrollY,
      };
    });
    expect(before, path).toBeGreaterThanOrEqual(300);
    expect(result.scrollY, path).toBe(before);
    expect(result.headerTop, path).toBe(0);
    expect(result.mainOverflowY, path).not.toBe("auto");
    expect(result.rootOverflowY, path).not.toBe("auto");
  }
});

test("updates start, middle, end, and no-overflow edge affordances", async ({
  page,
}) => {
  await openPortal(page);
  const nav = page.getByRole("navigation", { name: "Student portal navigation" });
  await expect(page.locator('[data-portal-nav-fade="left"]')).toHaveCount(0);
  await expect(page.locator('[data-portal-nav-fade="right"]')).toHaveCount(1);
  await nav.evaluate((element) => {
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator('[data-portal-nav-fade="left"]')).toHaveCount(1);
  await expect(page.locator('[data-portal-nav-fade="right"]')).toHaveCount(1);
  await nav.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator('[data-portal-nav-fade="left"]')).toHaveCount(1);
  await expect(page.locator('[data-portal-nav-fade="right"]')).toHaveCount(0);

  const fadeSafety = await page.locator('[data-portal-nav-fade="left"]').evaluate(
    (element) => ({
      ariaHidden: element.getAttribute("aria-hidden"),
      bottom: getComputedStyle(element).bottom,
      pointerEvents: getComputedStyle(element).pointerEvents,
      width: element.getBoundingClientRect().width,
    }),
  );
  expect(fadeSafety).toEqual({
    ariaHidden: "true",
    bottom: "16px",
    pointerEvents: "none",
    width: 24,
  });
  expect(await nav.evaluate((element) => getComputedStyle(element).overflowX)).toBe(
    "auto",
  );

  await openPortal(page, "/portal/courses", "?features=few");
  await expect(nav.locator("a")).toHaveCount(3);
  await expect(page.locator('[data-portal-nav-fade="left"]')).toHaveCount(0);
  await expect(page.locator('[data-portal-nav-fade="right"]')).toHaveCount(0);
  const noOverflow = await portalGeometry(page);
  expect(noOverflow.navScrollWidth).toBe(noOverflow.navClientWidth);
});

test("reveals first, middle, and last active destinations without vertical movement", async ({
  page,
}) => {
  const cases = [
    ["/portal", "Home"],
    ["/portal/documents", "Materials"],
    ["/portal/profile", "Profile"],
  ] as const;
  for (const [path, label] of cases) {
    await openPortal(page, path);
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 360);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(300);
    const before = await page.evaluate(() => window.scrollY);
    await page.setViewportSize({ width: 430, height: 932 });
    await page.setViewportSize({ width: 390, height: 844 });
    const active = page.getByRole("link", { name: label, exact: true });
    await expect(active).toHaveAttribute("aria-current", "page");
    await expect
      .poll(() =>
        active.evaluate((element) => {
          const nav = element.closest("nav")!;
          const item = element.getBoundingClientRect();
          const rail = nav.getBoundingClientRect();
          return {
            left: item.left >= rail.left - 1,
            right: item.right <= rail.right + 1,
          };
        }),
      )
      .toEqual({ left: true, right: true });
    expect(await page.evaluate(() => window.scrollY), label).toBe(before);
    expect(await page.locator('a[aria-current="page"]').count(), label).toBe(1);
  }
});

test("uses native keyboard focus without clipping the semantic outline", async ({
  page,
}) => {
  await openPortal(page);
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Tab");
    if (
      (await page.evaluate(() => document.activeElement?.textContent?.trim())) ===
      "Profile"
    ) {
      break;
    }
  }
  const profile = page.getByRole("link", { name: "Profile", exact: true });
  await expect(profile).toBeFocused();
  const focus = await profile.evaluate((element) => {
    const item = element.getBoundingClientRect();
    const nav = element.closest("nav")!.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      fullyVisible: item.left - 4 >= nav.left - 1 && item.right + 4 <= nav.right + 1,
      offset: style.outlineOffset,
      style: style.outlineStyle,
      width: style.outlineWidth,
    };
  });
  expect(focus).toEqual({
    fullyVisible: true,
    offset: "2px",
    style: "solid",
    width: "2px",
  });
});

test("retains native touch and horizontal wheel rail scrolling", async ({ page }) => {
  await openPortal(page);
  const nav = page.getByRole("navigation", { name: "Student portal navigation" });
  const box = await nav.boundingBox();
  if (!box) throw new Error("Portal navigation rail has no bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(300, 0);
  await expect
    .poll(() => nav.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(100);

  await nav.evaluate((element) => {
    element.scrollLeft = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await touchPan(page, box.x + box.width - 30, box.x + 30, box.y + box.height / 2);
  const touchDistance = await nav.evaluate((element) => element.scrollLeft);
  expect(touchDistance).toBeGreaterThan(100);
});

test("remeasures after async feature filtering and responsive resize", async ({ page }) => {
  if (!harnessUrl) throw new Error("Portal harness URL is unavailable.");
  await page.setViewportSize(viewports[0]);
  await page.goto(`${harnessUrl}/portal/courses?features=few&delay=300`, {
    waitUntil: "domcontentloaded",
  });
  const nav = page.getByRole("navigation", { name: "Student portal navigation" });
  await expect(nav.locator("a")).toHaveCount(10);
  const before = await page.evaluate(() => window.scrollY);
  await expect(nav.locator("a")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "My Programs" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator('[data-portal-nav-fade="left"]')).toHaveCount(0);
  await expect(page.locator('[data-portal-nav-fade="right"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  await openPortal(page, "/portal/profile");
  for (const viewport of [viewports[0], viewports[viewports.length - 1], viewports[0]]) {
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.setViewportSize(viewport);
    await page.waitForTimeout(50);
    const geometry = await portalGeometry(page);
    expect(geometry.activeVisible, viewport.name).toBe(true);
    expect(geometry.documentHorizontalOverflow, viewport.name).toBe(false);
    expect(await page.evaluate(() => window.scrollY), viewport.name).toBe(scrollY);
  }
});

test("reconciles Profile across repeated and broad responsive transitions", async ({
  page,
}) => {
  await openPortal(page, "/portal/profile", "", viewports[1]);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 360);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(300);
  const initialWindowScroll = await page.evaluate(() => window.scrollY);
  const profile = page.getByRole("link", { name: "Profile", exact: true });

  const expectProfileSettled = async (label: string) => {
    await expect(profile, label).toHaveAttribute("aria-current", "page");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const rail = document.querySelector<HTMLElement>(
              'nav[aria-label="Student portal navigation"]',
            )!;
            const active = rail.querySelector<HTMLElement>(
              'a[aria-current="page"]',
            )!;
            const railRect = rail.getBoundingClientRect();
            const activeRect = active.getBoundingClientRect();
            return {
              activeVisible:
                activeRect.left >= railRect.left - 1 &&
                activeRect.right <= railRect.right + 1,
              documentHorizontalOverflow:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
              leftFade: Boolean(
                document.querySelector('[data-portal-nav-fade="left"]'),
              ),
              rightFade: Boolean(
                document.querySelector('[data-portal-nav-fade="right"]'),
              ),
            };
          }),
        { message: label },
      )
      .toEqual({
        activeVisible: true,
        documentHorizontalOverflow: false,
        leftFade: true,
        rightFade: false,
      });
    expect(await page.evaluate(() => window.scrollY), label).toBe(
      initialWindowScroll,
    );
  };

  await expectProfileSettled("Profile at settled 430x932");

  for (let transition = 1; transition <= 10; transition += 1) {
    await page.setViewportSize(viewports[0]);
    await expectProfileSettled(`Profile 430 to 390 transition ${transition}`);
    if (transition < 10) {
      await page.setViewportSize(viewports[1]);
      await expectProfileSettled(`Profile 390 to 430 reset ${transition}`);
    }
  }

  await page.setViewportSize(viewports[1]);
  await expectProfileSettled("Profile 390 to 430");
  await page.setViewportSize(viewports[0]);
  await expectProfileSettled("Profile 390 to 430 to 390");

  await page.setViewportSize(viewports[viewports.length - 1]);
  await expectProfileSettled("Profile 390 to 1440");
  await page.setViewportSize(viewports[0]);
  await expectProfileSettled("Profile 390 to 1440 to 390");

  await page.setViewportSize(viewports[1]);
  await expectProfileSettled("Profile broad sequence at 430");
  await page.setViewportSize(viewports[0]);
  await expectProfileSettled("Profile broad sequence at first 390");
  await page.setViewportSize(viewports[1]);
  await expectProfileSettled("Profile broad sequence back at 430");
  await page.setViewportSize(viewports[0]);
  await expectProfileSettled("Profile 430 to 390 to 430 to 390");
});
