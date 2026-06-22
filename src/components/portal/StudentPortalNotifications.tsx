"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";
import {
  formatPortalDateTime,
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
  usePortalSection,
} from "@/src/components/portal/StudentPortalShared";

export function StudentPortalNotifications({ context }: { context: StudentPortalContext }) {
  const { error, loading, overview } = usePortalSection(context);

  if (loading) return <PortalLoadingCard label="Loading notifications" />;
  if (error || !overview) return <PortalError message={error || "Unable to load notifications."} />;

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">Notifications</h1>
      <div className="mt-6 space-y-4">
        {overview.notifications.length === 0 ? (
          <PortalEmptyState>No notifications yet.</PortalEmptyState>
        ) : (
          overview.notifications.map((notification) => (
            <Card className="border-[#D8E8F0] bg-white p-5" key={notification.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{notification.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-[#425B76]">
                    {notification.message}
                  </p>
                  <p className="mt-2 text-xs text-[#66788F]">
                    {formatPortalDateTime(notification.created_at)}
                  </p>
                </div>
                <Badge
                  tone={
                    notification.severity === "critical"
                      ? "danger"
                      : notification.severity === "warning"
                        ? "warning"
                        : "light"
                  }
                >
                  {notification.severity}
                </Badge>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
