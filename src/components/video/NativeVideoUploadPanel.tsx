"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { captureClientException } from "@/src/lib/monitoringClient";
import { getNativeVideoAsset, type NativeVideoCapacity, type NativeVideoManagementAsset } from "@/src/lib/video/nativeVideoManagementClient";
import {
  advanceNativeVideoRecoveryRecord,
  canContinueNativeVideoUpload,
  canStartNativeVideoUpload,
  clearNativeVideoRecoveryRecord,
  createNativeVideoRecoveryRecord,
  extractNativeVideoDuration,
  formatNativeVideoFileSize,
  getNativeVideoFileSelectionDecision,
  getNativeVideoSuccessfulSelectionPhase,
  getNativeVideoUploadErrorMessage,
  nativeVideoAllowedMimeTypes,
  NativeVideoUploadClientError,
  provisionNativeVideoUpload,
  readNativeVideoRecoveryRecord,
  type NativeVideoUploadRecoveryRecord,
  type NativeVideoUploadSafePhase,
  validateNativeVideoFile,
  writeNativeVideoRecoveryRecord,
} from "@/src/lib/video/nativeVideoUploadClient";
import {
  createNativeVideoTusUpload,
  type NativeVideoTusTransport,
} from "@/src/lib/video/nativeVideoTusUpload";

type UploadPhase =
  | "idle"
  | "validating_file"
  | "ready_to_start"
  | "provisioning"
  | "provisioning_pending"
  | "uploading"
  | "paused_or_interrupted"
  | "cancelled_local"
  | "binary_complete"
  | "processing"
  | "ready"
  | "failed"
  | "needs_review";

type NativeVideoUploadPanelProps = {
  capacity: NativeVideoCapacity | null;
  inactiveWorkspace: boolean;
  onAsset(asset: NativeVideoManagementAsset): void;
  onRefresh(): Promise<void>;
  tenantId: string;
};

const pendingRetryDelays = [1_500, 3_000, 5_000];
const observationTimeoutMs = 10 * 60 * 1_000;

function phaseCopy(phase: UploadPhase) {
  const labels: Record<UploadPhase, string> = {
    binary_complete: "Upload complete. CoachFort is processing your video.",
    cancelled_local: "Upload stopped on this device.",
    failed: "This video needs attention.",
    idle: "Choose a video to upload.",
    needs_review: "CoachFort is confirming your upload setup.",
    paused_or_interrupted: "The upload was interrupted. You can try to continue it.",
    processing: "CoachFort is processing your video.",
    provisioning: "Preparing your upload.",
    provisioning_pending: "CoachFort is confirming your upload setup.",
    ready: "Your video is ready.",
    ready_to_start: "Your video is ready to upload.",
    uploading: "Uploading video.",
    validating_file: "Checking your video.",
  };
  return labels[phase];
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function NativeVideoUploadPanel({
  capacity,
  inactiveWorkspace,
  onAsset,
  onRefresh,
  tenantId,
}: NativeVideoUploadPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [attempt, setAttempt] = useState<NativeVideoUploadRecoveryRecord | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState({ bytesTotal: 0, bytesUploaded: 0, percent: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const transportRef = useRef<NativeVideoTusTransport | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const observationTimerRef = useRef<number | null>(null);
  const observationStartedAtRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const mountedRef = useRef(true);

  const operationalUploadAllowed = Boolean(capacity?.featureEnabled && !inactiveWorkspace);
  const newUploadCapacityAvailable = Boolean(
    capacity && capacity.availableForNewUploadMinutes > 0,
  );
  const requiresFileReselection = Boolean(
    attempt &&
      !file &&
      ["ready_to_start", "provisioning", "provisioning_pending", "uploading", "paused_or_interrupted", "cancelled_local"].includes(
        attempt.safePhase,
      ),
  );
  const requiredMinutes = attempt
    ? Math.ceil(attempt.expectedDurationSeconds / 60)
    : 0;
  const newUploadCapacitySufficient = Boolean(
    capacity && requiredMinutes <= capacity.availableForNewUploadMinutes,
  );
  const attemptRequiresNewCapacity = Boolean(
    attempt && !attempt.assetId && attempt.safePhase === "ready_to_start",
  );

  function clearObservationTimer() {
    if (observationTimerRef.current !== null) {
      window.clearTimeout(observationTimerRef.current);
      observationTimerRef.current = null;
    }
  }

  function persistAttempt(
    current: NativeVideoUploadRecoveryRecord,
    safePhase: NativeVideoUploadSafePhase,
    assetId?: string,
  ) {
    const next = advanceNativeVideoRecoveryRecord(current, safePhase, assetId);
    writeNativeVideoRecoveryRecord(next);
    setAttempt(next);
    return next;
  }

  async function observeAsset(assetId: string) {
    clearObservationTimer();
    observationStartedAtRef.current = Date.now();

    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const asset = await getNativeVideoAsset({ assetId, tenantId });
        if (!mountedRef.current) return;
        onAsset(asset);
        if (asset.status === "ready") {
          setPhase("ready");
          clearNativeVideoRecoveryRecord(tenantId);
          setAttempt(null);
          await onRefresh();
          return;
        }
        if (asset.status === "failed" || asset.status === "deleted") {
          setPhase("failed");
          clearNativeVideoRecoveryRecord(tenantId);
          return;
        }
        if (asset.status === "delete_pending") {
          setPhase("needs_review");
          return;
        }
        setPhase("processing");
        if (attempt) persistAttempt(attempt, "processing", assetId);
      } catch (error) {
        const status = error && typeof error === "object" && "status" in error
          ? Number((error as { status: unknown }).status)
          : 500;
        if (status === 401 || status === 403 || status === 404) {
          setPhase("needs_review");
          setMessage(status === 401 ? "Your session has expired. Sign in again." : "This video is not available.");
          return;
        }
      }

      const elapsed = Date.now() - observationStartedAtRef.current;
      if (elapsed >= observationTimeoutMs) {
        setPhase("needs_review");
        setMessage("Processing is taking longer than expected. Refresh the video library later.");
        return;
      }
      observationTimerRef.current = window.setTimeout(
        () => void poll(),
        elapsed < 30_000 ? 3_000 : 10_000,
      );
    };

    await poll();
  }

  useEffect(() => {
    mountedRef.current = true;
    const recoveryTimer = window.setTimeout(() => {
      const recovered = readNativeVideoRecoveryRecord(tenantId);
      if (recovered) {
        setExpanded(true);
        setAttempt(recovered);
        if (
          recovered.assetId &&
          ["binary_complete", "processing", "needs_review"].includes(recovered.safePhase)
        ) {
          setPhase("processing");
          void observeAsset(recovered.assetId);
        } else if (!recovered.assetId && recovered.safePhase === "ready_to_start") {
          setPhase("ready_to_start");
        } else {
          setPhase("paused_or_interrupted");
        }
      }
    }, 0);
    return () => {
      window.clearTimeout(recoveryTimer);
      mountedRef.current = false;
      requestRef.current?.abort();
      void transportRef.current?.stop();
      transportRef.current = null;
      clearObservationTimer();
    };
    // Recovery is tenant-bound and runs once for each tenant identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (phase !== "uploading") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [phase]);

  async function selectFile(selected: File | null) {
    if (phase === "uploading") return;
    setFile(null);
    if (!selected) return;
    setMessage(null);
    setPhase("validating_file");
    try {
      validateNativeVideoFile(selected);
      const selectionDecision = getNativeVideoFileSelectionDecision(selected, attempt);
      if (selectionDecision === "require_original_file") {
        setPhase("paused_or_interrupted");
        setMessage("Choose the same video file to continue this upload.");
        return;
      }
      const durationSeconds = await extractNativeVideoDuration(selected);
      if (
        selectionDecision === "resume_attempt" &&
        attempt &&
        durationSeconds !== attempt.expectedDurationSeconds
      ) {
        setPhase("paused_or_interrupted");
        setMessage("Choose the same video file to continue this upload.");
        return;
      }
      const nextAttempt = selectionDecision === "resume_attempt" && attempt
        ? attempt
        : createNativeVideoRecoveryRecord({
            durationSeconds,
            file: selected,
            requestId: crypto.randomUUID(),
            safePhase: "ready_to_start",
            tenantId,
          });
      const selectedPhase = getNativeVideoSuccessfulSelectionPhase(selectionDecision, attempt);
      const selectedAttempt = advanceNativeVideoRecoveryRecord(nextAttempt, selectedPhase);
      writeNativeVideoRecoveryRecord(selectedAttempt);
      setAttempt(selectedAttempt);
      setFile(selected);
      setPhase(selectedPhase);
    } catch (error) {
      setPhase(attempt?.safePhase === "ready_to_start" ? "ready_to_start" : attempt ? "paused_or_interrupted" : "idle");
      setMessage(getNativeVideoUploadErrorMessage(error));
    }
  }

  async function beginUpload() {
    if (!attempt || !file) return;
    const initialStartAllowed = canStartNativeVideoUpload({
      capacityAvailable: newUploadCapacityAvailable,
      capacitySufficient: newUploadCapacitySufficient,
      hasFile: true,
      operationalUploadAllowed,
      phase,
    });
    const continuationAllowed = canContinueNativeVideoUpload({
      hasFile: true,
      operationalUploadAllowed,
      phase,
    });
    if (!initialStartAllowed && !continuationAllowed) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setMessage(null);
    setPhase("provisioning");
    let workingAttempt = persistAttempt(attempt, "provisioning");

    try {
      let pendingAttempt = 0;
      while (!controller.signal.aborted) {
        const result = await provisionNativeVideoUpload(
          {
            declaredMimeType: workingAttempt.mimeType,
            declaredSizeBytes: workingAttempt.sizeBytes,
            expectedDurationSeconds: workingAttempt.expectedDurationSeconds,
            filename: workingAttempt.filename,
            requestId: workingAttempt.requestId,
            tenantId: workingAttempt.tenantId,
          },
          { signal: controller.signal },
        );

        if ("uploadUrl" in result) {
          workingAttempt = persistAttempt(workingAttempt, "uploading", result.assetId);
          const nextAttempt = workingAttempt;
          const transport = createNativeVideoTusUpload({
            file,
            onError(category) {
              if (!mountedRef.current) return;
              transportRef.current = null;
              if (category === "native_video_tus_network_error") {
                setPhase("paused_or_interrupted");
                persistAttempt(nextAttempt, "paused_or_interrupted");
                setMessage("The upload was interrupted. Try to continue it.");
              } else {
                setPhase("needs_review");
                persistAttempt(nextAttempt, "needs_review");
                setMessage("This upload can no longer continue. Review its status before starting again.");
                void observeAsset(result.assetId);
              }
              captureClientException(new Error(category), {
                assetId: result.assetId,
                operation: "native_video_tus_upload",
                tenantId,
              });
            },
            onProgress(bytesUploaded, bytesTotal) {
              const now = Date.now();
              if (bytesUploaded !== bytesTotal && now - lastProgressAtRef.current < 200) return;
              lastProgressAtRef.current = now;
              setProgress({
                bytesTotal,
                bytesUploaded,
                percent: bytesTotal > 0
                  ? Math.min(100, Math.max(0, Math.round((bytesUploaded / bytesTotal) * 100)))
                  : 0,
              });
            },
            onSuccess() {
              transportRef.current = null;
              setPhase("binary_complete");
              persistAttempt(nextAttempt, "binary_complete");
              void observeAsset(result.assetId);
            },
            uploadUrl: result.uploadUrl,
          });
          transportRef.current = transport;
          setPhase("uploading");
          transport.start();
          return;
        }

        workingAttempt = persistAttempt(workingAttempt, "provisioning_pending", result.assetId);
        setPhase("provisioning_pending");
        if (result.code === "VIDEO_RECONCILIATION_REQUIRED") {
          setPhase("needs_review");
          workingAttempt = persistAttempt(workingAttempt, "needs_review", result.assetId);
          await observeAsset(result.assetId);
          return;
        }
        if (pendingAttempt >= pendingRetryDelays.length) {
          setPhase("needs_review");
          workingAttempt = persistAttempt(workingAttempt, "needs_review", result.assetId);
          await observeAsset(result.assetId);
          return;
        }
        await delay(pendingRetryDelays[pendingAttempt]!, controller.signal);
        pendingAttempt += 1;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof NativeVideoUploadClientError &&
        error.status === 409 &&
        workingAttempt.assetId
      ) {
        const knownAssetId = workingAttempt.assetId;
        setPhase("needs_review");
        workingAttempt = persistAttempt(workingAttempt, "needs_review");
        setMessage("This upload can no longer continue. CoachFort is confirming its final status.");
        await observeAsset(knownAssetId);
        return;
      }
      setPhase("paused_or_interrupted");
      workingAttempt = persistAttempt(workingAttempt, "paused_or_interrupted");
      setMessage(getNativeVideoUploadErrorMessage(error));
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function stopUpload() {
    await transportRef.current?.stop();
    transportRef.current = null;
    setPhase("cancelled_local");
    if (attempt) persistAttempt(attempt, "cancelled_local");
  }

  async function continueUpload() {
    if (!canContinueNativeVideoUpload({
      hasFile: Boolean(file),
      operationalUploadAllowed,
      phase,
    })) return;
    await transportRef.current?.stop();
    transportRef.current = null;
    await beginUpload();
  }

  async function startNewUpload() {
    requestRef.current?.abort();
    await transportRef.current?.stop();
    transportRef.current = null;
    clearObservationTimer();
    clearNativeVideoRecoveryRecord(tenantId);
    setAttempt(null);
    setFile(null);
    setMessage(null);
    setProgress({ bytesTotal: 0, bytesUploaded: 0, percent: 0 });
    setPhase("idle");
  }

  const busy = ["provisioning", "provisioning_pending", "uploading", "validating_file"].includes(phase);
  const canStart = canStartNativeVideoUpload({
    capacityAvailable: newUploadCapacityAvailable,
    capacitySufficient: newUploadCapacitySufficient,
    hasFile: Boolean(file),
    operationalUploadAllowed,
    phase,
  });
  const canContinue = canContinueNativeVideoUpload({
    hasFile: Boolean(file),
    operationalUploadAllowed,
    phase,
  });

  return (
    <section aria-labelledby="native-video-upload-title" className="border-x border-b border-[#D8E8F0] bg-[#F8FCFE] px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#0B2A3D]" id="native-video-upload-title">
            Upload video
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#64748B]">
            Add a secure video to your library, then attach it to a lesson.
          </p>
        </div>
        <Button
          aria-expanded={expanded}
          disabled={(!operationalUploadAllowed || !newUploadCapacityAvailable) && !attempt}
          onClick={() => setExpanded((value) => !value)}
          size="sm"
          variant="secondary"
        >
          {expanded ? "Close" : "Upload video"}
        </Button>
      </div>

      {!operationalUploadAllowed || (!newUploadCapacityAvailable && !attempt) ? (
        <p className="mt-3 text-sm text-[#8A5A00]">
          {inactiveWorkspace
            ? "Uploads are unavailable while this workspace is inactive."
            : capacity?.featureEnabled === false
              ? "New native video uploads are not currently available."
              : "Video capacity is currently full."}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-5 border-t border-[#D8E8F0] pt-5">
          {message ? <FeedbackAlert className="mb-4" tone="warning">{message}</FeedbackAlert> : null}
          <div aria-atomic="true" aria-live="polite" className="text-sm font-medium text-[#334155]" role="status">
            {phaseCopy(phase)}
          </div>

          {requiresFileReselection ? (
            <p className="mt-2 text-sm text-[#64748B]">Reselect the same local file to continue this upload.</p>
          ) : null}

          <label className="mt-4 block text-sm font-semibold text-[#0B2A3D]" htmlFor="native-video-file">
            Video file
          </label>
          <input
            accept={nativeVideoAllowedMimeTypes.join(",")}
            className="mt-2 block w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#334155] file:mr-3 file:rounded-md file:border-0 file:bg-[#EAF7FC] file:px-3 file:py-2 file:font-semibold file:text-[#145DA0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA] disabled:opacity-60"
            disabled={busy || phase === "processing" || phase === "binary_complete"}
            id="native-video-file"
            onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <p className="mt-2 text-xs leading-5 text-[#64748B]">MP4, MOV, WebM, MKV, AVI, or MPEG. Up to 10 GB and 2 hours.</p>

          {attempt ? (
            <dl className="mt-5 grid gap-3 rounded-md border border-[#D8E8F0] bg-white p-4 text-sm sm:grid-cols-3">
              <div className="min-w-0"><dt className="text-xs font-semibold text-[#64748B]">File</dt><dd className="mt-1 break-words font-medium text-[#0B2A3D]">{attempt.filename}</dd></div>
              <div><dt className="text-xs font-semibold text-[#64748B]">Size</dt><dd className="mt-1 font-medium text-[#0B2A3D]">{formatNativeVideoFileSize(attempt.sizeBytes)}</dd></div>
              <div><dt className="text-xs font-semibold text-[#64748B]">Duration</dt><dd className="mt-1 font-medium text-[#0B2A3D]">{attempt.expectedDurationSeconds} sec</dd></div>
            </dl>
          ) : null}

          {attemptRequiresNewCapacity && (!newUploadCapacityAvailable || !newUploadCapacitySufficient) ? (
            <FeedbackAlert className="mt-4" tone="warning">This video needs more available storage capacity.</FeedbackAlert>
          ) : null}

          {phase === "uploading" || progress.bytesUploaded > 0 ? (
            <div className="mt-5">
              <div className="flex items-center justify-between gap-4 text-xs font-semibold text-[#475569]">
                <span>{progress.percent}%</span>
                <span>{formatNativeVideoFileSize(progress.bytesUploaded)} of {formatNativeVideoFileSize(progress.bytesTotal)}</span>
              </div>
              <div aria-label={`${progress.percent}% uploaded`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress.percent} className="mt-2 h-2 overflow-hidden rounded-full bg-[#D8E8F0]" role="progressbar">
                <div className="h-full rounded-full bg-[#148CA5] transition-[width] duration-200" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            {canStart ? <Button onClick={() => void beginUpload()}>Start upload</Button> : null}
            {canContinue ? <Button onClick={() => void continueUpload()}>Continue upload</Button> : null}
            {phase === "uploading" ? <Button onClick={() => void stopUpload()} variant="secondary">Stop upload</Button> : null}
            {phase === "failed" || phase === "ready" ? (
              <Button onClick={() => void startNewUpload()} variant="secondary">Start a new upload</Button>
            ) : null}
          </div>
          {phase === "cancelled_local" || phase === "paused_or_interrupted" ? (
            <p className="mt-3 text-xs leading-5 text-[#64748B]">Stopping here does not delete the video or release reserved capacity.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
