import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StudentAnnouncementSummary } from "../../src/lib/announcements";
import {
  getStudentAnnouncementAudienceLabel,
  isValidAnnouncementDeepLink,
  markStudentAnnouncementReadLocally,
  mergeStudentAnnouncementPage,
} from "../../src/lib/studentAnnouncements";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const component = read(
  "src/components/portal/StudentPortalAnnouncements.tsx",
);
const dashboard = read("src/components/portal/StudentPortalDashboard.tsx");
const library = read("src/lib/announcements.ts");
const route = read("app/portal/announcements/page.tsx");

function announcement(
  overrides: Partial<StudentAnnouncementSummary> = {},
): StudentAnnouncementSummary {
  return {
    attention_state: null,
    audience_type: "tenant",
    body: "A Student-facing update",
    cohort_id: null,
    cohort_name: null,
    course_id: null,
    course_title: null,
    expires_at: null,
    id: "11111111-1111-4111-8111-111111111111",
    notification_id: null,
    published_at: "2026-08-27T09:00:00.000Z",
    title: "Update",
    updated_at: "2026-08-27T09:00:00.000Z",
    ...overrides,
  };
}

function exportedFunction(name: string, nextName: string) {
  const start = library.indexOf(`export async function ${name}`);
  const end = library.indexOf(`export async function ${nextName}`, start);

  expect(start, `Expected ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `Expected ${nextName} after ${name}`).toBeGreaterThan(start);
  return library.slice(start, end);
}

test.describe("UX-7D Student announcement experience", () => {
  test("cuts Student list and dashboard reads over to bounded V2 RPCs", () => {
    expect(component).toContain("getStudentAnnouncementsV2");
    expect(component).not.toMatch(/\bgetStudentAnnouncements\b/);
    expect(dashboard).toContain("getStudentAnnouncementsV2({ limit: 3 })");
    expect(dashboard).not.toMatch(/\bgetStudentAnnouncements\b/);
    expect(dashboard).not.toContain("nextAnnouncements.slice(0, 3)");

    const loader = exportedFunction(
      "getStudentAnnouncementsV2",
      "getStudentAnnouncementV2",
    );
    expect(loader).toContain('.rpc("get_student_announcements_v2"');
    expect(loader).toContain("p_limit: limit");
    expect(loader).toContain("p_cursor_id: cursor?.id ?? null");
    expect(loader).toContain(
      "p_cursor_published_at: cursor?.publishedAt ?? null",
    );
  });

  test("uses deterministic keyset pagination without duplicate rows", () => {
    expect(component).toContain("const PAGE_SIZE = 25");
    expect(component).toContain("publishedAt: last.published_at");
    expect(component).toContain("mergeStudentAnnouncementPage(current, rows)");
    expect(component).toContain("Load more");
    expect(component).not.toMatch(/offset|\.range\(/i);

    const first = announcement();
    const second = announcement({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Second",
    });
    expect(mergeStudentAnnouncementPage([first], [first, second])).toEqual([
      first,
      second,
    ]);
  });

  test("maps Student-facing audience context without internal language", () => {
    expect(getStudentAnnouncementAudienceLabel(announcement())).toBe(
      "All students",
    );
    expect(
      getStudentAnnouncementAudienceLabel(
        announcement({
          audience_type: "program",
          course_title: "Coach Foundations",
        }),
      ),
    ).toBe("Program: Coach Foundations");
    expect(
      getStudentAnnouncementAudienceLabel(
        announcement({
          audience_type: "cohort",
          cohort_name: "Morning Group",
          course_title: "Coach Foundations",
        }),
      ),
    ).toBe("Cohort: Morning Group");

    for (const internalLabel of ["tenant", "course_id", "cohort_id"]) {
      expect(component).not.toContain(`>${internalLabel}<`);
    }
  });

  test("preserves unread, read, and notification-free attention states", () => {
    expect(component).toContain('announcement.attention_state === "unread"');
    expect(component).toContain('{announcement.attention_state ? (');
    expect(component).toContain('? "Unread"');
    expect(component).toContain(': "Read"');

    const legacy = announcement();
    expect(markStudentAnnouncementReadLocally(legacy, "notice-1")).toBe(legacy);

    const unread = announcement({
      attention_state: "unread",
      notification_id: "notice-1",
    });
    expect(markStudentAnnouncementReadLocally(unread, "notice-1")).toEqual({
      ...unread,
      attention_state: "read",
    });
  });

  test("loads deep-linked detail through the authoritative V2 detail RPC", () => {
    const detail = library.slice(
      library.indexOf("export async function getStudentAnnouncementV2"),
      library.indexOf(
        "export async function getTeamAnnouncementsV2",
        library.indexOf("export async function getStudentAnnouncementV2"),
      ),
    );

    expect(route).toContain("Suspense");
    expect(component).toContain('searchParams.get("announcement")');
    expect(component).toContain("isValidAnnouncementDeepLink");
    expect(component).toContain("getStudentAnnouncementV2(deepLinkId)");
    expect(detail).toContain('.rpc("get_student_announcement_v2"');
    expect(detail).toContain("p_announcement_id: announcementId");
    expect(component).toContain("This announcement is no longer available.");

    expect(
      isValidAnnouncementDeepLink(
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toBe(true);
    expect(isValidAnnouncementDeepLink("not-a-valid-id")).toBe(false);
  });

  test("marks read only after successful authoritative detail resolution", () => {
    const detailCall = component.indexOf(
      "const announcement = await getStudentAnnouncementV2(deepLinkId)",
    );
    const nullGuard = component.indexOf("if (!announcement)", detailCall);
    const detailShown = component.indexOf("setDetail(announcement)", nullGuard);
    const unreadGuard = component.indexOf(
      'announcement.attention_state !== "unread"',
      detailShown,
    );
    const markRead = component.indexOf(
      "await markStudentPortalNotificationRead",
      unreadGuard,
    );

    expect(detailCall).toBeGreaterThanOrEqual(0);
    expect(nullGuard).toBeGreaterThan(detailCall);
    expect(detailShown).toBeGreaterThan(nullGuard);
    expect(unreadGuard).toBeGreaterThan(detailShown);
    expect(markRead).toBeGreaterThan(unreadGuard);
    const listLoader = component.slice(
      component.indexOf("const loadAnnouncements = useCallback"),
      component.indexOf("const requestId = ++detailRequestRef.current"),
    );
    expect(listLoader).not.toContain("markStudentPortalNotificationRead");
  });

  test("keeps detail visible when best-effort mark-read fails", () => {
    expect(component).toMatch(
      /setDetail\(announcement\);[\s\S]*?try \{[\s\S]*?markStudentPortalNotificationRead[\s\S]*?\} catch \{[\s\S]*?best effort/,
    );
    expect(component).toContain("markReadAttemptedRef.current.add(notificationId)");
    expect(component).not.toContain("mark-read failed");
    expect(component).not.toContain("notification attention could not");
  });

  test("never treats notification presence as announcement authorization", () => {
    expect(component).toContain("if (!announcement)");
    expect(component).not.toContain("getStudentPortalNotifications");
    expect(component).not.toContain("getUserNotifications");
    expect(component).not.toMatch(/\.from\(["']notifications["']\)/);
    expect(component).not.toMatch(/\.from\(["']academy_announcements["']\)/);
  });

  test("sanitizes list and detail errors", () => {
    expect(component).toContain(
      "Announcements could not be loaded. Try again.",
    );
    expect(component).toContain(
      "This announcement could not be opened. Try again.",
    );
    expect(component).not.toMatch(/caught\.(?:message|details|hint|code)/);
    expect(component).not.toContain("SQLSTATE");
    expect(component).not.toContain("get_student_announcement_v2 failed");
  });

  test("uses accessible mobile-safe list and detail surfaces", () => {
    expect(component).toContain('aria-label="Student announcements"');
    expect(component).toContain('role="list"');
    expect(component).toContain('aria-modal="true"');
    expect(component).toContain('role="dialog"');
    expect(component).toContain('event.key === "Escape"');
    expect(component).toContain('event.key !== "Tab"');
    expect(component).toContain("previousFocus?.focus()");
    expect(component).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(component).toContain("[overflow-wrap:anywhere]");
    expect(component).not.toMatch(/min-w-\[[^\]]+\]|w-\[[5-9][0-9]{2}px\]/);
  });

  test("does not expose Coach management or browser write controls", () => {
    for (const forbidden of [
      "New announcement",
      "Publish announcement",
      "Archive announcement",
      "Delete Draft",
      "Recipients",
      "Readership",
    ]) {
      expect(component).not.toContain(forbidden);
    }

    expect(component).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(component).not.toContain("SUPABASE_SERVICE_ROLE");
    expect(component).not.toContain("service_role");
  });
});
