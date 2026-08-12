import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const cleanupPath = "supabase/bundle_ux6b_demo_fixture_cleanup.sql";
const lifecyclePath =
  "supabase/bundle_ux6b_assignment_lifecycle_student_history.sql";

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test.describe("UX-6B demo workspace lifecycle compatibility", () => {
  test("seeds submissions only for lifecycle-participating assignments", () => {
    const source = read("src/lib/demoWorkspace.ts");
    const eligibilityHelper = source.match(
      /function shouldSeedDemoAssignmentSubmissions[\s\S]*?\n}/,
    )?.[0];
    const submissionLoop = source.match(
      /for \(const \[assignmentIndex, assignment\] of assignments\.entries\(\)\)[\s\S]*?summary\.submissions \+= 1;/,
    )?.[0];

    expect(eligibilityHelper).toContain(
      'return status === "published" || status === "closed";',
    );
    expect(submissionLoop).toBeTruthy();
    expect(source).toContain('{ days: 10, status: "draft"');
    expect(submissionLoop).toContain(
      "if (!shouldSeedDemoAssignmentSubmissions(assignment.status))",
    );
    expect(submissionLoop).toContain("continue;");
    expect(submissionLoop?.indexOf("continue;") ?? -1).toBeLessThan(
      submissionLoop?.indexOf('insertTracked("assignment_submissions"') ?? -1,
    );
  });

  test("keeps seeded assignment and submission tracking authoritative", () => {
    const source = read("src/lib/demoWorkspace.ts");

    expect(source).toContain('insertTracked("assignments"');
    expect(source).toContain('insertTracked("assignment_submissions"');
    expect(source).toContain("entityType: table");
    expect(source).toContain("seed_batch_id: params.batchId");
    expect(source).toContain("summary.assignments += 1");
    expect(source).toContain("summary.submissions += 1");
  });

  test("guards cleanup by exact tracked same-batch fixture evidence", () => {
    const cleanup = read(cleanupPath).toLowerCase();

    expect(cleanup.match(/^begin;$/gm)).toHaveLength(1);
    expect(cleanup.match(/^commit;$/gm)).toHaveLength(1);
    expect(cleanup).toContain("v_draft_assignments <> 15");
    expect(cleanup).toContain("v_affected_assignments <> 15");
    expect(cleanup).toContain("v_affected_submissions <> 90");
    expect(cleanup).toContain("v_reviewed_submissions <> 60");
    expect(cleanup).toContain("v_untracked_assignments <> 0");
    expect(cleanup).toContain(
      "v_untracked_or_mismatched_submissions <> 0",
    );
    expect(cleanup).toContain("'tenant_mismatch_submission_count'");
    expect(cleanup).toContain("v_tenant_mismatch_submissions <> 0");
    expect(cleanup).toContain(
      "s.tenant_id is distinct from a.tenant_id",
    );
    expect(cleanup).toContain(
      "submission_record.seed_batch_id = assignment_record.seed_batch_id",
    );
    expect(cleanup).toContain("s.tenant_id = a.tenant_id");
    expect(cleanup).toContain("assignment_record.entity_type = 'assignments'");
    expect(cleanup).toContain(
      "submission_record.entity_type = 'assignment_submissions'",
    );
  });

  test("deletes only tracked draft submissions and their tracking rows", () => {
    const cleanup = read(cleanupPath).toLowerCase();
    const deleteTargets = [
      ...cleanup.matchAll(/delete\s+from\s+public\.([a-z_]+)/g),
    ].map((match) => match[1]);

    expect(deleteTargets).toEqual([
      "assignment_submissions",
      "demo_seed_records",
    ]);
    expect(cleanup).toContain("where a.status = 'draft'");
    expect(cleanup).toContain("v_deleted_submissions <> 90");
    expect(cleanup).toContain("v_deleted_tracking_rows <> 90");
    expect(cleanup).toContain("v_post_draft_assignments <> 15");
    expect(cleanup).toContain("v_post_draft_submissions <> 0");
    expect(cleanup).toContain("v_post_draft_reviewed_submissions <> 0");
    expect(cleanup).toMatch(
      /left join public\.assignment_submissions s\s+on s\.assignment_id = a\.id;/,
    );
    expect(cleanup).not.toMatch(
      /left join public\.assignment_submissions s\s+on s\.assignment_id = a\.id\s+and s\.tenant_id = a\.tenant_id;/,
    );
    expect(cleanup).not.toMatch(/\b(?:insert|update|merge|truncate)\b/);
    expect(cleanup).not.toMatch(/delete\s+from\s+public\.(?:assignments|courses|students)\b/);
  });

  test("retains draft assignments and verifies an empty draft submission state", () => {
    const cleanup = read(cleanupPath).toLowerCase();

    expect(cleanup).toContain("'draft_assignments_with_submissions'");
    expect(cleanup).toContain("'draft_submission_rows'");
    expect(cleanup).toContain("'draft_reviewed_submission_rows'");
    expect(cleanup).toContain(
      "count(distinct a.id) filter (where a.status = 'draft') = 15",
    );
    expect(cleanup).toContain(
      "count(s.id) filter (where a.status = 'draft') = 0",
    );
  });

  test("keeps the approved UX-6B migration byte-for-byte frozen", () => {
    const migration = read(lifecyclePath);
    const wholeHash = createHash("sha256")
      .update(migration, "utf8")
      .digest("hex")
      .toUpperCase();
    const executable = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);

    expect(wholeHash).toBe(
      "C63367F31B72F174CCD8AB88FA7CF5693A92C3D082778205CAD83DBD1D6B8D3D",
    );
    expect(executable).not.toBeNull();
    expect(
      createHash("sha256")
        .update(executable?.[0] ?? "", "utf8")
        .digest("hex")
        .toUpperCase(),
    ).toBe(
      "F4C2B45C292D7CBF5E95C7D4D10FCC498EAFC47D29D045EEC527C7A0362D3961",
    );
  });
});
