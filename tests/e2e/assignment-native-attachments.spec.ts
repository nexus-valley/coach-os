import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/bundle_ux6f1_assignment_native_attachments.sql"),
  "utf8",
);

function executableBody() {
  const match = migration.match(/^begin;\s*$[\s\S]*?^commit;\s*$/m);

  expect(match, "Expected one executable BEGIN/COMMIT body").not.toBeNull();
  return match?.[0] ?? "";
}

function functionDefinition(schema: string, name: string) {
  const match = executableBody().match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );

  expect(match, `Expected function ${schema}.${name}`).not.toBeNull();
  return (match?.[0] ?? "").toLowerCase();
}

function verificationBlock(label: "PRE-APPLY" | "POST-APPLY") {
  const match = migration.match(
    new RegExp(`/\\*\\s*${label} READ-ONLY VERIFICATION([\\s\\S]*?)\\*/`, "i"),
  );

  expect(match, `Expected ${label} verification block`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
}

function withoutSqlStringLiterals(sql: string) {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

test.describe("UX-6F1 native assignment attachment backend", () => {
  test("creates one normalized assignment-domain table with future submission fields", () => {
    const sql = executableBody().toLowerCase();
    const table = sql.match(
      /create table public\.assignment_attachments \(([\s\S]*?)\n\);/,
    )?.[1];

    expect(table).toBeTruthy();
    for (const column of [
      "id uuid primary key",
      "tenant_id uuid not null",
      "assignment_id uuid not null",
      "submission_id uuid",
      "student_id uuid",
      "purpose text not null",
      "display_file_name text not null",
      "mime_type text not null",
      "byte_size bigint not null",
      "bucket_name text",
      "object_path text",
      "status text not null",
      "created_by uuid",
      "uploaded_at timestamptz",
      "delete_requested_at timestamptz",
      "delete_requested_by uuid",
      "removed_at timestamptz",
    ]) {
      expect(table).toContain(column);
    }
    expect(sql).not.toMatch(/create table public\.(?:private_files|submission_attachments)/);
  });

  test("enforces purpose, status, metadata, path, and restrictive parent deletion", () => {
    const sql = executableBody().toLowerCase();
    const table = sql.match(
      /create table public\.assignment_attachments \(([\s\S]*?)\n\);/,
    )?.[1] ?? "";

    expect(sql).toContain("purpose in ('assignment', 'submission')");
    expect(sql).toContain(
      "status in ('pending_upload', 'uploaded', 'pending_delete', 'removed')",
    );
    expect(sql).toContain("purpose = 'assignment' and submission_id is null and student_id is null");
    expect(sql).toContain("purpose = 'submission' and student_id is not null");
    expect(sql.match(/on delete restrict/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("byte_size between 1 and 10485760");
    expect(sql).toContain("char_length(display_file_name) between 1 and 160");
    expect(sql).toContain("bucket_name = 'coachfort-documents'");
    expect(sql).toContain("status = 'removed'");
    expect(sql).toContain("bucket_name is null");
    expect(sql).toContain("object_path is null");
    expect(table).toContain("purpose = 'assignment'");
    expect(table).toContain("'/assignments/', assignment_id");
    expect(table).toContain("purpose = 'submission'");
    expect(table).toContain("student_id is not null");
    expect(table).toContain("'/submissions/', student_id");
  });

  test("installs required indexes, RLS, and no direct API-role table grants", () => {
    const sql = executableBody().toLowerCase();

    for (const index of [
      "assignment_attachments_storage_identity_uidx",
      "assignment_attachments_assignment_list_idx",
      "assignment_attachments_submission_idx",
      "assignment_attachments_student_assignment_idx",
    ]) {
      expect(sql).toContain(`create ${index.includes("uidx") ? "unique " : ""}index ${index}`);
    }
    expect(sql).toContain("alter table public.assignment_attachments enable row level security");
    expect(sql).not.toContain("force row level security");
    expect(sql).toContain(
      "revoke all privileges on table public.assignment_attachments\n  from public, anon, authenticated, service_role",
    );
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.assignment_attachments/);
    expect(sql).not.toMatch(/grant (?:select|insert|update|delete)[\s\S]*?assignment_attachments/);
  });

  test("removes legacy dangerous document grants while preserving authenticated SELECT only", () => {
    const sql = executableBody().toLowerCase();
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");

    expect(sql).toContain(
      "revoke truncate, references, trigger, maintain\n  on table public.document_records\n  from public, anon, authenticated",
    );
    expect(sql).not.toContain("revoke select on table public.document_records");
    expect(sql).not.toContain("revoke all on table public.document_records");
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[\s\S]*?public\.document_records/);
    expect(sql).toContain(
      "tp.privilege_type not in (\n            'select', 'truncate', 'trigger', 'references', 'maintain'",
    );
    expect(sql).toContain(
      "ux-6f1 prerequisite failed: document_records browser grants are not a recognized remediable baseline",
    );
    expect(sql).toContain(
      "ux-6f1 postcondition failed: document_records browser acl contract",
    );

    for (const signal of [
      "document_records_authenticated_select",
      "document_records_browser_dangerous_grants",
      "document_records_unexpected_browser_grants",
      "recognized_remediable_baseline",
    ]) {
      expect(pre).toContain(`'${signal}'`);
    }
    for (const signal of [
      "authenticated_select_preserved",
      "public_privileges_absent",
      "anon_privileges_absent",
      "browser_write_grants",
      "browser_dangerous_grants",
      "unexpected_browser_grants",
      "authenticated_select_only",
    ]) {
      expect(post).toContain(`'${signal}'`);
    }
    expect(post).toContain("and dra.passed");
    expect(sql).not.toMatch(
      /(?:grant|revoke)[\s\S]{0,160}?on (?:table )?storage\.(?:objects|buckets)/,
    );
  });

  test("keeps tenant consistency and path validation private", () => {
    const trigger = functionDefinition(
      "coachfort_internal",
      "enforce_assignment_attachment_consistency",
    );
    const path = functionDefinition(
      "coachfort_internal",
      "assignment_attachment_path_valid",
    );
    const sql = executableBody().toLowerCase();

    expect(trigger).toContain("v_assignment.tenant_id is distinct from new.tenant_id");
    expect(trigger).toContain("v_submission.assignment_id is distinct from new.assignment_id");
    expect(trigger).toContain("v_submission.student_id is distinct from new.student_id");
    expect(path).toContain("p_purpose = 'assignment'");
    expect(path).toContain("p_student_id is null");
    expect(path).toContain("'/assignments/', p_assignment_id");
    expect(path).toContain("p_purpose = 'submission'");
    expect(path).toContain("p_student_id is not null");
    expect(path).toContain("'/submissions/', p_student_id");
    expect(path).toContain("p_bucket_name = 'coachfort-documents'");
    expect(sql).toContain(
      "revoke all on function coachfort_internal.enforce_assignment_attachment_consistency()\n  from public, anon, authenticated, service_role",
    );
    expect(sql).not.toMatch(
      /grant execute on function coachfort_internal\.(?:enforce_assignment_attachment_consistency|assignment_attachment_path_valid)/,
    );
  });

  test("uses one canonical private-storage calculator for document and assignment bytes", () => {
    const usage = functionDefinition(
      "coachfort_internal",
      "private_storage_usage",
    );

    expect(usage).toContain("from public.document_records");
    expect(usage).toContain("dr.upload_status = 'uploaded'");
    expect(usage).toContain("dr.upload_status = 'pending_upload'");
    expect(usage).toContain("from public.assignment_attachments");
    expect(usage).toContain("aa.status in ('pending_upload', 'uploaded', 'pending_delete')");
    expect(usage).not.toMatch(/aa\.status\s*=\s*'removed'/);
    expect(usage).toContain("assignment_attachment_bytes");
    expect(usage).toContain("document_count_usage");
  });

  test("keeps document_uploads document-specific and storage_mb global", () => {
    const quota = functionDefinition(
      "coachfort_internal",
      "assert_private_storage_quota",
    );
    const assignmentPrepare = functionDefinition(
      "public",
      "prepare_assignment_attachment_upload_secure",
    );
    const documentPrepare = functionDefinition(
      "public",
      "prepare_document_file_upload",
    );

    expect(quota).toContain("p_enforce_document_count boolean");
    expect(quota).toContain("p_tenant_id, 'storage_mb'");
    expect(quota).toContain("p_tenant_id, 'document_uploads'");
    expect(assignmentPrepare).toContain("p_byte_size, 0, false");
    expect(documentPrepare).toContain("v_document_count_delta");
    expect(documentPrepare).toContain("true");
    expect(assignmentPrepare).not.toContain("'document_uploads'");
  });

  test("serializes Document Center and assignment reservations on the same tenant lock", () => {
    const documentPrepare = functionDefinition(
      "public",
      "prepare_document_file_upload",
    );
    const assignmentPrepare = functionDefinition(
      "public",
      "prepare_assignment_attachment_upload_secure",
    );
    const lock = "'document_upload_quota:'";

    for (const source of [documentPrepare, assignmentPrepare]) {
      expect(source).toContain("pg_catalog.pg_advisory_xact_lock");
      expect(source).toContain("pg_catalog.hashtextextended");
      expect(source).toContain(lock);
      expect(source).toContain("7174");
      expect(source).toContain("assert_private_storage_quota");
    }
    expect(documentPrepare).toContain("p_file_size_bytes - v_existing_counted_bytes");
  });

  test("reuses assignment management and enforces lifecycle and native count", () => {
    const prepare = functionDefinition(
      "public",
      "prepare_assignment_attachment_upload_secure",
    );
    const remove = functionDefinition(
      "public",
      "prepare_assignment_attachment_removal_secure",
    );

    for (const source of [prepare, remove]) {
      expect(source).toContain("m69_4_assert_manage_assignment");
      expect(source).toContain("status not in ('draft', 'published')");
      expect(source).toContain("closed assignments cannot receive attachment changes");
    }
    expect(prepare).toContain("v_live_count >= 10");
    expect(prepare).toContain("'assignment'");
    expect(prepare).not.toContain("p_purpose");
    expect(prepare).not.toContain("p_tenant_id");
    expect(prepare).not.toContain("p_bucket");
    expect(prepare).not.toContain("p_object_path");
  });

  test("authorizes Student reads through published/closed, cohort, and canonical course_read", () => {
    const readScope = functionDefinition(
      "coachfort_internal",
      "assignment_attachment_read_scope",
    );
    const authorize = functionDefinition(
      "public",
      "authorize_assignment_attachment_download_secure",
    );

    expect(readScope).toContain("p_user_id is distinct from auth.uid()");
    expect(readScope).toContain("v_assignment.status not in ('published', 'closed')");
    expect(readScope).toContain("from public.student_portal_accounts");
    expect(readScope).toContain("from public.cohort_members");
    expect(readScope).toContain("student_portal_access_allowed");
    expect(readScope).toContain("'course_read'");
    expect(authorize).toContain("v_attachment.purpose <> 'assignment'");
    expect(authorize).toContain("v_attachment.status <> 'uploaded'");
    expect(authorize).not.toContain("p_student_id");
    expect(authorize).not.toContain("p_course_id");
    expect(authorize).not.toContain("p_cohort_id");
  });

  test("loads rowtype records independently and keeps tenant-scoped course fallback", () => {
    const sql = executableBody().toLowerCase();
    const readScope = functionDefinition(
      "coachfort_internal",
      "assignment_attachment_read_scope",
    );

    expect(readScope).not.toContain("into v_assignment,");
    expect(readScope).toContain("select a.* into v_assignment");
    expect(readScope).toMatch(
      /select a\.\* into v_assignment[\s\S]*?where a\.id = p_assignment_id;[\s\S]*?if not found then\s*return null;/,
    );
    expect(readScope).toContain("v_course_id := v_assignment.course_id");
    expect(readScope).toMatch(
      /if v_course_id is null and v_assignment\.cohort_id is not null then[\s\S]*?select c\.course_id into v_course_id[\s\S]*?where c\.tenant_id = v_assignment\.tenant_id\s*and c\.id = v_assignment\.cohort_id;/,
    );
    expect(readScope).toContain("student_portal_access_allowed");
    expect(readScope).toContain("'course_read'");
    expect(sql).not.toMatch(
      /into\s+(?:v_bucket|v_postgres|v_assignment|v_submission|v_document|v_attachment|v_student)\s*,/,
    );
  });

  test("preserves scoped Trainer and delegated review/material access", () => {
    const readScope = functionDefinition(
      "coachfort_internal",
      "assignment_attachment_read_scope",
    );

    expect(readScope).toContain("m69_4_current_role");
    expect(readScope).toContain("m69_4_trainer_can_manage_scope");
    expect(readScope).toContain("v_assignment.trainer_user_id");
    expect(readScope).toContain("m69_4_delegated_permission_id");
    expect(readScope).toContain("array['manage_assignments', 'review_assignments']");
    expect(readScope).toContain("if v_role in ('owner', 'admin', 'staff')");
  });

  test("projects safe browser descriptors and keeps storage references service-only", () => {
    const list = functionDefinition("public", "get_assignment_attachments_secure");
    const authorize = functionDefinition(
      "public",
      "authorize_assignment_attachment_download_secure",
    );
    const storage = functionDefinition(
      "public",
      "get_assignment_attachment_storage_reference_server",
    );
    const sql = executableBody().toLowerCase();

    expect(list).toContain("returns table");
    expect(list).not.toMatch(/returns table[\s\S]*?(?:bucket_name|object_path)/);
    expect(authorize.match(/return jsonb_build_object\(([\s\S]*?)\);/)?.[1]).not.toMatch(
      /bucket_name|object_path/,
    );
    expect(storage).toContain("auth.role() is distinct from 'service_role'");
    expect(storage).toContain("assignment_attachment_path_valid");
    expect(storage).toMatch(
      /assignment_attachment_path_valid\(\s*v_attachment\.id,\s*v_attachment\.tenant_id,\s*v_attachment\.assignment_id,\s*v_attachment\.student_id,\s*v_attachment\.purpose,/,
    );
    expect(storage).toContain("'bucket_name'");
    expect(storage).toContain("'object_path'");
    expect(sql).toContain(
      "grant execute on function public.get_assignment_attachment_storage_reference_server(uuid)\n  to service_role",
    );
    expect(sql).not.toContain(
      "grant execute on function public.get_assignment_attachment_storage_reference_server(uuid)\n  to authenticated",
    );
  });

  test("installs idempotent service transitions and exact ACL separation", () => {
    const finalize = functionDefinition(
      "public",
      "finalize_assignment_attachment_upload_server",
    );
    const cancel = functionDefinition(
      "public",
      "cancel_assignment_attachment_upload_server",
    );
    const remove = functionDefinition(
      "public",
      "finalize_assignment_attachment_removal_server",
    );
    const sql = executableBody().toLowerCase();

    expect(finalize).toContain("if v_attachment.status = 'uploaded' then");
    expect(finalize).toContain("status <> 'pending_upload'");
    expect(finalize).toMatch(
      /assignment_attachment_path_valid\(\s*v_attachment\.id,\s*v_attachment\.tenant_id,\s*v_attachment\.assignment_id,\s*v_attachment\.student_id,\s*v_attachment\.purpose,/,
    );
    expect(cancel).toContain("if v_attachment.status = 'removed' then");
    expect(cancel).toContain("status <> 'pending_upload'");
    expect(remove).toContain("if v_attachment.status = 'removed' then");
    expect(remove).toContain("status <> 'pending_delete'");
    expect(cancel).toContain("bucket_name = null");
    expect(remove).toContain("object_path = null");

    const authenticatedGrants = sql.match(
      /grant execute on function public\.(?:get_assignment_attachments_secure|prepare_assignment_attachment_upload_secure|authorize_assignment_attachment_download_secure|prepare_assignment_attachment_removal_secure)[\s\S]*?to authenticated;/g,
    );
    const serviceGrants = sql.match(
      /grant execute on function public\.(?:get_assignment_attachment_storage_reference_server|finalize_assignment_attachment_upload_server|cancel_assignment_attachment_upload_server|finalize_assignment_attachment_removal_server)[\s\S]*?to service_role;/g,
    );
    expect(authenticatedGrants).toHaveLength(4);
    expect(serviceGrants).toHaveLength(4);
  });

  test("supports manager-authorized pending upload recovery without skipping physical cleanup", () => {
    const prepareRemoval = functionDefinition(
      "public",
      "prepare_assignment_attachment_removal_secure",
    );
    const cancelUpload = functionDefinition(
      "public",
      "cancel_assignment_attachment_upload_server",
    );
    const pendingUploadBranch = prepareRemoval.match(
      /if v_attachment\.status = 'pending_upload' then([\s\S]*?)end if;/,
    )?.[1] ?? "";

    expect(prepareRemoval).toContain("m69_4_assert_manage_assignment");
    expect(prepareRemoval).toContain("status not in ('draft', 'published')");
    expect(prepareRemoval.indexOf("m69_4_assert_manage_assignment")).toBeLessThan(
      prepareRemoval.indexOf("if v_attachment.status = 'pending_upload' then"),
    );
    expect(prepareRemoval.indexOf("status not in ('draft', 'published')")).toBeLessThan(
      prepareRemoval.indexOf("if v_attachment.status = 'pending_upload' then"),
    );
    expect(pendingUploadBranch).toContain("'status', 'pending_upload'");
    expect(pendingUploadBranch).toContain("'cleanup_mode', 'cancel_upload'");
    expect(pendingUploadBranch).not.toContain("update public.assignment_attachments");
    expect(pendingUploadBranch).not.toContain("pending_delete");
    expect(prepareRemoval).toMatch(
      /if v_attachment\.status = 'pending_delete' then[\s\S]*?'cleanup_mode', 'delete_uploaded'/,
    );
    expect(prepareRemoval).toMatch(
      /if v_attachment\.status = 'removed' then[\s\S]*?'cleanup_mode', 'none'/,
    );
    expect(cancelUpload).toContain("status <> 'pending_upload'");
    expect(cancelUpload).toContain("set\n    status = 'removed'");
    expect(cancelUpload).toContain("bucket_name = null");
    expect(cancelUpload).toContain("object_path = null");
  });

  test("preserves frozen assignment, review, notification, and legacy URL contracts", () => {
    const sql = executableBody().toLowerCase();

    for (const identity of [
      "public.create_assignment_secure(uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)",
      "public.update_assignment_secure(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,numeric,timestamptz)",
      "public.submit_assignment_secure(uuid,uuid,uuid,text,jsonb)",
      "public.review_assignment_submission_secure(uuid,uuid,uuid,timestamptz,numeric,text)",
      "public.review_delegated_assignment_submission(uuid,uuid,uuid,timestamptz,numeric,text)",
      "public.prepare_document_file_upload(uuid,text,text,bigint)",
    ]) {
      expect(migration.toLowerCase()).toContain(identity);
    }
    expect(sql).not.toMatch(
      /create or replace function public\.(?:create_assignment_secure|update_assignment_secure|submit_assignment_secure|review_assignment_submission_secure|review_delegated_assignment_submission)/,
    );
    expect(sql).not.toContain("create or replace function public.create_notification_secure");
    expect(sql).not.toMatch(/alter table public\.(?:assignments|assignment_submissions)/);
    expect(migration).toContain("attachment_urls_json");
  });

  test("does not activate Student submission attachment workflow", () => {
    const sql = executableBody().toLowerCase();
    const prepare = functionDefinition(
      "public",
      "prepare_assignment_attachment_upload_secure",
    );

    expect(sql).not.toMatch(
      /create or replace function public\.[a-z0-9_]*submission[a-z0-9_]*attachment[a-z0-9_]*upload/,
    );
    expect(sql).not.toMatch(/grant execute[\s\S]*?submission[\s\S]*?attachment[\s\S]*?to authenticated/);
    expect(prepare).toMatch(
      /insert into public\.assignment_attachments \([\s\S]*?purpose,[\s\S]*?values \(\s*v_attachment_id,\s*v_assignment\.tenant_id,\s*v_assignment\.id,\s*'assignment',/,
    );
    expect(prepare).not.toContain("'submission'");
    expect(sql).toContain("where aa.purpose = 'submission'");
    expect(sql).toContain("raise exception 'ux-6f1 postcondition failed: legacy/deferred submission contract.'");
  });

  test("ships a read-only PRE and a security-gated POST verifier", () => {
    const pre = verificationBlock("PRE-APPLY");
    const post = verificationBlock("POST-APPLY");

    expect(pre).toContain("ux6f1_preflight");
    expect(pre).toContain("assignment_attachments_relation");
    expect(pre).toContain("coachfort-documents");
    expect(pre).toContain("document_pending_bytes");
    expect(withoutSqlStringLiterals(pre)).not.toMatch(
      /\b(?:insert|update|delete|merge|truncate|alter|create|drop)\s+/,
    );

    expect(post).toContain("'security_gate'");
    for (const section of [
      "table_contract",
      "indexes",
      "rls",
      "direct_grants",
      "document_records_acl_contract",
      "rpc_contract",
      "service_rpc_contract",
      "private_helpers",
      "internal_schema",
      "quota_contract",
      "shared_lock_contract",
      "document_center_compatibility",
      "assignment_lifecycle_contract",
      "student_download_contract",
      "path_contract",
      "recovery_contract",
      "legacy_url_contract",
      "submission_deferred_contract",
    ]) {
      expect(post).toContain(`'${section}'`);
    }
    for (const signal of [
      "assignment_path_supported",
      "submission_path_supported",
      "caller_path_absent",
      "pending_upload_manager_authorized",
      "pending_upload_not_changed_to_pending_delete",
      "service_cancel_available",
      "pending_delete_retry_supported",
      "removed_idempotent",
    ]) {
      expect(post).toContain(`'${signal}'`);
    }
    expect(withoutSqlStringLiterals(post)).not.toMatch(
      /\b(?:insert|update|delete|merge|truncate|alter|create|drop)\s+/,
    );
  });

  test("keeps one executable transaction and reloads PostgREST", () => {
    const sql = executableBody().toLowerCase();

    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql).toContain("notify pgrst, 'reload schema'");
    expect(sql).not.toMatch(/delete from|truncate table|update public\.(?:assignments|assignment_submissions)/);
  });
});
