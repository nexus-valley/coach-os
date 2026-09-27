"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  getNativeVideoInventory,
  mergeNativeVideoManagementPages,
  type NativeVideoManagementAsset,
  NativeVideoManagementRequestError,
} from "@/src/lib/video/nativeVideoManagementClient";
import {
  deleteNativeVideoLessonAttachment,
  getNativeVideoLessonErrorMessage,
  getNativeVideoLessonState,
  NativeVideoLessonRequestError,
  putNativeVideoLessonAttachment,
  type NativeVideoLessonAssetStatus,
  type NativeVideoLessonState,
} from "@/src/lib/video/nativeVideoLessonAttachmentClient";
import {
  reconcileNativeVideoAttachFailure,
  resolveLessonVideoMode,
  runNativeVideoAttachTransition,
  runLessonVideoMutation,
  type ExternalVideoClearOutcome,
} from "@/src/lib/video/nativeVideoLessonEditorState";

type VideoMode = "external" | "native" | "none";

type LessonNativeVideoEditorProps = {
  disabled?: boolean;
  externalVideoUrl: string;
  lessonId?: string;
  onClearExternalBeforeNative?: () => Promise<
    ExternalVideoClearOutcome["status"]
  >;
  onExternalVideoUrlChange: (value: string) => void;
  onMutationBusyChange?: (busy: boolean) => void;
  tenantId: string;
};

function formatDuration(seconds: number | null) {
  if (seconds === null) return "Duration pending";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function statusLabel(status: NativeVideoLessonAssetStatus) {
  switch (status) {
    case "ready":
      return "Ready";
    case "processing":
      return "Processing";
    case "upload_pending":
      return "Upload pending";
    case "failed":
      return "Needs attention";
    case "delete_pending":
      return "Removal pending";
    case "deleted":
      return "Removed";
  }
}

function requestErrorMessage(error: unknown) {
  const status =
    error instanceof NativeVideoLessonRequestError ||
    error instanceof NativeVideoManagementRequestError
      ? error.status
      : 500;
  return getNativeVideoLessonErrorMessage(
    status,
  );
}

export function filterReadyNativeVideoAssets(
  assets: NativeVideoManagementAsset[],
) {
  return assets.filter((asset) => asset.status === "ready");
}

export function LessonNativeVideoEditor({
  disabled = false,
  externalVideoUrl,
  lessonId,
  onClearExternalBeforeNative,
  onExternalVideoUrlChange,
  onMutationBusyChange,
  tenantId,
}: LessonNativeVideoEditorProps) {
  const [actionError, setActionError] = useState("");
  const [assets, setAssets] = useState<NativeVideoManagementAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(lessonId));
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [mode, setMode] = useState<VideoMode>(
    externalVideoUrl.trim() ? "external" : "none",
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [state, setState] = useState<NativeVideoLessonState | null>(null);
  const exactStateControllerRef = useRef<AbortController | null>(null);
  const externalVideoUrlRef = useRef(externalVideoUrl);
  const inventoryControllerRef = useRef<AbortController | null>(null);
  const mutationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    externalVideoUrlRef.current = externalVideoUrl;
  }, [externalVideoUrl]);

  const loadExactState = useCallback(
    async (signal?: AbortSignal) => {
      if (!lessonId) return null;
      const result = await getNativeVideoLessonState(
        { lessonId, tenantId },
        { signal },
      );
      setState(result);
      setMode(resolveLessonVideoMode({
        externalVideoUrl: externalVideoUrlRef.current,
        hasNativeAttachment: Boolean(result.attachment),
      }));
      return result;
    },
    [lessonId, tenantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    exactStateControllerRef.current?.abort();
    exactStateControllerRef.current = controller;
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = null;
    onMutationBusyChange?.(false);
    inventoryControllerRef.current?.abort();
    inventoryControllerRef.current = null;

    async function resetAndLoad() {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setActionError("");
      setAssets([]);
      setBusy(false);
      setNextCursor(null);
      setPickerOpen(false);
      setState(null);
      setMode(resolveLessonVideoMode({
        externalVideoUrl: externalVideoUrlRef.current,
        hasNativeAttachment: false,
      }));

      if (!lessonId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        await loadExactState(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          setActionError(requestErrorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void resetAndLoad();

    return () => controller.abort();
  }, [lessonId, loadExactState, onMutationBusyChange, tenantId]);

  useEffect(
    () => () => {
      exactStateControllerRef.current?.abort();
      inventoryControllerRef.current?.abort();
      mutationControllerRef.current?.abort();
      mutationControllerRef.current = null;
      onMutationBusyChange?.(false);
    },
    [onMutationBusyChange],
  );

  async function loadAssets(cursor: string | null, replace: boolean) {
    inventoryControllerRef.current?.abort();
    const controller = new AbortController();
    inventoryControllerRef.current = controller;
    setLoadingAssets(true);
    setActionError("");

    try {
      const page = await getNativeVideoInventory(
        { cursor, limit: 25, tenantId },
        { signal: controller.signal },
      );
      const ready = filterReadyNativeVideoAssets(page.items);
      setAssets((current) =>
        replace ? ready : mergeNativeVideoManagementPages(current, ready),
      );
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted) setActionError(requestErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setLoadingAssets(false);
    }
  }

  async function openPicker() {
    setMode("native");
    if (!lessonId) {
      setPickerOpen(false);
      return;
    }
    setPickerOpen(true);
    if (assets.length === 0) await loadAssets(null, true);
  }

  async function refreshAfterFailure(signal: AbortSignal) {
    if (!lessonId) return;
    try {
      await loadExactState(signal);
    } catch {
      // Keep the original safe action error when refresh is also unavailable.
    }
  }

  async function attach(assetId: string) {
    if (!lessonId || busy) return;
    mutationControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    await runLessonVideoMutation({
      begin() {
        setBusy(true);
        onMutationBusyChange?.(true);
        setActionError("");
      },
      isCurrent: () => mutationControllerRef.current === controller,
      async operation() {
        try {
          const transition = await runNativeVideoAttachTransition({
            async attachNative() {
              return putNativeVideoLessonAttachment(
                { assetId, lessonId, tenantId },
                { signal: controller.signal },
              );
            },
            hasNativeAttachment: Boolean(state?.attachment),
            onExternalCleared() {
              externalVideoUrlRef.current = "";
              onExternalVideoUrlChange("");
            },
            async prepareCanonicalExternal() {
              if (!onClearExternalBeforeNative) {
                throw new Error("External video preparation unavailable.");
              }
              return onClearExternalBeforeNative();
            },
          });
          if (transition.status === "reconciled_cleared") {
            setMode("none");
            setPickerOpen(false);
            setActionError(
              "The external video was removed, but the CoachFort video was not attached. Choose it again to retry.",
            );
            return;
          }
          setState(transition.result);
          setMode("native");
          setPickerOpen(false);
        } catch (error) {
          if (!controller.signal.aborted) {
            setActionError(requestErrorMessage(error));
            await reconcileNativeVideoAttachFailure({
              error,
              refreshNative: () => refreshAfterFailure(controller.signal),
              synchronizeCanonicalExternal(canonicalExternalUrl) {
                externalVideoUrlRef.current = canonicalExternalUrl;
                onExternalVideoUrlChange(canonicalExternalUrl);
                setMode(resolveLessonVideoMode({
                  externalVideoUrl: canonicalExternalUrl,
                  hasNativeAttachment: false,
                }));
              },
            });
          }
        }
      },
      release() {
        mutationControllerRef.current = null;
        setBusy(false);
        onMutationBusyChange?.(false);
      },
    });
  }

  async function detach(nextMode: Exclude<VideoMode, "native"> = "none") {
    if (!lessonId || busy) return;
    mutationControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    await runLessonVideoMutation({
      begin() {
        setBusy(true);
        onMutationBusyChange?.(true);
        setActionError("");
      },
      isCurrent: () => mutationControllerRef.current === controller,
      async operation() {
        try {
          const result = await deleteNativeVideoLessonAttachment(
            { lessonId, tenantId },
            { signal: controller.signal },
          );
          setState(result);
          setMode(nextMode);
          setPickerOpen(false);
          if (nextMode === "none") onExternalVideoUrlChange("");
        } catch (error) {
          if (!controller.signal.aborted) {
            setActionError(requestErrorMessage(error));
            await refreshAfterFailure(controller.signal);
          }
        }
      },
      release() {
        mutationControllerRef.current = null;
        setBusy(false);
        onMutationBusyChange?.(false);
      },
    });
  }

  async function chooseMode(nextMode: VideoMode) {
    if (nextMode === mode || busy) return;
    if (state?.attachment && nextMode !== "native") {
      await detach(nextMode);
      return;
    }
    if (nextMode === "none") onExternalVideoUrlChange("");
    setMode(nextMode);
    if (nextMode === "native") await openPicker();
  }

  const readyAssets = filterReadyNativeVideoAssets(assets);
  const unavailable = disabled || busy || loading;

  return (
    <section className="border-y border-white/10 py-5" data-testid="lesson-video-editor">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold text-white">Video</h4>
        <p className="text-sm leading-6 text-slate-400">
          Choose how learners watch this lesson.
        </p>
        <p className="text-xs leading-5 text-slate-500">
          CoachFort video changes save immediately. Other lesson changes save with Save lesson.
        </p>
      </div>

      <div aria-label="Lesson video mode" className="mt-4 grid grid-cols-3 gap-2">
        {([
          ["none", "No video"],
          ["external", "External link"],
          ["native", "CoachFort video"],
        ] as const).map(([value, label]) => (
          <button
            aria-pressed={mode === value}
            className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA] ${
              mode === value
                ? "border-[#2ECBEA]/60 bg-[#2ECBEA]/10 text-white"
                : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10"
            }`}
            disabled={unavailable}
            key={value}
            onClick={() => void chooseMode(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <p className="mt-4 text-sm text-slate-400">Loading video details...</p> : null}
      {actionError ? (
        <div className="mt-4">
          <FeedbackAlert tone="error">{actionError}</FeedbackAlert>
        </div>
      ) : null}

      {!loading && mode === "none" ? (
        <p className="mt-4 text-sm leading-6 text-slate-400">
          This lesson has no video.
        </p>
      ) : null}

      {!loading && mode === "external" ? (
        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-300">Video URL</span>
          <input
            className="mt-2 h-12 w-full rounded-md border border-white/10 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-teal-400/40 focus:bg-white/15 focus:ring-4 focus:ring-teal-400/10"
            disabled={disabled || busy}
            onChange={(event) => onExternalVideoUrlChange(event.target.value)}
            placeholder="https://youtube.com/... or https://vimeo.com/..."
            type="url"
            value={externalVideoUrl}
          />
          <span className="mt-2 block text-xs leading-5 text-slate-500">
            YouTube and Vimeo links are validated when the lesson is saved.
          </span>
        </label>
      ) : null}

      {!loading && mode === "native" ? (
        <div className="mt-4 space-y-4">
          {state?.attachment ? (
            <div className="flex flex-col gap-4 rounded-md border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-white">
                    {state.attachment.filename}
                  </p>
                  <Badge tone={state.attachment.status === "ready" ? "success" : "outline"}>
                    {statusLabel(state.attachment.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDuration(state.attachment.durationSeconds)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={disabled || busy}
                  onClick={() => void openPicker()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Replace video
                </Button>
                <Button
                  disabled={disabled || busy}
                  onClick={() => void detach("none")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Remove from lesson
                </Button>
              </div>
            </div>
          ) : lessonId ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-slate-400">
                Select a Ready video from your Video Library.
              </p>
              <Button
                disabled={disabled || busy}
                onClick={() => void openPicker()}
                size="sm"
                type="button"
                variant="secondary"
              >
                Choose from Video Library
              </Button>
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate-400">
              Save this lesson first, then reopen it to choose a CoachFort video.
            </p>
          )}

          {pickerOpen && lessonId ? (
            <div className="border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h5 className="text-sm font-semibold text-white">Ready videos</h5>
                  <p className="mt-1 text-xs text-slate-400">
                    Replacing a video updates this lesson only.
                  </p>
                </div>
                <Button
                  onClick={() => setPickerOpen(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Close
                </Button>
              </div>

              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                {readyAssets.map((asset) => (
                  <button
                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-[#2ECBEA]/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA] disabled:opacity-60"
                    disabled={disabled || busy}
                    key={asset.assetId}
                    onClick={() => void attach(asset.assetId)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">
                        {asset.filename}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {formatDuration(asset.durationSeconds)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-[#2ECBEA]">
                      {state?.attachment?.assetId === asset.assetId ? "Attached" : "Choose"}
                    </span>
                  </button>
                ))}
                {!loadingAssets && readyAssets.length === 0 ? (
                  <p className="py-4 text-sm text-slate-400">
                    No Ready videos are available on this page.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {nextCursor ? (
                  <Button
                    disabled={loadingAssets}
                    onClick={() => void loadAssets(nextCursor, false)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {loadingAssets ? "Loading..." : "Load more"}
                  </Button>
                ) : null}
                <Button
                  href="/app/video-library"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Open Video Library
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
