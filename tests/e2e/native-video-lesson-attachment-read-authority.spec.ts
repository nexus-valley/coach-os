import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath =
  "supabase/bundle_video_2c2d3b_lesson_attachment_read_authority.sql";
const prePath = "support-ops/video-2c2d3b-read-authority-pre.sql";
const migration = readFileSync(join(process.cwd(), migrationPath), "utf8");
const pre = readFileSync(join(process.cwd(), prePath), "utf8");
const lower = migration.toLowerCase();
const applyMarker = [
  "-- ---------------------------------------------------------------------------",
  "-- apply (transactional; do not run as part of review)",
].join("\n");
const applyStart = lower.indexOf(applyMarker);
const prerequisiteStart = lower.indexOf(
  "do $video2c2d3b_prerequisite$",
  applyStart,
);
const prerequisiteEnd = lower.indexOf(
  "$video2c2d3b_prerequisite$;",
  prerequisiteStart,
);
const prerequisite = lower.slice(prerequisiteStart, prerequisiteEnd);
const targetStart = lower.indexOf(
  "create function public.get_native_video_lesson_attachment_server",
);
const targetEnd = lower.indexOf(
  "alter function public.get_native_video_lesson_attachment_server",
  targetStart,
);
const target = lower.slice(targetStart, targetEnd);

test.describe("VIDEO-2C2D3-B lesson attachment read authority", () => {
  test("dedicated PRE artifact is the exact read-only migration PRE gate", () => {
    expect(applyStart).toBeGreaterThan(-1);
    expect(pre.trim()).toBe(migration.slice(0, applyStart).trim());
    expect(pre.toLowerCase()).toContain("as ready_for_apply");
    expect(pre.toLowerCase()).not.toMatch(
      /^\s*(begin|commit|insert\s+into|update\s+|delete\s+from|merge\s+|truncate\s+|create\s+|alter\s+|drop\s+|grant\s+|revoke\s+|notify\s+)/gm,
    );
  });

  test("APPLY revalidates approved dependency search paths", () => {
    expect(prerequisite).toContain("procedure.proconfig is null");
    expect(prerequisite).toContain(
      "procedure.proconfig @> array['search_path=public, pg_temp']",
    );
    expect(prerequisite).toContain(
      "procedure.proconfig @> array['search_path=public']",
    );
    expect(prerequisite).not.toMatch(
      /procedure\.proconfig is null\s*\n\s*\) then/,
    );
  });

  test("APPLY independently pins attach and detach security metadata", () => {
    expect(prerequisite).toContain(
      "procedure.oid in (v_attach, v_detach)",
    );
    expect(prerequisite).toContain(
      "pg_get_userbyid(procedure.proowner) <> 'postgres'",
    );
    expect(prerequisite).toContain("or not procedure.prosecdef");
    expect(prerequisite).toContain("procedure.provolatile <> 'v'");
    expect(prerequisite).toContain(
      "is distinct from array['search_path=public, pg_temp']",
    );
    expect(prerequisite).toContain(
      "procedure.prorettype <> 'jsonb'::regtype",
    );
  });

  test("APPLY independently pins attach and detach execution ACLs", () => {
    for (const role of ["service_role", "anon", "authenticated"]) {
      expect(prerequisite).toContain(
        `has_function_privilege('${role}', v_attach, 'execute')`,
      );
      expect(prerequisite).toContain(
        `has_function_privilege('${role}', v_detach, 'execute')`,
      );
    }
    expect(prerequisite).toContain("acl.grantee = 0");
    expect(prerequisite).toContain("acl.privilege_type = 'execute'");
  });

  test("migration creates only the new persistent read function", () => {
    const publicFunctionCreates = [
      ...lower.matchAll(/^create function public\.([a-z0-9_]+)/gm),
    ].map((match) => match[1]);
    expect(publicFunctionCreates).toEqual([
      "get_native_video_lesson_attachment_server",
    ]);
    expect(lower).not.toMatch(
      /^create (or replace )?function public\.attach_native_video_to_lesson_server/gm,
    );
    expect(lower).not.toMatch(
      /^create (or replace )?function public\.detach_native_video_from_lesson_server/gm,
    );
    expect(lower).not.toMatch(/^\s*alter table\b/gm);
    expect(lower).not.toMatch(/^\s*create table\b/gm);
    expect(lower).not.toMatch(/enable row level security|create policy|alter policy/);
    expect(lower).not.toMatch(/grant\s+.+\s+on\s+(table\s+)?public\./);
  });

  test("read authority remains cleanup-visible and emits only safe fields", () => {
    expect(target).toContain("stable");
    expect(target).toContain("security definer");
    expect(target).toContain("set search_path = public, pg_temp");
    expect(target).toContain("assert_native_video_owner_admin");
    expect(target).not.toContain("assert_tenant_operational_access");
    expect(target).not.toContain("assert_effective_operational_feature");
    expect(target).not.toContain("select attachment.*");
    expect(target).not.toContain("select asset.*");
    for (const field of [
      "lesson_id",
      "attachment",
      "asset_id",
      "filename",
      "status",
      "duration_seconds",
      "attached_at",
    ]) {
      expect(target).toContain(`'${field}'`);
    }
    for (const forbidden of [
      "provider_asset_id",
      "provider_upload_id",
      "request_id",
      "video_provider_events",
      "video_upload_sessions",
      "metadata_json",
      "safe_failure_code",
    ]) {
      expect(target).not.toContain(forbidden);
    }
  });

  test("APPLY stays transactional and verifies before schema reload", () => {
    expect(lower).toContain("\nbegin;\n");
    expect(lower).toContain("do $video2c2d3b_prerequisite$");
    expect(lower).toContain("do $video2c2d3b_self_verify$");
    expect(lower).toContain(
      "$video2c2d3b_self_verify$;\n\nnotify pgrst, 'reload schema';\n\ncommit;",
    );
  });
});
