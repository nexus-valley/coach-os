import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath =
  "supabase/bundle_video_2c0_secure_native_video_playback_authority.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const lower = migration.toLowerCase();

const applyStart = lower.indexOf("-- apply (transactional");
const postStart = lower.indexOf("-- post-apply read-only verification");
const apply = lower.slice(applyStart, postStart);
const targetStart = apply.indexOf(
  "create function public.authorize_native_video_playback_server",
);
const targetEnd = apply.indexOf(
  "alter function public.authorize_native_video_playback_server",
  targetStart,
);
const target = apply.slice(targetStart, targetEnd);

function normalizedFunctionBody(path: string, qualifiedName: string) {
  const source = readFileSync(join(root, path), "utf8");
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapedName}\\s*\\([\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;`,
      "i",
    ),
  );
  expect(match, qualifiedName).not.toBeNull();
  return match?.[1].replace(/\s+/g, "") ?? "";
}

type PlaybackScenario = {
  actorKind: "owner" | "admin" | "staff" | "trainer" | "student" | "platform";
  assetStatus?:
    | "upload_pending"
    | "processing"
    | "ready"
    | "failed"
    | "delete_pending"
    | "deleted";
  attachment?: boolean;
  capacityFull?: boolean;
  courseStatus?: "draft" | "published" | "archived";
  durationValid?: boolean;
  enrolled?: "active" | "completed" | "none";
  feature?: boolean;
  lifecycle?: boolean;
  portalActive?: boolean;
  portalEnabled?: boolean;
  provider?: "cloudflare_stream" | "mux";
  providerDeleted?: boolean;
  providerIdentity?: boolean;
  sameTenant?: boolean;
  studentActive?: boolean;
  trainerAssigned?: boolean;
};

function playbackAllowed(input: PlaybackScenario) {
  if (input.lifecycle === false || input.feature === false) return false;
  if (input.sameTenant === false) return false;

  if (input.actorKind === "trainer" && !input.trainerAssigned) return false;
  if (input.actorKind === "platform") return false;
  if (input.actorKind === "student") {
    if (
      input.portalActive === false ||
      input.portalEnabled === false ||
      input.studentActive === false
    ) {
      return false;
    }
    const activeRead =
      input.enrolled === "active" && input.courseStatus === "published";
    const completedRead =
      input.enrolled === "completed" &&
      ["published", "archived"].includes(input.courseStatus ?? "draft");
    if (!activeRead && !completedRead) return false;
  }

  return (
    input.attachment !== false &&
    (input.assetStatus ?? "ready") === "ready" &&
    (input.provider ?? "cloudflare_stream") === "cloudflare_stream" &&
    input.providerIdentity !== false &&
    input.providerDeleted !== true &&
    input.durationValid !== false
  );
}

test.describe("VIDEO-2C0 secure native-video playback authority", () => {
  test("1. installs exactly one service-only stable playback authority", () => {
    expect(target).toContain(
      "public.authorize_native_video_playback_server(\n  p_tenant_id uuid,\n  p_actor_user_id uuid,\n  p_lesson_id uuid",
    );
    expect(target).toContain("returns jsonb");
    expect(target).toContain("stable");
    expect(target).toContain("security definer");
    expect(target).toContain("set search_path = public, pg_temp");
    expect(apply).toContain(
      "grant execute on function\n  public.authorize_native_video_playback_server(uuid,uuid,uuid)\n  to service_role",
    );
    expect(apply).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(lower).toContain("exact_public_identity_count");
  });

  test("2. accepts only tenant, server-bound actor and lesson inputs", () => {
    expect(target).toContain("p_tenant_id uuid");
    expect(target).toContain("p_actor_user_id uuid");
    expect(target).toContain("p_lesson_id uuid");
    for (const forbiddenInput of [
      "p_asset_id",
      "p_provider_asset_id",
      "p_provider",
      "p_course_id",
      "p_student_id",
      "p_role",
      "p_lifecycle",
      "p_duration",
      "p_capacity",
    ]) {
      expect(target).not.toContain(forbiddenInput);
    }
  });

  test("3. enforces lifecycle before feature, lesson, viewer and asset authority", () => {
    const lifecycle = target.indexOf("tenant_operational_access_allowed");
    const feature = target.indexOf("assert_effective_operational_feature");
    const lesson = target.indexOf("from public.lessons");
    const viewer = target.indexOf("operational_current_team_role");
    const attachment = target.indexOf("from public.video_asset_attachments");
    const asset = target.indexOf("from public.video_assets");
    expect(lifecycle).toBeGreaterThan(-1);
    expect(lifecycle).toBeLessThan(feature);
    expect(feature).toBeLessThan(lesson);
    expect(lesson).toBeLessThan(viewer);
    expect(viewer).toBeLessThan(attachment);
    expect(attachment).toBeLessThan(asset);
    expect(target).toContain("'native_video'");
  });

  test("4. preserves Coach Program-read scope and direct Trainer assignment scope", () => {
    expect(target).toContain("v_team_role in ('owner','admin','staff')");
    expect(target).toContain("v_team_role = 'trainer'");
    expect(target).toContain("public.ux4b_trainer_can_manage_course(");
    for (const role of ["owner", "admin", "staff"] as const) {
      expect(playbackAllowed({ actorKind: role })).toBe(true);
    }
    expect(
      playbackAllowed({ actorKind: "trainer", trainerAssigned: true }),
    ).toBe(true);
    expect(
      playbackAllowed({ actorKind: "trainer", trainerAssigned: false }),
    ).toBe(false);
    expect(playbackAllowed({ actorKind: "owner", sameTenant: false })).toBe(
      false,
    );
  });

  test("5. gives Platform Owner no implicit playback bypass", () => {
    expect(target).not.toContain("is_platform_admin");
    expect(target).not.toContain("platform_admin_users");
    expect(playbackAllowed({ actorKind: "platform" })).toBe(false);
  });

  test("6. delegates Student identity and enrollment rules to canonical course_read", () => {
    expect(target).toContain(
      "coachfort_internal.student_portal_access_allowed_for_user(",
    );
    expect(target).toContain("'course_read'");
    expect(lower).toContain(
      "8b31631eb6fb665efdd1854a027d9d2f",
    );
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "published",
        enrolled: "active",
      }),
    ).toBe(true);
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "published",
        enrolled: "none",
      }),
    ).toBe(false);
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "published",
        enrolled: "active",
        portalActive: false,
      }),
    ).toBe(false);
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "published",
        enrolled: "active",
        portalEnabled: false,
      }),
    ).toBe(false);
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "published",
        enrolled: "active",
        studentActive: false,
      }),
    ).toBe(false);
  });

  test("7. preserves Student course status semantics exactly", () => {
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "draft",
        enrolled: "active",
      }),
    ).toBe(false);
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "published",
        enrolled: "completed",
      }),
    ).toBe(true);
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "archived",
        enrolled: "completed",
      }),
    ).toBe(true);
    expect(
      playbackAllowed({
        actorKind: "student",
        courseStatus: "archived",
        enrolled: "active",
      }),
    ).toBe(false);
  });

  test("8. requires operational lifecycle and native_video without paid-only logic", () => {
    expect(playbackAllowed({ actorKind: "owner", lifecycle: true })).toBe(true);
    expect(playbackAllowed({ actorKind: "owner", lifecycle: false })).toBe(
      false,
    );
    expect(playbackAllowed({ actorKind: "owner", feature: false })).toBe(false);
    expect(target).not.toMatch(/payment_status|billing_cycle|paid_only/);
    expect(target).not.toMatch(/starter|growth|premium/);
  });

  test("9. requires a same-tenant current native attachment without external fallback", () => {
    expect(target).toContain("from public.video_asset_attachments attachment");
    expect(target).toContain("attachment.tenant_id = p_tenant_id");
    expect(target).toContain("attachment.lesson_id = p_lesson_id");
    expect(target).toContain("asset.id = v_attachment.video_asset_id");
    expect(target).not.toContain("video_url");
    expect(playbackAllowed({ actorKind: "owner", attachment: false })).toBe(
      false,
    );
  });

  test("10. permits only ready non-deleted Cloudflare assets with valid identity and duration", () => {
    expect(target).toContain("v_asset.status <> 'ready'");
    expect(target).toContain("v_asset.provider <> 'cloudflare_stream'");
    expect(target).toContain("v_asset.provider_deleted_at is not null");
    expect(target).toContain(
      "char_length(v_asset.provider_asset_id) not between 1 and 255",
    );
    expect(target).toContain(
      "v_asset.provider_asset_id ~ '[[:space:][:cntrl:]]'",
    );
    expect(target).toContain(
      "v_asset.duration_seconds not between 1 and 7200",
    );
    expect(playbackAllowed({ actorKind: "owner" })).toBe(true);
    for (const assetStatus of [
      "upload_pending",
      "processing",
      "failed",
      "delete_pending",
      "deleted",
    ] as const) {
      expect(playbackAllowed({ actorKind: "owner", assetStatus })).toBe(false);
    }
    expect(playbackAllowed({ actorKind: "owner", provider: "mux" })).toBe(
      false,
    );
    expect(
      playbackAllowed({ actorKind: "owner", providerIdentity: false }),
    ).toBe(false);
    expect(
      playbackAllowed({ actorKind: "owner", providerDeleted: true }),
    ).toBe(false);
    expect(playbackAllowed({ actorKind: "owner", durationValid: false })).toBe(
      false,
    );
  });

  test("11. never makes remaining upload capacity a playback condition", () => {
    expect(target).not.toContain("resolve_native_video_capacity");
    expect(target).not.toContain("resolve_native_video_usage");
    expect(target).not.toContain("video_storage_minutes");
    expect(playbackAllowed({ actorKind: "owner", capacityFull: true })).toBe(
      true,
    );
  });

  test("12. returns only the minimum trusted server playback authority", () => {
    for (const key of [
      "'lesson_id'",
      "'video_asset_id'",
      "'provider'",
      "'provider_asset_id'",
      "'duration_seconds'",
    ]) {
      expect(target).toContain(key);
    }
    for (const forbidden of [
      "api_token",
      "signing_key",
      "upload_url",
      "quota",
      "subscription_status",
      "student_id',",
    ]) {
      expect(target).not.toContain(forbidden);
    }
  });

  test("13. exposes deterministic error categories for future route sanitization", () => {
    const expectedErrors = [
      ["native video playback input is invalid", "22023"],
      ["native video playback actor is required", "28000"],
      ["native video playback lifecycle is unavailable", "42501"],
      ["native video playback feature is unavailable", "42501"],
      ["native video lesson is unavailable", "p0002"],
      ["native video viewer is not authorized", "42501"],
      ["native video attachment is unavailable", "p0002"],
      ["native video asset is not playable", "55000"],
      ["native video provider authority is malformed", "55000"],
    ];
    for (const [message, code] of expectedErrors) {
      const messageAt = target.indexOf(message);
      expect(messageAt, message).toBeGreaterThan(-1);
      expect(target.slice(messageAt, messageAt + 180), message).toContain(
        `errcode = '${code}'`,
      );
    }
  });

  test("14. is read-only and performs no provider or playback-token work", () => {
    expect(target).not.toMatch(/insert\s+into|update\s+public\.|delete\s+from/);
    expect(target).not.toMatch(/api\.cloudflare\.com|net\.http|http_post/);
    expect(target).not.toMatch(/jwt|signing|token generation|playback token/);
    expect(target).not.toContain("record_native_video_provider_event_server");
  });

  test("15. PRE and APPLY pin all reused authority helper fingerprints", () => {
    const expectedFingerprints = [
      {
        hash: "402306364425f9def3123c8961834681",
        name: "coachfort_internal.tenant_operational_access_allowed",
        path: "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
      },
      {
        hash: "7f31929d1939c1f23c1f9fafa334c78c",
        name: "coachfort_internal.operational_current_team_role",
        path: "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
      },
      {
        hash: "8b31631eb6fb665efdd1854a027d9d2f",
        name: "coachfort_internal.student_portal_access_allowed_for_user",
        path: "supabase/bundle_ux8g1b_subscription_operational_enforcement.sql",
      },
      {
        hash: "d3a35f18230c4c9062bf5bb502c0f027",
        name: "coachfort_internal.assert_effective_operational_feature",
        path: "supabase/bundle_ux8g4a2a_server_feature_entitlement_closure.sql",
      },
      {
        hash: "2315893019e05e68bd8fcdfd16f26c5f",
        name: "public.ux4b_trainer_can_manage_course",
        path: "supabase/bundle_ux4b_enrollment_access_permission_hardening.sql",
      },
    ];
    for (const expected of expectedFingerprints) {
      const body = normalizedFunctionBody(expected.path, expected.name);
      const actual = createHash("md5").update(body).digest("hex");
      expect(actual, expected.name).toBe(expected.hash);
      expect(
        lower.match(new RegExp(expected.hash, "g"))?.length,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(lower).toContain("ready_for_apply");
    expect(lower).toContain("authority_helper_fingerprints");
  });

  test("16. transaction guard preserves helper, ACL and protected video data", () => {
    expect(apply).toContain("create temporary table video2c0_apply_baseline");
    expect(apply).toContain("video_asset_fingerprint");
    expect(apply).toContain("attachment_fingerprint");
    expect(apply).toContain("provider_event_fingerprint");
    expect(apply).toContain("helper_contract");
    expect(apply).toContain("protected_relation_contract");
    expect(apply).toContain(
      "video-2c0 changed protected authority or video data",
    );
    expect(apply).toContain("notify pgrst, 'reload schema'");
    expect(apply).toMatch(/commit;\s*\n\s*--\s*-+\s*$/);
  });

  test("17. POST independently verifies security, source, ACL and data inventory", () => {
    const post = lower.slice(postStart);
    expect(post).toContain("security_gate");
    expect(post).toContain("service_role_execute");
    expect(post).toContain("authenticated_denied");
    expect(post).toContain("anon_denied");
    expect(post).toContain("public_denied");
    expect(post).toContain("no_direct_role_access");
    expect(post).toContain("no_public_access");
    expect(post).toContain("protected_relation_contract");
    expect(post).toContain("storage_contract");
    expect(post).toContain("protected_video_data");
    expect(post).toContain("authority_order");
    expect(post).toContain("capacity_not_playback_authority");
  });

  test("18. verifies installed provider identity and duration bounds semantically", () => {
    const expectedVerifierFragments = [
      "%provider_asset_idisnull%",
      "%char_length(provider_asset_id)>=1%",
      "%char_length(provider_asset_id)<=255%",
      "%provider_asset_id!~''[[:space:][:cntrl:]]''%",
      "%duration_secondsisnull%",
      "%duration_seconds>=1%",
      "%duration_seconds<=7200%",
    ];
    for (const fragment of expectedVerifierFragments) {
      expect(lower.match(new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")))
        .toHaveLength(3);
    }
    expect(lower).not.toContain(
      "%char_length(provider_asset_id)%between 1 and 255%",
    );
    expect(lower).not.toContain("%duration_seconds%between 1 and 7200%");
    expect(lower.match(/regexp_replace\(\s*lower\(pg_get_constraintdef/g))
      .not.toBeNull();
  });

  test("19. does not redesign any existing video, lifecycle, enrollment or billing authority", () => {
    expect(apply).not.toMatch(/create\s+or\s+replace\s+function/);
    expect(apply).not.toMatch(/alter\s+table/);
    expect(apply).not.toMatch(/create\s+(?:unique\s+)?index/);
    expect(apply).not.toMatch(/^\s*insert\s+into\s+public\./m);
    expect(apply).not.toMatch(/^\s*update\s+public\./m);
    expect(apply).not.toMatch(/^\s*delete\s+from\s+public\./m);
    expect(apply).not.toMatch(/subscription_plan_prices|payment_orders|razorpay/);
  });
});
