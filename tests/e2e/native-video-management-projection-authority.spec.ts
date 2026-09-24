import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath =
  "supabase/bundle_video_2c2d0_safe_management_projection_authority.sql";
const migration = readFileSync(join(process.cwd(), migrationPath), "utf8");
const lower = migration.toLowerCase();
const targetStart = lower.indexOf(
  "create function public.get_native_video_management_projection_server",
);
const targetEnd = lower.indexOf(
  "alter function public.get_native_video_management_projection_server",
  targetStart,
);
const target = lower.slice(targetStart, targetEnd);

test.describe("VIDEO-2C2D0 safe native-video management projection", () => {
  test("installs one exact service-only JSONB authority", () => {
    expect(targetStart).toBeGreaterThan(-1);
    expect(target).toContain("p_tenant_id uuid");
    expect(target).toContain("p_actor_user_id uuid");
    expect(target).toContain("p_asset_id uuid");
    expect(target).toContain("p_limit integer");
    expect(target).toContain("p_cursor_created_at timestamptz");
    expect(target).toContain("p_cursor_asset_id uuid");
    expect(target).toContain("returns jsonb");
    expect(target).toContain("stable");
    expect(target).toContain("security definer");
    expect(target).toContain("set search_path = public, pg_temp");
    expect(lower).toContain(
      "grant execute on function public.get_native_video_management_projection_server(\n  uuid,uuid,uuid,integer,timestamptz,uuid\n) to service_role",
    );
    expect(lower).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(lower).toContain("target function already exists");
  });

  test("reuses canonical Owner/Admin authority without commercial gates", () => {
    expect(target).toContain(
      "coachfort_internal.assert_native_video_owner_admin(\n    p_tenant_id, p_actor_user_id",
    );
    expect(target).not.toContain("assert_tenant_operational_access");
    expect(target).not.toContain("assert_effective_operational_feature");
    expect(target).not.toContain("get_native_video_capacity");
    expect(target).not.toContain("platform_admin");
  });

  test("fails closed on modes, partial cursors and list limits", () => {
    expect(target).toContain(
      "(p_cursor_created_at is null) <> (p_cursor_asset_id is null)",
    );
    expect(target).toContain("p_limit is distinct from 1");
    expect(target).toContain("p_cursor_created_at is not null");
    expect(target).toContain("p_cursor_asset_id is not null");
    expect(target).toContain("p_limit is null or p_limit < 1");
    expect(target).toContain("least(p_limit, 100)");
  });

  test("uses descending bounded keyset pagination without OFFSET", () => {
    expect(target).toContain("asset.created_at < p_cursor_created_at");
    expect(target).toContain("asset.id < p_cursor_asset_id");
    expect(target).toContain("order by asset.created_at desc, asset.id desc");
    expect(target).toContain("v_limit + 1");
    expect(target).not.toMatch(/\boffset\b/);
  });

  test("tenant-bounds assets and every attachment relationship", () => {
    expect(target).toContain("asset.tenant_id = p_tenant_id");
    expect(target).toContain("lesson.tenant_id = attachment.tenant_id");
    expect(target).toContain("section.tenant_id = lesson.tenant_id");
    expect(target).toContain("section.course_id = lesson.course_id");
    expect(target).toContain("course.tenant_id = lesson.tenant_id");
    expect(target).toContain("course.tenant_id = section.tenant_id");
    expect(target).toContain("attachment.tenant_id = p_tenant_id");
    expect(target).toContain("attachment.video_asset_id = asset.id");
  });

  test("projects deterministic customer-safe management data", () => {
    for (const field of [
      "asset_id",
      "original_filename",
      "status",
      "duration_seconds",
      "reserved_seconds",
      "created_at",
      "updated_at",
      "delete_requested_at",
      "safe_failure_code",
      "attachments",
      "course_id",
      "course_title",
      "lesson_id",
      "lesson_title",
      "next_cursor",
    ]) {
      expect(target).toContain(`'${field}'`);
    }
    expect(target).toContain("section.sort_order");
    expect(target).toContain("lesson.sort_order");
  });

  test("does not expose provider, capability, event or audit identities", () => {
    for (const forbidden of [
      "provider_asset_id",
      "provider_upload_id",
      "video_provider_events",
      "video_upload_sessions",
      "upload_url",
      "claim_token",
      "request_id",
      "created_by",
      "metadata_json",
    ]) {
      expect(target).not.toContain(forbidden);
    }
  });

  test("target function is read-only and migration changes no table authority", () => {
    expect(target).not.toMatch(/\b(insert|update|delete|merge|truncate)\b/);
    expect(lower).not.toMatch(/alter\s+table/);
    expect(lower).not.toMatch(/create\s+policy|alter\s+policy|drop\s+policy/);
    expect(lower).not.toMatch(/grant\s+select\s+on/);
    expect(lower).not.toMatch(/grant\s+(insert|update|delete)\s+on/);
  });

  test("pins existing helper and native-video server security precedents", () => {
    expect(lower).toContain("013b807c7f5e4d4e97fbb5609b2f5750");
    for (const identity of [
      "reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)",
      "get_native_video_capacity_server(uuid,uuid)",
      "attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)",
      "detach_native_video_from_lesson_server(uuid,uuid,uuid)",
      "request_native_video_deletion_server(uuid,uuid,uuid)",
      "authorize_native_video_playback_server(uuid,uuid,uuid)",
    ]) {
      expect(lower).toContain(identity);
    }
  });

  test("keeps APPLY transactional and reloads PostgREST only after verification", () => {
    expect(lower.trimStart().startsWith("-- bundle video-2c2d0")).toBe(true);
    expect(lower).toContain("\nbegin;");
    expect(lower).toContain("notify pgrst, 'reload schema';\n\ncommit;");
    expect(lower.trimEnd().endsWith("commit;")).toBe(true);
  });
});
