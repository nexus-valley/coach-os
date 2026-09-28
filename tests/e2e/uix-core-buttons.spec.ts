import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { createElement, type ReactElement } from "react";

import { Button, type ButtonProps } from "../../src/components/ui/Button";
import { IconButton } from "../../src/components/ui/IconButton";
import {
  buttonControlClasses,
  buttonVariantClasses,
  type ButtonVariant,
} from "../../src/components/ui/buttonStyles";

const root = process.cwd();
const buttonPath = join(root, "src", "components", "ui", "Button.tsx");
const iconButtonPath = join(root, "src", "components", "ui", "IconButton.tsx");
const stylesPath = join(root, "src", "components", "ui", "buttonStyles.ts");
const globalsPath = join(root, "app", "globals.css");

const buttonSource = readFileSync(buttonPath, "utf8");
const iconButtonSource = readFileSync(iconButtonPath, "utf8");
const stylesSource = readFileSync(stylesPath, "utf8");
const globalsSource = readFileSync(globalsPath, "utf8");

const variants: ButtonVariant[] = [
  "destructive",
  "ghost",
  "outline",
  "premium",
  "primary",
  "secondary",
  "success",
];

const expectedVariantClasses: Record<ButtonVariant, string> = {
  destructive:
    "border border-status-danger bg-status-danger text-content-inverse hover:brightness-95 focus-visible:outline-focus-inverse",
  ghost:
    "bg-transparent text-content-muted hover:bg-action-primary-subtle hover:text-content-primary focus-visible:outline-focus",
  outline:
    "border border-line-strong bg-transparent text-content-primary hover:border-action-primary hover:bg-surface-subtle focus-visible:outline-focus",
  premium:
    "border border-[#D9A32F]/30 bg-[#0B2A3D] text-white shadow-md shadow-[#0B2A3D]/15 hover:bg-[#082236] focus-visible:outline-focus-inverse",
  primary:
    "border border-action-primary bg-action-primary text-content-inverse hover:border-action-primary-hover hover:bg-action-primary-hover focus-visible:outline-focus-inverse",
  secondary:
    "border border-line bg-surface text-content-primary hover:border-line-strong hover:bg-surface-subtle focus-visible:outline-focus",
  success:
    "border border-status-success bg-status-success text-content-inverse hover:brightness-95 focus-visible:outline-focus-inverse",
};

const sizeClasses = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
} as const;

const primitiveCandidates = [
  ...buttonControlClasses.split(" "),
  ...Object.values(buttonVariantClasses).flatMap((classes) => classes.split(" ")),
  ...Object.values(sizeClasses).flatMap((classes) => classes.split(" ")),
  "w-full",
  "relative",
  "inline-grid",
  "min-w-0",
  "grid-cols-1",
  "grid-rows-1",
  "justify-items-center",
  "col-start-1",
  "row-start-1",
  "gap-2",
  "opacity-0",
  "opacity-100",
  "visible",
  "invisible",
  "h-4",
  "w-4",
  "animate-spin",
  "rounded-full",
  "border-2",
  "border-current",
  "border-r-transparent",
  "opacity-80",
  "w-10",
  "w-11",
  "p-0",
  "h-5",
  "w-5",
  "shrink-0",
  "[&>svg]:h-full",
  "[&>svg]:w-full",
  "bg-teal-400",
  "hover:bg-teal-300",
  "sm:w-auto",
] as const;

let compiledCssPromise: Promise<string> | undefined;
let productCssPromise:
  | Promise<{ css: string; dependencyFiles: string[] }>
  | undefined;

function compiledCss() {
  compiledCssPromise ??= postcss([tailwindcss()])
    .process(
      `${globalsSource}\n${[...new Set(primitiveCandidates)]
        .map((candidate) => `@source inline("${candidate.replaceAll('"', '\\"')}");`)
        .join("\n")}`,
      { from: globalsPath },
    )
    .then((result) => result.css);

  return compiledCssPromise;
}

function productCss() {
  productCssPromise ??= postcss([tailwindcss()])
    .process(globalsSource, { from: globalsPath })
    .then((result) => ({
      css: result.css,
      dependencyFiles: result.messages.flatMap((message) =>
        "file" in message && typeof message.file === "string" ? [message.file] : [],
      ),
    }));

  return productCssPromise;
}

function buttonElement(props: ButtonProps) {
  return Button(props) as ReactElement<Record<string, unknown>>;
}

function buttonMarkup(props: ButtonProps) {
  return serializeElement(Button(props));
}

function iconMarkup(props: Parameters<typeof IconButton>[0]) {
  return serializeElement(IconButton(props));
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function styleAttribute(style: Record<string, string | number>) {
  return Object.entries(style)
    .map(([name, value]) => {
      const property = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const serialized =
        typeof value === "number" && value !== 0 ? `${value}px` : String(value);
      return `${property}:${serialized}`;
    })
    .join(";");
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
  const tag =
    typeof element.type === "string"
      ? element.type
      : typeof props.href === "string"
        ? "a"
        : undefined;

  if (!tag) return serializeElement(props.children);

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

    const name =
      rawName === "className"
        ? "class"
        : rawName === "tabIndex"
          ? "tabindex"
          : rawName;
    if (rawName === "style" && typeof value === "object") {
      attributes.push(
        `style="${escapeHtml(styleAttribute(value as Record<string, string | number>))}"`,
      );
    } else if (value === true && !name.startsWith("aria-")) {
      attributes.push(name);
    } else {
      attributes.push(`${name}="${escapeHtml(value)}"`);
    }
  }

  return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${serializeElement(props.children)}</${tag}>`;
}

async function setPrimitiveContent(page: Page, markup: string) {
  await page.setContent(`<style>${await compiledCss()}</style>${markup}`);
}

function fakeMouseEvent() {
  let prevented = false;
  return {
    event: {
      preventDefault() {
        prevented = true;
      },
    },
    prevented: () => prevented,
  };
}

function fakeKeyboardEvent(key: string) {
  let prevented = false;
  return {
    event: {
      key,
      preventDefault() {
        prevented = true;
      },
    },
    prevented: () => prevented,
  };
}

test.describe("UIX-1C2 Button and IconButton", () => {
  test("limits Tailwind runtime discovery to the product app and src roots", () => {
    expect(globalsSource).toContain('@import "tailwindcss" source(none);');
    expect(globalsSource).toContain('@source "../app";');
    expect(globalsSource).toContain('@source "../src";');

    for (const excludedSource of [
      "../tests",
      "../support-ops",
      "../supabase",
      "../docs",
      "../scripts",
      "../.agents",
    ]) {
      expect(globalsSource).not.toContain(`@source "${excludedSource}"`);
    }
  });

  test("compiles Button and IconButton utilities from product roots only", async ({
    page,
  }) => {
    const compilation = await productCss();
    const requiredCandidates = [
      "rounded-ui",
      "bg-action-primary",
      "hover:bg-action-primary-hover",
      "text-content-inverse",
      "border-action-primary",
      "bg-surface",
      "border-line",
      "focus-visible:outline-focus",
      "focus-visible:outline-focus-inverse",
      "aria-disabled:bg-surface-subtle",
      "duration-[var(--ui-motion-fast)]",
      "ease-[var(--ui-motion-easing)]",
      "[&>svg]:h-full",
      "[&>svg]:w-full",
    ] as const;
    const selectors = await page.evaluate(
      (candidates) => candidates.map((candidate) => `.${CSS.escape(candidate)}`),
      requiredCandidates,
    );

    for (const [index, candidate] of requiredCandidates.entries()) {
      expect(compilation.css, candidate).toContain(selectors[index]);
    }

    const dependencies = compilation.dependencyFiles.map((file) =>
      file.replaceAll("\\", "/").toLowerCase(),
    );
    expect(dependencies.some((file) => file.includes("/app/"))).toBe(true);
    expect(dependencies.some((file) => file.includes("/src/"))).toBe(true);

    for (const excludedRoot of [
      "/support-ops/",
      "/tests/",
      "/supabase/",
      "/docs/",
      "/scripts/",
      "/.agents/",
    ]) {
      expect(dependencies, excludedRoot).not.toContainEqual(
        expect.stringContaining(excludedRoot),
      );
    }
  });

  test("exports the compatible Button API and exact shared variant contract", () => {
    expect(buttonSource).toContain("export type ButtonSize");
    expect(buttonSource).toContain("export type ButtonProps");
    expect(buttonSource).toContain('export type { ButtonVariant }');
    expect(buttonSource).toContain('"download" | "rel" | "target"');
    expect(buttonSource).toContain("ButtonHTMLAttributes<HTMLButtonElement>");

    expect(variants).toHaveLength(7);
    expect(buttonVariantClasses).toEqual(expectedVariantClasses);
    expect(stylesSource).not.toContain("coachos-primary-button");
    expect(stylesSource).not.toContain("translate");
    expect(buttonControlClasses).not.toContain("transform");

    for (const variant of variants) {
      if (variant === "premium") {
        expect(buttonVariantClasses[variant]).toContain("shadow-md");
      } else {
        expect(buttonVariantClasses[variant]).not.toContain("shadow-");
      }
    }
  });

  test("keeps representative native, href, loading, form and override calls source-compatible", () => {
    const representativeCalls: ButtonProps[] = [
      { children: "Save" },
      { children: "Open", href: "/app", type: "button" },
      {
        children: "Save changes",
        disabled: true,
        isLoading: true,
        loadingText: "Saving...",
      },
      { children: "Continue", className: "w-full", fullWidth: true },
      { children: "Submit", form: "settings", type: "submit" },
      {
        children: "Policy",
        download: "policy.pdf",
        href: "/payment-policy",
        rel: "noopener",
        target: "_blank",
      },
    ];

    expect(representativeCalls).toHaveLength(6);
  });

  test("keeps computed native state authoritative and defaults type to button", () => {
    const click = () => undefined;
    const idle = buttonElement({ children: "Save", onClick: click });
    expect(idle.type).toBe("button");
    expect(idle.props.type).toBe("button");
    expect(idle.props.disabled).toBeFalsy();
    expect(idle.props.onClick).toBe(click);

    const loading = buttonElement({
      "aria-busy": false,
      children: "Save",
      disabled: false,
      isLoading: true,
      type: "submit",
    });
    expect(loading.props.type).toBe("submit");
    expect(loading.props.disabled).toBe(true);
    expect(loading.props["aria-busy"]).toBe(true);
  });

  test("renders all seven Button variants with their exact shared classes", async ({
    page,
  }) => {
    await setPrimitiveContent(
      page,
      variants
        .map((variant) =>
          buttonMarkup({
            children: variant,
            id: `variant-${variant}`,
            variant,
          }),
        )
        .join(""),
    );

    await expect(page.getByRole("button")).toHaveCount(7);
    for (const variant of variants) {
      const classes = await page.locator(`#variant-${variant}`).getAttribute("class");
      for (const expectedClass of buttonVariantClasses[variant].split(" ")) {
        expect(classes?.split(" "), `${variant}:${expectedClass}`).toContain(
          expectedClass,
        );
      }
    }
  });

  test("prevents native disabled and loading controls from activating", async ({ page }) => {
    await setPrimitiveContent(
      page,
      [
        buttonMarkup({ children: "Disabled", disabled: true, id: "native-disabled" }),
        buttonMarkup({ children: "Loading", id: "native-loading", isLoading: true }),
      ].join(""),
    );

    await page.evaluate(() => {
      (window as typeof window & { activationCount?: number }).activationCount = 0;
      for (const button of document.querySelectorAll("button")) {
        button.addEventListener("click", () => {
          (window as typeof window & { activationCount: number }).activationCount += 1;
        });
        button.click();
      }
    });

    await expect(page.locator("#native-disabled")).toBeDisabled();
    await expect(page.locator("#native-loading")).toBeDisabled();
    expect(
      await page.evaluate(
        () => (window as typeof window & { activationCount: number }).activationCount,
      ),
    ).toBe(0);
  });

  test("forwards only approved href attributes and keeps caller onClick ignored", () => {
    let callerClicks = 0;
    const link = buttonElement({
      "aria-busy": true,
      "aria-disabled": true,
      "aria-label": "Open notifications",
      children: "Open",
      className: "consumer-last",
      download: "report.pdf",
      form: "unsafe-form",
      formAction: "/unsafe",
      href: "/notifications",
      id: "notification-link",
      name: "unsafe-name",
      onClick: () => {
        callerClicks += 1;
      },
      rel: "noopener",
      role: "link",
      tabIndex: 2,
      target: "_blank",
      title: "Notifications",
      type: "submit",
      value: "unsafe-value",
      ...({ "data-test-link": "safe-data" } as Record<string, string>),
    });

    expect(link.props.href).toBe("/notifications");
    expect(link.props.id).toBe("notification-link");
    expect(link.props.role).toBe("link");
    expect(link.props.title).toBe("Notifications");
    expect(link.props.tabIndex).toBe(2);
    expect(link.props.target).toBe("_blank");
    expect(link.props.rel).toBe("noopener");
    expect(link.props.download).toBe("report.pdf");
    expect(link.props["aria-label"]).toBe("Open notifications");
    expect(link.props["data-test-link"]).toBe("safe-data");
    expect(link.props["aria-busy"]).toBeUndefined();
    expect(link.props["aria-disabled"]).toBeUndefined();
    expect(link.props.onClick).toBeUndefined();
    expect(callerClicks).toBe(0);

    for (const rejected of [
      "type",
      "name",
      "value",
      "form",
      "formAction",
      "formEncType",
      "formMethod",
      "formNoValidate",
      "formTarget",
    ]) {
      expect(link.props[rejected], rejected).toBeUndefined();
    }
  });

  test("makes disabled and loading href modes non-activating without an invalid disabled attribute", () => {
    for (const props of [
      { children: "Open", disabled: true, href: "/target" },
      { children: "Open", href: "/target", isLoading: true },
    ] satisfies ButtonProps[]) {
      const link = buttonElement(props);
      expect(link.props.href).toBe("/target");
      expect(link.props["aria-disabled"]).toBe(true);
      expect(link.props.tabIndex).toBe(-1);
      expect(link.props.disabled).toBeUndefined();

      const click = fakeMouseEvent();
      (link.props.onClick as (event: unknown) => void)(click.event);
      expect(click.prevented()).toBe(true);

      const auxiliaryClick = fakeMouseEvent();
      (link.props.onAuxClick as (event: unknown) => void)(auxiliaryClick.event);
      expect(auxiliaryClick.prevented()).toBe(true);

      for (const key of ["Enter", " "]) {
        const keydown = fakeKeyboardEvent(key);
        (link.props.onKeyDown as (event: unknown) => void)(keydown.event);
        expect(keydown.prevented()).toBe(true);
      }

      const otherKey = fakeKeyboardEvent("Escape");
      (link.props.onKeyDown as (event: unknown) => void)(otherKey.event);
      expect(otherKey.prevented()).toBe(false);
    }
  });

  test("preserves the accessible action name and hides only the visual loading layer", async ({
    page,
  }) => {
    await setPrimitiveContent(
      page,
      buttonMarkup({
        children: "Publish program",
        id: "loading-button",
        isLoading: true,
        loadingText: "Publishing...",
      }),
    );

    const button = page.getByRole("button", { name: "Publish program" });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleName("Publish program");
    await expect(button).not.toHaveAccessibleName("Publishing...");

    const layers = button.locator(":scope > span > span");
    await expect(layers).toHaveCount(2);
    await expect(layers.nth(0)).not.toHaveAttribute("aria-hidden");
    await expect(layers.nth(0)).toHaveClass(/opacity-0/);
    await expect(layers.nth(1)).toHaveAttribute("aria-hidden", "true");
    await expect(layers.nth(1)).toHaveClass(/visible/);
  });

  test("keeps loading width stable across text, icons, sizes and full width", async ({
    page,
  }) => {
    const icon = createElement("span", {
      style: { display: "inline-block", height: 16, width: 16 },
    });
    const cases = [
      { id: "save", children: "Save", loadingText: "Saving..." },
      {
        id: "publish",
        children: "Publish program",
        loadingText: "Publishing...",
      },
      { id: "none", children: "Continue upload" },
      {
        id: "left",
        children: "Attach video",
        leftIcon: icon,
        loadingText: "Attaching...",
        size: "sm" as const,
      },
      {
        id: "right",
        children: "Next step",
        loadingText: "Working...",
        rightIcon: icon,
        size: "lg" as const,
      },
      {
        id: "sm",
        children: "Refresh",
        loadingText: "Refreshing...",
        size: "sm" as const,
      },
      {
        id: "md",
        children: "Save",
        loadingText: "Saving...",
        size: "md" as const,
      },
      {
        id: "lg",
        children: "Create workspace",
        loadingText: "Creating...",
        size: "lg" as const,
      },
      {
        id: "full",
        children: "Submit",
        fullWidth: true,
        loadingText: "Submitting...",
      },
    ];

    const markup = cases
      .map(
        (item) =>
          `<div ${item.id === "full" ? 'style="width:320px"' : ""}>${buttonMarkup({ ...item, isLoading: false })}${buttonMarkup({ ...item, id: `${item.id}-loading`, isLoading: true })}</div>`,
      )
      .join("");
    await setPrimitiveContent(page, markup);

    let maxDelta = 0;
    for (const item of cases) {
      const idleWidth = await page.locator(`#${item.id}`).evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      const loadingWidth = await page.locator(`#${item.id}-loading`).evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      const delta = Math.abs(loadingWidth - idleWidth);
      maxDelta = Math.max(maxDelta, delta);
      expect(delta, item.id).toBeLessThanOrEqual(0.5);
    }

    expect(maxDelta).toBe(0);
  });

  test("renders exact Button heights and representative computed consumer overrides", async ({
    page,
  }) => {
    const markup = [
      buttonMarkup({ children: "Small", id: "small", size: "sm" }),
      buttonMarkup({ children: "Medium", id: "medium", size: "md" }),
      buttonMarkup({ children: "Large", id: "large", size: "lg" }),
      buttonMarkup({
        children: "Teal action",
        className: "bg-teal-400 hover:bg-teal-300",
        id: "teal",
      }),
      `<div style="width:500px">${buttonMarkup({ children: "Responsive", className: "w-full sm:w-auto", fullWidth: true, id: "responsive" })}</div>`,
    ].join("");
    await setPrimitiveContent(page, markup);

    await expect(page.locator("#small")).toHaveCSS("height", "40px");
    await expect(page.locator("#medium")).toHaveCSS("height", "44px");
    await expect(page.locator("#large")).toHaveCSS("height", "48px");
    await expect(page.locator("#teal")).toHaveCSS(
      "background-color",
      "oklch(0.777 0.152 181.912)",
    );
    expect(
      await page.locator("#responsive").evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    ).toBeLessThan(500);

    const tealClasses = await page.locator("#teal").getAttribute("class");
    expect(tealClasses?.endsWith("bg-teal-400 hover:bg-teal-300")).toBe(true);
  });

  test("compiles every primitive utility through Tailwind 4.2.4", async ({ page }) => {
    const css = await compiledCss();
    const selectors = await page.evaluate(
      (candidates) => candidates.map((candidate) => `.${CSS.escape(candidate)}`),
      [...new Set(primitiveCandidates)],
    );

    for (const [index, candidate] of [...new Set(primitiveCandidates)].entries()) {
      expect(css, candidate).toContain(selectors[index]);
    }

    expect(css).toContain("var(--ui-action-primary)");
    expect(css).toContain("var(--ui-focus)");
    expect(css).toContain("var(--ui-focus-inverse)");
    expect(css).toContain("var(--ui-motion-fast)");
    expect(css).toContain("var(--ui-motion-easing)");
  });

  test("produces visible computed keyboard focus for normal and inverse variants", async ({
    page,
  }) => {
    await setPrimitiveContent(
      page,
      [
        buttonMarkup({ children: "Primary", id: "primary-focus" }),
        buttonMarkup({
          children: "Secondary",
          id: "secondary-focus",
          variant: "secondary",
        }),
      ].join(""),
    );

    await page.keyboard.press("Tab");
    await expect(page.locator("#primary-focus")).toBeFocused();
    await expect(page.locator("#primary-focus")).toHaveCSS("outline-width", "2px");
    await expect(page.locator("#primary-focus")).toHaveCSS(
      "outline-color",
      "rgb(120, 228, 243)",
    );
    await expect(page.locator("#primary-focus")).toHaveCSS("outline-offset", "2px");

    await page.keyboard.press("Tab");
    await expect(page.locator("#secondary-focus")).toBeFocused();
    await expect(page.locator("#secondary-focus")).toHaveCSS("outline-width", "2px");
    await expect(page.locator("#secondary-focus")).toHaveCSS(
      "outline-color",
      "rgb(14, 116, 144)",
    );
    await expect(page.locator("#secondary-focus")).toHaveCSS("outline-offset", "2px");
  });

  test("renders href mode with safe DOM attributes and no button-only leakage", async ({
    page,
  }) => {
    await setPrimitiveContent(
      page,
      buttonMarkup({
        "aria-label": "Open notifications",
        children: "Open",
        download: "notifications.txt",
        form: "unsafe-form",
        href: "/notifications",
        id: "safe-link",
        name: "unsafe-name",
        rel: "noopener",
        target: "_blank",
        type: "submit",
        value: "unsafe-value",
        ...({ "data-safe": "yes" } as Record<string, string>),
      }),
    );

    const link = page.getByRole("link", { name: "Open notifications" });
    await expect(link).toHaveAttribute("href", "/notifications");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    await expect(link).toHaveAttribute("download", "notifications.txt");
    await expect(link).toHaveAttribute("data-safe", "yes");
    await expect(link).not.toHaveAttribute("type");
    await expect(link).not.toHaveAttribute("name");
    await expect(link).not.toHaveAttribute("value");
    await expect(link).not.toHaveAttribute("form");
    await expect(link).not.toHaveAttribute("disabled");
  });

  test("implements IconButton naming, dimensions, native behavior and focus", async ({
    page,
  }) => {
    const icon = createElement(
      "svg",
      { viewBox: "0 0 20 20" },
      createElement("path", { d: "M2 10h16" }),
    );
    const markup = [
      iconMarkup({ icon, id: "icon-default", label: "Close" }),
      iconMarkup({
        icon,
        id: "icon-compact",
        label: "Remove",
        size: "compact",
        variant: "destructive",
      }),
      iconMarkup({ disabled: true, icon, id: "icon-disabled", label: "Disabled" }),
    ].join("");
    await setPrimitiveContent(page, markup);

    const defaultButton = page.getByRole("button", { name: "Close" });
    await expect(defaultButton).toHaveAttribute("type", "button");
    await expect(defaultButton).toHaveCSS("height", "44px");
    await expect(defaultButton).toHaveCSS("width", "44px");
    await expect(defaultButton.locator("span")).toHaveAttribute("aria-hidden", "true");
    await expect(defaultButton.locator("span")).toHaveCSS("height", "20px");
    await expect(defaultButton.locator("span")).toHaveCSS("width", "20px");

    const compact = page.getByRole("button", { name: "Remove" });
    await expect(compact).toHaveCSS("height", "40px");
    await expect(compact).toHaveCSS("width", "40px");
    await expect(compact.locator("span")).toHaveCSS("height", "16px");
    await expect(compact.locator("span")).toHaveCSS("width", "16px");
    await expect(page.getByRole("button", { name: "Disabled" })).toBeDisabled();

    await page.keyboard.press("Tab");
    await expect(defaultButton).toBeFocused();
    await expect(defaultButton).toHaveCSS("outline-width", "2px");
    await expect(defaultButton).toHaveCSS("outline-color", "rgb(14, 116, 144)");
    await expect(defaultButton).toHaveCSS("outline-offset", "2px");

    await page.locator("#icon-disabled").evaluate((element) => {
      (window as typeof window & { iconActivationCount?: number }).iconActivationCount = 0;
      element.addEventListener("click", () => {
        (window as typeof window & { iconActivationCount: number }).iconActivationCount += 1;
      });
      (element as HTMLButtonElement).click();
    });
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { iconActivationCount: number })
            .iconActivationCount,
      ),
    ).toBe(0);
  });

  test("keeps IconButton label authoritative and omits speculative APIs", () => {
    const icon = createElement("svg");
    const element = IconButton({
      ...({ "aria-label": "Caller override" } as Record<string, string>),
      icon,
      label: "Canonical label",
    }) as ReactElement<Record<string, unknown>>;

    expect(element.props["aria-label"]).toBe("Canonical label");
    expect(iconButtonSource).not.toContain("tooltip");
    expect(iconButtonSource).not.toContain("isLoading");
    expect(iconButtonSource).not.toContain("href");
  });

  test("contains no product, network, auth or authority logic", () => {
    const combined = `${buttonSource}\n${iconButtonSource}\n${stylesSource}`;
    for (const forbidden of [
      "fetch(",
      "supabase",
      "requestId",
      "tenantId",
      "feature gate",
      "retry policy",
      "mutation",
    ]) {
      expect(combined.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
