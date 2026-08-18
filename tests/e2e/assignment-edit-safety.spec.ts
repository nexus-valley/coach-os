import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/bundle_ux6d3_assignment_edit_safety.sql"),
  "utf8",
);
const assignmentLibrary = readFileSync(
  join(root, "src/lib/assignments.ts"),
  "utf8",
);
const assignmentDetail = readFileSync(
  join(root, "src/components/assignments/AssignmentDetailClient.tsx"),
  "utf8",
);
const assignmentsPage = readFileSync(
  join(root, "src/components/assignments/AssignmentsPageClient.tsx"),
  "utf8",
);

function executableBody() {
  const match = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);

  expect(match, "Expected one executable BEGIN/COMMIT body").not.toBeNull();
  return match?.[0] ?? "";
}

function functionBody(name: string) {
  const match = executableBody().match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );

  expect(match, `Expected function ${name}`).not.toBeNull();
  return (match?.[0] ?? "").toLowerCase();
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );

  expect(match, `Expected ${label} verification block`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

test.describe("UX-6D3 assignment trainer integrity", () => {
  test("replaces only the existing create and update RPC identities", () => {
    const executable = executableBody().toLowerCase();

    expect(executable.match(/^begin;$/gm)).toHaveLength(1);
    expect(executable.match(/^commit;$/gm)).toHaveLength(1);
    expect(executable.match(/create or replace function public\./g)).toHaveLength(2);
    expect(executable).toContain(
      "create_assignment_secure(\n  p_tenant_id uuid,\n  p_course_id uuid,",
    );
    expect(executable).toContain(
      "update_assignment_secure(\n  p_tenant_id uuid,\n  p_assignment_id uuid,",
    );
    expect(executable.match(/p_attachment_urls_json jsonb default '\[\]'::jsonb/g)).toHaveLength(2);
    expect(executable.match(/p_max_score numeric default null/g)).toHaveLength(2);
    expect(executable.match(/p_due_at timestamptz default null/g)).toHaveLength(2);
    expect(executable.match(/returns public\.assignments/g)).toHaveLength(2);
    expect(executable.match(/set search_path = public, pg_temp/g)).toHaveLength(2);
  });

  test("validates Owner and Admin create targets while preserving NULL", () => {
    const create = functionBody("create_assignment_secure");
    const ownerBranch = create.match(
      /if v_actor_role in \('owner', 'admin'\) then([\s\S]*?)elsif v_actor_role = 'trainer'/,
    )?.[1];

    expect(ownerBranch).toBeTruthy();
    expect(ownerBranch).toContain("v_trainer_user_id := p_trainer_user_id");
    expect(ownerBranch).toContain("if v_trainer_user_id is not null then");
    expect(ownerBranch).toContain("m69_5_assert_active_trainer");
    expect(ownerBranch).toContain(
      "selected trainer is not available in this workspace.",
    );
  });

  test("allows Trainer self-create only and denies delegated trainer selection", () => {
    const create = functionBody("create_assignment_secure");
    const trainerBranch = create.match(
      /elsif v_actor_role = 'trainer' then([\s\S]*?)else/,
    )?.[1];
    const delegatedBranch = create.match(/\n  else([\s\S]*?)\n  end if;/)?.[1];

    expect(trainerBranch).toBeTruthy();
    expect(trainerBranch).toContain(
      "p_trainer_user_id is distinct from auth.uid()",
    );
    expect(trainerBranch).toContain(
      "m69_5_assert_active_trainer(p_tenant_id, auth.uid())",
    );
    expect(trainerBranch).toContain("v_trainer_user_id := auth.uid()");
    expect(delegatedBranch).toBeTruthy();
    expect(delegatedBranch).toContain("if p_trainer_user_id is not null then");
    expect(delegatedBranch).toContain("using errcode = '42501'");
    expect(delegatedBranch).toContain("v_trainer_user_id := null");
  });

  test("locks before lifecycle decisions and preserves the stored trainer", () => {
    const update = functionBody("update_assignment_secure");
    const lock = update.indexOf("from public.assignments a");
    const authorization = update.indexOf("m69_4_assert_manage_assignment");
    const closed = update.indexOf("closed assignments cannot be edited");

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(update.indexOf("for update", lock)).toBeLessThan(authorization);
    expect(authorization).toBeLessThan(closed);
    expect(update).toContain(
      "v_trainer_user_id := v_existing.trainer_user_id",
    );
    expect(update).toContain(
      "p_trainer_user_id is distinct from v_existing.trainer_user_id",
    );
    expect(update).not.toMatch(
      /when v_(?:actor_)?role = 'trainer' then auth\.uid\(\)/,
    );
    expect(update).not.toContain("installed rpc");
  });

  test("allows only Owner or Admin to perform an actual Draft retarget", () => {
    const update = functionBody("update_assignment_secure");
    const draft = update.match(
      /if v_existing\.status = 'draft' then([\s\S]*?)elsif v_existing\.status = 'published'/,
    )?.[1];

    expect(draft).toBeTruthy();
    expect(draft).toContain("if v_trainer_changed then");
    expect(draft).toContain("v_actor_role not in ('owner', 'admin')");
    expect(draft).toContain(
      "you do not have permission to change the assignment trainer.",
    );
    expect(draft).toContain("if p_trainer_user_id is not null then");
    expect(draft).toContain("m69_5_assert_active_trainer");
    expect(draft).toContain("v_trainer_user_id := p_trainer_user_id");
  });

  test("requires independent target scope for an actual Draft relationship move", () => {
    const update = functionBody("update_assignment_secure");
    const relationshipCheck = update.match(
      /if v_relationship_changed then([\s\S]*?)end if;/,
    )?.[1];

    expect(relationshipCheck).toBeTruthy();
    expect(relationshipCheck).toMatch(
      /m69_4_assert_manage_assignment\([\s\S]*?p_tenant_id,[\s\S]*?p_course_id,[\s\S]*?p_cohort_id,[\s\S]*?null,[\s\S]*?null/,
    );
    expect(relationshipCheck).not.toContain("p_assignment_id");
  });

  test("preserves Published content correction and relationship freeze", () => {
    const update = functionBody("update_assignment_secure");
    const published = update.match(
      /elsif v_existing\.status = 'published' then([\s\S]*?)\n  else\n    raise exception 'assignment lifecycle state is not supported\.'/,
    )?.[1];

    expect(published).toBeTruthy();
    expect(published).toContain(
      "if v_relationship_changed or v_trainer_changed then",
    );
    expect(published).toContain(
      "program, cohort, and trainer cannot be changed after publication.",
    );
    expect(update).toContain("trainer_user_id = v_trainer_user_id");
    expect(update).toContain("title = v_title");
    expect(update).toContain(
      "description = public.m69_4_normalize_text",
    );
    expect(update).toContain(
      "instructions = public.m69_4_normalize_text",
    );
    expect(update).toContain(
      "attachment_urls_json = public.m69_4_validate_attachment_urls",
    );
  });

  test("retains the persisted-submission cutoff and Closed denial", () => {
    const update = functionBody("update_assignment_secure");
    const submissionLookup = update.indexOf(
      "from public.assignment_submissions s",
    );
    const assignmentUpdate = update.indexOf("update public.assignments a");

    expect(update).toContain("closed assignments cannot be edited.");
    expect(submissionLookup).toBeGreaterThan(update.indexOf("for update"));
    expect(submissionLookup).toBeLessThan(assignmentUpdate);
    expect(update).toContain("s.tenant_id = p_tenant_id");
    expect(update).toContain("s.assignment_id = p_assignment_id");
    expect(update).toContain(
      "p_due_at is distinct from v_existing.due_at",
    );
    expect(update).toContain(
      "p_max_score is distinct from v_existing.max_score",
    );
    expect(update).not.toMatch(
      /from public\.assignment_submissions s[\s\S]*?s\.status\s*=/,
    );
  });

  test("keeps validation before mutation and audit after success", () => {
    const create = functionBody("create_assignment_secure");
    const update = functionBody("update_assignment_secure");

    expect(create.indexOf("m69_5_assert_active_trainer")).toBeLessThan(
      create.indexOf("insert into public.assignments"),
    );
    expect(create.indexOf("insert into public.assignments")).toBeLessThan(
      create.indexOf("m69_4_write_audit"),
    );
    expect(update.indexOf("if v_trainer_changed then")).toBeLessThan(
      update.indexOf("update public.assignments a"),
    );
    expect(update.indexOf("update public.assignments a")).toBeLessThan(
      update.indexOf("m69_4_write_audit"),
    );
  });

  test("changes no RLS, schema, or browser table privileges", () => {
    const executable = executableBody().toLowerCase();

    expect(executable).not.toMatch(
      /\b(?:create|drop|alter)\s+policy\b|\balter\s+table\b|\bcreate\s+table\b/,
    );
    expect(executable).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|trigger|references|maintain)/,
    );
    expect(executable).not.toMatch(/insert\s+into\s+public\.(?!assignments\b)/);
    expect(executable).not.toMatch(/delete\s+from|truncate\s+/);
    expect(executable).toContain("to authenticated;");
    expect(executable).toContain("from public, anon, service_role;");
    const executeGrants = executable.match(
      /grant execute on function public\.[\s\S]*?\) to [a-z_]+;/g,
    );
    expect(executeGrants).toHaveLength(2);
    expect(executeGrants?.every((grant) => grant.endsWith("to authenticated;"))).toBe(
      true,
    );
  });

  test("keeps the canonical Trainer helper private and unchanged", () => {
    const executable = executableBody().toLowerCase();

    expect(executable).toContain("m69_5_assert_active_trainer");
    expect(executable).not.toContain(
      "create or replace function public.m69_5_assert_active_trainer",
    );
    expect(executable).not.toMatch(
      /grant execute on function public\.m69_5_assert_active_trainer/,
    );
    expect(verificationBlock("POST-APPLY")).toContain("browser_private");
    expect(verificationBlock("POST-APPLY")).toContain(
      "m69_5_assert_tenant_member(uuid,uuid)",
    );
  });

  test("ships robust aggregate PRE and metadata POST verification", () => {
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");

    for (const signal of [
      "trainer_target_null",
      "valid_same_tenant_trainer",
      "same_tenant_wrong_role",
      "no_same_tenant_membership",
      "trainer_membership_other_tenant_only",
      "no_membership_anywhere",
      "affected_assignment_count",
      "affected_tenant_count",
      "browser_write_grants",
      "browser_dangerous_grants",
    ]) {
      expect(pre).toContain(signal);
    }

    for (const signal of [
      "create_trainer_contract",
      "update_trainer_contract",
      "relationship_scope_contract",
      "submission_cutoff_preserved",
      "closed_denial_preserved",
      "success_audit_after_mutation",
      "unintended_execute_grants",
      "security_gate",
    ]) {
      expect(post).toContain(signal);
    }

    expect(pre).not.toMatch(/\b(?:title|description|instructions|email)\b/);
    expect(migration).toContain("'[[:space:]]+'");
    expect(migration).not.toContain("'\\\\s+'");
  });

  test("uses executable fail-closed prerequisite and postcondition guards", () => {
    const executable = executableBody().toLowerCase();

    expect(executable.match(/\ndo \$\$/g)).toHaveLength(2);
    expect(executable).toContain("unexpected assignment create/update overloads");
    expect(executable).toContain("function acl prerequisite failed");
    expect(executable).toContain("trainer column contract is not recognized");
    expect(executable).toContain("browser table grant prerequisite failed");
    expect(executable).toContain("installed rpc contract verification failed");
    expect(executable).not.toContain("notify pgrst");
  });

  test("keeps create compatibility and exposes the hardened edit caller", () => {
    expect(assignmentsPage).toMatch(
      /await createAssignment\(\{[\s\S]*?cohortId:[\s\S]*?courseId:[\s\S]*?tenantId:[\s\S]*?title:/,
    );
    expect(assignmentsPage).not.toContain("trainerUserId:");
    expect(assignmentLibrary).toContain(
      'role === "trainer" ? user.id : input.trainerUserId?.trim() || null',
    );
    const updateHelper = assignmentLibrary.slice(
      assignmentLibrary.indexOf("export async function updateAssignment("),
      assignmentLibrary.indexOf("async function updateAssignmentStatus("),
    );
    expect(updateHelper).toContain(
      "const trainerUserId = input.trainerUserId?.trim() || null;",
    );
    expect(updateHelper).not.toContain('role === "trainer"');
    expect(assignmentDetail).toContain("await updateAssignment(input)");
    expect(assignmentsPage).not.toContain("updateAssignment(");
  });
});
