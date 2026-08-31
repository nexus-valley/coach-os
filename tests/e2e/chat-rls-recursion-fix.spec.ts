import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/bundle_ux8g1b1_chat_rls_recursion_fix.sql",
);
const module36 = read("supabase/module36_chat_communication.sql");
const module57 = read("supabase/module57_academy_student_chat.sql");
const ux4b = read(
  "supabase/bundle_ux4b_enrollment_access_permission_hardening.sql",
);
const ux8g1b = read(
  "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
);

function executableSql() {
  const matches = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/gm);
  expect(matches, "Expected one executable transaction").toHaveLength(1);
  return matches?.[0].toLowerCase() ?? "";
}

function verifier(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );
  expect(match, `Expected ${label} verifier`).not.toBeNull();
  return match?.[1].toLowerCase() ?? "";
}

function functionBody(schema: string, name: string) {
  const match = executableSql().match(
    new RegExp(
      `create function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match, `Expected ${schema}.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

function alteredPolicy(name: string) {
  const match = executableSql().match(
    new RegExp(
      `alter policy "${name}"[\\s\\S]*?\\n\\);`,
      "i",
    ),
  );
  expect(match, `Expected altered policy ${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

test.describe("UX-8G1B1 Chat RLS recursion fix", () => {
  test("1. proves the installed historical reciprocal SELECT-policy chain", () => {
    const source = module36.toLowerCase();
    const staff = source.match(
      /create policy "staff can read operational conversation threads"[\s\S]*?\n\);/,
    )?.[0];
    const trainer = source.match(
      /create policy "trainer can read scoped conversation threads"[\s\S]*?\n\);/,
    )?.[0];
    const participants = source.match(
      /create policy "users can read own conversation participants"[\s\S]*?\n\);/,
    )?.[0];
    const messages = source.match(
      /create policy "users can read scoped conversation messages"[\s\S]*?\n\);/,
    )?.[0];

    expect(staff).toContain("from public.conversation_participants");
    expect(trainer).toContain("from public.conversation_participants");
    expect(participants).toContain("from public.conversation_threads");
    expect(messages).toContain("from public.conversation_threads");
    expect(messages).toContain("from public.conversation_participants");

    const pre = verifier("PRE-APPLY");
    expect(pre).toContain("thread_to_participant");
    expect(pre).toContain("participant_to_thread");
    expect(pre).toContain("reciprocal_edge_count");
    expect(pre).toContain("recursion_prone_thread_policy_count = 2");
    expect(pre).toContain("recursion_prone_participant_policy_count = 1");
  });

  test("2. uses one private auth-bound helper with lifecycle before participation", () => {
    const source = functionBody(
      "coachfort_internal",
      "chat_authenticated_user_is_participant",
    );
    expect(source).toContain("stable");
    expect(source).toContain("security definer");
    expect(source).toContain("set search_path = public, pg_temp");
    expect(source).toContain("v_actor_user_id uuid := auth.uid()");
    expect(source).toContain("tenant_operational_access_allowed(p_tenant_id)");
    expect(source).toContain("participant.tenant_id = p_tenant_id");
    expect(source).toContain("participant.thread_id = p_thread_id");
    expect(source).toContain("participant.user_id = v_actor_user_id");
    expect(source.indexOf("tenant_operational_access_allowed")).toBeLessThan(
      source.indexOf("from public.conversation_participants"),
    );
    expect(source).not.toContain("p_user_id");
  });

  test("3. preserves the hardened table ACL and Chat domain lifecycle authorities", () => {
    const staff = alteredPolicy(
      "staff can read operational conversation threads",
    );
    const trainer = alteredPolicy(
      "trainer can read scoped conversation threads",
    );

    for (const policy of [staff, trainer]) {
      expect(policy).toContain("chat_authenticated_user_is_participant");
      expect(policy).not.toContain("from public.conversation_participants");
    }
    const sql = executableSql();
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");
    expect(sql).not.toMatch(
      /grant\s+select\s+on\s+(?:table\s+)?public\.conversation_/,
    );
    expect(sql).not.toContain("ux8g1b operational lifecycle gate");
    expect(pre).toContain("bool_and(not authenticated_select)");
    expect(pre).toContain("authenticated_direct_select_grants = 0");
    expect(pre).toContain("dml_write_grants = 0");
    expect(pre).toContain("maintain_grant_count = 0");
    expect(pre).toContain("preexisting_non_dml_grant_count = 18");
    expect(pre).toContain("grantable_non_dml_grant_count = 0");
    expect(pre).toContain("unexpected_browser_grant_count = 0");
    expect(pre).toContain("preexisting_non_dml_grants");
    for (const privilege of ["references", "trigger", "truncate"]) {
      expect(pre).toContain(`'${privilege}'`);
      expect(post).toContain(`'${privilege}'`);
    }
    expect(pre).toContain("public.chat_current_team_role(uuid)");
    expect(pre).toContain("public.chat_student_context()");
    expect(pre).toContain("public.chat_student_can_access_thread(uuid)");
    expect(pre).toContain("operational_current_team_role");
    expect(post).toContain("bool_and(not authenticated_select)");
    expect(post).toContain("team_role_lifecycle_bound");
    expect(post).toContain("student_context_auth_and_lifecycle_bound");
    expect(post).toContain("student_thread_tenant_bound");
    expect(post).toContain("preexisting_non_dml_grant_count = 18");
    expect(post).toContain("grantable_non_dml_grant_count = 0");
    expect(post).toContain("preexisting_non_dml_grants");
    expect(post).not.toContain("restrictive_chat_gate");

    const tableAclStatements =
      sql.match(/^(?:grant|revoke)\b[\s\S]*?;$/gm) ?? [];
    expect(tableAclStatements).not.toEqual([]);
    for (const statement of tableAclStatements) {
      expect(statement).not.toMatch(
        /on\s+(?:table\s+)?public\.conversation_(?:threads|participants|messages)/,
      );
    }
  });

  test("4. makes the complete thread-participant-message policy graph acyclic", () => {
    const post = verifier("POST-APPLY");
    expect(post).toContain("policy_edges");
    expect(post).toContain("reciprocal_edges");
    expect(post).toContain("edge_count = 0");
    expect(post).toContain("source_table = 'conversation_threads'");
    expect(post).toContain("referenced_table = 'conversation_participants'");
    expect(post).toContain("direct_participant_lookup_absent");
    expect(post).toContain("message_policy_preserved");
    expect(post).toContain("security_gate");
  });

  test("5. keeps expired Students empty and active or grace Student RPC authority intact", () => {
    const helper = functionBody(
      "coachfort_internal",
      "chat_authenticated_user_is_participant",
    );
    expect(helper).toContain("return false");
    expect(helper).toContain("tenant_operational_access_allowed");

    const studentContext = ux8g1b
      .toLowerCase()
      .match(
        /create or replace function public\.chat_student_context\(\)[\s\S]*?\n\$\$;/,
      )?.[0];
    expect(studentContext).toContain("auth.uid()");
    expect(studentContext).toContain("tenant_operational_access_allowed");
    const currentStudentThreadAuthority = ux4b
      .toLowerCase()
      .match(
        /create or replace function public\.chat_student_can_access_thread\(p_thread_id uuid\)[\s\S]*?\n\$\$;/,
      )?.[0];
    expect(currentStudentThreadAuthority).toContain(
      "tenant_id = v_ctx.tenant_id",
    );
    expect(verifier("PRE-APPLY")).toContain(
      "tenant_id = v_ctx.tenant_id",
    );
    expect(executableSql()).toContain("tenant_id = v_ctx.tenant_id");
    expect(verifier("POST-APPLY")).toContain(
      "tenant_id = v_ctx.tenant_id",
    );
    expect(module57.toLowerCase()).toContain(
      "public.chat_student_can_access_thread(ct.id)",
    );
    expect(module57.toLowerCase()).toContain(
      "create or replace function public.get_student_chat_threads()",
    );
    expect(executableSql()).not.toMatch(
      /(?:create|replace|alter|drop) function public\.(?:chat_student_context|chat_student_can_access_thread|get_student_chat_threads)/,
    );
  });

  test("6. preserves cross-tenant binding and team-role authorization semantics", () => {
    const staff = alteredPolicy(
      "staff can read operational conversation threads",
    );
    const trainer = alteredPolicy(
      "trainer can read scoped conversation threads",
    );
    const helper = functionBody(
      "coachfort_internal",
      "chat_authenticated_user_is_participant",
    );

    expect(staff).toContain("array['staff']");
    expect(staff).toContain("'course_discussion'");
    expect(staff).toContain("'cohort_discussion'");
    expect(staff).toContain("'staff_note'");
    expect(trainer).toContain("array['trainer']");
    expect(trainer).toContain("trainer_course_assignments");
    expect(trainer).toContain("trainer_cohort_assignments");
    expect(trainer).toContain("from public.enrollments");
    expect(trainer).toContain("from public.cohort_members");
    expect(helper).toContain("participant.tenant_id = p_tenant_id");
    expect(helper).toContain("participant.thread_id = p_thread_id");
    expect(verifier("POST-APPLY")).toContain("owner_admin_preserved");
    expect(verifier("POST-APPLY")).toContain("student_thread_tenant_bound");
  });

  test("7. enforces safe helper ownership, ACL, RLS bypass, and schema exposure", () => {
    const sql = executableSql();
    const post = verifier("POST-APPLY");
    expect(sql).toContain(
      "alter function coachfort_internal.chat_authenticated_user_is_participant",
    );
    expect(sql).toContain(") owner to postgres");
    expect(sql).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("coachfort_internal must not be postgrest-exposed");
    expect(sql).toContain("class.relforcerowsecurity");
    expect(sql).toContain("helper_owner.rolbypassrls");
    for (const marker of [
      "public_execute_revoked",
      "anon_execute_revoked",
      "authenticated_execute",
      "service_role_execute_revoked",
      "bypass_safe",
      "force_rls_safe",
      "internal_schema_exposure",
      "authenticated_usage",
    ]) {
      expect(post).toContain(marker);
    }
  });

  test("8. is additive policy-only authority with read-only PRE/POST", () => {
    const sql = executableSql();
    const pre = verifier("PRE-APPLY");
    const post = verifier("POST-APPLY");

    expect(sql).not.toMatch(
      /\b(?:insert into|update|delete from|truncate|merge into)\s+public\./,
    );
    expect(sql).not.toMatch(
      /alter table public\.tenant_subscription_assignments/,
    );
    expect(sql).not.toMatch(/(?:razorpay|payment_order|platform_invoice|receipt)/);
    expect(sql).not.toContain("create policy");
    expect(sql.match(/alter policy /g)).toHaveLength(2);
    const statementMutation =
      /^\s*(?:insert|update|delete|truncate|merge|create|alter|drop|grant|revoke)\b/gm;
    expect(pre).not.toMatch(statementMutation);
    expect(post).not.toMatch(statementMutation);
    expect(pre).toContain("safe_row_counts_compare_with_post");
    expect(post).toContain("safe_row_counts_compare_with_pre");
  });
});
