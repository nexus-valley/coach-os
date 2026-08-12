import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath =
  "supabase/bundle_ux5c_session_lifecycle_portal_cancellation.sql";

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function executableSql() {
  return read(migrationPath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

function executableBody() {
  const match = read(migrationPath).match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);

  expect(match, "Expected one executable BEGIN/COMMIT body").not.toBeNull();
  return match?.[0] ?? "";
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = read(migrationPath).match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );

  expect(match, `Expected ${label} verification block`).not.toBeNull();
  return match?.[1] ?? "";
}

function functionBody(sql: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );

  expect(match, `Expected function ${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-5C session lifecycle and portal cancellation SQL design", () => {
  test("makes both full update paths scheduled-only and concurrency-safe", () => {
    const sql = executableSql();
    const secure = functionBody(sql, "update_session_secure");
    const delegated = functionBody(sql, "update_delegated_session");

    for (const body of [secure, delegated]) {
      expect(body).toContain("for update");
      expect(body).toContain("status <> 'scheduled'");
      expect(body).toContain(
        "Only scheduled sessions can be edited or rescheduled.",
      );
      expect(body).toContain("and s.status = 'scheduled'");
    }

    expect(secure).toContain("public.m69_3_assert_can_manage_scope(");
    expect(secure).toContain("public.m69_3_write_audit(");
    expect(delegated).toContain(
      "public.find_active_delegated_permission_for_action(",
    );
    expect(delegated).toContain("public.log_delegated_permission_used(");
  });

  test("keeps the correction RPC narrow across terminal states", () => {
    const sql = executableSql();
    const secure = functionBody(sql, "update_session_meeting_details_secure");
    const delegated = functionBody(
      sql,
      "update_delegated_session_meeting_details",
    );

    for (const correction of [secure, delegated]) {
      expect(correction).toContain("for update");
      expect(correction).toContain("status = 'canceled'");
      expect(correction).toContain(
        "Canceled session meeting details cannot be edited.",
      );
      expect(correction).toContain(
        "Delivery mode changes require a full scheduled-session edit.",
      );
      expect(correction).toContain(
        "Completed sessions allow recording URL correction only.",
      );
      expect(correction).toContain("set recording_url = v_recording_url");
      expect(correction).not.toMatch(/^\s*delivery_mode\s*=/im);
      expect(correction).not.toMatch(/^\s*scheduled_start_at\s*=/im);
      expect(correction).not.toMatch(/^\s*scheduled_end_at\s*=/im);
      expect(correction).not.toMatch(/^\s*course_id\s*=/im);
      expect(correction).not.toMatch(/^\s*cohort_id\s*=/im);
      expect(correction).not.toMatch(/^\s*trainer_user_id\s*=/im);
      expect(correction).not.toMatch(/^\s*status\s*=/im);
    }

    expect(secure).toContain("public.m69_3_assert_can_manage_scope(");
    expect(secure).toContain("public.m69_3_write_audit(");
    expect(delegated).toContain(
      "public.find_active_delegated_permission_for_action(",
    );
    expect(delegated).toContain("public.log_delegated_permission_used(");
  });

  test("adds canceled portal history without participation or secret exposure", () => {
    const portal = functionBody(
      executableSql(),
      "get_student_portal_sessions",
    );

    expect(portal).toContain(
      "s.status in ('scheduled', 'completed', 'canceled')",
    );
    expect(portal).toContain(
      "vs.status in ('completed', 'canceled') and vs.can_read",
    );
    expect(portal).toContain("vs.status = 'scheduled'");
    expect(portal).toContain("vs.can_participate");
    expect(portal).toContain("vs.status = 'completed'");
    expect(portal).toContain("vs.can_read");
    expect(portal).toContain("student_portal_access_allowed(");
    expect(portal).toContain("from public.cohort_members cm");
    expect(portal).toContain("cm.student_id = ctx.student_id");
    expect(portal).toContain("cm.cohort_id = s.cohort_id");
    expect(portal).not.toContain("meeting_passcode");
    expect(portal).not.toContain("meeting_id");

    const meetingMask = portal.match(
      /case[\s\S]*?when vs\.status = 'scheduled'[\s\S]*?then vs\.meeting_url[\s\S]*?else null[\s\S]*?end as meeting_url/i,
    );
    const recordingMask = portal.match(
      /case[\s\S]*?when vs\.status = 'completed'[\s\S]*?then vs\.recording_url[\s\S]*?else null[\s\S]*?end as recording_url/i,
    );
    expect(meetingMask).not.toBeNull();
    expect(recordingMask).not.toBeNull();
  });

  test("preserves the portal return signature and application RPC boundary", () => {
    const migration = executableSql();
    const portal = functionBody(migration, "get_student_portal_sessions");
    const existing = read(
      "supabase/bundle_ux4b_enrollment_access_permission_hardening.sql",
    );
    const application = read("src/lib/studentPortal.ts");

    const expectedColumns = [
      "tenant_id uuid",
      "id uuid",
      "course_id uuid",
      "cohort_id uuid",
      "course_title text",
      "cohort_name text",
      "title text",
      "delivery_mode text",
      "meeting_provider text",
      "meeting_url text",
      "join_available_from timestamptz",
      "recording_url text",
      "timezone text",
      "scheduled_start_at timestamptz",
      "scheduled_end_at timestamptz",
      "status text",
    ];

    for (const column of expectedColumns) {
      expect(portal).toContain(column);
      expect(existing).toContain(column);
    }

    expect(application).toContain('.rpc("get_student_portal_sessions"');
    expect(application).not.toMatch(
      /accessMode === "student"[\s\S]{0,400}\.from\("sessions"\)/,
    );
  });

  test("preserves exact role grants and hardened function metadata", () => {
    const sql = executableSql();

    expect(sql.match(/security definer/g)?.length).toBe(5);
    expect(sql.match(/set search_path = public, pg_temp/g)?.length).toBe(5);
    expect(sql.match(/owner to postgres/g)?.length).toBe(5);
    expect(sql.match(/from public, anon, authenticated, service_role/g)?.length).toBe(
      5,
    );
    expect(sql.match(/to authenticated;/g)?.length).toBe(5);
    expect(sql).not.toMatch(/grant\s+execute[\s\S]*?to\s+(public|anon|service_role)/i);
  });

  test("contains one atomic additive migration without RLS or data changes", () => {
    const sql = executableSql();

    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/create\s+policy|drop\s+policy/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/grant\s+.+\s+on\s+table/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.(?!sessions)/i);
    expect(sql).not.toMatch(/delete\s+from/i);
    expect(sql).not.toMatch(/update\s+public\.(?!sessions)/i);
  });

  test("keeps the reviewed executable migration body byte-identical", () => {
    const hash = createHash("sha256")
      .update(executableBody(), "utf8")
      .digest("hex")
      .toUpperCase();

    expect(hash).toBe(
      "FCA918ED428511B74B9E4B98AF7FB53D9584F0CCCD1F78A80F77521A9DC3CF60",
    );
  });

  test("uses exact preflight grants, dependencies, ACLs, and source signals", () => {
    const preflight = verificationBlock("PRE-APPLY");

    expect(preflight).toContain("information_schema.table_privileges");
    expect(preflight).not.toContain("information_schema.role_table_grants");
    expect(preflight).toContain("to_regprocedure(ef.identity)");
    expect(preflight).toContain("to_regprocedure(rd.identity)");
    expect(preflight).toContain("aclexplode(");
    expect(preflight).toContain("a.grantee = 0");
    expect(preflight).not.toContain("has_function_privilege('PUBLIC'");

    for (const dependency of [
      "public.m69_3_assert_manage_attendance(uuid)",
      "public.m69_3_assert_can_manage_scope(uuid,text,uuid,uuid,uuid,boolean)",
      "public.m69_3_normalize_text(text,text,boolean,integer)",
      "public.m69_3_validate_delivery_mode(text)",
      "public.m69_3_validate_meeting_provider(text)",
      "public.m69_3_validate_url(text,text)",
      "public.m69_3_assert_course_in_tenant(uuid,uuid)",
      "public.m69_3_assert_cohort_in_tenant(uuid,uuid)",
      "public.m69_3_assert_course_cohort_consistency(uuid,uuid,uuid)",
      "public.m69_3_write_audit(uuid,text,text,uuid,text,text,text,jsonb)",
      "public.is_tenant_member(uuid,uuid)",
      "public.find_active_delegated_permission_for_action(uuid,uuid,text[],uuid,uuid,uuid,uuid,uuid)",
      "public.log_delegated_permission_used(uuid,uuid,uuid,text,text,uuid,text,uuid)",
      "public.student_portal_access_allowed(uuid,uuid,uuid,uuid,text)",
    ]) {
      expect(preflight).toContain(dependency);
    }

    for (const signal of [
      "public_execute",
      "anon_execute",
      "authenticated_execute",
      "service_role_execute",
      "row_lock",
      "scheduled_edit_guard",
      "canceled_denied",
      "completed_recording_only",
      "canceled_supported",
    ]) {
      expect(preflight).toContain(signal);
    }
  });

  test("verifies post-apply lifecycle, portal masking, and UX-5B policies", () => {
    const raw = read(migrationPath);
    const verification = verificationBlock("POST-APPLY");

    expect(raw).toContain("as preflight_result;");
    expect(raw).toContain("as verification_result;");
    expect(verification).toContain("information_schema.table_privileges");
    expect(verification).not.toContain("information_schema.role_table_grants");
    expect(verification).toContain("to_regprocedure(ef.identity)");
    expect(verification).toContain("aclexplode(");
    expect(verification).toContain("a.grantee = 0");
    expect(verification).not.toContain("has_function_privilege('PUBLIC'");

    for (const signal of [
      "public_execute",
      "anon_execute",
      "authenticated_execute",
      "service_role_execute",
      "expected_search_path",
      "scheduled_edit_guard",
      "scheduled_update_predicate",
      "safe_scheduled_edit_message",
      "canceled_correction_denied",
      "scheduled_completed_only",
      "delivery_mode_immutable",
      "completed_recording_only_guard",
      "completed_update_recording_only",
      "scheduled_correction_allowed_fields",
      "scheduled_correction_restricted_fields_absent",
      "portal_return_shape_unchanged",
      "exact_cohort_membership_retained",
      "scheduled_uses_participate",
      "completed_uses_read",
      "canceled_uses_read",
      "meeting_url_scheduled_only",
      "recording_url_completed_only",
      "canceled_meeting_url_masked",
      "canceled_recording_url_masked",
      "meeting_secrets_absent",
    ]) {
      expect(verification).toContain(signal);
    }

    expect(verification).toContain(
      "normalized_definition like '%meeting_notes = v_meeting_notes%'",
    );

    for (const policyCheck of [
      "student_direct_session_policies",
      "trainer_session_policy_exists",
      "trainer_session_uses_helper",
      "trainer_session_stale_owner_branch",
      "trainer_attendance_policy_exists",
      "trainer_attendance_uses_helper",
      "trainer_attendance_stale_owner_branch",
      "cohorts_policies_referencing_cohort_members",
      "cohort_members_policies_referencing_cohorts",
      "actual_cohort_reciprocal_cycle",
      "attendance_policies_referencing_sessions",
      "session_policies_referencing_attendance",
      "actual_sessions_attendance_reciprocal_cycle",
    ]) {
      expect(verification).toContain(policyCheck);
    }

    expect(verification).not.toContain("cohort_reciprocal_policy_edges");
  });

  test("does not weaken the existing UX-5B source contract", () => {
    const ux5b = read("supabase/bundle_ux5b_session_attendance_safety.sql");
    const applicationSessions = read("src/lib/sessions.ts");
    const applicationAttendance = read("src/lib/attendance.ts");

    expect(ux5b).toContain('drop policy if exists "Linked students can read own sessions"');
    expect(ux5b).toContain('create policy "Trainer can read assigned sessions"');
    expect(ux5b).toContain(
      "coachfort_internal.trainer_can_access_session(",
    );
    expect(applicationSessions).not.toMatch(
      /\.from\("sessions"\)[\s\S]{0,240}\.(insert|update|delete)\(/,
    );
    expect(applicationAttendance).not.toMatch(
      /\.from\("attendance_records"\)[\s\S]{0,240}\.(insert|update|delete)\(/,
    );
  });
});
