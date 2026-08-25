import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux6e1_assignment_student_notifications.sql",
);
const assignments = read("src/lib/assignments.ts");
const submissions = read("src/lib/submissions.ts");

function executableSql() {
  const match = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);

  expect(match, "Expected one executable BEGIN/COMMIT body").not.toBeNull();
  return (match?.[0] ?? "").toLowerCase();
}

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );

  expect(match, `Expected function ${schema}.${name}`).not.toBeNull();
  return (match?.[0] ?? "").toLowerCase();
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );

  expect(match, `Expected ${label} verification block`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

type NotificationTableGrant = {
  grantee: "PUBLIC" | "anon" | "authenticated";
  privilege: string;
};

function recognizedNotificationGrantBaseline(grants: NotificationTableGrant[]) {
  const allowed = new Map([
    ["anon", new Set(["TRUNCATE", "TRIGGER", "REFERENCES", "MAINTAIN"])],
    [
      "authenticated",
      new Set(["SELECT", "TRUNCATE", "TRIGGER", "REFERENCES", "MAINTAIN"]),
    ],
  ]);

  return (
    grants.some(
      ({ grantee, privilege }) =>
        grantee === "authenticated" && privilege === "SELECT",
    ) &&
    grants.every(({ grantee, privilege }) => {
      if (grantee === "PUBLIC") return false;
      return allowed.get(grantee)?.has(privilege) ?? false;
    })
  );
}

function notificationPostGrantContract(grants: NotificationTableGrant[]) {
  return (
    grants.some(
      ({ grantee, privilege }) =>
        grantee === "authenticated" && privilege === "SELECT",
    ) &&
    grants.every(
      ({ grantee, privilege }) =>
        grantee === "authenticated" && privilege === "SELECT",
    )
  );
}

test.describe("UX-6E1 assignment Student notification safety", () => {
  test("adds nullable event idempotency without historical backfill", () => {
    const executable = executableSql();

    expect(executable).toContain(
      "alter table public.notifications\n  add column if not exists event_key text",
    );
    expect(executable).toContain(
      "create unique index if not exists notifications_tenant_user_event_key_uidx",
    );
    expect(executable).toContain("(tenant_id, user_id, event_key)");
    expect(executable).toContain("where event_key is not null");
    expect(executable).toContain("or c.column_default is not null");
    expect(executable).toContain("and c.column_default is null");
    expect(executable).not.toMatch(/add\s+column[^;]*event_key\s+text\s+default/i);
    expect(executable).not.toMatch(
      /update\s+public\.notifications[\s\S]*?set\s+event_key/,
    );
    expect(executable).not.toMatch(/alter\s+column\s+event_key\s+set\s+not\s+null/);
  });

  test("requires authoritative assignment and submission revisions", () => {
    const pre = verificationBlock("PRE-APPLY");
    const executable = executableSql();

    for (const signal of [
      "revision_columns",
      "revision_triggers",
      "set_assignments_updated_at",
      "set_assignment_submissions_updated_at",
      "new.updated_at = now()",
      "tgenabled",
    ]) {
      expect(`${pre}\n${executable}`).toContain(signal);
    }
    expect(executable).toContain("c.udt_name = 'timestamptz'");
    expect(executable).toContain("c.is_nullable = 'no'");
    expect(executable).toContain("v_trigger_count <> 2");
    expect(executable).toContain("t.tgname = 'set_assignments_updated_at'");
    expect(executable).toContain(
      "t.tgname = 'set_assignment_submissions_updated_at'",
    );
  });

  test("extracts one private canonical core and keeps the public wrapper auth bound", () => {
    const core = functionBody(
      "coachfort_internal",
      "student_portal_access_allowed_for_user",
    );
    const wrapper = functionBody("public", "student_portal_access_allowed");

    expect(core).toContain("security definer");
    expect(core).toContain("stable");
    expect(core).toContain("set search_path = public, pg_temp");
    expect(core).not.toContain("auth.uid()");
    expect(core).toContain("coalesce(p_access_mode, 'portal')");
    expect(core).toContain(
      "v_mode not in ('portal', 'course_read', 'course_participate')",
    );
    expect(core).toContain("s.status = 'active'");
    expect(core).toContain("s.portal_enabled = true");
    expect(core).toContain("spa.status = 'active'");
    expect(core).toContain("e.status = 'active'");
    expect(core).toContain("e.status = 'completed'");
    expect(core).toContain("c.status in ('published', 'archived')");
    expect(wrapper).toContain("p_user_id is distinct from auth.uid()");
    expect(wrapper).toContain("p_access_mode text default 'portal'");
    expect(wrapper).toMatch(
      /student_portal_access_allowed_for_user\([\s\S]*?p_access_mode[\s\S]*?\);/,
    );
    expect(wrapper).toContain(
      "coachfort_internal.student_portal_access_allowed_for_user",
    );
  });

  test("keeps both internal helpers unavailable to browser and server API roles", () => {
    const executable = executableSql();

    for (const identity of [
      "student_portal_access_allowed_for_user",
      "insert_assignment_student_notification_event",
    ]) {
      expect(executable).toMatch(
        new RegExp(
          `alter function coachfort_internal\\.${identity}\\([\\s\\S]*?owner to postgres;`,
        ),
      );
      expect(executable).toMatch(
        new RegExp(
          `revoke all on function coachfort_internal\\.${identity}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
        ),
      );
      expect(executable).not.toMatch(
        new RegExp(`grant execute on function coachfort_internal\\.${identity}`),
      );
    }
  });

  test("uses one narrow set-based helper with safe content and feature skip", () => {
    const helper = functionBody(
      "coachfort_internal",
      "insert_assignment_student_notification_event",
    );

    expect(helper).toContain(
      "v_event_kind not in ('published', 'due_changed', 'review_available')",
    );
    expect(helper).toContain("feature.feature_key = 'notifications'");
    expect(helper).toContain("feature.status = 'enabled'");
    expect(helper).toMatch(/then\s+return 0;/);
    expect(helper).toContain("insert into public.notifications");
    expect(helper).toContain("from eligible_recipients recipient");
    expect(helper).toContain(
      "on conflict (tenant_id, user_id, event_key)\n  where event_key is not null\n  do nothing",
    );
    expect(helper).not.toMatch(/on\s+conflict\s+do\s+nothing/);
    expect(helper).toContain("'/portal/assignments/' || v_assignment.id::text");
    expect(helper).toContain("translate(v_assignment.title, '<>', '')");
    expect(helper).toContain("left(coalesce(v_assignment_title, 'assignment'), 140)");
    expect(helper).not.toContain("p_title");
    expect(helper).not.toContain("p_message");
    expect(helper).not.toContain("p_action_url");
  });

  test("recognizes the canonical active-portal helper chain before replacing mark-read", () => {
    const executable = executableSql();

    expect(executable).toContain(
      "public.has_any_active_student_portal_account(uuid,uuid)",
    );
    expect(executable).toContain(
      "v_definition not like '%from public.student_portal_accounts spa%'",
    );
    expect(executable).toContain(
      "v_definition not like '%spa.tenant_id = check_tenant_id%'",
    );
    expect(executable).toContain(
      "v_definition not like '%spa.user_id = check_user_id%'",
    );
    expect(executable).toContain(
      "v_definition not like '%public.student_portal_access_allowed(%'",
    );
    expect(executable).toContain("%null%''portal''%");
  });

  test("enforces canonical program and exact cohort recipients", () => {
    const helper = functionBody(
      "coachfort_internal",
      "insert_assignment_student_notification_event",
    );

    expect(helper).toContain("v_assignment.cohort_id is null");
    expect(helper).toContain("from public.cohort_members cm");
    expect(helper).toContain("cm.tenant_id = p_tenant_id");
    expect(helper).toContain("cm.cohort_id = v_assignment.cohort_id");
    expect(helper).toContain("cm.student_id = s.id");
    expect(helper).toContain(
      "p_exact_student_id is null or s.id = p_exact_student_id",
    );
    expect(helper).toContain(
      "coachfort_internal.student_portal_access_allowed_for_user",
    );
    expect(helper).not.toMatch(
      /v_assignment\.cohort_id\s+is\s+not\s+null[\s\S]*?from public\.enrollments[\s\S]*?course_id = v_course_id/,
    );
  });

  test("publishes atomically once and does not notify on close or Draft creation", () => {
    const status = functionBody("public", "update_assignment_status_secure");

    expect(status.indexOf("for update")).toBeLessThan(
      status.indexOf("update public.assignments a"),
    );
    expect(status.indexOf("update public.assignments a")).toBeLessThan(
      status.indexOf("m69_4_write_audit"),
    );
    expect(status.indexOf("m69_4_write_audit")).toBeLessThan(
      status.indexOf("insert_assignment_student_notification_event"),
    );
    expect(status).toContain(
      "v_existing.status = 'draft' and v_assignment.status = 'published'",
    );
    expect(status).toContain("'published', null, null");
    expect(status.indexOf("return v_existing")).toBeLessThan(
      status.indexOf("insert_assignment_student_notification_event"),
    );
    expect(status).not.toContain("'closed', null, null");
    expect(executableSql()).not.toContain(
      "create or replace function public.create_assignment_secure",
    );
  });

  test("uses deterministic bounded revision event keys", () => {
    const helper = functionBody(
      "coachfort_internal",
      "insert_assignment_student_notification_event",
    );
    const revisionExpression =
      "floor(extract(epoch from p_event_revision) * 1000000)::bigint::text";
    const dueBranch = helper.slice(
      helper.indexOf("elsif v_event_kind = 'due_changed'"),
      helper.indexOf("else\n    if v_assignment.status"),
    );
    const reviewBranch = helper.slice(
      helper.indexOf("else\n    if v_assignment.status"),
      helper.indexOf("end if;\n\n  with eligible_recipients"),
    );

    expect(helper).toContain(
      "'assignment:' || v_assignment.id::text || ':published'",
    );
    expect(dueBranch).toContain(revisionExpression);
    expect(reviewBranch).toContain(revisionExpression);
    expect(helper.split(revisionExpression)).toHaveLength(3);
    expect(helper).not.toContain("pg_catalog.extract(");
    expect(helper).toContain("':due:' || v_revision_key");
    expect(helper).toContain(
      "':review:'\n      || v_submission.id::text || ':' || v_revision_key",
    );
    expect(helper).not.toContain("to_char(");
    expect(helper).not.toContain("gen_random_uuid()");
  });

  test("notifies only actual successful Published due-date changes", () => {
    const update = functionBody("public", "update_assignment_secure");
    const cutoff = update.indexOf(
      "due date and max score cannot be changed after the first submission.",
    );
    const dueFlag = update.indexOf("v_due_changed :=");
    const assignmentUpdate = update.indexOf("update public.assignments a");
    const notification = update.indexOf(
      "insert_assignment_student_notification_event",
    );

    expect(update).toContain("v_existing.status = 'published'");
    expect(update).toContain("p_due_at is distinct from v_existing.due_at");
    expect(cutoff).toBeLessThan(dueFlag);
    expect(dueFlag).toBeLessThan(assignmentUpdate);
    expect(assignmentUpdate).toBeLessThan(notification);
    expect(update).toContain(
      "'due_changed', v_assignment.updated_at, null",
    );
    expect(update).not.toContain("content_changed");
    expect(update).not.toContain("material_updated");
  });

  test("preserves UX-6D3 assignment edit safeguards", () => {
    const update = functionBody("public", "update_assignment_secure");

    for (const signal of [
      "v_trainer_user_id := v_existing.trainer_user_id",
      "v_actor_role not in ('owner', 'admin')",
      "m69_5_assert_active_trainer",
      "program, cohort, and trainer cannot be changed after publication.",
      "due date and max score cannot be changed after the first submission.",
      "closed assignments cannot be edited.",
      "m69_4_assert_manage_assignment",
      "m69_4_write_audit",
    ]) {
      expect(update).toContain(signal);
    }
  });

  test("notifies only first or materially changed accepted reviews", () => {
    for (const name of [
      "review_assignment_submission_secure",
      "review_delegated_assignment_submission",
    ]) {
      const review = functionBody("public", name);
      const assignmentLock = review.indexOf("from public.assignments a");
      const submissionLock = review.indexOf("from public.assignment_submissions s");
      const stale = review.indexOf("assignment_submission_stale");
      const update = review.indexOf("update public.assignment_submissions s");
      const notify = review.indexOf(
        "insert_assignment_student_notification_event",
      );

      expect(assignmentLock).toBeGreaterThanOrEqual(0);
      expect(review.indexOf("for update", assignmentLock)).toBeLessThan(
        submissionLock,
      );
      expect(review.indexOf("for update", submissionLock)).toBeLessThan(stale);
      expect(stale).toBeLessThan(update);
      expect(update).toBeLessThan(notify);
      expect(review).toContain("v_submission.status is distinct from 'reviewed'");
      expect(review).toContain("v_submission.reviewed_at is null");
      expect(review).toContain("v_score is distinct from v_submission.score");
      expect(review).toContain("v_feedback is distinct from v_submission.feedback");
      expect(review).toContain("if v_material_change then");
      expect(review).toMatch(
        /'review_available',[\s\S]*?v_submission\.updated_at,[\s\S]*?v_submission\.student_id/,
      );
    }
  });

  test("keeps review content private and exact-Student scoped", () => {
    const helper = functionBody(
      "coachfort_internal",
      "insert_assignment_student_notification_event",
    );
    const reviewBranch = helper.slice(helper.indexOf("else\n    if v_assignment.status"));

    expect(reviewBranch).toContain("p_exact_student_id is null");
    expect(reviewBranch).toContain("s.student_id = p_exact_student_id");
    expect(reviewBranch).toContain("p_event_revision is distinct from v_submission.updated_at");
    expect(helper).toContain("feedback is available for");
    expect(helper).not.toMatch(/v_message\s*:=.*(?:v_submission\.score|v_submission\.feedback)/);
    expect(helper).toContain("'{}'::jsonb");
  });

  test("allows Student own-row mark-read without widening archive or RLS", () => {
    const markRead = functionBody("public", "mark_notification_read_secure");
    const executable = executableSql();

    expect(markRead).toContain("m69_6_current_role");
    expect(markRead).toContain("has_any_active_student_portal_account");
    expect(markRead).toContain("n.tenant_id = p_tenant_id");
    expect(markRead).toContain("n.id = p_notification_id");
    expect(markRead).toContain("n.user_id = v_actor");
    expect(markRead).toContain("v_role in ('owner', 'admin')");
    expect(markRead).toContain("status = 'read'");
    expect(markRead).toContain("read_at = coalesce(n.read_at, now())");
    expect(executable).not.toContain(
      "create or replace function public.archive_notification_secure",
    );
    expect(executable).not.toMatch(/create\s+policy|drop\s+policy|alter\s+policy/);
  });

  test("reasserts browser write revocation and preserves public identities", () => {
    const executable = executableSql();

    expect(executable).toContain(
      "revoke insert, update, delete, truncate, references, trigger, maintain\n  on table public.notifications\n  from public, anon, authenticated",
    );
    expect(executable).not.toMatch(
      /revoke[^;]*select[^;]*on\s+table\s+public\.notifications/,
    );
    expect(executable).not.toMatch(
      /revoke[\s\S]*?on table public\.notifications[\s\S]*?from service_role/,
    );
    expect(executable.match(/grant execute on function public\./g)).toHaveLength(6);
    expect(executable).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|trigger|references|maintain)/,
    );
    expect(executable).not.toMatch(
      /review_assignment_submission_secure\(\s*uuid,\s*uuid,\s*uuid,\s*numeric/,
    );
  });

  test("recognizes and remediates only the reviewed notification grant baseline", () => {
    const pre = verificationBlock("PRE-APPLY");
    const executable = executableSql();
    const post = verificationBlock("POST-APPLY");

    expect(pre).toContain("browser_notification_grant_contract");
    expect(pre).toContain("authenticated_select");
    expect(pre).toContain("browser_write_grants");
    expect(pre).toContain("browser_dangerous_grants");
    expect(pre).toContain("unexpected_browser_grants");
    expect(pre).toContain("recognized_baseline");
    expect(pre).toContain("pg_catalog.aclexplode");
    expect(pre).toContain("pg_catalog.acldefault('r', c.relowner)");
    expect(pre).toContain("when acl.grantee = 0 then 'public'");
    expect(pre).not.toContain("information_schema.role_table_grants");

    expect(executable).toContain("pg_catalog.aclexplode");
    expect(executable).toContain("pg_catalog.acldefault('r', c.relowner)");
    expect(executable).toContain("g.grantee = 0");
    expect(executable).toContain("pg_catalog.pg_get_userbyid(g.grantee)");
    expect(executable).toContain("upper(g.privilege_type) = 'select'");
    expect(executable).toContain(
      "upper(g.privilege_type) not in ('truncate', 'trigger', 'references', 'maintain')",
    );
    expect(executable).toContain(
      "upper(g.privilege_type) not in ('select', 'truncate', 'trigger', 'references', 'maintain')",
    );
    expect(executable).not.toContain("information_schema.role_table_grants");

    expect(post).toContain("notification_select_contract");
    expect(post).toContain("pg_catalog.aclexplode");
    expect(post).toContain("when acl.grantee = 0 then 'public'");
    expect(post).toContain("authenticated_select_preserved");
    expect(post).toContain("public_privileges_absent");
    expect(post).toContain("anon_privileges_absent");
    expect(post).toContain("authenticated_select_only");
    expect(post).toContain("browser_write_grants");
    expect(post).toContain("browser_dangerous_grants");
    expect(post).toContain("unexpected_browser_grants");
    expect(post).not.toContain("information_schema.role_table_grants");
    expect(migration.toLowerCase()).not.toContain(
      "information_schema.role_table_grants",
    );
  });

  test("fails closed around the exact reviewed browser table ACLs", () => {
    const select: NotificationTableGrant = {
      grantee: "authenticated",
      privilege: "SELECT",
    };
    const legacy = ["TRUNCATE", "TRIGGER", "REFERENCES", "MAINTAIN"] as const;
    const reviewedBaseline: NotificationTableGrant[] = [
      select,
      ...legacy.map((privilege) => ({
        grantee: "anon" as const,
        privilege,
      })),
      ...legacy.map((privilege) => ({
        grantee: "authenticated" as const,
        privilege,
      })),
    ];

    expect(recognizedNotificationGrantBaseline(reviewedBaseline)).toBe(true);
    expect(recognizedNotificationGrantBaseline([select])).toBe(true);
    expect(
      recognizedNotificationGrantBaseline([
        select,
        { grantee: "anon", privilege: "MAINTAIN" },
      ]),
    ).toBe(true);
    expect(
      recognizedNotificationGrantBaseline([
        select,
        { grantee: "authenticated", privilege: "MAINTAIN" },
      ]),
    ).toBe(true);
    expect(
      recognizedNotificationGrantBaseline([
        ...reviewedBaseline,
        { grantee: "PUBLIC", privilege: "SELECT" },
      ]),
    ).toBe(false);
    expect(
      recognizedNotificationGrantBaseline([
        ...reviewedBaseline,
        { grantee: "PUBLIC", privilege: "MAINTAIN" },
      ]),
    ).toBe(false);
    expect(recognizedNotificationGrantBaseline(reviewedBaseline.slice(1))).toBe(
      false,
    );
    expect(
      recognizedNotificationGrantBaseline([
        ...reviewedBaseline,
        { grantee: "anon", privilege: "SELECT" },
      ]),
    ).toBe(false);
    expect(
      recognizedNotificationGrantBaseline([
        ...reviewedBaseline,
        { grantee: "authenticated", privilege: "INSERT" },
      ]),
    ).toBe(false);

    expect(notificationPostGrantContract([select])).toBe(true);
    expect(
      notificationPostGrantContract([
        select,
        { grantee: "PUBLIC", privilege: "SELECT" },
      ]),
    ).toBe(false);
    expect(
      notificationPostGrantContract([
        select,
        { grantee: "anon", privilege: "TRIGGER" },
      ]),
    ).toBe(false);
    expect(notificationPostGrantContract(reviewedBaseline)).toBe(false);
  });

  test("ships read-only verification, executable guards, and schema reload", () => {
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");
    const executable = executableSql();

    for (const signal of [
      "notification_columns",
      "notification_constraints",
      "notification_policies",
      "notification_grants",
      "browser_notification_grant_contract",
      "notification_totals",
      "candidate_duplicate_groups",
      "function_metadata",
      "review_overloads",
      "revision_triggers",
      "internal_schema",
    ]) {
      expect(pre).toContain(signal);
    }
    expect(pre).not.toMatch(/select[\s\S]*?\bn\.(?:title|message)\b/);
    for (const signal of [
      "event_key_nullable_text",
      "unique_partial_index",
      "private_core_canonical",
      "public_wrapper_auth_bound",
      "helper_set_based",
      "recipient_contract_ok",
      "publish_atomic",
      "due_actual_change_only",
      "review_material_only",
      "student_mark_read_own_only",
      "internal_schema_contract",
      "authenticator_role_setting_exposed",
      "browser_dangerous_grants",
      "notification_select_contract",
      "authenticated_select_preserved",
      "expected_authenticated_execute",
      "expected_volatility",
      "security_gate",
    ]) {
      expect(post).toContain(signal);
    }
    expect(post).toContain(
      "(select (value ->> 'event_key_default_null')::boolean from schema_contract)",
    );
    for (const recipientSignal of [
      "v_access_mode := ''course_participate''",
      "from public.cohort_members cm",
      "cm.cohort_id = v_assignment.cohort_id",
      "p_exact_student_id is null or s.id = p_exact_student_id",
      "from public.assignment_submissions s",
      "s.student_id = p_exact_student_id",
      "v_access_mode := ''course_read''",
    ]) {
      expect(post).toContain(recipientSignal);
    }
    expect(executable).toContain("pg_catalog.pg_db_role_setting");
    expect(executable).toContain("'%''read''%'");
    expect(executable.match(/\ndo \$\$/g)).toHaveLength(2);
    expect(executable.match(/notify pgrst, 'reload schema';/g)).toHaveLength(1);
    expect(executable.indexOf("notify pgrst, 'reload schema';")).toBeLessThan(
      executable.lastIndexOf("commit;"),
    );
    expect(migration).toContain("'[[:space:]]+'");
    expect(migration).not.toContain("'\\\\s+'");
  });

  test("leaves existing client notifications as team operational side effects", () => {
    expect(assignments).toContain("async function notifyAssignmentRoles");
    expect(assignments).toContain('roles: ["owner", "admin"]');
    expect(assignments).toContain("assignment.trainer_user_id");
    expect(submissions).toContain("async function notifySubmissionEvent");
    expect(submissions).toContain('roles: ["owner", "admin"]');
    expect(assignments).not.toContain("student_portal_accounts");
    expect(submissions).not.toContain("student_portal_accounts");
  });
});
