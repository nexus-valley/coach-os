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
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const root = process.cwd();
const shellPath = join(root, "src", "components", "layout", "AppShell.tsx");
const globalsPath = join(root, "app", "globals.css");
const shellSource = readFileSync(shellPath, "utf8");
const globalsSource = readFileSync(globalsPath, "utf8");
const runtimeRoot = join(root, "support-ops", "runtime-tests");
const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "1023x768", width: 1023, height: 768 },
] as const;
type MobileMoreViewport = (typeof viewports)[number];

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

function writeHarnessFile(relativePath: string, contents: string) {
  if (!harnessDirectory) throw new Error("Harness directory is unavailable.");
  const target = join(harnessDirectory, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
}

async function waitForHarness(
  child: ChildProcess,
  output: () => string,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Mobile More harness exited before startup.\n${output()}`);
    }
    if (/Ready in [\d.]+s/.test(output())) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Mobile More harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(runtimeRoot, { recursive: true });
  harnessDirectory = mkdtempSync(join(runtimeRoot, "mobile-more-"));

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
  if (!harnessDirectory) throw new Error("Harness directory is unavailable.");
  copyFileSync(globalsPath, join(harnessDirectory, "app", "globals.css"));
  mkdirSync(join(harnessDirectory, "src", "components", "layout"), {
    recursive: true,
  });
  copyFileSync(
    shellPath,
    join(harnessDirectory, "src", "components", "layout", "AppShell.tsx"),
  );

  writeHarnessFile(
    "src/components/branding/CoachFortBrandAsset.tsx",
    `export function CoachFortBrandAsset({ className }: { className?: string; variant?: string }) {
  return <span aria-hidden="true" className={className}>CF</span>;
}
`,
  );
  writeHarnessFile(
    "src/components/notifications/NotificationBell.tsx",
    `export function NotificationBell() {
  return <button aria-label="Header alerts" type="button">Alerts</button>;
}
`,
  );
  writeHarnessFile(
    "src/components/subscription/InactiveWorkspacePanel.tsx",
    `export function InactiveWorkspacePanel() { return <section>Inactive</section>; }
`,
  );
  writeHarnessFile(
    "src/components/subscription/SubscriptionLifecycleBanner.tsx",
    `export function SubscriptionLifecycleBanner() { return <section>Lifecycle</section>; }
`,
  );
  writeHarnessFile(
    "src/components/ui/Button.tsx",
    `import type { ButtonHTMLAttributes } from "react";
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) {
  const { size: _size, variant: _variant, ...buttonProps } = props;
  return <button {...buttonProps} />;
}
`,
  );
  writeHarnessFile(
    "src/lib/featureAccess.ts",
    `export type FeatureAccessMap = Record<string, { status: string }>;
export const navFeatureByLabel: Record<string, string | undefined> = {};
export function featureListToMap() { return {} as FeatureAccessMap; }
export function getFeatureStatusLabel() { return "Unavailable"; }
export async function getTenantFeatureAccess() { return { features: [] }; }
export function isFeatureEnabled() { return true; }
`,
  );
  writeHarnessFile(
    "src/lib/permissions.ts",
    `export function canAccessNavigationItem() { return true; }
`,
  );
  writeHarnessFile(
    "src/lib/subscriptionLifecycle.ts",
    `export async function getCurrentTenantOperationalState(tenantId: string) {
  return { effectiveState: "active", operationalAllowed: true, tenantId };
}
export async function getTenantSubscriptionLifecycle() { return null; }
`,
  );
  writeHarnessFile(
    "src/lib/subscriptionLifecycleModel.ts",
    `export type SubscriptionLifecyclePresentation = { state: string };
export type TenantOperationalState = { effectiveState: string; operationalAllowed: boolean; tenantId: string };
export function deriveSubscriptionLifecyclePresentation() { return { state: "active" }; }
export function getInactiveShellMode() { return null; }
export function isInactiveLifecycleState() { return false; }
`,
  );
  writeHarnessFile(
    "src/lib/supabaseClient.ts",
    `export function getSupabaseClient() {
  return { auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }), signOut: async () => undefined } };
}
`,
  );
  writeHarnessFile(
    "src/lib/team.ts",
    `export type MemberRole = "owner" | "admin" | "staff" | "trainer";
export async function getCurrentMemberRole() { return "owner" as MemberRole; }
`,
  );
  writeHarnessFile(
    "src/lib/tenant.ts",
    `export async function getCurrentTenant() { return { id: "f93faeee-b177-497e-854e-5052497914b9", name: "CoachFort Regression 2026" }; }
`,
  );
  writeHarnessFile(
    "src/lib/tenantSettings.ts",
    `export const defaultTenantBrandColor = "#145DA0";
export function getSafeTenantBrandColor(value?: string) { return value ?? defaultTenantBrandColor; }
export async function getTenantSettings() { return null; }
export function getWorkspaceBranding() { return { displayName: "CoachFort Regression 2026", iconUrl: "", logoUrl: "" }; }
`,
  );

  const page = (activeItem: string, heading: string) => `import { AppShell } from "@/src/components/layout/AppShell";
export default function Page() {
  return (
    <AppShell activeItem="${activeItem}">
      <section>
        <h2>${heading}</h2>
        <p>Read-only mobile navigation proof.</p>
        <div style={{ height: 1600 }} />
        <button type="button">Last content control</button>
      </section>
    </AppShell>
  );
}
`;
  writeHarnessFile("app/app/community/page.tsx", page("Community", "Community"));
  writeHarnessFile(
    "app/app/video-library/page.tsx",
    page("Video Library", "Video Library"),
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

async function openCommunity(
  page: Page,
  viewport: MobileMoreViewport = viewports[0],
) {
  if (!harnessUrl) throw new Error("Harness URL is unavailable.");
  await page.setViewportSize(viewport);
  await page.goto(`${harnessUrl}/app/community`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", {
      exact: true,
      level: 1,
      name: "CoachFort Regression 2026",
    })
    .waitFor();
  await page.getByText("Checking module access...", { exact: true }).waitFor({
    state: "hidden",
  });
}

async function openMore(page: Page) {
  const trigger = page.getByRole("button", { name: "More", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "More workspace navigation",
  });
  await dialog.waitFor();
  await expect(
    page.getByRole("button", { name: "Close More navigation", exact: true }),
  ).toBeFocused();
  return { dialog, trigger };
}

async function touchSwipe(
  page: Page,
  x: number,
  fromY: number,
  toY: number,
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [{ x, y: fromY }],
    type: "touchStart",
  });
  for (let step = 1; step <= 6; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      touchPoints: [{ x, y: fromY + ((toY - fromY) * step) / 6 }],
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

test("keeps navigation authority and installs only the local reviewed contract", () => {
  expect(shellSource).toContain(
    'const mobilePrimaryLabels = ["Home", "Programs", "Students", "Enrollments"]',
  );
  expect(shellSource).toContain("const visibleNavItems = lifecycleInactive");
  expect(shellSource).toContain(
    "const mobilePrimaryNavItems = getMobilePrimaryNavItems(visibleNavItems)",
  );
  expect(shellSource).toContain(
    "const mobileOverflowNavItems = visibleNavItems.filter",
  );
  expect(shellSource).toContain('aria-haspopup="dialog"');
  expect(shellSource).toContain('role="dialog"');
  expect(shellSource).toContain('aria-modal="true"');
  expect(shellSource).toContain(
    'aria-labelledby="mobile-more-navigation-title"',
  );
  expect(shellSource).toContain("closeMobileMore(active)");
  expect(shellSource).not.toContain('aria-hidden="true"');
  expect(shellSource).not.toContain("MobileWorkspaceNavigation");
  expect(shellSource).not.toContain("max-h-[52vh]");
});

test("emits the exact safe-area, viewport, scroll, and z-index utilities", async () => {
  const result = await postcss([tailwindcss()]).process(globalsSource, {
    from: globalsPath,
  });
  for (const declaration of [
    "bottom: calc(6rem + var(--ui-safe-area-bottom))",
    "left: calc(0.75rem + var(--ui-safe-area-left))",
    "right: calc(0.75rem + var(--ui-safe-area-right))",
    "max-height: min(68%, calc(var(--ui-viewport-height) - 7.5rem - var(--ui-safe-area-top) - var(--ui-safe-area-bottom)))",
    "overscroll-behavior: contain",
    "z-index: 60",
  ]) {
    expect(result.css, declaration).toContain(declaration);
  }
  expect(result.css).not.toContain("max-height: 52vh");
});

test("exposes one named dialog, hides the pointer backdrop from AX, and traps focus", async ({
  page,
}) => {
  await openCommunity(page);
  const { dialog } = await openMore(page);
  expect(await dialog.getAttribute("aria-labelledby")).toBe(
    "mobile-more-navigation-title",
  );
  expect(await dialog.getAttribute("aria-modal")).toBe("true");

  const cdp = await page.context().newCDPSession(page);
  const tree = await cdp.send("Accessibility.getFullAXTree");
  const exposed = tree.nodes.filter((node) => !node.ignored);
  const dialogs = exposed.filter(
    (node) =>
      node.role?.value === "dialog" &&
      node.name?.value === "More workspace navigation",
  );
  const names = exposed.map((node) => node.name?.value).filter(Boolean);
  expect(dialogs).toHaveLength(1);
  expect(names).not.toContain("Skip to main content");
  expect(names).not.toContain("Header alerts");
  expect(names).not.toContain("Workspace navigation");
  expect(
    exposed.filter(
      (node) =>
        node.role?.value === "button" &&
        String(node.name?.value ?? "").startsWith("Close"),
    ),
  ).toHaveLength(1);
  await cdp.detach();

  const frameInert = await dialog.evaluate(
    (element) => element.parentElement?.previousElementSibling?.hasAttribute("inert"),
  );
  expect(frameInert).toBe(true);
  expect(await page.locator('a[href="#workspace-main-content"]').getAttribute("inert"))
    .not.toBeNull();

  const controls = dialog.locator(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  );
  const controlCount = await controls.count();
  expect(controlCount).toBeGreaterThan(2);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toContain(
    "Team & Settings",
  );
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close More navigation", exact: true }),
  ).toBeFocused();
  for (let index = 0; index < controlCount; index += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(
    page.getByRole("button", { name: "Close More navigation", exact: true }),
  ).toBeFocused();
});

test("restores focus for Escape, Close, backdrop, and the active route", async ({
  page,
}) => {
  await openCommunity(page);
  let opened = await openMore(page);
  await page.keyboard.press("Escape");
  await expect(opened.dialog).toBeHidden();
  await expect(opened.trigger).toBeFocused();

  opened = await openMore(page);
  await page
    .getByRole("button", { name: "Close More navigation", exact: true })
    .click();
  await expect(opened.dialog).toBeHidden();
  await expect(opened.trigger).toBeFocused();

  opened = await openMore(page);
  const overlay = opened.dialog.locator("..");
  await overlay.click({ position: { x: 4, y: 4 } });
  await expect(opened.dialog).toBeHidden();
  await expect(opened.trigger).toBeFocused();

  opened = await openMore(page);
  await opened.dialog.getByRole("link", { name: "Community" }).click();
  await expect(opened.dialog).toBeHidden();
  await expect(opened.trigger).toBeFocused();
});

test("does not dismiss from panel clicks and does not force focus after navigation", async ({
  page,
}) => {
  await openCommunity(page);
  const { dialog } = await openMore(page);
  await dialog.locator("h2").click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("link", { name: "Video Library" }).click();
  await page.waitForURL(/\/app\/video-library$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More", exact: true })).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("A");
});

test("locks only the AppShell scroller and preserves wheel and touch position", async ({
  page,
}) => {
  await openCommunity(page, viewports[viewports.length - 1]);
  const scroller = page.locator("#workspace-main-content").locator("..");
  await scroller.evaluate((element) => {
    element.scrollTop = 300;
  });
  const { dialog } = await openMore(page);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
  expect(await scroller.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
    "hidden",
  );

  const panelScroller = dialog.locator("div.overflow-y-auto").first();
  const panelScrollRange = await panelScroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(panelScrollRange.scrollHeight).toBeGreaterThan(panelScrollRange.clientHeight);
  const panelBox = await panelScroller.boundingBox();
  if (!panelBox) throw new Error("Panel scroller has no box.");
  const wheelPoint = {
    x: panelBox.x + panelBox.width / 2,
    y: panelBox.y + panelBox.height / 2,
  };
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, 700);
  await expect
    .poll(() => panelScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
  await panelScroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  const box = await panelScroller.boundingBox();
  if (!box) throw new Error("Panel scroller has no box.");
  await touchSwipe(
    page,
    box.x + box.width / 2,
    box.y + box.height - 30,
    box.y + 60,
  );
  await expect
    .poll(() => panelScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);

  await page.mouse.move(4, 4);
  await page.mouse.wheel(0, 600);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
  await touchSwipe(page, 5, 150, 600);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page
    .getByRole("button", { name: "Close More navigation", exact: true })
    .click();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
  expect(await scroller.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
    "auto",
  );
});

test("is bounded and touch-safe across the required responsive matrix", async ({
  page,
}) => {
  for (const viewport of viewports) {
    await openCommunity(page, viewport);
    const { dialog } = await openMore(page);
    const result = await page.evaluate(() => {
      const rect = (element: Element | null) => element?.getBoundingClientRect() ?? null;
      const panel = document.querySelector('[role="dialog"]');
      const more = document.querySelector<HTMLButtonElement>(
        'button[aria-controls="mobile-more-navigation"]',
      );
      const close = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Close More navigation"]',
      );
      const link = panel?.querySelector("a");
      const scroller = panel?.querySelector("div.overflow-y-auto");
      return {
        closeHeight: rect(close)?.height ?? 0,
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        linkHeight: rect(link ?? null)?.height ?? 0,
        moreHeight: rect(more)?.height ?? 0,
        panel: rect(panel)
          ? {
              bottom: rect(panel)!.bottom,
              left: rect(panel)!.left,
              right: rect(panel)!.right,
              top: rect(panel)!.top,
            }
          : null,
        scrollerOverflow: scroller ? getComputedStyle(scroller).overflowY : null,
      };
    });
    expect(result.horizontalOverflow, viewport.name).toBe(false);
    expect(result.panel, viewport.name).not.toBeNull();
    expect(result.panel!.left, viewport.name).toBeGreaterThanOrEqual(12);
    expect(result.panel!.right, viewport.name).toBeLessThanOrEqual(viewport.width - 12);
    expect(result.panel!.top, viewport.name).toBeGreaterThan(0);
    expect(result.panel!.bottom, viewport.name).toBeLessThan(viewport.height);
    expect(result.scrollerOverflow, viewport.name).toBe("auto");
    expect(result.moreHeight, viewport.name).toBeGreaterThanOrEqual(44);
    expect(result.closeHeight, viewport.name).toBeGreaterThanOrEqual(44);
    expect(result.linkHeight, viewport.name).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("adds synthetic safe areas without overflow or panel/navigation collision", async ({
  page,
}) => {
  await openCommunity(page);
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".coachos-light");
    root?.style.setProperty("--ui-safe-area-top", "17px");
    root?.style.setProperty("--ui-safe-area-right", "13px");
    root?.style.setProperty("--ui-safe-area-bottom", "21px");
    root?.style.setProperty("--ui-safe-area-left", "11px");
  });
  const { dialog } = await openMore(page);
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
    const nav = document
      .querySelector('nav[aria-label="Workspace navigation"].fixed')!
      .getBoundingClientRect();
    return {
      bottomOffset: innerHeight - panel.bottom,
      gapAboveNav: nav.top - panel.bottom,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      left: panel.left,
      rightGap: innerWidth - panel.right,
      top: panel.top,
    };
  });
  expect(geometry.left).toBe(23);
  expect(geometry.rightGap).toBe(25);
  expect(geometry.bottomOffset).toBe(117);
  expect(geometry.top).toBeGreaterThanOrEqual(17);
  expect(geometry.gapAboveNav).toBeGreaterThan(0);
  expect(geometry.horizontalOverflow).toBe(false);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("closes cleanly at lg without focus restoration or stale modal state", async ({
  page,
}) => {
  await openCommunity(page, viewports[viewports.length - 1]);
  const scroller = page.locator("#workspace-main-content").locator("..");
  await scroller.evaluate((element) => {
    element.scrollTop = 300;
  });
  await openMore(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector(".coachos-light");
        const frame = Array.from(root?.children ?? []).find((element) =>
          element.querySelector("aside.coachos-sidebar"),
        );
        return frame?.hasAttribute("inert") ?? null;
      }),
    )
    .toBe(false);
  await expect
    .poll(() => scroller.evaluate((element) => getComputedStyle(element).overflowY))
    .toBe("auto");
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(300);
  await expect(page.locator("aside.coachos-sidebar")).toBeVisible();
  await expect(
    page.locator('nav[aria-label="Workspace navigation"].fixed'),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        document.activeElement ===
        document.querySelector('button[aria-controls="mobile-more-navigation"]'),
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 1023, height: 768 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
