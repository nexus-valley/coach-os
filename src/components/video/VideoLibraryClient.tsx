"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { NativeVideoUploadPanel } from "@/src/components/video/NativeVideoUploadPanel";
import { getCurrentTenantOperationalState } from "@/src/lib/subscriptionLifecycle";
import { getCurrentTenant } from "@/src/lib/tenant";
import {
  assetMatchesNativeVideoFilter,
  createNativeVideoPollingController,
  getActiveNativeVideoAssets,
  getNativeVideoAsset,
  getNativeVideoAttentionLabel,
  getNativeVideoCapacity,
  getNativeVideoInventory,
  getNativeVideoManagementErrorMessage,
  getNativeVideoStatusLabel,
  isNativeVideoDeletionEligible,
  mergeNativeVideoManagementPages,
  type NativeVideoCapacity,
  type NativeVideoDeletionErrorCode,
  type NativeVideoLibraryFilter,
  type NativeVideoManagementAsset,
  NativeVideoDeletionRequestError,
  NativeVideoManagementRequestError,
  requestNativeVideoDeletion,
} from "@/src/lib/video/nativeVideoManagementClient";

const filters: Array<{ label: string; value: NativeVideoLibraryFilter }> = [
  { label: "All", value: "all" },
  { label: "Processing", value: "processing" },
  { label: "Ready", value: "ready" },
  { label: "Needs attention", value: "attention" },
  { label: "Deleting", value: "deleting" },
];

type DeleteNotice = {
  message: string;
  tone: "error" | "info" | "success" | "warning";
};

function getRequestStatus(error: unknown) {
  return error instanceof NativeVideoManagementRequestError ? error.status : 500;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "Not available";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function attachmentCountLabel(count: number) {
  if (count === 0) return "Not used";
  return count === 1 ? "1 lesson" : `${count} lessons`;
}

function StatusBadge({ asset }: { asset: NativeVideoManagementAsset }) {
  const tone = {
    delete_pending: "border-slate-300 bg-slate-100 text-slate-700",
    deleted: "border-slate-200 bg-slate-50 text-slate-500",
    failed: "border-red-200 bg-red-50 text-red-700",
    processing: "border-sky-200 bg-sky-50 text-sky-700",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
    upload_pending: "border-amber-200 bg-amber-50 text-amber-700",
  }[asset.status];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}
      >
        {getNativeVideoStatusLabel(asset.status)}
      </span>
      {asset.attention ? (
        <span className="text-xs font-medium text-[#9A5B13]">
          {getNativeVideoAttentionLabel(asset.attention)}
        </span>
      ) : null}
    </div>
  );
}

function UsageDetails({ asset }: { asset: NativeVideoManagementAsset }) {
  if (asset.attachments.length === 0) {
    return <span className="text-sm text-[#64748B]">Not used</span>;
  }

  return (
    <details className="group max-w-sm">
      <summary className="cursor-pointer list-none rounded-md text-sm font-semibold text-[#145DA0] outline-none hover:text-[#0B2A3D] focus-visible:ring-2 focus-visible:ring-[#2ECBEA] focus-visible:ring-offset-2">
        {attachmentCountLabel(asset.attachments.length)}
        <span aria-hidden="true" className="ml-1 inline-block transition group-open:rotate-180">
          ↓
        </span>
      </summary>
      <ul className="mt-3 space-y-2 border-l-2 border-[#D8E8F0] pl-3">
        {asset.attachments.map((attachment) => (
          <li className="text-xs leading-5 text-[#475569]" key={attachment.lessonId}>
            <span className="block font-semibold text-[#0B2A3D]">
              {attachment.lessonTitle}
            </span>
            <span>{attachment.courseTitle}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CapacitySkeleton() {
  return (
    <section aria-label="Loading video capacity" className="border-y border-[#D8E8F0] bg-white px-5 py-6">
      <span className="sr-only">Loading video capacity</span>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-3 h-8 w-28" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-2 w-full" />
    </section>
  );
}

function CapacitySummary({ capacity }: { capacity: NativeVideoCapacity }) {
  const stateLabel = {
    critical: "Capacity nearly full",
    full: "Capacity full",
    normal: "Capacity available",
    notice: "Capacity notice",
    warning: "Capacity running low",
  }[capacity.capacityState];
  const stateClasses = {
    critical: "bg-red-600",
    full: "bg-red-700",
    normal: "bg-[#148CA5]",
    notice: "bg-sky-600",
    warning: "bg-amber-500",
  }[capacity.capacityState];
  const metrics = [
    { label: "Used", value: capacity.storedMinutes },
    { label: "Processing", value: capacity.reservedMinutes },
    { label: "Available", value: capacity.availableForNewUploadMinutes },
    { label: "Total capacity", value: capacity.effectiveCapacityMinutes },
  ];

  return (
    <section aria-labelledby="video-capacity-title" className="border-y border-[#D8E8F0] bg-white px-5 py-6 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#0B2A3D]" id="video-capacity-title">
            Storage capacity
          </h2>
          <p className="mt-1 text-xs text-[#64748B]">
            Video minutes currently stored or being processed.
          </p>
        </div>
        <span className="text-xs font-semibold text-[#475569]">{stateLabel}</span>
      </div>
      <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
              {metric.label}
            </dt>
            <dd className="mt-2 text-2xl font-semibold text-[#0B1F33]">
              {metric.value.toLocaleString()} <span className="text-sm font-medium text-[#64748B]">min</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-6">
        <div
          aria-label={`${capacity.percentUsed}% of video capacity used`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(capacity.percentUsed)}
          className="h-2 overflow-hidden rounded-full bg-[#E5EEF4]"
          role="progressbar"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${stateClasses}`}
            style={{ width: `${Math.min(100, Math.max(0, capacity.percentUsed))}%` }}
          />
        </div>
        {!capacity.featureEnabled ? (
          <p className="mt-3 text-sm text-[#8A5A00]">
            New native video uploads are not currently available. Existing videos remain visible.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function InventorySkeleton() {
  return (
    <section aria-label="Loading video library" className="space-y-3" role="status">
      <span className="sr-only">Loading video library</span>
      {[0, 1, 2].map((item) => (
        <div className="grid gap-3 border-b border-[#E2E8F0] bg-white px-5 py-5 md:grid-cols-[minmax(0,2fr)_1fr_0.7fr_1fr_1fr]" key={item}>
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-28" />
        </div>
      ))}
    </section>
  );
}

function DeleteVideoDialog({
  filename,
  onCancel,
  onConfirm,
  submitting,
}: {
  filename: string;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (submitting) dialogRef.current?.focus();
    else cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!submitting) onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, [onCancel, submitting]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1F33]/55 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (!submitting && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-[#FECACA] bg-white p-5 shadow-xl sm:p-6"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="text-xl font-semibold text-[#0B1F33]" id={titleId}>
          Delete video?
        </h2>
        <p
          className="mt-3 break-words text-sm leading-6 text-[#475569]"
          id={descriptionId}
        >
          Delete &quot;{filename}&quot; from CoachFort? This cannot be undone.
          Storage remains in use until deletion is completed.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[#D8E8F0] bg-white px-5 text-sm font-semibold text-[#0B2A3D] shadow-sm transition hover:border-[#2ECBEA]/60 hover:bg-[#F3FAFD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA] disabled:cursor-not-allowed disabled:bg-[#E5EEF4] disabled:text-[#66788F]"
            disabled={submitting}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            Cancel
          </button>
          <Button
            isLoading={submitting}
            loadingText="Deleting..."
            onClick={onConfirm}
            variant="destructive"
          >
            Delete video
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssetActions({
  asset,
  longRunning,
  onDelete,
  onRefresh,
  refreshing,
  unresolved,
}: {
  asset: NativeVideoManagementAsset;
  longRunning: boolean;
  onDelete: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  unresolved: boolean;
}) {
  const explanationId = `video-delete-explanation-${asset.assetId}`;
  const attached = asset.status === "ready" && asset.attachments.length > 0;
  const eligible = isNativeVideoDeletionEligible(asset, { unresolved });

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 md:items-end">
      <button
        className="min-h-10 rounded-md px-3 py-2 text-xs font-semibold text-[#145DA0] transition hover:bg-[#EAF7FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA] disabled:text-[#94A3B8]"
        disabled={refreshing}
        onClick={onRefresh}
        type="button"
      >
        {refreshing ? "Refreshing" : "Refresh item"}
      </button>
      {eligible ? (
        <Button
          className="w-full md:w-auto"
          onClick={onDelete}
          size="sm"
          variant="destructive"
        >
          Delete video
        </Button>
      ) : null}
      {attached ? (
        <>
          <Button
            aria-describedby={explanationId}
            className="w-full md:w-auto"
            disabled
            size="sm"
            variant="destructive"
          >
            Delete video
          </Button>
          <p className="max-w-56 text-xs leading-5 text-[#64748B]" id={explanationId}>
            Remove this video from its lessons before deleting it.
          </p>
        </>
      ) : null}
      {asset.status === "delete_pending" ? (
        <p className="max-w-64 text-xs leading-5 text-[#64748B]">
          Deletion is being completed. Storage capacity remains in use until it
          is finished.
        </p>
      ) : null}
      {longRunning && asset.status === "delete_pending" ? (
        <p className="max-w-64 text-xs font-medium leading-5 text-[#9A5B13]">
          Deletion is taking longer than expected. It will continue
          automatically. Refresh this item later.
        </p>
      ) : null}
      {unresolved ? (
        <p className="max-w-64 text-xs font-medium leading-5 text-[#9A5B13]">
          Refresh this item to confirm its current status before deleting it.
        </p>
      ) : null}
    </div>
  );
}

export function VideoLibraryClient() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [inactiveWorkspace, setInactiveWorkspace] = useState(false);
  const [assets, setAssets] = useState<NativeVideoManagementAsset[]>([]);
  const [capacity, setCapacity] = useState<NativeVideoCapacity | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<NativeVideoLibraryFilter>("all");
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [capacityLoading, setCapacityLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshingAssetId, setRefreshingAssetId] = useState<string | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [pollingWarning, setPollingWarning] = useState<string | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deleteSubmittingAssetId, setDeleteSubmittingAssetId] = useState<
    string | null
  >(null);
  const [deleteNotice, setDeleteNotice] = useState<DeleteNotice | null>(null);
  const [deleteLongRunningAssetIds, setDeleteLongRunningAssetIds] = useState<
    Set<string>
  >(() => new Set());
  const [unresolvedDeleteAssetIds, setUnresolvedDeleteAssetIds] = useState<
    Set<string>
  >(() => new Set());
  const assetsRef = useRef<NativeVideoManagementAsset[]>([]);
  const pollingRef = useRef<ReturnType<typeof createNativeVideoPollingController> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const deleteRequestRef = useRef<AbortController | null>(null);
  const terminalDeleteIdsRef = useRef(new Set<string>());
  const deleteOperationGenerationRef = useRef(0);
  const tenantIdRef = useRef<string | null>(null);
  const unresolvedDeleteAssetIdsRef = useRef(new Set<string>());
  const deleteSubmittingAssetIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      deleteOperationGenerationRef.current += 1;
      deleteRequestRef.current?.abort();
    };
  }, []);

  const clearUnresolvedDeleteAsset = useCallback((assetId: string) => {
    const next = new Set(unresolvedDeleteAssetIdsRef.current);
    next.delete(assetId);
    unresolvedDeleteAssetIdsRef.current = next;
    setUnresolvedDeleteAssetIds(next);
  }, []);

  const markUnresolvedDeleteAsset = useCallback((assetId: string) => {
    const next = new Set(unresolvedDeleteAssetIdsRef.current);
    next.add(assetId);
    unresolvedDeleteAssetIdsRef.current = next;
    setUnresolvedDeleteAssetIds(next);
    setDeleteCandidateId((current) => (current === assetId ? null : current));
    pollingRef.current?.stop(assetId);
  }, []);

  const clearDeleteLifecycleFlags = useCallback((assetId: string) => {
    clearUnresolvedDeleteAsset(assetId);
    setDeleteLongRunningAssetIds((current) => {
      const next = new Set(current);
      next.delete(assetId);
      return next;
    });
  }, [clearUnresolvedDeleteAsset]);

  const removeActiveAsset = useCallback((assetId: string) => {
    const nextAssets = assetsRef.current.filter(
      (asset) => asset.assetId !== assetId,
    );
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
    pollingRef.current?.stop(assetId);
    clearDeleteLifecycleFlags(assetId);
    setDeleteCandidateId((current) => (current === assetId ? null : current));
  }, [clearDeleteLifecycleFlags]);

  const finalizeDeletedAsset = useCallback(
    async (assetId: string, expectedTenantId: string) => {
      if (
        !mountedRef.current ||
        tenantIdRef.current !== expectedTenantId ||
        terminalDeleteIdsRef.current.has(assetId)
      ) {
        return;
      }

      terminalDeleteIdsRef.current.add(assetId);
      pollingRef.current?.stop(assetId);
      const nextAssets = assetsRef.current.filter(
        (asset) => asset.assetId !== assetId,
      );
      assetsRef.current = nextAssets;
      setAssets(nextAssets);
      clearDeleteLifecycleFlags(assetId);
      setDeleteCandidateId((current) => (current === assetId ? null : current));
      setDeleteSubmittingAssetId((current) =>
        current === assetId ? null : current,
      );
      if (deleteSubmittingAssetIdRef.current === assetId) {
        deleteSubmittingAssetIdRef.current = null;
      }

      try {
        const nextCapacity = await getNativeVideoCapacity(expectedTenantId);
        if (
          !mountedRef.current ||
          tenantIdRef.current !== expectedTenantId
        ) {
          return;
        }
        setCapacity(nextCapacity);
        setCapacityError(null);
        setDeleteNotice({
          message: "Video deleted. Storage capacity has been updated.",
          tone: "success",
        });
      } catch {
        if (
          !mountedRef.current ||
          tenantIdRef.current !== expectedTenantId
        ) {
          return;
        }
        setDeleteNotice({
          message:
            "Video deleted. Capacity will update the next time the library is refreshed.",
          tone: "warning",
        });
      }
    },
    [clearDeleteLifecycleFlags],
  );

  const applyCanonicalAsset = useCallback(
    async (asset: NativeVideoManagementAsset, expectedTenantId: string) => {
      if (
        !mountedRef.current ||
        tenantIdRef.current !== expectedTenantId
      ) {
        return;
      }
      if (asset.status === "deleted") {
        await finalizeDeletedAsset(asset.assetId, expectedTenantId);
        return;
      }

      const existing = assetsRef.current.some(
        (item) => item.assetId === asset.assetId,
      );
      if (!existing) return;
      const nextAssets = assetsRef.current.map((item) =>
        item.assetId === asset.assetId ? asset : item,
      );
      assetsRef.current = nextAssets;
      setAssets(nextAssets);
      clearDeleteLifecycleFlags(asset.assetId);
      setDeleteCandidateId((current) => {
        if (
          current !== asset.assetId ||
          deleteSubmittingAssetIdRef.current === asset.assetId
        ) {
          return current;
        }
        return isNativeVideoDeletionEligible(asset) ? current : null;
      });
      setPollingWarning(null);
    },
    [clearDeleteLifecycleFlags, finalizeDeletedAsset],
  );

  const applyAcceptedDeletePending = useCallback((assetId: string) => {
    const nextAssets = assetsRef.current.map((asset) =>
      asset.assetId === assetId
        ? { ...asset, status: "delete_pending" as const }
        : asset,
    );
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
    setDeleteCandidateId((current) => (current === assetId ? null : current));
    setDeleteLongRunningAssetIds((current) => {
      const next = new Set(current);
      next.delete(assetId);
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    requestRef.current = controller;

    async function load() {
      const tenant = await getCurrentTenant().catch(() => null);
      if (!active) return;
      if (!tenant) {
        setInventoryError("Video management is temporarily unavailable. Please try again.");
        setCapacityError("Video capacity information is temporarily unavailable.");
        setInventoryLoading(false);
        setCapacityLoading(false);
        return;
      }

      tenantIdRef.current = tenant.id;
      deleteOperationGenerationRef.current += 1;
      deleteRequestRef.current?.abort();
      deleteRequestRef.current = null;
      deleteSubmittingAssetIdRef.current = null;
      unresolvedDeleteAssetIdsRef.current = new Set();
      terminalDeleteIdsRef.current = new Set();
      setDeleteCandidateId(null);
      setDeleteSubmittingAssetId(null);
      setDeleteNotice(null);
      setDeleteLongRunningAssetIds(new Set());
      setUnresolvedDeleteAssetIds(new Set());
      setTenantId(tenant.id);
      const [inventoryResult, capacityResult, operationalResult] = await Promise.allSettled([
        getNativeVideoInventory(
          { limit: 25, tenantId: tenant.id },
          { signal: controller.signal },
        ),
        getNativeVideoCapacity(tenant.id, { signal: controller.signal }),
        getCurrentTenantOperationalState(tenant.id),
      ]);
      if (!active || controller.signal.aborted) return;

      if (inventoryResult.status === "fulfilled") {
        const activeAssets = getActiveNativeVideoAssets(inventoryResult.value.items);
        assetsRef.current = activeAssets;
        setAssets(activeAssets);
        setNextCursor(inventoryResult.value.nextCursor);
      } else {
        setInventoryError(
          getNativeVideoManagementErrorMessage(getRequestStatus(inventoryResult.reason)),
        );
      }
      if (capacityResult.status === "fulfilled") {
        setCapacity(capacityResult.value);
      } else {
        setCapacityError(
          getNativeVideoManagementErrorMessage(getRequestStatus(capacityResult.reason)),
        );
      }
      if (operationalResult.status === "fulfilled") {
        setInactiveWorkspace(!operationalResult.value.operationalAllowed);
      }
      setInventoryLoading(false);
      setCapacityLoading(false);
    }

    void load();
    return () => {
      active = false;
      controller.abort();
      tenantIdRef.current = null;
      deleteOperationGenerationRef.current += 1;
      deleteRequestRef.current?.abort();
      deleteRequestRef.current = null;
      if (requestRef.current === controller) requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const controller = createNativeVideoPollingController({
      onAsset(asset) {
        void applyCanonicalAsset(asset, tenantId);
      },
      onAuthFailure() {
        setPollingWarning("Your session has expired. Sign in again.");
      },
      onError(status) {
        setPollingWarning(getNativeVideoManagementErrorMessage(status));
      },
      onTimeout(assetId, status) {
        if (status !== "delete_pending") return;
        setDeleteLongRunningAssetIds((current) => {
          const next = new Set(current);
          next.add(assetId);
          return next;
        });
      },
      requestAsset(assetId, signal) {
        return getNativeVideoAsset({ assetId, tenantId }, { signal });
      },
    });
    pollingRef.current = controller;

    function handleVisibilityChange() {
      if (document.hidden) controller.pause();
      else controller.resume();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.hidden) controller.pause();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      controller.stopAll();
      if (pollingRef.current === controller) pollingRef.current = null;
    };
  }, [applyCanonicalAsset, tenantId]);

  useEffect(() => {
    pollingRef.current?.sync(
      assets.filter(
        (asset) => !unresolvedDeleteAssetIds.has(asset.assetId),
      ),
    );
  }, [assets, unresolvedDeleteAssetIds]);

  const visibleAssets = useMemo(
    () => assets.filter((asset) => assetMatchesNativeVideoFilter(asset, filter)),
    [assets, filter],
  );

  async function refreshAll() {
    if (!tenantId || refreshing) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);
    setInventoryError(null);
    setCapacityError(null);

    const [inventoryResult, capacityResult] = await Promise.allSettled([
      getNativeVideoInventory({ limit: 25, tenantId }, { signal: controller.signal }),
      getNativeVideoCapacity(tenantId, { signal: controller.signal }),
    ]);
    if (!controller.signal.aborted) {
      if (inventoryResult.status === "fulfilled") {
        const activeAssets = getActiveNativeVideoAssets(inventoryResult.value.items);
        assetsRef.current = activeAssets;
        setAssets(activeAssets);
        setNextCursor(inventoryResult.value.nextCursor);
        unresolvedDeleteAssetIdsRef.current = new Set();
        setUnresolvedDeleteAssetIds(new Set());
        setDeleteLongRunningAssetIds(new Set());
        setDeleteCandidateId((current) => {
          if (!current || deleteSubmittingAssetIdRef.current === current) {
            return current;
          }
          const candidate = activeAssets.find(
            (asset) => asset.assetId === current,
          );
          return isNativeVideoDeletionEligible(candidate) ? current : null;
        });
      } else {
        setInventoryError(
          getNativeVideoManagementErrorMessage(getRequestStatus(inventoryResult.reason)),
        );
      }
      if (capacityResult.status === "fulfilled") {
        setCapacity(capacityResult.value);
      } else {
        setCapacityError(
          getNativeVideoManagementErrorMessage(getRequestStatus(capacityResult.reason)),
        );
      }
    }
    if (requestRef.current === controller) requestRef.current = null;
    if (mountedRef.current) setRefreshing(false);
  }

  async function loadMore() {
    if (!tenantId || !nextCursor || loadingMore) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingMore(true);
    setInventoryError(null);
    try {
      const page = await getNativeVideoInventory(
        { cursor: nextCursor, limit: 25, tenantId },
        { signal: controller.signal },
      );
      if (mountedRef.current) {
        const nextAssets = mergeNativeVideoManagementPages(
          assetsRef.current,
          getActiveNativeVideoAssets(page.items),
        );
        assetsRef.current = nextAssets;
        setAssets(nextAssets);
        setNextCursor(page.nextCursor);
      }
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) {
        setInventoryError(getNativeVideoManagementErrorMessage(getRequestStatus(error)));
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mountedRef.current) setLoadingMore(false);
    }
  }

  function upsertUploadedAsset(asset: NativeVideoManagementAsset) {
    if (asset.status === "deleted") {
      removeActiveAsset(asset.assetId);
      return;
    }
    const existingIndex = assetsRef.current.findIndex(
      (item) => item.assetId === asset.assetId,
    );
    const nextAssets = [...assetsRef.current];
    if (existingIndex >= 0) nextAssets[existingIndex] = asset;
    else nextAssets.unshift(asset);
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
    setDeleteCandidateId((current) => {
      if (
        current !== asset.assetId ||
        deleteSubmittingAssetIdRef.current === asset.assetId
      ) {
        return current;
      }
      return isNativeVideoDeletionEligible(asset, {
        unresolved: unresolvedDeleteAssetIdsRef.current.has(asset.assetId),
      })
        ? current
        : null;
    });
  }

  async function refreshAsset(assetId: string) {
    if (!pollingRef.current || refreshingAssetId) return;
    setRefreshingAssetId(assetId);
    setPollingWarning(null);
    await pollingRef.current.refresh(assetId);
    if (mountedRef.current) setRefreshingAssetId(null);
  }

  function deleteOperationIsCurrent(
    generation: number,
    expectedTenantId: string,
    controller: AbortController,
  ) {
    return (
      mountedRef.current &&
      !controller.signal.aborted &&
      deleteOperationGenerationRef.current === generation &&
      tenantIdRef.current === expectedTenantId
    );
  }

  const closeDeleteConfirmation = useCallback(() => {
    if (deleteSubmittingAssetIdRef.current === null) {
      setDeleteCandidateId(null);
    }
  }, []);

  function openDeleteConfirmation(assetId: string) {
    const asset = assetsRef.current.find((item) => item.assetId === assetId);
    if (
      !isNativeVideoDeletionEligible(asset, {
        submitting: deleteSubmittingAssetIdRef.current !== null,
        unresolved: unresolvedDeleteAssetIdsRef.current.has(assetId),
      })
    ) {
      return;
    }
    setDeleteNotice(null);
    setDeleteCandidateId(assetId);
  }

  async function reconcileAmbiguousDeletion(
    assetId: string,
    expectedTenantId: string,
    generation: number,
    controller: AbortController,
  ) {
    try {
      const asset = await getNativeVideoAsset(
        { assetId, tenantId: expectedTenantId },
        { signal: controller.signal },
      );
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      await applyCanonicalAsset(asset, expectedTenantId);
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      setDeleteCandidateId(null);
      if (asset.status === "ready") {
        setDeleteNotice({
          message:
            "We couldn't confirm the deletion request. Review the current status before trying again.",
          tone: "warning",
        });
      } else if (asset.status !== "deleted") {
        setDeleteNotice({
          message: "The video's current status has been refreshed.",
          tone: "info",
        });
      }
    } catch (error) {
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      const status = getRequestStatus(error);
      setDeleteCandidateId(null);
      if (status === 401) {
        pollingRef.current?.stopAll();
        setDeleteNotice({
          message: "Your session has expired. Sign in again.",
          tone: "error",
        });
        return;
      }
      if (status === 404) {
        removeActiveAsset(assetId);
        setDeleteNotice({
          message: "This video is no longer available.",
          tone: "info",
        });
        return;
      }
      markUnresolvedDeleteAsset(assetId);
      setDeleteNotice({
        message:
          status === 403
            ? "Video management is not available for this workspace or account."
            : "We couldn't confirm the deletion request. Refresh this item before trying again.",
        tone: "warning",
      });
    }
  }

  async function reconcileDeletionConflict(
    assetId: string,
    expectedTenantId: string,
    generation: number,
    controller: AbortController,
    code: Extract<
      NativeVideoDeletionErrorCode,
      "VIDEO_ATTACHED_TO_LESSON" | "VIDEO_DELETION_STATE_CONFLICT"
    >,
  ) {
    try {
      const asset = await getNativeVideoAsset(
        { assetId, tenantId: expectedTenantId },
        { signal: controller.signal },
      );
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      await applyCanonicalAsset(asset, expectedTenantId);
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      setDeleteCandidateId(null);
      if (asset.status !== "deleted") {
        setDeleteNotice({
          message:
            code === "VIDEO_ATTACHED_TO_LESSON"
              ? "Remove this video from its lessons before deleting it."
              : "This video's status changed. Review its current status before trying again.",
          tone: "warning",
        });
      }
    } catch (error) {
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      const status = getRequestStatus(error);
      setDeleteCandidateId(null);
      if (status === 401) {
        pollingRef.current?.stopAll();
        setDeleteNotice({
          message: "Your session has expired. Sign in again.",
          tone: "error",
        });
        return;
      }
      if (status === 404) {
        removeActiveAsset(assetId);
        setDeleteNotice({
          message: "This video is no longer available.",
          tone: "info",
        });
        return;
      }
      markUnresolvedDeleteAsset(assetId);
      setDeleteNotice({
        message:
          status === 403
            ? "Video management is not available for this workspace or account."
            : "The video's current status could not be confirmed. Refresh this item before trying again.",
        tone: "warning",
      });
    }
  }

  async function reconcileAcceptedDeletion(
    assetId: string,
    expectedTenantId: string,
    generation: number,
    controller: AbortController,
  ) {
    try {
      const asset = await getNativeVideoAsset(
        { assetId, tenantId: expectedTenantId },
        { signal: controller.signal },
      );
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      await applyCanonicalAsset(asset, expectedTenantId);
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      setDeleteCandidateId(null);
      if (asset.status === "delete_pending") {
        setDeleteNotice({
          message:
            "Deletion requested. Storage capacity remains in use until it is finished.",
          tone: "info",
        });
      } else if (asset.status !== "deleted") {
        setDeleteNotice({
          message: "The video's current status has been refreshed.",
          tone: "info",
        });
      }
    } catch (error) {
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      const status = getRequestStatus(error);
      setDeleteCandidateId(null);
      if (status === 404) {
        removeActiveAsset(assetId);
        setDeleteNotice({
          message: "This video is no longer available.",
          tone: "info",
        });
        return;
      }

      applyAcceptedDeletePending(assetId);
      if (status === 401) {
        pollingRef.current?.stopAll();
        setDeleteNotice({
          message: "Your session has expired. Sign in again.",
          tone: "error",
        });
        return;
      }
      if (status === 403) {
        markUnresolvedDeleteAsset(assetId);
        setDeleteNotice({
          message: "Video management is not available for this workspace or account.",
          tone: "warning",
        });
        return;
      }

      clearUnresolvedDeleteAsset(assetId);
      setDeleteNotice({
        message:
          "Deletion was requested, but its current status could not be refreshed. CoachFort will keep checking.",
        tone: "warning",
      });
    }
  }

  async function submitDelete() {
    const assetId = deleteCandidateId;
    const expectedTenantId = tenantIdRef.current;
    if (
      !assetId ||
      !expectedTenantId ||
      deleteSubmittingAssetIdRef.current !== null
    ) {
      return;
    }

    const candidate = assetsRef.current.find(
      (asset) => asset.assetId === assetId,
    );
    if (
      !isNativeVideoDeletionEligible(candidate, {
        unresolved: unresolvedDeleteAssetIdsRef.current.has(assetId),
      })
    ) {
      setDeleteCandidateId(null);
      setDeleteNotice({
        message:
          "This video's status changed. Review its current status before trying again.",
        tone: "warning",
      });
      return;
    }

    const generation = deleteOperationGenerationRef.current + 1;
    deleteOperationGenerationRef.current = generation;
    const controller = new AbortController();
    deleteRequestRef.current?.abort();
    deleteRequestRef.current = controller;
    deleteSubmittingAssetIdRef.current = assetId;
    setDeleteSubmittingAssetId(assetId);
    setDeleteNotice(null);

    try {
      await requestNativeVideoDeletion(
        { assetId, tenantId: expectedTenantId },
        { signal: controller.signal },
      );
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }
      await reconcileAcceptedDeletion(
        assetId,
        expectedTenantId,
        generation,
        controller,
      );
    } catch (error) {
      if (!deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        return;
      }

      if (
        error instanceof NativeVideoDeletionRequestError &&
        !error.ambiguous
      ) {
        setDeleteCandidateId(null);
        if (error.code === "VIDEO_INVALID_REQUEST") {
          setDeleteNotice({
            message:
              "The deletion request is invalid. Refresh the video library and try again.",
            tone: "error",
          });
        } else if (error.code === "VIDEO_AUTHENTICATION_REQUIRED") {
          pollingRef.current?.stopAll();
          setDeleteNotice({
            message: "Your session has expired. Sign in again.",
            tone: "error",
          });
        } else if (error.code === "VIDEO_DELETION_FORBIDDEN") {
          markUnresolvedDeleteAsset(assetId);
          setDeleteNotice({
            message: "You do not have permission to delete this video.",
            tone: "error",
          });
        } else if (error.code === "VIDEO_ASSET_NOT_FOUND") {
          removeActiveAsset(assetId);
          setDeleteNotice({
            message: "This video is no longer available.",
            tone: "info",
          });
        } else if (
          error.code === "VIDEO_ATTACHED_TO_LESSON" ||
          error.code === "VIDEO_DELETION_STATE_CONFLICT"
        ) {
          await reconcileDeletionConflict(
            assetId,
            expectedTenantId,
            generation,
            controller,
            error.code,
          );
        }
      } else {
        await reconcileAmbiguousDeletion(
          assetId,
          expectedTenantId,
          generation,
          controller,
        );
      }
    } finally {
      if (deleteOperationIsCurrent(generation, expectedTenantId, controller)) {
        deleteSubmittingAssetIdRef.current = null;
        setDeleteSubmittingAssetId(null);
        if (deleteRequestRef.current === controller) {
          deleteRequestRef.current = null;
        }
      }
    }
  }

  const deleteCandidate = deleteCandidateId
    ? assets.find((asset) => asset.assetId === deleteCandidateId)
    : undefined;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-8">
      <header className="flex flex-col gap-5 border-b border-[#D8E8F0] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0E7490]">
            Media management
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#0B1F33] sm:text-4xl">
            Video Library
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#475569]">
            Manage uploaded videos, processing status, lesson usage, and storage capacity.
          </p>
        </div>
        <Button
          disabled={!tenantId}
          isLoading={refreshing}
          loadingText="Refreshing"
          onClick={() => void refreshAll()}
          size="sm"
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      {inactiveWorkspace ? (
        <FeedbackAlert tone="info">
              Your workspace is inactive. You can still review existing videos and their current status.
        </FeedbackAlert>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[#D8E8F0] shadow-sm shadow-slate-950/5">
        {capacityLoading ? <CapacitySkeleton /> : null}
        {!capacityLoading && capacity ? <CapacitySummary capacity={capacity} /> : null}
        {!capacityLoading && capacity && tenantId ? (
          <NativeVideoUploadPanel
            capacity={capacity}
            inactiveWorkspace={inactiveWorkspace}
            onAsset={upsertUploadedAsset}
            onRefresh={refreshAll}
            tenantId={tenantId}
          />
        ) : null}
        {!capacityLoading && capacityError ? (
          <div className="bg-white p-5">
            <FeedbackAlert onRetry={() => void refreshAll()}>{capacityError}</FeedbackAlert>
          </div>
        ) : null}
      </div>

      <section aria-labelledby="video-inventory-title">
        <div className="flex flex-col gap-4 border-b border-[#CBD5E1] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#0B1F33]" id="video-inventory-title">
              Videos
            </h2>
            <p className="mt-1 text-sm text-[#64748B]">
              Filter this loaded page by readiness and review lesson usage.
            </p>
          </div>
          <div aria-label="Filter videos" className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-[#CBD5E1] bg-white p-1" role="group">
            {filters.map((item) => (
              <button
                aria-pressed={filter === item.value}
                className={[
                  "min-h-9 shrink-0 rounded-md px-3 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA]",
                  filter === item.value
                    ? "bg-[#0B2A3D] text-white shadow-sm"
                    : "text-[#475569] hover:bg-[#EAF7FC] hover:text-[#0B2A3D]",
                ].join(" ")}
                key={item.value}
                onClick={() => setFilter(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {pollingWarning ? (
          <FeedbackAlert className="mt-5" onRetry={() => void refreshAll()} tone="warning">
            {pollingWarning}
          </FeedbackAlert>
        ) : null}
        {deleteNotice ? (
          <FeedbackAlert className="mt-5" tone={deleteNotice.tone}>
            {deleteNotice.message}
          </FeedbackAlert>
        ) : null}
        {inventoryError ? (
          <FeedbackAlert className="mt-5" onRetry={() => void refreshAll()}>
            {inventoryError}
          </FeedbackAlert>
        ) : null}

            <div className="mt-5 overflow-hidden rounded-lg border border-[#D8E8F0] bg-white shadow-sm shadow-slate-950/5">
          {inventoryLoading ? <InventorySkeleton /> : null}
          {!inventoryLoading && assets.length === 0 && !inventoryError ? (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-[#9ADDEA] bg-[#EAF8FC] text-sm font-bold text-[#0B6F87]">
                ▶
              </div>
              <h3 className="mt-5 text-xl font-semibold text-[#0B1F33]">No videos yet</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#64748B]">
                Uploaded videos will appear here once native video upload is available.
              </p>
            </div>
          ) : null}
          {!inventoryLoading && assets.length > 0 && visibleAssets.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <h3 className="text-lg font-semibold text-[#0B1F33]">No matching videos</h3>
              <p className="mt-2 text-sm text-[#64748B]">Try another status filter.</p>
            </div>
          ) : null}

          {!inventoryLoading && visibleAssets.length > 0 ? (
            <>
              <div className="hidden md:block">
                <table className="w-full table-fixed border-collapse text-left">
                  <thead className="bg-[#F8FAFC] text-xs font-semibold uppercase tracking-[0.1em] text-[#64748B]">
                    <tr>
                      <th className="w-[27%] px-5 py-3">Video</th>
                      <th className="w-[18%] px-4 py-3">Status</th>
                      <th className="w-[10%] px-4 py-3">Duration</th>
                      <th className="w-[16%] px-4 py-3">Used in</th>
                      <th className="w-[13%] px-4 py-3">Updated</th>
                      <th className="w-[16%] px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAssets.map((asset) => (
                      <tr
                        className="border-t border-[#E2E8F0] align-top transition hover:bg-[#F8FCFE]"
                        key={asset.assetId}
                      >
                        <td className="px-5 py-4">
                          <p className="break-words text-sm font-semibold text-[#0B1F33]">{asset.filename}</p>
                          <p className="mt-1 text-xs text-[#64748B]">Added {formatUpdatedAt(asset.createdAt)}</p>
                        </td>
                        <td className="px-4 py-4"><StatusBadge asset={asset} /></td>
                        <td className="px-4 py-4 text-sm font-medium text-[#334155]">{formatDuration(asset.durationSeconds)}</td>
                        <td className="px-4 py-4"><UsageDetails asset={asset} /></td>
                        <td className="px-4 py-4 text-sm text-[#475569]">{formatUpdatedAt(asset.updatedAt)}</td>
                        <td className="px-4 py-4 text-right">
                          <AssetActions
                            asset={asset}
                            longRunning={deleteLongRunningAssetIds.has(asset.assetId)}
                            onDelete={() => openDeleteConfirmation(asset.assetId)}
                            onRefresh={() => void refreshAsset(asset.assetId)}
                            refreshing={refreshingAssetId !== null}
                            unresolved={unresolvedDeleteAssetIds.has(asset.assetId)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-[#E2E8F0] md:hidden">
                {visibleAssets.map((asset) => (
                  <article className="p-5" key={asset.assetId}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-semibold text-[#0B1F33]">{asset.filename}</h3>
                        <p className="mt-1 text-xs text-[#64748B]">Updated {formatUpdatedAt(asset.updatedAt)}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-[#334155]">{formatDuration(asset.durationSeconds)}</span>
                    </div>
                    <div className="mt-4"><StatusBadge asset={asset} /></div>
                    <div className="mt-4 grid gap-4 border-t border-[#E2E8F0] pt-4">
                      <UsageDetails asset={asset} />
                      <AssetActions
                        asset={asset}
                        longRunning={deleteLongRunningAssetIds.has(asset.assetId)}
                        onDelete={() => openDeleteConfirmation(asset.assetId)}
                        onRefresh={() => void refreshAsset(asset.assetId)}
                        refreshing={refreshingAssetId !== null}
                        unresolved={unresolvedDeleteAssetIds.has(asset.assetId)}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {nextCursor && !inventoryLoading ? (
          <div className="mt-5 flex justify-center">
            <Button
              isLoading={loadingMore}
              loadingText="Loading more"
              onClick={() => void loadMore()}
              size="sm"
              variant="secondary"
            >
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      {deleteCandidate ? (
        <DeleteVideoDialog
          filename={deleteCandidate.filename}
          onCancel={closeDeleteConfirmation}
          onConfirm={() => void submitDelete()}
          submitting={deleteSubmittingAssetId === deleteCandidate.assetId}
        />
      ) : null}
    </div>
  );
}
