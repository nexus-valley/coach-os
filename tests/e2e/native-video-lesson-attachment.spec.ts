import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  handleNativeVideoLessonAttachmentDelete,
  handleNativeVideoLessonAttachmentPut,
} from "../../app/api/video/lessons/[lessonId]/native-video/route";
import {
  createNativeVideoLessonAttachmentDatabase,
  type NativeVideoLessonAttachmentDatabase,
} from "../../src/lib/server/video/nativeVideoLessonAttachment";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const routePath = "app/api/video/lessons/[lessonId]/native-video/route.ts";
const adapterPath = "src/lib/server/video/nativeVideoLessonAttachment.ts";
const authorityPath = "supabase/bundle_video_2a_native_video_authority.sql";
const tenantId = "11111111-1111-4111-8111-111111111111";
const lessonId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";
const attachmentId = "44444444-4444-4444-8444-444444444444";
const actorUserId = "55555555-5555-4555-8555-555555555555";

function context(id = lessonId) {
  return { params: Promise.resolve({ lessonId: id }) };
}

function request(method: "DELETE" | "PUT", body: Record<string, unknown>) {
  return new Request(
    `https://coachfort.test/api/video/lessons/${lessonId}/native-video`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: "Bearer approved-user-token",
        "Content-Type": "application/json",
      },
      method,
    },
  );
}

function database(
  overrides: Partial<NativeVideoLessonAttachmentDatabase> = {},
): NativeVideoLessonAttachmentDatabase {
  return {
    async attach(input) {
      return {
        lessonId: input.lessonId,
        status: "attached",
        videoAssetId: input.assetId,
      };
    },
    async detach(input) {
      return { lessonId: input.lessonId, status: "detached" };
    },
    ...overrides,
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test.describe("VIDEO-2C1A native-video lesson attachment bridge", () => {
  test("1. PUT binds the authenticated actor and canonicalizes all UUID inputs", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handleNativeVideoLessonAttachmentPut(
      request("PUT", {
        assetId: assetId.toUpperCase(),
        tenantId: tenantId.toUpperCase(),
      }),
      context(lessonId.toUpperCase()),
      {
        authenticate: async () => ({ id: actorUserId }),
        database: database({
          async attach(input) {
            calls.push(input);
            return { lessonId, status: "attached", videoAssetId: assetId };
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(response)).toEqual({
      lessonId,
      status: "attached",
      videoAssetId: assetId,
    });
    expect(calls).toEqual([{ actorUserId, assetId, lessonId, tenantId }]);
  });

  test("2. DELETE binds the actor, canonicalizes UUIDs and returns idempotent cleanup", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handleNativeVideoLessonAttachmentDelete(
      request("DELETE", { tenantId: tenantId.toUpperCase() }),
      context(lessonId.toUpperCase()),
      {
        authenticate: async () => ({ id: actorUserId }),
        database: database({
          async detach(input) {
            calls.push(input);
            return { lessonId, status: "detached" };
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(response)).toEqual({ lessonId, status: "detached" });
    expect(calls).toEqual([{ actorUserId, lessonId, tenantId }]);
  });

  test("3. both methods require authentication before database authority", async () => {
    let calls = 0;
    const noAuthentication = (method: "DELETE" | "PUT") =>
      new Request(
        `https://coachfort.test/api/video/lessons/${lessonId}/native-video`,
        {
          body: JSON.stringify(
            method === "PUT" ? { assetId, tenantId } : { tenantId },
          ),
          headers: { "Content-Type": "application/json" },
          method,
        },
      );
    const guardedDatabase = database({
      async attach() {
        calls += 1;
        throw new Error("must not run");
      },
      async detach() {
        calls += 1;
        throw new Error("must not run");
      },
    });

    const put = await handleNativeVideoLessonAttachmentPut(
      noAuthentication("PUT"),
      context(),
      { database: guardedDatabase },
    );
    const remove = await handleNativeVideoLessonAttachmentDelete(
      noAuthentication("DELETE"),
      context(),
      { database: guardedDatabase },
    );

    expect(put.status).toBe(401);
    expect(remove.status).toBe(401);
    expect(put.headers.get("cache-control")).toBe("private, no-store");
    expect(remove.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toBe(0);
  });

  test("4. exact PUT and DELETE bodies reject invalid UUIDs and authority-bearing fields", async () => {
    const putScenarios = [
      { body: { assetId: "invalid", tenantId }, id: lessonId },
      { body: { assetId, tenantId: "invalid" }, id: lessonId },
      { body: { assetId, tenantId }, id: "invalid" },
      { body: { actorUserId, assetId, tenantId }, id: lessonId },
      { body: { assetId, providerAssetId: "provider", tenantId }, id: lessonId },
      { body: { assetId, courseId: assetId, tenantId }, id: lessonId },
      { body: { assetId, lifecycle: "active", tenantId }, id: lessonId },
      { body: { assetId, replacement: true, tenantId }, id: lessonId },
    ];
    const deleteScenarios = [
      { body: { tenantId: "invalid" }, id: lessonId },
      { body: { tenantId }, id: "invalid" },
      { body: { actorUserId, tenantId }, id: lessonId },
      { body: { assetId, tenantId }, id: lessonId },
      { body: { providerUid: "provider", tenantId }, id: lessonId },
    ];
    let calls = 0;
    const guardedDatabase = database({
      async attach() {
        calls += 1;
        throw new Error("must not run");
      },
      async detach() {
        calls += 1;
        throw new Error("must not run");
      },
    });

    for (const scenario of putScenarios) {
      const response = await handleNativeVideoLessonAttachmentPut(
        request("PUT", scenario.body),
        context(scenario.id),
        {
          authenticate: async () => ({ id: actorUserId }),
          database: guardedDatabase,
        },
      );
      expect(response.status).toBe(400);
    }
    for (const scenario of deleteScenarios) {
      const response = await handleNativeVideoLessonAttachmentDelete(
        request("DELETE", scenario.body),
        context(scenario.id),
        {
          authenticate: async () => ({ id: actorUserId }),
          database: guardedDatabase,
        },
      );
      expect(response.status).toBe(400);
    }
    expect(calls).toBe(0);
  });

  test("5. malformed JSON is rejected without invoking either authority", async () => {
    let calls = 0;
    const malformed = (method: "DELETE" | "PUT") =>
      new Request(
        `https://coachfort.test/api/video/lessons/${lessonId}/native-video`,
        {
          body: "{",
          headers: {
            Authorization: "Bearer approved-user-token",
            "Content-Type": "application/json",
          },
          method,
        },
      );
    const guardedDatabase = database({
      async attach() {
        calls += 1;
        throw new Error("must not run");
      },
      async detach() {
        calls += 1;
        throw new Error("must not run");
      },
    });

    expect(
      (
        await handleNativeVideoLessonAttachmentPut(malformed("PUT"), context(), {
          authenticate: async () => ({ id: actorUserId }),
          database: guardedDatabase,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handleNativeVideoLessonAttachmentDelete(
          malformed("DELETE"),
          context(),
          {
            authenticate: async () => ({ id: actorUserId }),
            database: guardedDatabase,
          },
        )
      ).status,
    ).toBe(400);
    expect(calls).toBe(0);
  });

  test("6. database adapter calls exactly the canonical attach and detach RPCs", async () => {
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    const client = {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        return name === "attach_native_video_to_lesson_server"
          ? {
              data: {
                attachment_id: attachmentId,
                lesson_id: lessonId,
                video_asset_id: assetId,
              },
              error: null,
            }
          : { data: { detached: false }, error: null };
      },
    } as unknown as SupabaseClient;
    const adapter = createNativeVideoLessonAttachmentDatabase(client);

    await expect(
      adapter.attach({ actorUserId, assetId, lessonId, tenantId }),
    ).resolves.toEqual({ lessonId, status: "attached", videoAssetId: assetId });
    await expect(
      adapter.detach({ actorUserId, lessonId, tenantId }),
    ).resolves.toEqual({ lessonId, status: "detached" });
    expect(calls).toEqual([
      {
        name: "attach_native_video_to_lesson_server",
        parameters: {
          p_actor_user_id: actorUserId,
          p_asset_id: assetId,
          p_lesson_id: lessonId,
          p_tenant_id: tenantId,
        },
      },
      {
        name: "detach_native_video_from_lesson_server",
        parameters: {
          p_actor_user_id: actorUserId,
          p_lesson_id: lessonId,
          p_tenant_id: tenantId,
        },
      },
    ]);
  });

  test("7. attach replacement and detach replay preserve canonical RPC behavior", async () => {
    const client = {
      async rpc(name: string) {
        return name === "attach_native_video_to_lesson_server"
          ? {
              data: {
                attachment_id: attachmentId,
                lesson_id: lessonId,
                video_asset_id: assetId,
              },
              error: null,
            }
          : { data: { detached: false }, error: null };
      },
    } as unknown as SupabaseClient;
    const adapter = createNativeVideoLessonAttachmentDatabase(client);

    expect(
      await adapter.attach({ actorUserId, assetId, lessonId, tenantId }),
    ).toEqual({ lessonId, status: "attached", videoAssetId: assetId });
    expect(await adapter.detach({ actorUserId, lessonId, tenantId })).toEqual({
      lessonId,
      status: "detached",
    });
  });

  test("8. SQL denials and conflicts are sanitized without direct-table fallback", async () => {
    for (const [code, status] of [
      ["42501", 403],
      ["02000", 404],
      ["PGRST116", 404],
      ["22023", 409],
      ["XX000", 500],
    ] as const) {
      const client = {
        async rpc() {
          return { data: null, error: { code, message: "private SQL detail" } };
        },
      } as unknown as SupabaseClient;
      const adapter = createNativeVideoLessonAttachmentDatabase(client);
      await expect(
        adapter.attach({ actorUserId, assetId, lessonId, tenantId }),
      ).rejects.toMatchObject({ status });
      await expect(
        adapter.detach({ actorUserId, lessonId, tenantId }),
      ).rejects.toMatchObject({ status });
    }

    const conflictClient = {
      async rpc() {
        return {
          data: null,
          error: {
            code: "22023",
            message: "Remove the external video before attaching native video.",
          },
        };
      },
    } as unknown as SupabaseClient;
    await expect(
      createNativeVideoLessonAttachmentDatabase(conflictClient).attach({
        actorUserId,
        assetId,
        lessonId,
        tenantId,
      }),
    ).rejects.toMatchObject({
      message: "Remove the external video before attaching a native video.",
      status: 409,
    });
  });

  test("9. canonical denials and failures retain safe status and no-store", async () => {
    for (const status of [403, 404, 409, 500]) {
      const response = await handleNativeVideoLessonAttachmentPut(
        request("PUT", { assetId, tenantId }),
        context(),
        {
          authenticate: async () => ({ id: actorUserId }),
          database: database({
            async attach() {
              const client = {
                async rpc() {
                  const code =
                    status === 403
                      ? "42501"
                      : status === 404
                        ? "02000"
                        : status === 409
                          ? "22023"
                          : "XX000";
                  return { data: null, error: { code, message: "private" } };
                },
              } as unknown as SupabaseClient;
              return createNativeVideoLessonAttachmentDatabase(client).attach({
                actorUserId,
                assetId,
                lessonId,
                tenantId,
              });
            },
          }),
        },
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(JSON.stringify(await json(response))).not.toContain("private");
    }
  });

  test("10. malformed attach and detach authority outputs fail closed", async () => {
    const malformedAttach = {
      async rpc() {
        return {
          data: {
            attachment_id: attachmentId,
            lesson_id: lessonId,
            video_asset_id: tenantId,
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;
    const malformedDetach = {
      async rpc() {
        return { data: { detached: "false" }, error: null };
      },
    } as unknown as SupabaseClient;

    await expect(
      createNativeVideoLessonAttachmentDatabase(malformedAttach).attach({
        actorUserId,
        assetId,
        lessonId,
        tenantId,
      }),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      createNativeVideoLessonAttachmentDatabase(malformedDetach).detach({
        actorUserId,
        lessonId,
        tenantId,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  test("11. route and adapter use only canonical service RPCs with no provider or table authority", () => {
    const route = read(routePath);
    const adapter = read(adapterPath);
    const combined = `${route}\n${adapter}`;
    expect(route).toContain("getBearerToken(request)");
    expect(route).toContain("actorUserId: user.id");
    expect(route).toContain("Object.keys(body).length !== 2");
    expect(route).toContain("Object.keys(body).length !== 1");
    expect(adapter.match(/\.rpc\(/g)).toHaveLength(2);
    expect(adapter).toContain('"attach_native_video_to_lesson_server"');
    expect(adapter).toContain('"detach_native_video_from_lesson_server"');
    expect(combined).not.toMatch(/\.from\(["'](?:video_assets|video_asset_attachments)/);
    expect(combined).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(combined).not.toMatch(/cloudflare|provider_asset|provider uid/i);
    expect(combined).not.toContain("assert_tenant_operational_access");
    expect(combined).not.toContain("assert_effective_operational_feature");
  });

  test("12. installed SQL preserves replacement, attach gates and cleanup-after-inactivity semantics", () => {
    const sql = read(authorityPath).toLowerCase();
    const attachStart = sql.indexOf(
      "create function public.attach_native_video_to_lesson_server",
    );
    const detachStart = sql.indexOf(
      "create function public.detach_native_video_from_lesson_server",
      attachStart,
    );
    const nextStart = sql.indexOf(
      "create function public.request_native_video_deletion_server",
      detachStart,
    );
    const attach = sql.slice(attachStart, detachStart);
    const detach = sql.slice(detachStart, nextStart);

    expect(attach).toContain("assert_native_video_owner_admin");
    expect(attach).toContain("assert_tenant_operational_access");
    expect(attach).toContain("assert_effective_operational_feature");
    expect(attach).toContain("v_asset.status <> 'ready'");
    expect(attach).toContain("v_lesson.video_url is not null");
    expect(attach).toContain("on conflict (lesson_id) do update");
    expect(detach).toContain("assert_native_video_owner_admin");
    expect(detach).toContain("delete from public.video_asset_attachments");
    expect(detach).toContain("jsonb_build_object('detached', v_deleted = 1)");
    expect(detach).not.toContain("assert_tenant_operational_access");
    expect(detach).not.toContain("assert_effective_operational_feature");
    expect(sql).toContain(
      "grant execute on function public.attach_native_video_to_lesson_server(uuid,uuid,uuid,uuid)\n  to service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.detach_native_video_from_lesson_server(uuid,uuid,uuid)\n  to service_role",
    );
  });

  test("13. sanitized 500 authority failures log only the safe public code", async () => {
    const monitored: Array<{
      context?: Record<string, unknown>;
      error: unknown;
    }> = [];
    const privateMessage = "private SQL function detail must not be logged";
    const client = {
      async rpc() {
        return {
          data: null,
          error: { code: "XX000", message: privateMessage },
        };
      },
    } as unknown as SupabaseClient;
    const response = await handleNativeVideoLessonAttachmentPut(
      request("PUT", { assetId, tenantId }),
      context(),
      {
        authenticate: async () => ({ id: actorUserId }),
        captureException(error, monitoringContext) {
          monitored.push({ context: monitoringContext, error });
        },
        database: createNativeVideoLessonAttachmentDatabase(client),
      },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(response)).toEqual({
      code: "VIDEO_LESSON_ATTACHMENT_FAILED",
      error: "The lesson video could not be updated.",
    });
    expect(monitored).toHaveLength(1);
    expect(monitored[0]?.error).toBeInstanceOf(Error);
    expect((monitored[0]?.error as Error).message).toBe(
      "VIDEO_LESSON_ATTACHMENT_FAILED",
    );
    expect(monitored[0]?.context).toEqual({
      lessonId,
      operation: "native_video_lesson_attachment_put",
      route: "/api/video/lessons/[lessonId]/native-video",
      tenantId,
    });
    expect(JSON.stringify(monitored)).not.toContain(privateMessage);
  });

  test("14. unexpected failures log only a fixed synthetic identifier", async () => {
    const monitored: Array<{
      context?: Record<string, unknown>;
      error: unknown;
    }> = [];
    const privateMessage = "private database runtime message must not be logged";
    const response = await handleNativeVideoLessonAttachmentDelete(
      request("DELETE", { tenantId }),
      context(),
      {
        authenticate: async () => ({ id: actorUserId }),
        captureException(error, monitoringContext) {
          monitored.push({ context: monitoringContext, error });
        },
        database: database({
          async detach() {
            throw new Error(privateMessage);
          },
        }),
      },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(response)).toEqual({
      code: "VIDEO_LESSON_ATTACHMENT_FAILED",
      error: "The lesson video could not be updated.",
    });
    expect(monitored).toHaveLength(1);
    expect(monitored[0]?.error).toBeInstanceOf(Error);
    expect((monitored[0]?.error as Error).message).toBe(
      "VIDEO_LESSON_ATTACHMENT_UNEXPECTED",
    );
    expect(monitored[0]?.context).toEqual({
      lessonId,
      operation: "native_video_lesson_attachment_delete",
      route: "/api/video/lessons/[lessonId]/native-video",
      tenantId,
    });
    expect(JSON.stringify(monitored)).not.toContain(privateMessage);
  });
});
