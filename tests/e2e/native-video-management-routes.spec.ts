import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { handleNativeVideoInventoryRequest } from "../../app/api/video/assets/route";
import {
  handleNativeVideoDeletionRequest,
  handleNativeVideoExactAssetRequest,
} from "../../app/api/video/assets/[assetId]/route";
import { handleNativeVideoCapacityRequest } from "../../app/api/video/capacity/route";
import {
  createNativeVideoManagementDatabase,
  decodeNativeVideoManagementCursor,
  encodeNativeVideoManagementCursor,
  mapNativeVideoManagementAttention,
  nativeVideoManagementDefaultLimit,
  nativeVideoManagementMaximumLimit,
  NativeVideoManagementPublicError,
  normalizeNativeVideoCapacity,
  normalizeNativeVideoManagementProjection,
} from "../../src/lib/server/video/nativeVideoManagement";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const tenantId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";
const courseId = "44444444-4444-4444-8444-444444444444";
const lessonId = "55555555-5555-4555-8555-555555555555";
const createdAt = "2026-09-21T10:11:12.123456+00:00";
const updatedAt = "2026-09-21T10:12:13.654321+00:00";

function authorizedRequest(path: string) {
  return new Request(`https://coachfort.test${path}`, {
    headers: { Authorization: "Bearer approved-user-token" },
  });
}

function exactContext(id = assetId) {
  return { params: Promise.resolve({ assetId: id }) };
}

function rawAsset(overrides: Record<string, unknown> = {}) {
  return {
    asset_id: assetId,
    attachments: [
      {
        course_id: courseId,
        course_title: "Course",
        lesson_id: lessonId,
        lesson_title: "Lesson",
      },
    ],
    created_at: createdAt,
    delete_requested_at: null,
    duration_seconds: 15,
    original_filename: "lesson.mp4",
    reserved_seconds: 0,
    safe_failure_code: null,
    status: "ready",
    updated_at: updatedAt,
    ...overrides,
  };
}

function rawProjection(
  mode: "exact" | "list" = "list",
  overrides: Record<string, unknown> = {},
) {
  return {
    items: [rawAsset()],
    mode,
    next_cursor:
      mode === "list" ? { asset_id: assetId, created_at: createdAt } : null,
    ...overrides,
  };
}

function rawCapacity(overrides: Record<string, unknown> = {}) {
  return {
    add_on_capacity_minutes: 100,
    available_for_new_upload_minutes: 675,
    base_capacity_minutes: 600,
    capacity_state: "normal",
    effective_capacity_minutes: 700,
    feature_enabled: true,
    override_capacity_minutes: null,
    percent_used: 2.14,
    reserved_minutes: 10,
    stored_minutes: 15,
    ...overrides,
  };
}

function fakeClient(
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>,
) {
  return { rpc } as unknown as SupabaseClient;
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test.describe("VIDEO-2C2D0-B native-video management GET routes", () => {
  test("inventory requires authentication before projection authority", async () => {
    let calls = 0;
    const response = await handleNativeVideoInventoryRequest(
      new Request(`https://coachfort.test/api/video/assets?tenantId=${tenantId}`),
      {
        listAssets: async () => {
          calls += 1;
          return { items: [], nextCursor: null };
        },
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await json(response)).code).toBe("VIDEO_AUTHENTICATION_REQUIRED");
    expect(calls).toBe(0);
  });

  test("inventory binds actor identity, canonicalizes tenant and uses default limit", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handleNativeVideoInventoryRequest(
      authorizedRequest(
        `/api/video/assets?tenantId=${tenantId.toUpperCase()}`,
      ),
      {
        authenticate: async () => ({ id: actorUserId }),
        listAssets: async (input) => {
          calls.push(input);
          return { items: [], nextCursor: null };
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([
      {
        actorUserId,
        cursor: null,
        limit: nativeVideoManagementDefaultLimit,
        tenantId,
      },
    ]);
  });

  test("inventory caps excessive limits and rejects malformed query authority", async () => {
    const limits: number[] = [];
    const capped = await handleNativeVideoInventoryRequest(
      authorizedRequest(`/api/video/assets?tenantId=${tenantId}&limit=999999`),
      {
        authenticate: async () => ({ id: actorUserId }),
        listAssets: async (input) => {
          limits.push(input.limit);
          return { items: [], nextCursor: null };
        },
      },
    );
    expect(capped.status).toBe(200);
    expect(limits).toEqual([nativeVideoManagementMaximumLimit]);

    for (const query of [
      `tenantId=invalid`,
      `tenantId=${tenantId}&limit=0`,
      `tenantId=${tenantId}&limit=1.5`,
      `tenantId=${tenantId}&limit=1000000`,
      `tenantId=${tenantId}&tenantId=${tenantId}`,
      `tenantId=${tenantId}&actorUserId=${actorUserId}`,
      `tenantId=${tenantId}&cursorCreatedAt=${encodeURIComponent(createdAt)}`,
    ]) {
      let calls = 0;
      const response = await handleNativeVideoInventoryRequest(
        authorizedRequest(`/api/video/assets?${query}`),
        {
          authenticate: async () => ({ id: actorUserId }),
          listAssets: async () => {
            calls += 1;
            return { items: [], nextCursor: null };
          },
        },
      );
      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control"), query).toBe(
        "private, no-store",
      );
      expect(calls, query).toBe(0);
    }
  });

  test("opaque versioned cursor round-trips exact timestamp precision", async () => {
    const cursor = encodeNativeVideoManagementCursor({ assetId, createdAt });
    expect(cursor).not.toContain(assetId);
    expect(cursor).not.toContain(createdAt);
    expect(decodeNativeVideoManagementCursor(cursor)).toEqual({
      assetId,
      createdAt,
    });

    const calls: Array<Record<string, unknown>> = [];
    const response = await handleNativeVideoInventoryRequest(
      authorizedRequest(
        `/api/video/assets?tenantId=${tenantId}&cursor=${encodeURIComponent(cursor)}`,
      ),
      {
        authenticate: async () => ({ id: actorUserId }),
        listAssets: async (input) => {
          calls.push(input);
          return { items: [], nextCursor: null };
        },
      },
    );
    expect(response.status).toBe(200);
    expect(calls[0]?.cursor).toEqual({ assetId, createdAt });
  });

  test("malformed cursors fail closed before projection authority", async () => {
    const malformed = [
      "not+base64",
      Buffer.from("{}", "utf8").toString("base64url"),
      Buffer.from(
        JSON.stringify({ assetId, createdAt, extra: true, v: 1 }),
        "utf8",
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({ assetId, createdAt: "invalid", v: 1 }),
        "utf8",
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          assetId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          createdAt,
          v: 1,
        }),
        "utf8",
      ).toString("base64url"),
    ];

    for (const cursor of malformed) {
      let calls = 0;
      const response = await handleNativeVideoInventoryRequest(
        authorizedRequest(
          `/api/video/assets?tenantId=${tenantId}&cursor=${encodeURIComponent(cursor)}`,
        ),
        {
          authenticate: async () => ({ id: actorUserId }),
          listAssets: async () => {
            calls += 1;
            return { items: [], nextCursor: null };
          },
        },
      );
      expect(response.status).toBe(400);
      expect(calls).toBe(0);
    }
  });

  test("projection normalizer returns only the bounded browser DTO", () => {
    const normalized = normalizeNativeVideoManagementProjection(
      rawProjection("list", {
        items: [rawAsset({ safe_failure_code: "provider_processing_failed" })],
      }),
      { limit: 25, mode: "list" },
    );

    expect(normalized.items).toEqual([
      {
        assetId,
        attachments: [
          { courseId, courseTitle: "Course", lessonId, lessonTitle: "Lesson" },
        ],
        attention: "processing_failed",
        createdAt,
        deleteRequestedAt: null,
        durationSeconds: 15,
        filename: "lesson.mp4",
        reservedSeconds: 0,
        status: "ready",
        updatedAt,
      },
    ]);
    expect(normalized.nextCursor).toEqual(expect.any(String));
    const serialized = JSON.stringify(normalized);
    for (const forbidden of [
      "safe_failure_code",
      "next_cursor",
      "provider_asset_id",
      "provider_upload_id",
      "request_id",
      "created_by",
      "metadata_json",
      "upload_url",
      "claim_token",
      "provider_events",
      "cloudflare",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("projection rejects extra private fields and inconsistent cursors", () => {
    expect(() =>
      normalizeNativeVideoManagementProjection(
        rawProjection("list", {
          items: [rawAsset({ provider_asset_id: "private-provider-id" })],
        }),
        { limit: 25, mode: "list" },
      ),
    ).toThrow(NativeVideoManagementPublicError);

    expect(() =>
      normalizeNativeVideoManagementProjection(
        rawProjection("list", {
          next_cursor: {
            asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            created_at: createdAt,
          },
        }),
        { limit: 25, mode: "list" },
      ),
    ).toThrow(NativeVideoManagementPublicError);
  });

  test("safe failure codes map explicitly and unknown values remain bounded", () => {
    expect(mapNativeVideoManagementAttention(null)).toBeNull();
    expect(mapNativeVideoManagementAttention("provider_upload_expired")).toBe(
      "upload_expired",
    );
    expect(
      mapNativeVideoManagementAttention("provider_upload_capability_expired"),
    ).toBe("upload_expired");
    expect(mapNativeVideoManagementAttention("upload_reservation_expired")).toBe(
      "upload_expired",
    );
    expect(mapNativeVideoManagementAttention("provider_creation_failed")).toBe(
      "processing_failed",
    );
    expect(mapNativeVideoManagementAttention("provider_processing_failed")).toBe(
      "processing_failed",
    );
    expect(mapNativeVideoManagementAttention("future_bounded_code")).toBe(
      "needs_review",
    );
  });

  test("list adapter invokes only the exact projection RPC and arguments", async () => {
    const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
    const database = createNativeVideoManagementDatabase(
      fakeClient(async (name, args) => {
        calls.push({ args, name });
        return { data: rawProjection(), error: null };
      }),
    );
    const page = await database.listAssets({
      actorUserId,
      cursor: { assetId, createdAt },
      limit: 25,
      tenantId,
    });

    expect(calls).toEqual([
      {
        args: {
          p_actor_user_id: actorUserId,
          p_asset_id: null,
          p_cursor_asset_id: assetId,
          p_cursor_created_at: createdAt,
          p_limit: 25,
          p_tenant_id: tenantId,
        },
        name: "get_native_video_management_projection_server",
      },
    ]);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  test("exact route validates UUIDs, binds actor and returns one normalized item", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handleNativeVideoExactAssetRequest(
      authorizedRequest(
        `/api/video/assets/${assetId.toUpperCase()}?tenantId=${tenantId.toUpperCase()}`,
      ),
      exactContext(assetId.toUpperCase()),
      {
        authenticate: async () => ({ id: actorUserId }),
        getAsset: async (input) => {
          calls.push(input);
          return normalizeNativeVideoManagementProjection(rawProjection("exact"), {
            limit: 1,
            mode: "exact",
          }).items[0] ?? null;
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([{ actorUserId, assetId, tenantId }]);
    expect(Object.keys((await json(response)).asset as object).sort()).toEqual([
      "assetId",
      "attachments",
      "attention",
      "createdAt",
      "deleteRequestedAt",
      "durationSeconds",
      "filename",
      "reservedSeconds",
      "status",
      "updatedAt",
    ]);
  });

  test("exact adapter always uses p_limit one and null cursor arguments", async () => {
    const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
    const database = createNativeVideoManagementDatabase(
      fakeClient(async (name, args) => {
        calls.push({ args, name });
        return { data: rawProjection("exact"), error: null };
      }),
    );
    const asset = await database.getAsset({ actorUserId, assetId, tenantId });
    expect(asset?.assetId).toBe(assetId);
    expect(calls).toEqual([
      {
        args: {
          p_actor_user_id: actorUserId,
          p_asset_id: assetId,
          p_cursor_asset_id: null,
          p_cursor_created_at: null,
          p_limit: 1,
          p_tenant_id: tenantId,
        },
        name: "get_native_video_management_projection_server",
      },
    ]);
  });

  test("exact adapter rejects a projection for a different asset", async () => {
    const database = createNativeVideoManagementDatabase(
      fakeClient(async () => ({
        data: rawProjection("exact", {
          items: [
            rawAsset({ asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
          ],
        }),
        error: null,
      })),
    );
    await expect(
      database.getAsset({ actorUserId, assetId, tenantId }),
    ).rejects.toMatchObject({
      code: "VIDEO_MANAGEMENT_PROJECTION_INVALID",
      status: 500,
    });
  });

  test("exact route returns safe 400, 404 and projection-invalid 500", async () => {
    const invalid = await handleNativeVideoExactAssetRequest(
      authorizedRequest(`/api/video/assets/invalid?tenantId=${tenantId}`),
      exactContext("invalid"),
      { authenticate: async () => ({ id: actorUserId }) },
    );
    expect(invalid.status).toBe(400);

    const invalidTenant = await handleNativeVideoExactAssetRequest(
      authorizedRequest(`/api/video/assets/${assetId}?tenantId=invalid`),
      exactContext(),
      { authenticate: async () => ({ id: actorUserId }) },
    );
    expect(invalidTenant.status).toBe(400);

    const missing = await handleNativeVideoExactAssetRequest(
      authorizedRequest(`/api/video/assets/${assetId}?tenantId=${tenantId}`),
      exactContext(),
      {
        authenticate: async () => ({ id: actorUserId }),
        getAsset: async () => null,
      },
    );
    expect(missing.status).toBe(404);
    expect((await json(missing)).code).toBe("VIDEO_NOT_FOUND");

    const malformed = await handleNativeVideoExactAssetRequest(
      authorizedRequest(`/api/video/assets/${assetId}?tenantId=${tenantId}`),
      exactContext(),
      {
        authenticate: async () => ({ id: actorUserId }),
        getAsset: async () => {
          normalizeNativeVideoManagementProjection(
            rawProjection("exact", { items: [rawAsset({ status: "unknown" })] }),
            { limit: 1, mode: "exact" },
          );
          return null;
        },
      },
    );
    expect(malformed.status).toBe(500);
    expect(await json(malformed)).toEqual({
      code: "VIDEO_MANAGEMENT_PROJECTION_INVALID",
      error: "Video management information is temporarily unavailable.",
    });
  });

  test("empty exact projection normalizes to null through the adapter", async () => {
    const database = createNativeVideoManagementDatabase(
      fakeClient(async () => ({
        data: rawProjection("exact", { items: [] }),
        error: null,
      })),
    );
    await expect(database.getAsset({ actorUserId, assetId, tenantId })).resolves.toBeNull();
  });

  test("capacity route binds actor and returns only strict customer fields", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const capacity = normalizeNativeVideoCapacity(rawCapacity());
    const response = await handleNativeVideoCapacityRequest(
      authorizedRequest(`/api/video/capacity?tenantId=${tenantId.toUpperCase()}`),
      {
        authenticate: async () => ({ id: actorUserId }),
        getCapacity: async (input) => {
          calls.push(input);
          return capacity;
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([{ actorUserId, tenantId }]);
    const body = await json(response);
    expect(body).toEqual({ capacity });
    expect(JSON.stringify(body)).not.toContain("base_capacity_minutes");
  });

  test("capacity adapter calls only the existing capacity RPC", async () => {
    const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
    const database = createNativeVideoManagementDatabase(
      fakeClient(async (name, args) => {
        calls.push({ args, name });
        return { data: rawCapacity(), error: null };
      }),
    );
    const capacity = await database.getCapacity({ actorUserId, tenantId });
    expect(capacity.capacityState).toBe("normal");
    expect(calls).toEqual([
      {
        args: { p_actor_user_id: actorUserId, p_tenant_id: tenantId },
        name: "get_native_video_capacity_server",
      },
    ]);
  });

  test("exact-item and capacity reads require authentication", async () => {
    let exactCalls = 0;
    const exact = await handleNativeVideoExactAssetRequest(
      new Request(
        `https://coachfort.test/api/video/assets/${assetId}?tenantId=${tenantId}`,
      ),
      exactContext(),
      {
        getAsset: async () => {
          exactCalls += 1;
          return null;
        },
      },
    );
    expect(exact.status).toBe(401);
    expect(exact.headers.get("cache-control")).toBe("private, no-store");

    let capacityCalls = 0;
    const capacity = await handleNativeVideoCapacityRequest(
      new Request(`https://coachfort.test/api/video/capacity?tenantId=${tenantId}`),
      {
        getCapacity: async () => {
          capacityCalls += 1;
          return normalizeNativeVideoCapacity(rawCapacity());
        },
      },
    );
    expect(capacity.status).toBe(401);
    expect(capacity.headers.get("cache-control")).toBe("private, no-store");
    expect(exactCalls).toBe(0);
    expect(capacityCalls).toBe(0);
  });

  test("capacity rejects malformed output and invalid query without raw leakage", async () => {
    expect(() =>
      normalizeNativeVideoCapacity(rawCapacity({ capacity_state: "internal" })),
    ).toThrow(NativeVideoManagementPublicError);

    const invalid = await handleNativeVideoCapacityRequest(
      authorizedRequest(
        `/api/video/capacity?tenantId=${tenantId}&providerAssetId=private`,
      ),
      {
        authenticate: async () => ({ id: actorUserId }),
        getCapacity: async () => normalizeNativeVideoCapacity(rawCapacity()),
      },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");
  });

  test("Owner/Admin success delegates role truth while denied actors remain sanitized", async () => {
    for (const role of ["owner", "admin"]) {
      const response = await handleNativeVideoInventoryRequest(
        authorizedRequest(`/api/video/assets?tenantId=${tenantId}`),
        {
          authenticate: async () => ({ id: `${role}-user` }),
          listAssets: async () => ({ items: [], nextCursor: null }),
        },
      );
      expect(response.status).toBe(200);
    }

    for (const actor of [
      "staff",
      "trainer",
      "student",
      "platform-owner",
      "cross-tenant-owner",
    ]) {
      const database = createNativeVideoManagementDatabase(
        fakeClient(async () => ({
          data: null,
          error: { code: "42501", message: `private ${actor} detail` },
        })),
      );
      const response = await handleNativeVideoInventoryRequest(
        authorizedRequest(`/api/video/assets?tenantId=${tenantId}`),
        {
          authenticate: async () => ({ id: `${actor}-user` }),
          listAssets: (input) => database.listAssets(input),
        },
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await json(response);
      expect(body.code).toBe("VIDEO_MANAGEMENT_FORBIDDEN");
      expect(JSON.stringify(body)).not.toContain(`private ${actor} detail`);
    }
  });

  test("capacity preserves canonical unavailable and forbidden distinctions", async () => {
    for (const scenario of [
      {
        code: "VIDEO_MANAGEMENT_FORBIDDEN",
        message: "Native video access denied.",
        status: 403,
      },
      {
        code: "VIDEO_CAPACITY_UNAVAILABLE",
        message: "Native video capacity authority is unavailable.",
        status: 503,
      },
    ]) {
      const database = createNativeVideoManagementDatabase(
        fakeClient(async () => ({
          data: null,
          error: { code: "42501", message: scenario.message },
        })),
      );
      const response = await handleNativeVideoCapacityRequest(
        authorizedRequest(`/api/video/capacity?tenantId=${tenantId}`),
        {
          authenticate: async () => ({ id: actorUserId }),
          getCapacity: (input) => database.getCapacity(input),
        },
      );
      expect(response.status).toBe(scenario.status);
      expect((await json(response)).code).toBe(scenario.code);
    }
  });

  test("all bounded GET errors use no-store and synthetic public errors", async () => {
    for (const error of [
      new NativeVideoManagementPublicError(
        "VIDEO_MANAGEMENT_FORBIDDEN",
        "You do not have permission to view this video information.",
        403,
      ),
      new NativeVideoManagementPublicError(
        "VIDEO_MANAGEMENT_UNAVAILABLE",
        "Video management information is temporarily unavailable.",
        500,
      ),
      new NativeVideoManagementPublicError(
        "VIDEO_CAPACITY_UNAVAILABLE",
        "Video capacity information is temporarily unavailable.",
        503,
      ),
    ]) {
      const response = await handleNativeVideoInventoryRequest(
        authorizedRequest(`/api/video/assets?tenantId=${tenantId}`),
        {
          authenticate: async () => ({ id: actorUserId }),
          listAssets: async () => {
            throw error;
          },
        },
      );
      expect(response.status).toBe(error.status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await json(response)).toEqual({
        code: error.code,
        error: error.message,
      });
    }
  });

  test("source delegates authority without direct tables, lifecycle, feature or provider logic", () => {
    const adapter = read("src/lib/server/video/nativeVideoManagement.ts");
    const listRoute = read("app/api/video/assets/route.ts");
    const exactRoute = read("app/api/video/assets/[assetId]/route.ts");
    const capacityRoute = read("app/api/video/capacity/route.ts");
    const getSection = exactRoute.slice(
      exactRoute.indexOf("export async function handleNativeVideoExactAssetRequest"),
      exactRoute.indexOf("export async function handleNativeVideoDeletionRequest"),
    );

    expect(adapter).toContain("get_native_video_management_projection_server");
    expect(adapter).toContain("get_native_video_capacity_server");
    expect(adapter).not.toMatch(/\.from\(["']video_assets["']\)/);
    expect(adapter).not.toMatch(/\.from\(["']video_asset_attachments["']\)/);
    expect(adapter).not.toContain("assert_tenant_operational_access");
    expect(adapter).not.toContain("assert_effective_operational_feature");
    expect(adapter).not.toContain("cloudflareStream");
    expect(`${listRoute}\n${getSection}\n${capacityRoute}`).not.toContain(
      "providerAssetId",
    );
    expect(`${listRoute}\n${getSection}\n${capacityRoute}`).not.toContain(
      "captureServerException(error",
    );
  });

  test("existing DELETE route remains bound to canonical deletion authority", async () => {
    const route = read("app/api/video/assets/[assetId]/route.ts");
    expect(route).toContain('admin.rpc("request_native_video_deletion_server"');
    expect(route).toContain("export async function DELETE");

    const response = await handleNativeVideoDeletionRequest(
      new Request(`https://coachfort.test/api/video/assets/${assetId}`, {
        body: JSON.stringify({ tenantId }),
        headers: {
          Authorization: "Bearer approved-user-token",
          "Content-Type": "application/json",
        },
        method: "DELETE",
      }),
      exactContext(),
      {
        authenticate: async () => ({ id: actorUserId }),
        requestDeletion: async () => ({
          data: { asset_id: assetId, status: "delete_pending" },
          error: null,
        }),
      },
    );
    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({ assetId, status: "delete_pending" });
  });
});
