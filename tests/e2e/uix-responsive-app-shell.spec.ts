import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const root = process.cwd();
const shellPath = join(root, "src", "components", "layout", "AppShell.tsx");
const portalPath = join(
  root,
  "src",
  "components",
  "portal",
  "StudentPortalLayout.tsx",
);
const globalsPath = join(root, "app", "globals.css");
const shellSource = readFileSync(shellPath, "utf8");
const portalSource = readFileSync(portalPath, "utf8");
const globalsSource = readFileSync(globalsPath, "utf8");

const shellClasses = {
  root:
    "coachos-light h-[var(--ui-viewport-height)] overflow-hidden text-[#0B2A3D]",
  frame: "relative flex h-full overflow-hidden",
  sidebar:
    "coachos-sidebar hidden h-full w-72 shrink-0 overflow-y-auto border-r border-[#2ECBEA]/15 bg-[#0B2A3D] px-4 py-5 text-white shadow-lg shadow-[#0B2A3D]/10 lg:block",
  scroller:
    "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-[calc(6rem+var(--ui-safe-area-bottom))] lg:pb-0",
  header:
    "sticky top-0 z-20 border-b border-[#D8E8F0] bg-white/90 pt-[var(--ui-safe-area-top)] text-[#0B2A3D] shadow-sm shadow-[#0B2A3D]/5 backdrop-blur-xl",
  headerInner:
    "flex h-18 min-h-18 items-center justify-between gap-3 pb-3 pl-[calc(1.25rem+var(--ui-safe-area-left))] pr-[calc(1.25rem+var(--ui-safe-area-right))] pt-3 sm:pl-[calc(1.5rem+var(--ui-safe-area-left))] sm:pr-[calc(1.5rem+var(--ui-safe-area-right))] lg:pl-[calc(2rem+var(--ui-safe-area-left))] lg:pr-[calc(2rem+var(--ui-safe-area-right))]",
  main:
    "coachos-content flex-1 scroll-mt-[calc(4.5rem+var(--ui-safe-area-top))] pb-6 pl-[calc(1.25rem+var(--ui-safe-area-left))] pr-[calc(1.25rem+var(--ui-safe-area-right))] pt-6 sm:pl-[calc(1.5rem+var(--ui-safe-area-left))] sm:pr-[calc(1.5rem+var(--ui-safe-area-right))] lg:pb-8 lg:pl-[calc(2rem+var(--ui-safe-area-left))] lg:pr-[calc(2rem+var(--ui-safe-area-right))] lg:pt-8",
  bottomNav:
    "fixed inset-x-0 bottom-0 z-40 border-t border-[#D8E8F0] bg-white/95 pb-[calc(0.75rem+var(--ui-safe-area-bottom))] pl-[calc(0.75rem+var(--ui-safe-area-left))] pr-[calc(0.75rem+var(--ui-safe-area-right))] pt-3 shadow-2xl shadow-[#0B2A3D]/10 backdrop-blur-xl lg:hidden",
  skip:
    "fixed left-[calc(1rem+var(--ui-safe-area-left))] top-[calc(1rem+var(--ui-safe-area-top))] z-50 -translate-y-[calc(100%+3rem)] rounded-ui border border-line bg-surface px-4 py-3 text-sm font-semibold text-content-primary shadow-overlay transition-transform focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
} as const;

const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "1023x768", width: 1023, height: 768 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

const syntheticInsets = {
  bottom: 21,
  left: 11,
  right: 13,
  top: 17,
} as const;

type Insets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    return statSync(absolute).isDirectory() ? listFiles(absolute) : [absolute];
  });
}

function appShellRoutePages() {
  return listFiles(join(root, "app", "app"))
    .filter((path) => path.endsWith("page.tsx"))
    .filter((path) => readFileSync(path, "utf8").includes("<AppShell"))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .sort();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function shellMarkup(insets: Insets, viewportHeight?: "100vh") {
  const rootStyle = [
    `--ui-safe-area-top:${insets.top}px`,
    `--ui-safe-area-right:${insets.right}px`,
    `--ui-safe-area-bottom:${insets.bottom}px`,
    `--ui-safe-area-left:${insets.left}px`,
    viewportHeight ? `--ui-viewport-height:${viewportHeight}` : "",
  ]
    .filter(Boolean)
    .join(";");

  return `
    <div id="shell-root" class="${escapeHtml(shellClasses.root)}" style="${rootStyle}">
      <a id="skip-link" class="${escapeHtml(shellClasses.skip)}" href="#workspace-main-content">Skip to main content</a>
      <div class="pointer-events-none fixed inset-0 bg-[#F8FAFC]"></div>
      <div id="shell-frame" class="${escapeHtml(shellClasses.frame)}">
        <aside id="sidebar" class="${escapeHtml(shellClasses.sidebar)}">
          <div style="height:1800px">Sidebar navigation</div>
        </aside>
        <div id="content-scroller" class="${escapeHtml(shellClasses.scroller)}">
          <header id="team-header" class="${escapeHtml(shellClasses.header)}">
            <div id="header-inner" class="${escapeHtml(shellClasses.headerInner)}">
              <strong>CoachFort Regression 2026</strong>
              <button style="height:44px;width:44px" type="button">Alerts</button>
            </div>
          </header>
          <main id="workspace-main-content" tabindex="-1" class="${escapeHtml(shellClasses.main)}">
            <h1>Dashboard</h1>
            <div style="height:1600px">Long team page content</div>
            <button id="last-content-control" type="button">Last content control</button>
          </main>
        </div>
        <nav id="mobile-nav" aria-label="Workspace navigation" class="${escapeHtml(shellClasses.bottomNav)}">
          <div class="grid grid-cols-5 gap-1">
            ${["Home", "Programs", "Students", "Enroll", "More"]
              .map(
                (label) => `<button class="flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium" type="button"><span class="text-[10px] font-bold">N</span><span class="max-w-full truncate">${label}</span></button>`,
              )
              .join("")}
          </div>
        </nav>
      </div>
    </div>`;
}

let productCssPromise: Promise<{ css: string; dependencies: string[] }> | undefined;

function productCss() {
  productCssPromise ??= postcss([tailwindcss()])
    .process(globalsSource, { from: globalsPath })
    .then((result) => ({
      css: result.css,
      dependencies: result.messages.flatMap((message) =>
        "file" in message && typeof message.file === "string" ? [message.file] : [],
      ),
    }));
  return productCssPromise;
}

async function setShell(
  page: Page,
  insets: Insets,
  viewportHeight?: "100vh",
) {
  const { css } = await productCss();
  await page.setContent(`<style>${css}</style>${shellMarkup(insets, viewportHeight)}`);
}

async function measureShell(page: Page) {
  return page.evaluate(() => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const rect = (element: Element | null) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        bottom: rounded(value.bottom),
        height: rounded(value.height),
        left: rounded(value.left),
        right: rounded(value.right),
        top: rounded(value.top),
        width: rounded(value.width),
      };
    };
    const root = document.getElementById("shell-root");
    const sidebar = document.getElementById("sidebar");
    const scroller = document.getElementById("content-scroller");
    const header = document.getElementById("team-header");
    const headerInner = document.getElementById("header-inner");
    const main = document.getElementById("workspace-main-content");
    const nav = document.getElementById("mobile-nav");
    const navItem = nav?.querySelector("button") ?? null;
    const lastControl = document.getElementById("last-content-control");
    const style = (element: Element | null) =>
      element ? getComputedStyle(element) : null;
    const visible = (element: Element | null) =>
      Boolean(element && style(element)?.display !== "none");

    scroller?.scrollTo({ top: 360 });
    const stickyDelta =
      header && scroller
        ? rounded(header.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
        : null;
    const scrollerScrollTop = scroller?.scrollTop ?? null;

    let endClearance: number | null = null;
    if (scroller && nav && lastControl && visible(nav)) {
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      endClearance = rounded(
        nav.getBoundingClientRect().top - lastControl.getBoundingClientRect().bottom,
      );
    }
    if (scroller) scroller.scrollTop = 0;

    return {
      bodyHeight: document.body.scrollHeight,
      contentBottom: style(scroller)?.paddingBottom ?? null,
      contentClientHeight: scroller?.clientHeight ?? null,
      contentScrollHeight: scroller?.scrollHeight ?? null,
      endClearance,
      headerHeight: rect(header)?.height ?? null,
      headerPaddingTop: style(header)?.paddingTop ?? null,
      headerLeft: style(headerInner)?.paddingLeft ?? null,
      headerRight: style(headerInner)?.paddingRight ?? null,
      htmlHeight: document.documentElement.scrollHeight,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      mainLeft: style(main)?.paddingLeft ?? null,
      mainRight: style(main)?.paddingRight ?? null,
      navHeight: rect(nav)?.height ?? null,
      navItemHeight: rect(navItem)?.height ?? null,
      navPaddingBottom: style(nav)?.paddingBottom ?? null,
      navVisible: visible(nav),
      rootHeight: rect(root)?.height ?? null,
      scrollerScrollTop,
      sidebarVisible: visible(sidebar),
      sidebarWidth: rect(sidebar)?.width ?? null,
      stickyDelta,
      viewportHeight: window.innerHeight,
      viewportVariable: style(root)?.getPropertyValue("--ui-viewport-height").trim(),
      windowScrollY: window.scrollY,
    };
  });
}

test.describe("UIX-1D2A responsive AppShell", () => {
  test("uses the exact viewport frame and one canonical content scroller", () => {
    expect(shellSource).toContain(`className="${shellClasses.root}"`);
    expect(shellSource).toContain(`className="${shellClasses.frame}"`);
    expect(shellSource).toContain(`className="${shellClasses.sidebar}"`);
    expect(shellSource).toContain(`className="${shellClasses.scroller}"`);
    expect(shellSource).not.toContain("h-screen");
    expect(shellClasses.scroller).toContain("min-h-0");
    expect(shellClasses.scroller).toContain("overflow-y-auto");
    expect(shellClasses.frame).toContain("overflow-hidden");
  });

  test("applies safe areas only at the reviewed header and content boundaries", () => {
    expect(shellSource).toContain(`className="${shellClasses.header}"`);
    expect(shellSource).toContain(`className="${shellClasses.headerInner}"`);
    expect(shellSource).toContain(`className="${shellClasses.main}"`);
    expect(shellClasses.headerInner).not.toMatch(/(?:^|\s)(?:sm:|lg:)?px-/);
    expect(shellClasses.main).not.toMatch(/(?:^|\s)(?:sm:|lg:)?px-/);
    expect(shellSource.match(/pt-\[var\(--ui-safe-area-top\)\]/g)).toHaveLength(1);
  });

  test("adds the exact skip target and labelled native mobile navigation", () => {
    expect(shellSource).toContain(`className="${shellClasses.skip}"`);
    expect(shellSource).toContain('href="#workspace-main-content"');
    expect(shellSource).toContain("Skip to main content");
    expect(shellSource).toContain('id="workspace-main-content"');
    expect(shellSource).toContain("tabIndex={-1}");
    expect(shellSource).toContain('aria-label="Workspace navigation"');
    expect(shellSource).not.toContain('role="navigation"');
    expect(shellSource.indexOf("Skip to main content")).toBeLessThan(
      shellSource.indexOf('<nav aria-label="Workspace navigation"'),
    );
  });

  test("keeps More behavior and Student Portal mechanics outside D2A", () => {
    const moreStart = shellSource.indexOf("{mobileMoreOpen ? (");
    const moreEnd = shellSource.indexOf("<nav", moreStart);
    const moreBlock = shellSource.slice(moreStart, moreEnd);

    expect(moreStart).toBeGreaterThan(0);
    expect(moreBlock).toContain('aria-label="More workspace navigation"');
    expect(moreBlock).toContain('onClick={() => setMobileMoreOpen(false)}');
    expect(moreBlock).not.toContain('role="dialog"');
    expect(moreBlock).not.toContain("aria-modal");
    expect(moreBlock).not.toContain("onKeyDown");
    expect(moreBlock).not.toContain("inert");

    for (const marker of [
      "workspace-main-content",
      "ui-viewport-height",
      "ui-safe-area-top",
      "ui-safe-area-bottom",
    ]) {
      expect(portalSource).not.toContain(marker);
    }
  });

  test("retains exactly 48 AppShell route consumers", () => {
    const routes = appShellRoutePages();
    expect(routes).toHaveLength(48);
    expect(routes).toContain("app/app/page.tsx");
    expect(routes).toContain("app/app/courses/page.tsx");
    expect(routes).toContain("app/app/settings/page.tsx");
    expect(routes).toContain("app/app/video-library/page.tsx");
  });

  test("compiles every final class through product-only Tailwind discovery", async () => {
    const { css, dependencies } = await productCss();

    expect(globalsSource).toContain('@import "tailwindcss" source(none);');
    expect(globalsSource).toContain('@source "../app";');
    expect(globalsSource).toContain('@source "../src";');
    expect(globalsSource).not.toContain('@source "../tests";');
    expect(globalsSource).not.toContain('@source "../support-ops";');
    expect(dependencies.some((path) => path.endsWith("AppShell.tsx"))).toBe(true);
    expect(dependencies.every((path) => !path.includes("support-ops"))).toBe(true);
    expect(dependencies.every((path) => !path.includes(`${join(root, "tests")}`))).toBe(
      true,
    );

    for (const declaration of [
      "height: var(--ui-viewport-height)",
      "padding-top: var(--ui-safe-area-top)",
      "padding-left: calc(1.25rem + var(--ui-safe-area-left))",
      "padding-right: calc(1.25rem + var(--ui-safe-area-right))",
      "padding-left: calc(1.5rem + var(--ui-safe-area-left))",
      "padding-right: calc(1.5rem + var(--ui-safe-area-right))",
      "padding-left: calc(2rem + var(--ui-safe-area-left))",
      "padding-right: calc(2rem + var(--ui-safe-area-right))",
      "padding-bottom: calc(6rem + var(--ui-safe-area-bottom))",
      "padding-bottom: calc(0.75rem + var(--ui-safe-area-bottom))",
      "scroll-margin-top: calc(4.5rem + var(--ui-safe-area-top))",
    ]) {
      expect(css, declaration).toContain(declaration);
    }
  });

  test("preserves exact zero-inset geometry across the responsive matrix", async ({
    page,
  }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await setShell(page, { bottom: 0, left: 0, right: 0, top: 0 });
      const result = await measureShell(page);
      const desktop = viewport.width >= 1024;
      const gutter = viewport.width >= 1024 ? "32px" : viewport.width >= 640 ? "24px" : "20px";

      expect(result.rootHeight, viewport.name).toBe(viewport.height);
      expect(result.htmlHeight, viewport.name).toBe(viewport.height);
      expect(result.bodyHeight, viewport.name).toBe(viewport.height);
      expect(result.windowScrollY, viewport.name).toBe(0);
      expect(result.horizontalOverflow, viewport.name).toBe(false);
      expect(result.mainLeft, viewport.name).toBe(gutter);
      expect(result.mainRight, viewport.name).toBe(gutter);
      expect(result.headerLeft, viewport.name).toBe(gutter);
      expect(result.headerRight, viewport.name).toBe(gutter);
      expect(result.headerHeight, viewport.name).toBe(73);
      expect(result.headerPaddingTop, viewport.name).toBe("0px");
      expect(result.sidebarVisible, viewport.name).toBe(desktop);
      expect(result.navVisible, viewport.name).toBe(!desktop);
      expect(result.contentBottom, viewport.name).toBe(desktop ? "0px" : "96px");
      expect(result.stickyDelta, viewport.name).toBe(0);
      expect(result.scrollerScrollTop, viewport.name).toBe(360);
      expect(result.contentScrollHeight, viewport.name).toBeGreaterThan(
        result.contentClientHeight ?? 0,
      );
      if (desktop) {
        expect(result.sidebarWidth, viewport.name).toBe(288);
        expect(result.navHeight, viewport.name).toBe(0);
      } else {
        expect(result.navHeight, viewport.name).toBe(76.5);
        expect(result.navItemHeight, viewport.name).toBe(51.5);
        expect(result.endClearance, viewport.name).toBeGreaterThan(0);
      }
    }
  });

  test("adds synthetic safe areas without replacing baseline spacing", async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await setShell(page, syntheticInsets);
      const result = await measureShell(page);
      const desktop = viewport.width >= 1024;
      const expectedLeft = viewport.width >= 1024 ? "43px" : viewport.width >= 640 ? "35px" : "31px";
      const expectedRight = viewport.width >= 1024 ? "45px" : viewport.width >= 640 ? "37px" : "33px";

      expect(result.rootHeight, viewport.name).toBe(viewport.height);
      expect(result.htmlHeight, viewport.name).toBe(viewport.height);
      expect(result.bodyHeight, viewport.name).toBe(viewport.height);
      expect(result.mainLeft, viewport.name).toBe(expectedLeft);
      expect(result.mainRight, viewport.name).toBe(expectedRight);
      expect(result.headerLeft, viewport.name).toBe(expectedLeft);
      expect(result.headerRight, viewport.name).toBe(expectedRight);
      expect(result.headerPaddingTop, viewport.name).toBe("17px");
      expect(result.headerHeight, viewport.name).toBe(90);
      expect(result.contentBottom, viewport.name).toBe(desktop ? "0px" : "117px");
      expect(result.horizontalOverflow, viewport.name).toBe(false);
      expect(result.stickyDelta, viewport.name).toBe(0);
      if (!desktop) {
        expect(result.navHeight, viewport.name).toBe(97.5);
        expect(result.navItemHeight, viewport.name).toBe(51.5);
        expect(result.navPaddingBottom, viewport.name).toBe("33px");
        expect(result.endClearance, viewport.name).toBeGreaterThan(0);
      }
    }
  });

  test("uses dvh when supported and preserves the vh fallback", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setShell(page, { bottom: 0, left: 0, right: 0, top: 0 });
    const dynamic = await measureShell(page);
    const supportsDvh = await page.evaluate(() => CSS.supports("height", "100dvh"));

    expect(supportsDvh).toBe(true);
    expect(dynamic.viewportVariable).toBe("100dvh");
    expect(dynamic.rootHeight).toBe(844);

    await setShell(
      page,
      { bottom: 0, left: 0, right: 0, top: 0 },
      "100vh",
    );
    const fallback = await measureShell(page);
    expect(fallback.viewportVariable).toBe("100vh");
    expect(fallback.rootHeight).toBe(844);
    expect(fallback.htmlHeight).toBe(844);
    expect(fallback.bodyHeight).toBe(844);
  });

  test("keeps sidebar and content scrolling independent at 1024x768", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await setShell(page, syntheticInsets);
    const result = await page.evaluate(() => {
      const sidebar = document.getElementById("sidebar");
      const scroller = document.getElementById("content-scroller");
      if (!sidebar || !scroller) throw new Error("Missing shell scroll containers.");
      sidebar.scrollTop = 180;
      scroller.scrollTop = 360;
      const first = { content: scroller.scrollTop, sidebar: sidebar.scrollTop };
      scroller.scrollTop = 520;
      return {
        first,
        second: { content: scroller.scrollTop, sidebar: sidebar.scrollTop },
      };
    });

    expect(result.first).toEqual({ content: 360, sidebar: 180 });
    expect(result.second).toEqual({ content: 520, sidebar: 180 });
  });

  test("switches exactly from bottom navigation to the 288px sidebar at lg", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1023, height: 768 });
    await setShell(page, { bottom: 0, left: 0, right: 0, top: 0 });
    const below = await measureShell(page);
    expect(below.sidebarVisible).toBe(false);
    expect(below.navVisible).toBe(true);
    expect(below.mainLeft).toBe("24px");
    expect(below.contentBottom).toBe("96px");
    expect(below.horizontalOverflow).toBe(false);

    await page.setViewportSize({ width: 1024, height: 768 });
    const above = await measureShell(page);
    expect(above.sidebarVisible).toBe(true);
    expect(above.sidebarWidth).toBe(288);
    expect(above.navVisible).toBe(false);
    expect(above.mainLeft).toBe("32px");
    expect(above.contentBottom).toBe("0px");
    expect(above.horizontalOverflow).toBe(false);
  });

  test("makes skip navigation the first focus target at zero and synthetic insets", async ({
    page,
  }) => {
    for (const insets of [
      { bottom: 0, left: 0, right: 0, top: 0 },
      syntheticInsets,
    ]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await setShell(page, insets);
      const before = await page.locator("#skip-link").boundingBox();
      expect(before?.y).toBeLessThan(0);
      expect((before?.y ?? 0) + (before?.height ?? 0)).toBeLessThanOrEqual(0);

      await page.evaluate(() => {
        history.replaceState(null, "", location.href.split("#")[0]);
        document.body.tabIndex = -1;
        document.body.focus();
      });
      await expect(page.locator("body")).toBeFocused();
      await page.keyboard.press("Tab");
      await page.waitForTimeout(250);
      await expect(page.locator("#skip-link")).toBeFocused();
      const focused = await page.locator("#skip-link").boundingBox();
      expect(focused?.x).toBeGreaterThanOrEqual(0);
      expect(focused?.y).toBeGreaterThanOrEqual(0);
      expect((focused?.x ?? 0) + (focused?.width ?? 0)).toBeLessThanOrEqual(390);
      expect((focused?.y ?? 0) + (focused?.height ?? 0)).toBeLessThanOrEqual(844);

      await page.keyboard.press("Enter");
      await expect(page.locator("#workspace-main-content")).toBeFocused();
      expect(await page.evaluate(() => location.hash)).toBe("#workspace-main-content");
      const position = await page.evaluate(() => ({
        mainTop: document
          .getElementById("workspace-main-content")
          ?.getBoundingClientRect().top,
        scrollerTop: document
          .getElementById("content-scroller")
          ?.getBoundingClientRect().top,
      }));
      expect(position.mainTop).toBeGreaterThan(position.scrollerTop ?? -1);
    }
  });
});
