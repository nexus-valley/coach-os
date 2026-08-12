import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux6d1_assignment_review_optimistic_concurrency.sql",
);
const submissions = read("src/lib/submissions.ts");
const detail = read(
  "src/components/assignments/AssignmentDetailClient.tsx",
);

function executableSql() {
  const match = migration.match(/\nbegin;\r?\n([\s\S]*?)\r?\ncommit;/i);
  expect(match).toBeTruthy();
  return match?.[1] ?? "";
}

function functionBody(name: string) {
  const match = executableSql().match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\)\\nreturns public\\.assignment_submissions[\\s\\S]*?\\nas \\$\\$([\\s\\S]*?)\\n\\$\\$;`,
      "i",
    ),
  );

  expect(match).toBeTruthy();
  return (match?.[1] ?? "").toLowerCase();
}

test.describe("UX-6D1 assignment review optimistic concurrency", () => {
  test("reuses the non-null updated_at trigger without changing schema or RLS", () => {
    const executable = executableSql().toLowerCase();

    expect(migration).toContain("c.table_name = 'assignment_submissions'");
    expect(migration).toContain("c.column_name = 'updated_at'");
    expect(migration).toContain("set_assignment_submissions_updated_at");
    expect(migration).toContain("new.updated_at = now()");
    expect(executable).not.toMatch(/\balter\s+table\b/);
    expect(executable).not.toMatch(/\bcreate\s+policy\b|\bdrop\s+policy\b/);
    expect(executable).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|trigger|references|maintain)/,
    );
  });

  test("installs required six-argument review signatures", () => {
    const executable = executableSql().toLowerCase();

    for (const name of [
      "review_assignment_submission_secure",
      "review_delegated_assignment_submission",
    ]) {
      expect(executable).toContain(`create or replace function public.${name}(`);
      expect(executable).toMatch(
        new RegExp(
          `${name}\\([\\s\\S]*?p_student_id uuid,[\\s\\S]*?p_expected_submission_updated_at timestamptz,[\\s\\S]*?p_score numeric default null,[\\s\\S]*?p_feedback text default null`,
        ),
      );
      expect(functionBody(name)).toContain(
        "if p_expected_submission_updated_at is null then",
      );
    }
  });

  test("uses assignment-then-submission row locking before comparison", () => {
    for (const name of [
      "review_assignment_submission_secure",
      "review_delegated_assignment_submission",
    ]) {
      const body = functionBody(name);
      const assignmentLock = body.indexOf("from public.assignments a");
      const submissionLock = body.indexOf("from public.assignment_submissions s");
      const comparison = body.indexOf(
        "v_submission.updated_at is distinct from p_expected_submission_updated_at",
      );
      const update = body.indexOf("update public.assignment_submissions s");

      expect(assignmentLock).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("for update", assignmentLock)).toBeLessThan(
        submissionLock,
      );
      expect(submissionLock).toBeGreaterThan(assignmentLock);
      expect(body.indexOf("for update", submissionLock)).toBeLessThan(
        comparison,
      );
      expect(comparison).toBeLessThan(update);
    }
  });

  test("rejects stale revisions before successful review side effects", () => {
    const normal = functionBody("review_assignment_submission_secure");
    const delegated = functionBody(
      "review_delegated_assignment_submission",
    );

    for (const body of [normal, delegated]) {
      expect(body).toContain("using errcode = 'p0001'");
      expect(body).toContain("detail = 'assignment_submission_stale'");
      expect(body.indexOf("assignment_submission_stale")).toBeLessThan(
        body.indexOf("update public.assignment_submissions s"),
      );
    }

    expect(normal.indexOf("assignment_submission_stale")).toBeLessThan(
      normal.indexOf("perform public.m69_4_write_audit"),
    );
    expect(delegated.indexOf("assignment_submission_stale")).toBeLessThan(
      delegated.indexOf("perform public.log_delegated_permission_used"),
    );
  });

  test("preserves lifecycle, authorization, and score contracts", () => {
    const normal = functionBody("review_assignment_submission_secure");
    const delegated = functionBody(
      "review_delegated_assignment_submission",
    );

    for (const body of [normal, delegated]) {
      expect(body).toContain("status not in ('published', 'closed')");
      expect(body).toContain("m69_4_assert_student_in_tenant");
      expect(body).toContain("m69_4_validate_score");
      expect(body).not.toContain("m69_4_assert_student_in_assignment_roster");
    }

    expect(normal).toContain("m69_4_assert_review_assignment");
    expect(delegated).toContain(
      "find_active_delegated_permission_for_action",
    );
    expect(delegated).toContain("array['review_assignments']");
  });

  test("revokes and drops legacy unsafe overloads without cascade", () => {
    const executable = executableSql().toLowerCase();

    expect(executable).toContain(
      "review_assignment_submission_secure(uuid,uuid,uuid,numeric,text)",
    );
    expect(executable).toContain(
      "review_delegated_assignment_submission(uuid,uuid,uuid,numeric,text)",
    );
    expect(executable).toMatch(
      /drop function if exists public\.review_assignment_submission_secure\([\s\S]*?uuid, uuid, uuid, numeric, text[\s\S]*?\);/,
    );
    expect(executable).toMatch(
      /drop function if exists public\.review_delegated_assignment_submission\([\s\S]*?uuid, uuid, uuid, numeric, text[\s\S]*?\);/,
    );
    expect(executable).not.toContain("cascade");
  });

  test("grants only authenticated execution on safe signatures", () => {
    const executable = executableSql().toLowerCase();

    expect(executable).toContain(
      "from public, anon, service_role",
    );
    expect(executable.match(/to authenticated;/g)).toHaveLength(2);
    expect(executable).not.toMatch(
      /grant execute[\s\S]*?to (?:public|anon|service_role)/,
    );
  });

  test("passes the exact loaded revision through both callers", () => {
    expect(submissions).toMatch(
      /reviewDelegatedSubmissionWithRpc\(params: \{[\s\S]*?expectedSubmissionUpdatedAt: string;/,
    );
    expect(submissions).toMatch(
      /export async function reviewSubmission\(params: \{[\s\S]*?expectedSubmissionUpdatedAt: string;/,
    );
    expect(submissions.match(/p_expected_submission_updated_at:/g)).toHaveLength(
      2,
    );
    expect(submissions).toContain(
      "p_expected_submission_updated_at: params.expectedSubmissionUpdatedAt",
    );
    expect(submissions).not.toMatch(
      /new Date\(params\.expectedSubmissionUpdatedAt\)|toISOString\(\)/,
    );
    expect(submissions).not.toContain("PGRST202");
  });

  test("maps stale conflicts safely, reloads, and never retries automatically", () => {
    expect(submissions).toContain('candidate?.code === "P0001"');
    expect(submissions).toContain(
      'candidate.details === "assignment_submission_stale"',
    );
    expect(detail).toContain(
      "expectedSubmissionUpdatedAt: submission.updated_at",
    );
    expect(detail).toContain("if (!submission?.updated_at)");
    expect(detail).toContain("if (isStaleAssignmentReviewError(caught))");
    expect(detail).toContain("setDraft({});");
    expect(detail).toContain("await refresh().catch(() => undefined);");
    expect(detail).toContain("setActionError(staleAssignmentReviewMessage);");
    expect(detail).toMatch(
      /await reviewSubmission\([\s\S]*?await refresh\(\);[\s\S]*?setSuccess\("Submission reviewed\."\);/,
    );

    const staleCatch = detail.match(
      /if \(isStaleAssignmentReviewError\(caught\)\) \{([\s\S]*?)\n\s*\}/,
    )?.[1];
    expect(staleCatch).toBeTruthy();
    expect(staleCatch).not.toContain("reviewSubmission(");
  });

  test("ships robust PRE and POST metadata verification", () => {
    expect(migration).toContain("PRE-APPLY READ-ONLY VERIFICATION");
    expect(migration).toContain("POST-APPLY READ-ONLY VERIFICATION");
    expect(migration).toContain("pg_catalog.pg_depend");
    expect(migration).toContain("old_unsafe_overload_count");
    expect(migration).toContain("browser_write_grants");
    expect(migration).toContain("browser_dangerous_grants");
    expect(migration).toContain("'[[:space:]]+'");
    expect(migration).not.toContain("'\\\\s+'");
    expect(migration).toContain("'security_gate'");
  });

  test("reloads the PostgREST schema cache after replacing RPC identities", () => {
    const executable = executableSql().toLowerCase();
    const reload = executable.indexOf("notify pgrst, 'reload schema';");
    const finalComment = executable.lastIndexOf("comment on function");

    expect(reload).toBeGreaterThan(finalComment);
    expect(executable.match(/notify pgrst, 'reload schema';/g)).toHaveLength(1);
    expect(executable).not.toContain("reload config");
  });
});
