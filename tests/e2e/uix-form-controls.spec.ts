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
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { createElement, createRef, type ReactElement } from "react";
import ts from "typescript";

import {
  Checkbox,
  type CheckboxProps,
} from "../../src/components/ui/Checkbox";
import {
  FormField,
  type FormFieldProps,
} from "../../src/components/ui/FormField";
import {
  Input,
  type InputProps,
  type TextInputType,
} from "../../src/components/ui/Input";
import { Select, type SelectProps } from "../../src/components/ui/Select";
import {
  Radio,
  RadioGroup,
  type RadioGroupProps,
  type RadioProps,
} from "../../src/components/ui/RadioGroup";
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
const checkboxPath = join(root, "src", "components", "ui", "Checkbox.tsx");
const formFieldPath = join(root, "src", "components", "ui", "FormField.tsx");
const inputPath = join(root, "src", "components", "ui", "Input.tsx");
const selectPath = join(root, "src", "components", "ui", "Select.tsx");
const radioGroupPath = join(
  root,
  "src",
  "components",
  "ui",
  "RadioGroup.tsx",
);
const stylesPath = join(
  root,
  "src",
  "components",
  "ui",
  "fieldControlStyles.ts",
);
const textareaPath = join(root, "src", "components", "ui", "Textarea.tsx");

const globalsSource = readFileSync(globalsPath, "utf8");
const checkboxSource = readFileSync(checkboxPath, "utf8");
const formFieldSource = readFileSync(formFieldPath, "utf8");
const inputSource = readFileSync(inputPath, "utf8");
const selectSource = readFileSync(selectPath, "utf8");
const radioGroupSource = readFileSync(radioGroupPath, "utf8");
const stylesSource = readFileSync(stylesPath, "utf8");
const textareaSource = readFileSync(textareaPath, "utf8");
const primitiveSources = [
  checkboxSource,
  formFieldSource,
  inputSource,
  radioGroupSource,
  selectSource,
  stylesSource,
  textareaSource,
];

function typescriptSourceContract(source: string) {
  const sourceFile = ts.createSourceFile(
    "FormField.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const directives = sourceFile.statements.flatMap((statement) =>
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression)
      ? [statement.expression.text]
      : [],
  );
  const identifiers = new Set<string>();
  const calls: { name: string; position: number }[] = [];

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.push({ name: node.expression.text, position: node.getStart() });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return { calls, directives, identifiers };
}

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

function choiceControlCompileAssertions() {
  const checkboxObjectRef = createRef<HTMLInputElement>();
  const radioObjectRef = createRef<HTMLInputElement>();
  const fieldsetObjectRef = createRef<HTMLFieldSetElement>();
  const checkboxCallbackRef = (node: HTMLInputElement | null) => {
    if (node) {
      return () => undefined;
    }

    return undefined;
  };

  const checkbox = createElement(Checkbox, {
    label: "Accept terms",
    ref: checkboxObjectRef,
  });
  const checkboxCallback = createElement(Checkbox, {
    label: "Accept terms",
    ref: checkboxCallbackRef,
  });
  const radio = createElement(Radio, {
    label: "Monthly",
    name: "billing",
    ref: radioObjectRef,
    value: "monthly",
  });
  const groupProps: RadioGroupProps = {
    children: radio,
    legend: "Billing cycle",
    ref: fieldsetObjectRef,
  };
  const group = createElement(RadioGroup, groupProps);

  // @ts-expect-error Checkbox always owns its native input type
  const checkboxType: CheckboxProps = { label: "Invalid", type: "radio" };
  // @ts-expect-error Checkbox does not accept children
  const checkboxChildren: CheckboxProps = { children: "Invalid", label: "Invalid" };
  // @ts-expect-error Radio always owns its native input type
  const radioType: RadioProps = { label: "Invalid", type: "checkbox" };
  // @ts-expect-error Radio does not accept children
  const radioChildren: RadioProps = { children: "Invalid", label: "Invalid" };
  const groupRequired: RadioGroupProps = {
    children: radio,
    legend: "Invalid",
    // @ts-expect-error RadioGroup has no fieldset-level required API
    required: true,
  };

  return [
    checkbox,
    checkboxCallback,
    radio,
    group,
    checkboxType,
    checkboxChildren,
    radioType,
    radioChildren,
    groupRequired,
  ];
}

function formFieldCompileAssertions() {
  const legacy = formFieldElement({
    children: createElement(Input, { id: "legacy-control" }),
    htmlFor: "legacy-control",
    label: "Legacy field",
  });
  const input = formFieldElement({
    children: (controlProps) =>
      createElement(Input, { ...controlProps, type: "email" }),
    label: "Email",
    required: true,
  });
  const textarea = formFieldElement({
    children: (controlProps) => createElement(Textarea, controlProps),
    disabled: true,
    label: "Notes",
  });
  const select = formFieldElement({
    children: (controlProps) =>
      createElement(
        Select,
        controlProps,
        createElement("option", { value: "starter" }, "Starter"),
      ),
    label: "Plan",
  });

  return [legacy, input, textarea, select];
}

void inputTypeCompileAssertions;
void refCompileAssertions;
void choiceControlCompileAssertions;
void formFieldCompileAssertions;

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

function formFieldElement(props: FormFieldProps & { key?: string }) {
  return createElement(FormField, props);
}

function tagAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match?.[1];
}

async function setPrimitiveContent(page: Page, markup: string) {
  await page.setContent(`<style>${await compiledCss()}</style>${markup}`);
}

const choiceHarnessRuntimeRoot = join(root, "support-ops", "runtime-tests");
let choiceHarnessDirectory: string | undefined;
let choiceHarnessProcess: ChildProcess | undefined;
let choiceHarnessRuntimeRootCreated = false;
let choiceHarnessUrl: string | undefined;
let formFieldSsrMarkup: string | undefined;

function availableLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function runHarnessCommand(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let output = "";
    const captureOutput = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-12_000);
    };
    child.stdout?.on("data", captureOutput);
    child.stderr?.on("data", captureOutput);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`Temporary harness command exited ${code}.\n${output}`));
    });
  });
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };

    child.once("exit", onExit);
  });
}

async function stopChoiceHarness() {
  const child = choiceHarnessProcess;
  choiceHarnessProcess = undefined;

  if (child && child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        const taskkill = spawn(
          join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/pid", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        taskkill.once("error", () => resolve());
        taskkill.once("exit", () => resolve());
      });
    } else {
      child.kill("SIGTERM");
      if (!(await waitForProcessExit(child, 5_000))) {
        child.kill("SIGKILL");
      }
    }
    await waitForProcessExit(child, 5_000);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const directory = choiceHarnessDirectory;
  choiceHarnessDirectory = undefined;
  formFieldSsrMarkup = undefined;
  choiceHarnessUrl = undefined;
  if (directory) {
    let cleanupError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(directory, { force: true, recursive: true });
        cleanupError = undefined;
        break;
      } catch (error) {
        cleanupError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (cleanupError) {
      throw cleanupError;
    }
    if (existsSync(directory)) {
      throw new Error("Choice-control harness cleanup failed.");
    }
  }

  if (
    choiceHarnessRuntimeRootCreated &&
    existsSync(choiceHarnessRuntimeRoot) &&
    readdirSync(choiceHarnessRuntimeRoot).length === 0
  ) {
    rmdirSync(choiceHarnessRuntimeRoot);
  }
}

async function waitForChoiceHarness(
  child: ChildProcess,
  url: string,
  output: () => string,
) {
  const deadline = Date.now() + 60_000;
  let lastResponse = "No HTTP response received.";

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Choice-control harness exited before startup.\n${output()}`,
      );
    }

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
      lastResponse = `Last HTTP response: ${response.status} ${(
        await response.text()
      ).slice(0, 2_000)}`;
    } catch {
      // The loopback server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(
    `Choice-control harness startup timed out.\n${lastResponse}\n${output()}`,
  );
}

async function buildChoiceHarness() {
  choiceHarnessRuntimeRootCreated = !existsSync(choiceHarnessRuntimeRoot);
  mkdirSync(choiceHarnessRuntimeRoot, { recursive: true });
  choiceHarnessDirectory = mkdtempSync(
    join(choiceHarnessRuntimeRoot, "choice-controls-"),
  );

  try {
    const appDirectory = join(choiceHarnessDirectory, "app");
    const componentsDirectory = join(
      choiceHarnessDirectory,
      "src",
      "components",
      "ui",
    );
    mkdirSync(appDirectory, { recursive: true });
    mkdirSync(componentsDirectory, { recursive: true });
    copyFileSync(checkboxPath, join(componentsDirectory, "Checkbox.tsx"));
    copyFileSync(formFieldPath, join(componentsDirectory, "FormField.tsx"));
    copyFileSync(inputPath, join(componentsDirectory, "Input.tsx"));
    copyFileSync(
      radioGroupPath,
      join(componentsDirectory, "RadioGroup.tsx"),
    );
    copyFileSync(selectPath, join(componentsDirectory, "Select.tsx"));
    copyFileSync(stylesPath, join(componentsDirectory, "fieldControlStyles.ts"));
    copyFileSync(textareaPath, join(componentsDirectory, "Textarea.tsx"));

    const repositoryPackage = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    writeFileSync(
      join(choiceHarnessDirectory, "package.json"),
      `${JSON.stringify(
        {
          dependencies: {
            next: repositoryPackage.dependencies.next,
            react: repositoryPackage.dependencies.react,
            "react-dom": repositoryPackage.dependencies["react-dom"],
          },
          private: true,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(choiceHarnessDirectory, "tsconfig.json"),
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
            plugins: [{ name: "next" }],
            resolveJsonModule: true,
            skipLibCheck: true,
            strict: true,
            target: "ES2017",
          },
          exclude: ["node_modules"],
          include: [
            "next-env.d.ts",
            "**/*.ts",
            "**/*.tsx",
            ".next/types/**/*.ts",
          ],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(choiceHarnessDirectory, "next.config.mjs"),
      "export default {};\n",
    );
    writeFileSync(
      join(appDirectory, "layout.tsx"),
      `import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    );
    writeFileSync(
      join(appDirectory, "page.jsx"),
      `"use client";

import React, { createElement, createRef, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import { Checkbox } from "../src/components/ui/Checkbox";
import { Radio, RadioGroup } from "../src/components/ui/RadioGroup";

export default function ChoiceHarnessPage() {
  const containerRef = useRef(null);

  useEffect(() => {
    const root = createRoot(containerRef.current);
    const objectRef = createRef();
    const fieldsetRef = createRef();
    const callbackEvents = [];
    let callbackNode;
    let changeCount = 0;
    let mounted = true;

    const callbackA = (node) => {
      if (!node) return;
      callbackNode = node;
      callbackEvents.push("a:node");
      return () => callbackEvents.push("a:cleanup");
    };
    const callbackB = (node) => {
      if (!node) return;
      callbackNode = node;
      callbackEvents.push("b:node");
      return () => callbackEvents.push("b:cleanup");
    };

    function inputProps(props) {
      const { trackChange, ...nativeProps } = props;
      return {
        ...nativeProps,
        onChange:
          trackChange || nativeProps.checked !== undefined
            ? () => {
                changeCount += 1;
              }
            : undefined,
      };
    }

    window.choiceHarness = {
      renderCheckbox(props, refMode = "none") {
        const ref =
          refMode === "object"
            ? objectRef
            : refMode === "callback-a"
              ? callbackA
              : refMode === "callback-b"
                ? callbackB
                : undefined;
        root.render(createElement(Checkbox, { ...inputProps(props), ref }));
      },
      renderCheckboxes(items) {
        root.render(
          createElement(
            React.Fragment,
            null,
            ...items.map((props, index) =>
              createElement(Checkbox, {
                ...inputProps(props),
                key: props.key ?? index,
              }),
            ),
          ),
        );
      },
      renderRadioGroup(config) {
        const radios = config.radios.map((props, index) =>
          createElement(Radio, {
            ...inputProps(props),
            key: props.key ?? index,
          }),
        );
        root.render(
          createElement(
            React.Fragment,
            null,
            createElement(
              RadioGroup,
              {
                ...config.groupProps,
                ref: config.objectRef ? fieldsetRef : undefined,
              },
              radios,
            ),
            createElement(
              "button",
              { id: "after-group", type: "button" },
              "After group",
            ),
          ),
        );
      },
      state() {
        return {
          callbackEvents: [...callbackEvents],
          callbackNodeConnected: callbackNode?.isConnected ?? false,
          callbackNodeTag: callbackNode?.tagName ?? null,
          changeCount,
          fieldsetRefConnected: fieldsetRef.current?.isConnected ?? false,
          objectRefConnected: objectRef.current?.isConnected ?? false,
          objectRefIsNull: objectRef.current === null,
        };
      },
      unmount() {
        if (mounted) {
          root.unmount();
          mounted = false;
        }
      },
    };

    return () => {
      delete window.choiceHarness;
      if (mounted) {
        root.unmount();
        mounted = false;
      }
    };
  }, []);

  return (
    <main id="choice-root">
      <div id="choice-mount" ref={containerRef} />
    </main>
  );
}
`,
    );
    const formFieldAppDirectory = join(appDirectory, "form-field");
    mkdirSync(formFieldAppDirectory, { recursive: true });
    writeFileSync(
      join(formFieldAppDirectory, "page.jsx"),
      `"use client";

import { FormField } from "../../src/components/ui/FormField";
import { Input } from "../../src/components/ui/Input";

export default function FormFieldHarnessPage() {
  return (
    <main id="form-field-hydration-root">
      <FormField
        description="Hydrated description"
        error="Hydrated error"
        label="Hydrated email"
        required
      >
        {(controlProps) => (
          <Input
            {...controlProps}
            data-hydration-control="true"
            type="email"
          />
        )}
      </FormField>
    </main>
  );
}
`,
    );
    writeFileSync(
      join(choiceHarnessDirectory, "form-field-ssr.tsx"),
      `import { writeFileSync } from "node:fs";
import { renderToString } from "react-dom/server";

import {
  FormField,
  type FormFieldControlProps,
} from "./src/components/ui/FormField";
import { Input } from "./src/components/ui/Input";
import { Select } from "./src/components/ui/Select";
import { Textarea } from "./src/components/ui/Textarea";

function control(name: string) {
  return function FormFieldSsrControl(controlProps: FormFieldControlProps) {
    return <Input {...controlProps} name={name} />;
  };
}

function matrix() {
  return (
    <main data-form-field-ssr>
      <section data-case="legacy">
        <FormField
          className="caller-wrapper"
          controlId="ignored-control-id"
          description="Legacy description"
          error="Legacy error"
          htmlFor="legacy-control"
          label="Legacy field"
          required
        >
          <input
            className="caller-control"
            data-proof="untouched"
            id="legacy-control"
          />
        </FormField>
      </section>

      <section data-case="command-group">
        <FormField controlId="ignored-command-id" label="Starting visibility">
          <div data-command-group="visibility">
            <button type="button">Draft</button>
            <button type="button">Published</button>
          </div>
          <p>Draft stays private.</p>
        </FormField>
      </section>

      <section data-case="generated">
        <FormField label="Field first">{control("first")}</FormField>
        <FormField label="Field second">{control("second")}</FormField>
      </section>

      <section data-case="precedence">
        <FormField htmlFor="html-for-control" label="HTML fallback">
          {control("html-for")}
        </FormField>
        <FormField controlId="explicit-control" label="Explicit control">
          {control("control-id")}
        </FormField>
        <FormField
          controlId="winning-control"
          htmlFor="losing-html-for"
          label="Precedence"
        >
          {control("precedence")}
        </FormField>
      </section>

      <section data-case="metadata">
        <FormField
          controlId="description-control"
          description="Description only"
          label="Description"
        >
          {control("description")}
        </FormField>
        <FormField controlId="error-control" error="Error only" label="Error">
          {control("error")}
        </FormField>
        <FormField
          controlId="both-control"
          description="Both description"
          error="Both error"
          label="Both"
        >
          {control("both")}
        </FormField>
        <FormField controlId="neither-control" label="Neither">
          {control("neither")}
        </FormField>
      </section>

      <section data-case="spread">
        <FormField controlId="input-spread" label="Email" required>
          {(controlProps) => (
            <Input {...controlProps} name="input-spread" type="email" />
          )}
        </FormField>
        <FormField controlId="textarea-spread" disabled label="Notes">
          {(controlProps) => (
            <Textarea {...controlProps} name="textarea-spread" />
          )}
        </FormField>
        <FormField controlId="select-spread" label="Plan">
          {(controlProps) => (
            <Select {...controlProps} name="select-spread">
              <option value="starter">Starter</option>
            </Select>
          )}
        </FormField>
      </section>

      <section data-case="tones">
        <FormField
          description="Light description"
          error="Light error"
          htmlFor="light-field"
          label="Light field"
          required
        >
          <input id="light-field" />
        </FormField>
        <FormField
          description="Dark description"
          error="Dark error"
          htmlFor="dark-field"
          label="Dark field"
          required
          tone="dark"
        >
          <input id="dark-field" />
        </FormField>
      </section>
    </main>
  );
}

const first = renderToString(matrix(), {
  identifierPrefix: "deterministic-form-field-",
});
const second = renderToString(matrix(), {
  identifierPrefix: "deterministic-form-field-",
});
const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("FormField SSR output path is required.");
}
writeFileSync(outputPath, JSON.stringify({ deterministic: first === second, html: first }));
`,
    );
    writeFileSync(
      join(choiceHarnessDirectory, "ssr-tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            esModuleInterop: true,
            jsx: "react-jsx",
            module: "commonjs",
            moduleResolution: "node",
            noEmitOnError: true,
            outDir: "ssr-dist",
            rootDir: ".",
            skipLibCheck: true,
            strict: true,
            target: "ES2020",
            types: ["node"],
          },
          include: ["form-field-ssr.tsx", "src/components/ui/**/*.ts", "src/components/ui/**/*.tsx"],
        },
        null,
        2,
      )}\n`,
    );
    const typeScriptCli = join(root, "node_modules", "typescript", "bin", "tsc");
    await runHarnessCommand(
      process.execPath,
      [typeScriptCli, "--project", "ssr-tsconfig.json"],
      choiceHarnessDirectory,
    );
    const ssrOutputPath = join(choiceHarnessDirectory, "form-field-ssr-output.json");
    await runHarnessCommand(
      process.execPath,
      [join(choiceHarnessDirectory, "ssr-dist", "form-field-ssr.js"), ssrOutputPath],
      choiceHarnessDirectory,
    );
    const ssrOutput = JSON.parse(readFileSync(ssrOutputPath, "utf8")) as {
      deterministic: boolean;
      html: string;
    };
    if (!ssrOutput.deterministic) {
      throw new Error("FormField SSR output was not deterministic.");
    }
    formFieldSsrMarkup = ssrOutput.html;

    const nextPackageDirectory = join(root, "node_modules", "next");
    const nextPackage = JSON.parse(
      readFileSync(join(nextPackageDirectory, "package.json"), "utf8"),
    ) as { bin?: { next?: string } };
    if (!nextPackage.bin?.next) {
      throw new Error("The declared Next package does not expose its CLI binary.");
    }

    const port = await availableLoopbackPort();
    choiceHarnessUrl = `http://127.0.0.1:${port}`;
    const child = spawn(
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
        cwd: choiceHarnessDirectory,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        windowsHide: true,
      },
    );
    choiceHarnessProcess = child;
    let serverOutput = "";
    const captureOutput = (chunk: Buffer) => {
      serverOutput = `${serverOutput}${chunk.toString()}`.slice(-8_000);
    };
    child.stdout?.on("data", captureOutput);
    child.stderr?.on("data", captureOutput);
    await waitForChoiceHarness(child, choiceHarnessUrl, () => serverOutput);
  } catch (error) {
    try {
      await stopChoiceHarness();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Choice-control harness startup and cleanup both failed.",
      );
    }
    throw error;
  }
}

async function setChoiceContent(page: Page) {
  if (!choiceHarnessUrl) {
    throw new Error("Choice-control harness was not started.");
  }

  const compilation = await productCss();
  await page.goto(choiceHarnessUrl);
  await page.addStyleTag({ content: compilation.css });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            (window as unknown as { choiceHarness?: unknown }).choiceHarness,
          ),
      ),
    )
    .toBe(true);
}

async function openFormFieldSsr(page: Page) {
  if (!formFieldSsrMarkup) {
    throw new Error("FormField SSR harness was not generated.");
  }

  await page.setContent(
    `<body data-deterministic="true">${formFieldSsrMarkup}</body>`,
  );
  await expect(page.locator("[data-form-field-ssr]")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-deterministic", "true");
}

async function renderCheckbox(
  page: Page,
  props: Record<string, unknown>,
  refMode = "none",
) {
  await page.evaluate(
    ({ checkboxProps, mode }) => {
      const harness = (
        window as unknown as {
          choiceHarness: {
            renderCheckbox: (
              values: Record<string, unknown>,
              refKind: string,
            ) => void;
          };
        }
      ).choiceHarness;
      harness.renderCheckbox(checkboxProps, mode);
    },
    { checkboxProps: props, mode: refMode },
  );
  await page.waitForSelector('input[type="checkbox"]');
}

async function renderCheckboxes(
  page: Page,
  items: Record<string, unknown>[],
) {
  await page.evaluate((checkboxes) => {
    const harness = (
      window as unknown as {
        choiceHarness: {
          renderCheckboxes: (values: Record<string, unknown>[]) => void;
        };
      }
    ).choiceHarness;
    harness.renderCheckboxes(checkboxes);
  }, items);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(items.length);
}

async function renderRadioGroup(
  page: Page,
  groupProps: Record<string, unknown>,
  radios: Record<string, unknown>[],
  objectRef = false,
) {
  await page.evaluate(
    (config) => {
      const harness = (
        window as unknown as {
          choiceHarness: {
            renderRadioGroup: (values: typeof config) => void;
          };
        }
      ).choiceHarness;
      harness.renderRadioGroup(config);
    },
    { groupProps, objectRef, radios },
  );
  await page.waitForSelector("fieldset");
}

async function choiceHarnessState(page: Page) {
  return page.evaluate(() => {
    const harness = (
      window as unknown as {
        choiceHarness: {
          state: () => {
            callbackEvents: string[];
            callbackNodeConnected: boolean;
            callbackNodeTag: string | null;
            changeCount: number;
            fieldsetRefConnected: boolean;
            objectRefConnected: boolean;
            objectRefIsNull: boolean;
          };
        };
      }
    ).choiceHarness;
    return harness.state();
  });
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await buildChoiceHarness();
});

test.afterAll(async () => {
  await stopChoiceHarness();
});

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

test.describe("UIX-1C3C choice controls", () => {
  test("freezes Checkbox, Radio, and RadioGroup public boundaries", () => {
    expect(checkboxSource).toContain('ComponentPropsWithRef<"input">');
    expect(checkboxSource).toContain('"children" | "type"');
    expect(checkboxSource).toContain('type="checkbox"');
    expect(checkboxSource).toContain("const generatedId = useId();");
    expect(checkboxSource).toContain("assignRef(internalRef, node)");
    expect(checkboxSource).toContain("ref.current = null");
    expect(checkboxSource).toContain("ref={mergedRef}");
    expect(checkboxSource).not.toContain("forwardRef");

    expect(radioGroupSource).toContain('ComponentPropsWithRef<"input">');
    expect(radioGroupSource).toContain('"children" | "type"');
    expect(radioGroupSource).toContain('type="radio"');
    expect(radioGroupSource).toContain('ComponentPropsWithRef<"fieldset">');
    expect(radioGroupSource).toContain('orientation?: "horizontal" | "vertical"');
    expect(radioGroupSource).not.toContain("forwardRef");
    expect(radioGroupSource).not.toContain("cloneElement");
    expect(radioGroupSource).not.toContain("onKeyDown");
  });

  test("uses stable Checkbox IDs and explicit label association", async ({ page }) => {
    await setChoiceContent(page);
    await renderCheckboxes(page, [
      { label: "Generated one" },
      { label: "Generated two" },
      { id: "caller-checkbox", label: "Caller ID" },
    ]);

    const inputs = page.locator('input[type="checkbox"]');
    const firstId = await inputs.nth(0).getAttribute("id");
    const secondId = await inputs.nth(1).getAttribute("id");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
    await expect(inputs.nth(2)).toHaveAttribute("id", "caller-checkbox");
    await expect(page.getByText("Caller ID", { exact: true })).toHaveAttribute(
      "for",
      "caller-checkbox",
    );
  });

  test("keeps Checkbox label as its accessible name and descriptions separate", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderCheckbox(page, {
      "aria-describedby": "caller terms-description terms-error caller",
      "aria-errormessage": "caller-error",
      "aria-invalid": false,
      description: "Required for access",
      error: "You must accept",
      id: "terms",
      label: "Accept terms",
      required: true,
    });

    const checkbox = page.getByRole("checkbox", { name: "Accept terms" });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toHaveAttribute(
      "aria-describedby",
      "caller terms-description terms-error",
    );
    await expect(checkbox).toHaveAttribute("aria-invalid", "true");
    await expect(checkbox).toHaveAttribute("aria-errormessage", "terms-error");
    await expect(checkbox).toHaveAttribute("required", "");
    await expect(page.locator("#terms-description")).toHaveText(
      "Required for access",
    );
    await expect(page.locator("#terms-error")).toHaveText("You must accept");
    await expect(
      page.locator("#choice-root").locator('[role="alert"], [aria-live]'),
    ).toHaveCount(0);
  });

  test("preserves caller Checkbox ARIA metadata when no error exists", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderCheckbox(page, {
      "aria-describedby": "caller-description",
      "aria-errormessage": "caller-error",
      "aria-invalid": false,
      id: "caller-aria",
      label: "Caller metadata",
    });

    const checkbox = page.locator("#caller-aria");
    await expect(checkbox).toHaveAttribute(
      "aria-describedby",
      "caller-description",
    );
    await expect(checkbox).toHaveAttribute("aria-invalid", "false");
    await expect(checkbox).toHaveAttribute(
      "aria-errormessage",
      "caller-error",
    );
  });

  test("supports Checkbox object refs and clears them on unmount", async ({ page }) => {
    await setChoiceContent(page);
    await renderCheckbox(page, { label: "Object ref" }, "object");
    await expect.poll(async () => (await choiceHarnessState(page)).objectRefConnected).toBe(true);

    await page.evaluate(() => {
      (
        window as unknown as { choiceHarness: { unmount: () => void } }
      ).choiceHarness.unmount();
    });
    await expect
      .poll(async () => (await choiceHarnessState(page)).objectRefIsNull)
      .toBe(true);
  });

  test("preserves React 19 callback-ref cleanup on replacement and unmount", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderCheckbox(page, { label: "Callback ref" }, "callback-a");
    await expect
      .poll(async () => (await choiceHarnessState(page)).callbackEvents)
      .toEqual(["a:node"]);
    expect((await choiceHarnessState(page)).callbackNodeTag).toBe("INPUT");

    await renderCheckbox(page, { label: "Callback ref" }, "callback-b");
    await expect
      .poll(async () => (await choiceHarnessState(page)).callbackEvents)
      .toEqual(["a:node", "a:cleanup", "b:node"]);

    await page.evaluate(() => {
      (
        window as unknown as { choiceHarness: { unmount: () => void } }
      ).choiceHarness.unmount();
    });
    await expect
      .poll(async () => (await choiceHarnessState(page)).callbackEvents)
      .toEqual(["a:node", "a:cleanup", "b:node", "b:cleanup"]);
    expect((await choiceHarnessState(page)).callbackNodeConnected).toBe(false);
  });

  test("updates Checkbox indeterminate without rewriting native state", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderCheckbox(page, {
      defaultChecked: true,
      indeterminate: true,
      label: "Mixed selection",
      value: "selected",
    });
    const checkbox = page.getByRole("checkbox", { name: "Mixed selection" });
    await expect
      .poll(() =>
        checkbox.evaluate(
          (node) => (node as HTMLInputElement).indeterminate,
        ),
      )
      .toBe(true);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toHaveValue("selected");

    await renderCheckbox(page, {
      defaultChecked: true,
      indeterminate: false,
      label: "Mixed selection",
      value: "selected",
    });
    await expect
      .poll(() =>
        checkbox.evaluate(
          (node) => (node as HTMLInputElement).indeterminate,
        ),
      )
      .toBe(false);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toHaveValue("selected");
  });

  test("renders Checkbox dimensions, semantic focus, invalid focus, and disabled state", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderCheckbox(page, { id: "normal-choice", label: "Normal choice" });
    const checkbox = page.locator("#normal-choice");
    await expect(checkbox.locator("xpath=..")).toHaveCSS("min-height", "44px");
    await expect(checkbox).toHaveCSS("height", "20px");
    await expect(checkbox).toHaveCSS("width", "20px");
    await expect(checkbox).toHaveCSS("accent-color", "rgb(20, 93, 160)");
    await page.keyboard.press("Tab");
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toHaveCSS("outline-width", "2px");
    await expect(checkbox).toHaveCSS("outline-offset", "2px");
    await expect(checkbox).toHaveCSS("outline-color", "rgb(14, 116, 144)");

    await setChoiceContent(page);
    await renderCheckbox(page, {
      error: "Choose this option",
      id: "invalid-choice",
      label: "Invalid choice",
    });
    const invalid = page.locator("#invalid-choice");
    await page.keyboard.press("Tab");
    await expect(invalid).toBeFocused();
    await expect(invalid).toHaveCSS("outline-width", "2px");
    await expect(invalid).toHaveCSS("outline-offset", "1px");
    await expect(invalid).toHaveCSS("outline-color", "rgb(185, 28, 28)");

    await setChoiceContent(page);
    await renderCheckbox(page, {
      disabled: true,
      id: "disabled-choice",
      label: "Disabled choice",
    });
    const disabled = page.locator("#disabled-choice");
    await expect(disabled).toBeDisabled();
    await expect(disabled).toHaveCSS("cursor", "not-allowed");
    await expect(disabled).toHaveCSS("accent-color", "rgb(93, 113, 133)");
    await expect(page.getByText("Disabled choice", { exact: true })).toHaveCSS(
      "color",
      "rgb(93, 113, 133)",
    );
    await page.getByText("Disabled choice", { exact: true }).click({ force: true });
    await expect(disabled).not.toBeChecked();
  });

  test("keeps Radio naming and associations native and deterministic", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderRadioGroup(
      page,
      { legend: "Billing cycle" },
      [
        {
          "aria-describedby": "caller monthly-description monthly-error caller",
          "aria-invalid": false,
          defaultChecked: true,
          description: "Billed each month",
          error: "Unavailable",
          id: "monthly",
          label: "Monthly",
          name: "billing",
          required: true,
          value: "monthly",
        },
      ],
    );

    const radio = page.getByRole("radio", { name: "Monthly" });
    await expect(radio).toBeChecked();
    await expect(radio).toHaveAttribute("required", "");
    await expect(radio).toHaveValue("monthly");
    await expect(radio).toHaveAttribute(
      "aria-describedby",
      "caller monthly-description monthly-error",
    );
    await expect(radio).toHaveAttribute("aria-invalid", "true");
    await expect(radio).toHaveAttribute("aria-errormessage", "monthly-error");
    await expect(page.getByText("Monthly", { exact: true })).toHaveAttribute(
      "for",
      "monthly",
    );
  });

  test("renders native Radio focus, disabled state, and checked behavior", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderRadioGroup(
      page,
      { legend: "Choice" },
      [
        { id: "radio-a", label: "Alpha", name: "choice", value: "a" },
        {
          disabled: true,
          id: "radio-b",
          label: "Beta",
          name: "choice",
          value: "b",
        },
      ],
    );

    const alpha = page.locator("#radio-a");
    await page.keyboard.press("Tab");
    await expect(alpha).toBeFocused();
    await expect(alpha).toHaveCSS("height", "20px");
    await expect(alpha).toHaveCSS("width", "20px");
    await expect(alpha).toHaveCSS("outline-width", "2px");
    await page.keyboard.press("Space");
    await expect(alpha).toBeChecked();
    await expect(page.locator("#radio-b")).toBeDisabled();
    await expect(page.getByText("Beta", { exact: true })).toHaveCSS(
      "color",
      "rgb(93, 113, 133)",
    );
  });

  test("renders native RadioGroup structure, layouts, and associations", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderRadioGroup(
      page,
      {
        "aria-describedby": "caller-description",
        "aria-invalid": false,
        description: "Choose one",
        error: "A choice is required",
        id: "billing-group",
        legend: "Billing cycle",
        orientation: "horizontal",
      },
      [
        { label: "Monthly", name: "billing", value: "monthly" },
        { label: "Yearly", name: "billing", value: "yearly" },
      ],
      true,
    );

    const fieldset = page.locator("#billing-group");
    await expect(fieldset.locator("legend")).toHaveText("Billing cycle");
    await expect(fieldset).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await fieldset.getAttribute("aria-describedby"))?.split(" ") ?? [];
    expect(describedBy[0]).toBe("caller-description");
    expect(describedBy).toHaveLength(3);
    await expect(page.locator(`#${describedBy[1]}`)).toHaveText("Choose one");
    await expect(page.locator(`#${describedBy[2]}`)).toHaveText(
      "A choice is required",
    );
    await expect(fieldset).toHaveAttribute("aria-errormessage", describedBy[2]);
    await expect(fieldset.locator(":scope > div")).toHaveCSS("display", "flex");
    expect((await choiceHarnessState(page)).fieldsetRefConnected).toBe(true);
    await expect(
      page
        .locator("#choice-root")
        .locator('[role="radiogroup"], [role="alert"], [aria-live]'),
    ).toHaveCount(0);

    await setChoiceContent(page);
    await renderRadioGroup(
      page,
      { legend: "Vertical", orientation: "vertical" },
      [{ label: "One", name: "vertical", value: "one" }],
    );
    await expect(page.locator("fieldset > div")).toHaveCSS("display", "grid");
  });

  test("uses native disabled fieldset behavior without cloning Radios", async ({
    page,
  }) => {
    await setChoiceContent(page);
    await renderRadioGroup(
      page,
      { disabled: true, legend: "Disabled group" },
      [
        { label: "First", name: "disabled-group", value: "first" },
        { label: "Second", name: "disabled-group", value: "second" },
      ],
    );

    await expect(page.locator("fieldset")).toHaveAttribute("disabled", "");
    await expect(page.getByRole("radio", { name: "First" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Second" })).toBeDisabled();
    await page.getByText("First", { exact: true }).click({ force: true });
    await expect(page.getByRole("radio", { name: "First" })).not.toBeChecked();
    expect(radioGroupSource).not.toContain("cloneElement");
  });

  test("retains Chromium native radio arrow and tab behavior", async ({ page }) => {
    await setChoiceContent(page);
    await renderRadioGroup(
      page,
      { legend: "Native keyboard" },
      [
        {
          defaultChecked: true,
          id: "keyboard-one",
          label: "One",
          name: "keyboard",
          trackChange: true,
          value: "one",
        },
        {
          id: "keyboard-two",
          label: "Two",
          name: "keyboard",
          trackChange: true,
          value: "two",
        },
        {
          id: "keyboard-three",
          label: "Three",
          name: "keyboard",
          trackChange: true,
          value: "three",
        },
      ],
    );

    await page.locator("#keyboard-one").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#keyboard-two")).toBeChecked();
    await expect(page.locator("#keyboard-two")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#keyboard-one")).toBeChecked();
    await expect(page.locator("#keyboard-one")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#after-group")).toBeFocused();
    expect((await choiceHarnessState(page)).changeCount).toBe(2);
  });

  test("discovers choice-control utilities through the product src root", async ({
    page,
  }) => {
    const compilation = await productCss();
    const requiredCandidates = [
      "grid-cols-[1.25rem_minmax(0,1fr)]",
      "accent-action-primary",
      "disabled:accent-content-muted",
      "focus-visible:outline-focus",
      "aria-invalid:outline-status-danger",
      "aria-invalid:focus-visible:outline-status-danger",
      "text-content-primary",
      "text-content-muted",
      "text-status-danger",
      "flex-wrap",
      "gap-x-6",
      "gap-y-2",
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

  test("keeps choice controls responsive and product-logic free", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await setChoiceContent(page);
    await renderRadioGroup(
      page,
      { legend: "Responsive choices", orientation: "horizontal" },
      [
        {
          description: "A description that wraps without clipping the viewport",
          label: "A deliberately long first choice label",
          name: "responsive",
          value: "first",
        },
        {
          error: "A safe validation message that remains aligned",
          label: "A deliberately long second choice label",
          name: "responsive",
          value: "second",
        },
      ],
    );

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    for (const source of [checkboxSource, radioGroupSource]) {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(source).not.toContain("fetch(");
      expect(source).not.toContain("supabase");
      expect(source).not.toContain("Authorization");
      expect(source).not.toContain("tenantId");
      expect(source).not.toContain("cloneElement");
      expect(source).not.toContain("aria-live");
      expect(source).not.toContain('role="alert"');
    }
  });
});

test.describe("UIX-1C3D FormField association", () => {
  test("keeps FormField synchronous, shared, and environment-neutral", () => {
    const contract = typescriptSourceContract(formFieldSource);
    const useIdCalls = contract.calls.filter(({ name }) => name === "useId");
    const modeDetectionPosition = formFieldSource.indexOf(
      'typeof children === "function"',
    );

    expect(contract.directives).not.toContain("use client");
    expect(useIdCalls).toHaveLength(1);
    expect(useIdCalls[0]?.position).toBeLessThan(modeDetectionPosition);
    for (const forbiddenIdentifier of [
      "cloneElement",
      "createContext",
      "document",
      "useCallback",
      "useEffect",
      "useLayoutEffect",
      "useMemo",
      "useState",
      "window",
    ]) {
      expect(contract.identifiers.has(forbiddenIdentifier), forbiddenIdentifier).toBe(
        false,
      );
    }
    expect(formFieldSource).not.toContain("aria-required");
    expect(formFieldSource).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(formFieldSource).toContain(
      '"block text-sm font-semibold text-content-primary"',
    );
    expect(formFieldSource).toContain('"text-xs leading-5 text-content-muted"');
    expect(formFieldSource).toContain(
      '"text-xs font-medium leading-5 text-status-danger"',
    );
    expect(formFieldSource).toContain('"ml-1 text-status-danger"');
  });

  test("preserves legacy children, IDs, associations, and wrapper order", async ({
    page,
  }) => {
    await openFormFieldSsr(page);
    const fixture = page.locator('[data-case="legacy"]');
    const wrapper = fixture.locator(":scope > div");
    const label = fixture.locator("label");
    const control = fixture.locator('input[data-proof="untouched"]');
    const paragraphs = fixture.locator("p");
    await expect(wrapper).toHaveAttribute("class", "space-y-2 caller-wrapper");
    await expect(label).toHaveAttribute("for", "legacy-control");
    await expect(control).toHaveAttribute("id", "legacy-control");
    await expect(control).toHaveAttribute("class", "caller-control");
    await expect(control).not.toHaveAttribute("aria-describedby", /.+/);
    await expect(control).not.toHaveAttribute("aria-errormessage", /.+/);
    await expect(control).not.toHaveAttribute("aria-invalid", /.+/);
    await expect(control).not.toHaveAttribute("disabled", "");
    await expect(control).not.toHaveAttribute("required", "");
    await expect(control).toHaveAccessibleName("Legacy field");
    await expect(paragraphs.nth(0)).toHaveText("Legacy description");
    await expect(paragraphs.nth(1)).toHaveText("Legacy error");
    await expect(paragraphs.nth(0)).not.toHaveAttribute("id", /.+/);
    await expect(paragraphs.nth(1)).not.toHaveAttribute("id", /.+/);
    await expect(label.locator("span")).toHaveText("*");
    await expect(label.locator("span")).toHaveAttribute("aria-hidden", "true");
    expect(
      await wrapper.locator(":scope > *").evaluateAll((elements) =>
        elements.map((element) => element.tagName),
      ),
    ).toEqual(["LABEL", "P", "INPUT", "P"]);
  });

  test("preserves the no-htmlFor multi-child visibility command group", async ({
    page,
  }) => {
    await openFormFieldSsr(page);
    const fixture = page.locator('[data-case="command-group"]');
    await expect(fixture.locator("label")).not.toHaveAttribute("for", /.+/);
    await expect(fixture.locator('[data-command-group="visibility"] button'))
      .toHaveCount(2);
    await expect(fixture.getByText("Draft stays private.")).toBeVisible();
    expect(await fixture.innerHTML()).not.toContain("ignored-command-id");
  });

  test("uses generated IDs deterministically and uniquely during SSR", async ({
    page,
  }) => {
    await openFormFieldSsr(page);
    const fixture = page.locator('[data-case="generated"]');
    const firstId = await fixture.locator('[name="first"]').getAttribute("id");
    const secondId = await fixture.locator('[name="second"]').getAttribute("id");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
    await expect(fixture.getByText("Field first")).toHaveAttribute("for", firstId!);
    await expect(fixture.getByText("Field second")).toHaveAttribute("for", secondId!);
    await expect(page.locator("body")).toHaveAttribute("data-deterministic", "true");
  });

  test("applies controlId, htmlFor, and generated precedence exactly", async ({
    page,
  }) => {
    await openFormFieldSsr(page);
    const fixture = page.locator('[data-case="precedence"]');
    await expect(fixture.locator('[name="html-for"]')).toHaveAttribute(
      "id",
      "html-for-control",
    );
    await expect(fixture.getByText("HTML fallback")).toHaveAttribute(
      "for",
      "html-for-control",
    );
    await expect(fixture.locator('[name="control-id"]')).toHaveAttribute(
      "id",
      "explicit-control",
    );
    await expect(fixture.locator('[name="precedence"]')).toHaveAttribute(
      "id",
      "winning-control",
    );
    await expect(fixture.getByText("Precedence")).toHaveAttribute(
      "for",
      "winning-control",
    );
    expect(await fixture.innerHTML()).not.toContain("losing-html-for");
  });

  test("composes description and error metadata without live semantics", async ({
    page,
  }) => {
    await openFormFieldSsr(page);
    const fixture = page.locator('[data-case="metadata"]');
    await expect(fixture.locator('[name="description"]')).toHaveAttribute(
      "aria-describedby",
      "description-control-description",
    );
    await expect(fixture.locator("#description-control-description")).toHaveText(
      "Description only",
    );
    await expect(fixture.locator('[name="error"]')).toHaveAttribute(
      "aria-describedby",
      "error-control-error",
    );
    await expect(fixture.locator('[name="error"]')).toHaveAttribute(
      "aria-errormessage",
      "error-control-error",
    );
    await expect(fixture.locator('[name="error"]')).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(fixture.locator('[name="both"]')).toHaveAttribute(
      "aria-describedby",
      "both-control-description both-control-error",
    );
    await expect(fixture.locator('[name="both"]')).toHaveAttribute(
      "aria-errormessage",
      "both-control-error",
    );
    await expect(fixture.locator('[name="neither"]')).not.toHaveAttribute(
      "aria-describedby",
      /.+/,
    );
    await expect(fixture.locator('[name="neither"]')).not.toHaveAttribute(
      "aria-invalid",
      /.+/,
    );
    await expect(fixture.locator("[role=alert], [aria-live], [aria-atomic]"))
      .toHaveCount(0);
  });

  test("spreads native required and disabled metadata into production controls", async ({
    page,
  }) => {
    await openFormFieldSsr(page);
    const fixture = page.locator('[data-case="spread"]');
    const input = fixture.locator('[name="input-spread"]');
    const textarea = fixture.locator('[name="textarea-spread"]');
    const select = fixture.locator('[name="select-spread"]');
    await expect(input).toHaveAttribute("type", "email");
    await expect(input).toHaveAttribute("required", "");
    await expect(input).not.toHaveAttribute("aria-required", /.+/);
    await expect(textarea).toBeDisabled();
    await expect(textarea).not.toHaveAttribute("required", "");
    await expect(select).not.toHaveAttribute("required", "");
    await expect(select).not.toHaveAttribute("disabled", "");
    await expect(select.locator("option")).toHaveText("Starter");
  });

  test("preserves frozen light and dark classes including the accessible marker", async ({
    page,
  }) => {
    await openFormFieldSsr(page);
    const fixture = page.locator('[data-case="tones"]');
    const labels = fixture.locator("label");
    const descriptions = fixture.locator("p");
    await expect(labels.nth(0)).toHaveClass(
      "block text-sm font-semibold text-content-primary",
    );
    await expect(labels.nth(0).locator("span")).toHaveClass(
      "ml-1 text-status-danger",
    );
    await expect(descriptions.nth(0)).toHaveClass(
      "text-xs leading-5 text-content-muted",
    );
    await expect(descriptions.nth(1)).toHaveClass(
      "text-xs font-medium leading-5 text-status-danger",
    );
    await expect(labels.nth(1)).toHaveClass(
      "block text-sm font-semibold text-slate-200",
    );
    await expect(labels.nth(1).locator("span")).toHaveClass(
      "ml-1 text-status-danger",
    );
    await expect(descriptions.nth(2)).toHaveClass(
      "text-xs leading-5 text-slate-300",
    );
    await expect(descriptions.nth(3)).toHaveClass(
      "text-xs font-medium leading-5 text-red-300",
    );
  });

  test("discovers FormField semantic utilities only through product roots", async ({
    page,
  }) => {
    const compilation = await productCss();
    const requiredCandidates = [
      "text-content-primary",
      "text-content-muted",
      "text-status-danger",
      "text-red-300",
    ] as const;
    const selectors = await page.evaluate(
      (candidates) => candidates.map((candidate) => `.${CSS.escape(candidate)}`),
      requiredCandidates,
    );
    for (const [index, candidate] of requiredCandidates.entries()) {
      expect(compilation.css, candidate).toContain(selectors[index]);
    }
    expect(globalsSource).toContain('@source "../app";');
    expect(globalsSource).toContain('@source "../src";');
    expect(globalsSource).not.toContain('@source "../support-ops";');
    expect(globalsSource).not.toContain('@source "../tests";');
  });

  test("keeps actual server and hydrated FormField relationships identical", async ({
    page,
  }) => {
    if (!choiceHarnessUrl) {
      throw new Error("Choice-control harness was not started.");
    }
    const url = `${choiceHarnessUrl}/form-field`;
    const response = await fetch(url, { cache: "no-store" });
    expect(response.status).toBe(200);
    const serverHtml = await response.text();
    const inputTag = serverHtml.match(
      /<input(?=[^>]*data-hydration-control="true")[^>]*>/,
    )?.[0];
    const labelTag = serverHtml.match(/<label[^>]*>Hydrated email/)?.[0];
    expect(inputTag).toBeTruthy();
    expect(labelTag).toBeTruthy();
    const server = {
      describedBy: tagAttribute(inputTag!, "aria-describedby"),
      errorMessage: tagAttribute(inputTag!, "aria-errormessage"),
      id: tagAttribute(inputTag!, "id"),
      labelFor: tagAttribute(labelTag!, "for"),
    };
    expect(server.id).toBeTruthy();
    expect(server.labelFor).toBe(server.id);

    let consoleErrors = 0;
    let pageErrors = 0;
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors += 1;
    });
    page.on("pageerror", () => {
      pageErrors += 1;
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(250);
    const hydrated = await page
      .locator('[data-hydration-control="true"]')
      .evaluate((control) => ({
        describedBy: control.getAttribute("aria-describedby"),
        errorMessage: control.getAttribute("aria-errormessage"),
        id: control.id,
      }));
    const hydratedLabelFor = await page.locator("label").getAttribute("for");

    expect(hydrated.id).toBe(server.id);
    expect(hydratedLabelFor).toBe(server.labelFor);
    expect(hydrated.describedBy).toBe(server.describedBy);
    expect(hydrated.errorMessage).toBe(server.errorMessage);
    expect(consoleErrors).toBe(0);
    expect(pageErrors).toBe(0);
  });
});
