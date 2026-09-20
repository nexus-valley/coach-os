import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CloudflareStreamPlaybackConfigurationError,
  getCloudflareStreamFrameSources,
  normalizeCloudflareStreamCustomerCode,
} from "../../src/lib/server/video/cloudflareStreamConfig";
import { getExternalVideoPresentation } from "../../src/lib/video/externalVideo";
import {
  getNativePlaybackErrorState,
  parseNativePlaybackDescriptor,
  requestNativeLessonPlayback,
} from "../../src/lib/video/nativeVideoPlaybackClient";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const tenantId = "11111111-1111-4111-8111-111111111111";
const lessonId = "22222222-2222-4222-8222-222222222222";
const nowMilliseconds = Date.parse("2027-01-15T08:00:00.000Z");
const playbackUrl =
  "https://customer-example-code.cloudflarestream.com/signed.playback.token/iframe";

const playerPath = "src/components/video/LessonVideoPlayer.tsx";
const externalPath = "src/lib/video/externalVideo.ts";
const coursePath = "src/components/courses/CourseDetailClient.tsx";
const configPath = "src/lib/server/video/cloudflareStreamConfig.ts";
const nextConfigPath = "next.config.ts";

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    durationSeconds: 900,
    lessonId,
    playback: {
      expiresAt: "2027-01-15T08:30:00.000Z",
      kind: "native_video",
      mode: "iframe",
      url: playbackUrl,
    },
    ...overrides,
  };
}

test.describe("VIDEO-2C2A team native-video player", () => {
  test("1. native candidate renders an explicit action without minting on render", () => {
    const source = read(playerPath);
    expect(source).toContain('{ kind: "idle" }');
    expect(source).toContain("Play video");
    const mountEffect = source.slice(
      source.indexOf("useEffect(() =>"),
      source.indexOf("async function loadNativeVideo"),
    );
    expect(mountEffect).not.toContain("requestNativeLessonPlayback");
  });

  test("2. playback request uses one POST, the current bearer, and tenantId only", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return Response.json(descriptor());
    };

    const result = await requestNativeLessonPlayback(
      { lessonId, tenantId },
      {
        fetchImpl,
        getAccessToken: async () => "current-session-token",
        nowMilliseconds,
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(
      `/api/video/lessons/${lessonId}/playback`,
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.cache).toBe("no-store");
    expect(calls[0].init?.headers).toEqual({
      Authorization: "Bearer current-session-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ tenantId });
    expect(result.playback.url).toBe(playbackUrl);
  });

  test("3. missing current session fails as 401 before fetch", async () => {
    let fetchCount = 0;
    await expect(
      requestNativeLessonPlayback(
        { lessonId, tenantId },
        {
          fetchImpl: async () => {
            fetchCount += 1;
            return Response.json(descriptor());
          },
          getAccessToken: async () => null,
        },
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchCount).toBe(0);
  });

  test("4. descriptor validation accepts only the requested lesson and safe future Stream iframe", () => {
    expect(
      parseNativePlaybackDescriptor(
        descriptor(),
        lessonId,
        nowMilliseconds,
      ),
    ).not.toBeNull();

    const invalidValues = [
      descriptor({ lessonId: tenantId }),
      descriptor({ durationSeconds: 0 }),
      descriptor({ playback: null }),
      descriptor({
        playback: {
          ...descriptor().playback,
          expiresAt: "2027-01-15T07:59:59.000Z",
        },
      }),
      descriptor({
        playback: { ...descriptor().playback, kind: "download" },
      }),
      descriptor({
        playback: { ...descriptor().playback, mode: "hls" },
      }),
      descriptor({
        playback: { ...descriptor().playback, url: "http://example.com/iframe" },
      }),
      descriptor({
        playback: {
          ...descriptor().playback,
          url: "https://example.com/token/iframe",
        },
      }),
      descriptor({
        playback: {
          ...descriptor().playback,
          url: "https://customer-code.cloudflarestream.com/token/watch",
        },
      }),
    ];

    for (const value of invalidValues) {
      expect(
        parseNativePlaybackDescriptor(
          value,
          lessonId,
          nowMilliseconds,
        ),
      ).toBeNull();
    }
  });

  test("5. malformed success response fails closed", async () => {
    await expect(
      requestNativeLessonPlayback(
        { lessonId, tenantId },
        {
          fetchImpl: async () => Response.json({ playback: {} }),
          getAccessToken: async () => "current-session-token",
          nowMilliseconds,
        },
      ),
    ).rejects.toMatchObject({ status: 500 });
  });

  test("6. HTTP failures remain status-only and retries perform fresh requests", async () => {
    let attempt = 0;
    const fetchImpl: typeof fetch = async () => {
      attempt += 1;
      return attempt === 1
        ? Response.json({ private: "database detail" }, { status: 503 })
        : Response.json(descriptor());
    };
    const options = {
      fetchImpl,
      getAccessToken: async () => "current-session-token",
      nowMilliseconds,
    };

    await expect(
      requestNativeLessonPlayback({ lessonId, tenantId }, options),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      requestNativeLessonPlayback({ lessonId, tenantId }, options),
    ).resolves.toMatchObject({ lessonId });
    expect(attempt).toBe(2);
  });

  test("7. safe customer messages cover current playback statuses", () => {
    expect(getNativePlaybackErrorState(401)).toEqual({
      message: "Your session has expired. Sign in again.",
      retryable: false,
    });
    expect(getNativePlaybackErrorState(403).message).toBe(
      "Video playback is not available for your account.",
    );
    expect(getNativePlaybackErrorState(404)).toEqual({
      message: "No video has been added to this lesson.",
      retryable: false,
    });
    for (const status of [409, 500, 502, 503]) {
      expect(getNativePlaybackErrorState(status).retryable).toBe(true);
    }
  });

  test("8. abort signal is forwarded to the playback request", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    const request = requestNativeLessonPlayback(
      { lessonId, tenantId },
      {
        fetchImpl: async (_input, init) => {
          receivedSignal = init?.signal;
          return Response.json(descriptor());
        },
        getAccessToken: async () => "current-session-token",
        nowMilliseconds,
        signal: controller.signal,
      },
    );
    await request;
    expect(receivedSignal).toBe(controller.signal);
  });

  test("9. native iframe contract is accessible, responsive, and does not autoplay", () => {
    const source = read(playerPath);
    expect(source).toContain('allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"');
    expect(source).toContain("allowFullScreen");
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(source).toContain('className="aspect-video');
    expect(source).toContain("title={`${lessonTitle} video`}");
    expect(source).not.toContain("autoplay=true");
    expect(source).not.toContain("sandbox=");
  });

  test("10. capability is component-state-only and unmount cleanup aborts work", () => {
    const source = read(playerPath);
    expect(source).toContain("requestRef.current?.abort()");
    expect(source).toContain('setState({ descriptor, kind: "ready" })');
    expect(source).not.toContain("playbackUrlRef");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("captureServerException");
    expect(source).not.toContain("data-playback");
  });

  test("11. every media identity change remounts an idle player without minting", () => {
    const source = read(playerPath);
    const identityStart = source.indexOf("const mediaIdentity = JSON.stringify([");
    const identityEnd = source.indexOf("]);", identityStart);
    const identityContract = source.slice(identityStart, identityEnd);

    expect(identityStart).toBeGreaterThan(-1);
    expect(identityContract).toContain("props.tenantId");
    expect(identityContract).toContain("props.lessonId");
    expect(identityContract).toContain("props.externalVideoUrl");
    expect(source).toContain(
      "<LessonVideoPlayerForIdentity key={mediaIdentity} {...props} />",
    );

    const identityPlayer = source.slice(
      source.indexOf("function LessonVideoPlayerForIdentity"),
      source.indexOf("export function LessonVideoPlayer"),
    );
    expect(identityPlayer).toContain('useState<PlayerState>({ kind: "idle" })');
    expect(identityPlayer).toContain("requestRef.current?.abort()");
    expect(identityPlayer).toContain("requestRef.current = null");

    const mountEffect = identityPlayer.slice(
      identityPlayer.indexOf("useEffect(() =>"),
      identityPlayer.indexOf("async function loadNativeVideo"),
    );
    expect(mountEffect).not.toContain("requestNativeLessonPlayback");
  });
});

test.describe("VIDEO-2C2A external-video presentation", () => {
  test("12. canonical YouTube variants use the privacy-enhanced embed host", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/embed/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
    ]) {
      expect(getExternalVideoPresentation(url)).toEqual({
        embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        kind: "embed",
        provider: "youtube",
      });
    }
  });

  test("13. canonical Vimeo variants use player.vimeo.com", () => {
    for (const url of [
      "https://vimeo.com/123456789",
      "https://www.vimeo.com/123456789",
      "https://player.vimeo.com/video/123456789",
    ]) {
      expect(getExternalVideoPresentation(url)).toEqual({
        embedUrl: "https://player.vimeo.com/video/123456789",
        kind: "embed",
        provider: "vimeo",
      });
    }
  });

  test("14. approved unsupported paths fall back to links rather than arbitrary iframes", () => {
    expect(
      getExternalVideoPresentation("https://youtube.com/@coachfort/videos"),
    ).toEqual({
      href: "https://youtube.com/@coachfort/videos",
      kind: "link",
      provider: "youtube",
    });
    expect(
      getExternalVideoPresentation("https://vimeo.com/channels/coachfort/123"),
    ).toMatchObject({ kind: "link", provider: "vimeo" });
    expect(
      getExternalVideoPresentation("https://youtu.be/not-valid"),
    ).toMatchObject({ kind: "link", provider: "youtube" });
  });

  test("15. unapproved hosts, schemes, credentials, ports, and malformed identifiers fail closed", () => {
    for (const value of [
      "http://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://example.com/video",
      "https://user@youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com:8443/watch?v=dQw4w9WgXcQ",
      "not-a-url",
    ]) {
      expect(getExternalVideoPresentation(value)).toEqual({ kind: "invalid" });
    }
  });

  test("16. external rendering uses iframe or safe-link conventions without native fetch", () => {
    const source = read(playerPath);
    expect(source.indexOf('external?.kind === "embed"')).toBeLessThan(
      source.indexOf('state.kind === "ready"'),
    );
    expect(source).toContain("src={external.embedUrl}");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
  });

  test("17. parser remains bounded to the installed database host authority", () => {
    const source = read(externalPath);
    for (const host of [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "vimeo.com",
      "www.vimeo.com",
      "player.vimeo.com",
    ]) {
      expect(source).toContain(`"${host}"`);
    }
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});

test.describe("VIDEO-2C2A team integration and narrow CSP", () => {
  test("18. shared team course detail composes the player without recreating role authority", () => {
    const source = read(coursePath);
    expect(source).toContain("<LessonVideoPlayer");
    expect(source).toContain("externalVideoUrl={lesson.video_url}");
    expect(source).toContain("lessonId={lesson.id}");
    expect(source).toContain("lessonTitle={lesson.title}");
    expect(source).toContain("tenantId={tenant.id}");
    expect(source).toContain("Video URL");

    const playerSource = read(playerPath);
    expect(playerSource).not.toMatch(/owner|admin|staff|trainer|student/i);
    expect(playerSource).not.toMatch(/assetId|providerAssetId|providerUid/i);
  });

  test("19. customer-code validation is shared, deterministic, and fail-closed", () => {
    expect(normalizeCloudflareStreamCustomerCode(" account-code ")).toBe(
      "account-code",
    );
    expect(normalizeCloudflareStreamCustomerCode("bad.code")).toBeNull();
    expect(getCloudflareStreamFrameSources({})).toEqual([]);
    expect(
      getCloudflareStreamFrameSources({
        CLOUDFLARE_STREAM_CUSTOMER_CODE: "account-code",
      }),
    ).toEqual([
      "https://customer-account-code.cloudflarestream.com",
      "https://customer-account-code.videodelivery.net",
    ]);
    expect(() =>
      getCloudflareStreamFrameSources({
        CLOUDFLARE_STREAM_CUSTOMER_CODE: "bad.code",
      }),
    ).toThrow(CloudflareStreamPlaybackConfigurationError);
  });

  test("20. Next config installs only the approved frame-src policy", () => {
    const source = read(nextConfigPath);
    expect(source).toContain("Content-Security-Policy");
    expect(source).toContain('"\'self\'"');
    expect(source).toContain("getCloudflareStreamFrameSources()");
    expect(source).toContain("https://www.youtube-nocookie.com");
    expect(source).toContain("https://player.vimeo.com");
    expect(source).not.toContain('"https://www.youtube.com"');
    expect(source).not.toContain("*.cloudflarestream.com");
    expect(source).not.toContain("*.videodelivery.net");
    expect(source).not.toMatch(/default-src|script-src|connect-src|img-src|style-src/);
  });

  test("21. CSP configuration does not expose provider credentials or alter upload metadata", () => {
    const nextSource = read(nextConfigPath);
    const configSource = read(configPath);
    const uploadSource = read("src/lib/server/video/cloudflareStream.ts");

    expect(nextSource).not.toMatch(/CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_STREAM_API_TOKEN|WEBHOOK_SECRET/);
    expect(configSource).toContain("normalizeCloudflareStreamCustomerCode");
    expect(uploadSource).not.toContain("allowedorigins");
  });
});
