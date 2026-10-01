import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, relative } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { createElement, type ReactElement } from "react";
import ts from "typescript";

import { Card } from "../../src/components/ui/Card";
import { StatCard } from "../../src/components/ui/StatCard";
import { TableShell } from "../../src/components/ui/TableShell";

const root = process.cwd();
const globalsPath = join(root, "app", "globals.css");
const cardPath = join(root, "src", "components", "ui", "Card.tsx");
const statCardPath = join(root, "src", "components", "ui", "StatCard.tsx");
const tableShellPath = join(root, "src", "components", "ui", "TableShell.tsx");
const screenshotDirectory = join(
  root,
  "support-ops",
  "uix-1e3b1-screenshots",
);

const globalsSource = readFileSync(globalsPath, "utf8");
const cardSource = readFileSync(cardPath, "utf8");
const statCardSource = readFileSync(statCardPath, "utf8");
const tableShellSource = readFileSync(tableShellPath, "utf8");

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

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", ".next", "node_modules", "support-ops"].includes(entry.name)) {
      return [];
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

type AttributeValue = {
  kind: "absent" | "boolean" | "dynamic" | "string";
  source: string;
};

type CardUse = {
  file: string;
  interactive: AttributeValue;
  padding: AttributeValue;
  variant: AttributeValue;
};

function attributeValue(
  node: ts.JsxOpeningLikeElement,
  name: string,
  sourceFile: ts.SourceFile,
): AttributeValue {
  const property = node.attributes.properties.find(
    (candidate) =>
      ts.isJsxAttribute(candidate) && candidate.name.getText(sourceFile) === name,
  );
  if (!property || !ts.isJsxAttribute(property)) {
    return { kind: "absent", source: "" };
  }
  if (!property.initializer) return { kind: "boolean", source: "true" };
  if (ts.isStringLiteral(property.initializer)) {
    return { kind: "string", source: property.initializer.text };
  }
  if (ts.isJsxExpression(property.initializer)) {
    const expression = property.initializer.expression;
    if (!expression) return { kind: "dynamic", source: "" };
    if (ts.isStringLiteral(expression)) {
      return { kind: "string", source: expression.text };
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) {
      return { kind: "boolean", source: "true" };
    }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) {
      return { kind: "boolean", source: "false" };
    }
    return { kind: "dynamic", source: expression.getText(sourceFile) };
  }
  return { kind: "dynamic", source: property.initializer.getText(sourceFile) };
}

function cardInventory() {
  const uses: CardUse[] = [];
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
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      const opening = ts.isJsxElement(node)
        ? node.openingElement
        : ts.isJsxSelfClosingElement(node)
          ? node
          : null;
      if (opening?.tagName.getText(sourceFile) === "Card") {
        uses.push({
          file: relative(root, file).replaceAll("\\", "/"),
          interactive: attributeValue(opening, "interactive", sourceFile),
          padding: attributeValue(opening, "padding", sourceFile),
          variant: attributeValue(opening, "variant", sourceFile),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return uses;
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

function renderCard(
  props: Omit<Parameters<typeof Card>[0], "children"> & { children?: unknown },
) {
  return serializeElement(
    Card({
      children: props.children ?? "Card content",
      ...props,
    } as Parameters<typeof Card>[0]),
  );
}

async function setProductContent(page: Page, markup: string) {
  const { css } = await compiledProductCss();
  await page.setContent(
    `<style>${css}</style><main style="box-sizing:border-box;margin:0 auto;max-width:1200px;padding:24px">${markup}</main>`,
  );
}

type ComputedSurface = {
  backgroundColor: string;
  borderColor: string;
  borderRadius: string;
  borderWidth: string;
  boxShadow: string;
  color: string;
  hasVisibleShadow: boolean;
  padding: string;
  scale: string;
  transform: string;
  transitionDuration: string;
  transitionProperty: string;
  translate: string;
};

function hasVisibleShadow(boxShadow: string) {
  if (boxShadow === "none") return false;
  const colors = boxShadow.match(/(?:rgba|oklab)\([^)]*\)/g) ?? [];
  return colors.some(
    (color) =>
      color !== "rgba(0, 0, 0, 0)" &&
      !/\/\s*0(?:\.0+)?\)$/.test(color),
  );
}

async function computedSurface(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    const boxShadow = style.boxShadow;
    const colors = boxShadow.match(/(?:rgba|oklab)\([^)]*\)/g) ?? [];
    const visibleShadow =
      boxShadow !== "none" &&
      colors.some(
        (color) =>
          color !== "rgba(0, 0, 0, 0)" &&
          !/\/\s*0(?:\.0+)?\)$/.test(color),
      );
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      boxShadow,
      color: style.color,
      hasVisibleShadow: visibleShadow,
      padding: style.padding,
      scale: style.scale,
      transform: style.transform,
      transitionDuration: style.transitionDuration,
      transitionProperty: style.transitionProperty,
      translate: style.translate,
    } satisfies ComputedSurface;
  });
}

function actualComponentHarness() {
  const ordinaryContent = createElement(
    "div",
    { className: "space-y-2" },
    createElement("h3", { className: "text-base font-semibold" }, "Operational summary"),
    createElement(
      "p",
      { className: "text-sm text-content-secondary" },
      "Ordinary supporting content remains contained without decorative elevation.",
    ),
  );
  const table = createElement(
    "table",
    { className: "w-full text-left text-sm" },
    createElement(
      "thead",
      null,
      createElement(
        "tr",
        null,
        createElement("th", { className: "p-3" }, "Student"),
        createElement("th", { className: "p-3" }, "Status"),
      ),
    ),
    createElement(
      "tbody",
      null,
      createElement(
        "tr",
        null,
        createElement("td", { className: "p-3" }, "Regression Student"),
        createElement("td", { className: "p-3" }, "Active"),
      ),
    ),
  );

  const cases = [
    renderCard({ className: "proof-default", padding: "md", children: ordinaryContent }),
    renderCard({ className: "proof-subtle", padding: "md", variant: "subtle", children: ordinaryContent }),
    renderCard({ className: "proof-elevated", padding: "md", variant: "elevated", children: "Elevated compatibility" }),
    renderCard({ className: "proof-glass", padding: "md", variant: "glass", children: "Glass compatibility" }),
    renderCard({ className: "proof-dark", padding: "md", variant: "dark", children: "Dark compatibility" }),
    renderCard({ className: "proof-interactive", interactive: true, padding: "md", children: ordinaryContent }),
    renderCard({ className: "proof-none", padding: "none", children: createElement("div", { className: "bg-surface-subtle p-2" }, "none") }),
    renderCard({ className: "proof-sm", padding: "sm", children: "small padding" }),
    renderCard({ className: "proof-md", padding: "md", children: "medium padding" }),
    renderCard({ className: "proof-lg", padding: "lg", children: "large padding" }),
    renderCard({
      className: "proof-form",
      padding: "md",
      children: createElement(
        "form",
        { className: "space-y-3" },
        createElement("label", { htmlFor: "name" }, "Workspace name"),
        createElement("input", {
          className: "w-full rounded-ui border border-line bg-surface px-3 py-2",
          id: "name",
          readOnly: true,
          value: "CoachFort Regression 2026",
        }),
      ),
    }),
    serializeElement(
      StatCard({
        className: "proof-stat-short",
        label: "Students",
        value: "100",
      }),
    ),
    serializeElement(
      StatCard({
        className: "proof-stat-long",
        description:
          "Student payments recorded by your workspace during the current reporting period.",
        label: "Recorded student revenue",
        status: createElement(
          "span",
          { className: "text-status-success" },
          "Clear",
        ),
        value: "INR 5,99,999.00",
      }),
    ),
    serializeElement(
      TableShell({
        children: table,
        className: "proof-table-shell",
        description: "Current students in this workspace.",
        title: "Students",
      }),
    ),
  ];

  return `<div class="proof-grid">${cases
    .map(
      (markup, index) =>
        `<section class="proof-case" data-case="${index}">${markup}</section>`,
    )
    .join("")}</div><style>
      .proof-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
      .proof-case{min-width:0}
      @media(max-width:767px){.proof-grid{grid-template-columns:minmax(0,1fr)}}
    </style>`;
}

test.describe("UIX-1E3B1 Card primitive contract", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.beforeAll(() => {
    rmSync(screenshotDirectory, { force: true, recursive: true });
    mkdirSync(screenshotDirectory, { recursive: true });
  });

  test("preserves the exact API, defaults, server boundary, and div semantics", () => {
    expect(cardSource).toContain(`type CardProps = {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  padding?: "lg" | "md" | "none" | "sm";
  variant?: "dark" | "default" | "elevated" | "glass" | "subtle";
} & React.HTMLAttributes<HTMLDivElement>;`);
    expect(cardSource).toContain('className = ""');
    expect(cardSource).toContain("interactive = false");
    expect(cardSource).toContain('padding = "none"');
    expect(cardSource).toContain('variant = "default"');
    expect(cardSource).not.toContain('"use client"');
    expect(cardSource).not.toMatch(/\buse(?:Effect|LayoutEffect|Memo|Ref|State)\b/);
    expect(cardSource).not.toContain("forwardRef");

    const element = Card({ children: "Content", interactive: true }) as ReactElement<
      Record<string, unknown>
    >;
    expect(element.type).toBe("div");
    expect(element.props.role).toBeUndefined();
    expect(element.props.tabIndex).toBeUndefined();
    expect(element.props.onKeyDown).toBeUndefined();
    expect(element.props.onClick).toBeUndefined();
  });

  test("locks the 374-call inventory, variants, padding, and zero interactive use", () => {
    const uses = cardInventory();
    expect(uses).toHaveLength(374);
    expect(new Set(uses.map((use) => use.file)).size).toBe(84);

    const variant = (value: string) =>
      uses.filter((use) => use.variant.source === value).length;
    expect(uses.filter((use) => use.variant.kind === "absent")).toHaveLength(372);
    expect(variant("default")).toBe(0);
    expect(variant("subtle")).toBe(1);
    expect(variant("elevated")).toBe(1);
    expect(variant("glass")).toBe(0);
    expect(variant("dark")).toBe(0);
    expect(uses.filter((use) => use.variant.kind === "dynamic")).toHaveLength(0);
    expect(
      uses
        .filter((use) => use.variant.kind !== "absent")
        .map((use) => use.file),
    ).toEqual([
      "src/components/billing/BillingProfilePageClient.tsx",
      "src/components/billing/BillingProfilePageClient.tsx",
    ]);

    expect(uses.filter((use) => use.padding.kind === "absent")).toHaveLength(371);
    expect(uses.filter((use) => use.padding.source === "none")).toHaveLength(0);
    expect(uses.filter((use) => use.padding.source === "sm")).toHaveLength(0);
    expect(uses.filter((use) => use.padding.source === "md")).toHaveLength(2);
    expect(uses.filter((use) => use.padding.source === "lg")).toHaveLength(1);
    expect(uses.filter((use) => use.padding.kind === "dynamic")).toHaveLength(0);
    expect(
      uses.filter(
        (use) =>
          use.interactive.kind !== "absent" && use.interactive.source !== "false",
      ),
    ).toHaveLength(0);
  });

  test("uses the frozen semantic default and subtle classes", () => {
    expect(cardSource).toContain('"rounded-ui border"');
    expect(cardSource).toContain(
      'default: "border-line bg-surface text-content-primary shadow-none"',
    );
    expect(cardSource).toContain(
      'subtle: "border-line bg-surface-subtle text-content-primary shadow-none"',
    );
    expect(cardSource).not.toContain("rounded-lg border");
    expect(cardSource).not.toContain(
      "border-[#CBD5E1] bg-white text-[#0B1F33] shadow-sm",
    );
    expect(cardSource).not.toContain(
      "border-[#CBD5E1] bg-[#F9FBFD] text-[#0B1F33]",
    );
  });

  test("preserves compatibility variants and padding byte-for-byte", () => {
    expect(cardSource).toContain(
      'dark: "border-[#1E293B] bg-[#0F172A] text-white shadow-lg shadow-slate-950/15"',
    );
    expect(cardSource).toContain(
      'elevated:\n    "border-[#CBD5E1] bg-white text-[#0B1F33] shadow-lg shadow-slate-950/10"',
    );
    expect(cardSource).toContain(
      'glass:\n    "border-[#CBD5E1] bg-white/90 text-[#0B1F33] shadow-sm shadow-slate-950/5 backdrop-blur-xl"',
    );
    expect(cardSource).toContain('lg: "p-6"');
    expect(cardSource).toContain('md: "p-5"');
    expect(cardSource).toContain('none: ""');
    expect(cardSource).toContain('sm: "p-4"');
  });

  test("uses the exact visual-only interaction mapping without lift or shadow", () => {
    expect(cardSource).toContain(
      '"transition-[background-color,border-color] duration-[var(--ui-motion-fast)] ease-[var(--ui-motion-easing)] hover:border-line-strong hover:bg-surface-subtle"',
    );
    expect(cardSource).not.toContain("hover:-translate-y");
    expect(cardSource).not.toContain("hover:shadow");
    expect(cardSource).not.toMatch(/\?\s*"transition duration-/);
  });

  test("compiles every semantic utility through app/src-only Tailwind discovery", async () => {
    const { css, dependencyFiles } = await compiledProductCss();
    for (const token of [
      "rounded-ui",
      "border-line",
      "bg-surface",
      "bg-surface-subtle",
      "text-content-primary",
      "shadow-none",
      "border-line-strong",
    ]) {
      expect(css).toMatch(new RegExp(`\\.${token}`));
    }
    expect(css).toContain("transition-duration: var(--ui-motion-fast)");
    expect(css).toContain("transition-timing-function: var(--ui-motion-easing)");
    expect(globalsSource).toContain('@source "../app";');
    expect(globalsSource).toContain('@source "../src";');
    expect(globalsSource).not.toContain("support-ops");
    expect(globalsSource).not.toContain("tests");
    expect(globalsSource).not.toContain("safelist");
    expect(dependencyFiles.some((file) => file.endsWith("Card.tsx"))).toBe(true);
  });

  test("computes the exact default and subtle visual contracts", async ({ page }) => {
    await setProductContent(
      page,
      `${renderCard({ className: "default-card" })}${renderCard({ className: "subtle-card", variant: "subtle" })}`,
    );
    const ordinary = await computedSurface(page, ".default-card");
    expect(ordinary).toMatchObject({
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgb(216, 232, 240)",
      borderRadius: "8px",
      borderWidth: "1px",
      color: "rgb(11, 31, 51)",
      hasVisibleShadow: false,
      padding: "0px",
    });
    const subtle = await computedSurface(page, ".subtle-card");
    expect(subtle).toMatchObject({
      backgroundColor: "rgb(247, 252, 255)",
      borderColor: "rgb(216, 232, 240)",
      borderRadius: "8px",
      color: "rgb(11, 31, 51)",
      hasVisibleShadow: false,
    });
  });

  test("computes unchanged elevated, glass, and dark compatibility variants", async ({
    page,
  }) => {
    await setProductContent(
      page,
      `${renderCard({ className: "elevated-card", variant: "elevated" })}${renderCard({ className: "glass-card", variant: "glass" })}${renderCard({ className: "dark-card", variant: "dark" })}`,
    );
    const elevated = await computedSurface(page, ".elevated-card");
    expect(elevated.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(elevated.borderColor).toBe("rgb(203, 213, 225)");
    expect(elevated.color).toBe("rgb(11, 31, 51)");
    expect(elevated.hasVisibleShadow).toBe(true);

    const glass = await computedSurface(page, ".glass-card");
    expect(glass.backgroundColor).not.toBe("rgb(255, 255, 255)");
    expect(glass.borderColor).toBe("rgb(203, 213, 225)");
    expect(glass.color).toBe("rgb(11, 31, 51)");
    expect(glass.hasVisibleShadow).toBe(true);
    await expect(page.locator(".glass-card")).toHaveCSS("backdrop-filter", /blur/);

    const dark = await computedSurface(page, ".dark-card");
    expect(dark.backgroundColor).toBe("rgb(15, 23, 42)");
    expect(dark.borderColor).toBe("rgb(30, 41, 59)");
    expect(dark.color).toBe("rgb(255, 255, 255)");
    expect(dark.hasVisibleShadow).toBe(true);
  });

  test("computes all padding values without adding default padding", async ({ page }) => {
    await setProductContent(
      page,
      `${renderCard({ className: "padding-none", padding: "none" })}${renderCard({ className: "padding-sm", padding: "sm" })}${renderCard({ className: "padding-md", padding: "md" })}${renderCard({ className: "padding-lg", padding: "lg" })}`,
    );
    await expect(page.locator(".padding-none")).toHaveCSS("padding", "0px");
    await expect(page.locator(".padding-sm")).toHaveCSS("padding", "16px");
    await expect(page.locator(".padding-md")).toHaveCSS("padding", "20px");
    await expect(page.locator(".padding-lg")).toHaveCSS("padding", "24px");
  });

  test("computes a no-lift, no-shadow semantic interactive hover", async ({ page }) => {
    await setProductContent(
      page,
      renderCard({ className: "interactive-card", interactive: true }),
    );
    const locator = page.locator(".interactive-card");
    await expect(locator).not.toHaveAttribute("role");
    await expect(locator).not.toHaveAttribute("tabindex");
    const before = await computedSurface(page, ".interactive-card");
    expect(before.transitionProperty).toBe("background-color, border-color");
    expect(before.transitionDuration).toBe("0.12s");
    await locator.hover();
    await page.waitForTimeout(180);
    const hovered = await computedSurface(page, ".interactive-card");
    expect(hovered.backgroundColor).toBe("rgb(247, 252, 255)");
    expect(hovered.borderColor).toBe("rgb(191, 215, 230)");
    expect(hovered.hasVisibleShadow).toBe(false);
    expect(hovered.transform).toBe("none");
    expect(hovered.translate).toBe("none");
    expect(hovered.scale).toBe("none");
  });

  test("records actual Tailwind precedence for representative caller classes", async ({
    page,
  }) => {
    const probes = [
      ["rounded-2xl", "probe-rounded-2xl"],
      ["rounded-none", "probe-rounded-none"],
      ["bg-black", "probe-bg-black"],
      ["bg-[#F7FCFF]", "probe-bg-arbitrary"],
      ["shadow-xl", "probe-shadow-xl"],
      ["shadow-surface", "probe-shadow-surface"],
      ["shadow-none", "probe-shadow-none"],
      ["border-red-500", "probe-border-red"],
    ] as const;
    await setProductContent(
      page,
      probes
        .map(([callerClass, marker]) =>
          renderCard({ className: `${marker} ${callerClass}` }),
        )
        .join(""),
    );

    expect((await computedSurface(page, ".probe-rounded-2xl")).borderRadius).toBe(
      "8px",
    );
    expect((await computedSurface(page, ".probe-rounded-none")).borderRadius).toBe(
      "8px",
    );
    expect((await computedSurface(page, ".probe-bg-black")).backgroundColor).toBe(
      "rgb(255, 255, 255)",
    );
    expect(
      (await computedSurface(page, ".probe-bg-arbitrary")).backgroundColor,
    ).toBe("rgb(255, 255, 255)");
    expect((await computedSurface(page, ".probe-shadow-xl")).hasVisibleShadow).toBe(
      true,
    );
    expect(
      (await computedSurface(page, ".probe-shadow-surface")).hasVisibleShadow,
    ).toBe(true);
    expect(
      (await computedSurface(page, ".probe-shadow-none")).hasVisibleShadow,
    ).toBe(false);
    expect((await computedSurface(page, ".probe-border-red")).borderColor).toBe(
      "rgb(216, 232, 240)",
    );
  });

  test("keeps actual TableShell structural and actual StatCard typography intact", async ({
    page,
  }) => {
    await setProductContent(page, actualComponentHarness());
    const table = await computedSurface(page, ".proof-table-shell");
    expect(table).toMatchObject({
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgb(216, 232, 240)",
      borderRadius: "8px",
      borderWidth: "1px",
      hasVisibleShadow: false,
      padding: "0px",
    });
    await expect(page.locator(".proof-table-shell")).toHaveCSS("overflow", "hidden");
    await expect(page.locator(".proof-stat-short")).toHaveCSS("padding", "20px");
    await expect(page.locator(".proof-stat-long")).toHaveCSS("padding", "20px");
    await expect(page.locator(".proof-stat-long p").nth(1)).toHaveCSS(
      "font-size",
      "30px",
    );
    expect(statCardSource).toContain("text-3xl");
    expect(tableShellSource).toContain('"overflow-hidden bg-white"');
    expect(
      await page.locator(".proof-stat-long").evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  });

  for (const viewport of [
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1024x768", width: 1024, height: 768 },
    { name: "1440x900", width: 1440, height: 900 },
  ]) {
    test(`renders the actual Card graph without overflow at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setProductContent(page, actualComponentHarness());
      await page.screenshot({
        fullPage: true,
        path: join(screenshotDirectory, `${viewport.name}.png`),
      });
      const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        document:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      }));
      expect(overflow).toEqual({ body: 0, document: 0 });
      const clipped = await page.locator("[data-case]").evaluateAll((elements) =>
        elements.filter(
          (element) =>
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1,
        ).length,
      );
      expect(clipped).toBe(0);
    });
  }

  test("keeps Card source ownership narrow", () => {
    expect(statCardSource).toContain(
      '<Card className={className} padding="md">',
    );
    expect(tableShellSource).toContain("<Card");
    expect(hasVisibleShadow("none")).toBe(false);
    expect(hasVisibleShadow("rgba(0, 0, 0, 0) 0px 0px 0px")).toBe(false);
    expect(hasVisibleShadow("rgba(0, 0, 0, 0.1) 0px 1px 2px")).toBe(true);
  });
});
