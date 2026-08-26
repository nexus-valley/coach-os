import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/bundle_ux6f2_submission_native_attachments.sql",
  ),
  "utf8",
);
const existingSubmitCallers = [
  "src/lib/studentPortalAssignments.ts",
  "src/lib/submissions.ts",
].map((path) => readFileSync(join(process.cwd(), path), "utf8"));
const reviewArchitecture = readFileSync(
  join(process.cwd(), "supabase/module69_4_assignments_submissions_rpcs.sql"),
  "utf8",
);
const currentReviewRpcs = readFileSync(
  join(
    process.cwd(),
    "supabase/bundle_ux6d1_assignment_review_optimistic_concurrency.sql",
  ),
  "utf8",
);
const ux6f1Attachments = readFileSync(
  join(
    process.cwd(),
    "supabase/bundle_ux6f1_assignment_native_attachments.sql",
  ),
  "utf8",
);

function executableBody() {
  const match = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);

  expect(match, "Expected one executable BEGIN/COMMIT body").not.toBeNull();
  return match?.[0] ?? "";
}

function sourceFunctionDefinition(source: string, schema: string, name: string) {
  const match = source.match(
    new RegExp(
      `create(?:\\s+or\\s+replace)?\\s+function\\s+${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );

  expect(match, `Expected function ${schema}.${name}`).not.toBeNull();
  return (match?.[0] ?? "").toLowerCase();
}

function functionDefinition(schema: string, name: string) {
  return sourceFunctionDefinition(executableBody(), schema, name);
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );

  expect(match, `Expected ${label} verification block`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

function adminSubmitBranch() {
  const submit = functionDefinition("public", "submit_assignment_secure");
  const branch = submit.match(
    /if v_role in \('owner', 'admin'\) then([\s\S]*?)else/,
  )?.[1];

  expect(branch, "Expected isolated Owner/Admin submit branch").toBeTruthy();
  return branch ?? "";
}

test.describe("UX-6F2 Student submission native attachment backend", () => {
  test("ships aggregate-only PRE and a gated POST verifier", () => {
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");

    for (const signal of [
      "five_arg_installed",
      "six_arg_installed",
      "student_upsert",
      "late_helper",
      "review_reset",
      "admin_insert_only",
      "text_default",
      "legacy_url_default",
      "submission_purpose_rows",
      "browser_write_grants",
      "service_rpc_contract",
      "review_authorization_contract",
      "api_exposed",
    ]) {
      expect(pre).toContain(`'${signal}'`);
    }

    for (const contract of [
      "submit_contract",
      "student_identity_contract",
      "staging_contract",
      "atomic_association_contract",
      "admin_capture_contract",
      "review_reset_contract",
      "optimistic_concurrency_trigger",
      "late_contract",
      "student_recovery_contract",
      "download_contract",
      "reviewer_contract",
      "rpc_acl_contract",
      "service_rpc_compatibility",
      "ux6f1_compatibility",
      "security_gate",
    ]) {
      expect(post).toContain(`'${contract}'`);
    }

    expect(pre).not.toMatch(
      /\b(?:title|instructions|submission_text|feedback|object_path|bucket_name)\b\s*(?:,|as)/,
    );
  });

  test("replaces the old submit identity with one deployment-compatible six-arg RPC", () => {
    const sql = executableBody().toLowerCase();
    const post = verificationBlock("POST-APPLY");
    const submit = functionDefinition("public", "submit_assignment_secure");

    expect(sql).toContain(
      "drop function public.submit_assignment_secure(uuid, uuid, uuid, text, jsonb);",
    );
    expect(submit).toMatch(
      /p_submission_text text default null,\s*p_attachment_urls_json jsonb default '\[\]'::jsonb,\s*p_native_attachment_ids uuid\[\] default '\{\}'::uuid\[\]/,
    );
    expect(submit).toContain("returns public.assignment_submissions");
    expect(sql).toContain("p.pronargdefaults = 2");
    expect(sql).toContain("p.pronargdefaults = 3");
    expect(sql).toContain("p_submission_text text default null");
    expect(sql).toContain(
      "p_attachment_urls_json jsonb default '[]'::jsonb",
    );
    expect(sql).toContain(
      "p_native_attachment_ids uuid[] default '{}'::uuid[]",
    );
    expect(post).toContain("three_trailing_defaults");
    expect(sql).toContain("five-argument submit defaults drift");
    expect(sql).toContain("canonical submit defaults drift");
    expect(post).toContain("text_default_preserved");
    expect(post).toContain("legacy_url_default_preserved");
    expect(post).toContain(
      "{submit_contract,three_trailing_defaults}",
    );
    expect(sql).toContain("old submit identity remains");
    expect(sql).toContain("notify pgrst, 'reload schema';");
    expect(sql.match(/notify pgrst, 'reload schema';/g)).toHaveLength(1);
  });

  test("keeps both deployed five-named-argument callers compatible", () => {
    const submit = functionDefinition("public", "submit_assignment_secure");

    expect(submit).toContain("p_submission_text text default null");
    expect(submit).toContain(
      "p_attachment_urls_json jsonb default '[]'::jsonb",
    );
    expect(submit).toContain(
      "p_native_attachment_ids uuid[] default '{}'::uuid[]",
    );
    expect(submit).toMatch(
      /p_student_id uuid,\s*p_submission_text text default null/,
    );

    for (const caller of existingSubmitCallers) {
      const rpc = caller.match(
        /\.rpc\("submit_assignment_secure", \{([\s\S]*?)\n\s*\}\)/,
      )?.[1] ?? "";

      for (const argument of [
        "p_assignment_id",
        "p_attachment_urls_json",
        "p_student_id",
        "p_submission_text",
        "p_tenant_id",
      ]) {
        expect(rpc).toContain(`${argument}:`);
      }
      expect(rpc).not.toContain("p_native_attachment_ids");
    }
  });

  test("derives one active portal Student and exposes three fail-closed modes", () => {
    const context = functionDefinition(
      "coachfort_internal",
      "student_submission_attachment_context",
    );

    expect(context).toContain("v_user_id uuid := auth.uid()");
    expect(context).toContain("p_expected_student_id is distinct from v_student_id");
    expect(context).toContain("spa.status = 'active'");
    expect(context).toContain("s.status = 'active'");
    expect(context).toContain("s.portal_enabled = true");
    expect(context).toContain("from public.cohort_members");
    expect(context).toContain("'course_participate'");
    expect(context).toContain("'course_read'");
    expect(context).toContain("'portal'");
    expect(context).toContain("v_mode not in ('participate', 'read', 'recover')");
    expect(context).not.toContain("p_tenant_id");
    expect(context).not.toContain("p_course_id");
  });

  test("prepares exact-own staged uploads under shared storage quota", () => {
    const prepare = functionDefinition(
      "public",
      "prepare_submission_attachment_upload_secure",
    );

    expect(prepare).toContain("student_submission_attachment_context");
    expect(prepare).toContain("'participate'");
    expect(prepare).toContain("document_storage_validate_file");
    expect(prepare).toContain("document_storage_sanitize_file_name");
    expect(prepare).toContain("'document_upload_quota:'");
    expect(prepare).toContain("7174");
    expect(prepare).toContain("p_byte_size, 0, false");
    expect(prepare).not.toContain("'document_uploads'");
    expect(prepare).toContain("'submission'");
    expect(prepare).toContain("'/submissions/', v_context.student_id");
    expect(prepare).not.toMatch(/p_(?:tenant|student|submission|purpose|bucket|path|attachment_id)/);
  });

  test("enforces the staged cap without counting associated uploaded files", () => {
    const prepare = functionDefinition(
      "public",
      "prepare_submission_attachment_upload_secure",
    );

    expect(prepare).toContain("aa.submission_id is null");
    expect(prepare).toContain(
      "aa.status in ('pending_upload', 'uploaded', 'pending_delete')",
    );
    expect(prepare).toContain("if v_staged_count >= 10 then");
    expect(prepare.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      prepare.indexOf("select count(*)::integer into v_staged_count"),
    );
  });

  test("returns a bounded Student workspace without storage or identity metadata", () => {
    const list = functionDefinition(
      "public",
      "get_student_submission_attachments_secure",
    );
    const returnShape = list.match(/returns table \(([\s\S]*?)\)\s*language/)?.[1] ?? "";

    for (const field of [
      "id uuid",
      "display_file_name text",
      "mime_type text",
      "byte_size bigint",
      "status text",
      "is_associated boolean",
      "created_at timestamptz",
      "uploaded_at timestamptz",
    ]) {
      expect(returnShape).toContain(field);
    }
    expect(returnShape).not.toMatch(/tenant_id|student_id|submission_id|bucket_name|object_path|created_by/);
    expect(list).toContain("aa.status <> 'removed'");
    expect(list).toContain("limit 20");
    expect(list).toContain("order by aa.created_at, aa.id");
  });

  test("normalizes the complete desired native set before mutation", () => {
    const submit = functionDefinition("public", "submit_assignment_secure");

    expect(submit).toContain(
      "coalesce(p_native_attachment_ids, '{}'::uuid[])",
    );
    expect(submit).toContain("native attachment ids cannot contain null values");
    expect(submit).toContain("select distinct item.id");
    expect(submit).toContain("array_agg(distinct_ids.id order by distinct_ids.id)");
    expect(submit).toContain("cardinality(v_native_attachment_ids) > 10");
  });

  test("uses assignment-submission-attachment lock ordering and avoids rowtype INTO regression", () => {
    const submit = functionDefinition("public", "submit_assignment_secure");
    const post = verificationBlock("POST-APPLY");
    const removal = functionDefinition(
      "public",
      "prepare_submission_attachment_removal_secure",
    );
    const sql = executableBody().toLowerCase();
    const assignmentLock = submit.indexOf("from public.assignments a");
    const submissionLock = submit.indexOf("from public.assignment_submissions s");
    const attachmentLock = submit.indexOf("perform aa.id");

    expect(submit.indexOf("for update", assignmentLock)).toBeLessThan(submissionLock);
    expect(submissionLock).toBeGreaterThan(assignmentLock);
    expect(submit.indexOf("for update", submissionLock)).toBeLessThan(attachmentLock);
    expect(attachmentLock).toBeGreaterThan(submissionLock);
    expect(submit).toContain("order by aa.id\n    for update");
    const attachmentLockQuery = submit.match(
      /perform aa\.id\s+from public\.assignment_attachments aa([\s\S]*?)order by aa\.id\s+for update/,
    )?.[1] ?? "";
    expect(attachmentLockQuery).toContain("aa.tenant_id = p_tenant_id");
    expect(attachmentLockQuery).toContain(
      "aa.assignment_id = p_assignment_id",
    );
    expect(attachmentLockQuery).toContain(
      "aa.student_id = v_context.student_id",
    );
    expect(attachmentLockQuery).toContain("aa.purpose = 'submission'");
    expect(attachmentLockQuery).not.toContain(
      "aa.id = any(v_native_attachment_ids)",
    );
    expect(attachmentLockQuery).not.toMatch(/\bor\b/);
    expect(post).toContain("authoritative_lock_scope");
    expect(removal.indexOf("select a.* into v_assignment")).toBeLessThan(
      removal.indexOf("select aa.* into v_attachment"),
    );
    expect(sql).not.toMatch(
      /into\s+(?:v_assignment|v_attachment|v_context|v_existing_submission|v_submission)\s*,/,
    );
  });

  test("validates selected rows under locks and reconciles one canonical association", () => {
    const submit = functionDefinition("public", "submit_assignment_secure");

    expect(submit).toContain("aa.id = any(v_native_attachment_ids)");
    expect(submit).toContain("aa.tenant_id = p_tenant_id");
    expect(submit).toContain("aa.assignment_id = p_assignment_id");
    expect(submit).toContain("aa.student_id = v_context.student_id");
    expect(submit).toContain("aa.purpose = 'submission'");
    expect(submit).toContain("aa.status = 'uploaded'");
    expect(submit).toContain("aa.submission_id is null");
    expect(submit).toContain("aa.submission_id = v_existing_submission_id");
    expect(submit).toContain("submission_id = v_submission.id");
    expect(submit).toContain("native submission attachment reconciliation failed");
    expect(submit).toContain(
      "v_selected_count <> cardinality(v_native_attachment_ids)",
    );
    expect(submit).toContain(
      "one or more native submission attachments are unavailable",
    );
  });

  test("fails closed on old-function dependencies and drops without cascade", () => {
    const sql = executableBody().toLowerCase();

    expect(sql).toContain("from pg_catalog.pg_depend d");
    expect(sql).toContain("d.refobjid = v_old_submit::oid");
    expect(sql).toContain("d.deptype not in ('e', 'i')");
    expect(sql).toContain("old submit rpc has dependent database objects");
    expect(sql).toContain(
      "drop function public.submit_assignment_secure(uuid, uuid, uuid, text, jsonb);",
    );
    expect(sql).not.toMatch(/drop function[^;]+cascade/);
  });

  test("moves omitted uploaded files to recoverable deletion and leaves other states untouched", () => {
    const submit = functionDefinition("public", "submit_assignment_secure");
    const reconciliation = submit.match(
      /update public\.assignment_attachments aa\s+set\s+status = 'pending_delete'([\s\S]*?)update public\.assignment_attachments aa\s+set\s+submission_id = v_submission\.id/,
    )?.[1] ?? "";

    expect(reconciliation).toContain("submission_id = null");
    expect(reconciliation).toContain("delete_requested_at = now()");
    expect(reconciliation).toContain("delete_requested_by = v_actor");
    expect(reconciliation).toContain("aa.status = 'uploaded'");
    expect(reconciliation).toContain("not (aa.id = any(v_native_attachment_ids))");
    expect(reconciliation).not.toContain("pending_upload");
    expect(reconciliation).not.toContain("pending_delete");
    expect(submit).not.toMatch(/delete\s+from public\.assignment_attachments/);
  });

  test("keeps Owner/Admin capture insert-only and outside attachment reconciliation", () => {
    const branch = adminSubmitBranch();

    expect(branch).toContain("cardinality(v_native_attachment_ids) <> 0");
    expect(branch).toContain(
      "administrators cannot submit student native attachment ids",
    );
    expect(branch).toContain("on conflict (assignment_id, student_id) do nothing");
    expect(branch).not.toContain("do update set");
    expect(branch).not.toContain("assignment_attachments");
    expect(branch).not.toContain("student_submission_attachment_context");
  });

  test("preserves Student upsert, legacy URLs, late behavior, and review reset", () => {
    const submit = functionDefinition("public", "submit_assignment_secure");
    const sql = executableBody().toLowerCase();

    expect(submit).toContain("v_assignment.status <> 'published'");
    expect(submit).toContain("m69_4_submission_status_for_due_date");
    expect(submit).toContain("m69_4_validate_attachment_urls");
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
    expect(submit).toContain("return v_submission");
    expect(sql).toContain("set_assignment_submissions_updated_at");
    expect(sql).toContain("trigger_function.proname = 'set_updated_at'");
    expect(sql).toContain("submission updated_at trigger drift");
    expect(sql).toContain("submission updated_at trigger compatibility");
  });

  test("implements exact-own recovery including closed assignments", () => {
    const context = functionDefinition(
      "coachfort_internal",
      "student_submission_attachment_context",
    );
    const removal = functionDefinition(
      "public",
      "prepare_submission_attachment_removal_secure",
    );

    expect(context).toContain("status not in ('published', 'closed')");
    expect(removal).toContain("'recover'");
    expect(removal).toContain("aa.purpose = 'submission'");
    expect(removal).toMatch(
      /status = 'removed'[\s\S]*?'cleanup_mode', 'none'/,
    );
    expect(removal).toMatch(
      /status = 'pending_upload'[\s\S]*?'cleanup_mode', 'cancel_upload'/,
    );
    expect(removal).toMatch(
      /status = 'pending_delete'[\s\S]*?'cleanup_mode', 'delete_uploaded'/,
    );
    expect(removal).toContain("v_attachment.submission_id is not null");
    expect(removal).toContain(
      "associated submission attachments must be changed by resubmitting",
    );
  });

  test("authorizes own staged preview, own history, and scoped reviewer download", () => {
    const authorize = functionDefinition(
      "public",
      "authorize_submission_attachment_download_secure",
    );
    const response = authorize.match(/return jsonb_build_object\(([\s\S]*?)\);/)?.[1] ?? "";

    expect(authorize).toContain("v_attachment.submission_id is null");
    expect(authorize).toContain("'participate'");
    expect(authorize).toContain("'read'");
    expect(authorize).toContain("v_context.submission_id = v_attachment.submission_id");
    expect(authorize).toContain("m69_4_assert_review_assignment");
    expect(authorize).toContain("status not in ('published', 'closed')");
    expect(response).not.toMatch(/bucket_name|object_path|tenant_id|student_id|submission_id/);
  });

  test("returns only uploaded associated files to current review scopes", () => {
    const reviewer = functionDefinition(
      "public",
      "get_submission_attachments_for_review_secure",
    );
    const shape = reviewer.match(/returns table \(([\s\S]*?)\)\s*language/)?.[1] ?? "";

    expect(reviewer).toContain("m69_4_assert_review_assignment");
    expect(reviewer).toContain("v_assignment.trainer_user_id");
    expect(reviewer).toContain("status not in ('published', 'closed')");
    expect(reviewer).toContain("aa.submission_id = v_submission.id");
    expect(reviewer).toContain("aa.status = 'uploaded'");
    expect(reviewer).toContain("limit 10");
    expect(shape).not.toMatch(/tenant_id|student_id|submission_id|bucket_name|object_path/);
    expect(reviewer).not.toContain("if v_role = 'staff'");
  });

  test("preserves one canonical standard and delegated reviewer authorization union", () => {
    const reviewAssert = sourceFunctionDefinition(
      reviewArchitecture,
      "public",
      "m69_4_assert_review_assignment",
    );
    const standardReview = sourceFunctionDefinition(
      currentReviewRpcs,
      "public",
      "review_assignment_submission_secure",
    );
    const delegatedReview = sourceFunctionDefinition(
      currentReviewRpcs,
      "public",
      "review_delegated_assignment_submission",
    );
    const reviewerList = functionDefinition(
      "public",
      "get_submission_attachments_for_review_secure",
    );
    const reviewerDownload = functionDefinition(
      "public",
      "authorize_submission_attachment_download_secure",
    );
    const sql = executableBody().toLowerCase();
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");

    expect(standardReview).toContain("m69_4_assert_review_assignment");
    expect(delegatedReview).toContain(
      "find_active_delegated_permission_for_action",
    );
    expect(delegatedReview).toContain("array['review_assignments']");
    expect(reviewAssert).toContain("v_role in ('owner', 'admin')");
    expect(reviewAssert).toContain("m69_4_trainer_can_manage_scope");
    expect(reviewAssert).toContain("m69_4_delegated_permission_id");
    expect(reviewAssert).toContain(
      "array['manage_assignments', 'review_assignments']",
    );
    for (const scope of [
      "p_tenant_id",
      "p_course_id",
      "p_cohort_id",
      "p_student_id",
      "p_assignment_id",
    ]) {
      expect(reviewAssert).toContain(scope);
    }
    expect(reviewAssert).not.toContain("v_role = 'staff'");
    expect(ux6f1Attachments.toLowerCase()).toContain(
      "array['manage_assignments', 'review_assignments']",
    );

    expect(reviewerList).toContain("m69_4_assert_review_assignment");
    expect(reviewerDownload).toContain("m69_4_assert_review_assignment");
    expect(reviewerDownload).toContain("exception when sqlstate '42501'");
    expect(reviewerDownload).not.toContain("exception when others");
    expect(reviewerList).toContain("aa.submission_id = v_submission.id");
    expect(reviewerList).toContain("aa.status = 'uploaded'");
    expect(reviewerList).toContain("limit 10");

    expect(sql).toContain("review authorization union drift");
    expect(sql).toContain("shared review authorization helper drift");
    expect(pre).toContain("standard_uses_review_assert");
    expect(pre).toContain("delegated_uses_permission_finder");
    expect(pre).toContain("delegated_permission_helper_installed");
    expect(pre).toContain("delegated_permission_finder_installed");
    expect(pre).toContain("shared_assert_manage_assignments");
    expect(pre).toContain("shared_assert_review_assignments");
    expect(post).toContain("standard_list_authorization");
    expect(post).toContain("standard_download_authorization");
    expect(post).toContain("delegated_list_authorization");
    expect(post).toContain("delegated_download_authorization");
    expect(post).toContain("delegated_permission_helper_installed");
    expect(post).toContain("delegated_permission_finder_installed");
    expect(post).toContain("staff_implicit_absent");
    expect(post).toContain("expected_denial_only");
  });

  test("keeps service RPCs unchanged and installs exact browser/internal ACL separation", () => {
    const sql = executableBody().toLowerCase();

    for (const service of [
      "get_assignment_attachment_storage_reference_server",
      "finalize_assignment_attachment_upload_server",
      "cancel_assignment_attachment_upload_server",
      "finalize_assignment_attachment_removal_server",
    ]) {
      expect(sql).not.toMatch(new RegExp(`create(?:\\s+or\\s+replace)?\\s+function public\\.${service}`));
      expect(sql).toContain(`public.${service}(uuid)`);
    }

    expect(sql).toContain(
      "revoke all on function coachfort_internal.student_submission_attachment_context",
    );
    expect(sql).not.toMatch(
      /grant execute on function coachfort_internal\.student_submission_attachment_context/,
    );
    expect(sql.match(/to authenticated;/g)).toHaveLength(6);
    expect(sql).not.toMatch(/grant execute[\s\S]*?to (?:public|anon|service_role);/);
  });

  test("changes no table, index, policy, review RPC, or direct storage boundary", () => {
    const sql = executableBody().toLowerCase();

    expect(sql).not.toMatch(/\b(?:create|alter|drop)\s+table\b/);
    expect(sql).not.toMatch(/\b(?:create|drop)\s+(?:unique\s+)?index\b/);
    expect(sql).not.toMatch(/\b(?:create|alter|drop)\s+policy\b/);
    expect(sql).not.toMatch(
      /create(?:\s+or\s+replace)?\s+function public\.(?:review_assignment_submission_secure|review_delegated_assignment_submission)/,
    );
    expect(sql).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+|from\s+)?storage\./);
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)[\s\S]*?assignment_attachments/);
  });
});
