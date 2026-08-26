import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/bundle_ux7b_announcement_backend_atomic_notifications.sql",
  ),
  "utf8",
);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected exactly one executable transaction").toHaveLength(1);
  return (matches?.[0] ?? "").toLowerCase();
}

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected function ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

test.describe("UX-7B announcement backend and atomic notifications", () => {
  test("keeps PRE read-only and guards the reviewed production baseline", () => {
    const pre = verificationBlock("PRE-APPLY");
    const executable = executableSql();

    expect(pre).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|create\s+(table|function|index))\b/);
    for (const signal of [
      "announcement_data",
      "notification_contract",
      "duplicate_enrollment_groups",
      "cohort_member_tenant_mismatch",
      "null_or_unsupported_scope",
      "api_exposed",
      "'community'",
      "'academy_chat'",
    ]) {
      expect(pre).toContain(signal);
    }
    expect(executable).toContain("announcement data drift");
    expect(executable).toContain("enrollment integrity drift");
    expect(executable).toContain("cohort integrity drift");
    expect(executable).toContain("internal schema is api exposed");
  });

  test("migrates audience values and enforces canonical scope shape", () => {
    const executable = executableSql();
    const normalize = functionBody(
      "coachfort_internal",
      "normalize_announcement_scope",
    );

    expect(executable).toContain("add column course_id uuid");
    expect(executable).toContain("add column cohort_id uuid");
    expect(executable).toContain("set audience_type = 'tenant'");
    expect(executable).toContain("where audience_type = 'all_students'");
    expect(executable).toContain("audience_type in ('tenant', 'program', 'cohort')");
    expect(executable).toContain("academy_announcements_scope_shape_check");
    expect(executable).toContain("on delete restrict");
    expect(normalize).toContain("v_cohort.course_id");
    expect(normalize).toContain("p_course_id is distinct from v_cohort.course_id");
    expect(normalize).toContain("co.id = p_cohort_id and co.tenant_id = p_tenant_id");
  });

  test("enforces final v2 delegation and Trainer assignment scope", () => {
    const auth = functionBody(
      "coachfort_internal",
      "announcement_authorization_context",
    );

    expect(auth).toContain("v_role in ('owner', 'admin')");
    expect(auth).toContain("v_role not in ('staff', 'trainer')");
    expect(auth).toContain("find_active_delegated_permission_for_action");
    expect(auth).toContain("v_permission.scope_type is null");
    expect(auth).toContain("v_permission.scope_type = 'workspace'");
    expect(auth).toContain("v_permission.scope_type = 'course'");
    expect(auth).toContain("v_permission.scope_type = 'cohort'");
    expect(auth).toContain("p_audience_type = 'tenant'");
    expect(auth).toContain("ux4b_trainer_can_manage_course");
    expect(auth).toContain("ux4b_trainer_can_manage_cohort");
  });

  test("isolates legacy Staff compatibility from v2", () => {
    const auth = functionBody(
      "coachfort_internal",
      "announcement_authorization_context",
    );
    const legacyCreate = functionBody("public", "create_academy_announcement");
    const v2Create = functionBody("public", "create_academy_announcement_v2");

    expect(auth).toContain("if p_legacy_staff_compat then");
    expect(auth).toContain("v_role = 'staff' and p_audience_type = 'tenant'");
    expect(legacyCreate).toContain("'tenant', null, null, true");
    expect(v2Create).toContain("p_course_id, p_cohort_id, false");
    expect(v2Create).not.toContain("true");
  });

  test("preserves every legacy identity and return contract", () => {
    const executable = executableSql();
    for (const identity of [
      "get_student_announcements()",
      "get_team_announcements(p_tenant_id uuid)",
      "create_academy_announcement(\n  p_tenant_id uuid,",
      "update_academy_announcement(\n  p_announcement_id uuid,",
      "publish_academy_announcement(p_announcement_id uuid)",
      "archive_academy_announcement(p_announcement_id uuid)",
    ]) {
      expect(executable).toContain(identity);
    }
    expect(functionBody("public", "publish_academy_announcement")).toContain(
      "returns public.academy_announcements",
    );
    expect(functionBody("public", "archive_academy_announcement")).toContain(
      "archive_announcement",
    );
    expect(executable).toContain(
      "-- legacy cutover compatibility: these unbounded identities remain tenant-only.",
    );
  });

  test("derives Student visibility from auth and canonical enrollment semantics", () => {
    const access = functionBody(
      "coachfort_internal",
      "student_can_read_announcement",
    );

    expect(access).toContain("p_user_id is distinct from auth.uid()");
    expect(access).toContain("student_portal_access_allowed_for_user");
    expect(access).toContain("'portal'");
    expect(access).toContain("'course_read'");
    expect(access).toContain("e.status = 'active'");
    expect(access).toContain("e.status = 'completed'");
    expect(access).toContain("e.completed_at is not null");
    expect(access).toContain("v_announcement.published_at <= e.completed_at");
    expect(access).toContain("c.status in ('published', 'archived')");
    expect(access).toContain("cm.cohort_id = v_announcement.cohort_id");
    expect(access).not.toContain("e.status = 'paused'");
    expect(access).not.toContain("e.status = 'cancelled'");
  });

  test("publishes atomically with set-based deduplicated recipients", () => {
    const publish = functionBody("coachfort_internal", "publish_announcement");

    expect(publish).toContain("for update");
    expect(publish).toContain("v_existing.status = 'published'");
    expect(publish).toContain("v_existing.status = 'archived'");
    expect(publish).toContain("feature.feature_key = 'notifications'");
    expect(publish).toContain("if v_notifications_enabled then");
    expect(publish).toContain("select distinct spa.user_id");
    expect(publish).toContain("'course_participate'");
    expect(publish).toContain("insert into public.notifications");
    expect(publish).toContain("from eligible_recipients recipient");
    expect(publish).toContain(
      "on conflict (tenant_id, user_id, event_key)\n    where event_key is not null\n    do nothing",
    );
    expect(publish).not.toMatch(/\b(loop|foreach)\b/);
  });

  test("uses the exact safe announcement notification contract", () => {
    const executable = executableSql();
    const publish = functionBody("coachfort_internal", "publish_announcement");
    const validator = functionBody("public", "m69_6_validate_notification_type");

    for (const type of [
      "session_reminder",
      "attendance_alert",
      "payment_reminder",
      "invoice_notice",
      "invitation_notice",
      "system_notice",
      "subscription_notice",
      "assignment_notice",
      "live_session_notice",
      "communication_notice",
      "announcement_notice",
    ]) {
      expect(executable).toContain(`'${type}'`);
      expect(validator).toContain(`'${type}'`);
    }
    expect(publish).toContain("'announcement:' || v_announcement.id::text || ':published'");
    expect(publish).toContain("'/portal/announcements?announcement=' || v_announcement.id::text");
    expect(publish).toContain("left(regexp_replace(v_announcement.body");
    expect(publish).toContain("'info'");
    expect(publish).not.toContain("'student_id',");
  });

  test("freezes published scope and keeps archived announcements terminal", () => {
    const update = functionBody("coachfort_internal", "update_announcement");
    const archive = functionBody("coachfort_internal", "archive_announcement");
    const remove = functionBody(
      "coachfort_internal",
      "delete_draft_announcement",
    );

    expect(update).toContain("published announcement audience cannot be changed");
    expect(update).toContain("archived announcements cannot be edited");
    expect(update).not.toContain("insert into public.notifications");
    expect(archive).toContain("announcement is already archived");
    expect(remove).toContain("only draft announcements can be deleted");
    expect(remove).toContain("for update");
  });

  test("bounds both v2 feeds with deterministic cursor pagination", () => {
    const student = functionBody("public", "get_student_announcements_v2");
    const team = functionBody("public", "get_team_announcements_v2");

    for (const body of [student, team]) {
      expect(body).toContain("p_limit < 1 or p_limit > 50");
      expect(body).toContain("cursor is invalid");
      expect(body).toContain("limit p_limit");
      expect(body).not.toContain("offset");
    }
    expect(student).toContain("order by aa.published_at desc, aa.id desc");
    expect(team).toContain("order by aa.updated_at desc, aa.id desc");
    expect(student).toContain("when notice.id is null then null");
    expect(team).toContain("in_app_recipient_count bigint");
    expect(team).not.toContain("student_id");
  });

  test("keeps private helpers inaccessible and browser writes revoked", () => {
    const executable = executableSql();
    for (const helper of [
      "normalize_announcement_scope",
      "announcement_authorization_context",
      "student_can_read_announcement",
      "create_announcement",
      "update_announcement",
      "publish_announcement",
      "archive_announcement",
      "delete_draft_announcement",
    ]) {
      expect(executable).toMatch(
        new RegExp(
          `alter function coachfort_internal\\.${helper}\\([\\s\\S]*?owner to postgres;`,
        ),
      );
      expect(executable).toMatch(
        new RegExp(
          `revoke all on function coachfort_internal\\.${helper}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
        ),
      );
      expect(executable).not.toMatch(
        new RegExp(`grant execute on function coachfort_internal\\.${helper}`),
      );
    }
    expect(executable).toContain(
      "revoke all on table public.academy_announcements from public, anon, authenticated",
    );
    expect(executable).not.toMatch(
      /grant\s+(insert|update|delete|all)[\s\S]*academy_announcements/,
    );
  });

  test("audits safe metadata and never backfills notifications", () => {
    const executable = executableSql();
    const publish = functionBody("coachfort_internal", "publish_announcement");
    const update = functionBody("coachfort_internal", "update_announcement");

    for (const event of [
      "announcement_created",
      "announcement_updated",
      "announcement_published",
      "announcement_archived",
      "announcement_draft_deleted",
    ]) {
      expect(executable).toContain(`'${event}'`);
    }
    expect(update).toContain("'changed_fields', to_jsonb(v_changed_fields)");
    expect(update).not.toContain("'body',");
    expect(publish).toContain("log_announcement_delegation");
    expect(executable.match(/insert into public\.notifications/g)).toHaveLength(1);
  });

  test("POST gate verifies the complete security and compatibility contract", () => {
    const post = verificationBlock("POST-APPLY");

    for (const signal of [
      "security_gate",
      "scope_foreign_keys",
      "browser_write_grants",
      "student_auth_bound",
      "completed_cutoff",
      "trainer_exact_scope",
      "bounded_reads",
      "atomic_publish",
      "published_edit_no_notification",
      "announcement_notice",
      "legacy_publish_return",
      "community",
      "academy_chat",
      "internal_schema_api_exposed",
    ]) {
      expect(post).toContain(signal);
    }
    expect(post).toContain("authenticated_execute");
    expect(post).toContain("not anon_execute");
    expect(post).toContain("not service_execute");
  });
});
