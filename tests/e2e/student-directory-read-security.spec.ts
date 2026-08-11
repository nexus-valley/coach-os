import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/bundle_ux4c1_secure_trainer_directory_reads.sql"),
  "utf8",
);

function executableSql(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

const sql = executableSql(migration);

test.describe("UX-4C1 Trainer directory read authorization", () => {
  test("replaces broad tenant-member policies with role-aware reads", () => {
    for (const table of [
      "students",
      "enrollments",
      "courses",
      "cohorts",
      "cohort_members",
    ]) {
      expect(sql).toContain(
        `drop policy if exists "Tenant members can read ${
          table === "cohort_members" ? "cohort memberships" : table
        }" on public.${table}`,
      );
      expect(sql).toContain(
        `create policy "Owner admin staff can read ${
          table === "cohort_members" ? "cohort memberships" : table
        }"`,
      );
      expect(sql).toContain(
        `create policy "Assigned trainers can read scoped ${
          table === "cohort_members" ? "cohort memberships" : table
        }"`,
      );
    }

    expect(sql).not.toMatch(
      /create policy "Tenant members can read (?:students|enrollments|courses|cohorts|cohort memberships)"/,
    );
    expect(sql).toContain("array['owner','admin','staff']");
  });

  test("uses an internal auth-bound SECURITY DEFINER helper", () => {
    expect(sql).toContain(
      "create or replace function coachfort_internal.trainer_can_access_student_relationship(",
    );
    expect(sql).toContain("stable\nsecurity definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("p_user_id is distinct from auth.uid()");
    expect(sql).toContain("tm.role = 'trainer'");
    expect(sql).toContain("public.ux4b_trainer_can_manage_student(");
    expect(sql).toContain("public.ux4b_trainer_can_manage_course(");
    expect(sql).toContain(
      "alter function coachfort_internal.trainer_can_access_student_relationship(",
    );
    expect(sql).toContain(") owner to postgres;");
    expect(sql).toContain("internal helper schema is API-exposed");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain(") to authenticated;");
    expect(sql).not.toMatch(/create or replace function public\.trainer_can_access/);
  });

  test("correlates exact cohort membership to the enrollment course", () => {
    expect(sql).toContain("cm.student_id = p_student_id");
    expect(sql).toContain("tca.cohort_id = cm.cohort_id");
    expect(sql).toContain("c.course_id = p_course_id");
    expect(sql).toContain("e.course_id = p_course_id");
    expect(sql).toContain("public.ux4b_trainer_can_manage_course(");
    expect(sql).not.toMatch(
      /trainer_cohort_assignments[\s\S]{0,600}where[\s\S]{0,300}e\.course_id\s*=\s*c\.course_id[\s\S]{0,300}(?!cm\.student_id)/,
    );
  });

  test("keeps exact Trainer cohort rows and scoped course metadata", () => {
    expect(sql).toContain("tca.cohort_id = cohorts.id");
    expect(sql).toContain("tca.cohort_id = cohort_members.cohort_id");
    expect(sql).toContain("tca.course_id = courses.id");
    expect(sql).toContain("c.course_id = courses.id");
    expect(sql).toContain("tca.trainer_user_id = auth.uid()");
  });

  test("preserves linked Student Portal policies and canonical helpers", () => {
    for (const policy of [
      "Linked students can read own student record",
      "Linked students can read own enrollments",
      "Linked students can read enrolled courses",
      "Linked students can read own cohorts",
      "Linked students can read own cohort memberships",
    ]) {
      expect(sql).not.toContain(`drop policy if exists "${policy}"`);
    }

    expect(migration).toContain("public.student_portal_access_allowed");
    expect(migration).toContain("coachfort_internal.student_can_access_cohort");
  });

  test("guards helper ownership, FORCE RLS, grants, and browser writes", () => {
    expect(sql).toContain("c.relforcerowsecurity");
    expect(sql).toContain("helper_owner.rolbypassrls");
    expect(sql).toContain("helper owner cannot bypass RLS");
    expect(sql).toContain("alter table public.students enable row level security");
    expect(sql).toContain("alter table public.enrollments enable row level security");
    expect(sql).not.toMatch(/disable row level security/i);
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|all).*public\.(?:students|enrollments)/i);
  });

  test("removes dangerous API-role privileges without removing RLS reads", () => {
    const revoke = sql.match(
      /revoke truncate, trigger, references, maintain on table[\s\S]+?from public, anon, authenticated, service_role;/i,
    )?.[0];

    expect(revoke).toBeTruthy();
    expect(revoke).toContain("public.tenant_members");
    expect(revoke).toContain("public.trainer_course_assignments");
    expect(revoke).toContain("public.trainer_cohort_assignments");
    expect(sql).not.toMatch(
      /revoke\s+select[\s\S]{0,300}public\.(?:tenant_members|trainer_course_assignments|trainer_cohort_assignments)/i,
    );
    expect(sql).not.toContain(
      'drop policy if exists "Trainer can read own course assignments"',
    );
    expect(sql).not.toContain(
      'drop policy if exists "Trainer can read own cohort assignments"',
    );
    expect(sql).toContain("from public.trainer_course_assignments tca");
    expect(sql).toContain("from public.trainer_cohort_assignments tca");
  });

  test("does not introduce reciprocal policy-table dependencies", () => {
    const policySql = sql.slice(sql.indexOf('drop policy if exists "Tenant members'));
    const studentsPolicy = policySql.slice(
      policySql.indexOf('create policy "Assigned trainers can read scoped students"'),
      policySql.indexOf('drop policy if exists "Tenant members can read enrollments"'),
    );
    const enrollmentsPolicy = policySql.slice(
      policySql.indexOf('create policy "Assigned trainers can read scoped enrollments"'),
      policySql.indexOf('drop policy if exists "Tenant members can read courses"'),
    );
    const cohortsPolicy = policySql.slice(
      policySql.indexOf('create policy "Assigned trainers can read scoped cohorts"'),
      policySql.indexOf('drop policy if exists "Tenant members can read cohort memberships"'),
    );
    const cohortMembersPolicy = policySql.slice(
      policySql.indexOf('create policy "Assigned trainers can read scoped cohort memberships"'),
      policySql.indexOf("commit;"),
    );

    expect(studentsPolicy).not.toContain("public.enrollments");
    expect(enrollmentsPolicy).not.toContain("public.students");
    expect(cohortsPolicy).not.toContain("public.cohort_members");
    expect(cohortMembersPolicy).not.toContain("public.cohorts");
  });

  test("ships compact read-only preflight and post-apply verification", () => {
    expect(migration).toContain("as preflight_result;");
    expect(migration).toContain("as verification_result;");
    expect(migration).toContain("tenant_member_select_policies");
    expect(
      migration.match(/'browser_dangerous_grants'/g),
    ).toHaveLength(2);
    expect(
      migration.match(/'service_role_dangerous_grants'/g),
    ).toHaveLength(2);
    expect(migration).toContain("browser_write_grants");
    expect(migration).toContain("browser_security_gate_passed");
    expect(migration).toContain("reciprocal_policy_edges");
    expect(migration).toContain("pg_catalog.pg_indexes");
    expect(sql).not.toMatch(/\b(?:insert into|update public\.|delete from public\.)/i);
  });
});
