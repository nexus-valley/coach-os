"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { getSafeStudentAttachmentUrls } from "@/src/lib/studentAssignmentModel";
import {
  formatSubmissionAttachmentBytes,
  formatSubmissionAttachmentType,
  getSubmissionAttachmentDownloadUrl,
  getSubmissionAttachmentsForReview,
  type SubmissionAttachment,
} from "@/src/lib/submissionAttachments";

type Props = {
  assignmentId: string;
  legacyUrls: string[];
  submissionId: string;
};

export function SubmissionAttachmentReviewPanel({
  assignmentId,
  legacyUrls,
  submissionId,
}: Props) {
  const [attachments, setAttachments] = useState<SubmissionAttachment[]>([]);
  const [downloadingId, setDownloadingId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestVersionRef = useRef(0);
  const safeLegacyUrls = getSafeStudentAttachmentUrls(legacyUrls);

  const loadAttachments = useCallback(async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setError("");
    setAttachments([]);
    try {
      const next = await getSubmissionAttachmentsForReview(
        assignmentId,
        submissionId,
      );
      if (requestVersionRef.current === requestVersion) {
        setAttachments(next);
      }
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setError("Submission files could not be loaded.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setLoading(false);
      }
    }
  }, [assignmentId, submissionId]);

  useEffect(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    getSubmissionAttachmentsForReview(assignmentId, submissionId)
      .then((next) => {
        if (requestVersionRef.current === requestVersion) {
          setAttachments(next);
        }
      })
      .catch(() => {
        if (requestVersionRef.current === requestVersion) {
          setError("Submission files could not be loaded.");
        }
      })
      .finally(() => {
        if (requestVersionRef.current === requestVersion) {
          setLoading(false);
        }
      });

    return () => {
      if (requestVersionRef.current === requestVersion) {
        requestVersionRef.current += 1;
      }
    };
  }, [assignmentId, submissionId]);

  async function download(attachment: SubmissionAttachment) {
    if (downloadingId) return;
    setDownloadingId(attachment.id);
    setError("");
    try {
      const result = await getSubmissionAttachmentDownloadUrl(attachment.id);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("Submission file could not be opened.");
    } finally {
      setDownloadingId("");
    }
  }

  return (
    <div className="mt-5 space-y-5 border-t border-[#D8E8F0] pt-5">
      <section aria-busy={loading} aria-labelledby={`review-files-${submissionId}`}>
        <h4
          className="text-sm font-semibold text-[#334155]"
          id={`review-files-${submissionId}`}
        >
          Files
        </h4>
        {error ? (
          <div className="mt-3">
            <FeedbackAlert>{error}</FeedbackAlert>
            <Button
              className="mt-3"
              disabled={loading}
              onClick={() => void loadAttachments()}
              size="sm"
              type="button"
              variant="secondary"
            >
              Retry files
            </Button>
          </div>
        ) : loading ? (
          <p aria-live="polite" className="mt-2 text-sm text-[#66788F]">
            Loading files...
          </p>
        ) : attachments.length === 0 ? (
          <p className="mt-2 text-sm text-[#66788F]">No native files attached.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#D8E8F0] rounded-lg border border-[#D8E8F0]">
            {attachments.map((attachment) => (
              <li
                className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                key={attachment.id}
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-[#0B1F33]">
                    {attachment.displayFileName}
                  </p>
                  <p className="mt-1 text-xs text-[#66788F]">
                    {formatSubmissionAttachmentType(attachment.mimeType)} / {formatSubmissionAttachmentBytes(attachment.byteSize)}
                  </p>
                </div>
                <Button
                  aria-label={`Download ${attachment.displayFileName}`}
                  isLoading={downloadingId === attachment.id}
                  loadingText="Opening..."
                  onClick={() => void download(attachment)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Download
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {safeLegacyUrls.length > 0 ? (
        <section aria-labelledby={`review-links-${submissionId}`}>
          <h4
            className="text-sm font-semibold text-[#334155]"
            id={`review-links-${submissionId}`}
          >
            External links
          </h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {safeLegacyUrls.map((url, index) => (
              <a
                className="inline-flex min-h-10 items-center rounded-lg border border-[#BFD7E6] bg-white px-3 py-2 text-sm font-semibold text-[#145DA0] transition hover:border-[#145DA0]/50 hover:bg-[#F3FAFD]"
                href={url}
                key={`${url}-${index}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                External link {index + 1}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
