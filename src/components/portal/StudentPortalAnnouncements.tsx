"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatAnnouncementDate,
  getStudentAnnouncementV2,
  getStudentAnnouncementsV2,
  type StudentAnnouncementSummary,
} from "@/src/lib/announcements";
import {
  getStudentAnnouncementAudienceLabel,
  isValidAnnouncementDeepLink,
  markStudentAnnouncementReadLocally,
  mergeStudentAnnouncementPage,
} from "@/src/lib/studentAnnouncements";
import { markStudentPortalNotificationRead } from "@/src/lib/studentPortal";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import {
  PortalEmptyState,
  PortalLoadingCard,
} from "@/src/components/portal/StudentPortalShared";

const PAGE_SIZE = 25;
const listErrorMessage = "Announcements could not be loaded. Try again.";
const detailLoadErrorMessage = "This announcement could not be opened. Try again.";
const unavailableMessage = "This announcement is no longer available.";

function AnnouncementDetailDialog({
  announcement,
  onClose,
}: {
  announcement: StudentAnnouncementSummary;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = `student-announcement-${announcement.id}`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() =>
      dialog?.querySelector<HTMLElement>("button")?.focus(),
    );

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const audienceLabel = getStudentAnnouncementAudienceLabel(announcement);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#071521]/75 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <article
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-7"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="light">{audienceLabel}</Badge>
              {announcement.attention_state ? (
                <Badge
                  tone={
                    announcement.attention_state === "unread"
                      ? "info"
                      : "neutral"
                  }
                >
                  {announcement.attention_state === "unread" ? "Unread" : "Read"}
                </Badge>
              ) : null}
            </div>
            <h2
              className="mt-4 break-words text-2xl font-semibold [overflow-wrap:anywhere]"
              id={titleId}
            >
              {announcement.title}
            </h2>
          </div>
          <button
            aria-label="Close announcement"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#CBD5E1] text-lg font-semibold text-[#526A80] hover:bg-[#F1F5F9]"
            onClick={onClose}
            type="button"
          >
            X
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-[#526A80]">
          <time dateTime={announcement.published_at}>
            Published {formatAnnouncementDate(announcement.published_at)}
          </time>
          {announcement.expires_at ? (
            <time dateTime={announcement.expires_at}>
              Available until {formatAnnouncementDate(announcement.expires_at)}
            </time>
          ) : null}
        </div>

        {announcement.audience_type === "cohort" &&
        announcement.course_title ? (
          <p className="mt-3 text-sm text-[#526A80]">
            Program: {announcement.course_title}
          </p>
        ) : null}

        <div className="mt-6 whitespace-pre-wrap break-words text-sm leading-7 text-[#334155] [overflow-wrap:anywhere]">
          {announcement.body}
        </div>
      </article>
    </div>
  );
}

export function StudentPortalAnnouncements({
  context,
}: {
  context: StudentPortalContext;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const announcementParam = searchParams.get("announcement");
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const markReadAttemptedRef = useRef(new Set<string>());
  const [announcements, setAnnouncements] = useState<
    StudentAnnouncementSummary[]
  >([]);
  const [detail, setDetail] = useState<StudentAnnouncementSummary | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadAnnouncements = useCallback(
    async ({ append = false }: { append?: boolean } = {}) => {
      const requestId = ++listRequestRef.current;
      const last = append ? announcements[announcements.length - 1] : null;

      if (append && !last) {
        return;
      }

      if (append) {
        setLoadingMore(true);
      } else {
        setListLoading(true);
      }
      setListError("");

      try {
        const rows = await getStudentAnnouncementsV2({
          cursor: last
            ? { id: last.id, publishedAt: last.published_at }
            : null,
          limit: PAGE_SIZE,
        });

        if (requestId !== listRequestRef.current) {
          return;
        }

        setAnnouncements((current) =>
          append ? mergeStudentAnnouncementPage(current, rows) : rows,
        );
        setHasMore(rows.length === PAGE_SIZE);
      } catch {
        if (requestId === listRequestRef.current) {
          setListError(listErrorMessage);
        }
      } finally {
        if (requestId === listRequestRef.current) {
          setListLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [announcements],
  );

  useEffect(() => {
    const requestId = ++listRequestRef.current;
    let active = true;

    getStudentAnnouncementsV2({ limit: PAGE_SIZE })
      .then((rows) => {
        if (active && requestId === listRequestRef.current) {
          setAnnouncements(rows);
          setHasMore(rows.length === PAGE_SIZE);
          setListError("");
        }
      })
      .catch(() => {
        if (active && requestId === listRequestRef.current) {
          setListError(listErrorMessage);
        }
      })
      .finally(() => {
        if (active && requestId === listRequestRef.current) {
          setListLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const requestId = ++detailRequestRef.current;
    let active = true;

    async function loadDetail() {
      await Promise.resolve();

      if (!active) {
        return;
      }

      if (!announcementParam) {
        setDetail(null);
        setDetailError("");
        setDetailLoading(false);
        return;
      }

      if (!isValidAnnouncementDeepLink(announcementParam)) {
        setDetail(null);
        setDetailError(unavailableMessage);
        setDetailLoading(false);
        return;
      }

      const deepLinkId = announcementParam;
      setDetail(null);
      setDetailError("");
      setDetailLoading(true);

      try {
        const announcement = await getStudentAnnouncementV2(deepLinkId);

        if (!active || requestId !== detailRequestRef.current) {
          return;
        }

        if (!announcement) {
          setDetailError(unavailableMessage);
          return;
        }

        setDetail(announcement);

        if (
          announcement.attention_state !== "unread" ||
          !announcement.notification_id ||
          markReadAttemptedRef.current.has(announcement.notification_id)
        ) {
          return;
        }

        const notificationId = announcement.notification_id;
        markReadAttemptedRef.current.add(notificationId);

        try {
          const updated = await markStudentPortalNotificationRead({
            notificationId,
            tenantId: context.tenant.id,
          });

          if (
            !active ||
            requestId !== detailRequestRef.current ||
            updated.status !== "read"
          ) {
            return;
          }

          setDetail((current) =>
            current
              ? markStudentAnnouncementReadLocally(current, notificationId)
              : current,
          );
          setAnnouncements((current) =>
            current.map((row) =>
              markStudentAnnouncementReadLocally(row, notificationId),
            ),
          );
        } catch {
          // Reading content is authoritative; notification attention is best effort.
        }
      } catch {
        if (active && requestId === detailRequestRef.current) {
          setDetailError(detailLoadErrorMessage);
        }
      } finally {
        if (active && requestId === detailRequestRef.current) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();

    return () => {
      active = false;
    };
  }, [announcementParam, context.tenant.id, detailRetry]);

  function openAnnouncement(announcementId: string) {
    router.replace(
      `/portal/announcements?announcement=${encodeURIComponent(announcementId)}`,
      { scroll: false },
    );
  }

  function closeAnnouncement() {
    setDetail(null);
    setDetailError("");
    router.replace("/portal/announcements", { scroll: false });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description={`Read official updates shared by ${context.tenant.name}.`}
        eyebrow="Coach updates"
        metadata={
          announcements.length > 0 ? (
            <Badge tone="light">{announcements.length} loaded</Badge>
          ) : undefined
        }
        title="Announcements"
      />

      <SectionHeader
        description="Program updates, schedule notes, and other information shared by your Coach."
        title="Latest announcements"
      />

      {listError ? (
        <div aria-live="assertive" role="alert">
          <FeedbackAlert onRetry={() => void loadAnnouncements()} tone="error">
            {listError}
          </FeedbackAlert>
        </div>
      ) : null}

      {listLoading && announcements.length === 0 ? (
        <PortalLoadingCard label="Loading announcements" />
      ) : announcements.length === 0 && !listError ? (
        <PortalEmptyState>
          No announcements have been published for your Student Portal yet.
        </PortalEmptyState>
      ) : (
        <ul aria-label="Student announcements" className="space-y-3" role="list">
          {announcements.map((announcement) => {
            const audienceLabel =
              getStudentAnnouncementAudienceLabel(announcement);

            return (
              <li key={announcement.id}>
                <Card
                  className={[
                    "min-w-0 p-5",
                    announcement.attention_state === "unread"
                      ? "border-[#8CCFE0] bg-[#F3FAFD] shadow-sm"
                      : "border-[#D8E8F0] bg-white",
                  ].join(" ")}
                >
                  <article className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="light">{audienceLabel}</Badge>
                        {announcement.attention_state ? (
                          <Badge
                            tone={
                              announcement.attention_state === "unread"
                                ? "info"
                                : "neutral"
                            }
                          >
                            {announcement.attention_state === "unread"
                              ? "Unread"
                              : "Read"}
                          </Badge>
                        ) : null}
                      </div>
                      <h2 className="mt-3 break-words text-lg font-semibold text-[#0B1F33] [overflow-wrap:anywhere]">
                        {announcement.title}
                      </h2>
                      <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-[#425B76] [overflow-wrap:anywhere]">
                        {announcement.body}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-[#66788F]">
                        <time dateTime={announcement.published_at}>
                          Published {formatAnnouncementDate(announcement.published_at)}
                        </time>
                        {announcement.expires_at ? (
                          <time dateTime={announcement.expires_at}>
                            Until {formatAnnouncementDate(announcement.expires_at)}
                          </time>
                        ) : null}
                      </div>
                      {announcement.audience_type === "cohort" &&
                      announcement.course_title ? (
                        <p className="mt-2 text-xs text-[#66788F]">
                          Program: {announcement.course_title}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      aria-label={`Read announcement: ${announcement.title}`}
                      className="w-full sm:w-auto"
                      onClick={() => openAnnouncement(announcement.id)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Read announcement
                    </Button>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <Button
            isLoading={loadingMore}
            loadingText="Loading more"
            onClick={() => void loadAnnouncements({ append: true })}
            type="button"
            variant="secondary"
          >
            Load more
          </Button>
        </div>
      ) : null}

      {detailLoading ? (
        <div aria-live="polite" className="sr-only">
          Loading announcement detail
        </div>
      ) : null}

      {detailError ? (
        <div aria-live="assertive" role="alert">
          <FeedbackAlert
            onRetry={
              detailError === detailLoadErrorMessage
                ? () => setDetailRetry((current) => current + 1)
                : undefined
            }
            tone="warning"
          >
            {detailError}
          </FeedbackAlert>
        </div>
      ) : null}

      {detail ? (
        <AnnouncementDetailDialog
          announcement={detail}
          onClose={closeAnnouncement}
        />
      ) : null}
    </div>
  );
}
