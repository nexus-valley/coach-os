import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux7d2_announcement_legacy_cleanup.sql",
);
const library = read("src/lib/announcements.ts");
const coach = read(
  "src/components/announcements/AnnouncementsPageClient.tsx",
);
const student = read(
  "src/components/portal/StudentPortalAnnouncements.tsx",
);
const dashboard = read(
  "src/components/portal/StudentPortalDashboard.tsx",
);

const legacyFunctions = [
  "get_student_announcements",
  "get_team_announcements",
  "create_academy_announcement",
  "update_academy_announcement",
  "publish_academy_announcement",
  "archive_academy_announcement",
] as const;

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected exactly one executable transaction").toHaveLength(1);
  return (matches?.[0] ?? "").toLowerCase();
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

test.describe("UX-7D2 legacy announcement cleanup", () => {
  test("keeps Coach, Student, and dashboard source on V2 only", () => {
    expect(coach).toContain("getTeamAnnouncementsV2");
    expect(student).toContain("getStudentAnnouncementsV2");
    expect(student).toContain("getStudentAnnouncementV2");
    expect(dashboard).toContain("getStudentAnnouncementsV2");

    for (const legacyExport of [
      "getStudentAnnouncements",
      "getTeamAnnouncements",
      "createAcademyAnnouncement",
      "updateAcademyAnnouncement",
      "publishAcademyAnnouncement",
      "archiveAcademyAnnouncement",
    ]) {
      expect(library).not.toMatch(
        new RegExp(`export (?:async )?function ${legacyExport}\\b`),
      );
      expect(coach).not.toMatch(new RegExp(`\\b${legacyExport}\\b`));
      expect(student).not.toMatch(new RegExp(`\\b${legacyExport}\\b`));
      expect(dashboard).not.toMatch(new RegExp(`\\b${legacyExport}\\b`));
    }

    for (const legacyRpc of legacyFunctions) {
      expect(library).not.toContain(`.rpc("${legacyRpc}"`);
    }
  });

  test("drops each obsolete public identity without dependency cascade", () => {
    const executable = executableSql();
    for (const legacyRpc of legacyFunctions) {
      expect(executable).toMatch(
        new RegExp(`revoke all on function public\\.${legacyRpc}\\(`),
      );
      expect(executable).toMatch(
        new RegExp(`drop function public\\.${legacyRpc}\\(`),
      );
    }
    expect(executable).not.toContain("cascade");
  });

  test("permanently fails closed for the legacy Staff compatibility flag", () => {
    const executable = executableSql();
    const helper = executable.match(
      /create or replace function coachfort_internal\.announcement_authorization_context\([\s\S]*?\n\$\$;/,
    )?.[0] ?? "";

    expect(helper).toContain("if p_legacy_staff_compat then\n    return;");
    expect(
      helper.match(/v_role = 'staff' and p_audience_type = 'tenant'/g),
    ).toHaveLength(1);
    expect(helper).toContain("find_active_delegated_permission_for_action");
    expect(helper).toContain("array['manage_messages']");
    expect(helper).toContain("ux4b_trainer_can_manage_course");
    expect(helper).toContain("ux4b_trainer_can_manage_cohort");
  });

  test("keeps the private helper private and V2 grants canonical", () => {
    const executable = executableSql();
    expect(executable).toContain(
      "revoke all on function coachfort_internal.announcement_authorization_context",
    );
    expect(executable).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(executable).not.toMatch(
      /grant execute on function coachfort_internal\.announcement_authorization_context/,
    );

    const post = verificationBlock("POST-APPLY");
    expect(post).toContain("authenticated_execute");
    expect(post).toContain("public_execute_revoked");
    expect(post).toContain("not anon_execute");
    expect(post).toContain("not service_execute");
    expect(post).toContain("count(*) = 9");
  });

  test("keeps PRE read-only and guards the reviewed contracts", () => {
    const pre = verificationBlock("PRE-APPLY");
    expect(pre).not.toMatch(
      /\b(insert\s+into|update\s+public\.|delete\s+from|merge\s+into|alter\s+(table|function)|create\s+(table|function|index)|drop\s+(table|function))\b/,
    );
    for (const signal of [
      "dependent_objects",
      "legacy_staff_branch_present",
      "browser_table_grants",
      "notification_contract",
      "community",
      "academy_chat",
    ]) {
      expect(pre).toContain(signal);
    }
  });

  test("preserves lifecycle, notifications, and direct-write boundaries", () => {
    const executable = executableSql();
    const post = verificationBlock("POST-APPLY");

    expect(executable).not.toMatch(
      /\b(insert\s+into|update\s+public\.|delete\s+from)\s+(?:public\.)?(academy_announcements|notifications)\b/,
    );
    expect(executable).not.toMatch(/alter table public\.(academy_announcements|notifications)/);
    expect(executable).not.toMatch(/drop function public\..*(community|chat)/);
    expect(executable).not.toMatch(/create or replace function public\..*(community|chat)/);

    expect(post).toContain("atomic_publish_intact");
    expect(post).toContain("duplicate_announcement_event_keys");
    expect(post).toContain("academy_announcements_browser_writes");
    expect(post).toContain("notifications_browser_writes");
    expect(post).toContain("security_gate");
    expect(post).toContain("(value->>'community')::integer = 12");
    expect(post).toContain("(value->>'academy_chat')::integer = 11");
  });
});
