import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath = join(
  root,
  "supabase/bundle_video_2c2d2b1_size_aware_upload_window_authority.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const lower = migration.toLowerCase();
const functionStart = lower.indexOf(
  "create or replace function public.reserve_native_video_upload_server(",
);
const functionEnd = lower.indexOf(
  "alter function public.reserve_native_video_upload_server(",
  functionStart,
);
const reserveSource = lower.slice(functionStart, functionEnd);
const provisioningSource = readFileSync(
  join(root, "src/lib/server/video/nativeVideoUploadProvisioning.ts"),
  "utf8",
);
const providerSource = readFileSync(
  join(root, "src/lib/server/video/cloudflareStream.ts"),
  "utf8",
);
const providerAuthority = readFileSync(
  join(root, "supabase/bundle_video_2b0_provider_upload_authority.sql"),
  "utf8",
).toLowerCase();
const expectedDependencies = [
  "coachfort_internal.assert_native_video_owner_admin(uuid,uuid)",
  "coachfort_internal.assert_tenant_operational_access(uuid)",
  "coachfort_internal.assert_effective_operational_feature(uuid,text)",
  "coachfort_internal.native_video_capacity_authority_lock(uuid)",
  "coachfort_internal.resolve_native_video_capacity(uuid)",
  "coachfort_internal.resolve_native_video_usage(uuid,uuid)",
  "public.claim_native_video_upload_provisioning_server(uuid)",
  "public.complete_native_video_upload_provisioning_server(uuid,uuid,text,text,timestamptz)",
  "public.expire_unbound_native_video_upload_server(uuid,uuid,integer)",
  "public.claim_native_video_reconciliation_batch_server(integer,integer)",
] as const;
const dependencyRegistryStart = lower.indexOf(
  "create temp table video2c2d2b1_expected_dependencies",
);
const dependencyRegistryEnd = lower.indexOf(
  "do $video2c2d2b1_prerequisite$",
  dependencyRegistryStart,
);
const dependencyRegistry = lower.slice(
  dependencyRegistryStart,
  dependencyRegistryEnd,
);

function windowSeconds(declaredSizeBytes: number) {
  const transferSeconds = Math.ceil((declaredSizeBytes * 8) / 1_000_000);
  return Math.min(86_400, Math.max(7_200, transferSeconds + 7_200));
}

test.describe("VIDEO-2C2D2-B1 size-aware initial upload window authority", () => {
  test("1. replaces only the current reservation RPC in a guarded transaction", () => {
    expect(functionStart).toBeGreaterThan(-1);
    expect(functionEnd).toBeGreaterThan(functionStart);
    expect(lower.trimStart()).toContain("begin;");
    expect(lower.trimEnd()).toMatch(/commit;$/);
    expect(lower).toContain("video2c2d2b1_prerequisite");
    expect(lower).toContain("video2c2d2b1_self_verify");
    expect(lower).toContain("prerequisite reservation semantics drifted");
    expect(lower).toContain("changed protected video business data");
    expect(lower).toContain("changed adjacent video authority");
    expect(lower).not.toMatch(/create\s+table\s+(public|coachfort_internal)\./);
    expect(lower).not.toMatch(/alter\s+table\s+/);
    expect(lower).not.toMatch(/add\s+column\s+/);
  });

  test("1b. fails closed unless the exact adjacent dependency set resolves", () => {
    expect(dependencyRegistryStart).toBeGreaterThan(-1);
    expect(dependencyRegistryEnd).toBeGreaterThan(dependencyRegistryStart);
    expect(dependencyRegistry.match(/^  \('/gm)).toHaveLength(10);
    for (const identity of expectedDependencies) {
      expect(dependencyRegistry).toContain(`('${identity}')`);
    }

    expect(lower).toContain(
      "select count(*) from video2c2d2b1_expected_dependencies) <> 10",
    );
    expect(lower).toContain("to_regprocedure(expected.identity) is null");
    expect(lower).toContain(
      "video-2c2d2-b1 prerequisite dependency authority drifted.",
    );
    expect(lower).toContain("using errcode = '55000'");
    expect(lower).toContain(
      "jsonb_agg(expected.identity order by expected.identity)",
    );
    expect(lower).toContain("v_adjacent_count <> 10");
    expect(lower).toContain(
      "v_adjacent_identities is distinct from",
    );
    expect(lower).toContain(
      "v_baseline.adjacent_function_identities",
    );
    expect(lower).toContain(
      "v_adjacent is distinct from v_baseline.adjacent_function_contract",
    );
    expect(lower).not.toMatch(
      /where\s+procedure\.oid\s+in\s*\(\s*to_regprocedure/,
    );
  });

  test("2. implements the approved numeric formula at exact boundaries", () => {
    expect(reserveSource).toContain(
      "(p_declared_size_bytes::numeric * 8::numeric) / 1000000::numeric",
    );
    expect(reserveSource).toContain("86400::bigint");
    expect(reserveSource).toContain("greatest(7200::bigint");
    expect(reserveSource).toContain("v_transfer_seconds + 7200::bigint");
    expect(reserveSource).toContain("v_authority_now := now()");
    expect(reserveSource).toContain(
      "make_interval(secs => v_window_seconds::double precision)",
    );
    expect(reserveSource).not.toContain("interval '90 minutes'");

    expect(windowSeconds(1)).toBe(7_201);
    expect(windowSeconds(1_048_576)).toBe(7_209);
    expect(windowSeconds(1_073_741_824)).toBe(15_790);
    expect(windowSeconds(2_147_483_648)).toBe(24_380);
    expect(windowSeconds(5_368_709_120)).toBe(50_150);
    expect(windowSeconds(10_737_418_240)).toBe(86_400);

    for (const bytes of [1, 1_048_576, 1_073_741_824, 10_737_418_240]) {
      expect(windowSeconds(bytes)).toBeGreaterThanOrEqual(7_200);
      expect(windowSeconds(bytes)).toBeLessThanOrEqual(86_400);
    }
  });

  test("3. preserves validation, lifecycle, feature, role and capacity authority", () => {
    expect(reserveSource).toContain("assert_native_video_owner_admin");
    expect(reserveSource).toContain("assert_tenant_operational_access");
    expect(reserveSource).toContain("assert_effective_operational_feature");
    expect(reserveSource).toContain("'native_video'");
    expect(reserveSource).toContain(
      "p_expected_duration_seconds not between 1 and 7200",
    );
    expect(reserveSource).toContain(
      "p_declared_size_bytes not between 1 and 10737418240",
    );
    for (const mime of [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-matroska",
      "video/x-msvideo",
      "video/mpeg",
    ]) {
      expect(reserveSource).toContain(`'${mime}'`);
    }
    expect(
      reserveSource.indexOf("native_video_capacity_authority_lock"),
    ).toBeLessThan(reserveSource.indexOf("select * into v_existing"));
    expect(reserveSource).toContain("resolve_native_video_capacity");
    expect(reserveSource).toContain("resolve_native_video_usage");
    expect(reserveSource).toContain("native video storage capacity is full");
    expect(lower).toContain("member.role in (''owner'',''admin'')");
    expect(reserveSource).not.toContain("platform_admin");
    expect(lower).toContain("v_role_source like '%platform_admin%'");
  });

  test("4. retains the stored expiry on exact replay and never creates a sliding window", () => {
    const replay = reserveSource.indexOf("if found then");
    const calculation = reserveSource.indexOf("v_transfer_seconds := ceil");
    const insert = reserveSource.indexOf("insert into public.video_assets");
    expect(replay).toBeGreaterThan(-1);
    expect(calculation).toBeGreaterThan(replay);
    expect(insert).toBeGreaterThan(calculation);
    expect(reserveSource).toContain(
      "'reservation_expires_at', v_existing.reservation_expires_at",
    );
    expect(reserveSource).toContain("'replayed', true");
    expect(reserveSource).toContain(
      "native video request id was reused with different inputs",
    );
    expect(reserveSource).toContain("using errcode = '23505'");
    expect(reserveSource).not.toContain("update public.video_assets");
    expect(reserveSource.match(/insert into public\.video_assets/g)).toHaveLength(1);
  });

  test("5. preserves the exact server-only function security posture", () => {
    expect(reserveSource).toContain("returns jsonb");
    expect(reserveSource).toContain("language plpgsql");
    expect(reserveSource).toContain("volatile");
    expect(reserveSource).toContain("security definer");
    expect(reserveSource).toContain("set search_path = public, pg_temp");
    expect(lower).toContain(
      "owner to postgres",
    );
    expect(lower).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(lower).toContain(
      "to service_role",
    );
    expect(lower).toContain("not has_function_privilege('service_role'");
    expect(lower).toContain("has_function_privilege('anon'");
    expect(lower).toContain("has_function_privilege('authenticated'");
  });

  test("6. adds no renewal, provider-generation, schema or row-migration authority", () => {
    expect(lower).not.toMatch(/create\s+table\s+(public|coachfort_internal)\./);
    expect(lower).not.toMatch(/alter\s+table\s+/);
    expect(lower).not.toMatch(/add\s+column\s+/);
    expect(lower).not.toContain("provider_generation");
    expect(lower).not.toContain("renewal_claim");
    expect(lower).not.toContain("renewal_state");
    expect(lower).not.toContain("upload_expiry_renewal");
    expect(lower).toContain("video_upload_sessions");
    expect(lower).toContain("changed protected table acls");
  });

  test("7. leaves provider expiry derivation and expired-capability reconciliation unchanged", () => {
    expect(provisioningSource).toContain(
      "reservationExpiresAt: claim.reservationExpiresAt",
    );
    expect(provisioningSource).toContain(
      "reservationExpiresAt: claim.reservationExpiresAt,",
    );
    expect(providerSource).toContain(
      "getProviderUploadExpiry(reservationExpiresAt: string)",
    );
    expect(providerSource).toContain(
      "expiry ${encodeMetadataValue(input.providerUploadExpiresAt)}",
    );
    expect(providerAuthority).toContain(
      "v_session.provider_upload_expires_at > now()",
    );
    expect(providerAuthority).toContain(
      "safe_failure_code = 'provider_upload_capability_expired'",
    );
    expect(providerAuthority).toContain(
      "p_provider_upload_expires_at > v_asset.reservation_expires_at",
    );
    expect(lower).not.toContain("uploadexpiry");
  });

  test("8. self-verifies formula boundaries and protected data without backfill", () => {
    for (const contract of [
      "(1::bigint, 7201::bigint)",
      "(1048576::bigint, 7209::bigint)",
      "(1073741824::bigint, 15790::bigint)",
      "(2147483648::bigint, 24380::bigint)",
      "(5368709120::bigint, 50150::bigint)",
      "(10737418240::bigint, 86400::bigint)",
    ]) {
      expect(lower).toContain(contract);
    }
    expect(lower).toContain("v_actual_window < 7200");
    expect(lower).toContain("v_actual_window > 86400");
    expect(lower).toContain("asset_fingerprint");
    expect(lower).toContain("session_fingerprint");
    expect(lower).toContain("provider_event_fingerprint");
    expect(lower).toContain("attachment_fingerprint");
    expect(lower).toContain("adjacent_function_contract");
  });
});
