import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath = join(
  root,
  "supabase/bundle_video_2b0_provider_upload_authority.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const lower = migration.toLowerCase();
const pre = lower.slice(0, lower.indexOf("-- apply (transactional"));
const apply = lower.slice(
  lower.indexOf("-- apply (transactional"),
  lower.indexOf("-- post-apply read-only verification"),
);
const post = lower.slice(lower.indexOf("-- post-apply read-only verification"));

function functionSource(identity: string, nextIdentity: string) {
  const start = lower.indexOf(`create function public.${identity}`);
  const end = lower.indexOf(nextIdentity, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return lower.slice(start, end);
}

test.describe("VIDEO-2B0 provider upload authority", () => {
  test("1. is a new guarded migration and leaves VIDEO-2A untouched", () => {
    expect(migration).toContain("PRE-APPLY READ-ONLY VERIFICATION");
    expect(migration).toContain("APPLY (TRANSACTIONAL");
    expect(migration).toContain("POST-APPLY READ-ONLY VERIFICATION");
    expect(migration).toContain("ready_for_apply");
    expect(migration).toContain("security_gate");
    expect(apply).not.toContain("create table public.video_assets");
    expect(apply).not.toContain("update public.subscription_plan_prices");
    expect(apply).not.toContain("update public.subscription_plans");
  });

  test("2. keeps the temporary upload capability private", () => {
    expect(lower).toContain("create table coachfort_internal.video_upload_sessions");
    expect(lower).toContain("video_asset_id uuid primary key");
    expect(lower).toContain("upload_url text");
    expect(lower).toContain("alter table coachfort_internal.video_upload_sessions enable row level security");
    expect(lower).toContain(
      "revoke all privileges on table coachfort_internal.video_upload_sessions",
    );
    expect(lower).not.toMatch(/alter\s+table\s+public\.video_assets[\s\S]{0,200}add\s+column\s+upload_url/);
    expect(lower).not.toMatch(/alter\s+table\s+public\.video_provider_events[\s\S]{0,200}add\s+column\s+upload_url/);
    expect(lower).toContain(
      "video_provider_events_safe_evidence_capability_check",
    );
  });

  test("3. models provisioning, persisted, ambiguous and closed sessions", () => {
    for (const state of [
      "provisioning",
      "provisioned",
      "reconcile_required",
      "closed",
    ]) {
      expect(lower).toContain(`'${state}'`);
    }
    expect(lower).toContain("video_upload_sessions_claim_pair_check");
    expect(lower).toContain("video_upload_sessions_provisioned_state_check");
    expect(lower).toContain("provider_creation_attempted boolean not null default false");
    expect(lower).toContain("video_upload_sessions_provider_attempt_check");
    expect(lower).toContain("video_upload_sessions_provider_identity_unique_idx");
  });

  test("4. grants only one provider-create claim and never blindly reclaims ambiguity", () => {
    const source = functionSource(
      "claim_native_video_upload_provisioning_server",
      "create function public.complete_native_video_upload_provisioning_server",
    );
    expect(source).toContain("for update");
    expect(source).toContain("'action', 'create_provider_upload'");
    expect(source).toContain("'action', 'wait'");
    expect(source).toContain("'action', 'replay_existing'");
    expect(source).toContain("'action', 'reconcile_required'");
    expect(source).toContain("interval '3 minutes'");
    expect(source).toContain("provider_creation_outcome_unknown");
    expect(source.match(/'action', 'create_provider_upload'/g)).toHaveLength(1);
  });

  test("5. persists a provider session without advancing asset processing", () => {
    const complete = functionSource(
      "complete_native_video_upload_provisioning_server",
      "create function public.mark_native_video_upload_provisioning_ambiguous_server",
    );
    expect(complete).toContain(
      "p_provider_upload_expires_at > v_asset.reservation_expires_at",
    );
    expect(complete).toContain("state = 'provisioned'");
    expect(complete).toContain("upload_url = v_upload_url");
    expect(complete).toContain("bind_native_video_provider_identity_server");
    expect(complete).not.toContain("status = 'processing'");

    const bindStart = lower.indexOf(
      "create or replace function public.bind_native_video_provider_identity_server",
    );
    const bindEnd = lower.indexOf(
      "create function public.claim_native_video_upload_provisioning_server",
      bindStart,
    );
    const bind = lower.slice(bindStart, bindEnd);
    expect(bind).toContain("provider session authority is unavailable");
    expect(bind).toContain("set provider_asset_id = v_provider_asset_id");
    expect(bind).not.toContain("status = 'processing'");
  });

  test("6. supports definite failure and expired unbound release only without provider identity", () => {
    const failure = functionSource(
      "fail_unbound_native_video_upload_server",
      "create function public.expire_unbound_native_video_upload_server",
    );
    expect(failure).toContain("v_asset.provider_asset_id is not null");
    expect(failure).toContain("status = 'failed'");
    expect(failure).toContain("reserved_seconds = 0");

    const expiry = functionSource(
      "expire_unbound_native_video_upload_server",
      "create function public.recover_native_video_provider_identity_server",
    );
    expect(expiry).toContain("v_asset.provider_asset_id is not null");
    expect(expiry).toContain("v_asset.reservation_expires_at > now()");
    expect(expiry).toContain("v_session.provider_creation_attempted");
    expect(expiry).toContain("p_provider_match_count <> 0");
    expect(expiry).toContain("reconciliation_claim_token");
    expect(expiry).toContain("reserved_seconds = 0");
  });

  test("7. makes ambiguous outcomes durable and recoverable by asset correlation", () => {
    const ambiguous = functionSource(
      "mark_native_video_upload_provisioning_ambiguous_server",
      "create function public.fail_unbound_native_video_upload_server",
    );
    expect(ambiguous).toContain("state = 'reconcile_required'");
    expect(ambiguous).not.toContain("reserved_seconds = 0");

    const recovery = functionSource(
      "recover_native_video_provider_identity_server",
      "create or replace function public.finalize_native_video_asset_processing_server",
    );
    expect(recovery).toContain("reconciliation_claim_token");
    expect(recovery).toContain("p_provider_match_count is distinct from 1");
    expect(recovery).toContain("provider_asset_id is not null");
    expect(recovery).toContain("bind_native_video_provider_identity_server");
    expect(recovery).toContain("safe_failure_code = 'provider_identity_recovered'");
    expect(recovery).not.toContain("reconciliation_claim_token = null");
    expect(lower).toContain("'creator_correlation', v_asset.id::text");
  });

  test("8. maps only trusted provider observations into lifecycle transitions", () => {
    const observation = functionSource(
      "observe_native_video_provider_state_server",
      "create function public.claim_native_video_reconciliation_batch_server",
    );
    for (const state of [
      "pendingupload",
      "downloading",
      "queued",
      "inprogress",
      "ready",
      "error",
      "live-inprogress",
    ]) {
      expect(observation).toContain(`'${state}'`);
    }
    expect(observation).toContain("v_state in ('downloading','queued','inprogress')");
    expect(observation).toContain(
      "status = 'processing', last_provider_observed_at = p_event_time",
    );
    expect(observation).toContain("v_state = 'pendingupload'");
    expect(observation).toContain("processing_status = 'ignored'");
    expect(observation).toContain("p_event_time < v_asset.last_provider_observed_at");
    expect(observation).toContain("for update");
    expect(observation).toContain("v_session.provider_asset_id is distinct from");
  });

  test("9. safely finalizes ready or error as the first provider observation", () => {
    const start = lower.indexOf(
      "create or replace function public.finalize_native_video_asset_processing_server",
    );
    const end = lower.indexOf(
      "create function public.observe_native_video_provider_state_server",
      start,
    );
    const finalize = lower.slice(start, end);
    expect(finalize).toContain("if v_asset.status = 'upload_pending'");
    expect(finalize).toContain("set status = 'processing'");
    expect(finalize).toContain("status = 'ready'");
    expect(finalize).toContain("status = 'delete_pending'");
    expect(finalize).toContain("provider_duration_exceeds_reservation");
    expect(finalize).toContain("provider_duration_exceeds_capacity");
  });

  test("10. atomically handles pending upload expiry and retains quota until deletion", () => {
    const observation = functionSource(
      "observe_native_video_provider_state_server",
      "create function public.claim_native_video_reconciliation_batch_server",
    );
    expect(observation).toContain("v_asset.reservation_expires_at <= now()");
    expect(observation).toContain(
      "v_session.provider_upload_expires_at <= now()",
    );
    expect(observation).toContain("status = 'delete_pending'");
    expect(observation).toContain("provider_upload_expired");
    expect(observation).not.toContain("reserved_seconds = 0");
    expect(observation).not.toContain("interval '15 minutes'");
    expect(lower).not.toContain(
      "create function public.request_expired_native_video_provider_cleanup_server",
    );
    expect(lower).toContain("or asset.provider_asset_id is not null");
    expect(lower).toContain(
      "old.status = 'upload_pending'\n      and new.status in ('processing','failed','delete_pending')",
    );
    expect(lower).toContain("confirm_native_video_provider_deletion_server(uuid,text)");
  });

  test("11. claims bounded reconciliation work with finite skip-locked leases", () => {
    const reconcile = functionSource(
      "claim_native_video_reconciliation_batch_server",
      "create function public.release_native_video_reconciliation_claim_server",
    );
    expect(reconcile).toContain("p_limit not between 1 and 50");
    expect(reconcile).toContain("p_lease_seconds not between 30 and 900");
    expect(reconcile).toContain("limit p_limit");
    expect(reconcile).toContain("for update of asset skip locked");
    expect(reconcile).toContain("for update of session skip locked");
    expect(reconcile).toContain("provider_creation_outcome_unknown");
    expect(reconcile).toContain("resolve_unbound_reservation");
    expect(reconcile).toContain("recover_ambiguous_provider");
    expect(reconcile).toContain("get_provider_state");
    expect(reconcile).toContain("delete_provider");
    const outputProjection = reconcile.slice(
      reconcile.indexOf("select coalesce(jsonb_agg(jsonb_build_object("),
    );
    expect(outputProjection).not.toContain("'upload_url'");
  });

  test("12. gives service_role RPC access without private table access", () => {
    const identities = [
      "claim_native_video_upload_provisioning_server(uuid)",
      "complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)",
      "mark_native_video_upload_provisioning_ambiguous_server(uuid,uuid,text)",
      "fail_unbound_native_video_upload_server(uuid,uuid,text)",
      "expire_unbound_native_video_upload_server(uuid,uuid,integer)",
      "recover_native_video_provider_identity_server(uuid,uuid,text,integer)",
      "observe_native_video_provider_state_server(uuid,text,text,bigint,text,timestamptz,text,jsonb)",
      "claim_native_video_reconciliation_batch_server(integer,integer)",
      "release_native_video_reconciliation_claim_server(uuid,uuid,text)",
    ];
    for (const identity of identities) {
      expect(lower).toContain(`'public.${identity}'::regprocedure`);
    }
    expect(lower).toContain("grant execute on function %s to service_role");
    expect(lower).toContain(
      "revoke all privileges on table coachfort_internal.video_upload_sessions",
    );
  });

  test("13. contains no provider runtime or secret material", () => {
    expect(apply).not.toContain("api.cloudflare.com");
    expect(apply).not.toContain("cloudflare_stream_api_token");
    expect(apply).not.toContain("cloudflare_stream_webhook_secret");
    expect(apply).not.toContain("cloudflare_account_id");
    expect(apply).not.toMatch(/fetch\s*\(|http_post|net\.http/i);
  });

  test("14. verifies zero fabricated rows and protected commercial data", () => {
    expect(lower).toContain("zero_video_rows_fabricated");
    expect(lower).toContain("zero_upload_sessions_fabricated");
    expect(lower).toContain("protected_function_contract jsonb not null");
    expect(lower).toContain("plan_fingerprint");
    expect(lower).toContain("lesson_fingerprint");
    expect(lower).toContain("video2a_contract_preserved");
    expect(lower).toContain("provider_deletion_required_for_release");
    expect(lower).toContain("video2b0_protected_business_baseline");
    for (const relation of [
      "public.subscription_plan_prices",
      "public.tenant_subscription_overrides",
      "public.courses",
      "public.course_sections",
      "public.payment_transactions",
      "public.platform_billing_document_fulfillments",
      "public.finance_receipts",
      "public.video_capacity_pack_catalog",
    ]) {
      expect(lower).toContain(`'${relation}'`);
    }
  });

  test("15. does not implement app, provider, webhook, UI or scheduler code", () => {
    expect(lower).not.toContain("create extension");
    expect(lower).not.toContain("vercel.json");
    expect(lower).not.toContain("create function public.handle_video_webhook");
    expect(lower).not.toContain("cron_secret");
    expect(lower).not.toContain("player");
  });

  test("16. deletes a recovered pending-upload orphan without allowing another create", () => {
    const observation = functionSource(
      "observe_native_video_provider_state_server",
      "create function public.claim_native_video_reconciliation_batch_server",
    );
    expect(observation).toContain("v_session.state <> 'provisioned'");
    expect(observation).toContain("v_session.upload_url is null");
    expect(observation).toContain("provider_upload_capability_unavailable");
    expect(observation).toContain("'provider_deletion_required'");
    expect(observation).toContain("state = case");
    expect(observation).toContain("then 'closed'");
  });

  test("17. keeps a valid pending upload active and advances recovered processing states", () => {
    const observation = functionSource(
      "observe_native_video_provider_state_server",
      "create function public.claim_native_video_reconciliation_batch_server",
    );
    expect(observation).toContain("v_session.state <> 'provisioned'");
    expect(observation).toContain(
      "update public.video_assets set last_provider_observed_at = p_event_time",
    );
    expect(observation).toContain(
      "v_state in ('downloading','queued','inprogress')",
    );
    expect(observation).toContain(
      "status = 'processing', last_provider_observed_at = p_event_time",
    );
  });

  test("18. rejects upload capabilities and nested secrets from provider evidence", () => {
    expect(lower).toContain(
      "create function coachfort_internal.video_provider_event_evidence_is_safe",
    );
    expect(lower).toContain("regexp_replace(lower(v_key), '[^a-z0-9]', '', 'g')");
    for (const key of [
      "uploadurl",
      "location",
      "authorization",
      "apitoken",
      "accesstoken",
      "token",
      "secret",
      "webhooksecret",
      "webhooksignature",
    ]) {
      expect(lower).toContain(`'${key}'`);
    }
    expect(lower).toContain(
      "video_provider_event_evidence_is_safe(v_value)",
    );
    expect(lower).toContain("~* '^https?://'");
    expect(lower).toContain(
      "provider_event_evidence_rejects_upload_capability",
    );
    expect(lower).toContain("return true;");
    const recordStart = lower.indexOf(
      "create or replace function public.record_native_video_provider_event_server",
    );
    const recordEnd = lower.indexOf(
      "create table coachfort_internal.video_upload_sessions",
      recordStart,
    );
    const finalizeStart = lower.indexOf(
      "create or replace function public.finalize_native_video_asset_processing_server",
    );
    const finalizeEnd = lower.indexOf(
      "create function public.observe_native_video_provider_state_server",
      finalizeStart,
    );
    const observation = functionSource(
      "observe_native_video_provider_state_server",
      "create function public.claim_native_video_reconciliation_batch_server",
    );
    expect(lower.slice(recordStart, recordEnd)).toContain(
      "video_provider_event_evidence_is_safe(v_evidence)",
    );
    expect(lower.slice(finalizeStart, finalizeEnd)).toContain(
      "video_provider_event_evidence_is_safe(v_evidence)",
    );
    expect(observation).toContain(
      "video_provider_event_evidence_is_safe(v_evidence)",
    );
  });

  test("19. gates every modified VIDEO-2A function on exact source and security", () => {
    expect(lower).toContain("video2a_exact_modified_function_baseline");
    const preBaseline = pre.slice(
      pre.indexOf("video2a_exact_modified_function_baseline as ("),
      pre.indexOf("video2a_contract as ("),
    );
    const applyBaseline = apply.slice(
      apply.indexOf("from (values"),
      apply.indexOf("and lower(pg_get_functiondef", apply.indexOf("from (values")),
    );
    const baselineHashes = [
      "b110dbce83558fd332d2b2e1d279c662",
      "9c459be735aff01f5729aa9c96cb0ebd",
      "008dfebf42284ed76843815b9e1159ba",
      "d6bbacd21af7880ade06a10c943b6050",
      "4dc4adff45b6c8fa8612f6fca0a686d1",
    ];
    for (const hash of baselineHashes) {
      expect(preBaseline.match(new RegExp(hash, "g"))).toHaveLength(1);
      expect(applyBaseline.match(new RegExp(hash, "g"))).toHaveLength(1);
    }
    expect(preBaseline).toContain("md5(pg_get_functiondef(procedure.oid))");
    expect(applyBaseline).toContain("md5(pg_get_functiondef(procedure.oid))");
    expect(preBaseline).not.toContain("procedure.prosrc");
    expect(applyBaseline).not.toContain("procedure.prosrc");
    expect(preBaseline).not.toContain("definition_fingerprint");
    expect(applyBaseline).not.toContain("definition_fingerprint");
    expect(lower).not.toContain("639ab8212d8a7042e0f3297dddc4ca66");
    expect(lower).not.toContain("d8369dd7949605fc23c190016a31e768");
    for (const obsoleteNewFunctionHash of [
      "0c06bbc0b1f752c36722f955d615a2f6",
      "ac05840d0537f18dd08b23e202397f22",
      "c71d92d86c1d47487aa0d55cc4c7aa33",
      "36e33e43567d1bc5a92ce48fa838fc09",
      "85d2c76c924e49863c09fbed97154695",
    ]) {
      expect(lower).not.toContain(obsoleteNewFunctionHash);
    }
    expect(lower).not.toContain(
      "md5(regexp_replace(btrim(procedure.prosrc)",
    );
    expect(lower).toContain("procedure.provolatile::text = expected.volatility");
    expect(lower).toContain("procedure.provolatile::text <> expected.volatility");
    expect(lower).toContain("procedure.proconfig = array['search_path=public, pg_temp']");
    expect(lower).toContain(
      "procedure.proconfig is distinct from array['search_path=public, pg_temp']",
    );
    expect(pre).toContain("video2a_exact_modified_function_baseline_verified");
    expect(post).toContain("video2b0_modified_function_contract_verified");
    expect(post).not.toContain(
      "video2a_exact_modified_function_baseline_verified",
    );
    expect(post).toContain("zero_video_business_rows_unchanged");
    expect(post).not.toContain("protected_business_data_unchanged");
  });

  test("20. fails closed on partial private or public installation", () => {
    expect(lower).toContain(
      "to_regprocedure('coachfort_internal.enforce_video_upload_session_authority()') is null",
    );
    expect(lower).toContain(
      "to_regprocedure('coachfort_internal.video_provider_event_evidence_is_safe(jsonb)') is null",
    );
    expect(lower).toContain("complete_partial_install_guard");
    expect(lower).toContain(
      "to_regprocedure(\n        'public.request_expired_native_video_provider_cleanup_server(uuid,text)'\n      ) is null",
    );
  });

  test("21. advances the trusted nonterminal watermark without lifecycle regression", () => {
    const observation = functionSource(
      "observe_native_video_provider_state_server",
      "create function public.claim_native_video_reconciliation_batch_server",
    );
    const finalizeStart = lower.indexOf(
      "create or replace function public.finalize_native_video_asset_processing_server",
    );
    const finalizeEnd = lower.indexOf(
      "create function public.observe_native_video_provider_state_server",
      finalizeStart,
    );
    const finalize = lower.slice(finalizeStart, finalizeEnd);

    expect(observation).toContain("v_observation_accepted boolean := false");
    expect(observation).toContain(
      "status = 'processing', last_provider_observed_at = p_event_time",
    );
    expect(observation).toContain("elsif v_asset.status <> 'deleted' then");
    expect(observation).toContain(
      "update public.video_assets set last_provider_observed_at = p_event_time",
    );
    expect(observation).toContain(
      "elsif v_state = 'live-inprogress' and v_asset.status <> 'deleted' then",
    );
    expect(observation).toContain(
      "when v_observation_accepted then 'processed' else 'ignored'",
    );

    const staleGuard = observation.indexOf(
      "p_event_time < v_asset.last_provider_observed_at",
    );
    const transitionBranch = observation.indexOf(
      "if v_state in ('downloading','queued','inprogress') then",
    );
    expect(staleGuard).toBeGreaterThan(-1);
    expect(staleGuard).toBeLessThan(transitionBranch);
    expect(observation.slice(staleGuard, transitionBranch)).toContain(
      "processing_status = 'ignored'",
    );
    expect(observation.slice(staleGuard, transitionBranch)).toContain("return");

    expect(finalize).toContain(
      "p_event_time < v_asset.last_provider_observed_at",
    );
    expect(finalize).toContain("processing_status = 'ignored'");
    expect(observation).not.toMatch(
      /live-inprogress'[\s\S]{0,240}status\s*=\s*'(processing|ready|delete_pending|failed)'/,
    );
  });

  test("22. verifies modified functions structurally and emits named pre-commit failures", () => {
    const contractStart = post.indexOf(
      "video2b0_modified_function_contract as (",
    );
    const contractEnd = post.indexOf("session_contract as (", contractStart);
    const modifiedContract = post.slice(contractStart, contractEnd);

    expect(modifiedContract).toContain("count(*) = 5");
    expect(modifiedContract).toContain(
      "pg_get_userbyid(procedure.proowner) = 'postgres'",
    );
    expect(modifiedContract).toContain("procedure.prosecdef");
    expect(modifiedContract).toContain(
      "procedure.provolatile::text = expected.volatility",
    );
    expect(modifiedContract).toContain(
      "procedure.proconfig = array['search_path=public, pg_temp']",
    );
    expect(modifiedContract).toContain(
      "has_function_privilege('service_role', procedure.oid, 'execute')",
    );
    expect(modifiedContract).toContain("acl.grantee = 0");
    expect(modifiedContract).toContain("acl.grantee <> procedure.proowner");
    expect(modifiedContract).toContain("namespace_def.nspname");
    expect(modifiedContract).toContain("provider session authority is unavailable");
    expect(modifiedContract).toContain(
      "video_provider_event_evidence_is_safe(v_evidence)",
    );
    expect(modifiedContract).toContain(
      "on conflict (provider, event_key) do nothing",
    );
    expect(modifiedContract).toContain("or asset.provider_asset_id is not null");
    expect(modifiedContract).not.toContain("source_hash");
    expect(modifiedContract).not.toContain("procedure.prosrc");

    for (const diagnostic of [
      "object installation contract failed",
      "zero fabricated data contract failed",
      "protected business-data fingerprint changed",
      "protected unaffected-function fingerprint changed",
      "modified-function security contract failed",
      "modified-function semantic contract failed",
      "private session acl contract failed",
      "upload capability privacy contract failed",
      "provider-secret absence contract failed",
    ]) {
      expect(apply).toContain(diagnostic);
    }
    expect(apply).not.toContain("video-2b0 pre-commit verification failed");
  });

  test("23. sources the POST session evidence contract explicitly", () => {
    const sessionStart = post.indexOf("session_contract as (");
    const sessionEnd = post.indexOf("behavior_contract as (", sessionStart);
    const sessionContract = post.slice(sessionStart, sessionEnd);

    expect(sessionStart).toBeGreaterThan(-1);
    expect(sessionEnd).toBeGreaterThan(sessionStart);
    expect(sessionContract).toContain("from sources");
    for (const source of [
      "sources.evidence_source",
      "sources.record_source",
      "sources.finalize_source",
      "sources.observe_source",
    ]) {
      expect(sessionContract).toContain(source);
    }
  });
});
