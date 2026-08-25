"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  formatPortalDateTime,
  PortalEmptyState,
  PortalLoadingCard,
} from "@/src/components/portal/StudentPortalShared";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import {
  getStudentPortalNotifications,
  markStudentPortalNotificationRead,
  type StudentPortalNotification,
} from "@/src/lib/studentPortal";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  getSafeStudentNotificationActionUrl,
  getSafeStudentNotificationTimestamp,
  getStudentNotificationActionLabel,
} from "@/src/lib/studentPortalNotifications";

const loadErrorMessage = "Unable to load notifications right now. Please try again.";
const markReadErrorMessage =
  "Unable to mark this notification as read. Please try again.";

function loadNotificationsForContext(context: StudentPortalContext) {
  return getStudentPortalNotifications({
    accessMode: "student",
    studentId: context.student.id,
    tenantId: context.tenant.id,
  });
}

export function StudentPortalNotifications({
  context,
}: {
  context: StudentPortalContext;
}) {
  const router = useRouter();
  const mountedRef = useRef(true);
  const pendingIdsRef = useRef(new Set<string>());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<
    StudentPortalNotification[]
  >([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [recentlyReadIds, setRecentlyReadIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const rows = await loadNotificationsForContext(context);

        if (active) {
          setNotifications(rows);
          setError("");
        }
      } catch {
        if (active) {
          setError(loadErrorMessage);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [context]);

  async function retryLoadNotifications() {
    setLoading(true);
    setError("");

    try {
      const rows = await loadNotificationsForContext(context);

      if (!mountedRef.current) {
        return;
      }

      setNotifications(rows);
    } catch {
      if (mountedRef.current) {
        setError(loadErrorMessage);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  function setNotificationPending(notificationId: string, pending: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);

      if (pending) {
        next.add(notificationId);
      } else {
        next.delete(notificationId);
      }

      return next;
    });
  }

  async function markRead(notificationId: string) {
    if (pendingIdsRef.current.has(notificationId)) {
      return false;
    }

    pendingIdsRef.current.add(notificationId);
    setNotificationPending(notificationId, true);
    setError("");

    try {
      const updated = await markStudentPortalNotificationRead({
        notificationId,
        tenantId: context.tenant.id,
      });

      if (!mountedRef.current) {
        return false;
      }

      setNotifications((current) =>
        current.map((notification) =>
          notification.id === updated.id
            ? {
                ...notification,
                read_at: updated.read_at,
                status: updated.status,
              }
            : notification,
        ),
      );
      setRecentlyReadIds((current) => new Set(current).add(notificationId));
      return true;
    } catch {
      if (mountedRef.current) {
        setError(markReadErrorMessage);
      }
      return false;
    } finally {
      pendingIdsRef.current.delete(notificationId);

      if (mountedRef.current) {
        setNotificationPending(notificationId, false);
      }
    }
  }

  async function handleUnreadAction(
    notification: StudentPortalNotification,
    actionUrl: string,
  ) {
    const markedRead = await markRead(notification.id);

    if (markedRead && mountedRef.current) {
      router.push(actionUrl);
    }
  }

  if (loading) {
    return <PortalLoadingCard label="Loading notifications" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Updates about your programs, assignments, and learning activity."
        eyebrow="Updates"
        title="Notifications"
      />

      {error ? (
        <div aria-live="assertive" role="alert">
          <FeedbackAlert onRetry={() => void retryLoadNotifications()}>
            {error}
          </FeedbackAlert>
        </div>
      ) : null}

      {notifications.length === 0 && !error ? (
        <PortalEmptyState>No notifications yet.</PortalEmptyState>
      ) : notifications.length > 0 ? (
        <ul aria-label="Student notifications" className="space-y-3" role="list">
          {notifications.map((notification) => {
            const isUnread = notification.status === "unread";
            const isPending = pendingIds.has(notification.id);
            const wasRecentlyRead = recentlyReadIds.has(notification.id);
            const actionUrl = getSafeStudentNotificationActionUrl(
              notification.action_url,
            );
            const actionLabel = actionUrl
              ? getStudentNotificationActionLabel({
                  actionUrl,
                  type: notification.type,
                })
              : null;
            const createdAt = getSafeStudentNotificationTimestamp(
              notification.created_at,
            );
            const readAt = getSafeStudentNotificationTimestamp(
              notification.read_at,
            );

            return (
              <li key={notification.id}>
                <Card
                  className={[
                    "min-w-0 p-5",
                    isUnread
                      ? "border-[#8CCFE0] bg-[#F3FAFD] shadow-sm"
                      : "border-[#D8E8F0] bg-white",
                  ].join(" ")}
                >
                  <article
                    aria-label={`${notification.title}. ${isUnread ? "Unread" : "Read"} notification.`}
                    className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words font-semibold text-[#0B1F33] [overflow-wrap:anywhere]">
                          {notification.title}
                        </h2>
                        <Badge tone={isUnread ? "info" : "neutral"}>
                          {isUnread ? "Unread" : "Read"}
                        </Badge>
                      </div>
                      <p className="mt-2 break-words text-sm leading-6 text-[#425B76] [overflow-wrap:anywhere]">
                        {notification.message}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-[#66788F]">
                        <time dateTime={createdAt ?? undefined}>
                          {formatPortalDateTime(createdAt)}
                        </time>
                        {!isUnread && readAt ? (
                          <span>
                            Read {formatPortalDateTime(readAt)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col gap-2 sm:items-end">
                      {actionUrl && actionLabel ? (
                        isUnread ? (
                          <Button
                            aria-label={`${actionLabel}: ${notification.title}`}
                            className="w-full sm:w-auto"
                            isLoading={isPending}
                            loadingText="Marking as read"
                            onClick={() =>
                              void handleUnreadAction(notification, actionUrl)
                            }
                            size="sm"
                            type="button"
                          >
                            {actionLabel}
                          </Button>
                        ) : (
                          <Button
                            aria-label={`${actionLabel}: ${notification.title}`}
                            className="w-full sm:w-auto"
                            href={actionUrl}
                            size="sm"
                          >
                            {actionLabel}
                          </Button>
                        )
                      ) : isUnread || wasRecentlyRead ? (
                        <Button
                          aria-label={
                            wasRecentlyRead
                              ? `${notification.title} marked as read`
                              : `Mark ${notification.title} as read`
                          }
                          className="w-full sm:w-auto"
                          disabled={wasRecentlyRead}
                          isLoading={isPending}
                          loadingText="Marking as read"
                          onClick={() => void markRead(notification.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {wasRecentlyRead ? "Marked as read" : "Mark as read"}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
