import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function executableSql() {
  return read("supabase/bundle_ux4b_enrollment_access_permission_hardening.sql")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

function executableUx4b1Sql() {
  return read("supabase/bundle_ux4b1_remove_cohort_rls_recursion.sql")
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

test.describe("UX-4B canonical enrollment access", () => {
  test("defines one status-aware portal and course access contract", () => {
    const sql = executableSql();

    expect(sql).toContain("student_portal_access_allowed");
    expect(sql).toContain("'portal', 'course_read', 'course_participate'");
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("s.portal_enabled = true");
    expect(sql).toContain("spa.status = 'active'");
    expect(sql).toContain("e.status = 'active' and c.status = 'published'");
    expect(sql).toContain("e.status = 'completed'");
    expect(sql).toContain("c.status in ('published', 'archived')");
    expect(sql).toContain("v_mode = 'course_participate'");
  });

  test("uses the canonical helper in portal RLS without widening grants", () => {
    const sql = executableSql();

    for (const table of [
      "courses",
      "course_sections",
      "lessons",
      "lesson_progress",
      "cohorts",
      "sessions",
      "attendance_records",
      "assignments",
      "assignment_submissions",
    ]) {
      expect(sql).toContain(`on public.${table}`);
    }

    expect(sql).toContain("'course_read'");
    expect(sql).toContain("case when sessions.status = 'scheduled'");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)[^;]+to\s+(anon|authenticated)/i);
  });

  test("keeps completed enrollment read-only and blocks paused or cancelled learning", () => {
    const sql = executableSql();

    expect(sql).toContain("'completed', 'historical_read_only'");
    expect(sql).toContain("'paused', 'no_learning_access'");
    expect(sql).toContain("'cancelled', 'no_learning_access'");
    expect(sql).toContain("'course_participate'");
    expect(sql).toContain("Active enrollment is required to update learning progress.");
    expect(sql).toContain("Assignment is not open for student submissions.");
  });

  test("enforces explicit enrollment creation and transition rules", () => {
    const sql = executableSql();

    expect(sql).toContain("v_status <> 'active'");
    expect(sql).toContain("New enrollments must start active.");
    expect(sql).toContain("v_student.status <> 'active'");
    expect(sql).toContain("v_enrollment.status = 'active'");
    expect(sql).toContain("v_status in ('completed', 'paused', 'cancelled')");
    expect(sql).toContain("v_enrollment.status = 'paused'");
    expect(sql).toContain("v_status in ('active', 'cancelled')");
    expect(sql).toContain("v_enrollment.status = 'cancelled'");
    expect(sql).toContain("v_status = 'active'");
    expect(sql).not.toContain("v_enrollment.status = 'completed'\n      and v_status");
  });

  test("enforces trainer course, cohort, and student scope in secure RPCs", () => {
    const sql = executableSql();

    expect(sql).toContain("ux4b_trainer_can_manage_course");
    expect(sql).toContain("ux4b_trainer_can_manage_cohort");
    expect(sql).toContain("ux4b_trainer_can_manage_student");
    expect(sql).toContain("This student is outside your assigned teaching scope.");
    expect(sql).toContain("Trainers can update student notes only.");
    expect(sql).toContain("v_full_name is distinct from btrim(v_existing.full_name)");
    expect(sql).toContain("v_email is distinct from lower(nullif(btrim(v_existing.email), ''))");
    expect(sql).toContain("v_email := v_existing.email");
    expect(sql).toContain("v_role not in ('owner', 'admin', 'staff')");
  });

  test("routes reachable chat, feature, and mobile paths through the canonical helper", () => {
    const sql = executableSql();

    for (const signature of [
      "chat_student_context()",
      "chat_student_can_access_thread(p_thread_id uuid)",
      "m75b_student_context()",
      "m76b_student_context()",
      "get_portal_feature_access(p_tenant_id uuid)",
      "get_mobile_bootstrap()",
      "get_mobile_notifications(",
      "get_mobile_offline_manifest()",
    ]) {
      expect(sql).toContain(signature);
    }

    expect(sql).toContain("v_thread.thread_type = 'cohort_announcement'");
    expect(sql).toContain("coalesce(s.course_id, c.course_id)");
    expect(sql).toContain("case when s.status = 'scheduled'");
    expect(sql).toContain("then 'course_participate' else 'course_read' end");
  });

  test("keeps one transaction and one post-apply verification result", () => {
    const sql = executableSql();

    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.match(/as verification_result;/g)).toHaveLength(1);
    expect(sql.indexOf("commit;")).toBeLessThan(sql.indexOf("as verification_result;"));
    expect(sql).toContain("dangerous");
    expect(sql).toContain("duplicate_enrollment_groups");
    expect(sql).toContain("trainer_scope");
    expect(sql).toContain("trainer_student_enrollment_audit_events");
    expect(sql).toContain("trainer_view_payments_delegations");
    expect(sql).toContain("unsupported_student_statuses");
    expect(sql).toContain("non_completed_with_completed_at");
    expect(sql).toContain("unexpected_student_policy_bypasses");
  });
});

test.describe("UX-4B application permission boundaries", () => {
  test("gates both legacy payment and payment-link reads with effective permission", () => {
    const payments = read("src/lib/payments.ts");
    const paymentLinks = read("src/lib/paymentLinks.ts");
    const detail = read("src/components/students/StudentDetailClient.tsx");
    const detailLoader = read("src/lib/studentDetail.ts");

    expect(payments).toContain("requireEffectivePermission");
    expect(paymentLinks).toContain("requireEffectivePermission");
    expect(paymentLinks).toContain('permission: "view_payments"');
    expect(detailLoader).toContain("hasEffectivePermission");
    expect(detailLoader).toContain('permission: "view_payments"');
    expect(detailLoader).not.toContain("getPaymentsByStudent");
    expect(detailLoader).not.toContain("getPaymentLinksByStudent");
    expect(detail).toContain("detail.capabilities.canViewFinance");
    expect(detail).toContain('href="/app/finance"');
  });

  test("removes unscoped trainer creation and global status controls", () => {
    const students = read("src/components/students/StudentsPageClient.tsx");
    const detail = read("src/components/students/StudentDetailClient.tsx");

    expect(students).toContain('memberRole !== "trainer"');
    expect(students).toContain("formOpen && canCreateStudent");
    expect(detail).toContain(
      "disableStatus={!detail.capabilities.canEditProfile}",
    );
    expect(detail).toContain(
      "disableProfile={!detail.capabilities.canEditProfile}",
    );
    expect(students).toContain("disabled={disableProfile}");
    expect(detail).toContain("relationship.canManageEnrollment");
    expect(detail).toContain("getStudentDetailEnrollmentTransitions");
    expect(detail).toContain(
      'detail.role === "trainer" ? "Edit student notes" : "Edit student"',
    );
  });

  test("does not alter payment mutations or introduce parallel systems", () => {
    const changedSources = [
      read("src/components/students/StudentDetailClient.tsx"),
      read("src/components/students/StudentsPageClient.tsx"),
      read("src/lib/paymentLinks.ts"),
    ].join("\n");

    expect(changedSources).not.toContain("getSupabaseAdminClient");
    expect(changedSources).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(changedSources).not.toContain("student_portal_accounts");
    expect(changedSources).not.toContain("payment_confirmation_mode");
    expect(changedSources).not.toContain("payment_reference");
  });
});

test.describe("UX-4B1 cohort RLS recursion closure", () => {
  test("routes both student policies through one non-recursive definer helper", () => {
    const sql = executableUx4b1Sql();
    const cohortsPolicy = policyBody(sql, "Linked students can read own cohorts");
    const membershipsPolicy = policyBody(
      sql,
      "Linked students can read own cohort memberships",
    );

    expect(sql).toContain(
      "create or replace function coachfort_internal.student_can_access_cohort(",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("owner to postgres");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("p_user_id is distinct from auth.uid()");
    expect(sql).toContain("from public.cohorts c");
    expect(sql).toContain("join public.cohort_members cm");
    expect(sql).toContain("join public.student_portal_accounts spa");
    expect(sql).toContain("public.student_portal_access_allowed(");
    expect(sql).toContain("'course_read', 'course_participate'");
    expect(sql).toContain("helper_owner.rolsuper");
    expect(sql).toContain("helper_owner.rolbypassrls");
    expect(sql).toContain("c.relforcerowsecurity");
    expect(sql).toContain("UX-4B1 cannot install: helper owner cannot bypass RLS");

    expect(cohortsPolicy).toContain(
      "coachfort_internal.student_can_access_cohort(",
    );
    expect(cohortsPolicy).not.toMatch(/from\s+public\.cohort_members/i);
    expect(membershipsPolicy).toContain(
      "coachfort_internal.student_can_access_cohort(",
    );
    expect(membershipsPolicy).not.toMatch(/from\s+public\.cohorts/i);
  });

  test("keeps the helper outside the public RPC schema with policy-only privileges", () => {
    const sql = executableUx4b1Sql();

    expect(sql).toContain(
      "create schema if not exists coachfort_internal authorization postgres;",
    );
    expect(sql).toContain(
      "revoke all on schema coachfort_internal from public, anon, authenticated, service_role;",
    );
    expect(sql).toContain("grant usage on schema coachfort_internal to authenticated;");
    expect(sql).toContain(
      "grant execute on function coachfort_internal.student_can_access_cohort(",
    );
    expect(sql).toContain(") to authenticated;");
    expect(sql).not.toContain(
      "function public.student_can_access_cohort",
    );
    expect(sql).toContain("authenticated_executable_functions");
    expect(sql).toContain("postgrest_db_schemas_setting");
    expect(sql).toContain("authenticator_role_db_schemas_setting");
    expect(sql).toContain("listed_in_authenticator_role_setting");
    expect(sql).toContain("listed_in_visible_postgrest_setting");
    expect(sql).toContain("internal helper schema is API-exposed");
    expect(sql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+coachfort_internal\.student_can_access_cohort\([\s\S]*?\)\s+to\s+(public|anon|service_role)/i,
    );
  });

  test("replaces only recursive student policies and preserves RLS and grants", () => {
    const sql = executableUx4b1Sql();
    const deploymentSmoke = read("tests/e2e/ux4b-deployment-smoke.spec.ts");

    expect(sql.match(/drop\s+policy\s+if\s+exists/gi)).toHaveLength(2);
    expect(sql).toContain(
      'drop policy if exists "Linked students can read own cohorts"',
    );
    expect(sql).toContain(
      'drop policy if exists "Linked students can read own cohort memberships"',
    );
    expect(sql).toContain("alter table public.cohorts enable row level security;");
    expect(sql).toContain(
      "alter table public.cohort_members enable row level security;",
    );
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(
      /grant\s+(select|insert|update|delete|truncate|trigger|references|maintain)\s+on\s+(table\s+)?public\.(cohorts|cohort_members)/i,
    );
    expect(sql).not.toMatch(
      /drop\s+policy[^;]+"Tenant members can read (cohorts|cohort memberships)"/i,
    );
    for (const roleCoverage of [
      "Owner can read students",
      "Admin retains authorized Student Detail",
      "Staff reads remain safe",
      "unassigned Trainer remains scoped out",
      "regression Student portal learning reads remain authorized and recursion-free",
    ]) {
      expect(deploymentSmoke).toContain(roleCoverage);
    }
    expect(deploymentSmoke).toContain(
      "NO ACTIVE PORTAL FIXTURE - AUTHORIZED EMPTY/COHORT READ COVERAGE ONLY",
    );
    expect(deploymentSmoke).toContain(
      "assigned program cards should expose their enrollment state",
    );
    expect(deploymentSmoke).toContain(
      "assertCohortReadsHealthy({ required: true })",
    );
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.match(/as verification_result;/g)).toHaveLength(1);
  });
});
