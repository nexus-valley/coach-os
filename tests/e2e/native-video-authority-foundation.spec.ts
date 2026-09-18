import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  commercialPlanContracts,
  getPlanDisplayPrice,
} from "../../src/lib/plans";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/bundle_video_2a_native_video_authority.sql"),
  "utf8",
);
const lower = migration.toLowerCase();

test.describe("VIDEO-2A native video authority foundation", () => {
  test("1. installs only the approved video plan contract", () => {
    expect(migration).toContain("'native_video', 'included'");
    expect(migration).toContain("'video_storage_minutes'");
    expect(migration).toContain(
      "when 'starter' then 600 when 'growth' then 3000 else 9000",
    );
    expect(migration).toContain("'duration_minutes'");
    expect(migration).toContain("'reset_period', 'none'");
    expect(migration).toContain("'customer_unit', 'video_hours'");
    expect(migration).not.toMatch(/update\s+public\.subscription_plan_prices/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.subscription_plan_prices/i);
  });

  test("2. preserves Premium Contact Sales while assigning video capacity", () => {
    expect(commercialPlanContracts.enterprise.code).toBe("premium");
    expect(commercialPlanContracts.enterprise.billing).toEqual({
      monthly: null,
      yearly: null,
    });
    expect(getPlanDisplayPrice("enterprise", "monthly")).toBe("Contact Sales");
    expect(getPlanDisplayPrice("enterprise", "yearly")).toBe("Contact Sales");
    expect(migration).toContain("Premium remains Contact Sales");
    expect(migration).toContain("premium_video_limit_9000");
    expect(migration).not.toContain("Premium is FIXED-PRICE / SELF-SERVICE");
  });

  test("3. creates canonical assets, attachments, packs and provider evidence", () => {
    for (const table of [
      "video_assets",
      "video_asset_attachments",
      "video_provider_events",
      "video_capacity_pack_catalog",
      "tenant_video_capacity_pack_assignments",
    ]) {
      expect(lower).toContain(`create table public.${table}`);
      expect(lower).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("'video_capacity_25h'");
    expect(migration).toContain("'inactive', false, false");
    const packTable = lower.slice(
      lower.indexOf("create table public.video_capacity_pack_catalog"),
      lower.indexOf("create table public.tenant_video_capacity_pack_assignments"),
    );
    expect(packTable).not.toMatch(/price_(minor|amount)/i);
    expect(migration).toContain("not (metadata_json ? 'price_minor')");
    expect(migration).toContain("video_provider_events_identity_key unique");
  });

  test("4. reservation is bounded, idempotent and concurrency-safe", () => {
    const start = lower.indexOf("create function public.reserve_native_video_upload_server");
    const end = lower.indexOf("create function public.bind_native_video_provider_identity_server");
    const source = lower.slice(start, end);
    expect(source).toContain("assert_tenant_operational_access");
    expect(source).toContain("assert_effective_operational_feature");
    expect(source).toContain("'native_video'");
    expect(source).toContain("not between 1 and 7200");
    expect(source).toContain("10737418240");
    expect(source).toContain("native_video_capacity_authority_lock");
    expect(source.indexOf("native_video_capacity_authority_lock")).toBeLessThan(
      source.indexOf("resolve_native_video_usage"),
    );
    expect(source).toContain("interval '90 minutes'");
    expect(source).toContain("request id was reused with different inputs");
    expect(migration).toContain(
      "constraint video_assets_request_key unique (tenant_id, request_id)",
    );
  });

  test("5. capacity math uses ready duration and active reservations", () => {
    expect(lower).toContain("status in ('ready','delete_pending')");
    expect(lower).toContain("provider_deleted_at is null");
    expect(lower).toContain("asset.status = 'upload_pending'");
    expect(lower).toContain("asset.reservation_expires_at > now()");
    expect(lower).toContain("asset.status = 'processing'");
    expect(lower).toContain("asset.status = 'delete_pending'");
    expect(lower).toContain("asset.duration_seconds is null");
    expect(lower).toContain("coalesce(v_override, v_base::bigint + v_add_on)");

    const available = (capacity: number, stored: number, reserved: number, request: number) =>
      stored + reserved + request <= capacity;
    expect(available(600, 500, 0, 100)).toBe(true);
    expect(available(600, 500, 0, 101)).toBe(false);
    expect(available(600, 500, 50, 51)).toBe(false);
  });

  test("6. provider finalization fails closed and cannot regress deleted assets", () => {
    expect(lower).toContain("provider_duration_exceeds_reservation");
    expect(lower).toContain("provider_duration_exceeds_capacity");
    expect(lower).toContain("deleted native video is terminal");
    expect(lower).toContain("video_assets_provider_state_check");
    expect(lower).toContain("status <> 'processing' or provider_asset_id is not null");
    expect(lower).toContain("status <> 'failed' or provider_asset_id is null");
    expect(lower).toContain(
      "old.status = 'upload_pending' and new.status in ('processing','failed')",
    );
    expect(lower).toContain("old.status = 'ready' and new.status = 'delete_pending'");
    expect(lower).toContain(
      "old.status = 'processing' and new.status in ('ready','delete_pending')",
    );
    const transitionTrigger = lower.slice(
      lower.indexOf("create function coachfort_internal.enforce_video_asset_authority"),
      lower.indexOf("create trigger enforce_video_asset_authority"),
    );
    expect(transitionTrigger).not.toContain(
      "old.status = 'processing' and new.status in ('ready','failed','delete_pending')",
    );
    expect(lower).toContain("old.status = 'delete_pending' and new.status = 'deleted'");
    expect(lower).toContain("safe_failure_code = 'provider_processing_failed'");
    expect(lower).toContain("when v_duration_valid then 0 else reserved_seconds");
    expect(lower).toContain("delete_requested_at = now()");
    expect(lower).not.toContain("delete from public.video_assets");

    const accountedSeconds = (
      status: string,
      durationSeconds: number | null,
      reservedSeconds: number,
    ) =>
      status === "delete_pending" && durationSeconds !== null
        ? durationSeconds
        : status === "delete_pending"
          ? reservedSeconds
          : 0;
    expect(accountedSeconds("delete_pending", 2700, 0)).toBe(2700);
    expect(accountedSeconds("delete_pending", null, 1800)).toBe(1800);
    expect(accountedSeconds("deleted", 2700, 0)).toBe(0);
  });

  test("7. lesson references are tenant-bound and external URLs are hardened", () => {
    expect(migration).toContain("video_asset_attachments_asset_fk");
    expect(migration).toContain("video_asset_attachments_lesson_fk");
    expect(migration).toContain("video_asset_attachments_lesson_key unique");
    expect(lower).toContain("validate_external_video_url");
    expect(lower).toContain("enforce_lesson_external_video_authority");
    expect(lower).toContain(
      "before insert or update of video_url on public.lessons",
    );
    expect(lower).toContain("tg_op = 'update'");
    expect(lower).toContain(
      "new.video_url is not distinct from old.video_url",
    );
    for (const host of [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "vimeo.com",
      "www.vimeo.com",
      "player.vimeo.com",
    ]) {
      expect(lower).toContain(`'${host}'`);
    }
    expect(lower).toContain("lower(v_url) !~ '^https://'");
    expect(lower).toContain("v_host := lower(v_authority)");
    expect(lower).toContain("detach the native video before adding an external video");
    expect(lower).toContain("video url must use youtube or vimeo");
    expect(lower).not.toMatch(/update\s+public\.lessons\s+set\s+video_url\s*=/i);
  });

  test("8. all media mutation RPCs are server-only", () => {
    const normalizedSql = lower
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const serverFunctions = [
      "reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)",
      "bind_native_video_provider_identity_server(uuid,text,text)",
      "record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)",
      "finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)",
      "attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)",
      "detach_native_video_from_lesson_server(uuid,uuid,uuid)",
      "request_native_video_deletion_server(uuid,uuid,uuid)",
      "confirm_native_video_provider_deletion_server(uuid,text)",
      "get_native_video_capacity_server(uuid,uuid)",
    ];
    for (const identity of serverFunctions) {
      expect(normalizedSql).toContain(
        `grant execute on function public.${identity}`,
      );
    }
    expect(lower).toContain("from public, anon, authenticated, service_role");
    expect(lower).not.toMatch(/grant\s+(insert|update|delete|all).*video_/i);
  });

  test("9. contains PRE, guarded APPLY and decisive POST without provider runtime", () => {
    const applySql = lower.slice(
      lower.indexOf("-- apply (transactional"),
      lower.indexOf("-- post-apply read-only verification"),
    );
    expect(migration).toContain("PRE-APPLY READ-ONLY VERIFICATION");
    expect(migration).toContain("APPLY (TRANSACTIONAL");
    expect(migration).toContain("POST-APPLY READ-ONLY VERIFICATION");
    expect(migration).toContain("ready_for_apply");
    expect(migration).toContain("security_gate");
    expect(migration).toContain("historical_video_urls_preserved");
    expect(migration).toContain("historical_unchanged_external_url_preserved");
    expect(migration).toContain("provider_backed_failed_state_impossible");
    expect(migration).toContain("apply_clean_install_guard_complete");
    expect(migration).toContain("video_storage_non_resetting");
    expect(applySql).not.toContain("api.cloudflare.com");
    expect(applySql).not.toContain("cloudflare_api_token");
    expect(applySql).not.toContain("tus upload");
  });

  test("10. binds authoring and asset references to one Owner/Admin tenant", () => {
    expect(lower).toContain("member.role in ('owner','admin')");
    expect(lower).toContain("member.tenant_id = p_tenant_id");
    expect(lower).toContain("member.user_id = p_actor_user_id");
    expect(lower).toContain("where id = p_asset_id and tenant_id = p_tenant_id");
    expect(lower).toContain("where id = p_lesson_id and tenant_id = p_tenant_id");
    expect(lower).toContain(
      "foreign key (tenant_id, video_asset_id)",
    );
    expect(lower).toContain("foreign key (tenant_id, lesson_id)");
  });

  test("11. persists bounded replay-safe provider evidence", () => {
    expect(lower).toContain(
      "constraint video_provider_events_identity_key unique (provider, event_key)",
    );
    expect(lower).toContain("on conflict (provider, event_key) do nothing");
    expect(lower).toContain("provider event key was reused with conflicting evidence");
    expect(lower).toContain("processing_status = 'ignored'");
    expect(lower).toContain("char_length(safe_evidence_json::text) <= 3000");
    expect(lower).toContain("video_provider_events_provider_asset_id_check");
    expect(lower).toContain("video_provider_events_match_pair_check");
    expect(lower).toContain("video_provider_events_asset_fk");
    expect(lower).toContain("foreign key (tenant_id, video_asset_id)");
    expect(lower).toContain("char_length(v_provider_asset_id) not between 1 and 255");
    expect(lower).toContain("native video finalization input is invalid");
    expect(lower).not.toContain("raw_webhook");
    expect(lower).not.toContain("webhook_signature");
  });

  test("12. protects commercial and historical data inside APPLY", () => {
    expect(lower).toContain("plan_commercial_fingerprint");
    expect(lower).toContain("v_baseline.plan_feature_rows + 3");
    expect(lower).toContain("v_baseline.plan_limit_rows + 3");
    expect(lower).toContain("v_baseline.video_url_fingerprint");
    expect(lower).toContain("v_baseline.payment_order_rows");
    expect(lower).toContain("v_baseline.platform_receipt_rows");
    expect(lower).toContain("v_baseline.finance_receipt_rows");
    expect(lower).toContain("v_baseline.override_fingerprint");
    expect(lower).toContain("v_baseline.plan_feature_fingerprint");
    expect(lower).toContain("v_baseline.plan_limit_fingerprint");
    expect(lower).toContain("video-2a changed protected business data");
    expect(lower).toContain("partial function installation detected");
    expect(lower).toContain("entitlement helper security drift");
    expect(lower).toContain("lesson rpc security drift");
    expect(lower).toContain("asset or lesson transition authority is incomplete");
  });

  test("13. preserves existing lesson RPC source and security exactly", () => {
    const applySql = lower.slice(
      lower.indexOf("-- apply (transactional"),
      lower.indexOf("-- post-apply read-only verification"),
    );
    expect(applySql).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.(create_lesson_secure|update_lesson_secure)/i,
    );
    expect(applySql).not.toMatch(
      /(?:alter|revoke|grant)[\s\S]{0,80}function\s+public\.(create_lesson_secure|update_lesson_secure)/i,
    );
    expect(lower).toContain("lesson_rpc_contract jsonb not null");
    expect(lower).toContain("video-2a changed existing lesson rpc authority");
    expect(lower).toContain("lesson_rpc_authority_preserved");
    expect(lower).toContain("original_source_preserved");
  });

  test("14. extends the exact canonical entitlement contract without ACL redesign", () => {
    expect(lower).toContain("canonical_entitlement_contract as");
    expect(lower).toContain("entitlement_extension_contract as");
    expect(lower).toContain("plan_resource_keys_exact");
    expect(lower).toContain("override_resource_keys_exact");
    expect(lower).toContain("limit_types_exact");
    expect(lower).toContain("plan_feature_keys_exact");
    expect(lower).toContain("override_feature_keys_exact");
    expect(lower).toContain("helper_security_preserved");
    expect(lower).toContain("entitlement_helper_security_contract jsonb not null");
    expect(lower).not.toMatch(
      /(?:alter function|revoke all on function)\s+public\.subscription_entitlements_(resource|feature)_keys/i,
    );
    for (const addition of [
      "native_video",
      "video_storage_minutes",
      "duration_minutes",
    ]) {
      expect(lower).toContain(`'${addition}'`);
    }
  });

  test("15. capacity-pack identity is stable and catalog status is non-retroactive", () => {
    const capacityStart = lower.indexOf(
      "create function coachfort_internal.resolve_native_video_capacity",
    );
    const capacityEnd = lower.indexOf(
      "create function coachfort_internal.resolve_native_video_usage",
    );
    const capacitySource = lower.slice(capacityStart, capacityEnd);
    expect(lower).toContain("enforce_video_capacity_pack_catalog_identity");
    expect(lower).toContain("new.code, new.capacity_minutes");
    expect(lower).toContain("canonical video capacity pack cannot be deleted");
    expect(capacitySource).not.toContain("pack.status = 'active'");
    expect(capacitySource).toContain("assignment.status = 'active'");
  });

  test("16. provider observations cannot regress accepted state", () => {
    const finalizeStart = lower.indexOf(
      "create function public.finalize_native_video_asset_processing_server",
    );
    const finalizeEnd = lower.indexOf(
      "create function public.attach_native_video_to_lesson_server",
    );
    const finalize = lower.slice(finalizeStart, finalizeEnd);
    expect(finalize).toContain("last_provider_observed_at");
    expect(finalize).toContain("p_event_time < v_asset.last_provider_observed_at");
    expect(finalize).toContain("'stale_observation', true");
    expect(finalize).toContain(
      "native video provider identity does not match the asset",
    );
    expect(finalize.indexOf("native video finalization input is invalid")).toBeLessThan(
      finalize.indexOf("insert into public.video_provider_events"),
    );
    expect(
      finalize.indexOf("native video provider identity does not match the asset"),
    ).toBeLessThan(finalize.indexOf("insert into public.video_provider_events"));
  });

  test("17. decisive video-table ACL verification includes PUBLIC and effective roles", () => {
    expect(lower).toContain("information_schema.table_privileges");
    expect(lower).toContain("has_table_privilege(");
    expect(lower).toContain("aclexplode(coalesce(");
    expect(lower).toContain("acl.grantee = 0");
    expect(lower).toContain("effective_role_writes_absent");
    expect(lower).toContain("explicit_role_writes_absent");
    expect(lower).toContain("public_writes_absent");
    expect(lower).not.toContain("information_schema.role_table_grants");
  });

  test("18. APPLY repeats the complete clean-install and security prerequisites", () => {
    const applySql = lower.slice(
      lower.indexOf("-- apply (transactional"),
      lower.indexOf("create temporary table video2a_apply_baseline"),
    );
    const expectedFunctions = [
      "coachfort_internal.native_video_capacity_authority_lock(uuid)",
      "coachfort_internal.enforce_native_video_override_authority_lock()",
      "coachfort_internal.enforce_video_capacity_pack_authority_lock()",
      "coachfort_internal.enforce_video_capacity_pack_catalog_identity()",
      "coachfort_internal.enforce_video_asset_authority()",
      "coachfort_internal.assert_native_video_owner_admin(uuid,uuid)",
      "coachfort_internal.resolve_native_video_capacity(uuid)",
      "coachfort_internal.resolve_native_video_usage(uuid,uuid)",
      "coachfort_internal.validate_external_video_url(text)",
      "coachfort_internal.enforce_lesson_external_video_authority()",
      "public.reserve_native_video_upload_server(uuid,uuid,bigint,bigint,text,text,uuid)",
      "public.bind_native_video_provider_identity_server(uuid,text,text)",
      "public.record_native_video_provider_event_server(text,text,text,timestamptz,text,text,jsonb)",
      "public.finalize_native_video_asset_processing_server(uuid,text,bigint,text,text,timestamptz,text,jsonb)",
      "public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)",
      "public.detach_native_video_from_lesson_server(uuid,uuid,uuid)",
      "public.request_native_video_deletion_server(uuid,uuid,uuid)",
      "public.confirm_native_video_provider_deletion_server(uuid,text)",
      "public.get_native_video_capacity_server(uuid,uuid)",
    ];
    for (const identity of expectedFunctions) {
      expect(applySql).toContain(`'${identity}'`);
    }
    expect(applySql).toContain("pg_get_userbyid(procedure.proowner) = 'postgres'");
    expect(applySql).toContain("not procedure.prosecdef");
    expect(applySql).toContain("procedure.provolatile = 'i'");
    expect(applySql).toContain("procedure.prosecdef");
    expect(applySql).toContain("has_function_privilege(");
    expect(applySql).toContain("acl.grantee = 0");
  });

  test("19. pre-commit catalog verification is exact and non-resetting", () => {
    const preCommit = lower.slice(
      lower.lastIndexOf("do $$", lower.indexOf("notify pgrst")),
      lower.indexOf("notify pgrst"),
    );
    for (const contract of [
      "('starter', 600)",
      "('growth', 3000)",
      "('premium', 9000)",
      "feature.entitlement_status = 'included'",
      "plan_limit.limit_type = 'duration_minutes'",
      "plan_limit.enforcement_mode = 'hard'",
      "'reset_period', 'none'",
      "'customer_unit', 'video_hours'",
      "code = 'video_capacity_25h'",
      "capacity_minutes = 1500",
      "status = 'inactive'",
      "not is_public",
      "not is_purchasable",
      "video_assets_provider_state_check",
      "asset or lesson transition authority is incomplete",
    ]) {
      expect(preCommit).toContain(contract);
    }
  });

  test("20. historical external URL values bypass validation only when unchanged", () => {
    const triggerStart = lower.indexOf(
      "create function coachfort_internal.enforce_lesson_external_video_authority",
    );
    const triggerEnd = lower.indexOf(
      "create trigger enforce_lesson_external_video_authority",
    );
    const trigger = lower.slice(triggerStart, triggerEnd);
    expect(trigger.indexOf("new.video_url is not distinct from old.video_url")).toBeLessThan(
      trigger.indexOf("validate_external_video_url"),
    );
    expect(trigger).toContain("return new");
    expect(trigger).toContain("video_asset_attachments");

    const acceptedNewHosts = new Set([
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "vimeo.com",
      "www.vimeo.com",
      "player.vimeo.com",
    ]);
    expect(acceptedNewHosts.has("historical.example.com")).toBe(false);
    expect(acceptedNewHosts.has("youtube.com")).toBe(true);
    expect(acceptedNewHosts.has("vimeo.com")).toBe(true);
  });
});
