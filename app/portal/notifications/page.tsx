"use client";

import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";
import { StudentPortalNotifications } from "@/src/components/portal/StudentPortalNotifications";

export default function PortalNotificationsPage() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <StudentPortalNotifications context={context} />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
