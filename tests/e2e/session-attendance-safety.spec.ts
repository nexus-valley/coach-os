import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function executableSql() {
  return read("supabase/bundle_ux5b_session_attendance_safety.sql")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

function policyBody(sql: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(
    new RegExp(`create\\s+policy\\s+"${escaped}"[\\s\\S]*?;`, "i"),
  );

  expect(match, `Expected policy ${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-5B session and attendance safety proposal", () => {
  test("removes Student direct-table policies and preserves RPC-only portal reads", () => {
    const sql = executableSql();
    const portal = read(
      "supabase/bundle_ux4b_enrollment_access_permission_hardening.sql",
    );
    const studentPortal = read("src/lib/studentPortal.ts");

    expect(sql).toContain(
      'drop policy if exists "Linked students can read own sessions"',
    );
    expect(sql).toContain(
      'drop policy if exists "Linked students can read own attendance records"',
    );
    expect(sql).not.toContain(
      'create policy "Linked students can read own sessions"',
    );
    expect(sql).not.toContain(
      'create policy "Linked students can read own attendance records"',
    );
    expect(portal).toContain("get_student_portal_sessions(");
    expect(portal).toContain("get_student_portal_attendance(");
    expect(studentPortal).toContain('rpc("get_student_portal_sessions"');
    expect(studentPortal).toContain('rpc("get_student_portal_attendance"');
  });

  test("binds Trainer session reads to exact current assignments", () => {
    const sql = executableSql();
    const sessionsPolicy = policyBody(sql, "Trainer can read assigned sessions");
    const attendancePolicy = policyBody(
      sql,
      "Trainer can read assigned attendance records",
    );

    expect(sql).toContain(
      "create or replace function coachfort_internal.trainer_can_access_session(",
    );
    expect(sql).toContain("p_user_id is distinct from auth.uid()");
    expect(sql).toContain("tm.role = 'trainer'");
    expect(sql).toContain("from public.trainer_course_assignments tca");
    expect(sql).toContain("from public.trainer_cohort_assignments tca");
    expect(sql).toContain("v_effective_course_id := coalesce(");
    expect(sql).toContain("tca.course_id = v_effective_course_id");
    expect(sessionsPolicy).toContain(
      "coachfort_internal.trainer_can_access_session(",
    );
    expect(attendancePolicy).toContain(
      "coachfort_internal.trainer_can_access_session(",
    );
    expect(sessionsPolicy).not.toContain("trainer_user_id = auth.uid()");
    expect(attendancePolicy).not.toContain("trainer_user_id = auth.uid()");
  });

  test("keeps the Trainer helper internal and verifies RLS bypass safety", () => {
    const sql = executableSql();

    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("owner to postgres");
    expect(sql).toContain("helper_owner.rolsuper");
    expect(sql).toContain("helper_owner.rolbypassrls");
    expect(sql).toContain("c.relforcerowsecurity");
    expect(sql).toContain("internal helper schema is API-exposed");
    expect(sql).toContain(
      "revoke all on function coachfort_internal.trainer_can_access_session(",
    );
    expect(sql).toContain(
      "grant execute on function coachfort_internal.trainer_can_access_session(",
    );
    expect(sql).not.toContain("function public.trainer_can_access_session");
  });

  test("makes completed and canceled session states terminal", () => {
    const sql = executableSql();

    expect(sql.match(/Only scheduled sessions can be completed or canceled\./g)).toHaveLength(
      2,
    );
    expect(sql).toContain("v_existing.status <> 'scheduled'");
    expect(sql).toContain("session_row.status <> 'scheduled'");
    expect(sql).toContain("for update");
    expect(sql).toContain("public.m69_3_write_audit(");
    expect(sql).toContain("public.log_delegated_permission_used(");
    expect(sql).not.toMatch(/set\s+status\s*=\s*'scheduled'/i);
  });

  test("separates new attendance eligibility from historical correction", () => {
    const raw = read("supabase/bundle_ux5b_session_attendance_safety.sql");
    const sql = executableSql();
    const existing = read("supabase/module69_3_sessions_attendance_rpcs.sql");

    expect(raw).toContain("Existing rows remain correctable");
    expect(sql).toContain("from public.attendance_records ar");
    expect(sql).toContain("st.status = 'active'");
    expect(sql).toContain("e.status = 'active'");
    expect(sql).toContain("cm.cohort_id = p_session.cohort_id");
    expect(sql).toContain("cm.student_id = p_student_id");
    expect(sql).toContain(
      "p_session.course_id is distinct from v_course_id",
    );
    expect(sql).toContain(
      "Attendance cannot be changed for a canceled session.",
    );
    expect(existing.match(/m69_3_assert_student_in_session_roster/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
    expect(sql).toContain(
      "perform public.m69_3_assert_student_in_session_roster(",
    );
  });

  test("scopes every Trainer attendance report path by authorized session", () => {
    const sql = executableSql();

    expect(sql).toContain(
      "create temporary table reports_scope_sessions(session_id uuid primary key)",
    );
    expect(sql).toContain(
      "coachfort_internal.trainer_can_access_session(\n        p_tenant_id, auth.uid(), s.id",
    );
    expect(
      sql.match(
        /ar\.session_id in \(select session_id from reports_scope_sessions\)/g,
      )?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(sql).toContain(
      "ar.session_id in (select session_id from reports_scope_sessions)",
    );
    expect(sql).toContain(
      "s.id in (select session_id from reports_scope_sessions)",
    );
  });

  test("masks mobile meeting URLs until the canonical join window", () => {
    const sql = executableSql();
    const portal = read(
      "supabase/bundle_ux4b_enrollment_access_permission_hardening.sql",
    );

    expect(sql).toContain("'meeting_url', case");
    expect(sql).toContain(
      "s.join_available_from is null or now() >= s.join_available_from",
    );
    expect(sql).not.toContain("'meeting_url', s.meeting_url");
    expect(portal).toContain("when vs.status = 'completed'");
    expect(portal).toContain("and vs.can_read");
    expect(portal).toContain("then vs.recording_url");
  });

  test("keeps one atomic migration and read-only verification packs", () => {
    const raw = read("supabase/bundle_ux5b_session_attendance_safety.sql");
    const sql = executableSql();

    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(raw).toContain("as preflight_result;");
    expect(raw).toContain("as verification_result;");
    expect(raw).toContain("attendance_currently_ineligible_for_new_row");
    expect(raw).toContain("attendance_on_canceled_sessions");
    expect(raw).toContain("attendance_policies_referencing_sessions");
    expect(raw).toContain("session_policies_referencing_attendance");
    expect(raw).toContain("actual_sessions_attendance_reciprocal_cycle");
    expect(raw).not.toContain("reciprocal_policy_edges");
    expect(raw).toContain("to_regprocedure(ef.expected_identity)");
    expect(raw).toContain("aclexplode(");
    expect(raw).toContain("a.grantee = 0");
    expect(raw).not.toContain("has_function_privilege('PUBLIC'");
    expect(raw).toContain("browser_write_grants");
    expect(sql).not.toMatch(/create\s+table\s+public\./i);
    expect(sql).not.toMatch(/alter\s+table[\s\S]*?add\s+column/i);
    expect(sql).not.toMatch(/alter\s+table[\s\S]*?disable\s+row\s+level\s+security/i);
  });
});
