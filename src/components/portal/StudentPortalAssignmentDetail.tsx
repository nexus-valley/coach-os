"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
} from "@/src/components/portal/StudentPortalShared";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  formatStudentAssignmentDateTime,
  getStudentAssignmentViewModel,
} from "@/src/lib/studentAssignmentModel";
import {
  getStudentAssignmentDetail,
  getStudentAssignmentErrorMessage,
  submitStudentAssignment,
  type StudentAssignmentItem,
} from "@/src/lib/studentPortalAssignments";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";

function AttachmentLinks({
  label,
  urls,
}: {
  label: string;
  urls: string[];
}) {
  if (urls.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="text-sm font-semibold text-[#334155]">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {urls.map((url, index) => (
          <a
            className="inline-flex min-h-10 items-center rounded-lg border border-[#BFD7E6] bg-white px-3 py-2 text-sm font-semibold text-[#145DA0] transition hover:border-[#145DA0]/50 hover:bg-[#F3FAFD]"
            href={url}
            key={`${url}-${index}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            {label} {index + 1}
          </a>
        ))}
      </div>
    </div>
  );
}

function ResubmissionDialog({
  hasReview,
  onCancel,
  onConfirm,
  pending,
}: {
  hasReview: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

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

  const description = hasReview
    ? "Resubmitting will replace your current submission and clear the existing score and feedback until your coach reviews it again."
    : "Resubmit this assignment? Your current submission will be replaced.";

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
        aria-describedby="resubmit-assignment-description"
        aria-labelledby="resubmit-assignment-title"
        aria-modal="true"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/30 sm:p-7"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="text-xl font-semibold" id="resubmit-assignment-title">
          Resubmit assignment
        </h2>
        <p
          className="mt-3 text-sm leading-6 text-[#526A80]"
          id="resubmit-assignment-description"
        >
          {description}
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
            loadingText="Resubmitting..."
            onClick={onConfirm}
            type="button"
          >
            Confirm resubmission
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailUnavailable() {
  return (
    <Card className="border-[#D8E8F0] bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-semibold text-[#0B1F33]">
        Assignment unavailable
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#526A80]">
        This assignment may be unpublished, unavailable for your program, or no
        longer accessible to your account.
      </p>
      <Button className="mt-6" href="/portal/assignments" variant="secondary">
        Back to My Assignments
      </Button>
    </Card>
  );
}

export function StudentPortalAssignmentDetail({
  assignmentId,
  context,
}: {
  assignmentId: string;
  context: StudentPortalContext;
}) {
  const [actionError, setActionError] = useState("");
  const [detail, setDetail] = useState<StudentAssignmentItem | null>(null);
  const [error, setError] = useState("");
  const [initialText, setInitialText] = useState("");
  const [loading, setLoading] = useState(true);
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionText, setSubmissionText] = useState("");
  const [success, setSuccess] = useState("");
  const submittingRef = useRef(false);

  const applyDetail = useCallback((next: StudentAssignmentItem | null) => {
    setDetail(next);
    const nextText = next?.submission?.submission_text ?? "";
    setSubmissionText(nextText);
    setInitialText(nextText);
  }, []);

  const loadDetail = useCallback(async () => {
    const next = await getStudentAssignmentDetail(context, assignmentId);
    applyDetail(next);
    return next;
  }, [applyDetail, assignmentId, context]);

  useEffect(() => {
    let active = true;

    getStudentAssignmentDetail(context, assignmentId)
      .then((next) => {
        if (active) {
          applyDetail(next);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) {
          setError(getStudentAssignmentErrorMessage(caught));
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
  }, [applyDetail, assignmentId, context]);

  const view = useMemo(
    () =>
      getStudentAssignmentViewModel({
        dueAt: detail?.assignment.due_at,
        status: detail?.assignment.status,
        submission: detail?.submission ?? null,
      }),
    [detail],
  );
  const resubmissionDirty = submissionText.trim() !== initialText.trim();
  const hasExistingReview = Boolean(
    detail?.submission &&
      (view.hasReview ||
        detail.submission.score !== null ||
        detail.submission.feedback),
  );

  async function performSubmit() {
    if (!detail || !view.canSubmit || submittingRef.current) {
      return;
    }

    const isResubmission = Boolean(detail.submission);
    submittingRef.current = true;
    setSubmitting(true);
    setActionError("");
    setSuccess("");

    try {
      await submitStudentAssignment({
        assignmentId,
        attachmentUrls: detail.submission?.attachment_urls_json ?? [],
        context,
        submissionText,
      });
      await loadDetail();
      setResubmitOpen(false);
      setSuccess(
        isResubmission
          ? "Assignment resubmitted successfully."
          : "Assignment submitted successfully.",
      );
    } catch (caught) {
      let refreshed: StudentAssignmentItem | null = detail;

      try {
        refreshed = await loadDetail();
      } catch {
        refreshed = null;
      }

      setResubmitOpen(false);
      setActionError(
        refreshed?.assignment.status === "closed"
          ? "This assignment has been closed and can no longer accept submissions."
          : getStudentAssignmentErrorMessage(caught),
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (loading) {
    return <PortalLoadingCard label="Loading assignment detail" />;
  }

  if (error) {
    return <PortalError message={error} />;
  }

  if (!detail || view.state === "unavailable") {
    return <DetailUnavailable />;
  }

  const submission = detail.submission;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className="text-sm font-semibold text-[#145DA0] transition hover:text-[#0B2A3D]"
          href="/portal/assignments"
        >
          Back to My Assignments
        </Link>
        <Button href="/portal/courses" size="sm" variant="secondary">
          My Programs
        </Button>
      </div>

      <Card className="border-[#D8E8F0] bg-white p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge tone={view.isClosed ? "neutral" : "admin"}>
                {view.label}
              </Badge>
              {view.isLate ? <Badge tone="warning">Submitted late</Badge> : null}
            </div>
            <h1 className="mt-4 break-words text-3xl font-semibold text-[#0B1F33]">
              {detail.assignment.title}
            </h1>
            <p className="mt-3 text-sm font-semibold text-[#145DA0]">
              {detail.course?.title ?? "Assigned program"}
            </p>
            {detail.cohort ? (
              <p className="mt-1 text-sm text-[#526A80]">
                Cohort: {detail.cohort.name}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 space-y-2 text-sm text-[#526A80] sm:text-right">
            <p>
              <span className="font-semibold text-[#334155]">Due:</span>{" "}
              {formatStudentAssignmentDateTime(detail.assignment.due_at)}
            </p>
            {detail.assignment.max_score !== null ? (
              <p>
                <span className="font-semibold text-[#334155]">Max score:</span>{" "}
                {detail.assignment.max_score}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="border-[#D8E8F0] bg-white p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-[#0B1F33]">
          Assignment instructions
        </h2>
        <div className="mt-5 space-y-5">
          <div>
            <p className="text-sm font-semibold text-[#334155]">Overview</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#526A80]">
              {detail.assignment.description || "No overview was provided."}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#334155]">Instructions</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#526A80]">
              {detail.assignment.instructions || "No additional instructions were provided."}
            </p>
          </div>
          <AttachmentLinks
            label="Assignment attachment"
            urls={detail.assignment.attachment_urls_json}
          />
        </div>
      </Card>

      {actionError ? <FeedbackAlert>{actionError}</FeedbackAlert> : null}
      {success ? (
        <FeedbackAlert tone="success">{success}</FeedbackAlert>
      ) : null}

      <Card className="border-[#D8E8F0] bg-white p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-[#0B1F33]">
          Current submission
        </h2>
        {submission ? (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={view.isLate ? "warning" : "light"}>
                {view.hasReview
                  ? "Reviewed"
                  : view.isLate
                    ? "Submitted late"
                    : "Submitted"}
              </Badge>
              {submission.submitted_at ? (
                <span className="text-sm text-[#526A80]">
                  Submitted {formatStudentAssignmentDateTime(submission.submitted_at)}
                </span>
              ) : null}
            </div>
            <div className="rounded-lg bg-[#F6FBFE] p-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#334155]">
                {submission.submission_text || "No submission text recorded."}
              </p>
            </div>
            <AttachmentLinks
              label="Submission attachment"
              urls={submission.attachment_urls_json}
            />
          </div>
        ) : (
          <div className="mt-5">
            <PortalEmptyState>
              {view.isClosed
                ? "Assignment closed - no submission recorded."
                : "No submission has been recorded yet."}
            </PortalEmptyState>
          </div>
        )}

        {view.canSubmit ? (
          <div className="mt-6 border-t border-[#D8E8F0] pt-6">
            <label
              className="text-sm font-semibold text-[#334155]"
              htmlFor="student-assignment-submission"
            >
              {submission ? "Revise your current submission" : "Your submission"}
            </label>
            <textarea
              className="mt-2 min-h-40 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-7 text-[#0B1F33] outline-none transition placeholder:text-[#66788F] focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
              id="student-assignment-submission"
              maxLength={6000}
              onChange={(event) => setSubmissionText(event.target.value)}
              placeholder="Write your assignment response"
              value={submissionText}
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-[#66788F]">
                {submission
                  ? "Only your current submission is retained."
                  : "Your coach will see this as your current submission."}
              </p>
              <Button
                disabled={Boolean(submission) && !resubmissionDirty}
                isLoading={submitting && !resubmitOpen}
                loadingText="Submitting..."
                onClick={() => {
                  if (submission) {
                    setResubmitOpen(true);
                  } else {
                    void performSubmit();
                  }
                }}
                type="button"
              >
                {submission ? "Resubmit assignment" : "Submit assignment"}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="border-[#D8E8F0] bg-white p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-[#0B1F33]">
          Coach feedback
        </h2>
        {submission && view.hasReview ? (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">Reviewed</Badge>
              {submission.reviewed_at ? (
                <span className="text-sm text-[#526A80]">
                  Reviewed {formatStudentAssignmentDateTime(submission.reviewed_at)}
                </span>
              ) : null}
            </div>
            <p className="text-lg font-semibold text-[#0B1F33]">
              Score: {submission.score ?? "Not scored"}
              {detail.assignment.max_score !== null
                ? ` / ${detail.assignment.max_score}`
                : ""}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#526A80]">
              {submission.feedback || "No written feedback was added."}
            </p>
          </div>
        ) : submission ? (
          <p className="mt-4 text-sm leading-6 text-[#526A80]">
            Submitted - awaiting review.
          </p>
        ) : view.isClosed ? (
          <p className="mt-4 text-sm leading-6 text-[#526A80]">
            Assignment closed - no submission recorded.
          </p>
        ) : (
          <p className="mt-4 text-sm leading-6 text-[#526A80]">
            Feedback will appear here after your coach reviews your submission.
          </p>
        )}
      </Card>

      {resubmitOpen ? (
        <ResubmissionDialog
          hasReview={hasExistingReview}
          onCancel={() => setResubmitOpen(false)}
          onConfirm={() => void performSubmit()}
          pending={submitting}
        />
      ) : null}
    </div>
  );
}
