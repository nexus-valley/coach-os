"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import {
  getSafeNotificationActionUrl,
  getUnreadNotificationCount,
  getUserNotifications,
  markNotificationRead,
  type Notification,
} from "@/src/lib/notifications";
import { getCurrentTenant } from "@/src/lib/tenant";

function formatNotificationTime(value: string) {
  const timestamp = new Date(value).getTime();
  const minutes = Math.max(Math.floor((Date.now() - timestamp) / 60_000), 0);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
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

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  async function loadNotifications() {
    const tenant = await getCurrentTenant();

    if (!tenant) {
      return;
    }

    setTenantId(tenant.id);
    const [unreadCount, recent] = await Promise.all([
      getUnreadNotificationCount(tenant.id),
      getUserNotifications(tenant.id, { limit: 5, status: "all" }),
    ]);
    setCount(unreadCount);
    setNotifications(recent);
    setError("");
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const tenant = await getCurrentTenant();

        if (!active || !tenant) {
          return;
        }

        setTenantId(tenant.id);
        const [unreadCount, recent] = await Promise.all([
          getUnreadNotificationCount(tenant.id),
          getUserNotifications(tenant.id, { limit: 5, status: "all" }),
        ]);

        if (active) {
          setCount(unreadCount);
          setNotifications(recent);
        }
      } catch {
        if (active) {
          setCount(0);
          setNotifications([]);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        open &&
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  async function handleMarkRead(notificationId: string) {
    if (!tenantId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      await markNotificationRead(tenantId, notificationId);
      await loadNotifications();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update notification.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        aria-label="Open notifications"
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[#D8E8F0] bg-white text-[#0B2A3D] shadow-sm transition hover:-translate-y-0.5 hover:border-[#2ECBEA]/70 hover:bg-[#F3FAFD]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <svg
          className="h-5 w-5"
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
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#F59E0B] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#0B1F33]">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-[#D8E8F0] bg-white text-[#0B1F33] shadow-2xl shadow-[#0B2A3D]/20">
          <div className="flex items-center justify-between border-b border-[#D8E8F0] px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Notifications</p>
              <p className="mt-1 text-xs text-[#66788F]">
                {count} unread update{count === 1 ? "" : "s"}
              </p>
            </div>
            <Link
              className="text-xs font-semibold text-[#145DA0] hover:text-[#0B2A3D]"
              href="/app/notifications"
              onClick={() => setOpen(false)}
            >
              View all
            </Link>
          </div>

          {error ? (
            <div className="mx-4 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="max-h-96 overflow-y-auto p-3">
            {notifications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#C7DDEA] bg-[#F6FBFE] p-5 text-center text-sm text-[#425B76]">
                No notifications yet.
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((notification) => (
                  <div
                    className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4 transition hover:-translate-y-0.5 hover:bg-white"
                    key={notification.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#0B1F33]">
                          {notification.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#425B76]">
                          {notification.message}
                        </p>
                      </div>
                      <Badge
                        className={getSeverityClass(notification.severity)}
                      >
                        {notification.severity}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#66788F]">
                      <span>{formatNotificationTime(notification.created_at)}</span>
                      {notification.status === "unread" ? (
                        <button
                          className="font-semibold text-[#145DA0] disabled:text-[#66788F]"
                          disabled={loading}
                          onClick={() => handleMarkRead(notification.id)}
                          type="button"
                        >
                          Mark read
                        </button>
                      ) : null}
                      {getSafeNotificationActionUrl(notification.action_url) ? (
                        <Link
                          className="font-semibold text-[#145DA0]"
                          href={
                            getSafeNotificationActionUrl(
                              notification.action_url,
                            ) ?? "/app/notifications"
                          }
                          onClick={() => setOpen(false)}
                        >
                          Open
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
