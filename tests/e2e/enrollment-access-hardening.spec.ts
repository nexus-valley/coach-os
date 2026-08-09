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

    expect(payments).toContain("requireEffectivePermission");
    expect(paymentLinks).toContain("requireEffectivePermission");
    expect(paymentLinks).toContain('permission: "view_payments"');
    expect(detail).toContain("hasEffectivePermission");
    expect(detail).toContain("const financeAllowed = Boolean(");
    expect(detail).toContain("const [studentPayments, studentPaymentLinks] = financeAllowed");
    expect(detail).toContain("{canViewFinance ? (");
  });

  test("removes unscoped trainer creation and global status controls", () => {
    const students = read("src/components/students/StudentsPageClient.tsx");
    const detail = read("src/components/students/StudentDetailClient.tsx");

    expect(students).toContain('memberRole !== "trainer"');
    expect(students).toContain("formOpen && canCreateStudent");
    expect(detail).toContain('disableStatus={currentRole === "trainer"}');
    expect(detail).toContain('disableProfile={currentRole === "trainer"}');
    expect(students).toContain("disabled={disableProfile}");
    expect(detail).toContain("getEnrollmentStatusOptions(");
    expect(detail).toContain('student?.status === "active"');
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
