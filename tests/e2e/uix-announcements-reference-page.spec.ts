import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { basename, join, relative } from "node:path";

import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __announcementMutations?: number;
    __announcementReads?: unknown[];
  }
}

const root = process.cwd();
const announcementsPath = join(
  root,
  "src",
  "components",
  "announcements",
  "AnnouncementsPageClient.tsx",
);
const routePath = join(root, "app", "app", "announcements", "page.tsx");
const globalsPath = join(root, "app", "globals.css");
const announcementsSource = readFileSync(announcementsPath, "utf8");
const routeSource = readFileSync(routePath, "utf8");
const runtimeRoot = join(
  root,
  "support-ops",
  "runtime-tests",
  "uix-1e5b-announcements",
);
const focusedScreenshots = join(runtimeRoot, "focused");

const frozenHashes = {
  Card: "3366d932a8d016eee53d641e0657921c6b570fbc11bb99e7fc95c4a1762e5ce7",
  EmptyState:
    "387a96f05b082b7f367def9ac2a23ce0f9a858445bddbc84d5a98e507dcb8041",
  PageContainer:
    "9d52b3896bfc0839cd4c265dc7eb5b52b717393858442367e780523b0ecf38ba",
  PageHeader:
    "7192e28cc8b1a4e0fa1d8264365a7d6735f1685cd897dbdbece9195443115f41",
  PageToolbar:
    "55b68dbfc4d452d57881e8b696e5e4445e9b1318def7dcd6b2e2e0aadecaebad",
  SectionHeader:
    "febd7464dde1de19222f2bf13cbf35f5e46e6ef4cfe7aca91243e329e45436ec",
  StatCard:
    "e2bb86541eba1c3294e3a2fc7c6a685facbb5aa4006bc80b768ef6c3601eac81",
} as const;

const uiFiles = [
  "Badge.tsx",
  "Button.tsx",
  "buttonStyles.ts",
  "Card.tsx",
  "EmptyState.tsx",
  "FeedbackAlert.tsx",
  "FormField.tsx",
  "PageContainer.tsx",
  "PageHeader.tsx",
  "PageToolbar.tsx",
] as const;

const widthMatrix = [
  { available: 350, viewport: { height: 844, width: 390 } },
  { available: 390, viewport: { height: 932, width: 430 } },
  { available: 720, viewport: { height: 1024, width: 768 } },
  { available: 772, viewport: { height: 1180, width: 820 } },
  { available: 975, viewport: { height: 768, width: 1023 } },
  { available: 672, viewport: { height: 768, width: 1024 } },
  { available: 928, viewport: { height: 800, width: 1280 } },
  { available: 1088, viewport: { height: 900, width: 1440 } },
] as const;

let harnessDirectory: string | undefined;
let harnessProcess: ChildProcess | undefined;
let harnessUrl: string | undefined;

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function productConsumers(component: "PageContainer" | "PageToolbar") {
  return [join(root, "app"), join(root, "src")]
    .flatMap(sourceFiles)
    .filter((path) => basename(path) !== `${component}.tsx`)
    .filter((path) => new RegExp(`<${component}\\b`).test(readFileSync(path, "utf8")))
    .map((path) => relative(root, path).replaceAll("\\", "/"));
}

function expectClose(actual: number, expected: number, tolerance = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

async function availableLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
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
      throw new Error(`Announcements harness exited early.\n${output()}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The isolated loopback app is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Announcements harness startup timed out.\n${output()}`);
}

async function buildHarness() {
  mkdirSync(runtimeRoot, { recursive: true });
  rmSync(focusedScreenshots, { force: true, recursive: true });
  mkdirSync(focusedScreenshots, { recursive: true });
  harnessDirectory = mkdtempSync(join(runtimeRoot, "announcements-reference-"));

  const appDirectory = join(harnessDirectory, "app");
  const announcementsDirectory = join(
    harnessDirectory,
    "src",
    "components",
    "announcements",
  );
  const uiDirectory = join(harnessDirectory, "src", "components", "ui");
  const libDirectory = join(harnessDirectory, "src", "lib");
  mkdirSync(appDirectory, { recursive: true });
  mkdirSync(announcementsDirectory, { recursive: true });
  mkdirSync(uiDirectory, { recursive: true });
  mkdirSync(libDirectory, { recursive: true });

  copyFileSync(
    announcementsPath,
    join(announcementsDirectory, "AnnouncementsPageClient.tsx"),
  );
  copyFileSync(globalsPath, join(appDirectory, "globals.css"));
  for (const file of uiFiles) {
    copyFileSync(join(root, "src", "components", "ui", file), join(uiDirectory, file));
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
import "./globals.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
  );
  writeFileSync(
    join(appDirectory, "page.tsx"),
    `import { AnnouncementsPageClient } from "@/src/components/announcements/AnnouncementsPageClient";

export default function Page() {
  return (
    <div id="shell" className="min-w-0 lg:pl-72">
      <main id="shell-main" className="min-w-0 px-5 sm:px-6 lg:px-8 py-8">
        <AnnouncementsPageClient />
      </main>
    </div>
  );
}
`,
  );
  writeFileSync(
    join(libDirectory, "announcements.ts"),
    `export type AcademyAnnouncementStatus = "archived" | "draft" | "published";
export type AnnouncementAudience = "cohort" | "program" | "tenant";
export type AnnouncementWriteInput = {
  audienceType: AnnouncementAudience;
  body: string;
  cohortId: string | null;
  courseId: string | null;
  expiresAt: string | null;
  title: string;
};
export type TeamAnnouncementSummary = {
  archived_at: string | null;
  audience_type: AnnouncementAudience;
  body_preview: string;
  cohort_id: string | null;
  cohort_name: string | null;
  course_id: string | null;
  course_title: string | null;
  created_at: string;
  expires_at: string | null;
  id: string;
  in_app_recipient_count: number;
  published_at: string | null;
  read_count: number;
  status: AcademyAnnouncementStatus;
  title: string;
  unread_count: number;
  updated_at: string;
};
export type TeamAnnouncementDetail = Omit<TeamAnnouncementSummary, "body_preview"> & { body: string };

declare global {
  interface Window {
    __announcementMutations?: number;
    __announcementReads?: Array<Record<string, unknown>>;
  }
}

const baseAnnouncement: TeamAnnouncementSummary = {
  archived_at: null,
  audience_type: "tenant",
  body_preview: "A source-faithful announcement preview that remains bounded across the full responsive matrix.",
  cohort_id: null,
  cohort_name: null,
  course_id: null,
  course_title: null,
  created_at: "2026-09-20T00:00:00.000Z",
  expires_at: null,
  id: "11111111-1111-4111-8111-111111111111",
  in_app_recipient_count: 12,
  published_at: null,
  read_count: 5,
  status: "draft",
  title: "Reference announcement with a bounded long title",
  unread_count: 7,
  updated_at: "2026-10-02T00:00:00.000Z",
};

function state() {
  return new URLSearchParams(window.location.search).get("state") ?? "loaded";
}

export async function getTeamAnnouncementsV2(input: Record<string, unknown>) {
  window.__announcementReads = [...(window.__announcementReads ?? []), input];
  if (state() === "loading") return new Promise<TeamAnnouncementSummary[]>(() => undefined);
  if (state() === "error") throw new Error("Unable to load announcements.");
  if (state() === "empty" || input.status === "archived") return [];
  if (state() === "more") {
    if (input.cursor) return [];
    return Array.from({ length: 25 }, (_, index) => ({
      ...baseAnnouncement,
      id: \`11111111-1111-4111-8111-\${String(index).padStart(12, "0")}\`,
      title: \`Reference announcement \${index + 1}\`,
    }));
  }
  return [baseAnnouncement];
}

export async function getTeamAnnouncementV2() {
  return { ...baseAnnouncement, body: baseAnnouncement.body_preview };
}
export function formatAnnouncementDate(value: string | null | undefined) {
  return value ? "2 Oct 2026, 5:30 am" : "Not set";
}
async function mutation(): Promise<never> {
  window.__announcementMutations = (window.__announcementMutations ?? 0) + 1;
  throw new Error("The visual harness does not submit mutations.");
}
export const archiveAcademyAnnouncementV2 = mutation;
export const createAcademyAnnouncementV2 = mutation;
export const deleteDraftAcademyAnnouncementV2 = mutation;
export const publishAcademyAnnouncementV2 = mutation;
export const updateAcademyAnnouncementV2 = mutation;
`,
  );
  writeFileSync(
    join(libDirectory, "announcementManagement.ts"),
    `import type { AnnouncementAudience, AnnouncementWriteInput, TeamAnnouncementSummary } from "@/src/lib/announcements";
export type AnnouncementCapabilityContext = {
  cohorts: Array<{ course_id: string; course: { title: string } | null; id: string; name: string }>;
  permissions: unknown[];
  programs: Array<{ id: string; title: string }>;
  role: "admin" | "owner" | "staff" | "trainer" | null;
  trainerCohortIds: string[];
  trainerCourseIds: string[];
};
export type AnnouncementCapabilities = {
  allowedAudiences: AnnouncementAudience[];
  canCreate: boolean;
  cohorts: Array<{ courseId: string; id: string; label: string; programLabel: string }>;
  programs: Array<{ courseId: string; id: string; label: string }>;
};
export function buildAnnouncementCapabilities(context: AnnouncementCapabilityContext): AnnouncementCapabilities {
  return {
    allowedAudiences: context.role === "owner" || context.role === "admin" ? ["tenant", "program", "cohort"] : [],
    canCreate: context.role === "owner" || context.role === "admin",
    cohorts: context.cohorts.map((item) => ({ courseId: item.course_id, id: item.id, label: item.name, programLabel: item.course?.title ?? "Program unavailable" })),
    programs: context.programs.map((item) => ({ courseId: item.id, id: item.id, label: item.title })),
  };
}
export function canManageAnnouncementScope(context: AnnouncementCapabilityContext) { return context.role === "owner" || context.role === "admin"; }
export function getAnnouncementAudienceLabel(announcement: Pick<TeamAnnouncementSummary, "audience_type" | "cohort_name" | "course_title">) {
  return announcement.audience_type === "tenant" ? "All students" : announcement.audience_type === "program" ? \`Program: \${announcement.course_title ?? "Program"}\` : \`Cohort: \${announcement.cohort_name ?? "Cohort"}\`;
}
export function getAnnouncementErrorMessage(_caught: unknown, fallback = "Unable to complete the announcement action.") { return fallback; }
export function buildAnnouncementWriteInput(input: { audienceType: AnnouncementAudience; body: string; cohortId: string; courseId: string; expiresAt: string | null; title: string }): AnnouncementWriteInput {
  return { ...input, cohortId: input.cohortId || null, courseId: input.courseId || null };
}
export async function executeAnnouncementMutation(input: { mutate: () => Promise<unknown>; onMutationSuccess: () => void; refresh: () => Promise<boolean> }) {
  try { await input.mutate(); } catch (mutationError) { return { mutationError, mutationSucceeded: false as const, refreshSucceeded: false }; }
  input.onMutationSuccess();
  return { mutationSucceeded: true as const, refreshSucceeded: await input.refresh() };
}
`,
  );
  writeFileSync(
    join(libDirectory, "cohorts.ts"),
    `export async function getCohortsForTenant() { return [{ course_id: "44444444-4444-4444-8444-444444444444", course: { title: "Reference Program" }, id: "55555555-5555-4555-8555-555555555555", name: "Reference Cohort" }]; }
`,
  );
  writeFileSync(
    join(libDirectory, "courses.ts"),
    `export async function getCoursesForTenant() { return [{ id: "44444444-4444-4444-8444-444444444444", title: "Reference Program" }]; }
`,
  );
  writeFileSync(
    join(libDirectory, "delegatedPermissions.ts"),
    `export type DelegatedPermission = { permission_key: string };
export async function getUserDelegatedPermissions(): Promise<DelegatedPermission[]> { return []; }
`,
  );
  writeFileSync(
    join(libDirectory, "supabaseClient.ts"),
    `export function getSupabaseClient() { return { auth: { getUser: async () => ({ data: { user: { id: "33333333-3333-4333-8333-333333333333" } }, error: null }) } }; }
`,
  );
  writeFileSync(
    join(libDirectory, "team.ts"),
    `export type MemberRole = "admin" | "owner" | "staff" | "trainer";
export async function getCurrentMemberRole(): Promise<MemberRole> { return "owner"; }
`,
  );
  writeFileSync(
    join(libDirectory, "tenant.ts"),
    `export type Tenant = { id: string; name: string; slug: string };
export async function getCurrentTenant(): Promise<Tenant> { return { id: "22222222-2222-4222-8222-222222222222", name: "CoachFort Regression 2026", slug: "coachfort-regression-2026" }; }
`,
  );
  writeFileSync(
    join(libDirectory, "trainerAssignments.ts"),
    `export async function getCurrentTrainerScope() { return null; }
`,
  );

  const nextDirectory = join(root, "node_modules", "next");
  const nextPackage = JSON.parse(
    readFileSync(join(nextDirectory, "package.json"), "utf8"),
  ) as { bin?: { next?: string } };
  if (!nextPackage.bin?.next) throw new Error("Next CLI is unavailable.");

  const port = await availableLoopbackPort();
  harnessUrl = `http://127.0.0.1:${port}`;
  harnessProcess = spawn(
    process.execPath,
    [
      join(nextDirectory, nextPackage.bin.next),
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
  await waitForHarness(harnessProcess, harnessUrl, () => output);
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
}

async function openHarness(page: Page, state = "loaded") {
  if (!harnessUrl) throw new Error("Announcements harness was not started.");
  await page.goto(`${harnessUrl}?state=${state}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Announcements" }),
  ).toBeVisible();
  if (state === "loaded") {
    await expect(
      page.getByText("Reference announcement with a bounded long title"),
    ).toBeVisible();
  }
}

test.describe("UIX-1E5B Announcements reference page", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await buildHarness();
  });

  test.afterAll(async () => {
    await stopHarness();
  });

  test("keeps the exact protected route and client ownership", () => {
    expect(routeSource).toContain(
      'import { AnnouncementsPageClient } from "@/src/components/announcements/AnnouncementsPageClient";',
    );
    expect(routeSource).toContain('<RouteGuard mode="app">');
    expect(routeSource).toContain('<AppShell activeItem="Announcements">');
    expect(routeSource).toContain('<FeatureGate featureKey="messages">');
    expect(routeSource).toContain("<AnnouncementsPageClient />");
  });

  test("uses full-width PageContainer rhythm without a competing root width", () => {
    expect(announcementsSource).toContain(
      '<PageContainer className="flex flex-col gap-8" width="full">',
    );
    expect(announcementsSource).not.toContain('className="mx-auto max-w-7xl');
    expect(announcementsSource.match(/<h1\b/g) ?? []).toHaveLength(0);
    expect(announcementsSource.match(/<h2\b/g) ?? []).toHaveLength(2);
  });

  test("assigns the primary command to PageHeader and query controls to PageToolbar", () => {
    const headerStart = announcementsSource.indexOf("<PageHeader");
    const toolbarStart = announcementsSource.indexOf("<PageToolbar", headerStart);
    const toolbarEnd = announcementsSource.indexOf("</PageToolbar>", toolbarStart);
    const headerSource = announcementsSource.slice(headerStart, toolbarStart);
    const toolbarSource = announcementsSource.slice(toolbarStart, toolbarEnd);

    expect(headerSource).toContain('title="Announcements"');
    expect(headerSource).toContain("New announcement");
    expect(headerSource).toContain("capabilities.canCreate");
    expect(headerSource).not.toContain("Refresh");
    expect(toolbarSource).toContain('label="Announcement controls"');
    expect(toolbarSource).toContain('label="Status"');
    expect(toolbarSource).toContain('label="Audience"');
    expect(toolbarSource).toContain("Refresh");
    expect(toolbarSource).not.toContain("New announcement");
    expect(toolbarSource.indexOf("announcement-status-filter")).toBeLessThan(
      toolbarSource.indexOf("announcement-audience-filter"),
    );
    const toolbarPrimitive = readFileSync(
      join(root, "src", "components", "ui", "PageToolbar.tsx"),
      "utf8",
    );
    expect(toolbarPrimitive.indexOf("{children}")).toBeLessThan(
      toolbarPrimitive.indexOf("{actions}"),
    );
  });

  test("preserves filter options, handlers, refresh, states, list, and pagination", () => {
    for (const source of [
      '{ label: "All", value: "all" }',
      '{ label: "Draft", value: "draft" }',
      '{ label: "Published", value: "published" }',
      '{ label: "Archived", value: "archived" }',
      '{ label: "All audiences", value: "all" }',
      '{ label: "All students", value: "tenant" }',
      '{ label: "Program", value: "program" }',
      '{ label: "Cohort", value: "cohort" }',
      "filtersRef.current.status = next",
      "void loadList({ status: next })",
      "filtersRef.current.audience = next",
      "void loadList({ audience: next })",
      "onClick={() => void loadList()}",
      'aria-label="Loading announcements"',
      'title={filterActive ? "No matching announcements" : "No announcements yet"}',
      'aria-label="Announcement list"',
      "announcements.map((announcement)",
      "void loadList({ append: true })",
      ">Load more</Button>",
    ]) {
      expect(announcementsSource).toContain(source);
    }
  });

  test("does not change announcement data, tenant, role, capability, or mutation authority", () => {
    for (const authority of [
      "getCurrentTenant()",
      "getSupabaseClient()",
      "getCurrentMemberRole(currentTenant.id, user.id)",
      "getTeamAnnouncementsV2({",
      "loadCapabilityContext(currentTenant.id, currentRole)",
      "buildAnnouncementCapabilities(context)",
      "canManageAnnouncementScope(",
      "createAcademyAnnouncementV2(tenant.id, write)",
      "updateAcademyAnnouncementV2(editingId, write)",
      "publishAcademyAnnouncementV2(announcement.id)",
      "archiveAcademyAnnouncementV2(announcement.id)",
      "deleteDraftAcademyAnnouncementV2(announcement.id)",
    ]) {
      expect(announcementsSource).toContain(authority);
    }
    expect(announcementsSource).not.toMatch(
      /supabase\.(?:from|rpc)\(|\bfetch\(/,
    );
  });

  test("locks PageContainer and first PageToolbar product adoption", () => {
    expect(productConsumers("PageContainer")).toEqual([
      "src/components/announcements/AnnouncementsPageClient.tsx",
      "src/components/courses/CoursesPageClient.tsx",
    ]);
    expect(productConsumers("PageToolbar")).toEqual([
      "src/components/announcements/AnnouncementsPageClient.tsx",
    ]);
  });

  test("leaves every frozen shared primitive byte-identical", () => {
    for (const [name, expected] of Object.entries(frozenHashes)) {
      expect(sha256(join(root, "src", "components", "ui", `${name}.tsx`))).toBe(
        expected,
      );
    }
  });

  test("renders loaded content and bounded toolbar across all eight viewports", async ({
    page,
  }) => {
    await openHarness(page);
    for (const entry of widthMatrix) {
      await page.setViewportSize(entry.viewport);
      const shellMain = page.locator("#shell-main");
      const available = await shellMain.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.getBoundingClientRect().width -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)
        );
      });
      expectClose(available, entry.available);
      const containerWidth = await shellMain
        .locator(":scope > div")
        .evaluate((element) => element.getBoundingClientRect().width);
      expectClose(containerWidth, entry.available);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await expect(page.getByRole("group", { name: "Announcement controls" })).toBeVisible();
      await expect(page.getByLabel("Status")).toBeVisible();
      await expect(page.getByLabel("Audience")).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByRole("button", { name: "New announcement" })).toBeVisible();

      if ([390, 768, 1024, 1440].includes(entry.viewport.width)) {
        await page.screenshot({
          fullPage: true,
          path: join(
            focusedScreenshots,
            `${entry.viewport.width}x${entry.viewport.height}.png`,
          ),
        });
      }
    }
  });

  test("keeps the 1023/1024 shell transition, controls, and item surfaces bounded", async ({
    page,
  }) => {
    await openHarness(page);
    for (const expected of [
      { available: 975, width: 1023 },
      { available: 672, width: 1024 },
    ]) {
      await page.setViewportSize({ height: 768, width: expected.width });
      const geometry = await page.locator("#shell-main").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          available:
            element.getBoundingClientRect().width -
            Number.parseFloat(style.paddingLeft) -
            Number.parseFloat(style.paddingRight),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expectClose(geometry.available, expected.available);
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      await expect(page.getByLabel("Status")).toBeInViewport();
      await expect(page.getByLabel("Audience")).toBeInViewport();
      await expect(page.getByRole("button", { name: "Refresh" })).toBeInViewport();
    }
  });

  test("renders loading, error, true-empty, and filtered-empty states", async ({ page }) => {
    await openHarness(page, "loading");
    await expect(page.getByText("Loading")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();

    await openHarness(page, "error");
    await expect(page.getByText("Unable to load announcements.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    await openHarness(page, "empty");
    await expect(
      page.getByRole("heading", { level: 3, name: "No announcements yet" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft" })).toBeVisible();

    await openHarness(page);
    await page.getByLabel("Status").selectOption("archived");
    await expect(
      page.getByRole("heading", { level: 3, name: "No matching announcements" }),
    ).toBeVisible();
    await expect(
      page.getByText("No announcements match the selected status and audience."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft" })).toHaveCount(0);
  });

  test("keeps filter and Refresh interactions read-only and in native focus order", async ({
    page,
  }) => {
    await openHarness(page);
    const initialReads = await page.evaluate(() => window.__announcementReads?.length ?? 0);
    await page.getByLabel("Audience").selectOption("program");
    await expect.poll(
      () => page.evaluate(() => window.__announcementReads?.length ?? 0),
    ).toBe(initialReads + 1);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(
      () => page.evaluate(() => window.__announcementReads?.length ?? 0),
    ).toBe(initialReads + 2);
    expect(await page.evaluate(() => window.__announcementMutations ?? 0)).toBe(0);

    const toolbarOrder = await page
      .getByRole("group", { name: "Announcement controls" })
      .locator("select, button")
      .evaluateAll((elements) =>
        elements.map((element) =>
          element instanceof HTMLSelectElement
            ? element.id
            : element.textContent?.trim(),
        ),
      );
    expect(toolbarOrder).toEqual([
      "announcement-status-filter",
      "announcement-audience-filter",
      "Refresh",
    ]);

    await page.getByLabel("Status").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Audience")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Refresh" })).toBeFocused();
  });

  test("opens and closes New announcement without submitting a mutation", async ({ page }) => {
    await openHarness(page);
    await page.getByRole("button", { name: "New announcement" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Create announcement" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close Create announcement" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await page.evaluate(() => window.__announcementMutations ?? 0)).toBe(0);
  });

  test("preserves keyset Load more as a read-only list continuation", async ({ page }) => {
    await openHarness(page, "more");
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
    const initialReads = await page.evaluate(() => window.__announcementReads?.length ?? 0);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect.poll(
      () => page.evaluate(() => window.__announcementReads?.length ?? 0),
    ).toBe(initialReads + 1);
    expect(await page.evaluate(() => window.__announcementMutations ?? 0)).toBe(0);
  });

  test("keeps the toolbar unframed and page/list rhythm canonical", async ({ page }) => {
    await openHarness(page);
    const rootContainer = page.locator("#shell-main > div");
    await expect(rootContainer).toHaveCSS("display", "flex");
    await expect(rootContainer).toHaveCSS("row-gap", "32px");
    await expect(rootContainer).toHaveCSS("max-width", "none");
    await expect(rootContainer).toHaveCSS("padding-left", "0px");
    await expect(rootContainer).toHaveCSS("padding-right", "0px");

    const toolbar = page.getByRole("group", { name: "Announcement controls" });
    await expect(toolbar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(toolbar).toHaveCSS("border-top-width", "0px");
    await expect(toolbar).toHaveCSS("padding-left", "0px");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
