"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  archiveNotification,
  getSafeNotificationActionUrl,
  getUserNotifications,
  markNotificationRead,
  type Notification,
  type NotificationSeverity,
  type NotificationStatus,
  type NotificationType,
} from "@/src/lib/notifications";
import { getCurrentTenant } from "@/src/lib/tenant";

const statusTabs: (NotificationStatus | "all")[] = [
  "all",
  "unread",
  "read",
  "archived",
];

const typeOptions: { label: string; value: NotificationType | "all" }[] = [
  { label: "All types", value: "all" },
  { label: "Assignments", value: "assignment_notice" },
  { label: "Communication", value: "communication_notice" },
  { label: "Sessions", value: "session_reminder" },
  { label: "Live classes", value: "live_session_notice" },
  { label: "Attendance", value: "attendance_alert" },
  { label: "Payments", value: "payment_reminder" },
  { label: "Invoices", value: "invoice_notice" },
  { label: "Invitations", value: "invitation_notice" },
  { label: "Subscriptions", value: "subscription_notice" },
  { label: "System", value: "system_notice" },
];

const severityOptions: { label: string; value: NotificationSeverity | "all" }[] =
  [
    { label: "All severity", value: "all" },
    { label: "Info", value: "info" },
    { label: "Warning", value: "warning" },
    { label: "Critical", value: "critical" },
  ];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getSeverityClass(severity: Notification["severity"]) {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (severity === "warning") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }

  return "border-cyan-200 bg-cyan-50 text-cyan-700";
}

function getTypeLabel(type: NotificationType) {
  return (
    typeOptions.find((option) => option.value === type)?.label ??
    type
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function NotificationsPageClient() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [severity, setSeverity] = useState<NotificationSeverity | "all">("all");
  const [status, setStatus] = useState<NotificationStatus | "all">("all");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [type, setType] = useState<NotificationType | "all">("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.status === "unread")
      .length,
    [notifications],
  );
  const criticalCount = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          notification.severity === "critical" &&
          notification.status !== "archived",
      ).length,
    [notifications],
  );

  async function loadNotifications(
    nextStatus = status,
    nextType = type,
    nextSeverity = severity,
  ) {
    setLoading(true);

    try {
      const tenant = await getCurrentTenant();

      if (!tenant) {
        throw new Error("Workspace context is not available.");
      }

      setTenantId(tenant.id);
      const rows = await getUserNotifications(tenant.id, {
        limit: 100,
        severity: nextSeverity,
        status: nextStatus,
        type: nextType,
      });
      setNotifications(rows);
      setError("");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to load notifications."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const tenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!tenant) {
          throw new Error("Workspace context is not available.");
        }

        setTenantId(tenant.id);
        const rows = await getUserNotifications(tenant.id, {
          limit: 100,
          severity,
          status,
          type,
        });

        if (active) {
          setNotifications(rows);
          setError("");
        }
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load notifications."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [severity, status, type]);

  async function handleStatusChange(nextStatus: NotificationStatus | "all") {
    setStatus(nextStatus);
  }

  async function handleTypeChange(nextType: NotificationType | "all") {
    setType(nextType);
  }

  async function handleSeverityChange(
    nextSeverity: NotificationSeverity | "all",
  ) {
    setSeverity(nextSeverity);
  }

  async function handleMarkRead(notificationId: string) {
    if (!tenantId) {
      return;
    }

    setUpdatingId(notificationId);
    setError("");

    try {
      await markNotificationRead(tenantId, notificationId);
      await loadNotifications();
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to mark notification as read."));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleArchive(notificationId: string) {
    if (!tenantId) {
      return;
    }

    setUpdatingId(notificationId);
    setError("");

    try {
      await archiveNotification(tenantId, notificationId);
      await loadNotifications();
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to archive notification."));
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-[#D8E8F0] bg-white">
          <span className="sr-only">Loading notifications</span>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Badge className="border-[#14B8C6]/30 bg-[#14B8C6]/10 text-[#0E7490]">
            Communication center
          </Badge>
          <h2 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Notifications
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#425B76]">
            In-app alerts for sessions, attendance, billing, invitations, and
            workspace operations.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm shadow-sm">
            <p className="text-xs font-semibold text-[#66788F]">Unread</p>
            <p className="mt-1 text-2xl font-semibold text-[#0B1F33]">
              {unreadCount}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm shadow-sm">
            <p className="text-xs font-semibold text-[#66788F]">Critical</p>
            <p className="mt-1 text-2xl font-semibold text-[#0B1F33]">
              {criticalCount}
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-6">
          <FeedbackAlert onRetry={() => loadNotifications()}>{error}</FeedbackAlert>
        </div>
      ) : null}

      <Card className="mt-8 border-[#D8E8F0] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {statusTabs.map((tab) => (
              <button
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  status === tab
                    ? "border-[#145DA0] bg-[#145DA0] text-white"
                    : "border-[#D8E8F0] bg-white text-[#425B76] hover:border-[#2ECBEA]/60 hover:bg-[#F3FAFD]",
                ].join(" ")}
                key={tab}
                onClick={() => handleStatusChange(tab)}
                type="button"
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-[#425B76] sm:w-64">
              Type
              <select
                className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none focus:border-[#2ECBEA]"
                onChange={(event) =>
                  handleTypeChange(
                    event.target.value as NotificationType | "all",
                  )
                }
                value={type}
              >
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-[#425B76] sm:w-64">
              Severity
              <select
                className="h-11 rounded-2xl border border-[#D8E8F0] bg-white px-4 text-sm font-medium text-[#0B1F33] outline-none focus:border-[#2ECBEA]"
                onChange={(event) =>
                  handleSeverityChange(
                    event.target.value as NotificationSeverity | "all",
                  )
                }
                value={severity}
              >
                {severityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </Card>

      <div className="mt-6 space-y-4">
        {notifications.length === 0 ? (
          <Card className="border-dashed border-[#C7DDEA] bg-white p-10 text-center text-[#0B1F33]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#9ADDEA] bg-[#EAF8FC] text-[#145DA0]">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </div>
            <h3 className="mt-5 text-xl font-semibold">No notifications yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#425B76]">
              Session reminders, attendance alerts, billing notices, and system
              updates will appear here.
            </p>
          </Card>
        ) : (
          notifications.map((notification) => (
            <Card
              className="border-[#D8E8F0] bg-white p-5 text-[#0B1F33] shadow-lg shadow-[#0B2A3D]/5 transition hover:-translate-y-0.5 hover:shadow-xl"
              key={notification.id}
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#9ADDEA] bg-[#EAF8FC] text-sm font-bold text-[#145DA0]">
                    NT
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[#0B1F33]">
                        {notification.title}
                      </h3>
                      <Badge
                        className={getSeverityClass(notification.severity)}
                      >
                        {notification.severity}
                      </Badge>
                      <Badge
                        className={
                          notification.status === "unread"
                            ? "border-[#9ADDEA] bg-[#EAF8FC] text-[#0B6F87]"
                            : "border-[#D8E8F0] bg-[#F6FBFE] text-[#425B76]"
                        }
                      >
                        {notification.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#425B76]">
                      {notification.message}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium text-[#66788F]">
                      <span>{getTypeLabel(notification.type)}</span>
                      <span>{formatDate(notification.created_at)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {getSafeNotificationActionUrl(notification.action_url) ? (
                    <Button
                      href={
                        getSafeNotificationActionUrl(notification.action_url) ??
                        "/app/notifications"
                      }
                      size="sm"
                      variant="secondary"
                    >
                      Open
                    </Button>
                  ) : null}
                  {notification.status === "unread" ? (
                    <Button
                      disabled={updatingId === notification.id}
                      onClick={() => handleMarkRead(notification.id)}
                      size="sm"
                      variant="secondary"
                    >
                      Mark read
                    </Button>
                  ) : null}
                  {notification.status !== "archived" ? (
                    <Button
                      disabled={updatingId === notification.id}
                      onClick={() => handleArchive(notification.id)}
                      size="sm"
                      variant="ghost"
                    >
                      Archive
                    </Button>
                  ) : null}
                  {!notification.action_url ? (
                    <Link className="sr-only" href="/app/notifications">
                      Current notification
                    </Link>
                  ) : null}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
