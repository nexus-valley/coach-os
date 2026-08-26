"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  getAssignmentAttachmentDownloadUrl,
  getAssignmentAttachments,
  removeAssignmentAttachment,
  uploadAssignmentAttachment,
  type AssignmentAttachment,
} from "@/src/lib/assignmentAttachments";
import type { AssignmentStatus } from "@/src/lib/assignments";
import { getSafeStudentAttachmentUrls } from "@/src/lib/studentAssignmentModel";

type UploadQueueItem = {
  fileName: string;
  id: string;
  status: "complete" | "failed" | "queued" | "uploading";
};

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMimeType(value: string) {
  const labels: Record<string, string> = {
    "application/msword": "DOC",
    "application/pdf": "PDF",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.document":
      "XLSX",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "DOCX",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
  };

  return labels[value] ?? "File";
}

function statusPresentation(status: AssignmentAttachment["status"]) {
  if (status === "pending_upload") {
    return { action: "Clean up", label: "Upload incomplete" };
  }

  if (status === "pending_delete") {
    return { action: "Retry removal", label: "Removal incomplete" };
  }

  return null;
}

function RemovalDialog({
  attachment,
  onCancel,
  onConfirm,
  pending,
}: {
  attachment: AssignmentAttachment;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const recovery = attachment.status !== "uploaded";

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onCancel, pending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#071521]/75 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) {
          onCancel();
        }
      }}
    >
      <div
        aria-describedby="assignment-file-removal-description"
        aria-labelledby="assignment-file-removal-title"
        aria-modal="true"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/30 sm:p-7"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="text-xl font-semibold" id="assignment-file-removal-title">
          {recovery ? "Clean up assignment file" : "Remove assignment file"}
        </h2>
        <p
          className="mt-3 break-words text-sm leading-6 text-[#526A80]"
          id="assignment-file-removal-description"
        >
          {recovery
            ? `Retry cleanup for ${attachment.displayFileName}?`
            : `Remove ${attachment.displayFileName} from this assignment?`}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            disabled={pending}
            onClick={onCancel}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            isLoading={pending}
            loadingText={recovery ? "Cleaning up..." : "Removing..."}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {recovery ? "Confirm cleanup" : "Confirm removal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AssignmentAttachmentPanel({
  assignmentId,
  assignmentStatus,
  canManage,
  legacyUrls,
}: {
  assignmentId: string;
  assignmentStatus: AssignmentStatus;
  canManage: boolean;
  legacyUrls: string[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState("");
  const [attachments, setAttachments] = useState<AssignmentAttachment[]>([]);
  const [downloadingId, setDownloadingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [removalTarget, setRemovalTarget] =
    useState<AssignmentAttachment | null>(null);
  const [removing, setRemoving] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const externalLinks = getSafeStudentAttachmentUrls(legacyUrls);
  const canChangeFiles = canManage && assignmentStatus !== "closed";
  const controlsBusy =
    loading || uploading || removing || Boolean(removalTarget);
  const visibleAttachments = attachments.filter(
    (attachment) => attachment.status === "uploaded" || canChangeFiles,
  );

  const loadAttachments = useCallback(async () => {
    const next = await getAssignmentAttachments(assignmentId);
    setAttachments(next);
    return next;
  }, [assignmentId]);

  useEffect(() => {
    let active = true;

    getAssignmentAttachments(assignmentId)
      .then((next) => {
        if (active) {
          setAttachments(next);
          setActionError("");
        }
      })
      .catch(() => {
        if (active) {
          setActionError("Assignment files could not be loaded.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [assignmentId]);

  async function handleUpload() {
    if (
      !canChangeFiles ||
      selectedFiles.length === 0 ||
      uploading ||
      removing ||
      removalTarget
    ) {
      return;
    }

    const queue = selectedFiles.map((file, index) => ({
      fileName: file.name,
      id: `${file.name}-${file.size}-${index}`,
      status: "queued" as const,
    }));
    setUploadQueue(queue);
    setUploading(true);
    setActionError("");
    setSuccess("");
    let failed = 0;
    const failureMessages: string[] = [];

    for (const [index, file] of selectedFiles.entries()) {
      setUploadQueue((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, status: "uploading" } : item,
        ),
      );

      try {
        await uploadAssignmentAttachment(assignmentId, file);
        setUploadQueue((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: "complete" } : item,
          ),
        );
      } catch (caught) {
        failed += 1;
        failureMessages.push(
          caught instanceof Error
            ? caught.message
            : "Assignment file could not be uploaded.",
        );
        setUploadQueue((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: "failed" } : item,
          ),
        );
      }
    }

    try {
      await loadAttachments();
    } catch {
      setActionError(
        "Files were processed, but the latest file list could not be loaded. Reload this page.",
      );
    }

    if (failed > 0) {
      setActionError(
        selectedFiles.length === 1
          ? failureMessages[0] ?? "Assignment file could not be uploaded."
          : `${failed} ${failed === 1 ? "file" : "files"} could not be uploaded. ${failureMessages[0] ?? "Review the selected files and retry."}`,
      );
    } else {
      setSuccess(
        selectedFiles.length === 1
          ? "Assignment file uploaded."
          : `${selectedFiles.length} assignment files uploaded.`,
      );
    }

    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploading(false);
  }

  async function handleDownload(attachment: AssignmentAttachment) {
    if (attachment.status !== "uploaded" || downloadingId) {
      return;
    }

    setDownloadingId(attachment.id);
    setActionError("");

    try {
      const result = await getAssignmentAttachmentDownloadUrl(attachment.id);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setActionError("Assignment file could not be opened.");
    } finally {
      setDownloadingId("");
    }
  }

  async function handleRemoval() {
    if (!removalTarget || !canChangeFiles || removing || uploading) {
      return;
    }

    setRemoving(true);
    setActionError("");
    setSuccess("");
    const recovery = removalTarget.status !== "uploaded";

    try {
      await removeAssignmentAttachment(removalTarget.id);
      await loadAttachments();
      setRemovalTarget(null);
      setSuccess(recovery ? "Assignment file cleanup completed." : "Assignment file removed.");
    } catch {
      setRemovalTarget(null);
      setActionError(
        recovery
          ? "Assignment file cleanup is still incomplete. Please retry."
          : "Assignment file could not be removed. Please retry.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section aria-labelledby={`assignment-files-${assignmentId}`} className="min-w-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-xl font-semibold text-[#0B1F33]"
            id={`assignment-files-${assignmentId}`}
          >
            Files
          </h2>
        </div>
        {canChangeFiles ? (
          <div className="w-full max-w-md">
            <label
              className="block text-sm font-semibold text-[#334155]"
              htmlFor={`assignment-file-input-${assignmentId}`}
            >
              Add native files
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#334155] file:mr-3 file:rounded-md file:border-0 file:bg-[#EAF7FC] file:px-3 file:py-1 file:font-semibold file:text-[#145DA0]"
                disabled={controlsBusy || attachments.length >= 10}
                id={`assignment-file-input-${assignmentId}`}
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).slice(0, 10);
                  setSelectedFiles(files);
                  setUploadQueue([]);
                  setActionError("");
                  setSuccess("");
                }}
                ref={fileInputRef}
                type="file"
              />
              <Button
                disabled={
                  controlsBusy ||
                  selectedFiles.length === 0 ||
                  attachments.length >= 10
                }
                isLoading={uploading}
                loadingText="Uploading..."
                onClick={() => void handleUpload()}
                type="button"
              >
                Upload{selectedFiles.length > 1 ? ` ${selectedFiles.length} files` : " file"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {actionError ? <FeedbackAlert className="mt-4">{actionError}</FeedbackAlert> : null}
      {success ? (
        <FeedbackAlert className="mt-4" tone="success">
          {success}
        </FeedbackAlert>
      ) : null}

      {uploadQueue.length > 0 ? (
        <ul aria-live="polite" className="mt-4 space-y-2">
          {uploadQueue.map((item) => (
            <li
              className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-[#F6FBFE] px-3 py-2 text-sm"
              key={item.id}
            >
              <span className="truncate text-[#334155]">{item.fileName}</span>
              <span className="shrink-0 font-semibold text-[#526A80]">
                {item.status === "uploading"
                  ? "Uploading"
                  : item.status === "complete"
                    ? "Uploaded"
                    : item.status === "failed"
                      ? "Failed"
                      : "Queued"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-[#334155]">Native files</h3>
        {loading ? (
          <div aria-live="polite" className="mt-3 space-y-2">
            <div className="h-14 animate-pulse rounded-lg bg-[#EAF2F7]" />
            <span className="sr-only">Loading assignment files</span>
          </div>
        ) : visibleAttachments.length === 0 ? (
          <p className="mt-2 text-sm text-[#66788F]">No native files added.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#D8E8F0] rounded-lg border border-[#D8E8F0]">
            {visibleAttachments.map((attachment) => {
              const recovery = statusPresentation(attachment.status);
              return (
                <li
                  className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                  key={attachment.id}
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-[#0B1F33]">
                      {attachment.displayFileName}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#66788F]">
                      <span>{formatMimeType(attachment.mimeType)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(attachment.byteSize)}</span>
                      <Badge tone="outline">Native file</Badge>
                      {recovery ? <Badge tone="warning">{recovery.label}</Badge> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {attachment.status === "uploaded" ? (
                      <Button
                        aria-label={`View ${attachment.displayFileName}`}
                        isLoading={downloadingId === attachment.id}
                        loadingText="Opening..."
                        onClick={() => void handleDownload(attachment)}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        View
                      </Button>
                    ) : null}
                    {canChangeFiles ? (
                      <Button
                        aria-label={`${recovery?.action ?? "Remove"} ${attachment.displayFileName}`}
                        disabled={controlsBusy}
                        onClick={() => setRemovalTarget(attachment)}
                        size="sm"
                        type="button"
                        variant={recovery ? "secondary" : "ghost"}
                      >
                        {recovery?.action ?? "Remove"}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-6 border-t border-[#D8E8F0] pt-5">
        <h3 className="text-sm font-semibold text-[#334155]">External links</h3>
        {externalLinks.length === 0 ? (
          <p className="mt-2 text-sm text-[#66788F]">No external links added.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {externalLinks.map((url, index) => (
              <a
                className="inline-flex min-h-10 max-w-full items-center rounded-lg border border-[#BFD7E6] bg-white px-3 py-2 text-sm font-semibold text-[#145DA0] transition hover:border-[#145DA0]/50 hover:bg-[#F3FAFD]"
                href={url}
                key={`${url}-${index}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                <span className="truncate">External link {index + 1}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {removalTarget ? (
        <RemovalDialog
          attachment={removalTarget}
          onCancel={() => setRemovalTarget(null)}
          onConfirm={() => void handleRemoval()}
          pending={removing}
        />
      ) : null}
    </section>
  );
}
