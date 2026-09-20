"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getExternalVideoPresentation } from "@/src/lib/video/externalVideo";
import {
  getNativePlaybackErrorState,
  type NativePlaybackDescriptor,
  NativePlaybackRequestError,
  requestNativeLessonPlayback,
} from "@/src/lib/video/nativeVideoPlaybackClient";

export type LessonVideoPlayerProps = {
  externalVideoUrl: string | null;
  lessonId: string;
  lessonTitle: string;
  tenantId: string;
};

type PlayerState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; descriptor: NativePlaybackDescriptor }
  | { kind: "error"; message: string; retryable: boolean };

async function getCurrentAccessToken() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

function VideoFrame({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
      <iframe
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="h-full w-full border-0"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        src={src}
        title={title}
      />
    </div>
  );
}

function LessonVideoPlayerForIdentity({
  externalVideoUrl,
  lessonId,
  lessonTitle,
  tenantId,
}: LessonVideoPlayerProps) {
  const external = useMemo(
    () =>
      externalVideoUrl
        ? getExternalVideoPresentation(externalVideoUrl)
        : null,
    [externalVideoUrl],
  );
  const [state, setState] = useState<PlayerState>({ kind: "idle" });
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  async function loadNativeVideo() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ kind: "loading" });

    try {
      const descriptor = await requestNativeLessonPlayback(
        { lessonId, tenantId },
        { getAccessToken: getCurrentAccessToken, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setState({ descriptor, kind: "ready" });
    } catch (error) {
      if (controller.signal.aborted) return;
      const status =
        error instanceof NativePlaybackRequestError ? error.status : 500;
      setState({ kind: "error", ...getNativePlaybackErrorState(status) });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  if (external?.kind === "embed") {
    return (
      <VideoFrame
        src={external.embedUrl}
        title={`${lessonTitle} video`}
      />
    );
  }

  if (external?.kind === "link") {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <a
          className="text-sm font-semibold text-teal-300 transition hover:text-teal-200 hover:underline"
          href={external.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open video on {external.provider === "youtube" ? "YouTube" : "Vimeo"}
        </a>
      </div>
    );
  }

  if (external?.kind === "invalid") {
    return (
      <FeedbackAlert tone="warning">
        This external video link is not supported.
      </FeedbackAlert>
    );
  }

  if (state.kind === "ready") {
    return (
      <VideoFrame
        src={state.descriptor.playback.url}
        title={`${lessonTitle} video`}
      />
    );
  }

  if (state.kind === "error") {
    return (
      <FeedbackAlert
        onRetry={state.retryable ? loadNativeVideo : undefined}
        tone={state.retryable ? "warning" : "info"}
      >
        {state.message}
      </FeedbackAlert>
    );
  }

  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-white/10 bg-black/30 p-5 text-center">
      <div>
        <p className="text-sm font-medium text-slate-300">
          {state.kind === "loading"
            ? "Preparing secure video playback..."
            : "Load this lesson video when you are ready to watch."}
        </p>
        <Button
          className="mt-4 bg-teal-400 text-black hover:bg-teal-300"
          disabled={state.kind === "loading"}
          isLoading={state.kind === "loading"}
          loadingText="Loading video"
          onClick={loadNativeVideo}
          size="sm"
          type="button"
        >
          Play video
        </Button>
      </div>
    </div>
  );
}

export function LessonVideoPlayer(props: LessonVideoPlayerProps) {
  const mediaIdentity = JSON.stringify([
    props.tenantId,
    props.lessonId,
    props.externalVideoUrl,
  ]);

  return <LessonVideoPlayerForIdentity key={mediaIdentity} {...props} />;
}
