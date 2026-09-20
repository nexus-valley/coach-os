import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CloudflareStreamVideo } from "../../src/lib/server/video/cloudflareStream";
import { buildNativeVideoProviderObservation } from "../../src/lib/server/video/nativeVideoProviderObservation";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath =
  "supabase/bundle_video_2b1d_cross_source_observation_idempotency.sql";
const migration = read(migrationPath);
const lower = migration.toLowerCase();
const correctionPath =
  "supabase/bundle_video_2b1d1_cross_source_replay_total_boolean.sql";
const correction = read(correctionPath);
const correctionLower = correction.toLowerCase();
const application = read(
  "src/lib/server/video/nativeVideoProviderObservation.ts",
);

const assetId = "11111111-1111-4111-8111-111111111111";

function providerVideo(
  state: CloudflareStreamVideo["state"] = "ready",
  overrides: Partial<CloudflareStreamVideo> = {},
): CloudflareStreamVideo {
  return {
    creatorCorrelation: assetId,
    durationSeconds: state === "ready" ? 121 : null,
    modifiedAt: "2026-09-19T08:30:00.000Z",
    providerAssetId: "provider-video-uid",
    readyToStream: state === "ready",
    requireSignedURLs: true,
    safeErrorCode: state === "error" ? "err_malformed_video" : null,
    state,
    uploadedAt: "2026-09-19T08:20:00.000Z",
    uploadExpiry: "2026-09-19T10:00:00.000Z",
    ...overrides,
  };
}

function canonicalEvidence(evidence: Record<string, unknown>) {
  const canonical = { ...evidence };
  delete canonical.observation_source;
  return canonical;
}

function replayMatches(
  stored: ReturnType<typeof buildNativeVideoProviderObservation>,
  incoming: ReturnType<typeof buildNativeVideoProviderObservation>,
) {
  return replayEvidenceMatches(
    stored.safePayloadHash,
    stored.safeEvidence,
    incoming.safePayloadHash,
    incoming.safeEvidence,
  );
}

function replayEvidenceMatches(
  storedHash: string | null,
  storedEvidence: Record<string, unknown>,
  incomingHash: string | null,
  incomingEvidence: Record<string, unknown>,
) {
  if (
    storedHash === incomingHash &&
    JSON.stringify(storedEvidence) === JSON.stringify(incomingEvidence)
  ) {
    return true;
  }
  const storedSource = storedEvidence.observation_source;
  const incomingSource = incomingEvidence.observation_source;
  const oppositeSources =
    (storedSource === "webhook" && incomingSource === "reconciliation") ||
    (storedSource === "reconciliation" && incomingSource === "webhook");
  return (
    oppositeSources &&
    JSON.stringify(canonicalEvidence(storedEvidence)) ===
      JSON.stringify(canonicalEvidence(incomingEvidence))
  );
}

test.describe("VIDEO-2B1D cross-source provider observation idempotency", () => {
  test("1. same-source webhook and reconciliation replays remain idempotent", () => {
    for (const source of ["webhook", "reconciliation"] as const) {
      const first = buildNativeVideoProviderObservation(providerVideo(), source);
      const replay = buildNativeVideoProviderObservation(providerVideo(), source);
      expect(replay.eventKey).toBe(first.eventKey);
      expect(replay.safePayloadHash).toBe(first.safePayloadHash);
      expect(replayMatches(first, replay)).toBe(true);
    }
  });

  test("2. webhook and reconciliation use one source-neutral event and payload identity", () => {
    const webhook = buildNativeVideoProviderObservation(
      providerVideo(),
      "webhook",
    );
    const reconciliation = buildNativeVideoProviderObservation(
      providerVideo(),
      "reconciliation",
    );
    expect(webhook.eventKey).toBe(reconciliation.eventKey);
    expect(webhook.safePayloadHash).toBe(reconciliation.safePayloadHash);
    expect(webhook.safeEvidence.observation_source).toBe("webhook");
    expect(reconciliation.safeEvidence.observation_source).toBe(
      "reconciliation",
    );
    expect(replayMatches(webhook, reconciliation)).toBe(true);
    expect(replayMatches(reconciliation, webhook)).toBe(true);
    expect(application).toContain("JSON.stringify(canonicalSafeEvidence)");
    expect(application).not.toContain("JSON.stringify(safeEvidence)");
  });

  test("3. the corrected SQL helper retains first provenance and rejects substantive evidence drift", () => {
    const helper = correctionLower.slice(
      correctionLower.indexOf(
        "create or replace function coachfort_internal.provider_event_replay_evidence_matches",
      ),
      correctionLower.indexOf(
        "alter function coachfort_internal.provider_event_replay_evidence_matches",
      ),
    );
    expect(helper).toContain("- 'observation_source'");
    expect(helper).toContain("= 'webhook'");
    expect(helper).toContain("= 'reconciliation'");
    expect(helper).toContain("else false");
    expect(helper).toContain("p_stored_hash is not distinct from p_incoming_hash");
    expect(correctionLower).not.toContain(
      "update public.video_provider_events set safe_evidence_json",
    );

    const first = buildNativeVideoProviderObservation(
      providerVideo(),
      "webhook",
    );
    const changed = buildNativeVideoProviderObservation(
      providerVideo("ready", { durationSeconds: 122 }),
      "reconciliation",
    );
    expect(changed.eventKey).toBe(first.eventKey);
    expect(replayMatches(first, changed)).toBe(false);
  });

  test("4. record, observation, and finalization all use the canonical replay helper", () => {
    const runtimeDefinitions = lower.slice(
      lower.indexOf(
        "create or replace function public.record_native_video_provider_event_server",
      ),
      lower.indexOf(
        "alter function public.record_native_video_provider_event_server",
      ),
    );
    expect(
      lower.match(/or not coachfort_internal\.provider_event_replay_evidence_matches\(/g),
    ).toHaveLength(3);
    expect(
      runtimeDefinitions.match(/on conflict \(provider, event_key\) do nothing/g),
    ).toHaveLength(3);
    expect(lower).toContain("video_provider_events_identity_key");
    expect(lower).toContain("count(distinct (provider, event_key))");
  });

  test("5. concurrent cross-source contenders retain one unique event authority", async () => {
    const rows = new Map<string, ReturnType<typeof buildNativeVideoProviderObservation>>();
    const insert = async (
      source: "webhook" | "reconciliation",
    ): Promise<"inserted" | "replayed"> => {
      const observation = buildNativeVideoProviderObservation(
        providerVideo(),
        source,
      );
      const existing = rows.get(observation.eventKey);
      if (existing) {
        if (!replayMatches(existing, observation)) throw new Error("conflict");
        return "replayed";
      }
      rows.set(observation.eventKey, observation);
      return "inserted";
    };
    const results = await Promise.all([
      insert("webhook"),
      insert("reconciliation"),
    ]);
    expect(results.sort()).toEqual(["inserted", "replayed"]);
    expect(rows.size).toBe(1);
    expect(
      ["webhook", "reconciliation"].includes(
        String([...rows.values()][0].safeEvidence.observation_source),
      ),
    ).toBe(true);
  });

  test("6. ready and error observations share identity without duplicate terminal work", () => {
    for (const state of ["ready", "error"] as const) {
      const webhook = buildNativeVideoProviderObservation(
        providerVideo(state),
        "webhook",
      );
      const reconciliation = buildNativeVideoProviderObservation(
        providerVideo(state),
        "reconciliation",
      );
      expect(reconciliation.eventKey).toBe(webhook.eventKey);
      expect(replayMatches(webhook, reconciliation)).toBe(true);
    }
    const finalize = lower.slice(
      lower.indexOf(
        "create or replace function public.finalize_native_video_asset_processing_server",
      ),
      lower.indexOf(
        "create or replace function public.observe_native_video_provider_state_server",
      ),
    );
    expect(finalize.indexOf("provider_event_replay_evidence_matches")).toBeLessThan(
      finalize.indexOf("if v_asset.last_provider_observed_at is not null"),
    );
    expect(finalize).toContain("if v_asset.status = 'upload_pending'");
    expect(finalize).toContain("'replayed', true");
  });

  test("7. stale and malformed evidence protections remain installed", () => {
    expect(lower).toContain("p_event_time < v_asset.last_provider_observed_at");
    expect(lower).toContain("'stale_observation', true");
    expect(lower).toContain(
      "not coachfort_internal.video_provider_event_evidence_is_safe(v_evidence)",
    );
    expect(lower).toContain("jsonb_typeof(v_evidence) <> 'object'");
    expect(lower).toContain("char_length(v_evidence::text) > 3000");
  });

  test("8. legacy source-sensitive hashes replay only across opposite sources", () => {
    const helper = correctionLower.slice(
      correctionLower.indexOf(
        "create or replace function coachfort_internal.provider_event_replay_evidence_matches",
      ),
      correctionLower.indexOf(
        "alter function coachfort_internal.provider_event_replay_evidence_matches",
      ),
    );
    expect(helper).toContain("select case");
    expect(helper).toContain("p_stored_hash is not distinct from p_incoming_hash");
    expect(helper).not.toContain("update ");
    expect(correctionLower).toContain("provider_event_rows_untouched");
  });

  test("9. PRE and APPLY fail closed on the reviewed VIDEO-2B0 baseline", () => {
    expect(lower).toContain("expected_video2b0_baseline");
    expect(lower).toContain(
      "video-2b1d prerequisite authority does not match the reviewed baseline",
    );
    expect(lower).toContain("target_function_fingerprints");
    expect(lower).toContain("rows_with_observation_source");
    expect(lower).toContain("rows_with_other_observation_source");
  });

  test("10. security and protected-row contracts remain closed", () => {
    expect(lower).toContain("owner to postgres");
    expect(lower).toContain("set search_path = public, pg_temp");
    expect(lower).toContain("from public, anon, authenticated, service_role");
    expect(lower).toContain("to service_role");
    expect(lower).toContain("direct_writes_absent");
    expect(lower).toContain("video-2b1d modified protected video data");
  });

  test("11. evidence contains no upload capability or provider secret", () => {
    const observation = buildNativeVideoProviderObservation(
      providerVideo(),
      "webhook",
    );
    const serialized = JSON.stringify(observation.safeEvidence);
    for (const forbidden of [
      "authorization",
      "secret",
      "token",
      "upload_url",
      "webhook-signature",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  test("12. migration is narrow and does not alter event identity or product authority", () => {
    expect(lower).not.toContain("create table");
    expect(lower).not.toContain("alter table");
    expect(lower).not.toContain("subscription_plan_feature_entitlements");
    expect(lower).not.toContain("subscription_plan_usage_limits");
    expect(lower).not.toContain("cloudflare_stream_api_token");
    expect(lower).not.toContain("cloudflare_stream_webhook_secret");
  });

  test("13. corrected helper accepts exact and both opposite-source replays", () => {
    const canonical = { duration_seconds: 10, provider_state: "ready" };
    expect(
      replayEvidenceMatches("a", { ...canonical }, "a", { ...canonical }),
    ).toBe(true);
    expect(
      replayEvidenceMatches(
        "a",
        { ...canonical, observation_source: "webhook" },
        "b",
        { ...canonical, observation_source: "reconciliation" },
      ),
    ).toBe(true);
    expect(
      replayEvidenceMatches(
        "a",
        { ...canonical, observation_source: "reconciliation" },
        "b",
        { ...canonical, observation_source: "webhook" },
      ),
    ).toBe(true);
  });

  test("14. corrected helper rejects same-source hash drift", () => {
    const canonical = { duration_seconds: 10, provider_state: "ready" };
    for (const source of ["webhook", "reconciliation"] as const) {
      expect(
        replayEvidenceMatches(
          "a",
          { ...canonical, observation_source: source },
          "b",
          { ...canonical, observation_source: source },
        ),
      ).toBe(false);
    }
  });

  test("15. corrected helper returns false rather than null for unclassified hash drift", () => {
    const canonical = { duration_seconds: 10, provider_state: "ready" };
    const results = [
      replayEvidenceMatches("a", canonical, "b", canonical),
      replayEvidenceMatches(
        "a",
        { ...canonical, observation_source: "other" },
        "b",
        { ...canonical, observation_source: "other" },
      ),
    ];
    expect(results).toEqual([false, false]);
    expect(results.every((result) => typeof result === "boolean")).toBe(true);
  });

  test("16. corrected helper rejects cross-source canonical drift", () => {
    expect(
      replayEvidenceMatches(
        "a",
        {
          duration_seconds: 10,
          observation_source: "webhook",
          provider_state: "ready",
        },
        "b",
        {
          duration_seconds: 11,
          observation_source: "reconciliation",
          provider_state: "ready",
        },
      ),
    ).toBe(false);
  });

  test("17. corrective migration changes only the helper and uses behavioral POST gates", () => {
    expect(correctionLower).toContain("create or replace function coachfort_internal");
    expect(correctionLower).not.toContain("create or replace function public.");
    expect(correctionLower).not.toContain("insert into public.video_provider_events");
    expect(correctionLower).not.toContain("update public.video_provider_events");
    expect(correctionLower).not.toContain("delete from public.video_provider_events");
    expect(correctionLower).not.toContain("helper_source like");
    expect(correctionLower).toContain("all_results_non_null");
    expect(correctionLower).toContain("same_source_hash_drift_currently_allowed");
    expect(correctionLower).toContain("missing_source_hash_drift_currently_null");
  });
});
