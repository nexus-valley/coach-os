import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildAnnouncementCapabilities,
  buildAnnouncementWriteInput,
  canManageAnnouncementScope,
  executeAnnouncementMutation,
  getAnnouncementAudienceLabel,
  getAnnouncementErrorMessage,
  type AnnouncementCapabilityContext,
} from "../../src/lib/announcementManagement";
import type { DelegatedPermission } from "../../src/lib/delegatedPermissions";

const root = process.cwd();
const component = readFileSync(
  join(root, "src/components/announcements/AnnouncementsPageClient.tsx"),
  "utf8",
);
const library = readFileSync(join(root, "src/lib/announcements.ts"), "utf8");
const model = readFileSync(
  join(root, "src/lib/announcementManagement.ts"),
  "utf8",
);

function permission(
  scopeType: "cohort" | "course" | "workspace" | null,
  scopeId: string | null,
  overrides: Partial<DelegatedPermission> = {},
): DelegatedPermission {
  return {
    approved_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    granted_by: null,
    id: `permission-${scopeType}-${scopeId}`,
    metadata_json: {},
    permission_key: "manage_messages",
    reason: null,
    revoked_at: null,
    revoked_by: null,
    scope_id: scopeId,
    scope_type: scopeType,
    starts_at: "2026-01-01T00:00:00.000Z",
    status: "active",
    tenant_id: "workspace-1",
    updated_at: "2026-01-01T00:00:00.000Z",
    user_id: "user-1",
    ...overrides,
  };
}

function context(
  overrides: Partial<AnnouncementCapabilityContext> = {},
): AnnouncementCapabilityContext {
  return {
    cohorts: [
      {
        course: { id: "program-1", title: "Program One" },
        course_id: "program-1",
        created_at: "2026-01-01T00:00:00.000Z",
        description: null,
        end_date: null,
        id: "cohort-1",
        memberCount: 3,
        name: "Cohort One",
        start_date: null,
        tenant_id: "workspace-1",
      },
    ],
    permissions: [],
    programs: [
      {
        access_duration_label: null,
        created_at: "2026-01-01T00:00:00.000Z",
        created_by: null,
        description: null,
        external_payment_url: null,
        id: "program-1",
        payment_instructions: null,
        price_amount: null,
        pricing_type: "free",
        public_sales_enabled: false,
        sales_currency: "INR",
        sales_headline: null,
        sales_payment_mode: "manual",
        sales_summary: null,
        slug: "program-one",
        status: "published",
        tenant_id: "workspace-1",
        thumbnail_url: null,
        title: "Program One",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    role: "owner",
    trainerCohortIds: [],
    trainerCourseIds: [],
    ...overrides,
  };
}

async function successfulMutationWithFailedRefresh() {
  let mutationCalls = 0;
  let successCalls = 0;
  let refreshCalls = 0;
  const outcome = await executeAnnouncementMutation({
    mutate: async () => {
      mutationCalls += 1;
    },
    onMutationSuccess: () => {
      successCalls += 1;
    },
    refresh: async () => {
      refreshCalls += 1;
      throw new Error("read refresh unavailable");
    },
  });

  return { mutationCalls, outcome, refreshCalls, successCalls };
}

test.describe("UX-7C Coach announcement management", () => {
  test("uses only bounded V2 RPCs in the Coach page", () => {
    for (const rpc of [
      "getTeamAnnouncementsV2",
      "getTeamAnnouncementV2",
      "createAcademyAnnouncementV2",
      "updateAcademyAnnouncementV2",
      "publishAcademyAnnouncementV2",
      "archiveAcademyAnnouncementV2",
      "deleteDraftAcademyAnnouncementV2",
    ]) {
      expect(component).toContain(rpc);
    }
    expect(component).not.toMatch(/\bgetTeamAnnouncements\b/);
    expect(component).not.toMatch(/\bcreateAcademyAnnouncement\b/);
    expect(component).not.toMatch(/\bupdateAcademyAnnouncement\b/);
    expect(component).toContain("const PAGE_SIZE = 25");
    expect(component).toContain("updatedAt: last.updated_at");
    expect(component).toContain("Load more");
    expect(library).toContain('p_cursor_updated_at: cursor?.updatedAt ?? null');
    expect(library).toContain("p_limit: limit");
  });

  test("maps all-student, Program, and Cohort payloads without stale scope ids", () => {
    const common = {
      body: "Message",
      cohorts: buildAnnouncementCapabilities(context()).cohorts,
      expiresAt: null,
      title: "Title",
    };
    expect(buildAnnouncementWriteInput({ ...common, audienceType: "tenant", cohortId: "stale", courseId: "stale" })).toMatchObject({ audienceType: "tenant", cohortId: null, courseId: null });
    expect(buildAnnouncementWriteInput({ ...common, audienceType: "program", cohortId: "stale", courseId: "program-1" })).toMatchObject({ audienceType: "program", cohortId: null, courseId: "program-1" });
    expect(buildAnnouncementWriteInput({ ...common, audienceType: "cohort", cohortId: "cohort-1", courseId: "stale" })).toMatchObject({ audienceType: "cohort", cohortId: "cohort-1", courseId: "program-1" });
  });

  test("gives Owner and Admin all authorized audience choices", () => {
    expect(buildAnnouncementCapabilities(context({ role: "owner" })).allowedAudiences).toEqual(["tenant", "program", "cohort"]);
    expect(buildAnnouncementCapabilities(context({ role: "admin" })).allowedAudiences).toEqual(["tenant", "program", "cohort"]);
  });

  test("requires explicit active Staff delegation and fails closed on legacy null scope", () => {
    expect(buildAnnouncementCapabilities(context({ role: "staff" })).canCreate).toBe(false);
    expect(buildAnnouncementCapabilities(context({ role: "staff", permissions: [permission(null, null)] })).canCreate).toBe(false);
    expect(buildAnnouncementCapabilities(context({ role: "staff", permissions: [permission("workspace", null)] })).allowedAudiences).toEqual(["tenant", "program", "cohort"]);
    expect(buildAnnouncementCapabilities(context({ role: "staff", permissions: [permission("course", "program-1")] })).allowedAudiences).toEqual(["program", "cohort"]);
  });

  test("requires Trainer delegation plus exact Program assignment", () => {
    const trainer = context({ role: "trainer", permissions: [permission("workspace", null)], trainerCourseIds: ["program-1"] });
    expect(buildAnnouncementCapabilities(trainer).allowedAudiences).toEqual(["program"]);
    expect(canManageAnnouncementScope(trainer, "tenant", null, null)).toBe(false);
    expect(canManageAnnouncementScope({ ...trainer, trainerCourseIds: [] }, "program", "program-1", null)).toBe(false);
  });

  test("requires Trainer delegation plus exact Cohort assignment", () => {
    const trainer = context({ role: "trainer", permissions: [permission("course", "program-1")], trainerCohortIds: ["cohort-1"] });
    expect(buildAnnouncementCapabilities(trainer).allowedAudiences).toEqual(["cohort"]);
    expect(canManageAnnouncementScope(trainer, "cohort", "program-1", "cohort-1")).toBe(true);
    expect(canManageAnnouncementScope({ ...trainer, trainerCohortIds: [] }, "cohort", "program-1", "cohort-1")).toBe(false);
  });

  test("ignores pending, revoked, expired, and future delegations", () => {
    for (const overrides of [
      { status: "pending" as const },
      { status: "revoked" as const },
      { expires_at: "2026-01-02T00:00:00.000Z" },
      { starts_at: "2099-01-01T00:00:00.000Z" },
    ]) {
      expect(buildAnnouncementCapabilities(context({ role: "staff", permissions: [permission("workspace", null, overrides)] })).canCreate).toBe(false);
    }
  });

  test("keeps Student-facing audience labels free of internal terms", () => {
    expect(getAnnouncementAudienceLabel({ audience_type: "tenant", cohort_name: null, course_title: null })).toBe("All students");
    expect(getAnnouncementAudienceLabel({ audience_type: "program", cohort_name: null, course_title: "Foundations" })).toBe("Program: Foundations");
    expect(getAnnouncementAudienceLabel({ audience_type: "cohort", cohort_name: "Morning", course_title: "Foundations" })).toBe("Cohort: Morning");
    for (const copy of ["All students", "Program", "Cohort", "Recipients", "Read", "Unread"]) expect(component).toContain(copy);
  });

  test("exposes only valid lifecycle actions and locks published audience", () => {
    expect(component).toContain('announcement.status !== "archived"');
    expect(component).toContain('announcement.status === "draft"');
    expect(component).toContain('announcement.status === "published"');
    expect(component).toContain('disabled={editing?.status === "published"}');
    expect(component).toContain("Audience cannot change after publication.");
    expect(component).not.toContain("Unarchive");
  });

  test("requires explicit publish, archive, and Draft-delete confirmations", () => {
    expect(component).toContain("Publish announcement?");
    expect(component).toContain("Archive announcement?");
    expect(component).toContain("Delete Draft?");
    expect(component).toContain("Eligible Students may receive an in-app notification");
    expect(component).toContain("Archived is a terminal state");
    expect(component).toContain("if (!confirming || mutating) return");
  });

  test("preserves create success when its canonical refresh fails", async () => {
    const result = await successfulMutationWithFailedRefresh();
    expect(result.outcome).toEqual({ mutationSucceeded: true, refreshSucceeded: false });
    expect(result).toMatchObject({ mutationCalls: 1, refreshCalls: 1, successCalls: 1 });
    expect(component).toContain("Draft announcement created.");
  });

  test("preserves update success when its canonical refresh fails", async () => {
    const result = await successfulMutationWithFailedRefresh();
    expect(result.outcome.mutationSucceeded).toBe(true);
    expect(result.outcome.refreshSucceeded).toBe(false);
    expect(component).toContain("Announcement updated.");
  });

  test("preserves publish success when its canonical refresh fails", async () => {
    const result = await successfulMutationWithFailedRefresh();
    expect(result.outcome.mutationSucceeded).toBe(true);
    expect(result.outcome.refreshSucceeded).toBe(false);
    expect(component).toContain("Announcement published.");
  });

  test("preserves archive success when its canonical refresh fails", async () => {
    const result = await successfulMutationWithFailedRefresh();
    expect(result.outcome.mutationSucceeded).toBe(true);
    expect(result.outcome.refreshSucceeded).toBe(false);
    expect(component).toContain("Announcement archived.");
  });

  test("preserves Draft-delete success when its canonical refresh fails", async () => {
    const result = await successfulMutationWithFailedRefresh();
    expect(result.outcome.mutationSucceeded).toBe(true);
    expect(result.outcome.refreshSucceeded).toBe(false);
    expect(component).toContain("Draft announcement deleted.");
    expect(component).toContain("action succeeded, but the latest view could not be refreshed");
  });

  test("keeps a mutation failure as the primary outcome", async () => {
    const mutationError = new Error("mutation denied");
    let successCalls = 0;
    const outcome = await executeAnnouncementMutation({
      mutate: async () => {
        throw mutationError;
      },
      onMutationSuccess: () => {
        successCalls += 1;
      },
      refresh: async () => true,
    });

    expect(outcome.mutationSucceeded).toBe(false);
    expect(successCalls).toBe(0);
    if (!outcome.mutationSucceeded) expect(outcome.mutationError).toBe(mutationError);
  });

  test("does not replace the original mutation error when secondary refresh fails", async () => {
    const mutationError = new Error("original mutation failure");
    const outcome = await executeAnnouncementMutation({
      mutate: async () => {
        throw mutationError;
      },
      onMutationSuccess: () => {
        throw new Error("must not run");
      },
      refresh: async () => {
        throw new Error("secondary refresh failure");
      },
    });

    expect(outcome).toMatchObject({ mutationSucceeded: false, refreshSucceeded: false });
    if (!outcome.mutationSucceeded) expect(outcome.mutationError).toBe(mutationError);
  });

  test("never retries a mutation automatically", async () => {
    let mutationCalls = 0;
    const outcome = await executeAnnouncementMutation({
      mutate: async () => {
        mutationCalls += 1;
        throw new Error("mutation failure");
      },
      onMutationSuccess: () => undefined,
      refresh: async () => false,
    });

    expect(outcome.mutationSucceeded).toBe(false);
    expect(mutationCalls).toBe(1);
    expect(model).not.toContain("input.mutate();\n    await input.mutate()");
  });

  test("sanitizes backend failures without exposing raw internals", () => {
    expect(getAnnouncementErrorMessage({ code: "42501", message: "function secret_fn denied for tenant abc" })).toBe("Your announcement permission or scope changed. Refresh and try again.");
    expect(getAnnouncementErrorMessage({ code: "PGRST999", message: "SQLSTATE DETAIL HINT token" })).toBe("Unable to complete the announcement action.");
    expect(model).not.toContain("return candidate?.message");
  });

  test("uses labels, focus containment, and viewport-safe responsive dialogs", () => {
    expect(component).toContain('aria-modal="true"');
    expect(component).toContain('role="dialog"');
    expect(component).toContain('event.key !== "Tab"');
    expect(component).toContain("previousFocus?.focus()");
    expect(component).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(component).toContain('htmlFor="announcement-status-filter"');
    expect(component).toContain('htmlFor="announcement-audience-filter"');
    expect(component).toContain("flex-col-reverse");
  });

  test("does not introduce direct writes, service credentials, or notification claims", () => {
    for (const source of [component, library, model]) {
      expect(source).not.toMatch(/\.from\(["']academy_announcements["']\)[\s\S]{0,120}\.(insert|update|delete|upsert)\(/);
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE");
      expect(source).not.toContain("service_role");
    }
    expect(component).not.toContain("Delivered");
    expect(component).not.toContain("guaranteed delivery");
  });
});
