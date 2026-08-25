import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getSafeStudentNotificationActionUrl,
  getSafeStudentNotificationTimestamp,
  getStudentNotificationActionLabel,
} from "../../src/lib/studentPortalNotifications";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const component = read(
  "src/components/portal/StudentPortalNotifications.tsx",
);
const layout = read("src/components/portal/StudentPortalLayout.tsx");
const featureAccess = read("src/lib/featureAccess.ts");
const portalLibrary = read("src/lib/studentPortal.ts");
const route = read("app/portal/notifications/page.tsx");

function functionSource(name: string, nextName: string) {
  const start = portalLibrary.indexOf(`export async function ${name}`);
  const end = portalLibrary.indexOf(`export async function ${nextName}`, start);

  expect(start, `Expected ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `Expected ${nextName} after ${name}`).toBeGreaterThan(start);
  return portalLibrary.slice(start, end);
}

test.describe("UX-6E2 Student Portal notifications", () => {
  test("accepts only well-formed internal Student Portal action URLs", () => {
    for (const safe of [
      "/portal",
      "/portal/",
      "/portal/notifications",
      "/portal/assignments/abc",
      "/portal/assignments/550e8400-e29b-41d4-a716-446655440000",
      "/portal/assignments/assignment-123?from=notifications#review",
    ]) {
      expect(getSafeStudentNotificationActionUrl(safe)).toBe(safe);
    }

    for (const unsafe of [
      "https://evil.com",
      "http://evil.com",
      "//evil.com",
      "javascript:alert(1)",
      "data:text/html,test",
      "portal/assignments/x",
      "/portals/x",
      "/portal.evil/x",
      "/portal/\\evil",
      "/portal/%5Cevil",
      "/portal/%5cevil",
      "/portal/%5C%5Cevil",
      "/portal/%",
      "/portal/%ZZ",
      "/portal/assignments/%0Aunsafe",
      "/portal/assignments/%0Dunsafe",
      "/portal/assignments/%09unsafe",
      "/portal/%2e%2e/app",
      "/portal/%252e%252e/app",
      " /portal/assignments/1",
      "/portal/assignments/1\n",
    ]) {
      expect(getSafeStudentNotificationActionUrl(unsafe)).toBeNull();
    }
  });

  test("fails closed for invalid notification timestamps", () => {
    const validTimestamp = "2026-08-25T12:30:00.000Z";

    expect(getSafeStudentNotificationTimestamp(validTimestamp)).toBe(
      validTimestamp,
    );
    expect(getSafeStudentNotificationTimestamp(null)).toBeNull();
    expect(getSafeStudentNotificationTimestamp(undefined)).toBeNull();
    expect(getSafeStudentNotificationTimestamp("not-a-date")).toBeNull();
  });

  test("uses a focused assignment action label", () => {
    expect(
      getStudentNotificationActionLabel({
        actionUrl: "/portal/assignments/assignment-123",
        type: "assignment_notice",
      }),
    ).toBe("View assignment");
    expect(
      getStudentNotificationActionLabel({
        actionUrl: "/portal/sessions",
        type: "session_reminder",
      }),
    ).toBe("Open notification");
  });

  test("registers feature-gated navigation and protects the existing route", () => {
    expect(layout).toContain(
      '{ href: "/portal/notifications", label: "Notifications" }',
    );
    expect(featureAccess).toContain('Notifications: "notifications"');
    expect(layout).toContain("visiblePortalNavItems = portalNavItems.filter");
    expect(layout).toContain("const notificationsFeatureEnabled =");
    expect(layout).toContain(
      'featureKey === "notifications"',
    );
    expect(layout).toContain("return notificationsFeatureEnabled");
    expect(layout).toContain("return isFeatureEnabled(featureAccess, featureKey)");
    expect(layout).toContain(
      'activeFeatureKey === "notifications"',
    );
    expect(layout).toContain("!routeFeatureEnabled ? (");
    expect(route).toContain("StudentPortalGuard");
    expect(route).toContain("StudentPortalLayout");
    expect(route).toContain("StudentPortalNotifications");
  });

  test("loads a bounded deterministic own-user list and omits archived rows", () => {
    const loader = functionSource(
      "getStudentPortalNotifications",
      "markStudentPortalNotificationRead",
    );

    expect(loader).toContain("supabase.auth.getUser()");
    expect(loader).toContain('.eq("tenant_id", params.tenantId)');
    expect(loader).toContain('.eq("user_id", user.id)');
    expect(loader).toContain('.in("status", ["unread", "read"])');
    expect(loader).toContain('.order("created_at", { ascending: false })');
    expect(loader).toContain('.order("id", { ascending: false })');
    expect(loader).toContain(".limit(25)");
    expect(loader).not.toContain("metadata_json");
    expect(loader).not.toContain("event_key");
  });

  test("marks read through the exact secure RPC without browser writes", () => {
    const marker = functionSource(
      "markStudentPortalNotificationRead",
      "getStudentPortalConversations",
    );

    expect(marker).toContain('.rpc("mark_notification_read_secure"');
    expect(marker).toContain("p_notification_id: params.notificationId");
    expect(marker).toContain("p_tenant_id: params.tenantId");
    expect(marker).toContain('.select("id,status,read_at")');
    expect(marker).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(marker).not.toContain("archive_notification_secure");
  });

  test("renders explicit read state and canonical read timestamps", () => {
    expect(component).toContain('notification.status === "unread"');
    expect(component).toContain('{isUnread ? "Unread" : "Read"}');
    expect(component).toContain("notification.read_at");
    expect(component).toContain("updated.read_at");
    expect(component).toContain("updated.status");
    expect(component).toContain('aria-label="Student notifications"');
    expect(component).toContain('role="list"');
  });

  test("marks an unread action once before navigation and leaves read actions direct", () => {
    expect(component).toContain(
      "if (pendingIdsRef.current.has(notificationId))",
    );
    expect(component).toContain("const markedRead = await markRead(notification.id)");
    expect(component).toMatch(
      /if \(markedRead && mountedRef\.current\) \{\s+router\.push\(actionUrl\);/,
    );
    expect(component).toMatch(
      /isUnread \? \([\s\S]*?handleUnreadAction[\s\S]*?\) : \([\s\S]*?href=\{actionUrl\}/,
    );
    expect(component).toContain("return false;");
    expect(component).toContain(
      "Unable to mark this notification as read. Please try again.",
    );
  });

  test("does not update state or navigate after unmount", () => {
    expect(component).toContain("const mountedRef = useRef(true)");
    expect(component).toContain("mountedRef.current = false");
    expect(component).toContain("if (!mountedRef.current)");
    expect(component).toContain("if (mountedRef.current)");
    expect(component).toContain("if (markedRead && mountedRef.current)");
  });

  test("keeps content privacy-safe and Student archive unavailable", () => {
    for (const privateField of [
      "event_key",
      "metadata_json",
      "entity_id",
      "tenant_id}",
      "score",
      "feedback",
    ]) {
      expect(component).not.toContain(privateField);
    }

    expect(component).not.toContain("Archive");
    expect(component).not.toContain("archiveNotification");
    expect(component).not.toMatch(/caught\.(?:message|details|hint|code)/);
  });

  test("uses safe loading, empty, error, accessible, and mobile layouts", () => {
    expect(component).toContain("PortalLoadingCard");
    expect(component).toContain("No notifications yet.");
    expect(component).toContain("FeedbackAlert");
    expect(component).toContain("getSafeStudentNotificationTimestamp");
    expect(component).toContain('aria-live="assertive"');
    expect(component).toContain("isLoading={isPending}");
    expect(component).toContain('className="w-full sm:w-auto"');
    expect(component).toContain("[overflow-wrap:anywhere]");
    expect(component).not.toMatch(/min-w-\[[^\]]+\]|w-\[[5-9][0-9]{2}px\]/);
  });

  test("does not rewrite the team notification implementation", () => {
    const teamPage = read(
      "src/components/notifications/NotificationsPageClient.tsx",
    );
    const teamBell = read("src/components/notifications/NotificationBell.tsx");

    expect(teamPage).toContain("markNotificationRead");
    expect(teamPage).toContain("archiveNotification");
    expect(teamBell).toContain("getSafeNotificationActionUrl");
  });
});
