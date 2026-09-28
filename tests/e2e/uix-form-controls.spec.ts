import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { createElement, createRef, type ReactElement } from "react";

import {
  Input,
  type InputProps,
  type TextInputType,
} from "../../src/components/ui/Input";
import { Select, type SelectProps } from "../../src/components/ui/Select";
import {
  Textarea,
  type TextareaProps,
} from "../../src/components/ui/Textarea";
import {
  fieldControlBaseStyles,
  fieldControlClassName,
} from "../../src/components/ui/fieldControlStyles";

const root = process.cwd();
const globalsPath = join(root, "app", "globals.css");
const inputPath = join(root, "src", "components", "ui", "Input.tsx");
const selectPath = join(root, "src", "components", "ui", "Select.tsx");
const stylesPath = join(
  root,
  "src",
  "components",
  "ui",
  "fieldControlStyles.ts",
);
const textareaPath = join(root, "src", "components", "ui", "Textarea.tsx");

const globalsSource = readFileSync(globalsPath, "utf8");
const inputSource = readFileSync(inputPath, "utf8");
const selectSource = readFileSync(selectPath, "utf8");
const stylesSource = readFileSync(stylesPath, "utf8");
const textareaSource = readFileSync(textareaPath, "utf8");
const primitiveSources = [inputSource, selectSource, stylesSource, textareaSource];

const allowedInputTypes = [
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
] as const satisfies readonly TextInputType[];

const forbiddenInputTypes = [
  "file",
  "checkbox",
  "radio",
  "hidden",
  "color",
  "button",
  "submit",
  "reset",
  "range",
  "image",
] as const;

function inputTypeCompileAssertions() {
  const allowed = allowedInputTypes.map((type) =>
    createElement(Input, { key: type, type }),
  );

  // @ts-expect-error file inputs do not use the text-control primitive
  const file = createElement(Input, { type: "file" });
  // @ts-expect-error checkboxes have a dedicated primitive
  const checkbox = createElement(Input, { type: "checkbox" });
  // @ts-expect-error radios have a dedicated primitive
  const radio = createElement(Input, { type: "radio" });
  // @ts-expect-error hidden inputs must remain native
  const hidden = createElement(Input, { type: "hidden" });
  // @ts-expect-error color inputs must remain native
  const color = createElement(Input, { type: "color" });
  // @ts-expect-error button inputs must use Button
  const button = createElement(Input, { type: "button" });
  // @ts-expect-error submit inputs must use Button
  const submit = createElement(Input, { type: "submit" });
  // @ts-expect-error reset inputs must use Button
  const reset = createElement(Input, { type: "reset" });
  // @ts-expect-error range controls are outside the text-input contract
  const range = createElement(Input, { type: "range" });
  // @ts-expect-error image inputs are outside the text-input contract
  const image = createElement(Input, { type: "image" });

  return [allowed, file, checkbox, radio, hidden, color, button, submit, reset, range, image];
}

function refCompileAssertions() {
  const inputObjectRef = createRef<HTMLInputElement>();
  const textareaObjectRef = createRef<HTMLTextAreaElement>();
  const selectObjectRef = createRef<HTMLSelectElement>();
  const inputCallbackRef = (node: HTMLInputElement | null) => {
    void node;
  };
  const textareaCallbackRef = (node: HTMLTextAreaElement | null) => {
    void node;
  };
  const selectCallbackRef = (node: HTMLSelectElement | null) => {
    void node;
  };

  return [
    createElement(Input, { key: "input-object", ref: inputObjectRef }),
    createElement(Input, { key: "input-callback", ref: inputCallbackRef }),
    createElement(Textarea, { key: "textarea-object", ref: textareaObjectRef }),
    createElement(Textarea, {
      key: "textarea-callback",
      ref: textareaCallbackRef,
    }),
    createElement(Select, { key: "select-object", ref: selectObjectRef }),
    createElement(Select, { key: "select-callback", ref: selectCallbackRef }),
  ];
}

void inputTypeCompileAssertions;
void refCompileAssertions;

const inputLayout = "h-11 px-3 leading-5";
const textareaLayout = "min-h-28 resize-y px-3 py-3 leading-6";
const selectLayout = "h-11 px-3 leading-5";
const selectListboxLayout = "min-h-11 px-3 py-2 leading-5";
const harnessCandidates = [
  ...fieldControlBaseStyles.split(" "),
  ...inputLayout.split(" "),
  ...textareaLayout.split(" "),
  ...selectListboxLayout.split(" "),
  "h-12",
] as const;

let compiledCssPromise: Promise<string> | undefined;
let productCssPromise:
  | Promise<{ css: string; dependencyFiles: string[] }>
  | undefined;

function compiledCss() {
  compiledCssPromise ??= postcss([tailwindcss()])
    .process(
      `${globalsSource}\n${[...new Set(harnessCandidates)]
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

function inputElement(props: InputProps = {}) {
  return Input(props) as ReactElement<Record<string, unknown>>;
}

function textareaElement(props: TextareaProps = {}) {
  return Textarea(props) as ReactElement<Record<string, unknown>>;
}

function selectElement(props: SelectProps = {}) {
  return Select(props) as ReactElement<Record<string, unknown>>;
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
  if (typeof element.type !== "string") return serializeElement(props.children);

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
        : rawName === "autoComplete"
          ? "autocomplete"
          : rawName === "defaultValue"
            ? "value"
            : rawName === "maxLength"
              ? "maxlength"
              : rawName;
    if (value === true && !name.startsWith("aria-")) {
      attributes.push(name);
    } else {
      attributes.push(`${name}="${escapeHtml(value)}"`);
    }
  }

  return `<${element.type}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${serializeElement(props.children)}</${element.type}>`;
}

function inputMarkup(props: InputProps = {}) {
  return serializeElement(Input(props));
}

function textareaMarkup(props: TextareaProps = {}) {
  return serializeElement(Textarea(props));
}

function selectMarkup(props: SelectProps = {}) {
  return serializeElement(
    Select({
      ...props,
      children: [
        createElement("option", { key: "alpha", value: "alpha" }, "Alpha"),
        createElement("option", { key: "beta", value: "beta" }, "Beta"),
        createElement("option", { key: "gamma", value: "gamma" }, "Gamma"),
        createElement("option", { key: "delta", value: "delta" }, "Delta"),
      ],
    }),
  );
}

async function setPrimitiveContent(page: Page, markup: string) {
  await page.setContent(`<style>${await compiledCss()}</style>${markup}`);
}

test.describe("UIX-1C3B text form controls", () => {
  test("keeps Tailwind runtime discovery explicit and product-only", () => {
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

  test("freezes the Input public type allowlist", () => {
    expect(allowedInputTypes).toEqual([
      "date",
      "datetime-local",
      "email",
      "month",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "time",
      "url",
      "week",
    ]);
    expect(inputSource).toContain('ComponentPropsWithRef<"input">');
    expect(inputSource).toContain('"type"');

    for (const forbiddenType of forbiddenInputTypes) {
      expect(allowedInputTypes).not.toContain(forbiddenType as TextInputType);
    }
  });

  test("uses the exact narrow shared class helper", () => {
    expect(fieldControlBaseStyles).toBe(
      "w-full rounded-ui border border-line bg-surface text-sm text-content-primary outline-none placeholder:text-content-muted transition-[background-color,border-color,color,box-shadow] duration-[var(--ui-motion-fast)] ease-[var(--ui-motion-easing)] hover:border-line-strong focus-visible:border-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-invalid:border-status-danger aria-invalid:focus-visible:border-status-danger aria-invalid:focus-visible:outline-status-danger disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-subtle disabled:text-content-muted disabled:opacity-100 disabled:hover:border-line",
    );
    expect(fieldControlClassName("layout", "consumer")).toBe(
      `${fieldControlBaseStyles} layout consumer`,
    );
  });

  test("defaults Input to a native text input", () => {
    const element = inputElement();
    const markup = inputMarkup();

    expect(element.type).toBe("input");
    expect(element.props.type).toBe("text");
    expect(markup).toContain('type="text"');
    expect(markup).not.toContain("role=");
  });

  test("preserves Input native attributes without synthesizing ARIA", () => {
    const markup = inputMarkup({
      autoComplete: "email",
      defaultValue: "person@example.com",
      id: "email",
      maxLength: 120,
      name: "email",
      placeholder: "Email",
      required: true,
      type: "email",
    });

    expect(markup).toContain('autocomplete="email"');
    expect(markup).toContain('maxlength="120"');
    expect(markup).toContain('name="email"');
    expect(markup).toContain("required");
    expect(markup).not.toMatch(/\saria-invalid=/);
    expect(markup).not.toContain("role=");
  });

  test("uses React 19 direct Input refs without forwardRef", () => {
    expect(inputSource).toContain("ref,");
    expect(inputSource).toContain("ref={ref}");
    expect(inputSource).not.toContain("forwardRef");
  });

  test("preserves native Textarea attributes and direct refs", () => {
    const element = textareaElement({
      defaultValue: "Notes",
      id: "notes",
      maxLength: 500,
      name: "notes",
      rows: 4,
    });
    const markup = textareaMarkup(element.props as TextareaProps);

    expect(element.type).toBe("textarea");
    expect(markup).toContain('maxlength="500"');
    expect(markup).toContain('rows="4"');
    expect(markup).not.toContain("role=");
    expect(textareaSource).toContain("ref={ref}");
    expect(textareaSource).not.toContain("forwardRef");
  });

  test("preserves native Select attributes and direct refs", () => {
    const element = selectElement({
      defaultValue: "beta",
      id: "program",
      name: "program",
      required: true,
    });
    const markup = selectMarkup({
      defaultValue: "beta",
      id: "program",
      name: "program",
      required: true,
    });

    expect(markup).toContain('name="program"');
    expect(markup).toContain("required");
    expect(element.props.defaultValue).toBe("beta");
    expect(markup).not.toContain("role=");
    expect(selectSource).toContain("ref={ref}");
    expect(selectSource).not.toContain("forwardRef");
  });

  test("selects fixed or listbox layout from native multiple and size props", () => {
    const single = String(selectElement().props.className).split(" ");
    const multiple = String(selectElement({ multiple: true }).props.className).split(" ");
    const sized = String(selectElement({ size: 4 }).props.className).split(" ");
    const sizeOne = String(selectElement({ size: 1 }).props.className).split(" ");

    expect(single).toContain("h-11");
    expect(single).not.toContain("min-h-11");
    expect(multiple).toContain("min-h-11");
    expect(multiple).not.toContain("h-11");
    expect(sized).toContain("min-h-11");
    expect(sized).not.toContain("h-11");
    expect(sizeOne).toContain("h-11");
  });

  test("composes exact base, layout, and caller classes in that order", () => {
    expect(inputElement({ className: "consumer" }).props.className).toBe(
      `${fieldControlBaseStyles} ${inputLayout} consumer`,
    );
    expect(textareaElement({ className: "consumer" }).props.className).toBe(
      `${fieldControlBaseStyles} ${textareaLayout} consumer`,
    );
    expect(selectElement({ className: "consumer" }).props.className).toBe(
      `${fieldControlBaseStyles} ${selectLayout} consumer`,
    );
    expect(
      selectElement({ className: "consumer", multiple: true }).props.className,
    ).toBe(`${fieldControlBaseStyles} ${selectListboxLayout} consumer`);
  });

  test("compiles actual primitive utilities through the ../src product root", async ({
    page,
  }) => {
    const compilation = await productCss();
    const requiredCandidates = [
      "h-11",
      "min-h-11",
      "min-h-28",
      "resize-y",
      "rounded-ui",
      "bg-surface",
      "text-content-primary",
      "border-line",
      "placeholder:text-content-muted",
      "hover:border-line-strong",
      "focus-visible:border-action-primary",
      "focus-visible:outline-focus",
      "aria-invalid:border-status-danger",
      "aria-invalid:focus-visible:outline-status-danger",
      "disabled:bg-surface-subtle",
      "disabled:text-content-muted",
      "duration-[var(--ui-motion-fast)]",
      "ease-[var(--ui-motion-easing)]",
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

  test("contains only semantic color utilities and no product logic", () => {
    for (const source of primitiveSources) {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(source).not.toContain("fetch(");
      expect(source).not.toContain("supabase");
      expect(source).not.toContain("Authorization");
      expect(source).not.toContain("tenantId");
      expect(source).not.toContain("role=");
      expect(source).not.toMatch(/(^|\s)invalid:/m);
      expect(source).not.toContain("user-invalid:");
    }
  });

  test("renders Input and single Select at exactly 44px", async ({ page }) => {
    await setPrimitiveContent(
      page,
      `${inputMarkup({ id: "input" })}${selectMarkup({ id: "select" })}`,
    );

    await expect(page.locator("#input")).toHaveCSS("height", "44px");
    await expect(page.locator("#select")).toHaveCSS("height", "44px");
  });

  test("renders Textarea with a 112px minimum and vertical resize", async ({ page }) => {
    await setPrimitiveContent(page, textareaMarkup({ id: "textarea" }));

    await expect(page.locator("#textarea")).toHaveCSS("min-height", "112px");
    await expect(page.locator("#textarea")).toHaveCSS("resize", "vertical");
  });

  test("does not lock multiple and size listboxes to 44px", async ({ page }) => {
    await setPrimitiveContent(
      page,
      `${selectMarkup({ id: "multiple", multiple: true })}${selectMarkup({ id: "sized", size: 4 })}`,
    );

    expect(await page.locator("#multiple").evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(44);
    expect(await page.locator("#sized").evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(44);
    expect((await page.locator("#multiple").getAttribute("class"))?.split(" ")).not.toContain("h-11");
    expect((await page.locator("#sized").getAttribute("class"))?.split(" ")).not.toContain("h-11");
  });

  test("shows the exact semantic keyboard focus outline", async ({ page }) => {
    await setPrimitiveContent(page, inputMarkup({ id: "focus" }));
    await page.keyboard.press("Tab");

    await expect(page.locator("#focus")).toBeFocused();
    await expect(page.locator("#focus")).toHaveCSS("outline-width", "2px");
    await expect(page.locator("#focus")).toHaveCSS("outline-offset", "2px");
    await expect(page.locator("#focus")).toHaveCSS(
      "outline-color",
      "rgb(14, 116, 144)",
    );
  });

  test("styles only explicit true ARIA invalid states as danger", async ({ page }) => {
    await setPrimitiveContent(
      page,
      [
        inputMarkup({ id: "normal" }),
        inputMarkup({ "aria-invalid": true, id: "boolean-true" }),
        inputMarkup({ "aria-invalid": "true", id: "string-true" }),
        inputMarkup({ "aria-invalid": false, id: "false" }),
      ].join(""),
    );

    for (const id of ["normal", "false"]) {
      await expect(page.locator(`#${id}`)).toHaveCSS(
        "border-color",
        "rgb(216, 232, 240)",
      );
    }
    for (const id of ["boolean-true", "string-true"]) {
      await expect(page.locator(`#${id}`)).toHaveCSS(
        "border-color",
        "rgb(185, 28, 28)",
      );
    }

    await page.locator("#boolean-true").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("#boolean-true")).toHaveCSS("outline-width", "2px");
    await expect(page.locator("#boolean-true")).toHaveCSS("outline-offset", "2px");
    await expect(page.locator("#boolean-true")).toHaveCSS(
      "outline-color",
      "rgb(185, 28, 28)",
    );
  });

  test("renders disabled controls with subtle surface and muted content", async ({ page }) => {
    await setPrimitiveContent(
      page,
      `${inputMarkup({ disabled: true, id: "input" })}${textareaMarkup({ disabled: true, id: "textarea" })}${selectMarkup({ disabled: true, id: "select" })}`,
    );

    for (const id of ["input", "textarea", "select"]) {
      const control = page.locator(`#${id}`);
      await expect(control).toBeDisabled();
      await expect(control).toHaveCSS("background-color", "rgb(247, 252, 255)");
      await expect(control).toHaveCSS("color", "rgb(93, 113, 133)");
      await expect(control).toHaveCSS("cursor", "not-allowed");
    }
  });

  test("allows a representative caller class to override computed height", async ({ page }) => {
    const element = inputElement({ className: "h-12", id: "override" });
    expect(String(element.props.className).endsWith(" h-12")).toBe(true);
    await setPrimitiveContent(page, inputMarkup({ className: "h-12", id: "override" }));
    await expect(page.locator("#override")).toHaveCSS("height", "48px");
  });

  test("retains native Select appearance, value, change, keyboard and disabled behavior", async ({
    page,
  }) => {
    await setPrimitiveContent(
      page,
      `${selectMarkup({ defaultValue: "alpha", id: "active" })}${selectMarkup({ defaultValue: "alpha", disabled: true, id: "disabled" })}`,
    );
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>("#active");
      select?.addEventListener("change", () => {
        document.body.dataset.changeCount = String(
          Number(document.body.dataset.changeCount ?? "0") + 1,
        );
      });
    });

    await expect(page.locator("#active")).toHaveCSS("appearance", "auto");
    await page.locator("#active").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#active")).toHaveValue("beta");
    await expect.poll(() => page.locator("body").getAttribute("data-change-count")).toBe("1");

    await page.locator("#disabled").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#disabled")).toHaveValue("alpha");
  });

  test("keeps controls responsive without clipping", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setPrimitiveContent(
      page,
      `<main style="width:358px">${inputMarkup({ id: "input", placeholder: "A long placeholder that must remain bounded" })}${textareaMarkup({ id: "textarea" })}${selectMarkup({ id: "select" })}</main>`,
    );

    for (const id of ["input", "textarea", "select"]) {
      expect(await page.locator(`#${id}`).evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(358);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
