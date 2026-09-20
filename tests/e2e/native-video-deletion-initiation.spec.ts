import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { handleNativeVideoDeletionRequest } from "../../app/api/video/assets/[assetId]/route";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const routePath = "app/api/video/assets/[assetId]/route.ts";
const authorityPath = "supabase/bundle_video_2a_native_video_authority.sql";
const reconciliationPath = "src/lib/server/video/nativeVideoReconciliation.ts";
const providerPath = "src/lib/server/video/cloudflareStream.ts";
const tenantId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const adminId = "44444444-4444-4444-8444-444444444444";

function deletionRequest(
  body: Record<string, unknown> = { tenantId },
  token = "approved-user-token",
) {
  return new Request(`https://coachfort.test/api/video/assets/${assetId}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "DELETE",
  });
}

function context(id = assetId) {
  return { params: Promise.resolve({ assetId: id }) };
}

async function responseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test.describe("VIDEO-2B2 native video deletion initiation", () => {
  test("1. accepts Owner and Admin and binds the authenticated actor server-side", async () => {
    for (const actorUserId of [ownerId, adminId]) {
      const calls: Array<Record<string, unknown>> = [];
      const response = await handleNativeVideoDeletionRequest(
        deletionRequest(),
        context(),
        {
          authenticate: async () => ({ id: actorUserId }),
          requestDeletion: async (input) => {
            calls.push(input);
            return {
              data: { asset_id: assetId, status: "delete_pending" },
              error: null,
            };
          },
        },
      );

      expect(response.status).toBe(202);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await responseBody(response)).toEqual({
        assetId,
        status: "delete_pending",
      });
      expect(calls).toEqual([{ actorUserId, assetId, tenantId }]);
    }
  });

  test("2. canonicalizes uppercase asset and tenant UUIDs before database authority", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handleNativeVideoDeletionRequest(
      deletionRequest({ tenantId: tenantId.toUpperCase() }),
      context(assetId.toUpperCase()),
      {
        authenticate: async () => ({ id: ownerId }),
        requestDeletion: async (input) => {
          calls.push(input);
          return {
            data: { asset_id: assetId, status: "delete_pending" },
            error: null,
          };
        },
      },
    );

    expect(response.status).toBe(202);
    expect(calls).toEqual([{ actorUserId: ownerId, assetId, tenantId }]);
    expect(await responseBody(response)).toEqual({
      assetId,
      status: "delete_pending",
    });
  });

  test("3. maps Staff, Trainer, Student and cross-tenant denials to sanitized 403", async () => {
    for (const actor of ["staff", "trainer", "student", "cross-tenant-owner"]) {
      const response = await handleNativeVideoDeletionRequest(
        deletionRequest(),
        context(),
        {
          authenticate: async () => ({ id: `${actor}-user` }),
          requestDeletion: async () => ({
            data: null,
            error: { code: "42501", message: "private authority detail" },
          }),
        },
      );

      expect(response.status).toBe(403);
      const body = await responseBody(response);
      expect(body.code).toBe("VIDEO_DELETION_FORBIDDEN");
      expect(JSON.stringify(body)).not.toContain("private authority detail");
    }
  });

  test("4. denies missing and invalid authentication before database authority", async () => {
    let databaseCalls = 0;
    const noHeader = new Request(
      `https://coachfort.test/api/video/assets/${assetId}`,
      {
        body: JSON.stringify({ tenantId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    const missing = await handleNativeVideoDeletionRequest(noHeader, context(), {
      requestDeletion: async () => {
        databaseCalls += 1;
        return { data: null, error: null };
      },
    });
    expect(missing.status).toBe(401);

    const invalid = await handleNativeVideoDeletionRequest(
      deletionRequest({}, "invalid-token"),
      context(),
      {
        authenticate: async () => {
          throw new Error("Authentication required.");
        },
        requestDeletion: async () => {
          databaseCalls += 1;
          return { data: null, error: null };
        },
      },
    );
    expect(invalid.status).toBe(401);
    expect(databaseCalls).toBe(0);
  });

  test("5. rejects invalid tenant, asset and expanded client authority inputs", async () => {
    for (const scenario of [
      { body: { tenantId: "not-a-uuid" }, id: assetId },
      { body: { tenantId }, id: "not-a-uuid" },
      { body: { providerUid: "provider-id", tenantId }, id: assetId },
      { body: { actorUserId: ownerId, tenantId }, id: assetId },
      { body: { quota: 0, tenantId }, id: assetId },
    ]) {
      let databaseCalls = 0;
      const response = await handleNativeVideoDeletionRequest(
        deletionRequest(scenario.body),
        context(scenario.id),
        {
          authenticate: async () => ({ id: ownerId }),
          requestDeletion: async () => {
            databaseCalls += 1;
            return { data: null, error: null };
          },
        },
      );
      expect(response.status).toBe(400);
      expect(databaseCalls).toBe(0);
    }
  });

  test("6. maps unknown and attached assets without leaking database errors", async () => {
    const unknown = await handleNativeVideoDeletionRequest(
      deletionRequest(),
      context(),
      {
        authenticate: async () => ({ id: ownerId }),
        requestDeletion: async () => ({
          data: null,
          error: { code: "02000", message: "Native video asset not found." },
        }),
      },
    );
    expect(unknown.status).toBe(404);
    expect(await responseBody(unknown)).toEqual({
      code: "VIDEO_ASSET_NOT_FOUND",
      error: "This video is unavailable.",
    });

    const attached = await handleNativeVideoDeletionRequest(
      deletionRequest(),
      context(),
      {
        authenticate: async () => ({ id: ownerId }),
        requestDeletion: async () => ({
          data: null,
          error: {
            code: "22023",
            message: "Detach this video from lessons before deleting it.",
          },
        }),
      },
    );
    expect(attached.status).toBe(409);
    expect(await responseBody(attached)).toEqual({
      code: "VIDEO_ATTACHED_TO_LESSON",
      error: "Remove this video from its lessons before deleting it.",
    });
  });

  test("7. accepts ready transition and delete-pending replay with the same response", async () => {
    for (const phase of ["ready", "delete_pending"]) {
      const response = await handleNativeVideoDeletionRequest(
        deletionRequest(),
        context(),
        {
          authenticate: async () => ({ id: ownerId }),
          requestDeletion: async () => ({
            data: { asset_id: assetId, status: "delete_pending" },
            error: null,
          }),
        },
      );
      expect(response.status, phase).toBe(202);
      expect(await responseBody(response)).toEqual({
        assetId,
        status: "delete_pending",
      });
    }
  });

  test("8. maps processing, upload-pending, failed and deleted states to 409", async () => {
    for (const state of ["processing", "upload_pending", "failed", "deleted"]) {
      const response = await handleNativeVideoDeletionRequest(
        deletionRequest(),
        context(),
        {
          authenticate: async () => ({ id: ownerId }),
          requestDeletion: async () => ({
            data: null,
            error: {
              code: "22023",
              message: `Native video cannot be deleted from ${state}.`,
            },
          }),
        },
      );
      expect(response.status, state).toBe(409);
      expect((await responseBody(response)).code).toBe(
        "VIDEO_DELETION_STATE_CONFLICT",
      );
    }
  });

  test("9. fails closed on malformed authority responses and unexpected errors", async () => {
    const malformed = await handleNativeVideoDeletionRequest(
      deletionRequest(),
      context(),
      {
        authenticate: async () => ({ id: ownerId }),
        requestDeletion: async () => ({
          data: { asset_id: assetId, status: "deleted" },
          error: null,
        }),
      },
    );
    expect(malformed.status).toBe(500);
    expect(await responseBody(malformed)).toEqual({
      code: "VIDEO_DELETION_REQUEST_FAILED",
      error: "Video deletion could not be requested.",
    });
  });

  test("10. calls only the service deletion RPC and contains no provider or direct-table path", () => {
    const route = read(routePath);
    expect(route).toContain('export async function DELETE');
    expect(route).toContain('"request_native_video_deletion_server"');
    expect(route.match(/\.rpc\(/g)).toHaveLength(1);
    expect(route).toContain("p_actor_user_id: input.actorUserId");
    expect(route).toContain("Object.keys(body).length !== 1");
    expect(route).not.toMatch(/cloudflare|provider_asset|provider uid/i);
    expect(route).not.toMatch(/\.from\(["']video_/);
    expect(route).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(route).not.toContain("assert_tenant_operational_access");
  });

  test("11. preserves exact Owner/Admin, attachment and state authority in the database", () => {
    const sql = read(authorityPath).toLowerCase();
    const start = sql.indexOf(
      "create function public.request_native_video_deletion_server",
    );
    const end = sql.indexOf(
      "create function public.confirm_native_video_provider_deletion_server",
      start,
    );
    const source = sql.slice(start, end);
    expect(source).toContain("assert_native_video_owner_admin");
    expect(source).toContain("video_asset_attachments");
    expect(source).toContain("detach this video from lessons before deleting it");
    expect(source).toContain("if v_asset.status = 'delete_pending'");
    expect(source).toContain("if v_asset.status <> 'ready'");
    expect(source).toContain("status = 'delete_pending'");
    expect(source).toContain("delete_requested_at = now()");
    expect(source).not.toContain("assert_tenant_operational_access");
    expect(sql).toContain(
      "grant execute on function public.request_native_video_deletion_server(uuid,uuid,uuid)\n  to service_role",
    );
    expect(sql).toContain(
      "revoke all on function public.request_native_video_deletion_server(uuid,uuid,uuid)\n  from public, anon, authenticated, service_role",
    );
  });

  test("12. retains quota until provider confirmation and releases it only after deletion", () => {
    const sql = read(authorityPath).toLowerCase();
    const usageStart = sql.indexOf(
      "create function coachfort_internal.resolve_native_video_usage",
    );
    const usageEnd = sql.indexOf(
      "create function coachfort_internal.validate_external_video_url",
      usageStart,
    );
    const usage = sql.slice(usageStart, usageEnd);
    const confirmStart = sql.indexOf(
      "create function public.confirm_native_video_provider_deletion_server",
    );
    const confirmEnd = sql.indexOf(
      "create function public.get_native_video_capacity_server",
      confirmStart,
    );
    const confirm = sql.slice(confirmStart, confirmEnd);
    expect(usage).toContain("status in ('ready','delete_pending')");
    expect(usage).toContain("provider_deleted_at is null");
    expect(confirm).toContain("status = 'deleted'");
    expect(confirm).toContain("provider_deleted_at = now()");
    expect(confirm).toContain("reserved_seconds = 0");
  });

  test("13. leaves Cloudflare deletion and retry behavior in reconciliation only", () => {
    const reconciliation = read(reconciliationPath);
    const provider = read(providerPath);
    expect(reconciliation).toContain('item.action === "delete_provider"');
    expect(reconciliation).toContain("await provider.deleteVideo(item.providerAssetId)");
    expect(reconciliation).toContain("await database.confirmDeletion");
    expect(reconciliation).toContain("await releaseBestEffort");
    expect(provider).toContain("if (response.status === 404)");
    expect(provider).toContain("alreadyAbsent: true, deleted: true");
    expect(provider).toContain('safeCode: "video_provider_delete_failed"');
    expect(read(routePath)).not.toContain("deleteVideo");
  });
});
