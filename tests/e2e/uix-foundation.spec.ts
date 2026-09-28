import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { compile } from "tailwindcss";

const root = process.cwd();
const globalsPath = join(root, "app", "globals.css");
const globalsSource = readFileSync(globalsPath, "utf8");

function extractBlock(source: string, marker: string, fromIndex = 0) {
  const markerIndex = source.indexOf(marker, fromIndex);
  expect(markerIndex, `Missing CSS block: ${marker}`).toBeGreaterThanOrEqual(0);

  const openIndex = source.indexOf("{", markerIndex);
  expect(openIndex, `Missing opening brace for: ${marker}`).toBeGreaterThan(markerIndex);

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }

  throw new Error(`Missing closing brace for: ${marker}`);
}

function declarations(block: string) {
  return new Map(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].replace(/\s+/g, " ").trim(),
    ]),
  );
}

function countDeclaration(source: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escapedName}\\s*:`, "g"))].length;
}

function normalizedSha256(value: string) {
  return createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex");
}

const semanticTokens = {
  "--ui-action-primary": "#145da0",
  "--ui-action-primary-hover": "#0f4c81",
  "--ui-action-primary-subtle": "#eaf7fc",
  "--ui-border-default": "#d8e8f0",
  "--ui-border-strong": "#bfd7e6",
  "--ui-canvas": "#f3fafd",
  "--ui-focus": "#0e7490",
  "--ui-focus-inverse": "#78e4f3",
  "--ui-motion-easing": "cubic-bezier(0.2, 0, 0, 1)",
  "--ui-motion-fast": "120ms",
  "--ui-motion-standard": "180ms",
  "--ui-radius-overlay": "0.75rem",
  "--ui-radius-standard": "0.5rem",
  "--ui-safe-area-bottom": "env(safe-area-inset-bottom, 0px)",
  "--ui-safe-area-left": "env(safe-area-inset-left, 0px)",
  "--ui-safe-area-right": "env(safe-area-inset-right, 0px)",
  "--ui-safe-area-top": "env(safe-area-inset-top, 0px)",
  "--ui-shadow-elevated": "0 8px 24px rgba(11, 42, 61, 0.1)",
  "--ui-shadow-overlay": "0 20px 48px rgba(11, 42, 61, 0.18)",
  "--ui-shadow-surface": "0 1px 2px rgba(11, 42, 61, 0.06)",
  "--ui-status-danger": "#b91c1c",
  "--ui-status-danger-subtle": "#fef2f2",
  "--ui-status-info": "#0369a1",
  "--ui-status-info-subtle": "#f0f9ff",
  "--ui-status-success": "#047857",
  "--ui-status-success-subtle": "#e8f8f3",
  "--ui-status-warning": "#c2410c",
  "--ui-status-warning-subtle": "#fff7ed",
  "--ui-surface": "#ffffff",
  "--ui-surface-elevated": "#ffffff",
  "--ui-surface-inverse": "#0b2a3d",
  "--ui-surface-subtle": "#f7fcff",
  "--ui-text-inverse": "#ffffff",
  "--ui-text-muted": "#5d7185",
  "--ui-text-primary": "#0b1f33",
  "--ui-text-secondary": "#425b76",
  "--ui-viewport-height": "100vh",
} as const;

const themeMappings = {
  "--color-action-primary": "var(--ui-action-primary)",
  "--color-action-primary-hover": "var(--ui-action-primary-hover)",
  "--color-action-primary-subtle": "var(--ui-action-primary-subtle)",
  "--color-canvas": "var(--ui-canvas)",
  "--color-content-inverse": "var(--ui-text-inverse)",
  "--color-content-muted": "var(--ui-text-muted)",
  "--color-content-primary": "var(--ui-text-primary)",
  "--color-content-secondary": "var(--ui-text-secondary)",
  "--color-focus": "var(--ui-focus)",
  "--color-focus-inverse": "var(--ui-focus-inverse)",
  "--color-line": "var(--ui-border-default)",
  "--color-line-strong": "var(--ui-border-strong)",
  "--color-status-danger": "var(--ui-status-danger)",
  "--color-status-danger-subtle": "var(--ui-status-danger-subtle)",
  "--color-status-info": "var(--ui-status-info)",
  "--color-status-info-subtle": "var(--ui-status-info-subtle)",
  "--color-status-success": "var(--ui-status-success)",
  "--color-status-success-subtle": "var(--ui-status-success-subtle)",
  "--color-status-warning": "var(--ui-status-warning)",
  "--color-status-warning-subtle": "var(--ui-status-warning-subtle)",
  "--color-surface": "var(--ui-surface)",
  "--color-surface-elevated": "var(--ui-surface-elevated)",
  "--color-surface-inverse": "var(--ui-surface-inverse)",
  "--color-surface-subtle": "var(--ui-surface-subtle)",
  "--radius-overlay": "var(--ui-radius-overlay)",
  "--radius-ui": "var(--ui-radius-standard)",
  "--shadow-elevated": "var(--ui-shadow-elevated)",
  "--shadow-overlay": "var(--ui-shadow-overlay)",
  "--shadow-surface": "var(--ui-shadow-surface)",
} as const;

const frozenUtilityCandidates = [
  "bg-canvas",
  "bg-surface",
  "bg-surface-subtle",
  "bg-surface-elevated",
  "bg-surface-inverse",
  "text-content-primary",
  "text-content-secondary",
  "text-content-muted",
  "text-content-inverse",
  "border-line",
  "border-line-strong",
  "bg-action-primary",
  "hover:bg-action-primary-hover",
  "bg-action-primary-subtle",
  "outline-focus",
  "ring-focus",
  "outline-focus-inverse",
  "ring-focus-inverse",
  "text-status-success",
  "border-status-success",
  "bg-status-success-subtle",
  "text-status-warning",
  "border-status-warning",
  "bg-status-warning-subtle",
  "text-status-danger",
  "border-status-danger",
  "bg-status-danger-subtle",
  "text-status-info",
  "border-status-info",
  "bg-status-info-subtle",
  "rounded-ui",
  "rounded-overlay",
  "shadow-surface",
  "shadow-elevated",
  "shadow-overlay",
] as const;

test.describe("UIX-1B semantic foundation", () => {
  test("declares every frozen semantic source token once with its exact value", () => {
    const rootDeclarations = declarations(extractBlock(globalsSource, ":root"));

    for (const [name, value] of Object.entries(semanticTokens)) {
      expect(rootDeclarations.get(name), name).toBe(value);
      expect(countDeclaration(globalsSource, name), name).toBe(
        name === "--ui-viewport-height" ? 2 : 1,
      );
    }
  });

  test("exposes every approved Tailwind v4 theme mapping", () => {
    const themeBlock = extractBlock(globalsSource, "@theme inline");
    const mappedDeclarations = declarations(themeBlock);

    for (const [name, value] of Object.entries(themeMappings)) {
      expect(mappedDeclarations.get(name), name).toBe(value);
      expect(countDeclaration(themeBlock, name), name).toBe(1);
    }

    expect(mappedDeclarations.get("--color-background")).toBe("var(--background)");
    expect(mappedDeclarations.get("--color-foreground")).toBe("var(--foreground)");
    expect(mappedDeclarations.get("--font-sans")).toBe("var(--font-geist-sans)");
    expect(mappedDeclarations.get("--font-mono")).toBe("var(--font-geist-mono)");
  });

  test("Tailwind compiles all 35 frozen semantic utility candidates", async () => {
    expect(frozenUtilityCandidates).toHaveLength(35);

    const themeBlock = extractBlock(globalsSource, "@theme inline");
    const compiler = await compile(`@theme inline {${themeBlock}}\n@tailwind utilities;`);
    const output = compiler.build([...frozenUtilityCandidates]);

    for (const candidate of frozenUtilityCandidates) {
      const escapedSelector = candidate.replace(":", "\\:");
      expect(output, candidate).toContain(`.${escapedSelector}`);
    }

    expect(output).toContain("background-color: var(--ui-canvas)");
    expect(output).toContain("color: var(--ui-text-primary)");
    expect(output).toContain("border-color: var(--ui-border-default)");
    expect(output).toContain("outline-color: var(--ui-focus)");
    expect(output).toContain("border-radius: var(--ui-radius-standard)");
    expect(output).toContain("var(--ui-shadow-overlay)");
  });

  test("does not introduce rejected utility token names", async () => {
    const rejected = [
      "text-text-primary",
      "text-text-muted",
      "border-border-default",
      "border-border-strong",
    ];
    const themeBlock = extractBlock(globalsSource, "@theme inline");
    const compiler = await compile(`@theme inline {${themeBlock}}\n@tailwind utilities;`);
    const output = compiler.build(rejected);

    for (const candidate of rejected) {
      expect(globalsSource).not.toContain(candidate);
      expect(output).not.toContain(`.${candidate}`);
    }
  });

  test("preserves legacy variables, color compatibility, and Geist mappings", () => {
    const rootDeclarations = declarations(extractBlock(globalsSource, ":root"));
    const expectedLegacyTokens = {
      "--background": "#f3fafd",
      "--coachos-accent": "#2ecbea",
      "--coachos-brand": "#145da0",
      "--coachos-border": "#d8e8f0",
      "--coachos-muted": "#425b76",
      "--coachos-navy": "#0b2a3d",
      "--coachos-ring": "#2ecbea",
      "--coachos-shadow": "0 12px 30px rgba(11, 42, 61, 0.08)",
      "--coachos-surface": "#ffffff",
      "--coachos-surface-muted": "#f7fcff",
      "--foreground": "#0b1f33",
    };

    for (const [name, value] of Object.entries(expectedLegacyTokens)) {
      expect(rootDeclarations.get(name), name).toBe(value);
    }

    const darkMedia = extractBlock(globalsSource, "@media (prefers-color-scheme: dark)");
    const darkRoot = declarations(extractBlock(darkMedia, ":root"));
    expect(darkRoot.get("--background")).toBe("#f3fafd");
    expect(darkRoot.get("--foreground")).toBe("#0b2a3d");

    const compatibilityStart = globalsSource.indexOf(".coachos-light {");
    expect(compatibilityStart).toBeGreaterThan(0);
    expect(normalizedSha256(globalsSource.slice(compatibilityStart))).toBe(
      "ff64153121d523fab359a2b064b5c3782a0bf47518f1f5d90e7bd662a51915c7",
    );
    expect(globalsSource).toContain(".coachos-light .coachos-content");
  });

  test("implements the exact reduced-motion contract and spinner exceptions", () => {
    expect(globalsSource.match(/@media \(prefers-reduced-motion: reduce\)/g)).toHaveLength(1);

    const reducedMotion = extractBlock(
      globalsSource,
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(reducedMotion).toContain("scroll-behavior: auto;");
    expect(reducedMotion).toContain("animation-delay: 0s !important;");
    expect(reducedMotion).toContain("animation-duration: 0.01ms !important;");
    expect(reducedMotion).toContain("animation-iteration-count: 1 !important;");
    expect(reducedMotion).toContain("transition-delay: 0s !important;");
    expect(reducedMotion).toContain("transition-duration: 0.01ms !important;");
    expect(reducedMotion).toContain(
      ".coachos-float {\n    animation: none !important;\n    transform: none !important;",
    );
    expect(reducedMotion).toContain(
      ".animate-spin,\n  .coachos-spin {\n    animation-duration: 2s !important;\n    animation-iteration-count: infinite !important;",
    );
    expect(reducedMotion).not.toContain(".animate-pulse");
    expect(reducedMotion.indexOf(".coachos-float")).toBeLessThan(
      reducedMotion.indexOf(".animate-spin"),
    );
    expect(reducedMotion.slice(reducedMotion.indexOf(".animate-spin"))).not.toContain(
      ".coachos-float",
    );
  });

  test("defines but does not consume safe-area and dynamic viewport tokens", () => {
    const supportsBlock = extractBlock(globalsSource, "@supports (height: 100dvh)");
    const supportsRoot = declarations(extractBlock(supportsBlock, ":root"));
    expect(supportsRoot.get("--ui-viewport-height")).toBe("100dvh");

    expect(globalsSource.match(/var\(--ui-safe-area-/g) ?? []).toHaveLength(0);
    expect(globalsSource.match(/var\(--ui-viewport-height\)/g) ?? []).toHaveLength(0);
  });

  test("adds no Tailwind config or custom breakpoint contract", () => {
    for (const filename of [
      "tailwind.config.js",
      "tailwind.config.cjs",
      "tailwind.config.mjs",
      "tailwind.config.ts",
    ]) {
      expect(existsSync(join(root, filename)), filename).toBe(false);
    }

    expect(globalsSource).not.toContain("--breakpoint-");
    expect(globalsSource).not.toMatch(/@media\s*\([^)]*(?:min-width|max-width|width\s*[<>]=)/);
  });
});
