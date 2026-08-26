"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  cleanupSubmissionAttachments,
  deriveSubmissionAttachmentSelection,
  formatSubmissionAttachmentBytes,
  formatSubmissionAttachmentType,
  getAssociatedSubmissionAttachmentIds,
  getStudentSubmissionAttachments,
  getSubmissionAttachmentDownloadUrl,
  removeSubmissionAttachment,
  toggleSubmissionAttachmentSelection,
  uploadSubmissionAttachment,
  type SubmissionAttachment,
} from "@/src/lib/submissionAttachments";

export type StudentSubmissionAttachmentPanelHandle = {
  refreshAfterSubmit: () => Promise<{ cleanupFailed: boolean }>;
};

type Props = {
  assignmentId: string;
  canSubmit: boolean;
  mutationsDisabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onReadyChange: (ready: boolean) => void;
  onSelectionChange: (ids: string[], dirty: boolean) => void;
};

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

export const StudentSubmissionAttachmentPanel = forwardRef<
  StudentSubmissionAttachmentPanelHandle,
  Props
>(function StudentSubmissionAttachmentPanel(
  {
    assignmentId,
    canSubmit,
    mutationsDisabled,
    onBusyChange,
    onReadyChange,
    onSelectionChange,
  },
  ref,
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<SubmissionAttachment[]>([]);
  const selectedRef = useRef<string[]>([]);
  const [actionError, setActionError] = useState("");
  const [attachments, setAttachments] = useState<SubmissionAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [success, setSuccess] = useState("");

  const setBusyState = useCallback(
    (next: boolean) => {
      setBusy(next);
      onBusyChange(next);
    },
    [onBusyChange],
  );

  const applyWorkspace = useCallback(
    (next: SubmissionAttachment[], mode: "canonical" | "preserve") => {
      const normalizedSelection = deriveSubmissionAttachmentSelection({
        attachments: next,
        mode,
        previousAttachments: attachmentsRef.current,
        previousSelectedIds: selectedRef.current,
      });
      const associatedIds = getAssociatedSubmissionAttachmentIds(next);
      const dirty = !sameIds(normalizedSelection, associatedIds);

      attachmentsRef.current = next;
      selectedRef.current = normalizedSelection;
      setAttachments(next);
      setSelectedIds(normalizedSelection);
      onSelectionChange(normalizedSelection, dirty);
      return next;
    },
    [onSelectionChange],
  );

  const loadWorkspace = useCallback(
    async (mode: "canonical" | "preserve") => {
      const next = await getStudentSubmissionAttachments(assignmentId);
      return applyWorkspace(next, mode);
    },
    [applyWorkspace, assignmentId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    onReadyChange(false);

    getStudentSubmissionAttachments(assignmentId)
      .then((next) => {
        if (active) {
          applyWorkspace(next, "canonical");
          setActionError("");
          onReadyChange(true);
        }
      })
      .catch(() => {
        if (active) setActionError("Submission files could not be loaded.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [applyWorkspace, assignmentId, onReadyChange]);

  async function retryWorkspace() {
    setLoading(true);
    onReadyChange(false);
    setActionError("");
    try {
      await loadWorkspace("canonical");
      onReadyChange(true);
    } catch {
      setActionError("Submission files could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      async refreshAfterSubmit() {
        const afterSubmit = await loadWorkspace("canonical");
        const pendingDeleteIds = afterSubmit
          .filter((item) => item.status === "pending_delete")
          .map((item) => item.id);
        const failedIds = await cleanupSubmissionAttachments(pendingDeleteIds);

        try {
          await loadWorkspace("canonical");
        } catch {
          return { cleanupFailed: true };
        }

        return { cleanupFailed: failedIds.length > 0 };
      },
    }),
    [loadWorkspace],
  );

  function updateAssociatedSelection(attachmentId: string, selected: boolean) {
    if (!canSubmit || busy || mutationsDisabled) return;
    const next = toggleSubmissionAttachmentSelection({
      attachmentId,
      selected,
      selectedIds: selectedRef.current,
    });
    if (next.length > 10) {
      setActionError("A submission can include no more than 10 native files.");
      return;
    }

    const associatedIds = getAssociatedSubmissionAttachmentIds(
      attachmentsRef.current,
    );
    selectedRef.current = next;
    setSelectedIds(next);
    onSelectionChange(next, !sameIds(next, associatedIds));
    setActionError("");
    setSuccess("");
  }

  async function handleUpload() {
    if (!canSubmit || busy || mutationsDisabled || selectedFiles.length === 0) {
      return;
    }
    const remaining = 10 - selectedRef.current.length;
    if (selectedFiles.length > remaining) {
      setActionError(`Choose no more than ${remaining} additional ${remaining === 1 ? "file" : "files"}.`);
      return;
    }

    setBusyState(true);
    setActionError("");
    setSuccess("");
    let failed = 0;

    for (const file of selectedFiles) {
      try {
        await uploadSubmissionAttachment(assignmentId, file);
      } catch {
        failed += 1;
      }
    }

    let workspaceLoaded = true;
    try {
      await loadWorkspace("preserve");
    } catch {
      workspaceLoaded = false;
      onReadyChange(false);
      setActionError("Submission files could not be loaded.");
    }

    if (!workspaceLoaded) {
      setSuccess("");
    } else if (failed > 0) {
      setActionError(`${failed} ${failed === 1 ? "file" : "files"} could not be uploaded. Review the file type and size, then retry.`);
    } else {
      setSuccess(selectedFiles.length === 1 ? "File ready to submit." : `${selectedFiles.length} files ready to submit.`);
    }

    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setBusyState(false);
  }

  async function handleCleanup(attachment: SubmissionAttachment) {
    if (
      busy ||
      mutationsDisabled ||
      (attachment.isAssociated && attachment.status === "uploaded")
    ) {
      return;
    }
    setBusyState(true);
    setActionError("");
    setSuccess("");

    let removalCompleted = false;
    try {
      await removeSubmissionAttachment(attachment.id);
      removalCompleted = true;
      selectedRef.current = selectedRef.current.filter((id) => id !== attachment.id);
      await loadWorkspace("preserve");
      setSuccess(
        attachment.status === "uploaded"
          ? "File removed."
          : "File cleanup completed.",
      );
    } catch {
      if (removalCompleted) {
        onReadyChange(false);
        setActionError("Submission files could not be loaded.");
      } else {
        setActionError("File cleanup is incomplete. Retry when you are ready.");
      }
    } finally {
      setBusyState(false);
    }
  }

  async function handleDownload(attachment: SubmissionAttachment) {
    if (attachment.status !== "uploaded" || downloadingId) return;
    setDownloadingId(attachment.id);
    setActionError("");
    try {
      const result = await getSubmissionAttachmentDownloadUrl(attachment.id);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setActionError("Submission file could not be opened.");
    } finally {
      setDownloadingId("");
    }
  }

  const remaining = Math.max(0, 10 - selectedIds.length);

  return (
    <section
      aria-busy={busy || loading}
      aria-labelledby={`submission-files-${assignmentId}`}
      className="mt-6 min-w-0 border-t border-[#D8E8F0] pt-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3
            className="text-lg font-semibold text-[#0B1F33]"
            id={`submission-files-${assignmentId}`}
          >
            Files
          </h3>
          <p className="mt-1 text-sm leading-6 text-[#66788F]">
            PDF, PNG, JPEG, DOC, DOCX, XLS, or XLSX. Up to 10 MB each and 10 files per submission.
          </p>
        </div>
        {canSubmit ? (
          <div className="w-full max-w-md">
            <label
              className="sr-only"
              htmlFor={`submission-file-input-${assignmentId}`}
            >
              Choose submission files
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#334155] file:mr-3 file:rounded-md file:border-0 file:bg-[#EAF7FC] file:px-3 file:py-1 file:font-semibold file:text-[#145DA0]"
                disabled={busy || loading || mutationsDisabled || remaining === 0}
                id={`submission-file-input-${assignmentId}`}
                multiple
                onChange={(event) => {
                  setSelectedFiles(Array.from(event.target.files ?? []).slice(0, 10));
                  setActionError("");
                  setSuccess("");
                }}
                ref={fileInputRef}
                type="file"
              />
              <Button
                disabled={
                  busy ||
                  loading ||
                  mutationsDisabled ||
                  selectedFiles.length === 0 ||
                  remaining === 0
                }
                isLoading={busy && selectedFiles.length > 0}
                loadingText="Uploading..."
                onClick={() => void handleUpload()}
                type="button"
              >
                Upload
              </Button>
            </div>
            <p className="mt-2 text-xs text-[#66788F]">{remaining} file slots available</p>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <FeedbackAlert
          className="mt-4"
          onRetry={
            actionError === "Submission files could not be loaded."
              ? () => void retryWorkspace()
              : undefined
          }
        >
          {actionError}
        </FeedbackAlert>
      ) : null}
      {success ? <FeedbackAlert className="mt-4" tone="success">{success}</FeedbackAlert> : null}

      {loading ? (
        <div aria-live="polite" className="mt-4 space-y-2">
          <div className="h-16 animate-pulse rounded-lg bg-[#EAF2F7]" />
          <span className="sr-only">Loading submission files</span>
        </div>
      ) : attachments.length === 0 ? (
        <p className="mt-4 text-sm text-[#66788F]">No native files added.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#D8E8F0] rounded-lg border border-[#D8E8F0]">
          {attachments.map((attachment) => {
            const selected = selectedIds.includes(attachment.id);
            const recoveryLabel =
              attachment.status === "pending_upload"
                ? "Upload incomplete"
                : attachment.status === "pending_delete"
                  ? "Removal incomplete"
                  : null;
            return (
              <li className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between" key={attachment.id}>
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-[#0B1F33]">{attachment.displayFileName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#66788F]">
                    <span>{formatSubmissionAttachmentType(attachment.mimeType)}</span>
                    <span aria-hidden="true">/</span>
                    <span>{formatSubmissionAttachmentBytes(attachment.byteSize)}</span>
                    {attachment.isAssociated ? <Badge tone="outline">Current submission</Badge> : null}
                    {attachment.status === "uploaded" && !attachment.isAssociated ? <Badge tone="light">Ready to submit</Badge> : null}
                    {attachment.isAssociated && !selected ? <Badge tone="warning">Will be removed on resubmit</Badge> : null}
                    {recoveryLabel ? <Badge tone="warning">{recoveryLabel}</Badge> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {attachment.isAssociated && attachment.status === "uploaded" && canSubmit ? (
                    <label className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[#334155]">
                      <input
                        checked={selected}
                        disabled={busy || mutationsDisabled}
                        onChange={(event) => updateAssociatedSelection(attachment.id, event.target.checked)}
                        type="checkbox"
                      />
                      Keep with submission
                    </label>
                  ) : null}
                  {attachment.status === "uploaded" ? (
                    <Button
                      aria-label={`Download ${attachment.displayFileName}`}
                      isLoading={downloadingId === attachment.id}
                      loadingText="Opening..."
                      onClick={() => void handleDownload(attachment)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Download
                    </Button>
                  ) : null}
                  {!attachment.isAssociated &&
                  (attachment.status !== "uploaded" || canSubmit) ? (
                    <Button
                      aria-label={`${attachment.status === "uploaded" ? "Remove" : "Retry cleanup for"} ${attachment.displayFileName}`}
                      disabled={busy || mutationsDisabled}
                      onClick={() => void handleCleanup(attachment)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {attachment.status === "uploaded" ? "Remove" : "Retry cleanup"}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
