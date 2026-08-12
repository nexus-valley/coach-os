import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath =
  "supabase/bundle_ux5e_dashboard_session_attendance_summary.sql";

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function executableSql() {
  return read(migrationPath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = read(migrationPath).match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );

  expect(match, `Expected ${label} verification block`).not.toBeNull();
  return match?.[1] ?? "";
}

function functionBody(sql: string) {
  const match = sql.match(
    /create\s+or\s+replace\s+function\s+public\.get_dashboard_session_attendance_summary\([\s\S]*?\n\$\$;/i,
  );

  expect(match, "Expected Dashboard aggregate RPC").not.toBeNull();
  return match?.[0] ?? "";
}

function typescriptFunctionBody(source: string, name: string, nextName: string) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`async function ${nextName}(`, start + 1);

  expect(start, `Expected ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `Expected ${nextName} after ${name}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

test.describe("UX-5E Dashboard attendance aggregate safety", () => {
  test("installs one aggregate-only RPC with the reviewed security posture", () => {
    const sql = executableSql();
    const aggregate = functionBody(sql);

    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(aggregate).toContain(
      "public.get_dashboard_session_attendance_summary(\n  p_tenant_id uuid",
    );
    expect(aggregate).toContain("returns table (");
    for (const field of [
      "attendance_percent integer",
      "total_marked_attendance bigint",
      "low_attendance_alerts bigint",
      "upcoming_online_count bigint",
      "upcoming_hybrid_count bigint",
      "upcoming_offline_count bigint",
    ]) {
      expect(aggregate).toContain(field);
    }
    const returnShape = aggregate.match(/returns table \(([\s\S]*?)\)\nlanguage/i)?.[1];
    expect(returnShape).toBeTruthy();
    expect(returnShape).not.toMatch(
      /session_id|student_id|course_id|cohort_id|meeting_url/i,
    );
    expect(aggregate).toContain("stable");
    expect(aggregate).toContain("security definer");
    expect(aggregate).toContain("set search_path = public, pg_temp");
    expect(sql).toContain(
      "alter function public.get_dashboard_session_attendance_summary(uuid)\nowner to postgres;",
    );
    expect(sql).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(sql).toContain("to authenticated;");
  });

  test("reuses canonical role and Trainer scope with fail-closed denial", () => {
    const aggregate = functionBody(executableSql());

    expect(aggregate).toContain("public.reports_current_role(p_tenant_id)");
    expect(aggregate).toContain(
      "v_actor_role not in ('owner', 'admin', 'staff', 'trainer')",
    );
    expect(aggregate).toContain("v_actor_role is null");
    expect(aggregate).toContain("Dashboard attendance summary access denied.");
    expect(aggregate).toContain(
      "coachfort_internal.trainer_can_access_session(",
    );
    expect(aggregate).toContain("p_tenant_id,\n            auth.uid(),\n            s.id");
    expect(aggregate).not.toMatch(/platform[_ ]?owner/i);
  });

  test("derives attendance and delivery counts from authorized sessions first", () => {
    const aggregate = functionBody(executableSql());

    expect(aggregate).toContain("with authorized_sessions as materialized (");
    expect(aggregate).toContain("s.tenant_id = p_tenant_id");
    expect(aggregate).toContain("join authorized_sessions scoped_session");
    expect(aggregate).toContain("scoped_session.id = ar.session_id");
    expect(aggregate).toContain("ar.tenant_id = p_tenant_id");
    expect(aggregate).toContain(
      "count(*) filter (where ar.status in ('present', 'late'))",
    );
    expect(aggregate).toContain(
      "count(*) filter (where ar.status = 'absent')",
    );
    expect(aggregate).toContain("when attendance.total_marked = 0 then null");
    expect(aggregate).toContain("round((attendance.attended::numeric /");
  });

  test("counts each future scheduled delivery mode exactly once", () => {
    const aggregate = functionBody(executableSql());

    expect(aggregate).toContain("scoped_session.status = 'scheduled'");
    expect(aggregate).toContain("scoped_session.scheduled_start_at >= now()");
    for (const mode of ["online", "hybrid", "offline"]) {
      expect(aggregate).toContain(`scoped_session.delivery_mode = '${mode}'`);
    }
    expect(aggregate).not.toContain("todayStart");
  });

  test("does not alter RLS, policies, tables, indexes, or business rows", () => {
    const sql = executableSql();

    expect(sql).not.toMatch(/create\s+policy|drop\s+policy/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/create\s+(unique\s+)?index/i);
    expect(sql).not.toMatch(/grant\s+.*\s+on\s+table/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\s+(into|public\.|table)/i);
  });

  test("includes complete read-only preflight and post-apply verification", () => {
    const preflight = verificationBlock("PRE-APPLY");
    const verification = verificationBlock("POST-APPLY");

    for (const block of [preflight, verification]) {
      expect(block).toContain("aclexplode(");
      expect(block).toContain("a.grantee = 0");
      expect(block).toContain("relrowsecurity");
      expect(block).toContain("relforcerowsecurity");
      expect(block).toContain("browser_write_grants");
      expect(block).toContain("actual_sessions_attendance_reciprocal_cycle");
      expect(block).toContain("actual_cohort_reciprocal_cycle");
      expect(block).toContain("trainer_can_access_session");
    }

    expect(preflight).toContain("internal_schema");
    expect(preflight).toContain("relevant_indexes");
    expect(verification).toContain("six_aggregate_fields_only");
    expect(verification).toContain("raw_identifiers_absent");
    expect(verification).toContain("authenticated_execute");
    expect(verification).toContain("service_role_execute");
  });
});

test.describe("UX-5E Dashboard application integration", () => {
  test("uses the aggregate RPC without broad attendance or session-ID fallback", () => {
    const dashboard = read("src/lib/dashboard.ts");
    const attendance = typescriptFunctionBody(
      dashboard,
      "getAttendanceDashboardSummary",
      "getAssignmentDashboardSummary",
    );

    expect(attendance).toContain(
      'supabase.rpc("get_dashboard_session_attendance_summary"',
    );
    expect(attendance).not.toContain('.from("attendance_records")');
    expect(attendance).not.toMatch(/\.from\("sessions"\)[\s\S]*?\.select\("id"\)/);
    expect(attendance).not.toContain("scopedSessionIds");
    expect(attendance).not.toMatch(/catch[\s\S]*?attendance_records/);
  });

  test("keeps previews bounded and maps only aggregate metrics", () => {
    const dashboard = read("src/lib/dashboard.ts");
    const attendance = typescriptFunctionBody(
      dashboard,
      "getAttendanceDashboardSummary",
      "getAssignmentDashboardSummary",
    );

    expect(attendance.match(/\.limit\((3|5)\)/g)).toHaveLength(3);
    expect(attendance).toContain("attendancePercent: aggregate.attendance_percent");
    expect(attendance).toContain(
      "totalMarkedAttendance: Number(aggregate.total_marked_attendance)",
    );
    expect(attendance).toContain(
      "lowAttendanceAlerts: Number(aggregate.low_attendance_alerts)",
    );
    expect(attendance).not.toContain("upcomingSessions, ...todaysSessions");
  });

  test("gates Start Class to scheduled sessions and sanitizes failures", () => {
    const page = read("src/components/dashboard/DashboardPageClient.tsx");

    expect(page).toContain(
      'showJoin && session.status === "scheduled" && session.meetingUrl',
    );
    expect(page).toContain('return "Unable to load dashboard data.";');
    expect(page).not.toContain("caught instanceof Error ? caught.message");
  });
});
