import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath =
  "supabase/bundle_ux6b_assignment_lifecycle_student_history.sql";

function readMigration() {
  return readFileSync(join(root, migrationPath), "utf8");
}

function executableSql() {
  return readMigration()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

function executableBody() {
  const match = readMigration().match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);

  expect(match, "Expected one executable BEGIN/COMMIT body").not.toBeNull();
  return match?.[0] ?? "";
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = readMigration().match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );

  expect(match, `Expected ${label} verification block`).not.toBeNull();
  return match?.[1] ?? "";
}

function functionBody(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = executableSql().match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );

  expect(match, `Expected function ${name}`).not.toBeNull();
  return (match?.[0] ?? "").toLowerCase();
}

test.describe("UX-6B assignment lifecycle and Student history contract", () => {
  test("installs one additive function-and-policy migration only", () => {
    const sql = executableSql();

    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.match(/create or replace function public\./gi)).toHaveLength(5);
    expect(sql.match(/create policy /gi)).toHaveLength(2);
    expect(sql).not.toMatch(/create\s+table|alter\s+table|drop\s+table/i);
    expect(sql).not.toMatch(/grant\s+|revoke\s+/i);
    expect(sql).not.toMatch(/delete\s+from|truncate\s+/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.(?!assignment_submissions)/i);
  });

  test("enforces the strict linear transition matrix with safe idempotency", () => {
    const status = functionBody("update_assignment_status_secure");

    expect(status).toContain("for update");
    expect(status).toContain(
      "v_existing.status = 'draft' and v_status = 'published'",
    );
    expect(status).toContain(
      "v_existing.status = 'published' and v_status = 'closed'",
    );
    expect(status).toContain(
      "v_existing.status = 'published' and v_status = 'published'",
    );
    expect(status).toContain(
      "v_existing.status = 'closed' and v_status = 'closed'",
    );
    expect(status).toContain("return v_existing");
    expect(status.indexOf("return v_existing")).toBeLessThan(
      status.indexOf("m69_4_write_audit"),
    );
    expect(status).toContain("assignment status transition is not allowed.");
    expect(status).toContain("using errcode = '22023'");
    expect(status).not.toContain("reopen");
  });

  test("locks assignment edits and applies the lifecycle field matrix", () => {
    const update = functionBody("update_assignment_secure");

    expect(update).toContain("for update");
    expect(update).toContain("v_existing.status = 'draft'");
    expect(update).toContain("v_existing.status = 'published'");
    expect(update).toContain("closed assignments cannot be edited.");

    for (const allowedField of [
      "title = v_title",
      "description = public.m69_4_normalize_text",
      "instructions = public.m69_4_normalize_text",
      "attachment_urls_json = public.m69_4_validate_attachment_urls",
    ]) {
      expect(update).toContain(allowedField);
    }
  });

  test("freezes published relationships without widening Trainer scope", () => {
    const update = functionBody("update_assignment_secure");

    expect(update).toContain("p_course_id is distinct from v_existing.course_id");
    expect(update).toContain("p_cohort_id is distinct from v_existing.cohort_id");
    expect(update).toContain(
      "v_trainer_user_id is distinct from v_existing.trainer_user_id",
    );
    expect(update).toContain(
      "program, cohort, and trainer cannot be changed after publication.",
    );
    expect(update).toMatch(
      /if v_existing\.status = 'draft'[\s\S]*?m69_4_assert_manage_assignment\([\s\S]*?p_course_id,[\s\S]*?p_cohort_id,[\s\S]*?p_assignment_id,[\s\S]*?null[\s\S]*?\);/,
    );
  });

  test("freezes due date and max score after any submission row", () => {
    const update = functionBody("update_assignment_secure");

    expect(update).toContain("from public.assignment_submissions s");
    expect(update).toContain("v_has_submission");
    expect(update).toContain("p_due_at is distinct from v_existing.due_at");
    expect(update).toContain("p_max_score is distinct from v_existing.max_score");
    expect(update).toContain(
      "due date and max score cannot be changed after the first submission.",
    );
    expect(update).not.toMatch(/status\s*=\s*'reviewed'[\s\S]*?v_has_submission/);
  });

  test("keeps Student submission published-only with atomic review reset", () => {
    const submit = functionBody("submit_assignment_secure");

    expect(submit).toContain("for update");
    expect(submit).toContain("v_assignment.status <> 'published'");
    expect(submit).toContain("assignment is not open for submissions.");
    expect(submit).toContain("student_portal_access_allowed");
    expect(submit).toContain("'course_participate'");
    expect(submit).toContain("m69_4_submission_status_for_due_date");
    expect(submit).toContain("on conflict (assignment_id, student_id)");
    expect(submit).toContain("do update set");

    for (const reset of [
      "score = null",
      "feedback = null",
      "reviewed_at = null",
      "reviewed_by = null",
    ]) {
      expect(submit).toContain(reset);
    }
  });

  test("makes Owner and Admin capture insert-only without inferred provenance", () => {
    const submit = functionBody("submit_assignment_secure");
    const adminBranch = submit.match(
      /if v_role in \('owner', 'admin'\) then([\s\S]*?)else/,
    )?.[1];

    expect(adminBranch).toBeTruthy();
    expect(adminBranch).toContain(
      "on conflict (assignment_id, student_id) do nothing",
    );
    expect(adminBranch).not.toContain("do update set");
    expect(submit).toContain(
      "an existing submission cannot be replaced by an administrator.",
    );
  });

  test("allows published and closed review while denying draft review", () => {
    const secure = functionBody("review_assignment_submission_secure");
    const delegated = functionBody("review_delegated_assignment_submission");

    for (const review of [secure, delegated]) {
      expect(review).toContain("status not in ('published', 'closed')");
      expect(review).toContain("assignment is not available for review.");
      expect(review).toContain("submission not found for this student.");
      expect(review).toContain("using errcode = '22023'");
    }

    expect(secure).toContain("m69_4_assert_review_assignment");
    expect(secure).toContain("m69_4_assert_student_in_tenant");
    expect(secure).not.toContain("m69_4_assert_student_in_assignment_roster");
    expect(delegated).toContain("find_active_delegated_permission_for_action");
    expect(delegated).toContain("array['review_assignments']");
    expect(delegated).toContain("log_delegated_permission_used");
    expect(delegated).toContain("m69_4_assert_student_in_tenant");
    expect(delegated).not.toContain("m69_4_assert_student_in_assignment_roster");
  });

  test("adds closed Student history without draft or cross-Student reads", () => {
    const sql = executableSql().toLowerCase();
    const assignmentPolicy = sql.match(
      /create policy "linked students can read assigned assignments"[\s\S]*?\n\);/,
    )?.[0];
    const submissionPolicy = sql.match(
      /create policy "linked students can read own assignment submissions"[\s\S]*?\n\);/,
    )?.[0];

    expect(assignmentPolicy).toBeTruthy();
    expect(assignmentPolicy).toContain("status in ('published', 'closed')");
    expect(assignmentPolicy).toContain("student_portal_access_allowed");
    expect(assignmentPolicy).toContain("'course_read'");
    expect(assignmentPolicy).not.toContain("'draft'");

    expect(submissionPolicy).toBeTruthy();
    expect(submissionPolicy).toContain("a.status in ('published', 'closed')");
    expect(submissionPolicy).toContain("assignment_submissions.student_id");
    expect(submissionPolicy).toContain("student_portal_access_allowed");
    expect(submissionPolicy).toContain("'course_read'");
    expect(submissionPolicy).not.toContain("'draft'");
  });

  test("preserves canonical team scope and avoids reciprocal RLS policy edges", () => {
    const sql = executableSql().toLowerCase();
    const assignmentPolicy = sql.match(
      /create policy "linked students can read assigned assignments"[\s\S]*?\n\);/,
    )?.[0];
    const submissionPolicy = sql.match(
      /create policy "linked students can read own assignment submissions"[\s\S]*?\n\);/,
    )?.[0];

    expect(sql).toContain("m69_4_assert_manage_assignment");
    expect(sql).toContain("m69_4_assert_review_assignment");
    expect(sql).toContain("find_active_delegated_permission_for_action");
    expect(assignmentPolicy).not.toContain("assignment_submissions");
    expect(submissionPolicy).toContain("from public.assignments a");
    expect(sql).not.toMatch(/drop policy if exists "trainer/i);
    expect(sql).not.toMatch(/drop policy if exists "owner/i);
  });

  test("ships aggregate-only PRE and metadata-only POST verification", () => {
    const pre = verificationBlock("PRE-APPLY").toLowerCase();
    const post = verificationBlock("POST-APPLY").toLowerCase();

    for (const signal of [
      "assignment_status_counts",
      "submission_counts_by_assignment_status",
      "reviewed_submission_counts_by_assignment_status",
      "closed_assignments_with_submissions",
      "closed_assignments_with_reviewed_submissions",
      "published_assignments_with_submissions",
      "draft_assignments_with_submissions",
      "historical_transition_evidence",
      "information_schema.table_privileges",
      "aclexplode",
      "browser_write_grants",
      "policy_cycle_signals",
    ]) {
      expect(pre).toContain(signal);
    }

    for (const signal of [
      "lifecycle_signals",
      "edit_signals",
      "submission_signals",
      "review_signals",
      "student_read_signals",
      "scope_policy_signals",
      "browser_write_grants",
      "reciprocal_assignment_submission_cycle",
      "security_gate",
    ]) {
      expect(post).toContain(signal);
    }

    expect(post).toContain("'[[:space:]]+'");
    expect(post).not.toContain("'\\\\s+'");
    expect(post).toContain(
      "'student_resubmission_upsert', submit_source like '%on conflict (assignment_id, student_id) do update%'",
    );

    expect(pre).not.toMatch(
      /\b(?:a|s)\.(?:title|instructions|submission_text|feedback|attachment_urls_json)\b/,
    );
  });

  test("keeps audit metadata content-safe and adds no notification behavior", () => {
    const sql = executableSql().toLowerCase();

    expect(sql).toContain("m69_4_write_audit");
    expect(sql).not.toContain("'submissiontext'");
    expect(sql).not.toContain("'feedbacktext'");
    expect(sql).not.toContain("'attachmenturls'");
    expect(sql).not.toMatch(/notification|email/);
  });

  test("freezes the reviewed executable migration body", () => {
    const hash = createHash("sha256")
      .update(executableBody(), "utf8")
      .digest("hex")
      .toUpperCase();

    expect(hash).toBe(
      "F4C2B45C292D7CBF5E95C7D4D10FCC498EAFC47D29D045EEC527C7A0362D3961",
    );
  });
});
